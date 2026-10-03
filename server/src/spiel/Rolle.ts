/**
 * Rolle.ts (D3-K4) — the server state of the dodge roll and the bill of the jump.
 * Der Serverzustand der Ausweichrolle und die Abrechnung des Sprungs.
 *
 * The rule itself (numbers, locks, free room, slices of movement) is `@wov/shared/src/kampf/rolle.ts`; this file
 * keeps the per-player state on the `Peer` and sends the packets and messages. No server context: the functions take
 * the `Peer` (or the part of it they use) and the time, so a test needs no server. `WovServer.ts` only forwards:
 * `handleRolle`, `rolleTakt` and `sprungKosten` in `handlePlayerInput`, `rolleUnverwundbar` in `applyCreatureAttack`,
 * `rolleLaeuft` in `handleAttack`, `rolleZuruecksetzen` in `stirb`, `belebeNeu` and the change of world.
 */
import { PacketType } from '@wov/shared';
import {
  ROLLE_AUSDAUER,
  ROLLE_ABKLINGZEIT_MS,
  ROLLE_DAUER_MS,
  ROLLE_AUS_ABGELEHNT,
  ROLLE_AUS_BEENDET,
  SERVER_MELDUNG_AUSGEWICHEN,
  SERVER_MELDUNG_ROLLE_BLOCKIERT,
  SERVER_MELDUNG_ROLLE_ZU_ERSCHOEPFT,
  rolleAblehnung,
  rolleFreiraumOk,
  rolleLaeuft as rolleLaeuftRegel,
  rolleRichtung,
  rolleScheibe,
  rolleUnverwundbar as rolleUnverwundbarRegel,
  sprungAbrechnen,
  type RolleAblehnung,
} from '@wov/shared/src/kampf/rolle.js';
import type { Peer } from '../net/Peer.js';
import { neuerRolleWeg, type RolleWeg } from '../world/Spielerbewegung.js';
import { beendeBlockDurchRolle, blockAbrechnen, type BlockPeer } from './Block.js';

/** The part of a `Peer` the roll reads and writes. */
export type RollePeer = BlockPeer &
  Pick<Peer, 'rolleStart' | 'rolleBis' | 'rolleZeit' | 'rolleX' | 'rolleZ' | 'rolleSperreBis' | 'sprungSperreBis' | 'rolleWeg' | 'rolleNr'>;

/** What the caller knows and the module does not. */
export interface RolleUmfeld {
  /** The player is in the water (Oberwelt: below the water line). */
  readonly imWasser: boolean;
  /**
   * Simulates the path of the roll in direction (x, z) with the shared movement step and returns the metres the
   * figure covers, or null when the world has no collision at the server (dungeon band): then the check is skipped.
   */
  readonly freiraum: ((x: number, z: number) => number) | null;
}

function meldung(peer: Pick<Peer, 'sendPacketWith'>, text: string): void {
  peer.sendPacketWith(PacketType.InteractResult, (w) => {
    w.writeBool(true);
    w.writeString(text);
    w.writeString('');
    w.writeInt32(0);
  });
}

/** Tell the client that the roll was refused or ended by the server. */
function meldeRolleAus(peer: Pick<Peer, 'sendPacketWith'>, grund: number, nr: number): void {
  peer.sendPacketWith(PacketType.Rolle, (w) => {
    w.writeBool(false);
    w.writeUInt8(grund); // refused (free, roll again at once) or ended (the lock stays)
    w.writeInt32(nr); // the roll number of the client's request
  });
}

function lehneAb(peer: RollePeer, grund: RolleAblehnung | 'platz', nr: number): false {
  if (grund === 'ausdauer') meldung(peer, SERVER_MELDUNG_ROLLE_ZU_ERSCHOEPFT);
  else if (grund === 'platz') meldung(peer, SERVER_MELDUNG_ROLLE_BLOCKIERT);
  meldeRolleAus(peer, ROLLE_AUS_ABGELEHNT, nr);
  return false;
}

/** Is a roll running `jetzt`? Safe on a peer without the fields (a stand-in of another test): no roll. */
export function rolleLaeuft(peer: Pick<Peer, 'rolleBis'>, jetzt: number): boolean {
  return rolleLaeuftRegel(peer.rolleBis ?? 0, jetzt);
}

/** Is the player invulnerable `jetzt` (the whole clip)? */
export function rolleUnverwundbar(peer: Pick<Peer, 'rolleStart' | 'rolleBis'>, jetzt: number): boolean {
  return rolleUnverwundbarRegel(peer.rolleStart ?? 0, peer.rolleBis ?? 0, jetzt);
}

/** A blow met the invulnerable player: say so (one message per blow). */
export function rolleWeicheAus(peer: Pick<Peer, 'sendPacketWith'>): void {
  meldung(peer, SERVER_MELDUNG_AUSGEWICHEN);
}

/**
 * `PacketType.Rolle`: the client wants to roll along `yaw`. Returns whether the roll began. A refused roll costs
 * nothing, the client is told (`Rolle` false) and gets a message where the reason is one the player can change.
 */
export function rollePaket(peer: RollePeer, yaw: number, jetzt: number, umfeld: RolleUmfeld, nr = 0): boolean {
  // The block held so far is paid before the stamina is read.
  blockAbrechnen(peer, jetzt);
  const grund = rolleAblehnung(
    {
      tot: peer.totBis > 0,
      flug: peer.flying,
      imWasser: umfeld.imWasser,
      rolleBis: peer.rolleBis,
      rolleSperreBis: peer.rolleSperreBis,
      ausdauer: peer.stamina,
      yaw,
    },
    jetzt
  );
  if (grund !== null) return lehneAb(peer, grund, nr);
  const richtung = rolleRichtung(yaw);
  if (umfeld.freiraum && !rolleFreiraumOk(umfeld.freiraum(richtung.x, richtung.z))) return lehneAb(peer, 'platz', nr);

  peer.stamina -= ROLLE_AUSDAUER;
  peer.staminaZuletztVerbraucht = jetzt;
  beendeBlockDurchRolle(peer, jetzt);
  peer.rolleNr = nr;
  peer.rolleStart = jetzt;
  peer.rolleZeit = jetzt;
  peer.rolleBis = jetzt + ROLLE_DAUER_MS;
  peer.rolleX = richtung.x;
  peer.rolleZ = richtung.z;
  peer.rolleSperreBis = peer.rolleBis + ROLLE_ABKLINGZEIT_MS;
  peer.rolleWeg = neuerRolleWeg(); // one path state (step grid and slope memory) for the whole roll, like the preview
  return true;
}

/** What the input packet does with the roll of this tick. */
export type RolleTakt =
  | { readonly rollt: false; readonly x: number; readonly z: number; readonly dt: number }
  | {
      /** The roll drives the figure now (the packet's WASD is ignored). */
      readonly rollt: true;
      readonly x: number;
      readonly z: number;
      /** Seconds of roll movement to apply in this tick. */
      readonly dt: number;
      /** The path state of this roll: the same step grid and one slope memory as the preview of the free-room check. */
      readonly weg: RolleWeg;
    };

const KEINE_ROLLE: RolleTakt = { rollt: false, x: 0, z: 0, dt: 0 };

/**
 * One input packet: the slice of the roll since the last one. The path is a function of the TIME the roll ran, not
 * of the number of packets: a packet after the end of the movement still gets the remainder, and none after that.
 */
export function rolleTakt(peer: Pick<Peer, 'rolleStart' | 'rolleBis' | 'rolleZeit' | 'rolleX' | 'rolleZ' | 'rolleWeg'>, jetzt: number): RolleTakt {
  if (!(peer.rolleBis > 0) || !peer.rolleWeg) return KEINE_ROLLE;
  const scheibe = rolleScheibe(peer.rolleStart, peer.rolleZeit, jetzt);
  peer.rolleZeit = scheibe.bis;
  if (scheibe.dt <= 0 && !rolleLaeuftRegel(peer.rolleBis, jetzt)) return KEINE_ROLLE;
  return { rollt: true, x: peer.rolleX, z: peer.rolleZ, dt: scheibe.dt, weg: peer.rolleWeg };
}

type RolleEndePeer = Pick<Peer, 'rolleStart' | 'rolleBis' | 'rolleZeit' | 'rolleWeg' | 'rolleNr' | 'sendPacketWith'>;

/**
 * Ends the roll that is running and forgets its path; the locks (roll, jump) stay. For a teleport, the world change and
 * the flight: a roll must not go on from the new place, but a teleport must not free the cooldown either. The client is
 * told (`Rolle=false`) only when a roll really ran at `jetzt` (a roll long over gets no message).
 */
export function rolleBeenden(peer: RolleEndePeer, jetzt: number = Date.now()): void {
  const lief = rolleLaeuftRegel(peer.rolleBis ?? 0, jetzt);
  peer.rolleStart = 0;
  peer.rolleBis = 0;
  peer.rolleZeit = 0;
  peer.rolleWeg = null;
  if (lief) meldeRolleAus(peer, ROLLE_AUS_BEENDET, peer.rolleNr ?? 0);
}

/** Death and revival: no roll and no lock (the player starts afresh). A roll that ran is announced to the client. */
export function rolleZuruecksetzen(peer: RolleEndePeer & Pick<Peer, 'rolleSperreBis' | 'sprungSperreBis'>, jetzt: number = Date.now()): void {
  rolleBeenden(peer, jetzt);
  peer.rolleSperreBis = 0;
  peer.sprungSperreBis = 0;
}

/**
 * The jump flag of one input packet: a billed jump costs stamina and locks the next one. The server has no jump
 * physics (it cannot stop a jump, only bill it), so this counts what the client reports. During a roll a jump flag
 * is not billed: the client sends none there (`SprungMeldung.erlaubt`), so a flag in a roll is no jump.
 */
export function sprungKosten(peer: Pick<Peer, 'stamina' | 'staminaZuletztVerbraucht' | 'sprungSperreBis' | 'rolleBis'>, jumping: boolean, jetzt: number): boolean {
  if (!jumping || rolleLaeuft(peer, jetzt)) return false;
  const nach = sprungAbrechnen(peer.stamina, peer.sprungSperreBis ?? 0, jetzt);
  if (!nach.bezahlt) return false;
  peer.stamina = nach.ausdauer;
  peer.staminaZuletztVerbraucht = jetzt;
  peer.sprungSperreBis = nach.sperreBis;
  return true;
}
