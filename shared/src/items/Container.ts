/**
 * Truhen-Inhalt (Roadmap F1) — kompakte Draht-/Speicherform des
 * VORHANDENEN Inventory-Modells (Inventory.ts/ItemData.ts), NICHT ein
 * zweites Gegenstandsmodell. Ein Container ist einfach eine kleinere
 * Inventory-Instanz; dieses Modul übersetzt sie nur in eine Zeichenkette,
 * die als String-Member auf dem Container-ZDO sitzt (s. WovServer.ts,
 * TRUHE_INHALT_MEMBER) — und damit automatisch mit der Welt gespeichert
 * UND über den vorhandenen ZDO-Sync an jeden Peer verteilt wird, der
 * dieses ZDO ohnehin schon sieht (gleiche Zonen-Reichweite wie Position,
 * `health` usw. — s. Kommentar bei TRUHE_INHALT_MEMBER).
 *
 * WARUM NICHT EINFACH Inventory.serialize()/SavedItemStack JSON (wie
 * beim Spieler-Inventar, s. WovServer.inventarSync)? Weil dieselbe
 * String-Member-Änderung bei JEDER Truhenaktion an jeden Peer im
 * Sichtradius (4 Zonen, s. WovServer.SICHT_RADIUS_ZONEN) neu rausgeht —
 * nicht nur an den, der die Truhe gerade offen hat. Ein Spieler-Inventar
 * geht dagegen nur an EINEN Peer. Named-Key-JSON
 * (`{"name":"Wood","stack":50,...}`) wäre für diesen Fall unnötig teuer;
 * Grid-Position und `equipped` sind für eine Truhe ohnehin bedeutungslos
 * (kein Ausrüsten aus der Truhe heraus, Positionen werden beim Entpacken
 * neu vergeben). Die Tupelform unten trägt nur, was eine Truhe wirklich
 * braucht: Name, Menge, Haltbarkeit, Qualität — verlustfrei, aber ohne
 * die drei überflüssigen Felder.
 *
 * GRÖSSE (nachgemessen, node -e, längster heutiger Item-Name
 * "TrophyEikthyr", Maximalwerte stack=50/durability=200/quality=1):
 *   ein Tupel ["TrophyEikthyr",50,200,1]           = 26 Byte
 *   voller 12-Slot-Container (worst case)           = 325 Byte
 * Das ist die GRÖSSTMÖGLICHE Größe dieses einen Members, nicht ein
 * Durchschnitt: addItem() (s. unten) verweigert das Einfüllen, sobald der
 * Container voll ist, die Zeichenkette kann also nie über diesen Wert
 * hinauswachsen — anders als die TerrainOp-Liste (Roadmap D9), die genau
 * daran unbegrenzt wuchs. Bei Mikes ~250.000 ZDOs wären selbst 1000 volle
 * Truhen (unrealistisch viele) 325 KB zusätzlich im Save — kein Vergleich
 * zu D9.
 */

import { Inventory, repariereStapel, unbekannteWerdenVerwahrt } from './Inventory.js';
import { findItem } from './itemDefs.js';
import type { SavedItemStack } from './ItemData.js';

/** Truhengröße — ein Wert für alle Containertypen (wood chest, Beute-
 *  Truhen, Grabtruhe …). Wie bei den Item-Werten in itemDefs.ts eine
 *  PLAUSIBLE ANNAHME (angelehnt an eine Holztruhe mit 6×2), nicht aus
 *  den Asset-Dumps verifiziert — die liegen für Container nicht vor. */
export const CONTAINER_WIDTH = 6;
export const CONTAINER_HEIGHT = 2;
export const CONTAINER_SLOTS = CONTAINER_WIDTH * CONTAINER_HEIGHT;

/** [Name, Menge, Haltbarkeit, Qualität] — s. Kopfkommentar. */
type PackedStack = [name: string, stack: number, durability: number | null, quality: number];

/** Neue, leere Truhen-Inventory (feste Größe, s. CONTAINER_WIDTH/HEIGHT). */
export function neueTruheInventory(): Inventory {
  return new Inventory(CONTAINER_WIDTH, CONTAINER_HEIGHT);
}

/** Truhen-Inhalt → kompakte Zeichenkette für den ZDO-Member. */
export function packContainer(inv: Inventory): string {
  const packed: PackedStack[] = [
    ...inv.all.map((it): PackedStack => [it.shared.name, it.stack, it.durability ?? null, it.quality]),
    // Stacks kept without a definition (item watch, start without a last good state) stay in the chest.
    ...inv.verwahrte.map((s): PackedStack => [s.name, s.stack, s.durability ?? null, s.quality]),
  ];
  return JSON.stringify(packed);
}

/**
 * Zeichenkette → Truhen-Inventory. '' (frische/geplünderte Truhe) ergibt
 * eine leere Inventory. Kaputte/fremde Daten werden NICHT geworfen,
 * sondern so weit wie möglich übernommen (gleiche Haltung wie
 * Inventory.load: unbekannte Items fallen raus statt den ganzen Ladevorgang
 * zu kippen) — eine einzelne verstümmelte Truhe darf niemals den
 * gesamten Weltload zu Fall bringen.
 */
export function unpackContainer(json: string): Inventory {
  const inv = neueTruheInventory();
  if (!json) return inv;

  let roh: unknown;
  try {
    roh = JSON.parse(json);
  } catch {
    return inv;
  }
  if (!Array.isArray(roh)) return inv;

  // Order of the list does not matter: the first CONTAINER_SLOTS usable known stacks lie in the grid (list order), everything
  // else (raw, unusable, known ones beyond the grid) is kept raw on a cell behind them. Nothing is cut, and no known
  // stack lies outside the grid, where `removeByName` and the client would miss it.
  const imRaster: SavedItemStack[] = [];
  const verwahrt: SavedItemStack[] = [];
  for (const eintrag of roh) {
    if (!Array.isArray(eintrag) || eintrag.length !== 4) continue;
    const [name, stack, durability, quality] = eintrag as unknown[];
    if (typeof name !== 'string') continue;
    const bekannt = findItem(name) !== undefined;
    if (!bekannt && !unbekannteWerdenVerwahrt()) continue; // unbekanntes Item (alter/fremder Save) — verwerfen
    const s = {
      name,
      stack: stack as number,
      // A missing durability stays missing (`null` in the list): `repariereStapel` gives a maximum only to items that have one.
      durability: (typeof durability === 'number' ? durability : undefined) as number,
      quality: typeof quality === 'number' ? quality : 1,
      gridX: 0,
      gridY: 0,
      equipped: false,
    };
    const shared = findItem(name);
    const r = shared ? repariereStapel(s, shared) : null;
    if (r?.repariert) console.warn(`[Container] unpack: ${name} repaired (stack ${String(stack)} -> ${r.stack.stack})`);
    if (r && imRaster.length < CONTAINER_SLOTS) imRaster.push(r.stack); // repaired like `load` does, so it takes the cell it will keep
    else verwahrt.push(s);
  }
  const zelle = (n: number): { gridX: number; gridY: number } => ({ gridX: n % CONTAINER_WIDTH, gridY: (n / CONTAINER_WIDTH) | 0 });
  const saved = imRaster.map((s, n) => ({ ...s, ...zelle(n) }));
  inv.load(saved);
  verwahrt.forEach((s, n) => inv.verwahreStapel({ ...s, ...zelle(imRaster.length + n) }));
  return inv;
}
