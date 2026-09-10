/**
 * Physics — Havok, standing in for Unity's PhysX.
 *
 * The original does not hand-roll collision: Character carries a Rigidbody and a
 * CapsuleCollider (Character.cs:234/236) and PhysX resolves the rest. The
 * closest equivalent available to us is Havok, which Babylon ships as a
 * WASM plugin — so this file wires that up rather than approximating
 * collision with distance checks.
 *
 * ── Wo die Kollisionsformen herkommen ────────────────────────────────
 * NICHT MEHR HIER. Gemessen wird seit dem 10.09.2026 in
 * `shared/src/kollision/formen.ts`; diese Datei baut nur noch das
 * Havok-Shape aus der fertigen {@link KollisionsForm}.
 *
 * Der Grund ist der Server: Er rechnet die Spielerbewegung gegen
 * dieselben Hindernisse und kennt weder Babylon noch Havok. Stünde die
 * Ableitung weiter hier, gäbe es sie zweimal — und zwei Ableitungen
 * derselben Form laufen lautlos auseinander: Der Spieler bliebe im Bild
 * vor einem Stamm stehen, den der Server nicht kennt, und würde von der
 * Serverkorrektur hindurchgezogen.
 *
 * The shapes are no longer measured here; this file only turns a shared
 * `KollisionsForm` into a Havok shape.
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
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Die Form kommt aus `shared` — dieselbe Ableitung, die der Server
// benutzt. Hier wird nur noch das Havok-Shape daraus gebaut.
import type { KollisionsForm } from '@wov/shared';
// Die Größenstufen — dieselbe Funktion, die der Server auf dieselbe
// Instanzskalierung anwendet (`Kollisionswelt.skalierung`). Nur wenn
// beide Seiten DIESELBE Zahl in die Form rechnen, ist es dieselbe Form.
import { skalierungsStufe } from '@wov/shared';

/**
 * Gravitation (m/s²) — das Original weicht vom Unity-Default ab: die
 * ProjectSettings des Spiels stehen auf −20 (`m_Gravity.m_Y` in
 * PhysicsManager.json des AssetRipper-Exports). Muss mit der Gravitation
 * im PlayerController übereinstimmen, sonst fallen Spieler und Weltobjekte
 * unterschiedlich schnell.
 */
const GRAVITY = new Vector3(0, -20, 0);

/**
 * Start Havok and attach it to the scene. Must be awaited before use.
 *
 * The Emscripten module and its ~1.5 MB of WASM are pulled in DYNAMICALLY,
 * not through a top-level import. A static import would make every module
 * that merely wants StaticColliderSet (EntityManager, Terrain) drag the
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

/** Was ein Strahl getroffen hat: Punkt und Flaechennormale, in Weltkoordinaten. */
export interface StrahlTreffer {
  x: number;
  y: number;
  z: number;
  /** Normale der getroffenen Flaeche — zeigt aus ihr HERAUS. */
  nx: number;
  ny: number;
  nz: number;
}

// Eigene Ergebnisobjekte: `bodenHoeheUnter` laeuft jeden Frame, und eine
// geteilte Instanz waere genau die Art Kopplung, die man erst bemerkt, wenn
// zwei Aufrufer im selben Frame verschiedene Antworten bekommen.
const strahlTrefferRoh = new PhysicsRaycastResult();
const strahlVon = new Vector3();
const strahlBis = new Vector3();

/**
 * Erster Kollisionskoerper auf einer Strecke — oder null.
 *
 * Anders als `bodenHoeheUnter` liefert das hier auch die NORMALE, und die
 * ist der eigentliche Grund fuer diese Funktion: Wer eine Wandfackel
 * setzt, braucht nicht nur die Stelle, sondern die Richtung, in die die
 * Wand zeigt. Aus ihr folgt die Drehung, statt sie zu raten.
 *
 * Der Strahl trifft die Raum-Kollisionskoerper der Instanz (EntityManager
 * legt sie im Umkreis an) — in einem Dungeon gibt es kein Gelaende, gegen
 * das man sonst zielen koennte.
 */
export function strahlTreffer(
  scene: Scene,
  vonX: number, vonY: number, vonZ: number,
  richtungX: number, richtungY: number, richtungZ: number,
  weite: number
): StrahlTreffer | null {
  const engine = scene.getPhysicsEngine() as unknown as {
    raycastToRef?: (von: Vector3, bis: Vector3, ergebnis: PhysicsRaycastResult) => void;
  } | null;
  if (!engine?.raycastToRef) return null;
  strahlVon.set(vonX, vonY, vonZ);
  strahlBis.set(vonX + richtungX * weite, vonY + richtungY * weite, vonZ + richtungZ * weite);
  engine.raycastToRef(strahlVon, strahlBis, strahlTrefferRoh);
  if (!strahlTrefferRoh.hasHit) return null;
  const p = strahlTrefferRoh.hitPointWorld;
  const n = strahlTrefferRoh.hitNormalWorld;
  return { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z };
}

/**
 * Static collision for one prefab, driven by the same thin-instance
 * matrices the renderer uses.
 *
 * PhysicsBody mirrors a node's thin instances into one body per instance
 * (see `numInstances`), so a whole forest costs one body object and one
 * shape — which is what makes this affordable at the original's vegetation
 * density.
 */
/*
  Zielpuffer der Matrixzerlegung in `sync()` — wiederverwendet, weil dort
  bis zu 200 Instanzen je Neuaufbau durchlaufen und Babylons `decompose`
  sonst drei Objekte je Körper anlegt.
*/
const zerlegtSkalierung = new Vector3();
const zerlegtDrehung = new Quaternion();
const zerlegtPosition = new Vector3();

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
  /**
   * Eine Havok-Form JE SKALIERUNG.
   *
   * Havok skaliert ein Netz-Shape nicht ueber die Transformation des
   * Koerpers — gemessen: Knoten mit `scaling` 2,11, und der Strahl trifft
   * unveraendert die Huelle der Groesse 1. Fuer Kiste und Kapsel gilt es
   * ebenso wenig zuverlaessig. Die Skalierung muss deshalb in die FORM,
   * und weil im Umkreis nur Groessenordnung 30 Koerper liegen (gemessen:
   * 32 ueber alle 22 Saetze), ist eine Form je Instanzgroesse billig.
   */
  private shapes = new Map<string, PhysicsShape>();
  private bodies: PhysicsBody[] = [];
  private nodes: TransformNode[] = [];
  /**
   * Das Netz-Mesh der Form `netz` — Havok braucht ein echtes `Mesh` als
   * Vorlage, die Form selbst traegt nur Zahlen. Es gehoert diesem Set
   * und wird mit ihm entsorgt.
   */
  private netzMeshes: Mesh[] = [];
  /** Instances currently carrying a body — surfaced in the HUD. */
  count = 0;
  /** Was tatsächlich in der Physikwelt liegt. */
  bodyInstances = 0;
  private debug: Mesh | null = null;

  constructor(
    private readonly carrier: Mesh,
    private readonly form: KollisionsForm,
    private readonly scene: Scene
  ) {}

  /**
   * Havok-Shape aus der gemeinsamen Form.
   *
   * Das ist alles, was von der alten Formableitung hier geblieben ist:
   * GEMESSEN wird in `shared/src/kollision/formen.ts`, weil der Server
   * dieselbe Form braucht und weder Babylon noch Havok kennt.
   */
  private buildShape(sx: number, sy: number, sz: number): PhysicsShape {
    const f = this.form;
    if (f.art === 'netz') {
      // Die Form IST die Geometrie — Dungeon-Räume (deren Inneres eine
      // Box massiv machte), Felsen und begehbare Bauwerke. Havok
      // trianguliert das Netz einmal beim Shape-Bau, danach tragen alle
      // Instanzen dieselbe Form.
      const m = new Mesh(`col_${this.carrier.name}_netz`, this.scene);
      // Die Skalierung IN die Ecken rechnen — s. `shapes`.
      const p = new Float32Array(f.positionen.length);
      for (let i = 0; i < p.length; i += 3) {
        p[i] = f.positionen[i]! * sx;
        p[i + 1] = f.positionen[i + 1]! * sy;
        p[i + 2] = f.positionen[i + 2]! * sz;
      }
      m.setVerticesData(VertexBuffer.PositionKind, p, false);
      m.setIndices(f.indizes);
      m.setEnabled(false);
      m.isVisible = false;
      m.isPickable = false;
      this.netzMeshes.push(m);
      return new PhysicsShapeMesh(m, this.scene);
    }
    if (f.art === 'kapsel') {
      // Der Mantelradius folgt der WAAGERECHTEN Skalierung; bei
      // ungleichfoermiger Skalierung ist der groessere der beiden die
      // sichere Seite (lieber ein Stamm zu dick als einer zum
      // Hindurchlaufen).
      const rs = Math.max(Math.abs(sx), Math.abs(sz));
      const radius = f.radius * rs;
      const yMin = f.yMin * sy;
      const yMax = f.yMax * sy;
      const hoehe = yMax - yMin;
      return new PhysicsShapeCapsule(
        // Kapselenden liegen ZWISCHEN den Kappen — an beiden Seiten um
        // den Radius einrücken, damit die Gesamthöhe stimmt.
        new Vector3(f.x * sx, yMin + Math.min(radius, hoehe / 2), f.z * sz),
        new Vector3(f.x * sx, yMin + Math.max(hoehe - radius, radius), f.z * sz),
        radius,
        this.scene
      );
    }
    return new PhysicsShapeBox(
      new Vector3(
        ((f.min.x + f.max.x) / 2) * sx,
        ((f.min.y + f.max.y) / 2) * sy,
        ((f.min.z + f.max.z) / 2) * sz
      ),
      Quaternion.Identity(),
      new Vector3(
        (f.max.x - f.min.x) * Math.abs(sx),
        (f.max.y - f.min.y) * Math.abs(sy),
        (f.max.z - f.min.z) * Math.abs(sz)
      ),
      this.scene
    );
  }

  /** (Re)build the bodies after the instance buffer changed. */
  sync(): void {
    this.disposeBodies();
    const count = this.carrier.thinInstanceCount;
    this.count = count;
    if (count === 0) return;

    const mats = this.carrier.thinInstanceGetWorldMatrices();
    for (let i = 0; i < count; i++) {
      const node = new TransformNode(`${this.carrier.name}_${i}`, this.scene);
      const m = mats[i]!;
      /*
        ALLE DREI Teile der Instanzmatrix — Verschiebung, Drehung UND
        Skalierung.

        Hier stand bis zur Zusammenführung „nur Position und Drehung, die
        Form ist bereits aus dem Modell gemessen". Das war einmal richtig
        und ist es nicht mehr: Die Form kommt aus
        `shared/src/kollision/formen.ts` und steht dort ausdrücklich LOKAL
        zur Instanz — „vor Rotation und Skalierung" (s. Kopf von
        `shared/src/kollision/form.ts`). Gemessen wird sie an den
        MASTER-Netzen (`masterLocals`), und die tragen die Instanz-
        skalierung eben NICHT.

        Was es kostete, sieht man an `sm-env-rock-cliff-05`: Der Findling
        steht mit Skalierung 2,11 in der Welt, sein Körper war damit
        2,11-mal kleiner als der Fels, den man sieht — man lief bis zur
        halben Tiefe in ihn hinein. Solange der Server keine Hindernisse
        kannte, fiel das niemandem auf; seit er dieselbe Form MIT
        Skalierung rechnet (`Kollisionswelt.baueKoerper`, dieselbe Kette
        wie `composeZdoWorld`), sind es zwei verschiedene Felsen, und die
        Figur wurde zwischen ihnen hin- und hergezogen — gemessen 7,2 m
        Drift frontal.

        `decompose` statt `getRotationMatrix()`: Es liefert die drei Teile
        aus EINER Zerlegung, also garantiert zueinander passend.
      */
      m.decompose(zerlegtSkalierung, zerlegtDrehung, zerlegtPosition);
      node.position.copyFrom(zerlegtPosition);
      node.rotationQuaternion = zerlegtDrehung.clone();
      // `scaling` bleibt 1: Die Groesse steckt in der Form (s. `shapes`).
      const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
      body.shape = this.formFuerSkalierung(
        zerlegtSkalierung.x, zerlegtSkalierung.y, zerlegtSkalierung.z
      );
      this.bodies.push(body);
      this.nodes.push(node);
    }
    this.bodyInstances = this.bodies.length;
  }

  /**
   * Die Form zu einer Instanzgröße — gebaut, wenn es sie noch nicht gibt.
   *
   * Bis zum 11.09.2026 rundete der Schlüssel hier auf einen Millimeter
   * (`toFixed(3)`) mit der Begründung, zwei Findlinge mit 2,110 und
   * 2,1104 teilten sich dann eine Form. Das war eine Rechnung ohne die
   * Streuung: Die würfelt je Exemplar eine kontinuierliche Größe
   * (`shared/src/worldgen/streuung.ts`, `rangeFloat(scaleMin, scaleMax)`),
   * und auf einen Millimeter genau ist jede davon eine eigene. Gemessen
   * in einer echten Welt: 13 Felsen im 48-m-Fenster, 13 Havok-Netze —
   * jedes mit einer eigenen Kopie der Vertexdaten, jedes Zonen-`sync()`
   * neu gebaut.
   *
   * Jetzt rastet `skalierungsStufe` die Größe erst auf eine gemeinsame
   * Stufe ein (20 je Oktave, ≤ 5 % relativ), und die STUFE geht sowohl in
   * den Schlüssel als auch in die Form. Der Server tut mit derselben
   * Funktion dasselbe — sonst hätte man zwar weniger Formen, aber wieder
   * zwei verschiedene.
   */
  private formFuerSkalierung(sx: number, sy: number, sz: number): PhysicsShape {
    const gx = skalierungsStufe(sx), gy = skalierungsStufe(sy), gz = skalierungsStufe(sz);
    const schluessel = `${gx},${gy},${gz}`;
    let f = this.shapes.get(schluessel);
    if (!f) {
      f = this.buildShape(gx, gy, gz);
      this.shapes.set(schluessel, f);
    }
    return f;
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
    const f = this.form;
    // Netz-Collider: die Form IST die Geometrie — ein Drahtgitter-Proxy
    // hätte keinen Mehrwert.
    if (f.art === 'netz') return;
    const hoehe = f.art === 'kapsel' ? f.yMax - f.yMin : f.max.y - f.min.y;
    const proto =
      f.art === 'kapsel'
        ? MeshBuilder.CreateCapsule(
            `dbg_${this.carrier.name}`,
            { radius: f.radius, height: Math.max(hoehe, f.radius * 2), tessellation: 8 },
            this.scene
          )
        : MeshBuilder.CreateBox(
            `dbg_${this.carrier.name}`,
            { width: f.max.x - f.min.x, height: hoehe, depth: f.max.z - f.min.z },
            this.scene
          );
    const mat = new StandardMaterial(`dbgmat_${this.carrier.name}`, this.scene);
    mat.wireframe = true;
    mat.emissiveColor = f.art === 'kapsel' ? Color3.Green() : Color3.Yellow();
    mat.disableLighting = true;
    proto.material = mat;
    proto.isPickable = false;
    const lift = f.art === 'kapsel' ? f.yMin + hoehe / 2 : (f.min.y + f.max.y) / 2;
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
    for (const f of this.shapes.values()) f.dispose();
    this.shapes.clear();
    for (const m of this.netzMeshes) m.dispose();
    this.netzMeshes = [];
    this.bodyInstances = 0;
  }

  dispose(): void {
    this.disposeBodies();
    this.debug?.dispose();
    this.debug = null;
    // Die Netz-Meshes haengen an den Formen und gehen mit `disposeBodies`.
  }
}
