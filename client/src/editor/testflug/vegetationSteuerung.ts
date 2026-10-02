/**
 * The vegetation brush wired to the flight but free of DOM and scene: everything it touches comes in through
 * `VegetationAbh` (draft actions, settings, HUD, circle), so the tests drive it with fakes and count what it does.
 *
 * Der Bewuchs-Pinsel, an den Flug angeschlossen, aber ohne DOM und Szene.
 *
 * Life of a stroke: `druecken` starts it, `bewegen` adds stamps (`vegetationPinsel.ts`), `loslassen` writes ALL its
 * circles into the draft as ONE write and ONE undo step. While the button is down the circles of the stroke are
 * pending in memory (`strichKreise`); the preview reads draft + pending (`stand` changes with every circle), so the
 * plants vanish while painting. The draft is the only thing the preview and the save read; pending circles that are not
 * written (stroke refused) vanish from the preview again.
 */
import { VEGETATION_KREISE_MAX, type VegetationEntferntKreis } from '@wov/shared';
import type { VegetationAktionen } from './vegetationAktionen';
import { klemmeVegRadius, VegetationStrich } from './vegetationPinsel';
import { VegetationVerlauf } from './vegetationVerlauf';
import type { SchrittErgebnis } from './verlaufReihenfolge';
import { t } from '../i18n';

export interface VegetationAbh {
  aktionen: VegetationAktionen;
  einstellung(): { radius: number; nurBaeume: boolean };
  meldung(text: string): void;
  kreis: { zeige(x: number, z: number, r: number, gesperrt: boolean): void; verberge(): void };
  /** A stroke is now in the draft and in this history (the shared order of undo steps). */
  strichGemacht?(): void;
}

export class VegetationSteuerung {
  private strich: VegetationStrich | null = null;
  private readonly verlauf = new VegetationVerlauf();
  private zaehler = 0;
  private grenzeGemeldet = false;
  private weltrandGemeldet = false;

  constructor(private readonly abh: VegetationAbh) {}

  get strichOffen(): boolean {
    return this.strich !== null;
  }

  get kannRueckgaengig(): boolean {
    return this.verlauf.kannRueckgaengig;
  }

  /** The shared order drops the refused step from this history too. */
  verwirfRueckgaengig(): void {
    this.verlauf.verwerfeRueckgaengig();
  }

  get kannWiederholen(): boolean {
    return this.verlauf.kannWiederholen;
  }

  /** Changes with every pending circle and every end of a stroke / undo / redo (part of the preview's change marker). */
  get stand(): number {
    return this.zaehler;
  }

  /** Circles of the open stroke that are not in the draft yet (the preview adds them). */
  strichKreise(): readonly VegetationEntferntKreis[] {
    return this.strich?.kreise ?? [];
  }

  /** The circle under the pointer (red when the limit is reached); call while the tool is active. */
  vorschau(p: { x: number; z: number } | null, voll = false): void {
    if (!p) {
      this.abh.kreis.verberge();
      return;
    }
    this.abh.kreis.zeige(p.x, p.z, klemmeVegRadius(this.abh.einstellung().radius), voll);
  }

  verberge(): void {
    this.abh.kreis.verberge();
  }

  druecken(p: { x: number; z: number }): void {
    if (this.strich) return;
    const gelesen = this.abh.aktionen.lese();
    if (!gelesen.ok) {
      this.abh.meldung(gelesen.message);
      return;
    }
    this.strich = new VegetationStrich(gelesen.kreise);
    this.grenzeGemeldet = false;
    this.weltrandGemeldet = false;
    this.stempeln(p);
  }

  bewegen(p: { x: number; z: number }): void {
    if (!this.strich) return;
    this.stempeln(p);
  }

  private stempeln(p: { x: number; z: number }): void {
    const strich = this.strich;
    if (!strich) return;
    const e = this.abh.einstellung();
    const r = strich.bewegeZu(p, e.radius, e.nurBaeume);
    if (r.neu > 0) this.zaehler++;
    this.vorschau(p, strich.voll);
    if (strich.voll && !this.grenzeGemeldet) {
      this.grenzeGemeldet = true;
      this.abh.meldung(t('testflug.gelaende.vegetation.grenze', { max: VEGETATION_KREISE_MAX }));
    }
    if (strich.verworfen && !this.weltrandGemeldet) {
      this.weltrandGemeldet = true;
      this.abh.meldung(t('testflug.gelaende.vegetation.weltrand'));
    }
  }

  /** Mouse up: the stroke ends and becomes ONE write and ONE undo step. */
  loslassen(): void {
    const strich = this.strich;
    this.strich = null;
    if (!strich) return;
    const kreise = strich.kreise.map((k) => ({ ...k }));
    this.zaehler++;
    if (kreise.length === 0) return;
    const r = this.abh.aktionen.hinzufuegen(kreise);
    if (!r.ok) {
      this.abh.meldung(r.message);
      return;
    }
    this.verlauf.neu({ kreise });
    this.abh.strichGemacht?.();
    // The HUD shows ONE line: what stopped the stroke is said again in the closing line, not painted over.
    const zeilen = [t('testflug.gelaende.vegetation.strich_gespeichert', { n: kreise.length })];
    if (strich.voll) zeilen.push(t('testflug.gelaende.vegetation.grenze', { max: VEGETATION_KREISE_MAX }));
    if (strich.verworfen) zeilen.push(t('testflug.gelaende.vegetation.weltrand'));
    this.abh.meldung(zeilen.join(' '));
  }

  rueckgaengig(): boolean {
    return this.schritt('rueckgaengig') === 'ok';
  }

  /** Like `rueckgaengig`, but says WHY nothing happened ('nicht-moeglich': an open stroke, nothing to undo, a conflict). This brush has no lock. */
  rueckgaengigMitGrund(): SchrittErgebnis {
    return this.schritt('rueckgaengig');
  }

  wiederholen(): boolean {
    return this.schritt('wiederholen') === 'ok';
  }

  private schritt(art: 'rueckgaengig' | 'wiederholen'): SchrittErgebnis {
    // An open stroke is not torn (the mouse is still down).
    if (this.strich) return 'nicht-moeglich';
    let grund: string | null = null;
    const anwenden = (v: { kreise: readonly VegetationEntferntKreis[] }): boolean => {
      const r = art === 'rueckgaengig' ? this.abh.aktionen.entfernen(v.kreise) : this.abh.aktionen.hinzufuegen(v.kreise);
      if (!r.ok) grund = r.message;
      return r.ok;
    };
    const v = art === 'rueckgaengig' ? this.verlauf.rueckgaengig(anwenden) : this.verlauf.wiederholen(anwenden);
    this.zaehler++;
    if (!v) {
      if (grund !== null) {
        this.abh.meldung(grund);
        // The list changed under the steps: they refer to circles that are gone.
        if (art === 'rueckgaengig') this.verlauf.leeren();
      } else this.abh.meldung(t(art === 'rueckgaengig' ? 'testflug.gelaende.nichts_rueckgaengig' : 'testflug.gelaende.nichts_wiederholen'));
      return 'nicht-moeglich';
    }
    this.abh.meldung(t(art === 'rueckgaengig' ? 'testflug.gelaende.vegetation.rueckgaengig' : 'testflug.gelaende.vegetation.wiederholt', { n: v.kreise.length }));
    return 'ok';
  }

  /** Tool ended while the mouse may still be down (Esc, right click, tab change): the open stroke is finished, not dropped. */
  beenden(): void {
    this.loslassen();
    this.abh.kreis.verberge();
  }
}
