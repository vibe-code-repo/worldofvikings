/**
 * LightPool (Phase G) — Punktlichter für Fackeln, Feuerstellen und
 * Laternen. Statt jeder Lichtquelle ein eigenes Licht zu geben, wandert
 * ein fester Pool auf die N nächsten Quellen um den Spieler; die
 * Zuordnung wird halbsekündlich neu bestimmt, das Flackern läuft pro Frame.
 *
 * Quellen kommen aus den ECHTEN Entity-Instanzen: jedes Prefab mit
 * `PrefabDef.light` (CastleKit_groundtorch, fire_pit, bonfire …) zählt —
 * damit leuchten Dungeon-Fackeln, Camp-Feuer und gebaute Fackeln gleich.
 *
 * ── Zwei Betriebsarten ───────────────────────────────────────────────
 * ARRAY (Regelfall, 16 Plätze): Die Quellen werden gar nicht erst zu
 * Babylon-Lichtern, sondern als ein Uniform-Array an alle Materialien
 * gebunden — `FackelLicht.ts` erklärt, warum das die Grenze von vier
 * Lichtern aufhebt (es sind Uniform-BLÖCKE, nicht Uniform-Vektoren, und
 * ein Array kostet null zusätzliche Blöcke).
 *
 * ECHT (Rückfall, 4 Plätze): der alte Weg mit `PointLight`. Greift, wenn
 * das Plugin nicht installiert werden konnte (WebGPU, zu wenig
 * Uniform-Platz) oder wenn die Notbremse ausgelöst hat. Der Wechsel kann
 * MITTEN in der Sitzung passieren, deshalb prüft `update()` die Betriebsart
 * bei jedem Aufruf statt einmal im Konstruktor.
 */
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { PrefabDef } from '@wov/shared';
import { FackelLichter } from './FackelLicht';

/**
 * Poolgröße im Rückfallbetrieb.
 *
 * 4 statt 6: Mit CSM-Schatten + Sonne/Ambient sprengten 8 gleichzeitige
 * Lichter je Effekt die Uniform-Limits schwächerer WebGL2-Treiber —
 * ~196 „Unable to compile effect"-Fehler pro Sitzung (Review-Punkt 10).
 * Diese Zahl bleibt, WEIL der Rückfallbetrieb wieder Babylons
 * Per-Licht-Blöcke benutzt und damit dieselbe Grenze hat.
 */
const RUECKFALL_POOL = 4;
/**
 * Suchradius um den Spieler (m).
 *
 * Bleibt bei 45 m, obwohl jetzt viermal so viele Plätze da sind: Die
 * Reichweite einer Fackel liegt bei 12,5 m, alles darüber hinaus wäre
 * Sortierarbeit für Lichter, die im Bild nichts tun. Die Abnahme „50+
 * Fackeln bei Nacht" hängt nicht am Radius, sondern daran, dass 16 davon
 * GLEICHZEITIG brennen dürfen — bei 12,5 m Reichweite sieht man in einem
 * Dorf nie mehr als eine Handvoll auf einmal.
 */
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
  /** Nur im Rückfallbetrieb belegt. */
  private readonly lichter: PointLight[] = [];
  private aktiv: Lichtquelle[] = [];
  private letzteZuordnung = 0;
  private zeit = 0;
  /** Zuletzt gesehene Plätze des Plugins; -1 = noch nie geprüft. */
  private plaetze = -1;
  private hoertAufNeueMaterialien = false;

  constructor(
    private readonly scene: Scene,
    private readonly quellen: (x: number, z: number, radius: number) => Lichtquelle[]
  ) {}

  /** Wie viele Quellen gerade gleichzeitig leuchten dürfen. */
  get poolGroesse(): number {
    return FackelLichter.plaetze > 0 ? FackelLichter.plaetze : RUECKFALL_POOL;
  }

  /** Diagnosezeile fürs HUD. */
  get info(): string {
    const art = FackelLichter.plaetze > 0 ? 'array' : 'echt';
    return `${this.aktiv.length}/${this.poolGroesse} ${art}`;
  }

  update(px: number, py: number, pz: number, dt: number): void {
    this.pruefeBetriebsart();
    this.zeit += dt;
    const groesse = this.poolGroesse;
    const jetzt = performance.now();
    if (jetzt - this.letzteZuordnung >= REFRESH_MS) {
      this.letzteZuordnung = jetzt;
      const alle = this.quellen(px, pz, RADIUS);
      alle.sort(
        (a, b) =>
          (a.x - px) ** 2 + (a.z - pz) ** 2 - ((b.x - px) ** 2 + (b.z - pz) ** 2)
      );
      this.aktiv = alle.slice(0, groesse);
    }

    for (let i = 0; i < groesse; i++) {
      const q = this.aktiv[i];
      if (!q) {
        if (this.lichter[i]) this.lichter[i]!.intensity = 0;
        else FackelLichter.loesche(i);
        continue;
      }
      // Flackern: zwei überlagerte Sinusfrequenzen je Quelle phasenversetzt —
      // billig, aperiodisch genug, kein Zufallszustand nötig.
      const phase = (q.x * 7.3 + q.z * 3.1) % 6.283;
      const flicker = q.licht.flicker
        ? 0.86 + 0.09 * Math.sin(this.zeit * 9 + phase) + 0.05 * Math.sin(this.zeit * 23 + phase * 2)
        : 1;
      const licht = this.lichter[i];
      if (licht) {
        licht.position.set(q.x, q.y + q.licht.offsetY, q.z);
        licht.diffuse.set(q.licht.color[0], q.licht.color[1], q.licht.color[2]);
        licht.range = q.licht.range;
        licht.intensity = q.licht.intensity * flicker;
        continue;
      }
      // Im Array-Betrieb wandert die Intensität in die FARBE. Babylon
      // multipliziert Diffusfarbe und Intensität ohnehin erst im Shader —
      // vorgezogen spart es ein Uniform je Licht.
      const s = q.licht.intensity * flicker;
      FackelLichter.setze(
        i,
        q.x,
        q.y + q.licht.offsetY,
        q.z,
        q.licht.color[0] * s,
        q.licht.color[1] * s,
        q.licht.color[2] * s,
        q.licht.range
      );
    }
    if (FackelLichter.plaetze > 0) FackelLichter.anzahl = Math.min(this.aktiv.length, groesse);
  }

  /**
   * Baut die echten Lichter auf oder ab, wenn die Betriebsart wechselt.
   *
   * Der Wechsel kann nach dem Aufbau kommen (die Notbremse in
   * `FackelLicht.ts` schlägt erst zu, wenn ein Effekt nicht übersetzt),
   * deshalb steht das hier und nicht im Konstruktor.
   */
  private pruefeBetriebsart(): void {
    const plaetze = FackelLichter.plaetze;
    if (plaetze === this.plaetze) return;
    this.plaetze = plaetze;
    for (const l of this.lichter) l.dispose();
    this.lichter.length = 0;
    if (plaetze > 0) {
      // Array-Betrieb: keine Babylon-Lichter, also auch kein Anheben von
      // maxSimultaneousLights — Sonne und Ambient bleiben die einzigen
      // Lichtblöcke, und genau das ist der Gewinn.
      FackelLichter.anzahl = 0;
      for (let i = 0; i < FackelLichter.plaetze; i++) FackelLichter.loesche(i);
      return;
    }
    for (let i = 0; i < RUECKFALL_POOL; i++) {
      const l = new PointLight(`fackel_${i}`, Vector3.Zero(), this.scene);
      l.intensity = 0;
      l.range = 1;
      l.falloffType = PointLight.FALLOFF_STANDARD;
      // Fackeln sollen die Szene wärmen, nicht spiegeln.
      l.specular = new Color3(0.3, 0.2, 0.1);
      this.lichter.push(l);
    }
    // Materialien müssen mehr als Babylons Default (4) gleichzeitig mischen.
    const heben = (m: { maxSimultaneousLights?: number }) => {
      if (typeof m.maxSimultaneousLights === 'number') {
        m.maxSimultaneousLights = RUECKFALL_POOL + 2;
      }
    };
    for (const m of this.scene.materials) heben(m as never);
    // Nur EINMAL anmelden: In den Rückfallbetrieb geht es höchstens einmal
    // je Sitzung, aber ein zweiter Beobachter auf derselben Liste wäre ein
    // Leck, das sich erst bei jedem nachgeladenen GLB zeigen würde.
    if (!this.hoertAufNeueMaterialien) {
      this.hoertAufNeueMaterialien = true;
      this.scene.onNewMaterialAddedObservable.add((m) => heben(m as never));
    }
  }

  dispose(): void {
    for (const l of this.lichter) l.dispose();
    this.lichter.length = 0;
    FackelLichter.anzahl = 0;
  }
}
