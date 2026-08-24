/**
 * Language and addresses.
 *
 * ── Why the language lives in the URL and nowhere else ────────────────
 * There is no store, no context, no load function and no client-side
 * language switch. The locale is the first path segment, and that segment is
 * known at build time: `/de/saga` and `/en/saga` are two prerendered files,
 * each with its text already baked in. That is what keeps the site readable
 * without JavaScript — a `localStorage` preference or a `navigator.language`
 * sniff would move the decision into the browser, and a browser without
 * scripting would then get nothing.
 *
 * ── Why components read `page.params` and not a context ───────────────
 * On a language switch SvelteKit keeps the layout component alive. A context
 * value set once during layout setup would then be stale, silently, on every
 * page after the switch. `$derived(localeFrom(page.params.lang))` is
 * reactive by itself and behaves identically during the server render.
 */
import type { RouteId } from '$app/types';
import { de } from './de';
import { en } from './en';
import type { Messages } from './types';

export type { MessageKey, Messages } from './types';

export type Locale = 'de' | 'en';

export const LOCALES: Locale[] = ['de', 'en'];

/** Used wherever no locale is in the address — the root language gate. */
export const DEFAULT_LOCALE: Locale = 'de';

/**
 * The `og:locale` value per language.
 *
 * Open Graph wants a full `language_TERRITORY` tag, not a bare language.
 * Which territory to pick is a choice, not a fact: the site is written in
 * standard German and in the English a German writes, so `de_DE` and `en_US`
 * are the least surprising pair. It only ever affects link previews.
 */
export const OG_LOCALE: Record<Locale, string> = { de: 'de_DE', en: 'en_US' };

/** How each language names itself — the same in every catalogue on purpose. */
export const LOCALE_NAME: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export function isLocale(v: string | undefined): v is Locale {
  return v === 'de' || v === 'en';
}

/** Like `isLocale`, but always yields a language. */
export function localeFrom(v: string | undefined): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export function messages(l: Locale): Messages {
  return { de, en }[l];
}

/**
 * ── The published address of a page, per language ─────────────────────
 *
 * A German reader gets `/de/ruestkammer`, an English reader `/en/armory`.
 * The FOLDER under `src/routes/[lang=lang]/` stays German either way — it is
 * the canonical, internal name of the page, the same string that `seiten.ts`
 * carries as `pfad`. Only the published address is translated, and this
 * table is the single place where the translation happens.
 *
 * Keys are those canonical paths (`'/ruestkammer'`), values the slug per
 * language. `'/'` is not in here: the hall of a language has no slug at all,
 * its address is just `/de` or `/en`, and `localizedPath` handles that case
 * before it ever looks in this table.
 *
 * ── Why the keys check themselves ─────────────────────────────────────
 * `KanonischerPfad` is not a hand-written list — it is derived from the route
 * ids SvelteKit generates from the folder tree. `satisfies` therefore fails
 * `npm run check` in BOTH directions: a new page under `[lang=lang]/` without
 * a line here is a missing key, and a line here whose folder was renamed or
 * deleted is an excess key. Without that, a forgotten entry would fall back
 * to the German slug inside an English address — exactly the bug this table
 * exists to remove, quietly reintroduced at a new spot.
 *
 * ── Hyphen, not underscore ────────────────────────────────────────────
 * `hall-of-fame` is the only multi-word slug. Search engines treat `-` as a
 * word boundary and `_` as a letter, so `hall_of_fame` would be read as one
 * token. Every other address on this site is a single word, so kebab-case is
 * also the convention that already holds.
 *
 * ── If you rename a folder ────────────────────────────────────────────
 * Rename the key here too. `npm run check` will tell you; and if it somehow
 * did not, the prerender entries in `svelte.config.js` would fail the build
 * with a 404. Nothing about this is silent — that is on purpose.
 */
type OhneSprachpraefix<R> = R extends `/[lang=lang]/${infer P}` ? `/${P}` : never;

/** Every page under `[lang=lang]/`, by its canonical (German) folder name. */
export type KanonischerPfad = OhneSprachpraefix<RouteId>;

export const SLUGS = {
  '/saga': { de: 'saga', en: 'saga' },
  '/thing': { de: 'thing', en: 'thing' },
  /* Same word in both languages, like `saga` and `thing` — a German
     `/de/wissen` against an English `/en/wiki` would be two names for one
     page where the English one is already the German one too. */
  '/wiki': { de: 'wiki', en: 'wiki' },
  '/karte': { de: 'karte', en: 'map' },
  '/ruestkammer': { de: 'ruestkammer', en: 'armory' },
  '/ruhmeshalle': { de: 'ruhmeshalle', en: 'hall-of-fame' },
  '/anmelden': { de: 'anmelden', en: 'login' },
  '/registrieren': { de: 'registrieren', en: 'register' },
  '/konto': { de: 'konto', en: 'account' },
  '/erstellen': { de: 'erstellen', en: 'create' },
} as const satisfies Record<KanonischerPfad, Record<Locale, string>>;

/** The same table, but indexable with a plain `string`. */
const NACH_PFAD: Record<string, Record<Locale, string> | undefined> = SLUGS;

const KANONISCHE_PFADE = Object.keys(SLUGS) as KanonischerPfad[];

/**
 * The published slug of a page, read backwards.
 *
 * `('en', 'armory')` → `'/ruestkammer'`. Returns `undefined` for anything
 * that is not a published slug of THAT language — `('en', 'ruestkammer')` is
 * not an English address, it is a leftover from before this table existed,
 * and nginx answers it with a 301 (see `deploy/wov-alte-adressen.conf`).
 */
export function kanonischerPfad(l: Locale, slug: string): KanonischerPfad | undefined {
  return KANONISCHE_PFADE.find((p) => SLUGS[p][l] === slug);
}

/**
 * Prefixes a canonical path with a language AND translates its slug.
 *
 * `'/'` becomes `'/de'`, not `'/de/'` — `trailingSlash` is `'never'`, so the
 * hall of a language is the file `build/de.html` and its address carries no
 * trailing slash. Everything else gets prefix and translated slug:
 * `'/ruestkammer'` → `'/de/ruestkammer'` and `'/en/armory'`.
 *
 * A path that is not in the table is passed through unchanged. That case is
 * unreachable for every caller in this repo — they all pass a literal from
 * `seiten.ts` or a literal spelled the same way — but it keeps the function
 * total, and the `satisfies` above is what guards the table itself.
 */
export function localizedPath(l: Locale, path: string): string {
  if (path === '/') return `/${l}`;
  const eintrag = NACH_PFAD[path];
  return eintrag ? `/${l}/${eintrag[l]}` : `/${l}${path}`;
}

/**
 * The inverse: strips language prefix and `.html` suffix, and translates the
 * published slug BACK to its canonical path.
 *
 * `'/en/armory'` → `'/ruestkammer'`, `'/de/saga.html'` → `'/saga'`,
 * `'/de'` → `'/'`, `'/'` → `'/'`.
 *
 * The second half is what the language switch stands on: it turns the address
 * you are looking at into the key of the PAGE you are looking at, and
 * `localizedPath` then spells that key in the other language. Strip only the
 * prefix and you get `/en/ruestkammer` out of a click on „English" — a link
 * that looks perfectly fine in the markup and is wrong in the browser.
 */
export function stripLocale(pathname: string): string {
  const ohneEndung = pathname.replace(/\.html$/, '');
  const teile = ohneEndung.split('/');
  const quelle = teile[1];

  if (!isLocale(quelle)) {
    return ohneEndung === '' || ohneEndung === '/' ? '/' : ohneEndung;
  }

  const slug = teile.slice(2).join('/');
  if (slug === '') return '/';

  /*
    Unknown slug: hand back what was there. That happens on the addresses
    that ran under a German slug in English before this table existed — the
    built page still needs a working language switch, and `/anmelden` is the
    canonical key it should have carried all along.
  */
  return kanonischerPfad(quelle, slug) ?? `/${slug}`;
}
