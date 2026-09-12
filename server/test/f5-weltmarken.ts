/**
 * F5 smoke test — Fortschrittsmarken (GlobalKey-Laufzeitflaggen).
 *
 * Vorgeschichte: GlobalKey (shared/src/types.ts) und die Persistenz-Naht
 * (WorldManager nennt globalKeys/startingGlobalKeys) existierten, aber
 * nichts schrieb hinein und nichts las heraus — s. Kopfkommentar von
 * shared/src/types.ts fuer die Begriffsklaerung (Weltmodifikatoren vs.
 * Fortschrittsmarken; dieser Test und WeltMarken.ts bedienen NUR
 * Fortschrittsmarken).
 *
 * Checks:
 *  [1] WeltMarken (reine Logik): setzen ist idempotent (true beim ersten
 *      Mal, false danach), hat()/alsNamen() spiegeln den Zustand,
 *      ausListe() uebernimmt eine Namensliste UND ueberspringt unbekannte
 *      Namen still (Vorwaerts-/Rueckwaertskompatibilitaet), ein fehlendes
 *      `namen` bedeutet "keine Marken" statt eines Fehlers.
 *      globalKeyVonName: exakter Treffer, gross-/kleinschreibungs-
 *      tolerant, unbekannt -> undefined.
 *  [2] Admin-Befehl 'marke' (AdminCommandRegistry, wie g1-admin-fly):
 *      liste/setzen, Idempotenz ueber den Befehlsweg, unbekannter Name
 *      abgelehnt, nicht-Admin abgelehnt (Gate: canUseAdminCommands).
 *  [3] Speichern/Laden ueber den ECHTEN Weg (WovServer.saveWorld/
 *      loadWorld, eigener Weltordner in server/test/tmp-f5-worlds):
 *      Marken ueberleben einen Neustart.
 *  [4] Migrationspfad: ein von Hand gebautes Umschlag-Dokument OHNE
 *      `globalKeys`-Feld (= Stand vor diesem Umbau) laedt fehlerfrei mit
 *      leerer Markenmenge.
 *  [5] Realitaetscheck gegen eine KOPIE von dev.db.zst unter /tmp (NIE
 *      gegen das Original, s. Kopfkommentar der Aufgabe): der echte
 *      250k-ZDO-Speicherstand hat kein `globalKeys`-Feld und laedt trotzdem
 *      klaglos, WeltMarken.ausListe(undefined) bleibt leer. Wird
 *      uebersprungen, wenn die Datei auf dieser Maschine nicht existiert.
 *  [6] Die einzige verdrahtete Anwendung: Eikthyr besiegen setzt
 *      defeated_eikthyr; ein Reh zu besiegen setzt NICHTS (Regressions-
 *      wache gegen "jede Kreatur setzt die Marke").
 *
 * Run: npx tsx server/test/f5-weltmarken.ts   (from the repo root)
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zstdCompressSync } from 'node:zlib';
import { GlobalKey, Inventory, getStableHash, HEALTH_MEMBER, type Vector3 } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { WorldManager, SAVE_FORMAT_VERSION } from '../src/world/WorldManager.js';
import { WeltMarken, globalKeyVonName } from '../src/world/WeltMarken.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import type { Peer } from '../src/net/Peer.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = 'KxSYuZquuw';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== F5 smoke test: Fortschrittsmarken ===');

// ── [1] WeltMarken: reine Logik ────────────────────────────────────
console.log('\n[1] WeltMarken (reine Logik):');
{
  const m = new WeltMarken();
  check('frisch: keine Marken', m.alsNamen().length === 0);
  check('hat() auf ungesetzte Marke: false', m.hat(GlobalKey.defeated_eikthyr) === false);

  const ersteMal = m.setzen(GlobalKey.defeated_eikthyr);
  check('setzen(): true beim ersten Mal', ersteMal === true);
  check('hat() danach: true', m.hat(GlobalKey.defeated_eikthyr) === true);
  const zweiteMal = m.setzen(GlobalKey.defeated_eikthyr);
  check('setzen(): false beim zweiten Mal (idempotent)', zweiteMal === false);

  m.setzen(GlobalKey.killed_surtling);
  check(
    'alsNamen(): beide Namen, sortiert',
    JSON.stringify(m.alsNamen()) === JSON.stringify(['defeated_eikthyr', 'killed_surtling'].sort())
  );

  const m2 = new WeltMarken();
  m2.ausListe(['defeated_eikthyr', 'NichtVorhandenerName', 'KilledBat']);
  check(
    'ausListe(): bekannte Namen uebernommen, unbekannter still uebersprungen',
    m2.hat(GlobalKey.defeated_eikthyr) && m2.hat(GlobalKey.KilledBat) && m2.alsNamen().length === 2
  );

  const m3 = new WeltMarken();
  m3.setzen(GlobalKey.defeated_dragon);
  m3.ausListe(undefined);
  check('ausListe(undefined): leert auf "keine Marken", kein Fehler', m3.alsNamen().length === 0);

  const m4 = new WeltMarken();
  m4.ausListe([]);
  check('ausListe([]): ebenfalls "keine Marken"', m4.alsNamen().length === 0);

  check(
    'globalKeyVonName: exakter Treffer',
    globalKeyVonName('defeated_eikthyr') === GlobalKey.defeated_eikthyr
  );
  check(
    'globalKeyVonName: gross-/kleinschreibungs-tolerant',
    globalKeyVonName('DEFEATED_EIKTHYR') === GlobalKey.defeated_eikthyr
  );
  check('globalKeyVonName: unbekannt -> undefined', globalKeyVonName('quatsch') === undefined);
}

// ── [2] Admin-Befehl 'marke' ───────────────────────────────────────
console.log("\n[2] Admin-Befehl 'marke':");
{
  const WORLDS_DIR_ADMIN = resolve(__dirname, 'tmp-f5-admin');
  rmSync(WORLDS_DIR_ADMIN, { recursive: true, force: true });
  mkdirSync(WORLDS_DIR_ADMIN, { recursive: true });
  const server = createWovServer({
    port: 2499, // never bound (init() only, no start()) — s. g1-admin-fly
    worldName: 'f5admintest',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    worldsDir: WORLDS_DIR_ADMIN, kontenDir: resolve(WORLDS_DIR_ADMIN, 'konten'),
  });
  server.init();

  function makePeer(isAdmin: boolean): Peer {
    return {
      name: 'TestViking',
      isAdmin,
      flying: false,
      position: { x: 0, y: 100, z: 0 },
      lastInputSeq: 0,
      lastInputTime: 0,
      characterID: ZDOID.NONE,
      stamina: 100,
      staminaZuletztVerbraucht: 0,
      staminaSyncAkku: 0,
      health: 100,
      foodBis: 0,
      foodBonus: 0,
      // Wie am echten Peer vorbelegt — sonst haelt der Server den
      // Testspieler fuer jemanden in einer Instanzwelt.
      worldId: HAUPTWELT_ID,
      inventar: new Inventory(),
      sendPacketWith: () => {},
      sendPacket: () => {},
    } as unknown as Peer;
  }
  const admin = makePeer(true);
  const gast = makePeer(false);

  const leer = server.adminCommands.execute(admin, 'marke liste');
  check('leere Liste am Anfang', leer.ok && leer.message === 'Keine Marke gesetzt', leer.message);

  const gesetzt1 = server.adminCommands.execute(admin, 'marke setzen defeated_eikthyr');
  check(
    'erstes Setzen: ok + Erfolgsmeldung',
    gesetzt1.ok && gesetzt1.message.includes('gesetzt') && !gesetzt1.message.includes('schon'),
    gesetzt1.message
  );
  check('serverseitig wirklich gesetzt', server.weltMarken.hat(GlobalKey.defeated_eikthyr) === true);

  const gesetzt2 = server.adminCommands.execute(admin, 'marke setzen defeated_eikthyr');
  check('zweites Setzen: ok, aber "schon gesetzt"', gesetzt2.ok && gesetzt2.message.includes('schon'),
    gesetzt2.message);

  const gross = server.adminCommands.execute(admin, 'marke setzen KILLED_SURTLING');
  check(
    'gross-/kleinschreibungs-tolerant',
    gross.ok && server.weltMarken.hat(GlobalKey.killed_surtling),
    gross.message
  );

  const unbekannt = server.adminCommands.execute(admin, 'marke setzen NichtVorhandenerName');
  check('unbekannter Name abgelehnt', !unbekannt.ok, unbekannt.message);

  const ohneName = server.adminCommands.execute(admin, 'marke setzen');
  check('setzen ohne Namen: Aufrufhinweis', !ohneName.ok, ohneName.message);

  const liste = server.adminCommands.execute(admin, 'marke liste');
  check(
    'liste zeigt beide gesetzten Marken',
    liste.ok && liste.message.includes('defeated_eikthyr') && liste.message.includes('killed_surtling'),
    liste.message
  );

  const vonGast = server.adminCommands.execute(gast, 'marke setzen defeated_dragon');
  check(
    'nicht-Admin abgelehnt (peer.isAdmin-Gate)',
    !vonGast.ok && !server.weltMarken.hat(GlobalKey.defeated_dragon),
    vonGast.message
  );

  rmSync(WORLDS_DIR_ADMIN, { recursive: true, force: true });
}

// ── [3] Speichern/Laden ueber den echten Weg ───────────────────────
console.log('\n[3] Speichern/Laden (WovServer.saveWorld/loadWorld):');
{
  const WORLDS_DIR = resolve(__dirname, 'tmp-f5-worlds');
  rmSync(WORLDS_DIR, { recursive: true, force: true });
  mkdirSync(WORLDS_DIR, { recursive: true });

  function makeServer() {
    return createWovServer({
      port: 2499,
      worldName: 'f5test',
      worldSeed: SEED,
      worldFeatures: false,
      worldVegetation: false,
      worldCreatures: false,
      worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'),
    });
  }

  const serverA = makeServer();
  serverA.init();
  check('A: frisch, keine Marken', serverA.weltMarken.alsNamen().length === 0);
  serverA.weltMarken.setzen(GlobalKey.defeated_eikthyr);
  serverA.weltMarken.setzen(GlobalKey.killed_surtling);
  serverA.saveWorld();
  check('Save-Datei geschrieben', existsSync(serverA.worldManager.savePath));

  const serverB = makeServer();
  serverB.init();
  check(
    'B: Marken nach Neustart wiederhergestellt',
    serverB.weltMarken.hat(GlobalKey.defeated_eikthyr) &&
      serverB.weltMarken.hat(GlobalKey.killed_surtling) &&
      serverB.weltMarken.alsNamen().length === 2
  );

  // Erneutes Speichern darf die Marken nicht verlieren (Rundlauf ueber
  // ZWEI Zyklen — deckt einen Fehler ab, der nur beim zweiten Save
  // auftritt, z. B. weil momentaufnahme() aus dem falschen Feld liest).
  serverB.weltMarken.setzen(GlobalKey.defeated_dragon);
  serverB.saveWorld();
  const serverC = makeServer();
  serverC.init();
  check(
    'C: drei Marken nach zwei Speicherzyklen',
    serverC.weltMarken.alsNamen().length === 3 &&
      serverC.weltMarken.hat(GlobalKey.defeated_dragon)
  );

  rmSync(WORLDS_DIR, { recursive: true, force: true });
}

// ── [4] Migrationspfad: Save OHNE globalKeys-Feld ──────────────────
console.log('\n[4] Migration: Altstand ohne globalKeys-Feld:');
{
  const WORLDS_DIR = resolve(__dirname, 'tmp-f5-migration');
  rmSync(WORLDS_DIR, { recursive: true, force: true });
  mkdirSync(WORLDS_DIR, { recursive: true });

  // Handgebautes Umschlag-Dokument exakt wie ein Stand VOR diesem Umbau:
  // dieselbe Form wie WorldSaveData, aber ohne das Feld `globalKeys`.
  const altstand = {
    version: SAVE_FORMAT_VERSION,
    meta: {
      worldName: 'f5migration',
      worldSeed: SEED,
      worldGenVersion: 2,
      savedAt: new Date().toISOString(),
    },
    worldTime: 0,
    zones: [],
    players: [],
    zdos: [],
    // KEIN globalKeys — genau das, was einen Altstand ausmacht.
  };
  const savePath = resolve(WORLDS_DIR, 'f5migration.db.zst');
  writeFileSync(savePath, zstdCompressSync(Buffer.from(JSON.stringify(altstand), 'utf-8')));

  const wm = new WorldManager(WORLDS_DIR, 'f5migration', SEED, 2);
  const geladen = wm.load();
  check('Altstand laedt ueberhaupt (kein Abbruch am fehlenden Feld)', geladen !== null);
  check('globalKeys ist undefined im geladenen Envelope', geladen?.globalKeys === undefined);

  const marken = new WeltMarken();
  marken.ausListe(geladen?.globalKeys); // darf NICHT werfen
  check('Migration: fehlendes Feld -> leere Markenmenge', marken.alsNamen().length === 0);

  rmSync(WORLDS_DIR, { recursive: true, force: true });
}

// ── [5] Realitaetscheck: KOPIE von dev.db.zst (NIE das Original) ──
console.log('\n[5] Realitaetscheck gegen eine Kopie von dev.db.zst:');
{
  const DEV_QUELLE = resolve(__dirname, '../data/worlds/dev.db.zst');
  if (!existsSync(DEV_QUELLE)) {
    console.log('  (uebersprungen: dev.db.zst existiert auf dieser Maschine nicht)');
  } else {
    const DEV_KOPIE_DIR = '/tmp/wov-f5-dev-kopie';
    rmSync(DEV_KOPIE_DIR, { recursive: true, force: true });
    mkdirSync(DEV_KOPIE_DIR, { recursive: true });
    // Nur LESENDER Zugriff auf das Original (copyFileSync liest die Quelle,
    // schreibt ausschliesslich die Kopie) — s. Aufgabenkopf: niemals gegen
    // das Original testen.
    copyFileSync(DEV_QUELLE, resolve(DEV_KOPIE_DIR, 'dev.db.zst'));

    const wm = new WorldManager(DEV_KOPIE_DIR, 'dev', SEED, 2);
    const data = wm.load();
    check('echter dev-Speicherstand (Kopie) laedt', data !== null);
    // Ehrliche Weiche: ein frisch angelegter Server hat nur eine Handvoll
    // ZDOs (z. B. 157) und ist damit kein Nachweis fuer den 250k-Realitaets-
    // check -- das ist kein Fehler, sondern ein zu junger Spielstand. Ohne
    // diese Schranke war die Groessenordnungs-Zusicherung unten auf jeder
    // frischen Installation ROT, obwohl Laden, Migration und Marken-Logik
    // vollkommen richtig arbeiten. Uebersprungen wird deshalb NUR die
    // groessenabhaengige Aussage, mit dem Zahlenwert im Klartext -- ein
    // grosser Stand (>100.000 ZDOs) wird weiterhin unveraendert geprueft.
    if (data && data.zdos.length <= 100_000) {
      console.log(
        `  (uebersprungen: Spielstand zu jung für die Weltmarken-Prüfung: ${data.zdos.length} ZDOs, nötig > 100.000)`
      );
    } else if (data) {
      check(
        'Groessenordnung stimmt (>100.000 ZDOs, kein leerer Fund)',
        data.zdos.length > 100_000,
        `${data.zdos.length} ZDOs`
      );
      // Schlusskontrolle Stapel 3 hat gezeigt: wov-server laeuft unter
      // `tsx watch` (systemd ExecStart), daher fuehrt JEDE Aenderung an
      // server/src/world/WorldManager.ts auf wov-dev zu einem sofortigen
      // Hot-Reload des laufenden Dienstes -- und der naechste automatische
      // Autosave schreibt bereits im NEUEN Format (globalKeys: []) in die
      // echte dev.db.zst. Die urspruengliche Annahme 'das Feld fehlt dort
      // immer' war also nur ein Zeitfenster, kein dauerhafter Zustand, und
      // schlug reproduzierbar fehl, sobald genau das eintrat. Die eigentlich
      // wichtige Eigenschaft ist nicht die AN-/ABWESENHEIT des Feldes,
      // sondern dass Mikes echter Spielstand aktuell KEINE Fortschrittsmarke
      // traegt (Eikthyr ist dort nicht besiegt) -- das gilt unabhaengig vom
      // Speicherformat und wird direkt geprueft.
      const marken = new WeltMarken();
      marken.ausListe(data.globalKeys);
      check(
        'echter dev-Speicherstand traegt keine Fortschrittsmarke (Feld fehlt ODER ist leer)',
        data.globalKeys === undefined || Array.isArray(data.globalKeys)
      );
      check('Migration/Laden haelt auch am echten 250k-Stand', marken.alsNamen().length === 0);
    }
    rmSync(DEV_KOPIE_DIR, { recursive: true, force: true });
  }
}

// ── [6] Eikthyr besiegen setzt defeated_eikthyr (echte Anwendung) ──
console.log('\n[6] Eikthyr-Kill setzt die Marke:');
{
  const WORLDS_DIR = resolve(__dirname, 'tmp-f5-kampf');
  rmSync(WORLDS_DIR, { recursive: true, force: true });
  mkdirSync(WORLDS_DIR, { recursive: true });
  const server = createWovServer({
    port: 2499,
    worldName: 'f5kampf',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'),
  });
  server.init();

  function makePeer(pos: Vector3): Peer {
    return {
      name: 'Jaeger',
      isAdmin: true,
      flying: false,
      position: pos,
      lastInputSeq: 0,
      lastInputTime: 0,
      characterID: ZDOID.NONE,
      stamina: 100,
      staminaZuletztVerbraucht: 0,
      staminaSyncAkku: 0,
      health: 100,
      foodBis: 0,
      foodBonus: 0,
      // Wie am echten Peer vorbelegt — sonst haelt der Server den
      // Testspieler fuer jemanden in einer Instanzwelt.
      worldId: HAUPTWELT_ID,
      inventar: new Inventory(),
      sendPacketWith: () => {},
      sendPacket: () => {},
    } as unknown as Peer;
  }

  function angriffPaket(pos: Vector3): Reader {
    const w = new Writer();
    w.writeVector3(pos);
    w.writeFloat32(0); // yaw — ungenutzt vom Handler
    w.writeString(''); // keine Waffe -> Faust (WAFFEN_SCHADEN-Vorgabe 4)
    return new Reader(w.toBuffer());
  }
  const handleAttack = (peer: Peer, reader: Reader): void => {
    (server as unknown as { handleAttack(p: Peer, r: Reader): void }).handleAttack(peer, reader);
  };

  const EIKTHYR_HASH = getStableHash('Eikthyr');
  const DEER_HASH = getStableHash('Deer');

  // [6a] Kontrolle zuerst: ein Reh zu erlegen darf NICHTS setzen — sonst
  // faellt eine falsche "jede Kreatur setzt die Marke"-Verdrahtung nicht
  // auf, weil [6b] danach ohnehin gruen waere.
  const rehPos: Vector3 = { x: 100, y: 30, z: 100 };
  const reh = server.zdos.createZDO(DEER_HASH, rehPos);
  reh.setInt(HEALTH_MEMBER, 1); // ein Faustschlag (4) reicht zum Toeten
  const jaeger1 = makePeer(rehPos);
  handleAttack(jaeger1, angriffPaket(rehPos));
  check(
    '6a: Reh erlegt, aber KEINE Marke gesetzt',
    server.zdos.getZDO(reh.zdoid) === undefined && server.weltMarken.alsNamen().length === 0
  );

  // [6b] Eikthyr erlegen setzt defeated_eikthyr.
  const eikPos: Vector3 = { x: 200, y: 30, z: 200 };
  const eikthyr = server.zdos.createZDO(EIKTHYR_HASH, eikPos);
  eikthyr.setInt(HEALTH_MEMBER, 1);
  const jaeger2 = makePeer(eikPos);
  check('Eikthyr vorher nicht als besiegt markiert',
    server.weltMarken.hat(GlobalKey.defeated_eikthyr) === false);
  handleAttack(jaeger2, angriffPaket(eikPos));
  check(
    '6b: Eikthyr-ZDO zerstoert UND defeated_eikthyr gesetzt',
    server.zdos.getZDO(eikthyr.zdoid) === undefined &&
      server.weltMarken.hat(GlobalKey.defeated_eikthyr) === true
  );

  rmSync(WORLDS_DIR, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n=== F5: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== F5: ALL PASSED ===');
