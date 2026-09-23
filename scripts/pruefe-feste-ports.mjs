#!/usr/bin/env node
/**
 * Guard: no test file names a fixed port.
 *
 * Why. Until 21.09.2026 about 25 test files bound fixed ports (2498-2610, 27314).
 * Nobody owns those numbers: a probe on the same port, a second full run or an
 * orphan from an aborted run made a test fail with EADDRINUSE. The fix
 * (`port: 0` + `portVon(server)`, see scripts/testport.mjs and AGENTS.md 3.3) only
 * lasts if the next new test does not write `const PORT = 2604` again. This
 * guard reads every test file and reports a line that assigns a number to a port.
 *
 * What counts as a test file: the same definition as scripts/pruefe-runner-liste.mjs
 * (a file with a script extension below a folder `test`, `tests` or `__tests__`, or
 * named `*.test.*` / `*.spec.*` / `pruefe-*`). node_modules, .git, assets and build
 * folders are skipped, symlinks to folders are followed (with loop protection).
 *
 * What it looks for, per line, comments cut off: an identifier that has "port" in
 * its name and gets a number between 100 and 65535 (`const PORT = 2604`,
 * `port: 2593`, `PORT_X = 2516`, `Number(process.env.X_PORT ?? 2586)`), a
 * `.listen(<number>`, `WOV_*PORT: '<number>'` and `--port <number>`. Port 0 (the
 * operating system picks it) is the rule and never a finding.
 *
 * A second scan covers what the first cannot see: files under `tools/` and `scripts/`
 * that are NOT test files. One whose code (comments cut off) names a slot port
 * (247n game server, 248n admin service, 529n client for slots 0-8; 2709-2713, 2809-2813,
 * 5809-5813 for slots 9-13; see AGENTS.md 3) AND starts a
 * server (`--port`, `createWovServer`, `.listen(`, `WOV_(CLIENT|SPIEL|ADMIN)_PORT:`)
 * must be on WERKZEUGE with a reason. That makes the tool list binding instead of
 * merely claimed: an unnamed tool is a finding, exactly the class the attack found
 * (three tools nobody had looked at). Tools that only READ a slot port as a URL
 * default (`--url http://localhost:5292`) are clients and are not caught. Not seen:
 * computed ports, a port only inside a URL, binds in files outside `tools/` and
 * `scripts/` that are not test files.
 *
 * Two lists say why a number is allowed; both are checked BOTH ways, so neither can
 * rot silently:
 *   - AUSNAHMEN: lines in test files that carry a port number and are not a bind
 *     (YAML text that is parsed, an assertion on a parsed value) or are a known
 *     rest that another card fixes. An entry that matches no line any more is a
 *     finding ("stale"): fix the line, then delete the entry. Entries match on the
 *     text of the line, not on its number, so unrelated edits do not break them.
 *   - WERKZEUGE: manual tools that bind slot ports on purpose. They are not test
 *     files (no `test` folder, not in the collective run), so the scan never sees
 *     them; they are named here so that "no test binds a slot port" is a statement
 *     about the runner and not about files nobody checked. An entry whose file or
 *     port text has gone is a finding too.
 * A fixed port a test really cannot avoid goes into FESTE_PORTS in
 * scripts/testport.mjs with its reason; the guard accepts exactly those numbers.
 *
 * Before it looks at the tree it proves itself on a throwaway tree, in every
 * direction (clean, fixed port, allowed line, stale entry, tool gone), so it cannot
 * be "always green" (same pattern as scripts/pruefe-runner-liste.mjs). Text only,
 * no bind, ~0.1 s, needs no assets/.
 *
 * Usage:  node scripts/pruefe-feste-ports.mjs [--wurzel=<folder>]
 *
 * Guards the collective run: no test file names a fixed port.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FESTE_PORTS } from './testport.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');

/**
 * Lines in test files that name a port number without binding it, or that are a known
 * rest. `text` is a piece of the line (trimmed); the entry is stale when no line has it.
 */
export const AUSNAHMEN = [
  { pfad: 'server/test/a14-server-yml.ts', text: "'  port: 2599'", grund: 'YAML text that is parsed, nothing binds it' },
  { pfad: 'server/test/a14-server-yml.ts', text: 'konfig.port === 2599', grund: 'assertion on the parsed value, not a bind' },
  { pfad: 'server/test/standard-konto.ts', text: "'  port: 2599'", grund: 'YAML text that is parsed, nothing binds it' },
];

/**
 * Manual tools (not test files, not in the collective run) that bind slot ports on purpose.
 * `text` must still be in the file; otherwise the entry is stale.
 */
export const WERKZEUGE = [
  { pfad: 'tools/dungeon2-e2e.mjs', text: 'const SPIEL_PORT = 2477', grund: 'game server of slot 7, by design; a leftover server holds the port (see the file itself)' },
  { pfad: 'tools/dungeon2-e2e.mjs', text: 'const CLIENT_PORT = 5299', grund: 'Vite client of slot 7, by design' },
  { pfad: 'tools/dungeon2-speckle-guard.mjs', text: '?? 5299', grund: 'default port of the client of slot 7, overridable with DG2_PORT' },
  { pfad: 'tools/pw-dungeon2-effekte.mjs', text: '?? 5297', grund: 'default port of the client of slot 5297, overridable' },
];

const ENDUNG = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const TESTORDNER = /^(test|tests|__tests__)$/i;
const TESTNAME = /\.(test|spec)\.[^./]+$/i;
const ZEUGENNAME = /^pruefe-/i;
/** This file is a `pruefe-*` file and so a test file by definition, but its lists and its self-proof hold port numbers as data. */
const EIGENE_DATEI = 'scripts/pruefe-feste-ports.mjs';
const WERKZEUG_WURZELN = ['tools', 'scripts'];
/**
 * Slots 0-8: 247n game server, 248n admin service, 529n client. Slots 9-13 (247n stops at 2479 and
 * 5299 is fixed in tools/dungeon2-*): 2700+n, 2800+n, 5800+n = 2709-2713, 2809-2813, 5809-5813.
 * Not part of a decimal number (`0.2489`, `-5292.9`).
 */
const SLOTPORT = /(?<![\d.])(?:247\d|248\d|529\d|270[9]|271[0-3]|2809|281[0-3]|5809|581[0-3])(?![\d.])/;
const STARTET_SERVER = /--port\b|createWovServer|\.listen\s*\(|WOV_(?:CLIENT|SPIEL|ADMIN)_PORT\s*:/;
const UEBERSPRINGEN = new Set(['node_modules', '.git', 'assets', 'dist', 'build', '.svelte-kit']);

/** An identifier with "port" in it: port, PORT, PORT_X, portText, TEST_PORT, spielPort ... */
const PORTNAME = String.raw`(?:\b(?:port|PORT)[A-Za-z0-9_]*|\b[A-Za-z0-9_]*(?:Port|_PORT|_port))`;
const ZAHL = String.raw`\b([1-9][0-9_]{2,6})\b`;
const MUSTER = [
  new RegExp(`${PORTNAME}\\s*[:=]\\s*[^,;)\\n]*?${ZAHL}`),
  new RegExp(String.raw`\.listen\s*\(\s*` + ZAHL),
  new RegExp(String.raw`WOV_[A-Z_]*PORT\s*[:=]\s*["'` + '`' + String.raw`]` + ZAHL),
  new RegExp(String.raw`--port[= ]` + ZAHL),
];

/** The number a line assigns to a port, or null. Comments are cut off; port 0 and numbers outside 100-65535 are no finding. */
function festePortZahl(zeile, erlaubteZahlen) {
  const trimmed = zeile.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return null;
  const ohneKommentar = zeile.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  for (const muster of MUSTER) {
    const treffer = muster.exec(ohneKommentar);
    if (!treffer) continue;
    const zahl = Number(treffer[1].replaceAll('_', ''));
    if (zahl >= 100 && zahl <= 65535 && !erlaubteZahlen.has(zahl)) return zahl;
  }
  return null;
}

/** Every script file below `wurzel`, marked as test file or not (same definition as scripts/pruefe-runner-liste.mjs). */
function skriptdateien(wurzel) {
  const gefunden = [];
  const geh = (ordner, imTest, kette) => {
    let echt;
    try {
      echt = realpathSync(ordner);
    } catch {
      return;
    }
    if (kette.has(echt)) return;
    const weiter = new Set(kette).add(echt);
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
        if (!UEBERSPRINGEN.has(eintrag.name)) geh(voll, imTest || TESTORDNER.test(eintrag.name), weiter);
        continue;
      }
      if (ENDUNG.test(eintrag.name)) {
        const istTest = imTest || TESTNAME.test(eintrag.name) || ZEUGENNAME.test(eintrag.name);
        gefunden.push({ voll, istTest, rel: posix.normalize(relative(wurzel, voll).split(sep).join('/')) });
      }
    }
  };
  geh(wurzel, false, new Set());
  return gefunden;
}

/** All findings for one tree as text lines. Empty means clean. */
export function pruefe(wurzel, { ausnahmen = AUSNAHMEN, werkzeuge = WERKZEUGE, feste = FESTE_PORTS } = {}) {
  const funde = [];
  const erlaubteZahlen = new Set(Object.values(feste).map((eintrag) => eintrag.port));
  const benutzt = new Set();
  const namen = new Set(werkzeuge.map((w) => w.pfad));
  for (const datei of skriptdateien(wurzel)) {
    if (datei.rel === EIGENE_DATEI) continue;
    if (!datei.istTest) {
      if (!WERKZEUG_WURZELN.some((oben) => datei.rel.startsWith(`${oben}/`))) continue;
      const code = readFileSync(datei.voll, 'utf8')
        .split('\n')
        .filter((zeile) => !/^\s*(\*|\/\*|\/\/)/.test(zeile))
        .map((zeile) => zeile.replace(/(^|\s)\/\/.*$/, '$1'));
      if (!namen.has(datei.rel) && code.some((z) => SLOTPORT.test(z)) && code.some((z) => STARTET_SERVER.test(z))) {
        funde.push(`${datei.rel}: starts a server on a slot port (247n/248n/529n, slots 9-13: 2709-2713/2809-2813/5809-5813) and is not on WERKZEUGE - take a free port or name it there with a reason`);
      }
      continue;
    }
    readFileSync(datei.voll, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        const zahl = festePortZahl(zeile, erlaubteZahlen);
        if (zahl === null) return;
        const treffer = ausnahmen.findIndex((a) => a.pfad === datei.rel && zeile.includes(a.text));
        if (treffer >= 0) {
          benutzt.add(treffer);
          return;
        }
        funde.push(`${datei.rel}:${i + 1}: fixed port ${zahl}: ${zeile.trim().slice(0, 110)}`);
      });
  }
  ausnahmen.forEach((a, i) => {
    if (!benutzt.has(i)) funde.push(`stale exception: ${a.pfad} no longer has a line with "${a.text}" (${a.grund}) — delete the entry`);
  });
  for (const w of werkzeuge) {
    let inhalt = null;
    try {
      inhalt = readFileSync(join(wurzel, w.pfad), 'utf8');
    } catch {
      // gone: reported below
    }
    if (inhalt === null) funde.push(`stale tool entry: ${w.pfad} does not exist any more — delete the entry`);
    else if (!inhalt.includes(w.text)) funde.push(`stale tool entry: ${w.pfad} no longer contains "${w.text}" — delete or update the entry`);
  }
  return funde;
}

// ── Self-proof on a throwaway tree, every direction ──────────────────────────────
function selbstprobe() {
  const probleme = [];
  let richtungen = 0;
  const wurzel = mkdtempSync(join(tmpdir(), 'pruefe-feste-ports-'));
  try {
    const schreibe = (rel, inhalt) => {
      mkdirSync(dirname(join(wurzel, rel)), { recursive: true });
      writeFileSync(join(wurzel, rel), inhalt);
    };
    const ohneAusnahmen = { ausnahmen: [], werkzeuge: [], feste: {} };
    const erwarte = (name, funde, erwartet) => {
      richtungen += 1;
      if (erwartet === 'sauber' ? funde.length !== 0 : !funde.some((f) => f.includes(erwartet))) {
        probleme.push(`${name}: expected ${erwartet}, got ${JSON.stringify(funde)}`);
      }
    };
    schreibe('p/test/sauber.ts', "const server = createWovServer({ port: 0 });\nlet PORT = 0;\nconst url = `ws://127.0.0.1:${PORT}`;\nconst x = { retries: 2604 };\n// const PORT = 2604 (a comment)\n");
    erwarte('clean tree', pruefe(wurzel, ohneAusnahmen), 'sauber');
    for (const zeile of ['const PORT = 2604;', 'port: 2593,', 'const PORT_KEIN_PW = 2515;', 'server.listen(2551, () => {});', "const port = Number(process.env.X_PORT ?? 2586);", "env: { WOV_ADMIN_PORT: '2480' }", 'run(["--port", "1"]); const a = "--port 4000"', 'const P = { port: 27_314 };']) {
      schreibe('p/test/fest.ts', `${zeile}\n`);
      erwarte(`fixed port in "${zeile}"`, pruefe(wurzel, ohneAusnahmen), 'fixed port');
    }
    schreibe('p/test/fest.ts', 'const PORT = 2604;\n');
    schreibe('p/nicht-test.ts', 'const PORT = 2604;\n');
    erwarte('a file that is not a test is not looked at (fixed port only in test/fest.ts)', pruefe(wurzel, ohneAusnahmen).filter((f) => f.startsWith('p/nicht-test')), 'sauber');
    schreibe('p/pruefe-etwas.mjs', 'const PORT = 2604;\n');
    erwarte('a pruefe-* file is a test file', pruefe(wurzel, ohneAusnahmen).filter((f) => f.startsWith('p/pruefe-etwas')), 'fixed port');
    rmSync(join(wurzel, 'p/pruefe-etwas.mjs'));
    erwarte('an allowed line passes', pruefe(wurzel, { ...ohneAusnahmen, ausnahmen: [{ pfad: 'p/test/fest.ts', text: 'const PORT = 2604', grund: 'probe' }] }), 'sauber');
    schreibe('p/test/fest.ts', 'let PORT = 0;\n');
    erwarte('an entry that matches nothing is stale', pruefe(wurzel, { ...ohneAusnahmen, ausnahmen: [{ pfad: 'p/test/fest.ts', text: 'const PORT = 2604', grund: 'probe' }] }), 'stale exception');
    schreibe('p/test/fest.ts', 'const PORT = 2604;\n');
    erwarte('a number in FESTE_PORTS is accepted', pruefe(wurzel, { ...ohneAusnahmen, feste: { probe: { port: 2604, grund: 'probe' } } }), 'sauber');
    schreibe('tools/bindet.mjs', "const CLIENT_PORT = 5299;\nspawn('vite', ['--port', String(CLIENT_PORT)]);\n");
    schreibe('tools/nur-client.mjs', "const ZIEL = arg('url', 'http://localhost:5292');\n// vite --port 5293\n");
    schreibe('tools/dezimal.mjs', "const zz = -5292.9; const y = 0.2489; spawn('vite', ['--port', String(p)]);\n");
    const ohneTools = { ...ohneAusnahmen, ausnahmen: [{ pfad: 'p/test/fest.ts', text: 'const PORT = 2604', grund: 'probe' }] };
    erwarte('an unnamed tool that starts a server on a slot port is a finding', pruefe(wurzel, ohneTools), 'tools/bindet.mjs: starts a server on a slot port');
    erwarte('a tool that only reads a slot port as a URL is no finding', pruefe(wurzel, ohneTools).filter((f) => f.startsWith('tools/nur-client')), 'sauber');
    erwarte('a slot number inside a decimal is no finding', pruefe(wurzel, ohneTools).filter((f) => f.startsWith('tools/dezimal')), 'sauber');
    erwarte('the same tool, named on WERKZEUGE, passes', pruefe(wurzel, { ...ohneTools, werkzeuge: [{ pfad: 'tools/bindet.mjs', text: 'CLIENT_PORT = 5299', grund: 'probe' }] }).filter((f) => f.startsWith('tools/bindet')), 'sauber');
    schreibe('tools/neuer-slot.mjs', "const CLIENT_PORT = 5811;\nspawn('vite', ['--port', String(CLIENT_PORT)]);\n");
    schreibe('tools/neuer-slot2.mjs', "createWovServer({ port: 2711 });\n");
    schreibe('tools/nachbar.mjs', "const a = 5808, b = 5814, c = 2708, d = 2714, e = 2808, f = 2814; spawn('vite', ['--port', String(a)]);\n");
    erwarte('an unnamed tool on a slot 9-13 client port is a finding', pruefe(wurzel, ohneTools), 'tools/neuer-slot.mjs: starts a server on a slot port');
    erwarte('an unnamed tool on a slot 9-13 game port is a finding', pruefe(wurzel, ohneTools), 'tools/neuer-slot2.mjs: starts a server on a slot port');
    erwarte('the ports next to the slot 9-13 bands are no finding', pruefe(wurzel, ohneTools).filter((f) => f.startsWith('tools/nachbar')), 'sauber');
    rmSync(join(wurzel, 'tools'), { recursive: true });
    schreibe('tool.mjs', 'const P = 5299;\n');
    erwarte('a tool entry with its text passes', pruefe(wurzel, { ...ohneAusnahmen, ausnahmen: [], werkzeuge: [{ pfad: 'tool.mjs', text: 'const P = 5299', grund: 'probe' }], }).filter((f) => f.startsWith('stale tool')), 'sauber');
    erwarte('a tool entry whose text is gone is stale', pruefe(wurzel, { ...ohneAusnahmen, werkzeuge: [{ pfad: 'tool.mjs', text: 'const P = 1', grund: 'probe' }] }), 'stale tool entry');
    erwarte('a tool entry whose file is gone is stale', pruefe(wurzel, { ...ohneAusnahmen, werkzeuge: [{ pfad: 'gibtsnicht.mjs', text: 'x', grund: 'probe' }] }), 'stale tool entry');
  } finally {
    rmSync(wurzel, { recursive: true, force: true });
  }
  return { probleme, richtungen };
}

// ── Main ─────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const argument = process.argv.slice(2).find((a) => a.startsWith('--wurzel='));
  const wurzel = argument ? argument.slice('--wurzel='.length) : REPO;
  const start = Date.now();
  const { probleme, richtungen } = selbstprobe();
  if (probleme.length > 0) {
    console.error('the guard failed its own proof:');
    probleme.forEach((p) => console.error(`  ${p}`));
    process.exit(1);
  }
  console.log(`self-proof: ${richtungen} directions ok (clean tree, fixed-port forms, non-test file, pruefe-* file, allowed line, stale entry, FESTE_PORTS, tool entries, unnamed slot-port tools)`);
  const funde = pruefe(wurzel);
  console.log(`${wurzel}: ${funde.length} finding(s) in ${Date.now() - start} ms`);
  funde.forEach((f) => console.log(`  ${f}`));
  console.log(
    funde.length === 0
      ? `OK: no test file names a fixed port (${AUSNAHMEN.length} allowed lines, ${WERKZEUGE.length} named tool ports)`
      : 'RED: see the findings above. A fixed port in a test: use `port: 0` and `portVon(server)` from scripts/testport.mjs (AGENTS.md 3.3). A stale entry: delete it.',
  );
  process.exit(funde.length === 0 ? 0 : 1);
}
