/**
 * G4 (Modul-Generierung 2.0) — Wächter über den Kern des Rastergenerators.
 *
 * ── Was hier geprüft wird und warum ──────────────────────────────────
 * G4 baut die Kette Zellmenge → Spannbaum → Modulwahl → Versiegelung.
 * Jedes Glied hat eine Fehlerart, die im fertigen Grab nicht auffällt:
 *
 *  • **Zellmenge.** Zu wenige Zellen sähen aus wie eine kleine Karte, nicht
 *    wie ein erdrosselter Generator. Deshalb wird die Zellzahl gegen
 *    `maxRooms` gemessen — die Dichte ist eine Abnahmezahl, kein Gefühl.
 *  • **Spannbaum.** „Erreichbar“ ist im Rasterpfad Bauergebnis, keine
 *    Nachkontrolle. Ein Fehler darin ergäbe eine abgehängte Kammer, die
 *    niemand betritt und keine Zählung meldet.
 *  • **Modulwahl.** Sie ist eine reine Funktion des Öffnungsmusters. Eine
 *    Öffnung mehr als Graphkanten ist erlaubt — aber NUR gegen eine freie
 *    Zelle, denn dort setzt die Tafel eine Platte. Eine Öffnung gegen
 *    einen belegten Nachbarn wäre wieder Mikes Befund: zwei Räume
 *    aneinander, und man kommt nicht durch.
 *  • **Versiegelung.** Die Zeile „offen/wand → keine Platte“ ist der
 *    eigentliche Fix (531 Platten im Stein des Nachbarn). Sie lässt sich
 *    nur widerlegen, indem man jede gesetzte Platte einer Kante zuordnet.
 *
 * ── Warum die Prüfung nicht aus dem Generator kommt ──────────────────
 * Der Generator hat seine eigene Selbstprüfung (S10). Sie prüft dieselben
 * Aussagen — und wäre der Fehler in der gemeinsamen Annahme, schwiegen
 * beide. Dieser Test rechnet deshalb aus dem AUSGEGEBENEN Layout zurück:
 * aus Prefabnamen, Posen und der Modulerklärung (G2), nicht aus den
 * Zwischenständen des Generators. Der Plan wird nur dort gelesen, wo die
 * Absicht (Graphkante) im Layout gar nicht mehr steht.
 */
import {
  DIRECTIONS,
  DIRECTION_VECTOR,
  OPPOSITE_DIRECTION,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
} from '../src/dungeonRasterModul.js';
import {
  ENTRANCE_CELL,
  YAWS,
  cellKey,
  edgeCenterWorld,
  generateGridLayout,
  neighbourCell,
  planGridDungeon,
  rotateDirection,
  yawQuaternion,
  type GridCell,
  type GridPlan,
  type Yaw,
} from '../src/dungeonRasterGenerator.js';
import { DUNGEONS_BY_NAME } from '../src/dungeons.js';
import type { DungeonDef, RoomDef } from '../src/dungeons.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

const KIT = 'DG_StoneVault';
const def = DUNGEONS_BY_NAME.get(KIT);
if (!def) {
  console.error(`Kit '${KIT}' nicht gefunden`);
  process.exit(1);
}
const kit: DungeonDef = def;
const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));

/** Die 40 Saaten des Befunds — dieselbe Stichprobe wie in G1. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** Mikes Kombination aus `gen-probe` vom 04.09.2026. */
const MIKE = { seed: 2123721695, maxRooms: 12, zoneSize: 32 };

const HORIZONTAL: readonly Direction[] = DIRECTIONS.filter(isHorizontal);

function endCapName(): string {
  const wall = kit.rooms.find((r) => r.endCap);
  if (!wall) throw new Error(`Kit '${KIT}' hat keinen Abschluss`);
  return wall.name;
}
const WALL = endCapName();

/**
 * Die offenen Weltkanten eines platzierten Moduls — aus der
 * Modulerklärung (G2) plus Gierung, nicht aus dem Plan. Damit ist die
 * Aussage „hier ist eine Öffnung“ dieselbe, die auch der Client sieht.
 */
function openDirections(room: string, yaw: Yaw): Direction[] {
  const rd = roomByName.get(room);
  if (!rd) throw new Error(`Raum '${room}' nicht im Kit`);
  const m = gridModuleFromRoomDef(rd);
  const cell = m.cells[0];
  if (!cell) throw new Error(`Modul '${room}' hat keine Zelle`);
  return HORIZONTAL.filter((d) => cell.edges[d] === 'open').map((d) => rotateDirection(d, yaw));
}

/** Yaw eines platzierten Raums aus seiner Rotation zurücklesen. */
function yawOf(rot: { x: number; y: number; z: number; w: number }): Yaw | null {
  for (const yaw of YAWS) {
    const q = yawQuaternion(yaw);
    if (
      Math.abs(q.x - rot.x) < 1e-6 &&
      Math.abs(q.y - rot.y) < 1e-6 &&
      Math.abs(q.z - rot.z) < 1e-6 &&
      Math.abs(q.w - rot.w) < 1e-6
    ) {
      return yaw;
    }
  }
  return null;
}

function withMaxRooms(n: number): DungeonDef {
  return { ...kit, maxRooms: n };
}

// ─────────────────────────────────────────────────────────────────────
console.log('1) Determinismus — zwei Läufe, Byte für Byte');
// Der Vertrag des ganzen Pfads: Dieselbe Saat, dasselbe Grab. Eine
// `Set`-Iteration oder ein Gleitkommavergleich in der Ziehreihenfolge
// bräche ihn lautlos, und niemand sähe es an einem einzelnen Layout.
{
  for (const seed of [1, 7, MIKE.seed]) {
    const a = JSON.stringify(generateGridLayout(kit, seed));
    const b = JSON.stringify(generateGridLayout(kit, seed));
    check(a === b, `Saat ${seed}: zwei Läufe liefern verschiedene Layouts`);
  }
  // Und die zweite Hälfte derselben Aussage: verschiedene Saaten dürfen
  // NICHT dasselbe liefern, sonst wäre „deterministisch“ nur konstant.
  const s1 = JSON.stringify(generateGridLayout(kit, 1));
  const s2 = JSON.stringify(generateGridLayout(kit, 2));
  check(s1 !== s2, 'Saat 1 und Saat 2 liefern dasselbe Layout');
  console.log('  3 Saaten byte-gleich wiederholt, zwei Saaten unterscheidbar');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Zellzahl trifft maxRooms');
// Die Dichtebilanz aus dem Risiko-Abschnitt: Wenn die Strenge das Kit
// erdrosselt, sieht man es hier und nicht erst an einem kleinen Grab.
{
  let schlimmste = 0;
  for (const seed of SEEDS) {
    const layout = generateGridLayout(kit, seed);
    const zellen = layout.rooms.filter((r) => r.room !== WALL).length;
    schlimmste = Math.max(schlimmste, Math.abs(zellen - kit.maxRooms));
    check(
      Math.abs(zellen - kit.maxRooms) <= 1,
      `Saat ${seed}: ${zellen} Zellen, erwartet ${kit.maxRooms} ± 1`
    );
  }
  const mike = generateGridLayout(withMaxRooms(MIKE.maxRooms), MIKE.seed, {
    zoneSize: MIKE.zoneSize,
  });
  const mikeZellen = mike.rooms.filter((r) => r.room !== WALL).length;
  check(
    Math.abs(mikeZellen - MIKE.maxRooms) <= 1,
    `Mikes Kombination: ${mikeZellen} Zellen, erwartet ${MIKE.maxRooms} ± 1`
  );
  console.log(
    `  40 Saaten: grösste Abweichung ${schlimmste} Zelle(n); Mike: ${mikeZellen} Zellen`
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Der Eingang hängt am Ursprung');
// `pos (0,0,−1)` mit 180° ist die Aufhängung des ganzen Grabs (G3). Wäre
// sie falsch, läge jeder Raum gleich falsch — und keine Zählung fiele auf.
{
  const layout = generateGridLayout(kit, 1);
  const erster = layout.rooms[0];
  check(erster !== undefined, 'Layout ohne Räume');
  if (erster) {
    const entry = kit.rooms.find((r) => r.entrance);
    check(erster.room === entry?.name, `Raum 0 ist '${erster.room}', erwartet den Eingangsraum`);
    check(
      Math.abs(erster.pos.x) < 1e-9 && Math.abs(erster.pos.y) < 1e-9 && Math.abs(erster.pos.z + 1) < 1e-9,
      `Eingang steht auf ${JSON.stringify(erster.pos)}, erwartet (0,0,−1)`
    );
    check(yawOf(erster.rot) === 180, `Eingang ist um ${yawOf(erster.rot)}° gedreht, erwartet 180°`);
    check(erster.placeOrder === 1, `Eingang hat placeOrder ${erster.placeOrder}, erwartet 1`);
  }
  console.log('  Raum 0: Eingangsmodul auf (0,0,−1), 180°, placeOrder 1');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Nur Einzelzellen, eine Ebene, kein Stempel');
// G4 ist ausdrücklich der Kern OHNE Extras. Eine Halle oder eine Treppe,
// die hier schon mitliefe, brächte mehrzellige Fussabdrücke und eine
// zweite Ebene in eine Prüfung, die beides noch nicht kennt.
{
  const erlaubt = new Set(
    kit.rooms
      .filter((r) => !r.endCap && gridModuleFromRoomDef(r).cells.length === 1)
      .map((r) => r.name)
  );
  for (const seed of SEEDS.slice(0, 10)) {
    const layout = generateGridLayout(kit, seed);
    for (const p of layout.rooms) {
      check(
        p.room === WALL || erlaubt.has(p.room),
        `Saat ${seed}: mehrzelliges Modul '${p.room}' im G4-Kern`
      );
      check(Math.abs(p.pos.y) < 1e-9, `Saat ${seed}: '${p.room}' steht auf y = ${p.pos.y}`);
    }
  }
  console.log(`  erlaubte Module: ${[...erlaubt].sort().join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Modulwahl folgt dem Öffnungsmuster');
// Grad 4 → Zelle, 3 → Abzweig, 2 gegenüber → Korridor, 2 angrenzend →
// Ecke, 1 → Korridor oder Zelle. Geprüft wird gegen die Namen des Kits,
// weil genau diese Zuordnung in der Konzeptnotiz steht — ein anderes
// Modul mit passendem Muster wäre eine stille Änderung der Absicht.
{
  const erwartet = (grad: number, kanten: readonly Direction[]): string[] => {
    if (grad === 4) return ['StoneVaultCell'];
    if (grad === 3) return ['StoneVaultJunction'];
    if (grad === 2) {
      const [a, b] = kanten;
      return OPPOSITE_DIRECTION[a!] === b ? ['StoneVaultCorridor'] : ['StoneVaultCorner'];
    }
    if (grad === 1) return ['StoneVaultCorridor', 'StoneVaultCell'];
    return ['StoneVaultEntry'];
  };
  const zaehlung = new Map<string, number>();
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    for (const c of plan.cells) {
      zaehlung.set(c.module, (zaehlung.get(c.module) ?? 0) + 1);
      if (cellKey(c.cell) === cellKey(ENTRANCE_CELL)) continue; // Eingang ist gesetzt, nicht gewählt
      const erlaubt = erwartet(c.edges.length, c.edges);
      check(
        erlaubt.includes(c.module),
        `Saat ${seed}, Zelle ${cellKey(c.cell)}: Grad ${c.edges.length} (${c.edges.join('')}) ` +
          `→ '${c.module}', erlaubt ${erlaubt.join(' oder ')}`
      );
      // Jede Graphkante MUSS offen sein — sonst wäre eine Verbindung im
      // Graphen im Grab eine Wand.
      const offen = new Set(openDirections(c.module, c.yaw));
      for (const d of c.edges) {
        check(offen.has(d), `Saat ${seed}, Zelle ${cellKey(c.cell)}: Graphkante ${d} ist nicht offen`);
      }
    }
  }
  console.log(
    '  Modulmischung über 40 Saaten: ' +
      [...zaehlung].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Keine Öffnung gegen einen belegten Nachbarn');
// Das ist Mikes Befund als Prüfung: Eine offene Zellkante darf nur auf
// eine Graphkante (Durchgang) oder auf FELS (Platte) treffen. Trifft sie
// auf einen belegten Nachbarn, stehen zwei Räume aneinander, ohne dass
// man durchkommt — egal ob dort eine Platte steht oder nicht.
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const belegt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    for (const c of plan.cells) {
      const kanten = new Set(c.edges);
      for (const d of openDirections(c.module, c.yaw)) {
        if (kanten.has(d)) continue; // Durchgang
        if (c.entrancePort === d) continue; // führt absichtlich nach draussen
        const nachbar = belegt.get(cellKey(neighbourCell(c.cell, d)));
        check(
          nachbar === undefined,
          `Saat ${seed}: Zelle ${cellKey(c.cell)} ('${c.module}') ist nach ${d} offen, ` +
            `dort steht '${nachbar?.module}' ohne Graphkante`
        );
      }
    }
  }
  console.log('  40 Saaten: jede überzählige Öffnung zeigt auf Fels');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Versiegelung nach Kantentafel');
// Genau eine Platte je offener Fels-Kante, keine gegen eine eingebaute
// Wand, keine in einer belegten Zelle. Die Zeile „offen/wand → keine
// Platte“ ist der Grund für den ganzen Umbau.
{
  let platten = 0;
  for (const seed of SEEDS) {
    const layout = generateGridLayout(kit, seed);
    const plan = planGridDungeon(kit, seed);
    const belegt = new Set(plan.cells.map((c) => cellKey(c.cell)));
    // Sollmenge: alle offenen Kanten ohne Graphkante und ohne Eingang.
    const soll = new Set<string>();
    for (const c of plan.cells) {
      const kanten = new Set(c.edges);
      for (const d of openDirections(c.module, c.yaw)) {
        if (kanten.has(d) || c.entrancePort === d) continue;
        soll.add(`${cellKey(c.cell)}#${d}`);
      }
    }
    const ist = new Set<string>();
    for (const p of layout.rooms) {
      if (p.room !== WALL) continue;
      platten++;
      const yaw = yawOf(p.rot);
      check(yaw !== null, `Saat ${seed}: Platte mit fremder Drehung ${JSON.stringify(p.rot)}`);
      if (yaw === null) continue;
      // Die Platte schaut mit ihrer lokalen +z-Fläche IN die Zelle; ihr
      // Körper liegt dahinter. Aus Blickrichtung und Lage folgt die Kante.
      const blick = rotateDirection('n', yaw);
      const zurueck = OPPOSITE_DIRECTION[blick];
      const u = DIRECTION_VECTOR[zurueck];
      // 0,15 m hinter der Kantenmitte — die Mitte des 0,3-m-Körpers.
      const mitte = { x: p.pos.x - u.x * 0.15, y: p.pos.y, z: p.pos.z - u.z * 0.15 };
      let treffer: string | null = null;
      for (const c of plan.cells) {
        const e = edgeCenterWorld(c.cell, zurueck);
        if (Math.hypot(e.x - mitte.x, e.y - mitte.y, e.z - mitte.z) < 1e-3) {
          treffer = `${cellKey(c.cell)}#${zurueck}`;
          break;
        }
      }
      check(treffer !== null, `Saat ${seed}: Platte auf ${JSON.stringify(p.pos)} liegt an keiner Zellkante`);
      if (treffer) {
        check(!ist.has(treffer), `Saat ${seed}: zwei Platten auf derselben Kante ${treffer}`);
        ist.add(treffer);
        // Der Plattenkörper liegt in der Nachbarzelle — die muss frei sein.
        const [k, d] = treffer.split('#') as [string, Direction];
        const c = plan.cells.find((x) => cellKey(x.cell) === k)!;
        check(
          !belegt.has(cellKey(neighbourCell(c.cell, d))),
          `Saat ${seed}: Platte auf ${treffer} steht im Körper des Nachbarn`
        );
      }
    }
    for (const s of soll) check(ist.has(s), `Saat ${seed}: offene Kante ${s} ohne Platte`);
    for (const s of ist) check(soll.has(s), `Saat ${seed}: Platte auf ${s}, die die Tafel nicht verlangt`);
  }
  console.log(`  40 Saaten: ${platten} Platten, jede genau auf einer offenen Fels-Kante`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n8) Erreichbarkeit ist Bauergebnis');
// Der Spannbaum entsteht beim Wachsen, nicht als Nachkontrolle. Diese
// Prüfung rechnet ihn trotzdem nach — aus den Graphkanten, damit ein
// verlorener Ast auffällt und nicht erst im Spiel.
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const belegt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    check(belegt.size === plan.cells.length, `Saat ${seed}: doppelt belegte Zelle`);
    const gesehen = new Set<string>([cellKey(ENTRANCE_CELL)]);
    const queue = [ENTRANCE_CELL as GridCell];
    const tiefe = new Map<string, number>([[cellKey(ENTRANCE_CELL), 0]]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const c = belegt.get(cellKey(cur))!;
      for (const d of c.edges) {
        const nb = neighbourCell(cur, d);
        const k = cellKey(nb);
        if (gesehen.has(k)) continue;
        // Kanten sind beidseitig: der Nachbar muss die Gegenkante führen.
        const other = belegt.get(k);
        check(
          other !== undefined && other.edges.includes(OPPOSITE_DIRECTION[d]),
          `Saat ${seed}: Kante ${cellKey(cur)}→${d} ist einseitig`
        );
        gesehen.add(k);
        tiefe.set(k, (tiefe.get(cellKey(cur)) ?? 0) + 1);
        queue.push(nb);
      }
    }
    check(
      gesehen.size === plan.cells.length,
      `Saat ${seed}: ${plan.cells.length - gesehen.size} von ${plan.cells.length} Zellen unerreichbar`
    );
    // BFS-Reihenfolge und placeOrder: Raum 0 ist der Eingang, danach
    // steigt die Tiefe monoton — sonst ist die Ausgabe nicht die
    // versprochene BFS-Liste.
    let letzte = 0;
    for (const c of plan.cells) {
      check(c.depth === tiefe.get(cellKey(c.cell)), `Saat ${seed}: Tiefe von ${cellKey(c.cell)} weicht ab`);
      check(c.depth >= letzte, `Saat ${seed}: Zelle ${cellKey(c.cell)} bricht die BFS-Reihenfolge`);
      letzte = c.depth;
    }
    // Und dieselbe Reihenfolge im Layout: Zellen nach Tiefe, Platten hinten.
    const layout = generateGridLayout(kit, seed);
    let platteGesehen = false;
    let letzterOrder = 0;
    layout.rooms.forEach((p, i) => {
      if (p.room === WALL) platteGesehen = true;
      else {
        check(!platteGesehen, `Saat ${seed}: Zelle #${i} steht hinter einer Platte`);
        check(p.placeOrder >= letzterOrder, `Saat ${seed}: placeOrder fällt bei #${i}`);
        letzterOrder = p.placeOrder;
      }
    });
  }
  console.log('  40 Saaten: 100 % erreichbar, BFS-Reihenfolge, Platten zuletzt');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n9) Selbstprüfung S10: Rückfall statt falschem Grab');
// Ein Kit ohne Füllmodule kann keine zweite Zelle erklären. Der Generator
// darf daraus KEIN halbes Grab machen: im Test wirft er, im Serverbetrieb
// fällt er deterministisch auf Eingang + Platten zurück (Vorbild
// `dungeon2/generator.ts`). Ein Neu-Würfeln wäre der Determinismusbruch.
{
  const nurEingang: DungeonDef = {
    ...kit,
    rooms: kit.rooms.filter((r) => r.entrance || r.endCap),
    maxRooms: 12,
  };
  let threw = false;
  try {
    generateGridLayout(nurEingang, 1, undefined, { strict: true });
  } catch {
    threw = true;
  }
  check(threw, 'kaputtes Kit kommt im strengen Modus durch');

  const a = generateGridLayout(nurEingang, 1);
  const b = generateGridLayout(nurEingang, 1);
  const c = generateGridLayout(nurEingang, 99);
  check(JSON.stringify(a) === JSON.stringify(b), 'Rückfall ist nicht deterministisch');
  check(JSON.stringify(a) === JSON.stringify(c), 'Rückfall hängt an der Saat');
  check(a.rooms.filter((r) => r.room !== WALL).length === 1, 'Rückfall hat mehr als eine Zelle');
  check(a.doors.length === 0 && a.props.length === 0, 'Rückfall bringt Türen oder Deko mit');
  console.log(`  Rückfall: ${a.rooms.length} Räume (1 Zelle + Platten), byte-gleich`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n10) Der Kern ohne Extras — Schleifen und Torbögen abgeschaltet');
// Bis G5 hiess diese Prüfung „keine Türen, keine Schleifen“, weil es
// beides noch nicht gab. Seit G5 sind es zwei REGLER, und der Kern ist
// das, was bei 0 herauskommt: ein Baum (Zellen − 1 Kanten) ohne einen
// einzigen Rahmen. Damit prüft der Test weiter dieselbe Sache — und
// zusätzlich, dass ein Regler auf 0 wirklich nichts mehr tut.
// Deko bleibt unbedingt leer: Die setzt der Generator nie.
{
  for (const seed of SEEDS.slice(0, 10)) {
    const aus = { loopFraction: 0, archwayFraction: 0 };
    const layout = generateGridLayout(kit, seed, aus);
    check(layout.doors.length === 0, `Saat ${seed}: ${layout.doors.length} Türen bei archwayFraction 0`);
    check(layout.props.length === 0, `Saat ${seed}: ${layout.props.length} Deko im G4-Kern`);
    check(
      generateGridLayout(kit, seed).props.length === 0,
      `Saat ${seed}: Deko mit den Vorgabe-Reglern`
    );
    const plan: GridPlan = planGridDungeon(kit, seed, aus);
    const kanten = plan.cells.reduce((n, c) => n + c.edges.length, 0) / 2;
    check(
      kanten === plan.cells.length - 1,
      `Saat ${seed}: ${kanten} Kanten bei ${plan.cells.length} Zellen — kein Baum`
    );
    check(plan.loops.length === 0, `Saat ${seed}: ${plan.loops.length} Schleifen bei loopFraction 0`);
  }
  console.log('  10 Saaten mit beiden Reglern auf 0: 0 Türen, 0 Deko, Kantenzahl = Zellzahl − 1');
}

console.log(failures === 0 ? '\nOK — der Rasterkern hält seine Tafel' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
