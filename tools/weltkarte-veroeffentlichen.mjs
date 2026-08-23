/**
 * Weltkarten rendern und auf die Webseite (wov-web) legen.
 *
 * Läuft auf wov-dev, für BEIDE Instanzen. Warum von hier aus und nicht je
 * Container für sich: wov-dev hat ohnehin beide Weltdateien im Arbeitsbaum
 * (`server/data/welten/dev.json` und `live.json`), denn genau so kommt die
 * Welt nach live — als committete Kopie, die live per `git pull` zieht. Ein
 * zweiter Renderlauf auf wov-live wäre dieselbe Rechnung auf demselben
 * Dokument, nur auf dem Container, den man laut Absprache nicht anfasst.
 *
 * ACHTUNG, die eine Annahme dahinter: `live.json` im Arbeitsbaum ist der
 * Stand, den wov-live fährt. Das stimmt, solange die Welt den vereinbarten
 * Weg nimmt (auf dev bearbeiten, committen, auf live ziehen). Wer die Welt
 * direkt auf live über den Editor speichert, sieht auf der Webseite den
 * älteren Stand. Der `fingerabdruck` in der Beschreibungsdatei ist dafür die
 * Gegenprobe: er ist der SHA-256 der Weltdatei, aus der das Bild entstand.
 *
 * Neu gerendert wird nur, wenn sich die Weltdatei wirklich geändert hat —
 * verglichen wird über diesen Fingerabdruck. Sonst kostete der stündliche
 * Lauf jedes Mal Rechenzeit für dasselbe Bild.
 *
 * Übertragen wird mit dem Schlüssel /root/.ssh/wov_karten. Auf wov-web hängt
 * an ihm ein Zwangsbefehl (/usr/local/bin/karten-empfang), der nur die fünf
 * Kartendateien annimmt — dieser Schlüssel öffnet dort keine Shell.
 *
 * Lauf:  node tools/weltkarte-veroeffentlichen.mjs [--neu] [--nur-rendern]
 *   --neu          rendert auch, wenn sich nichts geändert hat
 *   --nur-rendern  überträgt nicht (zum Prüfen auf der Konsole)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARBEIT = '/var/lib/wov-karten';
const BREITE = 4096;
const ZIEL = 'root@10.10.10.13';
const SCHLUESSEL = '/root/.ssh/wov_karten';
const INSTANZEN = ['dev', 'live'];

const neu = process.argv.includes('--neu');
const nurRendern = process.argv.includes('--nur-rendern');

const log = (...t) => console.log('[karten]', ...t);

mkdirSync(ARBEIT, { recursive: true });

/** SHA-256 der Weltdatei, gekürzt — dasselbe Verfahren wie im Renderer. */
function fingerabdruck(pfad) {
  return createHash('sha256').update(readFileSync(pfad)).digest('hex').slice(0, 16);
}

/** Fingerabdruck des zuletzt gerenderten Bildes, oder null. */
function gerendert(instanz) {
  const p = join(ARBEIT, `${instanz}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')).fingerabdruck ?? null;
  } catch {
    return null;
  }
}

function lauf(befehl, argumente, optionen = {}) {
  const e = spawnSync(befehl, argumente, { stdio: 'inherit', ...optionen });
  if (e.status !== 0) throw new Error(`${befehl} ${argumente.join(' ')} → Status ${e.status}`);
  return e;
}

/** Eine Datei über den Zwangsbefehl auf wov-web ablegen. */
function senden(datei) {
  const inhalt = readFileSync(join(ARBEIT, datei));
  const e = spawnSync(
    'ssh',
    ['-i', SCHLUESSEL, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', ZIEL, datei],
    { input: inhalt, encoding: 'buffer' }
  );
  if (e.status !== 0) {
    throw new Error(`Übertragung von ${datei} fehlgeschlagen: ${e.stderr?.toString().trim()}`);
  }
  log(`übertragen: ${datei} (${(inhalt.length / 1024).toFixed(0)} KB)`);
}

// ── Rendern ─────────────────────────────────────────────────────────────

const stand = [];
let geaendert = false;

for (const instanz of INSTANZEN) {
  const weltPfad = join(WURZEL, 'server/data/welten', `${instanz}.json`);
  if (!existsSync(weltPfad)) {
    log(`${instanz}: keine Weltdatei unter ${weltPfad} — übersprungen`);
    continue;
  }

  const jetzt = fingerabdruck(weltPfad);
  const vorher = gerendert(instanz);

  if (!neu && jetzt === vorher) {
    log(`${instanz}: unverändert (${jetzt}) — nicht neu gerendert`);
  } else {
    log(`${instanz}: Welt geändert (${vorher ?? 'noch nie gerendert'} → ${jetzt}), rendere …`);
    lauf(join(WURZEL, 'node_modules/.bin/tsx'), [
      join(WURZEL, 'tools/weltkarte-rendern.ts'),
      instanz,
      ARBEIT,
      String(BREITE),
    ]);
    geaendert = true;
  }

  const beschreibung = JSON.parse(readFileSync(join(ARBEIT, `${instanz}.json`), 'utf-8'));
  stand.push({
    instanz,
    name: beschreibung.name,
    gerendert: beschreibung.gerendert,
    fingerabdruck: beschreibung.fingerabdruck,
    spanneMeter: beschreibung.spanneMeter,
    regionen: beschreibung.regionen.length,
  });
}

// ── Übersicht schreiben ─────────────────────────────────────────────────

/*
  karten.json ist das, was die Webseite ZUERST holt: Welche Welten gibt es,
  wie heißen sie, wann wurden sie gerendert. Erst danach lädt sie die
  Beschreibung der gewählten Welt. So muss die Seite die Namen der Instanzen
  nicht fest verdrahtet haben.
*/
const uebersicht = {
  erzeugt: new Date().toISOString(),
  welten: stand.map((s) => ({
    ...s,
    // Anzeigenamen der Webseite. Die Instanz heißt technisch dev/live; auf
    // der Seite heißen die Welten seit jeher Midgard und Werkstatt.
    anzeige: s.instanz === 'live' ? 'Midgard' : 'Werkstatt',
    bild: `${s.instanz}.webp`,
    beschreibung: `${s.instanz}.json`,
  })),
};
writeFileSync(join(ARBEIT, 'karten.json'), JSON.stringify(uebersicht, null, 2));

log(`Übersicht: ${stand.map((s) => `${s.instanz}=${s.fingerabdruck}`).join(' ')}`);

// ── Übertragen ──────────────────────────────────────────────────────────

if (nurRendern) {
  log('--nur-rendern: nichts übertragen');
} else if (!geaendert && !neu) {
  // Die Übersicht trotzdem senden: Sie trägt den Zeitpunkt des Laufs und
  // belegt damit auf der Webseite, dass die Karte geprüft wurde.
  senden('karten.json');
  log('nichts Neues zu rendern — nur die Übersicht aufgefrischt');
} else {
  for (const s of stand) {
    senden(`${s.instanz}.webp`);
    senden(`${s.instanz}.json`);
  }
  senden('karten.json');
  log('fertig');
}
