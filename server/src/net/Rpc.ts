/**
 * RPC system — hash-based method registry.
 * 1:1 port of Rpc.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   template<class T>
 *   class RpcBase {
 *     Map<Hash, unique_ptr<IMethod<T>>> m_methods;
 *     register_method(name, func);
 *     internal_invoke(handle, hash, reader);
 *   };
 */

import type { Hash } from '@wov/shared';
import { getStableHash } from '../util/Hash.js';
import { Reader } from '../io/Reader.js';
import type { Peer } from '../net/Peer.js';

export type RpcHandler = (peer: Peer, reader: Reader) => void;

export class RpcRegistry {
  private methods: Map<Hash, RpcHandler> = new Map();

  /** Register an RPC method by name (computes stable hash). */
  register(name: string, handler: RpcHandler): void {
    const hash = getStableHash(name);
    this.methods.set(hash, handler);
  }

  /** Register an RPC method by pre-computed hash. */
  registerByHash(hash: Hash, handler: RpcHandler): void {
    this.methods.set(hash, handler);
  }

  /** Invoke an RPC method. Returns true if the method was found. */
  invoke(peer: Peer, hash: Hash, reader: Reader): boolean {
    const handler = this.methods.get(hash);
    if (!handler) {
      console.warn(`[RPC] Unknown method hash: ${hash}`);
      return false;
    }
    handler(peer, reader);
    return true;
  }

  has(hash: Hash): boolean {
    return this.methods.has(hash);
  }

  get size(): number {
    return this.methods.size;
  }
}
