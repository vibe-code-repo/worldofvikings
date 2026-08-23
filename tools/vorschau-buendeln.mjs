#!/usr/bin/env node
/**
 * Buendelt die Figurenvorschau samt Babylon zu EINER ES-Modul-Datei fuer
 * world-of-vikings.com.
 *
 *   node tools/vorschau-buendeln.mjs [--aus <datei>]
 *
 * ── Warum die Webseite ein Buendel braucht ───────────────────────────
 * world-of-vikings.com besteht aus statischen Dateien und hat bewusst
 * keinen Build-Schritt — ihr eigener Kopfkommentar begruendet das damit,
 * dass ein Schritt, den sonst niemand kennt, teurer ist als etwas
 * Wiederholung. Babylon laesst sich aber nicht als lose ES-Module
 * ausliefern; es sind Hunderte Dateien.
 *
 * Der Build passiert deshalb HIER, im Spiel-Repo, wo Babylon ohnehin
 * liegt, und die Webseite bekommt genau eine erzeugte Datei. Ein CDN
 * waere die Alternative — und widerspraeche dem Selbsthosten, das die
 * Seite fuer Schriften und Symbole schon durchhaelt.
 *
 * ── Groesse (gemessen 22.08.2026) ────────────────────────────────────
 *   roh          2,67 MB
 *   gzip         0,60 MB   ← das zaehlt, nginx komprimiert
 * Zum Vergleich: der Figurenkoerper allein ist 3,76 MB.
 */
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const argv = process.argv.slice(2);
const AUS = argv.includes('--aus')
  ? argv[argv.indexOf('--aus') + 1]
  : resolve(WURZEL, 'tools/web/vorschau.js');

/*
  ERST PRUEFEN, DANN BUENDELN.

  esbuild prueft keine Typen — es wirft sie weg. Am 23.08.2026 hat das eine
  Stunde gekostet: Beim Umbau war die Konstante FIGURHOEHE aus der Klasse
  verschwunden, `Vorschau.FIGURHOEHE` war damit undefined,
  `scaling.setAll(undefined)` setzte x/y/z auf undefined — und die Figur war
  spurlos weg. Keine Ausnahme, keine Konsolenmeldung, nichts im Bild.
  tsc haette es in einer Sekunde gemeldet.

  Deshalb laeuft der Typpruefer jetzt VOR dem Buendeln, und ein Fehler
  bricht ab, statt eine kaputte Datei zu erzeugen.
*/
console.log('Typen pruefen …');
execFileSync(resolve(WURZEL, 'node_modules/.bin/tsc'), [
  '--noEmit', '--skipLibCheck', '--strict',
  '--target', 'es2020', '--module', 'esnext', '--moduleResolution', 'bundler',
  resolve(WURZEL, 'tools/web/vorschau-web.ts'),
], { stdio: 'inherit' });

execFileSync(resolve(WURZEL, 'node_modules/.bin/esbuild'), [
  resolve(WURZEL, 'tools/web/vorschau-web.ts'),
  '--bundle', '--format=esm', '--minify', '--target=es2020',
  `--outfile=${AUS}`,
], { stdio: 'inherit' });

const roh = statSync(AUS).size;
const komprimiert = gzipSync(readFileSync(AUS), { level: 9 }).length;
console.log('GEBUENDELT ' + AUS + ' — ' + (roh/1048576).toFixed(2) + ' MB roh, ' + (komprimiert/1048576).toFixed(2) + ' MB gzip');//(
//)
console.log('Ausrollen:  scp %s wov-host:… → /var/www/wov/assets/js/vorschau.js', AUS);
