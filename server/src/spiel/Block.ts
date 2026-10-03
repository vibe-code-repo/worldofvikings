/**
 * Block.ts (D3) — the server state of a held block.
 * Der Serverzustand des gehaltenen Blocks: Beginn, Halten, Treffer, Ende.
 *
 * The rule itself (numbers, cone, parry window) is `@wov/shared/src/kampf/block.ts`; this file keeps
 * the per-player state on the `Peer` and sends the packets and messages. No server context: the
 * functions take the `Peer` (or the part of it they use) and the time, so a test needs no server.
 * `WovServer.ts` only forwards: `handleBlock`, the hold tick in `handlePlayerInput`, `blockTrifft`
 * in `applyCreatureAttack`, `beendeBlockDurchSchlag` in `handleAttack`, `blockZuruecksetzen` in `stirb`.
 */
import { BLOCK_BEGINN_AUSDAUER, BLOCK_SPERRE_MS, SERVER_MELDUNG_GEBLOCKT, SERVER_MELDUNG_PARIERT, SERVER_MELDUNG_ZU_ERSCHOEPFT, blockHalten, blockTreffer as blockTrefferRegel, type BlockErgebnis } from '@wov/shared/src/kampf/block.js';
import { PacketType } from '@wov/shared';
import { rolleLaeuft } from '@wov/shared/src/kampf/rolle.js';
import type { Peer } from '../net/Peer.js';

/** A server stall longer than this (ms since its last tick) is not billed to a blocking player beyond it. */
export const BLOCK_LUECKE_MS = 2000;

/** The part of a `Peer` the block reads and writes. */
export type BlockPeer = Pick<
  Peer,
  | 'blockSeit' | 'blockSperreBis' | 'blockOhneParade' | 'blockTaktZeit' | 'stamina' | 'staminaZuletztVerbraucht'
  | 'waffe' | 'flying' | 'totBis' | 'blickYaw' | 'position' | 'sendPacketWith'
> & Partial<Pick<Peer, 'rolleBis'>>;

/**
 * May this player block at all? PROVISIONAL (open question: block with bare hands?): only with
 * an item in the hand, the fist does not. The one place to change if the answer is different.
 */
export function darfBlocken(peer: Pick<Peer, 'waffe'>): boolean {
  return peer.waffe !== '';
}

function meldung(peer: Pick<Peer, 'sendPacketWith'>, text: string): void {
  peer.sendPacketWith(PacketType.InteractResult, (w) => {
    w.writeBool(true);
    w.writeString(text);
    w.writeString('');
    w.writeInt32(0);
  });
}

/** Tell the client that the SERVER ended (or refused) the block. */
function meldeBlockAus(peer: Pick<Peer, 'sendPacketWith'>): void {
  peer.sendPacketWith(PacketType.Block, (w) => {
    w.writeBool(false);
  });
}

/** Ends a held block and starts the lock against parry windows. Returns whether a block was held. */
export function beendeBlock(peer: Pick<Peer, 'blockSeit' | 'blockSperreBis' | 'blockOhneParade' | 'blockTaktZeit'>, jetzt: number): boolean {
  if (!(peer.blockSeit > 0)) return false;
  peer.blockSeit = 0;
  peer.blockTaktZeit = 0;
  peer.blockOhneParade = false;
  peer.blockSperreBis = jetzt + BLOCK_SPERRE_MS;
  return true;
}

/**
 * Death, change of world, revival: no block and no lock. A block that was held is announced to the client
 * (`Block` false), so its pose and its slow walk end with it. Every way in which the SERVER ends a block runs
 * through here or through `beendeDurchServer`; only the client's own "off" is silent.
 */
export function blockZuruecksetzen(peer: Pick<Peer, 'blockSeit' | 'blockSperreBis' | 'blockOhneParade' | 'blockTaktZeit' | 'sendPacketWith'>): void {
  const warBlock = peer.blockSeit > 0;
  peer.blockSeit = 0;
  peer.blockTaktZeit = 0;
  peer.blockSperreBis = 0;
  peer.blockOhneParade = false;
  if (warBlock) meldeBlockAus(peer);
}

/** The block ends because the server says so: the client is told. */
function beendeDurchServer(peer: BlockPeer, jetzt: number): void {
  if (beendeBlock(peer, jetzt)) meldeBlockAus(peer);
}

/** An accepted roll ends his block (D3-K4); the client is told like for a swing. */
export function beendeBlockDurchRolle(peer: BlockPeer, jetzt: number): void {
  beendeDurchServer(peer, jetzt);
}

/** An accepted swing of the player ends his block. */
export function beendeBlockDurchSchlag(peer: BlockPeer, jetzt: number): void {
  beendeDurchServer(peer, jetzt);
}

/** `PacketType.Block`: `an` = button held, false = released. */
export function blockPaket(peer: BlockPeer, an: boolean, jetzt: number): void {
  if (!an) {
    beendeBlock(peer, jetzt);
    return;
  }
  if (peer.blockSeit > 0) return; // already held: no restart, no new window
  if (rolleLaeuft(peer.rolleBis ?? 0, jetzt)) return meldeBlockAus(peer); // D3-K4: no block during a roll
  if (peer.totBis > 0 || peer.flying || !darfBlocken(peer)) return meldeBlockAus(peer);
  if (peer.stamina < BLOCK_BEGINN_AUSDAUER) {
    meldung(peer, SERVER_MELDUNG_ZU_ERSCHOEPFT);
    return meldeBlockAus(peer);
  }
  peer.stamina -= BLOCK_BEGINN_AUSDAUER; // every begin costs, the parry window included
  peer.staminaZuletztVerbraucht = jetzt;
  peer.blockSeit = jetzt;
  peer.blockTaktZeit = jetzt;
  peer.blockOhneParade = jetzt < peer.blockSperreBis;
}

/**
 * Bills the block for the SERVER time since the last billing (`blockTaktZeit`), with no cap: a client that
 * sends no input for 30 s pays 60 stamina, not a clamped slice. Also ends a block that may no longer be held
 * (flight mode, nothing in the hand, stamina 0) and keeps the stamina from regenerating. Called from every input
 * packet, from the server tick and before every blow. Returns whether the player blocks afterwards.
 */
export function blockAbrechnen(peer: BlockPeer, jetzt: number, luecke = 0): boolean {
  if (!(peer.blockSeit > 0)) return false;
  if (peer.flying || !darfBlocken(peer)) {
    beendeDurchServer(peer, jetzt);
    return false;
  }
  // A stall of the SERVER (`luecke` = ms since its last tick, normally ~50) is not the player's doing: what exceeds
  // BLOCK_LUECKE_MS is not billed. A silent client is billed by every tick, so its gaps stay small: no discount.
  const erlass = Math.max(0, luecke - BLOCK_LUECKE_MS);
  const gehalten = Math.max(0, (jetzt - (peer.blockTaktZeit > 0 ? peer.blockTaktZeit : peer.blockSeit) - erlass) / 1000);
  peer.blockTaktZeit = jetzt;
  const nach = blockHalten(peer.stamina, gehalten);
  peer.stamina = nach.wert;
  if (gehalten > 0) peer.staminaZuletztVerbraucht = jetzt;
  if (nach.endet) {
    beendeDurchServer(peer, jetzt);
    return false;
  }
  return true;
}

/** One input packet: bill the block. Returns whether the player blocks (slow movement, no running). */
export function blockHalteTakt(peer: BlockPeer, jetzt: number, luecke = 0): boolean {
  return blockAbrechnen(peer, jetzt, luecke);
}

/** The server tick: every holding player is billed, also one whose client sends nothing. */
export function blockTakt(peers: Iterable<BlockPeer>, jetzt: number, luecke = 0): void {
  for (const p of peers) if (p.blockSeit > 0) blockAbrechnen(p, jetzt, luecke);
}

/**
 * A blow from `angreifer` of `schaden` meets the player. Returns what the caller goes on with
 * (damage after the block, before armour); the stamina, the end of the block and the messages are done here.
 */
export function blockTrifft(peer: BlockPeer, angreifer: { x: number; z: number }, schaden: number, jetzt: number): BlockErgebnis {
  blockAbrechnen(peer, jetzt); // the time held so far is paid BEFORE the blow is rated
  const erg = blockTrefferRegel(
    { blockSeit: peer.blockSeit, ohneParade: peer.blockOhneParade, ausdauer: peer.stamina, blickYaw: peer.blickYaw },
    peer.position,
    angreifer,
    schaden,
    jetzt
  );
  if (erg.art === 'keiner') return erg;
  if (peer.stamina !== erg.ausdauer) {
    peer.stamina = erg.ausdauer;
    peer.staminaZuletztVerbraucht = jetzt;
  }
  meldung(peer, erg.art === 'pariert' ? SERVER_MELDUNG_PARIERT : erg.art === 'geblockt' ? SERVER_MELDUNG_GEBLOCKT : SERVER_MELDUNG_ZU_ERSCHOEPFT);
  if (erg.endet) beendeDurchServer(peer, jetzt);
  return erg;
}
