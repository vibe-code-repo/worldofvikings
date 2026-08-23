<script lang="ts">
  import { page } from '$app/state';
  import { HAUPTNAV, FAHRT } from './seiten';
  import Ikone from './Ikone.svelte';

  /**
   * Welcher Punkt der offene ist, entscheidet die Adresse — nicht ein Skript,
   * das nach dem Laden Klassen nachträgt. Damit steht die Markierung schon in
   * der vorgerenderten Datei und flackert nicht beim ersten Bild.
   *
   * `/saga.html` und `/saga` sind dieselbe Seite (nginx: try_files); die
   * Endung wird deshalb abgeschnitten, bevor verglichen wird.
   */
  const hier = $derived(page.url.pathname.replace(/\.html$/, '') || '/');
</script>

<header class="kopf">
  <div class="mitte">
    <a class="marke" href="/">
      <Ikone name="schwerter" />
      World of Vikings
    </a>

    <nav class="nav" aria-label="Hauptnavigation">
      {#each HAUPTNAV as s (s.pfad)}
        <a
          href={s.pfad}
          data-bald={s.bald ? '' : undefined}
          aria-current={hier === s.pfad ? 'page' : undefined}>{s.titel}</a
        >
      {/each}
    </nav>

    <div class="kopf-tat">
      <a class="knopf" href={FAHRT}>Auf Fahrt gehen</a>
    </div>
  </div>
</header>
