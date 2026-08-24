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
  const first = event.url.pathname.split('/')[1];
  const lang = isLocale(first) ? first : DEFAULT_LOCALE;

  /*
    `replaceAll`, not `replace`: with a string pattern, `replace` swaps only
    the FIRST occurrence. As long as the placeholder appears exactly once in
    app.html the two are the same — but "as long as" is not a property a file
    keeps by itself, and the difference does not announce itself. It leaves a
    `lang="%lang%"` in every built page, and that is only noticed once
    somebody greps for it.
  */
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll('%lang%', lang),
  });
};
