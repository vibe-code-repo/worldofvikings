<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import Ikone from '$lib/Ikone.svelte';
  import { datumLang, holeJson } from '$lib/formate';
  import type { Recke } from '$lib/recken';
  import { FAHRT } from '$lib/seiten';
  import { localeFrom, localizedPath, messages } from '$lib/i18n';

  interface Welt {
    id: string;
    name: string;
    zustand: string;
    beschreibung: string;
    spieler: number;
    plaetze: number;
    weltzeit: string;
    art: string;
    wetter: string;
    saat: string;
  }
  interface Sagaeintrag { art: string; datum: string; titel: string; text: string }

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /* Alle Ziele dieser Seite tragen das Sprachpräfix — sonst spränge man aus
     /en/ still zurück nach /de/, und nach der nginx-Umleitung wäre das keine
     404, sondern nur ein falscher Sprachwechsel. */
  const p = $derived.by(() => (pfad: string) => localizedPath(lang, pfad));

  /*
    Die drei Blöcke holen ihre Daten einzeln und scheitern einzeln — fällt die
    Saga aus, steht die Weltliste trotzdem. Deshalb kein gemeinsames await.
  */
  let welten = $state<Welt[] | null>(null);
  let weltenFehler = $state(false);

  let beste = $state<Recke[] | null>(null);
  let recken2Fehler = $state(false);

  let saga = $state<Sagaeintrag[] | null>(null);
  let sagaFehler = $state(false);

  /** Zustand von Midgard für die Statusleiste im Held. */
  const midgard = $derived(welten?.find((w) => w.id === 'midgard') ?? welten?.[0] ?? null);

  onMount(() => {
    void (async () => {
      try {
        welten = (await holeJson<{ welten?: Welt[] }>('/api/welt.json')).welten ?? [];
      } catch (e) { console.warn(e); weltenFehler = true; }
    })();

    void (async () => {
      try {
        const alle = (await holeJson<{ recken?: Recke[] }>('/api/recken.json')).recken ?? [];
        beste = [...alle].sort((a, b) => b.stufe - a.stufe).slice(0, 5);
      } catch (e) { console.warn(e); recken2Fehler = true; }
    })();

    void (async () => {
      try {
        saga = ((await holeJson<{ eintraege?: Sagaeintrag[] }>('/api/saga.json')).eintraege ?? []).slice(0, 3);
      } catch (e) { console.warn(e); sagaFehler = true; }
    })();
  });
</script>

<Kopfdaten
  blankerTitel
  titel={t['halle.kopf.titel']}
  beschreibung={t['halle.kopf.beschreibung']}
/>

<main>
  <!-- ------------------------------------------------------------- Held -->
  <section class="held">
    <div class="held-bild" aria-hidden="true">
      <img src="/assets/bilder/held.webp" alt="" width="1376" height="768" fetchpriority="high" />
    </div>

    <div class="held-inhalt">
      <img
        class="held-wappen"
        src="/assets/bilder/wappen.webp"
        width="768"
        height="768"
        alt={t['halle.held.wappen_alt']}
      />
      <h1 class="nur-vorlesen">{t['halle.held.h1']}</h1>
      <p class="held-unter">{t['halle.held.unter']}</p>
      <div class="held-knoepfe">
        <!--
          Führt in die Charaktererstellung, nicht direkt ins Spiel. Kopfleiste
          und Mobilleiste taten das schon; dieser Knopf sprang noch an ihr
          vorbei und liess einen ohne Figurenwahl auflaufen.
        -->
        <a class="knopf knopf-gross" href={p(FAHRT)}>
          <Ikone name="schwerter" />
          {t['halle.held.knopf.fahrt']}
        </a>
        <a class="knopf knopf-gross knopf-schlicht" href="#welten">
          <Ikone name="kompass" />
          {t['halle.held.knopf.welten']}
        </a>
      </div>
    </div>

    <div class="band">
      <!--
        Ohne JavaScript bleibt der neutrale Text stehen. Lieber „unbekannt“ als
        eine Ampel, die Grün behauptet, während der Server aus ist.

        Weltname und Zahlen stehen NEBEN den Textbausteinen, nicht in ihnen:
        „Midgard offen — 3 von 20 auf Fahrt“ ist im Katalog vier kurze Wörter
        und kein Satz mit Platzhaltern, die jemand falsch zählen könnte.
      -->
      <span class="bifroest" data-zustand={midgard?.zustand}>
        <span class="ampel" aria-hidden="true"></span>
        <span>
          {#if midgard}
            {#if midgard.zustand === 'offen'}
              {midgard.name}
              {t['halle.held.band.offen']} — {midgard.spieler}
              {t['halle.held.band.von']}
              {midgard.plaetze}
              {t['halle.held.band.auf_fahrt']}
            {:else}
              {midgard.name} {t['halle.held.band.geschlossen']}
            {/if}
          {:else}
            {t['halle.held.band.wird_geprueft']}
          {/if}
        </span>
      </span>
      <span class="band-nebensatz"
        ><b>{t['halle.held.band.frueher_stand']}</b> {t['halle.held.band.aufbau']}</span
      >
    </div>
  </section>

  <!-- ------------------------------------------------------ Was dich -->
  <section class="abschnitt">
    <div class="mitte">
      <div class="abschnitt-kopf">
        <span class="runen" aria-hidden="true">ᚹᛖᚷ</span>
        <h2>{t['halle.erwartet.kopf']}</h2>
      </div>

      <div class="gitter gitter-4">
        <article class="tafel kachel">
          <img class="kachel-bild" src="/assets/bilder/ik1.webp" width="480" height="512" alt={t['halle.erwartet.neun_lande.bild_alt']} />
          <h3>{t['halle.erwartet.neun_lande.titel']}</h3>
          <p>{t['halle.erwartet.neun_lande.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(139,0,0,.14)">
          <img class="kachel-bild" src="/assets/bilder/ik2.webp" width="480" height="512" alt={t['halle.erwartet.fuenf_waechter.bild_alt']} />
          <h3>{t['halle.erwartet.fuenf_waechter.titel']}</h3>
          <p>{t['halle.erwartet.fuenf_waechter.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(195,204,140,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik3.webp" width="480" height="512" alt={t['halle.erwartet.bauen.bild_alt']} />
          <h3>{t['halle.erwartet.bauen.titel']}</h3>
          <p>{t['halle.erwartet.bauen.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(227,201,186,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik4.webp" width="480" height="512" alt={t['halle.erwartet.verliese.bild_alt']} />
          <h3>{t['halle.erwartet.verliese.titel']}</h3>
          <p>{t['halle.erwartet.verliese.text']}</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ------------------------------------------------- Technik & Welten -->
  <section class="parallax" id="welten">
    <div class="mitte">
      <div class="parallax-gitter">
        <div class="tafel" style="background:rgba(19,19,19,.9);backdrop-filter:blur(6px);padding:2rem">
          <div class="merkmal-kopf">
            <span class="ikonen-kasten" aria-hidden="true"><Ikone name="welt" /></span>
            <h3>{t['halle.technik.kein_konto.titel']}</h3>
          </div>
          <p style="color:var(--matt);margin:0">{t['halle.technik.kein_konto.text']}</p>

          <hr class="strich" />

          <div class="merkmal-kopf">
            <span class="ikonen-kasten" aria-hidden="true"><Ikone name="hammer" /></span>
            <h3>{t['halle.technik.ehrlicher_server.titel']}</h3>
          </div>
          <p style="color:var(--matt);margin:0">{t['halle.technik.ehrlicher_server.text']}</p>
        </div>

        <div>
          <div
            class="runen"
            aria-hidden="true"
            style="font-size:clamp(22px,3vw,34px);text-align:right;margin-bottom:1.4rem;opacity:.4"
          >
            ᛗᛁᛞᚷᚨᚱᛞ
          </div>

          <div class="tafel-matt" style="backdrop-filter:blur(6px)">
            <h4
              style="color:var(--runengold);font-family:var(--schrift-kappen);font-size:12px;letter-spacing:.1em;text-transform:uppercase;display:flex;align-items:center;gap:.5rem"
            >
              <Ikone name="kreis" klasse="ikone" />
              {t['halle.welten.titel']}
            </h4>
            <p style="color:var(--matt);font-size:14px">{t['halle.welten.text']}</p>

            <div class="gitter">
              {#if weltenFehler}
                <p class="leer-zustand" style="padding:1.5rem 1rem">{t['halle.welten.fehler']}</p>
              {:else if welten === null}
                <p class="leer-zustand" style="padding:1.5rem 1rem">{t['halle.welten.laedt']}</p>
              {:else}
                {#each welten as w (w.id)}
                  <article class="tafel">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap">
                      <h3 style="margin:0">{w.name}</h3>
                      <span class="bifroest" data-zustand={w.zustand}>
                        <span class="ampel" aria-hidden="true"></span>
                        {w.zustand === 'offen'
                          ? t['halle.welten.zustand_offen']
                          : t['halle.welten.zustand_geschlossen']}
                      </span>
                    </div>
                    <p style="color:var(--matt);font-size:.95rem;margin:.6rem 0 1rem">{w.beschreibung}</p>
                    <div class="werte">
                      <div class="wert">
                        <b>{w.spieler}/{w.plaetze}</b><span>{t['halle.welten.wert.auf_fahrt']}</span>
                      </div>
                      <div class="wert">
                        <b>{w.weltzeit}</b><span>{t['halle.welten.wert.weltzeit']}</span>
                      </div>
                      <div class="wert"><b>{w.art}</b><span>{t['halle.welten.wert.art']}</span></div>
                    </div>
                    <p style="color:var(--matt);font-size:.85rem;margin:1rem 0 0">
                      {t['halle.welten.wetter_label']}
                      {w.wetter} · {t['halle.welten.saat_label']} <code>{w.saat}</code>
                    </p>
                  </article>
                {/each}
              {/if}
            </div>

            <p style="margin:1.2rem 0 0">
              <a href={p('/karte')} class="kappen">{t['halle.welten.karte_link']}</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ------------------------------------------------ Ruhmeshalle & Thing -->
  <section class="abschnitt">
    <div class="mitte">
      <div class="gitter gitter-2" style="gap:4rem">
        <div>
          <span class="runen" aria-hidden="true" style="display:block;font-size:18px;margin-bottom:.5rem">ᚱᚢᚺᛗ</span>
          <h2 style="display:flex;align-items:center;gap:.75rem">
            <Ikone name="pokal" />
            {t['halle.ruhmeshalle.titel']}
          </h2>
          <div class="tafel tafel-tabelle">
            <div class="rollbar">
              <table class="tabelle">
                <thead>
                  <tr>
                    <th class="zahl">{t['halle.ruhmeshalle.spalte.raute']}</th>
                    <th>{t['halle.ruhmeshalle.spalte.recke']}</th>
                    <th>{t['halle.ruhmeshalle.spalte.sippe']}</th>
                    <th class="zahl">{t['halle.ruhmeshalle.spalte.runenrang']}</th>
                  </tr>
                </thead>
                <tbody>
                  {#if recken2Fehler}
                    <tr><td colspan="4">{t['halle.ruhmeshalle.fehler']}</td></tr>
                  {:else if beste === null}
                    <tr><td colspan="4">{t['halle.ruhmeshalle.laedt']}</td></tr>
                  {:else}
                    {#each beste as r, i (r.id)}
                      <tr>
                        <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                        <td>
                          <a href="{p('/ruestkammer')}?reck={encodeURIComponent(r.id)}">{r.name}</a>
                          <span style="color:var(--matt)"> {r.beiname}</span>
                        </td>
                        <td style="color:var(--matt)">{r.sippe}</td>
                        <td class="zahl">{r.stufe}</td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>
          </div>
          <p style="margin:1.2rem 0 0">
            <a href={p('/ruhmeshalle')} class="kappen">{t['halle.ruhmeshalle.link']}</a>
          </p>
        </div>

        <div>
          <h2 style="display:flex;align-items:center;gap:.75rem;margin-top:2rem">
            <Ikone name="forum" />
            {t['halle.thing.titel']}
          </h2>
          <div class="tafel" style="padding:2rem">
            <span
              aria-hidden="true"
              style="position:absolute;top:1rem;right:1rem;color:var(--umriss-matt);opacity:.12"
            >
              <Ikone name="blase" klasse="ikone ikone-deko" />
            </span>
            <p style="color:var(--matt);position:relative;margin-bottom:1.6rem">
              {t['halle.thing.text']}
            </p>
            <a class="knopf" href={p('/thing')}>{t['halle.thing.knopf']}</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ------------------------------------------------------- Saga-Anriss -->
  <section class="abschnitt" style="padding-top:0">
    <div class="mitte">
      <div class="abschnitt-kopf">
        <span class="runen" aria-hidden="true">ᛊᚨᚷᚨ</span>
        <h2>{t['halle.saga_anriss.titel']}</h2>
      </div>
      <div class="gitter gitter-3">
        {#if sagaFehler}
          <p class="leer-zustand">{t['halle.saga_anriss.fehler']}</p>
        {:else if saga === null}
          <p class="leer-zustand">{t['halle.saga_anriss.laedt']}</p>
        {:else}
          {#each saga as e (e.datum + e.titel)}
            <article class="tafel-matt">
              <div style="color:var(--met);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase">
                {e.art} · {datumLang(e.datum, lang)}
              </div>
              <h3 style="margin:.4rem 0 .5rem">{e.titel}</h3>
              <p style="color:var(--matt);font-size:.95rem;margin:0">{e.text}</p>
            </article>
          {/each}
        {/if}
      </div>
      <p style="margin-top:1.6rem;text-align:center">
        <a href={p('/saga')} class="kappen">{t['halle.saga_anriss.link']}</a>
      </p>
    </div>
  </section>
</main>

<style>
  /* Die Deko-Sprechblase im Thing-Kasten ist gross und blass — sie gehört
     nicht in wov.css, weil sie nur hier vorkommt. */
  :global(.ikone-deko) {
    width: 64px;
    height: 64px;
  }
</style>
