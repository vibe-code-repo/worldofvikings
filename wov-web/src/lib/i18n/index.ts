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
 * Prefixes a locale-free path with a language.
 *
 * `'/'` becomes `'/de'`, not `'/de/'` — `trailingSlash` is `'never'`, so the
 * hall of a language is the file `build/de.html` and its address carries no
 * trailing slash. Everything else simply gets the prefix: `'/saga'` →
 * `'/de/saga'`.
 */
export function localizedPath(l: Locale, pfad: string): string {
  return pfad === '/' ? `/${l}` : `/${l}${pfad}`;
}

/**
 * The inverse: strips language prefix and `.html` suffix.
 *
 * `'/en/saga.html'` → `'/saga'`, `'/de'` → `'/'`, `'/'` → `'/'`. This is what
 * the navigation compares against, so a nav entry stays a plain `'/saga'` and
 * does not have to exist twice.
 */
export function stripLocale(pathname: string): string {
  const ohneEndung = pathname.replace(/\.html$/, '');
  const teile = ohneEndung.split('/');
  const rest = isLocale(teile[1]) ? `/${teile.slice(2).join('/')}` : ohneEndung;
  return rest === '' || rest === '/' ? '/' : rest;
}
