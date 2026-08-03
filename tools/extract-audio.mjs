#!/usr/bin/env node
/**
 * Holt die Spiel-Sounds aus dem AssetRipper-Export nach `assets/audio/`.
 *
 * `assets/` ist gitignored, die Dateien liegen also nicht im Repo — nach
 * einem frischen Checkout einmal ausführen:
 *
 *     node tools/extract-audio.mjs
 *
 * Der eigentliche Wert steckt in der Zuordnung unten: Welcher Klang zu
 * welcher Spielsituation gehört, sieht man dem Dateinamen nicht immer an,
 * und danebengreifen fällt erst im Spiel auf.
 *
 * ── Gelernt am 2026-08-03 ────────────────────────────────────────────
 * Die Schritte klangen, "als würde man durch Wasser laufen". Per
 * MD5-Abgleich gegen den Export zeigte sich, woher sie stammten:
 *
 *     schritt1..3.ogg  =  Player_Footstep_Tar_Land_M_01..03.ogg
 *
 * Zweimal daneben in einem Namen: `Tar` ist der TEER der Plains-Gruben —
 * ein zäh-blubberndes Geräusch, das genau nach Wasser klingt. Und `Land`
 * sind Aufprallgeräusche nach einem Sprung, keine Laufschritte. Dabei
 * liegen im Export 16 `Grass_Walk`- und 20 `Grass_Run`-Varianten bereit.
 *
 * Deshalb steht hinter jedem Eintrag, WARUM diese Quelle die richtige
 * ist.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = process.env.VALHEIM_EXPORT ?? join(ROOT, 'tools/assetripper/export/Assets');
const ZIEL = join(ROOT, 'assets/audio');

/**
 * Zielname → Quelldatei(en) im Export.
 *
 * Mehrere Quellen werden durchnummeriert (`schritt_gehen1.ogg`, `…2` …).
 */
const ZUORDNUNG = [
  {
    ziel: 'schritt_gehen',
    // Gras ist der Untergrund, auf dem man in Meadows und Black Forest
    // praktisch immer läuft. Vier der sechzehn Varianten reichen, damit
    // sich der Takt nicht hörbar wiederholt.
    quellen: [1, 2, 3, 4].map((i) => `Player_Footstep_Grass_Walk_M_0${i}.ogg`),
  },
  {
    ziel: 'schritt_rennen',
    // Eigene Aufnahmen fürs Rennen — härter und lauter angesetzt. Nur den
    // Gehschritt schneller abzuspielen klingt nach Trippeln.
    quellen: [1, 2, 3, 4].map((i) => `Player_Footstep_Grass_Run_M_0${i}.ogg`),
  },
  { ziel: 'schwung', quellen: ['Swish_Swing_Baseball_Bat3.ogg'] },
  { ziel: 'pickup', quellen: ['Pickup_Coins01.ogg'] },
  { ziel: 'tuer', quellen: ['heavy_chest_door_close.ogg'] },
];

/** Alle .ogg des Exports einmal indizieren: Basisname → voller Pfad. */
function indiziere(wurzel) {
  const index = new Map();
  const stapel = [wurzel];
  while (stapel.length) {
    const dir = stapel.pop();
    let eintraege;
    try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of eintraege) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stapel.push(p);
      else if (e.name.toLowerCase().endsWith('.ogg') && !index.has(e.name)) index.set(e.name, p);
    }
  }
  return index;
}

if (!existsSync(EXPORT)) {
  console.error(`Export nicht gefunden: ${EXPORT}\nPfad über VALHEIM_EXPORT setzen.`);
  process.exit(1);
}
mkdirSync(ZIEL, { recursive: true });

const index = indiziere(EXPORT);
console.log(`${index.size} .ogg im Export indiziert\n`);

let kopiert = 0;
let fehlend = 0;
for (const { ziel, quellen } of ZUORDNUNG) {
  quellen.forEach((q, i) => {
    const src = index.get(q);
    const name = quellen.length > 1 ? `${ziel}${i + 1}.ogg` : `${ziel}.ogg`;
    if (!src) {
      console.log(`  ⚠ ${name.padEnd(22)} Quelle fehlt: ${q}`);
      fehlend++;
      return;
    }
    const dst = join(ZIEL, name);
    copyFileSync(src, dst);
    const md5 = createHash('md5').update(String(statSync(dst).size)).digest('hex').slice(0, 6);
    console.log(`  ${name.padEnd(22)} ← ${q}  (${(statSync(dst).size / 1024).toFixed(1)} KB, ${md5})`);
    kopiert++;
  });
}
console.log(`\n${kopiert} Dateien nach ${ZIEL}${fehlend ? `, ${fehlend} Quellen fehlen` : ''}`);
console.log('Musik und wind_loop bleiben unberührt — die liegen bereits dort.');
