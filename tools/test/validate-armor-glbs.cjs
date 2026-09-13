/** Validate the native exports and canonical-skin exports of one armor directory.
 * node tools/test/validate-armor-glbs.cjs asset-directory validator-package-path
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [directory, validatorPath] = process.argv.slice(2);
assert(directory && validatorPath, 'Expected asset-directory validator-package-path');
const validator = require(path.resolve(validatorPath));
(async () => {
  const report = {};
  for (const folder of [directory, path.join(directory, 'game-ready')]) {
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.glb'))) {
      const key = path.relative(directory, path.join(folder, file));
      const result = await validator.validateBytes(new Uint8Array(fs.readFileSync(path.join(folder, file))), { uri: file });
      report[key] = result;
      console.log(key, JSON.stringify({ errors: result.issues.numErrors, warnings: result.issues.numWarnings }));
      if (result.issues.numErrors || (folder.endsWith('game-ready') && result.issues.numWarnings)) process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(directory, 'gltf-validation.json'), JSON.stringify(report, null, 2)+'\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
