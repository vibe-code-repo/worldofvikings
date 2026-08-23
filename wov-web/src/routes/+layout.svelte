<script lang="ts">
  import '$lib/stil/wov.css';
  import IkonenVorrat from '$lib/IkonenVorrat.svelte';
  import Kopf from '$lib/Kopf.svelte';
  import MobilNav from '$lib/MobilNav.svelte';
  import Fuss from '$lib/Fuss.svelte';

  let { children } = $props();
</script>

<!--
  Die Hülle jeder Seite. Was hier steht, stand vorher siebenmal kopiert in
  den HTML-Dateien; der Kopfkommentar der alten index.html nannte das
  ausdrücklich einen bewussten Preis („bei sieben Dateien billiger als ein
  Build-Schritt, den sonst niemand kennt“). Der Build-Schritt ist jetzt da,
  also wird der Preis nicht mehr gezahlt.
-->
<IkonenVorrat />
<Kopf />
<MobilNav />

<!--
  Das <main> setzt jede Seite selbst. Die Startseite braucht eines ohne
  Ränder (der Held läuft über die volle Breite), die Inhaltsseiten eines mit
  `mitte seite`. Ein gemeinsames <main> hier müsste diesen Unterschied über
  eine Eigenschaft durchreichen — eine Zeile je Seite ist ehrlicher.
-->
{@render children()}

<Fuss />
