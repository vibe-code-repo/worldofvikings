<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { type MessageKey, localeFrom, localizedPath, messages } from '$lib/i18n';
  import {
    ApiError,
    SHORES,
    SHORE_IDS,
    SHORE_LABEL,
    type ShoreId,
    charakterAnlegen,
    clearToken,
    errorMessageKey,
    isLoggedOut,
    playUrl,
    readShore,
    readToken,
    signedInShore,
    spielen,
    writeShore,
  } from '$lib/konto';
  import '$lib/stil/konto.css';

  /**
   * Charaktererstellung — Auswahl, Vorschau und Übergabe an den Spielserver.
   *
   * ── Die Übergabe ─────────────────────────────────────────────────────
   * world-of-vikings.com und play(.dev).world-of-vikings.com sind
   * VERSCHIEDENE Ursprünge; localStorage wird zwischen ihnen nicht geteilt.
   * Name und Aussehen reisen deshalb in der Adresse mit.
   *
   * Der ZUGANGSNACHWEIS reist anders: Seit es Konten gibt, legt diese Seite
   * den Recken erst am Konto an (POST /api/konto/charaktere) und tauscht ihn
   * dann gegen ein Sitzungsticket (POST …/spielen). Das Ticket steht im
   * Adressfragment (`#ticket=`), nie in einem Parameter — die Begründung
   * dazu steht bei `playUrl()` in `$lib/konto.ts`.
   *
   * Manipulierbar ist an den Parametern nur das EIGENE Aussehen, und das
   * darf man ohnehin — der Server prüft jede eingehende Kennung gegen
   * dieselben Listen, aus denen auch diese Seite ihre Auswahl baut.
   *
   * ── Warum die Bühne hinter einer Anmeldesperre steht ─────────────────
   * Ein Recke gehört jetzt zu einem Konto; ohne Konto gäbe es niemanden,
   * dem man ihn anlegen könnte. Der Vorgabezustand ist deshalb „gesperrt“,
   * und das ist zugleich der einzige Zustand, der zur BAUZEIT feststeht:
   * Die Seite wird einmal vorgerendert und kann nicht wissen, wer sie
   * später öffnet. Ohne JavaScript bleibt genau dieser Zustand stehen — ein
   * erklärender Absatz und zwei Links, kein toter Knopf und keine leere
   * Bühne. Dass die Bühne selbst JavaScript braucht, war schon vorher so:
   * sie ist eine 3D-Vorschau.
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
    /**
     * Stunde → Beschriftung, z. B. { "3": "Sonnenaufgang" }.
     *
     * Kommt aus der erzeugten Datei und steht hier bewusst NICHT fest:
     * Der Sonnenaufgang liegt bei 0,1333 des Tages, also gegen 03:00
     * und nicht bei 06:00. Eine hier getippte Beschriftung wäre eine
     * zweite Wahrheit neben dem Umgebungsmodell des Spiels.
     */
    tageszeit?: { marken: Record<string, string> };
  }

  /** Was vom Vorschau-Bündel benutzt wird — gemessen an `vorschau.js`. */
  interface Vorschau {
    setzeWurzel(url: string): Promise<void>;
    ladeKoerper(pfad: string): Promise<void>;
    setze(slot: string, datei: string | null): Promise<void>;
    drehe(winkel: number): void;
    blickZurueck(): void;
    dispose(): void;
  }

  const SPEICHER = 'wov-erstellung';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Setzt `{name}`-Platzhalter aus dem Katalog.
   *
   * Der Katalog verbietet Zahlen IM Text; die wenigen Ausnahmen sind
   * Fehlermeldungen der Bühne, in denen ein Statuscode oder eine
   * Systemmeldung mitten im Satz landet und sich nicht sinnvoll in zwei
   * Bausteine zerlegen lässt. Was nicht besetzt ist, bleibt unverändert
   * stehen — das ist sichtbar und damit reparierbar, ein stilles
   * „undefined“ wäre es nicht.
   */
  function fuelle(vorlage: string, werte: Record<string, string | number>): string {
    return vorlage.replace(/\{(\w+)\}/g, (ganz: string, name: string) =>
      name in werte ? String(werte[name]) : ganz,
    );
  }

  /* ------------------------------------------------------------ Zustand */

  let leinwand = $state<HTMLCanvasElement | null>(null);
  let daten = $state<Aussehen | null>(null);
  let vorschau: Vorschau | null = null;

  /** True, sobald ein Skript übernommen hat. Siehe Kopfkommentar. */
  let bereit = $state(false);
  /** Der Vorgabezustand ist „nicht angemeldet“ — er ist der einzig sichere. */
  let angemeldet = $state(false);

  /**
   * Der aktuelle Bühnentext, oder null für „wird geladen“.
   *
   * Null statt eines fertigen Satzes, damit der Vorgabetext aus dem Katalog
   * kommt und beim Sprachwechsel mitgeht; Fehlertexte setzen einen fertigen
   * String, weil sie eine Systemmeldung enthalten.
   */
  let hinweisText = $state<string | null>(null);
  let fertig = $state(false);
  let fussHinweisAn = $state(false);

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
  let gestade = $state<ShoreId>('dev');
  /**
   * Wunsch-Uhrzeit, '' = Serverzeit übernehmen.
   *
   * Nur für das Testgestade angeboten. Auf Midgard setzt der Server die
   * Zeit für ALLE Spieler, und er lässt das nur Admins tun — ein Regler,
   * der dort für die meisten nichts täte, wäre schlimmer als keiner.
   */
  let zeit = $state('');

  /** Läuft gerade „Recke anlegen und Ticket holen“? */
  let sendet = $state(false);
  /** Fehler, der zum Namensfeld gehört (ungültig oder vergeben). */
  let namensFehler = $state<MessageKey | null>(null);
  /** Alles Übrige — Netz, Serverfehler, Unerwartetes. */
  let sendeFehler = $state<MessageKey | null>(null);

  /** Was beim letzten Besuch gewählt war; nur beim Start gelesen. */
  let alt: Record<string, string> = {};

  const oberTeile = $derived(daten?.ruestung.filter((r) => r.slot === 'oberkoerper') ?? []);
  const beinTeile = $derived(daten?.ruestung.filter((r) => r.slot === 'beine') ?? []);

  const gestadeHinweis = $derived(
    gestade === 'dev'
      ? t['erstellen.fahrt.gestade.hinweis.dev']
      : t['erstellen.fahrt.gestade.hinweis.live'],
  );

  /**
   * Woher die Vorschau ihre Modelle holt — vom GEWÄHLTEN Gestade.
   *
   * Nicht immer von live: Die beiden Server tragen nicht zwingend denselben
   * Stand, und eine Vorschau, die etwas anderes zeigt als das, was einen dort
   * erwartet, wäre schlimmer als keine.
   */
  const modellWurzel = $derived(`${SHORES[gestade].url}/assets/models/`);

  /** 00:00 … 23:00, die markanten Stunden mit Namen dahinter. */
  const stunden = $derived(
    Array.from({ length: 24 }, (_, h) => {
      const marke = daten?.tageszeit?.marken[String(h)];
      return { wert: String(h), text: `${String(h).padStart(2, '0')}:00${marke ? ` – ${marke}` : ''}` };
    })
  );

  /* -------------------------------------------------------- Merken */

  function merke() {
    try {
      localStorage.setItem(
        SPEICHER,
        // `server` steht hier nicht mehr drin: Welches Gestade gewählt ist,
        // führt seit den Kontoseiten `wov-gestade` (writeShore), und zwei
        // Orte für dieselbe Angabe laufen früher oder später auseinander.
        JSON.stringify({ figur, frisur, ober, beine, name: spielerName, zeit })
      );
    } catch {
      /* privater Modus: dann eben nicht */
    }
  }

  function datei(liste: Eintrag[], id: string): string | null {
    const e = liste.find((x) => x.id === id);
    return e?.datei && daten ? `${daten.ordner}/${e.datei}` : null;
  }

  /* -------------------------------------------------------- Die Bühne */

  async function zeigeAussehen() {
    if (!vorschau || !daten) return;
    await vorschau.setze('frisur', datei(daten.frisuren, frisur) ?? datei(daten.frisuren, daten.frisuren[0]?.id ?? ''));
    await vorschau.setze('oberkoerper', datei(daten.ruestung, ober));
    await vorschau.setze('beine', datei(daten.ruestung, beine));
  }

  async function ladeAlles() {
    if (!vorschau || !daten) return;
    fertig = false;
    hinweisText = null;
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
          ? fuelle(t['erstellen.buehne.hinweis.datei_erreichbar'], { status: probe.status })
          : fuelle(t['erstellen.buehne.hinweis.server_status'], { status: probe.status });
      } catch (netz) {
        grund = fuelle(t['erstellen.buehne.hinweis.kein_zugriff'], {
          fehler: String(netz).slice(0, 60),
        });
      }
      fertig = false;
      hinweisText = fuelle(t['erstellen.buehne.hinweis.nicht_geladen'], { grund });
    }
  }

  function vorgabenWaehlen() {
    if (!daten) return;
    const gueltig = (liste: Eintrag[], wert?: string) =>
      wert && liste.some((e) => e.id === wert) ? wert : undefined;

    figur = gueltig(daten.figuren, alt.figur) ?? daten.figurVorgabe ?? daten.figuren[0]?.id ?? '';
    frisur = gueltig(daten.frisuren, alt.frisur) ?? daten.frisurVorgabe ?? daten.frisuren[0]?.id ?? '';
    ober = gueltig(daten.ruestung, alt.ober) ?? '';
    beine = gueltig(daten.ruestung, alt.beine) ?? '';
    if (alt.name) spielerName = alt.name;
    // Gemerktes prüfen statt übernehmen: Ein unsinniger Wert liesse den
    // Auswahlkasten leer erscheinen, und was hier steht, reist als ?zeit=
    // weiter. Der Client prüft ebenfalls — hier ist es die Anzeige.
    if (alt.zeit === '' || (/^\d{1,2}$/.test(alt.zeit ?? '') && Number(alt.zeit) < 24)) {
      zeit = alt.zeit;
    }
  }

  /**
   * Bühne aufbauen. Wird erst gerufen, wenn die Sperre offen ist —
   * vorher gibt es die Leinwand im DOM gar nicht.
   */
  async function starteBuehne() {
    // Ein `tick()` wartet auf genau die DOM-Änderung, die `angemeldet`
    // ausgelöst hat. Ohne das wäre `leinwand` noch null und der Aufbau
    // bräche still ab.
    await tick();
    if (!leinwand) return;

    if (!daten) {
      try {
        daten = await holeJson<Aussehen>('/assets/aussehen.json');
      } catch (e) {
        console.error('[erstellung]', e);
        hinweisText = t['erstellen.buehne.hinweis.listen_fehlen'];
        return;
      }
      vorgabenWaehlen();
    }

    if (!vorschau) {
      /*
        Das Vorschau-Bündel ist eine gewöhnliche Datei unter /assets/js/ und
        wird im SPIEL-Repo gebaut (tools/vorschau-buendeln.mjs), weil Babylon
        dort ohnehin liegt. `@vite-ignore` hält es aus dem Bündel dieser Seite
        heraus — Vite soll die 2,8 MB weder anfassen noch mitziehen.
      */
      try {
        const pfad = '/assets/js/vorschau.js';
        const modul = (await import(/* @vite-ignore */ pfad)) as {
          Vorschau: new (leinwand: HTMLCanvasElement, wurzel: string) => Vorschau;
        };
        vorschau = new modul.Vorschau(leinwand, modellWurzel);
      } catch (e) {
        console.error('[erstellung] vorschau.js', e);
        hinweisText = fuelle(t['erstellen.buehne.hinweis.modul_fehlt'], {
          fehler: String(e).slice(0, 90),
        });
        return;
      }
    }

    await ladeAlles();
    fussHinweisAn = true;
  }

  /**
   * Bühne abräumen, wenn die Sperre zufällt.
   *
   * `dispose()` ist nicht Höflichkeit: Die Leinwand verschwindet mit dem
   * `{#if}` aus dem DOM, aber Babylons Engine liefe mit ihrem Renderloop
   * weiter und hinge an einer Leinwand, die niemand mehr sieht.
   */
  function raeumeBuehne() {
    vorschau?.dispose();
    vorschau = null;
    fertig = false;
    fussHinweisAn = false;
    hinweisText = null;
  }

  /* ------------------------------------------------------ Gestadewahl */

  async function gestadeGewechselt() {
    writeShore(gestade);
    merke();
    namensFehler = null;
    sendeFehler = null;

    const nunAngemeldet = readToken(gestade) !== null;
    if (nunAngemeldet !== angemeldet) {
      // Das Konto ist ein anderes: getrennte Datenbank je Gestade.
      if (!nunAngemeldet) raeumeBuehne();
      angemeldet = nunAngemeldet;
      if (nunAngemeldet) await starteBuehne();
      return;
    }
    // Gleiche Sperrlage, aber andere Modelle: die Vorschau holt sie vom
    // gewählten Gestade, nicht immer von live.
    if (angemeldet) await ladeAlles();
  }

  function schritt(liste: Eintrag[], aktuell: string, richtung: number, mitLeer: boolean): string {
    const ids = mitLeer ? ['', ...liste.map((e) => e.id)] : liste.map((e) => e.id);
    if (!ids.length) return aktuell;
    const i = Math.max(0, ids.indexOf(aktuell));
    return ids[(i + richtung + ids.length) % ids.length];
  }

  /* ---------------------------------------------------------- Losfahren */

  /** Token weg, zurück zur Anmeldung — der einzige Weg nach einer 401. */
  async function zurAnmeldung() {
    clearToken(gestade);
    raeumeBuehne();
    angemeldet = false;
    await goto(`${localizedPath(lang, '/anmelden')}?abgelaufen=1`);
  }

  /**
   * Recken anlegen, Ticket holen, hinüberschicken.
   *
   * Zwei Aufrufe, nicht einer: Der erste legt den Recken am Konto an und
   * bekommt seine Id, der zweite tauscht die Id gegen ein Sitzungstoken.
   * Der Server erzeugt dabei `spielerId` und `altlastUserId` selbst und gibt
   * sie nie heraus — die Webseite kann eine Spielidentität also nicht
   * erfinden, nur erbitten.
   */
  async function losfahren() {
    if (sendet) return;
    merke();
    namensFehler = null;
    sendeFehler = null;

    const token = readToken(gestade);
    if (!token) return zurAnmeldung();

    sendet = true;
    try {
      const neu = await charakterAnlegen(gestade, token, {
        name: spielerName.trim(),
        figur,
        frisur,
        ober,
        beine,
      });
      const ticket = await spielen(gestade, token, neu.character.id);
      location.href = playUrl(gestade, ticket.character, ticket.sessionToken, zeit);
    } catch (err) {
      sendet = false;
      if (isLoggedOut(err)) return zurAnmeldung();
      const schluessel = err instanceof ApiError ? err.key : '';
      if (schluessel === 'name-ungueltig' || schluessel === 'name-vergeben') {
        // Fehler am Feld, nicht über der Seite: Die Aussehenswahl bleibt
        // stehen, und der Blick landet dort, wo etwas zu ändern ist.
        namensFehler = errorMessageKey(schluessel);
      } else {
        sendeFehler = schluessel ? errorMessageKey(schluessel) : 'konto.fehler.unerwartet';
      }
    }
  }

  onMount(async () => {
    bereit = true;

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
      alt = JSON.parse(localStorage.getItem(SPEICHER) ?? '{}');
    } catch {
      /* egal */
    }

    // `signedInShore()` sieht auch beim anderen Gestade nach: Wer nur auf
    // Midgard ein Konto hat, soll nicht die Sperre sehen, während sein
    // Token unter dem anderen Schlüssel bereitliegt. `alt.server` ist der
    // Rest aus der Zeit vor `wov-gestade` und wird noch einmal gelesen,
    // damit niemand seine Wahl verliert.
    const gemerkt = readShore() ?? (alt.server === 'live' || alt.server === 'dev' ? alt.server : null);
    gestade = signedInShore() ?? gemerkt ?? 'dev';
    angemeldet = readToken(gestade) !== null;

    if (angemeldet) await starteBuehne();
  });
</script>

<Kopfdaten
  titel={t['erstellen.kopf.titel']}
  beschreibung={t['erstellen.kopf.beschreibung']}
  noindex
/>

<main class="mitte" style="padding-block: 22px 34px">
  <div class="erstellen-kopfzeile">
    <h1>{t['erstellen.titel']}</h1>
    <p>{t['erstellen.einleitung']}</p>
  </div>

  {#if angemeldet}
    <div class="erstellen-raster">
      <!-- links: Aussehen -->
      <aside class="tafel">
        <h2>{t['erstellen.aussehen.titel']}</h2>

        <label class="feldname" for="figur-wahl">{t['erstellen.aussehen.figur.label']}</label>
        <select id="figur-wahl" bind:value={figur} onchange={() => { merke(); void ladeAlles(); }}>
          {#each daten?.figuren ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
        </select>

        <label class="feldname" for="frisur-wahl">{t['erstellen.aussehen.frisur.label']}</label>
        <div class="waehler">
          <button type="button" aria-label={t['erstellen.aussehen.frisur.vorige']}
            onclick={() => { frisur = schritt(daten?.frisuren ?? [], frisur, -1, false); merke(); void zeigeAussehen(); }}>‹</button>
          <select id="frisur-wahl" bind:value={frisur} onchange={() => { merke(); void zeigeAussehen(); }}>
            {#each daten?.frisuren ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <button type="button" aria-label={t['erstellen.aussehen.frisur.naechste']}
            onclick={() => { frisur = schritt(daten?.frisuren ?? [], frisur, 1, false); merke(); void zeigeAussehen(); }}>›</button>
        </div>

        <label class="feldname" for="oberkoerper-wahl">{t['erstellen.aussehen.oberkoerper.label']}</label>
        <div class="waehler">
          <button type="button" aria-label={t['erstellen.aussehen.oberkoerper.voriges']}
            onclick={() => { ober = schritt(oberTeile, ober, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
          <select id="oberkoerper-wahl" bind:value={ober} onchange={() => { merke(); void zeigeAussehen(); }}>
            <option value="">{t['erstellen.aussehen.oberkoerper.nichts']}</option>
            {#each oberTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <button type="button" aria-label={t['erstellen.aussehen.oberkoerper.naechstes']}
            onclick={() => { ober = schritt(oberTeile, ober, 1, true); merke(); void zeigeAussehen(); }}>›</button>
        </div>

        <label class="feldname" for="beine-wahl">{t['erstellen.aussehen.beine.label']}</label>
        <div class="waehler">
          <button type="button" aria-label={t['erstellen.aussehen.beine.voriges']}
            onclick={() => { beine = schritt(beinTeile, beine, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
          <select id="beine-wahl" bind:value={beine} onchange={() => { merke(); void zeigeAussehen(); }}>
            <option value="">{t['erstellen.aussehen.beine.nichts']}</option>
            {#each beinTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
          <button type="button" aria-label={t['erstellen.aussehen.beine.naechstes']}
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
        <div class="buehne-hinweis" class:fertig>
          {hinweisText ?? t['erstellen.buehne.hinweis.laedt']}
        </div>
        <div class="buehne-werkzeug">
          <button type="button" title={t['erstellen.buehne.dreh_links']} onclick={() => vorschau?.drehe(-0.35)}>↺</button>
          <button type="button" title={t['erstellen.buehne.dreh_rechts']} onclick={() => vorschau?.drehe(0.35)}>↻</button>
          <button type="button" title={t['erstellen.buehne.blick_zurueck']} onclick={() => vorschau?.blickZurueck()}>⌂</button>
        </div>
      </div>

      <!-- rechts: Fahrt -->
      <aside class="tafel">
        <h2>{t['erstellen.fahrt.titel']}</h2>

        <label class="feldname" for="spieler-name">{t['erstellen.fahrt.name.label']}</label>
        <input
          type="text"
          id="spieler-name"
          maxlength="24"
          placeholder={t['erstellen.fahrt.name.platzhalter']}
          aria-invalid={namensFehler ? 'true' : undefined}
          aria-describedby="name-hilfe"
          bind:value={spielerName}
          onchange={merke}
        />
        {#if namensFehler}
          <p class="konto-fehler" id="name-hilfe" role="alert">{t[namensFehler]}</p>
        {:else}
          <p class="gestade-hinweis" id="name-hilfe">{t['erstellen.fahrt.name.hilfe']}</p>
        {/if}

        <label class="feldname" for="server-wahl">{t['erstellen.fahrt.gestade.label']}</label>
        <select id="server-wahl" bind:value={gestade} onchange={gestadeGewechselt}>
          {#each SHORE_IDS as s (s)}
            <option value={s}>{t[SHORE_LABEL[s]]}</option>
          {/each}
        </select>
        <p class="gestade-hinweis">{gestadeHinweis}</p>

        {#if gestade === 'dev'}
          <label class="feldname" for="zeit-wahl">{t['erstellen.fahrt.zeit.label']}</label>
          <select id="zeit-wahl" bind:value={zeit} onchange={merke}>
            <option value="">{t['erstellen.fahrt.zeit.serverzeit']}</option>
            {#each stunden as s (s.wert)}
              <option value={s.wert}>{s.text}</option>
            {/each}
          </select>
          <p class="gestade-hinweis">{t['erstellen.fahrt.zeit.hinweis']}</p>
        {/if}

        {#if sendeFehler}
          <p class="konto-melder" role="alert">{t[sendeFehler]}</p>
        {/if}
      </aside>
    </div>

    <div class="erstellen-fuss">
      <span class="hinweis-klein">{fussHinweisAn ? t['erstellen.fuss.hinweis'] : ''}</span>
      <a class="knopf knopf-rand" href={localizedPath(lang, '/konto')}>{t['erstellen.zu_konto']}</a>
      <a class="knopf knopf-rand" href={localizedPath(lang, '/')}>{t['erstellen.fuss.zurueck']}</a>
      <button type="button" class="knopf knopf-gross" disabled={sendet} onclick={losfahren}>
        {sendet ? t['erstellen.knopf.laeuft'] : t['erstellen.knopf.losfahren']}
      </button>
    </div>
  {:else}
    <!--
      Die Anmeldesperre. Genau dieser Zustand steht im vorgerenderten HTML
      und ist damit auch das, was ohne JavaScript dasteht.
    -->
    <div class="konto-schmal">
      <div class="konto-tafel">
        <h2 style="margin-top:0">{t['erstellen.sperre.titel']}</h2>
        <p style="color:var(--matt)">{t['erstellen.sperre.text']}</p>

        {#if bereit}
          <!-- Die Gestadewahl steht nur mit Skript da: ohne Skript wäre sie
               ein Kasten, dessen Umstellen nichts bewirkt. -->
          <label class="feldname" for="sperre-gestade">{t['erstellen.fahrt.gestade.label']}</label>
          <select id="sperre-gestade" bind:value={gestade} onchange={gestadeGewechselt}>
            {#each SHORE_IDS as s (s)}
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
            {/each}
          </select>
          <p class="gestade-hinweis">{t['konto.gestade.hilfe']}</p>
        {/if}

        <div class="konto-tat">
          <a class="knopf" href={localizedPath(lang, '/anmelden')}>
            {t['erstellen.sperre.anmelden']}
          </a>
          <a class="knopf knopf-rand" href={localizedPath(lang, '/registrieren')}>
            {t['erstellen.sperre.registrieren']}
          </a>
        </div>
      </div>
    </div>
  {/if}
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

  .erstellen-fuss { display: flex; align-items: center; gap: 14px; margin: 20px 0 0; flex-wrap: wrap; }
  .hinweis-klein { color: var(--umriss); font-size: 12px; margin-right: auto; }
</style>
