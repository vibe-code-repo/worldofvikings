#!/usr/bin/env node
// Prüft: dass jeder Pfad in tools/README.md und tools/elements/README.md wirklich da ist und keine Datei dieses Ordners unerwähnt bleibt.
/*
  S4 (Elemente-Umzug). Die beiden README sind das einzige Verzeichnis der
  Werkbank — `tools/README.md` gibt sich die Regel selbst („Wer `tools/` um
  ein Skript erweitert, ergänzt in derselben Änderung eine Zeile in dieser
  Datei"). Eine Regel ohne Prüfer ist eine Bitte, und diese hier verfällt
  besonders leise, weil ein README nie ausgeführt wird:

    - Ein VERSCHOBENES Skript hinterlässt einen toten Pfad. Nichts bricht,
      der Text liest sich weiterhin richtig, und wer ihn benutzt, findet die
      Datei nicht.
    - Ein NEUES Skript hinterlässt eine Lücke. Auch das bricht nichts; es
      führt nur dazu, dass beim nächsten Mal jemand ein Werkzeug schreibt,
      das es längst gibt.

  Beides war da, als dieser Wächter zum ersten Mal lief: NEUN tote Pfade
  (darunter `tools/stonevault-kantensonde.ts`, der Ort vor dem `git mv`, und
  zwei Skripte aus Vorhaben 1, die es noch gar nicht gibt) und SECHS
  unerwähnte Dateien. Kein einziger davon hätte je jemanden gestört — das
  ist der Punkt.

  Der Wächter hält deshalb beide Richtungen fest, und beide sind nötig:
  Ein README ohne tote Pfade kann trotzdem die Hälfte des Ordners
  verschweigen, und ein vollständiges README kann trotzdem ins Leere zeigen.

    (1) Jeder Pfad, den eine der beiden Dateien nennt, existiert.
    (2) Jede Datei unter `tools/elements/` wird mindestens einmal genannt.

  Als Pfad gilt, was in einer Code-Spanne (`…`) oder als Ziel eines
  Markdown-Links steht und wie ein Pfad aussieht: mit `/` darin oder als
  blosser Dateiname mit bekannter Endung. Platzhalter (`<skript>`, `*`),
  Umgebungsvariablen (`$WOV_MODELLE`), Heimatpfade (`~/…`) und absolute
  Pfade (`/ws`) bleiben aussen vor — sie sind keine Repo-Pfade, und ein
  Wächter, der sie zu deuten versucht, wird selbst zur Fehlerquelle.

  Der Prüfer liest ausschliesslich Text: kein `assets/`, kein Blender, keine
  GPU, keine Netzverbindung — wie seine zwei Nachbarn aus S1 und S2 gehört
  er damit in die schnelle Kernliste von `scripts/run-tests.mjs`.

  Aufruf:  node tools/elements/pruefe-readme.mjs [wurzel]
  `wurzel` zeigt auf einen anderen Baum (z. B. einen Auszug aus git). Damit
  lässt sich nachweisen, dass der Wächter überhaupt rot werden kann — ohne
  ihn ist „grün" nur eine Behauptung.

  Guards both README files of the tool bench: no dead path, no unlisted file.
*/
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(process.argv[2] ?? join(HIER, '..', '..'));

const READMES = ['tools/README.md', 'tools/elements/README.md'];
const ELEMENTE = 'tools/elements';

// Beim Durchsuchen nach blossen Dateinamen: alles, was nicht Quelltext des
// Projekts ist. `assets/models` ist ein Symlink auf die gemeinsamen GLBs und
// bleibt bewusst drin — `tools/README.md` nennt Modelle beim Namen.
const UEBERGEHEN = new Set(['node_modules', '.git', 'dist', 'dist.neu', 'build', 'out', 'preview', '.cache']);

// Endungen, bei denen ein Wort OHNE Schrägstrich noch als Datei gilt. Ohne
// diese Liste wäre jedes `MODELL_ALIAS` ein Pfad und der Wächter Lärm.
const ENDUNGEN = new Set([
  '.py', '.sh', '.mjs', '.js', '.cjs', '.ts', '.mts', '.tsx', '.md',
  '.json', '.png', '.yml', '.txt', '.glb', '.conf',
]);

/*
  ERGEBNIS, nicht Rezept — davon darf der Wächter nichts verlangen.

  `tools/README.md` gibt die Regel im ersten Absatz selbst: „Alles unter
  `tools/` ist Rezept, nicht Ergebnis. Die erzeugten Dateien liegen unter
  `assets/` und sind gitignored." Genau deshalb gibt es S3: `assets/` liegt
  ausserhalb des Repos, im CI-Checkout fehlt es ganz, und in diesem
  Arbeitsbaum zeigt es nur auf den Dungeon-Ausschnitt. Ein Wächter, der die
  Existenz eines erzeugten PNG verlangt, wäre auf jeder zweiten Maschine rot
  und würde dort das Falsche behaupten.

  Zwei Formen: der Ordner am Anfang (`assets/…`, `out/…`) und der blosse
  Name eines Bildes oder Modells (`water_normals_real.png`) — beides nennt
  ein Ergebnis. Quelltexturen, die im Repo liegen, werden deshalb in der
  README MIT ihrem Ordner geschrieben (`pipeline/quellen/stein_albedo.png`);
  dann sind sie ein Pfad und werden geprüft.
*/
const ERGEBNIS_ORDNER = ['assets/', 'out/', 'preview/'];
const ERGEBNIS_ENDUNGEN = new Set(['.png', '.glb', '.jpg', '.jpeg']);

function istErgebnis(w) {
  if (ERGEBNIS_ORDNER.some((o) => w.startsWith(o))) return true;
  return !w.includes('/') && ERGEBNIS_ENDUNGEN.has(extname(w));
}

// Dateien unter tools/elements/, die genannt sein müssen. Dieselbe
// Endungsliste wie beim Kopfzeilen-Wächter, plus die Quelltexturen: ein PNG
// kann keine Kopfzeile tragen, im Verzeichnis stehen muss es trotzdem.
const ZU_NENNEN = new Set(['.py', '.sh', '.mjs', '.js', '.ts', '.md', '.png']);

/** Alle Dateien unter `ordner`, rekursiv, absolute Pfade. */
function dateien(ordner, raus = []) {
  for (const eintrag of readdirSync(ordner).sort()) {
    if (UEBERGEHEN.has(eintrag)) continue;
    const pfad = join(ordner, eintrag);
    let st;
    try { st = statSync(pfad); } catch { continue; } // toter Symlink
    if (st.isDirectory()) dateien(pfad, raus);
    else raus.push(pfad);
  }
  return raus;
}

/*
  Die Kandidaten aus einer Markdown-Datei schälen.

  Nur Code-Spannen und Link-Ziele — Fliesstext ist Prosa, und ein Wächter,
  der in Prosa nach Pfaden sucht, findet Sätze. Umgekehrt gilt: Wer einen
  Pfad nennt, setzt ihn in beiden README bereits in Backticks; das ist die
  bestehende Schreibweise, nicht eine neue Auflage.

  Eine Code-Spanne kann eine ganze Befehlszeile sein (`node tools/x.mjs y`).
  Deshalb wird an Leerzeichen zerlegt und jedes Wort einzeln beurteilt.
*/
function kandidaten(text) {
  const roh = [];
  for (const [, inhalt] of text.matchAll(/`([^`\n]+)`/g)) roh.push(...inhalt.split(/\s+/));
  for (const [, ziel] of text.matchAll(/\]\(([^)\s]+)\)/g)) roh.push(ziel);
  return roh;
}

/** Zierrat abstreifen: Satzzeichen, Zeilenangaben wie `:59-61`, Schluss-`/`. */
function saeubern(wort) {
  let w = wort.trim();
  w = w.replace(/^[("„'*]+/, '').replace(/[)"“',.;:*]+$/, '');
  w = w.replace(/:\d+(-\d+)?$/, ''); // `dungeonRasterModul.ts:1-3`
  w = w.replace(/\/+$/, '');
  return w;
}

/*
  Sieht das Wort nach einem Pfad in DIESEM Repo aus?

  Der Schrägstrich allein reicht nicht: Beide README kürzen Bezeichner damit
  ab (`scaleMin/Max`, `movementX/Y`), und das ist gute Prosa, kein Pfad. Ein
  Wort mit Schrägstrich gilt deshalb nur dann als Pfad, wenn sein letztes
  Stück eine bekannte Endung trägt ODER alle Stücke wie Ordnernamen aussehen
  — klein geschrieben. Genau daran scheitert `Max`, und genau das ist der
  Unterschied zwischen einem Ordner und einer Aufzählung von Feldnamen.
*/
const ORDNERSTUECK = /^[a-z0-9_.+-]+$/;

function istPfadKandidat(w) {
  if (w === '' || w === '.' || w === '..') return false;
  if (/[<>*?|`]/.test(w)) return false;          // Platzhalter, Muster
  if (/^[$~/@-]/.test(w)) return false;          // $VAR, ~/…, /ws, @wov/shared, --flag
  if (w.includes('://')) return false;           // URL
  if (!w.includes('/')) return ENDUNGEN.has(extname(w));
  if (ENDUNGEN.has(extname(w))) return true;
  return w.split('/').every((s) => ORDNERSTUECK.test(s));
}

const alleDateien = dateien(WURZEL);

// Namensverzeichnis für blosse Dateinamen. Ein Name kann mehrfach vorkommen
// (`README.md`); dann zählt jeder Treffer als genannt — der Wächter soll
// Löcher finden, nicht Mehrdeutigkeiten erfinden.
const nachName = new Map();
for (const p of alleDateien) {
  const n = basename(p);
  if (!nachName.has(n)) nachName.set(n, []);
  nachName.get(n).push(p);
}

/**
 * Auflösen. Ein Wort mit `/` ist wurzelrelativ, sonst relativ zum Ordner der
 * nennenden README — genau so liest ein Mensch die Tabelle. Ein blosser
 * Dateiname wird über das Namensverzeichnis gesucht.
 * Rückgabe: Liste der getroffenen Dateien (leer = toter Pfad).
 */
function aufloesen(wort, readmeOrdner) {
  if (wort.includes('/')) {
    for (const basis of [WURZEL, readmeOrdner]) {
      const p = resolve(basis, wort);
      if (existsSync(p)) return [p];
    }
    return [];
  }
  return nachName.get(wort) ?? [];
}

const tote = [];
const genannt = new Set();
let gesehen = 0;
let uebergangen = 0;

for (const readme of READMES) {
  const pfad = join(WURZEL, readme);
  if (!existsSync(pfad)) {
    tote.push([readme, readme, 'die README selbst fehlt']);
    continue;
  }
  const ordner = dirname(pfad);
  const text = readFileSync(pfad, 'utf8');
  const zeilen = text.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    for (const roh of kandidaten(zeilen[i])) {
      const w = saeubern(roh);
      if (!istPfadKandidat(w)) continue;
      if (istErgebnis(w)) { uebergangen += 1; continue; }
      gesehen += 1;
      const treffer = aufloesen(w, ordner);
      if (treffer.length === 0) tote.push([`${readme}:${i + 1}`, w, 'kein solcher Pfad']);
      else for (const t of treffer) genannt.add(t);
    }
  }
}

// Die Gegenrichtung: was liegt hier, ohne im Verzeichnis zu stehen?
// Fehlt der Ordner ganz, ist das eine Aussage über die Wurzel, kein Absturz:
// Der Wächter wird rot und sagt, wo er gesucht hat.
if (!existsSync(join(WURZEL, ELEMENTE))) {
  console.log(`README-WÄCHTER ROT — ${ELEMENTE}/ gibt es unter ${WURZEL} nicht.`);
  process.exit(1);
}
const pflicht = dateien(join(WURZEL, ELEMENTE)).filter((p) => ZU_NENNEN.has(extname(p)));
const ungenannt = pflicht.filter((p) => !genannt.has(p));

console.log(
  `README-Wächter: ${gesehen} geprüfte Pfadangabe(n) (+${uebergangen} Ergebnis-Pfade übergangen) ` +
  `in ${READMES.length} Dateien, ${pflicht.length} Datei(en) unter ${ELEMENTE}/.`,
);

/*
  Leerlauf-Fallen. Beide Zahlen dürfen nicht null sein: Ein Wächter, der
  keine Pfade findet (falsche Wurzel, umbenannte README) oder keine Dateien
  (leerer Ordner), misst nichts — und würde sonst grün melden.
*/
if (gesehen === 0 || pflicht.length === 0) {
  console.log(`README-WÄCHTER ROT — nichts zu messen (Pfadangaben ${gesehen}, Dateien ${pflicht.length}) unter ${WURZEL}.`);
  process.exit(1);
}

if (tote.length > 0) {
  console.log(`\n${tote.length} tote(r) Pfad(e):`);
  for (const [wo, was, grund] of tote) console.log(`  FAIL ${wo}: „${was}" — ${grund}`);
}
if (ungenannt.length > 0) {
  console.log(`\n${ungenannt.length} Datei(en) in keinem README genannt:`);
  for (const p of ungenannt) console.log(`  FAIL ${relative(WURZEL, p)}`);
}

if (tote.length > 0 || ungenannt.length > 0) {
  console.log(`\nREADME-WÄCHTER ROT — ${tote.length} toter Pfad, ${ungenannt.length} unerwähnte Datei(en).`);
  process.exit(1);
}

console.log(`README-WÄCHTER OK — kein toter Pfad, alle ${pflicht.length} Dateien unter ${ELEMENTE}/ genannt.`);
