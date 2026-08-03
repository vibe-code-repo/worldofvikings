/**
 * Physics — Havok, standing in for Unity's PhysX.
 *
 * Valheim does not hand-roll collision: Character carries a Rigidbody and a
 * CapsuleCollider (Character.cs:234/236) and PhysX resolves the rest. The
 * closest equivalent available to us is Havok, which Babylon ships as a
 * WASM plugin — so this file wires that up rather than approximating
 * collision with distance checks.
 *
 * ── Where the collision shapes come from ─────────────────────────────
 * The Unity prefabs' colliders are not in our asset export (only meshes,
 * materials and MonoBehaviours came through), so the shapes are measured
 * from the GLBs at load time.
 *
 * For a tree that measurement must NOT be the bounding box: the box spans
 * the CROWN, which is several metres wide, while the thing you actually
 * bump into is a trunk well under a metre thick. Walking would feel like
 * pushing an invisible barrel around. So the radius is taken from the
 * vertices in a band at player height and from a percentile rather than
 * the extreme, which keeps a single low branch from inflating it.
 *
 * Rocks and the like get their bounding box, because there the box IS the
 * obstacle.
 */

// Side-effect import: this is what patches enablePhysics() onto Scene.
// With the granular @babylonjs/core imports this project uses, nothing
// else pulls it in and scene.enablePhysics is simply undefined.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import {
  PhysicsShapeBox,
  PhysicsShapeCapsule,
  PhysicsShapeMesh,
  type PhysicsShape,
} from '@babylonjs/core/Physics/v2/physicsShape';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Gravitation (m/s²) — Valheim weicht vom Unity-Default ab: die
 * ProjectSettings des Spiels stehen auf −20 (`m_Gravity.m_Y` in
 * PhysicsManager.json des AssetRipper-Exports). Muss mit der Gravitation
 * im PlayerController übereinstimmen, sonst fallen Spieler und Weltobjekte
 * unterschiedlich schnell.
 */
const GRAVITY = new Vector3(0, -20, 0);

/**
 * Höhenband, in dem der Stammradius gemessen wird — in Metern über dem
 * PREFAB-URSPRUNG, nicht über der Modellunterkante.
 *
 * Der Ursprung ist die Standfläche: dort sitzt das Objekt auf dem Boden.
 * Fast alle Modelle ragen darunter hinaus (Oak1 bis -1,82 m, stubbe bis
 * -2,56 m), weil Wurzeln und Stammfuss in die Erde reichen. Relativ zur
 * Unterkante gemessen lag das Band deshalb UNTER dem Boden, wo alles breit
 * ist — daher kam ein Baumstumpf auf 2,41 m "Stammradius" und eine Eiche
 * auf 2,04 m. Kniehoch bis brusthoch über dem Boden ist das, was man beim
 * Laufen tatsächlich trifft.
 */
const TRUNK_BAND_MIN = 0.3;
const TRUNK_BAND_MAX = 2.0;
/**
 * Percentile of the measured radii to keep. The MEDIAN, not a high
 * percentile: in the trunk band most vertices sit on the trunk itself, so
 * the median lands on it, while low branches and root flare stay in the
 * tail. With 0.9 an oak came out at a 2.2 m "trunk" — measured, wrong, and
 * enough to wall off the forest.
 */
const TRUNK_PERCENTILE = 0.5;
/**
 * Above this height an obstacle is treated as trunk-like (capsule at the
 * band radius); below it, as a rock (bounding box).
 *
 * Deliberately NOT the TREE_BASE flag: saplings like Beech_small1/2 do not
 * carry it, fell into the box branch and got a 3.4 m wide crown box — the
 * exact failure the band measurement exists to avoid. Height is the
 * property that actually decides whether a box is a fair description.
 */
const TRUNK_MIN_HEIGHT = 2.0;
/**
 * Ein Objekt gilt als Stamm, wenn es auf Spielerhöhe deutlich DÜNNER ist
 * als seine Gesamtausdehnung: gemessener Bandradius höchstens dieser
 * Anteil der halben Gesamtbreite.
 *
 * Die Gesamtform taugt dafür nicht. Ein Beech_small2 ist 3,9 m hoch bei
 * 3,4 m Kronenbreite — nach "höher als breit" also kein Stamm, und er
 * bekam eine 3,4 m breite Kiste, an der man zweieinhalb Meter vom
 * Stämmchen entfernt hängenblieb. Krone breit, Stamm dünn ist aber genau
 * das, was einen Baum ausmacht: sein Bandradius liegt bei 0,55 m gegen
 * 1,71 m halbe Breite, also bei einem Drittel.
 *
 * Ein Felsen dagegen ist auf Spielerhöhe so breit wie insgesamt — dort
 * bleibt die Box die ehrlichere Beschreibung.
 */
const TRUNK_MAX_RADIUS_RATIO = 0.6;
/** Never produce a collider thinner than this — degenerate shapes tunnel. */
const MIN_RADIUS = 0.12;
/**
 * Unter dieser Höhe bekommt ein Objekt gar keinen Kollider. Valheim lässt
 * einen über kniehohe Steine steigen und durch Büsche laufen; gäbe man
 * jedem davon einen Körper, stünde der Spieler ständig auf knöchelhohen
 * Sockeln statt auf dem Boden (gemessen: in 61 % der Proben kein
 * Bodenkontakt, ~0,7 m über Grund).
 */
const MIN_OBSTACLE_HEIGHT = 0.5;

/** A measured collision shape for one prefab. */
export interface ColliderSpec {
  kind: 'capsule' | 'box' | 'mesh';
  /** Capsule: trunk radius. Box: half extent on X. */
  radius: number;
  /** Full height of the obstacle. */
  height: number;
  /** Box only: half extents. */
  halfX?: number;
  halfZ?: number;
  /**
   * Untere Kante der Form relativ zum Prefab-Ursprung. Nicht jedes Modell
   * hat seinen Ursprung am Fuß — ohne diesen Versatz steckt die Kapsel im
   * Boden oder schwebt darüber.
   */
  baseY: number;
  /**
   * Nur kind 'mesh' (Dungeon-Räume): die zusammengeführte, unsichtbare
   * Kollisionsgeometrie in Prefab-Koordinaten. Eine Box wäre hier fatal —
   * sie würde das begehbare INNERE des Raums massiv machen.
   */
  mesh?: Mesh;
}

/**
 * Exakte Mesh-Kollision für Prefabs, deren Inneres begehbar ist
 * (Dungeon-Räume): alle Submeshes mit ihren lokalen Transforms zu einem
 * unsichtbaren Kollisionsmesh zusammenbacken. Havok trianguliert es einmal
 * beim Shape-Bau; bei den wenigen Räumen im 48-m-Fenster ist das bezahlbar.
 */
export function buildMeshCollider(
  name: string,
  meshes: readonly Mesh[],
  locals: readonly Matrix[],
  scene: Scene
): ColliderSpec | null {
  // Nur Positionen + Indizes zusammentragen — MergeMeshes scheitert an
  // Submeshes mit unterschiedlichen Attributsätzen (UV2, Farben …), und
  // für die Kollision zählt ohnehin nur die Geometrie.
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < meshes.length; i++) {
    const src = meshes[i]!;
    const pos = src.getVerticesData(VertexBuffer.PositionKind);
    const idx = src.getIndices();
    if (!pos || !idx || idx.length === 0) continue;

    const m = locals[i] ?? Matrix.Identity();
    const e = m.m;
    const base = positions.length / 3;
    for (let v = 0; v < pos.length; v += 3) {
      const x = pos[v]!;
      const y = pos[v + 1]!;
      const z = pos[v + 2]!;
      positions.push(
        e[0]! * x + e[4]! * y + e[8]! * z + e[12]!,
        e[1]! * x + e[5]! * y + e[9]! * z + e[13]!,
        e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
      );
    }
    for (let k = 0; k < idx.length; k++) indices.push(base + idx[k]!);
  }
  if (indices.length === 0) return null;

  const collMesh = new Mesh(`${name}_colmesh`, scene);
  collMesh.setVerticesData(VertexBuffer.PositionKind, positions, false);
  collMesh.setIndices(indices);
  collMesh.setEnabled(false);
  collMesh.isVisible = false;
  collMesh.isPickable = false;
  return { kind: 'mesh', mesh: collMesh, radius: 0, height: 0, baseY: 0 };
}

/**
 * Start Havok and attach it to the scene. Must be awaited before use.
 *
 * The Emscripten module and its ~1.5 MB of WASM are pulled in DYNAMICALLY,
 * not through a top-level import. A static import would make every module
 * that merely wants deriveCollider() (EntityManager, Terrain) drag the
 * whole engine in at startup, and evaluating it there blocked the main
 * thread hard enough that the client never finished its loading screen.
 */
export async function initPhysics(scene: Scene): Promise<HavokPlugin> {
  const [{ default: HavokPhysics }, { default: havokWasmUrl }] = await Promise.all([
    import('@babylonjs/havok'),
    // Vite resolves this to an emitted asset URL; without it the WASM is
    // fetched relative to the page and 404s in a production build.
    import('@babylonjs/havok/lib/esm/HavokPhysics.wasm?url'),
  ]);
  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  const plugin = new HavokPlugin(
    // Deterministic stepping: the render loop already fixes its own dt, and
    // letting Havok sub-step independently makes movement frame-rate
    // dependent.
    true,
    havok
  );
  scene.enablePhysics(GRAVITY, plugin);
  return plugin;
}

// Wiederverwendetes Ergebnisobjekt — die Sonde läuft jeden Frame.
const sondenTreffer = new PhysicsRaycastResult();
const sondeVon = new Vector3();
const sondeBis = new Vector3();

/**
 * Höhe des nächsten Kollisionskörpers UNTER (x,y,z) — oder null, wenn dort
 * (noch) nichts liegt. Grundlage der Dungeon-Bodensicherung: Räume laden
 * asynchron, und diese Sonde ist die einzige verlässliche Antwort auf die
 * Frage "trägt mich hier schon etwas?". Der eigene CharacterController ist
 * kein Broadphase-Körper und wird nicht getroffen.
 */
export function bodenHoeheUnter(scene: Scene, x: number, y: number, z: number, maxTiefe = 200): number | null {
  const engine = scene.getPhysicsEngine() as unknown as {
    raycastToRef?: (von: Vector3, bis: Vector3, ergebnis: PhysicsRaycastResult) => void;
  } | null;
  if (!engine?.raycastToRef) return null;
  sondeVon.set(x, y + 1, z);
  sondeBis.set(x, y - maxTiefe, z);
  engine.raycastToRef(sondeVon, sondeBis, sondenTreffer);
  return sondenTreffer.hasHit ? sondenTreffer.hitPointWorld.y : null;
}

/**
 * Collect world-space Y and radial extents from a mesh's vertices.
 *
 * Deliberately allocation-free in the inner loop: a tree GLB carries tens
 * of thousands of vertices, and building a Vector3 per vertex (times two
 * passes, times every prefab) is enough work to stall a frame outright.
 * The transform is applied by hand from the matrix elements instead.
 */
function measure(meshes: readonly Mesh[], locals: readonly Matrix[]): {
  radii: number[];
  minY: number;
  maxY: number;
  maxX: number;
  maxZ: number;
  maxXAbove: number;
  maxZAbove: number;
} {
  const radii: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  let maxZ = 0;
  /** Grösste Ausdehnung OBERHALB des Ursprungs — der sichtbare Teil. */
  let maxXAbove = 0;
  let maxZAbove = 0;

  // Measure in PREFAB space: localMatrix is the master's transform inside
  // the prefab (AssetManager), and the renderer composes instances as
  // localMatrix × zdoWorld. Using computeWorldMatrix() instead measures
  // wherever the prototype happens to be parked in the scene — which put
  // every capsule high above its tree and stretched by the prototype's
  // own scale. Verified with ?showcolliders=1.
  const data: Array<{ pos: Float32Array | number[]; m: Float32Array | Array<number> }> = [];
  for (let i = 0; i < meshes.length; i++) {
    const pos = meshes[i]!.getVerticesData(VertexBuffer.PositionKind);
    if (!pos) continue;
    const local = locals[i];
    data.push({ pos, m: (local ? local.m : Matrix.Identity().m) as unknown as Float32Array });
  }

  for (const { pos, m } of data) {
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      const ax = Math.abs(wx);
      const az = Math.abs(wz);
      if (ax > maxX) maxX = ax;
      if (az > maxZ) maxZ = az;
      if (wy >= 0) {
        if (ax > maxXAbove) maxXAbove = ax;
        if (az > maxZAbove) maxZAbove = az;
      }
    }
  }
  if (!Number.isFinite(minY)) {
    return { radii, minY: 0, maxY: 0, maxX: 0, maxZ: 0, maxXAbove: 0, maxZAbove: 0 };
  }

  // Zweiter Durchgang für das Stammband — Höhe über dem Ursprung (y = 0),
  // nicht über minY (s. TRUNK_BAND_MIN).
  for (const { pos, m } of data) {
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      const h = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      if (h < TRUNK_BAND_MIN || h > TRUNK_BAND_MAX) continue;
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      radii.push(Math.hypot(wx, wz));
    }
  }
  return { radii, minY, maxY, maxX, maxZ, maxXAbove, maxZAbove };
}

/**
 * Derive a collision shape from a prefab's loaded meshes.
 *
 * @param treeLike true for trunks (capsule at player height), false for
 *   rocks and other blocky obstacles (bounding box).
 */
export function deriveCollider(
  meshes: readonly Mesh[],
  locals: readonly Matrix[],
  treeLike: boolean
): ColliderSpec | null {
  const { radii, minY, maxY, maxX, maxZ, maxXAbove, maxZAbove } = measure(meshes, locals);
  const height = maxY - minY;
  if (!(height > 0)) return null;
  // Zu flach, um ein Hindernis zu sein — man steigt darüber.
  if (height < MIN_OBSTACLE_HEIGHT) return null;

  // Bandradius auf Spielerhöhe — der Wert, um den es beim Anstossen geht.
  let bandRadius: number | null = null;
  if (radii.length > 0) {
    radii.sort((a, b) => a - b);
    const idx = Math.min(radii.length - 1, Math.floor(radii.length * TRUNK_PERCENTILE));
    bandRadius = Math.max(MIN_RADIUS, radii[idx]);
  }

  // Stammartig: hoch genug, und auf Spielerhöhe deutlich dünner als die
  // Gesamtausdehnung (Krone breit, Stamm dünn).
  // Gegen den sichtbaren Teil vergleichen: unter der Erde spreizen sich
  // Wurzelteller, gegen die jeder Stamm dünn wirkt.
  const halbeBreite = Math.max(maxXAbove, maxZAbove) || Math.max(maxX, maxZ);
  const duenn = bandRadius !== null && bandRadius <= halbeBreite * TRUNK_MAX_RADIUS_RATIO;
  if (bandRadius !== null && (treeLike || (height >= TRUNK_MIN_HEIGHT && duenn))) {
    return { kind: 'capsule', radius: bandRadius, height, baseY: minY };
  }
  // No vertices in the band (a low bush, a flat rock) — fall back to the box.
  return {
    kind: 'box',
    radius: Math.max(MIN_RADIUS, Math.max(maxX, maxZ)),
    height,
    halfX: Math.max(MIN_RADIUS, maxX),
    halfZ: Math.max(MIN_RADIUS, maxZ),
    baseY: minY,
  };
}

/**
 * Static collision for one prefab, driven by the same thin-instance
 * matrices the renderer uses.
 *
 * PhysicsBody mirrors a node's thin instances into one body per instance
 * (see `numInstances`), so a whole forest costs one body object and one
 * shape — which is what makes this affordable at Valheim's vegetation
 * density.
 */
export class StaticColliderSet {
  /**
   * EIN Körper je Instanz — bewusst nicht Havoks Instanz-Modus.
   *
   * PhysicsBody kann die Thin Instances eines Meshes spiegeln
   * (numInstances), und das lief hier auch: Havok meldete die Körper, und
   * ein Raycast traf sie. Nur sieht Babylons PhysicsCharacterController
   * sie NICHT — sein Shape-Cast berücksichtigt ausschliesslich normale
   * Körper. Nachgewiesen mit zwei identischen Anläufen gegen denselben
   * Stamm: instanziert lief der Spieler mit 0,43 m Restabstand hindurch
   * (Radius 0,79 m), gegen einen einzeln angelegten Körper stoppte er bei
   * 1,08 m und glitt daran entlang.
   *
   * Einzelne Körper sind hier bezahlbar, weil ohnehin nur solide Klassen
   * im Umkreis des Spielers einen bekommen — Grössenordnung 50 bis 200.
   * Die SHAPE wird geteilt, nur Transform und Body existieren pro Instanz.
   */
  private shape: PhysicsShape | null = null;
  private bodies: PhysicsBody[] = [];
  private nodes: TransformNode[] = [];
  /** Instances currently carrying a body — surfaced in the HUD. */
  count = 0;
  /** Was tatsächlich in der Physikwelt liegt. */
  bodyInstances = 0;
  private debug: Mesh | null = null;

  constructor(
    private readonly carrier: Mesh,
    private readonly spec: ColliderSpec,
    private readonly scene: Scene
  ) {}

  private buildShape(): PhysicsShape {
    const s = this.spec;
    if (s.kind === 'mesh') {
      return new PhysicsShapeMesh(s.mesh!, this.scene);
    }
    return s.kind === 'capsule'
      ? new PhysicsShapeCapsule(
          // Kapselenden liegen ZWISCHEN den Kappen — an beiden Seiten um
          // den Radius einrücken, damit die Gesamthöhe stimmt.
          new Vector3(0, s.baseY + Math.min(s.radius, s.height / 2), 0),
          new Vector3(0, s.baseY + Math.max(s.height - s.radius, s.radius), 0),
          s.radius,
          this.scene
        )
      : new PhysicsShapeBox(
          new Vector3(0, s.baseY + s.height / 2, 0),
          Quaternion.Identity(),
          new Vector3((s.halfX ?? s.radius) * 2, s.height, (s.halfZ ?? s.radius) * 2),
          this.scene
        );
  }

  /** (Re)build the bodies after the instance buffer changed. */
  sync(): void {
    this.disposeBodies();
    const count = this.carrier.thinInstanceCount;
    this.count = count;
    if (count === 0) return;

    this.shape = this.buildShape();
    const mats = this.carrier.thinInstanceGetWorldMatrices();
    for (let i = 0; i < count; i++) {
      const node = new TransformNode(`${this.carrier.name}_${i}`, this.scene);
      const m = mats[i]!;
      // Nur Position und Drehung übernehmen: die Form ist bereits aus dem
      // Modell gemessen, eine zusätzliche Skalierung würde sie verzerren.
      const pos = m.getTranslation();
      node.position.copyFrom(pos);
      node.rotationQuaternion = Quaternion.FromRotationMatrix(m.getRotationMatrix());
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      body.shape = this.shape;
      this.bodies.push(body);
      this.nodes.push(node);
    }
    this.bodyInstances = this.bodies.length;
  }

  /**
   * Draw the actual shapes as wireframes (?showcolliders=1) — a capsule
   * sitting below the terrain looks exactly like "no collider" from the
   * inside, so this is what makes placement bugs visible.
   */
  showDebug(): void {
    this.debug?.dispose();
    const count = this.carrier.thinInstanceCount;
    if (count === 0) return;
    const s = this.spec;
    // Mesh-Collider (Dungeon-Räume): die Form IST die Geometrie — ein
    // Drahtgitter-Proxy hätte keinen Mehrwert.
    if (s.kind === 'mesh') return;
    const proto =
      s.kind === 'capsule'
        ? MeshBuilder.CreateCapsule(
            `dbg_${this.carrier.name}`,
            { radius: s.radius, height: Math.max(s.height, s.radius * 2), tessellation: 8 },
            this.scene
          )
        : MeshBuilder.CreateBox(
            `dbg_${this.carrier.name}`,
            { width: (s.halfX ?? s.radius) * 2, height: s.height, depth: (s.halfZ ?? s.radius) * 2 },
            this.scene
          );
    const mat = new StandardMaterial(`dbgmat_${this.carrier.name}`, this.scene);
    mat.wireframe = true;
    mat.emissiveColor = s.kind === 'capsule' ? Color3.Green() : Color3.Yellow();
    mat.disableLighting = true;
    proto.material = mat;
    proto.isPickable = false;
    const lift = s.baseY + s.height / 2;
    const src = this.carrier.thinInstanceGetWorldMatrices();
    const data = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      const m = src[i]!.clone();
      m.setTranslation(m.getTranslation().add(new Vector3(0, lift, 0)));
      m.copyToArray(data, i * 16);
    }
    proto.thinInstanceSetBuffer('matrix', data, 16, false);
    this.debug = proto;
  }

  /** Ob irgendein Körper dieses Sets nahe (x,z) liegt — Ladeprüfung. */
  hasBodyNear(x: number, z: number, r: number): boolean {
    const r2 = r * r;
    for (const n of this.nodes) {
      const dx = n.position.x - x;
      const dz = n.position.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  private disposeBodies(): void {
    for (const b of this.bodies) b.dispose();
    for (const n of this.nodes) n.dispose();
    this.bodies = [];
    this.nodes = [];
    this.shape?.dispose();
    this.shape = null;
    this.bodyInstances = 0;
  }

  dispose(): void {
    this.disposeBodies();
    this.debug?.dispose();
    this.debug = null;
  }
}
