/**
 * Manual abort sweep, not part of KERN (~55 s).
 * Run: npx tsx admin/test/upload-grundskala-betriebsdienst-abbruch-sweep.ts
 * Replays the runner's group signals against the abort test. The acceptance
 * evidence also uses the real runner (not just this signal replay).
 * Each child carries a unique process marker. Never inspect/delete old folders.
 * SIGKILL of this sweep or its child can leave temporary directories behind.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ADMIN = resolve(HIER, '..');

/** Der aktuell laufende Kind-Testprozess — für den Riegel unten, falls DIESER Test selbst abgebrochen wird. */
let aktuellesKind: ChildProcess | null = null;
function toeteAktuellesKindHart(): void {
  if (aktuellesKind?.pid !== undefined) {
    try {
      process.kill(-aktuellesKind.pid, 'SIGKILL');
    } catch {
      /* Gruppe schon weg */
    }
  }
}
process.on('exit', toeteAktuellesKindHart);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    toeteAktuellesKindHart();
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

async function probeFall(fall: SweepFall): Promise<{ waisen: number[]; code: number | null; signal: NodeJS.Signals | null; alive: boolean }> {
  const marke = `sweep-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const kind = spawn(process.execPath, ['--import', 'tsx', 'test/upload-grundskala-betriebsdienst-abbruch.ts'], {
    cwd: ADMIN,
    // Dieselbe Rolle, die `run-tests.mjs` für JEDEN Test spielt.
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WOV_SWEEP_MARKE: marke },
  });
  aktuellesKind = kind;
  const beendet = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((fertig) => {
    kind.on('exit', (code, signal) => fertig({ code, signal }));
  });
  try {
    await verzoegerung(fall.ms);

    const alive = kind.exitCode === null && kind.signalCode === null;
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
    const waisen = findeProzesseMitMarke(marke);
    const { code, signal } = await beendet;
    return { waisen, code, signal, alive };
  } finally {
    toeteAktuellesKindHart();
    aktuellesKind = null;
  }
}

const FAELLE: readonly SweepFall[] = [
  { art: 'zeitlimit', ms: 500 },
  { art: 'zeitlimit', ms: 650 },
  { art: 'zeitlimit', ms: 800 },
  { art: 'zeitlimit', ms: 3000 },
  { art: 'sigint', ms: 700 },
  { art: 'sigint', ms: 900 },
  { art: 'sigint', ms: 2200 },
];

const zeilen: string[] = ['| Fall | Waise | Exit |', '|---|---|---|'];
for (const fall of FAELLE) {
  const bezeichnung = fall.art === 'zeitlimit' ? `Zeitlimit ${fall.ms} ms` : `SIGINT nach ${fall.ms} ms`;
  const { waisen, code, signal, alive } = await probeFall(fall);
  check(`${bezeichnung}: keine Waise`, waisen.length === 0, `übrig: ${waisen.join(',')}`);
  const expectedSignal = fall.art === 'zeitlimit' ? 'SIGTERM' : 'SIGINT';
  const expectedCode = fall.art === 'zeitlimit' ? 143 : 130;
  check(`${bezeichnung}: alive when signalled`, alive);
  check(`${bezeichnung}: expected abort status`, code === expectedCode || signal === expectedSignal,
    `code=${code} signal=${signal}`);
  zeilen.push(`| ${bezeichnung} | ${waisen.length === 0 ? 'keine' : waisen.join(',')} | code=${code} signal=${signal} |`);
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
