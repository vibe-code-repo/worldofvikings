<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import {
    eigenesKonto,
    fehlerSchluessel,
    neueAntwort,
    neuesThema,
    type EigenesKonto,
  } from '$lib/forumClient';

  /*
    Ein Bauteil fuer beide Faelle: neues Thema (im Brett) und Antwort (im
    Thema). Der Unterschied ist EIN Feld (Titel) und das Ziel nach dem
    Senden — zwei getrennte Bauteile waeren zwei Stellen, an denen die
    Charakter-Auswahl und die Fehlerbehandlung gepflegt werden muessten.

    Der Konto-Zustand kommt aus `forumClient.eigenesKonto()` (einmal je
    Sitzung geladen). Ist niemand angemeldet, zeigt das Bauteil den Hinweis
    statt eines Formulars.
  */
  let {
    modus,
    brett = '',
    threadId = 0,
  }: { modus: 'thema' | 'antwort'; brett?: string; threadId?: number } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let konto = $state<EigenesKonto | null>(null);
  let charId = $state(0);
  let titel = $state('');
  let text = $state('');
  let busy = $state(false);
  let fehler = $state('');

  onMount(async () => {
    konto = await eigenesKonto();
    if (konto.charaktere.length > 0) charId = konto.charaktere[0]!.id;
  });

  async function absenden(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy || !konto) return;
    fehler = '';
    busy = true;
    try {
      if (modus === 'thema') {
        const r = await neuesThema(brett, { title: titel, body: text, characterId: charId });
        await goto(`/${lang}/thing/${brett}/${r.threadId}`);
      } else {
        await neueAntwort(threadId, { body: text, characterId: charId });
        text = '';
        await invalidateAll();
      }
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }
</script>

<section class="schreiben tafel">
  <h2>{modus === 'thema' ? t['thing.write.new_thread'] : t['thing.write.reply']}</h2>

  {#if konto === null}
    <p class="leise">{t['thing.write.busy']}</p>
  {:else if !konto.angemeldet}
    <p class="leise">
      <a href={localizedPath(lang, '/anmelden')}>{t['thing.write.signin_hint']}</a>
    </p>
  {:else if konto.charaktere.length === 0}
    <p class="leise">{t['thing.write.no_character']}</p>
  {:else}
    <form onsubmit={absenden}>
      {#if modus === 'thema'}
        <label class="feld">
          <span>{t['thing.write.title']}</span>
          <input type="text" bind:value={titel} maxlength="120" required />
        </label>
      {/if}

      <label class="feld">
        <span>{t['thing.write.body']}</span>
        <textarea bind:value={text} rows="6" maxlength="20000" required></textarea>
        <small>{t['thing.write.markdown_hint']}</small>
      </label>

      <div class="zeile">
        <label class="feld feld-klein">
          <span>{t['thing.write.as']}</span>
          <select bind:value={charId}>
            {#each konto.charaktere as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </label>

        <button class="knopf" type="submit" disabled={busy}>
          {busy
            ? t['thing.write.busy']
            : modus === 'thema'
              ? t['thing.write.submit_thread']
              : t['thing.write.submit_reply']}
        </button>
      </div>

      {#if fehler}
        <p class="fehler">{fehler}</p>
      {/if}
    </form>
  {/if}
</section>

<style>
  .schreiben {
    margin-top: 1.6rem;
    padding: 1rem 1.1rem;
  }
  h2 {
    margin: 0 0 0.9rem;
    font-size: 20px;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .feld {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .feld span {
    color: var(--text-matt);
    font-size: 14px;
  }
  .feld small {
    color: var(--umriss);
    font-size: 12px;
  }
  input,
  textarea,
  select {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--umriss);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font: inherit;
  }
  textarea {
    resize: vertical;
    line-height: 1.5;
  }
  .zeile {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .feld-klein {
    min-width: 12rem;
  }
  .leise {
    margin: 0;
    color: var(--text-matt);
  }
  .leise a {
    color: var(--primaer);
  }
  .fehler {
    margin: 0;
    color: #e39a8f;
  }
</style>
