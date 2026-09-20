#!/usr/bin/env node
/**
 * Prüft: jede Testdatei im Baum steht im Sammellauf — oder mit Grund auf der
 * Ausnahmeliste weiter unten.
 *
 * Paket 0.10 (verwaiste Tests). Der Sammellauf führt eine von Hand gepflegte
 * Liste. Wer eine Testdatei anlegt und sie dort nicht einträgt, hat einen
 * Test, der nie läuft — und der Sammellauf bleibt grün. Neun Dateien lagen
 * so wochenlang herum, drei weitere kamen mit den letzten Karten dazu. Dieser
 * Zeuge dreht die Frage um: Er geht vom BAUM aus und fragt, ob der Runner die
 * Datei kennt.
 *
 * Was als Testdatei gilt: jede Datei mit Skript-Endung (ts, mts, cts, js,
 * mjs, cjs, py) unterhalb eines Ordners namens `test`, und jede Datei, deren
 * Name mit `pruefe-` beginnt (die Zeugen). Übersprungen werden `node_modules`,
 * `.git`, `assets` und Bauordner.
 *
 * Was der Runner kennt: die Einträge der Listen `KERN` und `LANG` in
 * `scripts/run-tests.mjs`, gelesen am Syntaxbaum (nicht per Textsuche —
 * Kommentare nennen Dateinamen, und ein umformatierter Eintrag bliebe für
 * eine Textsuche unsichtbar). Ein Eintrag, der sich nicht als
 * `['ordner', 'datei']` mit Textliteralen lesen lässt, ist selbst ein Befund:
 * Der Zeuge sähe die Datei sonst nicht und meldete sie zu Unrecht als
 * verwaist.
 *
 * Wer eine Datei NICHT eintragen kann, trägt sie hier in `AUSNAHMEN` ein,
 * mit Art und Grund:
 *   werkzeug  kein Test: Messbank, Bündel-Einstieg, Blender-Skript oder ein
 *             Prüfer, der Argumente (Ausgabeordner, URL) braucht
 *   rot       ein Test, der bei erfüllten Voraussetzungen rot ist und aus
 *             gutem Grund nicht im Lauf steht (heute: `f2-locations.ts`,
 *             absichtlich ruhend); er wird bei JEDEM Lauf namentlich
 *             gemeldet, damit er nicht in Vergessenheit gerät
 * Beides ist Buchführung, keine Streichung: Die Datei bleibt, wo sie ist.
 * Eine Ausnahme ohne Grund, für eine Datei, die es nicht mehr gibt, oder für
 * eine Datei, die inzwischen eingetragen ist, ist ein Befund.
 *
 * Damit der Zeuge nicht selbst „immer grün" sein kann, baut er zuerst in
 * einem Wegwerfordner einen Mini-Baum und probt an ihm jede Richtung
 * (Zahnprobe, Muster `pruefe-weichen.mjs`): verwaiste Datei ⇒ Befund,
 * Ausnahme ⇒ kein Befund, tote Ausnahme ⇒ Befund und so fort.
 *
 * Aufruf:  npx tsx scripts/pruefe-runner-liste.mjs [--wurzel=<ordner>]
 * `--wurzel=` prüft einen anderen Baum (mit eigenem `scripts/run-tests.mjs`).
 *
 * Guards the collective run: every test file in the tree is registered in
 * scripts/run-tests.mjs or carries a reason on the exception list.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HIER = dirname(fileURLToPath(import.meta.url));
const SKRIPT_ENDUNG = /\.(ts|mts|cts|js|mjs|cjs|py)$/;
const UEBERSPRUNGEN = new Set(['node_modules', '.git', 'assets', 'dist', 'build', '.svelte-kit']);

/*
  Files that look like tests but are not registered. Paths are relative to the
  repository root, with `/`. Keep `grund` in one line: it is printed.
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
  { pfad: 'client/test/durchgangshoehe-mess.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts' },
  { pfad: 'client/test/torbogen-hoehe-mess.ts', art: 'werkzeug', grund: 'Messbank: druckt Zahlen, behauptet nichts' },
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
    grund: 'ruhend seit 16.08.2026 (Kopfkommentar): FEATURES ist leer, 3 Prüfungen rot — auf eigene Location-Modelle',
  },
];

/** Every `test` directory below `wurzel` → files with a script ending, and every `pruefe-*` file. */
function kandidaten(wurzel) {
  const funde = [];
  const geh = (ordner, imTest) => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const voll = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        if (!UEBERSPRUNGEN.has(eintrag.name)) geh(voll, imTest || eintrag.name === 'test');
      } else if (SKRIPT_ENDUNG.test(eintrag.name) && (imTest || eintrag.name.startsWith('pruefe-'))) {
        funde.push(posix.normalize(voll.slice(wurzel.length + 1).split('\\').join('/')));
      }
    }
  };
  geh(wurzel, false);
  return funde.sort();
}

/** The `[ordner, datei, weiche?]` entries of KERN and LANG, read from the syntax tree. */
function eingetragene(quelltext) {
  const baum = ts.createSourceFile('run-tests.mjs', quelltext, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const pfade = [];
  const unlesbar = [];
  const gefundeneListen = [];
  const besuche = (knoten) => {
    if (
      ts.isVariableDeclaration(knoten) &&
      ts.isIdentifier(knoten.name) &&
      ['KERN', 'LANG'].includes(knoten.name.text) &&
      knoten.initializer &&
      ts.isArrayLiteralExpression(knoten.initializer)
    ) {
      gefundeneListen.push(knoten.name.text);
      for (const eintrag of knoten.initializer.elements) {
        const [ordner, datei] = ts.isArrayLiteralExpression(eintrag) ? eintrag.elements : [];
        const text = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null);
        if (text(ordner) === null || text(datei) === null) {
          unlesbar.push(`${knoten.name.text}: ${eintrag.getText(baum).replace(/\s+/g, ' ').slice(0, 80)}`);
          continue;
        }
        pfade.push(posix.normalize(`${text(ordner)}/${text(datei)}`));
      }
    }
    ts.forEachChild(knoten, besuche);
  };
  besuche(baum);
  return { pfade, unlesbar, gefundeneListen };
}

/** All findings for the tree at `wurzel`; an empty list is a pass. */
function befunde(wurzel, ausnahmen) {
  const lauf = join(wurzel, 'scripts', 'run-tests.mjs');
  if (!existsSync(lauf)) return [`scripts/run-tests.mjs fehlt unter ${wurzel}`];
  const { pfade, unlesbar, gefundeneListen } = eingetragene(readFileSync(lauf, 'utf8'));
  const gefunden = [];
  if (!gefundeneListen.includes('KERN')) gefunden.push('die Liste KERN steht nicht in run-tests.mjs (Zeuge blind)');
  for (const u of unlesbar) gefunden.push(`Eintrag nicht lesbar (kein [ordner, datei] aus Textliteralen): ${u}`);

  const eingetragen = new Set(pfade);
  const gesehen = new Set();
  for (const pfad of pfade) {
    if (gesehen.has(pfad)) gefunden.push(`doppelt eingetragen: ${pfad}`);
    gesehen.add(pfad);
    if (!existsSync(join(wurzel, pfad))) gefunden.push(`eingetragen, aber die Datei fehlt: ${pfad}`);
  }

  const bekannteAusnahmen = new Set();
  for (const { pfad, art, grund } of ausnahmen) {
    if (bekannteAusnahmen.has(pfad)) gefunden.push(`Ausnahme doppelt: ${pfad}`);
    bekannteAusnahmen.add(pfad);
    if (!['werkzeug', 'rot'].includes(art)) gefunden.push(`Ausnahme ${pfad}: unbekannte Art "${art}"`);
    if (typeof grund !== 'string' || grund.trim().length === 0) gefunden.push(`Ausnahme ohne Grund: ${pfad}`);
    if (!existsSync(join(wurzel, pfad))) gefunden.push(`Ausnahme für eine Datei, die es nicht mehr gibt: ${pfad}`);
    if (eingetragen.has(pfad)) gefunden.push(`Ausnahme widerspricht dem Runner (steht dort schon): ${pfad}`);
  }

  for (const pfad of kandidaten(wurzel)) {
    if (!eingetragen.has(pfad) && !bekannteAusnahmen.has(pfad)) {
      gefunden.push(`verwaist — Testdatei steht weder in run-tests.mjs noch auf der Ausnahmeliste: ${pfad}`);
    }
  }
  return gefunden;
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

console.log('\n[1] Zahnprobe — der Zeuge muss in jede Richtung rot werden können');
{
  const wegwerf = mkdtempSync(join(tmpdir(), 'wov-runner-liste-'));
  const schreibe = (pfad, inhalt = '') => {
    mkdirSync(dirname(join(wegwerf, pfad)), { recursive: true });
    writeFileSync(join(wegwerf, pfad), inhalt);
  };
  const runner = (eintraege) => `const KERN = [\n${eintraege}\n];\nconst LANG = [];\n`;
  const grundEintraege = "  ['server', 'test/a.ts'],\n  ['client/test', 'c.ts'],";
  try {
    schreibe('scripts/run-tests.mjs', runner(grundEintraege));
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
      enthaelt(mit([ausnahmeB, { pfad: 'server/test/weg.ts', art: 'rot', grund: 'Probe' }]), 'nicht mehr gibt'),
      'tote Ausnahme (Datei fehlt) ⇒ Befund',
    );
    pruefe(
      enthaelt(mit([ausnahmeB, { pfad: 'server/test/a.ts', art: 'rot', grund: 'Probe' }]), 'widerspricht'),
      'Ausnahme für eine schon eingetragene Datei ⇒ Befund',
    );
    pruefe(enthaelt(mit([ausnahmeB, ausnahmeB]), 'Ausnahme doppelt'), 'doppelte Ausnahme ⇒ Befund');

    schreibe('scripts/pruefe-neu.mjs');
    pruefe(
      enthaelt(mit([ausnahmeB]), 'scripts/pruefe-neu.mjs'),
      'ein neuer Zeuge `pruefe-*` außerhalb eines test-Ordners wird auch verlangt',
    );
    rmSync(join(wegwerf, 'scripts/pruefe-neu.mjs'));

    schreibe('scripts/run-tests.mjs', runner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', 'test/a.ts'],`));
    const doppelt = mit([]);
    pruefe(
      enthaelt(doppelt, 'doppelt eingetragen: server/test/a.ts') && !enthaelt(doppelt, 'verwaist'),
      'Eintragen beseitigt den Befund „verwaist"; ein zweiter Eintrag derselben Datei wird gemeldet',
    );

    schreibe('scripts/run-tests.mjs', runner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', 'test/gibtsnicht.ts'],`));
    pruefe(enthaelt(mit([]), 'eingetragen, aber die Datei fehlt: server/test/gibtsnicht.ts'), 'Eintrag ohne Datei ⇒ Befund');

    schreibe('scripts/run-tests.mjs', runner(`${grundEintraege}\n  ['server', 'test/b.ts'],\n  ['server', dyn + '.ts'],`));
    pruefe(enthaelt(mit([]), 'nicht lesbar'), 'ein Eintrag, der sich nicht als Textliteral lesen lässt ⇒ Befund');

    /* A file name only mentioned in a comment is not an entry. */
    schreibe('scripts/run-tests.mjs', runner(`${grundEintraege}\n  // ['server', 'test/b.ts'],`));
    pruefe(enthaelt(mit([]), 'server/test/b.ts'), 'ein auskommentierter Eintrag zählt nicht als eingetragen');

    schreibe('scripts/run-tests.mjs', 'const ANDERS = [];\n');
    pruefe(enthaelt(mit([]), 'KERN'), 'ohne Liste KERN ⇒ Befund (der Zeuge sähe sonst nichts)');
  } finally {
    rmSync(wegwerf, { recursive: true, force: true });
  }
}

console.log('\n[2] Der echte Baum');
const EIGEN = process.argv.find((a) => a.startsWith('--wurzel='));
const WURZEL = EIGEN ? resolve(EIGEN.slice('--wurzel='.length)) : resolve(HIER, '..');
if (EIGEN) console.log(`[runner-liste] Wurzel ersetzt: ${WURZEL}`);
const echte = befunde(WURZEL, AUSNAHMEN);
const alle = kandidaten(WURZEL);
for (const b of echte) console.log(`  FAIL ${b}`);
pruefe(echte.length === 0, `alle ${alle.length} Testdateien im Baum sind im Runner oder mit Grund auf der Ausnahmeliste`);
pruefe(alle.length >= 50, `der Zeuge sieht überhaupt Testdateien (${alle.length}; ein leerer Blick wäre kein Bestehen)`);
console.log(
  `  Ausnahmeliste: ${AUSNAHMEN.length} Dateien (${AUSNAHMEN.filter((a) => a.art === 'werkzeug').length} Werkzeug, ` +
    `${AUSNAHMEN.filter((a) => a.art === 'rot').length} rot gemeldet)`,
);

const rote = AUSNAHMEN.filter((a) => a.art === 'rot');
if (rote.length > 0) {
  console.log('\n  OFFEN — rot bei erfüllten Voraussetzungen, bewusst nicht im Sammellauf:');
  for (const r of rote) console.log(`    · ${r.pfad} — ${r.grund}`);
}

// Empty-run trap: a run without assertions must not look like a pass.
if (geprueft < 17) {
  console.log(`\nRUNNER-LISTE ROT — nur ${geprueft} Zusicherungen gefahren, erwartet mindestens 17.`);
  process.exit(1);
}
if (fehler > 0) {
  console.log(`\nRUNNER-LISTE ROT — ${fehler} von ${geprueft} Zusicherungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nRUNNER-LISTE OK — ${geprueft} Zusicherungen; jede Testdatei ist eingetragen oder begründet ausgenommen.`);
