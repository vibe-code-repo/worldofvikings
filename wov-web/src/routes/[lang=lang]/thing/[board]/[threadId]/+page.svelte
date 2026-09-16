<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages, type MessageKey } from '$lib/i18n';
  import { datumZeit } from '$lib/formate';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const iso = (ms: number) => new Date(ms).toISOString();
  const brettName = (slug: string) => t[`thing.boards.${slug}.name` as MessageKey];
  const seiteUrl = (n: number) => `/${lang}/thing/${data.thread?.board ?? ''}/${data.thread?.id ?? ''}?page=${n}`;
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
      <article class="beitrag">
        <header>
          <span class="autor">{post.authorName}</span>
          <span class="zeit">{datumZeit(iso(post.createdAt), lang)}</span>
          {#if post.editedAt}<span class="bearbeitet">{t['thing.post.edited']}</span>{/if}
        </header>
        {#if post.deletedAt}
          <p class="entfernt">{t['thing.post.deleted']}</p>
        {:else}
          <!--
            `{@html}` ist hier zulaessig: Die Zeichenkette stammt aus
            `renderMarkdown` (markdown-it, `html: false`, sichere Link- und
            Bild-Attribute) und wird serverseitig erzeugt.
          -->
          <div class="inhalt">{@html post.html}</div>
        {/if}
      </article>
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

  .beitrag {
    margin-bottom: 1.1rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--umriss);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  .beitrag header {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .autor {
    color: var(--primaer);
    font-weight: 600;
  }
  .zeit {
    color: var(--umriss);
    font-size: 13px;
  }
  .bearbeitet {
    margin-left: auto;
    color: var(--umriss);
    font-size: 12px;
    font-style: italic;
  }

  /* Der gerenderte Markdown-Inhalt. */
  .inhalt {
    color: var(--text);
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  .inhalt :global(p) {
    margin: 0 0 0.7rem;
  }
  .inhalt :global(p:last-child) {
    margin-bottom: 0;
  }
  .inhalt :global(a) {
    color: var(--primaer);
  }
  .inhalt :global(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.92em;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.05em 0.3em;
    border-radius: 4px;
  }
  .inhalt :global(pre) {
    overflow-x: auto;
    padding: 0.7rem 0.9rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 6px;
  }
  .inhalt :global(blockquote) {
    margin: 0.6rem 0;
    padding-left: 0.8rem;
    border-left: 3px solid var(--umriss);
    color: var(--text-matt);
  }
  .inhalt :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
  }

  .entfernt {
    margin: 0;
    color: var(--umriss);
    font-style: italic;
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
