/**
 * Who may write the animation members of a ZDO.
 *
 * Three systems write `anim`: the SpawnSystem (animals), the RoutenLaeufer
 * (route walkers) and the AggroSystem (fighting NPCs). The route walker and
 * the aggro system hand one NPC to each other on purpose (`gesperrt`) — they
 * are ONE side, `npc`. The SpawnSystem is the other side, `kreatur`, and must
 * never share a ZDO with them: two writers on one member flip the state back
 * and forth (measured: 27 changes in 6 s), and nothing would say why.
 *
 * Until now that exclusivity hung on a single `entlasse()` call in the
 * server. This makes it a rule the writers state themselves: whoever takes a
 * ZDO first owns it, and a claim from the other side FAILS with a message
 * naming both — at registration, not as a twitch in the game.
 */

import type { ZDO } from '../zdo/ZDO.js';

export type AnimSeite = 'kreatur' | 'npc';

/** The other side already owns this ZDO. */
export class AnimKonflikt extends Error {
  constructor(
    readonly zdo: string,
    readonly besitzer: AnimSeite,
    readonly anspruch: AnimSeite
  ) {
    super(
      `ZDO ${zdo}: the animation members are written by '${besitzer}' and '${anspruch}' — ` +
        `two writers on one ZDO make the state flip; release it from '${besitzer}' first`
    );
    this.name = 'AnimKonflikt';
  }
}

// Keyed by the ZDO object: a destroyed ZDO takes its entry with it.
const besitz = new WeakMap<ZDO, AnimSeite>();

/** Claim a ZDO for a side. Idempotent for the same side; throws for the other. */
export function nimmAnim(zdo: ZDO, seite: AnimSeite): void {
  const alt = besitz.get(zdo);
  if (alt !== undefined && alt !== seite) throw new AnimKonflikt(zdo.zdoid.toString(), alt, seite);
  besitz.set(zdo, seite);
}

/** Give a ZDO back — only the side that owns it can. */
export function gibAnim(zdo: ZDO, seite: AnimSeite): void {
  if (besitz.get(zdo) === seite) besitz.delete(zdo);
}

/** Diagnostics and tests. */
export function animBesitzer(zdo: ZDO): AnimSeite | null {
  return besitz.get(zdo) ?? null;
}
