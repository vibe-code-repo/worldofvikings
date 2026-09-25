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
 * Nur der WebGL-Shader. Den WGSL-Zweig (WebGPU) trifft der Fehler
 * gleichermaßen im Quelltext, er ist hier aber nicht angefasst und nicht
 * gemessen — die Verdeckung im WebGPU-Pfad bleibt ein offener Punkt.
 *
 * In English: 9.x normalizes the geometry-buffer normal in the SSAO2
 * shader; sky pixels hold the clear value (0,0,0), so the result is NaN
 * and the sky renders black. The patch keeps the zero normal instead of
 * normalizing it.
 */
import { Effect } from '@babylonjs/core/Materials/effect';
// SEITENEFFEKT, nicht wegoptimieren: Ohne diesen Import steht der Shader
// noch nicht im Store, und die Ersetzung unten liefe ins Leere.
// Side effect import: the shader must be in the store before the patch.
import '@babylonjs/core/Shaders/ssao2.fragment';

const SHADER = 'ssao2PixelShader';
/** Die Zeile, wie sie in Babylon 9.28.0 im Quelltext steht. */
const NORMALE_ALT = 'vec3 normal=normalize(textureLod(normalSampler,vUV,0.0).rgb);';
const NORMALE_NEU =
  'vec3 normalRoh=textureLod(normalSampler,vUV,0.0).rgb;' +
  'vec3 normal=dot(normalRoh,normalRoh)>0.0 ? normalize(normalRoh) : vec3(0.0,0.0,1.0);';
let stand: boolean | null = null;

/**
 * Die Nullnormale im SSAO2-Shader abfangen (s. Kopfkommentar). Idempotent
 * und ohne Ausnahme: Findet die Ersetzung ihr Muster nicht, meldet der
 * Zeuge false statt einer stillen Rückkehr des schwarzen Himmels.
 */
export function korrigiereSsaoHimmel(): boolean {
  if (stand !== null) return stand;
  const quelle = Effect.ShadersStore[SHADER];
  if (typeof quelle !== 'string' || !quelle.includes(NORMALE_ALT)) {
    stand = false;
    return false;
  }
  Effect.ShadersStore[SHADER] = quelle.replace(NORMALE_ALT, NORMALE_NEU);
  stand = true;
  return true;
}

/** Zeuge: Ist die Ersetzung wirklich im Shader? / Witness. */
export function ssaoHimmelKorrigiert(): boolean {
  const quelle = Effect.ShadersStore[SHADER] ?? '';
  return stand === true && quelle.includes(NORMALE_NEU) && !quelle.includes(NORMALE_ALT);
}

// Muss vor der ersten Übersetzung des SSAO-Shaders laufen — ein Import
// dieser Datei genügt dafür.
korrigiereSsaoHimmel();
