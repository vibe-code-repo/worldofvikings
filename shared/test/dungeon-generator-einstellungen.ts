/**
 * Rot-Test fuer Ziel B — `DungeonDocument.generatorEinstellungen` (additiv,
 * Dokumentfassung 5 -> 6).
 *
 *   npx tsx shared/test/dungeon-generator-einstellungen.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * VOR DER UMSETZUNG ROT: `sanitizeDungeonDocument` liest `o.generatorEinstellungen`
 * noch nicht (Annahme dieses Tests) — jedes eingereichte Feld geht beim
 * Saeubern verloren, und `DUNGEON_DOCUMENT_VERSION` steht noch auf 5.
 * Erwartet wird nach der Umsetzung:
 *   - `generatorEinstellungen?: { maxRooms?: number; zoneSize?: number }`
 *     an `DungeonDocument`, additiv wie `steinKit`/`ambientLicht`: fehlt es,
 *     wird es nicht erfunden.
 *   - `maxRooms` wird auf [1, 256] geklemmt, `zoneSize` auf [8, 256] — beide
 *     nur bei endlichen Zahlen uebernommen, sonst faellt das einzelne Feld
 *     weg statt das ganze Dokument abzulehnen (dasselbe Muster wie
 *     `ambientLicht`).
 *   - `DUNGEON_DOCUMENT_VERSION` steht auf 6.
 *   - Ein Altdokument OHNE `generatorEinstellungen` saeubert sich byte-gleich
 *     zu vorher (bis auf `version`, die immer die aktuelle Konstante traegt —
 *     wie beim Sprung 4 -> 5 fuer `ambientLicht`).
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 */

import {
  DUNGEONS_BY_NAME,
  generateDungeonLayout,
  sanitizeDungeonDocument,
  DUNGEON_DOCUMENT_VERSION,
} from '../src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('DUNGEON_DOCUMENT_VERSION:');
check(
  'Dokumentfassung steht auf 6 (Sprung von 5 fuer generatorEinstellungen)',
  DUNGEON_DOCUMENT_VERSION === 6,
  `ist ${DUNGEON_DOCUMENT_VERSION}`
);

// ── Grunddokument (DG_Steingrab, wie in den anderen Sanitizer-Tests) ──────

const kit = DUNGEONS_BY_NAME.get('DG_Steingrab')!;
const layout = generateDungeonLayout(kit, 7);
const basisDoc = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'test-generator-einstellungen',
  name: 'Testgrab',
  base: 'DG_Steingrab',
  mode: 'generated' as const,
  seed: 7,
  zoneSize: 64,
  layout,
};

// ── 1. Gueltige generatorEinstellungen bleiben erhalten ───────────────────

console.log('\nGueltige generatorEinstellungen:');
const mitGueltigen = { ...basisDoc, generatorEinstellungen: { maxRooms: 6, zoneSize: 32 } };
const sauberGueltig = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitGueltigen)));
check('Dokument bleibt gueltig', sauberGueltig !== null);
check(
  'generatorEinstellungen-Feld ist da',
  sauberGueltig !== null &&
    (sauberGueltig as { generatorEinstellungen?: unknown }).generatorEinstellungen !== undefined,
  JSON.stringify((sauberGueltig as { generatorEinstellungen?: unknown })?.generatorEinstellungen)
);
check(
  'maxRooms bleibt 6',
  (sauberGueltig as { generatorEinstellungen?: { maxRooms?: number } })?.generatorEinstellungen
    ?.maxRooms === 6,
  `ist ${(sauberGueltig as { generatorEinstellungen?: { maxRooms?: number } })?.generatorEinstellungen?.maxRooms}`
);
check(
  'zoneSize bleibt 32',
  (sauberGueltig as { generatorEinstellungen?: { zoneSize?: number } })?.generatorEinstellungen
    ?.zoneSize === 32,
  `ist ${(sauberGueltig as { generatorEinstellungen?: { zoneSize?: number } })?.generatorEinstellungen?.zoneSize}`
);

// ── 2. Klemmung ────────────────────────────────────────────────────────

console.log('\nKlemmung:');
const zuKleinesMax = sanitizeDungeonDocument(
  JSON.parse(JSON.stringify({ ...basisDoc, generatorEinstellungen: { maxRooms: 0 } }))
) as { generatorEinstellungen?: { maxRooms?: number } } | null;
check(
  'maxRooms 0 wird auf die Untergrenze 1 geklemmt',
  zuKleinesMax?.generatorEinstellungen?.maxRooms === 1,
  `ist ${zuKleinesMax?.generatorEinstellungen?.maxRooms}`
);

const zuGrossesMax = sanitizeDungeonDocument(
  JSON.parse(JSON.stringify({ ...basisDoc, generatorEinstellungen: { maxRooms: 999 } }))
) as { generatorEinstellungen?: { maxRooms?: number } } | null;
check(
  'maxRooms 999 wird auf die Obergrenze 256 geklemmt',
  zuGrossesMax?.generatorEinstellungen?.maxRooms === 256,
  `ist ${zuGrossesMax?.generatorEinstellungen?.maxRooms}`
);

const zuKleineZone = sanitizeDungeonDocument(
  JSON.parse(JSON.stringify({ ...basisDoc, generatorEinstellungen: { zoneSize: 4 } }))
) as { generatorEinstellungen?: { zoneSize?: number } } | null;
check(
  'zoneSize 4 wird auf die Untergrenze 8 geklemmt',
  zuKleineZone?.generatorEinstellungen?.zoneSize === 8,
  `ist ${zuKleineZone?.generatorEinstellungen?.zoneSize}`
);

const zuGrosseZone = sanitizeDungeonDocument(
  JSON.parse(JSON.stringify({ ...basisDoc, generatorEinstellungen: { zoneSize: 999 } }))
) as { generatorEinstellungen?: { zoneSize?: number } } | null;
check(
  'zoneSize 999 wird auf die Obergrenze 256 geklemmt',
  zuGrosseZone?.generatorEinstellungen?.zoneSize === 256,
  `ist ${zuGrosseZone?.generatorEinstellungen?.zoneSize}`
);

// ── 3. Muell wird verworfen ────────────────────────────────────────────

console.log('\nMuell:');
const muellFelder = sanitizeDungeonDocument(
  JSON.parse(
    JSON.stringify({
      ...basisDoc,
      generatorEinstellungen: { maxRooms: 'sechs', zoneSize: null, unbekannt: 123 },
    })
  )
) as { generatorEinstellungen?: { maxRooms?: number; zoneSize?: number; unbekannt?: unknown } } | null;
check(
  'Dokument bleibt trotz Muell in generatorEinstellungen gueltig',
  muellFelder !== null
);
check(
  'maxRooms als Text faellt weg statt das Dokument abzulehnen',
  muellFelder?.generatorEinstellungen?.maxRooms === undefined,
  `ist ${muellFelder?.generatorEinstellungen?.maxRooms}`
);
check(
  'zoneSize als null faellt weg',
  muellFelder?.generatorEinstellungen?.zoneSize === undefined,
  `ist ${muellFelder?.generatorEinstellungen?.zoneSize}`
);
check(
  'unbekanntes Feld wird nicht durchgereicht',
  muellFelder?.generatorEinstellungen?.unbekannt === undefined
);

const muellGanz = sanitizeDungeonDocument(
  JSON.parse(JSON.stringify({ ...basisDoc, generatorEinstellungen: 'nicht mal ein Objekt' }))
) as { generatorEinstellungen?: unknown } | null;
check(
  'ein generatorEinstellungen, das gar kein Objekt ist, bleibt einfach weg',
  muellGanz !== null && muellGanz.generatorEinstellungen === undefined,
  JSON.stringify(muellGanz?.generatorEinstellungen)
);

// ── 4. Altdokument ohne generatorEinstellungen bleibt additiv ─────────────

console.log('\nAltdokument (additiv):');
const altSauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc))) as {
  generatorEinstellungen?: unknown;
} | null;
check(
  'Altdokument traegt kein generatorEinstellungen-Feld (wird nicht erfunden)',
  altSauber !== null && altSauber.generatorEinstellungen === undefined,
  JSON.stringify(altSauber?.generatorEinstellungen)
);
const vorherJson = JSON.stringify(altSauber);
const nochmalSauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc)));
check(
  'Altdokument saeubert sich byte-gleich (erneuter Lauf, keine Drift)',
  JSON.stringify(nochmalSauber) === vorherJson
);

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAlle generatorEinstellungen-Pruefungen gruen.');
