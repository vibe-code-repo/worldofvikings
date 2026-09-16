import type { PageServerLoad } from './$types';

/**
 * Das Thing — die Bretteruebersicht, serverseitig geladen.
 *
 * ── Woher die Daten kommen ───────────────────────────────────────────
 * Aus der Forum-API des Spielservers (`server/src/forum/ForumApi.ts`),
 * die am Spielport 2467 haengt und ueber nginx unter `/api/forum/`
 * erreichbar ist. SERVERSEITIG wird sie direkt angesprochen
 * (`WOV_GAME_API`), nicht ueber den oeffentlichen Weg: Der Forum-Dienst
 * laeuft im selben Container, ein Umweg ueber den Proxy waere eine
 * ueberfluessige Runde durchs Netz.
 *
 * ── Warum diese Seite NICHT vorgerendert wird ────────────────────────
 * `prerender = false` uebersteuert die Vorgabe aus `+layout.ts`. Die
 * Bretterzahlen aendern sich mit jedem Beitrag; vorgerendert waeren sie
 * sofort falsch.
 *
 * ── Und wenn der Spielserver nicht laeuft? ───────────────────────────
 * Die Seite bleibt lesbar und SAGT es, statt 500 zu werfen. Ein Forum,
 * das die ganze Webseite mitreisst, wenn der Spielserver hustet, waere
 * der falsche Preis.
 */
const GAME_API = process.env.WOV_GAME_API ?? 'http://127.0.0.1:2467';

export const prerender = false;

/** Ein Brett samt den Zahlen, die die Uebersicht zeigt (Form von ForumApi). */
export interface BoardRow {
  slug: string;
  threadCount: number;
  postCount: number;
  lastActivity: number | null;
}

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch(`${GAME_API}/forum/boards`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { boards: [] as BoardRow[], erreichbar: false };
    const daten = (await res.json()) as { boards?: BoardRow[] };
    return { boards: daten.boards ?? [], erreichbar: true };
  } catch {
    return { boards: [] as BoardRow[], erreichbar: false };
  }
};
