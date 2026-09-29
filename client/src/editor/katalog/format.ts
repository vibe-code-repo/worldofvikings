/**
 * Text helpers of the editor's object catalogue (`../GegenstandsKatalog.ts`):
 * the translated lines of the upload dialog, the number locale and the short
 * number and file size formats.
 *
 * Moved here unchanged from `GegenstandsKatalog.ts` (refactoring step G1).
 * Nothing here is derived at module load.
 */
import type { Groessenvorschlag, Vorschlagsquelle, uploadedModelRegistry } from '@wov/shared';
import { aktuelleSprache, t } from '../i18n';
import type { TranslationKey } from '../../i18n';

/**
 * Uebersetzungsschluessel je `Vorschlagsquelle` (Auftrag Punkt 4, N1 Befund
 * B1) — `schlageZielgroesseVor` liefert seit N1 nur noch Zahlen und (bei den
 * ersten beiden Quellen) einen Namen, keinen fertigen Satz mehr.
 */
const VORSCHLAG_SCHLUESSEL: Readonly<Record<Vorschlagsquelle, TranslationKey>> = {
  'aehnliches-modell': 'editor.upload.vorschlag.aehnliches_modell',
  kategorie: 'editor.upload.vorschlag.kategorie',
  rohgroesse: 'editor.upload.vorschlag.rohgroesse',
};

/** Vorschlagszeile für das Zielgrößenfeld — s. `VORSCHLAG_SCHLUESSEL`. */
function vorschlagText(vorschlag: Groessenvorschlag): string {
  return t(VORSCHLAG_SCHLUESSEL[vorschlag.quelle], {
    name: vorschlag.begruendungName ?? '',
    meter: vorschlag.meter.toFixed(2),
  });
}

/**
 * N1 (Angriff „Editor T0a", Befund B4): `eintrag.kollisionsart` ist ein
 * interner Wert (`'fest' | 'durchlaessig'`), keine Anzeige — die passenden
 * Anzeigenamen gibt es schon als Katalogschlüssel (dieselben, die die
 * Kollisions-Auswahl im Formular benutzt).
 */
function kollisionsartText(art: uploadedModelRegistry.Kollisionsart): string {
  return t(art === 'fest' ? 'editor.upload.kollision.fest' : 'editor.upload.kollision.durchlaessig');
}

/**
 * N1 (Befund B4): `toLocaleString('de-DE')` blieb auch bei `lang=en` fest
 * deutsch (Punkt statt Komma als Tausendertrennzeichen). Zahlen folgen jetzt
 * der aktiven Sprache wie der restliche Text.
 */
function zahlLocale(): 'de-DE' | 'en-US' {
  return aktuelleSprache() === 'de' ? 'de-DE' : 'en-US';
}

/**
 * Dateigröße in der Einheit, in der man sie im Kopf hat.
 *
 * Bytes ausgeschrieben (`20560`) beantworten die Frage nicht, die man
 * stellt („ist das gross?"). Gerundet wird bewusst grob — auf ein
 * Kilobyte kommt es beim Durchsehen eines Speichers nie an.
 */
function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0).replace('.', ',')} kB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Kurze Zahl fürs Auge: 12,4 statt 12.412345678. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const stellen = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(stellen).replace('.', ',');
}

export { fmt, fmtBytes, kollisionsartText, vorschlagText, zahlLocale };
