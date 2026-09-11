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
    SHORE_OPEN,
    type ShoreId,
    clearToken,
    createCharacter,
    errorMessageKey,
    isLoggedOut,
    isShore,
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

  type DetailTab = 'koerper' | 'gesicht' | 'haare' | 'stil' | 'fahrt';
  type Uebersetzung = { de: string; en: string };
  interface Faehigkeit { zeichen: string; name: Uebersetzung; text: Uebersetzung }
  interface Charakterklasse {
    id: string; zeichen: string; farbe: string; name: Uebersetzung; rolle: Uebersetzung;
    beschreibung: Uebersetzung; werte: readonly [number, number, number, number, number];
    faehigkeiten: readonly Faehigkeit[];
  }

  let detailTab = $state<DetailTab>('koerper');
  let klasseId = $state('krieger');
  const klassen: readonly Charakterklasse[] = [
    { id: 'krieger', zeichen: '⚔', farbe: '#d58a45', name: { de: 'Krieger', en: 'Warrior' }, rolle: { de: 'Tank / Nahkampf-DPS', en: 'Tank / Melee DPS' }, beschreibung: { de: 'Krieger sind kampferprobte Nahkämpfer, die Wut aufbauen, wenn sie Schaden verursachen oder erleiden.', en: 'Warriors are battle-tested melee fighters who build rage as they deal or receive damage.' }, werte: [23, 20, 22, 10, 11], faehigkeiten: [
      { zeichen: 'ᛏ', name: { de: 'Vorpreschen', en: 'Charge' }, text: { de: 'Stürmt auf einen Gegner zu und betäubt ihn kurz.', en: 'Rush an enemy and briefly stun them.' } },
      { zeichen: 'ᛏ', name: { de: 'Brecher-Hieb', en: 'Breaker Strike' }, text: { de: 'Ein schwerer Hieb, der den Nahkampfschaden erhöht.', en: 'A heavy strike that increases melee damage.' } },
      { zeichen: 'ᛏ', name: { de: 'Frühes Grab', en: 'Early Grave' }, text: { de: 'Verwundete Gegner erleiden zusätzlichen Schaden.', en: 'Wounded enemies take additional damage.' } },
    ] },
    { id: 'schildmaid', zeichen: 'ᛉ', farbe: '#d2ad55', name: { de: 'Schildmaid', en: 'Shieldmaiden' }, rolle: { de: 'Tank / Schutz', en: 'Tank / Guard' }, beschreibung: { de: 'Schildmaiden halten die Linie und schützen ihre Gefährten mit unerschütterlicher Disziplin.', en: 'Shieldmaidens hold the line and protect their allies with unshakable discipline.' }, werte: [19, 17, 25, 12, 17], faehigkeiten: [] },
    { id: 'jaeger', zeichen: '➹', farbe: '#83a253', name: { de: 'Jäger', en: 'Hunter' }, rolle: { de: 'Fernkampf-DPS', en: 'Ranged DPS' }, beschreibung: { de: 'Jäger lesen Spuren, kontrollieren Distanz und treffen, bevor sie gesehen werden.', en: 'Hunters read tracks, control distance and strike before they are seen.' }, werte: [14, 24, 17, 16, 15], faehigkeiten: [] },
    { id: 'skalde', zeichen: '♫', farbe: '#4fa993', name: { de: 'Skalde', en: 'Skald' }, rolle: { de: 'Unterstützung', en: 'Support' }, beschreibung: { de: 'Skalden tragen alte Lieder in die Schlacht und stärken die Gruppe mit Runenklang.', en: 'Skalds carry old songs into battle and strengthen the party with rune-song.' }, werte: [13, 18, 18, 22, 21], faehigkeiten: [] },
    { id: 'seherin', zeichen: '✹', farbe: '#9d83cf', name: { de: 'Seherin', en: 'Seer' }, rolle: { de: 'Heilung / Magie', en: 'Healing / Magic' }, beschreibung: { de: 'Seherinnen deuten die Fäden des Schicksals und wenden den Ausgang eines Kampfes.', en: 'Seers read the threads of fate and turn the outcome of a battle.' }, werte: [9, 14, 16, 25, 24], faehigkeiten: [] },
    { id: 'berserker', zeichen: 'ᚢ', farbe: '#da684f', name: { de: 'Berserker', en: 'Berserker' }, rolle: { de: 'Nahkampf-DPS', en: 'Melee DPS' }, beschreibung: { de: 'Berserker tauschen Schutz gegen rohe Kraft und entfesseln kurze, vernichtende Angriffe.', en: 'Berserkers trade protection for raw power and unleash short, devastating attacks.' }, werte: [25, 21, 18, 8, 12], faehigkeiten: [] },
    { id: 'runenmagier', zeichen: 'ᚱ', farbe: '#55a9c6', name: { de: 'Runenmagier', en: 'Runemage' }, rolle: { de: 'Magie-DPS', en: 'Magic DPS' }, beschreibung: { de: 'Runenmagier binden elementare Kräfte in Zeichen aus Licht und Stein.', en: 'Runemages bind elemental forces into signs of light and stone.' }, werte: [8, 15, 15, 25, 22], faehigkeiten: [] },
    { id: 'hexer', zeichen: 'ᛈ', farbe: '#8b5ec2', name: { de: 'Hexer', en: 'Warlock' }, rolle: { de: 'Kontrolle / Magie', en: 'Control / Magic' }, beschreibung: { de: 'Hexer schwächen ihre Feinde mit Flüchen und verbotenen Zeichen.', en: 'Warlocks weaken their enemies with curses and forbidden signs.' }, werte: [10, 14, 16, 24, 21], faehigkeiten: [] },
    { id: 'druide', zeichen: '☘', farbe: '#c28a3d', name: { de: 'Druide', en: 'Druid' }, rolle: { de: 'Wandel / Heilung', en: 'Shifting / Healing' }, beschreibung: { de: 'Druiden rufen die Kräfte der Wildnis und wechseln ihre Rolle mit der Gestalt.', en: 'Druids call on the wild and change their role with their shape.' }, werte: [15, 18, 18, 21, 23], faehigkeiten: [] },
  ];
  const aktiveKlasse = $derived(klassen.find((eintrag) => eintrag.id === klasseId) ?? klassen[0]);
  const wertNamen = $derived(lang === 'de' ? ['Stärke', 'Beweglichkeit', 'Ausdauer', 'Intelligenz', 'Willenskraft'] : ['Strength', 'Agility', 'Stamina', 'Intellect', 'Willpower']);
  const tabs = $derived(lang === 'de'
    ? [{ id: 'koerper' as const, name: 'Körper' }, { id: 'gesicht' as const, name: 'Gesicht' }, { id: 'haare' as const, name: 'Haare' }, { id: 'stil' as const, name: 'Stil' }, { id: 'fahrt' as const, name: 'Fahrt' }]
    : [{ id: 'koerper' as const, name: 'Body' }, { id: 'gesicht' as const, name: 'Face' }, { id: 'haare' as const, name: 'Hair' }, { id: 'stil' as const, name: 'Style' }, { id: 'fahrt' as const, name: 'Voyage' }]);

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
      angemeldet = nunAngemeldet;
    }
    await ladeAlles();
  }

  function schritt(liste: Eintrag[], aktuell: string, richtung: number, mitLeer: boolean): string {
    const ids = mitLeer ? ['', ...liste.map((e) => e.id)] : liste.map((e) => e.id);
    if (!ids.length) return aktuell;
    const i = Math.max(0, ids.indexOf(aktuell));
    return ids[(i + richtung + ids.length) % ids.length];
  }

  function zufall(liste: Eintrag[], mitLeer = false): string {
    const ids = mitLeer ? ['', ...liste.map((e) => e.id)] : liste.map((e) => e.id);
    return ids[Math.floor(Math.random() * ids.length)] ?? '';
  }

  async function zufaelligesAussehen() {
    if (!daten) return;
    figur = zufall(daten.figures);
    frisur = zufall(daten.hairstyles);
    haarfarbe = zufall(daten.hairColors);
    ober = zufall(oberTeile, true);
    beine = zufall(beinTeile, true);
    merke();
    await ladeAlles();
  }

  async function aussehenZuruecksetzen() {
    if (!daten) return;
    figur = daten.defaultFigure ?? daten.figures[0]?.id ?? '';
    frisur = daten.defaultHairstyle ?? daten.hairstyles[0]?.id ?? '';
    haarfarbe = daten.defaultHairColor ?? daten.hairColors[0]?.id ?? '';
    ober = '';
    beine = '';
    merke();
    await ladeAlles();
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
      location.href = playUrl(gestade, ticket.sessionToken, lang, zeit);
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
    const altWert = alt.server === 'live' || alt.server === 'dev' ? alt.server : null;
    const gemerkt = readShore() ?? (altWert && SHORE_OPEN[altWert] ? altWert : null);

    /*
      Ein `?shore=` in der Adresse schlägt alles andere. Es steht dort, weil
      jemand im Tor der Halle gerade eben ein Gestade angeklickt hat — eine
      frische, ausdrückliche Wahl wiegt schwerer als ein Token, das noch beim
      anderen Gestade liegt. Ohne den Vorrang führte ein Klick auf „Midgard“
      zurück ans Testgestade, sobald man dort einmal angemeldet war.

      Gelesen wird das erst hier, in `onMount`: Beim Vorrendern wirft
      `url.searchParams` (die Seite hat keine Anfrage, aus der ein Parameter
      stammen könnte) und der Build bliebe stehen.
    */
    const roh = page.url.searchParams.get('shore');
    const gewuenscht = isShore(roh) && SHORE_OPEN[roh] ? roh : null;
    gestade = gewuenscht ?? signedInShore() ?? gemerkt ?? 'dev';
    if (gewuenscht) writeShore(gewuenscht);
    angemeldet = readToken(gestade) !== null;

    await starteBuehne();
  });

  onMount(() => {
    document.body.dataset.sveltekitReload = '';
    return () => delete document.body.dataset.sveltekitReload;
  });
</script>

<!--
  Diese Seite wird unabhängig von den übrigen, bereits laufenden Seiten
  ausgerollt. Ein Vollreload beim Verlassen verhindert deshalb, dass ein
  älteres, schon geöffnetes App-Bündel eine andere Route im Browser rendert.
-->
<Kopfdaten
  titel={t['create.meta.title']}
  beschreibung={t['create.meta.description']}
  noindex
/>

<main class="charakter-schmiede" data-testid="character-creator">
  <div class="kulisse" aria-hidden="true"></div>

  <header class="schmiede-kopf">
    <h1>{t['create.title']}</h1>
    <label class="nur-vorlesen" for="create-name">{t['create.voyage.name.label']}</label>
    <input
      id="create-name"
      class="namensfeld"
      type="text"
      maxlength="24"
      placeholder={t['create.voyage.name.placeholder']}
      aria-invalid={namensFehler ? 'true' : undefined}
      bind:value={spielerName}
      onchange={merke}
    />
    {#if namensFehler}<p class="feld-fehler" role="alert">{t[namensFehler]}</p>{/if}
  </header>

  <aside class="anpassung glasrahmen" aria-label={t['create.appearance.title']}>
    <div class="panel-kopf">
      <h2>{t['create.appearance.title']}</h2>
      <div class="schnellaktionen">
        <button type="button" onclick={zufaelligesAussehen}>{lang === 'de' ? 'Zufällig' : 'Random'}</button>
        <button type="button" onclick={aussehenZuruecksetzen}>{lang === 'de' ? 'Zurücksetzen' : 'Reset'}</button>
      </div>
    </div>

    <div class="detail-tabs" role="tablist" aria-label={lang === 'de' ? 'Bereich' : 'Section'}>
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === tab.id}
          class:aktiv={detailTab === tab.id}
          onclick={() => (detailTab = tab.id)}>{tab.name}</button
        >
      {/each}
    </div>

    <div class="detail-inhalt">
      {#if detailTab === 'koerper'}
        <div class="erstellen-feld">
          <label class="feldname" for="create-figure">{t['create.appearance.figure.label']}</label>
          <select id="create-figure" bind:value={figur} onchange={() => { merke(); void ladeAlles(); }}>
            {#each daten?.figures ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </div>
        <p class="platzhalter-hinweis">{lang === 'de' ? 'Weitere Körperformen folgen.' : 'More body shapes coming later.'}</p>
      {:else if detailTab === 'gesicht'}
        <div class="platzhalter-flaeche">
          <span aria-hidden="true">ᛟ</span>
          <p>{lang === 'de' ? 'Gesichtszüge werden im nächsten Schritt ergänzt.' : 'Facial features will be added in the next step.'}</p>
        </div>
      {:else if detailTab === 'haare'}
        <div class="erstellen-feld">
          <label class="feldname" for="create-hairstyle">{t['create.appearance.hair.label']}</label>
          <div class="waehler">
            <button type="button" aria-label={t['create.appearance.hair.previous']} onclick={() => { frisur = schritt(daten?.hairstyles ?? [], frisur, -1, false); merke(); void zeigeAussehen(); }}>‹</button>
            <select id="create-hairstyle" bind:value={frisur} onchange={() => { merke(); void zeigeAussehen(); }}>
              {#each daten?.hairstyles ?? [] as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
            </select>
            <button type="button" aria-label={t['create.appearance.hair.next']} onclick={() => { frisur = schritt(daten?.hairstyles ?? [], frisur, 1, false); merke(); void zeigeAussehen(); }}>›</button>
          </div>
        </div>
        <fieldset class="farbwahl">
          <legend>{t['create.appearance.haircolor.label']}</legend>
          {#each daten?.hairColors ?? [] as farbe (farbe.id)}
            <button
              type="button"
              class:aktiv={haarfarbe === farbe.id}
              style={'--farbton:' + (farbe.hex ?? '#777')}
              title={farbe.name}
              aria-label={farbe.name}
              aria-pressed={haarfarbe === farbe.id}
              onclick={() => { haarfarbe = farbe.id; merke(); void zeigeAussehen(); }}
            ></button>
          {/each}
        </fieldset>
      {:else if detailTab === 'stil'}
        <div class="erstellen-feld">
          <label class="feldname" for="create-top">{t['create.appearance.chest.label']}</label>
          <select id="create-top" bind:value={ober} onchange={() => { merke(); void zeigeAussehen(); }}>
            <option value="">{t['create.appearance.chest.none']}</option>
            {#each oberTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </div>
        <div class="erstellen-feld">
          <label class="feldname" for="create-legs">{t['create.appearance.legs.label']}</label>
          <select id="create-legs" bind:value={beine} onchange={() => { merke(); void zeigeAussehen(); }}>
            <option value="">{t['create.appearance.legs.none']}</option>
            {#each beinTeile as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </div>
      {:else}
        <div class="erstellen-feld">
          <label class="feldname" for="create-shore">{t['create.voyage.shore.label']}</label>
          <select id="create-shore" bind:value={gestade} onchange={gestadeGewechselt}>
            {#each SHORE_IDS as s (s)}
              <option value={s} disabled={!SHORE_OPEN[s]}>{t[SHORE_LABEL[s]]}{SHORE_OPEN[s] ? '' : ' — ' + t['account.shore.closed']}</option>
            {/each}
          </select>
          <p class="platzhalter-hinweis">{gestadeHinweis}</p>
        </div>
        {#if gestade === 'dev'}
          <div class="erstellen-feld">
            <label class="feldname" for="create-time">{t['create.voyage.time.label']}</label>
            <select id="create-time" bind:value={zeit} onchange={merke}>
              <option value="">{t['create.voyage.time.server_time']}</option>
              {#each stunden as s (s.wert)}<option value={s.wert}>{s.text}</option>{/each}
            </select>
          </div>
        {/if}
      {/if}
    </div>
  </aside>

  <section class="buehne" aria-label={lang === 'de' ? 'Charaktervorschau' : 'Character preview'}>
    <div class="figur-dummy" class:ausblenden={fertig} aria-hidden="true"></div>
    <canvas bind:this={leinwand}></canvas>
    <div class="buehne-hinweis nur-vorlesen" aria-live="polite" class:fertig>{hinweisText ?? t['create.stage.hint.loading']}</div>
    <div class="buehne-werkzeug">
      <button type="button" title={t['create.stage.rotate_left']} onclick={() => vorschau?.drehe(-0.35)}>↺</button>
      <button type="button" title={t['create.stage.reset_view']} onclick={() => vorschau?.blickZurueck()}>⌂</button>
      <button type="button" title={t['create.stage.rotate_right']} onclick={() => vorschau?.drehe(0.35)}>↻</button>
    </div>
    <p class="buehne-fuss">{fussHinweisAn ? t['create.footer.hint'] : ''}</p>
  </section>

  <aside class="klasseninfo" style={'--klasse:' + aktiveKlasse.farbe}>
    <div class="klassen-titel">
      <span class="klassen-signet" aria-hidden="true">{aktiveKlasse.zeichen}</span>
      <div><h2>{aktiveKlasse.name[lang]}</h2><p>{aktiveKlasse.rolle[lang]}</p></div>
    </div>
    <p class="klassen-text">{aktiveKlasse.beschreibung[lang]}</p>

    <div class="werte-block">
      <h3>{lang === 'de' ? 'Startwerte' : 'Starting stats'}</h3>
      {#each aktiveKlasse.werte as wert, index}
        <div class="wert-zeile">
          <span>{wertNamen[index]}</span>
          <div class="wert-balken"><i style={'width:' + wert * 4 + '%'}></i></div>
          <strong>{wert}</strong>
        </div>
      {/each}
    </div>

    <div class="faehigkeiten">
      <h3>{lang === 'de' ? 'Signaturfähigkeiten' : 'Signature abilities'}</h3>
      {#if aktiveKlasse.faehigkeiten.length}
        {#each aktiveKlasse.faehigkeiten as faehigkeit (faehigkeit.name.de)}
          <article><span aria-hidden="true">{faehigkeit.zeichen}</span><div><h4>{faehigkeit.name[lang]}</h4><p>{faehigkeit.text[lang]}</p></div></article>
        {/each}
      {:else}
        <p class="dummy-notiz">{lang === 'de' ? 'Fähigkeiten folgen im nächsten Ausbauschritt.' : 'Abilities will follow in the next iteration.'}</p>
      {/if}
    </div>
  </aside>

  <nav class="klassenwahl" aria-label={lang === 'de' ? 'Klasse wählen' : 'Choose class'}>
    {#each klassen as eintrag (eintrag.id)}
      <button
        type="button"
        style={'--klasse:' + eintrag.farbe}
        class:aktiv={klasseId === eintrag.id}
        aria-pressed={klasseId === eintrag.id}
        onclick={() => (klasseId = eintrag.id)}
      ><span class="klassen-icon" aria-hidden="true"><i>{eintrag.zeichen}</i></span><small>{eintrag.name[lang]}</small></button>
    {/each}
  </nav>

  <div class="schmiede-aktionen">
    <a class="zurueck" href={localizedPath(lang, '/')}>{t['create.footer.back']}</a>
    <div class="konto-aktion">
      {#if !angemeldet}<span>{lang === 'de' ? 'Anmeldung beim Erstellen' : 'Sign-in on creation'}</span>{/if}
      <button type="button" class="erstellen-los" disabled={sendet} onclick={losfahren}>
        {sendet ? t['create.button.loading'] : (lang === 'de' ? 'Erstellen' : 'Create')}
      </button>
    </div>
  </div>

  {#if sendeFehler}<p class="sende-fehler" role="alert">{t[sendeFehler]}</p>{/if}
</main>

<style>
  :global(body:has(.charakter-schmiede) .fuss) { display: none; }

  .charakter-schmiede {
    position: relative;
    min-height: 100svh;
    overflow: hidden;
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(380px, 1fr) minmax(290px, 370px);
    grid-template-rows: auto minmax(430px, 1fr) auto auto;
    gap: 18px 28px;
    padding: 84px clamp(20px, 2.6vw, 48px) 24px;
    background: #071016;
  }

  .kulisse {
    position: absolute;
    inset: 0;
    z-index: -2;
    background-image:
      linear-gradient(180deg, rgba(3, 8, 13, 0.36) 0%, rgba(4, 7, 9, 0.1) 46%, rgba(2, 3, 4, 0.93) 100%),
      linear-gradient(90deg, rgba(2, 4, 5, 0.76) 0%, transparent 30%, transparent 67%, rgba(2, 4, 5, 0.82) 100%),
      url('/assets/bilder/recke.webp');
    background-size: cover;
    background-position: center;
    filter: saturate(0.76) contrast(1.08);
  }

  .kulisse::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 51% 45%, transparent 0 24%, rgba(0, 0, 0, 0.22) 55%, rgba(0, 0, 0, 0.62) 100%);
  }

  .schmiede-kopf {
    grid-column: 1 / -1;
    align-self: start;
    justify-self: center;
    width: min(420px, 90vw);
    text-align: center;
  }

  .schmiede-kopf h1 {
    margin: 0 0 16px;
    color: var(--runengold);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(22px, 2vw, 30px);
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-shadow: 0 2px 12px #000;
  }

  .namensfeld {
    width: min(300px, 100%);
    height: 46px;
    padding: 0 18px;
    border: 1px solid rgba(221, 170, 30, 0.58);
    border-radius: 4px;
    outline: none;
    background: rgba(9, 11, 16, 0.84);
    color: var(--text);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 15px;
    letter-spacing: 0.07em;
    text-align: center;
    text-transform: uppercase;
    box-shadow: inset 0 0 18px rgba(0, 0, 0, 0.62), 0 8px 28px rgba(0, 0, 0, 0.25);
  }
  .namensfeld:focus { border-color: var(--runengold); box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.16); }
  .feld-fehler, .sende-fehler { margin: 6px 0 0; color: #ffc0aa; font-size: 12px; }

  .glasrahmen {
    border: 1px solid rgba(213, 166, 38, 0.48);
    border-radius: 10px;
    background: linear-gradient(145deg, rgba(9, 12, 14, 0.9), rgba(10, 11, 13, 0.7));
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(10px);
  }

  .anpassung { grid-column: 1; grid-row: 2; align-self: start; min-height: 246px; padding: 12px; }
  .panel-kopf { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .panel-kopf h2, .klasseninfo h2, .klasseninfo h3 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    color: var(--runengold);
    text-transform: uppercase;
  }
  .panel-kopf h2 { font-size: 14px; letter-spacing: 0.13em; }
  .schnellaktionen { display: flex; gap: 5px; }
  .schnellaktionen button, .detail-tabs button, .waehler button, .buehne-werkzeug button {
    border: 1px solid rgba(169, 137, 63, 0.38);
    border-radius: 4px;
    background: rgba(22, 23, 24, 0.82);
    color: #c9bea6;
    cursor: pointer;
  }
  .schnellaktionen button { padding: 5px 8px; font-family: var(--schrift-kappen); font-size: 9px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; }
  button:hover { border-color: var(--runengold); color: var(--runengold); }

  .detail-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; padding: 3px; border: 1px solid rgba(169, 137, 63, 0.36); border-radius: 6px; }
  .detail-tabs button { padding: 7px 2px; border-color: transparent; background: transparent; font-family: var(--schrift-kappen); font-size: 8px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .detail-tabs button.aktiv { border-color: #b58b25; background: rgba(182, 139, 37, 0.17); color: #f6dd89; }
  .detail-inhalt { display: flex; flex-direction: column; gap: 12px; min-height: 132px; padding-top: 12px; }
  .erstellen-feld { display: flex; flex-direction: column; gap: 6px; }
  .feldname, .farbwahl legend { color: #a99b7d; font-family: var(--schrift-kappen); font-size: 9px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; }
  .erstellen-feld select {
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 9px;
    border: 1px solid rgba(169, 137, 63, 0.4);
    border-radius: 4px;
    background: rgba(8, 10, 12, 0.82);
    color: #e7dfce;
    font: 13px var(--schrift);
  }
  .waehler { display: grid; grid-template-columns: 32px 1fr 32px; gap: 6px; }
  .waehler button { font-size: 20px; }
  .farbwahl { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; }
  .farbwahl legend { width: 100%; margin-bottom: 3px; }
  .farbwahl button { width: 22px; height: 22px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.5); border-radius: 50%; background: var(--farbton); box-shadow: 0 1px 5px #000; cursor: pointer; }
  .farbwahl button.aktiv { outline: 2px solid var(--runengold); outline-offset: 2px; }
  .platzhalter-hinweis { margin: 0; color: #9d947e; font-size: 11px; line-height: 1.45; }
  .platzhalter-flaeche { display: grid; place-items: center; min-height: 118px; color: #a99b7d; text-align: center; }
  .platzhalter-flaeche span { color: var(--runengold); font-size: 30px; opacity: 0.66; }
  .platzhalter-flaeche p { max-width: 230px; margin: 4px 0 0; font-size: 11px; }

  .buehne { grid-column: 2; grid-row: 2; position: relative; min-height: 0; overflow: visible; }
  .figur-dummy {
    position: absolute;
    inset: -8px 5% -18px;
    background: url('/assets/bilder/held.webp') 80% center / auto 106% no-repeat;
    filter: saturate(0.72) contrast(1.08) drop-shadow(0 16px 22px rgba(0, 0, 0, 0.7));
    opacity: 0.94;
    mask-image: radial-gradient(ellipse 78% 88% at 54% 50%, #000 0 62%, transparent 94%);
    transition: opacity 0.35s ease;
  }
  .figur-dummy.ausblenden { opacity: 0; }
  .buehne canvas { position: absolute; inset: -28px -10px -36px; width: calc(100% + 20px); height: calc(100% + 64px); outline: none; background: transparent; cursor: grab; touch-action: none; }
  .buehne canvas:active { cursor: grabbing; }
  .buehne-hinweis { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; color: #b8ad95; font-size: 12px; text-align: center; text-shadow: 0 2px 6px #000; pointer-events: none; }
  .buehne-hinweis.fertig { display: none; }
  .buehne-werkzeug { position: absolute; right: 12px; bottom: 34px; display: flex; gap: 5px; z-index: 3; }
  .buehne-werkzeug button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; font-size: 14px; backdrop-filter: blur(5px); }
  .buehne-fuss { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: max-content; max-width: 92%; margin: 0; color: rgba(225, 216, 196, 0.72); font-size: 10px; text-align: center; }

  .klasseninfo { grid-column: 3; grid-row: 2; align-self: stretch; overflow: auto; padding: 10px 0 12px 20px; border-left: 1px solid rgba(208, 157, 32, 0.22); background: linear-gradient(90deg, rgba(5, 8, 9, 0.48), rgba(4, 6, 7, 0.16)); backdrop-filter: blur(3px); }
  .klassen-titel { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(194, 150, 42, 0.23); }
  .klassen-signet { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid color-mix(in srgb, var(--klasse), transparent 25%); border-radius: 7px; background: rgba(6, 8, 9, 0.72); color: var(--klasse); font-size: 25px; box-shadow: 0 0 18px color-mix(in srgb, var(--klasse), transparent 72%); }
  .klasseninfo h2 { color: var(--klasse); font-size: 27px; letter-spacing: 0.04em; }
  .klassen-titel p { margin: 1px 0 0; color: var(--runengold); font-family: var(--schrift-kappen); font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .klassen-text { margin: 14px 6px 17px 0; color: #c2b9a5; font-family: Georgia, 'Times New Roman', serif; font-size: 13px; font-style: italic; line-height: 1.65; }
  .klasseninfo h3 { margin: 0 0 9px; font-size: 13px; letter-spacing: 0.08em; }
  .werte-block { padding-bottom: 16px; border-bottom: 1px solid rgba(194, 150, 42, 0.18); }
  .wert-zeile { display: grid; grid-template-columns: 94px 1fr 24px; align-items: center; gap: 8px; margin: 5px 0; color: #a99f88; font-size: 11px; }
  .wert-zeile strong { color: #eee8db; font-size: 11px; text-align: right; }
  .wert-balken { height: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.09); }
  .wert-balken i { display: block; height: 100%; background: linear-gradient(90deg, #9a681d, var(--klasse)); box-shadow: 0 0 7px var(--klasse); }
  .faehigkeiten { padding-top: 15px; }
  .faehigkeiten article { display: grid; grid-template-columns: 36px 1fr; gap: 10px; margin: 8px 0; padding: 8px; border: 1px solid rgba(194, 150, 42, 0.18); border-radius: 4px; background: rgba(2, 4, 5, 0.48); }
  .faehigkeiten article > span { display: grid; place-items: center; height: 36px; border: 1px solid rgba(213, 138, 69, 0.55); border-radius: 4px; color: var(--klasse); font-size: 20px; }
  .faehigkeiten h4 { margin: 0 0 3px; color: var(--runengold); font-family: Georgia, 'Times New Roman', serif; font-size: 12px; text-transform: uppercase; }
  .faehigkeiten article p, .dummy-notiz { margin: 0; color: #aaa18f; font-size: 10px; line-height: 1.5; }

  .klassenwahl { grid-column: 2; grid-row: 3; display: flex; justify-content: center; gap: clamp(5px, 0.8vw, 12px); z-index: 3; }
  .klassenwahl button { width: 60px; padding: 0; border: 0; background: transparent; color: #bcb39f; cursor: pointer; }
  .klassen-icon { display: grid; place-items: center; width: 60px; height: 60px; border: 2px solid rgba(150, 132, 96, 0.35); border-radius: 9px; background: radial-gradient(circle at 50% 36%, color-mix(in srgb, var(--klasse), transparent 64%), rgba(5, 7, 9, 0.92) 68%); color: var(--klasse); box-shadow: inset 0 0 14px #000; transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s; }
  .klassen-icon i { display: grid; place-items: center; width: 30px; height: 30px; font-family: 'DejaVu Sans', sans-serif; font-size: 28px; font-style: normal; line-height: 1; }
  .klassenwahl button small { display: block; margin-top: 4px; overflow: hidden; font-family: Georgia, 'Times New Roman', serif; font-size: 9px; letter-spacing: 0.03em; text-overflow: ellipsis; text-transform: uppercase; }
  .klassenwahl button:hover > .klassen-icon, .klassenwahl button.aktiv > .klassen-icon { transform: translateY(-3px); border-color: var(--runengold); box-shadow: 0 0 14px color-mix(in srgb, var(--klasse), transparent 48%), inset 0 0 12px #000; }
  .klassenwahl button.aktiv small { color: var(--runengold); }

  .schmiede-aktionen { grid-column: 1 / -1; grid-row: 4; display: flex; align-items: end; justify-content: space-between; gap: 16px; z-index: 4; }
  .zurueck, .erstellen-los { min-width: 140px; padding: 9px 18px; border: 1px solid rgba(172, 142, 70, 0.56); border-radius: 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 11px; letter-spacing: 0.08em; text-align: center; text-transform: uppercase; }
  .zurueck { background: rgba(14, 15, 23, 0.9); color: #c5baa3; }
  .erstellen-los { min-width: 180px; background: linear-gradient(180deg, #6e541b, #32250d); color: #f4ce5f; cursor: pointer; box-shadow: inset 0 1px rgba(255, 222, 126, 0.24); }
  .erstellen-los:hover { border-color: var(--runengold); box-shadow: 0 0 18px rgba(255, 215, 0, 0.17); }
  .erstellen-los:disabled { cursor: wait; opacity: 0.68; }
  .konto-aktion { display: flex; flex-direction: column; align-items: end; gap: 4px; }
  .konto-aktion span { color: #aca28c; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
  .sende-fehler { position: absolute; right: 28px; bottom: 74px; max-width: 360px; padding: 8px 12px; background: rgba(40, 10, 6, 0.82); border: 1px solid #8f4b3a; }

  @media (max-width: 1180px) {
    .charakter-schmiede { grid-template-columns: minmax(240px, 300px) 1fr minmax(260px, 310px); column-gap: 18px; }
    .klassenwahl { grid-column: 1 / -1; }
    .klasseninfo h2 { font-size: 23px; }
  }

  @media (max-width: 879px) {
    :global(body:has(.charakter-schmiede)) { padding-bottom: 76px; }
    .charakter-schmiede { min-height: auto; overflow: visible; grid-template-columns: 1fr; grid-template-rows: auto; gap: 16px; padding: 24px 16px 28px; }
    .schmiede-kopf, .anpassung, .buehne, .klasseninfo, .klassenwahl, .schmiede-aktionen { grid-column: 1; grid-row: auto; min-width: 0; }
    .anpassung { order: 2; }
    .buehne { order: 1; min-height: 55svh; }
    .buehne canvas { inset: 0; width: 100%; height: 100%; }
    .klassenwahl { order: 3; overflow-x: auto; justify-content: flex-start; padding: 8px 2px; }
    .klassenwahl button { flex: 0 0 56px; width: 56px; }
    .klassen-icon { width: 56px; height: 56px; }
    .klasseninfo { order: 4; max-height: none; padding: 16px; border: 1px solid rgba(208, 157, 32, 0.22); border-radius: 8px; }
    .schmiede-aktionen { order: 5; }
  }

  @media (max-width: 520px) {
    .schmiede-kopf h1 { font-size: 19px; }
    .panel-kopf { align-items: flex-start; flex-direction: column; }
    .detail-tabs { overflow-x: auto; grid-template-columns: repeat(5, minmax(64px, 1fr)); }
    .schmiede-aktionen { align-items: stretch; flex-direction: column-reverse; }
    .konto-aktion { align-items: stretch; text-align: right; }
    .zurueck, .erstellen-los { width: 100%; }
  }
</style>
