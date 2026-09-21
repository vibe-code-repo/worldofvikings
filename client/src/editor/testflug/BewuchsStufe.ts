/**
 * Switch for the vegetation preview of the offline flight: full / small / off.
 *
 * Schalter fuer die Bewuchs-Vorschau im Testflug (Taste L): voll = 5x5 Zonen
 * (wie bisher), klein = 3x3, aus = keine Vorschau.
 *
 * Why: the preview is the biggest single item in the frame (M2.0 measurement,
 * Bauhoehe 30 m, still: 14.1 -> 9.2 ms without it), and whoever places objects
 * does not need the vegetation in full density — it even hides the work. The
 * default stays "voll"; the choice survives a restart (localStorage).
 *
 * The functions before `verdrahteBewuchsStufe` are DOM-free (tested in
 * `client/test/bewuchs-vorschau.ts`); only the wiring touches `window`.
 *
 * Measurement hook: with `?bewuchs-messung=1` in the address the preview is
 * exposed as `window.__bewuchs` so that `tools/pw-testflug-bench.mjs` can read
 * its counters and drive the level. Without the parameter nothing is exposed.
 */
import type { Hud } from "../../ui/Hud";
import {
  BEWUCHS_STUFEN_LISTE,
  STUFEN_RADIUS,
  type BewuchsStufe,
  type BewuchsVorschau,
} from "../BewuchsVorschau";

/** localStorage entry that keeps the chosen level across a restart. */
export const BEWUCHS_STUFE_KEY = "wov-editor-bewuchs-stufe";

/** Key that cycles the level (free in the flight: B/R/V/E/F/P/M/I/C/X are taken, G/Q/T by the jump). */
export const BEWUCHS_STUFE_TASTE = "KeyL";

/** Query parameter that exposes the preview as `window.__bewuchs` (measurement only). */
export const BEWUCHS_MESSUNG_PARAM = "bewuchs-messung";

/** True only for `?bewuchs-messung=1`: the presence of the parameter alone, or any other value, keeps the hook closed. */
export function messhakenOffen(search: string): boolean {
  return new URLSearchParams(search).get(BEWUCHS_MESSUNG_PARAM) === "1";
}

/** The part of `Storage` the switch needs; a missing or throwing one means "voll". */
export type StufenSpeicher = Pick<Storage, "getItem" | "setItem">;

export function istBewuchsStufe(wert: unknown): wert is BewuchsStufe {
  return typeof wert === "string" && (BEWUCHS_STUFEN_LISTE as readonly string[]).includes(wert);
}

/** Stored level, "voll" when nothing valid is stored or the storage is unusable. */
export function leseBewuchsStufe(speicher: StufenSpeicher | null): BewuchsStufe {
  try {
    const wert = speicher?.getItem(BEWUCHS_STUFE_KEY);
    return istBewuchsStufe(wert) ? wert : "voll";
  } catch {
    return "voll";
  }
}

/** Stores the level; false when the storage refused (private window, quota). */
export function schreibeBewuchsStufe(
  speicher: StufenSpeicher | null,
  stufe: BewuchsStufe,
): boolean {
  try {
    if (!speicher) return false;
    speicher.setItem(BEWUCHS_STUFE_KEY, stufe);
    return true;
  } catch {
    return false;
  }
}

/** voll -> klein -> aus -> voll. */
export function naechsteBewuchsStufe(stufe: BewuchsStufe): BewuchsStufe {
  return BEWUCHS_STUFEN_LISTE[
    (BEWUCHS_STUFEN_LISTE.indexOf(stufe) + 1) % BEWUCHS_STUFEN_LISTE.length
  ];
}

/** Short line for the HUD chip. */
export function bewuchsStufeText(stufe: BewuchsStufe): string {
  const r = STUFEN_RADIUS[stufe];
  const flaeche = r < 0 ? "aus" : `${2 * r + 1} × ${2 * r + 1} Zonen`;
  return `Bewuchs: ${stufe} (${flaeche}) · L wechselt`;
}

/**
 * Applies the stored level, binds the key L and keeps a small chip at the
 * bottom left that names the active level. The Testflug calls this once.
 */
export function verdrahteBewuchsStufe(
  bewuchs: BewuchsVorschau,
  optionen: { hud: Pick<Hud, "meldung">; tipptImFeld: (e: KeyboardEvent) => boolean },
): void {
  let speicher: Storage | null = null;
  try {
    speicher = window.localStorage;
  } catch {
    speicher = null;
  }
  const chip = document.createElement("div");
  chip.style.cssText =
    "position:fixed;left:14px;bottom:14px;color:#fff;font:12px monospace;background:rgba(0,0,0,.45);" +
    "padding:4px 10px;border-radius:4px;pointer-events:none;z-index:4";
  document.body.appendChild(chip);
  const zeige = (): void => {
    chip.textContent = bewuchsStufeText(bewuchs.stufe);
  };

  bewuchs.setzeStufe(leseBewuchsStufe(speicher));
  zeige();
  if (messhakenOffen(window.location.search)) {
    (window as unknown as Record<string, unknown>).__bewuchs = bewuchs;
  }

  window.addEventListener("keydown", (e) => {
    if (optionen.tipptImFeld(e) || e.code !== BEWUCHS_STUFE_TASTE || e.repeat) return;
    // Umschalt ist im Baumodus die Turbotaste: wer schnell fliegt und L streift, soll nichts umschalten.
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    bewuchs.setzeStufe(naechsteBewuchsStufe(bewuchs.stufe));
    const gespeichert = schreibeBewuchsStufe(speicher, bewuchs.stufe);
    zeige();
    optionen.hud.meldung(
      `${bewuchsStufeText(bewuchs.stufe)}${gespeichert ? "" : " — nicht gespeichert (Browser-Speicher gesperrt)"}`,
    );
  });
}
