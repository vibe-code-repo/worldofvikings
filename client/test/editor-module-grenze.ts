/**
 * Boundary of the modules cut out of `editorMain.ts`: `editor/biome.ts`, `editor/formen.ts` and
 * `editor/seite/helfer.ts`.
 *
 * `editorMain.ts` starts with two top-level awaits (module registry, uploaded-model registry) and builds
 * the editor in the statements after them. A module it IMPORTS is evaluated BEFORE those awaits. The three
 * modules therefore must not read a registry while they load. This test pins that on the syntax tree
 * (TypeScript parser and checker, no text patterns):
 *   [0] the probe itself bites: small sources that break each rule are found
 *   [1] imports: values come from `design.ts` only, everything else is `import type`; `editorMain` is
 *       never imported, under whatever spelling; nothing they import leads back to `editorMain.ts` or to
 *       one of the three
 *   [2] load time: no await, nothing from the environment, imported values from `design.ts` only, and
 *       nothing that is imported is written to
 *   [3] `editorMain.ts` declares none of the eleven names and takes the ones it uses from these modules
 *   [4] behaviour that loads without a browser: biome tones, island shapes, sidebar builders
 *   [5] the older tests that hold a boundary on `editorMain.ts` as a whole name every module of this test
 *
 * An import is followed to the FILE it names. A specifier that starts with the name of a package of this
 * repository (`@wov/client/src/editor/editorMain`) is resolved through the workspaces of the root
 * package.json, so is a path through `node_modules/<such a package>/`, an absolute path and a `file:` URL.
 * A bundler query (`?raw`) is cut off. Packages from outside the repository are leaves.
 *
 * "Load time" is what runs while a module is evaluated: the statements outside function bodies, plus the
 * bodies of the functions that are called there or handed to a call there (`LIST.map((b) => ...)`),
 * followed through the names declared in the same file.
 * A "write" is an assignment to a member of an imported name (also `+=`, `++`, a destructuring target, the
 * variable of a `for … of`), `delete`, a call of `assign`, `defineProperty`, `defineProperties`,
 * `setPrototypeOf`, `freeze`, `seal` or `preventExtensions` with an imported name as its first argument,
 * and a call of a method that changes its object (`push`, `sort`, `set`, …) on an imported name. All of
 * them also through a local alias (`const t = BIOM_TON.grassland; t[0] = …`).
 * NOT caught (each needs intent): a call through an element access (`obj['f']()`), a function that is
 * reached through a value built at run time, `eval`, and a global reached through an allowed built-in;
 * a deferral into a microtask without `await` (`(async () => 1)().then(…)`) is not seen as waiting, the
 * body of its callback is read all the same; a write through the parameter of a callback or through a
 * function of another module; an import alias that is configured later (tsconfig `paths`, `imports` or
 * `exports` in a package.json, `resolve.alias` of the bundler): there is none today.
 * NOT caught either (each was tried while loading and passes; each needs intent):
 *   - a writing call reached through `call`: `Object.assign.call(null, F, { … })`
 *   - a writing call under another name: `const { assign: put } = Object; put(F, { … })`
 *   - a writing call with spread arguments: `Object.assign(...[F, { … }])`
 *   - a changing method taken from the prototype: `Array.prototype.push.call(BIOM_TON.grassland, …)`
 *   - a write through the parameter of a local function: `const set = (o) => { o.a = …; }; set(F);`
 *   - a getter that writes when it is read: `const o = { get g() { F.a = …; return 1; } }; void o.g;`
 *   - a module augmentation that names editorMain: `declare module '../editorMain' { … }` (types only, loads nothing)
 *   - a triple-slash reference to editorMain: `/// <reference path="../editorMain.ts" />` (types only, loads nothing)
 *
 * Run:  npx tsx test/editor-module-grenze.ts    (from client/)
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';

/** The path without symbolic links, so that two spellings of one file compare equal. */
const canonical = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path; // not there: nothing to follow
  }
};

const HIER = canonical(dirname(fileURLToPath(import.meta.url)));
const REPO = resolve(HIER, '../..');
const QUELLEN = resolve(HIER, '../src');
const EDITOR = resolve(QUELLEN, 'editor');
const HAUPT = resolve(EDITOR, 'editorMain.ts');
const DESIGN = resolve(EDITOR, 'design.ts');
const NETZ = resolve(QUELLEN, 'net') + sep;

/** The three modules and the eleven names that moved into them. */
const MODULE = [
  { datei: 'biome.ts', namen: ['BIOME_NAMEN', 'biomTon', 'BIOME_FARBE'] },
  { datei: 'formen.ts', namen: ['FormDef', 'rundPoly', 'zufall', 'FORMEN'] },
  { datei: 'seite/helfer.ts', namen: ['breiterKnopf', 'hinweisZeile', 'seitenHost', 'beschriftet'] },
] as const;
const ELF: readonly string[] = MODULE.flatMap((m) => [...m.namen]);
const pfadVon = (datei: string): string => resolve(EDITOR, datei);
const MODUL_PFADE: readonly string[] = MODULE.map((m) => pfadVon(m.datei));

/**
 * Older tests with a boundary on `editorMain.ts` as a whole (a text that must not occur, a condition every
 * place of a kind has to meet). The code of the modules lay under these boundaries before it moved, so each
 * of these tests runs them on every module as well and names the modules in a list of this name.
 * A module that is added to MODULE above has to be added to the list in each of these files.
 */
const BOUNDARY_TESTS = ['welt-zuruecksetzen.ts', 'entwurfs-speicher.ts', 'werkzeug-platzieren.ts', 'werkzeug-registry.ts', 'editor-speichern-basis.ts', 'inselwahl.ts'] as const;
const LIST_NAME = 'CUT_OUT_MODULES';

/** Built-ins a module may use while it loads: pure, nothing of the page, the network or a store. */
const REINE_GLOBALE = new Set([
  'Object', 'Array', 'Math', 'Number', 'String', 'Boolean', 'Symbol', 'BigInt', 'JSON', 'Map', 'Set', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'Infinity', 'NaN', 'undefined', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
]);

/** Calls that change the object handed over as their first argument. */
const WRITING_CALLS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf', 'freeze', 'seal', 'preventExtensions']);
/** Methods that change the object they are called on (arrays, maps, sets). */
const CHANGING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);

const SOLL = 90;
let gut = 0;
let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (ok) gut++;
  else fehler++;
}
const kurz = (pfad: string): string => {
  if (pfad.startsWith('paket:')) return pfad.slice(6);
  if (pfad.startsWith(QUELLEN + sep)) return relative(QUELLEN, pfad);
  const own = packageOf(pfad);
  return own ? `${own.name}/${relative(own.dir, pfad)}` : pfad;
};

// ── Reading sources ──────────────────────────────────────────────────

interface Quelle {
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
}

/** One source as a program of its own: names resolve inside the file, nothing is read from disk. */
function quelleAus(name: string, text: string): Quelle {
  const datei = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === name ? datei : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === name,
    readFile: (f) => (f === name ? text : undefined),
  };
  const programm = ts.createProgram(
    [name],
    { noResolve: true, noLib: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
    host
  );
  return { sf: programm.getSourceFile(name)!, checker: programm.getTypeChecker() };
}
function lies(pfad: string): Quelle | null {
  if (!existsSync(pfad) || !statSync(pfad).isFile()) return null;
  return quelleAus(pfad, readFileSync(pfad, 'utf-8'));
}
/** The syntax tree alone, for following imports: any script file, `null` for everything else (JSON, styles). */
function baum(pfad: string): ts.SourceFile | null {
  if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(pfad) || !existsSync(pfad) || !statSync(pfad).isFile()) return null;
  return ts.createSourceFile(pfad, readFileSync(pfad, 'utf-8'), ts.ScriptTarget.Latest, true);
}
const zeileVon = (sf: ts.SourceFile, n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

// ── Imports ──────────────────────────────────────────────────────────

interface Import {
  spez: string;
  /** Absolute path of the file, or `paket:<name>` for a package. */
  ziel: string;
  /** `false` only for forms that are certainly erased (`import type`, `export type`, a type query). */
  wert: boolean;
  zeile: number;
  /** Local names bound by this import, with the name they have in the module (`null` = the whole module). */
  bindungen: { lokal: string; fremd: string | null }[];
}

/** A package of this repository: its name, its directory and the file a bare import of it names. */
interface RepoPackage {
  name: string;
  dir: string;
  entry: string | null;
}

/** The packages of the repository, read from the workspaces of the root package.json (`dir/*` is every directory below). */
function repoPackages(root: string): RepoPackage[] {
  const json = (path: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
      return null; // no package.json, or not JSON: no package
    }
  };
  const workspaces = json(resolve(root, 'package.json'))?.['workspaces'];
  const listed: unknown = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages;
  const dirs: string[] = [];
  for (const entry of Array.isArray(listed) ? listed : []) {
    if (typeof entry !== 'string') continue;
    if (!entry.endsWith('/*')) dirs.push(resolve(root, entry));
    else {
      const above = resolve(root, entry.slice(0, -2));
      if (existsSync(above)) for (const name of readdirSync(above)) dirs.push(resolve(above, name));
    }
  }
  const found: RepoPackage[] = [];
  for (const dir of dirs) {
    const own = json(resolve(dir, 'package.json'));
    const name = own?.['name'];
    if (typeof name !== 'string' || name === '') continue;
    const main = [own?.['main'], own?.['module'], own?.['types']].find((m): m is string => typeof m === 'string');
    found.push({ name, dir: canonical(dir), entry: main === undefined ? null : resolve(canonical(dir), main) });
  }
  return found;
}
const REPO_PACKAGES: readonly RepoPackage[] = repoPackages(REPO);
const SHARED = '@wov/shared';

/** The package of the repository a specifier names (`@wov/client`, `@wov/client/src/…`), with the path below it. */
function packageNamed(spec: string): { own: RepoPackage; below: string } | null {
  for (const own of REPO_PACKAGES) {
    if (spec === own.name) return { own, below: '' };
    if (spec.startsWith(`${own.name}/`)) return { own, below: spec.slice(own.name.length + 1) };
  }
  return null;
}
/** The package of the repository a file lies in. */
function packageOf(path: string): RepoPackage | null {
  return REPO_PACKAGES.find((p) => path === p.dir || path.startsWith(p.dir + sep)) ?? null;
}
/** Does an import lead into the package with the registries? By its name, or as a file of that package. */
const ausShared = (ziel: string): boolean => /^paket:@wov\/shared(\/|$)/.test(ziel) || packageOf(ziel)?.name === SHARED;

function aufloesen(spez: string, von: string): string {
  const spec = spez.replace(/[?#].*$/, ''); // `./x?raw` still names the file x
  let roh: string;
  if (spec.startsWith('.')) roh = resolve(dirname(von), spec);
  else if (spec.startsWith('file:')) {
    try {
      roh = fileURLToPath(spec);
    } catch {
      return `paket:${spez}`; // not a path on this machine
    }
  } else if (isAbsolute(spec)) roh = resolve(spec);
  else {
    const named = packageNamed(spec);
    if (!named) return `paket:${spez}`;
    roh = named.below === '' ? (named.own.entry ?? resolve(named.own.dir, 'index')) : resolve(named.own.dir, named.below);
  }
  // A path through node_modules/<package of the repository>/ names the package's own directory.
  const marke = `${sep}node_modules${sep}`;
  const ab = roh.lastIndexOf(marke);
  if (ab >= 0) {
    const named = packageNamed(roh.slice(ab + marke.length).split(sep).join('/'));
    if (named) roh = named.below === '' ? named.own.dir : resolve(named.own.dir, named.below);
  }
  const kandidaten = [roh, `${roh}.ts`, `${roh}.tsx`, resolve(roh, 'index.ts'), roh.replace(/\.js$/, '.ts')];
  const treffer = kandidaten.find((k) => existsSync(k) && statSync(k).isFile());
  return treffer === undefined ? `${roh}.ts` : canonical(treffer);
}

function importeVon(sf: ts.SourceFile): Import[] {
  const aus: Import[] = [];
  const dazu = (spez: string, wert: boolean, n: ts.Node, bindungen: Import['bindungen'] = []): void => {
    aus.push({ spez, ziel: aufloesen(spez, sf.fileName), wert, zeile: zeileVon(sf, n), bindungen });
  };
  const geh = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const k = n.importClause;
      const bindungen: Import['bindungen'] = [];
      if (k?.name) bindungen.push({ lokal: k.name.text, fremd: 'default' });
      if (k?.namedBindings && ts.isNamespaceImport(k.namedBindings)) bindungen.push({ lokal: k.namedBindings.name.text, fremd: null });
      if (k?.namedBindings && ts.isNamedImports(k.namedBindings)) {
        for (const e of k.namedBindings.elements) bindungen.push({ lokal: e.name.text, fremd: (e.propertyName ?? e.name).text });
      }
      // `import { type A } from` is NOT counted as erased: what is left of it depends on the compiler settings.
      dazu(n.moduleSpecifier.text, !(k !== undefined && k.isTypeOnly), n, bindungen);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      dazu(n.moduleSpecifier.text, !n.isTypeOnly, n);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteralLike(n.moduleReference.expression)) {
      dazu(n.moduleReference.expression.text, !n.isTypeOnly, n, [{ lokal: n.name.text, fremd: null }]);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteralLike(n.argument.literal)) {
      dazu(n.argument.literal.text, false, n);
    } else if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const dynamisch = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const require = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (dynamisch || require) {
        const a = n.arguments[0]!;
        dazu(ts.isStringLiteralLike(a) ? a.text : `<${a.getText(sf)}>`, true, n);
      }
    }
    ts.forEachChild(n, geh);
  };
  geh(sf);
  return aus;
}

/** Everything reachable over imports inside the repository, the start files excluded; packages from outside are leaves. */
function huelle(start: readonly string[], nurWerte: boolean): Set<string> {
  const erreicht = new Set<string>();
  const offen = [...start];
  const gelesen = new Set<string>();
  while (offen.length > 0) {
    const pfad = offen.pop()!;
    if (gelesen.has(pfad)) continue;
    gelesen.add(pfad);
    const sf = pfad.startsWith('paket:') ? null : baum(pfad);
    if (!sf) continue;
    for (const i of importeVon(sf)) {
      if (nurWerte && !i.wert) continue;
      erreicht.add(i.ziel);
      offen.push(i.ziel);
    }
  }
  return erreicht;
}

// ── Load time ────────────────────────────────────────────────────────

const entpackt = (e: ts.Node): ts.Node => {
  let k = e;
  while (ts.isParenthesizedExpression(k) || ts.isAsExpression(k) || ts.isNonNullExpression(k) || ts.isSatisfiesExpression(k)) k = k.expression;
  return k;
};
const wurzelName = (e: ts.Node): ts.Identifier | null => {
  let k = entpackt(e);
  while (ts.isPropertyAccessExpression(k) || ts.isElementAccessExpression(k) || ts.isCallExpression(k)) k = entpackt(k.expression);
  return ts.isIdentifier(k) ? k : null;
};
const funktionenIn = (e: ts.Node): ts.Node[] => {
  const aus: ts.Node[] = [];
  const geh = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) aus.push(n);
    else ts.forEachChild(n, geh);
  };
  geh(e);
  return aus;
};

/** The nodes that run while the module is evaluated (see the header for what that includes). */
function ladeKnoten(q: Quelle): ts.Node[] {
  const { sf, checker } = q;
  const knoten: ts.Node[] = [];
  const erledigt = new Set<ts.Node>();
  const offen: ts.Node[] = [sf];
  const hinterName = (name: ts.Identifier): ts.Node[] => {
    const aus: ts.Node[] = [];
    for (const d of checker.getSymbolAtLocation(name)?.declarations ?? []) {
      if (ts.isFunctionDeclaration(d)) aus.push(d);
      else if (ts.isVariableDeclaration(d) && d.initializer) aus.push(...funktionenIn(d.initializer));
    }
    return aus;
  };
  while (offen.length > 0) {
    const wurzel = offen.pop()!;
    if (erledigt.has(wurzel)) continue;
    erledigt.add(wurzel);
    const lauf = (n: ts.Node): void => {
      if (n !== wurzel && ts.isFunctionLike(n)) return; // runs later, unless it is reached below
      if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return; // types do not run
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return; // looked at in [1]
      knoten.push(n);
      if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n)) {
        const ziel = entpackt(ts.isTaggedTemplateExpression(n) ? n.tag : n.expression);
        if (ts.isFunctionLike(ziel)) offen.push(ziel); // (() => ...)()
        else {
          const w = wurzelName(ziel);
          if (w) offen.push(...hinterName(w)); // f(), obj.f()
        }
        const argumente = ts.isTaggedTemplateExpression(n) ? [] : [...(n.arguments ?? [])];
        for (const roh of argumente) {
          const a = entpackt(roh);
          if (ts.isFunctionLike(a)) offen.push(a); // a callback: counted as called
          else if (ts.isIdentifier(a)) offen.push(...hinterName(a)); // a callback by name
        }
      }
      ts.forEachChild(n, lauf);
    };
    lauf(wurzel);
  }
  return knoten;
}

/** Is this identifier a name that is READ (not a property name, not the name of a declaration, not a label)? */
function istLesung(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return false;
  if (ts.isQualifiedName(p) && p.right === n) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === n) return false;
  if (ts.isBindingElement(p) && (p.propertyName === n || p.name === n)) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p) || ts.isTypeParameterDeclaration(p)) && p.name === n) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p) || ts.isMetaProperty(p)) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  return true;
}
function symbolVon(checker: ts.TypeChecker, n: ts.Identifier): ts.Symbol | undefined {
  if (ts.isShorthandPropertyAssignment(n.parent)) return checker.getShorthandAssignmentValueSymbol(n.parent);
  return checker.getSymbolAtLocation(n);
}
/** The import declaration a symbol comes from, if it is an imported binding. */
function importVon(s: ts.Symbol | undefined): ts.ImportDeclaration | ts.ImportEqualsDeclaration | null {
  for (const d of s?.declarations ?? []) {
    if (ts.isImportEqualsDeclaration(d)) return d;
    for (let k: ts.Node | undefined = d; k; k = k.parent) {
      if (ts.isImportDeclaration(k)) return k;
      if (ts.isSourceFile(k) || ts.isFunctionLike(k)) break;
    }
  }
  return null;
}
const zielVon = (d: ts.ImportDeclaration | ts.ImportEqualsDeclaration, sf: ts.SourceFile): string => {
  const spez = ts.isImportDeclaration(d) ? d.moduleSpecifier : ts.isExternalModuleReference(d.moduleReference) ? d.moduleReference.expression : undefined;
  return spez && ts.isStringLiteralLike(spez) ? aufloesen(spez.text, sf.fileName) : 'paket:?';
};

/** A write target without its wrappers: `(A as X).b!` is `A.b`. */
const bare = (e: ts.Node): ts.Node => {
  let k = e;
  while (ts.isParenthesizedExpression(k) || ts.isAsExpression(k) || ts.isNonNullExpression(k) || ts.isSatisfiesExpression(k) || ts.isTypeAssertionExpression(k)) k = k.expression;
  return k;
};
/** The places an assignment writes to: its left side, taken apart when it is a pattern (`[A.x, { y: B.z }] = …`). */
function assignmentTargets(left: ts.Node): ts.Node[] {
  const k = bare(left);
  if (ts.isArrayLiteralExpression(k)) return k.elements.flatMap((e) => assignmentTargets(ts.isSpreadElement(e) ? e.expression : e));
  if (ts.isObjectLiteralExpression(k)) {
    return k.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? assignmentTargets(p.initializer) : ts.isShorthandPropertyAssignment(p) ? [p.name] : ts.isSpreadAssignment(p) ? assignmentTargets(p.expression) : []));
  }
  if (ts.isBinaryExpression(k) && k.operatorToken.kind === ts.SyntaxKind.EqualsToken) return assignmentTargets(k.left); // a default inside a pattern
  return [k];
}
/** What a node writes to. `object: true` marks a target that is handed over as an object (the first argument of `Object.assign`). */
function writeTargets(n: ts.Node): { target: ts.Node; object: boolean }[] {
  const named = (l: ts.Node[]): { target: ts.Node; object: boolean }[] => l.map((target) => ({ target, object: false }));
  if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return named(assignmentTargets(n.left));
  if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) return named([bare(n.operand)]);
  if (ts.isDeleteExpression(n)) return named([bare(n.expression)]);
  if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) return named(assignmentTargets(n.initializer));
  if (ts.isCallExpression(n)) {
    const f = bare(n.expression);
    const name = ts.isPropertyAccessExpression(f) ? f.name.text : ts.isElementAccessExpression(f) && ts.isStringLiteralLike(f.argumentExpression) ? f.argumentExpression.text : ts.isIdentifier(f) ? f.text : null;
    if (name !== null && WRITING_CALLS.has(name) && n.arguments.length > 0) return [{ target: bare(n.arguments[0]!), object: true }];
    const receiver = ts.isPropertyAccessExpression(f) || ts.isElementAccessExpression(f) ? f.expression : null;
    if (name !== null && CHANGING_METHODS.has(name) && receiver) return [{ target: bare(receiver), object: true }];
  }
  return [];
}

interface LadeBefund {
  knoten: number;
  /** Every await: an await expression, `for await`, `await using`. */
  warten: string[];
  /** Awaits outside every function (top-level await in the narrow sense). */
  wartenOben: string[];
  /** Names read from the environment that are not pure built-ins, and `import.meta`. */
  umgebung: string[];
  /** Imported values read at load time that do not come from design.ts. */
  fremdeWerte: string[];
  /** Imported values read at load time, by name. */
  gelesen: Set<string>;
  /** Writes at load time to something that is imported, whatever module it comes from. */
  writes: string[];
}

function ladeBefund(q: Quelle): LadeBefund {
  const { sf, checker } = q;
  const wo = (n: ts.Node): string => `line ${zeileVon(sf, n)}: ${n.getText(sf).replace(/\s+/g, ' ').slice(0, 50)}`;
  const b: LadeBefund = { knoten: 0, warten: [], wartenOben: [], umgebung: [], fremdeWerte: [], gelesen: new Set(), writes: [] };
  const inFunktion = (n: ts.Node): boolean => {
    for (let k = n.parent; k; k = k.parent) if (ts.isFunctionLike(k)) return true;
    return false;
  };
  /** The imported name an object goes back to: the root of `A.b['c']`, also through local aliases (`const t = A.b;`, `const { b } = A;`). */
  const importedObject = (e: ts.Node, depth = 0): ts.Identifier | null => {
    let k = bare(e);
    while (ts.isPropertyAccessExpression(k) || ts.isElementAccessExpression(k)) k = bare(k.expression);
    if (!ts.isIdentifier(k)) return null;
    const s = symbolVon(checker, k);
    if (importVon(s)) return k;
    if (depth >= 4) return null;
    for (const d of s?.declarations ?? []) {
      let v: ts.Node = d;
      while (ts.isBindingElement(v) || ts.isObjectBindingPattern(v) || ts.isArrayBindingPattern(v)) v = v.parent;
      if (!ts.isVariableDeclaration(v) || !v.initializer) continue;
      const hinter = importedObject(v.initializer, depth + 1);
      if (hinter) return hinter;
    }
    return null;
  };
  const written = new Set<ts.Node>();
  for (const n of ladeKnoten(q)) {
    b.knoten++;
    for (const { target, object } of writeTargets(n)) {
      if (written.has(target)) continue; // a default inside a pattern is an assignment of its own
      // A bare name on the left of `=` is the binding; everything else is the object behind the name.
      const name = ts.isIdentifier(target) && !object ? (importVon(symbolVon(checker, target)) ? target : null) : importedObject(target);
      if (!name) continue;
      written.add(target);
      b.writes.push(`${wo(n)} writes to ${name.text}`);
    }
    const wartet =
      ts.isAwaitExpression(n) ||
      (ts.isForOfStatement(n) && n.awaitModifier !== undefined) ||
      (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.BlockScoped) === ts.NodeFlags.AwaitUsing);
    if (wartet) {
      b.warten.push(wo(n));
      if (!inFunktion(n)) b.wartenOben.push(wo(n));
    }
    if (ts.isMetaProperty(n)) b.umgebung.push(wo(n));
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) b.umgebung.push(wo(n));
    if (!ts.isIdentifier(n) || !istLesung(n)) continue;
    const s = symbolVon(checker, n);
    const imp = importVon(s);
    if (imp) {
      b.gelesen.add(n.text);
      if (zielVon(imp, sf) !== DESIGN) b.fremdeWerte.push(`${wo(n)} <- ${kurz(zielVon(imp, sf))}`);
    } else if ((s?.declarations ?? []).length === 0 && !REINE_GLOBALE.has(n.text)) {
      b.umgebung.push(wo(n));
    }
  }
  return b;
}

// ── The list of modules in an older test ─────────────────────────────

interface ListedModules {
  /** The texts of the list; `null` when the file has no such list at module level or it is not a plain list of texts. */
  names: string[] | null;
  /** How often the list is read. */
  reads: number;
}

function listedModules(sf: ts.SourceFile): ListedModules {
  let names: string[] | null = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== LIST_NAME || !d.initializer) continue;
      const list = bare(d.initializer);
      if (ts.isArrayLiteralExpression(list) && list.elements.every((e) => ts.isStringLiteralLike(e))) names = list.elements.map((e) => (ts.isStringLiteralLike(e) ? e.text : ''));
    }
  }
  let reads = 0;
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === LIST_NAME && istLesung(n)) reads++;
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { names, reads };
}
/** The modules of this test a list does not name. */
const missingIn = (l: ListedModules): string[] => MODULE.map((m): string => m.datei).filter((datei) => !(l.names ?? []).includes(datei));

// ── [0] The probe itself bites ───────────────────────────────────────
console.log(`Editor module boundary (reading ${EDITOR})`);
console.log('\n[0] The probe itself bites');
{
  const probe = (text: string): { imp: Import[]; lade: LadeBefund } => {
    const q = quelleAus(resolve(EDITOR, 'probe.ts'), text);
    return { imp: importeVon(q.sf), lade: ladeBefund(q) };
  };
  const werte = (text: string): string[] => probe(text).imp.filter((i) => i.wert).map((i) => i.spez);
  check('a value import is told from a type import', JSON.stringify(werte("import { F } from './design';\nimport type { A } from '@wov/shared';")) === JSON.stringify(['./design']));
  check(
    'these count as value imports: `import { type A }`, a bare import, `export * from`, `import()`, `require()`',
    JSON.stringify(werte("import { type A } from 'a';\nimport 'b';\nexport * from 'c';\nconst d = () => import('d');\nconst e = require('e');")) === JSON.stringify(['a', 'b', 'c', 'd', 'e'])
  );
  check("a type query `import('./editorMain').T` is an import of editorMain", probe("type T = import('./editorMain').X;").imp.some((i) => i.ziel === HAUPT && !i.wert));
  check('a top-level await is found', probe('declare function f(): Promise<number>;\nconst X = await f();').lade.wartenOben.length === 1);
  check('an await in a function that is only declared is not load time', probe('declare function f(): Promise<number>;\nconst g = async () => await f();').lade.warten.length === 0);
  check('an await in a function that is called while loading is found', probe('declare function f(): Promise<number>;\nconst g = async () => await f();\nvoid g();').lade.warten.length === 1);
  check('`for await` at the top is found', probe('declare const quelle: AsyncIterable<number>;\nfor await (const x of quelle) void x;').lade.wartenOben.length === 1);
  check('the environment is found at the top (`document`)', probe('const T = document.title;').lade.umgebung.length === 1);
  check('the environment is found in a callback (`fetch` inside `map`)', probe("const A = [1].map(() => fetch('x'));").lade.umgebung.length === 1);
  check('the environment is found behind a named function that is called', probe('const f = () => localStorage.length;\nconst B = f();').lade.umgebung.length === 1);
  check('the environment is found behind a method of a local object', probe('const o = { f: () => window.name };\nconst C = o.f();').lade.umgebung.length === 1);
  check('`import.meta` counts as environment', probe('const U = import.meta.url;').lade.umgebung.length === 1);
  check('the environment in a function that is only declared is not load time', probe('const g = () => document.title;\nfunction h() { return window.name; }').lade.umgebung.length === 0);
  check('pure built-ins, property names and types are not environment', probe('const X: HTMLElement | null = null;\nconst Y = Object.keys({ document: 1, fetch: 2 }).map((k) => Math.max(k.length, 0));').lade.umgebung.length === 0);
  check(
    'an imported value that is read while loading is found, by its module',
    probe("import { moduleRegistry } from '@wov/shared';\nconst N = moduleRegistry.registeredModules().length;").lade.fremdeWerte.length === 1 &&
      probe("import { BIOM_TON } from './design';\nconst N = BIOM_TON['x'];").lade.fremdeWerte.length === 0
  );
  // — an import is followed to the file, whatever the spelling —
  check(
    'an import through the name of the package is an import of editorMain (`@wov/client/src/editor/editorMain`), as a type and as a value',
    probe("import type { X } from '@wov/client/src/editor/editorMain';").imp.some((i) => i.ziel === HAUPT && !i.wert) &&
      probe("import { X } from '@wov/client/src/editor/editorMain';").imp.some((i) => i.ziel === HAUPT && i.wert)
  );
  const spellings = [
    './editorMain',
    './editorMain.ts',
    './editorMain.js',
    './seite/../editorMain',
    './editorMain?raw',
    '@wov/client/src/editor/editorMain.ts',
    '@wov/client/src/editor/editorMain.js',
    '@wov/client/src/../src/editor/editorMain',
    '../../../node_modules/@wov/client/src/editor/editorMain',
    HAUPT,
    HAUPT.replace(/\.ts$/, ''),
    pathToFileURL(HAUPT).href,
  ];
  const astray = spellings.filter((s) => aufloesen(s, resolve(EDITOR, 'probe.ts')) !== HAUPT);
  check(`every spelling that names editorMain.ts leads to it (${spellings.length} spellings: relative, package, node_modules, absolute, file URL, query)`, existsSync(HAUPT) && astray.length === 0, astray.join(' | '));
  const sharedEntry = aufloesen(SHARED, resolve(EDITOR, 'probe.ts'));
  check(
    `a package of the repository is resolved to its file, a package from outside stays a leaf (${REPO_PACKAGES.length} packages in the workspaces)`,
    existsSync(sharedEntry) && ausShared(sharedEntry) && ausShared(aufloesen(`${SHARED}/src/nothing-here`, HAUPT)) && !ausShared(aufloesen('@wov/sharedx/src/index', HAUPT)) && aufloesen('typescript', HAUPT) === 'paket:typescript',
    `${SHARED} -> ${sharedEntry}`
  );
  // — writes while loading —
  const writes = (text: string): number => probe(`import { BIOM_TON, F } from './design';\n${text}`).lade.writes.length;
  check(
    'a write to a member of an imported name is found: `=`, `+=`, `++`, `delete`, an element access, a pattern, a `for … of` variable',
    writes("BIOM_TON.x = ['a', 'b'];") === 1 && writes("F.a += 'x';") === 1 && writes('F.n++;\n--F.n;') === 2 && writes('delete F.a;') === 1 && writes("(BIOM_TON as never)['x']! = 1;") === 1 && writes('[F.a, { b: F.b }, F.c = 1] = [1, { b: 2 }];') === 3 && writes('for (F.a of [1, 2]) void 0;') === 1
  );
  check(
    'assign, defineProperty, defineProperties, setPrototypeOf, freeze, seal and preventExtensions on an imported name are found',
    writes("Object.assign(F, { a: 'x' });") === 1 && writes("Object.defineProperty(F, 'a', { value: 1 });") === 1 && writes('Object.defineProperties(F, {});') === 1 && writes('Object.setPrototypeOf(BIOM_TON, null);') === 1 && writes('Object.freeze(F);') === 1 && writes('Object.seal(F.a);') === 1 && writes('Object.preventExtensions(F);') === 1 && writes("const { assign } = Object;\nassign(F, { a: 'x' });") === 1
  );
  check(
    'a method that changes its object is found on an imported name (`push`, `reverse`, `set`), one that does not (`slice`, `map`) is not',
    writes("BIOM_TON.x.push('a');") === 1 && writes('BIOM_TON.x.reverse();') === 1 && writes("const m = F.a;\nm['set'](1, 2);") === 1 && writes('const a = BIOM_TON.x.slice();\na.reverse();\nconst b = BIOM_TON.x.map((t: string) => t);\nb.push(F.a);') === 0
  );
  check(
    'a write in a function that runs while loading is found, in a function that is only declared it is not',
    writes('const f = () => {\n  F.a = 1;\n};\nf();') === 1 && writes('[1].forEach(() => {\n  delete BIOM_TON.x;\n});') === 1 && writes('const f = () => {\n  F.a = 1;\n};\nfunction g() {\n  Object.assign(F, {});\n}') === 0
  );
  check(
    'a write through a local alias is found; a write to a copy, to a local object and a plain read are not',
    writes('const t = BIOM_TON;\nt.x = 1;') === 1 && writes('const t = BIOM_TON.x;\nconst u = t;\nu[0] = 1;') === 1 && writes('const { a } = F;\nObject.assign(a, {});') === 1 && writes('const k = { ...F };\nk.a = 1;\nconst l = [F.a];\nl[0] = 2;\nlet m = F.a;\nm = 3;\nconst o = { a: 1 };\no.a = 2;\nObject.assign(o, F);\nvoid [BIOM_TON.x, m];') === 0
  );
  // — the list of modules in an older test —
  const listed = (text: string): ListedModules => listedModules(ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  const full = MODULE.map((m) => `'${m.datei}'`).join(', ');
  check(
    'a test that names every module and reads its list is accepted; one module less, or a list nobody reads, is not',
    missingIn(listed(`const ${LIST_NAME} = [${full}];\nfor (const f of ${LIST_NAME}) void f;`)).length === 0 &&
      JSON.stringify(missingIn(listed(`const ${LIST_NAME} = [${MODULE.slice(1).map((m) => `'${m.datei}'`).join(', ')}] as const;\nfor (const f of ${LIST_NAME}) void f;`))) === JSON.stringify([MODULE[0].datei]) &&
      listed(`const ${LIST_NAME} = [${full}];`).reads === 0
  );
  check(
    'a list that is no list of texts, a list inside a function, a name in a comment and no list at all do not count',
    listed(`const ${LIST_NAME} = [${full}].filter(() => false);`).names === null &&
      listed(`function f() {\n  const ${LIST_NAME} = [${full}];\n  return ${LIST_NAME};\n}`).names === null &&
      listed(`// ${LIST_NAME} = [${full}]\nconst OTHER = [${full}];`).names === null &&
      listed('').names === null
  );
}

// ── [1] Imports ──────────────────────────────────────────────────────
console.log('\n[1] Imports of the three modules');
const quellen = new Map<string, Quelle | null>(MODULE.map((m) => [m.datei, lies(pfadVon(m.datei))]));
for (const m of MODULE) {
  const q = quellen.get(m.datei) ?? null;
  check(`${m.datei}: the file is there`, q !== null, pfadVon(m.datei));
  const imp = q ? importeVon(q.sf) : [];
  const werte = imp.filter((i) => i.wert);
  const zeige = (l: Import[]): string => l.map((i) => `line ${i.zeile}: '${i.spez}'`).join(' | ');
  const fremd = werte.filter((i) => i.ziel !== DESIGN);
  check(`${m.datei}: values are imported from design.ts only, everything else is \`import type\` (${werte.length} value, ${imp.length - werte.length} type)`, q !== null && fremd.length === 0, zeige(fremd));
  const registry = werte.filter((i) => ausShared(i.ziel) || i.ziel.startsWith(NETZ));
  check(`${m.datei}: no value import from @wov/shared and none from client/src/net/ (the registries)`, q !== null && registry.length === 0, zeige(registry));
  const haupt = imp.filter((i) => i.ziel === HAUPT);
  check(`${m.datei}: editorMain is never imported, not even as a type`, q !== null && haupt.length === 0, zeige(haupt));
}
{
  const alleDa = MODULE.every((m) => quellen.get(m.datei));
  const werte = [...huelle(MODUL_PFADE, true)];
  check(
    `the value imports of the three modules end in design.ts, and design.ts imports no value (reached: ${werte.slice(0, 6).map(kurz).join(', ') || 'nothing'}${werte.length > 6 ? ` and ${werte.length - 6} more` : ''})`,
    alleDa && werte.length === 1 && werte[0] === DESIGN
  );
  // What the three import, type or value, and everything behind it: none of it may come back.
  const direkt = MODUL_PFADE.flatMap((p) => {
    const sf = baum(p);
    return sf ? importeVon(sf).map((i) => i.ziel) : [];
  });
  const hinten = new Set([...direkt, ...huelle(direkt, false)]);
  const zurueck = [HAUPT, ...MODUL_PFADE].filter((p) => hinten.has(p));
  check(
    `no import cycle: nothing the three modules import leads back to editorMain.ts or to one of them (${hinten.size} modules behind them)`,
    alleDa && direkt.length > 0 && zurueck.length === 0,
    zurueck.map(kurz).join(', ')
  );
}

// ── [2] Load time ────────────────────────────────────────────────────
console.log('\n[2] What runs while the three modules load');
for (const m of MODULE) {
  const q = quellen.get(m.datei) ?? null;
  const b = q ? ladeBefund(q) : null;
  check(`${m.datei}: no await at module level`, b !== null && b.wartenOben.length === 0, b?.wartenOben.join(' | '));
  check(`${m.datei}: no await in anything that runs while loading (${b?.knoten ?? 0} nodes looked at)`, b !== null && b.knoten > 0 && b.warten.length === 0, b?.warten.join(' | '));
  check(`${m.datei}: nothing is read from the environment while loading (only pure built-ins)`, b !== null && b.umgebung.length === 0, b?.umgebung.join(' | '));
  check(`${m.datei}: imported values read while loading come from design.ts, so no registry function is called`, b !== null && b.fremdeWerte.length === 0, b?.fremdeWerte.join(' | '));
  check(`${m.datei}: nothing that is imported is written to while loading (the tables of design.ts stay as they are)`, b !== null && b.writes.length === 0, b?.writes.join(' | '));
}
{
  // Guards against a walk that sees nothing: BIOME_FARBE is built while loading, through a callback and `biomTon`.
  const q = quellen.get('biome.ts') ?? null;
  const gelesen = q ? [...ladeBefund(q).gelesen].sort() : [];
  check(`biome.ts: the walk follows the callback and \`biomTon\` down to the tables of design.ts (read while loading: ${gelesen.join(', ') || 'nothing'})`, gelesen.includes('BIOM_TON') && gelesen.includes('F'));
}

// ── [3] editorMain.ts ────────────────────────────────────────────────
console.log('\n[3] editorMain.ts');
{
  const q = lies(HAUPT);
  check('editorMain.ts: the file is there', q !== null);
  const sf = q?.sf;
  const deklariert: string[] = [];
  const benutzt = new Map<string, number>();
  const falsch: string[] = [];
  if (q && sf) {
    const geh = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n) && ELF.includes(n.text)) {
        const s = symbolVon(q.checker, n);
        const imp = importVon(s);
        if (!istLesung(n)) {
          // a property name is nobody's business; the name of a declaration is
          const p = n.parent;
          const istEigenschaft = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n);
          if (!istEigenschaft) deklariert.push(`${n.text} (line ${zeileVon(sf, n)})`);
        } else {
          const soll = pfadVon(MODULE.find((m) => (m.namen as readonly string[]).includes(n.text))!.datei);
          const ziel = imp ? zielVon(imp, sf) : null;
          if (ziel === soll) benutzt.set(n.text, (benutzt.get(n.text) ?? 0) + 1);
          else falsch.push(`${n.text} (line ${zeileVon(sf, n)}): ${ziel ? `imported from ${kurz(ziel)}` : 'not imported'}`);
        }
      }
      ts.forEachChild(n, geh);
    };
    geh(sf);
  }
  check('editorMain.ts declares none of the eleven names itself (module level, functions, parameters)', q !== null && deklariert.length === 0, deklariert.join(' | '));
  const stellen = [...benutzt.values()].reduce((a, b) => a + b, 0);
  check(
    `editorMain.ts: every use of one of the eleven names is an import from the module that declares it (${benutzt.size} names, ${stellen} places)`,
    q !== null && stellen > 0 && falsch.length === 0,
    falsch.join(' | ')
  );
  for (const m of MODULE) {
    const mq = quellen.get(m.datei) ?? null;
    const exportiert = new Set<string>();
    for (const st of mq?.sf.statements ?? []) {
      if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) exportiert.add(e.name.text);
      } else if (ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((x) => x.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) exportiert.add(d.name.text);
        if ((ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st)) && st.name) exportiert.add(st.name.text);
      }
    }
    const imp = sf ? importeVon(sf).filter((i) => i.ziel === pfadVon(m.datei)) : [];
    const bindungen = imp.flatMap((i) => i.bindungen);
    const schief = bindungen.filter((b) => b.fremd !== b.lokal || !(m.namen as readonly string[]).includes(b.lokal) || !exportiert.has(b.lokal));
    check(
      `editorMain.ts imports from ${m.datei} by name, without alias, only what the module exports (${bindungen.map((b) => b.lokal).join(', ') || 'nothing'})`,
      mq !== null && bindungen.length > 0 && schief.length === 0,
      schief.map((b) => `${b.fremd ?? '*'} as ${b.lokal}`).join(' | ')
    );
    const tot = bindungen.filter((b) => !benutzt.has(b.lokal));
    check(`editorMain.ts uses every name it imports from ${m.datei}`, mq !== null && bindungen.length > 0 && tot.length === 0, tot.map((b) => b.lokal).join(', '));
  }
}

// ── [4] Behaviour without a browser ──────────────────────────────────
console.log('\n[4] Behaviour (loaded without a browser)');
{
  const welt = globalThis as { document?: unknown; window?: unknown };
  check('this run has no browser: no `document`, no `window`', welt.document === undefined && welt.window === undefined);
  const lade = async <T>(datei: string): Promise<T | null> => {
    try {
      return (await import(pfadVon(datei))) as T;
    } catch (e) {
      console.log(`  (${datei} does not load: ${String((e as Error).message).split('\n')[0]})`);
      return null;
    }
  };
  const design = await lade<typeof import('../src/editor/design')>('design.ts');
  const biome = await lade<typeof import('../src/editor/biome')>('biome.ts');
  const formen = await lade<typeof import('../src/editor/formen')>('formen.ts');
  const helfer = await lade<typeof import('../src/editor/seite/helfer')>('seite/helfer.ts');

  // — biome.ts —
  check('biome.ts loads without a browser', biome !== null && design !== null);
  const bq = quellen.get('biome.ts') ?? null;
  const namen: string[] = [];
  for (const st of bq?.sf.statements ?? []) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === 'BIOME_NAMEN' && d.initializer && ts.isArrayLiteralExpression(d.initializer)) {
        for (const e of d.initializer.elements) namen.push(ts.isStringLiteralLike(e) ? e.text : `<${e.getText(bq!.sf)}>`);
      }
    }
  }
  check(`BIOME_NAMEN has eight entries, all different (read from the syntax tree: ${namen.join(', ')})`, namen.length === 8 && new Set(namen).size === 8);
  if (biome && design) {
    const farben = biome.BIOME_FARBE as Record<string, string>;
    const ton = biome.biomTon as (b: string) => readonly [string, string];
    check('BIOME_FARBE has a value for each of them, and for nothing else', JSON.stringify(Object.keys(farben).sort()) === JSON.stringify([...namen].sort()), Object.keys(farben).join(','));
    check('… each value is the OUTLINE tone of design.ts (`BIOM_TON[b][1]`), a colour', namen.length === 8 && namen.every((b) => /^#[0-9a-f]{6}$/i.test(farben[b] ?? '') && farben[b] === design.BIOM_TON[b]?.[1]));
    check('biomTon gives the pair of design.ts, fill first', namen.length === 8 && namen.every((b) => ton(b) === design.BIOM_TON[b]));
    check('biomTon falls back to two greys for a biome without a tone', JSON.stringify(ton('no-such-biome')) === JSON.stringify([design.F.gedimmt3, design.F.gedimmt]));
  } else {
    for (let i = 0; i < 4; i++) check('biome.ts: behaviour could not be checked (module did not load)', false);
  }

  // — formen.ts —
  check('formen.ts loads without a browser', formen !== null);
  if (formen) {
    const F = formen.FORMEN;
    check(`FORMEN has six entries: kreis, oval, langinsel, halbmond, zacken, plateau (${F.map((f) => f.id).join(', ')})`, JSON.stringify(F.map((f) => f.id)) === JSON.stringify(['kreis', 'oval', 'langinsel', 'halbmond', 'zacken', 'plateau']));
    const kreis = F[0]!.erzeuge(10.4, 20.6, 99.5);
    check('FORMEN[0].erzeuge(10.4, 20.6, 99.5) is a circle with x 10, z 21, radius 100', JSON.stringify(kreis) === JSON.stringify({ kind: 'circle', x: 10, z: 21, radius: 100 }), JSON.stringify(kreis));
    const punkte = F.slice(1).map((f) => {
      const s = f.erzeuge(1000, -2000, 300);
      return s.kind === 'polygon' ? s.points : null;
    });
    check(`the other five are polygons with 24, 28, 30, 26 and 20 points (${punkte.map((p) => p?.length ?? 'no polygon').join(', ')})`, JSON.stringify(punkte.map((p) => p?.length ?? -1)) === JSON.stringify([24, 28, 30, 26, 20]));
    check('… with whole numbers, within 3 x size around the click', punkte.every((p) => p !== null && p.every(([x, z]) => Number.isInteger(x) && Number.isInteger(z) && Math.hypot(x - 1000, z + 2000) <= 900)));
    check('every name is a symbol, a blank and a word (the editor cuts the symbol off for its list)', F.every((f) => /^\S+\s+\S/.test(f.name) && f.name.replace(/^\S+\s+/, '').length > 0), F.map((f) => f.name).join(' | '));
  } else {
    for (let i = 0; i < 5; i++) check('formen.ts: behaviour could not be checked (module did not load)', false);
  }

  // — seite/helfer.ts —
  check('seite/helfer.ts loads without a browser (nothing touches the page while loading)', helfer !== null);
  if (helfer && design) {
    const host = helfer.seitenHost;
    check('seitenHost has exactly hinweis, beschriftet and breiterKnopf, and hinweis IS hinweisZeile', JSON.stringify(Object.keys(host).sort()) === JSON.stringify(['beschriftet', 'breiterKnopf', 'hinweis']) && host.hinweis === helfer.hinweisZeile);
    // A page of six lines: enough for design.ts to build an element.
    class Knoten {
      readonly style: Record<string, unknown> = { cssText: '', getPropertyValue: () => '', setProperty: () => undefined };
      readonly dataset: Record<string, string> = {};
      readonly kinder: unknown[] = [];
      textContent: string | null = null;
      innerHTML = '';
      title = '';
      onclick: (() => void) | null = null;
      constructor(readonly tag: string) {}
      appendChild(k: unknown): unknown {
        this.kinder.push(k);
        return k;
      }
      append(...k: unknown[]): void {
        this.kinder.push(...k);
      }
      setAttribute(): void {}
      addEventListener(): void {}
    }
    welt.document = { createElement: (t: string) => new Knoten(t), createElementNS: (_ns: string, t: string) => new Knoten(t) };
    try {
      const cb = (): void => undefined;
      const als = (x: unknown): Knoten => x as Knoten;
      const knopf = als(helfer.breiterKnopf('Wide', cb, design.PFAD.haken));
      check('breiterKnopf: a button over the full width, 12px, with icon and label, that calls back', knopf.tag === 'button' && knopf.style['width'] === '100%' && knopf.style['fontSize'] === '12px' && knopf.kinder.length === 2 && als(knopf.kinder[0]).tag === 'svg' && als(knopf.kinder[1]).textContent === 'Wide' && knopf.onclick === cb);
      check('… in the small height of the sidebar', String(knopf.style['cssText']).includes(`height:${design.M.knopfHoeheKlein}px`), String(knopf.style['cssText']));
      const zeile = als(helfer.hinweisZeile('Hint'));
      check('hinweisZeile: a dimmed line of 11px with the text', zeile.tag === 'div' && zeile.textContent === 'Hint' && String(zeile.style['cssText']).includes('font-size:11px') && String(zeile.style['cssText']).includes(`color:${design.F.gedimmt}`), String(zeile.style['cssText']));
      const inhalt = new Knoten('input');
      const block = als(host.beschriftet('Label', inhalt as unknown as HTMLElement));
      check('seitenHost.beschriftet: a column with the label above the control', block.tag === 'div' && String(block.style['cssText']).includes('flex-direction:column') && block.kinder.length === 2 && als(block.kinder[0]).tag === 'span' && als(block.kinder[0]).textContent === 'Label' && block.kinder[1] === inhalt);
      const zweiter = als(host.breiterKnopf('Host', cb));
      check('seitenHost.breiterKnopf and seitenHost.hinweis build the same as the functions', zweiter.tag === 'button' && zweiter.style['width'] === '100%' && zweiter.kinder.length === 1 && als(host.hinweis('H')).textContent === 'H');
    } finally {
      delete welt.document;
    }
  } else {
    for (let i = 0; i < 6; i++) check('seite/helfer.ts: behaviour could not be checked (module did not load)', false);
  }
}

// ── [5] The boundaries of older tests ────────────────────────────────
console.log('\n[5] Older tests with a boundary on editorMain.ts as a whole read the modules as well');
for (const name of BOUNDARY_TESTS) {
  const sf = baum(resolve(HIER, name));
  const list: ListedModules = sf ? listedModules(sf) : { names: null, reads: 0 };
  const missing = missingIn(list);
  const todo =
    sf === null
      ? `client/test/${name} is not there`
      : list.names === null
        ? `client/test/${name} has no list \`const ${LIST_NAME} = ['…', …];\` at module level. Declare it with ${MODULE.map((m) => m.datei).join(', ')} and run every boundary check on editorMain.ts as a whole on each of these files as well`
        : missing.length > 0
          ? `missing: ${missing.join(', ')}. Add to ${LIST_NAME} in client/test/${name}: its boundary checks then run on the new module as well, and SOLL there grows with them. Then break each boundary once in the new module and see its check turn red`
          : `${LIST_NAME} in client/test/${name} is never read. Run every boundary check on editorMain.ts as a whole on each file of the list`;
  check(
    `${name} names every module of this test in ${LIST_NAME} and reads the list (${list.names === null ? 'no list' : list.names.join(', ') || 'empty'}; read ${list.reads} time(s))`,
    sf !== null && missing.length === 0 && list.reads > 0,
    todo
  );
}

if (gut + fehler !== SOLL) {
  console.log(`  ✗ expected ${SOLL} checks, ran ${gut + fehler}`);
  fehler++;
}
console.log(fehler === 0 ? `\nOK (${gut} checks)` : `\n${fehler} FAILED (${gut} passed)`);
process.exit(fehler === 0 ? 0 : 1);
