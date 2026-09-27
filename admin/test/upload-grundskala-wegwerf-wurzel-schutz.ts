/**
 * B1 (BLOCKER, Nachangriff „Editor Upload-Größe N5"): `WOV_WEGWERF_WURZEL`
 * wurde bislang UNGEPRÜFT übernommen. Der Angreifer zeigte: mit
 * `export WOV_WEGWERF_WURZEL=/opt/worldofvikings` in der Umgebung eines
 * `npm test` überschreibt der innere Betriebsdienst-Test
 * `server/data/server.yml` des Ziels — grün, Exit 0.
 *
 * Dieser Test fährt GENAU die vier Proben des Angreifers gegen den ECHTEN
 * Betriebsdienst-Test (`upload-grundskala-betriebsdienst.ts`), als
 * Kindprozess mit `WOV_WEGWERF_WURZEL` gesetzt — nicht gegen eine
 * isolierte Prüf-Funktion, damit der Rot-Nachweis auf f71490b den
 * TATSÄCHLICHEN, damals verwundbaren Code trifft:
 *
 *  1. Ein Opferverzeichnis AUSSERHALB von `os.tmpdir()` (strukturell: nicht
 *     DIREKT unter `tmpdir()`, mit `wichtig.txt` und `server/data/server.yml`.
 *  2. Ein Symlink UNTER `tmpdir()` mit dem korrekten Präfix
 *     `wov-sweep-wegwerf-`, der auf genau dieses Opferverzeichnis zeigt.
 *  3. Ein NICHT LEERES Verzeichnis mit korrektem Präfix direkt unter
 *     `tmpdir()`.
 *  4. Ein leeres Verzeichnis mit FALSCHEM Präfix direkt unter `tmpdir()`.
 *
 * In JEDEM Fall muss der Kindprozess ablehnen (Exit ≠ 0), bevor er den
 * Admin-Dienst startet, und jede vorher vorhandene Opferdatei muss
 * byte-gleich bleiben.
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-wegwerf-wurzel-schutz.ts
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function sha256(pfad: string): string {
  return createHash('sha256').update(readFileSync(pfad)).digest('hex');
}

/**
 * Startet den ECHTEN Betriebsdienst-Test als Kind mit
 * `WOV_WEGWERF_WURZEL=wert`, wartet auf sein Ende (Netz: 45 s, weit über
 * jeder plausiblen Laufzeit — mit dem Fix bricht der Kindprozess sofort ab,
 * ohne den Admin-Dienst je zu starten), gibt Exitcode + Ausgabe zurück.
 */
function probeMitWegwerfWurzel(wert: string): Promise<{ code: number | null; ausgabe: string }> {
  return new Promise((fertig) => {
    const kind = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst.ts'], {
      cwd: ADMIN,
      env: { ...process.env, WOV_WEGWERF_WURZEL: wert },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ausgabe = '';
    kind.stdout.on('data', (s: Buffer) => (ausgabe += s.toString()));
    kind.stderr.on('data', (s: Buffer) => (ausgabe += s.toString()));
    const zeitgrenze = setTimeout(() => {
      try {
        kind.kill('SIGKILL');
      } catch {
        /* schon weg */
      }
    }, 45_000);
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      fertig({ code, ausgabe });
    });
  });
}

/** Ein Opferverzeichnis mit `wichtig.txt` und `server/data/server.yml` unter `wurzel` anlegen. */
function opferBauen(wurzel: string): { wichtigPfad: string; serverYmlPfad: string } {
  mkdirSync(resolve(wurzel, 'server/data'), { recursive: true });
  const wichtigPfad = resolve(wurzel, 'wichtig.txt');
  writeFileSync(wichtigPfad, `ORIGINAL-DATEI-${wurzel}\n`);
  const serverYmlPfad = resolve(wurzel, 'server/data/server.yml');
  writeFileSync(serverYmlPfad, 'ORIGINAL-DEV-KONFIG\n');
  return { wichtigPfad, serverYmlPfad };
}

// Alles unter EINEM eigenen mkdtemp-Bereich unter os.tmpdir() — die
// Opferverzeichnisse liegen darin bewusst ZWEI Ebenen tief (ihr direktes
// Elternverzeichnis ist NICHT os.tmpdir() selbst), das ist strukturell
// genau die Bedingung, die die Prüfung ablehnt (realpath liegt nicht DIREKT
// unter os.tmpdir()) — ohne dafür einen echten Pfad außerhalb des
// System-Temp-Bereichs anzufassen.
const BEREICH = mkdtempSync(resolve(tmpdir(), 'wov-n6-schutz-'));

try {
  console.log('\n1. Opferverzeichnis AUSSERHALB von tmpdir() (verschachtelt, falscher Ort, falscher Präfix)\n');
  const opfer = resolve(BEREICH, 'projekt', 'opfer');
  mkdirSync(opfer, { recursive: true });
  const { wichtigPfad, serverYmlPfad } = opferBauen(opfer);
  const wichtigVorher = sha256(wichtigPfad);
  const serverYmlVorher = sha256(serverYmlPfad);
  {
    const a = await probeMitWegwerfWurzel(opfer);
    check('Fall 1 (Opfer außerhalb tmp): Kindprozess lehnt ab (Exit ≠ 0)', a.code !== 0, `Exit=${a.code}`);
    check('Fall 1: Meldung nennt WOV_WEGWERF_WURZEL', a.ausgabe.includes('WOV_WEGWERF_WURZEL'), a.ausgabe.slice(0, 400));
  }
  check('Fall 1: wichtig.txt bleibt byte-gleich', sha256(wichtigPfad) === wichtigVorher);
  check('Fall 1: server/data/server.yml bleibt byte-gleich', sha256(serverYmlPfad) === serverYmlVorher);

  console.log('\n2. Symlink UNTER tmpdir() mit korrektem Präfix, zeigt auf dasselbe Opfer\n');
  const symlinkPfad = resolve(tmpdir(), `wov-sweep-wegwerf-symlink-${process.pid}`);
  symlinkSync(opfer, symlinkPfad);
  try {
    const wichtigVorher2 = sha256(wichtigPfad);
    const serverYmlVorher2 = sha256(serverYmlPfad);
    {
      const a = await probeMitWegwerfWurzel(symlinkPfad);
      check('Fall 2 (Symlink): Kindprozess lehnt ab (Exit ≠ 0)', a.code !== 0, `Exit=${a.code}`);
      check("Fall 2: Meldung nennt 'Symlink'", a.ausgabe.includes('Symlink'), a.ausgabe.slice(0, 400));
    }
    check('Fall 2: wichtig.txt (über den Symlink erreichbar) bleibt byte-gleich', sha256(wichtigPfad) === wichtigVorher2);
    check('Fall 2: server.yml (über den Symlink erreichbar) bleibt byte-gleich', sha256(serverYmlPfad) === serverYmlVorher2);
  } finally {
    rmSync(symlinkPfad, { force: true });
  }

  console.log('\n3. Nicht leeres Verzeichnis mit korrektem Präfix, direkt unter tmpdir()\n');
  const nichtLeer = mkdtempSync(resolve(tmpdir(), 'wov-sweep-wegwerf-'));
  try {
    const vorherDatei = resolve(nichtLeer, 'vorher.txt');
    writeFileSync(vorherDatei, 'SCHON-DA-VOR-DER-PROBE\n');
    const vorherHash = sha256(vorherDatei);
    {
      const a = await probeMitWegwerfWurzel(nichtLeer);
      check('Fall 3 (nicht leer): Kindprozess lehnt ab (Exit ≠ 0)', a.code !== 0, `Exit=${a.code}`);
      check("Fall 3: Meldung nennt 'nicht leer' oder 'leer'", /nicht leer|leer/.test(a.ausgabe), a.ausgabe.slice(0, 400));
    }
    check('Fall 3: vorher.txt bleibt byte-gleich', sha256(vorherDatei) === vorherHash);
    check(
      'Fall 3: keine neuen Einträge (kein server.yml/token/assets angelegt)',
      readdirSync(nichtLeer).length === 1,
      `Inhalt: ${readdirSync(nichtLeer).join(', ')}`
    );
  } finally {
    rmSync(nichtLeer, { recursive: true, force: true });
  }

  console.log('\n4. Leeres Verzeichnis mit FALSCHEM Präfix, direkt unter tmpdir()\n');
  const falscherPraefix = mkdtempSync(resolve(tmpdir(), 'wov-n6-falscher-praefix-'));
  try {
    {
      const a = await probeMitWegwerfWurzel(falscherPraefix);
      check('Fall 4 (falscher Präfix): Kindprozess lehnt ab (Exit ≠ 0)', a.code !== 0, `Exit=${a.code}`);
      check('Fall 4: Meldung nennt WOV_WEGWERF_WURZEL', a.ausgabe.includes('WOV_WEGWERF_WURZEL'), a.ausgabe.slice(0, 400));
    }
    check(
      'Fall 4: Verzeichnis bleibt leer (nichts wurde angelegt)',
      readdirSync(falscherPraefix).length === 0,
      `Inhalt: ${readdirSync(falscherPraefix).join(', ')}`
    );
  } finally {
    rmSync(falscherPraefix, { recursive: true, force: true });
  }
} finally {
  rmSync(BEREICH, { recursive: true, force: true });
  check('Aufräumen: eigener Bereich vollständig entfernt', !existsSync(BEREICH));
}

console.log(fehler === 0 ? '\nOK — WOV_WEGWERF_WURZEL lehnt jeden unsicheren Wert ab, Opfer bleiben unberührt.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
