/**
 * Bewuchs auf der Grabhügel-Kuppel.
 *
 * Der Hügel ist ein aufgeschütteter Erdhügel — auf ihm wächst dieselbe
 * Wiese wie ringsum. Das Gelände-Gras (GrassClutter) kann das nicht
 * leisten: Es streut auf die HEIGHTMAP, und die Kuppel ist ein Modell,
 * das darüber steht. Also werden hier Halme direkt auf die Dreiecke der
 * Kuppel gestreut.
 *
 * ── Warum es das Material des Wiesengrases mitbenutzt ────────────────
 * Geteiltes Material heißt: HD-Textur, Windanimation, Cutout und
 * Sichtweiten-Ausblendung gelten automatisch mit. Ein eigenes Material
 * müsste all das nachbauen und würde bei jeder Änderung am Gras
 * auseinanderlaufen.
 *
 * ── Warum sparsam ───────────────────────────────────────────────────
 * Die erste Fassung streute rund 4.600 Halme über die Kuppel, und zwar
 * als Schattenwerfer UND -empfänger. Tausende dünne Halme, die sich auf
 * einer gewölbten Fläche gegenseitig beschatten, ergeben genau das
 * Schattenflimmern, das gemeldet wurde. Deshalb jetzt:
 *
 *   - deutlich weniger Halme (DICHTE, rund ein Zwölftel),
 *   - kein Schattenwurf (Meshname mit `clutter`-Präfix, siehe baue()),
 *   - nichts unterhalb von MIN_HOEHE, damit der Fuß frei bleibt und die
 *     Halme nicht mit dem Gelände-Gras verschmelzen.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Seiteneffekt-Import: registriert die thinInstance*-Methoden am Mesh —
// ohne ihn fehlen sie zur Laufzeit, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import type { AssetManager } from './AssetManager';
import type { GrassClutter, WiesenStreugut } from './GrassClutter';

/** Prefab, dessen Kuppel bewachsen wird — NUR die Grasvariante. */
const MODELL = 'GrabhuegelGras';
/** Material der Erdkuppel im Modell (tools/grabhuegel-bauen.py). */
const KUPPEL_MATERIAL = 'sode';
/**
 * Meshname der Halme. Das `clutter`-Präfix ist kein Schmuck: Shadows.ts
 * nimmt über NIE_WERFEN alles so Benannte vom Schattenwurf aus — genau
 * das Werfen hunderter dünner Halme war die Ursache des Flimmerns.
 */
const MESH_NAME = 'clutter_huegelgras';

/**
 * Halme je Quadratmeter Kuppelfläche.
 *
 * 0,32 ergibt beim Grabhügel (rund 1.100 m² Kuppel) etwa 350 Büschel —
 * genug, dass die Kuppel bewachsen wirkt, wenig genug, dass man einzelne
 * Büschel als Auflockerung liest statt als Rasenteppich. Die erste
 * Fassung lag bei rund 4 je m².
 */
const DICHTE = 0.32;
/**
 * So viele Halme muss eine Kuppel mindestens ergeben, damit das Ergebnis
 * als gültig gilt — Schutz gegen halb geladene Geometrie.
 */
const MINDEST_HALME = 40;
/** Unterhalb dieser Höhe über dem Hügelfuß bleibt die Kuppel kahl (m). */
const MIN_HOEHE = 1.2;
/**
 * Zusaetzliche Groessenstreuung ueber die des Wiesengrases hinaus.
 *
 * Die Grundgroesse kommt aus dem Streugut selbst (`prefabScale` mal
 * `scaleMin..scaleMax`) — sie MUSS angewendet werden: Die rohe
 * Halmgeometrie misst nur 0,91 x 0,28 x 0,85 m, ist also flacher als
 * breit. Erst der Y-Faktor 2,0 aus `prefabScale` richtet die Bueschel
 * auf. Ohne ihn lagen sie als breite Platten auf der Kuppel.
 */
const STREUUNG = 0.15;

/** Deterministischer Zufall — gleicher Hügel, gleiche Halme. */
function zufall(saat: number): () => number {
  let z = saat >>> 0;
  return () => {
    z = (z * 1664525 + 1013904223) >>> 0;
    return z / 4294967296;
  };
}

export class HuegelGras {
  /**
   * Zahl der Kuppel-Instanzen, für die zuletzt gestreut wurde.
   *
   * Ein einmaliges „fertig"-Flag reicht NICHT: Wer im Editor einen
   * zweiten Hügel setzt, bekäme darauf nie Gras, weil der Streuer sich
   * schon als erledigt betrachtet. Stattdessen wird die Instanzzahl
   * beobachtet und bei jeder Änderung neu gestreut — das kostet nur beim
   * Setzen und Löschen etwas, also praktisch nie.
   */
  private gestreutFuer = '';
  private wartezeit = 0;
  private readonly meshes: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetManager,
    private readonly grass: GrassClutter
  ) {}

  /** Einmal pro Frame; streut, sobald Kuppel und Grasmaterial bereitstehen. */
  update(dt: number): void {
    this.wartezeit -= dt;
    if (this.wartezeit > 0) return;
    this.wartezeit = 1.0; // im Sekundentakt nachsehen, nicht jeden Frame
    this.versuche();
  }

  private versuche(): void {
    const masters = this.assets.mastersSofort?.(MODELL);
    if (!masters?.length) return;
    const kuppel = masters.find((m) => m.mesh.material?.name === KUPPEL_MATERIAL);
    if (!kuppel?.mesh) return;
    // Geometrie MUSS geladen sein, bevor gestreut wird. Der Master
    // existiert bereits, während die 17-MB-GLB noch lädt — ein Streuen in
    // diesem Zustand fand fast keine Dreiecke und setzte trotzdem den
    // Fingerabdruck: Der Hügel blieb dann dauerhaft mit einem einzigen
    // Halm im Mittelpunkt stehen.
    if ((kuppel.mesh.getTotalVertices() ?? 0) < 3) return;
    if (!(kuppel.mesh.getIndices()?.length)) return;
    const anzahl = kuppel.mesh.thinInstanceCount ?? 0;
    // Fingerabdruck über Anzahl UND Standorte: Ein reiner Zähler würde
    // einen VERSCHOBENEN Hügel übersehen, dessen Halme dann am alten Ort
    // in der Luft stehen blieben.
    const abdruck = anzahl === 0 ? '0' : this.abdruckVon(kuppel.mesh);
    if (abdruck === this.gestreutFuer) return;
    if (anzahl === 0) {
      this.raeumeAb();
      this.gestreutFuer = '0';
      return;
    }

    const streugut = this.grass.wiesenStreugut();
    if (!streugut?.length) return;
    // Nur die HOHE Wiesenvariante nehmen. Beide zu streuen verdoppelte die
    // Halme, ohne dass man den Unterschied sieht.
    const wiese = streugut[0]!;

    const matrizen = kuppel.mesh.thinInstanceGetWorldMatrices();
    if (!matrizen.length) return;

    const punkte: Matrix[] = [];
    for (const welt of matrizen) punkte.push(...this.streueAuf(kuppel.mesh, welt, wiese));
    // Plausibilitätsschwelle: Eine Kuppel trägt hunderte Halme. Kommt fast
    // nichts heraus, ist die Geometrie noch unvollständig — dann NICHT
    // festschreiben, sondern beim nächsten Takt erneut versuchen.
    if (punkte.length < MINDEST_HALME * anzahl) return;

    // Neu streuen heisst: alte Halme weg. Sonst blieben die Bueschel des
    // geloeschten Huegels in der Luft stehen.
    this.raeumeAb();
    this.baue(wiese, punkte);
    this.gestreutFuer = abdruck;
  }

  /** Kurzer Fingerabdruck der Instanzstandorte (Anzahl + Positionen). */
  private abdruckVon(mesh: Mesh): string {
    const mats = mesh.thinInstanceGetWorldMatrices();
    let s = String(mats.length);
    for (const m of mats) {
      s += `|${m.m[12]!.toFixed(1)},${m.m[13]!.toFixed(1)},${m.m[14]!.toFixed(1)}`;
    }
    return s;
  }

  /** Halme gleichverteilt über die Dreiecke einer Kuppelinstanz. */
  private streueAuf(mesh: Mesh, welt: Matrix, wiese: WiesenStreugut): Matrix[] {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const idx = mesh.getIndices();
    if (!pos || !idx) return [];

    const rnd = zufall(0x5eed);
    const raus: Matrix[] = [];
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();

    for (let t = 0; t < idx.length; t += 3) {
      const lade = (ziel: Vector3, k: number): void => {
        const o = idx[k]! * 3;
        Vector3.TransformCoordinatesFromFloatsToRef(pos[o]!, pos[o + 1]!, pos[o + 2]!, welt, ziel);
      };
      lade(a, t);
      lade(b, t + 1);
      lade(c, t + 2);

      // Flächeninhalt über das halbe Kreuzprodukt — je größer das
      // Dreieck, desto mehr Halme. Ohne das säßen sie am Scheitel dicht
      // und am Fuß spärlich, weil dort die Felder größer sind.
      const ab = b.subtract(a);
      const ac = c.subtract(a);
      const kreuz = Vector3.Cross(ab, ac);
      const flaeche = kreuz.length() * 0.5;
      // Flaechennormale: Sie richtet die Bueschel nach der NEIGUNG aus.
      // Senkrecht stehende Halme wurzeln auf einer steilen Kuppel nur in
      // ihrem Mittelpunkt — der Rest des 1,4 m breiten Bueschels haengt
      // sichtbar in der Luft. Das Wiesengras kippt aus demselben Grund mit
      // dem Gelaende (Eintrag `terrainTilt` in GrassClutter).
      const normale = kreuz.length() > 1e-6 ? kreuz.normalize() : Vector3.Up();
      if (normale.y < 0) normale.scaleInPlace(-1);        // immer nach aussen
      const soll = flaeche * DICHTE;
      let n = Math.floor(soll);
      if (rnd() < soll - n) n++;

      for (let k = 0; k < n; k++) {
        // Gleichverteilter Punkt im Dreieck (Wurzeltrick).
        let u = rnd();
        let v = rnd();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const x = a.x + ab.x * u + ac.x * v;
        const y = a.y + ab.y * u + ac.y * v;
        const z = a.z + ab.z * u + ac.z * v;
        if (y - welt.m[13]! < MIN_HOEHE) continue;

        // Groesse wie beim Wiesengras: prefabScale mal Zufallsfaktor aus
        // dem Streugut, plus etwas eigene Streuung.
        const f =
          wiese.scaleMin +
          rnd() * (wiese.scaleMax - wiese.scaleMin) +
          (rnd() - 0.5) * STREUUNG;
        // Drehung: erst um die eigene Achse streuen, dann die Hochachse
        // auf die Flaechennormale kippen. Nur zu 85 % — ganz mitgekippt
        // wirken Halme auf steilem Hang wie angeklebt, ganz senkrecht
        // schweben sie. Gras waechst dazwischen.
        const spin = Quaternion.RotationAxis(Vector3.Up(), rnd() * Math.PI * 2);
        const ziel = Vector3.Lerp(Vector3.Up(), normale, 0.85).normalize();
        const achse = Vector3.Cross(Vector3.Up(), ziel);
        const laenge = achse.length();
        const kippen =
          laenge < 1e-6
            ? Quaternion.Identity()
            : Quaternion.RotationAxis(
                achse.scale(1 / laenge),
                Math.asin(Math.min(1, laenge))
              );
        // Fusspunkt eine Handbreit einsenken, damit die Wurzel auch bei
        // grober Dreiecksaufloesung sicher unter der Oberflaeche sitzt.
        const tief = 0.08;
        raus.push(
          Matrix.Compose(
            new Vector3(
              wiese.prefabScale[0] * f,
              wiese.prefabScale[1] * f,
              wiese.prefabScale[2] * f
            ),
            kippen.multiply(spin),
            new Vector3(
              x - normale.x * tief,
              y - normale.y * tief,
              z - normale.z * tief
            )
          )
        );
      }
    }
    return raus;
  }

  private baue(wiese: WiesenStreugut, punkte: Matrix[]): void {
    // Mesh aus der Rohgeometrie des Wiesengrases aufbauen und dessen
    // FERTIGES Material teilen (nicht kopieren) — so wirken HD-Umschalter,
    // Wiesen-Toenung und Sichtweiten-Uniforms automatisch mit.
    // Name mit `clutter`-Präfix: Shadows.ts nimmt alles, was so heisst,
    // ueber NIE_WERFEN vom Schattenwurf aus — und genau das Werfen war die
    // Ursache des gemeldeten Flimmerns (hunderte duenne Halme in der
    // Schattenkarte). Das EMPFANGEN bleibt an, so wie beim Wiesengras
    // ringsum: Gras im Baumschatten ist dort ausdruecklich gewollt.
    // Ueber den Namen zu gehen ist besser als eine Sonderregel — die
    // Halme verhalten sich damit exakt wie das Gelaende-Gras.
    const mesh = new Mesh(MESH_NAME, this.scene);
    const daten = new VertexData();
    daten.positions = wiese.geometry.positions;
    daten.normals = wiese.geometry.normals;
    daten.uvs = wiese.geometry.uvs;
    daten.indices = wiese.geometry.indices;
    daten.applyToMesh(mesh, false);
    mesh.material = wiese.material;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;

    const puffer = new Float32Array(punkte.length * 16);
    punkte.forEach((m, i) => m.copyToArray(puffer, i * 16));
    mesh.thinInstanceSetBuffer('matrix', puffer, 16, false);
    mesh.setEnabled(true);
    this.meshes.push(mesh);
  }

  private raeumeAb(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
    // Sicherheitsnetz: Auch Halm-Meshes einsammeln, die NICHT mehr in
    // `this.meshes` stehen. Beim Streamen kann ein Streudurchgang
    // abbrechen (Kuppel geladen, Grasmaterial noch nicht), und ein
    // halbfertiges Mesh bliebe sonst als Leiche in der Szene stehen —
    // gemessen lagen zeitweise drei Gras-Meshes gleichzeitig herum,
    // eines davon mit null Halmen.
    for (const m of [...this.scene.meshes]) {
      if (m.name === MESH_NAME) m.dispose();
    }
  }

  dispose(): void {
    this.raeumeAb();
  }
}
