import { sitemapAdresse, X_DEFAULT_ADRESSE } from '$lib/basisDomains';
import { LOCALES } from '$lib/i18n';
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
 *
 * ── Zwei Heimat-Domains statt einer (Karte D1) ────────────────────────
 * Jede Sprachfassung trägt ihre eigene Heimat-Domain ein
 * (`sitemapAdresse`/`basisDomains.ts`): /de auf world-of-mmorpg.de, /en auf
 * world-of-mmorpg.com — unabhängig davon, über welche der beiden
 * gleichwertigen Domains diese Datei selbst ausgeliefert wird. `x-default`
 * ist auf JEDEM Eintrag dieselbe eine Adresse (`X_DEFAULT_ADRESSE`, wie in
 * `Kopfdaten.svelte`): die Sprachweiche unter `/`, NICHT eine je Eintrag
 * lokalisierte Fassung — Mikes ausdrückliche Vorgabe (Angriffsbefund M2).
 */
export const prerender = true;

export function GET() {
  const eintraege = SITEMAP.flatMap((pfad) => {
    const alternates = [
      ...LOCALES.map((l) => `hreflang="${l}" href="${sitemapAdresse(l, pfad)}"`),
      `hreflang="x-default" href="${X_DEFAULT_ADRESSE}"`,
    ]
      .map((a) => `    <xhtml:link rel="alternate" ${a} />`)
      .join('\n');

    return LOCALES.map(
      (l) => `  <url>\n    <loc>${sitemapAdresse(l, pfad)}</loc>\n${alternates}\n  </url>`,
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
