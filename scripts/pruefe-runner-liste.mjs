#!/usr/bin/env node
/**
 * Prüft: jede Testdatei im Baum steht im Sammellauf (`npm test`) — oder mit
 * Grund auf der Ausnahmeliste weiter unten.
 *
 * Paket 0.10 (verwaiste Tests). Der Sammellauf führt eine von Hand gepflegte
 * Liste. Wer eine Testdatei anlegt und sie dort nicht einträgt, hat einen
 * Test, der nie läuft — und der Sammellauf bleibt grün. Neun Dateien lagen
 * so wochenlang herum, drei weitere kamen mit den letzten Karten dazu. Dieser
 * Zeuge dreht die Frage um: Er geht vom BAUM aus und fragt, ob der Runner die
 * Datei kennt.
 *
 * Was als Testdatei gilt: jede Datei mit Skript-Endung (ts, tsx, mts, cts,
 * js, jsx, mjs, cjs, py; Groß-/Kleinschreibung egal) und
 *   - unterhalb eines Ordners `test`, `tests` oder `__tests__` (auch
 *     `Test`), oder
 *   - mit Namen `*.test.*` oder `*.spec.*`, oder
 *   - mit Namen `pruefe-*` (die Zeugen).
 * Symlinks auf Ordner werden verfolgt (mit Schutz gegen Schleifen).
 * Übersprungen werden `node_modules`, `.git`, `assets` und Bauordner.
 *
 * Was der Runner kennt: die Einträge der Liste `KERN` in `scripts/run-tests.mjs`,
 * gelesen am Syntaxbaum (nicht per Textsuche — Kommentare nennen Dateinamen,
 * und ein umformatierter Eintrag bliebe für eine Textsuche unsichtbar). Es
 * zählt nur die Deklaration auf OBERSTER Ebene; eine gleichnamige Liste in
 * einer Funktion oder einem Block schaltet keine Datei ein. Ein Eintrag, der
 * sich nicht als `['ordner', 'datei']` mit Textliteralen lesen lässt, ist
 * selbst ein Befund.
 *
 * Der Zeuge prüft außerdem, dass der Runner die Liste wirklich fährt, die er
 * liest: Auf oberster Ebene steht genau eine Schleife, die Tests startet
 * (`spawnSync`), und sie läuft über `KERN` selbst — nicht über eine Kopie,
 * einen Filter oder eine andere Liste. Sonst kommt `KERN` nur noch lesend als
 * `KERN.length` vor. Ein Textmuster für „die Standardliste ist KERN" würde
 * eine unbenutzte Lockvogel-Zeile täuschen; die Schleife lässt sich nicht
 * ablenken. (Bis 20.09.2026 gab es daneben eine Liste `LANG` und den Schalter
 * `--alle`; beides ist weg, seit die drei Tests darin in KERN stehen.)
 *
 * Wer eine Datei gar nicht eintragen kann, trägt sie in `AUSNAHMEN` ein:
 *   werkzeug  kein Test: Messbank, Bündel-Einstieg, Blender-Skript oder ein
 *             Prüfer, der Argumente (Ausgabeordner, URL) braucht
 *   rot       ein Test, der bei erfüllten Voraussetzungen rot ist und aus
 *             gutem Grund nicht im Lauf steht; verlangt `seit` (echtes Datum
 *             JJJJ-MM-TT, nicht in der Zukunft). Er wird bei JEDEM Lauf
 *             namentlich gemeldet, und `--pruefe-rot` führt ihn aus und
 *             schlägt an, wenn er grün geworden ist
 * Beides ist Buchführung, keine Streichung: Die Datei bleibt, wo sie ist.
 * Pfade stehen kanonisch (`a/b/c.ts`, kein `./`, kein `..`). Eine Ausnahme
 * ohne Grund, für eine Datei, die es nicht mehr gibt, oder für eine Datei,
 * die inzwischen eingetragen ist, ist ein Befund.
 *
 * Damit der Zeuge nicht selbst „immer grün" sein kann, baut er zuerst in
 * einem Wegwerfordner einen Mini-Baum und probt an ihm jede Richtung
 * (Zahnprobe, Muster `pruefe-weichen.mjs`).
 *
 * Aufruf:  npx tsx scripts/pruefe-runner-liste.mjs [--pruefe-rot] [--wurzel=<ordner>]
 * `--pruefe-rot`  führt die `rot`-Ausnahmen aus (Sekunden) und meldet, welche
 *                 grün geworden sind; nicht Teil des Sammellaufs.
 * `--wurzel=`     prüft einen anderen Baum (mit eigenem `scripts/run-tests.mjs`).
 *
 * Guards the collective run: every test file in the tree is registered in
 * the top-level list KERN of scripts/run-tests.mjs, or carries a reason on the
 * exception list — and the runner's one test loop walks KERN itself.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HIER = dirname(fileURLToPath(import.meta.url));
const SKRIPT_ENDUNG = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/i;
const TESTORDNER = /^(test|tests|__tests__)$/i;
const TESTNAME = /\.(test|spec)\.[^./]+$/i;
const ZEUGENNAME = /^pruefe-/i;
const UEBERSPRUNGEN = new Set(['node_modules', '.git', 'assets', 'dist', 'build', '.svelte-kit']);
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/*
  Files that look like tests but are not in KERN. Paths are relative to the
  repository root, canonical. Keep `grund` in one line: it is printed.
  Kind `rot` also needs `seit` (YYYY-MM-DD, a real day, not in the future).
*/
const AUSNAHMEN = [
  // ── Werkzeuge und Messbänke (Begründung steht auch im Kopf von run-tests.mjs) ──
  { pfad: 'shared/test/geo-compare.ts', art: 'werkzeug', grund: 'braucht Referenz-Dumps als Argument (eingefrorener Übergangspfad)' },
  { pfad: 'shared/test/heightmap-compare.ts', art: 'werkzeug', grund: 'braucht Referenz-Dumps als Argument (eingefrorener Übergangspfad)' },
  { pfad: 'shared/test/geo-map.ts', art: 'werkzeug', grund: 'braucht Referenz-Dumps als Argument (eingefrorener Übergangspfad)' },
  { pfad: 'shared/test/geo-correlate.ts', art: 'werkzeug', grund: 'braucht Referenz-Dumps als Argument (eingefrorener Übergangspfad)' },
  { pfad: 'shared/test/math-golden.ts', art: 'werkzeug', grund: 'braucht Referenz-Werte-Dateien (random_values.txt, perlin_values.txt)' },
  { pfad: 'shared/test/rain-freq.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts' },
  { pfad: 'shared/test/heightmap-bench.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts' },
  { pfad: 'shared/test/dungeon2-browser-check.ts', art: 'werkzeug', grund: 'Bündel-Einstieg der Browser-Seite (benutzt document), kein Node-Test' },
  { pfad: 'client/test/durchgangshoehe-mess.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts (kein Ausstieg mit Fehlercode)' },
  { pfad: 'client/test/torbogen-hoehe-mess.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts (kein Ausstieg mit Fehlercode)' },
  // ── Browser-Seiten und Prüfer, die Argumente oder laufende Dienste brauchen ──
  { pfad: 'client/test/ironward-view.ts', art: 'werkzeug', grund: 'Skript der Sichtseite ironward-view.html (document, Canvas), kein Node-Test' },
  { pfad: 'client/test/wildwarden-view.ts', art: 'werkzeug', grund: 'Skript der Sichtseite wildwarden-view.html (document, Canvas), kein Node-Test' },
  { pfad: 'tools/armor/test/armor-motion.py', art: 'werkzeug', grund: 'Blender-Skript (bpy), braucht master.blend und Ausgabeordner als Argumente' },
  { pfad: 'tools/armor/test/emberrage-assets.mjs', art: 'werkzeug', grund: 'braucht die Exportordner (Wurzel, Referenz) als Argumente' },
  { pfad: 'tools/armor/test/emberrage-browser.mjs', art: 'werkzeug', grund: 'echtes WebGL über Playwright, braucht den gebauten wov-web und die Exporte' },
  { pfad: 'tools/armor/test/equipment-set-assets.mjs', art: 'werkzeug', grund: 'prüft einen laufenden Server per HTTP, URL als Argument' },
  { pfad: 'tools/armor/test/legacy-female-armor.mjs', art: 'werkzeug', grund: 'braucht Körper-GLB, Exportordner und Passform-Bericht als Argumente' },
  { pfad: 'tools/armor/test/skin-gate.mjs', art: 'werkzeug', grund: 'braucht Körper-GLB und Exportordner als Argumente; der Tor-Selbsttest steht im Runner' },
  { pfad: 'tools/armor/test/validate-glbs.cjs', art: 'werkzeug', grund: 'braucht Exportordner und den Validator-Pfad als Argumente' },
  { pfad: 'tools/test/vorschau-kopf.mjs', art: 'werkzeug', grund: 'Browserprobe (Playwright, echtes WebGL), braucht Chromium auf mike-pc' },
  // ── Rot bei erfüllten Voraussetzungen, nicht eingetragen ──
  {
    pfad: 'server/test/f2-locations.ts',
    art: 'rot',
    seit: '2026-08-16',
    grund: 'ruhend (Kopfkommentar): FEATURES ist leer, 3 Prüfungen rot — auf eigene Location-Modelle',
  },
];

/** `a/./b`, `./a`, `a/../a`, backslashes → `a/b`, `a`. */
const kanonisch = (pfad) => posix.normalize(String(pfad).split('\\').join('/'));

/**
 * `text` is `JJJJ-MM-TT`, names a day that exists (no 2026-02-31, no 0000-00-00)
 * and is not in the future. One day of slack at most: somebody in UTC+14 already
 * writes tomorrow's date while it is still today in UTC.
 */
function istEchtesDatum(text, jetzt = Date.now()) {
  const teile = typeof text === 'string' ? DATUM.exec(text) : null;
  if (!teile) return false;
  const [jahr, monat, tag] = teile.slice(1).map(Number);
  const tagNull = new Date(Date.UTC(2000, monat - 1, tag));
  tagNull.setUTCFullYear(jahr);
  // Date rolls 2026-02-31 over to March; a real day survives the round trip.
  if (tagNull.getUTCFullYear() !== jahr || tagNull.getUTCMonth() !== monat - 1 || tagNull.getUTCDate() !== tag) return false;
  return tagNull.getTime() <= jetzt + 14 * 3600 * 1000;
}

/**
 * Every candidate test file below `wurzel` (root-relative, `/`): see the header for
 * what counts. Symlinked folders are followed; a link back into the chain stops.
 */
function kandidaten(wurzel) {
  const funde = [];
  const geh = (ordner, imTest, kette) => {
    let echt;
    try {
      echt = realpathSync(ordner);
    } catch {
      return;
    }
    if (kette.has(echt)) return;
    const naechste = new Set(kette).add(echt);
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const voll = join(ordner, eintrag.name);
      let istOrdner = eintrag.isDirectory();
      if (!istOrdner && eintrag.isSymbolicLink()) {
        try {
          istOrdner = statSync(voll).isDirectory();
        } catch {
          istOrdner = false;
        }
      }
      if (istOrdner) {
        if (!UEBERSPRUNGEN.has(eintrag.name)) geh(voll, imTest || TESTORDNER.test(eintrag.name), naechste);
      } else if (
        SKRIPT_ENDUNG.test(eintrag.name) &&
        (imTest || TESTNAME.test(eintrag.name) || ZEUGENNAME.test(eintrag.name))
      ) {
        funde.push(kanonisch(relative(wurzel, voll).split(sep).join('/')));
      }
    }
  };
  geh(wurzel, false, new Set());
  return funde.sort();
}

/**
 * The `[ordner, datei, weiche?]` entries of KERN, read from the syntax tree, plus
 * `formfehler`: everything about the runner's shape that would let its list and
 * its run drift apart.
 *
 * Only the declaration at the top level of the file counts (a `KERN` in a function
 * or block registers nothing). The run is the top-level `for...of` that calls
 * `spawnSync`; it must walk `KERN` itself. Any other mention of the identifier
 * `KERN` — a copy, a `.splice`, `.length = 0`, a call argument, a second
 * declaration — is a finding, so nothing can change what the loop walks after
 * the fact. Reading `KERN.length` is allowed (the summary line).
 */
function eingetragene(quelltext) {
  const baum = ts.createSourceFile('run-tests.mjs', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const kern = [];
  const unlesbar = [];
  const formfehler = [];
  const zeile = (n) => baum.getLineAndCharacterOfPosition(n.getStart(baum)).line + 1;
  const kurz = (n) => n.getText(baum).replace(/\s+/g, ' ').slice(0, 80);
  const erlaubt = new Set();

  // The list: a `const KERN = [...]` directly in the file.
  const deklarationen = [];
  for (const anweisung of baum.statements) {
    if (!ts.isVariableStatement(anweisung)) continue;
    for (const d of anweisung.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'KERN') deklarationen.push(d);
    }
  }
  if (deklarationen.length === 0) {
    formfehler.push('die Liste KERN steht nicht auf oberster Ebene von run-tests.mjs (Zeuge blind)');
  } else if (deklarationen.length > 1) {
    formfehler.push(`KERN ist mehrfach auf oberster Ebene deklariert (Zeilen ${deklarationen.map(zeile).join(', ')})`);
  } else {
    const [d] = deklarationen;
    erlaubt.add(d.name);
    if (!(d.parent.flags & ts.NodeFlags.Const)) formfehler.push(`KERN (Zeile ${zeile(d)}) ist nicht \`const\``);
    if (!d.initializer || !ts.isArrayLiteralExpression(d.initializer)) {
      formfehler.push(`KERN (Zeile ${zeile(d)}) ist kein Array-Literal, die Einträge sind nicht lesbar`);
    } else {
      for (const eintrag of d.initializer.elements) {
        const [ordner, datei] = ts.isArrayLiteralExpression(eintrag) ? eintrag.elements : [];
        const text = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null);
        if (text(ordner) === null || text(datei) === null) {
          unlesbar.push(`KERN: ${kurz(eintrag)}`);
          continue;
        }
        kern.push(kanonisch(`${text(ordner)}/${text(datei)}`));
      }
    }
  }

  // The run: exactly one top-level loop that starts tests, and it walks KERN.
  const startetTests = (knoten) => {
    let gefunden = false;
    const such = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'spawnSync') gefunden = true;
      if (!gefunden) ts.forEachChild(n, such);
    };
    such(knoten);
    return gefunden;
  };
  const laeufe = baum.statements.filter((a) => ts.isForOfStatement(a) && startetTests(a.statement));
  if (laeufe.length === 0) {
    formfehler.push('kein Lauf: auf oberster Ebene fehlt die `for (… of KERN)`-Schleife, die Tests mit spawnSync startet');
  } else if (laeufe.length > 1) {
    formfehler.push(`mehrere Schleifen starten Tests (Zeilen ${laeufe.map(zeile).join(', ')}); erwartet genau eine über KERN`);
  }
  for (const lauf of laeufe) {
    if (ts.isIdentifier(lauf.expression) && lauf.expression.text === 'KERN') {
      erlaubt.add(lauf.expression);
    } else {
      formfehler.push(`der Lauf (Zeile ${zeile(lauf)}) geht nicht über KERN, sondern über: ${kurz(lauf.expression)}`);
    }
  }

  // Every other mention of KERN could change what the loop walks.
  const wirdGeschrieben = (zugriff) => {
    const eltern = zugriff.parent;
    if (
      ts.isBinaryExpression(eltern) &&
      eltern.left === zugriff &&
      eltern.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      eltern.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      return true;
    }
    if (
      (ts.isPrefixUnaryExpression(eltern) || ts.isPostfixUnaryExpression(eltern)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(eltern.operator)
    ) {
      return true;
    }
    return ts.isDeleteExpression(eltern);
  };
  const besuche = (knoten) => {
    if (ts.isIdentifier(knoten) && knoten.text === 'KERN' && !erlaubt.has(knoten)) {
      const eltern = knoten.parent;
      const alsName =
        (ts.isPropertyAccessExpression(eltern) && eltern.name === knoten) ||
        (ts.isPropertyAssignment(eltern) && eltern.name === knoten);
      const laenge =
        ts.isPropertyAccessExpression(eltern) &&
        eltern.expression === knoten &&
        eltern.name.text === 'length' &&
        !wirdGeschrieben(eltern);
      if (!alsName && !laenge) {
        let anweisung = knoten;
        while (anweisung.parent && !ts.isBlock(anweisung.parent) && !ts.isSourceFile(anweisung.parent)) anweisung = anweisung.parent;
        formfehler.push(
          `KERN kommt in Zeile ${zeile(knoten)} an unerwarteter Stelle vor (erlaubt: die Deklaration, die Schleife, lesend KERN.length): ${kurz(anweisung)}`,
        );
      }
    }
    ts.forEachChild(knoten, besuche);
  };
  besuche(baum);
  // Two identifiers in one statement report the same line once.
  return { kern, unlesbar, formfehler: [...new Set(formfehler)] };
}

/** All findings for the tree at `wurzel`; an empty list is a pass. */
function befunde(wurzel, ausnahmen) {
  const lauf = join(wurzel, 'scripts', 'run-tests.mjs');
  if (!existsSync(lauf)) return [`scripts/run-tests.mjs fehlt unter ${wurzel}`];
  const { kern, unlesbar, formfehler } = eingetragene(readFileSync(lauf, 'utf8'));
  const gefunden = [...formfehler];
  for (const u of unlesbar) gefunden.push(`Eintrag nicht lesbar (kein [ordner, datei] aus Textliteralen): ${u}`);

  // Entries of KERN: duplicates and missing files.
  const inKern = new Set();
  for (const pfad of kern) {
    if (inKern.has(pfad)) gefunden.push(`doppelt eingetragen (KERN): ${pfad}`);
    inKern.add(pfad);
    if (!existsSync(join(wurzel, pfad))) gefunden.push(`eingetragen, aber die Datei fehlt: ${pfad}`);
  }

  const bekannteAusnahmen = new Set();
  for (const { pfad, art, grund, seit } of ausnahmen) {
    const kanon = kanonisch(pfad);
    if (kanon !== pfad) gefunden.push(`Ausnahme: Pfad nicht kanonisch geschrieben: ${pfad} (gemeint: ${kanon})`);
    if (bekannteAusnahmen.has(kanon)) gefunden.push(`Ausnahme doppelt: ${kanon}`);
    bekannteAusnahmen.add(kanon);
    if (!['werkzeug', 'rot'].includes(art)) gefunden.push(`Ausnahme ${kanon}: unbekannte Art "${art}"`);
    if (typeof grund !== 'string' || grund.trim().length === 0) gefunden.push(`Ausnahme ohne Grund: ${kanon}`);
    if (art === 'rot' && !istEchtesDatum(seit)) {
      gefunden.push(`Ausnahme ${kanon} (rot): "seit" fehlt, ist kein echtes Datum JJJJ-MM-TT oder liegt in der Zukunft: ${JSON.stringify(seit)}`);
    }
    if (!existsSync(join(wurzel, kanon))) gefunden.push(`Ausnahme für eine Datei, die es nicht mehr gibt: ${kanon}`);
    if (inKern.has(kanon)) {
      gefunden.push(`Ausnahme widerspricht dem Runner (steht dort schon): ${kanon}`);
    }
  }

  for (const pfad of kandidaten(wurzel)) {
    if (!inKern.has(pfad) && !bekannteAusnahmen.has(pfad)) {
      gefunden.push(`verwaist — Testdatei steht weder in run-tests.mjs noch auf der Ausnahmeliste: ${pfad}`);
    }
  }
  return gefunden;
}

/** How to start a file: the runner's way for scripts (`tsx`, cwd = folder above `test`), else node/python. */
function starte(wurzel, pfad, tsxPfad) {
  const teile = pfad.split('/');
  const i = teile.findIndex((t) => TESTORDNER.test(t));
  const geteilt = i >= 0 ? i : teile.length - 1;
  const cwd = join(wurzel, ...teile.slice(0, geteilt));
  const datei = teile.slice(geteilt).join('/');
  const endung = pfad.slice(pfad.lastIndexOf('.')).toLowerCase();
  const [befehl, args] = ['.ts', '.tsx', '.mts', '.cts'].includes(endung)
    ? [tsxPfad, [datei]]
    : endung === '.py'
      ? ['python3', [datei]]
      : [process.execPath, [datei]];
  return spawnSync(befehl, args, { cwd, encoding: 'utf8', timeout: 300_000 });
}

/** Runs the `rot` exceptions; returns `{ pfad, rc }` per entry (rc 0 = turned green). */
function roteAusfuehren(wurzel, ausnahmen, tsxPfad) {
  return ausnahmen
    .filter((a) => a.art === 'rot' && existsSync(join(wurzel, kanonisch(a.pfad))))
    .map((a) => ({ pfad: kanonisch(a.pfad), rc: starte(wurzel, kanonisch(a.pfad), tsxPfad).status }));
}

let geprueft = 0;
let fehler = 0;
function pruefe(behauptung, text) {
  geprueft += 1;
  if (behauptung) {
    console.log(`  OK   ${text}`);
    return;
  }
  fehler += 1;
  console.log(`  FAIL ${text}`);
}

const EIGEN = process.argv.find((a) => a.startsWith('--wurzel='));
const WURZEL = EIGEN ? resolve(EIGEN.slice('--wurzel='.length)) : resolve(HIER, '..');
const ROT_PRUEFEN = process.argv.includes('--pruefe-rot');
const TSX = existsSync(join(WURZEL, 'node_modules/.bin/tsx'))
  ? join(WURZEL, 'node_modules/.bin/tsx')
  : join(HIER, '..', 'node_modules/.bin/tsx');

console.log('\n[1] Zahnprobe — der Zeuge muss in jede Richtung rot werden können');
{
  const wegwerf = mkdtempSync(join(tmpdir(), 'wov-runner-liste-'));
  const schreibe = (pfad, inhalt = '') => {
    mkdirSync(dirname(join(wegwerf, pfad)), { recursive: true });
    writeFileSync(join(wegwerf, pfad), inhalt);
  };
  // The smallest runner the witness accepts: the list, one loop over it, the count.
  const SCHLEIFE =
    "for (const [paket, datei] of KERN) {\n  spawnSync('tsx', [datei], { cwd: paket });\n}\nconsole.log(`${KERN.length} Tests`);\n";
  const runner = (kernEintraege, rest = SCHLEIFE) =>
    `import { spawnSync } from 'node:child_process';\nconst KERN = [\n${kernEintraege}\n];\n${rest}`;
  const grundEintraege = "  ['server', 'test/a.ts'],\n  ['client/test', 'c.ts'],";
  const setzeRunner = (...args) => schreibe('scripts/run-tests.mjs', runner(...args));
  try {
    setzeRunner(grundEintraege);
    schreibe('server/test/a.ts');
    schreibe('server/test/b.ts');
    schreibe('client/test/c.ts');
    // Places the walker must skip.
    schreibe('node_modules/x/test/d.ts');
    schreibe('assets/test/e.ts');
    schreibe('server/test/tmp-lauf/daten.json');
    const mit = (ausnahmen) => befunde(wegwerf, ausnahmen);
    const enthaelt = (liste, teil) => liste.some((b) => b.includes(teil));
    const ausnahmeB = { pfad: 'server/test/b.ts', art: 'werkzeug', grund: 'Probe' };

    console.log('  — Grundrichtungen');
    const ohne = mit([]);
    pruefe(
      ohne.length === 1 && enthaelt(ohne, 'verwaist') && enthaelt(ohne, 'server/test/b.ts'),
      `verwaiste Datei ⇒ genau ein Befund, der sie nennt (${ohne.length} Befund(e))`,
    );
    pruefe(
      !enthaelt(ohne, 'node_modules') && !enthaelt(ohne, 'assets/') && !enthaelt(ohne, 'daten.json'),
      'node_modules, assets und Nicht-Skript-Dateien werden nicht als Kandidaten gezählt',
    );
    pruefe(
      enthaelt(ohne, 'server/test/b.ts') && !enthaelt(ohne, 'client/test/c.ts'),
      'die Schreibweise [ordner/test, datei] und [ordner, test/datei] sind dieselbe Datei',
    );
    pruefe(mit([ausnahmeB]).length === 0, 'Ausnahme mit Grund ⇒ kein Befund');
    pruefe(enthaelt(mit([{ ...ausnahmeB, grund: '  ' }]), 'ohne Grund'), 'Ausnahme ohne Grund ⇒ Befund');
    pruefe(enthaelt(mit([{ ...ausnahmeB, art: 'egal' }]), 'unbekannte Art'), 'Ausnahme mit unbekannter Art ⇒ Befund');
    pruefe(
      enthaelt(mit([ausnahmeB, { pfad: 'server/test/weg.ts', art: 'werkzeug', grund: 'Probe' }]), 'nicht mehr gibt'),
      'tote Ausnahme (Datei fehlt) ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([ausnahmeB, { pfad: 'server/test/a.ts', art: 'werkzeug', grund: 'Probe' }]), 'widerspricht'),
      'Ausnahme für eine schon eingetragene Datei ⇒ Befund',
    );
    pruefe(enthaelt(mit([ausnahmeB, ausnahmeB]), 'Ausnahme doppelt'), 'doppelte Ausnahme ⇒ Befund');

    schreibe('scripts/pruefe-neu.mjs');
    pruefe(
      enthaelt(mit([ausnahmeB]), 'scripts/pruefe-neu.mjs'),
      'ein neuer Zeuge `pruefe-*` außerhalb eines test-Ordners wird auch verlangt',
    );
    rmSync(join(wegwerf, 'scripts/pruefe-neu.mjs'));

    setzeRunner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', 'test/a.ts'],`);
    const doppelt = mit([]);
    pruefe(
      enthaelt(doppelt, 'doppelt eingetragen (KERN): server/test/a.ts') && !enthaelt(doppelt, 'verwaist'),
      'Eintragen beseitigt den Befund „verwaist"; ein zweiter Eintrag derselben Datei wird gemeldet',
    );

    setzeRunner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', 'test/gibtsnicht.ts'],`);
    pruefe(enthaelt(mit([]), 'eingetragen, aber die Datei fehlt: server/test/gibtsnicht.ts'), 'Eintrag ohne Datei ⇒ Befund');

    setzeRunner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', dyn + '.ts'],`);
    pruefe(enthaelt(mit([]), 'nicht lesbar'), 'ein Eintrag, der sich nicht als Textliteral lesen lässt ⇒ Befund');

    /* A file name only mentioned in a comment is not an entry. */
    setzeRunner(`${grundEintraege}\n  // ['server', 'test/b.ts'],`);
    pruefe(enthaelt(mit([]), 'server/test/b.ts'), 'ein auskommentierter Eintrag zählt nicht als eingetragen');

    schreibe('scripts/run-tests.mjs', 'const ANDERS = [];\n');
    pruefe(enthaelt(mit([]), 'KERN'), 'ohne Liste KERN ⇒ Befund (der Zeuge sähe sonst nichts)');

    console.log('  — der Lauf geht über die Liste, die der Zeuge liest (M1)');
    const kernMitB = `${grundEintraege}\n  ['server', 'test/b.ts'],`;
    setzeRunner(kernMitB);
    pruefe(mit([]).length === 0, 'Ausgangslage: b.ts in KERN, eine Schleife über KERN, KERN.length gelesen ⇒ kein Befund');
    // The attacker's mutant of the old witness: an unused decoy line that looks like the
    // default-list check, while the loop really walks another list.
    const lockvogel = "const _unbenutzt = process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN;\n";
    const ueberListe = (ausdruck) => SCHLEIFE.replace('of KERN', `of ${ausdruck}`);
    setzeRunner(grundEintraege, `const LANG = [\n  ['server', 'test/b.ts'],\n];\n${lockvogel}const liste = LANG;\n${ueberListe('liste')}`);
    const lockvogelFall = mit([]);
    pruefe(
      enthaelt(lockvogelFall, 'geht nicht über KERN, sondern über: liste'),
      'Lockvogel-Zeile mit `--alle` und `const liste = LANG` ⇒ Befund: der Lauf geht nicht über KERN',
    );
    pruefe(
      enthaelt(lockvogelFall, 'server/test/b.ts'),
      'Lockvogel-Fall: die nur in einer anderen Liste stehende Datei gilt nicht als eingetragen',
    );
    setzeRunner(kernMitB, ueberListe('KERN.filter(() => true)'));
    pruefe(enthaelt(mit([]), 'geht nicht über KERN, sondern über: KERN.filter'), 'Schleife über einen Filter von KERN ⇒ Befund');
    setzeRunner(kernMitB, ueberListe('[...KERN]'));
    pruefe(enthaelt(mit([]), 'geht nicht über KERN, sondern über: [...KERN]'), 'Schleife über eine Kopie von KERN ⇒ Befund');
    setzeRunner(kernMitB, `function fahre() {\n${ueberListe('KERN')}}\n`);
    pruefe(enthaelt(mit([]), 'kein Lauf'), 'Schleife nur in einer Funktion (nie gerufen) statt auf oberster Ebene ⇒ Befund „kein Lauf"');
    setzeRunner(kernMitB, `if (false) {\n${ueberListe('KERN')}}\n`);
    pruefe(enthaelt(mit([]), 'kein Lauf'), 'Schleife in totem `if (false)` ⇒ Befund „kein Lauf"');
    setzeRunner(kernMitB, `${SCHLEIFE}${ueberListe('[]')}`);
    pruefe(enthaelt(mit([]), 'mehrere Schleifen'), 'zweite Schleife, die Tests startet ⇒ Befund');
    setzeRunner(kernMitB, 'console.log(KERN.length);\n');
    pruefe(enthaelt(mit([]), 'kein Lauf'), 'gar keine Schleife ⇒ Befund „kein Lauf"');
    setzeRunner(kernMitB, `${SCHLEIFE}KERN.splice(0, KERN.length);\n`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), 'KERN nach dem Aufbau geleert (`KERN.splice`) ⇒ Befund');
    setzeRunner(kernMitB, `KERN.length = 0;\n${SCHLEIFE}`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), '`KERN.length = 0` ⇒ Befund');
    setzeRunner(kernMitB, `${SCHLEIFE}KERN.length -= 1;\n`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), '`KERN.length -= 1` ⇒ Befund');
    setzeRunner(kernMitB, `${SCHLEIFE}const eins = KERN.length++;\n`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), '`KERN.length++` ⇒ Befund');
    setzeRunner(kernMitB, `${SCHLEIFE}KERN.push(...LANG);\n`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), '`KERN.push(…)` ⇒ Befund');
    setzeRunner(kernMitB, `${SCHLEIFE}verarbeite(KERN);\n`);
    pruefe(enthaelt(mit([]), 'an unerwarteter Stelle'), 'KERN als Argument weitergereicht ⇒ Befund');
    setzeRunner(kernMitB, `${SCHLEIFE}const p = { KERN: 1 };\nconst q = p.KERN;\n`);
    pruefe(mit([]).length === 0, 'ein Eigenschaftsname `KERN` (`{ KERN: 1 }`, `p.KERN`) ist keine Erwähnung der Liste ⇒ kein Befund');
    schreibe('scripts/run-tests.mjs', runner(kernMitB).replace('const KERN', 'let KERN'));
    pruefe(enthaelt(mit([]), 'nicht `const`'), '`let KERN` statt `const KERN` ⇒ Befund');
    schreibe('scripts/run-tests.mjs', runner(kernMitB, `var KERN = [];\n${SCHLEIFE}`).replace('const KERN', 'var KERN'));
    pruefe(enthaelt(mit([]), 'mehrfach'), 'zwei Deklarationen von KERN auf oberster Ebene ⇒ Befund');
    schreibe('scripts/run-tests.mjs', `import { spawnSync } from 'node:child_process';\nconst KERN = [].concat([]);\n${SCHLEIFE}`);
    pruefe(enthaelt(mit([]), 'kein Array-Literal'), 'KERN aus einem Ausdruck statt einem Array-Literal ⇒ Befund');

    console.log('  — nur die Liste auf oberster Ebene zählt (M2)');
    setzeRunner(grundEintraege, `${SCHLEIFE}function hilfe() {\n  const KERN = [['server', 'test/b.ts']];\n  return KERN;\n}\n`);
    const schatten = mit([]);
    pruefe(
      enthaelt(schatten, 'verwaist') && enthaelt(schatten, 'server/test/b.ts'),
      'zweite `const KERN` in einer Funktion mit b.ts ⇒ b.ts gilt weiter als verwaist',
    );
    pruefe(
      enthaelt(schatten, 'an unerwarteter Stelle'),
      'zweite `const KERN` in einer Funktion ⇒ auch die Deklaration selbst ist ein Befund',
    );
    setzeRunner(grundEintraege, `${SCHLEIFE}{\n  const KERN = [['server', 'test/b.ts']];\n}\n`);
    pruefe(enthaelt(mit([]), 'verwaist'), 'zweite `const KERN` in einem Block auf oberster Ebene ⇒ b.ts gilt weiter als verwaist');
    schreibe(
      'scripts/run-tests.mjs',
      `import { spawnSync } from 'node:child_process';\nfunction main() {\n  const KERN = [['server', 'test/a.ts'], ['client/test', 'c.ts'], ['server', 'test/b.ts']];\n${ueberListe('KERN')}}\nmain();\n`,
    );
    const eingewickelt = mit([]);
    pruefe(
      enthaelt(eingewickelt, 'nicht auf oberster Ebene') && enthaelt(eingewickelt, 'kein Lauf'),
      'die ganze Liste samt Schleife in eine Funktion gewickelt ⇒ Befund (nichts steht auf oberster Ebene)',
    );
    // Back to the base state: b.ts is unregistered again, so exceptions for it are valid.
    setzeRunner(grundEintraege);

    console.log('  — Erkennung von Testdateien (H3/H4)');
    const gefundenAls = (pfad) => {
      schreibe(pfad);
      const ergebnis = mit([ausnahmeB]);
      rmSync(join(wegwerf, pfad));
      return enthaelt(ergebnis, `verwaist — Testdatei steht weder in run-tests.mjs noch auf der Ausnahmeliste: ${pfad}`);
    };
    for (const pfad of [
      'server/test/w.tsx',
      'server/test/w.jsx',
      'server/test/W-GROSS.TS',
      'server/tests/w.ts',
      'server/Test/w.ts',
      'server/__tests__/w.ts',
      'server/src/w.test.ts',
      'server/src/w.spec.tsx',
      'server/src/w.TEST.js',
      'server/test/w.mts',
      'server/test/w.cjs',
      'server/test/w.py',
      'server/test/ümlaut mit leerzeichen.ts',
      'server/test/unter/tiefer/w.ts',
    ]) {
      pruefe(gefundenAls(pfad), `Waise ${pfad} ⇒ Befund`);
    }
    pruefe(!gefundenAls('server/test/w.markdown'), 'server/test/w.markdown ist keine Skriptdatei ⇒ kein Befund');
    pruefe(!gefundenAls('server/src/kontest.ts'), 'server/src/kontest.ts (Name enthält nur „test") ⇒ kein Befund');

    // Symlinked test folder: a real folder outside the tree, linked in.
    const draussen = mkdtempSync(join(tmpdir(), 'wov-runner-liste-aussen-'));
    try {
      mkdirSync(join(draussen, 'test'), { recursive: true });
      writeFileSync(join(draussen, 'test', 'w.ts'), '');
      mkdirSync(join(wegwerf, 'client', 'zzq'), { recursive: true });
      symlinkSync(join(draussen, 'test'), join(wegwerf, 'client', 'zzq', 'test'));
      pruefe(
        enthaelt(mit([ausnahmeB]), 'client/zzq/test/w.ts'),
        'Testordner nur über einen Symlink erreichbar ⇒ wird durchsucht, Datei wird gemeldet',
      );
      rmSync(join(wegwerf, 'client', 'zzq'), { recursive: true, force: true });
      // A link back into an ancestor must not hang the walk.
      symlinkSync(wegwerf, join(wegwerf, 'server', 'test', 'schleife'));
      const schleife = mit([ausnahmeB]);
      pruefe(schleife.length === 0, 'Symlink-Schleife (Ordner verweist auf einen Vorfahren) ⇒ endet, keine Falschmeldung');
      rmSync(join(wegwerf, 'server', 'test', 'schleife'));
    } finally {
      rmSync(draussen, { recursive: true, force: true });
    }

    console.log('  — krumm geschriebene Ausnahmen (H5)');
    const kanonischB = { ...ausnahmeB };
    const krummB = { ...ausnahmeB, pfad: './server/test/b.ts' };
    pruefe(enthaelt(mit([krummB]), 'nicht kanonisch'), 'Ausnahme „./server/test/b.ts" allein ⇒ Befund');
    const doppeltKrumm = mit([kanonischB, krummB]);
    pruefe(
      enthaelt(doppeltKrumm, 'Ausnahme doppelt') && enthaelt(doppeltKrumm, 'nicht kanonisch'),
      'kanonische und krumme Ausnahme für dieselbe Datei ⇒ als Doppelung gemeldet',
    );
    pruefe(
      enthaelt(mit([{ ...ausnahmeB, pfad: 'server/test/../test/b.ts' }]), 'nicht kanonisch'),
      'Ausnahme mit `..` im Pfad ⇒ Befund',
    );

    console.log('  — `rot`-Ausnahmen (H1)');
    const rotB = { pfad: 'server/test/b.ts', art: 'rot', seit: '2026-09-20', grund: 'Probe' };
    pruefe(mit([rotB]).length === 0, '`rot`-Ausnahme mit Datum und Grund ⇒ kein Befund');
    pruefe(
      enthaelt(mit([{ ...rotB, seit: undefined }]), '"seit" fehlt'),
      '`rot`-Ausnahme ohne Datum ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([{ ...rotB, seit: '20.09.2026' }]), '"seit" fehlt'),
      '`rot`-Ausnahme mit Datum in falscher Form ⇒ Befund',
    );
    pruefe(mit([{ ...ausnahmeB, seit: undefined }]).length === 0, '`werkzeug` braucht kein Datum');
    console.log('  — `seit` ist ein echtes Datum, nicht in der Zukunft (H2)');
    const jetzt = Date.UTC(2026, 8, 20, 12);
    pruefe(istEchtesDatum('2026-09-20', jetzt) && istEchtesDatum('2024-02-29', jetzt), 'heutiger Tag und ein Schalttag sind gültig');
    pruefe(
      istEchtesDatum('2026-09-21', jetzt) && !istEchtesDatum('2026-09-22', jetzt),
      'Uhr fest auf 20.09.2026 12:00 UTC: morgen gilt noch (Zeitzone bis UTC+14), übermorgen nicht',
    );
    const tageAb = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    pruefe(istEchtesDatum(tageAb(0)) && !istEchtesDatum(tageAb(3)), 'mit der echten Uhr: heute gilt, in drei Tagen nicht');
    for (const seit of ['2099-12-31', '2026-02-31', '2026-04-31', '2025-02-29', '2026-13-01', '2026-00-10', '2026-09-00', '0000-00-00']) {
      pruefe(
        enthaelt(mit([{ ...rotB, seit }]), '"seit" fehlt'),
        `\`rot\`-Ausnahme mit seit ${seit} ⇒ Befund`,
      );
    }
    pruefe(mit([{ ...rotB, seit: '2024-02-29' }]).length === 0, '`rot`-Ausnahme mit seit 2024-02-29 (Schaltjahr) ⇒ kein Befund');

    // Running the `rot` entries: a red one stays red, a green one is caught.
    schreibe('server/test/rot.mjs', 'process.exit(1);\n');
    schreibe('server/test/gruen.mjs', 'process.exit(0);\n');
    const lauf = roteAusfuehren(
      wegwerf,
      [
        { pfad: 'server/test/rot.mjs', art: 'rot', seit: '2026-09-20', grund: 'Probe' },
        { pfad: 'server/test/gruen.mjs', art: 'rot', seit: '2026-09-20', grund: 'Probe' },
        { pfad: 'server/test/b.ts', art: 'werkzeug', grund: 'Probe' },
      ],
      TSX,
    );
    pruefe(
      lauf.length === 2 && lauf.find((l) => l.pfad === 'server/test/rot.mjs')?.rc === 1,
      '`--pruefe-rot`: ein wirklich roter Test bleibt rot (rc 1), `werkzeug`-Einträge werden nicht ausgeführt',
    );
    pruefe(
      lauf.find((l) => l.pfad === 'server/test/gruen.mjs')?.rc === 0,
      '`--pruefe-rot`: ein als „rot" geparkter, in Wahrheit GRÜNER Test wird als grün erkannt (rc 0)',
    );
  } finally {
    rmSync(wegwerf, { recursive: true, force: true });
  }
}

console.log('\n[2] Der echte Baum');
if (EIGEN) console.log(`[runner-liste] Wurzel ersetzt: ${WURZEL}`);
const echte = befunde(WURZEL, AUSNAHMEN);
const alle = kandidaten(WURZEL);
for (const b of echte) console.log(`  FAIL ${b}`);
pruefe(
  echte.length === 0,
  `alle ${alle.length} Testdateien im Baum stehen in KERN oder mit Grund auf der Ausnahmeliste`,
);
pruefe(alle.length >= 50, `der Zeuge sieht überhaupt Testdateien (${alle.length}; ein leerer Blick wäre kein Bestehen)`);
console.log(
  `  Ausnahmeliste: ${AUSNAHMEN.length} Dateien (${AUSNAHMEN.filter((a) => a.art === 'werkzeug').length} Werkzeug, ` +
    `${AUSNAHMEN.filter((a) => a.art === 'rot').length} rot geparkt)`,
);

const rote = AUSNAHMEN.filter((a) => a.art === 'rot');
if (rote.length > 0) {
  console.log('\n  OFFEN — rot bei erfüllten Voraussetzungen, bewusst nicht im Sammellauf:');
  for (const r of rote) console.log(`    · ${r.pfad} — seit ${r.seit} — ${r.grund}`);
}

if (ROT_PRUEFEN) {
  console.log('\n[3] --pruefe-rot: die geparkten Tests ausführen');
  for (const { pfad, rc } of roteAusfuehren(WURZEL, AUSNAHMEN, TSX)) {
    pruefe(
      rc !== 0,
      rc === 0
        ? `${pfad} ist GRÜN GEWORDEN — aus der rot-Liste nehmen, in KERN eintragen`
        : `${pfad} ist weiterhin rot (rc ${rc}) — Parken stimmt`,
    );
  }
}

// Empty-run trap: a run without assertions must not look like a pass.
const MINDESTENS = 79;
if (geprueft < MINDESTENS) {
  console.log(`\nRUNNER-LISTE ROT — nur ${geprueft} Zusicherungen gefahren, erwartet mindestens ${MINDESTENS}.`);
  process.exit(1);
}
if (fehler > 0) {
  console.log(`\nRUNNER-LISTE ROT — ${fehler} von ${geprueft} Zusicherungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nRUNNER-LISTE OK — ${geprueft} Zusicherungen; jede Testdatei ist eingetragen oder begründet ausgenommen.`);
