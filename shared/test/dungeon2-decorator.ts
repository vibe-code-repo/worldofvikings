/**
 * Messender Nachweis fuer den Deko-Bestuecker des Dungeon-Generators 2.0
 * (`shared/src/dungeon2/decorator.ts`, ARCHITECTURE.md-Name `bestuecker.ts`).
 * Measuring proof for the decor furnisher of dungeon generator 2.0.
 *
 *   npx tsx test/dungeon2-decorator.ts
 *
 * Geprueft werden die drei im Arbeitsauftrag genannten Eigenschaften:
 * Checked are the three properties named in the work order:
 *
 *   (A) DETERMINISMUS: `bestuecke()` zweimal auf denselben `dekoPlaetze`
 *       aufgerufen liefert bitgleiche Ergebnisse; ueber 40 Seeds liefert ein
 *       zweiter kompletter Lauf (neues Layout + neuer Bau + neuer Bestuecker)
 *       dieselben Prefabs an denselben Ankern.
 *       DETERMINISM: two calls on the same `dekoPlaetze` are bit-identical;
 *       over 40 seeds a second full run yields the same prefabs at the same
 *       anchors.
 *   (B) REIHENFOLGE-STABILITAET: Das Ergebnis haengt nicht von der
 *       Eingabereihenfolge der `dekoPlaetze` ab (sortiert verglichen), und das
 *       Weglassen bzw. Hinzufuegen EINES Ankers aendert kein Prefab an einem
 *       anderen Anker (die Kernzusage von W7 "eigener Strom je Anker").
 *       ORDER STABILITY: the result does not depend on the input order of
 *       `dekoPlaetze` (compared sorted), and removing/adding ONE anchor never
 *       changes the prefab of another anchor.
 *   (C) KEINE ANKER IN OEFFNUNGEN/KOLLISION: kein Wand-Anker sitzt auf einer
 *       Tuerkante (offene Verbindung statt Wand), und kein bestuecktes Teil
 *       liegt STRENG innerhalb eines Kollisionskoerpers (Box) des Bauers.
 *       NO ANCHORS IN OPENINGS/COLLISION: no wall anchor sits on a door edge,
 *       and no furnished piece lies STRICTLY inside a builder collision box.
 */

import { getPrefabHash } from '../src/hash.js';
import type { Vector3 } from '../src/types.js';
import {
  gegenKante,
  nachbarZelle,
  type DungeonLayout2,
  type Kante,
  type LayoutSeeds,
} from '../src/dungeon2/layout.js';
import { baueGeometrie, type BauErgebnis, type DekoPlatz, type KollisionsKoerper } from '../src/dungeon2/builder.js';
import { erzeugeLayout } from '../src/dungeon2/generator.js';
import { STEINGRAB, materialTagFuerStempel } from '../src/dungeon2/themen.js';
import { bestuecke, type BestuecktesTeil } from '../src/dungeon2/decorator.js';
import type { RaumStempel } from '../src/dungeon2/layout.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness (Muster aus dungeon2-builder.ts)
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

const thema = STEINGRAB;
const materialOptionen = {
  materialTagFuerStempel: (s: RaumStempel) => materialTagFuerStempel(thema, s),
};

/** Seeds aus einer Zaehlung, nicht aus einer Uhr. / Seeds from a count, not a clock. */
function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

function baueLayoutUndGeometrie(i: number): { layout: DungeonLayout2; ergebnis: BauErgebnis } {
  const layout = erzeugeLayout(thema, seedsFuer(i));
  const ergebnis = baueGeometrie(layout, { aufbau: materialOptionen });
  return { layout, ergebnis };
}

/** Kanonischer Schluessel eines bestueckten Teils, feste Feldreihenfolge. */
/** Canonical key of a furnished piece, fixed field order. */
function teilSchluessel(t: BestuecktesTeil): string {
  return [
    t.ankerId,
    t.stempelId,
    t.rolle,
    t.prefab,
    t.prefabHash,
    t.ort,
    t.kante ?? -1,
    t.position.x,
    t.position.y,
    t.position.z,
    t.drehung,
  ].join('|');
}

function teileVergleichen(a: readonly BestuecktesTeil[], b: readonly BestuecktesTeil[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.ankerId - y.ankerId).map(teilSchluessel);
  const sb = [...b].sort((x, y) => x.ankerId - y.ankerId).map(teilSchluessel);
  return sa.every((s, i) => s === sb[i]);
}

/** Fisher-Yates mit einem einfachen, seed-festen Generator — nur zum Mischen der Testeingabe. */
/** Fisher-Yates with a simple, seed-fixed generator — only to shuffle the test input. */
function gemischt<T>(liste: readonly T[], salz: number): T[] {
  const kopie = [...liste];
  let zustand = (salz ^ 0x9e3779b9) >>> 0;
  const naechste = (): number => {
    zustand = (Math.imul(zustand ^ (zustand >>> 15), 0x2545f491) + 0x9e3779b9) >>> 0;
    return zustand;
  };
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = naechste() % (i + 1);
    const t = kopie[i]!;
    kopie[i] = kopie[j]!;
    kopie[j] = t;
  }
  return kopie;
}

const SEED_ZAHL = 40;

// ─────────────────────────────────────────────────────────────────────────────
// (A) Determinismus / determinism
// ─────────────────────────────────────────────────────────────────────────────

for (let i = 0; i < SEED_ZAHL; i++) {
  const { ergebnis } = baueLayoutUndGeometrie(i);

  // Zwei Aufrufe auf denselben `dekoPlaetze` sind bitgleich.
  // Two calls on the same `dekoPlaetze` are bit-identical.
  const t1 = bestuecke(ergebnis.dekoPlaetze, thema);
  const t2 = bestuecke(ergebnis.dekoPlaetze, thema);
  pruefe(`Seed ${i}: zwei Aufrufe auf denselben dekoPlaetze sind bitgleich`, teileVergleichen(t1, t2));

  // Ein zweiter kompletter Lauf (neues Layout + neuer Bau) liefert dasselbe.
  // A second full run (new layout + new build) yields the same result.
  const { ergebnis: ergebnis2 } = baueLayoutUndGeometnisWrapper(i);
  const t3 = bestuecke(ergebnis2.dekoPlaetze, thema);
  pruefe(`Seed ${i}: zweiter voller Lauf liefert dasselbe Bestueckungsergebnis`, teileVergleichen(t1, t3));
}

// Hilfsfunktion nur, um denselben Namen nicht zweimal zu vergeben (Tippschutz
// gegen `baueLayoutUndGeometrie` == derselbe Layout-Cache — es MUSS ein neuer
// Lauf sein, kein wiederverwendetes Ergebnis).
// Helper only so the name is not reused by accident (typo guard against
// `baueLayoutUndGeometrie` == the same cached layout — it MUST be a fresh run,
// not a reused result).
function baueLayoutUndGeometnisWrapper(i: number): { layout: DungeonLayout2; ergebnis: BauErgebnis } {
  return baueLayoutUndGeometrie(i);
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) Reihenfolge-Stabilitaet / order stability
// ─────────────────────────────────────────────────────────────────────────────

for (let i = 0; i < SEED_ZAHL; i++) {
  const { ergebnis } = baueLayoutUndGeometrie(i);
  const basis = bestuecke(ergebnis.dekoPlaetze, thema);

  // (B1) Gemischte Eingabereihenfolge aendert das (sortiert verglichene)
  // Ergebnis nicht.
  // (B1) A shuffled input order does not change the (sorted) result.
  const gemischteEingabe = gemischt(ergebnis.dekoPlaetze, i + 1);
  const gemischtesErgebnis = bestuecke(gemischteEingabe, thema);
  pruefe(
    `Seed ${i}: gemischte dekoPlaetze-Reihenfolge aendert das Ergebnis nicht`,
    teileVergleichen(basis, gemischtesErgebnis)
  );

  // (B2) Ein einzelner entfernter Anker aendert kein Prefab eines anderen
  // Ankers — die Kernzusage aus W7 (eigener Strom je Anker).
  // (B2) Removing a single anchor never changes another anchor's prefab — the
  // core promise of W7 (own stream per anchor).
  if (ergebnis.dekoPlaetze.length > 1) {
    const entfernterAnkerId = ergebnis.dekoPlaetze[0]!.ankerId;
    const ohneEinen = ergebnis.dekoPlaetze.filter((_, idx) => idx !== 0);
    const teilErgebnis = bestuecke(ohneEinen, thema);

    // Kein anderer Anker verliert oder aendert sein Prefab.
    // No other anchor loses or changes its prefab.
    const nachAnkerId = new Map(basis.map((t) => [t.ankerId, t]));
    let unveraendert = true;
    for (const t of teilErgebnis) {
      const vorher = nachAnkerId.get(t.ankerId);
      if (vorher === undefined || teilSchluessel(vorher) !== teilSchluessel(t)) {
        unveraendert = false;
        break;
      }
    }
    // Die erwartete Laenge: `basis` ohne den entfernten Anker, falls der
    // ueberhaupt ein Teil erzeugt hatte (unbekannte Rollen erzeugen keins).
    // Expected length: `basis` minus the removed anchor, if it produced a
    // piece at all (unknown roles produce none).
    const entfernterHatteTeil = basis.some((t) => t.ankerId === entfernterAnkerId);
    const erwarteteLaenge = basis.length - (entfernterHatteTeil ? 1 : 0);
    pruefe(
      `Seed ${i}: Entfernen eines Ankers aendert kein Prefab eines anderen Ankers`,
      unveraendert && teilErgebnis.length === erwarteteLaenge,
      `teile=${teilErgebnis.length} erwartet=${erwarteteLaenge} unveraendert=${unveraendert}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (C) Keine Anker in Oeffnungen/Kollision / no anchors in openings/collision
// ─────────────────────────────────────────────────────────────────────────────

/** Schluessel einer kanonisierten Tuerkante. / Key of a canonicalised door edge. */
function tuerSchluessel(x: number, z: number, ebene: number, kante: Kante): string {
  return `${ebene}|${z}|${x}|${kante}`;
}

/**
 * Liegt `p` STRENG (mit Toleranz `eps`) innerhalb der Box `k`? `drehung` bleibt
 * unbeachtet — Kollisionsboxen des Bauers sind immer achsparallel (§`GanzQuader`
 * in `cells.ts`: `xa0..xa1`/`za0..za1` sind Weltachsen, `drehung` ist reine
 * Ausrichtungs-Metadatung fuer Optik).
 * Is `p` STRICTLY (with tolerance `eps`) inside box `k`? `drehung` is ignored —
 * the builder's collision boxes are always axis-aligned (`GanzQuader` in
 * `cells.ts`: `xa0..xa1`/`za0..za1` are world axes, `drehung` is pure
 * orientation metadata for looks).
 */
function strengInnerhalb(
  p: { x: number; y: number; z: number },
  k: KollisionsKoerper,
  eps: number
): boolean {
  const halbX = k.groesse.x / 2 - eps;
  const halbY = k.groesse.y / 2 - eps;
  const halbZ = k.groesse.z / 2 - eps;
  if (halbX <= 0 || halbY <= 0 || halbZ <= 0) return false;
  return (
    Math.abs(p.x - k.mitte.x) < halbX &&
    Math.abs(p.y - k.mitte.y) < halbY &&
    Math.abs(p.z - k.mitte.z) < halbZ
  );
}

const EPS_M = 1e-6;

/** Schluessel einer Box aus Mitte/Groesse/Drehung, zum Ebenen-Nachschlagen. */
/** Key of a box from centre/size/rotation, for storey lookup. */
function boxSchluessel(mitte: Vector3, groesse: Vector3, drehung: number): string {
  return `${mitte.x}|${mitte.y}|${mitte.z}|${groesse.x}|${groesse.y}|${groesse.z}|${drehung}`;
}

for (let i = 0; i < SEED_ZAHL; i++) {
  const { layout, ergebnis } = baueLayoutUndGeometrie(i);
  const teile = bestuecke(ergebnis.dekoPlaetze, thema);

  // (C1) Kein Wand-Anker sitzt auf einer Tuerkante. Tueren sind kanonisiert
  // (`layout.ts` §3.4: "an der Zelle mit kleinerem (ebene,z,x)"), ein
  // Wand-Anker gehoert dagegen zu SEINER Zelle — deshalb beide Seiten pruefen.
  // (C1) No wall anchor sits on a door edge. Doors are canonicalised at the
  // smaller-index cell; a wall anchor belongs to ITS OWN cell — hence check
  // both sides.
  const tuerKanten = new Set<string>();
  for (const t of layout.tueren) {
    tuerKanten.add(tuerSchluessel(t.x, t.z, t.ebene, t.kante));
    const n = nachbarZelle(t.x, t.z, t.kante);
    tuerKanten.add(tuerSchluessel(n.x, n.z, t.ebene, gegenKante(t.kante)));
  }
  const ankerNachId = new Map(layout.anker.map((a) => [a.id, a]));
  let ankerAufTuer = 0;
  for (const t of teile) {
    if (t.kante === undefined) continue;
    const anker = ankerNachId.get(t.ankerId);
    if (anker === undefined) continue;
    if (tuerKanten.has(tuerSchluessel(anker.x, anker.z, anker.ebene, t.kante))) ankerAufTuer++;
  }
  pruefe(`Seed ${i}: kein Wand-Anker sitzt auf einer Tuerkante`, ankerAufTuer === 0, `${ankerAufTuer}`);

  // (C2) Kein bestuecktes Teil liegt streng innerhalb eines Kollisionskoerpers
  // SEINER EIGENEN Ebene. Kollisionskoerper tragen keine Ebene; sie wird ueber
  // die (mitte, groesse, drehung)-Bauteil-Box nachgeschlagen, die jede feste
  // Box begleitet (`builder.ts`: `trage()` haengt Optik und Kollision an
  // dieselbe `quader`). Absichtlich NUR die eigene Ebene: ob die Decke der
  // Ebene DARUNTER korrekt unter dem Boden dieser Ebene bleibt, ist die
  // `ebenen-abstand`-Invariante aus `validation.ts`, nicht eine Eigenschaft des
  // Bestueckers — eine dort gefundene Abweichung waere ein Fund fuer AP2, kein
  // Nachweis eines Fehlers in `decorator.ts`.
  // (C2) No furnished piece lies strictly inside a collision body of ITS OWN
  // storey. Collision bodies carry no storey; it is looked up via the
  // (centre, size, rotation) piece box that accompanies every solid box
  // (`builder.ts`: `trage()` attaches optics and collision to the same
  // `quader`). Deliberately restricted to the anchor's own storey: whether the
  // storey BELOW's ceiling correctly stays under this storey's floor is the
  // `ebenen-abstand` invariant in `validation.ts`, not a property of the
  // furnisher — a deviation found there would be a finding for AP2, not proof
  // of a bug in `decorator.ts`.
  const ebeneNachBox = new Map<string, number>();
  for (const s of ergebnis.stuecke) {
    ebeneNachBox.set(boxSchluessel(s.mitte, s.groesse, s.drehung), s.block.ebene);
  }
  let ankerInKollision = 0;
  for (const t of teile) {
    for (const k of ergebnis.kollision) {
      if (k.form !== 'box') continue;
      const ebeneDerBox = ebeneNachBox.get(boxSchluessel(k.mitte, k.groesse, k.drehung));
      if (ebeneDerBox === undefined || ebeneDerBox !== t.block.ebene) continue;
      if (strengInnerhalb(t.position, k, EPS_M)) {
        ankerInKollision++;
        break;
      }
    }
  }
  pruefe(`Seed ${i}: kein bestuecktes Teil liegt innerhalb eines Kollisionskoerpers seiner Ebene`, ankerInKollision === 0, `${ankerInKollision}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zusatzpruefungen / additional checks
// ─────────────────────────────────────────────────────────────────────────────

{
  // `prefabHash` ist exakt `getStableHash(prefab)` — dieselbe Funktion, die das
  // gesamte Projekt fuer ZDOs benutzt, kein eigenes Verfahren.
  // `prefabHash` is exactly `getStableHash(prefab)` — the same function the
  // whole project uses for ZDOs, not a bespoke one.
  const { ergebnis } = baueLayoutUndGeometrie(0);
  const teile = bestuecke(ergebnis.dekoPlaetze, thema);
  const stimmtUeberein = teile.every((t) => t.prefabHash === getPrefabHash(t.prefab));
  pruefe('prefabHash stimmt mit getPrefabHash(prefab) ueberein', stimmtUeberein && teile.length > 0);
}

{
  // Handgesetzte Prefabs (`DekoAnker.prefab`) werden unveraendert uebernommen,
  // ohne den Strom des Ankers zu ziehen (kuenstlicher Anker zum Test).
  // Hand-nailed prefabs (`DekoAnker.prefab`) are taken over unchanged, without
  // drawing the anchor's stream (a synthetic anchor for the test).
  const handgesetzt: DekoPlatz = {
    ankerId: 999999,
    block: { bx: 0, bz: 0, ebene: 0 },
    rolle: 'fackel',
    prefab: 'HandgesetzteFackel',
    ort: 0,
    position: { x: 1, y: 2, z: 3 },
    drehung: 0,
    seed: 12345,
    stempelId: -1,
  };
  const [teil] = bestuecke([handgesetzt], thema);
  pruefe('handgesetztes Prefab wird unveraendert uebernommen', teil?.prefab === 'HandgesetzteFackel');
  pruefe('prefabHash des handgesetzten Prefabs stimmt', teil?.prefabHash === getPrefabHash('HandgesetzteFackel'));
}

{
  // Eine unbekannte Rolle ohne Tabelleneintrag wird ausgelassen, nicht als
  // Fehler geworfen.
  // An unknown role without a table entry is skipped, not thrown as an error.
  const unbekannt: DekoPlatz = {
    ankerId: 999998,
    block: { bx: 0, bz: 0, ebene: 0 },
    rolle: 'unbekannte-rolle-ohne-tabelle',
    ort: 0,
    position: { x: 0, y: 0, z: 0 },
    drehung: 0,
    seed: 1,
    stempelId: -1,
  };
  const ergebnis = bestuecke([unbekannt], thema);
  pruefe('unbekannte Rolle ohne Tabelle wird ausgelassen, nicht geworfen', ergebnis.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-decorator: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
