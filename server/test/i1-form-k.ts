/**
 * Form k of the modules under `server/src/spiel/` (refactoring I1, from step 2).
 * Die Form k der Module unter `server/src/spiel/`: eine Methode von `WovServer` wird eine Funktion mit Kontext.
 *
 * Step 2 moved six methods of `server/src/WovServer.ts` unchanged into two modules: the four dungeon editor handlers
 * into `spiel/DungeonEditPakete.ts`, the admin command handler and the time-of-day handler into `spiel/AdminPakete.ts`.
 * Step 3 moved five more: the chest, appearance and figure handlers into `spiel/Interaktion.ts` (`handleTruheOeffnen`,
 * `sendeTruheInhalt`, `handleSetAussehen`, `handleSetFigur`) and `handleChatMessage` into `spiel/Chat.ts`. `handleInteract` and
 * `handleContainerAction` stay in the class (they read the static member `WovServer.FREMDER_BESITZ_MELDUNG`, rule 5).
 * Step 1, package C, moved the registration of two admin commands into `spiel/befehle/Spieler.ts` (`registerTeleportCommand`,
 * `registerSpielerCommand`; the first sub-folder of `spiel/`). Their forwardings are called by the constructor, not by
 * `onPacket`, and the place of each call among the constructor's `this.register…();` calls is frozen: the order of
 * registration is behaviour (`teleport` overrides the base command of `AdminCommands`).
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
 *     Gaps of the first version, closed after the attack on step 2 (I12-B3): `k?.x` is no receiver, `k` and `this` may not stand in a default
 *     value of a parameter, `SpielKontext` must be the one from `./Kontext.js` (`import type`, own name), the forwarding carries no comment
 *     (before it or inside it), and an index signature of the class counts as a public member.
 *  6. The list of the NON-PRIVATE members of `WovServer` (fields, methods, parameter properties of the constructor) is
 *     frozen. Every step that needs a private member in its context relaxes it to public, and that widens the surface of
 *     the class for good; here the step says so, in `PUBLIC_MEMBERS`. A relaxation that is not listed turns this red.
 *     A forwarding whose method is itself a context member (`sendeTruheInhalt`, step 3) has no `private` in its frozen head.
 *  7. Behaviour: one fixed sequence of calls, on a stand-in for the server and on a real instance (through the
 *     forwarding methods), gives the numbers that were measured before the move (`SOLL_*`; measured with
 *     `--messen-basis` on the stand before the move, see below). Recorded are the packets sent, the calls into the
 *     context, the state changes and the exceptions.
 *  The packets are held completely (length and hash over all bytes, next to a readable head), the arguments of the calls into the
 *  context are held (`sendTimeSync(p)`, `enterDungeon(peer, id)`, `upsertDokument2(raw)`), the save sequence has cases without checksum
 *  (an old client) and exactly at the size limit, and `onPacket` maps every packet type to its forwarding (attack on step 2, I12-B1).
 *  Step 3 (attack I13-B1): the peers start with values that are not the defaults (hair, eyes, armour, position with y != 0), the whole
 *  state of a peer is held after every packet (all appearance fields, the armour as text, the position, the parts of the inventory with
 *  their flag), `sichereSpielerSofort` is held with ALL its arguments, the calls into the context are held as an ordered list with their
 *  arguments, and every console line is held by its text.
 *  Step 1, package C: the commands `teleport` and `spieler` with all sub-commands and their error branches, on a stand-in (the handlers
 *  registered by the functions, every call into the context with its arguments, the message as text, the peer state after every call,
 *  a member replaced on the stand-in between registration and call) and on a real instance (the registry its constructor built, with a
 *  real dungeon instance that `teleport` leaves, and the two forwardings called again on the instance).
 *  Step 1, package C, after the attack (N1): names that differ only in Unicode form or trailing space, the caller itself online with a
 *  record of its own, an editor that is admin, exactly one player online, the same name twice in one command, two records with the same
 *  name, `dungeons` replaced after the registration, and `getGroundHeight` called on its receiver; the relaxed members keep `readonly`
 *  exactly as frozen in `LOCKERUNGEN_C`.
 *  Not applicable in steps 1 to 3: the identity of returned objects of the stock (K9-5), no function returns a value.
 *
 * Section [0] shows first that each check can turn red: the same checks run over small invented sources, one fault
 * each (`red:`), and over a good stand (`green:`).
 *
 * `--messen-basis`: prints the measured summaries (step 2: stand-in and real instance; step 3: the same for the chest,
 * appearance, figure and chat handlers; step 1 package C: the same for `teleport` and `spieler`) for the stand BEFORE the move, calling `WovServer.prototype.<name>` with
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
import { join, posix, resolve } from 'node:path';
import * as ts from 'typescript';
import { PacketType, WORLD_TIME_LENGTH, dungeon2, Inventory, WILDWARDEN_PARTS, findItem, FRISUR_VORGABE, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, RUESTUNG, FIGUREN, FRISUREN, HAARFARBEN, AUGENFARBEN, encodeArmor, TRUHE_INHALT_MEMBER, TRUHE_LOOTED_MEMBER, packContainer, unpackContainer, ChatMsgType } from '@wov/shared';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { WovServer, createWovServer } from '../src/WovServer.js';
import { registryChecksum } from '../src/world/dungeon/ModuleBuild.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
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
  /** The method of the class that calls `this.<name>(<args>)` (`onPacket` for the packet handlers, `constructor` for the command registrations). */
  readonly aufrufer: { readonly methode: string; readonly args: string };
  /**
   * Only for a caller `constructor`: the place (from 0) of `this.<name>();` among the statements `this.register…();` of the
   * constructor. The order of registration is behaviour: a later `register` of the same name replaces the handler (step 1).
   */
  readonly aufrufNr?: number;
  /** `Function.length` of the method on the prototype: the number of parameters of the forwarding. */
  readonly laenge: number;
  /** The packet type whose `case` in `onPacket` calls `this.<name>(peer, reader)` (the name of the method without `handle`); none when no packet leads here. */
  readonly paketTyp?: string;
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
const PAKET = (name: string): FunktionSpec => ({ name, kopf: KOPF(name), aufrufer: { methode: 'onPacket', args: 'peer, reader' }, laenge: 2, paketTyp: name.replace(/^handle/, '') });
/** A command registration: private forwarding without parameters, called by the constructor at the frozen place among its `this.register…();` calls. */
const REGISTRIERUNG_C = (name: string, aufrufNr: number): FunktionSpec => ({ name, kopf: `private ${name}(): void`, aufrufer: { methode: 'constructor', args: '' }, laenge: 0, aufrufNr });
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
  {
    // step 1, package C: the first module in a sub-folder of spiel/ (its context file is `../Kontext.js`)
    datei: 'server/src/spiel/befehle/Spieler.ts',
    spezifizierer: './spiel/befehle/Spieler.js',
    kontextTyp: 'SpielerKontext',
    mitglieder: ['adminCommands', 'dungeons', 'getGroundHeight', 'teleportPeer', 'savedPlayers', 'net', 'spielerSicherung'],
    wertImporte: ['../../net/Namen.js'],
    // `teleport` first: it overrides the base `teleport` of AdminCommands and is registered before every other command of the server
    funktionen: [REGISTRIERUNG_C('registerTeleportCommand', 0), REGISTRIERUNG_C('registerSpielerCommand', 1)],
  },
];

/**
 * The non-private members of `WovServer`, sorted: 36 before step 2, plus `dungeonsWurzel`, `sendTimeSync` and `worldTime`
 * (context members of step 2, relaxed from private), plus `inventarSync`, `kappeLeben`, `sendeTruheInhalt`,
 * `sichereSpielerSofort` and `zdosVon` (context members of step 3, relaxed from private), plus `savedPlayers`,
 * `spielerSicherung` and `teleportPeer` (context members of step 1, package C, relaxed from private). One per line; a later
 * step adds its relaxations here, each with a reason.
 */
const PUBLIC_MEMBERS: readonly string[] = [
  'adminCommands',
  'adminListe',
  'aggro',
  'beuteAmBoden', // D5: the loot on the ground; public so that d5-beute can wind its clock forward and read the tally
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
  'savedPlayers', // step 1 (package C): context member of befehle/Spieler (the field stays in the class; tests set and read it)
  'sendTimeSync', // step 2: context member of AdminPakete
  'sendeTruheInhalt', // step 3: context member of Interaktion (the forwarding itself is public)
  'serverUserId',
  'sichereSpielerSofort', // step 3: context member of Interaktion (F8, #146)
  'spawns',
  'spielerSicherung', // step 1 (package C): context member of befehle/Spieler (`spieler entfernen` forgets the record)
  'start',
  'stop',
  'teleportPeer', // step 1 (package C): context member of befehle/Spieler (the `teleport` command moves the peer)
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
        } else if (ts.isPropertyAccessExpression(par) && par.expression === n && par.questionDotToken !== undefined) {
          f.push(`line ${line(n)}: ${fn.name?.text} reads \`k?.${par.name.getText(sf)}\`: the context is never missing, an optional chain would hide a missing member`);
        } else if (!(ts.isPropertyAccessExpression(par) && par.expression === n)) f.push(`line ${line(n)}: ${fn.name?.text} uses \`k\` as a value (${par.getText(sf).slice(0, 40)}): only \`k.<member>\` is allowed`);
      }
      ts.forEachChild(n, gehe);
    };
    for (const par of fn.parameters) gehe(par); // default values and types of the parameters: no `this`, `k` only as a receiver
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
  // the context type is `SpielKontext` from `spiel/Kontext.ts` (`./Kontext.js` for a module in spiel/, `../Kontext.js` one folder below),
  // imported as `import type { SpielKontext }` under its own name: a look-alike from another file could be `any`
  {
    const kontextSpez = `${posix.relative(posix.dirname(spec.datei), 'server/src/spiel') || '.'}/Kontext.js`;
    const importe = sf.statements.filter((x): x is ts.ImportDeclaration => ts.isImportDeclaration(x) && !!x.importClause?.namedBindings && ts.isNamedImports(x.importClause.namedBindings) && x.importClause.namedBindings.elements.some((e) => e.name.text === 'SpielKontext'));
    const el = importe[0]?.importClause?.namedBindings;
    const ok = importe.length === 1 && importe[0]!.importClause!.isTypeOnly && ts.isStringLiteral(importe[0]!.moduleSpecifier) && importe[0]!.moduleSpecifier.text === kontextSpez && !!el && ts.isNamedImports(el) && el.elements.length === 1 && el.elements[0]!.propertyName === undefined;
    if (!ok) f.push(`\`SpielKontext\` must come from \`import type { SpielKontext } from '${kontextSpez}'\`, one import, under its own name`);
  }
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
      // no comment at the forwarding (rule 4.5): before it only blank space or a section line that stood there; inside it nothing but the one statement
      // before it: exactly the one new blank line of rule 4.5a and nothing else, no comment and no section line (H5, H9 of the attack on step 3);
      // no function of steps 2 and 3 had a section line before it. A later step that moves a method with a section line before it needs a field of FunktionSpec whose value the test
      // compares with the line at the place before the move (a bare name in a spec would be a statement nobody checks); that is not built here.
      const davorText = text.slice(m.getFullStart(), m.getStart(sf));
      const davor = davorText.split('\n').map((z) => z.trim()).filter((z) => z !== '');
      if (davor.length > 0) f.push(`${fn.name}: before the forwarding stands "${davor[0]!.slice(0, 40)}", allowed is nothing (no comment, no section line)`);
      else if (davorText !== '\n\n  ') f.push(`${fn.name}: rule 4.5a wants exactly one new blank line before the forwarding`);
      if (body) {
        const gesamt = text.slice(m.getStart(sf), m.getEnd()).replace(/\s+/g, ' ');
        const erwartet = `${fn.kopf} { return ${fn.name}(${['this', ...m.parameters.map((p) => p.name.getText(sf))].join(', ')}); }`;
        if (gesamt !== erwartet) f.push(`${fn.name}: the forwarding reads "${gesamt.slice(0, 120)}", expected "${erwartet}" (a comment or another token inside it)`);
      }
      // behind it on the same line: nothing; a comment there belongs to the trivia of the next member and escapes the comparison of the text above (H8)
      const zeilenEnde = text.indexOf('\n', m.getEnd());
      const dahinter = text.slice(m.getEnd(), zeilenEnde === -1 ? text.length : zeilenEnde);
      if (dahinter.trim() !== '') f.push(`${fn.name}: behind the forwarding on its last line stands "${dahinter.trim().slice(0, 40)}"`);
      // the line directly below it: blank (or the end of the class); a comment there is trivia of the next member and escapes every comparison above (H11 of the second re-attack)
      const naechsteZeile = zeilenEnde === -1 ? '' : text.slice(zeilenEnde + 1, text.indexOf('\n', zeilenEnde + 1) === -1 ? text.length : text.indexOf('\n', zeilenEnde + 1)).trim();
      if (naechsteZeile !== '' && naechsteZeile !== '}') f.push(`${fn.name}: the line directly below the forwarding is not blank ("${naechsteZeile.slice(0, 40)}")`);
      if (ts.canHaveDecorators(m) && (ts.getDecorators(m) ?? []).length > 0) f.push(`${fn.name}: a decorator`);
      const st = body?.statements ?? [];
      const r = st[0];
      if (st.length !== 1 || !r || !ts.isReturnStatement(r) || !r.expression || !ts.isCallExpression(r.expression)) { f.push(`${fn.name}: the body is not the one statement \`return ${fn.name}(this, …);\``); continue; }
      const c = r.expression;
      const args = c.arguments.map((a) => a.getText(sf));
      const soll = ['this', ...m.parameters.map((p) => p.name.getText(sf))];
      const ok = ts.isIdentifier(c.expression) && c.expression.text === fn.name && !c.typeArguments && !c.questionDotToken && c.arguments[0]?.kind === ts.SyntaxKind.ThisKeyword && same(args, soll);
      if (!ok) f.push(`${fn.name}: the call is \`${c.getText(sf)}\`, expected \`${fn.name}(${soll.join(', ')})\` with a plain \`this\``);
      // the caller in the class (`onPacket`, the constructor or another method that stays) still calls the method by its name
      const aufrufer = fn.aufrufer.methode === 'constructor'
        ? klasse.members.find((x): x is ts.ConstructorDeclaration => ts.isConstructorDeclaration(x))
        : klasse.members.find((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && nameVon(x) === fn.aufrufer.methode);
      let ruft = false;
      const gehe = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword && n.expression.name.text === fn.name && n.arguments.map((a) => a.getText(sf)).join(',') === fn.aufrufer.args.replace(/ /g, '')) ruft = true;
        ts.forEachChild(n, gehe);
      };
      if (aufrufer) gehe(aufrufer);
      if (!ruft) f.push(`${fn.name}: ${fn.aufrufer.methode} does not call this.${fn.name}(${fn.aufrufer.args})`);
      // a registration: its place among the constructor's statements `this.register…();` (step 1; a swapped order replaces another handler)
      if (fn.aufrufNr !== undefined) {
        const ctor = klasse.members.find((x): x is ts.ConstructorDeclaration => ts.isConstructorDeclaration(x));
        const folge: string[] = [];
        for (const st of ctor?.body?.statements ?? []) {
          const e = ts.isExpressionStatement(st) ? st.expression : undefined;
          if (e && ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.expression.kind === ts.SyntaxKind.ThisKeyword && /^register/.test(e.expression.name.text)) folge.push(e.expression.name.text);
        }
        const platz = folge.indexOf(fn.name);
        if (platz !== fn.aufrufNr || folge.filter((x) => x === fn.name).length !== 1) f.push(`${fn.name}: the constructor calls it as registration no. ${platz} (${folge.filter((x) => x === fn.name).length} times) of ${folge.length}, frozen: no. ${fn.aufrufNr}, once (the order of registration is behaviour)`);
      }
      // the packet type leads to its forwarding: `case PacketType.<Type>:` in `onPacket` calls it (swapped cases stay green otherwise)
      if (fn.paketTyp !== undefined) {
        let fall = false;
        const suche = (n: ts.Node): void => {
          if (ts.isCaseClause(n) && n.expression.getText(sf) === `PacketType.${fn.paketTyp}` && n.statements.map((x) => x.getText(sf)).join(' ').replace(/\s+/g, '').includes(`this.${fn.name}(peer,reader)`)) fall = true;
          ts.forEachChild(n, suche);
        };
        if (aufrufer) suche(aufrufer);
        if (!fall) f.push(`${fn.name}: \`case PacketType.${fn.paketTyp}:\` of ${fn.aufrufer.methode} does not call this.${fn.name}(peer, reader)`);
      }
    }
  }
  // 6. the non-private members
  const oeff: string[] = [];
  for (const m of klasse.members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) if (ts.getModifiers(p)?.length && !hasMod(p, ts.SyntaxKind.PrivateKeyword) && !hasMod(p, ts.SyntaxKind.ProtectedKeyword) && ts.isIdentifier(p.name)) oeff.push(p.name.text);
      continue;
    }
    if (ts.isIndexSignatureDeclaration(m)) { oeff.push('<index signature>'); continue; } // an index signature opens the class to every name (SpielKontext<\'privatesFeld\'>)
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

// ── Step 1, package C (N1): the modifiers of the members package C relaxed ──
/** The members package C relaxed from private, with the modifiers they must keep (`readonly` stays where it stood). */
const LOCKERUNGEN_C: Readonly<Record<string, string>> = { savedPlayers: 'readonly', spielerSicherung: '', teleportPeer: '' };
function pruefeLockerungenC(text: string): string[] {
  const f: string[] = [];
  const sf = parse('WovServer.ts', text);
  const klasse = sf.statements.find((x): x is ts.ClassDeclaration => ts.isClassDeclaration(x) && x.name?.text === 'WovServer');
  if (!klasse) return ['class WovServer not found'];
  for (const [name, soll] of Object.entries(LOCKERUNGEN_C)) {
    const m = klasse.members.filter((x) => x.name?.getText(sf) === name);
    const ist = m.length === 1 ? mods(m[0]!).map((x) => x.getText(sf)).join(' ') : `${m.length} members`;
    if (ist !== soll) f.push(`${name}: modifiers "${ist}", frozen "${soll}"`);
  }
  return f;
}

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
    ['an optional chain on the context (I12-B3)', gutePakete(gutesModul, MF('  k.a.x(peer, reader, PacketType.Chat);', '  k?.a.x(peer, reader, PacketType.Chat);'))],
    ['SpielKontext from another file (I12-B3)', gutePakete(gutesModul, MF("from './Kontext.js';", "from '../util/Anders.js';"))],
    ['SpielKontext imported under another name (I12-B3)', gutePakete(gutesModul, MF("import type { SpielKontext } from './Kontext.js';", "import type { SpielKontext as SK } from './Kontext.js';\nimport type { SpielKontext } from './Anders.js';"))],
    ['the context in a default value of a parameter (I12-B3)', gutePakete(gutesModul, MF('function fa(k: TestKontext, peer: Peer, reader: Reader): void {', 'function fa(k: TestKontext, peer: Peer, reader: Reader = (k as never as Reader)): void {'))],
    ['this in a default value of a parameter (I12-B3)', gutePakete(gutesModul, MF('function fa(k: TestKontext, peer: Peer, reader: Reader): void {', 'function fa(k: TestKontext, peer: Peer, reader: Reader = this.r): void {'))],
  ];
  for (const [name, text] of modulFehler) {
    const f = pruefeModul(S, text);
    check(`red: module, ${name}`, f.length > 0, show(f) || 'no finding');
  }
  // a module one folder below spiel/ (step 1): its context file is `../Kontext.js`; `./Kontext.js` would be a look-alike next to it
  const SB: ModulSpec = { ...S, datei: 'server/src/spiel/befehle/Test.ts', spezifizierer: './spiel/befehle/Test.js' };
  const modulUnten = gutesModul.replace("from './Kontext.js';", "from '../Kontext.js';").replace("from '../net/Peer.js';", "from '../../net/Peer.js';").replace("from '../io/Reader.js';", "from '../../io/Reader.js';");
  check('green: the good module one folder below spiel/', pruefeModul(SB, modulUnten).length === 0, show(pruefeModul(SB, modulUnten)));
  check('red: module one folder below spiel/, SpielKontext from ./Kontext.js (a file next to it, not spiel/Kontext.ts)', pruefeModul(SB, gutesModul).length > 0, show(pruefeModul(SB, gutesModul)) || 'no finding');
  check('red: module in spiel/, SpielKontext from ../Kontext.js', pruefeModul(S, modulUnten).length > 0, show(pruefeModul(S, modulUnten)) || 'no finding');

  const gutesGebaeude = (extra = '', oeff = 'readonly net = 1;', konstruktor = 'readonly config: number, private readonly geheim: number'): string =>
    [
      "import { fa, fb } from './spiel/Test.js';",
      'export class WovServer {',
      `  constructor(${konstruktor}) {}`,
      `  ${oeff}`,
      '  private onPacket(peer: Peer, type: number, reader: Reader): void {',
      '    switch (type) {',
      '      case PacketType.fa:',
      '        this.fa(peer, reader);',
      '        break;',
      '      case PacketType.fb:',
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
  const mitAbschnitt = gut.replace('\n  private fb(', '\n  // ── Weiterleitungen ─────────────\n  private fb(');
  check('red: a section line before a forwarding, whoever names it (H5, H9: no field allows one)', pruefeKlasse([S], mitAbschnitt, OEFF).length > 0, show(pruefeKlasse([S], mitAbschnitt, OEFF)) || 'no finding');
  const hinten = (z: string): string => gut.replace('    return fa(this, peer, reader);\n  }\n', `    return fa(this, peer, reader);\n  }${z}\n`);
  check('red: a line comment behind a forwarding on its last line (H8)', pruefeKlasse([S], hinten(' // comment'), OEFF).length > 0, show(pruefeKlasse([S], hinten(' // comment'), OEFF)) || 'no finding');
  const darunter = pruefeKlasse([S], gut.replace('  }\n\n  private fb(', '  }\n  // note\n\n  private fb('), OEFF);
  check('red: a comment on the line directly below a forwarding (H11)', darunter.some((x) => x.includes('directly below')), show(darunter) || 'no finding');
  check('red: a comment block on the line directly below a forwarding (H11)', pruefeKlasse([S], gut.replace('  }\n\n  private fb(', '  }\n  /* note */\n\n  private fb('), OEFF).some((x) => x.includes('directly below')));
  check('red: a block comment behind a forwarding on its last line (H8)', pruefeKlasse([S], hinten(' /* comment */'), OEFF).length > 0, show(pruefeKlasse([S], hinten(' /* comment */'), OEFF)) || 'no finding');
  check('red: two blank lines before a forwarding (rule 4.5a wants one)', pruefeKlasse([S], gut.replace('\n\n  private fb(', '\n\n\n  private fb('), OEFF).length > 0);
  check('red: no blank line before a forwarding', pruefeKlasse([S], gut.replace('\n\n  private fb(', '\n  private fb('), OEFF).length > 0);
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
    ['the cases of two packet types swapped', gut.replace('case PacketType.fa:', 'case PacketType.XX:').replace('case PacketType.fb:', 'case PacketType.fa:').replace('case PacketType.XX:', 'case PacketType.fb:'), OEFF],
    ['onPacket without the call', gut.replace('        this.fb(peer, reader);\n', '        void 0;\n'), OEFF],
    ['a new public field (a relaxation nobody listed)', gutesGebaeude('', 'readonly net = 1;\n  saveTimer = 0;'), OEFF],
    ['a public member the list does not know', gutesGebaeude('', 'readonly net = 1;'), OEFF.filter((x) => x !== 'config')],
    ['a public member made private', gutesGebaeude('', 'private net = 1;'), OEFF],
    ['a parameter property relaxed', gutesGebaeude('', 'readonly net = 1;', 'readonly config: number, readonly geheim: number'), OEFF],
    ['a public method added', gutesGebaeude('  neu(): void {}'), OEFF],
    ['a doc comment at the forwarding (I12-B3)', gut.replace('  private fa(', '  /** forwarding, see spiel/Test.ts */\n  private fa('), OEFF],
    ['a line comment at the forwarding (I12-B3)', gut.replace('  private fb(', '  // forwards\n  private fb('), OEFF],
    ['a comment inside the forwarding (I12-B3)', gut.replace('return fa(this, peer, reader);', 'return fa(this /* the server */, peer, reader);'), OEFF],
    ['an index signature in the class (I12-B3)', gutesGebaeude('', 'readonly net = 1;\n  [name: string]: unknown;'), OEFF],
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
  // registrations without parameters, called by the constructor at a frozen place among its `this.register…();` calls (step 1)
  const S1: ModulSpec = {
    datei: 'server/src/spiel/befehle/Test1.ts', spezifizierer: './spiel/befehle/Test1.js', kontextTyp: 'Test1Kontext', mitglieder: ['a'], wertImporte: [],
    funktionen: [REGISTRIERUNG_C('registerEins', 0), REGISTRIERUNG_C('registerZwei', 1)],
  };
  const gut1 = [
    "import { registerEins, registerZwei } from './spiel/befehle/Test1.js';",
    'export class WovServer {',
    '  readonly a = 1;',
    '  constructor() {',
    '    this.vorher = 1;',
    '    this.registerEins();',
    '    this.registerZwei();',
    '    this.registerDrei();',
    '  }',
    '',
    '  private registerEins(): void {',
    '    return registerEins(this);',
    '  }',
    '',
    '  private registerZwei(): void {',
    '    return registerZwei(this);',
    '  }',
    '',
    '  private registerDrei(): void {}',
    '}',
    '',
  ].join('\n');
  check('green: the good class with two registrations called by the constructor', pruefeKlasse([S1], gut1, ['a']).length === 0, show(pruefeKlasse([S1], gut1, ['a'])));
  const klassenFehler1: [string, string][] = [
    ['the constructor calls the registrations in another order', gut1.replace('    this.registerEins();\n    this.registerZwei();', '    this.registerZwei();\n    this.registerEins();')],
    ['another registration before the first one', gut1.replace('    this.registerEins();', '    this.registerDrei();\n    this.registerEins();')],
    ['a registration called twice', gut1.replace('    this.registerDrei();', '    this.registerDrei();\n    this.registerEins();')],
    ['the constructor does not call a registration', gut1.replace('    this.registerZwei();\n', '')],
    ['a registration called by another method, not the constructor', gut1.replace('    this.registerZwei();\n', '').replace('  private registerDrei(): void {}', '  private registerDrei(): void {\n    this.registerZwei();\n  }')],
    ['the forwarding passes an argument', gut1.replace('return registerZwei(this);', 'return registerZwei(this, 1);')],
    ['the forwarding gained a parameter', gut1.replace('  private registerEins(): void {\n    return registerEins(this);', '  private registerEins(x = 0): void {\n    return registerEins(this, x);')],
    ['the forwarding without return', gut1.replace('    return registerEins(this);', '    registerEins(this);')],
  ];
  for (const [name, text] of klassenFehler1) {
    const f = pruefeKlasse([S1], text, ['a']);
    check(`red: class, ${name}`, f.length > 0, show(f) || 'no finding');
  }
}

// ── [1] The real sources ───────────────────────────────────────────────

const klassenText = readFileSync(join(WURZEL, 'server/src/WovServer.ts'), 'utf8');
const alleNamen = MODULE.flatMap((m) => m.funktionen.map((x) => x.name));

console.log('\n[1] The modules under server/src/spiel/ and the forwardings in WovServer.ts');
if (!MESSEN_BASIS) {
  // every .ts file under spiel/, sub-folders included (step 1 put the first module into spiel/befehle/)
  const alleTs = (ordner: string): string[] => readdirSync(join(WURZEL, ordner), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? alleTs(`${ordner}/${e.name}`) : e.name.endsWith('.ts') ? [`${ordner}/${e.name}`] : []));
  const dateien = alleTs('server/src/spiel');
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
  // step 1, package C (N1, B7 of the attack): the relaxed members keep the rest of their declaration; only `private` went
  check('step 1 (C): the relaxed members keep their modifiers (readonly where it stood)', pruefeLockerungenC(klassenText).length === 0, show(pruefeLockerungenC(klassenText)));
  check('step 1 (C) self-test: readonly lost on savedPlayers is seen', pruefeLockerungenC(klassenText.replace('  readonly savedPlayers = new Map', '  savedPlayers = new Map')).length > 0);
  check('step 1 (C) self-test: readonly added to spielerSicherung is seen', pruefeLockerungenC(klassenText.replace('  spielerSicherung: SpielerSicherung | null = null;', '  readonly spielerSicherung: SpielerSicherung | null = null;')).length > 0);
  check('step 1 (C) self-test: static on teleportPeer is seen', pruefeLockerungenC(klassenText.replace('  teleportPeer(\n', '  static teleportPeer(\n')).length > 0);
  for (const n of alleNamen) {
    const d = Object.getOwnPropertyDescriptor(WovServer.prototype, n);
    const laenge = MODULE.flatMap((m) => m.funktionen).find((x) => x.name === n)!.laenge;
    check(`${n}: a prototype method of WovServer (length ${(d?.value as { length?: number } | undefined)?.length})`, typeof d?.value === 'function' && (d.value as { length: number }).length === laenge && (d.value as { name: string }).name === n);
  }
  // every module under spiel/ that uses the context type stands under this guard (only Kontext.ts itself defines it)
  const alleDateien = new Set(MODULE.map((m) => m.datei));
  const unbekannt = dateien.filter((d) => d !== 'server/src/spiel/Kontext.ts' && /\bSpielKontext\b/.test(readFileSync(join(WURZEL, d), 'utf8')) && !alleDateien.has(d));
  check(`every module under spiel/ (sub-folders included, ${dateien.length} files) that uses SpielKontext is in MODULE (under this guard)`, unbekannt.length === 0, unbekannt.join(', '));
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
  /** peer:type:[readable head]:length:hash over ALL bytes of the packet (a changed byte anywhere changes the hash). */
  paket: string[];
  aufrufe: Record<string, number>;
  konsole: { log: number; warn: number };
  zustand: number[];
  ausnahmen: string[];
  /** The arguments of the calls into the context, the writes to the ZDOs, the reasons of the immediate saves. */
  notizen: string[];
}
const neueAufzeichnung = (): Aufzeichnung => ({ paket: [], aufrufe: {}, konsole: { log: 0, warn: 0 }, zustand: [], ausnahmen: [], notizen: [] });
/** Length and the start of the SHA-256 over all bytes: what a packet or a text really contained, not a shortened head. */
const kennung = (b: Buffer): string => `${b.length}:${createHash('sha256').update(b).digest('hex').slice(0, 16)}`;
const zaehle = (a: Aufzeichnung, name: string): void => { a.aufrufe[name] = (a.aufrufe[name] ?? 0) + 1; };
/** A peer that records what it is sent: the type, a readable head (first two fields, shortened) and the identifier over all bytes. */
function peer(a: Aufzeichnung, name: string, isAdmin: boolean, dungeonId = ''): Record<string, unknown> {
  return {
    name, isAdmin, dungeonId,
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void {
      const w = new Writer();
      fn(w);
      const r = new Reader(w.toBuffer());
      const d = type === PacketType.AdminEvent ? [r.readString(), r.readBool(), r.readString().slice(0, 22)] : dekodiere(w.toBuffer()).slice(0, 2).map((x) => (typeof x === 'string' ? x.slice(0, 22) : x));
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify(d)}:${kennung(w.toBuffer())}`);
    },
  };
}
/** The text of a console line, held by its length, a hash over all of it and its start (the temporary folder of the run is written `<tmp>`). */
const konsolenText = (x: unknown[]): string => {
  const t = x.map(String).join(' ').replace(/\/[^\s"']*i1-form-k-[A-Za-z0-9]+/g, '<tmp>');
  return `${t.length}:${createHash('sha256').update(t).digest('hex').slice(0, 16)}:${t.slice(0, 48)}`;
};
const konsole = (a: Aufzeichnung): (() => void) => {
  const orig = { log: console.log, warn: console.warn };
  console.log = (...x: unknown[]): void => { a.konsole.log++; a.notizen.push(`log ${konsolenText(x)}`); };
  console.warn = (...x: unknown[]): void => { a.konsole.warn++; a.notizen.push(`warn ${konsolenText(x)}`); };
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
      getDokument2: (id: string) => { zaehle(a, 'getDokument2'); a.notizen.push(`getDokument2 ${id}`); return id === 'd2' ? doc2 : undefined; },
      getDocument: (id: string) => { zaehle(a, 'getDocument'); a.notizen.push(`getDocument ${id}`); return id === 'd1' ? doc1 : undefined; },
      upsertDokument2: (raw: unknown) => { zaehle(a, 'upsertDokument2'); a.notizen.push(`upsertDokument2 ${kennung(Buffer.from(JSON.stringify(raw)))}`); return modus2 === 'null' ? null : { doc: doc2, instanzErhalten: modus2 === 'erhalten' }; },
      upsertDocument: (raw: unknown) => { zaehle(a, 'upsertDocument'); a.notizen.push(`upsertDocument ${kennung(Buffer.from(JSON.stringify(raw)))}`); return modus1 === 'null' ? null : { doc: doc1, instanzErhalten: modus1 === 'erhalten' }; },
    },
    config: { dungeonsModulbau: true, generiertDir: gen, worldsDir: welten, worldName: 'i1-form-k' },
    enterDungeon: (p: unknown, id: unknown): { ok: boolean } => { zaehle(a, 'enterDungeon'); a.notizen.push(`enterDungeon ${String((p as { name: string }).name)} ${String(id)}`); return { ok: true }; },
    dungeonsWurzel(this: unknown): string { zaehle(a, 'dungeonsWurzel'); return proto['dungeonsWurzel']!.call(this) as string; },
    getTimeOfDay(this: unknown): number { return proto['getTimeOfDay']!.call(this) as number; },
    getDay(this: unknown): number { return proto['getDay']!.call(this) as number; },
    sendTimeSync: (p: unknown): void => { zaehle(a, 'sendTimeSync'); a.notizen.push(`sendTimeSync ${String((p as { name: string }).name)}`); },
    adminCommands: { execute: (p: unknown, line: unknown): { active: boolean; message: string } => { zaehle(a, 'execute'); a.notizen.push(`execute ${String((p as { name: string }).name)} ${JSON.stringify(line)}`); return { active: String(line).includes('on'), message: `ran:${String(line).trim()}` }; } },
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
    lauf('handleDungeonEditSave', admin(), speichern('x'.repeat(2_000_000))); // exactly at the limit: passes the size check, is no JSON
    // an old client sends no checksum: accepted while the registry is empty, refused once a hall exists (below)
    lauf('handleDungeonEditSave', admin(), speichern(doc1Json, null));
    lauf('handleDungeonEditSave', admin(), speichern(doc2Json, null));
    for (const [m, wo] of [['neu', 'd2'], ['neu', 'x'], ['erhalten', 'd2'], ['null', 'd2']] as const) { modus2 = m; lauf('handleDungeonEditSave', admin(wo), speichern(doc2Json)); }
    for (const [m, wo] of [['neu', 'd1'], ['neu', 'x'], ['erhalten', 'd1'], ['null', 'd1']] as const) { modus1 = m; lauf('handleDungeonEditSave', admin(wo), speichern(doc1Json)); }
    // the hall: build and delete, on a real folder
    lauf('handleDungeonModulBau', nichtAdmin(), bau(4, 3, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(1, 1, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    lauf('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    // with a hall in the registry the empty checksum of an old client no longer matches
    lauf('handleDungeonEditSave', admin(), speichern(doc1Json, null));
    lauf('handleDungeonEditSave', admin(), speichern(doc2Json, null));
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
    server['enterDungeon'] = (p: unknown, id: unknown): { ok: boolean } => { zaehle(a, 'enterDungeon'); a.notizen.push(`enterDungeon ${String((p as { name: string }).name)} ${String(id)}`); return { ok: true }; };
    server['sendTimeSync'] = (p: unknown): void => { zaehle(a, 'sendTimeSync'); a.notizen.push(`sendTimeSync ${String((p as { name: string }).name)}`); };
    (server['net'] as Record<string, unknown>)['getPeers'] = (): unknown[] => { zaehle(a, 'getPeers'); return [peer(a, 'p1', false), peer(a, 'p2', true)]; };
    const rufe = (name: string, p: unknown, r: Reader): void => versuche(a, () => (server[name] as (x: unknown, y: unknown) => unknown).call(server, p, r));
    const admin = (dungeonId = ''): unknown => peer(a, 'e', true, dungeonId);
    const nichtAdmin = (): unknown => peer(a, 'n', false);
    const summe = registryChecksum();
    const doc = (id: string): unknown => ({ version: dungeon2.DUNGEON_DOKUMENT_VERSION_2, id, name: 'K9', modus: 'erzeugt', thema: 'steingrab', seeds: { architektur: 4242, material: dungeon2.mische(4242, 1), deko: dungeon2.mische(4242, 2) }, pruefsumme: '', layoutVersion: dungeon2.LAYOUT_VERSION });
    const speichern = (json: string, pruefsumme: string | null = summe): Reader => leser((w) => { w.writeString(json); if (pruefsumme !== null) w.writeString(pruefsumme); });
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
    rufe('handleDungeonEditSave', admin(), speichern(JSON.stringify(doc('k9-doc')), null)); // an old client without checksum, registry still empty
    rufe('handleDungeonEditRequest', admin(), s('k9-doc'));
    rufe('handleDungeonModulBau', admin(), bau(4, 3, 4, 0.5));
    rufe('handleDungeonEditSave', admin(), speichern(JSON.stringify(doc('k9-doc')), null)); // the same after a hall was built: refused
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

type Aufzeichnung3 = Aufzeichnung;
const neueAufzeichnung3 = (): Aufzeichnung3 => neueAufzeichnung();
/** Math.random with a fixed sequence for the length of one call: `wuerfleTruhe` draws from it. */
function mitZufall<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  let x = seed;
  Math.random = (): number => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}
function peerI(a: Aufzeichnung3, name: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // start values that are NOT the defaults: a handler that falls back to a default or keeps an old value shows in the state after the packet
    name, figur: 'wikinger', frisur: FRISUREN[1]!.id, haarfarbe: HAARFARBEN[2]!.id, augenfarbe: AUGENFARBEN[2]!.id, ruestung: encodeArmor({ oberkoerper: 'leder_bh', beine: 'leder_shorts' }), position: { x: 3, y: 7, z: 5 }, characterID: 'c1', inventar: new Inventory(),
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void {
      const w = new Writer();
      fn(w);
      const r = new Reader(w.toBuffer());
      const d = type === PacketType.InteractResult ? [r.readBool(), r.readString()] : type === PacketType.ContainerSync ? [r.readString(), r.readInt32(), r.readString().length] : [];
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify(d)}:${kennung(w.toBuffer())}`);
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
const nm = (p: unknown): string => String((p as { name?: unknown } | null | undefined)?.name);
/** The whole state of a peer after a packet: every field a handler may write, the armour as text, the parts in the inventory with their flag. */
const nachPaket = (a: Aufzeichnung, args: readonly unknown[]): void => {
  const p = args[0] as Record<string, unknown> | null | undefined;
  if (p === null || typeof p !== 'object' || !('name' in p)) return;
  const felder = ['frisur', 'haarfarbe', 'augenfarbe', 'ruestung', 'figur', 'position', 'worldId'].filter((f) => f in p).map((f) => `${f}=${JSON.stringify(p[f])}`);
  const inv = p['inventar'] instanceof Inventory ? `inventar=${JSON.stringify(p['inventar'].all.map((i) => [i.shared.name, i.equipped]))}` : '';
  a.notizen.push(`peer ${String(p['name'])} ${felder.join(' ')} ${inv}`.trim());
};
/** What `sichereSpielerSofort` was called with: the number of arguments, the peer, the reason and the ZDOs handed along. */
const sofortArgs = (x: readonly unknown[]): string => `${x.length}|${nm(x[0])}|${String(x[1])}|${Array.isArray(x[2]) ? JSON.stringify((x[2] as { zdoid?: { id: number } }[]).map((z) => z.zdoid?.id ?? '?')) : String(x[2])}`;
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
    sendeTruheInhalt(this: unknown, ...x: unknown[]): unknown { zaehle(a, 'sendeTruheInhalt'); a.notizen.push(`call sendeTruheInhalt ${nm(x[0])} ${String((x[1] as { zdoid?: { id: number } } | undefined)?.zdoid?.id)}`); return F['sendeTruheInhalt']!(this, ...x); },
    inventarSync: (p: unknown): void => { zaehle(a, 'inventarSync'); a.notizen.push(`call inventarSync ${nm(p)}`); },
    zdosVon: (p: unknown): unknown => { zaehle(a, 'zdosVon'); a.notizen.push(`call zdosVon ${nm(p)}`); return { getZDO: (): unknown => charZdo }; },
    kappeLeben: (p: unknown): void => { zaehle(a, 'kappeLeben'); a.notizen.push(`call kappeLeben ${nm(p)}`); },
    sichereSpielerSofort: (...x: unknown[]): void => { zaehle(a, 'sichereSpielerSofort'); a.notizen.push(`call sichereSpielerSofort ${sofortArgs(x)}`); },
  };
  const lauf = (name: string, seed: number, ...args: unknown[]): void => { versuche(a, () => mitZufall(seed, () => F[name]!(k, ...args))); nachPaket(a, args); };
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
    // two items carry the same part: only one of them is worn
    const doppelt = peerI(a, 'dd', { inventar: inventarMit() });
    for (const t of WILDWARDEN_PARTS) (doppelt['inventar'] as Inventory).addItem(findItem(t.item)!, 1);
    lauf('handleSetAussehen', 27, doppelt, paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify(teile)));
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
    // H7: an invalid start value of the eyes with an old client (three values) becomes the default; a worn weapon stays worn when the armour changes
    lauf('handleSetAussehen', 35, peerI(a, 'ak', { augenfarbe: 'kaputt' }), paketS(FRISUR_VORGABE, '', ''));
    const waffe = peerI(a, 'wf', { inventar: inventarMit() });
    (waffe['inventar'] as Inventory).addItem(findItem('Club')!, 1);
    const club = (waffe['inventar'] as Inventory).all.find((i) => i.shared.name === 'Club')!;
    club.equipped = true;
    lauf('handleSetAussehen', 36, waffe, paketS(FRISUR_VORGABE, teile['oberkoerper']!, teile['beine']!, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    a.zustand.push(club.equipped ? 1 : 0, angelegt(waffe));
    // H6: long values (over 40 characters) and a packet that is refused with long texts: the console line cuts them
    lauf('handleSetAussehen', 33, peerI(a, 'lg'), paketS(`${'f'.repeat(40)}+frisur`, '', '', `${'h'.repeat(45)}farbe`, AUGENFARBE_VORGABE, '{}'));
    lauf('handleSetFigur', 34, peerI(a, 'lf', { figur: F0 }), paketS(`${'d'.repeat(30)}-${'r'.repeat(30)}`));
    // NA2: owned parts in the two fixed slots with different ids (upper body != legs), the same without owning them, an unknown fifth value (a JSON that does not parse)
    const ohneOB = { ...teile };
    delete ohneOB['oberkoerper'];
    delete ohneOB['beine'];
    lauf('handleSetAussehen', 30, peerI(a, 'ob', { inventar: inventarMit() }), paketS(FRISUR_VORGABE, teile['oberkoerper']!, teile['beine']!, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, JSON.stringify(ohneOB)));
    lauf('handleSetAussehen', 31, peerI(a, 'nb'), paketS(FRISUR_VORGABE, teile['oberkoerper']!, teile['beine']!, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, '{}'));
    lauf('handleSetAussehen', 32, peerI(a, 'uf'), paketS(FRISUR_VORGABE, '', '', HAARFARBE_VORGABE, 'unbekannt-xyz'));
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
    server['inventarSync'] = (p: unknown): void => { zaehle(a, 'inventarSync'); a.notizen.push(`call inventarSync ${nm(p)}`); };
    server['kappeLeben'] = (p: unknown): void => { zaehle(a, 'kappeLeben'); a.notizen.push(`call kappeLeben ${nm(p)}`); };
    server['sichereSpielerSofort'] = (...x: unknown[]): void => { zaehle(a, 'sichereSpielerSofort'); a.notizen.push(`call sichereSpielerSofort ${sofortArgs(x)}`); };
    const halter: { zdo?: { getString(k: string): string } } = {};
    const rufe = (name: string, seed: number, ...args: unknown[]): void => {
      versuche(a, () => mitZufall(seed, () => (server[name] as (...x: unknown[]) => unknown).call(server, ...args)));
      nachPaket(a, args);
      if (halter.zdo) a.notizen.push(`zdo ${['frisur', 'haarfarbe', 'augenfarbe', 'ruestung', 'figur'].map((m) => halter.zdo!.getString(m)).join('|')}`);
    };
    const ep = peerI(a, 'e', { worldId: HAUPTWELT_ID, userId: 1, inventar: inventarMit() });
    const zm = (server['zdosVon'] as (p: unknown) => ZDOManager).call(server, ep);
    const truhe = zm.createZDO(1234, { x: 0, y: 0, z: 0 });
    const chr = zm.createZDO(4321, { x: 0, y: 0, z: 0 });
    ep['characterID'] = chr.zdoid;
    halter.zdo = chr;
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
    name, userId: id, worldId: welt, position: { x, y: 2 + id * 1.5, z: 4 }, nurEditor: false,
    sendPacket(type: PacketType, payload: Buffer): void {
      const r = new Reader(payload);
      const erstes = r.readString();
      const absender = r.readString();
      const typ = r.readInt32();
      const text = r.readString();
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify([erstes, absender, typ, text.slice(0, 14), text.length])}:${kennung(payload)}`);
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
  const lauf = (p: unknown, r: Reader): void => { versuche(a, () => F['handleChatMessage']!(k, p, r)); nachPaket(a, [p]); };
  const chat = (typ: number, text: string): Reader => leser((w) => { w.writeInt32(typ); w.writeString(text); });
  try {
    const ich = chatPeer(a, 'ich', 1, 0, HAUPTWELT_ID);
    liste.push(ich, chatPeer(a, 'nah', 2, 5, HAUPTWELT_ID), chatPeer(a, 'mittel', 3, 40, HAUPTWELT_ID), chatPeer(a, 'fern', 4, 100, HAUPTWELT_ID), chatPeer(a, 'weit', 5, 300, HAUPTWELT_ID), chatPeer(a, 'inst', 6, 1, 'dungeon:x'));
    for (const t of [ChatMsgType.Normal, ChatMsgType.Whisper, ChatMsgType.Shout, 99]) lauf(ich, chat(t, 'Hallo Welt'));
    lauf(ich, chat(ChatMsgType.Normal, 'Grüße aus Ägir — ß'));
    lauf(ich, chat(ChatMsgType.Normal, 'x'.repeat(5000)));
    lauf(ich, chat(ChatMsgType.Normal, `   ${'y'.repeat(30)} ${'z'.repeat(30)}   `));
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
    const rufe = (p: unknown, r: Reader): void => { versuche(a, () => (server['handleChatMessage'] as (x: unknown, y: unknown) => unknown).call(server, p, r)); nachPaket(a, [p]); };
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

// ── [2c] Behaviour of step 1, package C: the commands teleport and spieler ──

/** A peer for the commands: every packet it is sent (type and the identifier over all bytes); the state fields the handlers write. */
function peerB(a: Aufzeichnung, name: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, userId: 7, spielerId: `id-${name}`, isAdmin: true, nurEditor: false, dungeonId: null, dungeonReturn: null, position: { x: 1, y: 2, z: 3 }, worldId: HAUPTWELT_ID, characterID: ZDOID.NONE,
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void { const w = new Writer(); fn(w); a.paket.push(`${name}:${PacketType[type]}:${kennung(w.toBuffer())}`); },
    weltWechselVorbereiten(): void { zaehle(a, 'weltWechselVorbereiten'); },
    ...o,
  };
}
const zustandB = (p: Record<string, unknown>): string => `peer ${String(p['name'])} dungeonId=${JSON.stringify(p['dungeonId'])} dungeonReturn=${JSON.stringify(p['dungeonReturn'])} position=${JSON.stringify(p['position'])} worldId=${JSON.stringify(p['worldId'])} char=${String(p['characterID'])}`;
type Handler = (p: unknown, args: string[]) => unknown;
/** One command line on a handler: the arguments as the registry splits them, the result as text (the message is the behaviour), what is left of the arguments, the peer after it. */
function befehlB(a: Aufzeichnung, h: Handler | undefined, zeile: string, p: Record<string, unknown>): void {
  const args = zeile.trim().split(/\s+/).filter(Boolean);
  const vorher = JSON.stringify(args);
  try {
    if (!h) throw new Error('no handler');
    a.notizen.push(`> ${vorher} = ${JSON.stringify(h(p, args))} args=${JSON.stringify(args)}`);
  } catch (e) {
    a.ausnahmen.push((e as Error).name);
    a.notizen.push(`> ${vorher} throws ${(e as Error).name}`);
  }
  a.notizen.push(zustandB(p));
}
const gespeichert = (): Map<string, Record<string, unknown>> => new Map<string, Record<string, unknown>>([
  ['id-alt1', { name: 'Alt1', spielerId: 'id-alt1' }], ['id-alt2', { name: 'alt2', spielerId: 'id-alt2' }],
  ['id-d1', { name: 'Doppelt', spielerId: 'id-d1' }], ['id-d2', { name: 'doppelt', spielerId: 'id-d2' }],
  ['id-on', { name: 'Online', spielerId: 'id-on' }], ['id-ohne', { name: 'OhneId' }], ['id-ae', { name: 'Ägir', spielerId: 'id-ae' }],
]);
/** `teleport` and `spieler` on a stand-in: every context member records its calls with their arguments. */
function messeSpielerAttrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const handler = new Map<string, Handler>();
  const inInstanz = new Set<number>([7, 8]);
  let sicherung: unknown = { vergiss: (x: unknown): void => { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)}`); } };
  const saved = gespeichert();
  const online = (): unknown[] => [peerB(a, 'Online', { spielerId: 'id-on' }), peerB(a, 'Editor', { nurEditor: true, isAdmin: false, spielerId: 'ed' }), peerB(a, 'Gast', { isAdmin: false, spielerId: 'g' })];
  const k: Record<string, unknown> = {
    adminCommands: { register: (n: string, fn: Handler): void => { zaehle(a, 'register'); a.notizen.push(`register ${n}`); handler.set(n, fn); } },
    dungeons: { getInstance: (id: unknown): unknown => { zaehle(a, 'getInstance'); a.notizen.push(`call getInstance ${String(id)}`); return id === 'd-inst' ? { players: inInstanz } : undefined; } },
    getGroundHeight: (x: number, z: number): number => { zaehle(a, 'getGroundHeight'); a.notizen.push(`call getGroundHeight ${x} ${z}`); return x * 0.5 + z * 0.25 + 0.0625; },
    teleportPeer: (...x: unknown[]): void => { zaehle(a, 'teleportPeer'); a.notizen.push(`call teleportPeer ${x.length} ${nm(x[0])} ${JSON.stringify(x.slice(1))}`); },
    net: { getPeers: (): unknown[] => { zaehle(a, 'getPeers'); return online(); } },
    savedPlayers: saved,
    get spielerSicherung(): unknown { return sicherung; },
  };
  const ich = (o: Record<string, unknown> = {}): Record<string, unknown> => peerB(a, 'Ich', o);
  try {
    versuche(a, () => F['registerTeleportCommand']!(k));
    versuche(a, () => F['registerSpielerCommand']!(k));
    a.notizen.push(`registered ${[...handler.keys()].join(',')}`);
    const tp = (z: string, p = ich()): void => befehlB(a, handler.get('teleport'), z, p);
    const sp = (z: string): void => { befehlB(a, handler.get('spieler'), z, ich()); a.notizen.push(`saved ${[...(k['savedPlayers'] as Map<string, unknown>).keys()].join(',')}`); a.zustand.push((k['savedPlayers'] as Map<string, unknown>).size); };
    // teleport: coordinates, a player name instead of them, missing, not finite, other spellings of numbers, extra arguments
    for (const z of ['10 20', '-5.5 7', 'Olaf', 'Olaf 3', '', '1', 'abc 2', 'Infinity 0', 'NaN 1', '1e3 2e2', '0x10 5', '3 4 5', '0.4 -0.6', ' 7   8 ']) tp(z);
    // teleport out of a dungeon: the live instance forgets the peer; an instance that is gone; refused before leaving
    tp('12 34', ich({ dungeonId: 'd-inst', dungeonReturn: { x: 9, y: 9, z: 9 } }));
    a.notizen.push(`instance players ${[...inInstanz].join(',')}`);
    tp('12 34', ich({ dungeonId: 'd-weg', dungeonReturn: { x: 9, y: 9, z: 9 } }));
    tp('x y', ich({ dungeonId: 'd-inst', dungeonReturn: { x: 9, y: 9, z: 9 } }));
    // a peer whose dungeon id is the empty string (falsy, no dungeon): left as it is, and teleportPeer gets `null`, not the id
    tp('3 4', ich({ dungeonId: '', dungeonReturn: { x: 9, y: 9, z: 9 } }));
    // spieler: the default sub-command, spellings, online, remove (none, connected, editor, unknown, ambiguous, one, several, without id, umlaut), unknown
    for (const z of ['', 'liste', 'LISTE', 'Liste extra', 'online', 'ONLINE', 'entfernen', 'entfernen Online', 'entfernen online', 'entfernen Editor', 'entfernen Unbekannt', 'entfernen doppelt', 'entfernen Alt1', 'entfernen ALT2 Geist Online', 'entfernen OhneId', 'entfernen ägir', 'foo', 'entfernen Alt1']) sp(z);
    // members replaced on the stand-in AFTER the registration: the handlers read k.<member> at every call, never a copy
    k['savedPlayers'] = new Map<string, Record<string, unknown>>([['neu', { name: 'Neu', spielerId: 'neu' }]]);
    sp('liste');
    k['teleportPeer'] = (...x: unknown[]): void => { zaehle(a, 'teleportPeerNeu'); a.notizen.push(`call teleportPeerNeu ${x.length}`); };
    k['net'] = { getPeers: (): unknown[] => { zaehle(a, 'getPeersNeu'); return []; } };
    tp('1 2');
    sp('online');
    sicherung = null;
    sp('entfernen neu');
    // a context without a member the handler reads: the exception (by its name)
    delete k['getGroundHeight'];
    tp('1 2');
  } finally {
    ruecksetzen();
  }
  return a;
}
/** The same on a real instance: the registry the constructor built (through the forwardings), with a real dungeon instance; then the forwardings called again. */
function messeSpielerEcht(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    mitZufall(11, () => {
      const server = createWovServer({
        port: 0, worldFeatures: false, worldName: 'i1-form-k1c', everyoneAdmin: true,
        worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
      } as never) as unknown as Record<string, unknown>;
      // the main world and the heights only exist after init(): a real ZDO space and stand-ins, as the tests do
      // (no terrain changes to send back when a peer returns to the main world: an empty list)
      const haupt = { id: HAUPTWELT_ID, zdos: new ZDOManager(1n), heightmaps: { listTerrainComps: (): unknown[] => { zaehle(a, 'listTerrainComps'); return []; } } };
      (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, haupt);
      server['hauptwelt'] = haupt;
      server['getGroundHeight'] = (x: number, z: number): number => { zaehle(a, 'getGroundHeight'); a.notizen.push(`call getGroundHeight ${x} ${z}`); return x * 0.5 + z * 0.25 + 0.0625; };
      server['spielerSicherung'] = { vergiss: (x: unknown): void => { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)}`); } };
      const online = [peerB(a, 'Olaf', { spielerId: 'o1', userId: 11 }), peerB(a, 'Editor', { nurEditor: true, isAdmin: false, spielerId: 'ed', userId: 12 })];
      (server['net'] as Record<string, unknown>)['getPeers'] = (): unknown[] => { zaehle(a, 'getPeers'); return online; };
      const saved = server['savedPlayers'] as Map<string, Record<string, unknown>>;
      for (const [id, name] of [['r1', 'Ragnar'], ['r2', 'ragnar'], ['b1', 'Bjørn'], ['o1', 'Olaf'], ['e1', 'Editor']] as const) saved.set(id, { name, spielerId: id });
      const registry = server['adminCommands'] as { execute(p: unknown, l: string): unknown };
      const ich = peerB(a, 'Ich', { userId: 21, spielerId: 'ich' });
      const ex = (zeile: string, p: Record<string, unknown> = ich): void => {
        try { a.notizen.push(`> ${zeile} = ${JSON.stringify(registry.execute(p, zeile))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> ${zeile} throws ${(e as Error).name}`); }
        a.notizen.push(zustandB(p));
      };
      const inst = (id: string): number => ((server['dungeons'] as { getInstance(i: string): { players: Set<number> } | undefined }).getInstance(id)?.players.size ?? -1);
      for (const z of ['teleport 10 20', 'teleport -5.5 7', 'teleport Olaf', 'teleport', 'teleport 1', 'teleport abc 2', 'TELEPORT 3 4 5']) ex(z);
      // the winning `teleport` is the server's: it leaves the dungeon instance (the base command of AdminCommands would not)
      ex('dungeon create cave 42');
      ex('dungeon enter cave-2a');
      a.zustand.push(inst('cave-2a'));
      ex('teleport 5 6');
      a.zustand.push(inst('cave-2a'));
      for (const z of ['spieler', 'spieler online', 'spieler entfernen', 'spieler entfernen olaf', 'spieler entfernen editor', 'spieler entfernen Unbekannt', 'spieler entfernen RAGNAR', 'spieler entfernen bjørn', 'spieler foo', 'spieler liste']) { ex(z); a.zustand.push(saved.size); }
      ex('spieler liste', peerB(a, 'Kein', { isAdmin: false }));
      // the two forwardings, called again on the instance: they hand the instance over, the handlers read its members at the call
      const neu = new Map<string, Handler>();
      server['adminCommands'] = { register: (n: string, fn: Handler): void => { zaehle(a, 'register'); a.notizen.push(`register ${n}`); neu.set(n, fn); } };
      versuche(a, () => (server['registerTeleportCommand'] as () => unknown).call(server));
      versuche(a, () => (server['registerSpielerCommand'] as () => unknown).call(server));
      saved.set('z1', { name: 'Zweit', spielerId: 'z1' });
      befehlB(a, neu.get('spieler'), 'liste', ich);
      befehlB(a, neu.get('spieler'), 'entfernen Zweit', ich);
      befehlB(a, neu.get('teleport'), '8 9', ich);
      a.zustand.push(saved.size);
      (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

// ── [2d] Behaviour of step 1, package C, after the attack (N1) ──

/** `getGroundHeight` as a function that notes whether it was called on its receiver (a handler that loses `this` shows here). */
const hoeheMitEmpfaenger = (a: Aufzeichnung, empfaenger: () => unknown) => function (this: unknown, x: number, z: number): number {
  zaehle(a, 'getGroundHeight');
  a.notizen.push(`call getGroundHeight ${x} ${z} receiver=${this === empfaenger() ? 'context' : 'LOST'}`);
  return x * 0.5 + z * 0.25 + 0.0625;
};
/** Records whose names differ from what is typed only in Unicode form (NFD/NFC), in case or by a trailing space. */
const gespeichertN1 = (): Map<string, Record<string, unknown>> => new Map<string, Record<string, unknown>>([
  ['id-joerg', { name: 'Jörg', spielerId: 'id-joerg' }], // NFD in the record
  ['id-asa', { name: 'Åsa', spielerId: 'id-asa' }], // NFC in the record, typed as NFD below
  ['id-bjoern', { name: 'Björn', spielerId: 'id-bjoern' }], // online as NFD
  ['id-ulf', { name: 'Ulf ', spielerId: 'id-ulf' }], // trailing space in the record
  ['id-selbst', { name: 'Selbst', spielerId: 'id-selbst' }], // the caller's own record
  ['id-z1', { name: 'Zwilling', spielerId: 'id-z1' }], ['id-z2', { name: 'Zwilling', spielerId: 'id-z2' }], // the same name twice
  ['id-einmal', { name: 'Einmal', spielerId: 'id-einmal' }],
]);
function messeSpielerAttrappeN1(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const handler = new Map<string, Handler>();
  const inInstanz = new Set<number>([7, 9]);
  const saved = gespeichertN1();
  const selbst = peerB(a, 'Selbst', { spielerId: 'id-selbst' });
  let online: unknown[] = [selbst, peerB(a, 'Björn', { spielerId: 'id-bjoern' }), peerB(a, 'EdAdmin', { nurEditor: true, isAdmin: true, spielerId: 'ed-a' })];
  const k: Record<string, unknown> = {
    adminCommands: { register: (n: string, fn: Handler): void => { zaehle(a, 'register'); handler.set(n, fn); } },
    dungeons: { getInstance: (id: unknown): unknown => { zaehle(a, 'getInstance'); a.notizen.push(`call getInstance ${String(id)}`); return id === 'd-inst' ? { players: inInstanz } : undefined; } },
    teleportPeer: (...x: unknown[]): void => { zaehle(a, 'teleportPeer'); a.notizen.push(`call teleportPeer ${x.length} ${nm(x[0])} ${JSON.stringify(x.slice(1))}`); },
    net: { getPeers: (): unknown[] => { zaehle(a, 'getPeers'); return online; } },
    savedPlayers: saved,
    spielerSicherung: { vergiss: (x: unknown): void => { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)}`); } },
  };
  k['getGroundHeight'] = hoeheMitEmpfaenger(a, () => k);
  try {
    versuche(a, () => F['registerTeleportCommand']!(k));
    versuche(a, () => F['registerSpielerCommand']!(k));
    const sp = (z: string, p: Record<string, unknown> = selbst): void => { befehlB(a, handler.get('spieler'), z, p); a.notizen.push(`saved ${[...saved.keys()].join(',')}`); a.zustand.push(saved.size); };
    const tp = (z: string, p: Record<string, unknown>): void => befehlB(a, handler.get('teleport'), z, p);
    // the caller is online and has a record: it sees itself in `online` and cannot remove itself
    sp('online');
    sp('entfernen Selbst');
    sp('entfernen selbst');
    // the same name twice in one command, then two records with the same name in `liste`
    sp('liste');
    sp('entfernen Einmal Einmal');
    // names that differ only in Unicode form or by a trailing space: online (NFD) typed NFC, record NFD typed NFC, record NFC typed NFD, record with a space
    sp('entfernen björn');
    sp('entfernen JÖRG');
    sp('entfernen Åsa');
    sp('entfernen ulf');
    // exactly one player online
    online = [peerB(a, 'Allein', { spielerId: 'id-allein' })];
    sp('online');
    // `dungeons` replaced after the registration: the handler reads k.dungeons at the call
    k['dungeons'] = { getInstance: (id: unknown): unknown => { zaehle(a, 'getInstanceNeu'); a.notizen.push(`call getInstanceNeu ${String(id)}`); return id === 'd-neu' ? { players: inInstanz } : undefined; } };
    tp('5 6', peerB(a, 'Drin', { userId: 9, dungeonId: 'd-neu', dungeonReturn: { x: 1, y: 1, z: 1 } }));
    a.notizen.push(`instance players ${[...inInstanz].join(',')}`);
  } finally {
    ruecksetzen();
  }
  return a;
}
function messeSpielerEchtN1(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    const server = createWovServer({
      port: 0, worldFeatures: false, worldName: 'i1-form-k1cn1', everyoneAdmin: true,
      worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
    } as never) as unknown as Record<string, unknown>;
    const haupt = { id: HAUPTWELT_ID, zdos: new ZDOManager(1n), heightmaps: { listTerrainComps: (): unknown[] => [] } };
    (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, haupt);
    server['hauptwelt'] = haupt;
    server['getGroundHeight'] = hoeheMitEmpfaenger(a, () => server);
    server['spielerSicherung'] = { vergiss: (x: unknown): void => { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)}`); } };
    const saved = server['savedPlayers'] as Map<string, Record<string, unknown>>;
    for (const [id, r] of gespeichertN1()) saved.set(id, r);
    const selbst = peerB(a, 'Selbst', { spielerId: 'id-selbst', userId: 31 });
    let online: unknown[] = [selbst, peerB(a, 'Björn', { spielerId: 'id-bjoern', userId: 32 }), peerB(a, 'EdAdmin', { nurEditor: true, isAdmin: true, spielerId: 'ed-a', userId: 33 })];
    (server['net'] as Record<string, unknown>)['getPeers'] = (): unknown[] => { zaehle(a, 'getPeers'); return online; };
    const registry = server['adminCommands'] as { execute(p: unknown, l: string): unknown };
    const ex = (zeile: string, p: Record<string, unknown> = selbst): void => {
      try { a.notizen.push(`> ${zeile} = ${JSON.stringify(registry.execute(p, zeile))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> ${zeile} throws ${(e as Error).name}`); }
      a.notizen.push(zustandB(p));
      a.zustand.push(saved.size);
    };
    for (const z of ['spieler online', 'spieler entfernen Selbst', 'spieler liste', 'spieler entfernen Einmal Einmal', 'spieler entfernen björn', 'spieler entfernen JÖRG', 'spieler entfernen Åsa', 'spieler entfernen ulf', 'teleport 3 4']) ex(z);
    online = [peerB(a, 'Allein', { spielerId: 'id-allein', userId: 34 })];
    ex('spieler online');
    // `dungeons` replaced on the instance after the construction: the registered handler reads the new one
    const inInstanz = new Set<number>([31, 35]);
    server['dungeons'] = { getInstance: (id: unknown): unknown => { zaehle(a, 'getInstanceNeu'); a.notizen.push(`call getInstanceNeu ${String(id)}`); return id === 'd-neu' ? { players: inInstanz } : undefined; } };
    ex('teleport 5 6', peerB(a, 'Selbst', { spielerId: 'id-selbst', userId: 31, dungeonId: 'd-neu', dungeonReturn: { x: 1, y: 1, z: 1 } }));
    a.notizen.push(`instance players ${[...inInstanz].join(',')}`);
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
    'n:InteractResult:[false,"Keine Berechtigung, di"]:50:42c4741f2c31e281',
    'a:AdminEvent:["fly",false,"ran:fly"]:13:be3cdcc1b19a5b64',
    'a:AdminEvent:["fly",true,"ran:Fly  on"]:17:3ba296420bde1020',
    'a:AdminEvent:["",false,"ran:"]:7:4e8685525db3f750',
    'a:DungeonEditData:[true,"d2"]:54:29569aca1cb25843',
    'a:DungeonEditData:[true,"d1"]:57:f9c143e1b30306cb',
    'a:DungeonEditData:[false,"Unbekannter Dungeon: z"]:26:d63b3f14a085c1eb',
    'a:DungeonEditData:[false,"Unbekannter Dungeon: ("]:32:4f1067847981e84b',
    'a:DungeonEditData:[true,"d1"]:57:f9c143e1b30306cb',
    'n:DungeonEditData:[false,"Keine Berechtigung"]:21:2880eeb48c868530',
    'n:DungeonEditData:[false,"Keine Berechtigung"]:21:2880eeb48c868530',
    'a:DungeonEditData:[false,"Dokument zu groß (max "]:31:d4c9dda2519a05c7',
    'a:DungeonEditData:[false,"Registry veraltet — Se"]:76:71c8c48b9f29b153',
    'a:DungeonEditData:[false,"Ungültiges JSON"]:19:299f1c07f1839860',
    'a:DungeonEditData:[false,"Ungültiges JSON"]:19:299f1c07f1839860',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]:89:2edaa330a01f0ffe',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]:105:813ad6f75f356bbd',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]:105:813ad6f75f356bbd',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]:105:813ad6f75f356bbd',
    'a:DungeonEditData:[true,"Gespeichert: d2 (2.0, "]:105:813ad6f75f356bbd',
    'a:DungeonEditData:[false,"Dokument 2.0 abgelehnt"]:52:f0c4a2f78980677b',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]:89:2edaa330a01f0ffe',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]:89:2edaa330a01f0ffe',
    'a:DungeonEditData:[true,"Gespeichert: d1 (3 Räu"]:89:2edaa330a01f0ffe',
    'a:DungeonEditData:[false,"Dokument abgelehnt (Ba"]:49:28accf45467d20da',
    'n:DungeonModulBauErgebnis:[false,"Keine Berechtigung"]:21:2880eeb48c868530',
    'a:DungeonModulBauErgebnis:[false,"Zellzahl x = 1 liegt a"]:58:5f8211779cf394a5',
    'a:DungeonModulBauErgebnis:[true,"Gebaut: Gen_StoneVault"]:264:3eb4b7886aaba11b',
    'a:DungeonModulBauErgebnis:[false,"Der Saal \'Gen_StoneVau"]:157:c6913d6b8ab2f848',
    'a:DungeonEditData:[false,"Registry veraltet — Se"]:76:f5dfd9e0bb3dc108',
    'a:DungeonEditData:[false,"Registry veraltet — Se"]:76:f5dfd9e0bb3dc108',
    'n:DungeonModulLoeschErgebnis:[false,"Keine Berechtigung"]:21:2880eeb48c868530',
    'a:DungeonModulLoeschErgebnis:[false,"Modulname \'../x\' enthä"]:124:b8a4ada818f5db26',
    'a:DungeonModulLoeschErgebnis:[true,"Entfernt: Gen_StoneVau"]:196:2b00f8890606c5ef',
    'a:DungeonModulLoeschErgebnis:[false,"Die Registry kennt \'Ge"]:86:61f222ce82bd96f8',
    'a:DungeonModulBauErgebnis:[false,"Modulbau ist ausgescha"]:62:15aba8687e622bd3',
    'a:DungeonModulLoeschErgebnis:[false,"Modulbau ist ausgescha"]:62:15aba8687e622bd3',
  ],
  aufrufe: { getPeers:  4,  sendTimeSync:  8,  execute:  3,  getDokument2:  4,  getDocument:  3,  upsertDocument:  5,  upsertDokument2:  5,  enterDungeon:  2,  dungeonsWurzel:  5 },
  konsole: { log: 26, warn: 3 },
  zustand: [100, 1750, 5, 0, 0, 0, 0, 2, 1, 1],
  ausnahmen: ['RangeError'],
  notizen: [
    'log 42:70ed6bfaae6f08de:[WoV] "a" set time of day to 100s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 42:ff2649a2ca7020ab:[WoV] "a" set time of day to 1750s (day 0)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 40:6862a1e3c389af9f:[WoV] "a" set time of day to 5s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 40:8bd671a99f19deb4:[WoV] "a" set time of day to 0s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 56:88918f5a54f23579:[Admin] "n" — SetTimeOfDay abgelehnt: keine Bere',
    'execute a "fly"',
    'log 31:4b0d2e4c70f3c68e:[Admin] "a" ran "fly" → ran:fly',
    'execute a "  Fly  on "',
    'log 42:6691671c1a9d0214:[Admin] "a" ran "  Fly  on " → ran:Fly  on',
    'execute a ""',
    'log 25:185ef340b71ecef3:[Admin] "a" ran "" → ran:',
    'getDokument2 d2',
    'getDokument2 d1',
    'getDocument d1',
    'getDokument2 zz',
    'getDocument zz',
    'getDokument2 d1',
    'getDocument d1',
    'warn 104:8bfaedcf885b76fb:[Dungeon] \'a\' hat eine veraltete Modulregistry (',
    'upsertDocument 23:9ef74ce4b338647a',
    'log 52:3f0b42706f043d3f:[Dungeon] \'a\' saved document \'d1\' (3 rooms, 2 pr',
    'upsertDokument2 24:e60d7c728299f75c',
    'log 53:c5572f37fbf79261:[Dungeon] \'a\' saved 2.0 document \'d2\' (steingrab',
    'upsertDokument2 24:e60d7c728299f75c',
    'enterDungeon a d2',
    'log 53:c5572f37fbf79261:[Dungeon] \'a\' saved 2.0 document \'d2\' (steingrab',
    'upsertDokument2 24:e60d7c728299f75c',
    'log 53:c5572f37fbf79261:[Dungeon] \'a\' saved 2.0 document \'d2\' (steingrab',
    'upsertDokument2 24:e60d7c728299f75c',
    'log 68:2a39372142a6bad1:[Dungeon] \'a\' saved 2.0 document \'d2\' (steingrab',
    'upsertDokument2 24:e60d7c728299f75c',
    'upsertDocument 23:9ef74ce4b338647a',
    'enterDungeon a d1',
    'log 52:3f0b42706f043d3f:[Dungeon] \'a\' saved document \'d1\' (3 rooms, 2 pr',
    'upsertDocument 23:9ef74ce4b338647a',
    'log 52:3f0b42706f043d3f:[Dungeon] \'a\' saved document \'d1\' (3 rooms, 2 pr',
    'upsertDocument 23:9ef74ce4b338647a',
    'log 67:7981f452535eb722:[Dungeon] \'a\' saved document \'d1\' (3 rooms, 2 pr',
    'upsertDocument 23:9ef74ce4b338647a',
    'log 54:d15fc24bac626c8d:[Dungeon] \'n\' — Modulbau abgelehnt: Keine Berech',
    'log 89:e607ec82fef51d8c:[Dungeon] \'a\' — Modulbau abgelehnt: Zellzahl x =',
    'log 83:2bd802c5aa07402e:[Dungeon] \'a\' built module \'Gen_StoneVaultHall4x',
    'log 185:ab4493bf86b0a60f:[Dungeon] \'a\' — Modulbau abgelehnt: Der Saal \'Ge',
    'warn 104:8a4d1f82e3369b0d:[Dungeon] \'a\' hat eine veraltete Modulregistry (',
    'warn 104:8a4d1f82e3369b0d:[Dungeon] \'a\' hat eine veraltete Modulregistry (',
    'log 59:6971f7c8513f75f4:[Dungeon] \'n\' — Modul löschen abgelehnt: Keine B',
    'log 157:de8b430d9ebfd0f0:[Dungeon] \'a\' — Modul löschen abgelehnt: Modulna',
    'log 82:c0a96c3e0c513361:[Dungeon] \'a\' deleted module \'Gen_StoneVaultHall',
    'log 120:4a0adc25c1e69976:[Dungeon] \'a\' — Modul löschen abgelehnt: Die Reg',
    'log 95:9d62d779a54136cf:[Dungeon] \'a\' — Modulbau abgelehnt: Modulbau ist',
    'log 100:6dcda13acd0cfcf3:[Dungeon] \'a\' — Modul löschen abgelehnt: Modulba',
  ],
};
const SOLL_ECHT: Aufzeichnung = {
  paket: [
    'n:InteractResult:[false,"Keine Berechtigung, di"]:50:42c4741f2c31e281',
    'e:AdminEvent:["unbekanntes-kommando",false,"Unknown admin command:"]:66:2edbe8b6351863a1',
    'e:AdminEvent:["",false,"Empty admin command"]:22:b1b1f31f9371c433',
    'n:AdminEvent:["fly",false,"Admin commands are not"]:52:b5036c13d55fb7fd',
    'e:DungeonEditData:[false,"Unbekannter Dungeon: k"]:30:ab91d052b8361147',
    'n:DungeonEditData:[false,"Keine Berechtigung"]:21:2880eeb48c868530',
    'e:DungeonEditData:[true,"Gespeichert: k9-doc (2"]:256:bbd20983c470657b',
    'e:DungeonEditData:[true,"Gespeichert: k9-doc (2"]:256:bbd20983c470657b',
    'e:DungeonEditData:[false,"Registry veraltet — Se"]:76:71c8c48b9f29b153',
    'e:DungeonEditData:[false,"Dokument abgelehnt (Ba"]:49:28accf45467d20da',
    'e:DungeonEditData:[true,"Gespeichert: k9-doc (2"]:256:bbd20983c470657b',
    'e:DungeonEditData:[true,"k9-doc"]:199:a999d46b223f2d55',
    'e:DungeonModulBauErgebnis:[true,"Gebaut: Gen_StoneVault"]:264:3eb4b7886aaba11b',
    'e:DungeonEditData:[false,"Registry veraltet — Se"]:76:f5dfd9e0bb3dc108',
    'e:DungeonModulLoeschErgebnis:[true,"Entfernt: Gen_StoneVau"]:196:2b00f8890606c5ef',
  ],
  aufrufe: { getPeers:  4,  sendTimeSync:  8,  enterDungeon:  2 },
  konsole: { log: 17, warn: 2 },
  zustand: [100, 1750, 5, 0, 0, 0, 2, 1],
  ausnahmen: [],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    'log 42:2b588fc686ebc778:[WoV] "e" set time of day to 100s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 42:429d19b587669a8a:[WoV] "e" set time of day to 1750s (day 0)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 40:a937b929b0bdc988:[WoV] "e" set time of day to 5s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 40:9b8350a6cd4dfe79:[WoV] "e" set time of day to 0s (day -1)',
    'sendTimeSync p1',
    'sendTimeSync p2',
    'log 56:88918f5a54f23579:[Admin] "n" — SetTimeOfDay abgelehnt: keine Bere',
    'log 88:8bddfa0866661fb6:[Admin] "e" ran "unbekanntes-kommando 1 2" → Unk',
    'log 40:319569786a92982f:[Admin] "e" ran "" → Empty admin command',
    'log 70:d66cc632d585a19e:[Admin] "n" ran "fly" → Admin commands are not a',
    'enterDungeon e k9-doc',
    'log 63:891f383f2bb09731:[Dungeon] \'e\' saved 2.0 document \'k9-doc\' (stein',
    'enterDungeon e k9-doc',
    'log 63:891f383f2bb09731:[Dungeon] \'e\' saved 2.0 document \'k9-doc\' (stein',
    'warn 104:57e215bd7b56b864:[Dungeon] \'e\' hat eine veraltete Modulregistry (',
    'log 63:891f383f2bb09731:[Dungeon] \'e\' saved 2.0 document \'k9-doc\' (stein',
    'log 83:b5f5ceb4c62ad8c6:[Dungeon] \'e\' built module \'Gen_StoneVaultHall4x',
    'warn 104:062883f0fb36a09e:[Dungeon] \'e\' hat eine veraltete Modulregistry (',
    'log 82:aafee19fb0286111:[Dungeon] \'e\' deleted module \'Gen_StoneVaultHall',
  ],
};

/** Step 3, measured on the stand before the move: chest/appearance/figure (stand-in, real instance) and chat (stand-in, real instance). */
const SOLL_INTERAKTION_ATTRAPPE: Aufzeichnung = {
  paket: [
    't:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    't:ContainerSync:["u",7,19]:26:4376afbcca29916d',
    't:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    't:ContainerSync:["u",7,2]:9:42cb2b4a17c64193',
    't:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    't:ContainerSync:["u",7,0]:7:b0cf0ca9c4e0eb10',
    't:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    't:ContainerSync:["u",7,19]:26:bf42688d67219593',
    't:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    't:ContainerSync:["u",7,18]:25:f681633f71bd01d2',
    't:ContainerSync:["u",7,19]:26:bf42688d67219593',
  ],
  aufrufe: { setInt:  3,  setString:  52,  reviseData:  3,  sendeTruheInhalt:  5,  zdosVon:  15,  kappeLeben:  13,  sichereSpielerSofort:  15,  inventarSync:  8 },
  konsole: { log: 2, warn: 4 },
  zustand: [151, 5, 1, 0, 1, 1, 3],
  ausnahmen: ['RangeError', 'RangeError'],
  notizen: [
    'setInt looted=1',
    'setString truheInhalt=19:5b46b599',
    'call sendeTruheInhalt t 7',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'setInt looted=1',
    'setString truheInhalt=[]',
    'call sendeTruheInhalt t 7',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call sendeTruheInhalt t 7',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call sendeTruheInhalt t 7',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'setInt looted=1',
    'setString truheInhalt=18:540dba5e',
    'call sendeTruheInhalt t 7',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'peer t frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=kastanie',
    'setString augenfarbe=waldgruen',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=waldgruen',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="mittelbraun" augenfarbe="waldgruen" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=dunkelbraun',
    'setString augenfarbe=waldgruen',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="dunkelbraun" augenfarbe="waldgruen" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=dunkelbraun',
    'setString augenfarbe=eisblau',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="dunkelbraun" augenfarbe="eisblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon a',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=waldgruen',
    'setString ruestung=|',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="mittelbraun" augenfarbe="waldgruen" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call inventarSync a',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call inventarSync a',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call inventarSync a',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'warn 156:1a8233e434b0040b:[WoV] SetAussehen von "a" abgelehnt: frisur="gib',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call inventarSync a',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon m',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=151:3a7a8d0f',
    'call kappeLeben m',
    'call sichereSpielerSofort 2|m|ausruestung|undefined',
    'peer m frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="||{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[["wildwarden_crown",true],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true]]',
    'call zdosVon dd',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=151:3a7a8d0f',
    'call kappeLeben dd',
    'call sichereSpielerSofort 2|dd|ausruestung|undefined',
    'peer dd frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="||{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[["wildwarden_crown",true],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true],["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'call zdosVon m',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'call kappeLeben m',
    'call sichereSpielerSofort 2|m|ausruestung|undefined',
    'peer m frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'call zdosVon a',
    'call kappeLeben a',
    'call sichereSpielerSofort 2|a|ausruestung|undefined',
    'peer a frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'peer a frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon f',
    'setString figur=wikingerin',
    'call inventarSync f',
    'call sichereSpielerSofort 2|f|figur|undefined',
    'log 39:4f872ef66ff94e77:[WoV] "f" spielt jetzt als "wikingerin"',
    'peer f frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikingerin" position={"x":3,"y":7,"z":5} inventar=[]',
    'peer f frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikingerin" position={"x":3,"y":7,"z":5} inventar=[]',
    'warn 85:a08afbdf78f1e46b:[WoV] SetFigur von "f" abgelehnt: "drache" steht',
    'peer f frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikingerin" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon f',
    'call inventarSync f',
    'call sichereSpielerSofort 2|f|figur|undefined',
    'log 39:4f872ef66ff94e77:[WoV] "f" spielt jetzt als "wikingerin"',
    'peer f frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikingerin" position={"x":3,"y":7,"z":5} inventar=[]',
    'peer f frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon ak',
    'setString frisur=H_01',
    'setString haarfarbe=kastanie',
    'setString augenfarbe=fjordblau',
    'setString ruestung=|',
    'call kappeLeben ak',
    'call sichereSpielerSofort 2|ak|ausruestung|undefined',
    'peer ak frisur="H_01" haarfarbe="kastanie" augenfarbe="fjordblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon wf',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=31:6b0366cc',
    'call kappeLeben wf',
    'call sichereSpielerSofort 2|wf|ausruestung|undefined',
    'peer wf frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="wildwarden_vest|wildwarden_robe" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[["wildwarden_crown",false],["wildwarden_vest",true],["wildwarden_robe",true],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false],["Club",true]]',
    'warn 184:215405cd3007b748:[WoV] SetAussehen von "lg" abgelehnt: frisur="ff',
    'peer lg frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'warn 120:7cd61824dfbf9d40:[WoV] SetFigur von "lf" abgelehnt: "dddddddddddd',
    'peer lf frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call zdosVon ob',
    'setString frisur=H_01',
    'setString haarfarbe=mittelbraun',
    'setString augenfarbe=fjordblau',
    'setString ruestung=181:b3b6644c',
    'call kappeLeben ob',
    'call sichereSpielerSofort 2|ob|ausruestung|undefined',
    'peer ob frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="wildwarden_vest|wildwarden_robe|{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[["wildwarden_crown",true],["wildwarden_vest",true],["wildwarden_robe",true],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true]]',
    'call inventarSync nb',
    'peer nb frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
    'call inventarSync uf',
    'peer uf frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} inventar=[]',
  ],
};
const SOLL_INTERAKTION_ECHT: Aufzeichnung = {
  paket: [
    'e:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    'e:ContainerSync:["1",1,19]:26:483cc7c64faf72d7',
    'e:InteractResult:[true,"Truhe geöffnet"]:22:7c62c134c97a6d14',
    'e:ContainerSync:["1",1,19]:26:483cc7c64faf72d7',
    'e:ContainerSync:["1",1,19]:26:483cc7c64faf72d7',
  ],
  aufrufe: { kappeLeben:  2,  sichereSpielerSofort:  3,  inventarSync:  2 },
  konsole: { log: 5, warn: 2 },
  zustand: [1, 19, 151, 5, 151, 4, 1, 0, 1, 1],
  ausnahmen: [],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    'peer e frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo ||||',
    'peer e frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo ||||',
    'peer e frisur="H_02" haarfarbe="kastanie" augenfarbe="waldgruen" ruestung="leder_bh|leder_shorts" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo ||||',
    'call kappeLeben e',
    'call sichereSpielerSofort 2|e|ausruestung|undefined',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="||{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",true],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true]]',
    'zdo H_01|mittelbraun|fjordblau|||{"kopf":"wildwarden_crown","schultern":"wildwarden_mantle","unterarme":"wildwarden_bracers","haende":"wildwarden_gloves","fuesse":"wildwarden_boots"}|',
    'warn 150:c2870c63e2e6e5c5:[WoV] SetAussehen von "e" abgelehnt: frisur="nei',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="||{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",true],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true]]',
    'zdo H_01|mittelbraun|fjordblau|||{"kopf":"wildwarden_crown","schultern":"wildwarden_mantle","unterarme":"wildwarden_bracers","haende":"wildwarden_gloves","fuesse":"wildwarden_boots"}|',
    'call inventarSync e',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="||{\\"kopf\\":\\"wildwarden_crown\\",\\"schultern\\":\\"wildwarden_mantle\\",\\"unterarme\\":\\"wildwarden_bracers\\",\\"haende\\":\\"wildwarden_gloves\\",\\"fuesse\\":\\"wildwarden_boots\\"}" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",true],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",true],["wildwarden_bracers",true],["wildwarden_gloves",true],["wildwarden_boots",true]]',
    'zdo H_01|mittelbraun|fjordblau|||{"kopf":"wildwarden_crown","schultern":"wildwarden_mantle","unterarme":"wildwarden_bracers","haende":"wildwarden_gloves","fuesse":"wildwarden_boots"}|',
    'call kappeLeben e',
    'call sichereSpielerSofort 2|e|ausruestung|undefined',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikinger" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo H_01|mittelbraun|fjordblau|||',
    'call inventarSync e',
    'call sichereSpielerSofort 2|e|figur|undefined',
    'log 39:d450a73430da5874:[WoV] "e" spielt jetzt als "wikingerin"',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikingerin" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo H_01|mittelbraun|fjordblau|||wikingerin',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikingerin" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo H_01|mittelbraun|fjordblau|||wikingerin',
    'warn 85:16fe5dc82d3bda5c:[WoV] SetFigur von "e" abgelehnt: "drache" steht',
    'peer e frisur="H_01" haarfarbe="mittelbraun" augenfarbe="fjordblau" ruestung="|" figur="wikingerin" position={"x":3,"y":7,"z":5} worldId="haupt" inventar=[["wildwarden_crown",false],["wildwarden_vest",false],["wildwarden_robe",false],["wildwarden_mantle",false],["wildwarden_bracers",false],["wildwarden_gloves",false],["wildwarden_boots",false]]',
    'zdo H_01|mittelbraun|fjordblau|||wikingerin',
  ],
};
const SOLL_CHAT_ATTRAPPE: Aufzeichnung = {
  paket: [
    'ich:ChatMessage:["0","ich",1,"Hallo Welt",10]:33:bd9f78f5b7b7dbe4',
    'nah:ChatMessage:["0","ich",1,"Hallo Welt",10]:33:bd9f78f5b7b7dbe4',
    'mittel:ChatMessage:["0","ich",1,"Hallo Welt",10]:33:bd9f78f5b7b7dbe4',
    'ich:ChatMessage:["0","ich",0,"Hallo Welt",10]:33:755453c5888265c5',
    'nah:ChatMessage:["0","ich",0,"Hallo Welt",10]:33:755453c5888265c5',
    'ich:ChatMessage:["0","ich",2,"Hallo Welt",10]:33:bad3fcbffbb64f43',
    'nah:ChatMessage:["0","ich",2,"Hallo Welt",10]:33:bad3fcbffbb64f43',
    'mittel:ChatMessage:["0","ich",2,"Hallo Welt",10]:33:bad3fcbffbb64f43',
    'fern:ChatMessage:["0","ich",2,"Hallo Welt",10]:33:bad3fcbffbb64f43',
    'ich:ChatMessage:["0","ich",99,"Hallo Welt",10]:33:40efad2e617e8ed2',
    'nah:ChatMessage:["0","ich",99,"Hallo Welt",10]:33:40efad2e617e8ed2',
    'mittel:ChatMessage:["0","ich",99,"Hallo Welt",10]:33:40efad2e617e8ed2',
    'ich:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]:47:b1b66c529e9fa28d',
    'nah:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]:47:b1b66c529e9fa28d',
    'mittel:ChatMessage:["0","ich",1,"Grüße aus Ägir",18]:47:b1b66c529e9fa28d',
    'ich:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]:280:0846391d8a9b1c3f',
    'nah:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]:280:0846391d8a9b1c3f',
    'mittel:ChatMessage:["0","ich",1,"xxxxxxxxxxxxxx",256]:280:0846391d8a9b1c3f',
    'ich:ChatMessage:["0","ich",1,"   yyyyyyyyyyy",67]:91:0eaf95e1a00a27c5',
    'nah:ChatMessage:["0","ich",1,"   yyyyyyyyyyy",67]:91:0eaf95e1a00a27c5',
    'mittel:ChatMessage:["0","ich",1,"   yyyyyyyyyyy",67]:91:0eaf95e1a00a27c5',
    'ich:ChatMessage:["0","ich",1,"",0]:23:8450172bea627a6f',
    'nah:ChatMessage:["0","ich",1,"",0]:23:8450172bea627a6f',
    'mittel:ChatMessage:["0","ich",1,"",0]:23:8450172bea627a6f',
  ],
  aufrufe: { getPeers:  10 },
  konsole: { log: 10, warn: 0 },
  zustand: [2],
  ausnahmen: ['RangeError', 'RangeError'],
  notizen: [
    'log 22:51e7884aa3dedb5c:[Chat] ich: Hallo Welt',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 22:51e7884aa3dedb5c:[Chat] ich: Hallo Welt',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 22:51e7884aa3dedb5c:[Chat] ich: Hallo Welt',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 22:51e7884aa3dedb5c:[Chat] ich: Hallo Welt',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 30:b911f52ba3b47792:[Chat] ich: Grüße aus Ägir — ß',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 268:6bb3354af4135cc9:[Chat] ich: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 79:27b17c7c819bd56a:[Chat] ich:    yyyyyyyyyyyyyyyyyyyyyyyyyyyyyy zz',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 12:4ff4c1c5fc2e3550:[Chat] ich: ',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'peer ed position={"x":0,"y":15.5,"z":4} worldId="haupt"',
    'peer ed position={"x":0,"y":15.5,"z":4} worldId="haupt"',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 18:66738b7103edb0c2:[Chat] ich: allein',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 16:528b123b78dc94da:[Chat] ich: drin',
    'peer ich position={"x":0,"y":3.5,"z":4} worldId="dungeon:x"',
  ],
};
const SOLL_CHAT_ECHT: Aufzeichnung = {
  paket: [
    'a:ChatMessage:["0","a",1,"Hallo Ägir",10]:32:c80c08063d897871',
    'b:ChatMessage:["0","a",1,"Hallo Ägir",10]:32:c80c08063d897871',
    'a:ChatMessage:["0","a",0,"Hallo Ägir",10]:32:f11f653c72638945',
    'a:ChatMessage:["0","a",2,"Hallo Ägir",10]:32:1d72cadb942d27c8',
    'b:ChatMessage:["0","a",2,"Hallo Ägir",10]:32:1d72cadb942d27c8',
    'd:ChatMessage:["0","a",2,"Hallo Ägir",10]:32:1d72cadb942d27c8',
  ],
  aufrufe: { getPeers:  3 },
  konsole: { log: 7, warn: 0 },
  zustand: [],
  ausnahmen: ['RangeError'],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    'log 20:b446cd80dbecfdd6:[Chat] a: Hallo Ägir',
    'peer a position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 20:b446cd80dbecfdd6:[Chat] a: Hallo Ägir',
    'peer a position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'log 20:b446cd80dbecfdd6:[Chat] a: Hallo Ägir',
    'peer a position={"x":0,"y":3.5,"z":4} worldId="haupt"',
    'peer ed position={"x":0,"y":15.5,"z":4} worldId="haupt"',
    'peer a position={"x":0,"y":3.5,"z":4} worldId="haupt"',
  ],
};

/** Step 1, package C: measured with `--messen-basis` on the stand before the move (C0, the three methods still in the class). */
const SOLL_SPIELER_ATTRAPPE: Aufzeichnung = {
  paket: [],
  aufrufe: { register: 2, getGroundHeight: 11, teleportPeer: 10, getInstance: 2, getPeers: 12, vergiss: 4, teleportPeerNeu: 1, getPeersNeu: 2 },
  konsole: { log: 0, warn: 0 },
  zustand: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3, 3, 3, 1, 1, 0],
  ausnahmen: [
    'TypeError',
  ],
  notizen: [
    'register teleport',
    'register spieler',
    'registered teleport,spieler',
    'call getGroundHeight 10 20',
    'call teleportPeer 3 Ich [{"x":10,"y":10.0625,"z":20},null]',
    '> ["10","20"] = {"ok":true,"active":false,"message":"Teleportiert nach 10, 20 (Höhe 10.1)"} args=["10","20"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight -5.5 7',
    'call teleportPeer 3 Ich [{"x":-5.5,"y":-0.9375,"z":7},null]',
    '> ["-5.5","7"] = {"ok":true,"active":false,"message":"Teleportiert nach -6, 7 (Höhe -0.9)"} args=["-5.5","7"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["Olaf"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["Olaf"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["Olaf","3"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["Olaf","3"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> [] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["1"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["1"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["abc","2"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["abc","2"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["Infinity","0"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["Infinity","0"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["NaN","1"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["NaN","1"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 1000 200',
    'call teleportPeer 3 Ich [{"x":1000,"y":550.0625,"z":200},null]',
    '> ["1e3","2e2"] = {"ok":true,"active":false,"message":"Teleportiert nach 1000, 200 (Höhe 550.1)"} args=["1e3","2e2"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 16 5',
    'call teleportPeer 3 Ich [{"x":16,"y":9.3125,"z":5},null]',
    '> ["0x10","5"] = {"ok":true,"active":false,"message":"Teleportiert nach 16, 5 (Höhe 9.3)"} args=["0x10","5"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 3 4',
    'call teleportPeer 3 Ich [{"x":3,"y":2.5625,"z":4},null]',
    '> ["3","4","5"] = {"ok":true,"active":false,"message":"Teleportiert nach 3, 4 (Höhe 2.6)"} args=["3","4","5"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 0.4 -0.6',
    'call teleportPeer 3 Ich [{"x":0.4,"y":0.11250000000000002,"z":-0.6},null]',
    '> ["0.4","-0.6"] = {"ok":true,"active":false,"message":"Teleportiert nach 0, -1 (Höhe 0.1)"} args=["0.4","-0.6"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 7 8',
    'call teleportPeer 3 Ich [{"x":7,"y":5.5625,"z":8},null]',
    '> ["7","8"] = {"ok":true,"active":false,"message":"Teleportiert nach 7, 8 (Höhe 5.6)"} args=["7","8"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getInstance d-inst',
    'call getGroundHeight 12 34',
    'call teleportPeer 3 Ich [{"x":12,"y":14.5625,"z":34},null]',
    '> ["12","34"] = {"ok":true,"active":false,"message":"Teleportiert nach 12, 34 (Höhe 14.6)"} args=["12","34"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'instance players 8',
    'call getInstance d-weg',
    'call getGroundHeight 12 34',
    'call teleportPeer 3 Ich [{"x":12,"y":14.5625,"z":34},null]',
    '> ["12","34"] = {"ok":true,"active":false,"message":"Teleportiert nach 12, 34 (Höhe 14.6)"} args=["12","34"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["x","y"] = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"} args=["x","y"]',
    'peer Ich dungeonId="d-inst" dungeonReturn={"x":9,"y":9,"z":9} position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 3 4',
    'call teleportPeer 3 Ich [{"x":3,"y":2.5625,"z":4},null]',
    '> ["3","4"] = {"ok":true,"active":false,"message":"Teleportiert nach 3, 4 (Höhe 2.6)"} args=["3","4"]',
    'peer Ich dungeonId="" dungeonReturn={"x":9,"y":9,"z":9} position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> [] = {"ok":true,"active":false,"message":"7 Datensaetze: Alt1, Doppelt, OhneId, Online, alt2, doppelt, Ägir"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["liste"] = {"ok":true,"active":false,"message":"7 Datensaetze: Alt1, Doppelt, OhneId, Online, alt2, doppelt, Ägir"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["LISTE"] = {"ok":true,"active":false,"message":"7 Datensaetze: Alt1, Doppelt, OhneId, Online, alt2, doppelt, Ägir"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["Liste","extra"] = {"ok":true,"active":false,"message":"7 Datensaetze: Alt1, Doppelt, OhneId, Online, alt2, doppelt, Ägir"} args=["extra"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["online"] = {"ok":true,"active":false,"message":"Online [id-on] (admin) | Editor [ed] | Gast [g]"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["ONLINE"] = {"ok":true,"active":false,"message":"Online [id-on] (admin) | Editor [ed] | Gast [g]"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen"] = {"ok":false,"active":false,"message":"Aufruf: spieler entfernen <name> [<name> …]"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen","Online"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Online (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Online"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen","online"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: online (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["online"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen","Editor"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Editor (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Editor"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen","Unbekannt"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Unbekannt (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Unbekannt"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    '> ["entfernen","doppelt"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: doppelt (nicht eindeutig) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["doppelt"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt1,id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    'call vergiss ["id-alt1","id-alt1"]',
    '> ["entfernen","Alt1"] = {"ok":true,"active":false,"message":"Entfernt: Alt1 | Noch 6 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Alt1"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-alt2,id-d1,id-d2,id-on,id-ohne,id-ae',
    'call vergiss ["id-alt2","id-alt2"]',
    '> ["entfernen","ALT2","Geist","Online"] = {"ok":true,"active":false,"message":"Entfernt: ALT2 | Uebersprungen: Geist (unbekannt), Online (verbunden) | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["ALT2","Geist","Online"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-d1,id-d2,id-on,id-ohne,id-ae',
    'call vergiss ["id-ohne",""]',
    '> ["entfernen","OhneId"] = {"ok":true,"active":false,"message":"Entfernt: OhneId | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["OhneId"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-d1,id-d2,id-on,id-ae',
    'call vergiss ["id-ae","id-ae"]',
    '> ["entfernen","ägir"] = {"ok":true,"active":false,"message":"Entfernt: ägir | Noch 3 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["ägir"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-d1,id-d2,id-on',
    '> ["foo"] = {"ok":false,"active":false,"message":"Aufruf: spieler liste | spieler online | spieler entfernen <name> …"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-d1,id-d2,id-on',
    '> ["entfernen","Alt1"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Alt1 (unbekannt) | Noch 3 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Alt1"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-d1,id-d2,id-on',
    '> ["liste"] = {"ok":true,"active":false,"message":"1 Datensaetze: Neu"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved neu',
    'call getGroundHeight 1 2',
    'call teleportPeerNeu 3',
    '> ["1","2"] = {"ok":true,"active":false,"message":"Teleportiert nach 1, 2 (Höhe 1.1)"} args=["1","2"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> ["online"] = {"ok":true,"active":false,"message":"Niemand online"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved neu',
    '> ["entfernen","neu"] = {"ok":true,"active":false,"message":"Entfernt: neu | Noch 0 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["neu"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved ',
    '> ["1","2"] throws TypeError',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
  ],
};
const SOLL_SPIELER_ECHT: Aufzeichnung = {
  paket: [
    'Ich:Teleport:40:e5fb1662892f39e6',
    'Ich:Teleport:40:214d05eb0cb123ec',
    'Ich:Teleport:40:0710b164e45a6205',
    'Ich:Teleport:52:a5fccccadc0313c6',
    'Ich:Teleport:40:02774683002404dc',
    'Ich:Teleport:40:4f0fa253732af96c',
  ],
  aufrufe: { getGroundHeight: 5, weltWechselVorbereiten: 2, listTerrainComps: 1, getPeers: 7, vergiss: 3, register: 2 },
  konsole: { log: 5, warn: 0 },
  zustand: [1, 0, 5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 3],
  ausnahmen: [],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    'call getGroundHeight 10 20',
    '> teleport 10 20 = {"ok":true,"active":false,"message":"Teleportiert nach 10, 20 (Höhe 10.1)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":10,"y":10.0625,"z":20} worldId="haupt" char=0:0',
    'call getGroundHeight -5.5 7',
    '> teleport -5.5 7 = {"ok":true,"active":false,"message":"Teleportiert nach -6, 7 (Höhe -0.9)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":-5.5,"y":-0.9375,"z":7} worldId="haupt" char=0:0',
    '> teleport Olaf = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":-5.5,"y":-0.9375,"z":7} worldId="haupt" char=0:0',
    '> teleport = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":-5.5,"y":-0.9375,"z":7} worldId="haupt" char=0:0',
    '> teleport 1 = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":-5.5,"y":-0.9375,"z":7} worldId="haupt" char=0:0',
    '> teleport abc 2 = {"ok":false,"active":false,"message":"Aufruf: teleport <x> <z>"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":-5.5,"y":-0.9375,"z":7} worldId="haupt" char=0:0',
    'call getGroundHeight 3 4',
    '> TELEPORT 3 4 5 = {"ok":true,"active":false,"message":"Teleportiert nach 3, 4 (Höhe 2.6)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    '> dungeon create cave 42 = {"ok":true,"active":false,"message":"Dungeon erzeugt: cave-2a (52 Räume, Seed 42, Zone 64)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    'log 89:d5dd0335bffe73ed:[Dungeon] Instance \'cave-2a\' materialized in wor',
    '> dungeon enter cave-2a = {"ok":true,"active":true,"message":"Dungeon betreten: Cave #2a"}',
    'peer Ich dungeonId="cave-2a" dungeonReturn={"x":3,"y":2.5625,"z":4} position={"x":2.3841854120595425e-7,"y":0.5,"z":1.9999999999999858} worldId="dungeon:cave-2a" char=0:0',
    'call getGroundHeight 5 6',
    '> teleport 5 6 = {"ok":true,"active":false,"message":"Teleportiert nach 5, 6 (Höhe 4.1)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler = {"ok":true,"active":false,"message":"5 Datensaetze: Bjørn, Editor, Olaf, Ragnar, ragnar"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler online = {"ok":true,"active":false,"message":"Olaf [o1] (admin) | Editor [ed]"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler entfernen = {"ok":false,"active":false,"message":"Aufruf: spieler entfernen <name> [<name> …]"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler entfernen olaf = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: olaf (verbunden) | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'call vergiss ["e1","e1"]',
    '> spieler entfernen editor = {"ok":true,"active":false,"message":"Entfernt: editor | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler entfernen Unbekannt = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Unbekannt (unbekannt) | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler entfernen RAGNAR = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: RAGNAR (nicht eindeutig) | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'call vergiss ["b1","b1"]',
    '> spieler entfernen bjørn = {"ok":true,"active":false,"message":"Entfernt: bjørn | Noch 3 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler foo = {"ok":false,"active":false,"message":"Aufruf: spieler liste | spieler online | spieler entfernen <name> …"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler liste = {"ok":true,"active":false,"message":"3 Datensaetze: Olaf, Ragnar, ragnar"}',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    '> spieler liste = {"ok":false,"active":false,"message":"Admin commands are not allowed for this player"}',
    'peer Kein dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'register teleport',
    'register spieler',
    '> ["liste"] = {"ok":true,"active":false,"message":"4 Datensaetze: Olaf, Ragnar, Zweit, ragnar"} args=[]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'call vergiss ["z1","z1"]',
    '> ["entfernen","Zweit"] = {"ok":true,"active":false,"message":"Entfernt: Zweit | Noch 3 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Zweit"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'call getGroundHeight 8 9',
    '> ["8","9"] = {"ok":true,"active":false,"message":"Teleportiert nach 8, 9 (Höhe 6.3)"} args=["8","9"]',
    'peer Ich dungeonId=null dungeonReturn=null position={"x":8,"y":6.3125,"z":9} worldId="haupt" char=0:0',
  ],
};

/** Step 1, package C, N1: measured with `--messen-basis` on C0 (`2d4bb0bd`, the three methods still in the class). */
const SOLL_SPIELER_ATTRAPPE_N1: Aufzeichnung = {
  paket: [],
  aufrufe: { register: 2, getPeers: 9, vergiss: 4, getInstanceNeu: 1, getGroundHeight: 1, teleportPeer: 1 },
  konsole: { log: 0, warn: 0 },
  zustand: [8, 8, 8, 8, 7, 7, 6, 5, 4, 4],
  ausnahmen: [],
  notizen: [
    '> ["online"] = {"ok":true,"active":false,"message":"Selbst [id-selbst] (admin) | Bjo\u0308rn [id-bjoern] (admin) | EdAdmin [ed-a] (admin)"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    '> ["entfernen","Selbst"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Selbst"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    '> ["entfernen","selbst"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["selbst"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    '> ["liste"] = {"ok":true,"active":false,"message":"8 Datensaetze: Björn, Einmal, Jo\u0308rg, Selbst, Ulf , Zwilling, Zwilling, Åsa"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    'call vergiss ["id-einmal","id-einmal"]',
    '> ["entfernen","Einmal","Einmal"] = {"ok":true,"active":false,"message":"Entfernt: Einmal | Uebersprungen: Einmal (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Einmal","Einmal"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    '> ["entfernen","björn"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: björn (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["björn"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call vergiss ["id-joerg","id-joerg"]',
    '> ["entfernen","JÖRG"] = {"ok":true,"active":false,"message":"Entfernt: JÖRG | Noch 6 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["JÖRG"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call vergiss ["id-asa","id-asa"]',
    '> ["entfernen","A\u030asa"] = {"ok":true,"active":false,"message":"Entfernt: A\u030asa | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["A\u030asa"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call vergiss ["id-ulf","id-ulf"]',
    '> ["entfernen","ulf"] = {"ok":true,"active":false,"message":"Entfernt: ulf | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["ulf"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-selbst,id-z1,id-z2',
    '> ["online"] = {"ok":true,"active":false,"message":"Allein [id-allein] (admin)"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-selbst,id-z1,id-z2',
    'call getInstanceNeu d-neu',
    'call getGroundHeight 5 6 receiver=context',
    'call teleportPeer 3 Drin [{"x":5,"y":4.0625,"z":6},null]',
    '> ["5","6"] = {"ok":true,"active":false,"message":"Teleportiert nach 5, 6 (Höhe 4.1)"} args=["5","6"]',
    'peer Drin dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'instance players 7',
  ],
};
const SOLL_SPIELER_ECHT_N1: Aufzeichnung = {
  paket: [
    'Selbst:Teleport:40:0710b164e45a6205',
    'Selbst:Teleport:40:02774683002404dc',
  ],
  aufrufe: { getPeers: 8, vergiss: 4, getGroundHeight: 2, getInstanceNeu: 1 },
  konsole: { log: 4, warn: 0 },
  zustand: [8, 8, 8, 7, 7, 6, 5, 4, 4, 4, 4],
  ausnahmen: [],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    '> spieler online = {"ok":true,"active":false,"message":"Selbst [id-selbst] (admin) | Bjo\u0308rn [id-bjoern] (admin) | EdAdmin [ed-a] (admin)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> spieler entfernen Selbst = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> spieler liste = {"ok":true,"active":false,"message":"8 Datensaetze: Björn, Einmal, Jo\u0308rg, Selbst, Ulf , Zwilling, Zwilling, Åsa"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call vergiss ["id-einmal","id-einmal"]',
    '> spieler entfernen Einmal Einmal = {"ok":true,"active":false,"message":"Entfernt: Einmal | Uebersprungen: Einmal (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> spieler entfernen björn = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: björn (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call vergiss ["id-joerg","id-joerg"]',
    '> spieler entfernen JÖRG = {"ok":true,"active":false,"message":"Entfernt: JÖRG | Noch 6 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call vergiss ["id-asa","id-asa"]',
    '> spieler entfernen A\u030asa = {"ok":true,"active":false,"message":"Entfernt: A\u030asa | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call vergiss ["id-ulf","id-ulf"]',
    '> spieler entfernen ulf = {"ok":true,"active":false,"message":"Entfernt: ulf | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 3 4 receiver=context',
    '> teleport 3 4 = {"ok":true,"active":false,"message":"Teleportiert nach 3, 4 (Höhe 2.6)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    '> spieler online = {"ok":true,"active":false,"message":"Allein [id-allein] (admin)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    'call getInstanceNeu d-neu',
    'call getGroundHeight 5 6 receiver=context',
    '> teleport 5 6 = {"ok":true,"active":false,"message":"Teleportiert nach 5, 6 (Höhe 4.1)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'instance players 35',
  ],
};

if (MESSEN_BASIS) {
  const attrappe = messeAttrappe();
  const echt = messeEcht();
  const interAttrappe = messeInteraktionAttrappe();
  const interEcht = messeInteraktionEcht();
  const chatAttrappe = messeChatAttrappe();
  const chatEcht = messeChatEcht();
  const spielerAttrappe = messeSpielerAttrappe();
  const spielerEcht = messeSpielerEcht();
  const spielerAttrappeN1 = messeSpielerAttrappeN1();
  const spielerEchtN1 = messeSpielerEchtN1();
  process.stdout.write(`${JSON.stringify({ attrappe, echt, interAttrappe, interEcht, chatAttrappe, chatEcht, spielerAttrappe, spielerEcht, spielerAttrappeN1, spielerEchtN1 }, null, 1)}\n`);
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
  // the premise of the ownership rule in handleSetAussehen: every armour part has a figure, so `ruestungZu(id)?.figure &&` never skips one; a part without a figure needs its own case
  check('data premise: every armour part of the shared list has a figure (else the ownership case needs a part without one)', RUESTUNG.every((p) => typeof p.figure === 'string' && p.figure !== ''), RUESTUNG.filter((p) => !p.figure).map((p) => p.id).join(','));
  teil('chest/appearance/figure on a stand-in', messeInteraktionAttrappe(), SOLL_INTERAKTION_ATTRAPPE);
  teil('chest/appearance/figure on a real instance through the forwardings', messeInteraktionEcht(), SOLL_INTERAKTION_ECHT);
  teil('chat on a stand-in', messeChatAttrappe(), SOLL_CHAT_ATTRAPPE);
  teil('chat on a real instance through the forwarding', messeChatEcht(), SOLL_CHAT_ECHT);
}

console.log('\n[4] Behaviour of step 1, package C: teleport and spieler give the numbers measured before the move');
{
  const gleich = (a: Aufzeichnung, b: Aufzeichnung): boolean => JSON.stringify(a) === JSON.stringify(b);
  const teil = (titel: string, gemessen: Aufzeichnung, soll: Aufzeichnung): void => {
    check(`${titel}: the packets sent, in order`, same(gemessen.paket, soll.paket), `${gemessen.paket.length} packets, expected ${soll.paket.length}; first difference: ${gemessen.paket.find((x, i) => x !== soll.paket[i])}`);
    check(`${titel}: the calls into the context`, JSON.stringify(gemessen.aufrufe) === JSON.stringify(soll.aufrufe), JSON.stringify(gemessen.aufrufe));
    check(`${titel}: the messages, the calls with their arguments and the peer after every command`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])}`);
    check(`${titel}: the state numbers, the console output and the exceptions`, JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([soll.zustand, soll.konsole, soll.ausnahmen]), JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]));
    check(`${titel}: all of it`, gleich(gemessen, soll));
  };
  teil('teleport/spieler on a stand-in', messeSpielerAttrappe(), SOLL_SPIELER_ATTRAPPE);
  teil('teleport/spieler on a real instance (registry of the constructor, then the forwardings)', messeSpielerEcht(), SOLL_SPIELER_ECHT);
}

console.log('\n[4b] Behaviour of step 1, package C, after the attack (N1): Unicode forms, the caller online, receivers, replaced dungeons');
{
  const gleich = (a: Aufzeichnung, b: Aufzeichnung): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const [titel, gemessen, soll] of [
    ['N1 on a stand-in', messeSpielerAttrappeN1(), SOLL_SPIELER_ATTRAPPE_N1],
    ['N1 on a real instance', messeSpielerEchtN1(), SOLL_SPIELER_ECHT_N1],
  ] as const) {
    check(`${titel}: the messages, the calls with their arguments and receivers, the peer after every command`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])}`);
    check(`${titel}: packets, calls, state numbers, console, exceptions`, gleich(gemessen, soll), JSON.stringify([gemessen.aufrufe, gemessen.zustand, gemessen.ausnahmen]));
  }
}

console.log(failures === 0 ? `\n=== I1 form k: ALL PASSED (${total}) ===` : `\n=== I1 form k: ${failures} of ${total} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
