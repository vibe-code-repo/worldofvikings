<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import ForumSchreiben from '$lib/ForumSchreiben.svelte';
  import { localeFrom, messages, type MessageKey } from '$lib/i18n';
  import { datumKurz, vorWieLange } from '$lib/formate';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const iso = (ms: number) => new Date(ms).toISOString();
  const name = (slug: string) => t[`thing.boards.${slug}.name` as MessageKey];
  const zweck = (slug: string) => t[`thing.boards.${slug}.description` as MessageKey];
  const themenUrl = (id: number) => `/${lang}/thing/${data.board}/${id}`;
  const seiteUrl = (n: number) => `/${lang}/thing/${data.board}?page=${n}`;
</script>

<Kopfdaten
  titel={`${name(data.board)} — ${t['thing.title']}`}
  beschreibung={zweck(data.board)}
/>

<main class="mitte seite thing-page">
  <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.boards.back']}</a>

  <h1>{name(data.board)}</h1>
  <p class="intro">{zweck(data.board)}</p>

  {#if !data.erreichbar}
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  {:else}
    {#if data.threads.length === 0}
      <div class="hinweis">{t['thing.board.empty']}</div>
    {:else}
      <div class="tafel tafel-tabelle">
        <div class="rollbar">
          <table class="tabelle">
            <thead>
              <tr>
                <th>{t['thing.threads.table.thread']}</th>
                <th class="zahl">{t['thing.threads.table.replies']}</th>
                <th class="zahl">{t['thing.threads.table.last']}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.threads as thema (thema.id)}
                <tr>
                  <td class="thread">
                    <a class="thread-titel" href={themenUrl(thema.id)}>{thema.title}</a>
                    {#if thema.pinned}<span class="marke">{t['thing.thread.pinned']}</span>{/if}
                    {#if thema.locked}<span class="marke">{t['thing.thread.locked']}</span>{/if}
                    <span class="meta">
                      {t['thing.threads.opened_by']} {thema.authorName} · {datumKurz(iso(thema.createdAt), lang)}
                    </span>
                  </td>
                  <td class="zahl">{Math.max(0, thema.postCount - 1)}</td>
                  <td class="zahl">{vorWieLange(iso(thema.lastPostAt), lang)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      {#if data.pageCount > 1}
        <nav class="pager" aria-label="Seiten">
          {#if data.page > 1}
            <a href={seiteUrl(data.page - 1)}>{t['thing.pager.prev']}</a>
          {:else}<span></span>{/if}
          <span class="pager-stand">
            {t['thing.pager.page']} {data.page} {t['thing.pager.of']} {data.pageCount}
          </span>
          {#if data.page < data.pageCount}
            <a href={seiteUrl(data.page + 1)}>{t['thing.pager.next']}</a>
          {:else}<span></span>{/if}
        </nav>
      {/if}
    {/if}

    <ForumSchreiben modus="thema" brett={data.board} />
  {/if}
</main>

<style>
  .thing-page {
    width: min(1100px, 100%);
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
    margin: 0 0 0.4rem;
    font-size: clamp(26px, 4.5vw, 38px);
  }

  .intro {
    margin: 0 0 1.6rem;
    max-width: 46rem;
    color: var(--text-matt);
    font-size: 16px;
    line-height: 1.6;
  }

  .thread {
    line-height: 1.35;
  }
  .thread-titel {
    display: block;
    color: var(--primaer);
    text-decoration: none;
    font-size: 17px;
  }
  .thread-titel:hover {
    text-decoration: underline;
  }
  .meta {
    display: block;
    margin-top: 0.25rem;
    color: var(--umriss);
    font-size: 13px;
  }
  .marke {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0 0.45rem;
    border: 1px solid var(--umriss);
    border-radius: 999px;
    color: var(--text-matt);
    font-size: 12px;
    vertical-align: middle;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.2rem;
  }
  .pager a {
    color: var(--primaer);
    text-decoration: none;
  }
  .pager a:hover {
    text-decoration: underline;
  }
  .pager-stand {
    color: var(--text-matt);
    font-size: 14px;
  }
</style>
