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
import * as ts from 'typescript';
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
const docHoerer = new Map<string, Hoerer[]>();
g.document = { addEventListener: (t: string, f: Hoerer) => docHoerer.set(t, [...(docHoerer.get(t) ?? []), f]), exitPointerLock: () => undefined, pointerLockElement: null };
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

// ── 4. Jeder keydown-Handler im Testflug prüft das Feld (Syntaxbaum), Karten- und Editor-Tasten ebenso ──
/** keydown-Handler auf window, deren Text keinen `tipptImFeld(`-Aufruf enthält (Escape→setzeAb ausgenommen). */
function handlerOhneFeldpruefung(quelle: string): string[] {
  const sf = ts.createSourceFile('x.ts', quelle, ts.ScriptTarget.Latest, true);
  const ohne: string[] = [];
  let gesamt = 0;
  const gehe = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'addEventListener') {
      const [art, fn] = n.arguments;
      if (art && ts.isStringLiteral(art) && art.text === 'keydown' && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        gesamt++;
        const text = fn.getText(sf);
        if (!/tipptImFeld\(/.test(text) && !/setzeAb\(\)/.test(text)) ohne.push(`Zeile ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      }
    }
    ts.forEachChild(n, gehe);
  };
  gehe(sf);
  return gesamt >= 9 ? ohne : [`nur ${gesamt} Handler gefunden`];
}
const bs = lies('src/editor/testflug/BewuchsStufe.ts');
const em = lies('src/editor/editorMain.ts');
pruefe(handlerOhneFeldpruefung(tf).length === 0, `4: jeder keydown-Handler in Testflug.ts prüft tipptImFeld (${handlerOhneFeldpruefung(tf).join(', ')})`);
pruefe(/optionen\.tipptImFeld\(e\)/.test(bs), '4: BewuchsStufe prüft das Feld');
const mutiere = (quelle: string, alt: string, neu: string): string => {
  if (quelle.split(alt).length !== 2) throw new Error('Stelle nicht eindeutig: ' + alt);
  return quelle.replace(alt, neu);
};
for (const [name, alt, neu] of [
  ['G ohne tipptImFeld', "if (tipptImFeld(e) || e.code !== 'KeyG') return;", "if (e.code !== 'KeyG') return;"],
  ['Q ohne tipptImFeld', "if (tipptImFeld(e) || e.code !== 'KeyQ' || e.repeat || !player) return;", "if (e.code !== 'KeyQ' || e.repeat || !player) return;"],
  ['Komma/Punkt ohne tipptImFeld', "if (tipptImFeld(e) || !panel.istOffen || (e.code !== 'Comma'", "if (!panel.istOffen || (e.code !== 'Comma'"],
  ['V ohne tipptImFeld', "if (tipptImFeld(e)) return;\n      const an", "const an"],
] as const) {
  pruefe(handlerOhneFeldpruefung(mutiere(tf, alt, neu)).length > 0, `4: Mutant „${name}“ wird rot`);
}
pruefe(/!istTexteingabeAktiv\(e\) && worldMap\?\.taste\(e\.code\)/.test(mm), '4: Kartentasten (WorldMap.taste) sperren im Feld');
pruefe(!/!istTexteingabeAktiv\(e\) && worldMap/.test(mutiere(mm, '!istTexteingabeAktiv(e) && worldMap?.taste', 'worldMap?.taste')), '4: Mutant „WorldMap.taste ohne Feldprüfung“ wird rot');
pruefe(/if \(!e\.ctrlKey \|\| istTexteingabeAktiv\(e\)\) return;\s*if \(e\.code === 'KeyZ' && !e\.shiftKey\) \{\s*rueckgaengig\(\)/.test(em), '4: Strg+Z/Y im Karteneditor sperrt im Feld');
pruefe(!/if \(!e\.ctrlKey \|\| istTexteingabeAktiv\(e\)\) return;/.test(mutiere(em, 'if (!e.ctrlKey || istTexteingabeAktiv(e)) return;', 'if (!e.ctrlKey) return;')), '4: Mutant „Strg+Z ohne Feldprüfung“ wird rot');

// ── 5. Fokus-Element, contenteditable-Kinder, keyup, Mausrad ──
{
  const doc = g.document as Record<string, unknown>;
  const feld = { tagName: 'INPUT', type: 'text', isContentEditable: false };
  const kind = { tagName: 'B', isContentEditable: true };
  const kindOhneFlag = { tagName: 'B', closest: (s: string) => (s.startsWith('[contenteditable]') ? {} : null) };
  const fremd = { tagName: 'B', closest: () => null };
  pruefe(istTexteingabeElement(kind) && istTexteingabeElement(kindOhneFlag) && !istTexteingabeElement(fremd), '5: Kind eines contenteditable zählt (closest), fremdes Element nicht');
  doc.activeElement = feld;
  pruefe(istTexteingabeAktiv({ target: { tagName: 'CANVAS' } }) && istTexteingabeAktiv({ target: null }), '5: Ziel Canvas/Fenster, Fokus im Feld → aktiv (document.activeElement)');
  doc.activeElement = { tagName: 'BODY' };
  pruefe(!istTexteingabeAktiv({ target: { tagName: 'CANVAS' } }), '5: Fokus auf body → nicht aktiv');
  doc.activeElement = feld;
  // keyup: im Spiel gedrückt, dann Fokus ins Feld, keyup im Feld lässt los
  doc.activeElement = null;
  taste('keydown', 'KeyW', { tagName: 'CANVAS' });
  pruefe(im.isDown('KeyW'), '5: W im Spiel gedrückt');
  doc.activeElement = feld;
  taste('keyup', 'KeyW', feld);
  pruefe(!im.isDown('KeyW'), '5: Fokus im Feld, keyup dort → W ist nicht mehr gedrückt');
  // Mausrad
  const rad = (ziel: unknown): { verhindert: boolean } => {
    const r = { verhindert: false };
    const hoerer = docHoerer.get('wheel') ?? [];
    for (const f of hoerer) f({ target: ziel, deltaY: 100, preventDefault: () => (r.verhindert = true) });
    return r;
  };
  const vorher = im.consumeWheel();
  void vorher;
  doc.activeElement = feld;
  const imFeld = rad(canvas);
  pruefe(!imFeld.verhindert && im.consumeWheel() === 0, '5: Rad bei Textfeld-Fokus: weder preventDefault noch Zoom (Scrollen bleibt)');
  doc.activeElement = { tagName: 'BODY' };
  const frei = rad(canvas);
  pruefe(frei.verhindert && im.consumeWheel() === 100, '5: ohne Feld-Fokus wirkt das Rad wie vorher');
  doc.activeElement = null;
  pruefe(/if \(istTexteingabeFokus\(\)\) return;\s*e\.preventDefault\(\);/.test(imq), '5: Rad-Sperre steht vor preventDefault im InputManager');
  pruefe(!/if \(istTexteingabeFokus\(\)\) return;/.test(mutiere(imq, 'if (istTexteingabeFokus()) return;', '')), '5: Mutant „Rad ohne Sperre“ wird rot');
}

if (fehler) {
  console.error(`${fehler} Prüfung(en) rot`);
  process.exit(1);
}
console.log('texteingabe-tasten: alle Prüfungen grün');
