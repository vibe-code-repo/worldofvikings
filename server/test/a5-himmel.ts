/**
 * Block A, Bauer „Himmel und Licht" — was an A5/A6/A12 nicht still
 * kaputtgehen darf.
 *
 * Der Himmel selbst ist ein Shader, und ein Shader laesst sich in Node
 * nicht laufen. Was sich hier pruefen laesst, ist genau das, woran diese
 * Runde tatsaechlich zweimal gescheitert ist — und beides sind
 * DATEN-Fragen, keine Bildfragen:
 *
 *  1. **Die neuen Regler existieren und fallen zurueck.**
 *     `shared/src/lookHimmel.ts` haelt sieben Felder, die (noch) nicht in
 *     `LookHimmel` stehen. Solange sie dort fehlen, filtert
 *     `mischeLook()` sie aus `server.yml` weg und `liesHimmelPlus()`
 *     liefert die Vorgaben. Genau diese zwei Zustaende — „noch nicht
 *     eingehaengt" und „eingehaengt" — werden hier beide gefahren,
 *     damit der Integrator beim Einhaengen nichts kaputt machen kann
 *     ohne dass es auffaellt.
 *
 *  2. **`look.himmel.zenit` und `.horizont` sind VERSCHIEDEN.**
 *     Das ist die ganze Aussage von Tor T2. Standen sie wieder auf
 *     demselben Wert, waere der Verlauf still weg — ohne Fehler, ohne
 *     Symptom ausser einem Bild, das niemand nachmisst. Dazu die
 *     Richtung: Der Horizont ist HELLER und WENIGER gesaettigt als der
 *     Zenit (so misst es die Original-Wuerfelkarte, s. server.yml).
 *
 *  3. **Die Wolkendeckung ist nicht wieder null.**
 *     `rainCloudAlpha` von `Klar-Comic` stand auf 0,06. Die Kuppel
 *     rechnet gegen eine normierte Dichte; unterhalb von rund 0,1 ist
 *     der Himmel rechnerisch wolkenlos. Eine 0,06 sieht wie „wenig
 *     Wolken" aus und ist „keine".
 *
 *  4. **Der Halo-Exponent trifft seine Halbwertsbreite.**
 *     `haloExponent`/`haloWinkel` stehen in `shared`, weil Shader,
 *     CPU-Kopie des Umgebungslichts und dieser Test dieselbe Zahl
 *     brauchen. Geprueft wird der WINKEL in Grad — ein Exponent sagt
 *     niemandem etwas, ein Winkel laesst sich gegen Bild 3 halten.
 *
 * Lauf: npx tsx test/a5-himmel.ts   (aus server/)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  ENV_KLAR_COMIC,
  LOOK_HIMMEL_PLUS_BEREICHE,
  LOOK_HIMMEL_PLUS_VORGABE,
  LOOK_VORGABE,
  findEnvironment,
  haloExponent,
  haloWinkel,
  liesHimmelPlus,
  mischeLook,
} from '@wov/shared';

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

/** '#rrggbb' → [r, g, b] in 0..255. */
function hex(s: string): [number, number, number] {
  const t = s.trim().replace(/^#/, '');
  return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
}
const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const satt = ([r, g, b]: [number, number, number]): number => {
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
};

// ── 1. Die neuen Regler, in beiden Zustaenden ────────────────────────

function reglerFallenZurueck(): void {
  console.log('\n1. lookHimmel: Vorgaben, Rueckfall und Einhaengung');

  ok(
    liesHimmelPlus(undefined).haloBreite === LOOK_HIMMEL_PLUS_VORGABE.haloBreite,
    'ohne Objekt: die Vorgabe'
  );
  ok(liesHimmelPlus(42).silberrand === LOOK_HIMMEL_PLUS_VORGABE.silberrand, 'Unsinn statt Objekt: die Vorgabe');

  // ZUSTAND A — noch nicht eingehaengt: `mischeLook` kennt die Felder
  // nicht und wirft sie weg. Der Client muss die Vorgaben sehen.
  const gemischt = mischeLook({ himmel: { zenit: '#123456', wolken: 0.9, haloStaerke: 0.9 } });
  const ausProfil = liesHimmelPlus(gemischt.himmel);
  ok(gemischt.himmel.zenit === '#123456', 'bekannte Felder kommen durch (zenit)');
  ok(
    ausProfil.wolken === LOOK_HIMMEL_PLUS_VORGABE.wolken &&
      ausProfil.haloStaerke === LOOK_HIMMEL_PLUS_VORGABE.haloStaerke,
    'noch nicht eingehaengt: die neuen Felder fallen auf die Vorgabe zurueck'
  );

  // ZUSTAND B — eingehaengt: dasselbe Objekt, aber die Felder stehen
  // darin. Jetzt muss der Leser sie nehmen.
  const eingehaengt = liesHimmelPlus({ ...LOOK_HIMMEL_PLUS_VORGABE, wolken: 0.9, haloStaerke: 0.55 });
  ok(eingehaengt.wolken === 0.9 && eingehaengt.haloStaerke === 0.55, 'eingehaengt: die Werte kommen an');
  ok(
    eingehaengt.wolkenParallaxe === LOOK_HIMMEL_PLUS_VORGABE.wolkenParallaxe,
    'eingehaengt: nicht genannte Felder bleiben auf der Vorgabe'
  );

  // NaN/Infinity duerfen NICHT durchrutschen — ein NaN im Uniform ist
  // ein schwarzes Bild ohne Fehlermeldung.
  const kaputt = liesHimmelPlus({ wolken: NaN, silberrand: Infinity, haloBreite: '0.5' });
  ok(
    kaputt.wolken === LOOK_HIMMEL_PLUS_VORGABE.wolken &&
      kaputt.silberrand === LOOK_HIMMEL_PLUS_VORGABE.silberrand &&
      kaputt.haloBreite === LOOK_HIMMEL_PLUS_VORGABE.haloBreite,
    'NaN, Infinity und Text fallen auf die Vorgabe zurueck'
  );

  // Die Bereichsliste muss zu den Feldern passen — sonst haengt der
  // Integrator einen Waechter ein, der ein Feld auslaesst.
  const felder = Object.keys(LOOK_HIMMEL_PLUS_VORGABE).sort();
  const wache = LOOK_HIMMEL_PLUS_BEREICHE.map(([p]) => p.replace('look.himmel.', '')).sort();
  ok(
    felder.length === wache.length && felder.every((f, i) => f === wache[i]),
    `jedes Feld hat einen Bereichswaechter (${felder.length})`
  );
  ok(
    LOOK_HIMMEL_PLUS_BEREICHE.every(([, [u, o]]) => o > u && o <= 1),
    'alle Bereiche enden bei 1 — eine Prozentzahl faellt auf'
  );
}

// ── 2. Tor T2: Zenit und Horizont sind verschieden ───────────────────

function verlaufStehtInDenDaten(): void {
  console.log('\n2. Tor T2: der Verlauf steht in server.yml');
  const pfad = resolve(__dirname, '../data/server.yml');
  if (!existsSync(pfad)) {
    ok(false, 'server.yml gefunden');
    return;
  }
  const roh = parseYaml(readFileSync(pfad, 'utf-8')) as { look?: Record<string, unknown> };
  const profil = mischeLook(roh.look);
  const z = profil.himmel.zenit;
  const h = profil.himmel.horizont;
  ok(z.trim().toLowerCase() !== h.trim().toLowerCase(), `zenit ${z} ist nicht horizont ${h}`);
  if (h.trim() === 'nebel') {
    ok(false, 'horizont steht wieder auf `nebel` — dann gibt es keinen zweiten Stuetzpunkt');
    return;
  }
  const zc = hex(z);
  const hc = hex(h);
  /*
    Die RICHTUNG, nicht der Betrag. Die Original-Wuerfelkarte misst mit
    Tint #B2D1FE und Exposure 0,8 bei +42° L 113 / S 0,58 und bei +5°
    L 168 / S 0,33: oben dunkler und blauer, unten heller und blasser.
    Ein Verlauf, der andersherum laeuft, ist kein Himmel, sondern ein
    Vorzeichenfehler — und genau den sieht man im Bild NICHT, weil die
    Nachbearbeitung den Verlauf ohnehin zusammendrueckt.
  */
  ok(luma(hc) > luma(zc) + 8, `Horizont heller als Zenit (${luma(hc).toFixed(1)} > ${luma(zc).toFixed(1)})`);
  ok(satt(zc) > satt(hc) + 0.05, `Zenit gesaettigter als Horizont (${satt(zc).toFixed(3)} > ${satt(hc).toFixed(3)})`);
  ok(zc[2] >= zc[1] && zc[1] >= zc[0], 'Zenit ist blau-gruen-rot absteigend (ein Himmel, kein Sonnenuntergang)');
  /*
    Und das Fenster, in dem `design/look-referenz.md` den Himmel
    festnagelt: Das MITTEL der beiden Stuetzpunkte, gewichtet wie der
    Verlauf ueber die sichtbare Himmelsflaeche (Schwerpunkt bei t ≈ 0,6),
    muss in der Naehe der kalibrierten Luma 142 liegen. Das ist keine
    Bildmessung — die steht in himmel-mess.mjs — sondern der Riegel
    dagegen, dass jemand beide Farben um 20 Luma verschiebt und sich
    wundert, warum Moos/Himmel wandert.
  */
  const mittel = luma(hc) + (luma(zc) - luma(hc)) * 0.6;
  ok(mittel > 132 && mittel < 152, `Verlaufsmittel bei t=0,6 liegt bei ${mittel.toFixed(1)} (Fenster 132..152)`);
}

// ── 3. Wolken: die Deckung darf nicht wieder null sein ───────────────

function wolkenDeckungIstNichtNull(): void {
  console.log('\n3. Wolkendeckung von Klar-Comic');
  const env = findEnvironment(ENV_KLAR_COMIC);
  ok(Boolean(env), `Wetter ${ENV_KLAR_COMIC} existiert`);
  if (!env) return;
  /*
    Die Kuppel normiert ihre FBM-Dichte auf Mittel 0,5 / Streuung 0,28
    und prueft gegen `1 − Deckung`. Unterhalb von rund 0,10 liegt die
    Schwelle mehr als 1,4 Streuungen ueber der Dichte — statistisch
    weniger als 8 % des Himmels, und davon nichts mit voller Deckkraft.
    0,06, wie es hier stand, ist rechnerisch wolkenlos.
  */
  ok(env.rainCloudAlpha >= 0.15, `rainCloudAlpha ${env.rainCloudAlpha} liegt ueber der Sichtbarkeitsschwelle 0,15`);
  ok(env.rainCloudAlpha <= 0.6, `rainCloudAlpha ${env.rainCloudAlpha} bleibt unter 0,6 (das Vorbild ist ein klarer Tag)`);
  ok(
    LOOK_HIMMEL_PLUS_VORGABE.wolken < 0,
    'look.himmel.wolken steht auf −1: das Wetter entscheidet, nicht das Profil'
  );
}

// ── 4. A12: der zweite Sonnenhof ─────────────────────────────────────

function haloBreiteStimmt(): void {
  console.log('\n4. A12: Halbwertsbreite des zweiten Sonnenhofs');
  ok(haloExponent(0) === 90 && Math.abs(haloExponent(1) - 1.5) < 1e-9, 'Abbildung 0 → 90, 1 → 1,5');
  ok(haloExponent(-5) === 90 && Math.abs(haloExponent(9) - 1.5) < 1e-9, 'ausserhalb 0..1 wird geklemmt');
  const eng = haloWinkel(0);
  const weit = haloWinkel(1);
  ok(weit > eng, `breiter heisst weiter (${eng.toFixed(1)}° → ${weit.toFixed(1)}°)`);
  /*
    Der schmale Term (`sonnenglühen` 0,2 → Exponent 176) hat rund 5°
    Halbwertsbreite. Bild 3 der Referenz misst den Hof aber noch bei 6°
    mit +14 Luma und erst ab etwa 9° nicht mehr. Der zweite Term muss
    also DEUTLICH breiter sein als der erste, sonst sind es zwei
    Kernterme und kein Hof.
  */
  const schmal = (Math.acos(Math.pow(0.5, 1 / 176)) * 180) / Math.PI;
  const hof = haloWinkel(LOOK_HIMMEL_PLUS_VORGABE.haloBreite);
  ok(hof > schmal * 1.5, `Vorgabe-Hof ${hof.toFixed(1)}° ist breiter als der Kern ${schmal.toFixed(1)}°`);
  ok(hof > 5 && hof < 13, `Vorgabe-Hof ${hof.toFixed(1)}° liegt im Fenster 5..13° (Bild 3: bis ~9° messbar)`);
  ok(
    LOOK_HIMMEL_PLUS_VORGABE.haloStaerke > 0 && LOOK_HIMMEL_PLUS_VORGABE.haloStaerke <= 0.5,
    `Hofstaerke ${LOOK_HIMMEL_PLUS_VORGABE.haloStaerke} ist an und bleibt unter dem Kern (0,55)`
  );
}

// ── 5. A7: die Schattendunkelheit steht im Fenster ───────────────────

function schattenDunkelheit(): void {
  console.log('\n5. A7: look.schatten.dunkelheit');
  const pfad = resolve(__dirname, '../data/server.yml');
  const roh = parseYaml(readFileSync(pfad, 'utf-8')) as { look?: Record<string, unknown> };
  const profil = mischeLook(roh.look);
  const d = profil.schatten.dunkelheit;
  /*
    Babylons `darkness` ist RESTLICHT. Gemessen wurde das Verhaeltnis
    besonnter zu beschatteter Felsflaeche an der Pose `felsschatten`
    (himmel-mess.mjs): 0,25 → 1,375, 0,42 → 1,313, 0,62 → 1,236 gegen
    das Vorbild 1,21. Das Fenster hier ist bewusst weit — es soll ein
    Zurueckfallen auf den alten Wert bemerken, nicht eine Feinjustierung
    verbieten.
  */
  ok(d >= 0.5 && d <= 0.8, `dunkelheit ${d} liegt im gemessenen Fenster 0,50..0,80 (Verhaeltnis 1,21 ± 0,05)`);
  ok(LOOK_VORGABE.schatten.kaskaden === 1, 'eine Kaskade (unveraendert)');
}

function main(): void {
  reglerFallenZurueck();
  verlaufStehtInDenDaten();
  wolkenDeckungIstNichtNull();
  haloBreiteStimmt();
  schattenDunkelheit();
}

try {
  main();
  if (fehler === 0) {
    console.log('\nPASS: Himmelsverlauf, Wolkendeckung, Halo und Schattendunkelheit stehen');
    process.exit(0);
  }
  console.error(`\nFAIL: ${fehler} Pruefung(en)`);
  process.exit(1);
} catch (e) {
  console.error('\nFAIL:', e);
  process.exit(1);
}
