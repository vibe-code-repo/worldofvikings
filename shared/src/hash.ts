/**
 * Stable hash — 1:1 port of `get_stable_hash` from the reference server.
 *
 * This is the reference implementation's string hash (a two-accumulator djb2 variant), NOT
 * FNV-1a. It MUST match the reference server exactly, because prefab hashes,
 * RPC method hashes and ZDO member-name hashes are all derived from it.
 *
 * Reference algorithm (u32 arithmetic, characters taken in pairs):
 *
 *   num = num2 = 5381
 *   for idx = 0, 2, 4, … while idx != length:
 *     num = ((num << 5) + num) ^ str[idx]
 *     if idx + 1 == length: stop
 *     num2 = ((num2 << 5) + num2) ^ str[idx + 1]
 *   result = (Hash)(num + num2 * 1566083941)
 *
 * Verified against known reference values:
 *   get_stable_hash("PeerInfo")   == -725574882
 *   get_stable_hash("Disconnect") ==  838896224
 */

import type { Hash } from './types.js';

export function getStableHash(name: string): Hash {
  let num = 5381 >>> 0;
  let num2 = 5381 >>> 0;
  let idx = 0;
  const len = name.length;

  while (idx !== len) {
    // num = ((num << 5) + num) ^ char  →  num = num * 33 ^ char
    num = (Math.imul(num, 33) ^ name.charCodeAt(idx)) >>> 0;
    if (idx + 1 !== len) {
      num2 = (Math.imul(num2, 33) ^ name.charCodeAt(idx + 1)) >>> 0;
      idx += 2;
    } else {
      break; // processed the final odd character
    }
  }

  // static_cast<Hash>(num + num2 * 1566083941) — uint32 wrap, then int32.
  const sum = (num + (Math.imul(num2, 1566083941) >>> 0)) >>> 0;
  return sum | 0;
}

/** Hash a prefab name to its prefab hash (stable hash of the name). */
export function getPrefabHash(prefabName: string): Hash {
  return getStableHash(prefabName);
}
