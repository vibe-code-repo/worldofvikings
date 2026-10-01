<script lang="ts">
  import { onMount } from 'svelte';
  // Test: steht für die Rüstkammer-Seite, die dem Profil Aussehen und Stücke gibt.
  import Reckenprofil from '../Reckenprofil.svelte';
  let { recke, start, stuecke, steuer }: Record<string, any> = $props();
  // svelte-ignore state_referenced_locally
  let aussehen = $state(start);
  // svelte-ignore state_referenced_locally
  let ausruestung = $state(stuecke);
  let zeigen = $state(true);
  onMount(() => {
    steuer.setze = (a: unknown, r: unknown) => {
      aussehen = a;
      ausruestung = r;
    };
    steuer.zeige = (z: boolean) => {
      zeigen = z;
    };
  });
</script>

{#if zeigen}<Reckenprofil {recke} {aussehen} {ausruestung} />{/if}
