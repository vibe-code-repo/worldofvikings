/**
 * N4 (Nachangriff „Editor Upload-Größe N3", Befund N3-1): Nachweis über den
 * ECHTEN Runner-Weg, dass `upload-grundskala-betriebsdienst-abbruch.ts`
 * selbst keine Waise mehr hinterlässt, wenn `scripts/run-tests.mjs` GENAU
 * IHN abbricht (Zeitlimit/Speicherwächter -> `gruppeSignal`: SIGTERM, nach
 * 5 s SIGKILL; Strg-C -> SIGINT an die Gruppe).
 *
 * Dieser Test spielt die Rolle von `run-tests.mjs` eine Ebene über dem
 * Abbruch-Test: Er startet ihn als Kind in einer EIGENEN, losgelösten
 * Gruppe (`detached: true`, exakt wie `scripts/run-tests.mjs` es für jeden
 * Test tut), wartet eine feste Frist — bewusst OHNE auf eine bestimmte
 * Log-Zeile zu synchronisieren, denn der Nachangriff fand die Waise genau
 * im UNSYNCHRONISIERTEN Startfenster — und schickt dann dasselbe Signal, das
 * der Runner schicken würde. Eine eindeutige Markierung
 * (`WOV_SWEEP_MARKE`) reist über die Umgebung durch ALLE drei Ebenen
 * (dieser Test -> Abbruch-Test -> Betriebsdienst-Test -> Admin-Dienst, s.
 * Kopfkommentare dort) und macht eine Waise auf JEDER Ebene auffindbar,
 * ohne fremde Prozesse auf diesem geteilten Rechner zu treffen.
 *
 * Lauf:  npx tsx admin/test/upload-grundskala-betriebsdienst-abbruch-sweep.ts
 * Dauer: ca. 1 Minute (7 Fälle, je mit Beobachtungsfenster).
 *
 * ── N5 (Nachangriff N4, Befund A6): keine Wegwerf-Ordner-Waisen mehr ──────
 * Der innere Betriebsdienst-Test legt seinen `WOV_WURZEL`-Ordner sonst
 * selbst per `mkdtemp` an und löscht ihn in seinem eigenen `finally` — das
 * läuft nie, wenn der EOF-Wächter die Gruppe per SIGKILL beendet (genau der
 * Normalfall hier). Dieser Test legt den Ordner deshalb selbst an, reicht
 * ihn über `WOV_WEGWERF_WURZEL` nach unten durch (der Abbruch-Test muss
 * dafür nichts Eigenes tun — er vererbt seine Umgebung ohnehin an sein
 * Kind) und löscht ihn selbst in einem `finally`, dessen Code garantiert
 * läuft: Dieser Prozess ist es, der das Signal SCHICKT, nicht der, der es
 * bekommt. Der Zeuge unten zählt `wov-grundskala-betriebsdienst-*`- UND
 * `wov-sweep-wegwerf-*`-Ordner (B3, Nachangriff N5) in `os.tmpdir()` vor und
 * nach dem ganzen Sweep.
 *
 * ── B2 (Nachangriff N5): DIESER Prozess selbst abgebrochen ────────────────
 * Die Aussage „läuft garantiert, weil dieser Prozess das Signal schickt"
 * (oben) gilt nur, solange DIESER Prozess selbst weiterläuft. Bricht
 * `run-tests.mjs` genau IHN ab (Zeitlimit/Speicherwächter/Strg-C), kommt das
 * eigene `finally` in `probeFall` bei SIGTERM/SIGINT NICHT automatisch zum
 * Zug — Node liefert dafür kein „finally garantiert" wie bei einem
 * synchronen Ablauf, ein `process.on(...)`-Handler ist nötig (unten). Gegen
 * SIGKILL hilft kein Handler; der NÄCHSTE Lauf räumt deshalb beim Start
 * eigene, verwaiste `wov-sweep-wegwerf-*`-Ordner auf, die älter als 1 h sind
 * und in denen laut `/proc/<pid>/cwd` kein Prozess arbeitet.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');

/**
 * B2 (Nachangriff N5): der aktuell laufende Kind-Testprozess UND sein
 * eigener Wegwerf-Ordner — für den Signal-Riegel unten. `aktuelleWurzel`
 * wird von `probeFall` selbst auf `null` gesetzt, sobald sein eigenes
 * `finally` den Ordner schon geräumt hat.
 */
let aktuellesKind: ChildProcess | null = null;
let aktuelleWurzel: string | null = null;
function raeumeBeimAbbruchAuf(): void {
  if (aktuellesKind?.pid !== undefined) {
    try {
      process.kill(-aktuellesKind.pid, 'SIGKILL');
    } catch {
      /* Gruppe schon weg */
    }
  }
  if (aktuelleWurzel) {
    try {
      rmSync(aktuelleWurzel, { recursive: true, force: true });
    } catch {
      /* schon weg */
    }
    aktuelleWurzel = null;
  }
}
process.on('exit', raeumeBeimAbbruchAuf);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    raeumeBeimAbbruchAuf();
    process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
  });
}

/** Ob irgendein Prozess laut `/proc/<pid>/cwd` gerade in `ordner` arbeitet. */
function irgendeinProzessArbeitetIn(ordner: string): boolean {
  let real: string;
  try {
    real = realpathSync(ordner);
  } catch {
    return false;
  }
  for (const eintrag of readdirSync('/proc')) {
    if (!/^\d+$/.test(eintrag)) continue;
    try {
      if (readlinkSync(`/proc/${eintrag}/cwd`) === real) return true;
    } catch {
      // Prozess schon weg oder kein Zugriff — kein Treffer.
    }
  }
  return false;
}

/**
 * B2 (Nachangriff N5): verwaiste, EIGENE `wov-sweep-wegwerf-*`-Ordner
 * (älter als 1 h, kein Prozess arbeitet laut `/proc/<pid>/cwd` dort) aus einem
 * per SIGKILL beendeten früheren Lauf DIESES Tests aufräumen — der einzige
 * Fall, den kein Signal-Handler auffangen kann (Kopfkommentar).
 */
function raeumeVerwaisteWegwerfWurzelnAuf(): void {
  const EINE_STUNDE_MS = 60 * 60 * 1000;
  const jetzt = Date.now();
  let eintraege: string[];
  try {
    eintraege = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of eintraege) {
    if (!name.startsWith('wov-sweep-wegwerf-')) continue;
    const pfad = resolve(tmpdir(), name);
    let stat;
    try {
      stat = statSync(pfad);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || jetzt - stat.mtimeMs < EINE_STUNDE_MS) continue;
    if (irgendeinProzessArbeitetIn(pfad)) continue;
    try {
      rmSync(pfad, { recursive: true, force: true });
      console.log(`# Aufräumen: verwaister Ordner '${pfad}' entfernt (älter als 1 h, kein Prozess arbeitet dort)`);
    } catch {
      /* schon weg */
    }
  }
}
raeumeVerwaisteWegwerfWurzelnAuf();

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

/** Jeder Prozess (auf jeder der drei Ebenen), der `WOV_SWEEP_MARKE=<marke>` in seiner Umgebung trägt. */
function findeProzesseMitMarke(marke: string): number[] {
  const treffer: number[] = [];
  const nadel = `WOV_SWEEP_MARKE=${marke}`;
  for (const eintrag of readdirSync('/proc')) {
    if (!/^\d+$/.test(eintrag)) continue;
    try {
      const environ = readFileSync(`/proc/${eintrag}/environ`, 'utf8');
      if (environ.split('\0').includes(nadel)) treffer.push(Number(eintrag));
    } catch {
      // Prozess schon weg oder /proc/<pid>/environ nicht lesbar — kein Treffer.
    }
  }
  return treffer;
}

interface SweepFall {
  readonly art: 'zeitlimit' | 'sigint';
  readonly ms: number;
}

async function probeFall(fall: SweepFall): Promise<{ waisen: number[] }> {
  const marke = `sweep-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // N5/A6: DIESER Prozess legt den Wegwerf-Ordner an und reicht ihn über
  // die Umgebung nach unten durch — er räumt ihn im `finally` unten auch
  // wieder weg, egal was mit dem Kind passiert.
  const wurzel = mkdtempSync(resolve(tmpdir(), 'wov-sweep-wegwerf-'));
  // B2 (Nachangriff N5): ab hier kennt der Signal-Riegel (oben) diesen
  // Ordner, falls DIESER Prozess selbst abgebrochen wird.
  aktuelleWurzel = wurzel;
  try {
    const kind = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst-abbruch.ts'], {
      cwd: ADMIN,
      // Dieselbe Rolle, die `run-tests.mjs` für JEDEN Test spielt.
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, WOV_SWEEP_MARKE: marke, WOV_WEGWERF_WURZEL: wurzel },
    });
    aktuellesKind = kind;

    await verzoegerung(fall.ms);

    if (fall.art === 'zeitlimit') {
      // gruppeSignal: SIGTERM sofort, SIGKILL nach 5 s, falls die Gruppe dann
      // noch lebt (`scripts/run-tests.mjs`).
      try {
        process.kill(-kind.pid!, 'SIGTERM');
      } catch {
        /* Gruppe schon weg */
      }
      await verzoegerung(5_000);
      try {
        process.kill(-kind.pid!, 'SIGKILL');
      } catch {
        /* schon weg — der Normalfall, wenn SIGTERM schon aufgeräumt hat */
      }
    } else {
      try {
        process.kill(-kind.pid!, 'SIGINT');
      } catch {
        /* Gruppe schon weg */
      }
    }

    // Beobachtungsfenster: Unser Mechanismus ist EREIGNISBASIERT (Pipe-EOF
    // beim Sterben des Elternteils, kein Polling/keine Wiederholung), deshalb
    // reichen wenige Sekunden — anders als die 15 s im Nachangriff, die eine
    // denkbare Verzögerung zwischen Elterntod und Kind-EOF ausschließen
    // wollten, ohne den Mechanismus selbst zu kennen.
    await verzoegerung(3_000);
    return { waisen: findeProzesseMitMarke(marke) };
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
    aktuelleWurzel = null;
    aktuellesKind = null;
  }
}

/**
 * Anzahl der `wov-grundskala-betriebsdienst-*`- UND `wov-sweep-wegwerf-*`-
 * Ordner in `os.tmpdir()` (B3, Nachangriff N5: der alte Zeuge zählte nur den
 * ERSTEN Präfix — mit der Vorgabe legt der innere Test diesen Präfix gar
 * nicht mehr an, eigene Reste des Sweeps selbst zählte er also nicht).
 */
function zaehleWegwerfReste(): number {
  return readdirSync(tmpdir()).filter(
    (name) => name.startsWith('wov-grundskala-betriebsdienst-') || name.startsWith('wov-sweep-wegwerf-')
  ).length;
}

const FAELLE: readonly SweepFall[] = [
  { art: 'zeitlimit', ms: 300 },
  { art: 'zeitlimit', ms: 400 },
  { art: 'zeitlimit', ms: 800 },
  { art: 'zeitlimit', ms: 1600 },
  { art: 'zeitlimit', ms: 3000 },
  { art: 'sigint', ms: 400 },
  { art: 'sigint', ms: 1600 },
];

const restVorher = zaehleWegwerfReste();

const zeilen: string[] = ['| Fall | Waise |', '|---|---|'];
for (const fall of FAELLE) {
  const bezeichnung = fall.art === 'zeitlimit' ? `Zeitlimit ${fall.ms} ms` : `SIGINT nach ${fall.ms} ms`;
  const { waisen } = await probeFall(fall);
  check(`${bezeichnung}: keine Waise`, waisen.length === 0, `übrig: ${waisen.join(',')}`);
  zeilen.push(`| ${bezeichnung} | ${waisen.length === 0 ? 'keine' : waisen.join(',')} |`);
  // Rot-Nachweis auf altem Stand hinterlässt echte Waisen — die räumt hier
  // die Probe selbst weg (SIGKILL auf die exakten PIDs, kein pkill -f).
  for (const pid of waisen) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* schon weg */
    }
  }
}
console.log(`\n${zeilen.join('\n')}\n`);

// N5/A6 (B3 erweitert): der eigentliche Zeuge — vor und nach dem ganzen
// Sweep (7 Abbrüche) liegt in os.tmpdir() dieselbe Anzahl an
// `wov-grundskala-betriebsdienst-*`- und `wov-sweep-wegwerf-*`-Ordnern.
// Reste, die NICHT von diesem Lauf stammen (ein fremder, gleichzeitig
// laufender Bauer auf demselben Rechner), zählen auf beiden Seiten gleich
// mit und verfälschen den Vergleich nicht.
const restNachher = zaehleWegwerfReste();
check(
  'kein Wegwerf-Ordner-Rest nach dem Sweep (A6)',
  restNachher === restVorher,
  `vorher ${restVorher}, nachher ${restNachher}`
);

console.log(fehler === 0 ? '\nOK — kein Fall hinterlässt eine Waise.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
