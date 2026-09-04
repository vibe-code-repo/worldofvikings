/**
 * G10 (Modul-Generierung 2.0) — der BEGEHUNGSPLAN für die Spielprobe.
 *
 * Aus einem Rastergrundriss wird eine Route: eine Folge von Weltpunkten,
 * die eine Figur zu Fuss abgehen kann und die dabei JEDE Zelle betritt
 * und JEDEN Durchgang quert. `tools/pw-stonevault-walk.mjs --tour` läuft
 * sie im Spiel ab.
 *
 * ── Warum die Route nicht einfach die BFS-Liste ist ──────────────────
 * Die Konzeptnotiz (S9) gibt die Zellen in BFS-Reihenfolge aus, und der
 * Meilenstein verlangt, „jede Zelle der BFS-Liste abzulaufen". Die Liste
 * selbst ist aber kein Weg: Zwei in der BFS-Reihenfolge benachbarte
 * Zellen liegen oft in verschiedenen Zweigen und sind im Grab zwanzig
 * Meter und sechs Wände voneinander entfernt. Wer sie der Reihe nach
 * ansteuert, misst nicht die Begehbarkeit, sondern die Server-Drift (die
 * Figur wird nach ~2 s durch die Wand gezogen, s. Memory
 * „Serverposition kennt keine Wände"). Deshalb liefert dieses Modul eine
 * TIEFENSUCHE mit Rückweg — jeder Schritt ist genau eine Zellkante.
 *
 * ── Warum jede Kante und nicht nur der Spannbaum ─────────────────────
 * Ein Spannbaumlauf erreicht jede Zelle und quert trotzdem nur etwa die
 * Hälfte der Durchgänge. Die andere Hälfte sind die Schleifenkanten aus
 * G5 — die neuen, die die Torbögen tragen und die es im 1.0-Pfad so nie
 * gab. „Kein Durchgang, der im Bild eine Wand ist" wäre über genau die
 * interessantesten Kanten nie geprüft. Die Route quert deshalb jede
 * Kante zweimal (hin und zurück); das ist der klassische
 * Tiefensuch-Rundgang und kostet nur den Rückweg, den man ohnehin geht.
 *
 * ── Warum eine Treppe GEQUERT und nicht aufgezählt wird ──────────────
 * Die Treppe belegt drei Zellen auf Ebene `e` und dieselben drei auf
 * `e+1` (Konzept S3). Der Lauf steigt von der einen Ecke zur anderen —
 * die Zellmitten der jeweils „falschen" Ebene liegen also im Luftraum
 * über bzw. unter dem Lauf und sind KEIN Standplatz. Eine Route, die sie
 * ansteuert, meldete „Zelle nicht erreicht" und beschuldigte damit den
 * Generator für eine Eigenschaft der Geometrie. Ein Treppenraum ist hier
 * deshalb EIN Schritt: von der Zelle vor dem unteren Ausgang zu der
 * hinter dem oberen. Ihre sechs Zellen gelten damit als durchlaufen —
 * und die Ebenenänderung ist der Zeuge, dass es wirklich passiert ist.
 *
 * Aufruf (Route aus einem gespeicherten Dokument, mit Byte-Vergleich):
 *   npx tsx tools/raster-begehungsplan.ts --dokument raster-probe --aus /tmp/tour.json
 * Aufruf (Route aus Kit und Saat, ohne Server):
 *   npx tsx tools/raster-begehungsplan.ts --kit DG_StoneVault --saat 7 --zellen 60 --zone 32
 */
import {
  ENTRANCE_CELL,
  cellKey,
  cellToWorld,
  compareCells,
  erzeugeLayoutFuerKit,
  neighbourCell,
  planGridDungeon,
  type GridCell,
  type GridPlan,
  type GridSettings,
} from '../shared/src/dungeonRasterGenerator.js';
import {
  DIRECTIONS,
  OPPOSITE_DIRECTION,
  type Direction,
} from '../shared/src/dungeonRasterModul.js';
import type { DungeonDef, DungeonLayout } from '../shared/src/dungeons.js';
import type { Vector3 } from '../shared/src/types.js';
import { holeKit } from './messe-stonevault-logik.js';

/** Ein Treppenlauf, auf seine beiden Ausgänge zurückgerechnet. */
export interface StairRun {
  /** Index des Raums in `GridPlan.rooms`. */
  readonly room: number;
  /** Alle Zellen des Laufs — beide Ebenen, kanonisch sortiert. */
  readonly cells: readonly GridCell[];
  /** Die beiden Treppenzellen mit Aussenkante, `[unten, oben]`. */
  readonly port: readonly [GridCell, GridCell];
  /** Richtung von der Portzelle NACH DRAUSSEN, `[unten, oben]`. */
  readonly portDirection: readonly [Direction, Direction];
  /** Die beiden Zellen ausserhalb des Laufs, `[unten davor, oben dahinter]`. */
  readonly outside: readonly [GridCell, GridCell];
  /**
   * Ob der Lauf begehbar ist, also beide Ausgänge an belegten Zellen
   * verschiedener Ebenen hängen. Eine Treppe, die nur unten angeschlossen
   * ist, wäre eine Sackgasse — sie darf im Bericht nicht als „gequert"
   * durchgehen, nur weil niemand hingelaufen ist.
   */
  readonly crossable: boolean;
}

/** Ein Schritt der Begehung: ein Zellwechsel, kein Sprung. */
export interface WalkStep {
  /** Zielzelle dieses Schritts. */
  readonly cell: GridCell;
  /** Zellmitte in Weltkoordinaten — das, was der Läufer ansteuert. */
  readonly world: Vector3;
  /** Modulname der Zielzelle (`RoomDef.name`). */
  readonly module: string;
  /** Index in {@link WalkTour.stairs}, wenn dieser Schritt durch eine Treppe führt. */
  readonly stairRoom: number | null;
  /** +1 hoch, −1 herunter, 0 waagerecht. */
  readonly levelChange: number;
  /** Rückweg der Tiefensuche — für den Bericht, nicht für den Lauf. */
  readonly backtrack: boolean;
  /** Prefabname des Torbogens auf dieser Kante, sonst null. */
  readonly archway: string | null;
}

/** Die fertige Route. */
export interface WalkTour {
  readonly base: string;
  readonly seed: number;
  readonly settings: { readonly maxRooms: number; readonly zoneSize: number };
  readonly start: { readonly cell: GridCell; readonly world: Vector3 };
  readonly steps: readonly WalkStep[];
  /** Die begehbaren Zellen in BFS-Reihenfolge — ohne die Treppenzellen. */
  readonly walkCells: readonly GridCell[];
  /** Die Zellen aller Treppenläufe. Sie werden durchlaufen, nie angesteuert. */
  readonly stairCells: readonly GridCell[];
  readonly stairs: readonly StairRun[];
  /** Zellen, die zu einer Halle gehören — dort entstehen die Beweisbilder. */
  readonly hallCells: readonly GridCell[];
  /** Zellzahl des Grundrisses insgesamt (begehbar + Treppe). */
  readonly cellCount: number;
}

/** Eine Nachbarschaft im BEGEHBAREN Graphen. */
interface WalkLink {
  readonly to: GridCell;
  readonly stairRoom: number | null;
  readonly archway: string | null;
}

/**
 * Ein Raum ist eine Treppe, wenn seine Zellen auf mehr als einer Ebene
 * liegen.
 *
 * Abgeleitet statt am Namen erkannt: `module === 'StoneVaultStairs'` wäre
 * eine zweite Wahrheit über dieselbe Eigenschaft, und ein zweites
 * Ebenenmodul im Kit fiele durch sie hindurch, ohne dass irgendetwas
 * rot würde.
 */
function isMultiLevel(cells: readonly GridCell[]): boolean {
  return cells.some((c) => c.level !== cells[0].level);
}

/** Die Treppenläufe eines Plans, samt ihren beiden Ausgängen. */
function collectStairs(plan: GridPlan): StairRun[] {
  const cellsByKey = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
  const roomOf = new Map<string, number>();
  for (const c of plan.cells) roomOf.set(cellKey(c.cell), c.room);

  const runs: StairRun[] = [];
  plan.rooms.forEach((room, index) => {
    if (!isMultiLevel(room.cells)) return;
    const inside = new Set(room.cells.map(cellKey));
    // Die Aussenkanten des Laufs: Graphkanten aus einer seiner Zellen
    // heraus. Kanonisch sortiert, damit die Auswahl unten nicht an der
    // Reihenfolge hängt, in der `plan.cells` gerade steht.
    const links: { port: GridCell; direction: Direction; outside: GridCell }[] = [];
    for (const cell of room.cells) {
      const at = cellsByKey.get(cellKey(cell));
      if (!at) continue;
      for (const d of DIRECTIONS) {
        if (!at.edges.includes(d)) continue;
        const nb = neighbourCell(cell, d);
        if (inside.has(cellKey(nb))) continue;
        links.push({ port: cell, direction: d, outside: nb });
      }
    }
    links.sort(
      (a, b) =>
        compareCells(a.port, b.port) ||
        DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction)
    );
    // Gesucht ist EIN Paar, das die Ebene wechselt. Mehr als zwei
    // Ausgänge hat das Kit nicht; die Suche ist trotzdem allgemein, weil
    // ein künftiges Ebenenmodul mehr haben könnte.
    let unten: (typeof links)[number] | null = null;
    let oben: (typeof links)[number] | null = null;
    for (const a of links) {
      for (const b of links) {
        if (a.outside.level >= b.outside.level) continue;
        // Beide Ausgänge müssen auf belegten Zellen enden, die NICHT zu
        // einer weiteren Treppe gehören — sonst ist der Zielpunkt wieder
        // ein Luftraum.
        const ra = roomOf.get(cellKey(a.outside));
        const rb = roomOf.get(cellKey(b.outside));
        if (ra === undefined || rb === undefined) continue;
        if (isMultiLevel(plan.rooms[ra].cells) || isMultiLevel(plan.rooms[rb].cells)) continue;
        unten = a;
        oben = b;
        break;
      }
      if (unten) break;
    }
    runs.push({
      room: index,
      cells: [...room.cells].sort(compareCells),
      port: [unten?.port ?? room.cells[0], oben?.port ?? room.cells[0]],
      portDirection: [unten?.direction ?? 'n', oben?.direction ?? 'n'],
      outside: [unten?.outside ?? room.cells[0], oben?.outside ?? room.cells[0]],
      crossable: unten !== null && oben !== null,
    });
  });
  return runs;
}

/**
 * Der begehbare Graph: Zellen ohne Treppenzellen, Treppen als EINE Kante
 * zwischen ihren beiden Aussenzellen.
 */
function buildWalkGraph(
  plan: GridPlan,
  stairs: readonly StairRun[]
): Map<string, WalkLink[]> {
  const stairCell = new Map<string, number>();
  stairs.forEach((s, i) => {
    for (const c of s.cells) stairCell.set(cellKey(c), i);
  });
  const archway = new Map<string, string>();
  for (const a of plan.archways) {
    archway.set(`${cellKey(a.cell)}>${cellKey(neighbourCell(a.cell, a.direction))}`, a.door);
    archway.set(`${cellKey(neighbourCell(a.cell, a.direction))}>${cellKey(a.cell)}`, a.door);
  }

  const graph = new Map<string, WalkLink[]>();
  const push = (from: GridCell, link: WalkLink): void => {
    const key = cellKey(from);
    const list = graph.get(key);
    if (list) list.push(link);
    else graph.set(key, [link]);
  };
  for (const c of plan.cells) {
    if (stairCell.has(cellKey(c.cell))) continue;
    graph.set(cellKey(c.cell), graph.get(cellKey(c.cell)) ?? []);
    for (const d of c.edges) {
      const nb = neighbourCell(c.cell, d);
      if (!stairCell.has(cellKey(nb))) {
        push(c.cell, {
          to: nb,
          stairRoom: null,
          archway: archway.get(`${cellKey(c.cell)}>${cellKey(nb)}`) ?? null,
        });
        continue;
      }
      // Die Kante führt in eine Treppe: Ziel ist die Zelle JENSEITS des
      // Laufs, nicht die Treppenzelle selbst.
      const index = stairCell.get(cellKey(nb))!;
      const run = stairs[index];
      if (!run.crossable) continue;
      const hierUnten = cellKey(run.outside[0]) === cellKey(c.cell);
      const hierOben = cellKey(run.outside[1]) === cellKey(c.cell);
      if (!hierUnten && !hierOben) continue;
      push(c.cell, { to: hierUnten ? run.outside[1] : run.outside[0], stairRoom: index, archway: null });
    }
  }
  // Kanonische Reihenfolge je Zelle — die Determinismus-Falle der
  // Konzeptnotiz: `c.edges` ist zwar sortiert, aber die Treppenkanten
  // werden dazwischengeschoben und tragen ein anderes Ziel.
  for (const list of graph.values()) {
    list.sort(
      (a, b) => compareCells(a.to, b.to) || (a.stairRoom ?? -1) - (b.stairRoom ?? -1)
    );
  }
  return graph;
}

/**
 * Die Route: Tiefensuche ab dem Eingang, jede Kante genau zweimal.
 *
 * Iterativ statt rekursiv — ein Grundriss mit 200 Zellen und einem langen
 * Gang hätte eine Rekursionstiefe von 200, und der Stapel wäre das
 * Letzte, worüber ein Messwerkzeug stolpern soll.
 */
function walkDepthFirst(
  graph: Map<string, WalkLink[]>,
  plan: GridPlan,
  stairs: readonly StairRun[]
): WalkStep[] {
  const moduleOf = new Map(plan.cells.map((c) => [cellKey(c.cell), c.module]));
  const steps: WalkStep[] = [];
  const visited = new Set<string>([cellKey(ENTRANCE_CELL)]);
  const crossed = new Set<string>();
  // Der Stapel hält je Zelle den Index der nächsten zu prüfenden Kante.
  const stack: { cell: GridCell; next: number }[] = [{ cell: ENTRANCE_CELL, next: 0 }];

  const schritt = (
    from: GridCell,
    link: WalkLink,
    backtrack: boolean
  ): void => {
    steps.push({
      cell: link.to,
      world: cellToWorld(link.to),
      module: moduleOf.get(cellKey(link.to)) ?? '?',
      stairRoom: link.stairRoom,
      levelChange: Math.sign(link.to.level - from.level),
      backtrack,
      archway: link.archway,
    });
  };

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const links = graph.get(cellKey(top.cell)) ?? [];
    if (top.next >= links.length) {
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) {
        // Rückweg über dieselbe Kante, über die wir hergekommen sind.
        const back = (graph.get(cellKey(top.cell)) ?? []).find(
          (l) => cellKey(l.to) === cellKey(parent.cell)
        );
        schritt(
          top.cell,
          back ?? { to: parent.cell, stairRoom: null, archway: null },
          true
        );
      }
      continue;
    }
    const link = links[top.next++];
    // Kantenschlüssel kanonisch: `(A→B)` und `(B→A)` sind dieselbe Kante.
    const paar =
      compareCells(top.cell, link.to) <= 0
        ? `${cellKey(top.cell)}|${cellKey(link.to)}`
        : `${cellKey(link.to)}|${cellKey(top.cell)}`;
    const key = `${paar}#${link.stairRoom ?? '-'}`;
    if (crossed.has(key)) continue;
    crossed.add(key);
    schritt(top.cell, link, false);
    if (visited.has(cellKey(link.to))) {
      // Schon besuchte Zelle: hin und sofort zurück. Der Durchgang ist
      // damit in BEIDE Richtungen belaufen, ohne den Rundgang zu
      // verlassen.
      const zurueck = (graph.get(cellKey(link.to)) ?? []).find(
        (l) => cellKey(l.to) === cellKey(top.cell) && l.stairRoom === link.stairRoom
      );
      schritt(link.to, zurueck ?? { to: top.cell, stairRoom: link.stairRoom, archway: link.archway }, true);
      continue;
    }
    visited.add(cellKey(link.to));
    stack.push({ cell: link.to, next: 0 });
  }
  void stairs;
  return steps;
}

/** Kit + Saat + Einstellungen → Route. Rein rechnerisch, kein Server. */
export function planWalkTour(
  def: DungeonDef,
  seed: number,
  settings?: Partial<GridSettings>
): WalkTour {
  const plan = planGridDungeon(def, seed, settings);
  const stairs = collectStairs(plan);
  const stairKeys = new Set(stairs.flatMap((s) => s.cells.map(cellKey)));
  const graph = buildWalkGraph(plan, stairs);
  const steps = walkDepthFirst(graph, plan, stairs);
  const hallRooms = new Set(
    plan.rooms.map((r, i) => (r.cells.length >= 4 && !isMultiLevel(r.cells) ? i : -1)).filter((i) => i >= 0)
  );
  return {
    base: def.name,
    seed,
    settings: {
      maxRooms: def.maxRooms,
      zoneSize: settings?.zoneSize ?? def.generatorEinstellungen?.zoneSize ?? 64,
    },
    start: { cell: ENTRANCE_CELL, world: cellToWorld(ENTRANCE_CELL) },
    steps,
    walkCells: plan.cells.filter((c) => !stairKeys.has(cellKey(c.cell))).map((c) => c.cell),
    stairCells: stairs.flatMap((s) => s.cells),
    stairs,
    hallCells: plan.cells.filter((c) => hallRooms.has(c.room)).map((c) => c.cell),
    cellCount: plan.cells.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

interface DokumentAntwort {
  readonly dungeon: {
    readonly id: string;
    readonly base: string;
    readonly mode: string;
    readonly seed: number;
    readonly zoneSize?: number;
    readonly generatorEinstellungen?: { maxRooms?: number; zoneSize?: number; loopFraction?: number; archwayFraction?: number };
    readonly layout: DungeonLayout;
  };
}

async function holeDokument(host: string, id: string): Promise<DokumentAntwort['dungeon']> {
  const user = process.env.WOV_DEV_USER ?? 'Admin';
  const pass = process.env.WOV_DEV_PASS ?? '!T3mp12345';
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const antwort = await fetch(`${host}/api/dungeons/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!antwort.ok) throw new Error(`GET /api/dungeons/${id} → ${antwort.status}`);
  const daten = (await antwort.json()) as DokumentAntwort;
  return daten.dungeon;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wert = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dokument = wert('--dokument');
  const host = wert('--host') ?? 'https://editor.dev.world-of-vikings.com';
  const ausgabe = wert('--aus');

  let def: DungeonDef;
  let seed: number;
  let zone: number;
  let dungeonId: string | null = null;
  let bytegleich: boolean | null = null;

  if (dokument) {
    const doc = await holeDokument(host, dokument);
    dungeonId = doc.id;
    seed = doc.seed;
    const basis = holeKit(doc.base);
    const zellen = doc.generatorEinstellungen?.maxRooms;
    zone = doc.generatorEinstellungen?.zoneSize ?? doc.zoneSize ?? 64;
    def = zellen !== undefined ? { ...basis, maxRooms: zellen } : basis;
    // Der ZEUGE: Nur wenn dieselbe Saat dasselbe Layout ergibt, beschreibt
    // die Route WIRKLICH das Grab, das gleich betreten wird. Ohne diesen
    // Vergleich liefe die Figur nach einem fremden Grundriss und jeder
    // Fehlschlag wäre unerklärlich.
    const nachgebaut = erzeugeLayoutFuerKit(def, seed, {
      zoneSize: zone,
      ...(doc.generatorEinstellungen?.loopFraction !== undefined
        ? { loopFraction: doc.generatorEinstellungen.loopFraction }
        : {}),
      ...(doc.generatorEinstellungen?.archwayFraction !== undefined
        ? { archwayFraction: doc.generatorEinstellungen.archwayFraction }
        : {}),
    });
    bytegleich = JSON.stringify(nachgebaut) === JSON.stringify(doc.layout);
  } else {
    const kit = wert('--kit') ?? 'DG_StoneVault';
    const basis = holeKit(kit);
    seed = Number(wert('--saat') ?? '1');
    zone = Number(wert('--zone') ?? '32');
    const zellen = wert('--zellen');
    def = zellen !== undefined ? { ...basis, maxRooms: Number(zellen) } : basis;
  }

  const tour = planWalkTour(def, seed, { zoneSize: zone });
  const treppen = tour.stairs.filter((s) => s.crossable).length;
  console.log(
    `${dungeonId ?? tour.base} — Saat ${seed}, ${tour.cellCount} Zellen ` +
      `(${tour.walkCells.length} begehbar, ${tour.stairCells.length} Treppe), ` +
      `${tour.stairs.length} Treppen (${treppen} querbar), ${tour.hallCells.length} Hallenzellen`
  );
  console.log(
    `  Route: ${tour.steps.length} Schritte, ` +
      `${tour.steps.filter((s) => s.stairRoom !== null).length} über eine Treppe, ` +
      `${tour.steps.filter((s) => s.archway).length} durch einen Torbogen`
  );
  if (bytegleich !== null) {
    console.log(`  Nachbau des Dokuments byte-gleich: ${bytegleich ? 'JA' : 'NEIN'}`);
    if (!bytegleich) process.exitCode = 1;
  }
  if (ausgabe) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(ausgabe, JSON.stringify({ dungeonId, layoutMatches: bytegleich, ...tour }, null, 1));
    console.log(`  geschrieben: ${ausgabe}`);
  }
}

// Nur beim direkten Aufruf laufen — der Test importiert `planWalkTour`.
if (process.argv[1] && /raster-begehungsplan\.ts$/.test(process.argv[1])) {
  void main();
}

void OPPOSITE_DIRECTION;
