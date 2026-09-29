/**
 * Die Töne der eigenen Umgebung an einer Stelle: Schritte (`EigeneSchritte`)
 * und Waldambiente (`WaldAmbiente`). `main.ts` erzeugt genau ein Objekt und ruft
 * je Frame `update(dt)`; alles Weitere (Untergrund, Dichte, Tageszeit) liest
 * es über die Getter selbst.
 */
import type { BodenQuelle } from '@wov/shared/src/worldgen/bodenMischung.js';
import type { AudioEngine } from './AudioEngine';
import { EigeneSchritte, type SchrittFigur } from './EigeneSchritte';
import { WaldAmbiente, weltZuQuelle, type WaldFigur, type WaldWelt } from './WaldAmbiente';

/** Was das Modul von der Welt braucht (`ClientWorld`). */
export type ToeneWelt = WaldWelt & { heightmaps: BodenQuelle };

export class WeltToene {
  private readonly schritte: EigeneSchritte;
  private readonly wald: WaldAmbiente;

  constructor(
    figur: () => (SchrittFigur & WaldFigur) | null,
    welt: () => ToeneWelt | null,
    licht: () => { timeOfDay: number },
    audio: () => AudioEngine | null,
  ) {
    this.schritte = new EigeneSchritte(figur, () => welt()?.heightmaps ?? null, audio);
    this.wald = new WaldAmbiente(figur, () => weltZuQuelle(welt()), () => licht().timeOfDay, audio);
  }

  update(dt: number): void {
    this.schritte.update(dt);
    this.wald.update(dt);
  }
}
