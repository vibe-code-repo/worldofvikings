<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { datumZeit } from '$lib/formate';
  import { localeFrom, messages } from '$lib/i18n';
  import ForumReaktionen from '$lib/ForumReaktionen.svelte';
  import type { ReactionCount } from '@wov/shared';
  import {
    bearbeiteBeitrag,
    eigenesKonto,
    fehlerSchluessel,
    loescheBeitrag,
    melde,
  } from '$lib/forumClient';

  /*
    Ein Beitrag samt Werkzeugen — Bearbeiten und Loeschen nur am EIGENEN
    Beitrag. Der Server prueft das ohnehin (Rechte in SQL); hier wird nur
    entschieden, ob die Knoepfe ueberhaupt erscheinen.

    Ob der Beitrag mir gehoert, weiss der Browser aus dem eigenen Konto
    (`eigenesKonto()`); das ist reine Anzeige, keine Sicherheit.
  */
  interface Beitrag {
    id: number;
    threadId: number;
    authorName: string;
    authorCharacterId: number | null;
    bodyMd: string;
    html: string;
    createdAt: number;
    editedAt: number | null;
    deletedAt: number | null;
    reactions: readonly ReactionCount[];
  }

  let { post }: { post: Beitrag } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
  const iso = (ms: number) => new Date(ms).toISOString();

  let meiner = $state(false);
  let angemeldet = $state(false);
  let meldung = $state('');
  let bearbeiten = $state(false);
  let entwurf = $state('');
  let busy = $state(false);
  let fehler = $state('');

  onMount(async () => {
    const konto = await eigenesKonto();
    angemeldet = konto.angemeldet;
    if (post.authorCharacterId === null) return;
    meiner = konto.charaktere.some((c) => c.id === post.authorCharacterId);
  });

  function oeffneBearbeiten(): void {
    entwurf = post.bodyMd;
    fehler = '';
    bearbeiten = true;
  }

  async function speichern(): Promise<void> {
    if (busy || post.authorCharacterId === null) return;
    fehler = '';
    busy = true;
    try {
      await bearbeiteBeitrag(post.id, { body: entwurf, characterId: post.authorCharacterId });
      bearbeiten = false;
      await invalidateAll();
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }

  async function loeschen(): Promise<void> {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(t['thing.write.delete'] + '?')) return;
    fehler = '';
    busy = true;
    try {
      await loescheBeitrag(post.id);
      await invalidateAll();
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }

  /** Eine Meldung: eine Nachricht an die Moderation, keine Handlung. */
  async function melden(): Promise<void> {
    if (busy) return;
    const grund = typeof window !== 'undefined'
      ? (window.prompt(t['thing.mod.report_prompt']) ?? '')
      : '';
    fehler = '';
    busy = true;
    try {
      await melde(post.id, grund);
      meldung = t['thing.mod.reported'];
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }
</script>

<article class="beitrag">
  <header>
    <span class="autor">{post.authorName}</span>
    <span class="zeit">{datumZeit(iso(post.createdAt), lang)}</span>
    {#if post.editedAt}<span class="bearbeitet">{t['thing.post.edited']}</span>{/if}
  </header>

  {#if bearbeiten}
    <textarea bind:value={entwurf} rows="6" maxlength="20000"></textarea>
    <div class="werkzeuge">
      <button type="button" class="knopf" onclick={speichern} disabled={busy}>
        {busy ? t['thing.write.busy'] : t['thing.write.save']}
      </button>
      <button type="button" class="knopf knopf-rand" onclick={() => (bearbeiten = false)} disabled={busy}>
        {t['thing.write.cancel']}
      </button>
    </div>
    {#if fehler}<p class="fehler">{fehler}</p>{/if}
  {:else if post.deletedAt}
    <p class="entfernt">{t['thing.post.deleted']}</p>
  {:else}
    <!--
      `{@html}` ist zulaessig: Die Zeichenkette stammt aus `renderMarkdown`
      (markdown-it, `html: false`, sichere Link-/Bild-Attribute) und wird
      serverseitig erzeugt.
    -->
    <div class="inhalt">{@html post.html}</div>
  {/if}

  {#if !post.deletedAt && !bearbeiten}
    <ForumReaktionen postId={post.id} threadId={post.threadId} reactions={post.reactions} {angemeldet} />
    <div class="werkzeuge">
      {#if meiner}
        <button type="button" class="werkzeug" onclick={oeffneBearbeiten}>{t['thing.write.edit']}</button>
        <button type="button" class="werkzeug" onclick={loeschen} disabled={busy}>{t['thing.write.delete']}</button>
      {:else if angemeldet}
        <button type="button" class="werkzeug" onclick={melden} disabled={busy}>{t['thing.mod.report']}</button>
      {/if}
      {#if meldung}<span class="gemeldet">{meldung}</span>{/if}
    </div>
  {/if}
</article>

<style>
  .beitrag {
    margin-bottom: 1.1rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--umriss);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  header {
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

  textarea {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--umriss);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font: inherit;
    line-height: 1.5;
    resize: vertical;
  }

  .werkzeuge {
    display: flex;
    gap: 0.8rem;
    margin-top: 0.6rem;
  }
  .werkzeug {
    border: 0;
    background: none;
    color: var(--umriss);
    font-size: 13px;
    cursor: pointer;
    padding: 0;
  }
  .werkzeug:hover {
    color: var(--primaer);
    text-decoration: underline;
  }
  .fehler {
    margin: 0.4rem 0 0;
    color: #e39a8f;
  }
  .gemeldet {
    color: var(--text-matt);
    font-size: 13px;
  }
</style>
