import { adresseVon, ladeRuestkammer } from '$lib/server/armoryApi';
import type { PageServerLoad } from './$types';

/**
 * Die Ruhmeshalle: die Tafeln mit echter Quelle, serverseitig aus der
 * Rüstkammer des Spielservers. Eine Seite genügt (die zuletzt aktiven Recken
 * stehen vorn); ist der Spielserver stumm, bleibt die Seite lesbar.
 */
export const prerender = false;

export const load: PageServerLoad = async ({ fetch, getClientAddress }) => {
  const r = await ladeRuestkammer(fetch, '', 1, { besucher: adresseVon(getClientAddress) });
  return { erreichbar: r.ok, eintraege: r.ok ? r.data.eintraege : [] };
};
