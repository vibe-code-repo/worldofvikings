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

/**
 * The catalogue keys of the loot and inventory messages. ONE table: the constants below and the client test
 * (`client/test/beute-meldung.ts`, every key in both catalogues) read it, so a key cannot be sent and forgotten.
 */
export const BEUTE_MELDUNG_SCHLUESSEL = {
  /** The loot belongs to another player and is still exclusive. */
  fremd: 'beute.fremd',
  /** Nothing fits (pick-up, craft, cooking refused): no parameters. */
  voll: 'inventory.full',
  /** A harvest or a refund did not fit and the rest lies on the ground: parameters `item`, `rest`. */
  vollRest: 'inventory.full_rest',
  /** A creature was defeated: parameter `kreatur`. */
  besiegt: 'beute.besiegt',
  /** Picked up completely: parameters `item`, `menge`. */
  aufgesammelt: 'beute.aufgesammelt',
  /** Picked up partly, the rest stays lying there: parameters `item`, `menge`, `rest`. */
  aufgesammeltTeil: 'beute.aufgesammelt_teil',
} as const;

/** The parameters of a server message: only strings and numbers travel. */
export type MeldungsParameter = Readonly<Record<string, string | number>>;

/** Names in a message parameter that the client shows translated (creature / item name), not as sent. */
export const MELDUNG_NAMENSPARAMETER: readonly string[] = ['kreatur', 'item'];

const PARAMETER_TRENNER = '|';

/** `@key` with no parameters. */
const meldung = (schluessel: string): string => `${SERVER_MELDUNG_SCHLUESSEL_PRAEFIX}${schluessel}`;

export const SERVER_MELDUNG_BEUTE_FREMD = meldung(BEUTE_MELDUNG_SCHLUESSEL.fremd);
/** Something does not fit into the inventory: loot stays on the ground, a craft or a cooking is refused. */
export const SERVER_MELDUNG_INVENTAR_VOLL = meldung(BEUTE_MELDUNG_SCHLUESSEL.voll);

/** `@key|{"name":value,…}`: a catalogue key with parameters for its `{name}` placeholders (`zerlegeServerMeldung` reads it). */
export function serverMeldungMit(schluessel: string, parameter: MeldungsParameter): string {
  return `${meldung(schluessel)}${PARAMETER_TRENNER}${JSON.stringify(parameter)}`;
}

/** What the server says when a creature was defeated. */
export const serverMeldungBesiegt = (kreatur: string): string => serverMeldungMit(BEUTE_MELDUNG_SCHLUESSEL.besiegt, { kreatur });
/** What the server says when `menge` of `item` were picked up and `rest` (maybe 0) stayed lying there. */
export const serverMeldungAufgesammelt = (item: string, menge: number, rest: number): string =>
  rest > 0
    ? serverMeldungMit(BEUTE_MELDUNG_SCHLUESSEL.aufgesammeltTeil, { item, menge, rest })
    : serverMeldungMit(BEUTE_MELDUNG_SCHLUESSEL.aufgesammelt, { item, menge });
/** What the server says when `rest` of `item` did not fit and was laid on the ground. */
export const serverMeldungVollRest = (item: string, rest: number): string => serverMeldungMit(BEUTE_MELDUNG_SCHLUESSEL.vollRest, { item, rest });

/**
 * Splits a server message `@key` or `@key|{json}`: the key and the parameters (empty when absent or unreadable:
 * a damaged parameter part never hides the message). `null` for a plain text (no `@`).
 */
export function zerlegeServerMeldung(text: string): { schluessel: string; parameter: MeldungsParameter } | null {
  if (!text.startsWith(SERVER_MELDUNG_SCHLUESSEL_PRAEFIX)) return null;
  const trenner = text.indexOf(PARAMETER_TRENNER);
  const schluessel = text.slice(SERVER_MELDUNG_SCHLUESSEL_PRAEFIX.length, trenner < 0 ? undefined : trenner);
  const parameter: Record<string, string | number> = {};
  if (trenner >= 0) {
    try {
      const roh: unknown = JSON.parse(text.slice(trenner + 1));
      if (roh && typeof roh === 'object' && !Array.isArray(roh)) {
        for (const [name, wert] of Object.entries(roh)) {
          if (typeof wert === 'string' || (typeof wert === 'number' && Number.isFinite(wert))) parameter[name] = wert;
        }
      }
    } catch {
      /* unreadable parameters: the message is shown with its placeholders */
    }
  }
  return { schluessel, parameter };
}
