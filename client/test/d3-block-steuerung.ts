/**
 * D3-K3: the client side of the held block, DOM-free (client/src/player/BlockSteuerung.ts).
 *
 *  [1] The conflict table of the right click: every row of `BLOCK_SPERREN` is one case (the one condition set, all
 *      others in order), plus the allowed baseline (sword, axe) and the order of the rows.
 *  [2] Start / hold / end: a fresh press starts, a button that is merely still down (stuck after a lost pointer
 *      lock) does not; release ends; every cause that ends it (blur, pointer lock lost, window open, dead, water,
 *      decor placing, build mode, own swing, server `Block=false`).
 *  [3] Sending: exactly one `sendBlock` per change, never the same value twice in a row, nothing for a server end.
 *  [4] Direction of the walk and the turn: `blockRichtung`, `dreheZu` at 540 deg/s (180 deg in 0.33 s within 1 deg).
 *  [5] The speed of one step is the shared one (2.25 m/s), running does not count.
 *
 * Run: npx tsx client/test/d3-block-steuerung.ts
 */
import {
  BLOCK_SPERREN,
  BLOCK_TURN_SPEED,
  BlockSteuerung,
  blockRichtung,
  blockSchrittTempo,
  blockSperre,
  dreheZu,
  type BlockUmfeld,
} from '../src/player/BlockSteuerung.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const grad = (r: number): number => (r * 180) / Math.PI;

/** A moment in which a block is allowed and the button was just pressed. */
const FREI: BlockUmfeld = {
  rechtsGedrueckt: true,
  rechtsFlanke: true,
  zeigerGefangen: true,
  fensterOffen: false,
  dekorPlatzieren: false,
  baumodus: false,
  bauteilGewaehlt: false,
  bauwerkzeug: false,
  gegenstandInHand: true,
  tot: false,
  imWasser: false,
};
const halten = (u: BlockUmfeld): BlockUmfeld => ({ ...u, rechtsFlanke: false });

function neu(): { b: BlockSteuerung; gesendet: boolean[] } {
  const gesendet: boolean[] = [];
  return { b: new BlockSteuerung((an) => { gesendet.push(an); }), gesendet };
}

// ── [1] conflict table ────────────────────────────────────────────────────
console.log('\n[1] The conflict table of the right click (planner report D3, 2.6)');
{
  check('baseline (item in the hand, pointer captured, nothing open): no row applies', blockSperre(FREI) === null);
  // One row, one case: the single condition that makes exactly this row apply.
  const faelle: Array<{ id: string; stoerung: Partial<BlockUmfeld> }> = [
    { id: 'tot', stoerung: { tot: true } },
    { id: 'baumodus', stoerung: { baumodus: true } },
    { id: 'zeiger-frei', stoerung: { zeigerGefangen: false } },
    { id: 'fenster-offen', stoerung: { fensterOffen: true } },
    { id: 'dekor-platzieren', stoerung: { dekorPlatzieren: true } },
    { id: 'bauteil-gewaehlt', stoerung: { bauteilGewaehlt: true } },
    { id: 'leere-hand', stoerung: { gegenstandInHand: false } },
    { id: 'bauwerkzeug', stoerung: { bauwerkzeug: true } },
    { id: 'wasser', stoerung: { imWasser: true } },
    { id: 'rolle', stoerung: { rollt: true } }, // D3-K4: a roll is running
  ];
  check('the table has exactly these ten rows', BLOCK_SPERREN.map((z) => z.id).join() === faelle.map((f) => f.id).join(), BLOCK_SPERREN.map((z) => z.id).join());
  for (const f of faelle) {
    const u = { ...FREI, ...f.stoerung };
    const { b, gesendet } = neu();
    b.aktualisiere(u);
    check(`row "${f.id}": ${BLOCK_SPERREN.find((z) => z.id === f.id)?.grund}: no block, nothing sent`, blockSperre(u) === f.id && !b.blockt && gesendet.length === 0, `sperre=${blockSperre(u)}`);
  }
  // The first applying row wins (order = rank).
  check('two rows at once: the first one in the table is named (dead beats water)', blockSperre({ ...FREI, tot: true, imWasser: true }) === 'tot');
  check('two rows at once: window open beats bare hands', blockSperre({ ...FREI, fensterOffen: true, gegenstandInHand: false }) === 'fenster-offen');
  // Allowed: any item that is no building tool (sword, axe, pickaxe all have no pieceTable).
  const { b: ok1, gesendet: g1 } = neu();
  ok1.aktualisiere({ ...FREI, bauwerkzeug: false });
  check('an item without pieceTable (sword, axe, pickaxe) blocks', ok1.blockt && g1.join() === 'true');
  const { b: ham, gesendet: gh } = neu();
  ham.aktualisiere({ ...FREI, bauwerkzeug: true });
  check('the hammer (pieceTable) blocks nothing, also without a chosen piece', !ham.blockt && gh.length === 0);
}

// ── [2] start / hold / end ────────────────────────────────────────────────
console.log('\n[2] Start, hold and end');
{
  const { b, gesendet } = neu();
  b.aktualisiere(halten(FREI));
  check('the button is down but did not go down this frame (stuck after a lost lock): no block', !b.blockt && gesendet.length === 0);
  b.aktualisiere({ ...FREI, rechtsGedrueckt: false });
  check('an edge without the level (press and release inside one frame): no block', !b.blockt && gesendet.length === 0);
  b.aktualisiere(FREI);
  check('a fresh press starts the block and sends true', b.blockt && gesendet.join() === 'true');
  for (let i = 0; i < 100; i++) b.aktualisiere(halten(FREI));
  check('held for 100 frames: still blocking, nothing more sent', b.blockt && gesendet.join() === 'true');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('release ends the block and sends false', !b.blockt && gesendet.join() === 'true,false');
  for (let i = 0; i < 5; i++) b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('frames after the release send nothing', gesendet.join() === 'true,false');
}
{
  // Every cause that ends a block that is being held.
  const ursachen: Array<{ name: string; wirkt: (b: BlockSteuerung) => void }> = [
    { name: 'the pointer lock is lost', wirkt: (b) => b.aktualisiere(halten({ ...FREI, zeigerGefangen: false })) },
    { name: 'a window opens (cursorNoetig)', wirkt: (b) => b.aktualisiere(halten({ ...FREI, fensterOffen: true })) },
    { name: 'the figure dies', wirkt: (b) => b.aktualisiere(halten({ ...FREI, tot: true })) },
    { name: 'the figure enters the water', wirkt: (b) => b.aktualisiere(halten({ ...FREI, imWasser: true })) },
    { name: 'decor placing starts', wirkt: (b) => b.aktualisiere(halten({ ...FREI, dekorPlatzieren: true })) },
    { name: 'build mode starts', wirkt: (b) => b.aktualisiere(halten({ ...FREI, baumodus: true })) },
    { name: 'the item leaves the hand', wirkt: (b) => b.aktualisiere(halten({ ...FREI, gegenstandInHand: false })) },
    { name: 'a building tool is taken', wirkt: (b) => b.aktualisiere(halten({ ...FREI, bauwerkzeug: true })) },
    { name: 'a building piece is chosen', wirkt: (b) => b.aktualisiere(halten({ ...FREI, bauteilGewaehlt: true })) },
    { name: 'blur (the window loses the focus, no mouseup comes)', wirkt: (b) => b.blur() },
    { name: 'an own swing', wirkt: (b) => b.schlag() },
  ];
  for (const u of ursachen) {
    const { b, gesendet } = neu();
    b.aktualisiere(FREI);
    u.wirkt(b);
    check(`${u.name}: the block ends and false is sent once`, !b.blockt && gesendet.join() === 'true,false', gesendet.join());
    // Still held afterwards, conditions back to normal: no restart without a fresh press.
    b.aktualisiere(halten(FREI));
    b.aktualisiere(halten(FREI));
    check(`${u.name}: the button is still down afterwards, no restart without a fresh press`, !b.blockt && gesendet.join() === 'true,false');
    b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
    b.aktualisiere(FREI);
    check(`${u.name}: a fresh press blocks again`, b.blockt && gesendet.join() === 'true,false,true');
  }
}
{
  // The server ends or refuses the block: no answer back, no restart.
  const { b, gesendet } = neu();
  b.aktualisiere(FREI);
  b.serverBeendet();
  check('`Block=false` from the server ends the block', !b.blockt);
  check('… and sends nothing back (the server knows)', gesendet.join() === 'true');
  b.aktualisiere(halten(FREI));
  b.aktualisiere(halten(FREI));
  check('the button is still down: no restart, nothing sent', !b.blockt && gesendet.join() === 'true');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('the release after the server end sends one more `Block(false)` (the server may hold a newer block)', !b.blockt && gesendet.join() === 'true,false');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('… and only one (idempotent, no repeat)', gesendet.join() === 'true,false');
  b.aktualisiere(FREI);
  check('a fresh press after the server end blocks again', b.blockt && gesendet.join() === 'true,false,true');
  const { b: leer } = neu();
  leer.serverBeendet();
  check('`Block=false` without a block is harmless', !leer.blockt);
}

// ── [2b] swing and press in the same frame (F1) ──────────────────────────
console.log('\n[2b] A swing and a press in the same frame');
{
  const { b, gesendet } = neu();
  b.schlag(); // main.ts: the left click branch comes first
  b.aktualisiere(FREI); // ... then the right button went down in the same frame
  check('swing first, press in the same frame: no block starts, nothing sent', !b.blockt && gesendet.length === 0, gesendet.join());
  b.aktualisiere(halten(FREI));
  check('the button is still down next frame: still no block (needs a fresh press)', !b.blockt && gesendet.length === 0);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  check('a fresh press in a later frame blocks', b.blockt && gesendet.join() === 'true');
  const { b: b2, gesendet: g2 } = neu();
  b2.aktualisiere(FREI);
  b2.schlag(); // the other order: block first, then the swing
  check('press first, swing after it in the same frame: [true, false], no block', !b2.blockt && g2.join() === 'true,false');
  b2.aktualisiere(halten(FREI));
  check('… and the held button does not start a new one', !b2.blockt && g2.join() === 'true,false');
  const { b: b3, gesendet: g3 } = neu();
  b3.schlag();
  b3.aktualisiere({ ...FREI, rechtsFlanke: false, rechtsGedrueckt: false });
  b3.aktualisiere(FREI);
  check('a swing blocks only ITS frame: the press one frame later starts a block', b3.blockt && g3.join() === 'true');
}

// ── [2c] uncertain state (F2) ─────────────────────────────────────────────
console.log('\n[2c] When the client no longer knows what the server holds');
{
  // An old `Block=false` meets a fresh press: [true, false, true], then the late message.
  const { b, gesendet } = neu();
  b.aktualisiere(FREI);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  b.serverBeendet(); // the old message arrives
  check('(set-up) the client believes in no block, the server holds the new one: [true,false,true] were sent', !b.blockt && gesendet.join() === 'true,false,true');
  for (let i = 0; i < 20; i++) b.aktualisiere(halten(FREI));
  check('while the button is held nothing is sent', gesendet.join() === 'true,false,true');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('the release sends `Block(false)` although the client believed in no block: the server lets go', gesendet.join() === 'true,false,true,false');
  for (let i = 0; i < 5; i++) b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('and then it stays quiet', gesendet.join() === 'true,false,true,false');
  b.aktualisiere(FREI);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('a normal block afterwards: one true, one false, no extra false', gesendet.join() === 'true,false,true,false,true,false');
}
{
  // Crossing messages (K1-N4 H1): the client sends `Block=true` at the very moment the server reports `Block=false`. The
  // server may have taken the new request after its own end: it holds, the client shows "off".
  const { b, gesendet } = neu();
  b.aktualisiere(FREI); // client: Block(true) goes out
  b.serverBeendet(); // server: Block(false) arrives, treated like "press the key anew"
  check('crossing: the client shows "no block" after the server message', !b.blockt && gesendet.join() === 'true');
  for (let i = 0; i < 30; i++) b.aktualisiere(halten(FREI));
  check('crossing: it does not start again while the button stays down (a fresh press is needed)', !b.blockt && gesendet.join() === 'true');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('crossing: the release sends `Block(false)`, so a server that holds the new block lets go', gesendet.join() === 'true,false');
  b.aktualisiere(FREI);
  check('crossing: a fresh press sends `true` again and blocks', b.blockt && gesendet.join() === 'true,false,true');
}
{
  // The server ended while the button was already up.
  const { b, gesendet } = neu();
  b.aktualisiere(FREI);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.serverBeendet();
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('server end with the button already up: one more false at the next frame, once', gesendet.join() === 'true,false,false', gesendet.join());
}
{
  // A reset (teleport, world change, respawn): at once, button held or not, and no restart without a fresh press.
  const { b, gesendet } = neu();
  b.aktualisiere(FREI);
  b.zuruecksetzen();
  check('reset: the block is gone at once', !b.blockt);
  b.aktualisiere(halten(FREI));
  check('reset with the button held: `Block(false)` is sent at the next frame (the server may still hold)', gesendet.join() === 'true,false', gesendet.join());
  for (let i = 0; i < 5; i++) b.aktualisiere(halten(FREI));
  check('… once, and the held button does not start a block', !b.blockt && gesendet.join() === 'true,false');
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  check('a fresh press after the reset blocks again', b.blockt && gesendet.join() === 'true,false,true');
  b.zuruecksetzen();
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  check('a second reset sends again (it is idempotent at the server)', gesendet.join() === 'true,false,true,false');
}
{
  // The line is down: sendPacket drops the packet and `sende` says so.
  let offen = false;
  const gesendet: boolean[] = [];
  const b = new BlockSteuerung((an) => { if (!offen) return false; gesendet.push(an); return true; });
  b.aktualisiere(FREI);
  check('line down: the start is dropped, the client does not block (it would run at half speed without the server knowing)', !b.blockt && gesendet.length === 0);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  offen = true;
  b.aktualisiere(FREI);
  check('line back and a fresh press: blocks, true sent', b.blockt && gesendet.join() === 'true');
}

// ── [3] sending ───────────────────────────────────────────────────────────
console.log('\n[3] Exactly one sendBlock per change');
{
  const { b, gesendet } = neu();
  // press, hold, release, press, release, press+blur, press again
  b.aktualisiere(FREI);
  b.aktualisiere(halten(FREI));
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  b.blur();
  b.blur();
  b.schlag();
  b.aktualisiere({ ...halten(FREI), rechtsGedrueckt: false });
  b.aktualisiere(FREI);
  check('press/release, press/release, press/blur(+blur,+swing: nothing more), press: true,false,true,false,true,false,true', gesendet.join() === 'true,false,true,false,true,false,true', gesendet.join());
  check('never the same value twice in a row', gesendet.every((v, i) => i === 0 || v !== gesendet[i - 1]));
  // The measuring cell forces the state like the button would.
  const { b: m, gesendet: gm } = neu();
  m.erzwinge(true);
  m.erzwinge(true);
  check('the measuring cell: on twice sends once', m.blockt && gm.join() === 'true');
  m.aktualisiere(halten({ ...FREI, rechtsGedrueckt: false }));
  check('… and holds without the mouse', m.blockt && gm.join() === 'true');
  m.aktualisiere(halten({ ...FREI, rechtsGedrueckt: false, tot: true }));
  check('… but the table still ends it', !m.blockt && gm.join() === 'true,false');
  m.erzwinge(true);
  m.erzwinge(false);
  check('… and `erzwinge(false)` ends it once', !m.blockt && gm.join() === 'true,false,true,false');
}

// ── [4] direction and turn ────────────────────────────────────────────────
console.log('\n[4] Direction of the walk and the turn to the camera');
{
  const tabelle: Array<[number, number, string]> = [
    [0, 0, 'steht'], [0, 1, 'vor'], [1, 1, 'vor'], [-1, 1, 'vor'], [0, -1, 'rueck'], [1, -1, 'rueck'], [-1, -1, 'rueck'], [1, 0, 'seit'], [-1, 0, 'seit'],
  ];
  for (const [x, z, soll] of tabelle) check(`axes (${x}, ${z}) -> ${soll}`, blockRichtung(x, z) === soll, blockRichtung(x, z));
  check('the turn speed is 540 deg/s', Math.abs(grad(BLOCK_TURN_SPEED) - 540) < 1e-9, `${grad(BLOCK_TURN_SPEED)}`);
  for (const dt of [1 / 60, 0.016, 1 / 30]) {
    let yaw = 0;
    const n = Math.round(0.34 / dt);
    for (let i = 0; i < n; i++) yaw = dreheZu(yaw, Math.PI, BLOCK_TURN_SPEED, dt);
    const rest = Math.abs(grad(Math.atan2(Math.sin(Math.PI - yaw), Math.cos(Math.PI - yaw))));
    check(`180 deg after ${(n * dt).toFixed(3)} s (dt ${dt.toFixed(4)}): at most 1 deg off`, rest <= 1, `${rest.toFixed(3)} deg`);
  }
  let halb = 0;
  for (let i = 0; i < 10; i++) halb = dreheZu(halb, Math.PI, BLOCK_TURN_SPEED, 1 / 60);
  check('after 10 frames (0.167 s) it has turned 90 deg and not more (no jump)', Math.abs(grad(halb) - 90) < 1e-6, `${grad(halb).toFixed(3)} deg`);
  check('the short way round: from +170 deg to -170 deg one frame goes UP to 179 deg (20 deg away), not down', Math.abs(grad(dreheZu((170 * Math.PI) / 180, (-170 * Math.PI) / 180, BLOCK_TURN_SPEED, 1 / 60)) - 179) < 1e-6);
  check('it stops on the target and does not overshoot', dreheZu(1, 1.001, BLOCK_TURN_SPEED, 1 / 60) === 1.001);
}

// ── [5] speed ─────────────────────────────────────────────────────────────
console.log('\n[5] The speed of a step while blocking');
{
  check('walking 4.5 m/s, running 7.5 m/s', blockSchrittTempo(false, false) === 4.5 && blockSchrittTempo(true, false) === 7.5);
  check('blocking: half the walking speed, 2.25 m/s', blockSchrittTempo(false, true) === 2.25);
  check('blocking and running: still 2.25 m/s (no running)', blockSchrittTempo(true, true) === 2.25);
}

if (failures) {
  console.error(`\n${failures} FAIL`);
  process.exit(1);
}
console.log('\nAlle Pruefungen bestanden.');
