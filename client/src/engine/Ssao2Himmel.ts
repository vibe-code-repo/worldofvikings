/**
 * Ssao2Himmel — der Himmel bleibt bei eingeschalteter Umgebungsverdeckung
 * hell.
 *
 * ── Der Fehler ───────────────────────────────────────────────────────
 * Mit `ambientOcclusion` an wurden auf Babylon 9.28 Himmel und Ferne
 * schwarz (Helligkeit je Sechstel von oben, Lichtung: 8.56 `115 95 76 65
 * 71 51`, 9.28 `16 52 71 66 71 51`).
 *
 * ── Die Ursache ──────────────────────────────────────────────────────
 * Der Geometriepuffer wird mit (0, 0, 0, 0) geleert, und der Himmel
 * schreibt nichts hinein: Tiefe 0 und Normale (0, 0, 0). Der SSAO2-Shader
 * liest die Normale in 8.56 roh
 *
 *     vec3 normal=textureLod(normalSampler,vUV,0.0).rgb;
 *
 * und in 9.x (Weltraum-Normalen, #18539) mit `normalize(...)`:
 *
 *     vec3 normal=normalize(textureLod(normalSampler,vUV,0.0).rgb);
 *
 * `normalize(vec3(0))` ist 0/0 = NaN. Das NaN läuft durch die
 * Tangentenbasis in jede Stichprobe, das Ergebnis der Verdeckung wird NaN
 * und `clamp(NaN, 0, 1)` liefert auf der GPU 0 — schwarz. Tiefe 0 heißt
 * beim Shader eigentlich „nichts da“ (`sign(depth)` = 0 schaltet die
 * Verdeckung für den Pixel ab); nur die Normale hat das nicht überlebt.
 *
 * ── Die Korrektur ────────────────────────────────────────────────────
 * Eine Textersetzung im `ShaderStore` (wie `StrahlenAnker`): Ist die
 * Normale die Nullnormale, nimmt der Shader (0, 0, 1) statt zu
 * normalisieren. Alle Pixel mit Geometrie behalten ihren Weg unverändert
 * (`dot(n, n) > 0` ist dort immer wahr). Das Ergebnis am Himmel ist
 * dasselbe wie in 8.56: keine Verdeckung.
 *
 * Beide Shader-Sprachen: GLSL (`ShadersStore`) und der WGSL-Zwilling
 * (`ShadersStoreWGSL`, WebGPU, `?webgpu=1`) tragen dieselbe Zeile und
 * bekommen dieselbe Ersetzung. Der WGSL-Shader wird hier statisch
 * importiert: Babylon lädt ihn sonst erst bei der ersten Übersetzung
 * nach, und ein Modul wird nur einmal ausgewertet — die Ersetzung sitzt
 * also sicher vor der ersten Übersetzung und wird nicht überschrieben.
 *
 * In English: both shader languages (GLSL and WGSL/WebGPU) are patched. 9.x normalizes the geometry-buffer normal in the SSAO2
 * shader; sky pixels hold the clear value (0,0,0), so the result is NaN
 * and the sky renders black. The patch keeps the zero normal instead of
 * normalizing it.
 */
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
// SEITENEFFEKT, nicht wegoptimieren: Ohne diese Importe stehen die Shader
// noch nicht im Store, und die Ersetzung unten liefe ins Leere. Der WGSL-
// Import sorgt zugleich dafuer, dass Babylon den Shader nicht spaeter
// nachlaedt (das Modul ist dann schon ausgewertet).
// Side effect imports: the shaders must be in the stores before the patch.
import '@babylonjs/core/Shaders/ssao2.fragment';
import '@babylonjs/core/ShadersWGSL/ssao2.fragment';

const SHADER = 'ssao2PixelShader';

interface Sprache {
  /** Anzeigename fuer Meldungen. */
  readonly name: 'GLSL' | 'WGSL';
  readonly store: Record<string, string>;
  /** Die Zeile, wie sie in Babylon 9.28.0 im Quelltext steht. */
  readonly alt: string;
  readonly neu: string;
  /** Ungeschuetztes normalize() auf der gelesenen Normale, in jeder Schreibweise. */
  readonly ungeschuetzt: RegExp;
}

const SPRACHEN: readonly Sprache[] = [
  {
    name: 'GLSL',
    store: Effect.ShadersStore,
    alt: 'vec3 normal=normalize(textureLod(normalSampler,vUV,0.0).rgb);',
    neu:
      'vec3 normalRoh=textureLod(normalSampler,vUV,0.0).rgb;' +
      'vec3 normal=dot(normalRoh,normalRoh)>0.0 ? normalize(normalRoh) : vec3(0.0,0.0,1.0);',
    ungeschuetzt: /normalize\s*\(\s*texture\w*\s*\(\s*normalSampler/,
  },
  {
    name: 'WGSL',
    store: ShaderStore.ShadersStoreWGSL,
    alt: 'var normal: vec3f=normalize(textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb);',
    // select(falsch, wahr, bedingung); beide Zweige werden berechnet, das NaN
    // von normalize(0) wird verworfen.
    neu:
      'var normalRoh: vec3f=textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb;' +
      'var normal: vec3f=select(vec3f(0.0,0.0,1.0),normalize(normalRoh),dot(normalRoh,normalRoh)>0.0);',
    ungeschuetzt: /normalize\s*\(\s*textureSample\w*\s*\(\s*normalSampler/,
  },
];

/**
 * Stand einer Sprache:
 *  - `korrigiert`: unsere Ersetzung steht im Shader.
 *  - `babylon-faengt-ab`: das Muster fehlt, weil Babylon das Normalisieren
 *    der Nullnormale selbst nicht mehr (ungeschuetzt) tut — die Korrektur
 *    kann entfernt werden.
 *  - `muster-veraendert`: das Muster fehlt, der Shader normalisiert die
 *    Normale aber weiter ungeschuetzt (Babylon hat die Zeile umgeschrieben)
 *    — die Korrektur fehlt, der Himmel wird schwarz.
 *  - `kein-shader`: der Shader steht gar nicht im Store.
 */
export type SsaoZustand = 'korrigiert' | 'babylon-faengt-ab' | 'muster-veraendert' | 'kein-shader';

const zustaende = new Map<string, SsaoZustand>();

function korrigiere(sprache: Sprache): SsaoZustand {
  const quelle = sprache.store[SHADER];
  if (typeof quelle !== 'string') return 'kein-shader';
  if (quelle.includes(sprache.neu)) return 'korrigiert';
  if (!quelle.includes(sprache.alt)) {
    return sprache.ungeschuetzt.test(quelle) ? 'muster-veraendert' : 'babylon-faengt-ab';
  }
  sprache.store[SHADER] = quelle.replace(sprache.alt, sprache.neu);
  return 'korrigiert';
}

/**
 * Die Nullnormale im SSAO2-Shader abfangen (s. Kopfkommentar), in GLSL und
 * WGSL. Idempotent und ohne Ausnahme; liefert true, wenn beide Sprachen
 * korrigiert sind. Den Grund eines false nennt `ssaoHimmelZustand()`.
 */
export function korrigiereSsaoHimmel(): boolean {
  for (const sprache of SPRACHEN) {
    if (zustaende.get(sprache.name) !== 'korrigiert') zustaende.set(sprache.name, korrigiere(sprache));
  }
  return SPRACHEN.every((s) => zustaende.get(s.name) === 'korrigiert');
}

/** Zeuge: Zustand je Sprache, frisch aus dem Store gelesen. / Witness. */
export function ssaoHimmelZustand(): Record<'GLSL' | 'WGSL', SsaoZustand> {
  const aus = { GLSL: 'kein-shader', WGSL: 'kein-shader' } as Record<'GLSL' | 'WGSL', SsaoZustand>;
  for (const sprache of SPRACHEN) {
    const quelle = sprache.store[SHADER];
    if (typeof quelle !== 'string') continue;
    if (quelle.includes(sprache.neu) && !quelle.includes(sprache.alt)) aus[sprache.name] = 'korrigiert';
    else if (quelle.includes(sprache.alt) || sprache.ungeschuetzt.test(quelle)) aus[sprache.name] = 'muster-veraendert';
    else aus[sprache.name] = 'babylon-faengt-ab';
  }
  return aus;
}

/** Zeuge: Ist die Ersetzung in beiden Sprachen wirklich im Shader? / Witness. */
export function ssaoHimmelKorrigiert(): boolean {
  const z = ssaoHimmelZustand();
  return z.GLSL === 'korrigiert' && z.WGSL === 'korrigiert';
}

// Muss vor der ersten Uebersetzung des SSAO-Shaders laufen — ein Import
// dieser Datei genuegt dafuer.
korrigiereSsaoHimmel();
