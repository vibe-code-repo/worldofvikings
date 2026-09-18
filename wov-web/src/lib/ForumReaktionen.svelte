<script lang="ts">
  import { REACTION_KINDS, type ReactionCount, type ReactionKind } from '@wov/shared';
  import { page } from '$app/state';
  import { localeFrom, messages } from '$lib/i18n';
  import { fehlerSchluessel, holeThemenReaktionen, reaktion } from '$lib/forumClient';

  /*
    Die drei Reaktionen eines Beitrags. Angemeldete duerfen umschalten,
    Gaeste sehen nur die Zahlen (der Server liesse sie ohnehin nicht).

    Der Server antwortet mit dem neuen Stand GENAU dieser Art; den
    uebernimmt die Anzeige, statt selbst zu rechnen. Nach dem ersten Klick
    gilt der lokale Stand — die Seite wird dafuer nicht neu geladen, und
    ein zweiter Klick kann nicht auf einer alten Zahl aufsetzen.

    Die serverseitig gebaute Seite kennt die EIGENE Reaktion nicht (das
    Token liegt im Browser): darum holt dieser Baustein sie beim Mounten
    einmal je Thema nach, wenn man angemeldet ist.
  */
  let {
    postId,
    threadId,
    reactions,
    angemeldet,
  }: {
    postId: number;
    threadId: number;
    reactions: readonly ReactionCount[];
    angemeldet: boolean;
  } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let stand = $state<readonly ReactionCount[] | null>(null);
  let busy = $state(false);
  let fehler = $state('');

  // `angemeldet` kommt asynchron aus `eigenesKonto()` — deshalb ein
  // Effekt und kein `onMount`: Zur Mountzeit ist es noch falsch, und ein
  // einmaliger Lauf holte den eigenen Stand dann nie nach.
  $effect(() => {
    if (!angemeldet) return;
    let abgebrochen = false;
    void holeThemenReaktionen(threadId).then((karte) => {
      if (abgebrochen) return;
      const frisch = karte.get(postId);
      if (frisch) stand = frisch;
    });
    return () => {
      abgebrochen = true;
    };
  });

  const aktuell = $derived(stand ?? reactions);
  const zahl = (k: ReactionKind) => aktuell.find((r) => r.kind === k)?.count ?? 0;
  const eigen = (k: ReactionKind) => aktuell.find((r) => r.kind === k)?.me ?? false;

  async function klick(k: ReactionKind): Promise<void> {
    if (!angemeldet || busy) return;
    busy = true;
    fehler = '';
    try {
      const r = await reaktion(postId, k);
      stand = [
        ...aktuell.filter((x) => x.kind !== k),
        { kind: k, count: r.count, me: r.me },
      ];
    } catch (err) {
      fehler = t[fehlerSchluessel(err)];
    } finally {
      busy = false;
    }
  }
</script>

<div class="reaktionen">
  {#each REACTION_KINDS as k (k)}
    <button
      type="button"
      class="reaktion"
      class:aktiv={eigen(k)}
      aria-pressed={eigen(k)}
      onclick={() => klick(k)}
      disabled={!angemeldet || busy}
      title={angemeldet ? t[`thing.reactions.${k}`] : t['thing.write.error.not-signed-in']}
    >
      <span class="wort">{t[`thing.reactions.${k}`]}</span>
      {#if zahl(k) > 0}<span class="zahl">{zahl(k)}</span>{/if}
    </button>
  {/each}
  {#if fehler}<span class="fehler">{fehler}</span>{/if}
</div>

<style>
  .reaktionen {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.6rem;
  }
  .reaktion {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.55rem;
    border: 1px solid var(--umriss);
    border-radius: 999px;
    background: none;
    color: var(--text-matt);
    font-size: 13px;
    cursor: pointer;
  }
  .reaktion:hover:not(:disabled) {
    border-color: var(--primaer);
    color: var(--primaer);
  }
  .reaktion:disabled {
    cursor: default;
  }
  .reaktion:disabled:not(.aktiv) {
    opacity: 0.6;
  }
  .reaktion.aktiv {
    border-color: var(--primaer);
    color: var(--primaer);
  }
  .zahl {
    font-variant-numeric: tabular-nums;
  }
  .fehler {
    color: #e39a8f;
    font-size: 13px;
  }
</style>
