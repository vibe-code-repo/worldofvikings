import type { PageServerLoad } from './$types';
import { ladeBretter } from '$lib/server/forumApi';

/**
 * Das Thing — die Bretteruebersicht, serverseitig geladen (M0/M2).
 *
 * Die Daten kommen aus der Forum-API des Spielservers ueber den
 * gemeinsamen Helfer `$lib/server/forumApi` (Typen, Fehlerbehandlung und
 * der API-Ort stehen dort an EINER Stelle). Ist der Spielserver nicht
 * erreichbar, bleibt die Seite lesbar und sagt es, statt 500 zu werfen.
 *
 * `prerender = false` uebersteuert die Vorgabe aus `+layout.ts`: Die
 * Bretterzahlen aendern sich mit jedem Beitrag.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch }) => {
  const r = await ladeBretter(fetch);
  if (!r.ok) return { boards: [], erreichbar: false };
  return { boards: r.data.boards, erreichbar: true };
};
