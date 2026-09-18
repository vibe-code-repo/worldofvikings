import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ladeThemaSeite, seiteAus } from '$lib/server/forumApi';
import { renderMarkdown } from '$lib/server/forumMarkdown';

/**
 * Ein Thema mit seinen Beitraegen, serverseitig geladen und gerendert (M2).
 *
 * Das Markdown wird HIER zu HTML: Der Browser bekommt fertiges HTML und
 * keine Markdown-Bibliothek. Die HTML-Zeichenkette stammt aus
 * `renderMarkdown` (markdown-it mit `html: false` und sicheren Link-/
 * Bild-Attributen) — deshalb darf die Seite sie mit `{@html}` einsetzen.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, params, url }) => {
  const id = Number(params.threadId);
  if (!Number.isInteger(id) || id <= 0) error(404, 'unknown-thread');

  const seite = seiteAus(url);
  const r = await ladeThemaSeite(fetch, id, seite);

  if (!r.ok) {
    if (r.status === 404) error(404, 'unknown-thread');
    return { erreichbar: false, thread: null, posts: [], page: 1, pageCount: 1 };
  }

  const { thread, posts, page, pageCount } = r.data;
  return {
    erreichbar: true,
    thread,
    posts: posts.map((p) => ({ ...p, html: renderMarkdown(p.bodyMd) })),
    page,
    pageCount,
  };
};
