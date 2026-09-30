#!/usr/bin/env node
/**
 * Größenwächter mit Gedächtnis: keine neue Datei über 1.500 Zeilen, die großen Altdateien wachsen nicht weiter,
 * und die Liste selbst kann in einem PR nur schrumpfen.
 *
 * I1 Schritt 0 (R0.2 Teil B) und N1 (Angriff auf #155, M5/M6). 18 Dateien unter `<paket>/src` haben mehr als
 * 1.500 Zeilen. Dieser Zeuge schreibt den heutigen Stand fest, ohne laufende Arbeit zu behindern: die Obergrenzen
 * haben 10 % Spielraum, die sechs großen Dateien (die I1 und die Pläne A/C/E/G/N zerlegen) einen Deckel nach oben.
 *
 * Gezählt wird wie `wc -l` (Zeilenumbrüche; ein einzelnes CR zählt auch) in allen `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` unter
 * `client/src`, `server/src`, `shared/src` und `admin/src` (nur `node_modules` und `.git` fallen weg; ein kaputter
 * Symlink wird als Hinweis übersprungen). Die Grenzen stehen in `scripts/groessen-grenzen.json`, ein Eintrag je Zeile,
 * nach Pfad sortiert (zwei Pull Requests an verschiedenen Dateien ändern verschiedene Zeilen). Ein Eintrag ist
 *   - eine Zahl:                        Obergrenze,
 *   - { "grenze": Zahl, "grund": "…" }: Obergrenze mit Begründung für eine Erhöhung (siehe M5),
 *   - { "frei": true, "hoechstens": Zahl }: Deckel nach oben für die sechs großen Dateien, bis ihr erster Schnittschritt
 *     die echte Zahl setzt (auch mit "grund").
 *
 *   B1  Eine Datei, die NICHT in der Liste steht, hat höchstens 1.500 Zeilen.
 *   B2  Eine Datei der Liste hat höchstens ihre Obergrenze (bei `frei`: ihren Deckel).
 *   B3  Eine Obergrenze ist höchstens die aktuelle Zeilenzahl plus 10 %, aufgerundet auf 50. Schrumpft die Datei, muss
 *       die Obergrenze im selben PR mit herunter; der Prüfer nennt die Zahl. Für `frei` gilt B3 nicht: Schrumpfen ist
 *       immer erlaubt.
 *   B4  Fällt eine Datei der Liste auf 1.500 Zeilen oder darunter, muss sie aus der Liste. Eine Datei der Liste, die es
 *       nicht mehr gibt, ebenso.
 *   B5  `frei` (Deckel) ist nur für die sechs großen Dateien erlaubt (FREI_ERLAUBT). Wird ein Schnittschritt VOR dem
 *       Wächter gemergt, bleibt der Eintrag `frei`, bis der NÄCHSTE Schritt an dieser Datei die Zahl setzt.
 *   M5  Gedächtnis. Verglichen wird mit der Basis des PR (`git merge-base HEAD origin/main`; Umgebungsvariable
 *       WOV_GROESSEN_BASIS = beliebige Git-Referenz überschreibt; in der CI zählt GITHUB_BASE_REF, dann wird die Basis
 *       mit `git fetch --depth=1` geholt). Im PR darf
 *         - eine Obergrenze nur SINKEN (Erhöhung nur mit "grund"; er wird laut gemeldet und gehört in den PR-Text),
 *         - ein Deckel nur sinken (ebenso), `frei` nicht wieder zur Zahl über dem Deckel und keine Zahl zu `frei` werden,
 *         - ein NEUER Eintrag nur für eine Datei entstehen, die auf der Basis schon über 1.500 Zeilen hatte. Eine
 *           Umbenennung ohne Eintrag ist rot (B1); mit Eintrag unter dem neuen Namen nur mit "grund" ("umbenannt von …"),
 *           der laut gemeldet wird.
 *       Ohne Git bzw. ohne Basis läuft der Wächter wie bisher und sagt das.
 *
 * M5 (N2): In der CI zeigt der Runner die Ausgabe erfolgreicher Tests nicht. Deshalb meldet der Wächter seine Kennzeilen (Basis-Commit,
 * mit/ohne Basis, jede Begründung) zusätzlich in die Job-Zusammenfassung (GITHUB_STEP_SUMMARY) und als `::notice::`/`::warning::` auf den
 * stderr des Runners. Bei `pull_request` in der CI ist „ohne Basis“ ein Befund (rot); bei `push` und lokal ohne Git nur ein lauter Hinweis.
 * M6 (N2): Ein "grund" braucht mindestens 10 sichtbare Zeichen (kein Leerraum, keine Unicode-Klassen Cf/Zs/Cc, kein reiner Punkt).
 *
 * `client/src/main.ts` trägt einen Deckel von 3.700; dort sind zusätzlich die Zeilenwächter in `client/test` zuständig.
 *
 * Damit der Zeuge nicht selbst „immer grün" sein kann, baut er zuerst in einem Wegwerfordner einen Mini-Baum (mit einem
 * kleinen Git-Verlauf, wo Git da ist) und probt jede Regel in jede Richtung (Muster `pruefe-runner-liste.mjs`).
 *
 * Aufruf:  node scripts/pruefe-groessen.mjs [--wurzel=<ordner>] [--basis=<git-ref>]
 * Exit 0 = grün, 1 = Befund, 2 = Aufruf falsch. Läuft unter einer Sekunde (ohne Git-Abfrage), braucht kein assets/.
 *
 * Grenzen (dokumentiert, N6/N7): eine Datei ohne Zeilenumbruch am Ende zählt wie `wc -l` (die letzte Zeile fehlt), eine
 * Zeile mit 1 MB Code zählt 1, und Quellordner neben `src` (etwa `server/spiel/`) sind nicht bewacht.
 *
 * File size guard with memory: no new file above 1,500 lines; large old files may not outgrow their cap (lines + 10 %,
 * rounded up to 50) or ceiling; caps and entries only shrink in a pull request unless a "grund" says why.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, openSync, writeSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const ORDNER = ['client/src', 'server/src', 'shared/src', 'admin/src'];
const ENDUNG = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const GRENZE = 1500;
const GRENZEN_DATEI = 'scripts/groessen-grenzen.json';

/** Nur diese Dateien dürfen `frei` (mit Deckel) stehen (B5): die sechs, die I1 und die Pläne A/C/E/G/N zerlegen. */
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

/** Zeilen wie `wc -l` (Zeilenumbrüche `\n`), dazu ein einzelnes `\r` (alte Mac-Umbrüche) als eigene Zeile; `\r\n` zählt einmal. */
function zaehleBytes(daten) {
  let n = 0;
  for (let i = 0; i < daten.length; i++) {
    if (daten[i] === 0x0a) n++;
    else if (daten[i] === 0x0d && daten[i + 1] !== 0x0a) n++;
  }
  return n;
}
const zaehleZeilen = (pfad) => zaehleBytes(readFileSync(pfad));
const zaehleText = (text) => zaehleBytes(Buffer.from(text));

function sammle(wurzel, hinweise) {
  const aus = new Map();
  const geh = (verz) => {
    let namen;
    try {
      namen = readdirSync(verz);
    } catch {
      return;
    }
    for (const e of namen) {
      if (e === 'node_modules' || e === '.git') continue;
      const p = join(verz, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        hinweise.push(`${relative(wurzel, p).split(sep).join('/')}: nicht lesbar (kaputter Symlink?), übersprungen`);
        continue;
      }
      if (st.isDirectory()) geh(p);
      else if (ENDUNG.test(e)) aus.set(relative(wurzel, p).split(sep).join('/'), zaehleZeilen(p));
    }
  };
  for (const o of ORDNER) geh(join(wurzel, o));
  return aus;
}

/**
 * H1 (N3): Git-Aufrufe laufen mit gesäuberter Umgebung. Ein pre-commit-Hook in einem verknüpften Arbeitsbaum setzt GIT_DIR und
 * GIT_INDEX_FILE; erbt ein Kindprozess sie, gelten sie VOR `cwd`, und die Selbstprobe schriebe ins echte Repo. Deshalb: alle `GIT_*`
 * entfernt, optional GIT_CEILING_DIRECTORIES gesetzt (Git steigt dann nicht über diesen Ordner hinaus), und ein ausdrückliches `-C`.
 */
export function gitUmgebung(ceiling, quelle = process.env) {
  const e = {};
  for (const [k, v] of Object.entries(quelle)) if (!k.startsWith('GIT_')) e[k] = v;
  if (ceiling) e.GIT_CEILING_DIRECTORIES = ceiling;
  return e;
}
/** `git -C <cwd> <args>` mit gesäuberter Umgebung; gibt stdout zurück, wirft bei Fehler. */
function gitAus(cwd, args, { ceiling, still = true } = {}) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', env: gitUmgebung(ceiling), stdio: ['ignore', 'pipe', still ? 'ignore' : 'pipe'], maxBuffer: 1 << 28 });
}

const GRUND_MIN = 10;
const GRUND_VIELFALT = 4;
const FUELLER = new Set(['\u3164', '\u115f', '\u1160', '\uffa0', '\u2800']);
/**
 * M1 (N3), Positivliste: Zeichen, die zählen, sind Buchstaben und Ziffern (`\p{L}`, `\p{N}`), ohne Füllzeichen (U+3164, U+115F, U+1160,
 * U+FFA0, U+2800) und ohne Zeichen der Klasse `\p{M}` (ohne Träger nicht sichtbar). Emoji, Satzzeichen, Punkte, Privatbereich zählen 0.
 */
export function zaehlendeZeichen(text) {
  return [...text].filter((c) => /^[\p{L}\p{N}]$/u.test(c) && !FUELLER.has(c));
}
/** Sichtbare Zeichen eines Grundes (= zählende Zeichen der Positivliste). */
export function sichtbareZeichen(text) {
  return zaehlendeZeichen(text).length;
}
/** Ist der Grund gültig? mindestens 10 zählende Zeichen, mindestens 4 verschiedene, keine Steuerzeichen (N2). Gibt null oder den Grund der Ablehnung zurück. */
export function grundMangel(grund) {
  if (typeof grund !== 'string') return 'ist kein Text';
  if (/\p{Cc}/u.test(grund)) return 'enthält Steuerzeichen (Zeilenumbruch, CR, Tabulator …)';
  const z = zaehlendeZeichen(grund);
  if (z.length < GRUND_MIN) return `hat nur ${z.length} zählende Zeichen (Buchstaben/Ziffern), verlangt sind ${GRUND_MIN}`;
  if (new Set(z).size < GRUND_VIELFALT) return `hat nur ${new Set(z).size} verschiedene zählende Zeichen, verlangt sind ${GRUND_VIELFALT}`;
  return null;
}

/** Ein Eintrag der Grenzdatei als { art, grenze|hoechstens, grund } oder { art:'ungueltig', text }. */
export function leseEintrag(wert) {
  if (Number.isInteger(wert) && wert > 0) return { art: 'zahl', grenze: wert, grund: null };
  if (wert && typeof wert === 'object' && !Array.isArray(wert)) {
    const mangel = 'grund' in wert ? grundMangel(wert.grund) : null;
    if (mangel) return { art: 'ungueltig', text: `"grund" ${mangel} (Positivliste: mindestens ${GRUND_MIN} Buchstaben/Ziffern, davon mindestens ${GRUND_VIELFALT} verschiedene, keine Füll- oder Steuerzeichen)` };
    const grund = 'grund' in wert ? wert.grund.trim() : null;
    if (wert.frei === true && Number.isInteger(wert.hoechstens) && wert.hoechstens > 0) {
      const fremd = Object.keys(wert).filter((k) => !['frei', 'hoechstens', 'grund'].includes(k));
      return fremd.length ? { art: 'ungueltig', text: `unbekannte Schlüssel ${fremd.join(', ')}` } : { art: 'frei', hoechstens: wert.hoechstens, grund };
    }
    if (Number.isInteger(wert.grenze) && wert.grenze > 0 && wert.frei === undefined) {
      const fremd = Object.keys(wert).filter((k) => !['grenze', 'grund'].includes(k));
      return fremd.length ? { art: 'ungueltig', text: `unbekannte Schlüssel ${fremd.join(', ')}` } : { art: 'zahl', grenze: wert.grenze, grund };
    }
  }
  return { art: 'ungueltig', text: `${JSON.stringify(wert)} ist weder eine positive ganze Zahl noch { "grenze": Zahl } noch { "frei": true, "hoechstens": Zahl }` };
}

/**
 * Basis für M5: { grenzen: Objekt|null, zeilen(pfad) → Zahl|null, name } oder null. `anzeigeName` (optional) ersetzt den Referenznamen in der Anzeige.
 */
export function basisAusGit(wurzel, ref, anzeigeName) {
  const git = (...a) => gitAus(wurzel, a);
  let sha = '';
  try {
    sha = git('rev-parse', '--short=8', `${ref}^{commit}`).trim();
  } catch {
    /* Name ohne Commit */
  }
  const name = anzeigeName ?? ref;
  const anzeige = sha && !name.includes(sha) ? `${name}@${sha}` : name;
  let text;
  try {
    text = git('show', `${ref}:${GRENZEN_DATEI}`);
  } catch {
    return { grenzen: null, zeilen: () => null, name: anzeige, fehlt: `${GRENZEN_DATEI} steht auf der Basis ${anzeige} nicht (erster PR mit dem Wächter)` };
  }
  let grenzen;
  try {
    grenzen = JSON.parse(text);
  } catch {
    return { grenzen: null, zeilen: () => null, name: anzeige, fehlt: `${GRENZEN_DATEI} auf der Basis ${anzeige} ist kein gültiges JSON` };
  }
  return {
    grenzen,
    name: anzeige,
    zeilen: (pfad) => {
      try {
        return zaehleText(git('show', `${ref}:${pfad}`));
      } catch {
        return null;
      }
    },
  };
}

const BASIS_RAUM = 'refs/wov-groessen/basis';

/**
 * Findet die Basis: --basis, WOV_GROESSEN_BASIS, merge-base mit origin/main, in der CI die Basis des PR. Gibt { basis } oder { basis: null, grund };
 * `hinweis` (N3): die ausdrücklich genannte Basis ist der Stand selbst (kein Vergleich).
 * Das Holen (N4) schreibt nur in den eigenen Ref-Namensraum `refs/wov-groessen/`, ohne FETCH_HEAD, und macht einen VOLLEN Klon nie flach (`--depth=1` nur, wenn er schon flach ist).
 */
export function findeBasis(wurzel, ausdruecklich, umgebung = process.env, { ceiling } = {}) {
  const git = (...a) => gitAus(wurzel, a, { ceiling }).trim();
  const ok = (ref) => {
    try {
      git('rev-parse', '--verify', `${ref}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };
  try {
    git('rev-parse', '--git-dir');
  } catch {
    return { basis: null, grund: 'kein Git-Verzeichnis' };
  }
  const ref = ausdruecklich ?? umgebung.WOV_GROESSEN_BASIS;
  if (ref) {
    if (!ok(ref)) return { basis: null, grund: `Basis ${ref} ist kein Commit dieses Klons` };
    const gleichHead = git('rev-parse', `${ref}^{commit}`) === git('rev-parse', 'HEAD');
    return { basis: basisAusGit(wurzel, ref), ...(gleichHead ? { hinweis: `Basis = HEAD (${ref}): kein Vergleich, das Gedächtnis (M5) prüft nichts` } : {}) };
  }
  if (ok('origin/main')) {
    try {
      return { basis: basisAusGit(wurzel, git('merge-base', 'HEAD', 'origin/main')) };
    } catch {
      /* flacher Klon: weiter unten */
    }
  }
  const basisZweig = umgebung.GITHUB_BASE_REF;
  if (basisZweig) {
    if (ok(`origin/${basisZweig}`)) return { basis: basisAusGit(wurzel, `origin/${basisZweig}`) };
    try {
      const flach = git('rev-parse', '--is-shallow-repository') === 'true';
      gitAus(wurzel, ['fetch', '--no-tags', '--no-write-fetch-head', ...(flach ? ['--depth=1'] : []), 'origin', `+refs/heads/${basisZweig}:${BASIS_RAUM}`], { ceiling });
      return { basis: basisAusGit(wurzel, BASIS_RAUM, `origin/${basisZweig}`) };
    } catch {
      return { basis: null, grund: `Basis ${basisZweig} ließ sich nicht holen (kein Netz?)` };
    }
  }
  return { basis: null, grund: 'keine Basis gefunden (weder --basis noch WOV_GROESSEN_BASIS noch origin/main noch GITHUB_BASE_REF)' };
}

/**
 * Prüft einen Baum. `basis` = Ergebnis von basisAusGit (oder gleich geformtes Objekt) oder null.
 * Gibt { befunde, hinweise, laut, zahlen } zurück; `laut` = Begründungen, die im PR-Text stehen müssen.
 */
export function pruefe(wurzel, basis = null) {
  const befunde = [];
  const hinweise = [];
  const laut = [];
  const dateien = sammle(wurzel, hinweise);
  const leer = (b) => ({ befunde: b, hinweise, laut, zahlen: { dateien: dateien.size, liste: 0 } });
  let text;
  try {
    text = readFileSync(join(wurzel, GRENZEN_DATEI), 'utf8');
  } catch {
    return leer([`${GRENZEN_DATEI} fehlt`]);
  }
  let grenzen;
  try {
    grenzen = JSON.parse(text);
  } catch (e) {
    return leer([`${GRENZEN_DATEI} ist kein gültiges JSON: ${e.message}`]);
  }
  if (grenzen === null || typeof grenzen !== 'object' || Array.isArray(grenzen)) return leer([`${GRENZEN_DATEI} muss ein Objekt {pfad: Eintrag} sein`]);

  // Form: sortiert, ein Eintrag je Zeile, keine doppelten Schlüssel (JSON.parse würde sie still schlucken)
  const zeilenSchluessel = [...text.matchAll(/^ {2}"([^"]+)"\s*:/gm)].map((m) => m[1]);
  if (zeilenSchluessel.length !== Object.keys(grenzen).length) {
    befunde.push(`${GRENZEN_DATEI}: ${zeilenSchluessel.length} Zeilen mit Schlüssel, aber ${Object.keys(grenzen).length} Einträge (doppelter Schlüssel oder mehrere Einträge in einer Zeile)`);
  }
  const sortiert = [...zeilenSchluessel].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sortiert.some((k, i) => k !== zeilenSchluessel[i])) {
    const i = zeilenSchluessel.findIndex((k, j) => k !== sortiert[j]);
    befunde.push(`${GRENZEN_DATEI} ist nicht nach Pfad sortiert (erste Abweichung: "${zeilenSchluessel[i]}", erwartet "${sortiert[i]}")`);
  }

  const eintraege = new Map();
  for (const [pfad, wert] of Object.entries(grenzen)) {
    const e = leseEintrag(wert);
    eintraege.set(pfad, e);
    if (e.art === 'ungueltig') {
      befunde.push(`${pfad}: ${e.text}`);
      continue;
    }
    const zeilen = dateien.get(pfad);
    if (zeilen === undefined) {
      befunde.push(`B4 ${pfad}: steht in der Liste, die Datei gibt es nicht (mehr) unter ${ORDNER.join(', ')}. Eintrag entfernen.`);
      continue;
    }
    if (e.art === 'frei') {
      if (!FREI_ERLAUBT.has(pfad)) befunde.push(`B5 ${pfad}: "frei" ist nur für die sechs großen Dateien erlaubt. Eine Zahl eintragen: höchstens ${hoechsteObergrenze(zeilen)}.`);
      else if (zeilen <= GRENZE) befunde.push(`B4 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}). Eintrag entfernen.`);
      else if (zeilen > e.hoechstens) befunde.push(`B2 ${pfad}: hat ${zeilen} Zeilen, Deckel ${e.hoechstens}. Die Datei ist über ihren Deckel gewachsen; Schnittschritt oder Begründung nötig.`);
      continue;
    }
    if (zeilen <= GRENZE) {
      befunde.push(`B4 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}), steht aber mit ${e.grenze} in der Liste. Eintrag entfernen.`);
      continue;
    }
    if (zeilen > e.grenze) befunde.push(`B2 ${pfad}: hat ${zeilen} Zeilen, Obergrenze ${e.grenze}. Die Datei ist über ihre Obergrenze gewachsen.`);
    const hoechst = hoechsteObergrenze(zeilen);
    if (e.grenze > hoechst) befunde.push(`B3 ${pfad}: Obergrenze ${e.grenze} ist zu hoch für ${zeilen} Zeilen (höchstens ${hoechst}). Auf ${hoechst} senken.`);
  }

  for (const [pfad, zeilen] of dateien) {
    if (Object.hasOwn(grenzen, pfad)) continue;
    if (zeilen > GRENZE) befunde.push(`B1 ${pfad}: hat ${zeilen} Zeilen (höchstens ${GRENZE}) und steht nicht in ${GRENZEN_DATEI}. Aufteilen; die Liste wächst nicht.`);
    else if (zeilen >= HINWEIS_AB) hinweise.push(`${pfad}: ${zeilen} Zeilen, knapp unter der Grenze von ${GRENZE}`);
  }

  // M5: Gedächtnis gegen die Basis des PR
  if (!basis) hinweise.push('Gedächtnis (M5) nicht geprüft: keine Basis');
  else if (!basis.grenzen) hinweise.push(`Gedächtnis (M5) nicht geprüft: ${basis.fehlt ?? 'Basis ohne Grenzdatei'}`);
  else {
    const alt = new Map(Object.entries(basis.grenzen).map(([p, w]) => [p, leseEintrag(w)]));
    const grundMelden = (pfad, e, was) => {
      if (e.grund) laut.push(`${pfad}: ${was} — Grund: ${e.grund}`);
      return !!e.grund;
    };
    for (const [pfad, e] of eintraege) {
      if (e.art === 'ungueltig') continue;
      const a = alt.get(pfad);
      if (!a || a.art === 'ungueltig') {
        const amBasis = basis.zeilen(pfad);
        if (amBasis === null || amBasis <= GRENZE) {
          const was = amBasis === null ? 'nicht (Neuanlage oder Umbenennung)' : `nur ${amBasis} Zeilen`;
          if (!grundMelden(pfad, e, `neuer Eintrag ${JSON.stringify(grenzen[pfad])}, die Datei hatte auf der Basis ${basis.name} ${was}`)) {
            befunde.push(`M5 ${pfad}: neuer Eintrag, aber die Datei hatte auf der Basis ${basis.name} ${was} — die Liste wächst nicht; aufteilen statt eintragen (eine Umbenennung einer gelisteten Datei nur mit "grund", zum Beispiel "umbenannt von …").`);
          }
        }
        continue;
      }
      if (a.art === 'zahl' && e.art === 'zahl' && e.grenze > a.grenze) {
        if (!grundMelden(pfad, e, `Obergrenze von ${a.grenze} auf ${e.grenze} erhöht`)) befunde.push(`M5 ${pfad}: Obergrenze von ${a.grenze} auf ${e.grenze} erhöht; sie darf im PR nur sinken (Erhöhung nur mit "grund" im Eintrag).`);
      } else if (a.art === 'frei' && e.art === 'frei' && e.hoechstens > a.hoechstens) {
        if (!grundMelden(pfad, e, `Deckel von ${a.hoechstens} auf ${e.hoechstens} erhöht`)) befunde.push(`M5 ${pfad}: Deckel von ${a.hoechstens} auf ${e.hoechstens} erhöht; er darf im PR nur sinken (Erhöhung nur mit "grund" im Eintrag).`);
      } else if (a.art === 'zahl' && e.art === 'frei') {
        befunde.push(`M5 ${pfad}: Eintrag von der Zahl ${a.grenze} zu "frei" gemacht; das nimmt eine Grenze weg.`);
      } else if (a.art === 'frei' && e.art === 'zahl' && e.grenze > a.hoechstens) {
        if (!grundMelden(pfad, e, `Zahl ${e.grenze} über dem bisherigen Deckel ${a.hoechstens}`)) befunde.push(`M5 ${pfad}: Zahl ${e.grenze} liegt über dem bisherigen Deckel ${a.hoechstens}.`);
      }
    }
  }
  return { befunde, hinweise, laut, zahlen: { dateien: dateien.size, liste: Object.keys(grenzen).length } };
}

// ── Selbstprobe an einem Wegwerf-Baum ────────────────────────────────────────────────────────

function baue(wurzel, dateien, grenzenText) {
  for (const [pfad, zeilen] of Object.entries(dateien)) {
    const p = join(wurzel, pfad);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof zeilen === 'string' ? zeilen : 'x\n'.repeat(zeilen));
  }
  mkdirSync(join(wurzel, 'scripts'), { recursive: true });
  writeFileSync(join(wurzel, GRENZEN_DATEI), grenzenText);
}

const json = (o) => `{\n${Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
const kennung = (b) => /^(B\d|M5)/.exec(b)?.[1] ?? 'FORM';

/** Wirft, wenn eine Regel in eine der beiden Richtungen nicht greift. Liefert die Zahl der Fälle. */
export function selbstprobe() {
  const tmp = mkdtempSync(join(tmpdir(), 'pruefe-groessen-'));
  let n = 0;
  const fall = (name, dateien, grenzen, erwartet, { roh, basis, laut } = {}) => {
    const w = join(tmp, `f${n++}`);
    baue(w, dateien, roh ?? json(grenzen));
    const erg = pruefe(w, basis ?? null);
    const ist = erg.befunde.map(kennung).sort().join(',');
    const soll = [...erwartet].sort().join(',');
    if (ist !== soll) throw new Error(`Selbstprobe "${name}": erwartet [${soll}], bekam [${ist}]\n  ${erg.befunde.join('\n  ')}`);
    if (laut && !erg.laut.some((l) => l.includes(laut))) throw new Error(`Selbstprobe "${name}": erwartet eine laute Begründung mit "${laut}", bekam [${erg.laut.join(' | ')}]`);
  };
  try {
    const gross = 'server/src/WovServer.ts';
    fall('leerer Baum ist grün', { 'client/src/a.ts': 10 }, {}, []);
    fall('Datei mit genau 1.500 Zeilen ist grün', { 'client/src/a.ts': 1500 }, {}, []);
    fall('B1: neue Datei mit 1.501 Zeilen', { 'client/src/a.ts': 1501 }, {}, ['B1']);
    fall('B1: gilt in jedem der vier Ordner', { 'admin/src/a.ts': 1501, 'shared/src/b.ts': 1501, 'server/src/c.ts': 1501 }, {}, ['B1', 'B1', 'B1']);
    fall('B1: auch .tsx/.mts/.js/.mjs zählen (N6)', { 'client/src/a.tsx': 1501, 'client/src/b.mts': 1501, 'client/src/c.js': 1501, 'client/src/d.mjs': 1501 }, {}, ['B1', 'B1', 'B1', 'B1']);
    fall('B1: Zeilen nur mit CR getrennt zählen (N7)', { 'client/src/a.ts': 'x\r'.repeat(1501) }, {}, ['B1']);
    fall('B1: CRLF zählt eine Zeile je Umbruch (1.500 sind grün, 1.501 rot)', { 'client/src/a.ts': 'x\r\n'.repeat(1500), 'client/src/b.ts': 'x\r\n'.repeat(1501) }, {}, ['B1']);
    fall('B1: Punktordner und build/dist unter src zählen (N6)', { 'client/src/.x/a.ts': 1501, 'client/src/build/b.ts': 1501, 'client/src/dist/c.ts': 1501 }, {}, ['B1', 'B1', 'B1']);
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
    fall('B5: Deckel für eine große Datei (6.703 Zeilen, Deckel 7.550) ist grün', { [gross]: 6703 }, { [gross]: { frei: true, hoechstens: 7550 } }, []);
    fall('B2: Deckel überschritten', { [gross]: 7551 }, { [gross]: { frei: true, hoechstens: 7550 } }, ['B2']);
    fall('Deckel: Schrumpfen ist immer erlaubt (kein B3)', { [gross]: 2000 }, { [gross]: { frei: true, hoechstens: 7550 } }, []);
    fall('B5: Deckel auf einer nicht erlaubten Datei ist ein Befund', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': { frei: true, hoechstens: 9000 } }, ['B5']);
    fall('B5: nacktes "frei" ohne Deckel ist ungültig', { [gross]: 6703 }, { [gross]: 'frei' }, ['FORM']);
    fall('B4: Deckel für eine Datei unter der Grenze', { [gross]: 900 }, { [gross]: { frei: true, hoechstens: 7550 } }, ['B4']);
    fall('Wert ist weder Zahl noch Objekt', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 'hoch' }, ['FORM']);
    fall('Wert: unbekannter Schlüssel', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': { grenze: 2200, x: 1 } }, ['FORM']);
    fall('Wert: leerer "grund"', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': { grenze: 2200, grund: ' ' } }, ['FORM']);
    fall('Form: Liste nicht sortiert', { 'client/src/a.ts': 2000, 'client/src/b.ts': 2000 }, {}, ['FORM'], { roh: '{\n  "client/src/b.ts": 2200,\n  "client/src/a.ts": 2200\n}\n' });
    fall('Form: doppelter Schlüssel', { 'client/src/a.ts': 2000 }, {}, ['FORM'], { roh: '{\n  "client/src/a.ts": 2200,\n  "client/src/a.ts": 2200\n}\n' });
    fall('Form: kein JSON', { 'client/src/a.ts': 10 }, {}, ['FORM'], { roh: '{ nope' });
    {
      const w = join(tmp, 'symlink');
      baue(w, { 'client/src/a.ts': 10 }, json({}));
      try {
        symlinkSync('/gibt/es/nicht.ts', join(w, 'client/src/kaputt.ts'));
        n++;
        const erg = pruefe(w, null);
        if (erg.befunde.length !== 0 || !erg.hinweise.some((h) => h.includes('kaputt.ts'))) throw new Error(`Selbstprobe "kaputter Symlink": erwartet Hinweis ohne Befund, bekam ${JSON.stringify(erg)}`);
      } catch (e) {
        if (!String(e.message).startsWith('Selbstprobe')) n--; /* Symlinks nicht möglich: Fall entfällt */ else throw e;
      }
    }

    // ── M5: Gedächtnis ──
    const B = (grenzen, zeilenAmBasis = {}) => ({ grenzen, name: 'basis', zeilen: (p) => zeilenAmBasis[p] ?? null });
    const alt = { 'client/src/a.ts': 2200, [gross]: { frei: true, hoechstens: 7550 } };
    fall('M5: unverändert gegen die Basis ist grün', { 'client/src/a.ts': 2000, [gross]: 6703 }, alt, [], { basis: B(alt) });
    fall('M5: neue Datei mit 1.501 Zeilen UND neuem Eintrag 1700 (Basis kennt sie nicht)', { 'client/src/a.ts': 2000, 'client/src/neu.ts': 1501, [gross]: 6703 }, { ...alt, 'client/src/neu.ts': 1700 }, ['M5'], { basis: B(alt) });
    fall('M5: neuer Eintrag für eine Datei, die auf der Basis schon über 1.500 hatte, ist grün', { 'client/src/a.ts': 2000, 'client/src/b.ts': 1600, [gross]: 6703 }, { ...alt, 'client/src/b.ts': 1800 }, [], { basis: B(alt, { 'client/src/b.ts': 1600 }) });
    fall('M5: neuer Eintrag für eine Datei, die auf der Basis nur 1.400 hatte', { 'client/src/a.ts': 2000, 'client/src/b.ts': 1600, [gross]: 6703 }, { ...alt, 'client/src/b.ts': 1800 }, ['M5'], { basis: B(alt, { 'client/src/b.ts': 1400 }) });
    fall('M5: Obergrenze erhöht (2200 → 2450 bei 2205 Zeilen) ohne Grund', { 'client/src/a.ts': 2205, [gross]: 6703 }, { ...alt, 'client/src/a.ts': 2450 }, ['M5'], { basis: B({ ...alt, 'client/src/a.ts': 2200 }) });
    fall('M5: Obergrenze erhöht MIT Grund: grün und laut', { 'client/src/a.ts': 2205, [gross]: 6703 }, { ...alt, 'client/src/a.ts': { grenze: 2450, grund: 'Datei bekommt die Vorschau-Kaskade' } }, [], { basis: B({ ...alt, 'client/src/a.ts': 2200 }), laut: 'Vorschau-Kaskade' });
    fall('M5: Obergrenze gesenkt ist grün', { 'client/src/a.ts': 1900, [gross]: 6703 }, { ...alt, 'client/src/a.ts': 2100 }, [], { basis: B(alt) });
    fall('M5: Umbenennung ohne passenden Eintrag (alter Name weg, neue Datei > 1.500)', { 'client/src/b.ts': 2000, [gross]: 6703 }, { [gross]: alt[gross] }, ['B1'], { basis: B(alt) });
    fall('M5: Umbenennung mit Eintrag unter neuem Namen, ohne Grund', { 'client/src/b.ts': 2000, [gross]: 6703 }, { 'client/src/b.ts': 2200, [gross]: alt[gross] }, ['M5'], { basis: B(alt) });
    fall('M5: Umbenennung mit Eintrag unter neuem Namen MIT Grund: grün und laut', { 'client/src/b.ts': 2000, [gross]: 6703 }, { 'client/src/b.ts': { grenze: 2200, grund: 'umbenannt von client/src/a.ts' }, [gross]: alt[gross] }, [], { basis: B(alt), laut: 'umbenannt von' });
    fall('M5: Deckel erhöht ohne Grund', { [gross]: 6703 }, { [gross]: { frei: true, hoechstens: 9000 } }, ['M5'], { basis: B({ [gross]: { frei: true, hoechstens: 7550 } }) });
    fall('M5: Deckel erhöht mit Grund: grün und laut', { [gross]: 6703 }, { [gross]: { frei: true, hoechstens: 9000, grund: 'Sammelmerge der Nachtkarten' } }, [], { basis: B({ [gross]: { frei: true, hoechstens: 7550 } }), laut: 'Sammelmerge' });
    fall('M5: Deckel gesenkt ist grün', { [gross]: 6703 }, { [gross]: { frei: true, hoechstens: 7000 } }, [], { basis: B({ [gross]: { frei: true, hoechstens: 7550 } }) });
    fall('M5: Zahl wird zu "frei" (nimmt eine Grenze weg)', { [gross]: 6703 }, { [gross]: { frei: true, hoechstens: 9999 } }, ['M5'], { basis: B({ [gross]: 7400 }) });
    fall('M5: "frei" wird zur echten Zahl (erster Schnittschritt) ist grün', { [gross]: 6703 }, { [gross]: 7400 }, [], { basis: B({ [gross]: { frei: true, hoechstens: 7550 } }) });
    fall('M5: "frei" wird zu einer Zahl über dem Deckel', { [gross]: 7600 }, { [gross]: 7700 }, ['M5'], { basis: B({ [gross]: { frei: true, hoechstens: 7550 } }) });
    fall('M5: ohne Basis läuft der Wächter wie bisher (nur Hinweis)', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2200 }, [], { basis: null });
    fall('M5: Basis ohne Grenzdatei (erster PR) ist ein Hinweis, kein Befund', { 'client/src/a.ts': 2000 }, { 'client/src/a.ts': 2200 }, [], { basis: { grenzen: null, fehlt: 'Grenzdatei fehlt', zeilen: () => null, name: 'x' } });
    // ── M6/M1/N2: Begründung nach Positivliste (mindestens 10 Buchstaben/Ziffern, davon 4 verschiedene, keine Steuerzeichen) ──
    const mitGrund = (g) => ({ 'client/src/a.ts': { grenze: 2450, grund: g } });
    const basisA = { grenzen: { 'client/src/a.ts': 2200 }, name: 'basis', zeilen: () => null };
    for (const [name, g, gut] of [
      ['Grund "abcdefghij" (10 verschiedene Buchstaben): grün', 'abcdefghij', true],
      ['Grund mit Leerzeichen dazwischen (a b c d e f g h i j): grün', 'a b c d e f g h i j', true],
      ['Grund "umbenannt von client/src/a.ts": grün', 'umbenannt von client/src/a.ts', true],
      ['Grund mit 9 Buchstaben: rot', 'abcdefghi', false],
    ]) {
      fall(`M6: ${name}`, { 'client/src/a.ts': 2205 }, mitGrund(g), gut ? [] : ['FORM'], { basis: basisA, ...(gut ? { laut: g.trim() } : {}) });
    }
    // Die 34 Probegründe des Nachangriffs (m6-probe.mjs): alle bis auf den Tastaturlauf müssen abgelehnt werden
    const f = (cp, n = 10) => String.fromCodePoint(cp).repeat(n);
    const probegruende = [
      ['Cf: 12x U+200B', f(0x200b, 12)], ['Zs: 12x U+00A0', f(0xa0, 12)], ['Cf: 12x U+2060', f(0x2060, 12)], ['Cf: 12x Tag-Zeichen U+E0061', f(0xe0061, 12)],
      ['Mn: 10x U+034F', f(0x34f)], ['Mn: 10x U+FE0F', f(0xfe0f)], ['Mn: 10x U+0301 ohne Träger', f(0x301)], ['Mn: a + 9x U+0301', 'a' + f(0x301, 9)],
      ['Lo: 10x U+3164', f(0x3164)], ['Lo: 10x U+115F', f(0x115f)], ['Lo: 10x U+FFA0', f(0xffa0)], ['So: 10x U+2800', f(0x2800)],
      ['Mn: 10x U+180B', f(0x180b)], ['Mn: 10x U+17B5', f(0x17b5)], ['Cn: 10x U+0378', f(0x378)], ['Co: 10x U+E000', f(0xe000)], ['Zl: 10x U+2028', f(0x2028)],
      ['Emoji: 10x U+1F600', f(0x1f600)], ['Emoji: Familie (ZWJ) + 3 Emoji', '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}' + f(0x1f600, 3)], ['Emoji: 5 Flaggen', '\u{1F1E9}\u{1F1EA}'.repeat(5)],
      ['aaaaaaaaaa', 'a'.repeat(10)], ['----------', '-'.repeat(10)], ['??????????', '?'.repeat(10)], ['.........a', '.........a'],
      ['10x U+3002', f(0x3002)], ['10x U+2024', f(0x2024)], ['10x U+FF0E', f(0xff0e)], ['10x U+2219', f(0x2219)], [',,,,,,,,,,', ','.repeat(10)],
      ['Ziffern 0000000000', '0'.repeat(10)], ['Zahl 1234567890', 1234567890], ['Feld', ['umbenannt von']],
      ['CR + Workflow-Befehl', 'umbenannt\r::error title=fremd::eingeschleust'], ['Zeilenumbruch im Grund', 'umbenannt von\nclient/src/a.ts'],
    ];
    const tastatur = 'asdfghjklö'; // 10 verschiedene Buchstaben: nicht erkennbar, bleibt Grenze (dokumentiert)
    for (const [name, g] of probegruende) {
      if (leseEintrag({ grenze: 3550, grund: g }).art !== 'ungueltig') throw new Error(`Selbstprobe M1: Grund "${name}" wurde angenommen`);
    }
    if (leseEintrag({ grenze: 3550, grund: tastatur }).art === 'ungueltig') throw new Error('Selbstprobe M1: Tastaturlauf ist als bekannte Grenze annehmbar');
    n += 2;
    // ── M5: ohne Basis in der CI ──
    const pr = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' };
    const b1 = bewerteBasis(null, 'nicht holbar', pr);
    if (b1.befunde.length !== 1 || !/M5 in der CI bei pull_request ohne Basis/.test(b1.befunde[0])) throw new Error('Selbstprobe M5: pull_request ohne Basis muss rot sein');
    n++;
    const b2 = bewerteBasis(null, 'kein origin', { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' });
    if (b2.befunde.length !== 0 || !/OHNE Basis/.test(b2.hinweise[0] ?? '')) throw new Error('Selbstprobe M5: push ohne Basis grün, aber laut „OHNE Basis“');
    for (const ev of ['pull_request_target', 'merge_group']) {
      const be = bewerteBasis(null, 'nicht holbar', { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: ev });
      if (be.befunde.length !== 1 || !be.befunde[0].includes(ev)) throw new Error(`Selbstprobe N1: ${ev} ohne Basis muss rot sein`);
    }
    n += 2;
    const b3 = bewerteBasis(null, 'kein Git', {});
    if (b3.befunde.length !== 0 || !/OHNE Basis/.test(b3.hinweise[0] ?? '')) throw new Error('Selbstprobe M5: lokal ohne Basis grün, aber laut');
    const b4 = bewerteBasis({ name: 'x' }, undefined, pr);
    if (b4.befunde.length !== 0 || b4.hinweise.length !== 0) throw new Error('Selbstprobe M5: mit Basis nichts zu melden');
    n += 3;
    // ── M5: Meldung in den CI-Log (Job-Zusammenfassung + Runner-stderr) ──
    {
      const angehaengt = [];
      const zeilen = [{ art: 'notice', text: 'pruefe-groessen: Vergleich MIT Basis abc' }, { art: 'warning', text: 'BEGRÜNDUNG (in den PR-Text): x: y' }];
      const wohin = meldeAnCi(zeilen, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/summary' }, { anhaengen: (f, t) => angehaengt.push([f, t]), runnerStderr: join(tmp, 'runner-stderr.txt') });
      const rs = readFileSync(join(tmp, 'runner-stderr.txt'), 'utf8');
      if (!wohin.includes('summary') || !wohin.includes('runner-stderr')) throw new Error(`Selbstprobe M5: Meldung ging nach ${JSON.stringify(wohin)}`);
      if (!/::notice title=pruefe-groessen::pruefe-groessen: Vergleich MIT Basis abc/.test(rs) || !/::warning title=pruefe-groessen::BEGRÜNDUNG/.test(rs)) throw new Error(`Selbstprobe M5: Workflow-Befehle fehlen: ${rs}`);
      if (!angehaengt.some(([f, t]) => f === '/summary' && /Vergleich MIT Basis abc/.test(t))) throw new Error('Selbstprobe M5: Job-Zusammenfassung fehlt');
      if (meldeAnCi(zeilen, {}, { runnerStderr: join(tmp, 'x.txt') }).length !== 0) throw new Error('Selbstprobe M5: außerhalb der CI wird nichts gemeldet');
      n += 3;
    }
    n += gitProbe(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return n;
}

/** Die Git-Verdrahtung von M5 an einem echten kleinen Verlauf: Basis-Commit, Änderung, findeBasis. Ohne Git: übersprungen. */
function gitProbe(tmp) {
  // H1: gesäuberte Umgebung, GIT_CEILING_DIRECTORIES auf den Temp-Ordner, ausdrückliches -C: kein Zugriff auf ein umgebendes oder ein per GIT_DIR gesetztes Repo.
  const git = (cwd, ...a) => gitAus(cwd, ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', ...a], { ceiling: tmp, still: false });
  try {
    git(tmp, '--version');
  } catch {
    return 0;
  }
  const w = join(tmp, 'gitprobe');
  const gross = 'server/src/WovServer.ts';
  baue(w, { 'client/src/a.ts': 2000, [gross]: 6703 }, json({ 'client/src/a.ts': 2200, [gross]: { frei: true, hoechstens: 7550 } }));
  git(w, 'init', '-q', '-b', 'main');
  git(w, 'add', '-A');
  git(w, 'commit', '-q', '-m', 'basis');
  const ref = git(w, 'rev-parse', 'HEAD').trim();
  // Änderung im "PR": Obergrenze 2200 → 2450 ohne Grund, dazu eine neue große Datei mit Eintrag
  baue(w, { 'client/src/a.ts': 2205, 'client/src/neu.ts': 1600, [gross]: 6703 }, json({ 'client/src/a.ts': 2450, 'client/src/neu.ts': 1700, [gross]: { frei: true, hoechstens: 7550 } }));
  const { basis, grund } = findeBasis(w, ref, {}, { ceiling: tmp });
  if (!basis) throw new Error(`Selbstprobe Git: Basis ${ref} nicht gefunden (${grund})`);
  const erg = pruefe(w, basis);
  const kennungen = erg.befunde.map(kennung).sort().join(',');
  if (kennungen !== 'M5,M5') throw new Error(`Selbstprobe Git: erwartet [M5,M5] (Erhöhung + neuer Eintrag), bekam [${kennungen}]\n  ${erg.befunde.join('\n  ')}`);
  // ohne Basis-Referenz und ohne origin/main: findeBasis sagt es
  const ohne = findeBasis(w, undefined, {}, { ceiling: tmp });
  if (ohne.basis) throw new Error('Selbstprobe Git: ohne Referenz darf keine Basis gefunden werden');
  const kaputt = findeBasis(w, 'gibt-es-nicht', {}, { ceiling: tmp });
  if (kaputt.basis || !/kein Commit/.test(kaputt.grund ?? '')) throw new Error('Selbstprobe Git: unbekannte Basis muss gemeldet werden');
  // CI-Weg pull_request: GITHUB_BASE_REF gesetzt, aber der Zweig lässt sich nicht holen (kein origin) → keine Basis, Grund benannt
  const ci = findeBasis(w, undefined, { GITHUB_BASE_REF: 'main' }, { ceiling: tmp });
  if (ci.basis || !/nicht holen/.test(ci.grund ?? '')) throw new Error(`Selbstprobe Git: GITHUB_BASE_REF ohne erreichbaren Zweig muss „ließ sich nicht holen“ melden, bekam ${JSON.stringify(ci)}`);
  if (bewerteBasis(ci.basis, ci.grund, { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }).befunde.length !== 1) throw new Error('Selbstprobe Git: dieser Weg muss in der CI rot sein');
  // CI-Weg pull_request mit erreichbarem Zweig: origin = das Probe-Repo selbst
  const kopie = join(tmp, 'gitprobe-klon');
  git(tmp, 'clone', '-q', '--depth=1', `file://${w}`, kopie);
  const flachVorher = existsSync(join(kopie, '.git', 'shallow'));
  if (!flachVorher) throw new Error('Selbstprobe Git: der flache Probeklon ist nicht flach');
  const ciOk = findeBasis(kopie, undefined, { GITHUB_BASE_REF: 'main' }, { ceiling: tmp });
  if (!ciOk.basis) throw new Error(`Selbstprobe Git: flacher Klon mit GITHUB_BASE_REF=main muss die Basis holen (${ciOk.grund})`);
  // N4: Ein VOLLER Klon wird beim Basis-Holen nicht flach; nur der eigene Ref-Namensraum entsteht, kein FETCH_HEAD
  const voll = join(tmp, 'gitprobe-voll');
  git(tmp, 'clone', '-q', `file://${w}`, voll);
  git(voll, 'update-ref', '-d', 'refs/remotes/origin/main');
  const gehoolt = findeBasis(voll, undefined, { GITHUB_BASE_REF: 'main' }, { ceiling: tmp });
  if (!gehoolt.basis) throw new Error(`Selbstprobe Git: voller Klon ohne origin/main muss die Basis holen (${gehoolt.grund})`);
  if (existsSync(join(voll, '.git', 'shallow'))) throw new Error('Selbstprobe Git: das Basis-Holen hat einen vollen Klon flach gemacht (N4)');
  if (existsSync(join(voll, '.git', 'FETCH_HEAD'))) throw new Error('Selbstprobe Git: das Basis-Holen hat FETCH_HEAD geschrieben');
  if (!git(voll, 'for-each-ref', 'refs/wov-groessen/').includes('refs/wov-groessen/basis')) throw new Error('Selbstprobe Git: eigener Ref-Namensraum fehlt');
  // N3: die ausdrückliche Basis ist HEAD selbst
  const kopfSelbst = findeBasis(w, 'HEAD', {}, { ceiling: tmp });
  if (!kopfSelbst.hinweis || !/Basis = HEAD/.test(kopfSelbst.hinweis)) throw new Error('Selbstprobe Git: Basis = HEAD muss laut gemeldet werden (N3)');
  // kein Git-Verzeichnis
  const nogit = join(tmp, 'nogit');
  baue(nogit, { 'client/src/a.ts': 10 }, json({}));
  const keins = findeBasis(nogit, undefined, {}, { ceiling: tmp });
  if (keins.basis || !/Git/.test(keins.grund ?? '')) throw new Error('Selbstprobe Git: ohne Git-Verzeichnis muss das gemeldet werden');
  return 9;
}

/**
 * M5: Was heißt „keine Basis“? Bei `pull_request` in der CI ist es ein Befund (rot), sonst ein lauter Hinweis „OHNE Basis“.
 * `umgebung` = process.env (parametrisiert für die Selbstprobe).
 */
export function bewerteBasis(basis, grund, umgebung) {
  if (basis) return { befunde: [], hinweise: [] };
  const ohne = `OHNE Basis (${grund ?? 'unbekannt'}): das Gedächtnis (M5) wurde NICHT geprüft`;
  if (umgebung.GITHUB_ACTIONS === 'true' && ['pull_request', 'pull_request_target', 'merge_group'].includes(umgebung.GITHUB_EVENT_NAME)) {
    return { befunde: [`M5 in der CI bei ${umgebung.GITHUB_EVENT_NAME} ohne Basis: ${ohne}. Basis holen (GITHUB_BASE_REF=${umgebung.GITHUB_BASE_REF ?? '?'}) oder den Lauf wiederholen.`], hinweise: [] };
  }
  return { befunde: [], hinweise: [ohne] };
}

/**
 * M5: Der Runner zeigt die Ausgabe erfolgreicher Tests nicht. In der CI (GITHUB_ACTIONS=true) melden wir die Kennzeilen deshalb
 * zusätzlich (a) in die Job-Zusammenfassung (GITHUB_STEP_SUMMARY) und (b) als Workflow-Befehle (`::notice::`) auf den stderr des
 * Runners `run-tests.mjs`, den wir über die Elternkette in /proc finden. `ziel` und `umgebung` sind für die Selbstprobe einsetzbar.
 * Gibt zurück, wohin gemeldet wurde ([] = nirgends).
 */
export function meldeAnCi(zeilen, umgebung, ziel = {}) {
  const wohin = [];
  if (umgebung.GITHUB_ACTIONS !== 'true') return wohin;
  const kurz = (t) => t.replace(/\p{Cc}/gu, ' ').replace(/%/g, '%25');
  const befehle = zeilen.map((z) => `::${z.art} title=pruefe-groessen::${kurz(z.text)}\n`).join('');
  const summary = umgebung.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      (ziel.anhaengen ?? appendFileSync)(summary, `#### pruefe-groessen\n${zeilen.map((z) => `- ${z.text}`).join('\n')}\n`);
      wohin.push('summary');
    } catch {
      /* nicht schreibbar */
    }
  }
  try {
    const fd = ziel.runnerStderr ?? runnerStderr();
    if (typeof fd === 'string') appendFileSync(fd, befehle);
    else if (fd !== null && fd !== undefined) writeSync(fd, befehle);
    if (fd !== null && fd !== undefined) wohin.push('runner-stderr');
  } catch {
    /* kein Runner gefunden */
  }
  return wohin;
}

/** Sucht in der Elternkette den Prozess, dessen Kommandozeile `run-tests.mjs` enthält, und öffnet dessen stderr (/proc/<pid>/fd/2). */
function runnerStderr() {
  let pid = process.ppid;
  for (let i = 0; i < 8 && pid > 1; i++) {
    let cmd = '';
    try {
      cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      return null;
    }
    if (cmd.includes('run-tests.mjs')) return openSync(`/proc/${pid}/fd/2`, 'a');
    try {
      pid = Number(/^\d+ \(.*\) \S (\d+) /.exec(readFileSync(`/proc/${pid}/stat`, 'utf8'))?.[1]);
    } catch {
      return null;
    }
  }
  return null;
}

// ── Aufruf ───────────────────────────────────────────────────────────────────────────────────

function haupt(argv) {
  let wurzel = resolve(HIER, '..');
  let basisRef;
  for (const a of argv) {
    if (a.startsWith('--wurzel=')) wurzel = resolve(a.slice('--wurzel='.length));
    else if (a.startsWith('--basis=')) basisRef = a.slice('--basis='.length);
    else {
      console.error(`pruefe-groessen: unbekanntes Argument "${a}" (erlaubt: --wurzel=<ordner>, --basis=<git-ref>; der Wert steht hinter dem Gleichheitszeichen)`);
      return 2;
    }
  }
  let fallzahl;
  try {
    fallzahl = selbstprobe();
  } catch (e) {
    console.error(`pruefe-groessen: Selbstprobe ROT — der Prüfer würde etwas übersehen.\n${e.message}`);
    return 1;
  }
  const { basis, grund, hinweis: basisHinweis } = findeBasis(wurzel, basisRef);
  const { befunde, hinweise, laut, zahlen } = pruefe(wurzel, basis);
  const bew = bewerteBasis(basis, grund, process.env);
  hinweise.push(...bew.hinweise);
  if (basisHinweis) hinweise.push(basisHinweis);
  befunde.push(...bew.befunde);
  const kopf = `pruefe-groessen: Vergleich ${basis ? `MIT Basis ${basis.name}` : 'OHNE Basis'}${basis && !basis.grenzen ? ' (Basis kennt die Grenzdatei noch nicht)' : ''}`;
  const zeilen = [{ art: befunde.length ? 'error' : basis ? 'notice' : 'warning', text: `${kopf}; ${zahlen.dateien} Dateien, ${zahlen.liste} Einträge, Selbstprobe ${fallzahl} Fälle` }];
  for (const h of hinweise) zeilen.push({ art: /Basis|Gedächtnis|OHNE/.test(h) ? 'warning' : 'notice', text: `Hinweis: ${h}` });
  for (const l of laut) zeilen.push({ art: 'warning', text: `BEGRÜNDUNG (in den PR-Text): ${l}` });
  for (const z of zeilen) console.log(`${z.text}`);
  meldeAnCi(zeilen, process.env);
  if (befunde.length === 0) {
    console.log(`pruefe-groessen: grün (${zahlen.dateien} Dateien gezählt, ${zahlen.liste} Einträge in ${GRENZEN_DATEI}, Basis ${basis ? basis.name : 'keine'}, Selbstprobe ${fallzahl} Fälle grün).`);
    return 0;
  }
  console.error(`pruefe-groessen: ${befunde.length} Befund(e):\n${befunde.map((b) => `  - ${b}`).join('\n')}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(haupt(process.argv.slice(2)));
