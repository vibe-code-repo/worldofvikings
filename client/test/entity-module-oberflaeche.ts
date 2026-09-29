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
 *  [3] Direction: none of the seven modules imports EntityManager.ts, neither as a value nor as a type; there is
 *      no import cycle among the seven; no chain of value imports leads from one of them back to EntityManager.ts.
 *  [4] Behaviour of the pure functions, with the numbers measured on the state before the move.
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
const MODULES = ['konstanten', 'typen', 'lod', 'toenung', 'zellMesh', 'zdoMatrix', 'platzhalter'] as const;
type ModuleName = (typeof MODULES)[number];
const fileOf = (name: ModuleName): string => join(ENTITIES, `${name}.ts`);
const short = (file: string): string => relative(SRC, file).replaceAll('\\', '/');

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
console.log('\n[3] Direction: the seven modules do not know EntityManager.ts');
{
  const present = MODULES.filter((name) => existsSync(fileOf(name)));
  check('all seven modules exist', present.length === MODULES.length, `missing: ${MODULES.filter((n) => !present.includes(n)).join(', ') || 'none'}`);

  const among = new Map<string, string[]>();
  for (const name of present) {
    const file = fileOf(name);
    const imports = importsOf(parse(file));
    const toManager = imports.filter((i) => resolveImport(file, i.spec) === MANAGER);
    check(`${name}.ts does not import EntityManager.ts, neither as a value nor as a type`, toManager.length === 0, toManager.map((i) => `line ${i.line}${i.typeOnly ? ' (type)' : ''}`).join(', '));
    among.set(
      file,
      imports.map((i) => resolveImport(file, i.spec)).filter((target): target is string => target !== null && present.some((n) => fileOf(n) === target))
    );
  }
  // A cycle among the seven, imports of any kind.
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
  check('no import cycle among the seven modules', present.length === MODULES.length && cycles.length === 0, cycles.join(' | '));
  const edges = [...among].flatMap(([from, targets]) => [...new Set(targets)].map((to) => `${short(from)} -> ${short(to)}`));
  console.log(`        imports among the seven: ${edges.join(', ') || 'none'}`);

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
  check(`no chain of value imports leads from the seven back to EntityManager.ts (${seen.size} files followed)`, present.length === MODULES.length && back === '', back);
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

console.log(`\n${checks} checks, ${failures} failed`);
console.log(failures === 0 ? 'ALL PASSED' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
