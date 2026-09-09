/**
 * Stufe 2, Bauer „Licht" — was am Look nicht still kaputtgehen darf.
 *
 * Vier Dinge werden festgehalten, und jedes einzelne davon ist in dieser
 * Sitzung schon einmal schiefgegangen:
 *
 *  1. **Das Wetter „Klar-Comic" ist vollstaendig.** Ein EnvSetup hat 30
 *     Felder; wer eines vergisst, bekommt keinen Fehler, sondern den
 *     Wert von `Clear` untergeschoben (`buildEnvironments` legt fremde
 *     Namen ueber Clear). Zusaetzlich wird die GEWICHTETE SUMME am
 *     Messzeitpunkt geprueft — nicht die Keyframe-Zahlen. Ein Keyframe
 *     allein sagt nichts darueber, was auf dem Bildschirm steht: Bei
 *     Tagesbruchteil 0,7083 wiegen Tag 0,408 und Abend 0,604, und erst
 *     ihre Summe ist die Farbe, gegen die kalibriert wurde.
 *
 *  2. **Der `look:`-Block wird geprueft, nicht geschluckt.** Ein
 *     unbekannter Schluessel UND eine verwechselte Skala muessen den
 *     Start beenden. Der zweite Fall ist der teure: `saettigung: 68`
 *     (Babylons Reglerwert statt des Faktors) ist eine gueltige Zahl,
 *     lief durch, wurde im Client zu 6700 und lieferte ein knallgruenes
 *     Bild. Am Modul war nichts zu sehen, am Bild alles.
 *
 *  3. **Der Abend-Stuetzpunkt rechnet, was er verspricht.** Seit der
 *     Nacharbeit vom 09.09.2026 haben `ambColorEvening` und
 *     `lightIntensityEvening` einen eigenen Abschnitt (1c): Wetter ohne
 *     diese Schluessel muessen BITGENAU wie vorher rechnen, Mittag und
 *     Mitternacht muessen auch mit ihnen stehenbleiben, und die
 *     kalibrierte Zahl `direkt` = 1,467 mit 39 % Grundlichtanteil wird
 *     aus den Keyframes nachgerechnet statt behauptet.
 *
 *  4. **Die Nebelkurven sind ineinander umrechenbar.** exp und exp2
 *     liefern bei kalibrierten Dichten DIESELBE Sichtweite. Ohne diese
 *     Rechnung uebernimmt der naechste Umbau die Dichte statt der Sicht
 *     — und bei kleinen Dichten liegen die beiden um mehr als eine
 *     Zehnerpotenz auseinander.
 *
 * Lauf: npx tsx test/stufe2-licht.ts   (aus server/)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  ENVIRONMENTS,
  ENV_CLEAR,
  ENV_KLAR_COMIC,
  LOOK_VORGABE,
  dichteFuerSichtweite,
  evaluateEnv,
  findEnvironment,
  mischeLook,
  phaseWeights,
  pruefeLook,
  sichtweite,
  strahlenTor,
  strahlenWinkel,
  type EnvColor,
} from '@wov/shared';
import { leseLookVorgabe, LookKonfigFehler } from '../src/ServerKonfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let fehler = 0;
const ok = (bedingung: boolean, text: string): void => {
  if (bedingung) {
    console.log(`  PASS  ${text}`);
  } else {
    console.error(`  FAIL  ${text}`);
    fehler++;
  }
};
const nah = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

/**
 * Der Messzeitpunkt des Look-Profils: Tagesbruchteil 0,7083 = 17 h.
 *
 * NICHT 18 h. Bei 0,75 sind Tag- und Nachtgewicht exakt null (der
 * Tagbogen endet dort, der Nachtbogen beginnt dort), und
 * `lightIntensity` zieht ausschliesslich aus diesen beiden — die Sonne
 * ist an diesem einen Punkt schwarz. Das ist kein Fehler dieses Wetters,
 * sondern der Daemmerungs-Nullpunkt des Keyframe-Modells; der Test haelt
 * ihn unten ausdruecklich fest, damit ihn niemand fuer einen Regressions-
 * fund haelt.
 */
const MESSZEITPUNKT = 17 / 24;

// ── 1. Klar-Comic ─────────────────────────────────────────────────────

/** Jedes Feld, das ein EnvSetup hat — aus `Clear` abgeleitet, nicht getippt. */
function alleFelder(): string[] {
  return Object.keys(findEnvironment(ENV_CLEAR)!);
}

function wetterVollstaendig(): void {
  console.log('\n1. Wetter „Klar-Comic"');
  const env = findEnvironment(ENV_KLAR_COMIC);
  ok(env !== undefined, 'Klar-Comic ist als Umgebung bekannt');
  if (!env) return;

  const felder = alleFelder();
  const fehlend = felder.filter((f) => (env as unknown as Record<string, unknown>)[f] === undefined);
  ok(fehlend.length === 0, `alle ${felder.length} EnvSetup-Felder gesetzt${fehlend.length ? ` (fehlt: ${fehlend.join(', ')})` : ''}`);

  // Farben sind SRGB-Werte in 0..1. Ein Wert daneben heisst entweder
  // "linear vorgerechnet" (zu dunkel) oder "als Byte getippt" (255).
  let farbFehler = 0;
  let dichteFehler = 0;
  for (const f of felder) {
    const w = (env as unknown as Record<string, unknown>)[f];
    if (f.startsWith('fogColor') || f.startsWith('sunColor') || f.startsWith('ambColor')) {
      const c = w as EnvColor;
      for (const k of ['r', 'g', 'b'] as const) {
        if (!(c[k] >= 0 && c[k] <= 1)) farbFehler++;
      }
    }
    if (f.startsWith('fogDensity') && !((w as number) > 0)) dichteFehler++;
  }
  ok(farbFehler === 0, 'alle Farbkanaele liegen in 0..1');
  ok(dichteFehler === 0, 'alle vier Nebeldichten sind groesser als null');

  // Die Handschrift des neuen Looks: EINE Dunstfarbe. Der gerichtete
  // Nebel bleibt verdrahtet und wirkt dadurch neutral.
  const gleich = (['Morning', 'Day', 'Evening', 'Night'] as const).every((k) => {
    const a = (env as unknown as Record<string, EnvColor>)[`fogColor${k}`]!;
    const b = (env as unknown as Record<string, EnvColor>)[`fogColorSun${k}`]!;
    return a.r === b.r && a.g === b.g && a.b === b.b;
  });
  ok(gleich, 'fogColorSun == fogColor in allen vier Keyframes (eine kuehle Dunstfarbe)');

  // ── Die gewichtete Summe am Messzeitpunkt ──────────────────────────
  const w = phaseWeights(MESSZEITPUNKT);
  ok(nah(w.day, 0.408, 0.01) && nah(w.evening, 0.604, 0.01), `Gewichte bei 17 h: Tag ${w.day.toFixed(3)}, Abend ${w.evening.toFixed(3)}`);

  const s = evaluateEnv(env, MESSZEITPUNKT);
  // Ziel: #ffe4c6 = (1.000, 0.894, 0.776)
  ok(
    nah(s.sunColor.r, 1.0, 0.05) && nah(s.sunColor.g, 0.894, 0.05) && nah(s.sunColor.b, 0.776, 0.05),
    `Sonnenfarbe trifft #ffe4c6: (${s.sunColor.r.toFixed(3)}, ${s.sunColor.g.toFixed(3)}, ${s.sunColor.b.toFixed(3)})`
  );
  // Ziel: #a3afbd = (0.639, 0.686, 0.741)
  ok(
    nah(s.fogColor.r, 0.639, 0.05) && nah(s.fogColor.g, 0.686, 0.05) && nah(s.fogColor.b, 0.741, 0.05),
    `Nebelfarbe trifft #a3afbd: (${s.fogColor.r.toFixed(3)}, ${s.fogColor.g.toFixed(3)}, ${s.fogColor.b.toFixed(3)})`
  );
  ok(nah(s.fogDensity, 0.0011, 0.0002), `Nebeldichte trifft exp 0,0011: ${s.fogDensity.toFixed(5)}`);
  ok(s.lightIntensity > 1.0, `Sonne leuchtet: ${s.lightIntensity.toFixed(3)}`);
  const elevation = (Math.asin(s.sunDir.y) * 180) / Math.PI;
  ok(nah(elevation, 27, 1.5), `Sonnenstand trifft die 27° des Profils: ${elevation.toFixed(2)}°`);

  // Der Messzeitpunkt bleibt 17 h, aber nicht mehr, weil 18 h kaputt ist
  // — s. `sonneGehtNichtAus`. 17 h ist der Punkt, an dem der Sonnenstand
  // die 27° des Profils trifft.
  const um18 = evaluateEnv(env, 0.75);
  ok(um18.lightIntensity > 0, `18 h liefert wieder Licht: ${um18.lightIntensity.toFixed(3)}`);

  // Alte Wetter bleiben unveraendert: Stichprobe an Clear.
  const clear = findEnvironment(ENV_CLEAR)!;
  ok(
    clear.sunAngle === 45 && nah(clear.fogDensityDay, 0.003, 1e-6),
    'Clear ist unangetastet (sunAngle 45, fogDensityDay 0,003)'
  );
  // Klar-Comic ist NICHT in envData.json: Die Datei schreibt das
  // Dump-Werkzeug neu, ein Eintrag dort waere beim naechsten Lauf weg.
  ok(env.sunAngle === 46, 'Klar-Comic traegt seinen eigenen sunAngle 46 (handgestimmt, nicht aus dem Dump)');
}

// ── 1b. Die Sonne geht ueber 24 h nirgends aus ────────────────────────

/**
 * Der Befund von Bauer „Gras" (09.09.2026), als Wache festgehalten.
 *
 * Gemessen wurde: `lighting.sun.intensity` faellt bei GENAU 6:00 und
 * 18:00 auf 0, das Bild ist dort nachtschwarz. Die Ursache waren ZWEI
 * unabhaengige Stellen, die am selben Augenblick zuschlagen — bei
 * Tagesbruchteil 0,25 und 0,75 sind Tag- und Nachtgewicht exakt null,
 * waehrend der Morgen- bzw. Abend-Keyframe mit 0,5 dasteht:
 *
 *   · `lightIntensity` war eine Summe aus genau diesen beiden Gewichten
 *     → 0. Jetzt eine Interpolation, die an den Enden dasselbe liefert.
 *   · `weighByPhase` warf die tagseitigen Farben weg, sobald `w.day`
 *     null war → sunColor (0,0,0). Jetzt fragt das Tor nach dem GANZEN
 *     tagseitigen Gewicht.
 *
 * Der Test laeuft in Viertelstunden ueber den ganzen Tag und ueber JEDES
 * Wetter, weil beide Fehler Modelleigenschaften waren und keins der
 * Wetter verschont haben.
 */
function sonneGehtNichtAus(): void {
  console.log('\n1b. Sonnenstaerke ueber 24 h (Viertelstunden, alle Wetter)');
  const schritte = 24 * 4;
  let nullen = 0;
  let schwarzeFarben = 0;
  let groessterSprung = 0;
  let sprungWo = '';
  let geprueft = 0;

  for (const env of ENVIRONMENTS) {
    // Hoehlen und Krypten sind AUSDRUECKLICH dunkel (`alwaysDark`, und
    // z. B. Darklands_dark traegt lightIntensityNight 0). Eine Sonne dort
    // waere der Fehler, nicht ihr Fehlen.
    if (env.alwaysDark) continue;
    geprueft++;
    let vorher = evaluateEnv(env, -0.25 / 24);
    for (let i = 0; i < schritte; i++) {
      const h = i * 0.25;
      const st = evaluateEnv(env, h / 24);
      if (!(st.lightIntensity > 0)) {
        nullen++;
        if (nullen <= 3) console.error(`        ${env.name} bei ${h} h: Intensitaet ${st.lightIntensity}`);
      }
      const hell = Math.max(st.sunColor.r, st.sunColor.g, st.sunColor.b);
      if (!(hell > 0)) {
        schwarzeFarben++;
        if (schwarzeFarben <= 3) console.error(`        ${env.name} bei ${h} h: Sonnenfarbe schwarz`);
      }
      const sprung = Math.abs(st.lightIntensity - vorher.lightIntensity);
      if (sprung > groessterSprung) {
        groessterSprung = sprung;
        sprungWo = `${env.name} bei ${h} h`;
      }
      vorher = st;
    }
  }

  ok(nullen === 0, `Sonnenstaerke nirgends 0 (${geprueft} Wetter x ${schritte} Viertelstunden)`);
  ok(schwarzeFarben === 0, 'Sonnenfarbe nirgends (0,0,0)');
  /*
    ── Hier stand `groessterSprung <= 0.5` (bis 09.09.2026) ────────────

    Die absolute Schranke war richtig, solange JEDES Wetter zwischen
    Nacht- und Tagstaerke lag: Der groesste echte Sprung in den Daten
    war 0,37 (Ashlands_ashrain, 6.25 h). Mit dem Abend-Stuetzpunkt von
    `Klar-Comic` (lightIntensityEvening 2,67) spannt dieses eine Wetter
    1,0 bis 2,48, und sein Daemmerungsabfall liegt bei 0,835 je
    Viertelstunde — die Schranke haette damit nicht einen Fehler
    gemeldet, sondern die Spanne. (Zur Groessenordnung: ein Tag dauert
    1800 s, eine Viertelstunde Weltzeit sind 18 Sekunden am Bildschirm.)

    Ersetzt durch ZWEI Pruefungen, die zusammen mehr sagen als die eine:

     1. Der Sprung im VERHAELTNIS zur eigenen Spanne. Alle Wetter mit
        nur zwei Stuetzpunkten liegen exakt bei 0,204 — das ist eine
        Modelleigenschaft, keine Zufallszahl; `Klar-Comic` liegt bei
        0,564. 0,7 laesst beides durch und faengt eine Kurve, die
        innerhalb einer Viertelstunde durchschlaegt.

     2. Die STETIGKEIT selbst, und die haengt an keiner geratenen Zahl:
        Wird hundertmal feiner abgetastet, muss der groesste Schritt
        mitschrumpfen. Bei einer stetigen Kurve tut er das (gemessen:
        Faktor 0,100 fuer die Wurzel-Wetter, 0,024 fuer Klar-Comic); an
        einer echten Sprungstelle bliebe er stehen. Genau das war der
        Fehler vom Vormittag — `lightIntensity` fiel bei 6 und 18 Uhr
        auf 0 und waere bei JEDER Abtastdichte um denselben Betrag
        gesprungen.
  */
  let schlimmsterAnteil = 0;
  let anteilWo = '';
  let schlimmsteVerfeinerung = 0;
  let verfeinerungWo = '';
  const maxSchritt = (env: (typeof ENVIRONMENTS)[number], n: number): number => {
    let m = 0;
    let vor = evaluateEnv(env, -1 / n).lightIntensity;
    for (let i = 0; i < n; i++) {
      const v = evaluateEnv(env, i / n).lightIntensity;
      m = Math.max(m, Math.abs(v - vor));
      vor = v;
    }
    return m;
  };
  for (const env of ENVIRONMENTS) {
    if (env.alwaysDark) continue;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < schritte; i++) {
      const v = evaluateEnv(env, i / schritte).lightIntensity;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    const spanne = max - min;
    if (spanne <= 1e-9) continue; // Wetter mit konstanter Staerke
    const grob = maxSchritt(env, schritte);
    const anteil = grob / spanne;
    if (anteil > schlimmsterAnteil) {
      schlimmsterAnteil = anteil;
      anteilWo = `${env.name}, Spanne ${spanne.toFixed(2)}`;
    }
    const fein = maxSchritt(env, schritte * 100) / (grob || 1);
    if (fein > schlimmsteVerfeinerung) {
      schlimmsteVerfeinerung = fein;
      verfeinerungWo = env.name;
    }
  }
  ok(
    schlimmsterAnteil <= 0.7,
    `kein Sprung ueber 70 % der eigenen Spanne je Viertelstunde (groesster Anteil ${schlimmsterAnteil.toFixed(3)}: ${anteilWo}; absolut ${groessterSprung.toFixed(3)} bei ${sprungWo})`
  );
  ok(
    schlimmsteVerfeinerung <= 0.15,
    `stetig: 100-fach feiner abgetastet schrumpft der groesste Schritt auf ${schlimmsteVerfeinerung.toFixed(3)} (${verfeinerungWo}) — eine Sprungstelle bliebe bei 1,0`
  );

  // Die zwei Zeitpunkte namentlich — der Test soll beim naechsten Mal
  // sagen, WO es klemmt, nicht nur DASS.
  for (const [h, name] of [
    [6, 'Sonnenaufgang'],
    [18, 'Sonnenuntergang'],
  ] as const) {
    const st = evaluateEnv(findEnvironment(ENV_KLAR_COMIC)!, h / 24);
    const hell = Math.max(st.sunColor.r, st.sunColor.g, st.sunColor.b);
    ok(
      st.lightIntensity > 0 && hell > 0,
      `${name} (${h} h, Tagesbruchteil ${(h / 24).toFixed(2)}): Staerke ${st.lightIntensity.toFixed(3)}, Farbe max ${hell.toFixed(3)}`
    );
  }

  // Die Enden duerfen sich NICHT verschoben haben — die Interpolation
  // liefert dort dasselbe wie die alte Summe.
  const clear = findEnvironment(ENV_CLEAR)!;
  ok(
    nah(evaluateEnv(clear, 0).lightIntensity, clear.lightIntensityNight, 1e-9),
    'Mitternacht liefert unveraendert lightIntensityNight'
  );
  ok(
    nah(evaluateEnv(clear, 0.5).lightIntensity, clear.lightIntensityDay, 1e-9),
    'Mittag liefert unveraendert lightIntensityDay'
  );
}

// ── 1c. Der Abend-Stuetzpunkt ─────────────────────────────────────────

/**
 * Die Nacharbeit von Bauer „Licht 2" (09.09.2026), als Wache.
 *
 * Grundlicht und Sonnenstaerke werden zwischen einem TAG- und einem
 * NACHT-Wert interpoliert, gewichtet mit dem TAGGEWICHT. Bei 17 Uhr
 * steht das bei 0,408 — das Grundlicht eines Wetters, das ein ABEND
 * ist, bestand dort also zu 59 % aus dem Nacht-Keyframe, und der Boden
 * bekam 25 % seines Lichts aus dem Grundlicht statt der 39 %, die das
 * Vorbild an dieser Stelle hat. Erhoehen liess sich das nicht: Selbst
 * `ambColorDay` auf reines Weiss gedreht bringt bei 17 Uhr ×1,10 statt
 * der noetigen ×2,23.
 *
 * `ambColorEvening` und `lightIntensityEvening` sind der fehlende
 * zweite Stuetzpunkt. Drei Dinge muessen dabei wahr bleiben:
 *
 *  1. Wer die Schluessel NICHT setzt, rechnet exakt wie vorher. Das
 *     wird nicht behauptet, sondern gegen die alte Formel nachgerechnet
 *     — fuer jedes Wetter, ueber den ganzen Tag.
 *  2. Mittag, Mitternacht und Morgen bleiben auch bei `Klar-Comic`
 *     stehen: Dort ist das abendliche Gewicht null.
 *  3. Die kalibrierten Zahlen stimmen noch. Nachgerechnet wird die
 *     ganze Kette bis zu `direkt` — mit EINER gemessenen Konstante,
 *     der Kuppelhelligkeit, die als solche benannt ist.
 */
function abendStuetzpunkt(): void {
  console.log('\n1c. Abend-Stuetzpunkt (ambColorEvening / lightIntensityEvening)');

  const kc = findEnvironment(ENV_KLAR_COMIC)!;
  ok(
    kc.ambColorEvening !== undefined && kc.lightIntensityEvening !== undefined,
    'Klar-Comic traegt beide Abend-Schluessel'
  );
  const ae = kc.ambColorEvening!;
  ok(
    [ae.r, ae.g, ae.b].every((v) => v >= 0 && v <= 1),
    `ambColorEvening liegt in 0..1: (${ae.r}, ${ae.g}, ${ae.b})`
  );

  // (1) Jedes andere Wetter rechnet Zeichen fuer Zeichen wie vorher.
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  let abweichungen = 0;
  let wo = '';
  for (const env of ENVIRONMENTS) {
    if (env.ambColorEvening !== undefined || env.lightIntensityEvening !== undefined) continue;
    for (let i = 0; i < 96; i++) {
      const t = i / 96;
      const st = evaluateEnv(env, t);
      const w = env.alwaysDark
        ? { night: 1, day: 0, morning: 0, evening: 0 }
        : phaseWeights(t);
      const altI = lerp(env.lightIntensityNight, env.lightIntensityDay, w.day);
      const altAmb = {
        r: lerp(env.ambColorNight.r, env.ambColorDay.r, w.day),
        g: lerp(env.ambColorNight.g, env.ambColorDay.g, w.day),
        b: lerp(env.ambColorNight.b, env.ambColorDay.b, w.day),
      };
      const gleich =
        st.lightIntensity === altI &&
        st.ambColor.r === altAmb.r &&
        st.ambColor.g === altAmb.g &&
        st.ambColor.b === altAmb.b;
      if (!gleich && abweichungen++ === 0) wo = `${env.name} bei ${(t * 24).toFixed(2)} h`;
    }
  }
  ok(
    abweichungen === 0,
    `Wetter ohne Abend-Schluessel rechnen bitgenau wie die alte Formel (0 Abweichungen in ${ENVIRONMENTS.length - 1} x 96 Punkten)${wo ? `, zuerst ${wo}` : ''}`
  );

  // (2) Die drei Zeitpunkte, an denen der Abend nichts zu suchen hat.
  for (const [t, name, erwartet] of [
    [0, 'Mitternacht', kc.lightIntensityNight],
    [0.25, 'Morgen (6 h)', kc.lightIntensityNight],
    [0.5, 'Mittag', kc.lightIntensityDay],
  ] as const) {
    const st = evaluateEnv(kc, t);
    const ambErwartet = t === 0.5 ? kc.ambColorDay : kc.ambColorNight;
    ok(
      nah(st.lightIntensity, erwartet, 1e-9) &&
        nah(st.ambColor.r, ambErwartet.r, 1e-9) &&
        nah(st.ambColor.g, ambErwartet.g, 1e-9) &&
        nah(st.ambColor.b, ambErwartet.b, 1e-9),
      `${name} ist unberuehrt: Staerke ${st.lightIntensity.toFixed(3)}, Grundlicht (${st.ambColor.r.toFixed(3)}, ${st.ambColor.g.toFixed(3)}, ${st.ambColor.b.toFixed(3)})`
    );
  }

  // (3) Die Kalibrierung, nachgerechnet bis zu `direkt`.
  //
  // `Lighting.inLinear()` benutzt Babylons `toLinearSpaceToRef`, und das
  // ist pow(c, 2.2) — NICHT die stueckweise sRGB-Kurve. Hier steht
  // dieselbe Zeile, sonst weicht das Ergebnis um zwei Prozent ab und
  // niemand weiss, warum.
  const linear = (v: number): number => Math.pow(v, 2.2);
  const leuchtdichte = (c: EnvColor): number =>
    0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);

  const st17 = evaluateEnv(kc, MESSZEITPUNKT);
  ok(nah(st17.lightIntensity, 2.219, 0.02), `Sonnenstaerke bei 17 h: ${st17.lightIntensity.toFixed(4)} (kalibriert 2,219)`);
  ok(
    nah(leuchtdichte(st17.ambColor), 0.735, 0.02),
    `Grundlicht bei 17 h, linear: ${leuchtdichte(st17.ambColor).toFixed(4)} (kalibriert 0,735)`
  );

  /*
    Die EINE gemessene Konstante: die mittlere lineare Leuchtdichte der
    Himmelskuppel am Referenzort um 17 Uhr. `Lighting.apply()` zieht das
    Grundlicht um die Haelfte ihres Verhaeltnisses zur Ambientfarbe ab,
    weil die Kuppel als `scene.environmentTexture` dieselbe Aufgabe
    zweimal erfuellen wuerde. Ohne diesen Abzug kaeme hier eine andere
    Zahl heraus als auf dem Bildschirm.

    0,3242, gemessen am 09.09.2026 (10077/−18723, t=0.708333): Die Szene
    meldete Grundlichtstaerke 0,5082 bei einer Ambient-Leuchtdichte von
    0,3296, und 1 − 0,5 · 0,3242/0,3296 ist genau das.
  */
  const KUPPELHELLIGKEIT = 0.3242;
  const LAMBERT_17H = 0.4889; // −lightDir.y am Referenzort, gemessen
  const ambStaerke = 1 - 0.5 * Math.min(1, KUPPELHELLIGKEIT / leuchtdichte(st17.ambColor));
  const sonnenTerm = leuchtdichte(st17.sunColor) * st17.lightIntensity * LAMBERT_17H;
  const ambTerm = leuchtdichte(st17.ambColor) * ambStaerke;
  const direkt = sonnenTerm + ambTerm;
  ok(nah(direkt, 1.467, 0.05), `direkt am Referenzort: ${direkt.toFixed(4)} (Ziel 1,467 = das ×2,0 von Bauer Boden 2)`);
  ok(
    nah(ambTerm / direkt, 0.395, 0.03),
    `Grundlichtanteil: ${(ambTerm / direkt).toFixed(3)} (Vorbild village1.json: 1,1·#a8bcd0 gegen 3,0·#ffe4c6 = 0,395)`
  );

  // Und der Lambert selbst kommt aus denselben Daten — sonst waere die
  // Zahl oben von Hand gesetzt und die Rechnung eine Behauptung.
  const d = st17.lightDir;
  const lambert = -d.y / Math.hypot(d.x, d.y, d.z);
  ok(nah(lambert, LAMBERT_17H, 0.01), `Lambert am flachen Boden folgt aus lightDir: ${lambert.toFixed(4)}`);
}

// ── 2. look: ──────────────────────────────────────────────────────────

function lookGeprueft(): void {
  console.log('\n2. Der look:-Block');

  ok(pruefeLook(undefined).length === 0, 'fehlender Block ist in Ordnung (die Vorgabe gilt)');
  ok(pruefeLook({}).length === 0, 'leerer Block ist in Ordnung');
  ok(pruefeLook({ belichtung: 1.2, himmel: { zenit: '#123456' } }).length === 0, 'Teilangabe ist in Ordnung');

  const unbekannt = pruefeLook({ saettigng: 0.5 });
  ok(unbekannt.length === 1 && unbekannt[0]!.pfad === 'look.saettigng', 'Tippfehler auf oberster Ebene wird gemeldet');

  const tiefUnbekannt = pruefeLook({ schatten: { reichwaite: 90 } });
  ok(
    tiefUnbekannt.length === 1 && tiefUnbekannt[0]!.pfad === 'look.schatten.reichwaite',
    'Tippfehler im Unterabschnitt wird gemeldet (die Pruefung geht in die Tiefe)'
  );

  ok(pruefeLook({ belichtung: 'hell' }).length === 1, 'falscher Typ wird gemeldet');
  ok(pruefeLook({ tonemapping: 'filmisch' }).length === 1, 'unbekannter Tonemapper wird gemeldet');
  ok(pruefeLook({ nebelmodus: 'linear' }).length === 1, 'unbekannte Nebelkurve wird gemeldet');

  // DER teure Fall: gueltige Zahl, falsche Skala.
  const skala = pruefeLook({ saettigung: 68 });
  ok(skala.length === 1 && /Skala/.test(skala[0]!.grund), 'saettigung 68 (Babylons Regler statt Faktor) wird als Skalenfehler gemeldet');
  ok(pruefeLook({ saettigung: 0.45 }).length === 0, 'saettigung 0,45 (der Faktor) geht durch');
  ok(pruefeLook({ schatten: { dunkelheit: 42 } }).length === 1, 'dunkelheit 42 statt 0,42 wird gemeldet');

  // Mischen laesst Unterabschnitte nicht ausbluten (ADR-0040-Falle).
  const gemischt = mischeLook({ bloom: { staerke: 0.4 } });
  ok(
    gemischt.bloom.staerke === 0.4 &&
      gemischt.bloom.schwelle === LOOK_VORGABE.bloom.schwelle &&
      gemischt.bloom.kernel === LOOK_VORGABE.bloom.kernel,
    'Teilangabe im Unterabschnitt laesst die uebrigen Regler stehen'
  );
  ok(mischeLook({ unbekannt: 1 }).tonemapping === LOOK_VORGABE.tonemapping, 'unbekannter Schluessel beim Mischen ist wirkungslos');

  // Der Draht bis zum Start: leseLookVorgabe wirft.
  const werfe = (yaml: Record<string, unknown>): boolean => {
    try {
      leseLookVorgabe(yaml);
      return false;
    } catch (e) {
      return e instanceof LookKonfigFehler;
    }
  };
  ok(werfe({ look: { saettigng: 0.5 } }), 'leseLookVorgabe wirft bei unbekanntem Schluessel (Start endet)');
  ok(werfe({ look: { saettigung: 68 } }), 'leseLookVorgabe wirft bei verwechselter Skala');
  ok(leseLookVorgabe({}) === undefined, 'ohne look:-Block liefert leseLookVorgabe undefined');

  // Die ECHTE server.yml muss durchgehen — sonst startet der Server nicht.
  const echt = resolve(__dirname, '../data/server.yml');
  if (existsSync(echt)) {
    const doc = (parseYaml(readFileSync(echt, 'utf-8')) ?? {}) as Record<string, unknown>;
    const befunde = pruefeLook(doc.look);
    ok(befunde.length === 0, `die echte server.yml haelt der Pruefung stand${befunde.length ? `: ${befunde.map((b) => b.pfad).join(', ')}` : ''}`);
  }

  // Die Vorgabe selbst muss durch ihre eigene Pruefung gehen.
  ok(pruefeLook(LOOK_VORGABE as unknown as Record<string, unknown>).length === 0, 'LOOK_VORGABE haelt der eigenen Pruefung stand');
}

// ── 3. Nebelkurve ─────────────────────────────────────────────────────

function nebelkurve(): void {
  console.log('\n3. Nebelkurve exp gegen exp2');

  // Die Aussage: Bei kalibrierten Dichten liefern BEIDE Kurven dieselbe
  // Sichtweite. Genau deshalb darf man die Dichte NICHT uebernehmen.
  for (const weite of [200, 630, 1500]) {
    const dExp = dichteFuerSichtweite('exp', weite);
    const dExp2 = dichteFuerSichtweite('exp2', weite);
    const wExp = sichtweite('exp', dExp);
    const wExp2 = sichtweite('exp2', dExp2);
    ok(
      nah(wExp, weite, 1e-6) && nah(wExp2, weite, 1e-6),
      `${weite} m: exp d=${dExp.toFixed(6)} und exp2 d=${dExp2.toFixed(6)} ergeben beide ${weite} m`
    );
    ok(!nah(dExp, dExp2, 1e-9), `  … und die Dichten sind dabei VERSCHIEDEN (Faktor ${(dExp2 / dExp).toFixed(4)})`);
  }

  // Die Rechnung aus dem Kopf der Wetterdaten: exp 0,0011 ohne Potenz ist
  // dieselbe Sicht wie exp 0,0005 MIT der 2,2-Potenz, die der Boden des
  // Schwesterprojekts anwendet. pow(exp(-d·z), 2.2) = exp(-2.2·d·z).
  const w0011 = sichtweite('exp', 0.0011);
  const w0005mitPotenz = sichtweite('exp', 0.0005 * 2.2);
  ok(nah(w0011, w0005mitPotenz, 1), `exp 0,0011 ohne Potenz = exp 0,0005 mit pow 2,2 (${w0011.toFixed(0)} m)`);
  ok(nah(w0011, 630, 5), `Sichtweite des Profils liegt bei rund 630 m: ${w0011.toFixed(0)} m`);

  // Dichte 0 heisst "kein Nebel", nicht "Division durch null".
  ok(sichtweite('exp', 0) === Number.POSITIVE_INFINITY, 'Dichte 0 ergibt unendliche Sicht statt NaN');
}

// ── 4. Strahlen-Tor ───────────────────────────────────────────────────

function strahlenTorPruefen(): void {
  console.log('\n4. Strahlen-Tor (ADR-0042)');
  const achse = { x: 0, y: 0, z: 1 };
  ok(nah(strahlenWinkel(achse, { x: 0, y: 0, z: 1 }), 0, 1e-6), 'Sonne in der Blickachse: 0°');
  ok(nah(strahlenWinkel(achse, { x: 1, y: 0, z: 0 }), 90, 1e-6), 'Sonne quer: 90°');
  ok(nah(strahlenWinkel(achse, { x: 0, y: 0, z: -1 }), 180, 1e-6), 'Sonne im Ruecken: 180°');
  // Rundung ueber 1 darf kein NaN geben — acos(1.0000001) waere NaN, und
  // ein NaN im Tor hiesse "Effekt bleibt an, wo er luegt".
  ok(Number.isFinite(strahlenWinkel({ x: 0, y: 0, z: 1.0000001 }, { x: 0, y: 0, z: 1 })), 'Rundung ueber 1 ergibt kein NaN');

  const { torWinkel: tw, hysterese: hy } = LOOK_VORGABE.strahlen;
  ok(strahlenTor(0, tw, hy) === 1, '0° — volle Staerke');
  ok(strahlenTor(41, tw, hy) === 1, '41° (Bildecke bei 16:9) — volle Staerke, die Sonne faechert noch herein');
  ok(strahlenTor(55, tw, hy) === 0, '55° — aus');
  ok(strahlenTor(90, tw, hy) === 0, '90° (die Singularitaet) — aus');
  ok(strahlenTor(180, tw, hy) === 0, '180° (Sonne im Ruecken) — aus');
  const mitte = strahlenTor(52.5, tw, hy);
  ok(mitte > 0 && mitte < 1, `im Band wird geblendet statt geschaltet: 52,5° → ${mitte.toFixed(2)}`);
}

function main(): void {
  wetterVollstaendig();
  sonneGehtNichtAus();
  abendStuetzpunkt();
  lookGeprueft();
  nebelkurve();
  strahlenTorPruefen();
}

try {
  main();
  if (fehler === 0) {
    console.log('\nPASS: Klar-Comic vollstaendig, look: geprueft, Nebelkurven umrechenbar');
    process.exit(0);
  }
  console.error(`\nFAIL: ${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
} catch (err) {
  console.error('FAIL:', err);
  process.exit(1);
}
