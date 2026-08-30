/**
 * Messender Nachweis fuer das eingefrorene Layout-Datenformat v1 (AP1).
 * Measuring proof for the frozen layout data format v1 (AP1).
 *
 *   npx tsx test/dungeon2-layout.ts
 *
 * Geprueft werden die vier Kriterien aus `design/ARCHITECTURE.md`, AP1:
 * Checked are the four criteria from `design/ARCHITECTURE.md`, AP1:
 *
 *   (a) Ein von Hand geschriebenes Zwei-Raum-Layout wird kanonisiert und
 *       ergibt eine EINGEFRORENE Pruefsumme. Aendert sich die Kanonisierung,
 *       faellt der Test — das ist der ganze Zweck.
 *       A hand-written two-room layout is canonicalised and yields a FROZEN
 *       checksum. If canonicalisation changes, the test fails — that is the point.
 *   (b) Dieselben Daten in anderer Feld- UND Array-Reihenfolge ergeben
 *       DIESELBE Pruefsumme.
 *       The same data in different field AND array order yields the SAME checksum.
 *   (c) `hashPos` ueber eingefrorene Eingaben — gehoert zu `hashing.ts` und ist
 *       NICHT Teil dieses Pakets; hier steht stattdessen die eingefrorene
 *       Wertetabelle von `fnv1a32`, auf dem die Layout-Pruefsumme sitzt.
 *       `hashPos` belongs to `hashing.ts` and is not part of this package;
 *       instead the frozen value table of `fnv1a32` is checked here.
 *   (d) Ein Layout mit eingeschmuggelter Fliesskommazahl wird von der
 *       Typpruefung (`migriere()`, dem einzigen Ort, an dem `0.5` von `1`
 *       unterschieden werden KANN — TypeScript kann es nicht) UND von
 *       `validateLayout` abgelehnt.
 *       A layout with a smuggled float is rejected by the type check
 *       (`migriere()`, the only place where `0.5` CAN be told from `1` —
 *       TypeScript cannot) AND by `validateLayout`.
 *
 * Dazu kommt fuer jede Invariante ein Positiv- und ein Negativfall: Ein Test,
 * der nie rot war, ist kein Test.
 * Plus a positive and a negative case per invariant: a test that was never red
 * is not a test.
 */

import {
  ANKER_ORT,
  BLOCK_ZELLEN,
  EBENE_M,
  HOEHEN_SCHRITT_M,
  KANTE,
  LAYOUT_FORMAT,
  LAYOUT_VERSION,
  MIN_LICHTE_STUFEN,
  ZELLE_M,
  ZELLEN_ART,
  fnv1a32,
  gegenKante,
  kanonisch,
  kanonisiereKante,
  layoutPruefsumme,
  migriere,
  mitPruefsumme,
  nachbarZelle,
  nurFehler,
  validateLayout,
  type Befund,
  type DekoAnker,
  type DungeonLayout2,
  type Kante,
  type LayoutRegel,
  type RaumStempel,
  type Tuer,
  type ZellenKorrektur,
} from '../src/dungeon2/layout.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pruefgeruest / test harness
// ─────────────────────────────────────────────────────────────────────────────

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

/** Enthaelt der Befundsatz genau diese Regel als `fehler`? / Rule present as error? */
function hatFehler(befunde: readonly Befund[], regel: LayoutRegel): boolean {
  return befunde.some((b) => b.regel === regel && b.schwere === 'fehler');
}

// ─────────────────────────────────────────────────────────────────────────────
// Das Zwei-Raum-Layout von Hand / the hand-written two-room layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grabkammer (6x6) und ein Gang (2x8) daneben, verbunden durch eine Tuer auf
 * der Ost-Kante von (5,2). Bewusst klein und von Hand geschrieben: Ein
 * generiertes Layout waere als eingefrorene Referenz wertlos, weil es sich mit
 * dem Generator mitaendert.
 * A burial chamber (6x6) and a corridor (2x8) beside it, joined by a door on
 * the east edge of (5,2). Deliberately small and hand-written: a generated
 * layout would be worthless as a frozen reference because it would drift with
 * the generator.
 */
const STEMPEL: RaumStempel[] = [
  {
    id: 1,
    typ: 'grabkammer',
    x: 0,
    z: 0,
    ebene: 0,
    breite: 6,
    tiefe: 6,
    hoehe: 12,
    bodenVersatz: 0,
    drehung: 0,
    seed: 111,
    variante: 0,
    // Absichtlich GEGEN die Id-Reihenfolge: Nur so unterscheidet die
    // eingefrorene Pruefsumme, ob nach `ordnung` oder nach `id` sortiert wird.
    // Deliberately AGAINST the id order: only then does the frozen checksum
    // tell apart sorting by `ordnung` from sorting by `id`.
    ordnung: 1,
    tiefeImBaum: 1,
  },
  {
    id: 2,
    typ: 'gang',
    x: 6,
    z: 2,
    ebene: 0,
    breite: 8,
    tiefe: 2,
    hoehe: 8,
    bodenVersatz: 0,
    drehung: 1,
    seed: 222,
    variante: 1,
    ordnung: 0,
    tiefeImBaum: 0,
  },
];

const KORREKTUREN: ZellenKorrektur[] = [
  { x: 2, z: 2, ebene: 0, aendere: { materialTag: 2, oberflaeche: 0 } },
  { x: 3, z: 2, ebene: 0, aendere: { art: ZELLEN_ART.Wasser, boden: -1 } },
  { x: 9, z: 3, ebene: 0, aendere: {}, loeschen: true },
];

const TUEREN: Tuer[] = [
  { x: 5, z: 2, ebene: 0, kante: KANTE.Ost, art: 'steinplatte', zustand: 'zu' },
  {
    x: 5,
    z: 3,
    ebene: 0,
    kante: KANTE.Ost,
    art: 'gitter',
    zustand: 'verschlossen',
    schluessel: 'grabschluessel',
  },
];

const ANKER: DekoAnker[] = [
  {
    id: 10,
    x: 1,
    z: 1,
    ebene: 0,
    ort: ANKER_ORT.Wand,
    kante: KANTE.West,
    u: 4,
    v: 0,
    h: 4,
    drehung: 3,
    rolle: 'fackel',
    seed: 7,
    stempelId: 1,
  },
  {
    id: 11,
    x: 3,
    z: 3,
    ebene: 0,
    ort: ANKER_ORT.Boden,
    u: 4,
    v: 4,
    h: 0,
    drehung: 0,
    rolle: 'sarkophag',
    prefab: 'DG_Sarkophag_A',
    seed: 8,
    stempelId: 1,
  },
  {
    id: 12,
    x: 12,
    z: 2,
    ebene: 0,
    ort: ANKER_ORT.Decke,
    u: 4,
    v: 4,
    h: 8,
    drehung: 0,
    rolle: 'wurzel',
    seed: 9,
    stempelId: -1,
  },
];

function baueLayout(): DungeonLayout2 {
  const roh: DungeonLayout2 = {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    id: 'steingrab-pruefstueck',
    name: 'Prüfstück Steingrab',
    thema: 'steingrab',
    seeds: { architektur: 4711, material: 815, deko: 1234 },
    raster: {
      zelleM: ZELLE_M,
      ebeneM: EBENE_M,
      hoehenSchrittM: HOEHEN_SCHRITT_M,
      blockZellen: BLOCK_ZELLEN,
    },
    grenzen: { minX: -4, maxX: 20, minZ: -4, maxZ: 20, minEbene: 0, maxEbene: 1 },
    eingang: { x: 13, z: 2, ebene: 0, kante: KANTE.Ost },
    stempel: STEMPEL,
    korrekturen: KORREKTUREN,
    tueren: TUEREN,
    anker: ANKER,
    pruefsumme: '',
  };
  return mitPruefsumme(roh);
}

const LAYOUT = baueLayout();

// ─────────────────────────────────────────────────────────────────────────────
// (a) Eingefrorene Pruefsumme / frozen checksum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EINGEFROREN. Diese Zahl aendert sich nur mit einer Formatversion. Wer sie
 * anpasst, weil „der Test rot ist", hat den Zeugen abgeschafft.
 * FROZEN. This value changes only with a format version. Adjusting it because
 * "the test is red" abolishes the witness.
 */
const PRUEFSUMME_EINGEFROREN = 'e749ebbf';
const KANONISCH_LAENGE_EINGEFROREN = 605;

pruefeGleich('(a) Pruefsumme des Zwei-Raum-Layouts', LAYOUT.pruefsumme, PRUEFSUMME_EINGEFROREN);
pruefeGleich(
  '(a) Laenge der kanonischen Form',
  kanonisch(LAYOUT).length,
  KANONISCH_LAENGE_EINGEFROREN
);
pruefe(
  '(a) kanonisch() enthaelt die Pruefsumme NICHT',
  !kanonisch(LAYOUT).includes(PRUEFSUMME_EINGEFROREN)
);

// ─────────────────────────────────────────────────────────────────────────────
// (b) Andere Feld- und Array-Reihenfolge, gleiche Pruefsumme
// ─────────────────────────────────────────────────────────────────────────────

/** Dreht die Schluesselreihenfolge eines Objekts um. / Reverses key order. */
function schluesselUmgedreht<T extends object>(o: T): T {
  const paare = Object.entries(o).reverse();
  const neu: Record<string, unknown> = {};
  for (const [k, w] of paare) neu[k] = w;
  return neu as T;
}

const LAYOUT_GEMISCHT: DungeonLayout2 = schluesselUmgedreht({
  ...LAYOUT,
  seeds: schluesselUmgedreht(LAYOUT.seeds),
  raster: schluesselUmgedreht(LAYOUT.raster),
  grenzen: schluesselUmgedreht(LAYOUT.grenzen),
  eingang: schluesselUmgedreht(LAYOUT.eingang),
  stempel: [...LAYOUT.stempel].reverse().map(schluesselUmgedreht),
  korrekturen: [...LAYOUT.korrekturen]
    .reverse()
    .map((k) => schluesselUmgedreht({ ...k, aendere: schluesselUmgedreht(k.aendere) })),
  tueren: [...LAYOUT.tueren].reverse().map(schluesselUmgedreht),
  anker: [...LAYOUT.anker].reverse().map(schluesselUmgedreht),
});

pruefeGleich(
  '(b) gemischte Feld- und Array-Reihenfolge ergibt dieselbe Pruefsumme',
  layoutPruefsumme(LAYOUT_GEMISCHT),
  PRUEFSUMME_EINGEFROREN
);
pruefeGleich(
  '(b) gemischte Reihenfolge ergibt denselben kanonischen Text',
  kanonisch(LAYOUT_GEMISCHT),
  kanonisch(LAYOUT)
);

// `loeschen: false` und ein fehlendes `loeschen` sind dasselbe; `-0` und `0`
// auch. Beides sind stille Auseinanderlauf-Quellen.
// `loeschen: false` equals an absent `loeschen`; `-0` equals `0`. Both are
// silent divergence sources.
const LAYOUT_SCHREIBWEISEN: DungeonLayout2 = {
  ...LAYOUT,
  korrekturen: LAYOUT.korrekturen.map((k) =>
    k.loeschen === true ? k : { ...k, loeschen: false }
  ),
  eingang: { ...LAYOUT.eingang, ebene: -0 },
};
pruefeGleich(
  '(b) loeschen:false und -0 aendern die Pruefsumme nicht',
  layoutPruefsumme(LAYOUT_SCHREIBWEISEN),
  PRUEFSUMME_EINGEFROREN
);

// Gegenprobe: Ein geaendertes Feld MUSS die Pruefsumme aendern.
// Counter-check: a changed field MUST change the checksum.
pruefe(
  '(b, negativ) ein geaenderter Seed aendert die Pruefsumme',
  layoutPruefsumme({ ...LAYOUT, seeds: { ...LAYOUT.seeds, material: 816 } }) !==
    PRUEFSUMME_EINGEFROREN
);
pruefe(
  '(b, negativ) eine geaenderte Stempelordnung aendert die Pruefsumme',
  layoutPruefsumme({
    ...LAYOUT,
    stempel: [STEMPEL[0]!, { ...STEMPEL[1]!, ordnung: 9 }],
  }) !== PRUEFSUMME_EINGEFROREN
);

// ─────────────────────────────────────────────────────────────────────────────
// (c) Eingefrorene Wertetabelle des Hashes / frozen hash value table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32 Bit, gegen die Referenzwerte des Verfahrens geprueft, plus zwei
 * Faelle mit Nicht-ASCII (die UTF-8-Umrechnung steht ausgeschrieben und muss in
 * Node und Browser dieselben Bytes liefern).
 * FNV-1a 32 bit against the algorithm's published reference values, plus two
 * non-ASCII cases (the UTF-8 conversion is spelled out and must produce the
 * same bytes in Node and the browser).
 */
const HASH_TABELLE: ReadonlyArray<readonly [string, number]> = [
  ['', 0x811c9dc5],
  ['a', 0xe40c292c],
  ['foobar', 0xbf9cf968],
  ['Prüfstück', 0xaa072a70],
  ['🪦', 0xba1ea778],
];

for (const [text, soll] of HASH_TABELLE) {
  pruefeGleich(`(c) fnv1a32(${JSON.stringify(text)})`, fnv1a32(text), soll);
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) Fliesskommazahl wird abgelehnt / a float is rejected
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TypeScript kann `0.5` nicht von `1` unterscheiden — beides ist `number`.
 * Die Typpruefung des FORMATS ist deshalb `migriere()`, das rohe Daten liest.
 * Wir schmuggeln die Zahl ueber genau den Weg ein, auf dem sie in echt kaeme:
 * ueber JSON aus einem Dokument.
 * TypeScript cannot tell `0.5` from `1` — both are `number`. The FORMAT's type
 * check is therefore `migriere()`, which reads raw data. The float is smuggled
 * in exactly the way it would arrive in reality: through JSON from a document.
 */
const ROH_MIT_KOMMA = JSON.parse(JSON.stringify(LAYOUT)) as Record<string, unknown>;
(ROH_MIT_KOMMA.eingang as Record<string, unknown>).x = 13.5;

pruefeGleich('(d) migriere() lehnt die Fliesskommazahl ab', migriere(ROH_MIT_KOMMA), null);

const LAYOUT_MIT_KOMMA = ROH_MIT_KOMMA as unknown as DungeonLayout2;
pruefe(
  '(d) validateLayout meldet regel "ganzzahl"',
  hatFehler(validateLayout(LAYOUT_MIT_KOMMA), 'ganzzahl')
);

// Auch in einer Korrektur und in einem Stempel.
// Also inside a fix and inside a stamp.
for (const [name, bau] of [
  [
    'Stempel.hoehe',
    (): unknown => {
      const r = JSON.parse(JSON.stringify(LAYOUT)) as Record<string, unknown>;
      (r.stempel as Array<Record<string, unknown>>)[0]!.hoehe = 12.25;
      return r;
    },
  ],
  [
    'Korrektur.aendere.boden',
    (): unknown => {
      const r = JSON.parse(JSON.stringify(LAYOUT)) as Record<string, unknown>;
      const k = (r.korrekturen as Array<Record<string, unknown>>)[1]!;
      (k.aendere as Record<string, unknown>).boden = -1.5;
      return r;
    },
  ],
  [
    'Anker.h',
    (): unknown => {
      const r = JSON.parse(JSON.stringify(LAYOUT)) as Record<string, unknown>;
      (r.anker as Array<Record<string, unknown>>)[0]!.h = 4.5;
      return r;
    },
  ],
] as const) {
  const roh = bau();
  pruefeGleich(`(d) migriere() lehnt ${name} ab`, migriere(roh), null);
  pruefe(
    `(d) validateLayout meldet "ganzzahl" fuer ${name}`,
    hatFehler(validateLayout(roh as DungeonLayout2), 'ganzzahl')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invarianten: Positivfall / invariants: positive case
// ─────────────────────────────────────────────────────────────────────────────

const BEFUNDE_GUT = validateLayout(LAYOUT);
pruefe(
  'Positivfall: das gueltige Layout hat keinen Fehler',
  nurFehler(BEFUNDE_GUT).length === 0,
  nurFehler(BEFUNDE_GUT)
    .map((b) => `${b.regel}@${b.wo}`)
    .join(', ')
);
pruefe(
  'Positivfall: das gueltige Layout hat auch keine Warnung',
  BEFUNDE_GUT.length === 0,
  BEFUNDE_GUT.map((b) => `${b.schwere}:${b.regel}@${b.wo}`).join(', ')
);

// ─────────────────────────────────────────────────────────────────────────────
// Invarianten: Negativfaelle / invariants: negative cases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jeder Negativfall nennt die Regel, die er ausloesen MUSS. Ein Negativfall
 * ohne erwarteten Regelnamen prueft nur, dass irgendetwas schiefging.
 * Every negative case names the rule it MUST trigger. A negative case without
 * an expected rule name only checks that something went wrong.
 */
const NEGATIV: ReadonlyArray<readonly [string, LayoutRegel, () => DungeonLayout2]> = [
  [
    'materialTag 6 ist ein Overlay, kein Zellmaterial',
    'material-tag',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        korrekturen: [{ x: 2, z: 2, ebene: 0, aendere: { materialTag: 6 } }],
      }),
  ],
  [
    'Tuer auf der Sued-Kante ist nicht kanonisiert',
    'tuer-kanonisch',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        tueren: [{ x: 5, z: 3, ebene: 0, kante: KANTE.Sued, art: 'holz', zustand: 'offen' }],
      }),
  ],
  [
    'zwei Stempel mit derselben Id',
    'doppelte-id',
    () => mitPruefsumme({ ...LAYOUT, stempel: [STEMPEL[0]!, { ...STEMPEL[1]!, id: 1 }] }),
  ],
  [
    'zwei Korrekturen auf derselben Zelle',
    'doppelte-korrektur',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        korrekturen: [
          { x: 2, z: 2, ebene: 0, aendere: { materialTag: 1 } },
          { x: 2, z: 2, ebene: 0, aendere: { materialTag: 2 } },
        ],
      }),
  ],
  [
    'zwei Tueren auf derselben Kante',
    'doppelte-tuer',
    () => mitPruefsumme({ ...LAYOUT, tueren: [TUEREN[0]!, { ...TUEREN[0]!, art: 'holz' }] }),
  ],
  [
    'Raumhoehe unter der lichten Mindesthoehe',
    'stempel-lichte',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        stempel: [{ ...STEMPEL[0]!, hoehe: MIN_LICHTE_STUFEN - 1 }, STEMPEL[1]!],
      }),
  ],
  [
    'Stempel ohne Grundflaeche',
    'stempel-groesse',
    () => mitPruefsumme({ ...LAYOUT, stempel: [{ ...STEMPEL[0]!, breite: 0 }, STEMPEL[1]!] }),
  ],
  [
    'Wandanker ohne Kante',
    'anker-feld',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        anker: [ohneKante(ANKER[0]!)],
      }),
  ],
  [
    'Anker zeigt auf einen Stempel, den es nicht gibt',
    'anker-stempel',
    () => mitPruefsumme({ ...LAYOUT, anker: [{ ...ANKER[0]!, stempelId: 99 }] }),
  ],
  [
    'Ankerversatz ausserhalb der Achtel',
    'anker-feld',
    () => mitPruefsumme({ ...LAYOUT, anker: [{ ...ANKER[0]!, u: 9 }] }),
  ],
  [
    'Drehung ist keine Vierteldrehung',
    'drehung',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        stempel: [{ ...STEMPEL[0]!, drehung: 4 as 0 | 1 | 2 | 3 }, STEMPEL[1]!],
      }),
  ],
  [
    'Kante ist keine einzelne Kante',
    'kante-bit',
    () => mitPruefsumme({ ...LAYOUT, eingang: { ...LAYOUT.eingang, kante: 3 as Kante } }),
  ],
  [
    'verschlossene Tuer ohne Schluessel',
    'tuer-feld',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        tueren: [{ x: 5, z: 2, ebene: 0, kante: KANTE.Ost, art: 'holz', zustand: 'verschlossen' }],
      }),
  ],
  [
    'Eingang ausserhalb der Grenzen',
    'grenzen',
    () => mitPruefsumme({ ...LAYOUT, eingang: { ...LAYOUT.eingang, x: 999 } }),
  ],
  [
    'leere Grenzen',
    'grenzen',
    () => mitPruefsumme({ ...LAYOUT, grenzen: { ...LAYOUT.grenzen, minX: 30 } }),
  ],
  [
    'falsches Format',
    'format',
    () => ({ ...LAYOUT, format: 'irgendwas' as typeof LAYOUT_FORMAT }),
  ],
  ['unbekannte Version', 'version', () => mitPruefsumme({ ...LAYOUT, version: 99 })],
  [
    'unbekannte Zellenart',
    'zellen-art',
    () =>
      mitPruefsumme({
        ...LAYOUT,
        korrekturen: [{ x: 2, z: 2, ebene: 0, aendere: { art: 9 as never } }],
      }),
  ],
  [
    'unbekannter Ankerort',
    'anker-ort',
    () => mitPruefsumme({ ...LAYOUT, anker: [{ ...ANKER[1]!, ort: 7 as never }] }),
  ],
  [
    'die Pruefsumme luegt',
    'pruefsumme',
    () => ({ ...LAYOUT, pruefsumme: '00000000' }),
  ],
];

/** Entfernt das optionale `kante`-Feld. / Drops the optional `kante` field. */
function ohneKante(a: DekoAnker): Omit<DekoAnker, 'kante'> {
  const { kante: _weg, ...rest } = a;
  return rest;
}

for (const [name, regel, bau] of NEGATIV) {
  const befunde = validateLayout(bau());
  pruefe(
    `Negativfall: ${name} -> "${regel}"`,
    hatFehler(befunde, regel),
    `gemeldet wurde: ${befunde.map((b) => `${b.schwere}:${b.regel}`).join(', ') || '(nichts)'}`
  );
}

// Das abweichende Raster ist ausdruecklich KEIN Fehler, aber eine Warnung —
// genau deshalb steht es im Dokument.
// A deviating grid is explicitly NOT an error but a warning — which is exactly
// why it is stored in the document.
{
  const abweichend = mitPruefsumme({
    ...LAYOUT,
    raster: { ...LAYOUT.raster, blockZellen: 16 },
  });
  const befunde = validateLayout(abweichend);
  pruefe('abweichendes Raster ist eine Warnung, kein Fehler', nurFehler(befunde).length === 0);
  pruefe(
    'abweichendes Raster wird als "raster" gemeldet',
    befunde.some((b) => b.regel === 'raster' && b.schwere === 'warnung')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration / migration
// ─────────────────────────────────────────────────────────────────────────────

{
  const roh = JSON.parse(JSON.stringify(LAYOUT)) as unknown;
  const zurueck = migriere(roh);
  pruefe('migriere(): JSON-Rundlauf liefert ein Layout', zurueck !== null);
  pruefeGleich('migriere(): Pruefsumme bleibt erhalten', zurueck?.pruefsumme, PRUEFSUMME_EINGEFROREN);
  pruefeGleich('migriere(): kanonische Form bleibt gleich', kanonisch(zurueck!), kanonisch(LAYOUT));
  pruefe('migriere(): das Ergebnis ist gueltig', nurFehler(validateLayout(zurueck!)).length === 0);
}

pruefeGleich('migriere(): Fremdformat ergibt null', migriere({ format: 'wov-dungeon', version: 9 }), null);
pruefeGleich('migriere(): kein Objekt ergibt null', migriere(42), null);
pruefeGleich('migriere(): null ergibt null', migriere(null), null);
pruefeGleich(
  'migriere(): zu neue Version ergibt null',
  migriere({ ...JSON.parse(JSON.stringify(LAYOUT)), version: LAYOUT_VERSION + 1 }),
  null
);

// `loeschen: false` wird beim Lesen vereinheitlicht — sonst haette dasselbe
// Dokument zwei Pruefsummen, je nachdem wer es geschrieben hat.
// `loeschen: false` is unified on read — otherwise the same document would
// have two checksums depending on who wrote it.
{
  const roh = JSON.parse(JSON.stringify(LAYOUT)) as Record<string, unknown>;
  for (const k of roh.korrekturen as Array<Record<string, unknown>>) {
    if (k.loeschen !== true) k.loeschen = false;
  }
  const zurueck = migriere(roh);
  pruefeGleich(
    'migriere(): loeschen:false wird vereinheitlicht',
    zurueck?.pruefsumme,
    PRUEFSUMME_EINGEFROREN
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kantenrechnung / edge arithmetic
// ─────────────────────────────────────────────────────────────────────────────

// Norden = +z, Osten = +x — Projektkonvention aus Minimap.ts/WorldMap.ts.
// North = +z, east = +x — project convention from Minimap.ts/WorldMap.ts.
pruefeGleich('nachbarZelle Nord ist +z', JSON.stringify(nachbarZelle(3, 7, KANTE.Nord)), '{"x":3,"z":8}');
pruefeGleich('nachbarZelle Ost ist +x', JSON.stringify(nachbarZelle(3, 7, KANTE.Ost)), '{"x":4,"z":7}');
pruefeGleich('nachbarZelle Sued ist -z', JSON.stringify(nachbarZelle(3, 7, KANTE.Sued)), '{"x":3,"z":6}');
pruefeGleich('nachbarZelle West ist -x', JSON.stringify(nachbarZelle(3, 7, KANTE.West)), '{"x":2,"z":7}');

for (const kante of [KANTE.Nord, KANTE.Ost, KANTE.Sued, KANTE.West] as Kante[]) {
  pruefe('gegenKante ist eine Involution', gegenKante(gegenKante(kante)) === kante);
  // Kanonisieren ist idempotent, und beide Seiten derselben Kante landen auf
  // demselben Eintrag — sonst stuenden zwei Tueren in einer Wand.
  // Canonicalising is idempotent, and both sides of the same edge land on the
  // same entry — otherwise two doors would sit in one wall.
  const einmal = kanonisiereKante(5, 5, 0, kante);
  const zweimal = kanonisiereKante(einmal.x, einmal.z, einmal.ebene, einmal.kante);
  pruefeGleich(
    `kanonisiereKante ist idempotent (${kante})`,
    JSON.stringify(zweimal),
    JSON.stringify(einmal)
  );
  const n = nachbarZelle(5, 5, kante);
  const vonDrueben = kanonisiereKante(n.x, n.z, 0, gegenKante(kante));
  pruefeGleich(
    `beide Seiten der Kante ${kante} kanonisieren gleich`,
    JSON.stringify(vonDrueben),
    JSON.stringify(einmal)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--zeige')) {
  console.log('── kanonische Form / canonical form ──');
  console.log(kanonisch(LAYOUT));
  console.log('── Pruefsumme:', LAYOUT.pruefsumme, 'Laenge:', kanonisch(LAYOUT).length);
}

console.log(`dungeon2-layout: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
