/**
 * Arbeitskopie der Welt: pruefen, abnehmen, verwerfen (Karte K5.7). Aufruf ueber `tools/welt-abnehmen.sh`
 * und `tools/wov-update.sh`; die Regeln stehen in shared/src/worldlayout/weltArbeitskopie.ts.
 *
 *   npx tsx tools/welt-abnehmen.ts pruefen  <dev|live>   meldet den Abgleichsfall, schreibt nichts
 *   npx tsx tools/welt-abnehmen.ts abnehmen <dev|live>   Arbeitskopie -> Repo-Datei (sanitisiert). KEINE Basis,
 *                                                        die Arbeitskopie bleibt unberuehrt
 *   npx tsx tools/welt-abnehmen.ts verwerfen <dev|live>  Arbeitskopie neu aus dem Repo (alte wird gesichert;
 *                                                        fehlt sie, wird sie angelegt)
 *
 * Kein Git hier: der Commit gehoert dem Shell-Skript und nur mit --commit.
 * Ordner der Arbeitskopie: WOV_WELT_VERZEICHNIS (absolut), sonst <Wurzel>/server/data/welten-arbeit.
 * `abnehmen` verweigert im DEV-Deployment (/opt/worldofvikings): dort bearbeitet niemand etwas.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instanzName, weltDatei, weltRepoDatei, WeltVerzeichnisUngueltig } from '@wov/shared/src/instanz.js';
import { weltAbgleichen, weltAbnehmen, weltVerwerfen } from '@wov/shared/src/worldlayout/weltArbeitskopie.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [befehl, instanzArg] = process.argv.slice(2);

function abbruch(text: string): never {
  console.error(text);
  process.exit(2);
}

if (!['pruefen', 'abnehmen', 'verwerfen', 'pfad'].includes(befehl ?? '') || !instanzArg) {
  abbruch('Aufruf: welt-abnehmen.ts <pruefen|abnehmen|verwerfen|pfad> <dev|live>');
}
let instanz;
try {
  instanz = instanzName(instanzArg);
} catch (fehler) {
  abbruch((fehler as Error).message);
}
if (instanzArg !== instanz) abbruch(`Instanz "${instanzArg}" ist weder "dev" noch "live".`);
const repoDatei = weltRepoDatei(WURZEL, instanz);
let arbeitsDatei: string;
try {
  arbeitsDatei = weltDatei(WURZEL, instanz);
} catch (fehler) {
  if (!(fehler instanceof WeltVerzeichnisUngueltig)) throw fehler;
  abbruch(fehler.message);
}

if (befehl === 'pfad') {
  console.log(arbeitsDatei);
  process.exit(0);
}
if (befehl === 'pruefen') {
  const a = weltAbgleichen({ repoDatei, arbeitsDatei, modus: 'pruefen' });
  console.log(`WELT_FALL=${a.fall}`);
  console.log('WELT_GESCHRIEBEN=nein (nur geprueft)');
  console.log(a.meldung);
  process.exit(0);
}
if (befehl === 'abnehmen') {
  // Das DEV-Deployment ist kein Arbeitsplatz: dort nur --status/--diff. Abnehmen und Committen im eigenen Worktree.
  const devCheckout = process.env.WOV_DEV_CHECKOUT ?? '/opt/worldofvikings'; // Pruefhaken fuer Tests
  const echt = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  if (echt(WURZEL) === echt(devCheckout)) {
    abbruch(
      `Verweigert: ${WURZEL} ist das DEV-Deployment, dort wird nichts abgenommen oder committet. ` +
        `Auf DEV: tools/welt-abnehmen.sh ${instanz} --status und --diff. Dann im eigenen Worktree ` +
        `(Branch agent/<agent>/<slug>): WOV_WELT_VERZEICHNIS=<Ordner der DEV-Arbeitskopie> tools/welt-abnehmen.sh ${instanz} --commit, ` +
        `und den Stand per Pull Request ins Repo bringen.`
    );
  }
  if (!existsSync(arbeitsDatei)) abbruch(`Arbeitskopie fehlt: ${arbeitsDatei} (der Spielserver legt sie beim Start an)`);
  const r = weltAbnehmen({ repoDatei, arbeitsDatei });
  console.log(`[Welt] abgenommen: ${arbeitsDatei} -> ${r.repoDatei} (Hash ${r.repoHash.slice(0, 8)}, ${r.geaendert ? 'Repo-Datei geaendert' : 'Repo-Datei unveraendert'}, verworfen: ${r.verworfen}); Arbeitskopie und Basis unberuehrt`);
  if (r.verworfen > 0) console.warn(`[Welt] WARNUNG: der Sanitizer hat ${r.verworfen} Eintraege verworfen`);
} else {
  if (!existsSync(repoDatei)) abbruch(`Repo-Datei fehlt: ${repoDatei}`);
  const r = weltVerwerfen({ repoDatei, arbeitsDatei });
  if (r.angelegt) console.log(`[Welt] Arbeitskopie fehlte: ${arbeitsDatei} neu aus dem Repo angelegt (Hash ${r.repoHash.slice(0, 8)}), nichts zu sichern`);
  else console.log(`[Welt] verworfen: Arbeitskopie ${arbeitsDatei} neu aus dem Repo (Hash ${r.repoHash.slice(0, 8)}), alte gesichert als ${r.sicherung ?? '(keine)'}`);
  console.log('[Welt] Ein laufender Spielserver kennt die neue Welt erst nach einem Neustart.');
}
