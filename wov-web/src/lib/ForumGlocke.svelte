<script lang="ts">
  import { page } from '$app/state';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import { eigenesKonto, holeBenachrichtigungen } from '$lib/forumClient';

  /*
    Die Glocke im Kopf: Zahl der Ungelesenen und ein Weg zur Liste.

    ── Warum Abfragen (Polling) und nicht der Spiel-WebSocket ───────────
    Der Spiel-WebSocket traegt das Spielprotokoll; die Webseite hat keine
    dauerhafte Verbindung dorthin. Fuer ein Glockensymbol eine zweite
    Verbindung aufzubauen und offen zu halten, waere mehr Maschinerie als
    Nutzen — alle 30 Sekunden einmal zu fragen kostet fast nichts und
    faellt aus, ohne irgendwen zu stoeren.

    Die Glocke erscheint nur, wenn jemand angemeldet ist (die Anmeldung
    lebt im Browser), und ein Fehler bleibt still: Sie ist Beiwerk.
  */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
  const ziel = $derived(localizedPath(lang, '/thing/benachrichtigungen'));

  let sichtbar = $state(false);
  let unread = $state(0);

  async function frage(): Promise<void> {
    try {
      unread = (await holeBenachrichtigungen()).unread;
    } catch {
      /* still — die Glocke ist kein Grund fuer eine Fehlermeldung. */
    }
  }

  $effect(() => {
    let abgebrochen = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      const konto = await eigenesKonto();
      if (abgebrochen || !konto.angemeldet) return;
      sichtbar = true;
      await frage();
      if (abgebrochen) return;
      timer = setInterval(() => void frage(), 30_000);
    })();
    return () => {
      abgebrochen = true;
      if (timer) clearInterval(timer);
    };
  });
</script>

{#if sichtbar}
  <a class="knopf knopf-rand glocke" href={ziel} aria-label={t['thing.notifications.bell']}>
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
    {#if unread > 0}
      <span class="zahl" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
    {/if}
  </a>
{/if}

<style>
  .glocke {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 0.4rem 0.6rem;
    color: var(--text-matt);
  }
  .glocke:hover {
    color: var(--primaer);
  }
  .zahl {
    position: absolute;
    top: -0.35rem;
    right: -0.35rem;
    min-width: 1.05rem;
    padding: 0 0.2rem;
    border-radius: 999px;
    background: var(--primaer);
    color: #131313;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.05rem;
    text-align: center;
  }
</style>
