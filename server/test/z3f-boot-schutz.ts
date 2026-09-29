/**
 * Karte Z3 Folgen (H1, Mikes Beschluss 29.09.): der Löschschutz greift auch beim Serverstart. Eine Weltdatei, die bei
 * GESTOPPTEM Server geschrieben wird, hat keine Live-Wache gesehen; der Boot wendet deshalb dieselbe Löschregel an
 * (alle / mehr als 25 % / Zustand / Prefab-Ersatz mit Inhalt), gegen den Bestand an Layout-ZDOs. Alles als echter
 * `main.ts`-Kindprozess (Muster `z3n1-hauptprozess.ts`): Ein Spielstand mit Truhe samt Inhalt wird einmal in diesem Prozess
 * erzeugt und gespeichert, die Weltdatei danach OFFLINE geändert, dann startet der Kindprozess.
 *
 *  LEER   offline `placements: []` (45 Bäume + Truhe) → Start: alle 46 stehen, die Sperrdatei nennt 46 ids (Grund alle),
 *         die Boot-Zeile nennt die neue Sperre, die Quittung zeigt `loeschsperre`.
 *  KLEIN  offline nur 2 von 31 Objekten entfernt (unter der Regel) → Start: die 2 sind weg, keine Sperrdatei.
 *  ZUSTAND offline die Truhe (mit Inhalt) plus 2 Bäume entfernt → Start: nur die Truhe ist gesperrt, die 2 Bäume gehen.
 *  PREFAB offline ein Prefab-Wechsel an der Truhe mit Inhalt → Start: gesperrt, die Truhe steht mit Inhalt, kein zweites ZDO.
 *  BEST   Bestätigen (Anfrage-Datei) nach ZUSTAND: genau die Truhe ist weg, die Sperrdatei auch.
 *  KILL   SIGKILL im Boot-Fenster (nach der Sperr-Zeile und sehr früh) → nichts verloren, der nächste Start hält 46 Objekte.
 *  MIGR   Spielstand von vor E1 (alte Kennungen `prefab@x,z`): der Boot stempelt um, es wird nichts gesperrt.
 *  ZWEI   zweiter Start mit vorhandener Sperre: kein "NEU", die Sperre bleibt byte-gleich.
 *
 * Karte Z3 Folgen N1 (B1/B3):
 *  R1     offline ALLE ids umbenannt (gleiches Prefab, gleiche Stelle) → Sperre, alte 46 stehen samt Truheninhalt.
 *  R2     offline nur die Truhe bekommt eine neue id → Sperre (Zustand), Inhalt da.
 *  R3     offline die Truhe 0,3 m daneben mit neuer id (Editor-Stil) → Sperre (Zustand), Inhalt da.
 *  METER  offline ein id-loser Truheneintrag über eine Meterkante geschoben (abgeleitete id ändert sich) → Sperre.
 *  ALTNAH Gegenprobe: alte Kennung `prefab@x,z` neben der Platzierung wird übernommen (keine Sperre).
 *  ANTEIL 6 von 16 Bäumen (37 %, unter 20, kein Zustand) → Sperre `anteil`; ANZAHL 21 von 100 (21 %) → Sperre.
 *  SCHREIB Sperrdatei nicht schreibbar + offline leeres Dokument → GESCHLOSSEN: alles steht, Inhalt da.
 *
 * Lauf: npx tsx test/z3f-boot-schutz.ts   (aus server/)
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { getStableHash, LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { bestaetigenAnfrageDatei, bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { loeschsperreDatei, loeschsperreLesen } from '@wov/shared/src/worldlayout/loeschsperre.js';
import { createWovServer } from '../src/WovServer.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}
/** Datei lesen; fehlt sie, kommt null (ein Stand OHNE Sperrdatei soll ein FAIL geben, keinen Absturz). */
const lies = (pfad: string): string | null => (existsSync(pfad) ? readFileSync(pfad, 'utf-8') : null);
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(tmpdir(), `z3f-boot-schutz-${process.pid}`);
rmSync(WURZEL, { recursive: true, force: true });

// ── Aufräumen auch bei einem abgebrochenen Lauf (Karte Z3 N1, Test 2: SIGTERM an die Prozessgruppe) ──
// Karte Z3 N2 (B6): Jedes Kind läuft in einer EIGENEN Prozessgruppe (`detached`), und der Aufräum-Handler beendet
// die GRUPPE, nicht nur das Kind: `main.ts` startet selbst Unterprozesse, und ein KILL nur an den tsx-Wrapper ließ
// Test-node und Kind bisher zurück. Hängt der Wrapper nicht mehr über uns (KILL an ihn: wir werden umgehängt),
// räumt der Wächter unten ebenfalls auf.
const kindPids = new Set<number>();
let aufgeraeumt = false;
function aufraeumen(): void {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  for (const pid of kindPids) {
    for (const ziel of [-pid, pid]) {
      try {
        process.kill(ziel, 'SIGKILL');
      } catch {
        /* schon weg */
      }
    }
  }
  rmSync(WURZEL, { recursive: true, force: true });
}
process.on('exit', aufraeumen);
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => {
    aufraeumen();
    process.exit(1);
  });
}
const ELTERN = process.ppid;
const waechter = setInterval(() => {
  if (process.ppid !== ELTERN) {
    aufraeumen();
    process.exit(1);
  }
}, 500);
waechter.unref();

type Platz = { id?: string; prefab: string; x: number; z: number };
function dokument(placements: Platz[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Z3N1-Hauptprozess',
    detailSeed: 'z3n1-boot',
    continents: [],
    regions: [{ id: 'heim', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }],
    defaultSpawn: [0, 0],
    placements,
  };
}
function schreibe(datei: string, d: unknown): string {
  const text = JSON.stringify(d);
  const temp = `${datei}.probe.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, datei);
  return layoutHash(text);
}

/**
 * Kopie von server/src (main.ts liest server.yml relativ zu sich selbst) mit eigener Minimal-
 * server.yml: Port 0, Layout-Modus ohne Assets/Vegetation/Kreaturen. `WOV_WELT_VERZEICHNIS` zeigt
 * direkt auf einen eigenen Ordner mit `<instanz>.json` (keine Arbeitskopie-Kopiererei nötig: die
 * Repo-Datei fehlt, `weltAbgleichen` meldet dazu nur `repo-fehlt`, nicht fatal).
 */
function baueKopie(wurzel: string): { server: string; weltenArbeit: string } {
  const server = resolve(wurzel, 'server');
  mkdirSync(resolve(server, 'data'), { recursive: true });
  cpSync(resolve(__dirname, '../src'), resolve(server, 'src'), { recursive: true });
  for (const d of ['package.json', 'tsconfig.json']) cpSync(resolve(__dirname, '..', d), resolve(server, d));
  cpSync(resolve(__dirname, '../../tsconfig.json'), resolve(wurzel, 'tsconfig.json'));
  symlinkSync(resolve(__dirname, '../../node_modules'), resolve(wurzel, 'node_modules'));
  // `seed` MUSS zum `worldSeed` der Materialisierung (createWovServer, in diesem Prozess) passen: sonst
  // hält WorldManager den Save für eine ANDERE Welt und legt ihn beim Boot als "orphan" beiseite, statt
  // ihn zu laden (harmlos gemeint, hätte hier aber unsere 46 ZDOs beim ersten echten Neustart verworfen).
  writeFileSync(
    resolve(server, 'data/server.yml'),
    'server:\n  name: probe\n  port: 0\nworld:\n  mode: layout\n  seed: z3n1-boot\n  features: false\n  vegetation: false\n  creatures: false\ndungeons:\n  enabled: false\n'
  );
  const weltenArbeit = resolve(wurzel, 'welten-arbeit');
  mkdirSync(weltenArbeit, { recursive: true });
  return { server, weltenArbeit };
}

interface Instanz {
  server: string;
  weltenArbeit: string;
  instanz: string;
  layoutDatei: string;
  worldsDir: string;
  quittungsPfad: string;
  loeschsperrePfad: string;
  savePfad: string;
}
function instanz(wurzel: string, name: string): Instanz {
  const { server, weltenArbeit } = baueKopie(wurzel);
  const worldsDir = resolve(server, 'data/worlds');
  mkdirSync(worldsDir, { recursive: true });
  return {
    server,
    weltenArbeit,
    instanz: name,
    layoutDatei: resolve(weltenArbeit, `${name}.json`),
    worldsDir,
    quittungsPfad: quittungsDatei(worldsDir, name),
    loeschsperrePfad: loeschsperreDatei(worldsDir, name),
    savePfad: resolve(worldsDir, `${name}.db.zst`),
  };
}

interface Lauf {
  code: number | null;
  ms: number;
  ausgabe: string;
  bereitErreicht: boolean;
}
/**
 * Startet `node --import tsx src/main.ts` als echten Kindprozess (nicht die tsx-CLI, s.
 * `stopp-speichern.ts`). `bereit`: Regex fürs Log, das den Boot als abgeschlossen markiert; ohne
 * Treffer (z. B. weil `warteMs` absichtlich kurz ist, um während des Boots zu töten) läuft der
 * Prozess einfach weiter, bis `stoppen()` ihn beendet.
 */
function starteHauptprozess(inst: Instanz, warteMs: number, bereit: RegExp): { warten: () => Promise<Lauf>; stoppen: (signal?: NodeJS.Signals) => Promise<Lauf> } {
  const t0 = Date.now();
  let ausgabe = '';
  let bereitErreicht = false;
  let aufloesenBereit: (() => void) | null = null;
  const kind = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: inst.server,
    detached: true, // eigene Prozessgruppe (B6): `aufraeumen()` beendet sie als Ganzes
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WOV_INSTANZ: inst.instanz, WOV_WELT_VERZEICHNIS: inst.weltenArbeit },
  });
  kindPids.add(kind.pid!);
  const beiDaten = (d: Buffer): void => {
    ausgabe += d.toString();
    if (!bereitErreicht && bereit.test(ausgabe)) {
      bereitErreicht = true;
      aufloesenBereit?.();
    }
  };
  kind.stdout!.on('data', beiDaten);
  kind.stderr!.on('data', beiDaten);
  const beendet = new Promise<number | null>((r) => kind.once('exit', (c) => r(c)));

  const warten = (): Promise<Lauf> =>
    new Promise((res) => {
      if (bereitErreicht) return res({ code: null, ms: Date.now() - t0, ausgabe, bereitErreicht });
      const zeit = setTimeout(() => res({ code: null, ms: Date.now() - t0, ausgabe, bereitErreicht }), warteMs);
      aufloesenBereit = () => {
        clearTimeout(zeit);
        res({ code: null, ms: Date.now() - t0, ausgabe, bereitErreicht });
      };
    });

  const stoppen = async (signal: NodeJS.Signals = 'SIGTERM'): Promise<Lauf> => {
    kind.kill(signal);
    const code = await Promise.race([beendet, warte(10_000).then(() => -999)]);
    if (code === -999) {
      try {
        process.kill(-kind.pid!, 'SIGKILL');
      } catch {
        kind.kill('SIGKILL');
      }
    }
    kindPids.delete(kind.pid!);
    return { code: code === -999 ? null : code, ms: Date.now() - t0, ausgabe, bereitErreicht };
  };
  return { warten, stoppen };
}

interface SaveSnapshotZdo {
  prefab?: number;
  members: Record<string, { t: number; v: unknown }>;
}
/** Alle Layout-ZDOs des Spielstands als Liste (mehrere unter derselben id bleiben sichtbar, anders als bei `saveLesen`). */
function saveListe(pfad: string): { id: string; prefab: number | undefined; z: SaveSnapshotZdo }[] {
  const daten = JSON.parse(zstdDecompressSync(readFileSync(pfad)).toString('utf-8')) as { zdos: SaveSnapshotZdo[] };
  const out: { id: string; prefab: number | undefined; z: SaveSnapshotZdo }[] = [];
  for (const z of daten.zdos) {
    const id = z.members[String(getStableHash(LAYOUT_ID_MEMBER))]?.v;
    if (typeof id === 'string') out.push({ id, prefab: z.prefab, z });
  }
  return out;
}
const HASH_LAYOUT_ID = getStableHash(LAYOUT_ID_MEMBER);
const HASH_TRUHE_INHALT = getStableHash('truheInhalt');
function saveLesen(pfad: string): Map<string, SaveSnapshotZdo> {
  const daten = JSON.parse(zstdDecompressSync(readFileSync(pfad)).toString('utf-8')) as { zdos: SaveSnapshotZdo[] };
  const out = new Map<string, SaveSnapshotZdo>();
  for (const z of daten.zdos) {
    const id = z.members[String(HASH_LAYOUT_ID)]?.v;
    if (typeof id === 'string') out.set(id, z);
  }
  return out;
}

async function warteAufQuittung(pfad: string, hash: string, ms = 8000): Promise<Quittung | null> {
  const t0 = Date.now();
  for (;;) {
    const q = quittungLesen(pfad);
    if (q?.hash === hash) return q;
    if (Date.now() - t0 > ms) return null;
    await warte(50);
  }
}

const BEREIT = /Server started/;
const KISTE: Platz = { id: 'kiste-h', prefab: 'piece_chest_wood', x: 400, z: 400 };


/** Ein Spielstand im Dokument-Aufbau: erst in DIESEM Prozess (echte Serialisierung), danach übernehmen Kindprozesse. */
function materialisiere(inst: Instanz, seed: string): ReturnType<typeof createWovServer> {
  const setup = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: inst.instanz,
    worldSeed: seed,
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: inst.worldsDir,
    kontenDir: resolve(inst.server, 'data/konten'),
    worldMode: 'layout',
    worldLayoutPath: inst.layoutDatei,
    saveIntervalMs: 3600_000,
  });
  setup.start();
  return setup;
}
/** `seed` in der server.yml der Kopie ist fest `z3n1-boot`; die anderen Fälle benutzen denselben Seed. */
const SEED = 'z3n1-boot';
async function warteBis(bed: () => boolean, ms = 10_000): Promise<boolean> {
  const t0 = Date.now();
  while (!bed()) {
    if (Date.now() - t0 > ms) return false;
    await warte(50);
  }
  return true;
}


const HASH_TRUHE = HASH_TRUHE_INHALT;
const nurSperre = (inst: Instanz): { ids: string[]; grund: string } | null => {
  const s = loeschsperreLesen(inst.loeschsperrePfad);
  return s === null || s === 'kaputt' ? null : { ids: [...s.ids].sort(), grund: s.grund };
};
/** Spielstand aus `platz` erzeugen (Truhe bekommt Inhalt), speichern und den Server stoppen. */
async function erzeuge(inst: Instanz, platz: Platz[], vorSpeichern?: (setup: ReturnType<typeof createWovServer>) => void, truheId = 'kiste-h'): Promise<void> {
  schreibe(inst.layoutDatei, dokument(platz));
  const setup = materialisiere(inst, SEED);
  setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === truheId)?.setString('truheInhalt', '[[Wood,9]]');
  vorSpeichern?.(setup);
  setup.stop();
  await warte(300);
}
const baeume = (n: number): Platz[] => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));

async function leer(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'leer'), 'dev');
  await erzeuge(inst, [...baeume(45), KISTE]);
  const hash = schreibe(inst.layoutDatei, dokument([])); // OFFLINE: der Server läuft nicht
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('LEER Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  check('LEER Boot-Zeile nennt die NEUE Sperre mit 46 Objekten und den Hinweis auf Bestätigen', /Löschsperre NEU — die Weltdatei löscht 46 Objekt/.test(bereit.ausgabe) && /bestaetigen/.test(bereit.ausgabe), bereit.ausgabe.split('\n').filter((z) => /Löschsperre/.test(z)).join(' | ').slice(0, 300));
  const q = await warteAufQuittung(inst.quittungsPfad, hash);
  check('LEER Quittung zeigt loeschsperre (46)', q?.loeschsperre?.anzahl === 46, JSON.stringify(q));
  const ende = await lauf.stoppen('SIGTERM');
  check('LEER Exit 0', ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('LEER alle 46 ZDOs stehen, Truheninhalt byte-gleich', save.size === 46 && save.get('kiste-h')?.members[String(HASH_TRUHE)]?.v === '[[Wood,9]]', `${save.size}`);
  const sp = nurSperre(inst);
  check('LEER Sperrdatei: 46 ids, Grund alle', sp?.ids.length === 46 && sp.grund === 'alle', JSON.stringify(sp)?.slice(0, 120));
  // ZWEI: zweiter Start, die Sperre gilt ohne neue Regelauslösung
  const vorher = lies(inst.loeschsperrePfad);
  const lauf2 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit2 = await lauf2.warten();
  check('ZWEI zweiter Start: Sperre hält 46, keine NEUE Sperre', /Löschsperre hält 46 Objekt/.test(bereit2.ausgabe) && !/Löschsperre NEU/.test(bereit2.ausgabe), bereit2.ausgabe.slice(-200));
  await lauf2.stoppen('SIGTERM');
  await warte(200);
  check('ZWEI Sperrdatei byte-gleich, 46 ZDOs', lies(inst.loeschsperrePfad) === vorher && saveLesen(inst.savePfad).size === 46);
}

async function klein(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'klein'), 'dev');
  await erzeuge(inst, [...baeume(30), KISTE]);
  schreibe(inst.layoutDatei, dokument([...baeume(30).slice(2), KISTE])); // b0, b1 fehlen: 2 von 31, unter der Regel
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('KLEIN Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  check('KLEIN keine neue Sperre in der Boot-Zeile', !/Löschsperre NEU/.test(bereit.ausgabe));
  const ende = await lauf.stoppen('SIGTERM');
  check('KLEIN Exit 0', ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('KLEIN die 2 fehlenden sind gelöscht, 28 Bäume + Truhe stehen (29)', save.size === 29 && !save.has('b0') && !save.has('b1') && save.has('kiste-h'), `${save.size}`);
  check('KLEIN keine Sperrdatei', !existsSync(inst.loeschsperrePfad));
}

async function zustandUndBestaetigen(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'zustand'), 'dev');
  await erzeuge(inst, [...baeume(30), KISTE]);
  const hash = schreibe(inst.layoutDatei, dokument(baeume(30).slice(2))); // Truhe + b0 + b1 fehlen
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('ZUSTAND Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  const q0 = await warteAufQuittung(inst.quittungsPfad, hash);
  check('ZUSTAND Quittung zeigt genau 1 gesperrtes Objekt', q0?.loeschsperre?.anzahl === 1, JSON.stringify(q0));
  const sp = nurSperre(inst);
  check('ZUSTAND Sperrdatei: nur die Truhe, Grund zustand', sp?.ids.join() === 'kiste-h' && sp.grund === 'zustand', JSON.stringify(sp));
  // BEST: Bestätigen löscht genau diese id
  const id = bestaetigenAnfrageSchreiben(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz), hash);
  const erkannt = await warteBis(() => quittungLesen(inst.quittungsPfad)?.bestaetigung?.id === id);
  const q1 = quittungLesen(inst.quittungsPfad);
  check('BEST Quittung nennt die Anfrage, 1 entfernt', erkannt && q1?.bestaetigung?.entfernt === 1, JSON.stringify(q1));
  check('BEST Sperrdatei und Anfrage sind weg', !existsSync(inst.loeschsperrePfad) && !existsSync(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz)));
  const ende = await lauf.stoppen('SIGTERM');
  check('BEST Exit 0', ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('ZUSTAND/BEST danach: Truhe, b0 und b1 sind weg, die 28 anderen Bäume stehen', save.size === 28 && !save.has('kiste-h') && !save.has('b0') && !save.has('b1'), `${save.size}`);
}

async function prefabWechsel(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'prefab'), 'dev');
  await erzeuge(inst, [...baeume(10), KISTE]);
  const hash = schreibe(inst.layoutDatei, dokument([...baeume(10), { ...KISTE, prefab: 'Beech1' }]));
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('PREFAB Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  const q = await warteAufQuittung(inst.quittungsPfad, hash);
  check('PREFAB Quittung zeigt die Sperre (1)', q?.loeschsperre?.anzahl === 1, JSON.stringify(q));
  const ende = await lauf.stoppen('SIGTERM');
  check('PREFAB Exit 0', ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  const liste = saveListe(inst.savePfad).filter((z) => z.id === 'kiste-h');
  check('PREFAB Truhe steht mit Inhalt, genau ein ZDO unter der id', liste.length === 1 && liste[0].z.members[String(HASH_TRUHE)]?.v === '[[Wood,9]]', JSON.stringify(liste.map((z) => z.prefab)));
  check('PREFAB Sperrdatei nennt die Truhe (Zustand)', nurSperre(inst)?.ids.join() === 'kiste-h');
}

async function killFenster(): Promise<void> {
  for (const [name, zeile, signal] of [['nach der Sperr-Zeile', /Löschsperre NEU/, 'SIGKILL'], ['sehr früh', /WorldLayout/, 'SIGKILL']] as const) {
    const inst = instanz(resolve(WURZEL, `kill-${name.replace(/\W/g, '')}`), 'dev');
    await erzeuge(inst, [...baeume(45), KISTE]);
    schreibe(inst.layoutDatei, dokument([]));
    const lauf = starteHauptprozess(inst, 15_000, zeile);
    const zwischen = await lauf.warten();
    check(`KILL ${name}: Zeile erreicht`, zwischen.bereitErreicht, zwischen.ausgabe.slice(-200));
    const ende = await lauf.stoppen(signal);
    check(`KILL ${name}: "Server started" nie erreicht`, !BEREIT.test(ende.ausgabe));
    const nach = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await nach.warten();
    check(`KILL ${name}: Nachstart wird bereit`, bereit.bereitErreicht, bereit.ausgabe.slice(-200));
    await nach.stoppen('SIGTERM');
    await warte(200);
    const save = saveLesen(inst.savePfad);
    check(`KILL ${name}: nach dem Nachstart stehen alle 46, Inhalt byte-gleich`, save.size === 46 && save.get('kiste-h')?.members[String(HASH_TRUHE)]?.v === '[[Wood,9]]', `${save.size}`);
    check(`KILL ${name}: Sperrdatei nennt 46 ids`, nurSperre(inst)?.ids.length === 46);
  }
}

async function migration(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'migr'), 'dev');
  await erzeuge(inst, [...baeume(20), KISTE], (setup) => {
    // Spielstand von vor E1: die layoutId ist die alte Kennung `prefab@x,z`.
    for (const z of setup.zdos.getAllZDOs()) {
      const id = z.getString(LAYOUT_ID_MEMBER);
      const p = [...baeume(20), KISTE].find((q) => q.id === id);
      if (p) z.setString(LAYOUT_ID_MEMBER, `${p.prefab}@${Math.round(p.x)},${Math.round(p.z)}`);
    }
  });
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('MIGR Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  check('MIGR keine Sperre (alte Kennungen sind keine Löschung)', !/Löschsperre NEU/.test(bereit.ausgabe));
  await lauf.stoppen('SIGTERM');
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('MIGR alle 21 ZDOs stehen unter ihren neuen ids, keine Sperrdatei', save.size === 21 && save.has('kiste-h') && !existsSync(inst.loeschsperrePfad), `${save.size}`);
}

/** Offline geänderte Weltdatei → Start; liefert Sperre, Save und Boot-Ausgabe (Karte Z3 Folgen N1). */
async function offlineFall(name: string, alt: Platz[], neu: Platz[], truheId = 'kiste-h'): Promise<{ inst: Instanz; ausgabe: string; save: Map<string, SaveSnapshotZdo> }> {
  const inst = instanz(resolve(WURZEL, name), 'dev');
  await erzeuge(inst, alt, undefined, truheId);
  schreibe(inst.layoutDatei, dokument(neu));
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check(`${name} Start wird bereit`, bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  const ende = await lauf.stoppen('SIGTERM');
  check(`${name} Exit 0`, ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  return { inst, ausgabe: bereit.ausgabe, save: saveLesen(inst.savePfad) };
}
const inhaltDa = (save: Map<string, SaveSnapshotZdo>, id: string): boolean => save.get(id)?.members[String(HASH_TRUHE)]?.v === '[[Wood,9]]';

/** B1: dieselbe Stelle, neue id → der Boot zerstört das alte ZDO samt Inhalt: das ist eine Löschung und braucht die Sperre. */
async function r1(): Promise<void> {
  const alt = [...baeume(45), KISTE];
  const { inst, save } = await offlineFall('R1', alt, alt.map((p) => ({ ...p, id: `n-${p.id}` })));
  const sp = nurSperre(inst);
  check('R1 Sperre nennt alle 46 alten ids', sp?.ids.length === 46 && sp.ids.includes('kiste-h') && sp.ids.includes('b0'), JSON.stringify(sp)?.slice(0, 120));
  check('R1 die alte Truhe steht mit Inhalt, die neue ist leer', inhaltDa(save, 'kiste-h') && !inhaltDa(save, 'n-kiste-h') && save.has('n-kiste-h'), `${save.size}`);
  check('R1 alle 46 alten ZDOs stehen', alt.every((p) => save.has(p.id!)));
}
async function r2(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'R2'), 'dev');
  await erzeuge(inst, [...baeume(20), KISTE]);
  const hash = schreibe(inst.layoutDatei, dokument([...baeume(20), { ...KISTE, id: 'kiste-neu' }]));
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('R2 Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  const q0 = await warteAufQuittung(inst.quittungsPfad, hash);
  check('R2 Quittung zeigt genau 1 gesperrtes Objekt', q0?.loeschsperre?.anzahl === 1, JSON.stringify(q0));
  const sp = nurSperre(inst);
  check('R2 Sperre nennt genau die alte Truhe (Zustand)', sp?.ids.join() === 'kiste-h' && sp.grund === 'zustand', JSON.stringify(sp));
  // Erst nach dem Bestätigen gilt das alte Ergebnis: die alte Truhe ist weg, die neue bleibt leer.
  const id = bestaetigenAnfrageSchreiben(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz), hash);
  const erkannt = await warteBis(() => quittungLesen(inst.quittungsPfad)?.bestaetigung?.id === id);
  check('R2 Bestätigen: 1 entfernt, Sperrdatei weg', erkannt && quittungLesen(inst.quittungsPfad)?.bestaetigung?.entfernt === 1 && !existsSync(inst.loeschsperrePfad));
  await lauf.stoppen('SIGTERM');
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('R2 nach dem Bestätigen: alte Truhe weg, neue Truhe leer, 20 Bäume', !save.has('kiste-h') && save.has('kiste-neu') && !inhaltDa(save, 'kiste-neu') && save.size === 21, `${save.size}`);
}
async function r3(): Promise<void> {
  const alt = [...baeume(20), KISTE];
  const { inst, save } = await offlineFall('R3', alt, [...baeume(20), { ...KISTE, id: 'kiste-neu', x: KISTE.x + 0.3 }]);
  const sp = nurSperre(inst);
  check('R3 Sperre nennt die alte Truhe (0,3 m daneben, neue id)', sp?.ids.join() === 'kiste-h' && sp.grund === 'zustand', JSON.stringify(sp));
  check('R3 alte Truhe mit Inhalt steht', inhaltDa(save, 'kiste-h'));
}
/** Ein Eintrag OHNE id: die abgeleitete id (`prefab_x_z`, gerundet) ändert sich über die Meterkante hinweg. */
async function meterkante(): Promise<void> {
  const ohne = (x: number): Platz => ({ prefab: KISTE.prefab, x, z: KISTE.z });
  const altId = 'piece-chest-wood_400_400';
  const { inst, save } = await offlineFall('METER', [...baeume(20), ohne(400.4)], [...baeume(20), ohne(400.6)], altId);
  const sp = nurSperre(inst);
  check('METER Sperre nennt die alte abgeleitete id', sp?.ids.join() === altId && sp.grund === 'zustand', JSON.stringify(sp));
  check('METER die Truhe mit Inhalt steht', inhaltDa(save, altId));
}
/** Gegenprobe: Ein ZDO mit ALTER Kennung neben der Platzierung ist Migration, keine Löschung. */
async function altNah(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'altnah'), 'dev');
  await erzeuge(inst, [...baeume(20), KISTE], (setup) => {
    for (const z of setup.zdos.getAllZDOs()) if (z.getString(LAYOUT_ID_MEMBER) === 'kiste-h') z.setString(LAYOUT_ID_MEMBER, 'piece_chest_wood@400,400');
  });
  schreibe(inst.layoutDatei, dokument([...baeume(20), { ...KISTE, id: 'kiste-neu', x: KISTE.x + 0.3 }]));
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('ALTNAH Start wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  await lauf.stoppen('SIGTERM');
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('ALTNAH keine Sperre, die Truhe wird übernommen (Inhalt unter der neuen id)', !existsSync(inst.loeschsperrePfad) && inhaltDa(save, 'kiste-neu') && !save.has('kiste-h'));
}
/** B3: die Zweige „Anteil“ und „mehr als 20“ der Boot-Regel einzeln (ohne Zustand, ohne „alle“). */
async function anteil(): Promise<void> {
  const { inst, save } = await offlineFall('ANTEIL', baeume(16), baeume(16).slice(6));
  const sp = nurSperre(inst);
  check('ANTEIL 6 von 16 (37 %, unter 20, ohne Zustand): Sperre Grund anteil', sp?.ids.length === 6 && sp.grund === 'anteil', JSON.stringify(sp));
  check('ANTEIL alle 16 Bäume stehen', save.size === 16, `${save.size}`);
}
async function anzahl20(): Promise<void> {
  const { inst, save } = await offlineFall('ANZAHL', baeume(100), baeume(100).slice(21));
  const sp = nurSperre(inst);
  check('ANZAHL 21 von 100 (21 %, unter dem Anteil): Sperre', sp?.ids.length === 21 && sp.grund === 'anteil', JSON.stringify(sp)?.slice(0, 100));
  check('ANZAHL alle 100 Bäume stehen', save.size === 100, `${save.size}`);
}
/** B3 (W1 des Angriffs): Sperrdatei nicht schreibbar → GESCHLOSSEN. In-process, weil der Temp-Pfad die PID des Bootenden trägt. */
async function schreibFehler(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'schreib'), 'dev');
  await erzeuge(inst, [...baeume(10), KISTE]);
  mkdirSync(`${inst.loeschsperrePfad}.${process.pid}.tmp/x`, { recursive: true }); // der Schreibweg der Sperre scheitert
  schreibe(inst.layoutDatei, dokument([]));
  const log: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => void log.push(a.map(String).join(' '));
  let s2: ReturnType<typeof createWovServer> | null = null;
  try {
    s2 = materialisiere(inst, SEED);
  } finally {
    Object.assign(console, orig);
  }
  const zdos = s2.zdos.getAllZDOs().filter((z) => !!z.getString(LAYOUT_ID_MEMBER));
  const truhe = zdos.find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h');
  check('SCHREIB Sperrdatei nicht schreibbar: alle 11 stehen (geschlossen)', zdos.length === 11, `${zdos.length}`);
  check('SCHREIB Truheninhalt da', truhe?.getString('truheInhalt') === '[[Wood,9]]');
  check('SCHREIB Fehlerzeile „nicht gespeichert“', log.some((l) => /Löschsperre nicht gespeichert/.test(l)), log.filter((l) => /Löschsperre/.test(l)).join(' | ').slice(0, 200));
  s2.stop();
  await warte(300);
}

try {
  for (const [name, fall] of [
    ['LEER/ZWEI', leer],
    ['KLEIN', klein],
    ['ZUSTAND/BEST', zustandUndBestaetigen],
    ['PREFAB', prefabWechsel],
    ['KILL', killFenster],
    ['MIGR', migration],
    ['R1', r1],
    ['R2', r2],
    ['R3', r3],
    ['METER', meterkante],
    ['ALTNAH', altNah],
    ['ANTEIL', anteil],
    ['ANZAHL', anzahl20],
    ['SCHREIB', schreibFehler],
  ] as const) {
    try {
      await fall();
    } catch (e) {
      check(`${name}: Fall lief ohne Absturz durch`, false, (e as Error).message.split('\n')[0]);
    }
  }
} finally {
  aufraeumen();
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exitCode = fehler === 0 ? 0 : 1;
