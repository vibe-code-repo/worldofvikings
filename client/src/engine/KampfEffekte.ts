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
 * Slash nach dem Original (Steam-Fassung, Particle-Prefab
 * ThirdPersonSlashParent → SwordSlashEffect2): EIN Quad von 3,5 m, das die
 * 4×2-Tafel `SwordSlash` als Flipbook ueber 0,25 s abspielt — die fruehen
 * Bilder sind der breite Bogen, die spaeten die duenne Linie —, und zwar
 * IN DER EBENE DES HIEBS (Kind des Schwert-Prefabs), nicht als Billboard.
 * Mikes Screenshot vom 11.09.2026 zeigt genau das: ein duenner, langer
 * Streifen waagerecht um die Figur. Der Verzerrungs-Shader des Originals
 * (KriptoFX Distortion) ist hier ein additives, gedaempftes Weiss.
 */
const SLASH_DAUER = 0.25;
const SLASH_GROESSE = 3.5;
const SLASH_SPALTEN = 4;
const SLASH_ZEILEN = 2;
/** Abstand der Quadmitte vor der Figur und Hoehe (Original: 1,6 / 1,05). */
const SLASH_VORN = 1.3;
const SLASH_HOEHE = 1.05;
/** Helligkeit des additiven Weiss (die Verzerrung des Originals ist nicht grell). */
const SLASH_HELLE = 0.55;

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
  /**
   * Slash in der Ebene des Hiebs. `vorn`/`rechts`: waagerechte Achsen der
   * Figur. Hieb 1 und 2 sind Querhiebe (Quad liegt flach, Bogen um die
   * Figur; Hieb 2 gespiegelt), Hieb 3 der Ueberkopfhieb (Quad steht
   * senkrecht in Laufrichtung).
   */
  schlagBogen(wurzel: Vector3, hieb: number, vorn: Vector3, rechts: Vector3): void {
    const h = Math.max(0, Math.min(2, hieb));
    const plane = MeshBuilder.CreatePlane('kampf_slash', { size: SLASH_GROESSE }, this.scene);
    plane.position.copyFrom(wurzel).addInPlace(vorn.scale(SLASH_VORN));
    plane.position.y += SLASH_HOEHE;
    plane.isPickable = false;
    plane.receiveShadows = false;
    // Ebene ausrichten: Quad-Normale und Quad-Oben (Bogen oeffnet sich nach Quad-Unten)
    const oben = Vector3.Up();
    const normale = h === 2 ? rechts : oben;
    const quadOben = h === 2 ? oben : vorn;
    plane.rotationQuaternion = Quaternion.FromLookDirectionLH(normale, quadOben);
    if (h === 1) plane.scaling.x = -1;
    const mat = this.slashMaterial.clone('kampf_slash_' + h)!;
    const tex = this.textur('schwert_slash_tafel.png').clone();
    tex.uScale = 1 / SLASH_SPALTEN;
    tex.vScale = 1 / SLASH_ZEILEN;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    plane.material = mat;
    // Funken am Bogen (Kind „Sparks" des Slash-Prefabs)
    this.burst({ name: 'slash_funken', textur: 'treffer_funken.png', pos: plane.position.clone(), anzahl: 5, groesse: [0.06, 0.12], leben: [0.25, 0.45], tempo: [1.5, 3.5],
      farbe: new Color4(1, 0.95, 0.7, 1), additiv: true, streuung: 1 });
    const start = performance.now();
    const frames = SLASH_SPALTEN * SLASH_ZEILEN;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - start) / 1000;
      const f = Math.min(frames - 1, Math.floor((t / SLASH_DAUER) * frames));
      tex.uOffset = (f % SLASH_SPALTEN) / SLASH_SPALTEN;
      // Zeile 0 liegt oben in der Datei; Babylon zaehlt v von unten.
      tex.vOffset = 1 - (Math.floor(f / SLASH_SPALTEN) + 1) / SLASH_ZEILEN;
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
