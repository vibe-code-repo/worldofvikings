/**
 * Die drei Ausfaelle (F3): was sich OHNE GPU festhalten laesst.
 *
 * Schatten, Sonnenstrahlen und TAA haben am 11.09.2026 alle drei denselben
 * Fehler gehabt — sie liefen, kosteten und wirkten nicht. Zwei der drei
 * Reparaturen brauchen zum Nachweis ein Bild (Rotkanal im Verdeckungspuffer,
 * Versatz in der Projektionsmatrix); diese Datei haelt die Stuecke fest, die
 * reine Rechnung sind, und genau die verfallen sonst still:
 *
 *  1. Der Kaskadendeckel. `kaskaden: 1` im Look-Profil war nie eine
 *     Einstellung — Babylon klemmt auf zwei. Steht der Deckel nicht auch bei
 *     uns, laufen Profil, Anzeige und Kostenrechnung wieder auseinander.
 *  2. Der Ankerdurchmesser. Er folgt einem WINKEL; eine Zahl in Metern waere
 *     bei 1400 m Ankerabstand ein Viertel eines Bildpunkts im
 *     Viertel-Verdeckungspuffer — also wieder nichts.
 *  3. Die Komposit-Korrektur. Sie ist eine Textersetzung im Shader-Store und
 *     kann nach einem Babylon-Wechsel STILL ausbleiben; dann waere jeder
 *     angehaengte Strahlenpass wieder ein 10-%-Aufheller auf dem ganzen Bild.
 *  4. Die SSAO-Himmelkorrektur (`Ssao2Himmel`): ebenfalls eine Textersetzung.
 *     Bleibt sie aus, wird der Himmel mit Umgebungsverdeckung schwarz —
 *     unter GLSL wie unter WGSL (WebGPU).
 *
 * Lauf: npx tsx client/test/ausfaelle-zeugen.ts
 */
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ssao2PixelShader } from '@babylonjs/core/Shaders/ssao2.fragment';
import { ssao2PixelShaderWGSL } from '@babylonjs/core/ShadersWGSL/ssao2.fragment';
import { MIN_KASKADEN, SHADOW_LEVELS, schattenMitLook } from '../src/engine/Shadows';
import { korrigiereSsaoHimmel, ssaoHimmelKorrigiert, ssaoHimmelZustand } from '../src/engine/Ssao2Himmel';
import {
  ANKER_WINKEL_GRAD,
  ankerDurchmesser,
  kompositKorrigiert,
  korrigiereStrahlenKomposit,
} from '../src/engine/StrahlenAnker';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  FEHLGESCHLAGEN: ${was}`);
  }
}

// ── 1. Kaskaden ─────────────────────────────────────────────────────────
const stufe = SHADOW_LEVELS[2]!;
const einsGewuenscht = schattenMitLook(stufe, {
  aufloesung: 1024,
  reichweite: 50,
  kaskaden: 1,
});
pruefe(
  einsGewuenscht?.kaskaden === MIN_KASKADEN,
  `kaskaden: 1 aus dem Profil muss auf ${MIN_KASKADEN} geklemmt werden (Babylon tut es ohnehin), ist ${einsGewuenscht?.kaskaden}`
);
pruefe(einsGewuenscht?.distanz === 50, 'die Reichweite des Profils muss die Stufe ersetzen');
pruefe(
  einsGewuenscht?.aufloesung === 1024,
  'die Aufloesung bleibt die Obergrenze aus Stufe und Profil'
);

const vierGewuenscht = schattenMitLook(stufe, { aufloesung: 4096, reichweite: 150, kaskaden: 4 });
pruefe(vierGewuenscht?.kaskaden === 4, 'ein Profilwert ueber dem Deckel muss unberuehrt bleiben');
pruefe(
  vierGewuenscht?.aufloesung === stufe.aufloesung,
  'die Aufloesung darf die Stufe nicht ueberschreiten'
);

const ohneWunsch = schattenMitLook(stufe, { aufloesung: 4096, reichweite: 120 });
pruefe(ohneWunsch?.kaskaden === stufe.kaskaden, 'ohne Profilwert entscheidet die Stufe');

pruefe(schattenMitLook(null, { aufloesung: 1, reichweite: 1 }) === null, '„aus" bleibt „aus"');

// Jede ausgelieferte Stufe muss den Deckel schon von sich aus halten —
// sonst stuende die Klemme nur im Profilpfad und nicht im Normalfall.
for (let i = 1; i < SHADOW_LEVELS.length; i++) {
  const s = SHADOW_LEVELS[i];
  if (!s) continue;
  pruefe(s.kaskaden >= MIN_KASKADEN, `Stufe ${i} steht unter dem Kaskadendeckel`);
}

// ── 2. Ankerdurchmesser ─────────────────────────────────────────────────
pruefe(ANKER_WINKEL_GRAD >= 2, 'unter 2° hat der radiale Blur im Viertel-Puffer nichts zu greifen');
const d1400 = ankerDurchmesser(1400);
// 2 * 1400 * tan(2°) = 97,8 m
pruefe(Math.abs(d1400 - 97.8) < 0.5, `Anker bei 1400 m misst ${d1400.toFixed(1)} m statt ~97,8 m`);
pruefe(
  Math.abs(ankerDurchmesser(2800) - 2 * d1400) < 1e-6,
  'der Durchmesser muss LINEAR mit dem Abstand wachsen — sonst ist es kein Winkel'
);
pruefe(ankerDurchmesser(0) === 0, 'Abstand 0 ergibt keinen Anker');

// Die Zahl, um die es geht: Bildpunkte im Verdeckungspuffer. Er laeuft mit
// passRatio 0,25 auf 400x225; bei 60° Bildwinkel sind das 3,75 Punkte je Grad.
const punkteImPuffer = ANKER_WINKEL_GRAD * (225 / 60);
pruefe(
  punkteImPuffer >= 8,
  `Anker deckt nur ${punkteImPuffer.toFixed(1)} Bildpunkte im Viertel-Puffer ab`
);

// ── 3. Komposit-Shader ──────────────────────────────────────────────────
// Der Import von StrahlenAnker hat die Ersetzung als Seiteneffekt schon
// gefahren; der zweite Aufruf prueft zugleich, dass sie idempotent ist.
pruefe(korrigiereStrahlenKomposit() === true, 'die Komposit-Korrektur hat ihr Muster nicht gefunden');
pruefe(kompositKorrigiert(), 'der Konstantterm steht noch im Shader');
const quelle = Effect.ShadersStore['volumetricLightScatteringPixelShader'] ?? '';
pruefe(quelle.length > 0, 'der Komposit-Shader steht gar nicht im Store');
pruefe(!quelle.includes('1.5-0.4'), 'der 10-%-Konstantterm ist noch im Shader');
pruefe(
  quelle.includes('+realColor)') || quelle.includes('+ realColor)'),
  'der Streuterm wird nicht mehr additiv ueber das Szenenbild gelegt'
);
// Zaehlen: genau EINE Ersetzung, nicht zwei — sonst waere der Shader beim
// zweiten Aufruf ein zweites Mal angefasst worden.
pruefe(
  (quelle.match(/realColor/g) ?? []).length === 3,
  'der Shader nennt `realColor` nicht mehr genau dreimal (Lesen, Alpha, Summand)'
);

// ── 4. SSAO2-Nullnormale (GLSL und WGSL) ────────────────────────────────
// Der Import von Ssao2Himmel hat die Ersetzung als Seiteneffekt schon gefahren.
// Rot bleibt hier gewollt, sobald das Muster fehlt: ein Babylon-Update soll
// angesehen werden. Die Meldung nennt aber den GRUND, denn die zwei Faelle
// verlangen Gegensaetzliches — hat Babylon die Nullnormale selbst im Griff,
// kann die Korrektur weg; hat es die Zeile nur umgeschrieben, muss das Muster
// nachgezogen werden, sonst wird der Himmel mit Umgebungsverdeckung schwarz.
const ssaoZustand = ssaoHimmelZustand();
for (const sprache of ['GLSL', 'WGSL'] as const) {
  const z = ssaoZustand[sprache];
  if (z === 'babylon-faengt-ab') {
    pruefe(
      false,
      `SSAO ${sprache}: Muster nicht gefunden, weil Babylon die Nullnormale selbst nicht mehr ungeschuetzt normalisiert — die Korrektur (Ssao2Himmel.ts) kann fuer ${sprache} entfernt werden`
    );
  } else if (z === 'muster-veraendert') {
    pruefe(
      false,
      `SSAO ${sprache}: Muster veraendert, Korrektur fehlt — der Shader normalisiert die Normale weiter ungeschuetzt (Himmel wird schwarz); Muster in Ssao2Himmel.ts nachziehen`
    );
  } else if (z === 'kein-shader') {
    pruefe(false, `SSAO ${sprache}: der SSAO2-Shader steht gar nicht im Store`);
  }
}
pruefe(korrigiereSsaoHimmel() === true, 'die SSAO-Korrektur ist nicht in beiden Sprachen angekommen');
pruefe(ssaoHimmelKorrigiert(), 'die SSAO-Korrektur steht nicht in beiden Shadern');
const ssaoQuelle = Effect.ShadersStore['ssao2PixelShader'] ?? '';
pruefe(!ssaoQuelle.includes('vec3 normal=normalize(textureLod('), 'GLSL: die Normale wird noch ungeschuetzt normalisiert');
pruefe(
  (ssaoQuelle.match(/normalRoh/g) ?? []).length === 4,
  'GLSL: der Shader nennt `normalRoh` nicht genau viermal (Lesen, zwei Mal dot, normalize)'
);
const ssaoWgsl = ShaderStore.ShadersStoreWGSL['ssao2PixelShader'] ?? '';
pruefe(ssaoWgsl.length > 0, 'WGSL: der SSAO2-Shader steht gar nicht im Store');
pruefe(!ssaoWgsl.includes('normalize(textureSampleLevel(normalSampler'), 'WGSL: die Normale wird noch ungeschuetzt normalisiert');
pruefe(
  (ssaoWgsl.match(/normalRoh/g) ?? []).length === 4,
  'WGSL: der Shader nennt `normalRoh` nicht genau viermal (Lesen, zwei Mal dot, normalize)'
);

// Die erwartete Zeile je Sprache als LITERAL, nicht aus Ssao2Himmel.ts
// uebernommen: vertauschte select-/?:-Zweige (Ersatznormale bei vorhandener
// Geometrie) muessen hier rot werden. Aendert man den Patch, zieht man diese
// Zeilen bewusst mit. Grenze: Zieht man Quelle UND Literal gleichsinnig mit
// (etwa beide Zweige vertauscht), bleibt dieser Zeuge gruen — das Literal ist
// eine Schwelle, kein Beweis. Den Beweis liefert nur ein Bild mit Nullnormale.
const GLSL_ALT = 'vec3 normal=normalize(textureLod(normalSampler,vUV,0.0).rgb);';
const GLSL_NEU =
  'vec3 normalRoh=textureLod(normalSampler,vUV,0.0).rgb;' +
  'vec3 normal=dot(normalRoh,normalRoh)>0.0 ? normalize(normalRoh) : vec3(0.0,0.0,1.0);';
const WGSL_ALT =
  'var normal: vec3f=normalize(textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb);';
const WGSL_NEU =
  'var normalRoh: vec3f=textureSampleLevel(normalSampler,normalSamplerSampler,input.vUV,0.0).rgb;' +
  'var normal: vec3f=select(vec3f(0.0,0.0,1.0),normalize(normalRoh),dot(normalRoh,normalRoh)>0.0);';
pruefe(ssaoQuelle.includes(GLSL_NEU), 'GLSL: die korrigierte Zeile steht nicht woertlich im Shader');
pruefe(ssaoWgsl.includes(WGSL_NEU), 'WGSL: die korrigierte Zeile steht nicht woertlich im Shader');

// Der Store wird nach dem Import zurueckgesetzt (ein Modul laedt den Shader
// spaeter nach): der naechste Aufruf muss ihn wieder reparieren.
// Die ALT-Literale muessen Babylons ORIGINAL-Shader treffen (dessen Konstante
// wird von der Korrektur nicht veraendert). Sonst ist das Zuruecksetzen unten
// wirkungslos oder falsch, und die Folgepruefungen meldeten den Falschen: dann
// ist das Test-Literal veraltet, nicht `korrigiereSsaoHimmel()` kaputt.
const glslLiteralOk = ssao2PixelShader.shader.includes(GLSL_ALT);
const wgslLiteralOk = ssao2PixelShaderWGSL.shader.includes(WGSL_ALT);
pruefe(glslLiteralOk, 'GLSL: Test-Literal GLSL_ALT passt nicht mehr zum Babylon-Shader, Literal nachziehen');
pruefe(wgslLiteralOk, 'WGSL: Test-Literal WGSL_ALT passt nicht mehr zum Babylon-Shader, Literal nachziehen');
Effect.ShadersStore['ssao2PixelShader'] = ssaoQuelle.replace(GLSL_NEU, GLSL_ALT);
ShaderStore.ShadersStoreWGSL['ssao2PixelShader'] = ssaoWgsl.replace(WGSL_NEU, WGSL_ALT);
const glslZurueck = Effect.ShadersStore['ssao2PixelShader'] !== ssaoQuelle;
const wgslZurueck = ShaderStore.ShadersStoreWGSL['ssao2PixelShader'] !== ssaoWgsl;
pruefe(glslZurueck, 'GLSL: das Zuruecksetzen war ein Leerlauf, Test-Literal GLSL_NEU/GLSL_ALT passt nicht mehr zum Babylon-Shader, Literal nachziehen');
pruefe(wgslZurueck, 'WGSL: das Zuruecksetzen war ein Leerlauf, Test-Literal WGSL_NEU/WGSL_ALT passt nicht mehr zum Babylon-Shader, Literal nachziehen');
// Folgepruefungen nur, wenn die Literale taugen (sonst waeren sie Falschmeldungen).
if (glslLiteralOk && wgslLiteralOk && glslZurueck && wgslZurueck) {
  pruefe(korrigiereSsaoHimmel() === true, 'nach Zuruecksetzen des Stores meldet der Aufruf keinen Erfolg');
  pruefe(
    (Effect.ShadersStore['ssao2PixelShader'] ?? '').includes(GLSL_NEU),
    'GLSL: ein erneuter Aufruf repariert den zurueckgesetzten Store nicht'
  );
  pruefe(
    (ShaderStore.ShadersStoreWGSL['ssao2PixelShader'] ?? '').includes(WGSL_NEU),
    'WGSL: ein erneuter Aufruf repariert den zurueckgesetzten Store nicht'
  );
}

if (fehler > 0) {
  console.log(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log(
  `\nAusfaelle: Kaskadendeckel ${MIN_KASKADEN}, Anker ${ANKER_WINKEL_GRAD}° = ${d1400.toFixed(1)} m bei 1400 m, Komposit ohne Konstantterm, SSAO-Nullnormale abgefangen — gruen.`
);
