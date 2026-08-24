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
    clearToken,
    createCharacter,
    errorMessageKey,
    isLoggedOut,
    play,
    playUrl,
    readShore,
    readToken,
    signedInShore,
    writeShore,
  } from '$lib/account';
  import '$lib/stil/account.css';

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
   * dazu steht bei `playUrl()` in `$lib/account.ts`.
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

  /**
   * Ein Eintrag aus `assets/appearance.json`.
   *
   * Die FELDNAMEN sind englisch, weil sie Drahtformat sind — dieselbe
   * Datei liest auch /konto. Die WERTE (`id`, `slot`) bleiben, wie
   * `shared/aussehen.ts` sie fuehrt: `wikingerin`, `H_01`, `leder_bh`,
   * `oberkoerper`. Sie stehen im Weltspeicher und in der
   * Kontendatenbank; sie zu uebersetzen waere eine Datenwanderung.
   */
  interface Eintrag {
    /** sRGB-Hex, nur bei Haarfarben belegt. */
    hex?: string; id: string; name: string; file?: string; slot?: string }
  interface Aussehen {
    folder: string;
    body: string;
    figures: Eintrag[];
    hairstyles: Eintrag[];
    hairColors: Eintrag[];
    equipment: Eintrag[];
    defaultFigure?: string;
    defaultHairstyle?: string;
    defaultHairColor?: string;
    /**
     * Stunde → Beschriftung, z. B. { "3": "Sonnenaufgang" }.
     *
     * Kommt aus der erzeugten Datei und steht hier bewusst NICHT fest:
     * Der Sonnenaufgang liegt bei 0,1333 des Tages, also gegen 03:00
     * und nicht bei 06:00. Eine hier getippte Beschriftung wäre eine
     * zweite Wahrheit neben dem Umgebungsmodell des Spiels.
     */
    timeOfDay?: { marks: Record<string, string> };
  }

  /** Was vom Vorschau-Bündel benutzt wird — gemessen an `vorschau.js`. */
  interface Vorschau {
    setzeWurzel(url: string): Promise<void>;
    ladeKoerper(pfad: string): Promise<void>;
    setze(slot: string, datei: string | null): Promise<void>;
    /** sRGB-Hex; leer laesst die Farbe des Modells stehen. */
    setzeHaarfarbe(hex: string): void;
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
  let haarfarbe = $state('');
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

  const oberTeile = $derived(daten?.equipment.filter((r) => r.slot === 'oberkoerper') ?? []);
  const beinTeile = $derived(daten?.equipment.filter((r) => r.slot === 'beine') ?? []);

  const gestadeHinweis = $derived(
    gestade === 'dev'
      ? t['create.voyage.shore.hint.dev']
      : t['create.voyage.shore.hint.live'],
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
      const marke = daten?.timeOfDay?.marks[String(h)];
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
        JSON.stringify({ figur, frisur, haarfarbe, ober, beine, name: spielerName, zeit })
      );
    } catch {
      /* privater Modus: dann eben nicht */
    }
  }

  function datei(liste: Eintrag[], id: string): string | null {
    const e = liste.find((x) => x.id === id);
    return e?.file && daten ? `${daten.folder}/${e.file}` : null;
  }

  /* -------------------------------------------------------- Die Bühne */

  async function zeigeAussehen() {
    if (!vorschau || !daten) return;
    await vorschau.setze('frisur', datei(daten.hairstyles, frisur) ?? datei(daten.hairstyles, daten.hairstyles[0]?.id ?? ''));
    // Die Haarfarbe ist kein Modell, sondern eine Toenung auf dem
    // Frisurmodell -- deshalb NACH der Frisur und ueber einen eigenen Weg.
    // Ohne diesen Aufruf steht die Auswahl da und die Vorschau zeigt sie
    // nicht; genau so war es, bevor der Auswaehler ueberhaupt fehlte.
    const ton = (daten.hairColors ?? []).find((h) => h.id === haarfarbe)?.hex ?? '';
    vorschau.setzeHaarfarbe(ton);
    await vorschau.setze('oberkoerper', datei(daten.equipment, ober));
    await vorschau.setze('beine', datei(daten.equipment, beine));
  }

  async function ladeAlles() {
    if (!vorschau || !daten) return;
    fertig = false;
    hinweisText = null;
    try {
      await vorschau.setzeWurzel(modellWurzel);
      await vorschau.ladeKoerper(`${daten.folder}/${daten.body}`);
      await zeigeAussehen();
      fertig = true;
    } catch (e) {
      // Die Meldung nennt Adresse UND Grund. Eine Vorgängerfassung sagte nur
      // „liess sich nicht laden“ — damit war weder zu erkennen, ob der Server
      // schweigt, ob die Datei fehlt oder ob der Browser die Domaingrenze
      // blockt, und jede Fehlersuche begann mit Raten.
      const url = `${modellWurzel}${daten.folder}/${daten.body}.glb`;
      console.warn('[erstellung] Laden fehlgeschlagen:', url, e);
      let grund = String(e instanceof Error ? e.message : e);
      try {
        const probe = await fetch(url, { method: 'GET' });
        grund = probe.ok
          ? fuelle(t['create.stage.hint.file_reachable'], { status: probe.status })
          : fuelle(t['create.stage.hint.server_status'], { status: probe.status });
      } catch (netz) {
        grund = fuelle(t['create.stage.hint.no_access'], {
          fehler: String(netz).slice(0, 60),
        });
      }
      fertig = false;
      hinweisText = fuelle(t['create.stage.hint.not_loaded'], { grund });
    }
  }

  function vorgabenWaehlen() {
    if (!daten) return;
    const gueltig = (liste: Eintrag[], wert?: string) =>
      wert && liste.some((e) => e.id === wert) ? wert : undefined;

    figur = gueltig(daten.figures, alt.figur) ?? daten.defaultFigure ?? daten.figures[0]?.id ?? '';
    frisur = gueltig(daten.hairstyles, alt.frisur) ?? daten.defaultHairstyle ?? daten.hairstyles[0]?.id ?? '';
    haarfarbe =
      gueltig(daten.hairColors, alt.haarfarbe) ?? daten.defaultHairColor ?? daten.hairColors[0]?.id ?? '';
    ober = gueltig(daten.equipment, alt.ober) ?? '';
    beine = gueltig(daten.equipment, alt.beine) ?? '';
    if (alt.name) spielerName = alt.name;
    // Gemerktes prüfen statt übernehmen: Ein unsinniger Wert liesse den
    // Auswahlkasten leer erscheinen, und was hier steht, reist als ?time=
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
        daten = await holeJson<Aussehen>('/assets/appearance.json');
      } catch (e) {
        console.error('[erstellung]', e);
        hinweisText = t['create.stage.hint.lists_missing'];
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
        hinweisText = fuelle(t['create.stage.hint.module_missing'], {
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
      const neu = await createCharacter(gestade, token, {
        name: spielerName.trim(),
        figure: figur,
        hairstyle: frisur,
        hairColor: haarfarbe,
        top: ober,
        legs: beine,
      });
      const ticket = await play(gestade, token, neu.character.id);
      location.href = playUrl(gestade, ticket.sessionToken, zeit);
    } catch (err) {
      sendet = false;
      if (isLoggedOut(err)) return zurAnmeldung();
      const schluessel = err instanceof ApiError ? err.key : '';
      if (schluessel === 'name-ungueltig' || schluessel === 'name-vergeben') {
        // Fehler am Feld, nicht über der Seite: Die Aussehenswahl bleibt
        // stehen, und der Blick landet dort, wo etwas zu ändern ist.
        namensFehler = errorMessageKey(schluessel);
      } else {
        sendeFehler = schluessel ? errorMessageKey(schluessel) : 'account.error.unexpected';
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
  titel={t['create.meta.title']}
  beschreibung={t['create.meta.description']}
  noindex
/>

<main class="mitte" style="padding-block:clamp(20px,3.5vh,40px) 3rem">
  <div class="erstellen-kopfzeile">
    <h1>{t['create.title']}</h1>
    <p>{t['create.intro']}</p>
  </div>

  {#if angemeldet}
    <div class="erstellen-raster">
      <!-- links: Aussehen -->
      <aside class="tafel">
        <h2>{t['create.appearance.title']}</h2>

        <!--
          Figur bleibt ein blosses Auswahlfeld: In appearance.json steht
          GENAU EIN Eintrag (`wikingerin`). Ein Pfeilpaar davor, wie der
          Entwurf es zeichnet, wuerde bei jedem Druck denselben Wert wieder
          setzen — zwei Knoepfe, die nachweislich nichts tun.
        -->
        <div class="erstellen-feld">
          <label class="feldname" for="create-figure">{t['create.appearance.figure.label']}</label>
          <select id="create-figure" bind:value={figur} onchange={() => { merke(); void ladeAlles(); }}>
            {#each daten?.figures ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </div>

        <div class="erstellen-feld">
          <label class="feldname" for="create-hairstyle">{t['create.appearance.hair.label']}</label>
          <div class="waehler">
            <button type="button" aria-label={t['create.appearance.hair.previous']}
              onclick={() => { frisur = schritt(daten?.hairstyles ?? [], frisur, -1, false); merke(); void zeigeAussehen(); }}>‹</button>
            <select id="create-hairstyle" bind:value={frisur} onchange={() => { merke(); void zeigeAussehen(); }}>
              {#each daten?.hairstyles ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            <button type="button" aria-label={t['create.appearance.hair.next']}
              onclick={() => { frisur = schritt(daten?.hairstyles ?? [], frisur, 1, false); merke(); void zeigeAussehen(); }}>›</button>
          </div>
        </div>

        <div class="erstellen-feld">
          <label class="feldname" for="create-haircolor">{t['create.appearance.haircolor.label']}</label>
          <div class="waehler">
            <button type="button" aria-label={t['create.appearance.haircolor.previous']}
              onclick={() => { haarfarbe = schritt(daten?.hairColors ?? [], haarfarbe, -1, false); merke(); void zeigeAussehen(); }}>‹</button>
            <select id="create-haircolor" bind:value={haarfarbe} onchange={() => { merke(); void zeigeAussehen(); }}>
              {#each daten?.hairColors ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            <button type="button" aria-label={t['create.appearance.haircolor.next']}
              onclick={() => { haarfarbe = schritt(daten?.hairColors ?? [], haarfarbe, 1, false); merke(); void zeigeAussehen(); }}>›</button>
          </div>
        </div>

        <div class="erstellen-feld">
          <label class="feldname" for="create-top">{t['create.appearance.chest.label']}</label>
          <div class="waehler">
            <button type="button" aria-label={t['create.appearance.chest.previous']}
              onclick={() => { ober = schritt(oberTeile, ober, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
            <select id="create-top" bind:value={ober} onchange={() => { merke(); void zeigeAussehen(); }}>
              <option value="">{t['create.appearance.chest.none']}</option>
              {#each oberTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            <button type="button" aria-label={t['create.appearance.chest.next']}
              onclick={() => { ober = schritt(oberTeile, ober, 1, true); merke(); void zeigeAussehen(); }}>›</button>
          </div>
        </div>

        <div class="erstellen-feld">
          <label class="feldname" for="create-legs">{t['create.appearance.legs.label']}</label>
          <div class="waehler">
            <button type="button" aria-label={t['create.appearance.legs.previous']}
              onclick={() => { beine = schritt(beinTeile, beine, -1, true); merke(); void zeigeAussehen(); }}>‹</button>
            <select id="create-legs" bind:value={beine} onchange={() => { merke(); void zeigeAussehen(); }}>
              <option value="">{t['create.appearance.legs.none']}</option>
              {#each beinTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            <button type="button" aria-label={t['create.appearance.legs.next']}
              onclick={() => { beine = schritt(beinTeile, beine, 1, true); merke(); void zeigeAussehen(); }}>›</button>
          </div>
        </div>
      </aside>

      <!-- Mitte: Bühne -->
      <section class="buehne-spalte">
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
          {hinweisText ?? t['create.stage.hint.loading']}
        </div>
        <div class="buehne-werkzeug">
          <button type="button" title={t['create.stage.rotate_left']} onclick={() => vorschau?.drehe(-0.35)}>↺</button>
          <button type="button" title={t['create.stage.rotate_right']} onclick={() => vorschau?.drehe(0.35)}>↻</button>
          <button type="button" title={t['create.stage.reset_view']} onclick={() => vorschau?.blickZurueck()}>⌂</button>
        </div>
      </div>
      <!--
        Die Bedienungszeile steht UNTER dem Rahmen, nicht im Fuss der ganzen
        Seite: Sie erklaert das Ziehen und Zoomen, und das geschieht genau
        einen Zentimeter darueber. Sie erscheint erst, wenn die Buehne steht
        — vorher gaebe es nichts zu ziehen.
      -->
      <p class="buehne-fuss">{fussHinweisAn ? t['create.footer.hint'] : ''}</p>
      </section>

      <!-- rechts: Fahrt -->
      <aside class="tafel">
        <h2>{t['create.voyage.title']}</h2>

        <div class="erstellen-feld">
          <label class="feldname" for="create-name">{t['create.voyage.name.label']}</label>
          <input
            type="text"
            id="create-name"
            maxlength="24"
            placeholder={t['create.voyage.name.placeholder']}
            aria-invalid={namensFehler ? 'true' : undefined}
            aria-describedby="create-name-hint"
            bind:value={spielerName}
            onchange={merke}
          />
          {#if namensFehler}
            <p class="account-error" id="create-name-hint" role="alert">{t[namensFehler]}</p>
          {:else}
            <p class="gestade-hinweis" id="create-name-hint">{t['create.voyage.name.hint']}</p>
          {/if}
        </div>

        <div class="erstellen-feld">
          <label class="feldname" for="create-shore">{t['create.voyage.shore.label']}</label>
          <select id="create-shore" bind:value={gestade} onchange={gestadeGewechselt}>
            {#each SHORE_IDS as s (s)}
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
            {/each}
          </select>
          <p class="gestade-hinweis">{gestadeHinweis}</p>
        </div>

        {#if gestade === 'dev'}
          <div class="erstellen-feld">
            <label class="feldname" for="create-time">{t['create.voyage.time.label']}</label>
            <select id="create-time" bind:value={zeit} onchange={merke}>
              <option value="">{t['create.voyage.time.server_time']}</option>
              {#each stunden as s (s.wert)}
                <option value={s.wert}>{s.text}</option>
              {/each}
            </select>
            <p class="gestade-hinweis">{t['create.voyage.time.hint']}</p>
          </div>
        {/if}

        {#if sendeFehler}
          <p class="account-notice" role="alert">{t[sendeFehler]}</p>
        {/if}
      </aside>
    </div>

    <!--
      Rechtsbuendig wie im Entwurf, aber unter dem GANZEN Raster und mit drei
      Wegen statt zweien: „Deine Recken“ kennt der Entwurf nicht, und ohne
      diesen Link kaeme man von hier nur ueber die Startseite zurueck zur
      eigenen Liste.
    -->
    <div class="erstellen-fuss">
      <a class="knopf knopf-rand" href={localizedPath(lang, '/konto')}>{t['create.to_account']}</a>
      <a class="knopf knopf-rand" href={localizedPath(lang, '/')}>{t['create.footer.back']}</a>
      <button
        type="button"
        class="knopf knopf-gross account-primary erstellen-los"
        disabled={sendet}
        onclick={losfahren}
      >
        {sendet ? t['create.button.loading'] : t['create.button.set_sail']}
      </button>
    </div>
  {:else}
    <!--
      Die Anmeldesperre. Genau dieser Zustand steht im vorgerenderten HTML
      und ist damit auch das, was ohne JavaScript dasteht.
    -->
    <div class="account-column">
      <div class="account-panel">
        <h2>{t['create.gate.title']}</h2>
        <p style="color:var(--text-matt)">{t['create.gate.text']}</p>

        {#if bereit}
          <!-- Die Gestadewahl steht nur mit Skript da: ohne Skript wäre sie
               ein Kasten, dessen Umstellen nichts bewirkt. -->
          <div class="account-field">
            <label class="account-label" for="locked-shore">
              {t['create.voyage.shore.label']}
            </label>
            <select
              class="account-input"
              id="locked-shore"
              bind:value={gestade}
              onchange={gestadeGewechselt}
            >
              {#each SHORE_IDS as s (s)}
                <option value={s}>{t[SHORE_LABEL[s]]}</option>
              {/each}
            </select>
            <p class="account-hint">{t['account.shore.hint']}</p>
          </div>
        {/if}

        <div class="account-actions">
          <a class="knopf account-primary" href={localizedPath(lang, '/anmelden')}>
            {t['create.gate.login']}
          </a>
          <a class="knopf knopf-rand" href={localizedPath(lang, '/registrieren')}>
            {t['create.gate.register']}
          </a>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  /* Nur was diese Seite braucht — der Rest kommt aus wov.css. */
  .erstellen-kopfzeile { text-align: center; margin: 0 0 1.6rem; }
  .erstellen-kopfzeile h1 {
    font-size: clamp(24px, 3.4vw, 34px);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--primaer);
    margin: 0 0 6px;
  }
  /*
    Der Entwurf hat hier gar keine Ueberschrift, nur diesen einen Absatz in
    Pergament. Die Ueberschrift bleibt trotzdem stehen — eine Seite ohne h1
    haette fuer Vorleseprogramme keinen Namen mehr —, aber der Absatz
    bekommt das Aussehen aus dem Entwurf.
  */
  .erstellen-kopfzeile p {
    color: var(--pergament);
    font-size: 16px;
    line-height: 1.6;
    margin: 0;
  }

  /*
    Drei gleich breite Spalten wie im Entwurf — aber nicht mit `auto-fit`.

    `repeat(auto-fit, minmax(17rem, 1fr))` waere die woertliche Uebernahme
    und geht 3 → 2 → 1. Die Zwischenstufe ist gemessen schlecht: bei 900px
    Fenster stehen Aussehen und Buehne nebeneinander, die Fahrt rutscht in
    die zweite Zeile unter das Aussehen, und NEBEN ihr bleibt ein leeres
    Feld von rund 470px Hoehe stehen — die Buehne ist hoeher als das
    Aussehen, also endet Zeile 1 tief.

    Deshalb: entweder drei oder eine. Die Schwelle ist keine gegriffene
    Zahl, sondern dieselbe Rechnung, die `auto-fit` angestellt haette —
    3 × 17rem + 2 × 24px = 864px Inhaltsbreite, und `.mitte` gibt an den
    Seiten je 4vw ab, also 864 / 0,92 ≈ 940px Fensterbreite.
  */
  .erstellen-raster {
    display: grid;
    gap: 24px;
    align-items: start;
    grid-template-columns: 1fr;
  }
  @media (min-width: 940px) {
    .erstellen-raster { grid-template-columns: repeat(3, 1fr); }
  }

  /* Kasten und Bedienungszeile darunter gehoeren zusammen. */
  .buehne-spalte { display: flex; flex-direction: column; gap: 0.9rem; }
  .buehne-fuss { font-size: 13px; color: var(--umriss); margin: 0; min-height: 1.2em; }

  .buehne {
    position: relative;
    border: 1px solid var(--umriss-matt);
    border-radius: var(--account-r-box);
    overflow: hidden;
    height: clamp(360px, 58vh, 620px);
    /* Waldgruen, nicht der alte Graufarbverlauf: Was hier durchscheint,
       bevor der Film laeuft, ist der Schwarzwald. */
    background: var(--stage-forest);
    /* Der Kasten wirft im Entwurf einen Schatten auf die Seite — er steht
       davor, nicht darin. */
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
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
  .buehne-werkzeug { position: absolute; right: 0.9rem; bottom: 0.9rem; display: flex; gap: 0.4rem; z-index: 2; }
  .buehne-werkzeug button {
    width: 2.2rem; height: 2.2rem; padding: 0; font-size: 14px; line-height: 1;
    display: grid; place-items: center;
    /* --eisen (#121212) bei 82 %: Die Knoepfe liegen ueber dem Film und
       muessen ihn durchscheinen lassen, sonst sind es drei schwarze
       Loecher im Wald. */
    background: rgba(18, 18, 18, 0.82);
    color: var(--text-matt);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--r-lg);
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
  }
  .buehne-werkzeug button:hover { color: var(--runengold); border-color: var(--umriss); }

  /*
    Die beiden Tafeln setzen ihre Felder mit `gap`, nicht mit Aussenabstaenden
    an den einzelnen Teilen: So steht der Abstand EINMAL da und nicht an
    Beschriftung, Feld und Hinweiszeile je einmal.
  */
  .tafel { border-radius: var(--account-r-box); display: flex; flex-direction: column; gap: 1.1rem; }
  .tafel h2 {
    font-family: var(--schrift-kopf);
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.01em;
    color: var(--text);
    margin: 0;
  }
  .erstellen-feld { display: flex; flex-direction: column; gap: 0.4rem; }

  .waehler { display: flex; align-items: stretch; gap: 0.4rem; }
  .waehler button {
    width: 2.1rem; flex: 0 0 auto; cursor: pointer;
    background: var(--flaeche);
    color: var(--text-matt);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--account-r-field);
    font-family: var(--schrift-kappen);
    font-size: 13px;
    transition: border-color 0.2s ease, color 0.2s ease;
  }
  .waehler button:hover { color: var(--runengold); border-color: var(--umriss); }
  .waehler select { flex: 1 1 auto; min-width: 0; text-align: center; text-align-last: center; }

  .feldname {
    display: block; font-family: var(--schrift-kappen); font-size: 11px;
    font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--umriss); margin: 0;
  }
  /*
    Nur die Felder DIESER Seite. Die Anmeldesperre weiter unten benutzt
    `.account-input` aus account.css, und ein blosses `select` hier wuerde
    sie mit anderen Werten ueberschreiben — dieselbe Optik zweimal
    beschrieben ist dieselbe Optik genau bis zur ersten Aenderung.
  */
  .tafel input[type='text'], .tafel select {
    width: 100%;
    background: var(--flaeche);
    color: var(--text);
    border: 1px solid var(--umriss-matt);
    border-radius: var(--account-r-field);
    padding: 0.6rem 0.7rem;
    font-family: var(--schrift);
    font-size: 15px;
    transition: border-color 0.2s ease;
  }
  /* Nur die Eingabefelder sind im Entwurf versenkt, die Auswahlkaesten
     nicht — sie tragen ohnehin schon den Pfeil des Browsers. */
  .tafel input[type='text'] {
    padding: 0.6rem 0.8rem;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .tafel input[type='text']:focus, .tafel select:focus {
    outline: none;
    border-color: var(--primaer);
  }

  .gestade-hinweis {
    font-size: 13px; color: var(--umriss); margin: 0; line-height: 1.5;
  }

  .erstellen-fuss {
    display: flex; align-items: center; justify-content: flex-end;
    gap: 0.7rem; margin: 1.4rem 0 0; flex-wrap: wrap;
  }
  /*
    Der einzige Goldknopf des Entwurfs ohne Versalien: „Auf Fahrt gehen“
    steht als Satz da, nicht als Beschriftung. `.knopf` setzt ohnehin kein
    text-transform, hier ist nur Groesse und Laufweite anzupassen.
  */
  .erstellen-los { font-size: 15px; letter-spacing: 0.06em; }
</style>
