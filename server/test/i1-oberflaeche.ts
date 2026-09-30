/**
 * I1 step 0 — the surface of `WovServer` that later steps must not lose.
 * Die Oberfläche von `WovServer`, die die Schnitte von I1 (Schritt 1 bis 10) nicht verlieren dürfen.
 *
 * Plan `Karten/2026-09-30 I1 WovServer aufteilen (Plan).md`, section 5.3: this test is green on main
 * BEFORE the first cut and must give the same lists AFTER every step. It reads `WovServer.ts` at the
 * syntax tree and builds one server without starting it (`init()` is not called, port 0, no bind).
 *
 * What it holds (each list below is frozen on purpose; a step that changes one of them is not mechanical):
 *   1. PACKET_FAELLE     the `case PacketType.X:` labels of the `onPacket` switch, in order. `onPacket`
 *                        stays in `WovServer` (block F, distributor); a case that moves out is a finding.
 *   2. BEFEHLE           the names in the admin command registry after construction (13). The
 *                        registration code moves to `spiel/befehle/*` in step 1; the names stay.
 *   3. METHODEN          39 private methods that tests reach by name (`as unknown as { … }`, `as any`,
 *                        `Object.create(WovServer.prototype)`). After a move each must still be a real
 *                        PROTOTYPE method of the class with the same name (a one-line forwarding).
 *                        Not a field with an arrow function: `Object.create(WovServer.prototype)` (see
 *                        `inventory-logout.ts`) sees prototype methods only.
 *   4. FELDER            11 private fields that tests read or write. Fields STAY in the class, also when
 *                        only one module uses them.
 *   5. UEBERSCHRIEBEN    methods that tests REPLACE on the instance (19: the 7 of step 0, the 11 packet handlers `tod-treffer-n1.ts` replaces, `handleAttack`) (`server.update = …`). Code in a
 *                        module must therefore call such a method through the context (`k.saveWorld()`),
 *                        never by importing the moved function directly, or the stand-in is bypassed.
 *   6. TEXT_TESTS        the tests that read `WovServer.ts` as text (see the exception rule below).
 * On top: a scan of all test folders (N1: every property name, `['…']` key, destructured name, type member and string
 * literal that equals a PRIVATE member of `WovServer`, whatever the receiver is called and whether the file names
 * `WovServer` or not) fails when a name is missing from the lists. The message says what to do: "Name X in
 * server/test/i1-oberflaeche.ts METHODEN eintragen". Harmless hits (another object with the same member name) go into
 * FEHLTREFFER, per name and file. This is what a step or a new test must do when a name appears that is not on main yet
 * (for example `zaehleEigeneBauten` of #153 in METHODEN, `spielerSicherung` of #146 in FELDER: those two lines come with
 * the merge of the pull request that adds the member, not before: the names do not exist on main).
 *
 * Limits of the scan (not covered, by design): a name built at run time (`server['han' + 'dleEat']`), a call through
 * `Object.getOwnPropertyNames`/`Reflect.ownKeys` loops, test code outside the scanned folders (`server/test`,
 * `admin/test`, `client/test`, `shared/test`, `scripts`, `tools`), and WIRING: the list holds names, not who calls whom.
 * If `onPacket` calls `handleAttack` where it called `handleParry`, or if `maxHealth` gets an extra required parameter,
 * this test stays green (M4 of the attack on #155). What catches the swapped calls is `server/test/kampf-waffe.ts` (16 FAIL
 * with the Attack/Parry mutant, measured in the follow-up attack), not this test and not `tod-treffer-n1.ts`; `tod-treffer-n1.ts`
 * replaces the packet handlers on the instance and thereby freezes their NAMES. Also not covered (N2, M7 limits): text readers whose
 * path is assembled at run time (`'WovServer' + '.ts'`, `` `…/WovServer${endung}` ``, `readdirSync('server/src')` and reading each file),
 * and names in template text with a substitution in the middle of the name.
 *
 * Further limits found by the follow-up attack on N2 (M3), not caught on purpose or because catching them does not stay small:
 *  - an object literal that is NOT written inside `Object.assign(…)`: `const attrappen = { name() {} }; Object.assign(server, attrappen)`,
 *    `{ ...server, name() {} }`, `Object.assign(server, fabrik())`, `Object.assign(server, { ...{ name() {} } })`, and
 *    `const { assign } = Object; assign(server, { … })` (the call is recognised only as `Object.assign`); object literals elsewhere
 *    would hit harmless keys such as `running` or `update` all over the tests;
 *  - a class WITHOUT `extends` hung onto the server with `Object.setPrototypeOf`;
 *  - a text reader that reads `server/dist/WovServer.js` (the built file), and text readers in `.sh` or `.py` files under `tools/`
 *    (the scan parses TypeScript/JavaScript only);
 *  - files with other endings than `.ts .tsx .mts .cts .mjs .cjs .js .jsx`. (Directories `build`, `dist` and dot-names are scanned since N3.)
 * The subclass catcher fires on EVERY class with `extends`, whatever the base; a harmless hit goes into FEHLTREFFER.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { createWovServer, WovServer } from '../src/WovServer.js';

const WURZEL = resolve(import.meta.dirname, '../..');

let failures = 0;
function check(ok: boolean, name: string, detail = ''): void {
  if (ok) console.log(`  PASS ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
    failures++;
  }
}
const gleich = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const fehlt = (soll: readonly string[], ist: readonly string[]): string[] => soll.filter((x) => !ist.includes(x));

// ── Die eingefrorenen Listen ─────────────────────────────────────────────────────────────────

/** `case PacketType.X:` labels of `onPacket`, in source order (main cb85ef60). */
export const PACKET_FAELLE = [
  'PlayerInput',
  'ChatMessage',
  'SetTimeOfDay',
  'AdminCommand',
  'Interact',
  'Attack',
  'Parry',
  'TerrainOp',
  'PlacePiece',
  'RemovePiece',
  'Craft',
  'Eat',
  'ContainerAction',
  'SetFigur',
  'SetAussehen',
  'Equip',
  'DungeonEditRequest',
  'DungeonEditSave',
  'DungeonModulBau',
  'DungeonModulLoeschen',
] as const;

/** Names in the admin command registry after `createWovServer` (sorted). 13 commands. One name per line, sorted: two pull requests that add a name touch different lines. */
export const BEFEHLE = [
  'abbau',
  'admin',
  'bann',
  'dungeon',
  'entbann',
  'fly',
  'item',
  'kick',
  'marke',
  'spawn',
  'spieler',
  'teleport',
  'wetter',
  'zone',
] as const;

/** Private methods that tests reach by name (21 of step 0, 11 found by the broadened scan of N1: `tod-treffer-n1.ts` replaces the 11 packet handlers, and `zaehleEigeneBauten` of #153; step 2 adds 5: the forwardings of the moved handlers that `i1-form-k.ts` calls by name, `handleAdminCommand` was on the list already; #146 added `sichereSpielerSofort`). Each stays a prototype method of `WovServer`. */
export const METHODEN = [
  'applyCreatureAttack',
  'darfBenutzen',
  'ermittleGespeichertenStand',
  'gebeItem',
  'handleAdminCommand',
  'handleAttack',
  'handleChatMessage',
  'handleContainerAction',
  'handleCraft',
  'handleDungeonEditRequest',
  'handleDungeonEditSave',
  'handleDungeonModulBau',
  'handleDungeonModulLoeschen',
  'handleEat',
  'handleEquip',
  'handleInteract',
  'handleParry',
  'handlePlacePiece',
  'handlePlayerInput',
  'handleRemovePiece',
  'handleSetAussehen',
  'handleSetTimeOfDay',
  'handleTerrainOp',
  'inventarSync',
  'maxHealth',
  'momentaufnahme',
  'onPeerQuit',
  'registerSpawnCommand',
  'sendPlayerState',
  'sendeTrefferEffekt',
  'sichereSpielerSofort', // F8 (#146): f8n3-kennung-kill ruft die Ereignis-Sicherung im Kindprozess
  'syncZDOs',
  'teleportPeer',
  'update',
  'welt',
  'weltSpawn',
  'writeZDO',
  'zaehleEigeneBauten',
  'zdosVon',
] as const;

/** Private fields that tests read or write. Fields stay in the class. */
export const FELDER = [
  'kontenDb',
  'layoutWache',
  'loeschsperrePfad',
  'ohneWeltLetzteMeldung',
  'running',
  'saveTimer',
  'savedPlayers',
  'speichertGerade',
  'spielerSicherung', // F8 (#146): spielerzustand-writebehind liest die Zaehler der Spielersicherung
  'stempel', // F8 (#146): f8n3-kennung-kill liest den naechsten Stempel des Servers
  'timeSyncAccumulator',
  'updateTimer',
  'worldTime',
  'zustandWeltId', // F8 (#146): f8n3-kennung-kill liest die Weltkennung des Servers
  'gegenstandsWache', // G2: gegenstaende-g2-live liest den Zaehler interneFehler der Gegenstands-Wache
] as const;

/**
 * Methods that tests REPLACE on the instance with a stand-in. Public or private; calls between modules
 * must run through the context so the stand-in is seen. Not scanned; kept by hand from the inventory
 * (armor-body-variants, equipment-sets, ironward, wildwarden, b8-angreifbar, g12-tick-aufteilung,
 * listen-bindefehler, kampf-waffe, stopp-speichern).
 */
export const UEBERSCHRIEBEN = [
  'ermittleGespeichertenStand',
  'handleAdminCommand',
  'handleAttack',
  'handleChatMessage',
  'handleContainerAction',
  'handleCraft',
  'handleEat',
  'handleEquip',
  'handleInteract',
  'handleParry',
  'handlePlacePiece',
  'handleRemovePiece',
  'handleTerrainOp',
  'saveWorld',
  'saveWorldAsync',
  'stop',
  'syncZDOs',
  'update',
  'zdosVon',
] as const;

/** Text tests: which test reads which source of `WovServer.ts`, and in which step it may be changed. */
export const TEXT_TESTS: readonly { datei: string; muster: readonly string[]; schritt: number; ziel: string; wirdRot: boolean }[] = [
  {
    datei: 'server/test/modulbau-grenzen.ts',
    muster: ['case PacketType.DungeonModulBau:', 'this\\.handleDungeonModulBau\\(peer, reader\\)', '\\bbaueModul\\(/.test(dungeonEditPakete)'],
    schritt: 2, // done in step 2: handleDungeonModulBau moved to spiel/DungeonEditPakete.ts; the test now reads the case and the forwarding in WovServer.ts and the call of `baueModul(` in the module
    ziel: 'server/src/spiel/DungeonEditPakete.ts',
    wirdRot: false,
  },
  {
    datei: 'server/test/modulbau-loeschen.ts',
    muster: [
      'case PacketType.DungeonModulLoeschen:',
      'this\\.handleDungeonModulLoeschen\\(peer, reader\\)',
      '\\bdeleteModule\\(/.test(dungeonEditPakete)',
      '/^  dungeonsWurzel\\(\\): string \\{/m.test(wovServer)',
      '/resolve\\(this\\.dungeonsWurzel\\(\\), this\\.config\\.worldName\\)/.test(wovServer)',
      '/dungeonsWurzel: k\\.dungeonsWurzel\\(\\)/.test(dungeonEditPakete)',
    ],
    schritt: 2, // done in step 2: `deleteModule(` and `dungeonsWurzel: k.dungeonsWurzel()` are read in spiel/DungeonEditPakete.ts; the case, the method `dungeonsWurzel` (not private any more) and its constructor use are read in WovServer.ts
    ziel: 'server/src/spiel/DungeonEditPakete.ts',
    wirdRot: false,
  },
  {
    datei: 'server/test/i1-form-k.ts',
    muster: ["join(WURZEL, 'server/src/WovServer.ts')", 'pruefeKlasse(MODULE, klassenText, PUBLIC_MEMBERS)'],
    schritt: 2, // new in step 2: the guard of Form k reads the class text (forwardings, imports, `onPacket`, the non-private members) and the text of every module of its table MODULE
    ziel: 'server/src/spiel/*.ts (every module listed in MODULE of that test)',
    wirdRot: false,
  },
  {
    datei: 'client/test/dungeon-neuer-saal.ts',
    muster: ["['server/src/WovServer.ts', 'serverConfigFlags']", '!/^const FLAG_[A-Z_]+\\s*=/m.test(text)'],
    schritt: 6, // block E: `onPeerAuthenticated` moves to spiel/Anmeldung.ts with the import of `serverConfigFlags`. Also: the "no own bit list" check must then read spiel/*.ts as well (coverage, does not turn red)
    ziel: 'server/src/spiel/Anmeldung.ts',
    wirdRot: true,
  },
];

/**
 * Files that NAME `server/src/WovServer.ts` in a string but do not read its text as a check (found by scan 7).
 * One entry per line, sorted by path. An entry needs a reason.
 */
export const TEXT_AUSNAHMEN: readonly { datei: string; grund: string }[] = [
  { datei: 'tools/dungeon2-e2e.mjs', grund: 'nennt den Pfad nur in einem erzeugten Import (Pfad als Daten), liest die Datei nicht' },
  { datei: 'scripts/pruefe-groessen.mjs', grund: 'nennt den Pfad als Eintrag der Liste FREI_ERLAUBT (Daten), liest die Datei nur zum Zeilenzählen' },
  { datei: 'server/test/i1t-beute-waffe.ts', grund: 'nennt den Pfad server/src/WovServer.ts als Konstante seines Scanners (CLASS_FILE); liest Deklarationen und Importe aller Dateien unter server/src am Syntaxbaum, kein Muster an einen Block gebunden' },
  { datei: 'tools/verschiebung/pruefstand/echt.ts', grund: 'nennt den Pfad als Konstante WOV (Daten): die Probe holt Alt- und Neustand der Datei aus Git und ändert sie als Fälschung, prüft keinen Block von WovServer.ts auf ein Muster' },
];

/**
 * Known harmless hits of scan 8: a name that equals a private member of `WovServer` but belongs to another object in
 * that file. Per name AND file, so a new file with the same name is still reported. One entry per line, sorted by
 * file, then name. An entry needs a reason.
 */
export const FEHLTREFFER: readonly { name: string; datei: string; grund: string }[] = [
  { name: 'zeigeTreffer', datei: 'client/test/tod-treffer-avatar.ts', grund: 'AvatarRig.zeigeTreffer (Client), nicht das Serverfeld gleichen Namens' },
  { name: 'onPacket', datei: 'server/test/i1-form-k.ts', grund: 'Name, unter dem das Mitglied im Syntaxbaum der Klasse gesucht wird (Text, kein Zugriff zur Laufzeit)' },
  { name: 'geklemmteEintraege', datei: 'tools/verschiebung/pruefstand/echt.ts', grund: 'Name in der Namensliste der Echt-Probe des Verschiebebeweises (Zeichenkette), keine Server-Nutzung' },
];

// ── Syntaxbaum von WovServer.ts ──────────────────────────────────────────────────────────────

const quelle = readFileSync(join(WURZEL, 'server/src/WovServer.ts'), 'utf8');
const sf = ts.createSourceFile('WovServer.ts', quelle, ts.ScriptTarget.Latest, true);
const klasse = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'WovServer');
if (!klasse) throw new Error('class WovServer not found in server/src/WovServer.ts');

const mitglieder = new Map<string, { art: 'methode' | 'feld' | 'sonst'; privat: boolean }>();
for (const m of klasse.members) {
  if (!m.name || !ts.isIdentifier(m.name)) continue;
  mitglieder.set(m.name.text, {
    art: ts.isMethodDeclaration(m) ? 'methode' : ts.isPropertyDeclaration(m) ? 'feld' : 'sonst',
    privat: !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword),
  });
}

// ── 1. onPacket ──────────────────────────────────────────────────────────────────────────────
console.log('1. onPacket cases');
{
  const onPacket = klasse.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === 'onPacket');
  const faelle: string[] = [];
  const geh = (n: ts.Node): void => {
    if (ts.isCaseClause(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'PacketType') {
      faelle.push(n.expression.name.text);
    }
    ts.forEachChild(n, geh);
  };
  if (onPacket) geh(onPacket);
  check(!!onPacket, 'onPacket is a method of WovServer');
  check(gleich(faelle, PACKET_FAELLE), `the ${PACKET_FAELLE.length} case labels are unchanged and in the same order`, `missing: ${fehlt(PACKET_FAELLE, faelle)}; new: ${fehlt(faelle, PACKET_FAELLE)}; found ${faelle.length}`);
}

// ── 2. Registry ──────────────────────────────────────────────────────────────────────────────
console.log('2. Admin command registry');
{
  // init() is NOT called: the constructor registers all commands, nothing binds a port or reads a world.
  // Every directory the constructor opens databases in points into one temp folder (removed below).
  const tmp = mkdtempSync(join(tmpdir(), 'i1-oberflaeche-'));
  const server = createWovServer({
    port: 0,
    worldFeatures: false,
    worldName: 'i1-oberflaeche',
    worldsDir: join(tmp, 'worlds'),
    kontenDir: join(tmp, 'konten'),
    forumDir: join(tmp, 'forum'),
    generiertDir: join(tmp, 'generiert'),
  });
  const handlers = (server.adminCommands as unknown as { handlers: Map<string, unknown> }).handlers;
  const namen = [...handlers.keys()].sort();
  (server as unknown as { kontenDb?: { close?: () => void } }).kontenDb?.close?.();
  rmSync(tmp, { recursive: true, force: true });
  check(gleich(namen, BEFEHLE), `the registry holds exactly the ${BEFEHLE.length} frozen command names`, `missing: ${fehlt(BEFEHLE, namen)}; new: ${fehlt(namen, BEFEHLE)}`);
  console.log(`       registered: ${namen.length} (${namen.join(' ')})`);
}

// ── 3./4. Methoden und Felder ────────────────────────────────────────────────────────────────
console.log('3. Private methods reached by tests stay prototype methods');
for (const n of METHODEN) {
  const m = mitglieder.get(n);
  const d = Object.getOwnPropertyDescriptor(WovServer.prototype, n);
  check(m?.art === 'methode' && typeof d?.value === 'function', `${n} is a method declaration and a prototype function`, `member: ${JSON.stringify(m)}, prototype: ${d ? typeof d.value : 'none'}`);
}
console.log('4. Private fields reached by tests stay fields of the class');
for (const n of FELDER) {
  const m = mitglieder.get(n);
  check(m?.art === 'feld', `${n} is a property declaration of WovServer`, `member: ${JSON.stringify(m)}`);
}
console.log('5. Methods replaced on the instance by tests exist');
for (const n of UEBERSCHRIEBEN) {
  const d = Object.getOwnPropertyDescriptor(WovServer.prototype, n);
  check(typeof d?.value === 'function', `${n} is a prototype function`);
}

// ── 6. Text-Tests ────────────────────────────────────────────────────────────────────────────
console.log('6. Text tests that read WovServer.ts');
for (const t of TEXT_TESTS) {
  let text = '';
  try {
    text = readFileSync(join(WURZEL, t.datei), 'utf8');
  } catch {
    /* reported below */
  }
  check(text !== '', `${t.datei} exists`);
  check(t.muster.every((m) => text.includes(m)), `${t.datei} still names all its patterns (${t.muster.length})`, `patterns: ${t.muster.filter((m) => !text.includes(m))}`);
}

// ── Suche in den Testordnern ─────────────────────────────────────────────────────────────────
const ordner = ['server/test', 'admin/test', 'client/test', 'shared/test', 'scripts', 'tools'];
function dateien(d: string, aus: string[] = []): string[] {
  let namen: string[];
  try {
    namen = readdirSync(d);
  } catch {
    return aus;
  }
  for (const e of namen) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) dateien(p, aus);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(e)) aus.push(p);
  }
  return aus;
}
const alle = ordner.flatMap((o) => dateien(join(WURZEL, o)));
const quelleCache = new Map<string, ts.SourceFile>();
const quelleVon = (f: string): ts.SourceFile => {
  let q = quelleCache.get(f);
  if (!q) {
    q = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    quelleCache.set(f, q);
  }
  return q;
};
const teststellen = alle.filter((f) => /\/(test|tools|scripts)\//.test(f.replace(WURZEL, '')) || /\/test\//.test(f));

console.log('7. Scan: text tests');
{
  // A test (or tool) that names the SOURCE file `WovServer.ts` in a string literal (`'server/src/WovServer.ts'`,
  // `join('server', 'src', 'WovServer.ts')`, a relative `'../src/WovServer.ts'`, `readFile` of any kind). Import
  // specifiers end in `.js` and do not match. Comments do not count.
  const gefunden = new Set<string>();
  for (const f of teststellen) {
    const rel = relative(WURZEL, f);
    if (rel === 'server/test/i1-oberflaeche.ts') continue;
    const tf = quelleVon(f);
    const geh = (n: ts.Node): void => {
      if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /WovServer\.ts\b/.test(n.text)) gefunden.add(rel);
      ts.forEachChild(n, geh);
    };
    geh(tf);
  }
  const soll = new Set([...TEXT_TESTS.map((t) => t.datei), ...TEXT_AUSNAHMEN.map((t) => t.datei)]);
  const zuViel = [...gefunden].filter((x) => !soll.has(x)).sort();
  const fehltNun = [...soll].filter((x) => !gefunden.has(x)).sort();
  check(zuViel.length === 0, 'no test or tool names WovServer.ts as a path outside the lists', `Datei „${zuViel.join('; ')}“ nennt server/src/WovServer.ts als Pfad: liest sie den Text, gehört sie in TEXT_TESTS (mit Schritt und Ziel); nennt sie ihn nur als Daten, in TEXT_AUSNAHMEN (mit Grund) eintragen`);
  check(fehltNun.length === 0, 'every listed text test / exception still names WovServer.ts', `nicht mehr gefunden: ${fehltNun.join('; ')} (Eintrag entfernen oder Datei prüfen)`);
}

console.log('8. Scan: private names reached by tests are all frozen');
{
  // Every property name, `['…']` key, destructured name, type member and string literal in any test-like file that
  // equals a PRIVATE member of WovServer, whatever the receiver is called and whether the file names WovServer or not.
  // Known harmless hits (another object with the same member name) are listed in FEHLTREFFER, per name AND file.
  const eingefroren = new Set<string>([...METHODEN, ...FELDER]);
  const treffer = new Map<string, Set<string>>();
  const privat = (n: string): boolean => mitglieder.get(n)?.privat === true;
  const ausnahme = (n: string, rel: string): boolean => FEHLTREFFER.some((x) => x.name === n && x.datei === rel);
  for (const f of teststellen) {
    const rel = relative(WURZEL, f);
    if (rel === 'server/test/i1-oberflaeche.ts') continue;
    const tf = quelleVon(f);
    const merke = (n: string): void => {
      if (!privat(n) || eingefroren.has(n) || ausnahme(n, rel)) return;
      if (!treffer.has(n)) treffer.set(n, new Set());
      treffer.get(n)!.add(rel);
    };
    const geh = (n: ts.Node): void => {
      if ((ts.isTypeLiteralNode(n) || ts.isInterfaceDeclaration(n)) && n.members) for (const m of n.members) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteralLike(m.name))) merke(m.name.text);
      if (ts.isPropertyAccessExpression(n)) merke(n.name.text);
      if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) merke(n.argumentExpression.text);
      // M7: `Object.assign(server, { name() {}, name: …, name })` und Unterklassen mit einem Mitglied dieses Namens
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'assign' && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Object') {
        for (const a of n.arguments.slice(1)) {
          if (!ts.isObjectLiteralExpression(a)) continue;
          for (const m of a.properties) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteralLike(m.name))) merke(m.name.text);
        }
      }
      if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) {
        for (const m of n.members) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteralLike(m.name))) merke(m.name.text);
      }
      if (ts.isBindingElement(n)) merke(((n.propertyName ?? n.name) as ts.Identifier).text ?? '');
      if (ts.isStringLiteralLike(n) && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)) merke(n.text);
      ts.forEachChild(n, geh);
    };
    geh(tf);
  }
  const fehler = [...treffer.entries()].sort().map(([n, w]) => `Name "${n}" in server/test/i1-oberflaeche.ts ${mitglieder.get(n)?.art === 'feld' ? 'FELDER' : 'METHODEN'} eintragen (gefunden in: ${[...w].join(', ')}); ist es ein Fehltreffer (anderes Objekt), stattdessen in FEHLTREFFER mit Grund`);
  check(fehler.length === 0, 'no test reaches a private member that is missing from METHODEN/FELDER', fehler.join('\n       '));
}

console.log(failures === 0 ? '\nI1 oberflaeche: all green.' : `\nI1 oberflaeche: ${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
