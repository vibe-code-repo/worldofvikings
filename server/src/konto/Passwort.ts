/**
 * Password storage for accounts.
 *
 * scrypt from node:crypto, deliberately: it is memory-hard, it ships with
 * Node, and it needs no native build step. argon2id would be a shade
 * better but is a compiled dependency, and this server currently has four
 * runtime dependencies in total (ws, yaml, tsx, @wov/shared). That budget
 * is worth keeping.
 *
 * The stored string carries its own parameters:
 *
 *   scrypt$N$r$p$<salt base64url>$<hash base64url>
 *
 * Reading the cost out of the record rather than a constant is what makes
 * it raisable later: when N goes up, old records keep verifying with the
 * cost they were written with, and each one can be rewritten on the next
 * successful login. A hard-coded constant would force every account to be
 * reset instead.
 *
 * Related: Identitaet.ts holds the session tokens. This module only ever
 * answers "does this password belong to this record" -- it knows nothing
 * about accounts, sessions or players.
 */
import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify loses the overload that takes options, so the signature is
// spelled out here. Without it TypeScript sees the three-argument form
// and rejects the cost parameters.
const scryptAsync = promisify(scrypt) as (
  passwort: string,
  salz: Buffer,
  laenge: number,
  optionen: ScryptOptions,
) => Promise<Buffer>;

/**
 * Cost parameters for NEW passwords. N must be a power of two.
 *
 * N=2^15 with r=8 needs roughly 32 MB and about 60-100 ms on this server.
 * That is the point of the exercise: an attacker who steals the database
 * pays the same price per guess. maxmem has to be raised explicitly,
 * because Node's default of 32 MB is exactly at the limit and throws.
 */
const N = 32768;
const R = 8;
const P = 1;
const SCHLUESSEL_BYTES = 32;
const SALZ_BYTES = 16;
const MAXMEM = 128 * 1024 * 1024;

/** Hash a new password. Returns the complete record to be stored. */
export async function passwortEinlagern(passwort: string): Promise<string> {
  const salz = randomBytes(SALZ_BYTES);
  const hash = await scryptAsync(passwort.normalize('NFKC'), salz, SCHLUESSEL_BYTES, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return [
    'scrypt', N, R, P,
    salz.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/**
 * Check a password against a stored record.
 *
 * Returns false for anything unparseable rather than throwing: a damaged
 * row must not be distinguishable from a wrong password from the outside,
 * and it must not take the login endpoint down either.
 */
export async function passwortPruefen(passwort: string, eintrag: string): Promise<boolean> {
  const teile = eintrag.split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return false;

  const n = Number(teile[1]);
  const r = Number(teile[2]);
  const p = Number(teile[3]);
  // Guard the cost read from the record: a manipulated row must not be
  // able to turn this into an out-of-memory or a several-minute stall.
  if (!Number.isInteger(n) || n < 2 || n > 1 << 20 || (n & (n - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 16) return false;

  let salz: Buffer;
  let erwartet: Buffer;
  try {
    salz = Buffer.from(teile[4]!, 'base64url');
    erwartet = Buffer.from(teile[5]!, 'base64url');
  } catch {
    return false;
  }
  if (salz.length === 0 || erwartet.length === 0) return false;

  let berechnet: Buffer;
  try {
    berechnet = await scryptAsync(passwort.normalize('NFKC'), salz, erwartet.length, {
      N: n, r, p, maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  // Same length by construction (we asked for erwartet.length), so
  // timingSafeEqual cannot throw here.
  return timingSafeEqual(berechnet, erwartet);
}

/**
 * Same record format as `passwortEinlagern`, but SYNCHRONOUS.
 *
 * The one caller is `StandardKonto.ts`: it runs from the `WovServer`
 * constructor, which cannot be `async` (it is called as `new WovServer()`
 * all over `main.ts`, `createWovServer()` and every test). scrypt has a
 * synchronous sibling for exactly this — a few tens of milliseconds during
 * startup, once, is a fair trade for not turning server construction into
 * a promise everywhere it happens today.
 */
export function passwortEinlagernSync(passwort: string): string {
  const salz = randomBytes(SALZ_BYTES);
  const hash = scryptSync(passwort.normalize('NFKC'), salz, SCHLUESSEL_BYTES, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return [
    'scrypt', N, R, P,
    salz.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/**
 * Was this record written with weaker parameters than we use today?
 *
 * Call it after a SUCCESSFUL login -- that is the only moment the plain
 * password is available to write a stronger record with.
 */
export function veraltet(eintrag: string): boolean {
  const teile = eintrag.split('$');
  if (teile.length !== 6 || teile[0] !== 'scrypt') return true;
  return Number(teile[1]) < N || Number(teile[2]) < R;
}
