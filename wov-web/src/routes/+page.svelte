<script lang="ts">
  import { onMount } from 'svelte';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import Ikone from '$lib/Ikone.svelte';
  import { datumLang, holeJson } from '$lib/formate';
  import type { Recke } from '$lib/recken';
  import { FAHRT } from '$lib/seiten';

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
  titel="World of Vikings — Ein Wikinger-Browserspiel"
  beschreibung="Angelsachsen gegen Wikinger. Ein Browserspiel ohne Download: Welt erkunden, bauen, die Wächter Midgards bezwingen."
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
        alt="Wappen von World of Vikings: ein Langschiff in einem Steinring aus Runen"
      />
      <h1 class="nur-vorlesen">World of Vikings</h1>
      <p class="held-unter">
        Angelsachsen gegen Wikinger. Eine Welt aus Wiesen, Schwarzwald und Sumpf, die im Browser
        läuft — kein Download, keine Anmeldung. Öffnen und loslaufen.
      </p>
      <div class="held-knoepfe">
        <!--
          Führt in die Charaktererstellung, nicht direkt ins Spiel. Kopfleiste
          und Mobilleiste taten das schon; dieser Knopf sprang noch an ihr
          vorbei und liess einen ohne Figurenwahl auflaufen.
        -->
        <a class="knopf knopf-gross" href={FAHRT}>
          <Ikone name="schwerter" />
          Auf Fahrt gehen
        </a>
        <a class="knopf knopf-gross knopf-schlicht" href="#welten">
          <Ikone name="kompass" />
          Die Welten sehen
        </a>
      </div>
    </div>

    <div class="band">
      <!--
        Ohne JavaScript bleibt der neutrale Text stehen. Lieber „unbekannt“ als
        eine Ampel, die Grün behauptet, während der Server aus ist.
      -->
      <span class="bifroest" data-zustand={midgard?.zustand}>
        <span class="ampel" aria-hidden="true"></span>
        <span>
          {#if midgard}
            {midgard.zustand === 'offen'
              ? `${midgard.name} offen — ${midgard.spieler} von ${midgard.plaetze} auf Fahrt`
              : `${midgard.name} geschlossen`}
          {:else}
            Bifröst — Zustand wird geprüft …
          {/if}
        </span>
      </span>
      <span class="band-nebensatz"><b>Früher Stand.</b> Die Welt ist im Aufbau.</span>
    </div>
  </section>

  <!-- ------------------------------------------------------ Was dich -->
  <section class="abschnitt">
    <div class="mitte">
      <div class="abschnitt-kopf">
        <span class="runen" aria-hidden="true">ᚹᛖᚷ</span>
        <h2>Was dich erwartet</h2>
      </div>

      <div class="gitter gitter-4">
        <article class="tafel kachel">
          <img class="kachel-bild" src="/assets/bilder/ik1.webp" width="480" height="512" alt="Bemalter Rundschild mit Rabenzeichen" />
          <h3>Neun Lande</h3>
          <p>
            Von den Wiesen über den Schwarzwald und den Sumpf bis in die Berge, die Ebenen und
            das Nebelland. Jedes Land hat eigenes Wetter, eigene Bewohner und eigene Wege, dich
            umzubringen.
          </p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(139,0,0,.14)">
          <img class="kachel-bild" src="/assets/bilder/ik2.webp" width="480" height="512" alt="Steinerner Schädel mit leuchtender Rune" />
          <h3>Fünf Wächter</h3>
          <p>
            Eikthyr, der Älteste, die Knochenmasse, Moder und Yagluth. Jeder gefallene Wächter
            öffnet das nächste Land — und trägt sich in deine Rüstkammer ein.
          </p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(195,204,140,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik3.webp" width="480" height="512" alt="Schmiedehammer über gekreuzten Balken" />
          <h3>Bauen, was bleibt</h3>
          <p>
            Langhaus, Werkbank, Hafen. Der Bau folgt echter Statik: Was nicht getragen wird,
            fällt. Was du in Midgard errichtest, steht auch morgen noch.
          </p>
        </article>

        <article class="tafel kachel" style="--kachel-schein:rgba(227,201,186,.12)">
          <img class="kachel-bild" src="/assets/bilder/ik4.webp" width="480" height="512" alt="Moosbewachsener Höhleneingang mit Fackeln" />
          <h3>Verliese mit Saat</h3>
          <p>
            Gruften und Höhlen entstehen aus gesetzter Saat mit echten Türen und Raumketten —
            bei jedem neu, aber für alle gleich.
          </p>
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
            <h3>Kein Konto, kein Client</h3>
          </div>
          <p style="color:var(--matt);margin:0">
            Der Browser ist der Client. Keine Installation, kein Ladebalken über Gigabyte — die
            Welt wird gestreamt, während du gehst.
          </p>

          <hr class="strich" />

          <div class="merkmal-kopf">
            <span class="ikonen-kasten" aria-hidden="true"><Ikone name="hammer" /></span>
            <h3>Ein ehrlicher Server</h3>
          </div>
          <p style="color:var(--matt);margin:0">
            Die Spielregeln liegen beim Server, nicht im Browser. Was dein Recke kann,
            entscheidet Midgard — nicht dein Rechner.
          </p>
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
              Die Welten
            </h4>
            <p style="color:var(--matt);font-size:14px">
              Midgard ist die bleibende Welt — was dort steht, bleibt stehen. Die Werkstatt ist
              zum Ausprobieren da und wird ohne Vorwarnung zurückgesetzt.
            </p>

            <div class="gitter">
              {#if weltenFehler}
                <p class="leer-zustand" style="padding:1.5rem 1rem">
                  Die Weltliste ist gerade nicht erreichbar.
                </p>
              {:else if welten === null}
                <p class="leer-zustand" style="padding:1.5rem 1rem">Die Weltliste wird geholt …</p>
              {:else}
                {#each welten as w (w.id)}
                  <article class="tafel">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap">
                      <h3 style="margin:0">{w.name}</h3>
                      <span class="bifroest" data-zustand={w.zustand}>
                        <span class="ampel" aria-hidden="true"></span>
                        {w.zustand === 'offen' ? 'offen' : 'geschlossen'}
                      </span>
                    </div>
                    <p style="color:var(--matt);font-size:.95rem;margin:.6rem 0 1rem">{w.beschreibung}</p>
                    <div class="werte">
                      <div class="wert"><b>{w.spieler}/{w.plaetze}</b><span>auf Fahrt</span></div>
                      <div class="wert"><b>{w.weltzeit}</b><span>Weltzeit</span></div>
                      <div class="wert"><b>{w.art}</b><span>Art</span></div>
                    </div>
                    <p style="color:var(--matt);font-size:.85rem;margin:1rem 0 0">
                      Wetter: {w.wetter} · Saat: <code>{w.saat}</code>
                    </p>
                  </article>
                {/each}
              {/if}
            </div>

            <p style="margin:1.2rem 0 0">
              <a href="/karte" class="kappen">Beide Welten auf der Karte ansehen ›</a>
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
            Aus der Ruhmeshalle
          </h2>
          <div class="tafel tafel-tabelle">
            <div class="rollbar">
              <table class="tabelle">
                <thead>
                  <tr>
                    <th class="zahl">#</th><th>Recke</th><th>Sippe</th><th class="zahl">Runenrang</th>
                  </tr>
                </thead>
                <tbody>
                  {#if recken2Fehler}
                    <tr><td colspan="4">Die Tafel ist gerade verhängt.</td></tr>
                  {:else if beste === null}
                    <tr><td colspan="4">wird geholt …</td></tr>
                  {:else}
                    {#each beste as r, i (r.id)}
                      <tr>
                        <td class="zahl rang rang-{i + 1}">{i + 1}</td>
                        <td>
                          <a href="/ruestkammer?reck={encodeURIComponent(r.id)}">{r.name}</a>
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
            <a href="/ruhmeshalle" class="kappen">Die ganze Tafel ansehen ›</a>
          </p>
        </div>

        <div>
          <h2 style="display:flex;align-items:center;gap:.75rem;margin-top:2rem">
            <Ikone name="forum" />
            Das Thing wird einberufen
          </h2>
          <div class="tafel" style="padding:2rem">
            <span
              aria-hidden="true"
              style="position:absolute;top:1rem;right:1rem;color:var(--umriss-matt);opacity:.12"
            >
              <Ikone name="blase" klasse="ikone ikone-deko" />
            </span>
            <p style="color:var(--matt);position:relative;margin-bottom:1.6rem">
              Beim Thing versammelten sich die Freien, um zu beraten und zu richten. Unseres wird
              das Forum: ein Ort für Bauwerke, Fundstücke, Streit über Ausrüstung und die Frage,
              wer als Nächstes gegen Moder zieht.
            </p>
            <a class="knopf" href="/thing">Was dort entstehen soll</a>
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
        <h2>Neues aus Midgard</h2>
      </div>
      <div class="gitter gitter-3">
        {#if sagaFehler}
          <p class="leer-zustand">Die Saga schweigt gerade.</p>
        {:else if saga === null}
          <p class="leer-zustand">wird geholt …</p>
        {:else}
          {#each saga as e (e.datum + e.titel)}
            <article class="tafel-matt">
              <div style="color:var(--met);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase">
                {e.art} · {datumLang(e.datum)}
              </div>
              <h3 style="margin:.4rem 0 .5rem">{e.titel}</h3>
              <p style="color:var(--matt);font-size:.95rem;margin:0">{e.text}</p>
            </article>
          {/each}
        {/if}
      </div>
      <p style="margin-top:1.6rem;text-align:center">
        <a href="/saga" class="kappen">Die ganze Saga lesen ›</a>
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
