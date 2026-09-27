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
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
  const kind = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst-abbruch.ts'], {
    cwd: ADMIN,
    // Dieselbe Rolle, die `run-tests.mjs` für JEDEN Test spielt.
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WOV_SWEEP_MARKE: marke },
  });

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

console.log(fehler === 0 ? '\nOK — kein Fall hinterlässt eine Waise.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
