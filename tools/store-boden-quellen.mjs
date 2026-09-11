#!/usr/bin/env node
/*
  Holt die Boden-Quelltexturen, die NICHT im Asset-Speicher liegen, in
  den Arbeitsbaum: `assets/store-lab/textures/`.

  ── Warum es diesen Schritt gibt ─────────────────────────────────────
  `assets/store` ist ein Symlink auf Mikes Asset-Speicher und für jeden
  Lauf NUR LESBAR. Eine neue Bodentextur kann also nicht dort entstehen
  — sie entsteht hier, in einem erzeugten und gitignorierten Ordner, und
  wandert erst danach (von Hand, per rsync) in den Speicher. Bis dahin
  liefert dieser Schritt sie, und `store-terrain-schichten.mjs` findet
  sie über seinen Suchpfad (Speicher zuerst, dann `store-lab`).

  Dasselbe Muster wie `store-vegetation-aufbereiten.mjs`: Quelle lesen,
  Ergebnis nach `assets/store-lab/`, Repo bleibt sauber.

  ── Woher die Bilder kommen ──────────────────────────────────────────
  Aus einem QUELLBESTAND ausserhalb des Repos. Sein Ort steht in
  `WOV_BODEN_QUELLE` (Vorgabe `~/wov-assets/quellen/boden`), und dort
  liegt auch das Skript, das ihn neu auswertet (`erzeugen.sh`). Der
  Grund für die Trennung: Format und Ort des Bestands gehören dem
  Rechner, auf dem er liegt, und nicht dieser Datei — ein Pfad im Repo
  wäre auf jeder anderen Maschine falsch.

  Mit `--neu` wird `erzeugen.sh` vorher aufgerufen, der Bestand also
  wirklich neu ausgewertet; ohne den Schalter werden die bereits
  erzeugten Dateien übernommen. Beides ist reproduzierbar: `erzeugen.sh`
  liefert für denselben Bestand byteidentische Dateien (nachgemessen am
  11.09.2026, md5 zweier Läufe gleich).

  ── Die Weiche ───────────────────────────────────────────────────────
  Fehlt der Quellbestand GANZ — der Normalfall auf einer Maschine ohne
  ihn, also auch im CI —, meldet der Lauf das und endet mit Code 0. Er
  ist kein Fehler, sondern eine Voraussetzung, die anderswo geprüft
  wird: `store-terrain-schichten.mjs` fällt dann auf die Textur zurück,
  die im Speicher liegt, und schreibt in `store-schichten.json` mit,
  WELCHE es war. Fehlen EINZELNE der genannten Dateien im vorhandenen
  Bestand, ist das ein Befund und der Lauf wird rot.

  ── Was „deterministisch" hier heisst ────────────────────────────────
  Zweiter Lauf = byteidentische Ausgabe. Deshalb wird nicht kopiert,
  sondern mit festen PNG-Einstellungen neu geschrieben (`sharp`, keine
  Zeitstempel, feste Kompression): Ein Bild, das aus einem fremden
  Werkzeug kommt, bringt sonst dessen Metadaten mit, und die können sich
  zwischen zwei Auswertungen ändern, ohne dass sich ein Pixel bewegt.

  Aufruf:
    node tools/store-boden-quellen.mjs          (übernehmen, was da ist)
    node tools/store-boden-quellen.mjs --neu    (Bestand neu auswerten)

  Brings ground source textures that are not in the asset store into
  assets/store-lab/textures/ (the store itself is read-only).
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = join(WURZEL, 'assets/store-lab/textures');
const QUELLE = process.env.WOV_BODEN_QUELLE ?? join(process.env.HOME ?? '', 'wov-assets/quellen/boden');
const NEU = process.argv.includes('--neu');

/**
 * Was geholt wird, und unter welchem Namen es im Labor heisst.
 *
 * Der Zielname folgt der Regel des Speichers (`terrain-<schicht>`), der
 * Quellname der des Bestands. Beide stehen nebeneinander, damit man die
 * Zuordnung nicht raten muss.
 */
const DATEIEN = [
  {
    quelle: 'terrain-rock-moss.png',
    ziel: 'terrain-rock-moss.png',
    zweck: 'Diffuse-Karte des hellen Hangfelses (Tile 5 Cliff)',
  },
];

if (!existsSync(QUELLE)) {
  console.log(
    `[boden-quellen] Quellbestand fehlt (${QUELLE}) — übersprungen.\n` +
      '                Der Boden benutzt dann die Textur aus dem Asset-Speicher;\n' +
      '                store-schichten.json schreibt mit, welche das war.'
  );
  process.exit(0);
}

const fehlt = DATEIEN.filter((d) => !existsSync(join(QUELLE, d.quelle)));
if (NEU) {
  const skript = join(QUELLE, 'erzeugen.sh');
  if (!existsSync(skript)) {
    console.error(`[boden-quellen] --neu, aber ${skript} fehlt`);
    process.exit(2);
  }
  const lauf = spawnSync(skript, [QUELLE], { stdio: 'inherit' });
  if (lauf.status !== 0) {
    console.error(`[boden-quellen] ${skript} endete mit Code ${String(lauf.status)}`);
    process.exit(2);
  }
} else if (fehlt.length > 0) {
  // Der Bestand ist DA, aber unvollständig — das ist ein Befund und kein
  // Umstand. Dieselbe Regel wie bei `brauchtStore()`.
  console.error(
    '[boden-quellen] Der Quellbestand ist unvollständig:\n  ' +
      fehlt.map((d) => join(QUELLE, d.quelle)).join('\n  ') +
      '\n  (mit --neu neu auswerten lassen)'
  );
  process.exit(2);
}

mkdirSync(ZIEL, { recursive: true });
const geschrieben = [];
for (const d of DATEIEN) {
  const von = join(QUELLE, d.quelle);
  const nach = join(ZIEL, d.ziel);
  // Alpha faellt weg: Eine Bodenkachel ist deckend, und ein Alphakanal
  // kostet ein Drittel mehr Speicher fuer eine Spalte aus 255ern.
  const bild = await sharp(von).removeAlpha().png({ compressionLevel: 9, effort: 10 }).toBuffer();
  const alt = existsSync(nach) ? readFileSync(nach) : null;
  if (!alt || !alt.equals(bild)) writeFileSync(nach, bild);
  const info = await sharp(bild).metadata();
  geschrieben.push(`${d.ziel}  ${String(info.width)}×${String(info.height)}  ${(bild.length / 1e6).toFixed(2)} MB  — ${d.zweck}`);
}
console.log(`[boden-quellen] ${ZIEL}\n  ${geschrieben.join('\n  ')}`);
