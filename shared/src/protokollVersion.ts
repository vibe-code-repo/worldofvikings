/**
 * Protocol version of the handshake and the minimum a world demands.
 * Protokollversion des Handshakes und die Mindestversion, die eine Welt verlangt.
 *
 * `PROTOCOL_VERSION` is what the current client sends. `PROTOCOL_VERSION_BASIS` is the oldest
 * client every world accepts. A world that uses a biome an older client does not know needs
 * a newer client: the old one would drop the region silently while sanitizing the layout and
 * compute the terrain without it, while the server computes with it. Instead of that, the
 * server turns the old client away with the existing "bitte Seite neu laden" message.
 * Worlds without such a biome keep accepting every client from the base version on, so a
 * rollout does not kick anybody out before such a region exists.
 */
export const PROTOCOL_VERSION = 3;
export const PROTOCOL_VERSION_BASIS = 2;

/** Authoring biome names the clients of the base version do not know, with the version that does. */
export const BIOM_AB_PROTOKOLLVERSION: ReadonlyMap<string, number> = new Map([['greyglen', 3]]);

/** Lowest client version that may join a world with this (raw, unsanitized) layout document. */
export function mindestProtokollVersion(layoutRoh: unknown): number {
  let mindest = PROTOCOL_VERSION_BASIS;
  const regionen = (layoutRoh as { regions?: unknown } | null | undefined)?.regions;
  if (!Array.isArray(regionen)) return mindest;
  for (const r of regionen) {
    const biom = (r as { biome?: unknown } | null | undefined)?.biome;
    if (typeof biom !== 'string') continue;
    const ab = BIOM_AB_PROTOKOLLVERSION.get(biom);
    if (ab !== undefined && ab > mindest) mindest = ab;
  }
  return mindest;
}
