/**
 * Der Betriebsdienst und die Modul-Registry — der Wächter gegen den
 * STILLEN Raumverlust beim Lesen (E8).
 *
 *   npx tsx test/modulregistry.ts      (aus admin/)
 *
 * ── Was hier auf dem Spiel steht ─────────────────────────────────────
 * `GET /api/dungeons/:id` schickt das Dokument von der Platte durch
 * `sanitizeDungeonDocument`, und der verwirft unbekannte Räume WORTLOS
 * (`shared/src/dungeons.ts`, Kopf: „Unknown rooms are dropped"). Der
 * Spielserver kann sich das leisten: Er registriert die zur Laufzeit
 * gebauten Säle beim Start (`ladeModulRegistrierung`, server/src/main.ts),
 * für ihn ist ein `Gen_StoneVaultHall4x3` kein unbekannter Raum.
 *
 * Der Betriebsdienst tat das NICHT. Ein Grab mit 18 Räumen kam bei ihm
 * mit 17 heraus — der gebaute Saal fiel heraus, der Editor zeichnete ein
 * Loch mit vierzehn offenen Kanten, und ein anschliessendes Speichern
 * hätte den Saal endgültig weggeschrieben. Kein Fehler, keine Warnung,
 * nur eine Zahl, die niemand nachzählt.
 *
 * ── Warum der ECHTE Prozess ──────────────────────────────────────────
 * Dieselbe Begründung wie in `betriebsdienst.ts`: Geprüft wird der Weg
 * einer Anfrage. Und hier zusätzlich der ZEITPUNKT — Module entstehen und
 * verschwinden, während der Dienst läuft. Ein Test, der die Registry vor
 * dem Start hinlegt, bewiese nur, dass ein Neustart hilft; genau das ist
 * aber die Lösung, die es nicht sein darf.
 *
 * ── Warum unter os.tmpdir() ──────────────────────────────────────────
 * Wie nebenan: eigenes WOV_WURZEL, Wegwerf-Token, WOV_ADMIN_PORT=0.
 * `assets/generiert/` des Arbeitsbaums wird NICHT angefasst — dort liegen
 * die Säle, die Mike wirklich gebaut hat.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KIT_NAME,
  REGISTRY_DATEI,
  REGISTRY_VERSION,
  dreiecke,
  modulName,
  registryPruefsumme,
  type RegistryModul,
} from '@wov/shared/src/moduleRegistry.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');
const WURZEL = resolve(ADMIN, '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Testmaterial ──────────────────────────────────────────────────────

const ORDNER = mkdtempSync(resolve(tmpdir(), 'wov-admin-registry-'));
const GENERIERT = resolve(ORDNER, 'assets/generiert');
const DUNGEONS = resolve(ORDNER, 'server/data/dungeons/dev');
const TOKEN = 'pruef-token-4711';
const TOKEN_DATEI = resolve(ORDNER, 'token');

mkdirSync(GENERIERT, { recursive: true });
mkdirSync(DUNGEONS, { recursive: true });
mkdirSync(resolve(ORDNER, 'server/data/welten'), { recursive: true });
writeFileSync(TOKEN_DATEI, `${TOKEN}\n`);

const SAAL = modulName(4, 3, 2);

function eintrag(): RegistryModul {
  return {
    kit: KIT_NAME,
    name: SAAL,
    zellenX: 4,
    zellenZ: 3,
    pfeilerRaster: 2,
    gewicht: 0.5,
    tris: dreiecke(4, 3, 2),
    erzeugt: '2026-09-05T00:00:00.000Z',
  };
}

/**
 * Die Registry-Datei hinlegen — mit oder ohne den Saal.
 *
 * Geschrieben wird die volle Form inklusive `pruefsumme`, damit die Datei
 * byte-gleich zu der aussieht, die der Spielserver schreibt. Gelesen wird
 * das Feld ohnehin nicht (es wird nachgerechnet, s. `leseRegistryAusText`).
 */
function registrySetzen(module: readonly RegistryModul[]): void {
  const inhalt = JSON.stringify(
    { version: REGISTRY_VERSION, pruefsumme: registryPruefsumme(module), module },
    null,
    2
  );
  writeFileSync(resolve(GENERIERT, REGISTRY_DATEI), `${inhalt}\n`, 'utf8');
}

/**
 * Ein Dokument mit EINEM Bestandsraum und EINEM gebauten Saal.
 *
 * Die Mischung ist der gefährliche Fall — dieselbe Begründung wie in
 * `server/test/registry-pruefsumme.ts`: Ein Dokument, dessen Räume ALLE
 * unbekannt sind, fällt im Sanitizer durch (`rooms.length === 0` → null)
 * und wird gemeldet. Still verloren geht nur, was neben Bekanntem steht.
 */
function dokument(id: string, saalName: string | null): unknown {
  const rooms: unknown[] = [
    { room: 'StoneVaultHall', pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, placeOrder: 1, seed: 1 },
  ];
  if (saalName) {
    rooms.push({ room: saalName, pos: { x: 0, y: 0, z: 8 }, rot: { x: 0, y: 0, z: 0, w: 1 }, placeOrder: 2, seed: 2 });
  }
  return {
    version: 2,
    id,
    name: 'E8-Probe',
    base: KIT_NAME,
    mode: 'custom',
    seed: 7,
    zoneSize: 64,
    layout: { rooms, doors: [], props: [] },
  };
}

writeFileSync(resolve(DUNGEONS, 'mit-saal.json'), JSON.stringify(dokument('mit-saal', SAAL), null, 2));
writeFileSync(resolve(DUNGEONS, 'nur-bestand.json'), JSON.stringify(dokument('nur-bestand', null), null, 2));

// ── Dienst starten ────────────────────────────────────────────────────

function starten(): Promise<{ port: number; kind: ChildProcess }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: ADMIN,
      env: {
        ...process.env,
        WOV_WURZEL: ORDNER,
        WOV_INSTANZ: 'dev',
        WOV_ADMIN_ADRESSE: '127.0.0.1',
        WOV_ADMIN_PORT: '0',
        WOV_ADMIN_TOKEN_DATEI: TOKEN_DATEI,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Dienst startet nicht:\n${puffer}`)), 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        fertig({ port: Number(t[1]), kind });
      }
    });
    kind.stderr.on('data', (s: Buffer) => {
      puffer += s.toString();
    });
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Dienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

type Antwort = { code: number; daten: Record<string, unknown> };

function anfrage(port: number, pfad: string): Promise<Antwort> {
  return new Promise((fertig, scheitern) => {
    const req = request(
      { host: '127.0.0.1', port, path: pfad, method: 'GET', headers: { 'x-wov-token': TOKEN } },
      (res: IncomingMessage) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (s: string) => (text += s));
        res.on('end', () => {
          let daten: Record<string, unknown> = {};
          try {
            daten = JSON.parse(text) as Record<string, unknown>;
          } catch {
            /* kein JSON — dann steht unten eine Zahl, die nicht passt */
          }
          fertig({ code: res.statusCode ?? 0, daten });
        });
      }
    );
    req.on('error', scheitern);
    req.end();
  });
}

/** Die Raumzahl aus einer Dokumentantwort — 0, wenn keins dabei ist. */
function raeume(a: Antwort): number {
  const doc = a.daten.dungeon as { layout?: { rooms?: unknown[] } } | undefined;
  return doc?.layout?.rooms?.length ?? 0;
}

// ── Lauf ──────────────────────────────────────────────────────────────

const { port, kind } = await starten();
console.log(`# Betriebsdienst auf 127.0.0.1:${port}, Wurzel ${ORDNER}`);

try {
  // 1) OHNE Registry-Datei kennt niemand den Saal — und genau dann darf
  //    das Dokument NICHT stillschweigend um einen Raum erleichtert
  //    ausgeliefert werden. Ein Editor, der so etwas öffnet, zeigt ein
  //    Loch und schreibt es beim nächsten Speichern fest.
  const ohne = await anfrage(port, '/api/dungeons/mit-saal');
  check('ohne Registry: Dokument wird NICHT als heil geliefert', ohne.code !== 200, `Code ${ohne.code}, ${raeume(ohne)} Räume`);
  check('ohne Registry: der fehlende Raum wird gezählt', ohne.daten.unbekannteRaeume === 1, `= ${String(ohne.daten.unbekannteRaeume)}`);
  check(
    'ohne Registry: die Meldung nennt den Raum beim Namen',
    typeof ohne.daten.fehler === 'string' && (ohne.daten.fehler as string).includes(SAAL),
    String(ohne.daten.fehler)
  );

  // 2) Registry ERST JETZT hinlegen — der Dienst läuft schon. Module
  //    entstehen zur Laufzeit; ein Neustart des Betriebsdienstes ist
  //    keine Antwort, weil ihn niemand auslöst.
  registrySetzen([eintrag()]);
  const mit = await anfrage(port, '/api/dungeons/mit-saal');
  check('nach dem Bau: Dokument wird geliefert', mit.code === 200, `Code ${mit.code}`);
  check('nach dem Bau: BEIDE Räume sind da (18 statt 17)', raeume(mit) === 2, `= ${raeume(mit)}`);
  check('nach dem Bau: kein Raum unbekannt', mit.daten.unbekannteRaeume === 0, `= ${String(mit.daten.unbekannteRaeume)}`);

  // 3) Auch die Übersicht zählt jetzt richtig — sie ist die Zahl, die im
  //    Katalog neben dem Namen steht.
  const liste = await anfrage(port, '/api/dungeons');
  const kopf = ((liste.daten.dungeons ?? []) as { id: string; raeume: number }[]).find((d) => d.id === 'mit-saal');
  check('Übersicht: der Kopf nennt 2 Räume', kopf?.raeume === 2, `= ${String(kopf?.raeume)}`);

  // 4) Und wieder weg. `deleteModule` entfernt den Eintrag aus der Datei;
  //    ein Dienst, der nur nachträgt und nie austrägt, hielte den Saal
  //    ewig für vorhanden — und lieferte ein Dokument als heil aus, das
  //    der Spielserver nach einem Neustart nicht mehr bauen kann.
  registrySetzen([]);
  const wieder = await anfrage(port, '/api/dungeons/mit-saal');
  check('nach dem Löschen: wieder unbekannt, wieder laut', wieder.code !== 200, `Code ${wieder.code}`);
  check('nach dem Löschen: der Raum wird gezählt', wieder.daten.unbekannteRaeume === 1, `= ${String(wieder.daten.unbekannteRaeume)}`);

  // 5) Ein Dokument ohne gebauten Saal bleibt von alldem unberührt —
  //    sonst wäre der Wächter eine Sperre für den Normalfall.
  const bestand = await anfrage(port, '/api/dungeons/nur-bestand');
  check('Dokument ohne gebauten Saal: unverändert lesbar', bestand.code === 200 && raeume(bestand) === 1, `Code ${bestand.code}, ${raeume(bestand)} Räume`);
} finally {
  kind.kill('SIGTERM');
  rmSync(ORDNER, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nAlle Pruefungen bestanden.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
