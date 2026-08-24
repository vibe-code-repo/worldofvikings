/**
 * Accounts and characters — the browser half of `/accounts`.
 *
 * ── Why this is a module and not four copies of `fetch` ───────────────
 * Four pages talk to the same API: `/registrieren`, `/anmelden`, `/konto`
 * and `/erstellen`. Each of them has to attach the same bearer token, read
 * the same error keys and pick the same shore. Written four times, the day
 * one of them forgets `Authorization` is the day a page silently behaves as
 * "logged out" for reasons nobody can find.
 *
 * ── One account per shore, never a shared one ─────────────────────────
 * `server/src/konto/Kontendatenbank.ts` keeps one SQLite file per realm, so
 * an account on the test shore does not exist on Midgard. The token is
 * therefore stored under a per-shore key. A single "current token" would
 * turn a shore switch into a wrong login instead of no login.
 *
 * ── Why localStorage and not a cookie ─────────────────────────────────
 * A cookie could not be `httpOnly` here: no server runs on the www origin
 * that could set it (adapter-static, nginx serves files). It would be read
 * and written by script exactly like localStorage, and the API wants the
 * token in an `Authorization` header anyway — nothing is sent automatically.
 * What localStorage buys over sessionStorage is the 30 days the server
 * actually grants (`KONTO_TOKEN_GUELTIG_MS`); sessionStorage would throw
 * that away when the tab closes.
 *
 * The known limit: any script on the origin can read it, so an XSS would
 * leak it. The defence is the CSP (`script-src 'self'`, hash mode, no
 * `unsafe-inline` for scripts) that keeps foreign script out in the first
 * place. That is an observation about the existing policy, not a new one.
 *
 * ── What never travels through the address ────────────────────────────
 * Passwords are posted in a request body and are never stored. The session
 * ticket from `/spielen` goes into the address FRAGMENT (`#ticket=`), which
 * no browser sends to any server — see `playUrl`.
 */
import type { MessageKey } from './i18n';

/* ------------------------------------------------------------- shores */

export type ShoreId = 'dev' | 'live';

/**
 * Where each shore lives.
 *
 * Both hosts are already listed in `connect-src` in `svelte.config.js`;
 * a third one would need an entry there too, or the browser blocks it.
 */
export const SHORES: Record<ShoreId, { url: string }> = {
  dev: { url: 'https://play.dev.world-of-vikings.com' },
  live: { url: 'https://play.world-of-vikings.com' },
};

/** Display order: the test shore first, because it is the default. */
export const SHORE_IDS: ShoreId[] = ['dev', 'live'];

/**
 * How a shore is named in the picker.
 *
 * These are the keys `/erstellen` already used before there were accounts.
 * Reused rather than duplicated: a second pair of keys would be a second
 * place to translate, and the two names would drift apart on the first edit.
 */
export const SHORE_LABEL: Record<ShoreId, MessageKey> = {
  dev: 'erstellen.fahrt.gestade.dev',
  live: 'erstellen.fahrt.gestade.live',
};

export function isShore(v: string | null | undefined): v is ShoreId {
  return v === 'dev' || v === 'live';
}

/* -------------------------------------------------------------- types */

/** A character as `nachAussen()` in `KontoApi.ts` hands it out. */
export interface Charakter {
  id: number;
  name: string;
  figur: string;
  frisur: string;
  ober: string;
  beine: string;
  /** Epoch milliseconds — the database stores numbers, not ISO strings. */
  created: number;
  lastPlayed: number | null;
}

export interface Konto {
  username: string;
  email: string;
}

/** What `/registrieren` and `/anmelden` answer with. */
export interface Anmeldung {
  token: string;
  account: Konto;
  characters: Charakter[];
}

/** What `/ich` answers with — the same, minus a fresh token. */
export interface Ich {
  account: Konto;
  characters: Charakter[];
}

export interface Ticket {
  sessionToken: string;
  character: Charakter;
}

/* ------------------------------------------------------------- errors */

/**
 * A failed call. `key` is the API's error key, never a sentence.
 *
 * The API answers with keys (`username-taken`, …) precisely so that
 * the wording lives in the catalogue and exists in both languages. Turning
 * the key into text here would put one German sentence in a module that
 * knows nothing about the reader's language.
 */
export class ApiError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'ApiError';
  }
}

/**
 * Error key → catalogue key.
 *
 * `unbekannter-endpunkt` is deliberately absent: it can only happen if this
 * module and the server disagree about a path, which is a bug and not
 * something a player can act on. It falls through to the generic entry.
 */
const ERROR_MESSAGES: Record<string, MessageKey> = {
  'username-invalid': 'konto.fehler.benutzername_ungueltig',
  'email-invalid': 'konto.fehler.email_ungueltig',
  'password-too-short': 'konto.fehler.passwort_zu_kurz',
  'username-taken': 'konto.fehler.benutzername_vergeben',
  'login-failed': 'konto.fehler.anmeldung_fehlgeschlagen',
  'too-many-attempts': 'konto.fehler.zu_viele_versuche',
  'not-signed-in': 'konto.fehler.nicht_angemeldet',
  'name-invalid': 'konto.fehler.name_ungueltig',
  'name-taken': 'konto.fehler.name_vergeben',
  'unknown': 'konto.fehler.unbekannt',
  'malformed-body': 'konto.fehler.kaputter_koerper',
  serverfehler: 'konto.fehler.serverfehler',
  netzwerk: 'konto.fehler.netzwerk',
};

export function errorMessageKey(key: string): MessageKey {
  return ERROR_MESSAGES[key] ?? 'konto.fehler.unerwartet';
}

/** True when the call failed because the token is gone or expired. */
export function isLoggedOut(e: unknown): boolean {
  return e instanceof ApiError && e.key === 'not-signed-in';
}

/* -------------------------------------------------------- token store */

const tokenKey = (shore: ShoreId) => `wov-konto:${shore}`;
const SHORE_KEY = 'wov-gestade';

interface TokenPayload {
  /** account id */
  k: number;
  /** issued at, epoch ms */
  i: number;
  /** expires at, epoch ms */
  e: number;
}

/**
 * Reads the expiry out of the token without trusting it for anything else.
 *
 * The signature cannot be checked here — the key never leaves the server —
 * so this is a courtesy, not a security check: it saves a round trip that
 * would answer 401 anyway. Every real decision is still made server-side.
 */
function payloadOf(token: string): TokenPayload | null {
  const teil = token.split('.')[0];
  if (!teil) return null;
  try {
    const b64 = teil.replace(/-/g, '+').replace(/_/g, '/');
    // atob wants a length divisible by four; base64url drops the padding.
    const roh = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const p: unknown = JSON.parse(roh);
    if (!p || typeof p !== 'object') return null;
    const e = (p as Record<string, unknown>).e;
    const k = (p as Record<string, unknown>).k;
    if (typeof e !== 'number' || typeof k !== 'number') return null;
    return { k, i: 0, e };
  } catch {
    return null;
  }
}

export function tokenAlive(token: string | null): boolean {
  if (!token) return false;
  const p = payloadOf(token);
  return p !== null && Date.now() < p.e;
}

/**
 * The token for a shore, or null.
 *
 * An expired token is deleted on the way out instead of being returned:
 * something that can never work again is not worth keeping, and leaving it
 * makes every later "am I logged in" answer depend on who checked the date.
 */
export function readToken(shore: ShoreId): string | null {
  try {
    const t = localStorage.getItem(tokenKey(shore));
    if (!t) return null;
    if (!tokenAlive(t)) {
      clearToken(shore);
      return null;
    }
    return t;
  } catch {
    // Private mode, or no DOM at all during prerendering.
    return null;
  }
}

export function writeToken(shore: ShoreId, token: string): void {
  try {
    localStorage.setItem(tokenKey(shore), token);
  } catch {
    /* private mode: then the login lasts for this tab only */
  }
}

/**
 * Forget the token for a shore — this is all "sign out" can do.
 *
 * The account token is self-carrying and HMAC-signed; there is no revoke
 * endpoint in the API, so nothing server-side could be cancelled here.
 */
export function clearToken(shore: ShoreId): void {
  try {
    localStorage.removeItem(tokenKey(shore));
  } catch {
    /* nothing stored, nothing to forget */
  }
}

/**
 * Forget every shore's token — what "sign out" has to mean.
 *
 * clearToken() alone is NOT enough for a sign-out button. signedInShore()
 * deliberately looks at the other shore as well, so that somebody who only
 * has a Midgard account is not asked to sign in while their token sits
 * under the other key. The same reach turns a single-shore clearToken()
 * into a sign-out that does not sign out: the next call finds the other
 * token and reports the visitor as signed in again.
 *
 * On a shared machine that is the difference between leaving and appearing
 * to leave.
 */
export function clearAllTokens(): void {
  for (const shore of SHORE_IDS) clearToken(shore);
}

/** The shore last chosen, or null when nothing is remembered yet. */
export function readShore(): ShoreId | null {
  try {
    const s = localStorage.getItem(SHORE_KEY);
    return isShore(s) ? s : null;
  } catch {
    return null;
  }
}

export function writeShore(shore: ShoreId): void {
  try {
    localStorage.setItem(SHORE_KEY, shore);
  } catch {
    /* private mode */
  }
}

/**
 * The shore we are logged in on, preferring the remembered one.
 *
 * Used by `/erstellen` and `/konto` so that a bookmarked page finds the
 * account without asking. Looking at the other shore too is what keeps
 * somebody who only has a Midgard account from being told to sign in while
 * their token sits right there under the other key.
 */
export function signedInShore(): ShoreId | null {
  const gemerkt = readShore();
  if (gemerkt && readToken(gemerkt)) return gemerkt;
  return SHORE_IDS.find((s) => readToken(s)) ?? null;
}

/* ---------------------------------------------------------- API calls */

interface Aufruf {
  method: 'GET' | 'POST' | 'DELETE';
  token?: string;
  body?: unknown;
}

async function call<T>(shore: ShoreId, pfad: string, a: Aufruf): Promise<T> {
  const kopf: Record<string, string> = {};
  if (a.body !== undefined) kopf['content-type'] = 'application/json';
  // X-WoV-Konto statt Authorization: Der Proxy vor dem Testgestade leert
  // die Authorization-Kopfzeile (proxy_set_header Authorization ""), ein
  // Bearer-Token kaeme dort nie an. Begruendung in KontoApi.ts.
  if (a.token) kopf['x-wov-account'] = a.token;

  let antwort: Response;
  try {
    antwort = await fetch(SHORES[shore].url + pfad, {
      method: a.method,
      headers: kopf,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
      // No cookies are involved, and asking for them would only add a
      // preflight the API does not answer for credentialed requests.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // A rejected fetch is the one failure the API cannot name itself:
    // the request never arrived.
    throw new ApiError('netzwerk');
  }

  let daten: unknown = null;
  try {
    daten = await antwort.json();
  } catch {
    /* an empty or broken body is handled by the status below */
  }

  if (!antwort.ok) {
    const fehler = (daten as { fehler?: unknown } | null)?.fehler;
    throw new ApiError(typeof fehler === 'string' ? fehler : 'server-error');
  }
  return daten as T;
}

export function registrieren(
  shore: ShoreId,
  username: string,
  email: string,
  password: string,
): Promise<Anmeldung> {
  return call<Anmeldung>(shore, '/accounts/register', {
    method: 'POST',
    body: { username, email, password },
  });
}

export function anmelden(
  shore: ShoreId,
  username: string,
  password: string,
): Promise<Anmeldung> {
  return call<Anmeldung>(shore, '/accounts/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function ich(shore: ShoreId, token: string): Promise<Ich> {
  return call<Ich>(shore, '/accounts/me', { method: 'GET', token });
}

export function charakterAnlegen(
  shore: ShoreId,
  token: string,
  charakter: { name: string; figur: string; frisur: string; ober: string; beine: string },
): Promise<{ character: Charakter }> {
  return call<{ character: Charakter }>(shore, '/accounts/characters', {
    method: 'POST',
    token,
    body: charakter,
  });
}

export function charakterLoeschen(
  shore: ShoreId,
  token: string,
  id: number,
): Promise<{ ok: true }> {
  return call<{ ok: true }>(shore, `/accounts/characters/${id}`, {
    method: 'DELETE',
    token,
  });
}

/** Trade a character for a session ticket — the only way into the world. */
export function spielen(shore: ShoreId, token: string, id: number): Promise<Ticket> {
  return call<Ticket>(shore, `/accounts/characters/${id}/spielen`, {
    method: 'POST',
    token,
  });
}

/* ------------------------------------------------------- into the game */

/**
 * The address that hands a player to the game client.
 *
 * ── Why the ticket is a FRAGMENT and not a parameter ─────────────────
 * A ticket is a credential. A query parameter travels into every server
 * log on the way and into the `Referer` of every following request; a
 * fragment is never sent to a server at all. `client/src/main.ts` reads
 * `#ticket=`, stores it as the ordinary session token and strips it from
 * the address again (commit b57ce2b).
 *
 * ── Why `los=1` is still there ───────────────────────────────────────
 * Measured, not assumed: in `client/src/main.ts` the ticket block and the
 * auto-connect block are separate, and only `if (vonSeite.los …)` skips
 * the connect window. A ticket alone would store the token and then show
 * the connect dialog anyway — the very break this flow removes.
 *
 * Name and appearance stay ordinary parameters. They are not credentials
 * (the client's own comment says manipulating one's OWN appearance is
 * allowed, and the server checks every id against the same lists), and
 * without `name` the client invents a random `Viking###`.
 */
export function playUrl(
  shore: ShoreId,
  c: Pick<Charakter, 'name' | 'figur' | 'frisur' | 'ober' | 'beine'>,
  sessionToken: string,
  zeit = '',
): string {
  const p = new URLSearchParams({ los: '1', name: c.name, figur: c.figur, frisur: c.frisur });
  if (c.ober) p.set('ober', c.ober);
  if (c.beine) p.set('beine', c.beine);
  // Only send what was offered: a `zeit` from an earlier test-shore visit
  // must not quietly travel to Midgard.
  if (shore === 'dev' && zeit !== '') p.set('zeit', zeit);
  return `${SHORES[shore].url}/?${p.toString()}#ticket=${encodeURIComponent(sessionToken)}`;
}
