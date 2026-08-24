<script lang="ts">
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { localeFrom, messages } from '$lib/i18n';
  import type { MessageKey } from '$lib/i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Die vier Bücher als Daten, nicht als vier kopierte Karten.
   *
   * Bild, Titel, Text und Alternativtext gehören zusammen; stünden sie
   * viermal im Markup, wären es zwölf Stellen, an denen ein Schlüssel zum
   * falschen Bild rutschen kann. Der Typ `MessageKey` sorgt dafür, dass ein
   * Tippfehler `npm run check` bricht statt „undefined“ zu zeigen.
   *
   * Die Bilder liegen seit dem 23.08. unter `/assets/bilder/` und wurden bis
   * zum Umbau der Halle in deren Abschnitt „Was dich erwartet“ benutzt. Die
   * Halle zeigt seit dem Entwurf „Rune & Iron“ nur noch das Tor — das Wiki
   * ist damit der einzige Ort, an dem diese vier Bilder noch stehen.
   */
  const BUECHER: { bild: string; alt: MessageKey; titel: MessageKey; text: MessageKey }[] = [
    {
      bild: '/assets/bilder/ik1.webp',
      alt: 'wiki.books.lands.image_alt',
      titel: 'wiki.books.lands.title',
      text: 'wiki.books.lands.text',
    },
    {
      bild: '/assets/bilder/ik2.webp',
      alt: 'wiki.books.guardians.image_alt',
      titel: 'wiki.books.guardians.title',
      text: 'wiki.books.guardians.text',
    },
    {
      bild: '/assets/bilder/ik3.webp',
      alt: 'wiki.books.building.image_alt',
      titel: 'wiki.books.building.title',
      text: 'wiki.books.building.text',
    },
    {
      bild: '/assets/bilder/ik4.webp',
      alt: 'wiki.books.dungeons.image_alt',
      titel: 'wiki.books.dungeons.title',
      text: 'wiki.books.dungeons.text',
    },
  ];
</script>

<Kopfdaten titel={t['wiki.title']} beschreibung={t['wiki.description']} />

<main class="mitte seite wiki-page">
  <!-- Zierrat, kein Text: Screenreader sollen die Runen nicht buchstabieren. -->
  <span class="runen kicker" aria-hidden="true">ᚹᛁᛊᛊᛖᚾ</span>
  <h1>{t['wiki.heading']}</h1>
  <p class="intro">{t['wiki.intro']}</p>

  <div class="hinweis">
    <b>{t['wiki.hint.bold']}</b>
    {t['wiki.hint.text']}
  </div>

  <!--
    Die Titel der Karten sind <h2> und nicht, wie in den Kacheln der alten
    Halle, <h3>: Über ihnen steht auf dieser Seite keine Abschnitts-
    überschrift, an der sie hängen könnten. Ein <h3> direkt unter dem <h1>
    wäre eine Lücke in der Gliederung — hörbar für jeden, der die Seite über
    die Überschriften durchgeht.
  -->
  <div class="gitter books">
    {#each BUECHER as b (b.bild)}
      <article class="tafel kachel">
        <img class="kachel-bild" src={b.bild} width="480" height="512" alt={t[b.alt]} />
        <h2>{t[b.titel]}</h2>
        <p>{t[b.text]}</p>
      </article>
    {/each}
  </div>
</main>

<style>
  /* Der Entwurf hält das Wiki schmaler als den Rahmen der Seite (1440 px). */
  .wiki-page {
    width: min(1200px, 100%);
  }

  /* Die Runenzeile über der Überschrift. Familie, Sperrung, Gold und
     Deckkraft kommen aus `.runen` in wov.css — hier steht nur, dass sie eine
     eigene Zeile ist. */
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

  /* Der Kasten hat im Entwurf keinen oberen Abstand — der kommt allein aus
     dem unteren des Absatzes darüber. */
  .hinweis {
    margin: 0 0 2.5rem;
  }

  /*
    Eigenes Rastermass statt einer der drei Klassen aus wov.css: Der Entwurf
    setzt 15rem, die Klassen bieten 14, 16 und 20. Bei vier Karten ist das
    der Unterschied zwischen „bricht auf 1024 px in zwei Reihen“ und „bricht
    nicht“.
  */
  .books {
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  }

  /* 150 px statt der 168 px von `.kachel-bild`. Der Entwurf zeigt die
     Bücher eine Spur kleiner; die Halle, die diese Höhe vorgab, benutzt die
     Kacheln seit ihrem Umbau nicht mehr. */
  .books .kachel-bild {
    height: 150px;
  }

  .books h2 {
    position: relative;
    margin: 0 0 0.5rem;
    font-family: var(--schrift-kopf);
    font-size: 18px;
    font-weight: 700;
    color: var(--runengold);
  }
</style>
