/**
 * The shape of a message catalogue.
 *
 * `de.ts` is the source of truth: every key that exists there must exist in
 * every other catalogue, and no other key may. `Messages` is what enforces
 * that — `en.ts` is annotated with it, so a missing or surplus key is a
 * compile error in `npm run check` and nowhere else. A JSON file could not
 * do this; that is the whole reason the catalogue is TypeScript.
 *
 * Only a *type* import of `de` is used here. TypeScript erases it when
 * building, so there is no runtime import cycle between de.ts and types.ts.
 */
import type { de } from './de';

export type MessageKey = keyof typeof de;

export type Messages = Record<MessageKey, string>;
