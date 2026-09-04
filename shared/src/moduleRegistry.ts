/**
 * Laufzeit-Module des Kits `DG_StoneVault` — Meilenstein E3 der
 * Konzeptnotiz „Elemente aus dem Editor und Fels-Relief“.
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * E1 hat die Geometrie eines Saals geschlossen (`hallenGeometrie.ts`),
 * E2 schreibt sie als GLB (`server/src/world/dungeon/GlbWriter.ts`).
 * Damit steht das MODELL — aber ein Modell allein ist für den Generator
 * unsichtbar. Was er sieht, ist die `RoomDef`: Hülle, Connectors,
 * Kantenerklärung. Diese Datei baut sie, und zwar so, dass ein zur
 * Laufzeit erzeugter Saal von einem in `eigeneDungeons.ts` getippten
 * nicht zu unterscheiden ist.
 *
 * ── Warum die RoomDef eines Saals vollständig ableitbar ist ──────────
 * Ein Saal ist das einzige Modul des Kits OHNE eingebaute Wand: Boden und
 * Decke laufen durch, an allen vier Seiten ist offen. Daraus folgt jede
 * Zeile der Definition:
 *
 *  • `size` ist die volle Rasterhülle, `{2·cx, 3,5, 2·cz}`. Alle anderen
 *    Module lügen hier bewusst um 0,6 m je Achse mit eingebauter Wand
 *    (Begründung an `StoneVaultCorridor`); ein Saal hat keine, also steht
 *    hier das ehrliche Mass.
 *  • **Auf JEDER Randzelle sitzt ein Connector.** Nicht einer je Seite:
 *    Ein Connector in der Seitenmitte läge bei gerader Zellzahl auf
 *    KEINER Zellkante — die anschliessende 2-m-Zelle stünde dann um 1 m
 *    versetzt zum Raster, und ab da passte im ganzen Zweig nichts mehr
 *    zusammen. Das ist die Begründung, die schon bei `StoneVaultHall`
 *    steht, und sie ist der Grund für die 2·(cx+cz) Connectors.
 *  • **Kein `gridEdges`.** `gridModuleFromRoomDef` verlangt für jede
 *    waagerechte Aussenkante eine Aussage — Connector ODER Eintrag. Weil
 *    hier jede Randkante einen Connector trägt, vermisst sie nichts. Ein
 *    `gridEdges` daneben wäre eine zweite Aussage über dieselbe Kante.
 *
 * ── Warum die Drehungen importiert und nicht getippt sind ────────────
 * `KEINE_DREHUNG` … `VIERTEL_DREHUNG_ZURUECK` und `TYP_ZELLKANTE` kommen
 * aus `eigeneDungeons.ts`. Ein zweiter Satz derselben Quaternionen wäre
 * eine zweite Wahrheit über dieselbe Vierteldrehung, und ein
 * Vorzeichenfehler darin hätte kein Symptom in einer Zahl — er zeigte
 * sich als Zweig, der in die falsche Richtung wächst. Ebenso `GRID_M` und
 * `HEIGHT_M`: Die Hülle wird aus dem Kachelmass gerechnet, mit dem die
 * Geometrie wirklich gebaut wird, nicht aus einer wiederholten 2.
 *
 * ── Keine Nebenwirkung beim Import ───────────────────────────────────
 * `shared/package.json` verspricht `sideEffects: false` und nennt „keine
 * Registry-Einträge“ ausdrücklich. Diese Datei exportiert deshalb reine
 * Funktionen; das Eintragen in die Nachschlagewerke ist eine GERUFENE
 * Funktion und kommt in E4.
 *
 * Sprache: neue Bezeichner englisch, die importierten deutschen Namen
 * bleiben, wo sie stehen.
 */
import { GRID_M, HEIGHT_M } from './hallenGeometrie.js';
import {
  HALBE_DREHUNG,
  KEINE_DREHUNG,
  NULL_PUNKT,
  TYP_ZELLKANTE,
  VIERTEL_DREHUNG,
  VIERTEL_DREHUNG_ZURUECK,
} from './eigeneDungeons.js';
import { MODULE_CELL_M, MODULE_LEVEL_M } from './dungeonRasterModul.js';
import { getStableHash } from './hash.js';
import type { RoomConnectionDef, RoomDef } from './dungeons.js';
import { RoomTheme } from './dungeons.js';

/**
 * Die vier Seiten eines Saals in der Reihenfolge, in der die
 * ausgelieferten Säle ihre Connectors auflisten: Nord, Süd, Ost, West,
 * innerhalb einer Seite nach aufsteigender Querkoordinate.
 *
 * Die Reihenfolge ist NICHT Geschmackssache. `RoomConnectionDef` trägt
 * keinen Namen; ein Connector wird über seinen INDEX angesprochen
 * (`ModulePort.connector`, und im 1.0-Pfad die Türsetzung). Eine andere
 * Reihenfolge ergäbe dieselbe Geometrie mit anderen Indizes — und damit
 * eine RoomDef, die sich von einer gebauten unterscheidet, ohne dass ein
 * Mass abwiche.
 */
const SIDES = [
  { name: 'Nord (+z)', axis: 'z' as const, sign: 1, rot: KEINE_DREHUNG },
  { name: 'Süd (−z)', axis: 'z' as const, sign: -1, rot: HALBE_DREHUNG },
  { name: 'Ost (+x)', axis: 'x' as const, sign: 1, rot: VIERTEL_DREHUNG },
  { name: 'West (−x)', axis: 'x' as const, sign: -1, rot: VIERTEL_DREHUNG_ZURUECK },
] as const;

/**
 * Baut die `RoomDef` eines Saals aus seinen Zellzahlen.
 *
 * @param name    Prefabname und zugleich Dateiname des GLB. Unveränderlich —
 *                ein geänderter Saal ist ein NEUER Name (Konzept 1h: live
 *                liegt `/assets/` sieben Tage im Browsercache).
 * @param cellsX  Zellen in x-Richtung, ganzzahlig ≥ 1.
 * @param cellsZ  Zellen in z-Richtung, ganzzahlig ≥ 1.
 * @param weight  Gewicht des Raums für den 1.0-Pfad und den Editor. Auf den
 *                Rasterpfad wirkt es nicht: `nurManuell` hält den Saal aus
 *                der Stempelauswahl heraus.
 *
 * Die Klemmen des Editor-Formulars (2…8 Zellen, Pfeilerraster,
 * Dreiecksdeckel) sitzen im Server (E5) — sie sind eine Frage der
 * Bau-ERLAUBNIS. Hier wird nur zurückgewiesen, was gar keine Geometrie
 * hat: Ein halbzelliger oder leerer Fussabdruck ergäbe eine Hülle, die auf
 * keinem Raster liegt, und der Fehler fiele erst zwei Schritte später in
 * `gridModuleFromRoomDef` auf — mit einer Meldung über die Hülle statt
 * über das Argument.
 */
export function roomDefForHall(
  name: string,
  cellsX: number,
  cellsZ: number,
  weight: number
): RoomDef {
  if (!Number.isInteger(cellsX) || !Number.isInteger(cellsZ) || cellsX < 1 || cellsZ < 1) {
    throw new Error(
      `roomDefForHall('${name}'): Fussabdruck ${cellsX}×${cellsZ} ist keine ganze Zellzahl ≥ 1.`
    );
  }
  // Die Geometrie kachelt mit GRID_M, das Modulformat misst mit
  // MODULE_CELL_M. Solange beide gleich sind, ist die Hülle unten richtig;
  // gingen sie auseinander, wäre sie STILL falsch — der Generator läse
  // dann eine andere Zellzahl, als das GLB gebaut hat.
  if (GRID_M !== MODULE_CELL_M || HEIGHT_M !== MODULE_LEVEL_M) {
    throw new Error(
      `roomDefForHall: Saalraster ${GRID_M}×${HEIGHT_M} m weicht vom Modulraster ` +
        `${MODULE_CELL_M}×${MODULE_LEVEL_M} m ab — die Hülle liesse sich nicht mehr ableiten.`
    );
  }

  const halfX = (cellsX * GRID_M) / 2;
  const halfZ = (cellsZ * GRID_M) / 2;

  const connections: RoomConnectionDef[] = [];
  for (const side of SIDES) {
    // Auf der Nord/Süd-Seite läuft die Querkoordinate über x, auf der
    // Ost/West-Seite über z — und in beiden Fällen über die ZELLMITTEN
    // der Randzellen, nicht über die Zellkanten.
    const across = side.axis === 'z' ? cellsX : cellsZ;
    for (let i = 0; i < across; i++) {
      const offset = (i - (across - 1) / 2) * GRID_M;
      connections.push({
        type: TYP_ZELLKANTE,
        entrance: false,
        allowDoor: true,
        doorOnlyIfOtherAlsoAllowsDoor: false,
        // y = 0: Der Connector sitzt auf dem BODEN. Ein Connector auf
        // halber Höhe liesse Räume gegeneinander treppen (Bauteil-Vertrag
        // im Kopf von `eigeneDungeons.ts`).
        localPos:
          side.axis === 'z'
            ? { x: offset, y: 0, z: side.sign * halfZ }
            : { x: side.sign * halfX, y: 0, z: offset },
        localRot: side.rot,
      });
    }
  }

  return {
    name,
    // Derselbe Hash wie für jeden getippten Raum. Er ist die Netz- und
    // Persistenz-Kennung; wer ihn anders rechnete, verlöre den Raum beim
    // nächsten Laden des Dokuments.
    hash: getStableHash(name),
    divider: false,
    endCap: false,
    endCapPrio: 0,
    // Kein Eingangsraum: Der Eingang hängt den ganzen Grundriss auf, und
    // den setzt der Generator nie zweimal.
    entrance: false,
    faceCenter: false,
    minPlaceOrder: 0,
    perimeter: false,
    size: { x: cellsX * GRID_M, y: HEIGHT_M, z: cellsZ * GRID_M },
    theme: RoomTheme.Crypt,
    weight,
    pos: NULL_PUNKT,
    rot: KEINE_DREHUNG,
    connections,
    // Kein `gridEdges`: Jede Randkante trägt einen Connector, es gibt also
    // nichts zu erklären. Siehe Kopf dieser Datei.
    nurManuell: true,
  };
}
