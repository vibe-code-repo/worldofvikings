/**
 * D5 — which prefab and which model a piece of loot on the ground gets.
 *
 * Found on DEV (02.10.2026): a killed wolf left a placeholder box. Not one of the 26 item prefabs has a model file,
 * and 92 items (armour, weapons) have no prefab at all, so the client either drew a box or dropped the ZDO without
 * a trace. Now:
 *   - the server lays a piece under the item's own `ITEM_DROP` prefab if there is one, else under `BEUTE_PREFAB`;
 *   - the client draws the item's own model if it is on the list of own models (`EIGENE_MODELLE_SET`, the list is
 *     the truth, not the disk), else the existing chest model, scaled down. The box stays for debugging only
 *     (a model that is on the list but fails to load).
 * No new asset: `HolzTruhe` is an existing model.
 */
import { PrefabFlag } from './types.js';
import { EIGENE_MODELLE_SET, findPrefabByName } from './prefabs.js';
import type { PrefabDef } from './prefabs.js';

/** The neutral loot prefab (an `ITEM_DROP` entry in `prefabs.ts`) for items that have no prefab of their own. */
export const BEUTE_PREFAB = 'BeuteStueck';
/** The fallback model of loot: an existing chest model (no new asset). */
export const BEUTE_RUECKFALL_MODELL = 'HolzTruhe';
/**
 * The chest as loot: scale 0.4. Measured on the file (`assets/manifest.json`, `huelle`, measured from `HolzTruhe.glb`):
 * the origin is on the floor (min y = 0.000), the box is 0.96 x 0.605 x 0.646 m. At 0.4 the piece is 0.384 x 0.242 x 0.258 m:
 * nothing sinks into the ground (min y x 0.4 = 0 >= -0.02 m) and the longest edge, 0.384 m, lies between 0.25 and 0.6 m, so it
 * is seen but is not a chest in the grass. Tests: `server/test/d5-beute-prefab.ts` (value from the tracked manifest, runs in the CI)
 * and `client/test/d5-beute-modelle.ts` (the file itself, with assets).
 */
export const BEUTE_RUECKFALL_SKALA = 0.4;

/** The prefab the server lays a piece of loot of the item `name` under: its own `ITEM_DROP` prefab, else the neutral one. */
export function beutePrefabFuer(name: string): string {
  const def = findPrefabByName(name);
  return def && (def.flags & PrefabFlag.ITEM_DROP) !== 0n ? def.name : BEUTE_PREFAB;
}

/** Model and extra scale for an `ITEM_DROP` prefab: its own model if it is a known own model, else the fallback chest. */
export function beuteDarstellung(def: Pick<PrefabDef, 'model'>): { modell: string; skala: number } {
  if (def.model && EIGENE_MODELLE_SET.has(def.model)) return { modell: def.model, skala: 1 };
  return { modell: BEUTE_RUECKFALL_MODELL, skala: BEUTE_RUECKFALL_SKALA };
}
