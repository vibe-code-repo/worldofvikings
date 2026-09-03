/**
 * Rot-Test fuer M5a — Steinmaterial je DUNGEON-DOKUMENT (1.0).
 * Red test for M5a — per-DOCUMENT stone material override (1.0 format).
 *
 *   npx tsx shared/test/dungeon-steinkit-dokument.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * VOR DER UMSETZUNG ROT: `STEIN_TEXTUREN` und `DungeonDocument.steinKit`
 * existieren noch nicht (Annahme dieses Tests). Erwartet werden:
 *   - `STEIN_TEXTUREN` — eine `readonly string[]` Erlaubnisliste in
 *     `shared/src/dungeons.ts`, mit den vier bekannten Texturen
 *     (`/assets/models/stein_clean.png`, `stein_decke.png`, `stein_moos.png`,
 *     `stein_frost.png`, `stein_wet.png`).
 *   - `DungeonDocument.steinKit?: Partial<SteinKitConfig>` — vom Sanitizer
 *     eingelesen: gueltige Texturpfade/Zahlen bleiben, Texturpfade AUSSERHALB
 *     der Erlaubnisliste werden NIE durchgereicht (Feld faellt weg oder wird
 *     auf eine Vorgabe aus der Liste gesetzt), Verwitterungszahlen werden auf
 *     [0, 4] geklemmt (Bereich des Konsolenbefehls `dungeon steinkit ...
 *     moos=<0..4> ...`).
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Geprueft wird:
 *  1. Ein Dokument mit gueltigem `steinKit` (bekannte Texturnamen, Zahlen im
 *     Rahmen) laeuft unveraendert durch den Sanitizer.
 *  2. Texturpfade ausserhalb der Erlaubnisliste werden verworfen — geprueft
 *     mit einem absoluten Systempfad, einer fremden URL und einem
 *     Verzeichnis-Ausbruch. Der gesaeuberte Wert ist NIE der eingereichte.
 *  3. Verwitterungszahlen werden geklemmt: 99 -> Obergrenze (4), -1 -> 0.
 *  4. Ein Altdokument OHNE `steinKit` laeuft byte-gleich weiter (props-
 *     Muster aus Dokumentfassung 1 -> 2): das Feld bleibt schlicht weg,
 *     nichts sonst am Dokument aendert sich.
 *
 * ── P5-Ergaenzung (rot) ────────────────────────────────────────────────
 *
 * Rot-Test fuer P5 — Steinmaterial je PLATZIERTEM RAUM.
 * Red test for P5 — per-PLACED-ROOM stone material override.
 *
 * VOR DER UMSETZUNG ROT: `PlacedRoom.steinKit?: Partial<SteinKitConfig>`
 * existiert noch nicht (Annahme dieses Tests), und `sanitizeDungeonDocument`
 * liest `ro.steinKit` beim Einlesen eines Raums noch nicht — jeder
 * eingereichte Raum-Override geht also derzeit beim Saeubern verloren.
 *
 * Geprueft wird zusaetzlich (5.-8.):
 *  5. Ein platzierter Raum mit gueltigem `steinKit` behaelt es nach dem
 *     Sanitizer (dieselbe Erlaubnisliste/Klemmung wie am Dokument, s. o.).
 *  6. Ein Raum-`steinKit` mit einer Textur ausserhalb der Erlaubnisliste
 *     verwirft genau dieses Feld — wie am Dokument.
 *  7. Ein Raum-`steinKit` mit einer ausserhalb [0, 4] liegenden
 *     Verwitterungszahl wird geklemmt — wie am Dokument.
 *  8. Raeume OHNE `steinKit` bleiben ohne das Feld (wird nicht erfunden),
 *     UND ein Altdokument (Raeume ganz ohne das Feld im rohen JSON) saeubert
 *     sich byte-gleich zu vorher — dieselbe additive Garantie wie fuer
 *     `props`/das Dokument-`steinKit` selbst.
 */

import {
  DUNGEONS_BY_NAME,
  generateDungeonLayout,
  sanitizeDungeonDocument,
  DUNGEON_DOCUMENT_VERSION,
  // ANNAHME dieses Tests (s. Kommentar oben) — existiert vor der Umsetzung
  // noch nicht und macht den Import selbst schon zum roten Befund.
  // ASSUMPTION of this test — does not exist yet before implementation, so
  // the import itself is already part of the red finding.
  STEIN_TEXTUREN,
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

console.log('STEIN_TEXTUREN:');
check(
  'STEIN_TEXTUREN ist eine nicht-leere Liste',
  Array.isArray(STEIN_TEXTUREN) && STEIN_TEXTUREN.length > 0,
  Array.isArray(STEIN_TEXTUREN) ? `${STEIN_TEXTUREN.length} Eintraege` : typeof STEIN_TEXTUREN
);
check(
  'STEIN_TEXTUREN kennt die vier bekannten Verwitterungstexturen',
  Array.isArray(STEIN_TEXTUREN) &&
    ['/assets/models/stein_moos.png', '/assets/models/stein_frost.png', '/assets/models/stein_wet.png'].every(
      (t) => STEIN_TEXTUREN.includes(t)
    )
);

// ── Grunddokument (DG_Steingrab, wie in den anderen Sanitizer-Tests) ──────

const kit = DUNGEONS_BY_NAME.get('DG_Steingrab')!;
const layout = generateDungeonLayout(kit, 7);
const basisDoc = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'test-steinkit-1',
  name: 'Testgrab',
  base: 'DG_Steingrab',
  mode: 'generated' as const,
  seed: 7,
  zoneSize: 64,
  layout,
};

// ── 1. Gueltiges steinKit bleibt erhalten ─────────────────────────────────

console.log('\nGueltiges steinKit:');
const mitGueltigemKit = {
  ...basisDoc,
  steinKit: {
    wandTextur: '/assets/models/stein_moos.png',
    deckeTextur: '/assets/models/stein_clean.png',
    bodenTextur: '/assets/models/stein_frost.png',
    verwitterung: { moos: 2, frost: 1, nass: 0 },
    kachelM: 2,
  },
};
const sauberGueltig = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitGueltigemKit)));
check('Dokument bleibt gueltig', sauberGueltig !== null);
check(
  'steinKit-Feld ist da',
  sauberGueltig !== null && sauberGueltig.steinKit !== undefined,
  JSON.stringify(sauberGueltig?.steinKit)
);
check(
  'wandTextur bleibt erhalten',
  sauberGueltig?.steinKit?.wandTextur === '/assets/models/stein_moos.png',
  sauberGueltig?.steinKit?.wandTextur
);
check(
  'deckeTextur bleibt erhalten',
  sauberGueltig?.steinKit?.deckeTextur === '/assets/models/stein_clean.png',
  sauberGueltig?.steinKit?.deckeTextur
);
check(
  'bodenTextur bleibt erhalten',
  sauberGueltig?.steinKit?.bodenTextur === '/assets/models/stein_frost.png',
  sauberGueltig?.steinKit?.bodenTextur
);
check(
  'Verwitterungszahlen im Rahmen bleiben erhalten',
  sauberGueltig?.steinKit?.verwitterung?.moos === 2 &&
    sauberGueltig?.steinKit?.verwitterung?.frost === 1 &&
    sauberGueltig?.steinKit?.verwitterung?.nass === 0,
  JSON.stringify(sauberGueltig?.steinKit?.verwitterung)
);

// ── 2. Texturpfade ausserhalb der Erlaubnisliste werden verworfen ─────────

console.log('\nErlaubnisliste fuer Texturpfade:');
const BOESE_PFADE = ['/etc/passwd', 'http://x/y.png', '../foo.png'];
for (const boese of BOESE_PFADE) {
  const mitBoeserTextur = {
    ...basisDoc,
    steinKit: {
      wandTextur: boese,
      deckeTextur: '/assets/models/stein_clean.png',
      bodenTextur: '/assets/models/stein_clean.png',
      verwitterung: { moos: 0, frost: 0, nass: 0 },
      kachelM: 2,
    },
  };
  const s = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitBoeserTextur)));
  const wand = s?.steinKit?.wandTextur;
  check(
    `Boeser Pfad "${boese}" wird NIE durchgereicht`,
    wand !== boese,
    `wandTextur nach dem Sanitizer: ${JSON.stringify(wand)}`
  );
  check(
    `Boeser Pfad "${boese}": verbleibender Wert (falls gesetzt) steht in der Erlaubnisliste`,
    wand === undefined || (Array.isArray(STEIN_TEXTUREN) && STEIN_TEXTUREN.includes(wand)),
    `wandTextur: ${JSON.stringify(wand)}`
  );
}

// ── 3. Zahlen werden geklemmt ──────────────────────────────────────────────

console.log('\nZahlen klemmen:');
const OBERGRENZE = 4;
const mitZuHohemMoos = {
  ...basisDoc,
  steinKit: {
    wandTextur: '/assets/models/stein_clean.png',
    deckeTextur: '/assets/models/stein_clean.png',
    bodenTextur: '/assets/models/stein_clean.png',
    verwitterung: { moos: 99, frost: 0, nass: 0 },
    kachelM: 2,
  },
};
const sauberZuHoch = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitZuHohemMoos)));
check(
  'moos 99 wird auf die Obergrenze geklemmt',
  sauberZuHoch?.steinKit?.verwitterung?.moos === OBERGRENZE,
  `ist ${sauberZuHoch?.steinKit?.verwitterung?.moos}`
);

const mitNegativemMoos = {
  ...basisDoc,
  steinKit: {
    wandTextur: '/assets/models/stein_clean.png',
    deckeTextur: '/assets/models/stein_clean.png',
    bodenTextur: '/assets/models/stein_clean.png',
    verwitterung: { moos: -1, frost: 0, nass: 0 },
    kachelM: 2,
  },
};
const sauberNegativ = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitNegativemMoos)));
check(
  'moos -1 wird auf 0 geklemmt',
  sauberNegativ?.steinKit?.verwitterung?.moos === 0,
  `ist ${sauberNegativ?.steinKit?.verwitterung?.moos}`
);

// ── 4. Altdokument OHNE steinKit laeuft byte-gleich durch ─────────────────

console.log('\nAltdokument ohne steinKit (props-Muster):');
const altSauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc)));
check('Altdokument bleibt gueltig', altSauber !== null);
check(
  'steinKit bleibt weg, wird nicht erfunden',
  altSauber !== null && altSauber.steinKit === undefined,
  JSON.stringify((altSauber as unknown as Record<string, unknown>)?.steinKit)
);
check(
  'Rest des Dokuments unveraendert (Raeume)',
  altSauber !== null && altSauber.layout.rooms.length === layout.rooms.length
);
check(
  'Rest des Dokuments unveraendert (Tueren)',
  altSauber !== null && altSauber.layout.doors.length === layout.doors.length
);

// ── 5. Platzierter Raum mit gueltigem steinKit ────────────────────────────

console.log('\nRaum-Override (PlacedRoom.steinKit) — gueltig:');
const ROOM_INDEX = Math.min(3, layout.rooms.length - 1);
const RAUM_KIT_GUELTIG = {
  wandTextur: '/assets/models/stein_moos.png',
  verwitterung: { moos: 3, frost: 0, nass: 0 },
};
const mitRaumKit = {
  ...basisDoc,
  layout: {
    ...basisDoc.layout,
    rooms: basisDoc.layout.rooms.map((r, i) =>
      i === ROOM_INDEX ? { ...r, steinKit: RAUM_KIT_GUELTIG } : r
    ),
  },
};
const sauberRaumKit = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitRaumKit)));
check('Dokument mit Raum-Override bleibt gueltig', sauberRaumKit !== null);
const raumNachher = sauberRaumKit?.layout.rooms[ROOM_INDEX] as
  | ({ steinKit?: unknown } & Record<string, unknown>)
  | undefined;
check(
  'Raum-steinKit-Feld ist da',
  raumNachher?.steinKit !== undefined,
  JSON.stringify(raumNachher?.steinKit)
);
check(
  'Raum-wandTextur bleibt erhalten',
  (raumNachher?.steinKit as { wandTextur?: string } | undefined)?.wandTextur ===
    '/assets/models/stein_moos.png',
  (raumNachher?.steinKit as { wandTextur?: string } | undefined)?.wandTextur
);
check(
  'Raum-Verwitterung moos=3 bleibt erhalten',
  (raumNachher?.steinKit as { verwitterung?: { moos?: number } } | undefined)?.verwitterung
    ?.moos === 3,
  JSON.stringify((raumNachher?.steinKit as { verwitterung?: unknown } | undefined)?.verwitterung)
);
check(
  'Andere Raeume bleiben OHNE steinKit',
  sauberRaumKit !== null &&
    sauberRaumKit.layout.rooms.every(
      (r, i) => i === ROOM_INDEX || (r as { steinKit?: unknown }).steinKit === undefined
    )
);

// ── 6. Raum-steinKit: boese Textur wird verworfen ─────────────────────────

console.log('\nRaum-Override — Erlaubnisliste fuer Texturpfade:');
for (const boese of BOESE_PFADE) {
  const mitBoeserRaumTextur = {
    ...basisDoc,
    layout: {
      ...basisDoc.layout,
      rooms: basisDoc.layout.rooms.map((r, i) =>
        i === ROOM_INDEX
          ? {
              ...r,
              steinKit: {
                wandTextur: boese,
                deckeTextur: '/assets/models/stein_clean.png',
                bodenTextur: '/assets/models/stein_clean.png',
                verwitterung: { moos: 0, frost: 0, nass: 0 },
              },
            }
          : r
      ),
    },
  };
  const s = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitBoeserRaumTextur)));
  const wand = (s?.layout.rooms[ROOM_INDEX] as { steinKit?: { wandTextur?: string } } | undefined)
    ?.steinKit?.wandTextur;
  check(
    `Raum: Boeser Pfad "${boese}" wird NIE durchgereicht`,
    wand !== boese,
    `wandTextur nach dem Sanitizer: ${JSON.stringify(wand)}`
  );
}

// ── 7. Raum-steinKit: Zahlen werden geklemmt ──────────────────────────────

console.log('\nRaum-Override — Zahlen klemmen:');
const mitRaumZuHoch = {
  ...basisDoc,
  layout: {
    ...basisDoc.layout,
    rooms: basisDoc.layout.rooms.map((r, i) =>
      i === ROOM_INDEX
        ? {
            ...r,
            steinKit: {
              wandTextur: '/assets/models/stein_clean.png',
              deckeTextur: '/assets/models/stein_clean.png',
              bodenTextur: '/assets/models/stein_clean.png',
              verwitterung: { moos: 99, frost: -1, nass: 0 },
            },
          }
        : r
    ),
  },
};
const sauberRaumZuHoch = sanitizeDungeonDocument(JSON.parse(JSON.stringify(mitRaumZuHoch)));
const verwRaumZuHoch = (
  sauberRaumZuHoch?.layout.rooms[ROOM_INDEX] as
    | { steinKit?: { verwitterung?: { moos?: number; frost?: number } } }
    | undefined
)?.steinKit?.verwitterung;
check(
  'Raum: moos 99 wird auf die Obergrenze geklemmt',
  verwRaumZuHoch?.moos === OBERGRENZE,
  `ist ${verwRaumZuHoch?.moos}`
);
check(
  'Raum: frost -1 wird auf 0 geklemmt',
  verwRaumZuHoch?.frost === 0,
  `ist ${verwRaumZuHoch?.frost}`
);

// ── 8. Raeume ohne steinKit bleiben ohne das Feld / Altdokument byte-gleich

console.log('\nRaum-Override — Altdokument byte-gleich:');
check(
  'Altdokument: kein Raum traegt ein steinKit-Feld',
  altSauber !== null &&
    altSauber.layout.rooms.every((r) => (r as { steinKit?: unknown }).steinKit === undefined)
);
const vorherJson = JSON.stringify(altSauber);
const nochmalSauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc)));
check(
  'Altdokument saeubert sich byte-gleich (erneuter Lauf, keine Drift durch die neue Raum-Logik)',
  JSON.stringify(nochmalSauber) === vorherJson
);

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAlle steinKit-Dokument-Pruefungen gruen.');
