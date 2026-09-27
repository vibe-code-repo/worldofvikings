import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { DEFAULTS, QUALITY_TIERS, SettingsStore, detectQualityTier, type GameSettings } from '../src/ui/Settings.js';

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

// Entscheidung 1: main.ts:1168 darf die Schattenstufe nicht mehr auf 1
// zwingen, wenn das 100-FPS-Profil an ist -- die gewaehlte Qualitaetsstufe
// (bzw. der manuelle Regler) hat Vorrang. main.ts hat dafuer keinen
// DOM-freien Kern (siehe client/test/werkzeug-registry.ts fuer denselben
// Ansatz bei editorMain.ts): Quelltextpruefung am Syntaxbaum statt an
// Formatierung/Kommentaren, damit Prettier-Umbrueche den Test nicht treffen.
{
  const kanonisch = (text: string): string =>
    ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)).replace(/"/g, "'");
  const mainQuelle = kanonisch(readFileSync(resolve(HIER, '../src/main.ts'), 'utf-8'));
  assert.match(
    mainQuelle,
    /shadows\?\.setLevel\(schattenErzwingenAus \? 0 : s\.shadowQuality\)/,
    'main.ts: onChange-Pfad -- shadows.setLevel folgt s.shadowQuality direkt (kein hundertFpsProfil-Zwang mehr)'
  );
  // Zweite Stelle: der Erstaufbau beim Welt-Betreten (`shadows = new
  // Shadows(...)`, ohne `?.` weil dort nicht optional) hatte denselben
  // Zwang in einer eigenen Kopie -- der obige Treffer allein haette ihn
  // nicht gefangen, weil das Muster das `?.` verlangt. Ohne diese zweite
  // Zeile bliebe ein frischer Login mit gespeicherter Stufe Niedrig +
  // aktivem 100-FPS-Profil auf Schattenstufe 1 haengen (gemessen: N1,
  // schattenStufe 1 statt 0 vor dieser Korrektur).
  assert.match(
    mainQuelle,
    /shadows\.setLevel\(schattenErzwingenAus \? 0 : startSettings\.shadowQuality\)/,
    'main.ts: Erstaufbau -- shadows.setLevel folgt startSettings.shadowQuality direkt (kein hundertFpsProfil-Zwang mehr)'
  );
  assert.doesNotMatch(
    mainQuelle,
    /shadows\??\.setLevel\([^)]*hundertFpsProfil[^)]*\)/,
    'main.ts: keine shadows.setLevel-Stelle (onChange oder Erstaufbau) erzwingt noch eine Mindeststufe ueber hundertFpsProfil'
  );
}

console.log('PASS Qualitaetsstufen: Niedrig/Mittel/Hoch treffen fps-analyse.md Abschnitt 6, fremde Einstellungen ueberleben, Erkennung robust, Persistenz/onChange/N1-Entscheidungen geprueft');
