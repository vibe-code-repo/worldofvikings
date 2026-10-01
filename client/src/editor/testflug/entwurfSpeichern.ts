/**
 * Publishing the draft of the offline flight, DOM-free: read, sanitise,
 * refuse a damaged height correction, send. Shared by the plain save button,
 * the route editor and "Speichern & neu starten" (`neustart.ts`), so all three
 * refuse the same way.
 *
 * Entwurf in die Welt speichern, ohne DOM: lesen, bereinigen, eine beschädigte
 * Höhenkorrektur ablehnen, senden. Gemeinsam für den einfachen Speichern-Knopf,
 * den Routen-Editor und „Speichern & neu starten“.
 *
 * Why the extra check (F1): `sanitizeWorldLayout` replaces a damaged or
 * oversized `heightDeltas` by `[]` WITHOUT a word. The service would see a valid
 * document and overwrite the hand correction on the server. So the report is
 * read first, and a `heightProblem` stops the save before anything is sent.
 *
 * Warum die Zusatzprüfung (F1): Der Sanitizer ersetzt eine beschädigte oder zu
 * große `heightDeltas` still durch `[]`. Der Dienst sähe ein gültiges Dokument
 * und überschriebe die Handkorrektur. Darum wird zuerst der Bericht gelesen,
 * und ein `heightProblem` hält das Speichern an, bevor etwas gesendet wird.
 */
import { sanitizeWorldLayoutMitBericht } from '@wov/shared';
import type { SpeicherAntwort } from './TestflugPersistenz';
import { speicherText } from './TestflugPersistenz';
import { t } from '../i18n';

export type HoehenProblem = { reason: 'invalid' | 'limit' | 'inspection-limit'; zonen: number; punkte: number };

export type EntwurfErgebnis =
  | { art: 'kein-entwurf' }
  | { art: 'unbrauchbar' }
  | { art: 'hoehe'; problem: HoehenProblem }
  /** The service answered; `antwort.ok` says whether it took the draft. */
  | { art: 'antwort'; antwort: SpeicherAntwort }
  /** Reading the draft or the request itself threw (network, unreadable storage). */
  | { art: 'ausnahme'; fehler: string };

export interface EntwurfDienste {
  /** The draft as stored; `null` = none. May throw. */
  laden(): object | null;
  speichern(dokument: object): Promise<SpeicherAntwort>;
}

export async function entwurfSpeichern(d: EntwurfDienste): Promise<EntwurfErgebnis> {
  let roh: object | null;
  try {
    roh = d.laden();
  } catch (err) {
    return { art: 'ausnahme', fehler: String(err) };
  }
  if (!roh) return { art: 'kein-entwurf' };
  const bericht = sanitizeWorldLayoutMitBericht(roh as never);
  if (!bericht) return { art: 'unbrauchbar' };
  if (bericht.heightProblem) {
    const p = bericht.heightProblem;
    return { art: 'hoehe', problem: { reason: p.reason, zonen: p.zonen, punkte: p.punkte } };
  }
  try {
    return { art: 'antwort', antwort: await d.speichern(bericht.layout) };
  } catch (err) {
    return { art: 'ausnahme', fehler: String(err) };
  }
}

export function hoehenGrund(p: HoehenProblem): string {
  if (p.reason === 'limit') return t('testflug.gelaende.hoehe.grund_limit', { zonen: p.zonen, punkte: p.punkte });
  if (p.reason === 'inspection-limit') return t('testflug.gelaende.hoehe.grund_pruefgrenze');
  return t('testflug.gelaende.hoehe.grund_ungueltig');
}

/** The HUD line for the plain save (the outcome of `entwurfSpeichern`, without a restart). */
export function entwurfErgebnisText(e: EntwurfErgebnis): string {
  switch (e.art) {
    case 'kein-entwurf':
      return t('testflug.kein_entwurf_speichern');
    case 'unbrauchbar':
      return t('testflug.entwurf_unbrauchbar');
    case 'hoehe':
      return t('testflug.gelaende.hoehe.beschaedigt', { grund: hoehenGrund(e.problem) });
    case 'antwort':
      return speicherText(e.antwort);
    case 'ausnahme':
      return t('testflug.speichern_fehlgeschlagen', { fehler: e.fehler });
  }
}
