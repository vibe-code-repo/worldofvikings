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

// ── 4. Laufzeit bei 200 Zellen — differenziell gegen eine Referenzarbeit ──
console.log('\n=== Laufzeit (Rasterpfad, 200 Zellen, differenziell) ===\n');
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

  /*
    N1-Nachbesserung (22.09.2026, Angriffsbericht „golden-kits Zeitschwelle
    — Angriff.md"): Weder `process.cpuUsage()` (Prozess-CPU, Stand
    `12522a9`) noch `process.threadCpuUsage()` (Hauptthread) allein retten
    eine feste 10-ms-Grenze. Prozess-CPU zählt V8-GC-/JIT-Hilfsthreads mit
    (0,8–3,9 ms Fremdanteil je Fenster im echten Testprozess) — das
    erzeugt Fehlalarme im Ruhezustand. Hauptthread-CPU entfernt diesen
    Fremdanteil, aber unter echter Kernkonkurrenz (diese Maschinenklasse:
    physische Kerne mit SMT) verliert der Hauptthread selbst Befehle pro
    Takt — derselbe Angriff mass +82 % Hauptthread-Zeit für dieselbe
    Rechnung unter Last (6,0 → 11,1 ms). Das ist echte Mehrarbeit, keine
    Fehlmessung — keine CPU-Uhr kann sie von einer echten Regression
    unterscheiden, wenn man sie gegen eine feste Millisekundengrenze hält.

    Die Antwort ist deshalb keine bessere Uhr, sondern eine bessere
    VERGLEICHSGRÖSSE (dasselbe Prinzip wie server/test/g12-tick-
    aufteilung.ts, Teil D: gegen tatsächlich verbrauchte Zeit statt gegen
    eine feste Grenze messen — dort die gemessene Wartezeit, hier eine
    eigens dafür geschriebene Rechenarbeit, weil der Rastergenerator
    keine bekannte Soll-Verzögerung hat): „Generator höchstens X-mal so
    teuer wie eine mitgemessene Referenzarbeit, verschränkt im selben
    Prozess, im selben Moment, unter derselben Last." Trifft
    Kernkonkurrenz beide Seiten der Verschränkung im selben
    Sekundenbruchteil, hebt sie Zähler UND Nenner etwa gleich an — das
    Verhältnis bleibt stehen (Bericht „golden-kits N1": unter 6 ALU- + 4
    Speicher-Brennern kein Anstieg gegenüber ruhig; unter der härteren,
    synthetischen Form — 8 angeheftete Brenner, Test erzwungen auf einen
    von ihnen gesättigten Kern — steigt es leicht, siehe Schwellen unten).
  */
  interface RefKnoten {
    readonly id: number;
    readonly art: string;
    readonly kanten: number[];
    readonly breite: number;
    readonly hoehe: number;
    readonly tuer: number;
  }
  function xorshift32(x: number): number {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x >>>= 0;
    x ^= x << 5;
    x >>>= 0;
    return x >>> 0;
  }
  /*
    Referenzkern: ruft KEINEN Generatorcode auf — sonst „nimmt sie eine
    Regression im Generator mit" und die Prüfung wäre blind für genau
    das, was sie prüfen soll (Karte, Abschnitt „Ausdrücklich nicht").
    Ähnelt ihm im VERHALTEN (Objekte anlegen, eine Map über einen
    Schlüssel füllen, verzweigen, Nachbarn nachschlagen) und in der
    GRÖSSENORDNUNG (REF_GROESSE = 18000 Knoten ergibt ruhig 7–9 ms
    Hauptthread-CPU-Zeit gegen 6–8 ms für ein Layout bei maxRooms: 200).
    Eine reine Ganzzahlschleife reicht nicht: Sie bliebe meist in
    Registern/L1 und würde von echter Cache-/Speicherbandbreiten-
    Konkurrenz kaum getroffen (Karte, Auftrag). Geprüft (Bericht
    „golden-kits N1"): Unter 6 ALU- + 4 Speicher-Brennern steigt das
    VERHÄLTNIS Generator/Referenz nicht — beide Seiten sind groß genug,
    um vergleichbar oft ans Zuteilungs-/Cache-Limit zu stoßen.
  */
  const REF_GROESSE = 18000;
  function referenzArbeit(seed: number): number {
    let zustand = ((seed * 2654435761) >>> 0) || 1;
    const knoten = new Map<number, RefKnoten>();
    for (let i = 0; i < REF_GROESSE; i++) {
      zustand = xorshift32(zustand);
      const art =
        zustand % 4 === 0 ? 'raum' : zustand % 4 === 1 ? 'gang' : zustand % 4 === 2 ? 'wand' : 'leer';
      const kanten: number[] = [];
      const anzKanten = zustand % 5;
      for (let k = 0; k < anzKanten; k++) {
        zustand = xorshift32(zustand);
        kanten.push(zustand % REF_GROESSE);
      }
      zustand = xorshift32(zustand);
      const breite = zustand % 10;
      zustand = xorshift32(zustand);
      const hoehe = zustand % 10;
      zustand = xorshift32(zustand);
      const tuer = art === 'raum' ? zustand % 2 : 0;
      knoten.set(i, { id: i, art, kanten, breite, hoehe, tuer });
    }
    let summe = 0;
    for (const k of knoten.values()) {
      summe += k.kanten.length + k.breite + k.hoehe + k.tuer;
      for (const nachbarId of k.kanten) {
        const nachbar = knoten.get(nachbarId);
        if (nachbar) summe += nachbar.breite;
      }
    }
    return summe;
  }

  // Aufwärmen: Die ersten Läufe messen den JIT, nicht die Arbeit — beide
  // Seiten, sonst würde die noch ungewärmte Referenz das Verhältnis der
  // ersten Saaten verzerren.
  for (let s = 1; s <= 20; s++) {
    erzeugeLayoutFuerKit(gross, s);
    referenzArbeit(s);
  }

  const messen = <T,>(fn: () => T): { cpu: number; ergebnis: T } => {
    const cpu0 = process.threadCpuUsage();
    const ergebnis = fn();
    const cpu = process.threadCpuUsage(cpu0);
    return { cpu: (cpu.user + cpu.system) / 1000, ergebnis };
  };
  const median = (werte: readonly number[]): number => {
    const sortiert = [...werte].sort((a, b) => a - b);
    return sortiert[Math.floor(sortiert.length / 2)]!;
  };

  const genZeiten: number[] = [];
  const verhaeltnisse: number[] = [];
  let raeume = 0;
  for (const seed of SEEDS) {
    // Reihenfolge wechselt mit der Saat: hebt einen einseitigen Aufwärm-
    // /Abkühleffekt über die 40 Saaten auf.
    let layout: ReturnType<typeof messen<ReturnType<typeof erzeugeLayoutFuerKit>>>;
    let referenz: ReturnType<typeof messen<number>>;
    if (seed % 2 === 0) {
      referenz = messen(() => referenzArbeit(seed));
      layout = messen(() => erzeugeLayoutFuerKit(gross, seed));
    } else {
      layout = messen(() => erzeugeLayoutFuerKit(gross, seed));
      referenz = messen(() => referenzArbeit(seed));
    }
    genZeiten.push(layout.cpu);
    verhaeltnisse.push(layout.cpu / referenz.cpu);
    raeume += layout.ergebnis.rooms.length;
  }

  const vMedian = median(verhaeltnisse);
  const vSchnitt = verhaeltnisse.reduce((a, b) => a + b, 0) / verhaeltnisse.length;
  const vMax = Math.max(...verhaeltnisse);
  const genMedian = median(genZeiten);
  console.log(
    `  ${verhaeltnisse.length} Saaten, ${(raeume / verhaeltnisse.length).toFixed(1)} Räume je Layout — ` +
      `Layout ${genMedian.toFixed(2)} ms (Hauptthread-CPU-Zeit, Median), ` +
      `Verhältnis Generator/Referenz: Median ${vMedian.toFixed(2)}, Schnitt ${vSchnitt.toFixed(2)}, Ausreisser ${vMax.toFixed(2)}`
  );

  /*
    Der MEDIAN der Verhältnisse ist kein eigener Check mehr — er ist bei
    diesem Testaufbau NACHWEISLICH TOT (Bericht „golden-kits N1",
    Abschnitt „Warum kein Median-Check"): In über 40 gemessenen Läufen
    (ruhig, unter beiden Lastformen, unter jedem Mutanten) wurde der
    Median KEIN EINZIGES Mal rot, ohne dass der Schnitt es nicht auch
    wurde — erwartbar, weil jeder hier gebaute Fehler additiv ist (der
    Generator wird höchstens langsamer, nie schneller) und der Schnitt
    jede zusätzliche Millisekunde direkt in die Summe trägt, während der
    Median bei einer Minderheit betroffener Saaten blind bleibt (siehe
    Viertel-Saaten-Mutant unten). Eine Prüfung, die nie unabhängig
    auslöst, ist die Definition von tot (dieselbe Lehre wie beim Angriff
    auf server/test/g12-tick-aufteilung.ts) — sie bleibt nur als
    Diagnosezeile in der Ausgabe.

    Schwellen aus GEMESSENEN Verhältnissen (Bericht „golden-kits N1",
    Tabellen „Ruhige Verhältnisse" / „Lastform b"):
      - Ruhig, 20 frische Prozesse der ECHTEN Testdatei: Schnitt
        1,00–1,14, Ausreisser (lautestes von 40 Einzelverhältnissen) bis
        3,77.
      - Lastform (a), 6 ALU- + 4 Speicher-Brenner, 6 Läufe: Schnitt
        0,74–1,14 — KEIN Anstieg gegenüber ruhig, die Verschränkung hält.
      - Lastform (b), 8 angeheftete Brenner mit dem Test auf Kern 0, 6
        Läufe: Schnitt bis 1,31 — hier hält die Verschränkung NICHT
        vollständig: Erzwungene Kernteilung mit einem Brenner trifft den
        größeren, komplexeren Speicherfußabdruck des echten Generators
        (200+ Räume, verschachtelte Graphstruktur) nachweisbar stärker
        als den kleineren Referenzkern — eine reale, keine eingebildete
        Differenz (siehe Bericht). Das bestimmt die Untergrenze für die
        Schwelle, nicht der Ruhezustand.
    SCHWELLE_SCHNITT = 1,45 liegt rund 11 % über dem höchsten unter
    Lastform (b) gemessenen Wert (1,31) — 0 Fehlalarme in 32 Läufen
    (20 ruhig + 6a + 6b). SCHWELLE_AUSREISSER = 5,0 liegt rund 33 % über
    dem höchsten ruhigen Ausreisser (3,77).
  */
  const SCHWELLE_SCHNITT = 1.45;
  const SCHWELLE_AUSREISSER = 5.0;
  check(
    `Schnitt-Verhältnis Generator/Referenz unter ${SCHWELLE_SCHNITT}`,
    vSchnitt < SCHWELLE_SCHNITT,
    `${vSchnitt.toFixed(2)} (Median zur Diagnose: ${vMedian.toFixed(2)})`
  );
  check(`kein Ausreisser-Verhältnis über ${SCHWELLE_AUSREISSER}`, vMax < SCHWELLE_AUSREISSER, `${vMax.toFixed(2)}`);

  /*
    Größenordnungswächter statt Ausreisserprüfung auf Prozess-CPU
    (Angriff, Befund E2): Die alte 30-ms-Prüfung auf PROZESS-CPU löste
    unter freien Kernen durch V8-Hilfsthreads aus und wurde GENAU DANN
    blind, wenn die Maschine gesättigt war (die Hilfsthreads werden dann
    verdrängt, die Spitzen verschwinden, während der Median steigt) —
    die falsche Richtung für eine Prüfung. Der Ersatz ist ein grober, auf
    Hauptthread-CPU umgestellter MEDIAN-Wächter: Er fängt eine
    GRÖSSENORDNUNG (der Verteiler ruft aus Versehen den viel teureren
    1.0-Pfad statt des Rasterpfads auf), nicht ein Prozent — dafür sind
    Schnitt und Ausreisser oben zuständig. 30 ms liegt weit über jeder
    gemessenen Last: ruhig 6–9 ms, unter Lastform (a) 10–14 ms, unter
    Lastform (b) 12–13 ms, unter dem stärksten Mutanten und Lastform (a)
    zusammen bis 23 ms (Bericht „golden-kits N1").
  */
  const ABS_GRENZE_MS = 30;
  check(
    `Hauptthread-Median unter ${ABS_GRENZE_MS} ms (Größenordnungswächter)`,
    genMedian < ABS_GRENZE_MS,
    `${genMedian.toFixed(2)} ms`
  );

  /*
    Wartezeit (Wanduhr minus Hauptthread-CPU) bewusst KEIN eigener Check
    (Karte, Abschnitt „Wartezeit"; Bericht „golden-kits N1", Abschnitt
    „Wartezeit-Entscheidung"): Die Idee — Layout- und Referenz-Lücke
    unter derselben Last vergleichen, weil beide gleich verdrängt werden
    — ist im Prinzip richtig (g12 nutzt dasselbe Prinzip für eine bekannte
    Verzögerung). Hier ist die Lücke aber schon RUHIG so unruhig, dass
    kein stabiler Schwellenwert bliebe: In eigenen Messungen (40 Saaten,
    mehrere Läufe) schwankte die Lücke je Saat zwischen rund 0 und 1,8 ms
    — allein durch normale Zeitscheiben-/GC-Granularität, nicht durch
    Warten. Ein `Atomics.wait`-Mutant mit 5-7 ms Wartezeit je Layout (das
    Fünf- bis Siebenfache der Basisarbeit) wäre damit nicht zuverlässig
    von Rauschen zu unterscheiden, ohne die Schwelle so weit zu setzen,
    dass sie unterhalb dessen nichts mehr fängt. Da `generateGridLayout`
    ausschließlich synchron rechnet (kein `await`, `readFile`, `Worker`
    oder `setTimeout` in der Datei), ist ein echtes Blockieren zudem kein
    naheliegender Regressionsweg — die Lücke bleibt hier offen
    dokumentiert statt mit einer Prüfung verdeckt, die nur zufällig
    grün oder rot wird.
  */
}

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün.');
}
