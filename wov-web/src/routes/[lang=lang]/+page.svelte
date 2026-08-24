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
  titel={t['hall.meta.title']}
  beschreibung={t['hall.meta.description']}
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
        alt={t['hall.hero.crest_alt']}
      />
      <h1 class="nur-vorlesen">{t['hall.hero.heading']}</h1>
      <p class="held-unter">{t['hall.hero.subtitle']}</p>
      <div class="held-knoepfe">
        <!--
          Führt in die Charaktererstellung, nicht direkt ins Spiel. Kopfleiste
          und Mobilleiste taten das schon; dieser Knopf sprang noch an ihr
          vorbei und liess einen ohne Figurenwahl auflaufen.
        -->
        <a class="knopf knopf-gross" href={p(FAHRT)}>
          <Ikone name="schwerter" />
          {t['hall.hero.button.voyage']}
        </a>
        <a class="knopf knopf-gross knopf-schlicht" href="#welten">
          <Ikone name="kompass" />
          {t['hall.hero.button.worlds']}
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
              {t['hall.hero.ribbon.open']} — {midgard.spieler}
              {t['hall.hero.ribbon.of']}
              {midgard.plaetze}
              {t['hall.hero.ribbon.underway']}
            {:else}
              {midgard.name} {t['hall.hero.ribbon.closed']}
            {/if}
          {:else}
            {t['hall.hero.ribbon.checking']}
          {/if}
        </span>
      </span>
      <span class="band-nebensatz"
        ><b>{t['hall.hero.ribbon.early_days']}</b> {t['hall.hero.ribbon.under_construction']}</span
      >
    </div>
  </section>

  <!-- ------------------------------------------------------ Was dich -->
  <section class="abschnitt">
    <div class="mitte">
      <div class="abschnitt-kopf">
        <span class="runen" aria-hidden="true">ᚹᛖᚷ</span>
        <h2>{t['hall.awaits.heading']}</h2>
      </div>

      <div class="gitter gitter-4">
        <article class="tafel kachel">
          <img class="kachel-bild" src="/assets/bilder/ik1.webp" width="480" height="512" alt={t['hall.awaits.nine_lands.image_alt']} />
          <h3>{t['hall.awaits.nine_lands.title']}</h3>
          <p>{t['hall.awaits.nine_lands.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(139,0,0,.14)">
          <img class="kachel-bild" src="/assets/bilder/ik2.webp" width="480" height="512" alt={t['hall.awaits.five_guardians.image_alt']} />
          <h3>{t['hall.awaits.five_guardians.title']}</h3>
          <p>{t['hall.awaits.five_guardians.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(195,204,140,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik3.webp" width="480" height="512" alt={t['hall.awaits.building.image_alt']} />
          <h3>{t['hall.awaits.building.title']}</h3>
          <p>{t['hall.awaits.building.text']}</p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(227,201,186,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik4.webp" width="480" height="512" alt={t['hall.awaits.dungeons.image_alt']} />
          <h3>{t['hall.awaits.dungeons.title']}</h3>
          <p>{t['hall.awaits.dungeons.text']}</p>
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
            <h3>{t['hall.technology.no_account.title']}</h3>
          </div>
          <p style="color:var(--matt);margin:0">{t['hall.technology.no_account.text']}</p>

          <hr class="strich" />

          <div class="merkmal-kopf">
            <span class="ikonen-kasten" aria-hidden="true"><Ikone name="hammer" /></span>
            <h3>{t['hall.technology.honest_server.title']}</h3>
          </div>
          <p style="color:var(--matt);margin:0">{t['hall.technology.honest_server.text']}</p>
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
              {t['hall.worlds.title']}
            </h4>
            <p style="color:var(--matt);font-size:14px">{t['hall.worlds.text']}</p>

            <div class="gitter">
              {#if weltenFehler}
                <p class="leer-zustand" style="padding:1.5rem 1rem">{t['hall.worlds.error']}</p>
              {:else if welten === null}
                <p class="leer-zustand" style="padding:1.5rem 1rem">{t['hall.worlds.loading']}</p>
              {:else}
                {#each welten as w (w.id)}
                  <article class="tafel">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap">
                      <h3 style="margin:0">{w.name}</h3>
                      <span class="bifroest" data-zustand={w.zustand}>
                        <span class="ampel" aria-hidden="true"></span>
                        {w.zustand === 'offen'
                          ? t['hall.worlds.state_open']
                          : t['hall.worlds.state_closed']}
                      </span>
                    </div>
                    <p style="color:var(--matt);font-size:.95rem;margin:.6rem 0 1rem">{w.beschreibung}</p>
                    <div class="werte">
                      <div class="wert">
                        <b>{w.spieler}/{w.plaetze}</b><span>{t['hall.worlds.value.underway']}</span>
                      </div>
                      <div class="wert">
                        <b>{w.weltzeit}</b><span>{t['hall.worlds.value.world_time']}</span>
                      </div>
                      <div class="wert"><b>{w.art}</b><span>{t['hall.worlds.value.type']}</span></div>
                    </div>
                    <p style="color:var(--matt);font-size:.85rem;margin:1rem 0 0">
                      {t['hall.worlds.weather_label']}
                      {w.wetter} · {t['hall.worlds.seed_label']} <code>{w.saat}</code>
                    </p>
                  </article>
                {/each}
              {/if}
            </div>

            <p style="margin:1.2rem 0 0">
              <a href={p('/karte')} class="kappen">{t['hall.worlds.map_link']}</a>
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
            {t['hall.hall_of_fame.title']}
          </h2>
          <div class="tafel tafel-tabelle">
            <div class="rollbar">
              <table class="tabelle">
                <thead>
                  <tr>
                    <th class="zahl">{t['hall.hall_of_fame.column.hash']}</th>
                    <th>{t['hall.hall_of_fame.column.character']}</th>
                    <th>{t['hall.hall_of_fame.column.clan']}</th>
                    <th class="zahl">{t['hall.hall_of_fame.column.rune_rank']}</th>
                  </tr>
                </thead>
                <tbody>
                  {#if recken2Fehler}
                    <tr><td colspan="4">{t['hall.hall_of_fame.error']}</td></tr>
                  {:else if beste === null}
                    <tr><td colspan="4">{t['hall.hall_of_fame.loading']}</td></tr>
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
            <a href={p('/ruhmeshalle')} class="kappen">{t['hall.hall_of_fame.link']}</a>
          </p>
        </div>

        <div>
          <h2 style="display:flex;align-items:center;gap:.75rem;margin-top:2rem">
            <Ikone name="forum" />
            {t['hall.thing.title']}
          </h2>
          <div class="tafel" style="padding:2rem">
            <span
              aria-hidden="true"
              style="position:absolute;top:1rem;right:1rem;color:var(--umriss-matt);opacity:.12"
            >
              <Ikone name="blase" klasse="ikone ikone-deko" />
            </span>
            <p style="color:var(--matt);position:relative;margin-bottom:1.6rem">
              {t['hall.thing.text']}
            </p>
            <a class="knopf" href={p('/thing')}>{t['hall.thing.button']}</a>
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
        <h2>{t['hall.saga_teaser.title']}</h2>
      </div>
      <div class="gitter gitter-3">
        {#if sagaFehler}
          <p class="leer-zustand">{t['hall.saga_teaser.error']}</p>
        {:else if saga === null}
          <p class="leer-zustand">{t['hall.saga_teaser.loading']}</p>
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
        <a href={p('/saga')} class="kappen">{t['hall.saga_teaser.link']}</a>
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
