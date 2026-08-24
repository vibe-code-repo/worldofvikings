<script lang="ts">
  import { page } from '$app/state';
  import { HAUPTNAV, FAHRT } from './seiten';
  import Ikone from './Ikone.svelte';
  import {
    LOCALES,
    LOCALE_NAME,
    localeFrom,
    localizedPath,
    messages,
    stripLocale,
  } from './i18n';

  /**
   * Sprache und Texte kommen aus der Adresse, nicht aus einem Store.
   * `page.params.lang` ist beim Vorrendern schon gesetzt — deshalb steht der
   * fertige Text in der gebauten Datei und nicht erst nach dem ersten Skript.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Welcher Punkt der offene ist, entscheidet die Adresse — nicht ein Skript,
   * das nach dem Laden Klassen nachträgt. Damit steht die Markierung schon in
   * der vorgerenderten Datei und flackert nicht beim ersten Bild.
   *
   * Verglichen wird OHNE Sprachpräfix und ohne Endung: `/en/saga.html`,
   * `/en/saga` und `/de/saga` sind für die Navigation derselbe Punkt, und in
   * `seiten.ts` steht er einmal als `/saga`.
   */
  const hier = $derived(stripLocale(page.url.pathname));
</script>

<header class="kopf">
  <div class="mitte">
    <a class="marke" href={localizedPath(lang, '/')}>
      <Ikone name="schwerter" />
      {t['header.brand']}
    </a>

    <nav class="nav" aria-label={t['header.nav.aria']}>
      {#each HAUPTNAV as s (s.pfad)}
        <a
          href={localizedPath(lang, s.pfad)}
          data-bald={s.bald ? t['header.soon'] : undefined}
          aria-current={hier === s.pfad ? 'page' : undefined}>{t[s.titel]}</a
        >
      {/each}
    </nav>

    <div class="kopf-tat">
      <!--
        Der Sprachumschalter zeigt auf DIESELBE Seite in der anderen Sprache,
        nicht auf deren Startseite: `stripLocale` nimmt das Präfix weg,
        `localizedPath` setzt das andere davor. Zwei gewöhnliche Links, kein
        Skript — ohne JavaScript funktioniert der Wechsel genauso.
      -->
      <nav class="sprachwahl" aria-label={t['header.language.aria']}>
        {#each LOCALES as l (l)}
          <a
            href={localizedPath(l, hier)}
            hreflang={l}
            lang={l}
            aria-current={l === lang ? 'true' : undefined}>{LOCALE_NAME[l]}</a
          >
        {/each}
      </nav>

      <a class="knopf" href={localizedPath(lang, FAHRT)}>{t['header.voyage.button']}</a>
    </div>
  </div>
</header>
