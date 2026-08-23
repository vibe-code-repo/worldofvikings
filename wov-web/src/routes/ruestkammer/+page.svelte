<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson, vorWieLange } from '$lib/formate';
  import type { Recke } from '$lib/recken';
  import Reckenprofil from '$lib/Reckenprofil.svelte';

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
    void goto('/ruestkammer', { noScroll: false, keepFocus: false });
  }
</script>

<Kopfdaten
  titel={gewaehlt ? `${gewaehlt.name} — Rüstkammer` : 'Rüstkammer'}
  beschreibung="Sieh dir Recken aus Midgard an: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen."
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">Rüstkammer</h1>
  <p style="color:var(--matt);max-width:44rem">
    Wer wie durch Midgard zieht: Ausrüstung, Fertigkeiten, bezwungene Wächter und Trophäen.
    Suche nach einem Recken, einer Sippe oder einem Beinamen.
  </p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>Noch Beispieldaten.</b> Das Spiel kennt bisher keine Konten — es gibt also noch keine
    echten Recken zu zeigen. Die Kammer steht aber fertig und füllt sich von selbst, sobald der
    Server Charaktere speichert.
  </div>

  {#if gewaehlt}
    <a class="knopf knopf-schlicht" href="/ruestkammer" onclick={zurueck} style="margin-bottom:1.5rem"
      >‹ Zurück zur Suche</a
    >
    <Reckenprofil recke={gewaehlt} />
  {:else}
    <!--
      Das Label trug in der alten Fassung `hidden` und eine CSS-Klasse, die es
      gar nicht gab — damit hatte das Suchfeld keinen zugänglichen Namen
      (Roadmap H4). Jetzt trägt es `nur-vorlesen`, eine Klasse, die in
      wov.css tatsächlich existiert: sichtbar für Screenreader, unsichtbar am
      Bildschirm.
    -->
    <form class="suche" style="margin:1.5rem 0 2rem" role="search" onsubmit={(e) => e.preventDefault()}>
      <label class="nur-vorlesen" for="suchfeld">Recke suchen</label>
      <input
        id="suchfeld"
        class="feld"
        type="search"
        placeholder="Name, Beiname oder Sippe …"
        autocomplete="off"
        spellcheck="false"
        bind:value={suchtext}
      />
      <button class="knopf" type="submit">Suchen</button>
    </form>

    {#if fehler}
      <p class="leer-zustand">Die Kammer ist gerade verschlossen — die Reckenliste liess sich nicht laden.</p>
    {:else if !geladen}
      <p class="leer-zustand">Die Kammer wird aufgeschlossen …</p>
    {:else if treffer.length === 0}
      <p class="leer-zustand">Kein Recke dieses Namens in der Kammer.</p>
    {:else}
      <div class="gitter gitter-3">
        {#each treffer as r (r.id)}
          <a class="tafel-matt karte" href="/ruestkammer?reck={encodeURIComponent(r.id)}">
            <h3 style="margin:0 0 .2em">{r.name}</h3>
            <div style="color:var(--matt);font-size:.9rem">{r.beiname} · {r.sippe}</div>
            <div style="margin-top:.6rem;font-size:.85rem;color:var(--matt)">
              Runenrang {r.stufe} · {r.welt} · zuletzt {vorWieLange(r.zuletzt_gesehen)}
            </div>
          </a>
        {/each}
      </div>
    {/if}
  {/if}
</main>
