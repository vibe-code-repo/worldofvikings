/**
 * Hält `shared/src/storeFlora.ts` gegen den Store fest: Gibt es jede
 * genannte Art, und ergibt jede Biomliste eine Landschaft?
 *
 * Zwei Fragen, und beide beantwortet der Test aus dem STORE, nicht aus
 * einer zweiten Tabelle im Testcode:
 *
 *  (a) NAME UND DATEI. Jeder Name in `storeFlora.ts` steht in
 *      `assets/store/prefabs.json`, und die dort genannte GLB liegt
 *      wirklich da. Ein Tippfehler bricht nichts — er erzeugt einen
 *      Streueintrag, den `findPrefabByHash()` nie findet, und die Region
 *      bleibt an dieser Art einfach kahl. Lautlos.
 *
 *      Bewusst gegen `prefabs.json` und NICHT gegen
 *      `shared/src/storePrefabs.ts`: Diese Datei entsteht parallel, und
 *      ein Test, der auf sie wartet, prüft in der Zwischenzeit gar
 *      nichts. `prefabs.json` ist die gemeinsame Quelle von beidem.
 *
 *  (b) LANDSCHAFT. Eine Biomliste ohne Baum ist eine Steppe, eine ohne
 *      Strauch ist ein Park — beides kann gewollt sein, aber nicht
 *      versehentlich. Baum und Strauch werden dabei nicht am NAMEN
 *      erkannt (`-tree-` hiesse nichts: `large-bush-1a4` ist 4,4 m hoch
 *      und `tree-1a4-2` ein 16-Dreieck-Stumpf), sondern an der GEMESSENEN
 *      HÖHE aus `prefabs.json`:
 *
 *          Baum     >= 5 m
 *          Strauch  0,5 … 5 m
 *          Boden    < 0,5 m
 *
 *      Die Grenze bei 5 m ist die Kopfhöhe mal drei — darunter geht man
 *      vorbei, darüber geht man hindurch.
 *
 *      Die Aschewüste ist AUSGENOMMEN, und das ist der Befund und nicht
 *      die Lücke: Sie führt ausschliesslich kahle Stämme (siehe
 *      `STORE_ASCHE_FLORA`). Statt der Strauchpflicht gilt für sie die
 *      Gegenprobe — KEIN Eintrag darf Laub tragen. Geprüft wird das an
 *      den Materialrollen aus `assets/store-lab/vegetation/BERICHT.json`,
 *      also am Ergebnis der Aufbereitung, nicht an einer Vermutung.
 *
 *  (c) SCHNEE NUR IM HOHEN NORDEN. Die beiden `-snow`-Varianten sind die
 *      einzigen des Bestands mit heller statt grüner Tönung. Eine davon
 *      im Grasland wäre ein weisser Busch auf der Sommerwiese — sichtbar,
 *      aber erst im Bild und erst, wenn jemand hinsieht.
 *
 * WEICHE: Fehlt `assets/store` GANZ, überspringt `scripts/run-tests.mjs`
 * diesen Test (`brauchtModelle('assets/store')`). Fehlt eine EINZELNE
 * Datei, wird er rot — die Sonde entscheidet nie selbst, ob sie laufen
 * darf (siehe scripts/testweichen.mjs).
 *
 *   npx tsx tools/test/store-flora.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STORE_FLORA_BUENDEL } from '../../shared/src/storeFlora.js';
import { zeichnetDerGrasClutter } from '../../shared/src/storeKatalog.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');
const PREFABS = join(STORE, 'prefabs.json');
const BERICHT = join(WURZEL, 'assets/store-lab/vegetation/BERICHT.json');

/** Ab hier ist es ein Baum: Kopfhöhe mal drei. */
const BAUMHOEHE = 5;
/** Darunter ist es Bodenbewuchs, kein Strauch. */
const STRAUCHHOEHE = 0.5;

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

check('assets/store/prefabs.json existiert', existsSync(PREFABS));
if (fehler > 0) {
  console.error('\nOhne den Store lässt sich nichts prüfen — Weiche in run-tests.mjs.');
  process.exit(1);
}

type StorePrefab = { id: string; asset: string; bounds: { min: number[]; max: number[] } };
const prefabs: StorePrefab[] = JSON.parse(readFileSync(PREFABS, 'utf8')).prefabs;
const jeId = new Map(prefabs.map((p) => [p.id, p]));

// ── (a) Name und Datei ───────────────────────────────────────────────
const fehlendeNamen: string[] = [];
const fehlendeDateien: string[] = [];
const doppelt: string[] = [];
const biomJeName = new Map<string, string>();
let arten = 0;
for (const [biom, liste] of STORE_FLORA_BUENDEL) {
  for (const eintrag of liste) {
    arten++;
    const prefab = jeId.get(eintrag.name);
    if (!prefab) {
      fehlendeNamen.push(`${eintrag.name} (${biom})`);
      continue;
    }
    if (!existsSync(join(STORE, prefab.asset))) fehlendeDateien.push(prefab.asset);
    const vorher = biomJeName.get(eintrag.name);
    if (vorher) doppelt.push(`${eintrag.name}: ${vorher} + ${biom}`);
    biomJeName.set(eintrag.name, biom);
  }
}
check(`alle ${arten} Store-Streueinträge stehen in prefabs.json`, fehlendeNamen.length === 0, fehlendeNamen.join(', '));
check('zu jedem Eintrag liegt die GLB im Store', fehlendeDateien.length === 0, fehlendeDateien.join(', '));
/*
  Kein Name in zwei Bündeln — die Regel „ein Prefab, ein Biom" aus dem
  Kopf von storeFlora.ts. Sie ist keine technische Notwendigkeit
  (`EIGENE_FLORA` entdoppelt ohnehin nach Namen), aber ihre Verletzung
  ist unlesbar: Es stünden zwei Zahlensätze da, von denen der zweite
  wirkungslos ist, und das sieht man der Zeile nicht an.
*/
check('kein Store-Prefab steht in zwei Biomlisten', doppelt.length === 0, doppelt.join('; '));

if (fehler > 0) {
  console.error('\nOhne auflösbare Namen ist der Rest nicht messbar.');
  process.exit(1);
}

// ── (b) Landschaft ───────────────────────────────────────────────────
const hoehe = (name: string): number => jeId.get(name)!.bounds.max[1];

for (const [biom, liste] of STORE_FLORA_BUENDEL) {
  const baeume = liste.filter((f) => hoehe(f.name) >= BAUMHOEHE);
  const straeucher = liste.filter((f) => hoehe(f.name) >= STRAUCHHOEHE && hoehe(f.name) < BAUMHOEHE);
  const boden = liste.filter((f) => hoehe(f.name) < STRAUCHHOEHE);
  console.log(
    `     ${biom.padEnd(10)} ${String(liste.length).padStart(2)} Arten: ${baeume.length} Bäume, ` +
      `${straeucher.length} Sträucher, ${boden.length} Bodenbewuchs`
  );
  check(`${biom}: mindestens ein Baum (>= ${BAUMHOEHE} m)`, baeume.length > 0);
  if (biom === 'asche') continue; // siehe Kopf: Aschewüste führt nur kahle Stämme
  check(`${biom}: mindestens ein Strauch (${STRAUCHHOEHE}–${BAUMHOEHE} m)`, straeucher.length > 0);
}

/*
  Die Gegenprobe für die Aschewüste. Sie liest die Materialrollen aus dem
  Bericht der Aufbereitung — dort steht je Primitiv, ob es `rinde`,
  `laub`, `nadeln` … ist, und zwar aus der Geometrie hergeleitet und nicht
  aus dem Namen geraten.

  Fehlt der Bericht, ist das kein Fehlschlag, sondern eine offene Frage:
  Er entsteht erst beim Lauf des Werkzeugs, und der Store-Ordner ist
  gitignoriert. Ein roter Test dafür wäre eine Aufforderung, ihn zu
  ignorieren.
*/
if (!existsSync(BERICHT)) {
  console.log('     (BERICHT.json fehlt — node tools/store-vegetation-aufbereiten.mjs für die Aschewüsten-Gegenprobe)');
} else {
  type Bericht = { modelle: Record<string, { primitive: { rolle: string }[] }> };
  const bericht: Bericht = JSON.parse(readFileSync(BERICHT, 'utf8'));
  const belaubt: string[] = [];
  for (const [, liste] of STORE_FLORA_BUENDEL.filter(([b]) => b === 'asche')) {
    for (const eintrag of liste) {
      const stamm = jeId.get(eintrag.name)!.asset.replace('vegetation/', '').replace(/\.glb$/, '');
      const rollen = bericht.modelle[stamm]?.primitive.map((p) => p.rolle) ?? [];
      if (rollen.some((r) => r !== 'rinde')) belaubt.push(`${eintrag.name}: ${[...new Set(rollen)].join('+')}`);
    }
  }
  check('asche: kein Eintrag trägt Laub — nur kahle Stämme', belaubt.length === 0, belaubt.join(', '));
}

// ── (c) Schnee nur im Hohen Norden ───────────────────────────────────
const schneeFalsch = [...biomJeName].filter(([name, biom]) => /-snow$/.test(name) && biom !== 'hochnord');
check(
  'keine -snow-Variante ausserhalb des Hohen Nordens',
  schneeFalsch.length === 0,
  schneeFalsch.map(([n, b]) => `${n} in ${b}`).join(', ')
);
/*
  Und die Gegenrichtung, sonst wäre der Test durch Löschen zu bestehen:
  Der Store hat genau zwei `-snow`-Modelle, und beide sollen benutzt
  werden. Sie sind die einzigen mit heller statt grüner Tönung — wer sie
  nicht streut, hat kein Winterbiom, sondern ein grünes mit weniger
  Bewuchs.
*/
const schneeImStore = prefabs.filter((p) => p.asset.startsWith('vegetation/') && /-snow$/.test(p.id));
/*
  ⚠ Seit Stufe 2 gibt es einen ZWEITEN Weg in die Welt: Was der
  Gras-Clutter zeichnet, wird nicht mehr gestreut
  (`zeichnetDerGrasClutter`, Begründung bei `STORE_GRAS_AKTIV`).
  `grass-short-clump-snow` ist eines der beiden `-snow`-Modelle und steht
  deshalb in KEINER Streuliste mehr.

  Die Zusage dieses Wächters bleibt dieselbe — „beide Schneemodelle
  werden benutzt" —, sie hat nur zwei Erfüllungswege. Durch Löschen ist
  er weiterhin nicht zu bestehen: Der zweite Weg verlangt, dass das
  Modell in `STORE_GRAS_IM_CLUTTER` steht.
*/
const schneeBenutzt = schneeImStore.filter(
  (p) => biomJeName.get(p.id) === 'hochnord' || zeichnetDerGrasClutter(p.id)
);
check(
  `alle ${schneeImStore.length} -snow-Modelle des Stores werden benutzt (gestreut oder im Clutter)`,
  schneeBenutzt.length === schneeImStore.length,
  schneeImStore
    .filter((p) => !schneeBenutzt.includes(p))
    .map((p) => p.id)
    .join(', ')
);

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('\nalles grün');
