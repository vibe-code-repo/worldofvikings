#!/usr/bin/env node
/**
 * Größenwächter: keine neue Datei über 1.500 Zeilen, die großen Altdateien wachsen nicht weiter.
 *
 * I1 Schritt 0 (R0.2 Teil B). 18 Dateien unter `<paket>/src` haben mehr als 1.500 Zeilen; nur
 * `client/src/main.ts` hat einen Wächter, verstreut in drei Feature-Tests. Dieser Zeuge schreibt den
 * heutigen Stand fest, ohne laufende Arbeit zu behindern: die Obergrenzen haben 10 % Spielraum.
 *
 * Gezählt wird wie `wc -l` (Zeilenumbrüche) in allen `.ts`-Dateien unter `client/src`, `server/src`,
 * `shared/src` und `admin/src`. Die Obergrenzen stehen in `scripts/groessen-grenzen.json`
 * (ein Eintrag je Zeile, nach Pfad sortiert: zwei Pull Requests an verschiedenen Dateien ändern
 * verschiedene Zeilen).
 *
 *   B1  Eine Datei, die NICHT in der Liste steht, hat höchstens 1.500 Zeilen.
 *   B2  Eine Datei der Liste hat höchstens ihre Obergrenze.
 *   B3  Die Obergrenze ist höchstens die aktuelle Zeilenzahl plus 10 %, aufgerundet auf 50. Schrumpft
 *       die Datei, muss die Obergrenze im selben Pull Request mit herunter; der Prüfer nennt die Zahl.
 *   B4  Fällt eine Datei der Liste auf 1.500 Zeilen oder darunter, muss sie aus der Liste. Eine
 *       Datei der Liste, die es nicht mehr gibt, ebenso.
 *   B5  Der Eintrag "frei" statt einer Zahl schaltet B2 und B3 für diese Datei ab. Er ist nur für die
 *       sechs großen Dateien erlaubt (FREI_ERLAUBT), bis ihr erster Schnittschritt gemergt ist. Dieser
 *       Schritt setzt die Zahl. Wird ein Schnittschritt VOR dem Wächter gemergt, bleibt der Eintrag
 *       "frei", bis der NÄCHSTE Schritt an dieser Datei die Zahl setzt.
 *
 * `client/src/main.ts` bleibt "frei": dort sind die Zeilenwächter in `client/test` zuständig (Grenze
 * 3.700); Game senkt sie erst nach einem echten Schnitt.
 *
 * Damit der Zeuge nicht selbst „immer grün" sein kann, baut er zuerst in einem Wegwerfordner einen
 * Mini-Baum und probt jede Regel in jede Richtung (Muster `pruefe-runner-liste.mjs`).
 *
 * Aufruf:  node scripts/pruefe-groessen.mjs [--wurzel=<ordner>]
 * Exit 0 = grün, 1 = Befund. Läuft unter einer Sekunde, braucht kein assets/.
 *
 * File size guard: no new file above 1,500 lines; the large old files may not grow beyond a cap
 * (line count + 10 %, rounded up to 50). Caps live in scripts/groessen-grenzen.json.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ORDNER = ['client/src', 'server/src', 'shared/src', 'admin/src'];
const GRENZE = 1500;
const GRENZEN_DATEI = 'scripts/groessen-grenzen.json';

/** Nur diese Dateien dürfen "frei" stehen (B5): die sechs, die I1 und die Pläne A/C/E/G/N zerlegen. */
const FREI_ERLAUBT = new Set([
  'server/src/WovServer.ts',
  'client/src/editor/editorMain.ts',
  'client/src/entities/EntityManager.ts',
  'client/src/editor/GegenstandsKatalog.ts',
  'client/src/main.ts',
  'admin/src/main.ts',
]);

/** Knapp unter der Grenze: Wächst eine davon über 1.500, wird der Pull Request rot. Nur eine Auskunft. */
const HINWEIS_AB = 1400;

const rundeAuf50 = (n) => Math.ceil(n / 50) * 50;
/** B3: höchste zulässige Obergrenze bei `zeilen` Zeilen. */
export const hoechsteObergrenze = (zeilen) => rundeAuf50(Math.ceil(zeilen * 1.1));

function zaehleZeilen(pfad) {
  const daten = readFileSync(pfad);
  let n = 0;
  for (let i = 0; i < daten.length; i++) if (daten[i] === 0x0a) n++;
  return n;
}

function sammle(wurzel) {
  const aus = new Map();
  const geh = (verz) => {
    let namen;
    try {
      namen = readdirSync(verz);
    } catch {
      return;
    }
    for (const e of namen) {
      if (e === 'node_modules' || e === 'build' || e === 'dist' || e.startsWith('.')) continue;
      const p = join(verz, e);
      const st = statSync(p);
      if (st.isDirectory()) geh(p);
      else if (e.endsWith('.ts')) aus.set(relative(wurzel, p).split(sep).join('/'), zaehleZeilen(p));
    }
  };
  for (const o of ORDNER) geh(join(wurzel, o));
  return aus;
}

/**
 * Prüft einen Baum. Gibt { befunde: string[], hinweise: string[], zahlen } zurück.
 * `text` ist der Inhalt der Grenzdatei (für die Formprüfung), `grenzen` das geparste Objekt.
 */
export function pruefe(wurzel) {
  const befunde = [];
  const hinweise = [];
  const dateien = sammle(wurzel);
  let text;
  try {
    text = readFileSync(join(wurzel, GRENZEN_DATEI), 'utf8');
  } catch {
    return { befunde: [`${GRENZEN_DATEI} fehlt`], hinweise, zahlen: { dateien: dateien.size, liste: 0 } };
  }
  let grenzen;
  try {
    grenzen = JSON.parse(text);
  } catch (e) {
    return { befunde: [`${GRENZEN_DATEI} ist kein gültiges JSON: ${e.message}`], hinweise, zahlen: { dateien: dateien.size, liste: 0 } };
  }
  if (grenzen === null || typeof grenzen !== 'object' || Array.isArray(grenzen)) {
    return { befunde: [`${GRENZEN_DATEI} muss ein Objekt {pfad: zahl|"frei"} sein`], hinweise, zahlen: { dateien: dateien.size, liste: 0 } };
  }

  // Form: sortiert, ein Eintrag je Zeile, keine doppelten Schlüssel (JSON.parse würde sie still schlucken)
  const zeilenSchluessel = [...text.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
  if (zeilenSchluessel.length !== Object.keys(grenzen).length) {
    befunde.push(`${GRENZEN_DATEI}: ${zeilenSchluessel.length} Zeilen mit Schlüssel, aber ${Object.keys(grenzen).length} Einträge (doppelter Schlüssel oder mehrere Einträge in einer Zeile)`);
  }
  const sortiert = [...zeilenSchluessel].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sortiert.some((k, i) => k !== zeilenSchluessel[i])) {
    const i = zeilenSchluessel.findIndex((k, j) => k !== sortiert[j]);
    befunde.push(`${GRENZEN_DATEI} ist nicht nach Pfad sortiert (erste Abweichung: "${zeilenSchluessel[i]}", erwartet "${sortiert[i]}")`);
  }

  for (const [pfad, wert] of Object.entries(grenzen)) {
    const zeilen = dateien.get(pfad);
    if (zeilen === undefined) {
      befunde.push(`B4 ${pfad}: steht in der Liste, die Datei gibt es nicht (mehr) unter ${ORDNER.join(', ')}. Eintrag entfernen.`);
      continue;
    }
    if (wert === 'frei') {
      if (!FREI_ERLAUBT.has(pfad)) befunde.push(`B5 ${pfad}: "frei" ist nur für die sechs großen Dateien erlaubt. Eine Zahl eintragen: höchstens ${hoechsteObergrenze(zeilen)}.`);
      else if (zeilen <= GRENZE) befunde.push(`B4 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}). Eintrag entfernen.`);
      continue;
    }
    if (!Number.isInteger(wert) || wert <= 0) {
      befunde.push(`${pfad}: Wert ${JSON.stringify(wert)} ist weder eine positive ganze Zahl noch "frei"`);
      continue;
    }
    if (zeilen <= GRENZE) {
      befunde.push(`B4 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}), steht aber mit ${wert} in der Liste. Eintrag entfernen.`);
      continue;
    }
    if (zeilen > wert) befunde.push(`B2 ${pfad}: hat ${zeilen} Zeilen, Obergrenze ${wert}. Die Datei ist über ihre Obergrenze gewachsen.`);
    const hoechst = hoechsteObergrenze(zeilen);
    if (wert > hoechst) befunde.push(`B3 ${pfad}: Obergrenze ${wert} ist zu hoch für ${zeilen} Zeilen (höchstens ${hoechst}). Auf ${hoechst} senken.`);
  }

  for (const [pfad, zeilen] of dateien) {
    if (Object.hasOwn(grenzen, pfad)) continue;
    if (zeilen > GRENZE) befunde.push(`B1 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}) und steht nicht in ${GRENZEN_DATEI}. Aufteilen; die Liste wächst nicht.`);
    else if (zeilen >= HINWEIS_AB) hinweise.push(`${pfad}: ${zeilen} Zeilen, knapp unter der Grenze von ${GRENZE}`);
  }
  return { befunde, hinweise, zahlen: { dateien: dateien.size, liste: Object.keys(grenzen).length } };
}

// ── Selbstprobe an einem Wegwerf-Baum ────────────────────────────────────────────────────────

function baue(wurzel, dateien, grenzenText) {
  for (const [pfad, zeilen] of Object.entries(dateien)) {
    const p = join(wurzel, pfad);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'x\n'.repeat(zeilen));
  }
  mkdirSync(join(wurzel, 'scripts'), { recursive: true });
  writeFileSync(join(wurzel, GRENZEN_DATEI), grenzenText);
}

const json = (o) => `{\n${Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;

/** Wirft, wenn eine Regel in eine der beiden Richtungen nicht greift. */
export function selbstprobe() {
  const tmp = mkdtempSync(join(tmpdir(), 'pruefe-groessen-'));
  let n = 0;
  const fall = (name, dateien, grenzen, erwartet /* Regelkennungen oder [] */, roh) => {
    const w = join(tmp, `f${n++}`);
    baue(w, dateien, roh ?? json(grenzen));
    const { befunde } = pruefe(w);
    const ist = befunde.map((b) => /^(B\d)/.exec(b)?.[1] ?? 'FORM').sort().join(',');
    const soll = [...erwartet].sort().join(',');
    if (ist !== soll) throw new Error(`Selbstprobe "${name}": erwartet [${soll}], bekam [${ist}]\n  ${befunde.join('\n  ')}`);
  };
  try {
    const gross = 'server/src/WovServer.ts';
    fall('leerer Baum ist grün', { 'client/src/a.ts': 10 }, {}, []);
    fall('Datei mit genau 1.500 Zeilen ist grün', { 'client/src/a.ts': 1500 }, {}, []);
    fall('B1: neue Datei mit 1.501 Zeilen', { 'client/src/a.ts': 1501 }, {}, ['B1']);
    fall('B1: gilt in jedem der vier Ordner', { 'admin/src/a.ts': 1501, 'shared/src/b.ts': 1501, 'server/src/c.ts': 1501 }, {}, ['B1', 'B1', 'B1']);
    fall('Dateien außerhalb der vier Ordner zählen nicht', { 'wov-web/src/a.ts': 1800, 'client/test/b.ts': 1800 }, {}, []);
    fall('Datei der Liste innerhalb der Grenze ist grün', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2200 }, []);
    fall('B2: Datei über ihrer Obergrenze', { 'client/src/a.ts': 2251 }, { 'client/src/a.ts': 2250 }, ['B2']);
    fall('B3: Obergrenze um 500 zu hoch', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2700 }, ['B3']);
    fall('B3: genau die höchste Obergrenze ist grün (2000 → 2200)', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2200 }, []);
    fall('B3: eine Stufe darüber ist rot (2000 → 2250)', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2250 }, ['B3']);
    fall('B3: geschrumpfte Datei zwingt die Obergrenze herunter', { 'client/src/a.ts': 1600 }, { 'client/src/a.ts': 2200 }, ['B3']);
    fall('B4: Eintrag für eine Datei mit 1.400 Zeilen', { 'client/src/a.ts': 1400 }, { 'client/src/a.ts': 1500 }, ['B4']);
    fall('B4: Eintrag für eine Datei mit genau 1.500 Zeilen', { 'client/src/a.ts': 1500 }, { 'client/src/a.ts': 1650 }, ['B4']);
    fall('B4: Eintrag für eine Datei, die es nicht gibt', { 'client/src/a.ts': 10 }, { 'client/src/weg.ts': 1800 }, ['B4']);
    fall('B5: "frei" schaltet B2/B3 ab (6.703 Zeilen)', { [gross]: 6703 }, { [gross]: 'frei' }, []);
    fall('B5: "frei" auf einer nicht erlaubten Datei ist ein Befund', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 'frei' }, ['B5']);
    fall('B4: "frei" für eine Datei unter der Grenze', { [gross]: 900 }, { [gross]: 'frei' }, ['B4']);
    fall('Wert ist weder Zahl noch "frei"', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 'hoch' }, ['FORM']);
    fall('Form: Liste nicht sortiert', { 'client/src/a.ts': 2000, 'client/src/b.ts': 2000 }, {}, ['FORM'], '{\n  "client/src/b.ts": 2200,\n  "client/src/a.ts": 2200\n}\n');
    fall('Form: doppelter Schlüssel', { 'client/src/a.ts': 2000 }, {}, ['FORM'], '{\n  "client/src/a.ts": 2200,\n  "client/src/a.ts": 2200\n}\n');
    fall('Form: kein JSON', { 'client/src/a.ts': 10 }, {}, ['FORM'], '{ nope');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Grenzdatei fehlt: eigener kleiner Fall, weil `baue` immer schreibt. */
function selbstprobeFehlendeDatei() {
  const tmp = mkdtempSync(join(tmpdir(), 'pruefe-groessen-'));
  try {
    mkdirSync(join(tmp, 'client/src'), { recursive: true });
    writeFileSync(join(tmp, 'client/src/a.ts'), 'x\n');
    const { befunde } = pruefe(tmp);
    if (befunde.length !== 1 || !befunde[0].includes('fehlt')) throw new Error(`Selbstprobe "Grenzdatei fehlt": ${befunde.join(' | ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Aufruf ───────────────────────────────────────────────────────────────────────────────────

function haupt(argv) {
  const wurzelArg = argv.find((a) => a.startsWith('--wurzel='));
  const wurzel = wurzelArg ? resolve(wurzelArg.slice('--wurzel='.length)) : resolve(HIER, '..');
  try {
    selbstprobe();
    selbstprobeFehlendeDatei();
  } catch (e) {
    console.error(`pruefe-groessen: Selbstprobe ROT — der Prüfer würde etwas übersehen.\n${e.message}`);
    return 1;
  }
  const { befunde, hinweise, zahlen } = pruefe(wurzel);
  for (const h of hinweise) console.log(`Hinweis: ${h}`);
  if (befunde.length === 0) {
    console.log(`pruefe-groessen: grün (${zahlen.dateien} Dateien gezählt, ${zahlen.liste} Einträge in ${GRENZEN_DATEI}, Selbstprobe grün).`);
    return 0;
  }
  console.error(`pruefe-groessen: ${befunde.length} Befund(e):\n${befunde.map((b) => `  - ${b}`).join('\n')}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(haupt(process.argv.slice(2)));
