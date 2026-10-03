/**
 * Item definitions. Values marked "verified" come from the component dumps
 * under the local asset export — the rest are plausible
 * placeholders for fields nothing reads yet.
 *
 * Asset names are checked against assets/: sprites are lower_snake_case,
 * models are the PascalCase prefab name.
 */

import { ItemType, type ItemShared } from './ItemData.js';
import { istEigenesModell } from '../prefabs.js';
import { FEMALE_ARMOR_BODY } from '../armorCompatibility.js';
import { werteFuerRuestungsteil } from './setWerte.js';
import { loeseStufe } from './itemStufen.js';

/** Definition before level and rarity are merged in (`bauItemDefs`). */
type ItemRoh = Omit<ItemShared, 'itemLevel' | 'rarity'>;

/**
 * The 29 raw items (tools, weapons, materials) are not code any more: they live in
 * shared/data/gegenstaende.json and are applied by `grundbestand.ts` when `@wov/shared` loads. What stays here
 * is the clothing (set parts and the two leather starter pieces), which the armour pipeline owns.
 * Die 29 Rohgegenstaende stehen in shared/data/gegenstaende.json; hier bleibt nur die Kleidung.
 */

/**
 * ── Kleidung ────────────────────────────────────────────────────────
 *
 * WARUM `itemType: Material` UND NICHT EIN EIGENER TYP: `ItemType` bildet
 * der Aufzaehlung des Vorbilds nach, und die hat fuer Ruestung eigene
 * Werte. Wir portieren aber keine fremde Ruestung — was diese Teile koennen, steht
 * in `ausruestung` (wohin sie gehoeren) und `ruestungsteil` (was man
 * sieht). Eine geratene Zahl in eine fremde Aufzaehlung zu schreiben
 * haette nur die Gefahr gebracht, spaeter mit dem echten Wert zu kollidieren.
 *
 * `model: null` ist Absicht: Kleidung ist kein Ding in der Hand, sondern
 * wird auf das Skelett der Figur gezogen (siehe `ruestungsteil` in
 * ItemData.ts). Ein Sprite gibt es noch nicht — `itemVisual()` zeigt dann
 * die ersten zwei Buchstaben der Beschriftung statt eines kaputten Bildes.
 */
import { IRONWARD_PARTS } from '../ironward.js';
import { WILDWARDEN_PARTS } from '../wildwarden.js';
import { ASHENVEIL_PARTS } from '../ashenveil.js';
import { SEIDRAVEN_PARTS } from '../seidraven.js';
import { EMBERRAGE_PARTS } from '../emberrage.js';
import { PLAINHIDE_PARTS } from '../plainhide.js';
import { GRAVETHORN_PARTS } from '../gravethorn.js';
import { CROWSHADE_PARTS } from '../crowshade.js';
const KLEIDUNG: ItemRoh[] = [
  ...[...IRONWARD_PARTS, ...WILDWARDEN_PARTS, ...ASHENVEIL_PARTS, ...SEIDRAVEN_PARTS, ...EMBERRAGE_PARTS, ...PLAINHIDE_PARTS, ...GRAVETHORN_PARTS, ...CROWSHADE_PARTS].map(p => ({ name: p.item, label: p.name, textKey: p.textKey, itemType: ItemType.Material,
    icon: p.id, model: null, maxStackSize: 1, weight: p.weight, toolTier: 0,
    ausruestung: p.equipment, ruestungsteil: p.id, hideAppearance: p.hideAppearance,
    ...('vfxProfile' in p ? { vfxProfile: p.vfxProfile } : {}),
    ...(werteFuerRuestungsteil(p.id) ? { stats: werteFuerRuestungsteil(p.id) } : {}),
    bodyVariant: p.bodyVariant, bodyProfile: p.bodyProfile, figure: p.figure })),
  {
    name: 'LederBH',
    label: 'Leder-Oberteil',
    itemType: ItemType.Material,
    icon: 'leder_bh',
    model: null,
    maxStackSize: 1,
    weight: 0.6,
    toolTier: 0,
    ausruestung: 'hemd',
    ruestungsteil: 'leder_bh',
    ...FEMALE_ARMOR_BODY,
  },
  {
    name: 'LederShorts',
    label: 'Lederhose, kurz',
    itemType: ItemType.Material,
    icon: 'leder_shorts',
    model: null,
    maxStackSize: 1,
    weight: 1.2,
    toolTier: 0,
    ausruestung: 'hose',
    ruestungsteil: 'leder_shorts',
    ...FEMALE_ARMOR_BODY,
  },
];

/**
 * Die ausgelieferten Code-Gegenstände: die Kleidung, mit geprüftem `model` (bei Kleidung immer `null`).
 * Die Handgegenstände (Werkzeuge, Waffen, Materialien) kommen aus der Datei und stehen erst in `ITEMS_BY_NAME`.
 *
 * Gestrichen wird das MODELL, nicht der Gegenstand. Das ist der
 * Unterschied zu Features und Spawns: Ein Item ohne Modell bleibt ein
 * vollwertiger Eintrag — es liegt im Inventar, hat sein Symbol, sein
 * Gewicht, sein Rezept und seine Piece-Tabelle. Unsichtbar ist nur die
 * Hand, die es hält. Wer den Eintrag stattdessen entfernte, verlöre mit
 * ihm die Rezepte und den Inhalt jeder gespeicherten Truhe.
 *
 * `model: null` ist dafür der vorgesehene Zustand, kein Notbehelf — er
 * heisst seit jeher "Null for icon-only items" (ItemData.ts) und wird vom
 * Client bereits so behandelt.
 *
 * Es fällt derzeit JEDES Modell weg: Hoe, Hammer_0, Club, AxeFlint und
 * die Materialien stammen samt und sonders aus dem Fremdexport. Bis
 * eigene Werkzeugmodelle vorliegen, hält der Wikinger nichts sichtbar in
 * der Hand — der beschlossene Zwischenzustand.
 */
export const ITEM_DEFS: readonly ItemShared[] = bauItemDefs();

function bauItemDefs(): ItemShared[] {
  let ohneModell = 0;
  const ohneStufe: string[] = [];
  const liste = KLEIDUNG.map((roh) => {
    // Never throws: an unrated item is level 1 / common (data items bring their own values). That every CODE
    // item has an explicit entry is guaranteed by shared/test/item-stufen.ts, not by a crash at import.
    const { stufe, quelle } = loeseStufe(roh, roh as { itemLevel?: unknown; rarity?: unknown });
    if (quelle === 'rueckfall') ohneStufe.push(roh.name);
    const d: ItemShared = { ...roh, itemLevel: stufe.itemLevel, rarity: stufe.rarity };
    if (d.model === null || istEigenesModell(d.model)) return d;
    ohneModell++;
    return { ...d, model: null };
  });
  if (ohneStufe.length > 0) {
    console.warn(`[items] ${ohneStufe.length} Eintraege ohne itemLevel/rarity, Rueckfall 1/common: ${ohneStufe.join(', ')}`);
  }
  if (ohneModell > 0) {
    console.warn(
      `[items] ${ohneModell} von ${KLEIDUNG.length} Eintraegen ohne eigenes Modell uebersprungen (Symbol bleibt)`
    );
  }
  return liste;
}

/** Code items only. Never changes after start-up; data items are layered on top of it. */
const CODE_ITEMS_BY_NAME: ReadonlyMap<string, ItemShared> = new Map(
  ITEM_DEFS.map((d) => [d.name, d])
);

/**
 * Code items plus the current data items. A live binding: `replaceDataItems` swaps the whole map, so
 * read it at the moment of use and do not keep it across a swap. `ITEM_DEFS` stays code-only.
 */
export let ITEMS_BY_NAME: ReadonlyMap<string, ItemShared> = CODE_ITEMS_BY_NAME;

export function findItem(name: string): ItemShared | undefined {
  return ITEMS_BY_NAME.get(name);
}

const CODE_NAMEN_KLEIN: ReadonlySet<string> = new Set([...CODE_ITEMS_BY_NAME.keys()].map((n) => n.toLowerCase()));

/** True if `name` is a code item (incl. clothing and set parts). Code items always win over data items. */
export function istCodeItem(name: string): boolean {
  return CODE_ITEMS_BY_NAME.has(name);
}

/** True if a code item has this name apart from upper/lower case (`MESSER` next to `Messer`); such names are confusable. */
export function istCodeItemOhneSchreibung(name: string): boolean {
  return CODE_NAMEN_KLEIN.has(name.toLowerCase());
}

let grundItems: readonly ItemShared[] = [];

/** Registers the base items (called by `gegenstandsDaten.ts` once); `replaceDataItems` keeps them in every state. */
export function setzeGrundItems(liste: readonly ItemShared[]): void {
  grundItems = liste;
}

/**
 * Replaces the WHOLE data-item state (entries left out are gone afterwards, the base stock excepted). Atomic: the new map is built
 * and checked first, the reference is swapped last, so a throw halfway leaves the old state untouched.
 * Throws on a name that is already a code item or appears twice; the caller sanitises first
 * (gegenstandsDaten.ts), this is the last line of defence.
 */
export function replaceDataItems(liste: readonly ItemShared[]): void {
  const neu = new Map<string, ItemShared>(CODE_ITEMS_BY_NAME);
  // The base stock is never part of what is replaced: it stands unless an entry of `liste` has the same name.
  for (const g of grundItems) neu.set(g.name, g);
  const daten = new Set<string>();
  for (const item of liste) {
    const name = item.name;
    if (CODE_NAMEN_KLEIN.has(name.toLowerCase())) throw new Error(`[items] data item "${name}" collides with a code item (ignoring case)`);
    if (daten.has(name.toLowerCase())) throw new Error(`[items] data item "${name}" appears twice (ignoring case)`);
    daten.add(name.toLowerCase());
    neu.set(name, item);
  }
  ITEMS_BY_NAME = neu;
}


/**
 * Essbares (Taste F): maxHP-Bonus und Wirkdauer — stark vereinfachtes
 * Nahrungsmodell des Vorbilds (ein Slot statt drei, dazu 1 HP/s Regeneration).
 */
export const ESSEN: Record<string, { bonus: number; dauerSec: number }> = {
  CookedMeat: { bonus: 30, dauerSec: 480 },
  NeckTail: { bonus: 15, dauerSec: 300 },
  Blueberries: { bonus: 12, dauerSec: 300 },
  Carrot: { bonus: 12, dauerSec: 300 },
  Mushroom: { bonus: 10, dauerSec: 300 },
  Raspberry: { bonus: 8, dauerSec: 240 },
};
