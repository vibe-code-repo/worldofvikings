/**
 * Browser-Seite des Determinismus-Prüfstands (AP5): rechnet DIESELBEN Werte
 * wie `dungeon2-determinismus.ts`, aber im Browser-Bündel statt in Node, und
 * schreibt sie als Text ins DOM, damit ein Mensch (oder ein Werkzeug wie
 * `mcp__Claude_Browser__get_page_text`) sie abliest und gegen die
 * Node-Golden-Dateien haelt.
 * Browser side of the determinism proving ground (AP5): computes the SAME
 * values as `dungeon2-determinismus.ts`, but in the browser bundle instead
 * of Node, and writes them as text into the DOM so a human (or a tool like
 * `mcp__Claude_Browser__get_page_text`) can read them and hold them against
 * the Node golden files.
 *
 * Diese Datei liegt bewusst in `shared/test/`, NICHT in `shared/src/dungeon2/`
 * — sie darf `document` benutzen, weil die Schichtgrenze (`dungeon2-
 * schichten.ts`) nur die reine Schicht schuetzt, nicht ihre Testinfrastruktur.
 * This file deliberately lives in `shared/test/`, NOT in
 * `shared/src/dungeon2/` — it may use `document`, because the layer boundary
 * (`dungeon2-schichten.ts`) only protects the pure layer, not its test
 * infrastructure.
 *
 * Bauen und oeffnen / build and open:
 *
 *   npx esbuild shared/test/dungeon2-browser-check.ts --bundle \
 *     --format=iife --platform=browser \
 *     --outfile=shared/test/dungeon2-browser-check.bundle.js
 *
 *   (Bundle-Datei ist ein Build-Ausgabeprodukt, absichtlich nicht committet
 *    — .gitignore-Eintrag am Ordnerende dieses Kommentars.)
 *   (The bundle file is a build output, deliberately not committed — see the
 *    .gitignore entry mentioned at the end of this comment.)
 *
 * Dann `dungeon2-browser-check.html` in einem Browser oeffnen (auch per
 * `file://`, es gibt keine externen Abhaengigkeiten) und den Text im
 * `<pre id="ergebnis">` gegen `golden/dungeon2-hashpos-1000.json` und
 * `golden/dungeon2-e2e.json` halten — Zeile fuer Zeile identisch heisst
 * bestanden. Vorsicht (Projektlehre): das Bundle erneuert sich nicht von
 * selbst — nach jeder Aenderung an `shared/src/dungeon2/**` neu bauen, sonst
 * misst man den alten Stand.
 * Then open `dungeon2-browser-check.html` in a browser (even via `file://`,
 * there are no external dependencies) and hold the text in
 * `<pre id="ergebnis">` against `golden/dungeon2-hashpos-1000.json` and
 * `golden/dungeon2-e2e.json` — identical line for line means it passed.
 * Caution (project lesson): the bundle does not renew itself — rebuild after
 * every change to `shared/src/dungeon2/**`, otherwise you measure the old
 * state.
 */

import { hashPos } from '../src/dungeon2/hashing.js';
import { type LayoutSeeds, type RaumStempel } from '../src/dungeon2/layout.js';
import { zellenAufbauen } from '../src/dungeon2/cells.js';
import { baueGeometrie, bloeckeDesGitters } from '../src/dungeon2/builder.js';
import { erzeugeLayout } from '../src/dungeon2/generator.js';
import { STEINGRAB, materialTagFuerStempel } from '../src/dungeon2/themen.js';

// Dieselben Erzeugerfunktionen wie in dungeon2-determinismus.ts — bewusst
// dupliziert statt importiert, damit ein Bundler-Fehler beim Teilen von
// Testcode nicht zufaellig beide Seiten gleich falsch macht.
// The same generator functions as in dungeon2-determinismus.ts — deliberately
// duplicated rather than imported, so a bundler mistake when sharing test
// code cannot accidentally make both sides wrong in the same way.

function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

function hashEingabeFuer(i: number): { x: number; z: number; ebene: number; seed: number } {
  return {
    x: ((i * 2654435761) >>> 0) - 2 ** 31,
    z: ((i * 40503 + 7) >>> 0) - 2 ** 31,
    ebene: (i % 9) - 4,
    seed: (i * 2246822519 + 13) >>> 0,
  };
}

const thema = STEINGRAB;
const materialOptionen = {
  materialTagFuerStempel: (s: RaumStempel) => materialTagFuerStempel(thema, s),
};

const HASHPOS_ANZAHL = 1000;
const E2E_SEEDS = 40;

function berechne(): { hashpos: { x: number; z: number; ebene: number; seed: number; wert: number }[]; e2e: { seed: number; layoutPruefsumme: string; bauPruefsumme: string; blockZahl: number }[] } {
  const hashpos = [];
  for (let i = 0; i < HASHPOS_ANZAHL; i++) {
    const e = hashEingabeFuer(i);
    hashpos.push({ ...e, wert: hashPos(e.x, e.z, e.ebene, e.seed) });
  }

  const e2e = [];
  for (let i = 0; i < E2E_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const gitter = zellenAufbauen(layout, materialOptionen);
    const bloecke = bloeckeDesGitters(gitter);
    const bau = baueGeometrie(layout, { gitter, aufbau: materialOptionen });
    e2e.push({
      seed: i,
      layoutPruefsumme: layout.pruefsumme,
      bauPruefsumme: bau.pruefsumme,
      blockZahl: bloecke.length,
    });
  }

  return { hashpos, e2e };
}

function haupt(): void {
  const ergebnis = berechne();
  const ausgabe = JSON.stringify(ergebnis, null, 0);
  const element = document.getElementById('ergebnis');
  if (element !== null) element.textContent = ausgabe;
  // Zusaetzlich auf der Konsole, falls jemand nur read_console_messages nutzt.
  // Also on the console, in case someone only uses read_console_messages.
  console.log('DUNGEON2_BROWSER_CHECK_START');
  console.log(ausgabe);
  console.log('DUNGEON2_BROWSER_CHECK_ENDE');
}

haupt();
