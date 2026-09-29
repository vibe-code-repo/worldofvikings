/**
 * Boundary of the folder `client/src/editor/katalog/` (refactoring step G1).
 *
 * `katalog/kategorien.ts` derives `ITEMS_NACH_NAME`, `MIT_MODELL` and
 * `KATEGORIEN` from the registries WHEN IT LOADS. That is only right while
 * the module is reached through `GegenstandsKatalog.ts`, which
 * `editorMain.ts` loads with a dynamic `import()` after the registrations.
 * A module can be imported from anywhere, and an early import does not fail:
 * the lists are just built too early and miss what is registered later. This
 * test pins the load chain.
 *
 * Read ON THE SYNTAX TREE (TypeScript parser, no text patterns), over every
 * source file under `client/src`:
 *  1. Value imports from `client/src/editor/katalog/*` stand only in
 *     `client/src/editor/GegenstandsKatalog.ts` and inside `katalog/` itself.
 *  2. Nothing imports `GegenstandsKatalog.ts` statically as a value. Allowed:
 *     `import type` and `import('./GegenstandsKatalog')`.
 *  3. No file under `katalog/` imports `GegenstandsKatalog.ts` as a value,
 *     not even dynamically.
 *  4. Behaviour of the moved functions and of the derived lists.
 *
 * What counts as a value import: `import … from`, `import '…'`,
 * `export … from`, `import x = require('…')`, `import('…')`, `require('…')`,
 * `import.meta.glob('…')` and `new URL('…', import.meta.url)`. Type-only are
 * the declaration forms `import type …` and `export type … from` and the
 * type position `import('…').X`. An inline `import { type X } from '…'`
 * counts as a VALUE import on purpose: whether the statement survives the
 * build depends on compiler options, and the boundary must not.
 *
 * Section [0] proves first that the scanner can turn red: it runs the same
 * rules over synthetic sources, one per import form.
 *
 * Limit: the test pins the FORM of the imports, not the moment of the
 * dynamic one. An `await import('./GegenstandsKatalog')` placed before the
 * registrations would pass here.
 *
 * Run (from client/): npx tsx test/katalog-module-grenze.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { ITEM_DEFS, PREFAB_DEFS, isRenderable } from '@wov/shared';
import { STORE_ARTEN } from '../src/editor/StoreKatalogDaten';
import { t } from '../src/editor/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const SRC = resolve(CLIENT_ROOT, 'src');
const KATALOG_DIR = resolve(SRC, 'editor/katalog');
const GEGENSTANDS_KATALOG = resolve(SRC, 'editor/GegenstandsKatalog.ts');
const KATALOG_MODULES = ['format', 'kategorien', 'konstanten'] as const;

/** Own package name: `@wov/client/src/…` reaches the same files through the workspace link in `node_modules`. */
const PACKAGE_NAME = (JSON.parse(readFileSync(resolve(CLIENT_ROOT, 'package.json'), 'utf-8')) as { name: string }).name;

let total = 0;
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  total++;
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}
const rel = (file: string): string => relative(CLIENT_ROOT, file).split(sep).join('/');

// ── Scanner ────────────────────────────────────────────────────────────

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/;
/** Stands for "any text" inside a specifier that is only partly static (template with `${…}`, string concatenation). */
const ANY = '\u0000';

type Target = 'katalog' | 'GegenstandsKatalog';
type Form =
  | 'import'
  | 'export-from'
  | 'import-equals'
  | 'import()'
  | 'require()'
  | 'import.meta.glob'
  | 'new URL'
  | 'import-type-node';

interface Reference {
  readonly file: string;
  readonly line: number;
  readonly form: Form;
  readonly specifier: string;
  readonly typeOnly: boolean;
  /** Loaded when the statement RUNS (`import()`), not when the importing module loads. */
  readonly dynamic: boolean;
  readonly target: Target;
}

function isInside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(dir + sep);
}

/** Every source file under `dir`, declaration files excluded (they never reach the build output). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') out.push(...sourceFiles(path));
    } else if (SOURCE_EXT.test(entry.name) && !DECLARATION_FILE.test(entry.name)) {
      out.push(path);
    }
  }
  return out.sort();
}

/**
 * Static text of a specifier expression, with {@link ANY} for every part that
 * is only known at run time. `null` when nothing at all is static.
 */
function specifierText(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => ANY + span.literal.text).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = specifierText(node.left) ?? ANY;
    const right = specifierText(node.right) ?? ANY;
    return left === ANY && right === ANY ? null : left + right;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return specifierText(node.expression);
  }
  return null;
}

/** Absolute path a specifier points to (query and hash dropped), `null` for another package. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare === '.' || bare === '..' || bare.startsWith('./') || bare.startsWith('../')) {
    return resolve(dirname(fromFile), bare);
  }
  // Vite resolves a leading slash against the project root.
  if (bare.startsWith('/')) return resolve(CLIENT_ROOT, `.${bare}`);
  if (bare === PACKAGE_NAME || bare.startsWith(`${PACKAGE_NAME}/`)) {
    return resolve(CLIENT_ROOT, `.${bare.slice(PACKAGE_NAME.length)}`);
  }
  return null;
}

/** Glob to regular expression: `**`, `*`, `?`, `{a,b}` and {@link ANY}. */
function patternToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === ANY) out += '.*';
    else if (c === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i++;
      if (pattern[i + 1] === '/') i++; // `**/` also matches no folder at all
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') out += '(?:';
    else if (c === '}') out += ')';
    else if (c === ',') out += '|';
    else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** The modules a reference can reach. `katalogFiles` is only asked for specifiers with wildcards. */
function targetsOf(fromFile: string, specifier: string, katalogFiles: readonly string[]): Target[] {
  const resolved = resolveSpecifier(fromFile, specifier);
  if (resolved === null) return [];
  const gegenstandsKatalog = GEGENSTANDS_KATALOG.replace(SOURCE_EXT, '');
  if (!/[*?{\u0000]/.test(specifier)) {
    const stem = resolved.replace(SOURCE_EXT, '');
    if (isInside(KATALOG_DIR, stem)) return ['katalog'];
    return stem === gegenstandsKatalog ? ['GegenstandsKatalog'] : [];
  }
  const muster = patternToRegExp(resolved.split(sep).join('/'));
  const trifft = (path: string): boolean => {
    const mitSchraegstrich = path.split(sep).join('/');
    return muster.test(mitSchraegstrich) || muster.test(mitSchraegstrich.replace(SOURCE_EXT, ''));
  };
  const targets: Target[] = [];
  if (trifft(KATALOG_DIR) || katalogFiles.some(trifft)) targets.push('katalog');
  if (trifft(GEGENSTANDS_KATALOG)) targets.push('GegenstandsKatalog');
  return targets;
}

function isImportMeta(node: ts.Node): boolean {
  return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'meta';
}

/** Every reference to `katalog/*` or `GegenstandsKatalog.ts` in one source text. */
function referencesIn(file: string, text: string, katalogFiles: readonly string[]): Reference[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: Reference[] = [];
  const add = (node: ts.Node, form: Form, specifier: string | null, typeOnly: boolean, dynamic = false): void => {
    if (specifier === null) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    for (const target of targetsOf(file, specifier, katalogFiles)) {
      out.push({ file, line, form, specifier: specifier.split(ANY).join('${…}'), typeOnly, dynamic, target });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node, 'import', specifierText(node.moduleSpecifier), node.importClause?.isTypeOnly === true);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, 'export-from', specifierText(node.moduleSpecifier), node.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, 'import-equals', specifierText(node.moduleReference.expression), node.isTypeOnly);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        add(node, 'import-type-node', node.argument.literal.text, true);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0];
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (first) add(node, 'import()', specifierText(first), false, true);
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        if (first) add(node, 'require()', specifierText(first), false);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        isImportMeta(callee.expression) &&
        callee.name.text.startsWith('glob')
      ) {
        const patterns = first && ts.isArrayLiteralExpression(first) ? first.elements : first ? [first] : [];
        for (const pattern of patterns) add(node, 'import.meta.glob', specifierText(pattern), false);
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
      const [first, second] = node.arguments ?? [];
      if (
        first &&
        second &&
        ts.isPropertyAccessExpression(second) &&
        isImportMeta(second.expression) &&
        second.name.text === 'url'
      ) {
        add(node, 'new URL', specifierText(first), false);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

// ── Rules ──────────────────────────────────────────────────────────────

interface Violation {
  readonly rule: 1 | 2 | 3;
  readonly reference: Reference;
}

function violationsOf(references: readonly Reference[]): Violation[] {
  const out: Violation[] = [];
  for (const reference of references) {
    if (reference.typeOnly) continue;
    const inKatalog = isInside(KATALOG_DIR, reference.file);
    if (reference.target === 'katalog') {
      if (!inKatalog && reference.file !== GEGENSTANDS_KATALOG) out.push({ rule: 1, reference });
    } else if (inKatalog) {
      out.push({ rule: 3, reference });
    } else if (!reference.dynamic) {
      out.push({ rule: 2, reference });
    }
  }
  return out;
}

const describe = (v: Violation): string =>
  `${rel(v.reference.file)}:${v.reference.line} ${v.reference.form} '${v.reference.specifier}'`;

// ── Scan of the real tree ──────────────────────────────────────────────

const files = existsSync(SRC) ? sourceFiles(SRC) : [];
const katalogFiles = files.filter((file) => isInside(KATALOG_DIR, file));
const references = files.flatMap((file) => referencesIn(file, readFileSync(file, 'utf-8'), katalogFiles));
const violations = violationsOf(references);

// ── [0] Teeth: every import form, against the same rules ───────────────

console.log('── [0] The scanner can turn red (synthetic sources) ──');
{
  const EDITOR_MAIN = 'src/editor/editorMain.ts';
  const MAIN = 'src/main.ts';
  const FORMAT = 'src/editor/katalog/format.ts';
  const PROBES: ReadonlyArray<readonly [file: string, source: string, rules: readonly number[]]> = [
    // rule 1: value imports of katalog/* outside GegenstandsKatalog.ts and katalog/
    [EDITOR_MAIN, `import { KATEGORIEN } from './katalog/kategorien';`, [1]],
    [EDITOR_MAIN, `import k from './katalog/kategorien.ts';`, [1]],
    [EDITOR_MAIN, `import * as k from './katalog/konstanten.js';`, [1]],
    [EDITOR_MAIN, `import './katalog/kategorien';`, [1]],
    [EDITOR_MAIN, `import { type Kennzahlen } from './katalog/konstanten';`, [1]],
    [EDITOR_MAIN, `export { fmt } from './katalog/format';`, [1]],
    [EDITOR_MAIN, `export * from './katalog/format';`, [1]],
    [EDITOR_MAIN, `void import('./katalog/kategorien');`, [1]],
    [EDITOR_MAIN, 'void import(`./katalog/kategorien`);', [1]],
    [EDITOR_MAIN, 'const name = "format"; void import(`./katalog/${name}.ts`);', [1]],
    [EDITOR_MAIN, `const name = 'format'; void import('./katalog/' + name);`, [1]],
    [EDITOR_MAIN, `const k = require('./katalog/kategorien');`, [1]],
    [EDITOR_MAIN, `import k = require('./katalog/kategorien');`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob('./katalog/*.ts', { eager: true });`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob(['./werkzeuge/*.ts', './**/kategorien.ts']);`, [1]],
    [EDITOR_MAIN, `const u = new URL('./katalog/kategorien.ts', import.meta.url);`, [1]],
    [EDITOR_MAIN, `import { fmt } from './katalog';`, [1]],
    [MAIN, `import { fmt } from './editor/katalog/format';`, [1]],
    [MAIN, `import { fmt } from '/src/editor/katalog/format.ts';`, [1]],
    [MAIN, `import { fmt } from '${PACKAGE_NAME}/src/editor/katalog/format';`, [1]],
    ['src/editor/testflug/Testflug.ts', `import { SEITE_GROESSE } from '../katalog/konstanten';`, [1]],
    // rule 1: what is allowed
    [EDITOR_MAIN, `import type { Kennzahlen } from './katalog/konstanten';`, []],
    [EDITOR_MAIN, `export type { Kennzahlen } from './katalog/konstanten';`, []],
    [EDITOR_MAIN, `type K = import('./katalog/konstanten').Kennzahlen;`, []],
    ['src/editor/GegenstandsKatalog.ts', `import { fmt } from './katalog/format';`, []],
    ['src/editor/katalog/neu.ts', `import { fmt } from './format';`, []],
    // rule 2: static value imports of GegenstandsKatalog.ts
    [EDITOR_MAIN, `import { GegenstandsKatalog } from './GegenstandsKatalog';`, [2]],
    [EDITOR_MAIN, `import './GegenstandsKatalog';`, [2]],
    [EDITOR_MAIN, `const m = import.meta.glob('./Gegenstands*.ts');`, [2]],
    [MAIN, `export * from './editor/GegenstandsKatalog.ts';`, [2]],
    [EDITOR_MAIN, `import type { GegenstandsKatalog } from './GegenstandsKatalog';`, []],
    [EDITOR_MAIN, `void import('./GegenstandsKatalog');`, []],
    // rule 3: katalog/ never loads GegenstandsKatalog.ts
    [FORMAT, `import { GegenstandsKatalog } from '../GegenstandsKatalog';`, [3]],
    [FORMAT, `void import('../GegenstandsKatalog');`, [3]],
    [FORMAT, `import type { GegenstandsKatalog } from '../GegenstandsKatalog';`, []],
    // neither target, and text that only LOOKS like an import
    [EDITOR_MAIN, `import { DungeonSeite } from './DungeonKatalog';`, []],
    [EDITOR_MAIN, `import { x } from './katalogAnderes';`, []],
    [EDITOR_MAIN, `import { x } from '@wov/shared';`, []],
    [EDITOR_MAIN, `// import { KATEGORIEN } from './katalog/kategorien';`, []],
    [EDITOR_MAIN, `const s = "import { KATEGORIEN } from './katalog/kategorien';";`, []],
    [EDITOR_MAIN, `const pfad = './katalog/kategorien'; void import(pfad);`, []],
  ];
  const probeKatalogFiles = KATALOG_MODULES.map((name) => resolve(KATALOG_DIR, `${name}.ts`));
  for (const [file, source, rules] of PROBES) {
    const found = violationsOf(referencesIn(resolve(CLIENT_ROOT, file), source, probeKatalogFiles)).map((v) => v.rule);
    check(
      `${file}: ${source}`,
      found.join(',') === rules.join(','),
      `rules hit: ${found.join(',') || 'none'}, expected: ${rules.join(',') || 'none'}`,
    );
  }
}

// ── [1]–[3] The real tree ──────────────────────────────────────────────

console.log('\n── Scan ──');
check('client/src was read', files.length > 0, `${files.length} source files`);
for (const name of KATALOG_MODULES) {
  check(`katalog/${name}.ts exists`, katalogFiles.includes(resolve(KATALOG_DIR, `${name}.ts`)));
}
check('GegenstandsKatalog.ts exists', files.includes(GEGENSTANDS_KATALOG));

const valueReferences = references.filter((r) => !r.typeOnly);
const list = (wanted: readonly Reference[]): string =>
  wanted.map((r) => `${rel(r.file)}:${r.line} ${r.form} '${r.specifier}'`).join(' | ') || 'none';

console.log('\n── [1] Value imports of katalog/* only in GegenstandsKatalog.ts and in katalog/ ──');
{
  const ofKatalog = valueReferences.filter((r) => r.target === 'katalog');
  // Witness against an empty rule: the one allowed importer really imports every module.
  for (const name of KATALOG_MODULES) {
    const stem = resolve(KATALOG_DIR, name);
    check(
      `GegenstandsKatalog.ts imports katalog/${name} as a value`,
      ofKatalog.some(
        (r) =>
          r.file === GEGENSTANDS_KATALOG &&
          resolveSpecifier(r.file, r.specifier)?.replace(SOURCE_EXT, '') === stem,
      ),
    );
  }
  const found = violations.filter((v) => v.rule === 1);
  check(
    'no value import of katalog/* anywhere else',
    found.length === 0,
    found.length ? found.map(describe).join(' | ') : `${ofKatalog.length} value imports, all allowed: ${list(ofKatalog)}`,
  );
}

console.log('\n── [2] GegenstandsKatalog.ts is never imported statically as a value ──');
{
  const ofClass = references.filter((r) => r.target === 'GegenstandsKatalog');
  // Witness against an empty rule: somebody does load the class, and does it dynamically.
  const dynamic = ofClass.filter((r) => r.dynamic);
  check('GegenstandsKatalog.ts is loaded with import() somewhere', dynamic.length > 0, list(dynamic));
  const found = violations.filter((v) => v.rule === 2);
  check(
    'no static value import of GegenstandsKatalog.ts',
    found.length === 0,
    found.length
      ? found.map(describe).join(' | ')
      : `${ofClass.length} references: ${ofClass.filter((r) => r.typeOnly).length} type-only, ${dynamic.length} import()`,
  );
}

console.log('\n── [3] katalog/ never imports GegenstandsKatalog.ts as a value ──');
{
  const found = violations.filter((v) => v.rule === 3);
  check(
    'no value import of GegenstandsKatalog.ts under katalog/',
    found.length === 0,
    found.length ? found.map(describe).join(' | ') : `${katalogFiles.length} files under katalog/`,
  );
}

// ── [4] Behaviour ──────────────────────────────────────────────────────

console.log('\n── [4] Behaviour of the moved functions and of the derived lists ──');
/** Loads a module of `katalog/`; a missing module is a failed check, not a crash without a count. */
async function load<T>(name: string, laden: () => Promise<T>): Promise<T | null> {
  try {
    const modul = await laden();
    check(`katalog/${name}.ts loads without a browser`, true);
    return modul;
  } catch (error) {
    check(`katalog/${name}.ts loads without a browser`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    return null;
  }
}

const format = await load('format', () => import('../src/editor/katalog/format'));
if (format) {
  const { fmt, fmtBytes, kollisionsartText, vorschlagText, zahlLocale } = format;
  const gleich = (name: string, ist: string, soll: string): void => check(`${name} = '${soll}'`, ist === soll, `got '${ist}'`);
  gleich('fmt(12.412345678)', fmt(12.412345678), '12,4');
  gleich('fmt(NaN)', fmt(NaN), '—');
  gleich('fmt(Infinity)', fmt(Infinity), '—');
  gleich('fmt(0.5)', fmt(0.5), '0,50');
  gleich('fmt(9.999)', fmt(9.999), '10,00');
  gleich('fmt(10)', fmt(10), '10,0');
  gleich('fmt(99.95)', fmt(99.95), '100,0');
  gleich('fmt(100)', fmt(100), '100');
  gleich('fmt(-3.14159)', fmt(-3.14159), '-3,14');
  gleich('fmtBytes(20560)', fmtBytes(20560), '20 kB');
  gleich('fmtBytes(-1)', fmtBytes(-1), '—');
  gleich('fmtBytes(NaN)', fmtBytes(NaN), '—');
  gleich('fmtBytes(0)', fmtBytes(0), '0 B');
  gleich('fmtBytes(1023)', fmtBytes(1023), '1023 B');
  gleich('fmtBytes(1024)', fmtBytes(1024), '1 kB');
  gleich('fmtBytes(1048575)', fmtBytes(1048575), '1024 kB');
  gleich('fmtBytes(1048576)', fmtBytes(1048576), '1,0 MB');
  gleich('fmtBytes(17825792)', fmtBytes(17825792), '17,0 MB');
  // Without a browser there is neither `?lang` nor a stored choice: the language is the default, `de`.
  gleich('zahlLocale()', zahlLocale(), 'de-DE');
  gleich(`kollisionsartText('fest')`, kollisionsartText('fest'), t('editor.upload.kollision.fest'));
  gleich(
    `kollisionsartText('durchlaessig')`,
    kollisionsartText('durchlaessig'),
    t('editor.upload.kollision.durchlaessig'),
  );
  gleich(
    'vorschlagText(rohgroesse, 1.5 m)',
    vorschlagText({ quelle: 'rohgroesse', meter: 1.5 }),
    t('editor.upload.vorschlag.rohgroesse', { name: '', meter: '1.50' }),
  );
  gleich(
    'vorschlagText(kategorie, 2 m, Tisch)',
    vorschlagText({ quelle: 'kategorie', meter: 2, begruendungName: 'Tisch' }),
    t('editor.upload.vorschlag.kategorie', { name: 'Tisch', meter: '2.00' }),
  );
}

const kategorien = await load('kategorien', () => import('../src/editor/katalog/kategorien'));
if (kategorien) {
  const { ITEMS_NACH_NAME, KATEGORIEN } = kategorien;
  // `MIT_MODELL` has no export (nothing outside the module uses it): it is checked through `KATEGORIEN`.
  const mitModell = PREFAB_DEFS.filter((d) => d.model !== null && isRenderable(d));
  const listsMitModell = KATEGORIEN.filter((k) => k.namen().join('|') === mitModell.map((d) => d.name).join('|'));
  check(
    'exactly one entry lists MIT_MODELL: the same filter over PREFAB_DEFS gives the same names',
    listsMitModell.length === 1 && mitModell.length > 0,
    `${mitModell.length} of ${PREFAB_DEFS.length} prefabs`,
  );
  check(
    'its hint names the length of MIT_MODELL',
    listsMitModell.length === 1 && listsMitModell[0]!.hinweis.includes(String(mitModell.length)),
    listsMitModell[0]?.hinweis ?? 'entry missing',
  );
  check(
    'ITEMS_NACH_NAME has one entry per item name',
    ITEMS_NACH_NAME.size === new Set(ITEM_DEFS.map((i) => i.name)).size && ITEMS_NACH_NAME.size > 0,
    `${ITEMS_NACH_NAME.size} names`,
  );
  // Texts are left free on purpose (translation changes them); pinned is the structure.
  const FIXED = 7;
  check(
    'KATEGORIEN has seven fixed entries plus one per entry of STORE_ARTEN',
    KATEGORIEN.length === FIXED + STORE_ARTEN.length && STORE_ARTEN.length > 0,
    `${KATEGORIEN.length} = ${FIXED} + ${STORE_ARTEN.length}`,
  );
  check(
    'the store entries come last and follow STORE_ARTEN, the fixed ones carry no store kind',
    KATEGORIEN.map((k) => k.speicher ?? '-').join('|') ===
      [...Array.from({ length: FIXED }, () => '-'), ...STORE_ARTEN].join('|'),
    KATEGORIEN.map((k) => k.speicher ?? '-').join('|'),
  );
  check(
    'exactly one entry is dynamic, and it is a fixed one',
    KATEGORIEN.filter((k) => k.dynamisch).length === 1 &&
      KATEGORIEN.slice(0, FIXED).filter((k) => k.dynamisch).length === 1,
  );
}

// No check of the values: they are tuning. Loading without a browser is the point (no runtime import).
await load('konstanten', () => import('../src/editor/katalog/konstanten'));

console.log('');
if (failures === 0) {
  console.log(`=== katalog-module-grenze: ${total} of ${total} checks passed ===`);
} else {
  console.error(`=== katalog-module-grenze: ${failures} of ${total} checks FAILED ===`);
  process.exit(1);
}
