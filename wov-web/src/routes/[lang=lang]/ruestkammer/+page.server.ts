import { error } from '@sveltejs/kit';
import { fehlerArt, reckenIdAus } from '$lib/reckenAnzeige';
import { adresseVon, ladeRecke, ladeRuestkammer, seiteAus, sucheAus } from '$lib/server/armoryApi';
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

export const load: PageServerLoad = async ({ fetch, url, getClientAddress }) => {
  const besucher = adresseVon(getClientAddress);
  const reck = url.searchParams.get('reck');
  if (reck !== null) {
    const id = reckenIdAus(reck);
    if (id === null) error(404, 'unknown-character');
    const r = await ladeRecke(fetch, id, { besucher });
    if (!r.ok) {
      if (r.status === 404) error(404, 'unknown-character');
      return {
        ansicht: 'profil' as const,
        erreichbar: false,
        fehler: fehlerArt(r.status),
        recke: null,
        liste: null,
        q: '',
      };
    }
    return {
      ansicht: 'profil' as const,
      erreichbar: true,
      fehler: null,
      recke: r.data,
      liste: null,
      q: '',
    };
  }

  const q = sucheAus(url.searchParams.get('q'));
  const seite = seiteAus(url.searchParams.get('seite'));
  const r = await ladeRuestkammer(fetch, q, seite, { besucher });
  return {
    ansicht: 'liste' as const,
    erreichbar: r.ok,
    fehler: r.ok ? null : fehlerArt(r.status),
    recke: null,
    liste: r.ok ? r.data : null,
    q,
  };
};
