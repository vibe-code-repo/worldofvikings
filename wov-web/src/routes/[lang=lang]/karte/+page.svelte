<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import Kartenbetrachter from '$lib/Kartenbetrachter.svelte';
  import { localeFrom, messages } from '$lib/i18n';

  /**
   * Die Karte im Entwurf "Rune & Iron".
   *
   * Die Seite selbst trägt nur noch Runenzeile, Überschrift, Intro und den
   * Hinweis für Browser ohne JavaScript. Alles Weitere — Weltwahl, Rahmen,
   * Legende, Hinweis, Knopf — steht im Betrachter, weil es an den geladenen
   * Kartendaten hängt.
   *
   * Der Knopf "Selbst hinfahren" stand früher hier unten und sitzt jetzt in
   * der Leiste rechts neben der Karte, wie im Entwurf.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
</script>

<Kopfdaten
  titel={t['map.title']}
  beschreibung={t['map.description']}
  bild="/assets/karten/live.webp"
/>

<main class="mitte seite map-page">
  <span class="runen kicker" aria-hidden="true">ᛗᛁᛞᚷᚨᚱᛞ</span>
  <h1>{t['map.heading']}</h1>
  <p class="intro">{t['map.intro']}</p>

  <!--
    Steht VOR dem Betrachter, nicht dahinter: Ohne Skript ist der Rahmen
    darunter ein leerer Kasten, und wer das liest, soll den Weg zu den Bildern
    finden, bevor er daran vorbeigescrollt ist.
  -->
  <noscript>
    <!--
      Nur globale Klassen hier drin: Was in einem <noscript> steht, bekommt
      die Bereichsklasse einer <style>-Insel nicht zuverlässig mit.
      `.hinweis` kommt aus wov.css, der Abstand nach unten aus dem
      Raster des Betrachters (margin-top).
    -->
    <div class="hinweis">
      <b>{t['map.hint.bold']}</b>
      {t['map.hint.text']}
      <a href="/assets/karten/live.webp">{t['map.hint.link_midgard']}</a>
      {t['map.hint.and']}
      <a href="/assets/karten/dev.webp">{t['map.hint.link_workshop']}</a>.
    </div>
  </noscript>

  <Kartenbetrachter />
</main>

<style>
  /* Die breiteste Fläche der vier Unterseiten nach der Rüstkammer: Karte und
     Leiste stehen nebeneinander, und die Karte soll etwas hermachen. */
  .map-page {
    width: min(1280px, 100%);
  }

  .kicker {
    display: block;
    font-size: 18px;
    margin-bottom: 0.6rem;
  }

  h1 {
    margin: 0 0 0.6rem;
    font-size: clamp(30px, 5vw, 44px);
  }

  .intro {
    margin: 0 0 2rem;
    max-width: 46rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }
</style>
