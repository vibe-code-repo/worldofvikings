/**
 * "Auf Fahrt gehen" as one function without a DOM: create the hero, trade
 * him for a ticket, and survive being interrupted half-way.
 *
 * ── The half-way problem ─────────────────────────────────────────────
 * Two calls, not one: `createCharacter`, then `play`. If the second fails
 * (network, 5xx, time limit) the hero exists already, and a second click
 * that created him again would be told the name is taken — by himself.
 * The same happens when the first call reached the server and only its
 * answer got lost. So the caller keeps a `Fahrt` between clicks:
 *
 *  - `angelegt`: a hero we created and got the id of. A second click with
 *    the same wish goes straight to `play`.
 *  - `unklar`: a create call that ended without an answer. If the next try
 *    is told `name-taken`, we look at the heroes of OUR account; one that
 *    carries the name and belongs to the unclear attempt is ours.
 *
 * Nothing is retried by itself: every call here is caused by one click.
 * The wire vocabulary is the server's (`name-taken`, `name-invalid`).
 */
import type { Character, Ticket } from './account';

export interface Wunsch {
  name: string;
  figure: string;
  hairstyle: string;
  hairColor: string;
  eyeColor: string;
  classId: string;
  top: string;
  legs: string;
}

/** What the module needs from `account.ts`; the page passes the real calls. */
export interface Konto {
  createCharacter(wunsch: Wunsch): Promise<{ character: Character }>;
  characters(): Promise<{ characters: Character[] }>;
  play(id: number): Promise<Ticket>;
}

/** Memory between two clicks. One per page, created empty. */
export interface Fahrt {
  angelegt: { schluessel: string; id: number } | null;
  unklar: string | null;
}

export const neueFahrt = (): Fahrt => ({ angelegt: null, unklar: null });

/** Same wish? Name compared like the database does (case-insensitive). */
const schluesselVon = (w: Wunsch): string =>
  JSON.stringify({ ...w, name: w.name.trim().toLowerCase() });

const schluesselDes = (e: unknown): string =>
  typeof (e as { key?: unknown } | null)?.key === 'string' ? (e as { key: string }).key : '';

/** Errors that say nothing about the remembered hero: try the same id again. */
const VORUEBERGEHEND = new Set([
  'timeout',
  'network',
  'server-error',
  'not-signed-in',
  'too-many-attempts',
]);

/** The call left no answer behind: the server may or may not have acted. */
const ohneAntwort = (e: unknown): boolean => {
  const k = schluesselDes(e);
  return k === 'timeout' || k === 'network';
};

/**
 * Returns the ticket, or throws the error of the failing call. `fahrt` is
 * updated before anything can throw, so the next click sees it.
 */
export async function fahreLos(konto: Konto, fahrt: Fahrt, eingabe: Wunsch): Promise<Ticket> {
  const wunsch = { ...eingabe, name: eingabe.name.trim() };
  const schluessel = schluesselVon(wunsch);

  if (fahrt.angelegt && fahrt.angelegt.schluessel === schluessel) {
    try {
      return await konto.play(fahrt.angelegt.id);
    } catch (e) {
      // A final answer about this id (unknown, invalid, …) means the hero is
      // gone or was never ours; remembering him would repeat the same
      // refusal on every click. Transient failures keep the memory.
      if (!VORUEBERGEHEND.has(schluesselDes(e))) fahrt.angelegt = null;
      throw e;
    }
  }
  // Anything else the player changed makes it a new wish; an old hero
  // stays in the account, and nothing here deletes him.
  fahrt.angelegt = null;

  let id: number;
  try {
    id = (await konto.createCharacter(wunsch)).character.id;
  } catch (e) {
    if (ohneAntwort(e)) {
      fahrt.unklar = schluessel;
      throw e;
    }
    if (schluesselDes(e) !== 'name-taken' || fahrt.unklar !== schluessel) throw e;
    // Name taken after an attempt that left no answer: perhaps by us.
    const eigene = (await konto.characters()).characters;
    const meiner = eigene.find((c) => c.name.toLowerCase() === wunsch.name.toLowerCase());
    if (!meiner) throw e;
    id = meiner.id;
  }
  fahrt.unklar = null;
  fahrt.angelegt = { schluessel, id };
  try {
    return await konto.play(id);
  } catch (e) {
    if (!VORUEBERGEHEND.has(schluesselDes(e))) fahrt.angelegt = null;
    throw e;
  }
}
