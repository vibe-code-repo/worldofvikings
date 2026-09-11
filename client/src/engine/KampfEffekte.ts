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
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Observer } from '@babylonjs/core/Misc/observable';

const VFX = '/assets/vfx/';
/**
 * Slash: EIN Halbmond (aus der SwordSlash-Tafel des Originals geschnitten —
 * die Tafel ist kein sauberes 4×2-Flipbook, ihre Boegen liegen quer ueber
 * den Zellgrenzen), Dauer wie im Original 0,25 s; statt Bildwechsel
 * waechst der Bogen von 0,7 auf 1,2 und blendet aus.
 */
const SLASH_DAUER = 0.25;
const SLASH_GROESSE = 2.0;
const SLASH_WACHSTUM: [number, number] = [0.7, 1.2];
/**
 * Neigung des Bogens je Hieb (rad, im Bild gegen den Uhrzeigersinn):
 * Hieb 1 ist der Stich (schraeg), Hieb 2 der Querhieb (waagerecht, von
 * der anderen Seite → gespiegelt), Hieb 3 der Ueberkopfhieb (senkrecht).
 */
const SLASH_WINKEL = [0.5, 0, Math.PI / 2] as const;

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
    for (const n of ['schwert_slash.png', 'treffer_blitz.png', 'treffer_funken.png', 'treffer_flash.png', 'punkt_weich.png', 'punkt_hart.png', 'blut_spritzer.png', 'funke.png']) {
      this.textur(n);
    }
    // Das Slash-Material ebenfalls vorab: Beim ersten Hieb kompilierte der
    // Shader noch, und der Bogen war schon wieder weg, bevor er zu sehen
    // war. Also einmal bauen und den Shader an einem unsichtbaren Quad
    // uebersetzen lassen.
    const mat = new StandardMaterial('kampf_slash', scene);
    const tex = this.textur('schwert_slash.png');
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
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
  schlagBogen(pos: Vector3, hieb = 0): void {
    // Billboard-Traeger + gedrehtes Quad darunter: im Billboard-Modus
    // ueberschreibt Babylon die eigene Drehung, deshalb zwei Knoten.
    const traeger = new TransformNode('kampf_slash_traeger', this.scene);
    traeger.position.copyFrom(pos);
    traeger.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const plane = MeshBuilder.CreatePlane('kampf_slash', { size: SLASH_GROESSE }, this.scene);
    plane.parent = traeger;
    plane.rotation.z = SLASH_WINKEL[Math.max(0, Math.min(2, hieb))]!;
    plane.isPickable = false;
    plane.receiveShadows = false;
    const spiegeln = hieb === 1;
    const mat = this.slashMaterial;
    plane.material = mat;
    const start = performance.now();
    const spiegel = spiegeln ? -1 : 1;
    let obs: Observer<Scene> | null = null;
    obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = (performance.now() - start) / 1000;
      const a = Math.min(1, t / SLASH_DAUER);
      const s = SLASH_WACHSTUM[0] + (SLASH_WACHSTUM[1] - SLASH_WACHSTUM[0]) * a;
      plane.scaling.set(s * spiegel, s, s);
      mat.alpha = 1 - a * a;
      if (t >= SLASH_DAUER) {
        if (obs) this.scene.onBeforeRenderObservable.remove(obs);
        // NICHT `dispose(false, true)`: das raeumt auch die Textur ab, die
        // im Cache fuer den naechsten Hieb liegt — ab dem zweiten Slash war
        // nichts mehr zu sehen (11.09.2026).
        plane.dispose(false, false);
        mat.alpha = 1;
        traeger.dispose();
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
