// Prüft: die Blocklage der Fels-Frontschicht (`--stil fels`) — Naht, Streuung, Budget.
//
// ── Warum dieser Prüfer vor dem ersten GLB steht ──────────────────────
// Das Risiko von F3 steht im Konzept: „Der Nahtschluss ist gegen GERADE
// Fugen gebaut" (`make-stonevault.py:42-92`). Ein unregelmässiger
// Blockrand, der an der Modulgrenze nicht auf den Nachbarn trifft,
// hinterlässt eine Zacke — und die sieht man erst im Rendering, in dem
// zwölf andere Dinge gleichzeitig anders sind.
//
// Deshalb wird hier die BLOCKLAGE selbst geprüft, nicht das Bild: Die
// Arithmetik liegt als `tools/elements/blender/felsblock.py` ohne `bpy`
// daneben und lässt sich mit blossem `python3` befragen. Kein Blender,
// kein `assets/`, keine GPU — Sekunden statt Minuten, und der Befund
// nennt die Zahl statt eines Pixelhaufens.
//
// Die drei Zusagen, die dieser Prüfer hält:
//   (1) NAHT — was ein Modul an seiner Kante abschneidet, setzt der
//       Nachbar exakt fort: gleiche Reihe, gleiche Tiefe, gleiche Höhe
//       an der Schnittebene. Sonst klafft alle 2 m eine Kerbe.
//   (2) HÜLLBOX — kein Block steht weiter vor als das heutige Ziegel-
//       relief. Sonst wächst die Bounding-Box, und `DG_RockVault` wäre
//       kein abgeleitetes Kit mehr (F4 verlangt gleiche `size`).
//   (3) BUDGET — höchstens 1500 Dreiecke je Wandpaneel. Wand, Korridor,
//       Ecke und Abzweig haben kein `_col`: jedes Dreieck ist Havok.
//
// Checks the rock front layer's block lattice: seam continuity across
// module borders, depth scatter, bounding box, triangle budget.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const MODUL = resolve(HIER, '..', 'blender', 'felsblock.py');

// Masse aus make-stonevault.py — hier bewusst NOCH EINMAL genannt statt
// importiert: der Prüfer soll rot werden, wenn das Bauskript sie ändert.
const HOEHE = 3.5;
const PROT = 0.06; // Relief-Vorsprung des Ziegelverbands = die Hüllbox-Grenze
const GRID = 2.0;
const MINDEST = 0.05; // Splitter darunter wirft schon `wand()` weg
const BUDGET_DREIECKE = 1500;
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

/** `felsblock.py --dump` befragen. Gibt `null` zurück, wenn es scheitert. */
function lage(argumente) {
  const lauf = spawnSync('python3', [MODUL, '--dump', ...argumente.map(String)], {
    encoding: 'utf-8',
  });
  if (lauf.status !== 0) {
    console.log(lauf.stderr ?? '(keine Fehlerausgabe)');
    return null;
  }
  return JSON.parse(lauf.stdout);
}

console.log('Fels-Frontschicht — Blocklage von felsblock.py\n');

if (!existsSync(MODUL)) {
  console.log(`  FAIL felsblock.py fehlt — erwartet unter ${MODUL}`);
  console.log('\nFEHLGESCHLAGEN: ohne die Blocklage ist nichts zu messen.');
  process.exit(1);
}

const A = lage([-1, 1]);
if (A === null) {
  console.log('\nFEHLGESCHLAGEN: `python3 felsblock.py --dump -1 1` lief nicht durch.');
  process.exit(1);
}

// ── (0) Form der Auskunft ───────────────────────────────────────────────
console.log('Form:');
pruefe('Dump nennt Seed, Reihenzahl und Blockliste',
  typeof A.seed === 'number' && typeof A.reihen === 'number' && Array.isArray(A.bloecke));
pruefe('die Wandfläche trägt überhaupt Blöcke', (A.bloecke?.length ?? 0) >= 20,
  `gefunden ${A.bloecke?.length ?? 0}`);

const bl = A.bloecke ?? [];
const felder = ['r', 'xu', 'xo', 'zu', 'zo', 'tiefe'];
pruefe('jeder Block nennt Reihe, beide x-Paare, beide z-Paare und die Tiefe',
  bl.length > 0 && bl.every((b) => felder.every((f) => b[f] !== undefined)));

// ── (1) Determinismus ───────────────────────────────────────────────────
console.log('\nDeterminismus:');
const A2 = lage([-1, 1]);
pruefe('zweiter Lauf ergibt dieselbe Lage', JSON.stringify(A) === JSON.stringify(A2));
const S = lage([-1, 1, '--seed', 777]);
pruefe('ein anderer Seed ergibt eine andere Lage',
  S !== null && JSON.stringify(S.bloecke) !== JSON.stringify(A.bloecke));

// ── (2) Hüllbox und Tiefenstreuung ──────────────────────────────────────
console.log('\nHüllbox und Tiefenstreuung:');
const tiefen = bl.map((b) => b.tiefe);
const tMax = Math.max(...tiefen);
const tMin = Math.min(...tiefen);
pruefe('kein Block steht weiter vor als das Ziegelrelief (Hüllbox bleibt)',
  tMax <= PROT + EPS, `max ${tMax}`);
pruefe('mindestens ein Block steht GANZ vorn (Hüllbox schrumpft auch nicht)',
  Math.abs(tMax - PROT) < 1e-9, `max ${tMax}`);
pruefe('Tiefenstreuung höchstens 0,10 m', tMax - tMin <= 0.10 + EPS,
  `Streuung ${(tMax - tMin).toFixed(4)}`);
pruefe('es wird überhaupt gestreut (nicht alle Blöcke gleich tief)',
  tMax - tMin >= 0.015, `Streuung ${(tMax - tMin).toFixed(4)}`);
pruefe('kein Block sitzt hinter der Rückplattenfront', tMin > 0.0,
  `min ${tMin}`);

// ── (3) Klemmen auf [lo, hi] ────────────────────────────────────────────
console.log('\nKlemmen und Mindestbreite:');
const raus = bl.filter((b) =>
  Math.min(b.xu[0], b.xo[0]) < -1 - EPS || Math.max(b.xu[1], b.xo[1]) > 1 + EPS);
pruefe('kein Block ragt über die Paneelkante hinaus', raus.length === 0,
  `${raus.length} Block/Blöcke draussen`);
const schmal = bl.filter((b) =>
  b.xu[1] - b.xu[0] < MINDEST - EPS || b.xo[1] - b.xo[0] < MINDEST - EPS);
pruefe('kein Splitter unter 5 cm (wie im Ziegelverband)', schmal.length === 0,
  `${schmal.length} zu schmal`);
const verdreht = bl.filter((b) => b.xu[1] <= b.xu[0] || b.xo[1] <= b.xo[0] || b.zo[0] <= b.zu[0]);
pruefe('kein Block ist in sich verdreht', verdreht.length === 0);
pruefe('alle Blöcke liegen zwischen Boden und Decke',
  bl.every((b) => Math.min(...b.zu) >= -EPS && Math.max(...b.zo) <= HOEHE + EPS));

// ── (4) Boden- und Deckenanschluss ──────────────────────────────────────
console.log('\nBoden- und Deckenanschluss:');
const unten = bl.filter((b) => b.r === 0);
const oben = bl.filter((b) => b.r === A.reihen - 1);
const zUnten = unten.flatMap((b) => b.zu);
const zOben = oben.flatMap((b) => b.zo);
pruefe('die unterste Lagerfuge ist WAAGERECHT (sonst Schatten am Boden)',
  zUnten.length > 0 && Math.max(...zUnten) - Math.min(...zUnten) < 1e-9);
pruefe('die oberste Lagerfuge ist WAAGERECHT (sonst Haarlinie an der Decke)',
  zOben.length > 0 && Math.max(...zOben) - Math.min(...zOben) < 1e-9);
pruefe('unten bleibt Luft zur Bodenplatte (keine koplanare Fläche)',
  zUnten.length > 0 && Math.min(...zUnten) > 0.002 && Math.min(...zUnten) < 0.03);
pruefe('oben bleibt Luft zur Deckenplatte',
  zOben.length > 0 && Math.max(...zOben) < HOEHE - 0.002 && Math.max(...zOben) > HOEHE - 0.03);

// ── (5) Das Muster ist global, nicht paneelweise ────────────────────────
console.log('\nGlobales Gitter (Phase läuft über die Modulgrenze weiter):');
const B = lage([1, 3]);
const verschoben = (B?.bloecke ?? []).map((b) => ({
  r: b.r,
  xu: b.xu.map((v) => +(v - GRID).toFixed(9)),
  xo: b.xo.map((v) => +(v - GRID).toFixed(9)),
  zu: b.zu,
  zo: b.zo,
  tiefe: b.tiefe,
}));
const rund = (b) => ({
  r: b.r,
  xu: b.xu.map((v) => +v.toFixed(9)),
  xo: b.xo.map((v) => +v.toFixed(9)),
  zu: b.zu,
  zo: b.zo,
  tiefe: b.tiefe,
});
pruefe('das Nachbarpaneel [1,3] trägt dieselbe Lage, um 2 m versetzt',
  JSON.stringify(bl.map(rund)) === JSON.stringify(verschoben));

// ── (6) Die Naht selbst ─────────────────────────────────────────────────
console.log('\nNaht an der Modulgrenze:');
const anHi = bl.filter((b) => Math.abs(b.xu[1] - 1) < EPS && Math.abs(b.xo[1] - 1) < EPS);
const anLo = bl.filter((b) => Math.abs(b.xu[0] + 1) < EPS && Math.abs(b.xo[0] + 1) < EPS);
pruefe('überhaupt Blöcke laufen über die Kante (sonst Fuge im 2-m-Raster)',
  anHi.length >= 3 && anLo.length >= 3, `hi ${anHi.length}, lo ${anLo.length}`);
pruefe('an jeder Kante hängt gleich viel — jedes abgeschnittene Stück hat ein Gegenstück',
  anHi.length === anLo.length, `hi ${anHi.length}, lo ${anLo.length}`);
let nahtOk = true;
const nahtBefunde = [];
for (const a of anHi) {
  const p = anLo.filter((b) => b.r === a.r);
  if (p.length !== 1) {
    nahtOk = false;
    nahtBefunde.push(`Reihe ${a.r}: ${p.length} Gegenstücke statt 1`);
    continue;
  }
  const b = p[0];
  if (Math.abs(a.tiefe - b.tiefe) > EPS) {
    nahtOk = false;
    nahtBefunde.push(`Reihe ${a.r}: Tiefe ${a.tiefe} vs ${b.tiefe} — Stufe in der Wandfläche`);
  }
  if (Math.abs(a.zu[1] - b.zu[0]) > 1e-9 || Math.abs(a.zo[1] - b.zo[0]) > 1e-9) {
    nahtOk = false;
    nahtBefunde.push(
      `Reihe ${a.r}: Höhe an der Schnittebene ${a.zu[1]}/${a.zo[1]} vs ${b.zu[0]}/${b.zo[0]} — Zacke`
    );
  }
}
pruefe('jedes Reststück trifft sein Gegenstück in Höhe UND Tiefe', nahtOk,
  nahtBefunde.join(' · '));

// ── (7) Es ist kein Ziegelverband mehr ──────────────────────────────────
console.log('\nUnregelmässigkeit (sonst wäre es weiter Mauerwerk):');
const hoehen = new Set(bl.map((b) => ((b.zo[0] + b.zo[1]) / 2 - (b.zu[0] + b.zu[1]) / 2).toFixed(4)));
pruefe('die Reihen sind verschieden hoch', hoehen.size >= 5, `${hoehen.size} verschiedene`);
const breiten = new Set(bl.map((b) => (b.xu[1] - b.xu[0]).toFixed(4)));
pruefe('die Blöcke sind verschieden breit', breiten.size >= 8, `${breiten.size} verschiedene`);
const schief = bl.filter((b) => Math.abs(b.zu[1] - b.zu[0]) > 1e-4 || Math.abs(b.zo[1] - b.zo[0]) > 1e-4);
pruefe('die Lagerfugen laufen gebrochen, nicht waagerecht',
  schief.length >= bl.length / 3, `${schief.length} von ${bl.length}`);
const senkrecht = bl.filter((b) => Math.abs(b.xu[0] - b.xo[0]) > 1e-4 || Math.abs(b.xu[1] - b.xo[1]) > 1e-4);
pruefe('auch die Stossfugen stehen nicht alle lotrecht',
  senkrecht.length >= bl.length / 4, `${senkrecht.length} von ${bl.length}`);
const tiefenStufen = new Set(tiefen.map((t) => t.toFixed(4)));
pruefe('die Tiefe streut über mehrere Stufen', tiefenStufen.size >= 6,
  `${tiefenStufen.size} verschiedene`);

// ── (8) Dreiecksbudget ──────────────────────────────────────────────────
console.log('\nDreiecksbudget je Wandpaneel:');
const quader = bl.length + FESTE_QUADER;
const dreiecke = 12 * quader;
pruefe(`≤ ${BUDGET_DREIECKE} Dreiecke (${quader} Quader → ${dreiecke})`,
  dreiecke <= BUDGET_DREIECKE, `${dreiecke}`);

// ── (9) Der Anschlag des Eckmoduls (hi = 0,70) ──────────────────────────
console.log('\nAnschlag der Suedwand im Eckmodul (hi = 0,70):');
const E = lage([-1, 0.7]);
const eb = E?.bloecke ?? [];
pruefe('auch dort bleibt alles innerhalb der Klemmen',
  eb.length > 0 && eb.every((b) => Math.max(b.xu[1], b.xo[1]) <= 0.7 + EPS));
const eAnLo = eb.filter((b) => Math.abs(b.xu[0] + 1) < EPS && Math.abs(b.xo[0] + 1) < EPS);
pruefe('die Kante zur Westwand bleibt dieselbe wie im vollen Paneel',
  eAnLo.length === anLo.length &&
    eAnLo.every((a) => {
      const b = anLo.find((x) => x.r === a.r);
      return b && Math.abs(a.zu[0] - b.zu[0]) < 1e-9 && Math.abs(a.tiefe - b.tiefe) < EPS;
    }));
// Der Anschlag ist KEINE Modulgrenze: dahinter kommt kein Nachbarblock,
// sondern die Flanke der Westwand. Endete die Schicht dort früher, sähe
// man in der Innenecke in die Fuge.
const eReihen = new Set(eb.map((b) => b.r));
const bisAnschlag = [...eReihen].filter((r) =>
  eb.some((b) => b.r === r && Math.abs(b.xu[1] - 0.7) < 1e-9 && Math.abs(b.xo[1] - 0.7) < 1e-9));
pruefe('in JEDER Reihe reicht ein Block bis an den Anschlag (kein Spalt zur Westwand)',
  bisAnschlag.length === eReihen.size, `${bisAnschlag.length} von ${eReihen.size} Reihen`);
pruefe('an der MODULGRENZE wird dagegen NICHT gedehnt — dort stehen auch Fugen',
  anHi.length < A.reihen, `${anHi.length} von ${A.reihen} Reihen laufen über`);

// ── (10) Der Sturzband-Streifen des Torbogens ───────────────────────────
console.log('\nSturzband des Torbogens (eine Reihe, eigene Lage):');
const L = lage([-0.75, 0.75, '--reihen', 1, '--lage', 1, '--z0', 2.41, '--z1', 2.59, '--randluft', 0]);
const lb = L?.bloecke ?? [];
pruefe('das Band zerfällt in mehrere Blöcke', lb.length >= 3, `${lb.length}`);
pruefe('das Band füllt seine Höhe ganz aus',
  lb.length > 0 &&
    Math.abs(Math.min(...lb.flatMap((b) => b.zu)) - 2.41) < 1e-9 &&
    Math.abs(Math.max(...lb.flatMap((b) => b.zo)) - 2.59) < 1e-9);
pruefe('das Band reicht bis an BEIDE Enden (Laibung, kein Nachbarmodul)',
  lb.length > 0 &&
    Math.abs(Math.min(...lb.map((b) => b.xu[0])) + 0.75) < 1e-9 &&
    Math.abs(Math.max(...lb.map((b) => b.xu[1])) - 0.75) < 1e-9);
pruefe('das Band nimmt eine ANDERE Lage als die Wandfläche',
  lb.length > 0 && JSON.stringify(lb.map((b) => b.xu)) !==
    JSON.stringify(bl.filter((b) => b.r === 0).map((b) => b.xu)));

console.log(`\n${gruen} Prüfungen grün, ${fehler.length} rot.`);
if (fehler.length > 0) {
  console.log('FEHLGESCHLAGEN:');
  for (const f of fehler) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log('alles gruen');
