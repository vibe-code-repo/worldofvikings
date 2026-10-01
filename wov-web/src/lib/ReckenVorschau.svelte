<script lang="ts">
  import { type Snippet, untrack } from 'svelte';
  import { page } from '$app/state';
  import { holeJson } from './formate';
  import { localeFrom, messages } from './i18n';
  import {
    AUSSEHEN_PFAD,
    type AussehenDaten,
    BUENDEL_PFAD,
    type BuendelModul,
    type FigurFehler,
    FigurSteuerung,
    KOPFZOOM_SPEICHER,
    type LadePlan,
    fuelle,
    ueberwacheSichtbarkeit,
    webGLVerfuegbar,
  } from './reckenVorschauKern';

  /**
   * Die 3D-Figur eines Recken: Leinwand, Ladezustand, Drehknöpfe und die
   * Kopfmarkierung. Herausgezogen aus der Charaktererstellung, damit die
   * Rüstkammer dieselbe Figur zeigt. Der Ablauf steckt in
   * `reckenVorschauKern.ts`; hier hängt nur die Oberfläche daran.
   *
   * Das Vorschau-Bündel (`/assets/js/vorschau.js`, mehrere MB mit Babylon) wird
   * erst geladen, wenn `aktiv` gilt UND (bei `lazy`) die Bühne in die Nähe des
   * Bildschirms kommt. `@vite-ignore` hält es aus dem Bündel der Seite heraus.
   *
   * Fällt WebGL oder das Bündel aus, bleibt `rueckfall` (falls gegeben) stehen,
   * sonst der Lader mit der Fehlermeldung. Ohne JavaScript steht `rueckfall`
   * schon im vorgerenderten HTML.
   */
  interface Props {
    /** Liest den gewünschten Zustand; wird bei jedem Ladeschritt neu gerufen. */
    plan: (daten: AussehenDaten) => LadePlan;
    /** Aus: Engine weg, nichts geladen. */
    aktiv?: boolean;
    /** Erst laden, wenn die Bühne sichtbar wird. */
    lazy?: boolean;
    /** Ändert sich der Plan, die Figur selbst neu laden (sonst steuert die Seite). */
    auto?: boolean;
    /** Drehknöpfe und Kopf-Zoom zeigen. */
    werkzeug?: boolean;
    /** Leinwand nicht über den Rahmen hinaus ziehen (feste Rahmen wie im Profil). */
    eng?: boolean;
    daten?: AussehenDaten | null;
    steuerung?: FigurSteuerung | null;
    fertig?: boolean;
    hinweisText?: string | null;
    kopfNah?: boolean;
    kopfUeber?: boolean;
    kopfGueltig?: boolean;
    kopfZoomBereit?: boolean;
    kopfZoomGesehen?: boolean;
    /** Nach dem Laden der Listen, vor dem Bündel. */
    beiDaten?: (daten: AussehenDaten) => void;
    /** Nach dem ersten vollständigen Ladevorgang. */
    beiGeladen?: () => void;
    rueckfall?: Snippet;
    /** Zeigt Bündel und WebGL; Tests ersetzen es. */
    ladeBuendel?: () => Promise<BuendelModul>;
  }

  let {
    plan,
    aktiv = true,
    lazy = false,
    auto = false,
    werkzeug = true,
    eng = false,
    daten = $bindable(null),
    steuerung = $bindable(null),
    fertig = $bindable(false),
    hinweisText = $bindable(null),
    kopfNah = $bindable(false),
    kopfUeber = $bindable(false),
    kopfGueltig = $bindable(false),
    kopfZoomBereit = $bindable(false),
    kopfZoomGesehen = $bindable(false),
    beiDaten,
    beiGeladen,
    rueckfall,
    ladeBuendel = () => import(/* @vite-ignore */ BUENDEL_PFAD) as Promise<BuendelModul>,
  }: Props = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let leinwand = $state<HTMLCanvasElement | null>(null);
  let wurzel = $state<HTMLDivElement | null>(null);
  let sichtbar = $state(false);
  let gestartet = $state(false);

  /** Erst bei Sichtbarkeit; ohne `lazy` gilt die Bühne sofort als sichtbar. */
  $effect(() => {
    if (!lazy) {
      sichtbar = true;
      return;
    }
    if (!wurzel || sichtbar) return;
    return ueberwacheSichtbarkeit(wurzel, () => {
      sichtbar = true;
    });
  });

  async function fehlerText(fehler: FigurFehler): Promise<string> {
    if (fehler.art === 'kein-webgl') return t['armory.figur.no_webgl'];
    if (fehler.art === 'buendel') {
      return fuelle(t['create.stage.hint.module_missing'], { fehler: String(fehler.fehler).slice(0, 90) });
    }
    // Die Meldung nennt Adresse UND Grund: Ob der Server schweigt, die Datei
    // fehlt oder die Domaingrenze blockt, ist sonst nicht zu unterscheiden.
    console.warn('[figur] Laden fehlgeschlagen:', fehler.url, fehler.fehler);
    let grund: string;
    try {
      const probe = await fetch(fehler.url, { method: 'GET' });
      grund = probe.ok
        ? fuelle(t['create.stage.hint.file_reachable'], { status: probe.status })
        : fuelle(t['create.stage.hint.server_status'], { status: probe.status });
    } catch (netz) {
      grund = fuelle(t['create.stage.hint.no_access'], { fehler: String(netz).slice(0, 60) });
    }
    return fuelle(t['create.stage.hint.not_loaded'], { grund });
  }

  /** Baut Steuerung und Engine auf; gibt den Abbau zurück. */
  function starte(flaeche: HTMLCanvasElement): () => void {
    let beendet = false;
    const eigene = new FigurSteuerung(
      { ladeBuendel, hatWebGL: () => webGLVerfuegbar() },
      {
        beiFertig: (wert) => {
          if (!beendet) fertig = wert;
        },
        beiFehler: (fehler) => {
          if (beendet) return;
          if (!fehler) {
            hinweisText = null;
            return;
          }
          void fehlerText(fehler).then((text) => {
            if (!beendet) hinweisText = text;
          });
        },
        beiKopf: (zustand) => {
          if (beendet) return;
          kopfNah = zustand.nah;
          kopfUeber = zustand.ueber;
          kopfGueltig = zustand.gueltig === true;
          if (zustand.nah && !kopfZoomGesehen) {
            kopfZoomGesehen = true;
            try {
              sessionStorage.setItem(KOPFZOOM_SPEICHER, '1');
            } catch {
              /* privater Modus: dann gilt es nur für diese Seite */
            }
          }
        },
        beiKopfZoomBereit: (bereit) => {
          if (!beendet) kopfZoomBereit = bereit;
        },
      },
    );
    steuerung = eigene;

    void (async () => {
      if (!daten) {
        try {
          daten = await holeJson<AussehenDaten>(AUSSEHEN_PFAD);
        } catch (e) {
          console.error('[figur]', e);
          if (!beendet) hinweisText = t['create.stage.hint.lists_missing'];
          return;
        }
        if (beendet) return;
        beiDaten?.(daten);
      }
      if (!(await eigene.starte(flaeche)) || beendet) return;
      await eigene.ladeAlles(() => plan(daten as AussehenDaten));
      if (beendet) return;
      gestartet = true;
      beiGeladen?.();
    })();

    return () => {
      beendet = true;
      eigene.dispose();
      if (steuerung === eigene) steuerung = null;
      gestartet = false;
      fertig = false;
      kopfNah = false;
      kopfUeber = false;
      kopfGueltig = false;
      kopfZoomBereit = false;
      hinweisText = null;
    };
  }

  $effect(() => {
    if (!aktiv || !sichtbar || !leinwand) return;
    const flaeche = leinwand;
    return untrack(() => starte(flaeche));
  });

  /** `auto`: Ändert sich der Plan, die Figur neu laden. */
  let letzterPlan = '';
  $effect(() => {
    if (!auto || !gestartet || !daten || !steuerung) return;
    const geplant = plan(daten);
    const schluessel = JSON.stringify(geplant);
    if (schluessel === letzterPlan) return;
    letzterPlan = schluessel;
    const aktuell = steuerung;
    const d = daten;
    untrack(() => void aktuell.ladeAlles(() => plan(d)));
  });
</script>

<div class="figur-buehne" class:eng bind:this={wurzel}>
  {#if rueckfall}
    <div class="figur-rueckfall" class:weg={fertig}>{@render rueckfall()}</div>
  {:else}
    <div class="figur-lader" class:ausblenden={fertig} class:fehler={Boolean(hinweisText)} aria-hidden="true">
      <div class="runenportal">
        <div class="runenring">
          {#each ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ'] as rune, index (rune)}
            <span style={`--r:${index * 45}deg`}>{rune}</span>
          {/each}
        </div>
        <i class="runenkern">{hinweisText ? 'ᛁ' : 'ᛉ'}</i>
      </div>
      <p>{hinweisText ? t['armory.figur.unavailable'] : t['armory.figur.loading']}</p>
    </div>
  {/if}
  <canvas bind:this={leinwand} class:bereit={fertig}></canvas>
  <!--
    Markierung am Kopf. Rein zur Anzeige (pointer-events: none): Der Klick
    geht an die Leinwand. Ort und Größe liefert die Vorschau als
    CSS-Variablen an dieser Bühne (--kopf-x, --kopf-y, --kopf-r).
  -->
  <div
    class="kopf-marke"
    class:gueltig={kopfGueltig}
    class:sichtbar={fertig && kopfZoomBereit && kopfGueltig && !kopfNah && (!kopfZoomGesehen || kopfUeber)}
    class:ueber={kopfUeber}
    aria-hidden="true"
  >
    <svg viewBox="0 0 16 16" width="14" height="14" focusable="false"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M10 10l4.5 4.5M4.5 6.5h4M6.5 4.5v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
  </div>
  <div class="buehne-hinweis nur-vorlesen" aria-live="polite" class:fertig>{hinweisText ?? t['create.stage.hint.loading']}</div>
  {#if werkzeug}
    <div class="buehne-werkzeug">
      <button type="button" title={t['create.stage.rotate_left']} onclick={() => steuerung?.drehe(-0.35)}>↺</button>
      <button type="button" title={t['create.stage.reset_view']} onclick={() => steuerung?.blickZurueck()}>⌂</button>
      <button type="button" title={t['create.stage.rotate_right']} onclick={() => steuerung?.drehe(0.35)}>↻</button>
      <button
        type="button"
        class:aktiv={kopfNah}
        title={kopfNah ? t['create.stage.zoom_out'] : t['create.stage.zoom_head']}
        aria-label={t['create.stage.zoom_head']}
        aria-pressed={kopfNah}
        disabled={!fertig || !kopfZoomBereit}
        onclick={() => steuerung?.zoomeKopf()}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M10 10l4.5 4.5M4.5 6.5h4{kopfNah ? '' : 'M6.5 4.5v4'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .figur-buehne { position: absolute; inset: 0; overflow: visible; }
  .figur-rueckfall { position: absolute; inset: 0; display: grid; place-items: center; transition: opacity 0.3s ease; }
  .figur-rueckfall.weg { visibility: hidden; opacity: 0; }
  .figur-lader {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 18px;
    color: #d8b950;
    text-align: center;
    text-shadow: 0 2px 8px #000;
    pointer-events: none;
    transition: visibility 0s linear, opacity 0.35s ease;
    z-index: 2;
  }
  .figur-lader.ausblenden { visibility: hidden; opacity: 0; transition-delay: 0.35s, 0s; }
  .figur-lader p { margin: 0; font-family: var(--schrift-kappen); font-size: 11px; letter-spacing: 0.13em; text-transform: uppercase; }
  .runenportal { position: relative; width: 184px; height: 184px; border: 1px solid rgba(222, 180, 59, 0.4); border-radius: 50%; box-shadow: 0 0 24px rgba(225, 177, 38, 0.16), inset 0 0 28px rgba(225, 177, 38, 0.1); animation: portal-atmen 2.2s ease-in-out infinite; }
  .runenportal::before, .runenportal::after { content: ''; position: absolute; border-radius: 50%; }
  .runenportal::before { inset: 14px; border: 1px dashed rgba(240, 204, 93, 0.48); animation: portal-drehen 14s linear infinite reverse; }
  .runenportal::after { inset: 52px; border: 1px solid rgba(240, 204, 93, 0.32); box-shadow: inset 0 0 18px rgba(240, 204, 93, 0.18); }
  .runenring { position: absolute; inset: 0; animation: portal-drehen 10s linear infinite; }
  .runenring span { position: absolute; top: 50%; left: 50%; color: #f0cf69; font-family: var(--schrift-kopf); font-size: 17px; transform: translate(-50%, -50%) rotate(var(--r)) translateY(-72px); transform-origin: center; }
  .runenkern { position: absolute; inset: 50% auto auto 50%; display: grid; place-items: center; width: 62px; height: 62px; border-radius: 50%; background: radial-gradient(circle, rgba(237, 197, 69, 0.2), transparent 68%); font-family: var(--schrift-kopf); font-size: 38px; font-style: normal; transform: translate(-50%, -50%); animation: runenkern-leuchten 1.65s ease-in-out infinite; }
  .figur-lader.fehler { color: #b98d72; }
  .figur-lader.fehler .runenportal, .figur-lader.fehler .runenportal::before, .figur-lader.fehler .runenkern, .figur-lader.fehler .runenring { animation-play-state: paused; }
  .figur-lader.fehler .runenportal { border-color: rgba(166, 91, 61, 0.45); box-shadow: 0 0 20px rgba(91, 34, 24, 0.2), inset 0 0 28px rgba(91, 34, 24, 0.12); }
  .figur-lader.fehler .runenring span, .figur-lader.fehler .runenkern { color: #b87559; }
  @keyframes portal-drehen { to { transform: rotate(360deg); } }
  @keyframes portal-atmen { 50% { border-color: rgba(255, 220, 102, 0.72); box-shadow: 0 0 44px rgba(225, 177, 38, 0.3), inset 0 0 36px rgba(225, 177, 38, 0.17); } }
  @keyframes runenkern-leuchten { 50% { opacity: 0.58; transform: translate(-50%, -50%) scale(0.9); } }
  canvas { position: absolute; inset: -28px -10px -36px; width: calc(100% + 20px); height: calc(100% + 64px); outline: none; background: transparent; cursor: grab; touch-action: none; opacity: 0; transition: opacity 0.3s ease; }
  .eng canvas { inset: 0; width: 100%; height: 100%; }
  canvas.bereit { opacity: 1; }
  canvas:active { cursor: grabbing; }
  .buehne-hinweis { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; color: #b8ad95; font-size: 12px; text-align: center; text-shadow: 0 2px 6px #000; pointer-events: none; }
  .buehne-hinweis.fertig { display: none; }
  .buehne-werkzeug { position: absolute; right: 12px; bottom: 34px; display: flex; gap: 5px; z-index: 3; }
  .eng .buehne-werkzeug { bottom: 8px; right: 8px; }
  .buehne-werkzeug button {
    display: grid; place-items: center; width: 34px; height: 34px; padding: 0; font-size: 14px; backdrop-filter: blur(5px);
    border: 1px solid rgba(169, 137, 63, 0.38);
    border-radius: 4px;
    background: rgba(22, 23, 24, 0.82);
    color: #c9bea6;
    cursor: pointer;
  }
  .buehne-werkzeug button:hover { border-color: var(--runengold); color: var(--runengold); }
  .buehne-werkzeug button:disabled { cursor: not-allowed; opacity: 0.52; }
  .buehne-werkzeug button.aktiv { border-color: var(--runengold); color: var(--runengold); background: rgba(182, 139, 37, 0.17); }

  /*
    Kopfmarkierung: dünner Ring in Runengold um den Kopf, mit einer kleinen
    Lupe am Rand. Ort und Größe kommen aus der Vorschau (--kopf-x/-y/-r in
    Pixeln, bezogen auf diese Bühne). Sichtbar, sobald die Figur steht,
    deutlicher über der Bühne und am deutlichsten über dem Kopf selbst. Nach
    dem ersten Kopf-Zoom der Sitzung zeigt die Seite sie nur noch beim
    Überfahren des Kopfes (Klasse `sichtbar`).
  */
  .kopf-marke {
    position: absolute;
    z-index: 2;
    left: var(--kopf-x, 50%);
    top: var(--kopf-y, 30%);
    width: calc(var(--kopf-r, 0px) * 2);
    height: calc(var(--kopf-r, 0px) * 2);
    transform: translate(-50%, -50%);
    border: 1px solid color-mix(in srgb, var(--runengold), transparent 35%);
    border-radius: 50%;
    box-shadow: 0 0 16px rgba(255, 215, 0, 0.1), inset 0 0 14px rgba(255, 215, 0, 0.06);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.35s ease;
  }
  /* Ohne gültige Kopfposition (Körperwechsel, vor dem ersten Bild): sofort weg, ohne Blende. */
  .kopf-marke:not(.gueltig) { opacity: 0; transition: none; animation: none; }
  .kopf-marke.sichtbar { opacity: 0.4; animation: kopf-puls 2.8s ease-in-out infinite; }
  .figur-buehne:hover .kopf-marke.sichtbar { opacity: 0.8; }
  .kopf-marke.sichtbar.ueber { opacity: 1; border-color: var(--runengold); }
  .kopf-marke svg {
    position: absolute;
    right: 8%;
    top: 8%;
    transform: translate(50%, -50%);
    box-sizing: content-box;
    padding: 4px;
    border: 1px solid color-mix(in srgb, var(--runengold), transparent 40%);
    border-radius: 50%;
    background: rgba(9, 11, 16, 0.78);
    color: var(--runengold);
  }
  @keyframes kopf-puls { 50% { transform: translate(-50%, -50%) scale(1.05); } }

  @media (max-width: 879px) {
    canvas { inset: 0; width: 100%; height: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .runenportal, .runenportal::before, .runenkern, .runenring { animation: none; }
    .kopf-marke { transition: none; }
    .kopf-marke.sichtbar { animation: none; }
  }
</style>
