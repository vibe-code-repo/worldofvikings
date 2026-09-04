/**
 * Die Golden-Dateien für `server/test/golden-kits.ts` schreiben (G8).
 *
 * ── Warum ein eigenes Werkzeug ────────────────────────────────────────
 * Ein Test, der seine eigene Erwartung überschreiben kann, ist im
 * Zweifelsfall immer grün: Wer einen roten Lauf sieht und den Schalter
 * findet, hat den Befund weggeschrieben statt ihn gelesen. Das Schreiben
 * gehört deshalb in ein Werkzeug, das man ausdrücklich aufruft.
 *
 * ── Warum hier `generateDungeonLayout` und NICHT der Verteiler steht ──
 * Das Golden ist der Stand VOR dem Umbau. Ginge es über
 * `erzeugeLayoutFuerKit`, schriebe ein Kit, das versehentlich den
 * Rasterschalter bekommt, sich sein eigenes Golden — und der Vergleich
 * bewiese nur noch, dass zwei Läufe desselben Codes gleich sind. Der
 * 1.0-Pfad ist die Referenz, gegen die verglichen wird, und er steht
 * hier direkt.
 *
 * `DG_StoneVault` bekommt kein Golden: Es ist das eine Kit, das mit G8
 * ausdrücklich die Seite wechselt (Konzeptnotiz, „Saat-Bruch für
 * DG_StoneVault ist unvermeidlich — mit Ansage").
 *
 * Aufruf: `npx tsx tools/golden-kits-schreiben.ts`   (aus dem Repo-Wurzelverzeichnis)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DUNGEONS, DUNGEONS_BY_NAME } from '../shared/src/dungeons.js';
import { generateDungeonLayout } from '../shared/src/dungeonGenerator.js';
import type { DungeonDef } from '../shared/src/dungeons.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const RASTER_KIT = 'DG_StoneVault';
const VOLL_KIT = 'DG_Steingrab';
const VOLL_SEED = 7;
const GOLDEN_DIR = join(__dirname, 'golden');

interface Eintrag {
  seed: number;
  rooms?: number;
  doors?: number;
  props?: number;
  sha256?: string;
  fehler?: string;
}

function eintrag(def: DungeonDef, seed: number): Eintrag {
  try {
    const layout = generateDungeonLayout(def, seed);
    return {
      seed,
      rooms: layout.rooms.length,
      doors: layout.doors.length,
      props: layout.props.length,
      sha256: createHash('sha256').update(JSON.stringify(layout)).digest('hex'),
    };
  } catch (error) {
    // Die Kits mit Lager-Algorithmus werfen. Sie deshalb wegzulassen
    // hiesse, die Kits ungeprüft zu lassen, bei denen ein Verteiler am
    // ehesten danebengreift — die Meldung ist für sie das Golden.
    return { seed, fehler: String(error) };
  }
}

mkdirSync(GOLDEN_DIR, { recursive: true });

let dateien = 0;
for (const def of DUNGEONS) {
  if (def.name === RASTER_KIT) continue;
  const layouts = SEEDS.map((seed) => eintrag(def, seed));
  const pfad = join(GOLDEN_DIR, `${def.name}.json`);
  writeFileSync(
    pfad,
    JSON.stringify(
      {
        kit: def.name,
        hinweis:
          'Stand des 1.0-Pfads vor dem Verteiler (G8). sha256 über JSON.stringify(layout) — ' +
          'gleiche Prüfsumme heisst gleiche Bytes. Geschrieben von tools/golden-kits-schreiben.ts.',
        layouts,
      },
      null,
      1
    ) + '\n',
    'utf8'
  );
  dateien++;
  const fehler = layouts.filter((l) => l.fehler).length;
  console.log(
    `${def.name.padEnd(28)} ${layouts.length} Saaten` + (fehler > 0 ? ` (${fehler}x Fehlermeldung als Golden)` : '')
  );
}

// Ein vollständiges Layout als LESBARER Zeuge daneben: Bricht ein Hash,
// sagt die Prüfsumme nur „anders". Roh, nicht eingerückt — verglichen
// werden Bytes, und ein hübsch gesetztes JSON wäre keine.
const vollDef = DUNGEONS_BY_NAME.get(VOLL_KIT);
if (vollDef) {
  const pfad = join(GOLDEN_DIR, `${VOLL_KIT}-seed${VOLL_SEED}.json`);
  writeFileSync(pfad, JSON.stringify(generateDungeonLayout(vollDef, VOLL_SEED)), 'utf8');
  dateien++;
  console.log(`${(VOLL_KIT + ` Saat ${VOLL_SEED}`).padEnd(28)} Volltext`);
}

console.log(`\n${dateien} Datei(en) in ${GOLDEN_DIR}.`);
