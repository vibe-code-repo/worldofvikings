<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { datumLang, holeJson } from '$lib/formate';
  import { localeFrom, messages } from '$lib/i18n';

  interface Eintrag { art: string; datum: string; titel: string; text: string }

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

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

<Kopfdaten titel={t['saga.meta.title']} beschreibung={t['saga.meta.description']} />

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['saga.heading']}</h1>
  <p style="color:var(--matt);max-width:44rem">{t['saga.intro']}</p>

  <div style="margin-top:2rem">
    {#if fehler}
      <p class="leer-zustand">{t['saga.error']}</p>
    {:else if eintraege === null}
      <p class="leer-zustand">{t['saga.loading']}</p>
    {:else if eintraege.length === 0}
      <p class="leer-zustand">{t['saga.empty']}</p>
    {:else}
      <!--
        `e.art`, `e.titel` und `e.text` stammen aus /api/saga.json und bleiben
        vorerst deutsch — die Datei wird zur Laufzeit geholt und ist nicht Teil
        des Katalogs. Auf /en steht deshalb englischer Rahmen um deutschen
        Inhalt; das ist bekannt und wartet auf eine zweisprachige Saga-Datei.
      -->
      {#each eintraege as e (e.datum + e.titel)}
        <article class="tafel" style="margin-bottom:1.4rem">
          <div
            style="color:var(--met);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase"
          >
            {e.art} · {datumLang(e.datum, lang)}
          </div>
          <h2 style="font-size:1.4rem;margin:.4rem 0 .6rem">{e.titel}</h2>
          <p style="color:var(--matt);margin:0">{e.text}</p>
        </article>
      {/each}
    {/if}
  </div>
</main>
