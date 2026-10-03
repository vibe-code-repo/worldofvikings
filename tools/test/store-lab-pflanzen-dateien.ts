/**
 * Prüft die Binärdateien der Store-Labor-Pflanzen gegen die eingecheckte
 * Messliste `tools/store-lab-katalog.json`: Hash, GLB-Kopf (Material,
 * Alpha MASK, zweiseitig, Dreiecke) und die Textur daneben.
 *
 * Braucht `assets/store-lab/vegetation/` (liegt ausserhalb des Repos);
 * ohne die Dateien überspringt der Sammellauf den Test
 * (`brauchtModelle`, scripts/kern/tools.mjs). Fehlt eine EINZELNE Datei,
 * wird er rot.
 *
 *   npx tsx tools/test/store-lab-pflanzen-dateien.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs ohne Typen
import { glbLesen } from '../store-pflanzen-quellen.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAB = join(WURZEL, 'assets/store-lab/vegetation');
let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const sha = (b: Buffer): string => `sha256-${createHash('sha256').update(b).digest('hex')}`;

/** Erwartete Bildgrösse je Materialrolle (Breite × Höhe, aus dem PNG-Kopf). */
const BILDGROESSE: Record<string, [number, number]> = { blume: [2048, 2048], farn: [512, 1024] };

const liste = JSON.parse(readFileSync(join(WURZEL, 'tools/store-lab-katalog.json'), 'utf8')) as {
  eintraege: {
    id: string;
    pfad: string;
    bytes: number;
    hash: string;
    dreiecke: number;
    material: string;
    textur: { datei: string; bytes: number; hash: string };
  }[];
};
check('Messliste ist nicht leer', liste.eintraege.length === 3);

for (const e of liste.eintraege) {
  const datei = join(LAB, e.pfad.replace(/^vegetation\//, ''));
  check(`${e.id}: GLB liegt vor`, existsSync(datei), datei);
  if (!existsSync(datei)) continue;
  const buf = readFileSync(datei);
  check(`${e.id}: Grösse und Hash der Liste`, buf.length === e.bytes && sha(buf) === e.hash, `${buf.length} ${sha(buf)}`);
  const { json, bin } = glbLesen(buf);
  check(`${e.id}: genau ein Material`, json.materials.length === 1);
  const m = json.materials[0];
  check(`${e.id}: Material ${e.material}`, m.name === e.material, m.name);
  check(`${e.id}: alphaMode MASK`, m.alphaMode === 'MASK', String(m.alphaMode));
  check(`${e.id}: doubleSided`, m.doubleSided === true);
  check(`${e.id}: kein DefaultMaterial`, m.name !== 'DefaultMaterial');
  const prim = json.meshes[0].primitives[0];
  check(`${e.id}: Dreiecke ${e.dreiecke}`, json.accessors[prim.indices].count / 3 === e.dreiecke);
  check(`${e.id}: BIN deckt alle bufferViews`, json.bufferViews.every((v: { byteOffset: number; byteLength: number }) => v.byteOffset + v.byteLength <= bin.length));

  const uri = json.images[0].uri as string;
  check(`${e.id}: Bild-URI wie in der Liste`, uri === e.textur.datei, uri);
  const bildPfad = join(LAB, uri);
  check(`${e.id}: Texturdatei liegt neben dem Modell`, existsSync(bildPfad), bildPfad);
  if (!existsSync(bildPfad)) continue;
  const png = readFileSync(bildPfad);
  check(`${e.id}: Textur-Hash wie in der Liste`, sha(png) === e.textur.hash && png.length === e.textur.bytes);
  const [b, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  const soll = BILDGROESSE[e.material];
  check(`${e.id}: Texturgrösse ${soll[0]}×${soll[1]}`, b === soll[0] && h === soll[1], `${b}×${h}`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('\nstore-lab-pflanzen-dateien: alles grün');
