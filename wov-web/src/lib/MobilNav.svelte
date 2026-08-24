<script lang="ts">
  import { page } from '$app/state';
  import { MOBILNAV, FAHRT } from './seiten';
  import Ikone from './Ikone.svelte';
  import { localeFrom, localizedPath, messages, stripLocale } from './i18n';

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  const hier = $derived(stripLocale(page.url.pathname));

  /**
   * Der Fahrt-Knopf sitzt in der Mitte: zwei Ziele links, zwei rechts.
   *
   * Welche vier das sind, steht in `seiten.ts` — und es steht dort seit dem
   * Wiki NICHT mehr als Indexliste (`HAUPTNAV[4]`), sondern über den Pfad
   * geholt. Ein neuer Punkt in der Kopfleiste verschiebt diese Leiste
   * dadurch nicht mehr still.
   */
  const links = MOBILNAV.slice(0, 2);
  const rechts = MOBILNAV.slice(2);
</script>

<nav class="mobil-nav" aria-label={t['mobile_nav.nav.aria']}>
  {#each links as s (s.pfad)}
    <a href={localizedPath(lang, s.pfad)} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{t[s.kurz ?? s.titel]}</span>
    </a>
  {/each}

  <a class="mobil-fahrt" href={localizedPath(lang, FAHRT)}>
    <span class="kreis"><Ikone name="segeln" /></span>
    <span class="nur-vorlesen">{t['mobile_nav.voyage.label']}</span>
  </a>

  {#each rechts as s (s.pfad)}
    <a href={localizedPath(lang, s.pfad)} aria-current={hier === s.pfad ? 'page' : undefined}>
      <Ikone name={s.ikone ?? 'burg'} />
      <span>{t[s.kurz ?? s.titel]}</span>
    </a>
  {/each}
</nav>

<style>
  /*
    Der Entwurf „Rune & Iron“ kennt keine Mobilleiste — er ist für eine feste
    Schirmbreite gezeichnet und enthält kein einziges @media. Die Leiste
    bleibt deshalb, wie sie ist, und übernimmt vom Entwurf nur den Ton der
    Kopfleiste: durchscheinende Kohle statt voller Fläche, Gold als Glut auf
    dem offenen Punkt. Sie wegzulassen hiesse, unterhalb von 880 px gar keine
    Navigation mehr zu haben.
  */
  .mobil-nav {
    background: rgba(19, 19, 19, 0.86);
    backdrop-filter: blur(12px);
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.5);
  }

  .mobil-nav span {
    text-transform: uppercase;
  }

  .mobil-nav a {
    border-radius: 3px;
    transition:
      color 0.22s ease,
      text-shadow 0.22s ease;
  }

  .mobil-nav a[aria-current='page'] {
    text-shadow: 0 0 12px rgba(255, 215, 0, 0.45);
  }

  /* Derselbe Goldverlauf wie auf dem Hauptknopf des Entwurfs, statt der
     flachen Goldscheibe. */
  .mobil-fahrt .kreis {
    background: linear-gradient(
      180deg,
      var(--primaer) 0%,
      var(--primaer-behaelter) 55%,
      var(--gold-gradient-foot) 100%
    );
    box-shadow:
      inset 0 1px 0 var(--gold-gradient-sheen),
      0 0 20px rgba(255, 215, 0, 0.35);
  }
</style>
