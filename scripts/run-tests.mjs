#!/usr/bin/env node
/**
 * Test-Runner (Review-Punkt 26): fährt die kuratierte Testliste sequenziell
 * und aggregiert die Exit-Codes — vorher liefen 29 Testdateien nur einzeln
 * von Hand.
 *
 *   npm test              die Liste KERN, alles in einem Lauf (rund 10 min)
 *
 * WO TRAGE ICH EINEN NEUEN TEST EIN? Nicht hier. KERN steht in einer Datei je Bereich
 * unter `scripts/kern/` (admin, client, scripts, server, shared, tools; der Bereich ist das
 * erste Stück des Pfads). Trag den Eintrag `[paket, datei, weiche?]` dort an seiner
 * ALPHABETISCHEN Stelle ein (sortiert nach dem vollen Pfad `paket/datei`), samt Kommentar
 * direkt darüber, NICHT ans Dateiende: So fügen zwei parallele Pull Requests an
 * verschiedenen Stellen ein, und git mergt sie ohne Konflikt. `scripts/pruefe-runner-liste.mjs`
 * verlangt die Sortierung. Ein neuer Bereich braucht eine neue Datei UND den Import samt
 * Aufnahme in KERN weiter unten; ohne beides bleibt der Zeuge rot.
 *
 * WEICHEN (S3): Einträge mit dritter Stelle laufen nur, wenn ihre
 * Voraussetzung da ist — `assets/` (liegt ausserhalb des Repos) und/oder
 * der Flatpak-Blender (`wov-dev` hat keinen). Fehlt sie, steht dort
 * ÜBERSPRUNGEN mit dem Grund im Klartext statt eines roten Tests. Proben
 * lässt sich beides ohne Umbau der Maschine:
 *
 *   WOV_OHNE_MODELLE=1 node scripts/run-tests.mjs   (CI-Checkout)
 *   WOV_OHNE_BLENDER=1 node scripts/run-tests.mjs   (wov-dev)
 *
 * Dass eine Weiche nicht IMMER überspringt, hält scripts/pruefe-weichen.mjs
 * fest — er steht selbst in der Liste. Dass keine Testdatei im Baum FEHLT,
 * hält scripts/pruefe-runner-liste.mjs fest: Er geht vom Baum aus und meldet
 * jede Testdatei, die weder hier steht noch dort mit Grund ausgenommen ist
 * (Messbänke, Prüfer mit Argumenten, bekannt rote Tests). Neue Testdatei
 * anlegen heißt also: in der Bereichsdatei unter scripts/kern/ eintragen.
 *
 * NICHT enthalten sind die C++-Golden-Tests (geo-compare, heightmap-compare,
 * geo-map): sie brauchen Referenz-Dumps als Argument und gehören zum
 * eingefrorenen Übergangspfad der radialen Weltgenerierung. Ebenso math-golden.ts (dieselbe Art
 * Referenz-Dumps, random_values.txt/perlin_values.txt) sowie geo-correlate.ts
 * — alle vier tragen die Begründung bereits im eigenen Kopfkommentar.
 *
 * Reine Werkzeuge/Messbänke, keine Tests (drucken Zahlen, behaupten nichts,
 * kein process.exit(1)-Pfad — s. jeweiliger Kopfkommentar):
 * shared/test/rain-freq.ts, shared/test/heightmap-bench.ts,
 * client/test/durchgangshoehe-mess.ts, client/test/torbogen-hoehe-mess.ts
 * (beide vom 11.09.2026, zur Umstellung auf die Original-Kapselhöhe 2,0 m:
 * wie hoch die niedrigste Stelle wirklich ist, durch die die Figur muss).
 *
 * Ebenfalls NICHT enthalten: shared/test/dungeon2-browser-check.ts. Das ist
 * kein Node-Test, sondern der BÜNDEL-EINSTIEG der Browser-Seite des
 * Determinismus-Prüfstands (AP5) — er benutzt `document` und stürbe unter
 * tsx sofort. Er wird per esbuild gebaut und im Browser geöffnet; die
 * Anleitung steht in seinem eigenen Kopfkommentar.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests erben nie die Welt-Variablen einer Shell oder eines Dienstes: sonst schriebe ein Test in die echte
// (DEV-)Welt oder trafe einen fremden Betriebsdienst. Ein Test, der sie braucht, setzt sie selbst auf Temp.
// Tests never inherit the world variables of a shell or a service; a test that needs them sets them to a temp dir.
delete process.env.WOV_WELT_VERZEICHNIS;
delete process.env.WOV_ADMIN_URL;
delete process.env.WOV_DEV_CHECKOUT;

/*
  Die BUCHFUEHRUNG (Laufzeitzeuge): Der Runner bucht jeden Start (`fahre` schreibt
  die Testdatei auf, die WIRKLICH an den Kindprozess geht), jede Weiche
  (`ueberspringe`) und jedes bewusste Auslassen (`auslassen`, mit Grund), und
  `beende` vergleicht das am Ende mit dem LITERAL von KERN in diesem Quelltext —
  nicht mit der lebenden Variablen, an der man zwischen Liste und Lauf drehen
  koennte. Schlusszeile und Exit-Code kommen aus dieser Buchfuehrung; ein Lauf,
  der `beende` nie erreicht, bleibt bei Exit 1. Exit 3 heisst TEILLAUF (mit
  `auslassen` weggelassen); `--teillauf-erlaubt` macht einen gruenen Teillauf zu
  Exit 0 (dann steht TEILLAUF trotzdem in der Zeile). Dieser Runner darf sonst
  umgebaut werden (Helfer, Teillisten, Filter, Parallelisierung), solange jeder
  Start ueber `fahre` geht und am Ende `beende` gerufen wird. Sie steht in einer
  eigenen Datei, damit `scripts/pruefe-runner-liste.mjs` sie testen kann.

  Bookkeeping in its own module: what the runner really started is held against
  the literal of KERN; closing line and exit code come from the books.
*/
import { beende, fahre, leereUndBeende, neueBuchfuehrung, ueberspringe } from './runner-buchfuehrung.mjs';


/*
  Die WEICHEN (S3, Elemente-Umzug) leben in `scripts/testweichen.mjs`: `brauchtModelle`
  fuer Tests, die `assets/` brauchen, `brauchtBlender` fuer die, die zusaetzlich den
  Flatpak-Blender brauchen, dazu `brauchtStore` und `brauchtBodenQuellen`. Ein Eintrag der
  Liste hängt sie als dritte Stelle an und importiert sie selbst in seiner Bereichsdatei
  unter `scripts/kern/`; hier wird nur `WURZEL` gebraucht. Fehlt die Voraussetzung, wird
  der Test als UEBERSPRUNGEN gemeldet statt rot; die Sonde selbst darf das nie entscheiden.

  Warum die Weichen in einer eigenen Datei stehen: Eine Weiche, die IMMER ueberspringt, ist
  von einer richtigen nicht zu unterscheiden — der Lauf ist in beiden Faellen gruen. Pruefen
  laesst sie sich nur, wenn man sie importieren kann, und wer DIESE Datei importiert, faehrt
  die ganze Testliste. Der Zeuge dagegen ist `scripts/pruefe-weichen.mjs`; er steht selbst
  in der Liste.

  Skip switches live in their own module so they can be tested; the entries import them in
  their area files.
*/
import { WURZEL } from './testweichen.mjs';

/*
  Die LISTE KERN steht nicht mehr hier, sondern in einer Datei je Bereich unter
  `scripts/kern/` (Bereich = erstes Stück des Pfads: admin, client, scripts, server,
  shared, tools). Jede Datei exportiert ein Array-Literal `[paket, datei, weiche?]`,
  nach Pfad sortiert; hier werden sie in fester Reihenfolge verkettet. Warum: Vorher hängte
  jeder Pull Request seinen Eintrag ans Ende EINER Liste, und zwei parallele PRs
  kollidierten dort immer. Jetzt trägt jeder Test an seiner alphabetischen Stelle ein.
  Wer eine neue Bereichsdatei anlegt, importiert sie hier UND nimmt sie in KERN auf;
  `scripts/pruefe-runner-liste.mjs` und die Buchführung werden sonst rot.

  The list KERN lives in one file per area under scripts/kern/, sorted by path, so that
  parallel pull requests insert at different places and merge cleanly.
*/
import KERN_ADMIN from './kern/admin.mjs';
import KERN_CLIENT from './kern/client.mjs';
import KERN_SCRIPTS from './kern/scripts.mjs';
import KERN_SERVER from './kern/server.mjs';
import KERN_SHARED from './kern/shared.mjs';
import KERN_TOOLS from './kern/tools.mjs';

const KERN = [...KERN_ADMIN, ...KERN_CLIENT, ...KERN_SCRIPTS, ...KERN_SERVER, ...KERN_SHARED, ...KERN_TOOLS];


const QUELLE = fileURLToPath(import.meta.url);

/*
  Der Runner nimmt nur `--teillauf-erlaubt` (siehe Buchfuehrung). `--alle` gab es
  bis 20.09.2026 (eine zweite Liste LANG); seither laeuft immer alles. Wer noch
  `npm test -- --alle` tippt, soll es merken, statt dass es still ignoriert wird.
*/
const ARGUMENTE = process.argv.slice(2);
const TEILLAUF_ERLAUBT = ARGUMENTE.includes('--teillauf-erlaubt');
const UNBEKANNT = ARGUMENTE.filter((a) => a !== '--teillauf-erlaubt');
if (UNBEKANNT.length > 0) {
  console.error(
    `run-tests.mjs: unbekannte Argumente: ${UNBEKANNT.join(' ')}\n` +
      '  Der Runner kennt nur --teillauf-erlaubt; `--alle` gibt es seit 20.09.2026 nicht mehr (die Liste LANG ist aufgeloest, alles laeuft immer).',
  );
  await leereUndBeende(process, 2);
}

// Ab hier ist der Lauf rot (Exit 1), bis `beende` am Ende entschieden hat.
const buch = neueBuchfuehrung();

/*
  Jeder Test laeuft als eigene Prozessgruppe, und der Runner reicht SIGINT,
  SIGTERM und SIGHUP an die laufende Gruppe weiter, wartet auf sie und endet
  dann mit 128 + Signalnummer. Vorher traf ein Signal nur den Runner; der
  tsx-Kindprozess lief als Waise weiter und hielt seinen festen Testport, sodass
  der naechste Lauf mit EADDRINUSE scheiterte. Dieselbe Gruppe bekommt auch das
  Zeitlimit von 600 s (erst SIGTERM, nach 5 s SIGKILL).

  Every test runs in its own process group; a signal that hits only the runner is
  passed on to the running group, and the runner waits for it before it exits.
*/
let laufendeGruppe = null;
let abbruchCode = null;
const gruppeSignal = (signal, gruppe = laufendeGruppe) => {
  if (gruppe === null) return;
  try {
    process.kill(-gruppe, signal);
  } catch {
    // die Gruppe ist schon weg
  }
};
for (const [signal, nummer] of [['SIGINT', 2], ['SIGHUP', 1], ['SIGTERM', 15]]) {
  process.on(signal, () => {
    abbruchCode = 128 + nummer;
    console.log(`\nABGEBROCHEN durch ${signal} — der laufende Test wird beendet, kein Ergebnis`);
    if (laufendeGruppe === null) {
      void leereUndBeende(process, abbruchCode);
      return;
    }
    gruppeSignal(signal);
    setTimeout(() => {
      gruppeSignal('SIGKILL');
      void leereUndBeende(process, abbruchCode);
    }, 10_000).unref();
  });
}

/*
  Die Ausgabe eines Tests geht in DATEIEN, nicht in Pipes. Zwei Gruende, beide am
  asynchronen Start entdeckt:
  - Ein Test, der viel in einem Zug schreibt und sofort `process.exit` ruft, verlor bei
    Pipes das Ende seiner Ausgabe (Schreibpuffer weg, wenn der Leser nicht mitkommt;
    505 KB: 0 von 3 vollstaendig) — genau die Zeilen, wegen derer man bei einem
    Fehlschlag hinsieht. In eine Datei schreibt der Test synchron; nichts geht verloren.
  - Ein Enkel mit eigener Sitzung, der die geerbten Pipes offen haelt, liess das
    Versprechen nie aufloesen (`'close'` kam nicht): der Lauf haengt. Ohne Pipes gibt es
    nichts, worauf zu warten waere; aufgeloest wird beim Ende des Kindes (`'exit'`).
  Gelesen wird nur nach einem Fehlschlag, und hoechstens die letzten 8 MiB. Jeder Test
  bekommt einen EIGENEN Unterordner (ein Enkel, der einen Test ueberlebt und weiter
  schreibt, landet so nie im Bericht des naechsten) und der Ordner wird nach dem Test
  geloescht.

  GESCHRIEBEN wird nur bis zu einer Grenze: Ein Wachhund prueft alle 10 ms die Groesse
  beider Dateien und den freien Platz auf dem Datentraeger. Ueber 64 MiB je Strom oder
  unter 32 MiB frei wird die Gruppe des Tests beendet (SIGKILL) und der Test ist ROT
  mit dem Grund; der Grund kommt aus dem Speicher des Runners, nicht aus den Dateien —
  bei vollem Datentraeger waere die Ursache in stderr.txt nie angekommen. Gemessen
  schreibt ein Test 150-200 MiB/s; ohne Grenze waere das Wurzeldateisystem (auch das
  der DEV-Dienste) in rund drei Minuten voll.

  Der Ordner liegt in /var/tmp, NICHT in os.tmpdir(): auf wov-dev ist /tmp ein tmpfs,
  also Arbeitsspeicher (16 GB Grenze auf einer Maschine mit 10 GB RAM), und ein Test mit
  durchgedrehter Ausgabe wuerde ihn fuellen; /var/tmp liegt auf Platte. Nur wo es
  /var/tmp nicht gibt (etwa Windows), gilt os.tmpdir().

  Test output goes to files, not pipes: nothing is lost at `process.exit`, and no
  grandchild that keeps a pipe open can make the run hang.
*/
const AUSGABE_BASIS = (() => {
  try {
    accessSync('/var/tmp', constants.W_OK);
    return '/var/tmp';
  } catch {
    return tmpdir();
  }
})();
const LAUF_ORDNER = mkdtempSync(join(AUSGABE_BASIS, 'wov-lauf-'));
process.on('exit', () => rmSync(LAUF_ORDNER, { recursive: true, force: true }));
const MAX_AUSGABE = 8 * 1024 * 1024;
const GRENZE_STROM = 64 * 1024 * 1024;
const MIN_FREI = 32 * 1024 * 1024;
const WACHE_MS = 10;
const mib = (bytes) => (bytes / 2 ** 20).toFixed(0);
/** Freie Bytes auf dem Datentraeger von `pfad`, oder null, wenn sich das nicht messen laesst. */
function freierPlatz(pfad) {
  try {
    const platz = statfsSync(pfad);
    return platz.bavail * platz.bsize;
  } catch {
    return null;
  }
}
const zuWenigPlatz = (frei) => `nur noch ${mib(frei)} MiB frei unter ${AUSGABE_BASIS} (Grenze ${mib(MIN_FREI)} MiB)`;
function liesAusgabe(pfad) {
  try {
    const groesse = statSync(pfad).size;
    if (groesse <= MAX_AUSGABE) return readFileSync(pfad, 'utf8');
    const puffer = Buffer.alloc(MAX_AUSGABE);
    const fd = openSync(pfad, 'r');
    readSync(fd, puffer, 0, MAX_AUSGABE, groesse - MAX_AUSGABE);
    closeSync(fd);
    return `[… ${groesse - MAX_AUSGABE} Bytes gekuerzt …]\n${puffer.toString('utf8')}`;
  } catch (fehlerLesen) {
    return `(Ausgabe nicht lesbar: ${fehlerLesen.message})`;
  }
}

/** Startet einen Test asynchron und liefert wie spawnSync `{ status, signal, stdout, stderr, error }`. */
function starteKind(befehl, argumente, optionen) {
  return new Promise((fertig) => {
    let testOrdner = null;
    let aus;
    let fehl;
    try {
      testOrdner = mkdtempSync(join(LAUF_ORDNER, 't-'));
      aus = openSync(join(testOrdner, 'stdout.txt'), 'w');
      fehl = openSync(join(testOrdner, 'stderr.txt'), 'w');
    } catch (fehlerAnlegen) {
      // Etwa Datentraeger voll: der Test startet nicht, und der Grund steht im Ergebnis.
      if (aus !== undefined) closeSync(aus);
      if (testOrdner !== null) rmSync(testOrdner, { recursive: true, force: true });
      fertig({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: new Error(`Ausgabedateien nicht anlegbar unter ${AUSGABE_BASIS}: ${fehlerAnlegen.message}`),
      });
      return;
    }
    const kind = spawn(befehl, argumente, { cwd: optionen.cwd, detached: true, stdio: ['ignore', aus, fehl] });
    const gruppe = kind.pid ?? null;
    let zeitlimit = false;
    let abbruchGrund = null;
    let erledigt = false;
    let hart = null;
    let spaet = null;
    const ende = (status, signal, error) => {
      if (erledigt) return;
      erledigt = true;
      // Kein Zeitgeber darf den naechsten Test treffen (SIGKILL auf eine Gruppe, die schon ein anderer Test ist).
      clearTimeout(frist);
      clearTimeout(hart);
      clearTimeout(spaet);
      clearInterval(wache);
      laufendeGruppe = null;
      closeSync(aus);
      closeSync(fehl);
      if (abbruchCode !== null) {
        void leereUndBeende(process, abbruchCode);
        return;
      }
      const gruen = status === 0 && !zeitlimit && abbruchGrund === null && !error;
      // Gelesen wird nur nach einem Fehlschlag.
      const stdout = gruen ? '' : liesAusgabe(join(testOrdner, 'stdout.txt'));
      const stderr = gruen ? '' : liesAusgabe(join(testOrdner, 'stderr.txt'));
      // Der Grund kommt aus dem Speicher des Runners: bei vollem Datentraeger ist er in stderr.txt nie angekommen.
      // Auch wenn der Wachhund den Test nicht mehr erwischt hat (der Datentraeger war schneller voll als 10 ms),
      // steht der volle Datentraeger hier noch im Bericht.
      const frei = gruen || abbruchGrund !== null ? null : freierPlatz(testOrdner);
      const ursachen = [
        abbruchGrund !== null ? `Test abgebrochen: ${abbruchGrund}` : null,
        zeitlimit ? `Zeitlimit von ${optionen.timeout / 1000} s ueberschritten` : null,
        error ? error.message : null,
        frei !== null && frei < MIN_FREI ? `${zuWenigPlatz(frei)} — der Test kann am vollen Datentraeger gescheitert sein` : null,
      ].filter(Boolean);
      rmSync(testOrdner, { recursive: true, force: true });
      fertig({ status, signal, stdout, stderr, error: ursachen.length > 0 ? new Error(ursachen.join('; ')) : undefined });
    };
    const wache = setInterval(() => {
      if (abbruchGrund !== null) return;
      try {
        for (const [name, fd] of [['stdout', aus], ['stderr', fehl]]) {
          const groesse = fstatSync(fd).size;
          if (groesse > GRENZE_STROM) {
            abbruchGrund = `${name} ueber der Schreibgrenze von ${mib(GRENZE_STROM)} MiB (${mib(groesse)} MiB geschrieben)`;
            break;
          }
        }
        if (abbruchGrund === null) {
          const frei = freierPlatz(testOrdner);
          if (frei !== null && frei < MIN_FREI) abbruchGrund = zuWenigPlatz(frei);
        }
      } catch {
        // Messen ist Nebensache; der Test laeuft weiter
      }
      if (abbruchGrund !== null) gruppeSignal('SIGKILL', gruppe);
    }, WACHE_MS);
    const frist = setTimeout(() => {
      zeitlimit = true;
      gruppeSignal('SIGTERM', gruppe);
      hart = setTimeout(() => {
        gruppeSignal('SIGKILL', gruppe);
        // Kommt das Ende des Kindes trotzdem nicht, loest das Zeitlimit selbst auf.
        spaet = setTimeout(() => ende(null, 'SIGKILL'), 2_000);
      }, 5_000);
    }, optionen.timeout);
    laufendeGruppe = gruppe;
    kind.on('error', (error) => ende(null, null, error));
    kind.on('exit', (status, signal) => ende(status, signal));
  });
}

let fehler = 0;
const start = Date.now();

/**
 * Ausgabe eines fehlgeschlagenen Tests aufbereiten.
 *
 * Vorher standen hier nur die letzten 15 Zeilen. Das ging so lange gut,
 * wie ein Test seine Fehlschläge zum Schluss zusammenfasst — und ging
 * am 23.08.2026 schief: g3-mehrspieler-e2e.ts meldete "4 FEHLGESCHLAGEN",
 * die vier FAIL-Zeilen selbst standen aber weiter oben und wurden
 * abgeschnitten. Übrig blieben fünf PASS-Zeilen und eine Zahl, die zu
 * ihnen nicht passte — der Sammellauf zeigte also genau die eine
 * Information NICHT, für die man ihn liest.
 *
 * Deshalb jetzt: JEDE Zeile, die nach Befund aussieht, plus der Schwanz
 * für den Zusammenhang. Der Schnitt bleibt, weil Server-Tests hunderte
 * Fortschrittszeilen drucken ("[WoV] Vegetation: +1 zone(s) …") — nur
 * schneidet er nicht mehr das weg, worum es geht.
 */
const BEFUND = /\bFAIL\b|\bFEHL|✗|^\s*Error\b|\bAssertionError\b/;
function ausgabeAufbereiten(stdout) {
  const zeilen = (stdout ?? '').split('\n');
  const schwanzAb = Math.max(0, zeilen.length - 15);
  const befunde = [];
  for (let i = 0; i < schwanzAb; i++) {
    if (BEFUND.test(zeilen[i])) befunde.push(zeilen[i]);
  }
  const teile = [];
  if (befunde.length > 0) {
    teile.push(`  ── ${befunde.length} Befund-Zeile(n) weiter oben im Protokoll ──`);
    teile.push(...befunde);
    teile.push('  ── letzte 15 Zeilen ──');
  }
  teile.push(...zeilen.slice(schwanzAb));
  return teile.join('\n');
}

for (const [paket, datei, weiche] of KERN) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${paket}/${datei} … `);
  const grund = weiche?.();
  if (grund) {
    ueberspringe(buch, WURZEL, paket, datei);
    console.log(`ÜBERSPRUNGEN — ${grund}`);
    continue;
  }
  const lauf = await fahre(buch, starteKind, resolve(WURZEL, 'node_modules/.bin/tsx'), [datei], {
    cwd: resolve(WURZEL, paket),
    encoding: 'utf-8',
    timeout: 600_000,
  });
  const dauer = ((Date.now() - t0) / 1000).toFixed(1);
  if (lauf.status === 0) {
    console.log(`OK (${dauer}s)`);
  } else {
    fehler++;
    console.log(`FEHLGESCHLAGEN (${dauer}s)`);
    if (lauf.error) console.log(`  ${lauf.error.message}`);
    console.log(ausgabeAufbereiten(lauf.stdout));
    console.log(lauf.stderr ?? '');
  }
}

/*
 * Waechter gegen genau den Fehler, der server/test/konten/ bis
 * 12.09.2026 verschmutzt hat (s. WovServer.ServerConfig.kontenDir):
 * ein Test, der `worldsDir` auf sein eigenes tmp-Verzeichnis umbiegt,
 * `kontenDir` aber vergisst, landet ueber den DEFAULT_CONFIG-Fallback
 * wieder in einem geteilten Ordner -- und im schlimmsten Fall in einer
 * GETRACKTEN Datei, unsichtbar bis zum naechsten `git status`. Ein
 * gruener Sammellauf, der den Arbeitsbaum trotzdem verschmutzt, ist
 * kein gruener Lauf.
 *
 * Prueft NUR server/test (Ergebnisdateien anderer Pakete sind nicht
 * dieser Waechter), und nur GETRACKTE Aenderungen ("M"/"D" u.ae.) --
 * neue Wegwerfdateien unter server/test/tmp-Ordnern sind bereits per
 * .gitignore aussen vor und wuerden hier sonst jeden Lauf rot faerben.
 *
 * Guard against the bug that dirtied server/test/konten/ until
 * 12.09.2026: a test that redirects worldsDir to its own tmp folder but
 * forgets kontenDir falls back to a shared (or worse, tracked) path,
 * invisibly, until the next `git status`. A collective run that leaves
 * the working tree dirty is not a green run.
 */
const gitStatus = spawnSync('git', ['status', '--porcelain', '--', 'server/test'], {
  cwd: WURZEL,
  encoding: 'utf-8',
});
const schmutzigeZeilen = (gitStatus.stdout ?? '')
  .split('\n')
  .filter((zeile) => zeile.trim().length > 0)
  // Neue, unversionierte Dateien (Status "??") sind kein Fund dieses
  // Waechters -- die uebliche Spur eines vergessenen kontenDir/worldsDir
  // sind veraenderte oder neue GETRACKTE Dateien, s. Kopfkommentar.
  .filter((zeile) => !zeile.startsWith('??'));
if (schmutzigeZeilen.length > 0) {
  fehler++;
  console.log(
    `\n✗ Test(s) haben getrackte Dateien unter server/test veraendert ` +
      `(kontenDir/worldsDir vergessen? s. WovServer.ServerConfig.kontenDir):`
  );
  for (const zeile of schmutzigeZeilen) console.log(`  ${zeile}`);
}

// Schlusszeile und Exit-Code kommen aus der Buchfuehrung; `beende` endet den Prozess.
await beende(buch, {
  quelle: QUELLE,
  wurzel: WURZEL,
  fehler,
  teillaufErlaubt: TEILLAUF_ERLAUBT,
  dauer: ` in ${((Date.now() - start) / 1000).toFixed(0)}s`,
});
