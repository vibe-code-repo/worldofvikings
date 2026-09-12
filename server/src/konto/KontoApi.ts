/**
 * HTTP API for accounts and characters.
 *
 * ── Why it rides on the game port ────────────────────────────────────
 * `ws` already runs an HTTP server on 2467 (that is where the 426 comes
 * from that tools/wov-update.sh uses as a health check). Hanging the
 * account endpoints off the same server saves a second host, port and
 * certificate. Anything else still gets the old 426, so the health check
 * keeps working.
 *
 * ── Why /accounts/ and NOT /api/konto/ ─────────────────────────────────
 * /api/ is already taken, and it does not lead here. On dev, Vite proxies
 * /api/ to the ADMIN service on 2468 (client/vite.config.ts); on live,
 * deploy/nginx-live.conf does the same and additionally gates it behind a
 * host check, so play.world-of-vikings.com/api/ returns 404 by design.
 * Endpoints placed under /api/konto/ were therefore never reached — the
 * first version of this file claimed the opposite and was wrong. A prefix
 * of its own avoids squeezing into a block that carries a host gate and a
 * header rewrite.
 *
 * ── Why X-WoV-Account and not Authorization ────────────────────────────
 * The proxy in front of dev sets `proxy_set_header Authorization ""` in
 * its `location /` — basic-auth credentials are deliberately not passed
 * through, and a Bearer token in that header is stripped along with them.
 * The admin service hit the same wall and solved it the same way, with
 * `x-wov-token`. Authorization is still accepted, so a direct call to
 * 127.0.0.1:2467 keeps working.
 *
 * ── Two kinds of token, deliberately not interchangeable ─────────────
 * An ACCOUNT token says "this is Mike". A PLAYER token (Identitaet.ts)
 * says "this connection may be character sp_… in the world". If the same
 * key signed both, an account token would be a valid player token for
 * whatever spielerId happened to sit in its payload. So the account key
 * is DERIVED from the session secret through a separate label, and the
 * two can never validate against each other.
 *
 * ── What this endpoint deliberately does not do ──────────────────────
 * The e-mail address is stored and never verified — a product decision,
 * the account works immediately. It is therefore not proof of anything
 * and must never become a password reset path on its own.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { herkunftErmitteln } from '../net/Herkunft.js';
import { tokenAusstellen, type SpielerId } from '../net/Identitaet.js';
import { Kontendatenbank, type Charakter } from './Kontendatenbank.js';
import { passwortEinlagern, passwortPruefen, veraltet } from './Passwort.js';

/** Origins allowed to call this API from a browser. */
const ERLAUBTE_URSPRUENGE = new Set([
  'https://world-of-vikings.com',
  'https://www.world-of-vikings.com',
]);

const KONTO_TOKEN_GUELTIG_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const MAX_KOERPER_BYTES = 4096;

/** Failed logins per IP: five in fifteen minutes, then a pause. */
const FEHLVERSUCHE_MAX = 5;
const FEHLVERSUCHE_FENSTER_MS = 15 * 60 * 1000;

/**
 * Registrations per origin: five per hour, then 429.
 *
 * `registrieren()` called neither `gesperrt()` nor `fehlversuchZaehlen()`
 * — the login throttle only ever counted FAILED logins, and registering
 * an account has no such thing as a "wrong password" to fail on. Twenty
 * registrations in a row all answered 201. Same map/window shape as the
 * login throttle, but its own counter and its own map: registering is
 * not a failure mode of logging in, and sharing one map would let a
 * string of failed logins from an origin also start blocking its
 * registrations, or the reverse — two unrelated limits with no reason to
 * share a budget.
 */
const REGISTRIERUNG_MAX = 5;
const REGISTRIERUNG_FENSTER_MS = 60 * 60 * 1000;

/**
 * Username shape, shared with `StandardKonto.ts`: the standard account's
 * name is validated the same way a registered one is, "wie bei der
 * Registrierung" is not just a comment but this one pattern.
 */
export const BENUTZERNAME_REGEX = /^[\p{L}\p{N}_-]{3,24}$/u;

/** Character name shape, shared with `StandardKonto.ts` for the same reason. */
export const CHARAKTERNAME_REGEX = /^[\p{L}\p{N} _-]{2,24}$/u;

interface KontoTokenPayload { k: number; i: number; e: number }

/**
 * What the server says about itself when anyone asks.
 *
 * Deliberately four numbers and a name: it is the only endpoint here that
 * answers WITHOUT a token, so everything in it is public by definition.
 * No player names — who is online is not the website's business, only how
 * many.
 */
export interface Serverzustand {
  /** Players connected right now. */
  spieler: number;
  /** Seats, i.e. `maxPlayers` from the server config. */
  plaetze: number;
  /** World day, as the game counts it. */
  tag: number;
  /** Instance name (`worldName`), so a shore can be told apart in a log. */
  welt: string;
}

export class KontoApi {
  private readonly kontoSchluessel: Buffer;
  private readonly fehlversuche = new Map<string, { anzahl: number; bis: number }>();
  private readonly registrierungen = new Map<string, { anzahl: number; bis: number }>();

  constructor(
    private readonly db: Kontendatenbank,
    private readonly sessionSecret: Buffer,
    /**
     * Asked on every `/accounts/status`, never cached here.
     *
     * A callback and not a snapshot: the number of players online changes
     * without this class hearing about it, and a value handed in at
     * construction time would be the count at server start forever.
     */
    private readonly zustand: () => Serverzustand,
    /**
     * Name of the standard account (`server.yml` `standard-konto:`), or
     * `undefined` when the operator removed that block. The PASSWORD is
     * deliberately not a constructor argument — it lives in `server.yml`
     * and the README, and this class hands the browser nothing it could
     * not already read there. See `StandardKonto.ts`.
     */
    private readonly standardKontoName?: string,
  ) {
    // Domain separation: a different key for account tokens, derived from
    // the same secret. See the header comment.
    this.kontoSchluessel = createHmac('sha256', sessionSecret).update('wov-konto-v1').digest();
  }

  /**
   * Handle a request. Returns false if the path is not ours, so the caller
   * can fall back to its previous behaviour (the 426).
   */
  behandle(req: IncomingMessage, res: ServerResponse): boolean {
    const pfad = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '');
    if (!pfad.startsWith('/accounts')) return false;

    const ursprung = req.headers.origin;
    if (ursprung && ERLAUBTE_URSPRUENGE.has(ursprung)) {
      res.setHeader('Access-Control-Allow-Origin', ursprung);
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-wov-account');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }

    void this.leite(req, res, pfad).catch((e) => {
      console.error('[Konto] unerwarteter Fehler:', e);
      this.json(res, 500, { error: 'server-error' });
    });
    return true;
  }

  private async leite(req: IncomingMessage, res: ServerResponse, pfad: string): Promise<void> {
    const m = req.method ?? 'GET';

    if (pfad === '/accounts/status' && m === 'GET') return this.status(res);
    if (pfad === '/accounts/register' && m === 'POST') return this.registrieren(req, res);
    if (pfad === '/accounts/login' && m === 'POST') return this.anmelden(req, res);
    if (pfad === '/accounts/me' && m === 'GET') return this.ich(req, res);
    if (pfad === '/accounts/characters' && m === 'POST') return this.charakterAnlegen(req, res);

    const spielen = /^\/accounts\/characters\/(\d+)\/play$/.exec(pfad);
    if (spielen && m === 'POST') return this.spielen(req, res, Number(spielen[1]));

    const loeschen = /^\/accounts\/characters\/(\d+)$/.exec(pfad);
    if (loeschen && m === 'DELETE') return this.charakterLoeschen(req, res, Number(loeschen[1]));

    this.json(res, 404, { error: 'unknown-endpoint' });
  }

  // ── Endpoints ───────────────────────────────────────────────────────

  /**
   * The one endpoint without a token: what this shore looks like right now.
   *
   * ── Why it lives here and not under /api/ ────────────────────────────
   * `/api/` on the game host is the admin service on 2468 and answers 404
   * by host gate; `/accounts/` is the prefix that is actually proxied to
   * the game port, with `auth_basic off` and the CORS headers above. A
   * status endpoint anywhere else would have to earn all three again.
   *
   * ── Why the website could not simply keep its file ───────────────────
   * `wov-web/static/api/welt.json` is a hand-written demo file. It says
   * "3 players" whether anybody plays or not, and it says it from a
   * prerendered site that nobody redeploys when somebody logs in — the
   * player count on the front page was never a measurement.
   *
   * ── What is deliberately NOT in the answer ───────────────────────────
   * No player names, no character names, no e-mails, no ids. Counts only:
   * the endpoint is unauthenticated, so every field in it is public to
   * anyone who can reach the host.
   */
  private status(res: ServerResponse): void {
    const z = this.zustand();
    const gezaehlt = this.db.zaehlen();
    // Kein `Access-Control-Allow-Origin: *`, obwohl die Zahlen öffentlich
    // sind und es nahe läge: Der Proxy vor den Spielhosts VERSTECKT die
    // Kopfzeile des Backends und setzt eine eigene aus seiner eigenen
    // Liste erlaubter Ursprünge (nachgemessen am 27.08.2026 — mit
    // `Origin: http://localhost:4173` kommt gar keine an, mit dem Ursprung
    // der Webseite genau eine). Ein `*` hier wäre deshalb ein Versprechen,
    // das an der Haustür wieder eingesammelt wird; wer die Seite lokal
    // gegen ein Gestade laufen lassen will, muss den Proxy erweitern.
    // no-store rather than a short max-age: the whole point of the number
    // is that it is current, and a proxy holding it for a minute would
    // reintroduce the stale count this endpoint exists to replace.
    res.setHeader('Cache-Control', 'no-store');
    this.json(res, 200, {
      world: z.welt,
      players: z.spieler,
      slots: z.plaetze,
      day: z.tag,
      accounts: gezaehlt.konten,
      characters: gezaehlt.charaktere,
      // Nur der NAME, nie das Passwort — das steht in server.yml und im
      // README, nicht in dieser oeffentlichen, tokenlosen Antwort. Das
      // Feld fehlt ganz, wenn der Betreiber den Block entfernt hat, damit
      // die Webseite den Hinweis nur zeigt, wenn er wirklich stimmt.
      ...(this.standardKontoName ? { standardKonto: { name: this.standardKontoName } } : {}),
    });
  }

  private async registrieren(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = this.herkunft(req);
    const sperre = this.registrierungGesperrt(ip);
    if (sperre.gesperrt) {
      res.setHeader('Retry-After', String(sperre.retryNachSek));
      return this.json(res, 429, { error: 'too-many-registrations' });
    }
    // Zaehlen, BEVOR ueberhaupt geprueft oder gehasht wird: die Drossel
    // soll den Aufwand fuer diese Herkunft begrenzen, nicht nur die Zahl
    // ihrer erfolgreichen Konten — scrypt (unten, passwortEinlagern) ist
    // absichtlich das teuerste, was in dieser Methode passiert, und laeuft
    // deshalb erst NACH dieser Pruefung.
    this.registrierungZaehlen(ip);

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const benutzername = String(k.username ?? '').trim();
    const email = String(k.email ?? '').trim();
    const passwort = String(k.password ?? '');

    const maengel = pruefeAnmeldedaten(benutzername, email, passwort);
    if (maengel) return this.json(res, 400, { error: maengel });

    const eintrag = await passwortEinlagern(passwort);
    const r = this.db.kontoAnlegen(benutzername, email, eintrag);
    if (!r.ok) return this.json(res, 409, { error: r.fehler });

    console.log(`[Konto] angelegt: "${benutzername}"`);
    this.json(res, 201, {
      token: this.kontoTokenAusstellen(r.konto.id),
      account: { username: r.konto.benutzername, email: r.konto.email },
      characters: [],
    });
  }

  private async anmelden(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = this.herkunft(req);
    if (this.gesperrt(ip)) return this.json(res, 429, { error: 'too-many-attempts' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const benutzername = String(k.username ?? '').trim();
    const passwort = String(k.password ?? '');
    const konto = benutzername ? this.db.kontoNachName(benutzername) : null;

    // Always run the (expensive) check, even when the account does not
    // exist: otherwise the response time tells an attacker which
    // usernames are real.
    const eintrag = konto?.passwort
      ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const stimmt = await passwortPruefen(passwort, eintrag);

    if (!konto || !stimmt) {
      this.fehlversuchZaehlen(ip);
      // One message for both cases — "unknown user" would be an oracle.
      return this.json(res, 401, { error: 'login-failed' });
    }

    this.fehlversuche.delete(ip);
    // Raise the cost on the fly: this is the only moment the plain
    // password is available to write a stronger record with.
    if (veraltet(eintrag)) {
      this.db.passwortErsetzen(konto.id, await passwortEinlagern(passwort));
    }

    this.json(res, 200, {
      token: this.kontoTokenAusstellen(konto.id),
      account: { username: konto.benutzername, email: konto.email },
      characters: this.db.charaktereVonKonto(konto.id).map(nachAussen),
    });
  }

  private ich(req: IncomingMessage, res: ServerResponse): void {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });
    const konto = this.db.kontoNachId(kontoId);
    if (!konto) return this.json(res, 401, { error: 'not-signed-in' });
    this.json(res, 200, {
      account: { username: konto.benutzername, email: konto.email },
      characters: this.db.charaktereVonKonto(kontoId).map(nachAussen),
    });
  }

  private async charakterAnlegen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const name = String(k.name ?? '').trim();
    if (!CHARAKTERNAME_REGEX.test(name)) return this.json(res, 400, { error: 'name-invalid' });

    // Wire field -> database column. The two vocabularies are separate on
    // purpose: the columns in `Kontendatenbank.ts` still read `figur`,
    // `frisur`, `ober`, `beine` because renaming them would be an ALTER
    // TABLE on live data, not a rename. The translation lives here and in
    // `nachAussen()` below — those two are the only places that know both.
    const r = this.db.charakterAnlegen(kontoId, name, {
      figur: String(k.figure ?? ''),
      frisur: String(k.hairstyle ?? ''),
      haarfarbe: String(k.hairColor ?? ''),
      ober: String(k.top ?? ''),
      beine: String(k.legs ?? ''),
    });
    if (!r.ok) return this.json(res, 409, { error: r.fehler });
    console.log(`[Konto] Charakter "${name}" fuer Konto ${kontoId}`);
    this.json(res, 201, { character: nachAussen(r.charakter) });
  }

  private charakterLoeschen(req: IncomingMessage, res: ServerResponse, id: number): void {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });
    // Scoped by konto_id in SQL, so a foreign id simply does not match —
    // there is no path here that could delete someone else's character.
    const weg = this.db.charakterLoeschen(kontoId, id);
    this.json(res, weg ? 200 : 404, weg ? { ok: true } : { error: 'unknown' });
  }

  /**
   * Hand out a PLAYER token for one character — the ticket into the world.
   *
   * This is the only place where an account turns into a game identity,
   * and the character is looked up scoped to the account, so a token can
   * never be issued for a character somebody else owns.
   */
  private spielen(req: IncomingMessage, res: ServerResponse, id: number): void {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const c = this.db.charakterVonKonto(kontoId, id);
    if (!c) return this.json(res, 404, { error: 'unknown' });

    this.db.gespieltVermerken(c.id);
    this.json(res, 200, {
      sessionToken: tokenAusstellen(c.spielerId, c.altlastUserId, this.sessionSecret),
      character: nachAussen(c),
    });
  }

  // ── Account tokens ──────────────────────────────────────────────────

  private kontoTokenAusstellen(kontoId: number): string {
    const jetzt = Date.now();
    const payload: KontoTokenPayload = { k: kontoId, i: jetzt, e: jetzt + KONTO_TOKEN_GUELTIG_MS };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.kontoSchluessel).update(b64).digest('base64url');
    return `${b64}.${sig}`;
  }

  /** Account id from the Authorization header, or null. */
  private kontoAus(req: IncomingMessage): number | null {
    // X-WoV-Account zuerst: Authorization wird vom Proxy vor dev geleert.
    const eigen = req.headers['x-wov-account'];
    const kopf = req.headers.authorization ?? '';
    const token = typeof eigen === 'string' && eigen.trim()
      ? eigen.trim()
      : kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
    const teile = token.split('.');
    if (teile.length !== 2 || !teile[0] || !teile[1]) return null;

    const erwartet = createHmac('sha256', this.kontoSchluessel).update(teile[0]).digest('base64url');
    let a: Buffer, b: Buffer;
    try {
      a = Buffer.from(teile[1], 'base64url');
      b = Buffer.from(erwartet, 'base64url');
    } catch { return null; }
    // Signature before expiry, so an expired token still has to be genuine
    // before anything about it is believed.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
      const p = JSON.parse(Buffer.from(teile[0], 'base64url').toString('utf8')) as KontoTokenPayload;
      if (typeof p.k !== 'number' || typeof p.e !== 'number') return null;
      if (Date.now() > p.e) return null;
      return p.k;
    } catch { return null; }
  }

  // ── Plumbing ────────────────────────────────────────────────────────

  private herkunft(req: IncomingMessage): string {
    return herkunftErmitteln(req);
  }

  private gesperrt(ip: string): boolean {
    const e = this.fehlversuche.get(ip);
    if (!e) return false;
    if (Date.now() > e.bis) { this.fehlversuche.delete(ip); return false; }
    return e.anzahl >= FEHLVERSUCHE_MAX;
  }

  private fehlversuchZaehlen(ip: string): void {
    const jetzt = Date.now();
    const e = this.fehlversuche.get(ip);
    if (!e || jetzt > e.bis) {
      this.fehlversuche.set(ip, { anzahl: 1, bis: jetzt + FEHLVERSUCHE_FENSTER_MS });
    } else {
      e.anzahl++;
    }
  }

  /** Same shape as `gesperrt()`, its own map — see REGISTRIERUNG_MAX above. */
  private registrierungGesperrt(ip: string): { gesperrt: boolean; retryNachSek: number } {
    const e = this.registrierungen.get(ip);
    if (!e) return { gesperrt: false, retryNachSek: 0 };
    const jetzt = Date.now();
    if (jetzt > e.bis) { this.registrierungen.delete(ip); return { gesperrt: false, retryNachSek: 0 }; }
    return { gesperrt: e.anzahl >= REGISTRIERUNG_MAX, retryNachSek: Math.ceil((e.bis - jetzt) / 1000) };
  }

  private registrierungZaehlen(ip: string): void {
    const jetzt = Date.now();
    const e = this.registrierungen.get(ip);
    if (!e || jetzt > e.bis) {
      this.registrierungen.set(ip, { anzahl: 1, bis: jetzt + REGISTRIERUNG_FENSTER_MS });
    } else {
      e.anzahl++;
    }
  }

  private async koerper(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((fertig) => {
      let roh = '';
      let zuGross = false;
      req.on('data', (stueck: Buffer) => {
        if (zuGross) return;
        roh += stueck.toString('utf8');
        // Cap the body: without it any caller could make the server hold
        // an arbitrary amount of memory before the first line is parsed.
        if (roh.length > MAX_KOERPER_BYTES) { zuGross = true; req.destroy(); }
      });
      req.on('end', () => {
        if (zuGross) return fertig(null);
        try {
          const d: unknown = JSON.parse(roh);
          fertig(d && typeof d === 'object' ? (d as Record<string, unknown>) : null);
        } catch { fertig(null); }
      });
      req.on('error', () => fertig(null));
    });
  }

  private json(res: ServerResponse, code: number, daten: unknown): void {
    const text = JSON.stringify(daten);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text);
  }
}

/**
 * Never let spielerId or altlastUserId leave the server.
 *
 * This is also the one place where the database vocabulary turns into the
 * wire vocabulary: the columns are `figur`/`frisur`/`ober`/`beine` and stay
 * that way (renaming them is an ALTER TABLE on live accounts, not a
 * rename), the fields the browser sees are English. The VALUES are
 * untouched on the way through — `wikingerin`, `H_01`, `leder_bh` are ids
 * from `shared/aussehen.ts` and mean the same on both sides.
 */
function nachAussen(c: Charakter): Record<string, unknown> {
  return {
    id: c.id, name: c.name, figure: c.figur, hairstyle: c.frisur,
    hairColor: c.haarfarbe,
    top: c.ober, legs: c.beine,
    created: c.erstellt, lastPlayed: c.zuletztGespielt,
  };
}

/** Returns an error key, or null when the input is acceptable. */
export function pruefeAnmeldedaten(
  benutzername: string, email: string, passwort: string,
): string | null {
  if (!BENUTZERNAME_REGEX.test(benutzername)) return 'username-invalid';
  // Deliberately loose: the address is never verified, so a strict pattern
  // would only reject valid unusual addresses without buying anything.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'email-invalid';
  if (passwort.length < 8 || passwort.length > 200) return 'password-too-short';
  return null;
}

export type { SpielerId };
