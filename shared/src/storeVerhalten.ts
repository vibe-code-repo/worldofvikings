/**
 * storeVerhalten.ts — ERZEUGT, NICHT VON HAND ÄNDERN.
 *
 *   npx tsx tools/store-prefabs.mjs
 *
 * Was ein Speicher-Prefab TUT, über PERSISTENT hinaus: 41 Einträge
 * (4 betten, 33 felsen, 4 truhen). Alles, was hier nicht steht, ist
 * Deko und trägt nur PERSISTENT (`storePrefabs.ts`).
 *
 * Die Wahrheit ist das Feld `verhalten` in der Prefab-Quelle; solange
 * `prefabs.json` es nicht führt, kommen die Einträge aus der
 * Ausnahmetabelle `VERHALTEN_REGELN` in `tools/store-prefabs.mjs`. Der Spielcode
 * (`prefabs.ts`) liest nur diese Tabelle und erkennt keine Namen.
 *
 * Generated store behaviour table — do not edit by hand.
 */
import { PrefabFlag as F } from './types.js';

/** Prefabname → vollständige Flags (ODER-verknüpft mit denen aus `storePrefabs.ts`). */
export const STORE_VERHALTEN: ReadonlyMap<string, bigint> = new Map<string, bigint>([
  ['environment-chestbottom', F.CONTAINER | F.PERSISTENT], // truhen
  ['environment-sm-env-rock-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-03', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-03-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-03-2', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-04', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-04-2', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-chunk-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-chunk-01-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-chunk-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-chunk-03', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-chunk-03-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-02-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-03', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-03-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-05', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-cliff-05-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-pebble-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-pebble-02-1', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-round-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-round-01-2', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-round-03', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-round-04', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-spike-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-spike-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-spike-03', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-spike-04', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-rock-spike-05', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-stone-01', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-stone-02', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-env-stone-02-snow', F.MINE_ROCK_5 | F.PERSISTENT], // felsen
  ['environment-sm-prop-bed-03', F.BED | F.PERSISTENT | F.PIECE], // betten
  ['environment-sm-prop-bed-04', F.BED | F.PERSISTENT | F.PIECE], // betten
  ['environment-sm-prop-bed-05', F.BED | F.PERSISTENT | F.PIECE], // betten
  ['environment-sm-prop-bed-06', F.BED | F.PERSISTENT | F.PIECE], // betten
  ['environment-sm-prop-chest-01', F.CONTAINER | F.PERSISTENT], // truhen
  ['environment-sm-prop-chest-01-0', F.CONTAINER | F.PERSISTENT], // truhen
  ['environment-sm-prop-chest-04', F.CONTAINER | F.PERSISTENT], // truhen
]);
