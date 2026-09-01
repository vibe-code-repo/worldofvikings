/**
 * AP15.3 — die REINE Rechnung der Zellen-Zeichenfläche: Bild<->Welt,
 * Zell-Picking und Kanten-Picking. Kein DOM, kein Babylon, keine Uhr —
 * damit der Wächter (`client/test/dungeon2-zellwerkzeuge.ts`) die Mathematik
 * prüfen kann, ohne je eine Canvas zu bauen.
 * AP15.3 — the PURE arithmetic of the cell drawing surface: screen<->world,
 * cell picking and edge picking. No DOM, no Babylon, no clock — so the guard
 * can check the maths without ever creating a canvas.
 *
 * Trennung wie in `shared/src/dungeon2/*` (rein) gegen `client/src/engine/*`
 * (Babylon): Wer die Zeichnung testen will, testet ein Bild; wer die
 * Trefferrechnung testen will, testet eine Zahl. Diese Datei ist die Zahl.
 * Separation like `shared/src/dungeon2/*` (pure) vs `client/src/engine/*`
 * (Babylon): testing the drawing tests a picture, testing the hit maths tests
 * a number. This file is the number.
 *
 * KOORDINATEN / coordinates: Wie im LEGACY-`DungeonGrundriss.ts` wächst der
 * Bild-y-Wert mit der Welt-z-Achse (nach UNTEN). Die Projektkonvention Norden
 * = +z (siehe `layout.ts`, `Kante`) bedeutet deshalb: Norden liegt am UNTEREN
 * Bildrand. Das ist bewusst identisch zum Grundriss gehalten ("Pan/Zoom 1:1"),
 * nicht ein Vorzeichenfehler.
 * COORDINATES: as in the LEGACY `DungeonGrundriss.ts`, screen-y grows with the
 * world z axis (DOWNWARD). The project convention north = +z therefore puts
 * north at the BOTTOM of the image. Kept deliberately identical to the floor
 * plan ("pan/zoom 1:1"), not a sign error.
 */

import { dungeon2 } from '@wov/shared';

const ZELLE_M = dungeon2.ZELLE_M;
const KANTE = dungeon2.KANTE;

type Kante = dungeon2.Kante;

/**
 * Sichtzustand der Zeichenfläche. `zoom` in Pixeln je Meter, `mitteX/mitteZ`
 * die Weltkoordinate (Meter) in der Bildmitte, `breite/hoehe` die Pixelmaße
 * des Viewports. Reine Daten, damit dieselbe Rechnung im Test und in der
 * Canvas läuft.
 * View state of the drawing surface. `zoom` in pixels per metre, `mitteX/mitteZ`
 * the world coordinate (metres) at the image centre, `breite/hoehe` the pixel
 * size of the viewport. Plain data, so the same maths runs in test and canvas.
 */
export interface Sicht {
  readonly zoom: number;
  readonly mitteX: number;
  readonly mitteZ: number;
  readonly breite: number;
  readonly hoehe: number;
}

/** Eine Zellposition. / A cell position. */
export interface ZellPos {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
}

/** Eine getroffene Kante samt Zelle und Abstand zum Zeiger (in Metern). */
/** A hit edge with its cell and the pointer distance (in metres). */
export interface KantePos {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly kante: Kante;
  /** Abstand des Zeigers zur Kante in Metern. / Pointer-to-edge distance in metres. */
  readonly abstandM: number;
}

/** Ein Pixelpunkt im Bild. / A pixel point in the image. */
export interface BildPunkt {
  readonly x: number;
  readonly y: number;
}

/** Eine Weltkoordinate in Metern. / A world coordinate in metres. */
export interface WeltPunkt {
  readonly wx: number;
  readonly wz: number;
}

/**
 * Welt (Meter) -> Bild (Pixel). Dieselbe Abbildung wie `zuBild()` im
 * LEGACY-Grundriss.
 * World (metres) -> screen (pixels). Same mapping as `zuBild()` in the legacy
 * floor plan.
 */
export function weltZuBild(sicht: Sicht, wx: number, wz: number): BildPunkt {
  return {
    x: sicht.breite / 2 + (wx - sicht.mitteX) * sicht.zoom,
    y: sicht.hoehe / 2 + (wz - sicht.mitteZ) * sicht.zoom,
  };
}

/**
 * Bild (Pixel) -> Welt (Meter). Umkehrung von `weltZuBild`.
 * Screen (pixels) -> world (metres). Inverse of `weltZuBild`.
 */
export function bildZuWelt(sicht: Sicht, px: number, py: number): WeltPunkt {
  return {
    wx: sicht.mitteX + (px - sicht.breite / 2) / sicht.zoom,
    wz: sicht.mitteZ + (py - sicht.hoehe / 2) / sicht.zoom,
  };
}

/**
 * Welche Zelle liegt unter dem Zeiger? Weltkoordinate durch die Zellkante
 * teilen und abrunden — `Math.floor`, nicht `Math.round`, damit die Grenze
 * genau auf dem Rasterstrich liegt und nicht eine halbe Zelle daneben.
 * Which cell lies under the pointer? Divide the world coordinate by the cell
 * edge length and floor — `Math.floor`, not `Math.round`, so the boundary sits
 * exactly on the grid line, not half a cell off.
 */
export function zelleBei(sicht: Sicht, px: number, py: number, ebene: number): ZellPos {
  const w = bildZuWelt(sicht, px, py);
  return {
    x: Math.floor(w.wx / ZELLE_M),
    z: Math.floor(w.wz / ZELLE_M),
    ebene,
  };
}

/**
 * Welche KANTE der Zelle unter dem Zeiger ist am nächsten? Innerhalb der
 * getroffenen Zelle wird der lokale Versatz (0..ZELLE_M) zu jedem der vier
 * Ränder gemessen; der kleinste Abstand gewinnt. Die zurückgegebene Kante
 * gehört zur Zelle unter dem Zeiger — die Kanonisierung auf eine
 * Nord/Ost-Speicherkante ist Sache von `cellEdits.wandUmschalten`, nicht des
 * Pickings (das Picking soll zeigen, was der Zeiger meint, nicht wo es
 * gespeichert wird).
 * Which EDGE of the cell under the pointer is nearest? Inside the hit cell the
 * local offset (0..ZELLE_M) to each of the four borders is measured; the
 * smallest distance wins. The returned edge belongs to the cell under the
 * pointer — canonicalisation onto a north/east storage edge is the job of
 * `cellEdits.wandUmschalten`, not of picking.
 */
export function kanteBei(sicht: Sicht, px: number, py: number, ebene: number): KantePos {
  const zelle = zelleBei(sicht, px, py, ebene);
  const w = bildZuWelt(sicht, px, py);
  const lx = w.wx - zelle.x * ZELLE_M; // 0..ZELLE_M innerhalb der Zelle / within the cell
  const lz = w.wz - zelle.z * ZELLE_M;

  // Abstand zu jeder Kante. Sued = kleinere z-Grenze (+z ist Norden), West =
  // kleinere x-Grenze. / Distance to each edge.
  const dWest = lx;
  const dOst = ZELLE_M - lx;
  const dSued = lz;
  const dNord = ZELLE_M - lz;

  let kante: Kante = KANTE.West;
  let abstandM = dWest;
  if (dOst < abstandM) {
    kante = KANTE.Ost;
    abstandM = dOst;
  }
  if (dSued < abstandM) {
    kante = KANTE.Sued;
    abstandM = dSued;
  }
  if (dNord < abstandM) {
    kante = KANTE.Nord;
    abstandM = dNord;
  }
  return { x: zelle.x, z: zelle.z, ebene, kante, abstandM };
}

/** Bounds für effizientes Zeichnen. / Bounds for efficient drawing. */
export interface ZellFenster {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Welche Zellindizes sind (mit einer Zelle Rand) sichtbar? Damit die Canvas
 * nur über das zeichnet, was im Bild liegt, statt über das ganze Gitter.
 * Which cell indices are visible (with one cell of margin)? So the canvas only
 * iterates over what is on screen instead of the whole grid.
 */
export function sichtbaresFenster(sicht: Sicht): ZellFenster {
  const linksOben = bildZuWelt(sicht, 0, 0);
  const rechtsUnten = bildZuWelt(sicht, sicht.breite, sicht.hoehe);
  return {
    minX: Math.floor(linksOben.wx / ZELLE_M) - 1,
    maxX: Math.floor(rechtsUnten.wx / ZELLE_M) + 1,
    minZ: Math.floor(linksOben.wz / ZELLE_M) - 1,
    maxZ: Math.floor(rechtsUnten.wz / ZELLE_M) + 1,
  };
}

/**
 * Maßstab und Mitte, damit ein Zellbereich [minZelleX..maxZelleX] x
 * [minZelleZ..maxZelleZ] mit Rand ins Bild passt. Zellindizes herein, Meter
 * heraus — dieselbe Logik wie `passeEin()` im LEGACY-Grundriss, aber rein und
 * testbar. Leerer Bereich (kein Zellinhalt) liefert die Vorgabe-Sicht zurück.
 * Scale and centre so a cell range fits the image with margin. Cell indices in,
 * metres out — same logic as `passeEin()` in the legacy floor plan, but pure
 * and testable. An empty range returns the fallback view unchanged.
 */
export function einpassen(
  fenster: ZellFenster | null,
  breite: number,
  hoehe: number,
  randPx: number,
  zoomMin: number,
  zoomMax: number,
  vorgabe: { zoom: number; mitteX: number; mitteZ: number }
): { zoom: number; mitteX: number; mitteZ: number } {
  if (fenster === null) return vorgabe;
  // Weltausdehnung des Zellbereichs (die +1-Zelle, weil maxX die letzte Zelle
  // ist und ihre Ostkante bei (maxX+1)*ZELLE_M liegt).
  // World extent of the cell range (+1 cell because maxX is the last cell and
  // its east edge sits at (maxX+1)*ZELLE_M).
  const minWX = fenster.minX * ZELLE_M;
  const maxWX = (fenster.maxX + 1) * ZELLE_M;
  const minWZ = fenster.minZ * ZELLE_M;
  const maxWZ = (fenster.maxZ + 1) * ZELLE_M;
  const mitteX = (minWX + maxWX) / 2;
  const mitteZ = (minWZ + maxWZ) / 2;
  const passt = Math.min(
    (breite - 2 * randPx) / Math.max(1, maxWX - minWX),
    (hoehe - 2 * randPx) / Math.max(1, maxWZ - minWZ)
  );
  const zoom = Math.min(zoomMax, Math.max(zoomMin, passt));
  return { zoom, mitteX, mitteZ };
}

/**
 * Neuer Zoom + verschobene Mitte für Radzoom UM DEN ZEIGER (nicht um die
 * Bildmitte). Rein ausgelagert, weil es die eine Stelle ist, an der ein
 * Vorzeichenfehler dazu führt, dass die betrachtete Stelle bei jedem
 * Radschritt aus dem Bild wandert (die Falle, die der Grundriss-Kommentar
 * nennt).
 * New zoom + shifted centre for wheel zoom AROUND THE POINTER (not the image
 * centre). Factored out because it is the one place where a sign error makes
 * the looked-at spot drift out of frame on every wheel step.
 */
export function zoomUmZeiger(
  sicht: Sicht,
  px: number,
  py: number,
  faktor: number,
  zoomMin: number,
  zoomMax: number
): { zoom: number; mitteX: number; mitteZ: number } {
  const vor = bildZuWelt(sicht, px, py);
  const zoom = Math.min(zoomMax, Math.max(zoomMin, sicht.zoom * faktor));
  const nach = bildZuWelt({ ...sicht, zoom }, px, py);
  return {
    zoom,
    mitteX: sicht.mitteX + (vor.wx - nach.wx),
    mitteZ: sicht.mitteZ + (vor.wz - nach.wz),
  };
}
