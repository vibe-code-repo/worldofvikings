/**
 * D5 — the places of loot on the ground that the E key can aim at.
 *
 * `ITEM_DROP` prefabs are dynamic entities: the entity manager creates their scene node only after the model has
 * loaded (or failed), and `naechstesInteragierbares` only walks the static buckets. Loot was therefore never a
 * target of E (found on DEV 02.10.2026: "E does nothing"). This list is filled from the ZDO update itself, before
 * any model is asked for, so a piece of loot is aimable at once, with or without its model.
 */

export interface BeuteZiel {
  prefab: string;
  prefabHash: number;
  x: number;
  y: number;
  z: number;
}

export class BeuteZiele {
  private readonly stuecke = new Map<string, BeuteZiel>();

  /** A loot ZDO was seen or moved. */
  merke(key: string, ziel: BeuteZiel): void {
    this.stuecke.set(key, ziel);
  }

  /** The ZDO is gone (picked up, expired, out of range). */
  vergiss(key: string): void {
    this.stuecke.delete(key);
  }

  get anzahl(): number {
    return this.stuecke.size;
  }

  /** The nearest piece strictly closer than `sqrt(maxD2)` (horizontal distance), with its squared distance; `null` if none. */
  naechste(x: number, z: number, maxD2: number): { ziel: BeuteZiel; d2: number } | null {
    let best: { ziel: BeuteZiel; d2: number } | null = null;
    let bestD = maxD2;
    for (const s of this.stuecke.values()) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { ziel: s, d2: d };
      }
    }
    return best;
  }
}
