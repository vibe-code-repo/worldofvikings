<script lang="ts">
  import { page } from '$app/state';
  import {
    CANONICAL_HOME,
    hreflangAdresse,
    kanonischeAdresse,
    xDefaultAdresse,
  } from './basisDomains';
  import {
    LOCALES,
    OG_LOCALE,
    localeFrom,
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

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const ganzerTitel = $derived(blankerTitel ? titel : `${titel} — ${t['meta.brand']}`);

  /**
   * Die kanonische Adresse ist die OHNE Endung.
   *
   * nginx liefert jede Seite unter beiden Adressen aus (`try_files $uri
   * $uri.html`), und genau das führte die Roadmap als Duplicate Content.
   * Beide Adressen bleiben erreichbar — alte Links sollen nicht brechen —,
   * aber sie zeigen jetzt auf dieselbe kanonische Fassung. Das Sprachpräfix
   * steht bereits im Pfad, es muss hier nicht angehängt werden.
   *
   * Der Ursprung ist die Heimat-Domain DIESER Sprache (Karte D1,
   * `basisDomains.ts`), nicht die Domain, über die die Seite gerade
   * ausgeliefert wurde — world-of-mmorpg.com und world-of-mmorpg.de sind
   * gleichwertige Hauptdomains, aber jede Sprache hat genau eine Heimat.
   */
  const kanonisch = $derived(
    kanonischeAdresse(lang, page.url.pathname.replace(/\.html$/, '') || '/'),
  );

  /**
   * Dieselbe Seite in jeder Sprache, plus x-default.
   *
   * Jede Fassung listet ALLE Sprachen einschliesslich ihrer eigenen — so
   * verlangt es die hreflang-Spezifikation, und eine Fassung, die sich selbst
   * ausliesse, würde von Suchmaschinen als einseitige Angabe verworfen.
   * `x-default` zeigt auf world-of-mmorpg.com (Karte D1, `basisDomains.ts`),
   * nicht auf die Heimat von DEFAULT_LOCALE (`de` → .de) — die beiden fallen
   * bewusst nicht zusammen.
   */
  const nackt = $derived(stripLocale(page.url.pathname));
</script>

<svelte:head>
  <title>{ganzerTitel}</title>
  <meta name="description" content={beschreibung} />
  <link rel="canonical" href={kanonisch} />
  {#each LOCALES as l (l)}
    <link rel="alternate" hreflang={l} href={hreflangAdresse(l, nackt)} />
  {/each}
  <link rel="alternate" hreflang="x-default" href={xDefaultAdresse(nackt)} />
  {#if noindex}
    <meta name="robots" content="noindex" />
  {/if}

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={t['meta.brand']} />
  <meta property="og:locale" content={OG_LOCALE[lang]} />
  {#each LOCALES.filter((l) => l !== lang) as l (l)}
    <meta property="og:locale:alternate" content={OG_LOCALE[l]} />
  {/each}
  <meta property="og:title" content={ganzerTitel} />
  <meta property="og:description" content={beschreibung} />
  <meta property="og:url" content={kanonisch} />
  <meta property="og:image" content={CANONICAL_HOME[lang] + bild} />

  <!-- Grosse Karte statt Vorschaustreifen: Das Heldenbild ist im Querformat
       und verliert in der kleinen Fassung genau das, was es zeigen soll. -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={ganzerTitel} />
  <meta name="twitter:description" content={beschreibung} />
  <meta name="twitter:image" content={CANONICAL_HOME[lang] + bild} />
</svelte:head>
