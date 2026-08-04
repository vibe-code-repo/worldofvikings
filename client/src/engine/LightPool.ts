/**
 * LightPool (Phase G) — Punktlichter für Fackeln, Feuerstellen und
 * Laternen. Statt jeder Lichtquelle ein eigenes Licht zu geben (WebGL
 * verkraftet nur eine Handvoll Lichter pro Material), wandert ein fester
 * Pool von PointLights auf die N nächsten Quellen um den Spieler; die
 * Zuordnung wird halbsekündlich neu bestimmt, das Flackern läuft pro Frame.
 *
 * Quellen kommen aus den ECHTEN Entity-Instanzen: jedes Prefab mit
 * `PrefabDef.light` (CastleKit_groundtorch, fire_pit, bonfire …) zählt —
 * damit leuchten Dungeon-Fackeln, Camp-Feuer und gebaute Fackeln gleich.
 */
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { PrefabDef } from '@wov/shared';

/** Poolgröße — mit Sonne+Ambient bleiben Materialien unter 8 Lichtern. */
// 4 statt 6: Mit CSM-Schatten + Sonne/Ambient sprengten 8 gleichzeitige
// Lichter je Effekt die Uniform-Limits schwächerer WebGL2-Treiber —
// ~196 „Unable to compile effect"-Fehler pro Sitzung (Review-Punkt 10).
const POOL = 4;
/** Suchradius um den Spieler (m). */
const RADIUS = 45;
/** Neuzuordnung der Quellen (ms). */
const REFRESH_MS = 500;

export interface Lichtquelle {
  x: number;
  y: number;
  z: number;
  licht: NonNullable<PrefabDef['light']>;
}

export class LightPool {
  private readonly lichter: PointLight[] = [];
  private aktiv: Lichtquelle[] = [];
  private letzteZuordnung = 0;
  private zeit = 0;

  constructor(
    private readonly scene: Scene,
    private readonly quellen: (x: number, z: number, radius: number) => Lichtquelle[]
  ) {
    for (let i = 0; i < POOL; i++) {
      const l = new PointLight(`fackel_${i}`, Vector3.Zero(), scene);
      l.intensity = 0;
      l.range = 1;
      l.falloffType = PointLight.FALLOFF_STANDARD;
      // Fackeln sollen die Szene wärmen, nicht spiegeln.
      l.specular = new Color3(0.3, 0.2, 0.1);
      this.lichter.push(l);
    }
    // Materialien müssen mehr als Babylons Default (4) gleichzeitig mischen.
    const heben = (m: { maxSimultaneousLights?: number }) => {
      if (typeof m.maxSimultaneousLights === 'number') m.maxSimultaneousLights = POOL + 2;
    };
    for (const m of scene.materials) heben(m as never);
    scene.onNewMaterialAddedObservable.add((m) => heben(m as never));
  }

  update(px: number, py: number, pz: number, dt: number): void {
    this.zeit += dt;
    const jetzt = performance.now();
    if (jetzt - this.letzteZuordnung >= REFRESH_MS) {
      this.letzteZuordnung = jetzt;
      const alle = this.quellen(px, pz, RADIUS);
      alle.sort(
        (a, b) =>
          (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2)
      );
      this.aktiv = alle.slice(0, POOL);
    }

    for (let i = 0; i < POOL; i++) {
      const licht = this.lichter[i]!;
      const q = this.aktiv[i];
      if (!q) {
        licht.intensity = 0;
        continue;
      }
      licht.position.set(q.x, q.y + q.licht.offsetY, q.z);
      licht.diffuse.set(q.licht.color[0], q.licht.color[1], q.licht.color[2]);
      licht.range = q.licht.range;
      // Flackern: zwei überlagerte Sinusfrequenzen je Quelle phasenversetzt —
      // billig, aperiodisch genug, kein Zufallszustand nötig.
      const phase = (q.x * 7.3 + q.z * 3.1) % 6.283;
      const flicker = q.licht.flicker
        ? 0.86 + 0.09 * Math.sin(this.zeit * 9 + phase) + 0.05 * Math.sin(this.zeit * 23 + phase * 2)
        : 1;
      licht.intensity = q.licht.intensity * flicker;
    }
  }

  dispose(): void {
    for (const l of this.lichter) l.dispose();
  }
}
