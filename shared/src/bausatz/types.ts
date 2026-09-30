/**
 * Building kits ("Bausätze", editor block C2): a reusable group of objects with
 * its own anchor and rotation, e.g. a whole village. This file holds only the
 * types and limits — DOM-free, no server or client imports, so converter tools
 * (`tools/*.mjs` via tsx) can use it.
 *
 * Kit file `server/data/bausaetze/<id>.json` → `Bausatz`. The world document
 * (`WorldLayout.bausaetze`) places kits by `BausatzInstanzDef`; the resolver
 * (`aufloesen.ts`) turns both into plain placements-like parts.
 */

/** Only kit file version this code reads. Anything else gets a named message. */
export const BAUSATZ_VERSION = 1;

/** Parts per kit file. */
export const BAUSATZ_TEILE_MAX = 4000;
/** Kit instances per world document. */
export const BAUSATZ_INSTANZEN_MAX = 256;
/** Resolved parts per world (all instances together). */
export const BAUSATZ_AUFGELOEST_MAX = 10000;
/** Part offset limits (m, kit axes). */
export const BAUSATZ_DXZ_MAX = 1000;
export const BAUSATZ_DY_MAX = 200;
/** Angle limit (rad), yaw / pitch / roll. */
export const BAUSATZ_WINKEL_MAX = 2 * Math.PI;
/** Scale component: 0.05 ≤ |s| ≤ 20, negative = mirrored, 0 forbidden. */
export const BAUSATZ_SKALA_MIN = 0.05;
export const BAUSATZ_SKALA_MAX = 20;
/** Levelling plate limits (m). */
export const BAUSATZ_EBNUNG_HALB_MIN = 1;
export const BAUSATZ_EBNUNG_HALB_MAX = 500;
export const BAUSATZ_BOESCHUNG_MIN = 1;
export const BAUSATZ_BOESCHUNG_MAX = 64;

/** Scale of a part: uniform number or per-axis triple (may be negative = mirrored). */
export type BausatzSkala = number | readonly [number, number, number];

export interface BausatzGrundflaeche {
  halbX: number;
  halbZ: number;
}

/** Rectangular levelling plate (C2 only validates; the terrain effect is C4b). */
export interface BausatzEbnung {
  halbX: number;
  halbZ: number;
  boeschung: number;
}

export interface BausatzGruppe {
  id: string;
  name: string;
}

export interface BausatzTeil {
  /** Stable id inside the kit (`ID_RE`), unique per kit. The address of the part. */
  id: string;
  prefab: string;
  /** Offset from the anchor in kit axes (m). */
  dx: number;
  dz: number;
  /** Height above the levelling target; missing = the part follows the ground. */
  dy?: number;
  yaw: number;
  pitch?: number;
  roll?: number;
  scale: BausatzSkala;
  /** Circular plinth radius (m), like `PlacementDef.einebnen`. */
  einebnen?: number;
  /** Id of a group in `Bausatz.gruppen`. */
  gruppe?: string;
}

export interface Bausatz {
  bausatzVersion: typeof BAUSATZ_VERSION;
  /** Equals the file name (`ID_RE`). */
  id: string;
  name: string;
  grundflaeche: BausatzGrundflaeche;
  ebnung?: BausatzEbnung;
  gruppen?: readonly BausatzGruppe[];
  teile: readonly BausatzTeil[];
}

/** Placement of a kit in the world document (`WorldLayout.bausaetze`). */
export interface BausatzInstanzDef {
  /** Unique over all instances (`ID_RE`). */
  id: string;
  /** Kit id = file name in `server/data/bausaetze/`. */
  bausatz: string;
  /** Anchor (world m). */
  x: number;
  z: number;
  /** Rotation around the vertical axis (rad, default 0). */
  yaw?: number;
  /**
   * Part id → existing placement id. A part listed here resolves to that id
   * instead of `<instanz>#<teilId>`, so it takes over the address (and with it
   * the saved state) of an object that already exists.
   */
  kennungen?: Readonly<Record<string, string>>;
}

/**
 * Contract for C4a (no code here): the resolver adds the yaws (`yaw_instanz + yaw_teil`) and passes `pitch` and
 * `roll` through unchanged. That is only right if the consumer composes a part's rotation as
 * `R_y(yaw) · R_x(pitch) · R_z(roll)`, yaw outermost (like `Quaternion.RotationYawPitchRoll`). Kit files must be
 * loaded through `sanitizeBausatz` before they reach the resolver.
 */

/** A part after resolving: world position and angle, final id. */
export interface AufgeloestesTeil {
  /** `<instanz>#<teilId>`, or the id given by `kennungen`. */
  id: string;
  instanz: string;
  bausatz: string;
  teilId: string;
  prefab: string;
  x: number;
  z: number;
  dy?: number;
  yaw: number;
  pitch?: number;
  roll?: number;
  scale: BausatzSkala;
  einebnen?: number;
  gruppe?: string;
}

export interface BausatzUnbekannt {
  instanz: string;
  bausatz: string;
}

export interface BausatzAufloesung {
  teile: readonly AufgeloestesTeil[];
  /** Instances whose kit is not in the catalogue. Not an error. */
  unbekannt: readonly BausatzUnbekannt[];
  /** Named messages (e.g. resolved-parts limit exceeded); never silent capping. */
  fehler: readonly string[];
}
