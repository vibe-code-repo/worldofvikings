<script lang="ts">
  import { page } from '$app/state';
  import { FAHRT } from './seiten';
  import {
    LOCALES,
    LOCALE_NAME,
    localeFrom,
    localizedPath,
    messages,
    stripLocale,
  } from './i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /* Die Adresse ohne Sprachpräfix — Ziel der Sprachlinks. */
  const hier = $derived(stripLocale(page.url.pathname));

  /**
   * Die sechs Links sind hier von Hand getippt und bleiben es: der Fuß ordnet
   * anders als die Kopfleiste (Halle/Recken statt einer Reihe). Das
   * Sprachpräfix hängt jetzt aber `localizedPath` an — ein vergessener Präfix
   * wäre nach der nginx-Umleitung KEIN 404, sondern ein stiller Sprung von
   * /en zurück nach /de, und das fiele niemandem auf.
   */
  const p = $derived.by(() => (pfad: string) => localizedPath(lang, pfad));
</script>

<footer class="fuss">
  <div class="mitte">
    <div>
      <div class="fuss-marke">{t['fuss.marke']}</div>
      <p>{t['fuss.beschreibung']}<br />world-of-vikings.com</p>
    </div>
    <div>
      <h3>{t['fuss.halle.ueberschrift']}</h3>
      <ul>
        <li><a href={p('/')}>{t['fuss.halle.start']}</a></li>
        <li><a href={p('/saga')}>{t['fuss.halle.saga']}</a></li>
        <li><a href={p('/karte')}>{t['fuss.halle.karte']}</a></li>
        <li><a class="fuss-spielen" href={p(FAHRT)}>{t['fuss.halle.spielen']}</a></li>
      </ul>
    </div>
    <div>
      <h3>{t['fuss.recken.ueberschrift']}</h3>
      <ul>
        <li><a href={p('/ruestkammer')}>{t['fuss.recken.ruestkammer']}</a></li>
        <li><a href={p('/ruhmeshalle')}>{t['fuss.recken.ruhmeshalle']}</a></li>
        <li><a href={p('/thing')}>{t['fuss.recken.thing']}</a></li>
      </ul>
    </div>
    <!--
      Der Sprachumschalter steht auch hier, nicht nur im Kopf: unterhalb von
      880 px ist die Kopfleiste ausgeblendet (siehe wov.css), und die
      Mobilleiste hat für einen fünften Punkt keinen Platz. Ohne diesen Block
      käme man auf dem Handy in keine andere Sprache.
    -->
    <div>
      <h3>{t['fuss.sprache.ueberschrift']}</h3>
      <ul>
        {#each LOCALES as l (l)}
          <li>
            <a href={localizedPath(l, hier)} hreflang={l} lang={l}>{LOCALE_NAME[l]}</a>
          </li>
        {/each}
      </ul>
    </div>
  </div>
  <p class="fuss-schluss">{t['fuss.schluss']}</p>
</footer>
