<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { TAFELN, type Recke } from '$lib/recken';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  /**
   * Die Ruhmeshalle im Entwurf "Rune & Iron".
   *
   * Diese Seite stand dem Entwurf schon am nächsten: Marken oben, darunter
   * eine Tafel mit rollbarer Tabelle. Neu sind die Runenzeile, die feste
   * Zeilenbreite des Intros und die gesperrte Versaloptik der Marken.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let recken = $state<Recke[]>([]);
  let fehler = $state(false);
  let geladen = $state(false);
  let aktiv = $state(TAFELN[0].id);

  const tafel = $derived(TAFELN.find((t2) => t2.id === aktiv) ?? TAFELN[0]);

  const sortiert = $derived(
    [...recken].sort((a, b) =>
      tafel.grossIstBesser ? tafel.wert(b) - tafel.wert(a) : tafel.wert(a) - tafel.wert(b)
    )
  );

  onMount(async () => {
    try {
      recken = (await holeJson<{ recken?: Recke[] }>('/api/recken.json')).recken ?? [];
    } catch (e) {
      console.error(e);
      fehler = true;
    }
    geladen = true;
  });
</script>

<Kopfdaten titel={t['hall_of_fame.title']} beschreibung={t['hall_of_fame.description']} />

<main class="mitte seite hall-page">
  <span class="runen kicker" aria-hidden="true">ᚱᚢᚺᛗ</span>
  <h1>{t['hall_of_fame.heading']}</h1>
  <p class="intro">{t['hall_of_fame.intro']}</p>

  <div class="hinweis note">
    <b>{t['hall_of_fame.hint.bold']}</b>
    {t['hall_of_fame.hint.text']}
  </div>

  <div class="marken tabs" role="tablist">
    {#each TAFELN as tf (tf.id)}
      <!--
        Welche Marke offen ist, steht in `aria-selected` — und genau daran
        hängt auch ihr Aussehen. Eine zweite Klasse daneben könnte
        auseinanderlaufen; ein Stil, der am Zustandsattribut hängt, kann das
        nicht.
      -->
      <button
        class="knopf knopf-schlicht"
        type="button"
        role="tab"
        aria-selected={tf.id === aktiv}
        onclick={() => (aktiv = tf.id)}>{t[tf.titel]}</button
      >
    {/each}
  </div>

  <div class="tafel tafel-tabelle">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th class="zahl">{t['hall_of_fame.table.hash']}</th>
            <th>{t['hall_of_fame.table.character']}</th>
            <th>{t['hall_of_fame.table.clan']}</th>
            <th class="zahl">{t[tafel.spalte]}</th>
          </tr>
        </thead>
        <tbody>
          {#if fehler}
            <tr><td colspan="4">{t['hall_of_fame.state.error']}</td></tr>
          {:else if !geladen}
            <tr><td colspan="4">{t['hall_of_fame.state.loading']}</td></tr>
          {:else}
            {#each sortiert as r, i (r.id)}
              <tr>
                <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                <td>
                  <a
                    href="{localizedPath(lang, '/ruestkammer')}?reck={encodeURIComponent(r.id)}"
                    >{r.name}</a
                  >
                  <span class="byname">{r.beiname}</span>
                </td>
                <td>{r.sippe}</td>
                <td class="zahl">{tafel.zeigen(r)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
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

  .note {
    margin-bottom: 2rem;
  }

  .tabs {
    margin-bottom: 1.2rem;
  }

  .tabs button {
    padding: 0.7rem 1.2rem;
    font-size: 12px;
    text-transform: uppercase;
  }

  .tabs button[aria-selected='true'] {
    color: var(--runengold);
    border-color: var(--umriss);
  }

  /* Der Beiname steht hinter dem verlinkten Namen und ist kein Link — er
     muss sich davon absetzen, sonst liest sich die Zelle als ein Name. */
  .byname {
    color: var(--text-matt);
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
