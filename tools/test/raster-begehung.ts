/**
 * G10 (Modul-Generierung 2.0) — Wächter über den BEGEHUNGSPLAN.
 *
 * ── Warum es diesen Test überhaupt gibt ──────────────────────────────
 * Die Abnahme von G10 ist ein Lauf im Spiel: „vom Eingang jede Zelle der
 * BFS-Liste ablaufen, über mindestens eine Treppe hoch und zurück". Ein
 * Playwright-Lauf dauert Minuten, hängt am DEV-Server und liefert im
 * Fehlerfall ein Bild, keine Zeile. Damit ein roter Lauf etwas AUSSAGT,
 * muss die Route vorher rechnerisch richtig sein — sonst weiss man
 * hinterher nicht, ob das Grab falsch gebaut ist oder der Weg falsch
 * geplant war.
 *
 * ── Was an der Route nicht offensichtlich ist ────────────────────────
 * Zwei Fallen, und beide kosten im Spiel eine halbe Stunde, bis man sie
 * erkennt:
 *
 *  1. **Die Treppe hat Zellen, die kein Standplatz sind.** Sie belegt
 *     drei Zellen auf Ebene `e` und dieselben drei auf `e+1`; der Lauf
 *     steigt von der einen Ecke zur anderen. Die Zellmitten der jeweils
 *     „falschen" Ebene liegen damit im LUFTRAUM über bzw. unter dem
 *     Lauf. Eine Route, die sie ansteuert, meldet „Zelle nicht erreicht"
 *     — und beschuldigt damit den Generator für eine Eigenschaft der
 *     Geometrie. Deshalb wird ein Treppenraum QUERT, nicht aufgezählt:
 *     ein Schritt von der Zelle vor dem unteren Ausgang zu der hinter
 *     dem oberen.
 *  2. **Der Spannbaum ist nicht der Grundriss.** Eine Begehung, die nur
 *     die Baumkanten abläuft, erreicht zwar jede Zelle, betritt aber
 *     keine einzige Schleifenkante — und genau die Schleifenkanten sind
 *     seit G5 neu und tragen die Torbögen. „Kein Durchgang, der im Bild
 *     eine Wand ist" wäre über die Hälfte der Durchgänge nie geprüft.
 *     Deshalb quert die Route JEDE Graphkante, und zwar genau zweimal
 *     (hin und zurück).
 *
 * ── Was hier NICHT geprüft wird ──────────────────────────────────────
 * Ob die Figur wirklich durchkommt. Das kann nur der Lauf im Spiel
 * (`tools/pw-stonevault-walk.mjs --tour`), und dafür ist dieser Test die
 * Voraussetzung, nicht der Ersatz — grüne Tests sind kein Fenster.
 *
 * Aufruf: `npx tsx tools/test/raster-begehung.ts`
 */
import {
  ENTRANCE_CELL,
  cellKey,
  cellToWorld,
  compareCells,
  neighbourCell,
  planGridDungeon,
  type GridCell,
} from '../../shared/src/dungeonRasterGenerator.js';
import { OPPOSITE_DIRECTION } from '../../shared/src/dungeonRasterModul.js';
import { holeKit } from '../messe-stonevault-logik.js';
import { planWalkTour, type WalkTour } from '../raster-begehungsplan.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.log(`  FEHLER: ${text}`);
  }
};

const KIT = 'DG_StoneVault';
const ZELLEN = 60;
const ZONE = 32;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

const def = holeKit(KIT);
const bauDef = { ...def, maxRooms: ZELLEN };
const touren = SEEDS.map((seed) => ({
  seed,
  tour: planWalkTour(bauDef, seed, { zoneSize: ZONE }),
  plan: planGridDungeon(bauDef, seed, { zoneSize: ZONE }),
}));

// ── 1. Die Route ist eine BEGEHUNG, kein Sprungplan ──────────────────
// Zwei aufeinanderfolgende Wegpunkte müssen im Grundriss benachbart sein
// — waagerecht über eine Graphkante oder über einen Treppenlauf. Ein
// Schritt, der beides nicht ist, wäre im Spiel ein Marsch durch die Wand,
// und der Lauf meldete ihn als „Wand vor einem Durchgang".
console.log('1. Jeder Schritt ist eine echte Nachbarschaft');
{
  let schritte = 0;
  let treppenschritte = 0;
  for (const { seed, tour } of touren) {
    let hier = tour.start.cell;
    for (const s of tour.steps) {
      schritte++;
      if (s.stairRoom === null) {
        const passt = ['n', 'e', 's', 'w', 'up', 'down'].some(
          (d) => cellKey(neighbourCell(hier, d as never)) === cellKey(s.cell)
        );
        check(passt, `Saat ${seed}: Sprung von ${cellKey(hier)} nach ${cellKey(s.cell)}`);
      } else {
        treppenschritte++;
        check(
          Math.abs(s.cell.level - hier.level) === 1,
          `Saat ${seed}: Treppenschritt ${cellKey(hier)} → ${cellKey(s.cell)} wechselt die Ebene nicht`
        );
      }
      hier = s.cell;
    }
    check(
      cellKey(hier) === cellKey(tour.start.cell),
      `Saat ${seed}: Begehung endet auf ${cellKey(hier)} statt am Eingang`
    );
  }
  console.log(`   ${schritte} Schritte, davon ${treppenschritte} über eine Treppe`);
}

// ── 2. Kein Wegpunkt im Luftraum einer Treppe ────────────────────────
console.log('2. Kein Wegpunkt liegt in einer Treppenzelle');
{
  let treppenZellen = 0;
  for (const { seed, tour } of touren) {
    const gesperrt = new Set(tour.stairCells.map(cellKey));
    treppenZellen += gesperrt.size;
    for (const s of tour.steps) {
      check(
        !gesperrt.has(cellKey(s.cell)),
        `Saat ${seed}: Wegpunkt ${cellKey(s.cell)} liegt in einer Treppe`
      );
    }
  }
  console.log(`   ${treppenZellen} Treppenzellen über ${SEEDS.length} Saaten, 0 davon angesteuert`);
}

// ── 3. Vollständigkeit: jede Zelle des Plans ist versorgt ────────────
// „Versorgt" heisst: entweder als Wegpunkt angesteuert oder als Zelle
// eines gequerten Treppenraums durchlaufen. Ohne diese Prüfung wäre die
// Route bequem — sie könnte die schwierigen Zweige einfach weglassen.
console.log('3. Jede Zelle des Grundrisses ist versorgt');
{
  let zellen = 0;
  for (const { seed, tour, plan } of touren) {
    const besucht = new Set<string>([cellKey(tour.start.cell)]);
    for (const s of tour.steps) besucht.add(cellKey(s.cell));
    const durchlaufen = new Set<string>();
    for (const s of tour.steps) {
      if (s.stairRoom === null) continue;
      for (const c of tour.stairs[s.stairRoom].cells) durchlaufen.add(cellKey(c));
    }
    zellen += plan.cells.length;
    const fehlend = plan.cells
      .map((c) => cellKey(c.cell))
      .filter((k) => !besucht.has(k) && !durchlaufen.has(k));
    check(
      fehlend.length === 0,
      `Saat ${seed}: ${fehlend.length} Zellen ohne Weg (${fehlend.slice(0, 5).join(' ')})`
    );
  }
  console.log(`   ${zellen} Zellen über ${SEEDS.length} Saaten, alle versorgt`);
}

// ── 4. Jede Graphkante wird gequert, und zwar in beide Richtungen ────
// Der Punkt aus dem Kopfkommentar: Schleifenkanten sind seit G5 neu und
// tragen die Torbögen. Eine Begehung, die sie auslässt, prüft die
// interessantesten Durchgänge nie.
console.log('4. Jede Graphkante wird in beide Richtungen gequert');
{
  let kanten = 0;
  for (const { seed, tour, plan } of touren) {
    // Alle Graphkanten des Grundrisses, ausser denen INNERHALB eines
    // Treppenraums: die sind Lauf, kein Durchgang.
    const treppenZellen = new Set(tour.stairCells.map(cellKey));
    const erwartet = new Set<string>();
    for (const c of plan.cells) {
      if (treppenZellen.has(cellKey(c.cell))) continue;
      for (const d of c.edges) {
        const nb = neighbourCell(c.cell, d);
        if (treppenZellen.has(cellKey(nb))) continue;
        erwartet.add(`${cellKey(c.cell)}>${cellKey(nb)}`);
      }
    }
    kanten += erwartet.size;
    const gequert = new Set<string>();
    let hier = tour.start.cell;
    for (const s of tour.steps) {
      if (s.stairRoom === null) gequert.add(`${cellKey(hier)}>${cellKey(s.cell)}`);
      hier = s.cell;
    }
    const fehlend = [...erwartet].filter((k) => !gequert.has(k));
    check(
      fehlend.length === 0,
      `Saat ${seed}: ${fehlend.length} Durchgänge nie gequert (${fehlend.slice(0, 3).join(' ')})`
    );
  }
  console.log(`   ${kanten} gerichtete Durchgänge über ${SEEDS.length} Saaten, alle gequert`);
}

// ── 5. Treppen: hoch UND zurück ──────────────────────────────────────
// Die Abnahme des Meilensteins nennt beides. Bei einer Tiefensuche fällt
// das Zurück von selbst an — aber „fällt von selbst an" ist genau die
// Sorte Annahme, die beim nächsten Umbau still verschwindet.
console.log('5. Jede Treppe wird hoch und wieder herunter begangen');
{
  let treppen = 0;
  let saatenMitTreppe = 0;
  for (const { seed, tour } of touren) {
    if (tour.stairs.length > 0) saatenMitTreppe++;
    for (let i = 0; i < tour.stairs.length; i++) {
      const t = tour.stairs[i];
      if (!t.crossable) continue;
      treppen++;
      const hoch = tour.steps.filter((s) => s.stairRoom === i && s.levelChange > 0).length;
      const runter = tour.steps.filter((s) => s.stairRoom === i && s.levelChange < 0).length;
      check(hoch > 0, `Saat ${seed}: Treppe ${i} wird nie hochgegangen`);
      check(runter > 0, `Saat ${seed}: Treppe ${i} wird nie heruntergegangen`);
    }
  }
  check(saatenMitTreppe >= 5, `nur ${saatenMitTreppe} Saaten mit Treppe (verlangt: ≥ 5)`);
  console.log(`   ${treppen} querbare Treppen in ${saatenMitTreppe} von ${SEEDS.length} Saaten`);
}

// ── 6. Weltkoordinaten sind Ausgabe, nicht Eingabe ───────────────────
// Die Determinismus-Falle der Konzeptnotiz, eine Ebene höher: Der Läufer
// steuert Weltpunkte an. Stimmt einer nicht mit seiner Zelle überein,
// läuft die Figur gegen die Wand und der Fehler sieht aus wie ein
// Generatorfehler.
console.log('6. Jeder Wegpunkt ist die Mitte seiner Zelle');
{
  let punkte = 0;
  for (const { seed, tour } of touren) {
    for (const s of [{ cell: tour.start.cell, world: tour.start.world }, ...tour.steps]) {
      punkte++;
      const soll = cellToWorld(s.cell);
      const d = Math.hypot(s.world.x - soll.x, s.world.y - soll.y, s.world.z - soll.z);
      check(d < 1e-9, `Saat ${seed}: Wegpunkt ${cellKey(s.cell)} liegt ${d} m neben der Zellmitte`);
    }
  }
  console.log(`   ${punkte} Wegpunkte auf ihrer Zellmitte`);
}

// ── 7. Determinismus ─────────────────────────────────────────────────
// Dieselbe Saat, dieselbe Route — sonst beschreibt der Bericht eines
// Laufs ein anderes Grab als der nächste Lauf begeht.
console.log('7. Dieselbe Saat ergibt dieselbe Route');
{
  const fingerabdruck = (t: WalkTour): string =>
    t.steps.map((s) => `${cellKey(s.cell)}:${s.stairRoom ?? '-'}:${s.backtrack ? 'r' : 'v'}`).join('|');
  for (const { seed, tour } of touren) {
    const zweit = planWalkTour(bauDef, seed, { zoneSize: ZONE });
    check(
      fingerabdruck(tour) === fingerabdruck(zweit),
      `Saat ${seed}: zweiter Lauf ergibt eine andere Route`
    );
  }
  console.log(`   ${SEEDS.length} Saaten zweimal geplant, identisch`);
}

// ── 8. Die Route hängt am Grundriss, nicht an der Einfügereihenfolge ─
// Gegenprobe zu 7: Determinismus allein wäre auch dann grün, wenn die
// Route jede Zelle nur einmal streifte. Hier wird gemessen, dass die
// Länge im erwarteten Verhältnis zur Kantenzahl steht (zwei Schritte je
// Kante, plus zwei je querbarer Treppe).
console.log('8. Die Routenlänge ist zweimal die Kantenzahl');
{
  for (const { seed, tour, plan } of touren) {
    const treppenZellen = new Set(tour.stairCells.map(cellKey));
    let kanten = 0;
    for (const c of plan.cells) {
      if (treppenZellen.has(cellKey(c.cell))) continue;
      for (const d of c.edges) {
        const nb = neighbourCell(c.cell, d);
        if (treppenZellen.has(cellKey(nb))) continue;
        if (compareCells(c.cell, nb) < 0) kanten++;
      }
    }
    const treppen = tour.stairs.filter((t) => t.crossable).length;
    check(
      tour.steps.length === 2 * (kanten + treppen),
      `Saat ${seed}: ${tour.steps.length} Schritte, erwartet ${2 * (kanten + treppen)} ` +
        `(${kanten} Kanten + ${treppen} Treppen)`
    );
  }
  const laengen = touren.map((t) => t.tour.steps.length).sort((a, b) => a - b);
  console.log(
    `   Schritte je Grundriss: min ${laengen[0]}, median ${laengen[Math.floor(laengen.length / 2)]}, ` +
      `max ${laengen[laengen.length - 1]}`
  );
}

// ── 9. Beidseitigkeit der Treppenquerung ─────────────────────────────
// Eine Treppe wird über ihre beiden AUSSENzellen gequert. Steht die
// Aussenzelle nicht im Grundriss, liefe die Figur in den Fels.
console.log('9. Treppenquerungen enden auf echten Zellen');
{
  for (const { seed, tour, plan } of touren) {
    const belegt = new Set(plan.cells.map((c) => cellKey(c.cell)));
    for (const t of tour.stairs) {
      if (!t.crossable) continue;
      check(belegt.has(cellKey(t.outside[0])), `Saat ${seed}: Treppenausgang unten steht im Fels`);
      check(belegt.has(cellKey(t.outside[1])), `Saat ${seed}: Treppenausgang oben steht im Fels`);
      // Hin- und Rückweg derselben Kante: von der Portzelle nach draussen
      // und von draussen zurück auf die Portzelle. Nur eine Richtung zu
      // prüfen liesse eine vertauschte Gegenrichtung durchgehen.
      check(
        cellKey(neighbourCell(t.port[0], t.portDirection[0])) === cellKey(t.outside[0]) &&
          cellKey(neighbourCell(t.outside[0], OPPOSITE_DIRECTION[t.portDirection[0]])) ===
            cellKey(t.port[0]) &&
          cellKey(neighbourCell(t.port[1], t.portDirection[1])) === cellKey(t.outside[1]) &&
          cellKey(neighbourCell(t.outside[1], OPPOSITE_DIRECTION[t.portDirection[1]])) ===
            cellKey(t.port[1]),
        `Saat ${seed}: Treppenausgänge liegen nicht an ihren Ports`
      );
    }
  }
  console.log('   alle Treppenausgänge liegen auf belegten Zellen');
}

// ── 10. Der Eingang ist der Anfang ───────────────────────────────────
console.log('10. Die Begehung beginnt an der Eingangszelle');
for (const { seed, tour } of touren) {
  check(
    cellKey(tour.start.cell) === cellKey(ENTRANCE_CELL),
    `Saat ${seed}: Start auf ${cellKey(tour.start.cell)} statt ${cellKey(ENTRANCE_CELL)}`
  );
}


if (failures > 0) {
  console.log(`\n${failures} Prüfung(en) rot.`);
  process.exit(1);
}
console.log('\nAlle Prüfungen grün.');
