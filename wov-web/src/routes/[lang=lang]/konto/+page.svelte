<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { type MessageKey, localeFrom, localizedPath, messages } from '$lib/i18n';
  import { datumKurz, holeJson, vorWieLange } from '$lib/formate';
  import {
    ApiError,
    type Charakter,
    type Konto,
    SHORE_IDS,
    SHORE_LABEL,
    type ShoreId,
    charakterLoeschen,
    clearAllTokens,
    clearToken,
    errorMessageKey,
    ich,
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
   * Die Kontoseite: welche Recken es gibt, und was man mit ihnen tun kann.
   *
   * ── Warum der Vorgabezustand „nicht angemeldet“ ist ──────────────────
   * Die Seite wird zur Bauzeit einmal geschrieben. Zu diesem Zeitpunkt kann
   * niemand wissen, wer sie später öffnet — „nicht angemeldet“ ist deshalb
   * nicht nur die sichere, sondern die einzige Annahme, die überhaupt
   * feststeht. Genau dieser Zustand ist auch das, was ein Browser ohne
   * JavaScript zu sehen bekommt: ein erklärender Absatz und zwei Links,
   * niemals eine leere Liste, die nach einem Fehler aussieht.
   *
   * ── Warum die Liste trotz der Anmeldeantwort noch einmal geholt wird ──
   * Wer aus /anmelden kommt, hätte sie schon. Wer ein Lesezeichen öffnet
   * oder die Seite neu lädt, hat nur den Token im localStorage und sonst
   * nichts. Ein zweiter Weg für diesen Fall wäre ein zweiter Weg, der
   * seltener benutzt und deshalb später kaputt ist.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let bereit = $state(false);
  let gestade = $state<ShoreId>('dev');
  let angemeldet = $state(false);
  /**
   * Das Gestade hat nicht geantwortet (oder mit einem Fehler, der nichts
   * ueber die Anmeldung aussagt). Ein eigener Zustand neben `angemeldet`,
   * weil weder „angemeldet“ noch „nicht angemeldet“ hier stimmt — beides
   * behauptete etwas, das gerade niemand weiss.
   */
  let unerreichbar = $state(false);
  let laedt = $state(false);
  let konto = $state<Konto | null>(null);
  let charaktere = $state<Charakter[]>([]);
  let fehler = $state<MessageKey | null>(null);
  /** Der Recke, für den gerade die Löschfrage steht. */
  let loeschFrage = $state<number | null>(null);
  /** Der Recke, an dem gerade ein Aufruf läuft — sperrt nur dessen Knöpfe. */
  let beschaeftigt = $state<number | null>(null);

  /* ---------------------------------------------------------- Aussehen */

  interface AussehenEintrag {
    id: string;
    name: string;
  }
  interface Aussehen {
    figuren: AussehenEintrag[];
    frisuren: AussehenEintrag[];
    ruestung: AussehenEintrag[];
  }

  /**
   * id → Anzeigename, aus derselben Datei, aus der /erstellen seine Auswahl
   * baut. Bleibt leer, wenn die Datei fehlt; dann steht die nackte Kennung
   * da. Das ist hässlicher, aber es ist wahr — und es bringt die Seite nicht
   * um, wenn ein Ausrollen die Datei vergisst.
   *
   * Die Namen darin sind deutsch, wie die übrigen Laufzeitdaten unter
   * `static/api/`. Auf /en/konto steht deshalb ein englischer Rahmen um
   * deutsche Kleidungsnamen — dieselbe offene Stelle, die auch Saga und
   * Ruhmeshalle haben.
   */
  let namen = $state<Record<string, string>>({});

  function benenne(id: string): string {
    return id ? (namen[id] ?? id) : t['erstellen.aussehen.oberkoerper.nichts'];
  }

  /* ------------------------------------------------------------- Laden */

  async function laden() {
    fehler = null;
    unerreichbar = false;
    loeschFrage = null;
    const token = readToken(gestade);
    if (!token) {
      angemeldet = false;
      konto = null;
      charaktere = [];
      return;
    }
    laedt = true;
    try {
      const daten = await ich(gestade, token);
      konto = daten.account;
      charaktere = daten.characters;
      angemeldet = true;
    } catch (err) {
      if (isLoggedOut(err)) {
        clearToken(gestade);
        angemeldet = false;
        konto = null;
        charaktere = [];
      } else {
        // Ein Serverfehler oder eine abgerissene Leitung ist KEINE
        // bestaetigte Anmeldung. Vorher stand hier `angemeldet = true`:
        // Dann zeigte die Seite die Oberflaeche eines angemeldeten Kontos
        // samt LEERER Reckenliste — also „du hast keine Recken“, wo
        // richtig „wir haben das Gestade nicht erreicht“ gewesen waere.
        //
        // Der Token bleibt liegen (nicht clearToken): Er kann in Ordnung
        // sein, wir wissen es bloss gerade nicht. Beim naechsten Laden
        // wird es sich zeigen.
        unerreichbar = true;
        fehler = err instanceof ApiError ? errorMessageKey(err.key) : 'konto.fehler.unerwartet';
      }
    } finally {
      laedt = false;
    }
  }

  async function gestadeGewechselt() {
    writeShore(gestade);
    await laden();
  }

  /* ----------------------------------------------------------- Aktionen */

  /** Token weg, zurück zur Anmeldung — der einzige Weg nach einer 401. */
  async function zurAnmeldung() {
    clearToken(gestade);
    angemeldet = false;
    await goto(`${localizedPath(lang, '/anmelden')}?abgelaufen=1`);
  }

  async function aufFahrt(c: Charakter) {
    if (beschaeftigt !== null) return;
    const token = readToken(gestade);
    if (!token) return zurAnmeldung();
    fehler = null;
    beschaeftigt = c.id;
    try {
      const ticket = await spielen(gestade, token, c.id);
      // Der Zugangsnachweis reist im Adressfragment, nie als Parameter —
      // die Begründung steht bei `playUrl` in `$lib/konto.ts`.
      location.href = playUrl(gestade, ticket.character, ticket.sessionToken);
    } catch (err) {
      beschaeftigt = null;
      if (isLoggedOut(err)) return zurAnmeldung();
      if (err instanceof ApiError && err.key === 'unbekannt') {
        // Ein zweiter Tab hat ihn gelöscht. Die Liste hier ist damit falsch,
        // nicht die Antwort — also wird die Liste berichtigt.
        charaktere = charaktere.filter((x) => x.id !== c.id);
        fehler = 'konto.seite.loeschen.war_weg';
        return;
      }
      fehler = err instanceof ApiError ? errorMessageKey(err.key) : 'konto.fehler.unerwartet';
    }
  }

  async function loeschen(c: Charakter) {
    if (beschaeftigt !== null) return;
    const token = readToken(gestade);
    if (!token) return zurAnmeldung();
    fehler = null;
    beschaeftigt = c.id;
    try {
      await charakterLoeschen(gestade, token, c.id);
      charaktere = charaktere.filter((x) => x.id !== c.id);
    } catch (err) {
      if (isLoggedOut(err)) return zurAnmeldung();
      if (err instanceof ApiError && err.key === 'unbekannt') {
        // 404 heisst hier „war schon weg“ — das Ziel ist erreicht, also
        // verschwindet er aus der Liste statt eine Fehlermeldung zu erben.
        charaktere = charaktere.filter((x) => x.id !== c.id);
        fehler = 'konto.seite.loeschen.war_weg';
      } else {
        fehler = err instanceof ApiError ? errorMessageKey(err.key) : 'konto.fehler.unerwartet';
      }
    } finally {
      beschaeftigt = null;
      loeschFrage = null;
    }
  }

  /**
   * Abmelden heisst: den Token vergessen.
   *
   * Mehr ist nicht möglich und wird hier auch nicht vorgetäuscht. Der Token
   * ist selbsttragend und HMAC-signiert, die API kennt keinen Endpunkt zum
   * Widerrufen — er läuft nach 30 Tagen von selbst ab.
   */
  function abmelden() {
    // ALLE Gestade, nicht nur das gewaehlte — siehe clearAllTokens().
    clearAllTokens();
    angemeldet = false;
    unerreichbar = false;
    konto = null;
    charaktere = [];
    fehler = null;
  }

  onMount(async () => {
    bereit = true;
    gestade = signedInShore() ?? readShore() ?? 'dev';

    void (async () => {
      try {
        const daten = await holeJson<Aussehen>('/assets/aussehen.json');
        const karte: Record<string, string> = {};
        for (const e of [...daten.figuren, ...daten.frisuren, ...daten.ruestung]) {
          karte[e.id] = e.name;
        }
        namen = karte;
      } catch {
        /* keine Namen: dann stehen die Kennungen da */
      }
    })();

    await laden();
  });
</script>

<Kopfdaten
  titel={t['konto.seite.kopf.titel']}
  beschreibung={t['konto.seite.kopf.beschreibung']}
  noindex
/>

<main class="mitte seite">
  <div class="konto-schmal">
    <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['konto.seite.ueberschrift']}</h1>

    {#if unerreichbar}
      <!--
        Weder angemeldet noch abgemeldet: Das Gestade hat nicht geantwortet.
        Beides zu behaupten waere falsch — „Nicht angemeldet“ schickte
        jemanden zum Anmelden, obwohl sein Token in Ordnung sein kann, und
        die angemeldete Ansicht zeigte eine leere Reckenliste, als haette
        er keine.
      -->
      <div class="konto-tafel" style="margin-top:1.2rem">
        <h2 style="margin-top:0">{t['konto.seite.unerreichbar.titel']}</h2>
        {#if fehler}
          <p class="konto-melder" role="alert" style="margin:0.8rem 0 0">{t[fehler]}</p>
        {/if}
        <div class="konto-tat">
          <button class="knopf" type="button" onclick={() => void laden()}>
            {t['konto.seite.unerreichbar.nochmal']}
          </button>
          <button class="knopf knopf-rand" type="button" onclick={abmelden}>
            {t['konto.abmelden']}
          </button>
        </div>
      </div>
    {:else if angemeldet}
      <div class="konto-tafel" style="margin-top:1.2rem">
        <div class="konto-feld" style="margin-bottom:0.8rem">
          <label class="konto-name" for="konto-gestade">
            {t['erstellen.fahrt.gestade.label']}
          </label>
          <select
            class="konto-eingabe"
            id="konto-gestade"
            bind:value={gestade}
            onchange={gestadeGewechselt}
          >
            {#each SHORE_IDS as s (s)}
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
            {/each}
          </select>
        </div>

        {#if konto}
          <p class="konto-recke-daten" style="margin-bottom:0">
            <span>{t['konto.seite.angemeldet_als']} <b>{konto.username}</b></span>
            <span>{t['konto.seite.email']} <b>{konto.email}</b></span>
          </p>
        {/if}

        <div class="konto-tat">
          <a class="knopf" href={localizedPath(lang, '/erstellen')}>
            {t['konto.seite.knopf.neu']}
          </a>
          <button class="knopf knopf-rand" type="button" onclick={abmelden}>
            {t['konto.abmelden']}
          </button>
        </div>
      </div>

      {#if fehler}
        <p class="konto-melder" role="alert" style="margin-top:1.2rem">{t[fehler]}</p>
      {/if}

      {#if laedt}
        <p class="konto-leer">{t['konto.seite.laedt']}</p>
      {:else if fehler && charaktere.length === 0}
        <!--
          Nichts weiter. „Noch kein Recke“ wäre hier eine Behauptung über
          das Gestade, die niemand geprüft hat: Die Liste ist leer, weil
          die Antwort ausblieb — nicht, weil dort keiner steht. Die
          Fehlermeldung darüber sagt bereits, was los ist.
        -->
      {:else if charaktere.length === 0}
        <p class="konto-leer">{t['konto.seite.leer']}</p>
      {:else}
        <div class="konto-liste">
          {#each charaktere as c (c.id)}
            <article class="konto-recke">
              <h2 class="konto-recke-name">{c.name}</h2>
              <p class="konto-recke-daten">
                <span>{t['erstellen.aussehen.figur.label']} <b>{benenne(c.figur)}</b></span>
                <span>{t['erstellen.aussehen.frisur.label']} <b>{benenne(c.frisur)}</b></span>
                <span>{t['erstellen.aussehen.oberkoerper.label']} <b>{benenne(c.ober)}</b></span>
                <span>{t['erstellen.aussehen.beine.label']} <b>{benenne(c.beine)}</b></span>
              </p>
              <p class="konto-recke-daten">
                <span>
                  {t['konto.seite.erschaffen']}
                  <b>{datumKurz(new Date(c.created).toISOString(), lang)}</b>
                </span>
                <span>
                  {#if c.lastPlayed === null}
                    <b>{t['konto.seite.nie']}</b>
                  {:else}
                    {t['konto.seite.zuletzt']}
                    <b>{vorWieLange(new Date(c.lastPlayed).toISOString(), lang)}</b>
                  {/if}
                </span>
              </p>

              {#if loeschFrage === c.id}
                <!-- Zwei Schritte statt eines Browserfensters: `confirm()`
                     lässt sich weder übersetzen noch gestalten, und es hält
                     nebenbei den ganzen Reiter an. -->
                <p class="konto-melder" style="margin:0.8rem 0 0">
                  {t['konto.seite.loeschen.frage']}
                </p>
                <div class="konto-tat">
                  <button
                    class="knopf knopf-rand"
                    type="button"
                    disabled={beschaeftigt === c.id}
                    onclick={() => loeschen(c)}
                  >
                    {t['konto.seite.loeschen.ja']}
                  </button>
                  <button class="knopf" type="button" onclick={() => (loeschFrage = null)}>
                    {t['konto.seite.loeschen.nein']}
                  </button>
                </div>
              {:else}
                <div class="konto-tat">
                  <button
                    class="knopf"
                    type="button"
                    disabled={beschaeftigt !== null}
                    onclick={() => aufFahrt(c)}
                  >
                    {beschaeftigt === c.id
                      ? t['konto.seite.spielen.laeuft']
                      : t['erstellen.knopf.losfahren']}
                  </button>
                  <button
                    class="knopf knopf-rand"
                    type="button"
                    disabled={beschaeftigt !== null}
                    onclick={() => (loeschFrage = c.id)}
                  >
                    {t['konto.seite.knopf.loeschen']}
                  </button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    {:else}
      <!--
        Der Vorgabezustand. Er steht so im vorgerenderten HTML und ist damit
        auch das, was ohne JavaScript dasteht: eine Erklärung und zwei Wege
        weiter, kein halber Knopf und keine leere Liste.
      -->
      <div class="konto-tafel" style="margin-top:1.2rem">
        <h2 style="margin-top:0">{t['konto.seite.gesperrt.titel']}</h2>
        <p style="color:var(--matt)">{t['konto.seite.gesperrt.text']}</p>
        {#if bereit && laedt}
          <p class="konto-leer">{t['konto.seite.laedt']}</p>
        {/if}
        <div class="konto-tat">
          <a class="knopf" href={localizedPath(lang, '/anmelden')}>
            {t['konto.seite.gesperrt.anmelden']}
          </a>
          <a class="knopf knopf-rand" href={localizedPath(lang, '/registrieren')}>
            {t['konto.seite.gesperrt.registrieren']}
          </a>
        </div>
      </div>
    {/if}
  </div>
</main>
