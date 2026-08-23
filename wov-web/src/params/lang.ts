import { isLocale } from '$lib/i18n';

/**
 * The matcher for the `[lang=lang]` segment.
 *
 * Without it, `[lang]` would swallow *any* first path segment: a request for
 * `/favicon.ico` would look like the hall of a language called `favicon.ico`,
 * and with `strict: true` the prerenderer would happily build it. With the
 * matcher only `de` and `en` are routes; everything else is a 404, which is
 * what a 404 is for.
 *
 * Adding a language is one entry in `LOCALES` (and a catalogue) — this file
 * follows along by itself.
 */
export function match(param: string): boolean {
  return isLocale(param);
}
