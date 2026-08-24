<script lang="ts">
  import { page } from '$app/state';
  import { HAUPTNAV, FAHRT } from './seiten';
  import { LOCALES, localeFrom, localizedPath, messages, stripLocale } from './i18n';

  /**
   * Sprache und Texte kommen aus der Adresse, nicht aus einem Store.
   * `page.params.lang` ist beim Vorrendern schon gesetzt — deshalb steht der
   * fertige Text in der gebauten Datei und nicht erst nach dem ersten Skript.
   */
  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Welcher Punkt der offene ist, entscheidet die Adresse — nicht ein Skript,
   * das nach dem Laden Klassen nachträgt. Damit steht die Markierung schon in
   * der vorgerenderten Datei und flackert nicht beim ersten Bild.
   *
   * Verglichen wird OHNE Sprachpräfix und ohne Endung: `/en/saga.html`,
   * `/en/saga` und `/de/saga` sind für die Navigation derselbe Punkt, und in
   * `seiten.ts` steht er einmal als `/saga`.
   */
  const hier = $derived(stripLocale(page.url.pathname));

  /**
   * Die Halle fällt aus der Leiste — das Wappen führt dorthin.
   *
   * Der Entwurf „Rune & Iron“ ersetzt die Textmarke „World of Vikings“ durch
   * das Wappenbild und nimmt „Halle“ dafür aus der Punktereihe. In
   * `seiten.ts` bleibt sie stehen, weil Sitemap und Mobilleiste sie brauchen;
   * gefiltert wird deshalb hier und nicht dort.
   */
  const punkte = HAUPTNAV.filter((s) => s.pfad !== '/');

  /**
   * Die Einladung stammt aus dem Entwurf und ist NICHT geprüft — im Code
   * stand vor dem Umbau nirgends ein Discord-Link. Vor dem Ausrollen muss
   * die Adresse bestätigt werden. Dieselbe Zeile steht in der Halle und im
   * Fuß; bestätigt wird sie an allen drei Stellen zugleich.
   */
  const DISCORD = 'https://discord.gg/worldofvikings';
</script>

<header class="kopf">
  <div class="mitte kopf-reihe">
    <!--
      Wappen statt Schriftzug. Der Alternativtext ist der Markenname: Das
      Bild IST hier der Name der Seite, und ein Vorleser soll „World of
      Vikings, Link“ sagen, nicht „Grafik“.
    -->
    <a class="brand-mark" href={localizedPath(lang, '/')}>
      <img src="/assets/bilder/wappen.webp" width="40" height="40" alt={t['header.brand']} />
    </a>

    <nav class="nav" aria-label={t['header.nav.aria']}>
      <!--
        „Spielen“ ist im Entwurf der erste Punkt der Leiste und zugleich der
        einzige, der wie ein Knopf aussieht. Er führt weiter in die
        Charaktererstellung, nicht ins Spiel — nur die Beschriftung ist
        kürzer als beim alten „Auf Fahrt gehen“.
      -->
      <a class="nav-play" href={localizedPath(lang, FAHRT)}>{t['header.nav.play_button']}</a>

      <!--
        Zwei Beschriftungen je Punkt, eine davon per CSS ausgeblendet.

        Unterhalb von rund 1080 px passen „Ruhmeshalle“, „Rüstkammer“ und
        „Das Thing“ nicht mehr nebeneinander (gemessen: die Reihe braucht
        1195 px, sonst bricht sie um). Die kurzen Fassungen stehen im Katalog
        längst — die Mobilleiste benutzt sie. Der Umschaltpunkt gehört ins
        Stylesheet und nicht in ein Skript: Diese Seite wird vorgerendert,
        und zur Bauzeit weiss niemand, wie breit der Schirm ist.
      -->
      {#each punkte as s (s.pfad)}
        <a
          href={localizedPath(lang, s.pfad)}
          data-bald={s.bald ? t['header.soon'] : undefined}
          aria-current={hier === s.pfad ? 'page' : undefined}
          ><span class="label-long">{t[s.titel]}</span><span class="label-short"
            >{t[s.kurz ?? s.titel]}</span
          ></a
        >
      {/each}
    </nav>

    <div class="kopf-tat">
      <!--
        Der Sprachumschalter zeigt auf DIESELBE Seite in der anderen Sprache,
        nicht auf deren Startseite: `stripLocale` nimmt das Präfix weg,
        `localizedPath` setzt das andere davor. Zwei gewöhnliche Links, kein
        Skript — ohne JavaScript funktioniert der Wechsel genauso.

        Beschriftet wird mit dem Sprachkürzel (DE/EN), wie im Entwurf; die
        ausgeschriebenen Namen („Deutsch“, „English“) stehen im Fuß, wo der
        Platz dafür da ist.
      -->
      <nav class="sprachwahl" aria-label={t['header.language.aria']}>
        {#each LOCALES as l (l)}
          <a
            href={localizedPath(l, hier)}
            hreflang={l}
            lang={l}
            aria-current={l === lang ? 'true' : undefined}>{l.toUpperCase()}</a
          >
        {/each}
      </nav>

      <!--
        Nur „Anmelden“, nie „Konto“.

        Der Entwurf zeigt an dieser Stelle zwei einander ausschliessende
        Zustände. Diese Seite ist vorgerendert: Zur Bauzeit weiss niemand,
        wer liest, und die Anmeldung lebt erst im Browser (account.ts). Ein
        Umschalten nach der Hydration hiesse, dass jede Seite erst „Anmelden“
        zeigt und den Text danach austauscht — sichtbar, und ohne Skript
        bliebe die falsche Hälfte stehen. Der Weg zum eigenen Konto führt
        deshalb über die Anmeldeseite, die angemeldete Leser weiterleitet.
      -->
      <a class="knopf knopf-rand account-link" href={localizedPath(lang, '/anmelden')}
        >{t['header.signin.link']}</a
      >

      <a class="knopf discord-link" href={DISCORD}>{t['header.discord.link']}</a>
    </div>
  </div>
</header>

<style>
  /*
    Der Entwurf lässt die Kopfleiste im Fluss stehen (position: relative).
    Hier bleibt sie fest: `.seite` in wov.css rechnet ab 880 px 64 px
    Kopfhöhe auf den oberen Rand JEDER Inhaltsseite auf. Nähme man die
    Leiste aus dem Fluss heraus, stünde auf allen Seiten dieser Platz
    doppelt — und das Wechseln von fest auf mitlaufend ist eine Änderung des
    Verhaltens, keine des Aussehens. Alles Übrige folgt dem Entwurf.
  */
  .kopf {
    background: rgba(19, 19, 19, 0.86);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.5),
      inset 0 -1px 0 rgba(242, 202, 80, 0.14);
  }

  .kopf > .kopf-reihe {
    gap: 20px;
  }

  /* --------------------------------------------------------- Wappen */

  .brand-mark {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .brand-mark img {
    width: 40px;
    height: 40px;
    border-radius: 11%;
    border: 1px solid var(--umriss-matt);
    transition:
      box-shadow 0.3s ease,
      transform 0.3s ease;
  }

  .brand-mark:hover img {
    box-shadow: 0 0 22px rgba(255, 215, 0, 0.35);
    transform: scale(1.05) rotate(-2deg);
  }

  /* ----------------------------------------------------- Punktereihe */

  /* Zwischen Wappen und rechter Gruppe zentriert, nicht rechtsbündig. */
  .kopf .nav {
    margin-inline: auto;
    gap: 2px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .kopf .nav a {
    padding: 0.5rem 0.85rem;
    border-bottom: none;
    border-radius: 3px;
    text-transform: uppercase;
    transition:
      color 0.22s ease,
      background-color 0.22s ease,
      box-shadow 0.3s ease,
      transform 0.22s ease,
      text-shadow 0.22s ease;
  }

  .kopf .nav a:hover {
    color: var(--runengold);
    background: rgba(242, 202, 80, 0.12);
    box-shadow:
      inset 0 -2px 0 var(--runengold),
      0 8px 22px rgba(0, 0, 0, 0.45);
    transform: translateY(-1px);
    text-shadow: 0 0 12px rgba(255, 215, 0, 0.45);
  }

  /*
    Der offene Punkt ist im Entwurf kein blosser Strich mehr, sondern ein
    voller Kasten: Fläche, goldener Unterstrich als Innenschatten, Glut auf
    dem Text.
  */
  .kopf .nav a[aria-current='page'] {
    color: var(--runengold);
    background: rgba(242, 202, 80, 0.12);
    box-shadow: inset 0 -2px 0 var(--runengold);
    border-radius: 3px;
    text-shadow: 0 0 12px rgba(255, 215, 0, 0.45);
  }

  /* Der einzige Punkt, der wie ein Knopf aussieht. */
  .kopf .nav a.nav-play {
    color: var(--runengold);
    border: 1px solid var(--umriss);
    background: linear-gradient(180deg, rgba(242, 202, 80, 0.18), rgba(242, 202, 80, 0.06));
    box-shadow: inset 0 -2px 0 var(--runengold);
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.35);
    margin-right: 14px;
  }

  .kopf .nav a.nav-play:hover {
    box-shadow:
      inset 0 -2px 0 var(--runengold),
      0 0 24px rgba(255, 215, 0, 0.35);
    transform: translateY(-1px);
  }

  /* ------------------------------------------------- Rechte Gruppe */

  .kopf .kopf-tat {
    gap: 10px;
  }

  /* Ein gemeinsamer Rahmen um DE und EN statt zweier freier Links mit
     Trennstrich — das ist im Entwurf ein Schalter, kein Linkpaar. */
  .kopf .sprachwahl {
    gap: 0.15rem;
    border: 1px solid var(--umriss-matt);
    border-radius: 3px;
    padding: 0.15rem;
  }

  .kopf .sprachwahl a {
    font-size: 12px;
    letter-spacing: 0.1em;
    color: var(--umriss);
    padding: 0.4rem 0.6rem;
    border-radius: 2px;
    transition:
      color 0.2s ease,
      background-color 0.2s ease;
  }

  .kopf .sprachwahl a:hover {
    background: rgba(242, 202, 80, 0.1);
    color: var(--runengold);
  }

  .kopf .sprachwahl a[aria-current] {
    color: var(--runengold);
  }

  /* Der Trennstrich aus wov.css gehört zum alten Bauprinzip. */
  .kopf .sprachwahl a + a::before {
    content: none;
  }

  .kopf .account-link,
  .kopf .discord-link {
    padding: 0.55rem 1rem;
    font-size: 12px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .kopf .account-link:hover {
    border-color: var(--umriss);
    color: var(--runengold);
    background: rgba(242, 202, 80, 0.08);
    transform: translateY(-1px);
  }

  .kopf .discord-link {
    border-radius: var(--r-lg);
    transition:
      box-shadow 0.3s ease,
      transform 0.22s ease;
  }

  .kopf .discord-link:hover {
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.5),
      0 0 30px rgba(255, 215, 0, 0.45);
    transform: translateY(-1px);
    filter: none;
  }

  /* ------------------------------------------------------ Schmaler */

  /*
    Der Entwurf ist für eine feste Schirmbreite gezeichnet: Er enthält kein
    einziges @media, und seine einzige Vorkehrung ist `flex-wrap` auf der
    Punktereihe. Hier darf die Reihe aber NICHT umbrechen. Die Kopfleiste
    steht fest, und `.seite` in wov.css rechnet für sie genau 64 px auf den
    oberen Rand jeder Inhaltsseite auf. Gemessen am 24.08. bei 900 px:
    umgebrochene Reihe, Leiste 101 px hoch, erster Text 3 px darunter.

    Die Reihe braucht in voller Breite 1195 px Satzbreite; mit Rollbalken
    entspricht das rund 1210 px Schirmbreite. Der erste Haltepunkt liegt
    deshalb bei 1260 px und nicht bei 1200 — gemessen, nicht gerundet: bei
    1210 px stand die Leiste sonst wieder zweizeilig da. Was sie darunter
    aufgibt, steht hier, in dieser Reihenfolge: erst der Discord-Knopf
    (er steht im Fuss noch einmal), dann Innenabstände und Sperrung, zuletzt
    die langen Beschriftungen.
  */
  .kopf .nav .label-short {
    display: none;
  }

  @media (max-width: 1260px) {
    .kopf .discord-link {
      display: none;
    }
    .kopf > .kopf-reihe {
      gap: 12px;
    }
    .kopf .nav a {
      padding: 0.5rem 0.5rem;
      letter-spacing: 0.06em;
    }
    .kopf .nav a.nav-play {
      margin-right: 6px;
    }
    .kopf .account-link {
      padding: 0.55rem 0.7rem;
    }
  }

  @media (max-width: 1080px) {
    .kopf .nav .label-long {
      display: none;
    }
    .kopf .nav .label-short {
      display: inline;
    }
  }
</style>
