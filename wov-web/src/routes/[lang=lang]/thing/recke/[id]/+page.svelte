<script lang="ts">
  import { page } from '$app/state';
  import { augenfarbeZu, frisurZu, haarfarbeZu } from '@wov/shared';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages } from '$lib/i18n';
  import { datumKurz } from '$lib/formate';
  import type { PageData } from './$types';

  /*
    Das oeffentliche Thing-Profil: Name, Aussehen und was der Charakter
    geschrieben hat. Die Werte und die Ausruestung der Ruhmeshalle stehen
    hier NICHT — die liefert der Server (noch) nicht, und ein Platzhalter
    waere fuer jeden Recken derselbe (s. `Reckenprofil.svelte`).
  */
  let { data }: { data: PageData } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const iso = (ms: number) => new Date(ms).toISOString();
  const themenUrl = (board: string, id: number) => `/${lang}/thing/${board}/${id}`;
  const textAuszug = (md: string) =>
    md
      .replace(/[#*_>`~[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

  const frisur = $derived(data.charakter ? frisurZu(data.charakter.hairstyle).name : '');
  const haarfarbe = $derived(data.charakter ? haarfarbeZu(data.charakter.hairColor) : null);
  const augenfarbe = $derived(data.charakter ? augenfarbeZu(data.charakter.eyeColor) : null);
</script>

<Kopfdaten
  titel={data.charakter
    ? `${data.charakter.name} — ${t['thing.profile.heading']}`
    : t['thing.profile.unknown']}
  beschreibung={t['thing.description']}
/>

<main class="mitte seite thing-page">
  <a class="zurueck" href={`/${lang}/thing`}>← {t['thing.heading']}</a>

  {#if !data.erreichbar}
    <div class="hinweis"><b>{t['thing.unreachable']}</b></div>
  {:else if !data.charakter}
    <div class="hinweis">{t['thing.profile.unknown']}</div>
  {:else}
    <header class="kopf">
      <h1>{data.charakter.name}</h1>
      <p class="meta">
        {t['thing.profile.since']} {datumKurz(iso(data.charakter.created), lang)}
        {#if data.charakter.lastPlayed}· {t['thing.profile.last_played']}
          {datumKurz(iso(data.charakter.lastPlayed), lang)}{/if}
      </p>
    </header>

    <section class="tafel aussehen">
      <h2>{t['thing.profile.appearance']}</h2>
      <dl>
        <div><dt>{t['thing.profile.hair']}</dt><dd>{frisur}</dd></div>
        {#if haarfarbe}
          <div>
            <dt>{t['thing.profile.hair_color']}</dt>
            <dd><span class="fleck" style={`background:${haarfarbe.hex}`} aria-hidden="true"></span>{haarfarbe.name}</dd>
          </div>
        {/if}
        {#if augenfarbe}
          <div>
            <dt>{t['thing.profile.eye_color']}</dt>
            <dd><span class="fleck" style={`background:${augenfarbe.hex}`} aria-hidden="true"></span>{augenfarbe.name}</dd>
          </div>
        {/if}
      </dl>
    </section>

    <section class="tafel aktivitaet">
      <h2>{t['thing.profile.threads']}</h2>
      {#if !data.aktivitaet || data.aktivitaet.threads.length === 0}
        <p class="leer">{t['thing.profile.empty']}</p>
      {:else}
        <ul class="liste">
          {#each data.aktivitaet.threads as thema (thema.id)}
            <li>
              <a href={themenUrl(thema.board, thema.id)}>{thema.title}</a>
              <span class="zeit">{datumKurz(iso(thema.createdAt), lang)}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <h2>{t['thing.profile.posts']}</h2>
      {#if !data.aktivitaet || data.aktivitaet.posts.length === 0}
        <p class="leer">{t['thing.profile.empty']}</p>
      {:else}
        <ul class="liste">
          {#each data.aktivitaet.posts as beitrag (beitrag.id)}
            <li>
              <a href={themenUrl(beitrag.board, beitrag.threadId)}>{textAuszug(beitrag.bodyMd)}</a>
              <span class="zeit">{datumKurz(iso(beitrag.createdAt), lang)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
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
  .kopf {
    margin-bottom: 1.4rem;
  }
  h1 {
    margin: 0 0 0.3rem;
    font-size: clamp(28px, 5vw, 40px);
  }
  .meta {
    margin: 0;
    color: var(--text-matt);
    font-size: 15px;
  }

  .aussehen {
    margin-bottom: 1.4rem;
    padding: 1rem 1.2rem;
  }
  h2 {
    margin: 0 0 0.7rem;
    font-size: 16px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-matt);
  }
  .aktivitaet h2:not(:first-child) {
    margin-top: 1.4rem;
  }
  dl {
    display: grid;
    gap: 0.5rem;
    margin: 0;
  }
  dl > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--umriss);
    padding-bottom: 0.4rem;
  }
  dl > div:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  dt {
    color: var(--umriss);
  }
  dd {
    margin: 0;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .fleck {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--umriss);
    display: inline-block;
  }

  .aktivitaet {
    padding: 1rem 1.2rem;
  }
  .liste {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .liste li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--umriss);
  }
  .liste li:last-child {
    border-bottom: 0;
  }
  .liste a {
    color: var(--primaer);
    text-decoration: none;
  }
  .liste a:hover {
    text-decoration: underline;
  }
  .zeit {
    color: var(--umriss);
    font-size: 13px;
    white-space: nowrap;
  }
  .leer {
    margin: 0;
    color: var(--text-matt);
  }
</style>
