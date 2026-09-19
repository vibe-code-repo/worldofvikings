/**
 * The context the editor hands to its map tools (`WerkzeugKontext`), built from
 * a small host so that it runs without an editor window.
 *
 * Why it is a module of its own: two promises hang on the two members that
 * change the document, and a text search of `editorMain.ts` cannot keep them
 * (`if (false) merkeSchritt();` and a commented-out call both pass a search):
 *
 *  - `aendere` records the undo step BEFORE the document is replaced. Every
 *    change of a tool is one undo step, whatever the tool.
 *  - `uebernommen` runs `alles()` (which saves the draft) AFTER the tool has
 *    changed the document, and then restarts the preview: change -> save.
 *
 * `client/test/entwurfs-speicher.ts` runs a real tool through this context with
 * the editor's own `SchrittVerlauf` and a host that logs its calls, and checks
 * the order of the calls and that undo brings the document back byte for byte.
 * `editorMain.ts` only has to use this function (a one-line source check).
 */
import type { WorldLayout } from '@wov/shared';
import type { Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import type { WerkzeugKontext } from './typ';

/** What the context needs from the editor. Every member is one thing `editorMain.ts` does with its module state. */
export interface KontextHost {
  /** The document as it is right now. */
  layout(): WorldLayout;
  /** Replace the document (the editor's `layout = neu`); nothing else. */
  setzeLayout(neu: WorldLayout): void;
  /** Push the current document onto the undo stack (the editor's `merkeSchritt`). */
  merkeSchritt(): void;
  /** Id of the active tool. */
  werkzeugId(): string;
  /** Back to the selection tool (state only). */
  zurAuswahl(): void;
  /** Save the draft, rebuild sidebar and report, redraw (the editor's `alles`). */
  alles(): void;
  /** Restart the map preview (debounced by the editor). */
  vorschauAnstossen(): void;
  seiteBauen(): void;
  zeichneOverlay(): void;
  meldung(text: string, fehler?: boolean): void;
  zuBild(wx: number, wz: number): [number, number];
  massstab(): number;
  bestaetige(frage: string): boolean;
}

export function erzeugeWerkzeugKontext(host: KontextHost): WerkzeugKontext {
  return {
    layout: () => host.layout(),
    aendere(neu: WorldLayout, _vorgang?: Vorgang): void {
      host.merkeSchritt();
      host.setzeLayout(neu);
    },
    bestaetige: (frage) => host.bestaetige(frage),
    werkzeugId: () => host.werkzeugId(),
    zurAuswahl: () => host.zurAuswahl(),
    uebernommen(): void {
      host.alles();
      host.vorschauAnstossen();
    },
    seiteNeuBauen: () => host.seiteBauen(),
    neuZeichnen: () => host.zeichneOverlay(),
    meldung: (text, fehler) => host.meldung(text, fehler),
    zuBild: (wx, wz) => host.zuBild(wx, wz),
    massstab: () => host.massstab(),
  };
}
