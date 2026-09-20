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
 *
 * One level up, `erzeugeEditorKern` builds everything the editor needs around
 * that context and that used to be written in `editorMain.ts`: the undo stack
 * (`verlauf`), `merkeSchritt` and `alles` (save the draft, rebuild the panels,
 * redraw) -- and the ONE tool context. `editorMain.ts` cannot be loaded without
 * a window, so the two functions that both promises hang on could only be read
 * as text there; here they are executed by the test. `editorMain.ts` calls
 * `erzeugeEditorKern` exactly once, and every tool hook it calls gets the
 * context of that one call (`entwurfs-speicher.ts` checks both on the syntax
 * tree, so line breaks, quotes, comments and helper variables do not matter).
 */
import type { WorldLayout } from '@wov/shared';
import type { Vorgang } from '@wov/shared/src/worldlayout/ops.js';
import { SchrittVerlauf, type AbgangHoerer, type SpeicherGrund } from '../entwurfsSpeicher';
import type { EntwurfsQuelle } from '../weltdokument';
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
  // Eingefroren: ein spaeteres `Object.assign(kontext, …)` oder eine Zuweisung an ein Glied wirft, statt die beiden
  // Zusagen (Schritt vor der Aenderung, Speichern danach) still auszuhebeln.
  const kontext: WerkzeugKontext = {
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
  return Object.freeze(kontext);
}

/** What the editor kernel needs from the editor window. Every member is one thing `editorMain.ts` does with its module state. */
export interface KernHost {
  /** The document as it is right now. */
  layout(): WorldLayout;
  /** Replace the document (the editor's `layout = neu`); nothing else. */
  setzeLayout(neu: WorldLayout): void;
  /** The undo stack lets a step go (`SchrittVerlauf` listener): the editor keeps it in the ring of displaced drafts. */
  beiAbgang: AbgangHoerer<WorldLayout>;
  /** After a step was pushed: the editor notes whether the document now builds on a foreign one (`ersetzt`: replaced, not built upon). */
  nachSchritt(ersetzt: boolean): void;
  /** Write the draft to the browser storage and say why not, if it did not go through. */
  speichereEntwurf(quelle: EntwurfsQuelle): SpeicherGrund;
  seiteBauen(): void;
  pruefberichtBauen(): void;
  weltSektionBauen(): void;
  kartenMassBauen(): void;
  zeichneOverlay(): void;
  faerbeSpeicherKnopf(): void;
  vorschauAnstossen(): void;
  werkzeugId(): string;
  zurAuswahl(): void;
  meldung(text: string, fehler?: boolean): void;
  zuBild(wx: number, wz: number): [number, number];
  massstab(): number;
  bestaetige(frage: string): boolean;
}

export interface EditorKern {
  /** The undo stack (Ctrl+Z / Ctrl+Y, and the one `merkeSchritt` pushes onto). */
  readonly verlauf: SchrittVerlauf<WorldLayout>;
  /** THE context every map tool gets. */
  readonly werkzeugKontext: WerkzeugKontext;
  /** Push the current document onto the undo stack. `ersetzt`: the draft is replaced by ANOTHER one (import, server state), not built upon. */
  merkeSchritt(ersetzt?: boolean): void;
  /**
   * Save the draft (unless `entwurfSchreiben` is false), rebuild the panels, redraw. Returns the reason of a message
   * no caller may overwrite ('fremd' | 'voll' | 'knapp') or 'ok'.
   */
  alles(quelle?: EntwurfsQuelle, entwurfSchreiben?: boolean): SpeicherGrund;
}

export function erzeugeEditorKern(host: KernHost): EditorKern {
  const verlauf = new SchrittVerlauf<WorldLayout>(50, host.beiAbgang);
  function merkeSchritt(ersetzt = false): void {
    verlauf.merke(host.layout(), ersetzt);
    host.nachSchritt(ersetzt);
  }
  function alles(quelle: EntwurfsQuelle = 'bearbeitet', entwurfSchreiben = true): SpeicherGrund {
    const grund: SpeicherGrund = entwurfSchreiben ? host.speichereEntwurf(quelle) : 'ok';
    host.seiteBauen();
    host.pruefberichtBauen();
    host.weltSektionBauen();
    host.kartenMassBauen(); // B6/B7 -- own track, see KartenMassAnzeige.ts
    host.zeichneOverlay();
    // Every change can move the draft away from the server state OR (by undo) bring it back onto it --
    // the dot at the save button has to follow both.
    host.faerbeSpeicherKnopf();
    return grund;
  }
  const werkzeugKontext = erzeugeWerkzeugKontext({
    layout: () => host.layout(),
    setzeLayout: (neu) => host.setzeLayout(neu),
    merkeSchritt: () => merkeSchritt(),
    werkzeugId: () => host.werkzeugId(),
    zurAuswahl: () => host.zurAuswahl(),
    alles: () => void alles(),
    vorschauAnstossen: () => host.vorschauAnstossen(),
    seiteBauen: () => host.seiteBauen(),
    zeichneOverlay: () => host.zeichneOverlay(),
    meldung: (text, fehler) => host.meldung(text, fehler),
    zuBild: (wx, wz) => host.zuBild(wx, wz),
    massstab: () => host.massstab(),
    bestaetige: (frage) => host.bestaetige(frage),
  });
  return Object.freeze({ verlauf, werkzeugKontext, merkeSchritt, alles });
}
