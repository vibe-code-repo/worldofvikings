/**
 * Etappe 5 — von Hand gesetzte Deko überlebt.
 *
 * Die Frage, die dieser Test beantwortet, ist NICHT „steht das ZDO da".
 * Sie lautet: Überlebt eine gesetzte Fackel das, was eine Instanz im
 * Betrieb erlebt?
 *
 *  1. Der Sanitizer nimmt Deko an, die das Kit kennt — und wirft weg, was
 *     es nicht kennt. Ein Dokument kommt vom Client; ein beliebiger Hash
 *     von aussen würde sonst zu einem ZDO, zu dem niemand ein Modell hat.
 *  2. `flattenLayout` macht daraus ein Stück, und `materialize` ein ZDO in
 *     der Welt der Instanz.
 *  3. Instanz abreissen und neu betreten (das tut `dungeon reset`, und das
 *     tut auch jedes Speichern im F4-Editor): Die Fackel ist wieder da.
 *     Sie muss es sein, denn Instanz-ZDOs werden NIE gespeichert — was
 *     überlebt, überlebt im Dokument.
 *  4. Serverneustart, hier als frischer DungeonManager auf demselben
 *     Ordner: Das Dokument kommt von Platte zurück, mit Deko.
 *  5. `removeRoom` nimmt die Deko des entfernten Raums mit UND zieht die
 *     Indizes der übrigen nach. Das ist die Stelle, die still falsch
 *     würde: `splice` verschiebt jeden Raum dahinter um eins nach vorn.
 *
 * Lauf: npx tsx server/test/g8-dungeon-deko.ts   (aus dem Repo-Wurzel)
 */

import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  DUNGEONS_BY_NAME,
  HeightmapProvider,
  getStableHash,
  removeRoom,
  sanitizeDungeonDocument,
  type DungeonDocument,
} from '@wov/shared';
import { LeereGeo } from '@wov/shared/src/worldgen/LeereGeo.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { DungeonManager } from '../src/world/dungeon/DungeonManager.js';
import { Welt } from '../src/world/Welt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-g8-deko');

let fehler = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    fehler++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

rmSync(DIR, { recursive: true, force: true });

const geo = new LeereGeo();
const welten = new Map<string, Welt>();
const umgebung = { prefabName: () => undefined, kreaturTrifft: () => {} };
const weltAnlegen = (weltId: string): Welt => {
  const da = welten.get(weltId);
  if (da) return da;
  const welt = new Welt(
    {
      id: weltId,
      geo,
      heightmaps: new HeightmapProvider(geo),
      zonenSeed: getStableHash(weltId),
      zonenOptionen: { worldFeatures: false, worldVegetation: false },
      mitKreaturen: false,
      mitZonengenerierung: false,
      serverUserId: 1n,
    },
    umgebung
  );
  welten.set(weltId, welt);
  return welt;
};
const weltEntfernen = (weltId: string): void => {
  welten.delete(weltId);
};

const zdos = new ZDOManager(1n);
const mgr = new DungeonManager(zdos, DIR, weltAnlegen, weltEntfernen);
mgr.load();

const FACKEL = getStableHash('CryptWallTorch');

// ── 1. Sanitizer ───────────────────────────────────────────────────
console.log('\nSanitizer:');
const doc = mgr.createGenerated('DG_Steingrab', 7)!;
check('Dokument erzeugt', doc !== null, `${doc.layout.rooms.length} Räume`);
// 2 → 3 mit M5a (dokumenteigenes `steinKit`, additiv wie `props` davor),
// 3 → 4 mit P5 (`PlacedRoom.steinKit` je platziertem Raum, ebenso additiv),
// 4 → 5 mit der Grundbeleuchtung (`ambientLicht`, wieder additiv).
// Bewusst die nackte Zahl statt `DUNGEON_DOCUMENT_VERSION`: Gegen die
// Konstante geprüft wäre die Zeile immer wahr und bezeugte nichts.
check('Version 5', doc.version === 5, String(doc.version));
check('props ist leer, nicht undefined', Array.isArray(doc.layout.props));

const kit = DUNGEONS_BY_NAME.get('DG_Steingrab')!;
check(
  'Kit kennt die Fackel',
  (kit.propTypes ?? []).some((p) => p.prefabHash === FACKEL),
  (kit.propTypes ?? []).map((p) => p.prefabName).join(', ')
);

const mitDeko = JSON.parse(JSON.stringify(doc)) as DungeonDocument;
mitDeko.layout.props = [
  {
    prefabName: 'CryptWallTorch',
    prefabHash: FACKEL,
    pos: { x: 1.75, y: 1.8, z: 0 },
    rot: { x: 0, y: 0.7071068, z: 0, w: 0.7071068 },
    roomIndex: 1,
  },
  // Kommt vom Client und ist erfunden — muss wegfallen.
  {
    prefabName: 'IrgendeinPrefab',
    prefabHash: getStableHash('IrgendeinPrefab'),
    pos: { x: 0, y: 0, z: 0 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
    roomIndex: 0,
  },
  // Verweist auf einen Raum, den es nicht gibt — muss auf -1 fallen.
  {
    prefabName: 'CryptWallTorch',
    prefabHash: FACKEL,
    pos: { x: 0, y: 1.8, z: 4 },
    rot: { x: 0, y: 0, z: 0, w: 1 },
    roomIndex: 9999,
  },
];
const sauber = sanitizeDungeonDocument(mitDeko)!;
check('fremdes Prefab verworfen', sauber.layout.props.length === 2, `${sauber.layout.props.length}`);
check(
  'Name kommt aus dem Kit',
  sauber.layout.props.every((p) => p.prefabName === 'CryptWallTorch')
);
check('Raumverweis ins Leere wird -1', sauber.layout.props[1]!.roomIndex === -1);
check('gültiger Raumverweis bleibt', sauber.layout.props[0]!.roomIndex === 1);

// ── 2. Materialisieren ─────────────────────────────────────────────
console.log('\nInstanz:');
const gespeichert = mgr.upsertDocument(sauber)!;
check('gespeichert', gespeichert !== null && gespeichert.doc.layout.props.length === 2);

const inst = mgr.getOrCreateInstance(doc.id)!;
const zaehleFackeln = (welt: Welt): number =>
  welt.zdos.getZDOByPrefab(FACKEL).length;
check('Fackeln materialisiert', zaehleFackeln(inst.welt) === 2, `${zaehleFackeln(inst.welt)}`);

// ── 3. Abriss und Wiedereintritt ───────────────────────────────────
console.log('\nAbriss und Wiedereintritt:');
mgr.destroyInstance(doc.id);
const inst2 = mgr.getOrCreateInstance(doc.id)!;
check('Fackeln nach dem Abriss wieder da', zaehleFackeln(inst2.welt) === 2, `${zaehleFackeln(inst2.welt)}`);
check('frische Welt', inst2.welt !== inst.welt);

// ── 3b. Deko aendern, ohne die Instanz abzureissen ─────────────────
//
// Das ist die Voraussetzung dafuer, dass Setzen automatisch speichern
// darf: Riesse jeder gesetzte Gegenstand die Instanz ab, wuerde der
// Spieler bei jeder Fackel an den Eingang teleportiert.
console.log('\nDeko aendern ohne Abriss:');
const raeumeVorher = inst2.zdoids.length - inst2.propZdoids.length;
const nochEine = JSON.parse(JSON.stringify(mgr.getDocument(doc.id))) as DungeonDocument;
nochEine.layout.props.push({
  prefabName: 'CryptWallTorch',
  prefabHash: FACKEL,
  pos: { x: -1.75, y: 1.8, z: 0 },
  rot: { x: 0, y: 0, z: 0, w: 1 },
  roomIndex: 1,
});
const inkrementell = mgr.upsertDocument(nochEine)!;
check('Instanz steht noch', inkrementell.instanzErhalten === true);
check('dieselbe Instanz', mgr.getInstance(doc.id) === inst2);
check('dritte Fackel da', zaehleFackeln(inst2.welt) === 3, String(zaehleFackeln(inst2.welt)));
check(
  'Raeume unangetastet',
  inst2.zdoids.length - inst2.propZdoids.length === raeumeVorher,
  String(inst2.zdoids.length - inst2.propZdoids.length)
);

// Und die Gegenprobe: Raeume geaendert heisst weiterhin Abriss.
const wenigerRaeume = JSON.parse(JSON.stringify(mgr.getDocument(doc.id))) as DungeonDocument;
wenigerRaeume.layout.rooms = wenigerRaeume.layout.rooms.slice(0, 5);
wenigerRaeume.layout.props = [];
const mitAbriss = mgr.upsertDocument(wenigerRaeume)!;
check('Raumaenderung reisst weiterhin ab', mitAbriss.instanzErhalten === false);

// Und wieder zurueck auf den Stand mit Deko: Der Neustart-Abschnitt unten
// liest von Platte, und die Gegenprobe hat gerade dorthin geschrieben.
mgr.upsertDocument(JSON.parse(JSON.stringify(gespeichert.doc)));

// ── 4. Serverneustart ──────────────────────────────────────────────
console.log('\nNeustart (frischer Manager auf demselben Ordner):');
const mgr2 = new DungeonManager(new ZDOManager(1n), DIR, weltAnlegen, weltEntfernen);
mgr2.load();
const vonPlatte = mgr2.getDocument(doc.id)!;
check('Dokument mit Deko von Platte', vonPlatte.layout.props.length === 2);
check(
  'Position unverändert',
  Math.abs(vonPlatte.layout.props[0]!.pos.x - 1.75) < 1e-6,
  String(vonPlatte.layout.props[0]!.pos.x)
);

// ── 5. removeRoom ──────────────────────────────────────────────────
console.log('\nRaum entfernen:');
const layout = JSON.parse(JSON.stringify(vonPlatte.layout)) as DungeonDocument['layout'];
layout.props = [
  { ...layout.props[0]!, roomIndex: 1 },
  { ...layout.props[0]!, roomIndex: 2 },
  { ...layout.props[0]!, roomIndex: 3 },
];
removeRoom(layout, 'DG_Steingrab', 2);
check('Deko des entfernten Raums ist weg', layout.props.length === 2, `${layout.props.length}`);
check(
  'Index davor bleibt',
  layout.props.some((p) => p.roomIndex === 1)
);
check(
  'Index dahinter rutscht nach',
  layout.props.some((p) => p.roomIndex === 2),
  layout.props.map((p) => p.roomIndex).join(',')
);

rmSync(DIR, { recursive: true, force: true });
console.log(`\n${fehler === 0 ? 'Alle Deko-Prüfungen grün.' : `${fehler} Prüfung(en) fehlgeschlagen`}`);
process.exit(fehler === 0 ? 0 : 1);
