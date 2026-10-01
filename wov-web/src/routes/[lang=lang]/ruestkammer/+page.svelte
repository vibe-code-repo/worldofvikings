<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { fuelle } from '$lib/reckenVorschauKern';
  import { vorWieLange } from '$lib/formate';
  import {
    KAMMER_FEHLER,
    figurStuecke,
    isoVon,
    klassenName,
    listenAdresse,
    profilAdresse,
    zaehlerText,
    zahlText,
  } from '$lib/reckenAnzeige';
  import Reckenprofil from '$lib/Reckenprofil.svelte';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import type { PageData } from './$types';

  /**
   * Die Rüstkammer im Entwurf "Rune & Iron", mit echten Charakteren.
   *
   * Alles steht schon im ausgelieferten HTML: Die Daten kommen in
   * `+page.server.ts` vom Spielserver, die Suche ist ein GET-Formular, die
   * Seiten sind Links. Ohne JavaScript funktioniert die Kammer vollständig;
   * mit JavaScript kommt nur die 3D-Figur im Profil dazu. Welches Profil offen
   * ist, steht in der Adresse (?reck=…): verlinkbar, und der Zurück-Knopf des
   * Browsers tut, was er soll.
   */

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** Die Kammer in der aktuellen Sprache — Ziel von Karten, Formular und Zurück-Knopf. */
  const kammer = $derived(localizedPath(lang, '/ruestkammer'));

  const liste = $derived(data.liste);
  const gewaehlt = $derived(data.recke);
  const suchLeer = $derived(data.q === '');
</script>

<Kopfdaten
  titel={gewaehlt ? `${gewaehlt.name} — ${t['armory.title']}` : t['armory.title']}
  beschreibung={t['armory.description']}
  abfrage={gewaehlt ? `?reck=${gewaehlt.id}` : ''}
  noindex={Boolean(data.fehler)}
/>

<main class="mitte seite armory-page">
  <span class="runen kicker" aria-hidden="true">ᚱᚢᛊᛏ</span>
  <h1>{t['armory.heading']}</h1>
  <p class="intro">{t['armory.intro']}</p>

  {#if data.ansicht === 'profil'}
    <a class="knopf knopf-schlicht back" href={kammer}>{t['armory.back']}</a>
    {#if gewaehlt}
      <Reckenprofil
        recke={gewaehlt}
        aussehen={{ klasse: gewaehlt.klasse, ...gewaehlt.aussehen }}
        ausruestung={figurStuecke(gewaehlt)}
      />
    {:else}
      <p class="leer-zustand">{t[KAMMER_FEHLER[data.fehler ?? 'aus']]}</p>
    {/if}
  {:else}
    <!--
      Das Label trägt `nur-vorlesen`: sichtbar für Screenreader, unsichtbar am
      Bildschirm. Der Absende-Knopf ist wieder da, denn ohne JavaScript filtert
      nichts beim Tippen; das Formular geht als GET an dieselbe Adresse.
    -->
    <form class="suche search" role="search" method="get" action={kammer}>
      <label class="nur-vorlesen" for="suchfeld">{t['armory.search.label']}</label>
      <input
        id="suchfeld"
        class="feld"
        type="search"
        name="q"
        minlength="2"
        maxlength="32"
        value={data.q}
        placeholder={t['armory.search.placeholder']}
        autocomplete="off"
        spellcheck="false"
      />
      <button class="knopf" type="submit">{t['armory.search.submit']}</button>
    </form>

    {#if !liste}
      <p class="leer-zustand">{t[KAMMER_FEHLER[data.fehler ?? 'aus']]}</p>
    {:else if liste.eintraege.length === 0}
      <p class="leer-zustand">
        {suchLeer || liste.suche === '' ? t['armory.state.empty'] : t['armory.state.no_match']}
      </p>
    {:else}
      {#if data.q !== '' && liste.suche === ''}
        <p class="hinweis note">{t['armory.search.too_short']}</p>
      {/if}
      <p class="zaehler">{zaehlerText(liste.gesamt, t, lang)}</p>
      <div class="results">
        {#each liste.eintraege as r (r.id)}
          <a class="tafel-matt karte result" href={profilAdresse(kammer, r.id)}>
            <h3>{r.name}</h3>
            {#if r.klasse !== ''}
              <div class="result-sub">{klassenName(r.klasse, t)}</div>
            {/if}
            <div class="result-line">
              {#if r.zuletztGespielt !== null}
                {t['character_profile.last_seen']}
                {vorWieLange(isoVon(r.zuletztGespielt), lang)}
              {:else}
                {t['armory.card.never']}
              {/if}
            </div>
          </a>
        {/each}
      </div>

      {#if liste.seiten > 1}
        <nav class="seiten" aria-label={t['armory.pages.label']}>
          {#if liste.seite > 1}
            <a class="knopf knopf-schlicht" rel="prev" href={listenAdresse(kammer, data.q, liste.seite - 1)}
              >{t['armory.pages.prev']}</a
            >
          {:else}
            <span class="knopf knopf-schlicht aus" aria-hidden="true">{t['armory.pages.prev']}</span>
          {/if}
          <span>{fuelle(t['armory.pages.of'], {
              seite: zahlText(liste.seite, lang),
              seiten: zahlText(liste.seiten, lang),
            })}</span>
          {#if liste.seite < liste.seiten}
            <a class="knopf knopf-schlicht" rel="next" href={listenAdresse(kammer, data.q, liste.seite + 1)}
              >{t['armory.pages.next']}</a
            >
          {:else}
            <span class="knopf knopf-schlicht aus" aria-hidden="true">{t['armory.pages.next']}</span>
          {/if}
        </nav>
      {/if}
    {/if}
  {/if}
</main>

<style>
  /* Die breiteste der vier Unterseiten: das Profil stellt zwei Spalten
     nebeneinander, und die rechte darf nicht zur Rinne werden. */
  .armory-page {
    width: min(1200px, 100%);
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
    margin: 0 0 1.5rem;
    max-width: 44rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  /* ------------------------------------------------------------- Suche */

  .search {
    margin: 1.5rem 0 2rem;
  }

  /* Etwas breiter als die Regel in wov.css (14rem): Der Platzhalter nennt
     drei Möglichkeiten und soll nicht abgeschnitten werden. */
  .search .feld {
    flex: 1 1 16rem;
    padding: 0.8rem 1rem;
  }

  /* ---------------------------------------------------------- Treffer */

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 20px;
  }

  .result {
    padding: 1.2rem 1.3rem;
  }

  /* Drei Stufen im Text der Karte: Name gold, Zeile darunter matt, die
     Nebensachen noch eine Stufe zurück. */
  .result h3 {
    margin: 0 0 0.2em;
  }

  .result-sub {
    color: var(--text-matt);
    font-size: 14px;
  }

  .result-line {
    margin-top: 0.7rem;
    font-size: 13px;
    color: var(--umriss);
  }

  /* ------------------------------------------------------------ Seiten */

  .zaehler {
    margin: 0 0 1rem;
    color: var(--text-matt);
    font-size: 14px;
  }

  .seiten {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-top: 2rem;
  }

  .seiten .knopf {
    padding: 0.6rem 1.1rem;
    font-size: 12px;
    text-transform: uppercase;
  }

  .seiten .aus {
    opacity: 0.4;
  }

  /* ---------------------------------------------------------- Zurück */

  .back {
    margin-bottom: 1.5rem;
    padding: 0.7rem 1.2rem;
    font-size: 12px;
    text-transform: uppercase;
  }
</style>
