/**
 * Buchführung des Sammellaufs (Laufzeitzeuge): Was der Runner WIRKLICH
 * gestartet hat, wird gegen die Liste KERN gehalten, und die Schlusszeile samt
 * Exit-Code kommt aus dieser Buchführung.
 *
 * Warum: Ein Zeuge, der den Quelltext von run-tests.mjs mustert, kann nur
 * prüfen, wie die Schleife aussieht. Ob die Tests laufen, sagt er nicht — mit
 * einem Lockvogel-Aufruf und dem echten Start an anderer Stelle (oder mit
 * falschen Argumenten) meldete der Runner „250/250 grün in 0 s". Hier zählt
 * dagegen, was beim Start herausgekommen ist:
 *
 *   neueBuchfuehrung(prozess)     leeres Buch; setzt den Exit-Code auf 1 — ein Lauf,
 *                                 der `beende` nie erreicht, ist rot
 *   fahre(buch, spawn, …)         startet einen Test und bucht Befehl und Testdatei, die WIRKLICH
 *                                 an den Kindprozess gehen (die letzte Skript-Datei in den
 *                                 Argumenten, nicht die Schleifenvariable)
 *   ueberspringe(buch, …)         bucht einen durch eine Weiche übersprungenen Eintrag
 *   auslassen(buch, …, grund)     bucht einen absichtlich ausgelassenen Eintrag (Filter)
 *   leereUndBeende(prozess, code) lässt stdout/stderr leerlaufen und ruft dann erst `exit` (auch für Signalwege)
 *   beende(buch, optionen)        liest die Soll-Liste aus dem LITERAL von KERN im Quelltext
 *                                 (nicht aus der lebenden Variablen), vergleicht, druckt die
 *                                 Schlusszeile aus den GEBUCHTEN Zahlen und beendet den Prozess
 *
 * Exit-Codes von `beende`: 0 alles gebucht und grün; 1 ein Test rot, ein Eintrag nie
 * gestartet, ein fremder Test gestartet, oder gar kein Test gefahren; 3 TEILLAUF
 * (Einträge mit `auslassen` ausgelassen) — nur mit `teillaufErlaubt` ist ein grüner
 * Teillauf Exit 0. Ein Lauf, der weniger als die volle Liste fährt, sagt das also im
 * Exit-Code, nicht nur im Text.
 *
 * Verglichen werden MENGEN von Dateien, nicht Aufrufzahlen: ein wiederholter
 * flackernder Test oder ein Schalter vor der Datei (`tsx --tsconfig x.json datei`) sind
 * keine Fehler. Der Runner darf beliebig umgebaut werden (Helfer, Teillisten, Filter,
 * `async main`, Parallelisierung) — er muss nur jeden Start über `fahre` buchen und
 * am Ende `beende` rufen; tut er das nicht, bleibt der Exit-Code bei 1.
 *
 * Gebucht wird auch der BEFEHL: `beende` verlangt, dass jeder Test mit dem erwarteten Läufer
 * gestartet wurde (`node_modules/.bin/tsx` unter der Wurzel). Ein Token im Runner
 * (`tsx` → `/usr/bin/true`) meldet sonst „250/250 grün in 0 s".
 *
 * GRENZEN (so gemeldet, damit sie der Nächste nicht suchen muss):
 *  - KEINE Mindestzahl gefahrener Tests. Ein Lauf mit 1 gefahrenen und 249 durch Weichen
 *    übersprungenen Tests ist Exit 0. Das ist Absicht: die CI fährt mit
 *    WOV_OHNE_MODELLE=1 und überspringt dort legitim viel; ob eine Weiche zu Recht
 *    überspringt, prüft scripts/pruefe-weichen.mjs, nicht dieses Modul. Nur „kein einziger
 *    Test gefahren" ist rot.
 *  - Sie kann nicht beweisen, dass ein Kindprozess etwas gemessen hat: ein ausgetauschtes
 *    `node_modules/.bin/tsx` (ein Skript mit `exit 0`) oder eine ersetzte Startfunktion
 *    (`starteKind` durch eine Attrappe) ist nicht zu erkennen. Wer `fahre`, `beende` oder
 *    dieses Modul selbst umschreibt, kann die Buchführung täuschen.
 *  - Eine Weiche, die immer überspringt, ist gebucht als „übersprungen".
 *
 * Bookkeeping for the collective run: what the runner really started is held against the
 * LITERAL of KERN; the closing line and the exit code come from the books, and a run that
 * never closes them stays red.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const SKRIPT_DATEI = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/i;

/**
 * The entries of the top-level `const KERN = [...]` of `quelltext`, read from the syntax
 * tree with the TypeScript module `ts`. Only the declaration at the top level of the file
 * counts (a `KERN` in a function or block registers nothing). `...NAME` is followed when
 * NAME is a top-level array literal (lists in parts); anything else that is not a
 * `['ordner', 'datei']` of text literals is `unlesbar`. `fehler` holds problems with the
 * declaration itself.
 */
export function leseKern(ts, quelltext) {
  const baum = ts.createSourceFile('run-tests.mjs', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const eintraege = [];
  const unlesbar = [];
  const fehler = [];
  const zeile = (n) => baum.getLineAndCharacterOfPosition(n.getStart(baum)).line + 1;
  const kurz = (n) => n.getText(baum).replace(/\s+/g, ' ').slice(0, 80);
  const oberste = new Map();
  const deklarationen = [];
  for (const anweisung of baum.statements) {
    if (!ts.isVariableStatement(anweisung)) continue;
    for (const d of anweisung.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      oberste.set(d.name.text, d.initializer);
      if (d.name.text === 'KERN') deklarationen.push(d);
    }
  }
  const text = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null);
  const lies = (liste, name, besucht) => {
    for (const eintrag of liste.elements) {
      if (ts.isSpreadElement(eintrag) && ts.isIdentifier(eintrag.expression)) {
        const teil = oberste.get(eintrag.expression.text);
        if (teil && ts.isArrayLiteralExpression(teil) && !besucht.has(eintrag.expression.text)) {
          lies(teil, eintrag.expression.text, new Set(besucht).add(eintrag.expression.text));
          continue;
        }
      }
      const [ordner, datei] = ts.isArrayLiteralExpression(eintrag) ? eintrag.elements : [];
      if (text(ordner) === null || text(datei) === null) {
        unlesbar.push(`${name}: ${kurz(eintrag)}`);
        continue;
      }
      eintraege.push([text(ordner), text(datei)]);
    }
  };
  if (deklarationen.length === 0) {
    fehler.push('die Liste KERN steht nicht auf oberster Ebene von run-tests.mjs (Zeuge blind)');
  } else if (deklarationen.length > 1) {
    fehler.push(`KERN ist mehrfach auf oberster Ebene deklariert (Zeilen ${deklarationen.map(zeile).join(', ')})`);
  } else {
    const [d] = deklarationen;
    if (!d.initializer || !ts.isArrayLiteralExpression(d.initializer)) {
      fehler.push(`KERN (Zeile ${zeile(d)}) ist kein Array-Literal, die Einträge sind nicht lesbar`);
    } else {
      lies(d.initializer, 'KERN', new Set());
    }
  }
  return { eintraege, unlesbar, fehler };
}

/** A fresh book. Sets the exit code to 1: until `beende` decides, the run counts as red. */
export function neueBuchfuehrung(prozess = process) {
  prozess.exitCode = 1;
  return { gefahren: new Set(), uebersprungen: new Set(), ausgelassen: new Set(), befehle: new Set(), prozess };
}

/**
 * Starts one test through `spawn(befehl, argumente, optionen)` and books the command and the test file that
 * goes to the child: the LAST script file among the arguments, relative to `optionen.cwd`
 * (so `tsx --tsconfig x.json test/a.ts` books `test/a.ts`). No script file among the
 * arguments is booked as "(keine Testdatei …)" and reported at the end. Returns what
 * `spawn` returns (a result or a promise of one).
 */
export function fahre(buch, spawn, befehl, argumente, optionen) {
  const datei = [...(argumente ?? [])].reverse().find((a) => typeof a === 'string' && SKRIPT_DATEI.test(a));
  buch.gefahren.add(datei ? resolve(optionen?.cwd ?? '', datei) : `(keine Testdatei: ${JSON.stringify(argumente)})`);
  buch.befehle.add(String(befehl));
  return spawn(befehl, argumente, optionen);
}

export function ueberspringe(buch, wurzel, paket, datei) {
  buch.uebersprungen.add(resolve(wurzel, paket, datei));
}

export function auslassen(buch, wurzel, paket, datei, grund) {
  if (typeof grund !== 'string' || grund.trim().length === 0) throw new Error(`auslassen ohne Grund: ${paket}/${datei}`);
  buch.ausgelassen.add(resolve(wurzel, paket, datei));
}

/**
 * The comparison. `soll` is a collection of absolute paths. Returns
 * `{ befunde, gefahren, uebersprungen, ausgelassen }`; the three numbers count the entries of
 * `soll` that were run, skipped by a switch, and left out on purpose.
 */
export function abschluss(buch, soll, wurzel = '') {
  const erwartet = new Set(soll);
  const zeigen = (pfad) => (wurzel && pfad.startsWith(wurzel) ? relative(wurzel, pfad) : pfad);
  const nenne = (liste) => `${liste.slice(0, 5).map(zeigen).join(', ')}${liste.length > 5 ? `, … (${liste.length} insgesamt)` : ''}`;
  const gebucht = new Set([...buch.gefahren, ...buch.uebersprungen, ...buch.ausgelassen]);
  const nie = [...erwartet].filter((p) => !gebucht.has(p));
  const fremd = [...gebucht].filter((p) => !erwartet.has(p));
  const befunde = [];
  if (nie.length > 0) befunde.push(`${nie.length} Test(s) aus KERN nie gestartet, übersprungen oder ausgelassen: ${nenne(nie)}`);
  if (fremd.length > 0) befunde.push(`${fremd.length} gestartete(r) Test(s) stehen nicht in KERN: ${nenne(fremd)}`);
  const inSoll = (menge) => [...menge].filter((p) => erwartet.has(p)).length;
  return {
    befunde,
    gefahren: inSoll(buch.gefahren),
    uebersprungen: inSoll(buch.uebersprungen),
    ausgelassen: inSoll(buch.ausgelassen),
  };
}

/**
 * Closes the run: reads the list from the literal in `quelle` (the source of run-tests.mjs),
 * compares, prints the closing line from the booked numbers and ends the process.
 * `fehler` is the number of red tests (and guards) the runner counted; `dauer` is text for
 * the closing line. `ts` may be handed in (tests); otherwise the TypeScript module is loaded.
 * `laeufer` is the command every test must have been started with (default: `node_modules/.bin/tsx`
 * under `wurzel`); a test started with any other command is a finding.
 */
export async function beende(
  buch,
  { quelle, wurzel, fehler = 0, teillaufErlaubt = false, dauer = '', ts = null, ausgabe = console.log, laeufer = resolve(wurzel, 'node_modules/.bin/tsx') },
) {
  const vorab = [];
  let soll = new Set();
  try {
    const tsModul = ts ?? (await import('typescript')).default;
    const gelesen = leseKern(tsModul, readFileSync(quelle, 'utf8'));
    vorab.push(...gelesen.fehler, ...gelesen.unlesbar.map((u) => `Eintrag nicht lesbar: ${u}`));
    soll = new Set(gelesen.eintraege.map(([ordner, datei]) => resolve(wurzel, ordner, datei)));
  } catch (fehlerLesen) {
    vorab.push(`die Liste KERN ist im Quelltext nicht lesbar: ${fehlerLesen.message}`);
  }
  const gebucht = abschluss(buch, soll, wurzel);
  const befunde = [...vorab, ...gebucht.befunde];
  const fremdeLaeufer = [...buch.befehle].filter((b) => b !== laeufer);
  if (fremdeLaeufer.length > 0) befunde.push(`Test(s) mit unerwartetem Läufer gestartet (erwartet ${laeufer}): ${fremdeLaeufer.join(', ')}`);
  if (soll.size === 0 && vorab.length === 0) befunde.push('KERN ist leer');
  if (gebucht.gefahren === 0 && befunde.length === 0) befunde.push('kein einziger Test wurde gefahren');
  let code;
  if (befunde.length > 0) {
    ausgabe('\n✗ Der Sammellauf hat nicht gefahren, was in KERN steht (Buchführung, scripts/runner-buchfuehrung.mjs):');
    for (const befund of befunde) ausgabe(`  ${befund}`);
    ausgabe(`\nROT — ${gebucht.gefahren} von ${soll.size} Tests gefahren, Buchführung stimmt nicht${dauer ? `,${dauer}` : ''}`);
    code = 1;
  } else {
    const gruen = Math.max(0, gebucht.gefahren - fehler);
    const teillauf = gebucht.ausgelassen > 0;
    ausgabe(
      `\n${gruen}/${soll.size} Tests grün` +
        (gebucht.uebersprungen > 0 ? `, ${gebucht.uebersprungen} übersprungen` : '') +
        (teillauf ? `, ${gebucht.ausgelassen} ausgelassen (TEILLAUF, kein voller Lauf)` : '') +
        dauer,
    );
    if (fehler > 0) {
      code = 1;
    } else if (teillauf && !teillaufErlaubt) {
      ausgabe('TEILLAUF: nicht die volle Liste gefahren — Exit 3 (gewollt? dann mit --teillauf-erlaubt aufrufen)');
      code = 3;
    } else {
      code = 0;
    }
  }
  await leereUndBeende(buch.prozess, code);
}

/**
 * Ends the process with `code` only after stdout and stderr have taken everything written so far.
 * `process.exit` with a full pipe (`| tee`, CI) drops the queued rest of the report (measured: it
 * cut off at 65 536 bytes), and the summary stands at the end. An empty write completes after the
 * writes before it. If the reader is gone or stuck, `frist` ms bound the wait; the exit code is the
 * same either way. A fake process without streams (tests) is ended at once.
 */
export async function leereUndBeende(prozess, code, frist = 10_000) {
  prozess.exitCode = code;
  const strome = [prozess.stdout, prozess.stderr].filter((s) => s && typeof s.write === 'function');
  let zeitgeber;
  try {
    await Promise.race([
      Promise.all(
        strome.map(
          (s) =>
            new Promise((fertig) => {
              s.once('error', fertig); // a closed pipe (EPIPE) must not turn the exit code into a crash
              s.write('', fertig);
            }),
        ),
      ),
      new Promise((fertig) => {
        zeitgeber = setTimeout(fertig, frist);
      }),
    ]);
  } finally {
    clearTimeout(zeitgeber);
  }
  prozess.exit(code);
}
