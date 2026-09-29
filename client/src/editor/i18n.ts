/**
 * Shared editor bindings for `client/src/i18n` (T0a).
 *
 * Two exports, because the testflug modules are deliberately DOM-free so a
 * plain `tsx` run can test them (see the "DOM-free" comments across
 * `client/src/editor/testflug/*.ts`) — `GameI18n`'s constructor is not: it
 * calls `applyDocumentLanguage()`, which touches `document` unconditionally
 * (confirmed empirically: `new GameI18n()` throws `ReferenceError: document
 * is not defined` under the tsx test runner, no jsdom is wired in). Building
 * an instance at module load time — the only way to use it, since the class
 * itself is off limits for T0a (`CLAUDE.md`: "Kein Umbau der
 * Katalog-Klasse") — would crash every existing DOM-free test that imports
 * a testflug module transitively (`client/test/inselwahl.ts`,
 * `client/test/bewuchs-vorschau.ts`, the `testflug-*` tests).
 *
 *  - `t()` reads the SAME catalogue JSON and the SAME stored-language key
 *    (`wov-language`) as `GameI18n.t()`, with the same placeholder rule —
 *    not a third implementation, a DOM-independent twin of the one method
 *    every testflug/SpawnPanel/upload-dialog message actually needs. Safe
 *    to import anywhere, browser or plain Node.
 *  - N1 (Angriff „Editor T0a", Befund B5): the language order now matches
 *    `main.ts` (`?lang` first, then the stored choice, then the default —
 *    see `GameI18n`'s constructor and `main.ts` ~424) instead of skipping
 *    `?lang` outright. DOM-free (no `window`): falls straight through to
 *    the stored choice/default, same as before.
 *  - `editorI18nInstance()` builds (once, memoized) the actual `GameI18n`
 *    instance for `editorMain.ts`, exactly as PR #130 built it
 *    (`serverI18n`) — that file only ever runs in the browser (its own
 *    tests read it as a syntax tree, they do not import and execute it).
 *    It is a FUNCTION, not a top-level `const …  = new GameI18n()`: an ES
 *    module runs its whole body on import regardless of which export the
 *    importer names, so a top-level instance here would construct
 *    `GameI18n` — and crash — the moment any testflug module imports `t`
 *    from this same file. The lazy factory means importing `t` alone never
 *    touches `GameI18n` or `document`.
 *
 * Zwei Exporte aus demselben Grund: Die Testflug-Module sind absichtlich
 * DOM-frei testbar; `GameI18n`s Konstruktor braucht aber `document`
 * (`applyDocumentLanguage`), was unter tsx ohne DOM fehlschlägt. `t()` liest
 * denselben Katalog/Sprachschlüssel ohne die Instanz zu bauen. `editorI18nInstance()`
 * baut die Instanz erst beim ersten Aufruf (aus `editorMain.ts`, wie in PR #130) —
 * ein Modul-weites `const … = new GameI18n()` liefe schon beim blossen Import
 * von `t` und stürzte dieselben DOM-freien Tests ab, die `t()` gerade retten soll.
 */
import { GameI18n, isGameLocale, type GameLocale, type TranslationKey, type TranslationVars } from '../i18n';
import de from '../i18n/katalog/de.json';
import en from '../i18n/katalog/en.json';

const CATALOGUES = { de, en } as const;
const STORAGE_KEY = 'wov-language';

/** `?lang` from the address, same as `main.ts` ~424 (`ausAdresse.get('lang')`) — `null` without `window` or without a valid value. */
function adressSprache(): GameLocale | null {
  try {
    if (typeof window === 'undefined') return null;
    const wert = new URLSearchParams(window.location.search).get('lang');
    return isGameLocale(wert) ? wert : null;
  } catch {
    return null;
  }
}

function gespeicherteSprache(): GameLocale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isGameLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Same order as `GameI18n`'s constructor / `main.ts`: `?lang`, then the stored choice, then `de`. */
function domfreieSprache(): GameLocale {
  return adressSprache() ?? gespeicherteSprache() ?? 'de';
}

/** The resolved language `t()` is currently using — for callers that need it directly (e.g. number formatting). */
export function aktuelleSprache(): GameLocale {
  return domfreieSprache();
}

/** DOM-free translation, for testflug/SpawnPanel/upload-dialog modules (see file header). */
export function t(key: TranslationKey, variables: TranslationVars = {}): string {
  return CATALOGUES[domfreieSprache()][key].replace(/\{([^}]+)\}/g, (token, name: string) =>
    Object.hasOwn(variables, name) ? String(variables[name]) : token
  );
}

/** The `GameI18n` instance for `editorMain.ts`, built lazily (browser-only, see file header). */
let instanz: GameI18n | null = null;
export function editorI18nInstance(): GameI18n {
  return (instanz ??= new GameI18n());
}
