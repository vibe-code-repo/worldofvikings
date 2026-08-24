<script lang="ts">
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { DEFAULT_LOCALE, LOCALES, LOCALE_NAME, localizedPath, messages } from '$lib/i18n';

  /**
   * Die Sprachweiche unter `/`.
   *
   * Der bisherige Inhalt dieser Datei — die Halle — liegt jetzt unter
   * `[lang=lang]/+page.svelte` und wird als `/de` und `/en` gebaut. Was hier
   * übrig bleibt, hält die Wurzeladresse am Leben.
   *
   * ── Warum meta-refresh und kein Skript ───────────────────────────────
   * Ein `location.replace()` bräuchte JavaScript und wäre damit genau der
   * Rückschritt, den diese Seite seit dem Umbau vermeidet: Ohne Skript stünde
   * die Wurzel leer. `<meta http-equiv="refresh">` erledigt der Browser
   * selbst, ohne Skript und ohne CSP-Ausnahme — und wer ihn abgeschaltet hat,
   * sieht darunter zwei gewöhnliche Links und kommt genauso weiter.
   *
   * Ein serverseitiges 301 wäre sauberer, aber es gibt keinen Server: Die
   * Seite ist eine Sammlung von Dateien hinter nginx. Eine Umleitung dort
   * einzutragen bleibt möglich (und ist in der nginx-Konfiguration von CT 103
   * vorgesehen) — diese Datei ist der Teil, der im Repo liegt und ohne sie
   * arbeitet.
   *
   * Die Seite gehört zu keiner Sprache. Ihre Texte stehen deshalb nicht im
   * Katalog, sondern zweisprachig im Markup: ein Katalogeintrag müsste sich
   * für eine Sprache entscheiden, und das ist gerade die Frage, die hier noch
   * offen ist.
   */
  const ziel = localizedPath(DEFAULT_LOCALE, '/');
  const de = messages('de');
  const en = messages('en');
</script>

<svelte:head>
  <meta http-equiv="refresh" content="0; url={ziel}" />
</svelte:head>

<Kopfdaten
  blankerTitel
  titel="World of Vikings"
  beschreibung="{de['hall.meta.description']} — {en['hall.meta.description']}"
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">World of Vikings</h1>

  <p style="color:var(--matt);max-width:44rem" lang="de">
    {de['hall.hero.subtitle']}
  </p>
  <p style="color:var(--matt);max-width:44rem" lang="en">
    {en['hall.hero.subtitle']}
  </p>

  <div class="runen-trenner" aria-hidden="true">ᚹᛖᚷ</div>

  <nav aria-label="Sprache / Language">
    <p style="margin-bottom:1rem">
      <span lang="de">Sprache wählen</span> · <span lang="en">Choose your language</span>
    </p>
    <p class="held-knoepfe" style="justify-content:flex-start">
      {#each LOCALES as l (l)}
        <a class="knopf knopf-gross" href={localizedPath(l, '/')} hreflang={l} lang={l}
          >{LOCALE_NAME[l]}</a
        >
      {/each}
    </p>
  </nav>
</main>
