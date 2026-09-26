/**
 * Arbeitskopie der Welt: pruefen, abnehmen, verwerfen (Karte K5.7). Aufruf ueber `tools/welt-abnehmen.sh`
 * und `tools/wov-update.sh`; die Regeln stehen in shared/src/worldlayout/weltArbeitskopie.ts.
 *
 *   npx tsx tools/welt-abnehmen.ts pruefen  <dev|live>   meldet den Abgleichsfall, schreibt nichts
 *   npx tsx tools/welt-abnehmen.ts abnehmen <dev|live>   Arbeitskopie -> Repo (sanitisiert), Basis neu
 *   npx tsx tools/welt-abnehmen.ts verwerfen <dev|live>  Arbeitskopie neu aus dem Repo (alte wird gesichert)
 *
 * Kein Git hier: der Commit gehoert dem Shell-Skript und nur mit --commit.
 * Ordner der Arbeitskopie: WOV_WELT_VERZEICHNIS, sonst /var/lib/wov/welten.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instanzName, weltDatei, weltRepoDatei } from '@wov/shared/src/instanz.js';
import { weltAbgleichen, weltAbnehmen, weltVerwerfen } from '@wov/shared/src/worldlayout/weltArbeitskopie.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [befehl, instanzArg] = process.argv.slice(2);

function abbruch(text: string): never {
  console.error(text);
  process.exit(2);
}

if (!['pruefen', 'abnehmen', 'verwerfen'].includes(befehl ?? '') || !instanzArg) {
  abbruch('Aufruf: welt-abnehmen.ts <pruefen|abnehmen|verwerfen> <dev|live>');
}
let instanz;
try {
  instanz = instanzName(instanzArg);
} catch (fehler) {
  abbruch((fehler as Error).message);
}
if (instanzArg !== instanz) abbruch(`Instanz "${instanzArg}" ist weder "dev" noch "live".`);
const repoDatei = weltRepoDatei(WURZEL, instanz);
const arbeitsDatei = weltDatei(WURZEL, instanz);

if (befehl === 'pruefen') {
  const a = weltAbgleichen({ repoDatei, arbeitsDatei, modus: 'pruefen' });
  console.log(`WELT_FALL=${a.fall}`);
  console.log(a.meldung);
  process.exit(0);
}
if (!existsSync(arbeitsDatei)) abbruch(`Arbeitskopie fehlt: ${arbeitsDatei} (der Spielserver legt sie beim Start an)`);
if (befehl === 'abnehmen') {
  const r = weltAbnehmen({ repoDatei, arbeitsDatei });
  console.log(`[Welt] abgenommen: ${arbeitsDatei} -> ${r.repoDatei} (Hash ${r.repoHash.slice(0, 8)}, ${r.geaendert ? 'Repo-Datei geaendert' : 'Repo-Datei unveraendert'}, verworfen: ${r.verworfen}${r.arbeitskopieAngeglichen ? ', Arbeitskopie auf den sanitisierten Text gesetzt (Sicherung liegt daneben)' : ''})`);
  if (r.verworfen > 0) console.warn(`[Welt] WARNUNG: der Sanitizer hat ${r.verworfen} Eintraege verworfen`);
} else {
  if (!existsSync(repoDatei)) abbruch(`Repo-Datei fehlt: ${repoDatei}`);
  const r = weltVerwerfen({ repoDatei, arbeitsDatei });
  console.log(`[Welt] verworfen: Arbeitskopie ${arbeitsDatei} neu aus dem Repo (Hash ${r.repoHash.slice(0, 8)}), alte gesichert als ${r.sicherung ?? '(keine)'}`);
  console.log('[Welt] Ein laufender Spielserver kennt die neue Welt erst nach einem Neustart.');
}
