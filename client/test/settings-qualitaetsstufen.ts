import assert from 'node:assert/strict';
import { DEFAULTS, QUALITY_TIERS, SettingsStore, detectQualityTier, type GameSettings } from '../src/ui/Settings.js';

/** Berichte/fps-analyse.md Abschnitt 6, als Werte statt Prosa. */
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

for (const tier of ['low', 'medium', 'high'] as const) {
  for (const [field, expected] of Object.entries(TABLE[tier])) {
    const actual = QUALITY_TIERS[tier][field as keyof (typeof QUALITY_TIERS)[typeof tier]];
    assert.equal(actual, expected, `QUALITY_TIERS.${tier}.${field}`);
  }
}

// applyQualityTier setzt exakt die Tabellenwerte, unabhaengig vom vorherigen Stand.
for (const tier of ['low', 'medium', 'high'] as const) {
  const store = new SettingsStore();
  store.set({
    shadowQuality: 3, grassDensity: 3, waterQuality: 3, detailQuality: 3, vegetationRange: 1,
    bloom: false, depthOfField: false, chromaticAberration: false, antiAliasing: false,
  });
  store.applyQualityTier(tier);
  const state = store.get();
  for (const [field, expected] of Object.entries(TABLE[tier])) {
    assert.equal(state[field as keyof GameSettings], expected, `applyQualityTier(${tier}).${field}`);
  }
  assert.equal(detectQualityTier(state), tier, `detectQualityTier erkennt ${tier} nach dem Setzen`);
}

// Eine gespeicherte eigene Einstellung ausserhalb der neun Stufen-Felder
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

console.log('PASS Qualitaetsstufen: Niedrig/Mittel/Hoch treffen fps-analyse.md Abschnitt 6, fremde Einstellungen ueberleben, Erkennung robust');
