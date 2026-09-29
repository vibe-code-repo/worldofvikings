/**
 * Kampftöne (Karte kampf-toene): Schwung im Moment des Hiebs, Treffer und
 * Parade nach der Bestätigung des Servers.
 *
 * - Schwung: `schlag()` läuft beim Klick los, der Ton kommt aber erst zum
 *   Hiebzeitpunkt des Clips (`SCHWUNG_VERZUG_S`, die Hand-Maxima der drei
 *   Schwerthiebe). Ein neuer Klick setzt den Hieb von vorn an und verwirft
 *   den wartenden Ton; beim Auslösen muss der Schlag noch laufen.
 * - Treffer/Parade: einzige Quelle ist das Paket `HitEffect` des Servers
 *   (`art` 0 Ernte, 1 Fleisch, 2 Parade). Ohne Serverpaket kein Ton.
 *
 * Kein Babylon, keine Web-Audio-API: Figur, Waffe, Uhr und Ton-Engine kommen
 * als Funktionen herein (Test ohne Browser).
 *
 * Sword swing sound at the moment of the blow, hit and parry sounds only on
 * the server's `HitEffect` packet.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AudioEngine } from './AudioEngine';

export type Waffensatz = 'schwert' | 'stab' | 'speer' | 'faust';

/** Sekunden vom Klick bis zur Hand-Spitze des Hiebs 1/2/3 (Tempo 2,5). */
export const SCHWUNG_VERZUG_S: readonly number[] = [0.28, 0.4, 0.68];

export const GRUPPE_SCHWUNG = 'combat/slash';
export const GRUPPE_SCHWUNG_SCHWER = 'combat/slash-heavy';
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

/** Ein Treffer dieser Spanne nach dem eigenen Klick gilt als der eigene. */
export const EIGENER_TREFFER_FENSTER_S = 1.5;
/** … und nur so nah an der Figur (Schlagreichweite, waagerecht). */
export const EIGENER_TREFFER_REICHWEITE = 6;
/** Ein Treffer so dicht an der Figur trifft SIE (Kreaturenbiss, Parade). */
export const AUF_MICH_RADIUS = 0.8;

/** Schwunggruppe des Hiebs `hieb` (0…) im Satz; null = kein Schwungton. */
export function schwungGruppe(satz: Waffensatz, hieb: number): string | null {
  if (satz !== 'schwert') return null;
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
  readonly avatar: { readonly schlaegt: boolean; readonly letzterHieb: number };
}

export class KampfToene {
  private wartend: unknown = null;
  private letzterSatz: Waffensatz | null = null;
  private letzterHieb = 0;
  private letzterKlick = -Infinity;

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
    this.letzterSatz = satz;
    this.letzterHieb = hieb;
    this.letzterKlick = this.uhr.jetzt();
    if (this.wartend !== null) this.uhr.loesche(this.wartend);
    this.wartend = null;
    const verzug = SCHWUNG_VERZUG_S[hieb] ?? 0.3;
    if (bogen) this.uhr.setze(bogen, verzug * 1000);
    const gruppe = schwungGruppe(satz, hieb);
    if (gruppe === null) return;
    const handle = this.uhr.setze(() => {
      if (this.wartend !== handle) return;
      this.wartend = null;
      const f = this.figur();
      // Der Hieb muss noch laufen und noch DER Hieb sein.
      if (!f || !f.avatar.schlaegt || f.avatar.letzterHieb !== hieb) return;
      this.spiele(gruppe, f.position);
    }, verzug * 1000);
    this.wartend = handle;
  }

  /** Serverpaket `HitEffect`: Ort und Art des Treffers. */
  treffer(pos: { x: number; y: number; z: number }, art: number): void {
    const f = this.figur();
    const abstand = f ? Math.hypot(pos.x - f.position.x, pos.z - f.position.z) : Infinity;
    const eigen =
      f !== null &&
      abstand <= EIGENER_TREFFER_REICHWEITE &&
      this.uhr.jetzt() - this.letzterKlick <= EIGENER_TREFFER_FENSTER_S;
    const aufMich = abstand <= AUF_MICH_RADIUS;
    let gruppe: string | null = null;
    if (art === TREFFER_FLEISCH) {
      gruppe = GRUPPE_FLEISCH;
      if (eigen && !aufMich) {
        if (this.letzterSatz === 'faust') gruppe = GRUPPE_FAUST;
        else if (this.letzterSatz === 'speer') gruppe = GRUPPE_FLEISCH_STICH;
        else if (this.letzterSatz === 'stab' || (this.letzterSatz === 'schwert' && this.letzterHieb >= 2)) {
          gruppe = GRUPPE_FLEISCH_WUCHT;
        }
      }
    } else if (art === TREFFER_PARADE) {
      gruppe = aufMich ? paradeGruppe(this.waffe()) : GRUPPE_PARADE_METALL;
    } else if (art === TREFFER_ERNTE && eigen) {
      // Der Server verlangt für Holz die Axt, für Stein die Spitzhacke.
      const w = this.waffe();
      gruppe = w === 'AxeFlint' ? GRUPPE_HOLZ : w === 'PickaxeAntler' ? GRUPPE_METALL : null;
    }
    if (gruppe !== null) this.spiele(gruppe, pos);
  }

  private spiele(gruppe: string, pos: { x: number; y: number; z: number }): void {
    const audio = this.audio();
    if (!audio) return;
    void audio.playAsync('world', gruppe, { position: new Vector3(pos.x, pos.y, pos.z) });
  }
}
