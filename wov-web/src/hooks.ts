import type { Reroute } from '@sveltejs/kit';
import { isLocale, kanonischerPfad } from '$lib/i18n';

/**
 * Maps the PUBLISHED address of a page onto the folder that renders it.
 *
 * `/en/armory` is what the reader sees; `src/routes/[lang=lang]/ruestkammer/`
 * is what builds it. The folders stay German on purpose — they are the
 * canonical name of a page, the same string `seiten.ts` carries as `pfad` and
 * the slug table in `$lib/i18n` uses as its key. Only the address is
 * translated, and `reroute` is the one documented place where an address is
 * allowed to point at a different route than its own spelling.
 *
 * ── Why `src/hooks.ts` and not `src/hooks.server.ts` ──────────────────
 * A universal hook runs during prerendering AND in the browser after
 * hydration. The server-only file next to this one carries `handle` because
 * `transformPageChunk` has no client-side counterpart — but `reroute` needs
 * both halves: put it there, and a click on the language switch would render
 * server-side but hit SvelteKit's own 404 on the client-side navigation that
 * follows hydration. That failure has no symptom until somebody clicks.
 *
 * ── What it does during the build ─────────────────────────────────────
 * The prerenderer follows the `<a href>`s already written into the pages, so
 * it asks for `/en/armory`; this hook tells it which route answers, and the
 * file lands at `build/en/armory.html`. `page.url.pathname` stays the
 * original address throughout, which is what `canonical`, `hreflang` and
 * `stripLocale` want to see.
 *
 * Anything this hook does not recognise is handed back untouched: `/de/...`
 * addresses already match their folder, and a slug that belongs to no page
 * must stay a 404 rather than be bent onto some other page.
 */
export const reroute: Reroute = ({ url }) => {
  const teile = url.pathname.replace(/\.html$/, '').split('/');
  const sprache = teile[1];
  if (!isLocale(sprache)) return;

  const slug = teile.slice(2).join('/');
  if (slug === '') return;

  const kanonisch = kanonischerPfad(sprache, slug);
  if (!kanonisch) return;

  return `/${sprache}${kanonisch}`;
};
