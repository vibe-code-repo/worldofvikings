/**
 * Item mask (Editor card EG2): every text the mask shows for a CODE (reader reasons, route errors, mask
 * checks, receipt status) and the sentence of the confirmation dialog. DOM-free.
 * Gegenstands-Maske (EG2): alle Texte zu Codes und der Satz des Bestaetigungsdialogs. DOM-frei.
 *
 * The tables map a code to a catalogue key `editor.gegenstand.*` (client/src/i18n/katalog/{de,en}.json).
 * `GRUND_SCHLUESSEL` and `DATEI_FEHLER_SCHLUESSEL` are `satisfies Record<Code, TranslationKey>`: a code that
 * the shared reader adds later breaks the type check here instead of showing a bare code to the author.
 * `ROUTE_FEHLER_SCHLUESSEL` is read against the route's syntax tree by client/test/editor-gegenstaende-texte.ts.
 *
 * Text goes through `t()` of `../i18n` (DOM-free); the dialog builder takes the translator as a parameter so a
 * test can render both languages.
 */
import type { DateiFehler, VerwerfGrund } from '@wov/shared/src/items/gegenstandsDaten.js';
import type { TranslationKey, TranslationVars } from '../../i18n';
import { t } from '../i18n';
import type { FeldFehler, LokalerGrund } from './modell';

export type Uebersetzer = (key: TranslationKey, vars?: TranslationVars) => string;

/** Reader reasons (`VERWERF_GRUENDE`). */
export const GRUND_SCHLUESSEL = {
  'eintrag-kein-objekt': 'editor.gegenstand.grund.eintrag_kein_objekt',
  'id-ungueltig': 'editor.gegenstand.grund.id_ungueltig',
  'id-doppelt': 'editor.gegenstand.grund.id_doppelt',
  'id-code-kollision': 'editor.gegenstand.grund.id_code_kollision',
  'id-schreibung-code': 'editor.gegenstand.grund.id_schreibung_code',
  'id-schreibung-doppelt': 'editor.gegenstand.grund.id_schreibung_doppelt',
  'schluessel-ungueltig': 'editor.gegenstand.grund.schluessel_ungueltig',
  'typ-unbekannt': 'editor.gegenstand.grund.typ_unbekannt',
  'slot-unbekannt': 'editor.gegenstand.grund.slot_unbekannt',
  'modell-ungueltig': 'editor.gegenstand.grund.modell_ungueltig',
  'symbol-ungueltig': 'editor.gegenstand.grund.symbol_ungueltig',
  'zahl-ungueltig': 'editor.gegenstand.grund.zahl_ungueltig',
  'werte-ungueltig': 'editor.gegenstand.grund.werte_ungueltig',
  'feld-ungueltig': 'editor.gegenstand.grund.feld_ungueltig',
  'rezept-ungueltig': 'editor.gegenstand.grund.rezept_ungueltig',
  'rezept-selbstbezug': 'editor.gegenstand.grund.rezept_selbstbezug',
  'rezept-zutat-unbekannt': 'editor.gegenstand.grund.rezept_zutat_unbekannt',
  'rezept-zyklus': 'editor.gegenstand.grund.rezept_zyklus',
  'texte-ungueltig': 'editor.gegenstand.grund.texte_ungueltig',
  'texte-schluessel-fremd': 'editor.gegenstand.grund.texte_schluessel_fremd',
  'texte-name-fehlt': 'editor.gegenstand.grund.texte_name_fehlt',
  'eintrag-ungueltig': 'editor.gegenstand.grund.eintrag_ungueltig',
  'zu-viele-eintraege': 'editor.gegenstand.grund.zu_viele_eintraege',
} as const satisfies Record<VerwerfGrund, TranslationKey>;

/** Checks only the mask does (empty name, range, half a vector ...). */
export const LOKAL_SCHLUESSEL = {
  'name-fehlt': 'editor.gegenstand.lokal.name_fehlt',
  'zahl-ungueltig': 'editor.gegenstand.lokal.zahl_ungueltig',
  bereich: 'editor.gegenstand.lokal.bereich',
  ganzzahl: 'editor.gegenstand.lokal.ganzzahl',
  'vektor-unvollstaendig': 'editor.gegenstand.lokal.vektor_unvollstaendig',
  'zutaten-fehlen': 'editor.gegenstand.lokal.zutaten_fehlen',
  'zutat-fehlt': 'editor.gegenstand.lokal.zutat_fehlt',
} as const satisfies Record<LokalerGrund, TranslationKey>;

/** `dateiFehler` of the reader; the route passes them on as `fehler` (422) and in `dateiFehler` (409, GET). */
export const DATEI_FEHLER_SCHLUESSEL = {
  'datei-kein-json': 'editor.gegenstand.route.datei_kein_json',
  'datei-zu-gross': 'editor.gegenstand.route.datei_zu_gross',
  'datei-kopf-falsch': 'editor.gegenstand.route.datei_kopf_falsch',
  'datei-version-unbekannt': 'editor.gegenstand.route.datei_version_unbekannt',
  'datei-zu-viele-eintraege': 'editor.gegenstand.route.datei_zu_viele_eintraege',
} as const satisfies Record<DateiFehler, TranslationKey>;

/** Every `fehler` code of `admin/src/routen/gegenstaende.ts`. */
export const ROUTE_FEHLER_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  ...DATEI_FEHLER_SCHLUESSEL,
  'repo-fehlt': 'editor.gegenstand.route.repo_fehlt',
  'repo-kaputt': 'editor.gegenstand.route.repo_kaputt',
  'anfrage-zu-gross': 'editor.gegenstand.route.anfrage_zu_gross',
  'basis-fehlt': 'editor.gegenstand.route.basis_fehlt',
  'basis-unbestimmt': 'editor.gegenstand.route.basis_unbestimmt',
  'eintraege-verworfen': 'editor.gegenstand.route.eintraege_verworfen',
  veraltet: 'editor.gegenstand.route.veraltet',
  'alter-stand-kaputt': 'editor.gegenstand.route.alter_stand_kaputt',
  brauchtBestaetigung: 'editor.gegenstand.route.braucht_bestaetigung',
  gesperrt: 'editor.gegenstand.route.gesperrt',
  intern: 'editor.gegenstand.route.intern',
  methode: 'editor.gegenstand.route.methode',
  'unbekannter-endpunkt': 'editor.gegenstand.route.unbekannter_endpunkt',
};

/** Receipt states of the game server's watch (Game card G2) and the two the route itself makes up. */
export const QUITTUNG_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  keine: 'editor.gegenstand.quittung.keine',
  unlesbar: 'editor.gegenstand.quittung.unlesbar',
  angewendet: 'editor.gegenstand.quittung.angewendet',
  abgelehnt: 'editor.gegenstand.quittung.abgelehnt',
  verworfen: 'editor.gegenstand.quittung.verworfen',
  'bestaetigung-noetig': 'editor.gegenstand.quittung.bestaetigung_noetig',
};

const hatSchluessel = (tabelle: object, code: string): boolean => Object.hasOwn(tabelle, code);

/** The text of a reader reason (`grund`), or the bare code in a sentence when it is one the mask does not know yet. */
export function grundText(code: string, uebersetze: Uebersetzer = t): string {
  return hatSchluessel(GRUND_SCHLUESSEL, code)
    ? uebersetze(GRUND_SCHLUESSEL[code as VerwerfGrund])
    : uebersetze('editor.gegenstand.grund.unbekannt', { code });
}

/** The message of one field problem, with the range filled in. */
export function feldFehlerText(f: FeldFehler, uebersetze: Uebersetzer = t): string {
  if (hatSchluessel(LOKAL_SCHLUESSEL, f.code)) {
    return uebersetze(LOKAL_SCHLUESSEL[f.code as LokalerGrund], { min: f.min ?? 0, max: f.max ?? 0 });
  }
  return grundText(f.code, uebersetze);
}

/** The text of a `fehler` code of the route. */
export function routeFehlerText(code: string | null, uebersetze: Uebersetzer = t): string {
  if (code !== null && hatSchluessel(ROUTE_FEHLER_SCHLUESSEL, code)) return uebersetze(ROUTE_FEHLER_SCHLUESSEL[code]);
  return uebersetze('editor.gegenstand.route.unbekannt', { code: code ?? '?' });
}

/**
 * The text of a result of the API client that is none of the expected ones. 401/403 come from the gates in front
 * of the route (their `fehler` is free text), so the status decides first; then the route's own code.
 */
export function fehlerErgebnisText(e: { status: number; fehler: string | null }, uebersetze: Uebersetzer = t): string {
  if (e.status === 401 || e.status === 403) return zugangText(e.status, uebersetze);
  if (e.fehler !== null) return routeFehlerText(e.fehler, uebersetze);
  return zugangText(e.status, uebersetze);
}

/** The text for an HTTP status the route never answers itself (the gates in front of it) and for the network. */
export function zugangText(status: number | 'netz', uebersetze: Uebersetzer = t): string {
  if (status === 'netz') return uebersetze('editor.gegenstand.http.netz');
  if (status === 401) return uebersetze('editor.gegenstand.http.401');
  if (status === 403) return uebersetze('editor.gegenstand.http.403');
  return uebersetze('editor.gegenstand.http.andere', { status });
}

/** The text of a receipt (`GET /api/gegenstaende/quittung`): status, and for a held-back one the counts. */
export function quittungText(q: { status: string; gehalten?: unknown; verworfen?: unknown }, name: (id: string) => string, uebersetze: Uebersetzer = t): string {
  const basis = hatSchluessel(QUITTUNG_SCHLUESSEL, q.status)
    ? uebersetze(QUITTUNG_SCHLUESSEL[q.status])
    : uebersetze('editor.gegenstand.quittung.unbekannt', { status: q.status });
  const teile: string[] = [];
  if (typeof q.gehalten === 'object' && q.gehalten !== null && !Array.isArray(q.gehalten)) {
    for (const id of Object.keys(q.gehalten).sort()) {
      const anzahl = (q.gehalten as Record<string, unknown>)[id];
      if (typeof anzahl === 'number' && Number.isFinite(anzahl)) teile.push(uebersetze('editor.gegenstand.quittung.gehalten', { name: name(id), anzahl }));
    }
  }
  if (Array.isArray(q.verworfen)) {
    for (const v of q.verworfen) {
      if (typeof v === 'object' && v !== null && typeof (v as { grund?: unknown }).grund === 'string') {
        const id = (v as { id?: unknown }).id;
        teile.push(uebersetze('editor.gegenstand.quittung.verworfen_eintrag', { name: typeof id === 'string' ? name(id) : '?', grund: grundText((v as { grund: string }).grund, uebersetze) }));
      }
    }
  }
  return teile.length > 0 ? `${basis} ${teile.join('; ')}` : basis;
}

/** What the confirmation dialog says about a removal or an overwrite (409 of the route). */
export interface BestaetigungInfo {
  art: 'entfernen' | 'alter-stand-kaputt';
  entfernt: readonly string[];
  entferntOhneId: readonly string[];
  dateiFehler?: string | null;
}

export interface BestaetigungsInhalt {
  titel: string;
  /** The sentence: how many, which, and that it is final. */
  satz: string;
  /** One line per item, "<name> (<id>)". */
  punkte: string[];
  bestaetigen: string;
  abbrechen: string;
}

/**
 * The dialog text of a 409. `name(id)` gives the display name of an id in the current language (the old state's
 * texts); an id without a text is shown as itself. The removal sentence names the COUNT (ids and unreadable
 * entries together), the NAMES, and says "permanently", also for the copies in inventories and chests.
 */
export function bestaetigungsInhalt(info: BestaetigungInfo, name: (id: string) => string | null, uebersetze: Uebersetzer = t): BestaetigungsInhalt {
  if (info.art === 'alter-stand-kaputt') {
    const grund = info.dateiFehler && hatSchluessel(DATEI_FEHLER_SCHLUESSEL, info.dateiFehler)
      ? uebersetze(DATEI_FEHLER_SCHLUESSEL[info.dateiFehler as DateiFehler])
      : uebersetze('editor.gegenstand.route.unbekannt', { code: info.dateiFehler ?? '?' });
    return {
      titel: uebersetze('editor.gegenstand.bestaetigung.titel_ersetzen'),
      satz: uebersetze('editor.gegenstand.bestaetigung.satz_ersetzen', { grund }),
      punkte: [],
      bestaetigen: uebersetze('editor.gegenstand.bestaetigung.ersetzen'),
      abbrechen: uebersetze('editor.gegenstand.bestaetigung.abbrechen'),
    };
  }
  const punkte = [
    ...info.entfernt.map((id) => {
      const n = name(id);
      return n !== null && n !== id ? `${n} (${id})` : id;
    }),
    ...info.entferntOhneId.map((roh) => uebersetze('editor.gegenstand.bestaetigung.ohne_id', { position: roh })),
  ];
  const anzahl = punkte.length;
  return {
    titel: uebersetze('editor.gegenstand.bestaetigung.titel_entfernen'),
    satz: uebersetze(anzahl === 1 ? 'editor.gegenstand.bestaetigung.satz_eins' : 'editor.gegenstand.bestaetigung.satz_mehrere', {
      anzahl,
      namen: punkte.join(', '),
    }),
    punkte,
    bestaetigen: uebersetze('editor.gegenstand.bestaetigung.entfernen'),
    abbrechen: uebersetze('editor.gegenstand.bestaetigung.abbrechen'),
  };
}
