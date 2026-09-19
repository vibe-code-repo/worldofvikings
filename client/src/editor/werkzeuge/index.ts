/**
 * The map tool registry. A new tool is ONE new file in this directory plus
 * ONE line in `WERKZEUGE`; `editorMain.ts`, the HUD and the sidebar pick it
 * up from here (tile, HUD text, clicks, overlay, Escape, sidebar block).
 * The order is the order of the tiles in the toolbar.
 *
 * Tools that are not listed (selection, island shape, polygon, placing) are
 * still handled by the old branches in `editorMain.ts`.
 */
import { erzeugeFluss } from './fluss';
import { erzeugeSee } from './see';
import type { KartenWerkzeug } from './typ';

export const WERKZEUGE = [erzeugeFluss(), erzeugeSee()] as const;

/** Ids of the registered tools, derived from the list above. */
export type RegistrierteId = (typeof WERKZEUGE)[number]['id'];

/** The registered tool with this id, or `undefined` (then the old branches apply). */
export function werkzeugMitId(id: string): KartenWerkzeug | undefined {
  return WERKZEUGE.find((w) => w.id === id);
}
