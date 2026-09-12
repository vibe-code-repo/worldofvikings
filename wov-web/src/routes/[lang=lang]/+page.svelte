<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { FAHRT, FAHRT_STAND } from '$lib/seiten';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';
  import {
    SHORE_HINT,
    SHORE_IDS,
    SHORE_LABEL,
    SHORE_OPEN,
    SHORE_SHORT,
    type ShoreId,
    type ShoreStatus,
    readShore,
    shoreStatus,
    writeShore,
  } from '$lib/account';

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

  /* --------------------------------------------------------- Gestadewahl */

  /**
   * Das gewählte Gestade — was der SPIELEN-Knopf ansteuert.
   *
   * Vorgabe ist `dev` wie überall sonst im Einstieg (/erstellen, /anmelden,
   * /registrieren lesen dieselbe Angabe unter `wov-gestade`). Die Halle
   * nennt damit dasselbe Gestade, in das ihr Knopf führt; stünde hier fest
   * „Midgard“, wäre die Überschrift genau die Behauptung, die dieser Umbau
   * beseitigt — Midgard nimmt bis heute keine Konten an (kein `/accounts/`
   * am Live-Host, nachgemessen am 26.08.2026).
   *
   * Gelesen wird die gemerkte Wahl erst im Browser: In der vorgerenderten
   * Datei steht die Vorgabe, und wer zuletzt Midgard gewählt hat, sieht sie
   * nach der Hydration.
   */
  let gestade = $state<ShoreId>('dev');

  /** Ob der Aufklapper offen steht — zum Zumachen nach der Wahl. */
  let offen = $state(false);

  /**
   * Welche Welt zu welchem Gestade gehört.
   *
   * `/api/welt.json` ist bis heute eine DEMO-Datei auf der Webseite selbst
   * (ihr eigenes `_hinweis`-Feld sagt das) und kein Abruf beim Gestade — sie
   * führt deshalb keine Gestade-Kennung, und die Zuordnung steht hier, an
   * einer Stelle und sichtbar. Sobald ein Gestade seinen Zustand selbst
   * meldet, fällt diese Tabelle weg und jede Zeile fragt ihren eigenen
   * Server.
   *
   * Eine Welt ohne Gestade wird hier nicht gezeigt; die vollständige Liste
   * steht auf der Karte.
   */
  const WELT_JE_GESTADE: Record<ShoreId, string> = { live: 'midgard', dev: 'bau' };

  function weltVon(s: ShoreId): Welt | null {
    return welten?.find((w) => w.id === WELT_JE_GESTADE[s]) ?? null;
  }

  /* -------------------------------------------------------- Servermeldung */

  /**
   * Was die Server selbst über sich sagen — je Gestade eine Antwort.
   *
   * `undefined` heisst „noch nicht gefragt“, `null` „gefragt, keine
   * Antwort“. Der Unterschied ist sichtbar: das erste zeigt „wird geprüft“,
   * das zweite fällt auf die Beschreibung des Gestades zurück.
   *
   * Warum das überhaupt da ist: `/api/welt.json` ist eine von Hand
   * geschriebene DEMO-Datei neben den vorgerenderten Seiten. Sie behauptet
   * drei Spieler auf Midgard, auch wenn niemand spielt, und sie behauptet
   * null in der Werkstatt, während Mike drinsteht. Eine vorgerenderte Datei
   * kann nicht mitzählen. `/accounts/status` fragt den Server, der die
   * Verbindungen wirklich hält.
   */
  let meldung = $state<Record<ShoreId, ShoreStatus | null | undefined>>({
    // Beide Schlüssel stehen von Anfang an da: Ein Feld, das erst später
    // entsteht, liest sich bis dahin wie „nicht gefragt“ — und in einem
    // $state-Objekt hängt an einem fehlenden Schlüssel auch keine
    // Abhängigkeit, die Svelte später wecken könnte.
    dev: undefined,
    live: undefined,
  });

  /**
   * Ampelfarbe: was der Server sagt, schlägt die Weltliste.
   *
   * Antwortet ein Gestade, ist es offen — das ist keine Auslegung, sondern
   * die Antwort selbst.
   */
  function ampelZustand(s: ShoreId): string | undefined {
    if (meldung[s]) return 'offen';
    return weltVon(s)?.zustand;
  }

  /** „12 Konten“ bzw. „1 Konto“ — Zahl und Wort, nie ein Satz mit Lücke. */
  function konten(n: number): string {
    return `${n} ${n === 1 ? t['hall.gate.accounts_one'] : t['hall.gate.accounts_many']}`;
  }

  /**
   * Die kleine Zeile unter dem Namen.
   *
   * Reihenfolge der Wahrheiten: erst der Server selbst, dann die
   * Weltliste, dann der Satz, der das Gestade beschreibt. Zahlen stehen
   * dort nur, wenn sie jemand gemessen hat — eine Ampel-Behauptung über
   * einen Server, den niemand gefragt hat, wäre schlimmer als gar keine.
   */
  function zustandsZeile(s: ShoreId): string {
    const z = meldung[s];
    if (z) {
      return (
        `${z.players} ${t['hall.hero.ribbon.of']} ${z.slots} ${t['hall.hero.ribbon.underway']}` +
        ` · ${t['hall.gate.day']} ${z.day}` +
        ` · ${konten(z.accounts)}`
      );
    }
    const w = weltVon(s);
    if (w) {
      return `${w.spieler} ${t['hall.hero.ribbon.of']} ${w.plaetze} ${t['hall.hero.ribbon.underway']} · ${w.weltzeit}`;
    }
    // Solange irgendetwas noch unterwegs ist, wird nichts behauptet.
    if (meldung[s] === undefined || (welten === null && !weltenFehler)) {
      return t['hall.hero.ribbon.checking'];
    }
    return t[SHORE_HINT[s]];
  }

  /** Die Plakette rechts in der Zeile: Zahlen, „zu“ — oder nichts. */
  function plakette(s: ShoreId): string {
    const z = meldung[s];
    if (z) return `${z.players}/${z.slots} ${t['hall.worlds.state_open']}`;
    const w = weltVon(s);
    if (!w) return '';
    if (w.zustand !== 'offen') return t['hall.gate.world_badge_closed'];
    return `${w.spieler}/${w.plaetze} ${t['hall.worlds.state_open']}`;
  }

  /**
   * Der Weg ins Spiel für ein Gestade.
   *
   * Die Wahl steht als Parameter in der Adresse und nicht nur im
   * Zwischenspeicher: Ohne JavaScript ist das der EINZIGE Weg, auf dem sie
   * ankommt — dann ist jede Zeile ein gewöhnlicher Link, und keine
   * Schaltfläche, die nichts tut.
   */
  const spielPfad = $derived.by(() => (s: ShoreId) => `${p(FAHRT)}?shore=${s}&stand=${FAHRT_STAND}`);

  /**
   * Jedes Gestade fragen — beim Aufruf und danach alle halbe Minute.
   *
   * Jede Zeile wird EINZELN gefragt und scheitert einzeln: Midgard
   * antwortet heute 405 (dort ist `/accounts/` gar nicht durchgereicht),
   * und das darf die Zahl der Werkstatt nicht mitreissen. Deshalb ein
   * eigener try je Gestade statt eines Promise.all mit einem Fangarm.
   *
   * Nur offene Gestade werden gefragt. Ein geschlossenes zeigt ohnehin
   * seinen Grund statt Zahlen — ein Abruf wäre eine Anfrage, deren Antwort
   * nirgends hinkommt.
   */
  function meldungenHolen(): void {
    for (const s of SHORE_IDS) {
      if (!SHORE_OPEN[s]) {
        // Nicht gefragt ist trotzdem beantwortet: `null` statt `undefined`,
        // sonst stünde an einem geschlossenen Server für immer „wird
        // geprüft“, sollte ihn doch einmal jemand mit dieser Zeile zeigen.
        meldung[s] = null;
        continue;
      }
      void (async () => {
        try {
          meldung[s] = await shoreStatus(s);
        } catch (e) {
          console.warn(`[Halle] Gestade ${s} meldet sich nicht:`, e);
          /*
            Eine ausgefallene NACHfrage lässt die letzte Zahl stehen; nur
            der erste Versuch schreibt `null`.

            Das ist bewusst nicht symmetrisch. `null` fällt auf
            `/api/welt.json` zurück, und das sind DEMO-Zahlen — eine echte
            Zahl von vor dreissig Sekunden ist näher an der Wahrheit als
            eine erfundene von heute. Fällt der Server länger aus, bleibt
            die Zahl stehen; das ist der Preis, und er ist kleiner.
          */
          if (meldung[s] === undefined) meldung[s] = null;
        }
      })();
    }
  }

  function waehle(e: MouseEvent, s: ShoreId) {
    // Mit Skript wird gewählt statt gesprungen; die Adresse im href bleibt
    // trotzdem richtig, für Mittelklick, „in neuem Tab öffnen“ und ohne JS.
    e.preventDefault();
    gestade = s;
    writeShore(s);
    offen = false;
  }

  onMount(() => {
    /*
      `readShore()` gibt einen geschlossenen Server gar nicht erst heraus —
      wer heute Nachmittag Midgard angeklickt hat, hat `live` gespeichert,
      und das Tor stünde sonst auf einem Server, den es im selben Atemzug
      als „noch nicht offen“ ausweist. Die Begründung steht dort.
    */
    gestade = readShore() ?? 'dev';

    meldungenHolen();
    // Alle halbe Minute nachfragen, solange die Seite zu sehen ist. Der
    // Zähler steht sonst auf dem Stand des Seitenaufrufs — wer die Halle
    // offen liegen lässt, bekäme eine Stunde später eine Zahl von vor einer
    // Stunde gezeigt, ohne dass ihr das anzusehen wäre.
    const uhr = setInterval(() => {
      if (document.visibilityState === 'visible') meldungenHolen();
    }, 30_000);
    // Und sofort beim Zurückkommen: Ein Reiter, der eine Stunde im
    // Hintergrund lag, hat keine Abrufe gemacht (siehe oben) und zeigt beim
    // Hinsehen sonst genau die alte Zahl, bis die nächste halbe Minute um
    // ist. Das ist der Moment, in dem jemand wirklich hinschaut.
    const beimHinsehen = () => {
      if (document.visibilityState === 'visible') meldungenHolen();
    };
    document.addEventListener('visibilitychange', beimHinsehen);

    void (async () => {
      try {
        welten = (await holeJson<{ welten?: Welt[] }>('/api/welt.json')).welten ?? [];
      } catch (e) {
        console.warn(e);
        weltenFehler = true;
      }
    })();

    return () => {
      clearInterval(uhr);
      document.removeEventListener('visibilitychange', beimHinsehen);
    };
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
      Die Gestadewahl ist ein natives <details>. Ein Umschalter aus
      JavaScript bliebe ohne JavaScript für immer zu — das Aufklappen ist
      hier Sache des Browsers, und der Inhalt steht im HTML.

      Sie WÄHLT seit dem 26.08.2026 auch aus. Vorher zeigte sie nur die
      Weltliste, und ihr Kopfkommentar begründete das damit, dass ein Knopf,
      der nichts tut, eine Behauptung wäre. Das gilt weiter — deshalb ist
      jede Zeile ein LINK auf den Einstieg dieses Gestades und keine
      Schaltfläche: Ohne Skript führt sie dorthin, mit Skript wählt sie
      (`waehle` hält den Sprung an), und in beiden Fällen kommt die Wahl als
      `?shore=` bei `/erstellen` an.

      Die Zeilen sind die GESTADE, nicht mehr die Welten. Gewählt wird der
      Server, an dem das Konto liegt; welche Welt darauf läuft, steht als
      Zahlenzeile daneben, solange die Zuordnung bekannt ist. Die
      vollständige Weltliste steht auf der Karte.
    -->
    <details class="world-switch" bind:open={offen}>
      <summary>
        <span class="bifroest" data-zustand={ampelZustand(gestade)} aria-hidden="true">
          <span class="ampel"></span>
        </span>
        <span class="world-switch-labels">
          <span class="world-switch-name">{t[SHORE_SHORT[gestade]]}</span>
          <!--
            Zahlen und Name stehen NEBEN den Textbausteinen, nicht in ihnen:
            „3 von 10 auf Fahrt“ ist im Katalog drei kurze Wörter und kein
            Satz mit Platzhaltern, die jemand falsch zählen könnte.
          -->
          <span class="world-switch-state">{zustandsZeile(gestade)}</span>
        </span>
        <span class="world-switch-arrow" aria-hidden="true">▾</span>
      </summary>

      <div class="world-switch-panel">
        {#if weltenFehler}
          <!-- Die Wahl bleibt trotzdem stehen: Welches Gestade man ansteuert,
               hängt nicht daran, ob die Weltliste gerade zu holen war. -->
          <p class="world-switch-note">{t['hall.worlds.error']}</p>
        {/if}
        <ul class="world-list" aria-label={t['hall.gate.shore.aria']}>
          {#each SHORE_IDS as s (s)}
            <li>
              <!--
                Ein Server, der keine Konten annimmt, ist KEIN Link.

                Die Zeile bleibt stehen — dass es Midgard gibt, ist wahr und
                soll man sehen. Anklickbar wäre sie eine Einladung in eine
                Sackgasse: `/erstellen` käme bis zur Anmeldung und meldete
                dort „Der Server ist nicht erreichbar“, was nach einer
                Störung aussieht statt nach dem, was es ist. Deshalb ein
                <span> statt eines <a>, rote Ampel, Plakette daneben und der
                Grund als Satz darunter.
              -->
              {#if SHORE_OPEN[s]}
                <a
                  class="world-row"
                  data-sveltekit-reload
                  href={spielPfad(s)}
                  aria-current={s === gestade ? 'true' : undefined}
                  onclick={(e) => waehle(e, s)}
                >
                  <span class="bifroest" data-zustand={ampelZustand(s)} aria-hidden="true">
                    <span class="ampel"></span>
                  </span>
                  <span class="world-row-labels">
                    <span class="world-row-name">
                      {t[SHORE_LABEL[s]]}
                      {#if s === gestade}
                        <span class="nur-vorlesen">({t['hall.gate.shore.chosen']})</span>
                      {/if}
                    </span>
                    <span class="world-row-sub">{zustandsZeile(s)}</span>
                  </span>
                  <span class="world-row-badge">{plakette(s)}</span>
                </a>
              {:else}
                <span class="world-row world-row-zu">
                  <span class="bifroest" data-zustand="zu" aria-hidden="true">
                    <span class="ampel"></span>
                  </span>
                  <span class="world-row-labels">
                    <span class="world-row-name">{t[SHORE_LABEL[s]]}</span>
                    <span class="world-row-sub">{t['account.shore.closed.hint']}</span>
                  </span>
                  <span class="world-row-badge world-row-badge-zu">
                    {t['account.shore.closed']}
                  </span>
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </details>

    <!--
      Führt in die Charaktererstellung, nicht direkt ins Spiel — wie der alte
      Knopf „Auf Fahrt gehen“. Das gewählte Gestade reist als Parameter mit,
      damit die Wahl auch ohne Zwischenspeicher ankommt.
    -->
    <a class="gate-play" data-sveltekit-reload href={spielPfad(gestade)}>{t['hall.gate.play_button']}</a>

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

  /* Der Trennstrich sitzt ZWISCHEN den Zeilen, nicht unter jeder: Der
     Zeileninhalt ist jetzt ein Link, und ein unterer Rand am letzten
     schnitte die Fläche mitten durch die Rundung des Aufklappers. */
  .world-list li + li {
    border-top: 1px solid color-mix(in srgb, var(--umriss-matt) 50%, transparent);
  }

  /*
    Die ganze Zeile ist die Klickfläche, nicht nur der Name — auf dem
    Telefon ist das der Unterschied zwischen treffen und zielen.
  */
  .world-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    color: var(--text);
    border-bottom: none;
    transition: background-color 0.18s ease;
  }

  .world-row:hover {
    background: rgba(242, 202, 80, 0.08);
    color: var(--text);
    text-decoration: none;
  }

  /* Die getroffene Wahl trägt Gold: ein Balken an der Kante und der Name
     in der Leitfarbe. Farbe allein wäre zu wenig — der Balken steht
     daneben, und für Vorleser sagt es `aria-current` samt „gewählt“. */
  .world-row[aria-current] {
    background: rgba(242, 202, 80, 0.12);
    box-shadow: inset 3px 0 0 var(--runengold);
  }

  .world-row[aria-current] .world-row-name {
    color: var(--primaer);
  }

  /* Die geschlossene Zeile ist gedämpft, aber lesbar — sie ist eine
     Auskunft, keine ausgegraute Schaltfläche. Kein Zeiger, kein
     Hover-Wechsel: Es gibt hier nichts zu treffen. */
  .world-row-zu {
    cursor: default;
  }

  .world-row-zu .world-row-name,
  .world-row-zu .world-row-sub {
    color: var(--text-matt);
  }

  .world-row-badge-zu {
    color: var(--blut);
    filter: brightness(1.7);
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
    .world-row,
    .gate-play {
      transition: none;
    }
  }
</style>
