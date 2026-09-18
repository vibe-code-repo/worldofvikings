import type { PageServerLoad } from './$types';
import { SEARCH_QUERY_MAX } from '@wov/shared';
import { ladeSuche, seiteAus } from '$lib/server/forumApi';

/**
 * Die Suche, serverseitig geladen (M6).
 *
 * Der Begriff steht in der Adresse (`?q=`), die Treffer kommen als HTML —
 * so ist eine Suche teilbar und fuer Suchmaschinen lesbar. Ein
 * unerreichbarer Spielserver wird wie ueberall behandelt: Die Seite bleibt
 * stehen und sagt es, statt 500 zu werfen.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX);
  const seite = seiteAus(url);
  const r = await ladeSuche(fetch, q, seite);

  if (!r.ok) {
    return { erreichbar: false, q, results: [], page: 1, pageCount: 1, total: 0 };
  }
  return {
    erreichbar: true,
    q,
    results: r.data.results,
    page: r.data.page,
    pageCount: r.data.pageCount,
    total: r.data.total,
  };
};
