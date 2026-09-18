<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages } from '$lib/i18n';
  import { datumZeit } from '$lib/formate';
  import {
    erledigeMeldung,
    fehlerSchluessel,
    holeMeldungen,
    holeModerator,
    loescheBeitrag,
    type Meldung,
  } from '$lib/forumClient';

  /*
    Die Meldungsliste — nur fuer Moderatoren. Die Seite rendert ihre Huelle
    serverseitig und holt die Daten im Browser (dort liegt das Kontotoken);
    ist man kein Moderator, sagt sie das, statt leer zu bleiben.

    Der Server prueft bei JEDER Anfrage die Rechte; diese Seite zeigt nur,
    was er ohnehin liefert.
  */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let zustand = $state<'laedt' | 'kein' | 'liste' | 'fehler'>('laedt');
  let reports = $state<Meldung[]>([]);
  let busy = $state(0);
  let fehler = $state('');

  async function laden(): Promise<void> {
    zustand = 'laedt';
    try {
      if (!(await holeModerator()).moderator) {
        zustand = 'kein';
        return;
      }
      reports = (await holeMeldungen()).reports;
      zustand = 'liste';
    } catch {
      zustand = 'fehler';
    }
  }

  onMount(laden);

  async function erledigen(id: number): Promise<void> {
    busy = id;
    fehler = '';
    try {
      await erledigeMeldung(id);
      await laden();
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = 0;
    }
  }

  async function entfernen(postId: number): Promise<void> {
    busy = postId;
    fehler = '';
    try {
      await loescheBeitrag(postId);
      await laden();
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = 0;
    }
  }

  const iso = (ms: number) => new Date(ms).toISOString();
</script>

<Kopfdaten titel={`${t['thing.mod.reports']} — ${t['thing.title']}`} beschreibung={t['thing.description']} />

<main class="mitte seite thing-page">
  <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.heading']}</a>
  <h1>{t['thing.mod.reports']}</h1>

  {#if zustand === 'laedt'}
    <p class="leise">{t['thing.write.busy']}</p>
  {:else if zustand === 'kein'}
    <div class="hinweis">{t['thing.mod.not_moderator']}</div>
  {:else if zustand === 'fehler'}
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  {:else if reports.length === 0}
    <div class="hinweis">{t['thing.mod.empty']}</div>
  {:else}
    {#each reports as m (m.id)}
      <article class="meldung tafel">
        <header>
          <a class="titel" href={`/${lang}/thing/${m.board}/${m.threadId}`}>{m.threadTitle}</a>
          <span class="meta">{m.authorName} · {datumZeit(iso(m.createdAt), lang)}</span>
        </header>
        {#if m.grund}<p class="grund">„{m.grund}"</p>{/if}
        <pre class="text">{m.bodyMd}</pre>
        <div class="werkzeuge">
          <button type="button" class="knopf" onclick={() => erledigen(m.id)} disabled={busy === m.id}>
            {t['thing.mod.resolve']}
          </button>
          <button
            type="button"
            class="knopf knopf-rand"
            onclick={() => entfernen(m.postId)}
            disabled={busy === m.postId}
          >
            {t['thing.mod.delete_post']}
          </button>
        </div>
      </article>
    {/each}
    {#if fehler}<p class="fehler">{fehler}</p>{/if}
  {/if}
</main>

<style>
  .thing-page {
    width: min(900px, 100%);
  }
  .zurueck {
    display: inline-block;
    margin-bottom: 0.8rem;
    color: var(--text-matt);
    text-decoration: none;
    font-size: 15px;
  }
  .zurueck:hover {
    color: var(--primaer);
  }
  h1 {
    margin: 0 0 1.2rem;
    font-size: clamp(24px, 4vw, 34px);
  }
  .meldung {
    margin-bottom: 1rem;
    padding: 0.9rem 1.1rem;
  }
  .meldung header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }
  .titel {
    color: var(--primaer);
    text-decoration: none;
    font-weight: 600;
  }
  .titel:hover {
    text-decoration: underline;
  }
  .meta {
    color: var(--umriss);
    font-size: 13px;
  }
  .grund {
    margin: 0 0 0.4rem;
    color: var(--text-matt);
    font-style: italic;
  }
  .text {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .werkzeuge {
    display: flex;
    gap: 0.8rem;
  }
  .leise {
    color: var(--text-matt);
  }
  .fehler {
    color: #e39a8f;
  }
</style>
