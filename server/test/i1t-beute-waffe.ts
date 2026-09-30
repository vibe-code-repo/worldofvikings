/**
 * Surface and direction of the first modules under `server/src/spiel/`
 * (refactoring I1, step 0b).
 *
 * Step 0b moved 14 declarations unchanged out of `server/src/WovServer.ts`:
 * the loot tables and their dice (`spiel/Beute.ts`), the weapon helpers
 * (`spiel/Waffe.ts`), the special spawn entries (`spiel/Sondereintraege.ts`)
 * and one constant (`spiel/Konstanten.ts`). The later steps move blocks of the
 * class into the same folder. A module there that imports `WovServer.ts` closes
 * an import cycle, and nothing fails when it does: the module just sees a
 * half-built server module. This test holds the line.
 *
 *  1. Surface: the four weapon names can be imported from `WovServer.ts` and
 *     are THE SAME object as the export of `spiel/Waffe.ts`, not a copy. The ten
 *     other names did not become exports of `WovServer.ts`.
 *  2. Direction, read on the syntax tree:
 *     2a. No file under `server/src/spiel/` (sub-folders included) names
 *         `WovServer.ts`, neither as a value nor as a type, in any form:
 *         `import`, `import type`, `export … from`, `import x = require()`,
 *         `import()`, `require()`, the type position `import('…').X`, a
 *         `/// <reference path>` and `new URL('…', import.meta.url)`, by a
 *         relative path or by the package name. An `import()` or `require()`
 *         with a computed path is a violation in itself: it cannot be read.
 *         An import of Node's module system (`node:module` or `module`, in
 *         any form, also `import type` and `require('module')`) and the names
 *         `createRequire` and `getBuiltinModule` (as identifier, property or
 *         string) are violations as well: they open a `require()` this
 *         scanner cannot read, and under tsx such a `require` loads
 *         `WovServer.ts` a second time, as a module of its own. No file under
 *         `spiel/` has a legitimate use for the module system, so there is
 *         no allowed form of it (N1, finding B1 of the attack).
 *         Under `spiel/` only `.ts` files are allowed. A `.cts`, `.mts`,
 *         `.js`, `.cjs` or `.mjs` file is a violation in itself: in a CommonJS
 *         file `module.require(…)`, `(0, require)(…)` and `require.call(…)`
 *         open a `require()` the scanner does not see (N2, finding B4).
 *         ONE file is allowed to name the class, and only with `import type`:
 *         the context file (list `ALLOWED`).
 *     2b. No file under `server/src/spiel/` reaches `WovServer.ts` through a
 *         chain of VALUE imports across `server/src`. That chain would be the
 *         cycle at run time. A chain over a type import does not count: it is
 *         erased when the code is built. The same chain must not end in a
 *         file that uses the module system (the imports and names of 2a): a
 *         helper outside `spiel/` that holds `createRequire(import.meta.url)`
 *         and that a module of `spiel/` imports by value hands that module a
 *         `require()` for `WovServer.ts` (N2, finding B3).
 *  3. Uniqueness, read on the syntax tree: each of the 14 names is declared
 *     exactly once under `server/src`, at module level, in the file the step
 *     put it in. Every other binding of such a name is a violation: a
 *     declaration inside a function, a block, a namespace or a class, a
 *     parameter, a class member, an import or export under another name
 *     (`export { x as wuerfleDrop }`) and an import or re-export of the name
 *     from a module that does not declare it.
 *  4. Behaviour of the moved functions, with values measured on the stand
 *     before the move.
 *  5. The guard against a second bit list in `client/test/dungeon-neuer-saal.ts`
 *     reads this folder too (it held for `WovServer.ts` only).
 *
 * What counts as a value import: `import … from`, `import '…'`,
 * `export … from`, `import x = require('…')`, `import('…')`, `require('…')`.
 * An inline `import { type X } from '…'` counts as a VALUE import on purpose:
 * whether the statement survives the build depends on compiler options, and
 * the boundary must not.
 *
 * Section [0] proves first that the scanner can turn red: the same rules run
 * over small invented sources, one per form.
 *
 * Known limits:
 *  - Rule 2b follows imports inside `server/src` only. A detour through another
 *    package (`@wov/shared`, `@wov/admin`) or through a file outside
 *    `server/src` is not followed.
 *  - An alias (`paths` in a tsconfig) is not resolved. There is none today.
 *  - Rule 3 reads declarations, not assignments: `globalThis.TRUHEN = …` is
 *    not seen.
 *  - A name built at run time is not seen (N2, finding B2): `process['getBuiltin' + 'Module']`,
 *    `Reflect.get(process, ['get', 'Builtin', 'Module'].join(''))`, `eval('…')` and
 *    `new Function('…')` reach the module system, and through it `WovServer.ts` as a second module
 *    instance, while the test stays green. A test on the syntax tree reads the names written in
 *    the source; what a string expression evaluates to exists only when the program runs, and
 *    no scanner of the source text can decide that without running it. The guard is review of
 *    every new file under `spiel/`, and the fact that nothing under `server/src` uses the
 *    module system today.
 *
 * Run (from server/): npx tsx test/i1t-beute-waffe.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(SERVER_ROOT, '..');
/** Own package name: `@wov/server/src/…` reaches the same files through the workspace link in `node_modules`. */
const PACKAGE = JSON.parse(readFileSync(resolve(SERVER_ROOT, 'package.json'), 'utf-8')) as { name: string; main?: string };

// Paths below are relative to the server package and use forward slashes: `src/spiel/Beute.ts`.
const SRC = 'src';
const SPIEL = 'src/spiel';
const CLASS_FILE = 'src/WovServer.ts';

/** Where step 0b put each of the 14 names. */
const HOME: Readonly<Record<string, string>> = {
  pickableItem: 'src/spiel/Beute.ts',
  KREATUR_DROPS: 'src/spiel/Beute.ts',
  ZWEIT_DROPS: 'src/spiel/Beute.ts',
  wuerfleDrop: 'src/spiel/Beute.ts',
  TRUHEN: 'src/spiel/Beute.ts',
  wuerfleTruhe: 'src/spiel/Beute.ts',
  gepruefteWaffe: 'src/spiel/Waffe.ts',
  waffeTragbar: 'src/spiel/Waffe.ts',
  WAFFE_PAKETNAME_OHNE_EQUIP: 'src/spiel/Waffe.ts',
  wirksameWaffe: 'src/spiel/Waffe.ts',
  EIKTHYR_HASH: 'src/spiel/Sondereintraege.ts',
  BOSS_ENTRY: 'src/spiel/Sondereintraege.ts',
  NPC_ENTRY: 'src/spiel/Sondereintraege.ts',
  NAME_NICHT_EINDEUTIG: 'src/spiel/Konstanten.ts',
};
const NAMES = Object.keys(HOME);
const NEW_MODULES = [...new Set(Object.values(HOME))];
/** Exported by `WovServer.ts` before the move, so it keeps exporting them. */
const WEAPON_NAMES = ['gepruefteWaffe', 'waffeTragbar', 'WAFFE_PAKETNAME_OHNE_EQUIP', 'wirksameWaffe'] as const;

/**
 * The files under `spiel/` that may name `WovServer.ts`, with the one form and the spellings they
 * may use. One entry: the context file of the class. `SpielKontext<K>` is a `Pick` on the class, so
 * the file has to name it, and a type-only import is erased when the code is built. The file need
 * not exist. The list grows only by a change to this test, and that change needs a reason.
 */
const ALLOWED: readonly { file: string; form: Form; specifiers: readonly string[]; reason: string }[] = [
  {
    file: 'src/spiel/Kontext.ts',
    form: 'import type',
    specifiers: ['../WovServer.js', '../WovServer'],
    reason: 'context type of the class (a Pick on it), type-only, erased at build time',
  },
];

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

// ── Scanner ────────────────────────────────────────────────────────────

type Sources = ReadonlyMap<string, string>;
type Form =
  | 'import'
  | 'import type'
  | 'export from'
  | 'export type from'
  | 'import = require'
  | 'import type = require'
  | 'import()'
  | 'require()'
  | 'type import()'
  | 'reference path'
  | 'new URL';
const VALUE_FORMS: readonly Form[] = ['import', 'export from', 'import = require', 'import()', 'require()'];
/** Specifiers of Node's module system. It carries `createRequire`: a `require()` this scanner cannot read (N1, B1). */
const MODULE_SYSTEM: readonly string[] = ['module', 'node:module'];
/** Names that reach the module system without importing it (`process.getBuiltinModule('module').createRequire`). */
const MODULE_SYSTEM_NAMES: readonly string[] = ['createRequire', 'getBuiltinModule'];

interface Reference {
  readonly line: number;
  readonly form: Form;
  /** `null`: the path is computed and cannot be read. */
  readonly specifier: string | null;
}
interface Finding {
  readonly rule: '2a' | '2b' | '3';
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** Rule 3: the name the finding is about. */
  readonly name?: string;
}

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TRY_EXT = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];
const TS_FOR_JS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};

function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.(?:tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** Every place of a source that names another module. */
function references(file: string, text: string): Reference[] {
  const sf = parse(file, text);
  const out: Reference[] = [];
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const literal = (e: ts.Node | undefined): string | null =>
    e !== undefined && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null;
  const isImportMetaUrl = (e: ts.Node | undefined): boolean =>
    e !== undefined &&
    ts.isPropertyAccessExpression(e) &&
    e.name.text === 'url' &&
    ts.isMetaProperty(e.expression) &&
    e.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
  for (const r of sf.referencedFiles) out.push({ line: lineOf(r.pos), form: 'reference path', specifier: r.fileName });
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      out.push({ line: lineOf(n.getStart(sf)), form: n.importClause?.isTypeOnly ? 'import type' : 'import', specifier: literal(n.moduleSpecifier) });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      out.push({ line: lineOf(n.getStart(sf)), form: n.isTypeOnly ? 'export type from' : 'export from', specifier: literal(n.moduleSpecifier) });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      out.push({ line: lineOf(n.getStart(sf)), form: n.isTypeOnly ? 'import type = require' : 'import = require', specifier: literal(n.moduleReference.expression) });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ line: lineOf(n.getStart(sf)), form: 'import()', specifier: literal(n.arguments[0]) });
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
      out.push({ line: lineOf(n.getStart(sf)), form: 'require()', specifier: literal(n.arguments[0]) });
    } else if (ts.isImportTypeNode(n)) {
      out.push({ line: lineOf(n.getStart(sf)), form: 'type import()', specifier: ts.isLiteralTypeNode(n.argument) ? literal(n.argument.literal) : null });
    } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL' && isImportMetaUrl(n.arguments?.[1])) {
      const s = literal(n.arguments?.[0]);
      if (s !== null) out.push({ line: lineOf(n.getStart(sf)), form: 'new URL', specifier: s });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every identifier, property name or string literal of a source that is one of MODULE_SYSTEM_NAMES. Comments do not count. */
function moduleSystemNames(file: string, text: string): { line: number; name: string }[] {
  const sf = parse(file, text);
  const out: { line: number; name: string }[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && MODULE_SYSTEM_NAMES.includes(n.text)) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, name: n.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The files a specifier may mean, in the order they are tried. Empty for another package. */
function candidates(from: string, specifier: string): string[] {
  const clean = specifier.replace(/[?#].*$/, '');
  let base: string;
  if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../')) {
    base = posix.normalize(posix.join(posix.dirname(from), clean));
  } else if (clean === PACKAGE.name) {
    base = posix.normalize(PACKAGE.main ?? 'index');
  } else if (clean.startsWith(`${PACKAGE.name}/`)) {
    base = posix.normalize(clean.slice(PACKAGE.name.length + 1));
  } else {
    return [];
  }
  const out = [base];
  for (const [js, tsExts] of Object.entries(TS_FOR_JS)) {
    if (base.endsWith(js)) for (const e of tsExts) out.push(base.slice(0, -js.length) + e);
  }
  for (const e of TRY_EXT) out.push(base + e);
  for (const e of TRY_EXT) out.push(`${base}/index${e}`);
  return out;
}

/** Rule 2a and 2b over a set of sources. */
function direction(sources: Sources): Finding[] {
  const out: Finding[] = [];
  const refs = new Map<string, Reference[]>();
  for (const [file, text] of sources) refs.set(file, references(file, text));
  const inSpiel = [...sources.keys()].filter((f) => f.startsWith(`${SPIEL}/`)).sort();

  /** The first place where a file uses the module system (an import of it or one of its names), or null. Same test as rule 2a. */
  const moduleSystemUse = (file: string): { line: number; what: string } | null => {
    for (const r of refs.get(file) ?? []) {
      if (r.specifier !== null && MODULE_SYSTEM.includes(r.specifier.replace(/[?#].*$/, ''))) return { line: r.line, what: `${r.form} '${r.specifier}'` };
    }
    const names = moduleSystemNames(file, sources.get(file)!);
    return names.length > 0 ? { line: names[0]!.line, what: `the name ${names[0]!.name}` } : null;
  };

  for (const file of inSpiel) {
    if (!file.endsWith('.ts')) {
      out.push({ rule: '2a', file, line: 1, text: 'is not a .ts file: under spiel/ only .ts is allowed, other kinds of module can hide a require() this scanner cannot read' });
    }
    for (const r of refs.get(file)!) {
      if (r.specifier === null) {
        if (r.form === 'import()' || r.form === 'require()') {
          out.push({ rule: '2a', file, line: r.line, text: `${r.form} with a computed path cannot be read` });
        }
        continue;
      }
      if (MODULE_SYSTEM.includes(r.specifier.replace(/[?#].*$/, ''))) {
        out.push({ rule: '2a', file, line: r.line, text: `${r.form} '${r.specifier}' imports the module system: createRequire is a require() this scanner cannot read` });
        continue;
      }
      if (!candidates(file, r.specifier).includes(CLASS_FILE)) continue;
      const specifier = r.specifier;
      const allowed = ALLOWED.some((a) => a.file === file && a.form === r.form && a.specifiers.includes(specifier));
      if (!allowed) out.push({ rule: '2a', file, line: r.line, text: `${r.form} '${r.specifier}' names WovServer.ts` });
    }
    for (const m of moduleSystemNames(file, sources.get(file)!)) {
      out.push({ rule: '2a', file, line: m.line, text: `names ${m.name}: a way to require() this scanner cannot read` });
    }
  }

  const valueEdges = (file: string): { to: string; line: number }[] => {
    const edges: { to: string; line: number }[] = [];
    for (const r of refs.get(file) ?? []) {
      if (r.specifier === null || !VALUE_FORMS.includes(r.form)) continue;
      const to = candidates(file, r.specifier).find((c) => sources.has(c));
      if (to !== undefined) edges.push({ to, line: r.line });
    }
    return edges;
  };
  for (const start of inSpiel) {
    // breadth first; a direct import of the class file is rule 2a, a chain has at least one file in between
    const via = new Map<string, string>();
    const firstLine = new Map<string, number>();
    const queue: string[] = [];
    for (const e of valueEdges(start)) {
      if (e.to === CLASS_FILE || e.to === start || via.has(e.to)) continue;
      via.set(e.to, start);
      firstLine.set(e.to, e.line);
      queue.push(e.to);
    }
    const chainTo = (last: string, end?: string): string[] => {
      const chain = end === undefined ? [] : [end];
      for (let f: string | undefined = last; f !== undefined && f !== start; f = via.get(f)) chain.push(f);
      chain.push(start);
      return chain.reverse();
    };
    let found = false;
    let moduleSystemFound = false;
    while (queue.length > 0 && !(found && moduleSystemFound)) {
      const file = queue.shift()!;
      // a reached file under spiel/ that uses the module system is a 2a finding of its own; the helpers outside are the 2b case
      const use = moduleSystemFound || file.startsWith(`${SPIEL}/`) ? null : moduleSystemUse(file);
      if (use !== null) {
        out.push({ rule: '2b', file: start, line: firstLine.get(file)!, text: `reaches the module system (${use.what} at ${file}:${use.line}) through value imports: ${chainTo(file).join(' -> ')}` });
        moduleSystemFound = true;
      }
      for (const e of valueEdges(file)) {
        if (e.to === CLASS_FILE) {
          if (found) continue;
          out.push({ rule: '2b', file: start, line: firstLine.get(file)!, text: `reaches WovServer.ts through value imports: ${chainTo(file, CLASS_FILE).join(' -> ')}` });
          found = true;
          continue;
        }
        if (e.to === start || via.has(e.to)) continue;
        via.set(e.to, file);
        firstLine.set(e.to, firstLine.get(file)!);
        queue.push(e.to);
      }
    }
  }
  return out;
}

interface Binding {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly kind: 'module' | 'nested' | 'member' | 'import' | 'export';
  readonly detail: string;
}

/** Every binding of one of the 14 names in a source, apart from the plain import and export of the name itself. */
function bindings(file: string, text: string): Binding[] {
  const sf = parse(file, text);
  const out: Binding[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (name: string, n: ts.Node, kind: Binding['kind'], detail: string): void => {
    if (NAMES.includes(name)) out.push({ name, file, line: lineOf(n), kind, detail });
  };
  const bound = (name: ts.BindingName, n: ts.Node, kind: Binding['kind'], detail: string): void => {
    if (ts.isIdentifier(name)) push(name.text, n, kind, detail);
    else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bound(e.name, e, kind, `${detail}, destructured`);
  };
  const homeOf = (name: string, specifier: ts.Expression): boolean => {
    if (!ts.isStringLiteral(specifier)) return false;
    const files = candidates(file, specifier.text);
    // the four weapon names may also be taken from the class file, which exports them again
    return files.includes(HOME[name]!) || ((WEAPON_NAMES as readonly string[]).includes(name) && files.includes(CLASS_FILE));
  };
  const visit = (n: ts.Node, top: boolean): void => {
    const where = top ? 'module' : 'nested';
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) bound(d.name, d, where, 'variable');
    } else if (ts.isVariableDeclarationList(n) && !ts.isVariableStatement(n.parent)) {
      for (const d of n.declarations) bound(d.name, d, 'nested', 'variable of a loop');
    } else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) && n.name) {
      push(n.name.text, n, where, ts.SyntaxKind[n.kind]);
    } else if (ts.isModuleDeclaration(n) && ts.isIdentifier(n.name)) {
      push(n.name.text, n, where, 'namespace');
    } else if ((ts.isFunctionExpression(n) || ts.isClassExpression(n)) && n.name) {
      push(n.name.text, n, 'nested', 'name of an expression');
    } else if (ts.isParameter(n)) {
      bound(n.name, n, 'nested', 'parameter');
    } else if (ts.isCatchClause(n) && n.variableDeclaration) {
      bound(n.variableDeclaration.name, n, 'nested', 'catch variable');
    } else if ((ts.isPropertyDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isClassLike(n.parent)) {
      if (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) push(n.name.text, n, 'member', 'member of a class');
    } else if (ts.isImportEqualsDeclaration(n)) {
      push(n.name.text, n, where, 'import =');
    } else if (ts.isImportDeclaration(n) && n.importClause) {
      const c = n.importClause;
      if (c.name) push(c.name.text, n, 'import', 'default import under this name');
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) push(c.namedBindings.name.text, n, 'import', 'namespace import under this name');
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const e of c.namedBindings.elements) {
          const imported = (e.propertyName ?? e.name).text;
          if (imported !== e.name.text) push(e.name.text, e, 'import', `import of '${imported}' under this name`);
          else if (NAMES.includes(imported) && !homeOf(imported, n.moduleSpecifier)) push(imported, e, 'import', `import from ${n.moduleSpecifier.getText(sf)}, which does not declare it`);
        }
      }
    } else if (ts.isExportDeclaration(n) && n.exportClause) {
      if (ts.isNamespaceExport(n.exportClause)) {
        push(n.exportClause.name.text, n, 'export', 'namespace export under this name');
      } else {
        for (const e of n.exportClause.elements) {
          const local = (e.propertyName ?? e.name).text;
          if (local !== e.name.text) push(e.name.text, e, 'export', `export of '${local}' under this name`);
          else if (n.moduleSpecifier && NAMES.includes(local) && !homeOf(local, n.moduleSpecifier)) push(local, e, 'export', `re-export from ${n.moduleSpecifier.getText(sf)}, which does not declare it`);
        }
      }
    }
    ts.forEachChild(n, (c) => visit(c, top && ts.isSourceFile(n)));
  };
  visit(sf, true);
  return out;
}

/** Rule 3 over a set of sources. */
function uniqueness(sources: Sources): Finding[] {
  const out: Finding[] = [];
  const all: Binding[] = [];
  for (const [file, text] of sources) if (file.startsWith(`${SRC}/`)) all.push(...bindings(file, text));
  for (const name of NAMES) {
    const own = all.filter((b) => b.name === name);
    const atHome = own.filter((b) => b.kind === 'module' && b.file === HOME[name]);
    if (atHome.length !== 1) {
      out.push({ rule: '3', name, file: HOME[name]!, line: atHome[1]?.line ?? 0, text: `${name} is declared ${atHome.length} times at module level in its file, expected once` });
    }
    for (const b of own) {
      if (b.kind === 'module' && b.file === HOME[name]) continue;
      out.push({ rule: '3', name, file: b.file, line: b.line, text: `${name}: another binding (${b.kind === 'module' ? 'module level' : b.kind}, ${b.detail})` });
    }
  }
  return out;
}

const show = (f: readonly Finding[]): string => f.map((x) => `${x.rule} ${x.file}:${x.line} ${x.text}`).join(' | ');

// ── [0] The scanner can turn red ───────────────────────────────────────

console.log('\n[0] Self-test of the scanner on invented sources');
{
  const X = 'src/spiel/X.ts';
  const set = (files: Record<string, string>): Sources => new Map(Object.entries({ [CLASS_FILE]: 'export class WovServer {}\n', ...files }));
  const red: [string, Record<string, string>, '2a' | '2b'][] = [
    ['import', { [X]: "import { a } from '../WovServer.js';" }, '2a'],
    ['import type', { [X]: "import type { WovServer } from '../WovServer.js';" }, '2a'],
    ['import { type X }', { [X]: "import { type WovServer } from '../WovServer.js';" }, '2a'],
    ['import for the side effect', { [X]: "import '../WovServer.js';" }, '2a'],
    ['export from', { [X]: "export { Wov } from '../WovServer.js';" }, '2a'],
    ['export type from', { [X]: "export type { ServerConfig } from '../WovServer.js';" }, '2a'],
    ['export * from', { [X]: "export * from '../WovServer.js';" }, '2a'],
    ['import = require', { [X]: "import w = require('../WovServer.js');" }, '2a'],
    ['import()', { [X]: "export const p = import('../WovServer.js');" }, '2a'],
    ['import() with a template', { [X]: 'export const p = import(`../WovServer.js`);' }, '2a'],
    ['require()', { [X]: "export const w = require('../WovServer.js');" }, '2a'],
    ['type position import()', { [X]: "export type S = import('../WovServer.js').WovServer;" }, '2a'],
    ['typeof import()', { [X]: "export type S = typeof import('../WovServer.js');" }, '2a'],
    ['path without extension', { [X]: "import { a } from '../WovServer';" }, '2a'],
    ['path with .ts', { [X]: "import { a } from '../WovServer.ts';" }, '2a'],
    ['path with a query', { [X]: "import { a } from '../WovServer.js?x=1';" }, '2a'],
    ['package name', { [X]: `import { a } from '${PACKAGE.name}/src/WovServer.js';` }, '2a'],
    ['reference path', { [X]: '/// <reference path="../WovServer.ts" />\nexport const a = 1;' }, '2a'],
    ['new URL', { [X]: "export const u = new URL('../WovServer.ts', import.meta.url);" }, '2a'],
    ['sub-folder', { 'src/spiel/befehle/Y.ts': "import { a } from '../../WovServer.js';" }, '2a'],
    ['computed import()', { [X]: "const n = '../WovServer.js';\nexport const p = import(n);" }, '2a'],
    ['computed require()', { [X]: "const n = '../WovServer';\nexport const p = require(n + '.js');" }, '2a'],
    ['context file, value import', { 'src/spiel/Kontext.ts': "import { WovServer } from '../WovServer.js';" }, '2a'],
    ['context file, import { type X }', { 'src/spiel/Kontext.ts': "import { type WovServer } from '../WovServer.js';" }, '2a'],
    ['context file, export type from', { 'src/spiel/Kontext.ts': "export type { WovServer } from '../WovServer.js';" }, '2a'],
    ['context file, type position', { 'src/spiel/Kontext.ts': "export type S = import('../WovServer.js').WovServer;" }, '2a'],
    ['context file, import()', { 'src/spiel/Kontext.ts': "export const p = import('../WovServer.js');" }, '2a'],
    ['context file, package name', { 'src/spiel/Kontext.ts': `import type { WovServer } from '${PACKAGE.name}/src/WovServer.js';` }, '2a'],
    ['a second context file', { 'src/spiel/Kontext2.ts': "import type { WovServer } from '../WovServer.js';" }, '2a'],
    ['context file in a sub-folder', { 'src/spiel/befehle/Kontext.ts': "import type { WovServer } from '../../WovServer.js';" }, '2a'],
    ['chain over one file', { [X]: "import { h } from '../hilf.js';", 'src/hilf.ts': "import { Wov } from './WovServer.js';\nexport const h = Wov;" }, '2b'],
    ['chain over two files', { [X]: "import { h } from '../a.js';", 'src/a.ts': "export { h } from './b.js';", 'src/b.ts': "export const h = import('./WovServer.js');" }, '2b'],
    ['chain from a sub-folder', { 'src/spiel/befehle/Y.ts': "import { h } from '../X.js';", [X]: "import { g } from '../hilf.js';\nexport const h = g;", 'src/hilf.ts': "import './WovServer.js';\nexport const g = 1;" }, '2b'],
    // the module system (N1, B1): the four forms of the attack, then the other ways to it
    ['createRequire from node:module', { [X]: "import { createRequire } from 'node:module';\nexport const r = (): unknown => createRequire(import.meta.url)('../WovServer.ts');" }, '2a'],
    ['createRequire under an alias', { [X]: "import { createRequire as cr } from 'node:module';\nexport const r = (): unknown => cr(import.meta.url)('../WovServer.js');" }, '2a'],
    ['namespace import of node:module', { [X]: "import * as nm from 'node:module';\nexport const r = (): unknown => nm.createRequire(import.meta.url)('../WovServer.js');" }, '2a'],
    ['require kept in a variable', { [X]: "import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nexport const r = (): unknown => req('../WovServer.js');" }, '2a'],
    ["'module' without the node: prefix", { [X]: "import { createRequire } from 'module';\nexport const r = createRequire;" }, '2a'],
    ['default import of node:module', { [X]: "import nm from 'node:module';\nexport const r = nm;" }, '2a'],
    ['import type of node:module', { [X]: "import type { createRequire } from 'node:module';\nexport type R = typeof createRequire;" }, '2a'],
    ['import() of node:module', { [X]: "export const r = import('node:module');" }, '2a'],
    ["require('module').createRequire", { [X]: "export const r = require('module').createRequire;" }, '2a'],
    ['import = require of node:module', { [X]: "import nm = require('node:module');\nexport const r = nm;" }, '2a'],
    ['process.getBuiltinModule', { [X]: "export const r = process.getBuiltinModule('node:module');" }, '2a'],
    ['createRequire as a string key', { [X]: "declare const nm: Record<string, unknown>;\nexport const r = nm['createRequire'];" }, '2a'],
    ['module system in a sub-folder', { 'src/spiel/befehle/Y.ts': "import { createRequire } from 'node:module';\nexport const r = createRequire;" }, '2a'],
    // a helper outside spiel/ that holds the module system, imported by value from spiel/ (N2, B3)
    [
      'helper outside spiel/ with createRequire, imported by value',
      { [X]: "import { lade } from '../lader.js';\nexport const w = (): unknown => lade('./WovServer.js');", 'src/lader.ts': "import { createRequire } from 'node:module';\nexport const lade = createRequire(import.meta.url);" },
      '2b',
    ],
    [
      'helper two files away',
      { [X]: "import { a } from '../a.js';\nexport const w = a;", 'src/a.ts': "export { lade as a } from './lader.js';", 'src/lader.ts': "import * as nm from 'node:module';\nexport const lade = nm.createRequire(import.meta.url);" },
      '2b',
    ],
    ['helper that only names getBuiltinModule', { [X]: "import { g } from '../lader.js';\nexport const w = g;", 'src/lader.ts': "export const g = process.getBuiltinModule;" }, '2b'],
    ['helper outside spiel/, imported from a sub-folder of spiel/', { 'src/spiel/befehle/Y.ts': "import { lade } from '../../lader.js';\nexport const w = lade;", 'src/lader.ts': "import { createRequire } from 'module';\nexport const lade = createRequire(import.meta.url);" }, '2b'],
    // only .ts under spiel/ (N2, B4)
    ['a .cts file with module.require', { 'src/spiel/Y.cts': "export = () => module.require('../WovServer.ts');" }, '2a'],
    ['a .cts file with (0, require)', { 'src/spiel/Y.cts': "export = () => (0, require)('../WovServer.ts');" }, '2a'],
    ['a .cts file with require.call', { 'src/spiel/Y.cts': "export = () => require.call(null, '../WovServer.ts');" }, '2a'],
    ['a .cjs file', { 'src/spiel/Y.cjs': "module.exports = () => module.require('../WovServer.cjs');" }, '2a'],
    ['a .mjs file', { 'src/spiel/Y.mjs': 'export const a = 1;' }, '2a'],
    ['a .mts file', { 'src/spiel/Y.mts': 'export const a = 1;' }, '2a'],
    ['a .js file', { 'src/spiel/Y.js': 'export const a = 1;' }, '2a'],
    ['a .cts file in a sub-folder', { 'src/spiel/befehle/Y.cts': 'export = 1;' }, '2a'],
  ];
  for (const [name, files, rule] of red) {
    const f = direction(set(files));
    check(`red: ${name}`, f.some((x) => x.rule === rule) && f.every((x) => x.rule === '2a' || x.rule === '2b') && (rule === '2b' || f.every((x) => x.rule === '2a')), show(f) || 'no finding');
  }
  const green: [string, Record<string, string>][] = [
    ['context file with import type', { 'src/spiel/Kontext.ts': "import type { WovServer } from '../WovServer.js';\nexport type K = WovServer;" }],
    ['context file, path without extension', { 'src/spiel/Kontext.ts': "import type { WovServer } from '../WovServer';\nexport type K = WovServer;" }],
    ['a comment and a string are no import', { [X]: "// import { a } from '../WovServer.js';\nexport const s = '../WovServer.js';" }],
    ['a file with a similar name', { [X]: "import { a } from '../WovServerHelfer.js';", 'src/WovServerHelfer.ts': 'export const a = 1;' }],
    ['another package', { [X]: "import { a } from '@wov/shared';\nimport { b } from 'node:fs';" }],
    ['chain that starts with a type import', { [X]: "import type { H } from '../hilf.js';", 'src/hilf.ts': "import { Wov } from './WovServer.js';\nexport type H = typeof Wov;" }],
    ['chain that ends with a type import', { [X]: "import { h } from '../hilf.js';", 'src/hilf.ts': "import type { WovServer } from './WovServer.js';\nexport const h = 1;" }],
    ['a file outside the folder may import the class', { 'src/main.ts': "import { createServer } from './WovServer.js';" }],
    ['a circle among the modules themselves', { [X]: "import { b } from './Z.js';", 'src/spiel/Z.ts': "import { a } from './X.js';" }],
    // the module system: the rule holds under spiel/ only, and only for the bare specifier and the names
    ['a file outside the folder may import node:module', { 'src/main.ts': "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);" }],
    ['a relative module named module is not the module system', { [X]: "import { a } from './module.js';", 'src/spiel/module.ts': 'export const a = 1;' }],
    ['a comment naming createRequire is no import', { [X]: "// createRequire(import.meta.url)('../WovServer.ts') would be a violation\nexport const a = 1;" }],
    ['main.ts holds the module system, nothing under spiel/ reaches it', { 'src/main.ts': "import { createRequire } from 'node:module';\nexport const r = createRequire(import.meta.url);", [X]: "import { a } from '../hilf.js';\nexport const b = a;", 'src/hilf.ts': 'export const a = 1;' }],
    ['a helper with the module system reached over a type import only', { [X]: "import type { L } from '../lader.js';\nexport type M = L;", 'src/lader.ts': "import { createRequire } from 'node:module';\nexport const lade = createRequire(import.meta.url);\nexport type L = typeof lade;" }],
    ['.ts and .d.ts under spiel/ are fine', { [X]: 'export const a = 1;', 'src/spiel/Y.d.ts': 'export declare const a: number;' }],
  ];
  for (const [name, files] of green) {
    const f = direction(set(files));
    check(`green: ${name}`, f.length === 0, show(f));
  }

  // rule 3: a good stand in miniature, then one fault each
  const byFile = new Map<string, string[]>();
  for (const [n, f] of Object.entries(HOME)) byFile.set(f, [...(byFile.get(f) ?? []), n]);
  const good: Record<string, string> = {};
  for (const [f, names] of byFile) good[f] = `${names.map((n) => `const ${n} = 1;`).join('\n')}\nexport { ${names.join(', ')} };\n`;
  good[CLASS_FILE] =
    "import { pickableItem, wuerfleDrop } from './spiel/Beute.js';\n" +
    "import { waffeTragbar as tragbar } from './spiel/Waffe.js';\n" +
    "export { gepruefteWaffe, waffeTragbar, WAFFE_PAKETNAME_OHNE_EQUIP, wirksameWaffe } from './spiel/Waffe.js';\n" +
    'export class WovServer { m(): unknown { return [pickableItem, wuerfleDrop, tragbar]; } }\n';
  good['src/anders.ts'] = "import { wirksameWaffe } from './WovServer.js';\nexport const x = wirksameWaffe;\n";
  check('green: the good stand in miniature', uniqueness(new Map(Object.entries(good))).length === 0, show(uniqueness(new Map(Object.entries(good)))));
  const A = 'src/anders.ts';
  const faults: [string, Record<string, string>][] = [
    ['a copy at module level in the class file', { [CLASS_FILE]: `${good[CLASS_FILE]}const TRUHEN = [];\n` }],
    ['a copy as let in another file', { [A]: 'let wuerfleDrop = 1;\nexport const x = wuerfleDrop;' }],
    ['a copy as function', { [A]: 'export function waffeTragbar(): boolean { return true; }' }],
    ['a second declaration in the same file', { 'src/spiel/Konstanten.ts': `${good['src/spiel/Konstanten.ts']}var NAME_NICHT_EINDEUTIG = 2;\n` }],
    ['inside a function', { [A]: 'export function f(): number { const TRUHEN = 1; return TRUHEN; }' }],
    ['inside a block', { [A]: 'if (Math.random() > 2) { var BOSS_ENTRY = 1; }' }],
    ['as a parameter', { [A]: 'export function f(wuerfleDrop: number): number { return wuerfleDrop; }' }],
    ['as a parameter of an arrow function', { [A]: 'export const f = (NPC_ENTRY: number): number => NPC_ENTRY;' }],
    ['destructured', { [A]: 'const o = { a: 1 };\nexport const { a: EIKTHYR_HASH } = o;' }],
    ['as a member of a class', { [A]: 'export class K { private static readonly TRUHEN = []; }' }],
    ['as a method of a class', { [A]: 'export class K { wuerfleDrop(): number { return 1; } }' }],
    ['inside a namespace', { [A]: 'export namespace N { export const KREATUR_DROPS = 1; }' }],
    ['as a type', { [A]: 'export type ZWEIT_DROPS = number;' }],
    ['export under this name', { [A]: 'const x = 1;\nexport { x as wuerfleDrop };' }],
    ['re-export under this name', { [A]: "export { x as gepruefteWaffe } from './spiel/Waffe.js';" }],
    ['namespace export under this name', { [A]: "export * as TRUHEN from './spiel/Beute.js';" }],
    ['import under this name', { [A]: "import { x as wuerfleTruhe } from './spiel/Beute.js';\nexport const y = wuerfleTruhe;" }],
    ['default import under this name', { [A]: "import pickableItem from './spiel/Beute.js';\nexport const y = pickableItem;" }],
    ['import from a module that does not declare it', { [A]: "import { wuerfleDrop } from './spiel/Waffe.js';\nexport const y = wuerfleDrop;" }],
    ['re-export from a module that does not declare it', { [A]: "export { pickableItem } from './WovServer.js';" }],
    ['the declaration is missing', { 'src/spiel/Konstanten.ts': 'export {};\n' }],
    ['the declaration stands in another file', { 'src/spiel/Konstanten.ts': 'export {};\n', 'src/spiel/Beute.ts': `${good['src/spiel/Beute.ts']}const NAME_NICHT_EINDEUTIG = 1;\n` }],
  ];
  for (const [name, files] of faults) {
    const f = uniqueness(new Map(Object.entries({ ...good, ...files })));
    check(`red: ${name}`, f.length > 0 && f.every((x) => x.rule === '3'), show(f) || 'no finding');
  }
}

// ── The real sources ───────────────────────────────────────────────────

const links: string[] = [];
function readSources(dir: string, out = new Map<string, string>()): Map<string, string> {
  let entries;
  try {
    entries = readdirSync(resolve(SERVER_ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const path = `${dir}/${e.name}`;
    if (e.isSymbolicLink()) links.push(path);
    else if (e.isDirectory()) {
      if (e.name !== 'node_modules') readSources(path, out);
    } else if (SOURCE_EXT.test(e.name)) out.set(path, readFileSync(resolve(SERVER_ROOT, path), 'utf-8'));
  }
  return out;
}
const sources = readSources(SRC);
const inSpiel = [...sources.keys()].filter((f) => f.startsWith(`${SPIEL}/`)).sort();

async function load(specifier: string): Promise<{ module: Record<string, unknown> | null; error: string }> {
  try {
    return { module: (await import(specifier)) as Record<string, unknown>, error: '' };
  } catch (e) {
    return { module: null, error: (e as Error).message.split('\n')[0]! };
  }
}

// ── [1] Surface ────────────────────────────────────────────────────────

console.log('\n[1] Surface: the weapon names are exported by WovServer.ts and are the same object');
{
  const classModule = await load('../src/WovServer.js');
  const weapons = await load('../src/spiel/Waffe.js');
  check('WovServer.ts loads', classModule.module !== null, classModule.error);
  check('spiel/Waffe.ts loads', weapons.module !== null, weapons.error);
  for (const name of WEAPON_NAMES) {
    const a = classModule.module?.[name];
    const b = weapons.module?.[name];
    check(`${name}: exported by both`, a !== undefined && b !== undefined, `WovServer.ts ${typeof a}, spiel/Waffe.ts ${typeof b}`);
    check(`${name}: the same object`, a !== undefined && a === b);
  }
  check(
    'the three helpers are functions, the transition rule is a boolean',
    ['gepruefteWaffe', 'waffeTragbar', 'wirksameWaffe'].every((n) => typeof weapons.module?.[n] === 'function') &&
      typeof weapons.module?.WAFFE_PAKETNAME_OHNE_EQUIP === 'boolean',
  );
  const leaked = NAMES.filter((n) => !(WEAPON_NAMES as readonly string[]).includes(n) && classModule.module !== null && n in classModule.module);
  check('the ten other names did not become exports of WovServer.ts', classModule.module !== null && leaked.length === 0, leaked.join(', '));
}

// ── [2] Direction ──────────────────────────────────────────────────────

console.log('\n[2] Direction: no module under server/src/spiel/ names or reaches WovServer.ts');
{
  check('server/src was read', sources.size > 20 && sources.has(CLASS_FILE), `${sources.size} source files`);
  check('no symbolic link under server/src (the scanner follows none)', links.length === 0, links.join(', '));
  check(`${SPIEL}/ was read`, inSpiel.length > 0, `${inSpiel.length} source files: ${inSpiel.map((f) => f.slice(SPIEL.length + 1)).join(', ')}`);
  for (const m of NEW_MODULES) check(`${m} was read`, sources.has(m));
  const found = direction(sources);
  const direct = found.filter((f) => f.rule === '2a');
  const chains = found.filter((f) => f.rule === '2b');
  check('2a: no file under spiel/ names WovServer.ts or the module system, only .ts files (one named exception: the context file, type-only)', direct.length === 0, show(direct));
  check('2b: no file under spiel/ reaches WovServer.ts or the module system through value imports', chains.length === 0, show(chains));
  for (const a of ALLOWED) {
    const used = sources.has(a.file) && references(a.file, sources.get(a.file)!).some((r) => r.specifier !== null && candidates(a.file, r.specifier).includes(CLASS_FILE));
    console.log(`  note: exception ${a.file} (${a.form}; ${a.reason}): ${sources.has(a.file) ? (used ? 'in use' : 'file exists, names no class file') : 'file does not exist'}`);
  }
}

// ── [3] Uniqueness ─────────────────────────────────────────────────────

console.log('\n[3] Uniqueness: each of the 14 names is declared once, at module level, in its file');
{
  check('the list has 14 names in 4 files', NAMES.length === 14 && NEW_MODULES.length === 4);
  const found = uniqueness(sources);
  for (const name of NAMES) {
    const own = found.filter((f) => f.name === name);
    check(`${name}: once, in ${HOME[name]}`, own.length === 0, show(own));
  }
  check('no finding without a name of the list', found.every((f) => f.name !== undefined && NAMES.includes(f.name)), show(found));
}

// ── [4] Behaviour ──────────────────────────────────────────────────────

console.log('\n[4] Behaviour of the moved functions');
{
  const loot = await load('../src/spiel/Beute.js');
  check('spiel/Beute.ts loads', loot.module !== null, loot.error);
  type Loot = { name: string; amount: number } | null;
  const wuerfleDrop = loot.module?.wuerfleDrop as ((k: string) => Loot) | undefined;
  const wuerfleTruhe = loot.module?.wuerfleTruhe as ((p: string) => { name: string; amount: number }) | undefined;
  const pickableItem = loot.module?.pickableItem as ((p: string) => Loot) | undefined;
  check('wuerfleDrop, wuerfleTruhe and pickableItem are functions', typeof wuerfleDrop === 'function' && typeof wuerfleTruhe === 'function' && typeof pickableItem === 'function');
  if (typeof wuerfleDrop === 'function' && typeof wuerfleTruhe === 'function' && typeof pickableItem === 'function') {
    const ROLLS = 200;
    const hen = new Set(Array.from({ length: ROLLS }, () => JSON.stringify(wuerfleDrop('Huhn'))));
    check(`wuerfleDrop('Huhn'): ${ROLLS} rolls give RawMeat, amount 1, every time`, hen.size === 1 && hen.has('{"name":"RawMeat","amount":1}'), [...hen].join(' | '));
    check("wuerfleDrop('GibtEsNicht') gives null", wuerfleDrop('GibtEsNicht') === null);
    // the last row of TRUHEN catches every name that no other row knows: [item, min, max]
    const LAST_ROW: Readonly<Record<string, readonly [number, number]>> = { Coins: [2, 10], Flint: [1, 3], Wood: [3, 8], Raspberry: [3, 6] };
    const chest = Array.from({ length: ROLLS }, () => wuerfleTruhe('x'));
    const strangers = [...new Set(chest.map((c) => c.name))].filter((n) => !(n in LAST_ROW));
    check(`wuerfleTruhe('x'): ${ROLLS} rolls give names of the last row only`, strangers.length === 0, strangers.join(', '));
    const outside = chest.filter((c) => c.name in LAST_ROW && (!Number.isInteger(c.amount) || c.amount < LAST_ROW[c.name]![0] || c.amount > LAST_ROW[c.name]![1]));
    check(`wuerfleTruhe('x'): every amount lies in the span of its row`, outside.length === 0, outside.slice(0, 3).map((c) => JSON.stringify(c)).join(' '));
    check("pickableItem('Pickable_Branch') gives Wood, amount 1", JSON.stringify(pickableItem('Pickable_Branch')) === '{"name":"Wood","amount":1}', JSON.stringify(pickableItem('Pickable_Branch')));
  }
}

// ── [5] The guard that grew with the step ──────────────────────────────

console.log('\n[5] The guard against a second bit list reads the new folder');
{
  let guard = '';
  try {
    guard = readFileSync(resolve(REPO_ROOT, 'client/test/dungeon-neuer-saal.ts'), 'utf-8');
  } catch {
    /* reported by the check below */
  }
  check('client/test/dungeon-neuer-saal.ts names server/src/spiel', guard.includes("'server/src/spiel'"));
}

console.log(failures === 0 ? `\n=== I1-T spiel modules: ALL PASSED (${total}) ===` : `\n=== I1-T spiel modules: ${failures} of ${total} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
