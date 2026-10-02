/**
 * D5 — the E key without a target must not send `dungeon enter` to a player who has no business with a dungeon.
 *
 * Fault (DEV 02.10.2026): E with nothing in reach fell through to `sendAdminCommand('dungeon enter')`; a player without admin
 * rights got "Admin commands are not allowed for this player" on every such press.
 *
 *  [1] The pure rule (`eOhneZiel`): overworld, no entrance near -> nothing; entrance within 16 m -> enter; dungeon -> leave / hint.
 *  [2] main.ts: the only `dungeon enter` goes through the rule, and the file did not grow (3679 lines at the start of N1).
 *  [3] Z4 (N3): the server tells the client whether the player is an admin (`ServerConfig` flag at login, `AdminEvent` `admin` live);
 *      E sends `dungeon enter` only for an admin, a new connection starts without rights until `ServerConfig` says otherwise; the
 *      wiring in main.ts (both packets). The server check against a faked flag is in `server/test/d5-beute-admin.ts`.
 *
 * Run: npx tsx client/test/e-ohne-ziel.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { eOhneZiel, DUNGEON_BETRETEN_M, DUNGEON_VERLASSEN_M } from '../src/player/eOhneZiel';
import { FLAG_ADMIN, FLAG_MODULE_BUILD } from '@wov/shared';
import { ESitzung } from '../src/player/eSitzung';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  console.log(`  ${bedingung ? 'PASS' : 'FAIL'}  ${text}${detail ? ' — ' + detail : ''}`);
  if (!bedingung) fehler++;
};
// Asymmetric on purpose: x and z differ everywhere, so a swapped axis cannot hide behind equal numbers.
const lage = (o: Partial<Parameters<typeof eOhneZiel>[0]> = {}) => ({ istAdmin: true, imDungeon: false, pos: { x: 100, z: 120 }, dungeonSpawn: { x: 10, z: 20 }, eingaenge: [], ...o });

pruefe(eOhneZiel(lage()) === 'nichts', 'overworld, no entrance known: nothing (no dungeon enter)');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 500, z: 500 }] })) === 'nichts', 'overworld, entrance far away: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100 + DUNGEON_BETRETEN_M, z: 120 }] })) === 'dungeon-enter', 'entrance exactly 16 m away in x: enter');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100 + DUNGEON_BETRETEN_M + 0.5, z: 120 }] })) === 'nichts', 'entrance 16.5 m away in x: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100, z: 120 + DUNGEON_BETRETEN_M }] })) === 'dungeon-enter', 'entrance exactly 16 m away in z: enter');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100, z: 120 + DUNGEON_BETRETEN_M + 0.5 }] })) === 'nichts', 'entrance 16.5 m away in z: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 500, z: 500 }, { x: 105, z: 120 }] })) === 'dungeon-enter', 'any one near entrance is enough');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 110, z: 130 }] })) === 'dungeon-enter', 'the distance counts in x AND z (14.1 m)');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 112, z: 132 }] })) === 'nichts', 'the distance counts in x AND z (17 m)');
const drin = (dx: number, dz: number) => eOhneZiel(lage({ imDungeon: true, pos: { x: 10 + dx, z: 20 + dz } }));
pruefe(drin(3, 4) === 'dungeon-leave', 'in a dungeon at 5 m from the entry: leave');
pruefe(drin(DUNGEON_VERLASSEN_M, 0) === 'dungeon-leave', 'in a dungeon at exactly 6 m in x: leave');
pruefe(drin(DUNGEON_VERLASSEN_M + 0.5, 0) === 'hinweis-eingang', 'in a dungeon at 6.5 m in x: the hint');
pruefe(drin(0, DUNGEON_VERLASSEN_M) === 'dungeon-leave', 'in a dungeon at exactly 6 m in z: leave');
pruefe(drin(0, DUNGEON_VERLASSEN_M + 0.5) === 'hinweis-eingang', 'in a dungeon at 6.5 m in z: the hint');
pruefe(eOhneZiel(lage({ imDungeon: true, eingaenge: [{ x: 100, z: 120 }] })) === 'hinweis-eingang', 'in a dungeon the overworld entrances do not count');

// Z4: without admin rights `dungeon enter` is off; leaving a dungeon and the hint stay.
const nahEingang = { eingaenge: [{ x: 105, z: 120 }] };
pruefe(eOhneZiel(lage({ ...nahEingang, istAdmin: false })) === 'nichts', 'Z4: at a real entrance without admin rights: nothing is sent');
pruefe(eOhneZiel(lage({ ...nahEingang, istAdmin: true })) === 'dungeon-enter', 'Z4: an admin at a real entrance enters');
pruefe(eOhneZiel(lage({ istAdmin: true })) === 'nichts', 'Z4: an admin with no entrance within 16 m: nothing');
pruefe(eOhneZiel(lage({ eingaenge: [{ x: 100 + DUNGEON_BETRETEN_M + 0.5, z: 120 }], istAdmin: true })) === 'nichts', 'Z4: an admin 16.5 m from the entrance: nothing');
pruefe(eOhneZiel(lage({ imDungeon: true, pos: { x: 12, z: 20 }, istAdmin: false })) === 'dungeon-leave', 'Z4: in a dungeon the missing flag does not hide `dungeon leave` (a player who is inside can get out)');
pruefe(eOhneZiel(lage({ imDungeon: true, pos: { x: 90, z: 90 }, istAdmin: false })) === 'hinweis-eingang', 'Z4: nor the hint far from the entry');
let nachgeladen = 0;
const sitzung = new ESitzung(() => { nachgeladen++; });
const lageEingang = { imDungeon: false, pos: { x: 100, z: 120 }, dungeonSpawn: { x: 10, z: 20 }, eingaenge: [{ x: 105, z: 120 }] };
pruefe(!sitzung.istAdmin && sitzung.aktion(lageEingang) === 'nichts', 'Z4: before ServerConfig: no rights, nothing at the entrance');
sitzung.serverConfig(FLAG_ADMIN);
pruefe(sitzung.istAdmin && sitzung.aktion(lageEingang) === 'dungeon-enter', 'Z4: ServerConfig with the admin bit: the entrance enters');
sitzung.serverConfig(0xff & ~FLAG_ADMIN);
pruefe(!sitzung.istAdmin && sitzung.aktion(lageEingang) === 'nichts', 'Z4: ServerConfig without the admin bit (all other bits set): nothing');
sitzung.serverConfig(FLAG_MODULE_BUILD);
pruefe(!sitzung.istAdmin, 'Z4: the module-build bit alone is not the admin bit');
sitzung.serverConfig(FLAG_ADMIN);
// B2: rights change live
pruefe(sitzung.adminEreignis('admin', false, 'Deine Adminrechte wurden entzogen.') === 'Deine Adminrechte wurden entzogen.' && sitzung.aktion(lageEingang) === 'nichts', 'B2: rights withdrawn live: E sends nothing, the text is passed on unchanged');
pruefe(sitzung.adminEreignis('admin', true, 'Du hast jetzt Adminrechte.') === 'Du hast jetzt Adminrechte.' && sitzung.aktion(lageEingang) === 'dungeon-enter', 'B2: rights granted live: E sends `dungeon enter` at the entrance');
pruefe(sitzung.adminEreignis('fly', false, 'Fly mode OFF') === 'Fly mode OFF' && sitzung.istAdmin, 'B2: another command with active=false (fly) does not touch the rights');
pruefe(sitzung.adminEreignis('fly', true, 'Fly mode ON') === 'Fly mode ON' && sitzung.istAdmin, 'B2: nor does fly with active=true');
sitzung.adminEreignis('admin', false, '');
pruefe(!sitzung.istAdmin, 'B2: back to no rights');
pruefe(sitzung.adminEreignis('Admin', true, '') === '' && !sitzung.istAdmin, 'B2: the command name is compared exactly (the server sends `admin`)');
sitzung.adminEreignis('admin', true, '');
pruefe(nachgeladen === 0, 'the reset callback did not run before a connection');
sitzung.neueVerbindung();
pruefe(nachgeladen === 1 && !sitzung.istAdmin && sitzung.aktion(lageEingang) === 'nichts', 'Z4: a new connection (PeerInfo) runs the callback once and forgets the rights (ServerConfig sets them again)');
pruefe(FLAG_ADMIN === 128, 'the admin bit is bit 7');

const quelle = readFileSync(resolve(import.meta.dirname, '../src/main.ts'), 'utf8');
const zeilen = quelle.split('\n').length - 1;
const treffer = quelle.match(/sendAdminCommand\('dungeon enter'\)/g) ?? [];
pruefe(treffer.length === 1, "main.ts sends the bare 'dungeon enter' exactly once", String(treffer.length));
pruefe(/aktion === 'dungeon-enter'\)\s*socket\.sendAdminCommand\('dungeon enter'\)/.test(quelle), "... and only when the rule says 'dungeon-enter'");
pruefe(/aktion === 'dungeon-leave'\)\s*socket\.sendAdminCommand\('dungeon leave'\)/.test(quelle), "'dungeon-leave' sends `dungeon leave`");
pruefe(/aktion === 'hinweis-eingang'\)\s*hud\.meldung\(/.test(quelle), "'hinweis-eingang' shows the hint");
// The wiring on the syntax tree: the one call of the rule hands over exactly these four values, unchanged (no slice, no copy, no other variable).
const baum = ts.createSourceFile('main.ts', quelle, ts.ScriptTarget.Latest, true);
const aufrufe: ts.CallExpression[] = [];
const besuche = (n: ts.Node): void => {
  if (ts.isCallExpression(n) && n.expression.getText(baum) === 'eSitzung.aktion') aufrufe.push(n);
  ts.forEachChild(n, besuche);
};
besuche(baum);
pruefe(aufrufe.length === 1, 'main.ts calls the rule (through eSitzung.aktion) exactly once', String(aufrufe.length));
// Z4 wiring: the AdminEvent handler hands command, active and text to `eSitzung.adminEreignis` in packet order and shows what it returns.
{
  const ae: ts.CallExpression[] = [];
  const such = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'eSitzung.adminEreignis') ae.push(n);
    ts.forEachChild(n, such);
  };
  such(baum);
  const a0 = ae[0];
  pruefe(ae.length === 1 && a0!.arguments.map((x) => x.getText(baum)).join('|') === 'command|active|reader.readString()', 'main.ts: exactly one eSitzung.adminEreignis(command, active, reader.readString())', String(ae.length));
  const decl = a0?.parent;
  pruefe(!!decl && ts.isVariableDeclaration(decl) && decl.name.getText(baum) === 'message', '... and its result is the `message` that the handler shows');
  let pakete = '';
  for (let n: ts.Node | undefined = a0; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'socket.on') pakete = n.arguments[0]?.getText(baum) ?? '';
  }
  pruefe(pakete === 'PacketType.AdminEvent', '... inside the PacketType.AdminEvent handler', pakete);
  const fn = decl?.parent?.parent?.parent;
  const zeigt = !!fn && ts.isBlock(fn) && fn.statements.some((s) => ts.isIfStatement(s) && s.expression.getText(baum) === 'message' && /hud\.meldung\(message\)/.test(s.thenStatement.getText(baum)));
  pruefe(zeigt, '... and `if (message) hud.meldung(message)` stays in that handler');
  // The reads come in the packet order: command (string), active (bool), message (string).
  const reihenfolge: string[] = [];
  if (fn && ts.isBlock(fn)) {
    const lies = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && /^reader\.read/.test(n.expression.getText(baum))) reihenfolge.push(n.expression.getText(baum));
      ts.forEachChild(n, lies);
    };
    lies(fn);
  }
  pruefe(reihenfolge.join(',') === 'reader.readString,reader.readBool,reader.readString', '... reading command (string), active (bool), text (string) in that order', reihenfolge.join(','));
  const sc: ts.CallExpression[] = [];
  const suchSc = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'eSitzung.serverConfig') sc.push(n);
    ts.forEachChild(n, suchSc);
  };
  suchSc(baum);
  const s0 = sc[0];
  let paketSc = '';
  for (let n: ts.Node | undefined = s0; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'socket.on') paketSc = n.arguments[0]?.getText(baum) ?? '';
  }
  pruefe(sc.length === 1 && s0!.arguments.length === 1 && s0!.arguments[0]!.getText(baum) === 'flags' && paketSc === 'PacketType.ServerConfig', 'main.ts: exactly one eSitzung.serverConfig(flags) in the PacketType.ServerConfig handler', `${sc.length} ${paketSc}`);
  const dekl = s0?.parent?.parent;
  const stmts = (dekl && ts.isBlock(dekl)) ? dekl.statements.map((x) => x.getText(baum)) : [];
  const iFlags = stmts.findIndex((x) => /^const flags = reader\.readUInt8\(\)/.test(x));
  const iSc = stmts.findIndex((x) => x.startsWith('eSitzung.serverConfig(flags)'));
  pruefe(iFlags >= 0 && iSc === iFlags + 1, '... right after `const flags = reader.readUInt8()`', `${iFlags}/${iSc}`);
}
const arg = aufrufe[0]?.arguments[0];
const felder = new Map<string, string>();
if (arg && ts.isObjectLiteralExpression(arg)) {
  for (const p of arg.properties) {
    if (ts.isShorthandPropertyAssignment(p)) felder.set(p.name.text, p.name.text);
    else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) felder.set(p.name.text, p.initializer.getText(baum));
  }
}
const erwartet: Record<string, string> = { imDungeon: 'imDungeon', pos: 'player.position', dungeonSpawn: 'dungeonSpawn', eingaenge: 'dungeonEingaenge' };
for (const [name, wert] of Object.entries(erwartet)) pruefe(felder.get(name) === wert, `the rule gets \`${name}\` as exactly \`${wert}\``, felder.get(name) ?? 'missing');
pruefe(felder.size === 4, 'and no other field', [...felder.keys()].join(','));
pruefe(zeilen <= 3679, 'main.ts did not grow', `${zeilen} lines (limit 3679, guard 3700)`);

console.log(fehler === 0 ? '\ne-ohne-ziel: OK' : `\ne-ohne-ziel: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
