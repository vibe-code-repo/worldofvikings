#!/usr/bin/env node
/** Export the shared set catalog without accessing accounts, inventories or world saves.
 * tsx tools/armor/catalog/equipment-sets-json.mjs [output.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equipmentSetCatalog } from '../../../shared/src/equipmentSets.ts';

const output = process.argv[2] ?? fileURLToPath(new URL('../../../assets/equipment-sets.json', import.meta.url));
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(equipmentSetCatalog(), null, 2) + '\n');
console.log(`Exported equipment set catalog: ${output}`);
