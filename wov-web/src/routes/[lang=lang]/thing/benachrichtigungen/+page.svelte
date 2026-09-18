<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages } from '$lib/i18n';
  import { datumZeit } from '$lib/formate';
  import { eigenesKonto, holeBenachrichtigungen, leseBenachrichtigungen } from '$lib/forumClient';
  import type { ForumNotification } from '@wov/shared';

  /*
    Die Liste der Benachrichtigungen. Sie wird beim Aufruf gelesen, und
    erst NACH dem Anzeigen als gelesen markiert: Der Punkt am Eintrag zeigt
    noch, was neu war — sonst waere die Liste beim Blick darauf schon
    stummgeschaltet.
  */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let zustand = $state<'laedt' | 'kein' | 'liste' | 'fehler'>('laedt');
  let meldungen = $state<ForumNotification[]>([]);

  const iso = (ms: number) => new Date(ms).toISOString();
  const artText = (n: ForumNotification) =>
    n.kind === 'mention' ? t['thing.notifications.mention'] : t['thing.notifications.reply'];

  onMount(async () => {
    try {
      if (!(await eigenesKonto()).angemeldet) {
        zustand = 'kein';
        return;
      }
      const d = await holeBenachrichtigungen();
      meldungen = d.notifications;
      zustand = 'liste';
      if (d.unread > 0) await leseBenachrichtigungen();
    } catch {
      zustand = 'fehler';
    }
  });
</script>

<Kopfdaten
  titel={`${t['thing.notifications.heading']} — ${t['thing.title']}`}
  beschreibung={t['thing.description']}
/>

<main class="mitte seite thing-page">
  <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.heading']}</a>
  <h1>{t['thing.notifications.heading']}</h1>

  {#if zustand === 'laedt'}
    <p class="leise">{t['thing.write.busy']}</p>
  {:else if zustand === 'kein'}
    <div class="hinweis">{t['thing.write.error.not-signed-in']}</div>
  {:else if zustand === 'fehler'}
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  {:else if meldungen.length === 0}
    <div class="hinweis">{t['thing.notifications.empty']}</div>
  {:else}
    <div class="tafel meldungsliste">
      {#each meldungen as n (n.id)}
        <article class="meldung" class:neu={n.readAt === null}>
          <a class="ziel" href={`/${lang}/thing/${n.board}/${n.threadId}`}>
            <span class="wer">{n.fromName}</span>
            <span class="art">{artText(n)}</span>
            <span class="zeit">{datumZeit(iso(n.createdAt), lang)}</span>
          </a>
          {#if n.excerpt}<p class="text">{n.excerpt}</p>{/if}
          {#if n.readAt === null}<span class="punkt" aria-hidden="true"></span>{/if}
        </article>
      {/each}
    </div>
  {/if}
</main>

<style>
  .thing-page {
    width: min(800px, 100%);
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
  .leise {
    color: var(--text-matt);
  }
  .meldung {
    position: relative;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--umriss);
  }
  .meldung:last-child {
    border-bottom: 0;
  }
  .meldung.neu {
    background: rgba(242, 202, 80, 0.06);
  }
  .ziel {
    display: block;
    color: var(--text);
    text-decoration: none;
  }
  .ziel:hover .wer {
    text-decoration: underline;
  }
  .wer {
    color: var(--primaer);
    font-weight: 600;
  }
  .art {
    color: var(--text-matt);
  }
  .zeit {
    display: block;
    margin-top: 0.15rem;
    color: var(--umriss);
    font-size: 13px;
  }
  .text {
    margin: 0.35rem 0 0;
    color: var(--text-matt);
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .punkt {
    position: absolute;
    top: 0.95rem;
    right: 1rem;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--primaer);
  }
</style>
