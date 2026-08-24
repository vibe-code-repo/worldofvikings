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

<main class="mitte seite thing-page">
  <!--
    Der Entwurf gliedert diese Seite anders als bisher: EINE kleine Runenzeile
    über der Überschrift statt zweier Runentrenner zwischen den Abschnitten.
    Damit steht das Thing im selben Aufbau da wie Saga, Karte, Rüstkammer und
    Ruhmeshalle — Zierrat oben, danach ununterbrochener Inhalt.
    Zierrat, kein Text: Screenreader sollen die Runen nicht buchstabieren.
  -->
  <span class="runen kicker" aria-hidden="true">ᚦᛁᛜ</span>
  <h1>{t['thing.heading']}</h1>

  <!--
    Der Name steht kursiv MITTEN im Satz. Darum drei Bausteine im Katalog und
    das <i> hier im Markup: {@html} würde Sveltes Escaping umgehen, und genau
    das ist der Sicherheitsgewinn, den der Kopfkommentar von formate.ts nennt.
  -->
  <p class="intro">
    {t['thing.intro.prefix']}
    <i>{t['thing.intro.name']}</i>
    {t['thing.intro.suffix']}
  </p>

  <div class="hinweis">
    <b>{t['thing.hint.bold']}</b>
    {t['thing.hint.text']}
  </div>

  <!--
    Die Überschrift „Die geplanten Bretter“ steht nicht mehr darüber: Der
    Kasten eine Zeile höher sagt bereits „Unten steht, welche Bretter geplant
    sind“, und der Entwurf setzt die Tabelle unmittelbar darunter. Der
    Katalogschlüssel `thing.boards.heading` bleibt im Bestand — er kostet
    nichts und wäre sonst der einzige Verlust an Text.

    `tafel-tabelle` statt blosser `tafel`: Die Klasse nimmt den Innenabstand
    weg, damit die Kopfzeile bis an den Rahmen reicht. Genau so zeigt es der
    Entwurf; mit `tafel` allein sässe die Tabelle 1,5 rem eingerückt in einem
    zweiten Rahmen.
  -->
  <div class="tafel tafel-tabelle boards">
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
              <td class="board-name">{t[name]}</td>
              <td>{t[beschreibung]}</td>
              <td class="zahl board-count">—</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <h2>{t['thing.connection.heading']}</h2>

  <div class="gitter gitter-2">
    <article class="tafel">
      <h3>{t['thing.connection.location.title']}</h3>
      <p>
        {t['thing.connection.location.text_1']}
        <code>/thing/</code>{t['thing.connection.location.text_2']}
        <code>proxy_pass</code>
        {t['thing.connection.location.text_3']}
        <code>/assets/css/wov.css</code>{t['thing.connection.location.text_4']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.account.title']}</h3>
      <p>{t['thing.connection.account.text']}</p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.character.title']}</h3>
      <p>
        {t['thing.connection.character.text_1']}
        <code>/api/recken.json</code>{t['thing.connection.character.text_2']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.connection.reading.title']}</h3>
      <p>{t['thing.connection.reading.text']}</p>
    </article>
  </div>

  <!--
    Der Knopf „Solange lieber auf Fahrt gehen“ steht nicht mehr am Seitenende.
    Der Entwurf lässt die Seite nach diesem Raster enden, und der Weg ins
    Spiel liegt seither auf JEDER Seite oben in der Kopfleiste („Spielen“).
    Ein zweiter, tiefergestellter Aufruf zum selben Ziel wäre Wiederholung.
    `thing.cta` bleibt im Katalog stehen.
  -->
</main>

<style>
  /* Der Entwurf hält das Thing schmaler als den Rahmen der Seite (1440 px). */
  .thing-page {
    width: min(1100px, 100%);
  }

  /* Die Runenzeile über der Überschrift. Familie, Sperrung, Gold und
     Deckkraft kommen aus `.runen` in wov.css. */
  .kicker {
    display: block;
    font-size: 18px;
    margin-bottom: 0.6rem;
  }

  h1 {
    margin: 0 0 0.6rem;
    font-size: clamp(30px, 5vw, 44px);
  }

  .intro {
    margin: 0 0 1.5rem;
    max-width: 46rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  /* Kein oberer Abstand: Der kommt allein aus dem unteren des Absatzes
     darüber. Bisher stand hier `margin: 1.5rem 0` — symmetrisch und unten zu
     knapp für den Abstand, den der Entwurf zur Tabelle hält. */
  .hinweis {
    margin: 0 0 2.5rem;
  }

  .boards {
    margin-bottom: 3rem;
  }

  /* Der Brettname in Gold, aber im Gewicht des Fließtexts — eine Tabelle
     mit sechs fetten Zeilen liest sich als Liste von Überschriften. */
  .boards .board-name {
    color: var(--primaer);
  }

  /* Der Platzhalter in der Spalte „Beiträge“ ist noch keine Zahl. Er steht
     deshalb in der matten Randfarbe und nicht im Ton des Fließtexts. */
  .boards .board-count {
    color: var(--umriss);
  }

  h2 {
    margin: 0 0 1.2rem;
    font-size: 26px;
  }

  .gitter p {
    margin: 0;
    color: var(--text-matt);
    font-size: 15px;
    line-height: 1.6;
  }
</style>
