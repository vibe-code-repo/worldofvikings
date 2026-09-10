/**
 * storeKollisionDaten.ts — ERZEUGT, NICHT VON HAND ÄNDERN.
 *
 *   npx tsx tools/store-prefabs.mjs
 *
 * Die Kollisionsangabe aus `prefabs.json`, schmal: nur die AUSNAHMEN.
 * 27 Prefabs ohne Körper, 19 mit eigenem Netz,
 * 73 mit einer Kiste, die von der Modell-Hüllbox abweicht.
 * Alles andere ist `box` ohne eigene Kiste — das ist die Vorgabe und
 * braucht keine Zeile.
 *
 * ── Warum diese Datei AM BARREL hängt und der Katalog nicht ──────────
 * Dieselbe Angabe steht auch in `storeKatalogDaten.ts`. Die liegt
 * bewusst ausserhalb des Barrels (291 KB, nur der Editor liest sie), und
 * eine Kollisionsentscheidung darf sie nicht nachziehen — die Begründung
 * steht im Kopf von `shared/src/index.ts`.
 *
 * Gebraucht wird die Angabe aber von BEIDEN Seiten des Spiels: Der
 * Client baut daraus seine Havok-Formen, der Server rechnet die
 * Spielerbewegung dagegen. Hätten sie zwei Quellen, liefen sie
 * auseinander — und zwar lautlos: Der Spieler stünde im Client vor einem
 * Stein, den der Server nicht kennt, und würde hindurchgezogen.
 *
 * Deshalb diese dritte Datei. Sie kostet, was sie kostet: die Namen der
 * Ausnahmen und sonst nichts.
 *
 * Generated collision record — do not edit by hand. Exceptions only.
 */
import type { StoreBounds, StoreKollision, StorePrefabName } from './storeKatalog.js';
import { STORE_MODELL_NAMEN } from './storePrefabs.js';

/** Was ein Store-Prefab bekommt, wenn es unten nicht steht. */
export const STORE_KOLLISION_VORGABE: StoreKollision = { art: 'box' };

/** `art: 'none'` — durch diese Prefabs läuft man hindurch. */
export const STORE_OHNE_KOERPER: ReadonlySet<StorePrefabName> = new Set([
  'environment-backdrop-mountains-clear',
  'environment-backdrop-mountains-snow',
  'environment-backdrop-sky-dome',
  'environment-sm-prop-cloud-01',
  'environment-sm-prop-cloud-02',
  'environment-sm-prop-cloud-03',
  'vegetation-branch-1a1',
  'vegetation-branch-1a5',
  'vegetation-branch-1a7',
  'vegetation-branch-1a9',
  'vegetation-bush-1a1',
  'vegetation-bush-1a1-small',
  'vegetation-bush-1a2',
  'vegetation-bush-1a2-small',
  'vegetation-bush-1a2-small-1-dark',
  'vegetation-bush-1a2-small-1-snow',
  'vegetation-bush-1a3',
  'vegetation-grass-short-clump-1',
  'vegetation-grass-short-clump-redblue',
  'vegetation-grass-short-clump-snow',
  'vegetation-grass-short-clump-yellow',
  'vegetation-large-bush-1a1',
  'vegetation-large-bush-1a2',
  'vegetation-large-bush-1a3',
  'vegetation-large-bush-1a4',
  'vegetation-large-bush-1a5',
  'vegetation-sm-plant-mushrooms-02',
]);

/**
 * `art: 'mesh'` — exakte Geometrie statt Hüllquader.
 *
 * Der Wert ist der Pfad der eigenen Kollisions-GLB relativ zum Speicher,
 * oder `null`, wenn die Quelle keine nennt und auch keine
 * `…-collision.glb` danebenliegt. `null` heisst NICHT „keine Kollision",
 * sondern „die Geometrie des Modells selbst".
 */
export const STORE_KOLLISIONSNETZ: ReadonlyMap<StorePrefabName, string | null> = new Map([
  ['environment-sm-bld-house-stairs-03', 'environment/sm-bld-house-stairs-03-collision.glb'],
  ['environment-sm-bld-preset-shelter-02-optimized', 'environment/sm-bld-preset-shelter-02-optimized-collision.glb'],
  ['environment-sm-prop-archway-01', null],
  ['environment-sm-prop-dock-02', 'environment/sm-prop-dock-02-collision.glb'],
  ['terrain-terrain-customization', null],
  ['terrain-terrain-mainmenu', null],
  ['terrain-terrain-village1', null],
  ['terrain-terrain-village1-257', null],
  ['terrain-terrain-village1-adaptive', null],
  ['terrain-terrain-village1-samples', null],
  ['terrain-terrainl1', null],
  ['terrain-terrainl2', null],
  ['terrain-terrainl3', null],
  ['terrain-terrainl4', null],
  ['terrain-terrainl5', null],
  ['terrain-terrainl6', null],
  ['terrain-terrainl7', null],
  ['terrain-terrainl8', null],
  ['terrain-terrainl9', null],
]);

/**
 * `art: 'box'` MIT eigener Kiste — im DATEIRAUM, wie `StoreEintrag.bounds`.
 *
 * Achtung, dieselbe Falle wie dort: Babylon klappt beim glTF-Import die
 * x-Achse um. Wer diese Kiste als Weltkiste benutzt, muss sie durch
 * `boundsNachWeltraum()` schicken (`storeKatalog.ts`).
 */
export const STORE_KOLLISIONSKISTE: ReadonlyMap<StorePrefabName, StoreBounds> = new Map([
  ['vegetation-branched-tree-2a1', { min: [-0.424, -0.3886, -0.5832], max: [0.4061, 13.4974, 0.4468] }],
  ['vegetation-branched-tree-2a3', { min: [-0.6067, -0.4779, -0.517], max: [0.6035, 16.5985, 0.492] }],
  ['vegetation-massive-tree-1a1', { min: [-0.7027, -0.5773, -0.723], max: [0.713, 14.0243, 0.4293] }],
  ['vegetation-massive-tree-1a1-1-dark', { min: [-0.6646, -0.5865, -0.8578], max: [0.713, 14.0243, 0.564] }],
  ['vegetation-massive-tree-1a1-lod-1', { min: [-0.7122, -0.5865, -0.5643], max: [0.6969, 14.0243, 0.3696] }],
  ['vegetation-massive-tree-1a2', { min: [-0.6674, -0.702, -0.8472], max: [0.6353, 18.6537, 0.6399] }],
  ['vegetation-massive-tree-1a2-1-dark', { min: [-0.9652, -0.702, -0.8214], max: [0.9331, 18.6537, 0.8254] }],
  ['vegetation-massive-tree-1a2-lod-1', { min: [-0.9652, -0.702, -0.8214], max: [0.9331, 18.6537, 0.8254] }],
  ['vegetation-massive-tree-1a3', { min: [-0.8569, -1.2048, -1.4273], max: [1.3304, 28.875, 1.2924] }],
  ['vegetation-massive-tree-1a3-1-dark', { min: [-1.2413, -1.2235, -1.3237], max: [1.7147, 28.875, 1.2972] }],
  ['vegetation-massive-tree-1a3-lod-1', { min: [-1.2804, -1.2235, -1.4273], max: [1.1295, 28.875, 1.2972] }],
  ['vegetation-pine-1b1', { min: [-0.3211, -0.5613, -0.3211], max: [0.3211, 15.5783, 0.3211] }],
  ['vegetation-pine-1b1-0', { min: [-0.3211, -0.5613, -0.3211], max: [0.3211, 15.5783, 0.3211] }],
  ['vegetation-pine-1b1-1', { min: [-0.3211, -0.5613, -0.3211], max: [0.3211, 13.6217, 0.1271] }],
  ['vegetation-pine-1b2', { min: [-0.5691, -0.9457, -0.5691], max: [0.5692, 26.277, 0.5692] }],
  ['vegetation-pine-1b2-1', { min: [-0.5691, -0.9457, -0.5691], max: [0.5692, 22.9772, 0.222] }],
  ['vegetation-pine-1b3', { min: [-0.7915, -1.4887, -0.7915], max: [0.7915, 33.4801, 0.7915] }],
  ['vegetation-pine-1b3-1', { min: [-0.7915, -1.4887, -0.7915], max: [0, 31.9146, 0.7915] }],
  ['vegetation-pine-1b4', { min: [-0.4629, -0.0001, -0.4629], max: [0.4629, 23.8108, 0.4629] }],
  ['vegetation-pine-1b4-0', { min: [-0.4629, -0.0001, -0.4629], max: [0.4629, 23.8108, 0.4629] }],
  ['vegetation-pine-1b4-1', { min: [-0.4629, -0.0001, -0.4629], max: [0.4629, 20.2838, 0] }],
  ['vegetation-pine-1b5', { min: [-0.7364, 0.0029, -0.7364], max: [0.7364, 34.8642, 0.7364] }],
  ['vegetation-pine-1b5-0', { min: [-0.7364, 0.0029, -0.7364], max: [0.7364, 34.8642, 0.7364] }],
  ['vegetation-pine-1b5-1', { min: [-0.7364, 0.0029, -0.7364], max: [-0.0001, 29.7046, 0.7364] }],
  ['vegetation-small-thin-tree-1a2', { min: [-0.1062, -0.2611, -0.1169], max: [0.1062, 8.1028, 0.1169] }],
  ['vegetation-small-thin-tree-1a3', { min: [-0.1824, -0.2611, -0.165], max: [0.1824, 11.1969, 0.165] }],
  ['vegetation-small-thin-tree-1a5', { min: [-0.1403, -0.2613, -0.1403], max: [0.1403, 10.3542, 0.1403] }],
  ['vegetation-split-tree-1a1', { min: [-0.2489, -0.155, -0.2422], max: [0.1462, 7.5991, 0.1438] }],
  ['vegetation-split-tree-1a1-1-dark', { min: [-0.2489, -0.1579, -0.2288], max: [0.1651, 7.5991, 0.2048] }],
  ['vegetation-split-tree-1a1-lod-1', { min: [-0.23, -0.1579, -0.2288], max: [0.14, 7.3347, 0.1883] }],
  ['vegetation-split-tree-1a2', { min: [-0.3105, -0.3056, -0.3349], max: [0.1937, 9.2673, 0.3368] }],
  ['vegetation-split-tree-1a2-1-dark', { min: [-0.283, -0.3086, -0.2153], max: [0.2886, 9.2673, 0.3407] }],
  ['vegetation-split-tree-1a2-lod-1', { min: [-0.283, -0.3086, -0.3112], max: [0.2776, 9.0179, 0.3407] }],
  ['vegetation-split-tree-1a3', { min: [-0.5553, -0.359, -0.4308], max: [0.4754, 15.2192, 0.4834] }],
  ['vegetation-split-tree-1a3-1-dark', { min: [-0.4733, -0.359, -0.4537], max: [0.5275, 15.2192, 0.5307] }],
  ['vegetation-split-tree-1a3-lod-1', { min: [-0.5262, -0.359, -0.4537], max: [0.525, 14.8262, 0.4853] }],
  ['vegetation-tree-1a3', { min: [-0.7324, -1.0234, -0.7214], max: [0.7309, 25.4475, 0.7324] }],
  ['vegetation-tree-1a3-1', { min: [-0.7324, -1.0234, -0.7214], max: [0.7309, 24.5484, -0.0002] }],
  ['vegetation-tree-1a3-2', { min: [-0.7324, -1.0234, -0.7214], max: [0.7309, 20.8074, -0.0002] }],
  ['vegetation-tree-1a4', { min: [-0.3536, -0.5833, -0.3552], max: [0.2869, 13.889, 0.2863] }],
  ['vegetation-tree-1a4-1', { min: [-0.3481, -0.5836, -0.3552], max: [0.0021, 13.8888, 0.001] }],
  ['vegetation-tree-1a4-2', { min: [-0.3481, -0.5836, -0.3552], max: [0.0021, 11.7744, 0.001] }],
  ['vegetation-tree-1a5', { min: [-0.2805, -0.5043, -0.2825], max: [0.2266, 12.0464, 0.2244] }],
  ['vegetation-tree-1a5-1', { min: [-0.2805, -0.5046, -0.2825], max: [0.1328, 12.0462, 0.1332] }],
  ['vegetation-tree-1a5-2', { min: [-0.2805, -0.5046, -0.2825], max: [0.1328, 10.2125, 0.1332] }],
  ['vegetation-tree-1b1', { min: [-0.2322, -0.5009, -0.1676], max: [0.2955, 11.1426, 0.3609] }],
  ['vegetation-tree-1b1-1', { min: [-0.2322, -0.5009, -0.1676], max: [0.1673, 10.5919, 0.2338] }],
  ['vegetation-tree-1b1-2', { min: [-0.2322, -0.5009, -0.1676], max: [0.1673, 10.3422, 0.2338] }],
  ['vegetation-tree-1b2', { min: [-0.5595, -1.0929, -0.4576], max: [0.4569, 16.7467, 0.5568] }],
  ['vegetation-tree-1b2-1', { min: [-0.5595, -1.0929, -0.4576], max: [0.0857, 15.9142, 0.5568] }],
  ['vegetation-tree-1b2-2', { min: [-0.5595, -1.0929, -0.4576], max: [0.0857, 15.5377, 0.5568] }],
  ['vegetation-tree-1b3', { min: [-0.8071, -1.0332, -0.8067], max: [0.6689, 22.9761, 0.672] }],
  ['vegetation-tree-1b3-1', { min: [-0.8071, -1.0332, -0.8067], max: [0.1609, 21.909, 0.1595] }],
  ['vegetation-tree-1b3-2', { min: [-0.8071, -1.0332, -0.8067], max: [0.1609, 21.3684, 0.1595] }],
  ['vegetation-tree-1c1', { min: [-0.2575, -0.5106, -0.2424], max: [0.2381, 8.3476, 0.2531] }],
  ['vegetation-tree-1c1-1', { min: [-0.2575, -0.5106, -0.2424], max: [0.2381, 7.3986, 0.2531] }],
  ['vegetation-tree-1c1-2', { min: [-0.2575, -0.5106, -0.2424], max: [0.2381, 7.3639, 0.2531] }],
  ['vegetation-tree-1c2', { min: [-0.2337, -0.6425, -0.1564], max: [0.2333, 9.3599, 0.3105] }],
  ['vegetation-tree-1c2-1', { min: [-0.2337, -0.6425, -0.1564], max: [0.2333, 8.1052, 0.3105] }],
  ['vegetation-tree-1c2-2', { min: [-0.2337, -0.6425, -0.1564], max: [0.2333, 8.1052, 0.3105] }],
  ['vegetation-tree-1c3', { min: [-0.4767, -0.9624, -0.4828], max: [0.5218, 11.3802, 0.5157] }],
  ['vegetation-tree-1d1', { min: [-0.2, 0, -0.2], max: [0.2, 10.9018, 0.2] }],
  ['vegetation-tree-1d1-1', { min: [-0.2, 0, -0.2], max: [0.2, 9.8662, 0.0473] }],
  ['vegetation-tree-1d1-2', { min: [-0.2, 0, -0.2], max: [0.2, 7.1908, 0.0473] }],
  ['vegetation-tree-1d2', { min: [-0.1322, 0, -0.1322], max: [0.1322, 10.983, 0.1322] }],
  ['vegetation-tree-1d2-1', { min: [-0.1322, 0, -0.1322], max: [0.1322, 10.1119, 0.0683] }],
  ['vegetation-tree-1d2-2', { min: [-0.1322, 0, -0.1322], max: [0.1322, 6.6782, 0.0683] }],
  ['vegetation-tree-1e1', { min: [-0.6787, -0.428, -0.674], max: [0.6518, 16.8445, 0.6572] }],
  ['vegetation-tree-1e1-1', { min: [-0.6787, -0.428, -0.674], max: [0.0231, 15.0609, 0.5474] }],
  ['vegetation-tree-1e1-2', { min: [-0.6787, -0.428, -0.674], max: [0.0231, 10.2237, 0.5474] }],
  ['vegetation-tree-1e2', { min: [-0.5094, -0.4387, -0.4974], max: [0.5135, 16.7336, 0.5248] }],
  ['vegetation-tree-1e2-1', { min: [-0.5094, -0.4387, -0.4974], max: [0.4137, 14.7634, 0.4135] }],
  ['vegetation-tree-1e2-2', { min: [-0.5094, -0.4387, -0.4974], max: [0.4137, 11.1687, 0.4135] }],
]);

/** Die Namen des Speichers — die Grenze, ausserhalb derer nichts gilt. */
const STORE_NAMEN: ReadonlySet<StorePrefabName> = new Set(STORE_MODELL_NAMEN);

/**
 * Die Kollisionsangabe eines Prefabs — `null` für alles, was nicht aus
 * dem Speicher kommt.
 *
 * Die Unterscheidung ist nötig, weil die Tabelle Ausnahmen führt: Ohne
 * die Namensgrenze bekäme JEDER Name die Vorgabe `box`, auch
 * `Beech_small1` aus dem Altbestand — und der hat mit dem Speicher
 * nichts zu tun.
 *
 * The store's collision record for a prefab, or null if it is not a
 * store prefab at all.
 */
export function storeKollision(prefabName: StorePrefabName): StoreKollision | null {
  if (!STORE_NAMEN.has(prefabName)) return null;
  if (STORE_OHNE_KOERPER.has(prefabName)) return { art: 'none' };
  const netz = STORE_KOLLISIONSNETZ.get(prefabName);
  if (netz !== undefined) return netz === null ? { art: 'mesh' } : { art: 'mesh', netz };
  const box = STORE_KOLLISIONSKISTE.get(prefabName);
  return box === undefined ? STORE_KOLLISION_VORGABE : { art: 'box', box };
}
