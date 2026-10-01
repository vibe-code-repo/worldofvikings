/**
 * Who holds how many copies of an item: live inventories, saved players (also those in the accounts SQLite,
 * which the server keeps in `savedPlayers`), chests. Counting and removing for the item watch (game card G2).
 * Wer wie viele Exemplare eines Gegenstands hält: Zählen und endgültiges Entfernen für die Gegenstands-Wache.
 *
 * Pure over what the caller hands in (no import of `WovServer.ts`). Removal works by NAME only, never through
 * `findItem`, because at that point the definition may already be gone (a chest string would lose an unknown
 * name silently when unpacked, so it is edited as text here).
 */
import { TRUHE_INHALT_MEMBER, mengeGueltig } from '@wov/shared';
import { BEUTE_ITEM, BEUTE_MARKE, BEUTE_MENGE } from './BeuteAmBoden.js';
import type { Inventory } from '@wov/shared';
import type { SavedPlayer } from '../world/WorldManager.js';
import type { ZDO } from '../zdo/ZDO.js';

export interface OnlineHalter {
  spielerId: string;
  name: string;
  inventar: Inventory;
}

export interface BestandsQuellen {
  /** Players with a live inventory (the live inventory is the truth for them). */
  online(): Iterable<OnlineHalter>;
  /** `savedPlayers` of the server. */
  gespeichert(): Iterable<SavedPlayer>;
  /** All ZDOs of all worlds (chests are found by their content member). */
  zdos(): Iterable<ZDO>;
  /** Takes a piece of loot on the ground off for good (`BeuteAmBoden.entferne`). */
  beuteEntfernen?(zdo: ZDO): void;
}

/** The item and amount of a piece of loot on the ground (a ZDO with the loot mark), else `null`. */
function beuteStueck(zdo: ZDO): { name: string; menge: number } | null {
  if (zdo.getInt(BEUTE_MARKE) !== 1) return null;
  return { name: zdo.getString(BEUTE_ITEM), menge: zdo.getInt(BEUTE_MENGE) };
}

/** The content string of a chest as tuples `[name, stack, durability, quality]`; `null` if it is not readable. */
function truhenTupel(text: string): unknown[] | null {
  if (text === '') return null;
  try {
    const roh: unknown = JSON.parse(text);
    return Array.isArray(roh) ? roh : null;
  } catch {
    return null;
  }
}

const istOnline = (p: SavedPlayer, online: readonly OnlineHalter[]): boolean =>
  online.some((o) => (p.spielerId !== undefined ? o.spielerId === p.spielerId : o.name === p.name));

/** Copies of each of `ids` that are held; only ids with more than 0 appear. */
export function zaehleGehalten(q: BestandsQuellen, ids: ReadonlySet<string>): Record<string, number> {
  const summe = new Map<string, number>();
  const zaehle = (name: unknown, menge: unknown): void => {
    if (typeof name !== 'string' || !ids.has(name)) return;
    if (!mengeGueltig(menge)) return; // a dead row (amount 0, NaN, text) holds nothing and asks for no confirmation
    const n = menge;
    summe.set(name, (summe.get(name) ?? 0) + n);
  };
  const online = [...q.online()];
  for (const o of online) {
    for (const it of o.inventar.all) zaehle(it.shared.name, it.stack);
    for (const s of o.inventar.verwahrte) zaehle(s.name, s.stack);
  }
  for (const p of q.gespeichert()) {
    if (istOnline(p, online)) continue; // the live copy counts, not its older saved twin
    for (const s of p.inventar ?? []) zaehle(s?.name, s?.stack);
  }
  for (const zdo of q.zdos()) {
    const boden = beuteStueck(zdo);
    if (boden) zaehle(boden.name, boden.menge); // loot on the ground is held too
    const tupel = truhenTupel(zdo.getString(TRUHE_INHALT_MEMBER));
    if (!tupel) continue;
    for (const t of tupel) if (Array.isArray(t)) zaehle(t[0], t[1]);
  }
  return Object.fromEntries([...summe].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Names that are held but are not known (`istBekannt`): what a working copy lost that nobody
 * can name any more (start without a usable last good state). `istBekannt` says which names do not count as unknown
 * (a definition exists or the file about to be applied defines it). Only names with more than 0 copies appear.
 */
export function zaehleUnbekannteGehalten(q: BestandsQuellen, istBekannt: (name: string) => boolean): Record<string, number> {
  const summe = new Map<string, number>();
  const zaehle = (name: unknown, menge: unknown): void => {
    if (typeof name !== 'string' || istBekannt(name)) return;
    if (!mengeGueltig(menge)) return; // a dead row (amount 0, NaN, text) holds nothing and asks for no confirmation
    const n = menge;
    summe.set(name, (summe.get(name) ?? 0) + n);
  };
  const online = [...q.online()];
  for (const o of online) for (const s of o.inventar.verwahrte) zaehle(s.name, s.stack);
  for (const p of q.gespeichert()) {
    if (istOnline(p, online)) continue;
    for (const s of p.inventar ?? []) zaehle(s?.name, s?.stack);
  }
  for (const zdo of q.zdos()) {
    const boden = beuteStueck(zdo);
    if (boden) zaehle(boden.name, boden.menge); // loot on the ground is held too
    const tupel = truhenTupel(zdo.getString(TRUHE_INHALT_MEMBER));
    if (!tupel) continue;
    for (const t of tupel) if (Array.isArray(t)) zaehle(t[0], t[1]);
  }
  return Object.fromEntries([...summe].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface EntferntStand {
  /** Stacks removed from live inventories. */
  lebend: number;
  /** Saved players that were changed (the caller writes them to the accounts SQLite). */
  gespeichert: SavedPlayer[];
  /** Chests that were changed. */
  truhen: ZDO[];
  /** Pieces of loot taken off the ground. */
  beute: number;
}

/**
 * Removes every copy of `ids` for good: live inventories, saved players (also online ones' saved twins), chests.
 * `stempel` gives the new save stamp of a changed saved player (`gespeichertAm`).
 */
export function entferneGehalten(q: BestandsQuellen, ids: ReadonlySet<string>, stempel: () => number): EntferntStand {
  const ergebnis: EntferntStand = { lebend: 0, gespeichert: [], truhen: [], beute: 0 };
  for (const o of q.online()) {
    ergebnis.lebend += o.inventar.verwahrteEntfernen(ids);
    for (const it of [...o.inventar.all]) {
      if (!ids.has(it.shared.name)) continue;
      o.inventar.removeItem(it);
      ergebnis.lebend++;
    }
  }
  for (const p of q.gespeichert()) {
    const vorher = p.inventar;
    if (!vorher) continue;
    const rest = vorher.filter((s) => !ids.has(s?.name));
    const waffeWeg = p.waffe !== undefined && ids.has(p.waffe);
    if (rest.length === vorher.length && !waffeWeg) continue;
    p.inventar = rest;
    if (waffeWeg) p.waffe = undefined;
    p.gespeichertAm = stempel();
    ergebnis.gespeichert.push(p);
  }
  for (const zdo of [...q.zdos()]) {
    const boden = beuteStueck(zdo);
    if (boden && ids.has(boden.name)) {
      q.beuteEntfernen?.(zdo);
      ergebnis.beute++;
      continue;
    }
    const tupel = truhenTupel(zdo.getString(TRUHE_INHALT_MEMBER));
    if (!tupel) continue;
    const rest = tupel.filter((t) => !(Array.isArray(t) && typeof t[0] === 'string' && ids.has(t[0])));
    if (rest.length === tupel.length) continue;
    zdo.setString(TRUHE_INHALT_MEMBER, JSON.stringify(rest));
    zdo.revision.reviseData();
    zdo.dirty = true;
    ergebnis.truhen.push(zdo);
  }
  return ergebnis;
}
