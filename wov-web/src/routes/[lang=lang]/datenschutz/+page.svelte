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
   * Die Abschnitte sind Daten: Überschrift, Blöcke (Absätze, Listen) und (wo nötig) ein Wert
   * aus `$lib/rechtliches.ts`. Damit lässt sich ein Abschnitt umstellen,
   * ohne das Markup anzufassen.
   *
   * LÖSCHUNG: Der Absatz `legal.privacy.rights.delete` (de.ts/en.ts) ist der
   * Text, der den heutigen Stand „Löschung auf Anfrage per E-Mail“ samt dem
   * Schicksal der Forumsbeiträge beschreibt. Gibt es das Löschen im Konto
   * (Karte W3), wird nur dieser Schlüssel umgeschrieben; der Abschnitt
   * „Sicherungen“ (30 Tage) bleibt richtig. Die Speicherdauer-Sätze in
   * „Konto“ und „Recken“ verweisen nur auf „Deine Rechte“.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** Ein Block ist ein Absatz oder eine Stichpunktliste. */
  type Block = { absatz: MessageKey } | { liste: MessageKey[] };

  interface Abschnitt {
    id: string;
    titel: MessageKey;
    bloecke: Block[];
    /** Ein Wert aus `rechtliches.ts`, in eigener Zeile unter den Blöcken. */
    wert?: { vorspann?: MessageKey; text: string };
  }

  const p = (absatz: MessageKey): Block => ({ absatz });
  const l = (...liste: MessageKey[]): Block => ({ liste });

  const ABSCHNITTE: Abschnitt[] = [
    {
      id: 'verantwortlicher',
      titel: 'legal.privacy.controller.heading',
      bloecke: [p('legal.privacy.controller.text')],
      wert: { text: `${ANBIETER.name}\n${ANBIETER.anschrift}\n${ANBIETER.email}` },
    },
    {
      id: 'kurz',
      titel: 'legal.privacy.summary.heading',
      bloecke: [
        l(
          'legal.privacy.summary.1',
          'legal.privacy.summary.2',
          'legal.privacy.summary.3',
          'legal.privacy.summary.4',
        ),
      ],
    },
    {
      id: 'protokolle',
      titel: 'legal.privacy.logs.heading',
      bloecke: [p('legal.privacy.logs.1'), p('legal.privacy.logs.2'), p('legal.privacy.logs.3')],
    },
    {
      id: 'konto',
      titel: 'legal.privacy.account.heading',
      bloecke: [p('legal.privacy.account.1'), p('legal.privacy.account.2'), p('legal.privacy.account.3')],
    },
    {
      id: 'bereitstellung',
      titel: 'legal.privacy.provision.heading',
      bloecke: [p('legal.privacy.provision.text')],
    },
    {
      id: 'recken',
      titel: 'legal.privacy.characters.heading',
      bloecke: [p('legal.privacy.characters.1'), p('legal.privacy.characters.2')],
    },
    {
      id: 'anmeldung',
      titel: 'legal.privacy.login.heading',
      bloecke: [p('legal.privacy.login.1'), p('legal.privacy.login.2')],
    },
    {
      id: 'spiel',
      titel: 'legal.privacy.game.heading',
      bloecke: [p('legal.privacy.game.1'), p('legal.privacy.game.2')],
    },
    {
      id: 'thing',
      titel: 'legal.privacy.forum.heading',
      bloecke: [p('legal.privacy.forum.1'), p('legal.privacy.forum.2')],
    },
    {
      id: 'speicher',
      titel: 'legal.privacy.storage.heading',
      bloecke: [
        p('legal.privacy.storage.1'),
        l(
          'legal.privacy.storage.item.token',
          'legal.privacy.storage.item.ticket',
          'legal.privacy.storage.item.notes',
        ),
        p('legal.privacy.storage.2'),
        p('legal.privacy.storage.optional'),
        l('legal.privacy.storage.item.draft', 'legal.privacy.storage.item.settings'),
        p('legal.privacy.storage.3'),
      ],
    },
    {
      id: 'sicherungen',
      titel: 'legal.privacy.backups.heading',
      bloecke: [p('legal.privacy.backups.1'), p('legal.privacy.backups.2')],
    },
    {
      id: 'extern',
      titel: 'legal.privacy.external.heading',
      bloecke: [p('legal.privacy.external.text')],
    },
    {
      id: 'empfaenger',
      titel: 'legal.privacy.recipients.heading',
      bloecke: [p('legal.privacy.recipients.text')],
      wert: { vorspann: 'legal.privacy.recipients.hosting', text: ANBIETER.hosting },
    },
    {
      id: 'rechte',
      titel: 'legal.privacy.rights.heading',
      bloecke: [
        p('legal.privacy.rights.intro'),
        p('legal.privacy.rights.delete'),
        p('legal.privacy.rights.complaint'),
      ],
      wert: { text: ANBIETER.aufsichtsbehoerde },
    },
    {
      id: 'minderjaehrige',
      titel: 'legal.privacy.minors.heading',
      bloecke: [],
      wert: { text: ANBIETER.mindestalter },
    },
    {
      id: 'aenderungen',
      titel: 'legal.privacy.changes.heading',
      bloecke: [p('legal.privacy.changes.text')],
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
      {#each a.bloecke as b}
        {#if 'absatz' in b}
          <p>{t[b.absatz]}</p>
        {:else}
          <ul>
            {#each b.liste as k (k)}
              <li>{t[k]}</li>
            {/each}
          </ul>
        {/if}
      {/each}
      {#if a.wert}
        <p class="zeilen">{#if a.wert.vorspann}<b>{t[a.wert.vorspann]}</b> {/if}{a.wert.text}</p>
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
