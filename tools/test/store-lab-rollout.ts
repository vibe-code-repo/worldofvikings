/**
 * Prüft den Rollout-Weg der Labor-Pflanzen: `store:aufbereiten` (Schritt 5b
 * von `tools/wov-update.sh`) baut `assets/store-lab/vegetation/` bei jedem
 * Lauf NEU auf und muss Blumen und Farn aus den Ausgangsdateien in
 * `assets/store/vegetation-export/` ohne Extra-Schritt wieder hineinlegen.
 *
 *  (a) Mit Ausgangsdateien: drei GLB und ihre Texturen liegen nach dem Lauf
 *      im Labor, die Messliste bleibt unverändert, der zweite Lauf ist
 *      byteidentisch.
 *  (b) Ohne Ausgangsdateien (Mike hat noch nicht kopiert): Der Lauf endet mit
 *      Code 0 und einer WARNUNG, die Pflanzen fehlen, der Rest steht.
 *
 * Läuft in einem Wegwerf-Baum (Kopie der Werkzeuge, Verweise auf den
 * Speicher ohne `vegetation-export`), schreibt also nie in den Arbeitsbaum.
 * Braucht `assets/store/vegetation` (Weiche `brauchtModelle`); die
 * Ausgangsdateien baut der Test selbst.
 *
 *   npx tsx tools/test/store-lab-rollout.ts
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs ohne Typen
import { MODELLE, glbSchreiben } from '../store-pflanzen-quellen.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = join(WURZEL, 'assets/store');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Selbstgebaute Export-GLB: ein Dreieck, Bild eingebettet. */
function exportGlb(materialName: string, seed: number): Buffer {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`bild-${seed}`)]);
  const pos = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, seed].forEach((v, i) => pos.writeFloatLE(v, i * 4));
  const idx = Buffer.from([0, 0, 1, 0, 2, 0, 0, 0]);
  const pad = Buffer.alloc((4 - (png.length % 4)) % 4);
  const bin = Buffer.concat([png, pad, pos, idx]);
  const geo = png.length + pad.length;
  return glbSchreiben(
    {
      asset: { version: '2.0' },
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: png.length },
        { buffer: 0, byteOffset: geo, byteLength: 36 },
        { buffer: 0, byteOffset: geo + 36, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, seed] },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
      materials: [{ name: materialName, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      images: [{ bufferView: 0, mimeType: 'image/png' }],
      textures: [{ source: 0 }],
      nodes: [{ name: 'Probe', mesh: 0 }],
      scenes: [{ nodes: [0] }],
    },
    bin
  );
}

function baumBauen(tmp: string, mitExport: boolean): string {
  const baum = join(tmp, mitExport ? 'mit' : 'ohne');
  mkdirSync(join(baum, 'tools/lib'), { recursive: true });
  mkdirSync(join(baum, 'shared/src'), { recursive: true });
  mkdirSync(join(baum, 'assets/store'), { recursive: true });
  for (const f of ['store-vegetation-aufbereiten.mjs', 'store-pflanzen-quellen.mjs', 'store-lab-katalog.json', 'lib/png.mjs']) {
    copyFileSync(join(WURZEL, 'tools', f), join(baum, 'tools', f));
  }
  copyFileSync(join(WURZEL, 'shared/src/laubSpitzen.ts'), join(baum, 'shared/src/laubSpitzen.ts'));
  symlinkSync(join(WURZEL, 'node_modules'), join(baum, 'node_modules'));
  for (const name of readdirSync(STORE)) {
    if (name === 'vegetation-export') continue;
    symlinkSync(join(STORE, name), join(baum, 'assets/store', name));
  }
  if (mitExport) {
    const roh = join(baum, 'assets/store/vegetation-export');
    mkdirSync(roh);
    MODELLE.forEach((m: { quelle: string }, i: number) => {
      writeFileSync(join(roh, m.quelle), exportGlb(m.quelle.startsWith('fern') ? 'Plant_Leaves_1A3 1' : 'Flowers_A 1', i + 1));
    });
  }
  return baum;
}

function lauf(baum: string): { status: number | null; ausgabe: string } {
  const r = spawnSync(join(WURZEL, 'node_modules/.bin/tsx'), [join(baum, 'tools/store-vegetation-aufbereiten.mjs')], {
    cwd: baum,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, ausgabe: `${r.stdout}${r.stderr}` };
}

const tmp = mkdtempSync(join(tmpdir(), 'grauklamm-k1-rollout-'));
try {
  const lab = (baum: string): string => join(baum, 'assets/store-lab/vegetation');
  const pflanzen = (baum: string): string[] =>
    existsSync(lab(baum)) ? readdirSync(lab(baum)).filter((f) => /^(flower|fern)-.*\.glb$/.test(f)).sort() : [];

  // (a) mit Ausgangsdateien
  const mit = baumBauen(tmp, true);
  const katalogVorher = readFileSync(join(mit, 'tools/store-lab-katalog.json'), 'utf8');
  const a1 = lauf(mit);
  check('mit Ausgangsdateien: Lauf endet mit 0', a1.status === 0, a1.ausgabe.slice(-400));
  check(
    'mit Ausgangsdateien: alle drei Modelle im Labor',
    JSON.stringify(pflanzen(mit)) === JSON.stringify((MODELLE as { id: string }[]).map((m) => `${m.id}.glb`).sort()),
    pflanzen(mit).join(',')
  );
  check('mit Ausgangsdateien: Texturen neben den Modellen', readdirSync(join(lab(mit), 'textures')).some((f) => /^blume-[0-9a-f]{8}\.png$/.test(f)) && readdirSync(join(lab(mit), 'textures')).some((f) => /^farn-[0-9a-f]{8}\.png$/.test(f)));
  check('mit Ausgangsdateien: Store-Vegetation daneben unverändert da', existsSync(join(lab(mit), 'bush-1a2-small.glb')) && existsSync(join(lab(mit), 'BERICHT.json')));
  const bytes1 = pflanzen(mit).map((f) => readFileSync(join(lab(mit), f)));
  const a2 = lauf(mit);
  check('zweiter Lauf endet mit 0', a2.status === 0);
  check('zweiter Lauf: Modelle byteidentisch', pflanzen(mit).every((f, i) => readFileSync(join(lab(mit), f)).equals(bytes1[i])));
  check(
    'mit Ausgangsdateien: Messliste des Wegwerf-Baums folgt den Ausgangsdateien (Probe-Werte)',
    readFileSync(join(mit, 'tools/store-lab-katalog.json'), 'utf8') !== katalogVorher
  );
  check('Messliste des Arbeitsbaums bleibt unangetastet', readFileSync(join(WURZEL, 'tools/store-lab-katalog.json'), 'utf8') === katalogVorher);

  // (b) ohne Ausgangsdateien
  const ohne = baumBauen(tmp, false);
  const b = lauf(ohne);
  check('ohne Ausgangsdateien: Lauf endet mit 0', b.status === 0, b.ausgabe.slice(-400));
  check('ohne Ausgangsdateien: Warnung steht in der Ausgabe', b.ausgabe.includes('WARNUNG') && b.ausgabe.includes('vegetation-export'));
  check('ohne Ausgangsdateien: keine Pflanzen im Labor', pflanzen(ohne).length === 0, pflanzen(ohne).join(','));
  check('ohne Ausgangsdateien: Store-Vegetation steht trotzdem', existsSync(join(lab(ohne), 'bush-1a2-small.glb')));
  check('ohne Ausgangsdateien: Messliste unverändert', readFileSync(join(ohne, 'tools/store-lab-katalog.json'), 'utf8') === katalogVorher);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-lab-rollout: alles grün');
