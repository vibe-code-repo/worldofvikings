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

import { Inventory } from './Inventory.js';
import { findItem } from './itemDefs.js';
import type { SavedItemStack } from './ItemData.js';

/** Truhengröße — ein Wert für alle Containertypen (wood chest, Beute-
 *  Truhen, Grabtruhe …). Wie bei den Item-Werten in itemDefs.ts eine
 *  PLAUSIBLE ANNAHME (angelehnt an Valheims Holztruhe, 6×2), nicht aus
 *  den Asset-Dumps verifiziert — die liegen für Container nicht vor. */
export const CONTAINER_WIDTH = 6;
export const CONTAINER_HEIGHT = 2;
export const CONTAINER_SLOTS = CONTAINER_WIDTH * CONTAINER_HEIGHT;

/** [Name, Menge, Haltbarkeit, Qualität] — s. Kopfkommentar. */
type PackedStack = [name: string, stack: number, durability: number, quality: number];

/** Neue, leere Truhen-Inventory (feste Größe, s. CONTAINER_WIDTH/HEIGHT). */
export function neueTruheInventory(): Inventory {
  return new Inventory(CONTAINER_WIDTH, CONTAINER_HEIGHT);
}

/** Truhen-Inhalt → kompakte Zeichenkette für den ZDO-Member. */
export function packContainer(inv: Inventory): string {
  const packed: PackedStack[] = inv.all.map((it) => [
    it.shared.name,
    it.stack,
    it.durability,
    it.quality,
  ]);
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

  const saved: SavedItemStack[] = [];
  // Deckel auf CONTAINER_SLOTS: Inventory.load() ignoriert Positionen
  // ausserhalb des Rasters ohnehin nicht selbst — der Deckel hier ist die
  // Absicherung gegen manipulierte/fremde Daten mit mehr Einträgen, als
  // ein Container je legitim erreichen kann (s. Kopfkommentar).
  for (let i = 0; i < roh.length && saved.length < CONTAINER_SLOTS; i++) {
    const eintrag = roh[i];
    if (!Array.isArray(eintrag) || eintrag.length !== 4) continue;
    const [name, stack, durability, quality] = eintrag as unknown[];
    if (typeof name !== 'string' || typeof stack !== 'number' || stack <= 0) continue;
    if (!findItem(name)) continue; // unbekanntes Item (alter/fremder Save) — verwerfen
    const slot = saved.length;
    saved.push({
      name,
      stack,
      durability: typeof durability === 'number' ? durability : 0,
      quality: typeof quality === 'number' ? quality : 1,
      gridX: slot % CONTAINER_WIDTH,
      gridY: (slot / CONTAINER_WIDTH) | 0,
      equipped: false,
    });
  }
  inv.load(saved);
  return inv;
}
