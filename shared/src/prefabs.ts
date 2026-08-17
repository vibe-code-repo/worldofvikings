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
  // Prozedurale Fichten aus tools/baum-generieren.py (Blender/Sapling) mit den
  // ORIGINAL-Nadelkarten aus PineTree_01.png. Anders als bei den Tripo-Bäumen
  // ist das Laub echtes Cutout — der Umriss ist durchbrochen, und Windplugin
  // wie Cutout-Erkennung greifen ohne Sonderweg.
  //
  // Kein localScale: Das Skript exportiert in Metern, nicht auf 1 normiert.
  // Je Baum rund 2.500 Dreiecke, also das Budget des Originals (2.532) — der
  // Tripo-Baum daneben braucht 13.898. Varianten kosten nur einen anderen Seed.
  def('Fichte1', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 6.4, 12.0, 'Fichte1'),
  def('Fichte2', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 7.0, 14.0, 'Fichte2'),
  def('Fichte3', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 5.4, 10.0, 'Fichte3'),
  // Tannen nach dem Original-Prefab `FirTree` (gedrungen, waagerechte Äste),
  // mit dessen eigener Nadeltextur Pine_tree_texture_d.png — feiner gefiedert
  // als die Kiefernkarten der Fichten. Vier Größen, weil Valheim dieselbe
  // Tanne über `scale 2.0–2.5` (gross) und `0.3–0.7` (FirTree_small) verteilt;
  // getrennte Modelle statt Skalierung, damit auch die FORM variiert.
  // Dreiecksbudget staffelt über --dichte mit: 4.214 / 3.316 / 1.910 / 1.182.
  def('Tanne1', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 7.5, 12.0, 'Tanne1'),
  def('Tanne2', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 5.8, 9.0, 'Tanne2'),
  def('Tanne3', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 4.0, 6.0, 'Tanne3'),
  def('Tanne4', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 2.2, 3.2, 'Tanne4'),
  // Birken-Set nach Birch1/Birch2, in zwei Wuchsformen je drei Größen.
  // Laubbaum heißt bei Sapling: Äste STREBEN NACH OBEN (attractUp positiv),
  // Krone kugelig statt konisch. Texturen getrennt — birch_leaf.png ist eine
  // einzige Karte mit einem ganzen belaubten Zweig (61 % Löcher),
  // birch_bark.png liefert die helle Rinde.
  //
  // "Hoch" = freier Stamm bis 40 % der Höhe, lockere Krone obenauf.
  // "Dicht" = Laub ab 18 %, geschlossene Krone. Maße gemessen, nicht geraten.
  def('BirkeHoch1', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 3.9, 5.1, 'BirkeHoch1'),
  def('BirkeHoch2', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 5.4, 9.7, 'BirkeHoch2'),
  def('BirkeHoch3', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 7.3, 12.4, 'BirkeHoch3'),
  def('BirkeDicht1', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 5.2, 6.1, 'BirkeDicht1'),
  def('BirkeDicht2', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 7.3, 9.6, 'BirkeDicht2'),
  def('BirkeDicht3', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 8.4, 12.5, 'BirkeDicht3'),
  // Eichen — die einzige Art mit EIGENEN Texturen. eiche_leaf.png und
  // eiche_bark.png zeichnet tools/eiche-texturen.py prozedural, nichts davon
  // stammt aus Valheim. Der Rest der Kette ist unverändert.
  //
  // Habitus: kurzer dicker Stamm, tief ansetzende Äste, die waagerecht
  // herausgehen und sich erst außen aufrichten. Breiter als Fichte und Birke
  // (Verhältnis 1,2 statt 1,9), aber bewusst nicht breiter als hoch — ein
  // erster Versuch stand bei 15,7 × 13,2 m und hätte im Wald den Platz von
  // drei Fichten gebraucht. Das Original `Oak1` (Zeile 126) liegt bei 6 × 9.
  //
  // Wenige GROSSE Laubkarten (42 Stück, leafScale 1,35): Mit 96 kleinen sah
  // die Krone aus wie Farnwedel statt wie Eichenlaub. Maße gemessen.
  def('Eiche1', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 10.5, 12.8, 'Eiche1'),
  def('Eiche2', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 8.9, 10.7, 'Eiche2'),
  def('Eiche3', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 12.7, 16.1, 'Eiche3'),

  // ── Grosse Bäume (08/2026) ───────────────────────────────────────
  // Nach den Vorbildern: Was einen Wald tief wirken lässt, ist nicht die
  // Kronenhöhe, sondern der STAMM — er nimmt die Weitsicht, und der Blick
  // bleibt an ihm hängen statt bis zum Horizont zu laufen.
  //
  // Zwei Werte tragen das, beide im Rezept (tools/baeume-bauen.sh):
  //   karte  skaliert die Blattkarten mit (sonst wird ein 22-m-Baum licht,
  //          weil `leafScale` bei Sapling eine absolute Länge ist)
  //   stamm  skaliert `ratio` — die Riesen tragen gut einen Meter
  //          Durchmesser statt 62 cm
  def('Fichte4', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 9.8, 19.0, 'Fichte4'),
  def('Fichte5', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 9.5, 21.5, 'Fichte5'),
  def('Fichte6', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 10.9, 23.6, 'Fichte6'),
  def('Tanne5', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 10.4, 16.3, 'Tanne5'),
  def('Tanne6', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 13.7, 20.0, 'Tanne6'),
  def('Tanne7', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 15.9, 22.5, 'Tanne7'),
  // Kiefer: langer astfreier Stamm, Schirmkrone. Ein Fichtenwald schliesst
  // unten, ein Kiefernwald oben — erst zusammen ergeben sie einen Wald,
  // durch den man weder hindurchsieht noch hinaufschaut.
  def('Kiefer1', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 14.3, 18.3, 'Kiefer1'),
  def('Kiefer2', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 17.5, 21.6, 'Kiefer2'),
  def('Kiefer3', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 22.0, 25.9, 'Kiefer3'),
  def('Kiefer4', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 23.7, 28.8, 'Kiefer4'),
  def('Eiche4', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 18.9, 24.0, 'Eiche4'),
  def('BirkeHoch4', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 10.2, 17.2, 'BirkeHoch4'),
  def('BirkeDicht4', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 11.6, 15.7, 'BirkeDicht4'),

  // ── Dicke Stammvarianten ─────────────────────────────────────────
  // Von jedem Baum eine zweite Ausfertigung mit Stammfaktor 1.8
  // (`tools/baeume-bauen.sh`, Tabelle DICKE). Seed, Höhe, Dichte und
  // Kartenfaktor sind Zeichen für Zeichen die der Vorlage — geändert ist
  // GENAU eine Größe. Die dicke Variante ist derselbe Baum, nicht ein
  // anderer, und ein Wald aus beiden liest sich als ein Bestand mit
  // unterschiedlich alten Stämmen statt als zwei zusammengewürfelten Sätzen.
  //
  // Warum es sie gibt, steht im Bauplan der drei Urwaldriesen: Nicht die
  // Kronenhöhe lässt einen Wald tief wirken, sondern der Stamm — „ein
  // hoher Baum mit dünnem Stamm sieht aus wie eine Stange mit Grün
  // obendrauf". Das galt bisher für drei von 29 Bäumen.
  //
  // Die drei Riesen (Fichte6, Kiefer4, Tanne7) fehlen absichtlich: Sie
  // tragen bereits 1.8 bis 2.1.
  //
  // Die Maße sind NICHT neu gemessen, sondern die der dünnen Geschwister —
  // und das ist keine Abkürzung: Nachgemessen am 17.08.2026 sind die
  // Hüllboxen IDENTISCH (Fichte1 wie Fichte1Dick 5,84 × 12,18 m). Der
  // Faktor verdickt den Stamm; die Ausdehnung bestimmt die Krone.
  def('Fichte1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 6.4, 12.0, 'Fichte1Dick'),
  def('Fichte2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 7.0, 14.0, 'Fichte2Dick'),
  def('Fichte3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 5.4, 10.0, 'Fichte3Dick'),
  def('Tanne1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 7.5, 12.0, 'Tanne1Dick'),
  def('Tanne2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 5.8, 9.0, 'Tanne2Dick'),
  def('Tanne3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 4.0, 6.0, 'Tanne3Dick'),
  def('Tanne4Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 2.2, 3.2, 'Tanne4Dick'),
  def('BirkeHoch1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 3.9, 5.1, 'BirkeHoch1Dick'),
  def('BirkeHoch2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 5.4, 9.7, 'BirkeHoch2Dick'),
  def('BirkeHoch3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 7.3, 12.4, 'BirkeHoch3Dick'),
  def('BirkeDicht1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 5.2, 6.1, 'BirkeDicht1Dick'),
  def('BirkeDicht2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 7.3, 9.6, 'BirkeDicht2Dick'),
  def('BirkeDicht3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 8.4, 12.5, 'BirkeDicht3Dick'),
  def('Eiche1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 10.5, 12.8, 'Eiche1Dick'),
  def('Eiche2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 8.9, 10.7, 'Eiche2Dick'),
  def('Eiche3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 12.7, 16.1, 'Eiche3Dick'),
  def('Fichte4Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 9.8, 19.0, 'Fichte4Dick'),
  def('Fichte5Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 9.5, 21.5, 'Fichte5Dick'),
  def('Tanne5Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 10.4, 16.3, 'Tanne5Dick'),
  def('Tanne6Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_fir', 13.7, 20.0, 'Tanne6Dick'),
  def('Kiefer1Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 14.3, 18.3, 'Kiefer1Dick'),
  def('Kiefer2Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 17.5, 21.6, 'Kiefer2Dick'),
  def('Kiefer3Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 22.0, 25.9, 'Kiefer3Dick'),
  def('Eiche4Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_oak', 18.9, 24.0, 'Eiche4Dick'),
  def('BirkeHoch4Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 10.2, 17.2, 'BirkeHoch4Dick'),
  def('BirkeDicht4Dick', F.TREE_BASE | F.PERSISTENT, 'sapling_birch', 11.6, 15.7, 'BirkeDicht4Dick'),

  // ── Felsen ───────────────────────────────────────────────────────
  // Aus tools/felsen-generieren.py: verformte Ikosphären, 80 Dreiecke je
  // Stück, Textur aus tools/felsen-texturen.py (Granit, Basalt,
  // Sandstein — alle gerechnet, nichts aus Valheim).
  //
  // KEIN TREE_BASE und kein DESTRUCTIBLE: Beide stehen in COLLIDING_FLAGS
  // (EntityManager.ts:115). Ein Fels SOLL zwar aufhalten — aber der
  // Kollider käme aus der Bounding Box, und ein Findling ist schräg und
  // unregelmässig; man bliebe zwei Meter davor hängen. Physics.ts:88
  // beschreibt genau diesen Fall für Rock_4. Solange die exakte
  // Mesh-Kollision nicht greift, ist Durchlaufen das kleinere Übel.
  //
  // Die Höhe ist die SICHTBARE über Grund — jeder Fels steckt zu einem
  // Fünftel bis Drittel im Boden, sonst wirkt er hingelegt statt
  // gewachsen.
  def('Findling1', F.PERSISTENT, 'stone', 1.4, 0.7, 'Findling1'),
  def('Findling2', F.PERSISTENT, 'stone', 2.7, 1.5, 'Findling2'),
  def('Findling3', F.PERSISTENT, 'stone', 5.2, 2.6, 'Findling3'),
  def('Findling4', F.PERSISTENT, 'stone', 8.4, 4.1, 'Findling4'),
  def('Felsblock1', F.PERSISTENT, 'stone', 1.2, 0.9, 'Felsblock1'),
  def('Felsblock2', F.PERSISTENT, 'stone', 2.5, 1.8, 'Felsblock2'),
  def('Felsblock3', F.PERSISTENT, 'stone', 4.5, 3.1, 'Felsblock3'),
  def('Felsnadel1', F.PERSISTENT, 'stone', 1.4, 2.7, 'Felsnadel1'),
  def('Felsnadel2', F.PERSISTENT, 'stone', 2.5, 4.7, 'Felsnadel2'),
  def('Felsplatte1', F.PERSISTENT, 'stone', 2.1, 0.5, 'Felsplatte1'),
  def('Felsplatte2', F.PERSISTENT, 'stone', 4.4, 1.0, 'Felsplatte2'),
  def('Felsplatte3', F.PERSISTENT, 'stone', 7.4, 1.7, 'Felsplatte3'),
  def('Steinbank1', F.PERSISTENT, 'stone', 2.6, 1.2, 'Steinbank1'),
  def('Steinbank2', F.PERSISTENT, 'stone', 5.1, 2.2, 'Steinbank2'),

  // ── Gebüsch ──────────────────────────────────────────────────────
  // Fünf Straucharten aus tools/busch-generieren.py, je drei Größen.
  // Wie die Eiche vollständig OHNE Valheim-Material: Laubkarte und Rinde
  // zeichnet tools/busch-texturen.py, das Rezept steht in
  // tools/buesche-bauen.sh.
  //
  // KEIN TREE_BASE, und das ist der wichtigste Unterschied zu allem
  // darüber: Das Flag steht in COLLIDING_FLAGS (EntityManager.ts:115)
  // und würde jedem Busch einen Kollider geben. Durch Gebüsch läuft man
  // hindurch — ein 3,8 m breiter Holunder als Mauer wäre im Wald
  // schlimmer als gar kein Busch. Es macht Sträucher außerdem fällbar
  // und lässt die Minimap sie als Baum zeichnen (Minimap.ts:224).
  //
  // Der Wind greift trotzdem: `swaysInWind` (AssetManager.ts:818) ist
  // ein Ausschlussfilter über den Modellnamen, und die deutschen
  // Artnamen stehen nicht darin. Das Laub ist Cutout, also schwingt es
  // wie bei den Bäumen — nur das Holz bleibt starr.
  //
  // Alle Maße sind GEMESSEN, nicht bestellt: Die Höhe trifft die
  // Bestellung des Rezepts genau (das Skript korrigiert sie über zwei
  // Messläufe), die Breite ergibt sich aus der Trieb-Neigung und ist der
  // eigentliche Artcharakter.
  //
  // Die Breite ist die GRÖSSERE der beiden Grundflächenachsen, so wie
  // busch-generieren.py sie druckt. `tools/glb-bbox.js` meldet nur die
  // x-Ausdehnung und liegt deshalb bei manchen Modellen ein paar
  // Zentimeter darunter — hier steht bewusst die weitere Hülle.
  //
  // Hasel: aufrechter Trichter aus Ruten, die unten frei bleiben —
  // Stockausschlag-Vielstämmer ohne Stamm. Mit 3 m der höchste Strauch.
  def('Hasel1', F.PERSISTENT, 'sapling_beech', 1.9, 1.4, 'Hasel1'),
  def('Hasel2', F.PERSISTENT, 'sapling_beech', 2.9, 2.2, 'Hasel2'),
  def('Hasel3', F.PERSISTENT, 'sapling_beech', 4.0, 3.0, 'Hasel3'),
  // Wacholder: gedrungenes Polster, gut ein Drittel breiter als hoch.
  // Die einzige Nadelart im Gebüsch, blaugrün — sie hebt sich im
  // Unterholz von allem anderen ab.
  def('Wacholder1', F.PERSISTENT, 'sapling_fir', 1.0, 0.7, 'Wacholder1'),
  def('Wacholder2', F.PERSISTENT, 'sapling_fir', 1.6, 1.2, 'Wacholder2'),
  def('Wacholder3', F.PERSISTENT, 'sapling_fir', 2.6, 1.8, 'Wacholder3'),
  // Weide: schlanke Ruten, steil gestellt und unten frei — der am
  // wenigsten ausladende der großen Sträucher. Gehört ans Wasser.
  def('Weide1', F.PERSISTENT, 'sapling_birch', 1.5, 1.2, 'Weide1'),
  def('Weide2', F.PERSISTENT, 'sapling_birch', 2.2, 2.0, 'Weide2'),
  def('Weide3', F.PERSISTENT, 'sapling_birch', 3.4, 2.8, 'Weide3'),
  // Holunder: die einzige Art mit STAMM — ein kurzer kräftiger Trieb
  // trägt die Krone, die erst auf gut halber Höhe ansetzt. Seine Früchte
  // sitzen als DOLDE am Triebende; Schlehe und Heidelbeere weiter unten
  // tragen ihre einzeln in den Blattachseln.
  def('Holunder1', F.PERSISTENT, 'blueberries', 1.9, 1.6, 'Holunder1'),
  def('Holunder2', F.PERSISTENT, 'blueberries', 2.6, 2.4, 'Holunder2'),
  def('Holunder3', F.PERSISTENT, 'blueberries', 3.9, 3.2, 'Holunder3'),
  // Brombeere: kniehohes Dickicht aus überhängenden Ranken, gut doppelt
  // so breit wie hoch. Deckt Boden, ohne Sicht zu nehmen.
  def('Brombeere1', F.PERSISTENT, 'raspberry', 1.4, 0.6, 'Brombeere1'),
  def('Brombeere2', F.PERSISTENT, 'raspberry', 1.6, 0.9, 'Brombeere2'),
  def('Brombeere3', F.PERSISTENT, 'raspberry', 1.8, 1.3, 'Brombeere3'),

  // Zweite Staffel. Sie bringt drei Dinge, die dem ersten Satz fehlten:
  // BLÜTEN (Heidekraut violett, Ginster gelb — bis hierher war das
  // Gebüsch durchgehend grün), ZWERGSTRÄUCHER unter einem halben Meter
  // für den Waldboden, und mit dem Hartriegel die einzige rote Rinde.
  //
  // Heidekraut: kniehohes Polster der offenen Heide. Der kleinste
  // Bewuchs des Projekts — Heidekraut1 misst 35 × 26 cm.
  def('Heidekraut1', F.PERSISTENT, 'raspberry', 0.4, 0.3, 'Heidekraut1'),
  def('Heidekraut2', F.PERSISTENT, 'raspberry', 0.6, 0.4, 'Heidekraut2'),
  def('Heidekraut3', F.PERSISTENT, 'raspberry', 0.7, 0.6, 'Heidekraut3'),
  // Ginster: aufrechte Rutenbüschel, im Sommer leuchtend gelb. Der
  // steilste Wuchs im Satz — so breit wie hoch, wie ein Besen.
  def('Ginster1', F.PERSISTENT, 'sapling_birch', 0.8, 0.8, 'Ginster1'),
  def('Ginster2', F.PERSISTENT, 'sapling_birch', 1.5, 1.4, 'Ginster2'),
  def('Ginster3', F.PERSISTENT, 'sapling_birch', 2.4, 2.0, 'Ginster3'),
  // Schlehe: sparriges Dorndickicht mit blau bereiften Früchten. Wächst
  // aus Wurzelausläufern, deshalb ohne Stamm und mit weit
  // auseinanderstehenden Trieben.
  def('Schlehe1', F.PERSISTENT, 'blueberries', 2.2, 1.6, 'Schlehe1'),
  def('Schlehe2', F.PERSISTENT, 'blueberries', 2.8, 2.4, 'Schlehe2'),
  def('Schlehe3', F.PERSISTENT, 'blueberries', 4.1, 3.0, 'Schlehe3'),
  // Hartriegel: aufrechte Ruten mit blutroter Rinde. Damit man sie
  // sieht, bleiben die Triebe unten frei — der einzige Farbakzent, der
  // nicht am Laub hängt.
  def('Hartriegel1', F.PERSISTENT, 'sapling_beech', 2.1, 1.4, 'Hartriegel1'),
  def('Hartriegel2', F.PERSISTENT, 'sapling_beech', 2.8, 2.2, 'Hartriegel2'),
  def('Hartriegel3', F.PERSISTENT, 'sapling_beech', 4.1, 3.0, 'Hartriegel3'),
  // Heidelbeere: der Zwergstrauch des Nadelwaldbodens, grüne Triebe und
  // blaue Beeren. Gehört unter die Fichten.
  def('Heidelbeere1', F.PERSISTENT, 'blueberries', 0.3, 0.3, 'Heidelbeere1'),
  def('Heidelbeere2', F.PERSISTENT, 'blueberries', 0.7, 0.4, 'Heidelbeere2'),
  def('Heidelbeere3', F.PERSISTENT, 'blueberries', 0.7, 0.6, 'Heidelbeere3'),

  // ── Blumen und Unkraut ───────────────────────────────────────────
  // Bodenbewuchs aus tools/blumen-generieren.py, Karten aus
  // tools/blumen-texturen.py. Rezept: tools/blumen-bauen.sh.
  //
  // Anders gebaut als alles darüber: KEINE Sapling-Geometrie, sondern
  // reine Kartenbündel — je Pflanze ein Viereck. Ein Horst kostet 18 bis
  // 40 Dreiecke, ein Fünfzigstel eines Busches. Das ist die Bedingung
  // dafür, dass davon Hunderte in der Welt stehen können.
  //
  // Jeder Eintrag ist ein HORST, keine Einzelpflanze: 9 bis 20 Karten
  // auf einem Streukreis. Eine einzelne Blume zu setzen wäre im Editor
  // nicht zu bedienen, und im Bild läse sie sich als schwebender Strich.
  //
  // Zwei Größen je Art statt drei wie beim Gebüsch. Unter einem Meter
  // trägt die dritte Stufe nichts mehr bei — zwischen 35 und 55 cm sieht
  // man den Unterschied, zwischen 35 und 45 nicht.
  //
  // Die Höhe ist die der PFLANZE, nicht die des Vierecks: Das Skript
  // misst aus dem Alphakanal, wie weit die Karte gefüllt ist, und
  // rechnet das heraus.
  //
  // Blumen — die ersten farbigen Pflanzen des Projekts.
  def('Glockenblume1', F.PERSISTENT, 'dandelion', 0.7, 0.3, 'Glockenblume1'),
  def('Glockenblume2', F.PERSISTENT, 'dandelion', 1.2, 0.5, 'Glockenblume2'),
  def('Margerite1', F.PERSISTENT, 'dandelion', 0.8, 0.4, 'Margerite1'),
  def('Margerite2', F.PERSISTENT, 'dandelion', 1.2, 0.6, 'Margerite2'),
  def('Trollblume1', F.PERSISTENT, 'dandelion', 0.6, 0.3, 'Trollblume1'),
  def('Trollblume2', F.PERSISTENT, 'dandelion', 1.1, 0.5, 'Trollblume2'),
  def('Schafgarbe1', F.PERSISTENT, 'dandelion', 0.9, 0.4, 'Schafgarbe1'),
  def('Schafgarbe2', F.PERSISTENT, 'dandelion', 1.4, 0.6, 'Schafgarbe2'),
  // Wollgras gehört ins Moor und an Seeufer — die weißen Fruchtschöpfe
  // sind auf Entfernung das Kennzeichen nasser Böden.
  def('Wollgras1', F.PERSISTENT, 'barley', 0.6, 0.3, 'Wollgras1'),
  def('Wollgras2', F.PERSISTENT, 'barley', 0.8, 0.5, 'Wollgras2'),
  // Zwei Nachzügler vom 17.08.2026, die die Reihe nach OBEN verlängern:
  // Wollgras4 ist mit 1,00 m Modellhöhe mehr als doppelt so hoch wie
  // Wollgras1 (0,40 m). Genau darum geht es — eine Fläche aus vier
  // Höhenstufen liest sich als Bewuchs, eine aus zwei als Muster.
  def('Wollgras3', F.PERSISTENT, 'barley', 0.9, 0.5, 'Wollgras3'),
  def('Wollgras4', F.PERSISTENT, 'barley', 1.4, 0.8, 'Wollgras4'),
  // Unkraut — dichter, höher, ohne Farbe außer bei Distel und Ampfer.
  def('Brennnessel1', F.PERSISTENT, 'flax', 1.1, 0.6, 'Brennnessel1'),
  def('Brennnessel2', F.PERSISTENT, 'flax', 1.9, 1.0, 'Brennnessel2'),
  def('Distel1', F.PERSISTENT, 'flax', 0.8, 0.6, 'Distel1'),
  def('Distel2', F.PERSISTENT, 'flax', 1.5, 1.1, 'Distel2'),
  def('Ampfer1', F.PERSISTENT, 'flax', 0.7, 0.5, 'Ampfer1'),
  def('Ampfer2', F.PERSISTENT, 'flax', 1.5, 0.9, 'Ampfer2'),
  def('Farn1', F.PERSISTENT, 'flax', 0.7, 0.4, 'Farn1'),
  def('Farn2', F.PERSISTENT, 'flax', 1.1, 0.7, 'Farn2'),
  def('Seggen1', F.PERSISTENT, 'barley', 0.7, 0.4, 'Seggen1'),
  def('Seggen2', F.PERSISTENT, 'barley', 1.1, 0.6, 'Seggen2'),
  // Und einer nach UNTEN: 0,26 m, die kurze Stufe unter Seggen1 (0,39 m).
  // Sie füllt den Boden zwischen den höheren Horsten, statt ihn frei zu
  // lassen — dort sah die Fläche bisher am gleichförmigsten aus.
  def('Seggen3', F.PERSISTENT, 'barley', 0.5, 0.3, 'Seggen3'),

  // Grabhügel — erstes prozedurales BAUWERK des Projekts
  // (tools/grabhuegel-bauen.py), Texturen aus tools/grabhuegel-texturen.py.
  // Kein TREE_BASE: nicht fällbar, kein Wind, wie beim Steinkreis.
  //
  // Der Nullpunkt liegt auf dem KAMMERBODEN, nicht am Hügelfuß. Das ist
  // Absicht und der ganze Trick am Startpunkt: Der Weltspawn setzt den
  // Spieler auf Geländehöhe (WovServer.weltSpawn), und weil der Kammerboden
  // genau dort liegt und der Hügel darüber aufgeschüttet ist, steht man nach
  // dem Einloggen IN der Grabkammer. Ein Dungeon-Innenraum könnte das nicht:
  // Positionen im Dungeon-Band verwirft der Login (WovServer.ts:778-798).
  //
  // Braucht exakte Mesh-Kollision — siehe BEGEHBAR in EntityManager.ts.
  // Maße gemessen: 42,6 × 12,2 × 29,3 m, 37.331 Dreiecke, 17 MB. Deutlich
  // schwerer als der Steinkreis (11.362), weil vier Tripo-Elemente samt
  // ihren eingebetteten 1024er-Texturen eingestempelt sind (Menhire im
  // Kranz, Runenstein, zwei Truhen, zwei Drachenköpfe) — vertretbar für
  // DAS zentrale Einzelbauwerk der Welt, kein Muster für Streugut.
  // Farbige Details (bemalte Schilde, Segelbahnen, Runenreliefs) kommen
  // aus grab_schild/grab_segel/grab_stein_runen.png (prozedural).
  // Die Kuppel trägt die ECHTE Meadows-Bodenkachel (Ebene 0 aus
  // terrain_d_array.png), damit der Hügel nahtlos auf der Wiese sitzt.
  //
  // Das Licht sitzt IM Hügel: Der Innenraum ist rundum geschlossen, ohne
  // eigene Quelle steht man im Stockdunkeln. offsetY zählt vom Nullpunkt,
  // also vom Kammerboden. Flackernd, weil in der Kammer zwei steinerne
  // Feuerschalen stehen.
  //
  // Die Reichweite ist BEWUSST kleiner als die Kammer lang ist: Der
  // LightPool baut schattenlose PointLights, Wände halten das Licht also
  // nicht auf — mit range 30 leuchtete die Kammerlampe durch die Kuppel
  // hindurch den Steinkranz (14,1 m) und das Portal (20 m) an. 12,5 m
  // bleibt unter dem nächsten Außenstein; die Kammerenden fallen dafür
  // ins Dunkel, was einer Grabkammer gut ansteht.
  { ...def('Grabhuegel', F.PERSISTENT, 'guardstone', 42.6, 12.2, 'Grabhuegel'),
    light: { color: [1.0, 0.58, 0.26], intensity: 30, range: 12.5, offsetY: 2.5, flicker: true } },
  // Zweite Ausführung DESSELBEN Bauwerks, nur bewachsen: HuegelGras.ts
  // streut Wiesenhalme auf die Kuppel, aber nur bei diesem Prefab. So
  // stehen im Spawn-Editor beide zur Wahl — kahl aufgeschüttet oder
  // eingewachsen — ohne dass eine zweite GLB nötig wäre (MODELL_ALIAS im
  // AssetManager löst den Namen auf dieselbe Datei auf).
  //
  // Eigener Eintrag statt eines Schalters, weil Bewuchs am ZDO hängen
  // müsste, um pro Instanz umschaltbar zu sein — dafür gibt es kein Feld.
  //
  // Kollision, Licht und Gras-Aussparung erben über den Namenspräfix:
  // BEGEHBAR (EntityManager) und INNENRAUM_OHNE_GRAS (main.ts) prüfen
  // beide auf /^Grabhuegel/.
  { ...def('GrabhuegelGras', F.PERSISTENT, 'guardstone', 42.6, 12.2, 'GrabhuegelGras'),
    light: { color: [1.0, 0.58, 0.26], intensity: 30, range: 12.5, offsetY: 2.5, flicker: true } },
  // Tripo-Einzelelemente des Grabhügels (tools/tripo-generate.mjs, Werte
  // vom Generator gemessen) — auch einzeln platzierbar: Menhir und
  // Runenstein tragen die Steinkreis-Optik (bemooster Granit, Runen).
  { ...def('GrabMenhir', F.PERSISTENT, 'guardstone', 1.0, 2.6, 'GrabMenhir'),
    localScale: { x: 2.6, y: 2.6, z: 2.6 } },
  { ...def('GrabRunenstein', F.PERSISTENT, 'guardstone', 0.8, 3.4, 'GrabRunenstein'),
    localScale: { x: 3.4, y: 3.4, z: 3.4 } },
  { ...def('GrabTruhe', F.PERSISTENT, 'cryptkey', 0.9, 0.9, 'GrabTruhe'),
    localScale: { x: 1.25, y: 1.25, z: 1.25 } },
  { ...def('GrabDrachenkopf', F.PERSISTENT, 'guardstone', 0.5, 1.6, 'GrabDrachenkopf'),
    localScale: { x: 1.6, y: 1.6, z: 1.6 } },
  // Zweiter Baumversuch mit v3.1 und 15.000 face_limit (KiPine2 lief noch auf
  // v2.5). Die Textur ist deutlich besser — Farben stimmen, Rinde stellenweise
  // erkennbar —, bleibt aber ein Flickenteppich: Anders als beim Steinkreis
  // zerfällt die UV-Karte eines Baumes in hunderte kleine Ast-Inseln, auf denen
  // kein zusammenhängendes Muster entsteht. Zum Vergleichen beide behalten.
  { ...def('KiPine3', F.TREE_BASE | F.PERSISTENT, 'sapling_pine', 7.4, 12.0, 'KiPine3'),
    localScale: { x: 12, y: 12, z: 12 } },
  // Wikinger-Statue (Tripo v3.1, 8.843 Dreiecke), angelehnt an GuardStone_Oden:
  // bärtiger Krieger mit gehörntem Helm und Runen auf der Brust. Bewusst NICHT
  // in Blender gebaut — prozedurales Skripting trägt Steinplatten und Säulen,
  // aber keine Figur mit Gesicht und Gewand. Kollision bleibt die abgeleitete
  // Box: Man soll um eine Statue herumgehen, nicht hindurch.
  { ...def('WikingerStatue', F.PERSISTENT, 'portal_stone', 1.3, 2.6, 'WikingerStatue'),
    localScale: { x: 2.6, y: 2.6, z: 2.6 } },
  // Steinkreis (Tripo v3.1, 11.362 Dreiecke). Kein TREE_BASE — das Ding ist
  // ein Bauwerk, kein Gewächs: nicht fällbar, kein Wind. Die Kollision läuft
  // über BEGEHBAR in EntityManager.ts, sonst stünde eine Box im Durchgang.
  //
  // Am 06.08.2026 ausgebaut, am 16.08.2026 auf Mikes Wunsch wieder
  // aufgenommen. Die Registrierung lief immer nur über diesen Hint — es
  // gibt kein pkg-Gegenstück, das Modell ist Eigenbau. Damit funktionieren
  // auch die drei Platzierungen wieder, die im Weltdokument stehen
  // geblieben waren und die der Server seither als 'unbekanntes Prefab'
  // übersprungen hat.
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

  // Völva — Seherin der nordischen Sagen, gedacht als Auftraggeberin
  // (Tripo v3.1, 11.443 Dreiecke). Dieselben Flags wie NPC_1: kein *_AI,
  // damit das Spawn-System sie weder verwaltet noch despawnt, aber
  // SYNCED_TRANSFORM, falls sie später gehen oder sich zuwenden soll.
  //
  // Geriggt und animiert mit `tools/voelva-rig.py`: 12 handgesetzte Knochen,
  // Gewichte als stetige Funktion der Position. Blenders "Automatic Weights"
  // scheidet aus — das Mesh zerfällt in 258 Zusammenhangskomponenten (Tripo
  // trennt an jeder UV-Naht), und Bone Heat rät dann je Insel und reisst sie
  // auf. Die GLB trägt die Gruppen `idle` und `walk`.
  //
  // `animation: 'idle'` ist nur der ANFANGSZUSTAND. Läuft die Figur eine
  // Route, schaltet der Server über den ZDO-Member `anim` auf `walk` und
  // zurück (s. RoutenLaeufer und AssetManager.wechsleAnimation).
  { ...def('Voelva', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 0.8, 1.8, 'Voelva'),
    localScale: { x: 1.75, y: 1.75, z: 1.75 }, animation: 'idle' },

  // Furloc-Fischer — krötenartiges Fischervolk mit Dreizack, Reusenkorb und
  // Strohhut (Meshy-Modell, 10.374 Dreiecke). Die gelieferte GLB hatte
  // 4096²-Texturen und 43 MB; auf 1024² heruntergerechnet sind es 3,6 MB
  // (tools/glb-textur-verkleinern.py).
  //
  // GEMESSEN am gelieferten Modell: Körper (Sohle bis Hutkrempe) 1,432
  // Einheiten, der Dreizack ragt oben UND unten darüber hinaus (1,548) —
  // sein Schaftende ist der tiefste Punkt der ganzen Datei. Die Höhe hier
  // ist deshalb die Gesamthöhe inklusive Dreizack; für das Namensschild
  // zählt sie richtig, denn der Dreizack steht wirklich so hoch.
  //
  // Die Fraktion `furlocs` und die Rolle stehen in shared/src/npc.ts,
  // nicht hier — dort liegt das NPC-Datenmodell.
  { ...def('FurlocFischer', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 2.0, 1.65, 'FurlocFischer'),
    localScale: { x: 1.05, y: 1.05, z: 1.05 }, animation: 'idle' },

  // ── Das übrige Furloc-Volk ─────────────────────────────────────────
  // Fünf weitere Figuren derselben Meshy-Reihe, geriggt mit
  // tools/furloc-volk-rig.py (vier Gelenke je Bein, Gewichte als stetige
  // Funktion der Position, Aktionen `idle`, `walk`, `attack`). Alle fünf
  // kamen mit 4096²-Texturen und 35 bis 40 MB an; auf 1024²
  // heruntergerechnet sind es gut drei (tools/glb-textur-verkleinern.py).
  // Ohne diesen Schritt lädt der Client sich tot — dieselbe Erfahrung wie
  // bei der Völva.
  //
  // Die Höhe hier ist die GESAMTHÖHE über der Sohle, also einschliesslich
  // Speer, Stab und Hörnern. Für das Namensschild zählt sie richtig, denn
  // so hoch steht die Figur wirklich; die reine Körperhöhe steht jeweils
  // daneben, weil `localScale` aus ihr folgt.
  //
  // Die Breite ist die Körperbreite OHNE die Arme: Meshy liefert alle
  // fünf in einer T-Pose mit waagerecht ausgestreckten Armen, und die ist
  // eine Bindepose — in jeder der drei Animationen hängt der freie Arm
  // unten.
  //
  // Fraktion und Rolle stehen in shared/src/npc.ts, nicht hier.

  // Krieger mit Speer und Schildkrötenpanzer-Schild (10.151 Dreiecke,
  // fertige GLB 4,2 MB). Als einziger der fünf trägt er ein HANDGERIGGTES
  // Rigify-Skelett (160 DEF-Knochen samt Gesicht und Fingern) statt der
  // Eigenbau-Kette aus tools/furloc-volk-rig.py; gebaut wird er mit
  // tools/furloc-krieger-rigify.py aus assets/upload/furloc_krieger.glb.
  // Die ursprüngliche handgebaute Fassung liegt als
  // FurlocKrieger-handrig.glb daneben.
  //
  // Sein `localScale` weicht von den vier Verwandten ab, obwohl die Figur
  // gleich groß bleibt: Die Upload-Datei trägt dieselbe Geometrie um den
  // Faktor 1,403 größer (Körper 1,796 statt 1,280 Einheiten). 1,796 ×
  // 0,999 sind wieder die 1,79 m von vorher — er überragt den Fischer um
  // gut zehn Zentimeter, was ihm als Kämpfer zusteht.
  //
  // Die Höhe ist die an der VERFORMTEN Haut gemessene, nicht die
  // Speerspitze der Ruhepose (1,88 m): Er trägt den Speer in allen drei
  // Clips geneigt, und gemessen steht er im Leerlauf 1,79 m, im Gehen
  // 1,80 m und im Angriff 1,82 m hoch.
  { ...def('FurlocKrieger', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 2.2, 1.80, 'FurlocKrieger'),
    localScale: { x: 0.999, y: 0.999, z: 0.999 }, animation: 'idle' },

  // Häuptling mit Hörnerhelm, Fellumhang und knorrigem Stab (10.119
  // Dreiecke, fertige GLB 3,3 MB). Körper 1,193 Einheiten, mal 1,47 sind
  // das 1,75 m; er ist der Breiteste der fünf. Sein Umhangsaum hängt einen
  // Zentimeter tiefer als seine Sohle und streift deshalb das Gelände —
  // gewollt, denn die Alternative wäre eine schwebende Figur.
  { ...def('FurlocHaeuptling', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 2.2, 1.79,
      'FurlocHaeuptling'),
    localScale: { x: 1.47, y: 1.47, z: 1.47 }, animation: 'idle' },

  // Schamane mit Blattkapuze und Stab mit leuchtendem Stein (10.175
  // Dreiecke, fertige GLB 3,7 MB). Körper 1,214 Einheiten, mal 1,34 sind
  // das 1,63 m. Der Stab überragt ihn deutlich: 1,82 m.
  { ...def('FurlocSchamane', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 2.1, 1.82,
      'FurlocSchamane'),
    localScale: { x: 1.34, y: 1.34, z: 1.34 }, animation: 'idle' },

  // Ältester, gebeugt unter einem bodenlangen Umhang, mit Tierschädelstab
  // (10.038 Dreiecke, fertige GLB 3,6 MB). Körper 1,344 Einheiten, mal
  // 1,19 sind das 1,60 m — kleiner als die Jüngeren, weil er gebeugt
  // steht. Auch sein Saum streift das Gelände.
  { ...def('FurlocAeltester', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 2.1, 1.67,
      'FurlocAeltester'),
    localScale: { x: 1.19, y: 1.19, z: 1.19 }, animation: 'idle' },

  // Kind mit viel zu grossem Hörnerhelm und Holzschwert (9.930 Dreiecke,
  // fertige GLB 3,4 MB). Hier ist die Gesamthöhe zugleich die Körperhöhe,
  // denn der Helm IST der höchste Punkt: 1,774 Einheiten mal 0,59 sind
  // 1,05 m. Das ist bewusst klein — es soll neben dem Häuptling als Kind
  // erkennbar sein und nicht als kleiner Erwachsener.
  { ...def('FurlocKind', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 1.0, 1.05, 'FurlocKind'),
    localScale: { x: 0.59, y: 0.59, z: 0.59 }, animation: 'idle' },

  // Basis-Spielerkörper — der nackte Wikinger, auf dem Charaktererstellung
  // und Rüstung aufsetzen (Tripo v3.1, 9.730 Dreiecke, Texturen auf 1024²).
  // Geriggt mit tools/spieler-rig.py.
  //
  // Die 24 Knochen tragen TRIPOS AUTO-RIG-NAMEN (Hip, Spine01, R_Hand …)
  // und nicht die deutschen Namen der übrigen Rigs. Das ist Absicht:
  // client/src/player/AvatarRig.ts sucht seine Knochen über genau diese
  // Namen, und tools/mixamo-to-avatar.mjs bildet 22 Mixamo-Knochen darauf
  // ab. Ein Rig mit eigenen Namen wäre für den Spieler unbrauchbar — die
  // Figur bliebe in der Bindepose stehen.
  //
  // Die GLB trägt vier Gruppen: idle, gehen, rennen, angriff. `gehen` und
  // `rennen` enthalten WURZELBEWEGUNG — AvatarRig misst sie, entfernt sie
  // und normiert damit `speedRatio` gegen das Fussrutschen. Der dynamische
  // Pfad des EntityManagers entfernt sie NICHT. Deshalb hier
  // `animation: 'idle'` und keine Route: Als Routen-NPC liefe die Figur je
  // Zyklus 1,33 m aus ihrer eigenen Position heraus und spränge zurück.
  //
  // localScale ist GEMESSEN, nicht gewählt: Das Modell ist 0,9996 Einheiten
  // hoch (Tripo normiert auf Kantenlänge 1), Zielgrösse 1,80 m. Die Sohle
  // liegt auf y = 0. Die Breite 1,1 ist die Armspannweite der A-Pose, nicht
  // die Schulter (0,66) — in der Bindepose stehen die Hände weit ab.
  //
  // ACHTUNG: Dieses Prefab ist zum ANSEHEN da, es löst `PlayerAvatar.glb`
  // noch NICHT ab. Für den Tausch müssen in AvatarRig.ts zwei Konstanten
  // mit: MODELL_HALBHOEHE von 0,495 auf 0 (die alte Datei ist um den
  // Ursprung zentriert, diese steht auf der Sohle) und MODELL_SKALIERUNG
  // von 1,8/0,99 auf 1,8/0,9996. Vorher geändert, schwebt der heutige
  // Spieler 0,90 m über dem Boden.
  { ...def('WikingerBasis', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 1.1, 1.8, 'WikingerBasis'),
    localScale: { x: 1.8007, y: 1.8007, z: 1.8007 }, animation: 'idle' },

  // Surtr — der Feuerriese aus Muspelheim, der bei Ragnarök mit flammendem
  // Schwert die Welt verbrennt (Tripo v3.1, 14.568 Dreiecke, Texturen auf
  // 1024 begrenzt). 9 m hoch, also auf Augenhöhe mit einer ausgewachsenen
  // Tanne und doppelt so hoch wie ein Troll.
  //
  // Die Lavaadern leuchten: tools/glb-glut.py leitet aus der BaseColor eine
  // Emissive-Karte ab (10,6 % der Fläche), GlutPuls lässt sie im Client
  // schwanken.
  //
  // Geriggt und animiert mit `tools/surtr-rig.py`: 17 handgesetzte Knochen
  // (Rumpf, beide Arme, Schwert, beide Beine), Gewichte als stetige
  // Funktion der Position. Es löst das erste Rig aus tools/rig-idle.py ab —
  // dessen vier gestapelte Knochen konnten wiegen, aber nicht gehen und
  // nicht schlagen.
  //
  // Jedes Bein hat VIER Gelenke: Hüfte, Knie, Knöchel und Zehenballen.
  // Mit den ursprünglichen zwei je Bein („Bein" und ein Knochen, der
  // fälschlich „Fuß" hieß, in Wahrheit aber der Unterschenkel war) konnte
  // der Gang gar nicht stimmen: Ohne Sprunggelenk kippt jedes Kniebeugen
  // die ganze Sohle mit, und weil die Beinlänge dann fest ist, muss der
  // Schwungfuß durch den Boden fahren. Gemessen (tools/gang-diagnose.py,
  // auf localScale 9 gerechnet) waren das 15 bis 17 cm Fuß unter dem
  // Gelände, knapp 3 m Rutschweg je Zyklus und eine Standphase von nur
  // 22 bis 28 % statt der 60 %, die einen Gang von einem Sprunglauf
  // unterscheiden.
  //
  // Der Laufzyklus wird nicht mehr aus Winkeln zusammengesetzt, sondern
  // rückwärts gerechnet: Der Bodenpunkt der Sohle wandert im Körperraum
  // mit genau `speed × Zyklusdauer` nach hinten (steht im Weltraum also
  // still), daraus folgt die Knöchellage, daraus lösen sich die
  // Gelenkwinkel. Rutschen ist damit ausgeschlossen, statt nachträglich
  // wegjustiert zu werden.
  //
  // ACHTUNG, gekoppelte Werte: Der Zyklus ist auf ROUTE_DEFAULT_SPEED
  // (1,5 m/s) und localScale 9 gerechnet. Bekommt Surtrs Route je ein
  // eigenes `speed`, muss `tools/surtr-rig.py --tempo <m/s>` neu laufen,
  // sonst rutscht der Fuß wieder. Die Zyklusdauer von 3,4 s ist kein
  // Geschmackswert: Länger reicht das gemessene 3,25-lange Bein nicht
  // mehr an den Boden (es stünde am Ende der Standphase steif
  // durchgestreckt), kürzer schrumpft die Schrittweite unter die 5,10 m,
  // die 1,5 m/s in 3,4 s ergeben. Zum Vergleich schwingt ein 3,78 m
  // langes Bein als physisches Pendel in 3,18 s durch — der Takt liegt
  // also 7 % daneben, die alten 2,6 s lagen 18 % zu schnell.
  //
  // Warum wieder von Hand: Tripos Auto-Rigging war hier zweimal
  // gescheitert (v2.5 zerlegte die Geometrie schon beim Riggen, v1.0
  // riggte sauber, aber das Retargeting von "preset:idle" zerriss sie
  // doch) — die Presets erwarten menschliche Proportionen. Blenders
  // "Automatic Weights" scheidet ebenfalls aus: Das Mesh zerfällt in 170
  // Zusammenhangskomponenten (Tripo trennt an jeder UV-Naht), und Bone
  // Heat rät dann je Insel und reißt sie auf. Gewichte aus der POSITION
  // können das prinzipbedingt nicht.
  //
  // Die GLB trägt die Gruppen `idle` (6,0 s), `walk` (3,4 s) und `attack`
  // (2,6 s). `animation: 'idle'` ist nur der ANFANGSZUSTAND; der Server
  // schaltet über den ZDO-Member `anim` um (s. RoutenLaeufer und
  // AssetManager.wechsleAnimation).
  //
  // ACHTUNG bei `attack`: Der Client startet JEDE Gruppe in Schleife
  // (AssetManager: `gruppe.start(true)`). Ein einmaliger Clip ist dort
  // noch nicht vorgesehen. Der Clip beginnt und endet deshalb in der
  // Ruhehaltung und hat an beiden Enden eine Pause — in Schleife liest er
  // sich als "ausholen, schlagen, ausholen" statt als Zuckung.
  //
  // Er steht auf seiner Sohle: Die Unterkante der Geometrie liegt exakt
  // auf z = 0 des Modells (gemessen in Blender und im laufenden Client:
  // tiefster Vertex 0,000 m über dem Prefab-Ursprung). Ein Höhenversatz
  // gehört hier also nirgends hin — steht er trotzdem in der Luft, liegt
  // es an der Platzierungshöhe, nicht am Modell.
  { ...def('Surtr', F.SYNCED_TRANSFORM | F.PERSISTENT, null, 5.0, 9.0, 'Surtr'),
    localScale: { x: 9, y: 9, z: 9 }, animation: 'idle' },

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

/**
 * Selbst erzeugte Modelle — die Auswahlliste des Spawn-Editors.
 *
 * Die Registry hat 3.748 Einträge mit Modell, und das SpawnPanel zeigt je
 * Kategorie nur die ersten 80. Ohne eigene Kategorie sind selbst gebaute
 * Prefabs dort faktisch nicht auffindbar — man muss ihren Namen bereits
 * kennen und ihn eintippen.
 *
 * Bewusst eine HANDGEPFLEGTE Liste und keine Heuristik: Ob ein Prefab aus
 * dem Valheim-Paket oder aus unseren Werkzeugen stammt, lässt sich am
 * Namen nicht ablesen, und die Alternative (alles, was nur als Hint
 * existiert) fischt Dungeon-Räume und Altlasten mit ein.
 *
 * Neue Modelle aus `tools/tripo-generate.mjs` oder
 * `tools/baum-generieren.py` gehören hier ergänzt.
 *
 * Seit Block A trägt dieselbe Liste eine zweite, schwerere Rolle: Sie ist
 * die WHITELIST der Welt. Was hier nicht steht, gehört nicht ins Spiel —
 * `pruefeLayout` (shared/src/worldlayout/pruefung.ts) meldet jeden
 * Platzierungs- und Kuratierungsnamen, der fehlt. Beides in EINER Liste zu
 * führen ist Absicht: Eine zweite Liste daneben wäre nach dem dritten
 * neuen Modell auseinandergelaufen, und die Frage „zeigt der Editor es an?"
 * hat dieselbe Antwort wie „darf es in der Welt stehen?".
 */
export const EIGENE_MODELLE: readonly string[] = [
  // Wieder aufgenommen 16.08.2026 — siehe HINT_DEFS.
  'Steinkreis',
  'BirkeHoch1',
  'BirkeHoch2',
  'BirkeHoch3',
  'BirkeDicht1',
  'BirkeDicht2',
  'BirkeDicht3',
  'Tanne1',
  'Tanne2',
  'Tanne3',
  'Tanne4',
  'Fichte1',
  'Fichte2',
  'Fichte3',
  'Eiche1',
  'Eiche2',
  'Eiche3',
  'Fichte4',
  'Fichte5',
  'Fichte6',
  'Tanne5',
  'Tanne6',
  'Tanne7',
  'Kiefer1',
  'Kiefer2',
  'Kiefer3',
  'Kiefer4',
  'Eiche4',
  'BirkeHoch4',
  'BirkeDicht4',
  // Die dicken Stammvarianten — siehe HINT_DEFS oben.
  'Fichte1Dick',
  'Fichte2Dick',
  'Fichte3Dick',
  'Tanne1Dick',
  'Tanne2Dick',
  'Tanne3Dick',
  'Tanne4Dick',
  'BirkeHoch1Dick',
  'BirkeHoch2Dick',
  'BirkeHoch3Dick',
  'BirkeDicht1Dick',
  'BirkeDicht2Dick',
  'BirkeDicht3Dick',
  'Eiche1Dick',
  'Eiche2Dick',
  'Eiche3Dick',
  'Fichte4Dick',
  'Fichte5Dick',
  'Tanne5Dick',
  'Tanne6Dick',
  'Kiefer1Dick',
  'Kiefer2Dick',
  'Kiefer3Dick',
  'Eiche4Dick',
  'BirkeHoch4Dick',
  'BirkeDicht4Dick',
  'Findling1',
  'Findling2',
  'Findling3',
  'Findling4',
  'Felsblock1',
  'Felsblock2',
  'Felsblock3',
  'Felsnadel1',
  'Felsnadel2',
  'Felsplatte1',
  'Felsplatte2',
  'Felsplatte3',
  'Steinbank1',
  'Steinbank2',
  'Hasel1',
  'Hasel2',
  'Hasel3',
  'Wacholder1',
  'Wacholder2',
  'Wacholder3',
  'Weide1',
  'Weide2',
  'Weide3',
  'Holunder1',
  'Holunder2',
  'Holunder3',
  'Brombeere1',
  'Brombeere2',
  'Brombeere3',
  'Heidekraut1',
  'Heidekraut2',
  'Heidekraut3',
  'Ginster1',
  'Ginster2',
  'Ginster3',
  'Schlehe1',
  'Schlehe2',
  'Schlehe3',
  'Hartriegel1',
  'Hartriegel2',
  'Hartriegel3',
  'Heidelbeere1',
  'Heidelbeere2',
  'Heidelbeere3',
  'Glockenblume1',
  'Glockenblume2',
  'Margerite1',
  'Margerite2',
  'Trollblume1',
  'Trollblume2',
  'Schafgarbe1',
  'Schafgarbe2',
  'Wollgras1',
  'Wollgras2',
  'Wollgras3',
  'Wollgras4',
  'Brennnessel1',
  'Brennnessel2',
  'Distel1',
  'Distel2',
  'Ampfer1',
  'Ampfer2',
  'Farn1',
  'Farn2',
  'Seggen1',
  'Seggen2',
  'Seggen3',
  'Grabhuegel',
  'GrabhuegelGras',
  'GrabMenhir',
  'GrabRunenstein',
  'GrabTruhe',
  'GrabDrachenkopf',
  'KiPine2',
  'KiPine3',
  'WikingerStatue',
  'Voelva',
  'Surtr',
  'FurlocFischer',
  'FurlocKrieger',
  'FurlocHaeuptling',
  'FurlocSchamane',
  'FurlocAeltester',
  'FurlocKind',
  'WikingerBasis',
  // Beide standen bisher nicht hier, weil die Liste als Auswahlmenü des
  // Spawn-Editors entstand und dort keine Rolle spielten. Als Whitelist
  // gelesen fehlten sie zu Unrecht: Es rendert bei beiden eigene Geometrie.
  //
  // NPC_1 lädt npc_1_walk.glb — das vom Nutzer erstellte Modell, mit dem
  // die eigene Reihe überhaupt anfing (s. HINT_DEFS oben).
  //
  // 'Player' ist der einzige Eintrag der Liste, dessen NAME aus dem
  // Valheim-Paket stammt (er steht in prefabData.json). Das ist kein
  // Widerspruch: Die Whitelist entscheidet über das MODELL, nicht über die
  // Herkunft des Namens. Player.glb ist mesh-los, deshalb zeigt der
  // Render-Hint seit jeher ebenfalls auf npc_1_walk.glb; die eigene Figur
  // des angemeldeten Spielers kommt aus PlayerAvatar.glb (Tripo-Export,
  // client/src/player/AvatarRig.ts) und damit ebenfalls nicht aus dem
  // Export. Es gibt also keinen Blickwinkel, aus dem hier Valheim-Geometrie
  // steht — und den Spieler-Avatar auszuschliessen hiesse, den Spieler
  // unsichtbar zu machen.
  'NPC_1',
  'Player',
];

/**
 * Dieselbe Liste als Menge — `pruefeLayout` fragt sie für JEDE Platzierung
 * und jeden kuratierten Namen einer Welt, und die Reihenfolge des Arrays
 * trägt die Gruppierung im Spawn-Editor, darf also nicht sortiert werden.
 */
export const EIGENE_MODELLE_SET: ReadonlySet<string> = new Set(EIGENE_MODELLE);

/**
 * Ist `name` ein selbst gebautes Prefab?
 *
 * Die LISTE ist die Wahrheit, nicht der Dateibestand unter assets/models —
 * und das ist der Kern von Block A, kein Umsetzungsdetail:
 *
 * Der Server kennt die Platte des Clients nicht. Er entscheidet über
 * Spawns, Layout-Prüfung und Bau-Freigaben, ohne je eine GLB zu öffnen; ein
 * „liegt die Datei da?" ist auf seiner Seite gar nicht beantwortbar. Träte
 * er die Frage an den Client ab, gäben beide Seiten auf dieselbe Frage
 * verschiedene Antworten.
 *
 * Und ein Modell, das nur auf EINEM Container liegt, wäre genau die Drift,
 * die Block A beseitigt: dev und live zeigten unterschiedlich viel, je
 * nachdem, was zuletzt wohin kopiert wurde. Die Liste liegt im Quelltext,
 * geht mit jedem tools/wov-update.sh mit und ist auf beiden Containern
 * dieselbe.
 *
 * Deckungsgleich ist beides ohnehin nicht: GrabhuegelGras hat gar keine
 * eigene GLB (MODELL_ALIAS lädt Grabhuegel.glb), Steinkreis.glb liegt
 * umgekehrt ohne Prefab auf der Platte.
 */
export function istEigenesModell(name: string): boolean {
  return EIGENE_MODELLE_SET.has(name);
}

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
