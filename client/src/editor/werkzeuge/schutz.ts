/**
 * Guards of the tool registry, DOM-free (tested in
 * `client/test/werkzeug-registry.ts`):
 *
 *  - `pruefeRegistrierung` runs once when the registry is built and refuses a
 *    list that would silently break routing: an id twice, an empty id, or an
 *    id that still belongs to a tool on the old path.
 *  - `schuetze` wraps one tool so that a tool which throws cannot take the
 *    editor down. Every call the editor makes is caught per tool: the error is
 *    reported (with the tool id) and THAT call is skipped; the other tools, the
 *    overlay, the sidebar and the save button keep running.
 */
import type { KartenWerkzeug } from './typ';

/**
 * Refuse a registry list that would route wrongly. Throws an `Error` whose
 * message names the id and says what to do; it runs while `index.ts` loads, so
 * a mistake shows on the first page load and in the test, not in a click.
 *
 * `reserviert` are the ids of tools that still run on the old path in
 * `editorMain.ts`: a registered tool with such an id would be asked first and
 * silently shadow the old branch.
 */
export function pruefeRegistrierung(
  werkzeuge: ReadonlyArray<{ readonly id: string }>,
  reserviert: readonly string[]
): void {
  const gesehen = new Set<string>();
  for (const { id } of werkzeuge) {
    if (typeof id !== 'string' || id === '') {
      throw new Error('Tool registry: a tool has an empty id. Every tool needs its own non-empty id (werkzeuge/index.ts).');
    }
    if (reserviert.includes(id)) {
      throw new Error(
        `Tool registry: id "${id}" is reserved for a tool that still runs on the old path in editorMain.ts ` +
          `(ALTE_WERKZEUGE in werkzeuge/index.ts). To move that tool into the registry, remove the id from ` +
          `ALTE_WERKZEUGE and delete its old branches in the SAME change (see the note in werkzeuge/typ.ts).`
      );
    }
    if (gesehen.has(id)) {
      throw new Error(
        `Tool registry: id "${id}" is registered twice (werkzeuge/index.ts). Every tool needs its own id, ` +
          `otherwise only the first one would get clicks, keys and sidebar.`
      );
    }
    gesehen.add(id);
  }
}

/** Where a caught error goes: tool id, name of the call, the thrown value. */
export type FehlerSenke = (id: string, aufruf: string, fehler: unknown) => void;

/** Default sink: the browser console, with the tool id. */
export const anKonsole: FehlerSenke = (id, aufruf, fehler) => {
  console.error(`[werkzeuge] tool "${id}": ${aufruf} threw and is skipped for this call`, fehler);
};

/**
 * The same tool, with every call caught. What a skipped call returns:
 * `beiZeigerRunter` `true` (the click is consumed: it neither reaches the old
 * branches nor turns into a selection click), `beiTaste` `false` (the key does
 * not end the tool), `kachelZusatz`/`hudZusatz` `""`, `seitenleiste` `null`,
 * the others nothing. Optional members the tool does not have stay absent, so
 * the editor's `?.` calls keep their meaning. The sink itself may not throw.
 */
export function schuetze<T extends KartenWerkzeug>(w: T, senke: FehlerSenke = anKonsole): T {
  const sicher =
    <A extends unknown[], R>(aufruf: string, tu: (...a: A) => R, sonst: R) =>
    (...a: A): R => {
      try {
        return tu(...a);
      } catch (fehler) {
        try {
          senke(w.id, aufruf, fehler);
        } catch {
          // reporting must not bring the editor down either
        }
        return sonst;
      }
    };
  const g: KartenWerkzeug = {
    ...w,
    kachelZusatz: sicher('kachelZusatz', () => w.kachelZusatz(), ''),
    hudZusatz: sicher('hudZusatz', () => w.hudZusatz(), ''),
    beiZeigerRunter: sicher('beiZeigerRunter', (c, e) => w.beiZeigerRunter(c, e), true),
    abbrechen: sicher('abbrechen', (c) => w.abbrechen(c), undefined),
  };
  if (w.beiDoppelklick) g.beiDoppelklick = sicher('beiDoppelklick', (c) => w.beiDoppelklick!(c), undefined);
  if (w.beiTaste) g.beiTaste = sicher('beiTaste', (c, e) => w.beiTaste!(c, e), false);
  if (w.zeichneOverlay) g.zeichneOverlay = sicher('zeichneOverlay', (c, z) => w.zeichneOverlay!(c, z), undefined);
  if (w.seitenleiste) g.seitenleiste = sicher('seitenleiste', (c, h) => w.seitenleiste!(c, h), null);
  return g as T;
}
