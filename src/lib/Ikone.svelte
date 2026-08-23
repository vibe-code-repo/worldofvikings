<script lang="ts">
  /**
   * Ein Symbol aus dem Vorrat (IkonenVorrat.svelte).
   * `name` ist die Kennung ohne das Präfix `i-`.
   */
  let { name, klasse = 'ikone' }: { name: string; klasse?: string } = $props();
</script>

<svg class={klasse} aria-hidden="true"><use href="#i-{name}" /></svg>
