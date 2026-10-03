/**
 * Form k of the modules under `server/src/spiel/` (refactoring I1, from step 2).
 * Die Form k der Module unter `server/src/spiel/`: eine Methode von `WovServer` wird eine Funktion mit Kontext.
 *
 * Step 2 moved six methods of `server/src/WovServer.ts` unchanged into two modules: the four dungeon editor handlers
 * into `spiel/DungeonEditPakete.ts`, the admin command handler and the time-of-day handler into `spiel/AdminPakete.ts`.
 * Step 3 moved five more: the chest, appearance and figure handlers into `spiel/Interaktion.ts` (`handleTruheOeffnen`,
 * `sendeTruheInhalt`, `handleSetAussehen`, `handleSetFigur`) and `handleChatMessage` into `spiel/Chat.ts`. `handleInteract` and
 * `handleContainerAction` stay in the class (they read the static member `WovServer.FREMDER_BESITZ_MELDUNG`, rule 5).
 * Step 1, package A moved three more into the sub-folder `spiel/befehle/`: `registerAdminListeCommands` and
 * `gleicheAdminrechteAb` into `spiel/befehle/AdminListe.ts`, `registerBannCommands` into `spiel/befehle/Bann.ts`. Their
 * callers are the constructor (the two registrations) and `update()` (the re-check of the admin rights once a second).
 * Step 1, package B moved four command registrations into the sub-folder `spiel/befehle/`: `registerMarkeCommand` and
 * `registerWetterCommand` into `befehle/Weltzustand.ts`, `registerAbbauCommand` into `befehle/Abbau.ts`, `registerSpawnCommand`
 * (`item` and `spawn`) into `befehle/Spawn.ts`. Their forwardings take no parameter and are called by the constructor.
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
 *  Step 1A: every sub-command of `admin`, `kick`, `bann` and `entbann` with valid and invalid arguments (success, missing
 *  arguments, unknown and ambiguous names, the last admin, an admin as the target of a ban, bans with and without a deadline,
 *  the origin of a connection), with a fixed clock and time zone; the message of every command is held as text, every call
 *  into the context with its arguments, the rights of every open session after every command, the order of the registry.
 *  Step 1A after the attack (I11A-B1..B3): more spellings and names of two words, deadlines without anchor ([2d]); the call of each
 *  registration stands directly in the constructor and the re-check directly in the one-second block of `update()`, the only mention
 *  in the class ([1c]); the re-check really runs from `update()` in every full second, and the registry is complete with
 *  `everyone-admin: true` ([4b]), and it acts on an open session at seven seconds past a full minute; `update()` has no early exit;
 *  the heads of the relaxed members are frozen with their modifiers (`readonly kontenDb`).
 *  Step 1, package B: the context type comes from `../Kontext.js` in the sub-folder (the specifier is computed from the path of the
 *  module); the caller of a forwarding can be the constructor; every module under `spiel/` and its sub-folders that uses
 *  `SpielKontext` must be in `MODULE`. The fixed sequence runs every command and sub-command of `marke`, `wetter`, `abbau`, `item`
 *  and `spawn`, valid and invalid arguments and the error branches, on a stand-in (whose members are counted on every read and
 *  replaced after the registration, so a stale copy shows) and on a real instance (handlers of the constructor and of the
 *  forwardings); every result is held as its whole text, the calls into the context with their arguments, the inventories of the
 *  peers and of the absent players, the stamps and the markers.
 *  Step 1B after the attack (I11B-B1..B3, N1-B1, N1-B2): every forwarding is named exactly once in the class (any receiver) and its
 *  module function is used exactly once in the whole file outside the import lines, as the call in the forwarding; the modifiers
 *  of every relaxed member are frozen (`MODIFIKATOREN`, steps 1A, 1B, 2, 3).
 *  Step 1, package C: the commands `teleport` and `spieler` with all sub-commands and their error branches, on a stand-in (the handlers
 *  registered by the functions, every call into the context with its arguments, the message as text, the peer state after every call,
 *  a member replaced on the stand-in between registration and call) and on a real instance (the registry its constructor built, with a
 *  real dungeon instance that `teleport` leaves, and the two forwardings called again on the instance).
 *  Step 1, package C, after the attack (N1): names that differ only in Unicode form or trailing space, the caller itself online with a
 *  record of its own, an editor that is admin, exactly one player online, the same name twice in one command, two records with the same
 *  name, `dungeons` replaced after the registration, and `getGroundHeight` called on its receiver; the relaxed members keep `readonly`
 *  exactly as frozen in `LOCKERUNGEN_C`.
 *  Step 1, package D: `registerDungeonCommand` (the command `dungeon` with 13 sub-commands) and `resolveDungeonBase` moved into
 *  `spiel/befehle/Dungeon.ts`. Its context is called `kd`, not `k`: the `steinkit` branch has a local `k` (rule 2.1); `kontextName` in
 *  `MODULE` names it, the default stays `k`, and a name other than `k` is only allowed where the module declares a `k` of its own
 *  ([0b]). `resolveDungeonBase` is a context member that the class never calls: only the moved code calls it, once, through the
 *  context (`nurUeberKontext`). The fixed sequence runs all 13 sub-commands with their error branches (no argument, an unknown id, no
 *  rights, a guest), on a stand-in (a real registry, every call into the context with its arguments and receiver, the documents after
 *  every command, members replaced after the registration) and on a real instance (real documents on disk, a real entrance and
 *  instance, then the two forwardings called again) ([2h], [4f]).
 *  Step 1, package D, after the attack (N1): ids and keywords in another spelling, the boundaries of licht (just above 3, next to 1)
 *  and of the seeds (from 2^31), values with a second '=', an unknown texture together with an unknown key, an entrance at x.6, an
 *  instance without players, names that differ from a kit by an accent, empty ids straight into the handler, and `dungeons` replaced
 *  after its FIRST use in every branch ([2i], [4g]); the reason for `kd` is read from the syntax tree, not from the text ([1e]).
 *  Not applicable in steps 1A, 1B, 1C, 1D, 2 and 3: the identity of returned objects of the stock (K9-5), no function returns an
 *  object of the stock (`resolveDungeonBase` returns a string).
 *
 * Section [0] shows first that each check can turn red: the same checks run over small invented sources, one fault
 * each (`red:`), and over a good stand (`green:`).
 *
 * `--messen-basis`: prints the measured summaries (step 2: stand-in and real instance; step 3: the same for the chest,
 * appearance, figure and chat handlers; step 1 package C: the same for `teleport` and `spieler`; step 1 package D: the same for `dungeon`) for the stand BEFORE the move, calling `WovServer.prototype.<name>` with
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
import { PacketType, WORLD_TIME_LENGTH, dungeon2, Inventory, WILDWARDEN_PARTS, findItem, FRISUR_VORGABE, HAARFARBE_VORGABE, AUGENFARBE_VORGABE, RUESTUNG, FIGUREN, FRISUREN, HAARFARBEN, AUGENFARBEN, encodeArmor, TRUHE_INHALT_MEMBER, TRUHE_LOOTED_MEMBER, packContainer, unpackContainer, ChatMsgType, STANDARD_WETTER_DEFINITIONEN, PrefabFlag, IRONWARD_PARTS, getStableHash } from '@wov/shared';
import { AdminCommandRegistry } from '../src/admin/AdminCommands.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { Prefab } from '../src/prefab/Prefab.js';
import { WovServer, createWovServer } from '../src/WovServer.js';
import { registryChecksum } from '../src/world/dungeon/ModuleBuild.js';
import { spielerIdErzeugen } from '../src/net/Identitaet.js';
import { NAME_NICHT_EINDEUTIG } from '../src/spiel/Konstanten.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';
import { WeltMarken } from '../src/world/WeltMarken.js';
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
  /**
   * The method of the class that calls `this.<name>(<args>)` (`onPacket` for the packet handlers, `constructor` for the registrations of step 1).
   * With `nurUeberKontext` (step 1D): the class never names `this.<name>`; `methode` is the FUNCTION of the module that calls
   * `<context>.<name>(<args>)`, exactly once (`resolveDungeonBase`, called by the `create` branch of the dungeon command).
   */
  readonly aufrufer: { readonly methode: string; readonly args: string; readonly nurUeberKontext?: true };
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
  /** The name of the context parameter (rule 2.1); `k` when missing. Another name only where the module declares a `k` of its own (step 1D: `kd`). */
  readonly kontextName?: string;
  readonly mitglieder: readonly string[];
  /** Specifiers of the value imports, in the order of the module. */
  readonly wertImporte: readonly string[];
  readonly funktionen: readonly FunktionSpec[];
}

const KOPF = (name: string): string => `private ${name}(peer: Peer, reader: Reader): void`;
/** A packet handler: private forwarding `(peer, reader)`, called by `onPacket`. */
const PAKET = (name: string): FunktionSpec => ({ name, kopf: KOPF(name), aufrufer: { methode: 'onPacket', args: 'peer, reader' }, laenge: 2, paketTyp: name.replace(/^handle/, '') });
/** A registration of chat commands (step 1): a private forwarding without parameters, called once by the constructor. */
const REGISTRIERUNG = (name: string): FunktionSpec => ({ name, kopf: `private ${name}(): void`, aufrufer: { methode: 'constructor', args: '' }, laenge: 0 });
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
    datei: 'server/src/spiel/befehle/AdminListe.ts',
    spezifizierer: './spiel/befehle/AdminListe.js',
    kontextTyp: 'AdminListeKontext',
    mitglieder: ['adminCommands', 'adminListe', 'spielerIdFuerName', 'gleicheAdminrechteAb', 'config', 'net'],
    wertImporte: ['@wov/shared', '../Konstanten.js'],
    funktionen: [
      REGISTRIERUNG('registerAdminListeCommands'),
      // a context member (`admin add`/`admin remove` call it): the forwarding is public; called once a second by `update()`
      { name: 'gleicheAdminrechteAb', kopf: 'gleicheAdminrechteAb(): void', aufrufer: { methode: 'update', args: '' }, laenge: 0 },
    ],
  },
  {
    datei: 'server/src/spiel/befehle/Bann.ts',
    spezifizierer: './spiel/befehle/Bann.js',
    kontextTyp: 'BannKontext',
    mitglieder: ['adminListe', 'kontenDb', 'adminCommands', 'net', 'spielerIdFuerName'],
    wertImporte: ['../../net/Namen.js', '../Konstanten.js'],
    funktionen: [REGISTRIERUNG('registerBannCommands')],
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
    datei: 'server/src/spiel/befehle/Abbau.ts',
    spezifizierer: './spiel/befehle/Abbau.js',
    kontextTyp: 'AbbauKontext',
    mitglieder: ['adminCommands', 'prefabs', 'zdosVon'],
    wertImporte: [],
    funktionen: [REGISTRIERUNG('registerAbbauCommand')],
  },
  {
    datei: 'server/src/spiel/befehle/Spawn.ts',
    spezifizierer: './spiel/befehle/Spawn.js',
    kontextTyp: 'SpawnKontext',
    mitglieder: ['adminCommands', 'speichertGerade', 'net', 'savedPlayers', 'inventarSync', 'sichereSpielerSofort', 'stempelZaehler', 'spielerSicherung', 'saveWorldAsync', 'prefabs', 'getGroundHeight', 'zdosVon'],
    wertImporte: ['@wov/shared', '../../net/Namen.js'],
    funktionen: [REGISTRIERUNG('registerSpawnCommand')],
  },
  {
    datei: 'server/src/spiel/befehle/Weltzustand.ts',
    spezifizierer: './spiel/befehle/Weltzustand.js',
    kontextTyp: 'WeltzustandKontext',
    mitglieder: ['adminCommands', 'weltMarken', 'wetterDienst'],
    wertImporte: ['@wov/shared', '../Wetter.js', '../../world/WeltMarken.js'],
    funktionen: [REGISTRIERUNG('registerMarkeCommand'), REGISTRIERUNG('registerWetterCommand')],
  },
  {
    // step 1, package C (in the sub-folder befehle/: its context file is `../Kontext.js`)
    datei: 'server/src/spiel/befehle/Spieler.ts',
    spezifizierer: './spiel/befehle/Spieler.js',
    kontextTyp: 'SpielerKontext',
    mitglieder: ['adminCommands', 'dungeons', 'getGroundHeight', 'teleportPeer', 'savedPlayers', 'net', 'spielerSicherung'],
    wertImporte: ['../../net/Namen.js'],
    // `teleport` first: it overrides the base `teleport` of AdminCommands and is registered before every other command of the server
    funktionen: [REGISTRIERUNG_C('registerTeleportCommand', 0), REGISTRIERUNG_C('registerSpielerCommand', 1)],
  },
  {
    // step 1, package D: the context is `kd`, not `k` (the `steinkit` branch declares `const [k, v]`; rule 2.1)
    datei: 'server/src/spiel/befehle/Dungeon.ts',
    spezifizierer: './spiel/befehle/Dungeon.js',
    kontextTyp: 'DungeonKontext',
    kontextName: 'kd',
    mitglieder: ['adminCommands', 'dungeons', 'resolveDungeonBase', 'enterDungeon', 'leaveDungeon'],
    wertImporte: ['@wov/shared'],
    funktionen: [
      // the third registration of the constructor, right after teleport and spieler (as before the move)
      REGISTRIERUNG_C('registerDungeonCommand', 2),
      // a context member: the forwarding is public; the class never calls it, only the `create` branch of the dungeon command does, through the context
      { name: 'resolveDungeonBase', kopf: 'resolveDungeonBase(input: string | undefined): string | null', aufrufer: { methode: 'registerDungeonCommand', args: 'args[0]', nurUeberKontext: true }, laenge: 1 },
    ],
  },
];

/**
 * The non-private members of `WovServer`, sorted: 36 before step 2, plus `dungeonsWurzel`, `sendTimeSync` and `worldTime`
 * (context members of step 2, relaxed from private), plus `inventarSync`, `kappeLeben`, `sendeTruheInhalt`,
 * `sichereSpielerSofort` and `zdosVon` (context members of step 3, relaxed from private), plus `gleicheAdminrechteAb`,
 * `kontenDb` and `spielerIdFuerName` (context members of step 1A, relaxed from private), plus `savedPlayers`, `speichertGerade`,
 * `spielerSicherung`, `stempelZaehler` and `wetterDienst` (context members of step 1B, relaxed from private; `savedPlayers` and
 * `spielerSicherung` are context members of step 1C too), plus `teleportPeer` (context member of step 1C, relaxed from
 * private), plus `resolveDungeonBase` (context member of step 1D, relaxed from private). One per line; a later step adds its
 * relaxations here, each with a reason.
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
  'gleicheAdminrechteAb', // step 1A: context member of befehle/AdminListe (the forwarding itself is public)
  'hauptwelt',
  'heightmaps',
  'init',
  'instanzWeltAnlegen',
  'instanzWeltEntfernen',
  'inventarSync', // step 3: context member of Interaktion
  'kappeLeben', // step 3: context member of Interaktion
  'kollisionswelt',
  'kontenDb', // step 1A: context member of befehle/Bann (the field stays in the class)
  'leaveDungeon',
  'liegezeitMs',
  'net',
  'ohneWeltVerworfen',
  'prefabs',
  'resolveDungeonBase', // step 1 D: context member of befehle/Dungeon (the forwarding itself is public; only the create branch of the dungeon command calls it)
  'routen',
  'saveWorld',
  'saveWorldAsync',
  'savedPlayers', // step 1 B: context member of befehle/Spawn (item for an absent player); tests set it by name; step 1 C: also of befehle/Spieler
  'sendTimeSync', // step 2: context member of AdminPakete
  'sendeTruheInhalt', // step 3: context member of Interaktion (the forwarding itself is public)
  'serverUserId',
  'sichereSpielerSofort', // step 3: context member of Interaktion (F8, #146)
  'spawns',
  'speichertGerade', // step 1 B: context member of befehle/Spawn (refuses item ironward/wildwarden while a save runs)
  'spielerIdFuerName', // step 1A: context member of befehle/AdminListe and befehle/Bann
  'spielerSicherung', // step 1 B: context member of befehle/Spawn (the immediate save of an absent player); step 1 C: also of befehle/Spieler (`spieler entfernen` forgets the record)
  'start',
  'stempelZaehler', // step 1 B: context member of befehle/Spawn (a new stamp for an absent player)
  'stop',
  'teleportPeer', // step 1 (package C): context member of befehle/Spieler (the `teleport` command moves the peer)
  'weltMarken',
  'welten',
  'wetterDienst', // step 1 B: context member of befehle/Weltzustand (the method stays in the class, the tick and the login call it)
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

/** The specifier of `server/src/spiel/Kontext.ts` seen from a module (`./Kontext.js` in `spiel/`, `../Kontext.js` in `spiel/befehle/`). */
const kontextSpezifizierer = (datei: string): string => {
  const tiefe = datei.split('/').length - 'server/src/spiel/X.ts'.split('/').length;
  return tiefe === 0 ? './Kontext.js' : `${'../'.repeat(tiefe)}Kontext.js`;
};

/** The findings for one module: items 1 to 4 of the header. Empty when the module is as frozen. */
function pruefeModul(spec: ModulSpec, text: string): string[] {
  const f: string[] = [];
  const sf = parse(spec.datei, text);
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // the name of the context (step 1D): `k` unless the table names another one
  const kn = spec.kontextName ?? 'k';
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
    const okKontext = !!p0 && ts.isIdentifier(p0.name) && p0.name.text === kn && !p0.initializer && !p0.questionToken && !p0.dotDotDotToken && !!p0.type && p0.type.getText(sf) === spec.kontextTyp;
    if (!okKontext) f.push(`${fn.name?.text}: the first parameter is not \`${kn}: ${spec.kontextTyp}\``);
    const gehe = (n: ts.Node): void => {
      if (n.kind === ts.SyntaxKind.ThisKeyword) f.push(`line ${line(n)}: ${fn.name?.text} uses \`this\` (it became \`${kn}\`)`);
      if (ts.isIdentifier(n) && n.text === kn && !(fn.parameters[0] && n === fn.parameters[0].name)) {
        const par = n.parent;
        const declariert = (ts.isVariableDeclaration(par) || ts.isParameter(par) || ts.isBindingElement(par)) && par.name === n;
        if (declariert) f.push(`line ${line(n)}: ${fn.name?.text} declares a second \`${kn}\`, the context is shadowed`);
        else if (ts.isPropertyAccessExpression(par) && par.name === n) {
          /* `x.k`: a member called k, not the context */
        } else if (ts.isPropertyAccessExpression(par) && par.expression === n && par.questionDotToken !== undefined) {
          f.push(`line ${line(n)}: ${fn.name?.text} reads \`${kn}?.${par.name.getText(sf)}\`: the context is never missing, an optional chain would hide a missing member`);
        } else if (!(ts.isPropertyAccessExpression(par) && par.expression === n)) f.push(`line ${line(n)}: ${fn.name?.text} uses \`${kn}\` as a value (${par.getText(sf).slice(0, 40)}): only \`${kn}.<member>\` is allowed`);
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
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === kn) gelesen.add(n.name.text);
      ts.forEachChild(n, gehe);
    };
    if (fn.body) gehe(fn.body);
  }
  if (!same([...gelesen].sort(), [...spec.mitglieder].sort())) f.push(`the members read as ${kn}.<member> are [${[...gelesen].sort()}], the context lists [${[...spec.mitglieder].sort()}]: none in reserve, none missing`);
  // step 1D, rule 2.1: a context name other than `k` only where the module declares a `k` of its own (the reason for the other name)
  if (kn !== 'k') {
    let eigenesK = 0;
    const g = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === 'k' && (ts.isVariableDeclaration(n.parent) || ts.isParameter(n.parent) || ts.isBindingElement(n.parent)) && n.parent.name === n) eigenesK++;
      ts.forEachChild(n, g);
    };
    g(sf);
    if (eigenesK === 0) f.push(`the context is called \`${kn}\`, but the module declares no \`k\` of its own: rule 2.1 wants \`k\``);
  }
  // step 1D: a function the class never calls is called by the moved code, through the context, exactly once, in the frozen function, with the frozen arguments
  for (const ziel of spec.funktionen.filter((x) => x.aufrufer.nurUeberKontext)) {
    const stellen: string[] = [];
    for (const fn of funktionen) {
      const g = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === kn && n.name.text === ziel.name) {
          const c = n.parent;
          const ruf = ts.isCallExpression(c) && c.expression === n && !c.questionDotToken && !n.questionDotToken && c.arguments.map((x) => x.getText(sf)).join(', ') === ziel.aufrufer.args;
          stellen.push(`${fn.name?.text ?? '?'}:${ruf ? 'call' : 'other'}`);
        }
        ts.forEachChild(n, g);
      };
      if (fn.body) g(fn.body);
    }
    if (stellen.join() !== `${ziel.aufrufer.methode}:call`) f.push(`${ziel.name}: the module names ${kn}.${ziel.name} at [${stellen.join(', ')}], expected exactly one call ${kn}.${ziel.name}(${ziel.aufrufer.args}) in ${ziel.aufrufer.methode}`);
  }
  // the context type is `SpielKontext` from `spiel/Kontext.ts` (`./Kontext.js`, from the sub-folder `befehle/` `../Kontext.js`), imported as `import type { SpielKontext }` under its own name: a look-alike from another file could be `any`
  {
    const kontextPfad = kontextSpezifizierer(spec.datei);
    const importe = sf.statements.filter((x): x is ts.ImportDeclaration => ts.isImportDeclaration(x) && !!x.importClause?.namedBindings && ts.isNamedImports(x.importClause.namedBindings) && x.importClause.namedBindings.elements.some((e) => e.name.text === 'SpielKontext'));
    const el = importe[0]?.importClause?.namedBindings;
    const ok = importe.length === 1 && importe[0]!.importClause!.isTypeOnly && ts.isStringLiteral(importe[0]!.moduleSpecifier) && importe[0]!.moduleSpecifier.text === kontextPfad && !!el && ts.isNamedImports(el) && el.elements.length === 1 && el.elements[0]!.propertyName === undefined;
    if (!ok) f.push(`\`SpielKontext\` must come from \`import type { SpielKontext } from '${kontextPfad}'\`, one import, under its own name`);
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
      // the caller in the class (`onPacket` or another method that stays) still calls the method by its name;
      // step 1D: a function called only through the context has no caller in the class (`pruefeModul` holds its call in the module)
      const nurKontext = fn.aufrufer.nurUeberKontext === true;
      const aufrufer = nurKontext ? undefined : fn.aufrufer.methode === 'constructor' ? klasse.members.find(ts.isConstructorDeclaration) : klasse.members.find((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && nameVon(x) === fn.aufrufer.methode);
      let ruft = false;
      const gehe = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.kind === ts.SyntaxKind.ThisKeyword && n.expression.name.text === fn.name && n.arguments.map((a) => a.getText(sf)).join(',') === fn.aufrufer.args.replace(/ /g, '')) ruft = true;
        ts.forEachChild(n, gehe);
      };
      if (aufrufer) gehe(aufrufer);
      if (!ruft && !nurKontext) f.push(`${fn.name}: ${fn.aufrufer.methode} does not call this.${fn.name}(${fn.aufrufer.args})`);
      // exactly ONE mention of the member name in the whole class, and that is the call above (N1, I11B-B3: no second call in the
      // constructor, no call from init() or another method, no `this.<name>` handed on as a value); any receiver counts, so a cast
      // or an alias of `this` (`(this as WovServer).<name>()`, `const ich = this; ich.<name>()`) is a mention too (N2, H5)
      let erwaehnt = 0;
      // and exactly ONE use of the imported function in the whole file outside the import lines: the call inside the forwarding
      // (N2, N1-B2: `<name>(this)` in init(); H8 of the re-check: a use at module level, outside the class, counts too)
      let direkt = 0;
      let direktInWeiterleitung = 0;
      const zaehleErwaehnung = (n: ts.Node): void => {
        // `PacketType.<x>` is the enum of the packet types, not the member (the invented sources of [0] name packet types like methods)
        if (ts.isPropertyAccessExpression(n) && n.name.text === fn.name && !(ts.isIdentifier(n.expression) && n.expression.text === 'PacketType')) erwaehnt++;
        if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === fn.name) erwaehnt++;
        if (ts.isIdentifier(n) && n.text === fn.name && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isMethodDeclaration(n.parent) && n.parent.name === n)) {
          direkt++;
          let p: ts.Node | undefined = n.parent;
          while (p && p !== m) p = p.parent;
          if (p === m && ts.isCallExpression(n.parent) && n.parent.expression === n) direktInWeiterleitung++;
        }
        ts.forEachChild(n, zaehleErwaehnung);
      };
      for (const s of sf.statements) if (!ts.isImportDeclaration(s)) zaehleErwaehnung(s);
      if (nurKontext) {
        if (erwaehnt !== 0) f.push(`${fn.name}: the class names this.${fn.name} ${erwaehnt} times, expected never (only the moved code calls it, through the context)`);
      } else if (erwaehnt !== 1) f.push(`${fn.name}: the file names this.${fn.name} ${erwaehnt} times, expected exactly once (the call in ${fn.aufrufer.methode})`);
      if (direkt !== 1 || direktInWeiterleitung !== 1) f.push(`${fn.name}: the file uses the imported function ${fn.name} ${direkt} times outside the import lines (${direktInWeiterleitung} in the forwarding), expected exactly once, as the call in the forwarding`);
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

/**
 * The modifiers of the members that the steps relaxed from private (N1, I11B-B3): a relaxation may drop `private` and nothing
 * else. `PUBLIC_MEMBERS` holds the names only; this table holds what stands in front of the name (`readonly`, `static`, `async`,
 * `abstract`, `override`, `declare`, `accessor`, a decorator) and whether the member has `?` or `!`.
 */
const MODIFIKATOREN: Readonly<Record<string, string>> = {
  dungeonsWurzel: '', // step 2
  sendTimeSync: '', // step 2
  worldTime: '', // step 2
  gleicheAdminrechteAb: '', // step 1A (the forwarding; its whole head is also frozen in LOCKERUNG_KOEPFE_1A)
  kontenDb: 'readonly', // step 1A (as LOCKERUNG_KOEPFE_1A: `readonly kontenDb: Kontendatenbank;`)
  spielerIdFuerName: '', // step 1A
  inventarSync: '', // step 3
  kappeLeben: '', // step 3
  sendeTruheInhalt: '', // step 3 (the forwarding)
  sichereSpielerSofort: '', // step 3
  zdosVon: '', // step 3
  savedPlayers: 'readonly', // step 1 B: only `private` dropped, the map stays readonly
  speichertGerade: '', // step 1 B
  spielerSicherung: '', // step 1 B
  stempelZaehler: '', // step 1 B
  wetterDienst: '', // step 1 B
  teleportPeer: '', // step 1 C (savedPlayers and spielerSicherung, context members of 1C too, stand above under 1 B; LOCKERUNGEN_C agrees)
  resolveDungeonBase: '', // step 1 D (the forwarding; its whole head is also frozen in MODULE)
};
function pruefeModifikatoren(text: string, soll: Readonly<Record<string, string>>): string[] {
  const f: string[] = [];
  const sf = parse('WovServer.ts', text);
  const klasse = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer');
  if (!klasse) return ['class WovServer not found'];
  for (const [name, erwartet] of Object.entries(soll)) {
    const m = klasse.members.filter((x) => x.name && ts.isIdentifier(x.name) && x.name.text === name);
    if (m.length !== 1) { f.push(`${name}: ${m.length} members of this name, expected one`); continue; }
    const el = m[0]!;
    const ist = [...(ts.canHaveDecorators(el) ? (ts.getDecorators(el) ?? []).map(() => '@decorator') : []), ...mods(el).map((x) => ts.tokenToString(x.kind) ?? ts.SyntaxKind[x.kind])].join(' ');
    if (ist !== erwartet) f.push(`${name}: modifiers "${ist}", frozen "${erwartet}"`);
    const zeichen = (el as { questionToken?: ts.Node; exclamationToken?: ts.Node });
    if (zeichen.questionToken || zeichen.exclamationToken) f.push(`${name}: a ? or ! was added`);
  }
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
  const SB_C: ModulSpec = { ...S, datei: 'server/src/spiel/befehle/Test.ts', spezifizierer: './spiel/befehle/Test.js' };
  const modulUnten = gutesModul.replace("from './Kontext.js';", "from '../Kontext.js';").replace("from '../net/Peer.js';", "from '../../net/Peer.js';").replace("from '../io/Reader.js';", "from '../../io/Reader.js';");
  check('green: the good module one folder below spiel/', pruefeModul(SB_C, modulUnten).length === 0, show(pruefeModul(SB_C, modulUnten)));
  check('red: module one folder below spiel/, SpielKontext from ./Kontext.js (a file next to it, not spiel/Kontext.ts)', pruefeModul(SB_C, gutesModul).length > 0, show(pruefeModul(SB_C, gutesModul)) || 'no finding');
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
  // step 1A: a module in the sub-folder `befehle/` (the context file one level up), a registration without parameters called by the constructor
  const SB: ModulSpec = {
    datei: 'server/src/spiel/befehle/TestB.ts', spezifizierer: './spiel/befehle/TestB.js', kontextTyp: 'TestBKontext', mitglieder: ['a'], wertImporte: ['../Konstanten.js'],
    funktionen: [REGISTRIERUNG('fr'), { name: 'fg', kopf: 'fg(): void', aufrufer: { methode: 'update', args: '' }, laenge: 0 }],
  };
  const gutesModulB = [
    "import { NAME_NICHT_EINDEUTIG } from '../Konstanten.js';",
    "import type { SpielKontext } from '../Kontext.js';",
    '',
    "type TestBKontext = SpielKontext<'a'>;",
    '',
    'function fr(k: TestBKontext): void {',
    '  k.a.register(NAME_NICHT_EINDEUTIG);',
    '}',
    '',
    'function fg(k: TestBKontext): void {',
    '  k.a.x();',
    '}',
    '',
    'export { fr, fg };',
    '',
  ].join('\n');
  check('green: a good module in the sub-folder befehle/', pruefeModul(SB, gutesModulB).length === 0, show(pruefeModul(SB, gutesModulB)));
  for (const [name, text] of [
    ['SpielKontext from ./Kontext.js in the sub-folder (another file)', gutesModulB.replace("from '../Kontext.js'", "from './Kontext.js'")],
    ['SpielKontext from two levels up in the sub-folder', gutesModulB.replace("from '../Kontext.js'", "from '../../Kontext.js'")],
    ['a value import of the class file from the sub-folder', gutesModulB.replace("import type { SpielKontext }", "import { WovServer } from '../../WovServer.js';\nimport type { SpielKontext }")],
  ] as const) check(`red: module, ${name}`, pruefeModul(SB, text).length > 0, show(pruefeModul(SB, text)) || 'no finding');
  check('red: module, SpielKontext from ../Kontext.js directly under spiel/', pruefeModul(S, gutesModul.replace("from './Kontext.js'", "from '../Kontext.js'")).length > 0);
  const gutB = [
    "import { fr, fg } from './spiel/befehle/TestB.js';",
    'export class WovServer {',
    '  readonly a = 1;',
    '  constructor() {',
    '    this.fr();',
    '  }',
    '',
    '  update(): void {',
    '    this.fg();',
    '  }',
    '',
    '  private fr(): void {',
    '    return fr(this);',
    '  }',
    '',
    '  fg(): void {',
    '    return fg(this);',
    '  }',
    '}',
    '',
  ].join('\n');
  const OB = ['a', 'fg', 'update'];
  check('green: a registration called by the constructor and a public forwarding called by update()', pruefeKlasse([SB], gutB, OB).length === 0, show(pruefeKlasse([SB], gutB, OB)));
  for (const [name, text] of [
    ['the constructor does not call the registration', gutB.replace('    this.fr();\n', '')],
    ['the registration is called by another method, not the constructor', gutB.replace('    this.fr();\n', '').replace('    this.fg();\n', '    this.fg();\n    this.fr();\n')],
    ['the constructor calls it with an argument', gutB.replace('this.fr();', 'this.fr(1);')],
    ['update() does not call the re-check', gutB.replace('    this.fg();\n', '')],
    ['the forwarding passes an argument', gutB.replace('return fr(this);', 'return fr(this, 1);')],
    ['the forwarding passes nothing', gutB.replace('return fr(this);', 'return fr();')],
    ['the forwarding gained a parameter', gutB.replace('private fr(): void {\n    return fr(this);', 'private fr(x?: number): void {\n    return fr(this, x);')],
    ['the public forwarding became private', gutB.replace('  fg(): void {', '  private fg(): void {')],
    ['the import from the folder above', gutB.replace('./spiel/befehle/TestB.js', './spiel/TestB.js')],
  ] as const) {
    const f = pruefeKlasse([SB], text, OB);
    check(`red: class, ${name}`, f.length > 0, show(f) || 'no finding');
  }
  // step 1: a module in a sub-folder of spiel/ (context from ../Kontext.js), a forwarding without parameters, called by the constructor
  const SB1B: ModulSpec = {
    datei: 'server/src/spiel/befehle/TestB.ts', spezifizierer: './spiel/befehle/TestB.js', kontextTyp: 'TestBKontext', mitglieder: ['a'], wertImporte: [],
    funktionen: [{ name: 'fr', kopf: 'private fr(): void', aufrufer: { methode: 'constructor', args: '' }, laenge: 0 }],
  };
  const gutesModul1B = ["import type { SpielKontext } from '../Kontext.js';", '', "type TestBKontext = SpielKontext<'a'>;", '', 'function fr(k: TestBKontext): void {', "  k.a.register('x', () => 1);", '}', '', 'export { fr };', ''].join('\n');
  check('green: a module in a sub-folder with ../Kontext.js', pruefeModul(SB1B, gutesModul1B).length === 0, show(pruefeModul(SB1B, gutesModul1B)));
  check('red: a module in a sub-folder with ./Kontext.js (a context file of the sub-folder)', pruefeModul(SB1B, gutesModul1B.replace("'../Kontext.js'", "'./Kontext.js'")).length > 0);
  check('red: a module in a sub-folder with another spelling of the path', pruefeModul(SB1B, gutesModul1B.replace("'../Kontext.js'", "'../../spiel/Kontext.js'")).length > 0);
  check('red: a module in spiel/ with ../Kontext.js', pruefeModul({ ...S, mitglieder: ['a'], funktionen: [PAKET('fa')] }, ["import type { Peer } from '../net/Peer.js';", "import type { Reader } from '../io/Reader.js';", "import type { SpielKontext } from '../Kontext.js';", "type TestKontext = SpielKontext<'a'>;", 'function fa(k: TestKontext, peer: Peer, reader: Reader): void {', '  k.a(peer, reader);', '}', 'export { fa };', ''].join('\n')).length > 0);
  const gutB1B = ["import { fr } from './spiel/befehle/TestB.js';", 'export class WovServer {', '  readonly a = 1;', '  constructor() {', '    this.vorher();', '    this.fr();', '  }', '', '  private vorher(): void {}', '', '  private fr(): void {', '    return fr(this);', '  }', '}', ''].join('\n');
  check('green: the good class with a constructor that calls a forwarding without parameters', pruefeKlasse([SB1B], gutB1B, ['a']).length === 0, show(pruefeKlasse([SB1B], gutB1B, ['a'])));
  const klassenFehler1B: [string, string][] = [
    ['the constructor does not call the forwarding', gutB1B.replace('    this.fr();\n', '')],
    ['the constructor calls it with an argument', gutB1B.replace('    this.fr();', '    this.fr(1 as never);')],
    ['only another method calls it', gutB1B.replace('    this.fr();\n', '').replace('  private vorher(): void {}', '  private vorher(): void {\n    this.fr();\n  }')],
    ['a parameter on the forwarding', gutB1B.replace('  private fr(): void {\n    return fr(this);', '  private fr(x?: number): void {\n    return fr(this, x);')],
    ['an argument in the forwarding', gutB1B.replace('return fr(this);', 'return fr(this, this);')],
    ['the forwarding made public', gutB1B.replace('  private fr(): void {', '  fr(): void {')],
    ['the import from the old place spiel/', gutB1B.replace("'./spiel/befehle/TestB.js'", "'./spiel/TestB.js'")],
  ];
  for (const [name, text] of klassenFehler1B) {
    const f = pruefeKlasse([SB1B], text, ['a']);
    check(`red: class, ${name}`, f.length > 0, show(f) || 'no finding');
  }
  // N1 (I11B-B3): a second call, a call from another method, the name handed on as a value
  const zweitB: [string, string][] = [
    ['the constructor calls the forwarding twice', gutB1B.replace('    this.fr();', '    this.fr();\n    this.fr();')],
    ['init() calls the forwarding once more', gutB1B.replace('  private vorher(): void {}', '  private vorher(): void {}\n\n  init(): void {\n    this.fr();\n  }')],
    ['the forwarding is handed on as a value', gutB1B.replace('  private vorher(): void {}', "  private vorher(): void {\n    void [this['fr']];\n  }")],
    ['init() calls the forwarding through a cast of this', gutB1B.replace('  private vorher(): void {}', '  private vorher(): void {}\n\n  init(): void {\n    (this as WovServer).fr();\n  }')],
    ['the constructor calls the forwarding through an alias of this', gutB1B.replace('    this.fr();', '    this.fr();\n    const ich = this;\n    ich.fr();')],
  ];
  for (const [name, text] of zweitB) {
    const f = pruefeKlasse([SB1B], text, name.startsWith('init') ? ['a', 'init'] : ['a']);
    check(`red: class, ${name}`, f.some((x) => x.includes('times, expected exactly once')), show(f) || 'no finding');
  }
  // N2 (N1-B2): the imported function called directly once more in the class, or handed on as a value; H8: or outside the class
  for (const [name, text] of [
    ['a call of the module function at module level, outside the class', gutB1B.replace("export class WovServer {", "export const nochmal = (): void => fr({} as never);\nexport class WovServer {")],
    ['init() calls the module function directly', gutB1B.replace('  private vorher(): void {}', '  private vorher(): void {}\n\n  init(): void {\n    fr(this);\n  }')],
    ['the module function is handed on as a value', gutB1B.replace('  private vorher(): void {}', '  private vorher(): void {\n    void [fr];\n  }')],
  ] as const) {
    const f = pruefeKlasse([SB1B], text, name.startsWith('init') ? ['a', 'init'] : ['a']);
    check(`red: class, ${name}`, f.some((x) => x.includes('uses the imported function')), show(f) || 'no finding');
  }
  // N1 (I11B-B3): the modifiers of relaxed members are frozen
  const gutM = ['export class WovServer {', '  readonly a = new Map<string, number>();', '  b = false;', '  c(): number {', '    return 1;', '  }', '  private d = 1;', '}', ''].join('\n');
  const MS = { a: 'readonly', b: '', c: '' };
  check('green: the frozen modifiers of relaxed members', pruefeModifikatoren(gutM, MS).length === 0, show(pruefeModifikatoren(gutM, MS)));
  const modFehler: [string, string][] = [
    ['readonly dropped from a relaxed field', gutM.replace('  readonly a', '  a')],
    ['static added to a relaxed field', gutM.replace('  b = false;', '  static b = false;')],
    ['async added to a relaxed method', gutM.replace('  c(): number {', '  async c(): number {')],
    ['a decorator on a relaxed method', gutM.replace('  c(): number {', '  @dekor c(): number {')],
    ['a ! on a relaxed field', gutM.replace('  b = false;', '  b!: boolean;')],
    ['a relaxed member removed', gutM.replace('  b = false;\n', '')],
    ['protected instead of nothing', gutM.replace('  b = false;', '  protected b = false;')],
  ];
  for (const [name, text] of modFehler) {
    const f = pruefeModifikatoren(text, MS);
    check(`red: modifiers, ${name}`, f.length > 0, show(f) || 'no finding');
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

// ── [0b] Step 1, package D: another name of the context (rule 2.1), and a function the class never calls ──

console.log('\n[0b] Step 1D: the name of the context and a function called only through the context, on invented sources');
{
  // a module whose moved code has a `k` of its own: the context is `kd`; `fh` is a context member that only the moved code calls
  const SD: ModulSpec = {
    datei: 'server/src/spiel/befehle/TestD.ts', spezifizierer: './spiel/befehle/TestD.js', kontextTyp: 'TestDKontext', kontextName: 'kd', mitglieder: ['a', 'fh'], wertImporte: [],
    funktionen: [REGISTRIERUNG_C('registerTestD', 0), { name: 'fh', kopf: 'fh(x: string | undefined): string | null', aufrufer: { methode: 'registerTestD', args: 'args[0]', nurUeberKontext: true }, laenge: 1 }],
  };
  const gutD = [
    "import type { SpielKontext } from '../Kontext.js';",
    '',
    "type TestDKontext = SpielKontext<'a' | 'fh'>;",
    '',
    'function registerTestD(kd: TestDKontext): void {',
    "  kd.a.register('d', (peer: unknown, args: string[]) => {",
    '    const base = kd.fh(args[0]);',
    '    for (const arg of args) {',
    "      const [k, v] = arg.split('=', 2);",
    "      if (k === 'x') return v;",
    '    }',
    '    return base;',
    '  });',
    '}',
    '',
    'function fh(kd: TestDKontext, x: string | undefined): string | null {',
    '  return x ?? null;',
    '}',
    '',
    'export { registerTestD, fh };',
    '',
  ].join('\n');
  check('[0b] green: a module with the context kd, its own k and a function called through the context', pruefeModul(SD, gutD).length === 0, show(pruefeModul(SD, gutD)));
  const mitD = (a: string, b: string): string => { if (!gutD.includes(a)) throw new Error('fault anchor missing: ' + a); return gutD.replace(a, b); };
  const modulFehlerD: [string, ModulSpec, string, string][] = [
    // [name, spec, text, the finding must contain]
    ['the entry without kontextName (default k) for a module whose context is kd', { ...SD, kontextName: undefined }, gutD, 'the first parameter is not `k:'],
    ['kontextName names another name than the module uses', { ...SD, kontextName: 'kx' }, gutD, 'the first parameter is not `kx:'],
    ['kontextName k for a module whose context is kd', { ...SD, kontextName: 'k' }, gutD, 'the first parameter is not `k:'],
    ['the context kd although the module has no k of its own (rule 2.1 wants k)', SD, mitD("      const [k, v] = arg.split('=', 2);\n      if (k === 'x') return v;", "      const [kk, v] = arg.split('=', 2);\n      if (kk === 'x') return v;"), 'declares no `k` of its own'],
    ['kd shadowed by an inner variable', SD, mitD('    return base;', '    const kd = 1;\n    return base + String(kd);'), 'declares a second `kd`'],
    ['kd passed on as a value', SD, mitD('    return base;', '    weiter(kd);\n    return base;'), 'uses `kd` as a value'],
    ['kd with an optional chain', SD, mitD("  kd.a.register('d',", "  kd?.a.register('d',"), 'reads `kd?.a`'],
    ['this instead of kd', SD, mitD('    const base = kd.fh(args[0]);', '    const base = this.fh(args[0]);'), 'uses `this`'],
    ['fh called twice', SD, mitD('    return base;', '    return base ?? kd.fh(args[1]);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
    ['fh called with another argument', SD, mitD('    const base = kd.fh(args[0]);', '    const base = kd.fh(args[1]);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
    ['fh called as an optional call', SD, mitD('    const base = kd.fh(args[0]);', '    const base = kd.fh?.(args[0]);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
    ['fh read but not called', SD, mitD('    const base = kd.fh(args[0]);', '    const f = kd.fh;\n    const base = f(args[0]);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
    ['fh called directly, not through the context', SD, mitD('    const base = kd.fh(args[0]);', '    const base = fh(kd, args[0]);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
    ['fh called from another function', SD, mitD('    const base = kd.fh(args[0]);', '    const base = args[0] ?? null;').replace('  return x ?? null;', '  return x ?? kd.fh(x);'), 'expected exactly one call kd.fh(args[0]) in registerTestD'],
  ];
  for (const [name, spec, text, soll] of modulFehlerD) {
    const f = pruefeModul(spec, text);
    check(`[0b] red: module, ${name}`, f.some((x) => x.includes(soll)), show(f) || 'no finding');
  }
  // the default `k` still holds for a module without kontextName: a module with its own k is red there (shadowing)
  const gutK = gutD.split('kd').join('k');
  check('[0b] red: module, the context k with a k of its own (the default name, shadowed)', pruefeModul({ ...SD, kontextName: undefined }, gutK).some((x) => x.includes('declares a second `k`')), show(pruefeModul({ ...SD, kontextName: undefined }, gutK)) || 'no finding');
  const ohneEigenesK = gutK.replace("      const [k, v] = arg.split('=', 2);\n      if (k === 'x') return v;", "      const [kk, v] = arg.split('=', 2);\n      if (kk === 'x') return v;");
  check('[0b] green: the same module with the default k and no k of its own', pruefeModul({ ...SD, kontextName: undefined }, ohneEigenesK).length === 0, show(pruefeModul({ ...SD, kontextName: undefined }, ohneEigenesK)));
  // the class: `fh` is public (a context member), the class itself never names `this.fh`
  const gutDK = [
    "import { registerTestD, fh } from './spiel/befehle/TestD.js';",
    'export class WovServer {',
    '  readonly a = 1;',
    '  constructor() {',
    '    this.registerTestD();',
    '  }',
    '',
    '  private registerTestD(): void {',
    '    return registerTestD(this);',
    '  }',
    '',
    '  fh(x: string | undefined): string | null {',
    '    return fh(this, x);',
    '  }',
    '}',
    '',
  ].join('\n');
  const OD = ['a', 'fh'];
  check('[0b] green: the class with a registration and a public forwarding the class never calls', pruefeKlasse([SD], gutDK, OD).length === 0, show(pruefeKlasse([SD], gutDK, OD)));
  const mitK = (a: string, b: string): string => { if (!gutDK.includes(a)) throw new Error('fault anchor missing: ' + a); return gutDK.replace(a, b); };
  const klassenFehlerD: [string, string, readonly string[], string][] = [
    ['the class calls fh itself', mitK('    this.registerTestD();', "    this.registerTestD();\n    this.fh('x');"), OD, 'fh: the class names this.fh 1 times, expected never'],
    ['the class hands fh on as a value', mitK('    this.registerTestD();', '    this.registerTestD();\n    void [this.fh];'), OD, 'fh: the class names this.fh 1 times, expected never'],
    ['the class calls the module function fh directly', mitK('    this.registerTestD();', "    this.registerTestD();\n    fh(this, 'y');"), OD, 'fh: the file uses the imported function fh 2 times'],
    ['the forwarding of fh became private', mitK('  fh(x: string | undefined)', '  private fh(x: string | undefined)'), OD, 'fh: head of the forwarding'],
    ['the forwarding of fh passes another argument', mitK('    return fh(this, x);', '    return fh(this, undefined);'), OD, 'fh: the call is'],
    ['fh is not listed as a public member', gutDK, ['a'], 'new non-private members'],
    ['the registration is not called by the constructor', mitK('    this.registerTestD();\n', ''), OD, 'registerTestD:'],
  ];
  for (const [name, text, oeff, soll] of klassenFehlerD) {
    const f = pruefeKlasse([SD], text, oeff);
    check(`[0b] red: class, ${name}`, f.some((x) => x.startsWith(soll) || x.includes(soll)), show(f) || 'no finding');
  }
}

// ── [1] The real sources ───────────────────────────────────────────────

const klassenText = readFileSync(join(WURZEL, 'server/src/WovServer.ts'), 'utf8');
const alleNamen = MODULE.flatMap((m) => m.funktionen.map((x) => x.name));

console.log('\n[1] The modules under server/src/spiel/ and the forwardings in WovServer.ts');
if (!MESSEN_BASIS) {
  // the files under spiel/ and its sub-folders (step 1 puts the commands into spiel/befehle/)
  const dateien = (readdirSync(join(WURZEL, 'server/src/spiel'), { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => `server/src/spiel/${f.split('\\').join('/')}`).sort();
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
  check('step 1 (C): LOCKERUNGEN_C agrees with MODIFIKATOREN (every member of C is in both, with the same modifiers)', Object.entries(LOCKERUNGEN_C).every(([n, v]) => Object.hasOwn(MODIFIKATOREN, n) && MODIFIKATOREN[n] === v), JSON.stringify(Object.keys(LOCKERUNGEN_C).map((n) => [n, LOCKERUNGEN_C[n], MODIFIKATOREN[n]])));
  for (const n of alleNamen) {
    const d = Object.getOwnPropertyDescriptor(WovServer.prototype, n);
    const laenge = MODULE.flatMap((m) => m.funktionen).find((x) => x.name === n)!.laenge;
    check(`${n}: a prototype method of WovServer (length ${(d?.value as { length?: number } | undefined)?.length})`, typeof d?.value === 'function' && (d.value as { length: number }).length === laenge && (d.value as { name: string }).name === n);
  }
  // every module under spiel/ that uses the context type stands under this guard (only Kontext.ts itself defines it)
  const alleDateien = new Set(MODULE.map((m) => m.datei));
  const unbekannt = dateien.filter((d) => d !== 'server/src/spiel/Kontext.ts' && /\bSpielKontext\b/.test(readFileSync(join(WURZEL, d), 'utf8')) && !alleDateien.has(d));
  check('every module under spiel/ and its sub-folders that uses SpielKontext is in MODULE (under this guard)', unbekannt.length === 0, unbekannt.join(', '));
  const fm = pruefeModifikatoren(klassenText, MODIFIKATOREN);
  check(`WovServer.ts: the ${Object.keys(MODIFIKATOREN).length} relaxed members keep their frozen modifiers (only private dropped)`, fm.length === 0, show(fm));
  check('the sub-folder spiel/befehle/ is read (the list of files is recursive)', dateien.some((d) => d.startsWith('server/src/spiel/befehle/')), dateien.filter((d) => d.includes('/befehle/')).join(', '));
}

// ── [1c] Step 1A, attack I11A-B2/B3: where the callers call, and the heads of the relaxed members ──

/**
 * The call of each function of step 1A in its caller is ONE expression statement `this.<name>();`, standing directly in a
 * frozen block (the constructor body, or the block of `if (this.timeSyncAccumulator >= 1000)` in `update()`), between two
 * frozen neighbours, and it is the only mention of `this.<name>` in the whole class outside the forwarding. A condition, an
 * inner function or a second place (attack I11A-B2: U1 to U4, C1) turns this red.
 */
interface AufrufStelle1A {
  readonly name: string;
  readonly methode: 'constructor' | 'update';
  /** The condition of the `if` whose block holds the call; null: directly in the body of the method. */
  readonly bedingung: string | null;
  /** The first line of the statement before and after the call (trimmed). */
  readonly davor: string;
  readonly danach: string;
  /** The other methods of the class that may call it as `k.`-member through the module are not in the class; inside the class only the caller. */
}
const AUFRUF_STELLEN_1A: readonly AufrufStelle1A[] = [
  { name: 'registerAdminListeCommands', methode: 'constructor', bedingung: null, davor: 'this.registerAbbauCommand();', danach: 'this.registerBannCommands();' },
  { name: 'registerBannCommands', methode: 'constructor', bedingung: null, davor: 'this.registerAdminListeCommands();', danach: 'this.registerMarkeCommand();' },
  { name: 'gleicheAdminrechteAb', methode: 'update', bedingung: 'this.timeSyncAccumulator >= 1000', davor: 'for (const peer of this.net.getPeers()) {', danach: 'this.layoutWache?.tick();' },
];
/** The head of each relaxed member of step 1A as it stands in the class, frozen with its modifiers (attack I11A-B3: `readonly` of `kontenDb`). */
const LOCKERUNG_KOEPFE_1A: Readonly<Record<string, string>> = {
  kontenDb: 'readonly kontenDb: Kontendatenbank;',
  spielerIdFuerName: 'spielerIdFuerName(name: string): SpielerId | undefined | typeof NAME_NICHT_EINDEUTIG',
  gleicheAdminrechteAb: 'gleicheAdminrechteAb(): void',
};

function pruefeAufrufStellen1A(text: string, stellen: readonly AufrufStelle1A[], koepfe: Readonly<Record<string, string>>): string[] {
  const f: string[] = [];
  const sf = parse('WovServer.ts', text);
  const klasse = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer');
  if (!klasse) return ['class WovServer not found'];
  const ersteZeile = (n: ts.Node): string => n.getText(sf).split('\n')[0]!.trim();
  for (const st of stellen) {
    const methode = st.methode === 'constructor' ? klasse.members.find(ts.isConstructorDeclaration) : klasse.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText(sf) === st.methode);
    if (!methode?.body) { f.push(`${st.name}: caller ${st.methode} not found`); continue; }
    // every mention of this.<name> in the class, outside the forwarding of that name
    const erwaehnt: ts.PropertyAccessExpression[] = [];
    for (const m of klasse.members) {
      if (ts.isMethodDeclaration(m) && m.name.getText(sf) === st.name) continue;
      const gehe = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword && n.name.text === st.name) erwaehnt.push(n);
        if (ts.isElementAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) f.push(`${st.name}: a computed access this[…] in the class (${n.getText(sf).slice(0, 40)}) could reach it`);
        ts.forEachChild(n, gehe);
      };
      gehe(m);
    }
    if (erwaehnt.length !== 1) { f.push(`${st.name}: mentioned ${erwaehnt.length} times as this.${st.name} in the class, expected once (the call in ${st.methode})`); continue; }
    const zugriff = erwaehnt[0]!;
    const aufruf = zugriff.parent;
    const anweisung = aufruf?.parent;
    if (!aufruf || !ts.isCallExpression(aufruf) || aufruf.expression !== zugriff || aufruf.arguments.length !== 0 || aufruf.questionDotToken || !anweisung || !ts.isExpressionStatement(anweisung)) {
      f.push(`${st.name}: the mention is not the statement \`this.${st.name}();\` (${(anweisung ?? zugriff).getText(sf).slice(0, 60)})`);
      continue;
    }
    const block = anweisung.parent;
    if (!ts.isBlock(block)) { f.push(`${st.name}: the call does not stand in a block`); continue; }
    if (st.bedingung === null) {
      if (block !== methode.body) f.push(`${st.name}: the call does not stand directly in the body of ${st.methode} (in ${ts.SyntaxKind[block.parent.kind]})`);
    } else {
      const wenn = block.parent;
      if (!ts.isIfStatement(wenn) || wenn.thenStatement !== block || wenn.expression.getText(sf) !== st.bedingung || wenn.parent !== methode.body) {
        f.push(`${st.name}: the call does not stand directly in the block of \`if (${st.bedingung})\` in the body of ${st.methode}`);
      }
    }
    if (st.methode === 'update') {
      // nothing in update() may leave it early (a return or throw before the call skips it while the call still stands; attack N1-H1)
      const raus: string[] = [];
      const gehe = (n: ts.Node): void => {
        if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
        if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) raus.push(n.getText(sf).slice(0, 50));
        ts.forEachChild(n, gehe);
      };
      ts.forEachChild(methode.body, gehe);
      if (raus.length > 0) f.push(`${st.name}: update() has ${raus.length} early exit(s) outside inner functions (${raus[0]}), the re-check could be skipped`);
    }
    const i = block.statements.indexOf(anweisung);
    const vor = block.statements[i - 1], nach = block.statements[i + 1];
    if (!vor || ersteZeile(vor) !== st.davor) f.push(`${st.name}: before the call stands "${vor ? ersteZeile(vor).slice(0, 50) : 'nothing'}", frozen "${st.davor}"`);
    if (!nach || ersteZeile(nach) !== st.danach) f.push(`${st.name}: after the call stands "${nach ? ersteZeile(nach).slice(0, 50) : 'nothing'}", frozen "${st.danach}"`);
  }
  for (const [name, kopf] of Object.entries(koepfe)) {
    const m = klasse.members.filter((x) => x.name?.getText(sf) === name);
    if (m.length !== 1) { f.push(`${name}: ${m.length} members of this name`); continue; }
    const x = m[0]!;
    const ist = ts.isMethodDeclaration(x) && x.body ? text.slice(x.getStart(sf), x.body.getStart(sf)).trim() : x.getText(sf).trim();
    if (ist !== kopf) f.push(`${name}: the head is "${ist.slice(0, 90)}", frozen "${kopf}"`);
  }
  return f;
}

console.log('\n[1c] Step 1A: the place of each call (constructor, update) and the heads of the relaxed members (attack I11A-B2, B3)');
{
  // self-test on an invented class: the good form is green, each fault red
  const gut = [
    'export class WovServer {',
    '  readonly kontenDb: Kontendatenbank;',
    '  constructor() {',
    '    this.registerAbbauCommand();',
    '    this.registerAdminListeCommands();',
    '    this.registerBannCommands();',
    '    this.registerMarkeCommand();',
    '  }',
    '',
    '  private update(): void {',
    '    if (this.timeSyncAccumulator >= 1000) {',
    '      for (const peer of this.net.getPeers()) {',
    '        void peer;',
    '      }',
    '      this.gleicheAdminrechteAb();',
    '      this.layoutWache?.tick();',
    '    }',
    '  }',
    '',
    '  spielerIdFuerName(name: string): SpielerId | undefined | typeof NAME_NICHT_EINDEUTIG {',
    '    return undefined;',
    '  }',
    '',
    '  private registerAdminListeCommands(): void {',
    '    return registerAdminListeCommands(this);',
    '  }',
    '',
    '  gleicheAdminrechteAb(): void {',
    '    return gleicheAdminrechteAb(this);',
    '  }',
    '',
    '  private registerBannCommands(): void {',
    '    return registerBannCommands(this);',
    '  }',
    '}',
    '',
  ].join('\n');
  const pr = (t: string): string[] => pruefeAufrufStellen1A(t, AUFRUF_STELLEN_1A, LOCKERUNG_KOEPFE_1A);
  check('green: callers and heads in the frozen form (invented class)', pr(gut).length === 0, show(pr(gut)));
  const innen = gut.replace('        void peer;', '        [1].forEach((x) => { if (x) return; });\n        void peer;');
  check('green: a return inside an inner function of update() is no early exit', pr(innen).length === 0, show(pr(innen)));
  const ersetze = (a: string, b: string): string => { if (!gut.includes(a)) throw new Error('fault anchor missing: ' + a); return gut.replace(a, b); };
  const fehler1c: [string, string][] = [
    ['U1 the re-check only with many peers', ersetze('      this.gleicheAdminrechteAb();', '      if (this.net.getPeers().length > 100) this.gleicheAdminrechteAb();')],
    ['U2 the re-check only in an inner arrow function', ersetze('      this.gleicheAdminrechteAb();', '      const nie = (): void => this.gleicheAdminrechteAb(); void nie;')],
    ['U3 the re-check every 60th second', ersetze('      this.gleicheAdminrechteAb();', '      if (Math.floor(Date.now() / 1000) % 60 === 0) this.gleicheAdminrechteAb();')],
    ['U4 the re-check behind if (false)', ersetze('      this.gleicheAdminrechteAb();', '      if (false as boolean) this.gleicheAdminrechteAb();')],
    ['the re-check outside the one-second block', ersetze('      this.gleicheAdminrechteAb();\n      this.layoutWache?.tick();\n    }', '      this.layoutWache?.tick();\n    }\n    this.gleicheAdminrechteAb();')],
    ['the re-check called a second time elsewhere', ersetze('    this.registerMarkeCommand();', '    this.registerMarkeCommand();\n    this.gleicheAdminrechteAb();')],
    ['C1 the ban commands only without everyone-admin', ersetze('    this.registerBannCommands();', '    if (!this.config.everyoneAdmin) this.registerBannCommands();')],
    ['the registration in a nested block', ersetze('    this.registerBannCommands();', '    {\n      this.registerBannCommands();\n    }')],
    ['the registration with an argument', ersetze('    this.registerAdminListeCommands();', '    this.registerAdminListeCommands(1 as never);')],
    ['the registrations swapped', ersetze('    this.registerAdminListeCommands();\n    this.registerBannCommands();', '    this.registerBannCommands();\n    this.registerAdminListeCommands();')],
    ['the registration via optional call', ersetze('    this.registerBannCommands();', '    this.registerBannCommands?.();')],
    ['a computed access to the class', ersetze('    this.registerMarkeCommand();', "    this.registerMarkeCommand();\n    this['registerBann' + 'Commands']();")],
    ['T2 an early return in update() before the one-second block', ersetze('    if (this.timeSyncAccumulator >= 1000) {', '    if (this.net.getPeers().length > 100) return;\n    if (this.timeSyncAccumulator >= 1000) {')],
    ['T5 a return inside the loop before the re-check', ersetze('        void peer;', "        if (peer.name === 'Stoerer') return;\n        void peer;")],
    ['a throw in update()', ersetze('        void peer;', "        if (!peer) throw new Error('x');\n        void peer;")],
    ['W1 kontenDb loses readonly', ersetze('  readonly kontenDb: Kontendatenbank;', '  kontenDb: Kontendatenbank;')],
    ['kontenDb gets another type', ersetze('  readonly kontenDb: Kontendatenbank;', '  readonly kontenDb: Kontendatenbank | null;')],
    ['spielerIdFuerName becomes static', ersetze('  spielerIdFuerName(name: string)', '  static spielerIdFuerName(name: string)')],
    ['gleicheAdminrechteAb becomes async in the head', ersetze('  gleicheAdminrechteAb(): void {', '  async gleicheAdminrechteAb(): void {')],
  ];
  for (const [name, t] of fehler1c) check(`red: ${name}`, pr(t).length > 0, show(pr(t)) || 'no finding');
  if (!MESSEN_BASIS) {
    const f = pr(klassenText);
    check(`WovServer.ts: the ${AUFRUF_STELLEN_1A.length} calls of step 1A stand as frozen, the ${Object.keys(LOCKERUNG_KOEPFE_1A).length} relaxed heads as frozen`, f.length === 0, show(f));
  }
}

// ── [1d] Step 1C (lifting onto A and B): the place of its three calls in the constructor, with the check of [1c] ──

/** The three calls of step 1C in the constructor (C0 split one call into these three; `teleport` overrides the base command, so the order is behaviour). */
const AUFRUF_STELLEN_C: readonly AufrufStelle1A[] = [
  { name: 'registerTeleportCommand', methode: 'constructor', bedingung: null, davor: 'this.adminListe = new AdminListe(', danach: 'this.registerSpielerCommand();' },
  { name: 'registerSpielerCommand', methode: 'constructor', bedingung: null, davor: 'this.registerTeleportCommand();', danach: 'this.registerDungeonCommand();' },
  { name: 'registerDungeonCommand', methode: 'constructor', bedingung: null, davor: 'this.registerSpielerCommand();', danach: 'this.registerSpawnCommand();' },
];

console.log('\n[1d] Step 1C: the place of the three calls in the constructor (the check of [1c])');
{
  // the table names exactly the three calls of C (a missing entry would leave its call unwatched; attack H-2)
  check('[1d] AUFRUF_STELLEN_C names exactly registerTeleportCommand, registerSpielerCommand, registerDungeonCommand, in this order', same(AUFRUF_STELLEN_C.map((x) => x.name), ['registerTeleportCommand', 'registerSpielerCommand', 'registerDungeonCommand']), AUFRUF_STELLEN_C.map((x) => x.name).join(', '));
  // self-test on an invented constructor, as [1c] does (no anchor in the real text, nothing can throw; attack H-1)
  const gut = [
    'export class WovServer {',
    '  constructor() {',
    '    this.adminListe = new AdminListe(',
    "      'x'",
    '    );',
    '    this.registerTeleportCommand();',
    '    this.registerSpielerCommand();',
    '    this.registerDungeonCommand();',
    '    this.registerSpawnCommand();',
    '    this.registerAbbauCommand();',
    '  }',
    '',
    '  private registerTeleportCommand(): void {',
    '    return registerTeleportCommand(this);',
    '  }',
    '',
    '  private registerSpielerCommand(): void {',
    '    return registerSpielerCommand(this);',
    '  }',
    '',
    '  private registerDungeonCommand(): void {}',
    '}',
    '',
  ].join('\n');
  const pr = (t: string): string[] => pruefeAufrufStellen1A(t, AUFRUF_STELLEN_C, {});
  check('[1d] green: the three calls in the frozen form (invented constructor)', pr(gut).length === 0, show(pr(gut)));
  // each fault names the entry whose finding it must produce: the finding has to start with that name
  const fehler1d: [string, string, string, string][] = [
    ['teleport and spieler swapped', 'registerTeleportCommand', '    this.registerTeleportCommand();\n    this.registerSpielerCommand();', '    this.registerSpielerCommand();\n    this.registerTeleportCommand();'],
    ['teleport registered after spawn', 'registerTeleportCommand', '    this.registerTeleportCommand();\n    this.registerSpielerCommand();\n    this.registerDungeonCommand();\n    this.registerSpawnCommand();', '    this.registerSpielerCommand();\n    this.registerDungeonCommand();\n    this.registerSpawnCommand();\n    this.registerTeleportCommand();'],
    ['teleport in a nested block', 'registerTeleportCommand', '    this.registerTeleportCommand();', '    {\n      this.registerTeleportCommand();\n    }'],
    ['teleport not called', 'registerTeleportCommand', '    this.registerTeleportCommand();\n', ''],
    ['teleport called through void', 'registerTeleportCommand', '    this.registerTeleportCommand();', '    void this.registerTeleportCommand();'],
    ['spieler called twice', 'registerSpielerCommand', '    this.registerDungeonCommand();', '    this.registerDungeonCommand();\n    this.registerSpielerCommand();'],
    ['spieler with an argument', 'registerSpielerCommand', '    this.registerSpielerCommand();', '    this.registerSpielerCommand(1 as never);'],
    ['dungeon only with world features', 'registerDungeonCommand', '    this.registerDungeonCommand();', '    if (this.config.worldFeatures) this.registerDungeonCommand();'],
    ['dungeon after spawn', 'registerDungeonCommand', '    this.registerDungeonCommand();\n    this.registerSpawnCommand();', '    this.registerSpawnCommand();\n    this.registerDungeonCommand();'],
  ];
  for (const [name, eintrag, a, b] of fehler1d) {
    // a missing anchor in the invented text is a finding of this check, not an exception: the test runs on
    if (!gut.includes(a)) { check(`[1d] red: ${name} (anchor of the fault present)`, false, a.slice(0, 50)); continue; }
    const f = pr(gut.replace(a, b));
    check(`[1d] red: ${name}, found at its entry ${eintrag}`, f.some((x) => x.startsWith(`${eintrag}:`)), show(f) || 'no finding');
  }
  // the real constructor (in the measuring mode the old stand has other calls; there this check is skipped)
  if (!MESSEN_BASIS) {
    check(`WovServer.ts: the ${AUFRUF_STELLEN_C.length} calls of step 1C stand directly in the constructor between their frozen neighbours, once each`, pr(klassenText).length === 0, show(pr(klassenText)));
  }
}

// ── [1e] Step 1, package D: the context name in the table, the local k of steinkit ──

/**
 * N1, H-1: does `registerDungeonCommand` bind its own `k` in the branch `case 'steinkit':`, as `const [k, v] = arg.split('=', 2)`, read from
 * the syntax tree? A line in a comment, a `k` bound elsewhere in the module, a renamed binding or another call do not count.
 */
function steinkitBindetK(text: string): boolean {
  const sf = parse('Dungeon.ts', text);
  const fn = sf.statements.find((x): x is ts.FunctionDeclaration => ts.isFunctionDeclaration(x) && x.name?.text === 'registerDungeonCommand');
  let treffer = 0;
  const gehe = (n: ts.Node, imSteinkit: boolean): void => {
    const hier = imSteinkit || (ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text === 'steinkit');
    if (hier && ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.initializer && ts.isCallExpression(n.initializer)) {
      const [e0, e1] = n.name.elements;
      const c = n.initializer;
      const ok = n.name.elements.length === 2 && !!e0 && ts.isBindingElement(e0) && ts.isIdentifier(e0.name) && e0.name.text === 'k' && !!e1 && ts.isBindingElement(e1) && ts.isIdentifier(e1.name) && e1.name.text === 'v'
        && ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === 'split' && ts.isIdentifier(c.expression.expression) && c.expression.expression.text === 'arg'
        && c.arguments.length === 2 && c.arguments[0]!.getText(sf) === "'='" && c.arguments[1]!.getText(sf) === '2';
      if (ok) treffer++;
    }
    ts.forEachChild(n, (x) => gehe(x, hier));
  };
  if (fn?.body) gehe(fn.body, false);
  return treffer === 1;
}

console.log('\n[1e] Step 1D: the name of the context of Dungeon.ts and the default k of every other module');
{
  // self-test of steinkitBindetK on invented sources (N1, H-1)
  const sk = (koerper: string): string => `function registerDungeonCommand(kd: K): void {\n  kd.a.register('dungeon', (peer, args) => {\n    switch (args[0]) {\n      case 'steinkit': {\n        for (const arg of args) {\n${koerper}\n        }\n        break;\n      }\n    }\n  });\n}\n`;
  check('[1e] green: steinkitBindetK finds the binding of k in the case steinkit', steinkitBindetK(sk("          const [k, v] = arg.split('=', 2);")));
  for (const [name, text] of [
    ['the line only in a comment, the local is called key', sk("          // const [k, v] = arg.split('=', 2);\n          const [key, v] = arg.split('=', 2);")],
    ['the line only in a comment, another k bound elsewhere in the function (attack KD4c)', sk("          // const [k, v] = arg.split('=', 2);\n          const [key, v] = arg.split('=', 2);\n          [1].map((k) => k);")],
    ['k bound outside the case steinkit', `${sk("          const [key, v] = arg.split('=', 2);")}function andere(): void {\n  const [k, v] = 'a=b'.split('=', 2);\n}\n`.replace("case 'steinkit'", "case 'steinkit'")],
    ['k bound in another case of the same switch, not in steinkit', sk("          const [key, v] = arg.split('=', 2);").replace("      case 'steinkit': {", "      case 'licht': {\n        for (const arg of args) {\n          const [k, v] = arg.split('=', 2);\n        }\n        break;\n      }\n      case 'steinkit': {")],
    ['k bound by another call', sk("          const [k, v] = arg.split(':', 2);")],
    ['k bound without the limit 2', sk("          const [k, v] = arg.split('=');")],
    ['k and v swapped', sk("          const [v, k] = arg.split('=', 2);")],
    ['the binding twice', sk("          const [k, v] = arg.split('=', 2);\n          { const [k, v] = arg.split('=', 2); }")],
  ] as const) check(`[1e] red: steinkitBindetK, ${name}`, !steinkitBindetK(text));
  // the table holds the decision: exactly one module has another context name, Dungeon.ts with `kd`; every other module keeps `k`
  const andere = MODULE.filter((m) => (m.kontextName ?? 'k') !== 'k').map((m) => `${m.datei}=${m.kontextName}`);
  check('[1e] exactly one module has a context name other than k: server/src/spiel/befehle/Dungeon.ts with kd', same(andere, ['server/src/spiel/befehle/Dungeon.ts=kd']), andere.join(', '));
  check('[1e] no module names k explicitly (the default is written by leaving the field out)', MODULE.every((m) => m.kontextName !== 'k'), MODULE.filter((m) => m.kontextName === 'k').map((m) => m.datei).join(', '));
  const nurKontext = MODULE.flatMap((m) => m.funktionen.filter((x) => x.aufrufer.nurUeberKontext).map((x) => `${m.datei}:${x.name}`));
  check('[1e] exactly one function is called only through the context: resolveDungeonBase of Dungeon.ts', same(nurKontext, ['server/src/spiel/befehle/Dungeon.ts:resolveDungeonBase']), nurKontext.join(', '));
  if (!MESSEN_BASIS) {
    const t = readFileSync(join(WURZEL, 'server/src/spiel/befehle/Dungeon.ts'), 'utf8');
    // the reason for `kd`, read from the syntax tree (N1, H-1: a comment or another `k` elsewhere is no reason): the steinkit branch binds `k`
    check('[1e] Dungeon.ts: the steinkit branch still binds its own k, `const [k, v] = arg.split(\'=\', 2)` in the syntax tree (the reason for kd)', steinkitBindetK(t), 'no such binding in the case steinkit of registerDungeonCommand');
    check('[1e] Dungeon.ts: kd is the first parameter of both functions', (t.match(/^function \w+\(kd: DungeonKontext[,)]/gm) ?? []).length === 2);
  }
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

// ── [2c] Behaviour of step 1A: the commands admin, kick, bann, entbann and the re-check of the admin rights ──

/**
 * The clock and the time zone are fixed for the length of one measurement: `fristLesen` reads `Date.now()`, `fristText`
 * formats with `toLocaleString('de-DE')` (the time zone of the machine would change the text), the ban list of the real
 * database reads `Date.now()` for "still in effect".
 */
const BEFEHL_JETZT = Date.UTC(2026, 9, 2, 10, 30, 0);
const ECHTE_UHR = Date.now;
const ECHTE_TZ = process.env['TZ'];
function mitUhr<T>(fn: () => T): T {
  const orig = Date.now;
  const tz = process.env['TZ'];
  Date.now = (): number => BEFEHL_JETZT;
  process.env['TZ'] = 'Europe/Berlin';
  try { return fn(); } finally {
    Date.now = orig;
    if (tz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tz;
  }
}
/** A peer of the command handlers: what it is sent (the admin events with their whole text) and its rights after each command. */
function befehlPeer(a: Aufzeichnung, name: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, spielerId: `S-${name}`, isAdmin: false, flying: false, nurEditor: false,
    sendPacketWith(type: PacketType, fn: (w: Writer) => void): void {
      const w = new Writer();
      fn(w);
      const r = new Reader(w.toBuffer());
      const d = type === PacketType.AdminEvent ? [r.readString(), r.readBool(), r.readString(), r.remaining()] : [];
      a.paket.push(`${name}:${PacketType[type]}:${JSON.stringify(d)}:${kennung(w.toBuffer())}`);
    },
    ...o,
  };
}
const rechte = (peers: readonly Record<string, unknown>[]): string => peers.map((p) => `${String(p['name'])}=${p['isAdmin'] ? 'A' : '-'}${p['flying'] ? 'F' : '-'}`).join(' ');
const ergebnisText = (r: unknown): string => JSON.stringify(r, (_k, v: unknown) => (v === undefined ? '<undefined>' : v));

/** A stand-in for the server: every member of the two contexts records its calls with their arguments, in order. */
function befehlsKontext(a: Aufzeichnung) {
  const handler = new Map<string, (peer: unknown, args: string[]) => unknown>();
  const liste = new Map<string, string>();
  const peers: Record<string, unknown>[] = [];
  const banns: { art: string; wert: string; grund: string; gesetztVon: string; bis: number | null }[] = [];
  const namen = new Map<string, unknown>();
  const charaktere = new Map<string, { id: number; kontoId: number; spielerId: string; name: string }>();
  const konten = new Map<number, string>();
  const herkunft = new Map<string, string>();
  const zustand = { getrennt: [] as string[], kickTrifft: true };
  const notiz = (t: string): void => { a.notizen.push(t); };
  const ruf = (name: string, ...x: unknown[]): void => { zaehle(a, name); notiz(`call ${name}${x.map((y) => ` ${typeof y === 'string' ? JSON.stringify(y) : ergebnisText(y)}`).join('')}`); };
  const gleich = (x: string, y: string): boolean => x.trim().toLowerCase() === y.trim().toLowerCase();
  const k: Record<string, unknown> = {
    config: { everyoneAdmin: false },
    adminCommands: { register: (n: string, h: (peer: unknown, args: string[]) => unknown): void => { ruf('adminCommands.register', n, typeof h); handler.set(n, h); } },
    adminListe: {
      alle: (): unknown[] => { ruf('adminListe.alle'); return [...liste].map(([spielerId, name]) => ({ spielerId, name })); },
      enthaelt: (id: string): boolean => { ruf('adminListe.enthaelt', id); return liste.has(id); },
      hinzufuegen: (id: string, name: string): boolean => { ruf('adminListe.hinzufuegen', id, name); if (liste.has(id)) return false; liste.set(id, name); return true; },
      entfernen: (id: string): boolean => { ruf('adminListe.entfernen', id); return liste.delete(id); },
      get anzahl(): number { ruf('adminListe.anzahl'); return liste.size; },
    },
    spielerIdFuerName: (n: string): unknown => { ruf('spielerIdFuerName', n); return namen.get(n.trim().toLowerCase()); },
    // a moved method that is a context member: before the move through the prototype, after it through the function (R12)
    gleicheAdminrechteAb(this: unknown, ...x: unknown[]): unknown { ruf('gleicheAdminrechteAb', ...x); return F['gleicheAdminrechteAb']!(this, ...x); },
    net: {
      getPeers: (): unknown[] => { ruf('net.getPeers'); return peers; },
      findPeerByName: (n: string): unknown => { ruf('net.findPeerByName', n); return peers.find((p) => !p['nurEditor'] && gleich(String(p['name']), n)); },
      kick: (n: string): unknown => { ruf('net.kick', n); return zustand.kickTrifft ? (peers.find((p) => gleich(String(p['name']), n)) ?? { name: n }) : undefined; },
      herkunftVon: (p: { name: string }): string => { ruf('net.herkunftVon', p.name); return herkunft.get(p.name) ?? ''; },
      trenneGebannte: (): unknown[] => { ruf('net.trenneGebannte'); return zustand.getrennt.map((name) => ({ name })); },
    },
    kontenDb: {
      charakterNachName: (n: string): unknown => { ruf('kontenDb.charakterNachName', n); return charaktere.get(n.trim().toLowerCase()) ?? null; },
      charaktereVonKonto: (id: number): unknown[] => { ruf('kontenDb.charaktereVonKonto', id); return [...charaktere.values()].filter((c) => c.kontoId === id); },
      bannListe: (): unknown[] => { ruf('kontenDb.bannListe'); return banns.map((b) => ({ ...b })); },
      kontoNachId: (id: number): unknown => { ruf('kontenDb.kontoNachId', id); return konten.has(id) ? { id, benutzername: konten.get(id) } : null; },
      bannSetzen: (art: string, wert: string, angaben: { grund: string; gesetztVon: string; bis: number | null }): unknown => {
        ruf('kontenDb.bannSetzen', art, wert, angaben);
        const i = banns.findIndex((b) => b.art === art && b.wert === wert);
        const b = { art, wert, grund: angaben.grund, gesetztVon: angaben.gesetztVon, bis: angaben.bis };
        if (i >= 0) banns[i] = b;
        else banns.push(b);
        return b;
      },
      bannAufheben: (art: string, wert: string): boolean => {
        ruf('kontenDb.bannAufheben', art, wert);
        const i = banns.findIndex((b) => b.art === art && b.wert === wert);
        if (i < 0) return false;
        banns.splice(i, 1);
        return true;
      },
    },
  };
  return { k, handler, liste, peers, banns, namen, charaktere, konten, herkunft, zustand };
}

/** All sub-commands of `admin`, `kick`, `bann` and `entbann` with valid and invalid arguments, and the re-check of the rights, on a stand-in. */
function messeBefehleAttrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  try {
    mitUhr(() => {
      const c = befehlsKontext(a);
      versuche(a, () => F['registerAdminListeCommands']!(c.k));
      versuche(a, () => F['registerBannCommands']!(c.k));
      a.notizen.push(`registered ${[...c.handler.keys()].join(' ')}`);
      const boss = befehlPeer(a, 'Boss', { isAdmin: true });
      c.peers.push(
        boss,
        befehlPeer(a, 'Anna'),
        befehlPeer(a, 'Carl', { isAdmin: true, flying: true }),
        befehlPeer(a, 'Dora', { isAdmin: true }),
        befehlPeer(a, 'Ohne', { isAdmin: true, spielerId: '' }),
        befehlPeer(a, 'Editor', { nurEditor: true, spielerId: 'S-Ed' }),
      );
      for (const [n, id] of [['boss', 'S-Boss'], ['anna', 'S-Anna'], ['bert', 'S-Bert'], ['chef', 'S-Boss'], ['doppel', NAME_NICHT_EINDEUTIG], ['gast', undefined]] as const) c.namen.set(n, id);
      c.charaktere.set('boss', { id: 1, kontoId: 1, spielerId: 'S-Boss', name: 'Boss' });
      c.charaktere.set('zweit', { id: 2, kontoId: 1, spielerId: 'S-Zweit', name: 'Zweit' });
      c.charaktere.set('gast', { id: 3, kontoId: 2, spielerId: 'S-Gast', name: 'Gast' });
      c.charaktere.set('fremd', { id: 4, kontoId: 9, spielerId: 'S-Fremd', name: 'Fremd' });
      c.konten.set(1, 'bosskonto');
      c.konten.set(2, 'gastkonto');
      c.herkunft.set('Anna', '203.0.113.7');
      const lauf = (befehl: string, args: string[], wer: unknown = boss): void => {
        const h = c.handler.get(befehl);
        const kopie = [...args];
        versuche(a, () => {
          const r = h!(wer, kopie);
          a.notizen.push(`${befehl} ${JSON.stringify(args)} -> ${ergebnisText(r)} args-after=${JSON.stringify(kopie)}`);
        });
        a.notizen.push(`rights ${rechte(c.peers)} list=${[...c.liste.keys()].join(',')} bans=${c.banns.length}`);
      };
      // admin: every sub-command, the aliases, the refusals, the last admin
      lauf('admin', []);
      lauf('admin', ['liste']);
      c.liste.set('S-Boss', 'Boss');
      lauf('admin', ['LISTE']);
      lauf('admin', ['add']);
      lauf('admin', ['add', ' ', ' ']);
      lauf('admin', ['add', 'Doppel']);
      lauf('admin', ['add', 'Gibts', 'Nicht']);
      lauf('admin', ['add', 'Anna']);
      lauf('admin', ['hinzufuegen', 'anna']);
      lauf('admin', ['list']);
      lauf('admin', ['remove']);
      lauf('admin', ['entfernen', 'Doppel']);
      lauf('admin', ['remove', 'Gibts']);
      lauf('admin', ['remove', 'Bert']);
      lauf('admin', ['Remove', 'Anna']);
      lauf('admin', ['remove', 'Boss']);
      lauf('admin', ['xyz', 'Anna']);
      // the re-check directly: nothing to change, then everyone-admin (the list is not the gate, nothing is taken away)
      c.peers.push(befehlPeer(a, 'Neu', { isAdmin: true, flying: true }));
      (c.k['config'] as { everyoneAdmin: boolean }).everyoneAdmin = true;
      versuche(a, () => F['gleicheAdminrechteAb']!(c.k));
      a.notizen.push(`rights ${rechte(c.peers)}`);
      (c.k['config'] as { everyoneAdmin: boolean }).everyoneAdmin = false;
      versuche(a, () => F['gleicheAdminrechteAb']!(c.k));
      a.notizen.push(`rights ${rechte(c.peers)}`);
      versuche(a, () => F['gleicheAdminrechteAb']!(c.k));
      // kick
      lauf('kick', []);
      lauf('kick', ['  ']);
      lauf('kick', ['boss']);
      lauf('kick', ['Anna']);
      lauf('kick', ['Anna', 'Maria']);
      c.zustand.kickTrifft = false;
      lauf('kick', ['Niemand']);
      // bann: usage, the list when empty, self-protection, the origin, account and player bans, the deadlines, the admin check
      lauf('bann', []);
      lauf('bann', ['herkunft']);
      lauf('bann', ['liste']);
      lauf('bann', ['BOSS']);
      lauf('bann', ['herkunft', 'boss']);
      lauf('bann', ['herkunft', 'Niemand']);
      lauf('bann', ['herkunft', 'Editor']);
      lauf('bann', ['ip', 'Dora']);
      c.zustand.getrennt = ['Anna'];
      lauf('bann', ['herkunft', 'Anna', '2h', 'Spam', 'Bot']);
      c.zustand.getrennt = [];
      lauf('bann', ['Zweit', '30m']);
      lauf('bann', ['Chef']);
      lauf('bann', ['Gast', '30m']);
      lauf('bann', ['Gast', 'dauerhaft', 'wieder', 'da']);
      lauf('bann', ['Gast', 'PERMANENT']);
      lauf('bann', ['Gast', 'immer', 'x']);
      lauf('bann', ['Gast', '7d', 'Grund']);
      lauf('bann', ['Gast', '3t']);
      lauf('bann', ['Gast', '2H']);
      lauf('bann', ['Gast', '0m', 'null']);
      lauf('bann', ['Gast', '12x']);
      c.zustand.getrennt = ['Gast', 'Gast2'];
      lauf('bann', ['Fremd', '1m']);
      c.zustand.getrennt = [];
      lauf('bann', ['Doppel']);
      lauf('bann', ['Gibts']);
      lauf('bann', ['Bert', '2h', 'Grund', 'mit', 'Umlaut', 'ä']);
      lauf('bann', ['liste']);
      lauf('bann', ['LIST']);
      // entbann: usage, origin, account, player, nothing
      lauf('entbann', []);
      lauf('entbann', ['herkunft']);
      lauf('entbann', ['herkunft', '203.0.113.7']);
      lauf('entbann', ['ip', '203.0.113.7']);
      lauf('entbann', ['Gast']);
      lauf('entbann', ['Gast']);
      lauf('entbann', ['Doppel']);
      lauf('entbann', ['Bert']);
      lauf('entbann', ['Fremd']);
      lauf('entbann', ['Gibts']);
      lauf('bann', ['liste']);
      a.zustand.push(c.banns.length, c.liste.size);
    });
  } finally {
    ruecksetzen();
  }
  return a;
}

/** The same commands on a real instance (real account database, real admin list, real name lookup), through the registry and the forwardings. */
function messeBefehleEcht(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  const kennungen = new Map<string, string>();
  try {
    mitUhr(() => {
      const server = createWovServer({
        port: 0, worldFeatures: false, worldName: 'i1-form-k1a', everyoneAdmin: false,
        worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
      } as never) as unknown as Record<string, unknown>;
      const db = server['kontenDb'] as {
        kontoAnlegen(n: string, e: string, p: string): { ok: boolean; konto?: { id: number } };
        charakterAnlegen(kontoId: number, name: string, aussehen: Record<string, string>): { ok: boolean; charakter?: { spielerId: string } };
        schliessen?(): void;
      };
      const liste = server['adminListe'] as { hinzufuegen(id: string, name: string): boolean; alle(): { spielerId: string; name: string }[] };
      const aussehen = { figur: FIGUREN[0]!.id, frisur: FRISUR_VORGABE, haarfarbe: HAARFARBE_VORGABE, ober: '', beine: '' };
      const char = (kontoId: number, name: string): string => { const id = db.charakterAnlegen(kontoId, name, aussehen).charakter!.spielerId; kennungen.set(id, `<${name}>`); return id; };
      const kA = db.kontoAnlegen('adminkonto', 'a@example.invalid', 'x').konto!.id;
      const kG = db.kontoAnlegen('gastkonto', 'g@example.invalid', 'x').konto!.id;
      const kF = db.kontoAnlegen('fremdkonto', 'f@example.invalid', 'x').konto!.id;
      const idAdmin = char(kA, 'Admin');
      char(kA, 'Zweit');
      const idGast = char(kG, 'Gast');
      char(kF, 'Fremd');
      liste.hinzufuegen(idAdmin, 'Admin');
      const gespeichert = server['savedPlayers'] as Map<string, unknown>;
      for (const [schluessel, name] of [['w', 'Wanderer'], ['d1', 'Doppel'], ['d2', 'Doppel']] as const) {
        const id = spielerIdErzeugen();
        kennungen.set(id, `<${name}-${schluessel}>`);
        gespeichert.set(schluessel, { name, spielerId: id });
      }
      // the open sessions: real lookups of the network layer (by name, the origin of a connection) over these peers
      const net = server['net'] as Record<string, unknown>;
      const admin = befehlPeer(a, 'Admin', { spielerId: idAdmin, isAdmin: true, flying: true, verbindungsId: 'v1', authenticated: true });
      const gast = befehlPeer(a, 'Gast', { spielerId: idGast, verbindungsId: 'v2', authenticated: true });
      const editor = befehlPeer(a, 'Editor', { spielerId: 'editor', nurEditor: true, isAdmin: true, verbindungsId: 'v3', authenticated: true });
      const peers = [admin, gast, editor];
      (net['onlinePeers'] as unknown[]).push(...peers);
      (net['herkunftJeVerbindung'] as Map<string, string>).set('v2', '198.51.100.4');
      // what would close a real connection is recorded instead
      net['kick'] = (n: string): unknown => { zaehle(a, 'net.kick'); a.notizen.push(`call net.kick ${JSON.stringify(n)}`); return (net['findPeerByName'] as (x: string) => unknown).call(net, n); };
      net['trenneGebannte'] = (): unknown[] => { zaehle(a, 'net.trenneGebannte'); a.notizen.push('call net.trenneGebannte'); return []; };
      const registry = server['adminCommands'] as { execute(p: unknown, line: string): unknown; handlers: Map<string, unknown> };
      a.notizen.push(`registry ${[...registry.handlers.keys()].join(' ')}`);
      const rufe = (line: string, wer: unknown = admin): void => {
        versuche(a, () => { a.notizen.push(`${JSON.stringify(line)} -> ${ergebnisText(registry.execute(wer, line))}`); });
        a.notizen.push(`rights ${rechte(peers)} list=${liste.alle().map((e) => e.name).join(',')}`);
      };
      for (const line of [
        'admin', 'admin liste', 'admin add Wanderer', 'admin add Doppel', 'admin add Niemand', 'admin list', 'admin remove Wanderer',
        'admin remove Admin', 'admin add gast', 'admin remove Gast', 'admin remove Fremd', 'admin quatsch',
        'kick', 'kick admin', 'kick Gast', 'kick Niemand',
        'bann', 'bann liste', 'bann ADMIN', 'bann Zweit 2h', 'bann Gast 2h Spam Bot', 'bann herkunft Gast 30m', 'bann herkunft Editor', 'bann ip Niemand',
        'bann Wanderer 7d', 'bann Doppel', 'bann Niemand', 'bann Fremd dauerhaft', 'bann liste',
        'entbann', 'entbann Gast', 'entbann Gast', 'entbann herkunft 198.51.100.4', 'entbann herkunft 198.51.100.4', 'entbann Wanderer', 'entbann Doppel', 'entbann Fremd', 'entbann Niemand', 'bann liste',
      ]) rufe(line);
      rufe('bann Gast', gast);
      // the re-check of the rights directly (also run once a second by update()): the editor keeps its flag, the guest gets none
      gast['isAdmin'] = true;
      versuche(a, () => (server['gleicheAdminrechteAb'] as () => unknown).call(server));
      a.notizen.push(`rights ${rechte(peers)}`);
      a.zustand.push(liste.alle().length);
      db.schliessen?.();
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  // the player ids are drawn at random: they are written by the name they belong to
  const ersetze = (t: string): string => { let x = t; for (const [id, n] of kennungen) x = x.split(id).join(n); return x; };
  a.notizen = a.notizen.map(ersetze);
  a.paket = a.paket.map(ersetze);
  return a;
}

// ── [2d] Step 1A, attack I11A-B1/B2: more cases of the commands, the re-check from update(), the registry with everyone-admin ──

/**
 * Attack I11A-B1: the sub-commands of `entbann` in another spelling (`IP`, `Herkunft`), names of two words for `entbann` and
 * `admin remove`, deadlines without anchor (`30min`, `x30m`) or without unit (`30 Tage`, `30`), `bann herkunft` with another spelling of the target. Same
 * stand-in as [2c]; the clock and the time zone fixed.
 */
function messeBefehleN1Attrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  try {
    mitUhr(() => {
      const c = befehlsKontext(a);
      versuche(a, () => F['registerAdminListeCommands']!(c.k));
      versuche(a, () => F['registerBannCommands']!(c.k));
      const boss = befehlPeer(a, 'Boss', { isAdmin: true });
      c.peers.push(boss, befehlPeer(a, 'Anna'), befehlPeer(a, 'Anna Maria', { spielerId: 'S-AnnaMaria' }), befehlPeer(a, 'Dora', { isAdmin: true }));
      for (const [n, id] of [['boss', 'S-Boss'], ['anna', 'S-Anna'], ['anna maria', 'S-AnnaMaria'], ['maria', 'S-Maria']] as const) c.namen.set(n, id);
      c.charaktere.set('gast', { id: 3, kontoId: 2, spielerId: 'S-Gast', name: 'Gast' });
      c.konten.set(2, 'gastkonto');
      c.herkunft.set('Anna', '203.0.113.7');
      c.herkunft.set('Anna Maria', '203.0.113.8');
      c.liste.set('S-Boss', 'Boss');
      const lauf = (befehl: string, args: string[]): void => {
        const kopie = [...args];
        versuche(a, () => { a.notizen.push(`${befehl} ${JSON.stringify(args)} -> ${ergebnisText(c.handler.get(befehl)!(boss, kopie))} args-after=${JSON.stringify(kopie)}`); });
        a.notizen.push(`rights ${rechte(c.peers)} list=${[...c.liste.keys()].join(',')} bans=${c.banns.map((b) => `${b.art}:${b.wert}:${b.bis ?? '-'}:${b.grund}`).join('|')}`);
      };
      // deadlines without anchor: a word that only contains a deadline is part of the reason, the ban is permanent
      lauf('bann', ['Gast', '30min']);
      lauf('bann', ['Gast', 'x30m']);
      lauf('bann', ['Gast', '2hx', 'und', 'mehr']);
      lauf('bann', ['Gast', '30m', '30min']);
      lauf('bann', ['Gast', '30', 'Tage']);
      lauf('bann', ['Gast', '30']);
      // the origin with another spelling of the target (lower case, spaces around)
      lauf('bann', ['herkunft', 'anna', '1h']);
      lauf('bann', ['HERKUNFT', 'ANNA']);
      lauf('bann', ['herkunft', 'Anna', 'Maria']);
      // entbann with the sub-command in another spelling
      lauf('entbann', ['IP', '203.0.113.7']);
      lauf('entbann', ['Herkunft', '203.0.113.7']);
      lauf('entbann', ['HERKUNFT', '203.0.113.7']);
      // names of two words: admin add/remove and entbann take every word
      lauf('admin', ['add', 'Anna', 'Maria']);
      lauf('admin', ['list']);
      lauf('admin', ['remove', 'Anna', 'Maria']);
      c.banns.push({ art: 'spieler', wert: 'S-AnnaMaria', grund: 'zwei Woerter', gesetztVon: 'Boss', bis: null }, { art: 'spieler', wert: 'S-Anna', grund: 'ein Wort', gesetztVon: 'Boss', bis: null });
      lauf('entbann', ['Anna', 'Maria']);
      lauf('entbann', ['Anna', 'Maria']);
      lauf('entbann', ['  Anna ', ' ']);
      lauf('bann', ['liste']);
      a.zustand.push(c.banns.length, c.liste.size);
    });
  } finally {
    ruecksetzen();
  }
  return a;
}

/** The same cases on a real instance with a real account database through the registry; player ids written as `<name>`. */
function messeBefehleN1Echt(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  const kennungen = new Map<string, string>();
  try {
    mitUhr(() => {
      const server = createWovServer({
        port: 0, worldFeatures: false, worldName: 'i1-form-k1an', everyoneAdmin: false,
        worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
      } as never) as unknown as Record<string, unknown>;
      const db = server['kontenDb'] as {
        kontoAnlegen(n: string, e: string, p: string): { konto?: { id: number } };
        charakterAnlegen(kontoId: number, name: string, aussehen: Record<string, string>): { charakter?: { spielerId: string } };
        bannSetzen(art: string, wert: string, angaben: Record<string, unknown>): unknown;
        bannListe(): { art: string; wert: string; bis: number | null; grund: string }[];
        schliessen?(): void;
      };
      const liste = server['adminListe'] as { hinzufuegen(id: string, name: string): boolean; alle(): { name: string }[] };
      const aussehen = { figur: FIGUREN[0]!.id, frisur: FRISUR_VORGABE, haarfarbe: HAARFARBE_VORGABE, ober: '', beine: '' };
      const kA = db.kontoAnlegen('adminkonto', 'a@example.invalid', 'x').konto!.id;
      const kG = db.kontoAnlegen('gastkonto', 'g@example.invalid', 'x').konto!.id;
      const idAdmin = db.charakterAnlegen(kA, 'Admin', aussehen).charakter!.spielerId;
      kennungen.set(idAdmin, '<Admin>');
      const idGast = db.charakterAnlegen(kG, 'Gast', aussehen).charakter!.spielerId;
      kennungen.set(idGast, '<Gast>');
      liste.hinzufuegen(idAdmin, 'Admin');
      const gespeichert = server['savedPlayers'] as Map<string, unknown>;
      const idZwei = spielerIdErzeugen();
      kennungen.set(idZwei, '<Anna Maria>');
      gespeichert.set('am', { name: 'Anna Maria', spielerId: idZwei });
      const idAnna = spielerIdErzeugen();
      kennungen.set(idAnna, '<Anna>');
      gespeichert.set('an', { name: 'Anna', spielerId: idAnna });
      const net = server['net'] as Record<string, unknown>;
      const admin = befehlPeer(a, 'Admin', { spielerId: idAdmin, isAdmin: true, verbindungsId: 'v1', authenticated: true });
      const gast = befehlPeer(a, 'Gast', { spielerId: idGast, verbindungsId: 'v2', authenticated: true });
      const peers = [admin, gast];
      (net['onlinePeers'] as unknown[]).push(...peers);
      (net['herkunftJeVerbindung'] as Map<string, string>).set('v2', '198.51.100.4');
      net['trenneGebannte'] = (): unknown[] => { zaehle(a, 'net.trenneGebannte'); a.notizen.push('call net.trenneGebannte'); return []; };
      const registry = server['adminCommands'] as { execute(p: unknown, line: string): unknown };
      const rufe = (line: string): void => {
        versuche(a, () => { a.notizen.push(`${JSON.stringify(line)} -> ${ergebnisText(registry.execute(admin, line))}`); });
        a.notizen.push(`rights ${rechte(peers)} list=${liste.alle().map((e) => e.name).join(',')} bans=${db.bannListe().map((b) => `${b.art}:${b.wert}:${b.bis ?? '-'}:${b.grund}`).join('|')}`);
      };
      for (const line of ['bann Gast 30min', 'bann Gast x30m', 'bann Gast 2hx Rest', 'bann Gast 30 Tage', 'bann Gast 30', 'bann herkunft gast 1h', 'bann HERKUNFT GAST', 'entbann IP 198.51.100.4']) rufe(line);
      rufe('bann herkunft Gast');
      rufe('entbann Herkunft 198.51.100.4');
      for (const line of ['admin add Anna Maria', 'admin list', 'admin remove Anna Maria']) rufe(line);
      db.bannSetzen('spieler', idZwei, { grund: 'zwei Woerter', gesetztVon: 'Admin', bis: null });
      db.bannSetzen('spieler', idAnna, { grund: 'ein Wort', gesetztVon: 'Admin', bis: null });
      for (const line of ['entbann Anna Maria', 'entbann Anna Maria', 'entbann Gast', 'bann liste']) rufe(line);
      db.schliessen?.();
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  const ersetze = (t: string): string => { let x = t; for (const [id, n] of kennungen) x = x.split(id).join(n); return x; };
  a.notizen = a.notizen.map(ersetze);
  a.paket = a.paket.map(ersetze);
  return a;
}

/**
 * Attack I11A-B2: the re-check runs from the real `update()` once in every full second, whatever the number of peers and the
 * time; and on a server with `everyone-admin: true` the registry still holds every command (the registrations do not depend
 * on it). The re-check on the instance is a recording stand-in (the instance member hides the prototype method, as the tests
 * do); the clock is fixed before the server is built, so `update()` sees no time passing and the one-second block is entered by
 * the accumulator alone. Then the stand-in goes and the real re-check runs from `update()` against an open session, the list
 * changed from outside, the clock seven seconds past a full minute (attack N1-B3: a re-check bound to the clock shows).
 */
function messeTakt1A(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    mitUhr(() => {
      const orig = Date.now;
      Date.now = (): number => BEFEHL_JETZT + 7_000; // not a full minute: a re-check bound to the clock would show
      try {
        for (const jeder of [false, true]) {
          const server = createWovServer({
            port: 0, worldFeatures: false, worldName: `i1-form-k1at${jeder ? 'e' : ''}`, everyoneAdmin: jeder,
            worldsDir: join(tmp, `worlds${jeder ? 'e' : ''}`), kontenDir: join(tmp, `konten${jeder ? 'e' : ''}`), forumDir: join(tmp, `forum${jeder ? 'e' : ''}`), generiertDir: join(tmp, 'generiert'),
          } as never) as unknown as Record<string, unknown>;
          const registry = server['adminCommands'] as { handlers: Map<string, unknown> };
          a.notizen.push(`everyoneAdmin=${jeder} registry ${[...registry.handlers.keys()].join(' ')}`);
          server['gleicheAdminrechteAb'] = function (this: unknown, ...x: unknown[]): void { zaehle(a, 'gleicheAdminrechteAb'); a.notizen.push(`call gleicheAdminrechteAb this=${String(this === server)} args=${x.length}`); };
          for (const [akk, peers] of [[1000, 0], [999, 0], [1000, 0], [2500, 0], [0, 0]] as const) {
            server['timeSyncAccumulator'] = akk;
            void peers;
            versuche(a, () => (server['update'] as () => void).call(server));
            a.notizen.push(`everyoneAdmin=${jeder} takt akk=${akk} -> akk=${String(server['timeSyncAccumulator'])} calls=${a.aufrufe['gleicheAdminrechteAb'] ?? 0}`);
          }
          // the effect: no stand-in, one open session (in no world), the list changed from outside, one full second each
          delete server['gleicheAdminrechteAb'];
          const sitzung = befehlPeer(a, `Takt${jeder ? 'E' : ''}`, { spielerId: 'S-Takt', isAdmin: false, flying: false, worldId: 'nirgends', position: { x: 0, y: 0, z: 0 }, verbindungsId: 'vt', userId: 9, totBis: 0, foodBis: 0, health: 10, blickYaw: 0 });
          ((server['net'] as Record<string, unknown>)['onlinePeers'] as unknown[]).push(sitzung);
          const liste = server['adminListe'] as { hinzufuegen(id: string, n: string): boolean; entfernen(id: string): boolean };
          const wirkung = (titel: string): void => {
            server['timeSyncAccumulator'] = 1000;
            versuche(a, () => (server['update'] as () => void).call(server));
            a.notizen.push(`everyoneAdmin=${jeder} wirkung ${titel}: ${rechte([sitzung])}`);
          };
          wirkung('nichts geaendert');
          liste.hinzufuegen('S-Takt', 'Takt');
          wirkung('von aussen eingetragen');
          sitzung['flying'] = true;
          liste.entfernen('S-Takt');
          wirkung('von aussen entfernt, fliegend');
          wirkung('noch eine Sekunde');
          (server['kontenDb'] as { schliessen?(): void }).schliessen?.();
        }
      } finally {
        Date.now = orig;
      }
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  // console lines of a tick are not part of this measurement (time sync and world messages); only their number is kept
  a.notizen = a.notizen.filter((x) => !x.startsWith('log ') && !x.startsWith('warn '));
  return a;
}

// ── [2e] Behaviour of step 1, package B: the commands marke, wetter, abbau, item, spawn ──

type BefehlsPeer = Record<string, unknown> & { name: string; inventar: Inventory };
/** A peer of the commands: admin by default, a figure, a position, an inventory. */
function befehlsPeer(name: string, o: Record<string, unknown> = {}): BefehlsPeer {
  return { name, isAdmin: true, nurEditor: false, figur: 'wikinger', position: { x: 10, y: 3, z: -4 }, inventar: new Inventory(), worldId: HAUPTWELT_ID, ...o } as BefehlsPeer;
}
type BPrefab = { name: string; hash: number; isPersistent(): boolean };
const bPrefab = (a: Aufzeichnung, name: string, hash: number, persistent: boolean): BPrefab => ({ name, hash, isPersistent: (): boolean => { a.notizen.push(`  isPersistent ${name}`); return persistent; } });
/** The inventory of a peer or a saved player as text: item, stack, the equipped flag. */
const invText = (inv: unknown): string => {
  const liste = (inv instanceof Inventory ? inv.serialize() : inv) as { name: string; stack: number; equipped?: boolean }[] | undefined;
  return liste === undefined ? '-' : liste.map((i) => `${i.name}x${i.stack}${i.equipped ? '*' : ''}`).join(',');
};
/** One line of a command: who runs it, the result as text (ok, active, the whole message). */
function befehl(a: Aufzeichnung, reg: { execute(p: unknown, l: string): unknown }, p: BefehlsPeer, zeile: string): void {
  a.notizen.push(`> ${zeile} (${p.name}${p['isAdmin'] ? '' : ', no admin'})`);
  try {
    const r = reg.execute(p, zeile) as { ok: boolean; active: boolean; message: string };
    a.notizen.push(`= ${r.ok ? 'ok' : 'refused'}${r.active ? ' active' : ''}: ${r.message}`);
  } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`= throws ${(e as Error).name}`); }
}
const BEFEHLE_MARKE = ['marke', 'marke liste', 'marke LIST', 'marke setzen', 'marke setzen Unsinn', 'marke setzen defeated_eikthyr', 'marke set Defeated_Eikthyr', 'marke setzen DEFEATED_DRAGON', 'marke liste', 'marke xyz', 'MARKE liste'];
const BEFEHLE_ABBAU = ['abbau', 'abbau Unbekannt', 'abbau Beech1', 'abbau beech1 5', 'abbau BEECH1 abc', 'abbau Beech1 5000', 'abbau Beech1 0', 'abbau NPC_1 -3', 'abbau stein 1e3', 'abbau Stein'];
const BEFEHLE_SPAWN = ['spawn', 'spawn Unbekannt', 'spawn Beech1', 'spawn beech1 10 20', 'spawn Beech1 10', 'spawn Beech1 x y', 'spawn NPC_1', 'spawn Beech1 -5.25 3.5', 'spawn STEIN 0 0', 'spawn Beech1 Infinity 1'];

/** The stand-in of package B: every context member records its calls with their arguments; `k` counts every read of a member. */
function befehlsAttrappe(a: Aufzeichnung): { k: Record<string, unknown>; ziel: Record<string, unknown>; peers: BefehlsPeer[]; reg: AdminCommandRegistry; zdos: { prefabHash: number; zdoid: number }[] } {
  const peers: BefehlsPeer[] = [];
  const zdos = [{ prefabHash: 101, zdoid: 1 }, { prefabHash: 202, zdoid: 2 }, { prefabHash: 101, zdoid: 3 }, { prefabHash: 303, zdoid: 4 }, { prefabHash: 101, zdoid: 5 }];
  const reg = new AdminCommandRegistry();
  const registriere = reg.register.bind(reg);
  reg.register = (n, h): void => { a.notizen.push(`  register ${n}`); registriere(n, h); };
  const prefabs = [bPrefab(a, 'Beech1', 101, true), bPrefab(a, 'NPC_1', 202, false), bPrefab(a, 'stein', 303, true), bPrefab(a, 'Stein', 304, true)];
  let stempel = 1000;
  // the real weather service, built by the method of the class on a minimal holder (the command only reads it)
  const wetter = proto['wetterDienst']!.call({ config: { wetterDefinitionen: STANDARD_WETTER_DEFINITIONEN, wetterVorgabe: undefined }, welten: new Map() });
  const ruf = (name: string, text = ''): void => { zaehle(a, name); a.notizen.push(`  ${name}${text ? ' ' + text : ''}`); };
  const ziel: Record<string, unknown> = {
    adminCommands: reg,
    weltMarken: new WeltMarken(),
    wetterDienst: (...x: unknown[]): unknown => { ruf('wetterDienst', String(x.length)); return wetter; },
    prefabs: {
      getByName: (n: string): BPrefab | undefined => { ruf('prefabs.getByName', JSON.stringify(n)); return prefabs.find((p) => p.name === n); },
      getAll: (): BPrefab[] => { ruf('prefabs.getAll'); return prefabs; },
    },
    zdosVon: (p: BefehlsPeer): unknown => {
      ruf('zdosVon', `${p.name}@${String(p['worldId'])}`); // the world of the peer: the handler must ask for the ZDO space of the peer's own world (N1, I11B-B2)
      return {
        getZDOsInRadius: (pos: unknown, r: number) => { ruf('getZDOsInRadius', `${JSON.stringify(pos)} ${r}`); return [...zdos]; },
        destroyZDO: (id: number): void => { ruf('destroyZDO', String(id)); const i = zdos.findIndex((z) => z.zdoid === id); if (i >= 0) zdos.splice(i, 1); },
        createZDO: (hash: number, pos: unknown) => {
          ruf('createZDO', `${hash} ${JSON.stringify(pos)}`);
          const z: Record<string, unknown> = {};
          Object.defineProperty(z, 'rotation', { set: (v: unknown) => a.notizen.push(`  rotation ${JSON.stringify(v)}`), get: () => undefined });
          return z;
        },
      };
    },
    net: { getPeers: (): BefehlsPeer[] => { ruf('net.getPeers', peers.map((p) => p.name).join(',')); return peers; } },
    savedPlayers: new Map<string, Record<string, unknown>>(),
    speichertGerade: false,
    spielerSicherung: { sichere: (recs: { name: string; inventar?: unknown; gespeichertAm?: number }[], grund: unknown): void => { ruf('spielerSicherung.sichere', `${recs.map((r) => `${r.name}@${r.gespeichertAm}[${invText(r.inventar)}]`).join(';')} ${String(grund)}`); } },
    getGroundHeight: (x: number, z: number): number => { ruf('getGroundHeight', `${x} ${z}`); return x * 0.5 - z; },
    inventarSync: (p: BefehlsPeer): void => { ruf('inventarSync', `${p.name} [${invText(p.inventar)}]`); },
    saveWorldAsync: (...x: unknown[]): Promise<void> => { ruf('saveWorldAsync', String(x.length)); return Promise.resolve(); },
    sichereSpielerSofort: (...x: unknown[]): void => { ruf('sichereSpielerSofort', `${x.length}|${(x[0] as BefehlsPeer).name}|${String(x[1])}`); },
    stempelZaehler: (): unknown => { ruf('stempelZaehler'); return { naechster: (): number => { ruf('stempel.naechster'); return ++stempel; } }; },
  };
  const k = new Proxy(ziel, {
    get(t, p, r) { if (typeof p === 'string') zaehle(a, `k.${p}`); return Reflect.get(t, p, r) as unknown; },
    set(t, p, v, r) { a.notizen.push(`  WRITE k.${String(p)}`); return Reflect.set(t, p, v, r); },
  });
  return { k, ziel, peers, reg, zdos };
}
const befehlsStand = (a: Aufzeichnung, z: Record<string, unknown>, peers: readonly BefehlsPeer[]): void => {
  a.notizen.push(`  saved ${[...(z['savedPlayers'] as Map<string, Record<string, unknown>>)].map(([id, p]) => `${id}:${String(p['name'])}@${String(p['gespeichertAm'])}[${invText(p['inventar'])}]`).join(' ')}`);
  a.notizen.push(`  peers ${peers.map((p) => `${p.name}[${invText(p.inventar)}]`).join(' ')}`);
  a.notizen.push(`  markers ${(z['weltMarken'] as WeltMarken).alsNamen().join(',')}`);
};

/** The fixed sequence of package B on a stand-in: every command and sub-command, valid and invalid arguments, error branches. */
function messeBefehle1BAttrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  try {
    // A: all commands
    {
      const { k, ziel, peers, reg, zdos } = befehlsAttrappe(a);
      for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) versuche(a, () => F[n]!(k));
      a.notizen.push(`  commands ${[...(reg as unknown as { handlers: Map<string, unknown> }).handlers.keys()].join(',')}`);
      const admin = befehlsPeer('Admin');
      const gast = befehlsPeer('Gast', { isAdmin: false });
      peers.push(admin);
      for (const z of BEFEHLE_MARKE) befehl(a, reg, admin, z);
      befehl(a, reg, gast, 'marke liste');
      const ids = (proto['wetterDienst']!.call({ config: { wetterDefinitionen: STANDARD_WETTER_DEFINITIONEN, wetterVorgabe: undefined }, welten: new Map() }) as { zustandsIds(): string[] }).zustandsIds();
      for (const z of ['wetter', `wetter ${ids[0]}`, `wetter ${ids[1]!.toUpperCase()}`, `wetter ${ids[0]} unbekanntbiom`, `wetter ${ids[0]} meadows`, 'wetter', 'wetter auto', 'wetter AUTO blackforest', 'wetter Unsinn', 'wetter']) befehl(a, reg, admin, z);
      befehl(a, reg, gast, 'wetter auto');
      for (const z of BEFEHLE_ABBAU) befehl(a, reg, admin, z);
      befehl(a, reg, gast, 'abbau Beech1');
      a.zustand.push(zdos.length);
      for (const z of BEFEHLE_SPAWN) befehl(a, reg, admin, z);
      befehl(a, reg, gast, 'spawn Beech1');
      for (const z of ['item', 'item xyz', 'item give', 'item give Unbekannt', 'item give Hammer', 'item gib Hammer 3', 'item give hammer abc', 'item give Hammer 0', 'item give Hammer 2.7', 'item GIVE Hammer -4']) befehl(a, reg, admin, z);
      const voll = befehlsPeer('Voll');
      for (let i = 0; i < 32; i++) voll.inventar.addItem(findItem('Hammer')!, 1);
      befehl(a, reg, voll, 'item give Hammer');
      befehl(a, reg, admin, 'item give Hammer 9999');
      befehl(a, reg, gast, 'item give Hammer');
      befehlsStand(a, ziel, peers);
      // item ironward / wildwarden: a save in progress, no name, online (one, two, an editor connection, another figure, a full bag), absent, error branches
      ziel['speichertGerade'] = true;
      befehl(a, reg, admin, 'item ironward Gast');
      ziel['speichertGerade'] = false;
      for (const z of ['item ironward', 'item ironward   ', 'item ironward Niemand']) befehl(a, reg, admin, z);
      peers.push(befehlsPeer('Ziel Eins'), befehlsPeer('Ziel Eins', { nurEditor: true }));
      for (const z of ['item ironward Ziel Eins', 'item IRONWARD ziel eins', 'item wildwarden Ziel Eins']) befehl(a, reg, admin, z);
      peers.push(befehlsPeer('Frau', { figur: 'wikingerin' }));
      befehl(a, reg, admin, 'item ironward Frau');
      peers.push(befehlsPeer('Doppelt'), befehlsPeer('doppelt'));
      befehl(a, reg, admin, 'item ironward Doppelt');
      const vollOnline = befehlsPeer('VollOnline');
      for (let i = 0; i < 32; i++) vollOnline.inventar.addItem(findItem('Hammer')!, 1);
      peers.push(vollOnline);
      befehl(a, reg, admin, 'item ironward VollOnline');
      befehlsStand(a, ziel, peers);
      const saved = ziel['savedPlayers'] as Map<string, Record<string, unknown>>;
      const inv = new Inventory();
      inv.addItem(findItem('Hammer')!, 1);
      saved.set('id-weg', { name: 'Weg', figur: 'wikinger', inventar: inv.serialize(), position: { x: 4, y: 5, z: 6 }, gespeichertAm: 7 });
      befehl(a, reg, admin, 'item ironward Weg');
      befehl(a, reg, admin, 'item ironward Weg');
      ziel['spielerSicherung'] = null;
      befehl(a, reg, admin, 'item wildwarden weg');
      saved.set('id-ohne', { name: 'Ohne', figur: 'wikinger' });
      befehl(a, reg, admin, 'item ironward Ohne');
      saved.set('id-frau', { name: 'FrauWeg', figur: 'wikingerin', inventar: [] });
      befehl(a, reg, admin, 'item ironward FrauWeg');
      const vollInv = new Inventory();
      for (let i = 0; i < 32; i++) vollInv.addItem(findItem('Hammer')!, 1);
      saved.set('id-voll', { name: 'VollWeg', figur: 'wikinger', inventar: vollInv.serialize() });
      befehl(a, reg, admin, 'item ironward VollWeg');
      saved.set('id-z1', { name: 'Zwilling', figur: 'wikinger', inventar: [] });
      saved.set('id-z2', { name: 'zwilling', figur: 'wikinger', inventar: [] });
      befehl(a, reg, admin, 'item ironward Zwilling');
      saved.set('id-ziel', { name: 'Ziel Eins', figur: 'wikinger', inventar: [] }); // online and absent under one name: the online one wins
      befehl(a, reg, admin, 'item wildwarden Ziel Eins');
      befehl(a, reg, gast, 'item ironward Weg');
      befehlsStand(a, ziel, peers);
      a.zustand.push(saved.size, peers.length);
    }
    // E (N1, attack I11B-B1/B2): the promise of item ironward/wildwarden ("a full bag must never get half a set"), the name key,
    // the figure, extra and odd arguments, a peer in a second world
    {
      const { k, ziel, peers, reg } = befehlsAttrappe(a);
      for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) versuche(a, () => F[n]!(k));
      const admin = befehlsPeer('Admin');
      peers.push(admin);
      const saved = ziel['savedPlayers'] as Map<string, Record<string, unknown>>;
      const teile = (inv: unknown): string => { const i = inv instanceof Inventory ? inv : Inventory.ausSpeicherstand(inv as never); return `${IRONWARD_PARTS.filter((t) => i.countOf(t.item)).length}/7 ironward, ${WILDWARDEN_PARTS.filter((t) => i.countOf(t.item)).length}/7 wildwarden`; };
      const zeigeP = (p: BefehlsPeer): void => { a.notizen.push(`  peer ${JSON.stringify(p.name)} ${teile(p.inventar)} [${invText(p.inventar)}]`); };
      const zeigeS = (id: string): void => { const r = saved.get(id)!; a.notizen.push(`  absent ${id} ${teile(r['inventar'])} @${String(r['gespeichertAm'])} [${invText(r['inventar'])}]`); };
      /** A bag with exactly `frei` free places (filled with hammers). */
      const fastVoll = (frei: number): Inventory => { const i = new Inventory(); for (let n = 0; n < 200 && i.addItem(findItem('Hammer')!, 1) === 0; n++); for (let j = 0; j < frei; j++) i.removeByName('Hammer', 1); return i; };
      // a part from the middle of the set, online and absent
      const teil = befehlsPeer('Teil');
      teil.inventar.addItem(findItem(IRONWARD_PARTS[2]!.item)!, 1);
      peers.push(teil);
      befehl(a, reg, admin, 'item ironward Teil');
      zeigeP(teil);
      const teilInv = new Inventory();
      teilInv.addItem(findItem(WILDWARDEN_PARTS[3]!.item)!, 1);
      saved.set('id-teil', { name: 'TeilWeg', figur: 'wikinger', inventar: teilInv.serialize(), gespeichertAm: 3 });
      befehl(a, reg, admin, 'item wildwarden TeilWeg');
      zeigeS('id-teil');
      // a bag with room for fewer parts than are missing, online and absent: nothing changes, not in the real bag either
      const fast = befehlsPeer('Fast');
      fast.inventar.uebernimm(fastVoll(3));
      peers.push(fast);
      befehl(a, reg, admin, 'item ironward Fast');
      zeigeP(fast);
      saved.set('id-fast', { name: 'FastWeg', figur: 'wikinger', inventar: fastVoll(3).serialize(), gespeichertAm: 4 });
      befehl(a, reg, admin, 'item wildwarden FastWeg');
      zeigeS('id-fast');
      // exactly as much room as needed: the set fits
      const knapp = befehlsPeer('Knapp');
      knapp.inventar.uebernimm(fastVoll(7));
      peers.push(knapp);
      befehl(a, reg, admin, 'item ironward Knapp');
      zeigeP(knapp);
      // one online player and two absent records of the same name: the online one is served
      const drei = befehlsPeer('Drei');
      peers.push(drei);
      saved.set('id-d1', { name: 'Drei', figur: 'wikinger', inventar: [] });
      saved.set('id-d2', { name: 'drei', figur: 'wikinger', inventar: [] });
      befehl(a, reg, admin, 'item ironward Drei');
      zeigeP(drei);
      zeigeS('id-d1');
      zeigeS('id-d2');
      // an online player without a figure ('' and missing) and an absent record with `wikinger` under the same name
      peers.push(befehlsPeer('OhneFigur', { figur: '' }), befehlsPeer('KeineFigur', { figur: undefined }));
      saved.set('id-of', { name: 'OhneFigur', figur: 'wikinger', inventar: [] });
      saved.set('id-kf', { name: 'KeineFigur', figur: 'wikinger', inventar: [] });
      befehl(a, reg, admin, 'item ironward OhneFigur');
      befehl(a, reg, admin, 'item ironward KeineFigur');
      zeigeS('id-of');
      zeigeS('id-kf');
      // names in NFD and with blanks at the edge, online and absent, asked for in NFC
      const nfd = befehlsPeer('A\u0308gir');
      peers.push(nfd);
      befehl(a, reg, admin, 'item ironward \u00c4gir');
      zeigeP(nfd);
      // N2 (N1-B1): an online player whose name has blanks at the edge (the handshake does not trim guest names)
      const rand = befehlsPeer('  Rand ');
      peers.push(rand);
      befehl(a, reg, admin, 'item ironward Rand');
      zeigeP(rand);
      saved.set('id-nfd', { name: '  O\u0308din ', figur: 'wikinger', inventar: [], gespeichertAm: 5 });
      befehl(a, reg, admin, 'item wildwarden \u00d6DIN');
      zeigeS('id-nfd');
      // extra and odd arguments
      for (const z of ['item give Hammer 2 extra', 'item give Hammer 1e1', 'item give Hammer 0x10', 'marke setzen defeated_eikthyr extra', 'abbau Beech1 5m', 'abbau Beech1 0x10', 'abbau Beech1 1e1 extra', 'spawn Beech1 12abc 5', 'spawn Beech1 0x10 010', 'spawn Beech1 1 2 extra']) befehl(a, reg, admin, z);
      zeigeP(admin);
      // a peer in a second world: spawn and abbau ask for the ZDO space of the peer's world
      const dungeon = befehlsPeer('Dungeon', { worldId: 'dungeon:7' });
      for (const z of ['spawn Beech1 1 2', 'abbau Beech1']) befehl(a, reg, dungeon, z);
      befehlsStand(a, ziel, peers);
    }
    // B: members replaced on the stand-in AFTER the registration: the handlers read them at the time of the call, never a stale copy
    {
      const { k, ziel, peers, reg } = befehlsAttrappe(a);
      for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) versuche(a, () => F[n]!(k));
      const admin = befehlsPeer('Admin');
      peers.push(admin);
      const neu = (n: string, t = ''): void => { zaehle(a, `NEW ${n}`); a.notizen.push(`  NEW ${n}${t ? ' ' + t : ''}`); };
      ziel['weltMarken'] = new WeltMarken();
      ziel['prefabs'] = { getByName: (n: string): BPrefab | undefined => { neu('prefabs.getByName', n); return n === 'Neu' ? bPrefab(a, 'Neu', 909, true) : undefined; }, getAll: (): BPrefab[] => { neu('prefabs.getAll'); return []; } };
      ziel['net'] = { getPeers: (): BefehlsPeer[] => { neu('net.getPeers'); return [admin]; } };
      ziel['savedPlayers'] = new Map([['id-x', { name: 'Ersatz', figur: 'wikinger', inventar: [] }]]);
      ziel['saveWorldAsync'] = (): Promise<void> => { neu('saveWorldAsync'); return Promise.resolve(); };
      ziel['stempelZaehler'] = (): unknown => { neu('stempelZaehler'); return { naechster: (): number => 5 }; };
      ziel['spielerSicherung'] = { sichere: (r: { name: string }[], g: unknown): void => { neu('sichere', `${r.map((x) => x.name).join(',')} ${String(g)}`); } };
      ziel['getGroundHeight'] = (): number => { neu('getGroundHeight'); return 42; };
      ziel['inventarSync'] = (p: BefehlsPeer): void => { neu('inventarSync', p.name); };
      ziel['sichereSpielerSofort'] = (p: BefehlsPeer, g: string): void => { neu('sichereSpielerSofort', `${p.name} ${g}`); };
      ziel['zdosVon'] = (): unknown => { neu('zdosVon'); return { getZDOsInRadius: () => [], destroyZDO: () => undefined, createZDO: () => ({}) }; };
      ziel['wetterDienst'] = (): unknown => { neu('wetterDienst'); return { zustandsIds: () => ['A b'], aktiveOverrides: () => [], setze: (z: unknown, b: unknown) => neu('setze', `${String(z)} ${String(b)}`) }; };
      for (const z of ['marke setzen defeated_eikthyr', 'marke liste', 'wetter a_b', 'wetter', 'abbau Neu', 'spawn Neu 1 2', 'item give Hammer', 'item ironward Ersatz', 'item ironward Admin']) befehl(a, reg, admin, z);
      ziel['speichertGerade'] = true;
      befehl(a, reg, admin, 'item ironward Ersatz');
      befehlsStand(a, ziel, peers);
    }
    // D: a context without a member the handler needs: the exception, by its name (rule 6a: the text names `this.` or `k.`)
    {
      for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) {
        versuche(a, () => F[n]!({}));
        versuche(a, () => F[n]!({ adminCommands: {} }));
      }
      const ohne = (mitglied: string, zeilen: readonly string[], vorher?: (z: Record<string, unknown>) => void): void => {
        const { k, ziel, peers, reg } = befehlsAttrappe(a);
        for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) versuche(a, () => F[n]!(k));
        peers.push(befehlsPeer('Admin'));
        vorher?.(ziel);
        delete ziel[mitglied];
        a.notizen.push(`  without ${mitglied}`);
        for (const z of zeilen) befehl(a, reg, peers[0]!, z);
      };
      ohne('weltMarken', ['marke liste']);
      ohne('wetterDienst', ['wetter']);
      ohne('prefabs', ['abbau Beech1', 'spawn Beech1']);
      ohne('zdosVon', ['abbau Beech1', 'spawn Beech1']);
      ohne('getGroundHeight', ['spawn Beech1']);
      ohne('inventarSync', ['item give Hammer', 'item ironward Admin']);
      ohne('sichereSpielerSofort', ['item ironward Admin']);
      ohne('saveWorldAsync', ['item ironward Admin']);
      ohne('stempelZaehler', ['item ironward Weg'], (z) => (z['savedPlayers'] as Map<string, unknown>).set('w', { name: 'Weg', figur: 'wikinger', inventar: [] }));
      ohne('spielerSicherung', ['item ironward Weg'], (z) => (z['savedPlayers'] as Map<string, unknown>).set('w', { name: 'Weg', figur: 'wikinger', inventar: [] }));
    }
  } finally {
    ruecksetzen();
  }
  return a;
}

/** The same commands on a real instance: registered by the constructor and once more through the forwardings, run through the registry. */
function messeBefehle1BEcht(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    const server = createWovServer({
      port: 0, worldFeatures: false, worldName: 'i1-form-k1b', everyoneAdmin: true,
      worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
    } as never) as unknown as Record<string, unknown>;
    // the order of the registry after the constructor: a later registration replaces an earlier one (teleport)
    a.notizen.push(`  commands ${[...((server['adminCommands'] as unknown as { handlers: Map<string, unknown> }).handlers.keys())].join(',')}`);
    const zm = new ZDOManager(1n);
    (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, { zdos: zm });
    // a second world (N1, I11B-B2): a peer in it spawns and removes there, not in the main world
    const zm2 = new ZDOManager(2n);
    (server['welten'] as Map<string, unknown>).set('dungeon:7', { zdos: zm2 });
    const prefabs = server['prefabs'] as { register(p: unknown): void };
    prefabs.register(new Prefab('K9Baum', undefined, PrefabFlag.PERSISTENT));
    prefabs.register(new Prefab('K9Geist'));
    const peers: BefehlsPeer[] = [];
    (server['net'] as Record<string, unknown>)['getPeers'] = (): BefehlsPeer[] => peers;
    // stand-ins on the instance, as the tests do (ironward.ts): what the handlers call through the context
    server['getGroundHeight'] = (x: number, z: number): number => { zaehle(a, 'getGroundHeight'); a.notizen.push(`  getGroundHeight ${x} ${z}`); return 1.5; };
    server['saveWorldAsync'] = (): Promise<void> => { zaehle(a, 'saveWorldAsync'); return Promise.resolve(); };
    server['sichereSpielerSofort'] = (p: BefehlsPeer, g: string): void => { zaehle(a, 'sichereSpielerSofort'); a.notizen.push(`  sichereSpielerSofort ${p.name} ${g}`); };
    server['inventarSync'] = (p: BefehlsPeer): void => { zaehle(a, 'inventarSync'); a.notizen.push(`  inventarSync ${p.name} [${invText(p.inventar)}]`); };
    const admin = befehlsPeer('Echt');
    peers.push(admin);
    const lauf = (reg: { execute(p: unknown, l: string): unknown }): void => {
      for (const z of BEFEHLE_MARKE) befehl(a, reg, admin, z);
      for (const z of ['wetter', 'wetter auto', 'wetter Unsinn']) befehl(a, reg, admin, z);
      for (const z of ['spawn', 'spawn Unbekannt', 'spawn K9Baum 3 4', 'spawn k9baum 5 6', 'spawn K9Baum', 'spawn K9Geist 12 -3']) befehl(a, reg, admin, z);
      a.notizen.push(`  zdos ${zm.getAllZDOs().map((z) => `${z.prefabHash}@${JSON.stringify(z.position)}/${JSON.stringify(z.rotation)}`).join(' ')}`);
      for (const z of ['abbau', 'abbau k9geist 200', 'abbau K9Baum 3', 'abbau K9Baum 200', 'abbau K9Baum']) befehl(a, reg, admin, z);
      a.zustand.push(zm.getAllZDOs().length);
      const dungeon = befehlsPeer('EchtDungeon', { worldId: 'dungeon:7' });
      for (const z of ['spawn K9Baum 1 2', 'spawn K9Baum 3 3']) befehl(a, reg, dungeon, z);
      a.notizen.push(`  zdos main ${zm.getAllZDOs().length}, second world ${zm2.getAllZDOs().map((z) => `${z.prefabHash}@${JSON.stringify(z.position)}`).join(' ')}`);
      befehl(a, reg, dungeon, 'abbau K9Baum 200');
      a.notizen.push(`  zdos main ${zm.getAllZDOs().length}, second world ${zm2.getAllZDOs().length}`);
      for (const z of ['item give Hammer 2', 'item give Hammer 2 extra', 'item give Hammer 1e1', 'item ironward Echt', 'item ironward Echt']) befehl(a, reg, admin, z);
      // a full bag online: nothing changes in the real bag
      const voll = befehlsPeer('EchtVoll');
      for (let n = 0; n < 200 && voll.inventar.addItem(findItem('Hammer')!, 1) === 0; n++);
      voll.inventar.removeByName('Hammer', 2);
      peers.push(voll);
      befehl(a, reg, admin, 'item wildwarden EchtVoll');
      a.notizen.push(`  EchtVoll [${invText(voll.inventar)}]`);
      peers.splice(peers.indexOf(voll), 1);
      const saved = server['savedPlayers'] as Map<string, Record<string, unknown>>;
      saved.set('id-weg', { name: 'Weg', figur: 'wikinger', inventar: [], gespeichertAm: 1 });
      befehl(a, reg, admin, 'item wildwarden Weg');
      a.notizen.push(`  absent Weg [${invText(saved.get('id-weg')!['inventar'])}] stamp ${typeof saved.get('id-weg')!['gespeichertAm']} ${(saved.get('id-weg')!['gespeichertAm'] as number) > 1 ? 'raised' : 'not raised'}`);
      saved.delete('id-weg');
      a.notizen.push(`  markers ${(server['weltMarken'] as WeltMarken).alsNamen().join(',')}`);
      admin.inventar = new Inventory();
    };
    // first through the handlers the constructor registered
    lauf(server['adminCommands'] as AdminCommandRegistry);
    // then once more: a new registry on the instance, filled by calling the four forwardings (as ironward.ts does)
    const reg = new AdminCommandRegistry();
    server['adminCommands'] = reg;
    for (const n of ['registerMarkeCommand', 'registerWetterCommand', 'registerAbbauCommand', 'registerSpawnCommand']) versuche(a, () => (server[n] as () => unknown).call(server));
    a.notizen.push(`  commands ${[...(reg as unknown as { handlers: Map<string, unknown> }).handlers.keys()].join(',')}`);
    lauf(reg);
    (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

// ── [2f] Behaviour of step 1, package C: the commands teleport and spieler ──

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

// ── [2g] Behaviour of step 1, package C, after the attack (N1) ──

/** `getGroundHeight` as a function that notes whether it was called on its receiver (a handler that loses `this` shows here). */
const hoeheMitEmpfaenger = (a: Aufzeichnung, empfaenger: () => unknown) => function (this: unknown, x: number, z: number): number {
  zaehle(a, 'getGroundHeight');
  a.notizen.push(`call getGroundHeight ${x} ${z} receiver=${this === empfaenger() ? 'context' : 'LOST'}`);
  return x * 0.5 + z * 0.25 + 0.0625;
};
/** Records whose names differ from what is typed only in Unicode form (NFD/NFC), in case or by a trailing space. */
const gespeichertN1 = (): Map<string, Record<string, unknown>> => new Map<string, Record<string, unknown>>([
  ['id-joerg', { name: 'Jo\u0308rg', spielerId: 'id-joerg' }], // NFD in the record
  ['id-asa', { name: '\u00c5sa', spielerId: 'id-asa' }], // NFC in the record, typed as NFD below
  ['id-bjoern', { name: 'Bj\u00f6rn', spielerId: 'id-bjoern' }], // online as NFD
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
  let online: unknown[] = [selbst, peerB(a, 'Bjo\u0308rn', { spielerId: 'id-bjoern' }), peerB(a, 'EdAdmin', { nurEditor: true, isAdmin: true, spielerId: 'ed-a' })];
  // N2: getPeers and vergiss note their receiver as getGroundHeight does (a handler that calls them unbound shows here)
  const netz: Record<string, unknown> = {};
  netz['getPeers'] = function (this: unknown): unknown[] { zaehle(a, 'getPeers'); a.notizen.push(`call getPeers receiver=${this === netz ? 'net' : 'LOST'}`); return online; };
  const sicherung = { vergiss(this: unknown, x: unknown): void { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)} receiver=${this === sicherung ? 'spielerSicherung' : 'LOST'}`); } };
  const k: Record<string, unknown> = {
    adminCommands: { register: (n: string, fn: Handler): void => { zaehle(a, 'register'); handler.set(n, fn); } },
    dungeons: { getInstance: (id: unknown): unknown => { zaehle(a, 'getInstance'); a.notizen.push(`call getInstance ${String(id)}`); return id === 'd-inst' ? { players: inInstanz } : undefined; } },
    teleportPeer: (...x: unknown[]): void => { zaehle(a, 'teleportPeer'); a.notizen.push(`call teleportPeer ${x.length} ${nm(x[0])} ${JSON.stringify(x.slice(1))}`); },
    net: netz,
    savedPlayers: saved,
    spielerSicherung: sicherung,
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
    sp('entfernen bj\u00f6rn');
    sp('entfernen J\u00d6RG');
    sp('entfernen A\u030asa');
    sp('entfernen ulf');
    // exactly one player online
    online = [peerB(a, 'Allein', { spielerId: 'id-allein' })];
    sp('online');
    // N2: a teleport out of an instance BEFORE `dungeons` is replaced (its first use), then replaced, then a second one
    tp('7 8', peerB(a, 'Vorher', { userId: 8, dungeonId: 'd-inst', dungeonReturn: { x: 2, y: 2, z: 2 } }));
    a.notizen.push(`instance players ${[...inInstanz].join(',')}`);
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
    const sicherung = { vergiss(this: unknown, x: unknown): void { zaehle(a, 'vergiss'); a.notizen.push(`call vergiss ${JSON.stringify(x)} receiver=${this === sicherung ? 'spielerSicherung' : 'LOST'}`); } };
    server['spielerSicherung'] = sicherung;
    const saved = server['savedPlayers'] as Map<string, Record<string, unknown>>;
    for (const [id, r] of gespeichertN1()) saved.set(id, r);
    const selbst = peerB(a, 'Selbst', { spielerId: 'id-selbst', userId: 31 });
    let online: unknown[] = [selbst, peerB(a, 'Bjo\u0308rn', { spielerId: 'id-bjoern', userId: 32 }), peerB(a, 'EdAdmin', { nurEditor: true, isAdmin: true, spielerId: 'ed-a', userId: 33 })];
    const netz = server['net'] as Record<string, unknown>;
    netz['getPeers'] = function (this: unknown): unknown[] { zaehle(a, 'getPeers'); a.notizen.push(`call getPeers receiver=${this === netz ? 'net' : 'LOST'}`); return online; };
    const registry = server['adminCommands'] as { execute(p: unknown, l: string): unknown };
    const ex = (zeile: string, p: Record<string, unknown> = selbst): void => {
      try { a.notizen.push(`> ${zeile} = ${JSON.stringify(registry.execute(p, zeile))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> ${zeile} throws ${(e as Error).name}`); }
      a.notizen.push(zustandB(p));
      a.zustand.push(saved.size);
    };
    for (const z of ['spieler online', 'spieler entfernen Selbst', 'spieler liste', 'spieler entfernen Einmal Einmal', 'spieler entfernen bj\u00f6rn', 'spieler entfernen J\u00d6RG', 'spieler entfernen A\u030asa', 'spieler entfernen ulf', 'teleport 3 4']) ex(z);
    online = [peerB(a, 'Allein', { spielerId: 'id-allein', userId: 34 })];
    ex('spieler online');
    // N2: a teleport out of an instance (the stock DungeonManager, no live instance) BEFORE `dungeons` is replaced
    ex('teleport 1 2', peerB(a, 'Selbst', { spielerId: 'id-selbst', userId: 31, dungeonId: 'd-alt', dungeonReturn: { x: 2, y: 2, z: 2 } }));
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

/** Step 1A, measured on the stand before the move (`--messen-basis`, base `bd94dfc7`): the admin-list and ban commands on a stand-in. Since D5 N4 the live rights packet (`gleicheAdminrechteAb`) is named `adminrechte` and carries the new rights in `active`: those lines were re-measured on c5a9a8c0 + N4, all others are as measured on `bd94dfc7`. */
const SOLL_BEFEHLE_ATTRAPPE: Aufzeichnung = {
  paket: [
    "Anna:AdminEvent:[\"adminrechte\",true,\"Du hast jetzt Adminrechte.\",0]:40:75e936abca20fc2b",
    "Carl:AdminEvent:[\"fly\",false,\"Fly mode OFF (Adminrechte entzogen)\",0]:41:009857b1146c12c7",
    "Carl:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Dora:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Anna:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Neu:AdminEvent:[\"fly\",false,\"Fly mode OFF (Adminrechte entzogen)\",0]:41:009857b1146c12c7",
    "Neu:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
  ],
  aufrufe: {"adminCommands.register": 4, "adminListe.alle": 7, "spielerIdFuerName": 17, "adminListe.hinzufuegen": 2, "gleicheAdminrechteAb": 2, "net.getPeers": 8, "adminListe.enthaelt": 16, "adminListe.entfernen": 2, "adminListe.anzahl": 2, "net.findPeerByName": 25, "net.kick": 3, "kontenDb.bannListe": 4, "net.herkunftVon": 2, "kontenDb.bannSetzen": 12, "net.trenneGebannte": 12, "kontenDb.charakterNachName": 21, "kontenDb.charaktereVonKonto": 11, "kontenDb.kontoNachId": 4, "kontenDb.bannAufheben": 6},
  konsole: {"log": 5, "warn": 0},
  zustand: [0, 1],
  ausnahmen: [],
  notizen: [
    "call adminCommands.register \"admin\" \"function\"",
    "call adminCommands.register \"kick\" \"function\"",
    "call adminCommands.register \"bann\" \"function\"",
    "call adminCommands.register \"entbann\" \"function\"",
    "registered admin kick bann entbann",
    "admin [] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin liste | admin add <Name> | admin remove <Name>\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list= bans=0",
    "call adminListe.alle",
    "admin [\"liste\"] -> {\"ok\":true,\"active\":false,\"message\":\"Admin-Liste ist leer\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list= bans=0",
    "call adminListe.alle",
    "admin [\"LISTE\"] -> {\"ok\":true,\"active\":false,\"message\":\"1 dauerhafte Admins: Boss [S-Boss]\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list=S-Boss bans=0",
    "admin [\"add\"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin add <Name>\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list=S-Boss bans=0",
    "admin [\"add\",\" \",\" \"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin add <Name>\"} args-after=[\" \",\" \"]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list=S-Boss bans=0",
    "call spielerIdFuerName \"Doppel\"",
    "admin [\"add\",\"Doppel\"] -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"} args-after=[\"Doppel\"]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list=S-Boss bans=0",
    "call spielerIdFuerName \"Gibts Nicht\"",
    "admin [\"add\",\"Gibts\",\"Nicht\"] -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Gibts Nicht\\\" (muss schon einmal verbunden gewesen sein)\"} args-after=[\"Gibts\",\"Nicht\"]",
    "rights Boss=A- Anna=-- Carl=AF Dora=A- Ohne=A- Editor=-- list=S-Boss bans=0",
    "call spielerIdFuerName \"Anna\"",
    "call adminListe.hinzufuegen \"S-Anna\" \"Anna\"",
    "call gleicheAdminrechteAb",
    "call adminListe.alle",
    "call net.getPeers",
    "log 62:d37f570698cab7ec:[Admin] \"Anna\" — Rechte an der Liste nachgezogen",
    "log 63:e84ae5d94609e587:[Admin] \"Carl\" — Rechte an der Liste nachgezogen",
    "log 63:0c761ba5779e1aa8:[Admin] \"Dora\" — Rechte an der Liste nachgezogen",
    "admin [\"add\",\"Anna\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna [S-Anna] ist jetzt dauerhaft Admin\"} args-after=[\"Anna\"]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call spielerIdFuerName \"anna\"",
    "call adminListe.hinzufuegen \"S-Anna\" \"anna\"",
    "admin [\"hinzufuegen\",\"anna\"] -> {\"ok\":true,\"active\":false,\"message\":\"anna war schon Admin\"} args-after=[\"anna\"]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call adminListe.alle",
    "admin [\"list\"] -> {\"ok\":true,\"active\":false,\"message\":\"2 dauerhafte Admins: Boss [S-Boss], Anna [S-Anna]\"} args-after=[]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "admin [\"remove\"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin remove <Name>\"} args-after=[]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call spielerIdFuerName \"Doppel\"",
    "admin [\"entfernen\",\"Doppel\"] -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"} args-after=[\"Doppel\"]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call spielerIdFuerName \"Gibts\"",
    "admin [\"remove\",\"Gibts\"] -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Gibts\\\"\"} args-after=[\"Gibts\"]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call spielerIdFuerName \"Bert\"",
    "call adminListe.enthaelt \"S-Bert\"",
    "call adminListe.entfernen \"S-Bert\"",
    "admin [\"remove\",\"Bert\"] -> {\"ok\":true,\"active\":false,\"message\":\"Bert war nicht in der Admin-Liste\"} args-after=[\"Bert\"]",
    "rights Boss=A- Anna=A- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss,S-Anna bans=0",
    "call spielerIdFuerName \"Anna\"",
    "call adminListe.enthaelt \"S-Anna\"",
    "call adminListe.anzahl",
    "call adminListe.entfernen \"S-Anna\"",
    "call gleicheAdminrechteAb",
    "call adminListe.alle",
    "call net.getPeers",
    "log 63:a74f867cb092273d:[Admin] \"Anna\" — Rechte an der Liste nachgezogen",
    "admin [\"Remove\",\"Anna\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna [S-Anna] ist kein dauerhafter Admin mehr\"} args-after=[\"Anna\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss bans=0",
    "call spielerIdFuerName \"Boss\"",
    "call adminListe.enthaelt \"S-Boss\"",
    "call adminListe.anzahl",
    "admin [\"remove\",\"Boss\"] -> {\"ok\":false,\"active\":false,\"message\":\"Boss ist der letzte Admin. Erst \\\"admin add <Name>\\\" fuer jemand anderen, sonst steht der Server ohne Admin da.\"} args-after=[\"Boss\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss bans=0",
    "admin [\"xyz\",\"Anna\"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin liste | admin add <Name> | admin remove <Name>\"} args-after=[\"Anna\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- list=S-Boss bans=0",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=AF",
    "call adminListe.alle",
    "call net.getPeers",
    "log 62:a3eabbd0446965ed:[Admin] \"Neu\" — Rechte an der Liste nachgezogen:",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=--",
    "call adminListe.alle",
    "call net.getPeers",
    "kick [] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: kick <Name>\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "kick [\"  \"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: kick <Name>\"} args-after=[\"  \"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"boss\"",
    "kick [\"boss\"] -> {\"ok\":false,\"active\":false,\"message\":\"Dich selbst kannst du nicht werfen\"} args-after=[\"boss\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Anna\"",
    "call net.kick \"Anna\"",
    "kick [\"Anna\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna wurde getrennt (kein Bann — er kann sofort wiederkommen)\"} args-after=[\"Anna\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Anna Maria\"",
    "call net.kick \"Anna Maria\"",
    "kick [\"Anna\",\"Maria\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna Maria wurde getrennt (kein Bann — er kann sofort wiederkommen)\"} args-after=[\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Niemand\"",
    "call net.kick \"Niemand\"",
    "kick [\"Niemand\"] -> {\"ok\":false,\"active\":false,\"message\":\"Niemand ist nicht verbunden\"} args-after=[\"Niemand\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "bann [] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: bann <Name> [30m|2h|7d|dauerhaft] [Grund] | bann herkunft <Name> ... | bann liste\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "bann [\"herkunft\"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: bann <Name> [30m|2h|7d|dauerhaft] [Grund] | bann herkunft <Name> ... | bann liste\"} args-after=[\"herkunft\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call kontenDb.bannListe",
    "bann [\"liste\"] -> {\"ok\":true,\"active\":false,\"message\":\"Keine wirksamen Banns\"} args-after=[\"liste\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"BOSS\"",
    "bann [\"BOSS\"] -> {\"ok\":false,\"active\":false,\"message\":\"Dich selbst kannst du nicht bannen\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"boss\"",
    "bann [\"herkunft\",\"boss\"] -> {\"ok\":false,\"active\":false,\"message\":\"Dich selbst kannst du nicht bannen\"} args-after=[\"herkunft\",\"boss\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Niemand\"",
    "call net.getPeers",
    "bann [\"herkunft\",\"Niemand\"] -> {\"ok\":false,\"active\":false,\"message\":\"Niemand ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen\"} args-after=[\"herkunft\",\"Niemand\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Editor\"",
    "call net.getPeers",
    "bann [\"herkunft\",\"Editor\"] -> {\"ok\":false,\"active\":false,\"message\":\"Editor ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen\"} args-after=[\"herkunft\",\"Editor\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Dora\"",
    "call net.getPeers",
    "call net.herkunftVon \"Dora\"",
    "bann [\"ip\",\"Dora\"] -> {\"ok\":false,\"active\":false,\"message\":\"Herkunft von Dora ist unbekannt\"} args-after=[\"ip\",\"Dora\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call net.findPeerByName \"Anna\"",
    "call net.getPeers",
    "call net.herkunftVon \"Anna\"",
    "call kontenDb.bannSetzen \"herkunft\" \"203.0.113.7\" {\"grund\":\"Spam Bot\",\"gesetztVon\":\"Boss\",\"bis\":1790944200000}",
    "call net.trenneGebannte",
    "bann [\"herkunft\",\"Anna\",\"2h\",\"Spam\",\"Bot\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von Anna gebannt (bis 2.10.2026, 14:30:00, Spam Bot) — getrennt: Anna\"} args-after=[\"herkunft\",\"Anna\",\"2h\",\"Spam\",\"Bot\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=1",
    "call net.findPeerByName \"Zweit\"",
    "call kontenDb.charakterNachName \"Zweit\"",
    "call kontenDb.charaktereVonKonto 1",
    "call adminListe.enthaelt \"S-Boss\"",
    "bann [\"Zweit\",\"30m\"] -> {\"ok\":false,\"active\":false,\"message\":\"Zweit steht auf der Admin-Liste. Erst \\\"admin remove Zweit\\\", dann bannen — sonst sperrt man sich womoeglich den letzten Admin aus.\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=1",
    "call net.findPeerByName \"Chef\"",
    "call kontenDb.charakterNachName \"Chef\"",
    "call spielerIdFuerName \"Chef\"",
    "call adminListe.enthaelt \"S-Boss\"",
    "bann [\"Chef\"] -> {\"ok\":false,\"active\":false,\"message\":\"Chef steht auf der Admin-Liste. Erst \\\"admin remove Chef\\\", dann bannen — sonst sperrt man sich womoeglich den letzten Admin aus.\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=1",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":1790938800000}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"30m\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 2.10.2026, 13:00:00)\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"wieder da\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"dauerhaft\",\"wieder\",\"da\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, wieder da)\"} args-after=[\"wieder\",\"da\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"PERMANENT\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft)\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"x\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"immer\",\"x\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, x)\"} args-after=[\"x\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"Grund\",\"gesetztVon\":\"Boss\",\"bis\":1791541800000}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"7d\",\"Grund\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 9.10.2026, 12:30:00, Grund)\"} args-after=[\"Grund\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":1791196200000}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"3t\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 5.10.2026, 12:30:00)\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":1790944200000}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"2H\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 2.10.2026, 14:30:00)\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"0m null\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"0m\",\"null\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 0m null)\"} args-after=[\"0m\",\"null\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"12x\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"12x\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 12x)\"} args-after=[\"12x\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call net.findPeerByName \"Fremd\"",
    "call kontenDb.charakterNachName \"Fremd\"",
    "call kontenDb.charaktereVonKonto 9",
    "call adminListe.enthaelt \"S-Fremd\"",
    "call kontenDb.bannSetzen \"konto\" \"9\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":1790937060000}",
    "call net.trenneGebannte",
    "bann [\"Fremd\",\"1m\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Fremd gebannt (bis 2.10.2026, 12:31:00) — getrennt: Gast, Gast2\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=3",
    "call net.findPeerByName \"Doppel\"",
    "call kontenDb.charakterNachName \"Doppel\"",
    "call spielerIdFuerName \"Doppel\"",
    "bann [\"Doppel\"] -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=3",
    "call net.findPeerByName \"Gibts\"",
    "call kontenDb.charakterNachName \"Gibts\"",
    "call spielerIdFuerName \"Gibts\"",
    "bann [\"Gibts\"] -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Gibts\\\" (kein Konto dieses Namens und nie verbunden gewesen)\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=3",
    "call net.findPeerByName \"Bert\"",
    "call kontenDb.charakterNachName \"Bert\"",
    "call spielerIdFuerName \"Bert\"",
    "call adminListe.enthaelt \"S-Bert\"",
    "call kontenDb.bannSetzen \"spieler\" \"S-Bert\" {\"grund\":\"Grund mit Umlaut ä\",\"gesetztVon\":\"Boss\",\"bis\":1790944200000}",
    "call net.trenneGebannte",
    "bann [\"Bert\",\"2h\",\"Grund\",\"mit\",\"Umlaut\",\"ä\"] -> {\"ok\":true,\"active\":false,\"message\":\"Bert gebannt (bis 2.10.2026, 14:30:00, Grund mit Umlaut ä)\"} args-after=[\"Grund\",\"mit\",\"Umlaut\",\"ä\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=4",
    "call kontenDb.bannListe",
    "call kontenDb.kontoNachId 2",
    "call kontenDb.kontoNachId 9",
    "bann [\"liste\"] -> {\"ok\":true,\"active\":false,\"message\":\"4 Banns: herkunft 203.0.113.7 (bis 2.10.2026, 14:30:00, Spam Bot); konto gastkonto (dauerhaft, 12x); konto 9 (bis 2.10.2026, 12:31:00); spieler S-Bert (bis 2.10.2026, 14:30:00, Grund mit Umlaut ä)\"} args-after=[\"liste\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=4",
    "call kontenDb.bannListe",
    "call kontenDb.kontoNachId 2",
    "call kontenDb.kontoNachId 9",
    "bann [\"LIST\"] -> {\"ok\":true,\"active\":false,\"message\":\"4 Banns: herkunft 203.0.113.7 (bis 2.10.2026, 14:30:00, Spam Bot); konto gastkonto (dauerhaft, 12x); konto 9 (bis 2.10.2026, 12:31:00); spieler S-Bert (bis 2.10.2026, 14:30:00, Grund mit Umlaut ä)\"} args-after=[\"LIST\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=4",
    "entbann [] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: entbann <Name> | entbann herkunft <Adresse>\"} args-after=[]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=4",
    "entbann [\"herkunft\"] -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: entbann <Name> | entbann herkunft <Adresse>\"} args-after=[\"herkunft\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=4",
    "call kontenDb.bannAufheben \"herkunft\" \"203.0.113.7\"",
    "entbann [\"herkunft\",\"203.0.113.7\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunftsbann auf 203.0.113.7 aufgehoben\"} args-after=[\"herkunft\",\"203.0.113.7\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=3",
    "call kontenDb.bannAufheben \"herkunft\" \"203.0.113.7\"",
    "entbann [\"ip\",\"203.0.113.7\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Herkunftsbann auf 203.0.113.7\"} args-after=[\"ip\",\"203.0.113.7\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=3",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.bannAufheben \"konto\" \"2\"",
    "entbann [\"Gast\"] -> {\"ok\":true,\"active\":false,\"message\":\"Kontobann auf Gast aufgehoben\"} args-after=[\"Gast\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.bannAufheben \"konto\" \"2\"",
    "call spielerIdFuerName \"Gast\"",
    "entbann [\"Gast\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Gast gefunden\"} args-after=[\"Gast\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call kontenDb.charakterNachName \"Doppel\"",
    "call spielerIdFuerName \"Doppel\"",
    "entbann [\"Doppel\"] -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"} args-after=[\"Doppel\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=2",
    "call kontenDb.charakterNachName \"Bert\"",
    "call spielerIdFuerName \"Bert\"",
    "call kontenDb.bannAufheben \"spieler\" \"S-Bert\"",
    "entbann [\"Bert\"] -> {\"ok\":true,\"active\":false,\"message\":\"Spielerbann auf Bert aufgehoben\"} args-after=[\"Bert\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=1",
    "call kontenDb.charakterNachName \"Fremd\"",
    "call kontenDb.bannAufheben \"konto\" \"9\"",
    "entbann [\"Fremd\"] -> {\"ok\":true,\"active\":false,\"message\":\"Kontobann auf Fremd aufgehoben\"} args-after=[\"Fremd\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call kontenDb.charakterNachName \"Gibts\"",
    "call spielerIdFuerName \"Gibts\"",
    "entbann [\"Gibts\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Gibts gefunden\"} args-after=[\"Gibts\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
    "call kontenDb.bannListe",
    "bann [\"liste\"] -> {\"ok\":true,\"active\":false,\"message\":\"Keine wirksamen Banns\"} args-after=[\"liste\"]",
    "rights Boss=A- Anna=-- Carl=-- Dora=-- Ohne=A- Editor=-- Neu=-- list=S-Boss bans=0",
  ],
};
/** The same on a real instance (player ids written as `<name>`). */
const SOLL_BEFEHLE_ECHT: Aufzeichnung = {
  paket: [
    "Editor:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Gast:AdminEvent:[\"adminrechte\",true,\"Du hast jetzt Adminrechte.\",0]:40:75e936abca20fc2b",
    "Gast:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Gast:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
  ],
  aufrufe: {"net.kick": 2, "net.trenneGebannte": 4},
  konsole: {"log": 8, "warn": 0},
  zustand: [1],
  ausnahmen: [],
  notizen: [
    "log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge",
    "log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen",
    "log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen",
    "log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen",
    "registry fly zone teleport spieler dungeon item spawn abbau admin kick bann entbann marke wetter",
    "\"admin\" -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin liste | admin add <Name> | admin remove <Name>\"}",
    "rights Admin=AF Gast=-- Editor=A- list=Admin",
    "\"admin liste\" -> {\"ok\":true,\"active\":false,\"message\":\"1 dauerhafte Admins: Admin [<Admin>]\"}",
    "rights Admin=AF Gast=-- Editor=A- list=Admin",
    "log 65:a26bb210136965ad:[Admin] \"Editor\" — Rechte an der Liste nachgezog",
    "\"admin add Wanderer\" -> {\"ok\":true,\"active\":false,\"message\":\"Wanderer [<Wanderer-w>] ist jetzt dauerhaft Admin\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin,Wanderer",
    "\"admin add Doppel\" -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin,Wanderer",
    "\"admin add Niemand\" -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Niemand\\\" (muss schon einmal verbunden gewesen sein)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin,Wanderer",
    "\"admin list\" -> {\"ok\":true,\"active\":false,\"message\":\"2 dauerhafte Admins: Admin [<Admin>], Wanderer [<Wanderer-w>]\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin,Wanderer",
    "\"admin remove Wanderer\" -> {\"ok\":true,\"active\":false,\"message\":\"Wanderer [<Wanderer-w>] ist kein dauerhafter Admin mehr\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"admin remove Admin\" -> {\"ok\":false,\"active\":false,\"message\":\"Admin ist der letzte Admin. Erst \\\"admin add <Name>\\\" fuer jemand anderen, sonst steht der Server ohne Admin da.\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "log 62:da45e97efa7ab3b9:[Admin] \"Gast\" — Rechte an der Liste nachgezogen",
    "\"admin add gast\" -> {\"ok\":true,\"active\":false,\"message\":\"gast [<Gast>] ist jetzt dauerhaft Admin\"}",
    "rights Admin=AF Gast=A- Editor=-- list=Admin,gast",
    "log 63:9b13dc799a107889:[Admin] \"Gast\" — Rechte an der Liste nachgezogen",
    "\"admin remove Gast\" -> {\"ok\":true,\"active\":false,\"message\":\"Gast [<Gast>] ist kein dauerhafter Admin mehr\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"admin remove Fremd\" -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Fremd\\\"\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"admin quatsch\" -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: admin liste | admin add <Name> | admin remove <Name>\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"kick\" -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: kick <Name>\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"kick admin\" -> {\"ok\":false,\"active\":false,\"message\":\"Dich selbst kannst du nicht werfen\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.kick \"Gast\"",
    "\"kick Gast\" -> {\"ok\":true,\"active\":false,\"message\":\"Gast wurde getrennt (kein Bann — er kann sofort wiederkommen)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.kick \"Niemand\"",
    "\"kick Niemand\" -> {\"ok\":false,\"active\":false,\"message\":\"Niemand ist nicht verbunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann\" -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: bann <Name> [30m|2h|7d|dauerhaft] [Grund] | bann herkunft <Name> ... | bann liste\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann liste\" -> {\"ok\":true,\"active\":false,\"message\":\"Keine wirksamen Banns\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann ADMIN\" -> {\"ok\":false,\"active\":false,\"message\":\"Dich selbst kannst du nicht bannen\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann Zweit 2h\" -> {\"ok\":false,\"active\":false,\"message\":\"Zweit steht auf der Admin-Liste. Erst \\\"admin remove Zweit\\\", dann bannen — sonst sperrt man sich womoeglich den letzten Admin aus.\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.trenneGebannte",
    "\"bann Gast 2h Spam Bot\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 2.10.2026, 14:30:00, Spam Bot)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.trenneGebannte",
    "\"bann herkunft Gast 30m\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von Gast gebannt (bis 2.10.2026, 13:00:00)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann herkunft Editor\" -> {\"ok\":false,\"active\":false,\"message\":\"Editor ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann ip Niemand\" -> {\"ok\":false,\"active\":false,\"message\":\"Niemand ist nicht verbunden — eine Herkunft laesst sich nur an einer offenen Verbindung ablesen\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.trenneGebannte",
    "\"bann Wanderer 7d\" -> {\"ok\":true,\"active\":false,\"message\":\"Wanderer gebannt (bis 9.10.2026, 12:30:00)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann Doppel\" -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann Niemand\" -> {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Spieler: \\\"Niemand\\\" (kein Konto dieses Namens und nie verbunden gewesen)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "call net.trenneGebannte",
    "\"bann Fremd dauerhaft\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Fremd gebannt (dauerhaft)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann liste\" -> {\"ok\":true,\"active\":false,\"message\":\"4 Banns: konto gastkonto (bis 2.10.2026, 14:30:00, Spam Bot); herkunft 198.51.100.4 (bis 2.10.2026, 13:00:00); spieler <Wanderer-w> (bis 9.10.2026, 12:30:00); konto fremdkonto (dauerhaft)\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann\" -> {\"ok\":false,\"active\":false,\"message\":\"Aufruf: entbann <Name> | entbann herkunft <Adresse>\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Gast\" -> {\"ok\":true,\"active\":false,\"message\":\"Kontobann auf Gast aufgehoben\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Gast\" -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Gast gefunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann herkunft 198.51.100.4\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunftsbann auf 198.51.100.4 aufgehoben\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann herkunft 198.51.100.4\" -> {\"ok\":false,\"active\":false,\"message\":\"Kein Herkunftsbann auf 198.51.100.4\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Wanderer\" -> {\"ok\":true,\"active\":false,\"message\":\"Spielerbann auf Wanderer aufgehoben\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Doppel\" -> {\"ok\":false,\"active\":false,\"message\":\"Spieler nicht eindeutig gefunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Fremd\" -> {\"ok\":true,\"active\":false,\"message\":\"Kontobann auf Fremd aufgehoben\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"entbann Niemand\" -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Niemand gefunden\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann liste\" -> {\"ok\":true,\"active\":false,\"message\":\"Keine wirksamen Banns\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "\"bann Gast\" -> {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
    "rights Admin=AF Gast=-- Editor=-- list=Admin",
    "log 63:9b13dc799a107889:[Admin] \"Gast\" — Rechte an der Liste nachgezogen",
    "rights Admin=AF Gast=-- Editor=--",
  ],
};

/** Step 1A after the attack (I11A-B1, B2), measured on `bd94dfc7` before the move (`--messen-basis`). Exception: the 3 `AdminEvent` lines (`adminrechte`, 40/48/48 bytes) were re-measured on c5a9a8c0 + D5 N4 (the live rights packet got its own command name); all other lines are as measured on `bd94dfc7`. */
const SOLL_BEFEHLE_N1_ATTRAPPE: Aufzeichnung = {
  paket: [
    "Anna Maria:AdminEvent:[\"adminrechte\",true,\"Du hast jetzt Adminrechte.\",0]:40:75e936abca20fc2b",
    "Dora:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Anna Maria:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
  ],
  aufrufe: {"adminCommands.register": 4, "net.findPeerByName": 9, "kontenDb.charakterNachName": 9, "kontenDb.charaktereVonKonto": 6, "adminListe.enthaelt": 7, "kontenDb.bannSetzen": 9, "net.trenneGebannte": 9, "net.getPeers": 5, "net.herkunftVon": 3, "kontenDb.bannAufheben": 6, "spielerIdFuerName": 5, "adminListe.hinzufuegen": 1, "gleicheAdminrechteAb": 2, "adminListe.alle": 3, "adminListe.anzahl": 1, "adminListe.entfernen": 1, "kontenDb.bannListe": 1, "kontenDb.kontoNachId": 1},
  konsole: {"log": 3, "warn": 0},
  zustand: [1, 1],
  ausnahmen: [],
  notizen: [
    "call adminCommands.register \"admin\" \"function\"",
    "call adminCommands.register \"kick\" \"function\"",
    "call adminCommands.register \"bann\" \"function\"",
    "call adminCommands.register \"entbann\" \"function\"",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"30min\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"30min\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30min)\"} args-after=[\"30min\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30min",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"x30m\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"x30m\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, x30m)\"} args-after=[\"x30m\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:x30m",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"2hx und mehr\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"2hx\",\"und\",\"mehr\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 2hx und mehr)\"} args-after=[\"2hx\",\"und\",\"mehr\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:2hx und mehr",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"30min\",\"gesetztVon\":\"Boss\",\"bis\":1790938800000}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"30m\",\"30min\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (bis 2.10.2026, 13:00:00, 30min)\"} args-after=[\"30min\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:1790938800000:30min",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"30 Tage\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"30\",\"Tage\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30 Tage)\"} args-after=[\"30\",\"Tage\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30 Tage",
    "call net.findPeerByName \"Gast\"",
    "call kontenDb.charakterNachName \"Gast\"",
    "call kontenDb.charaktereVonKonto 2",
    "call adminListe.enthaelt \"S-Gast\"",
    "call kontenDb.bannSetzen \"konto\" \"2\" {\"grund\":\"30\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"Gast\",\"30\"] -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30)\"} args-after=[\"30\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30",
    "call net.findPeerByName \"anna\"",
    "call net.getPeers",
    "call net.herkunftVon \"Anna\"",
    "call kontenDb.bannSetzen \"herkunft\" \"203.0.113.7\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":1790940600000}",
    "call net.trenneGebannte",
    "bann [\"herkunft\",\"anna\",\"1h\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von anna gebannt (bis 2.10.2026, 13:30:00)\"} args-after=[\"herkunft\",\"anna\",\"1h\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30|herkunft:203.0.113.7:1790940600000:",
    "call net.findPeerByName \"ANNA\"",
    "call net.getPeers",
    "call net.herkunftVon \"Anna\"",
    "call kontenDb.bannSetzen \"herkunft\" \"203.0.113.7\" {\"grund\":\"\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"HERKUNFT\",\"ANNA\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von ANNA gebannt (dauerhaft)\"} args-after=[\"HERKUNFT\",\"ANNA\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30|herkunft:203.0.113.7:-:",
    "call net.findPeerByName \"Anna\"",
    "call net.getPeers",
    "call net.herkunftVon \"Anna\"",
    "call kontenDb.bannSetzen \"herkunft\" \"203.0.113.7\" {\"grund\":\"Maria\",\"gesetztVon\":\"Boss\",\"bis\":null}",
    "call net.trenneGebannte",
    "bann [\"herkunft\",\"Anna\",\"Maria\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von Anna gebannt (dauerhaft, Maria)\"} args-after=[\"herkunft\",\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30|herkunft:203.0.113.7:-:Maria",
    "call kontenDb.bannAufheben \"herkunft\" \"203.0.113.7\"",
    "entbann [\"IP\",\"203.0.113.7\"] -> {\"ok\":true,\"active\":false,\"message\":\"Herkunftsbann auf 203.0.113.7 aufgehoben\"} args-after=[\"IP\",\"203.0.113.7\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30",
    "call kontenDb.bannAufheben \"herkunft\" \"203.0.113.7\"",
    "entbann [\"Herkunft\",\"203.0.113.7\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Herkunftsbann auf 203.0.113.7\"} args-after=[\"Herkunft\",\"203.0.113.7\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30",
    "call kontenDb.bannAufheben \"herkunft\" \"203.0.113.7\"",
    "entbann [\"HERKUNFT\",\"203.0.113.7\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Herkunftsbann auf 203.0.113.7\"} args-after=[\"HERKUNFT\",\"203.0.113.7\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=A- list=S-Boss bans=konto:2:-:30",
    "call spielerIdFuerName \"Anna Maria\"",
    "call adminListe.hinzufuegen \"S-AnnaMaria\" \"Anna Maria\"",
    "call gleicheAdminrechteAb",
    "call adminListe.alle",
    "call net.getPeers",
    "log 68:544fe8cec7310559:[Admin] \"Anna Maria\" — Rechte an der Liste nachg",
    "log 63:0c761ba5779e1aa8:[Admin] \"Dora\" — Rechte an der Liste nachgezogen",
    "admin [\"add\",\"Anna\",\"Maria\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna Maria [S-AnnaMaria] ist jetzt dauerhaft Admin\"} args-after=[\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Anna Maria=A- Dora=-- list=S-Boss,S-AnnaMaria bans=konto:2:-:30",
    "call adminListe.alle",
    "admin [\"list\"] -> {\"ok\":true,\"active\":false,\"message\":\"2 dauerhafte Admins: Boss [S-Boss], Anna Maria [S-AnnaMaria]\"} args-after=[]",
    "rights Boss=A- Anna=-- Anna Maria=A- Dora=-- list=S-Boss,S-AnnaMaria bans=konto:2:-:30",
    "call spielerIdFuerName \"Anna Maria\"",
    "call adminListe.enthaelt \"S-AnnaMaria\"",
    "call adminListe.anzahl",
    "call adminListe.entfernen \"S-AnnaMaria\"",
    "call gleicheAdminrechteAb",
    "call adminListe.alle",
    "call net.getPeers",
    "log 69:697d434d9d0df4a5:[Admin] \"Anna Maria\" — Rechte an der Liste nachg",
    "admin [\"remove\",\"Anna\",\"Maria\"] -> {\"ok\":true,\"active\":false,\"message\":\"Anna Maria [S-AnnaMaria] ist kein dauerhafter Admin mehr\"} args-after=[\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=-- list=S-Boss bans=konto:2:-:30",
    "call kontenDb.charakterNachName \"Anna Maria\"",
    "call spielerIdFuerName \"Anna Maria\"",
    "call kontenDb.bannAufheben \"spieler\" \"S-AnnaMaria\"",
    "entbann [\"Anna\",\"Maria\"] -> {\"ok\":true,\"active\":false,\"message\":\"Spielerbann auf Anna Maria aufgehoben\"} args-after=[\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=-- list=S-Boss bans=konto:2:-:30|spieler:S-Anna:-:ein Wort",
    "call kontenDb.charakterNachName \"Anna Maria\"",
    "call spielerIdFuerName \"Anna Maria\"",
    "call kontenDb.bannAufheben \"spieler\" \"S-AnnaMaria\"",
    "entbann [\"Anna\",\"Maria\"] -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Anna Maria gefunden\"} args-after=[\"Anna\",\"Maria\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=-- list=S-Boss bans=konto:2:-:30|spieler:S-Anna:-:ein Wort",
    "call kontenDb.charakterNachName \"Anna\"",
    "call spielerIdFuerName \"Anna\"",
    "call kontenDb.bannAufheben \"spieler\" \"S-Anna\"",
    "entbann [\"  Anna \",\" \"] -> {\"ok\":true,\"active\":false,\"message\":\"Spielerbann auf Anna aufgehoben\"} args-after=[\"  Anna \",\" \"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=-- list=S-Boss bans=konto:2:-:30",
    "call kontenDb.bannListe",
    "call kontenDb.kontoNachId 2",
    "bann [\"liste\"] -> {\"ok\":true,\"active\":false,\"message\":\"1 Banns: konto gastkonto (dauerhaft, 30)\"} args-after=[\"liste\"]",
    "rights Boss=A- Anna=-- Anna Maria=-- Dora=-- list=S-Boss bans=konto:2:-:30",
  ],
};
const SOLL_BEFEHLE_N1_ECHT: Aufzeichnung = {
  paket: [],
  aufrufe: {"net.trenneGebannte": 8},
  konsole: {"log": 4, "warn": 0},
  zustand: [],
  ausnahmen: [],
  notizen: [
    "log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge",
    "log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen",
    "log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen",
    "log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen",
    "call net.trenneGebannte",
    "\"bann Gast 30min\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30min)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30min",
    "call net.trenneGebannte",
    "\"bann Gast x30m\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, x30m)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:x30m",
    "call net.trenneGebannte",
    "\"bann Gast 2hx Rest\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 2hx Rest)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:2hx Rest",
    "call net.trenneGebannte",
    "\"bann Gast 30 Tage\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30 Tage)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30 Tage",
    "call net.trenneGebannte",
    "\"bann Gast 30\" -> {\"ok\":true,\"active\":false,\"message\":\"Konto von Gast gebannt (dauerhaft, 30)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30",
    "call net.trenneGebannte",
    "\"bann herkunft gast 1h\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von gast gebannt (bis 2.10.2026, 13:30:00)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30|herkunft:198.51.100.4:1790940600000:",
    "call net.trenneGebannte",
    "\"bann HERKUNFT GAST\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von GAST gebannt (dauerhaft)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30|herkunft:198.51.100.4:-:",
    "\"entbann IP 198.51.100.4\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunftsbann auf 198.51.100.4 aufgehoben\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30",
    "call net.trenneGebannte",
    "\"bann herkunft Gast\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunft von Gast gebannt (dauerhaft)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30|herkunft:198.51.100.4:-:",
    "\"entbann Herkunft 198.51.100.4\" -> {\"ok\":true,\"active\":false,\"message\":\"Herkunftsbann auf 198.51.100.4 aufgehoben\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30",
    "\"admin add Anna Maria\" -> {\"ok\":true,\"active\":false,\"message\":\"Anna Maria [<Anna Maria>] ist jetzt dauerhaft Admin\"}",
    "rights Admin=A- Gast=-- list=Admin,Anna Maria bans=konto:2:-:30",
    "\"admin list\" -> {\"ok\":true,\"active\":false,\"message\":\"2 dauerhafte Admins: Admin [<Admin>], Anna Maria [<Anna Maria>]\"}",
    "rights Admin=A- Gast=-- list=Admin,Anna Maria bans=konto:2:-:30",
    "\"admin remove Anna Maria\" -> {\"ok\":true,\"active\":false,\"message\":\"Anna Maria [<Anna Maria>] ist kein dauerhafter Admin mehr\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30",
    "\"entbann Anna Maria\" -> {\"ok\":true,\"active\":false,\"message\":\"Spielerbann auf Anna Maria aufgehoben\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30|spieler:<Anna>:-:ein Wort",
    "\"entbann Anna Maria\" -> {\"ok\":false,\"active\":false,\"message\":\"Kein Bann auf Anna Maria gefunden\"}",
    "rights Admin=A- Gast=-- list=Admin bans=konto:2:-:30|spieler:<Anna>:-:ein Wort",
    "\"entbann Gast\" -> {\"ok\":true,\"active\":false,\"message\":\"Kontobann auf Gast aufgehoben\"}",
    "rights Admin=A- Gast=-- list=Admin bans=spieler:<Anna>:-:ein Wort",
    "\"bann liste\" -> {\"ok\":true,\"active\":false,\"message\":\"1 Banns: spieler <Anna> (dauerhaft, ein Wort)\"}",
    "rights Admin=A- Gast=-- list=Admin bans=spieler:<Anna>:-:ein Wort",
  ],
};
const SOLL_TAKT_1A: Aufzeichnung = {
  paket: [
    "Takt:TimeSync:[]:20:f05060fd930e0712",
    "Takt:TimeSync:[]:20:f05060fd930e0712",
    "Takt:AdminEvent:[\"adminrechte\",true,\"Du hast jetzt Adminrechte.\",0]:40:75e936abca20fc2b",
    "Takt:TimeSync:[]:20:f05060fd930e0712",
    "Takt:AdminEvent:[\"fly\",false,\"Fly mode OFF (Adminrechte entzogen)\",0]:41:009857b1146c12c7",
    "Takt:AdminEvent:[\"adminrechte\",false,\"Deine Adminrechte wurden entzogen.\",0]:48:f0f41edb0def5621",
    "Takt:TimeSync:[]:20:f05060fd930e0712",
    "TaktE:TimeSync:[]:20:f05060fd930e0712",
    "TaktE:TimeSync:[]:20:f05060fd930e0712",
    "TaktE:TimeSync:[]:20:f05060fd930e0712",
    "TaktE:TimeSync:[]:20:f05060fd930e0712",
  ],
  aufrufe: {"gleicheAdminrechteAb": 6},
  konsole: {"log": 10, "warn": 0},
  zustand: [],
  ausnahmen: [],
  notizen: [
    "everyoneAdmin=false registry fly zone teleport spieler dungeon item spawn abbau admin kick bann entbann marke wetter",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=false takt akk=1000 -> akk=0 calls=1",
    "everyoneAdmin=false takt akk=999 -> akk=999 calls=1",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=false takt akk=1000 -> akk=0 calls=2",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=false takt akk=2500 -> akk=1500 calls=3",
    "everyoneAdmin=false takt akk=0 -> akk=0 calls=3",
    "everyoneAdmin=false wirkung nichts geaendert: Takt=--",
    "everyoneAdmin=false wirkung von aussen eingetragen: Takt=A-",
    "everyoneAdmin=false wirkung von aussen entfernt, fliegend: Takt=--",
    "everyoneAdmin=false wirkung noch eine Sekunde: Takt=--",
    "everyoneAdmin=true registry fly zone teleport spieler dungeon item spawn abbau admin kick bann entbann marke wetter",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=true takt akk=1000 -> akk=0 calls=4",
    "everyoneAdmin=true takt akk=999 -> akk=999 calls=4",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=true takt akk=1000 -> akk=0 calls=5",
    "call gleicheAdminrechteAb this=true args=0",
    "everyoneAdmin=true takt akk=2500 -> akk=1500 calls=6",
    "everyoneAdmin=true takt akk=0 -> akk=0 calls=6",
    "everyoneAdmin=true wirkung nichts geaendert: TaktE=--",
    "everyoneAdmin=true wirkung von aussen eingetragen: TaktE=--",
    "everyoneAdmin=true wirkung von aussen entfernt, fliegend: TaktE=-F",
    "everyoneAdmin=true wirkung noch eine Sekunde: TaktE=-F",
  ],
};

/** Step 1, package B, measured on the stand before the move: the commands on a stand-in and on a real instance. */
const SOLL_BEFEHLE_1B_ATTRAPPE: Aufzeichnung = {
  paket: [],
  aufrufe: {"k.adminCommands": 65, "k.weltMarken": 11, "k.wetterDienst": 13, "wetterDienst": 10, "k.prefabs": 39, "prefabs.getByName": 29, "prefabs.getAll": 6, "k.zdosVon": 36, "zdosVon": 32, "getZDOsInRadius": 12, "destroyZDO": 8, "k.getGroundHeight": 15, "getGroundHeight": 13, "createZDO": 12, "k.inventarSync": 27, "inventarSync": 23, "k.speichertGerade": 37, "k.net": 33, "net.getPeers": 31, "k.savedPlayers": 33, "k.sichereSpielerSofort": 13, "sichereSpielerSofort": 11, "k.saveWorldAsync": 19, "saveWorldAsync": 16, "k.stempelZaehler": 8, "stempelZaehler": 6, "stempel.naechster": 6, "k.spielerSicherung": 7, "spielerSicherung.sichere": 4, "NEW wetterDienst": 2, "NEW setze": 1, "NEW prefabs.getByName": 2, "NEW zdosVon": 2, "NEW getGroundHeight": 1, "NEW inventarSync": 2, "NEW net.getPeers": 2, "NEW stempelZaehler": 1, "NEW sichere": 1, "NEW saveWorldAsync": 2, "NEW sichereSpielerSofort": 1},
  konsole: {"log": 0, "warn": 0},
  zustand: [0, 7, 7],
  ausnahmen: ["TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError"],
  notizen: [
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  commands fly,zone,teleport,marke,wetter,abbau,item,spawn",
    "> marke (Admin)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> marke liste (Admin)",
    "= ok: Keine Marke gesetzt",
    "> marke LIST (Admin)",
    "= ok: Keine Marke gesetzt",
    "> marke setzen (Admin)",
    "= refused: Aufruf: marke setzen <Name>",
    "> marke setzen Unsinn (Admin)",
    "= refused: Unbekannte Marke: \"Unsinn\"",
    "> marke setzen defeated_eikthyr (Admin)",
    "= ok: Marke \"defeated_eikthyr\" gesetzt",
    "> marke set Defeated_Eikthyr (Admin)",
    "= ok: Marke \"defeated_eikthyr\" war schon gesetzt",
    "> marke setzen DEFEATED_DRAGON (Admin)",
    "= ok: Marke \"defeated_dragon\" gesetzt",
    "> marke liste (Admin)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke xyz (Admin)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> MARKE liste (Admin)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke liste (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "> wetter (Admin)",
    "  wetterDienst 0",
    "= ok: Kein Wetter gesetzt (Server würfelt). Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter Clear (Admin)",
    "  wetterDienst 0",
    "= ok: Wetter überall: Clear",
    "> wetter DEEPFOREST MIST (Admin)",
    "  wetterDienst 0",
    "= refused: Unbekanntes Biom: \"MIST\"",
    "> wetter Clear unbekanntbiom (Admin)",
    "  wetterDienst 0",
    "= refused: Unbekanntes Biom: \"unbekanntbiom\"",
    "> wetter Clear meadows (Admin)",
    "  wetterDienst 0",
    "= ok: Wetter Meadows: Clear",
    "> wetter (Admin)",
    "  wetterDienst 0",
    "= ok: Gesetzt: überall: Clear, Meadows: Clear. Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter auto (Admin)",
    "  wetterDienst 0",
    "= ok: Wetter überall: automatisch (Server würfelt)",
    "> wetter AUTO blackforest (Admin)",
    "  wetterDienst 0",
    "= ok: Wetter BlackForest: automatisch (Server würfelt)",
    "> wetter Unsinn (Admin)",
    "  wetterDienst 0",
    "= refused: Unbekannter Zustand: \"Unsinn\". Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter (Admin)",
    "  wetterDienst 0",
    "= ok: Gesetzt: Meadows: Clear. Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter auto (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "> abbau (Admin)",
    "= refused: Aufruf: abbau <prefab> [radius]",
    "> abbau Unbekannt (Admin)",
    "  prefabs.getByName \"Unbekannt\"",
    "  prefabs.getAll",
    "= refused: Unbekanntes Prefab: Unbekannt",
    "> abbau Beech1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "  zdosVon Admin@haupt",
    "  destroyZDO 1",
    "  zdosVon Admin@haupt",
    "  destroyZDO 3",
    "  zdosVon Admin@haupt",
    "  destroyZDO 5",
    "= ok: 3× Beech1 im Umkreis von 10 m entfernt",
    "> abbau beech1 5 (Admin)",
    "  prefabs.getByName \"beech1\"",
    "  prefabs.getAll",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 5",
    "= ok: 0× Beech1 im Umkreis von 5 m entfernt",
    "> abbau BEECH1 abc (Admin)",
    "  prefabs.getByName \"BEECH1\"",
    "  prefabs.getAll",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "= ok: 0× Beech1 im Umkreis von 10 m entfernt",
    "> abbau Beech1 5000 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 200",
    "= ok: 0× Beech1 im Umkreis von 200 m entfernt",
    "> abbau Beech1 0 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "= ok: 0× Beech1 im Umkreis von 10 m entfernt",
    "> abbau NPC_1 -3 (Admin)",
    "  prefabs.getByName \"NPC_1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 1",
    "  zdosVon Admin@haupt",
    "  destroyZDO 2",
    "= ok: 1× NPC_1 im Umkreis von 1 m entfernt",
    "> abbau stein 1e3 (Admin)",
    "  prefabs.getByName \"stein\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 200",
    "  zdosVon Admin@haupt",
    "  destroyZDO 4",
    "= ok: 1× stein im Umkreis von 200 m entfernt",
    "> abbau Stein (Admin)",
    "  prefabs.getByName \"Stein\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "= ok: 0× Stein im Umkreis von 10 m entfernt",
    "> abbau Beech1 (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "> spawn (Admin)",
    "= refused: Aufruf: spawn <prefab> [x z]",
    "> spawn Unbekannt (Admin)",
    "  prefabs.getByName \"Unbekannt\"",
    "  prefabs.getAll",
    "= refused: Unbekanntes Prefab: Unbekannt",
    "> spawn Beech1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 12.0, -2.0 (Höhe 8.0)",
    "> spawn beech1 10 20 (Admin)",
    "  prefabs.getByName \"beech1\"",
    "  prefabs.getAll",
    "  getGroundHeight 10 20",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":10,\"y\":-15,\"z\":20}",
    "  rotation {\"x\":0,\"y\":1,\"z\":0,\"w\":6.123233995736766e-17}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 10.0, 20.0 (Höhe -15.0)",
    "> spawn Beech1 10 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 12.0, -2.0 (Höhe 8.0)",
    "> spawn Beech1 x y (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 12.0, -2.0 (Höhe 8.0)",
    "> spawn NPC_1 (Admin)",
    "  prefabs.getByName \"NPC_1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 202 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent NPC_1",
    "= ok: NPC_1 gespawnt bei 12.0, -2.0 (Höhe 8.0) — NICHT persistent",
    "> spawn Beech1 -5.25 3.5 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight -5.25 3.5",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":-5.25,\"y\":-6.125,\"z\":3.5}",
    "  rotation {\"x\":0,\"y\":0.8489168556075256,\"z\":0,\"w\":0.5285264158634189}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei -5.3, 3.5 (Höhe -6.1)",
    "> spawn STEIN 0 0 (Admin)",
    "  prefabs.getByName \"STEIN\"",
    "  prefabs.getAll",
    "  getGroundHeight 0 0",
    "  zdosVon Admin@haupt",
    "  createZDO 303 {\"x\":0,\"y\":0,\"z\":0}",
    "  rotation {\"x\":0,\"y\":0.8280672304692729,\"z\":0,\"w\":0.5606288093051837}",
    "  isPersistent stein",
    "= ok: stein gespawnt bei 0.0, 0.0 (Höhe 0.0)",
    "> spawn Beech1 Infinity 1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 12.0, -2.0 (Höhe 8.0)",
    "> spawn Beech1 (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "> item (Admin)",
    "= refused: Aufruf: item give <Name> [Anzahl]",
    "> item xyz (Admin)",
    "= refused: Aufruf: item give <Name> [Anzahl]",
    "> item give (Admin)",
    "= refused: Aufruf: item give <Name> [Anzahl]",
    "> item give Unbekannt (Admin)",
    "= refused: Unbekannter Gegenstand: Unbekannt",
    "> item give Hammer (Admin)",
    "  inventarSync Admin [Hammerx1]",
    "= ok: 1× Hammer ins Inventar gelegt",
    "> item gib Hammer 3 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 3× Hammer ins Inventar gelegt",
    "> item give hammer abc (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 1× Hammer ins Inventar gelegt",
    "> item give Hammer 0 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 1× Hammer ins Inventar gelegt",
    "> item give Hammer 2.7 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item GIVE Hammer -4 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 1× Hammer ins Inventar gelegt",
    "> item give Hammer (Voll)",
    "  inventarSync Voll [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= refused: Kein Platz im Inventar für Hammer",
    "> item give Hammer 9999 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 23× Hammer ins Inventar gelegt (9976 passten nicht)",
    "> item give Hammer (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "  saved ",
    "  peers Admin[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "  markers defeated_dragon,defeated_eikthyr",
    "> item ironward Gast (Admin)",
    "= refused: Sicherung läuft; bitte gleich erneut versuchen. Nichts verändert.",
    "> item ironward (Admin)",
    "= refused: Aufruf: item ironward <Spielername>",
    "> item ironward    (Admin)",
    "= refused: Aufruf: item ironward <Spielername>",
    "> item ironward Niemand (Admin)",
    "  net.getPeers Admin",
    "= refused: Spieler nicht eindeutig gefunden",
    "> item ironward Ziel Eins (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins",
    "  inventarSync Ziel Eins [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Ziel Eins|admin",
    "  saveWorldAsync 0",
    "= ok: Ziel Eins: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item IRONWARD ziel eins (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins",
    "  inventarSync Ziel Eins [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Ziel Eins|admin",
    "  saveWorldAsync 0",
    "= ok: ziel eins: Ironward vollständig (7/7), 0 neue Gegenstände. Sicherung angefordert.",
    "> item wildwarden Ziel Eins (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins",
    "  inventarSync Ziel Eins [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1]",
    "  sichereSpielerSofort 2|Ziel Eins|admin",
    "  saveWorldAsync 0",
    "= ok: Ziel Eins: Waldhüter vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Frau (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau",
    "= refused: Ironward benötigt den männlichen Wikinger-Körper",
    "> item ironward Doppelt (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt",
    "= refused: Spieler nicht eindeutig gefunden",
    "> item ironward VollOnline (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "  saved ",
    "  peers Admin[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] Ziel Eins[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] Ziel Eins[] Frau[] Doppelt[] doppelt[] VollOnline[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "  markers defeated_dragon,defeated_eikthyr",
    "> item ironward Weg (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "  stempelZaehler",
    "  stempel.naechster",
    "  spielerSicherung.sichere Weg@1001[Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] admin",
    "  saveWorldAsync 0",
    "= ok: Weg: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Weg (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "  stempelZaehler",
    "  stempel.naechster",
    "  spielerSicherung.sichere Weg@1002[Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] admin",
    "  saveWorldAsync 0",
    "= ok: Weg: Ironward vollständig (7/7), 0 neue Gegenstände. Sicherung angefordert.",
    "> item wildwarden weg (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "  stempelZaehler",
    "  stempel.naechster",
    "  saveWorldAsync 0",
    "= ok: weg: Waldhüter vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Ohne (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "= refused: Kein gespeichertes Inventar vorhanden",
    "> item ironward FrauWeg (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "= refused: Ironward benötigt den männlichen Wikinger-Körper",
    "> item ironward VollWeg (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "> item ironward Zwilling (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "= refused: Spieler nicht eindeutig gefunden",
    "> item wildwarden Ziel Eins (Admin)",
    "  net.getPeers Admin,Ziel Eins,Ziel Eins,Frau,Doppelt,doppelt,VollOnline",
    "  inventarSync Ziel Eins [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1]",
    "  sichereSpielerSofort 2|Ziel Eins|admin",
    "  saveWorldAsync 0",
    "= ok: Ziel Eins: Waldhüter vollständig (7/7), 0 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Weg (Gast, no admin)",
    "= refused: Admin commands are not allowed for this player",
    "  saved id-weg:Weg@1003[Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] id-ohne:Ohne@undefined[-] id-frau:FrauWeg@undefined[] id-voll:VollWeg@undefined[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] id-z1:Zwilling@undefined[] id-z2:zwilling@undefined[] id-ziel:Ziel Eins@undefined[]",
    "  peers Admin[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] Ziel Eins[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] Ziel Eins[] Frau[] Doppelt[] doppelt[] VollOnline[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "  markers defeated_dragon,defeated_eikthyr",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "> item ironward Teil (Admin)",
    "  net.getPeers Admin,Teil",
    "  inventarSync Teil [IronwardLeggingsx1,IronwardHelmetx1,IronwardCuirassx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Teil|admin",
    "  saveWorldAsync 0",
    "= ok: Teil: Ironward vollständig (7/7), 6 neue Gegenstände. Sicherung angefordert.",
    "  peer \"Teil\" 7/7 ironward, 0/7 wildwarden [IronwardLeggingsx1,IronwardHelmetx1,IronwardCuirassx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "> item wildwarden TeilWeg (Admin)",
    "  net.getPeers Admin,Teil",
    "  stempelZaehler",
    "  stempel.naechster",
    "  spielerSicherung.sichere TeilWeg@1001[wildwarden_mantlex1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] admin",
    "  saveWorldAsync 0",
    "= ok: TeilWeg: Waldhüter vollständig (7/7), 6 neue Gegenstände. Sicherung angefordert.",
    "  absent id-teil 0/7 ironward, 7/7 wildwarden @1001 [wildwarden_mantlex1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1]",
    "> item ironward Fast (Admin)",
    "  net.getPeers Admin,Teil,Fast",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "  peer \"Fast\" 0/7 ironward, 0/7 wildwarden [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "> item wildwarden FastWeg (Admin)",
    "  net.getPeers Admin,Teil,Fast",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "  absent id-fast 0/7 ironward, 0/7 wildwarden @4 [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "> item ironward Knapp (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp",
    "  inventarSync Knapp [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Knapp|admin",
    "  saveWorldAsync 0",
    "= ok: Knapp: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  peer \"Knapp\" 7/7 ironward, 0/7 wildwarden [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "> item ironward Drei (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei",
    "  inventarSync Drei [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Drei|admin",
    "  saveWorldAsync 0",
    "= ok: Drei: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  peer \"Drei\" 7/7 ironward, 0/7 wildwarden [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  absent id-d1 0/7 ironward, 0/7 wildwarden @undefined []",
    "  absent id-d2 0/7 ironward, 0/7 wildwarden @undefined []",
    "> item ironward OhneFigur (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei,OhneFigur,KeineFigur",
    "= refused: Ironward benötigt den männlichen Wikinger-Körper",
    "> item ironward KeineFigur (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei,OhneFigur,KeineFigur",
    "  inventarSync KeineFigur [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|KeineFigur|admin",
    "  saveWorldAsync 0",
    "= ok: KeineFigur: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  absent id-of 0/7 ironward, 0/7 wildwarden @undefined []",
    "  absent id-kf 0/7 ironward, 0/7 wildwarden @undefined []",
    "> item ironward Ägir (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei,OhneFigur,KeineFigur,Ägir",
    "  inventarSync Ägir [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Ägir|admin",
    "  saveWorldAsync 0",
    "= ok: Ägir: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  peer \"Ägir\" 7/7 ironward, 0/7 wildwarden [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "> item ironward Rand (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei,OhneFigur,KeineFigur,Ägir,  Rand ",
    "  inventarSync   Rand  [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|  Rand |admin",
    "  saveWorldAsync 0",
    "= ok: Rand: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  peer \"  Rand \" 7/7 ironward, 0/7 wildwarden [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "> item wildwarden ÖDIN (Admin)",
    "  net.getPeers Admin,Teil,Fast,Knapp,Drei,OhneFigur,KeineFigur,Ägir,  Rand ",
    "  stempelZaehler",
    "  stempel.naechster",
    "  spielerSicherung.sichere   Ödin @1002[wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] admin",
    "  saveWorldAsync 0",
    "= ok: ÖDIN: Waldhüter vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  absent id-nfd 0/7 ironward, 7/7 wildwarden @1002 [wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1]",
    "> item give Hammer 2 extra (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item give Hammer 1e1 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 10× Hammer ins Inventar gelegt",
    "> item give Hammer 0x10 (Admin)",
    "  inventarSync Admin [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 16× Hammer ins Inventar gelegt",
    "> marke setzen defeated_eikthyr extra (Admin)",
    "= ok: Marke \"defeated_eikthyr\" gesetzt",
    "> abbau Beech1 5m (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "  zdosVon Admin@haupt",
    "  destroyZDO 1",
    "  zdosVon Admin@haupt",
    "  destroyZDO 3",
    "  zdosVon Admin@haupt",
    "  destroyZDO 5",
    "= ok: 3× Beech1 im Umkreis von 10 m entfernt",
    "> abbau Beech1 0x10 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 16",
    "= ok: 0× Beech1 im Umkreis von 16 m entfernt",
    "> abbau Beech1 1e1 extra (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Admin@haupt",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "= ok: 0× Beech1 im Umkreis von 10 m entfernt",
    "> spawn Beech1 12abc 5 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":12,\"y\":8,\"z\":-2}",
    "  rotation {\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 12.0, -2.0 (Höhe 8.0)",
    "> spawn Beech1 0x10 010 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 16 10",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":16,\"y\":-2,\"z\":10}",
    "  rotation {\"x\":0,\"y\":-0.9795777228015289,\"z\":0,\"w\":0.2010658722681974}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 16.0, 10.0 (Höhe -2.0)",
    "> spawn Beech1 1 2 extra (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 1 2",
    "  zdosVon Admin@haupt",
    "  createZDO 101 {\"x\":1,\"y\":-1.5,\"z\":2}",
    "  rotation {\"x\":0,\"y\":0.8816745987679437,\"z\":0,\"w\":0.47185792553202427}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 1.0, 2.0 (Höhe -1.5)",
    "  peer \"Admin\" 0/7 ironward, 0/7 wildwarden [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "> spawn Beech1 1 2 (Dungeon)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 1 2",
    "  zdosVon Dungeon@dungeon:7",
    "  createZDO 101 {\"x\":1,\"y\":-1.5,\"z\":2}",
    "  rotation {\"x\":0,\"y\":0.8816745987679437,\"z\":0,\"w\":0.47185792553202427}",
    "  isPersistent Beech1",
    "= ok: Beech1 gespawnt bei 1.0, 2.0 (Höhe -1.5)",
    "> abbau Beech1 (Dungeon)",
    "  prefabs.getByName \"Beech1\"",
    "  zdosVon Dungeon@dungeon:7",
    "  getZDOsInRadius {\"x\":10,\"y\":3,\"z\":-4} 10",
    "= ok: 0× Beech1 im Umkreis von 10 m entfernt",
    "  saved id-teil:TeilWeg@1001[wildwarden_mantlex1,wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] id-fast:FastWeg@4[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] id-d1:Drei@undefined[] id-d2:drei@undefined[] id-of:OhneFigur@undefined[] id-kf:KeineFigur@undefined[] id-nfd:  Ödin @1002[wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1]",
    "  peers Admin[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] Teil[IronwardLeggingsx1,IronwardHelmetx1,IronwardCuirassx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] Fast[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1] Knapp[Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] Drei[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] OhneFigur[] KeineFigur[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1] Ägir[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]   Rand [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  markers defeated_eikthyr",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "> marke setzen defeated_eikthyr (Admin)",
    "= ok: Marke \"defeated_eikthyr\" gesetzt",
    "> marke liste (Admin)",
    "= ok: 1 gesetzte Marke(n): defeated_eikthyr",
    "> wetter a_b (Admin)",
    "  NEW wetterDienst",
    "  NEW setze A b undefined",
    "= ok: Wetter überall: A b",
    "> wetter (Admin)",
    "  NEW wetterDienst",
    "= ok: Kein Wetter gesetzt (Server würfelt). Aufruf: wetter <Zustand|auto> [Biom] — Zustände: A_b",
    "> abbau Neu (Admin)",
    "  NEW prefabs.getByName Neu",
    "  NEW zdosVon",
    "= ok: 0× Neu im Umkreis von 10 m entfernt",
    "> spawn Neu 1 2 (Admin)",
    "  NEW prefabs.getByName Neu",
    "  NEW getGroundHeight",
    "  NEW zdosVon",
    "  isPersistent Neu",
    "= ok: Neu gespawnt bei 1.0, 2.0 (Höhe 42.0)",
    "> item give Hammer (Admin)",
    "  NEW inventarSync Admin",
    "= ok: 1× Hammer ins Inventar gelegt",
    "> item ironward Ersatz (Admin)",
    "  NEW net.getPeers",
    "  NEW stempelZaehler",
    "  NEW sichere Ersatz admin",
    "  NEW saveWorldAsync",
    "= ok: Ersatz: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Admin (Admin)",
    "  NEW net.getPeers",
    "  NEW inventarSync Admin",
    "  NEW sichereSpielerSofort Admin admin",
    "  NEW saveWorldAsync",
    "= ok: Admin: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Ersatz (Admin)",
    "= refused: Sicherung läuft; bitte gleich erneut versuchen. Nichts verändert.",
    "  saved id-x:Ersatz@5[IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  peers Admin[Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  markers defeated_eikthyr",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without weltMarken",
    "> marke liste (Admin)",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without wetterDienst",
    "> wetter (Admin)",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without prefabs",
    "> abbau Beech1 (Admin)",
    "= throws TypeError",
    "> spawn Beech1 (Admin)",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without zdosVon",
    "> abbau Beech1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "= throws TypeError",
    "> spawn Beech1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "  getGroundHeight 12 -2",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without getGroundHeight",
    "> spawn Beech1 (Admin)",
    "  prefabs.getByName \"Beech1\"",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without inventarSync",
    "> item give Hammer (Admin)",
    "= throws TypeError",
    "> item ironward Admin (Admin)",
    "  net.getPeers Admin",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without sichereSpielerSofort",
    "> item ironward Admin (Admin)",
    "  net.getPeers Admin",
    "  inventarSync Admin [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without saveWorldAsync",
    "> item ironward Admin (Admin)",
    "  net.getPeers Admin",
    "  inventarSync Admin [IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort 2|Admin|admin",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without stempelZaehler",
    "> item ironward Weg (Admin)",
    "  net.getPeers Admin",
    "= throws TypeError",
    "  register marke",
    "  register wetter",
    "  register abbau",
    "  register item",
    "  register spawn",
    "  without spielerSicherung",
    "> item ironward Weg (Admin)",
    "  net.getPeers Admin",
    "  stempelZaehler",
    "  stempel.naechster",
    "  saveWorldAsync 0",
    "= ok: Weg: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
  ],
};
const SOLL_BEFEHLE_1B_ECHT: Aufzeichnung = {
  paket: [],
  aufrufe: {"getGroundHeight": 12, "inventarSync": 10, "sichereSpielerSofort": 4, "saveWorldAsync": 6},
  konsole: {"log": 4, "warn": 0},
  zustand: [0, 0],
  ausnahmen: [],
  notizen: [
    "log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge",
    "log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen",
    "log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen",
    "log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen",
    "  commands fly,zone,teleport,spieler,dungeon,item,spawn,abbau,admin,kick,bann,entbann,marke,wetter",
    "> marke (Echt)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> marke liste (Echt)",
    "= ok: Keine Marke gesetzt",
    "> marke LIST (Echt)",
    "= ok: Keine Marke gesetzt",
    "> marke setzen (Echt)",
    "= refused: Aufruf: marke setzen <Name>",
    "> marke setzen Unsinn (Echt)",
    "= refused: Unbekannte Marke: \"Unsinn\"",
    "> marke setzen defeated_eikthyr (Echt)",
    "= ok: Marke \"defeated_eikthyr\" gesetzt",
    "> marke set Defeated_Eikthyr (Echt)",
    "= ok: Marke \"defeated_eikthyr\" war schon gesetzt",
    "> marke setzen DEFEATED_DRAGON (Echt)",
    "= ok: Marke \"defeated_dragon\" gesetzt",
    "> marke liste (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke xyz (Echt)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> MARKE liste (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> wetter (Echt)",
    "= ok: Kein Wetter gesetzt (Server würfelt). Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter auto (Echt)",
    "= ok: Wetter überall: automatisch (Server würfelt)",
    "> wetter Unsinn (Echt)",
    "= refused: Unbekannter Zustand: \"Unsinn\". Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> spawn (Echt)",
    "= refused: Aufruf: spawn <prefab> [x z]",
    "> spawn Unbekannt (Echt)",
    "= refused: Unbekanntes Prefab: Unbekannt",
    "> spawn K9Baum 3 4 (Echt)",
    "  getGroundHeight 3 4",
    "= ok: K9Baum gespawnt bei 3.0, 4.0 (Höhe 1.5)",
    "> spawn k9baum 5 6 (Echt)",
    "  getGroundHeight 5 6",
    "= ok: K9Baum gespawnt bei 5.0, 6.0 (Höhe 1.5)",
    "> spawn K9Baum (Echt)",
    "  getGroundHeight 12 -2",
    "= ok: K9Baum gespawnt bei 12.0, -2.0 (Höhe 1.5)",
    "> spawn K9Geist 12 -3 (Echt)",
    "  getGroundHeight 12 -3",
    "= ok: K9Geist gespawnt bei 12.0, -3.0 (Höhe 1.5) — NICHT persistent",
    "  zdos 460474953@{\"x\":3,\"y\":1.5,\"z\":4}/{\"x\":0,\"y\":0.9361027440155482,\"z\":0,\"w\":0.35172667320884426} 460474953@{\"x\":5,\"y\":1.5,\"z\":6}/{\"x\":0,\"y\":0.9732489894677302,\"z\":0,\"w\":0.22975292054736127} 460474953@{\"x\":12,\"y\":1.5,\"z\":-2}/{\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984} -1340637338@{\"x\":12,\"y\":1.5,\"z\":-3}/{\"x\":0,\"y\":-0.8506508083520399,\"z\":0,\"w\":0.5257311121191336}",
    "> abbau (Echt)",
    "= refused: Aufruf: abbau <prefab> [radius]",
    "> abbau k9geist 200 (Echt)",
    "= ok: 1× K9Geist im Umkreis von 200 m entfernt",
    "> abbau K9Baum 3 (Echt)",
    "= ok: 1× K9Baum im Umkreis von 3 m entfernt",
    "> abbau K9Baum 200 (Echt)",
    "= ok: 2× K9Baum im Umkreis von 200 m entfernt",
    "> abbau K9Baum (Echt)",
    "= ok: 0× K9Baum im Umkreis von 10 m entfernt",
    "> spawn K9Baum 1 2 (EchtDungeon)",
    "  getGroundHeight 1 2",
    "= ok: K9Baum gespawnt bei 1.0, 2.0 (Höhe 1.5)",
    "> spawn K9Baum 3 3 (EchtDungeon)",
    "  getGroundHeight 3 3",
    "= ok: K9Baum gespawnt bei 3.0, 3.0 (Höhe 1.5)",
    "  zdos main 0, second world 460474953@{\"x\":1,\"y\":1.5,\"z\":2} 460474953@{\"x\":3,\"y\":1.5,\"z\":3}",
    "> abbau K9Baum 200 (EchtDungeon)",
    "= ok: 2× K9Baum im Umkreis von 200 m entfernt",
    "  zdos main 0, second world 0",
    "> item give Hammer 2 (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item give Hammer 2 extra (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item give Hammer 1e1 (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 10× Hammer ins Inventar gelegt",
    "> item ironward Echt (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort Echt admin",
    "= ok: Echt: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Echt (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort Echt admin",
    "= ok: Echt: Ironward vollständig (7/7), 0 neue Gegenstände. Sicherung angefordert.",
    "> item wildwarden EchtVoll (Echt)",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "  EchtVoll [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "> item wildwarden Weg (Echt)",
    "= ok: Weg: Waldhüter vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  absent Weg [wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] stamp number not raised",
    "  markers defeated_dragon,defeated_eikthyr",
    "  commands fly,zone,teleport,marke,wetter,abbau,item,spawn",
    "> marke (Echt)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> marke liste (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke LIST (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke setzen (Echt)",
    "= refused: Aufruf: marke setzen <Name>",
    "> marke setzen Unsinn (Echt)",
    "= refused: Unbekannte Marke: \"Unsinn\"",
    "> marke setzen defeated_eikthyr (Echt)",
    "= ok: Marke \"defeated_eikthyr\" war schon gesetzt",
    "> marke set Defeated_Eikthyr (Echt)",
    "= ok: Marke \"defeated_eikthyr\" war schon gesetzt",
    "> marke setzen DEFEATED_DRAGON (Echt)",
    "= ok: Marke \"defeated_dragon\" war schon gesetzt",
    "> marke liste (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> marke xyz (Echt)",
    "= refused: Aufruf: marke liste | marke setzen <Name>",
    "> MARKE liste (Echt)",
    "= ok: 2 gesetzte Marke(n): defeated_dragon, defeated_eikthyr",
    "> wetter (Echt)",
    "= ok: Kein Wetter gesetzt (Server würfelt). Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> wetter auto (Echt)",
    "= ok: Wetter überall: automatisch (Server würfelt)",
    "> wetter Unsinn (Echt)",
    "= refused: Unbekannter Zustand: \"Unsinn\". Aufruf: wetter <Zustand|auto> [Biom] — Zustände: Clear, DeepForest_Mist, Glen_clear, Heath_clear, LightRain, Misty, Rain, Snow, SnowStorm, SwampRain, ThunderStorm, Twilight_Clear, Twilight_Snow, Twilight_SnowStorm",
    "> spawn (Echt)",
    "= refused: Aufruf: spawn <prefab> [x z]",
    "> spawn Unbekannt (Echt)",
    "= refused: Unbekanntes Prefab: Unbekannt",
    "> spawn K9Baum 3 4 (Echt)",
    "  getGroundHeight 3 4",
    "= ok: K9Baum gespawnt bei 3.0, 4.0 (Höhe 1.5)",
    "> spawn k9baum 5 6 (Echt)",
    "  getGroundHeight 5 6",
    "= ok: K9Baum gespawnt bei 5.0, 6.0 (Höhe 1.5)",
    "> spawn K9Baum (Echt)",
    "  getGroundHeight 12 -2",
    "= ok: K9Baum gespawnt bei 12.0, -2.0 (Höhe 1.5)",
    "> spawn K9Geist 12 -3 (Echt)",
    "  getGroundHeight 12 -3",
    "= ok: K9Geist gespawnt bei 12.0, -3.0 (Höhe 1.5) — NICHT persistent",
    "  zdos 460474953@{\"x\":3,\"y\":1.5,\"z\":4}/{\"x\":0,\"y\":0.9361027440155482,\"z\":0,\"w\":0.35172667320884426} 460474953@{\"x\":5,\"y\":1.5,\"z\":6}/{\"x\":0,\"y\":0.9732489894677302,\"z\":0,\"w\":0.22975292054736127} 460474953@{\"x\":12,\"y\":1.5,\"z\":-2}/{\"x\":0,\"y\":-0.9238795325112867,\"z\":0,\"w\":0.38268343236508984} -1340637338@{\"x\":12,\"y\":1.5,\"z\":-3}/{\"x\":0,\"y\":-0.8506508083520399,\"z\":0,\"w\":0.5257311121191336}",
    "> abbau (Echt)",
    "= refused: Aufruf: abbau <prefab> [radius]",
    "> abbau k9geist 200 (Echt)",
    "= ok: 1× K9Geist im Umkreis von 200 m entfernt",
    "> abbau K9Baum 3 (Echt)",
    "= ok: 1× K9Baum im Umkreis von 3 m entfernt",
    "> abbau K9Baum 200 (Echt)",
    "= ok: 2× K9Baum im Umkreis von 200 m entfernt",
    "> abbau K9Baum (Echt)",
    "= ok: 0× K9Baum im Umkreis von 10 m entfernt",
    "> spawn K9Baum 1 2 (EchtDungeon)",
    "  getGroundHeight 1 2",
    "= ok: K9Baum gespawnt bei 1.0, 2.0 (Höhe 1.5)",
    "> spawn K9Baum 3 3 (EchtDungeon)",
    "  getGroundHeight 3 3",
    "= ok: K9Baum gespawnt bei 3.0, 3.0 (Höhe 1.5)",
    "  zdos main 0, second world 460474953@{\"x\":1,\"y\":1.5,\"z\":2} 460474953@{\"x\":3,\"y\":1.5,\"z\":3}",
    "> abbau K9Baum 200 (EchtDungeon)",
    "= ok: 2× K9Baum im Umkreis von 200 m entfernt",
    "  zdos main 0, second world 0",
    "> item give Hammer 2 (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item give Hammer 2 extra (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 2× Hammer ins Inventar gelegt",
    "> item give Hammer 1e1 (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "= ok: 10× Hammer ins Inventar gelegt",
    "> item ironward Echt (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort Echt admin",
    "= ok: Echt: Ironward vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "> item ironward Echt (Echt)",
    "  inventarSync Echt [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,IronwardHelmetx1,IronwardCuirassx1,IronwardLeggingsx1,IronwardPauldronsx1,IronwardBracersx1,IronwardGauntletsx1,IronwardBootsx1]",
    "  sichereSpielerSofort Echt admin",
    "= ok: Echt: Ironward vollständig (7/7), 0 neue Gegenstände. Sicherung angefordert.",
    "> item wildwarden EchtVoll (Echt)",
    "= refused: Nicht genug Platz für das vollständige Set; nichts verändert",
    "  EchtVoll [Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1,Hammerx1]",
    "> item wildwarden Weg (Echt)",
    "= ok: Weg: Waldhüter vollständig (7/7), 7 neue Gegenstände. Sicherung angefordert.",
    "  absent Weg [wildwarden_crownx1,wildwarden_vestx1,wildwarden_robex1,wildwarden_mantlex1,wildwarden_bracersx1,wildwarden_glovesx1,wildwarden_bootsx1] stamp number raised",
    "  markers defeated_dragon,defeated_eikthyr",
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
  aufrufe: { register: 2, getPeers: 9, vergiss: 4, getInstance: 1, getGroundHeight: 2, teleportPeer: 2, getInstanceNeu: 1 },
  konsole: { log: 0, warn: 0 },
  zustand: [8, 8, 8, 8, 7, 7, 6, 5, 4, 4],
  ausnahmen: [],
  notizen: [
    'call getPeers receiver=net',
    '> ["online"] = {"ok":true,"active":false,"message":"Selbst [id-selbst] (admin) | Bjo\u0308rn [id-bjoern] (admin) | EdAdmin [ed-a] (admin)"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    'call getPeers receiver=net',
    '> ["entfernen","Selbst"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Selbst"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    'call getPeers receiver=net',
    '> ["entfernen","selbst"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["selbst"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    '> ["liste"] = {"ok":true,"active":false,"message":"8 Datensaetze: Björn, Einmal, Jo\u0308rg, Selbst, Ulf , Zwilling, Zwilling, Åsa"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2,id-einmal',
    'call getPeers receiver=net',
    'call vergiss ["id-einmal","id-einmal"] receiver=spielerSicherung',
    '> ["entfernen","Einmal","Einmal"] = {"ok":true,"active":false,"message":"Entfernt: Einmal | Uebersprungen: Einmal (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["Einmal","Einmal"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call getPeers receiver=net',
    '> ["entfernen","björn"] = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: björn (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["björn"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-joerg,id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call getPeers receiver=net',
    'call vergiss ["id-joerg","id-joerg"] receiver=spielerSicherung',
    '> ["entfernen","JÖRG"] = {"ok":true,"active":false,"message":"Entfernt: JÖRG | Noch 6 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["JÖRG"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-asa,id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call getPeers receiver=net',
    'call vergiss ["id-asa","id-asa"] receiver=spielerSicherung',
    '> ["entfernen","A\u030asa"] = {"ok":true,"active":false,"message":"Entfernt: A\u030asa | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["A\u030asa"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-ulf,id-selbst,id-z1,id-z2',
    'call getPeers receiver=net',
    'call vergiss ["id-ulf","id-ulf"] receiver=spielerSicherung',
    '> ["entfernen","ulf"] = {"ok":true,"active":false,"message":"Entfernt: ulf | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"} args=["ulf"]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-selbst,id-z1,id-z2',
    'call getPeers receiver=net',
    '> ["online"] = {"ok":true,"active":false,"message":"Allein [id-allein] (admin)"} args=[]',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'saved id-bjoern,id-selbst,id-z1,id-z2',
    'call getInstance d-inst',
    'call getGroundHeight 7 8 receiver=context',
    'call teleportPeer 3 Vorher [{"x":7,"y":5.5625,"z":8},null]',
    '> ["7","8"] = {"ok":true,"active":false,"message":"Teleportiert nach 7, 8 (Höhe 5.6)"} args=["7","8"]',
    'peer Vorher dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'instance players 7,9',
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
    'Selbst:Teleport:40:622e541176273024',
    'Selbst:Teleport:40:02774683002404dc',
  ],
  aufrufe: { getPeers: 8, vergiss: 4, getGroundHeight: 3, getInstanceNeu: 1 },
  konsole: { log: 4, warn: 0 },
  zustand: [8, 8, 8, 7, 7, 6, 5, 4, 4, 4, 4, 4],
  ausnahmen: [],
  notizen: [
    'log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge',
    'log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen',
    'log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen',
    'log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen',
    'call getPeers receiver=net',
    '> spieler online = {"ok":true,"active":false,"message":"Selbst [id-selbst] (admin) | Bjo\u0308rn [id-bjoern] (admin) | EdAdmin [ed-a] (admin)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    '> spieler entfernen Selbst = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: Selbst (verbunden) | Noch 8 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    '> spieler liste = {"ok":true,"active":false,"message":"8 Datensaetze: Björn, Einmal, Jo\u0308rg, Selbst, Ulf , Zwilling, Zwilling, Åsa"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    'call vergiss ["id-einmal","id-einmal"] receiver=spielerSicherung',
    '> spieler entfernen Einmal Einmal = {"ok":true,"active":false,"message":"Entfernt: Einmal | Uebersprungen: Einmal (unbekannt) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    '> spieler entfernen björn = {"ok":true,"active":false,"message":"Entfernt: — | Uebersprungen: björn (verbunden) | Noch 7 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    'call vergiss ["id-joerg","id-joerg"] receiver=spielerSicherung',
    '> spieler entfernen JÖRG = {"ok":true,"active":false,"message":"Entfernt: JÖRG | Noch 6 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    'call vergiss ["id-asa","id-asa"] receiver=spielerSicherung',
    '> spieler entfernen A\u030asa = {"ok":true,"active":false,"message":"Entfernt: A\u030asa | Noch 5 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    'call vergiss ["id-ulf","id-ulf"] receiver=spielerSicherung',
    '> spieler entfernen ulf = {"ok":true,"active":false,"message":"Entfernt: ulf | Noch 4 Datensaetze (wird beim naechsten Speichern geschrieben)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":2,"z":3} worldId="haupt" char=0:0',
    'call getGroundHeight 3 4 receiver=context',
    '> teleport 3 4 = {"ok":true,"active":false,"message":"Teleportiert nach 3, 4 (Höhe 2.6)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    'call getPeers receiver=net',
    '> spieler online = {"ok":true,"active":false,"message":"Allein [id-allein] (admin)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":3,"y":2.5625,"z":4} worldId="haupt" char=0:0',
    'call getGroundHeight 1 2 receiver=context',
    '> teleport 1 2 = {"ok":true,"active":false,"message":"Teleportiert nach 1, 2 (Höhe 1.1)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":1,"y":1.0625,"z":2} worldId="haupt" char=0:0',
    'call getInstanceNeu d-neu',
    'call getGroundHeight 5 6 receiver=context',
    '> teleport 5 6 = {"ok":true,"active":false,"message":"Teleportiert nach 5, 6 (Höhe 4.1)"}',
    'peer Selbst dungeonId=null dungeonReturn=null position={"x":5,"y":4.0625,"z":6} worldId="haupt" char=0:0',
    'instance players 35',
  ],
};

// ── [2h] Behaviour of step 1, package D: the command dungeon with its 13 sub-commands, and resolveDungeonBase ──

/** The 13 sub-commands of `dungeon`, as its default branch names them; the fixed sequences below run each one (no argument, an unknown id, no rights, a guest). */
const DUNGEON_UNTERBEFEHLE = ['list', 'entrances', 'entrance-mode', 'create', 'create2', 'enter', 'leave', 'assign', 'regen', 'steinkit', 'licht', 'reset', 'delete'] as const;
/** Ten digits and more (time stamps) and the temporary folder are not behaviour: written `<zahl>` and `<tmp>`. */
const normD = (t: string, tmp = ''): string => (tmp ? t.split(tmp).join('<tmp>') : t).replace(/\b\d{10,}\b/g, '<zahl>');
/** A peer of the dungeon command: admin by default; the fields enter, leave and teleport write. */
const peerD = (a: Aufzeichnung, name: string, o: Record<string, unknown> = {}): Record<string, unknown> => peerB(a, name, { userId: 7, spielerId: `sp-${name}`, ...o });
const gastD = (a: Aufzeichnung): Record<string, unknown> => peerD(a, 'Gast', { isAdmin: false, userId: 0, spielerId: '' });
const keinAdminD = (a: Aufzeichnung): Record<string, unknown> => peerD(a, 'Kein', { isAdmin: false, userId: 23 });
/** One command line through a registry: the whole result as text, the peer after it. */
function befehlD(a: Aufzeichnung, reg: { execute(p: unknown, l: string): unknown }, zeile: string, p: Record<string, unknown>, tmp = ''): void {
  try { a.notizen.push(`> ${zeile} (${String(p['name'])}) = ${normD(JSON.stringify(reg.execute(p, zeile)), tmp)}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> ${zeile} (${String(p['name'])}) throws ${(e as Error).name}`); }
  a.notizen.push(normD(zustandB(p), tmp));
}
/** The lines every sub-command gets: without an argument (admin), with an unknown id (admin); `nix` is no document, no entrance, no instance. */
const DUNGEON_GRUNDZEILEN = ['dungeon', 'DUNGEON LIST', 'dungeon quatsch', ...DUNGEON_UNTERBEFEHLE.map((s) => `dungeon ${s}`), ...DUNGEON_UNTERBEFEHLE.map((s) => `dungeon ${s} nix`)];

/** The stand-in of package D: a real registry, `dungeons` answers from a small state and notes every call with its arguments and receiver. */
function dungeonAttrappe(a: Aufzeichnung, ueber: Record<string, (...x: unknown[]) => unknown> = {}): { k: Record<string, unknown>; ziel: Record<string, unknown>; reg: AdminCommandRegistry; docs1: Record<string, Record<string, unknown>>; zustand: { liste: boolean; eingaenge: boolean }; mach: (label: string) => Record<string, unknown> } {
  const reg = new AdminCommandRegistry();
  const registriere = reg.register.bind(reg);
  reg.register = (n, h): void => { a.notizen.push(`  register ${n}`); registriere(n, h); };
  const raeume = (n: number): Record<string, unknown>[] => Array.from({ length: n }, (_x, i) => ({ i }));
  const docs1: Record<string, Record<string, unknown>> = {
    d1: { id: 'd1', base: 'DG_ForestCrypt', mode: 'generated', layout: { rooms: raeume(3) }, zoneSize: 64 },
    dc: { id: 'dc', base: 'DG_Cave', mode: 'custom', layout: { rooms: raeume(2) }, zoneSize: 32 },
    dfail: { id: 'dfail', base: 'DG_SunkenCrypt', mode: 'generated', layout: { rooms: raeume(1) }, zoneSize: 64, ambientLicht: 0.25 },
  };
  const docs2: Record<string, Record<string, unknown>> = { e2: { id: 'e2', thema: 'steingrab', modus: 'erzeugt', seeds: { architektur: 1, material: 2, deko: 3 }, pruefsumme: 'P2' } };
  const zustand = { liste: false, eingaenge: false };
  const eingang = (id: string, regen: boolean): Record<string, unknown> => ({ zoneKey: '3,3', feature: 'Vault1', pos: { x: 192.4, y: 10, z: -191.6 }, dungeonId: id, regenerateOnEnter: regen });
  const tabelle: Record<string, (...x: unknown[]) => unknown> = {
    listDocuments: () => (zustand.liste ? Object.values(docs1) : []),
    listDokumente2: () => (zustand.liste ? Object.values(docs2) : []),
    getInstance: (id) => (id === 'd1' ? { players: new Set([1, 2]) } : undefined),
    erzeugeDungeon2: (thema, seeds, id, amb) => ((seeds as { architektur: number }).architektur === 13 ? null : { id: id ?? `${String(thema)}-neu`, thema, pruefsumme: 'PX', ambientLicht: amb, seeds }),
    listEntrances: () => (zustand.eingaenge ? [eingang('d1', true), { ...eingang('e2', false), feature: 'Cave2', pos: { x: -5.5, y: 0, z: 1e3 } }] : []),
    eingangZuDungeon: (id) => (id === 'd1' || id === 'dx' ? eingang(String(id), false) : undefined),
    setzeEingangsModus: (id) => id === 'd1',
    createGenerated: (base, seed, id) => (base === 'DG_SunkenCrypt' || id === 'dfail' ? null : { id: id ?? `neu-${String(seed)}`, layout: { rooms: raeume(4) }, zoneSize: 48 }),
    findEntranceNear: (pos) => ((pos as { x: number }).x === 999 ? eingang('nah', false) : null),
    hatDokument: (id) => typeof id === 'string' && (id in docs1 || id in docs2),
    assignEntrance: (_z, id) => id === 'd1',
    getDocument: (id) => docs1[String(id)],
    destroyInstance: (id) => id === 'd1',
    saveDocument: () => undefined,
    deleteDocument: (id) => id === 'd1',
    ...ueber,
  };
  const ziel: Record<string, unknown> = {
    adminCommands: reg,
    enterDungeon(this: unknown, p: unknown, id: unknown): unknown { zaehle(a, 'enterDungeon'); a.notizen.push(`  call enterDungeon ${nm(p)} ${JSON.stringify(id)} receiver=${this === k ? 'context' : 'LOST'}`); return { ok: id === 'gut' || id === 'nah', message: `enter:${String(id)}` }; },
    leaveDungeon(this: unknown, p: unknown): unknown { zaehle(a, 'leaveDungeon'); a.notizen.push(`  call leaveDungeon ${nm(p)} receiver=${this === k ? 'context' : 'LOST'}`); return { ok: nm(p) !== 'Gast', message: 'leave' }; },
    resolveDungeonBase(this: unknown, x: unknown): unknown { zaehle(a, 'resolveDungeonBase'); a.notizen.push(`  call resolveDungeonBase ${JSON.stringify(x)} receiver=${this === k ? 'context' : 'LOST'}`); return F['resolveDungeonBase']!(this, x); },
  };
  // the same recorder under another label: a replacement of `dungeons` whose calls show which object the handler reached (N1, D-9)
  const mach = (label: string): Record<string, unknown> => {
    const dungeons: Record<string, unknown> = {};
    for (const [m, f] of Object.entries(tabelle)) dungeons[m] = function (this: unknown, ...x: unknown[]): unknown { zaehle(a, `${label}.${m}`); a.notizen.push(`  call ${label}.${m} ${JSON.stringify(x)}${this === ziel['dungeons'] ? '' : ' receiver=LOST'}`); return f(...x); };
    return dungeons;
  };
  ziel['dungeons'] = mach('dungeons');
  const k: Record<string, unknown> = new Proxy(ziel, {
    get(t, p, r) { if (typeof p === 'string') zaehle(a, `k.${p}`); return Reflect.get(t, p, r) as unknown; },
    set(t, p, v, r) { a.notizen.push(`  WRITE k.${String(p)}`); return Reflect.set(t, p, v, r); },
  });
  return { k, ziel, reg, docs1, zustand, mach };
}

/** The fixed sequence of package D on a stand-in: every sub-command with valid and invalid arguments, no rights, a guest, members replaced after the registration. */
function messeDungeonAttrappe(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  try {
    mitZufall(31, () => {
      const { k, ziel, reg, docs1, zustand } = dungeonAttrappe(a);
      versuche(a, () => F['registerDungeonCommand']!(k));
      a.notizen.push(`  commands ${[...(reg as unknown as { handlers: Map<string, unknown> }).handlers.keys()].join(',')}`);
      const ich = (o: Record<string, unknown> = {}): Record<string, unknown> => peerD(a, 'Ich', o);
      const nah = (): Record<string, unknown> => peerD(a, 'Ich', { position: { x: 999, y: 0, z: 0 } });
      const docs = (): void => { a.notizen.push(`  docs ${JSON.stringify(docs1)}`); };
      const ex = (zeile: string, p: Record<string, unknown> = ich()): void => befehlD(a, reg, zeile, p);
      // every sub-command without an argument and with an unknown id, before any document exists, then with documents and entrances
      for (const z of DUNGEON_GRUNDZEILEN) ex(z);
      zustand.liste = true; zustand.eingaenge = true;
      for (const z of ['dungeon list', 'dungeon List extra', 'dungeon entrances', 'dungeon ENTRANCES 1']) ex(z);
      // no rights and a guest: the registry refuses every sub-command, the handler is not reached
      for (const s of DUNGEON_UNTERBEFEHLE) { ex(`dungeon ${s} d1`, keinAdminD(a)); ex(`dungeon ${s} d1`, gastD(a)); }
      // entrance-mode
      for (const z of ['dungeon entrance-mode d1', 'dungeon entrance-mode d1 bogus', 'dungeon entrance-mode d1 REGEN', 'dungeon entrance-mode dx fixed', 'dungeon entrance-mode d1 regen', 'dungeon entrance-mode d1 fixed', 'dungeon Entrance-Mode d1 regen extra']) ex(z);
      // create
      for (const z of ['dungeon create camp', 'dungeon create forestcrypt', 'dungeon create DG_ForestCrypt 42', 'dungeon create ForestCrypt 42 5 64', 'dungeon create dg_cave abc', 'dungeon create cave 1 x 64', 'dungeon create cave 1 5 y', 'dungeon create cave 1.9 5.5 -3', 'dungeon create cave 1e3 0x10 Infinity', 'dungeon create cave 1 Infinity 64', 'dungeon create cave 1 -0 0', 'dungeon create sunkencrypt 7', 'dungeon CREATE Cave 2']) ex(z);
      // create2
      for (const z of ['dungeon create2 STEINGRAB 5', 'dungeon create2 steingrab abc', 'dungeon create2 steingrab 5 meinid', 'dungeon create2 steingrab 5 meinid 0.3', 'dungeon create2 steingrab 5 meinid 7', 'dungeon create2 steingrab 5 meinid -1', 'dungeon create2 steingrab 5 meinid abc', 'dungeon create2 steingrab 5 meinid 0', 'dungeon create2 steingrab 5 meinid 1', 'dungeon create2 steingrab 13', 'dungeon create2 steingrab 2.7 x 1e-1', 'dungeon create2 steingrab -3']) ex(z);
      // enter and leave; at an entrance
      ex('dungeon enter', nah());
      for (const z of ['dungeon enter gut', 'dungeon enter schlecht', 'dungeon ENTER gut x', 'dungeon enter GUT', 'dungeon leave x']) ex(z);
      // assign: far from an entrance, then near one (1.0 accepted, 2.0 refused, custom accepted by the stand-in's rule)
      ex('dungeon assign d1');
      for (const z of ['dungeon assign d1', 'dungeon assign e2', 'dungeon assign dc', 'dungeon ASSIGN d1 x']) ex(z, nah());
      // regen
      for (const z of ['dungeon regen e2', 'dungeon regen dc', 'dungeon regen d1 99', 'dungeon regen d1', 'dungeon regen d1 abc', 'dungeon regen d1 -7.9', 'dungeon regen dfail 5']) ex(z);
      // steinkit: the document and one room, the reset, every key, values outside the range, unknown keys
      for (const z of ['dungeon steinkit e2 reset', 'dungeon steinkit d1 wand=stein_clean', 'dungeon steinkit d1 wand=stein_clean decke=stein_moos boden=stein_wet moos=2 frost=9 nass=1 kachel=2 deckenkachel=3', 'dungeon steinkit d1 wand=foo', 'dungeon steinkit d1 bogus', 'dungeon steinkit d1 x=1', 'dungeon steinkit d1 =v', 'dungeon steinkit d1 wand=', 'dungeon steinkit d1 moos=', 'dungeon steinkit d1 room=', 'dungeon steinkit d1 moos=abc', 'dungeon steinkit d1', 'dungeon steinkit d1 room=x', 'dungeon steinkit d1 room=1.5', 'dungeon steinkit d1 room=9 moos=1', 'dungeon steinkit d1 room=-1 moos=1', 'dungeon steinkit d1 room=3 moos=1', 'dungeon steinkit d1 room=0 boden=stein_frost moos=3', 'dungeon steinkit d1 room=2 room=1 frost=4', 'dungeon steinkit d1 room=2 nass=2', 'dungeon steinkit d1 room=0 reset', 'dungeon steinkit d1 reset extra', 'dungeon steinkit d1 reset', 'dungeon steinkit dc kachel=0', 'dungeon steinkit dc kachel=999 deckenkachel=-1', 'dungeon steinkit dc nass=-3 moos=4.5', 'dungeon steinkit dc decke=/assets/models/stein_moos.png', 'dungeon steinkit dc wand=STEIN_MOOS', 'dungeon steinkit dc reset']) { ex(z); docs(); }
      // licht
      for (const z of ['dungeon licht e2 0.5', 'dungeon licht d1', 'dungeon licht dfail', 'dungeon licht d1 0.5', 'dungeon licht d1', 'dungeon licht d1 1', 'dungeon licht d1 2', 'dungeon licht d1 3', 'dungeon licht d1 0', 'dungeon licht d1 -0', 'dungeon licht d1 abc', 'dungeon licht d1 -1', 'dungeon licht d1 99', 'dungeon licht d1 Infinity', 'dungeon licht d1 0x1', 'dungeon licht d1 1e0', 'dungeon licht d1 reset', 'dungeon licht d1', 'dungeon licht dfail RESET', 'dungeon licht dfail reset']) { ex(z); docs(); }
      // reset, delete
      for (const z of ['dungeon reset d1', 'dungeon delete d1', 'dungeon DELETE d1', 'dungeon liste', 'dungeon ???']) ex(z);
      // the handler itself checks no rights: called directly as a guest (the registry is the gate)
      const h = (reg as unknown as { handlers: Map<string, Handler> }).handlers.get('dungeon');
      for (const z of ['list', 'create cave 3', 'licht d1 0.4', 'delete d1']) befehlB(a, h, z, gastD(a));
      // arguments the registry never produces (it splits at white space), straight into the handler: the handler's own guards
      for (const args of [['licht', 'd1', ''], ['licht', 'd1', ' '], ['steinkit', 'd1', ''], ['create', ''], ['assign', ''], ['enter', '']]) {
        try { a.notizen.push(`> direct ${JSON.stringify(args)} = ${JSON.stringify(h?.(ich(), [...args]))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> direct ${JSON.stringify(args)} throws ${(e as Error).name}`); }
      }
      docs();
      // members replaced AFTER the registration: the handler reads kd.<member> at every call, never a copy
      const neu: Record<string, unknown> = {};
      for (const m of ['listDocuments', 'listDokumente2', 'getInstance', 'createGenerated', 'destroyInstance']) neu[m] = (...x: unknown[]): unknown => { zaehle(a, `dungeonsNeu.${m}`); a.notizen.push(`  call dungeonsNeu.${m} ${JSON.stringify(x)}`); return m === 'destroyInstance' ? true : m === 'createGenerated' ? { id: 'x', layout: { rooms: [] }, zoneSize: 1 } : []; };
      ziel['dungeons'] = neu;
      ziel['enterDungeon'] = (p: unknown, id: unknown): unknown => { zaehle(a, 'enterDungeonNeu'); a.notizen.push(`  call enterDungeonNeu ${nm(p)} ${JSON.stringify(id)}`); return { ok: true, message: 'neu' }; };
      ziel['leaveDungeon'] = (): unknown => { zaehle(a, 'leaveDungeonNeu'); return { ok: false, message: 'neu-leave' }; };
      ziel['resolveDungeonBase'] = (x: unknown): unknown => { zaehle(a, 'resolveDungeonBaseNeu'); a.notizen.push(`  call resolveDungeonBaseNeu ${JSON.stringify(x)}`); return 'DG_Cave'; };
      for (const z of ['dungeon list', 'dungeon enter gut', 'dungeon leave', 'dungeon create egal 5', 'dungeon reset d1']) ex(z);
      // a context without a member the handler reads: the exception, by its name
      for (const [fehlt, zeile] of [['dungeons', 'dungeon list'], ['enterDungeon', 'dungeon enter gut'], ['leaveDungeon', 'dungeon leave'], ['resolveDungeonBase', 'dungeon create cave 1']] as const) {
        const merk = ziel[fehlt];
        delete ziel[fehlt];
        ex(zeile);
        ziel[fehlt] = merk;
      }
      // resolveDungeonBase itself (before the move: the method of the prototype on the stand-in)
      for (const x of [undefined, '', 'forestcrypt', 'DG_ForestCrypt', 'ForestCrypt', 'dg_FORESTCRYPT', 'cave', 'DG_Cave', 'sunkencrypt', 'camp', 'DG_Camp', 'nix', 'dg_', 'DG_DG_Cave', ' cave', 'Höhle']) {
        try { a.notizen.push(`resolveDungeonBase ${JSON.stringify(x)} = ${JSON.stringify(F['resolveDungeonBase']!(k, x))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`resolveDungeonBase ${JSON.stringify(x)} throws ${(e as Error).name}`); }
      }
    });
  } finally {
    ruecksetzen();
  }
  return a;
}

/** The same on a real instance: the registry its constructor built (through the forwarding), real documents on disk, a real entrance, a real instance; then the forwardings called again. */
function messeDungeonEcht(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    mitZufall(37, () => {
      mkdirSync(join(tmp, 'generiert'), { recursive: true });
      const server = createWovServer({
        port: 0, worldFeatures: false, worldName: 'i1-form-k1d', everyoneAdmin: true,
        worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
      } as never) as unknown as Record<string, unknown>;
      // the main world only exists after init(): a real ZDO space and an empty list of terrain changes, as the tests do
      const haupt = { id: HAUPTWELT_ID, zdos: new ZDOManager(1n), heightmaps: { listTerrainComps: (): unknown[] => { zaehle(a, 'listTerrainComps'); return []; } } };
      (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, haupt);
      server['hauptwelt'] = haupt;
      server['getGroundHeight'] = (x: number, z: number): number => { zaehle(a, 'getGroundHeight'); return x * 0.5 + z * 0.25 + 0.0625; };
      const reg = server['adminCommands'] as AdminCommandRegistry;
      const dungeons = server['dungeons'] as Record<string, (...x: unknown[]) => unknown>;
      const wurzel = (server['dungeonsWurzel'] as () => string).call(server);
      const platte = (): void => {
        const dateien = readdirSync(wurzel, { recursive: true }).map(String).filter((f) => f.endsWith('.json')).sort();
        a.notizen.push(`  disk ${dateien.map((f) => `${f}=${kennung(Buffer.from(normD(readFileSync(join(wurzel, f), 'utf8'), tmp)))}`).join(' ')}`);
      };
      const ich = peerD(a, 'Ich', { userId: 21 });
      const ex = (zeile: string, p: Record<string, unknown> = ich): void => befehlD(a, reg, zeile, p, tmp);
      for (const z of DUNGEON_GRUNDZEILEN) ex(z);
      for (const s of DUNGEON_UNTERBEFEHLE) { ex(`dungeon ${s}`, keinAdminD(a)); ex(`dungeon ${s}`, gastD(a)); }
      for (const z of ['dungeon create camp', 'dungeon create cave 42', 'dungeon create forestcrypt 43 5 64', 'dungeon create DG_SunkenCrypt 44 x 32', 'dungeon create2 steingrab 7', 'dungeon create2 steingrab 8 k1d-zwei 0.5', 'dungeon create2 steingrab 9 k1d-drei 9', 'dungeon list']) ex(z);
      platte();
      const d1 = ((dungeons['listDocuments']!.call(dungeons) as { id: string }[])[0]?.id) ?? 'fehlt';
      const dB = ((dungeons['listDocuments']!.call(dungeons) as { id: string }[])[1]?.id) ?? 'fehlt';
      const d2 = ((dungeons['listDokumente2']!.call(dungeons) as { id: string }[])[0]?.id) ?? 'fehlt';
      a.notizen.push(`  ids ${d1} ${dB} ${d2}`);
      // a real entrance, as m5b-eingang registers one (without world features there is none)
      const e = dungeons['registerEntrance']!.call(dungeons, 'Vault1', getStableHash('DG_StoneVault'), '3,3', { x: 192, y: 10, z: 192 }, 1000);
      a.notizen.push(`  entrance ${JSON.stringify(e)}`);
      const nah = peerD(a, 'Nah', { userId: 22, position: { x: 190, y: 10, z: 195 } });
      for (const z of ['dungeon entrances', `dungeon assign ${d1}`]) ex(z);
      for (const z of [`dungeon assign ${d2}`, `dungeon assign ${d1}`, 'dungeon entrances', 'dungeon enter', 'dungeon leave', 'dungeon leave']) ex(z, nah);
      for (const z of [`dungeon entrance-mode ${d1} regen`, `dungeon entrance-mode ${dB} regen`, `dungeon entrance-mode ${d1} fixed`, `dungeon entrance-mode ${d2} regen`, `dungeon entrance-mode ${d1} bogus`, 'dungeon entrances']) ex(z);
      for (const z of [`dungeon steinkit ${d1} wand=foo`, `dungeon steinkit ${d1} wand=stein_moos decke=stein_clean boden=stein_wet moos=2 frost=9 nass=1 kachel=2 deckenkachel=3`, `dungeon steinkit ${d1} room=1 moos=3`, `dungeon steinkit ${d1} room=99 moos=1`, `dungeon steinkit ${d1} room=x`, `dungeon steinkit ${d1} bogus`, `dungeon steinkit ${d1} moos=abc`, `dungeon steinkit ${d1} room=1 reset`, `dungeon steinkit ${d2} reset`]) { ex(z); platte(); }
      for (const z of [`dungeon licht ${d1}`, `dungeon licht ${d1} 0`, `dungeon licht ${d1} 0.5`, `dungeon licht ${d1}`, `dungeon licht ${d1} abc`, `dungeon licht ${d1} 9`, `dungeon licht ${d1} 1`, `dungeon licht ${d1} 2.5`, `dungeon licht ${d1} reset`, `dungeon licht ${d2} 0.5`]) { ex(z); platte(); }
      for (const z of [`dungeon regen ${d1} 99`, `dungeon regen ${d2}`, `dungeon regen ${dB}`]) { ex(z); platte(); }
      for (const z of [`dungeon enter ${d1}`, 'dungeon list', 'dungeon leave', `dungeon enter ${d2}`, `dungeon reset ${d2}`, 'dungeon leave', `dungeon reset ${d1}`]) ex(z);
      for (const z of [`dungeon delete ${d2}`, `dungeon delete ${dB}`, 'dungeon entrances', 'dungeon list']) { ex(z); platte(); }
      // the forwardings, called again on the instance: they hand the instance over; `dungeons` replaced afterwards is read at the call
      const neu = new AdminCommandRegistry();
      server['adminCommands'] = neu;
      versuche(a, () => (server['registerDungeonCommand'] as () => unknown).call(server));
      a.notizen.push(`  resolveDungeonBase on the instance ${JSON.stringify(['cave', 'DG_ForestCrypt', 'nix', undefined].map((x) => (server['resolveDungeonBase'] as (y: unknown) => unknown).call(server, x)))}`);
      ex('dungeon list');
      server['dungeons'] = { listDocuments: (): unknown[] => { zaehle(a, 'dungeonsNeu.listDocuments'); return [{ id: 'ersatz', base: 'DG_Cave', mode: 'generated', layout: { rooms: [1] } }]; }, listDokumente2: (): unknown[] => [], getInstance: (): undefined => undefined };
      befehlD(a, neu, 'dungeon list', ich, tmp);
      befehlD(a, reg, 'dungeon list', ich, tmp);
      (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

/** Measured on the stand before the move (`--messen-basis` on c19d4fe8), package D. */
const SOLL_DUNGEON_ATTRAPPE: Aufzeichnung = {
 "paket": [],
 "aufrufe": {
  "k.adminCommands": 1,
  "k.dungeons": 217,
  "dungeons.listDocuments": 7,
  "dungeons.listDokumente2": 7,
  "dungeons.listEntrances": 4,
  "k.resolveDungeonBase": 19,
  "resolveDungeonBase": 17,
  "dungeons.erzeugeDungeon2": 13,
  "dungeons.findEntranceNear": 8,
  "k.leaveDungeon": 5,
  "leaveDungeon": 3,
  "k.enterDungeon": 8,
  "enterDungeon": 6,
  "dungeons.hatDokument": 6,
  "dungeons.getDocument": 63,
  "dungeons.destroyInstance": 32,
  "dungeons.deleteDocument": 4,
  "dungeons.getInstance": 12,
  "dungeons.eingangZuDungeon": 4,
  "dungeons.setzeEingangsModus": 4,
  "dungeons.createGenerated": 18,
  "dungeons.assignEntrance": 4,
  "dungeons.saveDocument": 26,
  "dungeonsNeu.listDocuments": 1,
  "dungeonsNeu.listDokumente2": 1,
  "enterDungeonNeu": 1,
  "leaveDungeonNeu": 1,
  "resolveDungeonBaseNeu": 1,
  "dungeonsNeu.createGenerated": 1,
  "dungeonsNeu.destroyInstance": 1
 },
 "konsole": {
  "log": 0,
  "warn": 0
 },
 "zustand": [],
 "ausnahmen": [
  "TypeError",
  "TypeError",
  "TypeError",
  "TypeError"
 ],
 "notizen": [
  "  register dungeon",
  "  commands fly,zone,teleport,dungeon",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "> dungeon (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "> DUNGEON LIST (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon quatsch (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Eingänge registriert\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase undefined receiver=context",
  "> dungeon create (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":1443659015,\"material\":1363048140,\"deko\":2403393581},null,null]",
  "> dungeon create2 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed <zahl>, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.findEntranceNear [{\"x\":1,\"y\":2,\"z\":3},16]",
  "> dungeon enter (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Dungeon-Eingang in der Nähe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call leaveDungeon Ich receiver=context",
  "> dungeon leave (Ich) = {\"ok\":true,\"active\":false,\"message\":\"leave\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "> dungeon list nix (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon entrances nix (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Eingänge registriert\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"nix\" receiver=context",
  "> dungeon create nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create2 <thema> [seed] — bekannt: steingrab\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call enterDungeon Ich \"nix\" receiver=context",
  "> dungeon enter nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"enter:nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call leaveDungeon Ich receiver=context",
  "> dungeon leave nix (Ich) = {\"ok\":true,\"active\":false,\"message\":\"leave\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"nix\"]",
  "> dungeon assign nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"nix\"]",
  "> dungeon regen nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"nix\"]",
  "> dungeon steinkit nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"nix\"]",
  "> dungeon licht nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.destroyInstance [\"nix\"]",
  "> dungeon reset nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.deleteDocument [\"nix\"]",
  "> dungeon delete nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "  call dungeons.getInstance [\"d1\"]",
  "  call dungeons.getInstance [\"dc\"]",
  "  call dungeons.getInstance [\"dfail\"]",
  "  call dungeons.getInstance [\"e2\"]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "  call dungeons.getInstance [\"d1\"]",
  "  call dungeons.getInstance [\"dc\"]",
  "  call dungeons.getInstance [\"dfail\"]",
  "  call dungeons.getInstance [\"e2\"]",
  "> dungeon List extra (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,-192) → d1 [regen] | Cave2@(-6,1000) → e2 [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon ENTRANCES 1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,-192) → d1 [regen] | Cave2@(-6,1000) → e2 [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete d1 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete d1 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode d1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode d1 bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode d1 REGEN (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"dx\"]",
  "  call dungeons.setzeEingangsModus [\"dx\",\"fixed\"]",
  "> dungeon entrance-mode dx fixed (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Rezept (base) für dx — nur erzeugte 1.0-Dungeons mit DG_*-Basis können bei jedem Betreten neu würfeln\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"d1\"]",
  "  call dungeons.setzeEingangsModus [\"d1\",\"regen\"]",
  "> dungeon entrance-mode d1 regen (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → d1: würfelt bei jedem Betreten neu\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"d1\"]",
  "  call dungeons.setzeEingangsModus [\"d1\",\"fixed\"]",
  "> dungeon entrance-mode d1 fixed (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → d1: fest\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"d1\"]",
  "  call dungeons.setzeEingangsModus [\"d1\",\"regen\"]",
  "> dungeon Entrance-Mode d1 regen extra (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → d1: würfelt bei jedem Betreten neu\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"camp\" receiver=context",
  "> dungeon create camp (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"forestcrypt\" receiver=context",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",1795180445,null,null]",
  "> dungeon create forestcrypt (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-<zahl> (4 Räume, Seed <zahl>, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"DG_ForestCrypt\" receiver=context",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",42,null,null]",
  "> dungeon create DG_ForestCrypt 42 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-42 (4 Räume, Seed 42, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"ForestCrypt\" receiver=context",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",42,null,{\"maxRooms\":5,\"zoneSize\":64}]",
  "> dungeon create ForestCrypt 42 5 64 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-42 (4 Räume, Seed 42, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"dg_cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1609883563,null,null]",
  "> dungeon create dg_cave abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-<zahl> (4 Räume, Seed <zahl>, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1,null,{\"zoneSize\":64}]",
  "> dungeon create cave 1 x 64 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1 (4 Räume, Seed 1, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1,null,{\"maxRooms\":5}]",
  "> dungeon create cave 1 5 y (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1 (4 Räume, Seed 1, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1,null,{\"maxRooms\":5.5,\"zoneSize\":-3}]",
  "> dungeon create cave 1.9 5.5 -3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1 (4 Räume, Seed 1, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1000,null,{\"maxRooms\":16}]",
  "> dungeon create cave 1e3 0x10 Infinity (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1000 (4 Räume, Seed 1000, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1,null,{\"zoneSize\":64}]",
  "> dungeon create cave 1 Infinity 64 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1 (4 Räume, Seed 1, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",1,null,{\"maxRooms\":0,\"zoneSize\":0}]",
  "> dungeon create cave 1 -0 0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-1 (4 Räume, Seed 1, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"sunkencrypt\" receiver=context",
  "  call dungeons.createGenerated [\"DG_SunkenCrypt\",7,null,null]",
  "> dungeon create sunkencrypt 7 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Erzeugung fehlgeschlagen (DG_SunkenCrypt)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"Cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",2,null,null]",
  "> dungeon CREATE Cave 2 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-2 (4 Räume, Seed 2, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},null,null]",
  "> dungeon create2 STEINGRAB 5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":105048754,\"material\":2238434521,\"deko\":962037590},null,null]",
  "> dungeon create2 steingrab abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed 105048754, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",null]",
  "> dungeon create2 steingrab 5 meinid (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",0.3]",
  "> dungeon create2 steingrab 5 meinid 0.3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 0.30 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",1]",
  "> dungeon create2 steingrab 5 meinid 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",0]",
  "> dungeon create2 steingrab 5 meinid -1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 0.00 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",null]",
  "> dungeon create2 steingrab 5 meinid abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",0]",
  "> dungeon create2 steingrab 5 meinid 0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 0.00 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"meinid\",1]",
  "> dungeon create2 steingrab 5 meinid 1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: meinid (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":13,\"material\":548258153,\"deko\":4085841662},null,null]",
  "> dungeon create2 steingrab 13 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Erzeugung fehlgeschlagen (steingrab)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":2,\"material\":924828731,\"deko\":3333651121},\"x\",0.1]",
  "> dungeon create2 steingrab 2.7 x 1e-1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: x (Thema steingrab, Seed 2, Prüfsumme PX, Grundhelligkeit 0.10 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":4294967293,\"material\":2679349528,\"deko\":179127522},null,null]",
  "> dungeon create2 steingrab -3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed -3, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call enterDungeon Ich \"nah\" receiver=context",
  "> dungeon enter (Ich) = {\"ok\":true,\"active\":true,\"message\":\"enter:nah\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call enterDungeon Ich \"gut\" receiver=context",
  "> dungeon enter gut (Ich) = {\"ok\":true,\"active\":true,\"message\":\"enter:gut\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call enterDungeon Ich \"schlecht\" receiver=context",
  "> dungeon enter schlecht (Ich) = {\"ok\":false,\"active\":false,\"message\":\"enter:schlecht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call enterDungeon Ich \"gut\" receiver=context",
  "> dungeon ENTER gut x (Ich) = {\"ok\":true,\"active\":true,\"message\":\"enter:gut\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call enterDungeon Ich \"GUT\" receiver=context",
  "> dungeon enter GUT (Ich) = {\"ok\":false,\"active\":false,\"message\":\"enter:GUT\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call leaveDungeon Ich receiver=context",
  "> dungeon leave x (Ich) = {\"ok\":true,\"active\":false,\"message\":\"leave\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"d1\"]",
  "  call dungeons.findEntranceNear [{\"x\":1,\"y\":2,\"z\":3},16]",
  "> dungeon assign d1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Dungeon-Eingang in der Nähe (≤16 m)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"d1\"]",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeons.assignEntrance [\"3,3\",\"d1\"]",
  "> dungeon assign d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → d1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"e2\"]",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeons.assignEntrance [\"3,3\",\"e2\"]",
  "> dungeon assign e2 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Zuweisung fehlgeschlagen: kein 1.0-Dokument unter 'e2' — 2.0-Dokumente lassen sich (noch) nicht zuweisen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"dc\"]",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeons.assignEntrance [\"3,3\",\"dc\"]",
  "> dungeon assign dc (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Zuweisung fehlgeschlagen: kein 1.0-Dokument unter 'dc' — 2.0-Dokumente lassen sich (noch) nicht zuweisen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"d1\"]",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeons.assignEntrance [\"3,3\",\"d1\"]",
  "> dungeon ASSIGN d1 x (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → d1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"e2\"]",
  "> dungeon regen e2 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: e2\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"dc\"]",
  "> dungeon regen dc (Ich) = {\"ok\":false,\"active\":false,\"message\":\"dc ist von Hand gebaut (mode custom) — 'regen' würfelt aus Basis und Seed neu und die Handarbeit wäre verloren. Neu generieren geht im Editor über „Neu anlegen\\\" mit „voll generieren\\\".\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",99,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 99 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 99, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",894940899,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 894940899, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",742229990,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 742229990, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",-7,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 -7.9 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed -7, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"dfail\"]",
  "  call dungeons.createGenerated [\"DG_SunkenCrypt\",5,\"dfail\"]",
  "> dungeon regen dfail 5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Neugenerierung fehlgeschlagen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"e2\"]",
  "> dungeon steinkit e2 reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: e2\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\"}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 wand=stein_clean (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_clean.png\\\"}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\"}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 wand=stein_clean decke=stein_moos boden=stein_wet moos=2 frost=9 nass=1 kachel=2 deckenkachel=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":2,\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 wand=foo (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: bogus — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 x=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: x=1 — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 =v (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: =v — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 wand= (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":2,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":0,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 moos= (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":0,\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":0,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room= (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Nichts Gültiges angegeben — nichts geändert\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"moos\":0,\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 moos=abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room=x (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Raumindex: room=x\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room=1.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Raumindex: room=1.5\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room=9 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Raumindex 9 liegt ausserhalb — d1 hat 3 Räume (0..2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room=-1 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Raumindex -1 liegt ausserhalb — d1 hat 3 Räume (0..2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 room=3 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Raumindex 3 liegt ausserhalb — d1 hat 3 Räume (0..2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 room=0 boden=stein_frost moos=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 Raum 0: Steinmaterial gesetzt — {\\\"bodenTextur\\\":\\\"/assets/models/stein_frost.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":3}}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 room=2 room=1 frost=4 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 Raum 1: Steinmaterial gesetzt — {\\\"verwitterung\\\":{\\\"frost\\\":4}}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 room=2 nass=2 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 Raum 2: Steinmaterial gesetzt — {\\\"verwitterung\\\":{\\\"nass\\\":2}}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0,\"steinKit\":{\"bodenTextur\":\"/assets/models/stein_frost.png\",\"verwitterung\":{\"moos\":3}}},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 room=0 reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 Raum 0: Steinmaterial gelöscht — es gilt wieder das des Dokuments\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 reset extra (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: reset extra — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_clean.png\",\"deckeTextur\":\"/assets/models/stein_moos.png\",\"bodenTextur\":\"/assets/models/stein_wet.png\",\"verwitterung\":{\"frost\":4,\"nass\":1},\"kachelM\":2,\"deckeKachelM\":3}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gelöscht — es gilt wieder die Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "  call dungeons.saveDocument [{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"kachelM\":0.05}}]",
  "  call dungeons.destroyInstance [\"dc\"]",
  "> dungeon steinkit dc kachel=0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dc: Steinmaterial gesetzt — {\\\"kachelM\\\":0.05}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"kachelM\":0.05}},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "  call dungeons.saveDocument [{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"kachelM\":64,\"deckeKachelM\":0.05}}]",
  "  call dungeons.destroyInstance [\"dc\"]",
  "> dungeon steinkit dc kachel=999 deckenkachel=-1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dc: Steinmaterial gesetzt — {\\\"kachelM\\\":64,\\\"deckeKachelM\\\":0.05}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"kachelM\":64,\"deckeKachelM\":0.05}},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "  call dungeons.saveDocument [{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"verwitterung\":{\"moos\":4,\"nass\":0},\"kachelM\":64,\"deckeKachelM\":0.05}}]",
  "  call dungeons.destroyInstance [\"dc\"]",
  "> dungeon steinkit dc nass=-3 moos=4.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dc: Steinmaterial gesetzt — {\\\"verwitterung\\\":{\\\"moos\\\":4,\\\"nass\\\":0},\\\"kachelM\\\":64,\\\"deckeKachelM\\\":0.05}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"verwitterung\":{\"moos\":4,\"nass\":0},\"kachelM\":64,\"deckeKachelM\":0.05}},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "  call dungeons.saveDocument [{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"deckeTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":4,\"nass\":0},\"kachelM\":64,\"deckeKachelM\":0.05}}]",
  "  call dungeons.destroyInstance [\"dc\"]",
  "> dungeon steinkit dc decke=/assets/models/stein_moos.png (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dc: Steinmaterial gesetzt — {\\\"deckeTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":4,\\\"nass\\\":0},\\\"kachelM\\\":64,\\\"deckeKachelM\\\":0.05}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"deckeTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":4,\"nass\":0},\"kachelM\":64,\"deckeKachelM\":0.05}},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "> dungeon steinkit dc wand=STEIN_MOOS (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"STEIN_MOOS\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32,\"steinKit\":{\"deckeTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":4,\"nass\":0},\"kachelM\":64,\"deckeKachelM\":0.05}},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dc\"]",
  "  call dungeons.saveDocument [{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32}]",
  "  call dungeons.destroyInstance [\"dc\"]",
  "> dungeon steinkit dc reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dc: Steinmaterial gelöscht — es gilt wieder die Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"e2\"]",
  "> dungeon licht e2 0.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: e2\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.00 (Vorgabe, Feld nicht gesetzt) — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dfail\"]",
  "> dungeon licht dfail (Ich) = {\"ok\":false,\"active\":false,\"message\":\"dfail: Grundbeleuchtung 0.25 — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0.5}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.50 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0.5},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.50 — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0.5},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.00 gesetzt (wie die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":2}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 2 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 2.00 gesetzt (heller als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":2},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":3}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 3.00 gesetzt (heller als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":3},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.00 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 -0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.00 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 abc (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl: abc\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 -1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — -1 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 99 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 99 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 Infinity (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl: Infinity\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0x1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.00 gesetzt (wie die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 1e0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.00 gesetzt (wie die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":1},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung gelöscht — es gilt wieder die Umgebung (1)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.00 (Vorgabe, Feld nicht gesetzt) — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dfail\"]",
  "> dungeon licht dfail RESET (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl: RESET\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"dfail\"]",
  "  call dungeons.saveDocument [{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64}]",
  "  call dungeons.destroyInstance [\"dfail\"]",
  "> dungeon licht dfail reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"dfail: Grundbeleuchtung gelöscht — es gilt wieder die Umgebung (1)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64}}",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon reset d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz d1 zurückgesetzt\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.deleteDocument [\"d1\"]",
  "> dungeon delete d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon d1 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.deleteDocument [\"d1\"]",
  "> dungeon DELETE d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon d1 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon liste (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon ??? (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "  call dungeons.getInstance [\"d1\"]",
  "  call dungeons.getInstance [\"dc\"]",
  "  call dungeons.getInstance [\"dfail\"]",
  "  call dungeons.getInstance [\"e2\"]",
  "> [\"list\"] = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"} args=[]",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",3,null,null]",
  "> [\"create\",\"cave\",\"3\"] = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-3 (4 Räume, Seed 3, Zone 48)\"} args=[\"cave\",\"3\"]",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0.4}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> [\"licht\",\"d1\",\"0.4\"] = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.40 gesetzt (dunkler als die Umgebung)\"} args=[\"d1\",\"0.4\"]",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.deleteDocument [\"d1\"]",
  "> [\"delete\",\"d1\"] = {\"ok\":true,\"active\":false,\"message\":\"Dungeon d1 gelöscht\"} args=[\"d1\"]",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "> direct [\"licht\",\"d1\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl: \"}",
  "  call dungeons.getDocument [\"d1\"]",
  "> direct [\"licht\",\"d1\",\" \"] = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl:  \"}",
  "  call dungeons.getDocument [\"d1\"]",
  "> direct [\"steinkit\",\"d1\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe:  — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "  call resolveDungeonBase \"\" receiver=context",
  "> direct [\"create\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "> direct [\"assign\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "  call dungeons.findEntranceNear [{\"x\":1,\"y\":2,\"z\":3},16]",
  "> direct [\"enter\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Kein Dungeon-Eingang in der Nähe\"}",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1,\"steinKit\":{\"verwitterung\":{\"frost\":4}}},{\"i\":2,\"steinKit\":{\"verwitterung\":{\"nass\":2}}}]},\"zoneSize\":64,\"ambientLicht\":0.4},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64}}",
  "  call dungeonsNeu.listDocuments []",
  "  call dungeonsNeu.listDokumente2 []",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call enterDungeonNeu Ich \"gut\"",
  "> dungeon enter gut (Ich) = {\"ok\":true,\"active\":true,\"message\":\"neu\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Ich) = {\"ok\":false,\"active\":false,\"message\":\"neu-leave\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBaseNeu \"egal\"",
  "  call dungeonsNeu.createGenerated [\"DG_Cave\",5,null,null]",
  "> dungeon create egal 5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: x (0 Räume, Seed 5, Zone 1)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.destroyInstance [\"d1\"]",
  "> dungeon reset d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz d1 zurückgesetzt\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) throws TypeError",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter gut (Ich) throws TypeError",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Ich) throws TypeError",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create cave 1 (Ich) throws TypeError",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "resolveDungeonBase undefined = null",
  "resolveDungeonBase \"\" = null",
  "resolveDungeonBase \"forestcrypt\" = \"DG_ForestCrypt\"",
  "resolveDungeonBase \"DG_ForestCrypt\" = \"DG_ForestCrypt\"",
  "resolveDungeonBase \"ForestCrypt\" = \"DG_ForestCrypt\"",
  "resolveDungeonBase \"dg_FORESTCRYPT\" = \"DG_ForestCrypt\"",
  "resolveDungeonBase \"cave\" = \"DG_Cave\"",
  "resolveDungeonBase \"DG_Cave\" = \"DG_Cave\"",
  "resolveDungeonBase \"sunkencrypt\" = \"DG_SunkenCrypt\"",
  "resolveDungeonBase \"camp\" = null",
  "resolveDungeonBase \"DG_Camp\" = null",
  "resolveDungeonBase \"nix\" = null",
  "resolveDungeonBase \"dg_\" = null",
  "resolveDungeonBase \"DG_DG_Cave\" = null",
  "resolveDungeonBase \" cave\" = null",
  "resolveDungeonBase \"Höhle\" = null"
 ]
};
const SOLL_DUNGEON_ECHT: Aufzeichnung = {
 "paket": [
  "Nah:Teleport:52:a5fccccadc0313c6",
  "Nah:Teleport:40:953e6e118ba67c99",
  "Ich:Teleport:52:a5fccccadc0313c6",
  "Ich:Teleport:40:41c7ae408d25e74f",
  "Ich:Teleport:99:7bed5317ca436d81",
  "Ich:Teleport:40:41c7ae408d25e74f"
 ],
 "aufrufe": {
  "weltWechselVorbereiten": 7,
  "listTerrainComps": 3,
  "dungeonsNeu.listDocuments": 2
 },
 "konsole": {
  "log": 11,
  "warn": 1
 },
 "zustand": [],
 "ausnahmen": [],
 "notizen": [
  "log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge",
  "log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen",
  "log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen",
  "log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen",
  "> dungeon (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> DUNGEON LIST (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon quatsch (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon list|entrances|entrance-mode|create|create2|enter|leave|assign|regen|steinkit|licht|reset|delete\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Dungeons vorhanden\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Eingänge registriert\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-42167a42 (Thema steingrab, Seed <zahl>, Prüfsumme 021bc22c, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Dungeon-Eingang in der Nähe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Du bist in keinem Dungeon\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: ?\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list nix (Ich) = {\"ok\":true,\"active\":false,\"message\":\"steingrab-42167a42 (2.0, steingrab, erzeugt, Seeds <zahl>/<zahl>/<zahl>, Prüfsumme 021bc22c)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances nix (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Keine Eingänge registriert\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create2 <thema> [seed] — bekannt: steingrab\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Du bist in keinem Dungeon\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete nix (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: nix\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon enter (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon regen (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon licht (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon reset (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete (Kein) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Kein dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete (Gast) = {\"ok\":false,\"active\":false,\"message\":\"Admin commands are not allowed for this player\"}",
  "peer Gast dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create camp (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create cave 42 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: cave-2a (52 Räume, Seed 42, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create forestcrypt 43 5 64 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: forestcrypt-2b (15 Räume, Seed 43, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create DG_SunkenCrypt 44 x 32 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: sunkencrypt-2c (10 Räume, Seed 44, Zone 32)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 steingrab 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-7 (Thema steingrab, Seed 7, Prüfsumme caf13fad, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 steingrab 8 k1d-zwei 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: k1d-zwei (Thema steingrab, Seed 8, Prüfsumme fc1cbe79, Grundhelligkeit 0.50 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 steingrab 9 k1d-drei 9 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: k1d-drei (Thema steingrab, Seed 9, Prüfsumme a4de7f93, Grundhelligkeit 1.00 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 52 Räume) | forestcrypt-2b (DG_ForestCrypt, generated, 15 Räume) | sunkencrypt-2c (DG_SunkenCrypt, generated, 10 Räume) | steingrab-42167a42 (2.0, steingrab, erzeugt, Seeds <zahl>/<zahl>/<zahl>, Prüfsumme 021bc22c) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-zwei (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme fc1cbe79) | k1d-drei (2.0, steingrab, erzeugt, Seeds 9/<zahl>/951336992, Prüfsumme a4de7f93)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15677:de388d4f316cf700 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "  ids cave-2a forestcrypt-2b steingrab-42167a42",
  "log 50:727474c6dbb56d4f:[Dungeon] Entrance 'Vault1' @ 3,3 → stonevault-3",
  "  entrance {\"zoneKey\":\"3,3\",\"pos\":{\"x\":192,\"y\":10,\"z\":192},\"feature\":\"Vault1\",\"dungeonId\":\"stonevault-3x3\",\"base\":\"DG_StoneVault\",\"seed\":1000}",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,192) → stonevault-3x3 [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign cave-2a (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Dungeon-Eingang in der Nähe (≤16 m)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign steingrab-42167a42 (Nah) = {\"ok\":false,\"active\":false,\"message\":\"Zuweisung fehlgeschlagen: kein 1.0-Dokument unter 'steingrab-42167a42' — 2.0-Dokumente lassen sich (noch) nicht zuweisen\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon assign cave-2a (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → cave-2a\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon entrances (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,192) → cave-2a [fest]\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "log 89:d5dd0335bffe73ed:[Dungeon] Instance 'cave-2a' materialized in wor",
  "> dungeon enter (Nah) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: Cave #2a\"}",
  "peer Nah dungeonId=\"cave-2a\" dungeonReturn={\"x\":190,\"y\":10,\"z\":195} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "> dungeon leave (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon leave (Nah) = {\"ok\":false,\"active\":false,\"message\":\"Du bist in keinem Dungeon\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode cave-2a regen (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → cave-2a: würfelt bei jedem Betreten neu\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode forestcrypt-2b regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Eingang zeigt auf: forestcrypt-2b\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode cave-2a fixed (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → cave-2a: fest\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode steingrab-42167a42 regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Eingang zeigt auf: steingrab-42167a42\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode cave-2a bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,192) → cave-2a [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon steinkit cave-2a wand=foo (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15677:de388d4f316cf700 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "log 50:874725001659ca98:[Dungeon] Instance 'cave-2a' destroyed (1068 ZDO",
  "> dungeon steinkit cave-2a wand=stein_moos decke=stein_clean boden=stein_wet moos=2 frost=9 nass=1 kachel=2 deckenkachel=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":2,\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15948:04d3caf0e7b7b7c3 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a room=1 moos=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a Raum 1: Steinmaterial gesetzt — {\\\"verwitterung\\\":{\\\"moos\\\":3}}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=16019:16afde125f6dda9c i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a room=99 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Raumindex 99 liegt ausserhalb — cave-2a hat 52 Räume (0..51)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=16019:16afde125f6dda9c i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a room=x (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Raumindex: room=x\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=16019:16afde125f6dda9c i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: bogus — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=16019:16afde125f6dda9c i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a moos=abc (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"deckeTextur\\\":\\\"/assets/models/stein_clean.png\\\",\\\"bodenTextur\\\":\\\"/assets/models/stein_wet.png\\\",\\\"verwitterung\\\":{\\\"frost\\\":4,\\\"nass\\\":1},\\\"kachelM\\\":2,\\\"deckeKachelM\\\":3}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=16005:bacc87d47fba6c78 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit cave-2a room=1 reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a Raum 1: Steinmaterial gelöscht — es gilt wieder das des Dokuments\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15934:7c990bf5b9d582f7 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon steinkit steingrab-42167a42 reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: steingrab-42167a42\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15934:7c990bf5b9d582f7 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a (Ich) = {\"ok\":false,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 1.00 (Vorgabe, Feld nicht gesetzt) — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15934:7c990bf5b9d582f7 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a 0 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 0.00 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15954:a67232c2e60070a1 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 0.50 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15956:c60ab85e48ac0b6d i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a (Ich) = {\"ok\":false,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 0.50 — Aufruf: dungeon licht <id> <0..3> | dungeon licht <id> reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15956:c60ab85e48ac0b6d i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a abc (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine Zahl: abc\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15956:c60ab85e48ac0b6d i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a 9 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 9 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15956:c60ab85e48ac0b6d i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a 1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 1.00 gesetzt (wie die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15954:c1cac257b2cc702d i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a 2.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 2.50 gesetzt (heller als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15956:d8993bf787fef84b i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht cave-2a reset (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung gelöscht — es gilt wieder die Umgebung (1)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15934:7c990bf5b9d582f7 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon licht steingrab-42167a42 0.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: steingrab-42167a42\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=15934:7c990bf5b9d582f7 i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon regen cave-2a 99 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a neu generiert (Seed 99, 35 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon regen steingrab-42167a42 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: steingrab-42167a42\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=4955:d8237c92ba610f8d i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon regen forestcrypt-2b (Ich) = {\"ok\":true,\"active\":false,\"message\":\"forestcrypt-2b neu generiert (Seed <zahl>, 16 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=5225:c08ba77ed9385f43 i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-42167a42.json=251:ddee4f7225fa6055 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "log 88:6a8358b8497d133f:[Dungeon] Instance 'cave-2a' materialized in wor",
  "> dungeon enter cave-2a (Ich) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: Cave #63\"}",
  "peer Ich dungeonId=\"cave-2a\" dungeonReturn={\"x\":1,\"y\":2,\"z\":3} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 35 Räume) [aktiv, 1 Spieler] | forestcrypt-2b (DG_ForestCrypt, generated, 16 Räume) | sunkencrypt-2c (DG_SunkenCrypt, generated, 10 Räume) | steingrab-42167a42 (2.0, steingrab, erzeugt, Seeds <zahl>/<zahl>/<zahl>, Prüfsumme 021bc22c) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-zwei (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme fc1cbe79) | k1d-drei (2.0, steingrab, erzeugt, Seeds 9/<zahl>/951336992, Prüfsumme a4de7f93)\"}",
  "peer Ich dungeonId=\"cave-2a\" dungeonReturn={\"x\":1,\"y\":2,\"z\":3} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "> dungeon leave (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "log 143:69f556aac1807fb4:[Dungeon] Instance 'steingrab-42167a42' (2.0) ma",
  "> dungeon enter steingrab-42167a42 (Ich) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: steingrab #42167a42\"}",
  "peer Ich dungeonId=\"steingrab-42167a42\" dungeonReturn={\"x\":1,\"y\":2,\"z\":3} position={\"x\":2,\"y\":0,\"z\":2} worldId=\"dungeon:steingrab-42167a42\" char=0:0",
  "log 58:9a52ea53e0561e96:[Dungeon] Instance 'steingrab-42167a42' destroye",
  "> dungeon reset steingrab-42167a42 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz steingrab-42167a42 zurückgesetzt\"}",
  "peer Ich dungeonId=\"steingrab-42167a42\" dungeonReturn={\"x\":1,\"y\":2,\"z\":3} position={\"x\":2,\"y\":0,\"z\":2} worldId=\"dungeon:steingrab-42167a42\" char=0:0",
  "warn 109:e52b12a459d20149:[WoV] Peer \"Ich\": Welt \"dungeon:steingrab-42167a",
  "> dungeon leave (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "log 49:098e9327c872989f:[Dungeon] Instance 'cave-2a' destroyed (686 ZDOs",
  "> dungeon reset cave-2a (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz cave-2a zurückgesetzt\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon delete steingrab-42167a42 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon steingrab-42167a42 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/forestcrypt-2b.json=5225:c08ba77ed9385f43 i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon delete forestcrypt-2b (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon forestcrypt-2b gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(192,192) → cave-2a [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 35 Räume) | sunkencrypt-2c (DG_SunkenCrypt, generated, 10 Räume) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-zwei (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme fc1cbe79) | k1d-drei (2.0, steingrab, erzeugt, Seeds 9/<zahl>/951336992, Prüfsumme a4de7f93)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1d/cave-2a.json=10593:7c9689121142b9eb i1-form-k1d/entrances.json=209:195c1a2e1f527c24 i1-form-k1d/k1d-drei.json=252:5abd5821168fe294 i1-form-k1d/k1d-zwei.json=254:078bc6d7e637ccb4 i1-form-k1d/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1d/sunkencrypt-2c.json=2778:15dc55ce5a83f4d7",
  "  resolveDungeonBase on the instance [\"DG_Cave\",\"DG_ForestCrypt\",null,null]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 35 Räume) | sunkencrypt-2c (DG_SunkenCrypt, generated, 10 Räume) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-zwei (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme fc1cbe79) | k1d-drei (2.0, steingrab, erzeugt, Seeds 9/<zahl>/951336992, Prüfsumme a4de7f93)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"ersatz (DG_Cave, generated, 1 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"ersatz (DG_Cave, generated, 1 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0"
 ]
};

// ── [2i] Behaviour of step 1, package D, after the attack (N1): spellings, boundaries, values with '=', precedence, empty ids, dungeons replaced after its first use ──

/** The command lines of N1 that both sequences run; `<1>` is a 1.0 document, `<2>` a 2.0 document of the sequence. */
const N1_D_STEINKIT = ['RESET', 'WAND=stein_moos', 'MOOS=2', 'ROOM=0 moos=1', 'kachel=2=3', 'wand=stein_moos=x', 'wand=foo bogus', 'bogus wand=foo'];
const N1_D_LICHT = ['3.0001', '3.5', '0.95', '1.05'];
/** Seeds at and beyond 2^31: `| 0` wraps them, a truncation would not. */
const N1_D_SEEDS = ['2147483648', '4294967301'];
/** Arguments of a call as text: objects of a class (a live instance with its ZDO space) by their class name, bigints with `n`. */
const argText = (x: unknown): string => JSON.stringify(x, (schl, v: unknown) => (typeof v === 'bigint' ? `${v}n` : schl !== '' && v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? `<${(v as object).constructor?.name ?? 'object'}>` : v));
/** The same sequence on a stand-in: ids in another spelling (`D1`), keywords of steinkit in capitals, boundaries of licht and of the seeds, an entrance at x.6, an instance without players, empty ids straight into the handler, `dungeons` replaced after its first use. */
function messeDungeonAttrappeN1(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  try {
    mitZufall(41, () => {
      // dc has a live instance without players; the entrances lie at x.6 and x.5 (toFixed rounds them up, floor would not)
      const { k, ziel, reg, docs1, zustand, mach } = dungeonAttrappe(a, {
        getInstance: (id) => (id === 'd1' ? { players: new Set([1, 2]) } : id === 'dc' ? { players: new Set() } : undefined),
        listEntrances: () => [{ zoneKey: '3,3', feature: 'Vault1', pos: { x: 192.6, y: 10, z: 0.5 }, dungeonId: 'd1', regenerateOnEnter: false }, { zoneKey: '4,4', feature: 'Cave2', pos: { x: -0.6, y: 0, z: 255.5 }, dungeonId: 'e2', regenerateOnEnter: true }],
      });
      zustand.liste = true; zustand.eingaenge = true;
      versuche(a, () => F['registerDungeonCommand']!(k));
      const ich = (o: Record<string, unknown> = {}): Record<string, unknown> => peerD(a, 'Ich', o);
      const nah = (): Record<string, unknown> => peerD(a, 'Ich', { position: { x: 999, y: 0, z: 0 } });
      const docs = (): void => { a.notizen.push(`  docs ${JSON.stringify(docs1)}`); };
      const ex = (zeile: string, p: Record<string, unknown> = ich()): void => befehlD(a, reg, zeile, p);
      // an instance without players in the list, the entrances at x.6
      for (const z of ['dungeon list', 'dungeon entrances']) ex(z);
      // D-1: every id in another spelling than the document's (`D1`), and a wished id of create2 in capitals
      for (const z of ['dungeon entrance-mode D1 regen', 'dungeon regen D1 5', 'dungeon steinkit D1 reset', 'dungeon licht D1 0.5', 'dungeon reset D1', 'dungeon delete D1', 'dungeon create2 steingrab 5 MEINID', 'dungeon create2 steingrab 5 Mein-Id 0.5']) ex(z);
      ex('dungeon assign D1', nah());
      ex('dungeon assign E2', nah());
      // D-2, D-6, D-7: keywords of steinkit in capitals, values with a second '=', an unknown texture together with an unknown key
      for (const z of N1_D_STEINKIT) { ex(`dungeon steinkit d1 ${z}`); docs(); }
      // D-3: just above the upper limit of licht, and next to 1 on both sides
      for (const z of N1_D_LICHT) { ex(`dungeon licht d1 ${z}`); docs(); }
      // D-4: seeds at and beyond 2^31 for create, create2 and regen
      for (const s of N1_D_SEEDS) for (const z of [`dungeon create cave ${s}`, `dungeon create2 steingrab ${s}`, `dungeon regen d1 ${s}`]) ex(z);
      // D-11: an empty id straight into the handler (the registry never produces one): no call into dungeons
      const h = (reg as unknown as { handlers: Map<string, Handler> }).handlers.get('dungeon');
      for (const args of [['regen', ''], ['regen', '', '5'], ['steinkit', '', 'reset'], ['steinkit', '', 'moos=1'], ['licht', '', '0.5'], ['licht', ''], ['reset', ''], ['delete', ''], ['entrance-mode', '', 'regen']]) {
        try { a.notizen.push(`> direct ${JSON.stringify(args)} = ${JSON.stringify(h?.(ich(), [...args]))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> direct ${JSON.stringify(args)} throws ${(e as Error).name}`); }
      }
      // D-9: dungeons used once in every branch, THEN replaced; every branch again: each call must reach the replacement (dungeonsNeu)
      const zweige = ['dungeon delete d1', 'dungeon steinkit d1 moos=1', 'dungeon licht d1 0.5', 'dungeon entrances', 'dungeon entrance-mode d1 fixed', 'dungeon regen d1 7', 'dungeon create2 steingrab 7 n1-id', 'dungeon create cave 7', 'dungeon reset d1', 'dungeon list'];
      for (const z of zweige) ex(z);
      ex('dungeon assign d1', nah());
      ex('dungeon enter', nah());
      ziel['dungeons'] = mach('dungeonsNeu');
      for (const z of zweige) ex(z);
      ex('dungeon assign d1', nah());
      ex('dungeon enter', nah());
      docs();
      // D-10: names that differ from a kit only by an accent or a special letter form
      for (const x of ['cavé', 'ſunkencrypt', 'CAVÉ', 'cavé', 'forestcrypt ', 'ForestCrypt​']) {
        try { a.notizen.push(`resolveDungeonBase ${JSON.stringify(x)} = ${JSON.stringify(F['resolveDungeonBase']!(k, x))}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`resolveDungeonBase ${JSON.stringify(x)} throws ${(e as Error).name}`); }
      }
      ex('dungeon create cavé 3');
    });
  } finally {
    ruecksetzen();
  }
  return a;
}

/** N1 on a real instance: the same lines with real documents, two real entrances (one at x.6), an instance left without players, and the real manager replaced by a recording wrapper after its first use. */
function messeDungeonEchtN1(): Aufzeichnung {
  const a = neueAufzeichnung();
  const ruecksetzen = konsole(a);
  const tmp = mkdtempSync(join(tmpdir(), 'i1-form-k-'));
  try {
    mitZufall(43, () => {
      mkdirSync(join(tmp, 'generiert'), { recursive: true });
      const server = createWovServer({
        port: 0, worldFeatures: false, worldName: 'i1-form-k1dn1', everyoneAdmin: true,
        worldsDir: join(tmp, 'worlds'), kontenDir: join(tmp, 'konten'), forumDir: join(tmp, 'forum'), generiertDir: join(tmp, 'generiert'),
      } as never) as unknown as Record<string, unknown>;
      const haupt = { id: HAUPTWELT_ID, zdos: new ZDOManager(1n), heightmaps: { listTerrainComps: (): unknown[] => { zaehle(a, 'listTerrainComps'); return []; } } };
      (server['welten'] as Map<string, unknown>).set(HAUPTWELT_ID, haupt);
      server['hauptwelt'] = haupt;
      server['getGroundHeight'] = (x: number, z: number): number => { zaehle(a, 'getGroundHeight'); return x * 0.5 + z * 0.25 + 0.0625; };
      const reg = server['adminCommands'] as AdminCommandRegistry;
      const echt = server['dungeons'] as Record<string, (...x: unknown[]) => unknown>;
      const wurzel = (server['dungeonsWurzel'] as () => string).call(server);
      const platte = (): void => {
        const dateien = readdirSync(wurzel, { recursive: true }).map(String).filter((f) => f.endsWith('.json')).sort();
        a.notizen.push(`  disk ${dateien.map((f) => `${f}=${kennung(Buffer.from(normD(readFileSync(join(wurzel, f), 'utf8'), tmp)))}`).join(' ')}`);
      };
      const ich = peerD(a, 'Ich', { userId: 21 });
      const ex = (zeile: string, p: Record<string, unknown> = ich): void => befehlD(a, reg, zeile, p, tmp);
      for (const z of ['dungeon create cave 42', 'dungeon create forestcrypt 43', 'dungeon create2 steingrab 7', 'dungeon create2 steingrab 8 K1D-GROSS 0.5']) ex(z);
      platte();
      const ids = (echt['listDocuments']!.call(echt) as { id: string }[]).map((d) => d.id);
      const d1 = ids[0] ?? 'fehlt';
      const dB = ids[1] ?? 'fehlt';
      const d2 = ((echt['listDokumente2']!.call(echt) as { id: string }[])[0]?.id) ?? 'fehlt';
      const D1 = d1.toUpperCase();
      a.notizen.push(`  ids ${d1} ${dB} ${d2}`);
      for (const [f, z, pos] of [['Vault1', '3,3', { x: 192.6, y: 10, z: 192.5 }], ['Vault2', '5,5', { x: 320.4, y: 10, z: 319.6 }]] as const) a.notizen.push(`  entrance ${JSON.stringify(echt['registerEntrance']!.call(echt, f, getStableHash('DG_StoneVault'), z, { ...pos }, 1000))}`);
      const nah = peerD(a, 'Nah', { userId: 22, position: { x: 190, y: 10, z: 195 } });
      ex('dungeon entrances');
      // D-1: ids in capitals
      for (const z of [`dungeon assign ${D1}`, `dungeon assign ${d1}`]) ex(z, nah);
      for (const z of [`dungeon entrance-mode ${D1} regen`, `dungeon steinkit ${D1} reset`, `dungeon licht ${D1} 0.5`, `dungeon regen ${D1} 5`, `dungeon reset ${D1}`, `dungeon delete ${D1}`, `dungeon enter ${d2.toUpperCase()}`]) { ex(z); platte(); }
      // D-2, D-6, D-7, D-3
      for (const z of N1_D_STEINKIT) { ex(`dungeon steinkit ${d1} ${z}`); platte(); }
      for (const z of N1_D_LICHT) { ex(`dungeon licht ${d1} ${z}`); platte(); }
      // D-4: seeds at and beyond 2^31
      for (const s of N1_D_SEEDS) for (const z of [`dungeon create cave ${s}`, `dungeon create2 steingrab ${s}`, `dungeon regen ${dB} ${s}`]) { ex(z); platte(); }
      // D-8: enter and leave: the instance stays, without players, and list shows it
      for (const z of [`dungeon enter ${d1}`, 'dungeon leave', 'dungeon list']) ex(z);
      // D-11: empty ids straight into the handler
      const h = (reg as unknown as { handlers: Map<string, Handler> }).handlers.get('dungeon');
      for (const args of [['regen', ''], ['steinkit', '', 'reset'], ['licht', '', '0.5'], ['reset', ''], ['delete', '']]) {
        try { a.notizen.push(`> direct ${JSON.stringify(args)} = ${normD(JSON.stringify(h?.(ich, [...args])), tmp)}`); } catch (e) { a.ausnahmen.push((e as Error).name); a.notizen.push(`> direct ${JSON.stringify(args)} throws ${(e as Error).name}`); }
      }
      // D-9: the real manager behind a recording wrapper after its first use in every branch; every branch again must go through the wrapper
      const zweige = [`dungeon steinkit ${d1} moos=1`, `dungeon licht ${d1} 0.5`, 'dungeon entrances', `dungeon entrance-mode ${d1} fixed`, `dungeon regen ${d1} 7`, 'dungeon create2 steingrab 7 k1dn1-id', 'dungeon list', `dungeon reset ${d1}`];
      for (const z of ['dungeon enter', 'dungeon leave']) ex(z, nah);
      server['dungeons'] = new Proxy(echt, {
        get(t, p, r) {
          const v = Reflect.get(t, p, r) as unknown;
          if (typeof v !== 'function' || typeof p !== 'string') return v;
          return (...x: unknown[]): unknown => { zaehle(a, `dungeonsNeu.${p}`); a.notizen.push(`  call dungeonsNeu.${p} ${normD(argText(x), tmp)}`); return (v as (...y: unknown[]) => unknown).apply(t, x); };
        },
      });
      for (const z of zweige) ex(z);
      for (const z of [`dungeon assign ${d1}`, 'dungeon enter', 'dungeon leave']) ex(z, nah);
      ex(`dungeon delete ${d2}`);
      platte();
      (server['kontenDb'] as { close?: () => void } | undefined)?.close?.();
    });
  } finally {
    ruecksetzen();
    rmSync(tmp, { recursive: true, force: true });
  }
  return a;
}

/** Measured on the stand before the move (`--messen-basis` on c19d4fe8), package D after the attack (N1). */
const SOLL_DUNGEON_ATTRAPPE_N1: Aufzeichnung = {
 "paket": [],
 "aufrufe": {
  "k.adminCommands": 1,
  "k.dungeons": 99,
  "dungeons.listDocuments": 2,
  "dungeons.listDokumente2": 2,
  "dungeons.getInstance": 8,
  "dungeons.listEntrances": 2,
  "dungeons.eingangZuDungeon": 2,
  "dungeons.getDocument": 20,
  "dungeons.destroyInstance": 11,
  "dungeons.deleteDocument": 2,
  "dungeons.erzeugeDungeon2": 5,
  "dungeons.hatDokument": 3,
  "dungeons.saveDocument": 6,
  "k.resolveDungeonBase": 5,
  "resolveDungeonBase": 5,
  "dungeons.createGenerated": 6,
  "dungeons.setzeEingangsModus": 1,
  "dungeons.findEntranceNear": 2,
  "dungeons.assignEntrance": 1,
  "k.enterDungeon": 2,
  "enterDungeon": 2,
  "dungeonsNeu.deleteDocument": 1,
  "dungeonsNeu.getDocument": 3,
  "dungeonsNeu.saveDocument": 2,
  "dungeonsNeu.destroyInstance": 4,
  "dungeonsNeu.listEntrances": 1,
  "dungeonsNeu.eingangZuDungeon": 1,
  "dungeonsNeu.setzeEingangsModus": 1,
  "dungeonsNeu.createGenerated": 2,
  "dungeonsNeu.erzeugeDungeon2": 1,
  "dungeonsNeu.listDocuments": 1,
  "dungeonsNeu.listDokumente2": 1,
  "dungeonsNeu.getInstance": 4,
  "dungeonsNeu.hatDokument": 1,
  "dungeonsNeu.findEntranceNear": 2,
  "dungeonsNeu.assignEntrance": 1
 },
 "konsole": {
  "log": 0,
  "warn": 0
 },
 "zustand": [],
 "ausnahmen": [],
 "notizen": [
  "  register dungeon",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "  call dungeons.getInstance [\"d1\"]",
  "  call dungeons.getInstance [\"dc\"]",
  "  call dungeons.getInstance [\"dfail\"]",
  "  call dungeons.getInstance [\"e2\"]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) [aktiv, 0 Spieler] | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(193,1) → d1 [fest] | Cave2@(-1,256) → e2 [regen]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"D1\"]",
  "> dungeon entrance-mode D1 regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Eingang zeigt auf: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"D1\"]",
  "> dungeon regen D1 5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"D1\"]",
  "> dungeon steinkit D1 reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"D1\"]",
  "> dungeon licht D1 0.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.destroyInstance [\"D1\"]",
  "> dungeon reset D1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.deleteDocument [\"D1\"]",
  "> dungeon delete D1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"MEINID\",null]",
  "> dungeon create2 steingrab 5 MEINID (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: MEINID (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},\"Mein-Id\",0.5]",
  "> dungeon create2 steingrab 5 Mein-Id 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: Mein-Id (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 0.50 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"D1\"]",
  "> dungeon assign D1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: D1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"E2\"]",
  "> dungeon assign E2 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: E2\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 RESET (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: RESET — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 WAND=stein_moos (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: WAND=stein_moos — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 MOOS=2 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: MOOS=2 — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 ROOM=0 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: ROOM=0 — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"kachelM\":2}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 kachel=2=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 wand=stein_moos=x (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 wand=foo bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon steinkit d1 bogus wand=foo (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 3.0001 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 3.0001 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "> dungeon licht d1 3.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 3.5 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2}},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2},\"ambientLicht\":0.95}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0.95 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.95 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2},\"ambientLicht\":0.95},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2},\"ambientLicht\":1.05}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 1.05 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 1.05 gesetzt (heller als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"kachelM\":2},\"ambientLicht\":1.05},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",-2147483648,null,null]",
  "> dungeon create cave 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu--<zahl> (4 Räume, Seed -<zahl>, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":2147483648,\"material\":3903345492,\"deko\":2340155043},null,null]",
  "> dungeon create2 steingrab 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed -<zahl>, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",-2147483648,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed -<zahl>, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",5,null,null]",
  "> dungeon create cave 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-5 (4 Räume, Seed 5, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":5,\"material\":784992901,\"deko\":1139810000},null,null]",
  "> dungeon create2 steingrab 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-neu (Thema steingrab, Seed 5, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",5,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 5, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> direct [\"regen\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "> direct [\"regen\",\"\",\"5\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "> direct [\"steinkit\",\"\",\"reset\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"steinkit\",\"\",\"moos=1\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"licht\",\"\",\"0.5\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"licht\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"reset\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: \"}",
  "> direct [\"delete\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "> direct [\"entrance-mode\",\"\",\"regen\"] = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon entrance-mode <dungeonId> <fixed|regen>\"}",
  "  call dungeons.deleteDocument [\"d1\"]",
  "> dungeon delete d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon d1 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":1.05}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 moos=1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":1},\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":0.5}]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.50 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(193,1) → d1 [fest] | Cave2@(-1,256) → e2 [regen]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.eingangZuDungeon [\"d1\"]",
  "  call dungeons.setzeEingangsModus [\"d1\",\"fixed\"]",
  "> dungeon entrance-mode d1 fixed (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → d1: fest\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.getDocument [\"d1\"]",
  "  call dungeons.createGenerated [\"DG_ForestCrypt\",7,\"d1\"]",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon regen d1 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 7, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.erzeugeDungeon2 [\"steingrab\",{\"architektur\":7,\"material\":2520902017,\"deko\":879019654},\"n1-id\",null]",
  "> dungeon create2 steingrab 7 n1-id (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: n1-id (Thema steingrab, Seed 7, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeons.createGenerated [\"DG_Cave\",7,null,null]",
  "> dungeon create cave 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-7 (4 Räume, Seed 7, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.destroyInstance [\"d1\"]",
  "> dungeon reset d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz d1 zurückgesetzt\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.listDocuments []",
  "  call dungeons.listDokumente2 []",
  "  call dungeons.getInstance [\"d1\"]",
  "  call dungeons.getInstance [\"dc\"]",
  "  call dungeons.getInstance [\"dfail\"]",
  "  call dungeons.getInstance [\"e2\"]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) [aktiv, 0 Spieler] | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeons.hatDokument [\"d1\"]",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeons.assignEntrance [\"3,3\",\"d1\"]",
  "> dungeon assign d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → d1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeons.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call enterDungeon Ich \"nah\" receiver=context",
  "> dungeon enter (Ich) = {\"ok\":true,\"active\":true,\"message\":\"enter:nah\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.deleteDocument [\"d1\"]",
  "> dungeon delete d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon d1 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"d1\"]",
  "  call dungeonsNeu.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":0.5}]",
  "  call dungeonsNeu.destroyInstance [\"d1\"]",
  "> dungeon steinkit d1 moos=1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":1},\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"d1\"]",
  "  call dungeonsNeu.saveDocument [{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":0.5}]",
  "  call dungeonsNeu.destroyInstance [\"d1\"]",
  "> dungeon licht d1 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1: Grundbeleuchtung 0.50 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(193,1) → d1 [fest] | Cave2@(-1,256) → e2 [regen]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.eingangZuDungeon [\"d1\"]",
  "  call dungeonsNeu.setzeEingangsModus [\"d1\",\"fixed\"]",
  "> dungeon entrance-mode d1 fixed (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → d1: fest\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"d1\"]",
  "  call dungeonsNeu.createGenerated [\"DG_ForestCrypt\",7,\"d1\"]",
  "  call dungeonsNeu.destroyInstance [\"d1\"]",
  "> dungeon regen d1 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 neu generiert (Seed 7, 4 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.erzeugeDungeon2 [\"steingrab\",{\"architektur\":7,\"material\":2520902017,\"deko\":879019654},\"n1-id\",null]",
  "> dungeon create2 steingrab 7 n1-id (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: n1-id (Thema steingrab, Seed 7, Prüfsumme PX, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call resolveDungeonBase \"cave\" receiver=context",
  "  call dungeonsNeu.createGenerated [\"DG_Cave\",7,null,null]",
  "> dungeon create cave 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: neu-7 (4 Räume, Seed 7, Zone 48)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.destroyInstance [\"d1\"]",
  "> dungeon reset d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Instanz d1 zurückgesetzt\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.listDocuments []",
  "  call dungeonsNeu.listDokumente2 []",
  "  call dungeonsNeu.getInstance [\"d1\"]",
  "  call dungeonsNeu.getInstance [\"dc\"]",
  "  call dungeonsNeu.getInstance [\"dfail\"]",
  "  call dungeonsNeu.getInstance [\"e2\"]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"d1 (DG_ForestCrypt, generated, 3 Räume) [aktiv, 2 Spieler] | dc (DG_Cave, custom, 2 Räume) [aktiv, 0 Spieler] | dfail (DG_SunkenCrypt, generated, 1 Räume) | e2 (2.0, steingrab, erzeugt, Seeds 1/2/3, Prüfsumme P2)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.hatDokument [\"d1\"]",
  "  call dungeonsNeu.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call dungeonsNeu.assignEntrance [\"3,3\",\"d1\"]",
  "> dungeon assign d1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → d1\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.findEntranceNear [{\"x\":999,\"y\":0,\"z\":0},16]",
  "  call enterDungeon Ich \"nah\" receiver=context",
  "> dungeon enter (Ich) = {\"ok\":true,\"active\":true,\"message\":\"enter:nah\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":999,\"y\":0,\"z\":0} worldId=\"haupt\" char=0:0",
  "  docs {\"d1\":{\"id\":\"d1\",\"base\":\"DG_ForestCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1},{\"i\":2}]},\"zoneSize\":64,\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":0.5},\"dc\":{\"id\":\"dc\",\"base\":\"DG_Cave\",\"mode\":\"custom\",\"layout\":{\"rooms\":[{\"i\":0},{\"i\":1}]},\"zoneSize\":32},\"dfail\":{\"id\":\"dfail\",\"base\":\"DG_SunkenCrypt\",\"mode\":\"generated\",\"layout\":{\"rooms\":[{\"i\":0}]},\"zoneSize\":64,\"ambientLicht\":0.25}}",
  "resolveDungeonBase \"cavé\" = null",
  "resolveDungeonBase \"ſunkencrypt\" = null",
  "resolveDungeonBase \"CAVÉ\" = null",
  "resolveDungeonBase \"cavé\" = null",
  "resolveDungeonBase \"forestcrypt \" = null",
  "resolveDungeonBase \"ForestCrypt​\" = null",
  "  call resolveDungeonBase \"cavé\" receiver=context",
  "> dungeon create cavé 3 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Aufruf: dungeon create <basis> [seed] [räume] [zone] — Basis z. B. forestcrypt, sunkencrypt, cave; räume/zone leer = Kit-Vorgabe\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0"
 ]
};
const SOLL_DUNGEON_ECHT_N1: Aufzeichnung = {
 "paket": [
  "Ich:Teleport:110:f105a95e30481800",
  "Ich:Teleport:40:41c7ae408d25e74f",
  "Nah:Teleport:110:f105a95e30481800",
  "Nah:Teleport:40:953e6e118ba67c99",
  "Nah:Teleport:52:a5fccccadc0313c6",
  "Nah:Teleport:40:953e6e118ba67c99"
 ],
 "aufrufe": {
  "weltWechselVorbereiten": 6,
  "listTerrainComps": 3,
  "dungeonsNeu.getDocument": 4,
  "dungeonsNeu.saveDocument": 2,
  "dungeonsNeu.destroyInstance": 4,
  "dungeonsNeu.listEntrances": 1,
  "dungeonsNeu.eingangZuDungeon": 1,
  "dungeonsNeu.setzeEingangsModus": 1,
  "dungeonsNeu.createGenerated": 1,
  "dungeonsNeu.erzeugeDungeon2": 1,
  "dungeonsNeu.listDocuments": 1,
  "dungeonsNeu.listDokumente2": 1,
  "dungeonsNeu.getInstance": 10,
  "dungeonsNeu.hatDokument": 1,
  "dungeonsNeu.findEntranceNear": 2,
  "dungeonsNeu.assignEntrance": 1,
  "dungeonsNeu.vorBetreten": 1,
  "dungeonsNeu.getOrCreateInstance": 1,
  "dungeonsNeu.getDokument2": 1,
  "dungeonsNeu.getSpawnPoint": 1,
  "dungeonsNeu.deleteDocument": 1
 },
 "konsole": {
  "log": 9,
  "warn": 0
 },
 "zustand": [],
 "ausnahmen": [],
 "notizen": [
  "log 53:f911fa34cfc45148:[Konto] Spalte konten.avatar_charakter_id nachge",
  "log 42:0bcdb099a81be718:[Konto] Spalte konten.token_ab nachgezogen",
  "log 44:1f27737a280d0efa:[Konto] Spalte konten.spieler_ab nachgezogen",
  "log 45:63bbb1146dd82dc1:[Konto] Spalte konten.profil_text nachgezogen",
  "> dungeon create cave 42 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: cave-2a (52 Räume, Seed 42, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create forestcrypt 43 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: forestcrypt-2b (36 Räume, Seed 43, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 steingrab 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-7 (Thema steingrab, Seed 7, Prüfsumme caf13fad, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon create2 steingrab 8 K1D-GROSS 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: k1d-gross (Thema steingrab, Seed 8, Prüfsumme 9438974a, Grundhelligkeit 0.50 je Dokument)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "  ids cave-2a forestcrypt-2b steingrab-7",
  "log 50:727474c6dbb56d4f:[Dungeon] Entrance 'Vault1' @ 3,3 → stonevault-3",
  "  entrance {\"zoneKey\":\"3,3\",\"pos\":{\"x\":192.6,\"y\":10,\"z\":192.5},\"feature\":\"Vault1\",\"dungeonId\":\"stonevault-3x3\",\"base\":\"DG_StoneVault\",\"seed\":1000}",
  "log 50:83b80fbc7d38c4cc:[Dungeon] Entrance 'Vault2' @ 5,5 → stonevault-5",
  "  entrance {\"zoneKey\":\"5,5\",\"pos\":{\"x\":320.4,\"y\":10,\"z\":319.6},\"feature\":\"Vault2\",\"dungeonId\":\"stonevault-5x5\",\"base\":\"DG_StoneVault\",\"seed\":1000}",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(193,193) → stonevault-3x3 [fest] | Vault2@(320,320) → stonevault-5x5 [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon assign CAVE-2A (Nah) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: CAVE-2A\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon assign cave-2a (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → cave-2a\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "> dungeon entrance-mode CAVE-2A regen (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Kein Eingang zeigt auf: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit CAVE-2A reset (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon licht CAVE-2A 0.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon regen CAVE-2A 5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon reset CAVE-2A (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon delete CAVE-2A (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: CAVE-2A\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon enter STEINGRAB-7 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: STEINGRAB-7\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a RESET (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: RESET — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a WAND=stein_moos (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: WAND=stein_moos — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a MOOS=2 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: MOOS=2 — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a ROOM=0 moos=1 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Angabe: ROOM=0 — Aufruf: dungeon steinkit <id> [room=<i>] wand=<name> decke=<name> boden=<name> moos=<0..4> frost=<0..4> nass=<0..4> kachel=<m> deckenkachel=<m> | [room=<i>] reset\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15677:de388d4f316cf700 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a kachel=2=3 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Steinmaterial gesetzt — {\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15711:d1a18a87fe6b961a i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a wand=stein_moos=x (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15760:729acecbf4b75890 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a wand=foo bogus (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15760:729acecbf4b75890 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon steinkit cave-2a bogus wand=foo (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Unbekannte Textur \\\"foo\\\" — erlaubt: stein_clean, stein_decke, stein_fels, stein_moos, stein_frost, stein_tripo_rock, stein_wet\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15760:729acecbf4b75890 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon licht cave-2a 3.0001 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 3.0001 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15760:729acecbf4b75890 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon licht cave-2a 3.5 (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Grundbeleuchtung muss zwischen 0 und 3 liegen — 3.5 liegt ausserhalb\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15760:729acecbf4b75890 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon licht cave-2a 0.95 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 0.95 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:e55dbbb8093be01c i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon licht cave-2a 1.05 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 1.05 gesetzt (heller als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon create cave 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: cave-80000000 (27 Räume, Seed -<zahl>, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31",
  "> dungeon create2 steingrab 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-80000000 (Thema steingrab, Seed -<zahl>, Prüfsumme 9432207e, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=10571:f49f9561a5364c91 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874",
  "> dungeon regen forestcrypt-2b 2147483648 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"forestcrypt-2b neu generiert (Seed -<zahl>, 38 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=11619:ad387c31095063b7 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874",
  "> dungeon create cave 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon erzeugt: cave-5 (46 Räume, Seed 5, Zone 64)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-5.json=13145:57c9a837e73021e7 i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=11619:ad387c31095063b7 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874",
  "> dungeon create2 steingrab 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: steingrab-5 (Thema steingrab, Seed 5, Prüfsumme 6e06097a, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-5.json=13145:57c9a837e73021e7 i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=11619:ad387c31095063b7 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-5.json=235:afe0978cff0847a7 i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874",
  "> dungeon regen forestcrypt-2b 4294967301 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"forestcrypt-2b neu generiert (Seed 5, 46 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=15783:ff69fd107648b6ec i1-form-k1dn1/cave-5.json=13145:57c9a837e73021e7 i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=14181:e510664b77b82ad7 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/steingrab-5.json=235:afe0978cff0847a7 i1-form-k1dn1/steingrab-7.json=235:0e61ae1ca55d6d31 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874",
  "log 89:d5dd0335bffe73ed:[Dungeon] Instance 'cave-2a' materialized in wor",
  "> dungeon enter cave-2a (Ich) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: Cave #2a\"}",
  "peer Ich dungeonId=\"cave-2a\" dungeonReturn={\"x\":1,\"y\":2,\"z\":3} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "> dungeon leave (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 52 Räume) [aktiv, 0 Spieler] | forestcrypt-2b (DG_ForestCrypt, generated, 46 Räume) | cave-80000000 (DG_Cave, generated, 27 Räume) | cave-5 (DG_Cave, generated, 46 Räume) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-gross (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme 9438974a) | steingrab-80000000 (2.0, steingrab, erzeugt, Seeds <zahl>/<zahl>/<zahl>, Prüfsumme 9432207e) | steingrab-5 (2.0, steingrab, erzeugt, Seeds 5/784992901/<zahl>, Prüfsumme 6e06097a)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "> direct [\"regen\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "> direct [\"steinkit\",\"\",\"reset\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"licht\",\"\",\"0.5\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter 1.0-Dungeon: \"}",
  "> direct [\"reset\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: \"}",
  "> direct [\"delete\",\"\"] = {\"ok\":false,\"active\":false,\"message\":\"Unbekannter Dungeon: \"}",
  "> dungeon enter (Nah) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: Cave #2a\"}",
  "peer Nah dungeonId=\"cave-2a\" dungeonReturn={\"x\":190,\"y\":10,\"z\":195} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "> dungeon leave (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"cave-2a\"]",
  "  call dungeonsNeu.saveDocument [{\"version\":6,\"id\":\"cave-2a\",\"name\":\"Cave #2a\",\"base\":\"DG_Cave\",\"mode\":\"generated\",\"seed\":42,\"zoneSize\":64,\"layout\":{\"rooms\":[{\"room\":\"cave_new_entrance02\",\"pos\":{\"x\":0.<zahl>,\"y\":0,\"z\":12.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":1,\"seed\":25608},{\"room\":\"cave_new_sloperoom04\",\"pos\":{\"x\":-18.<zahl>,\"y\":-8.75,\"z\":6.<zahl>},\"rot\":{\"x\":0,\"y\":-1.1920928955078125e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":2,\"seed\":-137570},{\"room\":\"cave_new_sloperoom04\",\"pos\":{\"x\":18.<zahl>,\"y\":9,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":1.1920928955078125e-7},\"placeOrder\":2,\"seed\":170231},{\"room\":\"cave_new_crossroads01_ice\",\"pos\":{\"x\":-12.<zahl>,\"y\":-17.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":3,\"seed\":-243709},{\"room\":\"cave_new_crossroads01_hole_ice\",\"pos\":{\"x\":-24.<zahl>,\"y\":-8.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-212278},{\"room\":\"cave_shrine_start02_ice\",\"pos\":{\"x\":4.<zahl>,\"y\":-16.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":-168320},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":-7.<zahl>,\"y\":-1.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-77496},{\"room\":\"cave_shrine_shrine01\",\"pos\":{\"x\":8.<zahl>,\"y\":-4.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":-40992},{\"room\":\"cave_shrine_corridor01\",\"pos\":{\"x\":21.<zahl>,\"y\":-16,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-93579},{\"room\":\"cave_shrine_start02_corridor\",\"pos\":{\"x\":5.<zahl>,\"y\":-19.5,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":3,\"seed\":-166002},{\"room\":\"cave_new_sloperoom02\",\"pos\":{\"x\":-12.<zahl>,\"y\":26.75,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":3,\"seed\":162002},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":0.<zahl>,\"y\":16,\"z\":10.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":4,\"seed\":168332},{\"room\":\"cave_shrine_corridor04\",\"pos\":{\"x\":12.<zahl>,\"y\":-21,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":4,\"seed\":-131005},{\"room\":\"cave_shrine_corridor06\",\"pos\":{\"x\":-11.<zahl>,\"y\":14.5,\"z\":15.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":5,\"seed\":113647},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":-24.<zahl>,\"y\":16,\"z\":10.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":4,\"seed\":65828},{\"room\":\"cave_shrine_shrine01\",\"pos\":{\"x\":0.<zahl>,\"y\":-22.5,\"z\":6.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-189310},{\"room\":\"cave_shrine_start02_ice_corridor\",\"pos\":{\"x\":24.<zahl>,\"y\":-21.75,\"z\":-0.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-2.086162567138672e-7},\"placeOrder\":4,\"seed\":-90423},{\"room\":\"cave_shrine_shrine03\",\"pos\":{\"x\":16.<zahl>,\"y\":-22.5,\"z\":17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-97500},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":0.<zahl>,\"y\":0,\"z\":24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":2,\"seed\":51216},{\"room\":\"cave_shrine_endcap_noshrine02\",\"pos\":{\"x\":-30.<zahl>,\"y\":-16.75,\"z\":-5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.7881393432617188e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":3,\"seed\":-285792},{\"room\":\"cave_new_endcap_painting01\",\"pos\":{\"x\":12.<zahl>,\"y\":0,\"z\":24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":3,\"seed\":102468},{\"room\":\"cave_new_endcap02_crystal\",\"pos\":{\"x\":30.<zahl>,\"y\":0,\"z\":17.<zahl>},\"rot\":{\"x\":0,\"y\":1.7881393432617188e-7,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":3,\"seed\":164408},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":-12.<zahl>,\"y\":-17.75,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":-256513},{\"room\":\"cave_new_iceendcap02_crystal\",\"pos\":{\"x\":-30.<zahl>,\"y\":-17.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":3.5762786865234375e-7},\"placeOrder\":5,\"seed\":-320587},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":-24.<zahl>,\"y\":-17.75,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-282157},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-30.<zahl>,\"y\":1,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-3.5762786865234375e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":5,\"seed\":-155221},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-24.<zahl>,\"y\":1,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-142399},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":8.<zahl>,\"y\":-16,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-136298},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":9.<zahl>,\"y\":-16,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-159769},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":-2.<zahl>,\"y\":-3.25,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-61711},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":-3.<zahl>,\"y\":-3.25,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":-91590},{\"room\":\"cave_shrine_endcap02\",\"pos\":{\"x\":27.<zahl>,\"y\":-16,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":9.834766387939453e-7},\"placeOrder\":6,\"seed\":-67953},{\"room\":\"cave_shrine_endcap\",\"pos\":{\"x\":21.<zahl>,\"y\":-16,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-106383},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":20.<zahl>,\"y\":-16,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-85046},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":11.<zahl>,\"y\":-21,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-171554},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-0.<zahl>,\"y\":36.5,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":279516},{\"room\":\"cave_new_endcap_painting01\",\"pos\":{\"x\":-30.<zahl>,\"y\":17.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-10363},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":-24.<zahl>,\"y\":17.75,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":2459},{\"room\":\"cave_shrine_endcap_noshrine02\",\"pos\":{\"x\":5.<zahl>,\"y\":18.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-2.682209014892578e-7},\"placeOrder\":4,\"seed\":148309},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":-0.<zahl>,\"y\":17.75,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":104963},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":0.<zahl>,\"y\":14.5,\"z\":20.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":171298},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":6.<zahl>,\"y\":14.5,\"z\":14.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":184120},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":18.<zahl>,\"y\":-21,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-105379},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":-11.<zahl>,\"y\":14.5,\"z\":21.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":126451},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":-12.<zahl>,\"y\":14.5,\"z\":9.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":96572},{\"room\":\"cave_shrine_endcap02\",\"pos\":{\"x\":-23.<zahl>,\"y\":14.5,\"z\":21.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":75199},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":-29.<zahl>,\"y\":14.5,\"z\":15.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":5,\"seed\":36769},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":24.<zahl>,\"y\":-22.75,\"z\":11.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-76136},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":24.<zahl>,\"y\":-21,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-116031},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":30.<zahl>,\"y\":-21,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-77601},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":12.<zahl>,\"y\":-21,\"z\":23.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-92593},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":6.<zahl>,\"y\":-21,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":6,\"seed\":-128889}],\"doors\":[{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-5.<zahl>,\"y\":-3,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":6.<zahl>,\"y\":-3,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-6.<zahl>,\"y\":-20.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-18.<zahl>,\"y\":-3,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":2.<zahl>,\"y\":-5.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":15.<zahl>,\"y\":-18.5,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":5.<zahl>,\"y\":14.75,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":12.<zahl>,\"y\":-23.5,\"z\":-0.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":12.<zahl>,\"y\":-23.5,\"z\":11.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>}}],\"props\":[]},\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":1.05}]",
  "  call dungeonsNeu.destroyInstance [\"cave-2a\"]",
  "log 50:874725001659ca98:[Dungeon] Instance 'cave-2a' destroyed (1068 ZDO",
  "> dungeon steinkit cave-2a moos=1 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Steinmaterial gesetzt — {\\\"wandTextur\\\":\\\"/assets/models/stein_moos.png\\\",\\\"verwitterung\\\":{\\\"moos\\\":1},\\\"kachelM\\\":2}\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"cave-2a\"]",
  "  call dungeonsNeu.saveDocument [{\"version\":6,\"id\":\"cave-2a\",\"name\":\"Cave #2a\",\"base\":\"DG_Cave\",\"mode\":\"generated\",\"seed\":42,\"zoneSize\":64,\"layout\":{\"rooms\":[{\"room\":\"cave_new_entrance02\",\"pos\":{\"x\":0.<zahl>,\"y\":0,\"z\":12.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":1,\"seed\":25608},{\"room\":\"cave_new_sloperoom04\",\"pos\":{\"x\":-18.<zahl>,\"y\":-8.75,\"z\":6.<zahl>},\"rot\":{\"x\":0,\"y\":-1.1920928955078125e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":2,\"seed\":-137570},{\"room\":\"cave_new_sloperoom04\",\"pos\":{\"x\":18.<zahl>,\"y\":9,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":1.1920928955078125e-7},\"placeOrder\":2,\"seed\":170231},{\"room\":\"cave_new_crossroads01_ice\",\"pos\":{\"x\":-12.<zahl>,\"y\":-17.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":3,\"seed\":-243709},{\"room\":\"cave_new_crossroads01_hole_ice\",\"pos\":{\"x\":-24.<zahl>,\"y\":-8.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-212278},{\"room\":\"cave_shrine_start02_ice\",\"pos\":{\"x\":4.<zahl>,\"y\":-16.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":-168320},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":-7.<zahl>,\"y\":-1.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-77496},{\"room\":\"cave_shrine_shrine01\",\"pos\":{\"x\":8.<zahl>,\"y\":-4.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":-40992},{\"room\":\"cave_shrine_corridor01\",\"pos\":{\"x\":21.<zahl>,\"y\":-16,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-93579},{\"room\":\"cave_shrine_start02_corridor\",\"pos\":{\"x\":5.<zahl>,\"y\":-19.5,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":3,\"seed\":-166002},{\"room\":\"cave_new_sloperoom02\",\"pos\":{\"x\":-12.<zahl>,\"y\":26.75,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":3,\"seed\":162002},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":0.<zahl>,\"y\":16,\"z\":10.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":4,\"seed\":168332},{\"room\":\"cave_shrine_corridor04\",\"pos\":{\"x\":12.<zahl>,\"y\":-21,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":4,\"seed\":-131005},{\"room\":\"cave_shrine_corridor06\",\"pos\":{\"x\":-11.<zahl>,\"y\":14.5,\"z\":15.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":5,\"seed\":113647},{\"room\":\"cave_shrine_start02\",\"pos\":{\"x\":-24.<zahl>,\"y\":16,\"z\":10.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":4,\"seed\":65828},{\"room\":\"cave_shrine_shrine01\",\"pos\":{\"x\":0.<zahl>,\"y\":-22.5,\"z\":6.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-189310},{\"room\":\"cave_shrine_start02_ice_corridor\",\"pos\":{\"x\":24.<zahl>,\"y\":-21.75,\"z\":-0.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-2.086162567138672e-7},\"placeOrder\":4,\"seed\":-90423},{\"room\":\"cave_shrine_shrine03\",\"pos\":{\"x\":16.<zahl>,\"y\":-22.5,\"z\":17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-97500},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":0.<zahl>,\"y\":0,\"z\":24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":2,\"seed\":51216},{\"room\":\"cave_shrine_endcap_noshrine02\",\"pos\":{\"x\":-30.<zahl>,\"y\":-16.75,\"z\":-5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.7881393432617188e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":3,\"seed\":-285792},{\"room\":\"cave_new_endcap_painting01\",\"pos\":{\"x\":12.<zahl>,\"y\":0,\"z\":24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":3,\"seed\":102468},{\"room\":\"cave_new_endcap02_crystal\",\"pos\":{\"x\":30.<zahl>,\"y\":0,\"z\":17.<zahl>},\"rot\":{\"x\":0,\"y\":1.7881393432617188e-7,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":3,\"seed\":164408},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":-12.<zahl>,\"y\":-17.75,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":-256513},{\"room\":\"cave_new_iceendcap02_crystal\",\"pos\":{\"x\":-30.<zahl>,\"y\":-17.75,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":3.5762786865234375e-7},\"placeOrder\":5,\"seed\":-320587},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":-24.<zahl>,\"y\":-17.75,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-282157},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-30.<zahl>,\"y\":1,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-3.5762786865234375e-7,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":5,\"seed\":-155221},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-24.<zahl>,\"y\":1,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-142399},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":8.<zahl>,\"y\":-16,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-136298},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":9.<zahl>,\"y\":-16,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-159769},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":-2.<zahl>,\"y\":-3.25,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-61711},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":-3.<zahl>,\"y\":-3.25,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":-91590},{\"room\":\"cave_shrine_endcap02\",\"pos\":{\"x\":27.<zahl>,\"y\":-16,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":9.834766387939453e-7},\"placeOrder\":6,\"seed\":-67953},{\"room\":\"cave_shrine_endcap\",\"pos\":{\"x\":21.<zahl>,\"y\":-16,\"z\":-23.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-106383},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":20.<zahl>,\"y\":-16,\"z\":-11.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-85046},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":11.<zahl>,\"y\":-21,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-171554},{\"room\":\"cave_shrine_endcap_noshrine\",\"pos\":{\"x\":-0.<zahl>,\"y\":36.5,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":279516},{\"room\":\"cave_new_endcap_painting01\",\"pos\":{\"x\":-30.<zahl>,\"y\":17.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":-10363},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":-24.<zahl>,\"y\":17.75,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":4,\"seed\":2459},{\"room\":\"cave_shrine_endcap_noshrine02\",\"pos\":{\"x\":5.<zahl>,\"y\":18.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-2.682209014892578e-7},\"placeOrder\":4,\"seed\":148309},{\"room\":\"cave_new_endcap02\",\"pos\":{\"x\":-0.<zahl>,\"y\":17.75,\"z\":-24.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":4,\"seed\":104963},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":0.<zahl>,\"y\":14.5,\"z\":20.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":171298},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":6.<zahl>,\"y\":14.5,\"z\":14.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":184120},{\"room\":\"cave_shrine_endcap03\",\"pos\":{\"x\":18.<zahl>,\"y\":-21,\"z\":5.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-105379},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":-11.<zahl>,\"y\":14.5,\"z\":21.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":126451},{\"room\":\"cave_shrine_endcap01\",\"pos\":{\"x\":-12.<zahl>,\"y\":14.5,\"z\":9.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":6,\"seed\":96572},{\"room\":\"cave_shrine_endcap02\",\"pos\":{\"x\":-23.<zahl>,\"y\":14.5,\"z\":21.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":75199},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":-29.<zahl>,\"y\":14.5,\"z\":15.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":1.<zahl>},\"placeOrder\":5,\"seed\":36769},{\"room\":\"cave_new_iceendcap02\",\"pos\":{\"x\":24.<zahl>,\"y\":-22.75,\"z\":11.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-76136},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":24.<zahl>,\"y\":-21,\"z\":-12.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":5,\"seed\":-116031},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":30.<zahl>,\"y\":-21,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>},\"placeOrder\":5,\"seed\":-77601},{\"room\":\"cave_shrine_endcap04\",\"pos\":{\"x\":12.<zahl>,\"y\":-21,\"z\":23.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>},\"placeOrder\":6,\"seed\":-92593},{\"room\":\"cave_shrine_endcap05\",\"pos\":{\"x\":6.<zahl>,\"y\":-21,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-1.<zahl>},\"placeOrder\":6,\"seed\":-128889}],\"doors\":[{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-5.<zahl>,\"y\":-3,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":6.<zahl>,\"y\":-3,\"z\":18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-6.<zahl>,\"y\":-20.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":-18.<zahl>,\"y\":-3,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":2.<zahl>,\"y\":-5.75,\"z\":-18.<zahl>},\"rot\":{\"x\":0,\"y\":-0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":15.<zahl>,\"y\":-18.5,\"z\":-17.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"caverock_ice_pillar_wall\",\"prefabHash\":-150393364,\"pos\":{\"x\":5.<zahl>,\"y\":14.75,\"z\":-6.<zahl>},\"rot\":{\"x\":0,\"y\":0.<zahl>,\"z\":0,\"w\":0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":12.<zahl>,\"y\":-23.5,\"z\":-0.<zahl>},\"rot\":{\"x\":0,\"y\":1.<zahl>,\"z\":0,\"w\":-0.<zahl>}},{\"prefabName\":\"cloth_hanging_door_double\",\"prefabHash\":-691115746,\"pos\":{\"x\":12.<zahl>,\"y\":-23.5,\"z\":11.<zahl>},\"rot\":{\"x\":0,\"y\":-1.<zahl>,\"z\":0,\"w\":0.<zahl>}}],\"props\":[]},\"steinKit\":{\"wandTextur\":\"/assets/models/stein_moos.png\",\"verwitterung\":{\"moos\":1},\"kachelM\":2},\"ambientLicht\":0.5}]",
  "  call dungeonsNeu.destroyInstance [\"cave-2a\"]",
  "> dungeon licht cave-2a 0.5 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a: Grundbeleuchtung 0.50 gesetzt (dunkler als die Umgebung)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.listEntrances []",
  "> dungeon entrances (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@(193,193) → cave-2a [fest] | Vault2@(320,320) → stonevault-5x5 [fest]\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.eingangZuDungeon [\"cave-2a\"]",
  "  call dungeonsNeu.setzeEingangsModus [\"cave-2a\",\"fixed\"]",
  "> dungeon entrance-mode cave-2a fixed (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Vault1@3,3 → cave-2a: fest\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.getDocument [\"cave-2a\"]",
  "  call dungeonsNeu.createGenerated [\"DG_Cave\",7,\"cave-2a\"]",
  "  call dungeonsNeu.destroyInstance [\"cave-2a\"]",
  "> dungeon regen cave-2a 7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a neu generiert (Seed 7, 36 Räume)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.erzeugeDungeon2 [\"steingrab\",{\"architektur\":7,\"material\":<zahl>,\"deko\":879019654},\"k1dn1-id\",null]",
  "> dungeon create2 steingrab 7 k1dn1-id (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon 2.0 erzeugt: k1dn1-id (Thema steingrab, Seed 7, Prüfsumme ed59f169, Grundhelligkeit 1.00 aus dem Thema)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.listDocuments []",
  "  call dungeonsNeu.listDokumente2 []",
  "  call dungeonsNeu.getInstance [\"cave-2a\"]",
  "  call dungeonsNeu.getInstance [\"forestcrypt-2b\"]",
  "  call dungeonsNeu.getInstance [\"cave-80000000\"]",
  "  call dungeonsNeu.getInstance [\"cave-5\"]",
  "  call dungeonsNeu.getInstance [\"steingrab-7\"]",
  "  call dungeonsNeu.getInstance [\"k1d-gross\"]",
  "  call dungeonsNeu.getInstance [\"steingrab-80000000\"]",
  "  call dungeonsNeu.getInstance [\"steingrab-5\"]",
  "  call dungeonsNeu.getInstance [\"k1dn1-id\"]",
  "> dungeon list (Ich) = {\"ok\":true,\"active\":false,\"message\":\"cave-2a (DG_Cave, generated, 36 Räume) | forestcrypt-2b (DG_ForestCrypt, generated, 46 Räume) | cave-80000000 (DG_Cave, generated, 27 Räume) | cave-5 (DG_Cave, generated, 46 Räume) | steingrab-7 (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme caf13fad) | k1d-gross (2.0, steingrab, erzeugt, Seeds 8/851520757/<zahl>, Prüfsumme 9438974a) | steingrab-80000000 (2.0, steingrab, erzeugt, Seeds <zahl>/<zahl>/<zahl>, Prüfsumme 9432207e) | steingrab-5 (2.0, steingrab, erzeugt, Seeds 5/784992901/<zahl>, Prüfsumme 6e06097a) | k1dn1-id (2.0, steingrab, erzeugt, Seeds 7/<zahl>/879019654, Prüfsumme ed59f169)\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.destroyInstance [\"cave-2a\"]",
  "> dungeon reset cave-2a (Ich) = {\"ok\":false,\"active\":false,\"message\":\"Keine aktive Instanz: cave-2a\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.hatDokument [\"cave-2a\"]",
  "  call dungeonsNeu.findEntranceNear [{\"x\":190,\"y\":10,\"z\":195},16]",
  "  call dungeonsNeu.assignEntrance [\"3,3\",\"cave-2a\"]",
  "> dungeon assign cave-2a (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Eingang Vault1@3,3 → cave-2a\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.findEntranceNear [{\"x\":190,\"y\":10,\"z\":195},16]",
  "  call dungeonsNeu.vorBetreten [\"cave-2a\"]",
  "  call dungeonsNeu.getOrCreateInstance [\"cave-2a\"]",
  "log 88:43cd8edda7d27167:[Dungeon] Instance 'cave-2a' materialized in wor",
  "  call dungeonsNeu.getDocument [\"cave-2a\"]",
  "  call dungeonsNeu.getDokument2 [\"cave-2a\"]",
  "  call dungeonsNeu.getSpawnPoint [{\"dungeonId\":\"cave-2a\",\"welt\":\"<Welt>\",\"slot\":0,\"origin\":{\"x\":0,\"y\":0,\"z\":0},\"zdoids\":[{\"userId\":\"1\",\"id\":1},{\"userId\":\"1\",\"id\":2},{\"userId\":\"1\",\"id\":3},{\"userId\":\"1\",\"id\":4},{\"userId\":\"1\",\"id\":5},{\"userId\":\"1\",\"id\":6},{\"userId\":\"1\",\"id\":7},{\"userId\":\"1\",\"id\":8},{\"userId\":\"1\",\"id\":9},{\"userId\":\"1\",\"id\":10},{\"userId\":\"1\",\"id\":11},{\"userId\":\"1\",\"id\":12},{\"userId\":\"1\",\"id\":13},{\"userId\":\"1\",\"id\":14},{\"userId\":\"1\",\"id\":15},{\"userId\":\"1\",\"id\":16},{\"userId\":\"1\",\"id\":17},{\"userId\":\"1\",\"id\":18},{\"userId\":\"1\",\"id\":19},{\"userId\":\"1\",\"id\":20},{\"userId\":\"1\",\"id\":21},{\"userId\":\"1\",\"id\":22},{\"userId\":\"1\",\"id\":23},{\"userId\":\"1\",\"id\":24},{\"userId\":\"1\",\"id\":25},{\"userId\":\"1\",\"id\":26},{\"userId\":\"1\",\"id\":27},{\"userId\":\"1\",\"id\":28},{\"userId\":\"1\",\"id\":29},{\"userId\":\"1\",\"id\":30},{\"userId\":\"1\",\"id\":31},{\"userId\":\"1\",\"id\":32},{\"userId\":\"1\",\"id\":33},{\"userId\":\"1\",\"id\":34},{\"userId\":\"1\",\"id\":35},{\"userId\":\"1\",\"id\":36},{\"userId\":\"1\",\"id\":37},{\"userId\":\"1\",\"id\":38},{\"userId\":\"1\",\"id\":39},{\"userId\":\"1\",\"id\":40},{\"userId\":\"1\",\"id\":41},{\"userId\":\"1\",\"id\":42},{\"userId\":\"1\",\"id\":43},{\"userId\":\"1\",\"id\":44},{\"userId\":\"1\",\"id\":45},{\"userId\":\"1\",\"id\":46},{\"userId\":\"1\",\"id\":47},{\"userId\":\"1\",\"id\":48},{\"userId\":\"1\",\"id\":49},{\"userId\":\"1\",\"id\":50},{\"userId\":\"1\",\"id\":51},{\"userId\":\"1\",\"id\":52},{\"userId\":\"1\",\"id\":53},{\"userId\":\"1\",\"id\":54},{\"userId\":\"1\",\"id\":55},{\"userId\":\"1\",\"id\":56},{\"userId\":\"1\",\"id\":57},{\"userId\":\"1\",\"id\":58},{\"userId\":\"1\",\"id\":59},{\"userId\":\"1\",\"id\":60},{\"userId\":\"1\",\"id\":61},{\"userId\":\"1\",\"id\":62},{\"userId\":\"1\",\"id\":63},{\"userId\":\"1\",\"id\":64},{\"userId\":\"1\",\"id\":65},{\"userId\":\"1\",\"id\":66},{\"userId\":\"1\",\"id\":67},{\"userId\":\"1\",\"id\":68},{\"userId\":\"1\",\"id\":69},{\"userId\":\"1\",\"id\":70},{\"userId\":\"1\",\"id\":71},{\"userId\":\"1\",\"id\":72},{\"userId\":\"1\",\"id\":73},{\"userId\":\"1\",\"id\":74},{\"userId\":\"1\",\"id\":75},{\"userId\":\"1\",\"id\":76},{\"userId\":\"1\",\"id\":77},{\"userId\":\"1\",\"id\":78},{\"userId\":\"1\",\"id\":79},{\"userId\":\"1\",\"id\":80},{\"userId\":\"1\",\"id\":81},{\"userId\":\"1\",\"id\":82},{\"userId\":\"1\",\"id\":83},{\"userId\":\"1\",\"id\":84},{\"userId\":\"1\",\"id\":85},{\"userId\":\"1\",\"id\":86},{\"userId\":\"1\",\"id\":87},{\"userId\":\"1\",\"id\":88},{\"userId\":\"1\",\"id\":89},{\"userId\":\"1\",\"id\":90},{\"userId\":\"1\",\"id\":91},{\"userId\":\"1\",\"id\":92},{\"userId\":\"1\",\"id\":93},{\"userId\":\"1\",\"id\":94},{\"userId\":\"1\",\"id\":95},{\"userId\":\"1\",\"id\":96},{\"userId\":\"1\",\"id\":97},{\"userId\":\"1\",\"id\":98},{\"userId\":\"1\",\"id\":99},{\"userId\":\"1\",\"id\":100},{\"userId\":\"1\",\"id\":101},{\"userId\":\"1\",\"id\":102},{\"userId\":\"1\",\"id\":103},{\"userId\":\"1\",\"id\":104},{\"userId\":\"1\",\"id\":105},{\"userId\":\"1\",\"id\":106},{\"userId\":\"1\",\"id\":107},{\"userId\":\"1\",\"id\":108},{\"userId\":\"1\",\"id\":109},{\"userId\":\"1\",\"id\":110},{\"userId\":\"1\",\"id\":111},{\"userId\":\"1\",\"id\":112},{\"userId\":\"1\",\"id\":113},{\"userId\":\"1\",\"id\":114},{\"userId\":\"1\",\"id\":115},{\"userId\":\"1\",\"id\":116},{\"userId\":\"1\",\"id\":117},{\"userId\":\"1\",\"id\":118},{\"userId\":\"1\",\"id\":119},{\"userId\":\"1\",\"id\":120},{\"userId\":\"1\",\"id\":121},{\"userId\":\"1\",\"id\":122},{\"userId\":\"1\",\"id\":123},{\"userId\":\"1\",\"id\":124},{\"userId\":\"1\",\"id\":125},{\"userId\":\"1\",\"id\":126},{\"userId\":\"1\",\"id\":127},{\"userId\":\"1\",\"id\":128},{\"userId\":\"1\",\"id\":129},{\"userId\":\"1\",\"id\":130},{\"userId\":\"1\",\"id\":131},{\"userId\":\"1\",\"id\":132},{\"userId\":\"1\",\"id\":133},{\"userId\":\"1\",\"id\":134},{\"userId\":\"1\",\"id\":135},{\"userId\":\"1\",\"id\":136},{\"userId\":\"1\",\"id\":137},{\"userId\":\"1\",\"id\":138},{\"userId\":\"1\",\"id\":139},{\"userId\":\"1\",\"id\":140},{\"userId\":\"1\",\"id\":141},{\"userId\":\"1\",\"id\":142},{\"userId\":\"1\",\"id\":143},{\"userId\":\"1\",\"id\":144},{\"userId\":\"1\",\"id\":145},{\"userId\":\"1\",\"id\":146},{\"userId\":\"1\",\"id\":147},{\"userId\":\"1\",\"id\":148},{\"userId\":\"1\",\"id\":149},{\"userId\":\"1\",\"id\":150},{\"userId\":\"1\",\"id\":151},{\"userId\":\"1\",\"id\":152},{\"userId\":\"1\",\"id\":153},{\"userId\":\"1\",\"id\":154},{\"userId\":\"1\",\"id\":155},{\"userId\":\"1\",\"id\":156},{\"userId\":\"1\",\"id\":157},{\"userId\":\"1\",\"id\":158},{\"userId\":\"1\",\"id\":159},{\"userId\":\"1\",\"id\":160},{\"userId\":\"1\",\"id\":161},{\"userId\":\"1\",\"id\":162},{\"userId\":\"1\",\"id\":163},{\"userId\":\"1\",\"id\":164},{\"userId\":\"1\",\"id\":165},{\"userId\":\"1\",\"id\":166},{\"userId\":\"1\",\"id\":167},{\"userId\":\"1\",\"id\":168},{\"userId\":\"1\",\"id\":169},{\"userId\":\"1\",\"id\":170},{\"userId\":\"1\",\"id\":171},{\"userId\":\"1\",\"id\":172},{\"userId\":\"1\",\"id\":173},{\"userId\":\"1\",\"id\":174},{\"userId\":\"1\",\"id\":175},{\"userId\":\"1\",\"id\":176},{\"userId\":\"1\",\"id\":177},{\"userId\":\"1\",\"id\":178},{\"userId\":\"1\",\"id\":179},{\"userId\":\"1\",\"id\":180},{\"userId\":\"1\",\"id\":181},{\"userId\":\"1\",\"id\":182},{\"userId\":\"1\",\"id\":183},{\"userId\":\"1\",\"id\":184},{\"userId\":\"1\",\"id\":185},{\"userId\":\"1\",\"id\":186},{\"userId\":\"1\",\"id\":187},{\"userId\":\"1\",\"id\":188},{\"userId\":\"1\",\"id\":189},{\"userId\":\"1\",\"id\":190},{\"userId\":\"1\",\"id\":191},{\"userId\":\"1\",\"id\":192},{\"userId\":\"1\",\"id\":193},{\"userId\":\"1\",\"id\":194},{\"userId\":\"1\",\"id\":195},{\"userId\":\"1\",\"id\":196},{\"userId\":\"1\",\"id\":197},{\"userId\":\"1\",\"id\":198},{\"userId\":\"1\",\"id\":199},{\"userId\":\"1\",\"id\":200},{\"userId\":\"1\",\"id\":201},{\"userId\":\"1\",\"id\":202},{\"userId\":\"1\",\"id\":203},{\"userId\":\"1\",\"id\":204},{\"userId\":\"1\",\"id\":205},{\"userId\":\"1\",\"id\":206},{\"userId\":\"1\",\"id\":207},{\"userId\":\"1\",\"id\":208},{\"userId\":\"1\",\"id\":209},{\"userId\":\"1\",\"id\":210},{\"userId\":\"1\",\"id\":211},{\"userId\":\"1\",\"id\":212},{\"userId\":\"1\",\"id\":213},{\"userId\":\"1\",\"id\":214},{\"userId\":\"1\",\"id\":215},{\"userId\":\"1\",\"id\":216},{\"userId\":\"1\",\"id\":217},{\"userId\":\"1\",\"id\":218},{\"userId\":\"1\",\"id\":219},{\"userId\":\"1\",\"id\":220},{\"userId\":\"1\",\"id\":221},{\"userId\":\"1\",\"id\":222},{\"userId\":\"1\",\"id\":223},{\"userId\":\"1\",\"id\":224},{\"userId\":\"1\",\"id\":225},{\"userId\":\"1\",\"id\":226},{\"userId\":\"1\",\"id\":227},{\"userId\":\"1\",\"id\":228},{\"userId\":\"1\",\"id\":229},{\"userId\":\"1\",\"id\":230},{\"userId\":\"1\",\"id\":231},{\"userId\":\"1\",\"id\":232},{\"userId\":\"1\",\"id\":233},{\"userId\":\"1\",\"id\":234},{\"userId\":\"1\",\"id\":235},{\"userId\":\"1\",\"id\":236},{\"userId\":\"1\",\"id\":237},{\"userId\":\"1\",\"id\":238},{\"userId\":\"1\",\"id\":239},{\"userId\":\"1\",\"id\":240},{\"userId\":\"1\",\"id\":241},{\"userId\":\"1\",\"id\":242},{\"userId\":\"1\",\"id\":243},{\"userId\":\"1\",\"id\":244},{\"userId\":\"1\",\"id\":245},{\"userId\":\"1\",\"id\":246},{\"userId\":\"1\",\"id\":247},{\"userId\":\"1\",\"id\":248},{\"userId\":\"1\",\"id\":249},{\"userId\":\"1\",\"id\":250},{\"userId\":\"1\",\"id\":251},{\"userId\":\"1\",\"id\":252},{\"userId\":\"1\",\"id\":253},{\"userId\":\"1\",\"id\":254},{\"userId\":\"1\",\"id\":255},{\"userId\":\"1\",\"id\":256},{\"userId\":\"1\",\"id\":257},{\"userId\":\"1\",\"id\":258},{\"userId\":\"1\",\"id\":259},{\"userId\":\"1\",\"id\":260},{\"userId\":\"1\",\"id\":261},{\"userId\":\"1\",\"id\":262},{\"userId\":\"1\",\"id\":263},{\"userId\":\"1\",\"id\":264},{\"userId\":\"1\",\"id\":265},{\"userId\":\"1\",\"id\":266},{\"userId\":\"1\",\"id\":267},{\"userId\":\"1\",\"id\":268},{\"userId\":\"1\",\"id\":269},{\"userId\":\"1\",\"id\":270},{\"userId\":\"1\",\"id\":271},{\"userId\":\"1\",\"id\":272},{\"userId\":\"1\",\"id\":273},{\"userId\":\"1\",\"id\":274},{\"userId\":\"1\",\"id\":275},{\"userId\":\"1\",\"id\":276},{\"userId\":\"1\",\"id\":277},{\"userId\":\"1\",\"id\":278},{\"userId\":\"1\",\"id\":279},{\"userId\":\"1\",\"id\":280},{\"userId\":\"1\",\"id\":281},{\"userId\":\"1\",\"id\":282},{\"userId\":\"1\",\"id\":283},{\"userId\":\"1\",\"id\":284},{\"userId\":\"1\",\"id\":285},{\"userId\":\"1\",\"id\":286},{\"userId\":\"1\",\"id\":287},{\"userId\":\"1\",\"id\":288},{\"userId\":\"1\",\"id\":289},{\"userId\":\"1\",\"id\":290},{\"userId\":\"1\",\"id\":291},{\"userId\":\"1\",\"id\":292},{\"userId\":\"1\",\"id\":293},{\"userId\":\"1\",\"id\":294},{\"userId\":\"1\",\"id\":295},{\"userId\":\"1\",\"id\":296},{\"userId\":\"1\",\"id\":297},{\"userId\":\"1\",\"id\":298},{\"userId\":\"1\",\"id\":299},{\"userId\":\"1\",\"id\":300},{\"userId\":\"1\",\"id\":301},{\"userId\":\"1\",\"id\":302},{\"userId\":\"1\",\"id\":303},{\"userId\":\"1\",\"id\":304},{\"userId\":\"1\",\"id\":305},{\"userId\":\"1\",\"id\":306},{\"userId\":\"1\",\"id\":307},{\"userId\":\"1\",\"id\":308},{\"userId\":\"1\",\"id\":309},{\"userId\":\"1\",\"id\":310},{\"userId\":\"1\",\"id\":311},{\"userId\":\"1\",\"id\":312},{\"userId\":\"1\",\"id\":313},{\"userId\":\"1\",\"id\":314},{\"userId\":\"1\",\"id\":315},{\"userId\":\"1\",\"id\":316},{\"userId\":\"1\",\"id\":317},{\"userId\":\"1\",\"id\":318},{\"userId\":\"1\",\"id\":319},{\"userId\":\"1\",\"id\":320},{\"userId\":\"1\",\"id\":321},{\"userId\":\"1\",\"id\":322},{\"userId\":\"1\",\"id\":323},{\"userId\":\"1\",\"id\":324},{\"userId\":\"1\",\"id\":325},{\"userId\":\"1\",\"id\":326},{\"userId\":\"1\",\"id\":327},{\"userId\":\"1\",\"id\":328},{\"userId\":\"1\",\"id\":329},{\"userId\":\"1\",\"id\":330},{\"userId\":\"1\",\"id\":331},{\"userId\":\"1\",\"id\":332},{\"userId\":\"1\",\"id\":333},{\"userId\":\"1\",\"id\":334},{\"userId\":\"1\",\"id\":335},{\"userId\":\"1\",\"id\":336},{\"userId\":\"1\",\"id\":337},{\"userId\":\"1\",\"id\":338},{\"userId\":\"1\",\"id\":339},{\"userId\":\"1\",\"id\":340},{\"userId\":\"1\",\"id\":341},{\"userId\":\"1\",\"id\":342},{\"userId\":\"1\",\"id\":343},{\"userId\":\"1\",\"id\":344},{\"userId\":\"1\",\"id\":345},{\"userId\":\"1\",\"id\":346},{\"userId\":\"1\",\"id\":347},{\"userId\":\"1\",\"id\":348},{\"userId\":\"1\",\"id\":349},{\"userId\":\"1\",\"id\":350},{\"userId\":\"1\",\"id\":351},{\"userId\":\"1\",\"id\":352},{\"userId\":\"1\",\"id\":353},{\"userId\":\"1\",\"id\":354},{\"userId\":\"1\",\"id\":355},{\"userId\":\"1\",\"id\":356},{\"userId\":\"1\",\"id\":357},{\"userId\":\"1\",\"id\":358},{\"userId\":\"1\",\"id\":359},{\"userId\":\"1\",\"id\":360},{\"userId\":\"1\",\"id\":361},{\"userId\":\"1\",\"id\":362},{\"userId\":\"1\",\"id\":363},{\"userId\":\"1\",\"id\":364},{\"userId\":\"1\",\"id\":365},{\"userId\":\"1\",\"id\":366},{\"userId\":\"1\",\"id\":367},{\"userId\":\"1\",\"id\":368},{\"userId\":\"1\",\"id\":369},{\"userId\":\"1\",\"id\":370},{\"userId\":\"1\",\"id\":371},{\"userId\":\"1\",\"id\":372},{\"userId\":\"1\",\"id\":373},{\"userId\":\"1\",\"id\":374},{\"userId\":\"1\",\"id\":375},{\"userId\":\"1\",\"id\":376},{\"userId\":\"1\",\"id\":377},{\"userId\":\"1\",\"id\":378},{\"userId\":\"1\",\"id\":379},{\"userId\":\"1\",\"id\":380},{\"userId\":\"1\",\"id\":381},{\"userId\":\"1\",\"id\":382},{\"userId\":\"1\",\"id\":383},{\"userId\":\"1\",\"id\":384},{\"userId\":\"1\",\"id\":385},{\"userId\":\"1\",\"id\":386},{\"userId\":\"1\",\"id\":387},{\"userId\":\"1\",\"id\":388},{\"userId\":\"1\",\"id\":389},{\"userId\":\"1\",\"id\":390},{\"userId\":\"1\",\"id\":391},{\"userId\":\"1\",\"id\":392},{\"userId\":\"1\",\"id\":393},{\"userId\":\"1\",\"id\":394},{\"userId\":\"1\",\"id\":395},{\"userId\":\"1\",\"id\":396},{\"userId\":\"1\",\"id\":397},{\"userId\":\"1\",\"id\":398},{\"userId\":\"1\",\"id\":399},{\"userId\":\"1\",\"id\":400},{\"userId\":\"1\",\"id\":401},{\"userId\":\"1\",\"id\":402},{\"userId\":\"1\",\"id\":403},{\"userId\":\"1\",\"id\":404},{\"userId\":\"1\",\"id\":405},{\"userId\":\"1\",\"id\":406},{\"userId\":\"1\",\"id\":407},{\"userId\":\"1\",\"id\":408},{\"userId\":\"1\",\"id\":409},{\"userId\":\"1\",\"id\":410},{\"userId\":\"1\",\"id\":411},{\"userId\":\"1\",\"id\":412},{\"userId\":\"1\",\"id\":413},{\"userId\":\"1\",\"id\":414},{\"userId\":\"1\",\"id\":415},{\"userId\":\"1\",\"id\":416},{\"userId\":\"1\",\"id\":417},{\"userId\":\"1\",\"id\":418},{\"userId\":\"1\",\"id\":419},{\"userId\":\"1\",\"id\":420},{\"userId\":\"1\",\"id\":421},{\"userId\":\"1\",\"id\":422},{\"userId\":\"1\",\"id\":423},{\"userId\":\"1\",\"id\":424},{\"userId\":\"1\",\"id\":425},{\"userId\":\"1\",\"id\":426},{\"userId\":\"1\",\"id\":427},{\"userId\":\"1\",\"id\":428},{\"userId\":\"1\",\"id\":429},{\"userId\":\"1\",\"id\":430},{\"userId\":\"1\",\"id\":431},{\"userId\":\"1\",\"id\":432},{\"userId\":\"1\",\"id\":433},{\"userId\":\"1\",\"id\":434},{\"userId\":\"1\",\"id\":435},{\"userId\":\"1\",\"id\":436},{\"userId\":\"1\",\"id\":437},{\"userId\":\"1\",\"id\":438},{\"userId\":\"1\",\"id\":439},{\"userId\":\"1\",\"id\":440},{\"userId\":\"1\",\"id\":441},{\"userId\":\"1\",\"id\":442},{\"userId\":\"1\",\"id\":443},{\"userId\":\"1\",\"id\":444},{\"userId\":\"1\",\"id\":445},{\"userId\":\"1\",\"id\":446},{\"userId\":\"1\",\"id\":447},{\"userId\":\"1\",\"id\":448},{\"userId\":\"1\",\"id\":449},{\"userId\":\"1\",\"id\":450},{\"userId\":\"1\",\"id\":451},{\"userId\":\"1\",\"id\":452},{\"userId\":\"1\",\"id\":453},{\"userId\":\"1\",\"id\":454},{\"userId\":\"1\",\"id\":455},{\"userId\":\"1\",\"id\":456},{\"userId\":\"1\",\"id\":457},{\"userId\":\"1\",\"id\":458},{\"userId\":\"1\",\"id\":459},{\"userId\":\"1\",\"id\":460},{\"userId\":\"1\",\"id\":461},{\"userId\":\"1\",\"id\":462},{\"userId\":\"1\",\"id\":463},{\"userId\":\"1\",\"id\":464},{\"userId\":\"1\",\"id\":465},{\"userId\":\"1\",\"id\":466},{\"userId\":\"1\",\"id\":467},{\"userId\":\"1\",\"id\":468},{\"userId\":\"1\",\"id\":469},{\"userId\":\"1\",\"id\":470},{\"userId\":\"1\",\"id\":471},{\"userId\":\"1\",\"id\":472},{\"userId\":\"1\",\"id\":473},{\"userId\":\"1\",\"id\":474},{\"userId\":\"1\",\"id\":475},{\"userId\":\"1\",\"id\":476},{\"userId\":\"1\",\"id\":477},{\"userId\":\"1\",\"id\":478},{\"userId\":\"1\",\"id\":479},{\"userId\":\"1\",\"id\":480},{\"userId\":\"1\",\"id\":481},{\"userId\":\"1\",\"id\":482},{\"userId\":\"1\",\"id\":483},{\"userId\":\"1\",\"id\":484},{\"userId\":\"1\",\"id\":485},{\"userId\":\"1\",\"id\":486},{\"userId\":\"1\",\"id\":487},{\"userId\":\"1\",\"id\":488},{\"userId\":\"1\",\"id\":489},{\"userId\":\"1\",\"id\":490},{\"userId\":\"1\",\"id\":491},{\"userId\":\"1\",\"id\":492},{\"userId\":\"1\",\"id\":493},{\"userId\":\"1\",\"id\":494},{\"userId\":\"1\",\"id\":495},{\"userId\":\"1\",\"id\":496},{\"userId\":\"1\",\"id\":497},{\"userId\":\"1\",\"id\":498},{\"userId\":\"1\",\"id\":499},{\"userId\":\"1\",\"id\":500},{\"userId\":\"1\",\"id\":501},{\"userId\":\"1\",\"id\":502},{\"userId\":\"1\",\"id\":503},{\"userId\":\"1\",\"id\":504},{\"userId\":\"1\",\"id\":505},{\"userId\":\"1\",\"id\":506},{\"userId\":\"1\",\"id\":507},{\"userId\":\"1\",\"id\":508},{\"userId\":\"1\",\"id\":509},{\"userId\":\"1\",\"id\":510},{\"userId\":\"1\",\"id\":511},{\"userId\":\"1\",\"id\":512},{\"userId\":\"1\",\"id\":513},{\"userId\":\"1\",\"id\":514},{\"userId\":\"1\",\"id\":515},{\"userId\":\"1\",\"id\":516},{\"userId\":\"1\",\"id\":517},{\"userId\":\"1\",\"id\":518},{\"userId\":\"1\",\"id\":519},{\"userId\":\"1\",\"id\":520},{\"userId\":\"1\",\"id\":521},{\"userId\":\"1\",\"id\":522},{\"userId\":\"1\",\"id\":523},{\"userId\":\"1\",\"id\":524},{\"userId\":\"1\",\"id\":525},{\"userId\":\"1\",\"id\":526},{\"userId\":\"1\",\"id\":527},{\"userId\":\"1\",\"id\":528},{\"userId\":\"1\",\"id\":529},{\"userId\":\"1\",\"id\":530},{\"userId\":\"1\",\"id\":531},{\"userId\":\"1\",\"id\":532},{\"userId\":\"1\",\"id\":533},{\"userId\":\"1\",\"id\":534},{\"userId\":\"1\",\"id\":535},{\"userId\":\"1\",\"id\":536},{\"userId\":\"1\",\"id\":537},{\"userId\":\"1\",\"id\":538},{\"userId\":\"1\",\"id\":539},{\"userId\":\"1\",\"id\":540},{\"userId\":\"1\",\"id\":541},{\"userId\":\"1\",\"id\":542},{\"userId\":\"1\",\"id\":543},{\"userId\":\"1\",\"id\":544},{\"userId\":\"1\",\"id\":545},{\"userId\":\"1\",\"id\":546},{\"userId\":\"1\",\"id\":547},{\"userId\":\"1\",\"id\":548},{\"userId\":\"1\",\"id\":549},{\"userId\":\"1\",\"id\":550},{\"userId\":\"1\",\"id\":551},{\"userId\":\"1\",\"id\":552},{\"userId\":\"1\",\"id\":553},{\"userId\":\"1\",\"id\":554},{\"userId\":\"1\",\"id\":555},{\"userId\":\"1\",\"id\":556},{\"userId\":\"1\",\"id\":557},{\"userId\":\"1\",\"id\":558},{\"userId\":\"1\",\"id\":559},{\"userId\":\"1\",\"id\":560},{\"userId\":\"1\",\"id\":561},{\"userId\":\"1\",\"id\":562},{\"userId\":\"1\",\"id\":563},{\"userId\":\"1\",\"id\":564},{\"userId\":\"1\",\"id\":565},{\"userId\":\"1\",\"id\":566},{\"userId\":\"1\",\"id\":567},{\"userId\":\"1\",\"id\":568},{\"userId\":\"1\",\"id\":569},{\"userId\":\"1\",\"id\":570},{\"userId\":\"1\",\"id\":571},{\"userId\":\"1\",\"id\":572},{\"userId\":\"1\",\"id\":573},{\"userId\":\"1\",\"id\":574},{\"userId\":\"1\",\"id\":575},{\"userId\":\"1\",\"id\":576},{\"userId\":\"1\",\"id\":577},{\"userId\":\"1\",\"id\":578},{\"userId\":\"1\",\"id\":579},{\"userId\":\"1\",\"id\":580},{\"userId\":\"1\",\"id\":581},{\"userId\":\"1\",\"id\":582},{\"userId\":\"1\",\"id\":583},{\"userId\":\"1\",\"id\":584},{\"userId\":\"1\",\"id\":585},{\"userId\":\"1\",\"id\":586},{\"userId\":\"1\",\"id\":587},{\"userId\":\"1\",\"id\":588},{\"userId\":\"1\",\"id\":589},{\"userId\":\"1\",\"id\":590},{\"userId\":\"1\",\"id\":591},{\"userId\":\"1\",\"id\":592},{\"userId\":\"1\",\"id\":593},{\"userId\":\"1\",\"id\":594},{\"userId\":\"1\",\"id\":595},{\"userId\":\"1\",\"id\":596},{\"userId\":\"1\",\"id\":597},{\"userId\":\"1\",\"id\":598},{\"userId\":\"1\",\"id\":599},{\"userId\":\"1\",\"id\":600},{\"userId\":\"1\",\"id\":601},{\"userId\":\"1\",\"id\":602},{\"userId\":\"1\",\"id\":603},{\"userId\":\"1\",\"id\":604},{\"userId\":\"1\",\"id\":605},{\"userId\":\"1\",\"id\":606},{\"userId\":\"1\",\"id\":607},{\"userId\":\"1\",\"id\":608},{\"userId\":\"1\",\"id\":609},{\"userId\":\"1\",\"id\":610},{\"userId\":\"1\",\"id\":611},{\"userId\":\"1\",\"id\":612},{\"userId\":\"1\",\"id\":613},{\"userId\":\"1\",\"id\":614},{\"userId\":\"1\",\"id\":615},{\"userId\":\"1\",\"id\":616},{\"userId\":\"1\",\"id\":617},{\"userId\":\"1\",\"id\":618},{\"userId\":\"1\",\"id\":619},{\"userId\":\"1\",\"id\":620},{\"userId\":\"1\",\"id\":621},{\"userId\":\"1\",\"id\":622},{\"userId\":\"1\",\"id\":623},{\"userId\":\"1\",\"id\":624},{\"userId\":\"1\",\"id\":625},{\"userId\":\"1\",\"id\":626},{\"userId\":\"1\",\"id\":627},{\"userId\":\"1\",\"id\":628},{\"userId\":\"1\",\"id\":629},{\"userId\":\"1\",\"id\":630},{\"userId\":\"1\",\"id\":631},{\"userId\":\"1\",\"id\":632},{\"userId\":\"1\",\"id\":633},{\"userId\":\"1\",\"id\":634},{\"userId\":\"1\",\"id\":635},{\"userId\":\"1\",\"id\":636},{\"userId\":\"1\",\"id\":637},{\"userId\":\"1\",\"id\":638},{\"userId\":\"1\",\"id\":639},{\"userId\":\"1\",\"id\":640},{\"userId\":\"1\",\"id\":641},{\"userId\":\"1\",\"id\":642},{\"userId\":\"1\",\"id\":643},{\"userId\":\"1\",\"id\":644},{\"userId\":\"1\",\"id\":645},{\"userId\":\"1\",\"id\":646},{\"userId\":\"1\",\"id\":647},{\"userId\":\"1\",\"id\":648},{\"userId\":\"1\",\"id\":649},{\"userId\":\"1\",\"id\":650},{\"userId\":\"1\",\"id\":651},{\"userId\":\"1\",\"id\":652},{\"userId\":\"1\",\"id\":653},{\"userId\":\"1\",\"id\":654},{\"userId\":\"1\",\"id\":655},{\"userId\":\"1\",\"id\":656},{\"userId\":\"1\",\"id\":657},{\"userId\":\"1\",\"id\":658},{\"userId\":\"1\",\"id\":659},{\"userId\":\"1\",\"id\":660},{\"userId\":\"1\",\"id\":661},{\"userId\":\"1\",\"id\":662},{\"userId\":\"1\",\"id\":663},{\"userId\":\"1\",\"id\":664},{\"userId\":\"1\",\"id\":665},{\"userId\":\"1\",\"id\":666},{\"userId\":\"1\",\"id\":667},{\"userId\":\"1\",\"id\":668},{\"userId\":\"1\",\"id\":669},{\"userId\":\"1\",\"id\":670},{\"userId\":\"1\",\"id\":671},{\"userId\":\"1\",\"id\":672},{\"userId\":\"1\",\"id\":673},{\"userId\":\"1\",\"id\":674},{\"userId\":\"1\",\"id\":675},{\"userId\":\"1\",\"id\":676},{\"userId\":\"1\",\"id\":677},{\"userId\":\"1\",\"id\":678},{\"userId\":\"1\",\"id\":679},{\"userId\":\"1\",\"id\":680},{\"userId\":\"1\",\"id\":681},{\"userId\":\"1\",\"id\":682},{\"userId\":\"1\",\"id\":683},{\"userId\":\"1\",\"id\":684},{\"userId\":\"1\",\"id\":685},{\"userId\":\"1\",\"id\":686},{\"userId\":\"1\",\"id\":687},{\"userId\":\"1\",\"id\":688},{\"userId\":\"1\",\"id\":689},{\"userId\":\"1\",\"id\":690},{\"userId\":\"1\",\"id\":691},{\"userId\":\"1\",\"id\":692},{\"userId\":\"1\",\"id\":693},{\"userId\":\"1\",\"id\":694},{\"userId\":\"1\",\"id\":695},{\"userId\":\"1\",\"id\":696},{\"userId\":\"1\",\"id\":697},{\"userId\":\"1\",\"id\":698},{\"userId\":\"1\",\"id\":699},{\"userId\":\"1\",\"id\":700},{\"userId\":\"1\",\"id\":701},{\"userId\":\"1\",\"id\":702},{\"userId\":\"1\",\"id\":703},{\"userId\":\"1\",\"id\":704},{\"userId\":\"1\",\"id\":705},{\"userId\":\"1\",\"id\":706},{\"userId\":\"1\",\"id\":707},{\"userId\":\"1\",\"id\":708},{\"userId\":\"1\",\"id\":709},{\"userId\":\"1\",\"id\":710},{\"userId\":\"1\",\"id\":711},{\"userId\":\"1\",\"id\":712},{\"userId\":\"1\",\"id\":713},{\"userId\":\"1\",\"id\":714},{\"userId\":\"1\",\"id\":715},{\"userId\":\"1\",\"id\":716},{\"userId\":\"1\",\"id\":717},{\"userId\":\"1\",\"id\":718},{\"userId\":\"1\",\"id\":719},{\"userId\":\"1\",\"id\":720},{\"userId\":\"1\",\"id\":721},{\"userId\":\"1\",\"id\":722},{\"userId\":\"1\",\"id\":723},{\"userId\":\"1\",\"id\":724},{\"userId\":\"1\",\"id\":725},{\"userId\":\"1\",\"id\":726},{\"userId\":\"1\",\"id\":727},{\"userId\":\"1\",\"id\":728},{\"userId\":\"1\",\"id\":729},{\"userId\":\"1\",\"id\":730},{\"userId\":\"1\",\"id\":731},{\"userId\":\"1\",\"id\":732},{\"userId\":\"1\",\"id\":733},{\"userId\":\"1\",\"id\":734},{\"userId\":\"1\",\"id\":735},{\"userId\":\"1\",\"id\":736},{\"userId\":\"1\",\"id\":737},{\"userId\":\"1\",\"id\":738},{\"userId\":\"1\",\"id\":739},{\"userId\":\"1\",\"id\":740},{\"userId\":\"1\",\"id\":741},{\"userId\":\"1\",\"id\":742},{\"userId\":\"1\",\"id\":743},{\"userId\":\"1\",\"id\":744},{\"userId\":\"1\",\"id\":745},{\"userId\":\"1\",\"id\":746},{\"userId\":\"1\",\"id\":747},{\"userId\":\"1\",\"id\":748},{\"userId\":\"1\",\"id\":749},{\"userId\":\"1\",\"id\":750},{\"userId\":\"1\",\"id\":751},{\"userId\":\"1\",\"id\":752},{\"userId\":\"1\",\"id\":753},{\"userId\":\"1\",\"id\":754},{\"userId\":\"1\",\"id\":755},{\"userId\":\"1\",\"id\":756},{\"userId\":\"1\",\"id\":757},{\"userId\":\"1\",\"id\":758},{\"userId\":\"1\",\"id\":759},{\"userId\":\"1\",\"id\":760},{\"userId\":\"1\",\"id\":761},{\"userId\":\"1\",\"id\":762},{\"userId\":\"1\",\"id\":763},{\"userId\":\"1\",\"id\":764},{\"userId\":\"1\",\"id\":765},{\"userId\":\"1\",\"id\":766},{\"userId\":\"1\",\"id\":767},{\"userId\":\"1\",\"id\":768},{\"userId\":\"1\",\"id\":769},{\"userId\":\"1\",\"id\":770},{\"userId\":\"1\",\"id\":771},{\"userId\":\"1\",\"id\":772},{\"userId\":\"1\",\"id\":773},{\"userId\":\"1\",\"id\":774},{\"userId\":\"1\",\"id\":775},{\"userId\":\"1\",\"id\":776},{\"userId\":\"1\",\"id\":777},{\"userId\":\"1\",\"id\":778},{\"userId\":\"1\",\"id\":779},{\"userId\":\"1\",\"id\":780},{\"userId\":\"1\",\"id\":781},{\"userId\":\"1\",\"id\":782},{\"userId\":\"1\",\"id\":783},{\"userId\":\"1\",\"id\":784},{\"userId\":\"1\",\"id\":785},{\"userId\":\"1\",\"id\":786},{\"userId\":\"1\",\"id\":787},{\"userId\":\"1\",\"id\":788},{\"userId\":\"1\",\"id\":789},{\"userId\":\"1\",\"id\":790},{\"userId\":\"1\",\"id\":791},{\"userId\":\"1\",\"id\":792},{\"userId\":\"1\",\"id\":793},{\"userId\":\"1\",\"id\":794},{\"userId\":\"1\",\"id\":795},{\"userId\":\"1\",\"id\":796},{\"userId\":\"1\",\"id\":797},{\"userId\":\"1\",\"id\":798},{\"userId\":\"1\",\"id\":799},{\"userId\":\"1\",\"id\":800},{\"userId\":\"1\",\"id\":801},{\"userId\":\"1\",\"id\":802},{\"userId\":\"1\",\"id\":803},{\"userId\":\"1\",\"id\":804},{\"userId\":\"1\",\"id\":805},{\"userId\":\"1\",\"id\":806},{\"userId\":\"1\",\"id\":807},{\"userId\":\"1\",\"id\":808},{\"userId\":\"1\",\"id\":809},{\"userId\":\"1\",\"id\":810},{\"userId\":\"1\",\"id\":811},{\"userId\":\"1\",\"id\":812},{\"userId\":\"1\",\"id\":813},{\"userId\":\"1\",\"id\":814},{\"userId\":\"1\",\"id\":815},{\"userId\":\"1\",\"id\":816},{\"userId\":\"1\",\"id\":817},{\"userId\":\"1\",\"id\":818},{\"userId\":\"1\",\"id\":819},{\"userId\":\"1\",\"id\":820},{\"userId\":\"1\",\"id\":821},{\"userId\":\"1\",\"id\":822},{\"userId\":\"1\",\"id\":823},{\"userId\":\"1\",\"id\":824},{\"userId\":\"1\",\"id\":825},{\"userId\":\"1\",\"id\":826},{\"userId\":\"1\",\"id\":827},{\"userId\":\"1\",\"id\":828},{\"userId\":\"1\",\"id\":829},{\"userId\":\"1\",\"id\":830},{\"userId\":\"1\",\"id\":831},{\"userId\":\"1\",\"id\":832},{\"userId\":\"1\",\"id\":833},{\"userId\":\"1\",\"id\":834},{\"userId\":\"1\",\"id\":835},{\"userId\":\"1\",\"id\":836},{\"userId\":\"1\",\"id\":837},{\"userId\":\"1\",\"id\":838},{\"userId\":\"1\",\"id\":839},{\"userId\":\"1\",\"id\":840},{\"userId\":\"1\",\"id\":841},{\"userId\":\"1\",\"id\":842},{\"userId\":\"1\",\"id\":843},{\"userId\":\"1\",\"id\":844},{\"userId\":\"1\",\"id\":845},{\"userId\":\"1\",\"id\":846},{\"userId\":\"1\",\"id\":847},{\"userId\":\"1\",\"id\":848},{\"userId\":\"1\",\"id\":849},{\"userId\":\"1\",\"id\":850},{\"userId\":\"1\",\"id\":851},{\"userId\":\"1\",\"id\":852},{\"userId\":\"1\",\"id\":853},{\"userId\":\"1\",\"id\":854},{\"userId\":\"1\",\"id\":855},{\"userId\":\"1\",\"id\":856},{\"userId\":\"1\",\"id\":857},{\"userId\":\"1\",\"id\":858},{\"userId\":\"1\",\"id\":859},{\"userId\":\"1\",\"id\":860},{\"userId\":\"1\",\"id\":861},{\"userId\":\"1\",\"id\":862},{\"userId\":\"1\",\"id\":863},{\"userId\":\"1\",\"id\":864},{\"userId\":\"1\",\"id\":865},{\"userId\":\"1\",\"id\":866},{\"userId\":\"1\",\"id\":867},{\"userId\":\"1\",\"id\":868},{\"userId\":\"1\",\"id\":869},{\"userId\":\"1\",\"id\":870},{\"userId\":\"1\",\"id\":871},{\"userId\":\"1\",\"id\":872},{\"userId\":\"1\",\"id\":873},{\"userId\":\"1\",\"id\":874},{\"userId\":\"1\",\"id\":875},{\"userId\":\"1\",\"id\":876},{\"userId\":\"1\",\"id\":877},{\"userId\":\"1\",\"id\":878},{\"userId\":\"1\",\"id\":879},{\"userId\":\"1\",\"id\":880},{\"userId\":\"1\",\"id\":881},{\"userId\":\"1\",\"id\":882}],\"propZdoids\":[],\"players\":\"<Set>\"}]",
  "> dungeon enter (Nah) = {\"ok\":true,\"active\":true,\"message\":\"Dungeon betreten: Cave #7\"}",
  "peer Nah dungeonId=\"cave-2a\" dungeonReturn={\"x\":190,\"y\":10,\"z\":195} position={\"x\":2.3841854120595425e-7,\"y\":0.5,\"z\":1.<zahl>} worldId=\"dungeon:cave-2a\" char=0:0",
  "  call dungeonsNeu.getInstance [\"cave-2a\"]",
  "> dungeon leave (Nah) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon verlassen\"}",
  "peer Nah dungeonId=null dungeonReturn=null position={\"x\":190,\"y\":10,\"z\":195} worldId=\"haupt\" char=0:0",
  "  call dungeonsNeu.deleteDocument [\"steingrab-7\"]",
  "> dungeon delete steingrab-7 (Ich) = {\"ok\":true,\"active\":false,\"message\":\"Dungeon steingrab-7 gelöscht\"}",
  "peer Ich dungeonId=null dungeonReturn=null position={\"x\":1,\"y\":2,\"z\":3} worldId=\"haupt\" char=0:0",
  "  disk i1-form-k1dn1/cave-2a.json=10119:9d8c00ac6477069a i1-form-k1dn1/cave-5.json=13145:57c9a837e73021e7 i1-form-k1dn1/cave-80000000.json=7547:b5a1658d33878cc2 i1-form-k1dn1/entrances.json=370:8b65d371ee790b3a i1-form-k1dn1/forestcrypt-2b.json=14181:e510664b77b82ad7 i1-form-k1dn1/k1d-gross.json=255:abbfce898e1e2f7e i1-form-k1dn1/k1dn1-id.json=232:15b4c398840c578d i1-form-k1dn1/steingrab-5.json=235:afe0978cff0847a7 i1-form-k1dn1/steingrab-80000000.json=251:0b02fea00894e874"
 ]
};

if (MESSEN_BASIS) {
  const attrappe = messeAttrappe();
  const echt = messeEcht();
  const interAttrappe = messeInteraktionAttrappe();
  const interEcht = messeInteraktionEcht();
  const chatAttrappe = messeChatAttrappe();
  const chatEcht = messeChatEcht();
  const befehleAttrappe = messeBefehleAttrappe();
  const befehleEcht = messeBefehleEcht();
  const befehleN1Attrappe = messeBefehleN1Attrappe();
  const befehleN1Echt = messeBefehleN1Echt();
  const takt1A = messeTakt1A();
  const befehle1BAttrappe = messeBefehle1BAttrappe();
  const befehle1BEcht = messeBefehle1BEcht();
  const spielerAttrappe = messeSpielerAttrappe();
  const spielerEcht = messeSpielerEcht();
  const spielerAttrappeN1 = messeSpielerAttrappeN1();
  const spielerEchtN1 = messeSpielerEchtN1();
  const dungeonAttrappe = messeDungeonAttrappe();
  const dungeonEcht = messeDungeonEcht();
  const dungeonAttrappeN1 = messeDungeonAttrappeN1();
  const dungeonEchtN1 = messeDungeonEchtN1();
  process.stdout.write(`${JSON.stringify({ attrappe, echt, interAttrappe, interEcht, chatAttrappe, chatEcht, befehleAttrappe, befehleEcht, befehleN1Attrappe, befehleN1Echt, takt1A, befehle1BAttrappe, befehle1BEcht, spielerAttrappe, spielerEcht, spielerAttrappeN1, spielerEchtN1, dungeonAttrappe, dungeonEcht, dungeonAttrappeN1, dungeonEchtN1 }, null, 1)}\n`);
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

console.log('\n[4] Behaviour of step 1A: admin, kick, bann, entbann and the re-check of the rights give the numbers measured before the move');
{
  const gleich = (a: Aufzeichnung, b: Aufzeichnung): boolean => JSON.stringify(a) === JSON.stringify(b);
  const teil = (titel: string, gemessen: Aufzeichnung, soll: Aufzeichnung): void => {
    check(`${titel}: the packets sent, in order`, same(gemessen.paket, soll.paket), `${gemessen.paket.length} packets, expected ${soll.paket.length}; first difference: ${gemessen.paket.find((x, i) => x !== soll.paket[i])}`);
    check(`${titel}: the calls into the context`, JSON.stringify(gemessen.aufrufe) === JSON.stringify(soll.aufrufe), JSON.stringify(gemessen.aufrufe));
    check(`${titel}: the messages, the calls with their arguments and the rights after every command, in order`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])}`);
    check(`${titel}: the state numbers, the console output and the exceptions`, JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([soll.zustand, soll.konsole, soll.ausnahmen]), JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]));
    check(`${titel}: all of it`, gleich(gemessen, soll));
  };
  teil('commands on a stand-in', messeBefehleAttrappe(), SOLL_BEFEHLE_ATTRAPPE);
  teil('commands on a real instance through the registry and the forwardings', messeBefehleEcht(), SOLL_BEFEHLE_ECHT);
  check('the clock and the time zone are restored after the measurements', Date.now === ECHTE_UHR && process.env['TZ'] === ECHTE_TZ);
}

console.log('\n[4b] Step 1A after the attack: more spellings, the re-check from update(), the registry with everyone-admin');
{
  const gleich = (a: Aufzeichnung, b: Aufzeichnung): boolean => JSON.stringify(a) === JSON.stringify(b);
  const teil = (titel: string, gemessen: Aufzeichnung, soll: Aufzeichnung): void => {
    check(`${titel}: the packets sent, in order`, same(gemessen.paket, soll.paket), `${gemessen.paket.length} packets, expected ${soll.paket.length}; first difference: ${gemessen.paket.find((x, i) => x !== soll.paket[i])}`);
    check(`${titel}: the messages, the calls with their arguments and the state after every step, in order`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])}`);
    check(`${titel}: all of it`, gleich(gemessen, soll), JSON.stringify([gemessen.aufrufe, gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]));
  };
  teil('more cases on a stand-in', messeBefehleN1Attrappe(), SOLL_BEFEHLE_N1_ATTRAPPE);
  teil('more cases on a real instance', messeBefehleN1Echt(), SOLL_BEFEHLE_N1_ECHT);
  const takt = messeTakt1A();
  teil('the re-check from update() and the registry with everyone-admin', takt, SOLL_TAKT_1A);
  check('the re-check ran once in every full second (3 of 5 ticks per server with the stand-in, 6 in all)', takt.aufrufe['gleicheAdminrechteAb'] === 6, JSON.stringify(takt.aufrufe));
  check('the clock and the time zone are restored after the measurements of step 1A', Date.now === ECHTE_UHR && process.env['TZ'] === ECHTE_TZ);
}

console.log('\n[4c] Behaviour of step 1, package B: marke, wetter, abbau, item and spawn give the numbers measured before the move');
{
  const teil = (titel: string, gemessen: Aufzeichnung, soll: Aufzeichnung): void => {
    check(`${titel}: the results, calls with their arguments, inventories, stamps and markers, in order`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference at ${gemessen.notizen.findIndex((x, i) => x !== soll.notizen[i])}: ${gemessen.notizen.find((x, i) => x !== soll.notizen[i])} (expected ${soll.notizen[gemessen.notizen.findIndex((x, i) => x !== soll.notizen[i])]})`);
    check(`${titel}: the reads of the context members and the calls, counted`, JSON.stringify(gemessen.aufrufe) === JSON.stringify(soll.aufrufe), JSON.stringify(gemessen.aufrufe));
    check(`${titel}: the state numbers, the packets, the console output and the exceptions`, JSON.stringify([gemessen.zustand, gemessen.paket, gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([soll.zustand, soll.paket, soll.konsole, soll.ausnahmen]), JSON.stringify([gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]));
    check(`${titel}: all of it`, JSON.stringify(gemessen) === JSON.stringify(soll));
  };
  teil('commands on a stand-in', messeBefehle1BAttrappe(), SOLL_BEFEHLE_1B_ATTRAPPE);
  teil('commands on a real instance through the constructor and the forwardings', messeBefehle1BEcht(), SOLL_BEFEHLE_1B_ECHT);
}

console.log('\n[4d] Behaviour of step 1, package C: teleport and spieler give the numbers measured before the move');
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

console.log('\n[4e] Behaviour of step 1, package C, after the attack (N1): Unicode forms, the caller online, receivers, replaced dungeons');
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
console.log('\n[4f] Behaviour of step 1, package D: dungeon with its 13 sub-commands and resolveDungeonBase give the numbers measured before the move');
{
  for (const [titel, gemessen, soll] of [
    ['dungeon on a stand-in', messeDungeonAttrappe(), SOLL_DUNGEON_ATTRAPPE],
    ['dungeon on a real instance (registry of the constructor, then the forwardings)', messeDungeonEcht(), SOLL_DUNGEON_ECHT],
  ] as const) {
    const i = gemessen.notizen.findIndex((x, j) => x !== soll.notizen[j]);
    check(`${titel}: the messages, the calls with their arguments and receivers, the documents and the peer after every command, in order`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference at ${i}: ${gemessen.notizen[i]} (expected ${soll.notizen[i]})`);
    check(`${titel}: the reads of the context members and the calls, counted`, JSON.stringify(gemessen.aufrufe) === JSON.stringify(soll.aufrufe), JSON.stringify(gemessen.aufrufe));
    check(`${titel}: packets, state numbers, console, exceptions`, JSON.stringify([gemessen.paket, gemessen.zustand, gemessen.konsole, gemessen.ausnahmen]) === JSON.stringify([soll.paket, soll.zustand, soll.konsole, soll.ausnahmen]), JSON.stringify([gemessen.konsole, gemessen.ausnahmen]));
    check(`${titel}: all of it`, JSON.stringify(gemessen) === JSON.stringify(soll));
  }
  // the sequences reach every sub-command: without an argument, with an unknown id, refused for no rights and for a guest (attack lesson: complete sequences)
  for (const s of DUNGEON_UNTERBEFEHLE) {
    for (const [titel, soll] of [['stand-in', SOLL_DUNGEON_ATTRAPPE], ['real instance', SOLL_DUNGEON_ECHT]] as const) {
      const hat = (p: string): boolean => soll.notizen.some((x) => x.startsWith(p));
      check(`[4f] ${titel}: dungeon ${s} runs without an argument, with an unknown id, for no admin and for a guest`, hat(`> dungeon ${s} (Ich) = `) && hat(`> dungeon ${s} nix (Ich) = `) && soll.notizen.some((x) => new RegExp(`^> dungeon ${s}( d1)? \\(Kein\\) = .*Admin commands are not allowed`).test(x)) && soll.notizen.some((x) => new RegExp(`^> dungeon ${s}( d1)? \\(Gast\\) = .*Admin commands are not allowed`).test(x)));
    }
  }
}
console.log('\n[4g] Behaviour of step 1, package D, after the attack (N1): spellings, boundaries, empty ids, dungeons replaced after its first use');
{
  for (const [titel, gemessen, soll] of [
    ['N1 dungeon on a stand-in', messeDungeonAttrappeN1(), SOLL_DUNGEON_ATTRAPPE_N1],
    ['N1 dungeon on a real instance', messeDungeonEchtN1(), SOLL_DUNGEON_ECHT_N1],
  ] as const) {
    const i = gemessen.notizen.findIndex((x, j) => x !== soll.notizen[j]);
    check(`${titel}: the messages, the calls with their arguments and receivers, the documents and the peer after every command, in order`, same(gemessen.notizen, soll.notizen), `${gemessen.notizen.length} notes, expected ${soll.notizen.length}; first difference at ${i}: ${gemessen.notizen[i]} (expected ${soll.notizen[i]})`);
    check(`${titel}: packets, calls, state numbers, console, exceptions`, JSON.stringify(gemessen) === JSON.stringify(soll), JSON.stringify([gemessen.aufrufe, gemessen.konsole, gemessen.ausnahmen]));
  }
  // the replacement of D-9 was reached by every branch after it was set (the sequence proves nothing if the replacement is never called)
  for (const [titel, soll, label] of [['stand-in', SOLL_DUNGEON_ATTRAPPE_N1, 'dungeonsNeu.'], ['real instance', SOLL_DUNGEON_ECHT_N1, 'dungeonsNeu.']] as const) {
    const neuGerufen = Object.keys(soll.aufrufe).filter((x) => x.startsWith(label)).sort();
    check(`[4g] ${titel}: the replacement of dungeons is called after it was set (${neuGerufen.length} methods)`, neuGerufen.length >= 8, neuGerufen.join(','));
  }
}
console.log(failures === 0 ? `\n=== I1 form k: ALL PASSED (${total}) ===` : `\n=== I1 form k: ${failures} of ${total} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
