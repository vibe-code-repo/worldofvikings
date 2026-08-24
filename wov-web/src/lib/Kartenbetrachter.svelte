<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { datumZeit, holeJson } from './formate';
  import { type MessageKey, localeFrom, localizedPath, messages } from './i18n';
  import { FAHRT } from './seiten';

  /**
   * Der Kartenbetrachter.
   *
   * Zeigt das gerenderte Weltbild (assets/karten/<instanz>.webp) mit Zoom,
   * Schieben und Kneifen. Die Bilder entstehen auf wov-dev aus derselben
   * Weltgenerierung, die der Spielserver fährt — hier wird nur angezeigt.
   *
   * Warum das Bild per CSS-Transform bewegt wird und nicht auf einem Canvas
   * gezeichnet: Es ist 4096 px im Quadrat, der Browser skaliert es selbst und
   * schärfer, als es ein handgeschriebenes drawImage täte, und Schieben
   * kostet dann gar keine Neuzeichnung.
   *
   * Die Marken liegen in einer EIGENEN, nicht skalierten Ebene — sonst würden
   * Punkte und Beschriftungen mitwachsen und beim Hineinzoomen die halbe
   * Karte verdecken.
   *
   * ── Aussehen nach "Rune & Iron" (Entwurf) ────────────────────────────
   * Der Entwurf stellt Karte und Erklärung NEBENeinander statt untereinander:
   * links das Bild, rechts eine schmale Leiste aus Farblegende, Hinweis und
   * einem Knopf ins Spiel. Drei Dinge des Entwurfs sind hier absichtlich
   * anders:
   *
   *  1. Die Weltwahl (Midgard / Werkstatt) bleibt. Der Entwurf kennt nur eine
   *     Karte und hat deshalb keinen Umschalter — es gibt aber zwei Welten,
   *     und die zweite wäre sonst nicht mehr erreichbar.
   *  2. Die Legende wird weiter aus `welt.legende` gefüllt. Der Entwurf zählt
   *     sieben Lande mit festen Farben auf; die ausgelieferte Karte führt
   *     andere Namen (Hochnord, Meer) und andere Farbwerte. Eine abgeschriebene
   *     Liste behauptete etwas über ein Bild, das daneben steht.
   *     Sie heisst deshalb weiter "Was die Farben bedeuten" und nicht "Lande":
   *     "Meer" ist kein Land.
   *  3. Unten links steht weiter Massstab und Zeigerkoordinate. Der Entwurf
   *     hat dort eine feste Zeile mit einer erfundenen Saat.
   */

  interface Region { id: string; biome: string; name?: string; x: number; z: number }
  interface Kontinent { id: string; name: string; spawn: [number, number] | null }
  interface Legendeneintrag { bit: number; name: string; farbe: string }
  interface Weltkarte {
    instanz: string;
    name: string;
    gerendert: string;
    bild: string;
    breite: number;
    spanneMeter: number;
    grenzen: { minX: number; maxZ: number; maxX: number; minZ: number };
    kontinente: Kontinent[];
    regionen: Region[];
    legende: Legendeneintrag[];
  }
  interface Uebersicht {
    welten: Array<{ instanz: string; anzeige: string; bild: string; beschreibung: string }>;
  }

  let { start = 'live' }: { start?: string } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let flaeche = $state<HTMLDivElement | null>(null);
  let uebersicht = $state<Uebersicht | null>(null);
  let welt = $state<Weltkarte | null>(null);
  /*
    Leer bis zum Laden. `start` wird erst in onMount gelesen — also in einer
    Closure, wie Svelte es verlangt. Ab dem ersten Bild führt der Betrachter
    die Wahl selbst (Knöpfe, ?welt= in der Adresse); ein reaktiver Bezug auf
    `start` würde die Wahl des Besuchers bei jeder Neuberechnung überschreiben.
    Sichtbar wird das Leere nie: Die Knöpfe entstehen erst mit der Übersicht.
  */
  let instanz = $state('');
  /*
    Gespeichert wird der KATALOGSCHLUESSEL, nicht der fertige Satz: Wer die
    Sprache wechselt, waehrend eine Fehlermeldung steht, bekaeme sonst den
    Text der alten Sprache zu sehen — eingefroren im Moment des Fehlers.
  */
  let fehlerSchluessel = $state<MessageKey | ''>('');
  const fehler = $derived(fehlerSchluessel ? t[fehlerSchluessel] : '');

  /* Ansicht: Bildpunkte des Kartenbildes je Bildschirmpunkt, plus Versatz. */
  let zoom = $state(1);
  let vx = $state(0);
  let vy = $state(0);
  let flaechenBreite = $state(0);
  let flaechenHoehe = $state(0);
  let zeigerText = $state('—');

  const bildBreite = $derived(welt?.breite ?? 4096);
  const meterProSchirmpunkt = $derived(
    welt ? welt.spanneMeter / bildBreite / zoom : 0
  );

  /* ---------------------------------------------------------- Rechnerei */

  /** Zoomstufe, bei der das ganze Bild in die Fläche passt. */
  function passZoom(): number {
    if (!flaechenBreite || !flaechenHoehe) return 1;
    return Math.min(flaechenBreite, flaechenHoehe) / bildBreite;
  }

  function einpassen() {
    zoom = passZoom();
    vx = (flaechenBreite - bildBreite * zoom) / 2;
    vy = (flaechenHoehe - bildBreite * zoom) / 2;
    zaehmen();
  }

  /**
   * Die Karte darf nicht aus dem Bild geschoben werden — ein Betrachter, der
   * ins Leere scrollt, wirkt kaputt. Ist das Bild kleiner als die Fläche,
   * bleibt es mittig.
   */
  function zaehmen() {
    const b = bildBreite * zoom;
    vx = b <= flaechenBreite ? (flaechenBreite - b) / 2 : Math.min(0, Math.max(flaechenBreite - b, vx));
    vy = b <= flaechenHoehe ? (flaechenHoehe - b) / 2 : Math.min(0, Math.max(flaechenHoehe - b, vy));
  }

  function zoomen(faktor: number, punktX: number, punktY: number) {
    const alt = zoom;
    const neu = Math.min(4, Math.max(passZoom() * 0.9, alt * faktor));
    if (neu === alt) return;
    // Der Punkt unter dem Zeiger soll unter dem Zeiger bleiben.
    vx = punktX - ((punktX - vx) / alt) * neu;
    vy = punktY - ((punktY - vy) / alt) * neu;
    zoom = neu;
    zaehmen();
  }

  /** Weltkoordinate → Bildschirmpunkt relativ zur Fläche. */
  function aufSchirm(wx: number, wz: number): [number, number] {
    if (!welt) return [0, 0];
    const g = welt.grenzen;
    const bx = ((wx - g.minX) / welt.spanneMeter) * bildBreite;
    const by = ((g.maxZ - wz) / welt.spanneMeter) * bildBreite;
    return [bx * zoom + vx, by * zoom + vy];
  }

  /**
   * Marken mit fertiger Bildschirmposition und der Entscheidung, ob ihr Name
   * sichtbar ist.
   *
   * Entzerren: Von mehreren Beschriftungen, die dicht beieinander liegen,
   * bleibt nur die erste stehen. Ohne das schreibt die Karte in einem
   * Inselbogen zehnmal „Wiesen“ übereinander — die Namen verdecken dann genau
   * das Land, das sie benennen. Startpunkte kommen zuerst und gewinnen daher
   * gegen Regionen.
   */
  const marken = $derived.by(() => {
    if (!welt) return [];
    const roh = [
      ...welt.kontinente
        .filter((k) => k.spawn)
        .map((k) => ({ art: 'spawn' as const, x: k.spawn![0], z: k.spawn![1], text: k.name, titel: k.id })),
      ...welt.regionen.map((r) => ({
        art: 'region' as const,
        x: r.x,
        z: r.z,
        text: r.name ?? r.id,
        titel: r.id,
      })),
    ];

    // Beschriftungen erst, wenn ein Bildschirmpunkt weniger als 30 Meter
    // abdeckt. An der Bildgrösse festzumachen wäre falsch: Die beiden Welten
    // sind verschieden gross, dieselbe Pixelzahl bedeutet dort verschiedene
    // Massstäbe — Namen sollen in beiden bei gleicher Nähe erscheinen.
    const beschriften = meterProSchirmpunkt < 30;
    const gesetzt: Array<[number, number]> = [];

    return roh.map((m) => {
      const [sx, sy] = aufSchirm(m.x, m.z);
      let zeigen = m.art === 'spawn' || beschriften;
      if (zeigen && m.art === 'region') {
        zeigen = !gesetzt.some((g) => Math.hypot(g[0] - sx, g[1] - sy) < 90);
      }
      if (zeigen) gesetzt.push([sx, sy]);
      return { ...m, sx, sy, zeigen };
    });
  });

  /** Massstabsbalken: eine runde Zahl, die etwa 120 Bildschirmpunkte breit ist. */
  const massstab = $derived.by(() => {
    if (!meterProSchirmpunkt) return { breite: 0, text: '' };
    const roh = meterProSchirmpunkt * 120;
    const stufe = [50, 100, 250, 500, 1000, 2000, 5000, 10000].find((s) => s >= roh) ?? 20000;
    return {
      breite: stufe / meterProSchirmpunkt,
      text: stufe >= 1000 ? `${stufe / 1000} km` : `${stufe} m`,
    };
  });

  /* ------------------------------------------------------------- Laden */

  async function weltLaden(welche: string) {
    const eintrag = uebersicht?.welten.find((w) => w.instanz === welche);
    if (!eintrag) return;
    try {
      welt = await holeJson<Weltkarte>(`/assets/karten/${eintrag.beschreibung}`);
      instanz = welche;
      // Nach dem Wechsel neu einpassen: Die andere Welt hat eine andere
      // Kantenlänge, ein übernommener Zoom zeigte dort etwas anderes.
      queueMicrotask(einpassen);
      const adresse = new URL(location.href);
      adresse.searchParams.set('welt', welche);
      history.replaceState(null, '', adresse);
    } catch (e) {
      console.warn(e);
      fehlerSchluessel = 'map_viewer.error.map';
    }
  }

  onMount(async () => {
    try {
      uebersicht = await holeJson<Uebersicht>('/assets/karten/karten.json');
    } catch (e) {
      console.warn(e);
      fehlerSchluessel = 'map_viewer.error.maps';
      return;
    }
    const gewuenscht = new URLSearchParams(location.search).get('welt');
    const w =
      uebersicht.welten.find((x) => x.instanz === gewuenscht) ??
      uebersicht.welten.find((x) => x.instanz === start) ??
      uebersicht.welten[0];
    if (w) await weltLaden(w.instanz);
  });

  /* --------------------------------------------------------- Bedienung */

  function messen() {
    if (!flaeche) return;
    const r = flaeche.getBoundingClientRect();
    flaechenBreite = r.width;
    flaechenHoehe = r.height;
    zaehmen();
  }

  function punktIn(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
    const r = flaeche!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function rad(e: WheelEvent) {
    if (!welt) return;
    e.preventDefault();
    const [px, py] = punktIn(e);
    zoomen(e.deltaY < 0 ? 1.2 : 1 / 1.2, px, py);
  }

  /* Schieben und Kneifen über Pointer Events — ein Weg für Maus und Finger. */
  const zeiger = new Map<number, [number, number]>();
  let kneifAbstand = 0;
  let greift = $state(false);

  function runter(e: PointerEvent) {
    flaeche?.setPointerCapture(e.pointerId);
    zeiger.set(e.pointerId, punktIn(e));
    greift = true;
  }

  function bewegt(e: PointerEvent) {
    if (!welt) return;
    const [px, py] = punktIn(e);

    if (zeiger.has(e.pointerId)) {
      const vorher = zeiger.get(e.pointerId)!;
      zeiger.set(e.pointerId, [px, py]);

      if (zeiger.size === 1) {
        vx += px - vorher[0];
        vy += py - vorher[1];
        zaehmen();
      } else if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        const abstand = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (kneifAbstand > 0 && abstand > 0) {
          zoomen(abstand / kneifAbstand, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        }
        kneifAbstand = abstand;
      }
      return;
    }

    // Ohne gedrückte Taste: Koordinaten unter dem Zeiger anzeigen.
    if (!welt) return;
    const g = welt.grenzen;
    const bx = (px - vx) / zoom;
    const by = (py - vy) / zoom;
    const wx = g.minX + (bx / bildBreite) * welt.spanneMeter;
    const wz = g.maxZ - (by / bildBreite) * welt.spanneMeter;
    zeigerText = `${Math.round(wx)} / ${Math.round(wz)}`;
  }

  function hoch(e: PointerEvent) {
    zeiger.delete(e.pointerId);
    if (zeiger.size < 2) kneifAbstand = 0;
    if (zeiger.size === 0) greift = false;
  }

  function taste(e: KeyboardEvent) {
    const schritt = e.shiftKey ? 200 : 60;
    const mitte: [number, number] = [flaechenBreite / 2, flaechenHoehe / 2];
    switch (e.key) {
      case 'ArrowLeft': vx += schritt; break;
      case 'ArrowRight': vx -= schritt; break;
      case 'ArrowUp': vy += schritt; break;
      case 'ArrowDown': vy -= schritt; break;
      case '+': zoomen(1.4, ...mitte); break;
      case '-': zoomen(1 / 1.4, ...mitte); break;
      case '0': einpassen(); break;
      default: return;
    }
    e.preventDefault();
    zaehmen();
  }
</script>

<svelte:window onresize={messen} />

<div class="map-grid">
  <div class="map-column">

  <div class="marken world-tabs" role="tablist">
    {#if uebersicht}
      {#each uebersicht.welten as w (w.instanz)}
        <button
          class="knopf knopf-schlicht"
          type="button"
          role="tab"
          aria-selected={w.instanz === instanz}
          onclick={() => weltLaden(w.instanz)}>{w.anzeige}</button
        >
      {/each}
    {:else if fehler}
      <span class="leer-zustand bare">{fehler}</span>
    {:else}
      <span class="leer-zustand bare">{t['map_viewer.loading']}</span>
    {/if}
  </div>

  <div class="karten-rahmen">
    <!--
      tabindex="0" ist hier kein Versehen: Die Karte laesst sich mit den
      Pfeiltasten schieben und mit +/-/0 zoomen (siehe `taste`), und dafuer muss
      sie den Fokus annehmen koennen. Ohne den Eintrag waere der Betrachter nur
      mit der Maus bedienbar — das waere der Rueckschritt, nicht die Warnung.
    -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={flaeche}
      class="kartenflaeche"
      class:greift
      tabindex="0"
      role="application"
      aria-label={t['map_viewer.area.aria']}
      onwheel={rad}
      onpointerdown={runter}
      onpointermove={bewegt}
      onpointerup={hoch}
      onpointercancel={hoch}
      onpointerleave={hoch}
      ondblclick={(e) => zoomen(1.8, ...punktIn(e))}
      onkeydown={taste}
    >
      {#if welt}
        <img
          src="/assets/karten/{welt.bild}"
          alt="{t['map_viewer.image.alt_prefix']} {welt.name} — {(
            welt.spanneMeter / 1000
          ).toFixed(1)} {t['map_viewer.image.alt_suffix']}"
          draggable="false"
          style="width:{bildBreite * zoom}px; transform:translate({vx}px,{vy}px)"
          onload={() => { messen(); einpassen(); }}
        />
        <div class="marken-ebene" aria-hidden="true">
          {#each marken as m (m.art + m.titel)}
            <div
              class="marke-punkt marke-{m.art}"
              class:ohne-text={!m.zeigen}
              title={m.titel}
              style="transform:translate({m.sx}px,{m.sy}px)"
            >
              <span class="marke-text">{m.text}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="karten-bedienung">
      <!-- Näher und weiter tragen im Entwurf den Goldverlauf, also den vollen
           `.knopf` — sie sind die beiden Griffe, nach denen man sucht. -->
      <button
        class="knopf"
        type="button"
        aria-label={t['map_viewer.zoom_in']}
        onclick={() => zoomen(1.4, flaechenBreite / 2, flaechenHoehe / 2)}>+</button
      >
      <button
        class="knopf"
        type="button"
        aria-label={t['map_viewer.zoom_out']}
        onclick={() => zoomen(1 / 1.4, flaechenBreite / 2, flaechenHoehe / 2)}>−</button
      >
      <!--
        Der dritte Knopf ist im Entwurf anders gehalten als die beiden über ihm:
        matt statt golden, kleiner, gesperrt. Er heisst weiter "Ganze Welt" und
        nicht "RESET" — er passt die Welt ins Bild ein, und das ist mehr, als
        "zurücksetzen" verspricht.
      -->
      <button class="knopf knopf-schlicht fit-all" type="button" onclick={einpassen}
        >{t['map_viewer.whole_world']}</button
      >
    </div>

    <div class="karten-fuss">
      <span class="massstab" style="width:{massstab.breite}px" data-text={massstab.text} aria-hidden="true"
      ></span>
      <span class="karten-koord">{t['map_viewer.pointer']} <b>{zeigerText}</b></span>
    </div>
  </div>

  <p class="karten-stand">
    {#if fehler}
      {fehler}
    {:else if welt}
      <b>{uebersicht?.welten.find((w) => w.instanz === instanz)?.anzeige ?? welt.name}</b>
      · {welt.regionen.length} {t['map_viewer.status.regions']} · {(
        welt.spanneMeter / 1000
      ).toFixed(1)} {t['map_viewer.status.km_side']} · {t['map_viewer.status.as_of']}
      {datumZeit(welt.gerendert, lang)}
    {:else}
      {t['map_viewer.status.loading']}
    {/if}
  </p>

  </div>

  <div class="map-side">
    <section class="tafel-matt side-panel">
      <h2 class="panel-eyebrow">{t['map_viewer.colors.title']}</h2>
      <ul class="legende">
        {#each welt?.legende ?? [] as l (l.bit)}
          <!--
            Die Farbe kommt aus der Kartendatei und ist genau die Farbe, mit der
            das Bild daneben gemalt wurde. Sie steht deshalb inline und nicht als
            Marke: Sie gehört zu den Daten, nicht zur Gestaltung.
          -->
          <li><i style="background:{l.farbe}"></i>{l.name}</li>
        {/each}
      </ul>
      <p class="legend-note">{t['map_viewer.colors.text']}</p>
    </section>

    <!-- Der Weltname steht fett im Satz: zwei Bausteine, das <b> bleibt hier. -->
    <div class="hinweis two-worlds">
      <p>
        <b>{t['map_viewer.two.midgard.name']}</b>
        {t['map_viewer.two.midgard.text']}
      </p>
      <p>
        <b>{t['map_viewer.two.workshop.name']}</b>
        {t['map_viewer.two.workshop.text']}
      </p>
    </div>

    <a class="knopf map-cta" href={localizedPath(lang, FAHRT)}>{t['map.cta']}</a>
  </div>

</div>

<style>
  /*
    Karte links, Leiste rechts — dasselbe fliessende Raster wie im Entwurf.
    Unter etwa 40rem Gesamtbreite bricht `auto-fit` von selbst auf eine
    Spalte um; dann steht die Leiste wieder unter der Karte.
  */
  .map-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: var(--gutter);
    align-items: start;
    margin-top: 1.8rem;
  }

  .map-column {
    min-width: 0;
  }

  /*
    Das Kartenbild ist quadratisch (4096²). In der schmalen Spalte des
    Entwurfs stand es in einem zu hohen Kasten: gemessen 564 breit, 622 hoch,
    Bild darin 318 — oben und unten blieb je gut hundert Punkte Wasser.
    Mit dem Seitenverhältnis füllt die Welt ihre Spalte aus. Die feste Höhe
    aus wov.css (clamp 320–760) gilt weiter für Betrachter ausserhalb dieses
    Rasters; hier wird sie ersetzt, nicht gelöscht.
  */
  .kartenflaeche {
    height: auto;
    aspect-ratio: 1;
    min-height: 320px;
    max-height: 700px;
  }

  .map-side {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .world-tabs {
    margin-bottom: 1rem;
  }

  .world-tabs button {
    padding: 0.7rem 1.2rem;
    font-size: 12px;
    text-transform: uppercase;
  }

  /* Welche Welt offen ist, steht in `aria-selected` — daran hängt auch das
     Aussehen, damit beides nicht auseinanderlaufen kann. */
  .world-tabs button[aria-selected='true'] {
    color: var(--runengold);
    border-color: var(--umriss);
  }

  /* In der Markenzeile steht der Lade- oder Fehlertext an der Stelle der
     Knöpfe und braucht deren Polsterung nicht. */
  .bare {
    padding: 0;
  }

  .fit-all {
    padding: 0.45rem 0.55rem;
    font-size: 10px;
    letter-spacing: 0.08em;
  }

  /* ------------------------------------------------------------ Leiste */

  .side-panel {
    padding: 1.3rem;
  }

  /* Die Panelüberschrift des Entwurfs: klein, gesperrt, in Versalien —
     nicht die 18px-Epilogue-Zeile der globalen h3-Regel. */
  .panel-eyebrow {
    margin: 0 0 1rem;
    font-family: var(--schrift-kappen);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--runengold);
  }

  .legend-note {
    margin: 1rem 0 0;
    color: var(--text-matt);
    font-size: 14px;
  }

  .two-worlds p:last-child {
    margin-bottom: 0;
  }

  .map-cta {
    width: 100%;
    padding: 0.9rem 1.5rem;
    text-transform: uppercase;
  }
</style>
