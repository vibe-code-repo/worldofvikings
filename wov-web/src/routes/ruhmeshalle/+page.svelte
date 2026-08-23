<script lang="ts">
  import { onMount } from 'svelte';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { TAFELN, type Recke } from '$lib/recken';

  let recken = $state<Recke[]>([]);
  let fehler = $state(false);
  let geladen = $state(false);
  let aktiv = $state(TAFELN[0].id);

  const tafel = $derived(TAFELN.find((t) => t.id === aktiv) ?? TAFELN[0]);

  const sortiert = $derived(
    [...recken].sort((a, b) =>
      tafel.grossIstBesser ? tafel.wert(b) - tafel.wert(a) : tafel.wert(a) - tafel.wert(b)
    )
  );

  onMount(async () => {
    try {
      recken = (await holeJson<{ recken?: Recke[] }>('/api/recken.json')).recken ?? [];
    } catch (e) {
      console.error(e);
      fehler = true;
    }
    geladen = true;
  });
</script>

<Kopfdaten
  titel="Ruhmeshalle"
  beschreibung="Die Bestenlisten aus Midgard: Runenrang, bezwungene Wächter, Zeit auf Fahrt."
/>

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">Ruhmeshalle</h1>
  <p style="color:var(--matt);max-width:44rem">
    Wer sich in Midgard einen Namen gemacht hat. Die Tafeln werden neu berechnet, sobald die
    Welt gespeichert wird.
  </p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>Noch Beispieldaten.</b> Solange es keine Konten gibt, stehen hier erfundene Recken — die
    Tafeln selbst sind fertig.
  </div>

  <div class="marken" style="margin:2rem 0 1.2rem" role="tablist">
    {#each TAFELN as t (t.id)}
      <button
        class="knopf knopf-schlicht"
        type="button"
        role="tab"
        aria-selected={t.id === aktiv}
        style={t.id === aktiv ? 'color:var(--runengold);border-color:var(--umriss)' : ''}
        onclick={() => (aktiv = t.id)}>{t.titel}</button
      >
    {/each}
  </div>

  <div class="tafel tafel-tabelle">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th class="zahl">#</th>
            <th>Recke</th>
            <th>Sippe</th>
            <th class="zahl">{tafel.spalte}</th>
          </tr>
        </thead>
        <tbody>
          {#if fehler}
            <tr><td colspan="4">Die Tafeln sind gerade verhängt.</td></tr>
          {:else if !geladen}
            <tr><td colspan="4">wird geholt …</td></tr>
          {:else}
            {#each sortiert as r, i (r.id)}
              <tr>
                <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                <td>
                  <a href="/ruestkammer?reck={encodeURIComponent(r.id)}">{r.name}</a>
                  <span style="color:var(--matt)"> {r.beiname}</span>
                </td>
                <td style="color:var(--matt)">{r.sippe}</td>
                <td class="zahl">{tafel.zeigen(r)}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</main>
