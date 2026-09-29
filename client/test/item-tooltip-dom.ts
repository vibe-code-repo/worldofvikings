/**
 * Item tooltip, DOM path (client/src/ui/ItemTooltip.ts) with a small fake DOM, and the comparison rule.
 *
 * Proves:
 *  1. Text goes in as TEXT: an item name `<img src=x onerror=alert(1)>` shows up verbatim, `innerHTML` is never
 *     set; and by syntax tree (not regex, comments do not count) no tooltip / panel file sets innerHTML,
 *     outerHTML, insertAdjacentHTML or calls document.write (the one fixed catalogue text in CharakterPanel
 *     `character.hint` is the only allowed exception).
 *  2. Hover shows, a move inside the same cell does NOT rebuild the text, another item does.
 *  3. Stays inside the window (right and bottom edge), follows the pointer.
 *  4. Hidden by: mouse button down (and stays hidden while held), a key, blur, a language change, an
 *     unbound element, a touch pointer is ignored; a missed pointerup does not switch it off for good.
 *  5. getragenAmSlot: armor and weapons only; the hammer/knife (no stats) is not a worn weapon; both sides need
 *     damage in the weapon slot; the same stack is not compared with itself; empty slot = no comparison.
 *
 * Run: npx tsx client/test/item-tooltip-dom.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ITEM_DEFS, findItem, type ItemShared, type ItemStack } from '@wov/shared';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const HERE = dirname(fileURLToPath(import.meta.url));
const UI = resolve(HERE, '..', 'src', 'ui');

// ── 1. by syntax tree with the type checker ─────────────────────────
console.log('\n[1] no HTML injection path in the tooltip and panel code (syntax tree + types)');
/*
 * What is forbidden in these files, found on the TYPED syntax tree (comments and strings do not count):
 *  - any property / method NAMED innerHTML, outerHTML, insertAdjacentHTML, createContextualFragment, srcdoc,
 *    DOMParser, document.write / writeln: as access, as object-literal key (`Object.assign(el, { innerHTML })`),
 *    shorthand, destructuring, or string-literal element access;
 *  - element access on a DOM node with anything but a numeric literal (`kopf[k] = name` with a computed key): the
 *    type checker tells a DOM node (it has a property `innerHTML`) from an array or a map;
 *  - Object.assign / defineProperty / defineProperties / setPrototypeOf / Reflect.set with a DOM node as first
 *    argument, and setAttribute on any node (attribute injection: onerror, srcdoc).
 * Limits: code that hands a DOM node through `any`/`unknown` (the checker cannot see the type) and code in OTHER
 * files. The fake-DOM part below still catches the tooltip itself through its setter counter.
 * The one allowed exception is the fixed catalogue text `character.hint` in CharakterPanel.
 */
const NAMEN = /^(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|srcdoc|DOMParser|writeln)$/;
const DATEIEN = ['ItemTooltip.ts', 'itemTooltipInhalt.ts', 'Hotbar.ts', 'InventoryPanel.ts', 'ContainerPanel.ts', 'CraftingPanel.ts', 'CharakterPanel.ts'];
const clientWurzel = resolve(HERE, '..');
const cfg = ts.readConfigFile(resolve(clientWurzel, 'tsconfig.json'), ts.sys.readFile);
const optionen = ts.parseJsonConfigFileContent(cfg.config, ts.sys, clientWurzel).options;
const programm = ts.createProgram(DATEIEN.map((f) => resolve(UI, f)), { ...optionen, noEmit: true });
const pruefer = programm.getTypeChecker();
const istDomKnoten = (n: ts.Expression): boolean => {
  const t = pruefer.getTypeAtLocation(n);
  return t.getProperty('innerHTML') !== undefined || (t.isUnion() && t.types.some((u) => u.getProperty('innerHTML') !== undefined));
};
function htmlZugriffe(datei: string): string[] {
  const sf = programm.getSourceFile(resolve(UI, datei))!;
  const treffer: string[] = [];
  const zeile = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const geh = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      if (NAMEN.test(n.name.text)) treffer.push(`${n.name.text} @${zeile(n)}: ${n.parent.getText().slice(0, 70)}`);
      if (n.name.text === 'write' && n.expression.getText() === 'document') treffer.push(`document.write @${zeile(n)}`);
      if (n.name.text === 'setAttribute' || n.name.text === 'setAttributeNS') treffer.push(`${n.name.text} @${zeile(n)}`);
    }
    if ((ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n) || ts.isBindingElement(n)) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name)) && NAMEN.test(n.name.text)) treffer.push(`key ${n.name.text} @${zeile(n)}`);
    if (ts.isBindingElement(n) && n.propertyName && (ts.isIdentifier(n.propertyName) || ts.isStringLiteralLike(n.propertyName)) && NAMEN.test(n.propertyName.text)) treffer.push(`destructure ${n.propertyName.text} @${zeile(n)}`);
    if (ts.isShorthandPropertyAssignment(n) && NAMEN.test(n.name.text)) treffer.push(`shorthand ${n.name.text} @${zeile(n)}`);
    if (ts.isElementAccessExpression(n)) {
      const arg = n.argumentExpression;
      if (ts.isStringLiteralLike(arg) && NAMEN.test(arg.text)) treffer.push(`["${arg.text}"] @${zeile(n)}`);
      else if (!ts.isNumericLiteral(arg) && istDomKnoten(n.expression)) treffer.push(`computed key on a DOM node @${zeile(n)}: ${n.getText().slice(0, 50)}`);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const objekt = n.expression.expression.getText();
      const fn = n.expression.name.text;
      const erst = n.arguments[0];
      if (((objekt === 'Object' && ['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'].includes(fn)) || (objekt === 'Reflect' && fn === 'set')) && erst && istDomKnoten(erst)) treffer.push(`${objekt}.${fn} on a DOM node @${zeile(n)}`);
    }
    if (ts.isNewExpression(n) && n.expression.getText() === 'DOMParser') treffer.push(`new DOMParser @${zeile(n)}`);
    ts.forEachChild(n, geh);
  };
  geh(sf);
  return treffer;
}
for (const f of DATEIEN.filter((d) => d !== 'CharakterPanel.ts')) {
  const t = htmlZugriffe(f);
  check(`${f}: no HTML injection path`, t.length === 0, t.join('; '));
}
const charTreffer = htmlZugriffe('CharakterPanel.ts');
check('CharakterPanel.ts: exactly one innerHTML, the fixed catalogue text character.hint', charTreffer.length === 1 && charTreffer[0].startsWith('innerHTML') && charTreffer[0].includes("'character.hint'"), charTreffer.join('; '));

// ── fake DOM ────────────────────────────────────────────────────────
type Handler = (e: Record<string, unknown>) => void;
let htmlGesetzt = 0;
class El {
  children: El[] = [];
  parentElement: El | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  offsetWidth = 100;
  offsetHeight = 80;
  textSets = 0;
  private text = '';
  set innerHTML(_v: string) { htmlGesetzt++; }
  get textContent(): string { return this.text; }
  set textContent(v: string) { this.text = v; this.textSets++; this.children = []; }
  appendChild(c: El): El { this.children.push(c); c.parentElement = this; return c; }
}
const docHandler = new Map<string, Handler[]>();
const winHandler = new Map<string, Handler[]>();
const reg = (m: Map<string, Handler[]>) => (t: string, fn: Handler): void => { m.set(t, [...(m.get(t) ?? []), fn]); };
let unterZeiger: El | null = null;
const body = new El();
const htmlEl = new El() as El & { addEventListener?: (t: string, fn: Handler) => void };
const htmlHandler = new Map<string, Handler[]>();
htmlEl.addEventListener = reg(htmlHandler);
Object.assign(globalThis, {
  document: {
    createElement: () => new El(), body, documentElement: htmlEl,
    addEventListener: reg(docHandler), elementFromPoint: () => unterZeiger,
  },
  window: { innerWidth: 1280, innerHeight: 720, addEventListener: reg(winHandler) },
});
const feuere = (m: Map<string, Handler[]>, typ: string, e: Record<string, unknown> = {}): void => { for (const h of m.get(typ) ?? []) h(e); };
const bewege = (x: number, y: number, extra: Record<string, unknown> = {}): void => feuere(docHandler, 'pointermove', { clientX: x, clientY: y, buttons: 0, pointerType: 'mouse', ...extra });

const { mitTooltip, konfiguriereTooltip, versteckeTooltip } = await import('../src/ui/ItemTooltip');
const { getragenAmSlot } = await import('../src/ui/itemTooltipInhalt');
const katalog = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'i18n', 'katalog', `${l}.json`), 'utf8'));
const KAT = { de: katalog('de'), en: katalog('en') };
const sprachHoerer: Array<() => void> = [];
const i18n = {
  language: 'de' as 'de' | 'en',
  t(key: string, vars: Record<string, string | number> = {}): string {
    return KAT[this.language][key].replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
  },
  onChange(fn: () => void): () => void { sprachHoerer.push(fn); fn(); return () => undefined; },
};
konfiguriereTooltip({ i18n: i18n as never });
const box = (): El | undefined => body.children.find((c) => 'itemTooltip' in c.dataset);
const sichtbar = (): boolean => box()?.style.display === 'block';

const BOESE = '<img src=x onerror=alert(1)>';
const boeses: ItemShared = { ...findItem('AxeFlint')!, name: 'Boese', label: BOESE };
let aktuell: ItemShared | null = boeses;
const zelle = new El(); const kind = new El(); zelle.appendChild(kind);
mitTooltip(zelle as never, () => aktuell, () => 'Aktion');
const fremd = new El();

console.log('\n[2] shows the name as text; a move in the same cell does not rebuild');
unterZeiger = kind; bewege(100, 100);
check('tooltip visible after a move over the cell (child element)', sichtbar());
const nameEl = box()!.children[0];
check('name is the literal string, not markup', nameEl.textContent === BOESE, nameEl.textContent);
check('innerHTML was never set (fake DOM counts setter calls)', htmlGesetzt === 0);
const gesetzt = nameEl.textSets;
for (let i = 0; i < 50; i++) bewege(100 + i, 100 + (i % 7));
check('50 moves in the same cell: name element not rewritten', nameEl.textSets === gesetzt && sichtbar(), `${nameEl.textSets} vs ${gesetzt}`);
aktuell = { ...boeses, label: 'Zweite' };
bewege(101, 101);
check('another item: text rebuilt', nameEl.textContent === 'Zweite');
aktuell = boeses; bewege(102, 102);

console.log('\n[3] position: follows the pointer, stays in the window');
bewege(200, 300);
check('follows: pointer + 16 px', box()!.style.transform === 'translate3d(216px,316px,0)', box()!.style.transform);
bewege(1270, 715);
check('right and bottom edge: flipped to the left / lifted above the edge', box()!.style.transform === `translate3d(${1270 - 16 - 100}px,${720 - 4 - 80}px,0)`, box()!.style.transform);

console.log('\n[4] hiding');
feuere(docHandler, 'keydown');
check('a key hides it', !sichtbar());
bewege(120, 120); check('shows again on the next move', sichtbar());
feuere(docHandler, 'pointerdown', {});
check('mouse button down hides it', !sichtbar());
bewege(130, 130, { buttons: 1 });
check('and it stays hidden while the button is held', !sichtbar());
feuere(docHandler, 'pointerup');
bewege(131, 131);
check('after pointerup it shows again', sichtbar());
feuere(docHandler, 'pointerdown', {}); bewege(140, 140, { buttons: 0 });
check('a missed pointerup: a move with no button down clears the press', sichtbar());
feuere(winHandler, 'blur');
check('window blur hides it', !sichtbar());
bewege(150, 150); check('(shows again)', sichtbar());
for (const h of sprachHoerer) h();
check('a language change hides it', !sichtbar());
i18n.language = 'en'; bewege(151, 151);
check('and the next move shows it in the new language', sichtbar() && box()!.children.some((c) => c.textContent.startsWith('Common')), box()!.children.map((c) => c.textContent).join('|'));
unterZeiger = fremd; bewege(160, 160);
check('an unbound element under the pointer hides it', !sichtbar());
unterZeiger = kind; bewege(170, 170, { pointerType: 'touch' });
check('touch pointers are ignored', !sichtbar());
bewege(171, 171); versteckeTooltip();
check('versteckeTooltip() hides (used when a window rebuilds its cells)', !sichtbar());
aktuell = null; bewege(172, 172);
check('a cell without an item shows nothing', !sichtbar());

// ── 5. getragenAmSlot ────────────────────────────────────────────────
console.log('\n[5] getragenAmSlot');
const stapel = (n: string): ItemStack => ({ shared: findItem(n)!, stack: 1, durability: 100, quality: 1, x: 0, y: 0, equipped: true }) as unknown as ItemStack;
const traegt = (belegung: Record<string, string>) => (slot: string): ItemStack | null => (belegung[slot] ? stapel(belegung[slot]) : null);
const brust = ITEM_DEFS.find((d) => d.ruestungsteil === 'ironward_brust')!;
const weste = ITEM_DEFS.find((d) => d.ruestungsteil === 'plainhide_male_vest')!;
check('axe vs worn sword: the sword', getragenAmSlot(findItem('AxeFlint')!, null, traegt({ waffe: 'SwordNorth' }))?.name === 'SwordNorth');
check('axe vs worn HAMMER (no stats): no comparison', getragenAmSlot(findItem('AxeFlint')!, null, traegt({ waffe: 'Hammer' })) === null);
check('axe vs worn knife (no stats): no comparison', getragenAmSlot(findItem('AxeFlint')!, null, traegt({ waffe: 'Messer' })) === null);
const ohneSchaden = (n: string): ItemStack => ({ ...stapel(n), shared: { ...findItem(n)!, stats: { strength: 2 } } }) as ItemStack;
check('worn weapon-slot item with stats but no damage: no comparison', getragenAmSlot(findItem('AxeFlint')!, null, () => ohneSchaden('SwordNorth')) === null);
check('hovered weapon-slot item with stats but no damage: no comparison', getragenAmSlot({ ...findItem('Spear')!, stats: { strength: 1 } }, null, traegt({ waffe: 'SwordNorth' })) === null);
check('empty weapon slot: no comparison', getragenAmSlot(findItem('AxeFlint')!, null, traegt({})) === null);
check('the worn stack itself: no comparison', getragenAmSlot(findItem('AxeFlint')!, { ...stapel('AxeFlint') }, () => null) === null);
const selbst = stapel('SwordNorth');
check('same stack instance: no comparison', getragenAmSlot(findItem('SwordNorth')!, selbst, () => selbst) === null);
check('a tool (hoe) is not compared', getragenAmSlot(findItem('Hoe')!, null, traegt({ waffe: 'SwordNorth' })) === null);
check('a material is not compared', getragenAmSlot(findItem('Wood')!, null, traegt({ waffe: 'SwordNorth' })) === null);
check('vest vs worn chestplate: the chestplate (slot hemd)', getragenAmSlot(weste, null, traegt({ hemd: brust.name }))?.name === brust.name);
check('vest vs a worn part WITHOUT stats (leather top): no comparison', getragenAmSlot(weste, null, traegt({ hemd: 'LederBH' })) === null);
check('armor vs the weapon slot content is never looked at', getragenAmSlot(weste, null, traegt({ waffe: 'SwordNorth' })) === null);

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
