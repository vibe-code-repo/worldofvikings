/**
 * Barrel des shared-Pakets — das, was Client UND Server sehen.
 *
 * BEWUSST NICHT HIER: featurePieces.ts, roomPieces.ts und dungeonFlatten.ts.
 * Diese drei tragen die ~13 MB Rohdaten der Weltvorlagen und werden nur
 * serverseitig gebraucht. Ein `export *` von hier zoege sie ueber die
 * 34 Client-Module, die aus '@wov/shared' importieren, ins Browser-Bundle
 * — genau das machte den ausgelieferten mapTypes-Chunk 12 MB gross. Der
 * Server importiert sie deshalb ueber ihren expliziten Pfad
 * ('@wov/shared/src/featurePieces.js'); nur die Typen sind hier rein
 * typseitig (also zur Laufzeit spurlos) weiter erreichbar.
 */
export * from './constants.js';
export * from './types.js';
export * from './protocol.js';
export * from './hash.js';
export * from './prefabs.js';
export * from './npc.js';
export * from './leben.js';
export * from './aggro.js';
export * from './vegetation.js';
export * from './flora.js';
export * from './features.js';
export * from './dungeons.js';
export * from './dungeonRaster.js';
export * from './dungeonRasterModul.js';
export * from './dungeonKanten.js';
export * from './dungeonGenerator.js';
export * from './locationConfig.js';
export * from './spawnData.js';
export * from './environment.js';
export * from './weather.js';
export * from './figuren.js';
export * from './aussehen.js';
export * from './ausruestung.js';
export * from './wetterVorgabe.js';
export * from './worldgen/index.js';
export * from './items/index.js';
export * from './worldlayout/index.js';

/**
 * Dungeon Generator 2.0 als NAMENSRAUM, nicht flach.
 *
 * `dungeon2/layout.ts` exportiert `Kante`, `Tuer`, `ZELLE_M` — Namen, die der
 * Altbestand (`dungeons.ts`, `dungeonRaster.ts`) aehnlich fuehrt. Bei einem
 * flachen `export *` laesst TypeScript einen kollidierenden Namen STILL weg;
 * der Fehler zeigte sich erst an der Aufrufstelle als „gibt es nicht", und die
 * Ursache saehe nach etwas ganz anderem aus. Ausfuehrliche Begruendung im
 * Kopf von `dungeon2/index.ts`.
 * Dungeon generator 2.0 as a NAMESPACE, not flat: `dungeon2/layout.ts` exports
 * `Kante`, `Tuer`, `ZELLE_M` — names the legacy modules carry similarly. On a
 * flat `export *` TypeScript drops the clashing name SILENTLY.
 */
export * as dungeon2 from './dungeon2/index.js';

// Rein typseitige Bruecken zu den serverseitigen Datenmodulen — `export type`
// verschwindet beim Kompilieren restlos und zieht kein JSON nach.
export type { FeaturePiece, FeatureRandomSpawn } from './featurePieces.js';
export type { RoomNetView, RoomPieces, RoomRandomSpawn } from './roomPieces.js';
export type { FlattenedKind, FlattenedPiece } from './dungeonFlatten.js';
