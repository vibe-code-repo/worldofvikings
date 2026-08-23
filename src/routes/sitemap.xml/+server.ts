import { SITEMAP } from '$lib/seiten';

/**
 * Die Sitemap entsteht aus derselben Liste wie die Navigation.
 *
 * Vorher war sie eine handgepflegte Datei, und als am 21.08. die Karte
 * dazukam, musste sie dort nachgetragen werden wie an acht anderen Stellen
 * auch. Jetzt kann sie nicht mehr veralten, ohne dass die Navigation es
 * ebenfalls tut — und das fiele sofort auf.
 *
 * `erstellen` steht bewusst NICHT darin: Die Seite trägt `noindex`, weil eine
 * Charaktererstellung ohne Kontext kein sinnvolles Suchergebnis ist.
 */
export const prerender = true;

const URSPRUNG = 'https://world-of-vikings.com';

export function GET() {
  const eintraege = SITEMAP.map(
    (pfad) => `  <url>\n    <loc>${URSPRUNG}${pfad === '/' ? '/' : pfad}</loc>\n  </url>`,
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${eintraege}
</urlset>
`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
