import { LOCALES } from '$lib/i18n';
import type { EntryGenerator } from './$types';

/**
 * Which language versions of this page to prerender.
 *
 * The crawler finds `[lang=lang]` pages by following links out of the two
 * language roots. That works for everything in the navigation, but the
 * account pages are not in it — `/konto` in particular is only ever linked
 * from a state that exists after signing in, which no prerendered page
 * contains. Without this list the route would silently not be built, and
 * `adapter-static` with `strict: true` would stop the build.
 */
export const entries: EntryGenerator = () => LOCALES.map((lang) => ({ lang }));
