import { de } from './de';
import { en } from './en';

const CATALOGUES = { de, en } as const;

export type GameLocale = keyof typeof CATALOGUES;
export type TranslationKey = keyof typeof de;
export type TranslationVars = Readonly<Record<string, string | number>>;

export const GAME_LOCALES = Object.keys(CATALOGUES) as GameLocale[];
const STORAGE_KEY = 'wov-language';

export function isGameLocale(value: string | null | undefined): value is GameLocale {
  return value != null && value in CATALOGUES;
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
