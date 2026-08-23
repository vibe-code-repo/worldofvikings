/**
 * Rasterprüfung für eigene Dungeon-Bauteile.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Der Dungeon-Algorithmus setzt Räume über KOPPLUNG VON CONNECTORS, nicht
 * über Rasterschnappen. Das Feld `DungeonDef.gridSize` existiert zwar,
 * wird aber nirgends im Projekt ausgewertet (geprüft am 20.08.2026 per
 * grep über shared/ und server/ — der einzige Treffer ist die
 * Typdefinition selbst); es gehört zu den Camp-Algorithmen, die für
 * Dungeons nicht benutzt werden.
 *
 * Daraus folgt die unangenehme Eigenschaft, gegen die dieses Modul
 * gebaut ist: **Ein Bauteil, das sich nicht ans Raster hält, erzeugt
 * keinen Fehler.** Es passt einfach irgendwann nicht mehr zusammen, und
 * zwar erst dann, wenn genug Teile da sind, dass man die Ursache in der
 * falschen Ecke sucht. Beim ersten Bauteil sieht man so etwas von Hand,
 * beim zwanzigsten nicht mehr.
 *
 * ── Woher die Zahlen kommen ──────────────────────────────────────────
 * Aus drei unabhängigen Belegen, zusammengetragen am 20.08.2026
 * (Herleitung im Vault: „Konzept Dungeons und Instanzen“, Ebene 1):
 *
 *  1. Alle DREIZEHN geparsten Original-Kits deklarieren `gridSize 4` —
 *     SunkenCrypt, ForestCrypt, DvergrTown, Cave, GoblinCamp, ausnahmslos.
 *  2. Die Spielfigur passt dazu: BODY_RADIUS 0,4 m (0,8 m Schulterbreite),
 *     BODY_HEIGHT 1,8 m. Ein 4-m-Gang ist fünfmal Schulterbreite — zwei
 *     Spieler nebeneinander, Platz zum Ausholen. Bei 2 m wäre es ein Rohr.
 *  3. Die echten Raumgrößen im ForestCrypt-Kit sind durchweg gerade
 *     (Grundflächen 2/4/6/8/10/12/16/20 m, Höhen 4/5/6/8/10/12 m), die
 *     kleinste Höhe ist 4 m — gut das Doppelte der Figur.
 *
 * Bewusst GRÖBER als die Vorlage: Die Originale arbeiten in 2-m-Schritten,
 * hier gilt 4 m. Weniger Kombinationen heißt weniger Stellen, an denen
 * Connectors knapp nicht zusammenpassen. Auf 2 m verfeinern kann man
 * jederzeit, ohne bestehende Teile anzufassen; von 2 auf 4 vergröbern
 * hieße alles neu bauen.
 *
 * ── Wogegen die Prüfung NICHT läuft ──────────────────────────────────
 * Gegen die 374 geparsten Valheim-Räume. Die halten dieses Raster nicht
 * ein (2-m-Schritte, Connectors auf verschiedenen Höhen) und sollen es
 * auch nicht — sie sind Fremddaten ohne Modelle. Geprüft wird
 * ausschließlich, was `istEigenesModell()` als eigenes Modell führt.
 * Solange es kein einziges eigenes Bauteil gibt, läuft die Prüfung leer
 * durch. Das ist Absicht: Der Wächter steht, bevor das erste Modell
 * entsteht, statt hinterher nachgerüstet zu werden.
 */
import type { Quaternion, Vector3 } from './types.js';
import type { RoomConnectionDef, RoomDef } from './dungeons.js';

/** Rastereinheit in Metern. Herleitung siehe Kopfkommentar. */
export const DUNGEON_RASTER_M = 4;

/**
 * Kleinste lichte Höhe in Metern. Die Figur ist 1,8 m hoch; darunter
 * wirkt ein Raum geduckt statt gewölbt, und die kleinste Höhe der
 * Vorlage ist ebenfalls 4 m.
 */
export const DUNGEON_MIN_HOEHE_M = 4;

/**
 * Toleranz für Fließkommavergleiche in Metern.
 *
 * Ein Blender-Export trifft die 0 nicht exakt — 1e-7 ist normal, 1 mm
 * ist es nicht. Die Grenze liegt bewusst bei einem halben Millimeter:
 * eng genug, dass ein versehentlich verschobener Connector auffällt,
 * weit genug, dass Exportrauschen nicht meldet.
 */
export const RASTER_TOLERANZ_M = 0.0005;

export type RasterSchwere = 'fehler' | 'hinweis';

export interface RasterBefund {
  readonly raum: string;
  readonly schwere: RasterSchwere;
  /** Kurzname der verletzten Regel — stabil, für Tests und Filter. */
  readonly regel:
    | 'connector-hoehe'
    | 'connector-drehung'
    | 'connector-auf-huellflaeche'
    | 'grundflaeche-raster'
    | 'lichte-hoehe';
  readonly text: string;
}

const nahe = (a: number, b: number): boolean => Math.abs(a - b) <= RASTER_TOLERANZ_M;

const istVielfaches = (wert: number, schritt: number): boolean => {
  if (schritt <= 0) return false;
  const rest = Math.abs(wert) % schritt;
  return rest <= RASTER_TOLERANZ_M || Math.abs(rest - schritt) <= RASTER_TOLERANZ_M;
};

/**
 * Ist die Drehung achsparallel, also ein Vielfaches von 90° um die
 * Hochachse?
 *
 * Geprüft wird am Quaternion statt an Eulerwinkeln: Für eine reine
 * Y-Drehung müssen x und z null sein, und (w, y) müssen einem der vier
 * Viertelschritte entsprechen. Der Umweg über Euler würde bei 180°
 * mehrdeutig (±180° sind dasselbe) und bei Exportrauschen unnötig
 * empfindlich.
 */
export function istAchsparallel(rot: Quaternion): boolean {
  if (!nahe(rot.x, 0) || !nahe(rot.z, 0)) return false;
  // cos(θ/2), sin(θ/2) für θ ∈ {0°, 90°, 180°, 270°}; Vorzeichen egal,
  // weil q und −q dieselbe Drehung sind.
  const viertel = [
    [1, 0],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0, 1],
    [-Math.SQRT1_2, Math.SQRT1_2],
  ];
  return viertel.some(
    ([w, y]) =>
      (nahe(rot.w, w!) && nahe(rot.y, y!)) || (nahe(rot.w, -w!) && nahe(rot.y, -y!))
  );
}

/**
 * Liegt der Connector auf einer der vier senkrechten Hüllflächen?
 *
 * `size` ist die volle Kantenlänge der Hüllbox, der lokale Ursprung
 * liegt in ihrer Mitte — die Flächen liegen also bei ±size/2. Geprüft
 * wird nur x und z: Boden- und Deckenflächen kommen als Verbindung
 * nicht in Frage, dafür gibt es keine waagerechten Durchgänge.
 */
export function liegtAufHuellflaeche(localPos: Vector3, size: Vector3): boolean {
  const halbX = size.x / 2;
  const halbZ = size.z / 2;
  const aufX = nahe(Math.abs(localPos.x), halbX) && Math.abs(localPos.z) <= halbZ + RASTER_TOLERANZ_M;
  const aufZ = nahe(Math.abs(localPos.z), halbZ) && Math.abs(localPos.x) <= halbX + RASTER_TOLERANZ_M;
  return aufX || aufZ;
}

/** Prüft EINEN Connector. Ausgelagert, damit der Test ihn einzeln treffen kann. */
export function pruefeConnector(
  raumName: string,
  index: number,
  c: RoomConnectionDef,
  size: Vector3
): RasterBefund[] {
  const befunde: RasterBefund[] = [];
  const wo = `Connector ${index + 1}`;

  if (!nahe(c.localPos.y, 0)) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-hoehe',
      text: `${wo} liegt auf y = ${c.localPos.y.toFixed(3)} statt auf 0 — Räume würden gegeneinander treppen.`,
    });
  }

  if (!istAchsparallel(c.localRot)) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-drehung',
      text: `${wo} ist nicht achsparallel gedreht (nur Vielfache von 90° um die Hochachse) — es passt dann nur, was zufällig passt.`,
    });
  }

  if (!liegtAufHuellflaeche(c.localPos, size)) {
    befunde.push({
      raum: raumName,
      schwere: 'fehler',
      regel: 'connector-auf-huellflaeche',
      text:
        `${wo} liegt nicht auf einer senkrechten Hüllfläche ` +
        `(x = ${c.localPos.x.toFixed(2)}, z = ${c.localPos.z.toFixed(2)} bei Hülle ${size.x}×${size.z}).`,
    });
  }

  return befunde;
}

/**
 * Prüft ein Bauteil gegen das Raster. Leeres Ergebnis heißt: passt.
 *
 * `raster` ist überschreibbar, damit ein späteres Kit mit feinerem Raster
 * (2 m) dieselbe Funktion benutzen kann, statt eine zweite zu bekommen.
 */
export function pruefeRaumRaster(raum: RoomDef, raster: number = DUNGEON_RASTER_M): RasterBefund[] {
  const befunde: RasterBefund[] = [];

  for (const achse of ['x', 'z'] as const) {
    const wert = raum.size[achse];
    if (!istVielfaches(wert, raster)) {
      befunde.push({
        raum: raum.name,
        schwere: 'fehler',
        regel: 'grundflaeche-raster',
        text: `Grundfläche ${achse} = ${wert} m ist kein Vielfaches von ${raster} m.`,
      });
    }
  }

  if (raum.size.y + RASTER_TOLERANZ_M < DUNGEON_MIN_HOEHE_M) {
    befunde.push({
      raum: raum.name,
      schwere: 'hinweis',
      regel: 'lichte-hoehe',
      text:
        `Lichte Höhe ${raum.size.y} m liegt unter ${DUNGEON_MIN_HOEHE_M} m. ` +
        `Die Figur ist 1,8 m hoch — darunter wirkt der Raum geduckt statt gewölbt.`,
    });
  }

  raum.connections.forEach((c, i) => {
    befunde.push(...pruefeConnector(raum.name, i, c, raum.size));
  });

  return befunde;
}

/**
 * Prüft eine ganze Menge Bauteile. Der Aufrufer entscheidet, WELCHE —
 * dieses Modul kennt bewusst weder die Registry noch `istEigenesModell`,
 * damit es ohne Datenlast testbar bleibt und der Editor es später für
 * einen Entwurf im Speicher benutzen kann.
 */
export function pruefeRaeumeRaster(
  raeume: readonly RoomDef[],
  raster: number = DUNGEON_RASTER_M
): RasterBefund[] {
  return raeume.flatMap((r) => pruefeRaumRaster(r, raster));
}
