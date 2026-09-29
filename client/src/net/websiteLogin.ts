/**
 * Where a visitor without a session goes to sign in — the website that
 * issued the session, on the SAME domain the game client runs on.
 *
 * Karte D1 (Zweitdomains): with two equal main domains
 * (`world-of-mmorpg.com`/`.de`, plus the transitional `world-of-vikings.com`)
 * the sign-in must happen on the domain the visitor was playing on, or the
 * session (`localStorage`, per origin) would not carry over.
 *
 * Takes `location.host` (hostname **plus port**), not `.hostname`
 * (Angriffsbefund N1): a slot port (`127.0.0.1:5295`) belongs to the address —
 * without it the way back after a lost connection led to port 80 of the DEV
 * nginx instead of the own slot.
 *
 * Kept free of the DOM and of `window`, so a test can pass any host. The host
 * is checked: only a known domain, `localhost` or an IPv4 address (a same-origin
 * lab or slot) is used as written; anything else — and anything that could
 * change the target of the URL (`@`, `/`, `\`, `?`, `#`, spaces) — falls back
 * to the default domain instead of ending up in `new URL(…)`.
 */
import { basisDomainVonSpielHost } from '../editor/spielAdresse';

/** The domain a visitor goes to when the host is not one we know. */
export const STANDARD_BASIS = 'world-of-mmorpg.com';

const HOST_MIT_PORT = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/;
const BEKANNTE_DOMAIN = /^(?:[a-z0-9-]+\.)*(?:world-of-mmorpg\.(?:com|de)|world-of-vikings\.com)$/;
const LOKALER_HOST = /^(?:localhost|[0-9]{1,3}(?:\.[0-9]{1,3}){3})$/;

/** The login path of a language: `/en/login` for English, else `/de/anmelden`. */
export function loginPfad(language: string): string {
  return language === 'en' ? '/en/login' : '/de/anmelden';
}

/** The website host (with port) for a game host, or the default domain. */
export function websiteHost(host: string): string {
  const basis = basisDomainVonSpielHost(host).toLowerCase();
  const teile = HOST_MIT_PORT.exec(basis);
  if (!teile) return STANDARD_BASIS;
  const [, name, port] = teile;
  if (port !== undefined && Number(port) > 65535) return STANDARD_BASIS;
  if (!BEKANNTE_DOMAIN.test(name) && !LOKALER_HOST.test(name)) return STANDARD_BASIS;
  return basis;
}

export function websiteLoginUrl(
  ort: { readonly protocol: string; readonly host: string },
  language: string,
  expired = false,
): URL {
  const protokoll = ort.protocol === 'http:' ? 'http:' : 'https:';
  const url = new URL(loginPfad(language), `${protokoll}//${websiteHost(ort.host)}`);
  // `.dev.` in the hostname (port stripped) marks the DEV shore.
  const hostname = ort.host.split(':')[0].toLowerCase();
  url.searchParams.set('shore', hostname.includes('.dev.') ? 'dev' : 'live');
  if (expired) url.searchParams.set('abgelaufen', '1');
  return url;
}
