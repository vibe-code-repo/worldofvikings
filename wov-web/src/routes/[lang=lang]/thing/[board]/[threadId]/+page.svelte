<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import ForumBeitrag from '$lib/ForumBeitrag.svelte';
  import ForumSchreiben from '$lib/ForumSchreiben.svelte';
  import { localeFrom, messages, type MessageKey } from '$lib/i18n';
  import { datumZeit } from '$lib/formate';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const iso = (ms: number) => new Date(ms).toISOString();
  const brettName = (slug: string) => t[`thing.boards.${slug}.name` as MessageKey];
  const seiteUrl = (n: number) =>
    `/${lang}/thing/${data.thread?.board ?? ''}/${data.thread?.id ?? ''}?page=${n}`;
</script>

{#if data.thread}
  <Kopfdaten titel={`${data.thread.title} — ${t['thing.title']}`} beschreibung={data.thread.title} />

  <main class="mitte seite thing-page">
    <a class="zurueck" href={`/${lang}/thing/${data.thread.board}`}>
      ← {brettName(data.thread.board)}
    </a>

    <h1>{data.thread.title}</h1>
    <p class="meta-kopf">
      {t['thing.threads.opened_by']} {data.thread.authorName} · {datumZeit(iso(data.thread.createdAt), lang)}
    </p>

    {#each data.posts as post (post.id)}
      <ForumBeitrag {post} />
    {/each}

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

    {#if data.thread.locked}
      <div class="hinweis">{t['thing.thread.locked']}</div>
    {:else}
      <ForumSchreiben modus="antwort" threadId={data.thread.id} />
    {/if}
  </main>
{:else}
  <Kopfdaten titel={t['thing.title']} beschreibung={t['thing.description']} />
  <main class="mitte seite thing-page">
    <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.boards.back']}</a>
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  </main>
{/if}

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
    margin: 0 0 0.3rem;
    font-size: clamp(24px, 4vw, 34px);
  }

  .meta-kopf {
    margin: 0 0 1.4rem;
    color: var(--umriss);
    font-size: 14px;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1.4rem;
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
