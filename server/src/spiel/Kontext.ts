/**
 * Kontext.ts (I1 step 0) — the narrow view a module under `server/src/spiel/` has of the server.
 * Grundlage für das Aufteilen von `WovServer.ts`; noch ohne Nutzer, Schritt 1 bis 10 legen die Module an.
 *
 * A module that used to be a block of methods of `WovServer` receives the server as its first
 * parameter, named `k`, and reads `k.zdos` where the method read `this.zdos`. `k` is typed as a
 * `SpielKontext<'zdos' | 'config' | …>`: only the members the module really uses.
 *
 * Why `Pick` on the class and not a copy: `k` IS the server (the call is `handleAttack(this, peer, r)`),
 * so `k.worldTime += x` writes the field of the server and a field read is never a stale copy. An
 * object built from snapshots or getters would break exactly that.
 *
 * Rules (plan I1 section 4 and 7):
 *  - One `SpielKontext<…>` per module, named in the module, with the member count in the PR text.
 *    Above about 25 members the module is split in two, the context is not widened.
 *  - Modules import THIS file, never `WovServer.ts` (no import cycle). This file is the only one that
 *    names the class, and only as a type: the import is erased at build time.
 *  - `Pick` reaches only members that are not `private`. A step that needs a private member relaxes
 *    it to public in `WovServer.ts` in the same pull request; the forwarding (same name, same
 *    signature) stays, so the tests that reach it by name keep working. The name list in
 *    `server/test/i1-oberflaeche.ts` names those members.
 *  - Fields stay in the class even when only one module uses them (tests reach `savedPlayers`,
 *    `layoutWache`, `speichertGerade`, … by name).
 *
 * Der TypeScript-Prüfer bewacht diese Datei: nennt ein `SpielKontext<'x'>` einen Namen, der im Server
 * fehlt oder `private` ist, bricht `npm run typecheck`. `KontextGrundlage` unten ist der Zeuge dafür.
 */
import type { WovServer } from '../WovServer.js';

/** The members of `WovServer` a module names as its context. `K` are keys of the server class (public ones). */
export type SpielKontext<K extends keyof WovServer> = Pick<WovServer, K>;

/**
 * Witness that the pattern compiles against the real class: the members every module of the plan
 * needs and that are public today (`config`, `zdos`, `prefabs`, `net`, `welten`, `adminCommands`,
 * `dungeons`, `getGroundHeight`). Not used by production code; if one of these leaves the public
 * surface of `WovServer`, the type checker says so here first.
 */
export type KontextGrundlage = SpielKontext<
  'config' | 'zdos' | 'prefabs' | 'net' | 'welten' | 'adminCommands' | 'dungeons' | 'getGroundHeight'
>;
