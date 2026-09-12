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
  tagseitenAnteil,
  type EnvColor,
} from '@wov/shared';
import { leseLookVorgabe, LookKonfigFehler } from '../src/ServerKonfig.js';
// A1/A4: der Latch und die Vorgaben der Grafikoptionen. Beide Module sind
// bewusst frei von Babylon- und DOM-Abhaengigkeiten, sonst liefe hier nichts.
import { strahlenLatch } from '../../client/src/engine/strahlenLatch.js';
import { DEFAULTS } from '../../client/src/ui/Settings.js';

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

  /*
    ── Das Ziel ist seit dem 10.09.2026 ein anderes ────────────────────
    Hier standen #ffe4c6 (Sonne) und #a3afbd (Nebel) — die Zahlen aus
    `village1.json` des SCHWESTERPROJEKTS. Sie sind nicht falsch
    gemessen, sie sind nur nicht mehr das Vorbild: Gemessen wird jetzt
    gegen Tale of Dark Lands, Szene Level1 (design/original-boden.md §D).

    Und weil dessen Sonne FEST steht, ist die Prüfung eine andere
    geworden. Das Vorbild hat EINE Sonnenfarbe und EINEN Nebel; im
    Keyframe-Modell heisst das: Die gewichtete Summe bei 17 h muss
    denselben Wert liefern wie der TAG-Keyframe. Genau dafür ist
    `*Evening` auf Tag × 0,98013 gesetzt (die Farbsumme wiegt 1,012, s.
    environment.ts) — und genau das prüft dieser Block. Er hält damit
    nicht mehr eine Zielfarbe fest, sondern eine EIGENSCHAFT: dass die
    Stimmung über den Tag steht und nur der Sonnenstand wandert.
  */
  const s = evaluateEnv(env, MESSZEITPUNKT);
  const tagSonne = env.sunColorDay;
  const tagNebel = env.fogColorDay;
  // Sonne #FFC98C = (1.000, 0.788, 0.549)
  ok(
    nah(tagSonne.r, 1.0, 0.01) && nah(tagSonne.g, 0.788, 0.01) && nah(tagSonne.b, 0.549, 0.01),
    `Tag-Sonne ist #FFC98C: (${tagSonne.r}, ${tagSonne.g}, ${tagSonne.b})`
  );
  // Nebel #73A7FF = (0.450, 0.654, 1.000)
  ok(
    nah(tagNebel.r, 0.45, 0.01) && nah(tagNebel.g, 0.654, 0.01) && nah(tagNebel.b, 1.0, 0.01),
    `Tag-Nebel ist #73A7FF: (${tagNebel.r}, ${tagNebel.g}, ${tagNebel.b})`
  );
  ok(
    nah(s.sunColor.r, tagSonne.r, 0.03) && nah(s.sunColor.g, tagSonne.g, 0.03) && nah(s.sunColor.b, tagSonne.b, 0.03),
    `17 h traegt dieselbe Sonnenfarbe wie der Mittag: (${s.sunColor.r.toFixed(3)}, ${s.sunColor.g.toFixed(3)}, ${s.sunColor.b.toFixed(3)})`
  );
  ok(
    nah(s.fogColor.r, tagNebel.r, 0.03) && nah(s.fogColor.g, tagNebel.g, 0.03) && nah(s.fogColor.b, tagNebel.b, 0.03),
    `17 h traegt dieselbe Nebelfarbe wie der Mittag: (${s.fogColor.r.toFixed(3)}, ${s.fogColor.g.toFixed(3)}, ${s.fogColor.b.toFixed(3)})`
  );
  ok(s.lightIntensity > 0.5, `Sonne leuchtet: ${s.lightIntensity.toFixed(3)}`);
  /*
    Der Sonnenstand ist das EINZIGE, was sich über den Tag bewegt — und
    er tut es weiterhin. Mittags stehen die 50° des Vorbilds an
    (`sunAngle` IST der Mittagsstand), um 17 h entsprechend weniger.
  */
  const elevation = (Math.asin(s.sunDir.y) * 180) / Math.PI;
  const mittag = evaluateEnv(env, 0.5);
  const elevMittag = (Math.asin(mittag.sunDir.y) * 180) / Math.PI;
  ok(nah(elevMittag, 50, 2), `Mittag trifft die 50° des Vorbilds: ${elevMittag.toFixed(2)}°`);
  ok(elevation > 20 && elevation < elevMittag - 10, `17 h steht tiefer als der Mittag: ${elevation.toFixed(2)}°`);

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
  ok(env.sunAngle === 50, 'Klar-Comic traegt den Sonnenstand des Vorbilds (sunAngle 50, §D)');
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
      // Die MENGE Tag kommt seit dem 12.09.2026 aus dem Sonnenstand und
      // nicht mehr aus dem Phasengewicht. Hier stand `w.day` — und genau
      // das war die zweite Uhr, an der zwischen 03:13 und 05:54 sowie
      // zwischen 18:06 und 20:23 die Sonne oben stand, waehrend alle drei
      // tagseitigen Gewichte null waren (300 von 1440 Stuetzstellen).
      // Eine Referenzformel, die den Fehler mitrechnet, prueft nichts.
      const ta = env.alwaysDark ? 0 : tagseitenAnteil(st.elevation);
      const altI = lerp(env.lightIntensityNight, env.lightIntensityDay, ta);
      const altAmb = {
        r: lerp(env.ambColorNight.r, env.ambColorDay.r, ta),
        g: lerp(env.ambColorNight.g, env.ambColorDay.g, ta),
        b: lerp(env.ambColorNight.b, env.ambColorDay.b, ta),
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
  //
  // Bei f = 0,25 stand hier bis zum 12.09.2026 das NACHTlicht als
  // Sollwert — und es traf zu, weil die Sonne dort auf Elevation 0,4894
  // (24,5 Grad) stand und trotzdem kein tagseitiges Gewicht trug. Der
  // Test hat den Fehler nicht gefunden, er hat ihn festgehalten. Neu
  // sind es die gemessenen Tagwerte: lightIntensity 0,970000, ambColor
  // (0,5640 / 0,6650 / 0,8110). Mitternacht und Mittag bleiben, wie sie
  // waren.
  for (const [t, name, erwartet] of [
    [0, 'Mitternacht', kc.lightIntensityNight],
    [0.25, 'Morgen (6 h)', kc.lightIntensityDay],
    [0.5, 'Mittag', kc.lightIntensityDay],
  ] as const) {
    const st = evaluateEnv(kc, t);
    const ambErwartet = t === 0 ? kc.ambColorNight : kc.ambColorDay;
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

  /*
    ── Was hier bis zum 10.09.2026 stand, und warum es weg ist ─────────

    Drei Zahlen: Sonnenstaerke 2,219 bei 17 h, Grundlicht-Leuchtdichte
    0,735 und `direkt` = 1,467. Alle drei sind gegen `village1.json` des
    Schwesterprojekts kalibriert gewesen (#ffe4c6 x 3,0 gegen #a8bcd0 x
    1,1). Diese Vorlage ist nicht mehr das Ziel — gemessen wird gegen
    Tale of Dark Lands, und dessen Sonne steht FEST.

    Was an ihre Stelle tritt, ist keine kleinere Zusage, sondern eine
    andere: Der ABSOLUTE Pegel gehoert seit dieser Runde `look.belichtung`
    (server.yml) und nicht den Keyframes. Ohne Tonemapper ist ein
    sRGB-Luma-VERHAELTNIS unabhaengig von der Belichtung; die Keyframes
    stellen also das Verhaeltnis ein, die Belichtung die Helligkeit. Ein
    Test, der hier `direkt = 1,467` festnagelt, wuerde genau diese
    Trennung wieder zunageln.

    Geprueft werden deshalb die zwei EIGENSCHAFTEN, an denen das Bild
    haengt und die keine Belichtung repariert:

      1. Der Abend traegt Tag-Sonne und Tag-Grundlicht — EINE Sonne,
         wie im Vorbild. Nur der Winkel wandert.
      2. Der GRUNDLICHTANTEIL an der Gesamtbeleuchtung. Er ist die
         Groesse, die entscheidet, wie stark zwei Albedos im Bild
         auseinanderliegen: Grundlicht addiert auf jede Flaeche denselben
         Betrag und drueckt jedes Verhaeltnis Richtung 1. Am Bild
         kalibriert liegt er bei 0,43 (Bergblick und Weitblick,
         10.09.2026); das Vorbild kommt mit 1,1 x #a8bcd0 gegen 3,0 x
         #ffe4c6 auf dieselbe Groessenordnung.
  */
  ok(
    nah(st17.lightIntensity, kc.lightIntensityDay, 1e-9),
    `17 h traegt die Tag-Sonnenstaerke: ${st17.lightIntensity.toFixed(4)} = ${kc.lightIntensityDay}`
  );
  ok(
    nah(st17.ambColor.r, kc.ambColorDay.r, 1e-9) &&
      nah(st17.ambColor.g, kc.ambColorDay.g, 1e-9) &&
      nah(st17.ambColor.b, kc.ambColorDay.b, 1e-9),
    `17 h traegt das Tag-Grundlicht: (${st17.ambColor.r}, ${st17.ambColor.g}, ${st17.ambColor.b})`
  );

  /*
    Die EINE gemessene Konstante: die mittlere lineare Leuchtdichte der
    Himmelskuppel am Referenzort. `Lighting.apply()` zieht das Grundlicht
    um die Haelfte ihres Verhaeltnisses zur Ambientfarbe ab, weil die
    Kuppel als `scene.environmentTexture` dieselbe Aufgabe zweimal
    erfuellen wuerde. Ohne diesen Abzug kaeme hier eine andere Zahl
    heraus als auf dem Bildschirm.
  */
  const KUPPELHELLIGKEIT = 0.3242;
  // Der Lambert kommt aus den DATEN und nicht aus einer getippten Zahl —
  // sonst waere die Rechnung darunter eine Behauptung. Er wandert mit
  // `sunAngle`, und `sunAngle` ist mit den 50° des Vorbilds gewandert.
  const d = st17.lightDir;
  const lambert = -d.y / Math.hypot(d.x, d.y, d.z);
  ok(lambert > 0.3 && lambert < 0.7, `Lambert am flachen Boden bei 17 h: ${lambert.toFixed(4)}`);
  const ambStaerke = 1 - 0.5 * Math.min(1, KUPPELHELLIGKEIT / leuchtdichte(st17.ambColor));
  const sonnenTerm = leuchtdichte(st17.sunColor) * st17.lightIntensity * lambert;
  const ambTerm = leuchtdichte(st17.ambColor) * ambStaerke;
  const direkt = sonnenTerm + ambTerm;
  ok(
    nah(ambTerm / direkt, 0.43, 0.06),
    `Grundlichtanteil: ${(ambTerm / direkt).toFixed(3)} (am Bild kalibriert 0,43; direkt = ${direkt.toFixed(4)})`
  );
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
  // `linear` IST seit dem 10.09.2026 eine Kurve (die des Vorbilds) —
  // der Tippfehler von damals ist der Regelfall von heute.
  ok(pruefeLook({ nebelmodus: 'linear' }).length === 0, 'die Nebelkurve `linear` geht durch');
  ok(pruefeLook({ nebelmodus: 'exp3' }).length === 1, 'unbekannte Nebelkurve wird gemeldet');
  /*
    Und die Kurve, die das Vorbild faehrt, kennt keine Dichte: Ihre halbe
    Sicht liegt in der Mitte zwischen Start und Ende, nicht bei
    −ln(0,5)/d. Wer das verwechselt, rechnet mit 0,0009 eine Sichtweite
    von 770 m aus, waehrend der Nebel bei 200 m voll deckt.
  */
  ok(
    sichtweite('linear', 0, 0.5, 15, 200) === 107.5,
    `linear 15 → 200 m halbiert die Sicht bei 107,5 m: ${sichtweite('linear', 0, 0.5, 15, 200)}`
  );
  ok(Number.isNaN(dichteFuerSichtweite('linear', 200)), 'fuer `linear` gibt es keine Dichte — NaN statt einer stillen Zahl');

  // DER teure Fall: gueltige Zahl, falsche Skala.
  const skala = pruefeLook({ saettigung: 68 });
  ok(skala.length === 1 && /Skala/.test(skala[0]!.grund), 'saettigung 68 (Babylons Regler statt Faktor) wird als Skalenfehler gemeldet');
  ok(pruefeLook({ saettigung: 0.45 }).length === 0, 'saettigung 0,45 (der Faktor) geht durch');
  // Der Grading-Block ist neu und muss dieselbe Pruefung bestehen wie
  // alles andere: unbekannter Schluessel = Befund, gueltiger = still.
  ok(pruefeLook({ grading: { mitten: '#fff5ef' } }).length === 0, 'ein gueltiger Grading-Schluessel geht durch');
  ok(pruefeLook({ grading: { mittenTon: '#fff5ef' } }).length === 1, 'ein unbekannter Grading-Schluessel wird gemeldet');
  ok(pruefeLook({ schatten: { kaskaden: 1 } }).length === 0, 'look.schatten.kaskaden ist ein bekannter Regler');
  ok(pruefeLook({ schatten: { dunkelheit: 42 } }).length === 1, 'dunkelheit 42 statt 0,42 wird gemeldet');
  // Ein NEGATIVER Grading-Offset ist gueltig und seit dem 12.09.2026 der
  // Normalfall: Die Dorf-Schattenzeile traegt −0,044477392, und ein
  // positiver Offset wirkt in dieser Zeile vierfach. Waere der Bereich
  // [0,1] statt [−1,1], wuerde der Server mit der ausgelieferten
  // server.yml nicht mehr starten — und zwar erst beim naechsten
  // Kaltstart, nicht beim Aendern.
  ok(
    pruefeLook({ grading: { schattenOffset: -0.044477392 } }).length === 0,
    'ein negativer Grading-Offset geht durch (−0,044477392 ist der Dorf-Wert)'
  );

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

  // Die EINZIGE Reihenfolge-Bedingung im ganzen Profil, und die einzige,
  // die `pruefeLook` strukturell nicht sehen kann: Ueberlappen Schatten-
  // und Lichterband, wird das Mittengewicht `1 − fS − fH` negativ und
  // die Tabelle kehrt Farben um. Geprueft wird die AUSGELIEFERTE
  // Vorgabe, nicht ein Beispiel — die Reihenfolge kann nur dort kippen.
  ok(
    LOOK_VORGABE.grading.schattenEnde <= LOOK_VORGABE.grading.lichterStart,
    `Schatten- und Lichterband ueberlappen nicht: schattenEnde ${LOOK_VORGABE.grading.schattenEnde} <= lichterStart ${LOOK_VORGABE.grading.lichterStart}`
  );
}

// ── 2b. LOOK_VORGABE deckt sich mit server.yml ────────────────────────

/*
  Roadmap-Paket 0.8. Die Vorgabe gilt in genau dem Fenster zwischen dem
  ersten Bild und dem Eintreffen des `look:`-Blocks vom Server — und im
  Editor und in jedem Werkzeug ohne Serververbindung gilt sie dauerhaft.
  Wich sie ab (bis zum 12.09.2026 an sechs Stellen, am auffaelligsten
  `belichtung` 1,0 gegen 1,42), sah der Ladebildschirm anders aus als das
  Spiel, und weil beide Bilder fuer sich stimmig sind, faellt das
  niemandem auf.

  Verglichen wird, was in `server.yml` STEHT — Feld fuer Feld, rekursiv.
  Schluessel, die die Vorgabe zusaetzlich fuehrt (die Wolken- und
  Halo-Felder aus `LOOK_HIMMEL_PLUS_VORGABE`), sind ausdruecklich
  erlaubt: Sie stehen absichtlich nicht in der Datei. Umgekehrt nicht:
  Ein Feld in `server.yml`, das die Vorgabe nicht kennt, waere genau der
  Fall, den `pruefeLook` oben schon meldet.
*/
function vorgabeDecktServerYml(): void {
  console.log('\n2b. LOOK_VORGABE deckt sich mit server.yml (Roadmap 0.8)');

  const echt = resolve(__dirname, '../data/server.yml');
  if (!existsSync(echt)) {
    ok(false, 'server.yml gefunden');
    return;
  }
  const doc = (parseYaml(readFileSync(echt, 'utf-8')) ?? {}) as Record<string, unknown>;
  const look = doc.look as Record<string, unknown> | undefined;
  ok(look !== undefined && look !== null, 'server.yml fuehrt einen look:-Block');
  if (!look) return;

  const abweichungen: string[] = [];
  const gleich = (a: unknown, b: unknown): boolean =>
    typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-12 : a === b;

  const vergleiche = (yml: Record<string, unknown>, vorgabe: Record<string, unknown>, pfad: string): void => {
    for (const [k, wert] of Object.entries(yml)) {
      const hier = pfad ? `${pfad}.${k}` : k;
      const soll = vorgabe?.[k];
      if (wert !== null && typeof wert === 'object' && !Array.isArray(wert)) {
        if (soll === null || typeof soll !== 'object') {
          abweichungen.push(`${hier}: server.yml hat einen Block, die Vorgabe nicht`);
          continue;
        }
        vergleiche(wert as Record<string, unknown>, soll as Record<string, unknown>, hier);
        continue;
      }
      if (!gleich(wert, soll)) abweichungen.push(`${hier}: server.yml ${JSON.stringify(wert)} gegen Vorgabe ${JSON.stringify(soll)}`);
    }
  };
  vergleiche(look, LOOK_VORGABE as unknown as Record<string, unknown>, '');

  ok(
    abweichungen.length === 0,
    `jedes Feld des look:-Blocks steht so in LOOK_VORGABE${abweichungen.length ? `\n     ${abweichungen.join('\n     ')}` : ''}`
  );

  // Die vier Zahlen, an denen diese Runde haengt, noch einmal beim Namen
  // — damit ein stiller Rueckfall nicht nur als „eine Abweichung" oben
  // erscheint, sondern als die Entscheidung, die er ist.
  ok(LOOK_VORGABE.belichtung === 1.42, `Belichtung 1,42 (war 1,0): ${LOOK_VORGABE.belichtung}`);
  ok(LOOK_VORGABE.kontrast === 0.84, `Kontrast 0,84 — der eine gegenlaeufige Regler: ${LOOK_VORGABE.kontrast}`);
  ok(LOOK_VORGABE.nebelEnde === 800, `Nebelende 800 m (war 200, Entscheidung E3): ${LOOK_VORGABE.nebelEnde}`);
  ok(
    LOOK_VORGABE.schatten.kaskaden === 2 && LOOK_VORGABE.schatten.dunkelheit === 0.2,
    `Schatten: ${LOOK_VORGABE.schatten.kaskaden} Kaskaden (Babylons Deckel), Restlicht ${LOOK_VORGABE.schatten.dunkelheit}`
  );
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
  ok(nah(w0011, 630, 5), `die alte exp-Sicht lag bei rund 630 m: ${w0011.toFixed(0)} m`);
  /*
    ── Was hier stand, und warum es nicht mehr stimmt ──────────────────

    Bis zum 12.09.2026 hielt dieser Test fest: „Das Vorbild sieht sechsmal
    kuerzer" — `linear 15 → 200 m` gegen die alte exp-Kurve mit 630 m.
    Das war richtig gemessen und ist durch eine ENTSCHEIDUNG ueberholt
    (E3): Das Nebelende steht seit heute auf 800 m, gemessen an drei
    Zeugen (Ferne B−R 26,1 → 2,1; Struktur der Ferne +14,6 Luma bis
    800 m, danach ~1 Luma je 100 m; Ferne/Himmel 0,550 gegen gemessene
    0,53). Die FARBE des Nebels ist dabei unveraendert geblieben.

    Die Zusage wird deshalb nicht geloescht, sondern auf das gedreht,
    was jetzt gilt und was beim naechsten Umbau wieder kippen kann:

     · Die lineare Sicht ist weiter KUERZER als die alte exp-Kurve
       (408 m gegen 630 m) — der Umstieg auf `linear` hat die Ferne
       nicht heimlich geoeffnet.
     · Sie ist zugleich deutlich WEITER als die 108 m, die `nebelEnde
       200` ergab. Genau das ist die Entscheidung, und sie steht hier
       als Zahl, damit ein Rueckfall auf 200 auffaellt.
     · Und `nebelStart` bleibt so weit unter `nebelEnde`, dass die
       Rechnung nicht entartet.
  */
  const sichtLinear = sichtweite('linear', 0, 0.5, LOOK_VORGABE.nebelStart, LOOK_VORGABE.nebelEnde);
  const sichtAlt200 = sichtweite('linear', 0, 0.5, LOOK_VORGABE.nebelStart, 200);
  ok(
    sichtLinear < w0011,
    `linear bleibt kuerzer als die alte exp-Kurve: ${sichtLinear.toFixed(0)} m gegen ${w0011.toFixed(0)} m`
  );
  ok(
    sichtLinear > 3 * sichtAlt200,
    `E3 hat die Sicht mehr als verdreifacht: ${sichtAlt200.toFixed(0)} m (nebelEnde 200) → ${sichtLinear.toFixed(0)} m (nebelEnde ${LOOK_VORGABE.nebelEnde})`
  );
  ok(
    LOOK_VORGABE.nebelStart < LOOK_VORGABE.nebelEnde,
    `nebelStart ${LOOK_VORGABE.nebelStart} liegt unter nebelEnde ${LOOK_VORGABE.nebelEnde}`
  );

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

// ── 5. Strahlen-Latch (A1) ────────────────────────────────────────────

/**
 * Der Latch haengt den Pass wirklich ab — und darf dabei nicht flackern.
 *
 * Geprueft wird die ENTSCHEIDUNG, nicht das Umhaengen: `strahlenLatch()`
 * ist genau die Funktion, die `PostProcessing.update()` je Bild fragt.
 * Das Umhaengen selbst (zwei Listen, `setzeMsaa`) braucht eine Kamera und
 * wird im Browser gemessen (`~/.cache/wov-lab/a1-*.json`).
 *
 * Die Zahl, um die es geht, ist die der UMSCHALTUNGEN ueber einen
 * Schwenk. Ohne sie ist „flackert nicht" eine Behauptung.
 */
function strahlenLatchPruefen(): void {
  console.log('\n5. Strahlen-Latch (A1)');
  const { torWinkel: tw, hysterese: hy } = LOOK_VORGABE.strahlen;
  const tor = (w: number): number => strahlenTor(w, tw, hy);

  ok(strahlenLatch(tor(0), false) === true, '0° aus dem Stand: haengt an');
  ok(strahlenLatch(tor(180), true) === false, '180° (Sonne im Ruecken): haengt ab');
  // Die Haltezone. Beide Richtungen, sonst prueft man nur eine Haelfte.
  ok(strahlenLatch(tor(52.5), true) === true, 'im Band angehaengt: bleibt angehaengt');
  ok(strahlenLatch(tor(52.5), false) === false, 'im Band abgehaengt: bleibt abgehaengt');
  // Und die beiden Kanten, an denen doch geschaltet wird.
  ok(strahlenLatch(tor(50), false) === true, '50° (Tor voll offen): schaltet ein');
  ok(strahlenLatch(tor(55), true) === false, '55° (Tor ganz zu): schaltet aus');
  // Kaputte Zahl: Zustand halten, nicht „an" raten.
  ok(strahlenLatch(Number.NaN, false) === false, 'NaN laesst den Zustand stehen (aus bleibt aus)');
  ok(strahlenLatch(Number.NaN, true) === true, 'NaN laesst den Zustand stehen (an bleibt an)');

  /*
    Der Zeuge aus der Karte: „Schwenk ueber 52–53° flackert nicht."
    Nachgestellt als Schwenk in 0,1°-Schritten hin und zurueck; gezaehlt
    wird, wie oft der Latch kippt. Der Schwenk im Band zaehlt NULL, ein
    Schwenk ueber das ganze Band genau eins je Richtung.
  */
  const schwenk = (
    von: number,
    bis: number,
    start: boolean
  ): { zustand: boolean; wechsel: number } => {
    let zustand = start;
    let wechsel = 0;
    const schritt = von < bis ? 0.1 : -0.1;
    for (let w = von; schritt > 0 ? w <= bis + 1e-9 : w >= bis - 1e-9; w += schritt) {
      const neu = strahlenLatch(tor(w), zustand);
      if (neu !== zustand) wechsel++;
      zustand = neu;
    }
    return { zustand, wechsel };
  };

  const hin = schwenk(52, 53, true);
  const zurueck = schwenk(53, 52, hin.zustand);
  ok(
    hin.wechsel + zurueck.wechsel === 0,
    `52° → 53° → 52° angehaengt: ${hin.wechsel + zurueck.wechsel} Umschaltungen (0 erwartet)`
  );
  const hinAus = schwenk(52, 53, false);
  const zurueckAus = schwenk(53, 52, hinAus.zustand);
  ok(
    hinAus.wechsel + zurueckAus.wechsel === 0,
    `52° → 53° → 52° abgehaengt: ${hinAus.wechsel + zurueckAus.wechsel} Umschaltungen (0 erwartet)`
  );
  const raus = schwenk(45, 60, true);
  const rein = schwenk(60, 45, raus.zustand);
  ok(
    raus.wechsel === 1 && rein.wechsel === 1,
    `45° → 60° → 45°: genau je eine Umschaltung (${raus.wechsel}/${rein.wechsel})`
  );
  ok(rein.zustand === true, '… und am Ende haengt der Pass wieder');
  /*
    Die Richtung, in der das Abhaengen unsichtbar sein MUSS: Beim
    Verlassen des Bandes steht die Belichtung schon auf 0, weil die Rampe
    sie dorthin gefahren hat. Das Abhaengen aendert dann kein Bild mehr.
  */
  ok(
    tor(55.0001) === 0,
    'beim Abhaengen ist die Belichtung bereits 0 — das Abhaengen aendert kein Bild'
  );
}

// ── 6. Vorgaben der Grafikoptionen (A4) ───────────────────────────────

/**
 * Bewegungsunschaerfe steht auf AUS — und der Schalter existiert weiter.
 *
 * Beide Haelften zaehlen. Eine Vorgabe umlegen ist eine Zeile; sie
 * versehentlich zusammen mit der Option zu entfernen ebenfalls, und
 * niemandem faellt es auf, weil ein fehlender Schalter genauso aussieht
 * wie ein Schalter, den keiner anfasst.
 *
 * Und: Die Vorgabe steht an ZWEI Stellen — `DEFAULTS` in ui/Settings.ts
 * (was der Spieler bekommt) und `DEFAULT_POSTPROCESSING` in
 * engine/PostProcessing.ts (was vor dem Anmelden gilt). Laufen sie
 * auseinander, haengt der Geometrie-Pass fuer ein paar Bilder an und
 * wieder ab, ohne dass irgendwo ein Schalter kippt.
 */
function vorgabenGrafikoptionen(): void {
  console.log('\n6. Vorgaben der Grafikoptionen (A4)');
  ok(DEFAULTS.motionBlur === false, 'ui/Settings.ts: Bewegungsunschaerfe ist AUS voreingestellt');
  ok('motionBlur' in DEFAULTS, 'die Option gibt es weiter — nur die Vorgabe hat sich geaendert');
  // Der Schalter im Einstellungsfenster ist der Teil, den ein Test sonst
  // nicht sieht: Ohne diese Zeile faende ihn niemand mehr.
  const panel = readFileSync(resolve(__dirname, '../../client/src/ui/SettingsPanel.ts'), 'utf8');
  ok(
    panel.includes("'settings.motion_blur'"),
    'und er steht weiter im Einstellungsfenster (settings.motion_blur)'
  );
  /*
    `DEFAULT_POSTPROCESSING` wird gelesen statt importiert: engine/
    PostProcessing.ts zieht die halbe Babylon-Pipeline mit sich und laeuft
    in einem Node-Test nicht an. Gesucht wird deshalb im Quelltext — und
    zwar in dem Block, um den es geht, nicht irgendwo in der Datei.
  */
  const pp = readFileSync(resolve(__dirname, '../../client/src/engine/PostProcessing.ts'), 'utf8');
  const anfang = pp.indexOf('export const DEFAULT_POSTPROCESSING');
  // Bis zum Ende des Objektliterals, nicht bis zum naechsten Kommentar: Ein
  // Suchanker im Kommentar daneben faellt beim ersten Umformulieren aus, und
  // ein `indexOf` mit -1 schnitte dann die halbe Datei mit hinein — der Test
  // wuerde gruen bleiben, weil irgendwo darin schon `motionBlur: false` steht.
  const ende = pp.indexOf('\n};', anfang);
  const block = anfang >= 0 && ende > anfang ? pp.slice(anfang, ende) : '';
  ok(block.includes('motionBlur'), 'DEFAULT_POSTPROCESSING als Block gefunden');
  ok(
    /motionBlur:\s*false/.test(block),
    'engine/PostProcessing.ts: derselbe Rueckfallwert vor dem Anmelden'
  );
  // Die Sonnenstrahlen bleiben, was sie waren — A4 fasst sie nicht an,
  // die Entscheidung ueber ihre Vorgabe ist A2.
  ok(DEFAULTS.sunShafts === false, 'Sonnenstrahlen unveraendert AUS (ihre Vorgabe entscheidet A2)');
}

function main(): void {
  wetterVollstaendig();
  sonneGehtNichtAus();
  abendStuetzpunkt();
  lookGeprueft();
  vorgabeDecktServerYml();
  nebelkurve();
  strahlenTorPruefen();
  strahlenLatchPruefen();
  vorgabenGrafikoptionen();
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
