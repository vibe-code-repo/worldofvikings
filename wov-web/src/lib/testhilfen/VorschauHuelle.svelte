<script lang="ts">
  import { onMount } from 'svelte';
  // Test: bindet `daten`, `aktiv` und `fertig` wie die Erstellen-Seite.
  import ReckenVorschau from '../ReckenVorschau.svelte';
  let { plan, steuer }: Record<string, any> = $props();
  let daten = $state(null);
  let aktiv = $state(true);
  let fertig = $state(false);
  let hinweisText = $state<string | null>(null);
  onMount(() => {
    steuer.aktiv = (a: boolean) => {
      aktiv = a;
    };
    steuer.daten = () => daten;
    steuer.fertig = () => fertig;
    steuer.hinweis = () => hinweisText;
    steuer.beiDaten = 0;
  });
</script>

<ReckenVorschau
  {aktiv}
  {plan}
  bind:daten
  bind:fertig
  bind:hinweisText
  beiDaten={() => {
    steuer.beiDaten += 1;
  }}
/>
