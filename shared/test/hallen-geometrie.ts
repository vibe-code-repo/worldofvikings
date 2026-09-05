/**
 * E1 — Wächter über die Saal-Arithmetik in `shared/src/hallenGeometrie.ts`.
 *
 * ── Warum dieser Test die Zahlen NENNT statt sie nachzurechnen ────────
 * Die Konzeptnotiz leitet aus `boden_decke`/`pillar`/`pillar_positions`
 * eine geschlossene Formel her — B = 2 + 16·cx·cz + 3·P, Dreiecke 12·B,
 * Ecken 24·B — und prüft sie gegen alle fünf ausgelieferten GLBs exakt.
 * Genau daran hängt der TS-Hallengenerator: Er darf Blender nur deshalb
 * ersetzen, weil ein Saal geschlossene Arithmetik ist. Ein Test, der die
 * Formel selbst nochmal aus dem Modul zöge, prüfte nichts — er schriebe
 * die Behauptung ein zweites Mal auf. Deshalb stehen hier die FÜNF
 * gemessenen Zahlen als Konstanten: 66 / 158 / 139 / 261 / 590.
 *
 * ── Warum die Spiegelprobe dazugehört ────────────────────────────────
 * Alle fünf Säle sind punktsymmetrisch. Ein vergessenes oder doppeltes
 * x-Negieren verschöbe deshalb KEINEN einzigen Eckpunkt — die Zahlen
 * blieben grün, und der Fehler zeigte sich erst im Spiel als von aussen
 * sichtbarer Saal. Der einzige Zeuge ist die Wicklung: `aufbereiten()`
 * negiert x, OHNE die Flächenwicklung anzufassen, das signierte Volumen
 * wird dadurch negativ. Genau das misst `pruefeSpiegelung()`.
 *
 * ── Warum er ohne `assets/` durchläuft ───────────────────────────────
 * Der Kern ist reine Arithmetik und braucht keine Datei. Liegen die GLBs
 * da (auf Mikes Maschine), wird zusätzlich gegen sie gemessen; fehlen
 * sie (CI-Checkout, `assets/` liegt ausserhalb des Repos), meldet der
 * Test das im Klartext und bleibt grün. Er darf hier selbst überspringen
 * — anders als eine Sonde, die OHNE Datei nichts zu sagen hätte, behält
 * er seinen vollen Aussagewert.
 *
 * Aufruf: `npx tsx shared/test/hallen-geometrie.ts`
 *
 * E1 guard over the closed-form hall arithmetic: box, pillar, triangle
 * and vertex counts, plus the mirror witness (negative signed volume).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOX_QUADS,
  boxVertices,
  buildHall,
  pillarPositions,
  type Box,
  type HallGeometry,
} from '../src/hallenGeometrie.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Toleranz für Lagevergleiche — grosszügiger als der float32-Exportfehler. */
const TOL = 1e-6;

/*
  Die fünf ausgelieferten Säle mit den Zahlen aus der Konzeptnotiz
  (Abschnitt „Ein Saal ist geschlossene Arithmetik"). `raster` ist das
  Pfeilerraster, mit dem `make-stonevault.py` sie baut.
*/
interface Fall {
  readonly modul: string;
  readonly cellsX: number;
  readonly cellsZ: number;
  readonly raster: number;
  readonly boxes: number;
  readonly pillars: number;
  /** Pfeilerstellen (x, y) im Blender-Bauraum, nach der x-Negation. */
  readonly stellen: readonly (readonly [number, number])[];
}

const FAELLE: readonly Fall[] = [
  { modul: 'StoneVaultHall', cellsX: 2, cellsZ: 2, raster: 2, boxes: 66, pillars: 0, stellen: [] },
  {
    modul: 'StoneVaultHallLarge', cellsX: 3, cellsZ: 3, raster: 2, boxes: 158, pillars: 4,
    stellen: [[1, -1], [1, 1], [-1, -1], [-1, 1]],
  },
  {
    modul: 'StoneVaultHallLong', cellsX: 2, cellsZ: 4, raster: 2, boxes: 139, pillars: 3,
    stellen: [[0, -2], [0, 0], [0, 2]],
  },
  {
    modul: 'StoneVaultHallGrand', cellsX: 4, cellsZ: 4, raster: 4, boxes: 261, pillars: 1,
    stellen: [[0, 0]],
  },
  {
    modul: 'StoneVaultHallVast', cellsX: 6, cellsZ: 6, raster: 4, boxes: 590, pillars: 4,
    stellen: [[2, -2], [2, 2], [-2, -2], [-2, 2]],
  },
];

/** Signiertes Volumen über alle Quaderflächen — negativ heisst vorgespiegelt. */
function signiertesVolumen(boxes: readonly Box[]): number {
  let sechsfach = 0;
  for (const b of boxes) {
    const v = boxVertices(b);
    for (const [a, c, d, e] of BOX_QUADS) {
      // Quad als zwei Dreiecke, Wicklung unverändert übernommen.
      for (const [i, j, k] of [[a, c, d], [a, d, e]] as const) {
        const p = v[i]!;
        const q = v[j]!;
        const r = v[k]!;
        sechsfach +=
          p.x * (q.y * r.z - q.z * r.y) -
          p.y * (q.x * r.z - q.z * r.x) +
          p.z * (q.x * r.y - q.y * r.x);
      }
    }
  }
  return sechsfach / 6;
}

/** Hüllbox über alle Quader — im Bauraum, also Höhe auf z. */
function huelle(boxes: readonly Box[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const mitte = [b.cx, b.cy, b.cz];
    const halb = [b.sx / 2, b.sy / 2, b.sz / 2];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a]!, mitte[a]! - halb[a]!);
      max[a] = Math.max(max[a]!, mitte[a]! + halb[a]!);
    }
  }
  return { min, max };
}

console.log('E1 — Saal-Arithmetik (shared/src/hallenGeometrie.ts)\n');

const gebaut = new Map<string, HallGeometry>();

for (const f of FAELLE) {
  const h = buildHall(f.cellsX, f.cellsZ, { raster: f.raster });
  gebaut.set(f.modul, h);

  check(
    h.boxes.length === f.boxes,
    `${f.modul}: ${h.boxes.length} Quader statt ${f.boxes}`
  );
  check(
    h.pillars.length === f.pillars,
    `${f.modul}: ${h.pillars.length} Pfeiler statt ${f.pillars}`
  );
  check(
    h.triangles === 12 * f.boxes,
    `${f.modul}: ${h.triangles} Dreiecke statt ${12 * f.boxes}`
  );
  check(
    h.vertices === 24 * f.boxes,
    `${f.modul}: ${h.vertices} Ecken statt ${24 * f.boxes}`
  );

  // Pfeilerstellen: nicht nur zählen, sondern nachsehen. Ein Pfeiler auf
  // einer Kantenmitte stünde im Durchgang — die Zahl allein verriete das nie.
  const soll = [...f.stellen].map((s) => `${s[0]},${s[1]}`).sort();
  const ist = h.pillars.map((p) => `${p.x},${p.y}`).sort();
  check(
    soll.length === ist.length && soll.every((s, i) => s === ist[i]),
    `${f.modul}: Pfeilerstellen [${ist.join(' | ')}] statt [${soll.join(' | ')}]`
  );

  // Aussenmass: der Saal muss exakt cellsX x cellsZ Zellen belegen, sonst
  // stossen im Grab Nachbarmodule nicht an.
  const { min, max } = huelle(h.boxes);
  check(Math.abs(max[0]! - min[0]! - f.cellsX * 2) < TOL, `${f.modul}: Breite ${max[0]! - min[0]!}`);
  check(Math.abs(max[1]! - min[1]! - f.cellsZ * 2) < TOL, `${f.modul}: Tiefe ${max[1]! - min[1]!}`);
  check(Math.abs(min[2]! - -0.25) < TOL, `${f.modul}: Unterkante ${min[2]}`);
  check(Math.abs(max[2]! - 3.75) < TOL, `${f.modul}: Oberkante ${max[2]}`);

  console.log(
    `  ${f.modul.padEnd(22)} ${f.cellsX}x${f.cellsZ} Raster ${f.raster}  ` +
    `${h.boxes.length} Quader, ${h.pillars.length} Pfeiler, ` +
    `${h.triangles} Dreiecke, ${h.vertices} Ecken`
  );
}

// ── Spiegelprobe ────────────────────────────────────────────────────────
console.log('\nSpiegelprobe (signiertes Volumen muss negativ sein):');
for (const f of FAELLE) {
  const v = signiertesVolumen(gebaut.get(f.modul)!.boxes);
  check(v < 0, `${f.modul}: signiertes Volumen ${v.toFixed(3)} — nicht vorgespiegelt`);
  console.log(`  ${f.modul.padEnd(22)} ${v.toFixed(3)} m³`);
}

// ── Klemme am Pfeilerraster ─────────────────────────────────────────────
// `pillar_positions` wirft bei einem Raster, das kein Vielfaches der
// Zellbreite ist — sonst stünden die Pfeiler auf den Kantenmitten, also
// mitten in den Durchgängen.
for (const schlecht of [3, 0, 1.5, -2]) {
  let geworfen = false;
  try {
    pillarPositions(4, 4, schlecht);
  } catch {
    geworfen = true;
  }
  check(geworfen, `Pfeilerraster ${schlecht} wird nicht abgelehnt`);
}
console.log('\n  vier ungültige Pfeilerraster abgelehnt');

// ── Abgleich gegen die ausgelieferten GLBs (nur wenn assets/ da ist) ────
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Ecken- und Dreieckszahl eines GLB, ohne Fremdbibliothek. */
function glbZahlen(pfad: string): { ecken: number; dreiecke: number } {
  const roh = readFileSync(pfad);
  let off = 12;
  let json: {
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
    accessors: { count: number }[];
  } | null = null;
  while (off + 8 <= roh.length) {
    const len = roh.readUInt32LE(off);
    const typ = roh.readUInt32LE(off + 4);
    if (typ === 0x4e4f534a) json = JSON.parse(roh.subarray(off + 8, off + 8 + len).toString('utf8'));
    off += 8 + len;
  }
  if (!json) throw new Error(`${pfad}: kein JSON-Chunk`);
  let ecken = 0;
  let dreiecke = 0;
  for (const m of json.meshes) {
    for (const pr of m.primitives) {
      ecken += json.accessors[pr.attributes.POSITION]!.count;
      if (pr.indices !== undefined) dreiecke += json.accessors[pr.indices]!.count / 3;
    }
  }
  return { ecken, dreiecke };
}

const fehlend = FAELLE.filter((f) => !existsSync(resolve(WURZEL, `assets/models/${f.modul}.glb`)));
if (fehlend.length > 0) {
  console.log(
    `\nGLB-Abgleich UEBERSPRUNGEN — ${fehlend.length} Modell(e) fehlen ` +
    `(assets/ liegt ausserhalb des Repos, z.B. ${fehlend[0]!.modul}.glb).`
  );
} else {
  console.log('\nGLB-Abgleich gegen assets/models/:');
  for (const f of FAELLE) {
    const g = glbZahlen(resolve(WURZEL, `assets/models/${f.modul}.glb`));
    const h = gebaut.get(f.modul)!;
    check(g.dreiecke === h.triangles, `${f.modul}: GLB ${g.dreiecke} Dreiecke, Formel ${h.triangles}`);
    check(g.ecken === h.vertices, `${f.modul}: GLB ${g.ecken} Ecken, Formel ${h.vertices}`);
    console.log(
      `  ${f.modul.padEnd(22)} Tris ${h.triangles}/${g.dreiecke}  Ecken ${h.vertices}/${g.ecken}`
    );
  }
}

console.log(failures === 0 ? '\nOK — Saal-Arithmetik deckungsgleich' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
