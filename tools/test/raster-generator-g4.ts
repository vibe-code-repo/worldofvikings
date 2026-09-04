/**
 * G4-Abnahme (Modul-Generierung 2.0): die G1-Metriken gegen den NEUEN Pfad.
 *
 * ── Warum dieselbe Messzelle und nicht eine neue ─────────────────────
 * G1 hat den Ausgangsstand von `DG_StoneVault` auf dem Zellgitter
 * vermessen: 952 Abschlussplatten im Körper des Nachbarmoduls, davon 531
 * gegen eine volle Wand, 414 gegen die Treppenflanke, 7 am Eingang; dazu
 * 531 unerklärte Nachbarschaften. Diese Zahlen sind nur dann ein Massstab,
 * wenn der neue Pfad mit DEMSELBEN Massband gemessen wird. Deshalb
 * importiert dieser Test `messeRasterLayout` aus dem Messskript, statt
 * die Metrik ein zweites Mal zu schreiben — zwei Fassungen derselben
 * Messung gehen beim ersten Nachbessern auseinander, und die grüne
 * gewinnt.
 *
 * Wichtiger noch: Die Messzelle trägt ihre EIGENE Kantenerklärung des
 * Kits (`MODUL_ERKLAERUNG`, aus den Kommentaren an den Moduldefinitionen
 * abgeleitet). Sie ist damit ein unabhängiger Zeuge — der Generator kann
 * sich nicht selbst freisprechen, indem er seine Erklärung verbiegt.
 *
 * ── Was hier zusätzlich zum Messskript geprüft wird ──────────────────
 *  • **Offene Kanten ohne Eingang.** `computeOpenConnections` sieht nur
 *    Connectors ohne Partner. Genau das ist die Zahl, die im Editor als
 *    „n offen“ steht — und der Rasterpfad muss sie auf 0 bringen (der
 *    Eingangsconnector des Startraums ausgenommen, er führt nach
 *    draussen).
 *  • **Erreichbarkeit.** Aus gepaarten Connectors, nicht aus dem Graphen
 *    des Generators: „erreichbar im Graphen“ soll heissen „im Grab
 *    verbunden“.
 *  • **Zellzahl gegen `maxRooms`.** Die Dichtebilanz aus den Risiken.
 *
 * Aufruf: `npx tsx tools/test/raster-generator-g4.ts`
 */
import { computeOpenConnections } from '../../shared/src/dungeonGenerator.js';
import { generateGridLayout } from '../../shared/src/dungeonRasterGenerator.js';
import type { DungeonDef, DungeonLayout, RoomDef } from '../../shared/src/dungeons.js';
import { quatMulVec3 } from '../../shared/src/worldgen/Math3d.js';
import type { Vector3 } from '../../shared/src/types.js';
import {
  SEED_ANZAHL_VORGABE,
  hatRastererklaerung,
  holeKit,
  messeRasterLayout,
  summiereRaster,
  verletzteInvarianten,
} from '../messe-stonevault-logik.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

const kit = holeKit('DG_StoneVault');
const SEEDS = Array.from({ length: SEED_ANZAHL_VORGABE }, (_, i) => i + 1);
/** Mikes Kombination aus `gen-probe` vom 04.09.2026. */
const MIKE = { seed: 2123721695, maxRooms: 12, zoneSize: 32 };

/**
 * Die offenen Kanten OHNE die Eingangskante des Startraums.
 *
 * Nachgebaut statt importiert: `offeneOhneEingang` in `dungeonKanten.ts`
 * ist nicht ausgeführt, und der Meilenstein fasst diese Datei nicht an.
 * Die Bedingung ist dieselbe — Raum 0, Connector mit `entrance`.
 */
function offenOhneEingang(layout: DungeonLayout, def: DungeonDef): number {
  const nachName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  return computeOpenConnections(layout, def.name).filter((c) => {
    if (c.roomIndex !== 0) return true;
    const start = nachName.get(layout.rooms[0]?.room ?? '');
    return !start?.connections[c.connIndex]?.entrance;
  }).length;
}

/**
 * Anteil der vom Eingang aus erreichbaren Zellen — über gepaarte
 * Connectors, wie die Verbindungsmetrik in Teil 1 des Messskripts.
 */
function erreichbarkeit(layout: DungeonLayout, def: DungeonDef): { erreicht: number; gesamt: number } {
  const nachName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  const zellen = layout.rooms
    .map((p, i) => ({ p, i, rd: nachName.get(p.room) }))
    .filter((x) => x.rd && !x.rd.endCap);
  const punkte = new Map<number, Vector3[]>();
  for (const z of zellen) {
    punkte.set(
      z.i,
      z.rd!.connections.map((c) => {
        const w = quatMulVec3(z.p.rot, c.localPos);
        return { x: z.p.pos.x + w.x, y: z.p.pos.y + w.y, z: z.p.pos.z + w.z };
      })
    );
  }
  const nachbarn = new Map<number, number[]>(zellen.map((z) => [z.i, []]));
  for (let a = 0; a < zellen.length; a++) {
    for (let b = a + 1; b < zellen.length; b++) {
      const ia = zellen[a]!.i;
      const ib = zellen[b]!.i;
      const paar = punkte
        .get(ia)!
        .some((pa) => punkte.get(ib)!.some((pb) => Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) < 0.1));
      if (paar) {
        nachbarn.get(ia)!.push(ib);
        nachbarn.get(ib)!.push(ia);
      }
    }
  }
  const gesehen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of nachbarn.get(cur) ?? []) {
      if (!gesehen.has(nb)) {
        gesehen.add(nb);
        queue.push(nb);
      }
    }
  }
  return { erreicht: gesehen.size, gesamt: zellen.length };
}

function messe(def: DungeonDef, seeds: readonly number[], zoneSize?: number) {
  const einstellungen = zoneSize !== undefined ? { zoneSize } : undefined;
  const layouts = seeds.map((seed) => ({ seed, layout: generateGridLayout(def, seed, einstellungen) }));
  const einzel = layouts.map(({ seed, layout }) => {
    const m = messeRasterLayout(layout, def);
    m.seed = seed;
    return m;
  });
  return { layouts, einzel, gesamt: summiereRaster(einzel) };
}

console.log('=== G4-Abnahme: die G1-Metriken gegen den Rasterpfad ===\n');

pruefe(hatRastererklaerung(kit), 'DG_StoneVault hat keine Rastererklärung — die Messung wäre blind');

// ─────────────────────────────────────────────────────────────────────
console.log(`1) ${SEEDS.length} Saaten, Kit-Vorgaben (maxRooms ${kit.maxRooms})`);
{
  const { layouts, gesamt } = messe(kit, SEEDS);
  console.log(
    `  Räume ${gesamt.raeume}, Zellen ${gesamt.zellen}, Platten ${gesamt.plattenGesamt}, ` +
      `in belegter Zelle ${gesamt.platteInBelegterZelle}, unerklärt ${gesamt.unerklaerteNachbarschaften}, ` +
      `doppelt ${gesamt.doppelbelegungen}, gestapelt ${gesamt.gestapelteZellen}, ` +
      `Drift ${gesamt.maxZellDrift.toExponential(2)} m`
  );
  pruefe(gesamt.platteInBelegterZelle === 0, `${gesamt.platteInBelegterZelle} Platten in belegten Zellen (soll 0)`);
  pruefe(gesamt.plattenUeberfluessig === 0, `${gesamt.plattenUeberfluessig} überflüssige Platten (soll 0)`);
  pruefe(gesamt.plattenVorOeffnung === 0, `${gesamt.plattenVorOeffnung} Platten vor einer Öffnung (soll 0)`);
  pruefe(
    gesamt.unerklaerteNachbarschaften === 0,
    `${gesamt.unerklaerteNachbarschaften} unerklärte Nachbarschaften (soll 0)`
  );
  pruefe(gesamt.doppelbelegungen === 0, `${gesamt.doppelbelegungen} Doppelbelegungen (soll 0)`);
  pruefe(gesamt.maxZellDrift < 1e-4, `Zellmitten-Drift ${gesamt.maxZellDrift.toExponential(2)} m (soll < 1e-4)`);
  const verletzt = verletzteInvarianten(gesamt);
  pruefe(verletzt.length === 0, `verletzte Invarianten: ${verletzt.join('; ')}`);
  if (gesamt.unerklaertNachArt.size > 0) {
    for (const [art, n] of gesamt.unerklaertNachArt) console.error(`    ${art}: ${n}`);
  }

  let offenSumme = 0;
  for (const { seed, layout } of layouts) {
    const offen = offenOhneEingang(layout, kit);
    offenSumme += offen;
    pruefe(offen === 0, `Saat ${seed}: ${offen} offene Kante(n) ohne Eingang (soll 0)`);
    const r = erreichbarkeit(layout, kit);
    pruefe(r.erreicht === r.gesamt, `Saat ${seed}: ${r.gesamt - r.erreicht} von ${r.gesamt} Zellen unerreichbar`);
    const zellen = layout.rooms.filter((p) => p.room !== 'StoneVaultWall').length;
    pruefe(Math.abs(zellen - kit.maxRooms) <= 1, `Saat ${seed}: ${zellen} Zellen, erwartet ${kit.maxRooms} ± 1`);
  }
  console.log(`  offene Kanten ohne Eingang: ${offenSumme}; Erreichbarkeit 100 %; Zellzahl = maxRooms ± 1`);
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n2) Mikes Kombination (Saat ${MIKE.seed}, maxRooms ${MIKE.maxRooms}, zoneSize ${MIKE.zoneSize})`);
{
  const def: DungeonDef = { ...kit, maxRooms: MIKE.maxRooms };
  const { layouts, gesamt } = messe(def, [MIKE.seed], MIKE.zoneSize);
  const layout = layouts[0]!.layout;
  const zellen = layout.rooms.filter((p) => p.room !== 'StoneVaultWall').length;
  console.log(
    `  ${layout.rooms.length} Räume, ${zellen} Zellen, ${gesamt.plattenGesamt} Platten, ` +
      `in belegter Zelle ${gesamt.platteInBelegterZelle}, unerklärt ${gesamt.unerklaerteNachbarschaften}, ` +
      `Drift ${gesamt.maxZellDrift.toExponential(2)} m`
  );
  pruefe(gesamt.platteInBelegterZelle === 0, `${gesamt.platteInBelegterZelle} Platten in belegten Zellen (soll 0)`);
  pruefe(
    gesamt.unerklaerteNachbarschaften === 0,
    `${gesamt.unerklaerteNachbarschaften} unerklärte Nachbarschaften (soll 0)`
  );
  pruefe(gesamt.doppelbelegungen === 0, `${gesamt.doppelbelegungen} Doppelbelegungen (soll 0)`);
  pruefe(offenOhneEingang(layout, def) === 0, 'offene Kante ohne Eingang (soll 0)');
  const r = erreichbarkeit(layout, def);
  pruefe(r.erreicht === r.gesamt, `${r.gesamt - r.erreicht} von ${r.gesamt} Zellen unerreichbar`);
  pruefe(Math.abs(zellen - MIKE.maxRooms) <= 1, `${zellen} Zellen, erwartet ${MIKE.maxRooms} ± 1`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Determinismus über die Messung hinweg');
{
  const a = JSON.stringify(generateGridLayout(kit, 12345));
  const b = JSON.stringify(generateGridLayout(kit, 12345));
  pruefe(a === b, 'zwei Läufe derselben Saat sind nicht byte-gleich');
  console.log(`  Saat 12345: ${a.length} Zeichen, zweimal identisch`);
}

console.log(fehler === 0 ? '\nOK — der Rasterpfad hält alle G1-Invarianten' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
