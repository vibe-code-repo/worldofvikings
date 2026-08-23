<script lang="ts">
  import { page } from '$app/state';
  import {
    DEFAULT_LOCALE,
    LOCALES,
    OG_LOCALE,
    localeFrom,
    localizedPath,
    messages,
    stripLocale,
  } from './i18n';

  /**
   * Titel, Beschreibung, canonical, hreflang und Open Graph einer Seite.
   *
   * Das ist Roadmap H2, und es ist der Punkt, an dem sich der Umbau am
   * schnellsten bezahlt macht: Vorher hätte jede der sieben Dateien ihre
   * eigenen zehn Meta-Zeilen bekommen müssen — sieben Gelegenheiten, eine
   * davon falsch abzuschreiben. Seit der Sprachumbau daraus zwölf Seiten
   * gemacht hat, wären es zwölf.
   *
   * `titel` und `beschreibung` kommen als fertiger Text herein, nicht als
   * Katalogschlüssel: Die Rüstkammer setzt einen Namen davor, und die
   * Sprachweiche unter `/` gehört zu gar keiner Sprache.
   */
  let {
    titel,
    beschreibung,
    /** Ohne Zusatz „— World of Vikings“ (nur die Startseite). */
    blankerTitel = false,
    /** Vorschaubild für geteilte Links, relativ zur Wurzel. */
    bild = '/assets/bilder/held.webp',
    /** Seiten, die nicht in den Index gehören (Charaktererstellung). */
    noindex = false,
  }: {
    titel: string;
    beschreibung: string;
    blankerTitel?: boolean;
    bild?: string;
    noindex?: boolean;
  } = $props();

  const URSPRUNG = 'https://world-of-vikings.com';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const ganzerTitel = $derived(blankerTitel ? titel : `${titel} — ${t['kopfdaten.marke']}`);

  /**
   * Die kanonische Adresse ist die OHNE Endung.
   *
   * nginx liefert jede Seite unter beiden Adressen aus (`try_files $uri
   * $uri.html`), und genau das führte die Roadmap als Duplicate Content.
   * Beide Adressen bleiben erreichbar — alte Links sollen nicht brechen —,
   * aber sie zeigen jetzt auf dieselbe kanonische Fassung. Das Sprachpräfix
   * steht bereits im Pfad, es muss hier nicht angehängt werden.
   */
  const kanonisch = $derived(URSPRUNG + (page.url.pathname.replace(/\.html$/, '') || '/'));

  /**
   * Dieselbe Seite in jeder Sprache, plus x-default.
   *
   * Jede Fassung listet ALLE Sprachen einschliesslich ihrer eigenen — so
   * verlangt es die hreflang-Spezifikation, und eine Fassung, die sich selbst
   * ausliesse, würde von Suchmaschinen als einseitige Angabe verworfen.
   * `x-default` zeigt auf die Vorgabesprache: Wer keine der beiden
   * ausdrücklich will, landet dort, wo auch die Sprachweiche hinführt.
   */
  const nackt = $derived(stripLocale(page.url.pathname));
</script>

<svelte:head>
  <title>{ganzerTitel}</title>
  <meta name="description" content={beschreibung} />
  <link rel="canonical" href={kanonisch} />
  {#each LOCALES as l (l)}
    <link rel="alternate" hreflang={l} href={URSPRUNG + localizedPath(l, nackt)} />
  {/each}
  <link
    rel="alternate"
    hreflang="x-default"
    href={URSPRUNG + localizedPath(DEFAULT_LOCALE, nackt)}
  />
  {#if noindex}
    <meta name="robots" content="noindex" />
  {/if}

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={t['kopfdaten.marke']} />
  <meta property="og:locale" content={OG_LOCALE[lang]} />
  {#each LOCALES.filter((l) => l !== lang) as l (l)}
    <meta property="og:locale:alternate" content={OG_LOCALE[l]} />
  {/each}
  <meta property="og:title" content={ganzerTitel} />
  <meta property="og:description" content={beschreibung} />
  <meta property="og:url" content={kanonisch} />
  <meta property="og:image" content={URSPRUNG + bild} />

  <!-- Grosse Karte statt Vorschaustreifen: Das Heldenbild ist im Querformat
       und verliert in der kleinen Fassung genau das, was es zeigen soll. -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={ganzerTitel} />
  <meta name="twitter:description" content={beschreibung} />
  <meta name="twitter:image" content={URSPRUNG + bild} />
</svelte:head>
