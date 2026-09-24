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
 * Ablage: lokal und atomar. Gerendert wird in ARBEIT (Standard
 * /var/lib/wov-karten), veröffentlicht wird nach ARBEIT/oeffentlich — dorthin
 * zeigt nginx (`location /assets/karten/`, Rückfall auf die Karten im Repo,
 * solange das Verzeichnis leer ist). Jede Datei wird erst als Temp-Datei im
 * selben Verzeichnis geschrieben und dann umbenannt, damit nie eine halbe
 * webp ausgeliefert wird; `karten.json` kommt zuletzt. Ein Rollout, der
 * wov-web/build ersetzt, berührt dieses Verzeichnis nicht.
 *
 * Sicherungen:
 *  - Sperre: `ARBEIT/.sperre` (PID). Läuft schon ein Lauf, endet ein zweiter
 *    mit Meldung und Exit 0; eine Sperre eines toten Prozesses wird übernommen.
 *  - Der Renderer schreibt Bild und Beschreibung über Temp-Dateien, die
 *    Beschreibung (mit Fingerabdruck) zuletzt. Vor dem Ablegen wird jedes
 *    Bild dekodiert und auf Breite 4096 geprüft; scheitert das, wird diese
 *    Instanz einmal neu gerendert, scheitert es erneut, endet der Lauf mit
 *    Exit 1 und die zuletzt veröffentlichten Dateien bleiben stehen.
 *  - Beim Start werden alte `*.tmp` in ARBEIT und AUSGABE gelöscht.
 *  - Fehlt die Weltdatei einer Instanz, werden deren Dateien aus AUSGABE
 *    entfernt (Warnung im Log); dann greift der Rückfall auf die Repo-Karte.
 *  - Bekannte Grenze: Bild und Beschreibung werden nacheinander abgelegt
 *    und vom Browser je bis zu 300 s gecacht; nach einer Weltänderung kann
 *    die Koordinatenanzeige kurz zum alten Bild passen oder umgekehrt.
 *
 * Überschreibbar (für Proben): WOV_KARTEN_ARBEIT, WOV_KARTEN_AUSGABE.
 *
 * Lauf:  node tools/weltkarte-veroeffentlichen.mjs [--neu] [--nur-rendern]
 *   --neu          rendert auch, wenn sich nichts geändert hat
 *   --nur-rendern  veröffentlicht nicht (zum Prüfen auf der Konsole)
 */
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARBEIT = process.env.WOV_KARTEN_ARBEIT || '/var/lib/wov-karten';
const AUSGABE = process.env.WOV_KARTEN_AUSGABE || join(ARBEIT, 'oeffentlich');
const BREITE = 4096;
const INSTANZEN = ['dev', 'live'];

const neu = process.argv.includes('--neu');
const nurRendern = process.argv.includes('--nur-rendern');

const log = (...t) => console.log('[karten]', ...t);

mkdirSync(ARBEIT, { recursive: true });
mkdirSync(AUSGABE, { recursive: true });

// ── Sperre, Aufräumen ───────────────────────────────────────────────────

const SPERRE = join(ARBEIT, '.sperre');

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function sperreNehmen() {
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      writeFileSync(SPERRE, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number.parseInt(readFileSync(SPERRE, 'utf-8'), 10);
      if (Number.isInteger(pid) && lebt(pid)) return false;
      rmSync(SPERRE, { force: true }); // Rest eines toten Laufs
    }
  }
  return false;
}

if (!sperreNehmen()) {
  log(`ein anderer Lauf hält ${SPERRE} — beende mich, ohne etwas zu tun`);
  process.exit(0);
}
const sperreLoesen = () => rmSync(SPERRE, { force: true });
process.on('exit', sperreLoesen);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

/** Reste abgebrochener Läufe (`*.tmp`) löschen; nginx würde sie ausliefern. */
for (const ordner of [ARBEIT, AUSGABE]) {
  for (const n of readdirSync(ordner)) {
    if (n.endsWith('.tmp')) {
      rmSync(join(ordner, n), { force: true });
      log(`Rest gelöscht: ${join(ordner, n)}`);
    }
  }
}

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

/**
 * Eine Datei atomar in AUSGABE ablegen: Temp-Datei im selben Verzeichnis
 * (gleiches Dateisystem, sonst wäre rename nicht atomar), dann umbenennen.
 * Unveränderte Dateien bleiben unberührt.
 */
function ablegen(datei, inhalt = readFileSync(join(ARBEIT, datei))) {
  const ziel = join(AUSGABE, datei);
  if (existsSync(ziel) && readFileSync(ziel).equals(inhalt)) return false;
  const temp = `${ziel}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, inhalt);
    renameSync(temp, ziel);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
  log(`abgelegt: ${datei} (${(inhalt.length / 1024).toFixed(0)} KB)`);
  return true;
}

/** Bild lässt sich vollständig dekodieren und ist BREITE Punkte breit. */
async function bildOk(instanz) {
  const p = join(ARBEIT, `${instanz}.webp`);
  if (!existsSync(p) || !existsSync(join(ARBEIT, `${instanz}.json`))) return false;
  try {
    const { data, info } = await sharp(p, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
    return info.width === BREITE && data.length > 0;
  } catch {
    return false;
  }
}

// ── Rendern ─────────────────────────────────────────────────────────────

const stand = [];
let geaendert = false;

for (const instanz of INSTANZEN) {
  const weltPfad = join(WURZEL, 'server/data/welten', `${instanz}.json`);
  if (!existsSync(weltPfad)) {
    log(`${instanz}: keine Weltdatei unter ${weltPfad} — übersprungen`);
    for (const datei of [`${instanz}.webp`, `${instanz}.json`]) {
      if (existsSync(join(AUSGABE, datei))) {
        rmSync(join(AUSGABE, datei), { force: true });
        log(`WARNUNG: ${datei} aus der Ausgabe entfernt (Welt fehlt, Rückfall auf Repo-Karte)`);
      }
    }
    continue;
  }

  const jetzt = fingerabdruck(weltPfad);
  const vorher = gerendert(instanz);

  const rendern = () => {
    lauf(join(WURZEL, 'node_modules/.bin/tsx'), [
      join(WURZEL, 'tools/weltkarte-rendern.ts'),
      instanz,
      ARBEIT,
      String(BREITE),
    ]);
    geaendert = true;
  };

  let frisch = false;
  if (!neu && jetzt === vorher) {
    log(`${instanz}: unverändert (${jetzt}) — nicht neu gerendert`);
  } else {
    log(`${instanz}: Welt geändert (${vorher ?? 'noch nie gerendert'} → ${jetzt}), rendere …`);
    rendern();
    frisch = true;
  }

  // Das Bild muss sich dekodieren lassen und 4096 Punkte breit sein, bevor es
  // veröffentlicht wird. Sonst: einmal neu rendern, danach abbrechen.
  if (!(await bildOk(instanz))) {
    if (frisch) throw new Error(`${instanz}: frisch gerendertes Bild ist unbrauchbar`);
    log(`${instanz}: Bild unbrauchbar (fehlt, abgeschnitten oder falsche Breite) — rendere neu`);
    rendern();
    if (!(await bildOk(instanz))) throw new Error(`${instanz}: Bild auch nach Neurendern unbrauchbar`);
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
const uebersichtText = JSON.stringify(uebersicht, null, 2);
writeFileSync(join(ARBEIT, 'karten.json'), uebersichtText);

log(`Übersicht: ${stand.map((s) => `${s.instanz}=${s.fingerabdruck}`).join(' ')}`);

// ── Ablegen ─────────────────────────────────────────────────────────────

if (nurRendern) {
  log('--nur-rendern: nichts abgelegt');
} else {
  // Bilder und Beschreibungen zuerst, die Übersicht zuletzt: Sie verweist auf
  // die anderen Dateien und darf nie vor ihnen sichtbar sein.
  for (const s of stand) {
    ablegen(`${s.instanz}.webp`);
    ablegen(`${s.instanz}.json`);
  }
  // Die Übersicht trägt den Zeitpunkt des Laufs und belegt auf der Webseite,
  // dass die Karte geprüft wurde — sie wird deshalb bei jedem Lauf neu
  // geschrieben, auch wenn nichts gerendert wurde.
  ablegen('karten.json', Buffer.from(uebersichtText));
  log(geaendert || neu ? 'fertig' : 'nichts Neues zu rendern — nur die Übersicht aufgefrischt');
}
