/**
 * The map tool registry. A new tool is ONE new file in this directory plus
 * ONE line in `WERKZEUGE`; `editorMain.ts`, the HUD and the sidebar pick it
 * up from here (tile, HUD text, clicks, overlay, Escape, sidebar block).
 * The order is the order of the tiles in the toolbar.
 *
 * Tools that are not listed (selection, island shape, polygon) are
 * still handled by the old branches in `editorMain.ts`; their ids are
 * `ALTE_WERKZEUGE` and reserved. How a tool moves over: see `typ.ts`.
 *
 * `registriere` checks the list once (no id twice, none reserved) and wraps
 * every tool so that one that throws cannot take the editor down (`schutz.ts`).
 */
import { erzeugeFluss } from './fluss';
import { erzeugeSee } from './see';
import { erzeugePlatzieren } from './platzieren';
import { pruefeRegistrierung, schuetze } from './schutz';
import type { KartenWerkzeug } from './typ';

/**
 * Ids of the tools that still run on the old path in `editorMain.ts` and
 * therefore may not be registered. Also the source of `AltesWerkzeugname`
 * (`KartenHud.ts`): when a tool moves into the registry, its id leaves this
 * list and the compiler points at every old table row and branch to delete.
 */
export const ALTE_WERKZEUGE = ['auswahl', 'form', 'polygon'] as const;

/** Check and guard a list of tools; the result has the same tuple type. */
export function registriere<T extends KartenWerkzeug[]>(...werkzeuge: T): T {
  pruefeRegistrierung(werkzeuge, ALTE_WERKZEUGE);
  return werkzeuge.map((w) => schuetze(w)) as unknown as T;
}

export const WERKZEUGE = registriere(erzeugeFluss(), erzeugeSee(), erzeugePlatzieren());

/** The placing tool with its own members (prefab choice, selection); the editor's catalog sets the prefab through it. */
export const platzierenWerkzeug = WERKZEUGE[2];

/** Ids of the registered tools, derived from the list above. */
export type RegistrierteId = (typeof WERKZEUGE)[number]['id'];

/** The registered tool with this id, or `undefined` (then the old branches apply). */
export function werkzeugMitId(id: string): KartenWerkzeug | undefined {
  return WERKZEUGE.find((w) => w.id === id);
}
