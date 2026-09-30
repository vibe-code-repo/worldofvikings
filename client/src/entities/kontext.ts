/**
 * The view a module next to EntityManager.ts has of the class.
 *
 * A function that used to be a method of `EntityManager` receives the instance
 * as its first parameter, named `k`, and reads `k.zellen` where the method read
 * `this.zellen`. `k` is typed as `EntityKontext<'zellen' | …>`: only the
 * members the module really uses. `Pick` on the class and not a copy, because
 * `k` IS the instance: a field written through `k` is the field of the
 * instance, and a field read is never a stale copy.
 *
 * This file is the only one among the modules that names the class, and only
 * as a type: the import is erased at build time, so no import cycle arises at
 * run time. `Pick` reaches only members that are not `private`; a member that
 * a context names loses the modifier in the class.
 */

import type { EntityManager } from './EntityManager';

/** The members of `EntityManager` a module names as its context. `K` are keys of the class (public ones). */
export type EntityKontext<K extends keyof EntityManager> = Pick<EntityManager, K>;
