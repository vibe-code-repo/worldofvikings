#!/usr/bin/env node
/**
 * Prüft: die beiden Weichen aus `scripts/testweichen.mjs` — vor allem, dass
 * sie NICHT immer überspringen.
 *
 * S3 (Elemente-Umzug). Eine Überspring-Weiche ist die gefährlichste Art von
 * Testcode: Ihr Fehlschlag sieht aus wie Erfolg. Wer `brauchtBlender()`
 * versehentlich so schreibt, dass sie überall einen Grund liefert, bekommt
 * einen grünen Sammellauf, in dem der Kit-Neubau nie wieder läuft — und
 * merkt es erst, wenn ein verstelltes Bauskript ausgeliefert ist.
 *
 * Der Zeuge dagegen ist ein ZWEITER, unabhängiger Weg zur selben Frage: Die
 * Weiche fragt `flatpak info` (billig), dieser Test STARTET Blender wirklich
 * (teuer) und hält beide Antworten gegeneinander. Sie müssen in beide
 * Richtungen übereinstimmen — läuft Blender, muss die Weiche `null` sagen;
 * läuft keiner, muss sie einen Grund nennen. Damit ist der Test auf einer
 * Maschine mit Blender genauso aussagekräftig wie auf `wov-dev` ohne.
 *
 * Dazu die Verdrahtung: Die Weichen nützen nichts, solange sie nicht am
 * Sammellauf hängen. Geprüft wird deshalb auch der Quelltext von
 * `run-tests.mjs` — dass er die Weichen von hier bezieht (statt eine zweite
 * Fassung zu führen) und dass der Blender-Test wirklich hinter der Weiche
 * steht.
 *
 * Aufruf:  npx tsx scripts/pruefe-weichen.mjs [--weichen=<pfad>]
 * `--weichen=` lädt eine ANDERE Weichen-Datei — die Zahnprobe (Muster
 * `kit-neubau.mjs --bauskript=`): Wer wissen will, ob dieser Test rot werden
 * kann, kopiert `testweichen.mjs` neben das Original, verstellt eine Zeile
 * und lässt ihn gegen die Kopie laufen. Die Kopie muss in `scripts/` liegen,
 * weil `WURZEL` dort relativ zum eigenen Ort bestimmt wird.
 *
 * Guards the skip switches: they must skip for a reason, and never always.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const EIGEN = process.argv.find((a) => a.startsWith('--weichen='));
const WEICHENPFAD = EIGEN ? resolve(EIGEN.slice('--weichen='.length)) : join(HIER, 'testweichen.mjs');
if (EIGEN) console.log(`[weichen] Weichen-Datei ersetzt: ${WEICHENPFAD}`);

const {
  brauchtModelle,
  brauchtBlender,
  brauchtStore,
  missingBlenderReason,
  BLENDER_REF,
  WURZEL,
} = await import(pathToFileURL(WEICHENPFAD).href);

/* Der Zeuge muss auch dann gelten, wenn der Sammellauf gerade den FEHLSTAND
   probt: `WOV_OHNE_MODELLE=1 node scripts/run-tests.mjs` vererbt die
   Variable an jeden Test, auch an diesen — und dann meldete Block 1 einen
   Grund für eine Datei, die sehr wohl da ist, und Block 3 einen Widerspruch
   zwischen Weiche und echtem Blender-Start. Am 04.09.2026 im Probelauf
   genau so passiert (3 FAIL, alle unecht).

   Die Überschreibungen werden deshalb hier abgeräumt und nur dort gesetzt,
   wo ein Fall sie ausdrücklich braucht. */
for (const schluessel of ['WOV_OHNE_MODELLE', 'WOV_OHNE_BLENDER', 'WOV_OHNE_STORE']) {
  if (process.env[schluessel] !== undefined) {
    console.log(`[weichen] ${schluessel} aus der Umgebung abgeräumt — jeder Fall setzt sie selbst`);
    delete process.env[schluessel];
  }
}

let geprueft = 0;
let fehler = 0;

/** Eine Zusicherung; zählt mit, damit ein Lauf ohne Prüflinge auffällt. */
function pruefe(behauptung, text) {
  geprueft += 1;
  if (behauptung) {
    console.log(`  OK   ${text}`);
    return;
  }
  fehler += 1;
  console.log(`  FAIL ${text}`);
}

/* Umgebungsvariablen werden im laufenden Prozess verstellt und danach wieder
   hergestellt. `delete` statt `= undefined`: Letzteres macht aus der
   Variablen den String "undefined", und die Weiche verglich dann gegen '1'
   und fände nie wieder etwas — der Rest des Tests liefe still im falschen
   Zustand. */
function mitUmgebung(schluessel, wert, tun) {
  const vorher = process.env[schluessel];
  if (wert === null) delete process.env[schluessel];
  else process.env[schluessel] = wert;
  try {
    return tun();
  } finally {
    if (vorher === undefined) delete process.env[schluessel];
    else process.env[schluessel] = vorher;
  }
}

console.log('\n[1] brauchtModelle — vorhanden, fehlend, vorgetäuscht fehlend');
{
  const da = brauchtModelle('package.json')();
  pruefe(da === null, `vorhandene Datei ⇒ kein Grund (bekam ${JSON.stringify(da)})`);

  const weg = brauchtModelle('assets/models/GibtEsNichtS3.glb')();
  pruefe(typeof weg === 'string' && weg.length > 0, 'fehlende Datei ⇒ Grund im Klartext');
  pruefe(
    String(weg).includes('GibtEsNichtS3.glb'),
    'der Grund NENNT die fehlende Datei (sonst sucht man sie von Hand)',
  );

  const gemischt = brauchtModelle('package.json', 'assets/models/GibtEsNichtS3.glb')();
  pruefe(
    String(gemischt).includes('GibtEsNichtS3.glb') && !String(gemischt).includes('package.json'),
    'bei mehreren Dateien nennt der Grund nur die fehlenden',
  );

  const vorgetaeuscht = mitUmgebung('WOV_OHNE_MODELLE', '1', () => brauchtModelle('package.json')());
  pruefe(
    String(vorgetaeuscht).includes('WOV_OHNE_MODELLE'),
    'WOV_OHNE_MODELLE=1 ⇒ übersprungen, und der Grund nennt die Variable',
  );
}

console.log('\n[2] brauchtBlender — die beiden vorgetäuschten Fehlstände');
{
  const abgeschaltet = mitUmgebung('WOV_OHNE_BLENDER', '1', () => brauchtBlender()());
  pruefe(
    String(abgeschaltet).includes('WOV_OHNE_BLENDER'),
    'WOV_OHNE_BLENDER=1 ⇒ übersprungen, und der Grund nennt die Variable',
  );

  /* PATH ohne flatpak: der Fall `wov-dev`/CI-Checkout, ohne dass hier etwas
     deinstalliert werden müsste. Ein leeres Verzeichnis als ganzer PATH —
     dort liegt garantiert kein flatpak. */
  const leer = mkdtempSync(join(tmpdir(), 'wov-ohne-flatpak-'));
  try {
    const ohnePfad = mitUmgebung('PATH', leer, () => brauchtBlender()());
    pruefe(typeof ohnePfad === 'string' && ohnePfad.length > 0, 'PATH ohne flatpak ⇒ übersprungen');
    pruefe(
      /flatpak|blender/i.test(String(ohnePfad)),
      'der Grund nennt flatpak/Blender (sonst rät man am Sammellauf herum)',
    );
  } finally {
    rmSync(leer, { recursive: true, force: true });
  }
}

console.log('\n[3] Der Zeuge: billige Auskunft gegen echten Blender-Start');
{
  /* Unabhängiger Weg: `flatpak run` statt `flatpak info`. Stimmen beide
     nicht überein, ist die Weiche kaputt — und zwar in der Richtung, die
     man sonst nie bemerkt (immer überspringen). */
  const start = spawnSync('flatpak', ['run', BLENDER_REF, '--version'], {
    encoding: 'utf8',
    timeout: 300_000,
  });
  const laeuftWirklich = !start.error && start.status === 0 && /blender/i.test(start.stdout ?? '');
  const grund = missingBlenderReason();
  console.log(
    `  [zeuge] echter Start: ${laeuftWirklich ? (start.stdout ?? '').split('\n')[0].trim() : 'kein Blender'}` +
      `  ·  Weiche: ${grund === null ? 'läuft' : grund}`,
  );
  pruefe(
    laeuftWirklich === (grund === null),
    'billige Auskunft und echter Start sind sich einig (in BEIDE Richtungen)',
  );

  if (laeuftWirklich) {
    pruefe(
      brauchtBlender()() === null,
      'auf dieser Maschine läuft der Blender-Test wirklich — die Weiche überspringt ihn NICHT',
    );
    /* Zweite Ebene: Blender da, Modelle weg. Der Grund muss durchgereicht
       werden statt in einem „läuft schon" zu verschwinden. */
    const ohneModell = brauchtBlender('assets/models/GibtEsNichtS3.glb')();
    pruefe(
      String(ohneModell).includes('GibtEsNichtS3.glb'),
      'mit Blender, ohne Modell ⇒ die Modell-Weiche kommt durch',
    );
  } else {
    console.log('  [zeuge] ohne Blender: die Richtung „läuft ⇒ nicht überspringen" bleibt hier ungeprüft.');
  }
}

console.log('\n[3b] brauchtStore — der Asset-Speicher');
{
  /*
    Die Weiche prüft NUR, ob `assets/store` überhaupt da ist. Das ist
    ihre ganze Absicht (Begründung in testweichen.mjs): Ein fehlender
    Ordner ist eine Maschine ohne Assets, eine fehlende Datei DARIN ist
    ein Befund, den der Test selbst melden soll.
  */
  const echt = brauchtStore()();
  const daIstEr = existsSync(join(WURZEL, 'assets/store'));
  pruefe(
    daIstEr ? echt === null : typeof echt === 'string',
    `assets/store ${daIstEr ? 'liegt vor ⇒ kein Grund' : 'fehlt ⇒ Grund im Klartext'} (bekam ${JSON.stringify(echt)})`,
  );
  if (!daIstEr) {
    pruefe(String(echt).includes('assets/store'), 'der Grund NENNT den fehlenden Ordner');
  }

  const vorgetaeuscht = mitUmgebung('WOV_OHNE_STORE', '1', () => brauchtStore()());
  pruefe(
    String(vorgetaeuscht).includes('WOV_OHNE_STORE'),
    'WOV_OHNE_STORE=1 ⇒ übersprungen, und der Grund nennt die Variable',
  );
}

console.log('\n[4] Verdrahtung — hängen die Weichen am Sammellauf?');
{
  const lauf = readFileSync(join(WURZEL, 'scripts', 'run-tests.mjs'), 'utf8');
  pruefe(
    /'test\/store-erzeugung\.ts',\s*brauchtStore\(/.test(lauf),
    'der Erzeugungstest der Asset-Brücke steht hinter brauchtStore(...)',
  );
  pruefe(
    /from '\.\/testweichen\.mjs'/.test(lauf),
    'run-tests.mjs bezieht die Weichen aus testweichen.mjs',
  );
  pruefe(
    !/function\s+brauchtModelle/.test(lauf),
    'run-tests.mjs führt KEINE zweite Fassung von brauchtModelle mehr',
  );
  pruefe(
    lauf.includes("'kit-neubau.mjs'"),
    'der Kit-Neubau steht überhaupt in der Testliste (sonst bewacht die Weiche nichts)',
  );
  pruefe(
    /'kit-neubau\.mjs',\s*brauchtBlender\(/.test(lauf),
    'und er steht hinter brauchtBlender(...)',
  );
  pruefe(
    /'stonevault-kantensonde\.ts',\s*brauchtModelle\(/.test(lauf),
    'die Kantensonde steht weiterhin hinter brauchtModelle(...)',
  );
}

// Leerlauf-Falle: ein Lauf ohne Zusicherungen darf nicht wie ein bestandener
// aussehen (dieselbe Regel wie beim Pfad-Wächter).
if (geprueft < 14) {
  console.log(`\nWEICHEN-PROBE ROT — nur ${geprueft} Zusicherungen gefahren, erwartet mindestens 14.`);
  process.exit(1);
}
if (fehler > 0) {
  console.log(`\nWEICHEN-PROBE ROT — ${fehler} von ${geprueft} Zusicherungen fehlgeschlagen.`);
  process.exit(1);
}
console.log(`\nWEICHEN-PROBE OK — ${geprueft} Zusicherungen; die Weichen überspringen mit Grund, nie grundlos.`);
