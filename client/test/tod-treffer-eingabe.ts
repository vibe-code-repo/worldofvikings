/**
 * The client side of the death: the input lock and the packet wiring (TodTreffer, InputManager, main.ts).
 *
 *  [1] InputManager.gesperrt: game keys and mouse buttons read as not pressed (walk, jump, swing, parry,
 *      interact), the menu keys and the camera keep working; released again when the flag falls.
 *  [2] TodTreffer: PlayerTod locks the input and lays the figure down with the clip the server named, a hit while
 *      lying is ignored, the respawn teleport (or the safety timer) releases everything; unknown indices never guess.
 *  [3] The three packets are hooked up to the right handlers, the reader is only read as far as the packet goes.
 *  [4] main.ts wires it in exactly once and stays under its line budget (3700).
 *
 * Run: npx tsx client/test/tod-treffer-eingabe.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacketType } from '@wov/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── a minimal browser for InputManager (it only registers listeners) ──
type Handler = (e: Record<string, unknown>) => void;
const fenster = new Map<string, Handler>();
const dokument = new Map<string, Handler>();
const g = globalThis as Record<string, unknown>;
g.window = { addEventListener: (t: string, f: Handler) => fenster.set(t, f), setTimeout, clearTimeout };
g.document = { addEventListener: (t: string, f: Handler) => dokument.set(t, f), pointerLockElement: null };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test' }, configurable: true });
const leinwand = { addEventListener: () => undefined, requestPointerLock: () => undefined };

async function main(): Promise<void> {
  const { InputManager } = await import('../src/engine/InputManager.js');
  const { TodTreffer } = await import('../src/player/TodTreffer.js');

  console.log('\n[1] InputManager.gesperrt');
  {
    const input = new InputManager(leinwand as unknown as HTMLCanvasElement);
    input.pointerLocked = true;
    const taste = (code: string): void => fenster.get('keydown')!({ code, repeat: false, preventDefault: () => undefined });
    const maus = (button: number): void => dokument.get('mousedown')!({ button, target: leinwand });
    taste('KeyW'); taste('Space'); taste('KeyE'); taste('Escape'); maus(0); maus(2);
    check('free: W, Space, E, Escape and both mouse buttons read as pressed', ['KeyW', 'Space', 'KeyE', 'Escape'].every((c) => input.isDown(c) && input.wasPressed(c)) && input.isMouseDown(0) && input.wasMousePressed(0) && input.wasMousePressed(2));
    input.gesperrt = true;
    check('locked: walk, jump, interact read as not pressed (level and edge)', ['KeyW', 'Space', 'KeyE'].every((c) => !input.isDown(c) && !input.wasPressed(c)));
    check('locked: the swing (left) and the parry (right) read as not pressed', !input.isMouseDown(0) && !input.wasMousePressed(0) && !input.wasMousePressed(2));
    check('locked: Escape still works (menu)', input.isDown('Escape') && input.wasPressed('Escape'));
    const [dx] = input.consumeMouseDelta();
    check('locked: the camera delta is still delivered (the view can turn)', typeof dx === 'number');
    input.gesperrt = false;
    check('released: everything reads as pressed again (the keys were still held)', input.isDown('KeyW') && input.wasMousePressed(0));
  }

  console.log('\n[2] TodTreffer');
  {
    const aufrufe: string[] = [];
    const figur = {
      starteTod: (n: string) => { aufrufe.push(`tod:${n}`); return true; },
      endeTod: () => { aufrufe.push('ende'); },
      zeigeTreffer: (n: string) => { aufrufe.push(`treffer:${n}`); return true; },
    };
    const eingabe = { gesperrt: false };
    const t = new TodTreffer(eingabe, () => figur, 80);
    t.beiTreffer(2);
    check('a hit maps its index to the clip (2 = treffer_hinten_links)', aufrufe.join() === 'treffer:treffer_hinten_links');
    t.beiTreffer(9); t.beiTreffer(-1);
    check('an unknown hit index plays nothing', aufrufe.length === 1);
    t.beiTod(1, 5000);
    check('death: input locked, the figure lies down with tod_hinten (index 1)', eingabe.gesperrt && t.liegt && aufrufe[1] === 'tod:tod_hinten', aufrufe.join());
    t.beiTreffer(0);
    check('a hit while lying is ignored', aufrufe.length === 2);
    t.belebt();
    check('revival: input free, the figure gets up', !eingabe.gesperrt && !t.liegt && aufrufe[2] === 'ende');
    t.belebt();
    check('a second revival changes nothing', aufrufe.length === 3);
    t.beiTod(7, 5000);
    check('an unknown death index shows the forward fall (the card: without direction tod_vorn)', aufrufe[3] === 'tod:tod_vorn');
    t.belebt();
    // safety timer: lying time 40 ms + reserve 80 ms
    t.beiTod(0, 40);
    check('locked again', eingabe.gesperrt);
    await warte(60);
    check('inside the lying time + reserve: still locked', eingabe.gesperrt);
    await warte(120);
    check('after lying time + reserve the client lets go on its own (no server answer must not lock the player for good)', !eingabe.gesperrt && !t.liegt);
    const ohneFigur = new TodTreffer(eingabe, () => null);
    ohneFigur.beiTod(0, 5000);
    check('no figure yet (model still loading): the input is locked all the same', eingabe.gesperrt);
    ohneFigur.belebt();
    check('... and released again', !eingabe.gesperrt);
  }

  console.log('\n[3] The packets');
  {
    const handler = new Map<PacketType, (r: { readInt32(): number; readonly remaining: number }) => void>();
    const socket = { on: (t: PacketType, h: (r: { readInt32(): number; readonly remaining: number }) => void) => handler.set(t, h) };
    const eingabe = { gesperrt: false };
    const aufrufe: string[] = [];
    const t = new TodTreffer(eingabe, () => ({ starteTod: (n) => { aufrufe.push(`tod:${n}`); return true; }, endeTod: () => { aufrufe.push('ende'); }, zeigeTreffer: (n) => { aufrufe.push(`treffer:${n}`); return true; } }), 10_000);
    t.verdrahte(socket);
    check('PlayerTod, PlayerTreffer and Teleport are hooked up', handler.has(PacketType.PlayerTod) && handler.has(PacketType.PlayerTreffer) && handler.has(PacketType.Teleport));
    const leser = (werte: number[]) => { let i = 0; return { readInt32: () => werte[i++]!, get remaining() { return (werte.length - i) * 4; } }; };
    handler.get(PacketType.PlayerTod)!(leser([0, 5000]));
    check('PlayerTod (clip 0, 5000 ms) -> tod_vorn, locked', aufrufe[0] === 'tod:tod_vorn' && eingabe.gesperrt);
    handler.get(PacketType.Teleport)!(leser([]));
    check('the respawn Teleport releases the lock', !eingabe.gesperrt && aufrufe[1] === 'ende');
    handler.get(PacketType.PlayerTod)!(leser([1]));
    check('a PlayerTod without the lying time field (older server) still works', aufrufe[2] === 'tod:tod_hinten' && eingabe.gesperrt);
    handler.get(PacketType.Teleport)!(leser([]));
    handler.get(PacketType.PlayerTreffer)!(leser([3]));
    check('PlayerTreffer 3 -> treffer_hinten_rechts', aufrufe[aufrufe.length - 1] === 'treffer:treffer_hinten_rechts');
    handler.get(PacketType.Teleport)!(leser([]));
    check('a Teleport while alive (dungeon, portal) changes nothing', aufrufe.filter((a) => a === 'ende').length === 2 && !eingabe.gesperrt);
  }

  console.log('\n[4] main.ts');
  {
    const q = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8');
    const zeilen = q.split('\n').length;
    check('main.ts wires TodTreffer exactly once', (q.match(/new TodTreffer\(input, \(\) => player\?\.avatar \?\? null\)\.verdrahte\(socket\)/g) ?? []).length === 1);
    check(`main.ts stays under its line budget (< 3700 lines)`, zeilen < 3700, `${zeilen} lines`);
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
