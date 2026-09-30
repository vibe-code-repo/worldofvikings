/**
 * D5 — loot on the ground with an owner, instead of straight into the killer's inventory.
 *
 * A creature that dies leaves its loot (the rolls stay `wuerfleDrop` / `ZWEIT_DROPS` in `Beute.ts`, the
 * table values are untouched) as ground ZDOs at its position. The loot belongs to the player who did the
 * most damage to the creature; for `BEUTE_EXKLUSIV_MS` only that player can pick it up, after that
 * everybody. Uncollected loot vanishes after `BEUTE_LEBEN_MS`.
 *
 * ── Interface to F8 / card k145 (saving ground items) ─────────────────
 * Every loot ZDO carries these members (the prefab is the item's own ITEM_DROP prefab, so the existing
 * pick-up path `F.PICKABLE | F.ITEM_DROP` in `handleInteract` picks it up):
 *   beute          int 1     marker: this ZDO is loot (what `istBeute` tests)
 *   beute_item     string    item name to give on pick-up (itemDefs name)
 *   beute_menge    int       amount
 *   beute_besitzer string    `spielerId` of the owner ('' = free for all)
 *   beute_frei_ab  long      epoch ms from which anybody may pick it up
 *   beute_ablauf   long      epoch ms at which the server destroys it
 * The world save (`momentaufnahme`) leaves marked ZDOs out, and `WeltZdoSicherung` only takes containers
 * and building pieces, so loot is never written: after a restart it is gone (a loss, which is allowed),
 * never doubled (a picked-up item is in the inventory, which F8 saves at once).
 * A later save of ground items (k145) would store exactly these members and must restore the clocks
 * relative to the restart.
 *
 * This file imports no value from `../WovServer.ts` (test `i1t-beute-waffe`).
 */
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import { getStableHash } from '../util/Hash.js';

/** Only the owner can pick the loot up for this long (Roadmap D5: 2 min). */
export const BEUTE_EXKLUSIV_MS = 120_000;
/**
 * Uncollected loot is destroyed after this long (counted from the kill). 5 min: 2 min for the owner plus
 * 3 min free for everybody, long enough to walk back to a corpse, short enough that the ZDO count stays
 * bounded (kills per minute × 5 at most; nothing of it is saved).
 */
export const BEUTE_LEBEN_MS = 300_000;
/** A damage tally of a creature that got no more hits for this long is dropped (the creature left or was despawned). */
const SCHADEN_VERFALL_MS = 600_000;

export const BEUTE_MARKE = 'beute';
export const BEUTE_ITEM = 'beute_item';
export const BEUTE_MENGE = 'beute_menge';
export const BEUTE_BESITZER = 'beute_besitzer';
export const BEUTE_FREI_AB = 'beute_frei_ab';
export const BEUTE_ABLAUF = 'beute_ablauf';

/** Catalogue key `beute.fremd` (client/src/i18n/katalog), sent as `@` + key. */
export const SERVER_MELDUNG_BEUTE_FREMD = '@beute.fremd';

interface Anteile {
  zdo: ZDO;
  /** spielerId -> damage dealt (insertion order = first hit first, decides a tie). */
  schaden: Map<string, number>;
  zuletzt: number;
}

interface Stueck {
  zdo: ZDO;
  raum: ZDOManager;
}

export interface BeuteStueck {
  name: string;
  amount: number;
}

export class BeuteAmBoden {
  private readonly anteile = new Map<string, Anteile>();
  private readonly stuecke = new Map<string, Stueck>();
  /** Test hook: how far the loot clock is wound forward (`vorspulen`). */
  private versatzMs = 0;
  private letzterTick = 0;

  /** The loot clock: wall clock plus the wound-forward offset. */
  jetzt(): number {
    return Date.now() + this.versatzMs;
  }

  /** Test hook: move the loot clock forward (2 min exclusive / 5 min life without waiting). */
  vorspulen(ms: number): void {
    this.versatzMs += ms;
  }

  /** Count the damage `spielerId` did to `ziel` (the part that really took life off, not the overkill). */
  schaden(ziel: ZDO, spielerId: string, betrag: number): void {
    if (betrag <= 0) return;
    const id = ziel.zdoid.toString();
    let a = this.anteile.get(id);
    if (!a) {
      a = { zdo: ziel, schaden: new Map(), zuletzt: 0 };
      this.anteile.set(id, a);
    }
    a.schaden.set(spielerId, (a.schaden.get(spielerId) ?? 0) + betrag);
    a.zuletzt = this.jetzt();
  }

  /** The owner of the loot of `ziel`: the most damage wins, the first to hit wins a tie; '' if nobody counted. */
  besitzer(ziel: ZDO): string {
    const a = this.anteile.get(ziel.zdoid.toString());
    let best = '';
    let bestWert = 0;
    for (const [id, wert] of a?.schaden ?? []) {
      if (wert > bestWert) {
        best = id;
        bestWert = wert;
      }
    }
    return best;
  }

  /**
   * The creature `ziel` died: lay its loot (the rolled `beute` and the second drop) on the ground at its
   * position, in the same ZDO space. Returns the pieces laid. Forgets the creature's damage tally.
   */
  legeAb(raum: ZDOManager, ziel: ZDO, beute: Array<BeuteStueck | null | undefined>): BeuteStueck[] {
    const besitzer = this.besitzer(ziel);
    this.anteile.delete(ziel.zdoid.toString());
    const jetzt = this.jetzt();
    const gelegt: BeuteStueck[] = [];
    for (const s of beute) {
      if (!s || s.amount <= 0) continue;
      const zdo = raum.createZDO(getStableHash(s.name), { ...ziel.position });
      zdo.setInt(BEUTE_MARKE, 1);
      zdo.setString(BEUTE_ITEM, s.name);
      zdo.setInt(BEUTE_MENGE, s.amount);
      zdo.setString(BEUTE_BESITZER, besitzer);
      zdo.setLong(BEUTE_FREI_AB, BigInt(jetzt + BEUTE_EXKLUSIV_MS));
      zdo.setLong(BEUTE_ABLAUF, BigInt(jetzt + BEUTE_LEBEN_MS));
      zdo.revision.reviseData();
      zdo.dirty = true;
      this.stuecke.set(zdo.zdoid.toString(), { zdo, raum });
      gelegt.push({ name: s.name, amount: s.amount });
    }
    return gelegt;
  }

  /** Is this ZDO loot on the ground? (the world save leaves these out) */
  istBeute(zdo: ZDO): boolean {
    return zdo.getInt(BEUTE_MARKE) === 1;
  }

  /**
   * `spielerId` wants to pick `zdo` up. `null`: not loot (the normal pick-up path goes on); `'fremd'`:
   * it is somebody else's and still exclusive; else what the ZDO gives (the caller destroys it).
   */
  aufheben(zdo: ZDO, spielerId: string): BeuteStueck | 'fremd' | null {
    if (!this.istBeute(zdo)) return null;
    const besitzer = zdo.getString(BEUTE_BESITZER);
    if (besitzer !== '' && besitzer !== spielerId && this.jetzt() < Number(zdo.getLong(BEUTE_FREI_AB))) return 'fremd';
    return { name: zdo.getString(BEUTE_ITEM), amount: zdo.getInt(BEUTE_MENGE) };
  }

  /** Once a second: destroy loot past its life, forget picked-up loot and stale damage tallies. */
  tick(): void {
    const jetzt = this.jetzt();
    if (jetzt - this.letzterTick < 1000 && jetzt >= this.letzterTick) return;
    this.letzterTick = jetzt;
    for (const [id, s] of this.stuecke) {
      if (s.zdo.destroyed) {
        this.stuecke.delete(id);
      } else if (jetzt >= Number(s.zdo.getLong(BEUTE_ABLAUF))) {
        s.raum.destroyZDO(s.zdo.zdoid);
        this.stuecke.delete(id);
      }
    }
    for (const [id, a] of this.anteile) {
      if (a.zdo.destroyed || jetzt - a.zuletzt > SCHADEN_VERFALL_MS) this.anteile.delete(id);
    }
  }

  /** Diagnostics and tests: pieces of loot currently tracked / creatures with a damage tally. */
  get anzahlStuecke(): number {
    return this.stuecke.size;
  }
  get anzahlAnteile(): number {
    return this.anteile.size;
  }
}
