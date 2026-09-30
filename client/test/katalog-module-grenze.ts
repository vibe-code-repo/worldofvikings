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
 *  2b. Every `import()` of `GegenstandsKatalog.ts` stands in the body of a
 *     function, so it runs when that function is called. At module level it
 *     runs while the importing module loads and is a violation, also with
 *     `void`, with a top-level `await` or with `.then(…)`. The rule names no
 *     file and no line.
 *  3. No file under `katalog/` imports `GegenstandsKatalog.ts` as a value,
 *     not even dynamically.
 *  4. Behaviour of the moved functions and of the derived lists.
 *  5. There is no symbolic link under `client/src`. The scanner follows none:
 *     it does not enter a linked folder, and an import through a link
 *     resolves to the path of the link, not to the file behind it.
 *  6. Step G2 (`pruefen.ts`, `kontext.ts`): both modules only declare (imports
 *     with names, type aliases, function declarations, one export list), so
 *     loading them does nothing. `pruefen.ts` imports exactly `PREFABS_BY_NAME`
 *     from `@wov/shared`, `modelUrl` from the engine, `SPEICHER_WURZEL` from
 *     `../StoreKatalogDaten` and `PRUEF_PARALLEL` from `./konstanten`: the names
 *     the moved methods used inside the class. No other module under `katalog/`
 *     imports from `engine/`. `kontext.ts` names `GegenstandsKatalog.ts` as a
 *     type and nothing else; no other module under `katalog/` names it at all,
 *     not even as a type. No import cycle among the modules under `katalog/`.
 *  7. The two moved methods are forwarders: methods of the prototype without
 *     `async` whose body is the one statement `return <name>(this, …)`;
 *     `pruefen.ts` exports exactly the two functions, both `async`, with one
 *     parameter more; the context type names exactly the members the functions
 *     use through `k`, and none of them is `private`.
 *  8. Behaviour: a fixed sequence of calls against a stub of the context with
 *     `fetch` and `window` replaced, recorded (requests, button texts, status
 *     lines, list refreshes, timers, the map `vorhanden` at the end), gives the
 *     lines measured before the move: with the functions on a stub, and with
 *     the methods of the prototype on an object that has the prototype of the
 *     class (there the inner call reaches the forwarder). Every line carries the
 *     number of microtask ticks that have run beside the call, so an added or
 *     dropped `await` moves the lines behind it (step G3, finding G2-A2). The
 *     names of the sequence are prefabs whose model differs from their name, so
 *     a function that mixes the two shows (finding G2-A3).
 *  9. Step G3 (`infofeld.ts`, `kontext.ts`): the same rules for the two methods of
 *     the info block. `infofeld.ts` only declares, imports exactly the listed
 *     names, exports exactly the two plain functions; the two methods are
 *     forwarders; the context names exactly the eleven members the functions use
 *     through `kat` (the loop variable `k` of the bodies is why the context is not
 *     called `k`). Behaviour: a fixed sequence against a stub of the context and
 *     a small stand-in for the DOM (every element and every change recorded,
 *     every button clicked, the tree written out) gives the scenes measured on the
 *     methods of the class before the move.
 * 10. Rules that hold for every module of the form k under `katalog/` (step G3,
 *     K9 of the rules): (1) the head of each forwarder up to the `{` is a text fixed
 *     here; (2) the value imports of each module are a fixed list; (3) the list of
 *     the members of the class that are not private is fixed; (4) `import { type X }`
 *     counts as a value edge, never as a type import; (5) objects of the stock come
 *     back and go on as themselves: the base-scale row is the very node appended,
 *     the map `vorhanden` the very map that is written.
 * 11. The search for import cycles (step G2, finding G2-A1) is checked through the
 *     same two functions that read the real modules.
 *
 * What counts as a value import: `import … from`, `import '…'`,
 * `export … from`, `import x = require('…')`, `import('…')`, `require('…')`,
 * `import.meta.glob('…')` and `new URL('…', import.meta.url)`. A glob without
 * `eager: true` loads like `import()`. Type-only are the declaration forms
 * `import type …` and `export type … from` and the type position
 * `import('…').X`. An inline `import { type X } from '…'` counts as a VALUE
 * import on purpose: whether the statement survives the build depends on
 * compiler options, and the boundary must not.
 *
 * What counts as the body of a function (rule 2b): the body of a function, of
 * an arrow function, of a method, of a constructor and of an accessor.
 * Everything else counts as module level, in places stricter than needed: a
 * class field, a `static` block, a decorator, a computed name and the default
 * of a parameter.
 *
 * Section [0] proves first that the scanner can turn red: it runs the same
 * rules over synthetic sources, one per import form. Section [0b] does the
 * same for the search for symbolic links, in a temporary folder.
 *
 * Known limits:
 *  - Rule 2b sees where an `import()` STANDS, not when its function is
 *    CALLED. A function that is called at module level passes: a function
 *    invoked on the spot, a callback handed to `then` or `setTimeout`, a
 *    function that a glob without `eager` hands out.
 *  - A path that is computed completely (`const p = …; import(p)`) is not
 *    read. Read are a string, a template (`${…}` stands for any text), a
 *    concatenation and a tagged template (by its text, the tag is not run).
 *  - An alias (`paths` in a tsconfig, `resolve.alias` in the Vite config) is
 *    not resolved.
 *  - A query counts as a value import, also `?url`, which does not evaluate
 *    the module. That is stricter than needed.
 *
 * Run (from client/): npx tsx test/katalog-module-grenze.ts
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { ITEM_DEFS, PREFABS_BY_NAME, PREFAB_DEFS, isRenderable, istEigenesModell, uploadedModelRegistry } from '@wov/shared';
import { SPEICHER_WURZEL, STORE_ARTEN } from '../src/editor/StoreKatalogDaten';
import { t } from '../src/editor/i18n';
import { modelUrl } from '../src/engine/AssetManager';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const SRC = resolve(CLIENT_ROOT, 'src');
const KATALOG_DIR = resolve(SRC, 'editor/katalog');
const GEGENSTANDS_KATALOG = resolve(SRC, 'editor/GegenstandsKatalog.ts');
const KATALOG_MODULES = ['format', 'kategorien', 'konstanten', 'pruefen', 'kontext', 'infofeld'] as const;
/** The modules the class imports itself, as values. `kontext.ts` holds only a type and is reached from `pruefen.ts`. */
const IMPORTED_BY_CLASS = ['format', 'kategorien', 'konstanten', 'pruefen', 'infofeld'] as const;
const PRUEFEN_TS = resolve(KATALOG_DIR, 'pruefen.ts');
const INFOFELD_TS = resolve(KATALOG_DIR, 'infofeld.ts');
const KONTEXT_TS = resolve(KATALOG_DIR, 'kontext.ts');
const ENGINE_DIR = resolve(SRC, 'engine');

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
  /** Loaded when the statement RUNS (`import()`, a glob without `eager`), not when the importing module loads. */
  readonly dynamic: boolean;
  /** The statement stands in the body of a function: it runs when the function is called, not while the module loads. */
  readonly inFunctionBody: boolean;
  readonly target: Target;
}

interface Link {
  readonly path: string;
  readonly target: string;
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
 * Every symbolic link under `dir`, and the number of entries looked at. A linked folder is reported
 * and not entered, so a link to an ancestor cannot hang the walk.
 */
function scanLinks(dir: string): { readonly links: readonly Link[]; readonly entries: number } {
  const links: Link[] = [];
  let entries = 0;
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      entries++;
      const path = resolve(folder, entry.name);
      if (entry.isSymbolicLink()) links.push({ path, target: readlinkSync(path) });
      else if (entry.isDirectory()) walk(path);
    }
  };
  walk(dir);
  links.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { links, entries };
}

/** The links as text, each path relative to `root`. */
const describeLinks = (root: string, links: readonly Link[]): string =>
  links.map((link) => `${relative(root, link.path).split(sep).join('/')} -> ${link.target}`).join(' | ');

/**
 * Whether `node` stands in the body of a function. Only the body counts: a decorator, a computed
 * name and the default of a parameter belong to the node of the function too, and the first two run
 * where the function is declared.
 */
function isInFunctionBody(node: ts.Node): boolean {
  let child = node;
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isFunctionLike(parent) && 'body' in parent && parent.body === child) return true;
    child = parent;
  }
  return false;
}

/**
 * Static text of a specifier expression, with {@link ANY} for every part that
 * is only known at run time. `null` when nothing at all is static.
 */
function specifierText(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  // A tagged template (String.raw`./katalog/x`) is read by the text of its template. The tag is not run.
  if (ts.isTaggedTemplateExpression(node)) return specifierText(node.template);
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => ANY + span.literal.text).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = specifierText(node.left) ?? ANY;
    const right = specifierText(node.right) ?? ANY;
    return left === ANY && right === ANY ? null : left + right;
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return specifierText(node.expression);
  }
  return null;
}

/**
 * Absolute path a specifier points to, `null` for another package. A query or hash (`?raw`, `#x`) is
 * dropped, except in a glob: there `?` is a wildcard.
 */
function resolveSpecifier(fromFile: string, specifier: string, glob = false): string | null {
  const bare = glob ? specifier : specifier.replace(/[?#].*$/, '');
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

/** Glob to regular expression: `**`, `*`, `?`, `{a,b}`, `[a-z]` and {@link ANY}. */
function patternToRegExp(glob: string): RegExp {
  let out = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    const classEnd = c === '[' ? glob.indexOf(']', i + 2) : -1;
    if (c === ANY) out += '.*';
    else if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
      if (glob[i + 1] === '/') i++; // `**/` also matches no folder at all
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (classEnd > 0) {
      // A character class is taken over as it is; a glob negates with `!`, a regular expression with `^`.
      out += `[${glob.slice(i + 1, classEnd).replace(/^!/, '^')}]`;
      i = classEnd;
    } else if (c === '{') {
      out += '(?:';
      braces++;
    } else if (c === '}' && braces > 0) {
      out += ')';
      braces--;
    } else if (c === ',' && braces > 0) out += '|';
    else out += c.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * The modules a reference can reach. Wildcards are the glob characters in a glob and {@link ANY}
 * everywhere. Only then `katalogFiles` is asked; a plain specifier is judged by its path alone.
 */
function targetsOf(fromFile: string, specifier: string, katalogFiles: readonly string[], glob: boolean): Target[] {
  const resolved = resolveSpecifier(fromFile, specifier, glob);
  if (resolved === null) return [];
  const hasWildcard = specifier.includes(ANY) || (glob && /[*?{[]/.test(specifier));
  if (!hasWildcard) {
    const stem = resolved.replace(SOURCE_EXT, '');
    if (isInside(KATALOG_DIR, stem)) return ['katalog'];
    return stem === GEGENSTANDS_KATALOG.replace(SOURCE_EXT, '') ? ['GegenstandsKatalog'] : [];
  }
  const pattern = patternToRegExp(resolved.split(sep).join('/'));
  const matches = (path: string): boolean => {
    const withSlashes = path.split(sep).join('/');
    return pattern.test(withSlashes) || pattern.test(withSlashes.replace(SOURCE_EXT, ''));
  };
  const targets: Target[] = [];
  if (matches(KATALOG_DIR) || katalogFiles.some(matches)) targets.push('katalog');
  if (matches(GEGENSTANDS_KATALOG)) targets.push('GegenstandsKatalog');
  return targets;
}

/** `eager: true` in the options of `import.meta.glob`. Options that cannot be read count as eager. */
function isEagerGlob(options: ts.Expression | undefined): boolean {
  if (!options) return false;
  if (!ts.isObjectLiteralExpression(options)) return true;
  return options.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return true; // spread, shorthand, method: not readable
    if (!ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name)) return true; // computed name
    return property.name.text === 'eager' && property.initializer.kind !== ts.SyntaxKind.FalseKeyword;
  });
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
    const inFunctionBody = isInFunctionBody(node);
    for (const target of targetsOf(file, specifier, katalogFiles, form === 'import.meta.glob')) {
      const shown = specifier.split(ANY).join('${…}');
      out.push({ file, line, form, specifier: shown, typeOnly, dynamic, inFunctionBody, target });
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
        // Without `eager` a glob hands out functions that import when called, like `import()`. A
        // pattern with a leading `!` only takes files away and is not resolved.
        const lazy = callee.name.text === 'glob' && !isEagerGlob(node.arguments[1]);
        for (const pattern of patterns) add(node, 'import.meta.glob', specifierText(pattern), false, lazy);
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

type Rule = 1 | 2 | '2b' | 3;

interface Violation {
  readonly rule: Rule;
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
    } else if (reference.form === 'import()' && !reference.inFunctionBody) {
      out.push({ rule: '2b', reference });
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
const linkScan = existsSync(SRC) ? scanLinks(SRC) : { links: [], entries: 0 };

// ── [0] Teeth: every import form, against the same rules ───────────────

console.log('── [0] The scanner can turn red (synthetic sources) ──');
{
  const EDITOR_MAIN = 'src/editor/editorMain.ts';
  const MAIN = 'src/main.ts';
  const FORMAT = 'src/editor/katalog/format.ts';
  const PROBES: ReadonlyArray<readonly [file: string, source: string, rules: readonly Rule[]]> = [
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
    [EDITOR_MAIN, `const m = import.meta.glob('./katalog/*.ts');`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob(['./werkzeuge/*.ts', './**/kategorien.ts']);`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob('./katalog/form?t.ts');`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob('./katalog/{format,konstanten}.ts');`, [1]],
    [EDITOR_MAIN, `const m = import.meta.glob('./katalog/[a-k]*.ts');`, [1]],
    [EDITOR_MAIN, `import text from './katalog/kategorien?raw';`, [1]],
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
    [EDITOR_MAIN, `const m = import.meta.glob('./Gegenstands*.ts', { eager: true });`, [2]],
    [EDITOR_MAIN, `const o = { eager: true }; const m = import.meta.glob('./Gegenstands*.ts', o);`, [2]],
    [MAIN, `export * from './editor/GegenstandsKatalog.ts';`, [2]],
    [EDITOR_MAIN, `import type { GegenstandsKatalog } from './GegenstandsKatalog';`, []],
    [EDITOR_MAIN, `const open = () => import('./GegenstandsKatalog');`, []],
    [EDITOR_MAIN, `const m = import.meta.glob('./Gegenstands*.ts');`, []],
    [EDITOR_MAIN, `const m = import.meta.glob('./Gegenstands*.ts', { eager: false });`, []],
    // rule 2b: an import() of GegenstandsKatalog.ts at module level
    [EDITOR_MAIN, `void import('./GegenstandsKatalog');`, ['2b']],
    [EDITOR_MAIN, `await import('./GegenstandsKatalog');`, ['2b']],
    [EDITOR_MAIN, `const k = await import('./GegenstandsKatalog').then((m) => m);`, ['2b']],
    [EDITOR_MAIN, `if (location.hash) { void import('./GegenstandsKatalog'); }`, ['2b']],
    [EDITOR_MAIN, `export default import('./GegenstandsKatalog.ts');`, ['2b']],
    [MAIN, `void import('./editor/GegenstandsKatalog');`, ['2b']],
    // rule 2b: what counts as module level although it stands inside a class or a function node
    [EDITOR_MAIN, `class A { static { void import('./GegenstandsKatalog'); } }`, ['2b']],
    [EDITOR_MAIN, `class A { static k = import('./GegenstandsKatalog'); }`, ['2b']],
    [EDITOR_MAIN, `class A { k = import('./GegenstandsKatalog'); }`, ['2b']],
    [EDITOR_MAIN, `class A { @mark(import('./GegenstandsKatalog')) m() {} }`, ['2b']],
    [EDITOR_MAIN, `class A { [(void import('./GegenstandsKatalog'), 'm')]() {} }`, ['2b']],
    [EDITOR_MAIN, `function f(k = import('./GegenstandsKatalog')) { return k; }`, ['2b']],
    // rule 2b: in the body of a function it is allowed
    [EDITOR_MAIN, `btn.onclick = () => { void import('./GegenstandsKatalog'); };`, []],
    [EDITOR_MAIN, `async function oeffne() { await import('./GegenstandsKatalog'); }`, []],
    [EDITOR_MAIN, `class A { m() { return import('./GegenstandsKatalog'); } }`, []],
    [EDITOR_MAIN, `class A { constructor() { void import('./GegenstandsKatalog'); } }`, []],
    [EDITOR_MAIN, `class A { get k() { return import('./GegenstandsKatalog'); } }`, []],
    [EDITOR_MAIN, `const o = { open: function () { return import('./GegenstandsKatalog'); } };`, []],
    [EDITOR_MAIN, `function f() { if (location.hash) { for (;;) void import('./GegenstandsKatalog'); } }`, []],
    [EDITOR_MAIN, `class A { k = () => import('./GegenstandsKatalog'); }`, []],
    // rule 2b: a type position loads nothing, and the known limit (a function called at module level)
    [EDITOR_MAIN, `type K = typeof import('./GegenstandsKatalog');`, []],
    [EDITOR_MAIN, `(async () => { await import('./GegenstandsKatalog'); })();`, []],
    // rule 3: katalog/ never loads GegenstandsKatalog.ts
    [FORMAT, `import { GegenstandsKatalog } from '../GegenstandsKatalog';`, [3]],
    [FORMAT, `void import('../GegenstandsKatalog');`, [3]],
    [FORMAT, `const m = import.meta.glob('../Gegenstands*.ts');`, [3]],
    [FORMAT, `import type { GegenstandsKatalog } from '../GegenstandsKatalog';`, []],
    [FORMAT, `function f() { return import('../GegenstandsKatalog'); }`, [3]],
    // a tagged template is read by its text, the tag is not run
    [EDITOR_MAIN, 'void import(String.raw`./katalog/kategorien`);', [1]],
    [EDITOR_MAIN, 'const k = require(String.raw`./katalog/kategorien`);', [1]],
    [EDITOR_MAIN, 'const name = "format"; void import(String.raw`./katalog/${name}`);', [1]],
    [EDITOR_MAIN, 'void import(tag`./katalog/kategorien`);', [1]],
    [EDITOR_MAIN, 'const u = new URL(String.raw`./GegenstandsKatalog.ts`, import.meta.url);', [2]],
    [EDITOR_MAIN, 'void import(String.raw`./GegenstandsKatalog`);', ['2b']],
    [FORMAT, 'function f() { return import(String.raw`../GegenstandsKatalog`); }', [3]],
    [EDITOR_MAIN, 'const s = String.raw`./katalog/kategorien`;', []],
    [EDITOR_MAIN, 'void import(String.raw`./katalogAnderes`);', []],
    // a type around the path changes nothing
    [EDITOR_MAIN, `void import('./katalog/kategorien' as string);`, [1]],
    [EDITOR_MAIN, `void import('./katalog/kategorien' satisfies string);`, [1]],
    [EDITOR_MAIN, `void import(<string>'./katalog/kategorien');`, [1]],
    // neither target, and text that only LOOKS like an import
    [EDITOR_MAIN, `import { DungeonSeite } from './DungeonKatalog';`, []],
    [EDITOR_MAIN, `import { x } from './katalogAnderes';`, []],
    [EDITOR_MAIN, `import { x } from '@wov/shared';`, []],
    [EDITOR_MAIN, `// import { KATEGORIEN } from './katalog/kategorien';`, []],
    [EDITOR_MAIN, `const s = "import { KATEGORIEN } from './katalog/kategorien';";`, []],
    [EDITOR_MAIN, `const path = './katalog/kategorien'; void import(path);`, []],
    [EDITOR_MAIN, `const m = import.meta.glob('./testflug/*.ts', { eager: true });`, []],
    [EDITOR_MAIN, `import { x } from './werkzeuge/a,katalog/b';`, []],
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

console.log('\n── [0b] The search for symbolic links can turn red (temporary folder) ──');
{
  const root = mkdtempSync(join(tmpdir(), 'katalog-module-grenze-'));
  try {
    mkdirSync(join(root, 'editor/katalog'), { recursive: true });
    writeFileSync(join(root, 'editor/katalog/kategorien.ts'), 'export const KATEGORIEN = [];\n');
    const probe = (name: string, expected: string): void => {
      const { links, entries } = scanLinks(root);
      const found = describeLinks(root, links);
      check(name, found === expected, `found: ${found || 'none'}, expected: ${expected || 'none'}, ${entries} entries`);
    };
    probe('folders and files without a link: nothing found', '');
    symlinkSync('editor/katalog', join(root, 'kk'));
    probe('a linked folder is found and not entered', 'kk -> editor/katalog');
    symlinkSync('katalog/kategorien.ts', join(root, 'editor/kat.ts'));
    probe('a linked file is found', 'editor/kat.ts -> katalog/kategorien.ts | kk -> editor/katalog');
    rmSync(join(root, 'kk'));
    rmSync(join(root, 'editor/kat.ts'));
    symlinkSync('..', join(root, 'editor/katalog/up'));
    symlinkSync('missing.ts', join(root, 'editor/katalog/lost.ts'));
    probe(
      'a link to an ancestor ends the walk, a link to nothing is found too',
      'editor/katalog/lost.ts -> missing.ts | editor/katalog/up -> ..',
    );
  } catch (error) {
    check('the temporary folder with links could be built', false, error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(root, { recursive: true, force: true });
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
  for (const name of IMPORTED_BY_CLASS) {
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
  // kontext.ts holds only a type: nobody imports it as a value, and the type imports come from the modules with a context.
  const ofKontext = references.filter(
    (r) => r.target === 'katalog' && resolveSpecifier(r.file, r.specifier)?.replace(SOURCE_EXT, '') === resolve(KATALOG_DIR, 'kontext'),
  );
  check(
    'katalog/kontext.ts is imported only as a type, and only by katalog/pruefen.ts and katalog/infofeld.ts (once each)',
    ofKontext.length === 2 && ofKontext.every((r) => r.typeOnly) && ofKontext.map((r) => r.file).sort().join(',') === [INFOFELD_TS, PRUEFEN_TS].sort().join(','),
    list(ofKontext),
  );
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
  check('GegenstandsKatalog.ts is loaded dynamically somewhere', dynamic.length > 0, list(dynamic));
  const found = violations.filter((v) => v.rule === 2);
  check(
    'no static value import of GegenstandsKatalog.ts',
    found.length === 0,
    found.length
      ? found.map(describe).join(' | ')
      : `${ofClass.length} references: ${ofClass.filter((r) => r.typeOnly).length} type-only, ${dynamic.length} dynamic`,
  );
}

console.log('\n── [2b] Every import() of GegenstandsKatalog.ts stands in the body of a function ──');
{
  const calls = references.filter(
    (r) => r.target === 'GegenstandsKatalog' && r.form === 'import()' && !isInside(KATALOG_DIR, r.file),
  );
  // Witness against an empty rule: there is such a call, and it stands in the body of a function.
  const inBody = calls.filter((r) => r.inFunctionBody);
  check('GegenstandsKatalog.ts is loaded with import() from the body of a function', inBody.length > 0, list(inBody));
  const found = violations.filter((v) => v.rule === '2b');
  check(
    'no import() of GegenstandsKatalog.ts at module level',
    found.length === 0,
    found.length ? found.map(describe).join(' | ') : `${calls.length} import() calls, ${inBody.length} in a function body`,
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
  // Step G2: the context type in kontext.ts is the one place under katalog/ that names the class, as a type.
  const underKatalog = references.filter((r) => r.target === 'GegenstandsKatalog' && isInside(KATALOG_DIR, r.file));
  const fromKontext = underKatalog.filter((r) => r.file === KONTEXT_TS);
  check(
    "katalog/kontext.ts names GegenstandsKatalog.ts as a type (import type … from '../GegenstandsKatalog'), at least once",
    fromKontext.length > 0 && fromKontext.every((r) => r.typeOnly && r.form === 'import'),
    list(fromKontext),
  );
  check(
    'no other file under katalog/ names GegenstandsKatalog.ts at all, not even as a type (pruefen.ts sees the class only through the context type)',
    underKatalog.length === fromKontext.length,
    list(underKatalog.filter((r) => r.file !== KONTEXT_TS)),
  );
}

// ── [4] Behaviour ──────────────────────────────────────────────────────

console.log('\n── [4] Behaviour of the moved functions and of the derived lists ──');
/** Loads a module of `katalog/`; a missing module is a failed check, not a crash without a count. */
async function load<T>(name: string, loader: () => Promise<T>): Promise<T | null> {
  try {
    const loaded = await loader();
    check(`katalog/${name}.ts loads without a browser`, true);
    return loaded;
  } catch (error) {
    check(`katalog/${name}.ts loads without a browser`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
    return null;
  }
}

const format = await load('format', () => import('../src/editor/katalog/format'));
if (format) {
  const { fmt, fmtBytes, kollisionsartText, vorschlagText, zahlLocale } = format;
  const same = (name: string, actual: string, expected: string): void =>
    check(`${name} = '${expected}'`, actual === expected, `got '${actual}'`);
  // Values right at a rounding step (9.999, 99.95, 1048575 bytes) are left out on purpose: what the
  // functions print there is an accident of the implementation, not a promise.
  same('fmt(12.412345678)', fmt(12.412345678), '12,4');
  same('fmt(NaN)', fmt(NaN), '—');
  same('fmt(Infinity)', fmt(Infinity), '—');
  same('fmt(0.5)', fmt(0.5), '0,50');
  same('fmt(10)', fmt(10), '10,0');
  same('fmt(100)', fmt(100), '100');
  same('fmt(-3.14159)', fmt(-3.14159), '-3,14');
  same('fmtBytes(20560)', fmtBytes(20560), '20 kB');
  same('fmtBytes(-1)', fmtBytes(-1), '—');
  same('fmtBytes(NaN)', fmtBytes(NaN), '—');
  same('fmtBytes(0)', fmtBytes(0), '0 B');
  same('fmtBytes(1023)', fmtBytes(1023), '1023 B');
  same('fmtBytes(1024)', fmtBytes(1024), '1 kB');
  same('fmtBytes(1048576)', fmtBytes(1048576), '1,0 MB');
  same('fmtBytes(17825792)', fmtBytes(17825792), '17,0 MB');
  // Without a browser there is neither `?lang` nor a stored choice: the language is the default, `de`.
  same('zahlLocale()', zahlLocale(), 'de-DE');
  same(`kollisionsartText('fest')`, kollisionsartText('fest'), t('editor.upload.kollision.fest'));
  same(
    `kollisionsartText('durchlaessig')`,
    kollisionsartText('durchlaessig'),
    t('editor.upload.kollision.durchlaessig'),
  );
  same(
    'vorschlagText(rohgroesse, 1.5 m)',
    vorschlagText({ quelle: 'rohgroesse', meter: 1.5 }),
    t('editor.upload.vorschlag.rohgroesse', { name: '', meter: '1.50' }),
  );
  same(
    'vorschlagText(kategorie, 2 m, Tisch)',
    vorschlagText({ quelle: 'kategorie', meter: 2, begruendungName: 'Tisch' }),
    t('editor.upload.vorschlag.kategorie', { name: 'Tisch', meter: '2.00' }),
  );
}

const kategorien = await load('kategorien', () => import('../src/editor/katalog/kategorien'));
if (kategorien) {
  const { ITEMS_NACH_NAME, KATEGORIEN } = kategorien;
  // `MIT_MODELL` has no export (nothing outside the module uses it): it is checked through `KATEGORIEN`.
  const withModel = PREFAB_DEFS.filter((d) => d.model !== null && isRenderable(d));
  const listing = KATEGORIEN.filter((k) => k.namen().join('|') === withModel.map((d) => d.name).join('|'));
  check(
    'exactly one entry lists MIT_MODELL: the same filter over PREFAB_DEFS gives the same names',
    listing.length === 1 && withModel.length > 0,
    `${withModel.length} of ${PREFAB_DEFS.length} prefabs`,
  );
  check(
    'its hint names the length of MIT_MODELL',
    listing.length === 1 && listing[0]!.hinweis.includes(String(withModel.length)),
    listing[0]?.hinweis ?? 'entry missing',
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
// Step G2: pruefen.ts pulls the engine (Babylon) through modelUrl and still loads in Node; kontext.ts is empty at run time.
const pruefen = await load('pruefen', () => import('../src/editor/katalog/pruefen'));
// Step G3: infofeld.ts pulls the drawing helpers (design.ts) and the registries and still loads in Node; it does nothing while loading.
const infofeld = await load('infofeld', () => import('../src/editor/katalog/infofeld'));
await load('kontext', () => import('../src/editor/katalog/kontext'));

// ── [5] Symbolic links ─────────────────────────────────────────────────

console.log('\n── [5] No symbolic link under client/src ──');
check(
  'no symbolic link under client/src',
  linkScan.entries > 0 && linkScan.links.length === 0,
  linkScan.links.length ? describeLinks(CLIENT_ROOT, linkScan.links) : `${linkScan.entries} entries looked at`,
);

// ── [6] Step G2: pruefen.ts and kontext.ts declare only, and import only what is listed ──

interface ImportSeen {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly typeOnly: boolean;
}

/** Every `import … from` and `export … from` of a source text, with its names, as the syntax tree has them. */
function importsOfText(file: string, text: string): ImportSeen[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: ImportSeen[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const names: string[] = [];
      if (clause?.name) names.push('default');
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push('*');
        else names.push(...clause.namedBindings.elements.map((e) => e.getText(sourceFile)));
      }
      out.push({ specifier: statement.moduleSpecifier.text, names, typeOnly: clause?.isTypeOnly === true });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names = statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.map((e) => e.getText(sourceFile)) : ['*'];
      out.push({ specifier: statement.moduleSpecifier.text, names, typeOnly: statement.isTypeOnly });
    }
  }
  return out;
}

/** Every `import … from` and `export … from` of a file. */
function importsOf(file: string): ImportSeen[] {
  return importsOfText(file, readFileSync(file, 'utf-8'));
}

const describeImports = (imports: readonly ImportSeen[]): string =>
  imports.map((i) => `${i.typeOnly ? 'type ' : ''}${i.specifier} {${i.names.join(', ')}}`).join(' | ') || 'none';

/**
 * Whether a module only declares: imports with names, type aliases, function declarations (at most `async`, no
 * `export` in front) and one export list at the end. Anything else runs when the module loads.
 */
function declarationsOnly(file: string): {
  readonly offenders: readonly string[];
  readonly functions: readonly string[];
  readonly asyncFunctions: readonly string[];
  readonly exportLists: number;
} {
  const sourceFile = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const functions: string[] = [];
  const asyncFunctions: string[] = [];
  let exportLists = 0;
  const at = (node: ts.Node): string => `line ${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (!statement.importClause || statement.importClause.name || !bindings || !ts.isNamedImports(bindings)) {
        offenders.push(`${at(statement)}: an import without names (it runs for its effect)`);
      }
    } else if (ts.isTypeAliasDeclaration(statement)) {
      // a type: nothing at run time
    } else if (ts.isFunctionDeclaration(statement)) {
      const kinds = (ts.getModifiers(statement) ?? []).map((m) => m.kind);
      if (!statement.name || !statement.body || kinds.some((k) => k !== ts.SyntaxKind.AsyncKeyword)) {
        offenders.push(`${at(statement)}: a function with a modifier other than async, or without a body`);
      } else {
        functions.push(statement.name.text);
        if (kinds.includes(ts.SyntaxKind.AsyncKeyword)) asyncFunctions.push(statement.name.text);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      exportLists++;
    } else {
      offenders.push(`${at(statement)}: ${ts.SyntaxKind[statement.kind]}`);
    }
  }
  return { offenders, functions, asyncFunctions, exportLists };
}

/**
 * Value imports of `pruefen.ts`, exactly. It is the one module under `katalog/` that reaches beyond the registries:
 * `modelUrl` from the engine and `PREFABS_BY_NAME` from `@wov/shared`, because the moved methods used them inside the
 * class. That evaluates nothing earlier than before: rule 1 lets only `GegenstandsKatalog.ts` load `pruefen.ts`, and
 * the class imported `../engine/AssetManager` and `@wov/shared` before the step. The list is exact so that one more
 * import needs a decision here, and no other module under `katalog/` may import from `engine/` at all.
 */
const PRUEFEN_VALUE_IMPORTS: ReadonlyArray<readonly [specifier: string, names: readonly string[]]> = [
  ['@wov/shared', ['PREFABS_BY_NAME']],
  ['../../engine/AssetManager', ['modelUrl']],
  ['../StoreKatalogDaten', ['SPEICHER_WURZEL']],
  ['./konstanten', ['PRUEF_PARALLEL']],
];

/**
 * The modules with a context (rule form k, steps G2 and G3): the former methods of the class with their parameters in
 * order, the members of the context, and what the module is. The forwarders in the class never carry `async` (rule 4.4);
 * `async` stays on the functions of the module that were `async` methods.
 */
interface ForwardedModule {
  /** File name under `katalog/`, for the messages. */
  readonly label: string;
  readonly file: string;
  /** How `GegenstandsKatalog.ts` names the module. */
  readonly specifier: string;
  /** The former methods, in the order of the class. `keepsPrivate`: the method is not in the context, so `private` stays. */
  readonly former: ReadonlyArray<{ readonly name: string; readonly params: readonly string[]; readonly keepsPrivate: boolean }>;
  /** What the functions use of the class through their first parameter: three fields, one accessor, four methods (G2); seven fields and four methods (G3). */
  readonly context: readonly string[];
  readonly aliasName: string;
  /** Name of the first parameter of every function: `k`, and `kat` where `k` is a loop variable in the bodies. */
  readonly contextParam: string;
  /** Whether the functions of the module are `async`. */
  readonly async: boolean;
}
const PRUEFEN_MODULE: ForwardedModule = {
  label: 'pruefen.ts',
  file: PRUEFEN_TS,
  specifier: './katalog/pruefen',
  former: [
    { name: 'pruefeSeite', params: [], keepsPrivate: true },
    { name: 'pruefeSpeicherSeite', params: ['ids'], keepsPrivate: false },
  ],
  context: ['vorhanden', 'pruefKnopf', 'storeIndex', 'seitenNamen', 'speicherArt', 'pruefeSpeicherSeite', 'statusSetzen', 'listeFuellen'],
  aliasName: 'PruefKontext',
  contextParam: 'k',
  async: true,
};
const INFOFELD_MODULE: ForwardedModule = {
  label: 'infofeld.ts',
  file: INFOFELD_TS,
  specifier: './katalog/infofeld',
  former: [
    { name: 'infoSchreiben', params: ['name', 'def', 'masse', 'warnung'], keepsPrivate: true },
    { name: 'speicherInfoSchreiben', params: ['eintrag', 'warnung'], keepsPrivate: true },
  ],
  context: [
    'infoBlock',
    'aufPlatzieren',
    'rasterSchritt',
    'schliesse',
    'hochgeladenesModellEntfernen',
    'grundskalaZeileBauen',
    'letzteMasse',
    'storeContainer',
    'bildMasse',
    'tonSpieler',
    'statusSetzen',
  ],
  aliasName: 'InfofeldKontext',
  contextParam: 'kat',
  async: false,
};
const FORWARDED_MODULES: readonly ForwardedModule[] = [PRUEFEN_MODULE, INFOFELD_MODULE];
/** The methods steps G2 and G3 turned into functions with a context. */
const FORMER_METHODS = FORWARDED_MODULES.flatMap((m) => m.former);
/**
 * The head of every forwarder up to the `{`, exactly (K9 (1)): it catches a decorator, a lost `private`, a changed default
 * value and changed types on a forwarder. The forwarders are the surface the rest of the code sees.
 */
const FORWARDER_HEADS: Readonly<Record<string, string>> = {
  pruefeSeite: 'private pruefeSeite(): Promise<void>',
  pruefeSpeicherSeite: 'pruefeSpeicherSeite(ids: readonly string[]): Promise<void>',
  infoSchreiben:
    'private infoSchreiben(\n    name: string,\n    def: PrefabDef | null,\n    masse: Kennzahlen | null,\n    warnung: string | null\n  ): void',
  speicherInfoSchreiben: 'private speicherInfoSchreiben(eintrag: StoreEintrag, warnung: string | null): void',
};
/**
 * The members of `GegenstandsKatalog` that are not `private` or `protected`, as fixed after step G3 (K9 (3)). Every
 * loosening widens the public surface of the class for good, so a new entry needs a decision here.
 */
const PUBLIC_MEMBERS: readonly string[] = [
  'infoBlock',
  'pruefKnopf',
  'tonSpieler',
  'storeIndex',
  'storeContainer',
  'bildMasse',
  'vorhanden',
  'aufPlatzieren',
  'Constructor',
  'istOffen',
  'umschalten',
  'oeffne',
  'schliesse',
  'letzteMasse',
  'rasterSchritt',
  'hochgeladenesModellEntfernen',
  'grundskalaZeileBauen',
  'speicherArt',
  'seitenNamen',
  'listeFuellen',
  'statusSetzen',
  'pruefeSpeicherSeite',
];

/**
 * Value imports of `infofeld.ts`, exactly (step G3): the registries and the drawing helpers the two moved methods used
 * inside the class. Rule 1 lets only `GegenstandsKatalog.ts` load `infofeld.ts`, and the class imported every one of
 * these modules before the step, so nothing is evaluated earlier than before. The list is exact so that one more import
 * needs a decision here. Type imports are listed too: they must be `import type`, never `import { type X }`.
 */
const INFOFELD_VALUE_IMPORTS: ReadonlyArray<readonly [specifier: string, names: readonly string[]]> = [
  ['@wov/shared', ['istEigenesModell', 'uploadedModelRegistry']],
  ['../design', ['F', 'M', 'PFAD', 'SCHRIFT', 'beschriftungStil', 'el', 'knopf', 'luecke', 'stil']],
  ['./format', ['fmt', 'fmtBytes']],
  ['./kategorien', ['ITEMS_NACH_NAME', 'ITEM_TYP_TEXT']],
];
const INFOFELD_TYPE_IMPORTS: ReadonlyArray<readonly [specifier: string, names: readonly string[]]> = [
  ['@wov/shared', ['PrefabDef']],
  ['../StoreKatalogDaten', ['StoreEintrag']],
  ['./konstanten', ['Kennzahlen']],
  ['./kontext', ['KatalogKontext']],
];
const listedImports = (list: ReadonlyArray<readonly [specifier: string, names: readonly string[]]>, typeOnly: boolean): string =>
  list.map(([specifier, names]) => `${typeOnly ? 'type ' : ''}${specifier} {${names.join(', ')}}`).join(' | ');

/**
 * The value-import edges `<stem> -> <stem>` of one file among the modules under `katalog/`. Both ends of an edge are the
 * stem of the file (path without extension): the importer as well as the target, so that the walk finds the target's own
 * edges again. `import { type X }` is a value import here (step G3, K9 (4)): only the declaration form `import type` is not.
 */
function katalogEdges(file: string, imports: readonly ImportSeen[]): string[] {
  const stemOf = (path: string): string => rel(path.replace(SOURCE_EXT, ''));
  const out: string[] = [];
  for (const i of imports) {
    if (i.typeOnly) continue;
    const target = resolveSpecifier(file, i.specifier)?.replace(SOURCE_EXT, '');
    if (target && isInside(KATALOG_DIR, target)) out.push(`${stemOf(file)} -> ${stemOf(target)}`);
  }
  return out;
}

/** The nodes at which a depth-first walk over the edges meets a node it is still visiting: they lie on a cycle. */
function cycleNodes(edges: readonly string[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = edge.split(' -> ') as [string, string];
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  }
  const onCycle: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): void => {
    if (done.has(node)) return;
    if (visiting.has(node)) {
      onCycle.push(node);
      return;
    }
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) visit(next);
    visiting.delete(node);
    done.add(node);
  };
  for (const node of adjacency.keys()) visit(node);
  return onCycle;
}

console.log('\n── [6] Steps G2 and G3: pruefen.ts, infofeld.ts and kontext.ts declare only, and import only what is listed ──');
{
  const pruefenShape = existsSync(PRUEFEN_TS) ? declarationsOnly(PRUEFEN_TS) : null;
  const infofeldShape = existsSync(INFOFELD_TS) ? declarationsOnly(INFOFELD_TS) : null;
  const kontextShape = existsSync(KONTEXT_TS) ? declarationsOnly(KONTEXT_TS) : null;
  check(
    'pruefen.ts holds only imports with names, type aliases, function declarations (at most async) and one export list',
    pruefenShape !== null && pruefenShape.offenders.length === 0 && pruefenShape.exportLists === 1,
    pruefenShape ? pruefenShape.offenders.join(' | ') || `${pruefenShape.functions.length} functions, ${pruefenShape.exportLists} export list` : 'file missing',
  );
  check(
    'infofeld.ts holds only imports with names, type aliases, function declarations (none async: the two methods were not) and one export list',
    infofeldShape !== null &&
      infofeldShape.offenders.length === 0 &&
      infofeldShape.exportLists === 1 &&
      infofeldShape.functions.join(',') === INFOFELD_MODULE.former.map((m) => m.name).join(',') &&
      infofeldShape.asyncFunctions.length === 0,
    infofeldShape
      ? infofeldShape.offenders.join(' | ') || `${infofeldShape.functions.length} functions (${infofeldShape.asyncFunctions.length} async), ${infofeldShape.exportLists} export list`
      : 'file missing',
  );
  check(
    'kontext.ts holds only imports with names and type aliases: no function, no export list, nothing else',
    kontextShape !== null && kontextShape.offenders.length === 0 && kontextShape.functions.length === 0 && kontextShape.exportLists === 0,
    kontextShape ? kontextShape.offenders.join(' | ') || 'declarations only' : 'file missing',
  );
  const pruefenImports = existsSync(PRUEFEN_TS) ? importsOf(PRUEFEN_TS) : [];
  check(
    'pruefen.ts: value imports are exactly PREFABS_BY_NAME (@wov/shared), modelUrl (../../engine/AssetManager), SPEICHER_WURZEL (../StoreKatalogDaten), PRUEF_PARALLEL (./konstanten), in this order',
    describeImports(pruefenImports.filter((i) => !i.typeOnly)) === PRUEFEN_VALUE_IMPORTS.map(([s, n]) => `${s} {${n.join(', ')}}`).join(' | '),
    describeImports(pruefenImports),
  );
  check(
    "pruefen.ts: the only type import is `import type { KatalogKontext } from './kontext'`",
    describeImports(pruefenImports.filter((i) => i.typeOnly)) === 'type ./kontext {KatalogKontext}',
    describeImports(pruefenImports.filter((i) => i.typeOnly)),
  );
  const infofeldImports = existsSync(INFOFELD_TS) ? importsOf(INFOFELD_TS) : [];
  check(
    'infofeld.ts: value imports are exactly istEigenesModell and uploadedModelRegistry (@wov/shared), the nine helpers of ../design, fmt and fmtBytes (./format), ITEMS_NACH_NAME and ITEM_TYP_TEXT (./kategorien), in this order',
    describeImports(infofeldImports.filter((i) => !i.typeOnly)) === listedImports(INFOFELD_VALUE_IMPORTS, false),
    describeImports(infofeldImports),
  );
  check(
    'infofeld.ts: the type imports are exactly `import type` of PrefabDef (@wov/shared), StoreEintrag (../StoreKatalogDaten), Kennzahlen (./konstanten) and KatalogKontext (./kontext), in this order',
    describeImports(infofeldImports.filter((i) => i.typeOnly)) === listedImports(INFOFELD_TYPE_IMPORTS, true),
    describeImports(infofeldImports.filter((i) => i.typeOnly)),
  );
  const kontextImports = existsSync(KONTEXT_TS) ? importsOf(KONTEXT_TS) : [];
  check(
    "kontext.ts: the one import is `import type { GegenstandsKatalog } from '../GegenstandsKatalog'`",
    describeImports(kontextImports) === 'type ../GegenstandsKatalog {GegenstandsKatalog}',
    describeImports(kontextImports),
  );
  // Step G3, K9 (4): the reading itself can turn red. `import { type X }` is a value import for the lists above and for the
  // cycle search below (whether the statement survives the build depends on compiler options), `import type` is not.
  {
    const inline = importsOfText('probe.ts', "import { type KatalogKontext } from './kontext';");
    const declaration = importsOfText('probe.ts', "import type { KatalogKontext } from './kontext';");
    check(
      'an inline `import { type X }` is read as a value import (names carry the word type), the declaration `import type` as a type import',
      inline.length === 1 && !inline[0]!.typeOnly && inline[0]!.names.join(',') === 'type KatalogKontext' && declaration.length === 1 && declaration[0]!.typeOnly && declaration[0]!.names.join(',') === 'KatalogKontext',
      `${describeImports(inline)} / ${describeImports(declaration)}`,
    );
  }
  // the engine boundary of the folder, and the cycle check among its modules
  const edges: string[] = [];
  for (const file of katalogFiles) {
    const intoEngine = importsOf(file).filter((i) => {
      const target = resolveSpecifier(file, i.specifier);
      return target !== null && isInside(ENGINE_DIR, target);
    });
    const expected = file === PRUEFEN_TS ? '../../engine/AssetManager {modelUrl}' : 'none';
    check(
      `${rel(file)}: imports from client/src/engine/ are ${expected === 'none' ? 'none' : `exactly ${expected}`}`,
      describeImports(intoEngine) === expected,
      describeImports(intoEngine),
    );
    edges.push(...katalogEdges(file, importsOf(file)));
  }
  // The search can turn red (step G2, finding G2-A1): the SAME two functions that read the real modules read synthetic
  // modules under katalog/ (source text in, edges and cycle out), so a broken edge or a broken walk shows here.
  {
    const at = (name: string): string => resolve(KATALOG_DIR, `kreis-${name}.ts`);
    const edgesOf = (modules: ReadonlyArray<readonly [name: string, source: string]>): string[] =>
      modules.flatMap(([name, source]) => katalogEdges(at(name), importsOfText(at(name), source)));
    const cycle = edgesOf([
      ['a', "import { x } from './kreis-b';"],
      ['b', "import { x } from './kreis-c.ts';"],
      ['c', "import { x } from './kreis-a';"],
      ['d', "import { x } from './kreis-a';"],
    ]);
    const found = [...new Set(cycleNodes(cycle))];
    check(
      'the cycle search finds a synthetic cycle a -> b -> c -> a (with a module that only leads into it), through the functions that read the real modules',
      found.length > 0 && cycle.length === 4,
      `${cycle.length} edges: ${cycle.join(' | ')}; on a cycle: ${found.join(', ') || 'nothing'}`,
    );
    const chain = edgesOf([
      ['a', "import { x } from './kreis-b';"],
      ['b', "import { x } from './kreis-c';"],
      ['c', 'export const x = 1;'],
    ]);
    check('the same search finds no cycle in a chain a -> b -> c', chain.length === 2 && cycleNodes(chain).length === 0, `${chain.length} edges`);
    const viaType = edgesOf([
      ['a', "import type { x } from './kreis-b';"],
      ['b', "import { x } from './kreis-a';"],
    ]);
    check('a cycle that closes only through `import type` is no cycle: the edge of the type import is not counted', viaType.length === 1 && cycleNodes(viaType).length === 0, `${viaType.length} edges`);
    const viaInline = edgesOf([
      ['a', "import { type x } from './kreis-b';"],
      ['b', "import { x } from './kreis-a';"],
    ]);
    check('a cycle that closes through `import { type x }` is one (K9 (4)): the inline modifier counts as a value edge', viaInline.length === 2 && cycleNodes(viaInline).length > 0, `${viaInline.length} edges`);
  }
  const onCycle = cycleNodes(edges);
  check(
    'no import cycle among the modules under katalog/ (value imports)',
    edges.length > 0 && onCycle.length === 0,
    onCycle.length ? `on a cycle: ${[...new Set(onCycle)].join(', ')}` : `${edges.length} edges: ${edges.join(' | ')}`,
  );
}

// ── [7] Steps G2 and G3: the moved methods are forwarders, the context names what is used ──

const sortedList = (names: Iterable<string>): string => [...names].sort().join(', ');

console.log('\n── [7] Steps G2 and G3: the moved methods are forwarders, the context names what is used ──');
const classSource = ts.createSourceFile(GEGENSTANDS_KATALOG, readFileSync(GEGENSTANDS_KATALOG, 'utf-8'), ts.ScriptTarget.Latest, true);
const classNode = classSource.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'GegenstandsKatalog');
check('GegenstandsKatalog.ts declares the class GegenstandsKatalog', classNode !== undefined);
const membersNamed = (name: string): ts.ClassElement[] =>
  classNode ? classNode.members.filter((m) => m.name !== undefined && ts.isIdentifier(m.name) && m.name.text === name) : [];
const modifierKinds = (node: ts.Node): ts.SyntaxKind[] => (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).map((m) => m.kind) : []);
const kindNames = (kinds: readonly ts.SyntaxKind[]): string => kinds.map((k) => ts.SyntaxKind[k]).join(' ') || 'no modifiers';
// at run time: the prototype of the class
type Callable = (...args: unknown[]) => unknown;
let klasse: { readonly prototype: object } | null = null;
try {
  const loaded = (await import('../src/editor/GegenstandsKatalog')) as { GegenstandsKatalog: unknown };
  klasse = loaded.GegenstandsKatalog as { readonly prototype: object };
  check('GegenstandsKatalog.ts loads without a browser (Node, no DOM)', typeof klasse.prototype === 'object');
} catch (error) {
  check('GegenstandsKatalog.ts loads without a browser (Node, no DOM)', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
}

check(
  'every former method has exactly one fixed head in this test, and the test fixes no head of a method that is not a former one',
  FORMER_METHODS.every((m) => FORWARDER_HEADS[m.name] !== undefined) && Object.keys(FORWARDER_HEADS).length === FORMER_METHODS.length,
  `${FORMER_METHODS.length} former methods, ${Object.keys(FORWARDER_HEADS).length} heads`,
);

for (const module of FORWARDED_MODULES) {
  const { label, former, context, aliasName, contextParam } = module;
  const count = context.length;
  console.log(`\n── [7] ${label} ──`);
  {
    const imports = classSource.statements.filter(
      (s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === module.specifier,
    );
    const names = imports.flatMap((d) =>
      d.importClause?.namedBindings && ts.isNamedImports(d.importClause.namedBindings) ? d.importClause.namedBindings.elements.map((e) => e.getText(classSource)) : [],
    );
    check(
      `GegenstandsKatalog.ts imports the forwarded functions under their own names, as values, from '${module.specifier}'`,
      imports.length === 1 && imports[0]!.importClause?.isTypeOnly !== true && names.join(',') === former.map((m) => m.name).join(','),
      names.join(', ') || 'no such import',
    );
  }
  for (const { name, params, keepsPrivate } of former) {
    const members = membersNamed(name);
    const member = members[0];
    check(`${name}: exactly one member of the class, a method`, members.length === 1 && member !== undefined && ts.isMethodDeclaration(member), members.map((m) => ts.SyntaxKind[m.kind]).join(', ') || 'missing');
    if (member === undefined || !ts.isMethodDeclaration(member)) continue;
    const kinds = modifierKinds(member);
    check(
      `${name}: no async on the forwarder, ${keepsPrivate ? 'private kept' : 'private removed (the context names it)'}`,
      !kinds.includes(ts.SyntaxKind.AsyncKeyword) && kinds.includes(ts.SyntaxKind.PrivateKeyword) === keepsPrivate,
      kindNames(kinds),
    );
    const parameters = member.parameters.map((p) => p.name.getText(classSource));
    check(`${name}: the parameters are (${params.join(', ')})`, parameters.join(',') === params.join(','), `(${parameters.join(', ')})`);
    // K9 (1): the head up to the `{`, exactly: decorator, modifiers, name, parameters with types and defaults, return type
    const head = member.body ? classSource.text.slice(member.getStart(classSource), member.body.getStart(classSource)).trimEnd() : 'no body';
    check(`${name}: the head of the forwarder up to the { is exactly the text fixed in this test (no decorator, no default, no changed type)`, head === FORWARDER_HEADS[name], JSON.stringify(head));
    const statements = member.body?.statements ?? [];
    const only = statements[0];
    const call = only !== undefined && ts.isReturnStatement(only) && only.expression !== undefined && ts.isCallExpression(only.expression) ? only.expression : undefined;
    const args = call ? call.arguments.map((a) => a.getText(classSource)) : [];
    check(
      `${name}: the body is the one statement return ${name}(this${params.map((p) => `, ${p}`).join('')})`,
      statements.length === 1 && call !== undefined && ts.isIdentifier(call.expression) && call.expression.text === name && args.join(',') === ['this', ...params].join(','),
      member.body ? member.body.getText(classSource).replace(/\s+/g, ' ').slice(0, 120) : 'no body',
    );
  }
  for (const name of context) {
    const members = membersNamed(name);
    const kinds = members.length === 1 ? modifierKinds(members[0]!) : [];
    check(
      `${name}: one member of the class, not private (the context type reaches only public members)`,
      members.length === 1 && !kinds.includes(ts.SyntaxKind.PrivateKeyword) && !kinds.includes(ts.SyntaxKind.ProtectedKeyword),
      members.length === 1 ? kindNames(kinds) : `${members.length} members`,
    );
  }
  {
    const source = existsSync(module.file) ? ts.createSourceFile(module.file, readFileSync(module.file, 'utf-8'), ts.ScriptTarget.Latest, true) : null;
    const alias = source?.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === aliasName);
    const literals: string[] = [];
    const collect = (node: ts.TypeNode): void => {
      if (ts.isUnionTypeNode(node)) node.types.forEach(collect);
      else if (ts.isParenthesizedTypeNode(node)) collect(node.type);
      else if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) literals.push(node.literal.text);
      else literals.push(`?${ts.SyntaxKind[node.kind]}`);
    };
    const argument =
      source && alias && ts.isTypeReferenceNode(alias.type) && alias.type.typeName.getText(source) === 'KatalogKontext' && alias.type.typeArguments?.length === 1
        ? alias.type.typeArguments[0]
        : undefined;
    if (argument) collect(argument);
    check(
      `${label}: type ${aliasName} = KatalogKontext<…> names exactly the ${count} members of the context`,
      argument !== undefined && sortedList(literals) === sortedList(context),
      argument ? sortedList(literals) : 'alias missing or not KatalogKontext<…>',
    );
    const functions = source?.statements.filter(ts.isFunctionDeclaration) ?? [];
    const used = new Set<string>();
    let handedOn = 0;
    let contextParameters = 0;
    for (const fn of functions) {
      const first = fn.parameters[0];
      if (source && first && ts.isIdentifier(first.name) && first.name.text === contextParam && first.type?.getText(source) === aliasName) contextParameters++;
      const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === contextParam && node !== first?.name) {
          if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) used.add(node.parent.name.text);
          else handedOn++;
        }
        ts.forEachChild(node, walk);
      };
      if (fn.body) walk(fn.body);
    }
    check(`${label}: all functions take ${contextParam}: ${aliasName} as their first parameter`, functions.length === former.length && contextParameters === former.length, `${functions.length} functions, ${contextParameters} with the context first`);
    check(
      `${label}: the functions use through ${contextParam} exactly the ${count} members of the context, and never hand ${contextParam} on as a whole`,
      sortedList(used) === sortedList(context) && handedOn === 0,
      `used: ${sortedList(used) || 'nothing'}; ${contextParam} handed on ${handedOn}×`,
    );
  }
  const exported = module === PRUEFEN_MODULE ? (pruefen as unknown as Record<string, unknown> | null) : (infofeld as unknown as Record<string, unknown> | null);
  check(
    `${label} exports exactly ${former.map((m) => m.name).join(' and ')}`,
    exported !== null && Object.keys(exported).sort().join(',') === former.map((m) => m.name).sort().join(','),
    exported ? Object.keys(exported).join(', ') || 'nothing' : 'not loaded',
  );
  for (const { name, params } of former) {
    const descriptor = klasse ? Object.getOwnPropertyDescriptor(klasse.prototype, name) : undefined;
    const method = descriptor?.value as Callable | undefined;
    check(
      `${name}: a method of the prototype, a plain function (not async), length ${params.length}, name kept`,
      typeof method === 'function' && method.constructor.name === 'Function' && method.length === params.length && method.name === name,
      method ? `${method.constructor.name}, length ${method.length}, name ${method.name}` : 'missing on the prototype',
    );
    const fn = exported ? (exported[name] as Callable | undefined) : undefined;
    const kind = module.async ? 'AsyncFunction' : 'Function';
    check(
      `${label}: ${name} is ${module.async ? 'an async' : 'a plain'} function of ${params.length + 1} parameters (the context first)`,
      typeof fn === 'function' && fn.constructor.name === kind && fn.length === params.length + 1,
      fn ? `${fn.constructor.name}, length ${fn.length}` : 'missing',
    );
  }
}
{
  const kontextSource = existsSync(KONTEXT_TS) ? ts.createSourceFile(KONTEXT_TS, readFileSync(KONTEXT_TS, 'utf-8'), ts.ScriptTarget.Latest, true) : null;
  const kontextAlias = kontextSource?.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'KatalogKontext');
  const kontextText = kontextSource && kontextAlias ? kontextAlias.getText(kontextSource).replace(/\s+/g, ' ') : 'missing';
  check(
    'kontext.ts: export type KatalogKontext<K extends keyof GegenstandsKatalog> = Pick<GegenstandsKatalog, K>',
    kontextText === 'export type KatalogKontext<K extends keyof GegenstandsKatalog> = Pick<GegenstandsKatalog, K>;',
    kontextText,
  );
}
// K9 (3): the public surface of the class, fixed
{
  const named = (m: ts.ClassElement): string => (m.name ? m.name.getText(classSource) : ts.SyntaxKind[m.kind]!.replace(/Declaration$/, ''));
  const now = classNode
    ? classNode.members.filter((m) => !modifierKinds(m).includes(ts.SyntaxKind.PrivateKeyword) && !modifierKinds(m).includes(ts.SyntaxKind.ProtectedKeyword) && !(m.name !== undefined && ts.isPrivateIdentifier(m.name))).map(named)
    : [];
  const extra = now.filter((n) => !PUBLIC_MEMBERS.includes(n));
  const missing = PUBLIC_MEMBERS.filter((n) => !now.includes(n));
  check(
    `the members of GegenstandsKatalog that are not private or protected are exactly the ${PUBLIC_MEMBERS.length} fixed in this test (a further loosening turns this red)`,
    extra.length === 0 && missing.length === 0 && now.length === PUBLIC_MEMBERS.length,
    `${now.length} members; extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}`,
  );
}

// ── [8] Step G2: behaviour of pruefeSeite and pruefeSpeicherSeite, recorded ──
//
// The sequence between the markers is cut out and run on the old stand by the measuring script of the step
// (Berichte/Nachweise/Refactoring-G3/skripte/sollwerte.mts: on the methods of the class as they were before step G2), so
// the expected lines below come from the very same text. It uses nothing of this file: everything comes in through its
// two parameters.

// <pruef-sequence>
/** How the two functions are reached: as functions of the module (new stand), or as methods of the prototype (old). */
interface PruefCalls {
  pruefeSeite(k: object): Promise<void>;
  pruefeSpeicherSeite(k: object, ids: readonly string[]): Promise<void>;
}
/** What the sequence needs from the tree, handed in so that the same text runs on the old stand too. */
interface PruefDeps {
  modelUrl(datei: string): string;
  speicherWurzel: string;
  /** Names of prefabs with a model that differs from the name, at least 8, and the model file of each (finding G2-A3). */
  namesWithModel: readonly string[];
  nameWithoutModel: string;
  modelOf(name: string): string;
  /** Builds the context from the stub fields: a plain object, or one that has the prototype of the class. */
  makeContext(fields: PropertyDescriptorMap): object;
}
type AnswerKind = 'ok' | 'missing' | 'html' | 'network' | 'noType' | 'missingHtml';
/**
 * Runs a fixed sequence of calls against a stub of the context with `fetch` and `window` replaced, and records
 * every effect in its order. Names of the registry appear as labels (N0…N7, OHNE), so the expected lines do not
 * depend on which prefabs the registry holds.
 */
async function runPruefSequence(calls: PruefCalls, deps: PruefDeps): Promise<string[]> {
  const lines: string[] = [];
  let scene = '';
  let ticks = 0;
  const log = (text: string): void => {
    lines.push(`[${scene}] @${ticks} ${text}`);
  };
  const show = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : String(value));
  const labels = new Map<string, string>();
  const N = deps.namesWithModel.slice(0, 8);
  N.forEach((name, i) => {
    labels.set(name, `N${i}`);
    labels.set(deps.modelOf(name), `N${i}.glb`);
    labels.set(deps.modelUrl(deps.modelOf(name)), `url(N${i})`);
  });
  labels.set(deps.nameWithoutModel, 'OHNE');
  const label = (s: string): string => labels.get(s) ?? s.split(deps.speicherWurzel).join('<WURZEL>');
  let answers = new Map<string, AnswerKind>();
  let fetchNo = 0;
  const headers = (type: string | null): { get(name: string): string | null } => ({
    get: (name) => {
      log(`headers.get(${show(name)}) -> ${show(type)}`);
      return name.toLowerCase() === 'content-type' ? type : null;
    },
  });
  const fakeFetch = (url: unknown, init?: { method?: string }): Promise<unknown> => {
    const kind = answers.get(String(url)) ?? 'missing';
    log(`fetch#${++fetchNo} ${init?.method ?? 'GET'} ${label(String(url))} -> ${kind}`);
    if (kind === 'network') return Promise.reject(new TypeError('fetch failed (probe)'));
    const ok = kind === 'ok' || kind === 'html' || kind === 'noType';
    const type = kind === 'ok' ? 'model/gltf-binary' : kind === 'html' || kind === 'missingHtml' ? 'text/html; charset=utf-8' : kind === 'noType' ? null : 'text/plain';
    return Promise.resolve({ ok, status: ok ? 200 : 404, headers: headers(type) });
  };
  const timers: (() => void)[] = [];
  const fakeWindow = {
    setTimeout: (fn: () => void, ms: number): number => {
      log(`window.setTimeout(${ms})`);
      timers.push(fn);
      return timers.length;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const realFetch = g.fetch;
  const hadWindow = 'window' in g;
  const realWindow = g.window;
  g.fetch = fakeFetch;
  g.window = fakeWindow;
  const watched = new Set(['vorhanden', 'pruefKnopf', 'storeIndex', 'seitenNamen', 'speicherArt', 'pruefeSpeicherSeite', 'statusSetzen', 'listeFuellen']);
  const context = (page: readonly string[], storeKind: string | null, storeIndex: Map<string, { pfad: string }>, known: Map<string, boolean>): object => {
    const button = new Proxy({ disabled: false, textContent: 'Verfügbarkeit dieser Seite prüfen' } as Record<string, unknown>, {
      set(target, property, value) {
        log(`pruefKnopf.${String(property)} = ${show(value)}`);
        target[String(property)] = value;
        return true;
      },
    });
    const own = (value: unknown): PropertyDescriptor => ({ value, enumerable: true, writable: true, configurable: true });
    const fields: PropertyDescriptorMap = {
      vorhanden: own(known),
      storeIndex: own(storeIndex),
      pruefKnopf: own(button),
      seitenNamen: own((): string[] => {
        log(`seitenNamen() -> [${page.map(label).join(', ')}]`);
        return page.slice();
      }),
      speicherArt: {
        get: () => {
          log(`speicherArt -> ${show(storeKind)}`);
          return storeKind;
        },
        enumerable: true,
        configurable: true,
      },
      statusSetzen: own((text: string, art: string): void => {
        log(`statusSetzen(${show(text)}, ${show(art)})`);
      }),
      listeFuellen: own((): void => {
        log('listeFuellen()');
      }),
    };
    return new Proxy(deps.makeContext(fields), {
      get(target, property, receiver) {
        if (typeof property === 'string' && watched.has(property)) log(`k.${property} read`);
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        log(`k.${String(property)} WRITTEN`);
        return Reflect.set(target, property, value, receiver);
      },
    });
  };
  const run = async (name: string, known: Map<string, boolean>, body: () => unknown): Promise<void> => {
    scene = name;
    timers.length = 0;
    fetchNo = 0;
    // A chain of 40 microtasks started before the call: every line carries the number of ticks that have run, so an added
    // or dropped `await` in the code under test (one microtask step more or less) moves every line behind it (G2-A2).
    ticks = 0;
    let chain = Promise.resolve();
    for (let i = 0; i < 40; i++) chain = chain.then(() => void ticks++);
    let result: unknown;
    try {
      result = body();
    } catch (error) {
      log(`THROWN ${(error as Error).constructor.name}: ${(error as Error).message}`);
    }
    log(`returns ${result instanceof Promise ? 'a Promise' : show(result)}`);
    try {
      const value: unknown = await result;
      log(`resolved with ${show(value)}`);
    } catch (error) {
      log(`REJECTED ${(error as Error).constructor.name}: ${(error as Error).message}`);
    }
    await chain;
    timers.forEach((timer, i) => {
      log(`timer ${i + 1} fires`);
      timer();
    });
    log(`vorhanden at the end: {${[...known].map(([key, value]) => `${label(key)}: ${String(value)}`).join(', ')}}`);
  };
  const model = (i: number): string => deps.modelOf(N[i]!);
  const url = (i: number): string => deps.modelUrl(model(i));
  const store = (path: string): string => `${deps.speicherWurzel}${path}`;
  const KINDS: readonly AnswerKind[] = ['ok', 'missing', 'html', 'network', 'ok', 'missingHtml', 'noType'];
  try {
    {
      const known = new Map<string, boolean>([[model(0), true], [model(1), false]]);
      answers = new Map();
      await run('R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)', known, () => calls.pruefeSeite(context([N[0]!, N[1]!, deps.nameWithoutModel, 'Probe_UnknownName'], null, new Map(), known)));
    }
    {
      const known = new Map<string, boolean>();
      answers = new Map([[url(0), 'ok']]);
      await run('R1 registry page, 1 open (ok), 1 without model', known, () => calls.pruefeSeite(context([N[0]!, deps.nameWithoutModel], null, new Map(), known)));
    }
    {
      const known = new Map<string, boolean>();
      answers = new Map([[url(0), 'missing']]);
      await run('R1b registry page, 1 open (missing): nothing of the page is there', known, () => calls.pruefeSeite(context([N[0]!, deps.nameWithoutModel], null, new Map(), known)));
    }
    {
      const known = new Map<string, boolean>([[model(7), true]]);
      answers = new Map(KINDS.map((kind, i) => [url(i), kind]));
      await run(`R7 registry page, 7 open (${KINDS.join(', ')}), 1 known, 1 without model, 1 unknown name`, known, () => calls.pruefeSeite(context([...N, deps.nameWithoutModel, 'Probe_UnknownName'], null, new Map(), known)));
    }
    {
      const known = new Map<string, boolean>([[model(0), true], [model(1), false], [model(2), false], [model(4), true], [model(5), false], [model(6), true], [model(7), true]]);
      answers = new Map([[url(3), 'ok']]);
      await run('R7b the same page again: only the network error is still open, now ok', known, () => calls.pruefeSeite(context([...N], null, new Map(), known)));
    }
    {
      const index = new Map([['m/a', { pfad: 'modelle/a.glb' }], ['m/b', { pfad: 'modelle/b.glb' }], ['m/c', { pfad: 'modelle/c.glb' }], ['m/d', { pfad: 'modelle/d.glb' }]]);
      const known = new Map<string, boolean>([['modelle/d.glb', true]]);
      answers = new Map([[store('modelle/a.glb'), 'ok'], [store('modelle/b.glb'), 'missing'], [store('modelle/c.glb'), 'html']]);
      await run('S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known', known, () => calls.pruefeSeite(context(['m/a', 'm/b', 'm/c', 'm/d', 'm/unknown'], 'Modelle', index, known)));
    }
    {
      const index = new Map([['m/a', { pfad: 'modelle/a.glb' }]]);
      const known = new Map<string, boolean>([['modelle/a.glb', false]]);
      answers = new Map();
      await run('S0 store page, 0 open', known, () => calls.pruefeSeite(context(['m/a', 'm/unknown'], 'Toene', index, known)));
    }
    {
      const index = new Map(Array.from({ length: 9 }, (_, i) => [`t/${i}`, { pfad: `toene/${i}.ogg` }] as const));
      const known = new Map<string, boolean>();
      answers = new Map(Array.from({ length: 9 }, (_, i) => [store(`toene/${i}.ogg`), KINDS[i % KINDS.length]!] as const));
      const k = context([], 'Toene', index, known);
      await run('D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)', known, () => calls.pruefeSpeicherSeite(k, Array.from({ length: 9 }, (_, i) => `t/${i}`)));
      await run('D0 pruefeSpeicherSeite directly, no ids', known, () => calls.pruefeSpeicherSeite(k, []));
      const nothing = new Map<string, boolean>();
      answers = new Map([[store('toene/0.ogg'), 'missing'], [store('toene/1.ogg'), 'network']]);
      await run('D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there', nothing, () => calls.pruefeSpeicherSeite(context([], 'Toene', index, nothing), ['t/0', 't/1']));
    }
  } finally {
    g.fetch = realFetch;
    if (hadWindow) g.window = realWindow;
    else delete g.window;
  }
  return lines;
}
// </pruef-sequence>

/** Measured before step G2, on the methods of the class as they were then (report of step G3): the same text as above, run by the measuring script. */
const EXPECTED_SEQUENCE: readonly string[] = [
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 k.seitenNamen read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 seitenNamen() -> [N0, N1, OHNE, Probe_UnknownName]",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 k.speicherArt read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 speicherArt -> null",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 k.vorhanden read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 k.vorhanden read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 k.statusSetzen read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 statusSetzen(\"Seite bereits geprüft.\", \"neutral\")",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 window.setTimeout(2000)",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @0 returns a Promise",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @1 resolved with undefined",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @40 timer 1 fires",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @40 k.statusSetzen read",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @40 statusSetzen(\"\", \"neutral\")",
  "[R0 registry page, 0 open (2 known, 1 without model, 1 unknown name)] @40 vorhanden at the end: {N0.glb: true, N1.glb: false}",
  "[R1 registry page, 1 open (ok), 1 without model] @0 k.seitenNamen read",
  "[R1 registry page, 1 open (ok), 1 without model] @0 seitenNamen() -> [N0, OHNE]",
  "[R1 registry page, 1 open (ok), 1 without model] @0 k.speicherArt read",
  "[R1 registry page, 1 open (ok), 1 without model] @0 speicherArt -> null",
  "[R1 registry page, 1 open (ok), 1 without model] @0 k.vorhanden read",
  "[R1 registry page, 1 open (ok), 1 without model] @0 k.pruefKnopf read",
  "[R1 registry page, 1 open (ok), 1 without model] @0 pruefKnopf.disabled = true",
  "[R1 registry page, 1 open (ok), 1 without model] @0 k.pruefKnopf read",
  "[R1 registry page, 1 open (ok), 1 without model] @0 pruefKnopf.textContent = \"prüfe 1 Modelle …\"",
  "[R1 registry page, 1 open (ok), 1 without model] @0 fetch#1 HEAD url(N0) -> ok",
  "[R1 registry page, 1 open (ok), 1 without model] @0 returns a Promise",
  "[R1 registry page, 1 open (ok), 1 without model] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[R1 registry page, 1 open (ok), 1 without model] @1 k.vorhanden read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 k.pruefKnopf read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[R1 registry page, 1 open (ok), 1 without model] @3 k.pruefKnopf read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 pruefKnopf.disabled = false",
  "[R1 registry page, 1 open (ok), 1 without model] @3 k.listeFuellen read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 listeFuellen()",
  "[R1 registry page, 1 open (ok), 1 without model] @3 k.vorhanden read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 k.statusSetzen read",
  "[R1 registry page, 1 open (ok), 1 without model] @3 statusSetzen(\"1 von 2 Modellen dieser Seite liegen vor.\", \"da\")",
  "[R1 registry page, 1 open (ok), 1 without model] @4 resolved with undefined",
  "[R1 registry page, 1 open (ok), 1 without model] @40 vorhanden at the end: {N0.glb: true}",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 k.seitenNamen read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 seitenNamen() -> [N0, OHNE]",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 k.speicherArt read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 speicherArt -> null",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 k.vorhanden read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 k.pruefKnopf read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 pruefKnopf.disabled = true",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 k.pruefKnopf read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 pruefKnopf.textContent = \"prüfe 1 Modelle …\"",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 fetch#1 HEAD url(N0) -> missing",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @0 returns a Promise",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @1 headers.get(\"content-type\") -> \"text/plain\"",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @1 k.vorhanden read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 k.pruefKnopf read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 k.pruefKnopf read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 pruefKnopf.disabled = false",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 k.listeFuellen read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 listeFuellen()",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 k.vorhanden read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 k.statusSetzen read",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @3 statusSetzen(\"0 von 2 Modellen dieser Seite liegen vor.\", \"fehlt\")",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @4 resolved with undefined",
  "[R1b registry page, 1 open (missing): nothing of the page is there] @40 vorhanden at the end: {N0.glb: false}",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.seitenNamen read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 seitenNamen() -> [N0, N1, N2, N3, N4, N5, N6, N7, OHNE, Probe_UnknownName]",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.speicherArt read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 speicherArt -> null",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.pruefKnopf read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 pruefKnopf.disabled = true",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 k.pruefKnopf read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 pruefKnopf.textContent = \"prüfe 7 Modelle …\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#1 HEAD url(N0) -> ok",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#2 HEAD url(N1) -> missing",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#3 HEAD url(N2) -> html",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#4 HEAD url(N4) -> ok",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#5 HEAD url(N4) -> ok",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 fetch#6 HEAD url(N5) -> missingHtml",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @0 returns a Promise",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 fetch#7 HEAD url(N6) -> noType",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"text/plain\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"text/html; charset=utf-8\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 headers.get(\"content-type\") -> \"text/html; charset=utf-8\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @1 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @2 headers.get(\"content-type\") -> null",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @2 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.pruefKnopf read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.pruefKnopf read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 pruefKnopf.disabled = false",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.listeFuellen read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 listeFuellen()",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.vorhanden read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 k.statusSetzen read",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @4 statusSetzen(\"5 von 10 Modellen dieser Seite liegen vor.\", \"da\")",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @5 resolved with undefined",
  "[R7 registry page, 7 open (ok, missing, html, network, ok, missingHtml, noType), 1 known, 1 without model, 1 unknown name] @40 vorhanden at the end: {N7.glb: true, N0.glb: true, N1.glb: false, N2.glb: false, N4.glb: true, N5.glb: false, N6.glb: true}",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.seitenNamen read",
  "[R7b the same page again: only the network error is still open, now ok] @0 seitenNamen() -> [N0, N1, N2, N3, N4, N5, N6, N7]",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.speicherArt read",
  "[R7b the same page again: only the network error is still open, now ok] @0 speicherArt -> null",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.vorhanden read",
  "[R7b the same page again: only the network error is still open, now ok] @0 k.statusSetzen read",
  "[R7b the same page again: only the network error is still open, now ok] @0 statusSetzen(\"Seite bereits geprüft.\", \"neutral\")",
  "[R7b the same page again: only the network error is still open, now ok] @0 window.setTimeout(2000)",
  "[R7b the same page again: only the network error is still open, now ok] @0 returns a Promise",
  "[R7b the same page again: only the network error is still open, now ok] @1 resolved with undefined",
  "[R7b the same page again: only the network error is still open, now ok] @40 timer 1 fires",
  "[R7b the same page again: only the network error is still open, now ok] @40 k.statusSetzen read",
  "[R7b the same page again: only the network error is still open, now ok] @40 statusSetzen(\"\", \"neutral\")",
  "[R7b the same page again: only the network error is still open, now ok] @40 vorhanden at the end: {N0.glb: true, N1.glb: false, N2.glb: false, N4.glb: true, N5.glb: false, N6.glb: true, N7.glb: true}",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.seitenNamen read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 seitenNamen() -> [m/a, m/b, m/c, m/d, m/unknown]",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.speicherArt read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 speicherArt -> \"Modelle\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.pruefeSpeicherSeite read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.pruefKnopf read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 pruefKnopf.disabled = true",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 k.pruefKnopf read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 pruefKnopf.textContent = \"prüfe 3 Dateien …\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 fetch#1 HEAD <WURZEL>modelle/a.glb -> ok",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 fetch#2 HEAD <WURZEL>modelle/b.glb -> missing",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 fetch#3 HEAD <WURZEL>modelle/c.glb -> html",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @0 returns a Promise",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 headers.get(\"content-type\") -> \"text/plain\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 headers.get(\"content-type\") -> \"text/html; charset=utf-8\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @1 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.pruefKnopf read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.pruefKnopf read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 pruefKnopf.disabled = false",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.listeFuellen read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 listeFuellen()",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.vorhanden read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.storeIndex read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 k.statusSetzen read",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @3 statusSetzen(\"2 von 5 Dateien dieser Seite liegen vor.\", \"da\")",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @5 resolved with undefined",
  "[S store page through pruefeSeite: 3 open (ok, missing, html), 1 unknown id, 1 known] @40 vorhanden at the end: {modelle/d.glb: true, modelle/a.glb: true, modelle/b.glb: false, modelle/c.glb: false}",
  "[S0 store page, 0 open] @0 k.seitenNamen read",
  "[S0 store page, 0 open] @0 seitenNamen() -> [m/a, m/unknown]",
  "[S0 store page, 0 open] @0 k.speicherArt read",
  "[S0 store page, 0 open] @0 speicherArt -> \"Toene\"",
  "[S0 store page, 0 open] @0 k.pruefeSpeicherSeite read",
  "[S0 store page, 0 open] @0 k.storeIndex read",
  "[S0 store page, 0 open] @0 k.storeIndex read",
  "[S0 store page, 0 open] @0 k.vorhanden read",
  "[S0 store page, 0 open] @0 k.statusSetzen read",
  "[S0 store page, 0 open] @0 statusSetzen(\"Seite bereits geprüft.\", \"neutral\")",
  "[S0 store page, 0 open] @0 window.setTimeout(2000)",
  "[S0 store page, 0 open] @0 returns a Promise",
  "[S0 store page, 0 open] @2 resolved with undefined",
  "[S0 store page, 0 open] @40 timer 1 fires",
  "[S0 store page, 0 open] @40 k.statusSetzen read",
  "[S0 store page, 0 open] @40 statusSetzen(\"\", \"neutral\")",
  "[S0 store page, 0 open] @40 vorhanden at the end: {modelle/a.glb: false}",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.pruefKnopf read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 pruefKnopf.disabled = true",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 k.pruefKnopf read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 pruefKnopf.textContent = \"prüfe 9 Dateien …\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#1 HEAD <WURZEL>toene/0.ogg -> ok",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#2 HEAD <WURZEL>toene/1.ogg -> missing",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#3 HEAD <WURZEL>toene/2.ogg -> html",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#4 HEAD <WURZEL>toene/3.ogg -> network",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#5 HEAD <WURZEL>toene/4.ogg -> ok",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 fetch#6 HEAD <WURZEL>toene/5.ogg -> missingHtml",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @0 returns a Promise",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 fetch#7 HEAD <WURZEL>toene/6.ogg -> noType",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 headers.get(\"content-type\") -> \"text/plain\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 fetch#8 HEAD <WURZEL>toene/7.ogg -> ok",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 headers.get(\"content-type\") -> \"text/html; charset=utf-8\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 fetch#9 HEAD <WURZEL>toene/8.ogg -> missing",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 headers.get(\"content-type\") -> \"text/html; charset=utf-8\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @1 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 headers.get(\"content-type\") -> null",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 headers.get(\"content-type\") -> \"model/gltf-binary\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 headers.get(\"content-type\") -> \"text/plain\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @2 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.pruefKnopf read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.pruefKnopf read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 pruefKnopf.disabled = false",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.listeFuellen read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 listeFuellen()",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.storeIndex read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.vorhanden read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 k.statusSetzen read",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @4 statusSetzen(\"4 von 9 Dateien dieser Seite liegen vor.\", \"da\")",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @5 resolved with undefined",
  "[D9 pruefeSpeicherSeite directly, 9 ids (more than PRUEF_PARALLEL)] @40 vorhanden at the end: {toene/0.ogg: true, toene/1.ogg: false, toene/2.ogg: false, toene/4.ogg: true, toene/5.ogg: false, toene/6.ogg: true, toene/7.ogg: true, toene/8.ogg: false}",
  "[D0 pruefeSpeicherSeite directly, no ids] @0 k.statusSetzen read",
  "[D0 pruefeSpeicherSeite directly, no ids] @0 statusSetzen(\"Seite bereits geprüft.\", \"neutral\")",
  "[D0 pruefeSpeicherSeite directly, no ids] @0 window.setTimeout(2000)",
  "[D0 pruefeSpeicherSeite directly, no ids] @0 returns a Promise",
  "[D0 pruefeSpeicherSeite directly, no ids] @1 resolved with undefined",
  "[D0 pruefeSpeicherSeite directly, no ids] @40 timer 1 fires",
  "[D0 pruefeSpeicherSeite directly, no ids] @40 k.statusSetzen read",
  "[D0 pruefeSpeicherSeite directly, no ids] @40 statusSetzen(\"\", \"neutral\")",
  "[D0 pruefeSpeicherSeite directly, no ids] @40 vorhanden at the end: {toene/0.ogg: true, toene/1.ogg: false, toene/2.ogg: false, toene/4.ogg: true, toene/5.ogg: false, toene/6.ogg: true, toene/7.ogg: true, toene/8.ogg: false}",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.storeIndex read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.storeIndex read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.vorhanden read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.vorhanden read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.pruefKnopf read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 pruefKnopf.disabled = true",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 k.pruefKnopf read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 pruefKnopf.textContent = \"prüfe 2 Dateien …\"",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 fetch#1 HEAD <WURZEL>toene/0.ogg -> missing",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 fetch#2 HEAD <WURZEL>toene/1.ogg -> network",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @0 returns a Promise",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @1 headers.get(\"content-type\") -> \"text/plain\"",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @1 k.vorhanden read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.pruefKnopf read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 pruefKnopf.textContent = \"Verfügbarkeit dieser Seite prüfen\"",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.pruefKnopf read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 pruefKnopf.disabled = false",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.listeFuellen read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 listeFuellen()",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.storeIndex read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.vorhanden read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.storeIndex read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.vorhanden read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 k.statusSetzen read",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @3 statusSetzen(\"0 von 2 Dateien dieser Seite liegen vor.\", \"fehlt\")",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @4 resolved with undefined",
  "[D2 pruefeSpeicherSeite directly, 2 ids (missing, network): nothing is there] @40 vorhanden at the end: {toene/0.ogg: false}",
];

console.log('\n── [8] Step G2: behaviour of pruefeSeite and pruefeSpeicherSeite, recorded ──');
{
  const pruefenExports = pruefen ? (pruefen as unknown as Record<string, unknown>) : null;
  // The model differs from the name: a function that hands the name where the model file belongs shows in the requests (G2-A3).
  const namesWithModel = [...PREFABS_BY_NAME.entries()].filter(([n, d]) => d.model !== null && d.model !== n).map(([n]) => n).sort();
  const nameWithoutModel = [...PREFABS_BY_NAME.entries()].find(([, d]) => d.model === null)?.[0];
  check('the registry offers at least 8 prefabs with a model that differs from their name, and one without a model', namesWithModel.length >= 8 && nameWithoutModel !== undefined, `${namesWithModel.length} with a model`);
  const firstDifference = (got: readonly string[], expected: readonly string[]): string => {
    for (let i = 0; i < Math.max(got.length, expected.length); i++) {
      if (got[i] !== expected[i]) return `line ${i + 1}: got ${JSON.stringify(got[i])}, expected ${JSON.stringify(expected[i])}`;
    }
    return `${got.length} lines, equal`;
  };
  if (pruefenExports !== null && klasse !== null && namesWithModel.length >= 8 && nameWithoutModel !== undefined) {
    const fns = pruefenExports as unknown as PruefCalls;
    const deps = {
      modelUrl,
      speicherWurzel: SPEICHER_WURZEL,
      namesWithModel,
      nameWithoutModel,
      modelOf: (name: string): string => PREFABS_BY_NAME.get(name)?.model ?? '',
    };
    // (a) the functions of the module on a plain stub of the context
    const onStub = await runPruefSequence(fns, {
      ...deps,
      makeContext: (fields) =>
        Object.defineProperties(
          {
            pruefeSpeicherSeite(this: object, ids: readonly string[]): Promise<void> {
              return fns.pruefeSpeicherSeite(this, ids);
            },
          },
          fields,
        ),
    });
    // (b) the methods of the prototype, called on an object that has the prototype of the class: the inner call
    //     `k.pruefeSpeicherSeite(…)` reaches the forwarder on the prototype, not a stub. The methods are taken from the
    //     prototype and called with `this`, so that the property read of the dispatch itself is not recorded.
    const prototype = klasse.prototype as { pruefeSeite(this: object): Promise<void>; pruefeSpeicherSeite(this: object, ids: readonly string[]): Promise<void> };
    const viaForwarders = await runPruefSequence(
      {
        pruefeSeite: (k) => prototype.pruefeSeite.call(k),
        pruefeSpeicherSeite: (k, ids) => prototype.pruefeSpeicherSeite.call(k, ids),
      },
      { ...deps, makeContext: (fields) => Object.defineProperties(Object.create(prototype) as object, fields) },
    );
    check(`the functions on a stub give the ${EXPECTED_SEQUENCE.length} lines measured before the move`, onStub.join('\n') === EXPECTED_SEQUENCE.join('\n'), firstDifference(onStub, EXPECTED_SEQUENCE));
    check('the methods of the prototype on an object with the prototype of the class (the inner call reaches the forwarder): the same lines', viaForwarders.join('\n') === EXPECTED_SEQUENCE.join('\n'), firstDifference(viaForwarders, EXPECTED_SEQUENCE));
  } else {
    check('behaviour: the module, the class and the registry are available', false, 'see above');
  }
}


// ── [9] Step G3: behaviour of infoSchreiben and speicherInfoSchreiben, recorded ──
//
// The sequence between the markers is cut out and run on the old stand by the measuring script of the step
// (Berichte/Nachweise/Refactoring-G3/skripte/sollwerte-infofeld.mts), so the expected values below come from the very same
// text, measured on the methods of the class before the move. It uses nothing of this file: everything comes in through
// its two parameters. A small stand-in for the DOM (`document.createElement`, `style`, `appendChild`, `append`, `remove`,
// `innerHTML`, `dataset`, events) records every element and every change; a context stub records every read. After each
// call the tree under `infoBlock` is written out, every button is clicked, and a chain of microtasks runs beside it: every
// line carries the number of ticks that have run.

// <infofeld-sequence>
/** How the two functions are reached: as functions of the module (new stand), or as methods of the prototype (old). */
interface InfofeldCalls {
  infoSchreiben(kat: object, name: string, def: unknown, masse: unknown, warnung: string | null): unknown;
  speicherInfoSchreiben(kat: object, eintrag: unknown, warnung: string | null): unknown;
}
/** What the sequence needs from the tree, handed in so that the same text runs on the old stand too. */
interface InfofeldDeps {
  /** Builds the context from the stub fields: a plain object, or one that has the prototype of the class. */
  makeContext(fields: PropertyDescriptorMap): object;
  /** A prefab name the whitelist of own models knows, one it does not know, a registered upload, and two registered items. */
  names: { eigen: string; fremd: string; upload: string; itemMitTafel: string; itemOhneTafel: string };
  /** The text `ITEM_TYP_TEXT` has for the type of both items: it stands in the log as <TYP> (translation changes it). */
  typText: string;
}
/**
 * Runs a fixed sequence of calls against a stub of the context with a stand-in for `document` and `navigator`, and records
 * every effect in its order. Names of the registry appear as labels, so the lines do not depend on which prefabs it holds.
 */
async function runInfofeldSequence(calls: InfofeldCalls, deps: InfofeldDeps): Promise<string[]> {
  const lines: string[] = [];
  let scene = '';
  let nextId = 0;
  let ticks = 0;
  const swaps: ReadonlyArray<readonly [string, string]> = [
    [deps.names.itemMitTafel, '<ITEM_MIT_TAFEL>'],
    [deps.names.itemOhneTafel, '<ITEM_OHNE_TAFEL>'],
    [deps.names.upload, '<UPLOAD>'],
    [deps.names.eigen, '<EIGEN>'],
    [deps.names.fremd, '<FREMD>'],
    [deps.typText, '<TYP>'],
  ];
  const log = (text: string): void => {
    let shown = text;
    for (const [from, to] of swaps) if (from !== '') shown = shown.split(from).join(to);
    lines.push(`[${scene}] @${ticks} ${shown}`);
  };
  const show = (value: unknown): string =>
    value === undefined ? 'undefined' : typeof value === 'string' ? JSON.stringify(value) : typeof value === 'function' ? 'function' : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  /** The one known difference of the move (rule 6a): V8 writes the text of the expression, `this.x` became `kat.x`. */
  const oneLine = (error: unknown): string => `${(error as Error).constructor.name}: ${(error as Error).message.replace(/^(this|kat)\./, 'ctx.')}`;

  // ── the stand-in for the DOM ──
  class FakeStyle {
    private readonly parts: Record<string, string> = {};
    constructor(private readonly id: string) {}
    set cssText(value: string) {
      log(`    ${this.id}.style.cssText = ${JSON.stringify(value)}`);
      this.parts['cssText'] = value;
    }
    get cssText(): string {
      return this.parts['cssText'] ?? '';
    }
    set flex(value: string) {
      log(`    ${this.id}.style.flex = ${JSON.stringify(value)}`);
      this.parts['flex'] = value;
    }
    getPropertyValue(name: string): string {
      log(`    ${this.id}.style.getPropertyValue(${JSON.stringify(name)})`);
      return this.parts[name] ?? '';
    }
    setProperty(name: string, value: string): void {
      log(`    ${this.id}.style.setProperty(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
      this.parts[name] = value;
    }
  }
  const WATCHED_PROPERTIES = ['textContent', 'innerHTML', 'src', 'title', 'onclick', 'onerror', 'disabled', 'value'];
  class FakeElement {
    readonly id: string;
    readonly tag: string;
    readonly style: FakeStyle;
    readonly children: (FakeElement | string)[] = [];
    readonly attrs: Record<string, string> = {};
    readonly events: { kind: string; fn: () => void }[] = [];
    readonly values: Record<string, unknown> = {};
    readonly dataset: Record<string, string>;
    constructor(tag: string) {
      this.id = `#${++nextId}`;
      this.tag = tag;
      this.style = new FakeStyle(this.id);
      this.dataset = new Proxy({} as Record<string, string>, {
        set: (target, property, value: string) => {
          log(`    ${this.id}.dataset.${String(property)} = ${JSON.stringify(value)}`);
          target[String(property)] = value;
          return true;
        },
      });
      log(`    create ${tag} ${this.id}`);
      return new Proxy(this, {
        get: (target, property, receiver) => (typeof property === 'string' && WATCHED_PROPERTIES.includes(property) ? target.values[property] : Reflect.get(target, property, receiver)),
        set: (target, property, value: unknown, receiver) => {
          if (typeof property === 'string' && WATCHED_PROPERTIES.includes(property)) {
            log(`    ${target.id}.${property} = ${typeof value === 'function' ? 'function' : JSON.stringify(value)}`);
            target.values[property] = value;
            if (property === 'innerHTML') target.children.length = 0;
            return true;
          }
          return Reflect.set(target, property, value, receiver);
        },
      });
    }
    appendChild(child: FakeElement): FakeElement {
      log(`    ${this.id}.appendChild(${child.id})`);
      this.children.push(child);
      return child;
    }
    append(...items: (FakeElement | string)[]): void {
      log(`    ${this.id}.append(${items.map((item) => (typeof item === 'string' ? JSON.stringify(item) : item.id)).join(', ')})`);
      this.children.push(...items);
    }
    remove(): void {
      log(`    ${this.id}.remove()`);
    }
    setAttribute(name: string, value: string): void {
      log(`    ${this.id}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
      this.attrs[name] = value;
    }
    addEventListener(kind: string, fn: () => void): void {
      log(`    ${this.id}.addEventListener(${JSON.stringify(kind)})`);
      this.events.push({ kind, fn });
    }
  }
  const treeOf = (node: FakeElement | string, depth = 0): string[] => {
    const pad = '  '.repeat(depth);
    if (typeof node === 'string') return [`${pad}${JSON.stringify(node)}`];
    const parts = [`${node.tag}${node.id}`, `css=${JSON.stringify(node.style.cssText)}`];
    for (const property of ['textContent', 'innerHTML', 'src', 'title', 'disabled', 'value']) if (node.values[property] !== undefined) parts.push(`${property}=${JSON.stringify(node.values[property])}`);
    for (const property of ['onclick', 'onerror']) if (node.values[property] !== undefined) parts.push(`${property}=yes`);
    if (Object.keys(node.attrs).length > 0) parts.push(`attrs=${JSON.stringify(node.attrs)}`);
    if (Object.keys(node.dataset).length > 0) parts.push(`dataset=${JSON.stringify({ ...node.dataset })}`);
    if (node.events.length > 0) parts.push(`events=${node.events.map((event) => event.kind).join(',')}`);
    return [`${pad}${parts.join(' ')}`, ...node.children.flatMap((child) => treeOf(child, depth + 1))];
  };
  const collect = (node: FakeElement | string, wanted: (element: FakeElement) => boolean, into: FakeElement[] = []): FakeElement[] => {
    if (typeof node === 'string') return into;
    if (wanted(node)) into.push(node);
    for (const child of node.children) collect(child, wanted, into);
    return into;
  };

  // ── stand-ins for document, navigator and the unhandled-rejection event ──
  type Clipboard = 'ok' | 'rejected' | 'missing';
  let clipboard: Clipboard = 'ok';
  const g = globalThis as unknown as Record<string, unknown>;
  const hadDocument = 'document' in g;
  const realDocument = g.document;
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  g.document = { createElement: (tag: string) => new FakeElement(tag), createElementNS: (_namespace: string, tag: string) => new FakeElement(tag) };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      if (clipboard === 'missing') return {};
      return {
        clipboard: {
          writeText: (text: string): Promise<void> => {
            log(`  navigator.clipboard.writeText(${JSON.stringify(text)}) [${clipboard}]`);
            return clipboard === 'ok' ? Promise.resolve() : Promise.reject(new Error('clipboard blocked (probe)'));
          },
        },
      };
    },
  });
  const onUnhandled = (error: unknown): void => log(`  UNHANDLED REJECTION ${oneLine(error)}`);
  process.on('unhandledRejection', onUnhandled);

  // ── the context stub ──
  const WATCHED = ['infoBlock', 'aufPlatzieren', 'rasterSchritt', 'schliesse', 'hochgeladenesModellEntfernen', 'grundskalaZeileBauen', 'letzteMasse', 'storeContainer', 'bildMasse', 'tonSpieler', 'statusSetzen'];
  interface Setup {
    placer?: 'function' | 'null';
    gridStep?: number;
    measured?: unknown;
    container?: unknown;
    imageSize?: unknown;
    duration?: number;
    without?: readonly string[];
  }
  let lastRow: FakeElement | null = null;
  const context = (setup: Setup): { readonly k: object; readonly block: FakeElement } => {
    const block = new FakeElement('div');
    const own = (value: unknown): PropertyDescriptor => ({ value, enumerable: true, writable: true, configurable: true });
    let instance: object = {};
    const fields: PropertyDescriptorMap = {
      infoBlock: own(block),
      aufPlatzieren: own(setup.placer === 'function' ? (prefab: string): void => log(`  aufPlatzieren(${show(prefab)})`) : null),
      rasterSchritt: own(setup.gridStep ?? 1),
      letzteMasse: own(setup.measured ?? null),
      storeContainer: own(setup.container ?? null),
      bildMasse: own(setup.imageSize ?? null),
      tonSpieler: own({ duration: setup.duration ?? Number.NaN }),
      schliesse: own(function (this: unknown): void {
        log(`  schliesse() this is the context: ${this === instance}`);
      }),
      hochgeladenesModellEntfernen: own(function (this: unknown, name: string): Promise<void> {
        log(`  hochgeladenesModellEntfernen(${show(name)}) this is the context: ${this === instance}`);
        return Promise.resolve();
      }),
      grundskalaZeileBauen: own(function (this: unknown, entry: { name: string }): FakeElement {
        log(`  grundskalaZeileBauen(${show(entry.name)}) this is the context: ${this === instance}`);
        const row = new FakeElement('div');
        row.style.cssText = 'grundskala-row';
        lastRow = row;
        return row;
      }),
      statusSetzen: own(function (this: unknown, text: string, kind: string): void {
        log(`  statusSetzen(${show(text)}, ${show(kind)}) this is the context: ${this === instance}`);
      }),
    };
    for (const name of setup.without ?? []) fields[name] = own(undefined);
    instance = new Proxy(deps.makeContext(fields), {
      get(target, property, receiver) {
        if (typeof property === 'string' && WATCHED.includes(property)) log(`  ctx.${property} read`);
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value: unknown, receiver) {
        log(`  ctx.${String(property)} WRITTEN`);
        return Reflect.set(target, property, value, receiver);
      },
    });
    return { k: instance, block };
  };

  // ── one scene: the call, the tree, a click on every button, the microtasks ──
  const run = async (name: string, setup: Setup, call: (k: object) => unknown, clickAll = true): Promise<void> => {
    scene = name;
    nextId = 0;
    ticks = 0;
    lastRow = null;
    let chain = Promise.resolve();
    for (let i = 0; i < 40; i++) chain = chain.then(() => void ticks++);
    const { k, block } = context(setup);
    try {
      const result = call(k);
      log(`  returns ${result instanceof Promise ? 'a Promise' : show(result)}`);
    } catch (error) {
      log(`  THROWN ${oneLine(error)}`);
    }
    log('  tree under infoBlock:');
    for (const line of treeOf(block)) log(`  ${line}`);
    if (lastRow !== null) log(`  the row from grundskalaZeileBauen is the very node appended to infoBlock: ${block.children.includes(lastRow)}`);
    if (clickAll) {
      for (const button of collect(block, (element) => element.tag === 'button')) {
        const handler = button.values.onclick as (() => unknown) | undefined;
        log(`  click ${button.id} ${JSON.stringify(button.values.title ?? '')}`);
        if (typeof handler !== 'function') {
          log('    (no onclick)');
          continue;
        }
        try {
          const result = handler.call(button);
          log(`    returns ${result instanceof Promise ? 'a Promise' : show(result)}`);
        } catch (error) {
          log(`    THROWN ${oneLine(error)}`);
        }
        for (const event of button.events) {
          log(`    event ${event.kind}`);
          event.fn();
        }
      }
      for (const image of collect(block, (element) => typeof element.values.onerror === 'function')) {
        log(`  onerror of ${image.id}`);
        (image.values.onerror as () => void)();
      }
    }
    await chain;
    await new Promise<void>((done) => setImmediate(done));
  };

  // ── data ──
  const prefabDef = (extra: Record<string, unknown> = {}): unknown => ({
    name: 'probe', model: 'Probe_Modell', sprite: 'probe_sprite', animation: null, light: null, localScale: { x: 1, y: 1, z: 1 }, renderScale: { w: 1.5, h: 2.25 }, ...extra,
  });
  const measure = { breite: 1.234, hoehe: 2.5, tiefe: 0.75, dreiecke: 12345, meshes: 3, materialien: 2 };
  const container = { materials: [1, 2, 3], textures: [1, 2] };
  const entry = (extra: Record<string, unknown>): Record<string, unknown> => ({
    name: 'environment/sm-probe', id: 'environment/sm-probe', art: 'Modelle', gruppe: 'Umgebung', untergruppe: 'Haeuser', kennzeichen: [], pfad: 'modelle/environment/sm-probe.glb', bytes: 20560,
    bounds: { min: [-1, 0, -2], max: [1, 3, 2] }, kollisionsdatei: null, kollision: null, herkunft: null, lizenzstatus: 'frei', prefabName: null, ...extra,
  });
  const N = deps.names;
  const tooLong = 'Zeitüberschreitung nach 20 s — Server antwortet nicht.';
  try {
    await run('I1 prefab with a model, animation, sprite, placer function', { placer: 'function', gridStep: 0.5 }, (k) => calls.infoSchreiben(k, N.eigen, prefabDef({ animation: 'idle' }), measure, null));
    await run('I2 prefab with a light, no placer, with a warning', { placer: 'null', gridStep: 2 }, (k) => calls.infoSchreiben(k, N.eigen, prefabDef({ light: { range: 7 } }), null, 'Kein Modell hinterlegt (model = null).'));
    await run('I3 prefab with a local scale other than 1', { placer: 'function' }, (k) => calls.infoSchreiben(k, N.eigen, prefabDef({ localScale: { x: 1, y: 2, z: 3 } }), measure, null));
    await run('I4 uploaded model (remove button, base-scale row)', { placer: 'function' }, (k) => calls.infoSchreiben(k, N.upload, prefabDef(), measure, null));
    await run('I5 item with a piece table, no def', { placer: 'function' }, (k) => calls.infoSchreiben(k, N.itemMitTafel, null, null, null));
    await run('I6 item without a piece table, with def and warning', { placer: 'null' }, (k) => calls.infoSchreiben(k, N.itemOhneTafel, prefabDef({ model: null, sprite: null }), null, tooLong));
    await run('I7 prefab without a model', { placer: 'function' }, (k) => calls.infoSchreiben(k, N.fremd, prefabDef({ model: null }), null, null));
    await run('I8 prefab the whitelist does not know', { placer: 'function' }, (k) => calls.infoSchreiben(k, N.fremd, prefabDef(), measure, null));
    await run('I9 unknown name, nothing else', { placer: 'function' }, (k) => calls.infoSchreiben(k, 'Probe_UnknownName', null, null, null));
    clipboard = 'ok';
    await run(
      'S1 model, orphaned collision mesh, bounds below the origin, measured, clipboard ok',
      { measured: measure, container },
      (k) => calls.speicherInfoSchreiben(k, entry({ kennzeichen: ['Kollisionsnetz', 'Torbogen'], kollisionsdatei: 'kollision/sm-probe.glb', kollision: 'box', bounds: { min: [-1, -0.5, -2], max: [1, 3, 2] } }), 'Die Datei ist im Manifest verzeichnet, der Server liefert sie nicht aus.'),
    );
    clipboard = 'rejected';
    await run('S2 model with a prefab, mesh collision, clipboard rejected', { measured: measure, container }, (k) => calls.speicherInfoSchreiben(k, entry({ kennzeichen: ['Kollisionsnetz'], prefabName: 'Probe_Prefab', kollision: 'mesh' }), null));
    clipboard = 'missing';
    await run('S3 model without a measurement and without bounds, no clipboard', {}, (k) => calls.speicherInfoSchreiben(k, entry({ bounds: null, kollision: 'other', kennzeichen: [] }), null));
    clipboard = 'ok';
    await run('S4 ground texture with an image size', { imageSize: { breite: 512, hoehe: 256 } }, (k) => calls.speicherInfoSchreiben(k, entry({ art: 'Texturen', gruppe: 'Boden-Texturen', bounds: null }), null));
    await run('S5 symbol without an image size', {}, (k) => calls.speicherInfoSchreiben(k, entry({ art: 'Symbole', gruppe: 'Symbole', bounds: null }), 'x'));
    await run('S6 sound with a duration and an origin', { duration: 1.18 }, (k) => calls.speicherInfoSchreiben(k, entry({ art: 'Ton', gruppe: 'Toene', bounds: null, herkunft: '1.18 s, mono, 48 kHz, 16 bit, wav, tool chain a, b' }), null));
    await run('S7 sound without a duration and without an origin', { duration: Number.NaN }, (k) => calls.speicherInfoSchreiben(k, entry({ art: 'Ton', gruppe: 'Toene', bounds: null, herkunft: null, prefabName: 'Probe_Sound' }), null));
    await run('S8 bounds exactly at the limit: min y = -0.001 shows no lower-edge line', {}, (k) => calls.speicherInfoSchreiben(k, entry({ bounds: { min: [0, -0.001, 0], max: [1, 1, 1] } }), null));
    // the context lacks a member: the TypeError names the expression (rule 6a: `this.x` became `kat.x`, normalized above)
    await run('E1 context without schliesse: click on the placer', { placer: 'function', without: ['schliesse'] }, (k) => calls.infoSchreiben(k, N.eigen, prefabDef(), null, null));
    await run('E2 context without grundskalaZeileBauen', { placer: 'function', without: ['grundskalaZeileBauen'] }, (k) => calls.infoSchreiben(k, N.upload, prefabDef(), null, null));
    await run('E3 context without hochgeladenesModellEntfernen: click on remove', { without: ['hochgeladenesModellEntfernen'] }, (k) => calls.infoSchreiben(k, N.upload, prefabDef(), null, null));
    clipboard = 'ok';
    await run('E4 context without statusSetzen: clipboard ok', { without: ['statusSetzen'] }, (k) => calls.speicherInfoSchreiben(k, entry({}), null));
    await run('E5 context without infoBlock', { without: ['infoBlock'] }, (k) => calls.infoSchreiben(k, N.eigen, prefabDef(), null, null), false);
    await run('E6 context without tonSpieler (sound)', { without: ['tonSpieler'] }, (k) => calls.speicherInfoSchreiben(k, entry({ art: 'Ton', bounds: null }), null), false);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    if (hadDocument) g.document = realDocument;
    else delete g.document;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
    else delete g.navigator;
  }
  return lines;
}
// </infofeld-sequence>

/** Measured before the move, on the methods of the class (report of step G3): per scene the number of lines and the sha256 (first 16 hex digits) of the lines, joined with newlines. */
const EXPECTED_INFOFELD: ReadonlyArray<readonly [scene: string, lines: number, sha: string]> = [
  ["I1 prefab with a model, animation, sprite, placer function", 174, 'b8450dc46b4c387a'],
  ["I2 prefab with a light, no placer, with a warning", 89, 'f93d4427e36a3087'],
  ["I3 prefab with a local scale other than 1", 174, 'aa45a7128bcec44c'],
  ["I4 uploaded model (remove button, base-scale row)", 208, 'd451dae9dfc27c51'],
  ["I5 item with a piece table, no def", 110, '67599770b40f63b1'],
  ["I6 item without a piece table, with def and warning", 107, 'b44f6f5f7661330c'],
  ["I7 prefab without a model", 71, 'e6c1c4605e5ad986'],
  ["I8 prefab the whitelist does not know", 123, '9748f357fdbaefd0'],
  ["I9 unknown name, nothing else", 50, 'ed104968db43d86f'],
  ["S1 model, orphaned collision mesh, bounds below the origin, measured, clipboard ok", 244, '8f92ea6c5ac35b53'],
  ["S2 model with a prefab, mesh collision, clipboard rejected", 216, '9c3797d218e9da7b'],
  ["S3 model without a measurement and without bounds, no clipboard", 126, '0dc15d59931e8a78'],
  ["S4 ground texture with an image size", 145, 'dbbb35d60c257a9e'],
  ["S5 symbol without an image size", 135, 'c2c71fe9db26cc8d'],
  ["S6 sound with a duration and an origin", 144, 'a02e60b57305cb13'],
  ["S7 sound without a duration and without an origin", 143, '5fc66bde2ba2b95f'],
  ["S8 bounds exactly at the limit: min y = -0.001 shows no lower-edge line", 129, 'c279a9228c0e5fc8'],
  ["E1 context without schliesse: click on the placer", 108, 'e2c6494ae4d12e88'],
  ["E2 context without grundskalaZeileBauen", 118, '578f01ed7bf69f72'],
  ["E3 context without hochgeladenesModellEntfernen: click on remove", 117, '299f89d6f8b1aa70'],
  ["E4 context without statusSetzen: clipboard ok", 130, '54756f28aa380772'],
  ["E5 context without infoBlock", 5, '4ba1616f8f0f64ef'],
  ["E6 context without tonSpieler (sound)", 62, '4fa1a0377a0895ca'],
];

console.log('\n── [9] Step G3: behaviour of infoSchreiben and speicherInfoSchreiben, recorded ──');
{
  const infofeldFns = infofeld as unknown as InfofeldCalls | null;
  const prototype = klasse ? (klasse.prototype as { infoSchreiben(this: object, name: string, def: unknown, masse: unknown, warnung: string | null): unknown; speicherInfoSchreiben(this: object, eintrag: unknown, warnung: string | null): unknown }) : null;
  if (kategorien !== null && infofeldFns !== null && prototype !== null) {
    const { ITEMS_NACH_NAME, ITEM_TYP_TEXT } = kategorien;
    const typeCode = Number(Object.keys(ITEM_TYP_TEXT)[0]);
    const typText = ITEM_TYP_TEXT[typeCode] ?? '';
    const itemMitTafel = 'G3_ProbeItemMitTafel';
    const itemOhneTafel = 'G3_ProbeItemOhneTafel';
    const upload = {
      name: 'U_G3Probe', anzeigename: "Probe 'Ü' <b>", bytes: 12345, dreiecke: 99, meshes: 2, materialien: 1, bilder: 1, fehlendeTexturen: false, breite: 1.5, hoehe: 2.5, tiefe: 0.5,
      kollisionsart: 'fest', hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false, hochgeladenVon: 'probe', zeitpunkt: '2026-09-30T00:00:00Z', grundskala: 1,
    } as uploadedModelRegistry.UploadedModelEntry;
    // synthetic items and one synthetic upload: the lines do not depend on the tuning of the real registries
    (ITEMS_NACH_NAME as Map<string, unknown>).set(itemMitTafel, { name: itemMitTafel, label: 'Probe-Werkzeug', icon: 'probe_icon', itemType: typeCode, weight: 2.5, maxStackSize: 20, pieceTable: 'Werkbank' });
    (ITEMS_NACH_NAME as Map<string, unknown>).set(itemOhneTafel, { name: itemOhneTafel, itemType: typeCode, weight: 0.25, maxStackSize: 1 });
    uploadedModelRegistry.registerUploadedPrefab(upload);
    const registryNames = [...PREFABS_BY_NAME.keys()].filter((n) => !ITEMS_NACH_NAME.has(n) && uploadedModelRegistry.uploadedModelEntry(n) === undefined).sort();
    const eigen = registryNames.find((n) => istEigenesModell(n));
    const fremd = registryNames.find((n) => !istEigenesModell(n));
    check('the registry offers a prefab name the whitelist of own models knows and one it does not know (neither an item nor an upload)', eigen !== undefined && fremd !== undefined, `${eigen ?? '-'} / ${fremd ?? '-'}`);
    if (eigen !== undefined && fremd !== undefined) {
      const deps = { names: { eigen, fremd, upload: upload.name, itemMitTafel, itemOhneTafel }, typText };
      /** Per scene the number of lines and the first 16 hex digits of the sha256 of the lines joined with newlines. */
      const summarize = (lines: readonly string[]): Array<readonly [string, number, string]> => {
        const byScene = new Map<string, string[]>();
        for (const line of lines) {
          const scene = line.slice(1, line.indexOf('] '));
          byScene.set(scene, [...(byScene.get(scene) ?? []), line]);
        }
        return [...byScene].map(([scene, list]) => [scene, list.length, createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 16)] as const);
      };
      const firstDifference = (got: ReadonlyArray<readonly [string, number, string]>): string => {
        for (let i = 0; i < Math.max(got.length, EXPECTED_INFOFELD.length); i++) {
          const a = got[i];
          const b = EXPECTED_INFOFELD[i];
          if (a === undefined || b === undefined || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return `scene ${i + 1}: got ${a ? `${a[0]} ${a[1]} lines ${a[2]}` : 'nothing'}, expected ${b ? `${b[0]} ${b[1]} lines ${b[2]}` : 'nothing'}`;
        }
        return `${got.length} scenes, equal`;
      };
      // (a) the functions of the module on a plain stub of the context
      const onStub = summarize(await runInfofeldSequence(infofeldFns, { ...deps, makeContext: (fields) => Object.defineProperties({}, fields) }));
      // (b) the methods of the prototype (the forwarders) on an object that has the prototype of the class
      const viaForwarders = summarize(
        await runInfofeldSequence(
          {
            infoSchreiben: (k, name, def, masse, warnung) => prototype.infoSchreiben.call(k, name, def, masse, warnung),
            speicherInfoSchreiben: (k, entryArg, warnung) => prototype.speicherInfoSchreiben.call(k, entryArg, warnung),
          },
          { ...deps, makeContext: (fields) => Object.defineProperties(Object.create(prototype) as object, fields) },
        ),
      );
      check(`the functions on a stub give the ${EXPECTED_INFOFELD.length} scenes measured before the move (lines and sha256 per scene)`, firstDifference(onStub) === `${onStub.length} scenes, equal` && onStub.length === EXPECTED_INFOFELD.length, firstDifference(onStub));
      check('the methods of the prototype on an object with the prototype of the class (the forwarders): the same scenes', firstDifference(viaForwarders) === `${viaForwarders.length} scenes, equal` && viaForwarders.length === EXPECTED_INFOFELD.length, firstDifference(viaForwarders));
    }
    (ITEMS_NACH_NAME as Map<string, unknown>).delete(itemMitTafel);
    (ITEMS_NACH_NAME as Map<string, unknown>).delete(itemOhneTafel);
  } else {
    check('behaviour: the module, the class and the item registry are available', false, 'see above');
  }
}

console.log('');
if (failures === 0) {
  console.log(`=== katalog-module-grenze: ${total} of ${total} checks passed ===`);
} else {
  console.error(`=== katalog-module-grenze: ${failures} of ${total} checks FAILED ===`);
  process.exit(1);
}
