<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { FUSSNAV } from './seiten';
  import { LOCALES, LOCALE_NAME, localeFrom, localizedPath, messages, stripLocale } from './i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /* Die Adresse ohne Sprachpräfix — Ziel der Sprachlinks. */
  const hier = $derived(stripLocale(page.url.pathname));

  /**
   * Der Fuß ist im Entwurf „Rune & Iron“ ein einzeiliger Balken: links zwei
   * Chips nach draussen, in der Mitte schlichte Links, rechts Sprache und
   * Darstellung. Die vier Linkspalten mit Markenblock und Schlusszeile sind
   * damit weg — und mit ihnen wäre auf dem Handy der einzige Weg zu
   * Rüstkammer, Wiki und Thing verschwunden, denn unterhalb von 880 px gibt
   * es keine Kopfleiste und die Mobilleiste hat nur vier Plätze.
   *
   * Deshalb steht in der Mittelgruppe nicht die Rechtsreihe des Entwurfs
   * (Impressum / Datenschutz / Nutzungsbedingungen — für die es hier weder
   * Route noch Text gibt), sondern genau das, was die Mobilleiste auslässt.
   * Die Form ist die des Entwurfs, der Inhalt ist der, den diese Seite hat.
   */
  const p = $derived.by(() => (pfad: string) => localizedPath(lang, pfad));

  /**
   * Beide Adressen stammen aus dem Entwurf und sind NICHT geprüft. Sie
   * stehen je einmal hier statt mehrfach im Markup, damit das Bestätigen vor
   * dem Ausrollen eine Zeile ist und keine Suche.
   */
  const DISCORD = 'https://discord.gg/worldofvikings';
  const QUELLCODE = 'https://github.com/vibe-code-repo/worldofvikings';

  /**
   * Der Kontrastschalter erscheint nur, wenn Skripte laufen.
   *
   * Ein Schalter, der ohne JavaScript dasteht und nichts tut, ist schlimmer
   * als keiner: Er behauptet eine Einstellung, die es nicht gibt. `bereit`
   * wird erst nach der Hydration wahr — in der vorgerenderten Datei steht
   * der Knopf deshalb gar nicht.
   *
   * Das Grafik-Auswahlfeld des Entwurfs fehlt hier bewusst. Es hätte auf
   * dieser Seite nichts zu regeln: Die Grafikstufe gehört dem Spielclient,
   * der auf play.world-of-vikings.com läuft und nichts von diesem Fuss
   * liest. Der Katalog führt die Schlüssel bereits (`footer.controls.
   * graphics_*`) — wer das Feld anschliesst, findet die Texte vor.
   */
  let bereit = $state(false);
  let hoherKontrast = $state(false);

  const SPEICHER = 'wov-hoher-kontrast';

  onMount(() => {
    bereit = true;
    hoherKontrast = localStorage.getItem(SPEICHER) === '1';
    anwenden();
  });

  function anwenden() {
    document.documentElement.dataset.kontrast = hoherKontrast ? 'hoch' : '';
  }

  function umschalten() {
    hoherKontrast = !hoherKontrast;
    localStorage.setItem(SPEICHER, hoherKontrast ? '1' : '0');
    anwenden();
  }
</script>

<footer class="fuss">
  <div class="footer-group">
    <a class="footer-chip" href={QUELLCODE}>{t['footer.opensource.link']}</a>
    <a class="footer-chip" href={DISCORD}>{t['footer.discord.link']}</a>
  </div>

  <!--
    Kein <nav> und keine Liste: Das ist im Entwurf eine Zeile aus drei
    schlichten Links, und eine zweite Navigationsmarke neben der Kopfleiste
    macht die Seite für Vorleser nicht übersichtlicher, sondern doppelt.
  -->
  <div class="footer-pages">
    {#each FUSSNAV as s (s.pfad)}
      <a href={p(s.pfad)}>{t[s.titel]}</a>
    {/each}
  </div>

  <div class="footer-group">
    <!--
      Der Sprachumschalter steht auch hier, nicht nur im Kopf: unterhalb von
      880 px ist die Kopfleiste ausgeblendet (siehe wov.css). Ohne diesen
      Block käme man auf dem Handy in keine andere Sprache.
    -->
    <span class="footer-language">
      {t['footer.language.heading']}
      {#each LOCALES as l (l)}
        <a
          href={localizedPath(l, hier)}
          hreflang={l}
          lang={l}
          aria-current={l === lang ? 'true' : undefined}>{LOCALE_NAME[l]}</a
        >
      {/each}
    </span>

    {#if bereit}
      <button
        class="contrast-toggle"
        type="button"
        aria-pressed={hoherKontrast}
        onclick={umschalten}>{t['footer.controls.contrast_button']}</button
      >
    {/if}
  </div>
</footer>

<style>
  /*
    Ein Balken, keine Steinplatte: einzeilig, 1 px Kante statt der doppelten,
    knappes Polster statt 80 px. Die alten Regeln in wov.css (.fuss > .mitte
    als Raster, .fuss-marke, .fuss-schluss) greifen hier nicht mehr, weil es
    die Elemente nicht mehr gibt.
  */
  .fuss {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem 1.5rem;
    padding: 0.9rem clamp(16px, 4vw, 40px);
    background: rgba(18, 18, 18, 0.9);
    backdrop-filter: blur(10px);
    border-top: 1px solid var(--umriss-matt);
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer-group {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .footer-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-matt);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r);
    padding: 0.45rem 0.8rem;
  }

  .footer-chip:hover {
    color: var(--primaer);
    text-decoration: none;
  }

  /*
    Die Mittelgruppe bricht bewusst aus dem Kappen-Ton aus: Fließtextschrift,
    keine Versalien, eine Spur größer. Im Entwurf ist das die ruhige Zeile
    zwischen zwei technischen.
  */
  .footer-pages {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    flex-wrap: wrap;
    margin-inline: auto;
    font-family: var(--schrift);
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: none;
  }

  .footer-pages a {
    color: var(--text-matt);
  }
  .footer-pages a:hover {
    color: var(--primaer);
    text-decoration: none;
  }

  .footer-language {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--umriss);
  }

  .footer-language a {
    color: var(--text-matt);
  }
  .footer-language a:hover {
    color: var(--primaer);
    text-decoration: none;
  }
  .footer-language a[aria-current] {
    color: var(--runengold);
  }

  .contrast-toggle {
    color: var(--text-matt);
    background: rgba(32, 32, 31, 0.8);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r);
    padding: 0.45rem 0.8rem;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }

  .contrast-toggle:hover {
    color: var(--primaer);
    border-color: var(--umriss);
  }

  /*
    Was der Schalter tut, steht hier — und es ist echt gemessen, nicht bloss
    behauptet: Der gedämpfte Fließtext bekommt die helle Textfarbe, die
    matten Ränder die helle Randfarbe. Beides sind Marken aus wov.css, die
    die ganze Seite benutzt; ein Umsetzen an dieser einen Stelle wirkt
    deshalb überall, ohne dass eine zweite Palette gepflegt werden muss.
  */
  :global(html[data-kontrast='hoch']) {
    --text-matt: #e5e2e1;
    --umriss-matt: #99907c;
  }
</style>
