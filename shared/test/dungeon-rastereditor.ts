/**
 * G9 — der Editor auf derselben Regel wie der Generator.
 *
 * ── Warum diese Prüfung ──────────────────────────────────────────────
 * Der Rasterpfad (G4…G8) baut nach der Kantentafel: Eine Öffnung steht
 * nie vor einer eingebauten Wand, und eine Platte steht nie im Körper des
 * Nachbarn. Der HANDBAU ging bis heute an dieser Regel vorbei —
 * `attachRoom` prüfte allein Hüllen, und die Hülle eines Moduls lügt um
 * 0,6 m (`size.x = 1,4` statt 2, Begründung an `StoneVaultCorridor`).
 * Genau in dieser Lücke entsteht Mikes Befund vom 04.09.2026: zwei Räume
 * nebeneinander, dazwischen eine Wand vor einer Öffnung.
 *
 * Gemessen wird deshalb an vier Stellen, und keine davon ist „läuft
 * durch":
 *  1. `computeOpenConnections(…, { ohneEingang: true })` zählt LÖCHER,
 *     nicht Connectors — ein frisches StoneVault meldet 0.
 *  2. `attachRoom` weist einen Anbau ab, der eine `offen/wand`-Kante
 *     erzeugte — in BEIDE Richtungen (neue Öffnung vor fremder Wand und
 *     neue Wand vor fremder Öffnung).
 *  3. `schliesseOffeneKanten` setzt GENAU die Platten der Tafel: Nimmt
 *     man einem gewürfelten Grab alle Platten weg und lässt den Editor
 *     schliessen, steht danach dieselbe Kantenmenge zu.
 *  4. Nach `removeRoom` + erneutem Schliessen hält das Layout wieder alle
 *     G4-Invarianten (keine Doppelbelegung, keine Platte im fremden
 *     Körper, keine unversiegelte Öffnung, 100 % erreichbar).
 *
 * Lauf: npx tsx shared/test/dungeon-rastereditor.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import {
  DIRECTIONS,
  OPPOSITE_DIRECTION,
  cellKey,
  compareCells,
  gridEdgeTable,
  gridModulesOfKit,
  isHorizontal,
  neighbourCell,
  worldToCell,
  type Direction,
  type GridCell,
  type GridEdgeTable,
} from '../src/dungeonRasterModul.js';
import {
  DUNGEONS_BY_NAME,
  attachRoom,
  computeOpenConnections,
  removeRoom,
  schliesseOffeneKanten,
  type DungeonDef,
  type DungeonLayout,
  type OpenConnection,
} from '../src/index.js';
import { erzeugeLayoutFuerKit } from '../src/dungeonRasterGenerator.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

const vault = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!vault) throw new Error('Kit DG_StoneVault fehlt.');
const stein = DUNGEONS_BY_NAME.get('DG_Steingrab');
if (!stein) throw new Error('Kit DG_Steingrab fehlt.');

const SAATEN = Array.from({ length: 40 }, (_, i) => i + 1);

/** Die Abschlussplatten eines Layouts — ihre Indizes, hinten zuerst. */
function plattenIndizes(layout: DungeonLayout, def: DungeonDef): number[] {
  const istPlatte = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  const out: number[] = [];
  layout.rooms.forEach((r, i) => {
    if (istPlatte.get(r.room)) out.push(i);
  });
  return out.reverse();
}

/**
 * Eine Weltkoordinate als Schlüssel — auf den Millimeter gerundet und mit
 * getilgter negativer Null.
 *
 * Beides ist nötig, und beides ist eine Determinismus-Falle aus der
 * Konzeptnotiz: Der Generator rechnet die Plattenmitte über `sealPose`,
 * der Editor über `attachRoom`; dieselbe Kante kommt einmal als `0` und
 * einmal als `−1 · 10⁻¹⁶` heraus. `toFixed(3)` macht daraus `0.000` und
 * `-0.000` — zwei Schlüssel für dieselbe Wand.
 */
function ortsSchluessel(v: { x: number; y: number; z: number }): string {
  const mm = (n: number): string => {
    const r = Math.round(n * 1000) / 1000;
    return (r === 0 ? 0 : r).toFixed(3);
  };
  return `${mm(v.x)}|${mm(v.y)}|${mm(v.z)}`;
}

/**
 * Die Kanten, auf denen Platten stehen — als kanonische Schlüssel.
 *
 * Verglichen wird die KANTENMENGE, nicht die Pose: Der Generator rechnet
 * die Platte über `sealPose`, der Editor über `attachRoom`; beide landen
 * auf derselben Kantenmitte, dürfen aber dasselbe Quaternion mit
 * umgekehrtem Vorzeichen schreiben. Ein Vorzeichen ist keine andere Wand.
 */
function plattenKanten(layout: DungeonLayout, def: DungeonDef): Set<string> {
  const istPlatte = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  const out = new Set<string>();
  for (const r of layout.rooms) {
    if (!istPlatte.get(r.room)) continue;
    // Die Platte liegt IN der Kantenebene: Ihre Mitte rundet auf die
    // Zelle, vor deren Öffnung sie steht — der 0,3-m-Körper reicht nicht
    // über die halbe Zelle hinaus.
    out.add(ortsSchluessel(r.pos));
  }
  return out;
}

/** Tafel eines Layouts — ohne die Platten, die keine Zelle belegen. */
function tafel(layout: DungeonLayout, def: DungeonDef): GridEdgeTable {
  return gridEdgeTable(layout.rooms, gridModulesOfKit(def.rooms));
}

/**
 * Die G4-Invarianten auf einem LAYOUT (der Generator prüft sie auf dem
 * Plan). Rückgabe: die Verstösse im Klartext, leer heisst sauber.
 */
function invarianten(layout: DungeonLayout, def: DungeonDef): string[] {
  const mangel: string[] = [];
  const modules = gridModulesOfKit(def.rooms);
  const belegt = new Map<string, number>();
  layout.rooms.forEach((r, index) => {
    const m = modules.get(r.room);
    if (!m || m.endCap) return;
    for (const c of gridEdgeTable([r], modules).values()) {
      const k = cellKey(c.cell);
      if (belegt.has(k)) mangel.push(`Zelle ${k} doppelt belegt (${belegt.get(k)} und ${index})`);
      belegt.set(k, index);
    }
  });
  const t = tafel(layout, def);

  // Der Eingangsport zeigt nach draussen — er ist kein Loch.
  const eingang = new Set<string>();
  const start = def.rooms.find((r) => r.name === layout.rooms[0]?.room);
  const startModul = start ? modules.get(start.name) : undefined;
  if (start && startModul) {
    for (const p of startModul.ports) {
      if (!p.entrance) continue;
      const eintrag = [...t.values()].find((c) => c.roomIndex === 0);
      if (eintrag) eingang.add(`${cellKey(eintrag.cell)}#n`);
    }
  }

  // Platten: vor einer Öffnung, nie vor einem Durchgang, nie im Körper.
  const versiegelt = new Set<string>();
  const istPlatte = new Map(def.rooms.map((r) => [r.name, !!r.endCap]));
  for (const r of layout.rooms) {
    if (!istPlatte.get(r.room)) continue;
    const mitte = worldToCell(r.pos);
    // Die Platte liegt auf der Kante zwischen `mitte` und der Zelle, aus
    // deren Richtung sie kommt — gesucht wird die belegte Nachbarzelle,
    // deren Öffnung sie zumacht.
    let getroffen = false;
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d)) continue;
      const wirt = t.get(cellKey(neighbourCell(mitte, d)));
      if (!wirt) continue;
      const gegen = OPPOSITE_DIRECTION[d];
      if (wirt.edges[gegen] !== 'open') continue;
      versiegelt.add(`${cellKey(wirt.cell)}#${gegen}`);
      getroffen = true;
    }
    if (!getroffen) mangel.push(`Platte auf ${cellKey(mitte)} steht vor keiner Öffnung`);
  }

  // Offene Kanten: Durchgang, Platte oder eingebaute Wand gegenüber.
  for (const c of [...t.values()].sort((a, b) => compareCells(a.cell, b.cell))) {
    for (const d of DIRECTIONS) {
      if (c.edges[d] !== 'open') continue;
      const schluessel = `${cellKey(c.cell)}#${d}`;
      if (eingang.has(schluessel)) continue;
      const nb = t.get(cellKey(neighbourCell(c.cell, d)));
      const gegen = nb ? nb.edges[OPPOSITE_DIRECTION[d]] : null;
      if (gegen === 'open') continue; // Durchgang
      if (gegen === 'wall') continue; // Zeile 3 der Tafel
      if (versiegelt.has(schluessel)) continue;
      mangel.push(`Kante ${schluessel} ist offen und unversiegelt (gegenüber '${gegen ?? 'fels'}')`);
    }
  }

  // Erreichbarkeit ab der Eingangszelle, über Durchgänge.
  const startZelle = [...t.values()].find((c) => c.roomIndex === 0)?.cell;
  if (!startZelle) {
    mangel.push('kein Eingangsraum in der Tafel');
    return mangel;
  }
  const gesehen = new Set<string>([cellKey(startZelle)]);
  const schlange: GridCell[] = [startZelle];
  while (schlange.length > 0) {
    const cur = schlange.shift()!;
    const hier = t.get(cellKey(cur));
    if (!hier) continue;
    for (const d of DIRECTIONS) {
      if (hier.edges[d] !== 'open') continue;
      const nb = t.get(cellKey(neighbourCell(cur, d)));
      if (!nb || nb.edges[OPPOSITE_DIRECTION[d]] !== 'open') continue;
      if (gesehen.has(cellKey(nb.cell))) continue;
      gesehen.add(cellKey(nb.cell));
      schlange.push(nb.cell);
    }
  }
  if (gesehen.size !== t.size) {
    mangel.push(`${t.size - gesehen.size} von ${t.size} Zellen unerreichbar`);
  }
  return mangel;
}

/** Die offene Kante eines Raums, deren Kantenmitte auf `ziel` liegt. */
function kanteAn(
  layout: DungeonLayout,
  base: string,
  zelle: GridCell,
  d: Direction
): OpenConnection | undefined {
  const mitte = {
    x: zelle.i * 2 + (d === 'e' ? 1 : d === 'w' ? -1 : 0),
    y: zelle.level * 3.5,
    z: zelle.j * 2 - 1 + (d === 'n' ? 1 : d === 's' ? -1 : 0),
  };
  return computeOpenConnections(layout, base).find(
    (c) =>
      Math.abs(c.pos.x - mitte.x) < 0.05 &&
      Math.abs(c.pos.y - mitte.y) < 0.05 &&
      Math.abs(c.pos.z - mitte.z) < 0.05
  );
}

/** Ein Layout mit NUR dem Eingangsraum — der Startzustand des Editors. */
function nurEingang(): DungeonLayout {
  const layout = erzeugeLayoutFuerKit({ ...vault!, maxRooms: 1 }, 1);
  for (const i of plattenIndizes(layout, vault!)) removeRoom(layout, vault!.name, i);
  return layout;
}

function anbau(layout: DungeonLayout, zelle: GridCell, d: Direction, raum: string) {
  const kante = kanteAn(layout, vault!.name, zelle, d);
  if (!kante) return { ok: false as const, reason: `keine offene Kante ${cellKey(zelle)}#${d}` };
  const erg = attachRoom(layout, vault!.name, kante, raum);
  if (erg.ok) layout.rooms.push(erg.placed);
  return erg;
}

// ── 1. Die Kopfzeile zählt Löcher, nicht Connectors ─────────────────
console.log('1. computeOpenConnections mit { ohneEingang: true }:');
let summeMitFlagge = 0;
let summeOhneFlagge = 0;
for (const seed of SAATEN) {
  const layout = erzeugeLayoutFuerKit(vault, seed);
  summeOhneFlagge += computeOpenConnections(layout, vault.name).length;
  summeMitFlagge += computeOpenConnections(layout, vault.name, { ohneEingang: true }).length;
}
pruefe(summeOhneFlagge >= 40, 'ohne Flagge bleibt das alte Verhalten', `${summeOhneFlagge} Connectors`);
pruefe(summeMitFlagge === 0, 'mit Flagge meldet jedes frische StoneVault 0 offen', `${summeMitFlagge}`);

// ── 2. attachRoom weist offen/wand ab ───────────────────────────────
console.log('\n2. attachRoom als Filter der Kantentafel:');
{
  const l = nurEingang();
  pruefe(l.rooms.length === 1, 'Startzustand: nur der Eingang', `${l.rooms.length} Räume`);
  const sued = anbau(l, { i: 0, j: 0, level: 0 }, 's', 'StoneVaultCell');
  pruefe(sued.ok, 'Zelle nach Süden geht durch');
  const ost = anbau(l, { i: 0, j: 0, level: 0 }, 'e', 'StoneVaultCorridor');
  pruefe(ost.ok, 'Gang nach Osten geht durch');
  // Der Gang bei (1,0,0) kehrt seine eingebaute Wand nach Süden. Eine
  // Zelle bei (1,−1,0) öffnete genau dorthin — Mikes Befund.
  const konflikt = anbau(l, { i: 0, j: -1, level: 0 }, 'e', 'StoneVaultCell');
  pruefe(!konflikt.ok, 'Zelle mit Öffnung vor fremder Wand wird abgewiesen', konflikt.ok ? '' : konflikt.reason);
  // Dieselbe Kante mit einem Gang: dessen Wand steht gegen die Wand des
  // Nachbarn — Wand an Wand ist erlaubt.
  const erlaubt = anbau(l, { i: 0, j: -1, level: 0 }, 'e', 'StoneVaultCorridor');
  pruefe(erlaubt.ok, 'derselbe Platz mit Wand gegen Wand geht durch', erlaubt.ok ? '' : erlaubt.reason);
}
{
  // Und die Gegenrichtung: eine NEUE Wand vor eine bestehende Öffnung.
  const l = nurEingang();
  pruefe(anbau(l, { i: 0, j: 0, level: 0 }, 's', 'StoneVaultCell').ok, 'Zelle nach Süden');
  pruefe(anbau(l, { i: 0, j: -1, level: 0 }, 'e', 'StoneVaultCell').ok, 'Zelle nach Osten davon');
  const konflikt = anbau(l, { i: 0, j: 0, level: 0 }, 'e', 'StoneVaultCorridor');
  pruefe(
    !konflikt.ok,
    'Gang, dessen Wand vor eine bestehende Öffnung fiele, wird abgewiesen',
    konflikt.ok ? '' : konflikt.reason
  );
}

// ── 3. schliesseOffeneKanten setzt genau die Platten der Tafel ──────
console.log('\n3. schliesseOffeneKanten gegen den Generator:');
{
  let gleich = 0;
  let plattenGesamt = 0;
  let abweichung = '';
  for (const seed of SAATEN) {
    const layout = erzeugeLayoutFuerKit(vault, seed);
    const soll = plattenKanten(layout, vault);
    plattenGesamt += soll.size;
    const nackt: DungeonLayout = JSON.parse(JSON.stringify(layout));
    for (const i of plattenIndizes(nackt, vault)) removeRoom(nackt, vault.name, i);
    const erg = schliesseOffeneKanten(nackt, vault.name);
    const ist = plattenKanten(nackt, vault);
    const passt = erg.offenGeblieben === 0 && ist.size === soll.size && [...soll].every((k) => ist.has(k));
    if (passt) gleich++;
    else if (!abweichung) {
      abweichung = `Seed ${seed}: soll ${soll.size}, ist ${ist.size}, offen ${erg.offenGeblieben}`;
    }
  }
  pruefe(gleich === SAATEN.length, 'über 40 Seeds dieselbe Plattenmenge wie der Generator', abweichung || `${plattenGesamt} Platten`);
}

// ── 4. removeRoom + schliessen hält die G4-Invarianten ──────────────
console.log('\n4. nach removeRoom neu schliessen:');
{
  let geprueft = 0;
  let erstesProblem = '';
  for (const seed of SAATEN.slice(0, 12)) {
    const layout = erzeugeLayoutFuerKit(vault, seed);
    const vorher = invarianten(layout, vault);
    if (vorher.length > 0 && !erstesProblem) erstesProblem = `Seed ${seed} schon vorher: ${vorher[0]}`;
    // Ein BLATT entfernen: Ein Gang aus der Mitte hinge den halben
    // Grundriss ab, und „unerreichbar" wäre dann keine Aussage über den
    // Editor, sondern über die Wahl des Opfers.
    const t = tafel(layout, vault);
    const grad = new Map<number, number>();
    for (const c of t.values()) {
      let n = 0;
      for (const d of DIRECTIONS) {
        if (c.edges[d] !== 'open') continue;
        const nb = t.get(cellKey(neighbourCell(c.cell, d)));
        if (nb && nb.roomIndex !== c.roomIndex && nb.edges[OPPOSITE_DIRECTION[d]] === 'open') n++;
      }
      grad.set(c.roomIndex, (grad.get(c.roomIndex) ?? 0) + n);
    }
    const blatt = [...grad.entries()].filter(([i, n]) => i !== 0 && n === 1).map(([i]) => i).pop();
    if (blatt === undefined) continue;
    // Erst die Platten weg, dann das Blatt — sonst rutschen die Indizes.
    for (const i of plattenIndizes(layout, vault)) removeRoom(layout, vault.name, i);
    removeRoom(layout, vault.name, blatt);
    const erg = schliesseOffeneKanten(layout, vault.name);
    const nachher = invarianten(layout, vault);
    if (erg.offenGeblieben !== 0 && !erstesProblem) erstesProblem = `Seed ${seed}: ${erg.offenGeblieben} offen geblieben`;
    if (nachher.length > 0 && !erstesProblem) erstesProblem = `Seed ${seed}: ${nachher[0]}`;
    geprueft++;
  }
  pruefe(geprueft >= 10, 'genug Grundrisse mit einem entfernbaren Blatt', `${geprueft}`);
  pruefe(erstesProblem === '', 'alle G4-Invarianten halten nach dem Umbau', erstesProblem);
}

// ── 5. Nicht-Rasterkits bleiben, wie sie waren ──────────────────────
console.log('\n5. DG_Steingrab (kein Rasterkit):');
{
  const layout = erzeugeLayoutFuerKit(stein, 7);
  const nackt: DungeonLayout = JSON.parse(JSON.stringify(layout));
  for (const i of plattenIndizes(nackt, stein)) removeRoom(nackt, stein.name, i);
  const erg = schliesseOffeneKanten(nackt, stein.name);
  pruefe(erg.gesetzt > 0, 'das Steingrab wird weiterhin zugemauert', `${erg.gesetzt} Wände`);
  pruefe(erg.offenGeblieben === 0, 'und bleibt danach dicht');
  pruefe(
    computeOpenConnections(nackt, stein.name, { ohneEingang: true }).length === 0,
    'die Flagge lässt auch ein Nicht-Rasterkit 0 melden'
  );
}

console.log(fehler === 0 ? '\nAlles grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler > 0 ? 1 : 0);
