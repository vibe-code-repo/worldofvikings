<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson, vorWieLange } from '$lib/formate';
  import type { Recke } from '$lib/recken';
  import Reckenprofil from '$lib/Reckenprofil.svelte';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  /**
   * Die Rüstkammer im Entwurf "Rune & Iron".
   *
   * Zwei Zustände wie bisher: Suche mit Trefferraster, oder ein Profil. Der
   * Entwurf schaltet zwischen beiden im Browser um — hier bleibt es bei der
   * Adresse (?reck=…), damit jedes Profil verlinkbar und vorrenderbar bleibt
   * und der Zurück-Knopf des Browsers tut, was er soll.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** Die Kammer in der aktuellen Sprache — Ziel von Karten und Zurück-Knopf. */
  const kammer = $derived(localizedPath(lang, '/ruestkammer'));

  let recken = $state<Recke[]>([]);
  let fehler = $state(false);
  let geladen = $state(false);
  let suchtext = $state('');

  /**
   * Welches Profil offen ist, steht in der Adresse (?reck=…) — nicht in einer
   * Variablen. So ist jedes Profil verlinkbar und der Zurück-Knopf des
   * Browsers tut, was er soll. Das war schon in der alten Fassung so; neu ist
   * nur, dass SvelteKit die Adresse führt statt eines eigenen popstate-Griffs.
   */
  const gewaehlt = $derived(
    recken.find((r) => r.id === page.url.searchParams.get('reck')) ?? null
  );

  const treffer = $derived.by(() => {
    const nadel = suchtext.trim().toLowerCase();
    if (!nadel) return recken;
    return recken.filter((r) =>
      [r.name, r.beiname, r.sippe].some((s) => s.toLowerCase().includes(nadel))
    );
  });

  onMount(async () => {
    try {
      recken = (await holeJson<{ recken?: Recke[] }>('/api/recken.json')).recken ?? [];
    } catch (e) {
      console.error(e);
      fehler = true;
    }
    geladen = true;
  });

  function zurueck(e: MouseEvent) {
    e.preventDefault();
    void goto(kammer, { noScroll: false, keepFocus: false });
  }
</script>

<Kopfdaten
  titel={gewaehlt ? `${gewaehlt.name} — ${t['armory.title']}` : t['armory.title']}
  beschreibung={t['armory.description']}
/>

<main class="mitte seite armory-page">
  <span class="runen kicker" aria-hidden="true">ᚱᚢᛊᛏ</span>
  <h1>{t['armory.heading']}</h1>
  <p class="intro">{t['armory.intro']}</p>

  <!--
    Der Entwurf zeigt diesen Kasten für die Rüstkammer nicht. Er bleibt
    trotzdem: Die Recken hier sind erfunden, und das darf die Seite nicht
    verschweigen, nur weil eine Vorlage den Platz anders verplant.
  -->
  <div class="hinweis note">
    <b>{t['armory.hint.bold']}</b>
    {t['armory.hint.text']}
  </div>

  {#if gewaehlt}
    <a class="knopf knopf-schlicht back" href={kammer} onclick={zurueck}>{t['armory.back']}</a>
    <Reckenprofil recke={gewaehlt} />
  {:else}
    <!--
      Das Label trug in der alten Fassung `hidden` und eine CSS-Klasse, die es
      gar nicht gab — damit hatte das Suchfeld keinen zugänglichen Namen
      (Roadmap H4). Jetzt trägt es `nur-vorlesen`, eine Klasse, die in
      wov.css tatsächlich existiert: sichtbar für Screenreader, unsichtbar am
      Bildschirm. Der Entwurf zeigt gar kein Label — das ist der eine Punkt,
      an dem ihm hier nicht gefolgt wird.

      Der Absende-Knopf ist dagegen weg, wie im Entwurf: Gefiltert wird bei
      jedem Tastendruck, der Knopf hätte nichts zu tun gehabt.
    -->
    <form class="suche search" role="search" onsubmit={(e) => e.preventDefault()}>
      <label class="nur-vorlesen" for="suchfeld">{t['armory.search.label']}</label>
      <input
        id="suchfeld"
        class="feld"
        type="search"
        placeholder={t['armory.search.placeholder']}
        autocomplete="off"
        spellcheck="false"
        bind:value={suchtext}
      />
    </form>

    {#if fehler}
      <p class="leer-zustand">{t['armory.state.error']}</p>
    {:else if !geladen}
      <p class="leer-zustand">{t['armory.state.loading']}</p>
    {:else if treffer.length === 0}
      <p class="leer-zustand">{t['armory.state.empty']}</p>
    {:else}
      <div class="results">
        {#each treffer as r (r.id)}
          <a class="tafel-matt karte result" href="{kammer}?reck={encodeURIComponent(r.id)}">
            <h3>{r.name}</h3>
            <div class="result-sub">{r.beiname} · {r.sippe}</div>
            <div class="result-line">
              {t['armory.card.rune_rank']}
              {r.stufe} · {r.welt} · {t['armory.card.last_seen']}
              {vorWieLange(r.zuletzt_gesehen, lang)}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</main>

<style>
  /* Die breiteste der vier Unterseiten: das Profil stellt zwei Spalten
     nebeneinander, und die rechte darf nicht zur Rinne werden. */
  .armory-page {
    width: min(1200px, 100%);
  }

  .kicker {
    display: block;
    font-size: 18px;
    margin-bottom: 0.6rem;
  }

  h1 {
    margin: 0 0 0.6rem;
    font-size: clamp(30px, 5vw, 44px);
  }

  .intro {
    margin: 0 0 1.5rem;
    max-width: 44rem;
    color: var(--text-matt);
    font-size: 17px;
    line-height: 1.65;
  }

  .note {
    margin-bottom: 2rem;
  }

  /* ------------------------------------------------------------- Suche */

  .search {
    margin: 1.5rem 0 2rem;
  }

  /* Etwas breiter als die Regel in wov.css (14rem): Der Platzhalter nennt
     drei Möglichkeiten und soll nicht abgeschnitten werden. */
  .search .feld {
    flex: 1 1 16rem;
    padding: 0.8rem 1rem;
  }

  /* ---------------------------------------------------------- Treffer */

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 20px;
  }

  .result {
    padding: 1.2rem 1.3rem;
  }

  /* Drei Stufen im Text der Karte: Name gold, Zeile darunter matt, die
     Nebensachen noch eine Stufe zurück. */
  .result h3 {
    margin: 0 0 0.2em;
  }

  .result-sub {
    color: var(--text-matt);
    font-size: 14px;
  }

  .result-line {
    margin-top: 0.7rem;
    font-size: 13px;
    color: var(--umriss);
  }

  /* ---------------------------------------------------------- Zurück */

  .back {
    margin-bottom: 1.5rem;
    padding: 0.7rem 1.2rem;
    font-size: 12px;
    text-transform: uppercase;
  }
</style>
