<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { FAHRT } from '$lib/seiten';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  /**
   * Die Halle als Tor.
   *
   * Der Entwurf "Rune & Iron" macht aus der Startseite eine einzige Schwelle:
   * Wappen, eine Zeile, ein Absatz, eine Karte mit Weltanzeige, dem grossen
   * Knopf, dem Hinweis auf den fruehen Stand und dem Weg zum Thing auf
   * Discord. Die frueheren fuenf Abschnitte (Kacheln, Technik/Welten,
   * Ruhmeshalle, Thing, Saga-Anriss) stehen nicht mehr hier — ihre Seiten
   * haengen in der Kopfleiste, und der Entwurf zeigt fuer die Halle
   * ausdruecklich nichts unterhalb dieser Karte.
   *
   * Nur die Weltliste wandert mit: sie steckt jetzt im Aufklapper der Karte.
   */

  /**
   * Drahtformat von /api/welt.json. Die Datei fuehrt je Welt mehr Felder
   * (beschreibung, wetter, saat) — hier stehen die, die das Tor zeigt.
   */
  interface Welt {
    id: string;
    name: string;
    zustand: string;
    art: string;
    spieler: number;
    plaetze: number;
    weltzeit: string;
  }

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /* Alle Ziele dieser Seite tragen das Sprachpräfix — sonst spränge man aus
     /en/ still zurück nach /de/, und nach der nginx-Umleitung wäre das keine
     404, sondern nur ein falscher Sprachwechsel. */
  const p = $derived.by(() => (pfad: string) => localizedPath(lang, pfad));

  /**
   * Die Einladung stammt aus dem Entwurf und ist NICHT geprüft — im Code
   * stand vorher nirgends ein Discord-Link. Vor dem Ausrollen muss die
   * Adresse bestätigt werden; sie steht deshalb als eine Zeile hier und
   * nicht dreimal im Markup.
   */
  const DISCORD = 'https://discord.gg/worldofvikings';

  /**
   * Schlüsselgrafik der Halle. Erwartet wird
   * `/assets/bilder/halle-hintergrund.webp` (1376×768) — solange sie fehlt,
   * steht hier das vorhandene Heldbild als PLATZHALTER. Ist die Datei da,
   * ist diese eine Zeile die ganze Änderung; die Maße stimmen bereits.
   */
  const HINTERGRUND = '/assets/bilder/held.webp';

  /*
    Die Weltliste wird im Browser geholt und scheitert für sich allein: fällt
    sie aus, steht das Tor trotzdem. Vorgerendert ist `welten` null — dann
    zeigt die Karte den neutralen Text und keine Ampel, die Grün behauptet,
    während der Server aus ist.
  */
  let welten = $state<Welt[] | null>(null);
  let weltenFehler = $state(false);

  /** Die Welt, die der Auslöser zeigt: Midgard, sonst die erste. */
  const aktiv = $derived(welten?.find((w) => w.id === 'midgard') ?? welten?.[0] ?? null);

  onMount(() => {
    void (async () => {
      try {
        welten = (await holeJson<{ welten?: Welt[] }>('/api/welt.json')).welten ?? [];
      } catch (e) {
        console.warn(e);
        weltenFehler = true;
      }
    })();
  });
</script>

<Kopfdaten
  blankerTitel
  titel={t['hall.meta.title']}
  beschreibung={t['hall.meta.description']}
/>

<!--
  Der Hintergrund liegt fest im Bildschirm und mit z-index:-1 unter allem:
  So läuft er wie im Entwurf hinter der Kopfleiste durch (die ist mattiert)
  statt am oberen Rand des Inhalts abzuschneiden. `pointer-events:none`,
  damit die Fläche nichts abfängt.
-->
<div class="gate-backdrop" aria-hidden="true">
  <img src={HINTERGRUND} alt="" width="1376" height="768" fetchpriority="high" />
  <div class="gate-vignette"></div>
</div>

<main class="gate">
  <img
    class="gate-crest"
    src="/assets/bilder/wappen.webp"
    width="768"
    height="768"
    alt={t['hall.hero.crest_alt']}
  />

  <div class="gate-words">
    <!--
      Die h1 ist im Entwurf sichtbar, aber klein und gesperrt — sie trägt den
      Namen der Seite, die Marke trägt das Wappen darüber. Deshalb hier kein
      `nur-vorlesen` mehr.
    -->
    <h1>{t['hall.gate.eyebrow']}</h1>
    <p>{t['hall.gate.intro']}</p>
  </div>

  <div class="gate-panel">
    <!--
      Die Weltanzeige ist ein natives <details>. Ein Umschalter aus
      JavaScript bliebe ohne JavaScript für immer zu — das Aufklappen ist
      hier Sache des Browsers, und der Inhalt steht im HTML.

      Sie WÄHLT nichts aus: eine Weltwahl gibt es im Spielfluss (noch) nicht,
      der Knopf führt in die Figurenwahl. Sie zeigt, was los ist. Deshalb
      Zeilen und keine Schaltflächen — ein Knopf, der nichts tut, wäre eine
      Behauptung.
    -->
    <details class="world-switch">
      <summary>
        <span class="bifroest" data-zustand={aktiv?.zustand} aria-hidden="true">
          <span class="ampel"></span>
        </span>
        <span class="world-switch-labels">
          <span class="world-switch-name">{aktiv ? aktiv.name : t['hall.worlds.title']}</span>
          <!--
            Zahlen und Name stehen NEBEN den Textbausteinen, nicht in ihnen:
            „3 von 10 auf Fahrt“ ist im Katalog drei kurze Wörter und kein
            Satz mit Platzhaltern, die jemand falsch zählen könnte.
          -->
          <span class="world-switch-state">
            {#if aktiv}
              {aktiv.spieler}
              {t['hall.hero.ribbon.of']}
              {aktiv.plaetze}
              {t['hall.hero.ribbon.underway']} · {aktiv.weltzeit}
            {:else if weltenFehler}
              {t['hall.worlds.error']}
            {:else}
              {t['hall.hero.ribbon.checking']}
            {/if}
          </span>
        </span>
        <span class="world-switch-arrow" aria-hidden="true">▾</span>
      </summary>

      <div class="world-switch-panel">
        {#if weltenFehler}
          <p class="world-switch-note">{t['hall.worlds.error']}</p>
        {:else if welten === null}
          <p class="world-switch-note">{t['hall.worlds.loading']}</p>
        {:else}
          <ul class="world-list">
            {#each welten as w (w.id)}
              <li>
                <span class="bifroest" data-zustand={w.zustand} aria-hidden="true">
                  <span class="ampel"></span>
                </span>
                <span class="world-row-labels">
                  <span class="world-row-name">{w.name}</span>
                  <span class="world-row-sub">{w.art}</span>
                </span>
                <span class="world-row-badge">
                  {#if w.zustand === 'offen'}
                    {w.spieler}/{w.plaetze}
                    {t['hall.worlds.state_open']}
                  {:else}
                    {t['hall.gate.world_badge_closed']}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </details>

    <!--
      Führt in die Charaktererstellung, nicht direkt ins Spiel — wie der alte
      Knopf „Auf Fahrt gehen“. Nur Beschriftung und Gewicht ändern sich.
    -->
    <a class="gate-play" href={p(FAHRT)}>{t['hall.gate.play_button']}</a>

    <div class="gate-rule" aria-hidden="true"></div>

    <p class="gate-note">
      <b>{t['hall.hero.ribbon.early_days']}</b>
      {t['hall.gate.early_access_text']}
    </p>

    <a class="gate-discord" href={DISCORD}>{t['hall.gate.discord_cta']}</a>
  </div>
</main>

<style>
  /* ------------------------------------------------------------ Grund */

  .gate-backdrop {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }

  .gate-backdrop img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Der Ausschnitt sitzt leicht über der Mitte — sonst schneidet die
       Karte dem Bild den Kopf ab. */
    object-position: 60% 45%;
    opacity: 0.8;
  }

  /* Radial statt linear: Das Bild bleibt in der Mitte hell und wird nach
     aussen dunkel. Der äusserste Ton bleibt bei 94 % — es wird also nie
     ganz schwarz, anders als beim alten Held, der unten hart in den Grund
     lief, weil dort ein nächster Abschnitt folgte. */
  .gate-vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      120% 90% at 50% 45%,
      color-mix(in srgb, var(--grund) 25%, transparent) 0%,
      color-mix(in srgb, var(--grund) 72%, transparent) 55%,
      color-mix(in srgb, var(--flaeche-tiefst) 94%, transparent) 100%
    );
  }

  /* -------------------------------------------------------------- Tor */

  .gate {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    padding: clamp(32px, 6vh, 72px) var(--luft-seite);
  }

  /* Auf dem Schirm liegt die Kopfleiste fest über der Seite; darunter
     (unter 880px) steht die Mobilleiste unten und der Platz wird nicht
     gebraucht. */
  @media (min-width: 880px) {
    .gate {
      padding-top: calc(64px + clamp(32px, 6vh, 72px));
    }
  }

  .gate-crest {
    width: clamp(180px, 26vw, 280px);
    /* Prozentual, damit die Rundung mit dem Wappen wächst. */
    border-radius: 9%;
    filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.85));
  }

  .gate-words {
    max-width: 44rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    text-align: center;
  }

  .gate-words h1 {
    margin: 0;
    font-family: var(--schrift-kappen);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.16em;
    line-height: 1.4;
    text-transform: uppercase;
    color: var(--primaer);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
  }

  .gate-words p {
    margin: 0;
    color: var(--pergament);
    font-size: clamp(15px, 1.6vw, 17px);
    line-height: 1.65;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    text-wrap: pretty;
  }

  /* ------------------------------------------------------------ Karte */

  /*
    Nicht `.tafel`: die trägt laut wov.css bewusst eine scharfe Kante (4px,
    kein Schatten). Das Tor ist der eine Kasten, der schweben soll —
    8px und ein tiefer Schatten, damit er sich vom Bild löst.
  */
  .gate-panel {
    width: min(470px, 100%);
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.6rem;
    background: color-mix(in srgb, var(--grund) 90%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-xl);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  }

  /* ------------------------------------------------------- Weltanzeige */

  .world-switch {
    position: relative;
  }

  .world-switch summary {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.85rem 1rem;
    background: var(--flaeche);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-lg);
    cursor: pointer;
    transition: border-color 0.22s;
    /* Das Dreieck des Browsers fällt weg; der Pfeil steht rechts im
       Markup und dreht sich beim Aufklappen. */
    list-style: none;
  }
  .world-switch summary::-webkit-details-marker {
    display: none;
  }
  .world-switch summary:hover {
    border-color: var(--umriss);
  }

  .world-switch-labels {
    flex: 1 1 auto;
    min-width: 0;
  }

  .world-switch-name {
    display: block;
    font-family: var(--schrift-kopf);
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
  }

  .world-switch-state {
    display: block;
    margin-top: 2px;
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-matt);
  }

  .world-switch-arrow {
    flex: 0 0 auto;
    color: var(--umriss);
    font-size: 12px;
    transition: transform 0.22s;
  }
  .world-switch[open] .world-switch-arrow {
    transform: rotate(180deg);
  }

  /* Der Aufklapper legt sich ÜBER den Knopf darunter, statt ihn zu
     schieben — sonst hüpft die halbe Karte beim Öffnen. */
  .world-switch-panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 5;
    background: var(--flaeche-tief);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-lg);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.7);
    overflow: hidden;
  }

  .world-switch-note {
    margin: 0;
    padding: 0.8rem 1rem;
    color: var(--text-matt);
    font-size: 13px;
  }

  .world-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .world-list li {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--umriss-matt) 50%, transparent);
  }
  .world-list li:last-child {
    border-bottom: none;
  }

  .world-row-labels {
    flex: 1 1 auto;
    min-width: 0;
  }

  .world-row-name {
    display: block;
    font-size: 15px;
    color: var(--text);
  }

  .world-row-sub {
    display: block;
    font-size: 12px;
    color: var(--text-matt);
  }

  .world-row-badge {
    flex: 0 0 auto;
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--zweit);
  }

  /* ------------------------------------------------------------ Knöpfe */

  /*
    Der eine grosse Knopf des Entwurfs. Nicht `.knopf`: der ist mit 13px und
    zwei Verlaufsstopps die Regel der Seite, dieser hier ist die eine
    Ausnahme — 20px, weit gesperrt, drei Stopps und eine Glanzkante.
  */
  .gate-play {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.15rem 2rem;
    border-radius: var(--r-lg);
    background: linear-gradient(
      180deg,
      var(--primaer) 0%,
      var(--primaer-behaelter) 55%,
      var(--gold-gradient-foot) 100%
    );
    box-shadow:
      inset 0 1px 0 var(--gold-gradient-sheen),
      inset 0 -2px 8px rgba(0, 0, 0, 0.35),
      0 0 28px color-mix(in srgb, var(--runengold) 28%, transparent);
    color: var(--auf-primaer);
    font-family: var(--schrift-kappen);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.22em;
    line-height: 1;
    text-transform: uppercase;
    /* Die Sperrung hängt auch hinter dem letzten Buchstaben; ohne den
       Einzug stünde das Wort um ein Viertel Zeichen zu weit links. */
    text-indent: 0.22em;
    transition: filter 0.2s;
  }
  .gate-play:hover {
    filter: brightness(1.08);
    color: var(--auf-primaer);
    text-decoration: none;
  }

  .gate-discord {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--flaeche) 80%, transparent);
    color: var(--text);
    font-family: var(--schrift-kappen);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transition:
      border-color 0.22s,
      color 0.22s;
  }
  .gate-discord:hover {
    border-color: var(--umriss);
    color: var(--primaer);
    text-decoration: none;
  }

  /* ----------------------------------------------------------- Hinweis */

  /* Dasselbe Muster wie .runen-trenner::before im gemeinsamen Stylesheet:
     ein Strich, der an beiden Enden ausläuft. */
  .gate-rule {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--umriss-matt), transparent);
  }

  .gate-note {
    margin: 0;
    color: var(--text-matt);
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
  }

  .gate-note b {
    font-family: var(--schrift-kappen);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primaer);
  }

  /* Wer weniger Bewegung will, bekommt keine — die Ampel in der
     Weltanzeige pulst aus wov.css heraus. */
  @media (prefers-reduced-motion: reduce) {
    .world-switch-arrow,
    .gate-play {
      transition: none;
    }
  }
</style>
