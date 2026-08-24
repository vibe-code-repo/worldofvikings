<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { holeJson } from '$lib/formate';
  import { TAFELN, type Recke } from '$lib/recken';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let recken = $state<Recke[]>([]);
  let fehler = $state(false);
  let geladen = $state(false);
  let aktiv = $state(TAFELN[0].id);

  const tafel = $derived(TAFELN.find((t2) => t2.id === aktiv) ?? TAFELN[0]);

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

<Kopfdaten titel={t['hall_of_fame.title']} beschreibung={t['hall_of_fame.description']} />

<main class="mitte seite">
  <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['hall_of_fame.heading']}</h1>
  <p style="color:var(--matt);max-width:44rem">{t['hall_of_fame.intro']}</p>

  <div class="hinweis" style="margin:1.5rem 0">
    <b>{t['hall_of_fame.hint.bold']}</b>
    {t['hall_of_fame.hint.text']}
  </div>

  <div class="marken" style="margin:2rem 0 1.2rem" role="tablist">
    {#each TAFELN as tf (tf.id)}
      <button
        class="knopf knopf-schlicht"
        type="button"
        role="tab"
        aria-selected={tf.id === aktiv}
        style={tf.id === aktiv ? 'color:var(--runengold);border-color:var(--umriss)' : ''}
        onclick={() => (aktiv = tf.id)}>{t[tf.titel]}</button
      >
    {/each}
  </div>

  <div class="tafel tafel-tabelle">
    <div class="rollbar">
      <table class="tabelle">
        <thead>
          <tr>
            <th class="zahl">{t['hall_of_fame.table.hash']}</th>
            <th>{t['hall_of_fame.table.character']}</th>
            <th>{t['hall_of_fame.table.clan']}</th>
            <th class="zahl">{t[tafel.spalte]}</th>
          </tr>
        </thead>
        <tbody>
          {#if fehler}
            <tr><td colspan="4">{t['hall_of_fame.state.error']}</td></tr>
          {:else if !geladen}
            <tr><td colspan="4">{t['hall_of_fame.state.loading']}</td></tr>
          {:else}
            {#each sortiert as r, i (r.id)}
              <tr>
                <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                <td>
                  <a
                    href="{localizedPath(lang, '/ruestkammer')}?reck={encodeURIComponent(r.id)}"
                    >{r.name}</a
                  >
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
