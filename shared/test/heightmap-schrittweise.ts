/**
 * Zeilenweise gebaute Zonen müssen BIT FÜR BIT dieselben sein.
 *
 * Paket G13 („Ruckler statt Mittelwert") hat die Zonenerzeugung teilbar
 * gemacht: `HeightmapProvider.zoneSchrittweise()` rechnet je Aufruf nur
 * eine Handvoll Vertexzeilen, damit der 9-ms-Block des Geländestroms nicht
 * mehr in EINEM Bild anfällt. Das ist nur dann erlaubt, wenn dabei
 * dieselbe Welt entsteht — Client und Server rechnen dieselbe Höhenfunktion,
 * und eine Abweichung von einem einzigen Bit lässt den Spieler beim Client
 * im Boden stehen, während der Server ihn über Grund führt.
 *
 * Geprüft wird deshalb dreierlei:
 *
 *  1. Höhen, Basishöhen, Vegetationsmaske, Eckentiefen und Eckbiome sind
 *     identisch zur Zone aus einem Stück — bei JEDER Schrittgrösse, denn
 *     die Zerlegung darf nicht zufällig nur bei 8 Zeilen aufgehen.
 *  2. Eine halbfertige Zone ist von aussen NICHT sichtbar: `getZone()`
 *     während eines laufenden Teilbaus liefert eine vollständige Zone.
 *     Ohne diese Zusage wäre die Optimierung ein Fehler, der sich als
 *     Loch in der Landschaft zeigt und nicht als Testrot.
 *  3. `fertig` meldet den Zustand ehrlich.
 *
 * Row-wise built zones must be bit-identical to one-piece ones, and a
 * partially built zone must never be observable from outside.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo } from '../src/worldgen/factory.js';
import { HeightmapProvider, Heightmap, E_WIDTH } from '../src/worldgen/Heightmap.js';
import { getStableHash } from '../src/hash.js';
import { sanitizeWorldLayout } from '../src/worldlayout/index.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');

const layoutRoh = JSON.parse(
  readFileSync(resolve(WURZEL, 'server/data/welten/live.json'), 'utf-8')
) as unknown;
sanitizeWorldLayout(layoutRoh); // wirft, wenn das Layout kaputt ist
const geo = createGeo({
  mode: 'layout',
  worldSeed: getStableHash(
    (sanitizeWorldLayout(layoutRoh) as { detailSeed: string }).detailSeed
  ),
  layout: layoutRoh,
  settings: {
    worldGenVersion: 2,
    disableDistantRivers: false,
    riverAffectsOcean: false,
    ashlandsModernNoise: true,
  },
});

/**
 * Zonen aus verschiedenen Biomlagen — insbesondere solche mit GEMISCHTEN
 * Eckbiomen: dort läuft der teure Zweig des Baus (vier Rauschabfragen je
 * Vertex statt einer), und genau der wird hier zerlegt.
 */
const ZONEN: Array<[number, number]> = [
  [0, 0],
  [-203, -203],
  [-131, -206], // Sumpf
  [-275, -92], // Grasland
  [-435, -92], // Schwarzwald
  [86, -128], // Ashlands
  [-330, -270], // Deep North
];

/** Schrittgrössen: 1 (Extremfall), 8 (Produktionswert), 7 und 64 (krumm). */
const SCHRITTE = [1, 7, 8, 64, 1000];

let fehler = 0;
const melde = (text: string): void => {
  console.error(`FEHLER: ${text}`);
  fehler++;
};

function vergleiche(a: Float32Array, b: Float32Array, was: string, zone: string): void {
  if (a.length !== b.length) {
    melde(`${was} ${zone}: Länge ${a.length} statt ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      melde(`${was} ${zone}: Index ${i} ist ${a[i]} statt ${b[i]}`);
      return;
    }
  }
}

for (const [zx, zy] of ZONEN) {
  const name = `${zx},${zy}`;
  const ganz = new HeightmapProvider(geo, {}, 4096).getZone(zx, zy);
  if (!ganz.fertig) melde(`Zone ${name} aus einem Stück meldet fertig=false`);

  for (const schritt of SCHRITTE) {
    const p = new HeightmapProvider(geo, {}, 4096);
    let teil: Heightmap | null = null;
    let runden = 0;
    while (teil === null) {
      teil = p.zoneSchrittweise(zx, zy, schritt);
      runden++;
      if (runden > E_WIDTH + 5) {
        melde(`Zone ${name} wird bei Schrittgrösse ${schritt} nie fertig`);
        break;
      }
    }
    if (!teil) continue;

    const wo = `${name} @${schritt}`;
    vergleiche(teil.heights, ganz.heights, 'heights', wo);
    vergleiche(teil.baseHeights, ganz.baseHeights, 'baseHeights', wo);
    vergleiche(teil.vegMask, ganz.vegMask, 'vegMask', wo);
    vergleiche(teil.oceanDepth, ganz.oceanDepth, 'oceanDepth', wo);
    if (teil.cornerBiomes.join(',') !== ganz.cornerBiomes.join(',')) {
      melde(`cornerBiomes ${wo}: ${teil.cornerBiomes.join(',')} statt ${ganz.cornerBiomes.join(',')}`);
    }
    if (!teil.fertig) melde(`Zone ${wo} meldet nach Abschluss fertig=false`);
    // Erwartete Rundenzahl: ceil(65/schritt) Bauschritte plus die Runde,
    // in der die letzte Zeile fällt — grob, aber es fängt einen Schalter,
    // der in Wahrheit alles in einem Rutsch rechnet.
    const erwartet = Math.ceil(E_WIDTH / schritt);
    if (runden !== erwartet) {
      melde(`Zone ${wo}: ${runden} Aufrufe statt ${erwartet} — wird die Zone wirklich zerlegt?`);
    }
  }

  // (2) Eine halbfertige Zone darf NIEMAND zu sehen bekommen.
  {
    const p = new HeightmapProvider(geo, {}, 4096);
    const offen = p.zoneSchrittweise(zx, zy, 8);
    if (offen !== null) {
      melde(`Zone ${name}: nach EINEM Schritt à 8 Zeilen schon fertig?`);
    } else {
      const ausserhalb = p.getZone(zx, zy);
      if (!ausserhalb.fertig) melde(`Zone ${name}: getZone() lieferte eine halbfertige Zone`);
      vergleiche(ausserhalb.heights, ganz.heights, 'heights nach Fremdzugriff', name);
      // Und der Teilbau darf danach nicht als „frische" Zone auferstehen.
      const danach = p.zoneSchrittweise(zx, zy, 8);
      if (danach === null) melde(`Zone ${name}: nach getZone() kommt der Teilbau nicht sofort fertig zurück`);
      else vergleiche(danach.heights, ganz.heights, 'heights nach Wiederaufnahme', name);
    }
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Abweichung(en) — der zeilenweise Bau ist NICHT bitgleich.`);
  process.exit(1);
}
console.log(
  `OK: ${ZONEN.length} Zonen × ${SCHRITTE.length} Schrittgrössen bitgleich zum Bau in einem Stück, ` +
    `halbfertige Zonen bleiben unsichtbar.`
);
