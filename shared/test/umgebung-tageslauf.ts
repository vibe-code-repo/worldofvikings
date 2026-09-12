/**
 * Der Tageslauf hat EINE Uhr — die Wache dazu.
 *
 * ── Was hier festgehalten wird ───────────────────────────────────────
 *
 * Bis zum 11.09.2026 liefen im Tageslauf zwei Uhren gegeneinander. Die
 * Phasengewichte kannten den Tag zwischen f = 0,25 und f = 0,75, der
 * Sonnenbogen zwischen f = 0,1333 und f = 0,85. Auf **19,6 % des Zyklus**
 * (300 von 1440 Stützstellen) stand die Sonne damit bis zu 19° hoch,
 * während Sonnenfarbe, Nebel und Grundlicht ausschliesslich aus dem
 * NACHT-Keyframe kamen. Gemessen am Modell:
 *
 *   · f = 0,7625 (18:18): Sonnenleuchtdichte 0,0046 = 0,73 % des Mittags
 *     — der 27. Teil der Mitternachtshelligkeit, bei 18,7° Sonnenstand.
 *   · zwischen f = 0,7375 und f = 0,7625 fiel sie um den Faktor 176.
 *   · dasselbe Loch morgens ab Sonnenaufgang bis f = 0,24.
 *   · auf 7,2 % des Zyklus summierten Tag- und Abendgewicht auf bis zu
 *     1,199 und hoben die Sonnenfarbe mit (1,180/0,930/0,648) über Weiss.
 *   · 244 von 359 Schritten zwischen f = 0,60 und f = 0,85 gingen nach
 *     OBEN: die Sonne wurde heller, während sie sank.
 *
 * Alle fünf Befunde sind Eigenschaften, keine Zahlen aus einem Bild —
 * deshalb stehen sie hier und nicht in einem Messprotokoll. Ein Rückfall
 * auf zwei Uhren macht diese Datei rot, egal an welcher Stelle er passiert.
 *
 * Was NICHT geprüft wird: wie das Ergebnis aussieht. Dafür gibt es die
 * Bildmessung am Steinkreis (`?t=0.7625`), s. den Bericht zu F1.
 *
 * Lauf: npx tsx shared/test/umgebung-tageslauf.ts   (aus der Repo-Wurzel)
 *
 * One clock, not two: guards the day-side model against the regression
 * where the phase weights said "night" while the sun was still up.
 */

import {
  ENVIRONMENTS,
  ENV_KLAR_COMIC,
  FRACTION_SUNRISE,
  FRACTION_SUNSET,
  evaluateEnv,
  findEnvironment,
  kuppelNacht,
  phaseWeights,
  tagseitenAnteil,
  type EnvSetup,
} from '../src/environment.js';

let fehler = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    fehler++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * GAMMA: Babylon linearisiert mit `pow(x, 2.2)` und NICHT mit der exakten
 * sRGB-EOTF (`math.constants.js:10`). Der Unterschied ist keine
 * Haarspalterei — mit der EOTF gerechnet kam für 18:18 die Zahl 0,0081
 * heraus statt 0,0046, also fast das Doppelte, und eine ganze Messreihe
 * war zu verwerfen. Wer diese Datei erweitert, rechnet mit pow(x, 2.2).
 */
const toLinear = (v: number): number => Math.pow(Math.max(0, v), 2.2);
const luma = (c: { r: number; g: number; b: number }): number =>
  0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);

/** Die Leuchtdichte, die die Sonne liefert: Keyframe-Farbe mal Stärke. */
const sonne = (env: EnvSetup, f: number): number => {
  const st = evaluateEnv(env, f);
  return luma(st.sunColor) * st.lightIntensity;
};

/** Dasselbe mal Einfallswinkel auf ebenen Boden — was der Boden bekommt. */
const bodensonne = (env: EnvSetup, f: number): number => {
  const st = evaluateEnv(env, f);
  // `lightDir` ist NICHT normalisiert (y trägt einen 0,05-Sockel);
  // Babylon normalisiert beim Setzen, also hier auch.
  const len = Math.hypot(st.lightDir.x, st.lightDir.y, st.lightDir.z);
  return luma(st.sunColor) * st.lightIntensity * Math.max(0, -st.lightDir.y / len);
};

const N = 1440;
const klar = findEnvironment(ENV_KLAR_COMIC);
if (!klar) {
  console.error('Klar-Comic fehlt — ohne das Look-Wetter ist diese Datei sinnlos.');
  process.exit(1);
}
const tagWetter = ENVIRONMENTS.filter((e) => !e.alwaysDark);

console.log('\nTageslauf — eine Uhr statt zwei:');

// ── 1. Kein Loch: Sonne oben heisst Tagseite ──────────────────────────
//
// Der Kern der Karte F1. Die Schranke ist 10 % des Mittagswerts; vor der
// Reparatur lagen 300 von 1440 Stützstellen darunter, der tiefste Punkt
// bei 0,57 %.
console.log('\n1. Sonne über dem Horizont → Tagseite gilt');
{
  const mittag = sonne(klar, 0.5);
  let loecher = 0;
  let min = Infinity;
  let minF = 0;
  for (let i = 0; i < N; i++) {
    const f = i / N;
    const st = evaluateEnv(klar, f);
    if (!(st.elevation > 0)) continue;
    const anteil = sonne(klar, f) / mittag;
    if (anteil < min) {
      min = anteil;
      minF = f;
    }
    if (anteil < 0.1) loecher++;
  }
  check(
    'kein Punkt mit Sonne über dem Horizont unter 10 % des Mittags',
    loecher === 0,
    `${loecher} von ${N}; kleinster Anteil ${(min * 100).toFixed(1)} % bei f = ${minF.toFixed(4)} (vorher 0,57 % bei f = 0,24)`
  );
  // Die beiden Löcher namentlich — der Test soll sagen, WO es klemmt.
  for (const [f, name] of [
    [0.24, 'Morgenloch'],
    [0.7625, 'Abendloch (18:18)'],
  ] as const) {
    const anteil = sonne(klar, f) / mittag;
    check(
      `${name} bei f = ${f} ist zu`,
      anteil >= 0.1,
      `${(anteil * 100).toFixed(1)} % des Mittags (vorher 0,57 % bzw. 0,73 %)`
    );
  }
}

// ── 2. Die Sonne wird nicht heller, während sie sinkt ─────────────────
console.log('\n2. Monotonie zwischen f = 0,60 und f = 0,85');
{
  const von = Math.ceil(0.6 * N);
  const bis = Math.floor(FRACTION_SUNSET * N);
  let anstiege = 0;
  let ersterAnstieg = '';
  let anstiegeBoden = 0;
  let vorher = sonne(klar, (von - 1) / N);
  let vorherBoden = bodensonne(klar, (von - 1) / N);
  for (let i = von; i <= bis; i++) {
    const f = i / N;
    const s = sonne(klar, f);
    const b = bodensonne(klar, f);
    if (s > vorher + 1e-12) {
      anstiege++;
      if (!ersterAnstieg) ersterAnstieg = `f = ${f.toFixed(4)}: ${vorher.toFixed(4)} → ${s.toFixed(4)}`;
    }
    if (b > vorherBoden + 1e-12) anstiegeBoden++;
    vorher = s;
    vorherBoden = b;
  }
  check(
    'Sonnenleuchtdichte steigt nirgends',
    anstiege === 0,
    `${anstiege} Anstiege in ${bis - von + 1} Schritten (vorher 244)${ersterAnstieg ? `; erster ${ersterAnstieg}` : ''}`
  );
  check(
    'auch am Boden (mal Einfallswinkel) kein Anstieg',
    anstiegeBoden === 0,
    `${anstiegeBoden} Anstiege`
  );
  /*
    ── Warum ELEV_TAG_VOLL unter dem Sonnenstand der Viertel liegt ─────

    An f = 0,25 und f = 0,75 hat der Nachtbogen seinen Wurzelknick: `sqrt`
    startet dort mit senkrechter Tangente. Trägt der Nachtanteil an dieser
    Stelle irgendein Gewicht, schlägt die senkrechte Tangente durch und
    die Sonne wird für einen Augenblick heller, obwohl sie sinkt — genau
    das war mit einer Schwelle von 0,55 messbar (ein Anstieg bei
    f = 0,7507). Die Wache dafür ist nicht die Zahl 0,40, sondern die
    Eigenschaft: an beiden Vierteln zählt die Tagseite voll.
  */
  for (const f of [0.25, 0.75]) {
    const t = tagseitenAnteil(evaluateEnv(klar, f).elevation);
    check(
      `an f = ${f} (Wurzelknick des Nachtbogens) zählt die Tagseite voll`,
      t >= 1 - 1e-9,
      `tagseitenAnteil ${t.toFixed(6)}`
    );
  }
}

// ── 3. Die Gewichte können nicht mehr überlaufen ──────────────────────
//
// Wirksames Gewicht = nacht · (1 − t) + t. Das ist für jedes nacht ≤ 1
// höchstens 1 — der Test misst also nicht eine Zusage, sondern dass die
// FORM noch die behauptete ist.
console.log('\n3. Gewichtssumme und Weiss-Grenze (alle Wetter)');
{
  let maxGewicht = 0;
  let maxWo = '';
  let ueberWeiss = 0;
  let weissWo = '';
  for (const env of tagWetter) {
    for (let i = 0; i < N; i++) {
      const f = i / N;
      const w = phaseWeights(f);
      const st = evaluateEnv(env, f);
      const t = tagseitenAnteil(st.elevation);
      const g = w.night * (1 - t) + t;
      if (g > maxGewicht) {
        maxGewicht = g;
        maxWo = `${env.name} bei f = ${f.toFixed(4)}`;
      }
      const hell = Math.max(st.sunColor.r, st.sunColor.g, st.sunColor.b);
      const keyMax = Math.max(
        env.sunColorDay.r, env.sunColorDay.g, env.sunColorDay.b,
        env.sunColorMorning.r, env.sunColorMorning.g, env.sunColorMorning.b,
        env.sunColorEvening.r, env.sunColorEvening.g, env.sunColorEvening.b,
        env.sunColorNight.r, env.sunColorNight.g, env.sunColorNight.b
      );
      if (hell > keyMax + 1e-9) {
        ueberWeiss++;
        if (!weissWo) weissWo = `${env.name} bei f = ${f.toFixed(4)}: ${hell.toFixed(4)} > ${keyMax.toFixed(4)}`;
      }
    }
  }
  check(
    'wirksame Gewichtssumme bleibt ≤ 1,001',
    maxGewicht <= 1.001,
    `Maximum ${maxGewicht.toFixed(6)} (${maxWo}); vorher 1,1989`
  );
  check(
    'keine Sonnenfarbe über ihrem hellsten Keyframe',
    ueberWeiss === 0,
    `${ueberWeiss} Stützstellen${weissWo ? `; erste ${weissWo}` : ''} — vorher 103, bis (1,180/0,930/0,648)`
  );
}

// ── 4. Der Mittag ist unangetastet ────────────────────────────────────
console.log('\n4. Mittag ±0');
{
  let ungleich = 0;
  const details: string[] = [];
  for (const env of tagWetter) {
    const st = evaluateEnv(env, 0.5);
    const gleich =
      st.sunColor.r === env.sunColorDay.r &&
      st.sunColor.g === env.sunColorDay.g &&
      st.sunColor.b === env.sunColorDay.b &&
      st.fogColor.r === env.fogColorDay.r &&
      st.fogColor.g === env.fogColorDay.g &&
      st.fogColor.b === env.fogColorDay.b &&
      st.fogDensity === env.fogDensityDay &&
      st.lightIntensity === env.lightIntensityDay &&
      /*
        Das Grundlicht mit 1e-12 statt exakt: `mischeAmbient` rechnet
        `nacht + (tag − nacht) · t`, und das ist bei t = 1 in Gleitkomma
        nicht immer bitgleich `tag` (Ashrain: 0,42000000000000004 gegen
        0,42). Die Zeile stand vor der Reparatur genauso da und liefert
        dieselbe Zahl — geprüft wird hier der Mittag, nicht die
        Rundungsregel von IEEE 754.
      */
      Math.abs(st.ambColor.r - env.ambColorDay.r) < 1e-12;
    if (!gleich) {
      ungleich++;
      if (details.length < 3) details.push(env.name);
    }
  }
  check(
    'mittags liefert jedes Wetter exakt seine Tag-Keyframes',
    ungleich === 0,
    `${tagWetter.length} Wetter geprüft${details.length ? `; ${details.join(', ')}` : ''}`
  );
}

// ── 5. Die Nacht bleibt Zeichen für Zeichen die alte ──────────────────
//
// Sobald die Tagseite null ist, MUSS die alte Formel herauskommen:
// `nacht · Nacht-Keyframe` für die Farben und `lightIntensityNight` für
// die Stärke. Damit ist belegt, dass die Reparatur nur die Dämmerung
// anfasst — Sterne, Mond und Mitternacht hängen an diesen Werten.
console.log('\n5. Nacht unverändert (Tagseite aus)');
{
  let geprueft = 0;
  let abweichungen = 0;
  let wo = '';
  for (const env of ENVIRONMENTS) {
    for (let i = 0; i < N; i++) {
      const f = i / N;
      const st = evaluateEnv(env, f);
      const t = tagseitenAnteil(st.elevation);
      if (t > 0) continue;
      geprueft++;
      const w = env.alwaysDark
        ? { night: 1, day: 0, morning: 0, evening: 0 }
        : phaseWeights(f);
      const soll = {
        r: env.sunColorNight.r * w.night,
        g: env.sunColorNight.g * w.night,
        b: env.sunColorNight.b * w.night,
      };
      const gleich =
        st.sunColor.r === soll.r &&
        st.sunColor.g === soll.g &&
        st.sunColor.b === soll.b &&
        st.fogColor.r === env.fogColorNight.r * w.night &&
        st.fogDensity === env.fogDensityNight * w.night &&
        st.lightIntensity === env.lightIntensityNight;
      if (!gleich) {
        abweichungen++;
        if (!wo) wo = `${env.name} bei f = ${f.toFixed(4)}`;
      }
    }
  }
  check(
    'ohne Tagseite steht die alte Nachtformel',
    abweichungen === 0 && geprueft > 0,
    `${geprueft} Stützstellen über ${ENVIRONMENTS.length} Wetter${wo ? `; erste Abweichung ${wo}` : ''}`
  );
  check(
    'Mitternacht liefert unverändert lightIntensityNight',
    evaluateEnv(klar, 0).lightIntensity === klar.lightIntensityNight,
    `${evaluateEnv(klar, 0).lightIntensity}`
  );
}

// ── 6. Kuppel und Licht lesen dieselbe Uhr ────────────────────────────
//
// Aus dem Widerspruch der beiden entstand das schwarze Band am Horizont:
// Die Kuppel stand auf Tagfarbe, während Nebel und Licht schon Nacht
// rechneten. Beide Rampen hängen jetzt am Sonnenstand und können sich
// nicht mehr widersprechen — das ist hier die Zusage, nicht die Zahlen.
console.log('\n6. Kuppel und Licht widersprechen sich nie');
{
  let sagtTagUndNacht = 0;
  let sagtNachtUndTag = 0;
  for (let i = 0; i < N; i++) {
    const st = evaluateEnv(klar, i / N);
    const t = tagseitenAnteil(st.elevation);
    const k = kuppelNacht(st.elevation);
    if (k < 0.01 && t < 0.01) sagtTagUndNacht++;
    if (k > 0.99 && t > 0.01) sagtNachtUndTag++;
  }
  check(
    'nie „Kuppel Tag, Licht Nacht"',
    sagtTagUndNacht === 0,
    `${sagtTagUndNacht} Stützstellen`
  );
  check('nie „Kuppel Nacht, Licht Tag"', sagtNachtUndTag === 0, `${sagtNachtUndTag} Stützstellen`);
  check(
    'die Kuppelrampe ist unverändert (0,25 / 0,45)',
    kuppelNacht(0.2) === 0 && kuppelNacht(-0.25) === 1 && Math.abs(kuppelNacht(-0.025) - 0.5) < 1e-12,
    'Sterne, Mond und Sonnenscheibe hängen im Fragment-Shader an dieser Zahl'
  );
}

// ── 7. Die Uhr selbst ─────────────────────────────────────────────────
console.log('\n7. tagseitenAnteil');
{
  let nichtMonoton = 0;
  let vorher = tagseitenAnteil(-1);
  for (let i = -100; i <= 100; i++) {
    const v = tagseitenAnteil(i / 100);
    if (v < vorher - 1e-12) nichtMonoton++;
    if (v < 0 || v > 1) nichtMonoton++;
    vorher = v;
  }
  check('monoton im Sonnenstand und in 0..1', nichtMonoton === 0);
  check(
    'am Mittag exakt 1',
    tagseitenAnteil(evaluateEnv(klar, 0.5).elevation) === 1,
    'nur so bleibt der Mittag bitgleich'
  );
  check(
    'unter dem Horizont noch Dämmerung, tief darunter null',
    tagseitenAnteil(0) > 0.1 && tagseitenAnteil(-0.2) === 0,
    `Sonnenuntergang ${tagseitenAnteil(0).toFixed(4)}`
  );
  /*
    Die Wache für `server/test/stufe2-licht.ts`: Dort steht die Zusage,
    dass 17 h dieselbe Sonnenfarbe trägt wie der Mittag, und sie hängt an
    genau diesen beiden Gewichten. Die Rampenverbreiterung (0,02 → 0,14)
    fasst nur die Seite UNTERHALB des Gipfels an; bei 17 h führt die
    obere Rampe, und die ist unverändert.
  */
  const w17 = phaseWeights(0.708333);
  check(
    '17 h trägt unverändert Tag 0,408 / Abend 0,604',
    Math.abs(w17.day - 0.408) < 0.01 && Math.abs(w17.evening - 0.604) < 0.01,
    `Tag ${w17.day.toFixed(3)}, Abend ${w17.evening.toFixed(3)}`
  );
  const s17 = evaluateEnv(klar, 0.708333);
  check(
    '17 h trägt weiterhin die Tag-Sonnenfarbe',
    Math.abs(s17.sunColor.r - klar.sunColorDay.r) < 0.03 &&
      Math.abs(s17.sunColor.g - klar.sunColorDay.g) < 0.03 &&
      Math.abs(s17.sunColor.b - klar.sunColorDay.b) < 0.03,
    `(${s17.sunColor.r.toFixed(3)}, ${s17.sunColor.g.toFixed(3)}, ${s17.sunColor.b.toFixed(3)})`
  );
  // isNight ist seit dem 12.09.2026 die Entscheidung E2, wörtlich.
  check(
    'isNight kippt genau am Horizont',
    evaluateEnv(klar, FRACTION_SUNRISE + 1 / N).isNight === false &&
      evaluateEnv(klar, FRACTION_SUNSET + 1 / N).isNight === true &&
      evaluateEnv(klar, FRACTION_SUNSET - 1 / N).isNight === false,
    `Sonnenaufgang f = ${FRACTION_SUNRISE.toFixed(4)}, Sonnenuntergang f = ${FRACTION_SUNSET}`
  );
}

console.log(
  fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) fehlgeschlagen`
);
process.exit(fehler === 0 ? 0 : 1);
