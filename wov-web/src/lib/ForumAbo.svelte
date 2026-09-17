<script lang="ts">
  import { page } from '$app/state';
  import { localeFrom, messages } from '$lib/i18n';
  import { aboSchalter, aboStatus, eigenesKonto } from '$lib/forumClient';

  /*
    „Diesem Thema folgen" — ein Umschalter an der Themenseite, nur fuer
    Angemeldete. Wer ein Thema eroeffnet oder beantwortet, folgt bereits
    automatisch (serverseitig); hier geht es um die bewusste Wahl.
  */
  let { threadId }: { threadId: number } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let sichtbar = $state(false);
  let folgt = $state(false);
  let busy = $state(false);

  $effect(() => {
    let abgebrochen = false;
    void (async () => {
      const konto = await eigenesKonto();
      if (abgebrochen || !konto.angemeldet) return;
      sichtbar = true;
      try {
        folgt = (await aboStatus(threadId)).subscribed;
      } catch {
        /* still — der Umschalter ist Beiwerk. */
      }
    })();
    return () => {
      abgebrochen = true;
    };
  });

  async function schalten(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      folgt = (await aboSchalter(threadId, !folgt)).subscribed;
    } catch {
      /* still */
    } finally {
      busy = false;
    }
  }
</script>

{#if sichtbar}
  <button type="button" class="werkzeug" onclick={schalten} disabled={busy} aria-pressed={folgt}>
    {folgt ? t['thing.follow.off'] : t['thing.follow.on']}
  </button>
{/if}

<style>
  .werkzeug {
    border: 0;
    background: none;
    color: var(--primaer);
    font-size: 14px;
    cursor: pointer;
    padding: 0;
  }
  .werkzeug:hover {
    text-decoration: underline;
  }
  .werkzeug:disabled {
    color: var(--umriss);
    cursor: default;
  }
</style>
