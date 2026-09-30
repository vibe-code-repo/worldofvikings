/**
 * Karte D1, Angriffsbefunde C2/C3 (Opus-Prüfung c2c2765): `Kopfdaten.svelte`
 * und die Sitemap-Route sind Svelte-/Route-Dateien, keine reinen .ts-Module —
 * `basisDomains.test.ts` prüft nur die PURE Funktionen, nicht ihre
 * VERDRAHTUNG. Ein Mutant, der `Kopfdaten.svelte`s canonical fest auf `'en'`
 * dreht oder der Sitemap `<loc>` fest auf `.com`, überlebte deshalb, obwohl
 * die Funktionen selbst korrekt bleiben.
 *
 * Textnachweis auf dem Quelltext (wie `client/test/direct-handoff.ts`):
 * kein Svelte-Compiler/-Renderer nötig, wov-web/vitest.config.ts lädt das
 * SvelteKit-Plugin ohnehin nicht (reine .ts-Module, s. dort).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MMORPG_COM,
  MMORPG_DE,
  weiterleitungsZielVikings,
  X_DEFAULT_ADRESSE,
} from './basisDomains';

const HERE = dirname(fileURLToPath(import.meta.url));
const kopfdaten = readFileSync(resolve(HERE, 'Kopfdaten.svelte'), 'utf-8');
const sitemap = readFileSync(resolve(HERE, '../routes/sitemap.xml/+server.ts'), 'utf-8');

describe('Kopfdaten.svelte: canonical/hreflang folgen der VARIABLEN Sprache', () => {
  it('der Ursprung kommt aus CANONICAL_HOME[lang] (oder der Überschreibung), nicht aus einer festen Sprache', () => {
    expect(kopfdaten).toMatch(/ursprungUeberschreiben\s*\?\?\s*CANONICAL_HOME\[lang\]/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\[?['"]?en['"]?\]?\s*\+/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\.en/);
    expect(kopfdaten).not.toMatch(/CANONICAL_HOME\.de/);
  });

  it('hreflang ruft hreflangAdresse mit der Schleifenvariable auf, nicht mit einer festen Sprache', () => {
    expect(kopfdaten).toMatch(/hreflangAdresse\(l,/);
    expect(kopfdaten).not.toMatch(/hreflangAdresse\(\s*['"](en|de)['"]/);
  });

  it('x-default ist die eine Konstante X_DEFAULT_ADRESSE, kein Funktionsaufruf mit einem Pfad', () => {
    expect(kopfdaten).toMatch(/hreflang="x-default"\s+href=\{X_DEFAULT_ADRESSE\}/);
  });
});

describe('Sitemap-Route: <loc> und x-default folgen derselben Regel', () => {
  it('<loc> und hreflang kommen aus sitemapAdresse(l, pfad), nicht aus einer festen Sprache', () => {
    expect(sitemap).toMatch(/<loc>\$\{sitemapAdresse\(l, pfad\)\}<\/loc>/);
    expect(sitemap).not.toMatch(/sitemapAdresse\(\s*['"](en|de)['"]/);
  });

  it('x-default ist X_DEFAULT_ADRESSE, keine je-Seite lokalisierte Fassung', () => {
    expect(sitemap).toMatch(/hreflang="x-default"\s+href="\$\{X_DEFAULT_ADRESSE\}"/);
  });
});

/**
 * Karte D1-R: die Weiterleitungsvorlage für world-of-vikings.com
 * (`deploy/npm-weiterleitung-vikings.conf`, Proxy-Host 3 im Nginx Proxy
 * Manager) wird hier AUSGEFÜHRT, nicht nur gelesen: die zwei Regel-Zeilen
 * werden aus der Vorlage gezogen und in JavaScript nachgestellt, das Ergebnis
 * gegen `weiterleitungsZielVikings` gehalten. Ein Mutant, der in der Vorlage
 * die Regex oder eine Domain dreht, wird damit rot, auch wenn der Textwächter
 * (`tools/test/npm-weiterleitung-vikings-vorlage.ts`) die Zeile noch findet.
 */
const vorlage = readFileSync(
  resolve(HERE, '../../../deploy/npm-weiterleitung-vikings.conf'),
  'utf-8',
);
const direktiven = vorlage
  .split('\n')
  .map((z) => z.replace(/^#\s?/, ''))
  .filter((z) => /^(set|if)\s/.test(z));

const vorgabe = direktiven.find((z) => /^set \$d1_ziel /.test(z));
const deZeile = direktiven.find((z) => /^if \(\$request_uri ~ "/.test(z));
const acmeZeile = direktiven.find((z) => /^if \(\$request_uri !~ "/.test(z));

/** Die drei Zeilen der Vorlage, wie nginx sie auf $request_uri anwendet. */
function nginxZiel(requestUri: string): string | null {
  const vorgabeHost = /^set \$d1_ziel (\S+);$/.exec(vorgabe ?? '')?.[1];
  const deMuster = /^if \(\$request_uri ~ "(.+)"\) \{ set \$d1_ziel (\S+); \}$/.exec(deZeile ?? '');
  const acmeMuster =
    /^if \(\$request_uri !~ "(.+)"\) \{ return 301 https:\/\/\$d1_ziel\$request_uri; \}$/.exec(
      acmeZeile ?? '',
    );
  if (!vorgabeHost || !deMuster || !acmeMuster)
    throw new Error('Vorlage nicht im erwarteten Format');
  // nginx-`$` ohne Multiline und PCRE-`\?` verhalten sich hier wie in JS.
  let ziel = vorgabeHost;
  if (new RegExp(deMuster[1]).test(requestUri)) ziel = deMuster[2];
  if (!new RegExp(acmeMuster[1]).test(requestUri)) return `https://${ziel}${requestUri}`;
  return null;
}

const FAELLE = [
  '/',
  '/de',
  '/de/',
  '/de/saga',
  '/de?x=1',
  '/de/saga?x=1&y=2',
  '/deutsch',
  '/de-x',
  '/en',
  '/en/login',
  '/robots.txt',
  '/sitemap.xml?a=b',
  '/xde/saga',
];

describe('npm-weiterleitung-vikings.conf gegen weiterleitungsZielVikings', () => {
  it('liefert die drei Direktiven der Vorlage', () => {
    expect(vorgabe).toBeDefined();
    expect(deZeile).toBeDefined();
    expect(acmeZeile).toBeDefined();
  });

  for (const uri of FAELLE) {
    it(`${uri} geht dorthin, wohin die Funktion es schickt`, () => {
      const q = uri.indexOf('?');
      const pfad = q < 0 ? uri : uri.slice(0, q);
      const suche = q < 0 ? '' : uri.slice(q);
      expect(nginxZiel(uri)).toBe(weiterleitungsZielVikings(pfad, suche));
    });
  }

  it('/de, /de/… und /de?x gehen nach .de, /deutsch nach .com', () => {
    expect(nginxZiel('/de')).toBe('https://world-of-mmorpg.de/de');
    expect(nginxZiel('/de/x')).toBe('https://world-of-mmorpg.de/de/x');
    expect(nginxZiel('/de?x=1')).toBe('https://world-of-mmorpg.de/de?x=1');
    expect(nginxZiel('/deutsch')).toBe('https://world-of-mmorpg.com/deutsch');
  });

  it('die ACME-Prüfung wird nicht weitergeleitet', () => {
    expect(nginxZiel('/.well-known/acme-challenge/abc')).toBeNull();
    expect(nginxZiel('/x/.well-known/acme-challenge/abc')).not.toBeNull();
  });
});

/**
 * Karte D1-R (Angriffsbefunde C2/C3): canonical, hreflang, x-default und die
 * Sitemap am GEBAUTEN Stand (`build/prerendered`), nicht am Quelltext.
 * `domain-verdrahtung.test.ts` liest nur die Quelltexte von `Kopfdaten.svelte`
 * und der Sitemap-Route; ein Fehler, der erst beim Rendern entsteht (falsche
 * Sprache je Seite, eine Seite ohne Partner, eine Sitemap-Adresse ohne Seite),
 * bliebe dort grün.
 *
 * Der web-Job der CI baut vor `npm test` (`npm run build`, dann
 * `npm test`); lokal fehlt der Build oft — dann wird übersprungen, in der CI
 * (`CI` gesetzt) ist ein fehlender Build ein Fehler, damit der Test nie
 * stillschweigend ausfällt.
 */
const GEBAUT = resolve(HERE, '../../build/prerendered');
const vorhanden = existsSync(resolve(GEBAUT, 'sitemap.xml'));
const inDerCi = Boolean(process.env.CI);

const HEIMAT = { de: `https://${MMORPG_DE}`, en: `https://${MMORPG_COM}` } as const;
const OG = { de: 'de_DE', en: 'en_US' } as const;

interface Seite {
  /** Pfad ohne Endung, wie ihn der Besucher sieht (`/de/saga`). */
  pfad: string;
  sprache: 'de' | 'en' | null;
  html: string;
}

function seiten(): Seite[] {
  const liste: Seite[] = [];
  const nimm = (relativ: string, pfad: string, sprache: 'de' | 'en' | null): void =>
    void liste.push({ pfad, sprache, html: readFileSync(resolve(GEBAUT, relativ), 'utf-8') });
  nimm('index.html', '/', null);
  for (const l of ['de', 'en'] as const) {
    nimm(`${l}.html`, `/${l}`, l);
    for (const datei of readdirSync(resolve(GEBAUT, l))) {
      if (datei.endsWith('.html')) nimm(`${l}/${datei}`, `/${l}/${datei.slice(0, -5)}`, l);
    }
  }
  return liste;
}

function links(html: string, rel: string): Map<string, string> {
  const ergebnis = new Map<string, string>();
  for (const m of html.matchAll(
    /<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\s*\/?>/g,
  )) {
    if (rel === 'alternate') ergebnis.set(m[1], m[2]);
  }
  return ergebnis;
}

/**
 * Seiten der Sitemap, die NICHT vorgerendert sind: das Forum („Das Thing“)
 * setzt `prerender = false` und rendert bei jeder Anfrage (svelte.config.js).
 * Für sie gibt es keine gebaute Datei; die Sitemap-Adresse selbst wird trotzdem
 * geprüft. Jede andere Adresse ohne gebaute Seite ist ein Fehler.
 */
const NICHT_VORGERENDERT = new Set(['/de/thing', '/en/thing']);

const beschreibe = vorhanden || inDerCi ? describe : describe.skip;

describe('Vorbedingung', () => {
  it('der Build liegt vor (in der CI Pflicht)', () => {
    if (inDerCi) expect(vorhanden).toBe(true);
  });
});

beschreibe('gebauter Stand: canonical, hreflang, x-default', () => {
  const alle = vorhanden ? seiten() : [];

  it('es gibt Seiten beider Sprachen und die Wurzel', () => {
    expect(alle.some((s) => s.pfad === '/')).toBe(true);
    expect(alle.filter((s) => s.sprache === 'de').length).toBeGreaterThan(3);
    expect(alle.filter((s) => s.sprache === 'en').length).toBeGreaterThan(3);
  });

  for (const s of vorhanden ? alle : []) {
    it(`${s.pfad}: genau eine canonical auf der Heimat der eigenen Sprache`, () => {
      const kanon = [...s.html.matchAll(/<link rel="canonical" href="([^"]+)"\s*\/?>/g)].map(
        (m) => m[1],
      );
      expect(kanon).toHaveLength(1);
      // Die Wurzel gehört zu keiner Sprache: ihre canonical ist der x-default.
      expect(kanon[0]).toBe(s.sprache === null ? X_DEFAULT_ADRESSE : HEIMAT[s.sprache] + s.pfad);
    });

    it(`${s.pfad}: hreflang de/en auf den Heimat-Domains und x-default = die Sprachweiche`, () => {
      const alt = links(s.html, 'alternate');
      expect(alt.get('x-default')).toBe(X_DEFAULT_ADRESSE);
      expect(alt.get('de')?.startsWith(`${HEIMAT.de}/de`)).toBe(true);
      expect(alt.get('en')?.startsWith(`${HEIMAT.en}/en`)).toBe(true);
    });

    it(`${s.pfad}: die Partnerseiten aus hreflang gibt es gebaut, die eigene zeigt auf sich`, () => {
      const alt = links(s.html, 'alternate');
      for (const l of ['de', 'en'] as const) {
        const ziel = alt.get(l) as string;
        const pfad = ziel.slice(HEIMAT[l].length);
        expect(existsSync(resolve(GEBAUT, `${pfad.slice(1)}.html`))).toBe(true);
      }
      if (s.sprache !== null) expect(alt.get(s.sprache)).toBe(HEIMAT[s.sprache] + s.pfad);
    });

    it(`${s.pfad}: og:locale steht genau einmal`, () => {
      const treffer = [...s.html.matchAll(/property="og:locale" content="([^"]+)"/g)].map(
        (m) => m[1],
      );
      expect(treffer).toHaveLength(1);
      // Die Wurzel hat keine Sprache und bekommt die Vorgabe (de_DE); wer sie
      // ausliefert, ist nur der Rückfall-Host (nginx schickt .com/.de vorher weiter).
      expect(treffer[0]).toBe(OG[s.sprache ?? 'de']);
    });
  }
});

beschreibe('gebauter Stand: sitemap.xml', () => {
  const xml = vorhanden ? readFileSync(resolve(GEBAUT, 'sitemap.xml'), 'utf-8') : '';
  const eintraege = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);

  it('enthält Einträge', () => {
    expect(eintraege.length).toBeGreaterThan(4);
  });

  for (const e of vorhanden ? eintraege : []) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(e)?.[1] as string;
    it(`${loc}: <loc> liegt auf der Heimat seiner Sprache, die Seite ist gebaut, hreflang = die der Seite`, () => {
      const sprache = loc.startsWith(`${HEIMAT.de}/de`) ? 'de' : 'en';
      expect(loc.startsWith(`${HEIMAT[sprache]}/${sprache}`)).toBe(true);
      const pfad = loc.slice(HEIMAT[sprache].length);
      const datei = resolve(GEBAUT, `${pfad.slice(1)}.html`);
      if (NICHT_VORGERENDERT.has(pfad)) {
        expect(existsSync(datei)).toBe(false);
        expect(e).toContain(`hreflang="x-default" href="${X_DEFAULT_ADRESSE}"`);
        return;
      }
      const html = readFileSync(datei, 'utf-8');
      const ausSitemap = new Map(
        [...e.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]] as const),
      );
      expect(ausSitemap).toEqual(links(html, 'alternate'));
      expect(ausSitemap.get('x-default')).toBe(X_DEFAULT_ADRESSE);
    });
  }
});
