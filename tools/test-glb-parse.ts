/**
 * One-off diagnostic: parse GLBs through three's GLTFLoader exactly like the
 * client does, to reproduce "Model missing" failures outside the browser.
 * Usage: npx tsx tools/test-glb-parse.ts <name.glb> [more.glb...]
 */
import { readFileSync } from 'fs';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Minimal browser polyfills GLTFLoader needs in Node
(globalThis as any).self = globalThis;
if (typeof (globalThis as any).URL.createObjectURL !== 'function') {
  (globalThis as any).URL.createObjectURL = () => 'blob:noop';
  (globalThis as any).URL.revokeObjectURL = () => {};
}

const loader = new GLTFLoader();

async function main(): Promise<void> {
  for (const arg of process.argv.slice(2)) {
    const path = arg.endsWith('.glb')
      ? `../valheim_browser_assets/models/${arg}`
      : `../valheim_browser_assets/models/${arg}.glb`;
    const buf = readFileSync(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await new Promise<void>((resolve) => {
      loader.parse(
        ab as ArrayBuffer,
        '',
        (gltf) => {
          let meshes = 0;
          gltf.scene.traverse((o: any) => {
            if (o.isMesh) meshes++;
          });
          // Natural size of the GLB (prefab root at identity)
          gltf.scene.updateMatrixWorld(true);
          const bb = new Box3().setFromObject(gltf.scene);
          const size = bb.getSize(new Vector3());
          console.log(
            `OK    ${arg}: ${meshes} meshes, size=(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})m, ` +
            `min.y=${bb.min.y.toFixed(1)}`
          );
          resolve();
        },
        (err: any) => {
          console.log(`FAIL  ${arg}: ${err?.message ?? err}`);
          resolve();
        }
      );
    });
  }
}

void main();
