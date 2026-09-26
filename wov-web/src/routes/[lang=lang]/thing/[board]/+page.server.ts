import { error } from '@sveltejs/kit';
import { ladeThemenSeite, seiteAus } from '$lib/server/forumApi';
import type { PageServerLoad } from './$types';

/**
 * Themenliste eines Bretts, serverseitig geladen (M2).
 *
 * 404 nur, wenn die API das Brett wirklich nicht kennt. Ist der Spielserver
 * dagegen nicht erreichbar (`status === 0`), bleibt die Seite lesbar und
 * sagt es — dieselbe Regel wie in der Bretteruebersicht.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, params, url }) => {
  const brett = params.board;
  const seite = seiteAus(url);
  const r = await ladeThemenSeite(fetch, brett, seite);

  if (!r.ok) {
    if (r.status === 404) error(404, 'unknown-board');
    return { erreichbar: false, board: brett, threads: [], page: 1, pageCount: 1 };
  }

  return {
    erreichbar: true,
    board: brett,
    threads: r.data.threads,
    page: r.data.page,
    pageCount: r.data.pageCount,
  };
};
