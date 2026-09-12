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
    SHORE_OPEN,
    type ShoreId,
    errorMessageKey,
    isShore,
    login,
    readShore,
    shoreStatus,
    writeAccountName,
    writeShore,
    writeToken,
  } from '$lib/account';
  import '$lib/stil/account.css';

  /**
   * Signing in.
   *
   * Structure and reasoning as on `/registrieren`: no native submit
   * (prerendered file, CSP `form-action: 'self'`), the button only appears
   * with JavaScript, and `method="post"` makes sure a password cannot end up
   * in the address bar even in the impossible case.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /**
   * The notice after an expired token.
   *
   * `/erstellen` and `/konto` send you here on a 401 and append
   * `?abgelaufen=1` — no credential, only a reason why you are suddenly
   * standing here again. The prerendered HTML holds the address without the
   * parameter, so the notice is absent there; it is an addition to the
   * explanation and carries nothing that exists nowhere else.
   *
   * `browser &&` is mandatory, not caution: during prerendering, reading
   * `url.searchParams` throws («Cannot access url.searchParams on a page
   * with prerendering enabled») and the build stops. It MUST throw there —
   * at build time there is no request a parameter could come from, and one
   * file cannot be a different file for every parameter value.
   */
  const expired = $derived(browser && page.url.searchParams.get('abgelaufen') === '1');

  /**
   * Where to send the visitor after signing in, on top of the usual
   * `/konto` or `/erstellen` choice below.
   *
   * `client/src/main.ts` appends this when it sends a visitor here for the
   * first time (same-origin install, no session yet) so that the merged
   * origin can return them to the game instead of stranding them on the
   * account page. Carried forward as a query parameter rather than acted
   * on here: only `enterGame` (`$lib/account.ts`) knows whether this
   * shore is even the same origin, and only it validates the value before
   * using it.
   */
  const weiter = $derived(browser ? page.url.searchParams.get('weiter') : null);

  let ready = $state(false);
  let running = $state(false);

  let shore = $state<ShoreId>('dev');
  let username = $state('');
  let password = $state('');
  let error = $state<MessageKey | null>(null);

  onMount(() => {
    ready = true;
    // Ein Server, der keine Konten annimmt, kommt auch aus der Adresse nicht
    // ins Feld — sonst stünde das Auswahlfeld auf einem Eintrag, den es im
    // selben Atemzug als „noch nicht offen“ ausweist.
    const requestedShore = page.url.searchParams.get('shore');
    shore =
      isShore(requestedShore) && SHORE_OPEN[requestedShore]
        ? requestedShore
        : readShore() ?? 'dev';
  });

  function shoreRemembered() {
    writeShore(shore);
  }

  /**
   * Whether the selected shore still offers the standard account
   * (`server.yml` `standard-konto:` — `KontoApi.status()`).
   *
   * Not derived from anything else: the hint text below states the
   * default username AND password from memory ("gast"/"gast"), not from
   * this call — `/accounts/status` deliberately never carries the
   * password (see `ShoreStatus` in `account.ts`). This flag only decides
   * WHETHER to show that fixed sentence, so an operator who keeps the
   * block but changes the password would need to adjust this page's text
   * too; the README asks them to remove the block instead for exactly
   * that reason.
   */
  let tryItOutHint = $state(false);

  $effect(() => {
    // Re-run whenever `shore` changes (shore picker, or the ?shore= /
    // remembered-shore assignment in onMount above).
    const gefragtesGestade = shore;
    if (!browser || !SHORE_OPEN[gefragtesGestade]) {
      tryItOutHint = false;
      return;
    }
    let abgebrochen = false;
    void (async () => {
      try {
        const status = await shoreStatus(gefragtesGestade);
        if (!abgebrochen) tryItOutHint = Boolean(status.standardKonto);
      } catch {
        // Ein nicht erreichbares Gestade zeigt keinen Hinweis -- dieselbe
        // Zurueckhaltung wie beim Server-Fehler weiter unten im Formular.
        if (!abgebrochen) tryItOutHint = false;
      }
    })();
    return () => { abgebrochen = true; };
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (running) return;
    error = null;
    running = true;
    try {
      const answer = await login(shore, username.trim(), password);
      writeToken(shore, answer.token);
      writeShore(shore);
      // Für die Kopfleiste, die auf jeder Seite steht und den Namen sonst
      // einzeln beim Gestade erfragen müsste — Begründung in `account.ts`.
      writeAccountName(shore, answer.account.username);
      password = '';
      /*
        Whoever has no character yet does not want to see an empty list but
        to create one. Whoever has some wants to choose. The sign-in answer
        already says both — a second call would be nothing but waiting time.
      */
      const ziel = localizedPath(lang, answer.characters.length ? '/konto' : '/erstellen');
      await goto(weiter ? `${ziel}?weiter=${encodeURIComponent(weiter)}` : ziel);
    } catch (err) {
      error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
      running = false;
    }
  }
</script>

<Kopfdaten titel={t['login.meta.title']} beschreibung={t['login.meta.description']} noindex />

<main class="mitte seite">
  <div class="account-column">
    <div class="account-head">
      <h1 style="font-size:clamp(28px,4.5vw,38px)">{t['login.heading']}</h1>
      <p>{t['login.intro']}</p>
    </div>

    {#if expired}
      <div class="hinweis">{t['login.session_expired']}</div>
    {/if}

    {#if tryItOutHint}
      <div class="hinweis">{t['login.try_it_out']}</div>
    {/if}

    <div class="account-panel">
      <form class="account-form" method="post" onsubmit={submit}>
        <div class="account-field">
          <label class="account-label" for="login-shore">{t['create.voyage.shore.label']}</label>
          <select
            class="account-input"
            id="login-shore"
            bind:value={shore}
            onchange={shoreRemembered}
          >
            {#each SHORE_IDS as s (s)}
              <option value={s} disabled={!SHORE_OPEN[s]}>
                {t[SHORE_LABEL[s]]}{SHORE_OPEN[s] ? '' : ` — ${t['account.shore.closed']}`}
              </option>
            {/each}
          </select>
          <p class="account-hint">{t['account.shore.hint']}</p>
        </div>

        <div class="account-field">
          <label class="account-label" for="login-username">{t['login.username.label']}</label>
          <input
            class="account-input"
            id="login-username"
            type="text"
            name="username"
            autocomplete="username"
            maxlength="24"
            bind:value={username}
          />
        </div>

        <div class="account-field">
          <label class="account-label" for="login-password">{t['login.password.label']}</label>
          <input
            class="account-input"
            id="login-password"
            type="password"
            name="password"
            autocomplete="current-password"
            maxlength="200"
            bind:value={password}
          />
        </div>

        {#if error}
          <p class="account-notice" role="alert">{t[error]}</p>
        {/if}

        <div class="account-actions">
          {#if ready}
            <button class="knopf account-primary" type="submit" disabled={running}>
              {running ? t['login.button.loading'] : t['login.button']}
            </button>
          {:else}
            <p class="account-hint">{t['account.without_js']}</p>
          {/if}
        </div>
      </form>

      <p class="account-switch">
        {t['login.switch.text']}
        <a href={localizedPath(lang, '/registrieren')}>{t['login.switch.link']}</a>
      </p>
    </div>
  </div>
</main>
