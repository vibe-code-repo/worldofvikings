/**
 * F2 — Wächter für den Index der Spielerbauten im ZDOManager.
 *
 * Der Login zählt die eigenen Bauten über `ZDOManager.spielerbauten()` statt
 * über einen Vollscan aller ZDOs. Das stimmt nur, solange der Index jeden Weg
 * mitbekommt, der `spieler` = 1 setzt. Dieser Test mischt die Vorgänge, die es
 * gibt, und hält den Index nach jedem Schritt gegen den alten Vollscan
 * (`getAllZDOs().filter(spieler === 1 && besitzer === id)`):
 *   Bauen (Merkmal nach dem Erzeugen), Erzeugen mit fester Kennung und Merkmal
 *   danach (Laden/Layout), Abreißen, Besitzerwechsel, Merkmal weg und wieder da,
 *   Übernahme der Member (Weltwechsel), Laden aus Snapshots (in einen frischen
 *   und in einen laufenden Manager), Welt zurücksetzen (neuer Manager).
 * Dazu ein Zufallslauf. Ein Weg, der den Index umgeht, macht ihn rot.
 *
 * Lauf: node_modules/.bin/tsx server/test/f2-spielerbau-index.ts   (aus dem Repo-Stamm oder server/)
 */
import { getStableHash } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZDO } from '../src/zdo/ZDO.js';
import { ZDOID } from '../src/zdo/ZDOID.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const OWNERS = ['4711', '4712', '4713'];
const prefab = getStableHash('GrabMenhir');

/** Der alte Weg: Vollscan über alle ZDOs. */
function alt(m: ZDOManager, id: string): number {
  return m.getAllZDOs().filter((z) => z.getInt('spieler') === 1 && z.getString('besitzer') === id).length;
}
/** Der neue Weg: über den Index, mit demselben Prädikat wie WovServer.zaehleEigeneBauten. */
function neu(m: ZDOManager, id: string): number {
  let n = 0;
  for (const z of m.spielerbauten()) if (z.getInt('spieler') === 1 && z.getString('besitzer') === id) n++;
  return n;
}
function gleich(label: string, m: ZDOManager): void {
  const a = OWNERS.map((o) => alt(m, o));
  const n = OWNERS.map((o) => neu(m, o));
  check(label, a.every((v, i) => v === n[i]), `alt ${a.join('/')} neu ${n.join('/')}`);
}

function baue(m: ZDOManager, besitzer: string, x = 0): ZDO {
  const z = m.createZDO(prefab, { x, y: 0, z: 0 });
  z.setInt('spieler', 1);
  z.setString('besitzer', besitzer);
  return z;
}

function main(): void {
  const m = new ZDOManager(1n);

  // Index bauen lassen, dann gemischte Vorgänge.
  for (let i = 0; i < 6; i++) baue(m, OWNERS[i % 3]!, i);
  gleich('Bauen (vor dem ersten Indexaufbau)', m);
  m.spielerbauten();
  const neuGebaut = baue(m, OWNERS[0]!, 100);
  gleich('Bauen nach dem Indexaufbau', m);

  m.destroyZDO(neuGebaut.zdoid);
  gleich('Abreißen', m);
  // Ein abgerissenes ZDO darf durch spätere Schreibzugriffe nicht zurück in den Index.
  neuGebaut.setInt('spieler', 1);
  neuGebaut.setString('besitzer', OWNERS[0]!);
  gleich('Schreiben auf ein abgerissenes ZDO', m);

  const b = baue(m, OWNERS[1]!, 101);
  b.setString('besitzer', OWNERS[2]!);
  gleich('Besitzerwechsel', m);

  b.setInt('spieler', 0);
  gleich('Merkmal weg', m);
  b.setInt('spieler', 1);
  gleich('Merkmal wieder da', m);

  // Erzeugen mit fester Kennung (Laden/Layout): Member kommen erst danach.
  const fest = m.createZDOWithID(new ZDOID(1n, 9000), prefab, { x: 5, y: 0, z: 5 }, { x: 0, y: 0, z: 0, w: 1 });
  fest.setInt('spieler', 1);
  fest.setString('besitzer', OWNERS[0]!);
  gleich('createZDOWithID mit Member danach', m);

  // Übernahme der Member (Weltwechsel): die Quelle trägt spieler = 1.
  const quelle = new ZDO(new ZDOID(9n, 1), prefab, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  quelle.setInt('spieler', 1);
  quelle.setString('besitzer', OWNERS[1]!);
  const ziel = m.createZDO(prefab, { x: 7, y: 0, z: 7 });
  ziel.uebernehmeMitglieder(quelle.toSnapshot());
  gleich('uebernehmeMitglieder', m);

  // Laden in einen frischen Manager (Neustart / Welt zurücksetzen).
  const snaps = m.getAllZDOs().map((z) => z.toSnapshot());
  const frisch = new ZDOManager(1n);
  frisch.restoreFromSnapshots(snaps);
  gleich('Laden in einen frischen Manager', frisch);
  check('geladener Bestand hat Bauten', OWNERS.some((o) => neu(frisch, o) > 0));

  // Laden in einen laufenden Manager, dessen Index schon steht.
  const laufend = new ZDOManager(1n);
  baue(laufend, OWNERS[0]!, 1);
  laufend.spielerbauten();
  laufend.restoreFromSnapshots(snaps.slice(0, 5));
  gleich('Laden in einen laufenden Manager mit Index', laufend);
  baue(laufend, OWNERS[2]!, 2);
  gleich('Bauen nach dem Laden', laufend);

  // Zufallslauf: gemischte Vorgänge, nach jedem Schritt gleich.
  let z0 = 987654321;
  const rnd = (n: number): number => {
    z0 = (Math.imul(z0, 1664525) + 1013904223) >>> 0;
    return z0 % n;
  };
  const zufall = new ZDOManager(1n);
  const lebend: ZDO[] = [];
  let ok = true;
  let schritte = 0;
  for (let s = 0; s < 3000 && ok; s++) {
    schritte++;
    switch (rnd(7)) {
      case 0: lebend.push(baue(zufall, OWNERS[rnd(3)]!, s)); break;
      case 1: { const z = zufall.createZDO(prefab, { x: s, y: 0, z: 1 }); z.setString('besitzer', OWNERS[rnd(3)]!); lebend.push(z); break; }
      case 2: if (lebend.length) { const i = rnd(lebend.length); zufall.destroyZDO(lebend[i]!.zdoid); lebend.splice(i, 1); } break;
      case 3: if (lebend.length) lebend[rnd(lebend.length)]!.setString('besitzer', OWNERS[rnd(3)]!); break;
      case 4: if (lebend.length) lebend[rnd(lebend.length)]!.setInt('spieler', rnd(2)); break;
      case 5: if (rnd(20) === 0) zufall.spielerbauten(); break;
      case 6: if (lebend.length) { const z = lebend[rnd(lebend.length)]!; z.uebernehmeMitglieder(quelle.toSnapshot()); } break;
    }
    if (s % 25 === 0) {
      ok = OWNERS.every((o) => alt(zufall, o) === neu(zufall, o));
    }
  }
  check(`Zufallslauf (${schritte} Schritte) bleibt gleich dem Vollscan`, ok && OWNERS.every((o) => alt(zufall, o) === neu(zufall, o)));

  console.log(failures === 0 ? '\n=== F2 Spielerbau-Index: ALLES BESTANDEN ===' : `\n=== F2 Spielerbau-Index: ${failures} FEHLGESCHLAGEN ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
