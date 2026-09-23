/**
 * K5.5a — the editor preview keeps the ground under placements free.
 * Die Bewuchs-Vorschau lässt den Grund unter Platzierungen frei.
 *
 * Ohne Browser: echte Streufunktion, Attrappe für den EntityManager. Geprüft:
 *  1. Ohne Platzierung stehen n > 0 Pflanzen im Radius, mit Platzierung 0.
 *  2. Außerhalb des Radius sind es dieselben Pflanzen (Prefab und Position).
 *  3. Die Vorschau benutzt die gemeinsame Funktion `freiflaechenAusPlatzierungen`.
 *
 * Lauf:  npx tsx test/bewuchs-freiraum-vorschau.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GRASLAND_FLORA_NAMEN, RegionGeo, sanitizeWorldLayout } from "@wov/shared";
import * as weltModul from "../src/world/World";
import { BewuchsVorschau } from "../src/editor/BewuchsVorschau";

const { createWorld } = weltModul;
const RADIUS = 20;
const MITTE = { x: 10, z: 10 };

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
    failures++;
  }
}

function pflanzen(placements: unknown[]): Array<{ h: number; x: number; y: number; z: number }> {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: "K5.5a-Vorschau",
    detailSeed: "k55a",
    continents: [],
    regions: [
      {
        id: "probe",
        biome: "grassland",
        shape: { kind: "circle", x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [...GRASLAND_FLORA_NAMEN],
      },
    ],
    placements,
  });
  if (!layout) throw new Error("layout verworfen");
  const welt = createWorld("x", {}, layout);
  if (!(welt.regionGeo instanceof RegionGeo)) throw new Error("keine Region-Welt");
  const live = new Map<string, { prefabHash: number; position: { x: number; y: number; z: number } }>();
  const ent = {
    applyUpdate(u: { key: string; prefabHash: number; position: { x: number; y: number; z: number } }) {
      live.set(u.key, u);
    },
    removeZDO(k: string) {
      live.delete(k);
    },
    flush() {},
  };
  const v = new BewuchsVorschau(
    { seed: welt.seed, geo: welt.geo, heightmaps: welt.heightmaps, regionGeo: welt.regionGeo },
    ent as never,
  );
  const innen = v as unknown as { zoneStreuen(x: number, y: number): void };
  for (let zy = -1; zy <= 1; zy++) for (let zx = -1; zx <= 1; zx++) innen.zoneStreuen(zx, zy);
  return [...live.values()].map((u) => ({ h: u.prefabHash, x: u.position.x, y: u.position.y, z: u.position.z }));
}
const im = (p: { x: number; z: number }, r: number): boolean =>
  Math.abs(p.x - MITTE.x) < r && Math.abs(p.z - MITTE.z) < r;
const menge = (l: Array<{ h: number; x: number; y: number; z: number }>): string[] =>
  l.map((p) => `${p.h}|${p.x},${p.y},${p.z}`).sort();

console.log("=== K5.5a bewuchs-freiraum (Vorschau) ===");
const ohne = pflanzen([]);
const mit = pflanzen([{ prefab: "BirkeDicht1", x: MITTE.x, z: MITTE.z, einebnen: RADIUS }]);
const nOhne = ohne.filter((p) => im(p, RADIUS)).length;
const nMit = mit.filter((p) => im(p, RADIUS)).length;
check("ohne Platzierung Pflanzen im Radius", nOhne > 0, `${nOhne}`);
check("mit Platzierung 0 im Radius", nMit === 0, `${nMit}`);
// The levelling itself reshapes the ground (plateau plus smoothing band), so
// the comparison keeps clear of the band: prefab and x/z only, 60 m margin.
const ohneXZ = (l: typeof ohne) => l.map((p) => ({ ...p, y: 0 }));
const a = menge(ohneXZ(ohne).filter((p) => !im(p, RADIUS + 60)));
const b = menge(ohneXZ(mit).filter((p) => !im(p, RADIUS + 60)));
check("außerhalb bitgleich", a.length === b.length && a.every((s, i) => s === b[i]), `${a.length} vs ${b.length}`);

const quelle = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/editor/BewuchsVorschau.ts"),
  "utf-8",
);
check("nutzt freiflaechenAusPlatzierungen", quelle.includes("freiflaechenAusPlatzierungen("));

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
