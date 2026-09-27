/**
 * Known website domains — Karte D1 (Zweitdomains / Ablösung).
 *
 * ── Two equal home domains, one transitional one ──────────────────────
 * `world-of-mmorpg.com` and `world-of-mmorpg.de` are equally valid main
 * domains: both serve the whole site in both languages. `.de` is the
 * canonical HOME of `/de` pages, `.com` the canonical home of `/en` pages
 * — independent of which of the two domains actually served a given
 * request (`CANONICAL_HOME` below, not a per-request host lookup).
 * `world-of-vikings.com` is being retired and will only redirect (Karte
 * D1, Teil 3); it stays in `BEKANNTE_BASISDOMAINS` so the wov-web service
 * itself keeps answering it directly during the migration window (old
 * tabs, bookmarks, the account/forum API allowlist) until Teil 3's NPM
 * step turns it into a pure redirect target in front of nginx.
 *
 * ── Not `@wov/shared` ───────────────────────────────────────────────────
 * wov-web is its own npm project (own `package.json`, own lockfile, no
 * dependency on `@wov/shared`) — see `server/src/net/WebsiteUrspruenge.ts`
 * for the server+client copy of the same three domains. Duplicated data
 * rather than a shared import, same reasoning as `GAME_SESSION_TOKEN_KEY`
 * in `account.ts`: separate bundlers, one small contract between them.
 */
import { type Locale, localizedPath } from './i18n';

export const MMORPG_COM = 'world-of-mmorpg.com';
export const MMORPG_DE = 'world-of-mmorpg.de';
/** Wird abgelöst (Karte D1, Teil 3); leitet danach dauerhaft weiter. */
export const VIKINGS_COM_UEBERGANG = 'world-of-vikings.com';

/** Jede Domain, unter der dieser Dienst heute noch selbst antwortet. */
export const BEKANNTE_BASISDOMAINS: readonly string[] = [
  MMORPG_COM,
  MMORPG_DE,
  VIKINGS_COM_UEBERGANG,
];

/**
 * Ist `host` (aus `event.url.hostname`, schon klein geschrieben, ohne Port)
 * eine bekannte Basisdomain oder ihr `www.`? `localhost` zusätzlich, für
 * `vite dev`/`vite preview` — dort läuft nie eine echte Basisdomain.
 */
export function istBekannterHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1') return true;
  return BEKANNTE_BASISDOMAINS.some((domain) => h === domain || h === `www.${domain}`);
}

/**
 * Die Heimat-Domain je Sprache — nicht die Domain, die die Anfrage bediente.
 * `/de`-Seiten sind kanonisch auf `world-of-mmorpg.de` zu Hause, `/en`-Seiten
 * auf `world-of-mmorpg.com`, unabhängig davon, über welche der beiden
 * gleichwertigen Domains eine Seite gerade ausgeliefert wird (ZIELÄNDERUNG,
 * Karte D1).
 */
export const CANONICAL_HOME: Record<Locale, string> = {
  de: `https://${MMORPG_DE}`,
  en: `https://${MMORPG_COM}`,
};

/**
 * `x-default` ist auf JEDER Seite genau diese eine Adresse: die Sprachweiche
 * unter `/` (Angriffsbefund M2, Mikes ausdrückliche Vorgabe). NICHT je Seite
 * eine eigene lokalisierte Fassung auf `.com` — das wäre eine Adresse, die
 * per canonical selbst wieder woanders hinzeigt (auf `.de` für `/de`-Seiten),
 * und Suchmaschinen werten ein hreflang-Ziel, dessen eigene canonical-Angabe
 * abweicht, als widersprüchlich.
 */
export const X_DEFAULT_ADRESSE = `https://${MMORPG_COM}/`;

/** Kanonische Adresse einer Seite in ihrer eigenen Sprache. */
export function kanonischeAdresse(lang: Locale, pfadOhneEndung: string): string {
  return CANONICAL_HOME[lang] + pfadOhneEndung;
}

/** hreflang-Adresse einer Sprachfassung — auf DEREN eigener Heimat-Domain. */
export function hreflangAdresse(lang: Locale, nackterPfad: string): string {
  return CANONICAL_HOME[lang] + localizedPath(lang, nackterPfad);
}

/** Volle Adresse eines sprachlosen Pfads in einer Sprache, für die Sitemap. */
export function sitemapAdresse(lang: Locale, pfad: string): string {
  return CANONICAL_HOME[lang] + localizedPath(lang, pfad);
}

/**
 * Wohin `world-of-vikings.com` einen Aufruf weiterleitet (Karte D1, Teil 3):
 * Pfad und Suchteil bleiben erhalten, nur der Ursprung wechselt — auf die
 * Heimat-Domain der Sprache im Pfad, sonst auf `world-of-mmorpg.com`.
 *
 * Reine Vorschrift für die tatsächliche nginx-Weiterleitung
 * (`deploy/npm-weiterleitung-vikings.conf`, noch nicht ausgeführt) — nginx
 * kann diese Funktion nicht aufrufen, muss aber dieselbe Regel abbilden.
 */
export function weiterleitungsZielVikings(pfad: string, suche = ''): string {
  const anhang = suche === '' || suche.startsWith('?') ? suche : `?${suche}`;
  if (pfad === '/de' || pfad.startsWith('/de/')) return `https://${MMORPG_DE}${pfad}${anhang}`;
  if (pfad === '/en' || pfad.startsWith('/en/')) return `https://${MMORPG_COM}${pfad}${anhang}`;
  return `https://${MMORPG_COM}${pfad}${anhang}`;
}
