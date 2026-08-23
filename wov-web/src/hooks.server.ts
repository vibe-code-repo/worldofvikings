import type { Handle } from '@sveltejs/kit';
import { DEFAULT_LOCALE, isLocale } from '$lib/i18n';

/**
 * Fills the `%lang%` placeholder in `src/app.html`.
 *
 * `<html lang>` is the one attribute a Svelte component cannot set: it lives
 * outside the app root, in the shell. `transformPageChunk` is the documented
 * way in, and it runs during prerendering too — which is the whole point
 * here, because prerendering is when these pages are written.
 *
 * The language is read from the pathname, not from `event.params`: route
 * parameters are not populated for every request that passes through
 * `handle`, and a language that is only *usually* correct would be worse
 * than none. The pathname is always there.
 *
 * Pages without a language prefix — the root language gate at `/` and
 * `sitemap.xml` — fall back to `DEFAULT_LOCALE`. The gate is bilingual by
 * design; `lang="de"` is a compromise, not a claim about its contents.
 */
export const handle: Handle = ({ event, resolve }) => {
  const erstes = event.url.pathname.split('/')[1];
  const lang = isLocale(erstes) ? erstes : DEFAULT_LOCALE;

  /*
    `replaceAll`, nicht `replace`: Mit einem String-Muster ersetzt `replace`
    nur das ERSTE Vorkommen. Solange der Platzhalter genau einmal in app.html
    steht, ist das dasselbe — aber „solange“ ist keine Eigenschaft, die eine
    Datei von sich aus behält, und der Unterschied faellt nicht auf. Er
    hinterlaesst ein `lang="%lang%"` in jeder gebauten Seite, und das sieht
    man erst, wenn man danach greppt.
  */
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll('%lang%', lang),
  });
};
