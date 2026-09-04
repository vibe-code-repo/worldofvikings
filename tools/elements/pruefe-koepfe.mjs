// Prüft: dass jede Datei unter tools/elements/ ihre Kopfzeile trägt.
//
// ── Warum es diesen Wächter gibt ─────────────────────────────────────
// Der Ordner soll auf einen Blick beantworten, was ein Skript tut. Diese
// Auskunft verfällt still: Wer eine Datei dazulegt, merkt nichts, wenn er
// die Kopfzeile weglässt — es bricht nichts, es fällt niemandem auf, und
// nach zwanzig Dateien ist die Konvention nur noch eine Behauptung im
// README. Deshalb steht sie hier als Prüfer und nicht als Bitte.
//
// Die Regel: Die erste KOMMENTARZEILE einer Datei beginnt mit genau einem
// der drei Wörter `Erzeugt:` · `Prüft:` · `Hilfsmittel:`. Eine
// Shebang-Zeile davor zählt nicht mit — sie ist eine Anweisung an das
// Betriebssystem, keine Auskunft an den Leser.
//
// Der Prüfer liest ausschliesslich Text: kein `assets/`, kein Blender,
// keine GPU, keine Netzverbindung. Damit gehört er in die schnelle
// Kernliste von `scripts/run-tests.mjs` und läuft auch im CI-Checkout,
// in dem die Modelle fehlen.
//
// Guards the header convention of tools/elements/ — text only, no assets.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = dirname(fileURLToPath(import.meta.url));

const WOERTER = ['Erzeugt:', 'Prüft:', 'Hilfsmittel:'];

// Quelltexturen sind EINGABE, kein Rezept — ein PNG kann keine Kopfzeile
// tragen. Der Ordner ist deshalb als Ganzes ausgenommen, nicht die
// Endung: so fällt eine versehentlich dort abgelegte `.py` trotzdem auf.
const AUSGENOMMEN = ['pipeline/quellen'];

const ENDUNGEN = new Set(['.py', '.sh', '.mjs', '.js', '.ts', '.md']);

/** Alle prüfbaren Dateien unterhalb von `tools/elements/`. */
function dateien(ordner) {
  const gefunden = [];
  for (const eintrag of readdirSync(ordner).sort()) {
    const pfad = join(ordner, eintrag);
    const rel = relative(WURZEL, pfad).split('\\').join('/');
    if (AUSGENOMMEN.includes(rel)) continue;
    if (statSync(pfad).isDirectory()) {
      gefunden.push(...dateien(pfad));
    } else if (ENDUNGEN.has(extname(eintrag))) {
      gefunden.push(pfad);
    }
  }
  return gefunden;
}

/*
  Die erste Kommentarzeile herausschälen.

  Absichtlich stumpf statt sprachbewusst: Die Marken `#`, `//`, `*`, `/**`
  und `<!--` decken alle fünf Dateiarten dieses Ordners ab, und ein
  Prüfer, der die Sprache zu verstehen versucht, wird selbst zur
  Fehlerquelle. Leerzeilen und eine Rahmenzeile wie `/**` werden
  übersprungen, damit ein Block-Kommentar seinen Kopf in Zeile 2 haben
  darf.
*/
function ersteKommentarzeile(text) {
  const zeilen = text.split('\n');
  let i = 0;
  if (zeilen[0]?.startsWith('#!')) i = 1; // Shebang ist keine Auskunft
  for (; i < Math.min(zeilen.length, 12); i++) {
    let z = zeilen[i].trim();
    if (z === '') continue;
    const vorher = z;
    z = z
      .replace(/^<!--/, '')
      .replace(/^\/\*\*?/, '')
      .replace(/^\/\//, '')
      .replace(/^#/, '')
      .replace(/^\*/, '')
      .trim();
    if (z === '') {
      // Reine Rahmenzeile (`/**`, `#`) — weitersuchen.
      if (vorher === z) return null;
      continue;
    }
    return z;
  }
  return null;
}

const alle = dateien(WURZEL);
const fehlend = [];
for (const pfad of alle) {
  const kopf = ersteKommentarzeile(readFileSync(pfad, 'utf-8'));
  if (kopf === null || !WOERTER.some((w) => kopf.startsWith(w))) {
    fehlend.push([relative(WURZEL, pfad), kopf]);
  }
}

console.log(`Kopfzeilen-Wächter: ${alle.length} Dateien unter tools/elements/ geprüft.`);

// Ein leerer Lauf ist kein Bestehen: Findet der Prüfer nichts, misst er
// nichts — und ein Prüfer, der nichts misst, ist immer grün.
if (alle.length === 0) {
  console.log('FEHLGESCHLAGEN: keine Datei gefunden — der Prüfer misst nichts.');
  process.exit(1);
}

if (fehlend.length > 0) {
  console.log(`FEHLGESCHLAGEN: ${fehlend.length} Datei(en) ohne Kopfzeile.`);
  console.log(`Erwartet als erste Kommentarzeile: ${WOERTER.join(' | ')}`);
  for (const [pfad, kopf] of fehlend) {
    console.log(`  FAIL ${pfad} — gefunden: ${kopf === null ? '(keine Kommentarzeile)' : `„${kopf.slice(0, 60)}"`}`);
  }
  process.exit(1);
}

console.log(`OK: alle ${alle.length} Dateien tragen Erzeugt:/Prüft:/Hilfsmittel:.`);
