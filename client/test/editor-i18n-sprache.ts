/**
 * T0a N2 (Auflagen A1/A2 aus dem Nachangriff): dauerhafter Test fuer die
 * Sprachauswahl von `t()`/`aktuelleSprache()` in `client/src/editor/i18n.ts`.
 * DOM-frei, mit Attrappen fuer `window.location.search` und `localStorage`
 * (Vorbild: `client/test/testflug-ops.ts`, `client/test/bewuchs-vorschau.ts`).
 *
 * A1: Reihenfolge `?lang`, dann gespeicherte Wahl, dann `de` — fuer jede
 * Szene zusaetzlich die Gleichheit mit dem Spiel: derselbe Rohwert, den
 * `main.ts` (~424, `ausAdresse.get('lang')`) an `new GameI18n(...)` reicht,
 * muss auf dieselbe Sprache aufloesen wie `aktuelleSprache()`/`t()`.
 *
 * A2 (Angriffsbefund B3): `editorI18nInstance()` liest seit N2 ebenfalls
 * `?lang` zuerst. Die Funktion memoisiert ein modul-weites `instanz` (wie
 * PR #130s `serverI18n`) — zwei Sprachlagen im selben Prozess pruefen hiesse
 * also, das Modul zweimal frisch zu laden. Statt eines Cache-Bust-Imports
 * (fragil unter tsx) laeuft die Probe in zwei frischen Kindprozessen: jeder
 * bekommt eine eigene globale `window`/`localStorage`/`document`-Attrappe
 * und gibt `editorI18nInstance().language` auf stdout aus. Kindprozesse fuer
 * isolierten Modulzustand sind in diesem Baum bereits Konvention, siehe
 * `shared/test/welt-abgleich-wettlauf.ts`.
 *
 * `GameI18n`s Konstruktor braucht `document` (`applyDocumentLanguage`), das
 * reicht aber eine reine Objekt-Attrappe (`{ documentElement: {} }`) — kein
 * jsdom noetig, siehe der Kopfkommentar von `i18n.ts`.
 *
 * Run: npx tsx client/test/editor-i18n-sprache.ts   (aus client/)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let fehler = 0;
let geprueft = 0;
function pruefe(bedingung: boolean, text: string): void {
  geprueft++;
  if (bedingung) {
    console.log(`  PASS ${text}`);
  } else {
    console.error(`  FAIL ${text}`);
    fehler++;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLIENT_ROOT, '..');
const TSX = resolve(REPO_ROOT, 'node_modules/.bin/tsx');
const I18N_MODUL = pathToFileURL(resolve(CLIENT_ROOT, 'src/editor/i18n.ts')).href;

// ── DOM-freie Attrappen, VOR dem Import von i18n.ts / GameI18n ──────────
// (globalThis).document reicht als reines Objekt aus, s. Kopfkommentar.
(globalThis as unknown as { document: unknown }).document = { documentElement: {} };

function setzeAdresse(suche: string | undefined): void {
  if (suche === undefined) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  (globalThis as unknown as { window: unknown }).window = { location: { search: suche } };
}

function setzeLocalStorage(gespeichert: string | undefined, wirft: boolean): void {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (_k: string) => {
      if (wirft) throw new Error('Speicher nicht verfuegbar (Testprobe)');
      return gespeichert ?? null;
    },
    setItem: (): void => undefined,
  };
}

const { t, aktuelleSprache } = await import('../src/editor/i18n');
const { GameI18n } = await import('../src/i18n');

console.log('T0a N2: Sprachauswahl t()/aktuelleSprache() gegen GameI18n');

// ── A1: Reihenfolge ?lang -> gespeicherte Wahl -> de, plus Gleichheit mit dem Spiel ──

interface Szene {
  readonly name: string;
  /** `undefined` = kein `window` (kein Browser). */
  readonly adresse: string | undefined;
  /** `undefined` = kein Eintrag im Speicher. */
  readonly gespeichert: string | undefined;
  readonly speicherWirft: boolean;
  readonly erwartet: 'de' | 'en';
  /** Der Rohwert, den `main.ts` (~424) als `ausAdresse.get('lang')` an `new GameI18n(...)` reicht; `null` ohne `window` bzw. ohne `?lang`. */
  readonly adressWertFuersSpiel: string | null;
}

const SZENEN: readonly Szene[] = [
  { name: '?lang=en', adresse: '?lang=en', gespeichert: undefined, speicherWirft: false, erwartet: 'en', adressWertFuersSpiel: 'en' },
  { name: '?lang=de (gespeichert waere en)', adresse: '?lang=de', gespeichert: 'en', speicherWirft: false, erwartet: 'de', adressWertFuersSpiel: 'de' },
  { name: '?lang=xx (ungueltig) -> gespeicherte Wahl', adresse: '?lang=xx', gespeichert: 'en', speicherWirft: false, erwartet: 'en', adressWertFuersSpiel: 'xx' },
  { name: 'keine Adresse und keine Wahl -> de', adresse: undefined, gespeichert: undefined, speicherWirft: false, erwartet: 'de', adressWertFuersSpiel: null },
  { name: 'window ohne ?lang, keine Wahl -> de', adresse: '?andere=1', gespeichert: undefined, speicherWirft: false, erwartet: 'de', adressWertFuersSpiel: null },
  { name: 'gespeicherte Wahl en, kein window', adresse: undefined, gespeichert: 'en', speicherWirft: false, erwartet: 'en', adressWertFuersSpiel: null },
  { name: 'gespeicherte Wahl en, window ohne ?lang', adresse: '', gespeichert: 'en', speicherWirft: false, erwartet: 'en', adressWertFuersSpiel: null },
  { name: 'Speicher wirft, keine Adresse -> de', adresse: undefined, gespeichert: undefined, speicherWirft: true, erwartet: 'de', adressWertFuersSpiel: null },
  { name: 'Speicher wirft, ?lang=en gewinnt trotzdem', adresse: '?lang=en', gespeichert: undefined, speicherWirft: true, erwartet: 'en', adressWertFuersSpiel: 'en' },
];

for (const szene of SZENEN) {
  setzeAdresse(szene.adresse);
  setzeLocalStorage(szene.gespeichert, szene.speicherWirft);

  const domfrei = aktuelleSprache();
  const viaT = t('language.name');
  const viaSpiel = new GameI18n(szene.adressWertFuersSpiel).language;
  const spielName = szene.erwartet === 'de' ? 'Deutsch' : 'English';

  pruefe(domfrei === szene.erwartet, `${szene.name}: aktuelleSprache() = ${domfrei} (erwartet ${szene.erwartet})`);
  pruefe(viaT === spielName, `${szene.name}: t('language.name') = ${viaT} (erwartet ${spielName})`);
  pruefe(
    viaSpiel === szene.erwartet,
    `${szene.name}: Gleichheit mit dem Spiel — GameI18n(${JSON.stringify(szene.adressWertFuersSpiel)}).language = ${viaSpiel}`
  );
}

// ── A2: editorI18nInstance() liest ?lang ebenso, memoisiert -> Kindprozess je Szene ──

function editorInstanzSpracheInSubprozess(adresse: string | undefined): string {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'wov-editor-i18n-'));
  const datei = join(verzeichnis, 'probe.mts');
  const adresseZeile =
    adresse === undefined
      ? 'delete (globalThis as { window?: unknown }).window;'
      : `(globalThis as unknown as { window: unknown }).window = { location: { search: ${JSON.stringify(adresse)} } };`;
  writeFileSync(
    datei,
    [
      `(globalThis as unknown as { document: unknown }).document = { documentElement: {} };`,
      adresseZeile,
      `(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem: () => undefined };`,
      `const { editorI18nInstance } = await import(${JSON.stringify(I18N_MODUL)});`,
      `process.stdout.write(editorI18nInstance().language);`,
    ].join('\n'),
    'utf-8'
  );
  try {
    return execFileSync(TSX, [datei], { encoding: 'utf-8', timeout: 30_000 });
  } finally {
    rmSync(verzeichnis, { recursive: true, force: true });
  }
}

const editorMitLang = editorInstanzSpracheInSubprozess('?lang=en');
pruefe(editorMitLang === 'en', `A2: editorI18nInstance() mit ?lang=en = ${editorMitLang} (erwartet en)`);

const editorOhneLang = editorInstanzSpracheInSubprozess(undefined);
pruefe(editorOhneLang === 'de', `A2: editorI18nInstance() ohne ?lang (unveraendert) = ${editorOhneLang} (erwartet de)`);

console.log(`\n${geprueft} Pruefung(en), ${fehler} Fehlschlag/Fehlschlaege`);
if (fehler > 0) {
  console.error(`=== ${fehler} SPRACHAUSWAHL-PRUEFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('=== ALLE SPRACHAUSWAHL-PRUEFUNGEN BESTANDEN ===');
