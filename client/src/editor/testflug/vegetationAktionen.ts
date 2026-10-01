/**
 * What the test flight does to the `vegetationEntfernt` list of the draft: add the circles of a stroke or take them out
 * again, each as ONE write (`persistenz.aendern`, the same whole-document seam as `GelaendeAktionen`). DOM-free.
 *
 * Was der Testflug an der Liste `vegetationEntfernt` des Entwurfs tut: die Kreise eines Strichs anfügen oder wieder
 * herausnehmen, je als EIN Schreibvorgang.
 *
 * Nothing is written that the service would answer with 422 (`vegetationProblem`), and nothing is dropped silently:
 * a write that does not fit says why and leaves the draft as it was.
 */
import { VEGETATION_KREISE_MAX, vegetationProblem, type VegetationEntferntKreis } from '@wov/shared';
import type { EntwurfDokument, TestflugPersistenz } from './TestflugPersistenz';
import { gleicherKreis } from './vegetationPinsel';
import { t } from '../i18n';

export type VegetationErgebnis = { ok: true } | { ok: false; message: string };

/**
 * The circles of the draft for the preview: `null` without a draft (the preview then takes the layout of the world),
 * else the list (empty when the field is missing). A damaged value gives the empty list; the checker of the preview
 * takes only valid circles anyway, and the brush stays locked until the draft is usable (`lese`).
 */
export function vegetationKreiseAusEntwurf(dok: EntwurfDokument | null | undefined): readonly VegetationEntferntKreis[] | null {
  if (!dok) return null;
  const roh = dok.vegetationEntfernt;
  return Array.isArray(roh) ? (roh as VegetationEntferntKreis[]) : [];
}

export class VegetationAktionen {
  constructor(private readonly persistenz: Pick<TestflugPersistenz, 'laden' | 'aendern'>) {}

  private dokument(): EntwurfDokument | null {
    try {
      return this.persistenz.laden();
    } catch {
      return null;
    }
  }

  /** The circles of the draft at the start of a stroke, or why the brush cannot work. */
  lese(): { ok: true; kreise: readonly VegetationEntferntKreis[] } | { ok: false; message: string } {
    const dok = this.dokument();
    if (!dok) return { ok: false, message: t('testflug.gelaende.kein_entwurf') };
    const roh = dok.vegetationEntfernt;
    if (roh !== undefined && vegetationProblem(roh) !== null) return { ok: false, message: t('testflug.gelaende.vegetation.entwurf_unbrauchbar') };
    return { ok: true, kreise: Array.isArray(roh) ? (roh as VegetationEntferntKreis[]) : [] };
  }

  private schreibe(dok: EntwurfDokument, liste: VegetationEntferntKreis[]): VegetationErgebnis {
    if (liste.length > VEGETATION_KREISE_MAX) return { ok: false, message: t('testflug.gelaende.vegetation.grenze', { max: VEGETATION_KREISE_MAX }) };
    if (vegetationProblem(liste) !== null) return { ok: false, message: t('testflug.gelaende.vegetation.entwurf_unbrauchbar') };
    if (liste.length > 0) dok.vegetationEntfernt = liste;
    else delete dok.vegetationEntfernt;
    this.persistenz.aendern(dok);
    return { ok: true };
  }

  /** The circles of one stroke at the end of the list: one write. */
  hinzufuegen(kreise: readonly VegetationEntferntKreis[]): VegetationErgebnis {
    const gelesen = this.lese();
    if (!gelesen.ok) return gelesen;
    const dok = this.dokument()!;
    return this.schreibe(dok, [...gelesen.kreise, ...kreise.map((k) => ({ ...k }))]);
  }

  /**
   * Takes these circles out again (undo): each one occurrence, the last one first. If one is no longer there (another
   * tab changed the list) nothing is changed.
   */
  entfernen(kreise: readonly VegetationEntferntKreis[]): VegetationErgebnis {
    const gelesen = this.lese();
    if (!gelesen.ok) return gelesen;
    const dok = this.dokument()!;
    const liste = [...gelesen.kreise];
    for (const k of kreise) {
      let pos = -1;
      for (let i = liste.length - 1; i >= 0; i--) {
        if (gleicherKreis(liste[i]!, k)) {
          pos = i;
          break;
        }
      }
      if (pos < 0) return { ok: false, message: t('testflug.gelaende.vegetation.konflikt') };
      liste.splice(pos, 1);
    }
    return this.schreibe(dok, liste);
  }
}
