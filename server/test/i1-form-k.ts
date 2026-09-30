/**
 * Form k of the modules under `server/src/spiel/` (refactoring I1, from step 2).
 * Die Form k der Module unter `server/src/spiel/`: eine Methode von `WovServer` wird eine Funktion mit Kontext.
 *
 * Step 2 moved six methods of `server/src/WovServer.ts` unchanged into two modules: the four dungeon editor handlers
 * into `spiel/DungeonEditPakete.ts`, the admin command handler and the time-of-day handler into `spiel/AdminPakete.ts`.
 * Step 3 moved five more: the chest, appearance and figure handlers into `spiel/Interaktion.ts` (`handleTruheOeffnen`,
 * `sendeTruheInhalt`, `handleSetAussehen`, `handleSetFigur`) and `handleChatMessage` into `spiel/Chat.ts`. `handleInteract` and
 * `handleContainerAction` stay in the class (they read the static member `WovServer.FREMDER_BESITZ_MELDUNG`, rule 5).
 * In the class stays one forwarding method per name, in the same place; `k` in the module IS the server. Rules:
 * `Karten/refactoring/01 Form k — Regeln für Methoden mit Kontext.md`. After the merge this test is the only guard
 * (the one-time proofs K1 to K8 of the step are history). Later steps add their modules to `MODULE` below and their
 * members to `PUBLIC_MEMBERS`; a step that widens the public surface without saying so turns this test red.
 *
 * What it holds, per module (K9 of the rules, with the additions):
 *  1. The module is in the list, lies under `server/src/spiel/`, and does nothing when it is loaded: its top level
 *     holds imports with names, ONE type alias (the context type), the function declarations and the export list.
 *     Nothing else (no call, no variable, no `export` in front of a function, no `async`).
 *  2. The functions are exactly the listed ones, in the order of the class, the first parameter is `k` with the
 *     context type, the export list names exactly them, and the module has no `this`.
 *  3. The context type is `SpielKontext<…>` with exactly the listed members, and the members read as `k.<member>` in
 *     the functions are exactly the same set: none in reserve, none missing. `k` is only ever the receiver of a member
 *     access: never cast (`k as X`, `k!`), never passed on, never shadowed.
 *  4. The VALUE imports of the module are exactly the listed specifiers (a fixed list per module). `import type` is
 *     free; `import { type X }` is NOT free (it can survive the build as a load of the module), so it counts as a value
 *     import and turns red unless the specifier is on the list.
 *  5. In `WovServer.ts`, per function: a private method with the frozen head (name, modifiers, parameters, return type,
 *     up to the `{`, nothing added such as a decorator or a default value), whose body is the ONE statement
 *     `return <name>(this, <parameters in order>);`; the function is imported under its own name (no `as`) from its
 *     module, the name is bound nowhere else at module level; `onPacket` still calls `this.<name>(peer, reader)`.
 *  6. The list of the NON-PRIVATE members of `WovServer` (fields, methods, parameter properties of the constructor) is
 *     frozen. Every step that needs a private member in its context relaxes it to public, and that widens the surface of
 *     the class for good; here the step says so, in `PUBLIC_MEMBERS`. A relaxation that is not listed turns this red.
 *     A forwarding whose method is itself a context member (`sendeTruheInhalt`, step 3) has no `private` in its frozen head.
 *  7. Behaviour: one fixed sequence of calls, on a stand-in for the server and on a real instance (through the
 *     forwarding methods), gives the numbers that were measured before the move (`SOLL_*`; measured with
 *     `--messen-basis` on the stand before the move, see below). Recorded are the packets sent, the calls into the
 *     context, the state changes and the exceptions.
 *  Not applicable in steps 2 and 3: the identity of returned objects of the stock (K9-5), no function returns a value.
 *
 * Section [0] shows first that each check can turn red: the same checks run over small invented sources, one fault
 * each (`red:`), and over a good stand (`green:`).
 *
 * `--messen-basis`: prints the measured summaries (step 2: stand-in and real instance; step 3: the same for the chest,
 * appearance, figure and chat handlers) for the stand BEFORE the move, calling `WovServer.prototype.<name>` with
 * the stand-in as `this` instead of the module functions. On the base commit (where the test file is copied next to the
 * old sources) this reproduces `SOLL_ATTRAPPE`/`SOLL_ECHT`. Reads no source, checks nothing else.
 *
 * Known limits: the checks read the syntax tree; a member added under a computed name is not seen by the list of public
 * members (`<computed>` entries are listed as such); a `k` reached through an alias (`const a = k`) is caught (the alias
 * is a use of `k` other than `k.<member>`), one reached through `arguments` is not (a function cannot use it in a module
 * without the rules of Form k stopping the step first).
 *
 * Run (from server/): npx tsx test/i1-form-k.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as ts from 'typescript';
import { PacketType, WORLD_TIME_LENGTH, dungeon2, Inventory, WILDWARDEN_PARTS, findItem, FRISUR_VORGABE, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, FIGUREN, HAARFARBEN, AUGENFARBEN, TRUHE_INHALT_MEMBER, TRUHE_LOOTED_MEMBER, packContainer, unpackContainer, ChatMsgType } from '@wov/shared';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { WovServer, createWovServer } from '../src/WovServer.js';
import { registryChecksum } from '../src/world/dungeon/ModuleBuild.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MESSEN_BASIS = process.argv.includes('--messen-basis');
// in the measuring mode only the final JSON goes to stdout
if (MESSEN_BASIS) console.log = (): void => undefined;

let total = 0;
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  total++;
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}
const same = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ── The frozen tables ──────────────────────────────────────────────────

interface FunktionSpec {
  readonly name: string;
  /** The head of the forwarding in the class, from the modifier to the return type (nothing after the type). */
  readonly kopf: string;
  /** The method of the class that calls `this.<name>(<args>)` (`onPacket` for the packet handlers). */
  readonly aufrufer: { readonly methode: string; readonly args: string };
  /** `Function.length` of the method on the prototype: the number of parameters of the forwarding. */
  readonly laenge: number;
}
interface ModulSpec {
  /** Path from the repository root. */
  readonly datei: string;
  /** The specifier `WovServer.ts` imports it by. */
  readonly spezifizierer: string;
  readonly kontextTyp: string;
  readonly mitglieder: readonly string[];
  /** Specifiers of the value imports, in the order of the module. */
  readonly wertImporte: readonly string[];
  readonly funktionen: readonly FunktionSpec[];
}

const KOPF = (name: string): string => `private ${name}(peer: Peer, reader: Reader): void`;
/** A packet handler: private forwarding `(peer, reader)`, called by `onPacket`. */
const PAKET = (name: string): FunktionSpec => ({ name, kopf: KOPF(name), aufrufer: { methode: 'onPacket', args: 'peer, reader' }, laenge: 2 });
const MODULE: readonly ModulSpec[] = [
  {
    datei: 'server/src/spiel/AdminPakete.ts',
    spezifizierer: './spiel/AdminPakete.js',
    kontextTyp: 'AdminPaketeKontext',
    mitglieder: ['adminCommands', 'net', 'worldTime', 'getTimeOfDay', 'getDay', 'sendTimeSync'],
    wertImporte: ['@wov/shared'],
    funktionen: [PAKET('handleAdminCommand'), PAKET('handleSetTimeOfDay')],
  },
  {
    datei: 'server/src/spiel/Chat.ts',
    spezifizierer: './spiel/Chat.js',
    kontextTyp: 'ChatKontext',
    mitglieder: ['net'],
    wertImporte: ['@wov/shared', '../io/Writer.js', './ChatReichweite.js'],
    funktionen: [PAKET('handleChatMessage')],
  },
  {
    datei: 'server/src/spiel/DungeonEditPakete.ts',
    spezifizierer: './spiel/DungeonEditPakete.js',
    kontextTyp: 'DungeonEditKontext',
    mitglieder: ['dungeons', 'config', 'enterDungeon', 'dungeonsWurzel'],
    wertImporte: ['@wov/shared', '../world/dungeon/ModuleBuild.js'],
    funktionen: [PAKET('handleDungeonEditRequest'), PAKET('handleDungeonEditSave'), PAKET('handleDungeonModulBau'), PAKET('handleDungeonModulLoeschen')],
  },
  {
    datei: 'server/src/spiel/Interaktion.ts',
    spezifizierer: './spiel/Interaktion.js',
    kontextTyp: 'InteraktionKontext',
    mitglieder: ['sendeTruheInhalt', 'inventarSync', 'zdosVon', 'kappeLeben', 'sichereSpielerSofort'],
    wertImporte: ['@wov/shared', './Beute.js'],
    funktionen: [
      // called by `handleInteract` (stays in the class), not by `onPacket`; three parameters
      { name: 'handleTruheOeffnen', kopf: 'private handleTruheOeffnen(peer: Peer, ziel: ZDO, def: Prefab | undefined): void', aufrufer: { methode: 'handleInteract', args: 'peer, ziel, def' }, laenge: 3 },
      // a context member: the forwarding is public (no `private` in the head); called by `handleContainerAction` (stays in the class)
      { name: 'sendeTruheInhalt', kopf: 'sendeTruheInhalt(peer: Peer, ziel: ZDO): void', aufrufer: { methode: 'handleContainerAction', args: 'peer, ziel' }, laenge: 2 },
      PAKET('handleSetAussehen'),
      PAKET('handleSetFigur'),
    ],
  },
];

/**
 * The non-private members of `WovServer`, sorted: 36 before step 2, plus `dungeonsWurzel`, `sendTimeSync` and `worldTime`
 * (context members of step 2, relaxed from private), plus `inventarSync`, `kappeLeben`, `sendeTruheInhalt`,
 * `sichereSpielerSofort` and `zdosVon` (context members of step 3, relaxed from private). One per line; a later step adds
 * its relaxations here, each with a reason.
 */
const PUBLIC_MEMBERS: readonly string[] = [
  'adminCommands',
  'adminListe',
  'aggro',
  'config',
  'dungeons',
  'dungeonsWurzel', // step 2: context member of DungeonEditPakete (the constructor reads it too, so it stays in the class)
  'enterDungeon',
  'geo',
  'getDay',
  'getGroundHeight',
  'getTimeOfDay',
  'getWorldTime',
  'hauptwelt',
  'heightmaps',
  'init',
  'instanzWeltAnlegen',
  'instanzWeltEntfernen',
  'inventarSync', // step 3: context member of Interaktion
  'kappeLeben', // step 3: context member of Interaktion
  'kollisionswelt',
  'leaveDungeon',
  'liegezeitMs',
  'net',
  'ohneWeltVerworfen',
  'prefabs',
  'routen',
  'saveWorld',
  'saveWorldAsync',
  'sendTimeSync', // step 2: context member of AdminPakete
  'sendeTruheInhalt', // step 3: context member of Interaktion (the forwarding itself is public)
  'serverUserId',
  'sichereSpielerSofort', // step 3: context member of Interaktion (F8, #146)
  'spawns',
  'start',
  'stop',
  'weltMarken',
  'welten',
  'worldLayoutHash',
  'worldLayoutRaw',
  'worldManager',
  'worldTime', // step 2: context member of AdminPakete (the field stays in the class)
  'zdos',
  'zdosVon', // step 3: context member of Interaktion
  'zones',
];

// ── The checks ─────────────────────────────────────────────────────────

const parse = (name: string, text: string): ts.SourceFile => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const mods = (n: ts.Node): readonly ts.Modifier[] => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []);
const hasMod = (n: ts.Node, kind: ts.SyntaxKind): boolean => mods(n).some((m) => m.kind === kind);

/** The findings for one module: items 1 to 4 of the header. Empty when the module is as frozen. */
function pruefeModul(spec: ModulSpec, text: string): string[] {
  const f: string[] = [];
  const sf = parse(spec.datei, text);
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // 1. the top level does nothing when loaded
  const funktionen: ts.FunctionDeclaration[] = [];
  const typAliase: ts.TypeAliasDeclaration[] = [];
  const wertSpezifizierer: string[] = [];
  let exportListe: string[] | null = null;
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      if (!s.importClause) f.push(`line ${line(s)}: an import for its effect (no names) runs code when the module loads`);
      // `import type { X }` is erased; every other form, `import { type X }` included, is a value import (item 4)
      else if (!s.importClause.isTypeOnly && ts.isStringLiteral(s.moduleSpecifier)) wertSpezifizierer.push(s.moduleSpecifier.text);
    } else if (ts.isTypeAliasDeclaration(s)) {
      typAliase.push(s);
      if (hasMod(s, ts.SyntaxKind.ExportKeyword)) f.push(`line ${line(s)}: the context type is not exported`);
    } else if (ts.isFunctionDeclaration(s)) {
      funktionen.push(s);
      if (mods(s).length > 0) f.push(`line ${line(s)}: function ${s.name?.text ?? '?'} has modifiers (${mods(s).map((m) => ts.SyntaxKind[m.kind]).join(' ')}): no export, no async`);
      if (s.asteriskToken) f.push(`line ${line(s)}: a generator`);
    } else if (ts.isExportDeclaration(s) && !s.moduleSpecifier && !s.isTypeOnly && s.exportClause && ts.isNamedExports(s.exportClause)) {
      if (exportListe !== null) f.push(`line ${line(s)}: a second export list`);
      exportListe = s.exportClause.elements.map((e) => (e.propertyName ? `${e.propertyName.text} as ${e.name.text}` : e.name.text));
    } else f.push(`line ${line(s)}: ${ts.SyntaxKind[s.kind]} at the top level does something or is not allowed when the module loads`);
  }
  // 2. functions, export list, no this
  const namen = spec.funktionen.map((x) => x.name);
  if (!same(funktionen.map((x) => x.name?.text ?? '?'), namen)) f.push(`the functions are [${funktionen.map((x) => x.name?.text)}], expected [${namen}]`);
  if (exportListe === null || !same(exportListe, namen)) f.push(`the export list is [${exportListe ?? 'missing'}], expected [${namen}]`);
  for (const fn of funktionen) {
    const p0 = fn.parameters[0];
    const okKontext = !!p0 && ts.isIdentifier(p0.name) && p0.name.text === 'k' && !p0.initializer && !p0.questionToken && !p0.dotDotDotToken && !!p0.type && p0.type.getText(sf) === spec.kontextTyp;
    if (!okKontext) f.push(`${fn.name?.text}: the first parameter is not \`k: ${spec.kontextTyp}\``);
    const gehe = (n: ts.Node): void => {
      if (n.kind === ts.SyntaxKind.ThisKeyword) f.push(`line ${line(n)}: ${fn.name?.text} uses \`this\` (it became \`k\`)`);
      if (ts.isIdentifier(n) && n.text === 'k' && !(fn.parameters[0] && n === fn.parameters[0].name)) {
        const par = n.parent;
        const declariert = (ts.isVariableDeclaration(par) || ts.isParameter(par) || ts.isBindingElement(par)) && par.name === n;
        if (declariert) f.push(`line ${line(n)}: ${fn.name?.text} declares a second \`k\`, the context is shadowed`);
        else if (ts.isPropertyAccessExpression(par) && par.name === n) {
          /* `x.k`: a member called k, not the context */
        } else if (!(ts.isPropertyAccessExpression(par) && par.expression === n)) f.push(`line ${line(n)}: ${fn.name?.text} uses \`k\` as a value (${par.getText(sf).slice(0, 40)}): only \`k.<member>\` is allowed`);
      }
      ts.forEachChild(n, gehe);
    };
    if (fn.body) gehe(fn.body);
  }
  // 3. the context type and the members read
  const alias = typAliase[0];
  if (typAliase.length !== 1 || !alias || alias.name.text !== spec.kontextTyp) f.push(`the module needs exactly one type alias named ${spec.kontextTyp}`);
  else {
    const t = alias.type;
    const ok = ts.isTypeReferenceNode(t) && t.typeName.getText(sf) === 'SpielKontext' && t.typeArguments?.length === 1;
    if (!ok) f.push(`${spec.kontextTyp} is not \`SpielKontext<…>\` (${t.getText(sf).slice(0, 60)})`);
    else {
      const arg = t.typeArguments![0]!;
      const lits: string[] = [];
      const alle = ts.isUnionTypeNode(arg) ? arg.types : [arg];
      for (const x of alle) if (ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal)) lits.push(x.literal.text);
      if (lits.length !== alle.length) f.push(`${spec.kontextTyp} names something other than string literals`);
      if (!same([...lits].sort(), [...spec.mitglieder].sort())) f.push(`${spec.kontextTyp} names [${[...lits].sort()}], expected [${[...spec.mitglieder].sort()}]`);
    }
  }
  const gelesen = new Set<string>();
  for (const fn of funktionen) {
    const gehe = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'k') gelesen.add(n.name.text);
      ts.forEachChild(n, gehe);
    };
    if (fn.body) gehe(fn.body);
  }
  if (!same([...gelesen].sort(), [...spec.mitglieder].sort())) f.push(`the members read as k.<member> are [${[...gelesen].sort()}], the context lists [${[...spec.mitglieder].sort()}]: none in reserve, none missing`);
  // 4. the value imports
  if (!same(wertSpezifizierer, spec.wertImporte)) f.push(`the value imports are [${wertSpezifizierer}], expected exactly [${spec.wertImporte}] (an \`import { type X }\` counts as a value import)`);
  return f;
}

/** The findings for the class: items 5 and 6. `moduleGeprueft` are the specs whose module is expected to be imported. */
function pruefeKlasse(specs: readonly ModulSpec[], text: string, oeffentlich: readonly string[]): string[] {
  const f: string[] = [];
  const sf = parse('WovServer.ts', text);
  const klasse = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer');
  if (!klasse) return ['class WovServer not found'];
  const nameVon = (m: ts.ClassElement): string => (m.name ? m.name.getText(sf) : '');
  for (const spec of specs) {
    // the import under its own names, once
    const imps = sf.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === spec.spezifizierer);
    const namen = spec.funktionen.map((x) => x.name);
    const nb = imps[0]?.importClause?.namedBindings;
    const el = nb && ts.isNamedImports(nb) ? nb.elements : [];
    const importOk = imps.length === 1 && !imps[0]!.importClause!.isTypeOnly && !imps[0]!.importClause!.name && el.length > 0 && el.every((e) => !e.propertyName && !e.isTypeOnly) && same(el.map((e) => e.name.text), namen);
    if (!importOk) f.push(`${spec.spezifizierer}: expected exactly one import of [${namen}] under their own names (no as, no type)`);
    for (const fn of spec.funktionen) {
      // the name is bound nowhere else at module level (a second binding would hide the import)
      let bindungen = 0;
      for (const s of sf.statements) {
        if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) {
          if (s.name?.text === fn.name) bindungen++;
        } else if (ts.isVariableStatement(s)) {
          for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === fn.name) bindungen++;
        } else if (ts.isImportDeclaration(s) && s.importClause) {
          const c = s.importClause;
          if (c.name?.text === fn.name) bindungen++;
          if (c.namedBindings && ts.isNamespaceImport(c.namedBindings) && c.namedBindings.name.text === fn.name) bindungen++;
          if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const e of c.namedBindings.elements) if (e.name.text === fn.name) bindungen++;
        }
      }
      if (bindungen !== 1) f.push(`${fn.name}: bound ${bindungen} times at module level, expected once (the import)`);
      // the forwarding
      const treffer = klasse.members.filter((m) => nameVon(m) === fn.name);
      const m = treffer[0];
      if (treffer.length !== 1 || !m || !ts.isMethodDeclaration(m)) { f.push(`${fn.name}: expected exactly one method of this name in the class`); continue; }
      const body = m.body;
      const kopf = body ? text.slice(m.getStart(sf), body.getStart(sf)).trim() : '';
      if (kopf !== fn.kopf) f.push(`${fn.name}: head of the forwarding is "${kopf}", frozen "${fn.kopf}"`);
      if (ts.canHaveDecorators(m) && (ts.getDecorators(m) ?? []).length > 0) f.push(`${fn.name}: a decorator`);
      const st = body?.statements ?? [];
      const r = st[0];
      if (st.length !== 1 || !r || !ts.isReturnStatement(r) || !r.expression || !ts.isCallExpression(r.expression)) { f.push(`${fn.name}: the body is not the one statement \`return ${fn.name}(this, …);\``); continue; }
      const c = r.expression;
      const args = c.arguments.map((a) => a.getText(sf));
      const soll = ['this', ...m.parameters.map((p) => p.name.getText(sf))];
      const ok = ts.isIdentifier(c.expression) && c.expression.text === fn.name && !c.typeArguments && !c.questionDotToken && c.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword && same(args, soll);
      if (!ok) f.push(`${fn.name}: the call is \`${c.getText(sf)}\`, expected \`${fn.name}(${soll.join(', ')})\` with a plain \`this\``);
      // the caller in the class (`onPacket` or another method that stays) still calls the method by its name
      const aufrufer = klasse.members.find((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && nameVon(x) === fn.aufrufer.methode);
      let ruft = false;
      const gehe = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword && n.expression.name.text === fn.name && n.arguments.map((a) => a.getText(sf)).join(',') === fn.aufrufer.args.replace(/ /g, '')) ruft = true;
        ts.forEachChild(n, gehe);
      };
      if (aufrufer) gehe(aufrufer);
      if (!ruft) f.push(`${fn.name}: ${fn.aufrufer.methode} does not call this.${fn.name}(${fn.aufrufer.args})`);
    }
  }
  // 6. the non-private members
  const oeff: string[] = [];
  for (const m of klasse.members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) if (ts.getModifiers(p)?.length && !hasMod(p, ts.SyntaxKind.PrivateKeyword) && !hasMod(p, ts.SyntaxKind.ProtectedKeyword) && ts.isIdentifier(p.name)) oeff.push(p.name.text);
      continue;
    }
    if (!m.name) continue;
    if (hasMod(m, ts.SyntaxKind.PrivateKeyword) || hasMod(m, ts.SyntaxKind.ProtectedKeyword)) continue;
    oeff.push(ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text + (hasMod(m, ts.SyntaxKind.StaticKeyword) ? ' (static)' : '') : `<${m.name.getText(sf)}>`);
  }
  const neu = oeff.filter((x) => !oeffentlich.includes(x)).sort();
  const weg = oeffentlich.filter((x) => !oeff.includes(x)).sort();
  if (neu.length > 0) f.push(`new non-private members (a relaxation nobody listed): ${neu.join(', ')}`);
  if (weg.length > 0) f.push(`listed as public but not public any more: ${weg.join(', ')}`);
  return f;
}

const show = (f: readonly string[]): string => f.slice(0, 3).join(' | ');

// ── [0] The checks can turn red ────────────────────────────────────────

console.log('\n[0] Self-test of the checks on invented sources');
{
  const S: ModulSpec = {
    datei: 'server/src/spiel/Test.ts',
    spezifizierer: './spiel/Test.js',
    kontextTyp: 'TestKontext',
    mitglieder: ['a', 'b'],
    wertImporte: ['@wov/shared'],
    funktionen: [PAKET('fa'), PAKET('fb')],
  };
  const gutesModul = [
    "import { PacketType } from '@wov/shared';",
    "import type { Peer } from '../net/Peer.js';",
    "import type { Reader } from '../io/Reader.js';",
    "import type { SpielKontext } from './Kontext.js';",
    '',
    "type TestKontext = SpielKontext<'a' | 'b'>;",
    '',
    'function fa(k: TestKontext, peer: Peer, reader: Reader): void {',
    '  k.a.x(peer, reader, PacketType.Chat);',
    '}',
    '',
    'function fb(k: TestKontext, peer: Peer, reader: Reader): void {',
    '  k.b += 1;',
    '}',
    '',
    'export { fa, fb };',
    '',
  ].join('\n');
  const gutePakete = (modul: string, ...ersetze: [string, string][]): string => ersetze.reduce((t, [a, b]) => { if (!t.includes(a)) throw new Error('fault anchor missing: ' + a); return t.replace(a, b); }, modul);
  check('green: the good module', pruefeModul(S, gutesModul).length === 0, show(pruefeModul(S, gutesModul)));
  const MF = (a: string, b: string): [string, string] => [a, b];
  const modulFehler: [string, string][] = [
    ['a call at the top level', gutePakete(gutesModul, MF('type TestKontext', 'Date.now();\ntype TestKontext'))],
    ['a variable at the top level', gutePakete(gutesModul, MF('type TestKontext', 'const z = 1;\ntype TestKontext'))],
    ['an import for its effect', gutePakete(gutesModul, MF("import { PacketType } from '@wov/shared';", "import { PacketType } from '@wov/shared';\nimport './Anders.js';"))],
    ['export in front of a function', gutePakete(gutesModul, MF('function fa(', 'export function fa('))],
    ['async function', gutePakete(gutesModul, MF('function fb(', 'async function fb('))],
    ['a third function', gutePakete(gutesModul, MF('export { fa, fb };', 'function fc(k: TestKontext): void { k.a.x(); }\nexport { fa, fb, fc };'))],
    ['a function missing from the export list', gutePakete(gutesModul, MF('export { fa, fb };', 'export { fa };'))],
    ['the export list has another name', gutePakete(gutesModul, MF('export { fa, fb };', 'export { fa, fb as fc };'))],
    ['the functions in another order', gutePakete(gutesModul, MF('export { fa, fb };', 'export { fb, fa };'))],
    ['this in a function', gutePakete(gutesModul, MF('  k.b += 1;', '  k.b += this.x;'))],
    ['k cast to another type', gutePakete(gutesModul, MF('  k.b += 1;', '  (k as never as { z: number }).z += 1;\n  k.b += 1;'))],
    ['k passed on as a value', gutePakete(gutesModul, MF('  k.b += 1;', '  weiter(k);\n  k.b += 1;'))],
    ['k stored in a variable', gutePakete(gutesModul, MF('  k.b += 1;', '  const y = k;\n  k.b += 1;\n  void y;'))],
    ['k with a non-null assertion', gutePakete(gutesModul, MF('  k.b += 1;', '  k!.b += 1;'))],
    ['k shadowed by a variable', gutePakete(gutesModul, MF('  k.b += 1;', '  const k2 = 1;\n  {\n    const k = 2;\n    void k;\n  }\n  k.b += k2;'))],
    ['k shadowed by an inner parameter', gutePakete(gutesModul, MF('  k.b += 1;', '  [1].map((k) => k);\n  k.b += 1;'))],
    ['the first parameter is not k', gutePakete(gutesModul, MF('function fa(k: TestKontext,', 'function fa(kontext: TestKontext,'))],
    ['the first parameter has another type', gutePakete(gutesModul, MF('function fb(k: TestKontext,', 'function fb(k: Peer,'))],
    ['a member in reserve in the context type', gutePakete(gutesModul, MF("SpielKontext<'a' | 'b'>", "SpielKontext<'a' | 'b' | 'c'>"))],
    ['a member read but not in the context type', gutePakete(gutesModul, MF('  k.b += 1;', '  k.b += 1;\n  k.c();'))],
    ['a member missing from the context type', gutePakete(gutesModul, MF("SpielKontext<'a' | 'b'>", "SpielKontext<'a'>"))],
    ['the context type written by hand', gutePakete(gutesModul, MF("type TestKontext = SpielKontext<'a' | 'b'>;", 'type TestKontext = { a: { x(p: Peer, r: Reader, t: number): void }; b: number };'))],
    ['the context type exported', gutePakete(gutesModul, MF('type TestKontext', 'export type TestKontext'))],
    ['a second type alias', gutePakete(gutesModul, MF('type TestKontext', 'type Zwei = number;\ntype TestKontext'))],
    ['an extra value import', gutePakete(gutesModul, MF("import type { Peer }", "import { ZoneManager } from '../world/ZoneManager.js';\nimport type { Peer }"))],
    ['import { type X } counts as a value import', gutePakete(gutesModul, MF("import type { Peer } from '../net/Peer.js';", "import { type Peer } from '../net/Peer.js';"))],
    ['a value import of the class file', gutePakete(gutesModul, MF("import type { Peer }", "import { WovServer } from '../WovServer.js';\nimport type { Peer }"))],
    ['a value import missing', gutePakete(gutesModul, MF("import { PacketType } from '@wov/shared';\n", ''), MF('PacketType.Chat', '1'))],
  ];
  for (const [name, text] of modulFehler) {
    const f = pruefeModul(S, text);
    check(`red: module, ${name}`, f.length > 0, show(f) || 'no finding');
  }

  const gutesGebaeude = (extra = '', oeff = 'readonly net = 1;', konstruktor = 'readonly config: number, private readonly geheim: number'): string =>
    [
      "import { fa, fb } from './spiel/Test.js';",
      'export class WovServer {',
      `  constructor(${konstruktor}) {}`,
      `  ${oeff}`,
      '  private onPacket(peer: Peer, type: number, reader: Reader): void {',
      '    switch (type) {',
      '      case 1:',
      '        this.fa(peer, reader);',
      '        break;',
      '      case 2:',
      '        this.fb(peer, reader);',
      '        break;',
      '    }',
      '  }',
      '',
      '  private fa(peer: Peer, reader: Reader): void {',
      '    return fa(this, peer, reader);',
      '  }',
      '',
      '  private fb(peer: Peer, reader: Reader): void {',
      '    return fb(this, peer, reader);',
      '  }',
      extra,
      '}',
      '',
    ].join('\n');
  const OEFF = ['config', 'net'];
  const gut = gutesGebaeude();
  check('green: the good class', pruefeKlasse([S], gut, OEFF).length === 0, show(pruefeKlasse([S], gut, OEFF)));
  const klassenFehler: [string, string, readonly string[]][] = [
    ['visibility lost', gut.replace('private fa(', 'fa('), OEFF],
    ['visibility gained a modifier', gut.replace('private fb(', 'protected fb('), OEFF],
    ['a parameter type changed', gut.replace('private fa(peer: Peer, reader: Reader)', 'private fa(peer: Peer, reader: Reader | null)'), OEFF],
    ['a default value on the forwarding', gut.replace('private fb(peer: Peer, reader: Reader)', 'private fb(peer: Peer, reader: Reader = null as never)'), OEFF],
    ['the return type changed', gut.replace('private fa(peer: Peer, reader: Reader): void', 'private fa(peer: Peer, reader: Reader): void | undefined'), OEFF],
    ['async on the forwarding', gut.replace('private fa(', 'private async fa('), OEFF],
    ['a decorator on the forwarding', gut.replace('  private fb(', '  @dekor private fb('), OEFF],
    ['a second statement', gut.replace('    return fa(this, peer, reader);', '    void peer;\n    return fa(this, peer, reader);'), OEFF],
    ['no return', gut.replace('    return fa(this, peer, reader);', '    fa(this, peer, reader);'), OEFF],
    ['this cast', gut.replace('return fa(this, peer, reader);', 'return fa(this as never, peer, reader);'), OEFF],
    ['the parameters swapped', gut.replace('return fb(this, peer, reader);', 'return fb(this, reader, peer);'), OEFF],
    ['another function called', gut.replace('return fa(this, peer, reader);', 'return fb(this, peer, reader);'), OEFF],
    ['a field with an arrow function', gut.replace('  private fa(peer: Peer, reader: Reader): void {\n    return fa(this, peer, reader);\n  }', '  private fa = (peer: Peer, reader: Reader): void => fa(this, peer, reader);'), OEFF],
    ['the import under another name', gut.replace("import { fa, fb }", "import { fa as fx, fb }"), OEFF],
    ['the import as a type', gut.replace("import { fa, fb }", "import { type fa, fb }"), OEFF],
    ['the import is missing', gut.replace("import { fa, fb } from './spiel/Test.js';\n", ''), OEFF],
    ['the import from another module', gut.replace('./spiel/Test.js', './spiel/Anders.js'), OEFF],
    ['the name bound a second time at module level', gut.replace('export class', 'const fa = 1;\nexport class'), OEFF],
    ['onPacket calls another method', gut.replace('this.fb(peer, reader);', 'this.fa(peer, reader);'), OEFF],
    ['onPacket without the call', gut.replace('        this.fb(peer, reader);\n', '        void 0;\n'), OEFF],
    ['a new public field (a relaxation nobody listed)', gutesGebaeude('', 'readonly net = 1;\n  saveTimer = 0;'), OEFF],
    ['a public member the list does not know', gutesGebaeude('', 'readonly net = 1;'), OEFF.filter((x) => x !== 'config')],
    ['a public member made private', gutesGebaeude('', 'private net = 1;'), OEFF],
    ['a parameter property relaxed', gutesGebaeude('', 'readonly net = 1;', 'readonly config: number, readonly geheim: number'), OEFF],
    ['a public method added', gutesGebaeude('  neu(): void {}'), OEFF],
    ['a static public member added', gutesGebaeude('  static readonly X = 1;'), OEFF],
  ];
  for (const [name, text, oeff] of klassenFehler) {
    const f = pruefeKlasse([S], text, oeff);
    check(`red: class, ${name}`, f.length > 0, show(f) || 'no finding');
  }
  // a public forwarding (the method is a context member), three parameters, called by another method of the class (step 3)
  const S3: ModulSpec = {
    datei: 'server/src/spiel/Test3.ts', spezifizierer: './spiel/Test3.js', kontextTyp: 'Test3Kontext', mitglieder: ['a'], wertImporte: [],
    funktionen: [{ name: 'fc', kopf: 'fc(peer: Peer, ziel: Ziel, def: Def | undefined): void', aufrufer: { methode: 'andere', args: 'peer, ziel, def' }, laenge: 3 }],
  };
  const gut3 = [
    "import { fc } from './spiel/Test3.js';",
    'export class WovServer {',
    '  readonly a = 1;',
    '  private andere(peer: Peer, ziel: Ziel, def: Def): void {',
    '    this.fc(peer, ziel, def);',
    '  }',
    '',
    '  fc(peer: Peer, ziel: Ziel, def: Def | undefined): void {',
    '    return fc(this, peer, ziel, def);',
    '  }',
    '}',
    '',
  ].join('\n');
  check('green: the good class with a public forwarding and another caller', pruefeKlasse([S3], gut3, ['a', 'fc']).length === 0, show(pruefeKlasse([S3], gut3, ['a', 'fc'])));
  const klassenFehler3: [string, string, readonly string[]][] = [
    ['a public forwarding that became private (frozen: public)', gut3.replace('  fc(peer', '  private fc(peer'), ['a']],
    ['a public forwarding that is not listed as public member', gut3, ['a']],
    ['a third parameter dropped', gut3.replace('ziel: Ziel, def: Def | undefined): void {\n    return fc(this, peer, ziel, def);', 'ziel: Ziel): void {\n    return fc(this, peer, ziel);'), ['a', 'fc']],
    ['the caller calls with other arguments', gut3.replace('this.fc(peer, ziel, def);', 'this.fc(peer, ziel);'), ['a', 'fc']],
    ['the caller is another method', gut3.replace('private andere(', 'private woanders('), ['a', 'fc']],
    ['the caller does not call', gut3.replace('    this.fc(peer, ziel, def);\n', ''), ['a', 'fc']],
    ['the third argument swapped', gut3.replace('return fc(this, peer, ziel, def);', 'return fc(this, peer, def, ziel);'), ['a', 'fc']],
  ];
  for (const [name, text, oeff] of klassenFehler3) {
    const f = pruefeKlasse([S3], text, oeff);
    check(`red: class, ${name}`, f.length > 0, show(f) || 'no finding');
  }
}

// ── [1] The real sources ───────────────────────────────────────────────

const klassenText = readFileSync(join(WURZEL, 'server/src/WovServer.ts'), 'utf8');
const alleNamen = MODULE.flatMap((m) => m.funktionen.map((x) => x.name));

console.log('\n[1] The modules under server/src/spiel/ and the forwardings in WovServer.ts');
if (!MESSEN_BASIS) {
  const dateien = readdirSync(join(WURZEL, 'server/src/spiel')).filter((f) => f.endsWith('.ts')).map((f) => `server/src/spiel/${f}`);
  for (const spec of MODULE) {
    check(`${spec.datei} exists under spiel/`, dateien.includes(spec.datei));
    const t = readFileSync(join(WURZEL, spec.datei), 'utf8');
    const f = pruefeModul(spec, t);
    check(`${spec.datei}: form k (load does nothing, ${spec.funktionen.length} functions, context of ${spec.mitglieder.length} members, ${spec.wertImporte.length} value imports)`, f.length === 0, show(f));
    const mod = (await import(`../../${spec.datei.replace(/\.ts$/, '.js')}`)) as Record<string, unknown>;
    check(`${spec.datei}: exports exactly [${spec.funktionen.map((x) => x.name)}], all functions`, same(Object.keys(mod).sort(), spec.funktionen.map((x) => x.name).sort()) && Object.values(mod).every((v) => typeof v === 'function'), Object.keys(mod).join(', '));
  }
  const f = pruefeKlasse(MODULE, klassenText, PUBLIC_MEMBERS);
  check(`WovServer.ts: ${alleNamen.length} forwardings in the frozen form, imports, onPacket, ${PUBLIC_MEMBERS.length} non-private members`, f.length === 0, show(f));
  for (const n of alleNamen) {
    const d = Object.getOwnPropertyDescriptor(WovServer.prototype, n);
    const laenge = MODULE.flatMap((m) => m.funktionen).find((x) => x.name === n)!.laenge;
    check(`${n}: a prototype method of WovServer (length ${(d?.value as { length?: number } | undefined)?.length})`, typeof d?.value === 'function' && (d.value as { length: number }).length === laenge && (d.value as { name: string }).name === n);
  }
  // every module under spiel/ that uses the context type stands under this guard (only Kontext.ts itself defines it)
  const alleDateien = new Set(MODULE.map((m) => m.datei));
  const unbekannt = dateien.filter((d) => d !== 'server/src/spiel/Kontext.ts' && /\bSpielKontext\b/.test(readFileSync(join(WURZEL, d), 'utf8')) && !alleDateien.has(d));
  check('every module under spiel/ that uses SpielKontext is in MODULE (under this guard)', unbekannt.length === 0, unbekannt.join(', '));
}

// ── [2] Behaviour ──────────────────────────────────────────────────────

type Fn = (k: unknown, ...a: unknown[]) => unknown;
const proto = WovServer.prototype as unknown as Record<string, (...x: unknown[]) => unknown>;
const F = {} as Record<string, Fn>;
for (const spec of MODULE) {
  if (MESSEN_BASIS) for (const fn of spec.funktionen) F[fn.name] = (k, ...x) => proto[fn.name]!.call(k, ...x);
  else {
    const mod = (await import(`../../${spec.datei.replace(/\.ts$/, '.js')}`)) as Record<string, Fn>;
    for (const fn of spec.funktionen) F[fn.name] = mod[fn.name]!;
  }
}

const dekodiere = (buf: Buffer): unknown[] => {
  // the packets of these handlers: bool, string, (string | int32) …; decoded by the length of the buffer
  const r = new Reader(buf);
  const aus: unknown[] = [];
  aus.push(r.readBool());
  aus.push(r.readString());
  if (r.remaining() > 0) aus.push(r.remaining() === 4 ? r.readInt32() : r.readString().length);
  return aus;
};
const leser = (fn: (w: Writer) => void): Reader => {
  const w = new Writer();
  fn(w);
  return new Reader(w.toBuffer());
};

interface Aufzeichnung {
  paket: string[];
  aufrufe: Record<string, number>;
  konsole: { log: number; warn: number };
  zustand: number[];
  ausnahmen: string[];
}
const neueAufzeichnung = (): Aufzeichnung => ({ paket: [], aufrufe: {}, konsole: { log: 0, warn: 0 }, zustand: [], ausnahmen: [] });
const zaehle = (a: Aufzeichnung, name: string): void => { a.aufrufe[name] = (a.aufrufe[name] ?? 0) + 1; };
/** A peer that records what it is sent: the type, the decoded first two fields and, for the time packet, nothing more. */
function peer(a: Aufzeichnung, name: string, isAdmin: boolean, dungeonId = ''): Record<string, unknown> {
  return {
    name, isAdmin, dungeonId,
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void {
      const w = new Writer();
      fn(w);
      const r = new Reader(w.toBuffer());
      const d = type === PacketType.AdminEvent ? [r.readString(), r.readBool(), r.readString().slice(0, 22)] : dekodiere(w.toBuffer()).slice(0, 2).map((x) => (typeof x === 'string' ? x.slice(0, 22) : x));
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify(d)}`);
    },
  };
}
const konsole = (a: Aufzeichnung): (() => void) => {
  const orig = { log: console.log, warn: console.warn };
  console.log = (): void => { a.konsole.log++; };
  console.warn = (): void => { a.konsole.warn++; };
  return () => { console.log = orig.log; console.warn = orig.warn; };
};
const versuche = (a: Aufzeichnung, fn: () => unknown): void => {
  try { fn(); } catch (e) { a.ausnahmen.push(`${(e as Error).name}`); }
};

/** The fixed sequence on a stand-in for the server: every context member records its calls. */
function messeAttrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const doc2 = { id: 'd2', thema: 'steingrab', pruefsumme: 'P2' };
  const doc1 = { id: 'd1', layout: { rooms: [1, 2, 3], props: [4, 5] } };
  let modus2: 'neu' | 'erhalten' | 'null' = 'neu';
  let modus1: 'neu' | 'erhalten' | 'null' = 'neu';
  // one folder of our own holds everything: `dungeonsWurzel()` is `<worldsDir>/../dungeons`, so worlds and dungeons are siblings in it
  const wurzel = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  const gen = join(wurzel, 'generiert');
  const welten = join(wurzel, 'worlds');
  mkdirSync(gen, { recursive: true });
  mkdirSync(welten, { recursive: true });
  mkdirSync(join(wurzel, 'dungeons'), { recursive: true });
  let welt = 0;
  const k: Record<string, unknown> = {
    dungeons: {
      getDokument2: (id: string) => { zaehle(a, 'getDokument2'); return id === 'd2' ? doc2 : undefined; },
      getDocument: (id: string) => { zaehle(a, 'getDocument'); return id === 'd1' ? doc1 : undefined; },
      upsertDokument2: () => { zaehle(a, 'upsertDokument2'); return modus2 === 'null' ? null : { doc: doc2, instanzErhalten: modus2 === 'erhalten' }; },
      upsertDocument: () => { zaehle(a, 'upsertDocument'); return modus1 === 'null' ? null : { doc: doc1, instanzErhalten: modus1 === 'erhalten' }; },
    },
    config: { dungeonsModulbau: true, generiertDir: gen, worldsDir: welten, worldName: 'i1-form-k' },
    enterDungeon: (): { ok: boolean } => { zaehle(a, 'enterDungeon'); return { ok: true }; },
    dungeonsWurzel(this: unknown): string { zaehle(a, 'dungeonsWurzel'); return proto['dungeonsWurzel']!.call(this) as string; },
    getTimeOfDay(this: unknown): number { return proto['getTimeOfDay']!.call(this) as number; },
    getDay(this: unknown): number { return proto['getDay']!.call(this) as number; },
    sendTimeSync: (): void => { zaehle(a, 'sendTimeSync'); },
    adminCommands: { execute: (p: unknown, line: unknown): { active: boolean; message: string } => { zaehle(a, 'execute'); return { active: String(line).includes('on'), message: `ran:${String(line).trim()}` }; } },
    net: { getPeers: (): unknown[] => { zaehle(a, 'getPeers'); return [peer(a, 'p1', false), peer(a, 'p2', true)]; } },
    get worldTime(): number { return welt; },
    set worldTime(v: number) { welt = v; },
  };
  const lauf = (name: string, p: unknown, r: Reader): void => versuche(a, () => F[name]!(k, p, r));
  const admin = (dungeonId = ''): unknown => peer(a, 'a', true, dungeonId);
  const nichtAdmin = (): unknown => peer(a, 'n', false);
  const summe = registryChecksum();
  const zeit = (v: number): Reader => leser((w) => w.writeFloat64(v));
  const s = (t: string): Reader => leser((w) => w.writeString(t));
  const speichern = (json: string, pruefsumme: string | null = summe): Reader => leser((w) => { w.writeString(json); if (pruefsumme !== null) w.writeString(pruefsumme); });
  const doc2Json = JSON.stringify({ version: dungeon2.DUNGEON_DOKUMENT_VERSION_2, id: 'd2' });
  const doc1Json = JSON.stringify({ version: 1, id: 'd1' });
  const bau = (x: number, z: number, r: number, g: number): Reader => leser((w) => { w.writeInt32(x); w.writeInt32(z); w.writeInt32(r); w.writeFloat32(g); });
  try {
    // the time: worldTime after each call
    for (const [v, ok] of [[100, true], [-50, true], [WORLD_TIME_LENGTH * 2 + 5, true], [0, true], [Number.NaN, true], [Number.POSITIVE_INFINITY, true], [55, false]] as const) {
      lauf('handleSetTimeOfDay', ok ? admin() : nichtAdmin(), zeit(v));
      a.zustand.push(Math.round(welt));
    }
    // the admin line
    for (const line of ['fly', '  Fly  on ', '']) lauf('handleAdminCommand', admin(), s(line));
    lauf('handleAdminCommand', admin(), new Reader(Buffer.alloc(0)));
    // the editor: request
    for (const id of ['d2', 'd1', 'zz', '']) lauf('handleDungeonEditRequest', admin(), s(id));
    lauf('handleDungeonEditRequest', admin('d1'), s(''));
    lauf('handleDungeonEditRequest', nichtAdmin(), s('d2'));
    // the editor: save (2.0 and 1.0; new, kept, refused; the peer in the document or elsewhere)
    lauf('handleDungeonEditSave', nichtAdmin(), speichern(doc1Json));
    lauf('handleDungeonEditSave', admin(), speichern('x'.repeat(2_000_001)));
    lauf('handleDungeonEditSave', admin(), speichern(doc1Json, 'veraltet'));
    lauf('handleDungeonEditSave', admin(), speichern('kein json'));
    for (const [m, wo] of [['neu', 'd2'], ['neu', 'x'], ['erhalten', 'd2'], ['null', 'd2']] as const) { modus2 = m; lauf('handleDungeonEditSave', admin(wo), speichern(doc2Json)); }
    for (const [m, wo] of [['neu', 'd1'], ['neu', 'x'], ['erhalten', 'd1'], ['null', 'd1']] as const) { modus1 = m; lauf('handleDungeonEditSave', admin(wo), speichern(doc1Json)); }
    // the hall: build and delete, on a real folder
    lauf('handleDungeonModulBau', nichtAdmin(), bau(4, 3, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(1, 1, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    a.zustand.push(readdirSync(gen).length);
    const gebaut = readdirSync(gen).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
    lauf('handleDungeonModulLoeschen', nichtAdmin(), s(gebaut[0] ?? 'fehlt'));
    lauf('handleDungeonModulLoeschen', admin(), s('../x'));
    lauf('handleDungeonModulLoeschen', admin(), s(gebaut[0] ?? 'fehlt'));
    lauf('handleDungeonModulLoeschen', admin(), s(gebaut[0] ?? 'fehlt'));
    a.zustand.push(readdirSync(gen).length);
    // the switch `dungeons.modulbau` off: both handlers refuse
    (k['config'] as { dungeonsModulbau: boolean }).dungeonsModulbau = false;
    lauf('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    lauf('handleDungeonModulLoeschen', admin(), s('irgendein-saal'));
    a.zustand.push(readdirSync(gen).length);
  } finally {
    ruecksetzen();
    rmSync(wurzel, { recursive: true, force: true });
  }
  return a;
}

/** The same sequence in short, on a real instance through the methods of the class (forwardings). */
function messeEcht(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    const server = createWovServer({
      port: 0, worldFeatures: false, worldName: 'i1-form-k', everyoneAdmin: true,
      worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'), dungeonsModulbau: true,
    } as never) as unknown as Record<string, unknown> & { worldTime: number };
    mkdirSync(join(tmp, 'generiert'), { recursive: true });
    // stand-ins on the instance, as the tests do: what the handlers call through the context
    server['enterDungeon'] = (): { ok: boolean } => { zaehle(a, 'enterDungeon'); return { ok: true }; };
    server['sendTimeSync'] = (): void => { zaehle(a, 'sendTimeSync'); };
    (server['net'] as Record<string, unknown>)['getPeers'] = (): unknown[] => { zaehle(a, 'getPeers'); return [peer(a, 'p1', false), peer(a, 'p2', true)]; };
    const rufe = (name: string, p: unknown, r: Reader): void => versuche(a, () => (server[name] as (x: unknown, y: unknown) => unknown).call(server, p, r));
    const admin = (dungeonId = ''): unknown => peer(a, 'e', true, dungeonId);
    const nichtAdmin = (): unknown => peer(a, 'n', false);
    const summe = registryChecksum();
    const doc = (id: string): unknown => ({ version: dungeon2.DUNGEON_DOKUMENT_VERSION_2, id, name: 'K9', modus: 'erzeugt', thema: 'steingrab', seeds: { architektur: 4242, material: dungeon2.mische(4242, 1), deko: dungeon2.mische(4242, 2) }, pruefsumme: '', layoutVersion: dungeon2.LAYOUT_VERSION });
    const speichern = (json: string, pruefsumme = summe): Reader => leser((w) => { w.writeString(json); w.writeString(pruefsumme); });
    const s = (t: string): Reader => leser((w) => w.writeString(t));
    const bau = (x: number, z: number, r: number, g: number): Reader => leser((w) => { w.writeInt32(x); w.writeInt32(z); w.writeInt32(r); w.writeFloat32(g); });
    for (const [v, ok] of [[100, true], [-50, true], [WORLD_TIME_LENGTH * 2 + 5, true], [0, true], [Number.NaN, true], [55, false]] as const) {
      rufe('handleSetTimeOfDay', ok ? admin() : nichtAdmin(), leser((w) => w.writeFloat64(v)));
      a.zustand.push(Math.round(server.worldTime));
    }
    for (const line of ['unbekanntes-kommando 1 2', '']) rufe('handleAdminCommand', admin(), s(line));
    rufe('handleAdminCommand', nichtAdmin(), s('fly'));
    rufe('handleDungeonEditRequest', admin(), s('k9-doc'));
    rufe('handleDungeonEditSave', nichtAdmin(), speichern(JSON.stringify(doc('k9-doc'))));
    rufe('handleDungeonEditSave', admin('k9-doc'), speichern(JSON.stringify(doc('k9-doc'))));
    rufe('handleDungeonEditSave', admin('k9-doc'), speichern(JSON.stringify(doc('k9-doc'))));
    rufe('handleDungeonEditSave', admin(), speichern(JSON.stringify(doc('k9-doc')), 'veraltet'));
    rufe('handleDungeonEditSave', admin(), speichern(JSON.stringify({ version: 1, id: 'alt' })));
    rufe('handleDungeonEditRequest', admin(), s('k9-doc'));
    rufe('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    a.zustand.push(readdirSync(join(tmp, 'generiert')).length);
    const gebaut = readdirSync(join(tmp, 'generiert')).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
    rufe('handleDungeonModulLoeschen', admin(), s(gebaut[0] ?? 'fehlt'));
    a.zustand.push(readdirSync(join(tmp, 'generiert')).length);
    (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}


// ── [2b] Behaviour of step 3: chest, appearance, figure, chat ──────────

interface Aufzeichnung3 extends Aufzeichnung {
  notizen: string[];
}
const neueAufzeichnung3 = (): Aufzeichnung3 => ({ ...neueAufzeichnung(), notizen: [] });
/** Math.random with a fixed sequence for the length of one call: `wuerfleTruhe` draws from it. */
function mitZufall<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  let x = seed;
  Math.random = (): number => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}
const kurz = (b: Buffer): string => `${b.length}:${createHash('sha256').update(b).digest('hex').slice(0, 10)}`;
function peerI(a: Aufzeichnung3, name: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, figur: 'wikinger', frisur: FRISUR_VORGABE, haarfarbe: HAARFARBE_VORGABE, augenfarbe: AUGENFARBE_VORGABE, ruestung: '|', characterID: 'c1', inventar: new Inventory(),
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void {
      const w = new Writer();
      fn(w);
      const r = new Reader(w.toBuffer());
      const d = type === PacketType.InteractResult ? [r.readBool(), r.readString()] : type === PacketType.ContainerSync ? [r.readString(), r.readInt32(), r.readString().length] : [kurz(w.toBuffer())];
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify(d)}`);
    },
    ...o,
  };
}
/** A stand-in for a ZDO (chest or character) that records what is read and written. */
function zdoA(a: Aufzeichnung3, start: Record<string, string | number> = {}): Record<string, unknown> {
  const m = new Map<string, string | number>(Object.entries(start));
  return {
    zdoid: { userId: { toString: (): string => 'u' }, id: 7 },
    dirty: false,
    revision: { reviseData(): void { zaehle(a, 'reviseData'); } },
    getInt(k: string): number { const v = m.get(k); return typeof v === 'number' ? v : 0; },
    setInt(k: string, v: number): void { zaehle(a, 'setInt'); m.set(k, v); a.notizen.push(`setInt ${k}=${v}`); },
    getString(k: string): string { const v = m.get(k); return typeof v === 'string' ? v : ''; },
    setString(k: string, v: string): void { zaehle(a, 'setString'); m.set(k, v); a.notizen.push(`setString ${k}=${v.length > 16 ? `${v.length}:${createHash('sha256').update(v).digest('hex').slice(0, 8)}` : v}`); },
  };
}
const paketS = (...werte: string[]): Reader => leser((w) => { for (const x of werte) w.writeString(x); });
const teileWild = (): Record<string, string> => Object.fromEntries(WILDWARDEN_PARTS.map((p) => [p.slot, p.id]));
const inventarMit = (): Inventory => { const inv = new Inventory(); for (const t of WILDWARDEN_PARTS) inv.addItem(findItem(t.item)!, 1); return inv; };
const angelegt = (p: Record<string, unknown>): number => (p['inventar'] as Inventory).all.filter((i) => i.equipped).length;
const truhenInhalt = (): string => { const inv = unpackContainer(''); inv.addItem(findItem('Coins')!, 3); return packContainer(inv); };
const F0 = FIGUREN[0]!.id;
const F1 = FIGUREN[1]!.id;

/** Chest, appearance and figure on a stand-in: every context member records its calls. */
function messeInteraktionAttrappe(): Aufzeichnung3 {
  const a = neueAufzeichnung3();
  const ruecksetzen = konsole(a);
  let charZdo: Record<string, unknown> | undefined = zdoA(a);
  const k: Record<string, unknown> = {
    // a moved method that is a context member: before the move through the prototype, after it through the function (R12)
    sendeTruheInhalt(this: unknown, ...x: unknown[]): unknown { zaehle(a, 'sendeTruheInhalt'); return F['sendeTruheInhalt']!(this, ...x); },
    inventarSync: (): void => { zaehle(a, 'inventarSync'); },
    zdosVon: (): unknown => { zaehle(a, 'zdosVon'); return { getZDO: (): unknown => charZdo }; },
    kappeLeben: (): void => { zaehle(a, 'kappeLeben'); },
    sichereSpielerSofort: (_p: unknown, grund: unknown): void => { zaehle(a, 'sichereSpielerSofort'); a.notizen.push(`sofort:${String(grund)}`); },
  };
  const lauf = (name: string, seed: number, ...args: unknown[]): void => versuche(a, () => mitZufall(seed, () => F[name]!(k, ...args)));
  try {
    // the chest: first touch (drawn from the loot table), touched again, old chest, direct send
    for (const [seed, start, def] of [
      [1, {}, { name: 'trollcave_chest' }], [2, {}, undefined], [3, { [TRUHE_LOOTED_MEMBER]: 1 }, { name: 'x' }],
      [4, { [TRUHE_LOOTED_MEMBER]: 1, [TRUHE_INHALT_MEMBER]: truhenInhalt() }, { name: 'x' }], [5, { [TRUHE_INHALT_MEMBER]: 'kein-container' }, { name: 'x' }],
    ] as const) lauf('handleTruheOeffnen', seed, peerI(a, 't'), zdoA(a, start as Record<string, string | number>), def);
    lauf('sendeTruheInhalt', 6, peerI(a, 't'), zdoA(a, { [TRUHE_INHALT_MEMBER]: truhenInhalt() }));
    // appearance: old and new clients, refusals, the parts of a set
    const teile = teileWild();
    lauf('handleSetAussehen', 7, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', ''));
    lauf('handleSetAussehen', 8, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE));
    lauf('handleSetAussehen', 9, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE));
    lauf('handleSetAussehen', 25, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBEN[1]!.id));
    lauf('handleSetAussehen', 26, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBEN[1]!.id, AUGENFARBEN[1]!.id));
    lauf('handleSetAussehen', 10, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, '{}'));
    lauf('handleSetAussehen', 11, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{kaputt'));
    lauf('handleSetAussehen', 12, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify({ kopf: 'wildwarden_vest' })));
    lauf('handleSetAussehen', 13, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify(teile)));
    lauf('handleSetAussehen', 14, peerI(a, 'a'), paketS('gibtsnicht', '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    lauf('handleSetAussehen', 15, peerI(a, 'a'), paketS(FRISUR_VORGABE, 'nix', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    const mit = peerI(a, 'm', { inventar: inventarMit() });
    lauf('handleSetAussehen', 16, mit, paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify(teile)));
    a.zustand.push(String(mit['ruestung']).length, angelegt(mit));
    lauf('handleSetAussehen', 17, mit, paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    a.zustand.push(String(mit['ruestung']).length, angelegt(mit));
    charZdo = undefined;
    lauf('handleSetAussehen', 18, peerI(a, 'a'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    charZdo = zdoA(a);
    lauf('handleSetAussehen', 19, peerI(a, 'a'), new Reader(Buffer.alloc(0)));
    // figure: new, same, unknown, no character
    const f = peerI(a, 'f', { figur: F0 });
    lauf('handleSetFigur', 20, f, paketS(F1));
    a.zustand.push(f['figur'] === F1 ? 1 : 0);
    lauf('handleSetFigur', 21, f, paketS(F1));
    lauf('handleSetFigur', 22, f, paketS('drache'));
    charZdo = undefined;
    lauf('handleSetFigur', 23, peerI(a, 'f', { figur: F0 }), paketS(F1));
    charZdo = zdoA(a);
    lauf('handleSetFigur', 24, peerI(a, 'f', { figur: F0 }), new Reader(Buffer.alloc(0)));
  } finally {
    ruecksetzen();
  }
  return a;
}

/** The same on a real instance through the methods of the class (forwardings); the ZDO space is a real one. */
function messeInteraktionEcht(): Aufzeichnung3 {
  const a = neueAufzeichnung3();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    const server = createWovServer({
      port: 0, worldFeatures: false, worldName: 'i1-form-k3', everyoneAdmin: true,
      worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
    } as never) as unknown as Record<string, unknown>;
    // the main world only exists after init(): a real ZDO space is enough for `zdosVon`
    (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, { zdos: new ZDOManager(1n) });
    server['inventarSync'] = (): void => { zaehle(a, 'inventarSync'); };
    server['kappeLeben'] = (): void => { zaehle(a, 'kappeLeben'); };
    server['sichereSpielerSofort'] = (_p: unknown, grund: unknown): void => { zaehle(a, 'sichereSpielerSofort'); a.notizen.push(`sofort:${String(grund)}`); };
    const rufe = (name: string, seed: number, ...args: unknown[]): void => versuche(a, () => mitZufall(seed, () => (server[name] as (...x: unknown[]) => unknown).call(server, ...args)));
    const ep = peerI(a, 'e', { worldId: HAUPTWELT_ID, userId: 1, inventar: inventarMit() });
    const zm = (server['zdosVon'] as (p: unknown) => ZDOManager).call(server, ep);
    const truhe = zm.createZDO(1234, { x: 0, y: 0, z: 0 });
    const chr = zm.createZDO(4321, { x: 0, y: 0, z: 0 });
    ep['characterID'] = chr.zdoid;
    rufe('handleTruheOeffnen', 1, ep, truhe, { name: 'trollcave_chest' });
    a.zustand.push(truhe.getInt(TRUHE_LOOTED_MEMBER), truhe.getString(TRUHE_INHALT_MEMBER).length);
    rufe('handleTruheOeffnen', 2, ep, truhe, { name: 'trollcave_chest' });
    rufe('sendeTruheInhalt', 3, ep, truhe);
    const teile = teileWild();
    rufe('handleSetAussehen', 4, ep, paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify(teile)));
    a.zustand.push(String(ep['ruestung']).length, angelegt(ep), chr.getString('ruestung').length, chr.getString('frisur').length);
    rufe('handleSetAussehen', 5, ep, paketS('nein', '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    rufe('handleSetAussehen', 6, ep, paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{x'));
    rufe('handleSetAussehen', 7, ep, paketS(FRISUR_VORGABE, '', ''));
    a.zustand.push(String(ep['ruestung']).length, angelegt(ep));
    rufe('handleSetFigur', 8, ep, paketS(F1));
    rufe('handleSetFigur', 9, ep, paketS(F1));
    rufe('handleSetFigur', 10, ep, paketS('drache'));
    a.zustand.push(ep['figur'] === F1 ? 1 : 0, chr.getString('figur') === F1 ? 1 : 0);
    (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

function chatPeer(a: Aufzeichnung3, name: string, id: number, x: number, welt: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, userId: id, worldId: welt, position: { x, y: 0, z: 0 }, nurEditor: false,
    sendPacket(type: PacketType, payload: Buffer): void {
      const r = new Reader(payload);
      const erstes = r.readString();
      const absender = r.readString();
      const typ = r.readInt32();
      const text = r.readString();
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify([erstes, absender, typ, text.slice(0, 14), text.length])}`);
    },
    ...o,
  };
}
/** The chat handler on a stand-in: who receives what (range by type, world, sender always), the console line, refusals. */
function messeChatAttrappe(): Aufzeichnung3 {
  const a = neueAufzeichnung3();
  const ruecksetzen = konsole(a);
  const liste: Record<string, unknown>[] = [];
  const k: Record<string, unknown> = { net: { getPeers: (): unknown[] => { zaehle(a, 'getPeers'); return liste; } } };
  const lauf = (p: unknown, r: Reader): void => versuche(a, () => F['handleChatMessage']!(k, p, r));
  const chat = (typ: number, text: string): Reader => leser((w) => { w.writeInt32(typ); w.writeString(text); });
  try {
    const ich = chatPeer(a, 'ich', 1, 0, HAUPTWELT_ID);
    liste.push(ich, chatPeer(a, 'nah', 2, 5, HAUPTWELT_ID), chatPeer(a, 'mittel', 3, 40, HAUPTWELT_ID), chatPeer(a, 'fern', 4, 100, HAUPTWELT_ID), chatPeer(a, 'weit', 5, 300, HAUPTWELT_ID), chatPeer(a, 'inst', 6, 1, 'dungeon:x'));
    for (const t of [ChatMsgType.Normal, ChatMsgType.Whisper, ChatMsgType.Shout, 99]) lauf(ich, chat(t, 'Hallo Welt'));
    lauf(ich, chat(ChatMsgType.Normal, 'Grüße aus Ägir — ß'));
    lauf(ich, chat(ChatMsgType.Normal, 'x'.repeat(5000)));
    lauf(ich, chat(ChatMsgType.Normal, ''));
    lauf(chatPeer(a, 'ed', 9, 0, HAUPTWELT_ID, { nurEditor: true }), chat(ChatMsgType.Normal, 'still'));
    lauf(chatPeer(a, 'ed', 9, 0, HAUPTWELT_ID, { nurEditor: true }), new Reader(Buffer.alloc(0)));
    lauf(ich, new Reader(Buffer.alloc(0)));
    lauf(ich, leser((w) => w.writeInt32(1)));
    liste.length = 0;
    lauf(ich, chat(ChatMsgType.Normal, 'allein'));
    liste.push(ich, chatPeer(a, 'nah', 2, 5, HAUPTWELT_ID));
    lauf(chatPeer(a, 'ich', 1, 0, 'dungeon:x'), chat(ChatMsgType.Normal, 'drin'));
    a.zustand.push(liste.length);
  } finally {
    ruecksetzen();
  }
  return a;
}
function messeChatEcht(): Aufzeichnung3 {
  const a = neueAufzeichnung3();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    const server = createWovServer({
      port: 0, worldFeatures: false, worldName: 'i1-form-k3c', everyoneAdmin: true,
      worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
    } as never) as unknown as Record<string, unknown>;
    const liste: Record<string, unknown>[] = [];
    (server['net'] as Record<string, unknown>)['getPeers'] = (): unknown[] => { zaehle(a, 'getPeers'); return liste; };
    const rufe = (p: unknown, r: Reader): void => versuche(a, () => (server['handleChatMessage'] as (x: unknown, y: unknown) => unknown).call(server, p, r));
    const ich = chatPeer(a, 'a', 1, 0, HAUPTWELT_ID);
    liste.push(ich, chatPeer(a, 'b', 2, 20, HAUPTWELT_ID), chatPeer(a, 'd', 3, 200, HAUPTWELT_ID), chatPeer(a, 'i', 4, 1, 'dungeon:x'));
    for (const t of [ChatMsgType.Normal, ChatMsgType.Whisper, ChatMsgType.Shout]) rufe(ich, leser((w) => { w.writeInt32(t); w.writeString('Hallo Ägir'); }));
    rufe(chatPeer(a, 'ed', 9, 0, HAUPTWELT_ID, { nurEditor: true }), leser((w) => { w.writeInt32(1); w.writeString('still'); }));
    rufe(ich, new Reader(Buffer.alloc(0)));
    (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

/** Measured on the stand before the move (`--messen-basis`); the packets: peer:type:[ok, first 22 characters of the message]. */
const SOLL_ATTRAPPE: Aufzeichnung = {
  paket: [
    'n:InteractResult:[false,"Keine Berechtigung, di"]',
    'a:AdminEvent:["fly",false,"ran:fly"]',
    'a:AdminEvent:["fly",true,"ran:Fly  on"]',
    'a:AdminEvent:["",false,"ran:"]',
    'a:DungeonEditData:[true,"d2"]',
    'a:DungeonEditData:[true,"d1"]',
    'a:DungeonEditData:[false,"Unbekannter Dungeon: z"]',
    'a:DungeonEditData:[false,"Unbekannter Dungeon: ("]',
    'a:DungeonEditData:[true,"d1"]',
    'n:DungeonEditData:[false,"Keine Berechtigung"]',
    'n:DungeonEditData:[false,"Keine Berechtigung"]',
    'a:DungeonEditData:[false,"Dokument zu groß (max "]',
    'a:DungeonEditData:[false,"Registry veraltet — Se"]',
    'a:DungeonEditData:[false,"Ungültiges JSON"]',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]',
    'a:DungeonEditData:[false,"Dokument 2.0 abgelehnt"]',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]',
    'a:DungeonEditData:[false,"Dokument abgelehnt (Ba"]',
    'n:DungeonModulBauErgebnis:[false,"Keine Berechtigung"]',
    'a:DungeonModulBauErgebnis:[false,"Zellzahl x = 1 liegt a"]',
    'a:DungeonModulBauErgebnis:[true,"Gebaut: Gen_StoneVault"]',
    'a:DungeonModulBauErgebnis:[false,"Der Saal \'Gen_StoneVau"]',
    'n:DungeonModulLoeschErgebnis:[false,"Keine Berechtigung"]',
    'a:DungeonModulLoeschErgebnis:[false,"Modulname \'../x\' enthä"]',
    'a:DungeonModulLoeschErgebnis:[true,"Entfernt: Gen_StoneVau"]',
    'a:DungeonModulLoeschErgebnis:[false,"Die Registry kennt \'Ge"]',
    'a:DungeonModulBauErgebnis:[false,"Modulbau ist ausgescha"]',
    'a:DungeonModulLoeschErgebnis:[false,"Modulbau ist ausgescha"]',
  ],
  aufrufe: { getPeers: 4, sendTimeSync: 8, execute: 3, getDokument2: 4, getDocument: 3, upsertDokument2: 4, enterDungeon: 2, upsertDocument: 4, dungeonsWurzel: 5 },
  konsole: { log: 24, warn: 1 },
  zustand: [100, 1750, 5, 0, 0, 0, 0, 2, 1, 1],
  ausnahmen: ['RangeError'],
};
const SOLL_ECHT: Aufzeichnung = {
  paket: [
    'n:InteractResult:[false,"Keine Berechtigung, di"]',
    'e:AdminEvent:["unbekanntes-kommando",false,"Unknown admin command:"]',
    'e:AdminEvent:["",false,"Empty admin command"]',
    'n:AdminEvent:["fly",false,"Admin commands are not"]',
    'e:DungeonEditData:[false,"Unbekannter Dungeon: k"]',
    'n:DungeonEditData:[false,"Keine Berechtigung"]',
    'e:DungeonEditData:[true,"Gespeichert: k9-doc (2"]',
    'e:DungeonEditData:[true,"Gespeichert: k9-doc (2"]',
    'e:DungeonEditData:[false,"Registry veraltet — Se"]',
    'e:DungeonEditData:[false,"Dokument abgelehnt (Ba"]',
    'e:DungeonEditData:[true,"k9-doc"]',
    'e:DungeonModulBauErgebnis:[true,"Gebaut: Gen_StoneVault"]',
    'e:DungeonModulLoeschErgebnis:[true,"Entfernt: Gen_StoneVau"]',
  ],
  aufrufe: { getPeers: 4, sendTimeSync: 8, enterDungeon: 2 },
  konsole: { log: 16, warn: 1 },
  zustand: [100, 1750, 5, 0, 0, 0, 2, 1],
  ausnahmen: [],
};

/** Step 3, measured on the stand before the move: chest/appearance/figure (stand-in, real instance) and chat (stand-in, real instance). */
const SOLL_INTERAKTION_ATTRAPPE: Aufzeichnung3 = {
  paket: [
    't:InteractResult:[true,"Truhe geöffnet"]',
    't:ContainerSync:["u",7,19]',
    't:InteractResult:[true,"Truhe geöffnet"]',
    't:ContainerSync:["u",7,0]',
    't:InteractResult:[true,"Truhe geöffnet"]',
    't:ContainerSync:["u",7,19]',
    't:InteractResult:[true,"Truhe geöffnet"]',
    't:ContainerSync:["u",7,18]',
    't:ContainerSync:["u",7,19]',
  ],
  aufrufe: { setInt:  3,  setString:  35,  reviseData:  2,  sendeTruheInhalt:  4,  zdosVon:  11,  kappeLeben:  9,  sichereSpielerSofort:  11,  inventarSync:  6 },
  konsole: { log: 2, warn: 2 },
  zustand: [151, 5, 1, 0, 1],
  ausnahmen: ['TypeError', 'RangeError', 'RangeError'],
  notizen: [
    'setInt looted=1',
    'setString truheInhalt=19:5b46b599',
    'setInt looted=1',
    'setInt looted=1',
    'setString truheInhalt=18:540dba5e',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=dunkelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=dunkelbraun',
    'setString augenfarbe=eisblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=151:3a7a8d0f',
    'sofort:ausruestung',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'sofort:ausruestung',
    'sofort:ausruestung',
    'setString figur=wikingerin',
    'sofort:figur',
    'sofort:figur',
  ],
};
const SOLL_INTERAKTION_ECHT: Aufzeichnung3 = {
  paket: [
    'e:InteractResult:[true,"Truhe geöffnet"]',
    'e:ContainerSync:["1",1,19]',
    'e:InteractResult:[true,"Truhe geöffnet"]',
    'e:ContainerSync:["1",1,19]',
    'e:ContainerSync:["1",1,19]',
  ],
  aufrufe: { kappeLeben:  2,  sichereSpielerSofort:  3,  inventarSync:  2 },
  konsole: { log: 5, warn: 2 },
  zustand: [1, 19, 151, 5, 151, 4, 1, 0, 1, 1],
  ausnahmen: [],
  notizen: [
    'sofort:ausruestung',
    'sofort:ausruestung',
    'sofort:figur',
  ],
};
const SOLL_CHAT_ATTRAPPE: Aufzeichnung3 = {
  paket: [
    'ich:ChatMessage:["0","ich",1,"Hallo Welt",10]',
    'nah:ChatMessage:["0","ich",1,"Hallo Welt",10]',
    'mittel:ChatMessage:["0","ich",1,"Hallo Welt",10]',
    'ich:ChatMessage:["0","ich",0,"Hallo Welt",10]',
    'nah:ChatMessage:["0","ich",0,"Hallo Welt",10]',
    'ich:ChatMessage:["0","ich",2,"Hallo Welt",10]',
    'nah:ChatMessage:["0","ich",2,"Hallo Welt",10]',
    'mittel:ChatMessage:["0","ich",2,"Hallo Welt",10]',
    'fern:ChatMessage:["0","ich",2,"Hallo Welt",10]',
    'ich:ChatMessage:["0","ich",99,"Hallo Welt",10]',
    'nah:ChatMessage:["0","ich",99,"Hallo Welt",10]',
    'mittel:ChatMessage:["0","ich",99,"Hallo Welt",10]',
    'ich:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]',
    'nah:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]',
    'mittel:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]',
    'ich:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]',
    'nah:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]',
    'mittel:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]',
    'ich:ChatMessage:["0","ich",1,"",0]',
    'nah:ChatMessage:["0","ich",1,"",0]',
    'mittel:ChatMessage:["0","ich",1,"",0]',
  ],
  aufrufe: { getPeers:  9 },
  konsole: { log: 9, warn: 0 },
  zustand: [2],
  ausnahmen: ['RangeError', 'RangeError'],
  notizen: [
  ],
};
const SOLL_CHAT_ECHT: Aufzeichnung3 = {
  paket: [
    'a:ChatMessage:["0","a",1,"Hallo Ägir",10]',
    'b:ChatMessage:["0","a",1,"Hallo Ägir",10]',
    'a:ChatMessage:["0","a",0,"Hallo Ägir",10]',
    'a:ChatMessage:["0","a",2,"Hallo Ägir",10]',
    'b:ChatMessage:["0","a",2,"Hallo Ägir",10]',
    'd:ChatMessage:["0","a",2,"Hallo Ägir",10]',
  ],
  aufrufe: { getPeers:  3 },
  konsole: { log: 7, warn: 0 },
  zustand: [],
  ausnahmen: ['RangeError'],
  notizen: [
  ],
};

if (MESSEN_BASIS) {
  const attrappe = messeAttrappe();
  const echt = messeEcht();
  const interAttrappe = messeInteraktionAttrappe();
  const interEcht = messeInteraktionEcht();
  const chatAttrappe = messeChatAttrappe();
  const chatEcht = messeChatEcht();
  process.stdout.write(`${JSON.stringify({ attrappe, echt, interAttrappe, interEcht, chatAttrappe, chatEcht }, null, 1)}\n`);
  process.exit(0);
}

console.log('\n[2] Behaviour: the fixed sequence gives the numbers measured before the move');
{
  const gemessen = messeAttrappe();
  const gleich = (a: Aufzeichnung, b: Aufzeichnung): boolean => JSON.stringify(a) === JSON.stringify(b);
  check('stand-in for the server: the packets sent, in order', same(gemessen.paket, SOLL_ATTRAPPE.paket), `${gemessen.paket.length} packets, expected ${SOLL_ATTRAPPE.paket.length}; first difference: ${gemessen.paket.find((x, i) => x !== SOLL_ATTRAPPE.paket[i])}`);
  check('stand-in for the server: the calls into the context', JSON.stringify(gemessen.aufrufe) === JSON.stringify(SOLL_ATTRAPPE.aufrufe), JSON.stringify(gemessen.aufrufe));
  check('stand-in for the server: worldTime after each call and the files of the hall', same(gemessen.zustand, SOLL_ATTRAPPE.zustand), gemessen.zustand.join(','));
  check('stand-in for the server: the console output and the exceptions', JSON.stringify([gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([SOLL_ATTRAPPE.konsole, SOLL_ATTRAPPE.ausnahmen]), JSON.stringify([gemessen.konsole, gemessen.ausnahmen]));
  check('stand-in for the server: all of it', gleich(gemessen, SOLL_ATTRAPPE));
  const echt = messeEcht();
  check('real instance through the forwardings: the packets sent, in order', same(echt.paket, SOLL_ECHT.paket), `${echt.paket.length} packets, expected ${SOLL_ECHT.paket.length}; first difference: ${echt.paket.find((x, i) => x !== SOLL_ECHT.paket[i])}`);
  check('real instance through the forwardings: the calls into the instance', JSON.stringify(echt.aufrufe) === JSON.stringify(SOLL_ECHT.aufrufe), JSON.stringify(echt.aufrufe));
  check('real instance through the forwardings: worldTime after each call and the files of the hall', same(echt.zustand, SOLL_ECHT.zustand), echt.zustand.join(','));
  check('real instance through the forwardings: the console output and the exceptions', JSON.stringify([echt.konsole, echt.ausnahmen]) === JSON.stringify([SOLL_ECHT.konsole, SOLL_ECHT.ausnahmen]), JSON.stringify([echt.konsole, echt.ausnahmen]));
  check('real instance through the forwardings: all of it', gleich(echt, SOLL_ECHT));
}

console.log('\n[3] Behaviour of step 3: chest, appearance, figure and chat give the numbers measured before the move');
{
  const gleich = (a: Aufzeichnung3, b: Aufzeichnung3): boolean => JSON.stringify(a) === JSON.stringify(b);
  const teil = (titel: string, gemessen: Aufzeichnung3, soll: Aufzeichnung3): void => {
    check(`${titel}: the packets sent, in order`, same(gemessen.paket, soll.paket), `${gemessen.paket.length} packets, expected ${soll.paket.length}; first difference: ${gemessen.paket.find((x, i) => x !== soll.paket[i])}`);
    check(`${titel}: the calls into the context`, JSON.stringify(gemessen.aufrufe) === JSON.stringify(soll.aufrufe), JSON.stringify(gemessen.aufrufe));
    check(`${titel}: the writes to the ZDO and the reasons of the immediate saves`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])}`);
    check(`${titel}: the state numbers, the console output and the exceptions`, JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([soll.zustand, soll.konsole, soll.ausnahmen]), JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]));
    check(`${titel}: all of it`, gleich(gemessen, soll));
  };
  teil('chest/appearance/figure on a stand-in', messeInteraktionAttrappe(), SOLL_INTERAKTION_ATTRAPPE);
  teil('chest/appearance/figure on a real instance through the forwardings', messeInteraktionEcht(), SOLL_INTERAKTION_ECHT);
  teil('chat on a stand-in', messeChatAttrappe(), SOLL_CHAT_ATTRAPPE);
  teil('chat on a real instance through the forwarding', messeChatEcht(), SOLL_CHAT_ECHT);
}

console.log(failures === 0 ? `\n=== I1 form k: ALL PASSED (${total}) ===` : `\n=== I1 form k: ${failures} of ${total} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
