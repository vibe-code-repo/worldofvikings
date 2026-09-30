<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { type AnzeigeEintrag, fuerAnzeige, leseDevlog } from '$lib/devlog';
  import { datumLang, holeJson } from '$lib/formate';
  import { localeFrom, messages } from '$lib/i18n';

  /**
   * Das Dev-Log: was sich im Spiel geändert hat, je Tag in einfacher Sprache.
   *
   * Aufbau und Stil sind die der Saga (Runenzeile, Intro, einspaltige Liste
   * gerandeter Karten), und wie dort werden Laden, Fehler und Leer gezeigt.
   * Die Datei wird im Browser geholt: Ein neuer Tag braucht weder Build noch
   * Ausrollen. Titel und Punkte sind reiner Text und werden als Text
   * eingesetzt — nie als HTML.
   *
   * Ungültige Einträge überspringt `leseDevlog`; die Seite läuft weiter.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let daten = $state<ReturnType<typeof leseDevlog> | null>(null);
  let fehler = $state(false);

  const eintraege = $derived<AnzeigeEintrag[]>(daten ? fuerAnzeige(daten.eintraege, lang) : []);

  onMount(async () => {
    try {
      daten = leseDevlog(await holeJson<unknown>('/api/devlog.json'));
    } catch (e) {
      console.error(e);
      fehler = true;
    }
  });
</script>

<Kopfdaten titel={t['devlog.meta.title']} beschreibung={t['devlog.meta.description']} />

<main class="mitte seite devlog-page">
  <!-- Zierrat, kein Text: Screenreader sollen die Runen nicht buchstabieren. -->
  <span class="runen kicker" aria-hidden="true">ᛞᛖᚠᛚᛟᚷ</span>
  <h1>{t['devlog.heading']}</h1>
  <p class="intro">{t['devlog.intro']}</p>

  {#if fehler}
    <p class="leer-zustand">{t['devlog.error']}</p>
  {:else if daten === null}
    <p class="leer-zustand">{t['devlog.loading']}</p>
  {:else if eintraege.length === 0}
    <p class="leer-zustand">{t['devlog.empty']}</p>
  {:else}
    <div class="devlog-list">
      {#each eintraege as e (e.datum)}
        <article class="tafel devlog-entry">
          <!-- Mittag statt Mitternacht: ein reines Datum soll in keiner Zeitzone auf den Vortag fallen. -->
          <div class="devlog-day">{datumLang(`${e.datum}T12:00:00`, lang)}</div>
          <h2>{e.titel}</h2>
          <ul>
            {#each e.punkte as punkt, i (i)}
              <li>{punkt}</li>
            {/each}
          </ul>
          {#if e.ausweichsprache}
            <p class="devlog-hinweis">{t['devlog.fallback_note']}</p>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</main>

<style>
  /* Wie die Saga: schmaler als der Rahmen der Seite, weil Fließtext über die
     volle Breite sich nicht liest. */
  .devlog-page {
    width: min(1100px, 100%);
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
    margin: 0 0 2.5rem;
    max-width: 44rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  .devlog-list {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .devlog-entry {
    padding: 1.6rem 1.8rem;
  }

  .devlog-day {
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primaer-behaelter);
  }

  .devlog-entry h2 {
    margin: 0.5rem 0 0.6rem;
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
  }

  .devlog-entry ul {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--text-matt);
    line-height: 1.65;
  }

  .devlog-entry li + li {
    margin-top: 0.3rem;
  }

  .devlog-hinweis {
    margin: 0.8rem 0 0;
    color: var(--text-matt);
    font-size: 14px;
    font-style: italic;
  }
</style>
