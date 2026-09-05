/**
 * E9 — Der Löschpfad für gebaute Säle
 * (`server/src/world/dungeon/ModuleBuild.ts`, `deleteModule`).
 *
 * ── Warum Löschen der gefährlichere der beiden Wege ist ──────────────
 * Bauen legt etwas an, das vorher niemand benutzt hat; die schlimmste
 * Folge eines Fehlers ist eine Datei zu viel. Löschen greift in einen
 * Bestand ein, an dem Dokumente hängen — und die Stelle, an der ein
 * fehlender Raum auffällt, ist NICHT die Stelle, an der gelöscht wurde:
 * `sanitizeDungeonDocument` verwirft unbekannte Räume WORTLOS. Ein Saal,
 * der aus der Registry verschwindet, während ein Grab ihn benutzt, wird
 * also nicht zu einer Fehlermeldung, sondern zu einem Loch im Boden —
 * beim nächsten Speichern dieses Dokuments, Tage später, durch jemand
 * anderen. Genau dagegen misst dieser Test.
 *
 * Vier Fragen, die er stellt:
 *
 *   (1) WIRD DER BESTAND GESCHÜTZT? Ein Dokument, das den Saal benutzt,
 *       muss das Löschen verhindern — und die Ablehnung muss die
 *       DOKUMENT-ID nennen. „Wird noch benutzt" ohne Namen zwingt zum
 *       Durchsuchen aller Gräber von Hand.
 *
 *   (2) WELCHE Dokumente zählen? Nicht die des laufenden Prozesses. Ein
 *       Server kennt GENAU EINE Welt (`dungeonsDir` ist
 *       `data/dungeons/<welt>`), die GLB-Datei und die Registry teilen
 *       sich aber ALLE Welten dieser Maschine. Gesucht wird deshalb auf
 *       der PLATTE unter `server/data/dungeons`, über alle Weltordner —
 *       sonst löscht ein Server auf `dev` einen Saal weg, den `world`
 *       benutzt, und merkt es nie.
 *
 *   (3) KANN MAN DAMIT ETWAS ANDERES LÖSCHEN? Der Name kommt hier — anders
 *       als beim Bauen — AUS DEM NETZ. Er wird zu einem Dateipfad, und er
 *       ist zugleich ein Schlüssel in die Nachschlagewerke des laufenden
 *       Prozesses. Ein `../` darin wäre eine fremde Datei, ein
 *       `StoneVaultHall` darin wäre ein von Hand getippter Raum, den
 *       dieser Weg aus dem Kit risse — für jeden verbundenen Spieler.
 *
 *   (4) IST DER PROZESS DANACH MIT DER PLATTE EINIG? Bliebe der Saal in
 *       den Nachschlagewerken stehen, während die Datei ihn nicht mehr
 *       führt, wäre `registryChecksum()` des Servers dauerhaft eine
 *       andere Zahl als die jeder frisch geladenen Editor-Seite — und
 *       JEDES Speichern schlüge mit „Registry veraltet" fehl, bis jemand
 *       den Server neu startet. Das ist der teuerste Ausgang von allen,
 *       weil er wie ein Fehler des Editors aussieht.
 *
 * Rot zuerst: `deleteModule` gibt es heute nicht — dieser Test lässt sich
 * vor der Umsetzung nicht einmal importieren.
 *
 * E9 guard: both gates, the name guard (which also protects hand-typed
 * rooms), the disk-wide document scan, the pending-entrance rule, and the
 * agreement between process state and registry file after a delete.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PacketType, getStableHash } from '@wov/shared';
import { PREFABS_BY_NAME, PREFAB_DEFS, EIGENE_MODELLE } from '@wov/shared/src/prefabs.js';
import { DUNGEONS_BY_NAME, ROOMS_BY_HASH } from '@wov/shared/src/dungeons.js';
import { registeredModules, registryChecksum } from '@wov/shared/src/moduleRegistry.js';
import { Drossel } from '../src/net/Drossel.js';
import {
  KIT_NAME,
  REGISTRY_DATEI,
  baueModul,
  deleteModule,
  leseRegistry,
  modulName,
  registryPruefsumme,
  type ModulBauKontext,
  type ModuleDeleteContext,
} from '../src/world/dungeon/ModuleBuild.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function check(bedingung: boolean, was: string): void {
  console.log(`  ${bedingung ? 'ok  ' : 'FAIL'} ${was}`);
  if (!bedingung) failures++;
}

/** Ein frischer Ordnerbaum: Modulordner + Dokumentwurzel mit zwei Welten. */
function baum(): { module: string; dungeons: string; dev: string; welt: string } {
  const wurzel = mkdtempSync(join(tmpdir(), 'wov-modulloesch-'));
  const module = join(wurzel, 'generiert');
  const dungeons = join(wurzel, 'dungeons');
  const dev = join(dungeons, 'dev');
  const welt = join(dungeons, 'world');
  mkdirSync(module, { recursive: true });
  mkdirSync(dev, { recursive: true });
  mkdirSync(welt, { recursive: true });
  return { module, dungeons, dev, welt };
}

const o = baum();

function bauKontext(aenderung: Partial<ModulBauKontext> = {}): ModulBauKontext {
  return { istAdmin: true, modulbauErlaubt: true, verzeichnis: o.module, ...aenderung };
}
function loeschKontext(aenderung: Partial<ModuleDeleteContext> = {}): ModuleDeleteContext {
  return {
    istAdmin: true,
    modulbauErlaubt: true,
    verzeichnis: o.module,
    dungeonsWurzel: o.dungeons,
    ...aenderung,
  };
}
function ablehnung(antwort: ReturnType<typeof deleteModule>): string {
  return antwort.ok ? '(NICHT ABGELEHNT)' : antwort.meldung;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Ein Saal, den es zu löschen gibt
// ═══════════════════════════════════════════════════════════════════════
console.log('\n1. Vorbereitung: ein gebauter Saal');

const WUNSCH = { cellsX: 4, cellsZ: 3, raster: 4, weight: 0.5 };
const NAME = modulName(WUNSCH.cellsX, WUNSCH.cellsZ, WUNSCH.raster);
const HASH = getStableHash(NAME);
const gebaut = baueModul(bauKontext(), WUNSCH);
check(gebaut.ok, `${NAME} gebaut${gebaut.ok ? '' : ` — ${gebaut.meldung}`}`);
const glb = join(o.module, `${NAME}.glb`);
const glbVorher = existsSync(glb) ? readFileSync(glb) : Buffer.alloc(0);
check(glbVorher.length > 0, `${NAME}.glb liegt da (${glbVorher.length} Bytes)`);
check(PREFABS_BY_NAME.has(NAME), 'und der Saal ist in den Nachschlagewerken registriert');

// ═══════════════════════════════════════════════════════════════════════
// 2. Die zwei Tore — dieselben wie beim Bauen
// ═══════════════════════════════════════════════════════════════════════
//
// Löschen ist nicht harmloser als Bauen, sondern schwerer rückgängig zu
// machen: Ein zu viel gebauter Saal steht herum, ein zu viel gelöschter
// ist weg. Beide Tore gelten deshalb wortgleich.
console.log('\n2. Tore');

const meldungen: string[] = [];
function ablehnungPruefen(was: string, meldung: string, wort: string): void {
  meldungen.push(meldung);
  check(
    meldung !== '(NICHT ABGELEHNT)' && meldung.toLowerCase().includes(wort.toLowerCase()),
    `${was} → „${meldung}"`
  );
}

ablehnungPruefen(
  'Nicht-Admin',
  ablehnung(deleteModule(loeschKontext({ istAdmin: false }), NAME)),
  'Berechtigung'
);
ablehnungPruefen(
  'dungeons.modulbau: false',
  ablehnung(deleteModule(loeschKontext({ modulbauErlaubt: false }), NAME)),
  'modulbau'
);

// ═══════════════════════════════════════════════════════════════════════
// 3. Der Name kommt aus dem NETZ — und wird zu einem Pfad
// ═══════════════════════════════════════════════════════════════════════
//
// Beim Bauen bildet der Server den Namen selbst aus vier Zahlen; hier
// schickt ihn der Client. Das ist der erste Weg dieses Projekts, auf dem
// eine ZEICHENKETTE aus dem Netz einen Dateinamen ergibt UND ein
// Schlüssel in die Raumtabellen ist. Beides muss dieselbe Erlaubnisliste
// passieren, und zwar VOR jedem Zugriff.
console.log('\n3. Namen aus fremder Feder');

ablehnungPruefen('Name „../../server.yml"', ablehnung(deleteModule(loeschKontext(), '../../server.yml')), 'Zeichen');
ablehnungPruefen(
  'Name ohne Gen_-Präfix',
  ablehnung(deleteModule(loeschKontext(), 'StoneVaultHall')),
  'Präfix'
);
ablehnungPruefen(
  'unbekannter, aber formgültiger Name',
  ablehnung(deleteModule(loeschKontext(), 'Gen_StoneVaultHall7x7')),
  'Registry'
);

// Die eigentliche Frage hinter (3): Steht der von Hand getippte Raum
// danach noch im Kit? Ein Löschweg, der über die Namensprüfung hinweg an
// `StoneVaultHall` käme, risse ein Modul aus `eigeneDungeons.ts` — für
// jeden verbundenen Spieler, ohne Neustart, ohne Meldung.
const kit = DUNGEONS_BY_NAME.get(KIT_NAME)!;
check(
  kit.rooms.some((r) => r.name === 'StoneVaultHall'),
  'der von Hand getippte StoneVaultHall steht unverändert im Kit'
);
check(
  new Set(meldungen).size === meldungen.length,
  `${meldungen.length} Ablehnungen mit ${new Set(meldungen).size} VERSCHIEDENEN Meldungen`
);

// ═══════════════════════════════════════════════════════════════════════
// 4. Ein Dokument, das den Saal benutzt, hält ihn fest
// ═══════════════════════════════════════════════════════════════════════
console.log('\n4. Dokumente auf der Platte');

// (a) Ein Dokument im ALTFORMAT, das den Raum beim NAMEN nennt.
writeFileSync(
  join(o.dev, 'steingrab-e9.json'),
  JSON.stringify({
    version: 5,
    id: 'steingrab-e9',
    name: 'Saal-Test',
    base: KIT_NAME,
    mode: 'custom',
    layout: { rooms: [{ room: NAME, pos: { x: 0, y: 0, z: 0 } }], doors: [], props: [] },
  })
);
const benutzt = deleteModule(loeschKontext(), NAME);
check(!benutzt.ok, 'ein benutzter Saal wird nicht gelöscht');
check(
  !benutzt.ok && benutzt.meldung.includes('steingrab-e9'),
  `die Ablehnung nennt die Dokument-ID → „${ablehnung(benutzt)}"`
);
check(existsSync(glb), 'und die GLB-Datei liegt unangetastet da');
check(
  leseRegistry(o.module).module.some((m) => m.name === NAME),
  'der Registry-Eintrag ebenso'
);

// (b) DIESELBE Prüfung, aber in einer ANDEREN WELT. Der laufende Server
//     kennt nur seine eigene (`data/dungeons/<welt>`); die GLB-Datei und
//     die Registry teilen sich alle Welten dieser Maschine. Wer nur die
//     eigene Welt fragt, löscht `world` das Modell weg, während er auf
//     `dev` arbeitet — und erfährt davon nichts.
writeFileSync(join(o.dev, 'steingrab-e9.json'), JSON.stringify({ version: 5, id: 'x', base: KIT_NAME, layout: { rooms: [] } }));
writeFileSync(
  join(o.welt, 'krypta-fremd.json'),
  JSON.stringify({
    version: 5,
    id: 'krypta-fremd',
    base: KIT_NAME,
    layout: { rooms: [{ room: NAME, pos: { x: 0, y: 0, z: 0 } }], doors: [], props: [] },
  })
);
const fremd = deleteModule(loeschKontext(), NAME);
check(
  !fremd.ok && fremd.meldung.includes('krypta-fremd'),
  `ein Dokument der NACHBARWELT hält den Saal genauso fest → „${ablehnung(fremd)}"`
);

// (c) Ein Dokument im 2.0-FORMAT, das den Raum nur über seinen HASH führt.
//     Beide Formate liegen im selben Ordner und werden erst am Feld
//     `version` unterschieden. Ein Sucher, der nur eines von beiden kennt,
//     übersähe das andere STILL — deshalb sucht er nach Name UND Hash und
//     kennt gar kein Format.
writeFileSync(join(o.welt, 'krypta-fremd.json'), JSON.stringify({ version: 11, id: 'leer', raeume: [] }));
writeFileSync(
  join(o.dev, 'grab-2punkt0.json'),
  JSON.stringify({ version: 11, id: 'grab-2punkt0', thema: 'krypta', teile: [{ prefabHash: HASH }] })
);
const zweiNull = deleteModule(loeschKontext(), NAME);
check(
  !zweiNull.ok && zweiNull.meldung.includes('grab-2punkt0'),
  `auch ein Treffer über den HASH ${HASH} hält fest → „${ablehnung(zweiNull)}"`
);

// (d) Ein Dokument, das sich nicht lesen lässt, ist KEIN Freibrief.
//     „Ich konnte nicht nachsehen" heisst nicht „es benutzt ihn nicht".
writeFileSync(join(o.dev, 'grab-2punkt0.json'), JSON.stringify({ version: 11, id: 'leer2' }));
writeFileSync(join(o.dev, 'kaputt.json'), '{ das ist kein JSON');
const kaputt = deleteModule(loeschKontext(), NAME);
check(
  !kaputt.ok && kaputt.meldung.includes('kaputt.json'),
  `ein unlesbares Dokument blockt und wird beim Namen genannt → „${ablehnung(kaputt)}"`
);

// Und die Gegenprobe zu (a)–(d): Nichts davon hat etwas verändert.
check(existsSync(glb), 'nach vier Ablehnungen liegt die GLB-Datei immer noch da');
check(PREFABS_BY_NAME.has(NAME), 'und der Saal ist weiterhin registriert');

// ═══════════════════════════════════════════════════════════════════════
// 5. Ein Eingang ohne Dokument ist ein Dokument, das es noch nicht gibt
// ═══════════════════════════════════════════════════════════════════════
//
// Eingänge tragen ein REZEPT (Kit + Seed); das Dokument entsteht erst beim
// ersten Betreten. Solange es nicht auf der Platte liegt, kann die Suche
// aus (4) nichts über es aussagen — sie sieht nur, was geschrieben ist.
// Deshalb blockt ein unmaterialisierter Eingang DIESES Kits das Löschen.
console.log('\n5. Unmaterialisierte Eingänge');

writeFileSync(join(o.dev, 'kaputt.json'), '{}');
writeFileSync(
  join(o.welt, 'entrances.json'),
  JSON.stringify({
    version: 1,
    entries: [{ zoneKey: '3,7', dungeonId: 'stonevault-3x7', base: KIT_NAME, seed: 42 }],
  })
);
const eingang = deleteModule(loeschKontext(), NAME);
check(
  !eingang.ok && eingang.meldung.includes('stonevault-3x7'),
  `ein gebuchter, nie betretener Eingang blockt → „${ablehnung(eingang)}"`
);

// Ein Eingang eines ANDEREN Kits geht den Saal nichts an.
writeFileSync(
  join(o.welt, 'entrances.json'),
  JSON.stringify({
    version: 1,
    entries: [{ zoneKey: '3,7', dungeonId: 'steingrab-3x7', base: 'DG_Steingrab', seed: 42 }],
  })
);
const fremdesKit = deleteModule(loeschKontext(), NAME);
check(fremdesKit.ok, 'ein Eingang eines anderen Kits blockt NICHT');

// ═══════════════════════════════════════════════════════════════════════
// 6. Was ein gelungener Löschgang hinterlässt
// ═══════════════════════════════════════════════════════════════════════
console.log('\n6. Nach dem Löschen');

check(fremdesKit.ok && fremdesKit.ergebnis.name === NAME, 'die Antwort nennt den Saal');
check(!existsSync(glb), `${NAME}.glb ist von der Platte`);
const stand = leseRegistry(o.module);
check(!stand.module.some((m) => m.name === NAME), 'der Registry-Eintrag ist fort');
check(
  fremdesKit.ok && fremdesKit.ergebnis.pruefsumme === registryPruefsumme(stand.module),
  'die gemeldete Prüfsumme ist die der geschriebenen Datei'
);

// Der teuerste der möglichen Fehler: Prozess und Datei uneinig. Bliebe der
// Saal in den Nachschlagewerken stehen, rechnete der Server dauerhaft eine
// andere Prüfsumme aus als jede frisch geladene Editor-Seite — und JEDES
// Speichern schlüge mit „Registry veraltet" fehl, bis jemand neu startet.
check(
  registryChecksum() === registryPruefsumme(stand.module),
  `Prozess und Platte sind einig (${registryChecksum()})`
);
check(!registeredModules().some((m) => m.name === NAME), 'der Vermerk ist fort');
check(!ROOMS_BY_HASH.has(HASH), 'ROOMS_BY_HASH kennt den Hash nicht mehr');
check(!PREFABS_BY_NAME.has(NAME), 'PREFABS_BY_NAME kennt den Namen nicht mehr');
check(!PREFAB_DEFS.some((p) => p.name === NAME), 'PREFAB_DEFS führt ihn nicht mehr');
check(!kit.rooms.some((r) => r.name === NAME), 'und das Kit führt ihn nicht mehr');
check(!EIGENE_MODELLE.includes(NAME), 'EIGENE_MODELLE ebenso wenig');
check(
  kit.rooms.some((r) => r.name === 'StoneVaultHall'),
  'die von Hand getippten Räume des Kits sind unberührt'
);

// ═══════════════════════════════════════════════════════════════════════
// 7. Derselbe Name wieder — und warum das hier erlaubt ist
// ═══════════════════════════════════════════════════════════════════════
//
// „Ein Modulname ist unveränderlich" (Konzept 1h) steht gegen den
// Browsercache: Live liegt `/assets/` sieben Tage. Der Satz gilt weiter —
// aber er kostet hier NICHTS, und das ist nachrechenbar statt geglaubt:
// Der Name ist massabgeleitet, die Geometrie hängt an genau denselben drei
// Zahlen. Ein Wiederaufbau unter demselben Namen liefert deshalb DIESELBEN
// BYTES. Ein Klient mit der alten Datei im Cache hat die richtige.
console.log('\n7. Wiederaufbau');

const neu = baueModul(bauKontext(), { ...WUNSCH, weight: 1.7 });
check(neu.ok, `${NAME} lässt sich nach dem Löschen erneut bauen`);
check(
  existsSync(glb) && readFileSync(glb).equals(glbVorher),
  'und die neue Datei ist BYTEGLEICH — der Name trägt das Mass, nicht das Gewicht'
);
check(
  leseRegistry(o.module).module.find((m) => m.name === NAME)?.gewicht === 1.7,
  'nur das Gewicht steht neu in der Registry'
);

// ═══════════════════════════════════════════════════════════════════════
// 8. Eine fehlende GLB-Datei hält das Löschen nicht auf
// ═══════════════════════════════════════════════════════════════════════
//
// Gelöscht wird in der Reihenfolge Datei → Registry → Prozess. Bricht der
// Server dazwischen ab, bleibt ein Eintrag ohne Datei stehen — den meldet
// der Registry-Leser beim Start bereits als Warnung. Ein zweiter Anlauf
// muss ihn dann zu Ende räumen können; täte er es nicht, wäre der einzige
// Ausweg das Bearbeiten der Registry von Hand.
console.log('\n8. Zweiter Anlauf');

const halb = deleteModule(loeschKontext(), NAME);
check(halb.ok, 'der Saal ist wieder weg');
writeFileSync(
  join(o.module, REGISTRY_DATEI),
  JSON.stringify({
    version: 1,
    pruefsumme: 'egal',
    module: [
      {
        kit: KIT_NAME,
        name: NAME,
        zellenX: WUNSCH.cellsX,
        zellenZ: WUNSCH.cellsZ,
        pfeilerRaster: WUNSCH.raster,
        gewicht: 0.5,
        tris: 2364,
        erzeugt: '2026-09-05T00:00:00.000Z',
      },
    ],
  })
);
const ohneDatei = deleteModule(loeschKontext(), NAME);
check(ohneDatei.ok, 'ein Eintrag ohne GLB-Datei lässt sich trotzdem löschen');
check(leseRegistry(o.module).module.length === 0, 'die Registry ist danach leer');

// ═══════════════════════════════════════════════════════════════════════
// 9. Paket und Drossel
// ═══════════════════════════════════════════════════════════════════════
console.log('\n9. Paketweg');

check(PacketType.DungeonModulBau === 74, 'DungeonModulBau bleibt 74 (additiv angehängt)');
check(PacketType.DungeonModulBauErgebnis === 75, 'DungeonModulBauErgebnis bleibt 75');
check(PacketType.DungeonModulLoeschen === 76, 'DungeonModulLoeschen ist 76');
check(PacketType.DungeonModulLoeschErgebnis === 77, 'DungeonModulLoeschErgebnis ist 77');

// Die Drossel misst sich an der Uhr, nicht an einer Tabelle. Ein STOSS
// ist hier anders als beim Bauen erwünscht: Wer drei Probesäle gebaut
// hat, räumt sie in einem Zug wieder weg — Dauerfeuer bleibt gesperrt.
const drossel = new Drossel();
const t0 = 1_000_000;
let durch = 0;
for (let i = 0; i < 10; i++) {
  if (drossel.erlaubt('peer-1', PacketType.DungeonModulLoeschen, t0 + i)) durch++;
}
check(durch === 3, `zehn Löschpakete in Folge: ${durch} durchgelassen (Eimer 3)`);
check(
  !drossel.erlaubt('peer-1', PacketType.DungeonModulLoeschen, t0 + 2_000),
  'nach 2 s noch nicht wieder'
);
check(
  drossel.erlaubt('peer-1', PacketType.DungeonModulLoeschen, t0 + 3_001),
  'nach gut 3 s wieder (Füllrate 1/3 s)'
);

// ═══════════════════════════════════════════════════════════════════════
// 10. Verdrahtungs-Zeuge (Text, kein Lauf)
// ═══════════════════════════════════════════════════════════════════════
/*
  Wie in `modulbau-grenzen.ts`: Diese Prüfungen belegen nicht, dass der
  Weg funktioniert, sondern nur, dass er überhaupt gelegt ist. Genau das
  kann kein anderer Test hier sehen — der Löschweg samt allen Klemmen kann
  vollständig richtig sein und trotzdem nie gerufen werden.
*/
console.log('\n10. Verdrahtung');

const wovServer = readFileSync(resolve(WURZEL, 'server/src/WovServer.ts'), 'utf8');
check(
  wovServer.includes('case PacketType.DungeonModulLoeschen:'),
  'WovServer hat einen Zweig für PacketType.DungeonModulLoeschen'
);
check(
  /deleteModule\(/.test(wovServer),
  'und der Zweig führt zu deleteModule (nicht zu einer zweiten Klemmenliste)'
);
// Und die Wurzel steht an EINER Stelle: Der DungeonManager bekommt seinen
// Weltordner aus derselben Methode, aus der der Löschweg die Wurzel nimmt.
// Zwei getrennte Ausdrücke liefen bei der nächsten Ordnerverschiebung
// auseinander — und die Suche liefe dann ins Leere, ohne einen Fehler.
check(
  /private dungeonsWurzel\(\)/.test(wovServer),
  'WovServer benennt die Dokumentwurzel ALLER Welten an einer Stelle'
);
check(
  /resolve\(this\.dungeonsWurzel\(\), this\.config\.worldName\)/.test(wovServer),
  'und der DungeonManager bekommt seinen Weltordner aus genau dieser Stelle'
);
check(
  /dungeonsWurzel: this\.dungeonsWurzel\(\)/.test(wovServer),
  'der Löschweg bekommt die Wurzel, nicht den Weltordner'
);

console.log(
  failures === 0 ? '\nAlle Prüfungen bestanden.' : `\n${failures} Prüfung(en) fehlgeschlagen.`
);
process.exit(failures === 0 ? 0 : 1);
