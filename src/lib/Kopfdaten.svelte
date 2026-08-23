<script lang="ts">
  import { page } from '$app/state';

  /**
   * Titel, Beschreibung, canonical und Open Graph einer Seite.
   *
   * Das ist Roadmap H2, und es ist der Punkt, an dem sich der Umbau am
   * schnellsten bezahlt macht: Vorher hätte jede der sieben Dateien ihre
   * eigenen zehn Meta-Zeilen bekommen müssen — sieben Gelegenheiten, eine
   * davon falsch abzuschreiben. Jetzt steht die Vorlage einmal hier, und
   * jede Seite gibt nur noch Titel und Beschreibung mit.
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

  const ganzerTitel = $derived(blankerTitel ? titel : `${titel} — World of Vikings`);

  /**
   * Die kanonische Adresse ist die OHNE Endung.
   *
   * nginx liefert jede Seite unter beiden Adressen aus (`try_files $uri
   * $uri.html`), und genau das führte die Roadmap als Duplicate Content.
   * Beide Adressen bleiben erreichbar — alte Links sollen nicht brechen —,
   * aber sie zeigen jetzt auf dieselbe kanonische Fassung.
   */
  const kanonisch = $derived(
    URSPRUNG + (page.url.pathname.replace(/\.html$/, '') || '/')
  );
</script>

<svelte:head>
  <title>{ganzerTitel}</title>
  <meta name="description" content={beschreibung} />
  <link rel="canonical" href={kanonisch} />
  {#if noindex}
    <meta name="robots" content="noindex" />
  {/if}

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="World of Vikings" />
  <meta property="og:locale" content="de_DE" />
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
