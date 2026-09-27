<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    ApiError,
    type ShoreId,
    errorMessageKey,
    readToken,
    reportProfile,
    signedInShore,
  } from '$lib/account';
  import { type MessageKey, localeFrom, messages } from '$lib/i18n';

  /**
   * „Profiltext melden“ (Karte W3). Nur für Angemeldete: die Meldung geht mit
   * dem Konto-Token an den Spielserver. Die Seite selbst wird auf dem Server
   * gerendert und weiß nicht, wer sie liest; erst der Browser findet das
   * Token, deshalb erscheint der Knopf erst nach `onMount`.
   */
  let { characterId }: { characterId: number } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let shore = $state<ShoreId | null>(null);
  let open = $state(false);
  let reason = $state('');
  let busy = $state(false);
  let done = $state(false);
  let error = $state<MessageKey | null>(null);

  onMount(() => {
    shore = signedInShore();
  });

  async function send(e: Event) {
    e.preventDefault();
    if (busy || shore === null) return;
    const token = readToken(shore);
    if (!token) {
      shore = null;
      return;
    }
    busy = true;
    error = null;
    try {
      await reportProfile(shore, token, characterId, reason.trim());
      done = true;
      open = false;
      reason = '';
    } catch (err) {
      error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
    } finally {
      busy = false;
    }
  }
</script>

{#if shore !== null}
  <div class="melden">
    {#if done}
      <p class="fertig" role="status">{t['account.manage.report.done']}</p>
    {:else if !open}
      <button class="knopf knopf-rand" type="button" onclick={() => (open = true)}>
        {t['account.manage.report.button']}
      </button>
    {:else}
      <form onsubmit={send}>
        <label for="melden-grund">{t['account.manage.report.reason']}</label>
        <input id="melden-grund" type="text" maxlength="200" bind:value={reason} />
        {#if error}<p class="fehler" role="alert">{t[error]}</p>{/if}
        <button class="knopf knopf-rand" type="submit" disabled={busy}>
          {t['account.manage.report.send']}
        </button>
      </form>
    {/if}
  </div>
{/if}

<style>
  .melden {
    margin-top: 0.8rem;
    font-size: 14px;
  }
  form {
    display: grid;
    gap: 0.4rem;
    max-width: 420px;
  }
  input {
    font: inherit;
    padding: 0.4rem 0.6rem;
  }
  .fehler {
    color: var(--fehler, #c0392b);
    margin: 0;
  }
  .fertig {
    color: var(--text-matt);
    margin: 0;
  }
</style>
