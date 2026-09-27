/**
 * B1 (Nachangriff „Editor Upload-Größe N2"): Abbruch des ganzen Tests
 * (Zeitlimit oder Strg-C, wie `scripts/run-tests.mjs` es per `gruppeSignal`
 * tut) darf keinen Dienst mit PPID 1 und offenem Port hinterlassen.
 *
 * Auf `bd8fa6c` (N2-Stand) startete `upload-grundskala-betriebsdienst.ts`
 * den Dienst mit `detached: true` in einer EIGENEN Prozessgruppe — ein
 * Signal an die Gruppe des TESTPROZESSES (genau das, was `run-tests.mjs`
 * bei Zeitlimit/Speicherwächter schickt) erreichte den Dienst deshalb NICHT
 * mehr. Seit der N3-Nachbesserung startet `starten()` ohne `.bin/tsx`-
 * Wrapper und ohne `detached` (`process.execPath --import tsx src/main.ts`
 * direkt) — der Dienst ist ein gewöhnliches Kind OHNE eigene Gruppe und
 * stirbt automatisch mit, wenn die Gruppe seines Elternprozesses (hier:
 * der innere Testprozess) ein Signal bekommt.
 *
 * Dieser Test bildet GENAU das nach: Er startet den vollständigen Test
 * `upload-grundskala-betriebsdienst.ts` als KIND in einer EIGENEN,
 * losgelösten Gruppe (das spielt die Rolle, die `run-tests.mjs` für JEDEN
 * Test spielt), wartet, bis dessen Dienst bereit ist, schickt dann ein
 * Signal an die GANZE Gruppe dieses Kindes (TERM bzw. KILL, wie der Runner
 * es tut) und prüft danach zweierlei: keine `src/main.ts`-Prozess mit
 * PPID 1 mehr, und der gemeldete Port wieder frei (bindbar).
 *
 * N4 (Nachangriff N3, Befund N3-1): DIESER Test — nicht mehr der innere
 * Betriebsdienst-Test — spielte selbst wieder B1: Er startet sein Kind mit
 * `detached: true` in einer EIGENEN Gruppe; bricht `run-tests.mjs` DIESEN
 * äußeren Test im Startfenster ab (Zeitlimit, Speicherwächter, Strg-C),
 * trifft `gruppeSignal` nur die Gruppe DIESES Prozesses — die losgelöste
 * innere Gruppe (samt Betriebsdienst) bekommt nichts ab. Zwei Riegel dagegen:
 *   1. `process.on('exit'|'SIGTERM'|'SIGINT', …)` beendet die zuletzt
 *      gestartete innere Gruppe explizit — deckt SIGTERM/SIGINT UND die
 *      normale Beendigung.
 *   2. Gegen SIGKILL (kein Handler möglich) hilft nur, dass die innere Gruppe
 *      sich SELBST beendet: Das Kind bekommt eine ECHTE Pipe auf stdin
 *      (`WOV_STDIN_WAECHTER=1`) statt `ignore`. Stirbt dieser Prozess — auch
 *      per SIGKILL —, schließt der Kernel automatisch das Ende der Pipe, die
 *      dieser Prozess hält; das Kind sieht EOF auf stdin und beendet seine
 *      eigene Gruppe selbst (s. Kopfkommentar von `upload-grundskala-
 *      betriebsdienst.ts`).
 * Der Sweep-Nachweis (Zeitlimit/SIGINT gegen DIESEN Prozess, über den echten
 * Runner-Weg) steht in `upload-grundskala-betriebsdienst-abbruch-sweep.ts`.
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-betriebsdienst-abbruch.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');

/** N4/N3-1: die zuletzt gestartete innere Gruppe, für die Riegel unten. */
let aktuellesKind: ChildProcess | null = null;
function beendeAktuelleGruppe(): void {
  if (aktuellesKind?.pid === undefined) return;
  try {
    process.kill(-aktuellesKind.pid, 'SIGKILL');
  } catch {
    /* Gruppe schon weg */
  }
}
process.on('exit', beendeAktuelleGruppe);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    beendeAktuelleGruppe();
    // Node liefert bei einem installierten Handler NICHT mehr das normale
    // Signal-Verhalten (Prozessende) von selbst — das muss dieser Handler
    // jetzt explizit nachholen, sonst liefe der Testprozess einfach weiter.
    process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
  });
}

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

function verzoegerung(ms: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

/** Ob irgendein Prozess `WOV_WURZEL=<wurzel>` in seiner Umgebung trägt (der zuverlässigste Weg, GENAU diesen Dienst wiederzufinden). */
function findeProzesseMitWurzel(wurzel: string): number[] {
  const treffer: number[] = [];
  const marke = `WOV_WURZEL=${wurzel}`;
  for (const eintrag of readdirSync('/proc')) {
    if (!/^\d+$/.test(eintrag)) continue;
    const pid = Number(eintrag);
    try {
      const environ = readFileSync(`/proc/${eintrag}/environ`, 'utf8');
      if (environ.split('\0').includes(marke)) treffer.push(pid);
    } catch {
      // Prozess schon weg oder /proc/<pid>/environ nicht lesbar — kein Treffer.
    }
  }
  return treffer;
}

/** Ob sich `port` auf 127.0.0.1 sofort binden lässt (also frei ist). */
function portIstFrei(port: number): Promise<boolean> {
  return new Promise((fertig) => {
    const server = createServer();
    server.once('error', () => fertig(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => fertig(true));
    });
  });
}

/**
 * Den vollständigen Betriebsdienst-Test als Kind in einer EIGENEN,
 * losgelösten Gruppe starten (spielt die Rolle von `run-tests.mjs` je
 * Test), dann `signal` an die GANZE Gruppe schicken, sobald der innere
 * Dienst bereit ist. Danach: kein Prozess mit der bekannten `WOV_WURZEL`
 * mehr, und der gemeldete Port ist wieder frei.
 */
async function probeAbbruch(signal: NodeJS.Signals): Promise<void> {
  const kind = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst.ts'], {
    cwd: ADMIN,
    // Löst eine EIGENE Gruppe aus — genau die Rolle, die `run-tests.mjs`
    // für jeden gestarteten Test spielt (`spawn(..., { detached: true })`,
    // `scripts/run-tests.mjs` Zeile ~2455).
    detached: true,
    // N4/N3-1: stdin ist jetzt eine ECHTE Pipe (nicht `ignore`) und
    // `WOV_STDIN_WAECHTER=1` schaltet den EOF-Wächter im Kind ein — der
    // Riegel gegen SIGKILL DIESES Prozesses, s. Kopfkommentar.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WOV_STDIN_WAECHTER: '1' },
  });
  aktuellesKind = kind;

  let puffer = '';
  let port: number | null = null;
  let wurzel: string | null = null;
  const bereit = new Promise<void>((fertig, scheitern) => {
    const zeitgrenze = setTimeout(() => scheitern(new Error(`Innerer Test wurde nie bereit:\n${puffer}`)), 30_000);
    const pruefeZeile = (): void => {
      const t = /# Betriebsdienst auf 127\.0\.0\.1:(\d+), WOV_WURZEL (\S+),/.exec(puffer);
      if (t) {
        clearTimeout(zeitgrenze);
        port = Number(t[1]);
        wurzel = t[2]!;
        fertig();
      }
    };
    kind.stdout!.on('data', (s: Buffer) => {
      puffer += s.toString();
      pruefeZeile();
    });
    kind.stderr!.on('data', (s: Buffer) => {
      puffer += s.toString();
    });
    kind.on('exit', (code) => {
      clearTimeout(zeitgrenze);
      scheitern(new Error(`Innerer Test endete vorzeitig mit ${code}, bevor der Dienst bereit war:\n${puffer}`));
    });
  });

  await bereit;
  check(`${signal}: Port gemeldet`, port !== null && port > 0, `port=${port}`);
  check(`${signal}: WOV_WURZEL gemeldet`, wurzel !== null, `wurzel=${wurzel}`);

  // Das eigentliche Signal, wie `run-tests.mjs` es bei Zeitlimit/
  // Speicherwächter gegen die GANZE Gruppe des Tests schickt.
  process.kill(-kind.pid!, signal);

  // Der Kill braucht keine Millisekunden zu warten (kein SIGTERM-Handler im
  // Dienst, der eine Gnadenfrist bräuchte) — eine knappe Sekunde reicht,
  // deutlich unter jeder sinnvollen Testfrist.
  await verzoegerung(1_000);

  if (wurzel) {
    const ueberlebende = findeProzesseMitWurzel(wurzel);
    check(`${signal}: kein Prozess mit WOV_WURZEL=${wurzel} übrig`, ueberlebende.length === 0, `übrig: ${ueberlebende.join(',')}`);
    // Aufräumen: Der innere Test wurde mitten im Lauf getötet, sein eigenes
    // `finally` (Löschen von HAUPT.ordner) kam nie zum Zug.
    try {
      rmSync(wurzel, { recursive: true, force: true });
    } catch {
      /* schon weg oder nie angelegt */
    }
  }
  if (port !== null) {
    const frei = await portIstFrei(port);
    check(`${signal}: Port ${port} ist wieder frei (bindbar)`, frei);
  }
}

try {
  console.log('\n1. SIGTERM an die Gruppe des Tests — der Dienst stirbt mit\n');
  await probeAbbruch('SIGTERM');

  console.log('\n2. SIGKILL an die Gruppe des Tests — der Dienst stirbt mit\n');
  await probeAbbruch('SIGKILL');
} catch (e) {
  console.error(`[Abbruch-Probe] ${(e as Error).message}`);
  fehler++;
}

console.log(fehler === 0 ? '\nOK — kein verwaister Dienst nach Abbruch des Tests.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
