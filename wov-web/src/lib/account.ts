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
 * ticket from `/play` goes into the address FRAGMENT (`#ticket=`), which
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
  dev: 'create.voyage.shore.dev',
  live: 'create.voyage.shore.live',
};

export function isShore(v: string | null | undefined): v is ShoreId {
  return v === 'dev' || v === 'live';
}

/* -------------------------------------------------------------- types */

/**
 * A character as `nachAussen()` in `KontoApi.ts` hands it out.
 *
 * ── English field names, German values ────────────────────────────────
 * The FIELD names are wire format and read English, like everything else
 * between server and browser. The VALUES do not: `wikingerin`, `H_01`,
 * `leder_bh` are the ids from `shared/aussehen.ts`, and they sit in the
 * world save and in the accounts database. Translating them would be a
 * data migration, not a rename.
 *
 * The SQLite columns are still `figur`/`frisur`/`ober`/`beine` for the
 * same reason; `KontoApi.ts` translates between column and field in one
 * place (`nachAussen`) so this side never has to know.
 */
export interface Character {
  id: number;
  name: string;
  figure: string;
  hairstyle: string;
  top: string;
  legs: string;
  /** Epoch milliseconds — the database stores numbers, not ISO strings. */
  created: number;
  lastPlayed: number | null;
}

export interface Account {
  username: string;
  email: string;
}

/** What `/register` and `/login` answer with. */
export interface AuthResponse {
  token: string;
  account: Account;
  characters: Character[];
}

/** What `/me` answers with — the same, minus a fresh token. */
export interface Me {
  account: Account;
  characters: Character[];
}

export interface Ticket {
  sessionToken: string;
  character: Character;
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
 * The keys on the left are the API's vocabulary, not identifiers of this
 * module: they travel over the wire and have to read exactly as the server
 * writes them. That is why `serverfehler` and `netzwerk` are still German
 * here while everything around them is not.
 *
 * `unbekannter-endpunkt` is deliberately absent: it can only happen if this
 * module and the server disagree about a path, which is a bug and not
 * something a player can act on. It falls through to the generic entry.
 */
const ERROR_MESSAGES: Record<string, MessageKey> = {
  'username-invalid': 'account.error.username_invalid',
  'email-invalid': 'account.error.email_invalid',
  'password-too-short': 'account.error.password_too_short',
  'username-taken': 'account.error.username_taken',
  'login-failed': 'account.error.login_failed',
  'too-many-attempts': 'account.error.too_many_attempts',
  'not-signed-in': 'account.error.not_logged_in',
  'name-invalid': 'account.error.name_invalid',
  'name-taken': 'account.error.name_taken',
  unknown: 'account.error.unknown',
  'malformed-body': 'account.error.broken_body',
  'server-error': 'account.error.server_error',
  // Not from the server: account.ts raises this itself when fetch() throws,
  // so it never has to match a wire key.
  network: 'account.error.network',
};

export function errorMessageKey(key: string): MessageKey {
  return ERROR_MESSAGES[key] ?? 'account.error.unexpected';
}

/** True when the call failed because the token is gone or expired. */
export function isLoggedOut(e: unknown): boolean {
  return e instanceof ApiError && e.key === 'not-signed-in';
}

/* -------------------------------------------------------- token store */

/*
  The storage keys stay `wov-konto:` and `wov-gestade`. They are not
  identifiers but data that already sits in visitors' browsers: renaming
  them would silently sign everybody out and lose their remembered shore,
  and nothing on the page would say why.
*/
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
  const part = token.split('.')[0];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    // atob wants a length divisible by four; base64url drops the padding.
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const p: unknown = JSON.parse(raw);
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
  const remembered = readShore();
  if (remembered && readToken(remembered)) return remembered;
  return SHORE_IDS.find((s) => readToken(s)) ?? null;
}

/* ---------------------------------------------------------- API calls */

interface Call {
  method: 'GET' | 'POST' | 'DELETE';
  token?: string;
  body?: unknown;
}

async function call<T>(shore: ShoreId, path: string, a: Call): Promise<T> {
  const headers: Record<string, string> = {};
  if (a.body !== undefined) headers['content-type'] = 'application/json';
  // X-WoV-Account instead of Authorization: the proxy in front of the test
  // shore empties the Authorization header (proxy_set_header Authorization
  // ""), so a bearer token would never arrive there. Reasoning in
  // KontoApi.ts.
  if (a.token) headers['x-wov-account'] = a.token;

  let response: Response;
  try {
    response = await fetch(SHORES[shore].url + path, {
      method: a.method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
      // No cookies are involved, and asking for them would only add a
      // preflight the API does not answer for credentialed requests.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // A rejected fetch is the one failure the API cannot name itself:
    // the request never arrived.
    throw new ApiError('network');
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    /* an empty or broken body is handled by the status below */
  }

  if (!response.ok) {
    // `error` is the field name the API sends, not a variable of ours —
    // every `this.json(res, …)` in `KontoApi.ts` writes that key. This
    // used to read `fehler`, which is never present: the key came back
    // `undefined` and every failure showed the generic sentence instead
    // of the reason the server had named.
    const key = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof key === 'string' ? key : 'server-error');
  }
  return data as T;
}

export function register(
  shore: ShoreId,
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return call<AuthResponse>(shore, '/accounts/register', {
    method: 'POST',
    body: { username, email, password },
  });
}

export function login(shore: ShoreId, username: string, password: string): Promise<AuthResponse> {
  return call<AuthResponse>(shore, '/accounts/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function me(shore: ShoreId, token: string): Promise<Me> {
  return call<Me>(shore, '/accounts/me', { method: 'GET', token });
}

export function createCharacter(
  shore: ShoreId,
  token: string,
  character: { name: string; figure: string; hairstyle: string; top: string; legs: string },
): Promise<{ character: Character }> {
  return call<{ character: Character }>(shore, '/accounts/characters', {
    method: 'POST',
    token,
    body: character,
  });
}

export function deleteCharacter(shore: ShoreId, token: string, id: number): Promise<{ ok: true }> {
  return call<{ ok: true }>(shore, `/accounts/characters/${id}`, {
    method: 'DELETE',
    token,
  });
}

/** Trade a character for a session ticket — the only way into the world. */
export function play(shore: ShoreId, token: string, id: number): Promise<Ticket> {
  return call<Ticket>(shore, `/accounts/characters/${id}/play`, {
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
 * ── Why `go=1` is still there ────────────────────────────────────────
 * Measured, not assumed: in `client/src/main.ts` the ticket block and the
 * auto-connect block are separate, and only `if (vonSeite.go …)` skips
 * the connect window. A ticket alone would store the token and then show
 * the connect dialog anyway — the very break this flow removes.
 *
 * Name and appearance stay ordinary parameters. They are not credentials
 * (the client's own comment says manipulating one's OWN appearance is
 * allowed, and the server checks every id against the same lists), and
 * without `name` the client invents a random `Viking###`.
 *
 * The parameter names are the client's, not ours: `go`, `figure`,
 * `hairstyle`, `top`, `legs` and `time` are read verbatim in
 * `client/src/main.ts`. Change one side and the handover breaks in
 * silence — the client simply sees no parameter and falls back.
 */
export function playUrl(shore: ShoreId, sessionToken: string, time?: string): string {
  const url = new URL(SHORES[shore].url);
  // Nur die gewuenschte Weltzeit steht noch im Suchteil, und auch die nur,
  // wenn eine gewaehlt wurde: Sie ist kein Merkmal des Charakters, sondern
  // ein Wunsch an die Welt.
  if (time) url.searchParams.set('time', time);
  // Alles andere ist weg, und das ist der Punkt: Das Ticket traegt die
  // spielerId, der Server kennt damit den Charakter und holt Namen und
  // Aussehen selbst. Name, figure, hairstyle, top und legs an die Adresse
  // zu haengen war Doppelung -- und der Name war obendrein eine Behauptung
  // des Browsers, der der Server geglaubt hat.
  //
  // Das Ticket gehoert ins FRAGMENT, nicht in den Suchteil: Es ist ein
  // Zugangsnachweis, und ein Fragment wird nicht an Server geschickt.
  url.hash = `ticket=${encodeURIComponent(sessionToken)}`;
  return url.toString();
}

