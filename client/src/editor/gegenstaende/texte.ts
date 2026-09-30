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
  'text-zeilenumbruch': 'editor.gegenstand.lokal.text_zeilenumbruch',
  'text-steuerzeichen': 'editor.gegenstand.lokal.text_steuerzeichen',
  'text-zu-lang': 'editor.gegenstand.lokal.text_zu_lang',
  'text-ohne-zeichen': 'editor.gegenstand.lokal.text_ohne_zeichen',
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

/** The label of a field id of the mask (`Unterschied.feld`), for the conflict lines. */
export const FELD_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  id: 'editor.gegenstand.feld.id',
  nameDe: 'editor.gegenstand.feld.name_de',
  nameEn: 'editor.gegenstand.feld.name_en',
  beschreibungDe: 'editor.gegenstand.feld.beschreibung_de',
  beschreibungEn: 'editor.gegenstand.feld.beschreibung_en',
  typ: 'editor.gegenstand.feld.typ',
  upload: 'editor.gegenstand.feld.upload',
  skala: 'editor.gegenstand.feld.skala',
  haltePosition: 'editor.gegenstand.feld.halte_position',
  halteRotation: 'editor.gegenstand.feld.halte_rotation',
  hiebVersatz: 'editor.gegenstand.feld.hieb_versatz',
  animationsSatz: 'editor.gegenstand.feld.animations_satz',
  symbol: 'editor.gegenstand.feld.symbol',
  stapel: 'editor.gegenstand.feld.stapel',
  gewicht: 'editor.gegenstand.feld.gewicht',
  'wert.damage': 'editor.gegenstand.feld.wert_damage',
  'wert.armor': 'editor.gegenstand.feld.wert_armor',
  'wert.strength': 'editor.gegenstand.feld.wert_strength',
  'wert.vitality': 'editor.gegenstand.feld.wert_vitality',
  'wert.agility': 'editor.gegenstand.feld.wert_agility',
  ernteBaum: 'editor.gegenstand.feld.ernte_baum',
  ernteFels: 'editor.gegenstand.feld.ernte_fels',
  haltbarkeitMax: 'editor.gegenstand.feld.haltbarkeit_max',
  haltbarkeitVerbrauch: 'editor.gegenstand.feld.haltbarkeit_verbrauch',
  haltbarkeitAusdauer: 'editor.gegenstand.feld.haltbarkeit_ausdauer',
  itemLevel: 'editor.gegenstand.feld.item_level',
  rarity: 'editor.gegenstand.feld.rarity',
  rezept: 'editor.gegenstand.abschnitt.rezept',
};

/** Conflict lines shown at most; the rest is one line "and N more differences". */
export const MAX_KONFLIKT_ZEILEN = 12;

/**
 * The text of a conflict (the server changed the entry the author is editing): the headline, one line per
 * differing field with BOTH versions, and how many lines were left out. `server` null = the entry is gone there.
 */
export function konfliktInhalt(
  k: { server: unknown; unterschiede: ReadonlyArray<{ feld: string; eigen: string; server: string }> },
  uebersetze: Uebersetzer = t
): { titel: string; zeilen: string[]; weitere: string | null } {
  const zeigen = k.unterschiede.slice(0, MAX_KONFLIKT_ZEILEN);
  const feldName = (feld: string): string => (hatSchluessel(FELD_SCHLUESSEL, feld) ? uebersetze(FELD_SCHLUESSEL[feld]) : sichtbarKuerzen(feld));
  const leer = (v: string): string => (v === '' ? uebersetze('editor.gegenstand.konflikt.leer') : sichtbarKuerzen(v, 120));
  return {
    titel: uebersetze(k.server === null ? 'editor.gegenstand.konflikt.titel_entfernt' : 'editor.gegenstand.konflikt.titel'),
    zeilen: zeigen.map((u) => uebersetze('editor.gegenstand.konflikt.zeile', { feld: feldName(u.feld), eigen: leer(u.eigen), server: leer(u.server) })),
    weitere: k.unterschiede.length > zeigen.length ? uebersetze('editor.gegenstand.konflikt.weitere', { anzahl: k.unterschiede.length - zeigen.length }) : null,
  };
}

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
  return uebersetze('editor.gegenstand.route.unbekannt', { code: sichtbarKuerzen(code ?? '?') });
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

/** Longest run of one id / name shown in a dialog; a hand-written id can be any length. */
export const MAX_KENNUNG_ANZEIGE = 40;
/** Lines a dialog lists; the rest is one line "and N more". */
export const MAX_DIALOG_ZEILEN = 10;

/** Characters that would hide or reorder text: control, format (bidi, zero-width), separators, surrogates, private use, invisible fillers. */
const UNSICHTBAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\u2800\u3164\u115f\u1160\u180e\ufffc\ufe00-\ufe0f]/u;

/**
 * Text of a raw id or name for a dialog: at most `max` characters (then "…"), and every control / bidi /
 * invisible character shown as `<U+XXXX>` instead of acting. Only for showing (`textContent`), never for matching.
 */
export function sichtbarKuerzen(roh: string, max = MAX_KENNUNG_ANZEIGE): string {
  const zeichen = Array.from(roh);
  const kurz = zeichen
    .slice(0, max)
    .map((c) => (UNSICHTBAR.test(c) ? `<U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}>` : c))
    .join('');
  return zeichen.length > max ? `${kurz}…` : kurz;
}

/** The lines of a dialog list: the first `MAX_DIALOG_ZEILEN`, and how many are left out. */
export function ersteZeilen(alle: readonly string[]): { punkte: string[]; weitere: number } {
  return { punkte: alle.slice(0, MAX_DIALOG_ZEILEN), weitere: Math.max(0, alle.length - MAX_DIALOG_ZEILEN) };
}

/** "<name> (<id>)", or just the id when the name is missing or the same; both made safe to show. */
const zeileVon = (id: string, n: string | null): string => {
  const k = sichtbarKuerzen(id);
  return n !== null && n !== id ? `${sichtbarKuerzen(n, MAX_KENNUNG_ANZEIGE * 2)} (${k})` : k;
};

/** What the confirmation dialog says about a removal or an overwrite (409 of the route). */
export interface BestaetigungInfo {
  art: 'entfernen' | 'alter-stand-kaputt';
  entfernt: readonly string[];
  entferntOhneId: readonly string[];
  dateiFehler?: string | null;
}

export interface BestaetigungsInhalt {
  titel: string;
  /** The sentence: how many, and that it is final. It names NO item: the names stand once, in `punkte`. */
  satz: string;
  /** One line per item, "<name> (<id>)": the first ten only. */
  punkte: string[];
  /** "and N more" when there are more than ten items, else null. */
  weitere: string | null;
  bestaetigen: string;
  abbrechen: string;
}

/**
 * The dialog text of a 409. `name(id)` gives the display name of an id in the current language (the old state's
 * texts); an id without a text is shown as itself. The removal sentence names the COUNT (ids and unreadable
 * entries together) and says "permanently", also for the copies in inventories and chests. Each item stands ONCE,
 * in the list (ten lines at most, then "and N more"); raw ids are shortened and made visible (`sichtbarKuerzen`).
 */
export function bestaetigungsInhalt(info: BestaetigungInfo, name: (id: string) => string | null, uebersetze: Uebersetzer = t): BestaetigungsInhalt {
  if (info.art === 'alter-stand-kaputt') {
    const grund = info.dateiFehler && hatSchluessel(DATEI_FEHLER_SCHLUESSEL, info.dateiFehler)
      ? uebersetze(DATEI_FEHLER_SCHLUESSEL[info.dateiFehler as DateiFehler])
      : uebersetze('editor.gegenstand.route.unbekannt', { code: sichtbarKuerzen(info.dateiFehler ?? '?') });
    return {
      titel: uebersetze('editor.gegenstand.bestaetigung.titel_ersetzen'),
      satz: uebersetze('editor.gegenstand.bestaetigung.satz_ersetzen', { grund }),
      punkte: [],
      weitere: null,
      bestaetigen: uebersetze('editor.gegenstand.bestaetigung.ersetzen'),
      abbrechen: uebersetze('editor.gegenstand.bestaetigung.abbrechen'),
    };
  }
  const alle = [
    ...[...new Set(info.entfernt)].map((id) => zeileVon(id, name(id))),
    ...info.entferntOhneId.map((roh) => uebersetze('editor.gegenstand.bestaetigung.ohne_id', { position: sichtbarKuerzen(roh) })),
  ];
  const anzahl = alle.length;
  const { punkte, weitere } = ersteZeilen(alle);
  return {
    titel: uebersetze('editor.gegenstand.bestaetigung.titel_entfernen'),
    satz: uebersetze(anzahl === 1 ? 'editor.gegenstand.bestaetigung.satz_eins' : 'editor.gegenstand.bestaetigung.satz_mehrere', { anzahl }),
    punkte,
    weitere: weitere > 0 ? uebersetze('editor.gegenstand.bestaetigung.weitere', { anzahl: weitere }) : null,
    bestaetigen: uebersetze('editor.gegenstand.bestaetigung.entfernen'),
    abbrechen: uebersetze('editor.gegenstand.bestaetigung.abbrechen'),
  };
}

/**
 * The dialog before removing an item other recipes need. `abhaengige` = every entry that would go with it
 * (`modell.abhaengige`, direct users first); the dialog lists them like the confirmation dialog does.
 */
export function abhaengigkeitsInhalt(
  id: string,
  abhaengige: readonly string[],
  name: (id: string) => string | null,
  uebersetze: Uebersetzer = t
): BestaetigungsInhalt {
  const anzahl = abhaengige.length;
  const { punkte, weitere } = ersteZeilen(abhaengige.map((x) => zeileVon(x, name(x))));
  return {
    titel: uebersetze('editor.gegenstand.abhaengig.titel'),
    satz: uebersetze(anzahl === 1 ? 'editor.gegenstand.abhaengig.satz_eins' : 'editor.gegenstand.abhaengig.satz_mehrere', { name: zeileVon(id, name(id)), anzahl }),
    punkte,
    weitere: weitere > 0 ? uebersetze('editor.gegenstand.bestaetigung.weitere', { anzahl: weitere }) : null,
    bestaetigen: uebersetze('editor.gegenstand.abhaengig.mit_entfernen'),
    abbrechen: uebersetze('editor.gegenstand.bestaetigung.abbrechen'),
  };
}
