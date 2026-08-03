/**
 * Maßstab und Nachrichtenformat zwischen Karten-Worker und Karten-Panel.
 *
 * Die Karte ist ein eigenes kleines 3D-Modell der ganzen Welt: 21 km × 21 km
 * Welt werden auf `MAP_SPAN / MAP_UNIT` Babylon-Einheiten geschrumpft, das
 * Relief dabei überhöht, damit Gebirge auch bei voller Übersicht lesbar sind.
 */
import type { ClientWorldSettings } from '../../world/World';

/**
 * Kantenlänge des dargestellten Weltausschnitts in Metern.
 *
 * Radialwelt: fest WATER_EDGE × 2. Layout-Welt: aus der Bounding-Box des
 * WorldLayouts abgeleitet (setzeKartenMasse) — die Karte wächst mit.
 * `let` + ES-Module-Live-Bindings: alle Importstellen sehen den neuen Wert;
 * der Worker läuft in einem EIGENEN Modulkontext und bekommt die Maße über
 * den MapBuildRequest.
 */
export let MAP_SPAN = 21000;
/** Alles ausserhalb dieses Weltradius wird abgeschnitten (runde Kartenscheibe). */
export let MAP_RADIUS = 10450;

/** Kartenmaße umstellen (Layout-Modus) — VOR dem Worker-Start aufrufen. */
export function setzeKartenMasse(span: number, radius: number): void {
  MAP_SPAN = span;
  MAP_RADIUS = radius;
}
/** Weltmeter pro Babylon-Einheit auf der Karte. */
export const MAP_UNIT = 100;
/** Höhenüberhöhung des Kartenreliefs. */
export const HEIGHT_EXAG = 2.6;
/** Vertices je Kante des Reliefgitters (≈41 m Auflösung). */
export const GRID_N = 513;
/** Kantenlänge der Kartentextur. */
export const TEX_N = 2048;
/**
 * Geo-Abtastung für die Textur. Biome und Höhe kosten pro Punkt mehrere
 * fBm-Oktaven; auf halber Texturauflösung zu samplen und beim Füllen zu
 * interpolieren spart 3/4 der Rechenzeit und ist bei 20 m/Sample optisch
 * nicht zu unterscheiden — die feinen Strukturen (Flüsse, Küstensaum)
 * werden ohnehin direkt in voller Texturauflösung nachgezogen.
 */
export const SAMPLE_N = 1024;
/** Abstand der Baumsignaturen in Metern (vor Dichte-Ausdünnung). */
export const TREE_STEP = 70;

/** Weltmeter → Babylon-Einheiten der Karte. */
export const toMapUnits = (meters: number): number => meters / MAP_UNIT;

export interface MapBuildRequest {
  seed: string;
  settings: ClientWorldSettings;
  /** WorldLayout-Dokument (Layout-Modus) — der Worker baut daraus RegionGeo. */
  layout?: unknown;
  /** Kartenmaße (Layout-Modus): müssen zu den Werten des Panels passen. */
  span?: number;
  radius?: number;
}

export type MapWorkerMessage =
  /** Fortschritt für die Statuszeile (0..1). */
  | { t: 'fortschritt'; anteil: number; text: string }
  /** Fertiges Reliefgitter (Positionen in Karteneinheiten). */
  | { t: 'relief'; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array }
  /** Teilbild der Kartentextur während des Rasterns (RGBA, `hoehe` Zeilen ab `y`). */
  | { t: 'texturteil'; y: number; hoehe: number; data: Uint8Array }
  /** Endgültige Kartentextur inklusive Flüssen und Seen. */
  | { t: 'textur'; data: Uint8Array }
  /**
   * Baumsignaturen einer Art. Je Symbol 5 Werte:
   * x, y, z (Karteneinheiten) sowie Skalierung und Drehung.
   */
  | { t: 'baeume'; art: number; data: Float32Array }
  /** Weltdaten für Tooltip/Abfragen: Biome-Index, Höhe und Waldfaktor je Sample. */
  | { t: 'raster'; biome: Uint16Array; hoehe: Float32Array; wald: Float32Array; n: number }
  | { t: 'fertig'; dauerMs: number }
  | { t: 'fehler'; text: string };
