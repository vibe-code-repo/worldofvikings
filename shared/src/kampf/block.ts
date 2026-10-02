/**
 * block.ts (D3) — the one rule of holding a block, the same numbers for every caller.
 * Die eine Regel des Blockens (Halten statt Ereignisfenster).
 *
 * Pure module: no clock, no state, no server context. The time comes in as an argument (`jetzt`, ms).
 * The server (`server/src/spiel/Block.ts`) keeps the per-player state and the packets; this file only
 * decides what a held block does to a blow:
 *
 *  - Holding costs `BLOCK_HALTEN_PRO_SEK` stamina per second; at 0 the block ends.
 *  - A blow from inside the front cone (`BLOCK_KEGEL_GRAD` either side of the view) loses
 *    `BLOCK_ABSORPTION` of its damage and costs `BLOCK_TREFFER_AUSDAUER` stamina.
 *  - In the first `PARADE_FENSTER_MS` after the block began the blow is absorbed completely (parry),
 *    the stamina cost stays. The window only exists if the block before it ended at least
 *    `BLOCK_SPERRE_MS` ago: a series of clicks opens no second window.
 *  - A blow the stamina cannot pay for breaks the block: full damage, stamina 0, the block ends.
 *  - A blow from outside the cone passes through unchanged.
 *
 * Angles use the server convention of `richtungZuAngreifer`: the view points along (-sin yaw, -cos yaw).
 */

/** Share of the damage a held block absorbs (0.7 = the blow does 30 %). */
export const BLOCK_ABSORPTION = 0.7;
/** Stamina per second while the block is held. */
export const BLOCK_HALTEN_PRO_SEK = 2;
/** Stamina per blow that meets the block, parried blows included. */
export const BLOCK_TREFFER_AUSDAUER = 4;
/** Window after the block began in which a blow is absorbed completely (ms, inclusive). */
export const PARADE_FENSTER_MS = 200;
/** Half opening angle of the front cone around the view direction (degrees, inclusive). */
export const BLOCK_KEGEL_GRAD = 70;
/** Gap after a block ended before a new block gets a parry window (ms). */
export const BLOCK_SPERRE_MS = 500;

/** Server messages of the block, catalogue keys (`@key`, see `SERVER_MELDUNG_SCHLUESSEL_PRAEFIX`), de/en. */
export const SERVER_MELDUNG_GEBLOCKT = '@kampf.geblockt';
export const SERVER_MELDUNG_PARIERT = '@kampf.pariert';
export const SERVER_MELDUNG_ZU_ERSCHOEPFT = '@kampf.zu_erschoepft';

/** Is the parry window still open `jetzt`? `blockSeit` 0 = no block. */
export function paradeOffen(blockSeit: number, ohneParade: boolean, jetzt: number): boolean {
  return blockSeit > 0 && !ohneParade && jetzt - blockSeit <= PARADE_FENSTER_MS;
}

/**
 * Does a blow from `angreifer` come from inside the front cone of the victim? Unknown view (`null`,
 * NaN) or an attacker exactly on the victim: no.
 */
export function imBlockKegel(
  blickYaw: number | null | undefined,
  opfer: { x: number; z: number },
  angreifer: { x: number; z: number }
): boolean {
  if (blickYaw === null || blickYaw === undefined || !Number.isFinite(blickYaw)) return false;
  const dx = angreifer.x - opfer.x;
  const dz = angreifer.z - opfer.z;
  const abstand = Math.sqrt(dx * dx + dz * dz);
  if (!Number.isFinite(abstand) || abstand < 1e-6) return false;
  const kosinus = (-Math.sin(blickYaw) * dx - Math.cos(blickYaw) * dz) / abstand;
  return kosinus >= Math.cos((BLOCK_KEGEL_GRAD * Math.PI) / 180);
}

/** One tick of holding: the stamina after `dt` seconds and whether the block ends (stamina 0). */
export function blockHalten(wert: number, dt: number): { wert: number; endet: boolean } {
  const neu = Math.max(0, wert - BLOCK_HALTEN_PRO_SEK * Math.max(0, dt));
  return { wert: neu, endet: neu <= 0 };
}

/** The state a blow meets. */
export interface BlockStand {
  /** Start of the held block (ms), 0 = no block. */
  readonly blockSeit: number;
  /** The block began inside the lock of the one before: no parry window. */
  readonly ohneParade: boolean;
  readonly ausdauer: number;
  readonly blickYaw: number | null | undefined;
}

export type BlockArt = 'keiner' | 'geblockt' | 'pariert' | 'bruch';

export interface BlockErgebnis {
  readonly art: BlockArt;
  /** Damage after the block, before armour. */
  readonly schaden: number;
  /** Stamina after the blow. */
  readonly ausdauer: number;
  /** The block is over (stamina 0 or broken). */
  readonly endet: boolean;
}

/** What a blow of `schaden` from `angreifer` does to a victim in `stand`. */
export function blockTreffer(
  stand: BlockStand,
  opfer: { x: number; z: number },
  angreifer: { x: number; z: number },
  schaden: number,
  jetzt: number
): BlockErgebnis {
  if (!(stand.blockSeit > 0) || !imBlockKegel(stand.blickYaw, opfer, angreifer)) {
    return { art: 'keiner', schaden, ausdauer: stand.ausdauer, endet: false };
  }
  if (paradeOffen(stand.blockSeit, stand.ohneParade, jetzt)) {
    const rest = Math.max(0, stand.ausdauer - BLOCK_TREFFER_AUSDAUER);
    return { art: 'pariert', schaden: 0, ausdauer: rest, endet: rest <= 0 };
  }
  if (stand.ausdauer < BLOCK_TREFFER_AUSDAUER) {
    return { art: 'bruch', schaden, ausdauer: 0, endet: true };
  }
  const rest = stand.ausdauer - BLOCK_TREFFER_AUSDAUER;
  return { art: 'geblockt', schaden: schaden * (1 - BLOCK_ABSORPTION), ausdauer: rest, endet: rest <= 0 };
}
