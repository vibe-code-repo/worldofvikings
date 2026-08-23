<script lang="ts">
  import { onMount } from 'svelte';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { datumLang, holeJson } from '$lib/formate';

  interface Eintrag { art: string; datum: string; titel: string; text: string }

  let eintraege = $state<Eintrag[] | null>(null);
  let fehler = $state(false);

  onMount(async () => {
    try {
      const daten = await holeJson<{ eintraege?: Eintrag[] }>('/api/saga.json');
      // Nach Datum absteigend — die Datei ist zwar sortiert, aber darauf will
      // sich niemand verlassen, der unten schnell etwas anhängt.
      eintraege = [...(daten.eintraege ?? [])].sort((a, b) => b.datum.localeCompare(a.datum));
    } catch (e) {
      console.error(e);
      fehler = true;
    }
  });
</script>

<Kopfdaten
  titel="Die Saga"
  beschreibung="Was sich in Midgard tut: Neuigkeiten zu Welt, Spiel und Server."
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">Die Saga</h1>
  <p style="color:var(--matt);max-width:44rem">
    Was in Midgard gebaut, geändert und repariert wurde — in der Reihenfolge, in der es
    geschah.
  </p>

  <div style="margin-top:2rem">
    {#if fehler}
      <p class="leer-zustand">Die Saga schweigt gerade.</p>
    {:else if eintraege === null}
      <p class="leer-zustand">Die Saga wird aufgeschlagen …</p>
    {:else if eintraege.length === 0}
      <p class="leer-zustand">Noch kein Eintrag.</p>
    {:else}
      {#each eintraege as e (e.datum + e.titel)}
        <article class="tafel" style="margin-bottom:1.4rem">
          <div
            style="color:var(--met);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase"
          >
            {e.art} · {datumLang(e.datum)}
          </div>
          <h2 style="font-size:1.4rem;margin:.4rem 0 .6rem">{e.titel}</h2>
          <p style="color:var(--matt);margin:0">{e.text}</p>
        </article>
      {/each}
    {/if}
  </div>
</main>
