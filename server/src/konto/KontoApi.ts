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
import { EDITOR_NAME, nameHatSteuerzeichen, namenSchluessel } from '../net/Namen.js';
import { WEBSITE_URSPRUENGE } from '../net/WebsiteUrspruenge.js';
import { Armory, aufTag } from './Armory.js';
import { Kontendatenbank, PROFILTEXT_MAX, type Charakter, type GeloeschtesKonto } from './Kontendatenbank.js';
import { passwortEinlagern, passwortPruefen, veraltet } from './Passwort.js';
import {
  AUGENFARBE_VORGABE, istAugenfarbe, istFigur, istFrisur, istHaarfarbe, istRuestung, isCharacterClass,
} from '@wov/shared';

/** Origins allowed to call this API from a browser (Karte D1: eine gemeinsame Stelle mit ForumApi.ts). */
const ERLAUBTE_URSPRUENGE = WEBSITE_URSPRUENGE;

const KONTO_TOKEN_GUELTIG_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const MAX_KOERPER_BYTES = 4096;

/** Failed logins per IP: five in fifteen minutes, then a pause. */
const FEHLVERSUCHE_MAX = 5;
/**
 * Login-Versuche je Herkunft ueber ALLE Konten, die ein Erfolg NICHT
 * zuruecksetzt. Gegen das Abklappern vieler Konten von einer Adresse; hoeher
 * als `FEHLVERSUCHE_MAX`, weil hinter einer Adresse (NAT, Haushalt) mehrere
 * Menschen sitzen koennen. Bewusst KEIN kontoweites Login-Limit: das koennte
 * ein Dieb dem Besitzer zudrehen, und der Rettungsweg laeuft ueber den Login.
 */
const LOGIN_HERKUNFT_MAX = 25;
const FEHLVERSUCHE_FENSTER_MS = 15 * 60 * 1000;

/**
 * Fehlversuche beim Bestaetigen des Passworts je KONTO (alle Herkuenfte
 * zusammen). Bewusst weit ueber dem Herkunfts-Limit: Die Herkunft haelt
 * einen Dieb an seiner Adresse fest, dieses Limit nur verteiltes Raten. Waere
 * es klein, sperrte ein Dieb mit gestohlenem Token von fuenf Adressen aus den
 * Besitzer aus seiner eigenen Rettung (Passwort aendern, Konto loeschen).
 */
const KONTO_FEHLVERSUCHE_MAX = 50;

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

/**
 * Wie SQLite `COLLATE NOCASE`: faltet NUR A-Z. Volles `toLowerCase()` faltet
 * zusaetzlich Å/Ü/Ø und das Kelvin-Zeichen (U+212A) zu Kleinbuchstaben, die
 * der SQL-Lookup so nicht kennt — ein Login-Orakel ueber die Schreibweise
 * (U1, W3-N4-Pruefung: bekannt vs. unbekannt unterscheidet sich in Status
 * und Zeit, sobald eine Nicht-ASCII-Schreibweise im Spiel ist).
 */
function asciiFalten(s: string): string {
  return s.replace(/[A-Z]+/g, (x) => x.toLowerCase());
}

/**
 * Schluessel eines unbekannten Namens im Login-Versuchszaehler. Nur was die
 * Registrierung ueberhaupt zulaesst (`BENUTZERNAME_REGEX`), bekommt einen
 * eigenen, ASCII-gefalteten Schluessel — deckungsgleich mit dem SQL-Lookup
 * (U1) UND kurz (U2): Ohne die Regelpruefung landete jede beliebige Eingabe
 * bis 4 KB ungekuerzt in der Karte. Ein fester Schluessel fuer Regelverstoesse
 * ist kein neues Orakel, die Regel ist oeffentlich.
 */
function unbekannterNameSchluessel(benutzername: string): string {
  return BENUTZERNAME_REGEX.test(benutzername) ? `?${asciiFalten(benutzername)}` : '?#ungueltig';
}

/**
 * IPv6-/64-Praefix einer (von `Herkunft.ts` schon validierten, ggf.
 * verkuerzten) Adresse: die ersten vier 16-Bit-Gruppen. Ohne das zaehlt
 * jede der 2^64 Adressen eines Anschlusses einzeln (N5) — ein Angreifer mit
 * einem eigenen /64 (der Regelfall bei IPv6-Zuteilungen) waere von der
 * Herkunftsgrenze praktisch nie betroffen. IPv4 bleibt unveraendert.
 */
export function herkunftSchluessel(adresse: string): string {
  if (!adresse.includes(':')) return adresse;
  let a = adresse.toLowerCase();
  // IPv4-gemappt, gepunktet (::ffff:1.2.3.4): zaehlt wie die IPv4-Adresse.
  const gepunktet = /^(?:0{0,4}:){1,5}ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (gepunktet) return gepunktet[1]!;
  const [kopfTeil, schwanzTeil] = a.split('::');
  const kopf = kopfTeil ? kopfTeil.split(':') : [];
  const schwanz = schwanzTeil ? schwanzTeil.split(':') : [];
  const fehlend = Math.max(0, 8 - kopf.length - schwanz.length);
  // Fuehrende Nullen weg: "0db8" und "db8" sind dieselbe Gruppe.
  const gruppen = [...kopf, ...Array<string>(fehlend).fill('0'), ...schwanz]
    .map((g) => g.replace(/^0+(?=.)/, ''));
  // IPv4-gemappt, hex (::ffff:c000:201): ebenfalls die IPv4-Adresse.
  if (gruppen.length === 8 && gruppen.slice(0, 5).every((g) => g === '0') && gruppen[5] === 'ffff') {
    const hoch = parseInt(gruppen[6]!, 16);
    const tief = parseInt(gruppen[7]!, 16);
    if (Number.isInteger(hoch) && Number.isInteger(tief)) {
      return `${hoch >> 8}.${hoch & 255}.${tief >> 8}.${tief & 255}`;
    }
  }
  a = gruppen.slice(0, 4).join(':');
  return `v6:${a}`;
}

/**
 * Was nach einer Kontoloeschung ausserhalb der Kontendatenbank zu tun ist.
 * Beides sind Haken statt fester Abhaengigkeiten: die KontoApi kennt weder
 * die Forendatei noch die Spielwelt.
 */
export interface KontoHaken {
  /** Forum anonymisieren (Beitraege bleiben, Autor wird "Geloeschter Recke"). Darf werfen; der Auftrag bleibt dann stehen. */
  forumBereinigen?: (auftrag: { kontoId: number; charakterIds: number[]; namen: string[] }) => void;
  /** Laufende Spiele trennen, Spielstand/Inventar entfernen, Bauten herrenlos, Truhen entfernen. */
  weltBereinigen?: (konto: GeloeschtesKonto) => void;
  /** Laufende Spielverbindungen dieser Spieler-Kennungen beenden (nach einem Passwortwechsel). */
  spielerTrennen?: (spielerIds: string[]) => void;
}

/**
 * Einhaengepunkte NUR fuer Tests, die ein Zeitfenster zwischen zwei awaits
 * erzwingen muessen. In der Produktion nie gesetzt; die Aufrufe sind dann
 * ein `undefined?.()`.
 */
export interface KontoTestHaken {
  /** In `anmelden()`, direkt nach der Passwortpruefung. */
  nachLoginPruefung?: () => Promise<void>;
  /** In `passwortBestaetigen()`, direkt nach der Passwortpruefung. */
  nachBestaetigung?: () => Promise<void>;
}

/** Name, unter dem die Beitraege eines geloeschten Kontos weiterstehen. */
export const GELOESCHTER_AUTOR = 'Gelöschter Recke';

interface KontoTokenPayload { k: number; i: number; e: number; g?: number }

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
  /** Fehlversuche beim Bestaetigen des Passworts, je Konto (zusaetzlich zur Herkunft). */
  private readonly kontoFehlversuche = new Map<number, { anzahl: number; bis: number }>();
  /**
   * Fehlversuche beim Bestaetigen des Passworts je (Herkunft, Konto). Bewusst
   * NICHT der Herkunftszaehler des Logins: Ein Erfolg im EIGENEN Konto setzte
   * sonst die Zaehlung fuer JEDES Konto dieser Adresse zurueck, und ein Dieb
   * mit gestohlenem Token haette von einer einzigen Adresse beliebig viele
   * Versuche gegen das Opfer gehabt (vier falsch, einmal im eigenen Konto
   * Erfolg, wieder von vorn).
   */
  private readonly bestaetigungen = new Map<string, { anzahl: number; bis: number }>();
  /**
   * Login-Versuche je (Herkunft, Konto). Ein Erfolg loescht NUR diesen
   * Schluessel — sonst setzte jeder erfolgreiche Login in ein beliebiges
   * Konto (auch das oeffentliche `gast`) die Zaehlung gegen andere Konten
   * dieser Adresse zurueck (vier falsch, ein Gast-Login, von vorn).
   */
  private readonly loginVersuche = new Map<string, { anzahl: number; bis: number }>();
  /** Nur fuer Tests, s. `KontoTestHaken`. */
  testHaken: KontoTestHaken = {};
  /** Oeffentliches Abbild fuer die Ruestkammer; `uhr` ist fuer Tests offen. */
  readonly armory: Armory;

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
     * Names of the standard accounts (`server.yml` `standard-konto:`),
     * empty when the operator removed that block. The PASSWORDS are
     * deliberately not constructor arguments — they live in `server.yml`
     * and the README, and this class hands the browser nothing it could
     * not already read there. See `StandardKonto.ts`.
     *
     * Eine Liste, weil die Webseite zweisprachig ist: Die deutsche
     * Anmeldeseite nennt `gast`, die englische `guest`. Die Reihenfolge
     * ist die der Datei und bleibt es — `standardKonto` (Einzahl) in der
     * Antwort ist der ERSTE Eintrag, und daran haengen aeltere Clients.
     */
    private readonly standardKontoNamen: readonly string[] = [],
    /**
     * ALLE Standardkonten (auch das Adminkonto): Passwort, E-Mail und
     * Loeschung sind dort gesperrt. Ihr Passwort steht oeffentlich in
     * server.yml; wer es kennt, koennte sonst allen anderen das Konto
     * wegnehmen oder es loeschen.
     */
    private readonly geschuetzteNamen: readonly string[] = [],
    private readonly haken: KontoHaken = {},
  ) {
    // Domain separation: a different key for account tokens, derived from
    // the same secret. See the header comment.
    this.kontoSchluessel = createHmac('sha256', sessionSecret).update('wov-konto-v1').digest();
    this.armory = new Armory(db, [...geschuetzteNamen, ...standardKontoNamen]);
  }

  /**
   * Handle a request. Returns false if the path is not ours, so the caller
   * can fall back to its previous behaviour (the 426).
   */
  behandle(req: IncomingMessage, res: ServerResponse): boolean {
    let pfad: string;
    try {
      pfad = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '');
    } catch {
      // Ein Pfad, den `new URL` gar nicht lesen kann (`//accounts%2fx/…`: Host mit ungueltigem Zeichen), ist kein Weg dieser API.
      this.json(res, 400, { error: 'bad-path' });
      return true;
    }
    if (!pfad.startsWith('/accounts')) return false;
    // Der ROHE Pfad entscheidet, nicht der geparste: `new URL` macht aus `/accounts/x\..\armory` den Pfad
    // `/accounts/armory`, nachdem ein Vorschalter (nginx) die Anfrage schon nach dem rohen Text eingeordnet hat.
    if (rohPfadUnzulaessig(req.url ?? '')) {
      this.json(res, 400, { error: 'bad-path' });
      return true;
    }

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
    if (pfad === '/accounts/avatar' && m === 'POST') return this.avatarSetzen(req, res);
    if (pfad === '/accounts/profile' && m === 'POST') return this.profilSetzen(req, res);
    if (pfad === '/accounts/email' && m === 'POST') return this.emailAendern(req, res);
    if (pfad === '/accounts/password' && m === 'POST') return this.passwortAendern(req, res);
    if (pfad === '/accounts/delete' && m === 'POST') return this.kontoLoeschen(req, res);

    // Die Ruestkammer-Wege beantwortet NUR ein Loopback-Peer (die Webseite ruft ueber 127.0.0.1; nginx sperrt sie von aussen).
    // Der Spielserver lauscht auf allen Schnittstellen: von einer anderen Adresse gilt der Weg als nicht vorhanden (404 wie unten).
    const lokal = istLoopbackPeer(req);
    if (lokal && pfad === '/accounts/armory' && m === 'GET') return this.armoryListe(req, res);
    const armoryProfil = /^\/accounts\/armory\/(\d{1,9})$/.exec(pfad);
    if (lokal && armoryProfil && m === 'GET') return this.armoryEinzeln(req, res, Number(armoryProfil[1]));

    const melden = /^\/accounts\/characters\/(\d+)\/report$/.exec(pfad);
    if (melden && m === 'POST') return this.profilMelden(req, res, Number(melden[1]));

    const spielen = /^\/accounts\/characters\/(\d+)\/play$/.exec(pfad);
    if (spielen && m === 'POST') return this.spielen(req, res, Number(spielen[1]));

    const einzelCharakter = /^\/accounts\/characters\/(\d+)$/.exec(pfad);
    if (einzelCharakter && m === 'GET') {
      return this.charakterOeffentlich(res, Number(einzelCharakter[1]));
    }
    if (einzelCharakter && m === 'DELETE') {
      return this.charakterLoeschen(req, res, Number(einzelCharakter[1]));
    }

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
      // `standardKonto` (Einzahl, erster Eintrag) bleibt, weil eine
      // Webseite im Umlauf ist, die genau dieses Feld abfragt — ein
      // Gestade, das nur noch die Liste meldet, wuerde dort den Hinweis
      // wortlos verschwinden lassen. `standardKonten` ist die volle
      // Wahrheit fuer alles, was sie schon kennt.
      ...(this.standardKontoNamen.length > 0
        ? {
            standardKonto: { name: this.standardKontoNamen[0] },
            standardKonten: this.standardKontoNamen.map((name) => ({ name })),
          }
        : {}),
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
      token: this.kontoTokenAusstellen(r.konto.id, this.db.tokenAbVon(r.konto.id) ?? 0),
      account: { username: r.konto.benutzername, email: r.konto.email },
      characters: [],
      avatar: null,
    });
  }

  private async anmelden(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ip = this.herkunft(req);
    if (this.herkunftGesperrt(ip)) return this.json(res, 429, { error: 'too-many-attempts' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });

    const benutzername = String(k.username ?? '').trim();
    const passwort = String(k.password ?? '');
    const konto = benutzername ? this.db.kontoNachName(benutzername) : null;

    // Gezaehlt wird VOR dem Hashen (gleichzeitige Versuche umgehen die Sperre
    // sonst) und bei Erfolg zurueckgenommen. Unbekannte Namen zaehlen je NAME,
    // mit demselben ASCII-only-Falten wie der SQL-Lookup (`asciiFalten`, U1):
    // bekannte und unbekannte Namen verhalten sich dann gleich (fuenf
    // Versuche, dann 429). Ein gemeinsamer Schluessel fuer alle unbekannten
    // Namen waere ein Orakel: unbekannt = sofort 429 ohne Hash, bekannt = 401
    // nach dem Hash. Was `BENUTZERNAME_REGEX` nicht erfuellt, kann kein Konto
    // sein und bekommt einen festen Schluessel statt ungekuerzt (bis zu 4 KB)
    // in der Karte zu stehen (U2). Das Abklappern vieler Namen deckelt der
    // Herkunftszaehler.
    const versuchsSchluessel = `${ip}|${konto ? konto.id : unbekannterNameSchluessel(benutzername)}`;
    // Herkunftsgrenze auch NACH dem Lesen des Koerpers: viele offene Anfragen mit
    // verzoegertem Koerper haben die fruehe Pruefung sonst alle bestanden.
    if (this.herkunftGesperrt(ip) || this.loginVersuchGesperrt(versuchsSchluessel)) {
      return this.json(res, 429, { error: 'too-many-attempts' });
    }
    this.loginVersuchZaehlen(versuchsSchluessel, ip);
    // Die Generation VOR dem Hashen: Nur ein Passwortwechsel (oder "ueberall
    // abmelden") zaehlt sie hoch, das Hash-Upgrade eines gleichzeitigen Logins
    // nicht. Verglichen wird nach dem letzten await nur diese Zahl, nicht der
    // ganze Passwort-Eintrag — sonst bekaeme von vier gleichzeitigen, richtigen
    // Logins nach einer Parameteraenderung nur einer ein Token.
    const generationVorher = konto ? this.db.tokenAbVon(konto.id) : null;
    const ueberallAbmelden = k.logoutOthers === true;

    // Always run the (expensive) check, even when the account does not
    // exist: otherwise the response time tells an attacker which
    // usernames are real.
    const eintrag = konto?.passwort
      ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const stimmt = await passwortPruefen(passwort, eintrag);
    await this.testHaken.nachLoginPruefung?.();

    if (!konto || !stimmt) {
      // One message for both cases — "unknown user" would be an oracle.
      return this.json(res, 401, { error: 'login-failed' });
    }

    // Erfolg: nur der Schluessel dieses Kontos faellt weg, der Herkunftszaehler
    // bekommt seinen Versuch zurueck (ein Erfolg verbraucht kein Budget), wird
    // aber nie auf null gesetzt.
    this.loginVersuche.delete(versuchsSchluessel);
    this.herkunftErstatten(ip);
    // Ein gemeinsames Ausprobier-Konto kennt jeder; "ueberall abmelden" darf dort
    // nicht dazu taugen, allen anderen die Sitzung zu nehmen.
    if (ueberallAbmelden && this.istGeschuetzt(konto.benutzername)) {
      return this.json(res, 403, { error: 'standard-account' });
    }
    // Raise the cost on the fly: this is the only moment the plain
    // password is available to write a stronger record with.
    if (veraltet(eintrag)) {
      const neu = await passwortEinlagern(passwort);
      this.db.passwortErsetzen(konto.id, neu, eintrag);
    }

    // Erst JETZT, nach dem letzten await, ohne weiteren dazwischen: Hat sich
    // das Passwort waehrend des Hashens geaendert (Passwortwechsel), gilt das
    // Ergebnis der Pruefung nicht mehr — sonst bekaeme ein Login mit dem
    // ALTEN Passwort ein Token, das den Wechsel ueberlebt. Die Generation
    // wird hier gelesen und ins Token geschrieben, im selben Zug.
    let generation = this.db.tokenAbVon(konto.id);
    if (generation === null) {
      return this.json(res, 401, { error: 'login-failed' });
    }
    if (generation !== generationVorher) {
      // Das Passwort war richtig, aber waehrend des Hashens hat ein
      // gleichzeitiger Wechsel (oder eine Rettung) die Generation
      // hochgezaehlt. Ein eigener Schluessel statt "login-failed" (N3):
      // die Seite kann dem Nutzer "nochmal versuchen" sagen statt
      // "falsches Passwort".
      return this.json(res, 409, { error: 'conflict' });
    }
    if (ueberallAbmelden) {
      // Rettungsweg: mit dem RICHTIGEN Passwort alle bisherigen Sitzungen
      // beenden (auch die eines Tokendiebs), ohne dass die Konto-Sperre der
      // Passwortbestaetigung im Weg steht — die kann ein Dieb dem Besitzer
      // sonst dauerhaft zudrehen. Der Login selbst ist ueber die Herkunft
      // gedrosselt.
      const neu = this.db.alleAbmelden(konto.id);
      if (!neu) return this.json(res, 401, { error: 'login-failed' });
      generation = neu.generation;
      this.kontoFehlversuche.delete(konto.id);
      // Auch die Bestaetigungssperren dieses Kontos (je Herkunft): das Token des
      // Diebs, gegen das sie gedacht waren, ist damit ohnehin tot.
      for (const schluessel of [...this.bestaetigungen.keys()]) {
        if (schluessel.endsWith(`|${konto.id}`)) this.bestaetigungen.delete(schluessel);
      }
      try {
        this.haken.spielerTrennen?.(this.db.charaktereVonKonto(konto.id).map((c) => c.spielerId));
      } catch (e) {
        console.error(`[Konto] Trennen der Spiele von Konto ${konto.id} fehlgeschlagen:`, e);
      }
    }

    this.json(res, 200, {
      token: this.kontoTokenAusstellen(konto.id, generation),
      account: { username: konto.benutzername, email: konto.email },
      characters: this.db.charaktereVonKonto(konto.id).map(nachAussen),
      avatar: this.db.avatarVon(konto.id),
      profile: this.db.profilTextVon(konto.id),
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
      avatar: this.db.avatarVon(kontoId),
      profile: this.db.profilTextVon(kontoId),
      manageable: !this.istGeschuetzt(konto.benutzername),
    });
  }

  /**
   * Das Token gilt NACH dem Lesen des Koerpers noch? Der Koerper kann langsam
   * kommen (bis zum requestTimeout); in der Zwischenzeit kann eine Rettung
   * ("ueberall abmelden") oder ein Passwortwechsel das Token beendet haben.
   * Ohne diese zweite Pruefung schriebe ein davor begonnener Aufruf noch.
   */
  private nochAngemeldet(req: IncomingMessage, kontoId: number): boolean {
    return this.kontoAus(req) === kontoId;
  }

  private async charakterAnlegen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    if (!this.nochAngemeldet(req, kontoId)) return this.json(res, 401, { error: 'not-signed-in' });

    const name = String(k.name ?? '').trim();
    if (!CHARAKTERNAME_REGEX.test(name)) return this.json(res, 400, { error: 'name-invalid' });
    // M1 (W3-Reste-Pruefung, Opus, 28.09.2026): CHARAKTERNAME_REGEX laesst
    // Hangul-Fuellzeichen durch (sie gehoeren zu \p{Lo}), und namenSchluessel
    // entfernt sie nicht. Damit liesse sich "Editor" (und jeder andere Name)
    // unsichtbar verlaengern. Das Spiel selbst sperrt genau diese Zeichen
    // ueber `nameHatSteuerzeichen` (server/src/net/Namen.ts, NetManager.ts);
    // hier gilt dieselbe Regel.
    if (nameHatSteuerzeichen(name)) return this.json(res, 400, { error: 'name-invalid' });
    // Derselbe Namensvergleich wie im Spiel (Namen.ts): "Editor" ist der vom
    // Server fest vergebene Name jeder Editor-Verbindung, nie aus dem Client.
    // Ein Charakter mit diesem Namen (auch Gross/Klein oder eine unsichtbar
    // erweiterte Schreibweise) waere im Spiel damit ununterscheidbar.
    if (namenSchluessel(name) === namenSchluessel(EDITOR_NAME)) {
      return this.json(res, 409, { error: 'name-taken' });
    }

    const figur = String(k.figure ?? '');
    const klasse = k.classId ?? '';
    if (klasse !== '' && !isCharacterClass(klasse)) {
      return this.json(res, 400, { error: 'class-invalid' });
    }
    const frisur = String(k.hairstyle ?? '');
    const haarfarbe = String(k.hairColor ?? '');
    // Fehlendes Feld bleibt waehrend des gemeinsamen Rollouts kompatibel
    // mit einem noch offenen Erstellungsformular vom vorherigen Stand.
    const augenfarbe = String(k.eyeColor ?? AUGENFARBE_VORGABE);
    const ober = String(k.top ?? '');
    const beine = String(k.legs ?? '');
    if (!istFigur(figur) || !istFrisur(frisur) || !istHaarfarbe(haarfarbe) ||
        !istAugenfarbe(augenfarbe) || !istRuestung(ober) || !istRuestung(beine)) {
      return this.json(res, 400, { error: 'appearance-invalid' });
    }

    // Wire field -> database column. The two vocabularies are separate on
    // purpose: the columns in `Kontendatenbank.ts` still read `figur`,
    // `frisur`, `ober`, `beine` because renaming them would be an ALTER
    // TABLE on live data, not a rename. The translation lives here and in
    // `nachAussen()` below — those two are the only places that know both.
    const r = this.db.charakterAnlegen(kontoId, name, {
      figur,
      frisur,
      haarfarbe,
      augenfarbe,
      klasse: String(klasse),
      ober,
      beine,
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
   * Ein Charakter OHNE Anmeldung — Name und Aussehen, sonst nichts.
   *
   * Der Zweck ist der Avatar und das oeffentliche Reckenprofil: Das Thing
   * zeigt den Charakter eines Beitrags, die Ruestkammer spaeter dasselbe.
   * `nachAussen` gibt nur weiter, was ohnehin oeffentlich ist (Name,
   * Aussehen, Zeitstempel) — keine Konto-Id, keine spielerId.
   */
  private charakterOeffentlich(res: ServerResponse, id: number): void {
    const c = this.db.charakterNachId(id);
    if (!c) return this.json(res, 404, { error: 'unknown' });
    // Der Profiltext gehoert zum KONTO, erscheint aber nur beim Avatar-
    // Recken: wuerde er an jedem Charakter haengen, verriete der gleiche
    // Text, welche Charaktere derselben Person gehoeren.
    const profil = this.db.avatarVon(c.kontoId) === c.id ? this.db.profilTextVon(c.kontoId) : '';
    // Fuer FREMDE Aufrufer gerundet: `lastPlayed` und `created` auf volle TAGE (dieser Weg hat weder Puffer noch Drossel;
    // im Sekundentakt abgefragt, verriete eine Stundenrundung den ersten Spielbeginn je Stunde; die Webseite zeigt nur das Datum).
    // Dem Besitzer liefern `/accounts/me` und die Konto-Wege weiter die genauen Werte.
    this.json(res, 200, {
      character: {
        ...nachAussen(c), created: aufTag(c.erstellt), lastPlayed: c.zuletztGespielt === null ? null : aufTag(c.zuletztGespielt), profile: profil,
      },
    });
  }

  /**
   * Ruestkammer, Liste: `GET /accounts/armory?seite=&q=`, ohne Anmeldung.
   * Was in der Antwort steht und was nie, regelt `Armory.ts` (Positivliste).
   */
  private armoryListe(req: IncomingMessage, res: ServerResponse): void {
    if (!this.armory.erlaubt(this.herkunft(req))) return this.json(res, 429, { error: 'rate-limited' });
    const abfrage = new URL(req.url ?? '/', 'http://x').searchParams;
    const liste = this.armory.liste(abfrage.get('seite'), abfrage.get('q'));
    if (!liste) return this.json(res, 503, { error: 'warming-up' }); // der erste Speicherstand wird gerade gebaut
    this.json(res, 200, liste);
  }

  /** Ruestkammer, Profil: 404 fuer unbekannte, geloeschte, gebannte und Standardkonto-Charaktere. */
  private armoryEinzeln(req: IncomingMessage, res: ServerResponse, id: number): void {
    if (!this.armory.erlaubt(this.herkunft(req))) return this.json(res, 429, { error: 'rate-limited' });
    const profil = this.armory.profil(id);
    if (!profil) return this.json(res, 404, { error: 'unknown' });
    this.json(res, 200, profil);
  }

  /**
   * Setzt den Avatar des Kontos (Das Thing, M4). Angemeldet noetig; der
   * Charakter muss DEM Konto gehoeren (`charakterVonKonto`), sonst 404.
   * `characterId: null` loescht die Wahl.
   */
  private async avatarSetzen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });

    // Standardkonten: ihr Passwort ist oeffentlich, ihr Avatar darf nicht jedem gehoeren.
    if (this.kontoGeschuetzt(kontoId)) return this.json(res, 403, { error: 'standard-account' });

    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    if (!this.nochAngemeldet(req, kontoId)) return this.json(res, 401, { error: 'not-signed-in' });

    if (k.characterId === null || k.characterId === undefined || k.characterId === '') {
      this.db.avatarSetzen(kontoId, null);
      return this.json(res, 200, { avatar: null });
    }

    const id = Number(k.characterId);
    if (!Number.isInteger(id) || id <= 0) return this.json(res, 400, { error: 'character-invalid' });

    const c = this.db.charakterVonKonto(kontoId, id);
    if (!c) return this.json(res, 404, { error: 'unknown' });

    this.db.avatarSetzen(kontoId, id);
    this.json(res, 200, { avatar: id });
  }


  // ── Konto-Verwaltung (W3) ───────────────────────────────────────────

  private istGeschuetzt(benutzername: string): boolean {
    const n = benutzername.toLowerCase();
    return this.geschuetzteNamen.some((g) => g.toLowerCase() === n)
      || this.standardKontoNamen.some((g) => g.toLowerCase() === n);
  }

  private kontoGeschuetzt(kontoId: number): boolean {
    const k = this.db.kontoNachId(kontoId);
    return k !== null && this.istGeschuetzt(k.benutzername);
  }

  /** Profiltext: reiner Text nach `bereinigeText`, hoechstens PROFILTEXT_MAX Zeichen. */
  private async profilSetzen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });
    if (this.kontoGeschuetzt(kontoId)) return this.json(res, 403, { error: 'standard-account' });
    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    if (!this.nochAngemeldet(req, kontoId)) return this.json(res, 401, { error: 'not-signed-in' });
    const text = typeof k.text === 'string' ? bereinigeText(k.text, PROFILTEXT_MAX) : null;
    if (text === null) return this.json(res, 400, { error: 'profile-invalid' });
    this.db.profilTextSetzen(kontoId, text);
    this.json(res, 200, { profile: text });
  }

  /** Meldung gegen den Profiltext des Kontos hinter einem Charakter. */
  private async profilMelden(req: IncomingMessage, res: ServerResponse, charakterId: number): Promise<void> {
    const kontoId = this.kontoAus(req);
    if (kontoId === null) return this.json(res, 401, { error: 'not-signed-in' });
    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    if (!this.nochAngemeldet(req, kontoId)) return this.json(res, 401, { error: 'not-signed-in' });
    const grund = typeof k.reason === 'string' ? bereinigeText(k.reason, 200) : '';
    if (grund === null) return this.json(res, 400, { error: 'reason-invalid' });
    const r = this.db.profilMelden(kontoId, charakterId, grund);
    if (!r.ok) return this.json(res, 404, { error: 'unknown' });
    this.json(res, 201, { ok: true });
  }

  /**
   * Gemeinsamer Vorspann der drei Aenderungen, die das aktuelle Passwort
   * verlangen (E-Mail, Passwort, Loeschung). Liefert das Konto samt dem
   * Passwort-Eintrag, gegen den GEPRUEFT wurde — die Aufrufer schreiben nur
   * mit Bedingung auf genau diesen Eintrag zurueck.
   *
   * Der Fehlversuch wird VOR dem (teuren, awaiteten) Hashen gezaehlt und bei
   * Erfolg zurueckgenommen. Wuerde erst nach dem await gezaehlt, koennte ein
   * Angreifer beliebig viele Versuche gleichzeitig starten, die alle die
   * Sperre noch offen sehen. Gezaehlt wird je Herkunft UND je Konto (ein
   * gestohlenes Token kommt von jeder Adresse).
   */
  private async passwortBestaetigen(
    req: IncomingMessage, res: ServerResponse, k: Record<string, unknown>, feld: string,
    konto: { id: number; passwort: string },
  ): Promise<boolean> {
    const schluessel = `${this.herkunft(req)}|${konto.id}`;
    if (this.bestaetigungGesperrt(schluessel) || this.kontoGesperrt(konto.id)) {
      this.json(res, 429, { error: 'too-many-attempts' });
      return false;
    }
    this.bestaetigungZaehlen(schluessel);
    this.kontoFehlversuchZaehlen(konto.id);
    const stimmt = await passwortPruefen(String(k[feld] ?? ''), konto.passwort);
    await this.testHaken.nachBestaetigung?.();
    if (!stimmt) {
      this.json(res, 401, { error: 'password-wrong' });
      return false;
    }
    // Nur die Zaehler DIESES Kontos, nie die einer Adresse fuer andere Konten.
    this.bestaetigungen.delete(schluessel);
    this.kontoFehlversuche.delete(konto.id);
    return true;
  }

  /** Konto fuer eine Aenderung laden: 401 ohne Anmeldung, 403 bei Standardkonten. */
  private kontoFuerAenderung(req: IncomingMessage, res: ServerResponse) {
    const kontoId = this.kontoAus(req);
    const konto = kontoId === null ? null : this.db.kontoMitPasswort(kontoId);
    if (!konto) { this.json(res, 401, { error: 'not-signed-in' }); return null; }
    if (this.istGeschuetzt(konto.benutzername)) {
      this.json(res, 403, { error: 'standard-account' });
      return null;
    }
    return konto;
  }

  private async emailAendern(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const konto = this.kontoFuerAenderung(req, res);
    if (!konto) return;
    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    const email = String(k.email ?? '').trim();
    const mangel = pruefeEmail(email);
    if (mangel) return this.json(res, 400, { error: mangel });
    if (!(await this.passwortBestaetigen(req, res, k, 'currentPassword', konto))) return;

    if (!this.db.emailSetzen(konto.id, email, konto.passwort)) {
      return this.json(res, 409, { error: 'conflict' });
    }
    this.json(res, 200, { account: { username: konto.benutzername, email } });
  }

  /**
   * Passwort aendern und alle ANDEREN Anmeldungen beenden.
   *
   * Die Token sind zustandslos; beendet wird ueber die Generation
   * `konten.token_ab` (jedes Konto-Token traegt seine, `g`). Die aufrufende
   * Sitzung bekommt ein Token der neuen Generation zurueck. Spieler-Token
   * aus /play prueft der Handshake gegen `konten.spieler_ab`.
   */
  private async passwortAendern(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const konto = this.kontoFuerAenderung(req, res);
    if (!konto) return;
    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    const neu = String(k.newPassword ?? '');
    const mangel = pruefePasswort(neu);
    if (mangel) return this.json(res, 400, { error: mangel });
    if (!(await this.passwortBestaetigen(req, res, k, 'currentPassword', konto))) return;

    const eintrag = await passwortEinlagern(neu);
    const wechsel = this.db.passwortWechseln(konto.id, eintrag, konto.passwort);
    if (!wechsel) return this.json(res, 409, { error: 'conflict' });
    console.log(`[Konto] Passwort gewechselt: Konto ${konto.id}`);
    // Spieler-Token aus /play sind damit ueber `spieler_ab` ungueltig
    // (Kontendatenbank.bannFuerZugang); laufende Verbindungen trennen wir hier.
    try {
      this.haken.spielerTrennen?.(this.db.charaktereVonKonto(konto.id).map((c) => c.spielerId));
    } catch (e) {
      console.error(`[Konto] Trennen der Spiele von Konto ${konto.id} fehlgeschlagen:`, e);
    }
    this.json(res, 200, { token: this.kontoTokenAusstellen(konto.id, wechsel.generation) });
  }

  /**
   * Konto loeschen: Passwort UND der eigene Benutzername als Bestaetigung.
   *
   * Nach dem await laeuft alles synchron in einem Zug (Loeschung, Haken):
   * ein gleichzeitiger `play`-Aufruf sieht das Konto entweder ganz oder gar
   * nicht mehr, und ein davor abgeholtes Spieler-Token ist ueber
   * `geloeschte_spieler` wertlos (Kontendatenbank.bannFuerZugang).
   */
  private async kontoLoeschen(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const konto = this.kontoFuerAenderung(req, res);
    if (!konto) return;
    const k = await this.koerper(req);
    if (!k) return this.json(res, 400, { error: 'malformed-body' });
    if (String(k.confirm ?? '').trim().toLowerCase() !== konto.benutzername.toLowerCase()) {
      return this.json(res, 400, { error: 'confirm-mismatch' });
    }
    if (!(await this.passwortBestaetigen(req, res, k, 'password', konto))) return;

    const weg = this.db.kontoLoeschen(konto.id, konto.passwort);
    if (!weg) return this.json(res, 409, { error: 'conflict' });
    console.log(`[Konto] geloescht: Konto ${weg.kontoId} mit ${weg.charaktere.length} Charakteren`);
    this.kontoFehlversuche.delete(konto.id);

    // Welt zuerst: dort muss der Spieler raus, bevor irgendetwas anderes
    // ihn noch einmal in savedPlayers schreibt.
    try { this.haken.weltBereinigen?.(weg); } catch (e) {
      console.error(`[Konto] Welt-Bereinigung fuer Konto ${weg.kontoId} fehlgeschlagen:`, e);
    }
    this.forumAuftraegeAbarbeiten();
    this.json(res, 200, { ok: true });
  }

  /**
   * Offene Forum-Bereinigungen ausfuehren. Beim Start aufrufen (holt nach,
   * was ein Abbruch liegen liess) und nach jeder Loeschung.
   */
  forumAuftraegeAbarbeiten(): void {
    for (const a of this.db.forumAuftraege()) {
      try {
        this.haken.forumBereinigen?.(a);
        if (this.haken.forumBereinigen) this.db.forumAuftragErledigt(a.kontoId);
      } catch (e) {
        console.error(`[Konto] Forum-Bereinigung fuer Konto ${a.kontoId} fehlgeschlagen (wird beim Start wiederholt):`, e);
      }
    }
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
    // Nie vor `spieler_ab` des Kontos ausgestellt, auch wenn die Uhr nach
    // einem Passwortwechsel zurueckgesprungen ist (s. bannFuerZugang).
    const ab = this.db.spielerAbZuSpielerId(c.spielerId) ?? 0;
    this.json(res, 200, {
      sessionToken: tokenAusstellen(
        c.spielerId, c.altlastUserId, this.sessionSecret, undefined, Math.max(Date.now(), ab + 1),
      ),
      character: nachAussen(c),
    });
  }

  // ── Account tokens ──────────────────────────────────────────────────

  private kontoTokenAusstellen(kontoId: number, generation: number): string {
    const jetzt = Date.now();
    const payload: KontoTokenPayload = { k: kontoId, i: jetzt, e: jetzt + KONTO_TOKEN_GUELTIG_MS, g: generation };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.kontoSchluessel).update(b64).digest('base64url');
    return `${b64}.${sig}`;
  }

  /**
   * Konto-Id aus dem Token dieser Anfrage, oder null — fuer den FORUM-Dienst.
   *
   * Eine duenne, oeffentliche Huelle um `kontoAus`: Der Token-Aufbau bleibt
   * genau hier (eine Quelle), das Forum fragt nur. So gibt es keinen
   * zweiten Ort, an dem die Signaturpruefung nachgebaut und irgendwann
   * falsch nachgebaut werden koennte.
   */
  kontoIdAus(req: IncomingMessage): number | null {
    return this.kontoAus(req);
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
      // Das Konto muss noch existieren, und das Token muss unter der
      // AKTUELLEN Generation ausgestellt sein (`konten.token_ab`); Token
      // ohne `g` stammen von vor der Verwaltung und zaehlen als Generation 0.
      const generation = this.db.tokenAbVon(p.k);
      const g = p.g === undefined ? 0 : p.g;
      if (generation === null || typeof g !== 'number' || g !== generation) return null;
      return p.k;
    } catch { return null; }
  }

  // ── Plumbing ────────────────────────────────────────────────────────

  private herkunft(req: IncomingMessage): string {
    // Auf das /64-Praefix gekuerzt (N5): sonst zaehlt jede IPv6-Adresse
    // eines Anschlusses fuer sich, siehe herkunftSchluessel() oben.
    return herkunftSchluessel(herkunftErmitteln(req));
  }

  /**
   * Abgelaufene Eintraege aus den Zaehlkarten entfernen, hoechstens alle fuenf
   * Minuten. Ohne das wuechsen die Karten mit jedem je gesehenen Schluessel;
   * die Zaehlung selbst lief schon ohne diesen Durchlauf korrekt ab.
   */
  private naechsteAufraeumung = 0;
  private abgelaufenesAufraeumen(): void {
    const jetzt = Date.now();
    if (jetzt < this.naechsteAufraeumung) return;
    this.naechsteAufraeumung = jetzt + 5 * 60 * 1000;
    for (const karte of [this.fehlversuche, this.loginVersuche, this.bestaetigungen]) {
      for (const [schluessel, e] of karte) if (jetzt > e.bis) karte.delete(schluessel);
    }
  }

  private herkunftGesperrt(ip: string): boolean {
    const e = this.fehlversuche.get(ip);
    if (!e) return false;
    if (Date.now() > e.bis) { this.fehlversuche.delete(ip); return false; }
    return e.anzahl >= LOGIN_HERKUNFT_MAX;
  }

  private loginVersuchGesperrt(schluessel: string): boolean {
    const e = this.loginVersuche.get(schluessel);
    if (!e) return false;
    if (Date.now() > e.bis) { this.loginVersuche.delete(schluessel); return false; }
    return e.anzahl >= FEHLVERSUCHE_MAX;
  }

  /** Ein Login-Versuch: je (Herkunft, Konto) UND je Herkunft. */
  private loginVersuchZaehlen(schluessel: string, ip: string): void {
    this.abgelaufenesAufraeumen();
    const jetzt = Date.now();
    const k = this.loginVersuche.get(schluessel);
    if (!k || jetzt > k.bis) {
      this.loginVersuche.set(schluessel, { anzahl: 1, bis: jetzt + FEHLVERSUCHE_FENSTER_MS });
    } else {
      k.anzahl++;
    }
    const h = this.fehlversuche.get(ip);
    if (!h || jetzt > h.bis) {
      this.fehlversuche.set(ip, { anzahl: 1, bis: jetzt + FEHLVERSUCHE_FENSTER_MS });
    } else {
      h.anzahl++;
    }
  }

  /** Ein erfolgreicher Login gibt seinen Versuch am Herkunftszaehler zurueck (nie unter null). */
  private herkunftErstatten(ip: string): void {
    const h = this.fehlversuche.get(ip);
    if (h && h.anzahl > 0) h.anzahl--;
  }

  private bestaetigungGesperrt(schluessel: string): boolean {
    const e = this.bestaetigungen.get(schluessel);
    if (!e) return false;
    if (Date.now() > e.bis) { this.bestaetigungen.delete(schluessel); return false; }
    return e.anzahl >= FEHLVERSUCHE_MAX;
  }

  private bestaetigungZaehlen(schluessel: string): void {
    const jetzt = Date.now();
    const e = this.bestaetigungen.get(schluessel);
    if (!e || jetzt > e.bis) {
      this.bestaetigungen.set(schluessel, { anzahl: 1, bis: jetzt + FEHLVERSUCHE_FENSTER_MS });
    } else {
      e.anzahl++;
    }
  }

  private kontoGesperrt(kontoId: number): boolean {
    const e = this.kontoFehlversuche.get(kontoId);
    if (!e) return false;
    if (Date.now() > e.bis) { this.kontoFehlversuche.delete(kontoId); return false; }
    return e.anzahl >= KONTO_FEHLVERSUCHE_MAX;
  }

  private kontoFehlversuchZaehlen(kontoId: number): void {
    const jetzt = Date.now();
    const e = this.kontoFehlversuche.get(kontoId);
    if (!e || jetzt > e.bis) {
      this.kontoFehlversuche.set(kontoId, { anzahl: 1, bis: jetzt + FEHLVERSUCHE_FENSTER_MS });
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

/** Kommt die Verbindung selbst (Socket-Peer, nicht ein Kopf) von Loopback? */
export function istLoopbackPeer(req: IncomingMessage): boolean {
  const peer = (req.socket?.remoteAddress ?? '').toLowerCase();
  return peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
}

/**
 * Gibt es im ROHEN Pfad einer Anfrage etwas, das ein Vorschalter anders deutet als `new URL`?
 *
 * Die WHATWG-URL behandelt `\` wie `/` und loest `.`/`..` auch in der Form `%2e` auf; nginx tut beides nicht
 * (sein `location` waehlt nach dem Text). Wer so einen Pfad schickt, kann eine Sperre im Vorschalter umgehen
 * (`/accounts/x\..\armory`). Deshalb: kein Rueckwaertsstrich, kein `.`/`..`-Segment (roh oder prozentkodiert),
 * kein Steuerzeichen, keine kaputte Prozentfolge, genau ein fuehrender Schraegstrich, roher gleich geparster Pfad.
 * Gilt fuer ALLE Wege der KontoApi. Die absolute Form
 * (`http://host/pfad`) wird auf ihren Pfad gekuerzt.
 */
export function rohPfadUnzulaessig(url: string): boolean {
  let pfad = url;
  const absolut = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(pfad);
  if (absolut) pfad = pfad.slice(absolut[0].length);
  pfad = pfad.split(/[?#]/, 1)[0];
  // Genau EIN fuehrender Schraegstrich: `//accounts/accounts/armory` macht `new URL` zu Host `accounts` und Pfad
  // `/accounts/armory`, nginx fasst `//` zusammen und waehlt eine ganz andere location (`/accounts/`, `/ws`).
  if (!pfad.startsWith('/') || pfad.startsWith('//')) return true;
  // Der rohe Pfad muss dem geparsten gleichen: jede Abweichung (Host-Deutung, Normalisierung, Kodierung) ist eine
  // Stelle, an der ein Vorschalter und dieser Server verschiedene Wege sehen.
  let geparst: string;
  try { geparst = new URL(url, 'http://x').pathname; } catch { return true; }
  if (geparst !== pfad) return true;
  if (pfad.includes('\\')) return true;
  let dekodiert: string;
  try { dekodiert = decodeURIComponent(pfad); } catch { return true; }
  if (dekodiert.includes('\\') || /[\u0000-\u001f\u007f]/.test(dekodiert)) return true;
  return dekodiert.split('/').some((s) => s === '.' || s === '..');
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
    eyeColor: c.augenfarbe,
    classId: c.klasse,
    top: c.ober, legs: c.beine,
    created: c.erstellt, lastPlayed: c.zuletztGespielt,
  };
}

/**
 * Zeichen, die in Buchstaben-/Symbolkategorien stehen, aber unsichtbar sind
 * oder wie Leerraum wirken (Fuellzeichen, Braille-Leer, khmerische
 * Eigenvokale, CGJ). Die Positivregel unten laesst sie sonst durch.
 */
const UNSICHTBAR = new Set([
  0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800, 0x3164, 0xffa0,
]);
const ERLAUBTES_ZEICHEN = /^[\p{L}\p{M}\p{N}\p{P}\p{S} \n]$/u;
const KOMBINIEREND = /^\p{M}$/u;
/** Variantenselektoren: nur direkt hinter einem Emoji- oder CJK-/mongolischen Zeichen sinnvoll. */
const VARIANTENSELEKTOR = /^[\uFE00-\uFE0F\u180B-\u180D\u{E0100}-\u{E01EF}]$/u;
const TRAEGT_SELEKTOR = /^[\p{Emoji}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Mongolian}]$/u;
/**
 * `\p{Emoji}` umfasst auch ASCII-Ziffern, `#` und `*` (Keycap-Basen). Ohne
 * diese Ausnahme liesse TRAEGT_SELEKTOR einen Variantenselektor hinter
 * IRGENDEINER dieser Basen durch, auch OHNE die anschliessende Einfassung
 * U+20E3 \u2014 also ein unsichtbares Anhaengsel hinter jeder Ziffer, `#` oder
 * `*` (N6). Nur eine ECHTE Keycap-Folge (Basis + Selektor + U+20E3) bleibt
 * erlaubt.
 */
const KEYCAP_BASIS = /^[0-9#*]$/;
const KEYCAP_EINFASSUNG = '\u20E3';
/** Hangul-Jamo (Anfangs-, Mittel-, Endlaut): NFC macht daraus Silben, uebrig bleibt nur Unfug. */
const JAMO = /^[\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]$/u;

/** Hoechstens so viele kombinierende Zeichen hintereinander (gegen "Zalgo"). */
const KOMBINIEREND_MAX = 2;
const JAMO_MAX = 3;
const ZEILENUMBRUECHE_MAX = 5;
/** Deckel in Codepunkten je erlaubtem Graphem-Cluster: kein Text laesst sich hinter wenigen Clustern verstecken. */
const CODEPUNKTE_JE_GRAPHEM = 4;

/**
 * Reiner Text nach einer POSITIVREGEL: Nach NFC und Vereinheitlichung der
 * Zeilenenden ist erlaubt, was Buchstabe, Zeichen, Zahl, Satzzeichen oder
 * Symbol ist, dazu das Leerzeichen und der Zeilenumbruch. Alles andere
 * (Steuer-, Format-, Richtungs-, Tag-Zeichen, einzelne Surrogate, private
 * Zeichen, Tabulator, Zeilentrenner) wird abgelehnt, ebenso unsichtbare
 * Fuellzeichen. Hoechstens `KOMBINIEREND_MAX` kombinierende Zeichen in Folge
 * und `ZEILENUMBRUECHE_MAX` Umbrueche. Die Laenge zaehlt Graphem-Cluster
 * (`Intl.Segmenter`), was eine Nutzerin als "ein Zeichen" sieht.
 *
 * Gibt den bereinigten Text zurueck oder null bei einem Verstoss. Die
 * Ausgabe des Textes ist Sache des Aufrufers: er wird roh gespeichert und
 * darf nie als HTML oder Markdown gerendert werden.
 */
export function bereinigeText(roh: string, maxGrapheme: number): string | null {
  const text = roh.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  // Grosszuegige Obergrenze vor der Zeichenpruefung, gegen aufwaendige Eingaben.
  if (text.length > maxGrapheme * CODEPUNKTE_JE_GRAPHEM * 2) return null;
  let umbrueche = 0;
  let marken = 0;
  let jamo = 0;
  let codepunkte = 0;
  let vorher: string | null = null;
  // Array statt for-of, damit der Keycap-Fall (N6) den NAECHSTEN Codepunkt
  // ansehen kann, ohne den Iterator anzufassen.
  const zeichenListe = [...text];
  for (let i = 0; i < zeichenListe.length; i++) {
    const zeichen = zeichenListe[i]!;
    const cp = zeichen.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return null;
    if (UNSICHTBAR.has(cp) || !ERLAUBTES_ZEICHEN.test(zeichen)) return null;
    if (++codepunkte > maxGrapheme * CODEPUNKTE_JE_GRAPHEM) return null;
    if (zeichen === '\n') { if (++umbrueche > ZEILENUMBRUECHE_MAX) return null; }
    if (KOMBINIEREND.test(zeichen)) {
      // Ein kombinierendes Zeichen braucht ein Basiszeichen davor (nicht Anfang,
      // Leerzeichen, Zeilenumbruch); Variantenselektoren nur hinter Emoji/CJK.
      if (vorher === null || vorher === ' ' || vorher === '\n') return null;
      if (VARIANTENSELEKTOR.test(zeichen)) {
        if (!TRAEGT_SELEKTOR.test(vorher) && !KOMBINIEREND.test(vorher)) return null;
        // Ziffer/#/* zaehlen nur als Keycap-Basis, wenn WIRKLICH eine
        // Keycap-Folge daraus wird (Basis + Selektor + U+20E3, N6) — sonst
        // waere jede Ziffer im Profiltext ein unsichtbares Versteck.
        if (KEYCAP_BASIS.test(vorher) && zeichenListe[i + 1] !== KEYCAP_EINFASSUNG) return null;
      }
      if (++marken > KOMBINIEREND_MAX) return null;
    } else marken = 0;
    if (JAMO.test(zeichen)) { if (++jamo > JAMO_MAX) return null; } else jamo = 0;
    vorher = zeichen;
  }
  let grapheme = 0;
  for (const _ of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)) {
    void _;
    if (++grapheme > maxGrapheme) return null;
  }
  return text;
}

/** Deliberately loose: the address is never verified. */
export function pruefeEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'email-invalid';
  return null;
}

export function pruefePasswort(passwort: string): string | null {
  if (passwort.length < 8 || passwort.length > 200) return 'password-too-short';
  return null;
}

/** Returns an error key, or null when the input is acceptable. */
export function pruefeAnmeldedaten(
  benutzername: string, email: string, passwort: string,
): string | null {
  if (!BENUTZERNAME_REGEX.test(benutzername)) return 'username-invalid';
  return pruefeEmail(email) ?? pruefePasswort(passwort);
}

export type { SpielerId };
