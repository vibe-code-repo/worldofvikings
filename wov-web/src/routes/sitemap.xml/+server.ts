import { LOCALES, DEFAULT_LOCALE, localizedPath } from '$lib/i18n';
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
 *
 * ── Zwei Sprachen, eine Datei ────────────────────────────────────────
 * Jeder Pfad steht zweimal — einmal je Sprache —, und jeder Eintrag listet
 * ALLE Fassungen als `xhtml:link`, einschliesslich seiner eigenen. Das ist
 * keine Redundanz, sondern die Vorschrift: Eine Sitemap, in der /de/saga auf
 * /en/saga zeigt, /en/saga aber nicht zurück, wird als einseitige Angabe
 * verworfen. `x-default` zeigt auf die Vorgabesprache — dieselbe Adresse, zu
 * der auch die Sprachweiche unter `/` führt.
 *
 * `robots.txt` bleibt unverändert: eine gemeinsame Sitemap für beide
 * Sprachen ist richtig, getrennte wären zwei Dateien, die auseinanderlaufen
 * können.
 */
export const prerender = true;

const URSPRUNG = 'https://world-of-vikings.com';

/** Volle Adresse eines sprachlosen Pfads in einer Sprache. */
function adresse(sprache: (typeof LOCALES)[number], pfad: string): string {
  return URSPRUNG + localizedPath(sprache, pfad);
}

export function GET() {
  const eintraege = SITEMAP.flatMap((pfad) => {
    const alternates = [
      ...LOCALES.map((l) => `hreflang="${l}" href="${adresse(l, pfad)}"`),
      `hreflang="x-default" href="${adresse(DEFAULT_LOCALE, pfad)}"`,
    ]
      .map((a) => `    <xhtml:link rel="alternate" ${a} />`)
      .join('\n');

    return LOCALES.map(
      (l) => `  <url>\n    <loc>${adresse(l, pfad)}</loc>\n${alternates}\n  </url>`,
    );
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${eintraege}
</urlset>
`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
