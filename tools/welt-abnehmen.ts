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
 *
 * Im DEV-Deployment gilt fuer alle anderen Befehle (pruefen, verwerfen, pfad; damit auch --status, --diff und
 * --verwerfen des Shell-Skripts): Ist WOV_WELT_VERZEICHNIS nicht gesetzt (eine Shell auf DEV hat die Variable
 * nicht, sie steht nur in den Units), liest dieses Werkzeug sie aus der installierten Unit (`systemctl show -p
 * Environment wov-server`, geprueft an wov-server UND wov-admin: beide muessen denselben Wert haben). Steht sie in einer der beiden nicht, oder widersprechen sich die
 * Units, endet es mit Exit 2 und nennt den Aufruf, der funktioniert. Es arbeitet dort nie still auf
 * <Wurzel>/server/data/welten-arbeit, der Datei, die kein Dienst liest.
 */
import { execFileSync } from 'node:child_process';
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

const echt = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
// Pruefhaken fuer Tests: der Ort, der als DEV-Deployment gilt.
const devCheckout = process.env.WOV_DEV_CHECKOUT ?? '/opt/worldofvikings';
const imDevCheckout = echt(WURZEL) === echt(devCheckout);

/** Der Wert von KEY aus der Ausgabe von `systemctl show -p Environment <unit>` (Werte mit Leerzeichen stehen in Anfuehrungszeichen). */
function unitVariable(unit: string, schluessel: string): string | null {
  let aus: string;
  try {
    aus = execFileSync('systemctl', ['show', '-p', 'Environment', unit], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const zeile = aus.split('\n').find((z) => z.startsWith('Environment='));
  if (!zeile) return null;
  // systemd schreibt C-Escapes (\t, \n, \xNN, \\, \"); bei doppeltem Schluessel gilt der letzte Eintrag.
  const escapes: Record<string, string> = { t: '\t', n: '\n', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', s: ' ' };
  let wert: string | null = null;
  for (const m of zeile.slice('Environment='.length).matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    const eintrag = (m[1] ?? m[2] ?? '').replace(/\\(x[0-9a-fA-F]{2}|.)/g, (_g, c: string) => (c.length === 3 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (escapes[c] ?? c)));
    if (eintrag.startsWith(`${schluessel}=`)) wert = eintrag.slice(schluessel.length + 1).trim() || null;
  }
  return wert;
}

if (befehl === 'abnehmen') {
  // Das DEV-Deployment ist kein Arbeitsplatz: dort nur --status/--diff. Abnehmen und Committen im eigenen Worktree.
  if (imDevCheckout) {
    abbruch(
      `Verweigert: ${WURZEL} ist das DEV-Deployment, dort wird nichts abgenommen oder committet. ` +
        `Auf DEV: tools/welt-abnehmen.sh ${instanz} --status und --diff. Dann im eigenen Worktree ` +
        `(Branch agent/<agent>/<slug>): WOV_WELT_VERZEICHNIS=<Ordner der DEV-Arbeitskopie> tools/welt-abnehmen.sh ${instanz} --commit, ` +
        `und den Stand per Pull Request ins Repo bringen.`
    );
  }
} else if (imDevCheckout && !(process.env.WOV_WELT_VERZEICHNIS ?? '').trim()) {
  // DEV-Shell ohne Variable: die Dienste laufen mit der Variable aus ihrer Unit. Ohne sie wuerde dieses Werkzeug
  // <Wurzel>/server/data/welten-arbeit lesen oder ueberschreiben, eine Datei, die kein Dienst nutzt.
  const vomServer = unitVariable('wov-server', 'WOV_WELT_VERZEICHNIS');
  const vomAdmin = unitVariable('wov-admin', 'WOV_WELT_VERZEICHNIS');
  const aufruf = `WOV_WELT_VERZEICHNIS=/var/lib/wov/welten tools/welt-abnehmen.sh ${instanz} <--status|--diff|--verwerfen>`;
  if (vomServer === null) {
    abbruch(
      `Verweigert: ${WURZEL} ist das DEV-Deployment, WOV_WELT_VERZEICHNIS ist nicht gesetzt und in der Unit wov-server nicht zu lesen ` +
        `(systemctl show -p Environment wov-server). Ohne die Variable liefe dieses Werkzeug auf ${resolve(WURZEL, 'server/data/welten-arbeit')}, ` +
        `einer Datei, die kein Dienst liest. Aufruf, der funktioniert: ${aufruf}`
    );
  }
  if (vomAdmin === null) {
    abbruch(
      `Verweigert: in der Unit wov-admin ist WOV_WELT_VERZEICHNIS nicht zu lesen (systemctl show -p Environment wov-admin), in wov-server steht ${vomServer}. ` +
        `Der Editor schriebe dann in eine andere Datei als der Server liest. Erst die Units angleichen (deploy/systemd/ installieren, systemctl daemon-reload); oder ausdruecklich: ${aufruf}`
    );
  }
  if (vomAdmin !== vomServer) {
    abbruch(
      `Verweigert: die Units widersprechen sich (wov-server: ${vomServer}, wov-admin: ${vomAdmin}). ` +
        `Erst die Units angleichen; oder ausdruecklich: ${aufruf}`
    );
  }
  process.env.WOV_WELT_VERZEICHNIS = vomServer;
  console.error(`[Welt] DEV: WOV_WELT_VERZEICHNIS nicht gesetzt, aus der Unit wov-server gelesen: ${vomServer}`);
}

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
