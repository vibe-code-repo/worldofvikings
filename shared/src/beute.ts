/**
 * D5 — loot on the ground: the two windows and the server messages (catalogue keys), shared so the client
 * can show a timer or an owner hint later without importing a server module.
 */
import { SERVER_MELDUNG_SCHLUESSEL_PRAEFIX } from './todTreffer.js';

/** Only the owner can pick the loot up for this long (Roadmap D5: 2 min). */
export const BEUTE_EXKLUSIV_MS = 120_000;
/**
 * Uncollected loot is destroyed after this long (counted from the kill). 5 min: 2 min for the owner plus
 * 3 min free for everybody, long enough to walk back to a corpse, short enough that the ZDO count stays
 * bounded (kills per minute × 5 at most; nothing of it is saved).
 */
export const BEUTE_LEBEN_MS = 300_000;

/** The loot belongs to another player and is still exclusive (catalogue key `beute.fremd`). */
export const SERVER_MELDUNG_BEUTE_FREMD = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}beute.fremd`;
/**
 * Something does not fit into the inventory (catalogue key `inventory.full`): loot and world items stay on the
 * ground, what a harvest or a refund cannot hand over is laid on the ground, a craft or a cooking is refused.
 */
export const SERVER_MELDUNG_INVENTAR_VOLL = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}inventory.full`;
/** A creature was defeated (catalogue key `beute.besiegt`). */
export const SERVER_MELDUNG_BESIEGT = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}beute.besiegt`;
/** Something was picked up (catalogue key `beute.aufgesammelt`). */
export const SERVER_MELDUNG_AUFGESAMMELT = `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}beute.aufgesammelt`;
