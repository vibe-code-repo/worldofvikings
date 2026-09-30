/**
 * The view a module under `katalog/` has of the class `GegenstandsKatalog`.
 *
 * A function that used to be a method of the class receives the instance as
 * its first parameter, named `k`, and reads `k.vorhanden` where the method
 * read `this.vorhanden`. `k` is typed as `KatalogKontext<'vorhanden' | …>`:
 * only the members the module really uses. `Pick` on the class and not a
 * copy, because `k` IS the instance: a field written through `k` is the
 * field of the instance, and a field read is never a stale copy.
 *
 * This file is the only one under `katalog/` that names the class, and only
 * as a type: the import is erased at build time, so no import cycle arises
 * at run time and the class is still loaded only through `editorMain.ts`.
 * `Pick` reaches only members that are not `private`; a member that a
 * context names loses the modifier in the class.
 */

import type { GegenstandsKatalog } from '../GegenstandsKatalog';

/** The members of `GegenstandsKatalog` a module names as its context. `K` are keys of the class (public ones). */
export type KatalogKontext<K extends keyof GegenstandsKatalog> = Pick<GegenstandsKatalog, K>;
