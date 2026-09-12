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
 *
 * Lauf: npx tsx client/test/ausfaelle-zeugen.ts
 */
import { Effect } from '@babylonjs/core/Materials/effect';
import { MIN_KASKADEN, SHADOW_LEVELS, schattenMitLook } from '../src/engine/Shadows';
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

if (fehler > 0) {
  console.log(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log(
  `\nAusfaelle: Kaskadendeckel ${MIN_KASKADEN}, Anker ${ANKER_WINKEL_GRAD}° = ${d1400.toFixed(1)} m bei 1400 m, Komposit ohne Konstantterm — gruen.`
);
