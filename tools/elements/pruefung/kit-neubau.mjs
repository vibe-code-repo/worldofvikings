#!/usr/bin/env node
// Prüft: einen vollen Neubau aller zwölf DG_StoneVault-Module aus tools/elements/blender gegen die ausgelieferten GLBs unter assets/models.
/*
  S2 (Elemente-Umzug): Der Umzug der Bauskripte ins Repo ist erst dann
  bewiesen, wenn der neue Ort dieselben Dateien liefert wie der alte. Ein
  „läuft durch" genügt dafür nicht — ein Skript, das nach dem Verschieben
  eine andere Textur, ein anderes Pfeilerraster oder einen verschobenen
  Ursprung baut, läuft ebenfalls durch.

  Deshalb misst dieser Prüfer BEIDE Seiten mit demselben Werkzeug
  (`measure-glb.py`) und vergleicht je Modul und je Objekt sechs Felder:
  Dreieckszahl, Eckenzahl, Materialslot, signiertes Volumen, Ursprung und
  Hüllbox. Die fünf Säle bekommen zusätzlich ihre Dreieckszahl aus der
  geschlossenen Formel 12·(2 + 16·cx·cz + 3·P) als wörtliche Erwartung mit —
  damit ein gemeinsamer Fehler auf beiden Seiten (jemand baut neu UND liefert
  neu aus) nicht als Übereinstimmung durchgeht.

  Warum sechs und nicht vier Felder: Die Steingrab-Module sind weitgehend
  x-symmetrisch. Ginge die x-Vorspiegelung am Ende von `make-stonevault.py`
  verloren, blieben Dreieckszahl, Ursprung und Hüllbox unverändert — nur das
  Vorzeichen des signierten Volumens kippt. Und `Kollision` statt
  `StoneVaultStone` im Materialslot macht aus einem sichtbaren Netz ein
  unsichtbares, ohne eine einzige Zahl zu bewegen.

  Aufruf:  node tools/elements/pruefung/kit-neubau.mjs [--behalten]
                                                      [--bauskript=<pfad>]
  `--behalten` lässt den Bauordner stehen (für eine Nachschau von Hand).
  `--bauskript=` baut mit einem ANDEREN Skript. Das ist keine Bequemlichkeit,
  sondern die Zahnprobe: Wer wissen will, ob dieser Prüfer überhaupt rot
  werden kann, kopiert `make-stonevault.py`, verstellt eine Zahl darin und
  lässt ihn gegen die Kopie laufen. Ein Prüfer, der beim ersten Lauf grün ist
  und nie anders gesehen wurde, ist eine Behauptung, kein Nachweis.

  ACHTUNG Bauordner unter $HOME, NICHT unter /tmp. Flatpak gibt jeder App ein
  EIGENES /tmp — auch bei `filesystems=host` (nachgesehen mit
  `flatpak info --show-permissions org.blender.Blender`). Ein Bau nach /tmp
  meldet fröhlich „MODUL OK", und auf dem Host ist der Ordner danach leer.
  Das ist der teuerste Fall: kein Fehler, kein Ergebnis.

  Braucht Blender (Flatpak) UND assets/models. Fehlt eines von beidem, ist
  das hier ROT und nicht „bestanden" — die Weiche gehört in den Testlauf,
  nicht in die Sonde (Muster scripts/run-tests.mjs).
*/
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../../..');
const EIGEN = process.argv.find((a) => a.startsWith('--bauskript='));
const BAUSKRIPT = EIGEN
  ? resolve(EIGEN.slice('--bauskript='.length))
  : join(HIER, '..', 'blender', 'make-stonevault.py');
const MESSER = join(HIER, 'measure-glb.py');
const AUSGELIEFERT = join(WURZEL, 'assets', 'models');
const BEHALTEN = process.argv.includes('--behalten');

// Die zwölf Module des Kits, in der Reihenfolge von `BAUER` in make-stonevault.py.
// Die fünf Säle tragen ihre Dreieckszahl aus der Formel 12·(2 + 16·cx·cz + 3·P)
// mit (Konzeptnotiz, Befund A) — sie ist der einzige Wert hier, der NICHT aus
// einer der beiden gemessenen Seiten stammt.
const MODULE = [
  ['StoneVaultCell', null],
  ['StoneVaultWall', null],
  ['StoneVaultArch', null],
  ['StoneVaultCorridor', null],
  ['StoneVaultCorner', null],
  ['StoneVaultJunction', null],
  ['StoneVaultHall', 792],
  ['StoneVaultHallLarge', 1896],
  ['StoneVaultHallLong', 1668],
  ['StoneVaultHallGrand', 3132],
  ['StoneVaultHallVast', 7080],
  ['StoneVaultStairs', null],
];

let fehler = 0;
const meckern = (text) => {
  fehler += 1;
  console.log(`FEHLER ${text}`);
};

if (!existsSync(BAUSKRIPT)) throw new Error(`Bauskript fehlt: ${BAUSKRIPT}`);
if (!existsSync(MESSER)) throw new Error(`Messskript fehlt: ${MESSER}`);

/* Dieselbe Falle wie beim Bauordner, nur an der anderen Seite: Blender im
   Flatpak sieht ein eigenes /tmp, also auch ein anderes als das, in dem hier
   eine Datei liegen mag. Uebergibt jemand `--bauskript=/tmp/...`, findet
   Blender die Datei nicht — und beendet sich mit Code 0. Der Prüfer wird
   dadurch zwar rot ("0 GLB gebaut"), aber mit einer Meldung, die auf einen
   kaputten Bau zeigt statt auf einen unerreichbaren Pfad. Nachgemessen am
   04.09.2026: genau so passiert. Deshalb hier vorweg und im Klartext. */
for (const [zweck, pfad] of [['Bauskript', BAUSKRIPT], ['Messskript', MESSER]]) {
  if (!pfad.startsWith(`${homedir()}/`)) {
    throw new Error(
      `${zweck} liegt ausserhalb von ${homedir()}: ${pfad}\n` +
        'Blender laeuft im Flatpak und sieht dort nichts (eigenes /tmp). ' +
        'Datei unter $HOME ablegen.',
    );
  }
}
for (const [name] of MODULE) {
  if (!existsSync(join(AUSGELIEFERT, `${name}.glb`))) {
    throw new Error(`Ausgeliefertes Modul fehlt: assets/models/${name}.glb`);
  }
}

function blender(skript, argumente) {
  const r = spawnSync(
    'flatpak',
    ['run', 'org.blender.Blender', '--background', '--factory-startup', '--python', skript, '--', ...argumente],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  if (r.error) throw new Error(`Blender liess sich nicht starten: ${r.error.message}`);
  if (r.status !== 0) {
    console.log(r.stdout ?? '');
    console.log(r.stderr ?? '');
    throw new Error(`Blender endete mit Code ${r.status}: ${skript}`);
  }
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

/* Liest die maschinenlesbaren KENNZAHL-Zeilen von measure-glb.py.
   Schlüssel ist Datei + Objektname, damit auch das `_col`-Netz der Treppe
   mitverglichen wird und nicht in einer Summe verschwindet. */
function messen(pfade) {
  const text = blender(MESSER, pfade);
  const gemessen = new Map();
  for (const zeile of text.split('\n')) {
    const t = zeile.trim();
    if (!t.startsWith('KENNZAHL ')) continue;
    const teile = t.slice('KENNZAHL '.length).split(/\s+/);
    const [datei, objekt, ...felder] = teile;
    const werte = {};
    for (const f of felder) {
      const i = f.indexOf('=');
      if (i > 0) werte[f.slice(0, i)] = f.slice(i + 1);
    }
    gemessen.set(`${datei}|${objekt}`, werte);
  }
  return gemessen;
}

// s. Kopfkommentar: unter $HOME, weil Blender im Flatpak ein eigenes /tmp hat.
const BAUBASIS = join(homedir(), '.cache');
mkdirSync(BAUBASIS, { recursive: true });
const ordner = mkdtempSync(join(BAUBASIS, 'wov-kit-neubau-'));
try {
  console.log(`[neubau] baue zwölf Module nach ${ordner}`);
  if (EIGEN) console.log(`[neubau] Bauskript ersetzt: ${BAUSKRIPT}`);
  const bau = blender(BAUSKRIPT, [ordner]);
  if (!bau.includes('ALLE STONEVAULT-MODULE FERTIG')) {
    meckern('make-stonevault.py meldete keinen vollständigen Lauf');
  }
  const gebaut = readdirSync(ordner).filter((d) => d.endsWith('.glb')).sort();
  console.log(`[neubau] ${gebaut.length} GLB gebaut: ${gebaut.join(', ')}`);
  if (gebaut.length !== MODULE.length) {
    meckern(`${gebaut.length} GLB gebaut, erwartet ${MODULE.length}`);
  }

  const neu = messen(MODULE.map(([n]) => join(ordner, `${n}.glb`)));
  const alt = messen(MODULE.map(([n]) => join(AUSGELIEFERT, `${n}.glb`)));
  console.log(`[neubau] gemessen: ${neu.size} Objekte neu, ${alt.size} Objekte ausgeliefert`);

  // Leerlauf-Falle: misst der Messer nichts, ist das ein Fehlschlag und
  // kein stiller Erfolg (dieselbe Regel wie bei der Kantensonde).
  if (neu.size === 0 || alt.size === 0) {
    meckern('measure-glb.py lieferte keine KENNZAHL-Zeilen — nichts gemessen');
  }
  if (neu.size !== alt.size) {
    meckern(`Objektzahl verschieden: neu ${neu.size}, ausgeliefert ${alt.size}`);
  }

  for (const [name, erwarteteTris] of MODULE) {
    const objekteNeu = [...neu.keys()].filter((k) => k.startsWith(`${name}.glb|`)).sort();
    const objekteAlt = [...alt.keys()].filter((k) => k.startsWith(`${name}.glb|`)).sort();
    if (objekteNeu.length === 0) {
      meckern(`${name}: nichts gemessen`);
      continue;
    }
    if (objekteNeu.join(',') !== objekteAlt.join(',')) {
      meckern(`${name}: andere Objekte — neu [${objekteNeu}] vs. alt [${objekteAlt}]`);
      continue;
    }
    let trisModul = 0;
    for (const schluessel of objekteNeu) {
      const a = alt.get(schluessel);
      const b = neu.get(schluessel);
      trisModul += Number(b.tris);
      for (const feld of ['tris', 'verts', 'mat', 'volumen', 'ursprung', 'bbox']) {
        if (a[feld] !== b[feld]) {
          meckern(`${schluessel}: ${feld} neu ${b[feld]} != ausgeliefert ${a[feld]}`);
        }
      }
    }
    const sichtbar = objekteNeu
      .filter((k) => !k.endsWith('_col'))
      .reduce((s, k) => s + Number(neu.get(k).tris), 0);
    console.log(
      `[neubau] ${name.padEnd(22)} tris=${String(trisModul).padStart(5)} ` +
        `(sichtbar ${sichtbar}) objekte=${objekteNeu.length} ` +
        `vol=${neu.get(objekteNeu[0]).volumen} bbox=${neu.get(objekteNeu[0]).bbox}`,
    );
    if (erwarteteTris !== null && sichtbar !== erwarteteTris) {
      meckern(`${name}: ${sichtbar} sichtbare Dreiecke, Formel verlangt ${erwarteteTris}`);
    }
  }
} finally {
  if (BEHALTEN) console.log(`[neubau] Temp-Ordner bleibt stehen: ${ordner}`);
  else rmSync(ordner, { recursive: true, force: true });
}

if (fehler > 0) {
  console.log(`\nKIT-NEUBAU ROT — ${fehler} Abweichung(en).`);
  process.exit(1);
}
console.log('\nKIT-NEUBAU OK — zwölf Module; Dreiecke, Ecken, Material, Volumen, Ursprung und Hüllbox gleich der Auslieferung.');
