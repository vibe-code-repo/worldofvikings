/**
 * D3-K3: the block on the wire and in the wiring (no browser, no server).
 *
 *  [1] `GameSocket.sendBlock`: packet 89 with one Bool; the old `sendParry` is gone, and the client sends no `Parry` any more.
 *  [2] `Block=false` from the server (the real handler `verdrahteKampf` registers) ends the client's block; `Block=true`
 *      does not; an older caller without the block parameter does not crash.
 *  [3] The whole chain on the wire: BlockSteuerung -> sendBlock -> bytes: press = [89,1], release = [89,0], one per change.
 *  [4] The HUD messages the server sends (`@kampf.geblockt`, `@kampf.pariert`, `@kampf.zu_erschoepft`) are catalogue keys
 *      in de and en, and read as such.
 *  [5] `main.ts` is wired to it, checked on the syntax tree (not on text): the right click no longer parries, the
 *      `BlockSteuerung` gets the eleven fields of the moment, the controller gets the state, an own swing and the blur end
 *      the block, the server hook is passed to `verdrahteKampf`, the measuring cell switches the block.
 *
 * Run: npx tsx client/test/d3-block-netz.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PacketType, zerlegeServerMeldung } from '@wov/shared';
import { SERVER_MELDUNG_GEBLOCKT, SERVER_MELDUNG_PARIERT, SERVER_MELDUNG_ZU_ERSCHOEPFT } from '@wov/shared/src/kampf/block.js';
import { GameSocket } from '../src/net/GameSocket.js';
import { verdrahteKampf } from '../src/net/KampfNetz.js';
import { BlockSteuerung, type BlockUmfeld } from '../src/player/BlockSteuerung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A socket with an open fake line that records what it sends. */
function neuerSocket(): { socket: GameSocket; gesendet: number[][] } {
  const gesendet: number[][] = [];
  const socket = new GameSocket('ws://test.invalid', 'Test');
  (socket as unknown as { ws: unknown }).ws = { readyState: WebSocket.OPEN, send: (b: ArrayBuffer) => gesendet.push([...new Uint8Array(b)]) };
  return { socket, gesendet };
}
const hereinkommen = (socket: GameSocket, bytes: number[]): void => {
  (socket as unknown as { handleMessage(d: ArrayBuffer): void }).handleMessage(new Uint8Array(bytes).buffer);
};

// ── [1] the packet ────────────────────────────────────────────────────────
console.log('\n[1] sendBlock');
{
  const { socket, gesendet } = neuerSocket();
  socket.sendBlock(true);
  socket.sendBlock(false);
  check('the packet type is 89', PacketType.Block === 89);
  check('sendBlock(true) = [89, 1], sendBlock(false) = [89, 0]', gesendet.length === 2 && gesendet[0]!.join() === '89,1' && gesendet[1]!.join() === '89,0', JSON.stringify(gesendet));
  check('the old `sendParry` is gone from the socket', !('sendParry' in socket));
  const quelle = readFileSync(resolve(HIER, '../src/net/GameSocket.ts'), 'utf-8');
  check('and no client code sends `PacketType.Parry` any more', !/PacketType\.Parry/.test(quelle) && !/sendParry/.test(readFileSync(resolve(HIER, '../src/main.ts'), 'utf-8')));
}

// ── [2] Block=false from the server ───────────────────────────────────────
console.log('\n[2] The server ends the block');
{
  const { socket } = neuerSocket();
  let beendet = 0;
  verdrahteKampf(socket, {} as never, () => null, { kampfEffekte: { treffer: () => undefined }, kampfToene: { treffer: () => undefined } }, undefined, { serverBeendet: () => { beendet++; } });
  hereinkommen(socket, [PacketType.Block, 0]);
  check('`Block=false` calls `serverBeendet` once', beendet === 1, `${beendet}`);
  hereinkommen(socket, [PacketType.Block, 1]);
  check('`Block=true` from the server does nothing', beendet === 1, `${beendet}`);
  hereinkommen(socket, [PacketType.Block, 0]);
  hereinkommen(socket, [PacketType.Block, 0]);
  check('every `Block=false` counts (three in all)', beendet === 3, `${beendet}`);
  const { socket: alt } = neuerSocket();
  let fehler = '';
  try {
    verdrahteKampf(alt, {} as never, () => null, { kampfEffekte: { treffer: () => undefined }, kampfToene: { treffer: () => undefined } });
    hereinkommen(alt, [PacketType.Block, 0]);
  } catch (e) {
    fehler = String(e);
  }
  check('a caller without the block parameter: no crash on `Block=false`', fehler === '', fehler);
}

// ── [3] the whole chain ───────────────────────────────────────────────────
console.log('\n[3] BlockSteuerung -> sendBlock -> bytes');
{
  const { socket, gesendet } = neuerSocket();
  const block = new BlockSteuerung((an) => socket.sendBlock(an));
  const frei: BlockUmfeld = { rechtsGedrueckt: true, rechtsFlanke: true, zeigerGefangen: true, fensterOffen: false, dekorPlatzieren: false, baumodus: false, bauteilGewaehlt: false, bauwerkzeug: false, gegenstandInHand: true, tot: false, imWasser: false };
  block.aktualisiere(frei);
  for (let i = 0; i < 50; i++) block.aktualisiere({ ...frei, rechtsFlanke: false });
  block.aktualisiere({ ...frei, rechtsFlanke: false, rechtsGedrueckt: false });
  check('press, hold 50 frames, release: exactly [89,1] then [89,0] on the wire', gesendet.length === 2 && gesendet[0]!.join() === '89,1' && gesendet[1]!.join() === '89,0', JSON.stringify(gesendet));
  // The server refuses the start: it answers Block=false; the button is still down.
  const { socket: s2, gesendet: g2 } = neuerSocket();
  const b2 = new BlockSteuerung((an) => s2.sendBlock(an));
  verdrahteKampf(s2, {} as never, () => null, { kampfEffekte: { treffer: () => undefined }, kampfToene: { treffer: () => undefined } }, undefined, b2);
  b2.aktualisiere(frei);
  hereinkommen(s2, [PacketType.Block, 0]);
  for (let i = 0; i < 30; i++) b2.aktualisiere({ ...frei, rechtsFlanke: false });
  check('the server refuses the start (Block=false): the client stops, sends nothing back and does not retry while the button stays down', !b2.blockt && g2.length === 1 && g2[0]!.join() === '89,1', JSON.stringify(g2));
}

// ── [4] the messages ──────────────────────────────────────────────────────
console.log('\n[4] The HUD messages');
{
  const de = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>;
  const en = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/en.json'), 'utf-8')) as Record<string, string>;
  for (const text of [SERVER_MELDUNG_GEBLOCKT, SERVER_MELDUNG_PARIERT, SERVER_MELDUNG_ZU_ERSCHOEPFT]) {
    const z = zerlegeServerMeldung(text);
    const k = z?.schluessel ?? '';
    check(`${text}: a catalogue key with a text in de and en (not the key itself)`, !!z && !!de[k] && !!en[k] && de[k] !== k && en[k] !== k && de[k] !== en[k], `${de[k]} / ${en[k]}`);
  }
  check('the three texts', de['kampf.geblockt'] === 'Geblockt' && de['kampf.pariert'] === 'Pariert' && de['kampf.zu_erschoepft'] === 'Zu erschöpft' && en['kampf.geblockt'] === 'Blocked' && en['kampf.pariert'] === 'Parried' && en['kampf.zu_erschoepft'] === 'Too exhausted');
}

// ── [5] the wiring in main.ts, on the syntax tree ─────────────────────────
console.log('\n[5] main.ts is wired to it');
{
  const pfad = resolve(HIER, '../src/main.ts');
  const quelle = readFileSync(pfad, 'utf-8');
  const sf = ts.createSourceFile(pfad, quelle, ts.ScriptTarget.Latest, true);
  const aufrufe: ts.CallExpression[] = [];
  const neuAusdruecke: ts.NewExpression[] = [];
  const zuweisungen: ts.PropertyAssignment[] = [];
  (function lauf(n: ts.Node): void {
    if (ts.isCallExpression(n)) aufrufe.push(n);
    if (ts.isNewExpression(n)) neuAusdruecke.push(n);
    if (ts.isPropertyAssignment(n)) zuweisungen.push(n);
    ts.forEachChild(n, lauf);
  })(sf);
  const text = (n: ts.Node): string => n.getText(sf);
  const aufruf = (ziel: string): ts.CallExpression[] => aufrufe.filter((c) => text(c.expression) === ziel);

  const neu = neuAusdruecke.filter((n) => text(n.expression) === 'BlockSteuerung');
  check('one `new BlockSteuerung(...)`, whose callback is `sendBlock` on the socket', neu.length === 1 && /sendBlock\(an\)/.test(text(neu[0]!.arguments![0]!)), neu.map(text).join('|'));

  const akt = aufruf('block.aktualisiere');
  check('`block.aktualisiere` is called once per frame (one call site)', akt.length === 1);
  const erwartet = ['rechtsGedrueckt', 'rechtsFlanke', 'zeigerGefangen', 'fensterOffen', 'dekorPlatzieren', 'baumodus', 'bauteilGewaehlt', 'bauwerkzeug', 'gegenstandInHand', 'tot', 'imWasser'];
  const arg = akt[0]?.arguments[0];
  const felder = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.filter(ts.isPropertyAssignment).map((p) => ({ name: text(p.name), wert: text(p.initializer) })) : [];
  check('… with exactly the eleven fields of `BlockUmfeld`', felder.map((f) => f.name).sort().join() === [...erwartet].sort().join(), felder.map((f) => f.name).join());
  const wert = (n: string): string => felder.find((f) => f.name === n)?.wert ?? '';
  check('rechtsGedrueckt = input.isMouseDown(2), rechtsFlanke = input.wasMousePressed(2)', wert('rechtsGedrueckt') === 'input.isMouseDown(2)' && wert('rechtsFlanke') === 'input.wasMousePressed(2)', `${wert('rechtsGedrueckt')} / ${wert('rechtsFlanke')}`);
  check('zeigerGefangen = the pointer lock element, fensterOffen = cursorNoetig()', /document\.pointerLockElement/.test(wert('zeigerGefangen')) && wert('fensterOffen') === 'cursorNoetig()', `${wert('zeigerGefangen')} / ${wert('fensterOffen')}`);
  check('dekorPlatzieren = dekoPlatzierung.aktiv, baumodus = player.bauModus', wert('dekorPlatzieren') === 'dekoPlatzierung.aktiv' && wert('baumodus') === 'player.bauModus');
  check('bauteilGewaehlt from the chosen piece, bauwerkzeug from `equipment.pieceTable`, gegenstandInHand from `equipment.rightItem`', /placement\?\.selectedPiece/.test(wert('bauteilGewaehlt')) && /equipment\?\.pieceTable/.test(wert('bauwerkzeug')) && /equipment\?\.rightItem/.test(wert('gegenstandInHand')), `${wert('bauteilGewaehlt')} / ${wert('bauwerkzeug')} / ${wert('gegenstandInHand')}`);
  check('tot = the figure lies (avatar.liegt), imWasser = below WATER_LEVEL', /avatar\.liegt/.test(wert('tot')) && /WATER_LEVEL/.test(wert('imWasser')) && /position\.y/.test(wert('imWasser')), `${wert('tot')} / ${wert('imWasser')}`);
  const setze = aufruf('player.setzeBlock');
  check('the controller gets the state once per frame: `player.setzeBlock(block.blockt)`', setze.length === 1 && text(setze[0]!.arguments[0]!) === 'block.blockt');
  check('an own swing ends the block: `block.schlag()` is called', aufruf('block.schlag').length === 1);
  const blur = aufruf('window.addEventListener').filter((c) => text(c.arguments[0]!) === "'blur'" && /block\.blur\(\)/.test(text(c.arguments[1]!)));
  check('blur ends the block: a `blur` listener calls `block.blur()`', blur.length === 1);
  const kampf = aufruf('verdrahteKampf');
  check('`verdrahteKampf` gets the block as its last argument (the server hook)', kampf.length === 1 && kampf[0]!.arguments.length === 6 && text(kampf[0]!.arguments[5]!) === 'block', kampf.map((c) => c.arguments.map(text).join(' | ')).join());
  check('the old right click is gone: no `starteAktion(\'parade\')` and no `wasMousePressed(2)` outside the one in the block state', aufruf('player.avatar.starteAktion').length === 0 && aufruf('input.wasMousePressed').filter((c) => text(c.arguments[0]!) === '2').length === 1);
  const zelle = zuweisungen.find((p) => text(p.name) === 'blocke');
  check('the measuring cell is `blocke(an)` and calls `block.erzwinge(an)` (the old `pariere` is gone)', !!zelle && /block\.erzwinge\(an\)/.test(text(zelle.initializer)) && !zuweisungen.some((p) => text(p.name) === 'pariere'));
}

if (failures) {
  console.error(`\n${failures} FAIL`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
process.exit(0);
