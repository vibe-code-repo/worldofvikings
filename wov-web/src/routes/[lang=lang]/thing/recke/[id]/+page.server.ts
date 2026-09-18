import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ladeCharakter, ladeCharakterAktivitaet } from '$lib/server/forumApi';

/**
 * Das oeffentliche Thing-Profil eines Charakters (M6).
 *
 * Zwei Quellen: Der Charakter selbst kommt aus der Konten-API (Name und
 * Aussehen, sonst nichts — dieselbe oeffentliche Huelle wie beim Avatar),
 * die Beitraege aus der Forums-API. Fehlt der Charakter, ist das eine echte
 * 404; ist nur der Spielserver weg, bleibt die Seite lesbar und sagt es.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) error(404, 'unknown-character');

  const c = await ladeCharakter(fetch, id);
  if (!c.ok) {
    if (c.status === 404) error(404, 'unknown-character');
    return { erreichbar: false, charakter: null, aktivitaet: null };
  }

  const a = await ladeCharakterAktivitaet(fetch, id);
  return {
    erreichbar: true,
    charakter: c.data.character,
    aktivitaet: a.ok ? a.data : null,
  };
};
