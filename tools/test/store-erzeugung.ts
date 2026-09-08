/**
 * Prüft: dass `tools/store-prefabs.mjs` deterministisch läuft, dass sein
 * Ergebnis eingecheckt ist und dass jeder Modellpfad darin auf eine
 * Datei zeigt, die wirklich da ist.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Ein Generator scheitert nicht, er DRIFTET — und zwar in drei
 * Richtungen, von denen keine beim Ausführen auffällt:
 *
 *  (a) NICHT DETERMINISTISCH. Eine Schleife über ein `Set`, eine
 *      Reihenfolge aus dem Dateisystem, ein `Date.now()` im Kopf: Der
 *      zweite Lauf schreibt dieselbe Wahrheit anders auf. Danach ist
 *      jeder `git diff` 1300 Zeilen lang, und die eine echte Änderung
 *      darin sieht niemand mehr.
 *
 *  (b) VERALTET. Jemand legt ein Modell in den Speicher und vergisst den
 *      Lauf. Die Registry weiss nichts davon; im Spawn-Editor fehlt eine
 *      Zeile, die niemand vermisst, weil niemand sie je gesehen hat.
 *
 *  (c) INS LEERE. Ein `model`-Pfad, hinter dem keine Datei liegt, ist im
 *      Client ein 404 und im Bild ein Platzhalterkasten — ein Fehler,
 *      der wie ein noch nicht fertiges Modell aussieht.
 *
 * ── Die Weiche ───────────────────────────────────────────────────────
 * `assets/store` ist ein Symlink auf einen Speicher AUSSERHALB des
 * Repos. Fehlt der Ordner GANZ (CI-Checkout), wird der Test
 * übersprungen — `scripts/testweichen.mjs`, `brauchtStore()`. Fehlen
 * einzelne Dateien DARIN, wird er rot: Das ist kein Umstand, sondern ein
 * unvollständiger Speicher oder eine veraltete `storePrefabs.ts`. Der
 * Test selbst überspringt NIE von sich aus — täte er es, wäre ein
 * leerer Lauf von einem bestandenen nicht zu unterscheiden.
 *
 *   npx tsx tools/test/store-erzeugung.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_PREFAB_DEFS } from '@wov/shared';
// Der Katalog kommt ueber seinen Pfad — er steht mit Absicht nicht im
// Barrel, damit er nicht im Spiel-Bundle landet.
import { STORE_KATALOG } from '@wov/shared/src/storeKatalogDaten.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const GENERATOR = join(WURZEL, 'tools/store-prefabs.mjs');
/** Der `tsx`-Aufrufer aus dem Arbeitsbaum — kein `npx`, kein Netz. */
const TSX = join(WURZEL, 'node_modules/.bin/tsx');
/*
  ZWEI Erzeugnisse seit dem Bundle-Schnitt (08.09.2026): Die PrefabDefs
  haengen am Barrel und damit im Spiel, der Katalog steht daneben und
  wird nur vom Editor gelesen. Beide werden hier geprueft — ein Waechter,
  der nur eine der beiden ansieht, laesst die andere lautlos veralten,
  und der Katalog ist genau der Teil, den sonst nichts anfasst.
*/
const ERZEUGNISSE = ['storePrefabs.ts', 'storeKatalogDaten.ts'] as const;
const STORE = join(WURZEL, 'assets/store');
const STORE_LAB = join(WURZEL, 'assets/store-lab');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/*
  Der Speicher MUSS hier liegen. Dass er da ist, entscheidet die Weiche
  im Sammellauf; wer diesen Test trotzdem ohne ihn startet, bekommt
  einen Befund und kein stilles Grün.
*/
check('assets/store liegt vor', existsSync(STORE), STORE);
if (fehler > 0) {
  console.error('\nOhne den Asset-Speicher ist hier nichts zu messen.');
  process.exit(1);
}

// ── 1. Zwei Läufe, byteidentisch ──────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'wov-store-'));
try {
  /*
    `--nach` nimmt seit dem Schnitt einen ORDNER: Es entstehen zwei
    Dateien, und beide behalten dort ihren Namen. Je Lauf ein eigener
    Unterordner, sonst überschriebe der zweite Lauf den ersten und der
    Vergleich wäre eine Datei mit sich selbst.
  */
  const laeufe: Record<string, string>[] = [];
  for (const nr of [1, 2]) {
    const ordner = join(tmp, `lauf${nr}`);
    mkdirSync(ordner, { recursive: true });
    /*
      `tsx` und nicht `node`: Der Generator holt seine Einsortierregel
      aus `client/src/editor/StoreKatalogDaten.ts` — damit sie nur
      EINMAL dasteht (siehe Kopf des Generators). Mit `node` bräche der
      Lauf beim Import ab, und dieser Test wäre der Erste, der es merkt.
    */
    const lauf = spawnSync(TSX, [GENERATOR, '--nach', ordner], { cwd: WURZEL, encoding: 'utf-8' });
    check(`Generatorlauf ${nr} endet mit Code 0`, lauf.status === 0, lauf.stderr?.trim());
    const dateien: Record<string, string> = {};
    for (const name of ERZEUGNISSE) {
      const pfad = join(ordner, name);
      dateien[name] = existsSync(pfad) ? readFileSync(pfad, 'utf8') : `<lauf ${nr}: ${name} fehlt>`;
    }
    laeufe.push(dateien);
  }
  for (const name of ERZEUGNISSE) {
    check(
      `${name}: zweiter Lauf ist byteidentisch zum ersten`,
      laeufe[0]![name] === laeufe[1]![name],
      `${laeufe[0]![name]?.length ?? 0} gegen ${laeufe[1]![name]?.length ?? 0} Zeichen`
    );
  }

  // ── 2. Das Eingecheckte ist der aktuelle Stand ──────────────────────
  for (const name of ERZEUGNISSE) {
    const pfad = join(WURZEL, 'shared/src', name);
    const eingecheckt = existsSync(pfad) ? readFileSync(pfad, 'utf8') : '';
    check(
      `shared/src/${name} ist aktuell (npx tsx tools/store-prefabs.mjs)`,
      eingecheckt === laeufe[0]![name],
      eingecheckt.length === 0 ? 'Datei fehlt' : 'Inhalt weicht ab'
    );
  }

  /*
    ── 2a. Und der Katalog steht NICHT im Barrel ──────────────────────
    Der eigentliche Grund für den Schnitt, und die einzige Stelle, an der
    er festgehalten ist. Ein `export * from './storeKatalogDaten.js'` in
    `shared/src/index.ts` sähe harmlos aus, wäre sofort grün und legte
    die 670 Katalogzeilen wieder in jedes Spiel-Bundle. Geprüft wird der
    Quelltext, weil die Wirkung erst im gebauten Bündel sichtbar wäre —
    und dorthin schaut kein Test.
  */
  const barrel = readFileSync(join(WURZEL, 'shared/src/index.ts'), 'utf8');
  check(
    'shared/src/index.ts exportiert den Katalog NICHT',
    !/^\s*export\s.*['"]\.\/storeKatalogDaten\.js['"]/m.test(barrel),
    'ein export * zieht die 670 Katalogzeilen zurück ins Spiel-Bundle'
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 3. Jeder Modellpfad zeigt auf eine echte Datei ────────────────────
/*
  Der Pfad wird ZURÜCKGERECHNET, nicht neu gebaut: `model` ist
  `store/environment/x` bzw. `store-lab/vegetation/x`, die Datei liegt
  unter `assets/<model>.glb`. Genau dieselbe Rechnung macht
  `modelBaseUrl()` im Client (`assetUrls.ts`) — wäre sie hier
  nachgebaut statt nachvollzogen, prüfte der Test seine eigene Kopie.
*/
const totePfade: string[] = [];
for (const def of STORE_PREFAB_DEFS) {
  if (!def.model) {
    totePfade.push(`${def.name}: kein model`);
    continue;
  }
  const basis = def.model.startsWith('store-lab/') ? STORE_LAB : STORE;
  const rest = def.model.replace(/^store(-lab)?\//, '');
  if (!existsSync(join(basis, `${rest}.glb`))) totePfade.push(`${def.name} → ${def.model}.glb`);
}
check(
  `alle ${STORE_PREFAB_DEFS.length} model-Pfade zeigen auf eine vorhandene Datei`,
  totePfade.length === 0,
  `${totePfade.length} tot: ${totePfade.slice(0, 5).join(', ')}`
);

// ── 4. Auch der Katalog beschreibt nur Vorhandenes ────────────────────
const toteKatalogPfade = STORE_KATALOG.filter((e) => !existsSync(join(STORE, e.pfad)));
check(
  `alle ${STORE_KATALOG.length} Katalogpfade zeigen auf eine vorhandene Datei`,
  toteKatalogPfade.length === 0,
  toteKatalogPfade.slice(0, 5).map((e) => e.pfad).join(', ')
);

/*
  Und die Gegenrichtung, sonst prüft der Test nur, dass nichts ZU VIEL
  drinsteht: Ein Modell, das im Speicher liegt und im Katalog fehlt, ist
  genau der Fall (b) aus dem Kopf — vergessener Generatorlauf.
*/
const imKatalog = new Set(STORE_KATALOG.map((e) => e.pfad));
const manifest = JSON.parse(readFileSync(join(STORE, 'manifest.json'), 'utf8')) as {
  assets: { path: string }[];
};
const fehlendImKatalog = manifest.assets
  .map((a) => a.path)
  .filter((p) => existsSync(join(STORE, p)) && !imKatalog.has(p));
check(
  'jede vorhandene Datei des Manifests steht im Katalog',
  fehlendImKatalog.length === 0,
  `${fehlendImKatalog.length}: ${fehlendImKatalog.slice(0, 5).join(', ')}`
);

// ── 5. Relative Texturen lösen gegen den Modellordner auf ─────────────
/*
  Der teuerste Befund dieses Auftrags, und einer, den keine Pfadprüfung
  gesehen hätte (Messprobe Bauer D, im Browser bestätigt am 08.09.2026):

  468 der 581 Store-GLBs tragen ihre Texturen NICHT eingebettet, sondern
  als relative URI daneben — `textures/<name>.png`. Babylons glTF-Lader
  löst die gegen die rootUrl des Ladeaufrufs auf. Übergibt man ihm
  `/assets/` als Basis und `store/vegetation/tree.glb` als Dateinamen,
  lädt die GLB anstandslos und die Textur wird unter `/assets/textures/`
  gesucht: 404 — und daran stirbt der GANZE Container. `instantiate()`
  liefert dann stumm `null`, und im Bild steht ein Platzhalterkasten, der
  wie ein fehlendes Modell aussieht.

  Deshalb prüft dieser Abschnitt genau die Rechnung, die der Client
  macht: Ordner der Datei + relative URI muss eine Datei sein, die
  existiert. Er liest die GLB dafür selbst (JSON-Chunk des Containers) —
  ohne Babylon, ohne Browser, in unter einer Sekunde.
*/
function bildUris(datei: string): string[] {
  const roh = readFileSync(datei);
  if (roh.length < 20 || roh.toString('ascii', 0, 4) !== 'glTF') return [];
  let versatz = 12;
  while (versatz + 8 <= roh.length) {
    const laenge = roh.readUInt32LE(versatz);
    const typ = roh.readUInt32LE(versatz + 4);
    if (typ === 0x4e4f534a) {
      const gltf = JSON.parse(roh.toString('utf8', versatz + 8, versatz + 8 + laenge)) as {
        images?: { uri?: string }[];
      };
      return (gltf.images ?? []).map((b) => b.uri).filter((u): u is string => typeof u === 'string');
    }
    versatz += 8 + laenge;
  }
  return [];
}

let mitTextur = 0;
const toteTexturen: string[] = [];
for (const def of STORE_PREFAB_DEFS) {
  const basis = def.model!.startsWith('store-lab/') ? STORE_LAB : STORE;
  const rest = def.model!.replace(/^store(-lab)?\//, '');
  const datei = join(basis, `${rest}.glb`);
  if (!existsSync(datei)) continue;
  const uris = bildUris(datei);
  if (uris.length > 0) mitTextur++;
  for (const uri of uris) {
    if (/^(data:|https?:)/.test(uri)) continue;
    // GENAU die Rechnung des Clients: Ordner der Datei + relative URI.
    const ziel = join(dirname(datei), decodeURIComponent(uri));
    if (!existsSync(ziel)) toteTexturen.push(`${def.name}: ${uri}`);
  }
}
check(
  `${mitTextur} Modelle mit externen Texturen — jede löst gegen ihren Modellordner auf`,
  mitTextur > 0 && toteTexturen.length === 0,
  mitTextur === 0
    ? 'kein einziges Modell mit externer Textur gefunden — der Test misst nichts'
    : `${toteTexturen.length} tot: ${toteTexturen.slice(0, 5).join(', ')}`
);

console.log(fehler === 0 ? '\nalle Prüfungen grün' : `\n${fehler} Prüfung(en) fehlgeschlagen`);
process.exit(fehler > 0 ? 1 : 0);
