/**
 * Item definitions. Values marked "verified" come from the MonoBehaviour dumps
 * under the local asset export — the rest are plausible
 * placeholders for fields nothing reads yet.
 *
 * Asset names are checked against assets/: sprites are lower_snake_case,
 * models are the PascalCase prefab name.
 */

import { ItemType, type ItemShared } from './ItemData.js';
import { istEigenesModell } from '../prefabs.js';

/**
 * `Hammer.glb` is a 248-byte stub with zero meshes — the real geometry sits in
 * `Hammer_0.glb`. Same trap as the Boar/Greydwarf models (see prefabs.ts).
 * Noted here because the hammer will be added once build pieces exist.
 */

/**
 * Der Rohbestand. Ausgeliefert wird `ITEM_DEFS` weiter unten — dort wird
 * jedes `model` gegen die Whitelist `EIGENE_MODELLE` (prefabs.ts) geprüft.
 */
const ITEM_DEFS_ROH: readonly ItemShared[] = [
  {
    // Sax — das wikingerzeitliche Allzweckmesser. Kein Fund aus dem
    // Fremdbestand, sondern eigens gebaut (tools/messer-erzeugen.py),
    // und der erste Gegenstand mit eigenem Modell UND eigenem Symbol.
    // Das Symbol ist ein Render desselben Modells — so koennen Bild und
    // Gegenstand nicht auseinanderlaufen.
    name: 'Messer',
    label: 'Sax (Messer)',
    itemType: ItemType.Tool,
    icon: 'messer',
    model: 'Messer',
    maxStackSize: 1,
    weight: 0.6,
    toolTier: 0,
    // Haltung GEMESSEN, nicht geschaetzt — anders als bei den uebrigen
    // Eintraegen (s. Kommentar an holdPosition in ItemData.ts).
    //
    // In Blender an den Knochen gesetzt und gerendert
    // (tools/messer-in-hand.py): Griff 0,02 Modelleinheiten aus der
    // Handflaeche, 0,075 zu den Knoecheln, Klinge hochkant. Das mal 1,8,
    // weil holdPosition in echten Metern zaehlt: handR traegt
    // 1/modellSkalierung, die Weltskalierung am Huellknoten ist also 1.
    //
    // Dass die Achsen zwischen Blender und Babylon UEBERHAUPT gleich
    // liegen, ist nachgemessen (tools/out/achsen-messen.mjs), nicht
    // angenommen — der glTF-Export darf Knochen mitdrehen:
    //   Handknoten +Y  → zu den Fingern   (Blender: ebenso)
    //   Handknoten +Z  → zum Koerper hin  (Blender: ebenso)
    //   Klinge bei Drehung null → -Z
    // Daraus folgt rotation.x = +PI/2 (Klinge zu den Fingern) und
    // rotation.z = +PI/2 (Schneide nach vorn; Babylon wendet Z zuerst
    // an, also im Modellrahmen um die Klingenachse).
    holdPosition: [0.036, 0.135, 0],
    holdRotation: [1.5708, 0, 1.5708],
    maxDurability: 120,
    useDurabilityDrain: 1,
    attackStamina: 3,
  },
  {
    // verified: $item_hoe, m_itemType 19, maxDurability 200, drain 1, stamina 5
    name: 'Hoe',
    label: 'Hacke (Hoe)',
    itemType: ItemType.Tool,
    icon: 'hoe',
    model: 'Hoe',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Hoe',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    // verified: $item_cultivator, tool with a piece table
    name: 'Cultivator',
    label: 'Pflug',
    itemType: ItemType.Tool,
    // There is no cultivator.png in the rip — only the bronze/iron variants.
    icon: 'cultivator_bronze',
    model: 'Cultivator',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Cultivator',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    // verified: $item_pickaxe_antler, m_itemType 14, no piece table,
    // m_spawnOnHitTerrain -> digg_v3. Digs through the attack path, not build
    // mode — that is why it has no piece table.
    name: 'PickaxeAntler',
    label: 'Geweihspitzhacke',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'pickaxe_antler',
    model: 'PickaxeAntler',
    maxStackSize: 1,
    weight: 3,
    spawnOnHitTerrain: 'digg',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 4,
  },
  {
    // Kopfnotiz oben: Hammer.glb ist ein 248-Byte-Stub — Hammer_0.glb traegt
    // die echte Geometrie. Jetzt eingeloest: der Hammer baut (pieceTable).
    name: 'Hammer',
    label: 'Hammer',
    itemType: ItemType.Tool,
    icon: 'hammer',
    model: 'Hammer_0',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Hammer',
    toolTier: 0,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    name: 'Wood',
    label: 'Holz',
    itemType: ItemType.Material,
    icon: 'wood',
    model: 'Wood',
    maxStackSize: 50,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'Stone',
    label: 'Stein',
    itemType: ItemType.Material,
    icon: 'stone',
    model: 'Stone',
    maxStackSize: 50,
    weight: 2,
    toolTier: 0,
  },
  // ── Phase-5-Nachzügler: Materialien für Loot, Pickups und Crafting.
  // Nur Items mit vorhandenem Sprite (assets/sprites, snake_case geprüft).
  {
    name: 'Flint',
    label: 'Feuerstein',
    itemType: ItemType.Material,
    icon: 'flint',
    model: 'Flint',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Resin',
    label: 'Harz',
    itemType: ItemType.Material,
    icon: 'resin',
    model: 'Resin',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Raspberry',
    label: 'Himbeeren',
    itemType: ItemType.Material,
    icon: 'raspberry',
    model: 'Raspberry',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Blueberries',
    label: 'Blaubeeren',
    itemType: ItemType.Material,
    icon: 'blueberries',
    model: 'Blueberries',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Mushroom',
    label: 'Pilz',
    itemType: ItemType.Material,
    icon: 'mushroom',
    model: 'Mushroom',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Thistle',
    label: 'Distel',
    itemType: ItemType.Material,
    icon: 'thistle',
    model: 'Thistle',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Dandelion',
    label: 'Löwenzahn',
    itemType: ItemType.Material,
    icon: 'dandelion',
    model: 'Dandelion',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Carrot',
    label: 'Karotte',
    itemType: ItemType.Material,
    icon: 'carrot',
    model: 'Carrot',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'RawMeat',
    label: 'Rohes Fleisch',
    itemType: ItemType.Material,
    icon: 'raw_meat',
    model: 'RawMeat',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Entrails',
    label: 'Gedärme',
    itemType: ItemType.Material,
    icon: 'entrails',
    model: 'Entrails',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Coins',
    label: 'Münzen',
    itemType: ItemType.Material,
    icon: 'coins',
    model: 'Coins',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Amber',
    label: 'Bernstein',
    itemType: ItemType.Material,
    icon: 'amber',
    model: 'Amber',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'NeckTail',
    label: 'Neck-Schwanz',
    itemType: ItemType.Material,
    icon: 'necktail',
    model: 'NeckTail',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'TrophyDeer',
    label: 'Hirschtrophäe',
    itemType: ItemType.Material,
    icon: 'TrophyDeer',
    model: 'TrophyDeer',
    maxStackSize: 10,
    weight: 1.5,
    toolTier: 0,
  },
  {
    name: 'CookedMeat',
    label: 'Gebratenes Fleisch',
    itemType: ItemType.Material,
    icon: 'necktailgrilled',
    model: 'CookedMeat',
    maxStackSize: 20,
    weight: 1,
    toolTier: 0,
  },
  {
    // Einfache Nahkampfwaffe — Rezept: 6 Holz an keiner Station.
    name: 'Club',
    label: 'Keule',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'club',
    model: 'Club',
    maxStackSize: 1,
    weight: 2,
    toolTier: 0,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 6,
  },
  {
    name: 'HardAntler',
    label: 'Hartes Geweih',
    itemType: ItemType.Material,
    icon: 'HardAntler',
    model: 'HardAntler',
    maxStackSize: 20,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'TrophyEikthyr',
    label: 'Eikthyr-Trophäe',
    itemType: ItemType.Material,
    icon: 'TrophyEikthyr',
    model: 'Eikthyr_Trophy',
    maxStackSize: 5,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'AxeFlint',
    label: 'Feuersteinaxt',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'axe_flint',
    model: 'AxeFlint',
    maxStackSize: 1,
    weight: 2.5,
    toolTier: 1,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 8,
  },
  {
    // Das Nordschwert (10.09.2026) — erstes Schwert im Spiel, damit sich
    // der Schwerthieb des Wikingers mit einer Klinge in der Hand pruefen
    // laesst. Modell: die Wikingerklinge aus dem Waffensatz des privaten
    // Speichers (SwordNorth.glb), so vorbereitet, dass die Parierstange
    // im Ursprung liegt und die Klinge entlang +Y zeigt.
    //
    // Haltung: Der Handknoten des Wikingers zeigt mit +Y zu den Fingern
    // (Bone-Achse, so gebaut). Klinge entlang +Y heisst also Klinge in
    // Verlaengerung des Unterarms — Drehung null. holdPosition schiebt
    // den Griff 8 cm vom Handgelenk in die Handflaeche. In Blender an
    // Hand_R gesetzt und gerendert (tools-Kontrolle vom 10.09.), nicht
    // gegen Babylon nachgemessen: Kante und Griffsitz sind Augenmass.
    name: 'SwordNorth',
    label: 'Nordschwert',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'sword_north',
    model: 'SwordNorth',
    maxStackSize: 1,
    weight: 2,
    toolTier: 1,
    holdPosition: [0, 0.08, 0],
    holdRotation: [0, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 10,
  },
];

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
const KLEIDUNG: ItemShared[] = [
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
  },
];

/**
 * Die ausgelieferten Gegenstände — Rohbestand mit geprüftem `model`.
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
  const liste = [...ITEM_DEFS_ROH, ...KLEIDUNG].map((d) => {
    if (d.model === null || istEigenesModell(d.model)) return d;
    ohneModell++;
    return { ...d, model: null };
  });
  if (ohneModell > 0) {
    console.warn(
      `[items] ${ohneModell} von ${ITEM_DEFS_ROH.length + KLEIDUNG.length} Eintraegen ohne eigenes Modell uebersprungen (Symbol bleibt)`
    );
  }
  return liste;
}

export const ITEMS_BY_NAME: ReadonlyMap<string, ItemShared> = new Map(
  ITEM_DEFS.map((d) => [d.name, d])
);

export function findItem(name: string): ItemShared | undefined {
  return ITEMS_BY_NAME.get(name);
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
