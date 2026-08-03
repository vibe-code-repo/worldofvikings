/**
 * PrefabManager — registry of all prefab definitions.
 * 1:1 port of PrefabManager.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class IPrefabManager {
 *     Map<Hash, Prefab> m_prefabsByHash;
 *     Map<string, Prefab> m_prefabsByName;
 *     ...
 *   };
 *
 * Prefab data is loaded from prefabs.pkg (compressed package).
 */

import type { Hash } from '@wov/shared';
import { PREFAB_DEFS } from '@wov/shared';
import { Prefab } from './Prefab.js';
import { getStableHash } from '../util/Hash.js';

export class PrefabManager {
  private prefabsByHash: Map<Hash, Prefab> = new Map();
  private prefabsByName: Map<string, Prefab> = new Map();

  /** Register a prefab definition. */
  register(prefab: Prefab): void {
    this.prefabsByHash.set(prefab.hash, prefab);
    this.prefabsByName.set(prefab.name, prefab);
  }

  /** Get prefab by hash. */
  getByHash(hash: Hash): Prefab | undefined {
    return this.prefabsByHash.get(hash);
  }

  /** Get prefab by name. */
  getByName(name: string): Prefab | undefined {
    return this.prefabsByName.get(name);
  }

  /** Get prefab by name, computing hash on the fly. */
  getByComputedHash(name: string): Prefab | undefined {
    return this.prefabsByHash.get(getStableHash(name));
  }

  /** Check if a prefab exists. */
  has(hash: Hash): boolean {
    return this.prefabsByHash.has(hash);
  }

  /** Get all registered prefabs. */
  getAll(): Prefab[] {
    return [...this.prefabsByHash.values()];
  }

  get count(): number {
    return this.prefabsByHash.size;
  }

  /**
   * Load prefabs from a parsed JSON array.
   * Expected format: Array<{ name, localScale, flags, randomSpawn? }>
   */
  loadFromJSON(data: Array<Record<string, unknown>>): void {
    for (const entry of data) {
      const prefab = Prefab.fromJSON(entry);
      this.register(prefab);
    }
    console.log(`[PrefabManager] Loaded ${this.count} prefabs`);
  }

  /**
   * Register all prefabs from the shared prefab registry
   * (single source of truth shared with the client).
   */
  registerDefaults(): void {
    for (const p of PREFAB_DEFS) {
      this.register(new Prefab(p.name, p.localScale, p.flags));
    }

    console.log(`[PrefabManager] Registered ${this.count} prefabs from shared registry`);
  }
}
