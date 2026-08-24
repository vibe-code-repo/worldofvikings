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
  titel={t['map.title']}
  beschreibung={t['map.description']}
  bild="/assets/karten/live.webp"
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['map.heading']}</h1>
  <p style="color:var(--matt);max-width:46rem">{t['map.intro']}</p>

  <Kartenbetrachter />

  <noscript>
    <div class="hinweis" style="margin:1.5rem 0">
      <b>{t['map.hint.bold']}</b>
      {t['map.hint.text']}
      <a href="/assets/karten/live.webp">{t['map.hint.link_midgard']}</a>
      {t['map.hint.and']}
      <a href="/assets/karten/dev.webp">{t['map.hint.link_workshop']}</a>.
    </div>
  </noscript>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href={localizedPath(lang, FAHRT)}>{t['map.cta']}</a>
  </p>
</main>
