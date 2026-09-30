/**
 * What the test flight does to the hand-correction layer of the draft, as
 * ONE Vorgang per brush stroke (`gelaendePinsel.ts`). DOM-free.
 *
 * Was der Testflug an der Handkorrektur-Ebene des Entwurfs tut: je Pinselstrich
 * EIN Vorgang.
 *
 * Why not `TestflugPersistenz.vorgang`? That path speaks `ops.ts`, and
 * `OP_COLLECTIONS` there names six collections addressed by `id`; a zone of
 * `heightDeltas` has no id and the service's PATCH never touches the field
 * (`admin/src/routen/weltOps.ts`). Extending both is a change in `shared/` and
 * `admin/` (not part of card T2). So the stroke goes through the draft's own
 * whole-document write (`aendern`, the same seam the Vorgang code sits on) with
 * the same rules as `wendeAufEntwurf`: it stands only if every vertex still has
 * the value the stroke saw, all or nothing. It reaches the world file through the
 * ordinary publish (`speichern`, whole document).
 */
import { heightProblem } from '@wov/shared';
import type { EntwurfDokument, TestflugPersistenz } from './TestflugPersistenz';
import { DeltaKarte, karteAusEntwurf, wendeVorgang, type GelaendeVorgang, type GrenzGrund } from './gelaendePinsel';
import { t } from '../i18n';

export type GelaendeErgebnis = { ok: true } | { ok: false; message: string };

const PROTOKOLL_MAX = 200;

/** Text for a stroke that broke a limit. */
export function grenzText(grund: GrenzGrund): string {
  return t(`testflug.gelaende.grenze.${grund}`);
}

export class GelaendeAktionen {
  private readonly vorgaenge: GelaendeVorgang[] = [];

  constructor(private readonly persistenz: Pick<TestflugPersistenz, 'laden' | 'aendern'>) {}

  /** The strokes that were written to the draft, oldest first; the last 200. */
  protokoll(): readonly GelaendeVorgang[] {
    return this.vorgaenge;
  }

  /**
   * The layer as the draft holds it now, for the start of a stroke. `null`
   * with a message when there is no draft or its field is not usable as it is
   * (the brush must not paint over what it cannot write back unchanged).
   */
  ladeKarte(): { ok: true; karte: DeltaKarte } | { ok: false; message: string } {
    let dok: EntwurfDokument | null;
    try {
      dok = this.persistenz.laden();
    } catch {
      dok = null;
    }
    if (!dok) return { ok: false, message: t('testflug.gelaende.kein_entwurf') };
    const karte = karteAusEntwurf(dok.heightDeltas);
    if (!karte) return { ok: false, message: t('testflug.gelaende.entwurf_unbrauchbar') };
    return { ok: true, karte };
  }

  /** Writes one finished stroke into the draft: one Vorgang, all or nothing. */
  strichAbschliessen(v: GelaendeVorgang): GelaendeErgebnis {
    let dok: EntwurfDokument | null;
    try {
      dok = this.persistenz.laden();
    } catch {
      dok = null;
    }
    if (!dok) return { ok: false, message: t('testflug.gelaende.kein_entwurf') };
    const karte = karteAusEntwurf(dok.heightDeltas);
    if (!karte) return { ok: false, message: t('testflug.gelaende.entwurf_unbrauchbar') };
    const r = wendeVorgang(karte, v);
    if (!r.ok) return { ok: false, message: r.grund === 'konflikt' ? t('testflug.gelaende.konflikt') : grenzText(r.grund) };
    const zonen = karte.alsZonen();
    // The result must be something the service accepts; never write a field it would answer with 422.
    if (heightProblem(zonen) !== null) return { ok: false, message: t('testflug.gelaende.entwurf_unbrauchbar') };
    if (zonen.length > 0) dok.heightDeltas = zonen;
    else delete dok.heightDeltas;
    this.persistenz.aendern(dok);
    this.vorgaenge.push(v);
    if (this.vorgaenge.length > PROTOKOLL_MAX) this.vorgaenge.shift();
    return { ok: true };
  }
}
