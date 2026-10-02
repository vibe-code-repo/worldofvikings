/**
 * D5 — loot on the ground with an owner, instead of straight into the killer's inventory.
 *
 * A creature that dies leaves its loot (the rolls stay `wuerfleDrop` / `ZWEIT_DROPS` in `Beute.ts`, the
 * table values are untouched) as ground ZDOs at its position. The loot belongs to the player who did the
 * most damage to the creature; for `BEUTE_EXKLUSIV_MS` only that player can pick it up, after that
 * everybody. Uncollected loot vanishes after `BEUTE_LEBEN_MS`.
 *
 * ── Interface to F8 / card k145 (saving ground items) ─────────────────
 * Every loot ZDO carries these members (the prefab is the item's own ITEM_DROP prefab, or the neutral `BeuteStueck`
 * for an item without one, `beutePrefabFuer`; the pick-up path in `handleInteract` knows loot by the marker below,
 * before the prefab flags):
 *   beute          int 1     marker: this ZDO is loot (what `istBeute` tests)
 *   beute_item     string    item name to give on pick-up (itemDefs name)
 *   beute_menge    int       amount
 *   beute_besitzer string    owner key = the `userId` of the owning peer, the same key as the `besitzer` member of
 *                            buildings ('' = free for all). NEVER sent to clients (`verdeckteMember` in WovServer.ts):
 *                            it is a player's identifier, and no client reads it.
 *   beute_frei_ab  long      epoch ms from which anybody may pick it up
 *   beute_ablauf   long      epoch ms at which the server destroys it
 *   beute_exklusiv int        1 while the exclusive window runs and the loot has an owner, 0 after (`tick` flips it, so a
 *                            client needs no clock). SENT to every client except the owner (`verdeckteMember`): for a client
 *                            that gets it, 1 means "exclusive to somebody else" and it skips the piece when aiming. No
 *                            identifier of the owner goes out in any form.
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
import {
  BEUTE_EXKLUSIV_MEMBER, BEUTE_EXKLUSIV_MS, BEUTE_LEBEN_MS, Inventory, SERVER_MELDUNG_BEUTE_FREMD, beutePrefabFuer, findItem,
} from '@wov/shared';
import { getStableHash } from '../util/Hash.js';

// The windows and the message keys live in `shared/src/beute.ts` (the client may need them); re-exported for the server.
export { BEUTE_EXKLUSIV_MS, BEUTE_LEBEN_MS, SERVER_MELDUNG_BEUTE_FREMD };
/** A damage tally of a creature that got no more hits for this long is dropped (the creature left or was despawned). */
const SCHADEN_VERFALL_MS = 600_000;

export const BEUTE_MARKE = 'beute';
export const BEUTE_ITEM = 'beute_item';
export const BEUTE_MENGE = 'beute_menge';
export const BEUTE_BESITZER = 'beute_besitzer';
export const BEUTE_FREI_AB = 'beute_frei_ab';
export const BEUTE_ABLAUF = 'beute_ablauf';
/** What a client may see of the owner (D5 N3): see `shared/src/beute.ts`. Unlike `beute_besitzer` this one IS sent (not to the owner). */
export const BEUTE_EXKLUSIV = BEUTE_EXKLUSIV_MEMBER;

interface Anteile {
  zdo: ZDO;
  /** owner key (`userId`) -> damage dealt (insertion order = first hit first, decides a tie). */
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

/**
 * Would `amount` of the item `name` fit into `inv` after `entfernen` was taken out of it? Asked on a copy, so that a craft or a
 * cooking can be refused BEFORE anything is taken. `true` for an unknown item (it gives nothing). The copy is `Inventory.kopie()`:
 * it carries the kept raw stacks and their cells too (a copy through `serialize`/`load` lost them), and the test
 * `d5-beute` [14] compares this answer with the real `removeByName` + `addItem` on random inventories, kept stacks included.
 */
export function passtNachEntnahme(inv: Inventory, entfernen: ReadonlyArray<{ item: string; menge: number }>, name: string, amount: number): boolean {
  const def = findItem(name);
  if (!def) return true;
  const probe = inv.kopie();
  for (const z of entfernen) probe.removeByName(z.item, z.menge);
  return probe.addItem(def, amount) === 0;
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

  /** Count the damage the owner key `kennung` did to `ziel` (the part that really took life off, not the overkill). */
  schaden(ziel: ZDO, kennung: string, betrag: number): void {
    if (betrag <= 0) return;
    const id = ziel.zdoid.toString();
    let a = this.anteile.get(id);
    if (!a) {
      a = { zdo: ziel, schaden: new Map(), zuletzt: 0 };
      this.anteile.set(id, a);
    }
    a.schaden.set(kennung, (a.schaden.get(kennung) ?? 0) + betrag);
    a.zuletzt = this.jetzt();
  }

  /**
   * Forget the damage tally of `ziel`: the creature went home at full health (D4), or was taken out of the game
   * without a kill. Damage dealt before does not count towards the owner of a LATER kill.
   */
  vergiss(ziel: ZDO): void {
    this.anteile.delete(ziel.zdoid.toString());
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
    return this.lege(raum, ziel.position, besitzer, beute);
  }

  /**
   * Lay pieces on the ground at `position` WITHOUT an owner (anybody may pick them up at once): what a harvest or a
   * refund could not hand over because the inventory was full. Same ZDOs, same life time, same pick-up path as loot.
   */
  legeHin(raum: ZDOManager, position: { x: number; y: number; z: number }, stuecke: BeuteStueck[]): BeuteStueck[] {
    return this.lege(raum, position, '', stuecke);
  }

  private lege(raum: ZDOManager, position: { x: number; y: number; z: number }, besitzer: string, beute: Array<BeuteStueck | null | undefined>): BeuteStueck[] {
    const jetzt = this.jetzt();
    const gelegt: BeuteStueck[] = [];
    for (const s of beute) {
      if (!s || s.amount <= 0) continue;
      const zdo = raum.createZDO(getStableHash(beutePrefabFuer(s.name)), { ...position });
      zdo.setInt(BEUTE_MARKE, 1);
      zdo.setString(BEUTE_ITEM, s.name);
      zdo.setInt(BEUTE_MENGE, s.amount);
      zdo.setString(BEUTE_BESITZER, besitzer);
      zdo.setLong(BEUTE_FREI_AB, BigInt(jetzt + BEUTE_EXKLUSIV_MS));
      zdo.setLong(BEUTE_ABLAUF, BigInt(jetzt + BEUTE_LEBEN_MS));
      if (besitzer !== '') zdo.setInt(BEUTE_EXKLUSIV, 1);
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
   * May the owner key `kennung` pick `zdo` up? Anything that is not loot: yes (the normal pick-up path decides).
   * Loot: the owner, anybody when it has no owner, anybody once the window is over. The window is read from the SAME state the
   * clients see (`beute_exklusiv`, flipped to 0 by `tick` at the first server tick at or after `beute_frei_ab`), not from the clock:
   * the server never frees a piece a client still aims past as foreign, apart from the sync of that one delta. The largest delay
   * against the clock is one server tick (1/30 s, `update()`) plus that sync.
   */
  darfAufheben(zdo: ZDO, kennung: string): boolean {
    if (!this.istBeute(zdo)) return true;
    const besitzer = zdo.getString(BEUTE_BESITZER);
    return besitzer === '' || besitzer === kennung || zdo.getInt(BEUTE_EXKLUSIV) === 0;
  }

  /**
   * What the loot ZDO `zdo` gives on pick-up, or `null` if it is not loot (the normal pick-up path goes on).
   * The caller has asked `darfAufheben` before, and takes the ZDO away only for the part that was really given
   * (`behalteRest` for the rest).
   */
  aufheben(zdo: ZDO): BeuteStueck | null {
    if (!this.istBeute(zdo)) return null;
    return { name: zdo.getString(BEUTE_ITEM), amount: zdo.getInt(BEUTE_MENGE) };
  }

  /** Only part of the loot fitted into the inventory: the ZDO stays on the ground with the rest. */
  behalteRest(zdo: ZDO, rest: number): void {
    zdo.setInt(BEUTE_MENGE, rest);
    zdo.revision.reviseData();
    zdo.dirty = true;
  }

  /** Once a second: destroy loot past its life, forget picked-up loot and stale damage tallies. */
  tick(): void {
    const jetzt = this.jetzt();
    // The window flip runs on EVERY call (30 per second), not only once a second: `darfAufheben` reads the flipped member.
    for (const s of this.stuecke.values()) {
      if (!s.zdo.destroyed && s.zdo.getInt(BEUTE_EXKLUSIV) === 1 && jetzt >= Number(s.zdo.getLong(BEUTE_FREI_AB))) {
        s.zdo.setInt(BEUTE_EXKLUSIV, 0); // the window is over: the clients aim at it again (`setMember` revises the data and marks it dirty)
      }
    }
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

  /** Takes one piece of loot off the ground for good (the item watch removing a data item): destroys its ZDO and forgets it. */
  entferne(zdo: ZDO): void {
    const id = zdo.zdoid.toString();
    const s = this.stuecke.get(id);
    this.stuecke.delete(id);
    if (!zdo.destroyed) (s?.raum ?? null)?.destroyZDO(zdo.zdoid);
  }

  /** Diagnostics and tests: pieces of loot currently tracked / creatures with a damage tally. */
  get anzahlStuecke(): number {
    return this.stuecke.size;
  }
  get anzahlAnteile(): number {
    return this.anteile.size;
  }
}
