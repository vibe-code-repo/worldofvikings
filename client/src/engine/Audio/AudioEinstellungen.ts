/**
 * Player audio settings: one master slider, a mute switch and one slider per
 * bus. Pure (no Babylon, no DOM): the panel edits it, `AudioEngine` listens.
 * Spielereinstellungen fuer den Ton: Gesamtlautstaerke, Stumm, ein Regler je Bus.
 *
 * Slider values are whole percents 0..100. 100 % on a bus slider is exactly
 * the shipped default of that bus (`BUS_VORGABE`), so a player who never
 * touches the sliders hears what they heard before this menu existed.
 *
 * Curve: the gain is the slider fraction SQUARED. Hearing is roughly
 * logarithmic; with a linear gain the whole audible change happens in the
 * lowest fifth of the slider and 50 % sounds hardly quieter than 100 %.
 * Squared, 50 % is 25 % of the amplitude (about -12 dB), which is what a
 * player expects from "half". 0 % is exactly 0, 100 % is exactly the default.
 */

/** Bus names, in step with `AudioBusName` in AudioManifest.ts (kept literal: no Babylon import here). */
export type AudioBus = 'ambience' | 'world' | 'ui' | 'music';

/** Default bus volumes (100 % on the slider). Used by `AudioEngine` as its default table. */
export const BUS_VORGABE: Readonly<Record<AudioBus, number>> = {
  ambience: 0.5,
  world: 0.6,
  ui: 0.8,
  // Matches the old GameAudio's combined loudness: 0.7 (master) x 0.16 (track) = 0.112.
  music: 0.112,
};

export const AUDIO_SPEICHER_SCHLUESSEL = 'wov-audio-v1';

export interface AudioWerte {
  /** Master slider, 0..100. */
  gesamt: number;
  /** Mute switch; keeps `gesamt` so un-muting restores the previous level. */
  stumm: boolean;
  /** Bus sliders, 0..100. */
  regler: Record<AudioBus, number>;
}

/** What the engine applies: master gain and one gain per bus, all 0..1. */
export interface AudioPegel {
  gesamt: number;
  bus: Record<AudioBus, number>;
}

export const AUDIO_VORGABEN: Readonly<AudioWerte> = {
  gesamt: 100,
  stumm: false,
  regler: { music: 100, ambience: 100, world: 100, ui: 100 },
};

export const AUDIO_BUSSE: readonly AudioBus[] = ['music', 'ambience', 'world', 'ui'];

function vorgabenKopie(): AudioWerte {
  return { gesamt: AUDIO_VORGABEN.gesamt, stumm: AUDIO_VORGABEN.stumm, regler: { ...AUDIO_VORGABEN.regler } };
}

/** Whole percent 0..100, or `undefined` for anything that is not a finite number. */
export function prozentOderNichts(wert: unknown): number | undefined {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) return undefined;
  return Math.max(0, Math.min(100, Math.round(wert)));
}

/** Slider percent to gain fraction (squared curve, see file header). */
export function reglerZuGain(prozent: number): number {
  const p = prozentOderNichts(prozent) ?? 0;
  return (p / 100) * (p / 100);
}

/**
 * Slider state to engine gains. `urlStumm` (`?mute=1`) beats everything that
 * is stored: the master gain is 0 no matter what the player saved.
 */
export function berechnePegel(werte: AudioWerte, urlStumm = false): AudioPegel {
  const gesamt = urlStumm || werte.stumm ? 0 : reglerZuGain(werte.gesamt);
  const bus = {} as Record<AudioBus, number>;
  for (const name of AUDIO_BUSSE) bus[name] = BUS_VORGABE[name] * reglerZuGain(werte.regler[name]);
  return { gesamt, bus };
}

/** Reads the stored value. Missing, broken or partly invalid data falls back per field to the defaults; never throws. */
export function liesAudioWerte(roh: string | null | undefined): AudioWerte {
  const werte = vorgabenKopie();
  if (!roh) return werte;
  let geparst: unknown;
  try {
    geparst = JSON.parse(roh);
  } catch {
    return werte;
  }
  if (typeof geparst !== 'object' || geparst === null || Array.isArray(geparst)) return werte;
  const feld = geparst as Record<string, unknown>;
  const gesamt = prozentOderNichts(feld.gesamt);
  if (gesamt !== undefined) werte.gesamt = gesamt;
  if (typeof feld.stumm === 'boolean') werte.stumm = feld.stumm;
  const regler = typeof feld.regler === 'object' && feld.regler !== null ? (feld.regler as Record<string, unknown>) : {};
  for (const name of AUDIO_BUSSE) {
    const wert = prozentOderNichts(Object.hasOwn(regler, name) ? regler[name] : undefined);
    if (wert !== undefined) werte.regler[name] = wert;
  }
  return werte;
}

/** The part of `Storage` this store needs; tests pass a fake, the game passes `localStorage`. */
export interface AudioSpeicher {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserSpeicher(): AudioSpeicher | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class AudioEinstellungen {
  private werte: AudioWerte;
  private readonly hoerer = new Set<(werte: Readonly<AudioWerte>) => void>();

  constructor(private readonly speicher: AudioSpeicher | null = browserSpeicher()) {
    let roh: string | null = null;
    try {
      roh = speicher?.getItem(AUDIO_SPEICHER_SCHLUESSEL) ?? null;
    } catch {
      roh = null;
    }
    this.werte = liesAudioWerte(roh);
  }

  get(): Readonly<AudioWerte> {
    return this.werte;
  }

  /**
   * Sets the master slider. Raising it above 0 while muted lifts the mute:
   * dragging the slider means "I want to hear something".
   */
  setzeGesamt(prozent: number): void {
    const wert = prozentOderNichts(prozent);
    if (wert === undefined) return;
    this.uebernehme({ ...this.werte, gesamt: wert, stumm: wert > 0 ? false : this.werte.stumm });
  }

  setzeStumm(stumm: boolean): void {
    this.uebernehme({ ...this.werte, stumm });
  }

  setzeBus(bus: AudioBus, prozent: number): void {
    const wert = prozentOderNichts(prozent);
    if (wert === undefined || !AUDIO_BUSSE.includes(bus)) return;
    this.uebernehme({ ...this.werte, regler: { ...this.werte.regler, [bus]: wert } });
  }

  zuruecksetzen(): void {
    this.uebernehme(vorgabenKopie());
  }

  /** Fires immediately with the current values, then on every change. */
  onChange(fn: (werte: Readonly<AudioWerte>) => void): () => void {
    this.hoerer.add(fn);
    fn(this.werte);
    return () => this.hoerer.delete(fn);
  }

  private uebernehme(neu: AudioWerte): void {
    this.werte = neu;
    try {
      this.speicher?.setItem(AUDIO_SPEICHER_SCHLUESSEL, JSON.stringify(neu));
    } catch {
      // Storage unavailable (private mode, quota): the values stay session-only.
    }
    for (const fn of this.hoerer) fn(this.werte);
  }
}

let gemeinsam: AudioEinstellungen | null = null;

/** The one store the game shares between the options panel and the audio engine. */
export function gemeinsameAudioEinstellungen(): AudioEinstellungen {
  gemeinsam ??= new AudioEinstellungen();
  return gemeinsam;
}
