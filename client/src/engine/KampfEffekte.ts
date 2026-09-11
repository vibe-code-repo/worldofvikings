/**
 * Kampfeffekte — Schwert-Slash, Trefferblitz, Blut, Paradefunke.
 *
 * Nachbau der Effekte des Originals (Steam-Fassung, am 11.09.2026 per
 * UnityPy aus den Spieldaten gelesen, Notiz `wov-unity-export-inventur`):
 *
 *  - Slash: EIN Quad (Original 3,5 m, Lebensdauer 0,25 s) mit der Textur
 *    `SwordSlash` — ein Flipbook aus 4×2 Halbmonden. Der Verzerrungs-
 *    Shader des Originals (KriptoFX Distortion) entfaellt; hier laeuft
 *    das Flipbook additiv als Billboard vor der Figur.
 *  - Treffer „MeleeImpact": Blitz Impact1 (2,0 / 0,1 s, orange), Glow
 *    Dot1 (3,0 / 0,15 s), Funken Impact2 (7 Stk, Speed 7, 1 s),
 *    Splitter Dot2 (15 Stk, Speed 10, dunkel). Die Funken-Schleppen
 *    (MeleeTrail) sind weggelassen — Babylon-Partikel strecken nicht.
 *  - Blut „bloodSplash": 2 Spritzer-Sprites (0,5 s, Speed 2, Schwerkraft)
 *    und ~300 winzige dunkelrote Tropfen (0,3–0,5 s).
 *  - Parade „MeleeSpark": gelber Funke 0,2 s.
 *
 * Alle Texturen liegen unter /assets/vfx/ (aus ~/wov-assets, verkleinert).
 * Groessen sind gegenueber dem Original etwa halbiert — die Unity-Werte
 * gelten fuer ein Partikel-Quad in Metern, das in unserer Kamera zu gross
 * wirkte; Zahlen im Code, damit man sie zurueckdrehen kann.
 */
import type { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Constants } from '@babylonjs/core/Engines/constants';

const VFX = '/assets/vfx/';
/**
 * Slash nach dem Original — Werte des Partikelsystems SwordSlashEffect2
 * unter „Sword North Weapon" (Steam-Fassung, 11.09.2026 per UnityPy):
 * EIN Quad 3,5 × 1,75 m (startSize3D 3,5/1,75/3,5), Render-Ausrichtung
 * „Local" unter ThirdPersonSlashParent (Position 0/1,05/1,62, Drehung
 * X→Y, Y→Z): Die Quadbreite steht SENKRECHT (oben), die Quadhoehe zeigt
 * nach vorn, die Normale nach rechts. Texture-Sheet 3×3 ueber die
 * Lebensdauer 0,25 s (die spaeten Kacheln sind die duennen Boegen), Farbe
 * ueber die Lebensdauer: (1, 0,88, 0,54) → (1, 0,58, 0) bei 47 % →
 * (1, 0,26, 0), Alpha 1 bis 83 %, dann 0. Das Elternsystem sendet nicht
 * (Emission aus). Dasselbe Prefab fuer jeden Hieb, keine Spiegelung.
 * Mikes Screenshot vom 11.09. zeigt genau diesen senkrechten Bogen von
 * schraeg hinten als duennen Streifen.
 */
const SLASH_DAUER = 0.25;
const SLASH_BREITE = 3.5;
const SLASH_HOEHE_QUAD = 1.75;
const SLASH_KACHELN = 3;
const SLASH_VORN = 1.62;
const SLASH_HOEHE = 1.05;
/** Helligkeit des additiven Farbverlaufs (das Original ist Verzerrung + Tint, nicht grell). */
const SLASH_HELLE = 0.7;
const SLASH_FARBEN: Array<[number, [number, number, number]]> = [
  [0, [1, 0.884, 0.542]],
  [0.467, [1, 0.575, 0]],
  [1, [1, 0.264, 0]],
];
const SLASH_ALPHA_ABFALL = 0.835;

/** Trefferart, wie der Server sie schickt (PacketType.HitEffect). */
export const TREFFER_HART = 0;
export const TREFFER_FLEISCH = 1;
export const TREFFER_PARADE = 2;

export class KampfEffekte {
  private readonly texturen = new Map<string, Texture>();
  /** Ein Material fuer alle Slashes — einmal kompiliert, dann sofort da. */
  private readonly slashMaterial: StandardMaterial;

  constructor(private readonly scene: Scene) {
    // Alles vorladen: Der Slash lebt 0,25 s — wer die Textur erst beim
    // ersten Hieb anfordert, sieht den ersten Hieb nie (gemessen 11.09.2026).
    for (const n of ['schwert_slash_tafel.png', 'treffer_blitz.png', 'treffer_funken.png', 'treffer_flash.png', 'punkt_weich.png', 'punkt_hart.png', 'blut_spritzer.png', 'funke.png']) {
      this.textur(n);
    }
    // Das Slash-Material ebenfalls vorab: Beim ersten Hieb kompilierte der
    // Shader noch, und der Bogen war schon wieder weg, bevor er zu sehen
    // war. Also einmal bauen und den Shader an einem unsichtbaren Quad
    // uebersetzen lassen.
    const mat = new StandardMaterial('kampf_slash', scene);
    const tex = this.textur('schwert_slash_tafel.png');
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(SLASH_HELLE, SLASH_HELLE, SLASH_HELLE);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    this.slashMaterial = mat;
    const probe = MeshBuilder.CreatePlane('kampf_slash_warm', { size: 0.01 }, scene);
    probe.isVisible = false;
    probe.material = mat;
    void mat.forceCompilationAsync(probe).finally(() => probe.dispose(false, false));
  }

  private textur(name: string): Texture {
    let t = this.texturen.get(name);
    if (!t) {
      t = new Texture(VFX + name, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      t.hasAlpha = true;
      this.texturen.set(name, t);
    }
    return t;
  }

  /**
   * Halbmond vor der Figur: `pos` ist die Mitte, `spiegeln` dreht die
   * Oeffnung (Hieb von links / von rechts).
   */
  /** Slash wie im Original: senkrechtes Quad in der Ebene Laufrichtung/Oben, 1,62 m vor der Figur. */
  schlagBogen(wurzel: Vector3, _hieb: number, vorn: Vector3, rechts: Vector3): void {
    const plane = MeshBuilder.CreatePlane('kampf_slash', { width: SLASH_BREITE, height: SLASH_HOEHE_QUAD }, this.scene);
    plane.position.copyFrom(wurzel).addInPlace(vorn.scale(SLASH_VORN));
    plane.position.y += SLASH_HOEHE;
    plane.isPickable = false;
    plane.receiveShadows = false;
    // Lokal Z (Normale) → rechts, lokal Y (Quadhoehe 1,75) → vorn, damit lokal X (Breite 3,5) senkrecht steht.
    plane.rotationQuaternion = Quaternion.FromLookDirectionLH(rechts, vorn);
    const mat = this.slashMaterial.clone('kampf_slash_i')!;
    const tex = this.textur('schwert_slash_tafel.png').clone();
    tex.uScale = 1 / SLASH_KACHELN;
    tex.vScale = 1 / SLASH_KACHELN;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    plane.material = mat;
    // Funken (Kind „Sparks" des Slash-Prefabs)
    this.burst({ name: 'slash_funken', textur: 'treffer_funken.png', pos: plane.position.clone(), anzahl: 5, groesse: [0.06, 0.12], leben: [0.25, 0.45], tempo: [1.5, 3.5],
      farbe: new Color4(1, 0.95, 0.7, 1), additiv: true, streuung: 1 });
    const start = performance.now();
    const frames = SLASH_KACHELN * SLASH_KACHELN;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - start) / 1000;
      const a = Math.min(1, t / SLASH_DAUER);
      const f = Math.min(frames - 1, Math.floor(a * frames));
      tex.uOffset = (f % SLASH_KACHELN) / SLASH_KACHELN;
      // Zeile 0 liegt oben in der Datei; Babylon zaehlt v von unten.
      tex.vOffset = 1 - (Math.floor(f / SLASH_KACHELN) + 1) / SLASH_KACHELN;
      // Farbverlauf des Originals
      let farbe = SLASH_FARBEN[SLASH_FARBEN.length - 1]![1];
      for (let i = 1; i < SLASH_FARBEN.length; i++) {
        const [t0, c0] = SLASH_FARBEN[i - 1]!;
        const [t1, c1] = SLASH_FARBEN[i]!;
        if (a <= t1) {
          const k = (a - t0) / (t1 - t0);
          farbe = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
          break;
        }
      }
      mat.emissiveColor.set(farbe[0] * SLASH_HELLE, farbe[1] * SLASH_HELLE, farbe[2] * SLASH_HELLE);
      mat.alpha = a < SLASH_ALPHA_ABFALL ? 1 : 1 - (a - SLASH_ALPHA_ABFALL) / (1 - SLASH_ALPHA_ABFALL);
      if (t >= SLASH_DAUER) {
        this.scene.onBeforeRenderObservable.remove(obs);
        plane.dispose(false, false);
        mat.dispose(false, false);
        tex.dispose();
      }
    });
  }

  /** Treffer an `pos` nach Art (siehe TREFFER_*). */
  treffer(pos: Vector3, art: number): void {
    if (art === TREFFER_FLEISCH) this.blut(pos);
    else if (art === TREFFER_PARADE) this.paradeFunke(pos);
    else this.hart(pos);
  }

  private hart(pos: Vector3): void {
    // Blitz (Impact1): ein Quad, orange, 0,1 s
    this.burst({ name: 'treffer_blitz', textur: 'treffer_blitz.png', pos, anzahl: 1, groesse: [1.0, 1.0], leben: [0.1, 0.1], tempo: [0, 0],
      farbe: new Color4(1, 0.63, 0.21, 1), additiv: true });
    // Glow (Dot1): 0,15 s
    this.burst({ name: 'treffer_glow', textur: 'punkt_weich.png', pos, anzahl: 1, groesse: [1.5, 1.5], leben: [0.15, 0.15], tempo: [0, 0],
      farbe: new Color4(1, 0.36, 0, 0.8), additiv: true });
    // Funken (Impact2): 7 Stk, Speed 7, 1 s
    this.burst({ name: 'treffer_funken', textur: 'treffer_funken.png', pos, anzahl: 7, groesse: [0.15, 0.3], leben: [0.5, 1.0], tempo: [4, 7],
      farbe: new Color4(1, 0.22, 0, 1), additiv: true, streuung: 1 });
    // Splitter (Dot2): 15 Stk, Speed 10, dunkel, mit Schwerkraft
    this.burst({ name: 'treffer_splitter', textur: 'punkt_hart.png', pos, anzahl: 15, groesse: [0.03, 0.06], leben: [0.6, 1.0], tempo: [5, 10],
      farbe: new Color4(0.12, 0.12, 0.12, 1), additiv: false, streuung: 1, schwerkraft: 9.81 });
  }

  private blut(pos: Vector3): void {
    // Spritzer-Sprites (bloodSplash): 2 Stk, 0,5 s, Speed 2, Schwerkraft
    this.burst({ name: 'blut_spritzer', textur: 'blut_spritzer.png', pos, anzahl: 2, groesse: [0.5, 0.7], leben: [0.4, 0.5], tempo: [1.5, 2.5],
      farbe: new Color4(1, 1, 1, 1), additiv: false, streuung: 0.6, schwerkraft: 9.81 });
    // Tropfen (Blood/BloodSplash): viele winzige, dunkelrot
    this.burst({ name: 'blut_tropfen', textur: 'punkt_hart.png', pos, anzahl: 220, groesse: [0.02, 0.035], leben: [0.3, 0.5], tempo: [1.0, 2.0],
      farbe: new Color4(0.46, 0.08, 0.08, 1), additiv: false, streuung: 1, schwerkraft: 6 });
  }

  private paradeFunke(pos: Vector3): void {
    this.burst({ name: 'parade_funke', textur: 'funke.png', pos, anzahl: 1, groesse: [0.6, 0.6], leben: [0.2, 0.2], tempo: [0, 0],
      farbe: new Color4(1, 1, 0, 1), additiv: true });
    this.burst({ name: 'parade_funken', textur: 'treffer_funken.png', pos, anzahl: 6, groesse: [0.1, 0.2], leben: [0.3, 0.5], tempo: [3, 5],
      farbe: new Color4(1, 0.9, 0.3, 1), additiv: true, streuung: 1 });
  }

  /** Ein einmaliger Partikelstoss; raeumt sich selbst auf, wenn alle Teilchen tot sind. */
  private burst(o: {
    name: string; textur: string; pos: Vector3; anzahl: number; groesse: [number, number]; leben: [number, number];
    tempo: [number, number]; farbe: Color4; additiv: boolean; streuung?: number; schwerkraft?: number;
  }): void {
    const ps = new ParticleSystem(o.name, Math.max(o.anzahl, 4), this.scene);
    ps.particleTexture = this.textur(o.textur);
    ps.emitter = o.pos.clone();
    ps.minEmitBox = Vector3.Zero();
    ps.maxEmitBox = Vector3.Zero();
    const s = o.streuung ?? 0;
    ps.direction1 = new Vector3(-s, -s * 0.3, -s);
    ps.direction2 = new Vector3(s, s, s);
    ps.minLifeTime = o.leben[0];
    ps.maxLifeTime = o.leben[1];
    ps.minSize = o.groesse[0];
    ps.maxSize = o.groesse[1];
    ps.minEmitPower = o.tempo[0];
    ps.maxEmitPower = o.tempo[1];
    ps.gravity = new Vector3(0, -(o.schwerkraft ?? 0), 0);
    ps.color1 = o.farbe;
    ps.color2 = o.farbe;
    ps.colorDead = new Color4(o.farbe.r, o.farbe.g, o.farbe.b, 0);
    ps.blendMode = o.additiv ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.manualEmitCount = o.anzahl;
    ps.targetStopDuration = 0.05;
    ps.disposeOnStop = true;
    ps.start();
  }

  dispose(): void {
    this.slashMaterial.dispose(false, false);
    for (const t of this.texturen.values()) t.dispose();
    this.texturen.clear();
  }
}
