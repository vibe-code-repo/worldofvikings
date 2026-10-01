<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { datumKurz } from '$lib/formate';
  import { isoVon, profilAdresse } from '$lib/reckenAnzeige';
  import { TAFELN, tafelZeilen } from '$lib/recken';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import type { PageData } from './$types';

  /**
   * Die Ruhmeshalle im Entwurf "Rune & Iron".
   *
   * Es stehen nur Tafeln da, für die das Spiel Daten hat. Rang, Wächter, Zeit
   * auf Fahrt und Tode gibt es erst, wenn das Spiel sie erfasst; der Hinweis
   * unten sagt das, statt erfundene Zahlen zu zeigen. Die Daten kommen
   * serverseitig (+page.server.ts), die Seite braucht kein JavaScript.
   */

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
  const kammer = $derived(localizedPath(lang, '/ruestkammer'));
  const tafel = TAFELN[0];
  const zeilen = $derived(tafelZeilen(tafel, data.eintraege));
</script>

<Kopfdaten titel={t['hall_of_fame.title']} beschreibung={t['hall_of_fame.description']} />

<main class="mitte seite hall-page">
  <span class="runen kicker" aria-hidden="true">ᚱᚢᚺᛗ</span>
  <h1>{t['hall_of_fame.heading']}</h1>
  <p class="intro">{t['hall_of_fame.intro']}</p>

  <h2 class="tafel-titel">{t[tafel.titel]}</h2>
  <div class="tafel tafel-tabelle">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th class="zahl">{t['hall_of_fame.table.hash']}</th>
            <th>{t['hall_of_fame.table.character']}</th>
            <th class="zahl">{t[tafel.spalte]}</th>
          </tr>
        </thead>
        <tbody>
          {#if !data.erreichbar}
            <tr><td colspan="3">{t['hall_of_fame.state.error']}</td></tr>
          {:else if zeilen.length === 0}
            <tr><td colspan="3">{t['hall_of_fame.state.empty']}</td></tr>
          {:else}
            {#each zeilen as z, i (z.eintrag.id)}
              <tr>
                <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                <td><a href={profilAdresse(kammer, z.eintrag.id)}>{z.eintrag.name}</a></td>
                <td class="zahl">{datumKurz(isoVon(z.wert), lang)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <div class="hinweis note">
    <b>{t['hall_of_fame.soon.bold']}</b>
    {t['hall_of_fame.soon.text']}
  </div>
</main>

<style>
  .hall-page {
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

  /* Enger als auf der Saga: Hier folgt gleich ein Hinweiskasten, und zwei
     Blöcke mit 2.5rem dazwischen fielen auseinander. */
  .intro {
    margin: 0 0 1.5rem;
    max-width: 44rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  .tafel-titel {
    margin: 0 0 1rem;
    font-size: 22px;
  }

  .note {
    margin-top: 2rem;
  }

  /*
    Gold, Silber, Bronze auf den ersten drei Plätzen — der Entwurf färbt die
    Platzziffer, und wov.css hält die drei Farben längst bereit.

    Warum die Regeln hier stehen und nicht dort: `.rang-1` ist eine Klasse
    (0,1,0), `.tabelle td` ist Klasse plus Element (0,1,1) und gewinnt. Die
    Platzziffern standen deshalb bisher alle in --text-matt; gemessen am
    24.08.2026 an Platz 1: rgb(208,197,175) statt Runengold. Die Zeile
    `td.rang-1` hier ist spezifisch genug — sauberer wäre dieselbe
    Verschärfung in wov.css, aber die Datei gehört zu dieser Aufgabe nicht.
  */
  .tabelle td.rang-1 {
    color: var(--runengold);
    font-weight: 700;
  }
  .tabelle td.rang-2 {
    color: var(--rank-silver);
  }
  .tabelle td.rang-3 {
    color: var(--rank-bronze);
  }
</style>
