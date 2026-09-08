#!/usr/bin/env node
// Erzeugt: eine Weltdatei mit frischen Kuratierungslisten aus dem Code.
/*
  Der Befund, aus dem dieses Werkzeug entstanden ist (08.09.2026,
  Zusammenführung Schritt 1):

  `RegionDef.vegetation` in `server/data/welten/<instanz>.json` ist eine
  NAMENSLISTE, kein Verweis. Sie wurde einmal aus
  `GRASLAND_FLORA_NAMEN` und Geschwistern gefüllt und liegt seither als
  Abschrift in der Datei.

  Damit hat `STORE_FLORA_AKTIV` (shared/src/storeFlora.ts) auf eine
  BESTEHENDE Welt keinerlei Wirkung. Der Schalter ändert, was die
  `*_FLORA_NAMEN` zurückgeben; die Welt liest sie nie wieder. Im Spiel
  sah das so aus: Der Code kuratierte 29 Store-Arten, die Welt bestellte
  weiter `Eiche1`, `BirkeHoch2`, … — und weil die alten Prefabs alle noch
  registriert sind, wuchs auch alles weiter. Kein Fehler, keine Warnung,
  keine leere Region. Nur eben nichts vom Store.

  Das ist kein Fehler der Weltdatei: Eine Welt SOLL ihren Bewuchs
  festhalten, sonst änderte sich ein Spielstand mit jedem Codeumbau.
  Fehlend war das Werkzeug, mit dem man die Abschrift bewusst erneuert.

  ── Warum es NIE von allein die Zieldatei überschreibt ───────────────
  Die Weltdatei ist Handarbeit — Regionen, Formen, Routen, Platzierungen.
  Ein Werkzeug, das sie stillschweigend anfasst, wäre ein
  Weltuntergang mit grünem Testlauf. Deshalb: Quelle und Ziel sind zwei
  Argumente, und das Ziel muss ausdrücklich genannt werden.

  Aufruf:
    npx tsx tools/welt-flora-auffrischen.mjs --von server/data/welten/dev.json \
                                             --nach /tmp/probe.json
    npx tsx tools/welt-flora-auffrischen.mjs --von … --nur-pruefen

  `--nur-pruefen` schreibt nichts und meldet je Region, wie weit die
  Liste in der Datei von der des Codes abweicht. Endet mit Code 1, wenn
  es irgendwo auseinandergeht — so lässt sich der Befund oben jederzeit
  nachstellen, ohne eine Datei anzufassen.

  Rewrites a world file's curated plant lists from the code's current
  lists. Never writes the source file.
*/
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GRASLAND_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  ASCHE_FLORA_NAMEN,
  STORE_FLORA_AKTIV,
  STORE_FLORA_BEREIT,
} from '../shared/src/index.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const VON = resolve(WURZEL, arg('von', 'server/data/welten/dev.json'));
const NACH = arg('nach', null);
const NUR_PRUEFEN = flag('nur-pruefen');

/*
  Ein Biom, ein Bündel. Die Zuordnung steht hier und nicht in `flora.ts`,
  weil sie eine Aussage über die WELTDATEI ist: Dort heisst das Feld
  `biome`, und dort stehen genau diese fünf Werte.
*/
const JE_BIOM = {
  grassland: GRASLAND_FLORA_NAMEN,
  blackforest: NADELWALD_FLORA_NAMEN,
  swamp: SUMPF_FLORA_NAMEN,
  deepnorth: HOCHNORD_FLORA_NAMEN,
  ashlands: ASCHE_FLORA_NAMEN,
};

if (!existsSync(VON)) {
  console.error(`Weltdatei fehlt: ${VON}`);
  process.exit(2);
}
if (!NUR_PRUEFEN && !NACH) {
  console.error('Ohne --nach wird nichts geschrieben. Ziel ausdrücklich nennen (oder --nur-pruefen).');
  process.exit(2);
}
if (NACH && resolve(WURZEL, NACH) === VON) {
  console.error('Quelle und Ziel sind dieselbe Datei — die Weltdatei wird nicht überschrieben.');
  process.exit(2);
}

const welt = JSON.parse(readFileSync(VON, 'utf8'));
console.log(`Quelle: ${VON}`);
console.log(`Kuratierung im Code: STORE_FLORA_AKTIV=${STORE_FLORA_AKTIV}, STORE_FLORA_BEREIT=${STORE_FLORA_BEREIT}`);

let abweichend = 0;
let ohneBuendel = 0;
for (const region of welt.regions ?? []) {
  const soll = JE_BIOM[region.biome];
  if (!soll) {
    ohneBuendel++;
    console.log(`  ${region.id}: Biom "${region.biome}" — kein Bündel, unverändert`);
    continue;
  }
  const ist = region.vegetation ?? [];
  const fehlt = soll.filter((n) => !ist.includes(n));
  const zuviel = ist.filter((n) => !soll.includes(n));
  if (fehlt.length > 0 || zuviel.length > 0) {
    abweichend++;
    console.log(
      `  ${region.id} (${region.biome}): ${ist.length} in der Datei, ${soll.length} im Code — ` +
        `${fehlt.length} fehlen, ${zuviel.length} überzählig`
    );
  }
  if (!NUR_PRUEFEN) region.vegetation = [...soll];
}

console.log(`\n${abweichend} von ${welt.regions?.length ?? 0} Regionen weichen ab, ${ohneBuendel} ohne Bündel.`);

if (NUR_PRUEFEN) {
  if (abweichend > 0) {
    console.error('Die Weltdatei kuratiert etwas anderes als der Code. Das ist kein Fehler —');
    console.error('aber es heisst, dass ein Umschalten in shared/src/storeFlora.ts diese Welt nicht erreicht.');
    process.exit(1);
  }
  console.log('Weltdatei und Code kuratieren dasselbe.');
  process.exit(0);
}

const ziel = resolve(WURZEL, NACH);
writeFileSync(ziel, `${JSON.stringify(welt, null, 2)}\n`);
console.log(`geschrieben: ${ziel}`);
