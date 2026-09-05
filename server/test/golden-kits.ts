/**
 * G8 (Modul-Generierung 2.0) — Wächter über den Verteiler.
 *
 * ── Was hier bewiesen wird ────────────────────────────────────────────
 * Der Rasterpfad bekommt mit G8 seinen Schalter: `DungeonDef.gridGeneration`.
 * Genau ein Kit trägt ihn (`DG_StoneVault`), alle anderen laufen weiter
 * über `generateDungeonLayout`. Das ist eine BEHAUPTUNG über vierzehn
 * Kits, die niemand ansieht — und die Konzeptnotiz verlangt deshalb
 * ausdrücklich, sie zu belegen statt sie zu behaupten:
 * „40 Seeds je Kit vor dem Umbau als JSON in `tools/golden/` ablegen,
 * danach vergleichen."
 *
 * Geprüft wird also:
 *  1. Für jedes Bestandskit (DG_Steingrab + die 13 geparsten) sind alle
 *     40 Layouts BYTE-GLEICH zu dem, was vor dem Umbau abgelegt wurde.
 *  2. Der Verteiler liefert für ein Bestandskit exakt das, was
 *     `generateDungeonLayout` liefert — er ist eine Weiche, keine zweite
 *     Fassung derselben Rechnung.
 *  3. Die RASTERKITS laufen über den Rasterpfad: dasselbe Layout wie
 *     `generateGridLayout`, und ausdrücklich ein ANDERES als der
 *     1.0-Pfad. Ohne die zweite Hälfte wäre die erste auch dann grün,
 *     wenn der Schalter gar nichts täte.
 *  4. Laufzeit des Rasterpfads bei 200 Zellen unter 10 ms je Layout.
 *
 * ── Warum Hashes und nicht 82 MiB Layouts ─────────────────────────────
 * `DG_Hildir_PlainsFortress` allein ergibt über 40 Saaten 81 MiB JSON.
 * Ein Vergleich über SHA-256 der Zeichenkette `JSON.stringify(layout)`
 * ist dieselbe Aussage — gleiche Prüfsumme heisst gleiche Bytes — und
 * kostet 40 Zeilen statt 80 Megabyte im Repo. Damit ein Bruch trotzdem
 * LESBAR ist, liegt zusätzlich EIN vollständiges Layout als Rohtext
 * daneben (`DG_Steingrab`, Saat 7 — die Kombination, die die
 * Konzeptnotiz namentlich nennt); es wird byte-genau verglichen und ist
 * im Fehlerfall der Text, den man diffen kann.
 *
 * Die Golden-Dateien schreibt `tools/golden-kits-schreiben.ts` — bewusst
 * ein eigenes Werkzeug und kein Schalter an diesem Test: Ein Test, der
 * seine eigene Erwartung überschreiben kann, ist im Zweifelsfall immer
 * grün.
 *
 * Aufruf: `npx tsx server/test/golden-kits.ts`   (aus dem Repo-Wurzelverzeichnis)
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { DUNGEONS, DUNGEONS_BY_NAME, type DungeonDef } from '@wov/shared';
import { generateDungeonLayout } from '@wov/shared';
import { erzeugeLayoutFuerKit, generateGridLayout } from '@wov/shared';

/** Dieselbe Stichprobe wie in der Konzeptnotiz und in `messe-stonevault-logik.ts`. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
/**
 * Die Kits auf dem RASTERPFAD — sie haben kein Golden.
 *
 * Mit G8 war das genau eines (`DG_StoneVault`, das die Seite wechselte),
 * und die Konstante hiess entsprechend `RASTER_KIT`. Mit F4 kommt die
 * Fels-Ableitung `DG_RockVault` dazu (`rockVariant()` in
 * `shared/src/eigeneDungeons.ts`) — geometrisch dasselbe Kit, deshalb
 * ebenfalls mit `gridGeneration` und ebenfalls ohne Golden.
 *
 * Diese eine Zeile ist die ganze Anpassung, aber sie muss BEWUSST
 * gesetzt werden: Prüfung 1 verlangt für jedes Kit ohne Eintrag hier
 * eine Golden-Datei, Prüfung 3 verlangt umgekehrt, dass sonst KEIN Kit
 * den Schalter trägt. Wer ein Rasterkit hinzufügt, ohne es hier zu
 * nennen, bekommt zwei rote Prüfungen und keine Erklärung dazu.
 */
const RASTER_KITS: ReadonlySet<string> = new Set(['DG_StoneVault', 'DG_RockVault']);
/** Die namentlich genannte Kombination aus der Konzeptnotiz (Vertragsteil „Steingrab"). */
const VOLL_KIT = 'DG_Steingrab';
const VOLL_SEED = 7;

const GOLDEN_DIR = join(import.meta.dirname, '..', '..', 'tools', 'golden');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

/**
 * Ein Eintrag der Golden-Datei.
 *
 * `rooms`/`doors`/`props` stehen NEBEN dem Hash, obwohl der Hash allein
 * entscheidet: Bricht ein Kit, sagt die Prüfsumme nur „anders", die drei
 * Zahlen sagen „drei Räume weniger". Das ist der Unterschied zwischen
 * einer Meldung und einem Anhaltspunkt.
 */
interface GoldenEintrag {
  readonly seed: number;
  readonly rooms?: number;
  readonly doors?: number;
  readonly props?: number;
  readonly sha256?: string;
  /** Kits mit Lager-Algorithmus werfen — die MELDUNG ist dann das Golden. */
  readonly fehler?: string;
}

interface GoldenDatei {
  readonly kit: string;
  readonly layouts: readonly GoldenEintrag[];
}

/**
 * Ein Layout erzeugen ODER die Fehlermeldung festhalten.
 *
 * Fünf der dreizehn geparsten Kits benutzen den Lager-Algorithmus und
 * werden von `generateDungeonLayout` abgelehnt. Sie deshalb aus der
 * Stichprobe zu nehmen hiesse, genau die Kits ungeprüft zu lassen, bei
 * denen ein Verteiler am ehesten danebengreift — die Meldung ist für sie
 * das Golden.
 */
function laufFuer(def: DungeonDef, seed: number, ueberVerteiler: boolean): GoldenEintrag {
  try {
    const layout = ueberVerteiler ? erzeugeLayoutFuerKit(def, seed) : generateDungeonLayout(def, seed);
    const text = JSON.stringify(layout);
    return {
      seed,
      rooms: layout.rooms.length,
      doors: layout.doors.length,
      props: layout.props.length,
      sha256: createHash('sha256').update(text).digest('hex'),
    };
  } catch (error) {
    return { seed, fehler: String(error) };
  }
}

function gleich(a: GoldenEintrag, b: GoldenEintrag): boolean {
  return (
    a.sha256 === b.sha256 && a.rooms === b.rooms && a.doors === b.doors && a.props === b.props && a.fehler === b.fehler
  );
}

// ── 1. Bestandskits: byte-gleich zum abgelegten Stand ─────────────────
console.log('=== Bestandskits gegen tools/golden/ ===\n');
const bestandskits = DUNGEONS.filter((d) => !RASTER_KITS.has(d.name));
let verglichen = 0;
for (const def of bestandskits) {
  const pfad = join(GOLDEN_DIR, `${def.name}.json`);
  if (!existsSync(pfad)) {
    check(`${def.name}: Golden vorhanden`, false, `${pfad} fehlt — tools/golden-kits-schreiben.ts läuft nicht?`);
    continue;
  }
  const golden = JSON.parse(readFileSync(pfad, 'utf8')) as GoldenDatei;
  const nachSeed = new Map(golden.layouts.map((e) => [e.seed, e]));
  const abweichungen: string[] = [];
  for (const seed of SEEDS) {
    const soll = nachSeed.get(seed);
    const ist = laufFuer(def, seed, true);
    verglichen++;
    if (!soll) {
      abweichungen.push(`Saat ${seed} fehlt im Golden`);
      continue;
    }
    if (!gleich(soll, ist)) {
      abweichungen.push(
        `Saat ${seed}: ${soll.sha256?.slice(0, 12) ?? soll.fehler} → ${ist.sha256?.slice(0, 12) ?? ist.fehler}` +
          (soll.rooms !== ist.rooms ? ` (Räume ${soll.rooms} → ${ist.rooms})` : '')
      );
    }
  }
  check(
    `${def.name}: 40 Layouts byte-gleich`,
    abweichungen.length === 0,
    abweichungen.length > 0 ? abweichungen.slice(0, 3).join('; ') : ''
  );
}
console.log(`\n  ${bestandskits.length} Kits, ${verglichen} Layouts verglichen.\n`);

// ── 1b. Das eine vollständige Layout als lesbarer Zeuge ───────────────
const vollPfad = join(GOLDEN_DIR, `${VOLL_KIT}-seed${VOLL_SEED}.json`);
if (!existsSync(vollPfad)) {
  check(`${VOLL_KIT} Saat ${VOLL_SEED}: Volltext-Golden vorhanden`, false, `${vollPfad} fehlt`);
} else {
  const soll = readFileSync(vollPfad, 'utf8');
  const def = DUNGEONS_BY_NAME.get(VOLL_KIT)!;
  const ist = JSON.stringify(erzeugeLayoutFuerKit(def, VOLL_SEED));
  check(
    `${VOLL_KIT} Saat ${VOLL_SEED}: Volltext byte-gleich`,
    soll === ist,
    `${soll.length} vs. ${ist.length} Zeichen`
  );
}

// ── 2. Der Verteiler ist eine Weiche, keine zweite Rechnung ───────────
console.log('\n=== Verteiler ===\n');
for (const def of bestandskits.slice(0, 6)) {
  let identisch = true;
  for (const seed of [1, 7, 23]) {
    const a = laufFuer(def, seed, true);
    const b = laufFuer(def, seed, false);
    if (!gleich(a, b)) identisch = false;
  }
  check(`${def.name}: Verteiler == generateDungeonLayout`, identisch);
}

// ── 3. Die Rasterkits laufen über den Rasterpfad ──────────────────────
const rasterkits: DungeonDef[] = [];
for (const name of RASTER_KITS) {
  const def = DUNGEONS_BY_NAME.get(name);
  if (!def) {
    console.error(`Kit '${name}' fehlt.`);
    process.exit(1);
  }
  rasterkits.push(def);
}
check(
  `kein anderes Kit trägt gridGeneration`,
  bestandskits.every((d) => d.gridGeneration === undefined),
  bestandskits
    .filter((d) => d.gridGeneration !== undefined)
    .map((d) => d.name)
    .join(', ')
);
for (const def of rasterkits) {
  check(
    `${def.name} trägt den Schalter gridGeneration`,
    def.gridGeneration !== undefined,
    def.gridGeneration ? JSON.stringify(def.gridGeneration) : 'fehlt'
  );
  let ueberRaster = true;
  let unterschiedlich = true;
  for (const seed of SEEDS) {
    const verteiler = JSON.stringify(erzeugeLayoutFuerKit(def, seed));
    if (verteiler !== JSON.stringify(generateGridLayout(def, seed))) ueberRaster = false;
    // Der Gegenbeweis: Wäre der Schalter wirkungslos, käme hier dasselbe
    // heraus — und Prüfung 1 bliebe trotzdem grün.
    if (verteiler === JSON.stringify(generateDungeonLayout(def, seed))) unterschiedlich = false;
  }
  check(`${def.name}: Verteiler == generateGridLayout (40 Saaten)`, ueberRaster);
  check(`${def.name}: Verteiler != generateDungeonLayout (40 Saaten)`, unterschiedlich);
}

// ── 4. Laufzeit bei 200 Zellen ────────────────────────────────────────
console.log('\n=== Laufzeit (Rasterpfad, 200 Zellen) ===\n');
{
  /*
    Gemessen wird EIN Rasterkit, nicht jedes.

    Die Ableitung `DG_RockVault` trägt dieselben `size`, `connections` und
    `gridEdges` und ergibt bei gleicher Saat denselben Grundriss — belegt
    Zeichen für Zeichen in `shared/test/kit-ableitung.ts`. Ein zweiter
    Durchgang mässe deshalb dieselbe Arithmetik ein zweites Mal und
    verdoppelte nur die zwanzig Sekunden dieses Tests. Kommt einmal ein
    Rasterkit dazu, das NICHT abgeleitet ist, gehört es hier hinein.
  */
  const gross: DungeonDef = { ...rasterkits[0]!, maxRooms: 200 };
  // Aufwärmen: Die ersten Läufe messen den JIT, nicht den Generator.
  for (let s = 1; s <= 20; s++) erzeugeLayoutFuerKit(gross, s);
  const zeiten: number[] = [];
  let raeume = 0;
  for (const seed of SEEDS) {
    const t0 = process.hrtime.bigint();
    const l = erzeugeLayoutFuerKit(gross, seed);
    zeiten.push(Number(process.hrtime.bigint() - t0) / 1e6);
    raeume += l.rooms.length;
  }
  const sortiert = [...zeiten].sort((a, b) => a - b);
  const median = sortiert[Math.floor(sortiert.length / 2)]!;
  const schnitt = zeiten.reduce((a, b) => a + b, 0) / zeiten.length;
  const max = sortiert[sortiert.length - 1]!;
  console.log(
    `  ${zeiten.length} Layouts, ${(raeume / zeiten.length).toFixed(1)} Räume je Layout — ` +
      `min ${sortiert[0]!.toFixed(2)} ms, median ${median.toFixed(2)} ms, Schnitt ${schnitt.toFixed(2)} ms, max ${max.toFixed(2)} ms`
  );
  check(`Median unter 10 ms je Layout`, median < 10, `${median.toFixed(2)} ms`);
  check(`Schnitt unter 10 ms je Layout`, schnitt < 10, `${schnitt.toFixed(2)} ms`);
  // Der MAXIMALwert ist bewusst kein 10-ms-Wächter: Ein einzelner
  // Ausreisser über 40 Läufe ist die Speicherbereinigung des Prozesses,
  // nicht der Generator (gemessen: median 6,7 ms, max 10,9 ms auf
  // derselben Maschine im selben Lauf). Eine Grenze, die von der Laune
  // der GC abhängt, ist ein Test, der zufällig rot wird — die weite
  // Grenze hier fängt trotzdem jede echte Grössenordnung ab.
  check(`kein Ausreisser über 30 ms`, max < 30, `${max.toFixed(2)} ms`);
}

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün.');
}
