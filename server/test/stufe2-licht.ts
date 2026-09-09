/**
 * Stufe 2, Bauer „Licht" — was am Look nicht still kaputtgehen darf.
 *
 * Drei Dinge werden festgehalten, und jedes einzelne davon ist in dieser
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
 *  3. **Die Nebelkurven sind ineinander umrechenbar.** exp und exp2
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
  // 0,5 je Viertelstunde ist die Schranke gegen einen wiederkehrenden
  // Einbruch, nicht gegen die Daemmerung selbst: Der groesste echte
  // Sprung in den Daten liegt bei 0,37 (Ashlands_ashrain, 6.25 h).
  ok(groessterSprung <= 0.5, `kein Sprung > 0,5 je Viertelstunde (groesster: ${groessterSprung.toFixed(3)}, ${sprungWo})`);

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
