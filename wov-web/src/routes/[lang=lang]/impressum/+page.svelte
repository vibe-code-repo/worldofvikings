<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import { ANBIETER, MUSTER } from '$lib/rechtliches';

  /**
   * Das Impressum nach § 5 DDG.
   *
   * Jeder Wert kommt aus `$lib/rechtliches.ts`; diese Datei enthält keine
   * einzige Angabe zur Person. Solange dort ein Platzhalter steht, zeigt die
   * Seite den Musterhinweis und trägt `noindex`.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));
</script>

<Kopfdaten
  titel={t['legal.imprint.meta.title']}
  beschreibung={t['legal.imprint.meta.description']}
  noindex={MUSTER}
/>

<main class="mitte seite rechtstext">
  <h1>{t['legal.imprint.heading']}</h1>

  {#if MUSTER}
    <div class="hinweis" role="note">
      <b>{t['legal.sample.title']}</b>
      {t['legal.sample.text']}
    </div>
  {/if}

  <section>
    <h2>{t['legal.imprint.provider.heading']}</h2>
    <p>
      {ANBIETER.name}<br />
      <span class="zeilen">{ANBIETER.anschrift}</span>
    </p>
  </section>

  <section>
    <h2>{t['legal.imprint.contact.heading']}</h2>
    <p>{t['legal.imprint.contact.text']}</p>
    <p>
      {t['legal.label.email']}: {ANBIETER.email}<br />
      {t['legal.label.phone']}: {ANBIETER.telefon}
    </p>
  </section>

  <!-- Die USt-ID ist optional: Ohne Wert entfällt der ganze Abschnitt. -->
  {#if (ANBIETER.ustId ?? '').trim() !== ''}
    <section>
      <h2>{t['legal.imprint.vat.heading']}</h2>
      <p>{t['legal.label.vat']}: {ANBIETER.ustId}</p>
    </section>
  {/if}

  <section>
    <h2>{t['legal.imprint.content.heading']}</h2>
    <p class="zeilen">{ANBIETER.inhaltlichVerantwortlich}</p>
  </section>

  <section>
    <h2>{t['legal.imprint.dispute.heading']}</h2>
    <p>{t['legal.imprint.dispute.text']}</p>
  </section>

  <p class="rechts-nebenbei">
    <a href={localizedPath(lang, '/datenschutz')}>{t['legal.nav.privacy']}</a>
  </p>
  {#if lang !== 'de'}<p class="rechts-nebenbei">{t['legal.language_note']}</p>{/if}
</main>

<style>
  .rechtstext {
    max-width: 46rem;
  }
  .rechtstext section {
    margin-top: 2rem;
  }
  .rechtstext :global(.zeilen) {
    white-space: pre-line;
  }
  .rechts-nebenbei {
    margin-top: 2rem;
    color: var(--text-matt);
    font-size: 0.9rem;
  }
</style>
