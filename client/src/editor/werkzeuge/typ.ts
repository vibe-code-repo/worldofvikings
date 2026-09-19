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
 * The interface has exactly what the two tools that use it (river, lake)
 * need. A hook nobody exercises is guessing; when a later tool needs one
 * (pointer move, pointer up ...), it is added here together with its call
 * site and a test, not before.
 *
 * DOM-free on purpose: `ZeigerEreignis` is not a `PointerEvent`, and all
 * access to the editor goes through `WerkzeugKontext`, so a tool runs
 * against a fake context in a plain Node test (`client/test/werkzeug-registry.ts`).
 * Only `seitenleiste` builds DOM, and only when the editor calls it.
 */
import type { WorldLayout } from '@wov/shared';

/** A click on the map with the picking already done. */
export interface ZeigerEreignis {
  /** World position (metres) under the pointer. */
  weltX: number;
  weltZ: number;
  /** Shift held: series mode (the tool stays active after it has placed something). */
  shiftKey: boolean;
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
   */
  aendere(neu: WorldLayout): void;
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
  /** Double click while this tool is active. */
  beiDoppelklick?(ctx: WerkzeugKontext): void;
  /**
   * Key press while this tool is active. `true` = the key ENDS this tool
   * (Escape): the editor then discards every half-finished stroke
   * (`abbrechen` of all tools) and returns to the selection tool.
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
  /** The tool's block in the sidebar, shown while the tool is active. */
  seitenleiste?(ctx: WerkzeugKontext, host: SeitenHost): HTMLElement;
}
