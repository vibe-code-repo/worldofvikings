/**
 * Contract of a map tool of the web map editor.
 *
 * A tool is ONE file in this directory plus ONE line in `index.ts`. It owns
 * everything that belongs to it: the half-finished stroke it keeps between
 * two clicks, what a click does to the document, what it draws on the map,
 * the tile text, the HUD text, and its block in the sidebar. The editor
 * (`editorMain.ts`) only asks the registry which tool is active and hands
 * it the events -- it does not know what a river or a lake is any more.
 *
 * The interface has exactly what the tools that use it (river, lake, placing)
 * need. A hook nobody exercises is guessing; when a later tool needs one, it
 * is added here together with its call site and a test, not before. The
 * placing tool brought pointer move and pointer up (a drag) and the
 * confirmation dialog; call sites in `editorMain.ts`, tests in
 * `client/test/werkzeug-platzieren.ts`.
 *
 * DOM-free on purpose: `ZeigerEreignis` is not a `PointerEvent`, and all
 * access to the editor goes through `WerkzeugKontext`, so a tool runs
 * against a fake context in a plain Node test (`client/test/werkzeug-registry.ts`).
 * Only `seitenleiste` builds DOM, and only when the editor calls it.
 *
 * Moving a tool from the old path into the registry (selection, island shape
 * and polygon still run as `if (werkzeug === '<id>')` branches in
 * `editorMain.ts`; their ids are reserved in `ALTE_WERKZEUGE`, `index.ts`).
 * ONE change does all of it, because half of it either shadows the old branch
 * or leaves dead code:
 *   1. `werkzeuge/<id>.ts`: a factory `erzeuge<Name>(): KartenWerkzeug<'<id>'>`
 *      with the state that lived in module variables of `editorMain.ts`.
 *   2. `index.ts`: add `erzeuge<Name>()` to the `registriere(...)` call AND
 *      remove '<id>' from `ALTE_WERKZEUGE`. Doing only the first throws while
 *      the registry loads ("id ... is reserved"); doing only the second leaves
 *      the old branches, which the registry would now shadow.
 *   3. Delete the old path: the `if (werkzeug === '<id>')` branches (pointer,
 *      Escape, sidebar block), the tile, the module variables, the entries in
 *      `WERKZEUG_TEXT`/`hudZusatz` (`editorMain.ts`) and in `WERKZEUG_BILD`/
 *      `WERKZEUG_TASTEN` (`KartenHud.ts`). Shrinking `ALTE_WERKZEUGE` makes
 *      the compiler point at those tables.
 *   4. `client/test/werkzeug-registry.ts`: the tool's checks against a fake
 *      context, and its id in the list of registered ids.
 * A tool that throws is caught per call by the registry (`schutz.ts`): the
 * error is logged with its id and that call is skipped, the editor goes on.
 */
import type { WorldLayout } from '@wov/shared';
import type { Vorgang } from '@wov/shared/src/worldlayout/ops.js';

/** A click on the map with the picking already done. */
export interface ZeigerEreignis {
  /** World position (metres) under the pointer. */
  weltX: number;
  weltZ: number;
  /** Shift held: series mode (the tool stays active after it has placed something). */
  shiftKey: boolean;
  /**
   * The pointer this event belongs to (`PointerEvent.pointerId`), when the editor has one. A tool that
   * follows a gesture (a drag) remembers it at the press and ignores moves and releases of another pointer.
   */
  zeigerId?: number;
}

/** A key press; only what a tool may look at. */
export interface TastenEreignis {
  code: string;
}

/**
 * What a tool may do to the editor. Every member is one thing the old
 * `if (werkzeug === ...)` branches did directly on module state.
 */
export interface WerkzeugKontext {
  /** The document as it is right now (immutable: replaced, never edited in place). */
  layout(): WorldLayout;
  /**
   * Replace the document by `neu` AS ONE UNDO STEP: pushes the current
   * document onto the undo stack, then assigns. Does not save or redraw --
   * call `uebernommen()` after the tool has set its own state.
   *
   * `vorgang` is the world operation (`shared/src/worldlayout/ops.ts`) whose
   * result `neu` is, for a tool that builds its change as one. The editor
   * keeps snapshots for undo and does not use it yet; it is the hand-over
   * point for sending the same change as a PATCH (stage E2), and it is what
   * a test looks at to see WHAT the tool asked for.
   */
  aendere(neu: WorldLayout, vorgang?: Vorgang): void;
  /**
   * Ask the user a yes/no question and wait for the answer (synchronous:
   * the editor uses the browser's `confirm`). `false` = declined.
   */
  bestaetige(frage: string): boolean;
  /** Id of the tool that is active right now. */
  werkzeugId(): string;
  /** Back to the selection tool (state only: no redraw, see `uebernommen`). */
  zurAuswahl(): void;
  /** After a change: save the draft, rebuild sidebar and report, redraw, restart the preview. */
  uebernommen(): void;
  /** Rebuild the sidebar (point counters, close button). */
  seiteNeuBauen(): void;
  /** Redraw the map overlay. */
  neuZeichnen(): void;
  /** Message in the status bar; `fehler` shows it as a warning. */
  meldung(text: string, fehler?: boolean): void;
  /** World metres -> pixel on the overlay canvas. */
  zuBild(wx: number, wz: number): [number, number];
  /** World metres per pixel of the overlay canvas. */
  massstab(): number;
}

/** Small builders the editor hands to a tool for its sidebar block. */
export interface SeitenHost {
  /** Grey hint line under a tool. */
  hinweis(text: string): HTMLElement;
  /** Label above a control. */
  beschriftet(text: string, inhalt: HTMLElement): HTMLElement;
  /** Full-width button; `pfad` is an icon path from `PFAD`. */
  breiterKnopf(text: string, cb: () => void, pfad?: string): HTMLElement;
}

export interface KartenWerkzeug<Id extends string = string> {
  readonly id: Id;
  /** Plain-text name in the HUD tool display, e.g. "Fluss zeichnen". */
  readonly titel: string;
  /** Icon path (`PFAD.*`), used by the tile and the HUD. */
  readonly bild: string;
  /** Label of the tile in the sidebar grid. */
  readonly kachelName: string;
  /** The tile spans both columns of the grid (the last, wide one). */
  readonly kachelBreit?: boolean;
  /** Tooltip of the tile. */
  readonly kachelTipp: string;
  /** Key help in the HUD: pairs of (key, effect). */
  readonly tasten: ReadonlyArray<readonly [string, string]>;
  /** Short text next to the tile label while the tool is active ("" = none). */
  kachelZusatz(): string;
  /** Mono badge in the HUD tool display ("" = none). */
  hudZusatz(): string;

  /**
   * Click on the map while this tool is active (selection handles of the
   * selected region and the start-point mode take precedence and never get
   * here). `true` = the tool handled it. `false` = not its click; the editor
   * then treats it as a plain selection click.
   */
  beiZeigerRunter(ctx: WerkzeugKontext, e: ZeigerEreignis): boolean;
  /**
   * The pointer moves over the map while this tool is active (with or without
   * a button pressed: the tool knows from its own state whether it is in the
   * middle of a drag). Called for every move, so keep it cheap.
   */
  beiZeigerBewegt?(ctx: WerkzeugKontext, e: ZeigerEreignis): void;
  /**
   * The primary button is released (or the pointer is cancelled) while this
   * tool is active. The editor captures the pointer when the tool has this
   * hook, so the release arrives even when it happens outside the map.
   */
  beiZeigerHoch?(ctx: WerkzeugKontext, e: ZeigerEreignis): void;
  /**
   * The pointer gesture ends WITHOUT an effect: the pointer was cancelled (`pointercancel`), the button was
   * released outside the map (over the sidebar, outside the window), or the capture was lost. A half-done
   * drag is dropped and nothing is committed. Called only on a tool that has `beiZeigerHoch`.
   */
  beiZeigerAbbruch?(ctx: WerkzeugKontext): void;
  /**
   * A click landed on a floating control that lies over the map (overview, zoom buttons, tool display) and not on
   * the map itself. For a tool it is a click "somewhere else", like a click on nothing: a selection that could be
   * out of the picture afterwards (the overview moves the map) must not stay armed for Delete.
   */
  beiFlaechenKlick?(ctx: WerkzeugKontext): void;
  /** Double click while this tool is active. */
  beiDoppelklick?(ctx: WerkzeugKontext): void;
  /**
   * Key press while this tool is active: Escape, and the keys the editor passes on
   * (Delete, Backspace, the tool's own letters; never while an input field has the
   * focus, never with Ctrl/Alt/Meta/Shift). `true` for Escape = the key ENDS this tool: the
   * editor then discards every half-finished stroke (`abbrechen` of all tools)
   * and returns to the selection tool. The result for any other key is ignored.
   */
  beiTaste?(ctx: WerkzeugKontext, e: TastenEreignis): boolean;
  /** Draw the tool state onto the overlay canvas. Called for every tool, active or not. */
  zeichneOverlay?(ctx: WerkzeugKontext, zeichner: CanvasRenderingContext2D): void;
  /**
   * Discard the half-finished stroke, silently. Called when the tool is
   * picked in the toolbar (either direction), on Escape, and when a draft
   * from another tab replaces the document.
   */
  abbrechen(ctx: WerkzeugKontext): void;
  /** The tool's block in the sidebar, shown while the tool is active (`null` = none). */
  seitenleiste?(ctx: WerkzeugKontext, host: SeitenHost): HTMLElement | null;
}
