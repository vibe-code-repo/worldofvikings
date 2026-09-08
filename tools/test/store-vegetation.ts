/**
 * Hält die aufbereitete Store-Vegetation gegen den Store fest — die
 * Plattenseite der Store-Flora.
 *
 * Die TABELLE prüft `tools/test/store-flora.ts` — Namen, Biome,
 * Landschaft. Hier geht es um die Dateien, die aus dem Store werden, und
 * um zwei Fehlerarten, die sonst LAUTLOS blieben:
 *
 *  (a) IDEMPOTENZ. `tools/store-vegetation-aufbereiten.mjs` läuft zweimal
 *      in denselben Ordner und muss beim zweiten Mal Byte für Byte
 *      dasselbe schreiben. Ein Werkzeug, das bei jedem Lauf ein anderes
 *      Ergebnis liefert, macht jede spätere Messung unvergleichbar — und
 *      man merkt es erst, wenn zwei Messungen nicht zusammenpassen.
 *
 *  (b) DIE AUFBEREITUNG SELBST. Kein Modell führt nach dem Lauf noch ein
 *      `DefaultMaterial`, jedes Material hat eine auflösbare Textur, und
 *      jedes LAUBMATERIAL trägt einen Tönungsfaktor. Das ist der Punkt
 *      des ganzen Werkzeugs: Ein ungetöntes Laubmaterial rendert GRAU,
 *      weil die Atlanten Helligkeitsmasken sind (gemessen 0,452/0,452/
 *      0,452) — und grau sieht nicht nach Fehler aus, sondern nach
 *      Herbst.
 *
 * WEICHE: Fehlt `assets/store` GANZ, überspringt `scripts/run-tests.mjs`
 * diesen Test (`brauchtModelle('assets/store')`). Fehlt eine EINZELNE
 * Datei, wird er rot — die Sonde entscheidet nie selbst, ob sie laufen
 * darf (siehe scripts/testweichen.mjs).
 *
 *   npx tsx tools/test/store-vegetation.ts
 */
import { readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE = join(WURZEL, 'assets/store');
const VEGETATION = join(STORE, 'vegetation');
const PREFABS = join(STORE, 'prefabs.json');
const WERKZEUG = join(WURZEL, 'tools/store-vegetation-aufbereiten.mjs');
const PROBE_ZIEL = join(WURZEL, 'tools/test/tmp-store-vegetation');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Voraussetzungen ──────────────────────────────────────────────────
check('assets/store/prefabs.json existiert', existsSync(PREFABS));
check('assets/store/vegetation/ existiert', existsSync(VEGETATION));
if (fehler > 0) {
  console.error('\nOhne den Store lässt sich nichts prüfen — Weiche in run-tests.mjs.');
  process.exit(1);
}

/*
  Die Sollzahl kommt aus prefabs.json, nicht aus einer Konstante hier:
  Kommt ein Modell in den Store, soll der Test mitwachsen — und nicht
  erst dann rot werden, wenn jemand die 94 von Hand hochzählt.
*/
type StorePrefab = { id: string; asset: string };
const prefabs: StorePrefab[] = JSON.parse(readFileSync(PREFABS, 'utf8')).prefabs;

// ── (a) Idempotenz ───────────────────────────────────────────────────
/*
  Zweimal in DENSELBEN Ordner, nicht in zwei verschiedene: Das Werkzeug
  räumt sein Ziel vor jedem Lauf leer, und genau dieses Aufräumen soll
  mitgeprüft werden. Eine Leiche aus dem ersten Lauf fiele bei einem
  Vergleich zweier frischer Ordner nicht auf.
*/
function ordnerFingerabdruck(pfad: string): string[] {
  const zeilen: string[] = [];
  const gehe = (ort: string): void => {
    for (const name of readdirSync(ort).sort()) {
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else zeilen.push(`${relative(pfad, voll)} ${createHash('sha256').update(readFileSync(voll)).digest('hex')}`);
    }
  };
  gehe(pfad);
  return zeilen;
}

function lauf(): void {
  const ergebnis = spawnSync('node', [WERKZEUG, '--ziel', relative(WURZEL, PROBE_ZIEL)], {
    cwd: WURZEL,
    encoding: 'utf8',
  });
  if (ergebnis.status !== 0) {
    throw new Error(`Werkzeug brach ab (${ergebnis.status}): ${ergebnis.stderr ?? ''}`);
  }
}

rmSync(PROBE_ZIEL, { recursive: true, force: true });
let ersterLauf: string[] = [];
let zweiterLauf: string[] = [];
try {
  lauf();
  ersterLauf = ordnerFingerabdruck(PROBE_ZIEL);
  lauf();
  zweiterLauf = ordnerFingerabdruck(PROBE_ZIEL);
} catch (err) {
  check('tools/store-vegetation-aufbereiten.mjs läuft durch', false, String(err));
}

const sollGlb = prefabs.filter((p) => p.asset.startsWith('vegetation/')).length;
const istGlb = ersterLauf.filter((z) => z.split(' ')[0].endsWith('.glb')).length;
check(
  `Aufbereitung erzeugt alle ${sollGlb} GLB des Stores`,
  istGlb === sollGlb,
  `gezählt: ${istGlb}`
);
check(
  'Aufbereitung schreibt BERICHT.json',
  ersterLauf.some((z) => z.startsWith('BERICHT.json '))
);
const abweichung = ersterLauf.filter((z, i) => z !== zweiterLauf[i]);
check(
  'zweiter Lauf ist byteidentisch (Idempotenz)',
  ersterLauf.length > 0 && ersterLauf.length === zweiterLauf.length && abweichung.length === 0,
  abweichung.slice(0, 5).join(' | ')
);

// ── (b) Die Aufbereitung selbst ──────────────────────────────────────
/*
  Gelesen wird das Ergebnis, nicht der Quelltext des Werkzeugs: Ein Test,
  der die Regeln des Werkzeugs nachbaut, prüft nur, ob zwei Kopien
  derselben Regel übereinstimmen.
*/
type GlbJson = {
  materials: {
    name: string;
    alphaMode?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
  }[];
  textures: { source: number }[];
  images: { uri?: string }[];
};

function glbJson(pfad: string): GlbJson {
  const buf = readFileSync(pfad);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
}

const mitDefault: string[] = [];
const ohneTextur: string[] = [];
const ungetoentesLaub: string[] = [];
const fehlendesBild: string[] = [];
const masterZaehler = new Map<number, number>();
if (ersterLauf.length > 0) {
  for (const datei of readdirSync(PROBE_ZIEL).filter((d) => d.endsWith('.glb')).sort()) {
    const json = glbJson(join(PROBE_ZIEL, datei));
    masterZaehler.set(json.materials.length, (masterZaehler.get(json.materials.length) ?? 0) + 1);
    for (const mat of json.materials) {
      if (/^DefaultMaterial$/i.test(mat.name)) mitDefault.push(`${datei}:${mat.name}`);
      const ti = mat.pbrMetallicRoughness?.baseColorTexture?.index;
      if (ti === undefined || json.textures[ti] === undefined) {
        ohneTextur.push(`${datei}:${mat.name}`);
        continue;
      }
      const uri = json.images[json.textures[ti].source]?.uri;
      if (!uri) fehlendesBild.push(`${datei}:${mat.name}`);
      else if (!existsSync(join(PROBE_ZIEL, uri))) fehlendesBild.push(`${datei}:${uri}`);
      /*
        Die Tönungspflicht gilt für LAUB, nicht für jede Karte: Die
        bunten und die Schnee-Grasbüschel tragen ihre Farbe im Atlas
        (gemessen 0,350/0,447/0,186 beziehungsweise 0,707 hell), und ein
        Faktor könnte darauf nur dämpfen. Sie heissen deshalb `grasBunt`
        und `grasSchnee` und stehen hier ausdrücklich nicht.
      */
      if (/^(laub|laubDunkel|laubSchnee|nadeln|ahorn|gras|grasGelb)$/.test(mat.name)) {
        const f = mat.pbrMetallicRoughness?.baseColorFactor;
        if (!f || f.length < 3) ungetoentesLaub.push(`${datei}:${mat.name}`);
      }
    }
  }
}

check('kein Modell führt nach der Aufbereitung ein DefaultMaterial', mitDefault.length === 0, mitDefault.slice(0, 5).join(', '));
check('jedes Material hat eine auflösbare Textur', ohneTextur.length === 0, ohneTextur.slice(0, 5).join(', '));
check('jedes Bild liegt neben der GLB', fehlendesBild.length === 0, fehlendesBild.slice(0, 5).join(', '));
check(
  'jedes Laub-, Nadel- und Grasmaterial trägt einen Tönungsfaktor',
  ungetoentesLaub.length === 0,
  ungetoentesLaub.slice(0, 5).join(', ')
);

console.log('\nMaster je Modell nach der Aufbereitung:');
for (const [n, anzahl] of [...masterZaehler].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${n} Material${n === 1 ? '' : 'ien'}: ${anzahl} Modelle`);
}

rmSync(PROBE_ZIEL, { recursive: true, force: true });

if (fehler > 0) {
  console.error(`\n${fehler} Fehlschläge`);
  process.exit(1);
}
console.log('\nalles grün');
