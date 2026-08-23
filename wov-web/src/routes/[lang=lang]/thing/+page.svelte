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
    ['thing.bretter.methalle.name', 'thing.bretter.methalle.beschreibung'],
    ['thing.bretter.hoefe.name', 'thing.bretter.hoefe.beschreibung'],
    ['thing.bretter.fahrten.name', 'thing.bretter.fahrten.beschreibung'],
    ['thing.bretter.waffen.name', 'thing.bretter.waffen.beschreibung'],
    ['thing.bretter.sippen.name', 'thing.bretter.sippen.beschreibung'],
    ['thing.bretter.schmiede.name', 'thing.bretter.schmiede.beschreibung'],
  ] as const;
</script>

<Kopfdaten titel={t['thing.titel']} beschreibung={t['thing.beschreibung']} />

<main class="mitte seite">

  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['thing.ueberschrift']}</h1>
  <!--
    Der Name steht kursiv MITTEN im Satz. Darum drei Bausteine im Katalog und
    das <i> hier im Markup: {@html} würde Sveltes Escaping umgehen, und genau
    das ist der Sicherheitsgewinn, den der Kopfkommentar von formate.ts nennt.
  -->
  <p style="color:var(--matt);max-width:46rem">
    {t['thing.einleitung.vorn']}
    <i>{t['thing.einleitung.name']}</i>
    {t['thing.einleitung.hinten']}
  </p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>{t['thing.hinweis.fett']}</b>
    {t['thing.hinweis.text']}
  </div>

  <div class="runen-trenner" aria-hidden="true">ᚦᛁᛜ</div>

  <h2>{t['thing.bretter.ueberschrift']}</h2>

  <div class="tafel" style="margin-top:1.2rem">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th>{t['thing.bretter.tabelle.brett']}</th>
            <th>{t['thing.bretter.tabelle.wofuer']}</th>
            <th class="zahl">{t['thing.bretter.tabelle.beitraege']}</th>
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

  <h2>{t['thing.anschluss.ueberschrift']}</h2>

  <div class="gitter gitter-2" style="margin-top:1.2rem">

    <article class="tafel">
      <h3>{t['thing.anschluss.ort.titel']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        {t['thing.anschluss.ort.text_1']}
        <code>/thing/</code>{t['thing.anschluss.ort.text_2']}
        <code>proxy_pass</code>
        {t['thing.anschluss.ort.text_3']}
        <code>/assets/css/wov.css</code>{t['thing.anschluss.ort.text_4']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.anschluss.konto.titel']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">{t['thing.anschluss.konto.text']}</p>
    </article>

    <article class="tafel">
      <h3>{t['thing.anschluss.recke.titel']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">
        {t['thing.anschluss.recke.text_1']}
        <code>/api/recken.json</code>{t['thing.anschluss.recke.text_2']}
      </p>
    </article>

    <article class="tafel">
      <h3>{t['thing.anschluss.lesen.titel']}</h3>
      <p style="color:var(--matt);font-size:.95rem;margin:0">{t['thing.anschluss.lesen.text']}</p>
    </article>

  </div>

  <p style="margin-top:2.5rem;text-align:center">
    <a class="knopf" href="https://play.world-of-vikings.com/">{t['thing.cta']}</a>
  </p>

</main>
