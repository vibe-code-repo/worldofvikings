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
import { istListe, type FeldFehler, type LokalerGrund, type Vereinheitlichung } from './modell';
import { MAX_KENNUNG_ANZEIGE, fuege, kuerzeHart, sichtbarKuerzen, tA, zahlText, zier, type Anzeigetext } from './anzeige';

export { MAX_KENNUNG_ANZEIGE, sichtbarKuerzen };

/** Every text the mask shows is an `Anzeigetext` (see anzeige.ts): `t` of the catalogue, or a test's translator. */
export type Uebersetzer = (key: TranslationKey, vars?: TranslationVars) => Anzeigetext;

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
  nameSchluessel: 'editor.gegenstand.feld.name_schluessel',
  beschreibungSchluessel: 'editor.gegenstand.feld.beschreibung_schluessel',
};

/** Conflict lines shown at most; the rest is one line "and N more differences". */
export const MAX_KONFLIKT_ZEILEN = 12;

/**
 * The text of a conflict (the server changed the entry the author is editing): the headline, one line per
 * differing field with BOTH versions, and how many lines were left out. `server` null = the entry is gone there.
 */
export function konfliktInhalt(
  k: { server: unknown; unterschiede: ReadonlyArray<{ feld: string; eigen: string; server: string }> },
  uebersetze: Uebersetzer = tA
): { titel: Anzeigetext; zeilen: Anzeigetext[]; weitere: Anzeigetext | null } {
  const zeigen = k.unterschiede.slice(0, MAX_KONFLIKT_ZEILEN);
  const feldName = (feld: string): Anzeigetext => (hatSchluessel(FELD_SCHLUESSEL, feld) ? uebersetze(FELD_SCHLUESSEL[feld]) : sichtbarKuerzen(feld));
  const wertAnzeige = (v: string): Anzeigetext => (v === '' ? uebersetze('editor.gegenstand.konflikt.leer') : sichtbarKuerzen(v, 120));
  return {
    titel: uebersetze(k.server === null ? 'editor.gegenstand.konflikt.titel_entfernt' : 'editor.gegenstand.konflikt.titel'),
    // The entry is gone on the server: there is no server version to compare, each row is a field of the draft that
    // would stay as a new entry.
    zeilen: zeigen.map((u) =>
      k.server === null
        ? uebersetze('editor.gegenstand.konflikt.zeile_entfernt', { feld: feldName(u.feld), eigen: wertAnzeige(u.eigen) })
        : uebersetze('editor.gegenstand.konflikt.zeile', { feld: feldName(u.feld), eigen: wertAnzeige(u.eigen), server: wertAnzeige(u.server) })
    ),
    weitere: k.unterschiede.length > zeigen.length ? uebersetze('editor.gegenstand.konflikt.weitere', { anzahl: k.unterschiede.length - zeigen.length }) : null,
  };
}

const hatSchluessel = (tabelle: object, code: string): boolean => Object.hasOwn(tabelle, code);

/**
 * One line "<id or #position>: <reason>" for an entry the reader or the route refused. The id is a raw file value,
 * so it is shortened and made visible; `grundText` does the same for a reason it does not know.
 */
export function verworfenZeile(v: { index: number; id: string | null; grund: string }, uebersetze: Uebersetzer = tA): Anzeigetext {
  return fuege(': ', v.id === null ? fuege('', zier('#'), zahlText(v.index)) : sichtbarKuerzen(v.id), grundText(v.grund, uebersetze));
}

/** The fields the server changed alone and that went into the draft (at most `MAX_KONFLIKT_ZEILEN` named), or null if none. */
export function zusammengefuehrtText(felder: readonly string[], uebersetze: Uebersetzer = tA): Anzeigetext | null {
  if (felder.length === 0) return null;
  const name = (feld: string): Anzeigetext => (hatSchluessel(FELD_SCHLUESSEL, feld) ? uebersetze(FELD_SCHLUESSEL[feld]) : sichtbarKuerzen(feld));
  const genannt = felder.slice(0, MAX_KONFLIKT_ZEILEN).map(name);
  if (felder.length > genannt.length) genannt.push(uebersetze('editor.gegenstand.konflikt.zusammengefuehrt_weitere', { anzahl: felder.length - genannt.length }));
  return uebersetze('editor.gegenstand.konflikt.zusammengefuehrt', { felder: fuege(', ', ...genannt) });
}

/** The text of a reader reason (`grund`), or the bare code in a sentence when it is one the mask does not know yet. */
export function grundText(code: string, uebersetze: Uebersetzer = tA): Anzeigetext {
  return hatSchluessel(GRUND_SCHLUESSEL, code)
    ? uebersetze(GRUND_SCHLUESSEL[code as VerwerfGrund])
    : uebersetze('editor.gegenstand.grund.unbekannt', { code: sichtbarKuerzen(code) });
}

/** The message of one field problem, with the range filled in. */
export function feldFehlerText(f: FeldFehler, uebersetze: Uebersetzer = tA): Anzeigetext {
  if (hatSchluessel(LOKAL_SCHLUESSEL, f.code)) {
    return uebersetze(LOKAL_SCHLUESSEL[f.code as LokalerGrund], { min: f.min ?? 0, max: f.max ?? 0 });
  }
  return grundText(f.code, uebersetze);
}

/** The text of a `fehler` code of the route. */
export function routeFehlerText(code: string | null, uebersetze: Uebersetzer = tA): Anzeigetext {
  if (code !== null && hatSchluessel(ROUTE_FEHLER_SCHLUESSEL, code)) return uebersetze(ROUTE_FEHLER_SCHLUESSEL[code]);
  return uebersetze('editor.gegenstand.route.unbekannt', { code: sichtbarKuerzen(code ?? '?') });
}

/**
 * The text of a result of the API client that is none of the expected ones. 401/403 come from the gates in front
 * of the route (their `fehler` is free text), so the status decides first; then the route's own code.
 */
export function fehlerErgebnisText(e: { status: number; fehler: string | null }, uebersetze: Uebersetzer = tA): Anzeigetext {
  if (e.status === 401 || e.status === 403) return zugangText(e.status, uebersetze);
  if (e.fehler !== null) return routeFehlerText(e.fehler, uebersetze);
  return zugangText(e.status, uebersetze);
}

/** The text for an HTTP status the route never answers itself (the gates in front of it), for the network and for "no answer in time". */
export function zugangText(status: number | 'netz' | 'zeit', uebersetze: Uebersetzer = tA): Anzeigetext {
  if (status === 'netz') return uebersetze('editor.gegenstand.http.netz');
  if (status === 'zeit') return uebersetze('editor.gegenstand.http.zeit');
  if (status === 401) return uebersetze('editor.gegenstand.http.401');
  if (status === 403) return uebersetze('editor.gegenstand.http.403');
  return uebersetze('editor.gegenstand.http.andere', { status: zahlText(status) });
}

/**
 * The text of a receipt (`GET /api/gegenstaende/quittung`): status, and for a held-back one the counts. The receipt can be
 * hand-written, so it is shortened like a dialog list: at most `MAX_DIALOG_ZEILEN` lines then "and N more", every
 * id / name / status shortened and made visible (`sichtbarKuerzen`). The upper bound is HARD: the finished text is cut
 * to `QUITTUNG_MAX_ZEICHEN` UTF-16 units (`kuerzeHart`, no surrogate pair split, end mark "…"), whatever the file holds.
 * Without the cut the worst case is about 13 400 units: a character outside the BMP is up to 10 units as `<U+10FFFF>`.
 */
export function quittungText(q: { status: string; gehalten?: unknown; verworfen?: unknown }, name: (id: string) => string, uebersetze: Uebersetzer = tA): Anzeigetext {
  return kuerzeHart(quittungOhneGrenze(q, name, uebersetze), QUITTUNG_MAX_ZEICHEN);
}

function quittungOhneGrenze(q: { status: string; gehalten?: unknown; verworfen?: unknown }, name: (id: string) => string, uebersetze: Uebersetzer): Anzeigetext {
  const status = sichtbarKuerzen(String(q.status));
  const basis = hatSchluessel(QUITTUNG_SCHLUESSEL, q.status)
    ? uebersetze(QUITTUNG_SCHLUESSEL[q.status])
    : uebersetze('editor.gegenstand.quittung.unbekannt', { status });
  const zeilen: Array<() => Anzeigetext> = [];
  if (typeof q.gehalten === 'object' && q.gehalten !== null && !istListe(q.gehalten)) {
    for (const id of Object.keys(q.gehalten).sort()) {
      const anzahl = (q.gehalten as Record<string, unknown>)[id];
      if (typeof anzahl === 'number' && Number.isFinite(anzahl)) zeilen.push(() => uebersetze('editor.gegenstand.quittung.gehalten', { name: sichtbarKuerzen(name(id), MAX_KENNUNG_ANZEIGE * 2), anzahl }));
    }
  }
  if (istListe(q.verworfen)) {
    for (const v of q.verworfen) {
      if (typeof v === 'object' && v !== null && typeof (v as { grund?: unknown }).grund === 'string') {
        const id = (v as { id?: unknown }).id;
        const grundCode = (v as { grund: string }).grund;
        zeilen.push(() =>
          uebersetze('editor.gegenstand.quittung.verworfen_eintrag', { name: typeof id === 'string' ? sichtbarKuerzen(name(id), MAX_KENNUNG_ANZEIGE * 2) : zier('?'), grund: grundText(grundCode, uebersetze) })
        );
      }
    }
  }
  if (zeilen.length === 0) return basis;
  const sichtbar = zeilen.slice(0, MAX_DIALOG_ZEILEN).map((z) => z());
  if (zeilen.length > MAX_DIALOG_ZEILEN) sichtbar.push(uebersetze('editor.gegenstand.bestaetigung.weitere', { anzahl: zeilen.length - MAX_DIALOG_ZEILEN }));
  return fuege(' ', basis, fuege('; ', ...sichtbar));
}

/**
 * The longest `quittungText` can be, in UTF-16 units. The cap is enforced on the finished text (`kuerzeHart`); the
 * measured worst case of ten lines of 80 + 40 characters, every one a `<U+10FFFF>`, is about 13 400 before the cut.
 */
export const QUITTUNG_MAX_ZEICHEN = 12000;

/** Lines a dialog lists; the rest is one line "and N more". */
export const MAX_DIALOG_ZEILEN = 10;

/** The lines of a dialog list: the first `MAX_DIALOG_ZEILEN`, and how many are left out. */
export function ersteZeilen(alle: readonly Anzeigetext[]): { punkte: Anzeigetext[]; weitere: number } {
  return { punkte: alle.slice(0, MAX_DIALOG_ZEILEN), weitere: Math.max(0, alle.length - MAX_DIALOG_ZEILEN) };
}

/** The ids of a load banner / dialog list: at most `MAX_DIALOG_ZEILEN` shown (shortened, made visible), then "and N more". */
function idListe(ids: readonly string[], uebersetze: Uebersetzer): Anzeigetext {
  const { punkte, weitere } = ersteZeilen(ids.map((id) => sichtbarKuerzen(id)));
  return fuege('; ', ...punkte, ...(weitere > 0 ? [uebersetze('editor.gegenstand.bestaetigung.weitere', { anzahl: weitere })] : []));
}

/**
 * The lines of the load banner for a file the next save would write differently: how many entries (with their ids, ten
 * at most) and, if there is one, that a key at file level goes. Empty list when the save changes nothing.
 */
export function vereinheitlichtZeilen(v: Vereinheitlichung, uebersetze: Uebersetzer = tA): Anzeigetext[] {
  const zeilen: Anzeigetext[] = [];
  if (v.ids.length > 0) zeilen.push(uebersetze('editor.gegenstand.seite.vereinheitlicht_hinweis', { anzahl: v.ids.length, liste: idListe(v.ids, uebersetze) }));
  if (v.dateiebene) zeilen.push(uebersetze('editor.gegenstand.seite.vereinheitlicht_datei'));
  return zeilen;
}

/** The result line of a save that did not go through: with no answer at all the server may have written, so it is not "not saved". */
export function nichtGespeichertText(art: string, uebersetze: Uebersetzer = tA): Anzeigetext {
  return uebersetze(art === 'netz' ? 'editor.gegenstand.seite.unklar_gespeichert' : 'editor.gegenstand.seite.nicht_gespeichert');
}

/** "<name> (<id>)", or just the id when the name is missing or the same; both made safe to show. */
const zeileVon = (id: string, n: string | null): Anzeigetext => {
  const k = sichtbarKuerzen(id);
  return n !== null && n !== id ? fuege(' ', sichtbarKuerzen(n, MAX_KENNUNG_ANZEIGE * 2), fuege('', zier('('), k, zier(')'))) : k;
};

/** What the confirmation dialog says about a removal or an overwrite (409 of the route). */
export interface BestaetigungInfo {
  art: 'entfernen' | 'alter-stand-kaputt';
  entfernt: readonly string[];
  entferntOhneId: readonly string[];
  dateiFehler?: string | null;
}

export interface BestaetigungsInhalt {
  titel: Anzeigetext;
  /** The sentence: how many, and that it is final. It names NO item: the names stand once, in `punkte`. */
  satz: Anzeigetext;
  /** One line per item, "<name> (<id>)": the first ten only. */
  punkte: Anzeigetext[];
  /** "and N more" when there are more than ten items, else null. */
  weitere: Anzeigetext | null;
  bestaetigen: Anzeigetext;
  abbrechen: Anzeigetext;
}

/**
 * The dialog text of a 409. `name(id)` gives the display name of an id in the current language (the old state's
 * texts); an id without a text is shown as itself. The removal sentence names the COUNT (ids and unreadable
 * entries together) and says "permanently", also for the copies in inventories and chests. Each item stands ONCE,
 * in the list (ten lines at most, then "and N more"); raw ids are shortened and made visible (`sichtbarKuerzen`).
 */
export function bestaetigungsInhalt(info: BestaetigungInfo, name: (id: string) => string | null, uebersetze: Uebersetzer = tA): BestaetigungsInhalt {
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
 * The dialog before the first save of a file that is not in the form the writer produces (`Vorwarnung`): how many entries
 * are unified (ten ids at most), a key at file level, and the discarded entries whose id the saved entry takes over.
 */
export function vorwarnungsInhalt(
  w: { vereinheitlicht: Vereinheitlichung; ueberschreibt: ReadonlyArray<{ index: number; id: string | null; grund: string }> },
  uebersetze: Uebersetzer = tA
): BestaetigungsInhalt {
  const alle: Anzeigetext[] = [
    ...w.vereinheitlicht.ids.map((id) => sichtbarKuerzen(id)),
    ...(w.vereinheitlicht.dateiebene ? [uebersetze('editor.gegenstand.vorwarnung.datei')] : []),
    ...w.ueberschreibt.map((v) => uebersetze('editor.gegenstand.vorwarnung.ueberschreibt', { zeile: verworfenZeile(v, uebersetze) })),
  ];
  const { punkte, weitere } = ersteZeilen(alle);
  const anzahl = w.vereinheitlicht.ids.length;
  return {
    titel: uebersetze('editor.gegenstand.vorwarnung.titel'),
    satz: anzahl > 0 ? uebersetze('editor.gegenstand.vorwarnung.satz_eintraege', { anzahl }) : uebersetze('editor.gegenstand.vorwarnung.satz_sonst'),
    punkte,
    weitere: weitere > 0 ? uebersetze('editor.gegenstand.bestaetigung.weitere', { anzahl: weitere }) : null,
    bestaetigen: uebersetze('editor.gegenstand.vorwarnung.speichern'),
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
  uebersetze: Uebersetzer = tA
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
