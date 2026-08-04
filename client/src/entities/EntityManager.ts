/**
 * EntityManager (Phase 2) — maps ZDO updates to the scene.
 *
 * Static ZDOs (trees, rocks, building pieces, …) become THIN INSTANCES in
 * per-prefab buckets (the only sane way to render Valheim's vegetation
 * density — see Docs/03 §4). Dynamic ZDOs (creatures, item drops, ships,
 * other players) become instantiated hierarchies with per-entity
 * transforms. LocationProxy ZDOs carry the feature hash for terrain
 * leveling (Unity TerrainModifier parity) and stay invisible.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import {
  PrefabFlag,
  findPrefabByHash,
  isRenderable,
  getFeatureByHash,
  getRoomByHash,
  getStableHash,
  getTerrainLeveling,
} from '@wov/shared';
import { buildMeshCollider, deriveCollider, StaticColliderSet } from '../engine/Physics';

import type { AssetManager } from '../engine/AssetManager';
import type { TerrainManager } from '../engine/Terrain';
import type { ClientWorld } from '../world/World';
import type { ZDOEntityUpdate } from '../net/ZDOSync';
/**
 * Prefabs, die statt eines Hüllquaders ihre exakte Oberfläche als
 * Kollision bekommen — Findlinge, Erzbrocken, Abbaufelsen.
 *
 * Erfasst die 15 gespawnten Felsklassen: Rock_3/4, Rock_4_plains,
 * rock1..4_* (mountain/heath/coast/forest/copper), rock_mistlands1,
 * MineRock_Tin, MineRock_Obsidian, silvervein.
 */
const FELS_KOLLISION = /^(rock|minerock|silvervein|copperore|tinore|obsidian|stone)/i;
/**
 * Obergrenze für die exakte Fels-Kollision. Die Felsen des Exports liegen
 * bei 196 bis rund 800 Dreiecken; 4000 lässt Luft nach oben, ohne dass
 * ein unerwartet feines Modell die Physik sprengt. Darüber bleibt es beim
 * Hüllquader.
 */
const FELS_MAX_DREIECKE = 4000;

/**
 * Bauwerke, durch die man hindurchgehen können muss.
 *
 * Für sie gilt dasselbe wie für Dungeon-Räume: Ein Hüllquader wäre fatal,
 * weil er den Durchgang massiv macht — beim Steinkreis stünde man vor einer
 * unsichtbaren Wand statt zwischen den Steinen. Deshalb ist die exakte
 * Kollision hier NICHT ans Dreiecksbudget gebunden (der Steinkreis hat
 * 11.362), und wenn sie nicht zustande kommt, bleibt das Prefab lieber ganz
 * ohne Kollision als mit einer Box.
 *
 * Bezahlbar ist das aus demselben Grund wie bei den Felsen: Die Shape wird
 * über alle Instanzen geteilt (StaticColliderSet), pro Instanz entstehen nur
 * Transform und Body.
 */
const BEGEHBAR = /^(Steinkreis)/i;


/** Flags whose ZDOs move on their own (server-side AI / physics). */
const DYNAMIC_FLAGS =
  PrefabFlag.ANIMAL_AI |
  PrefabFlag.MONSTER_AI |
  PrefabFlag.ITEM_DROP |
  PrefabFlag.SHIP |
  PrefabFlag.SYNCED_TRANSFORM;

const f32 = Math.fround;

/**
 * Radius around the player that carries collision bodies, in metres. Small
 * enough that a dense forest stays in the low hundreds of bodies instead of
 * the tens of thousands the view distance holds — building them for
 * everything visible pins the main thread outright.
 */
const COLLIDER_RANGE = 48;
/**
 * Wie viele Prefab-Buckets höchstens pro Frame neu aufgebaut werden.
 *
 * 2 ist bewusst niedrig: Ein Neuaufbau kostet je nach Instanzzahl
 * mehrere Millisekunden, und bei 60 fps steht nur ein Budget von 16,7 ms
 * für alles zur Verfügung. Beim Betreten eines neuen Gebiets dauert das
 * Nachziehen dadurch ein paar Frames länger — sichtbar ist das nicht,
 * ein Ruckler dagegen schon.
 */
const REBUILDS_PER_FRAME = 2;

/** Player travel that triggers a rebuild of the collision window. */
const COLLIDER_REBUILD_STEP = 12;
/**
 * Welche Prefab-KLASSEN den Spieler blockieren.
 *
 * Das ist die eigentliche Regel des Originals: Unity entscheidet über
 * Layer, und Character.cs nimmt genau die soliden davon —
 *   s_groundRayMask = LayerMask.GetMask("Default", "static_solid",
 *       "Default_small", "piece", "terrain", "blocker", "vehicle")
 * (Character.cs:518). Die Layer-Zuordnung je Prefab liegt nicht im Export
 * (die Prefab-Roots fehlen, nur Sub-Meshes wurden extrahiert), also bilden
 * die Flags dieselbe Einteilung ab.
 *
 * Vorher hing die Auswahl an der GEOMETRIE ("alles über 0,5 m"). Genau
 * daher kamen die riesigen Kollisionsboxen um Äste und Deko: Ein liegender
 * Ast ist gross, aber in Valheim läuft man hindurch, weil er auf keinem
 * soliden Layer liegt.
 */
const COLLIDING_FLAGS =
  PrefabFlag.TREE_BASE |      // grosse, fällbare Bäume
  // Kleine Bäume, Stümpfe, Felsen und Klippen tragen in den Originaldaten
  // NICHT TREE_BASE, sondern DESTRUCTIBLE — TREE_BASE ist den fällbaren
  // Bäumen mit Umfall-Animation vorbehalten. Ohne dieses Flag lief man
  // durch Beech_small1/2, FirTree_small und stubbe hindurch.
  PrefabFlag.DESTRUCTIBLE |
  PrefabFlag.TREE_LOG |       // gefällte Stämme
  PrefabFlag.MINE_ROCK_5 |    // abbaubare Felsen
  PrefabFlag.PIECE |          // Bauteile
  PrefabFlag.WEAR_N_TEAR |    // Gebautes mit Abnutzung
  PrefabFlag.DOOR |
  PrefabFlag.BED |
  PrefabFlag.CHAIR |
  PrefabFlag.CONTAINER |
  PrefabFlag.CRAFTING_STATION |
  PrefabFlag.COOKING_STATION |
  PrefabFlag.SMELTER |
  PrefabFlag.FIREPLACE |
  PrefabFlag.ITEM_STAND |
  PrefabFlag.ARMOR_STAND;

/**
 * Klassen, die NIE blockieren, auch wenn sie zufällig eines der obigen
 * Flags mitführen: Aufsammelbares ist im Original ein Trigger, Pflanzen
 * und Item-Drops laufen einem durch.
 */
const NEVER_COLLIDING_FLAGS =
  PrefabFlag.PICKABLE | PrefabFlag.PICKABLE_ITEM | PrefabFlag.ITEM_DROP | PrefabFlag.PLANT;

/**
 * Weiche Vegetation, durch die man läuft, obwohl sie DESTRUCTIBLE ist.
 *
 * Büsche, Sträucher und herumliegende Äste sind zerstörbar, aber kein
 * Hindernis — in Valheim entscheidet darüber der Layer, den unser Export
 * nicht enthält (die Prefab-Roots fehlen). Der Name ist hier der
 * verlässlichste verfügbare Ersatz; er trifft AshlandsBranch1-3, Bush01,
 * RaspberryBush, shrub_2 und Verwandte, während Beech_small, FirTree_small,
 * stubbe und alle Felsen solide bleiben.
 */
const SOFT_VEGETATION = /bush|shrub|branch|berry|seed|shoot|sapling|vines|flower|grass/i;

/** ?showcolliders=1 — zeichnet die Kollisionsformen als Drahtgitter. */
const SHOW_COLLIDERS =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('showcolliders');

interface StaticBucket {
  prefabName: string;
  /** Same value as the map key — the collider derivation needs the def. */
  prefabHash: number;
  /** zdoKey → flat matrix index */
  indexOf: Map<string, number>;
  /** flat f32 matrix buffer (16 per instance), swap-remove on destroy */
  matrices: number[];
  dirty: boolean;
  mastersReady: boolean;
}

/** Minimalform von Vector3 aus den Prefab-Daten. */
interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface DynamicEntity {
  root: TransformNode;
  /** Letztes Server-Ziel — updateDynamics() gleitet pro Frame dorthin. */
  ziel?: { pos: Vector3; rot: Quaternion };
  /**
   * Prozedurale Gangart für Kreaturen OHNE echte Animationsclips — und das
   * sind alle Tiere: sämtliche 1.142 AnimationClips des Exports haben null
   * Kurven (komprimiertes Mecanim wurde nie dekodiert), die Tier-GLBs sind
   * ungeskinnte Starrkörper. Basis (Server-Ziel) und Anzeige (Wippen)
   * liegen getrennt, sonst flösse der Wipp-Offset in die nächste
   * Interpolation ein und die Kreatur schaukelte sich auf.
   */
  gang?: { basisPos: Vector3; basisRot: Quaternion; phase: number; tempo: number };
}

/** Wiederverwendetes Nick-Quaternion des prozeduralen Gangs (kein Alloc pro Frame). */
const GANG_NICK_TMP = new Quaternion();

export class EntityManager {
  private readonly buckets = new Map<number, StaticBucket>();
  private readonly bucketOf = new Map<string, number>();
  private readonly dynamics = new Map<string, DynamicEntity>();
  private readonly appliedLocations = new Set<string>();
  /** Prefab hashes whose render prep is already in flight. */
  private readonly pending = new Set<number>();

  constructor(
    private readonly scene: Scene,
    private readonly world: ClientWorld,
    private readonly assets: AssetManager,
    private readonly terrain: TerrainManager
  ) {}

  /** Stats for the HUD. */
  staticCount = 0;
  dynamicCount = 0;

  /**
   * Alle statischen Instanzen im Umkreis, mit Prefab-Namen.
   *
   * Für das Namens-Overlay (Einstellung "Objektnamen anzeigen"): Anders als
   * colliderPositions() listet das ALLES, was in der Welt steht — auch
   * Deko und Aufsammelbares ohne Kollisionskörper. Genau das braucht man,
   * um ein unbekanntes Objekt zu identifizieren.
   */
  nearbyInstances(x: number, z: number, radius: number): Array<{ prefab: string; x: number; y: number; z: number }> {
    const out: Array<{ prefab: string; x: number; y: number; z: number }> = [];
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        // Translation der row-major-Matrix: Elemente 12/13/14.
        const px = bucket.matrices[i * 16 + 12]!;
        const py = bucket.matrices[i * 16 + 13]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > r2) continue;
        out.push({ prefab: bucket.prefabName, x: px, y: py, z: pz });
      }
    }
    return out;
  }

  /**
   * World positions of the active collision bodies. Diagnosis only — lets a
   * test walk deliberately into one instead of hoping to hit something.
   */
  colliderPositions(): Array<{ prefab: string; x: number; z: number }> {
    const out: Array<{ prefab: string; x: number; z: number }> = [];
    for (const [prefab, e] of this.colliders) {
      const buf = e.carrier.thinInstanceGetWorldMatrices();
      for (const m of buf) out.push({ prefab, x: m.m[12]!, z: m.m[14]! });
    }
    return out;
  }

  /** Active collision bodies and prefabs we could not derive a shape for. */
  get colliderStats(): { bodies: number; havok: number; prefabs: number; ohneForm: number } {
    let bodies = 0;
    let havok = 0;
    for (const e of this.colliders.values()) {
      bodies += e.set.count;
      havok += e.set.bodyInstances;
    }
    return { bodies, havok, prefabs: this.colliders.size, ohneForm: this.colliderless.size };
  }

  applyUpdate(u: ZDOEntityUpdate): void {
    if (u.isOwnPlayer) return; // our own character is the camera (Phase 4: avatar)

    // F4: terrain leveling under locations (Unity TerrainModifier parity)
    if (u.locationFeatureHash !== undefined && !this.appliedLocations.has(u.key)) {
      this.appliedLocations.add(u.key);
      this.applyLocationLeveling(u.locationFeatureHash, u.position);
      return; // LocationProxy itself is invisible (isRenderable false)
    }

    const def = findPrefabByHash(u.prefabHash);
    if (!def || !isRenderable(def)) return;

    const isDynamic = (def.flags & DYNAMIC_FLAGS) !== 0n;
    if (isDynamic) {
      // Tiere/Monster ohne echten Clip bekommen den prozeduralen Gang;
      // Player/NPC bringen Animationsgruppen mit und bleiben davon frei.
      const belebt =
        (def.flags & (PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI)) !== 0n && !def.animation;
      void this.applyDynamic(u, def.name, def.model, def.animation, belebt);
    } else {
      this.applyStatic(u, def.name, def.model);
    }
  }

  removeZDO(key: string): void {
    const bucketHash = this.bucketOf.get(key);
    if (bucketHash !== undefined) {
      const bucket = this.buckets.get(bucketHash);
      const idx = bucket?.indexOf.get(key);
      if (bucket && idx !== undefined) {
        // swap-remove the matrix
        const last = bucket.matrices.length / 16 - 1;
        if (idx !== last) {
          bucket.matrices.copyWithin(idx * 16, last * 16, last * 16 + 16);
          for (const [k, v] of bucket.indexOf) {
            if (v === last) {
              bucket.indexOf.set(k, idx);
              break;
            }
          }
        }
        bucket.matrices.length = last * 16;
        bucket.indexOf.delete(key);
        bucket.dirty = true;
        this.staticCount--;
      }
      this.bucketOf.delete(key);
    }
    const dyn = this.dynamics.get(key);
    if (dyn) {
      dyn.root.dispose(false, true);
      this.dynamics.delete(key);
      this.dynamicCount--;
    }
  }

  /**
   * Geänderte Thin-Instance-Puffer neu aufbauen (einmal pro Frame).
   *
   * ── Warum hier ein Budget steht ──────────────────────────────────
   * Ein Neuaufbau ist teuer: Für jedes Sub-Mesh des Prefabs wird ein
   * frischer Float32Array über ALLE Instanzen angelegt und jede Matrix
   * neu multipliziert, danach laufen die Havok-Körper nach. Ein einziges
   * geändertes ZDO markiert dabei den ganzen Bucket — bei einem Prefab
   * mit hunderten Instanzen also hunderte Multiplikationen wegen eines
   * einzelnen Objekts.
   *
   * Ohne Budget passierte das für alle geänderten Buckets IM SELBEN
   * FRAME, und zwar im Takt der Server-Updates. Gemessen am 2026-07-29
   * im Regen: Der Median lag bei 17,1 ms (also 60 fps), aber 30 % der
   * Frames brauchten über 25 ms — im Abstand von exakt 3–4 Frames, das
   * sind die 20 Hz der Netzwerkschleife. Über 8,7 s gingen so 2013 ms
   * verloren; daraus entstand die gemeldete "43 fps", obwohl das Bild
   * die meiste Zeit mit voller Rate lief.
   *
   * Das Budget macht aus einem grossen Ruckler mehrere unsichtbare
   * kleine. Die Buckets bleiben als geändert markiert und kommen in den
   * Folgeframes dran — es geht nichts verloren, es dauert nur länger.
   */
  flush(): void {
    let budget = REBUILDS_PER_FRAME;
    for (const bucket of this.buckets.values()) {
      if (!bucket.dirty || !bucket.mastersReady) continue;
      if (budget-- <= 0) break;
      bucket.dirty = false;
      this.rebuildBucketInstances(bucket);
    }
  }

  // ── Static (thin instances) ──────────────────────────────────────

  private masterMeshes = new Map<string, import('@babylonjs/core/Meshes/mesh').Mesh[]>();
  private masterLocals = new Map<string, Matrix[]>();
  /** Invisible collision carriers, one per prefab — see rebuildBucketColliders. */
  private readonly colliders = new Map<
    string,
    { carrier: Mesh; set: StaticColliderSet; signature: string }
  >();
  /** Abgeleitete Formen je Prefab — Diagnose. */
  readonly colliderSpecs = new Map<string, unknown>();
  /** Prefabs whose meshes yielded no usable shape — never retried, because
   *  deriveCollider walks every vertex and repeating that stalls frames. */
  private readonly colliderless = new Set<string>();
  /** Set once Havok is up; before that collider building is skipped. */
  private physicsEnabled = false;
  /** Centre of the collision window — see setPlayerPosition. */
  private colliderCenterX = 0;
  private colliderCenterZ = 0;

  /**
   * Ob nahe (x,z) bereits ein Kollisionskörper steht. Ladeprüfung nach dem
   * Instanz-Teleport (Phase G): Der Spieler bleibt eingefroren, bis der
   * Mesh-Collider des Eingangsraums existiert — sonst fällt er durch den
   * noch ladenden Dungeon (GLB-Fetch + Bucket-Aufbau brauchen Sekunden).
   */
  colliderNahe(x: number, z: number, radius: number, nurRaeume = false): boolean {
    for (const [prefabName, e] of this.colliders) {
      // Beim Warten aufs Dungeon zählt nur der RAUM-Collider: eine bereits
      // geladene Fackel/Truhe hätte zwar einen Körper, aber keinen Boden.
      if (nurRaeume && getRoomByHash(getStableHash(prefabName)) === undefined) continue;
      if (e.set.hasBodyNear(x, z, radius)) return true;
    }
    return false;
  }

  /**
   * Nächstes interagierbares Objekt (Pickable/Tür/Truhe) im Umkreis — Ziel
   * der E-Taste. Liefert Prefab-Hash + Position für PacketType.Interact.
   */
  naechstesInteragierbares(
    x: number,
    z: number,
    radius: number
  ): { prefab: string; prefabHash: number; x: number; y: number; z: number } | null {
    const F = PrefabFlag;
    // BED (Schlafplatz), FIREPLACE (Braten) und die Namens-Sonderfälle
    // (Portal-Reise, Eikthyr-Altar) gehören ebenfalls zur E-Zielsuche.
    const wanted =
      F.PICKABLE | F.PICKABLE_ITEM | F.ITEM_DROP | F.DOOR | F.CONTAINER | F.BED | F.FIREPLACE;
    const SONDER = new Set(['portal_wood', 'StatueDeer']);
    let bestD = radius * radius;
    let best: { prefab: string; prefabHash: number; x: number; y: number; z: number } | null = null;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      if (!def || ((def.flags & wanted) === 0n && !SONDER.has(def.name))) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { prefab: def.name, prefabHash: bucket.prefabHash, x: px, y: bucket.matrices[i * 16 + 13]!, z: pz };
        }
      }
    }
    return best;
  }

  /**
   * Alle Lichtquellen-Instanzen im Umkreis (Prefabs mit `PrefabDef.light`)
   * — Futter für den LightPool. Nur statische Buckets; Fackeln/Feuer sind
   * nie dynamisch.
   */
  lichtquellen(
    x: number,
    z: number,
    radius: number
  ): Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> {
    const out: Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> = [];
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      const licht = def?.light;
      if (!licht) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > r2) continue;
        out.push({ x: px, y: bucket.matrices[i * 16 + 13]!, z: pz, licht });
      }
    }
    return out;
  }

  /** Enable collision once initPhysics() resolved; catches existing buckets up. */
  enablePhysics(): void {
    if (this.physicsEnabled) return;
    this.physicsEnabled = true;
    for (const bucket of this.buckets.values()) bucket.dirty = true;
  }

  /**
   * Move the collision window. Throttled by distance: the bodies only need
   * to exist around the player, and rebuilding them every frame is exactly
   * what makes this expensive.
   */
  setPlayerPosition(x: number, z: number): void {
    if (!this.physicsEnabled) return;
    const dx = x - this.colliderCenterX;
    const dz = z - this.colliderCenterZ;
    if (dx * dx + dz * dz < COLLIDER_REBUILD_STEP * COLLIDER_REBUILD_STEP) return;
    this.colliderCenterX = x;
    this.colliderCenterZ = z;
    for (const bucket of this.buckets.values()) bucket.dirty = true;
  }

  /**
   * Mirror a bucket's NEARBY instances onto an invisible collision carrier.
   *
   * The carrier takes the RAW zdo matrices, not the per-master products: the
   * visible masters are one per GLB submesh with their own local offsets,
   * while collision wants a single simple shape at the prefab's origin.
   */
  private rebuildBucketColliders(bucket: StaticBucket, zdoMats: readonly Matrix[]): void {
    if (!this.physicsEnabled) return;
    if (this.colliderless.has(bucket.prefabName)) return;
    // Dungeon-Räume (Phase G) sind IMMER solide — ihre Flags sind 0n, weil
    // sie keine ZNetView-Prefabs sind; das Flag-Gate unten griffe nicht.
    const dungeonRoom = getRoomByHash(bucket.prefabHash) !== undefined;
    // Nur solide Klassen bekommen überhaupt einen Körper — s. COLLIDING_FLAGS.
    if (!dungeonRoom) {
      const def = findPrefabByHash(bucket.prefabHash);
      const flags = def?.flags ?? 0n;
      const solide =
        (flags & COLLIDING_FLAGS) !== 0n &&
        (flags & NEVER_COLLIDING_FLAGS) === 0n &&
        !SOFT_VEGETATION.test(bucket.prefabName);
      if (!solide) {
        this.colliderless.add(bucket.prefabName);
        return;
      }
    }
    const masters = this.masterMeshes.get(bucket.prefabName);
    if (!masters || masters.length === 0) return;

    let entry = this.colliders.get(bucket.prefabName);
    if (!entry) {
      const def = findPrefabByHash(bucket.prefabHash);
      // Trees get a trunk capsule, everything else its bounding box — see
      // deriveCollider() for why a box is wrong around a crown.
      // Dungeon-Räume bekommen die EXAKTE Mesh-Geometrie: eine Box würde
      // das begehbare Innere massiv machen (buildMeshCollider).
      const treeLike = def ? (def.flags & PrefabFlag.TREE_BASE) !== 0n : false;
      // FELSEN bekommen ebenfalls die exakte Oberfläche.
      //
      // Ein Findling ist unregelmässig und liegt schräg im Hang; sein
      // Hüllquader steht als unsichtbare Wand weit davor, und man rennt
      // dagegen, bevor man den Stein überhaupt berührt. Gemeldet als:
      // "Rock_4 hat eine sehr grosse Box, man läuft erstmal gegen eine
      // unsichtbare Wand — es sollte wie Terrain behandelt werden, nur
      // die reine Oberfläche."
      //
      // Bezahlbar ist das, weil die SHAPE zwischen allen Instanzen
      // geteilt wird (siehe StaticColliderSet): Rock_4 hat 196 Dreiecke,
      // rock4_copper 272 — einmal trianguliert, dann tragen alle 84
      // Instanzen dieselbe Form. Nur Transform und Body existieren pro
      // Instanz, und das ist bei der Box nicht anders.
      //
      // Die Obergrenze schützt vor Ausreissern: Was auch immer künftig
      // unter den Namensfilter fällt, darf die Physik nicht sprengen —
      // dann bleibt es bei der Box.
      const felsig = FELS_KOLLISION.test(bucket.prefabName);
      const dreiecke = felsig
        ? masters.reduce((s, m) => s + (m.getTotalIndices() / 3 || 0), 0)
        : 0;
      const begehbar = BEGEHBAR.test(bucket.prefabName);
      const exakt = dungeonRoom || begehbar || (felsig && dreiecke <= FELS_MAX_DREIECKE);
      const locals = this.masterLocals.get(bucket.prefabName) ?? [];
      // `buildMeshCollider` gibt null zurück, wenn keine Geometrie
      // zusammenkommt. Für Felsen ist die Hüllform dann immer noch besser
      // als GAR KEINE Kollision — bei Dungeon-Räumen dagegen wäre eine Box
      // fatal (sie machte das begehbare Innere massiv), dort bleibt es
      // beim bisherigen Verhalten.
      const spec =
        (exakt ? buildMeshCollider(bucket.prefabName, masters, locals, this.scene) : null) ??
        (dungeonRoom || begehbar ? null : deriveCollider(masters, locals, treeLike));
      if (!spec) {
        this.colliderless.add(bucket.prefabName);
        return;
      }
      const carrier = new Mesh(`col_${bucket.prefabName}`, this.scene);
      carrier.isVisible = false;
      carrier.isPickable = false;
      entry = { carrier, set: new StaticColliderSet(carrier, spec, this.scene), signature: '' };
      this.colliders.set(bucket.prefabName, entry);
      this.colliderSpecs.set(bucket.prefabName, spec);
    }

    // Keep only what is close enough to walk into. Translation lives at
    // matrix elements 12/13/14.
    const near: number[] = [];
    const r2 = COLLIDER_RANGE * COLLIDER_RANGE;
    for (let i = 0; i < zdoMats.length; i++) {
      const m = zdoMats[i]!.m;
      const dx = m[12]! - this.colliderCenterX;
      const dz = m[14]! - this.colliderCenterZ;
      if (dx * dx + dz * dz <= r2) near.push(i);
    }
    // Signatur der Auswahl: nur bei echter Änderung neu bauen.
    //
    // sync() verwirft die Havok-Bodies und legt sie neu an. Bei jedem
    // dirty-Bucket auszuführen hiess: Solange ZDO-Updates hereinkamen,
    // wurden die Kollisionskörper laufend zerstört und neu erzeugt — und
    // in genau diesen Lücken lief der Spieler durch Bäume hindurch
    // (gemessen: 0,37 m Abstand zu einem Stamm mit 0,79 m Radius). Das
    // HUD zeigte es als auseinanderlaufende Zähler "36 inst / 84 havok".
    let sig = `${near.length}`;
    for (let k = 0; k < near.length; k++) {
      const m = zdoMats[near[k]!]!.m;
      sig += `|${m[12]!.toFixed(2)},${m[14]!.toFixed(2)}`;
    }
    if (sig === entry.signature) return;
    entry.signature = sig;

    const data = new Float32Array(near.length * 16);
    for (let k = 0; k < near.length; k++) zdoMats[near[k]!]!.toArray(data, k * 16);
    entry.carrier.thinInstanceSetBuffer('matrix', data, 16, false);
    entry.set.sync();
    if (SHOW_COLLIDERS) entry.set.showDebug();
  }

  private applyStatic(u: ZDOEntityUpdate, prefabName: string, model: string | null): void {
    let bucket = this.buckets.get(u.prefabHash);
    if (!bucket) {
      bucket = {
        prefabName,
        prefabHash: u.prefabHash,
        indexOf: new Map(),
        matrices: [],
        dirty: false,
        mastersReady: false,
      };
      this.buckets.set(u.prefabHash, bucket);
      this.prepareMasters(u.prefabHash, prefabName, model);
    }

    const world = composeZdoWorld(u, findPrefabByHash(u.prefabHash)?.localScale);
    if (bucket.indexOf.has(u.key)) {
      const idx = bucket.indexOf.get(u.key)!;
      world.copyToArray(bucket.matrices, idx * 16);
    } else {
      bucket.indexOf.set(u.key, bucket.matrices.length / 16);
      world.toArray(bucket.matrices, bucket.matrices.length);
      this.staticCount++;
    }
    bucket.dirty = true;
  }

  private prepareMasters(prefabHash: number, prefabName: string, model: string | null): void {
    if (this.pending.has(prefabHash)) return;
    this.pending.add(prefabHash);
    if (!model) {
      // no GLB in the export — nothing to instance (sprites come in Phase 5)
      return;
    }
    void this.assets.getMasters(model).then((masters) => {
      const bucket = this.buckets.get(prefabHash);
      if (!bucket || masters.length === 0) return;
      this.masterMeshes.set(prefabName, masters.map((m) => m.mesh));
      this.masterLocals.set(prefabName, masters.map((m) => m.localMatrix));
      bucket.mastersReady = true;
      bucket.dirty = true; // rebuild with instances now
    });
  }

  /**
   * Expand the bucket's persistent zdoWorld store into per-master
   * thin-instance buffers: instance = masterLocal × zdoWorld (row-major).
   */
  private rebuildBucketInstances(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.prefabName);
    const locals = this.masterLocals.get(bucket.prefabName);
    if (!masters || !locals) return;

    const count = bucket.matrices.length / 16;
    const zdoMats = new Array<Matrix>(count);
    for (let i = 0; i < count; i++) {
      zdoMats[i] = Matrix.FromArray(bucket.matrices, i * 16);
    }
    for (let m = 0; m < masters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = locals[m]!;
      for (let i = 0; i < count; i++) {
        local.multiply(zdoMats[i]!).toArray(data, i * 16);
      }
      masters[m]!.thinInstanceSetBuffer('matrix', data, 16, false);
      masters[m]!.setEnabled(count > 0);
    }

    this.rebuildBucketColliders(bucket, zdoMats);
  }

  /**
   * Dynamische Entities pro Frame Richtung Server-Ziel gleiten
   * (exponentielle Annäherung, Halbwertszeit ~60 ms — glättet den
   * 50-ms-Sync-Takt, ohne spürbar nachzuhängen). Im Game-Loop aufrufen.
   */
  /** Diagnose: Prefab-Namen der aktiven dynamischen Entities. */
  dynamicList(): string[] {
    return [...this.dynamics.values()].map((d) => d.root.name || '?');
  }

  /** Diagnose: Pose des ersten Dynamics, dessen Name den Teilstring trägt. */
  dynamicPose(name: string): { pos: Vector3Like; rotX: number; tempo: number } | null {
    for (const d of this.dynamics.values()) {
      if (!(d.root.name || '').includes(name)) continue;
      const p = d.root.position;
      return {
        pos: { x: p.x, y: p.y, z: p.z },
        rotX: d.root.rotationQuaternion ? d.root.rotationQuaternion.toEulerAngles().x : 0,
        tempo: d.gang?.tempo ?? -1,
      };
    }
    return null;
  }

  updateDynamics(dt: number): void {
    const f = 1 - Math.exp(-dt / 0.09);
    for (const dyn of this.dynamics.values()) {
      const z = dyn.ziel;
      if (!z) continue;
      const g = dyn.gang;
      if (!g) {
        Vector3.LerpToRef(dyn.root.position, z.pos, f, dyn.root.position);
        if (dyn.root.rotationQuaternion) {
          Quaternion.SlerpToRef(dyn.root.rotationQuaternion, z.rot, f, dyn.root.rotationQuaternion);
        }
        continue;
      }
      // ── Prozeduraler Gang ─────────────────────────────────────────
      // Die BASIS gleitet zum Server-Ziel; das Tempo kommt aus ihrer
      // eigenen Bewegung, nicht aus den 50-ms-Sprüngen des Ziels.
      const vorherX = g.basisPos.x;
      const vorherZ = g.basisPos.z;
      Vector3.LerpToRef(g.basisPos, z.pos, f, g.basisPos);
      Quaternion.SlerpToRef(g.basisRot, z.rot, f, g.basisRot);
      const schritt = Math.hypot(g.basisPos.x - vorherX, g.basisPos.z - vorherZ);
      const tempoRoh = dt > 0 ? schritt / dt : 0;
      g.tempo += (tempoRoh - g.tempo) * Math.min(1, dt * 6);

      const bewegt = g.tempo > 0.3;
      // Schrittfrequenz wächst mit dem Tempo (Trab → Galopp); im Stand
      // bleibt ein langsames Atmen übrig.
      g.phase += dt * (bewegt ? 1.6 + g.tempo * 0.5 : 0.4) * Math.PI * 2;
      // |sin|: zwei Bodenkontakte pro Periode — das typische Auf-und-Ab
      // eines Vierbeiners statt eines schwebenden Sinus.
      const hub = bewegt
        ? Math.abs(Math.sin(g.phase)) * Math.min(0.05 + g.tempo * 0.02, 0.16)
        : 0;
      const nick = bewegt ? Math.sin(g.phase) * 0.06 : Math.sin(g.phase) * 0.012;
      dyn.root.position.set(g.basisPos.x, g.basisPos.y + hub, g.basisPos.z);
      if (dyn.root.rotationQuaternion) {
        Quaternion.FromEulerAnglesToRef(nick, 0, 0, GANG_NICK_TMP);
        g.basisRot.multiplyToRef(GANG_NICK_TMP, dyn.root.rotationQuaternion);
      }
    }
  }

  // ── Dynamic (instantiated hierarchies) ───────────────────────────

  private async applyDynamic(
    u: ZDOEntityUpdate,
    prefabName: string,
    model: string | null,
    animation?: string,
    belebt = false
  ): Promise<void> {
    let dyn = this.dynamics.get(u.key);
    if (!dyn) {
      let root: TransformNode | null = null;
      if (model) {
        root = await this.assets.instantiate(model, animation);
      }
      if (!root) {
        root = makePlaceholder(this.scene, prefabName);
      }
      if (this.dynamics.has(u.key)) {
        root.dispose(false, true); // lost the race — another update instantiated first
        return;
      }
      // GLB-Wurzeln heissen alle "__root__" — für Diagnose (dynamicList,
      // dynamicPose) den Prefab-Namen drauflegen.
      root.name = prefabName;
      dyn = { root };
      if (belebt) {
        dyn.gang = {
          basisPos: new Vector3(u.position.x, u.position.y, u.position.z),
          basisRot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
          // Phasen leicht streuen, damit eine Herde nicht im Gleichschritt wippt.
          phase: (getStableHash(u.key) & 0xff) * 0.1,
          tempo: 0,
        };
      }
      this.dynamics.set(u.key, dyn);
      this.dynamicCount++;
    }
    // Interpolation statt hartem Setzen: ZDO-Updates kommen im Sync-Takt
    // (50 ms + Netz-Jitter) — direktes Setzen ließe Kreaturen und fremde
    // Spieler ruckeln. Ziel merken, updateDynamics() gleitet pro Frame hin.
    const ziel = {
      pos: new Vector3(u.position.x, u.position.y, u.position.z),
      rot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    };
    if (!dyn.ziel || Vector3.DistanceSquared(dyn.root.position, ziel.pos) > 30 * 30) {
      // Erstes Update oder Teleport (Dungeon, Admin): hart setzen statt
      // quer durch die Welt zu gleiten — auch die Gang-Basis.
      dyn.root.position.copyFrom(ziel.pos);
      dyn.root.rotationQuaternion = ziel.rot.clone();
      if (dyn.gang) {
        dyn.gang.basisPos.copyFrom(ziel.pos);
        dyn.gang.basisRot.copyFrom(ziel.rot);
        dyn.gang.tempo = 0;
      }
    }
    dyn.ziel = ziel;
    // Grundskalierung des Prefabs MIT der ZDO-Skalierung verrechnen.
    //
    // Statische Prefabs bekommen ihre localScale über composeZdoWorld; im
    // dynamischen Pfad stand hier nur die ZDO-Skalierung. Prefabs, deren
    // Modell nicht in Metern vorliegt, standen dadurch in Rohgröße da — die
    // Völva mit localScale 1.75 war einen Meter groß, weil ihr GLB (wie alles
    // aus dem Generator) auf Kantenlänge 1 normiert ist.
    //
    // Für alle bisherigen dynamischen Prefabs ist localScale 1, an ihnen
    // ändert sich damit nichts.
    const basis = findPrefabByHash(u.prefabHash)?.localScale ?? { x: 1, y: 1, z: 1 };
    const s = u.scale;
    const f =
      typeof s === 'number' ? { x: s, y: s, z: s } : s ? { x: s.x, y: s.y, z: s.z } : { x: 1, y: 1, z: 1 };
    dyn.root.scaling = new Vector3(basis.x * f.x, basis.y * f.y, basis.z * f.z);
  }

  // ── Location terrain leveling (F4) ───────────────────────────────

  private applyLocationLeveling(featureHash: number, position: { x: number; y: number; z: number }): void {
    const feature = getFeatureByHash(featureHash);
    if (!feature) return;
    const leveling = getTerrainLeveling(feature);
    if (!leveling) return;
    const affected = this.world.heightmaps.addTerrainModifier({
      x: position.x,
      z: position.z,
      targetHeight: f32(position.y + leveling.levelOffset),
      levelRadius: leveling.levelRadius,
      smoothRadius: leveling.smoothRadius,
      smoothPower: leveling.smoothPower,
      square: leveling.square,
    });
    this.terrain.rebuildZones(affected);
  }
}

/**
 * Weltmatrix einer Instanz.
 *
 * Die Skalierung stammt aus dem ZDO — ABER nur, wenn das Prefab eine
 * abweichende mitschickt (SYNC_INITIAL_SCALE). Fehlt sie, gilt die
 * localScale des Prefabs, nicht 1: Rock_3 und Rock_4 stehen im pkg mit
 * localScale 2 und wurden dadurch in halber Größe gerendert — ein
 * Felsbrocken, der nur 34 cm aus dem Boden ragte und im Gras unsichtbar
 * blieb.
 */
function composeZdoWorld(u: ZDOEntityUpdate, prefabScale?: Vector3Like): Matrix {
  const s = u.scale;
  const scaling =
    typeof s === 'number'
      ? new Vector3(s, s, s)
      : s
        ? new Vector3(s.x, s.y, s.z)
        : prefabScale
          ? new Vector3(prefabScale.x, prefabScale.y, prefabScale.z)
          : Vector3.One();
  return Matrix.Compose(
    scaling,
    new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    new Vector3(u.position.x, u.position.y, u.position.z)
  );
}

/** Small named box for dynamic entities without a model in the export. */
function makePlaceholder(scene: Scene, name: string): TransformNode {
  const root = new TransformNode(`ph_${name}`, scene);
  const box = MeshBuilder.CreateBox(`ph_${name}_box`, { size: 0.7 }, scene);
  const mat = new StandardMaterial(`ph_${name}_mat`, scene);
  const hue = (Array.from(name).reduce((a, c) => a + c.charCodeAt(0) * 31, 7) % 360) / 360;
  const c = Color3.FromHSV(hue * 360, 0.45, 0.75);
  mat.diffuseColor = c;
  mat.specularColor = new Color3(0, 0, 0);
  box.material = mat;
  box.position.y = 0.5;
  box.parent = root;
  return root;
}
