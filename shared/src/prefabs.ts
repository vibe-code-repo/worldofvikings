/**
 * Shared prefab registry — single source of truth for prefab definitions
 * used by both server (spawning/logic) and client (rendering/assets).
 *
 * The base data (name, localScale, flags) is parsed 1:1 from the C++
 * server's prefabs.pkg (valheim.community/data/prefabs.pkg, see
 * PrefabManager::Register in valheim.community/library/src/PrefabManager.cpp)
 * into prefabData.json — regenerate with:
 *
 *   npm run parse:prefabs
 *
 * On top of that, hand-maintained render hints are merged in by name:
 *   - sprite: file name (without extension) in assets/sprites/
 *             (default: prefab name — the sprite files use item names)
 *   - model:  GLB file name (without extension) in assets/models/
 *             (default: prefab name; missing files fall back to a 3D box)
 *   - renderScale: size of the placeholder box shown until the GLB loads
 *             (NOT applied to the real model — GLBs render at their
 *             natural size × pkg localScale × ZDO "scaleScalar")
 *
 * The prefab hash is ALWAYS getStableHash(name) — identical to the C++
 * server (verified: all 3447 pkg hashes match), so hashes stay
 * compatible with prefabs.pkg data.
 */

import { PrefabFlag } from './types.js';
import { getStableHash } from './hash.js';
import type { Hash, Vector3 } from './types.js';
import prefabData from './prefabData.json';
import { DUNGEONS, ENTRANCE_HULL_MODELS } from './dungeons.js';

export interface PrefabDef {
  name: string;
  flags: bigint;
  localScale: Vector3;
  /** Sprite file name (no extension) under assets/sprites/. */
  sprite: string | null;
  /** Placeholder box size (width, height) shown until the GLB loads. */
  renderScale: { w: number; h: number };
  /** GLB model file name (no extension) under assets/models/, null = 3D placeholder. */
  model: string | null;
  /**
   * Animationsgruppe der GLB, die nach dem Instanzieren in Schleife läuft
   * (nur dynamische Prefabs, Namens-Teiltreffer genügt). Eigene NPCs
   * bringen — anders als der Valheim-Export — brauchbare Skin-Animationen
   * mit.
   */
  animation?: string;
  /** Lichtquelle (Fackel/Feuer): Farbe 0..1, Reichweite in m, Flackern. */
  light?: {
    color: [number, number, number];
    intensity: number;
    range: number;
    offsetY: number;
    flicker: boolean;
  };
}

/**
 * Licht-Hints je Prefabname — gespeist aus den Unity-Light-Komponenten der
 * Originale (warmes Fackel-Orange bzw. Grünfeuer der Sumpf-Sets).
 */
const LIGHT_HINTS: ReadonlyMap<string, NonNullable<PrefabDef['light']>> = new Map([
  ['CastleKit_groundtorch', { color: [1.0, 0.62, 0.28], intensity: 14, range: 14, offsetY: 1.1, flicker: true }],
  ['CastleKit_groundtorch_green', { color: [0.35, 1.0, 0.5], intensity: 12, range: 13, offsetY: 1.1, flicker: true }],
  ['piece_groundtorch', { color: [1.0, 0.62, 0.28], intensity: 14, range: 14, offsetY: 1.1, flicker: true }],
  ['piece_groundtorch_green', { color: [0.35, 1.0, 0.5], intensity: 12, range: 13, offsetY: 1.1, flicker: true }],
  ['piece_groundtorch_blue', { color: [0.35, 0.55, 1.0], intensity: 12, range: 13, offsetY: 1.1, flicker: true }],
  ['piece_walltorch', { color: [1.0, 0.62, 0.28], intensity: 12, range: 12, offsetY: 0.3, flicker: true }],
  ['fire_pit', { color: [1.0, 0.55, 0.22], intensity: 18, range: 16, offsetY: 0.5, flicker: true }],
  ['bonfire', { color: [1.0, 0.55, 0.22], intensity: 24, range: 20, offsetY: 0.8, flicker: true }],
  ['hearth', { color: [1.0, 0.55, 0.22], intensity: 20, range: 18, offsetY: 0.6, flicker: true }],
  ['dvergrlantern', { color: [0.45, 0.85, 1.0], intensity: 10, range: 11, offsetY: 0.4, flicker: false }],
]);

const F = PrefabFlag;
const ONE: Vector3 = { x: 1, y: 1, z: 1 };

function def(
  name: string,
  flags: bigint,
  sprite: string | null,
  w = 1,
  h = 1,
  model: string | null = null
): PrefabDef {
  return { name, flags, localScale: ONE, sprite, renderScale: { w, h }, model };
}

/**
 * Hand-maintained render hints. Names match Valheim prefab names 1:1;
 * entries here override the automatic defaults (sprite/model = prefab
 * name, renderScale = localScale) for prefabs from prefabs.pkg.
 * Entries that no longer exist in the pkg are kept as legacy extras
 * (the demo world spawns some of them).
 */
export const HINT_DEFS: PrefabDef[] = [
  // ── Player ───────────────────────────────────────────────────────
  // Mitspieler-Avatar: Player.glb ist mesh-los (Export-Lücke) — bis ein
  // echtes Spielermodell existiert, rendert der eigene NPC-Körper mit
  // Walking-Loop. Deutlich besser als die Platzhalter-Kapsel.
  { ...def('Player', F.SYNCED_TRANSFORM, null, 1, 1.8, 'npc_1_walk'), animation: 'Walking' },

  // ── Creatures ────────────────────────────────────────────────────
  // G2: the eponymous Boar.glb / greydwarf.glb are mesh-less bone rigs
  // (0 meshes, invisible) — route through the meshed variants instead.
  // 2026-07-25: Boar_0.glb enthielt nur die Fangzaehne (46 Verts) und
  // greydwarf@Idle.glb nur 2 Quads — beide Koerper fehlten im Export.
  // *_fixed.glb sind aus den Bind-Space-Quellmeshes gebackene, texturierte
  // Koerper (tools/fix-creature-models.js); Deer.glb wurde mit Textur
  // injiziert (Backup: Deer.glb.bak). Deer.glb selbst enthaelt nur die 5
  // Geweih-Meshes (SkinnedMesh-Koerper gedroppt) -> Deer_fixed aus "Deer 003".
  def('Boar', F.ANIMAL_AI | F.TAMEABLE | F.PROCREATION, 'raw_meat', 1.2, 1.0, 'Boar_fixed'),
  def('Deer', F.ANIMAL_AI, 'deer_meat', 1.4, 1.4, 'Deer_fixed'),
  def('Neck', F.MONSTER_AI, 'necktail', 1.0, 0.8),
  def('Greyling', F.MONSTER_AI, 'greydwarf_eye', 1.0, 1.4),
  def('Greydwarf', F.MONSTER_AI, 'TrophyGreydwarf', 1.2, 1.8, 'greydwarf_fixed'),
  def('Skeleton', F.MONSTER_AI, 'TrophySkeleton', 1.0, 1.8),
  def('Troll', F.MONSTER_AI, 'TrophyForestTroll', 3.0, 4.5),
  def('Eikthyr', F.MONSTER_AI, 'TrophyEikthyr', 3.0, 3.0),

  // ── Trees / vegetation ───────────────────────────────────────────
  def('Beech1', F.TREE_BASE | F.PERSISTENT, 'sapling_beech', 4.0, 8.0),
  def('FirTree', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 3.5, 9.0),
  def('Pinetree_01', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 3.5, 10.0),
  def('Oak1', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 6.0, 9.0),
  def('Birch1', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 3.5, 8.0),
  def('beech_log', F.TREE_LOG, 'roundlog', 3.0, 1.0),
  def('BushSeed', F.PLANT, 'beechseeds', 0.8, 0.8),

  // Eigenes Modell (Tripo, erzeugt mit tools/tripo-generate.mjs), kein
  // pkg-Prefab: buildRegistry() nimmt Hints ohne pkg-Gegenstück als
  // vollwertige Einträge auf; der Hash ist getStableHash(name), Server und
  // Client bauen dieselbe Registry aus dieser Datei.
  //
  // Zwei Werte, die NICHT geraten sind, sondern gemessen (das Skript druckt
  // sie): localScale 8.98, weil Tripo auf Kantenlänge 1 normiert — ohne das
  // steht ein kniehoher Baum da. Der Modellname muss ausgeschrieben werden,
  // denn das `model ?? name`-Fallback in buildRegistry() gilt nur für
  // pkg-Prefabs; Extras blieben sonst bei model=null (Platzhalterbox).
  { ...def('KiPine2', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 5.5, 9.0, 'KiPine2'),
    localScale: { x: 8.98, y: 8.98, z: 8.98 } },
  // Zweiter Baumversuch mit v3.1 und 15.000 face_limit (KiPine2 lief noch auf
  // v2.5). Die Textur ist deutlich besser — Farben stimmen, Rinde stellenweise
  // erkennbar —, bleibt aber ein Flickenteppich: Anders als beim Steinkreis
  // zerfällt die UV-Karte eines Baumes in hunderte kleine Ast-Inseln, auf denen
  // kein zusammenhängendes Muster entsteht. Zum Vergleichen beide behalten.
  { ...def('KiPine3', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 7.4, 12.0, 'KiPine3'),
    localScale: { x: 12, y: 12, z: 12 } },
  // Steinkreis (Tripo v3.1, 11.362 Dreiecke). Kein TREE_BASE — das Ding ist
  // ein Bauwerk, kein Gewächs: nicht fällbar, kein Wind. Die Kollision läuft
  // über BEGEHBAR in EntityManager.ts, sonst stünde eine Box im Durchgang.
  { ...def('Steinkreis', F.PERSISTENT, 'portal_stone', 3.9, 3.5, 'Steinkreis'),
    localScale: { x: 4.36, y: 4.36, z: 4.36 } },

  // ── Rocks / minable ──────────────────────────────────────────────
  def('Rock_4', F.MINE_ROCK_5 | F.PERSISTENT, 'stonerock', 3.0, 2.5),
  def('Rock_3', F.MINE_ROCK_5 | F.PERSISTENT, 'stonerock', 2.0, 1.8),
  def('rock4_copper', F.MINE_ROCK_5 | F.PERSISTENT, 'copperore', 3.0, 2.5),
  def('MineRock_Tin', F.MINE_ROCK_5 | F.PERSISTENT, 'TinOre', 1.2, 0.9),

  // ── Pickables ────────────────────────────────────────────────────
  def('Pickable_Mushroom', F.PICKABLE, 'mushroom', 0.5, 0.5),
  def('RaspberryBush', F.PICKABLE | F.PERSISTENT, 'raspberry', 1.2, 1.0),
  def('BlueberryBush', F.PICKABLE | F.PERSISTENT, 'blueberries', 1.0, 0.8),
  def('Pickable_Dandelion', F.PICKABLE, 'dandelion', 0.5, 0.5),
  def('Pickable_Thistle', F.PICKABLE, 'thistle', 0.6, 0.8),
  def('Pickable_Flint', F.PICKABLE, 'flint', 0.5, 0.4),
  def('Pickable_Stone', F.PICKABLE, 'stone', 0.6, 0.5),
  def('Pickable_Branch', F.PICKABLE, 'branch', 0.8, 0.4),

  // ── Item drops ───────────────────────────────────────────────────
  def('Wood', F.ITEM_DROP, 'wood', 0.6, 0.6),
  def('Stone', F.ITEM_DROP, 'stone', 0.5, 0.5),
  def('Flint', F.ITEM_DROP, 'flint', 0.5, 0.5),
  def('Resin', F.ITEM_DROP, 'resin', 0.4, 0.4),
  def('Feathers', F.ITEM_DROP, 'feather', 0.4, 0.4),
  def('RawMeat', F.ITEM_DROP, 'raw_meat', 0.5, 0.5),
  def('DeerHide', F.ITEM_DROP, 'deerhide', 0.5, 0.5),
  def('LeatherScraps', F.ITEM_DROP, 'leatherscraps', 0.5, 0.5),
  def('Coal', F.ITEM_DROP, 'coal', 0.4, 0.4),
  def('CopperOre', F.ITEM_DROP, 'copperore', 0.5, 0.5),
  def('TinOre', F.ITEM_DROP, 'TinOre', 0.5, 0.5),
  def('Hammer', F.ITEM_DROP, 'hammer', 0.6, 0.6),
  def('AxeStone', F.ITEM_DROP, 'axe_stone', 0.6, 0.6),
  def('PickaxeAntler', F.ITEM_DROP, 'pickaxe_antler', 0.6, 0.6),
  def('Club', F.ITEM_DROP, 'club', 0.6, 0.6),
  def('Torch', F.ITEM_DROP, 'torch', 0.5, 0.7),

  // ── Building pieces ──────────────────────────────────────────────
  def('piece_workbench', F.PIECE | F.CRAFTING_STATION | F.PERSISTENT, 'workbench', 2.0, 1.5),
  def('forge', F.PIECE | F.CRAFTING_STATION | F.PERSISTENT, 'forge', 2.0, 1.5),
  def('piece_chest_wood', F.PIECE | F.CONTAINER | F.PERSISTENT, 'chest_wood', 1.0, 0.8),
  def('fire_pit', F.PIECE | F.FIREPLACE | F.PERSISTENT, 'Campfire', 1.2, 0.8),
  def('bonfire', F.PIECE | F.FIREPLACE | F.PERSISTENT, 'bonfire', 2.0, 1.5),
  def('wood_wall', F.PIECE | F.WEAR_N_TEAR | F.PERSISTENT, 'wood_wall', 2.0, 2.0),
  def('wood_floor', F.PIECE | F.WEAR_N_TEAR | F.PERSISTENT, 'wood_floor', 2.0, 0.2),
  def('wood_door', F.PIECE | F.DOOR | F.PERSISTENT, 'wood_door', 1.2, 2.2),
  def('wood_roof', F.PIECE | F.WEAR_N_TEAR | F.PERSISTENT, 'wood_roof', 2.0, 1.0),
  def('bed', F.PIECE | F.BED | F.PERSISTENT, 'bed', 1.8, 0.6),
  def('portal_wood', F.PIECE | F.PERSISTENT, 'portal_wood', 3.0, 3.5),
  def('sign', F.PIECE | F.PERSISTENT, 'sign', 0.8, 0.6),
  def('piece_maypole', F.PIECE | F.PERSISTENT, 'maypole', 2.0, 5.0),
  def('guard_stone', F.PIECE | F.PERSISTENT, 'guardstone', 0.8, 1.2),

  // ── Ships / transport ────────────────────────────────────────────
  def('Raft', F.SHIP | F.PERSISTENT, 'raft', 3.0, 1.5),
  def('Karve', F.SHIP | F.PERSISTENT, 'karve', 5.0, 3.0),
  def('Cart', F.PIECE | F.PERSISTENT, 'cart', 2.5, 1.5),

  // ── Eigene NPCs (nicht im pkg — hint-only Extras) ────────────────
  // NPC_1: vom Nutzer erstelltes Modell (screenshots/npc_1_walk.glb →
  // assets/models/). SYNCED_TRANSFORM ⇒ dynamischer Renderpfad mit
  // Animation, PERSISTENT ⇒ überlebt den Welt-Save. Bewusst KEIN
  // *_AI-Flag: das Spawn-System soll ihn weder verwalten noch despawnen.
  { ...def('NPC_1', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 0.9, 1.5, 'npc_1_walk'), animation: 'Walking' },

  // ── Misc world objects ───────────────────────────────────────────
  def('Vegvisir', F.PERSISTENT, null, 1.5, 2.5),
  def('BossStone_Eikthyr', F.PERSISTENT, 'mapicon_boss', 2.0, 3.0),
  def('StartTemple', F.PERSISTENT, 'portal_stone', 8.0, 6.0),
  def('TreasureChest_meadows', F.CONTAINER | F.PERSISTENT, 'chest_treasure', 1.0, 0.8),
];

// ── Registry construction (pkg data + hints) ──────────────────────

interface PkgPrefab {
  name: string;
  oldHash: number;
  localScale: Vector3;
  /** uint64 bitfield as decimal string (JSON has no bigint). */
  flags: string;
}

const HINTS_BY_NAME: ReadonlyMap<string, PrefabDef> = new Map(
  HINT_DEFS.map((p) => [p.name, p])
);

/**
 * Full prefab registry: every prefab from the C++ server's prefabs.pkg
 * with its original localScale and flags, plus render hints merged in.
 * Legacy hint-only prefabs (not present in the pkg) are appended so the
 * demo world keeps working.
 */
export const PREFAB_DEFS: PrefabDef[] = buildRegistry();

function buildRegistry(): PrefabDef[] {
  const defs: PrefabDef[] = [];
  const seen = new Set<string>();

  for (const p of prefabData.prefabs as PkgPrefab[]) {
    seen.add(p.name);
    const hint = HINTS_BY_NAME.get(p.name);
    defs.push({
      name: p.name,
      flags: BigInt(p.flags),
      localScale: p.localScale,
      // default: sprite/model files share the prefab (item) name;
      // an explicit null in a hint also falls back to the name
      sprite: hint?.sprite ?? p.name,
      renderScale: hint
        ? hint.renderScale
        : {
            w: Math.max(0.2, p.localScale.x),
            h: Math.max(0.2, p.localScale.y),
          },
      model: hint?.model ?? p.name,
      animation: hint?.animation,
      light: hint?.light ?? LIGHT_HINTS.get(p.name),
    });
  }

  // Legacy extras (hints whose prefab no longer exists in the pkg)
  for (const hint of HINT_DEFS) {
    if (!seen.has(hint.name)) defs.push(hint);
  }

  // Phase G: dungeon room shells. Rooms are not ZNetView prefabs (absent
  // from prefabs.pkg) — the dungeon system spawns them as plain static
  // ZDOs, so the client needs registry entries to resolve their GLBs.
  // PERSISTENT: Camp-Gebäude in der Oberwelt müssen den Welt-Save
  // überleben (sonst spawnt der Boot-Backfill sie doppelt zu den bereits
  // gesicherten netViews). Dungeon-INSTANZEN bleiben trotzdem flüchtig —
  // saveWorld filtert das Instanz-Band ohnehin komplett aus.
  for (const d of DUNGEONS) {
    for (const room of d.rooms) {
      if (seen.has(room.name)) continue;
      seen.add(room.name);
      defs.push({
        name: room.name,
        flags: PrefabFlag.PERSISTENT,
        localScale: ONE,
        sprite: null,
        renderScale: { w: Math.max(1, room.size.x), h: Math.max(1, room.size.y) },
        model: room.name,
      });
    }
  }

  // Phase G: sichtbare Eingangs-Hüllen der Dungeon-Locations (Crypt2 …) —
  // im Original statische Prefab-Geometrie via LocationProxy, bei uns ein
  // statisches ZDO je Eingang (DungeonManager.spawnEntranceHull).
  for (const hull of ENTRANCE_HULL_MODELS) {
    if (seen.has(hull)) continue;
    seen.add(hull);
    defs.push({
      name: hull,
      flags: 0n,
      localScale: ONE,
      sprite: null,
      renderScale: { w: 8, h: 6 },
      model: hull,
    });
  }

  return defs;
}

/**
 * Whether a prefab should get a visual representation in the world.
 * Filters out internal/logic prefabs (zone controllers, projectiles,
 * terrain modifiers) that have no visible mesh.
 */
export function isRenderable(def: PrefabDef): boolean {
  if (def.name.startsWith('_')) return false;
  // LocationProxy (Phase F): in Unity this component generates the location
  // model client-side. Our server spawns the location PIECES as ZDOs
  // directly, so the proxy ZDO itself must stay invisible.
  if (def.name === 'LocationProxy') return false;
  // Logic/marker prefabs that are invisible in Valheim as well (found
  // live-verified 2026-07-25 as ~46 permanent placeholder boxes around the
  // spawn meadows): ambient music volumes, creature spawn markers, and the
  // flies particle effect (no particle system in the client). Their GLBs
  // are either absent from the export entirely (404) or 0-mesh hierarchy
  // exports — without this rule their buckets keep the placeholder boxes
  // forever. Note the patterns are deliberately tight: visible prefabs
  // like BonePileSpawner / CharredStone_Spawner do NOT match.
  if (def.name.startsWith('Music_') || def.name.endsWith('LocationMusic')) return false;
  if (def.name.startsWith('Spawner_')) return false;
  if (def.name === 'Flies') return false;
  // Pickable_DolmenTreasure (found 2026-07-25 as the last remaining
  // permanent placeholder box, 6 instances in Dolmen locations): its GLB
  // export is a 0-mesh empty hierarchy (AssetRipper found no MeshRenderer
  // for it in the Unity project either — the visible loot in a Dolmen is
  // the separate "treasure_pile" decoration piece; this prefab is purely
  // the invisible pickup trigger). Hiding it matches vanilla Valheim, where
  // it has no visible mesh.
  if (def.name === 'Pickable_DolmenTreasure') return false;
  const NO_RENDER = PrefabFlag.PROJECTILE | PrefabFlag.TERRAIN_MODIFIER;
  return (def.flags & NO_RENDER) === 0n;
}

// ── Lookup structures ──────────────────────────────────────────────

/** hash -> PrefabDef */
export const PREFABS_BY_HASH: ReadonlyMap<Hash, PrefabDef> = new Map(
  PREFAB_DEFS.map((p) => [getStableHash(p.name), p])
);

/** name -> PrefabDef */
export const PREFABS_BY_NAME: ReadonlyMap<string, PrefabDef> = new Map(
  PREFAB_DEFS.map((p) => [p.name, p])
);

export function findPrefabByHash(hash: Hash): PrefabDef | undefined {
  return PREFABS_BY_HASH.get(hash);
}

export function findPrefabByName(name: string): PrefabDef | undefined {
  return PREFABS_BY_NAME.get(name);
}
