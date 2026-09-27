import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { DEFAULTS, QUALITY_TIERS, SettingsStore, detectQualityTier, schattenStufeFuer, type GameSettings } from '../src/ui/Settings.js';

const HIER = dirname(fileURLToPath(import.meta.url));

/** Berichte/fps-analyse.md Abschnitt 6, dazu Mikes Entscheidung vom 27.09.
 * (Niedrig schaltet zusaetzlich Sonnenstrahlen/AO/Bewegungsunschaerfe aus). */
const TABLE: Record<'low' | 'medium' | 'high', Partial<GameSettings>> = {
  low: {
    shadowQuality: 0,
    depthOfField: false,
    grassDensity: 0,
    detailQuality: 0,
    waterQuality: 1,
    vegetationRange: 0,
    bloom: false,
    chromaticAberration: false,
    antiAliasing: false,
    sunShafts: false,
    ambientOcclusion: false,
    motionBlur: false,
  },
  medium: {
    shadowQuality: 2,
    depthOfField: false,
    grassDensity: 2,
    detailQuality: 1,
    waterQuality: 2,
    vegetationRange: 2,
    bloom: true,
    chromaticAberration: true,
    antiAliasing: true,
    sunShafts: true,
    ambientOcclusion: false,
    motionBlur: false,
  },
  high: {
    shadowQuality: DEFAULTS.shadowQuality,
    depthOfField: DEFAULTS.depthOfField,
    grassDensity: DEFAULTS.grassDensity,
    detailQuality: DEFAULTS.detailQuality,
    waterQuality: DEFAULTS.waterQuality,
    vegetationRange: DEFAULTS.vegetationRange,
    bloom: DEFAULTS.bloom,
    chromaticAberration: DEFAULTS.chromaticAberration,
    antiAliasing: DEFAULTS.antiAliasing,
    sunShafts: DEFAULTS.sunShafts,
    ambientOcclusion: DEFAULTS.ambientOcclusion,
    motionBlur: DEFAULTS.motionBlur,
  },
};

// "Hoch bleibt wie heute": die Karte darf DEFAULTS nicht mitverschoben haben.
assert.equal(DEFAULTS.shadowQuality, 2, 'high default: shadowQuality unveraendert');
assert.equal(DEFAULTS.depthOfField, true, 'high default: depthOfField unveraendert');
assert.equal(DEFAULTS.grassDensity, 3, 'high default: grassDensity unveraendert');
assert.equal(DEFAULTS.detailQuality, 2, 'high default: detailQuality unveraendert');
assert.equal(DEFAULTS.waterQuality, 2, 'high default: waterQuality unveraendert');
assert.equal(DEFAULTS.vegetationRange, 3, 'high default: vegetationRange unveraendert');
assert.equal(DEFAULTS.bloom, true, 'high default: bloom unveraendert');
assert.equal(DEFAULTS.chromaticAberration, true, 'high default: chromaticAberration unveraendert');
assert.equal(DEFAULTS.antiAliasing, true, 'high default: antiAliasing unveraendert');
assert.equal(DEFAULTS.sunShafts, true, 'high default: sunShafts unveraendert');
assert.equal(DEFAULTS.ambientOcclusion, false, 'high default: ambientOcclusion unveraendert');
assert.equal(DEFAULTS.motionBlur, false, 'high default: motionBlur unveraendert');

for (const tier of ['low', 'medium', 'high'] as const) {
  for (const [field, expected] of Object.entries(TABLE[tier])) {
    const actual = QUALITY_TIERS[tier][field as keyof (typeof QUALITY_TIERS)[typeof tier]];
    assert.equal(actual, expected, `QUALITY_TIERS.${tier}.${field}`);
  }
}

// applyQualityTier setzt exakt die Tabellenwerte, unabhaengig vom vorherigen Stand
// (auch fuer die drei neuen Felder: ein voriger manueller Stand mit umgekehrten
// Werten darf nichts von sich ins Ergebnis retten).
for (const tier of ['low', 'medium', 'high'] as const) {
  const store = new SettingsStore();
  store.set({
    shadowQuality: 3, grassDensity: 3, waterQuality: 3, detailQuality: 3, vegetationRange: 1,
    bloom: false, depthOfField: false, chromaticAberration: false, antiAliasing: false,
    sunShafts: false, ambientOcclusion: true, motionBlur: true,
  });
  store.applyQualityTier(tier);
  const state = store.get();
  for (const [field, expected] of Object.entries(TABLE[tier])) {
    assert.equal(state[field as keyof GameSettings], expected, `applyQualityTier(${tier}).${field}`);
  }
  assert.equal(detectQualityTier(state), tier, `detectQualityTier erkennt ${tier} nach dem Setzen`);
}

// Eine gespeicherte eigene Einstellung ausserhalb der zwoelf Stufen-Felder
// (hier: Namensschilder, Pointer-Lock) bleibt beim Stufenwechsel erhalten.
{
  const store = new SettingsStore();
  store.set({ nameplates: false, pointerLock: false });
  store.applyQualityTier('low');
  assert.equal(store.get().nameplates, false, 'nameplates ueberlebt den Stufenwechsel');
  assert.equal(store.get().pointerLock, false, 'pointerLock ueberlebt den Stufenwechsel');
  store.applyQualityTier('high');
  assert.equal(store.get().nameplates, false, 'nameplates ueberlebt auch den Wechsel zurueck auf Hoch');
}

// detectQualityTier meldet null, sobald ein einzelner Regler manuell abweicht.
{
  const store = new SettingsStore();
  store.applyQualityTier('medium');
  store.set({ grassDensity: 3 });
  assert.equal(detectQualityTier(store.get()), null, 'manuelle Abweichung von einer erkannten Stufe wird nicht mehr erkannt');
}

// ── Auflage 2 des Angriffs (Berichte/angriff-fps-stufen.md Befund 2) ───────
// Vier Mutationen ueberlebten den alten Test, weil er ohne localStorage lief
// (set() faengt den ReferenceError still ab, Settings.ts) und die Erkennung
// nur an den Tabellenwerten prallte, nie an absichtlich verschobenen
// Einzelfeldern. Die vier Faelle unten sind so gebaut, dass sie bei jeder
// der vier Mutationen (A, B, D, E) rot werden -- siehe
// Berichte/fps-stufen-n1/mutationen.mjs fuer den Nachweis je Mutation.

// A: Persistenz -- eine neue SettingsStore-Instanz ("Neuladen") muss die
// zuletzt angewandte Stufe wiederfinden. Ohne echten localStorage-Stub ist
// das nicht pruefbar (siehe Kommentar oben), darum hier ein Stub nach dem
// Muster aus client/test/testflug-speichern-basis.ts.
{
  const speicher = new Map<string, string>();
  const stub = {
    getItem: (k: string): string | null => speicher.get(k) ?? null,
    setItem: (k: string, v: string): void => void speicher.set(k, v),
    removeItem: (k: string): void => void speicher.delete(k),
  };
  const zuvor = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as unknown as { localStorage: unknown }).localStorage = stub;
  try {
    const store = new SettingsStore();
    store.applyQualityTier('low');
    const geladen = new SettingsStore(); // frischer Prozess, gleicher Speicher
    for (const [field, expected] of Object.entries(TABLE.low)) {
      assert.equal(geladen.get()[field as keyof GameSettings], expected, `Persistenz nach Neuladen: ${field}`);
    }
    assert.equal(detectQualityTier(geladen.get()), 'low', 'Persistenz: Stufe Niedrig uebersteht das Neuladen');
  } finally {
    if (zuvor === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as unknown as { localStorage: unknown }).localStorage = zuvor;
  }
}

// B: Ein Klick loest genau EINEN onChange-Aufruf aus, nicht einen je Feld
// (Mutation "9 x onChange je Klick": ein set() je Feld statt eines
// gesammelten Aufrufs waere z. B. fuer eine teure onChange-Kette elf
// unnoetige Zwischenzustaende, hier absichtsfrei an der Aufrufzahl geprueft,
// unabhaengig davon, wie viele Felder eine Stufe gerade verwaltet).
{
  const store = new SettingsStore();
  let aufrufe = 0;
  store.onChange(() => { aufrufe++; }); // onChange feuert beim Abonnieren sofort einmal
  assert.equal(aufrufe, 1, 'onChange feuert beim Abonnieren genau einmal');
  aufrufe = 0;
  store.applyQualityTier('medium');
  assert.equal(aufrufe, 1, 'applyQualityTier loest genau einen onChange-Aufruf aus, nicht einen je Feld');
}

// D: Die Erkennung darf shadowQuality nicht ignorieren.
{
  const store = new SettingsStore();
  store.applyQualityTier('high');
  store.set({ shadowQuality: 0 });
  assert.equal(detectQualityTier(store.get()), null, 'abweichende shadowQuality wird erkannt (nicht mehr Hoch)');
}

// E: Die Erkennung darf antiAliasing nicht ignorieren.
{
  const store = new SettingsStore();
  store.applyQualityTier('high');
  store.set({ antiAliasing: !TABLE.high.antiAliasing });
  assert.equal(detectQualityTier(store.get()), null, 'abweichende antiAliasing wird erkannt (nicht mehr Hoch)');
}

// ── Mikes Entscheidungen vom 27.09. (N1) ───────────────────────────────────

// Entscheidung 2: Niedrig schaltet zusaetzlich Sonnenstrahlen, AO und
// Bewegungsunschaerfe aus. TAA bleibt unangetastet, wie der Spieler es
// eingestellt hat -- in beide Richtungen (an bleibt an, aus bleibt aus).
{
  const store = new SettingsStore();
  store.set({ temporalAA: true });
  store.applyQualityTier('low');
  const s = store.get();
  assert.equal(s.sunShafts, false, 'Niedrig: Sonnenstrahlen aus');
  assert.equal(s.ambientOcclusion, false, 'Niedrig: Umgebungsverdeckung (AO) aus');
  assert.equal(s.motionBlur, false, 'Niedrig: Bewegungsunschaerfe aus');
  assert.equal(s.temporalAA, true, 'Niedrig laesst eingeschaltetes TAA unangetastet');
}
{
  const store = new SettingsStore();
  store.set({ temporalAA: false });
  store.applyQualityTier('low');
  assert.equal(store.get().temporalAA, false, 'Niedrig laesst ausgeschaltetes TAA unangetastet');
}

// ── Mikes Entscheidung vom 27.09. zum 100-FPS-Profil (N2) ─────────────────
// Angriffsbefund 4 auf N1: Die alte Quelltextwache war ein Text-Regex und
// damit zugleich zu eng (eine dritte setLevel-Stelle ohne die exakte
// Klammerform rutschte durch) und zu weit (ein gleichwertiger Umbau ueber
// eine Hilfsfunktion wurde als Fehlalarm rot). Die Karte verlangt deshalb,
// die Regel selbst in eine reine Funktion zu ziehen (schattenStufeFuer(),
// Settings.ts) und main.ts nur noch darauf zu pruefen, dass es diese
// Funktion an beiden Stellen tatsaechlich AUFRUFT -- am Syntaxbaum, nicht
// am Text, damit Formatierung/Kommentare/Zeilenumbrueche egal sind.

/** Alle `shadows.setLevel(...)`-Aufrufe im Syntaxbaum, `shadows?.` und
 * `shadows!.` eingeschlossen (Non-Null-Assertion wird vor dem Vergleich
 * abgestreift, wie eine umschliessende Klammer um den Empfaenger). */
function sammleShadowsSetLevelAufrufe(quelltext: string): ts.CallExpression[] {
  const datei = ts.createSourceFile('main.ts', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const treffer: ts.CallExpression[] = [];
  const kern = (ausdruck: ts.Expression): ts.Expression => {
    if (ts.isNonNullExpression(ausdruck)) return kern(ausdruck.expression);
    if (ts.isParenthesizedExpression(ausdruck)) return kern(ausdruck.expression);
    return ausdruck;
  };
  const empfaengerIstShadows = (ausdruck: ts.Expression): boolean => {
    const e = kern(ausdruck);
    return ts.isIdentifier(e) && e.text === 'shadows';
  };
  const besuche = (knoten: ts.Node): void => {
    if (
      ts.isCallExpression(knoten) &&
      ts.isPropertyAccessExpression(knoten.expression) &&
      knoten.expression.name.text === 'setLevel' &&
      empfaengerIstShadows(knoten.expression.expression)
    ) {
      treffer.push(knoten);
    }
    ts.forEachChild(knoten, besuche);
  };
  besuche(datei);
  return treffer;
}

/** Jeder `shadows.setLevel(...)`-Aufruf muss sein Argument (bis auf
 * umschliessende Klammern) direkt von einem Aufruf `schattenStufeFuer(...)`
 * beziehen -- kein Ternary, keine Zwischenvariable, kein zweiter,
 * unbewachter setLevel-Aufruf daneben. */
function pruefeSchattenStufeVerdrahtung(quelltext: string): { anzahl: number; alleRufenFunktionAuf: boolean } {
  const entpacke = (ausdruck: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(ausdruck) ? entpacke(ausdruck.expression) : ausdruck;
  const aufrufe = sammleShadowsSetLevelAufrufe(quelltext);
  const alleRufenFunktionAuf = aufrufe.every((aufruf) => {
    const argument = aufruf.arguments[0];
    if (argument === undefined) return false;
    const kern = entpacke(argument);
    return ts.isCallExpression(kern) && ts.isIdentifier(kern.expression) && kern.expression.text === 'schattenStufeFuer';
  });
  return { anzahl: aufrufe.length, alleRufenFunktionAuf };
}

// Nachweis am echten main.ts: genau die beiden Stellen (onChange +
// Erstaufbau), beide ueber schattenStufeFuer().
{
  const mainQuelle = readFileSync(resolve(HIER, '../src/main.ts'), 'utf-8');
  const { anzahl, alleRufenFunktionAuf } = pruefeSchattenStufeVerdrahtung(mainQuelle);
  assert.equal(anzahl, 2, 'main.ts: genau zwei shadows.setLevel-Aufrufe (onChange-Pfad + Erstaufbau)');
  assert.ok(alleRufenFunktionAuf, 'main.ts: beide shadows.setLevel-Aufrufe beziehen ihr Argument aus schattenStufeFuer()');
}

// Gleichwertige Umformung (andere Formatierung, Kommentar, umschliessende
// Klammern, mehrzeilig, Non-Null statt Optional-Chaining) bleibt gruen --
// die Wache haengt an der Struktur, nicht am Text.
{
  const gleichwertig = `
    function onChange() {
      shadows
        ?.setLevel(
          (schattenStufeFuer(s, schattenErzwingenAus)) // Kommentar, egal
        );
    }
    function init() {
      shadows!.setLevel(schattenStufeFuer(startSettings, schattenErzwingenAus));
    }
  `;
  const { anzahl, alleRufenFunktionAuf } = pruefeSchattenStufeVerdrahtung(gleichwertig);
  assert.equal(anzahl, 2, 'gleichwertiger Umbau: weiterhin zwei Aufrufe erkannt');
  assert.ok(alleRufenFunktionAuf, 'gleichwertiger Umbau (Formatierung/Klammern/shadows!) bleibt gruen');
}

// Die vier Mutanten aus dem Nachangriff (Befund 4, angepasst an die neue
// Funktion): jeder ersetzt eine der beiden Stellen durch dieselbe alte,
// fehlerhafte Zwangslogik in einer anderen syntaktischen Form. Alle vier
// muessen rot werden.
const MUTANTEN: Record<string, string> = {
  'if-Zeile (zweiter, unbewachter setLevel-Aufruf)': `
    function onChange() {
      shadows?.setLevel(s.shadowQuality);
      if (s.hundertFpsProfil) { shadows?.setLevel(Math.max(1, s.shadowQuality)); }
    }
    function init() {
      shadows.setLevel(schattenStufeFuer(startSettings, schattenErzwingenAus));
    }
  `,
  "get()-Klammer (Ternary statt schattenStufeFuer, ueber gameSettings.get())": `
    function onChange() {
      shadows?.setLevel(gameSettings.get().hundertFpsProfil ? 1 : s.shadowQuality);
    }
    function init() {
      shadows.setLevel(schattenStufeFuer(startSettings, schattenErzwingenAus));
    }
  `,
  'shadows! mit eingebautem Ternary statt schattenStufeFuer': `
    function onChange() {
      shadows!.setLevel(s.hundertFpsProfil ? 1 : s.shadowQuality);
    }
    function init() {
      shadows.setLevel(schattenStufeFuer(startSettings, schattenErzwingenAus));
    }
  `,
  'Zwischenvariable statt direktem schattenStufeFuer-Aufruf': `
    function onChange() {
      const stufe = s.hundertFpsProfil ? 1 : s.shadowQuality;
      shadows?.setLevel(stufe);
    }
    function init() {
      shadows.setLevel(schattenStufeFuer(startSettings, schattenErzwingenAus));
    }
  `,
};
for (const [name, quelle] of Object.entries(MUTANTEN)) {
  const { anzahl, alleRufenFunktionAuf } = pruefeSchattenStufeVerdrahtung(quelle);
  const gruen = anzahl === 2 && alleRufenFunktionAuf;
  assert.ok(!gruen, `Mutant "${name}" muss die Wache rot machen (anzahl=${anzahl}, alleRufenFunktionAuf=${alleRufenFunktionAuf})`);
}

// ── schattenStufeFuer(): die reine Regel selbst, unit-getestet ────────────
// Karte: Profil an + Niedrig -> 0; Profil an + Mittel/Hoch -> 1; Profil aus
// -> shadowQuality; erzwungen aus -> 0.
assert.equal(schattenStufeFuer({ hundertFpsProfil: true, shadowQuality: 0 }, false), 0, 'Profil an + Niedrig (shadowQuality 0) -> 0');
assert.equal(schattenStufeFuer({ hundertFpsProfil: true, shadowQuality: 1 }, false), 1, 'Profil an + Mittel (shadowQuality 1) -> 1 (Profil-Schattenvariante)');
assert.equal(schattenStufeFuer({ hundertFpsProfil: true, shadowQuality: 2 }, false), 1, 'Profil an + Hoch (shadowQuality 2) -> 1 (Profil-Schattenvariante)');
assert.equal(schattenStufeFuer({ hundertFpsProfil: true, shadowQuality: 3 }, false), 1, 'Profil an + Sehr hoch (shadowQuality 3) -> 1 (Profil-Schattenvariante)');
assert.equal(schattenStufeFuer({ hundertFpsProfil: false, shadowQuality: 2 }, false), 2, 'Profil aus -> shadowQuality unveraendert (Hoch)');
assert.equal(schattenStufeFuer({ hundertFpsProfil: false, shadowQuality: 0 }, false), 0, 'Profil aus -> shadowQuality unveraendert (Niedrig)');
assert.equal(schattenStufeFuer({ hundertFpsProfil: true, shadowQuality: 2 }, true), 0, 'erzwungen aus hat Vorrang vor Profil und Stufe');
assert.equal(schattenStufeFuer({ hundertFpsProfil: false, shadowQuality: 2 }, true), 0, 'erzwungen aus hat Vorrang auch ohne Profil');

// Dieselben vier Faelle noch einmal ueber die echten Stufen-Voreinstellungen
// (QUALITY_TIERS via SettingsStore), damit die Regel nicht nur isoliert,
// sondern am tatsaechlichen Datenweg der Karte geprueft ist.
{
  const store = new SettingsStore();
  store.applyQualityTier('low');
  store.set({ hundertFpsProfil: true });
  assert.equal(schattenStufeFuer(store.get(), false), 0, 'Karte: Profil an + Niedrig -> 0');
}
{
  const store = new SettingsStore();
  store.applyQualityTier('medium');
  store.set({ hundertFpsProfil: true });
  assert.equal(schattenStufeFuer(store.get(), false), 1, 'Karte: Profil an + Mittel -> 1 (Profil-Schattenvariante)');
}
{
  const store = new SettingsStore();
  store.applyQualityTier('high');
  store.set({ hundertFpsProfil: true });
  assert.equal(schattenStufeFuer(store.get(), false), 1, 'Karte: Profil an + Hoch -> 1 (Profil-Schattenvariante)');
}
{
  const store = new SettingsStore();
  store.applyQualityTier('high');
  store.set({ hundertFpsProfil: false });
  assert.equal(schattenStufeFuer(store.get(), false), store.get().shadowQuality, 'Karte: Profil aus -> shadowQuality unveraendert');
}
{
  const store = new SettingsStore();
  store.applyQualityTier('high');
  store.set({ hundertFpsProfil: true });
  assert.equal(schattenStufeFuer(store.get(), true), 0, 'Karte: erzwungen aus -> 0, auch mit Profil und Hoch');
}

console.log('PASS Qualitaetsstufen: Niedrig/Mittel/Hoch treffen fps-analyse.md Abschnitt 6, fremde Einstellungen ueberleben, Erkennung robust, Persistenz/onChange/N1+N2-Entscheidungen geprueft, schattenStufeFuer()-Wache haelt allen vier Mutanten stand');
