/**
 * Sammelmodul des Dungeon-Generators 2.0 — der EINE Weg, auf dem Client und
 * Server die reine Schicht erreichen.
 * Barrel of dungeon generator 2.0 — the ONE way client and server reach the
 * pure layer.
 *
 * Warum es diese Datei gibt: `shared/package.json` hat kein `exports`-Feld und
 * `main` zeigt auf `src/index.ts`. Ein Tiefimport aus dem Client
 * (`@wov/shared/src/dungeon2/builder.js`) haenge damit an der Frage, ob der
 * Bundler die Endung `.js` auf die vorhandene `.ts` zurueckbildet — eine
 * Eigenschaft, die man beim naechsten Bundler-Wechsel still verliert. Das
 * Barrel legt die Antwort in den Quelltext.
 * Why this file exists: `shared/package.json` has no `exports` field and `main`
 * points at `src/index.ts`. A deep import from the client would depend on the
 * bundler mapping the `.js` suffix back onto the existing `.ts` — a property
 * silently lost at the next bundler change. The barrel puts the answer into the
 * source.
 *
 * Es wird in `shared/src/index.ts` als NAMENSRAUM weitergereicht
 * (`export * as dungeon2`), nicht flach. Grund: `layout.ts` exportiert Namen
 * wie `Kante`, `Tuer` und `ZELLE_M`, und der Altbestand (`dungeons.ts`,
 * `dungeonRaster.ts`) exportiert aehnliche. Bei einem flachen `export *`
 * verschweigt TypeScript einen Namenskonflikt und laesst den Namen einfach
 * weg — der Fehler zeigte sich erst an der Aufrufstelle als „gibt es nicht",
 * und die Ursache saehe nach etwas ganz anderem aus.
 * It is re-exported from `shared/src/index.ts` as a NAMESPACE
 * (`export * as dungeon2`), not flat. Reason: `layout.ts` exports names like
 * `Kante`, `Tuer` and `ZELLE_M`, and the legacy files export similar ones. On a
 * flat `export *` TypeScript stays silent about a name clash and simply drops
 * the name — the error would only surface at the call site as "does not exist".
 *
 * Diese Datei enthaelt NUR Wiederausfuhren. Sie darf nie Code bekommen: die
 * `sideEffects: false`-Zusage des Pakets haengt daran, dass ein Import hier
 * nichts ausloest (siehe `shared/package.json`).
 * This file contains re-exports ONLY. It must never gain code: the package's
 * `sideEffects: false` promise depends on an import here doing nothing.
 */
export * from './layout.js';
export * from './hashing.js';
export * from './cells.js';
export * from './validation.js';
export * from './generator.js';
export * from './themen.js';
export * from './builder.js';
export * from './decorator.js';
export * from './document.js';
