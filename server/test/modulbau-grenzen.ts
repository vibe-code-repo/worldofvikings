/**
 * E5 — Wächter über den Modulbau am Spielserver-Socket
 * (`server/src/world/dungeon/ModuleBuild.ts`).
 *
 * ── Was hier gemessen wird und warum es nicht selbstverständlich ist ──
 * Ab E5 kann ein verbundener Client den Server dazu bringen, eine DATEI
 * zu schreiben und die Nachschlagewerke des laufenden Prozesses zu
 * verändern. Das ist der erste Schreibweg dieses Projekts, dessen
 * Eingabe eine ZAHL aus dem Netz ist und dessen Ausgabe ein PFAD auf der
 * Platte. Jede der Klemmen unten steht deshalb nicht für Bequemlichkeit,
 * sondern für einen Fehler, der ohne sie kein Symptom hätte:
 *
 *   (1) DIE ZWEI TORE. `peer.isAdmin` schützt heute nichts
 *       (`server/data/server.yml`: `everyone-admin: true`) — jeder
 *       verbundene Client ist Admin. Der Schalter `dungeons.modulbau`
 *       ist deshalb nicht das zweite Schloss an derselben Tür, sondern
 *       das einzige, das heute wirklich zu ist. Und ein Schalter mit
 *       Tippfehler ist ein Schalter, den niemand findet: `ServerKonfig`
 *       WARNT nur bei unbekannten Schlüsseln, es lehnt nicht ab. Der
 *       Eintrag in `BEKANNTE_SCHLUESSEL` ist damit selbst eine Zusage,
 *       die geprüft gehört.
 *
 *   (2) DER DREIECKSDECKEL BEISST WIRKLICH. Säle haben KEIN `_col` —
 *       das sichtbare Netz IST die Havok-Form. Nachgerechnet: 8×8 Zellen
 *       mit dem VORGABERASTER 2 ergeben 12·(2 + 1024 + 3·49) = 14 076
 *       Dreiecke und werden abgelehnt; dieselben 8×8 mit Raster 4
 *       ergeben 12 636 und gehen durch. Der Deckel ist also keine
 *       Zierde für einen unerreichbaren Fall, sondern die Grenze, an der
 *       der grösste erlaubte Saal steht oder fällt.
 *
 *   (3) DER NAME WIRD EIN DATEINAME. Er ist massabgeleitet, der Client
 *       schickt nur Zahlen — aber die Registry auf der Platte ist eine
 *       Textdatei, die ein Mensch bearbeiten kann, und der Server LIEST
 *       sie beim Start. Genau dort ist ein Name aus fremder Feder wieder
 *       eine Eingabe. Deshalb prüft der Wächter den Namen an der Stelle,
 *       an der aus ihm ein Pfad wird, und nicht nur beim Bauen.
 *
 * Rot zuerst: Es gibt heute weder `ModuleBuild.ts` noch den Pakettyp noch
 * den Schalter — dieser Test lässt sich vor der Umsetzung nicht einmal
 * importieren.
 *
 * E5 guard: two gates, the size clamps, the triangle cap, the name guard
 * (which is also the registry-load guard), the throttle, and the round
 * trip build → GLB file → registry → registered module.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PacketType } from '@wov/shared';
import { PREFABS_BY_NAME } from '@wov/shared/src/prefabs.js';
import { ROOMS_BY_HASH } from '@wov/shared/src/dungeons.js';
import { unbekannteSchluessel } from '../src/ServerKonfig.js';
import { Drossel } from '../src/net/Drossel.js';
import {
  CELLS_MAX,
  CELLS_MIN,
  DREIECKS_DECKEL,
  KIT_NAME,
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  baueModul,
  glbPfad,
  ladeModulRegistrierung,
  leseRegistry,
  modulName,
  registryPruefsumme,
  type ModulBauKontext,
} from '../src/world/dungeon/ModuleBuild.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let failures = 0;
function check(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  ok   ${was}`);
  } else {
    console.log(`  FAIL ${was}`);
    failures++;
  }
}

function tempOrdner(): string {
  return mkdtempSync(join(tmpdir(), 'wov-modulbau-'));
}

/** Ein Kontext, in dem alles erlaubt ist — die Ablehnungen unten schalten je EINES ab. */
function kontext(dir: string, aenderung: Partial<ModulBauKontext> = {}): ModulBauKontext {
  return { istAdmin: true, modulbauErlaubt: true, verzeichnis: dir, ...aenderung };
}

/** Die Ablehnungsmeldung einer Antwort — oder eine Zeile, die auffällt. */
function ablehnung(antwort: ReturnType<typeof baueModul>): string {
  return antwort.ok ? '(NICHT ABGELEHNT)' : antwort.meldung;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Der Schalter ist bekannt — sonst ist er still wirkungslos
// ═══════════════════════════════════════════════════════════════════════
console.log('\n1. server.yml: dungeons.modulbau');

const gemeldet = unbekannteSchluessel({
  dungeons: { enabled: true, modulbau: true },
});
check(
  !gemeldet.includes('dungeons.modulbau'),
  `unbekannteSchluessel() meldet dungeons.modulbau NICHT (gemeldet: ${JSON.stringify(gemeldet)})`
);
check(
  unbekannteSchluessel({ dungeons: { modulbaa: true } }).includes('dungeons.modulbaa'),
  'ein Tippfehler im Schlüssel wird weiterhin gemeldet (die Prüfung misst also etwas)'
);

// ═══════════════════════════════════════════════════════════════════════
// 2. Die Ablehnungen — jede mit EIGENER Meldung
// ═══════════════════════════════════════════════════════════════════════
console.log('\n2. Ablehnungen');

const dirA = tempOrdner();
const gut = { cellsX: 4, cellsZ: 3, raster: 4, weight: 0.5 };
const meldungen: string[] = [];

function ablehnungPruefen(was: string, meldung: string, erwartetesWort: string): void {
  meldungen.push(meldung);
  check(
    meldung !== '(NICHT ABGELEHNT)' && meldung.toLowerCase().includes(erwartetesWort.toLowerCase()),
    `${was} → „${meldung}"`
  );
}

ablehnungPruefen(
  'Nicht-Admin',
  ablehnung(baueModul(kontext(dirA, { istAdmin: false }), gut)),
  'Berechtigung'
);
ablehnungPruefen(
  'dungeons.modulbau: false',
  ablehnung(baueModul(kontext(dirA, { modulbauErlaubt: false }), gut)),
  'modulbau'
);
ablehnungPruefen(
  '9 Zellen je Achse',
  ablehnung(baueModul(kontext(dirA), { ...gut, cellsX: 9 })),
  'Zellzahl'
);
ablehnungPruefen(
  'Pfeilerraster 3',
  ablehnung(baueModul(kontext(dirA), { ...gut, raster: 3 })),
  'raster'
);
ablehnungPruefen(
  'Gewicht 3,0',
  ablehnung(baueModul(kontext(dirA), { ...gut, weight: 3 })),
  'Gewicht'
);
ablehnungPruefen(
  'Dreiecksdeckel (8×8 mit Vorgaberaster 2 = 14 076)',
  ablehnung(baueModul(kontext(dirA), { cellsX: 8, cellsZ: 8, raster: 2, weight: 1 })),
  'Dreieck'
);

/*
  Die beiden Namensablehnungen kommen NICHT aus dem Paketweg — der Name
  ist dort massabgeleitet und kann diese Formen gar nicht annehmen. Sie
  kommen aus der Stelle, an der aus einem Namen ein PFAD wird: derselbe
  Wächter, den `baueModul` und der Registry-Leser beide durchlaufen.
*/
function pfadAblehnung(name: string): string {
  try {
    glbPfad(dirA, name);
    return '(NICHT ABGELEHNT)';
  } catch (e) {
    return (e as Error).message;
  }
}
ablehnungPruefen('Name „../x"', pfadAblehnung('../x'), 'Zeichen');
ablehnungPruefen('Name ohne Gen_-Präfix', pfadAblehnung('StoneVaultHall4x3'), 'Präfix');
ablehnungPruefen(
  'Name mit endlosem Anhang',
  pfadAblehnung('Gen_StoneVaultHall' + 'A'.repeat(17)),
  'Form'
);

check(
  new Set(meldungen).size === meldungen.length,
  `${meldungen.length} Ablehnungen mit ${new Set(meldungen).size} VERSCHIEDENEN Meldungen`
);

// Die Gegenprobe: kein einziges dieser Pakete hat etwas geschrieben.
check(
  !existsSync(join(dirA, REGISTRY_DATEI)),
  'keine abgelehnte Anfrage hat die Registry angelegt'
);

// ═══════════════════════════════════════════════════════════════════════
// 3. Der Name kommt aus dem Mass, nicht aus dem Formular
// ═══════════════════════════════════════════════════════════════════════
console.log('\n3. Massabgeleiteter Name');

check(modulName(4, 3, 2) === 'Gen_StoneVaultHall4x3', `4×3 Raster 2 → ${modulName(4, 3, 2)}`);
check(modulName(4, 3, 4) === 'Gen_StoneVaultHall4x3r4', `4×3 Raster 4 → ${modulName(4, 3, 4)}`);
/*
  Ein 2×2-Saal ist 4 m breit — unter der Pfeilerspanne, er bekommt unter
  JEDEM Raster null Pfeiler. Zwei Namen für dieselbe Datei wären zwei
  Wahrheiten über ein Modul: Der zweite Bau schriebe ein byte-gleiches
  GLB unter neuem Namen, statt auf das vorhandene zu zeigen.
*/
check(
  modulName(2, 2, 2) === modulName(2, 2, 4) && modulName(2, 2, 4) === modulName(2, 2, 6),
  `2×2 ergibt unter jedem Raster denselben Namen (${modulName(2, 2, 6)}) — gleiche Geometrie, gleicher Name`
);
check(
  modulName(2, 4, 4) === modulName(2, 4, 6) && modulName(2, 4, 2) !== modulName(2, 4, 4),
  `2×4: Raster 4 und 6 sind hier dieselbe Geometrie (${modulName(2, 4, 6)}), Raster 2 nicht (${modulName(2, 4, 2)})`
);

// ═══════════════════════════════════════════════════════════════════════
// 4. Der gültige Bau — Datei, Registry, Eintrag
// ═══════════════════════════════════════════════════════════════════════
console.log('\n4. Gültiger Bau');

const dirB = tempOrdner();
const antwort = baueModul(kontext(dirB), gut);
check(antwort.ok, `4×3 Raster 4 Gewicht 0,5 wird gebaut${antwort.ok ? '' : `: ${antwort.meldung}`}`);

if (antwort.ok) {
  const e = antwort.ergebnis;
  // B = 2 + 16·4·3 + 3·1 = 197  →  12·B = 2 364 (die Zahl aus der Konzeptnotiz)
  check(e.name === 'Gen_StoneVaultHall4x3r4', `Name ${e.name}`);
  check(e.tris === 2364, `${e.tris} Dreiecke (Formel 12·(2 + 16·12 + 3·1) = 2 364)`);
  check(e.vertices === 4728, `${e.vertices} Ecken (24 je Quader)`);
  check(
    e.sizeX === 8 && e.sizeY === 3.5 && e.sizeZ === 6,
    `Masse ${e.sizeX} × ${e.sizeY} × ${e.sizeZ} m`
  );

  const glb = join(dirB, `${e.name}.glb`);
  check(existsSync(glb), `Datei ${e.name}.glb liegt in assets/generiert/`);

  /*
    Gemessen wird die DATEI, nicht der Rückgabewert. Ein Bauweg, der die
    Zahlen richtig meldet und die Bytes falsch schreibt, bestünde sonst.
  */
  const bytes = readFileSync(glb);
  check(bytes.readUInt32LE(0) === 0x46546c67, 'die Datei beginnt mit dem glTF-Magic');
  check(
    bytes.readUInt32LE(8) === bytes.length,
    `die im Kopf angekündigte Länge (${bytes.readUInt32LE(8)}) ist die echte Dateigrösse (${bytes.length})`
  );
  const jsonLaenge = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLaenge).toString('utf8')) as {
    accessors: { count: number }[];
    meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  };
  const prim = gltf.meshes[0].primitives[0];
  check(
    gltf.accessors[prim.indices].count === e.tris * 3,
    `die Indexzahl in der Datei (${gltf.accessors[prim.indices].count}) ist 3 × ${e.tris}`
  );
  check(
    gltf.accessors[prim.attributes.POSITION].count === e.vertices,
    `die Eckenzahl in der Datei ist ${e.vertices}`
  );

  const registry = leseRegistry(dirB);
  check(registry.version === REGISTRY_VERSION, `Registry version ${registry.version}`);
  check(registry.module.length === 1, `Registry führt ${registry.module.length} Modul`);
  const m = registry.module[0];
  check(
    m.kit === KIT_NAME && m.zellenX === 4 && m.zellenZ === 3 && m.pfeilerRaster === 4,
    `Registry-Eintrag: ${m.kit} ${m.zellenX}×${m.zellenZ} r${m.pfeilerRaster}`
  );
  check(m.gewicht === 0.5 && m.tris === 2364, `Registry-Eintrag: Gewicht ${m.gewicht}, ${m.tris} Dreiecke`);
  check(
    typeof m.erzeugt === 'string' && m.erzeugt.length > 0,
    `Registry-Eintrag trägt einen Zeitstempel (${m.erzeugt})`
  );
  check(
    registry.pruefsumme === registryPruefsumme(registry.module) && registry.pruefsumme.length === 8,
    `Prüfsumme ${registry.pruefsumme} passt zum Modulstand`
  );
  /*
    Die Prüfsumme muss auf eine ÄNDERUNG anschlagen (E6 hängt daran) und
    darf am Zeitstempel NICHT hängen — sonst meldet sie Drift, wo zwei
    Seiten dieselben Module kennen.
  */
  check(
    registryPruefsumme(registry.module) !==
      registryPruefsumme([{ ...m, zellenZ: 4 }]),
    'eine andere Zellzahl ergibt eine andere Prüfsumme'
  );
  check(
    registryPruefsumme(registry.module) ===
      registryPruefsumme([{ ...m, erzeugt: '1999-01-01T00:00:00.000Z' }]),
    'ein anderer Zeitstempel ergibt DIESELBE Prüfsumme'
  );

  // Und die sechs Nachschlagewerke kennen ihn (das ist E4s Arbeit, hier
  // nur die Frage, ob E5 sie überhaupt ruft).
  check(PREFABS_BY_NAME.has(e.name), 'der Saal steht in der Prefab-Registry');
  const raum = [...ROOMS_BY_HASH.values()].find((r) => r.name === e.name);
  check(raum !== undefined && raum.nurManuell === true, 'der Saal steht als nurManuell in ROOMS_BY_HASH');

  // Zweiter Bau desselben Zuschnitts: abgelehnt, Name ist unveränderlich.
  const zweit = baueModul(kontext(dirB), gut);
  check(
    !zweit.ok && /vergeben|bereits/i.test(zweit.ok ? '' : zweit.meldung),
    `derselbe Zuschnitt ein zweites Mal → „${ablehnung(zweit)}"`
  );
  check(leseRegistry(dirB).module.length === 1, 'die Registry ist dabei nicht gewachsen');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Der Server liest die Registry beim Start
// ═══════════════════════════════════════════════════════════════════════
console.log('\n5. Registry beim Start lesen');

const dirC = tempOrdner();
mkdirSync(dirC, { recursive: true });
const vorrat = [
  { kit: KIT_NAME, name: 'Gen_StoneVaultHall5x5', zellenX: 5, zellenZ: 5, pfeilerRaster: 2, gewicht: 0.4, tris: 12 * (2 + 16 * 25 + 3 * 16), erzeugt: '2026-09-04T10:00:00.000Z' },
  { kit: KIT_NAME, name: 'Gen_StoneVaultHall3x6r4', zellenX: 3, zellenZ: 6, pfeilerRaster: 4, gewicht: 1, tris: 12 * (2 + 16 * 18 + 3 * 2), erzeugt: '2026-09-04T10:01:00.000Z' },
  // Von Hand nachgetragen, mit einem Namen, der ein Pfad ist:
  { kit: KIT_NAME, name: '../../etc/boese', zellenX: 3, zellenZ: 3, pfeilerRaster: 2, gewicht: 1, tris: 12 * (2 + 16 * 9 + 3 * 4), erzeugt: '2026-09-04T10:02:00.000Z' },
  // Und einer, der die Klemmen überschreitet:
  { kit: KIT_NAME, name: 'Gen_StoneVaultHall12x12', zellenX: 12, zellenZ: 12, pfeilerRaster: 2, gewicht: 1, tris: 999, erzeugt: '2026-09-04T10:03:00.000Z' },
];
writeFileSync(
  join(dirC, REGISTRY_DATEI),
  JSON.stringify({ version: REGISTRY_VERSION, pruefsumme: registryPruefsumme(vorrat), module: vorrat }, null, 2)
);

const geladen = ladeModulRegistrierung(dirC);
check(geladen.geladen === 2, `${geladen.geladen} von 4 Einträgen registriert`);
check(geladen.meldungen.length === 2, `${geladen.meldungen.length} Ablehnungen gemeldet: ${geladen.meldungen.join(' | ')}`);
check(PREFABS_BY_NAME.has('Gen_StoneVaultHall5x5'), 'Gen_StoneVaultHall5x5 ist nach dem Start registriert');
check(PREFABS_BY_NAME.has('Gen_StoneVaultHall3x6r4'), 'Gen_StoneVaultHall3x6r4 ist nach dem Start registriert');
check(!PREFABS_BY_NAME.has('../../etc/boese'), 'der Pfad-Name ist NICHT registriert');
check(!PREFABS_BY_NAME.has('Gen_StoneVaultHall12x12'), 'der übergrosse Saal ist NICHT registriert');
/*
  Eine FEHLENDE GLB-Datei darf den Saal nicht aus der Registrierung
  werfen: Ein Dokument, das ihn benutzt, verlöre den Raum sonst beim
  nächsten Speichern still. Sie muss aber auffallen — sonst ist ein
  nicht mitgereistes tar ein unsichtbarer Saal im Editor.
*/
check(
  geladen.warnungen.length === 2,
  `beide registrierten Module ohne GLB-Datei werden GEWARNT, nicht verworfen (${geladen.warnungen.length} Warnungen)`
);

// Ein fehlender Ordner ist kein Fehler — ein frischer Checkout hat keinen.
const dirLeer = join(tempOrdner(), 'gibtesnicht');
const leer = ladeModulRegistrierung(dirLeer);
check(leer.geladen === 0 && leer.meldungen.length === 0, 'ohne Registry-Datei: 0 geladen, keine Meldung');

// ═══════════════════════════════════════════════════════════════════════
// 6. Die Drossel — Eimer 1, ein Bau je 10 s
// ═══════════════════════════════════════════════════════════════════════
console.log('\n6. Drossel');

const drossel = new Drossel();
const t0 = 1_000_000;
check(drossel.erlaubt('peer-1', PacketType.DungeonModulBau, t0), 'erstes Baupaket geht durch');
check(
  !drossel.erlaubt('peer-1', PacketType.DungeonModulBau, t0 + 100),
  'das zweite unmittelbar danach nicht (Eimer 1, kein Stoss)'
);
check(
  !drossel.erlaubt('peer-1', PacketType.DungeonModulBau, t0 + 9_000),
  'nach 9 s immer noch nicht'
);
check(
  drossel.erlaubt('peer-1', PacketType.DungeonModulBau, t0 + 10_001),
  'nach gut 10 s wieder (Füllrate 1/10 s)'
);

// ═══════════════════════════════════════════════════════════════════════
// 7. Verdrahtungs-Zeuge (Text, kein Lauf)
// ═══════════════════════════════════════════════════════════════════════
/*
  Diese beiden Prüfungen lesen QUELLTEXT und behaupten deshalb weniger
  als der Rest: Sie belegen nicht, dass der Weg funktioniert, sondern
  nur, dass er überhaupt gelegt ist. Genau das ist aber der Fehler, den
  kein anderer Test hier sehen kann — der Bau samt allen Klemmen kann
  vollständig richtig sein und trotzdem nie gerufen werden.
*/
console.log('\n7. Verdrahtung');

const mainTs = readFileSync(resolve(WURZEL, 'server/src/main.ts'), 'utf8');
const iLade = mainTs.indexOf('ladeModulRegistrierung(');
const iServer = mainTs.indexOf('createWovServer(');
check(iLade >= 0, 'server/src/main.ts ruft ladeModulRegistrierung');
check(
  iLade >= 0 && iServer >= 0 && iLade < iServer,
  'und zwar VOR createWovServer — später trägt es in alle Karten ein und bleibt trotzdem unsichtbar'
);

const wovServer = readFileSync(resolve(WURZEL, 'server/src/WovServer.ts'), 'utf8');
check(
  wovServer.includes('case PacketType.DungeonModulBau:'),
  'WovServer hat einen Zweig für PacketType.DungeonModulBau'
);
check(
  /baueModul\(/.test(wovServer),
  'und der Zweig führt zu baueModul (nicht zu einer zweiten Klemmenliste)'
);

console.log(
  failures === 0 ? '\nE5: alles grün.\n' : `\nE5: ${failures} FEHLGESCHLAGEN.\n`
);
process.exit(failures > 0 ? 1 : 0);
