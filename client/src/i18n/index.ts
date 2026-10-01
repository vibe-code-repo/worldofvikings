import { inhaltText, type InhaltSchluessel } from '@wov/shared';
import { MELDUNG_NAMENSPARAMETER, zerlegeServerMeldung } from '@wov/shared';
import de from './katalog/de.json';
import en from './katalog/en.json';

const CATALOGUES = { de, en } as const;

export type GameLocale = keyof typeof CATALOGUES;
export type TranslationKey = keyof typeof de;
export type TranslationVars = Readonly<Record<string, string | number>>;

export const GAME_LOCALES = Object.keys(CATALOGUES) as GameLocale[];
const STORAGE_KEY = 'wov-language';

/**
 * Typwaechter (F1): Der typecheck faellt aus, wenn `en` gegenueber `de`
 * einen Schluessel zu viel ODER zu wenig hat. Der Laufzeittest
 * `shared/test/i18n-katalog.ts` prueft dieselbe Zusicherung im Rohtext;
 * hier haelt sie zusaetzlich schon den Typweg an, bevor der Katalog
 * ueberhaupt geladen wird. `satisfies` auf ein importiertes JSON-Modul
 * macht keinen Excess-Property-Check (das JSON ist keine Objektliteral-
 * Syntax mehr), deshalb der explizite Vergleich in beide Richtungen.
 */
type KeineUeberzaehligenSchluesselInEn =
  [Exclude<keyof typeof en, keyof typeof de>] extends [never] ? true : never;
type KeinFehlenderSchluesselInEn =
  [Exclude<keyof typeof de, keyof typeof en>] extends [never] ? true : never;
const _katalogSchluesselGleich: KeineUeberzaehligenSchluesselInEn & KeinFehlenderSchluesselInEn = true;

export function isGameLocale(value: string | null | undefined): value is GameLocale {
  return value != null && Object.hasOwn(CATALOGUES, value);
}

function storedLocale(): GameLocale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isGameLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Runtime game-interface translations.
 *
 * Adding a language means adding one catalogue, registering it in
 * `CATALOGUES`, and allowing the website to hand that locale to the game.
 * TypeScript then requires the new catalogue to contain every existing id.
 */
export class GameI18n {
  private current: GameLocale;
  private readonly listeners = new Set<() => void>();

  constructor(requested?: string | null) {
    this.current = isGameLocale(requested) ? requested : storedLocale() ?? 'de';
    this.applyDocumentLanguage();
  }

  get language(): GameLocale {
    return this.current;
  }

  t(key: TranslationKey, variables: TranslationVars = {}): string {
    return CATALOGUES[this.current][key].replace(/\{([^}]+)\}/g, (token, name: string) =>
      Object.hasOwn(variables, name) ? String(variables[name]) : token
    );
  }

  /**
   * Inhaltstexte (F4, Namensraum `inhalt.*`): Items, NPCs und Ruestungssets
   * liegen nicht im Client-Katalog, sondern in `shared/data/texte`. Der
   * Schluesseltyp `InhaltSchluessel` haelt Tippfehler schon beim
   * Uebersetzen an, `inhaltText()` traegt den Sprach-Rueckfall.
   */
  /**
   * Text of a server message: `@key` or `@key|{json}` (SERVER_MELDUNG_SCHLUESSEL_PRAEFIX) is a catalogue key and
   * gets translated, anything else is shown as sent (the server's older messages are plain text).
   */
  serverMeldung(text: string): string {
    const meldung = zerlegeServerMeldung(text);
    if (!meldung || !Object.hasOwn(CATALOGUES[this.current], meldung.schluessel)) return text;
    // `@key|{json}`: the parameters fill the `{name}` placeholders; creature and item names are shown translated.
    const variablen: Record<string, string | number> = {};
    for (const [name, wert] of Object.entries(meldung.parameter)) {
      variablen[name] = MELDUNG_NAMENSPARAMETER.includes(name) ? this.anzeigeName(String(wert)) : wert;
    }
    return this.t(meldung.schluessel as TranslationKey, variablen);
  }

  /** Display name of a creature or an item as the server names it: the catalogue (`beute.name.*`), else the content texts, else as sent. */
  anzeigeName(name: string): string {
    const key = `beute.name.${name}`;
    if (Object.hasOwn(CATALOGUES[this.current], key)) return this.t(key as TranslationKey);
    const inhaltKey = `inhalt.item.${name}`;
    const inhalt = inhaltText(inhaltKey, this.current);
    return inhalt !== inhaltKey ? inhalt : name;
  }

  tInhalt(key: InhaltSchluessel): string {
    return inhaltText(key, this.current);
  }

  setLanguage(language: GameLocale): void {
    if (language === this.current) return;
    this.current = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* session-only */ }
    this.applyDocumentLanguage();
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  languageName(language: GameLocale): string {
    return CATALOGUES[language]['language.name'];
  }

  private applyDocumentLanguage(): void {
    document.documentElement.lang = this.current;
  }
}
