<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';
  import { localeFrom, messages } from '$lib/i18n';
  import { fehlerSchluessel, holeModerator, threadSchalter } from '$lib/forumClient';

  /*
    Die Moderationswerkzeuge eines Themas (anheften, sperren) — nur fuer
    Moderatoren sichtbar. Ob man einer ist, sagt der Server
    (`GET /forum/moderator`); hier wird nur angezeigt oder nicht. Die Rechte
    prueft ohnehin jede Anfrage selbst.
  */
  let { thread }: { thread: { id: number; pinned: boolean; locked: boolean } } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let moderator = $state(false);
  let busy = $state(false);
  let fehler = $state('');

  onMount(async () => {
    try {
      moderator = (await holeModerator()).moderator;
    } catch {
      moderator = false;
    }
  });

  async function schalte(art: 'pin' | 'lock', wert: boolean): Promise<void> {
    if (busy) return;
    fehler = '';
    busy = true;
    try {
      await threadSchalter(thread.id, art, wert);
      await invalidateAll();
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }
</script>

{#if moderator}
  <section class="moderation">
    <span class="marke">{t['thing.mod.title']}</span>
    <button type="button" class="werkzeug" onclick={() => schalte('pin', !thread.pinned)} disabled={busy}>
      {thread.pinned ? t['thing.mod.unpin'] : t['thing.mod.pin']}
    </button>
    <button type="button" class="werkzeug" onclick={() => schalte('lock', !thread.locked)} disabled={busy}>
      {thread.locked ? t['thing.mod.unlock'] : t['thing.mod.lock']}
    </button>
    <a class="werkzeug" href={`/${lang}/thing/meldungen`}>{t['thing.mod.reports']}</a>
    {#if fehler}<span class="fehler">{fehler}</span>{/if}
  </section>
{/if}

<style>
  .moderation {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0 0 1rem;
    padding: 0.5rem 0.8rem;
    border: 1px dashed var(--umriss);
    border-radius: 8px;
  }
  .marke {
    color: var(--umriss);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .werkzeug {
    border: 0;
    background: none;
    color: var(--primaer);
    font-size: 14px;
    cursor: pointer;
    padding: 0;
    text-decoration: none;
  }
  .werkzeug:hover {
    text-decoration: underline;
  }
  .werkzeug:disabled {
    color: var(--umriss);
    cursor: default;
  }
  .fehler {
    color: #e39a8f;
    font-size: 13px;
  }
</style>
