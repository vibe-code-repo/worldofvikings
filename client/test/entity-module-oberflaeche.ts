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
 * Refactor N3: the three methods of the stone material became functions with a context in steinMaterial.ts. The class
 * lost `private` on `steinMaterials`, `steinMasters`, `dokumentSteinKit`, on the two forwarders `weiseSteinMaterialZu`
 * and `holeSteinMaterial`, and on the constructor parameter property `scene` (reason: `holeSteinMaterial` reads it).
 * After the merge this test is the only guard of the form, so five checks came in for every module of former
 * methods (attack on N2, findings R-F, R-G, R-H):
 *  (1) the head of every forwarder up to `{` equals the text recorded in FORMER_METHODS: a decorator, a lost or
 *      changed visibility, a changed default value or a changed type makes it red;
 *  (2) the value imports of a module of former methods come only from VALUE_IMPORTS, a fixed list per module;
 *  (3) PUBLIC_MEMBERS is the list of the non-private members of the class, measured after the step; a further
 *      loosening (or a member that went private) makes the test red and names the member. The list is carried
 *      forward with every step of the form on this class (N2, N3, N4 …);
 *  (4) `import { type X } from '…'` counts as a value edge in [3]; only `import type { … }` is a type import
 *      (under `verbatimModuleSyntax` the former leaves an `import {} from '…'` behind, a load at run time);
 *  (5) where a function returns objects the context holds, the identity is checked, not just the content ([7], [8]).
 *  [8] Behaviour of the stone material: a fixed sequence of 16 steps against a stub of the context with a NullEngine
 *      scene (no DOM, no assets: the NullEngine never fetches a texture) and, through the forwarding methods, against
 *      a real instance. The numbers were measured on the state before the move.
 *
 * Refactor N4: the two methods of the collision carriers (`enablePhysics`, `rebuildBucketColliders`) became functions with a
 * context in kollisionsEimer.ts. The context is called `ctx` there (`k` is the loop variable of `rebuildBucketColliders`).
 * The class lost `private` on ten fields (`buckets`, `masterMeshes`, `masterLocals`, `kollisionsMasters`, `kollisionsLocals`,
 * `colliders`, `colliderless`, `physicsEnabled`, `colliderCenterX`, `colliderCenterZ`) and on the forwarder
 * `rebuildBucketColliders`. Two findings of the attack on N3 came in here:
 *  (N3-B1) [8] and [9] create a second scene AFTER the scene of the instance and check `getScene()` of every material
 *      and carrier: Babylon falls back to the scene created last, so a context that does not hand its scene on would
 *      otherwise stay green;
 *  (N3-B2) MANAGER_VALUE_IMPORTS is the order in which EntityManager.ts loads its modules; an import line moved to
 *      another place (way C of rule 4.6a) makes [6] red.
 *  [9] Collision carriers: a fixed sequence against a stub of the context and, through the forwarding methods, against a
 *      real instance, with real Havok (it runs under Node when handed the WASM as a buffer): numbers of `colliderStats`
 *      after every phase, the entries of the class itself, the scene of the carriers. The numbers were measured on the
 *      state before the move.
 *
 * DOM-free, no assets; [8] builds a NullEngine scene, [9] a NullEngine scene with Havok.
 * To carry forward with every step of the form on this class: FORMER_METHODS, VALUE_IMPORTS, PUBLIC_MEMBERS and
 * MANAGER_VALUE_IMPORTS. This test checks form, limits and fixed sequences; it does not compare the bodies (K1 was a
 * one-time proof).
 * Run: npx tsx client/test/entity-module-oberflaeche.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Physics/physicsEngineComponent';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
import HavokPhysics from '@babylonjs/havok';
import { getStableHash, PREFABS_BY_NAME, ROOMS_BY_HASH } from '@wov/shared';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SteinKitConfig } from '@wov/shared';
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
const MODULES = ['konstanten', 'typen', 'lod', 'toenung', 'zellMesh', 'zdoMatrix', 'platzhalter', 'raumIndex', 'kontext', 'steinMaterial', 'kollisionsEimer'] as const;
type ModuleName = (typeof MODULES)[number];
const fileOf = (name: ModuleName): string => join(ENTITIES, `${name}.ts`);
const short = (file: string): string => relative(SRC, file).replaceAll('\\', '/');

/** The one module that may name EntityManager.ts, and only as a type: it hands the class on as a context type. */
const CONTEXT_MODULE: ModuleName = 'kontext';
/**
 * The modules whose functions were methods of the class, with the methods each of them took over, and per method the
 * head of its forwarder in the class, from the first modifier up to the opening brace of the body (check (1)).
 */
const FORMER_METHODS: Readonly<Partial<Record<ModuleName, Readonly<Record<string, string>>>>> = {
  raumIndex: {
    nearbyInstances: 'nearbyInstances(\n    x: number,\n    z: number,\n    radius: number,\n    aus: StatischeInstanz[] = []\n  ): StatischeInstanz[]',
    indexSetzen: 'private indexSetzen(key: string, prefab: string, x: number, y: number, z: number): void',
    ausZelleLoesen: 'ausZelleLoesen(e: IndexEintrag): void',
    indexEntfernen: 'private indexEntfernen(key: string): void',
  },
  steinMaterial: {
    weiseSteinMaterialZu: "weiseSteinMaterialZu(\n    bucket: StaticBucket,\n    masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[]\n  ): void",
    setzeDokumentSteinKit: 'setzeDokumentSteinKit(cfg: Partial<SteinKitConfig> | null): void',
    holeSteinMaterial: 'holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial',
  },
  kollisionsEimer: {
    enablePhysics: 'enablePhysics(): void',
    rebuildBucketColliders: 'rebuildBucketColliders(bucket: StaticBucket, zdoMats: readonly Matrix[]): void',
  },
};
/** The modules a module of former methods may load at run time (check (2)). Anything else is a new edge in the graph. */
const VALUE_IMPORTS: Readonly<Partial<Record<ModuleName, readonly string[]>>> = {
  raumIndex: ['./konstanten'],
  steinMaterial: ['@wov/shared', '../engine/DungeonSteinMaterial.js'],
  kollisionsEimer: ['@babylonjs/core/Meshes/mesh', '@wov/shared', '../engine/Physics', './konstanten', './zellMesh'],
};
/**
 * The non-private members of EntityManager after N4 (check (3)): fields, methods, accessors and the parameter
 * properties of the constructor without `private` or `#`, sorted. Carried forward with every step of the form.
 * N2 loosened `zellen`, `indexVon`, `ausZelleLoesen`; N3 loosened `steinMaterials`, `steinMasters`, `dokumentSteinKit`,
 * `weiseSteinMaterialZu`, `holeSteinMaterial` and `scene` (parameter property of the constructor, because
 * `holeSteinMaterial` reads it); N4 loosened `buckets`, `masterMeshes`, `masterLocals`, `kollisionsMasters`, `kollisionsLocals`,
 * `colliders`, `colliderless`, `physicsEnabled`, `colliderCenterX`, `colliderCenterZ` and the forwarder `rebuildBucketColliders`
 * (`colliderSpecs` was public before).
 */
const PUBLIC_MEMBERS: readonly string[] = [
  'aktualisiereGrundskala', 'applyUpdate', 'ausZelleLoesen', 'buckets', 'colliderCenterX', 'colliderCenterZ', 'colliderNahe',
  'colliderPositions', 'colliderSpecs', 'colliderStats', 'colliderless', 'colliders', 'dokumentSteinKit', 'dynamicCount',
  'dynamicList', 'dynamicMasse', 'dynamicPose', 'dynamicSprung', 'dynamischeInstanzen', 'enablePhysics', 'flush',
  'holeSteinMaterial', 'impostorGrenze', 'impostoren', 'indexStats', 'indexVon', 'instanzPosition', 'kollisionsLocals',
  'kollisionsMasters', 'lichtquellen', 'masterLocals', 'masterMeshes', 'naechstesInteragierbares', 'nearbyInstances',
  'npcEinordnung', 'onMasterBelebt', 'onMasterEntsorgt', 'physicsEnabled', 'rebuildBucketColliders', 'removeZDO', 'scene',
  'setHundertFpsProfil', 'setPlayerPosition', 'setVegetationsGrenze', 'setVegetationsSchattenEmpfaenger',
  'setzeDokumentSteinKit', 'setzeInstanzVerborgen', 'setzeNpcQuelle', 'staticCount', 'steinMasters', 'steinMaterials',
  'toenungAn', 'toenungSetzen', 'updateDynamics', 'vegetationsGrenzeInfo', 'weiseSteinMaterialZu', 'zellStats', 'zellen',
];
type SpatialIndex = typeof import('../src/entities/raumIndex');
type StoneModule = typeof import('../src/entities/steinMaterial');
type CollisionModule = typeof import('../src/entities/kollisionsEimer');
/**
 * The order in which EntityManager.ts loads its modules: the sources of its value imports and of its `export … from`,
 * in the order of the file (N3-B2). Import lines that took the place of a dropped statement (way C of rule 4.6a) or
 * were added at the end stand where K8 proved them; a moved line changes the order of evaluation and makes [6] red.
 * Carried forward with every step of the form on this class. `../engine/Physics` stands twice on purpose (rule 4.6b): the
 * first line is the old import of `StaticColliderSet`, which is only a type in this file since N4 and which the compiler
 * removes; the second is a bare import that keeps Physics.ts at its old place in the order of evaluation.
 */
const MANAGER_VALUE_IMPORTS: readonly string[] = [
  '@babylonjs/core/Maths/math.vector',
  '@wov/shared',
  '../player/armorVisibility.js',
  '../player/headSkin.js',
  '@wov/shared',
  '@babylonjs/core/Meshes/transformNode',
  '@babylonjs/core/Meshes/mesh',
  '@babylonjs/core/Maths/math.frustum',
  '@wov/shared',
  './steinMaterial',
  '../player/haarfarbe.js',
  '../player/augenfarbe.js',
  '../engine/Physics',
  '../engine/Physics',
  '../engine/BaumImpostorKern',
  '../engine/RefraktionsAuswahl',
  './clipTempo',
  './gruppenSicherung',
  './animationsLod',
  './konstanten',
  './typen',
  './lod',
  './toenung',
  './zellMesh',
  './zdoMatrix',
  './platzhalter',
  './raumIndex',
  './kollisionsEimer',
  './konstanten',
  './lod',
  './toenung',
  './zellMesh'
];
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
      // Only `import type { … }` is a type import. `import { type X }` is a value edge: under `verbatimModuleSyntax`
      // it leaves `import {} from '…'` behind, and the module is loaded (check (4)).
      const clause = n.importClause;
      add(n, n.moduleSpecifier.text, clause !== undefined && clause.isTypeOnly);
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
  // (2) What a module of former methods loads at run time comes from a fixed list; a further value import is a new edge
  // in the graph (K8 is a one-time proof). `import { type X }` and `import()` count as value imports here.
  for (const [name, allowed] of Object.entries(VALUE_IMPORTS) as [ModuleName, readonly string[]][]) {
    const file = fileOf(name);
    if (!existsSync(file)) {
      check(`${name}.ts: value imports only from ${allowed.join(', ')}`, false, `${short(file)} does not exist`);
      continue;
    }
    const values = importsOf(parse(file)).filter((i) => !i.typeOnly);
    const foreign = values.filter((i) => !allowed.includes(i.spec));
    const unused = allowed.filter((spec) => !values.some((i) => i.spec === spec));
    check(
      `${name}.ts: value imports only from ${allowed.join(', ')} (${values.length} value imports)`,
      foreign.length === 0 && unused.length === 0,
      `${foreign.map((i) => `line ${i.line} '${i.spec}'`).join(', ') || 'no foreign value import'}${unused.length > 0 ? `; listed but not imported: ${unused.join(', ')}` : ''}`
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
  for (const [moduleName, heads] of Object.entries(FORMER_METHODS) as [ModuleName, Readonly<Record<string, string>>][]) {
    const names = Object.keys(heads);
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
      // (1) The head of the forwarder, from the first modifier or decorator up to the brace of the body, is the recorded
      // text: visibility, parameters with their types and default values, the return type. K5/K6 were one-time proofs.
      const head = members.length === 1 && member !== undefined && ts.isMethodDeclaration(member) && member.body ? managerSource.text.slice(member.getStart(managerSource), member.body.getStart(managerSource)).trimEnd() : '(no method)';
      check(`${name}: the head of the forwarder is the recorded text`, head === heads[name], head === heads[name] ? '' : `found ${JSON.stringify(head)}`);

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

  // (3) The non-private members of the class are exactly the recorded ones: every loosening for a context widens the
  // surface of the class for good, so each one is written down here, and a further one makes this red.
  const found: string[] = [];
  for (const m of classNode?.members ?? []) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        const mods = ts.getModifiers(p) ?? [];
        const property = mods.some((x) => x.kind === ts.SyntaxKind.PublicKeyword || x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword || x.kind === ts.SyntaxKind.ReadonlyKeyword);
        if (property && !mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword) && ts.isIdentifier(p.name)) found.push(p.name.text);
      }
      continue;
    }
    if (!m.name || ts.isPrivateIdentifier(m.name)) continue;
    if (ts.canHaveModifiers(m) && (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)) continue;
    const n = m.name.getText(managerSource);
    if (!found.includes(n)) found.push(n);
  }
  found.sort();
  const loosened = found.filter((n) => !PUBLIC_MEMBERS.includes(n));
  const gone = PUBLIC_MEMBERS.filter((n) => !found.includes(n));
  check(
    `the non-private members of EntityManager are exactly the ${PUBLIC_MEMBERS.length} recorded ones`,
    classNode !== undefined && loosened.length === 0 && gone.length === 0,
    `loosened or new: ${loosened.join(', ') || 'none'}; gone or private again: ${gone.join(', ') || 'none'}`
  );
  // (N3-B2) The order in which EntityManager.ts loads its modules is the recorded one. Way C of rule 4.6a puts a new import
  // line at the place of a dropped statement; a later move of that line (by hand, by a formatter, by the next step) changes
  // what is evaluated when, and K8 is a one-time proof.
  const order = importsOf(managerSource).filter((i) => !i.typeOnly).map((i) => i.spec);
  const firstOff = order.findIndex((spec, i) => spec !== MANAGER_VALUE_IMPORTS[i]);
  check(
    `EntityManager.ts loads its ${MANAGER_VALUE_IMPORTS.length} modules in the recorded order`,
    order.length === MANAGER_VALUE_IMPORTS.length && firstOff === -1,
    firstOff === -1 ? `${order.length} value imports` : `place ${firstOff + 1}: '${order[firstOff]}' instead of '${MANAGER_VALUE_IMPORTS[firstOff]}' (${order.length} against ${MANAGER_VALUE_IMPORTS.length})`
  );
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
  const there = spatial !== null && Object.keys(FORMER_METHODS.raumIndex ?? {}).every((name) => typeof (spatial as Loaded)[name] === 'function');
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
    // (5) The hits are the entries of the index itself, not copies.
    const entries = new Set<unknown>(stub.indexVon.values());
    const all = spatial.nearbyInstances(stub, 0, 0, 400);
    check(`stub: all ${INDEX_EXPECTED.entries} hits of a query over the whole index are the entries themselves`, all.length === INDEX_EXPECTED.entries && all.every((hit) => entries.has(hit)), `${all.length} hits, ${all.filter((hit) => entries.has(hit)).length} of them entries`);
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
    const entries = new Set<unknown>(reach.indexVon.values());
    const all = reach.nearbyInstances(0, 0, 400);
    check(`real instance: all ${INDEX_EXPECTED.entries} hits of a query over the whole index are the entries themselves`, all.length === INDEX_EXPECTED.entries && all.every((hit) => entries.has(hit)), `${all.length} hits, ${all.filter((hit) => entries.has(hit)).length} of them entries`);
    const stats = real.indexStats;
    check('indexStats of the instance sees the same index', stats.instanzen === INDEX_EXPECTED.entries && stats.zellen === INDEX_EXPECTED.cells, JSON.stringify(stats));
  }
}

// ── [8] Stone material ───────────────────────────────────────────────────────
// The sequence is fixed: pieces of the barrow kit (a corridor, a stair, the chamber with its own stone material, the
// door, which is no room), a piece of the second kit with the same material, a piece of the rock kit with another
// wall texture, a piece of no kit, a placed piece with its own override; then three documents, each set twice or
// taken back. STONE_EXPECTED was measured on the state before the move with exactly the text between the two marks,
// the methods called as EntityManager.prototype.<name>.call(stub, …). The hashes are the room and door hashes of
// @wov/shared (DG_Steingrab, DG_StoneVault, DG_RockVault).
// <stone-sequence>
interface StoneMesh {
  material: unknown;
}
interface StoneBucket {
  readonly prefabHash: number;
  readonly schluessel: string;
  readonly steinKitCfg?: Partial<SteinKitConfig>;
  readonly masterKey: string;
}
interface StoneState {
  steinMasters: Map<string, unknown>;
  steinMaterials: Map<string, PBRMaterial>;
  dokumentSteinKit: Partial<SteinKitConfig> | null;
}
interface StoneCalls<K extends StoneState> {
  weiseSteinMaterialZu(k: K, bucket: StoneBucket, masters: readonly StoneMesh[]): void;
  setzeDokumentSteinKit(k: K, cfg: Partial<SteinKitConfig> | null): void;
  holeSteinMaterial(k: K, cfg: SteinKitConfig): PBRMaterial;
}
interface StoneStub extends StoneState {
  scene: Scene;
  /** Calls of holeSteinMaterial and weiseSteinMaterialZu that went through the context. */
  fetched: number;
  painted: number;
  holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial;
  weiseSteinMaterialZu(bucket: StoneBucket, masters: readonly StoneMesh[]): void;
}
interface StoneRun {
  /** Name of the material on each of the ten meshes after the last step ('-' for none). */
  names: string[];
  /** FNV-1a over the material names of the meshes and the size of the cache after every step, then over the cache keys. */
  checksum: number;
  /** Materials in the cache and pieces remembered for re-painting, at the end. */
  materials: number;
  masters: number;
  /** Identity: holeSteinMaterial returned the object the cache holds (twice); every painted mesh carries an object of the cache. */
  identity: number;
  steps: number;
}
const STONE = { gang: -1192313122, treppe: -2036557947, kammer: 671134820, tuer: 1912745621, vault: 596948285, rock: -769665293, fremd: 12345 } as const;
function makeStoneStub(scene: Scene, calls: StoneCalls<StoneStub>): StoneStub {
  return {
    scene,
    steinMasters: new Map(),
    steinMaterials: new Map(),
    dokumentSteinKit: null,
    fetched: 0,
    painted: 0,
    holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial {
      this.fetched++;
      return calls.holeSteinMaterial(this, cfg);
    },
    weiseSteinMaterialZu(bucket: StoneBucket, masters: readonly StoneMesh[]): void {
      this.painted++;
      calls.weiseSteinMaterialZu(this, bucket, masters);
    },
  };
}
function runStoneSequence<K extends StoneState>(calls: StoneCalls<K>, k: K): StoneRun {
  const run: StoneRun = { names: [], checksum: 0x811c9dc5, materials: 0, masters: 0, identity: 0, steps: 0 };
  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i++) run.checksum = Math.imul(run.checksum ^ text.charCodeAt(i), 0x01000193) >>> 0;
  };
  const meshes: StoneMesh[] = Array.from({ length: 10 }, () => ({ material: null }));
  const nameOf = (m: StoneMesh): string => (m.material !== null && typeof m.material === 'object' ? String((m.material as { name?: unknown }).name) : '-');
  const bucket = (prefabHash: number, schluessel: string, steinKitCfg?: Partial<SteinKitConfig>): StoneBucket =>
    steinKitCfg ? { prefabHash, schluessel, steinKitCfg, masterKey: schluessel } : { prefabHash, schluessel, masterKey: schluessel };
  const KIT = {
    wandTextur: '/assets/models/stein_clean.png',
    deckeTextur: '/assets/models/stein_decke.png',
    bodenTextur: '/assets/models/stein_clean.png',
    verwitterung: { moos: 1, frost: 0.9, nass: 0.9 },
    kachelM: 2,
    deckeKachelM: 4,
    moosSkala: 9,
    frostSkala: 11,
    nassSkala: 8,
    deckeSchwelle: 0.45,
  } as unknown as SteinKitConfig;
  const step = (f: () => void): void => {
    f();
    run.steps++;
    mix(`${meshes.map(nameOf).join(',')}|${k.steinMaterials.size};`);
  };
  const inCache = (m: unknown): boolean => [...k.steinMaterials.values()].includes(m as PBRMaterial);
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.gang, 'g'), [meshes[0]!, meshes[1]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.treppe, 't'), [meshes[2]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.kammer, 'k'), [meshes[3]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.tuer, 'd'), [meshes[4]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.vault, 'v'), [meshes[5]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.rock, 'r'), [meshes[6]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.fremd, 'x'), [meshes[7]!]));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.gang, 'go', { verwitterung: { nass: 0 } } as unknown as Partial<SteinKitConfig>), [meshes[8]!]));
  step(() => {
    const first = calls.holeSteinMaterial(k, KIT);
    const second = calls.holeSteinMaterial(k, { ...KIT });
    if (first === second && first === k.steinMaterials.get(JSON.stringify(KIT))) run.identity++;
  });
  step(() => calls.setzeDokumentSteinKit(k, {}));
  step(() => calls.setzeDokumentSteinKit(k, { verwitterung: { moos: 2 } } as unknown as Partial<SteinKitConfig>));
  step(() => calls.setzeDokumentSteinKit(k, { verwitterung: { moos: 2 } } as unknown as Partial<SteinKitConfig>));
  step(() => calls.setzeDokumentSteinKit(k, null));
  step(() => calls.weiseSteinMaterialZu(k, bucket(STONE.gang, 'g'), [meshes[9]!]));
  step(() => calls.setzeDokumentSteinKit(k, { wandTextur: '/assets/models/stein_fels.png' }));
  step(() => calls.setzeDokumentSteinKit(k, null));
  for (const m of meshes) if (m.material !== null && inCache(m.material)) run.identity++;
  mix([...k.steinMaterials.keys()].join('\n'));
  run.names = meshes.map(nameOf);
  run.materials = k.steinMaterials.size;
  run.masters = k.steinMasters.size;
  return run;
}
// </stone-sequence>
const STONE_EXPECTED = {
  names: ['steinKit_0', 'steinKit_0', 'steinKit_0', 'steinKit_1', 'steinKit_0', 'steinKit_0', 'steinKit_2', '-', 'steinKit_3', 'steinKit_0'],
  checksum: 1621107641,
  materials: 9,
  masters: 7,
  identity: 10,
  steps: 16,
  /** Calls through the context: holeSteinMaterial from weiseSteinMaterialZu, weiseSteinMaterialZu from setzeDokumentSteinKit. */
  fetched: 36,
  painted: 28,
  /** The document at the end, as JSON. */
  document: 'null',
};

console.log('\n[8] Stone material: the fixed sequence gives the numbers measured before the move');
{
  const compare = (label: string, run: StoneRun, fetched: number, painted: number, document: string): void => {
    check(`${label}: ${STONE_EXPECTED.steps} steps as planned`, run.steps === STONE_EXPECTED.steps, String(run.steps));
    check(`${label}: material of every mesh at the end`, JSON.stringify(run.names) === JSON.stringify(STONE_EXPECTED.names), run.names.join(' '));
    check(`${label}: checksum over the course of the materials = ${STONE_EXPECTED.checksum}`, run.checksum === STONE_EXPECTED.checksum, String(run.checksum));
    check(`${label}: ${STONE_EXPECTED.materials} materials in the cache and ${STONE_EXPECTED.masters} remembered pieces at the end`, run.materials === STONE_EXPECTED.materials && run.masters === STONE_EXPECTED.masters, `${run.materials} materials, ${run.masters} pieces`);
    check(`${label}: ${STONE_EXPECTED.identity} identities (the material of the cache itself, not a copy)`, run.identity === STONE_EXPECTED.identity, String(run.identity));
    check(`${label}: ${STONE_EXPECTED.fetched} calls of holeSteinMaterial and ${STONE_EXPECTED.painted} of weiseSteinMaterialZu went through the context`, fetched === STONE_EXPECTED.fetched && painted === STONE_EXPECTED.painted, `${fetched}, ${painted}`);
    check(`${label}: document at the end is ${STONE_EXPECTED.document}`, document === STONE_EXPECTED.document, document);
  };
  const stone = (await load(fileOf('steinMaterial'))).module as StoneModule | null;
  const there = stone !== null && Object.keys(FORMER_METHODS.steinMaterial ?? {}).every((name) => typeof (stone as Loaded)[name] === 'function');
  check('the three functions of the stone material are there', there);
  const scene = new Scene(new NullEngine());
  // (N3-B1) A second scene, created AFTER the one of the instance: Babylon puts a material without a scene into the scene
  // created last, so a context that does not hand its `scene` on would otherwise go unseen.
  const decoy = new Scene(new NullEngine());
  if (stone && there) {
    const calls: StoneCalls<StoneStub> = {
      weiseSteinMaterialZu: (k, bucket, masters) => stone.weiseSteinMaterialZu(k as never, bucket as never, masters as never),
      setzeDokumentSteinKit: (k, cfg) => stone.setzeDokumentSteinKit(k as never, cfg),
      holeSteinMaterial: (k, cfg) => stone.holeSteinMaterial(k as never, cfg),
    };
    const stub = makeStoneStub(scene, calls);
    const run = runStoneSequence<StoneStub>(calls, stub);
    compare('functions on a stub of the context', run, stub.fetched, stub.painted, JSON.stringify(stub.dokumentSteinKit));
  }

  // The same through the class: the forwarding methods of a real instance, with counting stubs set on the instance.
  const Manager = ((await load(MANAGER)).module as ManagerModule | null)?.EntityManager;
  check('a real instance can be built with a NullEngine scene', typeof Manager === 'function');
  if (Manager) {
    const real = new Manager(scene, null as never, null as never, null as never);
    type Reach = StoneState & {
      holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial;
      weiseSteinMaterialZu(bucket: StoneBucket, masters: readonly StoneMesh[]): void;
      setzeDokumentSteinKit(cfg: Partial<SteinKitConfig> | null): void;
    };
    const reach = real as unknown as Reach;
    const forwardingHole = reach.holeSteinMaterial;
    const forwardingPaint = reach.weiseSteinMaterialZu;
    let fetched = 0;
    let painted = 0;
    reach.holeSteinMaterial = function (this: Reach, cfg: SteinKitConfig): PBRMaterial {
      fetched++;
      return forwardingHole.call(this, cfg);
    };
    reach.weiseSteinMaterialZu = function (this: Reach, bucket: StoneBucket, masters: readonly StoneMesh[]): void {
      painted++;
      forwardingPaint.call(this, bucket, masters);
    };
    const run = runStoneSequence<Reach>(
      {
        // The calls of the sequence itself go to the methods of the class, not to the counting stubs.
        weiseSteinMaterialZu: (k, bucket, masters) => forwardingPaint.call(k, bucket, masters),
        setzeDokumentSteinKit: (k, cfg) => k.setzeDokumentSteinKit(cfg),
        holeSteinMaterial: (k, cfg) => forwardingHole.call(k, cfg),
      },
      reach
    );
    compare('methods of a real instance', run, fetched, painted, JSON.stringify(reach.dokumentSteinKit));
    check('the scene holds the materials of both runs, none of them a fallback of another engine', scene.materials.length === 2 * STONE_EXPECTED.materials, String(scene.materials.length));
    check('every material belongs to the scene of the instance (getScene), none to the scene created after it', scene.materials.length > 0 && scene.materials.every((m) => m.getScene() === scene) && decoy.materials.length === 0, `scene ${scene.materials.length}, decoy ${decoy.materials.length}`);
  }
}

// ── [9] Collision carriers ───────────────────────────────────────────────────
// The sequence is fixed: nine buckets of a 6 x 6 grid (9 m apart) plus one instance far away each, of which six get a
// carrier (four kinds of prefab, one with an override, a dungeon room, a prefab with a hand-made shape and no master) and
// three do not (soft, unknown, one with no shape); before and after `enablePhysics`, with the centre of the collision
// window moved and moved out of reach. COLLISION_EXPECTED was measured on the state before the move with exactly the text
// between the two marks, the methods called as EntityManager.prototype.<name>.call(stub, …), with real Havok.
// <collision-sequence>
interface CollisionBucket {
  prefabName: string;
  prefabHash: number;
  schluessel: string;
  masterKey: string;
  steinKitOverride: string;
  indexOf: Map<string, number>;
  matrices: number[];
  dirty: boolean;
  colliderDirty: boolean;
  mastersReady: boolean;
}
interface CollisionEntry {
  carrier: Mesh;
  set: { count: number; bodyInstances: number };
  signature: string;
}
interface CollisionState {
  physicsEnabled: boolean;
  buckets: Map<string, CollisionBucket>;
  colliderless: Set<string>;
  masterMeshes: Map<string, Mesh[]>;
  kollisionsMasters: Map<string, Mesh[]>;
  colliders: Map<string, CollisionEntry>;
  kollisionsLocals: Map<string, Matrix[]>;
  masterLocals: Map<string, Matrix[]>;
  colliderSpecs: Map<string, unknown>;
  colliderCenterX: number;
  colliderCenterZ: number;
  scene: Scene;
}
interface CollisionCalls<K extends CollisionState> {
  enablePhysics(k: K): void;
  rebuildBucketColliders(k: K, bucket: CollisionBucket, zdoMats: readonly Matrix[]): void;
}
interface CollisionRun {
  /** colliderStats after each phase, as JSON: bodies, havok, prefabs, ohneForm. */
  stats: string[];
  /** Buckets marked dirty by the switch: after the first call, after the second, after a reset and a third call. */
  dirty: number[];
  physicsEnabled: boolean[];
  /** Names with a carrier, and names without a shape, at the end. */
  carriers: string;
  colliderless: string;
  /** Identity: an entry of the class is the same object after a rebuild with the same signature; the spec is the form of the set. */
  identity: number;
  /** Rays from above onto the 36 grid points of a bucket with a carrier. */
  hits: number;
  steps: number;
}
function runCollisionSequence<K extends CollisionState>(calls: CollisionCalls<K>, k: K, statsOf: () => string): CollisionRun {
  const run: CollisionRun = { stats: [], dirty: [], physicsEnabled: [], carriers: '', colliderless: '', identity: 0, hits: 0, steps: 0 };
  const scene = k.scene;
  const room = [...ROOMS_BY_HASH.keys()][0]!;
  const sample = [...PREFABS_BY_NAME.keys()];
  const barrow = sample.find((n) => /^Grabhuegel/i.test(n))!;
  const circle = sample.find((n) => /^Steinkreis/i.test(n));
  const kinds: Array<[string, number, string]> = [
    ['Eiche1', getStableHash('Eiche1'), ''],
    ['Eiche1', getStableHash('Eiche1'), '{"moos":1}'],
    ['Felsblock1', getStableHash('Felsblock1'), ''],
    [barrow, getStableHash(barrow), ''],
    ['Ginster2', getStableHash('Ginster2'), ''],
    ['vegetation-large-bush-1a1', getStableHash('vegetation-large-bush-1a1'), ''],
    ['NichtVorhanden', getStableHash('NichtVorhanden'), ''],
    ['raum-probe', room, ''],
  ];
  if (circle) kinds.push([circle, getStableHash(circle), '']);
  const zdo = new Map<string, Matrix[]>();
  let made = 0;
  for (const [prefabName, prefabHash, override] of kinds) {
    const masterKey = override ? `${prefabName}#${override}` : prefabName;
    const bucket: CollisionBucket = { prefabName, prefabHash, schluessel: masterKey, masterKey, steinKitOverride: override, indexOf: new Map(), matrices: [], dirty: false, colliderDirty: false, mastersReady: true };
    const list: Matrix[] = [];
    let i = 0;
    for (let gx = -3; gx < 3; gx++) for (let gz = -3; gz < 3; gz++) list.push(Matrix.Translation(gx * 9 + 3.5, 0.25 * i++, gz * 9 - 2.5));
    list.push(Matrix.Translation(400, 0, 400));
    for (const m of list) bucket.matrices.push(...m.toArray());
    zdo.set(masterKey, list);
    const master = MeshBuilder.CreateBox(`master_${made++}`, { width: 1.2, height: 3, depth: 1.2 }, scene);
    master.isVisible = false;
    k.masterMeshes.set(masterKey, [master]);
    k.masterLocals.set(masterKey, [Matrix.Identity()]);
    k.buckets.set(masterKey, bucket);
  }
  const all = (): CollisionBucket[] => [...k.buckets.values()];
  const rebuildAll = (): void => {
    for (const b of all()) calls.rebuildBucketColliders(k, b, zdo.get(b.masterKey)!);
    run.steps++;
  };
  const stats = (): void => { run.stats.push(statsOf()); };
  rebuildAll();
  stats();
  calls.enablePhysics(k);
  run.dirty.push(all().filter((b) => b.dirty).length);
  calls.enablePhysics(k);
  run.dirty.push(all().filter((b) => b.dirty).length);
  for (const b of all()) b.dirty = false;
  calls.enablePhysics(k);
  run.dirty.push(all().filter((b) => b.dirty).length);
  run.physicsEnabled.push(k.physicsEnabled);
  stats();
  rebuildAll();
  stats();
  const before = new Map(k.colliders);
  const bodyOf = (e: CollisionEntry | undefined): unknown => (e?.set as unknown as { bodies?: unknown[] } | undefined)?.bodies?.[0];
  const bodiesBefore = new Map([...k.colliders].map(([key, e]) => [key, bodyOf(e)]));
  rebuildAll();
  run.identity += [...k.colliders].filter(([key, e]) => before.get(key) === e).length;
  run.identity += [...k.colliders].filter(([key, e]) => bodiesBefore.get(key) !== undefined && bodiesBefore.get(key) === bodyOf(e)).length;
  stats();
  k.colliderCenterX = 30;
  k.colliderCenterZ = -20;
  rebuildAll();
  stats();
  k.colliderCenterX = 1000;
  k.colliderCenterZ = 1000;
  rebuildAll();
  stats();
  calls.rebuildBucketColliders(k, k.buckets.get('Eiche1')!, [Matrix.Translation(1000, 0, 1000), Matrix.Translation(1001, 0, 1001)]);
  stats();
  k.colliderCenterX = 0;
  k.colliderCenterZ = 0;
  for (const e of k.colliders.values()) e.signature = '';
  rebuildAll();
  stats();
  run.carriers = [...k.colliders.keys()].sort().join(' ');
  run.colliderless = [...k.colliderless].sort().join(' ');
  for (const [key, spec] of k.colliderSpecs) if (spec === (k.colliders.get(key)?.set as unknown as { form: unknown } | undefined)?.form) run.identity++;
  const engine = scene.getPhysicsEngine() as unknown as { raycastToRef(from: Vector3, to: Vector3, out: PhysicsRaycastResult): void };
  const result = new PhysicsRaycastResult();
  for (let gx = -3; gx < 3; gx++) for (let gz = -3; gz < 3; gz++) {
    engine.raycastToRef(new Vector3(gx * 9 + 3.5, 30, gz * 9 - 2.5), new Vector3(gx * 9 + 3.5, -30, gz * 9 - 2.5), result);
    if (result.hasHit) run.hits++;
  }
  return run;
}
// </collision-sequence>
const COLLISION_EXPECTED = {
  stats: [
    '{"bodies":0,"havok":0,"prefabs":0,"ohneForm":0}',
    '{"bodies":0,"havok":0,"prefabs":0,"ohneForm":0}',
    '{"bodies":216,"havok":216,"prefabs":6,"ohneForm":3}',
    '{"bodies":216,"havok":216,"prefabs":6,"ohneForm":3}',
    '{"bodies":162,"havok":162,"prefabs":6,"ohneForm":3}',
    '{"bodies":0,"havok":0,"prefabs":6,"ohneForm":3}',
    '{"bodies":2,"havok":2,"prefabs":6,"ohneForm":3}',
    '{"bodies":216,"havok":216,"prefabs":6,"ohneForm":3}',
  ],
  dirty: [9, 9, 0],
  physicsEnabled: [true],
  carriers: 'Eiche1 Eiche1#{"moos":1} Grabhuegel Steinkreis raum-probe vegetation-large-bush-1a1',
  colliderless: 'Felsblock1 Ginster2 NichtVorhanden',
  /** Six entries and six first bodies unchanged by a rebuild with the same signature, six specs that are the form the set holds. */
  identity: 18,
  hits: 36,
  steps: 6,
};

console.log('\n[9] Collision carriers: the fixed sequence gives the numbers measured before the move (real Havok)');
{
  const wasm = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm'))).buffer;
  const havok = await HavokPhysics({ wasmBinary: wasm });
  const freshScenes = (): { scene: Scene; decoy: Scene } => {
    const scene = new Scene(new NullEngine());
    scene.enablePhysics(new Vector3(0, -20, 0), new HavokPlugin(true, havok));
    // (N3-B1) created AFTER the scene of the instance: what is built without a scene lands here
    return { scene, decoy: new Scene(new NullEngine()) };
  };
  const compare = (label: string, run: CollisionRun, scene: Scene, decoy: Scene, entries: readonly CollisionEntry[]): void => {
    check(`${label}: ${COLLISION_EXPECTED.steps} rebuilds of all buckets as planned`, run.steps === COLLISION_EXPECTED.steps, String(run.steps));
    for (let i = 0; i < COLLISION_EXPECTED.stats.length; i++) {
      check(`${label}: colliderStats after phase ${i + 1} = ${COLLISION_EXPECTED.stats[i]}`, run.stats[i] === COLLISION_EXPECTED.stats[i], String(run.stats[i]));
    }
    check(`${label}: the switch marks ${COLLISION_EXPECTED.dirty.join(', ')} buckets dirty (first call, second call, third call after a reset) and stays on`, JSON.stringify(run.dirty) === JSON.stringify(COLLISION_EXPECTED.dirty) && JSON.stringify(run.physicsEnabled) === JSON.stringify(COLLISION_EXPECTED.physicsEnabled), `${run.dirty.join(', ')}; ${run.physicsEnabled.join(', ')}`);
    check(`${label}: carriers ${COLLISION_EXPECTED.carriers}`, run.carriers === COLLISION_EXPECTED.carriers, run.carriers);
    check(`${label}: no shape for ${COLLISION_EXPECTED.colliderless}`, run.colliderless === COLLISION_EXPECTED.colliderless, run.colliderless);
    check(`${label}: ${COLLISION_EXPECTED.identity} identities (entries and bodies stay the same objects on the same signature, specs are the form of the set)`, run.identity === COLLISION_EXPECTED.identity, String(run.identity));
    check(`${label}: ${COLLISION_EXPECTED.hits} of 36 rays from above hit a body`, run.hits === COLLISION_EXPECTED.hits, String(run.hits));
    check(`${label}: the carriers are invisible, not pickable and frozen in place`, entries.length === 6 && entries.every((e) => e.carrier.isVisible === false && e.carrier.isPickable === false && e.carrier.isWorldMatrixFrozen), `${entries.length} carriers`);
    check(
      `${label}: every carrier belongs to the scene of the instance, none to the scene created after it`,
      entries.length === 6 && entries.every((e) => e.carrier.getScene() === scene) && decoy.meshes.length === 0 && scene.meshes.filter((m) => m.name.startsWith('col_') && !m.name.endsWith('_netz')).length === entries.length,
      `${entries.length} carriers, decoy holds ${decoy.meshes.length} meshes, scene holds ${scene.meshes.filter((m) => m.name.startsWith('col_') && !m.name.endsWith('_netz')).length} of them`
    );
  };
  const statsOfMaps = (k: CollisionState) => (): string => {
    let bodies = 0;
    let havok = 0;
    for (const e of k.colliders.values()) {
      bodies += e.set.count;
      havok += e.set.bodyInstances;
    }
    return JSON.stringify({ bodies, havok, prefabs: k.colliders.size, ohneForm: k.colliderless.size });
  };

  const collision = (await load(fileOf('kollisionsEimer'))).module as CollisionModule | null;
  const there = collision !== null && Object.keys(FORMER_METHODS.kollisionsEimer ?? {}).every((name) => typeof (collision as Loaded)[name] === 'function');
  check('the two functions of the collision carriers are there', there);
  if (collision && there) {
    const { scene, decoy } = freshScenes();
    const stub: CollisionState = {
      physicsEnabled: false,
      buckets: new Map(),
      colliderless: new Set(),
      masterMeshes: new Map(),
      kollisionsMasters: new Map(),
      colliders: new Map(),
      kollisionsLocals: new Map(),
      masterLocals: new Map(),
      colliderSpecs: new Map(),
      colliderCenterX: 0,
      colliderCenterZ: 0,
      scene,
    };
    const run = runCollisionSequence<CollisionState>(
      { enablePhysics: (k) => collision.enablePhysics(k as never), rebuildBucketColliders: (k, bucket, zdoMats) => collision.rebuildBucketColliders(k as never, bucket as never, zdoMats as never) },
      stub,
      statsOfMaps(stub)
    );
    compare('functions on a stub of the context', run, scene, decoy, [...stub.colliders.values()]);
  }

  // The same through the class: the forwarding methods of a real instance, with the fields of the instance itself.
  const Manager = ((await load(MANAGER)).module as ManagerModule | null)?.EntityManager;
  check('a real instance can be built with a NullEngine scene and Havok', typeof Manager === 'function');
  if (Manager) {
    const { scene, decoy } = freshScenes();
    const real = new Manager(scene, null as never, null as never, null as never);
    type Reach = CollisionState & { enablePhysics(): void; rebuildBucketColliders(bucket: CollisionBucket, zdoMats: readonly Matrix[]): void };
    const reach = real as unknown as Reach;
    const run = runCollisionSequence<Reach>(
      { enablePhysics: (k) => k.enablePhysics(), rebuildBucketColliders: (k, bucket, zdoMats) => k.rebuildBucketColliders(bucket, zdoMats) },
      reach,
      () => JSON.stringify(real.colliderStats)
    );
    compare('methods of a real instance', run, scene, decoy, [...reach.colliders.values()]);
    check('colliderSpecs of the instance holds the six forms', real.colliderSpecs.size === 6, String(real.colliderSpecs.size));
  }
}

console.log(`\n${checks} checks, ${failures} failed`);
console.log(failures === 0 ? 'ALL PASSED' : 'FAILED');
process.exit(failures === 0 ? 0 : 1);
