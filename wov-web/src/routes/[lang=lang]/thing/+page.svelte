<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages, localizedPath, type MessageKey } from '$lib/i18n';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /*
    Die Bretter kommen als Slugs aus der API; Name und Zweck stehen in der
    Sprachdatei unter `thing.boards.<slug>.name` / `.description`. Der
    Slug ist der Vertrag (shared/src/forum/types.ts), die Beschriftung ist
    Text — so bleibt das Forum zweisprachig, ohne dass die Datenbank
    Beschriftungen traegt.
  */
  const name = (slug: string) => t[`thing.boards.${slug}.name` as MessageKey];
  const zweck = (slug: string) => t[`thing.boards.${slug}.description` as MessageKey];
  const brettUrl = (slug: string) => `/${lang}/thing/${slug}`;
</script>

<Kopfdaten titel={t['thing.title']} beschreibung={t['thing.description']} />

<main class="mitte seite thing-page">
  <span class="runen kicker" aria-hidden="true">ᚦᛁᛜ</span>
  <h1>{t['thing.heading']}</h1>

  <p class="intro">
    {t['thing.intro.prefix']}
    <i>{t['thing.intro.name']}</i>
    {t['thing.intro.suffix']}
  </p>

  <form class="suche" method="GET" action={localizedPath(lang, '/thing/suche')} role="search">
    <input
      type="search"
      name="q"
      placeholder={t['thing.search.placeholder']}
      aria-label={t['thing.search.placeholder']}
      maxlength="120"
    />
    <button type="submit" class="knopf">{t['thing.search.button']}</button>
  </form>

  {#if !data.erreichbar}
    <div class="hinweis">
      <b>{t['thing.unreachable']}</b>
    </div>
  {:else}
    <div class="tafel tafel-tabelle boards">
      <div class="rollbar">
        <table class="tabelle">
          <thead>
            <tr>
              <th>{t['thing.boards.table.board']}</th>
              <th>{t['thing.boards.table.purpose']}</th>
              <th class="zahl">{t['thing.boards.table.posts']}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.boards as brett (brett.slug)}
              <tr>
                <td class="board-name"><a href={brettUrl(brett.slug)}>{name(brett.slug)}</a></td>
                <td>{zweck(brett.slug)}</td>
                <td class="zahl board-count">{brett.postCount}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</main>

<style>
  .thing-page {
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

  .intro {
    margin: 0 0 1.5rem;
    max-width: 46rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  .suche {
    display: flex;
    gap: 0.6rem;
    margin: 0 0 1.6rem;
    max-width: 34rem;
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

  .boards {
    margin-top: 0.5rem;
  }

  .boards .board-name a {
    color: var(--primaer);
    text-decoration: none;
  }
  .boards .board-name a:hover {
    text-decoration: underline;
  }

  .boards .board-count {
    color: var(--text-matt);
  }
</style>
