#!/usr/bin/env node
/**
 * Prüft: jede Testdatei im Baum steht im STANDARD-Sammellauf (`npm test`) —
 * oder mit Grund auf einer der beiden Listen weiter unten.
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
 * Was der Runner kennt: die Einträge der Listen `KERN` und `LANG` in
 * `scripts/run-tests.mjs`, gelesen am Syntaxbaum (nicht per Textsuche —
 * Kommentare nennen Dateinamen, und ein umformatierter Eintrag bliebe für
 * eine Textsuche unsichtbar). Ein Eintrag, der sich nicht als
 * `['ordner', 'datei']` mit Textliteralen lesen lässt, ist selbst ein Befund.
 *
 * KERN und LANG sind NICHT gleichwertig: `npm test` fährt nur KERN, LANG
 * kommt erst mit `--alle` dazu. Als „eingetragen" zählt deshalb nur KERN.
 * Wer eine Datei in LANG führt, trägt sie zusätzlich in `NUR_MIT_ALLE` ein,
 * mit Grund; der Lauf meldet diese Liste jedes Mal. Eine Datei, die nur in
 * LANG steht, ohne dort begründet zu sein, ist ein Befund — sonst ließe sich
 * ein Test durch Verschieben nach LANG still abschalten. Der Zeuge prüft
 * auch, dass die Standardliste des Runners weiter `KERN` ist.
 *
 * Wer eine Datei gar nicht eintragen kann, trägt sie in `AUSNAHMEN` ein:
 *   werkzeug  kein Test: Messbank, Bündel-Einstieg, Blender-Skript oder ein
 *             Prüfer, der Argumente (Ausgabeordner, URL) braucht
 *   rot       ein Test, der bei erfüllten Voraussetzungen rot ist und aus
 *             gutem Grund nicht im Lauf steht; verlangt `seit` (Datum). Er
 *             wird bei JEDEM Lauf namentlich gemeldet, und `--pruefe-rot`
 *             führt ihn aus und schlägt an, wenn er grün geworden ist
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
 * KERN of scripts/run-tests.mjs (what `npm test` runs), or carries a reason
 * on the LANG or exception list.
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
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/*
  Test files that only run with `npm test -- --alle` (the LANG list of
  run-tests.mjs). Every LANG entry needs a line here; paths are canonical,
  relative to the repository root. Keep `grund` in one line: it is printed.
*/
const NUR_MIT_ALLE = [
  { pfad: 'server/test/g3-streaming.ts', grund: 'Warteschlange der Zonen-Erzeugung; nur mit --alle, obwohl gemessen 1,8 s (20.09.2026): Kandidat für KERN' },
  { pfad: 'server/test/g5-dungeons.ts', grund: 'DungeonManager (Dokumente, Eingänge, Instanzen); nur mit --alle, obwohl gemessen 1,0 s (20.09.2026): Kandidat für KERN' },
  { pfad: 'server/test/f3-leveling.ts', grund: 'Geländeebnung für Locations; nur mit --alle, obwohl gemessen 2,4 s (20.09.2026): Kandidat für KERN' },
];

/*
  Files that look like tests but are in neither list. Paths are relative to
  the repository root, canonical. Keep `grund` in one line: it is printed.
  Kind `rot` also needs `seit` (YYYY-MM-DD, when it was parked).
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
 * The `[ordner, datei, weiche?]` entries of KERN and LANG, read from the syntax tree,
 * plus whether the runner's default list (without `--alle`) is still KERN.
 */
function eingetragene(quelltext) {
  const baum = ts.createSourceFile('run-tests.mjs', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const kern = [];
  const lang = [];
  const unlesbar = [];
  const gefundeneListen = [];
  let standardIstKern = false;
  const besuche = (knoten) => {
    if (
      ts.isVariableDeclaration(knoten) &&
      ts.isIdentifier(knoten.name) &&
      ['KERN', 'LANG'].includes(knoten.name.text) &&
      knoten.initializer &&
      ts.isArrayLiteralExpression(knoten.initializer)
    ) {
      gefundeneListen.push(knoten.name.text);
      const ziel = knoten.name.text === 'KERN' ? kern : lang;
      for (const eintrag of knoten.initializer.elements) {
        const [ordner, datei] = ts.isArrayLiteralExpression(eintrag) ? eintrag.elements : [];
        const text = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null);
        if (text(ordner) === null || text(datei) === null) {
          unlesbar.push(`${knoten.name.text}: ${eintrag.getText(baum).replace(/\s+/g, ' ').slice(0, 80)}`);
          continue;
        }
        ziel.push(kanonisch(`${text(ordner)}/${text(datei)}`));
      }
    }
    // `process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN`
    if (
      ts.isConditionalExpression(knoten) &&
      knoten.condition.getText(baum).includes('--alle') &&
      ts.isIdentifier(knoten.whenFalse) &&
      knoten.whenFalse.text === 'KERN'
    ) {
      standardIstKern = true;
    }
    ts.forEachChild(knoten, besuche);
  };
  besuche(baum);
  return { kern, lang, unlesbar, gefundeneListen, standardIstKern };
}

/** All findings for the tree at `wurzel`; an empty list is a pass. */
function befunde(wurzel, ausnahmen, nurMitAlle) {
  const lauf = join(wurzel, 'scripts', 'run-tests.mjs');
  if (!existsSync(lauf)) return [`scripts/run-tests.mjs fehlt unter ${wurzel}`];
  const { kern, lang, unlesbar, gefundeneListen, standardIstKern } = eingetragene(readFileSync(lauf, 'utf8'));
  const gefunden = [];
  if (!gefundeneListen.includes('KERN')) gefunden.push('die Liste KERN steht nicht in run-tests.mjs (Zeuge blind)');
  if (!standardIstKern) {
    gefunden.push("run-tests.mjs: die Standardliste ist nicht mehr KERN (erwartet: `--alle ? [...KERN, ...LANG] : KERN`)");
  }
  for (const u of unlesbar) gefunden.push(`Eintrag nicht lesbar (kein [ordner, datei] aus Textliteralen): ${u}`);

  // Entries of both lists: duplicates and missing files.
  const inKern = new Set();
  const inLang = new Set();
  for (const [name, liste, menge] of [['KERN', kern, inKern], ['LANG', lang, inLang]]) {
    for (const pfad of liste) {
      if (menge.has(pfad)) gefunden.push(`doppelt eingetragen (${name}): ${pfad}`);
      menge.add(pfad);
      if (!existsSync(join(wurzel, pfad))) gefunden.push(`eingetragen, aber die Datei fehlt: ${pfad}`);
    }
  }
  for (const pfad of inKern) {
    if (inLang.has(pfad)) gefunden.push(`steht in KERN und in LANG: ${pfad}`);
  }

  // LANG runs only with `--alle`: every entry must be justified on NUR_MIT_ALLE, and vice versa.
  const begruendetLang = new Set();
  for (const { pfad, grund } of nurMitAlle) {
    const kanon = kanonisch(pfad);
    if (kanon !== pfad) gefunden.push(`NUR_MIT_ALLE: Pfad nicht kanonisch geschrieben: ${pfad} (gemeint: ${kanon})`);
    if (begruendetLang.has(kanon)) gefunden.push(`NUR_MIT_ALLE doppelt: ${kanon}`);
    begruendetLang.add(kanon);
    if (typeof grund !== 'string' || grund.trim().length === 0) gefunden.push(`NUR_MIT_ALLE ohne Grund: ${kanon}`);
    if (!inLang.has(kanon)) gefunden.push(`NUR_MIT_ALLE nennt eine Datei, die nicht in LANG steht: ${kanon}`);
  }
  for (const pfad of inLang) {
    if (!begruendetLang.has(pfad)) {
      gefunden.push(
        `nur in LANG (läuft NICHT ohne --alle) und nicht auf NUR_MIT_ALLE begründet: ${pfad}`,
      );
    }
  }

  const bekannteAusnahmen = new Set();
  for (const { pfad, art, grund, seit } of ausnahmen) {
    const kanon = kanonisch(pfad);
    if (kanon !== pfad) gefunden.push(`Ausnahme: Pfad nicht kanonisch geschrieben: ${pfad} (gemeint: ${kanon})`);
    if (bekannteAusnahmen.has(kanon)) gefunden.push(`Ausnahme doppelt: ${kanon}`);
    bekannteAusnahmen.add(kanon);
    if (!['werkzeug', 'rot'].includes(art)) gefunden.push(`Ausnahme ${kanon}: unbekannte Art "${art}"`);
    if (typeof grund !== 'string' || grund.trim().length === 0) gefunden.push(`Ausnahme ohne Grund: ${kanon}`);
    if (art === 'rot' && !(typeof seit === 'string' && DATUM.test(seit) && !Number.isNaN(Date.parse(seit)))) {
      gefunden.push(`Ausnahme ${kanon} (rot): "seit" fehlt oder ist kein Datum JJJJ-MM-TT`);
    }
    if (!existsSync(join(wurzel, kanon))) gefunden.push(`Ausnahme für eine Datei, die es nicht mehr gibt: ${kanon}`);
    if (inKern.has(kanon) || inLang.has(kanon)) {
      gefunden.push(`Ausnahme widerspricht dem Runner (steht dort schon): ${kanon}`);
    }
  }

  for (const pfad of kandidaten(wurzel)) {
    if (!inKern.has(pfad) && !inLang.has(pfad) && !bekannteAusnahmen.has(pfad)) {
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
  const STANDARD = "const liste = process.argv.includes('--alle') ? [...KERN, ...LANG] : KERN;\n";
  const runner = (kernEintraege, langEintraege = '', standard = STANDARD) =>
    `const KERN = [\n${kernEintraege}\n];\nconst LANG = [\n${langEintraege}\n];\n${standard}`;
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
    const mit = (ausnahmen, nurAlle = []) => befunde(wegwerf, ausnahmen, nurAlle);
    const enthaelt = (liste, teil) => liste.some((b) => b.includes(teil));
    const ausnahmeB = { pfad: 'server/test/b.ts', art: 'werkzeug', grund: 'Probe' };
    const langB = { pfad: 'server/test/b.ts', grund: 'Probe: läuft lange' };

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

    console.log('  — LANG läuft nicht im Standardlauf (M1)');
    const kernMitB = `${grundEintraege}\n  ['server', 'test/b.ts'],`;
    setzeRunner(kernMitB);
    pruefe(mit([]).length === 0, 'Ausgangslage: b.ts in KERN ⇒ kein Befund');
    setzeRunner(grundEintraege, "  ['server', 'test/b.ts'],");
    const nachLang = mit([]);
    pruefe(
      enthaelt(nachLang, 'nur in LANG') && enthaelt(nachLang, 'server/test/b.ts'),
      'Test von KERN nach LANG verschoben, ohne Begründung ⇒ Befund',
    );
    pruefe(mit([], [langB]).length === 0, 'als begründeter LANG-Eintrag (NUR_MIT_ALLE) geführt ⇒ kein Befund');
    pruefe(
      enthaelt(mit([], [{ ...langB, grund: '' }]), 'NUR_MIT_ALLE ohne Grund'),
      'LANG-Eintrag mit leerem Grund ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([], [langB, { pfad: 'server/test/a.ts', grund: 'Probe' }]), 'nicht in LANG steht'),
      'NUR_MIT_ALLE nennt eine Datei, die nicht in LANG steht ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([], [langB, langB]), 'NUR_MIT_ALLE doppelt'),
      'doppelter Eintrag auf NUR_MIT_ALLE ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([], [{ ...langB, pfad: './server/test/b.ts' }]), 'kanonisch'),
      'NUR_MIT_ALLE mit krummem Pfad ⇒ Befund',
    );
    schreibe('server/test/waise-lang.ts');
    setzeRunner(kernMitB, "  ['server', 'test/waise-lang.ts'],");
    pruefe(
      enthaelt(mit([]), 'server/test/waise-lang.ts') && enthaelt(mit([]), 'nur in LANG'),
      'neue Datei NUR in LANG eingetragen ⇒ Befund (statt still „eingetragen")',
    );
    rmSync(join(wegwerf, 'server/test/waise-lang.ts'));
    setzeRunner(kernMitB, "  ['server', 'test/b.ts'],");
    pruefe(enthaelt(mit([], [langB]), 'steht in KERN und in LANG'), 'Datei in KERN und LANG zugleich ⇒ Befund');
    setzeRunner(kernMitB, '', 'const liste = [...KERN, ...LANG];\n');
    pruefe(
      enthaelt(mit([]), 'Standardliste ist nicht mehr KERN'),
      'Standardliste des Runners nicht mehr KERN ⇒ Befund',
    );
    setzeRunner(kernMitB, '', "const liste = process.argv.includes('--alle') ? [...KERN, ...LANG] : LANG;\n");
    pruefe(
      enthaelt(mit([]), 'Standardliste ist nicht mehr KERN'),
      'Standardliste ist LANG statt KERN ⇒ Befund',
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
const echte = befunde(WURZEL, AUSNAHMEN, NUR_MIT_ALLE);
const alle = kandidaten(WURZEL);
for (const b of echte) console.log(`  FAIL ${b}`);
pruefe(
  echte.length === 0,
  `alle ${alle.length} Testdateien im Baum stehen in KERN oder mit Grund auf NUR_MIT_ALLE bzw. der Ausnahmeliste`,
);
pruefe(alle.length >= 50, `der Zeuge sieht überhaupt Testdateien (${alle.length}; ein leerer Blick wäre kein Bestehen)`);
console.log(
  `  Ausnahmeliste: ${AUSNAHMEN.length} Dateien (${AUSNAHMEN.filter((a) => a.art === 'werkzeug').length} Werkzeug, ` +
    `${AUSNAHMEN.filter((a) => a.art === 'rot').length} rot geparkt); NUR_MIT_ALLE: ${NUR_MIT_ALLE.length}`,
);

console.log('\n  NUR MIT --alle (fehlt im Standardlauf `npm test`):');
for (const l of NUR_MIT_ALLE) console.log(`    · ${l.pfad} — ${l.grund}`);

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
const MINDESTENS = 55;
if (geprueft < MINDESTENS) {
  console.log(`\nRUNNER-LISTE ROT — nur ${geprueft} Zusicherungen gefahren, erwartet mindestens ${MINDESTENS}.`);
  process.exit(1);
}
if (fehler > 0) {
  console.log(`\nRUNNER-LISTE ROT — ${fehler} von ${geprueft} Zusicherungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nRUNNER-LISTE OK — ${geprueft} Zusicherungen; jede Testdatei ist eingetragen oder begründet ausgenommen.`);
