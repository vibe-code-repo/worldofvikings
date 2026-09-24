/**
 * diffBasis.ts — welches Dokument world_diff als „vorher“ nimmt.
 *
 *   "sitzung"            Stand beim ersten Lesen dieser Sitzung (Vorgabe)
 *   "vorgang"            Dokument vor dem letzten ops_apply
 *   { vorgang: "<id>" }  Dokument vor dem Vorgang mit dieser id
 *   { layout: <doc> }    ein übergebenes Dokument (vom Aufrufer bereinigt)
 *
 * Reine Funktion; Stapel und Sitzungsbasis kommen herein. Fehlt die Basis,
 * kommt eine Fehlermeldung statt eines Dokuments.
 *
 * Picks the "before" document for world_diff; pure, errors as text.
 */
import type { WorldLayout } from '../worldlayout/types.js';
import type { StapelEintrag } from './stapel.js';

export type DiffGegen = 'sitzung' | 'vorgang' | { vorgang: string } | { layout: unknown };

export interface DiffQuellen {
  sitzung: () => WorldLayout | undefined;
  oberster: () => StapelEintrag | undefined;
  finde: (vorgangId: string) => StapelEintrag | undefined;
  bereinige: (roh: unknown) => WorldLayout | null | undefined;
}

export function waehleDiffBasis(gegen: DiffGegen | undefined, q: DiffQuellen): { basis: WorldLayout } | { fehler: string } {
  if (gegen === undefined || gegen === 'sitzung') {
    const b = q.sitzung();
    return b ? { basis: b } : { fehler: 'keine Sitzungsbasis vorhanden (Prozess neu gestartet?).' };
  }
  if (gegen === 'vorgang') {
    const e = q.oberster();
    return e ? { basis: e.stand } : { fehler: 'kein Vorgang im Stapel (noch nichts mit ops_apply geschrieben).' };
  }
  if ('vorgang' in gegen) {
    const e = q.finde(gegen.vorgang);
    return e ? { basis: e.stand } : { fehler: `Vorgang ${gegen.vorgang} nicht im Stapel (unbekannt oder herausgefallen).` };
  }
  const b = q.bereinige(gegen.layout);
  return b ? { basis: b } : { fehler: 'das übergebene Dokument ist kein gültiges WorldLayout.' };
}
