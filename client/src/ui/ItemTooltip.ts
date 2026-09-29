/**
 * The item tooltip: ONE floating box for the whole UI, following the mouse.
 * Der Item-Tooltip: eine schwebende Box für das ganze UI, folgt der Maus.
 *
 * Panels register a cell with `mitTooltip(cell, () => item)`; nothing else. One delegated listener
 * on the document finds the registered cell under the pointer (also after a panel rebuilt its cells),
 * so there is no per-cell listener and no cleanup. The text is rebuilt only when the item, the language
 * or the comparison changes; a mouse move only moves the box (one transform), and the line elements are
 * reused. Hidden while a mouse button is down (dragging, clicking), on any key and on blur.
 *
 * `konfiguriereTooltip` hands over the language and the comparison source; the inventory panel does it
 * (it knows the equipment), so `main.ts` needs no line for the tooltip.
 */
import type { ItemShared, ItemStack } from '@wov/shared';
import type { GameI18n, TranslationKey } from '../i18n';
import { UI } from './theme';
import { tooltipInhalt, type TooltipInhalt } from './itemTooltipInhalt';

export type TooltipQuelle = ItemStack | ItemShared;

interface Bindung {
  readonly holen: () => TooltipQuelle | null;
  readonly aktion?: () => string | null;
}

export interface TooltipKontext {
  readonly i18n: GameI18n;
  /** The part worn in the slot of `shared`, or null (nothing worn, same stack, not comparable). */
  readonly vergleich?: (shared: ItemShared, stack: ItemStack | null) => ItemShared | null;
}

const BINDUNGEN = new WeakMap<Element, Bindung>();
const ABSTAND = 16;

let kontext: TooltipKontext | null = null;
let box: HTMLDivElement | null = null;
let nameZeile: HTMLDivElement | null = null;
const zeilenPool: HTMLDivElement[] = [];
let sichtbar = false;
let gedrueckt = false;
let installiert = false;
let breite = 0;
let hoehe = 0;
// What the box currently shows; a move with the same values does not rebuild.
let zeigtShared: ItemShared | null = null;
let zeigtVergleich: ItemShared | null = null;
let zeigtAktion: string | null = null;
let zeigtSprache = '';

export function konfiguriereTooltip(neu: TooltipKontext): void {
  kontext = { ...kontext, ...neu };
}

/** Shows the tooltip of `holen()` while the pointer is over `zelle` (or a child of it). */
export function mitTooltip(zelle: HTMLElement, holen: () => TooltipQuelle | null, aktion?: () => string | null): void {
  BINDUNGEN.set(zelle, { holen, aktion });
  installiere();
}

export function versteckeTooltip(): void {
  if (!sichtbar || !box) return;
  sichtbar = false;
  box.style.display = 'none';
  zeigtShared = null;
}

function installiere(): void {
  if (installiert) return;
  installiert = true;
  document.addEventListener('pointermove', beiBewegung);
  document.addEventListener('pointerdown', () => { gedrueckt = true; versteckeTooltip(); }, true);
  document.addEventListener('pointerup', () => { gedrueckt = false; });
  document.addEventListener('pointercancel', () => { gedrueckt = false; });
  document.addEventListener('keydown', versteckeTooltip, true);
  window.addEventListener('blur', () => { gedrueckt = false; versteckeTooltip(); });
  document.documentElement.addEventListener('mouseleave', versteckeTooltip);
}

function bauBox(): HTMLDivElement {
  const b = document.createElement('div');
  b.dataset.itemTooltip = '';
  b.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'z-index:1200', 'display:none', 'pointer-events:none',
    'max-width:280px', 'padding:8px 12px 8px', 'box-sizing:border-box',
    `background:${UI.panelBg}`, `border:1px solid ${UI.border}`, 'border-radius:4px',
    'box-shadow:0 6px 20px rgba(0,0,0,.6)', `font-family:${UI.font}`, 'font-size:13px', 'line-height:1.35',
    `color:${UI.text}`, 'will-change:transform',
  ].join(';');
  const n = document.createElement('div');
  n.style.cssText = 'font-size:15px;font-weight:bold;text-shadow:0 1px 2px #000;margin-bottom:2px';
  b.appendChild(n);
  nameZeile = n;
  document.body.appendChild(b);
  return b;
}

function beiBewegung(e: PointerEvent): void {
  if (gedrueckt || e.pointerType === 'touch' || !kontext) return;
  let el = e.target instanceof Element ? e.target : null;
  let bindung: Bindung | undefined;
  while (el && !(bindung = BINDUNGEN.get(el))) el = el.parentElement;
  const quelle = bindung?.holen() ?? null;
  if (!bindung || !quelle) {
    versteckeTooltip();
    return;
  }
  const stack = 'shared' in quelle ? quelle : null;
  const shared = 'shared' in quelle ? quelle.shared : quelle;
  const vergleich = kontext.vergleich?.(shared, stack) ?? null;
  const aktion = bindung.aktion?.() ?? null;
  const sprache = kontext.i18n.language;
  if (!sichtbar || shared !== zeigtShared || vergleich !== zeigtVergleich || aktion !== zeigtAktion || sprache !== zeigtSprache) {
    zeichne(shared, vergleich, aktion);
    zeigtShared = shared;
    zeigtVergleich = vergleich;
    zeigtAktion = aktion;
    zeigtSprache = sprache;
  }
  setzeBox(e.clientX, e.clientY);
}

function zeichne(shared: ItemShared, vergleich: ItemShared | null, aktion: string | null): void {
  if (!box) box = bauBox();
  const i18n = kontext!.i18n;
  const inhalt: TooltipInhalt = tooltipInhalt(
    shared,
    (key, vars) => i18n.t(key as TranslationKey, vars),
    { vergleich: vergleich ? (vergleich.stats ?? {}) : undefined, aktion, sprache: i18n.language },
  );
  nameZeile!.textContent = inhalt.name;
  nameZeile!.style.color = inhalt.nameFarbe;
  while (zeilenPool.length < inhalt.zeilen.length) {
    const z = document.createElement('div');
    box.appendChild(z);
    zeilenPool.push(z);
  }
  for (let i = 0; i < zeilenPool.length; i++) {
    const z = zeilenPool[i];
    const zeile = inhalt.zeilen[i];
    if (!zeile) {
      z.style.display = 'none';
      continue;
    }
    z.style.display = 'block';
    z.style.color = zeile.farbe;
    z.style.fontSize = zeile.art === 'aktion' ? '11px' : '13px';
    z.style.marginTop = zeile.art === 'aktion' ? '4px' : '0';
    z.dataset.art = zeile.art;
    z.textContent = zeile.text;
    if (zeile.zusatz) {
      const s = document.createElement('span');
      s.textContent = ` ${zeile.zusatz.text}`;
      s.style.color = zeile.zusatz.farbe;
      z.appendChild(s);
    }
  }
  box.style.display = 'block';
  sichtbar = true;
  breite = box.offsetWidth;
  hoehe = box.offsetHeight;
}

/** Follows the pointer and stays inside the window. */
function setzeBox(x: number, y: number): void {
  if (!box) return;
  let links = x + ABSTAND;
  let oben = y + ABSTAND;
  if (links + breite > window.innerWidth - 4) links = Math.max(4, x - ABSTAND - breite);
  if (oben + hoehe > window.innerHeight - 4) oben = Math.max(4, window.innerHeight - 4 - hoehe);
  box.style.transform = `translate3d(${Math.round(links)}px,${Math.round(oben)}px,0)`;
}

