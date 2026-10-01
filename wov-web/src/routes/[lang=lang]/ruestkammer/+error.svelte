<script lang="ts">
  import { page } from '$app/state';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  /**
   * Fehlerseite der Rüstkammer. Der häufige Fall ist ein Recke, den es nicht
   * (mehr) gibt (404): Statt „404 unknown-character“ steht ein übersetzter Satz
   * mit Weg zurück da. Andere Fehler bekommen denselben Rahmen, ohne die
   * technische Meldung zu zeigen.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
  const kammer = $derived(localizedPath(lang, '/ruestkammer'));
</script>

<svelte:head>
  <title>{t['armory.title']} — {t['meta.brand']}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="mitte seite">
  <h1>{t['armory.title']}</h1>
  <p class="leer-zustand">{t['armory.error.title']}</p>
  <p>{t['armory.error.text']}</p>
  <a class="knopf knopf-schlicht" href={kammer}>{t['armory.error.back']}</a>
</main>
