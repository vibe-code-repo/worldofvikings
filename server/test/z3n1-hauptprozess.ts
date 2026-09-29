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
 *  A1b  30 Bäume + Truhe, dann 11 neue und die 31 alten fehlend (über AENDERUNGEN_MAX) → NEUSTART → die
 *       11 neuen stehen, die Truhe (byte-gleich) und alle 30 alten auch.
 *  A1c  leer plus geänderte Region (Geo) → NEUSTART → Truhe steht.
 *  A2k  kaputte Sperrdatei → echter Start löscht NICHTS, Logzeile GESCHLOSSEN, Datei unverändert.
 *  BEST Bestätigen im echten Kindprozess: Quittung nennt die Sperre schon nach dem Start (Boot-Quittung), die
 *       Anfrage wird an ihrer Kennung erkannt, danach ist genau die Truhe weg, ein vorher gefällter Baum bleibt
 *       gefällt, die Sperrdatei ist weg.
 *  RUE  Rücknahme im echten Kindprozess: die Truhe wieder ins Dokument → Sperrdatei weg, Truhe steht.
 *
 *  PKAPUTT/PZWEI (Z3 N3, C1) Prefab-Wechsel + kaputte Sperrdatei beim Boot (kein zweites ZDO, nach der Reparatur bleibt die Truhe)
 *  PREFAB (Z3 N2, B1) Prefab-Wechsel an einer Truhe mit Inhalt (dieselbe id, anderes Prefab): live zurückgehalten UND
 *       gesperrt → NEUSTART (echter Kindprozess) → die Truhe steht mit Inhalt, kein zweites ZDO unter der id →
 *       Folgeänderung an einem anderen Objekt läuft → Bestätigen wirkt (Truhe weg, Beech1 entsteht, Sperre weg).
 *
 * Lauf: npx tsx test/z3n1-hauptprozess.ts   (aus server/)
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
const WURZEL = resolve(tmpdir(), `z3n1-hauptprozess-${process.pid}`);
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
const BAEUME: Platz[] = Array.from({ length: 45 }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));
const KISTE: Platz = { id: 'kiste-h', prefab: 'piece_chest_wood', x: 400, z: 400 };
const DOC_VOLL = [...BAEUME, KISTE];

async function a1aA2A3(): Promise<void> {
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
  const sperreVorA2 = lies(inst.loeschsperrePfad);
  for (const [signal, name] of [['SIGKILL', 'kill'], ['SIGTERM', 'term']] as const) {
    const lauf = starteHauptprozess(inst, 15_000, boot_zeile);
    const zwischenstand = await lauf.warten();
    check(`A2 ${name}: Boot-Zeile der Löschsperre erreicht (mitten im Boot)`, zwischenstand.bereitErreicht, zwischenstand.ausgabe.slice(-300));
    const ende = await lauf.stoppen(signal);
    // Nach dem Signal geprüft (nicht nur davor): Erst die Ausgabe BIS zum Tod des Prozesses beweist, dass er
    // das Boot-Fenster wirklich nie verlassen hat.
    // SIGKILL beendet den Prozess auf der Stelle: Erst seine Gesamtausgabe beweist, dass er das Boot-Fenster nie
    // verlassen hat. SIGTERM handhabt main.ts geordnet (zu Ende booten, dann sauber stoppen, Exit 0), dort ist „Server
    // started“ nach dem Signal erlaubt; für ihn zählen Sperrdatei und Nachstart.
    if (signal === 'SIGKILL') check(`A2 ${name}: "Server started" wurde NIE erreicht (das Signal fiel wirklich in den Boot)`, !BEREIT.test(ende.ausgabe), ende.ausgabe.slice(-200));
    check(`A2 ${name}: Kindprozess beendet`, ende.code !== null || signal === 'SIGKILL', `Code ${ende.code}`);
    const sperreDanach = lies(inst.loeschsperrePfad);
    check(`A2 ${name}: Sperrdatei UNVERÄNDERT (kein Codepfad in main.ts rührt sie an)`, sperreDanach === sperreVorA2);
    // Je Signal ein EIGENER normaler Nachstart.
    const nach = starteHauptprozess(inst, 20_000, BEREIT);
    const bereitNach = await nach.warten();
    check(`A2 ${name}: normaler Nachstart wird bereit und schützt weiter 46 Objekte`, bereitNach.bereitErreicht && /Löschsperre hält 46 Objekt\(e\) zurück/.test(bereitNach.ausgabe), bereitNach.ausgabe.slice(-300));
    const endeNach = await nach.stoppen('SIGTERM');
    check(`A2 ${name}: Nachstart endet sauber (Exit 0)`, endeNach.code === 0, `Code ${endeNach.code}`);
    await warte(200);
    const saveNach = saveLesen(inst.savePfad);
    check(`A2 ${name}: nach dem Nachstart alle 46 ZDOs, Truhe byte-gleich`, saveNach.size === 46 && saveNach.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]', `${saveNach.size}`);
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
function wacheVon(server: ReturnType<typeof createWovServer>): { tick(): void } {
  return (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
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

async function a1bA1c(): Promise<void> {
  // ── A1b: 30 Bäume + Truhe, dann 11 neue und die 31 alten fehlend (42 Änderungen > AENDERUNGEN_MAX) ──
  {
    const inst = instanz(resolve(WURZEL, 'a1b'), 'dev');
    const alt: Platz[] = [...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 })), KISTE];
    schreibe(inst.layoutDatei, dokument(alt));
    const setup = materialisiere(inst, SEED);
    setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h')?.setString('truheInhalt', '[[Wood,9]]');
    const neu: Platz[] = Array.from({ length: 11 }, (_, i) => ({ id: `n${i}`, prefab: 'Beech1', x: 500 + i * 3, z: 20 }));
    schreibe(inst.layoutDatei, dokument(neu));
    wacheVon(setup).tick();
    const q = quittungLesen(inst.quittungsPfad);
    check('A1b live: zu-viele-aenderungen, Sperre mit 31 ids', q?.grund === 'zu-viele-aenderungen' && q.loeschsperre?.anzahl === 31, JSON.stringify(q));
    setup.stop();
    await warte(300);
    const lauf = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await lauf.warten();
    check('A1b Neustart: main.ts wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
    const ende = await lauf.stoppen('SIGTERM');
    check('A1b Neustart: Exit 0', ende.code === 0, `Code ${ende.code}`);
    await warte(200);
    const save = saveLesen(inst.savePfad);
    check('A1b Neustart: die 11 neuen stehen', Array.from({ length: 11 }, (_, i) => `n${i}`).every((id) => save.has(id)), [...save.keys()].sort().join(','));
    check('A1b Neustart: die 30 alten Bäume und die Truhe stehen (31 alte + 11 neue = 42)', save.size === 42 && save.has('kiste-h') && save.has('t0') && save.has('t29'), `${save.size}`);
    check('A1b Neustart: Truheninhalt byte-gleich', save.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]');
  }
  // ── A1c: leer plus geänderte Region ──
  {
    const inst = instanz(resolve(WURZEL, 'a1c'), 'dev');
    const alt: Platz[] = [...Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 })), KISTE];
    schreibe(inst.layoutDatei, dokument(alt));
    const setup = materialisiere(inst, SEED);
    setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h')?.setString('truheInhalt', '[[Wood,9]]');
    const geaendert = dokument([]);
    (geaendert.regions as { baseLevel: number }[])[0]!.baseLevel = 0.35;
    schreibe(inst.layoutDatei, geaendert);
    wacheVon(setup).tick();
    const q = quittungLesen(inst.quittungsPfad);
    check('A1c live: geo, Sperre mit 7 ids', q?.grund === 'geo' && q.loeschsperre?.anzahl === 7, JSON.stringify(q));
    setup.stop();
    await warte(300);
    const lauf = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await lauf.warten();
    check('A1c Neustart: main.ts wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
    const ende = await lauf.stoppen('SIGTERM');
    check('A1c Neustart: Exit 0', ende.code === 0, `Code ${ende.code}`);
    await warte(200);
    const save = saveLesen(inst.savePfad);
    check('A1c Neustart: die Truhe steht (byte-gleich) samt allen 7', save.size === 7 && save.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]', `${save.size}`);
  }
}

async function kaputteSperre(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'kaputt'), 'dev');
  schreibe(inst.layoutDatei, dokument([...Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 })), KISTE]));
  const setup = materialisiere(inst, SEED);
  setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h')?.setString('truheInhalt', '[[Wood,9]]');
  setup.stop();
  await warte(300);
  // Das Dokument verlangt jetzt eine harmlose Änderung: 5 Bäume fehlen (Grenze: 20 bzw. 25 % ab 5 → würde gesperrt),
  // dazu liegt eine kaputte Sperrdatei. Der echte Start darf nichts löschen.
  schreibe(inst.layoutDatei, dokument([]));
  writeFileSync(inst.loeschsperrePfad, '{kaputt');
  const lauf = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit = await lauf.warten();
  check('A2k kaputte Sperrdatei: main.ts wird bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
  check('A2k Logzeile GESCHLOSSEN vorhanden', /GESCHLOSSEN/.test(bereit.ausgabe), bereit.ausgabe.split('\n').filter((z) => /Löschsperre/.test(z)).join(' | ').slice(0, 300));
  const ende = await lauf.stoppen('SIGTERM');
  check('A2k Exit 0', ende.code === 0, `Code ${ende.code}`);
  await warte(200);
  const save = saveLesen(inst.savePfad);
  check('A2k nichts gelöscht: 6 ZDOs, Truhe byte-gleich', save.size === 6 && save.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]', `${save.size}`);
  check('A2k die kaputte Datei ist unverändert (nicht überschrieben, nicht gelöscht)', lies(inst.loeschsperrePfad) === '{kaputt');
}

/** Ein Spielstand mit gefälltem Baum t3 und Truhe mit Inhalt, Dokument ohne Truhe → Sperre [kiste-h]. */
function sperreMitGefaelltemBaum(inst: Instanz): { hash: string; bauStand: Platz[] } {
  const baeume: Platz[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));
  schreibe(inst.layoutDatei, dokument([...baeume, KISTE]));
  const setup = materialisiere(inst, SEED);
  const kiste = setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h');
  kiste?.setString('truheInhalt', '[[Wood,9]]');
  const b3 = setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'b3');
  if (b3) setup.zdos.destroyZDO(b3.zdoid); // gefällt: kein Objekt, der Eintrag bleibt im Dokument
  const hash = schreibe(inst.layoutDatei, dokument(baeume)); // b3 bleibt im Dokument, nur die Truhe fehlt
  wacheVon(setup).tick();
  check('BEST Aufbau: Sperre mit genau der Truhe', ((): boolean => {
    const sp = loeschsperreLesen(inst.loeschsperrePfad);
    return sp !== null && sp !== 'kaputt' && sp.ids.join() === 'kiste-h';
  })());
  setup.stop();
  return { hash, bauStand: baeume };
}

async function bestaetigenUndRuecknahme(): Promise<void> {
  // ── Bestätigen ──
  {
    const inst = instanz(resolve(WURZEL, 'bestaetigen'), 'dev');
    const { hash } = sperreMitGefaelltemBaum(inst);
    await warte(300);
    const lauf = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await lauf.warten();
    check('BEST Start mit Sperre: bereit, Boot-Log nennt die Sperre', bereit.bereitErreicht && /Löschsperre hält 1 Objekt/.test(bereit.ausgabe), bereit.ausgabe.slice(-200));
    const q0 = await warteAufQuittung(inst.quittungsPfad, hash);
    check('BEST nach dem Start: Quittung angewendet, NENNT die offene Sperre (1 id) und keine Bestätigung', q0?.ergebnis === 'angewendet' && q0.loeschsperre?.anzahl === 1 && !q0.bestaetigung, JSON.stringify(q0));
    const id = bestaetigenAnfrageSchreiben(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz), hash);
    const erkannt = await warteBis(() => quittungLesen(inst.quittungsPfad)?.bestaetigung?.id === id);
    const q1 = quittungLesen(inst.quittungsPfad);
    check('BEST Quittung nennt die Kennung der Anfrage, 1 entfernt', erkannt && q1?.bestaetigung?.entfernt === 1, JSON.stringify(q1));
    check('BEST Anfrage verbraucht, Sperrdatei weg', !existsSync(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz)) && !existsSync(inst.loeschsperrePfad));
    const ende = await lauf.stoppen('SIGTERM');
    check('BEST Exit 0', ende.code === 0, `Code ${ende.code}`);
    await warte(200);
    const save = saveLesen(inst.savePfad);
    // (Der Start davor hat b3 wie jeder Boot neu gesetzt: „gefällt bleibt gefällt“ gilt nur live und steht in
    // z3n1-abschluss.ts F7. Hier zählt: genau die Truhe ist weg, kein Baum ging verloren.)
    check('BEST danach: genau die Truhe ist weg, alle 10 Bäume stehen', !save.has('kiste-h') && save.size === 10, [...save.keys()].sort().join(','));
  }
  // ── Rücknahme ──
  {
    const inst = instanz(resolve(WURZEL, 'ruecknahme'), 'dev');
    const { bauStand } = sperreMitGefaelltemBaum(inst);
    await warte(300);
    const lauf = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await lauf.warten();
    check('RUE Start mit Sperre: bereit', bereit.bereitErreicht);
    const hash = schreibe(inst.layoutDatei, dokument([...bauStand, KISTE]));
    const weg = await warteBis(() => !existsSync(inst.loeschsperrePfad));
    check('RUE Truhe wieder im Dokument: Sperrdatei weg', weg);
    await warteAufQuittung(inst.quittungsPfad, hash);
    const ende = await lauf.stoppen('SIGTERM');
    check('RUE Exit 0', ende.code === 0, `Code ${ende.code}`);
    await warte(200);
    const save = saveLesen(inst.savePfad);
    check('RUE danach: die Truhe steht, byte-gleich', save.get('kiste-h')?.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]', [...save.keys()].sort().join(','));
  }
}

async function prefabWechsel(): Promise<void> {
  const inst = instanz(resolve(WURZEL, 'prefab'), 'dev');
  const baeume: Platz[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));
  const alsBaum: Platz = { id: 'kiste-h', prefab: 'Beech1', x: 400, z: 400 };
  const HASH_KISTE = getStableHash('piece_chest_wood');
  const HASH_BAUM = getStableHash('Beech1');
  schreibe(inst.layoutDatei, dokument([...baeume, KISTE]));
  const setup = materialisiere(inst, SEED);
  setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h')?.setString('truheInhalt', '[[Wood,9]]');
  // Der Prefab-Wechsel: dieselbe id, anderes Prefab. Live wird er zurückgehalten (Zustand), bisher OHNE Sperrdatei.
  const hashWechsel = schreibe(inst.layoutDatei, dokument([...baeume, alsBaum]));
  wacheVon(setup).tick();
  const q = quittungLesen(inst.quittungsPfad);
  check('PREFAB live: bestaetigung-noetig, Quittung nennt die Sperre (1 id)', q?.hash === hashWechsel && q.grund === 'bestaetigung-noetig' && q.loeschsperre?.anzahl === 1, JSON.stringify(q));
  const sperre = loeschsperreLesen(inst.loeschsperrePfad);
  check('PREFAB live: Sperrdatei nennt die Truhe', sperre !== null && sperre !== 'kaputt' && sperre.ids.join() === 'kiste-h', JSON.stringify(sperre));
  setup.stop();
  await warte(300);
  const sperreText = lies(inst.loeschsperrePfad);

  // ── Neustart 1: die Truhe steht, mit Inhalt, kein zweites ZDO unter der id ──
  const lauf1 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit1 = await lauf1.warten();
  check('PREFAB Neustart: bereit, Boot-Log nennt die Sperre', bereit1.bereitErreicht && /Löschsperre hält 1 Objekt/.test(bereit1.ausgabe), bereit1.ausgabe.slice(-300));
  const ende1 = await lauf1.stoppen('SIGTERM');
  check('PREFAB Neustart: Exit 0', ende1.code === 0, `Code ${ende1.code}`);
  await warte(200);
  const liste1 = saveListe(inst.savePfad).filter((e) => e.id === 'kiste-h');
  check(
    'PREFAB Neustart: genau EIN ZDO unter der id, noch die Truhe, Inhalt byte-gleich',
    liste1.length === 1 && liste1[0]!.prefab === HASH_KISTE && liste1[0]!.z.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]',
    JSON.stringify(liste1.map((e) => ({ id: e.id, prefab: e.prefab })))
  );
  check('PREFAB Neustart: alle 10 Bäume stehen, 11 ZDOs', saveListe(inst.savePfad).length === 11, `${saveListe(inst.savePfad).length}`);
  check('PREFAB Neustart: Sperrdatei unverändert', lies(inst.loeschsperrePfad) === sperreText);

  // ── Neustart 2: Folgeänderung an einem anderen Objekt, dann Bestätigen ──
  const lauf2 = starteHauptprozess(inst, 20_000, BEREIT);
  const bereit2 = await lauf2.warten();
  check('PREFAB zweiter Start: bereit', bereit2.bereitErreicht, bereit2.ausgabe.slice(-300));
  const hashFolge = schreibe(inst.layoutDatei, dokument([...baeume, alsBaum, { id: 'neu-1', prefab: 'Beech1', x: 999, z: 999 }]));
  const qFolge = await warteAufQuittung(inst.quittungsPfad, hashFolge);
  check('PREFAB Folgeänderung an einem anderen Objekt wird angewendet (Sperre bleibt gemeldet)', qFolge?.ergebnis === 'angewendet' && qFolge.loeschsperre?.anzahl === 1, JSON.stringify(qFolge));
  check('PREFAB Folgeänderung: Sperrdatei unverändert (die Truhe fällt NICHT als „zurückgenommen" aus der Sperre)', lies(inst.loeschsperrePfad) === sperreText);
  const anfrage = bestaetigenAnfrageSchreiben(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz), hashFolge);
  const erkannt = await warteBis(() => quittungLesen(inst.quittungsPfad)?.bestaetigung?.id === anfrage);
  const qBest = quittungLesen(inst.quittungsPfad);
  check('PREFAB Bestätigen wirkt: Kennung erkannt, 1 entfernt, nicht abgelehnt', erkannt && qBest?.bestaetigung?.entfernt === 1 && !qBest.bestaetigung.abgelehnt, JSON.stringify(qBest));
  check('PREFAB Bestätigen: Sperrdatei weg, Anfrage verbraucht', !existsSync(inst.loeschsperrePfad) && !existsSync(bestaetigenAnfrageDatei(inst.worldsDir, inst.instanz)));
  const ende2 = await lauf2.stoppen('SIGTERM');
  check('PREFAB zweiter Start: Exit 0', ende2.code === 0, `Code ${ende2.code}`);
  await warte(200);
  const liste2 = saveListe(inst.savePfad);
  const kiste2 = liste2.filter((e) => e.id === 'kiste-h');
  check(
    'PREFAB nach dem Bestätigen: unter der id nur noch das Baum-Prefab, ohne Truheninhalt',
    kiste2.length === 1 && kiste2[0]!.prefab === HASH_BAUM && kiste2[0]!.z.members[String(HASH_TRUHE_INHALT)] === undefined,
    JSON.stringify(kiste2.map((e) => ({ id: e.id, prefab: e.prefab })))
  );
  check('PREFAB nach dem Bestätigen: die Folgeänderung steht, kein Baum ging verloren (10 + Ersatz + neu-1)', liste2.length === 12 && liste2.some((e) => e.id === 'neu-1'), `${liste2.length}`);
}

/**
 * Z3 N3 (C1, attack probe Q4): an unreadable lock file at boot plus a held-back prefab change must not leave a second ZDO
 * under the id — after the file is repaired byte for byte the next boot would read the matching ZDO as a revocation and
 * delete the chest with its content. Two cases: (K) the order broken → boot → repaired → boot; (Z) a state that already
 * holds BOTH ZDOs under the id (chest + tree) with an intact lock: the chest must stay.
 */
async function prefabWechselKaputt(): Promise<void> {
  const HASH_KISTE = getStableHash('piece_chest_wood');
  const HASH_BAUM = getStableHash('Beech1');
  const baeume: Platz[] = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, prefab: 'Beech1', x: 20 + i * 3, z: 20 }));
  const alsBaum: Platz = { id: 'kiste-h', prefab: 'Beech1', x: 400, z: 400 };
  const aufbau = (inst: Instanz, zweitesZdo: boolean): void => {
    schreibe(inst.layoutDatei, dokument([...baeume, KISTE]));
    const setup = materialisiere(inst, SEED);
    setup.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === 'kiste-h')?.setString('truheInhalt', '[[Wood,9]]');
    schreibe(inst.layoutDatei, dokument([...baeume, alsBaum]));
    wacheVon(setup).tick();
    if (zweitesZdo) {
      const z = setup.zdos.createZDO(HASH_BAUM, { x: 400, y: 30, z: 400 });
      z.setString(LAYOUT_ID_MEMBER, 'kiste-h');
    }
    setup.stop();
  };
  const truhe = (inst: Instanz): { id: string; prefab: number | undefined }[] => saveListe(inst.savePfad).filter((e) => e.id === 'kiste-h').map((e) => ({ id: e.id, prefab: e.prefab }));
  const inhaltDa = (inst: Instanz): boolean => saveListe(inst.savePfad).some((e) => e.id === 'kiste-h' && e.z.members[String(HASH_TRUHE_INHALT)]?.v === '[[Wood,9]]');

  // (K) broken → boot → repaired → boot
  {
    const inst = instanz(resolve(WURZEL, 'prefab-kaputt'), 'dev');
    aufbau(inst, false);
    await warte(300);
    const gut = lies(inst.loeschsperrePfad);
    check('PKAPUTT Aufbau: die Sperre nennt die Truhe', /kiste-h/.test(String(gut)), String(gut).slice(0, 120));
    writeFileSync(inst.loeschsperrePfad, '{"ids":');
    const lauf1 = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit1 = await lauf1.warten();
    check('PKAPUTT kaputte Sperre: bereit, GESCHLOSSEN im Log', bereit1.bereitErreicht && /GESCHLOSSEN/.test(bereit1.ausgabe), bereit1.ausgabe.slice(-300));
    const ende1 = await lauf1.stoppen('SIGTERM');
    check('PKAPUTT kaputte Sperre: Exit 0', ende1.code === 0, `Code ${ende1.code}`);
    await warte(200);
    check('PKAPUTT kaputte Sperre: unter der id steht GENAU EIN ZDO, die Truhe mit Inhalt (kein zweites, kein Baum)', truhe(inst).length === 1 && truhe(inst)[0]!.prefab === HASH_KISTE && inhaltDa(inst), JSON.stringify(truhe(inst)));
    writeFileSync(inst.loeschsperrePfad, gut as string);
    const lauf2 = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit2 = await lauf2.warten();
    check('PKAPUTT repariert: bereit, die Sperre hält 1 Objekt', bereit2.bereitErreicht && /Löschsperre hält 1 Objekt/.test(bereit2.ausgabe), bereit2.ausgabe.slice(-300));
    const ende2 = await lauf2.stoppen('SIGTERM');
    check('PKAPUTT repariert: Exit 0', ende2.code === 0, `Code ${ende2.code}`);
    await warte(200);
    check('PKAPUTT repariert: die Truhe steht mit Inhalt, die Sperre ist unverändert', truhe(inst).length === 1 && inhaltDa(inst) && lies(inst.loeschsperrePfad) === gut, JSON.stringify(truhe(inst)));
  }
  // (Z) two ZDOs under the id, intact lock
  {
    const inst = instanz(resolve(WURZEL, 'prefab-zwei'), 'dev');
    aufbau(inst, true);
    await warte(300);
    const gut = lies(inst.loeschsperrePfad);
    const lauf = starteHauptprozess(inst, 20_000, BEREIT);
    const bereit = await lauf.warten();
    check('PZWEI zwei ZDOs unter der id: bereit', bereit.bereitErreicht, bereit.ausgabe.slice(-300));
    const ende = await lauf.stoppen('SIGTERM');
    check('PZWEI Exit 0', ende.code === 0, `Code ${ende.code}`);
    await warte(200);
    check('PZWEI die Truhe mit Inhalt bleibt (ein Baum-ZDO neben ihr ist keine Rücknahme), die Sperre bleibt', inhaltDa(inst) && lies(inst.loeschsperrePfad) === gut, `${JSON.stringify(truhe(inst))} ${String(lies(inst.loeschsperrePfad)).slice(0, 80)}`);
  }
}

// Jeder Fall für sich: Ein Fehlschlag/Absturz eines Falls (etwa auf einem Stand OHNE Sperrdatei) verdeckt die anderen nicht.
try {
  for (const [name, fall] of [
    ['A1a/A2/A3', a1aA2A3],
    ['A1b/A1c', a1bA1c],
    ['A2k', kaputteSperre],
    ['BEST/RUE', bestaetigenUndRuecknahme],
    ['PREFAB', prefabWechsel],
    ['PKAPUTT/PZWEI', prefabWechselKaputt],
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
