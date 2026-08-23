<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import Kartenbetrachter from '$lib/Kartenbetrachter.svelte';
  import { FAHRT } from '$lib/seiten';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
</script>

<Kopfdaten
  titel={t['karte.titel']}
  beschreibung={t['karte.beschreibung']}
  bild="/assets/karten/live.webp"
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['karte.ueberschrift']}</h1>
  <p style="color:var(--matt);max-width:46rem">{t['karte.einleitung']}</p>

  <Kartenbetrachter />

  <noscript>
    <div class="hinweis" style="margin:1.5rem 0">
      <b>{t['karte.hinweis.fett']}</b>
      {t['karte.hinweis.text']}
      <a href="/assets/karten/live.webp">{t['karte.hinweis.link_midgard']}</a>
      {t['karte.hinweis.verbindung']}
      <a href="/assets/karten/dev.webp">{t['karte.hinweis.link_werkstatt']}</a>.
    </div>
  </noscript>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href={localizedPath(lang, FAHRT)}>{t['karte.cta']}</a>
  </p>
</main>
