<script lang="ts">
  import { page } from '$app/state';
  import { MOBILNAV, FAHRT } from './seiten';
  import Ikone from './Ikone.svelte';

  const hier = $derived(page.url.pathname.replace(/\.html$/, '') || '/');

  /* Der Fahrt-Knopf sitzt in der Mitte: zwei Ziele links, zwei rechts. */
  const links = MOBILNAV.slice(0, 2);
  const rechts = MOBILNAV.slice(2);
</script>

<nav class="mobil-nav" aria-label="Hauptnavigation (schmal)">
  {#each links as s (s.pfad)}
    <a href={s.pfad} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{s.kurz ?? s.titel}</span>
    </a>
  {/each}

  <a class="mobil-fahrt" href={FAHRT}>
    <span class="kreis"><Ikone name="segeln" /></span>
    <span class="nur-vorlesen">Auf Fahrt gehen</span>
  </a>

  {#each rechts as s (s.pfad)}
    <a href={s.pfad} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{s.kurz ?? s.titel}</span>
    </a>
  {/each}
</nav>
