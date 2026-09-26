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
 *  - Sperre: Datei in /run/wov-karten (WOV_KARTEN_SPERRE), gehalten nur bei
 *    lebender PID mit diesem Skript in der Kommandozeile. Läuft schon ein
 *    Lauf, endet ein zweiter mit Meldung und Status 75 (systemd zeigt es);
 *    eine Sperre eines toten oder fremden Prozesses wird übernommen.
 *  - Der Renderer schreibt Bild und Beschreibung über Temp-Dateien, die
 *    Beschreibung (mit Fingerabdruck) zuletzt. Vor dem Ablegen wird jedes
 *    Bild dekodiert und auf die Breite WOV_KARTEN_BREITE (Vorgabe 4096)
 *    geprüft; scheitert das, wird diese Instanz einmal neu gerendert,
 *    scheitert es erneut, gilt diese Welt als ausgefallen: Ihre zuletzt
 *    veröffentlichten Dateien bleiben stehen (und in karten.json), die
 *    anderen Welten werden trotzdem veröffentlicht, und der Lauf endet am
 *    Schluss mit Exit 1, damit der Timer den Fehler zeigt.
 *  - Beim Start werden alte `*.tmp` in ARBEIT und AUSGABE gelöscht.
 *  - Fehlt die Weltdatei einer Instanz, warnt der erste Lauf nur (Dateien und
 *    karten.json-Eintrag bleiben). Erst beim zweiten Lauf in Folge ohne
 *    Weltdatei werden deren Dateien aus AUSGABE entfernt (Warnung im Log);
 *    dann greift der Rückfall auf die Repo-Karte. Zähler: ARBEIT/<instanz>.fehlt.
 *  - Bekannte Grenze: Bild und Beschreibung werden nacheinander abgelegt
 *    und vom Browser je bis zu 300 s gecacht; nach einer Weltänderung kann
 *    die Koordinatenanzeige kurz zum alten Bild passen oder umgekehrt.
 *
 * WOV_KARTEN_BREITE: Bildbreite in Punkten, ganze Zahl von 256 bis 8192
 * (Vorgabe 4096); alles andere beendet den Lauf sofort mit Exit 1.
 *
 * Überschreibbar (für Proben): WOV_KARTEN_ARBEIT, WOV_KARTEN_AUSGABE und
 * WOV_KARTEN_SPERRE (Standard /run/wov-karten/sperre). ALLE DREI setzen: Fehlt
 * die dritte, nimmt die Probe die echte Sperre des Dienstes.
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
  linkSync,
  statSync,
} from 'node:fs';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARBEIT = process.env.WOV_KARTEN_ARBEIT || '/var/lib/wov-karten';
const AUSGABE = process.env.WOV_KARTEN_AUSGABE || join(ARBEIT, 'oeffentlich');
const BREITE_MIN = 256;
const BREITE_MAX = 8192;
const INSTANZEN = ['dev', 'live'];

/**
 * Bildbreite aus WOV_KARTEN_BREITE (Vorgabe 4096). Nur ganze Zahlen von 256 bis
 * 8192; alles andere ist ein Fehler und beendet den Lauf, bevor etwas
 * angefasst wird (Exit 1). Die Breite in Punkten ist zugleich die Höhe; ein
 * Bild braucht Breite² × 3 Byte Rohdaten, bei 8192 also rund 200 MB je Ebene.
 */
function breiteLesen(text) {
  if (text === undefined || text === '') return 4096;
  const zahl = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(zahl) || zahl < BREITE_MIN || zahl > BREITE_MAX) {
    console.error(
      `[karten] WOV_KARTEN_BREITE="${text}" ist ungültig — erlaubt sind ganze Zahlen von ${BREITE_MIN} bis ${BREITE_MAX}`,
    );
    process.exit(1);
  }
  return zahl;
}
const BREITE = breiteLesen(process.env.WOV_KARTEN_BREITE);

const neu = process.argv.includes('--neu');
const nurRendern = process.argv.includes('--nur-rendern');

const log = (...t) => console.log('[karten]', ...t);

mkdirSync(ARBEIT, { recursive: true });
mkdirSync(AUSGABE, { recursive: true });

// ── Sperre, Aufräumen ───────────────────────────────────────────────────

/*
  Die Sperre liegt in /run (tmpfs, beim Boot leer; RuntimeDirectory der Unit),
  nicht im StateDirectory: Eine nach Absturz oder Stromausfall übrig gebliebene
  Sperre kann so keinen späteren Neustart überleben. Zusätzlich gilt sie nur
  als gehalten, wenn ihre PID lebt UND die Kommandozeile dieses Skript nennt
  (eine wiederverwendete PID eines fremden Prozesses zählt nicht).
  Gesetzt wird sie mit link() einer fertig geschriebenen Datei: atomar, nie
  eine leere oder halbe Sperre sichtbar. Die Übernahme einer toten Sperre
  läuft unter einer zweiten Kurzsperre (`.uebernahme`), damit zwei Läufe nie
  gleichzeitig „tot“ sehen und beide setzen.
*/
const SPERRE = process.env.WOV_KARTEN_SPERRE || '/run/wov-karten/sperre';
const EXIT_BELEGT = 75;
mkdirSync(dirname(SPERRE), { recursive: true });

function haelt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf-8').includes('weltkarte-veroeffentlichen');
  } catch {
    return false; // Prozess weg (oder nicht lesbar): kein Halter
  }
}

/** Inhalt der Sperre als Text; null, wenn sie fehlt. */
function sperreLesen() {
  try {
    return readFileSync(SPERRE, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Datei mit Inhalt fertig schreiben und mit link() atomar unter `ziel` sichtbar machen. */
function linkSetzen(ziel, inhalt) {
  const temp = `${ziel}.${process.pid}.neu`;
  writeFileSync(temp, inhalt);
  try {
    linkSync(temp, ziel);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  } finally {
    rmSync(temp, { force: true });
  }
}

function sperreNehmen() {
  for (let versuch = 0; versuch < 20; versuch++) {
    if (linkSetzen(SPERRE, String(process.pid))) return true;
    const text = sperreLesen();
    if (text === null) continue; // zwischendurch gelöst: nochmal
    if (haelt(Number.parseInt(text, 10))) return false;
    // Tote Sperre: nur unter der Übernahme-Kurzsperre übernehmen.
    const uebernahme = `${SPERRE}.uebernahme`;
    if (!linkSetzen(uebernahme, String(process.pid))) {
      // Ein anderer übernimmt gerade; ist die Kurzsperre selbst alt (>10 s), war sie ein Rest.
      try {
        if (Date.now() - statSync(uebernahme).mtimeMs > 10_000) rmSync(uebernahme, { force: true });
      } catch {
        /* weg: nochmal versuchen */
      }
      continue;
    }
    try {
      if (sperreLesen() === text) rmSync(SPERRE, { force: true });
    } finally {
      rmSync(uebernahme, { force: true });
    }
  }
  return false;
}

if (!sperreNehmen()) {
  log(`ein anderer Lauf hält ${SPERRE} — beende mich mit Status ${EXIT_BELEGT}, ohne etwas zu tun`);
  process.exit(EXIT_BELEGT);
}
const sperreLoesen = () => rmSync(SPERRE, { force: true });
process.on('exit', sperreLoesen);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

/** Reste abgebrochener Läufe (`*.tmp`) löschen; nginx würde sie ausliefern. */
// --nur-rendern veröffentlicht nichts und rührt AUSGABE deshalb nicht an.
for (const ordner of nurRendern ? [ARBEIT] : [ARBEIT, AUSGABE]) {
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

/** Bild lässt sich vollständig dekodieren und ist BREITE Punkte breit (WOV_KARTEN_BREITE). */
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

// ── Karenz für fehlende Weltdateien ─────────────────────────────────────

/*
  Fehlt eine Weltdatei (etwa während eines Checkouts oder wegen eines
  Tippfehlers), soll ein einzelner Lauf nicht sofort die öffentliche Karte
  löschen. Der Zähler `<instanz>.fehlt` in ARBEIT zählt die Läufe in Folge
  ohne Weltdatei. Erst der zweite entfernt die öffentlichen Dateien; der erste
  warnt nur und lässt die Welt in karten.json stehen. Ist die Weltdatei wieder
  da, wird der Zähler gelöscht. --nur-rendern zählt nicht (es veröffentlicht
  nichts). Nach dem Entfernen bleibt der Zähler stehen, damit er nicht wieder
  bei 1 anfängt.
*/
const KARENZ_LAEUFE = 2;
const zaehlerPfad = (instanz) => join(ARBEIT, `${instanz}.fehlt`);

function fehltZaehlen(instanz) {
  let n = 0;
  try {
    n = Number.parseInt(readFileSync(zaehlerPfad(instanz), 'utf-8'), 10);
  } catch {
    /* kein Zähler: erster Lauf */
  }
  n = (Number.isInteger(n) && n > 0 ? n : 0) + 1;
  const temp = `${zaehlerPfad(instanz)}.${process.pid}.tmp`;
  writeFileSync(temp, String(n));
  renameSync(temp, zaehlerPfad(instanz));
  return n;
}

/** Beschreibung der bisher öffentlichen Karte einer Instanz, oder null. */
function veroeffentlicht(instanz) {
  try {
    return JSON.parse(readFileSync(join(AUSGABE, `${instanz}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

function standVon(instanz, beschreibung) {
  return {
    instanz,
    name: beschreibung.name,
    gerendert: beschreibung.gerendert,
    fingerabdruck: beschreibung.fingerabdruck,
    spanneMeter: beschreibung.spanneMeter,
    regionen: beschreibung.regionen.length,
  };
}

// ── Rendern ─────────────────────────────────────────────────────────────

/*
  Jede Welt für sich: Scheitert Rendern oder Prüfung einer Welt, wird sie
  vermerkt, und die anderen laufen weiter. Die gescheiterte Welt behält ihre
  bisher öffentlichen Dateien und steht mit deren Beschreibung in karten.json
  (nur mit `ablegen: false`, damit sie nicht überschrieben wird). Am Ende
  endet der Lauf mit Exit 1, damit der Timer den Fehler zeigt.
*/
const stand = [];
const ausfaelle = [];
let geaendert = false;

async function weltVerarbeiten(instanz) {
  const weltPfad = join(WURZEL, 'server/data/welten', `${instanz}.json`);
  if (!existsSync(weltPfad)) {
    log(`${instanz}: keine Weltdatei unter ${weltPfad} — übersprungen`);
    if (nurRendern) return;
    const n = fehltZaehlen(instanz);
    if (n < KARENZ_LAEUFE) {
      log(
        `WARNUNG: ${instanz}: Weltdatei fehlt (Lauf ${n} von ${KARENZ_LAEUFE} in Folge) — öffentliche Dateien bleiben; beim nächsten Lauf ohne Weltdatei werden sie entfernt`,
      );
      const alt = veroeffentlicht(instanz);
      if (alt) stand.push({ ...standVon(instanz, alt), ablegen: false });
      return;
    }
    for (const datei of [`${instanz}.webp`, `${instanz}.json`]) {
      if (existsSync(join(AUSGABE, datei))) {
        rmSync(join(AUSGABE, datei), { force: true });
        log(`WARNUNG: ${datei} aus der Ausgabe entfernt (Welt fehlt seit ${n} Läufen, Rückfall auf Repo-Karte)`);
      }
    }
    return;
  }
  if (!nurRendern) rmSync(zaehlerPfad(instanz), { force: true });

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

  // Das Bild muss sich dekodieren lassen und BREITE Punkte breit sein, bevor es
  // veröffentlicht wird. Sonst: einmal neu rendern, danach abbrechen.
  if (!(await bildOk(instanz))) {
    if (frisch) throw new Error(`${instanz}: frisch gerendertes Bild ist unbrauchbar`);
    log(`${instanz}: Bild unbrauchbar (fehlt, abgeschnitten oder falsche Breite) — rendere neu`);
    rendern();
    if (!(await bildOk(instanz))) throw new Error(`${instanz}: Bild auch nach Neurendern unbrauchbar`);
  }

  const beschreibung = JSON.parse(readFileSync(join(ARBEIT, `${instanz}.json`), 'utf-8'));
  stand.push({ ...standVon(instanz, beschreibung), ablegen: true });
}

for (const instanz of INSTANZEN) {
  try {
    await weltVerarbeiten(instanz);
  } catch (e) {
    ausfaelle.push(instanz);
    log(`FEHLER: ${instanz}: ${e.message} — die bisher öffentliche Karte bleibt stehen`);
    const alt = nurRendern ? null : veroeffentlicht(instanz);
    if (alt) stand.push({ ...standVon(instanz, alt), ablegen: false });
  }
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
  welten: stand.map(({ ablegen, ...s }) => ({
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
    if (!s.ablegen) continue; // bleibt, wie veröffentlicht
    try {
      ablegen(`${s.instanz}.webp`);
      ablegen(`${s.instanz}.json`);
    } catch (e) {
      ausfaelle.push(s.instanz);
      log(`FEHLER: ${s.instanz}: Ablegen scheiterte: ${e.message}`);
    }
  }
  // Die Übersicht trägt den Zeitpunkt des Laufs und belegt auf der Webseite,
  // dass die Karte geprüft wurde — sie wird deshalb bei jedem Lauf neu
  // geschrieben, auch wenn nichts gerendert wurde.
  ablegen('karten.json', Buffer.from(uebersichtText));
  log(geaendert || neu ? 'fertig' : 'nichts Neues zu rendern — nur die Übersicht aufgefrischt');
}

if (ausfaelle.length > 0) {
  log(`Ausfall: ${[...new Set(ausfaelle)].join(', ')} — Exit 1; die übrigen Welten sind veröffentlicht`);
  process.exit(1);
}
