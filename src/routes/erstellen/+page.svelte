<script lang="ts">
  import { onMount } from 'svelte';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';

  /**
   * Charaktererstellung — Auswahl, Vorschau und Übergabe an den Spielserver.
   *
   * ── Die Übergabe ─────────────────────────────────────────────────────
   * world-of-vikings.com und play(.dev).world-of-vikings.com sind
   * VERSCHIEDENE Ursprünge; localStorage wird zwischen ihnen nicht geteilt.
   * Die Wahl reist deshalb in der Adresse mit.
   *
   * Der naheliegendere Weg — die Wahl serverseitig am Charakter ablegen — ist
   * versperrt: Der Spielserver hat die namensbasierte Identität nach einer
   * Sicherheitsprüfung (F3) bewusst abgeschafft und schlüsselt Spielstände
   * über eine Sitzungs-`spielerId`, die die Webseite nicht kennt.
   *
   * Manipulierbar ist dabei nur das EIGENE Aussehen, und das darf man ohnehin
   * — der Server prüft jede eingehende Kennung gegen dieselben Listen, aus
   * denen auch diese Seite ihre Auswahl baut.
   */

  interface Eintrag { id: string; name: string; datei?: string; slot?: string }
  interface Aussehen {
    ordner: string;
    koerper: string;
    figuren: Eintrag[];
    frisuren: Eintrag[];
    ruestung: Eintrag[];
    figurVorgabe?: string;
    frisurVorgabe?: string;
  }

  const SERVER: Record<string, { name: string; url: string }> = {
    live: { name: 'Midgard', url: 'https://play.world-of-vikings.com' },
    dev: { name: 'Testgestade', url: 'https://play.dev.world-of-vikings.com' },
  };
  const SPEICHER = 'wov-erstellung';

  let leinwand = $state<HTMLCanvasElement | null>(null);
  let daten = $state<Aussehen | null>(null);
  let hinweis = $state('Figur wird geladen …');
  let fertig = $state(false);
  let fussHinweis = $state('');

  /*
    Der Hintergrundfilm. Leer, solange die Datei nicht liegt.

    Nachgefragt wird mit HEAD, BEVOR das <video> eine Quelle bekommt: Ein
    <video src> auf eine fehlende Datei schreibt eine 404 in die Konsole und
    feuert ein error-Ereignis — Rauschen, das bei der naechsten echten
    Stoerung im Weg steht. So bleibt es still, und sobald die Datei da ist,
    laeuft sie ohne dass jemand die Seite neu bauen muss.
  */
  let videoQuelle = $state('');
  const VIDEO = '/assets/video/schwarzwald.webm';

  let figur = $state('');
  let frisur = $state('');
  let ober = $state('');
  let beine = $state('');
  let spielerName = $state('Viking');
  // Testgestade steht zuerst und ist Vorgabe: Live trägt den neuen Charakter
  // erst, wenn der Stand dorthin ausgerollt ist.
  let gestade = $state('dev');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vorschau: any = null;

  const oberTeile = $derived(daten?.ruestung.filter((r) => r.slot === 'oberkoerper') ?? []);
  const beinTeile = $derived(daten?.ruestung.filter((r) => r.slot === 'beine') ?? []);

  const gestadeHinweis = $derived(
    gestade === 'dev'
      ? 'Hier wird gebaut — Welt und Fortschritt können jederzeit zurückgesetzt werden.'
      : 'Das offene Land. Hier bleibt, was du baust.'
  );

  /**
   * Woher die Vorschau ihre Modelle holt — vom GEWÄHLTEN Gestade.
   *
   * Nicht immer von live: Die beiden Server tragen nicht zwingend denselben
   * Stand, und eine Vorschau, die etwas anderes zeigt als das, was einen dort
   * erwartet, wäre schlimmer als keine.
   */
  const modellWurzel = $derived(`${(SERVER[gestade] ?? SERVER.live).url}/assets/models/`);

  function merke() {
    try {
      localStorage.setItem(
        SPEICHER,
        JSON.stringify({ figur, frisur, ober, beine, name: spielerName, server: gestade })
      );
    } catch {
      /* privater Modus: dann eben nicht */
    }
  }

  function datei(liste: Eintrag[], id: string): string | null {
    const e = liste.find((x) => x.id === id);
    return e?.datei && daten ? `${daten.ordner}/${e.datei}` : null;
  }

  async function zeigeAussehen() {
    if (!vorschau || !daten) return;
    await vorschau.setze('frisur', datei(daten.frisuren, frisur) ?? datei(daten.frisuren, daten.frisuren[0]?.id ?? ''));
    await vorschau.setze('oberkoerper', datei(daten.ruestung, ober));
    await vorschau.setze('beine', datei(daten.ruestung, beine));
  }

  async function ladeAlles() {
    if (!vorschau || !daten) return;
    fertig = false;
    hinweis = 'Figur wird geladen …';
    try {
      await vorschau.setzeWurzel(modellWurzel);
      await vorschau.ladeKoerper(`${daten.ordner}/${daten.koerper}`);
      await zeigeAussehen();
      fertig = true;
    } catch (e) {
      // Die Meldung nennt Adresse UND Grund. Eine Vorgängerfassung sagte nur
      // „liess sich nicht laden“ — damit war weder zu erkennen, ob der Server
      // schweigt, ob die Datei fehlt oder ob der Browser die Domaingrenze
      // blockt, und jede Fehlersuche begann mit Raten.
      const url = `${modellWurzel}${daten.ordner}/${daten.koerper}.glb`;
      console.warn('[erstellung] Laden fehlgeschlagen:', url, e);
      let grund = String(e instanceof Error ? e.message : e);
      try {
        const probe = await fetch(url, { method: 'GET' });
        grund = probe.ok
          ? `Datei erreichbar (${probe.status}), aber der Lader kam nicht damit zurecht.`
          : `Server antwortet mit ${probe.status}.`;
      } catch (netz) {
        grund = `Kein Zugriff über die Domaingrenze (${String(netz).slice(0, 60)}).`;
      }
      fertig = false;
      hinweis = `Figur nicht geladen — ${grund}`;
    }
  }

  function schritt(liste: Eintrag[], aktuell: string, richtung: number, mitLeer: boolean): string {
    const ids = mitLeer ? ['', ...liste.map((e) => e.id)] : liste.map((e) => e.id);
    if (!ids.length) return aktuell;
    const i = Math.max(0, ids.indexOf(aktuell));
    return ids[(i + richtung + ids.length) % ids.length];
  }

  function losfahren() {
    merke();
    const s = SERVER[gestade] ?? SERVER.live;
    const p = new URLSearchParams({ name: spielerName.trim() || 'Viking', figur, frisur });
    if (ober) p.set('ober', ober);
    if (beine) p.set('beine', beine);
    location.href = `${s.url}/?${p.toString()}`;
  }

  onMount(async () => {
    // Erst nachsehen, ob es den Film gibt — siehe Kommentar bei videoQuelle.
    void (async () => {
      try {
        const antwort = await fetch(VIDEO, { method: 'HEAD' });
        if (antwort.ok) videoQuelle = VIDEO;
      } catch {
        /* kein Film, kein Problem: die Buehne behaelt ihren Verlauf */
      }
    })();

    try {
      daten = await holeJson<Aussehen>('/assets/aussehen.json');
    } catch (e) {
      console.error('[erstellung]', e);
      hinweis = 'Die Auswahllisten fehlen — assets/aussehen.json nicht erreichbar.';
      return;
    }

    let alt: Record<string, string> = {};
    try {
      alt = JSON.parse(localStorage.getItem(SPEICHER) ?? '{}');
    } catch {
      /* egal */
    }
    const gueltig = (liste: Eintrag[], wert?: string) =>
      wert && liste.some((e) => e.id === wert) ? wert : undefined;

    figur = gueltig(daten.figuren, alt.figur) ?? daten.figurVorgabe ?? daten.figuren[0]?.id ?? '';
    frisur = gueltig(daten.frisuren, alt.frisur) ?? daten.frisurVorgabe ?? daten.frisuren[0]?.id ?? '';
    ober = gueltig(daten.ruestung, alt.ober) ?? '';
    beine = gueltig(daten.ruestung, alt.beine) ?? '';
    if (alt.name) spielerName = alt.name;
    if (alt.server && SERVER[alt.server]) gestade = alt.server;

    /*
      Das Vorschau-Bündel ist eine gewöhnliche Datei unter /assets/js/ und
      wird im SPIEL-Repo gebaut (tools/vorschau-buendeln.mjs), weil Babylon
      dort ohnehin liegt. `@vite-ignore` hält es aus dem Bündel dieser Seite
      heraus — Vite soll die 2,8 MB weder anfassen noch mitziehen.
    */
    try {
      const pfad = '/assets/js/vorschau.js';
      const modul = await import(/* @vite-ignore */ pfad);
      vorschau = new modul.Vorschau(leinwand, modellWurzel);
    } catch (e) {
      console.error('[erstellung] vorschau.js', e);
      hinweis = `Vorschau-Modul nicht ladbar — ${String(e).slice(0, 90)}`;
      return;
    }

    await ladeAlles();
    fussHinweis = 'Ziehen dreht die Figur, Rad zoomt.';
  });
</script>

<Kopfdaten
  titel="Charakter erstellen"
  beschreibung="Wähle Aussehen und Ausrüstung deiner Wikingerin und geh auf Fahrt."
  noindex
/>

<main class="mitte" style="padding-block: 22px 34px">
  <div class="erstellen-kopfzeile">
    <h1>Charakter erstellen</h1>
    <p>Wähle Aussehen und Ausrüstung — die Vorschau zeigt dich, wie du in Midgard stehst.</p>
  </div>

  <div class="erstellen-raster">
    <!-- links: Aussehen -->
    <aside class="tafel">
      <h2>Aussehen</h2>

      <label class="feldname" for="figur-wahl">Figur</label>
      <select id="figur-wahl" bind:value={figur} onchange={() => { merke(); void ladeAlles(); }}>
        {#each daten?.figuren ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
      </select>

      <label class="feldname" for="frisur-wahl">Frisur</label>
      <div class="waehler">
        <button type="button" aria-label="Vorige Frisur"
          onclick={() => { frisur = schritt(daten?.frisuren ?? [], frisur, -1, false); merke(); void zeigeAussehen(); }}>‹</button>
        <select id="frisur-wahl" bind:value={frisur} onchange={() => { merke(); void zeigeAussehen(); }}>
          {#each daten?.frisuren ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
        </select>
        <button type="button" aria-label="Nächste Frisur"
          onclick={() => { frisur = schritt(daten?.frisuren ?? [], frisur, 1, false); merke(); void zeigeAussehen(); }}>›</button>
      </div>

      <label class="feldname" for="oberkoerper-wahl">Oberkörper</label>
      <div class="waehler">
        <button type="button" aria-label="Voriges Teil"
          onclick={() => { ober = schritt(oberTeile, ober, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
        <select id="oberkoerper-wahl" bind:value={ober} onchange={() => { merke(); void zeigeAussehen(); }}>
          <option value="">— nichts —</option>
          {#each oberTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
        </select>
        <button type="button" aria-label="Nächstes Teil"
          onclick={() => { ober = schritt(oberTeile, ober, 1, true); merke(); void zeigeAussehen(); }}>›</button>
      </div>

      <label class="feldname" for="beine-wahl">Beine</label>
      <div class="waehler">
        <button type="button" aria-label="Voriges Teil"
          onclick={() => { beine = schritt(beinTeile, beine, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
        <select id="beine-wahl" bind:value={beine} onchange={() => { merke(); void zeigeAussehen(); }}>
          <option value="">— nichts —</option>
          {#each beinTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
        </select>
        <button type="button" aria-label="Nächstes Teil"
          onclick={() => { beine = schritt(beinTeile, beine, 1, true); merke(); void zeigeAussehen(); }}>›</button>
      </div>
    </aside>

    <!-- Mitte: Bühne -->
    <div class="buehne">
      <!--
        Der Hintergrund ist ein gewoehnliches <video> HINTER der Leinwand,
        nicht Teil der 3D-Szene. Das ist der billigste Weg: Der Browser
        dekodiert es in Hardware und die Grafikkarte setzt es zusammen —
        kein Texturupload je Frame, keine Weltgenerierung, keine Instanzen.

        `muted` ist Pflicht, sonst verweigern Browser das Selbststarten.
        `playsinline` verhindert, dass iOS es in den Vollbildspieler reisst.
        Der Faktor --zoom kommt aus der Vorschau und laesst den Wald beim
        Heranzoomen leicht mitwachsen; ohne das sieht man sofort, dass die
        Figur vor einer Leinwand steht.

        Faellt das Video aus — weil es fehlt, weil jemand Autoplay sperrt
        oder weniger Bewegung verlangt —, bleibt das Standbild stehen.
        Deshalb `poster`, und deshalb hat die Buehne darunter weiter ihren
        Farbverlauf.
      -->
      {#if videoQuelle}
      <video
        class="buehne-video"
        src={videoQuelle}
        poster="/assets/video/schwarzwald.webp"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        aria-hidden="true"
      ></video>
      {/if}
      <canvas bind:this={leinwand}></canvas>
      <div class="buehne-hinweis" class:fertig>{hinweis}</div>
      <div class="buehne-werkzeug">
        <button type="button" title="Drehen" onclick={() => vorschau?.drehe(-0.35)}>↺</button>
        <button type="button" title="Drehen" onclick={() => vorschau?.drehe(0.35)}>↻</button>
        <button type="button" title="Blick zurücksetzen" onclick={() => vorschau?.blickZurueck()}>⌂</button>
      </div>
    </div>

    <!-- rechts: Fahrt -->
    <aside class="tafel">
      <h2>Fahrt</h2>

      <label class="feldname" for="spieler-name">Name</label>
      <input
        type="text"
        id="spieler-name"
        maxlength="24"
        placeholder="Wie man dich ruft"
        bind:value={spielerName}
        onchange={merke}
      />

      <label class="feldname" for="server-wahl">Gestade</label>
      <select id="server-wahl" bind:value={gestade} onchange={() => { merke(); void ladeAlles(); }}>
        <option value="dev">Testgestade — hier wird gebaut</option>
        <option value="live">Midgard — das offene Land</option>
      </select>
      <p class="gestade-hinweis">{gestadeHinweis}</p>
    </aside>
  </div>

  <div class="erstellen-fuss">
    <span class="hinweis-klein">{fussHinweis}</span>
    <a class="knopf knopf-rand" href="/">Zurück</a>
    <button type="button" class="knopf knopf-gross" onclick={losfahren}>Auf Fahrt gehen</button>
  </div>
</main>

<style>
  /* Nur was diese Seite braucht — der Rest kommt aus wov.css. */
  .erstellen-kopfzeile { text-align: center; margin: 8px 0 18px; }
  .erstellen-kopfzeile h1 {
    font-size: clamp(24px, 3.4vw, 34px);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--primaer);
    margin: 0 0 6px;
  }
  .erstellen-kopfzeile p { color: var(--umriss); font-size: 14px; margin: 0; }

  .erstellen-raster {
    display: grid;
    gap: 16px;
    align-items: start;
    grid-template-columns: minmax(240px, 320px) minmax(320px, 1fr) minmax(260px, 340px);
  }
  @media (max-width: 1080px) {
    .erstellen-raster { grid-template-columns: 1fr; }
  }

  .buehne {
    position: relative;
    border: 1px solid var(--umriss-matt);
    border-radius: 10px;
    overflow: hidden;
    min-height: 480px;
    height: min(68vh, 700px);
    background: radial-gradient(120% 90% at 50% 6%, #2c2b26 0%, #17171b 55%, #0d0d0f 100%);
  }
  .buehne canvas {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    /* Die Leinwand ist durchsichtig — sie zeigt nur die Figur, alles
       andere kommt vom Video darunter. */
    background: transparent;
    cursor: grab;
    touch-action: none;
  }
  .buehne canvas:active { cursor: grabbing; }

  .buehne-video {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Beim Heranzoomen waechst der Hintergrund leicht mit. Den Faktor setzt
       die Vorschau als CSS-Variable; ohne sie bleibt er bei 1. */
    transform: scale(var(--zoom, 1));
    transform-origin: 50% 55%;
    transition: transform 0.12s linear;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    /* Wer weniger Bewegung will, bekommt das Standbild. Das Video laeuft
       zwar weiter, aber der mitwachsende Zoom faellt weg. */
    .buehne-video { transition: none; transform: none; }
  }
  .buehne-hinweis {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--umriss);
    font-size: 14px;
    text-align: center;
    padding: 20px;
    pointer-events: none;
    z-index: 2;
  }
  .buehne-hinweis.fertig { display: none; }
  /*
    ueber der Leinwand. Die traegt seit dem Videohintergrund z-index 1, und
    ohne eigenen Wert lagen die Knoepfe DARUNTER — sichtbar, aber nicht
    anklickbar. Aufgefallen ist es nur, weil ein Pruefschuss beim Klick in
    einen Timeout lief.
  */
  .buehne-werkzeug { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; z-index: 2; }
  .buehne-werkzeug button {
    width: 32px; height: 32px; padding: 0; font-size: 15px; line-height: 1;
    background: rgba(0, 0, 0, 0.5);
    color: var(--pergament);
    border: 1px solid var(--umriss-matt);
    border-radius: 5px;
    cursor: pointer;
  }
  .buehne-werkzeug button:hover { color: var(--primaer); border-color: var(--primaer); }

  .waehler { display: flex; align-items: center; gap: 6px; margin: 0 0 14px; }
  .waehler button {
    width: 30px; height: 34px; flex: 0 0 auto; cursor: pointer;
    background: var(--flaeche);
    color: var(--pergament);
    border: 1px solid var(--umriss-matt);
    border-radius: 5px;
    font-size: 14px;
  }
  .waehler button:hover { color: var(--primaer); border-color: var(--primaer); }
  .waehler select { flex: 1 1 auto; min-width: 0; height: 34px; text-align: center; text-align-last: center; }

  .feldname {
    display: block; font-size: 11px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--umriss); margin: 0 0 5px;
  }
  input[type='text'], select {
    width: 100%; height: 34px; margin: 0 0 12px;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--umriss-matt);
    border-radius: 5px;
    padding: 0 10px;
    font-family: var(--schrift);
    font-size: 14px;
  }
  input[type='text']:focus, select:focus { outline: none; border-color: var(--primaer); }
  .waehler select { margin: 0; }

  .gestade-hinweis {
    font-size: 12px; color: var(--umriss); margin: -6px 0 12px; line-height: 1.45;
  }

  .erstellen-fuss { display: flex; align-items: center; gap: 14px; margin: 20px 0 0; }
  .hinweis-klein { color: var(--umriss); font-size: 12px; margin-right: auto; }
</style>
