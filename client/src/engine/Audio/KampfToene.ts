/**
 * Kampftöne (Karte kampf-toene): Schwung im Moment des Hiebs, Treffer und
 * Parade nach der Bestätigung des Servers.
 *
 * - Schwung: `schlag()` läuft beim Klick los, der Ton kommt aber erst zum
 *   Hiebzeitpunkt des Clips (`avatar.hiebSpitzeS`, aus dem echten Clip-Tempo
 *   des Rigs; ohne Angabe die Tabelle `SCHWUNG_VERZUG_S`). Ein neuer Klick
 *   setzt den Hieb von vorn an und verwirft den wartenden Ton; beim
 *   Auslösen muss der Schlag noch laufen, die Waffe dieselbe und die Figur
 *   am Ort geblieben sein (Tod/Teleport/Instanzwechsel).
 * - Treffer/Parade: einzige Quelle ist das Paket `HitEffect` des Servers
 *   (`art` 0 Ernte, 1 Fleisch, 2 Parade) samt Angabe „der Angreifer bist
 *   du“ (`eigen`, vom Server je Empfänger geschrieben). Ohne Serverpaket kein
 *   Ton. Der Server meldet beim Klick; ein eigener Schwerttreffer klingt erst
 *   zum Hiebzeitpunkt des Hiebs, zu dem er gehört (nächster Hiebzeitpunkt);
 *   ist der schon vorbei, sofort — nie auf einen späteren Hieb verschoben.
 *
 * Kein Babylon, keine Web-Audio-API: Figur, Waffe, Uhr und Ton-Engine kommen
 * als Funktionen herein (Test ohne Browser).
 *
 * Sword swing sound at the moment of the blow, hit and parry sounds only on
 * the server's `HitEffect` packet (which says whether you are the attacker).
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LAUF_TEMPO } from '@wov/shared/src/bewegung/masse.js';
import type { AudioEngine } from './AudioEngine';

export type Waffensatz = 'schwert' | 'stab' | 'speer' | 'faust';

/**
 * Stab, Speer, Faust: späteste Hiebspitze (s). Die Rohzeiten von `hiebSpitzeS`
 * sind die des Schwerts; Hieb 3 dieser Ketten meldete damit 1,13 s, sein Clip
 * endet aber nach 0,97 s (Stab) bzw. 1,06 s (Tritt), im Browser gemessen — der
 * Ton wäre verfallen. 0,66 s
 * = Spitze von Schwert-Hieb 3 bei gleicher Clip-Länge (geschätzt, nicht an
 * der Hand gemessen).
 */
export const ANDERE_SPITZE_MAX_S = 0.66;

/** Rückfall, wenn die Figur keine Hiebzeit meldet: Sekunden bis zur Spitze von Hieb 1/2/3 (Tempo 2,5). */
export const SCHWUNG_VERZUG_S: readonly number[] = [0.28, 0.4, 0.68];

export const GRUPPE_SCHWUNG = 'combat/slash';
export const GRUPPE_SCHWUNG_SCHWER = 'combat/slash-heavy';
/** Faustschwung: luftiges Rauschen ohne Metall, leiser als `slash` (2 Klips). */
export const GRUPPE_SCHWUNG_FAUST = 'combat/fist-swing';
export const GRUPPE_FLEISCH = 'combat/sword-flesh';
export const GRUPPE_FLEISCH_WUCHT = 'combat/sword-impact-flesh';
export const GRUPPE_FLEISCH_STICH = 'combat/sword-stab-flesh';
export const GRUPPE_FAUST = 'combat/punch';
export const GRUPPE_HOLZ = 'combat/sword-wood';
export const GRUPPE_METALL = 'combat/sword-metal';
export const GRUPPE_PARADE_METALL = 'combat/shield-metal';
export const GRUPPE_PARADE_HOLZ = 'combat/shield-wood';

/** Alle Gruppen, die das Modul je anspielt (Test gegen das Manifest). */
export const KAMPF_GRUPPEN: readonly string[] = [
  GRUPPE_SCHWUNG,
  GRUPPE_SCHWUNG_SCHWER,
  GRUPPE_SCHWUNG_FAUST,
  GRUPPE_FLEISCH,
  GRUPPE_FLEISCH_WUCHT,
  GRUPPE_FLEISCH_STICH,
  GRUPPE_FAUST,
  GRUPPE_HOLZ,
  GRUPPE_METALL,
  GRUPPE_PARADE_METALL,
  GRUPPE_PARADE_HOLZ,
];

/** `HitEffect.art` des Servers (WovServer.sendeTrefferEffekt). */
export const TREFFER_ERNTE = 0;
export const TREFFER_FLEISCH = 1;
export const TREFFER_PARADE = 2;

/** Ein Treffer so dicht an der Figur trifft SIE (eigene Parade). */
export const AUF_MICH_RADIUS = 0.8;
/**
 * Ein wartender Ton verfällt, wenn die Figur sich seit dem Klick weiter
 * bewegt hat, als sie laufen kann (Tod, Teleport): Höchsttempo × verstrichene
 * Zeit + Rand. Eine feste Grenze (früher 4 m) verschluckte beim Sprint
 * (7,5 m/s) den dritten Hieb nach 0,68 s = 5,1 m.
 */
export const HOECHSTTEMPO = LAUF_TEMPO;
/** Rand auf die mögliche Strecke (Bildtakt, Serverkorrektur), in m. */
export const ORTSRAND_M = 1;

/** Größte Strecke (m), die die Figur in `dt` Sekunden zu Fuß schaffen kann. */
export function moeglicheStrecke(dt: number): number {
  return HOECHSTTEMPO * Math.max(0, dt) + ORTSRAND_M;
}
/** Angemeldete Hiebe älter als das (s) nach ihrer Spitze zählen nicht mehr. */
const HIEB_MERKZEIT_S = 2;

/**
 * Schwunggruppe des Hiebs `hieb` (0…) im Satz mit der Waffe `waffe`. Es gibt
 * nur die Aufnahmen `slash`, `slash-heavy`, `fist-swing`, also entscheidet die
 * Wucht: Klinge/Axt leicht, der dritte Hieb schwer; Stab und Keule (Holz,
 * beidhändig, schwer geführt; der Stab `Staff` trägt im Katalog den Speer-Satz,
 * darum zählt hier die Waffe) immer schwer; Speer (Stich, schnell) leicht.
 * Faust: eigene, leisere Luftaufnahme `fist-swing` (die `punch`-Aufnahmen sind
 * Aufprall und haben vor dem Schlag nur -45 dB Luft); `punch` bleibt der Treffer.
 */
export function schwungGruppe(satz: Waffensatz, hieb: number, waffe = ''): string {
  if (satz === 'faust') return GRUPPE_SCHWUNG_FAUST;
  if (satz === 'stab' || waffe === 'Club' || waffe === 'Staff') return GRUPPE_SCHWUNG_SCHWER;
  if (satz === 'speer') return GRUPPE_SCHWUNG;
  return hieb >= 2 ? GRUPPE_SCHWUNG_SCHWER : GRUPPE_SCHWUNG;
}

/** Parade-Ton nach Waffe: Holzwaffen dumpf, alles andere Metall. */
export function paradeGruppe(waffe: string): string {
  return waffe === 'Club' || waffe === 'Staff' ? GRUPPE_PARADE_HOLZ : GRUPPE_PARADE_METALL;
}

export interface Uhr {
  jetzt(): number;
  setze(fn: () => void, ms: number): unknown;
  loesche(handle: unknown): void;
}

export const ECHTE_UHR: Uhr = {
  jetzt: () => performance.now() / 1000,
  setze: (fn, ms) => setTimeout(fn, ms),
  loesche: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface KampfFigur {
  readonly position: { x: number; y: number; z: number };
  readonly avatar: {
    readonly schlaegt: boolean;
    readonly letzterHieb: number;
    /** Sekunden vom Schlagstart bis zur Spitze des laufenden Hiebs (NaN = unbekannt). */
    readonly hiebSpitzeS: number;
  };
}

/** Ein angemeldeter eigener Schlag. */
interface Hieb {
  satz: Waffensatz;
  hieb: number;
  /** Uhrzeit des Klicks. */
  start: number;
  /** Uhrzeit, zu der der Hieb seine Spitze erreicht. */
  spitze: number;
  waffe: string;
  x: number;
  z: number;
}

export class KampfToene {
  private wartend: unknown = null;
  private readonly hiebe: Hieb[] = [];
  private readonly zurueckgehalten = new Set<unknown>();

  constructor(
    private readonly audio: () => AudioEngine | null,
    private readonly figur: () => KampfFigur | null,
    private readonly waffe: () => string,
    private readonly uhr: Uhr = ECHTE_UHR,
  ) {}

  /**
   * Der eigene Schlag wurde angestoßen (`AvatarRig.schlage` gab true).
   * `bogen` läuft nach demselben Verzug (Slash-Halbmond), unabhängig vom Ton.
   */
  schlag(satz: Waffensatz, hieb: number, bogen?: () => void): void {
    const jetzt = this.uhr.jetzt();
    const f = this.figur();
    const gemeldet = f?.avatar.hiebSpitzeS ?? NaN;
    let verzug = Number.isFinite(gemeldet) && gemeldet > 0 ? gemeldet : (SCHWUNG_VERZUG_S[hieb] ?? 0.3);
    if (satz !== 'schwert') verzug = Math.min(verzug, ANDERE_SPITZE_MAX_S);
    if (this.wartend !== null) this.uhr.loesche(this.wartend);
    this.wartend = null;
    const eintrag: Hieb = {
      satz,
      hieb,
      start: jetzt,
      spitze: jetzt + verzug,
      waffe: this.waffe(),
      x: f?.position.x ?? 0,
      z: f?.position.z ?? 0,
    };
    this.hiebe.push(eintrag);
    while (this.hiebe.length > 0 && this.hiebe[0]!.spitze < jetzt - HIEB_MERKZEIT_S) this.hiebe.shift();
    if (bogen) this.uhr.setze(bogen, verzug * 1000);
    const gruppe = schwungGruppe(satz, hieb, eintrag.waffe);
    const handle = this.uhr.setze(() => {
      if (this.wartend !== handle) return;
      this.wartend = null;
      const g = this.figur();
      // Der Hieb muss noch laufen, noch DER Hieb sein, mit derselben Waffe, am selben Ort.
      if (!g || !g.avatar.schlaegt || g.avatar.letzterHieb !== hieb || !this.unveraendert(eintrag, g)) return;
      this.spiele(gruppe, g.position);
    }, verzug * 1000);
    this.wartend = handle;
  }

  /**
   * Serverpaket `HitEffect`: Ort und Art des Treffers; `eigen` = der Server
   * nennt DICH als Angreifer (fehlt das Feld: false, wie ein fremder Treffer).
   */
  treffer(pos: { x: number; y: number; z: number }, art: number, eigen = false): void {
    const f = this.figur();
    const abstand = f ? Math.hypot(pos.x - f.position.x, pos.z - f.position.z) : Infinity;
    const h = eigen ? this.zuordnen() : null;
    let gruppe: string | null = null;
    if (art === TREFFER_FLEISCH) {
      gruppe = GRUPPE_FLEISCH;
      if (h) {
        if (h.satz === 'faust') gruppe = GRUPPE_FAUST;
        else if (h.satz === 'speer') gruppe = GRUPPE_FLEISCH_STICH;
        else if (h.satz === 'stab' || (h.satz === 'schwert' && h.hieb >= 2)) gruppe = GRUPPE_FLEISCH_WUCHT;
      }
    } else if (art === TREFFER_PARADE) {
      gruppe = abstand <= AUF_MICH_RADIUS ? paradeGruppe(this.waffe()) : GRUPPE_PARADE_METALL;
    } else if (art === TREFFER_ERNTE && eigen) {
      // Der Server verlangt für Holz die Axt, für Stein die Spitzhacke.
      const w = this.waffe();
      gruppe = w === 'AxeFlint' ? GRUPPE_HOLZ : w === 'PickaxeAntler' ? GRUPPE_METALL : null;
    }
    if (gruppe === null) return;
    // Der Server bestätigt beim Klick, der Hieb erreicht das Ziel aber erst
    // im Clip: der eigene Schwerttreffer klingt zum Hiebzeitpunkt, nicht davor.
    const rest = h && h.satz === 'schwert' ? h.spitze - this.uhr.jetzt() : 0;
    if (rest > 0.005 && h && f) {
      const ort = { x: pos.x, y: pos.y, z: pos.z };
      const handle = this.uhr.setze(() => {
        this.zurueckgehalten.delete(handle);
        const g = this.figur();
        if (g && this.unveraendert(h, g)) this.spiele(gruppe, ort);
      }, rest * 1000);
      this.zurueckgehalten.add(handle);
    } else {
      this.spiele(gruppe, pos);
    }
  }

  /** Alle wartenden Töne verwerfen (Instanzwechsel, Teleport, Verbindungsende). */
  abbrechen(): void {
    if (this.wartend !== null) this.uhr.loesche(this.wartend);
    this.wartend = null;
    for (const h of this.zurueckgehalten) this.uhr.loesche(h);
    this.zurueckgehalten.clear();
    this.hiebe.length = 0;
  }

  dispose(): void {
    this.abbrechen();
  }

  /** Der eigene Schlag mit der gehaltenen Waffe, dessen Hiebzeitpunkt jetzt am nächsten liegt (schon vorbei zählt gleich). */
  private zuordnen(): Hieb | null {
    const jetzt = this.uhr.jetzt();
    let best: Hieb | null = null;
    const waffe = this.waffe();
    for (const h of this.hiebe) {
      // Nur Schläge mit der Waffe, die jetzt in der Hand liegt (Waffenwechsel im Fenster).
      if (h.waffe !== waffe) continue;
      if (best === null || Math.abs(h.spitze - jetzt) < Math.abs(best.spitze - jetzt)) best = h;
    }
    return best;
  }

  private unveraendert(h: Hieb, f: KampfFigur): boolean {
    // Nur was die Figur seit dem Klick laufen konnte zählt; mehr ist Tod/Teleport.
    const dt = this.uhr.jetzt() - h.start;
    return this.waffe() === h.waffe && Math.hypot(f.position.x - h.x, f.position.z - h.z) <= moeglicheStrecke(dt);
  }

  private spiele(gruppe: string, pos: { x: number; y: number; z: number }): void {
    const audio = this.audio();
    if (!audio) return;
    void audio.playAsync('world', gruppe, { position: new Vector3(pos.x, pos.y, pos.z) });
  }
}
