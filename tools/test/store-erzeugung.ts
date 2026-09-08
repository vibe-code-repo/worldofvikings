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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_KATALOG, STORE_PREFAB_DEFS } from '@wov/shared';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const GENERATOR = join(WURZEL, 'tools/store-prefabs.mjs');
const ERZEUGT = join(WURZEL, 'shared/src/storePrefabs.ts');
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
  const laeufe: string[] = [];
  for (const nr of [1, 2]) {
    const ziel = join(tmp, `lauf${nr}.ts`);
    const lauf = spawnSync('node', [GENERATOR, '--nach', ziel], { cwd: WURZEL, encoding: 'utf-8' });
    check(`Generatorlauf ${nr} endet mit Code 0`, lauf.status === 0, lauf.stderr?.trim());
    laeufe.push(existsSync(ziel) ? readFileSync(ziel, 'utf8') : `<lauf ${nr} hat nichts geschrieben>`);
  }
  check(
    'zweiter Lauf ist byteidentisch zum ersten',
    laeufe[0] === laeufe[1],
    `${laeufe[0]?.length ?? 0} gegen ${laeufe[1]?.length ?? 0} Zeichen`
  );

  // ── 2. Das Eingecheckte ist der aktuelle Stand ──────────────────────
  const eingecheckt = existsSync(ERZEUGT) ? readFileSync(ERZEUGT, 'utf8') : '';
  check(
    'shared/src/storePrefabs.ts ist aktuell (node tools/store-prefabs.mjs)',
    eingecheckt === laeufe[0],
    eingecheckt.length === 0 ? 'Datei fehlt' : 'Inhalt weicht ab'
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
