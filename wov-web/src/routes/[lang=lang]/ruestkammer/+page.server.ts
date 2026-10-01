import { error } from '@sveltejs/kit';
import { reckenIdAus } from '$lib/reckenAnzeige';
import { ladeRecke, ladeRuestkammer, seiteAus, sucheAus } from '$lib/server/armoryApi';
import type { PageServerLoad } from './$types';

/**
 * Die Rüstkammer: Liste und Profil, beides serverseitig gerendert.
 *
 * Das Profil steht in der Adresse (`?reck=<id>`), nicht in einer eigenen
 * Route: Die Adresse `/ruestkammer?reck=…` gibt es seit der Demo (die
 * Ruhmeshalle und Suchmaschinen kennen sie), die Slug-Tabelle und die
 * Sitemap bleiben unberührt, und die Seite bleibt auch ohne JavaScript
 * verlinkbar und lesbar. Vorgerendert wird nichts mehr, denn die Seite zeigt
 * den Stand des Spielservers; `prerender = false` übersteuert `+layout.ts`.
 *
 * Fehlt der Recke, ist das eine echte 404; antwortet nur der Spielserver
 * nicht, bleibt die Seite lesbar und sagt es ruhig (kein 500).
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, url }) => {
  const reck = url.searchParams.get('reck');
  if (reck !== null) {
    const id = reckenIdAus(reck);
    if (id === null) error(404, 'unknown-character');
    const r = await ladeRecke(fetch, id);
    if (!r.ok) {
      if (r.status === 404) error(404, 'unknown-character');
      return { ansicht: 'profil' as const, erreichbar: false, recke: null, liste: null, q: '' };
    }
    return { ansicht: 'profil' as const, erreichbar: true, recke: r.data, liste: null, q: '' };
  }

  const q = sucheAus(url.searchParams.get('q'));
  const seite = seiteAus(url.searchParams.get('seite'));
  const r = await ladeRuestkammer(fetch, q, seite);
  return {
    ansicht: 'liste' as const,
    erreichbar: r.ok,
    recke: null,
    liste: r.ok ? r.data : null,
    q,
  };
};
