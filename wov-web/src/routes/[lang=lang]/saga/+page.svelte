<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { datumLang, holeJson } from '$lib/formate';
  import { localeFrom, messages } from '$lib/i18n';

  /**
   * Die Saga im Entwurf "Rune & Iron".
   *
   * Geändert hat sich das Aussehen, nicht der Weg der Daten: Runenzeile über
   * der Überschrift, ein Intro mit fester Zeilenbreite, darunter eine
   * einspaltige Liste gerandeter Karten mit gesperrter Kopfzeile.
   *
   * Der Entwurf zeigt nur den Fall "Einträge sind da". Fehler, Laden und Leer
   * bleiben trotzdem stehen — die Datei wird im Browser geholt, und ohne
   * diese drei Zustände stünde die Seite in genau den Fällen stumm da, in
   * denen sie etwas sagen müsste.
   */

  interface Eintrag { art: string; datum: string; titel: string; text: string }

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let eintraege = $state<Eintrag[] | null>(null);
  let fehler = $state(false);

  onMount(async () => {
    try {
      const daten = await holeJson<{ eintraege?: Eintrag[] }>('/api/saga.json');
      // Nach Datum absteigend — die Datei ist zwar sortiert, aber darauf will
      // sich niemand verlassen, der unten schnell etwas anhängt.
      eintraege = [...(daten.eintraege ?? [])].sort((a, b) => b.datum.localeCompare(a.datum));
    } catch (e) {
      console.error(e);
      fehler = true;
    }
  });
</script>

<Kopfdaten titel={t['saga.meta.title']} beschreibung={t['saga.meta.description']} />

<main class="mitte seite saga-page">
  <!-- Zierrat, kein Text: Screenreader sollen die Runen nicht buchstabieren. -->
  <span class="runen kicker" aria-hidden="true">ᛊᚨᚷᚨ</span>
  <h1>{t['saga.heading']}</h1>
  <p class="intro">{t['saga.intro']}</p>

  {#if fehler}
    <p class="leer-zustand">{t['saga.error']}</p>
  {:else if eintraege === null}
    <p class="leer-zustand">{t['saga.loading']}</p>
  {:else if eintraege.length === 0}
    <p class="leer-zustand">{t['saga.empty']}</p>
  {:else}
    <!--
      `e.art`, `e.titel` und `e.text` stammen aus /api/saga.json und bleiben
      vorerst deutsch — die Datei wird zur Laufzeit geholt und ist nicht Teil
      des Katalogs. Auf /en steht deshalb englischer Rahmen um deutschen
      Inhalt; das ist bekannt und wartet auf eine zweisprachige Saga-Datei.
    -->
    <div class="saga-list">
      {#each eintraege as e (e.datum + e.titel)}
        <article class="tafel saga-entry">
          <!--
            Der Entwurf zeigt in dieser Zeile nur die Art des Eintrags. Das
            Datum bleibt trotzdem stehen: Eine Saga ohne Datum ist eine Liste,
            keine Chronik, und die Reihenfolge allein sagt nicht, wann etwas
            geschah.
          -->
          <div class="saga-kind">{e.art} · {datumLang(e.datum, lang)}</div>
          <h2>{e.titel}</h2>
          <p>{e.text}</p>
        </article>
      {/each}
    </div>
  {/if}
</main>

<style>
  /* Der Entwurf hält die Saga schmaler als den Rahmen der Seite (1440px):
     Fließtext über die volle Breite liest sich nicht. */
  .saga-page {
    width: min(1100px, 100%);
  }

  /* Die Runenzeile über der Überschrift. Familie, Sperrung, Gold und
     Deckkraft kommen aus `.runen` in wov.css — hier steht nur, dass sie eine
     eigene Zeile ist. */
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
    margin: 0 0 2.5rem;
    max-width: 44rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  .saga-list {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .saga-entry {
    padding: 1.6rem 1.8rem;
  }

  /* Die gesperrte Kopfzeile über dem Titel — die "technische" Stimme des
     Entwurfs, hier in der gedämpften Goldstufe. */
  .saga-kind {
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primaer-behaelter);
  }

  .saga-entry h2 {
    margin: 0.5rem 0 0.6rem;
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }

  .saga-entry p {
    margin: 0;
    color: var(--text-matt);
    line-height: 1.65;
  }
</style>
