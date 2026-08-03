/**
 * Stable hash functions.
 * Delegates to the shared 1:1 port of `get_stable_hash` from Hashes.h
 * (Valhalla2.0 C++), so client and server always agree on hashes.
 *
 * C++ reference: library/include/Hashes.h
 *   avledet::util::get_stable_hash(std::string_view) -> Hash (int32)
 */

import type { Hash } from '@wov/shared';
import { getStableHash, getPrefabHash } from '@wov/shared';

export { getStableHash, getPrefabHash };

/**
 * Combine two hashes (for composite keys).
 */
export function combineHash(a: Hash, b: Hash): Hash {
  let hash = a | 0;
  hash = Math.imul(hash ^ (b >>> 0), 16777619);
  return hash | 0;
}
