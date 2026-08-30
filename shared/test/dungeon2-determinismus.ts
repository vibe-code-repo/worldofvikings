/**
 * Determinismus-Pruefstand fuer den Dungeon-Generator 2.0 (AP5,
 * `design/ARCHITECTURE.md` §4, Paket AP5).
 * Determinism proving ground for dungeon generator 2.0 (AP5,
 * `design/ARCHITECTURE.md` §4, package AP5).
 *
 *   npx tsx test/dungeon2-determinismus.ts
 *   DUNGEON2_EINFRIEREN=1 npx tsx test/dungeon2-determinismus.ts   (Neuausgabe der Tabellen)
 *
 * Fuenf Nachweise, alle Ende-zu-Ende Seed -> Layout -> Geometrie, wo
 * zutreffend:
 * Five proofs, all end-to-end seed -> layout -> geometry where applicable:
 *
 *   (1) Ende-zu-Ende-Determinismus MEHRFACH: fuer eine Seed-Stichprobe wird
 *       Layout UND Bauergebnis zweimal unabhaengig erzeugt; beide Male
 *       identische Pruefsummen. Zusaetzlich eine eingefrorene Tabelle
 *       (Golden-Datei) fuer die Regression.
 *       End-to-end determinism MULTIPLE TIMES: for a seed sample, layout AND
 *       build result are each generated twice, independently; both times
 *       identical checksums. Plus a frozen table (golden file) for
 *       regression.
 *   (2) BLOCKWEISE Pruefsummen: derselbe Bau, einmal ganz und einmal Block
 *       fuer Block, liefert je Block dieselbe Pruefsumme — zweimal
 *       wiederholt (mehrfach), damit ein Flackern nicht durchrutscht.
 *       BLOCK-WISE checksums: the same build, once whole and once block by
 *       block, yields the same checksum per block — repeated twice (multiple
 *       times) so a flicker cannot slip through.
 *   (3) `hashPos`-Werte-Tabelle Node<->Browser-Baseline, 1000 eingefrorene
 *       Eingaben (das in AP1 offen gelassene Kriterium (c), hier eingeloest
 *       fuer die Node-Seite; siehe Abschnitt 6 fuer den Browser-Abgleich).
 *       `hashPos` value table Node<->browser baseline, 1000 frozen inputs
 *       (the criterion (c) left open by AP1, redeemed here for the Node
 *       side; see section 6 for the browser comparison).
 *   (4) Kanonisierungs-Roundtrip: kanonisch()/Pruefsumme sind stabil ueber
 *       JSON-Rundlauf UND ueber Feld-/Array-Umsortierung, auf ECHTEN
 *       generator-erzeugten Layouts (nicht nur dem Handschriftbeispiel aus
 *       AP1).
 *       Canonicalization round-trip: kanonisch()/checksum are stable across
 *       a JSON round trip AND across field/array reordering, on REAL
 *       generator-produced layouts (not just AP1's handwritten example).
 *   (5) Migrations-Stub: `migriere()` akzeptiert das aktuelle Format
 *       unveraendert (Pruefsumme bleibt), lehnt fremdes Format, zu neue
 *       Version, Nicht-Objekt und `null` ab, und ist idempotent — die
 *       Vorbereitung fuer kuenftige v1->v2-Schritte, ohne dass heute schon
 *       einer existiert.
 *       Migration stub: `migriere()` accepts the current format unchanged
 *       (checksum stays put), rejects foreign format, too-new version,
 *       non-object, and `null`, and is idempotent — the preparation for
 *       future v1->v2 steps, without one existing yet.
 *
 * Seeds kommen aus einer Zaehlung (Muster aus dungeon2-generator.ts /
 * dungeon2-builder.ts), nie aus einer Uhr oder `Math.random`.
 * Seeds come from a count (pattern from dungeon2-generator.ts /
 * dungeon2-builder.ts), never from a clock or `Math.random`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  fnv1a32,
  kanonisch,
  layoutPruefsumme,
  migriere,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  type DungeonLayout2,
  type LayoutSeeds,
  type RaumStempel,
} from '../src/dungeon2/layout.js';
import { zellenAufbauen } from '../src/dungeon2/cells.js';
import { bauKanonisch, baueGeometrie, blockSchluessel, bloeckeDesGitters } from '../src/dungeon2/builder.js';
import { erzeugeLayout } from '../src/dungeon2/generator.js';
import { STEINGRAB, materialTagFuerStempel } from '../src/dungeon2/themen.js';
import { hashPos, mische } from '../src/dungeon2/hashing.js';

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

const thema = STEINGRAB;
const materialOptionen = {
  materialTagFuerStempel: (s: RaumStempel) => materialTagFuerStempel(thema, s),
};

/** Seeds aus einer Zaehlung, nicht aus einer Uhr. / Seeds from a count, not a clock. */
function seedsFuer(i: number): LayoutSeeds {
  return {
    architektur: (i * 2654435761) >>> 0,
    material: (i * 40503 + 7) >>> 0,
    deko: (i * 2246822519 + 13) >>> 0,
  };
}

const EINFRIEREN = process.env.DUNGEON2_EINFRIEREN === '1';
const GOLDEN_ORDNER = join(import.meta.dirname, 'golden');
if (EINFRIEREN && !existsSync(GOLDEN_ORDNER)) mkdirSync(GOLDEN_ORDNER, { recursive: true });

function golden<T>(datei: string, berechne: () => T): T {
  const pfad = join(GOLDEN_ORDNER, datei);
  if (EINFRIEREN) {
    const wert = berechne();
    writeFileSync(pfad, `${JSON.stringify(wert, null, 0)}\n`, 'utf-8');
    console.log(`EINGEFROREN: ${pfad}`);
    return wert;
  }
  return JSON.parse(readFileSync(pfad, 'utf-8')) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1)+(2) Ende-zu-Ende, MEHRFACH, blockweise / end-to-end, MULTIPLE TIMES, block-wise
// ─────────────────────────────────────────────────────────────────────────────

const E2E_SEEDS = 40;

interface E2EZeile {
  readonly seed: number;
  readonly layoutPruefsumme: string;
  readonly bauPruefsumme: string;
  readonly blockZahl: number;
  readonly blockGesamtschluessel: string;
}

/**
 * Baut ein Layout ganz UND blockweise, und liefert eine Zeile mit allem, was
 * fuer den Regressionsabgleich noetig ist. Wird zweimal pro Seed aufgerufen
 * (Nachweis "mehrfach"), das Ergebnis muss beide Male identisch sein.
 * Builds a layout whole AND block by block, and returns a row with everything
 * needed for the regression comparison. Called twice per seed (proof
 * "multiple times"); the result must be identical both times.
 */
function e2eZeile(seed: number): E2EZeile {
  const layout = erzeugeLayout(thema, seedsFuer(seed));
  const gitter = zellenAufbauen(layout, materialOptionen);
  const bloecke = bloeckeDesGitters(gitter);

  // Blockreihenfolge seed-fest mischen (nicht sortiert lassen!) — sonst
  // beweist der Test nur "Reihenfolge = Einfuegereihenfolge", nicht
  // Reihenfolgefreiheit (W8).
  // Shuffle block order seed-fixed (do not leave it sorted!) — otherwise the
  // test only proves "order = insertion order", not order-independence (W8).
  const gemischt = [...bloecke];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = mische(seed, i) % (i + 1);
    const t = gemischt[i]!;
    gemischt[i] = gemischt[j]!;
    gemischt[j] = t;
  }

  const blockPruefsummen: [string, string][] = [];
  for (const block of gemischt) {
    const teil = baueGeometrie(layout, { gitter, aufbau: materialOptionen, bloecke: [block] });
    blockPruefsummen.push([blockSchluessel(block), fnv1a32(bauKanonisch(teil)).toString(16).padStart(8, '0')]);
  }
  // Sortiert vor dem Zusammenfassen — eine Map-/Array-Reihenfolge darf nie in
  // eine Pruefsumme eingehen (Muster aus layout.ts kanonisch()).
  // Sorted before combining — an array/map order must never enter a
  // checksum (pattern from layout.ts's kanonisch()).
  blockPruefsummen.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const blockGesamtschluessel = fnv1a32(blockPruefsummen.map(([k, s]) => `${k}=${s}`).join('\n'))
    .toString(16)
    .padStart(8, '0');

  const ganzerBau = baueGeometrie(layout, { gitter, aufbau: materialOptionen });

  return {
    seed,
    layoutPruefsumme: layout.pruefsumme,
    bauPruefsumme: ganzerBau.pruefsumme,
    blockZahl: bloecke.length,
    blockGesamtschluessel,
  };
}

{
  let ungleicheWiederholung = 0;
  let ersteAbweichung = '';
  const zeilen: E2EZeile[] = [];
  for (let i = 0; i < E2E_SEEDS; i++) {
    const a = e2eZeile(i);
    const b = e2eZeile(i); // ein zweites, unabhaengiges Mal / a second, independent time
    if (
      a.layoutPruefsumme !== b.layoutPruefsumme ||
      a.bauPruefsumme !== b.bauPruefsumme ||
      a.blockGesamtschluessel !== b.blockGesamtschluessel
    ) {
      ungleicheWiederholung++;
      if (ersteAbweichung === '') ersteAbweichung = `Seed ${i}: erster Lauf != zweiter Lauf`;
    }
    zeilen.push(a);
  }
  pruefe(
    `Ende-zu-Ende-Determinismus MEHRFACH (${E2E_SEEDS} Seeds, je 2 unabhaengige Laeufe)`,
    ungleicheWiederholung === 0,
    ersteAbweichung
  );

  const summenMenge = new Set(zeilen.map((z) => z.layoutPruefsumme));
  pruefe(
    `${E2E_SEEDS} verschiedene Seeds -> ${summenMenge.size} verschiedene Layout-Pruefsummen`,
    summenMenge.size === E2E_SEEDS
  );
  const bauSummenMenge = new Set(zeilen.map((z) => z.bauPruefsumme));
  pruefe(
    `${E2E_SEEDS} verschiedene Seeds -> ${bauSummenMenge.size} verschiedene Bau-Pruefsummen`,
    bauSummenMenge.size === E2E_SEEDS
  );

  const soll = golden<E2EZeile[]>('dungeon2-e2e.json', () => zeilen);
  let abweichungen = 0;
  let ersteGoldenAbweichung = '';
  for (let i = 0; i < E2E_SEEDS; i++) {
    const ist = zeilen[i]!;
    const erwartet = soll[i];
    const gleich =
      erwartet !== undefined &&
      erwartet.seed === ist.seed &&
      erwartet.layoutPruefsumme === ist.layoutPruefsumme &&
      erwartet.bauPruefsumme === ist.bauPruefsumme &&
      erwartet.blockZahl === ist.blockZahl &&
      erwartet.blockGesamtschluessel === ist.blockGesamtschluessel;
    if (!gleich) {
      abweichungen++;
      if (ersteGoldenAbweichung === '') {
        ersteGoldenAbweichung = `Seed ${ist.seed}: ${JSON.stringify(ist)} statt ${JSON.stringify(erwartet)}`;
      }
    }
  }
  pruefe(
    `eingefrorene Ende-zu-Ende-Tabelle (golden/dungeon2-e2e.json, ${E2E_SEEDS} Seeds) unveraendert`,
    abweichungen === 0,
    ersteGoldenAbweichung
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (2b) Blockweise Gleichheit einzeln nachgewiesen (nicht nur im Gesamtschluessel)
//      block-wise equality proven individually (not only in the combined key)
// ─────────────────────────────────────────────────────────────────────────────

{
  const seed = 17;
  const layout = erzeugeLayout(thema, seedsFuer(seed));
  const gitter = zellenAufbauen(layout, materialOptionen);
  const bloecke = bloeckeDesGitters(gitter);
  pruefe('Testlayout hat mehr als einen Block (sonst prueft dieser Block nichts)', bloecke.length > 1);

  let fehlerhafteBloecke = 0;
  let ersterFehler = '';
  for (const block of bloecke) {
    const lauf1 = baueGeometrie(layout, { gitter, aufbau: materialOptionen, bloecke: [block] });
    const lauf2 = baueGeometrie(layout, { gitter, aufbau: materialOptionen, bloecke: [block] });
    const s1 = fnv1a32(bauKanonisch(lauf1)).toString(16);
    const s2 = fnv1a32(bauKanonisch(lauf2)).toString(16);
    if (s1 !== s2) {
      fehlerhafteBloecke++;
      if (ersterFehler === '') ersterFehler = `Block ${blockSchluessel(block)}: ${s1} != ${s2}`;
    }
  }
  pruefe(
    `jeder einzelne Block liefert bei Wiederholung dieselbe Pruefsumme (${bloecke.length} Bloecke)`,
    fehlerhafteBloecke === 0,
    ersterFehler
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (3) hashPos-Werte-Tabelle, 1000 eingefrorene Eingaben — die Node-Seite von
//     AP1-Kriterium (c). Der Browser-Abgleich ist Abschnitt 6 unten.
//     hashPos value table, 1000 frozen inputs — the Node side of AP1
//     criterion (c). The browser comparison is section 6 below.
// ─────────────────────────────────────────────────────────────────────────────

const HASHPOS_ANZAHL = 1000;

interface HashZeile {
  readonly x: number;
  readonly z: number;
  readonly ebene: number;
  readonly seed: number;
  readonly wert: number;
}

/** Eingaben aus einer Zaehlung, breit ueber den int32-Bereich gestreut. / Inputs from a count, spread widely over the int32 range. */
function hashEingabeFuer(i: number): { x: number; z: number; ebene: number; seed: number } {
  return {
    x: ((i * 2654435761) >>> 0) - 2 ** 31,
    z: ((i * 40503 + 7) >>> 0) - 2 ** 31,
    ebene: (i % 9) - 4,
    seed: (i * 2246822519 + 13) >>> 0,
  };
}

{
  const zeilen: HashZeile[] = [];
  for (let i = 0; i < HASHPOS_ANZAHL; i++) {
    const e = hashEingabeFuer(i);
    zeilen.push({ ...e, wert: hashPos(e.x, e.z, e.ebene, e.seed) });
  }

  let alleGanzzahlig = true;
  for (const z of zeilen) {
    if (!Number.isInteger(z.wert) || z.wert < 0 || z.wert >= 2 ** 32) alleGanzzahlig = false;
  }
  pruefe(`${HASHPOS_ANZAHL} hashPos-Werte sind uint32-Ganzzahlen`, alleGanzzahlig);

  // Nochmal rechnen: gleiche Eingabe -> gleicher Wert (Determinismus vor dem Einfrieren).
  // Compute again: same input -> same value (determinism before freezing).
  let wiederholungGleich = 0;
  for (const z of zeilen) {
    if (hashPos(z.x, z.z, z.ebene, z.seed) === z.wert) wiederholungGleich++;
  }
  pruefe(`${HASHPOS_ANZAHL} hashPos-Werte sind bei Wiederholung stabil`, wiederholungGleich === HASHPOS_ANZAHL);

  const soll = golden<HashZeile[]>('dungeon2-hashpos-1000.json', () => zeilen);
  let abweichungen = 0;
  let ersteAbweichung = '';
  for (let i = 0; i < HASHPOS_ANZAHL; i++) {
    const ist = zeilen[i]!;
    const erwartet = soll[i];
    if (erwartet === undefined || erwartet.wert !== ist.wert) {
      abweichungen++;
      if (ersteAbweichung === '') {
        ersteAbweichung = `Zeile ${i} (x=${ist.x},z=${ist.z},ebene=${ist.ebene},seed=${ist.seed}): ${ist.wert} statt ${erwartet?.wert}`;
      }
    }
  }
  pruefe(
    `eingefrorene hashPos-Tabelle (golden/dungeon2-hashpos-1000.json, ${HASHPOS_ANZAHL} Werte) unveraendert`,
    abweichungen === 0,
    ersteAbweichung
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (4) Kanonisierungs-Roundtrip auf echten Layouts / round trip on real layouts
// ─────────────────────────────────────────────────────────────────────────────

const ROUNDTRIP_SEEDS = 15;

{
  let jsonRundlaufFehler = 0;
  let ersterJsonFehler = '';
  let umsortierungFehler = 0;
  let ersterUmsortierungFehler = '';
  let idempotenzFehler = 0;

  for (let i = 0; i < ROUNDTRIP_SEEDS; i++) {
    const layout = erzeugeLayout(thema, seedsFuer(i));
    const text1 = kanonisch(layout);
    const text2 = kanonisch(layout);
    if (text1 !== text2) idempotenzFehler++;

    // JSON-Rundlauf: serialisieren, parsen, migrieren, wieder kanonisieren.
    // JSON round trip: serialize, parse, migrate, canonicalize again.
    const roh = JSON.parse(JSON.stringify(layout)) as unknown;
    const migriert = migriere(roh);
    if (migriert === null) {
      jsonRundlaufFehler++;
      if (ersterJsonFehler === '') ersterJsonFehler = `Seed ${i}: migriere() lehnt den eigenen JSON-Rundlauf ab`;
    } else {
      const text3 = kanonisch(migriert);
      if (text3 !== text1 || migriert.pruefsumme !== layout.pruefsumme || layoutPruefsumme(migriert) !== layout.pruefsumme) {
        jsonRundlaufFehler++;
        if (ersterJsonFehler === '') {
          ersterJsonFehler = `Seed ${i}: kanonische Form oder Pruefsumme weicht nach JSON-Rundlauf ab`;
        }
      }
    }

    // Umsortierung: Stempel/Korrekturen/Tueren/Anker in umgekehrter
    // Array-Reihenfolge duerfen die kanonische Form nicht aendern.
    // Reordering: stamps/corrections/doors/anchors in reversed array order
    // must not change the canonical form.
    const umsortiert: DungeonLayout2 = {
      ...layout,
      stempel: [...layout.stempel].reverse(),
      korrekturen: [...layout.korrekturen].reverse(),
      tueren: [...layout.tueren].reverse(),
      anker: [...layout.anker].reverse(),
    };
    if (kanonisch(umsortiert) !== text1 || layoutPruefsumme(umsortiert) !== layout.pruefsumme) {
      umsortierungFehler++;
      if (ersterUmsortierungFehler === '') {
        ersterUmsortierungFehler = `Seed ${i}: Umsortierung der Listen aendert die kanonische Form`;
      }
    }
  }

  pruefe(`kanonisch() ist idempotent ueber ${ROUNDTRIP_SEEDS} generierte Layouts`, idempotenzFehler === 0);
  pruefe(
    `JSON-Rundlauf (stringify -> parse -> migriere) erhaelt Pruefsumme und kanonische Form (${ROUNDTRIP_SEEDS} Seeds)`,
    jsonRundlaufFehler === 0,
    ersterJsonFehler
  );
  pruefe(
    `Umsortierte Listen (Stempel/Korrekturen/Tueren/Anker) aendern die kanonische Form nicht (${ROUNDTRIP_SEEDS} Seeds)`,
    umsortierungFehler === 0,
    ersterUmsortierungFehler
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (5) Migrations-Stub / migration stub
// ─────────────────────────────────────────────────────────────────────────────

{
  const layout = erzeugeLayout(thema, seedsFuer(0));
  const roh = JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;

  const aktuell = migriere(roh);
  pruefe('migriere() akzeptiert das aktuelle Format', aktuell !== null);
  pruefe(
    'migriere() laesst die Pruefsumme unangetastet, wenn kein Schritt lief (aktuelle Version)',
    aktuell !== null && aktuell.pruefsumme === layout.pruefsumme
  );

  const idempotent = aktuell === null ? null : migriere(aktuell as unknown);
  pruefe(
    'migriere() ist idempotent: migriere(migriere(x)) == migriere(x) (Vorbereitung fuer kuenftige v1->v2-Schritte)',
    idempotent !== null && aktuell !== null && idempotent.pruefsumme === aktuell.pruefsumme
  );

  pruefe('migriere() lehnt zu neue Version ab', migriere({ ...roh, version: LAYOUT_VERSION + 1 }) === null);
  pruefe('migriere() lehnt Version 0 ab', migriere({ ...roh, version: 0 }) === null);
  pruefe('migriere() lehnt fremdes Format ab', migriere({ ...roh, format: 'irgendwas-anderes' }) === null);
  pruefe('migriere() lehnt fehlendes Format ab', migriere({ ...roh, format: undefined }) === null);
  pruefe('migriere() lehnt Nicht-Objekt ab (Zahl)', migriere(42) === null);
  pruefe('migriere() lehnt Nicht-Objekt ab (Zeichenkette)', migriere('kein layout') === null);
  pruefe('migriere() lehnt Array ab', migriere([1, 2, 3]) === null);
  pruefe('migriere() lehnt null ab', migriere(null) === null);
  pruefe('migriere() lehnt undefined ab', migriere(undefined) === null);
  pruefe('migriere() lehnt leeres Objekt ab', migriere({}) === null);
  pruefe(
    'LAYOUT_FORMAT/LAYOUT_VERSION sind die erwarteten eingefrorenen Konstanten',
    LAYOUT_FORMAT === 'wov-dungeon-layout' && LAYOUT_VERSION === 1
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Browser-Abgleich / browser comparison
// ─────────────────────────────────────────────────────────────────────────────
//
// Diese Datei laeuft nur in Node. Der Browser-Abgleich braucht ein Bundle und
// eine geladene Seite (`dungeon2-browser-check.html` /
// `dungeon2-browser-check.ts` in diesem Ordner) — das ist per Definition kein
// `npx tsx`-Lauf. Das Verfahren steht im Kopf jener Datei; das Ergebnis wird
// von Hand gegen die hier eingefrorenen Golden-Dateien
// (`golden/dungeon2-hashpos-1000.json`, `golden/dungeon2-e2e.json`)
// gegengehalten und im Arbeitsbericht festgehalten ("Node-Kryptografie ist
// nicht Browser-Kryptografie", eine Ebene tiefer als HMAC: hier geht es um
// `Math.imul`-Ganzzahlarithmetik, die JS-Engines gleich rechnen MUESSEN
// (ECMA-262), aber ein Test, der das nie nachgesehen hat, hat es nicht
// bewiesen).
// This file runs in Node only. The browser comparison needs a bundle and a
// loaded page (`dungeon2-browser-check.html` / `dungeon2-browser-check.ts` in
// this folder) — that is by definition not an `npx tsx` run. The procedure is
// documented in that file's header; the result is checked by hand against the
// golden files frozen here (`golden/dungeon2-hashpos-1000.json`,
// `golden/dungeon2-e2e.json`) and recorded in the work report ("Node crypto
// is not browser crypto", one level deeper: here it is about `Math.imul`
// integer arithmetic, which JS engines MUST compute identically (ECMA-262),
// but a test that never checked has not proven it).

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-determinismus: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
