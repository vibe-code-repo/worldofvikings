/**
 * Website-Ursprünge, die die Konten- und Forum-API von einem Browser aus
 * aufrufen dürfen — Karte D1 (Zweitdomains / Ablösung).
 *
 * Vorher trug jede der beiden APIs (`KontoApi.ts`, `ForumApi.ts`) dieselben
 * drei Zeilen als eigene Kopie: laut Kopfkommentar von `ForumApi.ts`
 * "dieselbe Menge wie KontoApi", tatsächlich aber zwei unabhängige
 * Konstanten. Eine der beiden zu ändern, ohne die andere mitzunehmen, hätte
 * lautlos nur eine der zwei APIs geöffnet oder geschlossen.
 *
 * `world-of-vikings.com` bleibt in der Liste, solange sie noch keine reine
 * Weiterleitung ist (Karte D1, Teil 3, noch nicht ausgeführt): alte Tabs
 * und Lesezeichen rufen die APIs sonst mit einem Ursprung auf, den keine
 * der beiden Funktionen mehr kennt.
 */
export const WEBSITE_BASISDOMAINS: readonly string[] = [
  'world-of-mmorpg.com',
  'world-of-mmorpg.de',
  'world-of-vikings.com',
];

export const WEBSITE_URSPRUENGE: ReadonlySet<string> = new Set(
  WEBSITE_BASISDOMAINS.flatMap((domain) => [`https://${domain}`, `https://www.${domain}`]),
);
