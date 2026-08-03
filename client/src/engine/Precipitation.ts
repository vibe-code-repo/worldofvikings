/**
 * Precipitation — rain, snow and ash falling around the player.
 *
 * C# reference: EnvMan enables/disables EnvSetup.m_psystems
 * (SetParticleArrayEnabled), and GlobalWind pushes the wind into each
 * system's velocityOverLifetime. Those psystem PREFABS are not in our
 * asset export, so which system a weather uses is derived from its flags
 * instead — see precipitationOf() in shared/weather.ts. The timing is
 * ground truth; the look below is ours.
 *
 * ── Why the emitter follows the player ───────────────────────────────
 * Valheim parents the systems to the camera rig, so the particles only
 * ever exist in a small box around the viewer instead of over the whole
 * world. Same here: one box emitter overhead, moved every frame. That
 * keeps the count in the low thousands no matter how far you travel.
 *
 * The wind matters twice over: it tilts the fall (GlobalWind's
 * velocityOverLifetime.x/z) and, for rain, stretches the drops along
 * their travel direction so a storm reads as driving rain rather than as
 * dots drifting sideways.
 */

import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color4, Vector3 } from '@babylonjs/core/Maths/math';
import { BoxParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Precipitation as PrecipKind } from '@wov/shared';

/** Half-width of the emitter box around the player, in metres. */
const AREA = 22;
/** Height above the player the particles start at. */
const SPAWN_HEIGHT = 16;

interface KindSpec {
  /** Particles per second at full strength. */
  rate: number;
  minSize: number;
  maxSize: number;
  /** Fall speed range (m/s), negative Y. */
  minSpeed: number;
  maxSpeed: number;
  color: Color4;
  /** How strongly the wind pushes it sideways. */
  windFactor: number;
  /** Stretch along the travel direction (rain streaks). */
  stretch: number;
}

const SPECS: Record<Exclude<PrecipKind, 'none'>, KindSpec> = {
  // Rain: fast, thin, barely visible individually — the mass makes it.
  rain: {
    // 4000 → 1800 (2026-07-29). Ein ParticleSystem rechnet JEDEN Partikel
    // auf der CPU: Position, Farbe, Lebensdauer. Bei 4000/s und ~2 s
    // Lebensdauer waren das dauerhaft ~8000 aktive Partikel — der grösste
    // CPU-Posten im Regen. 1800 liest sich bei der gestreckten Darstellung
    // praktisch gleich dicht, kostet aber weniger als die Hälfte.
    rate: 1800,
    minSize: 0.05,
    maxSize: 0.09,
    minSpeed: 18,
    maxSpeed: 24,
    color: new Color4(0.75, 0.82, 0.9, 0.5),
    // Anteil der Fallrichtung, den der Wind zur Seite kippt. Regen fällt
    // auch im Sturm steil: 0.45 ergibt bei voller Stärke ~24° Neigung.
    // Mit dem ersten Wert (6) lag die Y-Komponente nach dem Normalisieren
    // bei -0.17 — die Tropfen flogen praktisch waagerecht aus dem Bild.
    windFactor: 0.45,
    // 7 → 3.5: Mit 7 plus dem Windzuschlag unten wurden aus Tropfen lange,
    // helle Balken, die vor der Szene stehen statt zu fallen (im Bild vom
    // 2026-07-29 deutlich zu sehen).
    stretch: 3.5,
  },
  // Snow: slow and large, and blown far further off course than rain.
  snow: {
    rate: 1200,
    minSize: 0.1,
    maxSize: 0.22,
    minSpeed: 1.2,
    maxSpeed: 2.8,
    color: new Color4(1, 1, 1, 0.85),
    // Schnee ist langsam und wird deutlich weiter verweht als Regen.
    windFactor: 1.1,
    stretch: 1,
  },
  // Ash: slowest of all, warm-toned, drifts almost horizontally.
  ash: {
    rate: 700,
    minSize: 0.08,
    maxSize: 0.18,
    minSpeed: 0.8,
    maxSpeed: 2,
    color: new Color4(0.5, 0.4, 0.36, 0.7),
    // Asche schwebt fast waagerecht davon.
    windFactor: 1.6,
    stretch: 1,
  },
};

/**
 * A soft round blob, drawn once into a canvas. Beats shipping a texture:
 * the particle is a few pixels on screen anyway, and this keeps the
 * system free of asset dependencies.
 */
function makeParticleTexture(scene: Scene): Texture {
  const size = 32;
  const tex = new DynamicTexture('precipParticle', size, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

export class Precipitation {
  private readonly system: ParticleSystem;
  private readonly emitterNode: Mesh;
  private readonly boxEmitter: BoxParticleEmitter;
  private current: PrecipKind = 'none';
  private amount = 0;

  constructor(private readonly scene: Scene) {
    // An invisible node the emitter box hangs on, so moving the player is
    // a single transform instead of touching every particle.
    this.emitterNode = new Mesh('precipEmitter', scene);
    this.emitterNode.isVisible = false;
    this.emitterNode.isPickable = false;

    const ps = new ParticleSystem('precipitation', 8000, scene);
    ps.particleTexture = makeParticleTexture(scene);
    ps.emitter = this.emitterNode;
    // Flat box overhead — particles rain down through the player's area.
    const box = new BoxParticleEmitter();
    box.minEmitBox = new Vector3(-AREA, 0, -AREA);
    box.maxEmitBox = new Vector3(AREA, 0, AREA);
    ps.particleEmitterType = box;
    this.boxEmitter = box;

    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    // Precipitation must not light up the scene — additive blending would
    // make a downpour glow.
    ps.gravity = new Vector3(0, 0, 0); // fall speed comes from direction
    ps.minLifeTime = 1.2;
    ps.maxLifeTime = 2.4;
    ps.preWarmCycles = 60; // start mid-fall, not with an empty sky
    ps.preWarmStepOffset = 2;
    ps.start();
    this.system = ps;
    this.applyKind('rain');
    this.system.emitRate = 0;
  }

  /** Move the emitter with the player. */
  setPlayerPosition(x: number, y: number, z: number): void {
    this.emitterNode.position.set(x, y + SPAWN_HEIGHT, z);
  }

  private applyKind(kind: Exclude<PrecipKind, 'none'>): void {
    const s = SPECS[kind];
    const ps = this.system;
    ps.minSize = s.minSize;
    ps.maxSize = s.maxSize;
    ps.color1 = s.color;
    ps.color2 = s.color;
    ps.colorDead = new Color4(s.color.r, s.color.g, s.color.b, 0);
    ps.minEmitPower = s.minSpeed;
    ps.maxEmitPower = s.maxSpeed;
    // Lifetime has to cover the drop from SPAWN_HEIGHT, or fast rain
    // vanishes in mid-air above the player's head.
    ps.minLifeTime = SPAWN_HEIGHT / s.maxSpeed;
    ps.maxLifeTime = (SPAWN_HEIGHT + 6) / s.minSpeed;
  }

  /**
   * @param kind   what is falling
   * @param amount 0..1 strength (the wetness/blend ramp)
   * @param windX  wind direction X, already scaled by intensity
   * @param windZ  wind direction Z, already scaled by intensity
   */
  update(kind: PrecipKind, amount: number, windX: number, windZ: number): void {
    if (kind !== this.current) {
      this.current = kind;
      if (kind !== 'none') this.applyKind(kind);
    }
    this.amount = amount;

    if (kind === 'none' || amount <= 0.001) {
      this.system.emitRate = 0;
      return;
    }

    const s = SPECS[kind];
    this.system.emitRate = s.rate * amount;
    // Schräg fallende Tropfen brauchen länger nach unten — Lebensdauer an
    // der vertikalen Komponente ausrichten, sonst enden sie in der Luft.
    const tiltLen = Math.hypot(windX * s.windFactor, 1, windZ * s.windFactor);
    this.system.minLifeTime = (SPAWN_HEIGHT / s.maxSpeed) * tiltLen;
    this.system.maxLifeTime = ((SPAWN_HEIGHT + 6) / s.minSpeed) * tiltLen;

    // Fall direction: straight down plus the wind's sideways push. This is
    // GlobalWind's velocityOverLifetime, folded into the emit direction
    // because a Babylon ParticleSystem has no per-axis velocity module.
    //
    // NORMALISED on purpose: Babylon multiplies the direction by emitPower,
    // so an unnormalised vector scales the SPEED with the wind. At full
    // gale that made the drops leave at >100 m/s — 3800 particles alive and
    // not one of them on screen.
    const wx = windX * s.windFactor;
    const wz = windZ * s.windFactor;
    const dir = new Vector3(wx, -1, wz).normalize();
    this.system.direction1 = dir;
    this.system.direction2 = dir;

    // Rain reads as streaks along its travel; snow and ash stay round.
    if (s.stretch > 1) {
      const speed = (s.minSpeed + s.maxSpeed) / 2;
      const tilt = Math.hypot(wx, wz);
      // Faster and more wind-blown ⇒ longer streak.
      this.system.minScaleY = s.stretch * (1 + tilt / speed);
      this.system.maxScaleY = this.system.minScaleY;
    } else {
      this.system.minScaleY = 1;
      this.system.maxScaleY = 1;
    }
  }

  /** Direkter Zugriff aufs Partikelsystem — nur für Diagnose. */
  get systemRef(): ParticleSystem {
    return this.system;
  }

  /** Live counters for diagnosis. */
  get info(): Record<string, unknown> {
    return {
      kind: this.current,
      amount: this.amount,
      emitRate: this.system.emitRate,
      aktivePartikel: this.system.getActiveCount(),
      started: this.system.isStarted(),
      ready: this.system.isReady(),
      emitterY: this.emitterNode.position.y,
      texOk: !!this.system.particleTexture,
    };
  }

  /** Current emission, for the HUD. */
  get debugLine(): string {
    return `${this.current} ${this.amount.toFixed(2)} (${Math.round(this.system.emitRate as number)}/s)`;
  }

  dispose(): void {
    this.system.dispose();
    this.emitterNode.dispose();
  }
}
