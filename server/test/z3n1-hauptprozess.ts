/**
 * Editor E2, Karte Z3 N1 (Nachbesserung nach dem Angriff auf PR #120): die dauerhafte Löschsperre
 * überlebt einen ECHTEN Serverneustart — als echter `main.ts`-Kindprozess, nach dem Muster von
 * `server/test/stopp-speichern.ts` (`baueMainKopie`/`starteProzess`), nicht mehr als Nachbildung
 * (`bootLoeschschutzWieMain` fällt hier ganz weg).
 *
 * Aufbau je Fall: Ein Spielstand mit Zustand (Truhe mit `truheInhalt`) wird EINMALIG über einen
 * echten, in diesem Prozess laufenden Spielserver erzeugt (echte Serialisierung, kein von Hand
 * gebautes `.db.zst`) und dann gespeichert; danach übernehmen ausschließlich echte `main.ts`-
 * Kindprozesse (eigene Kopie von `server/src`, eigene `server.yml`, Port 0) jeden weiteren Schritt.
 *
 *  A1a  45 Bäume + Truhe mit Inhalt, dann `placements: []` (live, im ersten Kindprozess) →
 *       NEUSTART (zweiter Kindprozess) → Truhe und alle 45 stehen, Inhalt byte-gleich.
 *  A2   SIGKILL bzw. SIGTERM während ein Kindprozess noch bootet (vor "Server started") → danach ein
 *       normaler Start: die Sperrdatei ist unverändert stehen geblieben (sie lebt unabhängig vom
 *       Prozess, kein main.ts-Codepfad rührt sie an) und schützt weiterhin.
 *  A3   Nach dem gesperrten Neustart (A1a) eine Folgeänderung (leer + 1 neuer Baum) LIVE im selben
 *       Kindprozess, dann NOCH EIN Neustart → Truhe (mit Inhalt) UND der neue Baum stehen.
 *
 * Lauf: npx tsx test/z3n1-hauptprozess.ts   (aus server/)
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { getStableHash, LAYOUT_ID_MEMBER } from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei, type Quittung } from '@wov/shared/src/worldlayout/quittung.js';
import { loeschsperreDatei, loeschsperreLesen } from '@wov/shared/src/worldlayout/loeschsperre.js';
import { createWovServer } from '../src/WovServer.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(tmpdir(), `z3n1-hauptprozess-${process.pid}`);
rmSync(WURZEL, { recursive: true, force: true });

// ── Aufräumen auch bei einem abgebrochenen Lauf (Karte Z3 N1, Test 2: SIGTERM an die Prozessgruppe) ──
const kindPids = new Set<number>();
let aufgeraeumt = false;
function aufraeumen(): void {
  if (aufgeraeumt) return;
  aufgeraeumt = true;
  for (const pid of kindPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* schon weg */
    }
  }
  rmSync(WURZEL, { recursive: true, force: true });
}
process.on('exit', aufraeumen);
process.on('SIGTERM', () => {
  aufraeumen();
  process.exit(1);
});
process.on('SIGINT', () => {
  aufraeumen();
  process.exit(1);
});

type Platz = { id: string; prefab: string; x: number; z: number };
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
    if (code === -999) kind.kill('SIGKILL');
    kindPids.delete(kind.pid!);
    return { code: code === -999 ? null : code, ms: Date.now() - t0, ausgabe, bereitErreicht };
  };
  return { warten, stoppen };
}

interface SaveSnapshotZdo {
  members: Record<string, { t: number; v: unknown }>;
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
const BAEUME: Platz[] = Array.from({ length: 45 }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));
const KISTE: Platz = { id: 'kiste-h', prefab: 'piece_chest_wood', x: 400, z: 400 };
const DOC_VOLL = [...BAEUME, KISTE];

async function haupt(): Promise<void> {
  // WOV_INSTANZ akzeptiert nur "dev" oder "live" (instanzName() bricht sonst ab, s. shared/src/instanz.ts) —
  // "dev" ist hier unproblematisch: eigener, isolierter WURZEL-Ordner je Testlauf, kein echtes /opt/worldofvikings.
  const inst = instanz(WURZEL, 'dev');
  schreibe(inst.layoutDatei, dokument(DOC_VOLL));

  // ── Materialisierung: echte Serialisierung, in diesem Prozess (Truhe mit Inhalt) ──
  const setup = createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: inst.instanz,
    worldSeed: 'z3n1-boot',
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: inst.worldsDir,
    kontenDir: resolve(inst.server, 'data/konten'),
    worldMode: 'layout',
    worldLayoutPath: inst.layoutDatei,
    saveIntervalMs: 3600_000,
  });
  setup.start();
  const kiste = setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h');
  check('Aufbau: Truhe gefunden (46 Layout-ZDOs)', !!kiste && setup.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER)).length === 46);
  kiste?.setString('truheInhalt', '[[Wood,9]]');

  // ── A1a: placements: [] LIVE (in diesem Prozess: dieselbe layoutWache, die main.ts auch benutzt) ──
  const wache = (setup as unknown as { layoutWache: { tick(): void } }).layoutWache;
  const hashLeer = schreibe(inst.layoutDatei, dokument([]));
  wache.tick();
  const qLeer = quittungLesen(inst.quittungsPfad);
  // 46 Entfernungen liegen über AENDERUNGEN_MAX (40): Die Quittung bleibt bei ihrem alten Grund
  // zu-viele-aenderungen (E-b, "die Quittung darf ihren bisherigen Grund behalten") — genau der Fall,
  // den Angriffsbefund A1 als ungeschützt fand, weil die alte Fassung dort nie geprüft hat, ob überhaupt
  // etwas Schützenswertes wegfällt. Die Sperrdatei wird trotzdem erweitert (`loeschsperre` unten).
  check(
    'A1a live: zu-viele-aenderungen, Sperrdatei trotzdem mit 46 ids erweitert',
    qLeer?.hash === hashLeer && qLeer.grund === 'zu-viele-aenderungen' && qLeer.loeschsperre?.anzahl === 46,
    JSON.stringify(qLeer)
  );
  setup.stop(); // speichert (46 ZDOs, Truhe mit Inhalt)
  await warte(300);
  const sperreVorNeustart = loeschsperreLesen(inst.loeschsperrePfad);
  check('A1a Sperrdatei vor dem Neustart: 46 ids', sperreVorNeustart !== null && sperreVorNeustart !== 'kaputt' && sperreVorNeustart.ids.length === 46, JSON.stringify(sperreVorNeustart));

  // ── A1a: NEUSTART als echter main.ts-Kindprozess ──
  const lauf1 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit1 = await lauf1.warten();
  check('A1a Neustart: main.ts wird bereit', bereit1.bereitErreicht, bereit1.ausgabe.slice(-400));
  check(
    'A1a Neustart: Boot-Log nennt die Löschsperre mit 46 Objekten (nicht "bis zum nächsten sauberen Dokument")',
    /Löschsperre hält 46 Objekt\(e\) zurück/.test(bereit1.ausgabe) && !/bis zum nächsten sauberen Dokument/.test(bereit1.ausgabe),
    bereit1.ausgabe.split('\n').filter((z) => /Löschsperre/.test(z)).join(' | ')
  );
  const ende1 = await lauf1.stoppen('SIGTERM');
  check('A1a Neustart: main.ts endet sauber (Exit 0)', ende1.code === 0, `Code ${ende1.code}`);
  await warte(200);
  const save1 = saveLesen(inst.savePfad);
  check('A1a Neustart: alle 45 Bäume UND die Truhe stehen (46 ZDOs)', save1.size === 46, `${save1.size}`);
  const kisteNach1 = save1.get('kiste-h');
  check(
    'A1a Neustart: Truheninhalt byte-gleich',
    kisteNach1?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]',
    JSON.stringify(kisteNach1?.members[String(HASH_TRUHE_INHALT)])
  );
  const sperreNach1 = loeschsperreLesen(inst.loeschsperrePfad);
  check('A1a Neustart: Sperrdatei unverändert (46 ids, Neustart hat sie nie gelöscht)', sperreNach1 !== null && sperreNach1 !== 'kaputt' && sperreNach1.ids.length === 46, JSON.stringify(sperreNach1));

  // ── A2: SIGKILL bzw. SIGTERM WÄHREND des Boots, danach ein normaler Start ──
  //
  // "Während des Boots" heißt hier: getötet, GENAU als die Boot-Log-Zeile der Löschsperre erscheint —
  // also nicht vor jedem Code, sondern mitten in der Boot-Anwendung selbst, deutlich vor "Server
  // started" (dem allerletzten Schritt). Ein fester Timeout wäre entweder zu früh (killt, bevor der
  // Prozess überhaupt weit genug ist) oder zu spät (der Boot ist auf einer schnellen Maschine längst
  // durch); dieses Signal ist in jedem Tempo dasselbe.
  const boot_zeile = /Löschsperre hält 46 Objekt\(e\) zurück/;
  const sperreVorA2 = readFileSync(inst.loeschsperrePfad, 'utf-8');
  for (const [signal, name] of [['SIGKILL', 'kill'], ['SIGTERM', 'term']] as const) {
    const lauf = starteHauptprozess(inst, 15_000, boot_zeile);
    const zwischenstand = await lauf.warten();
    check(`A2 ${name}: Boot-Zeile der Löschsperre erreicht (mitten im Boot)`, zwischenstand.bereitErreicht, zwischenstand.ausgabe.slice(-300));
    check(`A2 ${name}: "Server started" NOCH NICHT erreicht (wirklich mitten im Boot)`, !BEREIT.test(zwischenstand.ausgabe));
    const ende = await lauf.stoppen(signal);
    check(`A2 ${name}: Kindprozess beendet`, ende.code !== null || signal === 'SIGKILL', `Code ${ende.code}`);
    const sperreDanach = readFileSync(inst.loeschsperrePfad, 'utf-8');
    check(`A2 ${name}: Sperrdatei UNVERÄNDERT (kein Codepfad in main.ts rührt sie an)`, sperreDanach === sperreVorA2);
  }
  const lauf2 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit2 = await lauf2.warten();
  check('A2 danach: ein normaler Start wird bereit', bereit2.bereitErreicht, bereit2.ausgabe.slice(-400));
  check('A2 danach: Boot-Log schützt weiterhin 46 Objekte', /Löschsperre hält 46 Objekt\(e\) zurück/.test(bereit2.ausgabe));
  const ende2 = await lauf2.stoppen('SIGTERM');
  check('A2 danach: main.ts endet sauber (Exit 0)', ende2.code === 0, `Code ${ende2.code}`);
  await warte(200);
  const save2 = saveLesen(inst.savePfad);
  check('A2 danach: immer noch alle 46 ZDOs (nichts durch die Kill-Fenster verloren)', save2.size === 46, `${save2.size}`);

  // ── A3: Folgeänderung (leer + 1 neuer Baum), dann NOCH EIN Neustart ──
  const lauf3 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit3 = await lauf3.warten();
  check('A3 Vorbereitung: Neustart bereit', bereit3.bereitErreicht, bereit3.ausgabe.slice(-400));
  const hashFolge = schreibe(inst.layoutDatei, dokument([{ id: 'neu-1', prefab: 'Beech1', x: 999, z: 999 }]));
  const qFolge = await warteAufQuittung(inst.quittungsPfad, hashFolge);
  check('A3 Folgeänderung live angewendet (normale, kleine Änderung an einem ANDEREN Objekt)', qFolge?.ergebnis === 'angewendet', JSON.stringify(qFolge));
  const sperreNachFolge = loeschsperreLesen(inst.loeschsperrePfad);
  check('A3 Sperrdatei nach der Folgeänderung unverändert (die 46 ids stehen nie wieder im Dokument)', sperreNachFolge !== null && sperreNachFolge !== 'kaputt' && sperreNachFolge.ids.length === 46, JSON.stringify(sperreNachFolge));
  const ende3 = await lauf3.stoppen('SIGTERM');
  check('A3 Vorbereitung: main.ts endet sauber (Exit 0)', ende3.code === 0, `Code ${ende3.code}`);
  await warte(200);

  const lauf4 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit4 = await lauf4.warten();
  check('A3 zweiter Neustart: bereit', bereit4.bereitErreicht, bereit4.ausgabe.slice(-400));
  const ende4 = await lauf4.stoppen('SIGTERM');
  check('A3 zweiter Neustart: main.ts endet sauber (Exit 0)', ende4.code === 0, `Code ${ende4.code}`);
  await warte(200);
  const save4 = saveLesen(inst.savePfad);
  check('A3: Truhe (mit Inhalt) UND alle 45 Bäume stehen weiterhin (46) UND der neue Baum steht (47 gesamt)', save4.size === 47, `${save4.size}: ${[...save4.keys()].sort().join(',')}`);
  check('A3: Truheninhalt weiterhin byte-gleich', save4.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]');
  check('A3: der neue Baum steht', save4.has('neu-1'));
}

try {
  await haupt();
} finally {
  aufraeumen();
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exitCode = fehler === 0 ? 0 : 1;
