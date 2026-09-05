/**
 * E3 + E4 — Wächter über `shared/src/moduleRegistry.ts`.
 *
 * Abschnitte 1–5 gehören zu E3 (`roomDefForHall` — die RoomDef eines Saals
 * ABLEITEN), Abschnitte 6–9 zu E4 (`registerModule` — sie EINTRAGEN, und
 * zwar nur auf Zuruf). Beides in einer Datei, weil es dieselbe Behauptung
 * von zwei Seiten ist: Ein zur Laufzeit erzeugter Saal muss von einem
 * getippten nicht zu unterscheiden sein — weder in seinen Zahlen (E3) noch
 * darin, wo das System ihn findet (E4).
 *
 * ── Was hier eigentlich geprüft wird ─────────────────────────────────
 * E1 hat die GEOMETRIE eines Saals geschlossen (Quader, Pfeiler, Masse),
 * E2 schreibt sie als GLB. Beides ist für den Generator unsichtbar: Er
 * sieht von einem Modul nur die `RoomDef` — Hülle, Connectors, Kanten.
 * Wer einen Saal zur Laufzeit anlegt und dabei die RoomDef nur „ungefähr“
 * trifft, bekommt keinen Fehler, sondern einen Grundriss, in dem der
 * Nachbar um einen Meter versetzt steht. `gridModuleFromRoomDef` ist die
 * einzige Stelle, die das MERKT — sie verlangt für jede waagerechte
 * Aussenkante eine Aussage (`shared/src/dungeonRasterModul.ts`) und wirft
 * bei jeder Lücke.
 *
 * ── Warum der Kern ein Vergleich mit dem KIT ist, keine Nachrechnung ─
 * Ein Test, der die Connectorstellen selbst noch einmal aus cx/cz
 * ausrechnete, schriebe die Behauptung des Moduls ein zweites Mal auf und
 * bewiese nichts. Die fünf ausgelieferten Säle sind dagegen von Hand
 * getippt, gegen Blender gemessen und im Spiel gelaufen: Sie sind die
 * unabhängige Wahrheit. `roomDefForHall(name, cx, cz, weight)` muss sie
 * FELD FÜR FELD reproduzieren — Hülle, Zahl und Reihenfolge der
 * Connectors, jede Lage, jede Drehung, jedes Flag. Weicht die Funktion
 * an einer Stelle ab, ist es genau die Stelle, an der ein generierter
 * Saal sich anders verhielte als ein gebauter.
 *
 * ── Warum die Rot-Zuerst-Probe 4×3 ist und nicht 4×4 ─────────────────
 * 4×3 ist RECHTECKIG und trifft damit beide Fälle, in denen sich ein
 * Vorzeichenfehler verstecken kann: gerade Zellzahl (Pivot zwischen den
 * Zellen) auf der einen Achse, ungerade (Pivot in einer Zellmitte) auf
 * der anderen. Ein quadratischer Saal wäre punktsymmetrisch — eine
 * vertauschte x/z-Achse fiele dort nicht auf.
 *
 * Läuft rein rechnerisch: kein `assets/`, kein Blender, keine GPU.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  DUNGEONS_BY_NAME,
  EIGENE_MODELLE,
  EIGENE_MODELLE_SET,
  KIT_BY_PREFAB_HASH,
  KIT_BY_ROOM_HASH,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  PREFABS_BY_HASH,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  ROOMS_BY_HASH,
  erzeugeLayoutFuerKit,
  findPrefabByHash,
  findPrefabByName,
  getKitByPrefabHash,
  getKitByRoomHash,
  getRoomByHash,
  getStableHash,
  gridModuleFromRoomDef,
  isHorizontal,
  istEigenesModell,
  roomPrefabDef,
  DIRECTIONS,
  type Direction,
  type RoomDef,
} from '../src/index.js';
import { GRID_M, HEIGHT_M } from '../src/hallenGeometrie.js';
import { registerModule, roomDefForHall } from '../src/moduleRegistry.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('E3/E4 — Saal-RoomDef aus dem Editor (shared/src/moduleRegistry.ts)\n');

// ---------------------------------------------------------------------------
// 1. Das Raster der Geometrie IST das Raster des Moduls
//
// `roomDefForHall` rechnet die Hülle aus dem Kachelmass des GLB-Bauteils
// (`GRID_M`, `HEIGHT_M`), der Generator misst sie am Modulraster
// (`MODULE_CELL_M`, `MODULE_LEVEL_M`). Solange beide Zahlen gleich sind,
// ist das eine Vereinfachung; gingen sie auseinander, wäre es eine still
// falsche Hülle. Deshalb steht die Gleichheit hier als eigener Zeuge.
// ---------------------------------------------------------------------------
{
  check(GRID_M === MODULE_CELL_M, `GRID_M ${GRID_M} ≠ MODULE_CELL_M ${MODULE_CELL_M}`);
  check(HEIGHT_M === MODULE_LEVEL_M, `HEIGHT_M ${HEIGHT_M} ≠ MODULE_LEVEL_M ${MODULE_LEVEL_M}`);
  console.log(`  Raster  Zelle ${GRID_M} m, Ebene ${HEIGHT_M} m — Geometrie und Modulformat gleich`);
}

// ---------------------------------------------------------------------------
// 2. Die Rot-Zuerst-Probe: 4×3 läuft durch `gridModuleFromRoomDef`
//
// Ohne `roomDefForHall` gibt es nichts, was hier hineingereicht werden
// könnte; mit einer unvollständigen RoomDef wirft die Funktion. Beides ist
// rot, und zwar mit verschiedenen Meldungen.
// ---------------------------------------------------------------------------
{
  const def = roomDefForHall('Gen_StoneVaultHall4x3', 4, 3, 0.5);
  check(def.size.x === 8, `4×3: size.x ${def.size.x} statt 8`);
  check(def.size.y === 3.5, `4×3: size.y ${def.size.y} statt 3.5`);
  check(def.size.z === 6, `4×3: size.z ${def.size.z} statt 6`);
  check(def.weight === 0.5, `4×3: weight ${def.weight} statt 0.5`);
  check(def.nurManuell === true, '4×3: nurManuell fehlt — der Saal wäre Generator-Material');
  check(def.gridEdges === undefined, '4×3: gridEdges gesetzt — ein Saal braucht keins');

  const m = gridModuleFromRoomDef(def);
  check(m.cellsX === 4, `4×3: cellsX ${m.cellsX} statt 4`);
  check(m.cellsZ === 3, `4×3: cellsZ ${m.cellsZ} statt 3`);
  check(m.levels === 1, `4×3: levels ${m.levels} statt 1`);
  check(m.cells.length === 12, `4×3: ${m.cells.length} Zellen statt 12`);
  check(!m.endCap, '4×3: als Verschluss gelesen');
  check(m.anchor === null, '4×3: trägt einen Ankerport — ein Saal ist kein Eingangsraum');

  // Alle 14 Randkanten offen — 2·(4+3). Gezählt statt behauptet: Die Zahl
  // ist die Abnahme des Meilensteins.
  let rand = 0;
  let offen = 0;
  for (const cell of m.cells) {
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d) || cell.interior[d]) continue;
      rand++;
      if (cell.edges[d] === 'open') offen++;
      else check(false, `4×3: Randkante ${d} an (${cell.ix},${cell.iz}) ist '${cell.edges[d]}'`);
    }
  }
  check(rand === 14, `4×3: ${rand} Randkanten statt 14`);
  check(offen === 14, `4×3: ${offen} offene Randkanten statt 14`);
  check(m.ports.length === 14, `4×3: ${m.ports.length} Ports statt 14`);

  // Innenkanten: waagerecht Durchgang (EIN Raum), senkrecht Wand (eine Ebene).
  let innen = 0;
  for (const cell of m.cells) {
    for (const d of DIRECTIONS) {
      if (!cell.interior[d]) continue;
      innen++;
      check(
        cell.edges[d] === 'open',
        `4×3: Innenkante ${d} an (${cell.ix},${cell.iz}) ist '${cell.edges[d]}'`
      );
    }
    check(cell.edges.up === 'wall', `4×3: Deckenkante an (${cell.ix},${cell.iz}) offen`);
    check(cell.edges.down === 'wall', `4×3: Bodenkante an (${cell.ix},${cell.iz}) offen`);
  }
  // 2·(waagerechte Nachbarpaare) = 2·(3·3 + 4·2) = 34.
  check(innen === 34, `4×3: ${innen} waagerechte Innenkantenseiten statt 34`);

  // Jeder Port sitzt auf der Kantenmitte, die sein Connector nennt — der
  // Zeuge gegen eine um eine halbe Zelle versetzte Connectorreihe.
  for (const p of m.ports) {
    const c = def.connections[p.connector]!;
    const gleich =
      Math.abs(p.localEdgeCenter.x - c.localPos.x) < 1e-9 &&
      Math.abs(p.localEdgeCenter.y - c.localPos.y) < 1e-9 &&
      Math.abs(p.localEdgeCenter.z - c.localPos.z) < 1e-9;
    check(
      gleich,
      `4×3: Port ${p.connector} liegt auf (${p.localEdgeCenter.x},${p.localEdgeCenter.z}), ` +
        `sein Connector auf (${c.localPos.x},${c.localPos.z})`
    );
  }

  console.log(
    `  4×3     ${def.size.x}×${def.size.z} m, ${def.connections.length} Connectors, ` +
      `${m.cells.length} Zellen, ${offen}/${rand} Randkanten offen, levels ${m.levels}`
  );
}

// ---------------------------------------------------------------------------
// 3. Der Muster-Zeuge: die fünf ausgelieferten Säle Feld für Feld
//
// Verglichen wird gegen die RoomDefs, die im Kit stehen — inklusive
// `hash`, denn der Hash ist die Netz- und Persistenz-Kennung: Ein Saal,
// dessen Hash anders gerechnet würde, verlöre beim Laden seinen Raum.
// `nurManuell` ist der EINE erlaubte Unterschied (Bestandsräume tragen es
// nicht, Registry-Module tragen es immer) und wird deshalb ausgeklammert
// und getrennt geprüft.
// ---------------------------------------------------------------------------
const kit = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!kit) {
  console.error('FEHLER: Kit DG_StoneVault nicht gefunden.');
  process.exit(1);
}
const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));

/** Die fünf gebauten Säle mit ihren gemessenen Zellzahlen und Gewichten. */
const HALLEN: readonly (readonly [string, number, number, number])[] = [
  ['StoneVaultHall', 2, 2, 1],
  ['StoneVaultHallLarge', 3, 3, 1],
  ['StoneVaultHallLong', 2, 4, 1],
  ['StoneVaultHallGrand', 4, 4, 0.5],
  ['StoneVaultHallVast', 6, 6, 0.25],
];

/** Ohne `nurManuell` — der einzige Unterschied, der erlaubt ist. */
function ohneFlag(def: RoomDef): Record<string, unknown> {
  const { nurManuell: _weg, ...rest } = def as RoomDef & { nurManuell?: boolean };
  return rest as unknown as Record<string, unknown>;
}

/**
 * Erste Abweichung als PFAD, oder null.
 *
 * Bewusst nicht `JSON.stringify(a) === JSON.stringify(b)`: Die RoomDefs des
 * Kits entstehen aus `{ ...r, hash }` und tragen `hash` deshalb als LETZTES
 * Feld, eine getippte Definition hätte es vorn. Ein Zeichenkettenvergleich
 * meldete das als Unterschied — und das wäre ein Fehlalarm über die
 * Reihenfolge der Schlüssel, an der nichts hängt. Was WIRKLICH hängt, ist
 * die Reihenfolge der `connections` (der Index IST die Kennung eines
 * Connectors); Arrays werden deshalb der Reihe nach verglichen.
 */
function ersteAbweichung(a: unknown, b: unknown, pfad = ''): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${pfad}: Array gegen Nicht-Array`;
    if (a.length !== b.length) return `${pfad}: ${a.length} Einträge gegen ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = ersteAbweichung(a[i], b[i], `${pfad}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join(',') !== kb.join(','))
      return `${pfad}: Felder {${ka.join(',')}} gegen {${kb.join(',')}}`;
    for (const k of ka) {
      const d = ersteAbweichung(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${pfad}.${k}`
      );
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${pfad}: ${String(a)} gegen ${String(b)}`;
}

console.log('\n  Muster-Vergleich gegen die ausgelieferten Säle');
for (const [name, cx, cz, weight] of HALLEN) {
  const soll = roomByName.get(name);
  if (!soll) {
    check(false, `${name} fehlt im Kit`);
    continue;
  }
  const ist = roomDefForHall(name, cx, cz, weight);
  const abweichung = ersteAbweichung(ohneFlag(ist), soll as unknown);
  check(abweichung === null, `${name}: erzeugte RoomDef weicht ab — ${abweichung}`);
  check(ist.nurManuell === true, `${name}: erzeugte RoomDef ohne nurManuell`);
  check(
    (soll as RoomDef & { nurManuell?: boolean }).nurManuell === undefined,
    `${name}: BESTANDSraum trägt nurManuell — Golden und M3 wären ab hier verschoben`
  );
  const m = gridModuleFromRoomDef(ist);
  console.log(
    `    ${name.padEnd(22)} ${cx}×${cz}  ${ist.connections.length} Connectors, ` +
      `Hülle ${ist.size.x}×${ist.size.z} m, ${m.cells.length} Zellen`
  );
}

// ---------------------------------------------------------------------------
// 4. Ein Fussabdruck, den es nicht gibt, ist ein Fehler und keine Zahl
//
// Die Klemmen des Formulars (2…8 Zellen, Raster, Dreiecksdeckel) sitzen
// im Server (E5). Was hier gehalten wird, ist enger und älter: Ein
// halbzelliger oder leerer Saal hat keine Geometrie, und `size` wäre
// eine Hülle, die auf keinem Raster liegt — `gridModuleFromRoomDef` würfe
// dann erst zwei Schritte später, mit einer Meldung über die Hülle statt
// über das Argument.
// ---------------------------------------------------------------------------
{
  const schlecht: readonly (readonly [string, number, number])[] = [
    ['null Zellen in x', 0, 3],
    ['null Zellen in z', 3, 0],
    ['negative Zellzahl', -2, 3],
    ['halbe Zelle', 2.5, 3],
  ];
  for (const [was, cx, cz] of schlecht) {
    let geworfen = false;
    try {
      roomDefForHall('Gen_StoneVaultHallX', cx, cz, 1);
    } catch {
      geworfen = true;
    }
    check(geworfen, `${was} (${cx}×${cz}) läuft durch statt zu werfen`);
  }
  console.log(`\n  ${schlecht.length} ungültige Fussabdrücke werfen`);
}

// ---------------------------------------------------------------------------
// 5. Ein einzelliger Saal ist gültig — und seine vier Kanten sind offen
//
// Nicht Zierde: Der 1×1-Fall ist der einzige ohne Innenkante, und er
// belegt, dass die Randkanten nicht aus „was keine Innenkante ist“
// abgeleitet werden, sondern aus wirklich gesetzten Connectors.
// ---------------------------------------------------------------------------
{
  const def = roomDefForHall('Gen_StoneVaultHall1x1', 1, 1, 1);
  const m = gridModuleFromRoomDef(def);
  check(def.connections.length === 4, `1×1: ${def.connections.length} Connectors statt 4`);
  check(m.cells.length === 1, `1×1: ${m.cells.length} Zellen statt 1`);
  const c0 = m.cells[0]!;
  for (const d of ['n', 'e', 's', 'w'] as readonly Direction[]) {
    check(c0.edges[d] === 'open', `1×1: Kante ${d} ist '${c0.edges[d]}'`);
    check(!c0.interior[d], `1×1: Kante ${d} gilt als Innenkante`);
  }
  console.log('  1×1     vier offene Randkanten, keine Innenkante');
}


// ===========================================================================
// E4 — `registerModule`: das Eintragen selbst
//
// Ab hier wird MUTIERT. Alles davor ist reine Rechnung und in beliebiger
// Reihenfolge wiederholbar; ein `registerModule` verändert dagegen die
// Nachschlagewerke des ganzen Prozesses. Die Abschnitte unten stehen
// deshalb am Ende der Datei und in dieser Reihenfolge — der Zeuge aus
// Abschnitt 8 braucht eine Messung von VOR der ersten Registrierung.
// ===========================================================================

// ---------------------------------------------------------------------------
// 6a. Die Messung, die nur vor der ersten Registrierung zu haben ist
//
// `nurManuell` ist ein Feld, das man nicht sehen kann: Es hat keinen
// sichtbaren Effekt, sondern verhindert einen. Ein Test, der bloss
// `def.nurManuell === true` prüft, prüft die Schreibweise des Auftrags und
// nicht seine Wirkung. Die Wirkung ist: Der Grundriss, den der Generator
// aus demselben Saatkorn baut, bleibt nach der Registrierung DERSELBE.
//
// Das ist die schärfste erreichbare Aussage, weil `pickStampOption` über
// die SUMME aller Gewichte wählt (`dungeonRasterGenerator.ts`): Ein
// zusätzlicher Stempel verschiebt nicht nur den Wurf, bei dem er selbst
// gezogen würde, sondern JEDEN. Ein durchgerutschtes Modul fiele hier also
// nicht bei einem Seed unter vielen auf, sondern bei fast allen.
// ---------------------------------------------------------------------------
const SAATEN = [1, 7, 23, 40] as const;
const layoutVorher = SAATEN.map((s) => JSON.stringify(erzeugeLayoutFuerKit(kit, s)));
const raeumeVorher = kit.rooms.length;
const prefabsVorher = PREFAB_DEFS.length;

// ---------------------------------------------------------------------------
// 6b. Ein Aufruf, sechs Nachschlagewerke
//
// Warum überhaupt sechs und nicht eins: Ein Saal ist im Betrieb sechsmal
// eine andere Sache, und jede Stelle fragt ein anderes Verzeichnis.
//   • `kit.rooms`         — woraus der Generator und der Editor wählen
//   • `ROOMS_BY_HASH`     — womit ein persistierter Raum wieder aufgelöst wird
//   • `KIT_BY_ROOM_HASH`  — woher der Client das Steinmaterial nimmt
//   • `KIT_BY_PREFAB_HASH`— dasselbe über den Prefab-Weg (Türen inbegriffen)
//   • `PREFAB_DEFS`/`PREFABS_BY_HASH`/`PREFABS_BY_NAME` — woher das GLB kommt
//   • `EIGENE_MODELLE`/`EIGENE_MODELLE_SET` — Spawn-Editor und Welt-Whitelist
// Fehlt EINES davon, ist der Saal nicht „halb da": Er ist im Editor
// wählbar und im Spiel unsichtbar, oder umgekehrt — ein Zustand, den keine
// Meldung erklärt.
// ---------------------------------------------------------------------------
const NEUER_SAAL = 'Gen_StoneVaultHall4x3';
{
  const def = roomDefForHall(NEUER_SAAL, 4, 3, 0.5);
  registerModule('DG_StoneVault', def);
  const h = getStableHash(NEUER_SAAL);

  // 1 — kit.rooms
  check(kit.rooms.length === raeumeVorher + 1, `kit.rooms ${kit.rooms.length} statt ${raeumeVorher + 1}`);
  check(kit.rooms.some((r) => r.name === NEUER_SAAL), 'kit.rooms kennt den Saal nicht');
  check(kit.rooms[kit.rooms.length - 1] === def, 'kit.rooms trägt eine KOPIE statt der übergebenen RoomDef');

  // 2 — ROOMS_BY_HASH (und der öffentliche Weg dorthin)
  check(ROOMS_BY_HASH.get(h) === def, 'ROOMS_BY_HASH kennt den Saal nicht');
  check(getRoomByHash(h) === def, 'getRoomByHash kennt den Saal nicht');

  // 3 — KIT_BY_ROOM_HASH
  check(KIT_BY_ROOM_HASH.get(h) === kit, 'KIT_BY_ROOM_HASH führt den Saal nicht auf sein Kit zurück');
  check(getKitByRoomHash(h) === kit, 'getKitByRoomHash führt den Saal nicht auf sein Kit zurück');

  // 4 — KIT_BY_PREFAB_HASH
  check(KIT_BY_PREFAB_HASH.get(h) === kit, 'KIT_BY_PREFAB_HASH kennt den Saal nicht');
  check(getKitByPrefabHash(h) === kit, 'getKitByPrefabHash kennt den Saal nicht');

  // 5 — die Prefab-Registry, Eintrag für Eintrag gegen das Muster aus
  //     `buildRegistry()`. Verglichen wird nicht „ungefähr gleich", sondern
  //     jedes Feld: Ein Raum-Prefab OHNE `PERSISTENT` überlebte den
  //     Welt-Save nicht, eines mit `sprite` bekäme im Editor ein Bild, das
  //     es nicht gibt, und eines ohne `model` bliebe der Platzhalterkasten.
  const p = PREFABS_BY_NAME.get(NEUER_SAAL);
  check(p !== undefined, 'PREFABS_BY_NAME kennt den Saal nicht');
  check(PREFABS_BY_HASH.get(h) === p, 'PREFABS_BY_HASH und PREFABS_BY_NAME zeigen auf Verschiedenes');
  check(findPrefabByName(NEUER_SAAL) === p, 'findPrefabByName kennt den Saal nicht');
  check(findPrefabByHash(h) === p, 'findPrefabByHash kennt den Saal nicht');
  check(PREFAB_DEFS.length === prefabsVorher + 1, `PREFAB_DEFS ${PREFAB_DEFS.length} statt ${prefabsVorher + 1}`);
  check(PREFAB_DEFS[PREFAB_DEFS.length - 1] === p, 'PREFAB_DEFS trägt einen anderen Eintrag als die Karten');
  if (p) {
    // Das Muster: der Eintrag, den `buildRegistry()` für einen Raum des
    // Kits anlegen WÜRDE. Kein zweites Mal hingeschrieben, sondern aus
    // derselben Funktion geholt — sonst wären es zwei Wahrheiten über
    // dasselbe Prefab, und sie liefen beim nächsten Feld auseinander.
    const muster = roomPrefabDef(def);
    for (const feld of ['name', 'flags', 'localScale', 'sprite', 'model', 'renderScale'] as const) {
      check(
        JSON.stringify((p as Record<string, unknown>)[feld], (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v
        ) ===
          JSON.stringify((muster as unknown as Record<string, unknown>)[feld], (_k, v) =>
            typeof v === 'bigint' ? v.toString() : v
          ),
        `Prefab-Feld '${feld}' weicht vom Muster aus buildRegistry() ab`
      );
    }
  }

  // 6 — EIGENE_MODELLE: Liste UND Menge.
  //     Der Auftrag nennt nur `EIGENE_MODELLE_SET`, und die Begründung des
  //     Konzepts lautet „sonst im Spawn-Editor unauffindbar". Nachgesehen:
  //     Der Spawn-Editor listet die ARRAY-Fassung
  //     (`client/src/editor/SpawnPanel.ts`, `GegenstandsKatalog.ts`), die
  //     Menge wird von `istEigenesModell` und `pruefeLayout` gefragt. Die
  //     Menge entsteht EINMAL beim Import aus dem Array — ein späterer
  //     `push` erreicht sie nicht, ein späteres `add` das Array nicht.
  //     Nur eines von beiden zu füllen erfüllt also genau die Hälfte des
  //     Satzes, mit dem der Eintrag begründet ist.
  check(EIGENE_MODELLE_SET.has(NEUER_SAAL), 'EIGENE_MODELLE_SET kennt den Saal nicht');
  check(istEigenesModell(NEUER_SAAL), 'istEigenesModell verneint den Saal');
  check(EIGENE_MODELLE.includes(NEUER_SAAL), 'EIGENE_MODELLE (Liste) kennt den Saal nicht — im Spawn-Editor unauffindbar');
  check(
    EIGENE_MODELLE.length === EIGENE_MODELLE_SET.size,
    `EIGENE_MODELLE ${EIGENE_MODELLE.length} Einträge, Menge ${EIGENE_MODELLE_SET.size} — Liste und Menge sind auseinandergelaufen`
  );

  console.log(`\n  registerModule  ${NEUER_SAAL} in sechs Nachschlagewerken, Hash ${h}`);
}

// ---------------------------------------------------------------------------
// 7. Was NICHT durchgehen darf — und was danach unverändert sein muss
//
// Eine Ablehnung ist nur halb so viel wert, wenn sie den Zustand halb
// verändert zurücklässt. Ein Modul, das in `kit.rooms` steht, aber in
// keiner Prefab-Karte, wäre schlimmer als eines, das ganz fehlt: Der
// Generator sähe es, der Client fände kein Modell, und die Meldung dazu
// käme aus einer ganz anderen Ecke. Jede Ablehnung wird deshalb mit einem
// Vorher/Nachher-Stand der Längen geprüft.
// ---------------------------------------------------------------------------
{
  const laengen = () => [kit.rooms.length, PREFAB_DEFS.length, EIGENE_MODELLE.length, EIGENE_MODELLE_SET.size].join('/');
  const vorher = laengen();

  const wirft = (was: string, tue: () => void): string => {
    let meldung: string | null = null;
    try {
      tue();
    } catch (e) {
      meldung = e instanceof Error ? e.message : String(e);
    }
    check(meldung !== null, `${was}: läuft durch statt zu werfen`);
    check(laengen() === vorher, `${was}: hinterlässt einen halb eingetragenen Zustand (${laengen()} statt ${vorher})`);
    return meldung ?? '(nicht geworfen)';
  };

  const meldungen: string[] = [];
  // (a) Derselbe Name ein zweites Mal — der Fall aus dem Auftrag. Er ist
  //     kein theoretischer: Zwei Editor-Fenster, zweimal derselbe
  //     Zuschnitt, und der zweite Bau träfe auf ein GLB, das schon liegt.
  meldungen.push(wirft('zweiter Aufruf, gleicher Name', () =>
    registerModule('DG_StoneVault', roomDefForHall(NEUER_SAAL, 4, 3, 0.5))
  ));
  // (b) Ein Name, den es schon als BESTANDSraum gibt.
  meldungen.push(wirft('Name eines Bestandsraums', () =>
    registerModule('DG_StoneVault', roomDefForHall('StoneVaultHall', 2, 2, 1))
  ));
  // (c) Ein Hash, der schon vergeben ist, unter einem freien Namen. Das
  //     ist der Fall, den eine Namensprüfung allein NICHT fängt:
  //     `getStableHash` ist 32-bittig, zwei Namen können denselben Hash
  //     tragen. Ein solcher Saal überschriebe beim Laden den fremden Raum,
  //     ohne dass ein Name doppelt wäre.
  meldungen.push(wirft('fremder Hash unter freiem Namen', () => {
    const geklaut = { ...roomDefForHall('Gen_StoneVaultHall2x2b', 2, 2, 1), hash: getStableHash('StoneVaultHall') };
    registerModule('DG_StoneVault', geklaut);
  }));
  // (d) Ein Kit, das es nicht gibt.
  meldungen.push(wirft('unbekanntes Kit', () =>
    registerModule('DG_GibtsNicht', roomDefForHall('Gen_StoneVaultHall2x5', 2, 5, 1))
  ));
  // (e) Ohne `nurManuell`. Der teuerste der fünf Fälle, weil er als
  //     einziger OHNE Fehler durchginge: Der Saal käme in die
  //     Stempelauswahl, `pickStampOption` rechnete mit einer neuen
  //     Gewichtssumme, und jedes noch nicht betretene Grab der Welt
  //     bekäme einen anderen Grundriss. Kein Absturz, keine Meldung —
  //     nur andere Gräber.
  meldungen.push(wirft('ohne nurManuell', () => {
    const { nurManuell: _weg, ...ohne } = roomDefForHall('Gen_StoneVaultHall2x6', 2, 6, 1);
    registerModule('DG_StoneVault', ohne as RoomDef);
  }));

  // Fünf verschiedene Meldungen, nicht fünfmal dieselbe: Wer im Betrieb
  // eine Ablehnung liest, muss daraus ableiten können, WAS zu ändern ist.
  const verschieden = new Set(meldungen).size;
  check(verschieden === meldungen.length, `${meldungen.length} Ablehnungen, aber nur ${verschieden} verschiedene Meldungen`);
  console.log(`\n  ${meldungen.length} Ablehnungen, ${verschieden} verschiedene Meldungen, Zustand unverändert (${vorher})`);
  for (const m of meldungen) console.log(`    ${m}`);
}

// ---------------------------------------------------------------------------
// 8. Der Zeuge: registrierte Module sind kein Generator-Material
//
// Registriert wird hier zusätzlich ein EINZELLIGER Saal, und zwar mit
// Absicht. Ein 4×3 landet in `stampModuleOptions` (mehrzellig, eine
// Ebene); ein 1×1 landet in `cellModuleOptions` — einer ANDEREN Auswahl,
// die der Konzepttext gar nicht nennt. Wer `nurManuell` nur an der einen
// Stelle liest, bekommt hier einen roten Test statt in einem halben Jahr
// ein Grab, das sich unbemerkt geändert hat.
// ---------------------------------------------------------------------------
{
  registerModule('DG_StoneVault', roomDefForHall('Gen_StoneVaultHall1x1', 1, 1, 1));
  check(kit.rooms.length === raeumeVorher + 2, `kit.rooms ${kit.rooms.length} statt ${raeumeVorher + 2}`);

  let gleich = 0;
  SAATEN.forEach((s, i) => {
    const nachher = JSON.stringify(erzeugeLayoutFuerKit(kit, s));
    if (nachher === layoutVorher[i]) gleich++;
    else check(false, `Saat ${s}: der Grundriss hat sich durch die Registrierung geändert`);
  });
  console.log(
    `\n  Grundrisse  ${gleich}/${SAATEN.length} Saaten byte-gleich vor und nach zwei Registrierungen ` +
      `(1×1 und 4×3, beide nurManuell)`
  );
}

// ---------------------------------------------------------------------------
// 9. Der statische Wächter: kein Modul unter shared/src mutiert beim Import
//
// ── Warum das nicht zur Laufzeit prüfbar ist ─────────────────────────
// `shared/package.json` verspricht `sideEffects: false`, und der Kommentar
// daneben nennt „keine Registry-Einträge" ausdrücklich. Die Zusage ist
// keine Höflichkeit: Sie ERLAUBT Rollup, aus dem Barrel wegzuwerfen, was
// ein Einstieg nicht anfasst. Ein Modul, dessen Zweck eine Mutation beim
// Import wäre, dürfte also weggeworfen werden — und dann fehlte die
// Registrierung genau im ausgelieferten Bündel und nirgends sonst. Kein
// Laufzeittest sieht das: Unter `tsx` läuft der Quelltext ungeschnitten.
// Was hier gebraucht wird, ist ein Blick auf den QUELLTEXT.
//
// ── Wonach gesucht wird ──────────────────────────────────────────────
// Geprüft wird jede .ts unter `shared/src` auf Anweisungen, die beim
// IMPORT laufen (also ausserhalb jedes Funktionsrumpfes — mit Ausnahme
// sofort aufgerufener Funktionen, die eben doch laufen) und dabei etwas
// FREMDES anfassen: eine importierte Bindung oder ein Wirt-Global.
// Alles, was ein Modul mit seinen eigenen Werten tut, bleibt erlaubt —
// `new Map(DUNGEONS.map(…))` baut ein Nachschlagewerk auf, ohne dass
// jemand ausserhalb es merkt, und genau das ist der Unterschied.
// ---------------------------------------------------------------------------
{
  const WIRT_GLOBALS = new Set(['window', 'document', 'globalThis', 'self', 'localStorage', 'navigator', 'process']);
  const MUTATOREN = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
    'set', 'add', 'delete', 'clear',
  ]);

  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const dateien: string[] = [];
  const sammle = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(p);
    }
  };
  sammle(wurzel);

  /** Linkeste Kennung einer Zugriffskette: `A.b.c` → `A`. */
  const wurzelName = (e: ts.Node): string | null => {
    let cur: ts.Node = e;
    for (;;) {
      if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) { cur = cur.expression; continue; }
      break;
    }
    return ts.isIdentifier(cur) ? cur.text : null;
  };
  const entklammere = (e: ts.Node): ts.Node => {
    let cur = e;
    while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    return cur;
  };

  const funde: string[] = [];
  let geprueft = 0;
  for (const datei of dateien) {
    const text = readFileSync(datei, 'utf8');
    const sf = ts.createSourceFile(datei, text, ts.ScriptTarget.ES2022, true);
    const rel = relative(resolve(wurzel, '..', '..'), datei);
    geprueft++;

    const importiert = new Set<string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const c = st.importClause;
      if (c.isTypeOnly) continue; // Typen sind zur Laufzeit spurlos
      if (c.name) importiert.add(c.name.text);
      const nb = c.namedBindings;
      if (nb) {
        if (ts.isNamespaceImport(nb)) importiert.add(nb.name.text);
        else for (const el of nb.elements) if (!el.isTypeOnly) importiert.add(el.name.text);
      }
    }
    const fremd = (n: string | null): boolean => n !== null && (importiert.has(n) || WIRT_GLOBALS.has(n));
    const melde = (n: ts.Node, was: string): void => {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      funde.push(`${rel}:${line + 1} — ${was}`);
    };

    const sofortAufgerufen = new Set<ts.Node>();
    const besuche = (node: ts.Node): void => {
      // Rümpfe laufen erst beim AUFRUF — ausser bei sofort aufgerufenen.
      if (
        (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
        !sofortAufgerufen.has(node)
      ) {
        return;
      }
      if (ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
      if (ts.isTypeNode(node)) return;

      if (ts.isCallExpression(node)) {
        const callee = entklammere(node.expression);
        if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) sofortAufgerufen.add(callee);
        if (ts.isPropertyAccessExpression(callee)) {
          const w = wurzelName(callee.expression);
          if (MUTATOREN.has(callee.name.text) && fremd(w)) {
            melde(node, `mutiert '${w}' beim Import (.${callee.name.text}())`);
          }
          if (w === 'Object' && (callee.name.text === 'assign' || callee.name.text === 'defineProperty')) {
            const ziel = node.arguments[0];
            if (ziel && fremd(wurzelName(ziel))) melde(node, `Object.${callee.name.text} auf '${wurzelName(ziel)}' beim Import`);
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const links = entklammere(node.left);
        if (ts.isPropertyAccessExpression(links) || ts.isElementAccessExpression(links)) {
          const w = wurzelName(links);
          if (fremd(w)) melde(node, `weist '${w}.…' beim Import zu`);
        }
      }
      if (ts.isIdentifier(node) && WIRT_GLOBALS.has(node.text)) {
        const el = node.parent;
        const istFeldname = el && ts.isPropertyAccessExpression(el) && el.name === node;
        if (!istFeldname) melde(node, `greift beim Import auf '${node.text}' zu`);
      }
      ts.forEachChild(node, besuche);
    };
    ts.forEachChild(sf, besuche);
  }

  check(funde.length === 0, `Nebenwirkungen beim Import:\n    ${funde.join('\n    ')}`);
  console.log(`\n  Wächter     ${geprueft} Dateien unter shared/src, ${funde.length} Mutationen beim Import`);
}

console.log(
  failures === 0
    ? '\nOK — die erzeugte Saal-RoomDef ist von einer gebauten nicht zu unterscheiden,\n' +
        '     ein Aufruf trägt sie in sechs Nachschlagewerke, und kein Import mutiert etwas'
    : `\n${failures} FEHLER`
);
process.exit(failures > 0 ? 1 : 0);
