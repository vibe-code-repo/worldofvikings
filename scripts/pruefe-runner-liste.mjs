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
 * einer Funktion oder einem Block schaltet keine Datei ein. `...TEIL` folgt
 * einer obersten Array-Liste (Liste in Teilen). Ein Eintrag, der sich nicht als
 * `['ordner', 'datei']` mit Textliteralen lesen lässt, ist selbst ein Befund.
 *
 * Ob der Runner die Liste dann auch FÄHRT, prüft dieser Zeuge NICHT am
 * Quelltext (das ließ sich mit einem Lockvogel täuschen und verbot ehrliche
 * Umbauten), sondern zur Laufzeit: `scripts/runner-buchfuehrung.mjs`. Der
 * Runner bucht, welche Datei er wirklich an den Kindprozess gibt, und
 * vergleicht am Ende mit dem LITERAL von KERN in seinem Quelltext (gelesen mit
 * derselben Funktion `leseKern`, die dieser Zeuge benutzt); fehlt einer oder läuft
 * einer, der nicht eingetragen ist, ist der Lauf rot. Schlusszeile und Exit-Code
 * kommen aus der Buchführung, ein Lauf, der sie nie abschließt, bleibt bei
 * Exit 1, ein Teillauf endet mit Exit 3. Dieser Zeuge prüft dazu nur zweierlei:
 * dass die Buchführung in run-tests.mjs noch verdrahtet ist (Import und Aufruf
 * von `beende`; die Durchsetzung liegt im Exit-Code, nicht in dieser Prüfung),
 * und — in [1b] — dass die Buchführung selbst rot werden kann (Zahnprobe). Wie
 * die Schleife gebaut ist, ist gleichgültig.
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
 * exception list. What the runner really starts is checked at run time by
 * scripts/runner-buchfuehrung.mjs, not by reading the source.
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
import { abschluss, auslassen, beende, fahre, leseKern, neueBuchfuehrung, ueberspringe } from './runner-buchfuehrung.mjs';

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
  { pfad: 'tools/armor/test/render-compare.py', art: 'werkzeug', grund: 'Blender-Skript (bpy), braucht ein gebautes Rüstungs-Blend, Zielordner, Master-Animationsdatei und --prefix/--regions/--items als Argumente' },
  { pfad: 'tools/armor/test/keep_body.py', art: 'werkzeug', grund: 'kein Test, Stand-alone-Modul (kein bpy): die --keep-body-Pruefung fuer armor-motion.py, importiert von keep-body-args.mjs und von armor-motion.py selbst' },
  { pfad: 'tools/armor/test/probe.py', art: 'werkzeug', grund: 'Blender-Skript (bpy), braucht ein gebautes Rüstungs-Blend, Master-Animationsdatei, Zielordner und --prefix/--regions/--items/--body als Argumente' },
  { pfad: 'tools/armor/test/emberrage-assets.mjs', art: 'werkzeug', grund: 'braucht die Exportordner (Wurzel, Referenz) als Argumente' },
  { pfad: 'tools/armor/test/emberrage-browser.mjs', art: 'werkzeug', grund: 'echtes WebGL über Playwright, braucht den gebauten wov-web und die Exporte' },
  { pfad: 'tools/armor/test/equipment-set-assets.mjs', art: 'werkzeug', grund: 'prüft einen laufenden Server per HTTP, URL als Argument' },
  { pfad: 'tools/armor/test/legacy-female-armor.mjs', art: 'werkzeug', grund: 'braucht Körper-GLB, Exportordner und Passform-Bericht als Argumente' },
  { pfad: 'tools/armor/test/skin-gate.mjs', art: 'werkzeug', grund: 'braucht Körper-GLB und Exportordner als Argumente; der Tor-Selbsttest steht im Runner' },
  { pfad: 'tools/armor/test/validate-glbs.cjs', art: 'werkzeug', grund: 'braucht Exportordner und den Validator-Pfad als Argumente' },
  { pfad: 'tools/test/vorschau-kopf.mjs', art: 'werkzeug', grund: 'Browserprobe (Playwright, echtes WebGL), braucht Chromium auf mike-pc' },
  // ── Webseite und Kartenveröffentlichung ──
  { pfad: 'wov-web/src/lib/i18n/katalog.test.ts', art: 'werkzeug', grund: 'Vitest-Test der Webseite, läuft per `npm test` in `wov-web` im CI-Job `web`, nicht im Node-Runner der Wurzel' },
  { pfad: 'wov-web/src/lib/seiten.test.ts', art: 'werkzeug', grund: 'Vitest-Test der Webseite, läuft per `npm test` in `wov-web` im CI-Job `web`, nicht im Node-Runner der Wurzel' },
  { pfad: 'wov-web/src/lib/server/forumMarkdown.test.ts', art: 'werkzeug', grund: 'Vitest-Test der Webseite, läuft per `npm test` in `wov-web` im CI-Job `web`, nicht im Node-Runner der Wurzel' },
  { pfad: 'wov-web/tools/test/zeitlimits-pruefen.mjs', art: 'werkzeug', grund: 'Prüfskript der Webseite, braucht --experimental-transform-types und einen eigenen Stub-Port (--port), läuft etwa 44 s; Aufnahme in die Tests von wov-web ist eine Folgekarte' },
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
 * The `[ordner, datei, weiche?]` entries of KERN, read from the syntax tree (the reading
 * itself lives in runner-buchfuehrung.mjs, because the runner reads its own literal the
 * same way at the end of a run), plus `formfehler`: only what the tree side cannot do
 * without (see the header). How the run is built is NOT looked at.
 */
function eingetragene(quelltext) {
  const gelesen = leseKern(ts, quelltext);
  const kern = gelesen.eintraege.map(([ordner, datei]) => kanonisch(`${ordner}/${datei}`));
  const formfehler = [...gelesen.fehler];

  // The bookkeeping must still be wired in: `beende` imported from runner-buchfuehrung.mjs and called.
  // (What makes it hold is the exit code that `neueBuchfuehrung` sets to 1 until `beende` decides;
  // this is only the check that nobody cut it out.)
  const baum = ts.createSourceFile('run-tests.mjs', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let lokalerName = null;
  for (const anweisung of baum.statements) {
    if (!ts.isImportDeclaration(anweisung) || !ts.isStringLiteralLike(anweisung.moduleSpecifier)) continue;
    if (!/(^|\/)runner-buchfuehrung\.mjs$/.test(anweisung.moduleSpecifier.text)) continue;
    const gebunden = anweisung.importClause?.namedBindings;
    if (!gebunden || !ts.isNamedImports(gebunden)) continue;
    for (const e of gebunden.elements) if ((e.propertyName ?? e.name).text === 'beende') lokalerName = e.name.text;
  }
  let aufgerufen = false;
  const suche = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === lokalerName) aufgerufen = true;
    if (!aufgerufen) ts.forEachChild(n, suche);
  };
  if (lokalerName) suche(baum);
  if (!lokalerName || !aufgerufen) {
    formfehler.push(
      'run-tests.mjs bucht den Lauf nicht mehr: `beende` aus ./runner-buchfuehrung.mjs wird nicht importiert oder nicht aufgerufen (Laufzeitzeuge fehlt)',
    );
  }
  return { kern, unlesbar: gelesen.unlesbar, formfehler };
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
  // The smallest runner the witness accepts: the list, its snapshot, one loop that books, the end check.
  const KOPF =
    "import { spawnSync } from 'node:child_process';\nimport { beende, fahre, neueBuchfuehrung } from './runner-buchfuehrung.mjs';\n";
  const NACH_LISTE = "const buch = neueBuchfuehrung();\n";
  const SCHLEIFE =
    "for (const [paket, datei] of KERN) {\n  fahre(buch, spawnSync, 'tsx', [datei], { cwd: paket });\n}\nawait beende(buch, { quelle: 'run-tests.mjs', wurzel: '.' });\n";
  const runner = (kernEintraege, rest = SCHLEIFE, kopf = KOPF) =>
    `${kopf}const KERN = [\n${kernEintraege}\n];\n${NACH_LISTE}${rest}`;
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

    console.log('  — der Zeuge liest die Liste, nicht den Bau des Runners: ehrliche Umbauten bleiben grün');
    const kernMitB = `${grundEintraege}\n  ['server', 'test/b.ts'],`;
    setzeRunner(kernMitB);
    pruefe(mit([]).length === 0, 'Ausgangslage: b.ts in KERN, Buchführung verdrahtet ⇒ kein Befund');
    const ehrlich = [
      ['Rumpf der Schleife in eine Hilfsfunktion', `for (const [paket, datei] of KERN) {\n  starte(paket, datei);\n}\nfunction starte(paket, datei) {\n  fahre(buch, spawnSync, 'tsx', [datei], { cwd: paket });\n}\nbeende(buch, {});\n`],
      ['Auswahl-Schalter: Schleife über KERN.filter(…)', `const liste = process.env.NUR ? KERN.filter(([, d]) => d.includes(process.env.NUR)) : KERN;\nfor (const [paket, datei] of liste) {\n  fahre(buch, spawnSync, 'tsx', [datei], { cwd: paket });\n}\nbeende(buch, {});\n`],
      ['Object.freeze(KERN)', `Object.freeze(KERN);\n${SCHLEIFE}`],
      ['structuredClone(KERN)', `const kopie = structuredClone(KERN);\n${SCHLEIFE}`],
      ['KERN.map(…) für eine Ausgabe', `console.log(KERN.map((e) => e[1]).join(','));\n${SCHLEIFE}`],
      ['async function main()', `async function main() {\n  ${SCHLEIFE.replace(/\n/g, '\n  ')}}\nmain();\n`],
      ['try … finally um den Lauf', `try {\n  ${SCHLEIFE.replace(/\n/g, '\n  ')}} finally {\n  console.log('fertig');\n}\n`],
      ['forEach statt for…of', `KERN.forEach(([paket, datei]) => fahre(buch, spawnSync, 'tsx', [datei], { cwd: paket }));\nbeende(buch, {});\n`],
      ['Parallelisierung mit Promise.all', `await Promise.all(KERN.map(async ([paket, datei]) => fahre(buch, spawnSync, 'tsx', [datei], { cwd: paket })));\nbeende(buch, {});\n`],
      ['execFileSync-Aufruf statt spawnSync im Rumpf', `for (const [paket, datei] of KERN) {\n  fahre(buch, execFileSync, 'tsx', [datei], { cwd: paket });\n}\nbeende(buch, {});\n`],
    ];
    for (const [name, rest] of ehrlich) {
      setzeRunner(kernMitB, rest);
      const ergebnis = mit([]);
      pruefe(ergebnis.length === 0, `${name} ⇒ kein Befund (${ergebnis.length})`);
    }
    // A list in parts: entries in either part are registered, a file in neither is an orphan.
    schreibe(
      'scripts/run-tests.mjs',
      `${KOPF}const TEIL_A = [\n${grundEintraege}\n];\nconst TEIL_B = [['server', 'test/b.ts']];\nconst KERN = [...TEIL_A, ...TEIL_B];\n${NACH_LISTE}${SCHLEIFE}`,
    );
    pruefe(mit([]).length === 0, 'Liste aus Teillisten (`...TEIL_A, ...TEIL_B`) ⇒ alle Einträge gelesen, kein Befund');
    schreibe(
      'scripts/run-tests.mjs',
      `${KOPF}const TEIL_A = [\n${grundEintraege}\n];\nconst KERN = [...TEIL_A];\n${NACH_LISTE}${SCHLEIFE}`,
    );
    const nurTeil = mit([]);
    pruefe(
      enthaelt(nurTeil, 'verwaist') && enthaelt(nurTeil, 'server/test/b.ts') && !enthaelt(nurTeil, 'nicht lesbar'),
      'Teilliste ohne b.ts ⇒ b.ts bleibt verwaist, die Teilliste ist lesbar',
    );
    schreibe('scripts/run-tests.mjs', `${KOPF}const KERN = [...GIBTSNICHT];\n${NACH_LISTE}${SCHLEIFE}`);
    pruefe(enthaelt(mit([]), 'nicht lesbar'), '`...NAME` auf etwas, das keine Array-Liste der obersten Ebene ist ⇒ Befund');
    schreibe('scripts/run-tests.mjs', `${KOPF}const A = [...B];\nconst B = [...A];\nconst KERN = [...A];\n${NACH_LISTE}${SCHLEIFE}`);
    pruefe(enthaelt(mit([]), 'nicht lesbar'), 'Teillisten, die sich im Kreis verweisen ⇒ Befund statt Endlosschleife');

    console.log('  — die Buchführung muss verdrahtet bleiben (Laufzeitzeuge)');
    setzeRunner(kernMitB, 'for (const [paket, datei] of KERN) {\n  spawnSync(\'tsx\', [datei], { cwd: paket });\n}\n');
    pruefe(enthaelt(mit([]), 'bucht den Lauf nicht mehr'), '`beende` wird nicht aufgerufen ⇒ Befund');
    setzeRunner(kernMitB, SCHLEIFE, "import { spawnSync } from 'node:child_process';\n");
    pruefe(enthaelt(mit([]), 'bucht den Lauf nicht mehr'), 'Buchführung gar nicht importiert ⇒ Befund');
    setzeRunner(
      kernMitB,
      SCHLEIFE.replace('beende(', 'schluss('),
      "import { spawnSync } from 'node:child_process';\nimport { beende as schluss, fahre, neueBuchfuehrung } from './runner-buchfuehrung.mjs';\n",
    );
    pruefe(mit([]).length === 0, 'Import unter anderem Namen (`beende as schluss`) und aufgerufen ⇒ kein Befund');
    setzeRunner(
      kernMitB,
      SCHLEIFE,
      "import { spawnSync } from 'node:child_process';\nimport { beende, fahre, neueBuchfuehrung } from './ganz-anders.mjs';\n",
    );
    pruefe(enthaelt(mit([]), 'bucht den Lauf nicht mehr'), '`beende` aus einer anderen Datei importiert ⇒ Befund');

    console.log('  — nur die Liste auf oberster Ebene zählt (M2)');
    setzeRunner(grundEintraege, `${SCHLEIFE}function hilfe() {\n  const KERN = [['server', 'test/b.ts']];\n  return KERN;\n}\n`);
    const schatten = mit([]);
    pruefe(
      enthaelt(schatten, 'verwaist') && enthaelt(schatten, 'server/test/b.ts'),
      'zweite `const KERN` in einer Funktion mit b.ts ⇒ b.ts gilt weiter als verwaist',
    );
    setzeRunner(grundEintraege, `${SCHLEIFE}{\n  const KERN = [['server', 'test/b.ts']];\n}\n`);
    pruefe(enthaelt(mit([]), 'verwaist'), 'zweite `const KERN` in einem Block auf oberster Ebene ⇒ b.ts gilt weiter als verwaist');
    schreibe(
      'scripts/run-tests.mjs',
      `${KOPF}function main() {\n  const KERN = [['server', 'test/a.ts'], ['client/test', 'c.ts'], ['server', 'test/b.ts']];\n  ${SCHLEIFE}}\nmain();\n`,
    );
    pruefe(
      enthaelt(mit([]), 'nicht auf oberster Ebene'),
      'die ganze Liste in eine Funktion gewickelt ⇒ Befund (nichts steht auf oberster Ebene)',
    );
    schreibe('scripts/run-tests.mjs', runner(kernMitB).replace('const KERN', 'var KERN') + 'var KERN = [];\n');
    pruefe(enthaelt(mit([]), 'mehrfach'), 'zwei Deklarationen von KERN auf oberster Ebene ⇒ Befund');
    schreibe('scripts/run-tests.mjs', `${KOPF}const KERN = [].concat([]);\n${NACH_LISTE}${SCHLEIFE}`);
    pruefe(enthaelt(mit([]), 'kein Array-Literal'), 'KERN aus einem Ausdruck statt einem Array-Literal ⇒ Befund');
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

console.log('\n[1b] Buchführung des Laufs (scripts/runner-buchfuehrung.mjs) — sie muss rot werden können');
{
  const w = '/wurzel';
  const kernZeilen = "['server', 'test/a.ts'],\n  ['server/test', 'b.ts'],\n  ['client', 'test/c.ts', () => 'Weiche'],";
  const wegwerfB = mkdtempSync(join(tmpdir(), 'wov-runner-buchung-'));
  const quelle = join(wegwerfB, 'run-tests.mjs');
  const schreibeQuelle = (text = `const KERN = [\n  ${kernZeilen}\n];\n`) => writeFileSync(quelle, text);
  schreibeQuelle();
  const attrappe = (rc = 0) => {
    const aufrufe = [];
    return { aufrufe, spawn: (befehl, argumente, optionen) => (aufrufe.push({ befehl, argumente, optionen }), { status: rc }) };
  };
  // A fake process: what `beende` would tell the real one.
  const attrappeProzess = () => {
    const p = { exitCode: undefined, beendet: null, exit(code) { p.beendet = code; } };
    return p;
  };
  const A = { cwd: `${w}/server` };
  const B = { cwd: `${w}/server/test` };
  const nach = (buch, ...paare) => {
    for (const [argumente, optionen] of paare) fahre(buch, attrappe().spawn, 'tsx', argumente, optionen);
    return buch;
  };
  const vollesBuch = (prozess = attrappeProzess()) => {
    const buch = neueBuchfuehrung(prozess);
    nach(buch, [['test/a.ts'], A], [['b.ts'], B]);
    ueberspringe(buch, w, 'client', 'test/c.ts');
    return buch;
  };
  const beenden = async (buch, optionen = {}) => {
    const zeilen = [];
    await beende(buch, { quelle, wurzel: w, ts, laeufer: 'tsx', ausgabe: (z) => zeilen.push(z), ...optionen });
    return { code: buch.prozess.beendet, text: zeilen.join('\n') };
  };
  const hat = (ergebnis, teil) => ergebnis.befunde.some((b) => b.includes(teil));
  try {
    const soll = new Set(['/wurzel/server/test/a.ts', '/wurzel/server/test/b.ts', '/wurzel/client/test/c.ts']);
    // ── the comparison
    const ok = abschluss(vollesBuch(), soll, w);
    pruefe(ok.befunde.length === 0 && ok.gefahren === 2 && ok.uebersprungen === 1, 'alles gefahren oder übersprungen ⇒ kein Befund (2 gefahren, 1 übersprungen)');
    const { aufrufe, spawn } = attrappe(3);
    const geliefert = fahre(neueBuchfuehrung(attrappeProzess()), spawn, 'tsx', ['x.ts'], { cwd: w, timeout: 5 });
    pruefe(
      geliefert.status === 3 && aufrufe.length === 1 && aufrufe[0].argumente[0] === 'x.ts' && aufrufe[0].optionen.timeout === 5,
      '`fahre` reicht Befehl, Argumente und Optionen unverändert durch und gibt das Ergebnis des Starts zurück',
    );
    const fehlt = neueBuchfuehrung(attrappeProzess());
    nach(fehlt, [['test/a.ts'], A]);
    ueberspringe(fehlt, w, 'client', 'test/c.ts');
    const ohneB = abschluss(fehlt, soll, w);
    pruefe(hat(ohneB, 'nie gestartet') && hat(ohneB, 'server/test/b.ts'), 'ein Eintrag aus KERN wird nie gestartet ⇒ Befund, der ihn nennt');
    pruefe(hat(abschluss(neueBuchfuehrung(attrappeProzess()), soll, w), '3 Test(s) aus KERN nie gestartet'), 'nichts gestartet („250/250 in 0 s") ⇒ Befund über alle Einträge');
    const zuviel = vollesBuch();
    nach(zuviel, [['d.ts'], B]);
    const mitD = abschluss(zuviel, soll, w);
    pruefe(hat(mitD, 'stehen nicht in KERN') && hat(mitD, 'server/test/d.ts'), 'ein gestarteter Test, der nicht in KERN steht ⇒ Befund');
    const ohneDatei = neueBuchfuehrung(attrappeProzess());
    nach(ohneDatei, [[], A], [['b.ts'], B]);
    const leer = abschluss(ohneDatei, soll, w);
    pruefe(hat(leer, 'keine Testdatei') && hat(leer, 'nie gestartet'), 'Start ohne Datei in den Argumenten (`[]` statt `[datei]`) ⇒ Befund, obwohl der Aufruf „stattfand"');
    // ── M5: repetition and switches before the file are no faults
    const wieder = vollesBuch();
    nach(wieder, [['test/a.ts'], A], [['test/a.ts'], A]);
    pruefe(abschluss(wieder, soll, w).befunde.length === 0, 'ein Test wird wiederholt (flackernd, zweiter Start) ⇒ kein Befund: Mengen zählen, nicht Aufrufe');
    const schalter = neueBuchfuehrung(attrappeProzess());
    nach(schalter, [['--tsconfig', '/x/tsconfig.json', 'test/a.ts'], A], [['--import', './loader.mjs', 'b.ts'], B]);
    ueberspringe(schalter, w, 'client', 'test/c.ts');
    const mitSchalter = abschluss(schalter, soll, w);
    pruefe(mitSchalter.befunde.length === 0 && mitSchalter.gefahren === 2, 'Schalter vor der Datei (`--tsconfig x.json datei`, `--import y.mjs datei`) ⇒ die Testdatei wird erkannt, kein Befund');
    // ── the filter
    const teil = neueBuchfuehrung(attrappeProzess());
    nach(teil, [['test/a.ts'], A], [['b.ts'], B]);
    auslassen(teil, w, 'client', 'test/c.ts', 'Probe: Filter');
    const teilErgebnis = abschluss(teil, soll, w);
    pruefe(teilErgebnis.befunde.length === 0 && teilErgebnis.ausgelassen === 1, 'ein Filter, der den Eintrag mit `auslassen` bucht ⇒ vollständig verbucht (1 ausgelassen)');
    let ohneGrund = false;
    try {
      auslassen(neueBuchfuehrung(attrappeProzess()), w, 'client', 'test/c.ts', '  ');
    } catch {
      ohneGrund = true;
    }
    pruefe(ohneGrund, '`auslassen` ohne Grund wirft (ein stilles Auslassen gibt es nicht)');
    const stumm = neueBuchfuehrung(attrappeProzess());
    nach(stumm, [['test/a.ts'], A], [['b.ts'], B]);
    pruefe(hat(abschluss(stumm, soll, w), 'test/c.ts'), 'ein Filter, der nur `continue` sagt (nichts bucht) ⇒ Befund');

    // ── `beende`: closing line and exit code come from the books
    const prozess = attrappeProzess();
    neueBuchfuehrung(prozess);
    pruefe(prozess.exitCode === 1, '`neueBuchfuehrung` setzt den Exit-Code auf 1: ein Lauf, der `beende` nie erreicht, bleibt rot');
    const gut = await beenden(vollesBuch());
    pruefe(gut.code === 0 && gut.text.includes('2/3 Tests grün, 1 übersprungen'), '`beende`: alles gebucht, nichts rot ⇒ Exit 0, Schlusszeile „2/3 Tests grün, 1 übersprungen" aus den Buchungen');
    const rot = await beenden(vollesBuch(), { fehler: 1 });
    pruefe(rot.code === 1 && rot.text.includes('1/3 Tests grün'), '`beende`: ein Test rot ⇒ Exit 1, die Zahl der grünen zieht ihn ab');
    const luecke = neueBuchfuehrung(attrappeProzess());
    nach(luecke, [['test/a.ts'], A]);
    const rotLuecke = await beenden(luecke);
    pruefe(
      rotLuecke.code === 1 && rotLuecke.text.includes('ROT — 1 von 3 Tests gefahren') && !rotLuecke.text.includes('3/3 Tests grün'),
      '`beende`: Lücke ⇒ Exit 1 und die Schlusszeile sagt „1 von 3 gefahren", nie „3/3 grün" (die Zeile kommt aus `buchung.gefahren`)',
    );
    const teilBuch = () => {
      const buch = neueBuchfuehrung(attrappeProzess());
      nach(buch, [['test/a.ts'], A], [['b.ts'], B]);
      auslassen(buch, w, 'client', 'test/c.ts', 'Probe');
      return buch;
    };
    const t3 = await beenden(teilBuch());
    pruefe(t3.code === 3 && t3.text.includes('TEILLAUF'), '`beende`: Teillauf ⇒ Exit 3 (nicht 0), damit CI und wov-update.sh ihn nicht für einen vollen grünen Lauf halten');
    const t0 = await beenden(teilBuch(), { teillaufErlaubt: true });
    pruefe(t0.code === 0 && t0.text.includes('TEILLAUF'), '`beende` mit teillaufErlaubt: grüner Teillauf ⇒ Exit 0, die Zeile sagt weiter TEILLAUF');
    const nichts = neueBuchfuehrung(attrappeProzess());
    for (const [paket, datei] of [['server', 'test/a.ts'], ['server/test', 'b.ts'], ['client', 'test/c.ts']]) auslassen(nichts, w, paket, datei, 'Probe: zzz');
    const rotNichts = await beenden(nichts, { teillaufErlaubt: true });
    pruefe(rotNichts.code === 1 && rotNichts.text.includes('kein einziger Test'), '`beende`: alles ausgelassen („0/250 ausgelassen") ⇒ Exit 1, auch mit teillaufErlaubt');
    const nurWeichen = neueBuchfuehrung(attrappeProzess());
    for (const [paket, datei] of [['server', 'test/a.ts'], ['server/test', 'b.ts'], ['client', 'test/c.ts']]) ueberspringe(nurWeichen, w, paket, datei);
    pruefe((await beenden(nurWeichen)).code === 1, '`beende`: alles durch Weichen übersprungen (nichts gefahren) ⇒ Exit 1');
    const abgeklemmt = await beenden(neueBuchfuehrung(attrappeProzess()));
    pruefe(abgeklemmt.code === 1 && abgeklemmt.text.includes('nie gestartet'), '`beende`: leeres Buch ⇒ Exit 1');

    // ── the command is booked, too: a token swapped in the runner must not give a green run
    const falscherLaeufer = neueBuchfuehrung(attrappeProzess());
    fahre(falscherLaeufer, attrappe().spawn, '/usr/bin/true', ['test/a.ts'], A);
    fahre(falscherLaeufer, attrappe().spawn, '/usr/bin/true', ['b.ts'], B);
    ueberspringe(falscherLaeufer, w, 'client', 'test/c.ts');
    const rotLaeufer = await beenden(falscherLaeufer);
    pruefe(
      rotLaeufer.code === 1 && rotLaeufer.text.includes('unerwartetem Läufer') && rotLaeufer.text.includes('/usr/bin/true'),
      '`tsx` durch `/usr/bin/true` ersetzt (alle Tests „gefahren", nichts gemessen) ⇒ Exit 1, der Befund nennt den falschen Läufer',
    );
    const richtigerLaeufer = await beenden(vollesBuch(), { laeufer: 'tsx' });
    pruefe(richtigerLaeufer.code === 0, 'alle Tests mit dem erwarteten Läufer gestartet ⇒ Exit 0');
    const standardLaeufer = neueBuchfuehrung(attrappeProzess());
    fahre(standardLaeufer, attrappe().spawn, join(w, 'node_modules/.bin/tsx'), ['test/a.ts'], A);
    fahre(standardLaeufer, attrappe().spawn, join(w, 'node_modules/.bin/tsx'), ['b.ts'], B);
    ueberspringe(standardLaeufer, w, 'client', 'test/c.ts');
    pruefe(
      (await beenden(standardLaeufer, { laeufer: undefined })).code === 0,
      'ohne Angabe gilt `node_modules/.bin/tsx` unter der Wurzel als erwarteter Läufer (der Runner gibt ihn nicht selbst vor)',
    );

    // ── M2: the expectation comes from the LITERAL, not from the live variable
    const gekuerzt = neueBuchfuehrung(attrappeProzess());
    nach(gekuerzt, [['b.ts'], B]);
    ueberspringe(gekuerzt, w, 'client', 'test/c.ts');
    const rotSplice = await beenden(gekuerzt);
    pruefe(
      rotSplice.code === 1 && rotSplice.text.includes('server/test/a.ts'),
      'ein Eintrag wurde zur Laufzeit aus KERN entfernt (`splice` zwischen Liste und Lauf) ⇒ Exit 1: das Literal im Quelltext gilt',
    );
    schreibeQuelle(`const TEIL_A = [['server', 'test/a.ts']];\nconst KERN = [...TEIL_A, ['server/test', 'b.ts'], ['client', 'test/c.ts']];\n`);
    pruefe((await beenden(vollesBuch())).code === 0, 'Soll aus einer Liste in Teilen (`...TEIL_A`) gelesen ⇒ Exit 0');
    schreibeQuelle(`const KERN = [].concat([]);\n`);
    const rotQuelle = await beenden(vollesBuch());
    pruefe(rotQuelle.code === 1 && rotQuelle.text.includes('kein Array-Literal'), 'KERN im Quelltext nicht als Literal lesbar ⇒ Exit 1 (die Buchführung rät nicht)');
    schreibeQuelle();
  } finally {
    rmSync(wegwerfB, { recursive: true, force: true });
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
const MINDESTENS = 106;
if (geprueft < MINDESTENS) {
  console.log(`\nRUNNER-LISTE ROT — nur ${geprueft} Zusicherungen gefahren, erwartet mindestens ${MINDESTENS}.`);
  process.exit(1);
}
if (fehler > 0) {
  console.log(`\nRUNNER-LISTE ROT — ${fehler} von ${geprueft} Zusicherungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nRUNNER-LISTE OK — ${geprueft} Zusicherungen; jede Testdatei ist eingetragen oder begründet ausgenommen.`);
