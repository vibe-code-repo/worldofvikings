/**
 * K5.5a — the editor preview keeps the ground under placements free.
 * Die Bewuchs-Vorschau lässt den Grund unter Platzierungen frei.
 *
 * Ohne Browser: echte Streufunktion, Attrappe für den EntityManager. Geprüft:
 *  1. Ohne Platzierung stehen n > 0 Pflanzen im Radius, mit Platzierung 0.
 *  2. Außerhalb des Radius sind es dieselben Pflanzen (Prefab und Position).
 *  3. Die Vorschau folgt den AKTUELLEN Platzierungen (Testflug: Entwurf): nach
 *     Setzen, Verschieben und Löschen — mit G (`neuAufbauen`) und ohne — steht
 *     im Radius nichts bzw. wieder Bewuchs.
 *
 * Lauf:  npx tsx test/bewuchs-freiraum-vorschau.ts
 */
import { GRASLAND_FLORA_NAMEN, RegionGeo, sanitizeWorldLayout, type PlacementDef } from "@wov/shared";
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

function baue(placements: unknown[], provider?: () => readonly PlacementDef[]) {
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
    undefined,
    provider ?? null,
  );
  const liste = () =>
    [...live.values()].map((u) => ({ h: u.prefabHash, x: u.position.x, y: u.position.y, z: u.position.z }));
  return { v, liste };
}
type Pflanze = { h: number; x: number; y: number; z: number };
function pflanzen(placements: unknown[]): Pflanze[] {
  const { v, liste } = baue(placements);
  const innen = v as unknown as { zoneStreuen(x: number, y: number): void };
  for (let zy = -1; zy <= 1; zy++) for (let zx = -1; zx <= 1; zx++) innen.zoneStreuen(zx, zy);
  return liste();
}
const im = (p: { x: number; z: number }, r: number): boolean =>
  Math.hypot(p.x - MITTE.x, p.z - MITTE.z) <= r;
const imQuadrat = (p: { x: number; z: number }, r: number): boolean =>
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
// The levelling reshapes the ground (plateau plus smoothing band), so the
// comparison keeps a 60 m margin — beyond it prefab, x, y and z are identical.
const a = menge(ohne.filter((p) => !imQuadrat(p, RADIUS + 60)));
const b = menge(mit.filter((p) => !imQuadrat(p, RADIUS + 60)));
check("außerhalb bitgleich", a.length === b.length && a.every((s, i) => s === b[i]), `${a.length} vs ${b.length}`);

// ── Aktuelle Platzierungen (Testflug: der Entwurf ändert sich laufend) ──
console.log("\nVorschau folgt den aktuellen Platzierungen:");
{
  let aktuell: PlacementDef[] = [];
  const { v, liste } = baue([], () => aktuell);
  let t = 0;
  const lauf = (): number => {
    // eine Zone je Schritt; der Ring (5x5) steht nach 25 Schritten
    for (let i = 0; i < 40; i++) v.schritt(0, 0, (t += 100));
    return liste().filter((p) => im(p, RADIUS)).length;
  };
  const leer = lauf();
  check("Ausgangslage: Pflanzen im Radius", leer > 0, `${leer}`);
  const haus = { prefab: "BirkeDicht1", x: MITTE.x, z: MITTE.z, einebnen: RADIUS } as PlacementDef;

  aktuell = [haus];
  v.neuAufbauen(); // Taste G
  const nachG = lauf();
  check("Platzierung gesetzt + G: 0 im Radius", nachG === 0, `${nachG}`);

  aktuell = [];
  const geloescht = lauf(); // ohne G: die Vorschau bemerkt die Änderung selbst
  check("Platzierung gelöscht, ohne G: Bewuchs kommt zurück", geloescht === leer, `${geloescht} (vorher ${leer})`);

  aktuell = [haus];
  const gesetzt = lauf();
  check("Platzierung gesetzt, ohne G: 0 im Radius", gesetzt === 0, `${gesetzt}`);

  aktuell = [{ ...haus, x: MITTE.x + 200, z: MITTE.z + 200 } as PlacementDef];
  const verschoben = lauf();
  check("Platzierung weit verschoben: alte Stelle wieder bewachsen", verschoben === leer, `${verschoben} (vorher ${leer})`);
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
