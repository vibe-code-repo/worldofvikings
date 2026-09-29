/**
 * Waldambiente: Vogelzwitschern im dichten Wald bei Tag, leiser Wind im Wald
 * bei Nacht. Eine Aufrufstelle, `update(dt)` je Frame (Muster `EigeneSchritte`).
 *
 * Die Rechnung ist rein (kein Babylon, keine Audio-API), damit sie ohne Browser
 * prüfbar ist:
 *
 *   Bäume im Umkreis (shared `baeumeImUmkreis`, alle 0,5 s)
 *     → Stufe 0..1 (`waldStufe`, Smoothstep zwischen WALD_VON und WALD_VOLL)
 *     → Glättung über ~1 s
 *     → mal Tagesanteil (Vögel) bzw. Nachtanteil (Wind)
 *     → Pegel wandert linear mit höchstens 1/RAMPE_S je Sekunde zum Ziel
 *     → Lautstärke = Pegel² (dieselbe Kurve wie die Regler im Reiter „Ton“).
 *
 * Tag/Nacht: `tagesAnteil` ist der Tagseitenanteil der Umgebung
 * (`tagseitenAnteil` aus shared/environment, 1 ab Sonnenstand 0,4, 0,2 am
 * Horizont, 0 ab −0,1). So singen die Vögel schon im Morgengrauen leise und
 * hören nach Sonnenuntergang bald auf; der Nachtwind ist das Gegenstück
 * (1 − Tagesanteil). Eine einfache Regel statt zweier Uhren.
 *
 * Aus: im Dungeon und unter Wasser (Wassertiefe über Knie). Offenes Gelände
 * ist still (das Grundrauschen `emitters/wind-open-ground` bleibt weg: 5,9 s
 * lang mit hörbarem Sprung an der Schleifennaht, siehe Bericht).
 *
 * Läuft auf dem Bus `ambience`; der Regler „Umgebung“ und `?mute=1` wirken dort.
 * B3 (Ton je Region) kann die Grenzen/Gruppen später je Region überschreiben:
 * alles steht in `WaldAmbienteWerte`.
 */
import { WATER_LEVEL, elevationFactor, tagseitenAnteil } from '@wov/shared';
import { baeumeImUmkreis, waldStufe, type WaldQuelle } from '@wov/shared/src/worldgen/waldDichte.js';

/** Gruppen im `toene`-Manifest (Bus `ambience`). */
export const GRUPPE_VOEGEL = 'ambience/forest-birds';
export const GRUPPE_WIND = 'ambience/forest-wind-gusts';

export interface WaldAmbienteWerte {
  /** Unter so vielen erwarteten Bäumen im 40-m-Umkreis: still. */
  von: number;
  /** Ab so vielen: volle Stufe. */
  voll: number;
  /** Höchste Lautstärke der Vögel (Schleife, vor Bus und Regler). */
  vogelMax: number;
  /** Höchste Lautstärke des Nachtwinds. */
  windMax: number;
}

/**
 * `von`/`voll` aus der Messung (shared/test/wald-dichte.ts, dev.json, 160 Punkte,
 * R 40 m): E < 3 → nie ein Baum; ab E ≈ 100 im Mittel 30+ gezählte Bäume im Kreis.
 */
export const WALD_WERTE: Readonly<WaldAmbienteWerte> = { von: 20, voll: 150, vogelMax: 1, windMax: 0.6 };

/** Zeit für 0 → 1 des Pegels (s). */
export const RAMPE_S = 2.5;
/** Zeitkonstante der Glättung der Stufe (s). */
export const GLAETTUNG_S = 1;
/** So oft wird die Dichte gerechnet (s). */
export const DICHTE_TAKT_S = 0.5;
/** Wassertiefe, ab der still ist (m), wie bei den Schritten die Knietiefe. */
export const WASSER_AUS_M = 0.5;
/** So lange bei Ziel 0 und Pegel 0, dann wird die Schleife angehalten (s). */
export const ANHALTEN_NACH_S = 10;
/** Eine Schleife wird erst geladen, wenn ihr Zielpegel diese Schwelle übersteigt (Gain 1e-4, ≈ −80 dB). */
export const START_MIN = 0.01;

/** Tagesanteil 0..1 aus der Tageszeit (Bruchteil des Tages, 0,5 = Mittag). */
export function tagesAnteil(tageszeit: number): number {
  return tagseitenAnteil(elevationFactor(tageszeit));
}

/**
 * Zielpegel (0..1, vor der Quadratkurve und vor dem Höchstwert der Schleife)
 * aus geglätteter Stufe und Tageszeit. Gleichleistungs-Überblendung: die
 * Lautstärken (Pegel²) sind Stufe²·sin bzw. Stufe²·cos des Tagesanteils, ihre
 * Quadratsumme bleibt beim Wechsel Wind ↔ Vögel gleich (keine Senke in der
 * Dämmerung). `aus` (wiederverwendet) verhindert eine Allokation je Bild.
 */
export function zielPegel(stufe: number, tageszeit: number, aus: { vogel: number; wind: number } = { vogel: 0, wind: 0 }): { vogel: number; wind: number } {
  const tag = tagesAnteil(tageszeit);
  const winkel = tag * (Math.PI / 2);
  aus.vogel = stufe * Math.sqrt(Math.sin(winkel));
  aus.wind = tag >= 1 ? 0 : stufe * Math.sqrt(Math.cos(winkel)); // cos(π/2) ist in Gleitkomma nicht 0
  return aus;
}

/** Pegel → Lautstärke der Schleife (Quadratkurve wie `reglerZuGain`), mal Höchstwert. */
export function pegelZuLautstaerke(pegel: number, max: number): number {
  return pegel * pegel * max;
}

/** Läuft `wert` auf `ziel` zu, höchstens `rate · dt` weit (linear). */
export function rampe(wert: number, ziel: number, rate: number, dt: number): number {
  const schritt = rate * dt;
  return ziel > wert ? Math.min(ziel, wert + schritt) : Math.max(ziel, wert - schritt);
}

/** Was das Modul von der Figur braucht. */
export interface WaldFigur {
  readonly position: { x: number; y: number; z: number };
  readonly dungeonMode: boolean;
}

/** Eine laufende Schleife der Ton-Engine. */
export interface SchleifenHandle {
  volume: number;
  stop(): void;
}

/** Was das Modul von der Ton-Engine braucht (`AudioEngine`). */
export interface AmbienteAudio {
  startLoopAsync(bus: 'ambience', group: string): Promise<SchleifenHandle | null>;
  /** Hörprobe-Zeuge: das Modul legt hier seinen Zustand ab. */
  readonly diagnose?: Record<string, unknown>;
}

interface Schleife {
  gruppe: string;
  handle: SchleifenHandle | null;
  wartet: boolean;
  naechsterVersuch: number;
  /** Zeitpunkt, ab dem Ziel und Pegel 0 sind (−1: nicht 0). */
  nullSeit: number;
  pegel: number;
  lautstaerke: number;
}

export class WaldAmbiente {
  private zeit = 0;
  private naechsteDichte = 0;
  private baeume = 0;
  private stufeZiel = 0;
  private stufe = 0;
  private readonly vogel: Schleife = { gruppe: GRUPPE_VOEGEL, handle: null, wartet: false, naechsterVersuch: 0, nullSeit: -1, pegel: 0, lautstaerke: 0 };
  private readonly wind: Schleife = { gruppe: GRUPPE_WIND, handle: null, wartet: false, naechsterVersuch: 0, nullSeit: -1, pegel: 0, lautstaerke: 0 };
  private readonly ziel = { vogel: 0, wind: 0 };
  private readonly diag = { baeume: 0, stufe: 0, vogelPegel: 0, vogelLautstaerke: 0, windPegel: 0, windLautstaerke: 0, vogelLaeuft: false, windLaeuft: false };

  constructor(
    private readonly figur: () => WaldFigur | null,
    private readonly quelle: () => WaldQuelle | null,
    private readonly tageszeit: () => number,
    private readonly audio: () => AmbienteAudio | null,
    private readonly werte: Readonly<WaldAmbienteWerte> = WALD_WERTE,
  ) {}

  update(dt: number): void {
    this.zeit += dt;
    const f = this.figur();
    const audio = this.audio();
    if (!f || !audio) return;

    if (this.zeit >= this.naechsteDichte) {
      this.naechsteDichte = this.zeit + DICHTE_TAKT_S;
      const q = this.quelle();
      const still = !q || f.dungeonMode || WATER_LEVEL - f.position.y > WASSER_AUS_M;
      this.baeume = q && !still ? baeumeImUmkreis(f.position.x, f.position.z, q) : 0;
      this.stufeZiel = waldStufe(this.baeume, this.werte.von, this.werte.voll);
    }
    this.stufe += (this.stufeZiel - this.stufe) * (1 - Math.exp(-dt / GLAETTUNG_S));
    if (this.stufeZiel === 0 && this.stufe < 1e-3) this.stufe = 0; // die Glättung erreicht 0 nie von selbst

    const ziel = zielPegel(this.stufe, this.tageszeit(), this.ziel);
    this.fahre(this.vogel, ziel.vogel, this.werte.vogelMax, dt, audio);
    this.fahre(this.wind, ziel.wind, this.werte.windMax, dt, audio);

    const d = audio.diagnose;
    if (d) {
      const w = this.diag;
      w.baeume = this.baeume;
      w.stufe = this.stufe;
      w.vogelPegel = this.vogel.pegel;
      w.vogelLautstaerke = this.vogel.lautstaerke;
      w.windPegel = this.wind.pegel;
      w.windLautstaerke = this.wind.lautstaerke;
      w.vogelLaeuft = this.vogel.handle !== null;
      w.windLaeuft = this.wind.handle !== null;
      d.wald = w;
    }
  }

  private fahre(s: Schleife, ziel: number, max: number, dt: number, audio: AmbienteAudio): void {
    s.pegel = rampe(s.pegel, ziel, 1 / RAMPE_S, dt);
    s.lautstaerke = pegelZuLautstaerke(s.pegel, max);
    if (ziel === 0 && s.pegel === 0) {
      if (s.nullSeit < 0) s.nullSeit = this.zeit;
      // Lange still (Wiese, Regler Umgebung 0): Schleife anhalten; bei Bedarf startet sie neu, bei Lautstärke 0.
      if (s.handle && this.zeit - s.nullSeit >= ANHALTEN_NACH_S) {
        s.handle.stop();
        s.handle = null;
      }
    } else s.nullSeit = -1;
    if (!s.handle) {
      // Erst laden, wenn die Schleife gebraucht wird (Vögel: 203 s Stereo, ~78 MB dekodiert).
      if (ziel > START_MIN && !s.wartet && this.zeit >= s.naechsterVersuch) {
        s.wartet = true;
        void audio.startLoopAsync('ambience', s.gruppe).then(
          (h) => {
            s.wartet = false;
            if (h) {
              h.volume = s.lautstaerke;
              s.handle = h;
            } else s.naechsterVersuch = this.zeit + 1; // vor dem Entsperren oder stumm: später wieder
          },
          () => {
            s.wartet = false;
            s.naechsterVersuch = this.zeit + 5;
          },
        );
      }
      return;
    }
    s.handle.volume = s.lautstaerke;
  }
}

/** Was `main.ts` an Welt hat (`ClientWorld`); nur die zwei Funktionen, die die Dichte braucht. */
export interface WaldWelt {
  geo: { getForestFactor(x: number, z: number): number };
  /** Höhe und Normale wie in der Streuung (`getZoneAt(...).getWorldNormal`). */
  heightmaps?: {
    getGroundHeight(x: number, z: number): number;
    getZoneAt(x: number, z: number): { getWorldNormal(x: number, z: number): { y: number } | null };
  };
  regionGeo: { regionAt(x: number, z: number): { vegetation?: readonly string[]; bewuchsDichte?: number } | null } | null;
}

const quellen = new WeakMap<WaldWelt, WaldQuelle>();

/** Dichtequelle einer Welt; ohne Layout (Radialwelt) gibt es keine Region und damit keinen Baum. */
export function weltZuQuelle(welt: WaldWelt | null | undefined): WaldQuelle | null {
  if (!welt) return null;
  let q = quellen.get(welt);
  if (!q) {
    const region = welt.regionGeo;
    const hm = welt.heightmaps;
    q = {
      getForestFactor: (x, z) => welt.geo.getForestFactor(x, z),
      regionAt: region ? (x, z) => region.regionAt(x, z) : undefined,
      gelaende: hm
        ? (x, z, aus) => {
            aus.hoehe = hm.getGroundHeight(x, z);
            aus.normalY = hm.getZoneAt(x, z).getWorldNormal(x, z)?.y ?? 1;
          }
        : undefined,
    };
    quellen.set(welt, q);
  }
  return q;
}
