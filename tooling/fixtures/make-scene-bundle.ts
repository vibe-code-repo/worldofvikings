/**
 * Writes `tooling/fixtures/scenes/village-fixture.glb`, the smallest thing that
 * is still a scene bundle.
 *
 * A real bundle is 150 MB of authored level and lives in the private export
 * (ADR-0021). No test can use it: it is not in the repository, it is not
 * redistributable, and a clone without the asset store still has to be able to
 * run `pnpm check` and `pnpm smoke`. So this builds a bundle with the three
 * things the import actually reads — a zone root, a node named after a model
 * the prefab catalogue knows, and a mesh under it — and nothing else.
 *
 * ```bash
 * npx tsx tooling/fixtures/make-scene-bundle.ts
 * ```
 *
 * Run it when the fixture needs to change; the output is committed, because a
 * test that regenerates its own input is a test that cannot fail on the input.
 * Under a kilobyte, which is what keeps it inside the 20 kB rule for binaries.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeGlb, type Gltf } from '@wov/content-build';
import { repoRoot } from '../scripts/repo-root.js';

/** One triangle, as twelve floats and three shorts. */
const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
const INDICES = new Uint16Array([0, 1, 2]);

const positionBytes = Buffer.from(POSITIONS.buffer, 0, POSITIONS.byteLength);
const indexBytes = Buffer.from(INDICES.buffer, 0, INDICES.byteLength);
// glTF wants an accessor's offset aligned to its component size; two bytes for
// an unsigned short, so the padding here is not decoration.
const padding = Buffer.alloc((4 - (indexBytes.byteLength % 4)) % 4);
const bin = Buffer.concat([positionBytes, indexBytes, padding]);

/**
 * Two names, and both are needed.
 *
 * The import folds a node name onto a *store file name* (`scene-import.ts`),
 * and a stem two catalogues both claim is dropped rather than guessed:
 *
 * - `detail-barrel` is the file behind `base.json`'s one prefab, which every
 *   checkout has and which `services/api/src/actions.test.ts` runs against on
 *   its own. With the generated catalogue present as well it is *ambiguous* —
 *   `imported.json` names the same file — and the importer correctly refuses
 *   to pick one of the two.
 * - `sm-item-bag-large` is a file only the generated catalogue names, so it is
 *   unambiguous wherever that catalogue exists, which is the whole repository
 *   and the smoke run.
 *
 * So the bundle places two instances either way, and the two tests differ only
 * in which prefab they get — which is exactly the behaviour worth pinning down.
 */
const json: Gltf = {
  asset: { version: '2.0', generator: 'world-of-vikings scene fixture' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'Village', children: [1] },
    { name: 'Village1', children: [2, 3, 4, 5] },
    { name: 'detail-barrel', mesh: 0, translation: [4, 0, -6] },
    { name: 'detail-barrel (1)', mesh: 0, translation: [-2, 0, 3] },
    { name: 'SM_Item_Bag_Large', mesh: 0, translation: [7, 0, 1] },
    { name: 'SM_Item_Bag_Large (1)', mesh: 0, translation: [-5, 0, -4] },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 0, 1],
    },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength },
    { buffer: 0, byteOffset: positionBytes.byteLength, byteLength: indexBytes.byteLength },
  ],
  buffers: [{ byteLength: bin.byteLength }],
} as unknown as Gltf;

const directory = join(repoRoot, 'tooling', 'fixtures', 'scenes');
const file = join(directory, 'village-fixture.glb');
await mkdir(directory, { recursive: true });
const bytes = writeGlb({ json, bin });
await writeFile(file, bytes);
process.stdout.write(
  `wrote tooling/fixtures/scenes/village-fixture.glb (${String(bytes.byteLength)} bytes)\n`,
);
