/**
 * F17 — Figurenwahl (Wikinger / Wikingerin).
 *
 * Geprueft wird das, was beim Spielen schiefgehen kann, nicht die
 * Datenstruktur:
 *
 *  [1] Die gemeinsame Liste: Kennungen eindeutig, Modellnamen OHNE
 *      Endung (der AssetManager haengt sie an — mit Endung entstuende
 *      `PlayerAvatar.glb.glb` und ein 404, den man erst am fehlenden
 *      Modell im Spiel bemerkt; genau das ist am 22.08.2026 in der
 *      ersten Fassung passiert), und zu JEDER Kennung liegt die Datei
 *      wirklich unter assets/models/.
 *  [2] Die Pruefung: Der Server glaubt dem Client nicht. Unbekanntes,
 *      Leerstring, Pfadtricks und Nicht-Strings fallen durch.
 *  [3] Der Rueckfall: Eine Kennung, die es nicht mehr gibt, darf einen
 *      alten Spielstand NICHT unbrauchbar machen — figurZu() liefert
 *      dann die Vorgabe statt zu werfen.
 *
 * Der Weg ueber das Netz (SetFigur -> ZDO-Member -> anderer Client)
 * ist mit zwei echten Browsern abgenommen, nicht hier: Er braucht einen
 * laufenden Client, und ein Test, der Playwright startet, gehoert nicht
 * in die Kernliste.
 *
 * Run: npx tsx server/test/f17-figurenwahl.ts   (from the repo root)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  FIGUREN,
  FIGUR_MEMBER,
  FIGUR_VORGABE,
  figurZu,
  istFigur,
  modellDateiZu,
  modellZu,
} from '@wov/shared';

/**
 * Repo-Wurzel aus dem eigenen Pfad ableiten, NICHT aus process.cwd().
 * Der Testlaeufer startet die Server-Tests im Workspace-Verzeichnis, von
 * Hand startet man sie aus der Wurzel — mit cwd waere derselbe Test
 * einmal gruen und einmal rot, und genau das ist beim ersten vollen Lauf
 * am 22.08.2026 passiert.
 */
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fehler = 0;

function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

console.log('\n[1] Die gemeinsame Liste');
const kennungen = FIGUREN.map((f) => f.id);
// Geprueft wird, dass die Liste NICHT LEER ist — nicht, dass sie eine
// Auswahl bietet. Hier stand ">= 2", weil es zeitweise drei Figuren gab
// (wikinger, wikingerin, walkuere). Gepflegt wurde davon nur die
// Wikingerin; die beiden anderen hatten weder das vollstaendige Rig noch
// Frisuren oder Ruestung und wurden am 22.08.2026 entfernt. Eine
// Auswahl vorzutaeuschen, hinter der nichts steht, ist schlechter als
// eine ehrliche Figur.
pruefe('mindestens eine Figur', FIGUREN.length >= 1, `${FIGUREN.length}`);
pruefe('Kennungen eindeutig', new Set(kennungen).size === kennungen.length, kennungen.join(', '));
pruefe(
  'Vorgabe steht in der Liste',
  istFigur(FIGUR_VORGABE),
  FIGUR_VORGABE
);
pruefe('Member-Name gesetzt', FIGUR_MEMBER.length > 0, FIGUR_MEMBER);

for (const f of FIGUREN) {
  pruefe(
    `"${f.id}": Modellname ohne Endung`,
    !f.modell.toLowerCase().endsWith('.glb'),
    f.modell
  );
  pruefe(`"${f.id}": Beschriftung vorhanden`, f.name.trim().length > 0, f.name);
  const datei = resolve(WURZEL, 'assets/models', modellDateiZu(f.id));
  pruefe(`"${f.id}": ${modellDateiZu(f.id)} liegt wirklich da`, existsSync(datei), datei);
}
pruefe(
  'modellDateiZu haengt genau eine Endung an',
  modellDateiZu(FIGUR_VORGABE) === `${modellZu(FIGUR_VORGABE)}.glb`,
  modellDateiZu(FIGUR_VORGABE)
);

console.log('\n[2] Der Server glaubt dem Client nicht');
for (const boese of ['', 'wikingerinn', '../../etc/passwd', 'PlayerAvatar.glb', 'WIKINGER']) {
  pruefe(`abgelehnt: "${boese}"`, !istFigur(boese));
}
for (const unsinn of [null, undefined, 42, {}, ['wikinger']]) {
  pruefe(`abgelehnt: ${JSON.stringify(unsinn) ?? 'undefined'}`, !istFigur(unsinn));
}
for (const gut of kennungen) {
  pruefe(`angenommen: "${gut}"`, istFigur(gut));
}

console.log('\n[3] Rueckfall statt kaputtem Spielstand');
pruefe(
  'unbekannte Kennung faellt auf die Vorgabe',
  figurZu('gibtsnichtmehr').id === FIGUR_VORGABE,
  figurZu('gibtsnichtmehr').id
);
pruefe('null faellt auf die Vorgabe', figurZu(null).id === FIGUR_VORGABE);
pruefe(
  'bekannte Kennung liefert sich selbst',
  FIGUREN.every((f) => figurZu(f.id).id === f.id)
);

/**
 * [4] Kann die Figur ueberhaupt gehen?
 *
 * Eine waehlbare Figur ohne Geh- und Rennzyklus steht beim Laufen still.
 * Genau das ist der Walkuere am 22.08.2026 passiert: Sie kam mit einem
 * einzigen Clip aus Mixamo ("mixamo.com", 1 s), die vier echten Bewegungen
 * lagen als FBX daneben und mussten erst eingebaut werden. Aufgefallen ist
 * es erst im Browser — der Einbau lief durch, die Tests waren gruen, und
 * die Figur stand im Spiel wie angewurzelt da.
 *
 * Geprueft wird gegen die Namensmuster, mit denen AvatarRig seine Clips
 * sucht. Es gibt zwar Ersatzregeln (schnellster/langsamster wandernder
 * Clip), aber auf die soll sich eine waehlbare Figur nicht verlassen: Sie
 * ordnen nach gemessenem Tempo und koennen einen Angriffsclip zum
 * Rennzyklus machen.
 */
console.log('\n[4] Jede Figur bringt ihre Bewegungen mit');
const manifest = JSON.parse(
  readFileSync(resolve(WURZEL, 'assets/manifest.json'), 'utf-8')
) as { modelle: Record<string, { animationen?: Array<{ name: string }> }> };

const MUSTER: Array<[string, RegExp]> = [
  ['Standpose', /idle|ruhe|stand/i],
  ['Gehzyklus', /gehen|walk/i],
  ['Rennzyklus', /rennen|run|jog/i],
];

for (const f of FIGUREN) {
  const eintrag = manifest.modelle[modellDateiZu(f.id)] ?? manifest.modelle[modellZu(f.id)];
  const clips = (eintrag?.animationen ?? []).map((a) => a.name);
  pruefe(`"${f.id}": steht im Manifest`, !!eintrag);
  for (const [rolle, muster] of MUSTER) {
    pruefe(`"${f.id}": ${rolle}`, clips.some((c) => muster.test(c)), clips.join(', ') || 'keine Clips');
  }
}

if (fehler === 0) {
  console.log('\n=== F17 Figurenwahl: ALLE PRUEFUNGEN BESTANDEN ===');
  process.exit(0);
} else {
  console.error(`\n=== F17 Figurenwahl: ${fehler} FEHLGESCHLAGEN ===`);
  process.exit(1);
}
