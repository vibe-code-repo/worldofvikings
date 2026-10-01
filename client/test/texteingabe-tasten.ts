/**
 * Textfeld-Fokus sperrt Spiel- und Testflug-Tasten. DOM-frei: der gemeinsame Helfer mit
 * Nachbauten der Elemente, der echte `InputManager` mit Fenster-Attrappe, die Verdrahtung im Quelltext.
 * A focused text field blocks game and flight keys (K, I, V, B, H, WASD). DOM-free.
 *
 *  1. Helper: text, search, number, textarea, select, contenteditable count; checkbox, range, button do not.
 *  2. InputManager: with a text field focused K, I, V, B, H, WASD set nothing and fire no menu key;
 *     Escape blurs the field; without focus all of it works as before; keyup always releases.
 *  3. Wiring: Testflug and main.ts use the helper, no own InputElement test is left in Testflug.
 *
 * Run: npx tsx test/texteingabe-tasten.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { istTexteingabeAktiv, istTexteingabeElement } from '../src/engine/texteingabe';

let fehler = 0;
function pruefe(ok: boolean, text: string): void {
  if (!ok) {
    fehler++;
    console.error('FAIL', text);
  }
}

// ── 1. Helper ──
const el = (tagName: string, type?: string, isContentEditable = false) => ({ tagName, type, isContentEditable });
for (const t of ['text', 'search', 'number', 'password', 'email', 'url', 'tel']) {
  pruefe(istTexteingabeElement(el('INPUT', t)), `1: input ${t} ist Texteingabe`);
}
pruefe(istTexteingabeElement({ tagName: 'INPUT' }), '1: input ohne type = text');
pruefe(istTexteingabeElement(el('input', 'TEXT')), '1: Schreibweise egal');
pruefe(istTexteingabeElement(el('TEXTAREA')), '1: textarea');
pruefe(istTexteingabeElement(el('SELECT')), '1: select');
pruefe(istTexteingabeElement(el('DIV', undefined, true)), '1: contenteditable');
for (const t of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']) {
  pruefe(!istTexteingabeElement(el('INPUT', t)), `1: input ${t} ist keine Texteingabe`);
}
pruefe(!istTexteingabeElement(el('DIV')) && !istTexteingabeElement(el('CANVAS')) && !istTexteingabeElement(el('BUTTON')), '1: div/canvas/button nein');
pruefe(!istTexteingabeElement(null) && !istTexteingabeElement(undefined) && !istTexteingabeElement('x'), '1: null/undefined/String nein');
pruefe(istTexteingabeAktiv({ target: el('INPUT', 'text') }) && !istTexteingabeAktiv({ target: null }), '1: Ereignis-Form');

// ── 2. InputManager mit Attrappen ──
type Hoerer = (e: Record<string, unknown>) => void;
const fensterHoerer = new Map<string, Hoerer[]>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = { setTimeout: () => 0, clearTimeout: () => undefined, addEventListener: (t: string, f: Hoerer) => fensterHoerer.set(t, [...(fensterHoerer.get(t) ?? []), f]) };
g.document = { addEventListener: () => undefined, exitPointerLock: () => undefined, pointerLockElement: null };
g.HTMLElement = class {};
const { InputManager } = await import('../src/engine/InputManager');
const canvas = { addEventListener: () => undefined, requestPointerLock: () => undefined };
const im = new InputManager(canvas as unknown as HTMLCanvasElement);
const gefeuert: string[] = [];
const CODES = ['KeyK', 'KeyI', 'KeyV', 'KeyB', 'KeyH', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
for (const c of CODES) im.onMenuKey(c, () => (gefeuert.push(c), true));
const taste = (type: 'keydown' | 'keyup', code: string, target: unknown, extra: Record<string, unknown> = {}): void => {
  for (const f of fensterHoerer.get(type) ?? []) f({ code, target, repeat: false, preventDefault: () => undefined, ...extra });
};

let blurs = 0;
const suchfeld = Object.assign(new (g.HTMLElement as new () => object)(), { tagName: 'INPUT', type: 'text', isContentEditable: false, blur: () => blurs++ });
for (const c of CODES) taste('keydown', c, suchfeld);
pruefe(gefeuert.length === 0, `2: mit Suchfeld-Fokus feuert keine Menütaste (${gefeuert.join(',')})`);
pruefe(CODES.every((c) => !im.isDown(c) && !im.wasPressed(c)), '2: mit Suchfeld-Fokus ist keine Taste gedrückt');
taste('keydown', 'Escape', suchfeld);
pruefe(blurs === 1, '2: Esc nimmt dem Feld den Fokus');
pruefe(!im.isDown('Escape'), '2: Esc im Feld löst sonst nichts aus');

const leinwand = { tagName: 'CANVAS' };
for (const c of CODES) taste('keydown', c, leinwand);
pruefe(gefeuert.join(',') === CODES.join(','), `2: ohne Fokus feuern alle Menütasten wie vorher (${gefeuert.join(',')})`);
pruefe(CODES.every((c) => im.isDown(c)), '2: ohne Fokus sind alle gedrückt');
const kasten = Object.assign(new (g.HTMLElement as new () => object)(), { tagName: 'INPUT', type: 'checkbox', isContentEditable: false, blur: () => blurs++ });
gefeuert.length = 0;
taste('keydown', 'KeyK', kasten);
pruefe(gefeuert.join(',') === 'KeyK', '2: Checkbox im Fokus sperrt nichts');
taste('keyup', 'KeyW', suchfeld);
pruefe(!im.isDown('KeyW'), '2: keyup im Feld lässt eine vorher gedrückte Taste los');

// ── 3. Verdrahtung ──
const hier = dirname(fileURLToPath(import.meta.url));
const lies = (p: string): string => readFileSync(resolve(hier, '..', p), 'utf8');
const tf = lies('src/editor/testflug/Testflug.ts');
const mm = lies('src/main.ts');
const imq = lies('src/engine/InputManager.ts');
pruefe(/tipptImFeld = \(e: KeyboardEvent\): boolean => istTexteingabeAktiv\(e\)/.test(tf), '3: Testflug nutzt den gemeinsamen Helfer');
pruefe(!/e\.target instanceof HTMLInputElement/.test(tf) && !/e\.target instanceof HTMLSelectElement/.test(tf), '3: Testflug hat keine eigene Elementprüfung mehr');
pruefe(/KeyV[\s\S]{0,300}tipptImFeld\(e\)\) return/.test(tf), '3: V prüft tipptImFeld');
pruefe(/istTexteingabeAktiv\(e\)\) return;\s*dekoPlatzierung/.test(mm), '3: Deko-Tasten in main.ts sperren im Feld');
pruefe(/if \(istTexteingabeAktiv\(e\)\)/.test(imq), '3: InputManager sperrt im Feld');

if (fehler) {
  console.error(`${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('texteingabe-tasten: alle Prüfungen grün');
