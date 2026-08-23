<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { type MessageKey, localeFrom, localizedPath, messages } from '$lib/i18n';
  import {
    ApiError,
    SHORE_IDS,
    SHORE_LABEL,
    type ShoreId,
    anmelden,
    errorMessageKey,
    readShore,
    writeShore,
    writeToken,
  } from '$lib/konto';
  import '$lib/stil/konto.css';

  /**
   * Anmelden.
   *
   * Aufbau und Begründungen wie bei `/registrieren`: kein natives Absenden
   * (vorgerenderte Datei, CSP `form-action: 'self'`), der Knopf erscheint
   * erst mit JavaScript, und `method="post"` sorgt dafür, dass ein Passwort
   * selbst im unmöglichen Fall nicht in die Adresszeile geraten kann.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * Hinweis nach einem abgelaufenen Token.
   *
   * `/erstellen` und `/konto` schicken bei einer 401 hierher und hängen
   * `?abgelaufen=1` an — kein Zugangsnachweis, nur eine Begründung, warum
   * man plötzlich wieder hier steht. Im vorgerenderten HTML steht die
   * Adresse ohne Parameter, der Hinweis fehlt dort also; er ist ein Zusatz
   * zur Erklärung und trägt keinen Inhalt, den es sonst nirgends gäbe.
   *
   * `browser &&` ist Pflicht, nicht Vorsicht: Beim Vorrendern wirft der
   * Zugriff auf `url.searchParams` («Cannot access url.searchParams on a
   * page with prerendering enabled»), und der Build bleibt stehen. Er MUSS
   * dort werfen — zur Bauzeit gibt es keine Anfrage, aus der ein Parameter
   * kommen könnte, und eine Datei kann nicht für jeden Parameterwert eine
   * andere sein.
   */
  const abgelaufen = $derived(browser && page.url.searchParams.get('abgelaufen') === '1');

  let bereit = $state(false);
  let laeuft = $state(false);

  let gestade = $state<ShoreId>('dev');
  let benutzername = $state('');
  let passwort = $state('');
  let fehler = $state<MessageKey | null>(null);

  onMount(() => {
    bereit = true;
    gestade = readShore() ?? 'dev';
  });

  function gestadeGemerkt() {
    writeShore(gestade);
  }

  async function absenden(e: SubmitEvent) {
    e.preventDefault();
    if (laeuft) return;
    fehler = null;
    laeuft = true;
    try {
      const antwort = await anmelden(gestade, benutzername.trim(), passwort);
      writeToken(gestade, antwort.token);
      writeShore(gestade);
      passwort = '';
      /*
        Wer noch keinen Recken hat, will keine leere Liste sehen, sondern
        einen erschaffen. Wer welche hat, will wählen. Die Antwort der
        Anmeldung sagt beides bereits — ein zweiter Aufruf wäre nur Wartezeit.
      */
      await goto(localizedPath(lang, antwort.charaktere.length ? '/konto' : '/erstellen'));
    } catch (err) {
      fehler = err instanceof ApiError ? errorMessageKey(err.key) : 'konto.fehler.unerwartet';
      laeuft = false;
    }
  }
</script>

<Kopfdaten titel={t['anmelden.kopf.titel']} beschreibung={t['anmelden.kopf.beschreibung']} noindex />

<main class="mitte seite">
  <div class="konto-schmal">
    <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['anmelden.ueberschrift']}</h1>
    <p style="color:var(--matt)">{t['anmelden.einleitung']}</p>

    {#if abgelaufen}
      <div class="hinweis" style="margin:1.2rem 0">{t['anmelden.abgelaufen']}</div>
    {/if}

    <div class="konto-tafel" style="margin-top:1.5rem">
      <form method="post" onsubmit={absenden}>
        <div class="konto-feld">
          <label class="konto-name" for="an-gestade">{t['erstellen.fahrt.gestade.label']}</label>
          <select
            class="konto-eingabe"
            id="an-gestade"
            bind:value={gestade}
            onchange={gestadeGemerkt}
          >
            {#each SHORE_IDS as s (s)}
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
            {/each}
          </select>
          <p class="konto-hilfe">{t['konto.gestade.hilfe']}</p>
        </div>

        <div class="konto-feld">
          <label class="konto-name" for="an-name">{t['anmelden.benutzername.label']}</label>
          <input
            class="konto-eingabe"
            id="an-name"
            type="text"
            name="benutzername"
            autocomplete="username"
            maxlength="24"
            bind:value={benutzername}
          />
        </div>

        <div class="konto-feld">
          <label class="konto-name" for="an-passwort">{t['anmelden.passwort.label']}</label>
          <input
            class="konto-eingabe"
            id="an-passwort"
            type="password"
            name="passwort"
            autocomplete="current-password"
            maxlength="200"
            bind:value={passwort}
          />
        </div>

        {#if fehler}
          <p class="konto-melder" role="alert">{t[fehler]}</p>
        {/if}

        <div class="konto-tat">
          {#if bereit}
            <button class="knopf" type="submit" disabled={laeuft}>
              {laeuft ? t['anmelden.knopf.laeuft'] : t['anmelden.knopf']}
            </button>
          {:else}
            <p class="konto-hilfe" style="margin:0">{t['konto.ohne_js']}</p>
          {/if}
        </div>
      </form>

      <p class="konto-wechsel">
        {t['anmelden.wechsel.text']}
        <a href={localizedPath(lang, '/registrieren')}>{t['anmelden.wechsel.link']}</a>
      </p>
    </div>
  </div>
</main>
