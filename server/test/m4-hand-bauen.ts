/**
 * M4 — ROTER Test fuer den Editor-Pfad `attachRoom` (Modul-Kit `DG_StoneVault`).
 *
 * Nach dem Muster von `server/test/m3-stonevault-seeds.ts`: headless, NUR
 * `@wov/shared`-Importe, laedt keine GLBs, laeuft unabhaengig von `assets/`.
 * Rueht `shared/src/dungeonGenerator.ts` NICHT an — Saat-Vertrag (s.
 * Projektregeln, m3-Kopfkommentar). `generateDungeonLayout` und alle seine
 * Helfer bleiben unberuehrt; einzig `attachRoom` bekommt hier — noch nicht
 * umgesetzt — einen zusaetzlichen, ADDITIVEN, optionalen Parameter
 * `connIndex?: number` (ohne ihn: heutiges Verhalten unveraendert).
 *
 * WARUM dieser Test noetig ist: Der Editor (`DungeonEditor.ts`, `anfuegen()`)
 * ruft `attachRoom` heute mit genau EINEM Raumnamen auf und bekommt den
 * ERSTEN kollisionsfreien eigenen Connector zurueck — die Auswahl, WELCHE
 * Kante des neuen Raums an die offene Kante andockt, liegt komplett beim
 * Zufall der Deklarationsreihenfolge. Fuer eine handgebaute StoneVault-Zelle
 * mit vier `cellEdge`-Kanten heisst das: der Mensch kann nicht waehlen, in
 * welche Richtung ein Gang weiterlaeuft. `connIndex` macht genau das
 * moeglich, ohne den Seed-Pfad (`generateDungeonLayout`) zu beruehren.
 *
 * Dieser Test ist ABSICHTLICH ROT, solange `attachRoom` den Parameter nicht
 * kennt (s. Pruefung 2 unten) — s. Befund am Dateiende nach dem ersten Lauf.
 * Er ist so formuliert, dass er nach der Umsetzung OHNE AENDERUNG gruen
 * wird: die Signatur-Annahme ist ein rein additiver letzter Parameter.
 *
 * Pruefungen:
 *  1. Startlayout (Seed 7): `computeOpenConnections` liefert 0 offene
 *     Connectors (s. Fund unten) — danach wird EIN `StoneVaultWall`-Abschluss
 *     per `removeRoom` entfernt, was `computeOpenConnections` > 0 macht.
 *  2. `attachRoom` MIT `connIndex` fuer beide `StoneVaultCorridor`-Enden
 *     (Index 0 = Nord, Index 1 = Sued, s. `eigeneDungeons.ts`) an DEMSELBEN
 *     offenen Connector: die resultierenden Raum-Drehungen unterscheiden
 *     sich, und die GEWAEHLTE Kante (lokale Position durch die Drehung in
 *     Weltraum gebracht) landet jeweils exakt auf der Position des offenen
 *     Connectors (Toleranz 1e-3).
 *  3. `attachRoom` OHNE `connIndex` verhaelt sich wie bisher — Ergebnis
 *     identisch zum ersten kollisionsfreien Kandidaten (hier: Index 0).
 *  4. `removeRoom` auf den angefuegten Raum: Raumzahl, ein Tuer-Zeuge auf
 *     seinem Connector und ein Props-Zeuge auf dem Nachbarraum bleiben
 *     konsistent — die Indizes hinter dem entfernten Raum ruecken nach.
 *  5. `sanitizeDungeonDocument`-Rundlauf eines Dokuments mit dem
 *     Start-Layout: JSON byte-gleich vor/nach (die Buchhaltung fuer M4
 *     aendert daran nichts, s. Kit-Regel oben — nur `attachRoom` wird
 *     erweitert).
 *
 * Run: npx tsx server/test/m4-hand-bauen.ts   (from the repo root)
 *
 * ── Fund beim ersten Lauf (3.9.2026) ────────────────────────────────────
 * Pruefung 1 wie urspruenglich gedacht — `computeOpenConnections` direkt
 * nach `generateDungeonLayout(DG_StoneVault, 7)` — liefert 0, nicht > 0.
 * Das ist KEIN Bug: `placeEndCaps` (Generator, unberuehrt) versiegelt am
 * Ende JEDE unbeschaltete Kante, INKLUSIVE des Eingangsconnectors der
 * Startzelle (dessen Aussentuer geometrisch aus der Location-Huelle kommt,
 * nicht aus `layout.rooms`) — ein vollstaendig generiertes Layout hat per
 * Konstruktion keine offenen Kanten mehr. Der Editor trifft `attachRoom`
 * deshalb nie auf ein frisches Layout, sondern immer NACH einem
 * `removeRoom` (der Mensch reisst einen Abschluss ein, um weiterzubauen) —
 * genau das bildet dieser Test jetzt nach: ein `StoneVaultWall` wird
 * entfernt, DAS oeffnet die Kante, an der Pruefung 2 ansetzt.
 *
 * ── Wie der Test ROT ist ────────────────────────────────────────────────
 * Kein Kompilierfehler: `attachRoom` wird an den beiden Stellen, die den
 * 5. Parameter brauchen, bewusst als `(attachRoom as any)(...)` aufgerufen
 * — `tsx`/esbuild entfernt beim Transpilieren ohnehin nur Typen (kein
 * Type-Checking), und `test/` ist nicht in `server/tsconfig.json`
 * eingeschlossen; ein spaeteres `tsc --noEmit` liefe also so oder so nicht
 * gegen die 4-Parameter-Signatur. Der `any`-Cast macht das ausdruecklich
 * und stellt sicher, dass ROT und GRUEN allein von der LAUFZEIT-Antwort
 * von `attachRoom` abhaengen, nicht vom Zufall einer Typpruef-Konfiguration.
 *
 * Tatsaechlich ROT (Lauf vom 3.9.2026, Seed 7): genau 2 von 15 Pruefungen,
 * beide Symptome DESSELBEN Fehlers — `attachRoom` ignoriert den 5.
 * Parameter heute vollstaendig (JS erlaubt ueberzaehlige Argumente) und
 * liefert fuer `connIndex` 0 UND 1 dasselbe Ergebnis (den ersten
 * kollisionsfreien Kandidaten, hier immer Index 0/Nord):
 *  - „connIndex 0 (Nord) und 1 (Sued) ... ergeben unterschiedliche
 *    Drehung" — FAIL, beide Drehungen sind identisch.
 *  - „connIndex 1: die GEWAEHLTE Kante (Index 1) landet auf dem offenen
 *    Connector" — FAIL, es landet die NORD-Kante dort (Sued-Kante 2 m
 *    daneben, exakt die Ganglaenge — s. Zahlen im Testlauf).
 * Alle uebrigen 13 Pruefungen (offene Connectors nach `removeRoom`,
 * connIndex-0-Fall, Rueckwaertskompatibilitaet ohne `connIndex`,
 * `removeRoom`-Konsistenz, Sanitizer-Rundlauf) sind bereits GRUEN — sie
 * haengen nicht an der neuen Faehigkeit.
 */

import {
  attachRoom,
  computeOpenConnections,
  DUNGEON_DOCUMENT_VERSION,
  DUNGEONS_BY_NAME,
  generateDungeonLayout,
  quatMulVec3,
  removeRoom,
  sanitizeDungeonDocument,
  type DungeonDocument,
  type DungeonLayout,
  type OpenConnection,
  type PlacedDoor,
  type PlacedProp,
  type PlacedRoom,
  type RoomDef,
  type Vector3,
} from '@wov/shared';

const KIT_NAME = 'DG_StoneVault';
const SEED = 7;
const TOLERANZ = 1e-3;

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const def = DUNGEONS_BY_NAME.get(KIT_NAME);
if (!def) {
  console.error(`Kit '${KIT_NAME}' nicht in DUNGEONS_BY_NAME gefunden.`);
  process.exit(1);
}

const roomsByName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
const corridorDef = roomsByName.get('StoneVaultCorridor');
if (!corridorDef) {
  console.error(`Raum 'StoneVaultCorridor' fehlt im Kit '${KIT_NAME}'.`);
  process.exit(1);
}
if (corridorDef.connections.length < 2) {
  console.error(`'StoneVaultCorridor' hat weniger als zwei Connectors — Testannahme (Nord/Sued) verletzt.`);
  process.exit(1);
}

/** Weltposition der Kante `connIndex` eines platzierten Raums — Nachbau von `localToGlobal` (pos-Anteil), ohne die Funktion zu importieren (sie ist in `dungeonGenerator.ts` nicht exportiert). */
function connectorWorldPos(placed: PlacedRoom, room: RoomDef, connIndex: number): Vector3 {
  const local = room.connections[connIndex]!.localPos;
  const rotated = quatMulVec3(placed.rot, local);
  return { x: placed.pos.x + rotated.x, y: placed.pos.y + rotated.y, z: placed.pos.z + rotated.z };
}

function approxGleich(a: Vector3, b: Vector3, tol: number): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
}

// ── 1. Startlayout ──────────────────────────────────────────────────────
const layout1 = generateDungeonLayout(def, SEED);
const openRoh = computeOpenConnections(layout1, KIT_NAME);
check(
  `seed ${SEED}: vollstaendig generiertes Layout hat KEINE offenen Connectors (s. Fund im Kopfkommentar)`,
  openRoh.length === 0,
  `${openRoh.length} offen`
);

// Editor-Realitaet nachbauen: EIN Abschluss weg, DANN ist eine Kante offen.
// `layout1` bleibt fuer Pruefung 3 (Referenzaufruf) und 5 (Sanitizer-
// Rundlauf) unangetastet — `attachRoom`/`removeRoom` arbeiten ab hier auf
// einem eigenen Klon.
//
// WELCHER Wandabschluss dabei faellt, ist fuer die Pruefung selbst egal —
// nur die anschliessende Frage zaehlt (Pruefung 2): docken BEIDE
// Corridor-Enden dort kollisionsfrei an? Nicht jede freigelegte Kante hat
// dahinter genug Platz fuer 2 m Gang (manche Wandnischen sind flacher).
// Wir probieren deshalb der Reihe nach jeden `StoneVaultWall` durch und
// nehmen den ERSTEN, an dem beide Enden passen — deterministisch, weil
// `layout1.rooms` in fester Platzierungsreihenfolge steht.
const wallIndizes = layout1.rooms
  .map((r, i) => (r.room === 'StoneVaultWall' ? i : -1))
  .filter((i) => i >= 0);
if (wallIndizes.length === 0) {
  console.error(`Kein 'StoneVaultWall' im Seed-${SEED}-Layout gefunden — Testannahme verletzt.`);
  process.exit(1);
}

const corridorConnType = corridorDef.connections[0]!.type;
let layoutOffen: DungeonLayout | undefined;
let open: OpenConnection[] = [];
let gewaehlterOffener: OpenConnection | undefined;
let ergebnisNord: ReturnType<typeof attachRoom> | undefined;
let ergebnisSued: ReturnType<typeof attachRoom> | undefined;
let entfernenErgebnis: ReturnType<typeof removeRoom> | undefined;

for (const wallIndex of wallIndizes) {
  const kandidat: DungeonLayout = JSON.parse(JSON.stringify(layout1));
  const entfernt = removeRoom(kandidat, KIT_NAME, wallIndex);
  if (!entfernt.ok) continue;
  const kandidatOffen = computeOpenConnections(kandidat, KIT_NAME);
  for (const o of kandidatOffen.filter((c) => c.type === corridorConnType)) {
    // Signatur-ANNAHME (s. Kopfkommentar): additiver 5. Parameter connIndex.
    // Vor der Umsetzung ignoriert `attachRoom` ihn schlicht (JS erlaubt
    // ueberzaehlige Argumente) — dann liefern beide Aufrufe dasselbe
    // Ergebnis und Pruefung 2 unten schlaegt als ASSERTION fehl, nicht als
    // Kompilierfehler (tsx/esbuild transpiliert typlos, s. Befund unten).
    const a = (attachRoom as any)(kandidat, KIT_NAME, o, 'StoneVaultCorridor', 0);
    const b = (attachRoom as any)(kandidat, KIT_NAME, o, 'StoneVaultCorridor', 1);
    if (a.ok && b.ok) {
      layoutOffen = kandidat;
      open = kandidatOffen;
      gewaehlterOffener = o;
      ergebnisNord = a;
      ergebnisSued = b;
      entfernenErgebnis = entfernt;
      break;
    }
  }
  if (gewaehlterOffener) break;
}

check('removeRoom auf einen Wandabschluss (oeffnet eine Kante) meldet Erfolg', !!entfernenErgebnis?.ok);
check(`nach removeRoom: offene Connectors vorhanden`, open.length > 0, `${open.length} offen`);
check('ein offener Connector erlaubt beide Corridor-Enden kollisionsfrei', !!gewaehlterOffener);

if (gewaehlterOffener && ergebnisNord?.ok && ergebnisSued?.ok) {
  check(
    'connIndex 0 (Nord) und 1 (Sued) am selben offenen Connector ergeben unterschiedliche Drehung',
    JSON.stringify(ergebnisNord.placed.rot) !== JSON.stringify(ergebnisSued.placed.rot),
    `Nord ${JSON.stringify(ergebnisNord.placed.rot)} vs Sued ${JSON.stringify(ergebnisSued.placed.rot)}`
  );

  const weltNord = connectorWorldPos(ergebnisNord.placed, corridorDef, 0);
  check(
    'connIndex 0: die GEWAEHLTE Kante (Index 0) landet auf dem offenen Connector',
    approxGleich(weltNord, gewaehlterOffener.pos, TOLERANZ),
    `Kante ${JSON.stringify(weltNord)} vs offen ${JSON.stringify(gewaehlterOffener.pos)}`
  );

  const weltSued = connectorWorldPos(ergebnisSued.placed, corridorDef, 1);
  check(
    'connIndex 1: die GEWAEHLTE Kante (Index 1) landet auf dem offenen Connector',
    approxGleich(weltSued, gewaehlterOffener.pos, TOLERANZ),
    `Kante ${JSON.stringify(weltSued)} vs offen ${JSON.stringify(gewaehlterOffener.pos)}`
  );

  // ── 3. Rueckwaertskompatibilitaet ────────────────────────────────────
  const referenz = attachRoom(layoutOffen, KIT_NAME, gewaehlterOffener, 'StoneVaultCorridor');
  check(
    'attachRoom ohne connIndex verhaelt sich wie bisher (== erster kollisionsfreier Kandidat, hier Index 0)',
    JSON.stringify(referenz) === JSON.stringify(ergebnisNord)
  );
} else {
  check('connIndex 0 (Nord) und 1 (Sued) am selben offenen Connector ergeben unterschiedliche Drehung', false, 'kein passender offener Connector gefunden');
  check('connIndex 0: die GEWAEHLTE Kante (Index 0) landet auf dem offenen Connector', false, 'uebersprungen');
  check('connIndex 1: die GEWAEHLTE Kante (Index 1) landet auf dem offenen Connector', false, 'uebersprungen');
  check('attachRoom ohne connIndex verhaelt sich wie bisher (== erster kollisionsfreier Kandidat, hier Index 0)', false, 'uebersprungen');
}

// ── 4. removeRoom: Raumzahl, Tueren und Props rutschen konsistent ──────
//
// Eigener, isolierter Klon von `layoutOffen` (nach dem Wand-Ausriss) —
// `removeRoom` mutiert das uebergebene Layout in-place (s. Docstring in
// `dungeonGenerator.ts`), und `layoutOffen` wird oben noch fuer den
// Referenzaufruf gebraucht.
if (ergebnisNord?.ok) {
  const layout4: DungeonLayout = JSON.parse(JSON.stringify(layoutOffen));
  const neuerIndex = layout4.rooms.length; // Index, unter dem der angefuegte Raum landet.
  layout4.rooms.push(ergebnisNord.placed);

  // Ein zweiter, beliebiger Platzhalter-Raum DAHINTER — einzig da, um zu
  // zeigen, dass `removeRoom` seinen Index nach dem Entfernen des
  // vorherigen Raums um eins nach VORNE zieht (splice-Semantik).
  const platzhalter: PlacedRoom = { ...ergebnisNord.placed, placeOrder: ergebnisNord.placed.placeOrder + 1 };
  layout4.rooms.push(platzhalter);

  // Tuer-Zeuge: sitzt exakt auf der Nord-Kante des angefuegten Raums —
  // muss beim Entfernen dieses Raums mit verschwinden (s. `removeRoom`,
  // Umkreis 0,3 m um die Connector-Weltposition).
  const tuerZeuge: PlacedDoor = {
    prefabName: 'zeuge-tuer',
    prefabHash: 0,
    pos: connectorWorldPos(ergebnisNord.placed, corridorDef, 0),
    rot: ergebnisNord.placed.rot,
  };
  layout4.doors.push(tuerZeuge);

  // Props-Zeugen: einer AM entfernten Raum (muss verschwinden), einer AM
  // Platzhalter DAHINTER (muss bleiben und seinen `roomIndex` um 1 nach
  // unten korrigiert bekommen).
  const propAmEntfernten: PlacedProp = {
    prefabName: 'zeuge-prop-entfernt',
    prefabHash: 0,
    pos: ergebnisNord.placed.pos,
    rot: ergebnisNord.placed.rot,
    roomIndex: neuerIndex,
  };
  const propAmPlatzhalter: PlacedProp = {
    prefabName: 'zeuge-prop-bleibt',
    prefabHash: 0,
    pos: platzhalter.pos,
    rot: platzhalter.rot,
    roomIndex: neuerIndex + 1,
  };
  layout4.props.push(propAmEntfernten, propAmPlatzhalter);

  const raumzahlVorher = layout4.rooms.length;
  const ergebnisEntfernen = removeRoom(layout4, KIT_NAME, neuerIndex);

  check('removeRoom meldet Erfolg', ergebnisEntfernen.ok, ergebnisEntfernen.reason ?? '');
  check(
    'removeRoom: Raumzahl um genau 1 gesunken',
    layout4.rooms.length === raumzahlVorher - 1,
    `${raumzahlVorher} -> ${layout4.rooms.length}`
  );
  check(
    'removeRoom: der Platzhalter ist an den frei gewordenen Index gerutscht',
    layout4.rooms[neuerIndex] === platzhalter
  );
  check(
    'removeRoom: die Tuer auf der entfernten Kante ist mit verschwunden',
    !layout4.doors.includes(tuerZeuge)
  );
  check(
    'removeRoom: das Prop am entfernten Raum ist mit verschwunden',
    !layout4.props.includes(propAmEntfernten)
  );
  // `removeRoom` gibt fuer verschobene Props ein NEUES Objekt zurueck
  // (`{...p, roomIndex: ...}`, s. Quelltext) — hier deshalb ueber den
  // Namen suchen, nicht per Referenzgleichheit.
  const geblieben = layout4.props.find((p) => p.prefabName === 'zeuge-prop-bleibt');
  check(
    'removeRoom: das Prop am Platzhalter bleibt und sein roomIndex ruckt um 1 nach',
    !!geblieben && geblieben.roomIndex === neuerIndex,
    geblieben ? `roomIndex jetzt ${geblieben.roomIndex}` : 'Prop verschwunden'
  );
} else {
  check('removeRoom meldet Erfolg', false, 'kein angefuegter Raum aus Pruefung 2 verfuegbar');
}

// ── 5. sanitizeDungeonDocument-Rundlauf ────────────────────────────────
//
// `attachRoom`/`removeRoom` aendern nichts an der Dokument-Buchhaltung
// (Kit-Regel: nur `attachRoom` bekommt den additiven Parameter) — diese
// Pruefung ist bewusst UNABHAENGIG von Pruefung 2-4 und sollte schon vor
// der M4-Umsetzung gruen sein; sie steht hier, weil die Aufgabe einen
// Rundlauf mit GENAU DIESEM Layout verlangt.
const dokument: DungeonDocument = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'm4-hand-bauen-test',
  name: 'm4-hand-bauen-test',
  base: KIT_NAME,
  mode: 'generated',
  seed: SEED,
  zoneSize: (def.generatorEinstellungen?.zoneSize ?? 64),
  layout: layout1,
};
const rundlauf = sanitizeDungeonDocument(dokument);
check(
  'sanitizeDungeonDocument: Rundlauf ist JSON-byte-gleich',
  JSON.stringify(rundlauf) === JSON.stringify(dokument)
);

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün.');
}
