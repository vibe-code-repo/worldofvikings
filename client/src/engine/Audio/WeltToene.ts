/**
 * Die Töne der eigenen Umgebung an einer Stelle: Schritte (`EigeneSchritte`)
 * und Waldambiente (`WaldAmbiente`). `main.ts` erzeugt genau ein Objekt und ruft
 * je Frame `update(dt)`; alles Weitere (Untergrund, Dichte, Tageszeit, Regler)
 * liest es über die Getter selbst.
 */
import type { BodenQuelle } from '@wov/shared/src/worldgen/bodenMischung.js';
import type { AudioEngine } from './AudioEngine';
import { gemeinsameAudioEinstellungen, type AudioWerte } from './AudioEinstellungen';
import { EigeneSchritte, type SchrittFigur } from './EigeneSchritte';
import { WaldAmbiente, weltZuQuelle, type WaldFigur, type WaldWelt } from './WaldAmbiente';

/** Was das Modul von der Welt braucht (`ClientWorld`). */
export type ToeneWelt = WaldWelt & { heightmaps: BodenQuelle };

/** Umgebung nicht hörbar gewollt: Regler Umgebung, Gesamtregler 0 oder stumm. */
export function umgebungAus(w: Readonly<AudioWerte>): boolean {
  return w.stumm || w.gesamt === 0 || w.regler.ambience === 0;
}

export class WeltToene {
  private readonly schritte: EigeneSchritte;
  private readonly wald: WaldAmbiente;

  constructor(
    figur: () => (SchrittFigur & WaldFigur) | null,
    welt: () => ToeneWelt | null,
    licht: () => { timeOfDay: number },
    audio: () => AudioEngine | null,
    einstellungen: { get(): Readonly<AudioWerte> } = gemeinsameAudioEinstellungen(),
  ) {
    this.schritte = new EigeneSchritte(figur, () => welt()?.heightmaps ?? null, audio);
    this.wald = new WaldAmbiente(figur, () => weltZuQuelle(welt()), () => licht().timeOfDay, audio, undefined, () => umgebungAus(einstellungen.get()));
  }

  update(dt: number): void {
    this.schritte.update(dt);
    this.wald.update(dt);
  }
}
