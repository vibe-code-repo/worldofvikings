/**
 * Prüft die zwei Fallen, die der Generator `tools/store-prefabs.mjs` in der
 * PREFAB-QUELLE (`assets/store/prefabs.json`) hatte — Fälle, die
 * `store-erzeugung.ts` nicht sieht, weil es nur die echte Quelle liest.
 *
 *  (1) `verhalten` in der Quelle gewinnt gegen die Regeln und verlor dabei
 *      `PERSISTENT`. Das Spiel lief trotzdem richtig (`prefabs.ts` ODERt es
 *      dazu), aber `shared/test/store-verhalten.ts` wurde rot, sobald jemand
 *      das Feld wie vorgesehen füllte.
 *  (2) Zwei Quelleinträge auf DIESELBE GLB überschrieben sich still (die Map
 *      ist nach `asset` geschlüsselt): 568 statt 569 Prefabs, und beide
 *      bestehenden Tests blieben grün.
 *
 * Die Quelle ist ein Symlink auf einen Speicher außerhalb des Repos, und der
 * Generator liest seinen Pfad aus dem Ort, an dem er liegt. Der Test baut
 * deshalb einen WEGWERF-Baum: eine Kopie des Generators, Verweise auf
 * `client/` und `shared/`, und einen eigenen `assets/store` mit veränderter
 * `prefabs.json`, dessen übrige Einträge auf den echten Speicher zeigen.
 * Geschrieben wird nur dorthin (`--nach`); nichts Getracktes wird angefasst.
 *
 * Ohne `assets/store` ist hier nichts zu messen; die Weiche sitzt im
 * Sammellauf (`brauchtStore()`), der Test selbst überspringt nie.
 *
 *   npx tsx tools/test/store-quelle.ts
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');
const TSX = join(WURZEL, 'node_modules/.bin/tsx');
const ERZEUGNISSE = ['storePrefabs.ts', 'storeKatalogDaten.ts', 'storeKollisionDaten.ts', 'storeVerhalten.ts'] as const;

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

check('assets/store liegt vor', existsSync(STORE), STORE);
if (fehler > 0) {
  console.error('\nOhne den Asset-Speicher ist hier nichts zu messen.');
  process.exit(1);
}

interface Quelle {
  prefabs: Array<{ id: string; asset: string; verhalten?: string[] }>;
  [rest: string]: unknown;
}
const echteQuelle = JSON.parse(readFileSync(join(STORE, 'prefabs.json'), 'utf8')) as Quelle;
const eintrag = (id: string): { id: string; asset: string; verhalten?: string[] } => {
  const e = echteQuelle.prefabs.find((p) => p.id === id);
  if (!e) throw new Error(`Prefab ${id} fehlt in der Quelle`);
  return e;
};

const tmp = mkdtempSync(join(tmpdir(), 'wov-store-quelle-'));
try {
  // Der Wegwerf-Baum: alles, was der Generator relativ zu sich selbst sucht.
  const baum = join(tmp, 'baum');
  mkdirSync(join(baum, 'tools'), { recursive: true });
  copyFileSync(join(WURZEL, 'tools/store-prefabs.mjs'), join(baum, 'tools/store-prefabs.mjs'));
  symlinkSync(join(WURZEL, 'client'), join(baum, 'client'));
  symlinkSync(join(WURZEL, 'shared'), join(baum, 'shared'));
  symlinkSync(join(WURZEL, 'node_modules'), join(baum, 'node_modules'));
  mkdirSync(join(baum, 'assets/store'), { recursive: true });
  for (const name of readdirSync(STORE)) {
    if (name === 'prefabs.json') continue;
    symlinkSync(join(STORE, name), join(baum, 'assets/store', name));
  }
  const labQuelle = join(WURZEL, 'assets/store-lab');
  if (existsSync(labQuelle)) symlinkSync(labQuelle, join(baum, 'assets/store-lab'));

  /** Generatorlauf im Wegwerf-Baum mit einer veränderten Quelle. */
  let nr = 0;
  function lauf(quelle: Quelle): { status: number | null; stdout: string; stderr: string; ausgabe: string } {
    writeFileSync(join(baum, 'assets/store/prefabs.json'), JSON.stringify(quelle));
    const ausgabe = join(tmp, `aus${++nr}`);
    mkdirSync(ausgabe);
    const r = spawnSync(TSX, [join(baum, 'tools/store-prefabs.mjs'), '--nach', ausgabe], {
      cwd: baum,
      encoding: 'utf-8',
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ausgabe };
  }
  const lies = (ordner: string, name: string): string =>
    existsSync(join(ordner, name)) ? readFileSync(join(ordner, name), 'utf8') : '';
  const kopie = (): Quelle => JSON.parse(JSON.stringify(echteQuelle)) as Quelle;

  // ── 0. Kontrolle: der Wegwerf-Baum liefert genau das Eingecheckte ────
  {
    const r = lauf(kopie());
    check('Kontrolle: unveränderte Quelle, Generator endet mit Code 0', r.status === 0, r.stderr.trim());
    for (const name of ERZEUGNISSE) {
      const eingecheckt = readFileSync(join(WURZEL, 'shared/src', name), 'utf8');
      check(`Kontrolle: ${name} gleicht dem Eingecheckten`, lies(r.ausgabe, name) === eingecheckt);
    }
  }

  // ── 1. `verhalten` in der Quelle verliert PERSISTENT nicht ──────────
  {
    const q = kopie();
    // Dasselbe Verhalten wie die Regel, aber aus der Quelle: PIECE und BED.
    // PERSISTENT nennt sie nicht — der Generator muss es dazutun.
    const bett = 'environment-sm-prop-bed-03';
    eintrag(bett); // wirft, falls das Bett aus der Quelle verschwindet
    q.prefabs.find((p) => p.id === bett)!.verhalten = ['PIECE', 'BED'];
    const r = lauf(q);
    check('verhalten in der Quelle: Generator endet mit Code 0', r.status === 0, r.stderr.trim());
    const zeile = lies(r.ausgabe, 'storeVerhalten.ts')
      .split('\n')
      .find((z) => z.includes(`'${bett}'`) || z.includes(`"${bett}"`));
    check(
      'verhalten ["PIECE","BED"]: die Tabelle traegt F.BED | F.PERSISTENT | F.PIECE',
      !!zeile && zeile.includes('F.BED | F.PERSISTENT | F.PIECE'),
      zeile ?? '(keine Zeile fuer das Bett)'
    );
    check('verhalten in der Quelle: die Gruppe ist "quelle"', !!zeile && zeile.includes('// quelle'), zeile ?? '');
    // Ein Feld, das PERSISTENT selbst nennt, ergibt es nicht doppelt.
    q.prefabs.find((p) => p.id === bett)!.verhalten = ['PERSISTENT', 'BED', 'PIECE'];
    const r2 = lauf(q);
    const zeile2 = lies(r2.ausgabe, 'storeVerhalten.ts')
      .split('\n')
      .find((z) => z.includes(bett));
    check(
      'verhalten mit PERSISTENT: genau einmal, dieselbe Zeile',
      !!zeile2 && (zeile2.match(/PERSISTENT/g) ?? []).length === 1 && zeile2.includes('F.BED | F.PERSISTENT | F.PIECE'),
      zeile2 ?? ''
    );
  }

  // ── 2. Zwei Quelleinträge auf dieselbe GLB werden gemeldet ──────────
  {
    const q = kopie();
    const kamin = 'environment-sm-bld-house-chimney-stone-01';
    const stein = 'environment-sm-env-stone-01';
    q.prefabs.find((p) => p.id === kamin)!.asset = eintrag(stein).asset;
    const r = lauf(q);
    check('doppelte GLB: der Generator bricht ab (Code 3)', r.status === 3, `Code ${r.status}`);
    check(
      'doppelte GLB: die Meldung nennt die Datei und BEIDE Prefabs',
      r.stderr.includes(eintrag(stein).asset) && r.stderr.includes(kamin) && r.stderr.includes(stein),
      r.stderr.trim().split('\n').slice(0, 3).join(' | ')
    );
    check(
      'doppelte GLB: es wird nichts geschrieben (kein Halbzustand, kein Prefab weniger)',
      ERZEUGNISSE.every((n) => !existsSync(join(r.ausgabe, n)))
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fehler === 0 ? '\nStore-Quelle: alles bestanden' : `\nStore-Quelle: ${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
