<script lang="ts">
  import { page } from '$app/state';
  import { datumKurz, vorWieLange } from './formate';
  import type { Recke } from './recken';
  import { type MessageKey, localeFrom, messages } from './i18n';

  /**
   * Das Reckenprofil im Entwurf "Rune & Iron".
   *
   * Zwei Spalten: links eine Tafel mit Bühne, Name, Werten und Ausrüstung,
   * rechts zwei schmalere Tafeln (Fertigkeiten; Wächter, Lande, Trophäen).
   * Die frühere Aufteilung — breite Wertetafel oben, "Puppe" mit zwei
   * Slot-Spalten um eine Silhouette, darunter drei Tafeln nebeneinander —
   * ist damit weg.
   *
   * Drei Stellen, an denen dem Entwurf bewusst NICHT gefolgt wird:
   *
   *  1. Die Bühne bleibt ein Platzhalter. Der Entwurf setzt dort ein
   *     <recke-vorschau>-Element; die echte Vorschau ist das Babylon-Bündel
   *     unter /assets/js/vorschau.js und braucht Aussehensdaten (Figur,
   *     Frisur, Kleidung) vom Gestade. /api/recken.json führt kein einziges
   *     dieser Felder — eine 3D-Figur stünde hier also für jeden Recken
   *     gleich und zeigte einen Fremden. Bis der Server ein Aussehen
   *     liefert, steht die Silhouette in der neuen Bühne.
   *  2. Deshalb steht unter der Bühne auch keine Beschriftung
   *     "ziehen zum Drehen": Es gibt nichts zu drehen.
   *  3. Der Entwurf zeigt vier Wertekacheln und lässt "Bereiste Lande" weg.
   *     Beides sind Auslassungen einer Vorlage, keine Entscheidungen über
   *     Inhalt: Alle sechs Werte und die Lande bleiben stehen. Das Raster ist
   *     ohnehin fließend, sechs Kacheln passen so gut wie vier.
   */

  let { recke }: { recke: Recke } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Die Ausrüstung als EINE Liste, in der Reihenfolge des Entwurfs: erst was
   * am Körper sitzt, dann was in der Hand liegt.
   */
  const SLOTS: Array<[string, MessageKey]> = [
    ['kopf', 'character_profile.slot.head'],
    ['brust', 'character_profile.slot.chest'],
    ['beine', 'character_profile.slot.legs'],
    ['umhang', 'character_profile.slot.cape'],
    ['waffe', 'character_profile.slot.weapon'],
    ['nebenhand', 'character_profile.slot.off_hand'],
    ['werkzeug', 'character_profile.slot.tool'],
    ['guertel', 'character_profile.slot.belt'],
  ];

  const erlegt = $derived(recke.bosse.filter((b) => b.erlegt).length);

  /* Die Fertigkeitsskala geht bis 100 — der Anteil ist deshalb die Stufe selbst. */
  const fertigkeiten = $derived([...recke.fertigkeiten].sort((a, b) => b.stufe - a.stufe));
</script>

{#snippet slot(schluessel: string, beschriftung: MessageKey)}
  {@const stueck = recke.ausruestung?.[schluessel]}
  {#if stueck}
    <div class="slot guete-{Number(stueck.guete) || 1}">
      <span class="slot-bild" aria-hidden="true">{stueck.bild}</span>
      <span class="slot-text">
        <span class="slot-name">{stueck.name}</span>
        <span class="slot-rolle"
          >{t[beschriftung]} · {t['character_profile.slot.quality']} {Number(stueck.guete) || 1}</span
        >
      </span>
    </div>
  {:else}
    <div class="slot leer">
      <span class="slot-bild" aria-hidden="true">·</span>
      <span class="slot-text">
        <span class="slot-name">{t['character_profile.slot.empty']}</span>
        <span class="slot-rolle">{t[beschriftung]}</span>
      </span>
    </div>
  {/if}
{/snippet}

<div class="gitter gitter-2 profile">
  <div class="tafel main-panel">
    <!--
      Die Bühne des Entwurfs: gerandeter Kasten, radialer Verlauf, die Figur
      mittig darin. Der Verlauf trifft die drei Stopps des Entwurfs über
      Marken (--flaeche-hoch → --stage-radial-mid → --flaeche-tiefst).
    -->
    <div class="stage">
      <!-- Schlichte Silhouette. Platzhalter, bis der Client ein Porträt liefern kann. -->
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
    </div>

    <h2 class="profile-name">{recke.name}</h2>
    <!--
      `recke.sippe`, `recke.welt` und die Namen aus /api/recken.json bleiben,
      wie sie in der Datei stehen — sie sind Inhalt, nicht Beschriftung.
    -->
    <p class="profile-sub">
      {recke.beiname} · {recke.sippe} · {recke.welt} · {t['character_profile.rune_rank']}
      {recke.stufe} · {t['character_profile.last_seen']}
      {vorWieLange(recke.zuletzt_gesehen, lang)}
    </p>

    <div class="werte">
      <div class="wert"><b>{recke.werte.leben}</b><span>{t['character_profile.value.health']}</span></div>
      <div class="wert">
        <b>{recke.werte.ausdauer}</b><span>{t['character_profile.value.stamina']}</span>
      </div>
      <div class="wert"><b>{recke.werte.eitr}</b><span>{t['character_profile.value.eitr']}</span></div>
      <div class="wert">
        <b>{recke.werte.traglast}</b><span>{t['character_profile.value.carry_weight']}</span>
      </div>
      <div class="wert">
        <b>{recke.spielzeit_stunden} h</b><span>{t['character_profile.value.underway']}</span>
      </div>
      <div class="wert"><b>{recke.tode}</b><span>{t['character_profile.value.hel']}</span></div>
    </div>

    <!-- Der Entwurf trennt hier mit einem schlichten Strich, nicht mehr mit
         der Runenzeile ᚱᚢᛊᛏᚢᚾᚷ. -->
    <div class="strich" aria-hidden="true"></div>

    <h3 class="panel-eyebrow">{t['character_profile.gear.title']}</h3>
    <div class="gear">
      {#each SLOTS as [k, b] (k)}{@render slot(k, b)}{/each}
    </div>
  </div>

  <div class="side-column">
    <section class="tafel-matt side-panel">
      <h3 class="panel-eyebrow">{t['character_profile.skills.title']}</h3>
      {#each fertigkeiten as f (f.name)}
        <div class="balken-zeile">
          <div class="balken-kopf"><span>{f.name}</span><b>{f.stufe}</b></div>
          <div class="balken"><i style="--anteil:{f.stufe}"></i></div>
        </div>
      {/each}
    </section>

    <!--
      Wächter, Lande und Trophäen teilen sich im Entwurf eine Tafel. Die
      Lande stehen im Entwurf nicht — sie bleiben hier, weil sie in den Daten
      stehen und ein Weglassen den Recken kleiner machen würde, als er ist.
    -->
    <section class="tafel-matt side-panel">
      <h3 class="panel-eyebrow">
        {t['character_profile.guardian.title']}
        <span class="counter">{erlegt} {t['character_profile.guardian.of']} {recke.bosse.length}</span>
      </h3>
      <div class="marken">
        {#each recke.bosse as b (b.name)}
          <span class="made" class:made-erlegt={b.erlegt}>{b.erlegt ? '✦ ' : ''}{b.name}</span>
        {/each}
      </div>

      <h3 class="panel-eyebrow spaced">{t['character_profile.lands.title']}</h3>
      <div class="marken">
        {#each recke.biome as b (b)}<span class="made">{b}</span>{/each}
      </div>

      <h3 class="panel-eyebrow spaced">{t['character_profile.trophies.title']}</h3>
      <div class="marken">
        {#each recke.trophaeen as tr (tr)}<span class="made">{tr}</span>{/each}
      </div>

      <p class="created">
        {t['character_profile.created']}
        {datumKurz(recke.erschaffen, lang)}.
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
    margin: 1.2rem 0 0;
    color: var(--text-matt);
    font-size: 13px;
  }
</style>
