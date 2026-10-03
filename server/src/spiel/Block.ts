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
import { BLOCK_SPERRE_MS, SERVER_MELDUNG_GEBLOCKT, SERVER_MELDUNG_PARIERT, SERVER_MELDUNG_ZU_ERSCHOEPFT, blockHalten, blockTreffer as blockTrefferRegel, type BlockErgebnis } from '@wov/shared/src/kampf/block.js';
import { PacketType } from '@wov/shared';
import type { Peer } from '../net/Peer.js';

/** The part of a `Peer` the block reads and writes. */
export type BlockPeer = Pick<
  Peer,
  | 'blockSeit' | 'blockSperreBis' | 'blockOhneParade' | 'blockTaktZeit' | 'stamina' | 'staminaZuletztVerbraucht'
  | 'waffe' | 'flying' | 'totBis' | 'blickYaw' | 'position' | 'sendPacketWith'
>;

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

/** Death, change of world: no block and no lock. */
export function blockZuruecksetzen(peer: Pick<Peer, 'blockSeit' | 'blockSperreBis' | 'blockOhneParade' | 'blockTaktZeit'>): void {
  peer.blockSeit = 0;
  peer.blockTaktZeit = 0;
  peer.blockSperreBis = 0;
  peer.blockOhneParade = false;
}

/** The block ends because the server says so: the client is told. */
function beendeDurchServer(peer: BlockPeer, jetzt: number): void {
  if (beendeBlock(peer, jetzt)) meldeBlockAus(peer);
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
  if (peer.totBis > 0 || peer.flying || !darfBlocken(peer)) return meldeBlockAus(peer);
  if (peer.stamina <= 0) {
    meldung(peer, SERVER_MELDUNG_ZU_ERSCHOEPFT);
    return meldeBlockAus(peer);
  }
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
export function blockAbrechnen(peer: BlockPeer, jetzt: number): boolean {
  if (!(peer.blockSeit > 0)) return false;
  if (peer.flying || !darfBlocken(peer)) {
    beendeDurchServer(peer, jetzt);
    return false;
  }
  const gehalten = Math.max(0, (jetzt - (peer.blockTaktZeit > 0 ? peer.blockTaktZeit : peer.blockSeit)) / 1000);
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
export function blockHalteTakt(peer: BlockPeer, jetzt: number): boolean {
  return blockAbrechnen(peer, jetzt);
}

/** The server tick: every holding player is billed, also one whose client sends nothing. */
export function blockTakt(peers: Iterable<BlockPeer>, jetzt: number): void {
  for (const p of peers) if (p.blockSeit > 0) blockAbrechnen(p, jetzt);
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
