/**
 * Test flight: place-mode click decision, drag threshold and the "series" switch.
 * DOM-free, so the test can drive it without a scene.
 * Testflug: Entscheidung beim Klick (Setzen-Modus), Ziehschwelle und der Schalter „Serie“.
 * Ohne DOM, damit der Test es ohne Szene fahren kann.
 *
 *   - While a prefab is chosen and its ghost shows (`setzenModus`), a left click PLACES,
 *     it never grabs; grabbing then needs Alt held. Without a chosen prefab a click
 *     grabs the nearest placement within GRIFFRADIUS as before.
 *   - A grab becomes a drag only after more than 4 px of mouse travel (8 px touch/pen);
 *     the object keeps the grab offset, its centre does not jump to the mouse point.
 */

/** Grab radius around a placement's pivot (m). */
export const GRIFFRADIUS = 3;
/** Pointer travel (px) after which a grab becomes a drag. */
export const SCHWELLE_MAUS = 4;
export const SCHWELLE_BERUEHRUNG = 8;
/** A second place click within this time (ms) and DOPPEL_BILD_PX screen pixels of the last one is a double click. */
export const DOPPEL_ZEIT = 400;
export const DOPPEL_BILD_PX = 5;
export const DOPPEL_TOUCH_PX = 10;
/** Browser key of the "series" switch. */
export const SERIE_SCHLUESSEL = 'wov-editor-spawn-serie';

export interface Punkt {
  x: number;
  z: number;
}

export type KlickEntscheidung = { art: 'setzen' } | { art: 'greifen'; index: number } | { art: 'nichts' };

export interface KlickEingabe {
  /** A prefab is chosen and its ghost shows (panel open and place mode on). */
  setzenModus: boolean;
  /** Alt held: grab even in place mode. */
  alt: boolean;
  /** The ground point under the mouse. */
  punkt: Punkt;
  /** The placements at their VISIBLE place (a walking route NPC is not where its entry says). */
  platzierungen: readonly Punkt[];
}

/** What a left click does: place, grab placement `index`, or nothing. */
export function entscheideKlick(e: KlickEingabe): KlickEntscheidung {
  if (e.setzenModus && !e.alt) return { art: 'setzen' };
  let best = -1;
  let bestD = GRIFFRADIUS;
  e.platzierungen.forEach((q, i) => {
    const d = Math.hypot(q.x - e.punkt.x, q.z - e.punkt.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best >= 0) return { art: 'greifen', index: best };
  return e.setzenModus ? { art: 'setzen' } : { art: 'nichts' };
}

/** Place mode after a placement: with "series" it stays on, without it ends (the old behaviour). */
export function modusNachSetzen(serie: boolean): boolean {
  return serie;
}

/** The place a grab measures its offset against: where the object is SEEN, else its stored entry. */
export function griffPosition(sichtbar: Punkt | null | undefined, gespeichert: Punkt): Punkt {
  return sichtbar ?? gespeichert;
}

/** Stops a double click from placing twice at the same spot (series mode keeps the place mode on). */
export class DoppelklickSperre {
  private letzte: { zeit: number; bild: Punkt | null; zelle: Punkt } | null = null;

  /**
   * `true`: this place click is the second of a double click and places nothing.
   * It is judged on the SCREEN (a double click scatters in pixels, not in metres): within
   * DOPPEL_ZEIT and DOPPEL_BILD_PX (DOPPEL_TOUCH_PX for touch) of the last placement.
   */
  blockiert(zeit: number, bild: Punkt, pointerType = 'mouse'): boolean {
    const l = this.letzte;
    if (!l?.bild || !(zeit - l.zeit <= DOPPEL_ZEIT)) return false;
    const grenze = pointerType === 'mouse' ? DOPPEL_BILD_PX : DOPPEL_TOUCH_PX;
    return Math.hypot(bild.x - l.bild.x, bild.z - l.bild.z) <= grenze;
  }

  /** `true`: the same (rounded) cell was placed on within DOPPEL_ZEIT (key P, button, captured mouse). */
  blockiertZelle(zeit: number, zelle: Punkt): boolean {
    const l = this.letzte;
    if (!l || !(zeit - l.zeit <= DOPPEL_ZEIT)) return false;
    return l.zelle.x === zelle.x && l.zelle.z === zelle.z;
  }

  /** A placement happened in `zelle` at `zeit`; `bild` is the screen point of a click (null for P/button). */
  gesetzt(zeit: number, zelle: Punkt, bild: Punkt | null = null): void {
    this.letzte = { zeit, bild, zelle };
  }
}

type Speicher = Pick<Storage, 'getItem' | 'setItem'>;

function standardSpeicher(): Speicher | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored "series" switch, default OFF; a blocked or empty store gives the default. */
export function ladeSerie(speicher: Speicher | undefined = standardSpeicher()): boolean {
  try {
    return speicher?.getItem(SERIE_SCHLUESSEL) === '1';
  } catch {
    return false;
  }
}

export function speichereSerie(serie: boolean, speicher: Speicher | undefined = standardSpeicher()): void {
  try {
    speicher?.setItem(SERIE_SCHLUESSEL, serie ? '1' : '0');
  } catch {
    // no store: the switch only lives until the reload
  }
}

/** One grab: no move until the pointer has travelled past the threshold, then the grab offset holds. */
export class Ziehgriff {
  private gezogen = false;
  private readonly schwelle: number;
  private readonly versatz: Punkt;

  constructor(
    readonly id: string,
    private readonly maus: { x: number; y: number },
    punkt: Punkt,
    objekt: Punkt,
    zeigerArt: string
  ) {
    this.schwelle = zeigerArt === 'mouse' ? SCHWELLE_MAUS : SCHWELLE_BERUEHRUNG;
    this.versatz = { x: objekt.x - punkt.x, z: objekt.z - punkt.z };
  }

  get istGezogen(): boolean {
    return this.gezogen;
  }

  /** Pointer moved: the new centre of the object, or `null` while it is still a plain click. */
  bewege(maus: { x: number; y: number }, punkt: Punkt): Punkt | null {
    if (!this.gezogen) {
      if (Math.hypot(maus.x - this.maus.x, maus.y - this.maus.y) <= this.schwelle) return null;
      this.gezogen = true;
    }
    return { x: punkt.x + this.versatz.x, z: punkt.z + this.versatz.z };
  }
}
