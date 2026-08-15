/**
 * Sichtbarkeit der Thin-Instance-Master (D10).
 *
 * Bis D10 lief jeder Prefab-Master mit `alwaysSelectAsActiveMesh = true`:
 * Er wurde in JEDEM Bild gezeichnet, auch wenn keine seiner Instanzen im
 * Bild stand. Das Flag ist gefallen, weil Babylon den Hüllkörper längst
 * über alle Instanzen nachführt (`thinInstanceSetBuffer` ruft selbst
 * `thinInstanceRefreshBoundingInfo`, s. AssetManager.zuMaster).
 *
 * Damit hängt die SICHTBARKEIT an diesem Hüllkörper — und ein Kasten, der
 * eine Instanz auslässt, lässt einen Baum verschwinden, sobald man aus der
 * falschen Richtung schaut. Ohne GPU sieht man das nicht; deshalb wird es
 * hier gerechnet statt angeschaut:
 *
 *   1. Der Kasten enthält JEDE gesetzte Instanz vollständig (alle acht
 *      Ecken ihrer transformierten Rohgeometrie).
 *   2. Die Windreserve ist wirklich drauf (SCHWUNG_RESERVE_M) — der
 *      Shader verschiebt Blattscheitel über die Rohgeometrie hinaus.
 *   3. Die Reserve WÄCHST NICHT mit jedem Neuaufbau. Sie wird nach jedem
 *      Puffer-Schreiben erneut aufgetragen; würde sie sich aufaddieren,
 *      wäre nach ein paar hundert Bucket-Neuaufbauten wieder alles
 *      dauerhaft sichtbar — der Fehler, den man nie bemerkt.
 *   4. Die Frustumprüfung liefert an bekannten Stellen das erwartete
 *      Ergebnis: Der ferne Grabhügel hinter der Kamera fällt weg, die um
 *      den Spieler gestreute Vegetation nicht.
 *
 * Punkt 4 hält zugleich die MESSLATTE fest: Für gestreute Vegetation
 * bringt das Culling nichts, weil ihre Instanzen den Spieler umschliessen.
 * Wer diesen Test später scheitern sieht, weil ein Vegetations-Master
 * plötzlich wegfällt, hat entweder das Streaming-Fenster verkleinert oder
 * den Hüllkörper kaputtgemacht.
 *
 * Lauf:  npx tsx client/test/master-huelle.ts
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
// Seiteneffekt-Import wie im Client: ohne ihn fehlen die thinInstance*-
// Methoden am Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { huellkoerperAufweiten } from '../src/entities/EntityManager';

// ── Deterministischer Zufall (mulberry32), wie in entity-index.ts ─────
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const zufall = rng(20260815);

/** Muss mit EntityManager.SCHWUNG_RESERVE_M übereinstimmen. */
const RESERVE = 1.5;

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  FEHLGESCHLAGEN: ${was}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

/**
 * Ein Master wie ihn zuMaster() hinterlässt: Geometrie in lokalen
 * Koordinaten, eigene Transformation auf der Identität, abgeschaltet.
 *
 * Die Masse sind die eines mittleren Baums aus dem Bestand (rund 8 m hoch,
 * 6 m Kronenbreite) und bewusst NICHT um den Ursprung zentriert — ein
 * Hüllkörper, der stillschweigend Symmetrie annimmt, fiele hier auf.
 */
function baueMaster(name: string): Mesh {
  const mesh = new Mesh(name, scene);
  const min = new Vector3(-3, 0, -2.5);
  const max = new Vector3(3, 8, 3.5);
  const p: number[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) p.push(x, y, z);
    }
  }
  const vd = new VertexData();
  vd.positions = p;
  // Indizes sind für den Hüllkörper gleichgültig, dürfen aber nicht fehlen:
  // ohne sie legt applyToMesh keine Geometrie an.
  vd.indices = [0, 1, 2, 1, 2, 3, 4, 5, 6, 5, 6, 7];
  vd.applyToMesh(mesh);
  mesh.computeWorldMatrix(true);
  mesh.setEnabled(false);
  return mesh;
}

/**
 * Frustumebenen einer Kamera an `von`, die auf `nach` blickt.
 *
 * 60° Öffnung, 16:9, 0,5 bis 200 m — die Grössenordnung der Spielerkamera.
 * Linkshändig, wie Babylon rechnet.
 */
function blickPlanes(von: Vector3, nach: Vector3) {
  const view = Matrix.LookAtLH(von, nach, Vector3.Up());
  const proj = Matrix.PerspectiveFovLH((60 * Math.PI) / 180, 16 / 9, 0.5, 200);
  return Frustum.GetPlanes(view.multiply(proj));
}

/** Rohmasse der Geometrie aus baueMaster (für die Eckenrechnung). */
const ROH_MIN = new Vector3(-3, 0, -2.5);
const ROH_MAX = new Vector3(3, 8, 3.5);

/** Instanzmatrizen setzen — derselbe Aufruf wie rebuildBucketInstances. */
function setzeInstanzen(mesh: Mesh, matrizen: Matrix[]): void {
  const daten = new Float32Array(matrizen.length * 16);
  for (let i = 0; i < matrizen.length; i++) matrizen[i]!.toArray(daten, i * 16);
  mesh.thinInstanceSetBuffer('matrix', matrizen.length > 0 ? daten : null, 16, false);
  huellkoerperAufweiten(mesh);
  mesh.setEnabled(matrizen.length > 0);
}

/** Zufällige Instanz an einer Stelle — mit Drehung und Skalierung wie im Spiel. */
function instanz(x: number, y: number, z: number): Matrix {
  const s = 0.8 + zufall() * 0.6;
  return Matrix.Compose(
    new Vector3(s, s, s),
    Quaternion.RotationAxis(new Vector3(0, 1, 0), zufall() * Math.PI * 2),
    new Vector3(x, y, z)
  );
}

/** Alle acht Ecken der Rohgeometrie unter einer Instanzmatrix. */
function ecken(m: Matrix): Vector3[] {
  const raus: Vector3[] = [];
  for (const x of [ROH_MIN.x, ROH_MAX.x]) {
    for (const y of [ROH_MIN.y, ROH_MAX.y]) {
      for (const z of [ROH_MIN.z, ROH_MAX.z]) {
        raus.push(Vector3.TransformCoordinates(new Vector3(x, y, z), m));
      }
    }
  }
  return raus;
}

// ── 1) Der Kasten enthält jede Instanz ───────────────────────────────
// Gestreut wie ein Vegetations-Bucket: ±256 m, das ZDO-Interessenfenster.
{
  const master = baueMaster('tree');
  const matrizen: Matrix[] = [];
  for (let i = 0; i < 4000; i++) {
    matrizen.push(instanz((zufall() * 2 - 1) * 256, zufall() * 40 - 10, (zufall() * 2 - 1) * 256));
  }
  setzeInstanzen(master, matrizen);

  const info = master.getBoundingInfo();
  let draussen = 0;
  for (const m of matrizen) {
    for (const e of ecken(m)) {
      if (
        e.x < info.minimum.x || e.x > info.maximum.x ||
        e.y < info.minimum.y || e.y > info.maximum.y ||
        e.z < info.minimum.z || e.z > info.maximum.z
      ) draussen++;
    }
  }
  pruefe(draussen === 0, `${draussen} Instanzecken liegen ausserhalb des Hüllkörpers`);
  console.log(
    `4000 Instanzen: Hülle ${info.minimum.x.toFixed(1)}…${info.maximum.x.toFixed(1)} x, ` +
      `${info.minimum.y.toFixed(1)}…${info.maximum.y.toFixed(1)} y  (${draussen} Ecken draussen)`
  );

  // ── 2) Die Windreserve ist drauf ───────────────────────────────────
  // Ohne sie stünde die Hülle exakt auf der äussersten Ecke; geprüft wird
  // gegen die eigene Eckenrechnung, nicht gegen Babylons Zwischenstand.
  let scharfMinX = Number.POSITIVE_INFINITY;
  let scharfMaxY = Number.NEGATIVE_INFINITY;
  for (const m of matrizen) {
    for (const e of ecken(m)) {
      scharfMinX = Math.min(scharfMinX, e.x);
      scharfMaxY = Math.max(scharfMaxY, e.y);
    }
  }
  pruefe(
    Math.abs(info.minimum.x - (scharfMinX - RESERVE)) < 1e-3,
    `Reserve fehlt in -x: Hülle ${info.minimum.x.toFixed(3)}, scharf ${scharfMinX.toFixed(3)}`
  );
  pruefe(
    Math.abs(info.maximum.y - (scharfMaxY + RESERVE)) < 1e-3,
    `Reserve fehlt in +y: Hülle ${info.maximum.y.toFixed(3)}, scharf ${scharfMaxY.toFixed(3)}`
  );

  // ── 3) Die Reserve wächst nicht ────────────────────────────────────
  // 200 Neuaufbauten mit demselben Puffer — so oft wird ein Bucket beim
  // Durchlaufen der Welt leicht neu gebaut.
  const vorher = info.maximum.y;
  for (let i = 0; i < 200; i++) setzeInstanzen(master, matrizen);
  const nachher = master.getBoundingInfo().maximum.y;
  pruefe(
    Math.abs(nachher - vorher) < 1e-3,
    `Hülle wächst mit jedem Neuaufbau: ${vorher.toFixed(3)} → ${nachher.toFixed(3)}`
  );

  // ── 4a) Umschliessende Streuung: nie wegzuwerfen ───────────────────
  // Der Spieler steht mitten in seinem Wald. Genau deshalb bringt das
  // Culling für Vegetation nichts — hier festgehalten, damit die Zahl im
  // Bericht überprüfbar bleibt.
  const spieler = new Vector3(0, 2, 0);
  for (const richtung of [
    new Vector3(0, 0, 1), new Vector3(0, 0, -1),
    new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
  ]) {
    pruefe(
      master.isInFrustum(blickPlanes(spieler, spieler.add(richtung))),
      `umschliessende Streuung fiel aus dem Frustum (Blick ${richtung})`
    );
  }
  master.dispose();
}

// ── 4b) Ortsfestes Bauwerk: fällt weg, wenn man wegschaut ────────────
// Der Grabhügel ist der Fall, um den es geht: ein einzelnes Bauwerk, das
// zehn Master stellt. Steht er hinter der Kamera, sind das zehn
// Zeichenaufrufe im Bildpass und zehn mal Kaskadenzahl im Schattenpass.
{
  const huegel = baueMaster('huegel');
  setzeInstanzen(huegel, [instanz(0, 0, 180)]);
  const kamera = new Vector3(0, 2, 0);
  pruefe(
    huegel.isInFrustum(blickPlanes(kamera, new Vector3(0, 2, 1))),
    'Grabhügel voraus wurde weggeworfen'
  );
  pruefe(
    !huegel.isInFrustum(blickPlanes(kamera, new Vector3(0, 2, -1))),
    'Grabhügel hinter der Kamera wurde NICHT weggeworfen — Culling greift nicht'
  );
  pruefe(
    !huegel.isInFrustum(blickPlanes(kamera, new Vector3(1, 2, 0))),
    'Grabhügel quer zur Blickrichtung wurde NICHT weggeworfen'
  );
  huegel.dispose();
}

// ── 5) Leerer Puffer ─────────────────────────────────────────────────
// Ein Bucket, dessen letzte Instanz entfernt wurde, schreibt einen Puffer
// der Länge 0. Der Master wird dann abgeschaltet; sein Hüllkörper darf
// trotzdem keine Unendlichkeiten enthalten (die machten jede spätere
// Frustumprüfung unbrauchbar).
{
  const leer = baueMaster('leer');
  setzeInstanzen(leer, []);
  const info = leer.getBoundingInfo();
  const endlich =
    Number.isFinite(info.minimum.x) && Number.isFinite(info.maximum.x) &&
    Number.isFinite(info.minimum.y) && Number.isFinite(info.maximum.y);
  pruefe(endlich, `leerer Puffer hinterlässt unbrauchbaren Hüllkörper: ${info.minimum} … ${info.maximum}`);
  pruefe(!leer.isEnabled(), 'Master ohne Instanzen blieb eingeschaltet');
  leer.dispose();
}

console.log(
  fehler === 0
    ? '\nOK — Hüllkörper umschliesst alle Instanzen, Reserve stabil, Culling greift'
    : `\n${fehler} FEHLER`
);
scene.dispose();
engine.dispose();
process.exit(fehler > 0 ? 1 : 0);
