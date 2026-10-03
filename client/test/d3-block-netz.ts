/**
 * D3-K3: the block on the wire and in the wiring (no browser, no server).
 *
 *  [1] `GameSocket.sendBlock`: packet 89 with one Bool; the old `sendParry` is gone, and the client sends no `Parry` any more.
 *  [2] `BlockVerdrahtung.verdrahte`: `Block=false` from the server ends the client's block; `Block=true` does not.
 *  [3] The whole chain on the wire: mouse state -> `BlockVerdrahtung.frame` -> `sendBlock` -> bytes: press = [89,1], release =
 *      [89,0], one per change; a refused start (the server answers Block=false) does not retry while the button stays down.
 *  [4] The HUD messages the server sends (`@kampf.geblockt`, `@kampf.pariert`, `@kampf.zu_erschoepft`) are catalogue keys
 *      in de and en, and read as such.
 *  [5] `BlockVerdrahtung.frame` reads the eleven fields of the moment from the right sources (table: one source at a time),
 *      tells the figure the state every frame, survives a missing figure; `blur` ends the block.
 *  [6] `main.ts` is wired to it, checked on the syntax tree (not on text): the right click no longer parries, one
 *      `BlockVerdrahtung` with the nine sources, `frame()` once per frame, an own swing ends the block, the server hook,
 *      the measuring cell switches the block, and the line budget of main.ts holds.
 *
 * Run: npx tsx client/test/d3-block-netz.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PacketType, WATER_LEVEL, zerlegeServerMeldung } from '@wov/shared';
import { SERVER_MELDUNG_GEBLOCKT, SERVER_MELDUNG_PARIERT, SERVER_MELDUNG_ZU_ERSCHOEPFT } from '@wov/shared/src/kampf/block.js';
import { GameSocket } from '../src/net/GameSocket.js';
import { BlockVerdrahtung, type BlockQuellen } from '../src/player/BlockVerdrahtung.js';

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
  check('`sendBlock` says the packet went out (true)', socket.sendBlock(true) === true && gesendet.length === 3);
  const zu = new GameSocket('ws://test.invalid', 'Test');
  const dicht: number[][] = [];
  (zu as unknown as { ws: unknown }).ws = { readyState: WebSocket.CLOSED, send: (b: ArrayBuffer) => dicht.push([...new Uint8Array(b)]) };
  check('line closed: `sendBlock` returns false and sends nothing', zu.sendBlock(true) === false && dicht.length === 0);
  const ohne = new GameSocket('ws://test.invalid', 'Test');
  check('no line at all: `sendBlock` returns false', ohne.sendBlock(false) === false);
  const quelle = readFileSync(resolve(HIER, '../src/net/GameSocket.ts'), 'utf-8');
  check('and no client code sends `PacketType.Parry` any more', !/PacketType\.Parry/.test(quelle) && !/sendParry/.test(readFileSync(resolve(HIER, '../src/main.ts'), 'utf-8')));
}

// A game the test drives by hand: mouse, pointer lock, windows, hand, figure.
interface Spiel {
  rechts: boolean; flanke: boolean; gefangen: boolean; fenster: boolean; dekor: boolean; bauModus: boolean; teil: boolean;
  werkzeug: string | null; hand: boolean; liegt: boolean; y: number; spieler: boolean; setzeBlockAufrufe: boolean[];
  blur: Array<() => void>; gesendet: boolean[]; ausdauer: number; abgezogen: number[]; meldungen: string[];
}
function neuesSpiel(): { v: BlockVerdrahtung; spiel: Spiel } {
  const spiel: Spiel = { rechts: false, flanke: false, gefangen: true, fenster: false, dekor: false, bauModus: false, teil: false, werkzeug: null, hand: true, liegt: false, y: 50, spieler: true, setzeBlockAufrufe: [], blur: [], gesendet: [], ausdauer: 100, abgezogen: [], meldungen: [] };
  const q: BlockQuellen = {
    sendBlock: (an) => { spiel.gesendet.push(an); },
    input: { isMouseDown: (b) => b === 2 && spiel.rechts, wasMousePressed: (b) => b === 2 && spiel.flanke },
    player: () => (spiel.spieler ? { setzeBlock: (an) => { spiel.setzeBlockAufrufe.push(an); }, get ausdauerStand() { return spiel.ausdauer; }, zieheAusdauerAb: (n) => { spiel.abgezogen.push(n); spiel.ausdauer = Math.max(0, spiel.ausdauer - n); }, get bauModus() { return spiel.bauModus; }, get position() { return { y: spiel.y }; }, get avatar() { return { liegt: spiel.liegt }; } } : null),
    equipment: () => ({ rightItem: spiel.hand ? {} : null, pieceTable: spiel.werkzeug }),
    placement: () => ({ selectedPiece: spiel.teil ? {} : undefined }),
    fensterOffen: () => spiel.fenster,
    dekorAktiv: () => spiel.dekor,
    meldung: (t) => { spiel.meldungen.push(t); },
    zeigerGefangen: () => spiel.gefangen,
    fenster: { addEventListener: (_art, f) => spiel.blur.push(f) },
  };
  return { v: new BlockVerdrahtung(q), spiel };
}
const druecke = (v: BlockVerdrahtung, spiel: Spiel): void => { spiel.rechts = true; spiel.flanke = true; v.frame(); spiel.flanke = false; };
const loslassen = (v: BlockVerdrahtung, spiel: Spiel): void => { spiel.rechts = false; v.frame(); };

// ── [2] Block=false from the server ───────────────────────────────────────
console.log('\n[2] The server ends the block');
{
  const { v, spiel } = neuesSpiel();
  const { socket } = neuerSocket();
  v.verdrahte(socket);
  druecke(v, spiel);
  check('(set-up) blocking', v.blockt && spiel.gesendet.join() === 'true');
  hereinkommen(socket, [PacketType.Block, 1]);
  check('`Block=true` from the server does nothing', v.blockt);
  hereinkommen(socket, [PacketType.Block, 0]);
  check('`Block=false` from the server ends the block', !v.blockt);
  check('… and sends nothing back (the server knows)', spiel.gesendet.join() === 'true');
  hereinkommen(socket, [PacketType.Block, 0]);
  check('a second `Block=false` without a block is harmless', !v.blockt && spiel.gesendet.join() === 'true');
  v.frame();
  v.frame();
  check('the button is still down: no restart and nothing sent', !v.blockt && spiel.gesendet.join() === 'true');
  // A teleport (world change, dungeon, respawn) resets the block and tells the server so, once.
  druecke(v, spiel);
  loslassen(v, spiel);
  druecke(v, spiel);
  hereinkommen(socket, [PacketType.Teleport]);
  check('a Teleport packet resets the block at the client', !v.blockt);
  const vorher = spiel.gesendet.length;
  v.frame();
  check('… and the next frame sends `Block(false)` once, button still held', spiel.gesendet.length === vorher + 1 && spiel.gesendet[vorher] === false, spiel.gesendet.join());
  v.frame();
  check('… not again, and no restart without a fresh press', spiel.gesendet.length === vorher + 1 && !v.blockt);
  check('the figure was told "off" at the next frame', spiel.setzeBlockAufrufe[spiel.setzeBlockAufrufe.length - 1] === false);
  loslassen(v, spiel);
  druecke(v, spiel);
  check('after the teleport reset a fresh press blocks again (…, false, true)', v.blockt && spiel.gesendet.slice(-2).join() === 'false,true', spiel.gesendet.join());
}

// ── [3] the whole chain ───────────────────────────────────────────────────
console.log('\n[3] mouse -> frame -> sendBlock -> bytes');
{
  const { socket, gesendet } = neuerSocket();
  const spiel = neuesSpiel().spiel;
  // the real socket instead of the recorder of the stand-in game
  const v2 = new BlockVerdrahtung({
    sendBlock: (an) => socket.sendBlock(an),
    input: { isMouseDown: () => spiel.rechts, wasMousePressed: () => spiel.flanke },
    player: () => ({ setzeBlock: () => undefined, bauModus: false, position: { y: 50 }, avatar: { liegt: false }, ausdauerStand: 100, zieheAusdauerAb: () => undefined }),
    equipment: () => ({ rightItem: {}, pieceTable: null }),
    placement: () => null,
    fensterOffen: () => false,
    dekorAktiv: () => false, meldung: () => undefined,
    zeigerGefangen: () => true,
    fenster: { addEventListener: () => undefined },
  });
  druecke(v2, spiel);
  for (let i = 0; i < 50; i++) v2.frame();
  loslassen(v2, spiel);
  check('press, hold 50 frames, release: exactly [89,1] then [89,0] on the wire', gesendet.length === 2 && gesendet[0]!.join() === '89,1' && gesendet[1]!.join() === '89,0', JSON.stringify(gesendet));
  // The server refuses the start: it answers Block=false; the button is still down.
  const { socket: s2, gesendet: g2 } = neuerSocket();
  const spiel2 = neuesSpiel().spiel;
  const v3 = new BlockVerdrahtung({
    sendBlock: (an) => s2.sendBlock(an),
    input: { isMouseDown: () => spiel2.rechts, wasMousePressed: () => spiel2.flanke },
    player: () => ({ setzeBlock: () => undefined, bauModus: false, position: { y: 50 }, avatar: { liegt: false }, ausdauerStand: 100, zieheAusdauerAb: () => undefined }),
    equipment: () => ({ rightItem: {}, pieceTable: null }),
    placement: () => null,
    fensterOffen: () => false,
    dekorAktiv: () => false, meldung: () => undefined,
    zeigerGefangen: () => true,
    fenster: { addEventListener: () => undefined },
  });
  v3.verdrahte(s2);
  druecke(v3, spiel2);
  hereinkommen(s2, [PacketType.Block, 0]);
  for (let i = 0; i < 30; i++) v3.frame();
  check('the server refuses the start (Block=false): the client stops, sends nothing back and does not retry while the button stays down', !v3.blockt && g2.length === 1 && g2[0]!.join() === '89,1', JSON.stringify(g2));
}

// A closed line: the block must not start (the client would walk at half speed and the server not know it).
{
  const zu = new GameSocket('ws://test.invalid', 'Test');
  (zu as unknown as { ws: unknown }).ws = { readyState: WebSocket.CLOSED, send: () => undefined };
  const spiel = neuesSpiel().spiel;
  const v = new BlockVerdrahtung({
    sendBlock: (an) => zu.sendBlock(an), input: { isMouseDown: () => spiel.rechts, wasMousePressed: () => spiel.flanke },
    player: () => ({ setzeBlock: () => undefined, bauModus: false, position: { y: 50 }, avatar: { liegt: false }, ausdauerStand: 100, zieheAusdauerAb: () => undefined }),
    equipment: () => ({ rightItem: {}, pieceTable: null }), placement: () => null, fensterOffen: () => false, dekorAktiv: () => false, meldung: () => undefined, zeigerGefangen: () => true,
    fenster: { addEventListener: () => undefined },
  });
  druecke(v, spiel);
  check('closed line: pressing does not start a block', !v.blockt);
}
// A new connection starts clean: `verdrahte` resets, a block of the old connection is gone.
{
  const { v, spiel } = neuesSpiel();
  druecke(v, spiel);
  const { socket: neuer } = neuerSocket();
  v.verdrahte(neuer);
  hereinkommen(neuer, [PacketType.Teleport]);
  check('(teleport on a fresh socket) the block of the old connection is reset', !v.blockt);
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

// ── [5] BlockVerdrahtung.frame: the eleven fields, from the right sources ───────
console.log('\n[5] frame(): every source reaches the table');
{
  const faelle: Array<[string, (s: Spiel) => void]> = [
    ['dead (avatar.liegt)', (s) => { s.liegt = true; }],
    ['build mode (player.bauModus)', (s) => { s.bauModus = true; }],
    ['pointer not captured', (s) => { s.gefangen = false; }],
    ['window open (fensterOffen)', (s) => { s.fenster = true; }],
    ['decor placing (dekorAktiv)', (s) => { s.dekor = true; }],
    ['building piece chosen (placement.selectedPiece)', (s) => { s.teil = true; }],
    ['bare hands (equipment.rightItem null)', (s) => { s.hand = false; }],
    ['building tool in the hand (equipment.pieceTable)', (s) => { s.werkzeug = 'Hammer'; }],
    ['in the water (player.position.y below WATER_LEVEL)', (s) => { s.y = WATER_LEVEL - 0.1; }],
  ];
  const { v: frei, spiel: sf } = neuesSpiel();
  druecke(frei, sf);
  check('baseline: sword in the hand, captured, nothing open: blocks, sends true, tells the figure "on"', frei.blockt && sf.gesendet.join() === 'true' && sf.setzeBlockAufrufe.join() === 'true');
  check('the figure is told the state again every frame', (() => { frei.frame(); frei.frame(); return sf.setzeBlockAufrufe.join() === 'true,true,true'; })());
  for (const [name, stoere] of faelle) {
    const { v, spiel } = neuesSpiel();
    stoere(spiel);
    druecke(v, spiel);
    check(`${name}: no block, nothing sent, the figure told "off"`, !v.blockt && spiel.gesendet.length === 0 && spiel.setzeBlockAufrufe.join() === 'false', `${v.blockt} ${spiel.gesendet.join()}`);
    // and the same source ends a block that is being held
    const { v: v2, spiel: sp2 } = neuesSpiel();
    druecke(v2, sp2);
    stoere(sp2);
    v2.frame();
    check(`${name}: ends a held block (false sent once, the figure told "off")`, !v2.blockt && sp2.gesendet.join() === 'true,false' && sp2.setzeBlockAufrufe[sp2.setzeBlockAufrufe.length - 1] === false, sp2.gesendet.join());
  }
  check('the water edge: exactly at WATER_LEVEL the figure is NOT in the water', (() => { const { v, spiel } = neuesSpiel(); spiel.y = WATER_LEVEL; druecke(v, spiel); return v.blockt; })());
  // The default pointer lock source is the document's: without an injected getter `frame()` reads `document.pointerLockElement`.
  {
    const dokument = { pointerLockElement: null as unknown };
    (globalThis as unknown as { document: unknown }).document = dokument;
    const spiel = neuesSpiel().spiel;
    const v = new BlockVerdrahtung({
      sendBlock: (an) => { spiel.gesendet.push(an); }, input: { isMouseDown: () => true, wasMousePressed: () => true },
      player: () => ({ setzeBlock: () => undefined, bauModus: false, position: { y: 50 }, avatar: { liegt: false }, ausdauerStand: 100, zieheAusdauerAb: () => undefined }),
      equipment: () => ({ rightItem: {}, pieceTable: null }), placement: () => null, fensterOffen: () => false, dekorAktiv: () => false, meldung: () => undefined, fenster: { addEventListener: () => undefined },
    });
    v.frame();
    check('default source: no pointer lock element on the document -> no block', !v.blockt && spiel.gesendet.length === 0);
    dokument.pointerLockElement = {};
    v.frame();
    check('default source: a pointer lock element on the document -> block', v.blockt && spiel.gesendet.join() === 'true');
    delete (globalThis as unknown as { document?: unknown }).document;
  }
  const { v: ohne, spiel: so } = neuesSpiel();
  so.spieler = false;
  let fehler = '';
  try { druecke(ohne, so); } catch (e) { fehler = String(e); }
  check('no figure yet (before the world is up): no crash, no block, nothing sent', fehler === '' && !ohne.blockt && so.gesendet.length === 0, fehler);
  const { v: bl, spiel: sb } = neuesSpiel();
  druecke(bl, sb);
  check('(set-up) blocking, a `blur` handler was registered', bl.blockt && sb.blur.length === 1);
  sb.blur[0]!();
  check('blur ends the block and sends false once', !bl.blockt && sb.gesendet.join() === 'true,false');
  sb.blur[0]!();
  check('a second blur sends nothing more', sb.gesendet.join() === 'true,false');
}

// ── [5b] The begin costs 5 stamina (K1 N5), the client predicts it and shows the server's message ──
console.log('\n[5b] Begin cost and refusal');
{
  const { v, spiel } = neuesSpiel();
  spiel.ausdauer = 100;
  druecke(v, spiel);
  check('a begin with 100 stamina: blocks, the 5 are charged once at the predicted stamina (100 -> 95)', v.blockt && spiel.abgezogen.join() === '5' && spiel.ausdauer === 95, `${spiel.abgezogen.join()} / ${spiel.ausdauer}`);
  for (let i = 0; i < 20; i++) v.frame();
  check('holding costs nothing more at the client (the server bills the holding, PlayerState corrects)', spiel.abgezogen.join() === '5');
  spiel.ausdauer = 1;
  v.frame();
  check('holding goes on with 1 stamina left (the rule is for the BEGIN only)', v.blockt);
}
for (const [ausdauer, soll] of [[5, true], [5.0001, true], [4.9999, false], [4, false], [0, false], [Number.NaN, false]] as Array<[number, boolean]>) {
  const { v, spiel } = neuesSpiel();
  spiel.ausdauer = ausdauer;
  druecke(v, spiel);
  check(`stamina ${ausdauer}: ${soll ? 'blocks, true sent, 5 charged' : 'no block, nothing sent, nothing charged, the message shown once'}`,
    soll ? v.blockt && spiel.gesendet.join() === 'true' && spiel.abgezogen.join() === '5' && spiel.meldungen.length === 0
      : !v.blockt && spiel.gesendet.length === 0 && spiel.abgezogen.length === 0 && spiel.meldungen.join() === '@kampf.zu_erschoepft',
    `${v.blockt} ${spiel.gesendet.join()} ${spiel.abgezogen.join()} ${spiel.meldungen.join()}`);
}
{
  const { v, spiel } = neuesSpiel();
  spiel.ausdauer = 3;
  druecke(v, spiel);
  for (let i = 0; i < 10; i++) v.frame();
  check('refused: the button stays down, stamina climbs back: no block without a fresh press, the message only once', !v.blockt && spiel.meldungen.length === 1 && spiel.gesendet.length === 0);
  spiel.ausdauer = 50;
  loslassen(v, spiel);
  druecke(v, spiel);
  check('a fresh press with enough stamina blocks (and no stale `false` is sent: the refusal sent nothing)', v.blockt && spiel.gesendet.join() === 'true' && spiel.abgezogen.join() === '5');
  const text = JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>;
  check('the message is the catalogue key the server sends (de: "Zu erschöpft")', text[zerlegeServerMeldung('@kampf.zu_erschoepft')!.schluessel] === 'Zu erschöpft');
}
{
  // blocked by another row (window open): that row decides, no message about stamina.
  const { v, spiel } = neuesSpiel();
  spiel.ausdauer = 0;
  spiel.fenster = true;
  druecke(v, spiel);
  check('another row forbids first: no stamina message', !v.blockt && spiel.meldungen.length === 0);
}

// ── [6] the wiring in main.ts, on the syntax tree ─────────────────────────
console.log('\n[6] main.ts is wired to it');
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

  const neu = neuAusdruecke.filter((n) => text(n.expression) === 'BlockVerdrahtung');
  check('one `new BlockVerdrahtung(...)` (the one place the block is created)', neu.length === 1 && !neuAusdruecke.some((n) => text(n.expression) === 'BlockSteuerung'));
  const arg = neu[0]?.arguments?.[0];
  const felder = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? [{ name: text(p.name), wert: text(p.initializer) }] : ts.isShorthandPropertyAssignment(p) ? [{ name: text(p.name), wert: text(p.name) }] : [])) : [];
  const wert = (n: string): string => felder.find((f) => f.name === n)?.wert ?? '';
  check('… with exactly the nine sources of `BlockQuellen` (the eight of K3 and `sendRolle` of K4)', felder.map((f) => f.name).sort().join() === ['dekorAktiv', 'equipment', 'fensterOffen', 'input', 'meldung', 'placement', 'player', 'sendBlock', 'sendRolle'].join(), felder.map((f) => f.name).join());
  check('sendBlock goes to the socket, and a missing socket counts as "not sent": `socket?.sendBlock(an) ?? false`', wert('sendBlock') === '(an) => socket?.sendBlock(an) ?? false', wert('sendBlock'));
  check('input is the game\'s input; player, equipment, placement are the live objects (getters, so the late `let`s work)', wert('input') === 'input' && wert('player') === '() => player' && wert('equipment') === '() => equipment' && wert('placement') === '() => placement', `${wert('input')} | ${wert('player')} | ${wert('equipment')} | ${wert('placement')}`);
  check('meldung shows the catalogue text: `hud.meldung(i18n.serverMeldung(t))`', wert('meldung') === '(t) => hud.meldung(i18n.serverMeldung(t))', wert('meldung'));
  check('fensterOffen is `cursorNoetig()`, dekorAktiv is `dekoPlatzierung.aktiv`', wert('fensterOffen') === '() => cursorNoetig()' && wert('dekorAktiv') === '() => dekoPlatzierung.aktiv', `${wert('fensterOffen')} | ${wert('dekorAktiv')}`);
  const frame = aufruf('block.frame');
  check('`block.frame()` is called once, per frame (the one place of the old right click)', frame.length === 1);
  check('the server hook: `block.verdrahte(socket)` once, next to `verdrahteKampf`', aufruf('block.verdrahte').length === 1 && text(aufruf('block.verdrahte')[0]!.arguments[0]!) === 'socket');
  check('an own swing ends the block: `block.schlag()` is called once', aufruf('block.schlag').length === 1);
  check('the old right click is gone: no `starteAktion` of the parade and no `wasMousePressed(2)` in main.ts', aufruf('player.avatar.starteAktion').length === 0 && aufruf('input.wasMousePressed').filter((c) => text(c.arguments[0]!) === '2').length === 0);
  const zelle = zuweisungen.find((p) => text(p.name) === 'blocke');
  check('the measuring cell is `blocke(an)` and calls `block.erzwinge(an)` (the old `pariere` is gone)', !!zelle && /block\.erzwinge\(an\)/.test(text(zelle.initializer)) && !zuweisungen.some((p) => text(p.name) === 'pariere'));
  check('the line budget of main.ts holds (3679 lines at the start of D3-K3: it did not grow)', quelle.split('\n').length <= 3679, `${quelle.split('\n').length} lines`);
}

if (failures) {
  console.error(`\n${failures} FAIL`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
process.exit(0);
