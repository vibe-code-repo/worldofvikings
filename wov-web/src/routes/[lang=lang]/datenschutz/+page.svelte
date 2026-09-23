<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { type MessageKey, localeFrom, localizedPath, messages } from '$lib/i18n';
  import { ANBIETER, MUSTER } from '$lib/rechtliches';

  /**
   * Die Datenschutzerklärung — geschrieben aus dem, was Seite und Server
   * tatsächlich tun, nicht aus einer Vorlage. Belege je Aussage stehen im
   * Bericht der Karte W1.
   *
   * Die Abschnitte sind Daten: Überschrift, Absätze und (wo nötig) ein Wert
   * aus `$lib/rechtliches.ts`. Damit lässt sich ein Abschnitt umstellen,
   * ohne das Markup anzufassen.
   *
   * LÖSCHUNG: Der Absatz `legal.privacy.rights.delete` (de.ts/en.ts) ist der
   * einzige Text, der den heutigen Stand „Löschung auf Anfrage per E-Mail“
   * beschreibt. Gibt es das Löschen im Konto, wird nur dieser Schlüssel
   * umgeschrieben (und ggf. der Absatz aus der Liste `rechte` unten
   * gestrichen). Die Speicherdauer-Sätze in „Konto“ und „Recken“ verweisen
   * nur auf „Deine Rechte“ und bleiben richtig.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  interface Abschnitt {
    id: string;
    titel: MessageKey;
    absaetze: MessageKey[];
    /** Stichpunkte nach den Absätzen. */
    liste?: MessageKey[];
    /** Absatz nach der Liste. */
    schluss?: MessageKey[];
    /** Ein Wert aus `rechtliches.ts`, in eigener Zeile unter den Absätzen. */
    wert?: { vorspann?: MessageKey; text: string };
  }

  const ABSCHNITTE: Abschnitt[] = [
    {
      id: 'verantwortlicher',
      titel: 'legal.privacy.controller.heading',
      absaetze: ['legal.privacy.controller.text'],
      wert: { text: `${ANBIETER.name}\n${ANBIETER.anschrift}\n${ANBIETER.email}` },
    },
    {
      id: 'kurz',
      titel: 'legal.privacy.summary.heading',
      absaetze: [],
      liste: [
        'legal.privacy.summary.1',
        'legal.privacy.summary.2',
        'legal.privacy.summary.3',
        'legal.privacy.summary.4',
      ],
    },
    {
      id: 'protokolle',
      titel: 'legal.privacy.logs.heading',
      absaetze: ['legal.privacy.logs.1', 'legal.privacy.logs.2', 'legal.privacy.logs.3'],
    },
    {
      id: 'konto',
      titel: 'legal.privacy.account.heading',
      absaetze: [
        'legal.privacy.account.1',
        'legal.privacy.account.2',
        'legal.privacy.account.3',
      ],
    },
    {
      id: 'recken',
      titel: 'legal.privacy.characters.heading',
      absaetze: ['legal.privacy.characters.1', 'legal.privacy.characters.2'],
    },
    {
      id: 'anmeldung',
      titel: 'legal.privacy.login.heading',
      absaetze: ['legal.privacy.login.1', 'legal.privacy.login.2'],
    },
    {
      id: 'spiel',
      titel: 'legal.privacy.game.heading',
      absaetze: ['legal.privacy.game.1', 'legal.privacy.game.2'],
    },
    {
      id: 'thing',
      titel: 'legal.privacy.forum.heading',
      absaetze: ['legal.privacy.forum.1', 'legal.privacy.forum.2'],
    },
    {
      id: 'speicher',
      titel: 'legal.privacy.storage.heading',
      absaetze: ['legal.privacy.storage.1'],
      liste: [
        'legal.privacy.storage.item.token',
        'legal.privacy.storage.item.ticket',
        'legal.privacy.storage.item.draft',
        'legal.privacy.storage.item.settings',
      ],
      schluss: ['legal.privacy.storage.2'],
    },
    {
      id: 'extern',
      titel: 'legal.privacy.external.heading',
      absaetze: ['legal.privacy.external.text'],
    },
    {
      id: 'empfaenger',
      titel: 'legal.privacy.recipients.heading',
      absaetze: ['legal.privacy.recipients.text'],
      wert: { vorspann: 'legal.privacy.recipients.hosting', text: ANBIETER.hosting },
    },
    {
      id: 'rechte',
      titel: 'legal.privacy.rights.heading',
      absaetze: [
        'legal.privacy.rights.intro',
        'legal.privacy.rights.delete',
        'legal.privacy.rights.complaint',
      ],
      wert: { text: ANBIETER.aufsichtsbehoerde },
    },
    {
      id: 'minderjaehrige',
      titel: 'legal.privacy.minors.heading',
      absaetze: [],
      wert: { text: ANBIETER.mindestalter },
    },
    {
      id: 'aenderungen',
      titel: 'legal.privacy.changes.heading',
      absaetze: ['legal.privacy.changes.text'],
    },
  ];
</script>

<Kopfdaten
  titel={t['legal.privacy.meta.title']}
  beschreibung={t['legal.privacy.meta.description']}
  noindex={MUSTER}
/>

<main class="mitte seite rechtstext">
  <h1>{t['legal.privacy.heading']}</h1>

  {#if MUSTER}
    <div class="hinweis" role="note">
      <b>{t['legal.sample.title']}</b>
      {t['legal.sample.text']}
    </div>
  {/if}

  <p class="intro">{t['legal.privacy.intro']}</p>
  <p class="rechts-nebenbei">{t['legal.privacy.stand']}</p>
  {#if lang !== 'de'}<p class="rechts-nebenbei">{t['legal.language_note']}</p>{/if}

  {#each ABSCHNITTE as a (a.id)}
    <section id={a.id}>
      <h2>{t[a.titel]}</h2>
      {#each a.absaetze as k (k)}
        <p>{t[k]}</p>
      {/each}
      {#if a.liste}
        <ul>
          {#each a.liste as k (k)}
            <li>{t[k]}</li>
          {/each}
        </ul>
      {/if}
      {#if a.schluss}
        {#each a.schluss as k (k)}
          <p>{t[k]}</p>
        {/each}
      {/if}
      {#if a.wert}
        <p class="zeilen">{#if a.wert.vorspann}<b>{t[a.wert.vorspann]}</b>{' '}{/if}{a.wert.text}</p>
      {/if}
    </section>
  {/each}

  <p class="rechts-nebenbei">
    <a href={localizedPath(lang, '/impressum')}>{t['legal.nav.imprint']}</a>
  </p>
</main>

<style>
  .rechtstext {
    max-width: 46rem;
    /* Lange Wörter („Verbraucherstreitbeilegung“) dürfen umbrechen statt zu scrollen. */
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  .rechtstext section {
    margin-top: 2rem;
  }
  .rechtstext :global(.zeilen) {
    white-space: pre-line;
  }
  .rechtstext li {
    margin-bottom: 0.4rem;
  }
  .rechts-nebenbei {
    margin-top: 1rem;
    color: var(--text-matt);
    font-size: 0.9rem;
  }
</style>
