/**
 * Zeuge: `tools/vorschau-buendeln.mjs` laeuft ohne Assets gruen durch.
 * Der Typpruefschritt (tsc) ist der erste Schritt des Skripts und bricht
 * das Buendeln ab, wenn er rot ist.
 *
 * ── Der Anlass (28.09.2026) ─────────────────────────────────────────
 * PR #121 (Object.hasOwn in shared/src/texte.ts) brach den Webseitenbau
 * auf DEV: `tools/vorschau-buendeln.mjs` pruefte mit `--target es2020`
 * (Default-Lib ES2020), dort fehlt Object.hasOwn (ES2022) → TS2550.
 * Die GitHub-CI sah das nicht: Der web-Job prueft nur wov-web, keiner
 * faehrt `tools/vorschau-buendeln.mjs`.
 *
 * Dieser Test fuehrt das echte Skript aus (Typpruefung + esbuild-Buendel)
 * in ein Temp-Verzeichnis. Er braucht keine Assets: tsc liest nur Quellen
 * und .d.ts, esbuild buendelt nur Module (die GLB-Modelle laedt die Seite
 * zur Laufzeit). Er laeuft deshalb auch in der CI (WOV_OHNE_MODELLE=1)
 * und wird nicht still uebersprungen.
 *
 * Lauf:  npx tsx tools/test/vorschau-buendeln-typpruefung.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, zeuge = '') => {
  console.log(`${bedingung ? 'OK   ' : 'FEHLT'} ${text}${bedingung ? '' : ` [${zeuge}]`}`);
  if (!bedingung) fehler += 1;
};

const temp = mkdtempSync(join(tmpdir(), 'vorschau-buendeln-typpruefung-'));
try {
  const aus = join(temp, 'vorschau.js');
  const r = spawnSync(process.execPath, ['tools/vorschau-buendeln.mjs', '--aus', aus], {
    cwd: WURZEL,
    encoding: 'utf-8',
    timeout: 120_000,
  });

  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';

  pruefe(r.error === undefined, 'das Skript startet ohne Ausnahme (kein Spawn-/Timeout-Fehler)', r.error?.message);
  pruefe(r.status === 0, 'vorschau-buendeln.mjs laeuft ohne Assets gruen (Typpruefung + Buendel)', `rc=${r.status}\n${stderr}`);
  pruefe(stdout.includes('Typen pruefen'), 'der Typpruefschritt (tsc) wurde wirklich erreicht', stdout.slice(0, 200));
  pruefe(stdout.includes('GEBUENDELT'), 'das Buendel wurde nach der Typpruefung erzeugt', stdout.slice(0, 200));
  pruefe(
    existsSync(aus) && statSync(aus).size > 1_000_000,
    'die erzeugte Datei existiert und ist groesser als 1 MB (echtes Buendel, nicht leer)',
    existsSync(aus) ? `${statSync(aus).size} bytes` : 'Datei fehlt',
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) rot.`);
  process.exit(1);
}
console.log('\nvorschau-buendeln-typpruefung: alles gruen');
