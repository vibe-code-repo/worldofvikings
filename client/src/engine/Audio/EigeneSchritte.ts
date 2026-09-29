/**
 * Verbindet Takt und Untergrundwahl (`./Schritte`) mit der eigenen Figur und
 * der Ton-Engine (B2): eine Aufrufstelle, `update(dt)` je Frame.
 *
 * Spielt auf dem `world`-Bus an der Fußposition (räumlich).
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BodenQuelle } from '@wov/shared/src/worldgen/bodenMischung.js';
import type { AudioEngine } from './AudioEngine';
import { SchrittTakt, schrittGruppe } from './Schritte';

/** Was das Modul von der Figur braucht. */
export interface SchrittFigur {
  readonly position: { x: number; y: number; z: number };
  readonly inLuft: boolean;
  readonly rennt: boolean;
  readonly bauModus: boolean;
  readonly frozen: boolean;
  readonly dungeonMode: boolean;
  bodenSonde: ((x: number, y: number, z: number) => number | null) | null;
}

export class EigeneSchritte {
  private readonly takt = new SchrittTakt();
  private zeit = 0;
  private readonly fuss = new Vector3();

  constructor(
    private readonly figur: SchrittFigur,
    private readonly quelle: () => BodenQuelle | null,
    private readonly audio: () => AudioEngine | null,
  ) {}

  update(dt: number): void {
    const f = this.figur;
    this.zeit += dt;
    if (f.bauModus || f.frozen) {
      this.takt.zuruecksetzen();
      return;
    }
    const p = f.position;
    const schritt = this.takt.update({
      x: p.x,
      y: p.y,
      z: p.z,
      zeit: this.zeit,
      bodenkontakt: !f.inLuft,
      gangart: f.rennt ? 'rennen' : 'gehen',
    });
    if (!schritt) return;
    const quelle = this.quelle();
    const audio = this.audio();
    if (!quelle || !audio) return;
    const gruppe = schrittGruppe({
      x: p.x,
      z: p.z,
      dungeon: f.dungeonMode,
      koerperHoehe: f.bodenSonde ? f.bodenSonde(p.x, p.y, p.z) : null,
      quelle,
    });
    if (gruppe === null) return;
    this.fuss.set(p.x, p.y, p.z);
    void audio.playAsync('world', gruppe, { position: this.fuss });
  }
}
