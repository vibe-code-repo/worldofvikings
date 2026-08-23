<script lang="ts">
  import { page } from '$app/state';
  import { datumKurz, vorWieLange } from './formate';
  import type { Recke } from './recken';
  import { type MessageKey, localeFrom, messages } from './i18n';

  let { recke }: { recke: Recke } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** Die Puppe: vier Slots links, vier rechts, Silhouette dazwischen. */
  const LINKS: Array<[string, MessageKey]> = [
    ['kopf', 'reckenprofil.slot.kopf'],
    ['brust', 'reckenprofil.slot.brust'],
    ['beine', 'reckenprofil.slot.beine'],
    ['umhang', 'reckenprofil.slot.umhang'],
  ];
  const RECHTS: Array<[string, MessageKey]> = [
    ['waffe', 'reckenprofil.slot.waffe'],
    ['nebenhand', 'reckenprofil.slot.nebenhand'],
    ['werkzeug', 'reckenprofil.slot.werkzeug'],
    ['guertel', 'reckenprofil.slot.guertel'],
  ];

  const erlegt = $derived(recke.bosse.filter((b) => b.erlegt).length);

  /* Die Fertigkeitsskala geht bis 100 — der Anteil ist deshalb die Stufe selbst. */
  const fertigkeiten = $derived([...recke.fertigkeiten].sort((a, b) => b.stufe - a.stufe));
</script>

{#snippet slot(schluessel: string, beschriftung: MessageKey)}
  {@const stueck = recke.ausruestung?.[schluessel]}
  {#if stueck}
    <div class="slot guete-{Number(stueck.guete) || 1}">
      <span class="slot-bild" aria-hidden="true">{stueck.bild}</span>
      <span class="slot-text">
        <span class="slot-name">{stueck.name}</span>
        <span class="slot-rolle"
          >{t[beschriftung]} · {t['reckenprofil.slot.guete']} {Number(stueck.guete) || 1}</span
        >
      </span>
    </div>
  {:else}
    <div class="slot leer">
      <span class="slot-bild" aria-hidden="true">·</span>
      <span class="slot-text">
        <span class="slot-name">{t['reckenprofil.slot.leer']}</span>
        <span class="slot-rolle">{t[beschriftung]}</span>
      </span>
    </div>
  {/if}
{/snippet}

<div class="tafel">
  <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline">
    <h2 style="margin:0">{recke.name}</h2>
    <span style="color:var(--met)">{recke.beiname}</span>
  </div>
  <!--
    `recke.sippe`, `recke.welt` und die Namen aus /api/recken.json bleiben, wie
    sie in der Datei stehen — sie sind Inhalt, nicht Beschriftung.
  -->
  <p style="color:var(--matt);margin:.3rem 0 1.2rem">
    {recke.sippe} · {recke.welt} · {t['reckenprofil.runenrang']}
    {recke.stufe} · {t['reckenprofil.zuletzt_gesehen']}
    {vorWieLange(recke.zuletzt_gesehen, lang)}
  </p>

  <div class="werte">
    <div class="wert"><b>{recke.werte.leben}</b><span>{t['reckenprofil.wert.leben']}</span></div>
    <div class="wert">
      <b>{recke.werte.ausdauer}</b><span>{t['reckenprofil.wert.ausdauer']}</span>
    </div>
    <div class="wert"><b>{recke.werte.eitr}</b><span>{t['reckenprofil.wert.eitr']}</span></div>
    <div class="wert">
      <b>{recke.werte.traglast}</b><span>{t['reckenprofil.wert.traglast']}</span>
    </div>
    <div class="wert">
      <b>{recke.spielzeit_stunden} h</b><span>{t['reckenprofil.wert.auf_fahrt']}</span>
    </div>
    <div class="wert"><b>{recke.tode}</b><span>{t['reckenprofil.wert.hel']}</span></div>
  </div>
</div>

<div class="runen-trenner" aria-hidden="true">ᚱᚢᛊᛏᚢᚾᚷ</div>

<div class="gitter gitter-2">
  <section class="tafel">
    <h3>{t['reckenprofil.ausruestung.titel']}</h3>
    <div class="puppe">
      <div class="puppe-spalte">
        {#each LINKS as [k, b] (k)}{@render slot(k, b)}{/each}
      </div>
      <div class="puppe-figur">
        <!-- Schlichte Silhouette. Platzhalter, bis der Client ein Porträt liefern kann. -->
        <svg
          viewBox="0 0 80 170"
          width="110"
          role="img"
          aria-label={t['reckenprofil.figur.aria']}
          style="opacity:.5"
        >
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
    <h3>{t['reckenprofil.fertigkeiten.titel']}</h3>
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
      {t['reckenprofil.waechter.titel']}
      <span style="color:var(--matt);font-size:.85rem"
        >{erlegt} {t['reckenprofil.waechter.von']} {recke.bosse.length}</span
      >
    </h3>
    <div class="marken">
      {#each recke.bosse as b (b.name)}
        <span class="made" class:made-erlegt={b.erlegt}>{b.erlegt ? '✦ ' : ''}{b.name}</span>
      {/each}
    </div>

    <h3 style="margin-top:1.4rem">{t['reckenprofil.lande.titel']}</h3>
    <div class="marken">
      {#each recke.biome as b (b)}<span class="made">{b}</span>{/each}
    </div>
  </section>

  <section class="tafel">
    <h3>{t['reckenprofil.trophaeen.titel']}</h3>
    <div class="marken">
      {#each recke.trophaeen as tr (tr)}<span class="made">{tr}</span>{/each}
    </div>
    <p style="color:var(--matt);font-size:.85rem;margin-top:1.2rem">
      {t['reckenprofil.erschaffen']}
      {datumKurz(recke.erschaffen, lang)}.
    </p>
  </section>
</div>
