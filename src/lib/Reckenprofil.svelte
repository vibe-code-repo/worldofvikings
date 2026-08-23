<script lang="ts">
  import { vorWieLange } from './formate';
  import type { Recke } from './recken';

  let { recke }: { recke: Recke } = $props();

  /** Die Puppe: vier Slots links, vier rechts, Silhouette dazwischen. */
  const LINKS: Array<[string, string]> = [
    ['kopf', 'Kopf'],
    ['brust', 'Brust'],
    ['beine', 'Beine'],
    ['umhang', 'Umhang'],
  ];
  const RECHTS: Array<[string, string]> = [
    ['waffe', 'Waffe'],
    ['nebenhand', 'Nebenhand'],
    ['werkzeug', 'Werkzeug'],
    ['guertel', 'Gürtel'],
  ];

  const erlegt = $derived(recke.bosse.filter((b) => b.erlegt).length);

  /* Die Fertigkeitsskala geht bis 100 — der Anteil ist deshalb die Stufe selbst. */
  const fertigkeiten = $derived([...recke.fertigkeiten].sort((a, b) => b.stufe - a.stufe));
</script>

{#snippet slot(schluessel: string, beschriftung: string)}
  {@const stueck = recke.ausruestung?.[schluessel]}
  {#if stueck}
    <div class="slot guete-{Number(stueck.guete) || 1}">
      <span class="slot-bild" aria-hidden="true">{stueck.bild}</span>
      <span class="slot-text">
        <span class="slot-name">{stueck.name}</span>
        <span class="slot-rolle">{beschriftung} · Güte {Number(stueck.guete) || 1}</span>
      </span>
    </div>
  {:else}
    <div class="slot leer">
      <span class="slot-bild" aria-hidden="true">·</span>
      <span class="slot-text">
        <span class="slot-name">— leer —</span>
        <span class="slot-rolle">{beschriftung}</span>
      </span>
    </div>
  {/if}
{/snippet}

<div class="tafel">
  <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline">
    <h2 style="margin:0">{recke.name}</h2>
    <span style="color:var(--met)">{recke.beiname}</span>
  </div>
  <p style="color:var(--matt);margin:.3rem 0 1.2rem">
    {recke.sippe} · {recke.welt} · Runenrang {recke.stufe} · zuletzt gesehen
    {vorWieLange(recke.zuletzt_gesehen)}
  </p>

  <div class="werte">
    <div class="wert"><b>{recke.werte.leben}</b><span>Leben</span></div>
    <div class="wert"><b>{recke.werte.ausdauer}</b><span>Ausdauer</span></div>
    <div class="wert"><b>{recke.werte.eitr}</b><span>Eitr</span></div>
    <div class="wert"><b>{recke.werte.traglast}</b><span>Traglast</span></div>
    <div class="wert"><b>{recke.spielzeit_stunden} h</b><span>auf Fahrt</span></div>
    <div class="wert"><b>{recke.tode}</b><span>Fahrten nach Hel</span></div>
  </div>
</div>

<div class="runen-trenner" aria-hidden="true">ᚱᚢᛊᛏᚢᚾᚷ</div>

<div class="gitter gitter-2">
  <section class="tafel">
    <h3>Ausrüstung</h3>
    <div class="puppe">
      <div class="puppe-spalte">
        {#each LINKS as [k, b] (k)}{@render slot(k, b)}{/each}
      </div>
      <div class="puppe-figur">
        <!-- Schlichte Silhouette. Platzhalter, bis der Client ein Porträt liefern kann. -->
        <svg viewBox="0 0 80 170" width="110" role="img" aria-label="Umriss eines Recken" style="opacity:.5">
          <g fill="none" stroke="#8a6a34" stroke-width="2" stroke-linejoin="round">
            <circle cx="40" cy="010" r="9" />
            <path d="M31 6 L27 0 M49 6 L53 0" />
            <path d="M40 19 L40 88" />
            <path d="M22 30 L40 24 L58 30 L56 62 L24 62 Z" />
            <path d="M24 32 L10 60 M56 32 L70 60" />
            <path d="M32 88 L28 140 L26 165 M48 88 L52 140 L54 165" />
            <path d="M26 62 L54 62 L52 90 L28 90 Z" />
          </g>
        </svg>
      </div>
      <div class="puppe-spalte">
        {#each RECHTS as [k, b] (k)}{@render slot(k, b)}{/each}
      </div>
    </div>
  </section>

  <section class="tafel">
    <h3>Fertigkeiten</h3>
    {#each fertigkeiten as f (f.name)}
      <div class="balken-zeile">
        <div class="balken-kopf"><span>{f.name}</span><b>{f.stufe}</b></div>
        <div class="balken"><i style="--anteil:{f.stufe}"></i></div>
      </div>
    {/each}
  </section>
</div>

<div class="gitter gitter-2" style="margin-top:1.4rem">
  <section class="tafel">
    <h3>
      Bezwungene Wächter
      <span style="color:var(--matt);font-size:.85rem">{erlegt} von {recke.bosse.length}</span>
    </h3>
    <div class="marken">
      {#each recke.bosse as b (b.name)}
        <span class="made" class:made-erlegt={b.erlegt}>{b.erlegt ? '✦ ' : ''}{b.name}</span>
      {/each}
    </div>

    <h3 style="margin-top:1.4rem">Bereiste Lande</h3>
    <div class="marken">
      {#each recke.biome as b (b)}<span class="made">{b}</span>{/each}
    </div>
  </section>

  <section class="tafel">
    <h3>Trophäen</h3>
    <div class="marken">
      {#each recke.trophaeen as t (t)}<span class="made">{t}</span>{/each}
    </div>
    <p style="color:var(--matt);font-size:.85rem;margin-top:1.2rem">
      Erschaffen am {new Date(recke.erschaffen).toLocaleDateString('de-DE')}.
    </p>
  </section>
</div>
