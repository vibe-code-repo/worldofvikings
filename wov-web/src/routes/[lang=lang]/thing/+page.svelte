<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages } from '$lib/i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Die sechs Bretter als Daten statt als sechs kopierte Tabellenzeilen.
   *
   * Vorher stand jede Zeile mit ihren drei style-Attributen einzeln im
   * Markup; mit zwei Sprachen wären das zwölf Stellen gewesen, an denen ein
   * Schlüssel verrutschen kann. Jetzt gibt es eine Schleife und eine Liste.
   */
  const BRETTER = [
    ['thing.boards.mead_hall.name', 'thing.boards.mead_hall.description'],
    ['thing.boards.steadings.name', 'thing.boards.steadings.description'],
    ['thing.boards.voyages.name', 'thing.boards.voyages.description'],
    ['thing.boards.weapons.name', 'thing.boards.weapons.description'],
    ['thing.boards.clans.name', 'thing.boards.clans.description'],
    ['thing.boards.forge.name', 'thing.boards.forge.description'],
  ] as const;
</script>

<Kopfdaten titel={t['thing.title']} beschreibung={t['thing.description']} />

<main class="mitte seite">

  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['thing.heading']}</h1>
  <!--
    Der Name steht kursiv MITTEN im Satz. Darum drei Bausteine im Katalog und
    das <i> hier im Markup: {@html} würde Sveltes Escaping umgehen, und genau
    das ist der Sicherheitsgewinn, den der Kopfkommentar von formate.ts nennt.
  -->
  <p style="color:var(--matt);max-width:46rem">
    {t['thing.intro.prefix']}
    <i>{t['thing.intro.name']}</i>
    {t['thing.intro.suffix']}
  </p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>{t['thing.hint.bold']}</b>
    {t['thing.hint.text']}
  </div>

  <div class="runen-trenner" aria-hidden="true">ᚦᛁᛜ</div>

  <h2>{t['thing.boards.heading']}</h2>

  <div class="tafel" style="margin-top:1.2rem">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th>{t['thing.boards.table.board']}</th>
            <th>{t['thing.boards.table.purpose']}</th>
            <th class="zahl">{t['thing.boards.table.posts']}</th>
          </tr>
        </thead>
        <tbody>
          {#each BRETTER as [name, beschreibung] (name)}
            <tr>
              <td><b style="color:var(--gold);font-weight:normal">{t[name]}</b></td>
              <td style="color:var(--matt)">{t[beschreibung]}</td>
              <td class="zahl" style="color:var(--matt)">—</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="runen-trenner" aria-hidden="true">ᚹᛖᚷ</div>

  <h2>{t['thing.connection.heading']}</h2>

  <div class="gitter gitter-2" style="margin-top:1.2rem">

    <article class="tafel">
      <h3>{t['thing.connection.location.title']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        {t['thing.connection.location.text_1']}
        <code>/thing/</code>{t['thing.connection.location.text_2']}
        <code>proxy_pass</code>
        {t['thing.connection.location.text_3']}
        <code>/assets/css/wov.css</code>{t['thing.connection.location.text_4']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.account.title']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">{t['thing.connection.account.text']}</p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.character.title']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        {t['thing.connection.character.text_1']}
        <code>/api/recken.json</code>{t['thing.connection.character.text_2']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.reading.title']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">{t['thing.connection.reading.text']}</p>
    </article>

  </div>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href="https://play.world-of-vikings.com/">{t['thing.cta']}</a>
  </p>

</main>
