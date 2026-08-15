/**
 * Lässt glühende Materialien atmen — Lava, Feuer, Schmiedeglut.
 *
 * Die Emissive-Karte (tools/glb-glut.py) macht die Adern hell, aber
 * unbeweglich hell. Feuer, das exakt gleich hell bleibt, liest sich als
 * angemalt; erst die Schwankung macht daraus Glut.
 *
 * ── Warum kein MaterialPlugin ────────────────────────────────────────
 * Ein Shader-Plugin könnte pro Pixel flackern und wäre die schönere
 * Lösung. Es wäre aber auch ein weiterer Eingriff in den PBR-Shader, und
 * `emissiveIntensity` ist ein simpler Uniform, den man pro Frame setzen
 * kann — für eine Handvoll glühender Objekte reicht das vollkommen und
 * kostet nichts.
 *
 * ── Warum drei Wellen ────────────────────────────────────────────────
 * Eine einzelne Sinuswelle atmet sichtbar im Takt. Drei überlagerte mit
 * unharmonischen Frequenzen (0.9 / 2.4 / 6.0 Hz) ergeben eine Kurve, die
 * sich im Beobachtungszeitraum nicht erkennbar wiederholt: Wogen, darüber
 * ein Zucken. Die Frequenzen sind bewusst flott — Feuer flackert, es atmet
 * nicht.
 */
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Scene } from '@babylonjs/core/scene';

interface Eintrag {
  material: PBRMaterial;
  /** Grundhelligkeit, auf die sich die Schwankung bezieht. */
  basis: number;
  /** Zeitversatz, damit zwei Objekte nicht im Gleichtakt pulsen. */
  phase: number;
}

export class GlutPuls {
  private static readonly eintraege: Eintrag[] = [];
  private static angehaengt: WeakSet<Scene> = new WeakSet();
  private static zeit = 0;

  /**
   * Schwankungsbreite um die Grundhelligkeit (0.5 = ±50 %).
   *
   * Der erste Anlauf stand auf 0.25 und war im Spiel schlicht nicht zu
   * sehen. Grund ist die Bildpipeline: Das Tonemapping steht auf
   * KHR_PBR_NEUTRAL und komprimiert helle Werte kräftig, Bloom greift erst
   * ab 0.7. Eine Schwankung von 1.6 auf 2.0 verschwindet darin restlos —
   * gemessen hatte sie stattgefunden, gesehen hat man sie nicht.
   */
  static amplitude = 0.5;

  /**
   * Meldet ein Material zum Glühen an.
   *
   * `basis` ist die Grundhelligkeit: Werte über 1 lassen die Adern in den
   * Bloom laufen, was bei Lava erwünscht ist.
   */
  static registriere(material: PBRMaterial, scene: Scene, basis = 3.0): void {
    if (this.eintraege.some((e) => e.material === material)) return;
    material.emissiveIntensity = basis;
    // Phase aus dem Materialnamen ableiten statt zufällig: Dasselbe Modell
    // pulst nach einem Neuladen wieder gleich, und zwei verschiedene
    // Objekte liegen trotzdem auseinander.
    let h = 0;
    for (let i = 0; i < material.name.length; i++) h = (h * 31 + material.name.charCodeAt(i)) | 0;
    this.eintraege.push({ material, basis, phase: (Math.abs(h) % 1000) / 1000 * Math.PI * 2 });

    if (!this.angehaengt.has(scene)) {
      this.angehaengt.add(scene);
      scene.onBeforeRenderObservable.add(() => {
        this.zeit += scene.getEngine().getDeltaTime() / 1000;
        this.aktualisiere();
      });
    }
  }

  private static aktualisiere(): void {
    const t = this.zeit;
    for (const e of this.eintraege) {
      const p = e.phase;
      const welle =
        Math.sin(t * 0.9 + p) * 0.50 +
        Math.sin(t * 2.4 + p * 1.6) * 0.32 +
        Math.sin(t * 6.0 + p * 2.3) * 0.18;
      e.material.emissiveIntensity = e.basis * (1 + this.amplitude * welle);
    }
  }

  /** Diagnose: wie viele Materialien glühen gerade. */
  static get anzahl(): number {
    return this.eintraege.length;
  }

  /** Grundhelligkeit aller angemeldeten Materialien ändern (Debug-Konsole). */
  static setzeBasis(basis: number): void {
    for (const e of this.eintraege) e.basis = basis;
  }
}
