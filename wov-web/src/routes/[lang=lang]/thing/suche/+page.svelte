<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages, localizedPath, type MessageKey } from '$lib/i18n';
  import { datumKurz } from '$lib/formate';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const iso = (ms: number) => new Date(ms).toISOString();
  const name = (slug: string) => t[`thing.boards.${slug}.name` as MessageKey];
  const themenUrl = (board: string, threadId: number) => `/${lang}/thing/${board}/${threadId}`;
  const suchUrl = $derived(localizedPath(lang, '/thing/suche'));
  const seiteUrl = (n: number) => `${suchUrl}?q=${encodeURIComponent(data.q)}&page=${n}`;
</script>

<Kopfdaten
  titel={`${t['thing.search.heading']} — ${t['thing.title']}`}
  beschreibung={t['thing.description']}
/>

<main class="mitte seite thing-page">
  <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.heading']}</a>
  <h1>{t['thing.search.heading']}</h1>

  <form class="suche" method="GET" action={suchUrl} role="search">
    <input
      type="search"
      name="q"
      value={data.q}
      placeholder={t['thing.search.placeholder']}
      aria-label={t['thing.search.placeholder']}
      maxlength="120"
    />
    <button type="submit" class="knopf">{t['thing.search.button']}</button>
  </form>

  {#if !data.erreichbar}
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  {:else if data.q !== ''}
    <p class="stand">
      {t['thing.search.for']} „{data.q}" — {data.total} {t['thing.search.hits']}
    </p>

    {#if data.results.length === 0}
      <div class="hinweis">{t['thing.search.empty']}</div>
    {:else}
      <div class="tafel trefferliste">
        {#each data.results as treffer (treffer.postId)}
          <article class="treffer">
            <a class="titel" href={themenUrl(treffer.board, treffer.threadId)}>{treffer.title}</a>
            <span class="meta">
              {name(treffer.board)} · {treffer.authorName} · {datumKurz(iso(treffer.createdAt), lang)}
            </span>
            <p class="text">{treffer.snippet}</p>
          </article>
        {/each}
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
    margin: 0 0 1rem;
    font-size: clamp(26px, 4.5vw, 38px);
  }

  .suche {
    display: flex;
    gap: 0.6rem;
    margin: 0 0 1.4rem;
  }
  .suche input {
    flex: 1;
    min-width: 0;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--umriss);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font-size: 16px;
  }
  .suche input:focus {
    outline: none;
    border-color: var(--primaer);
  }

  .stand {
    margin: 0 0 1rem;
    color: var(--text-matt);
    font-size: 15px;
  }

  .treffer {
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--umriss);
  }
  .treffer:last-child {
    border-bottom: 0;
  }
  .titel {
    display: block;
    color: var(--primaer);
    text-decoration: none;
    font-size: 17px;
    font-weight: 600;
  }
  .titel:hover {
    text-decoration: underline;
  }
  .meta {
    display: block;
    margin-top: 0.15rem;
    color: var(--umriss);
    font-size: 13px;
  }
  .text {
    margin: 0.4rem 0 0;
    color: var(--text);
    font-size: 15px;
    line-height: 1.55;
    overflow-wrap: anywhere;
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
