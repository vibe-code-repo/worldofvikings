/**
 * Prints the table key for one source material name.
 *
 * `materials.ts` is keyed by a digest so that the vendor and product wording in
 * the export's material names is never written into this repository. Adding a
 * material therefore needs one lookup:
 *
 * ```bash
 * pnpm tsx tooling/asset-pipeline/material-key.ts "Some Material 2"
 * ```
 *
 * Paste the key it prints into `MATERIAL_ROWS` with a plain-words description.
 */
import { materialKey } from './materials.js';

const name = process.argv[2];
if (name === undefined || name === '') {
  process.stderr.write('usage: material-key.ts "<material name>"\n');
  process.exit(1);
}
process.stdout.write(`${materialKey(name)}\n`);
