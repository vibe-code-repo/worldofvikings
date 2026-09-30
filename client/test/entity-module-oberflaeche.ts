/**
 * Refactor N1: what stood before and behind the class in EntityManager.ts lives in seven modules next to it
 * (konstanten, typen, lod, toenung, zellMesh, zdoMatrix, platzhalter). This test holds what the move promised.
 *
 *  [1] Surface: every name that other files import from EntityManager.ts is still exported there, as a re-export
 *      of its module. A value is THE SAME object as the export of the module; the two types are identical (the
 *      compiler checks that, see TYPES_EQUAL).
 *  [2] State: each of the eight module-level state holders is declared exactly once at module level in all .ts
 *      files under client/src (syntax tree). A second copy would show only in the picture: wrong tint, missing
 *      shadows.
 *  [3] Direction: none of the modules imports EntityManager.ts, neither as a value nor as a type; there is no
 *      import cycle among them; no chain of value imports leads from one of them back to EntityManager.ts.
 *      The one exception is kontext.ts (see below): it names the class, and only as a type.
 *  [4] Behaviour of the pure functions, with the numbers measured on the state before the move.
 *
 * Refactor N2: the four methods of the spatial index became functions with a context in raumIndex.ts
 * (`k` is the instance, `this` became `k`); the class keeps a forwarding method for each. kontext.ts holds the
 * context type, a `Pick` on the class. Both files stand in the list of modules, parts [1] and [3] hold for them.
 *
 *  [5] Loading: a module of former methods holds only imports, types, function declarations and the export
 *      list, so loading it does nothing.
 *  [6] Forwarding: each former method is still a method of the prototype (not a field), its body is the one
 *      statement `return <name>(this, <its parameters>)`, and the module exports exactly these functions. The
 *      context of the module names exactly the members its functions use.
 *  [7] Behaviour of the spatial index: a fixed sequence of 200 calls against a stub of the context and, through
 *      the forwarding methods, against a real instance. The numbers were measured on the state before the move,
 *      with the methods of the class called on the same stub.
 *
 * DOM-free, no scene, no assets.
 * Run: npx tsx client/test/entity-module-oberflaeche.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import type { DynamischeInstanz as DynamicViaManager, StatischeInstanz as StaticViaManager } from '../src/entities/EntityManager';
import type { DynamischeInstanz as DynamicInModule, StatischeInstanz as StaticInModule } from '../src/entities/typen';
import type { IndexEintrag } from '../src/entities/typen';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const ENTITIES = join(SRC, 'entities');
const MANAGER = join(ENTITIES, 'EntityManager.ts');
const MODULES = ['konstanten', 'typen', 'lod', 'toenung', 'zellMesh', 'zdoMatrix', 'platzhalter', 'raumIndex', 'kontext'] as const;
type ModuleName = (typeof MODULES)[number];
const fileOf = (name: ModuleName): string => join(ENTITIES, `${name}.ts`);
const short = (file: string): string => relative(SRC, file).replaceAll('\\', '/');

/** The one module that may name EntityManager.ts, and only as a type: it hands the class on as a context type. */
const CONTEXT_MODULE: ModuleName = 'kontext';
/** The modules whose functions were methods of the class, with the methods each of them took over. */
const FORMER_METHODS: Readonly<Partial<Record<ModuleName, readonly string[]>>> = {
  raumIndex: ['nearbyInstances', 'indexSetzen', 'ausZelleLoesen', 'indexEntfernen'],
};
type SpatialIndex = typeof import('../src/entities/raumIndex');
type ManagerModule = typeof import('../src/entities/EntityManager');

/** Identity of two types at compile time: this file does not translate when a re-exported type differs. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const TYPES_EQUAL: [Same<StaticViaManager, StaticInModule>, Same<DynamicViaManager, DynamicInModule>] = [true, true];

/** The names other files import from EntityManager.ts, and the module each of them lives in. */
const VALUES: Readonly<Record<string, ModuleName>> = {
  vegetationsMatrizenImRadius: 'konstanten',
  huellkoerperAufweiten: 'lod',
  INSTANZ_TOENUNG_AN: 'toenung',
  TOENUNG_LUMA: 'toenung',
  TOENUNG_TON: 'toenung',
  toenungsRauschen: 'toenung',
  instanzToenung: 'toenung',
  groessteInstanzSkala: 'zellMesh',
  gemesseneModellHoehe: 'zellMesh',
  alsOrtsfestEinfrieren: 'zellMesh',
  zellMeshAusPrototyp: 'zellMesh',
};
const TYPES: Readonly<Record<string, ModuleName>> = {
  StatischeInstanz: 'typen',
  DynamischeInstanz: 'typen',
};

/** Reused work objects and caches on module level: a copy in a second file would be a second state. */
const STATE = [
  'GANG_NICK_TMP',
  'LOD_MITTE_TMP',
  'RESERVE_MIN_TMP',
  'RESERVE_MAX_TMP',
  'TOENUNGS_PUFFER',
  'MODELL_HOEHE',
  'ZELL_GEOMETRIE',
  'platzhalterMaterialien',
] as const;

type Loaded = Record<string, unknown>;
async function load(file: string): Promise<{ module: Loaded | null; error: string }> {
  if (!existsSync(file)) return { module: null, error: `${short(file)} does not exist` };
  try {
    return { module: (await import(pathToFileURL(file).href)) as Loaded, error: '' };
  } catch (e) {
    return { module: null, error: `${short(file)} does not load: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` };
  }
}
const parse = (file: string, text = readFileSync(file, 'utf8')): ts.SourceFile => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Every module a file names, with the way it names it. `typeOnly` is what the compiler removes without a trace. */
function importsOf(sf: ts.SourceFile): { spec: string; typeOnly: boolean; line: number }[] {
  const found: { spec: string; typeOnly: boolean; line: number }[] = [];
  const add = (node: ts.Node, spec: string, typeOnly: boolean): void => {
    found.push({ spec, typeOnly, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const clause = n.importClause;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
      const onlyTypes = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== undefined && named.length > 0 && named.every((e) => e.isTypeOnly)));
      add(n, n.moduleSpecifier.text, onlyTypes);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      add(n, n.moduleSpecifier.text, n.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) {
      add(n, n.moduleReference.expression.text, n.isTypeOnly);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      add(n, n.argument.literal.text, true);
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]!)) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) add(n, n.arguments[0]!.text, false);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The source file a relative module name stands for, or null (a package, or nothing on disk). */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  const bare = base.replace(/\.(?:js|mjs|ts|mts)$/, '');
  for (const candidate of [base, `${bare}.ts`, `${bare}.mts`, join(bare, 'index.ts')]) {
    if (/\.m?ts$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}
/** Does a module name end in EntityManager, in any spelling: relative, with an ending, or through a package name? */
const namesManager = (spec: string): boolean => /(?:^|\/)EntityManager(?:\.(?:js|mjs|cjs|ts|mts|cts))?$/.test(spec);

// ── [1] Surface ──────────────────────────────────────────────────────────────
console.log('[1] Surface: EntityManager.ts still exports every name that other files import from it');
{
  const manager = await load(MANAGER);
  check('EntityManager.ts loads and exports the class', typeof manager.module?.EntityManager === 'function', manager.error);
  const modules = new Map<ModuleName, Loaded | null>();
  for (const name of MODULES) {
    const m = await load(fileOf(name));
    modules.set(name, m.module);
    check(`module ${name}.ts loads`, m.module !== null, m.error);
  }
  // The re-exports as written in EntityManager.ts: name -> module it is taken from.
  const reExports = new Map<string, { from: string; typeOnly: boolean }>();
  for (const st of parse(MANAGER).statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const e of st.exportClause.elements) reExports.set(e.name.text, { from: st.moduleSpecifier.text, typeOnly: st.isTypeOnly || e.isTypeOnly });
  }
  for (const [name, home] of Object.entries(VALUES)) {
    const viaManager = manager.module?.[name];
    const inModule = modules.get(home)?.[name];
    check(
      `${name}: exported by EntityManager.ts and the same object as in ${home}.ts`,
      viaManager !== undefined && inModule !== undefined && viaManager === inModule,
      `EntityManager: ${typeof viaManager}, ${home}: ${typeof inModule}`
    );
    const written = reExports.get(name);
    check(`${name}: written as a re-export from './${home}'`, written?.from === `./${home}` && written.typeOnly === false, JSON.stringify(written ?? null));
  }
  for (const [name, home] of Object.entries(TYPES)) {
    const written = reExports.get(name);
    check(`type ${name}: written as a type re-export from './${home}'`, written?.from === `./${home}` && written.typeOnly === true, JSON.stringify(written ?? null));
  }
  check('the two types are identical on both paths (compile time)', TYPES_EQUAL.every((same) => same === true));
  check('13 names in all', Object.keys(VALUES).length + Object.keys(TYPES).length === 13);
}

// ── [2] State exists once ────────────────────────────────────────────────────
console.log('\n[2] State: each module-level state holder is declared exactly once under client/src');
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(SRC);
  files.sort();
  check(`${files.length} .ts files under client/src read, EntityManager.ts among them`, files.length > 100 && files.includes(MANAGER));

  const places = new Map<string, string[]>();
  const note = (sf: ts.SourceFile, name: ts.Node, file: string): void => {
    if (ts.isIdentifier(name)) {
      const at = `${short(file)}:${sf.getLineAndCharacterOfPosition(name.getStart(sf)).line + 1}`;
      places.set(name.text, [...(places.get(name.text) ?? []), at]);
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const e of name.elements) if (ts.isBindingElement(e)) note(sf, e.name, file);
    }
  };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!STATE.some((name) => text.includes(name))) continue;
    const sf = parse(file, text);
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) note(sf, d.name, file);
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) note(sf, st.name, file);
    }
  }
  for (const name of STATE) {
    const at = places.get(name) ?? [];
    check(`${name}: one declaration at module level`, at.length === 1, at.join(', ') || 'none');
  }
}

// ── [3] Direction ────────────────────────────────────────────────────────────
console.log('\n[3] Direction: the modules do not know EntityManager.ts');
{
  const present = MODULES.filter((name) => existsSync(fileOf(name)));
  check(`all ${MODULES.length} modules exist`, present.length === MODULES.length, `missing: ${MODULES.filter((n) => !present.includes(n)).join(', ') || 'none'}`);

  const among = new Map<string, string[]>();
  for (const name of present) {
    const file = fileOf(name);
    const imports = importsOf(parse(file));
    const toManager = imports.filter((i) => resolveImport(file, i.spec) === MANAGER);
    const lines = (found: typeof imports): string => found.map((i) => `line ${i.line}${i.typeOnly ? ' (type)' : ''}`).join(', ');
    if (name === CONTEXT_MODULE) {
      // The exception: this module hands the class on as a context type. As a value it would close a cycle at run time.
      check(`${name}.ts names EntityManager.ts only as a type`, toManager.length > 0 && toManager.every((i) => i.typeOnly), lines(toManager) || 'not at all');
    } else {
      check(`${name}.ts does not import EntityManager.ts, neither as a value nor as a type`, toManager.length === 0, lines(toManager));
    }
    // The same in any spelling: a package name or an unusual ending reaches the same file.
    const spelled = imports.filter((i) => namesManager(i.spec) && !(name === CONTEXT_MODULE && i.typeOnly));
    check(`${name}.ts names no module EntityManager in any spelling${name === CONTEXT_MODULE ? ', except as a type' : ''}`, spelled.length === 0, spelled.map((i) => `line ${i.line} '${i.spec}'`).join(', '));
    among.set(
      file,
      imports.map((i) => resolveImport(file, i.spec)).filter((target): target is string => target !== null && present.some((n) => fileOf(n) === target))
    );
  }
  // A cycle among the modules, imports of any kind.
  const cycles: string[] = [];
  const state = new Map<string, 'open' | 'done'>();
  const visit = (file: string, path: string[]): void => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'open') {
      cycles.push([...path.slice(path.indexOf(file)), file].map(short).join(' -> '));
      return;
    }
    state.set(file, 'open');
    for (const next of among.get(file) ?? []) visit(next, [...path, file]);
    state.set(file, 'done');
  };
  for (const name of present) visit(fileOf(name), []);
  check('no import cycle among the modules', present.length === MODULES.length && cycles.length === 0, cycles.join(' | '));
  const edges = [...among].flatMap(([from, targets]) => [...new Set(targets)].map((to) => `${short(from)} -> ${short(to)}`));
  console.log(`        imports among the modules: ${edges.join(', ') || 'none'}`);

  // No chain of value imports leads back: what the modules load at run time never loads EntityManager.ts.
  const seen = new Set<string>();
  const chainTo = new Map<string, string>();
  const queue = present.map((name) => fileOf(name));
  for (const start of queue) seen.add(start);
  let back = '';
  while (queue.length > 0 && back === '') {
    const file = queue.shift()!;
    for (const i of importsOf(parse(file))) {
      if (i.typeOnly) continue;
      const target = resolveImport(file, i.spec);
      if (target === null || seen.has(target)) continue;
      seen.add(target);
      chainTo.set(target, file);
      if (target === MANAGER) {
        const chain = [target];
        while (chainTo.has(chain[0]!)) chain.unshift(chainTo.get(chain[0]!)!);
        back = chain.map(short).join(' -> ');
        break;
      }
      queue.push(target);
    }
  }
  check(`no chain of value imports leads from the modules back to EntityManager.ts (${seen.size} files followed)`, present.length === MODULES.length && back === '', back);
}

// ── [4] Pure functions ───────────────────────────────────────────────────────
console.log('\n[4] Pure functions give the numbers measured before the move');
{
  const konstanten = (await load(fileOf('konstanten'))).module;
  const typen = (await load(fileOf('typen'))).module;
  const zellMesh = (await load(fileOf('zellMesh'))).module;
  const toenung = (await load(fileOf('toenung'))).module;
  const zellenSchluessel = konstanten?.zellenSchluessel as ((cx: number, cz: number) => number) | undefined;
  const bucketSchluessel = typen?.bucketSchluessel as ((prefabHash: number, override: string) => string) | undefined;
  const groessteInstanzSkala = zellMesh?.groessteInstanzSkala as ((data: ArrayLike<number>) => number) | undefined;
  const toenungsRauschen = toenung?.toenungsRauschen as ((x: number, z: number) => { a: number; b: number }) | undefined;
  check(
    'the four functions are there',
    typeof zellenSchluessel === 'function' && typeof bucketSchluessel === 'function' && typeof groessteInstanzSkala === 'function' && typeof toenungsRauschen === 'function'
  );
  if (zellenSchluessel) {
    check('zellenSchluessel(0, 0) = -2147450880', zellenSchluessel(0, 0) === -2147450880, String(zellenSchluessel(0, 0)));
    check('zellenSchluessel(-1, 5) = 2147450885', zellenSchluessel(-1, 5) === 2147450885, String(zellenSchluessel(-1, 5)));
  }
  if (bucketSchluessel) {
    check(`bucketSchluessel(7, '') = '7'`, bucketSchluessel(7, '') === '7', bucketSchluessel(7, ''));
    check(`bucketSchluessel(7, '{"a":1}') = '7|{"a":1}'`, bucketSchluessel(7, '{"a":1}') === '7|{"a":1}', bucketSchluessel(7, '{"a":1}'));
  }
  if (groessteInstanzSkala) {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const twoOnOneAxis = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    check('groessteInstanzSkala(identity matrix) = 1', groessteInstanzSkala(identity) === 1, String(groessteInstanzSkala(identity)));
    check('groessteInstanzSkala(scale 2 on one axis) = 2', groessteInstanzSkala(twoOnOneAxis) === 2, String(groessteInstanzSkala(twoOnOneAxis)));
  }
  if (toenungsRauschen) {
    const first = toenungsRauschen(10, 20);
    const second = toenungsRauschen(10, 20);
    check('toenungsRauschen(10, 20) twice: the same pair', first.a === second.a && first.b === second.b, `${JSON.stringify(first)} ${JSON.stringify(second)}`);
    check(
      'toenungsRauschen(10, 20) = { a: 0.8539083073846996, b: 0.06811452005058527 }',
      first.a === 0.8539083073846996 && first.b === 0.06811452005058527 && first.a * 4294967296 === 3667508254 && first.b * 4294967296 === 292549636,
      JSON.stringify(first)
    );
  }
}

// ── [5] Loading ──────────────────────────────────────────────────────────────
console.log('\n[5] Loading: a module of former methods only declares, loading it does nothing');
{
  const declaresOnly = (st: ts.Statement): boolean =>
    (ts.isImportDeclaration(st) && st.importClause !== undefined) ||
    ts.isTypeAliasDeclaration(st) ||
    ts.isInterfaceDeclaration(st) ||
    (ts.isFunctionDeclaration(st) && st.body !== undefined && (st.modifiers ?? []).every((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) ||
    (ts.isExportDeclaration(st) && st.moduleSpecifier === undefined && st.exportClause !== undefined && ts.isNamedExports(st.exportClause));
  for (const name of [...(Object.keys(FORMER_METHODS) as ModuleName[]), CONTEXT_MODULE]) {
    const file = fileOf(name);
    if (!existsSync(file)) {
      check(`${name}.ts holds only imports, types, function declarations and the export list`, false, `${short(file)} does not exist`);
      continue;
    }
    const sf = parse(file);
    const other = sf.statements.filter((st) => !declaresOnly(st));
    check(
      `${name}.ts holds only imports, types, function declarations and the export list (${sf.statements.length} statements)`,
      sf.statements.length > 0 && other.length === 0,
      other.map((st) => `line ${sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1}: ${ts.SyntaxKind[st.kind]}`).join(', ')
    );
  }
}

// ── [6] Forwarding ───────────────────────────────────────────────────────────
console.log('\n[6] Forwarding: the former methods are still methods of the class and hand on to their module');
{
  const Manager = ((await load(MANAGER)).module as ManagerModule | null)?.EntityManager;
  const instance = Manager ? new Manager(null as never, null as never, null as never, null as never) : null;
  const managerSource = parse(MANAGER);
  const classNode = managerSource.statements.find((st): st is ts.ClassDeclaration => ts.isClassDeclaration(st) && st.name?.text === 'EntityManager');
  const sorted = (names: readonly string[]): string => JSON.stringify([...names].sort());
  for (const [moduleName, names] of Object.entries(FORMER_METHODS) as [ModuleName, readonly string[]][]) {
    const loaded = (await load(fileOf(moduleName))).module;
    const exported = loaded ? Object.keys(loaded) : [];
    check(
      `${moduleName}.ts exports exactly the ${names.length} functions`,
      loaded !== null && sorted(exported) === sorted(names) && exported.every((n) => typeof loaded[n] === 'function'),
      exported.join(', ') || 'nothing'
    );

    // What EntityManager.ts takes from the module: the functions under their own names, as values, nothing else.
    const imported: string[] = [];
    let plain = true;
    for (const st of managerSource.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || resolveImport(MANAGER, st.moduleSpecifier.text) !== fileOf(moduleName)) continue;
      const bindings = st.importClause?.namedBindings;
      if (!st.importClause || st.importClause.isTypeOnly || st.importClause.name || !bindings || !ts.isNamedImports(bindings)) {
        plain = false;
        continue;
      }
      for (const e of bindings.elements) {
        if (e.propertyName || e.isTypeOnly) plain = false;
        imported.push(e.name.text);
      }
    }
    check(`EntityManager.ts imports the ${names.length} functions from ${moduleName}.ts under their own names`, plain && sorted(imported) === sorted(names), imported.join(', ') || 'nothing');

    for (const name of names) {
      const members = classNode?.members.filter((m) => m.name !== undefined && ts.isIdentifier(m.name) && m.name.text === name) ?? [];
      const member = members[0];
      check(`${name}: one member of the class, a method`, members.length === 1 && member !== undefined && ts.isMethodDeclaration(member), members.map((m) => ts.SyntaxKind[m.kind]).join(', ') || 'none');

      let body = 'no body';
      let forwards = false;
      if (members.length === 1 && member !== undefined && ts.isMethodDeclaration(member) && member.body) {
        body = member.body.getText(managerSource).replace(/\s+/g, ' ');
        const only = member.body.statements[0];
        if (member.body.statements.length === 1 && only && ts.isReturnStatement(only) && only.expression && ts.isCallExpression(only.expression)) {
          const call = only.expression;
          const parameters = member.parameters.map((p) => (p.dotDotDotToken ? '...' : '') + p.name.getText(managerSource));
          const handedOn = call.arguments.slice(1).map((a) => a.getText(managerSource));
          forwards =
            ts.isIdentifier(call.expression) &&
            call.expression.text === name &&
            call.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword &&
            JSON.stringify(parameters) === JSON.stringify(handedOn) &&
            (member.modifiers ?? []).every((m) => m.kind !== ts.SyntaxKind.AsyncKeyword && m.kind !== ts.SyntaxKind.StaticKeyword);
        }
      }
      check(`${name}: the body is the one statement return ${name}(this, <its parameters>)`, forwards, body);

      const descriptor = Manager ? Object.getOwnPropertyDescriptor(Manager.prototype, name) : undefined;
      const method: unknown = descriptor?.value;
      check(
        `${name}: a method of the prototype, not a field of the instance`,
        typeof method === 'function' && instance !== null && !Object.prototype.hasOwnProperty.call(instance, name),
        descriptor ? `descriptor: ${Object.keys(descriptor).join(', ')}` : 'not on the prototype'
      );
      const moved: unknown = loaded?.[name];
      check(
        `${name}: the function takes the context, then the parameters of the method`,
        typeof moved === 'function' && typeof method === 'function' && moved.length === method.length + 1 && moved.name === name,
        `function: ${typeof moved === 'function' ? moved.length : 'none'}, method: ${typeof method === 'function' ? method.length : 'none'}`
      );
    }

    // The context of the module: a Pick on the class with exactly the members the functions use, none in stock.
    const moduleSource = existsSync(fileOf(moduleName)) ? parse(fileOf(moduleName)) : null;
    const named: string[] = [];
    const used = new Set<string>();
    let contextType = '';
    let typed = moduleSource !== null;
    let bare = 0;
    for (const st of moduleSource?.statements ?? []) {
      if (!moduleSource || !ts.isTypeAliasDeclaration(st) || !ts.isTypeReferenceNode(st.type) || st.type.typeName.getText(moduleSource) !== 'EntityKontext') continue;
      contextType = st.name.text;
      const argument = st.type.typeArguments?.[0];
      for (const part of argument ? (ts.isUnionTypeNode(argument) ? [...argument.types] : [argument]) : []) {
        named.push(ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal) ? part.literal.text : `?${part.getText(moduleSource)}`);
      }
    }
    for (const st of moduleSource?.statements ?? []) {
      if (!moduleSource || !ts.isFunctionDeclaration(st) || !st.name || !names.includes(st.name.text)) continue;
      const first = st.parameters[0];
      if (!first || !ts.isIdentifier(first.name) || first.type?.getText(moduleSource) !== contextType || contextType === '') {
        typed = false;
        continue;
      }
      const context = first.name;
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === context.text && n !== context) {
          if (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) used.add(n.parent.name.text);
          else if (!(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) bare++;
        }
        ts.forEachChild(n, visit);
      };
      visit(st);
    }
    check(
      `the context of ${moduleName}.ts names exactly the members its functions use`,
      typed && bare === 0 && named.length > 0 && sorted(named) === sorted([...used]),
      `context ${contextType || 'not found'}: ${named.join(', ') || 'none'}; used: ${[...used].join(', ') || 'none'}; context handed on as a whole: ${bare}`
    );
  }
}

// ── [7] Spatial index ────────────────────────────────────────────────────────
// The sequence is fixed: 80 new keys, 20 moves inside the cell, 20 moves into another cell, 15 removals, 5 removals
// of a key that is not there, 60 queries with the radii 5, 40 and 70 in turn, every second one with a list of its
// own. INDEX_EXPECTED was measured on the state before the move with exactly the text between the two marks, the
// methods called as EntityManager.prototype.<name>.call(stub, …).
// <index-sequence>
interface IndexHit {
  readonly prefab: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface IndexCalls<K> {
  indexSetzen(k: K, key: string, prefab: string, x: number, y: number, z: number): void;
  indexEntfernen(k: K, key: string): void;
  nearbyInstances(k: K, x: number, z: number, radius: number, aus?: IndexHit[]): IndexHit[];
}
interface IndexRun {
  /** Hits of every query, in the order of the queries. */
  hits: number[];
  /** FNV-1a over prefab and position of every hit, in the order the hits came back. */
  checksum: number;
  /** Queries that handed in a list of their own and got that same list back. */
  sameList: number;
  steps: { fresh: number; sameCell: number; otherCell: number; removed: number; unknown: number; queries: number };
}
function runIndexSequence<K>(calls: IndexCalls<K>, k: K): IndexRun {
  let seed = 20260930;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const CELL = 32;
  const PREFABS = ['Beech1', 'FirTree', 'Rock_4', 'Pickable_Flint', 'wood_wall'];
  const RADII = [5, 40, 70];
  const placed = new Map<string, { x: number; z: number }>();
  const keys: string[] = [];
  const own: IndexHit[] = [];
  const run: IndexRun = { hits: [], checksum: 0x811c9dc5, sameList: 0, steps: { fresh: 0, sameCell: 0, otherCell: 0, removed: 0, unknown: 0, queries: 0 } };
  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i++) run.checksum = Math.imul(run.checksum ^ text.charCodeAt(i), 0x01000193) >>> 0;
  };
  const pick = (): string => keys[Math.floor(random() * keys.length)]!;
  for (let step = 0; step < 200; step++) {
    const kind = step % 10;
    if (kind < 4) {
      const key = `s:${run.steps.fresh}`;
      const x = (random() * 2 - 1) * 96;
      const y = random() * 30;
      const z = (random() * 2 - 1) * 96;
      calls.indexSetzen(k, key, PREFABS[run.steps.fresh % PREFABS.length]!, x, y, z);
      keys.push(key);
      placed.set(key, { x, z });
      run.steps.fresh++;
    } else if (kind === 4) {
      const key = pick();
      const at = placed.get(key)!;
      const x = (Math.floor(at.x / CELL) + random()) * CELL;
      const z = (Math.floor(at.z / CELL) + random()) * CELL;
      calls.indexSetzen(k, key, 'moved', x, random() * 30, z);
      placed.set(key, { x, z });
      run.steps.sameCell++;
    } else if (kind === 5) {
      const key = pick();
      const at = placed.get(key)!;
      const x = at.x + (random() < 0.5 ? CELL : -CELL);
      const z = at.z + (random() < 0.5 ? 0 : 2 * CELL);
      calls.indexSetzen(k, key, PREFABS[step % PREFABS.length]!, x, random() * 30, z);
      placed.set(key, { x, z });
      run.steps.otherCell++;
    } else if (kind === 6 && step % 40 === 36) {
      calls.indexEntfernen(k, `not-there:${step}`);
      run.steps.unknown++;
    } else if (kind === 6) {
      const at = Math.floor(random() * keys.length);
      const key = keys[at]!;
      calls.indexEntfernen(k, key);
      keys.splice(at, 1);
      placed.delete(key);
      run.steps.removed++;
    } else {
      const near = placed.get(pick())!;
      const radius = RADII[run.steps.queries % RADII.length]!;
      const x = near.x + (random() * 2 - 1) * 4;
      const z = near.z + (random() * 2 - 1) * 4;
      const found = run.steps.queries % 2 === 1 ? calls.nearbyInstances(k, x, z, radius, own) : calls.nearbyInstances(k, x, z, radius);
      if (found === own) run.sameList++;
      run.hits.push(found.length);
      for (const hit of found) mix(`${hit.prefab}@${hit.x},${hit.y},${hit.z};`);
      mix('|');
      run.steps.queries++;
    }
  }
  return run;
}
// </index-sequence>
const INDEX_EXPECTED = {
  /** Hits of the 60 queries, in their order: radius 5, 40, 70 in turn. */
  hits: [
    1, 2, 2, 1, 1, 5, 1, 2, 4, 1, 3, 4, 1, 2, 4, 1, 3, 8, 1, 4, 12, 1, 7, 12, 1, 3, 4, 1, 7, 13,
    1, 2, 4, 1, 4, 14, 1, 5, 6, 1, 5, 17, 2, 10, 11, 1, 9, 21, 2, 5, 18, 1, 7, 24, 1, 8, 20, 1, 11, 21,
  ],
  checksum: 3877597624,
  sameList: 30,
  /** Cells and entries in the index after the last call. */
  cells: 34,
  entries: 65,
  /** Calls of ausZelleLoesen that went through the context. */
  loosened: 35,
  steps: { fresh: 80, sameCell: 20, otherCell: 20, removed: 15, unknown: 5, queries: 60 },
};
interface IndexStub {
  zellen: Map<number, IndexEintrag[]>;
  indexVon: Map<string, IndexEintrag>;
  loosened: number;
  ausZelleLoesen(e: IndexEintrag): void;
}

console.log('\n[7] Spatial index: the fixed sequence gives the numbers measured before the move');
{
  const compare = (label: string, run: IndexRun, cells: number, entries: number, loosened: number): void => {
    check(`${label}: 200 calls as planned`, JSON.stringify(run.steps) === JSON.stringify(INDEX_EXPECTED.steps), JSON.stringify(run.steps));
    const firstOff = run.hits.findIndex((n, i) => n !== INDEX_EXPECTED.hits[i]);
    check(
      `${label}: hits of each of the ${INDEX_EXPECTED.hits.length} queries`,
      run.hits.length === INDEX_EXPECTED.hits.length && firstOff === -1,
      firstOff === -1 ? `${run.hits.length} queries` : `query ${firstOff + 1}: ${run.hits[firstOff]} instead of ${INDEX_EXPECTED.hits[firstOff]}`
    );
    check(`${label}: checksum over the order of the hits = ${INDEX_EXPECTED.checksum}`, run.checksum === INDEX_EXPECTED.checksum, String(run.checksum));
    check(`${label}: ${INDEX_EXPECTED.sameList} queries got their own list back`, run.sameList === INDEX_EXPECTED.sameList, String(run.sameList));
    check(`${label}: ${INDEX_EXPECTED.cells} cells and ${INDEX_EXPECTED.entries} entries at the end`, cells === INDEX_EXPECTED.cells && entries === INDEX_EXPECTED.entries, `${cells} cells, ${entries} entries`);
    check(`${label}: ${INDEX_EXPECTED.loosened} calls of ausZelleLoesen went through the context`, loosened === INDEX_EXPECTED.loosened, String(loosened));
  };

  const spatial = (await load(fileOf('raumIndex'))).module as SpatialIndex | null;
  const there = spatial !== null && (FORMER_METHODS.raumIndex ?? []).every((name) => typeof (spatial as Loaded)[name] === 'function');
  check('the four functions of the spatial index are there', there);
  if (spatial && there) {
    const stub: IndexStub = {
      zellen: new Map(),
      indexVon: new Map(),
      loosened: 0,
      ausZelleLoesen(e: IndexEintrag): void {
        this.loosened++;
        spatial.ausZelleLoesen(this, e);
      },
    };
    const run = runIndexSequence<IndexStub>(spatial, stub);
    compare('functions on a stub of the context', run, stub.zellen.size, stub.indexVon.size, stub.loosened);
  }

  // The same through the class: the forwarding methods of a real instance, with a stub set on the instance.
  const Manager = ((await load(MANAGER)).module as ManagerModule | null)?.EntityManager;
  check('a real instance can be built without a scene', typeof Manager === 'function');
  if (Manager) {
    const real = new Manager(null as never, null as never, null as never, null as never);
    type Reach = Pick<IndexStub, 'zellen' | 'indexVon' | 'ausZelleLoesen'> & {
      indexSetzen(key: string, prefab: string, x: number, y: number, z: number): void;
      indexEntfernen(key: string): void;
      nearbyInstances(x: number, z: number, radius: number, aus?: IndexHit[]): IndexHit[];
    };
    const reach = real as unknown as Reach;
    const forwarding = reach.ausZelleLoesen;
    let loosened = 0;
    reach.ausZelleLoesen = function (this: Reach, e: IndexEintrag): void {
      loosened++;
      forwarding.call(this, e);
    };
    const run = runIndexSequence<Reach>(
      {
        indexSetzen: (k, key, prefab, x, y, z) => k.indexSetzen(key, prefab, x, y, z),
        indexEntfernen: (k, key) => k.indexEntfernen(key),
        nearbyInstances: (k, x, z, radius, aus) => (aus === undefined ? k.nearbyInstances(x, z, radius) : k.nearbyInstances(x, z, radius, aus)),
      },
      reach
    );
    compare('methods of a real instance', run, reach.zellen.size, reach.indexVon.size, loosened);
    const stats = real.indexStats;
    check('indexStats of the instance sees the same index', stats.instanzen === INDEX_EXPECTED.entries && stats.zellen === INDEX_EXPECTED.cells, JSON.stringify(stats));
  }
}

console.log(`\n${checks} checks, ${failures} failed`);
console.log(failures === 0 ? 'ALL PASSED' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
