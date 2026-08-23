<script lang="ts">
  import { page } from '$app/state';
  import { MOBILNAV, FAHRT } from './seiten';
  import Ikone from './Ikone.svelte';
  import { localeFrom, localizedPath, messages, stripLocale } from './i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const hier = $derived(stripLocale(page.url.pathname));

  /* Der Fahrt-Knopf sitzt in der Mitte: zwei Ziele links, zwei rechts. */
  const links = MOBILNAV.slice(0, 2);
  const rechts = MOBILNAV.slice(2);
</script>

<nav class="mobil-nav" aria-label={t['mobilnav.nav.aria']}>
  {#each links as s (s.pfad)}
    <a href={localizedPath(lang, s.pfad)} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{t[s.kurz ?? s.titel]}</span>
    </a>
  {/each}

  <a class="mobil-fahrt" href={localizedPath(lang, FAHRT)}>
    <span class="kreis"><Ikone name="segeln" /></span>
    <span class="nur-vorlesen">{t['mobilnav.fahrt.vorlesen']}</span>
  </a>

  {#each rechts as s (s.pfad)}
    <a href={localizedPath(lang, s.pfad)} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{t[s.kurz ?? s.titel]}</span>
    </a>
  {/each}
</nav>
