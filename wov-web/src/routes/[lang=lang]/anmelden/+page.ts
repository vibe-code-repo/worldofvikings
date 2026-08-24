import { DEFAULT_LOCALE } from '$lib/i18n';
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
/*
 * NUR die Vorgabesprache, und das ist kein Versehen.
 *
 * Ein Erzeuger kennt ausschliesslich ROUTENPARAMETER, also den
 * Ordnernamen -- fuer Deutsch ist der zugleich der Slug (/de/konto), fuer
 * Englisch nicht (/en/account). `LOCALES.map` erzeugte deshalb
 * zuverlaessig auch /en/konto, /en/anmelden und /en/registrieren: drei
 * Seiten unter Adressen, die es gar nicht geben soll.
 *
 * Die richtigen englischen Adressen stehen als `prerender.entries` in
 * svelte.config.js; `reroute` (src/hooks.ts) fuehrt sie auf diesen Ordner
 * zurueck.
 *
 * Warum die drei Geister nicht harmlos waren: nginx liefert eine
 * vorhandene Datei aus, bevor eine rewrite-Regel greift. /en/konto haette
 * also mit 200 geantwortet statt mit 301 auf /en/account -- die
 * Weiterleitung waere nie zum Zug gekommen, und beide Adressen waeren
 * dauerhaft erreichbar geblieben. Genau das, was hreflang und canonical
 * verhindern sollen.
 */
export const entries: EntryGenerator = () => [{ lang: DEFAULT_LOCALE }];
