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
// Der Asset-Speicher: Typen und Stellschrauben von Hand, die Daten
// erzeugt (tools/store-prefabs.mjs).
//
// BEWUSST NICHT HIER: storeKatalogDaten.ts. Dieselbe Entscheidung wie bei
// featurePieces.ts oben, und derselbe Messwert dahinter: Der Katalog sind
// 670 Eintraege mit Lizenz, Kennzeichen, Huellbox und Kollisionsart
// (291 KB Quelltext), und ihn liest ausschliesslich der Editor. Solange
// er in storePrefabs.ts stand, lud ihn jeder Spieler mit -- der
// ausgelieferte Prefab-Chunk trug 670-mal `lizenzstatus` durch die
// Leitung (682 KB roh / 118,66 KB gzip, gemessen 08.09.2026). Ein
// `export *` von hier stellte genau das wieder her: Der Baumschnitt
// greift nicht durch ein Modul hindurch, dessen Nachbar gebraucht wird.
//
// Wer den Katalog will, nennt seinen Pfad:
//   import { STORE_KATALOG } from '@wov/shared/src/storeKatalogDaten.js';
export * from './storeKatalog.js';
export * from './storePrefabs.js';
// Die KOLLISIONSANGABE des Speichers — schmal, und deshalb hier drin.
//
// Sie steht auch im Katalog daneben, aber der liegt ausserhalb des
// Barrels (s. oben). Client UND Server muessen sie lesen koennen: Der
// eine baut daraus Havok-Formen, der andere rechnet die Spielerbewegung
// dagegen — zwei Quellen liefen lautlos auseinander. Die Datei traegt
// deshalb nur die AUSNAHMEN (27 ohne Koerper, 19 Netz, 73 eigene Kiste),
// nicht 670 Katalogzeilen: 12,6 KB Quelltext gegen 291 KB.
export * from './storeKollisionDaten.js';
// Die gemeinsame Kollisions-Formableitung — die EINE Stelle, an der aus
// Modellgeometrie eine Form wird. Client (Havok) und Server (eigene
// Abfrage) rufen dieselbe Funktion mit denselben Zahlen auf.
//
// BEWUSST NICHT HIER: `kollision/glb.ts`. Der GLB-Leser ist ein
// SERVERWEG — der Client bekommt seine Vertexdaten von Babylon und
// braeuchte ihn nie; ueber das Barrel laege er in jedem Spiel-Bundle.
//   import { leseGlb } from '@wov/shared/src/kollision/glb.js';
export * from './kollision/form.js';
export * from './kollision/formen.js';
export * from './kollision/festeKoerper.js';
export * from './npc.js';
export * from './leben.js';
export * from './aggro.js';
export * from './vegetation.js';
export * from './flora.js';
// Die Streutabelle der Store-Vegetation. Flach exportiert wie flora.js,
// weil die Prüfer und der Editor dieselbe Tür benutzen.
export * from './storeFlora.js';
// Die Streutabelle des Store-Felsens -- dieselbe Tuer wie storeFlora.js.
// Zusaetzlich fuer den Client: `STORE_FELSEN_NAMEN` entscheidet dort ueber
// die Kollisionsform (EntityManager).
export * from './storeFelsen.js';
export * from './features.js';
export * from './dungeons.js';
export * from './dungeonRaster.js';
export * from './dungeonRasterModul.js';
export * from './dungeonKanten.js';
export * from './dungeonGenerator.js';
/**
 * Der Rasterpfad NAMENTLICH statt flach.
 *
 * `dungeonRasterGenerator.ts` führt ein eigenes `yawQuaternion` (Gierung
 * in Grad, vier erlaubte Werte), `worldlayout/routenlauf.ts` ein
 * gleichnamiges für beliebige Winkel. Ein `export *` machte daraus einen
 * mehrdeutigen Namen, und TypeScript liesse beide still verschwinden.
 * Nach draussen geht deshalb genau das, was Server und Editor brauchen —
 * wer mehr braucht (Tests, Messzellen), importiert die Datei direkt.
 */
export {
  DEFAULT_GRID_TUNING,
  DungeonRasterError,
  GRID_CELL_M,
  GRID_LEVEL_M,
  erzeugeLayoutFuerKit,
  fallbackGridLayout,
  generateGridLayout,
  type GridGeneratorOptions,
  type GridSettings,
  type GridTuning,
} from './dungeonRasterGenerator.js';
export * from './locationConfig.js';
export * from './spawnData.js';
export * from './environment.js';
export * from './weather.js';
export * from './figuren.js';
export * from './aussehen.js';
export * from './ausruestung.js';
export * from './wetterVorgabe.js';
export * from './lookProfil.js';
export * from './serverConfigFlags.js';
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

/**
 * Die Laufzeit-Modulregistry als NAMENSRAUM, aus demselben Grund wie
 * `dungeon2` darüber: Sie führt Namen wie `dreiecke`, `pruefeMasse` und
 * `modulName`, die in einem flachen `export *` mit dem Altbestand
 * zusammenstiessen — und TypeScript liesse einen kollidierenden Namen
 * STILL weg. Client und Editor holen sich darüber die Prüfsumme und die
 * Registrierung (E6); der Server importiert die Datei direkt.
 * The runtime module registry as a NAMESPACE, same reason as dungeon2.
 */
export * as moduleRegistry from './moduleRegistry.js';

// Rein typseitige Bruecken zu den serverseitigen Datenmodulen — `export type`
// verschwindet beim Kompilieren restlos und zieht kein JSON nach.
export type { FeaturePiece, FeatureRandomSpawn } from './featurePieces.js';
export type { RoomNetView, RoomPieces, RoomRandomSpawn } from './roomPieces.js';
export type { FlattenedKind, FlattenedPiece } from './dungeonFlatten.js';
