import { inhaltText } from './texte.js';

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

/** True when a client of this version may receive this (raw) layout document. */
export function darfLayoutBekommen(clientVersion: number, layoutRoh: unknown): boolean {
  return clientVersion >= mindestProtokollVersion(layoutRoh);
}

/**
 * The version the server names in its refusal: its own current one for a client that is too new,
 * otherwise the minimum the world demands.
 */
export function serverVersionFuerMeldung(clientVersion: number, mindest: number): number {
  return clientVersion > PROTOCOL_VERSION ? PROTOCOL_VERSION : mindest;
}

/**
 * The refusal text of an outdated client, in both languages at once ("de / en"): the server does not
 * know the language of a client that is about to be turned away, and an outdated client could not map a
 * key anyway, it shows the text as it is. Both come from the catalogue (`inhalt.netz.veraltet`).
 */
export function veraltetMeldung(clientVersion: number, serverVersion: number): string {
  const fuelle = (t: string): string => t.replace('{client}', String(clientVersion)).replace('{server}', String(serverVersion));
  return `${fuelle(inhaltText('inhalt.netz.veraltet', 'de'))} / ${fuelle(inhaltText('inhalt.netz.veraltet', 'en'))}`;
}

/** Request header with which the editor (and tools) tell the operations service their protocol version. */
export const PROTOKOLL_KOPF = 'x-wov-protokoll';

/**
 * The protocol version a request announces in `PROTOKOLL_KOPF`. No header, a repeated one or anything that is not
 * a plain whole number counts as the base version: an editor from before the header cannot send it.
 */
export function protokollVersionAusKopf(wert: string | string[] | undefined): number {
  if (typeof wert !== 'string' || !/^[0-9]{1,6}$/.test(wert.trim())) return PROTOCOL_VERSION_BASIS;
  const v = Number(wert.trim());
  return v >= PROTOCOL_VERSION_BASIS ? v : PROTOCOL_VERSION_BASIS;
}
