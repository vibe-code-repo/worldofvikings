<script lang="ts">
  import { page } from '$app/state';
  import { repoText } from '@wov/shared';
  import { datumKurz, vorWieLange } from './formate';
  import ReckenVorschau from './ReckenVorschau.svelte';
  import {
    SELTENHEIT_SCHLUESSEL,
    SLOT_SCHLUESSEL,
    ausruestungsZeilen,
    fertigkeitenListe,
    figurStuecke,
    isoVon,
    optionaleFelder,
    seltenheitStufe,
    stueckName,
    stueckWerte,
    symbolAnzeige,
  } from './reckenAnzeige';
  import type { Recke } from './recken';
  import { planFuerRecke } from './reckenVorschauKern';
  import { type MessageKey, localeFrom, messages } from './i18n';

  /**
   * Das Reckenprofil im Entwurf "Rune & Iron", gespeist aus der Rüstkammer des
   * Spielservers.
   *
   * Zwei Spalten: links eine Tafel mit Bühne, Name, Werten und Ausrüstung,
   * rechts eine schmalere Tafel (Profiltext, Fertigkeiten, Angaben).
   *
   * Bewusst NICHT dem Entwurf gefolgt:
   *
   *  1. Die Bühne zeigt die 3D-Figur (`ReckenVorschau`, dasselbe Babylon-Bündel
   *     wie die Charaktererstellung) mit Aussehen und angelegter Rüstung des
   *     Recken. Ohne WebGL und ohne JavaScript bleibt die Silhouette.
   *  2. Es gibt nur, was das Spiel kennt: Stufe, Erfahrung, Tode, Spielzeit und
   *     Fertigkeiten erscheinen erst, wenn der Server sie liefert, und fehlen
   *     sonst ganz (kein „0“, kein Strich). Beiname, Sippe, Wächter, Lande und
   *     Trophäen waren erfunden und sind weg.
   *  3. Ein Platz zeigt das Symbol des Gegenstands (`/assets/sprites/…`). Fehlt
   *     es oder lässt es sich nicht laden, steht die Glyphe des Platzes da.
   */

  let { recke }: { recke: Recke } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const zeilen = $derived(ausruestungsZeilen(recke));
  const felder = $derived(optionaleFelder(recke));
  const fertigkeiten = $derived(fertigkeitenListe(recke));
  const aussehen = $derived({ klasse: recke.klasse, ...recke.aussehen });
  const stuecke = $derived(figurStuecke(recke));

  /** Plätze, deren Symbol sich nicht laden ließ: dort steht die Glyphe. */
  let fehlgeschlagen = $state<Record<string, boolean>>({});

  /**
   * Ein Bild, das schon vor dem Start des Skripts gescheitert ist, hat sein
   * `error`-Ereignis verpasst; dieser Griff holt es nach.
   */
  function pruefeBild(img: HTMLImageElement, platz: string) {
    if (img.complete && img.naturalWidth === 0) fehlgeschlagen[platz] = true;
  }

  const WERTE: Array<[keyof Recke['werte'], MessageKey]> = [
    ['lebenMax', 'armory.wert.leben'],
    ['nahkampfSchaden', 'armory.wert.nahkampf'],
    ['armor', 'armory.wert.armor'],
    ['strength', 'armory.wert.strength'],
    ['vitality', 'armory.wert.vitality'],
    ['agility', 'armory.wert.agility'],
  ];

  const STUECK_WERTE: Record<string, MessageKey> = {
    damage: 'armory.wert.damage',
    armor: 'armory.wert.armor',
    strength: 'armory.wert.strength',
    vitality: 'armory.wert.vitality',
    agility: 'armory.wert.agility',
  };

  const FELD_SCHLUESSEL: Record<string, MessageKey> = {
    stufe: 'armory.feld.stufe',
    erfahrung: 'armory.feld.erfahrung',
    tode: 'armory.feld.tode',
    spielzeit: 'armory.feld.spielzeit',
  };
</script>

{#snippet silhouette()}
<!-- Schlichte Silhouette: Rückfall der 3D-Figur. -->
<svg
        viewBox="0 0 80 170"
        width="110"
        role="img"
        aria-label={t['character_profile.figure.aria']}
      >
        <g fill="none" stroke="#8a6a34" stroke-width="2" stroke-linejoin="round">
          <circle cx="40" cy="010" r="9" />
          <path d="M31 6 L27 0 M49 6 L53 0" />
          <path d="M40 19 L40 88" />
          <path d="M22 30 L40 24 L58 30 L56 62 L24 62 Z" />
          <path d="M24 32 L10 60 M56 32 L70 60" />
          <path d="M32 88 L28 140 L26 165 M48 88 L52 140 L54 165" />
          <path d="M26 62 L54 62 L52 90 L28 90 Z" />
        </g>
      </svg>
{/snippet}

<div class="gitter gitter-2 profile">
  <div class="tafel main-panel">
    <div class="stage">
      <ReckenVorschau lazy auto eng plan={(daten) => planFuerRecke(daten, aussehen, stuecke)}>
        {#snippet rueckfall()}{@render silhouette()}{/snippet}
      </ReckenVorschau>
    </div>

    <h2 class="profile-name">{recke.name}</h2>
    <p class="profile-sub">
      {#if recke.zuletztGespielt !== null}
        {t['character_profile.last_seen']}
        {vorWieLange(isoVon(recke.zuletztGespielt), lang)}
      {:else}
        {t['armory.card.never']}
      {/if}
    </p>

    <h3 class="panel-eyebrow">{t['armory.stats.title']}</h3>
    <div class="werte">
      {#each WERTE as [k, b] (k)}
        <div class="wert"><b>{recke.werte[k]}</b><span>{t[b]}</span></div>
      {/each}
    </div>

    <div class="strich" aria-hidden="true"></div>

    <h3 class="panel-eyebrow">{t['character_profile.gear.title']}</h3>
    <div class="gear">
      {#each zeilen as z (z.platz)}
        {#if z.stueck}
          {@const s = z.stueck}
          {@const anzeige = symbolAnzeige(z.platz, s, fehlgeschlagen[z.platz] === true)}
          <div class="slot guete-{seltenheitStufe(s.seltenheit)}">
            <span class="slot-bild" aria-hidden="true">
              {#if anzeige.art === 'bild'}
                <img
                  class="symbol"
                  src={anzeige.src}
                  alt=""
                  width="38"
                  height="38"
                  loading="lazy"
                  use:pruefeBild={z.platz}
                  onerror={() => (fehlgeschlagen[z.platz] = true)}
                />
              {:else}
                {anzeige.zeichen}
              {/if}
            </span>
            <span class="slot-text">
              <span class="slot-name selten-{s.seltenheit}">{stueckName(s, (k) => repoText(k, lang))}</span>
              <span class="slot-rolle"
                >{t[SLOT_SCHLUESSEL[z.platz]]} · {t[SELTENHEIT_SCHLUESSEL[s.seltenheit]]} · {t[
                  'armory.stueck.stufe'
                ]}
                {s.itemStufe}{#if s.qualitaet > 0}
                  · {t['armory.stueck.qualitaet']} {s.qualitaet}{/if}</span
              >
              {#if stueckWerte(s).length > 0}
                <span class="slot-werte">
                  {#each stueckWerte(s) as [id, wert] (id)}
                    <span>{t[STUECK_WERTE[id]]} {wert > 0 ? '+' : ''}{wert}</span>
                  {/each}
                </span>
              {/if}
            </span>
          </div>
        {:else}
          <div class="slot leer">
            <span class="slot-bild" aria-hidden="true">·</span>
            <span class="slot-text">
              <span class="slot-name">{t['character_profile.slot.empty']}</span>
              <span class="slot-rolle">{t[SLOT_SCHLUESSEL[z.platz]]}</span>
            </span>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  <div class="side-column">
    {#if recke.profil}
      <section class="tafel-matt side-panel">
        <h3 class="panel-eyebrow">{t['armory.profil.title']}</h3>
        <p class="profil-text">{recke.profil}</p>
      </section>
    {/if}

    {#if felder.length > 0}
      <section class="tafel-matt side-panel">
        <div class="werte">
          {#each felder as f (f.schluessel)}
            <div class="wert"><b>{f.wert}</b><span>{t[FELD_SCHLUESSEL[f.schluessel]]}</span></div>
          {/each}
        </div>
      </section>
    {/if}

    {#if fertigkeiten.length > 0}
      <section class="tafel-matt side-panel">
        <h3 class="panel-eyebrow">{t['character_profile.skills.title']}</h3>
        {#each fertigkeiten as f (f.name)}
          <div class="balken-zeile">
            <div class="balken-kopf"><span>{f.name}</span><b>{f.stufe}</b></div>
            <div class="balken"><i style="--anteil:{f.stufe}"></i></div>
          </div>
        {/each}
      </section>
    {/if}

    <section class="tafel-matt side-panel">
      <h3 class="panel-eyebrow">{recke.klasse}</h3>
      <p class="created">
        {t['character_profile.created']}
        {datumKurz(isoVon(recke.erstellt), lang)}.
      </p>
    </section>
  </div>
</div>

<style>
  /* Beide Spalten beginnen oben. Ohne das zöge die kürzere Spalte ihre Tafel
     auf die Höhe der längeren. */
  .profile {
    align-items: start;
  }

  .main-panel {
    padding: 1.6rem;
  }

  .side-column {
    display: flex;
    flex-direction: column;
    gap: var(--gutter);
  }

  .side-panel {
    padding: 1.4rem;
  }

  /* ------------------------------------------------------------- Bühne */

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    height: clamp(260px, 34vh, 380px);
    margin-bottom: 1.4rem;
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-lg);
    background: radial-gradient(
      70% 70% at 50% 35%,
      var(--flaeche-hoch) 0%,
      var(--stage-radial-mid) 70%,
      var(--flaeche-tiefst) 100%
    );
    overflow: hidden;
  }

  /* Der Umriss ist ein Platzhalter und soll nicht so auftreten, als wäre er
     das Porträt. */
  .stage svg {
    opacity: 0.5;
  }

  /* -------------------------------------------------------------- Kopf */

  .profile-name {
    margin: 0 0 0.2rem;
    font-size: 26px;
    font-weight: 800;
    color: var(--runengold);
  }

  .profile-sub {
    margin: 0 0 1.4rem;
    color: var(--text-matt);
  }

  /* Panelüberschriften: im Entwurf durchgehend die kleine, gesperrte
     Versaloptik statt der 18px-Epilogue-Zeile, die die globale h3-Regel
     setzt. Das ist die auffälligste Verschiebung des ganzen Entwurfs. */
  .panel-eyebrow {
    margin: 0 0 1rem;
    font-family: var(--schrift-kappen);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--runengold);
  }
  .panel-eyebrow.spaced {
    margin-top: 1.6rem;
  }

  /* Die Zahl neben "Bezwungene Wächter" ist kein Titel und darf die
     Versalsperrung nicht mitmachen. */
  .counter {
    font-family: var(--schrift);
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-matt);
  }

  /* --------------------------------------------------------- Ausrüstung */

  /* Einspaltig, mit Abstand wie im Entwurf. Die Zeilen selbst sind die
     `.slot`-Bausteine aus wov.css — sie treffen den Entwurf bereits. */
  .gear {
    display: grid;
    gap: 0.7rem;
  }

  .created {
    margin: 0;
    color: var(--text-matt);
    font-size: 13px;
  }

  /* ------------------------------------------------- Symbol und Seltenheit */

  .symbol {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .slot-werte {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.7rem;
    font-size: 12px;
    color: var(--text-matt);
  }

  .selten-uncommon {
    color: #6fb26f;
  }
  .selten-rare {
    color: #6f9bd8;
  }
  .selten-epic {
    color: #b784d8;
  }
  .selten-legendary {
    color: var(--runengold);
  }

  .profil-text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
