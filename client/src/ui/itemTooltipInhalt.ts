/**
 * Content of the item tooltip, pure (no DOM, no game state) so tests can read it.
 * Inhalt des Item-Tooltips, rein: Name, Seltenheit, Typ, Itemlevel, Werte, Gewicht, Vergleich.
 *
 * Every visible word comes through the translator `t` (catalogue keys `rarity.*`, `stat.*`,
 * `tooltip.*`, `character.slot.*`); the numbers and colors are the only things that live here.
 */
import { ESSEN, STAT_IDS, RARITY_TEXT_KEYS, anzeigeName, type ItemShared, type ItemStats, type Rarity, type StatId } from '@wov/shared';

export type Uebersetzer = (key: string, vars?: Record<string, string | number>) => string;

/** Rarity colors: white, green, blue, purple, orange. */
export const RARITY_FARBEN: Readonly<Record<Rarity, string>> = {
  common: '#ffffff',
  uncommon: '#1eff00',
  rare: '#4a9eff',
  epic: '#c060ff',
  legendary: '#ff8000',
};

export const FARBE_PLUS = '#6fdc6f';
export const FARBE_MINUS = '#ff6b6b';
export const FARBE_TEXT = '#e8d9b8';
export const FARBE_GEDAEMPFT = '#a8916a';

/** Values of `ItemType` (a const enum, not resolved across modules by esbuild; same table as GegenstandsKatalog). */
export const TYP_WAFFE = 14;
const TYP_WERKZEUG = 19;

export interface TooltipZeile {
  readonly art: 'seltenheit' | 'typ' | 'itemlevel' | 'wert' | 'gewicht' | 'aktion';
  readonly text: string;
  readonly farbe: string;
  /** Difference to the worn part, e.g. `(+3)`. */
  readonly zusatz?: { readonly text: string; readonly farbe: string };
}

export interface TooltipInhalt {
  readonly name: string;
  readonly nameFarbe: string;
  readonly zeilen: readonly TooltipZeile[];
}

export interface TooltipOptionen {
  /** Attribute values of the part worn in the same slot; undefined = no comparison. */
  readonly vergleich?: ItemStats;
  /** Gray last line (the click action). */
  readonly aktion?: string | null;
  /** Language for the item name (`anzeigeName`); default German. */
  readonly sprache?: string;
}

/** Materials, food and trophies show no level: only tools, weapons and wearable parts do. */
export function zeigtItemLevel(shared: ItemShared): boolean {
  return shared.itemType === TYP_WAFFE || shared.itemType === TYP_WERKZEUG || shared.ausruestung !== undefined;
}

/** Translation key of the type line: slot name for wearable parts, else weapon / tool / food / trophy / material. */
export function typSchluessel(shared: ItemShared): string {
  if (shared.ausruestung !== undefined) return `character.slot.${shared.ausruestung}`;
  if (shared.itemType === TYP_WAFFE) return 'tooltip.type.weapon';
  if (shared.itemType === TYP_WERKZEUG) return 'tooltip.type.tool';
  if (Object.hasOwn(ESSEN, shared.name)) return 'tooltip.type.food';
  if (shared.name.startsWith('Trophy')) return 'tooltip.type.trophy';
  return 'tooltip.type.material';
}

function deltaText(delta: number): { text: string; farbe: string } {
  return delta > 0
    ? { text: `(+${delta})`, farbe: FARBE_PLUS }
    : { text: `(−${-delta})`, farbe: FARBE_MINUS };
}

function wertZeile(t: Uebersetzer, id: StatId, wert: number, vergleich: ItemStats | undefined): TooltipZeile {
  const stat = t(`stat.${id}`);
  const text = id === 'damage' || id === 'armor'
    ? t('tooltip.stat.line', { stat, value: wert })
    : t('tooltip.stat.plus', { stat, value: wert });
  const delta = vergleich ? wert - (vergleich[id] ?? 0) : 0;
  return {
    art: 'wert',
    text,
    farbe: id === 'damage' || id === 'armor' || wert === 0 ? FARBE_TEXT : FARBE_PLUS,
    ...(delta !== 0 ? { zusatz: deltaText(delta) } : {}),
  };
}

export function tooltipInhalt(shared: ItemShared, t: Uebersetzer, opt: TooltipOptionen = {}): TooltipInhalt {
  const farbe = RARITY_FARBEN[shared.rarity];
  const zeilen: TooltipZeile[] = [
    { art: 'seltenheit', text: t(RARITY_TEXT_KEYS[shared.rarity]), farbe },
    { art: 'typ', text: t(typSchluessel(shared)), farbe: FARBE_TEXT },
  ];
  if (zeigtItemLevel(shared)) {
    zeilen.push({ art: 'itemlevel', text: t('tooltip.itemlevel', { level: shared.itemLevel }), farbe: FARBE_TEXT });
  }
  // Only values other than 0; with a comparison also a value the worn part has and this one lacks.
  for (const id of STAT_IDS) {
    const wert = shared.stats?.[id] ?? 0;
    const getragen = opt.vergleich?.[id] ?? 0;
    if (wert === 0 && getragen === 0) continue;
    zeilen.push(wertZeile(t, id, wert, opt.vergleich));
  }
  if (shared.weight > 0) {
    zeilen.push({ art: 'gewicht', text: t('tooltip.weight', { weight: shared.weight.toFixed(1) }), farbe: FARBE_GEDAEMPFT });
  }
  if (opt.aktion) zeilen.push({ art: 'aktion', text: opt.aktion, farbe: FARBE_GEDAEMPFT });
  return { name: anzeigeName(shared, opt.sprache), nameFarbe: farbe, zeilen };
}
