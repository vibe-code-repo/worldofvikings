/**
 * Stable hash — 1:1 port of `get_stable_hash` from Valhalla2.0 `Hashes.h`.
 *
 * This is Valheim's own string hash (a two-accumulator djb2 variant), NOT
 * FNV-1a. It MUST match the C++ server exactly, because prefab hashes,
 * RPC method hashes and ZDO member-name hashes are all derived from it.
 *
 * C++ reference (library/include/Hashes.h):
 *
 *   constexpr Hash get_stable_hash(string_view str, u32 num, u32 num2, u32 idx) {
 *     if (idx != str.length()) {
 *       num = ((num << 5) + num) ^ (u32)str[idx];
 *       if (idx + 1 != str.length()) {
 *         num2 = ((num2 << 5) + num2) ^ (u32)str[idx + 1];
 *         idx += 2;
 *         return get_stable_hash(str, num, num2, idx);
 *       }
 *     }
 *     return static_cast<Hash>(num + num2 * 1566083941);
 *   }
 *   constexpr Hash get_stable_hash(string_view str) {
 *     u32 num = 5381, num2 = num, idx = 0;
 *     return get_stable_hash(str, num, num2, idx);
 *   }
 *
 * Verified against library/test/crypto/src/CryptoTest.cpp:
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
