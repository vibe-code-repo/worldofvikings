/**
 * The five windows hide an open tooltip when they rebuild their cells (N1-2 of the second attack).
 *
 * Runs the REAL panels (Hotbar, InventoryPanel, ContainerPanel, CharakterPanel, CraftingPanel) against a
 * permissive fake DOM: a tooltip is made visible, then the panel is made to rebuild its cells, and the
 * tooltip must be gone. Without that line in the panel the tooltip stays (control: a rebuild of NOTHING keeps
 * it). Also: a language change hides it.
 *
 * Run: npx tsx client/test/item-tooltip-panels.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findItem } from '@wov/shared';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const HERE = dirname(fileURLToPath(import.meta.url));

// ── permissive fake DOM ─────────────────────────────────────────────
type Handler = (e: Record<string, unknown>) => void;
class El {
  childNodes: El[] = [];
  parentElement: El | null = null;
  style: Record<string, string> = { cssText: '' };
  dataset: Record<string, string> = {};
  offsetWidth = 100; offsetHeight = 80; textContent = ''; innerHTML = ''; className = ''; id = ''; title = ''; src = ''; alt = '';
  get lastChild(): El | null { return this.childNodes.at(-1) ?? null; }
  get children(): El[] { return this.childNodes; }
  appendChild(c: El): El { this.childNodes.push(c); c.parentElement = this; return c; }
  append(...cs: El[]): void { for (const c of cs) this.appendChild(c); }
  removeChild(c: El): El { this.childNodes = this.childNodes.filter((x) => x !== c); return c; }
  replaceChildren(...cs: El[]): void { this.childNodes = []; this.append(...cs); }
  remove(): void { /* fake */ }
  addEventListener(): void { /* fake */ }
  removeEventListener(): void { /* fake */ }
  setAttribute(): void { /* fake */ }
  getBoundingClientRect(): Record<string, number> { return { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }; }
  closest(): null { return null; }
  querySelector(): null { return null; }
}
const docHandler = new Map<string, Handler[]>();
const reg = (m: Map<string, Handler[]>) => (t: string, fn: Handler): void => { m.set(t, [...(m.get(t) ?? []), fn]); };
let unterZeiger: El | null = null;
const body = new El();
const htmlEl = new El();
Object.assign(globalThis, {
  document: {
    createElement: () => new El(), createTextNode: () => new El(), body, documentElement: htmlEl, addEventListener: reg(docHandler),
    removeEventListener: () => undefined, elementFromPoint: () => unterZeiger,
  },
  window: { innerWidth: 1280, innerHeight: 720, addEventListener: reg(new Map()) },
});
const bewege = (x: number, y: number): void => { for (const h of docHandler.get('pointermove') ?? []) h({ clientX: x, clientY: y, buttons: 0, pointerType: 'mouse' }); };

const { mitTooltip, konfiguriereTooltip } = await import('../src/ui/ItemTooltip');
const katalog = (l: string): Record<string, string> => JSON.parse(readFileSync(resolve(HERE, '..', 'src', 'i18n', 'katalog', `${l}.json`), 'utf8'));
const KAT = { de: katalog('de'), en: katalog('en') };
const sprachHoerer: Array<() => void> = [];
const i18n = {
  language: 'de' as 'de' | 'en',
  t(key: string, vars: Record<string, string | number> = {}): string {
    return (KAT[this.language][key] ?? key).replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
  },
  onChange(fn: () => void): () => void { sprachHoerer.push(fn); fn(); return () => undefined; },
  tInhalt: (k: string) => k,
};
const boxEl = (): El | undefined => body.childNodes.find((c) => 'itemTooltip' in c.dataset);
const sichtbar = (): boolean => boxEl()?.style.display === 'block';

konfiguriereTooltip({ i18n: i18n as never }); // the Hotbar has no i18n; in the game the inventory panel configures it

// A bound cell that always has an item: hovering it shows the tooltip.
const zelle = new El();
mitTooltip(zelle as never, () => findItem('AxeFlint') ?? null);
function zeige(): void { unterZeiger = zelle; bewege(10, 10); bewege(11, 11); }

const listeners = (): { inv: Array<() => void>; api: { onChanged: (cb: () => void) => () => void } } => {
  const inv: Array<() => void> = [];
  return { inv, api: { onChanged: (cb) => { inv.push(cb); return () => undefined; } } };
};
const gitter = (extra: Record<string, unknown> = {}) => ({ width: 8, height: 4, itemAt: () => null, totalWeight: () => 0, hotbar: () => [], countOf: () => 0, ...extra });

async function fuerPanel(name: string, baue: () => { ausloeser: () => void }): Promise<void> {
  const { ausloeser } = baue();
  zeige();
  check(`${name}: tooltip visible before the rebuild`, sichtbar());
  zeige(); // control: nothing rebuilt, still there
  check(`${name}: control, no rebuild keeps it`, sichtbar());
  ausloeser();
  check(`${name}: rebuild of the cells hides it`, !sichtbar());
}

// ── Hotbar ──
{
  const { Hotbar } = await import('../src/ui/Hotbar');
  await fuerPanel('Hotbar', () => {
    const a = listeners(); const b = listeners();
    new Hotbar(gitter(a.api) as never, { ...b.api, rightItem: null, useHotbar: () => undefined } as never);
    return { ausloeser: () => { for (const cb of a.inv) cb(); } };
  });
}
// ── Inventory ──
{
  const { InventoryPanel } = await import('../src/ui/InventoryPanel');
  await fuerPanel('InventoryPanel', () => {
    const a = listeners(); const b = listeners();
    const p = new InventoryPanel(gitter(a.api) as never, { ...b.api, rightItem: null, imSlot: () => null } as never, i18n as never);
    return { ausloeser: () => p.show() };
  });
}
// ── Chest ──
{
  const { ContainerPanel } = await import('../src/ui/ContainerPanel');
  await fuerPanel('ContainerPanel', () => {
    const a = listeners();
    const p = new ContainerPanel(gitter(a.api) as never, () => undefined, i18n as never);
    return { ausloeser: () => p.zeigeInhalt('u', 1, gitter() as never) };
  });
}
// ── Character ──
{
  const { CharakterPanel } = await import('../src/ui/CharakterPanel');
  await fuerPanel('CharakterPanel', () => {
    const p = new CharakterPanel(() => ({ imSlot: () => null }) as never, () => ({}), i18n as never, () => 'x.glb', () => '#fff', () => '#fff');
    (p as unknown as { wurzel: El }).wurzel.style.display = 'flex'; // visible, without the 3D preview (a Babylon import)
    return { ausloeser: () => p.zeichne() };
  });
}
// ── Crafting ──
{
  const { CraftingPanel } = await import('../src/ui/CraftingPanel');
  await fuerPanel('CraftingPanel', () => {
    const p = new CraftingPanel(() => gitter() as never, () => undefined, null, i18n as never);
    return { ausloeser: () => p.show() };
  });
}
// ── language change ──
zeige();
check('language change: tooltip visible before', sichtbar());
for (const h of sprachHoerer) h();
check('language change hides it (through the one subscription of konfiguriereTooltip)', !sichtbar());

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
