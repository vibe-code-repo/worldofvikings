// Prüft: das Höhenfeld der Fels-Frontschicht (`--stil fels`) — Naht, Hub, Budget.
//
// ── Warum dieser Prüfer vor dem ersten GLB steht ──────────────────────
// Das Risiko von F3 steht im Konzept: „Der Nahtschluss ist gegen GERADE
// Fugen gebaut" (`make-stonevault.py`). Eine unregelmässige Fläche, die
// an der Modulgrenze nicht auf den Nachbarn trifft, hinterlässt eine
// Zacke — und die sieht man erst im Rendering, in dem zwölf andere Dinge
// gleichzeitig anders sind.
//
// Deshalb wird hier das FELD selbst geprüft, nicht das Bild: Die
// Arithmetik liegt als `tools/elements/blender/felsrelief.py` ohne `bpy`
// daneben und lässt sich mit blossem `python3` befragen. Kein Blender,
// kein `assets/`, keine GPU — Sekunden statt Minuten, und der Befund
// nennt die Zahl statt eines Pixelhaufens.
//
// ── Was sich am 05.09.2026 geändert hat ──────────────────────────────
// Bis dahin legte `felsblock.py` QUADER, und dieser Prüfer prüfte deren
// Kanten. Der Kontaktbogen hat den Blockverband widerlegt (er las sich
// weiter als Mauerwerk), an seine Stelle ist ein verdrängtes HÖHENFELD
// getreten. Die Zusagen sind dieselben geblieben, ihre Messung ist eine
// andere:
//   (1) NAHT — was ein Modul an seiner Kante zeigt, zeigt der Nachbar
//       an seiner auch: dieselbe Stützstelle, dieselbe Höhe, dieselbe
//       Tiefe. Und zwar AUCH über Varianten hinweg (`RockVaultWallB/C`),
//       sonst dürfte der Rasterpfad sie nicht mischen.
//   (2) HÜLLBOX — kein Punkt steht weiter vor als die Reliefdicke, und
//       in JEDEM Ausschnitt, den das Kit baut, steht einer ganz vorn.
//       Sonst wächst oder schrumpft die Bounding-Box, und `DG_RockVault`
//       wäre kein abgeleitetes Kit mehr.
//   (3) HUB — der Rückzug trägt mindestens 12 cm und lässt 1,5 cm
//       Wandstärke stehen. Die alte Fassung prüfte das Gegenteil (höchstens
//       10 cm, Spielerkapsel); seit Mass (A) vom 05.09.2026 haben die
//       Fels-Wandmodule ein `_col`-Netz, und die Kapsel sieht das Relief
//       gar nicht mehr.
//   (4) BUDGET — höchstens 4500 Dreiecke je Wandpaneel (bis Mass C 1500;
//       s. `BUDGET_DREIECKE`, warum die Zahl steigen durfte).
//   (5) ES IST KEIN VERBAND — keine durchgehende waagerechte Fuge, kein
//       achsenparalleles Gitter, Gefälle in beide Richtungen.
//
// Checks the rock front layer's height field: seam continuity across
// module borders and variants, depth budget, triangle budget, and that it
// is not a brick bond any more.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const MODUL = resolve(HIER, '..', 'blender', 'felsrelief.py');
const MODELLE = resolve(HIER, '..', '..', '..', 'assets', 'models');

// Masse aus make-stonevault.py — hier bewusst NOCH EINMAL genannt statt
// importiert: der Prüfer soll rot werden, wenn das Bauskript sie ändert.
const HOEHE = 3.5;
const PROT = 0.18; // Reliefdicke im Fels-Stil = die Hüllbox-Grenze
const GRID = 2.0;
/*
  WANDSTAERKE statt Kapselgrenze (05.09.2026, Mass A).

  Bis heute stand hier `KAPSEL = 0,10` — „so weit darf ein Vorsprung
  hoechstens tragen, sonst haengt die Spielerkapsel". Diese Grenze gibt es
  nicht mehr: Jedes Fels-Wandmodul traegt seit heute ein `_col`-Netz mit
  einer GLATTEN Flaeche auf der Wandflucht (`make-stonevault.py`,
  `baue()`), und die Kapsel gleitet daran entlang statt am Relief. Der
  Nachweis, dass das Netz auch wirklich in jeder GLB steht, gehoert nicht
  hierher (dieser Pruefer kennt kein Blender) — er steht in
  `fels-kollision.mjs`, und OHNE ihn waere die Zahl unten unbelegt.

  Was uebrig bleibt, ist die Wand selbst: Von der Reliefdicke muessen
  1,5 cm als Material stehen bleiben, sonst ist die tiefste Kluft ein Loch
  in die Rueckplatte.
*/
const WANDSTAERKE = 0.015;
/*
  Mass C (05.09.2026): 4500 statt 1500.

  Die 1500 stammen aus der Zeit, in der das sichtbare Netz zugleich die
  Kollisionsform war — jedes Dreieck war Havok, und Havok fasst sie in
  jedem Bild an. Seit Mass A hat jedes Fels-Wandmodul ein `_col`-Netz
  (72..466 Dreiecke), und die Dreiecke der Frontschicht sind nur noch
  BILD. Ein Bilddreieck kostet einmal Speicher und dann nichts mehr:
  Alle Paneele eines Grabes sind Instanzen EINER Geometrie
  (EntityManager, thin instances), hundert Paneele tragen sie einmal.

  4500 ist kein rundes Wunschmass, sondern das, was 32 x 56 Felder plus
  Schürze, Deckel und die fünf festen Quader ergeben (4170) — mit Luft
  für eine Zeile mehr, aber nicht für eine Verdopplung.
*/
const BUDGET_DREIECKE = 4500;
const FESTE_QUADER = 5; // Rückplatte, Sockel, Haube, zwei Endstreifen
const EPS = 1e-9;

let gruen = 0;
const fehler = [];

function pruefe(name, bedingung, hinweis = '') {
  if (bedingung) {
    gruen++;
    console.log(`  ok   ${name}`);
  } else {
    fehler.push(name);
    console.log(`  FAIL ${name}${hinweis ? ` — ${hinweis}` : ''}`);
  }
}

/** `felsrelief.py --dump` befragen. Gibt `null` zurück, wenn es scheitert. */
function feld(argumente) {
  const lauf = spawnSync('python3', [MODUL, '--dump', ...argumente.map(String)], {
    encoding: 'utf-8',
  });
  if (lauf.status !== 0) {
    console.log(lauf.stderr ?? '(keine Fehlerausgabe)');
    return null;
  }
  return JSON.parse(lauf.stdout);
}

/** Alle Tiefenwerte eines Feldes als flache Liste. */
const alle = (g) => g.punkte.flat().map((p) => p[2]);
/** Die linke (0) bzw. rechte (1) Randspalte als [x, z, tiefe]-Liste. */
const spalte = (g, seite) =>
  g.punkte.map((zeile) => (seite === 0 ? zeile[0] : zeile[zeile.length - 1]));

console.log('Fels-Frontschicht — Höhenfeld von felsrelief.py\n');

if (!existsSync(MODUL)) {
  console.log(`  FAIL felsrelief.py fehlt — erwartet unter ${MODUL}`);
  console.log('\nFEHLGESCHLAGEN: ohne das Feld ist nichts zu messen.');
  process.exit(1);
}

// Die drei Wandvarianten des Kits tragen dieselben Masse und verschiedene
// Feldschlüssel (`FELD_LAGE` in make-stonevault.py: 10, 11, 12).
const A = feld([-1, 1, '--lage', 10]);
if (A === null) {
  console.log('\nFEHLGESCHLAGEN: `python3 felsrelief.py --dump -1 1` lief nicht durch.');
  process.exit(1);
}
const B = feld([-1, 1, '--lage', 11]);
const C = feld([-1, 1, '--lage', 12]);

// ── (0) Form der Auskunft ───────────────────────────────────────────────
console.log('Form:');
pruefe(
  'Dump nennt Seed, Raster, Stützstellen und Punkte',
  typeof A.seed === 'number' &&
    typeof A.raster === 'number' &&
    Array.isArray(A.xs) &&
    Array.isArray(A.zs) &&
    Array.isArray(A.punkte)
);
/*
  Das Konzeptfenster war 0,10 .. 0,15 m und ist mit Mass C nach unten
  geöffnet: Die Klüfte dieses Gesteins sind 5 bis 10 cm breit, ein Raster
  von 12,5 cm kann sie gar nicht darstellen. Nach OBEN bleibt die Grenze
  stehen — ein gröberes Raster wäre der Befund von gestern.
*/
pruefe('das Raster ist fein genug für eine 5-cm-Kluft (≤ 0,07 m)',
  A.raster <= 0.07 + EPS, `${A.raster}`);
pruefe('das Raster teilt das 2-m-Modulmass (sonst trifft die Naht nicht)',
  Math.abs(GRID / A.raster - Math.round(GRID / A.raster)) < 1e-9,
  `${GRID} / ${A.raster} = ${GRID / A.raster}`);
pruefe('die Fläche ist überhaupt unterteilt',
  A.xs.length >= 16 && A.zs.length >= 20, `${A.xs.length} x ${A.zs.length}`);
pruefe('jeder Punkt nennt x, z und Tiefe',
  A.punkte.every((zeile) => zeile.every((p) => Array.isArray(p) && p.length === 3)));

const tA = alle(A);

// ── (1) Determinismus ───────────────────────────────────────────────────
console.log('\nDeterminismus:');
pruefe('zweiter Lauf ergibt dasselbe Feld',
  JSON.stringify(A) === JSON.stringify(feld([-1, 1, '--lage', 10])));
pruefe('ein anderer Feldschlüssel ergibt ein anderes Feld',
  JSON.stringify(B?.punkte) !== JSON.stringify(A.punkte));
pruefe('und ein dritter noch eins',
  JSON.stringify(C?.punkte) !== JSON.stringify(A.punkte) &&
    JSON.stringify(C?.punkte) !== JSON.stringify(B?.punkte));
const S = feld([-1, 1, '--lage', 10, '--seed', 777]);
pruefe('ein anderer Seed ergibt ein anderes Feld',
  S !== null && JSON.stringify(S.punkte) !== JSON.stringify(A.punkte));

// ── (2) Hüllbox und Hub ─────────────────────────────────────────────────
console.log('\nHüllbox und Tiefenhub:');
const tMax = Math.max(...tA);
const tMin = Math.min(...tA);
pruefe('kein Punkt steht weiter vor als die Reliefdicke (Hüllbox wächst nicht)',
  tMax <= PROT + EPS, `max ${tMax}`);
pruefe('kein Punkt sitzt hinter der Rückplattenfront', tMin > 0.0, `min ${tMin}`);
pruefe('die tiefste Stelle lässt 1,5 cm Wandstärke stehen',
  tMin >= WANDSTAERKE - EPS, `min ${tMin}`);
/*
  Untergrenze statt Obergrenze: Mikes Befund vom 05.09.2026 war, dass die
  Wand im Spiel viel FLACHER aussieht als das Tripo-Modell (dort rund
  16 cm Spanne auf 1 m). Ein Hub, der wieder unter 12 cm fällt, ist
  deshalb kein „sicherer Rückfall", sondern derselbe Befund noch einmal.
*/
pruefe('der Hub trägt mindestens 12 cm (sonst ist es wieder eine glatte Wand)',
  tMax - tMin >= 0.12, `Hub ${(tMax - tMin).toFixed(4)}`);

/*
  Die Hüllbox darf auch nicht SCHRUMPFEN — sonst hätte `DG_RockVault` eine
  andere `size` als sein Stamm. Geprüft wird das an JEDEM Ausschnitt, den
  das Kit wirklich baut, und nicht nur am vollen Paneel: Der schmalste ist
  der Torbogenpfosten mit 0,4 m. Die Zusage dahinter steht in `_grund()`
  (VORDERGRUND) — sie ist keine Wahrscheinlichkeit, und hier steht, dass
  sie für alle vorkommenden Ausschnitte gilt.
*/
const AUSSCHNITTE = [
  ['Wandpaneel A', [-1, 1, '--lage', 10]],
  ['Wandpaneel B', [-1, 1, '--lage', 11]],
  ['Wandpaneel C', [-1, 1, '--lage', 12]],
  ['Korridor Ost', [-1, 1, '--lage', 20]],
  ['Korridor West', [-1, 1, '--lage', 21]],
  ['Ecke West', [-1, 1, '--lage', 22]],
  ['Ecke Sued (Anschlag 0,70)', [-1, 0.7, '--lage', 23]],
  ['Kreuzung West', [-1, 1, '--lage', 24]],
  ['Treppe Ost (6 m Lauf)', [-3, 3, '--lage', 30]],
  ['Treppe West (6 m Lauf)', [-3, 3, '--lage', 31]],
  ['Torbogenpfosten links', [-1, -0.6, '--lage', 40]],
  ['Torbogenpfosten rechts', [0.6, 1, '--lage', 41]],
];
for (const [name, args] of AUSSCHNITTE) {
  const g = feld(args);
  const t = g ? alle(g) : [];
  pruefe(`${name}: ein Punkt steht ganz vorn (Hüllbox schrumpft nicht)`,
    t.length > 0 && Math.abs(Math.max(...t) - PROT) < 1e-9,
    t.length > 0 ? `max ${Math.max(...t)}` : 'kein Feld');
}

// ── (3) Die Naht ────────────────────────────────────────────────────────
console.log('\nNaht an der Modulgrenze:');
/*
  Zwei Paneele stossen im 2-m-Raster aneinander: Die RECHTE Randspalte des
  einen (x = +1) liegt auf der LINKEN des anderen (x = -1). Sie muss also
  in Höhe UND Tiefe übereinstimmen — und zwar über VARIANTEN hinweg, denn
  der Rasterpfad mischt sie (`layoutFromPlan`, S7).
*/
function naht(name, links, rechts) {
  const l = spalte(links, 0);
  const r = spalte(rechts, 1);
  if (l.length !== r.length) {
    pruefe(name, false, `${r.length} gegen ${l.length} Stützstellen`);
    return;
  }
  const abweichungen = [];
  for (let i = 0; i < l.length; i++) {
    if (Math.abs(r[i][0] - GRID - l[i][0]) > EPS) abweichungen.push(`x@${i}`);
    if (Math.abs(r[i][1] - l[i][1]) > EPS) abweichungen.push(`z@${i}`);
    if (Math.abs(r[i][2] - l[i][2]) > EPS) abweichungen.push(`Tiefe@${i}`);
  }
  pruefe(name, abweichungen.length === 0, abweichungen.slice(0, 4).join(', '));
}
naht('A neben A: rechte Kante trifft linke', A, A);
naht('A neben B: auch über Varianten hinweg', A, B);
naht('B neben C', B, C);
naht('C neben A', C, A);
naht('Wandpaneel neben Korridorwand (anderes Modul)', A, feld([-1, 1, '--lage', 20]));
naht('Torbogenpfosten neben Wandpaneel', A, feld([0.6, 1, '--lage', 41]));

// ── (4) Der Randstreifen, der die Naht trägt ────────────────────────────
console.log('\nRandstreifen (die Zusage HINTER der Naht):');
pruefe('die Randspalten liegen auf dem Modulrand',
  Math.abs(A.punkte[0][0][0] + 1) < EPS &&
    Math.abs(A.punkte[0][A.punkte[0].length - 1][0] - 1) < EPS);
{
  // Der Randwert darf nicht von der Variante abhängen — genau daran hängt,
  // dass sich A, B und C beliebig mischen lassen.
  const rw = [A, B, C].map((g) => spalte(g, 0).map((p) => p[2]));
  pruefe('alle drei Varianten tragen denselben Randwert',
    rw[0].every((v, i) => Math.abs(v - rw[1][i]) < EPS && Math.abs(v - rw[2][i]) < EPS));
  const streuung = Math.max(...rw[0]) - Math.min(...rw[0]);
  pruefe('der Randwert ist nicht konstant (kein gerades Band alle 2 m)',
    streuung > 0.01, `Streuung ${streuung.toFixed(4)}`);
}
{
  /*
    An einem INNEREN Anschlag (Torbogenlaibung, Anschluss der Südwand im
    Eckmodul) wird NICHT überblendet: dahinter kommt kein Nachbar, sondern
    die Flanke eines anderen Bauteils. Endete die Schicht dort auf
    Randniveau, sähe man neben der Tür in eine Nut.
  */
  const ecke = feld([-1, 0.7, '--lage', 23]);
  const voll = feld([-1, 1, '--lage', 23]);
  const anschlag = spalte(ecke, 1).map((p) => p[2]);
  const rand = spalte(voll, 1).map((p) => p[2]);
  pruefe('am inneren Anschlag steht KEIN Randniveau',
    anschlag.some((v, i) => Math.abs(v - rand[i]) > 0.002));
  pruefe('die Kante zur Westwand bleibt dieselbe wie im vollen Paneel',
    spalte(ecke, 0).every((p, i) => Math.abs(p[2] - spalte(voll, 0)[i][2]) < EPS));
}

// ── (5) Boden- und Deckenanschluss ──────────────────────────────────────
console.log('\nBoden- und Deckenanschluss:');
const untenZ = A.punkte[0].map((p) => p[1]);
const obenZ = A.punkte[A.punkte.length - 1].map((p) => p[1]);
pruefe('die unterste Stützreihe ist WAAGERECHT (sonst Schatten am Boden)',
  Math.max(...untenZ) - Math.min(...untenZ) < 1e-9);
pruefe('die oberste Stützreihe ist WAAGERECHT (sonst Haarlinie an der Decke)',
  Math.max(...obenZ) - Math.min(...obenZ) < 1e-9);
pruefe('unten bleibt Luft zur Bodenplatte (keine koplanare Fläche)',
  untenZ[0] > 0.002 && untenZ[0] < 0.03, `${untenZ[0]}`);
pruefe('oben bleibt Luft zur Deckenplatte',
  obenZ[0] < HOEHE - 0.002 && obenZ[0] > HOEHE - 0.03, `${obenZ[0]}`);

// ── (6) Es ist kein Verband mehr ────────────────────────────────────────
console.log('\nUnregelmässigkeit (sonst wäre es weiter Mauerwerk):');
{
  // Eine durchgehende waagerechte Fuge wäre eine Zeile, in der alle Punkte
  // annähernd gleich tief liegen — genau das Muster, das der Kontaktbogen
  // vom 04.09.2026 gezeigt hat.
  const zeilen = A.punkte.slice(1, -1);
  const flach = zeilen.filter((zeile) => {
    const t = zeile.map((p) => p[2]);
    return Math.max(...t) - Math.min(...t) < 0.006;
  });
  pruefe('keine Zeile ist eine durchgehende waagerechte Fuge',
    flach.length === 0, `${flach.length} von ${zeilen.length} Zeilen flach`);
}
{
  // Die inneren Stützstellen sind in der Wandebene verzogen (s. VERZUG):
  // ohne das liefe jede Bruchkante achsenparallel, und die Wand läse sich
  // als Treppe.
  const innen = A.punkte.slice(1, -1).flatMap((zeile, iz) =>
    zeile.slice(1, -1).map((p, ix) => [p[0] - A.xs[ix + 1], p[1] - A.zs[iz + 1]])
  );
  const schief = innen.filter(([dx, dz]) => Math.abs(dx) > 1e-6 || Math.abs(dz) > 1e-6);
  pruefe('die inneren Stützstellen stehen nicht auf dem Achsengitter',
    schief.length >= innen.length * 0.95, `${schief.length} von ${innen.length}`);
  const maxVersatz = Math.max(...innen.map(([dx, dz]) => Math.max(Math.abs(dx), Math.abs(dz))));
  pruefe('der Verzug bleibt unter einem halben Rasterschritt (kein Überschlag)',
    maxVersatz < A.raster / 2, `${maxVersatz.toFixed(4)}`);
}
{
  // Richtung: Die Fläche muss in BEIDE Achsen kippen, sonst hat das Relief
  // keine Glanz- und keine Schattenseite — der zweite Vorwurf des Bogens.
  const gx = [];
  const gz = [];
  for (let iz = 0; iz < A.punkte.length; iz++)
    for (let ix = 0; ix + 1 < A.punkte[iz].length; ix++) {
      const a = A.punkte[iz][ix];
      const b = A.punkte[iz][ix + 1];
      if (b[0] - a[0] > 1e-6) gx.push(b[2] - a[2]);
    }
  for (let iz = 0; iz + 1 < A.punkte.length; iz++)
    for (let ix = 0; ix < A.punkte[iz].length; ix++) {
      const a = A.punkte[iz][ix];
      const b = A.punkte[iz + 1][ix];
      if (b[1] - a[1] > 1e-6) gz.push(b[2] - a[2]);
    }
  /*
    Gemessen wird der ABSOLUTE Tiefensprung zwischen zwei Nachbarpunkten
    und nicht der Winkel: Die Zeilen stehen 0,145 m auseinander, die
    Spalten 0,125 m — derselbe Sprung ergäbe zwei verschiedene Winkel, und
    der Prüfer verglänge am Ende sein eigenes Raster. 2 cm Sprung ist die
    Schwelle, ab der im Streiflicht ein Schatten steht.
  */
  const stark = (g) => g.filter((v) => Math.abs(v) > 0.02).length / g.length;
  pruefe('quer zur Wand springt die Tiefe oft (Glanz- und Schattenseite)',
    stark(gx) > 0.15, `${(stark(gx) * 100).toFixed(0)} % über 2 cm`);
  pruefe('in der Höhe ebenso (keine liegenden Schichten)',
    stark(gz) > 0.15, `${(stark(gz) * 100).toFixed(0)} % über 2 cm`);
  pruefe('die Tiefe springt in beide Richtungen',
    gx.some((v) => v > 0.02) && gx.some((v) => v < -0.02));
}
{
  const stufen = new Set(tA.map((t) => t.toFixed(3)));
  pruefe('die Tiefe streut über viele Stufen', stufen.size >= 30, `${stufen.size} verschiedene`);
}

// ── (7) Dreiecksbudget ──────────────────────────────────────────────────
console.log('\nDreiecksbudget je Wandpaneel:');
/*
  Die Frontschicht ist ein geschlossener Körper: nx·nz Vierecke vorn, ein
  Schürzenstreifen ringsum und ein Deckel hinten (`fels_schicht` in
  make-stonevault.py). Der Deckel ist ein n-Eck über den Ringpunkten und
  zerfällt beim Export in Ring−2 Dreiecke.
*/
{
  const nx = A.xs.length - 1;
  const nz = A.zs.length - 1;
  const ring = 2 * (nx + nz);
  const dreiecke = 2 * (nx * nz + ring) + (ring - 2) + 12 * FESTE_QUADER;
  pruefe(`≤ ${BUDGET_DREIECKE} Dreiecke (${nx} x ${nz} Felder → ${dreiecke})`,
    dreiecke <= BUDGET_DREIECKE, `${dreiecke}`);
}

// ── (8) Das Sturzband des Torbogens ─────────────────────────────────────
console.log('\nSturzband des Torbogens (zwei Zeilen, eigener Schlüssel):');
{
  const L = feld([-0.75, 0.75, '--lage', 42, '--z0', 2.41, '--z1', 2.59,
    '--randluft', 0, '--zeilen', 2]);
  const lb = L?.punkte ?? [];
  pruefe('das Band hat drei Stützreihen', lb.length === 3, `${lb.length}`);
  pruefe('das Band füllt seine Höhe ganz aus',
    lb.length > 0 && Math.abs(lb[0][0][1] - 2.41) < 1e-9 &&
      Math.abs(lb[lb.length - 1][0][1] - 2.59) < 1e-9);
  pruefe('das Band reicht bis an BEIDE Enden (Laibung, kein Nachbarmodul)',
    lb.length > 0 && Math.abs(lb[0][0][0] + 0.75) < 1e-9 &&
      Math.abs(lb[0][lb[0].length - 1][0] - 0.75) < 1e-9);
  pruefe('das Band trägt ein anderes Feld als die Wandfläche',
    JSON.stringify(lb.map((z) => z.map((p) => p[2]))) !==
      JSON.stringify(A.punkte.slice(0, 3).map((z) => z.map((p) => p[2]))));
}


// ── (9) Die AUSGELIEFERTE Frontschicht — Quelle `mesh` ──────────────────
/*
  Alles bis hierher misst das HÖHENFELD, also die Quelle `voronoi`/
  `heightmap`: reine Arithmetik, ohne `assets/`, ohne Blender. Seit dem
  05.09.2026 gibt es eine dritte Quelle, und die hat kein Feld — bei
  `mesh` IST das gescannte Netz die Fläche (`felsnetz.py`). Ihre Zusagen
  lassen sich deshalb nur AM ERGEBNIS messen, an den ausgelieferten GLB.

  Drei Dinge, und jedes einzeln begründet:

  (a) DICHT. Ein Höhenfeld ist von Bauart geschlossen — `fels_schicht`
      legt Fläche, Schürze und Deckel selbst. Ein beschnittenes,
      verschmolzenes und dezimiertes Netz ist es nicht von selbst: Der
      Kantenkollaps hat in der Erprobung 2 bis 6 offene Kanten je Paneel
      hinterlassen, und eine offene Kante ist im Spiel ein Blick ins
      Nichts. Gezählt werden Kanten mit genau EINER Fläche. Kanten mit
      DREI sind erlaubt und gewollt — dort berühren sich zwei
      Felsbrocken.

  (b) RAND AUF NIVEAU. Die Nahtregel des Rezepts (Zwang 1) sagt: An der
      Modulgrenze steht jedes Paneel auf demselben, variantenfreien
      Rückzug. Beim Feld sichert das die gemeinsame Stützstelle; beim
      Netz sichert es die Randregel (`felsnetz._randregel`), und ob sie
      gegriffen hat, sieht man an genau einer Zahl: An der Paneelkante
      darf KEIN Punkt vor dem Randniveau stehen — und mindestens einer
      muss darauf stehen. Steht einer davor, ragt er in den Nachbarn.

  (c) BUDGET. Dieselbe Grenze wie oben, nur an der Datei gemessen statt
      am Feld.
*/
function glb(pfad) {
  const buf = readFileSync(pfad);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`Keine GLB: ${pfad}`);
  const jsonLaenge = buf.readUInt32LE(12);
  const kopf = JSON.parse(buf.subarray(20, 20 + jsonLaenge).toString('utf8'));
  return { kopf, buf, bin: 20 + jsonLaenge + 8 };
}

/** Ecken (Vec3) und Dreiecke eines Meshes. */
function netz({ kopf, buf, bin }, meshName) {
  const mesh = kopf.meshes?.find((m) => m.name === meshName);
  if (!mesh) return null;
  const prim = mesh.primitives[0];
  const holen = (index, breite) => {
    const acc = kopf.accessors[index];
    const bv = kopf.bufferViews[acc.bufferView];
    const start = bin + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const lies = {
      5121: [1, (o) => buf.readUInt8(o)],
      5123: [2, (o) => buf.readUInt16LE(o)],
      5125: [4, (o) => buf.readUInt32LE(o)],
      5126: [4, (o) => buf.readFloatLE(o)],
    }[acc.componentType];
    const schritt = bv.byteStride ?? lies[0] * breite;
    const aus = [];
    for (let i = 0; i < acc.count; i++) {
      const e = [];
      for (let k = 0; k < breite; k++) e.push(lies[1](start + i * schritt + k * lies[0]));
      aus.push(breite === 1 ? e[0] : e);
    }
    return aus;
  };
  return {
    ecken: holen(prim.attributes.POSITION, 3),
    index: holen(prim.indices, 1),
  };
}

console.log('\nDie ausgelieferte Frontschicht (Quelle `mesh`):');
{
  // Die Wandpaneele: dort ist die Randregel prüfbar, weil ihre beiden
  // e-Kanten auf der Modulgrenze liegen (Zwang 1). Innenwände laufen an
  // einer Zellkante entlang und werden über die Naht schon gemessen.
  const PANEELE = ['RockVaultWall', 'RockVaultWallB', 'RockVaultWallC'];
  const VORN = 0.15;              // glTF z der Wandflucht
  const NIVEAU = VORN - 0.018;    // felsrelief.RAND_NIVEAU
  // 1,5 mm Spiel, und die Zahl ist nicht gegriffen: `felsnetz._randregel`
  // setzt die Randecke EXAKT auf das Niveau, danach verschmilzt der
  // Zusammenbau mit 0,1 mm und der glTF-Export rundet. Gemessen an den
  // drei Paneelen: höchstens 0,13 mm Abweichung.
  const TOL = 1.5e-3;

  const da = PANEELE.every((n) => existsSync(join(MODELLE, `${n}.glb`)));
  if (!da) {
    console.log('  ..   übersprungen — assets/models liegt nicht vor');
  } else {
    for (const name of PANEELE) {
      const g = netz(glb(join(MODELLE, `${name}.glb`)), name);
      const tris = g.index.length / 3;

      // (a) dicht: jede Kante trägt zwei oder mehr Flächen, keine genau eine.
      // Gezählt wird nach ORT und nicht nach Eckenindex: glTF trennt eine
      // Ecke an jeder scharfen Kante in mehrere (eigene Normale je Seite),
      // und nach Index gezählt wäre danach fast jede Kante „offen" — am
      // Wandpaneel gemessen 3325 von 7898, an einem Körper, den Blender
      // als geschlossen ausweist.
      const ort = (i) => g.ecken[i].map((v) => Math.round(v * 1e5)).join(',');
      const kanten = new Map();
      for (let i = 0; i < g.index.length; i += 3) {
        const t = [ort(g.index[i]), ort(g.index[i + 1]), ort(g.index[i + 2])];
        for (let k = 0; k < 3; k++) {
          const a = t[k];
          const b = t[(k + 1) % 3];
          const s = a < b ? `${a}|${b}` : `${b}|${a}`;
          kanten.set(s, (kanten.get(s) ?? 0) + 1);
        }
      }
      let offen = 0;
      for (const n of kanten.values()) if (n === 1) offen++;
      pruefe(`${name}: kein Loch (${kanten.size} Kanten, ${offen} offen)`,
        offen === 0, `${offen} Kanten mit nur einer Fläche`);

      // (b) Rand auf Niveau: an |x| = 1,0 steht nichts vor dem Randniveau,
      //     und etwas steht darauf.
      // Nur die Frontschicht: Sockel und Haube laufen über die VOLLE
      // Wandtiefe (sie decken die Bodenfugen ab) und stehen deshalb mit
      // Recht auf der Wandflucht — sie liegen aber unter dem Boden bzw.
      // über der Decke. Die Frontschicht steht dazwischen.
      let davor = 0;
      let darauf = 0;
      for (const [x, y, z] of g.ecken) {
        if (y < 0.02 || y > 3.48) continue;
        if (Math.abs(Math.abs(x) - 1.0) > 1e-4) continue;
        if (z > NIVEAU + TOL) davor++;
        else if (z > NIVEAU - TOL) darauf++;
      }
      pruefe(`${name}: an der Modulgrenze steht nichts vor dem Randniveau`,
        davor === 0, `${davor} Ecken vor ${NIVEAU.toFixed(3)} m`);
      pruefe(`${name}: die Modulgrenze erreicht das Randniveau (${darauf} Ecken)`,
        darauf > 0);

      // (c) Budget.
      pruefe(`${name}: ${tris} Dreiecke ≤ ${BUDGET_DREIECKE}`,
        tris <= BUDGET_DREIECKE, `${tris}`);
    }
  }
}

console.log(`\n${gruen} Prüfungen grün, ${fehler.length} rot.`);
if (fehler.length > 0) {
  console.log('FEHLGESCHLAGEN:');
  for (const f of fehler) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log('alles gruen');
