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
    errorMessageKey,
    login,
    readShore,
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

  let ready = $state(false);
  let running = $state(false);

  let shore = $state<ShoreId>('dev');
  let username = $state('');
  let password = $state('');
  let error = $state<MessageKey | null>(null);

  onMount(() => {
    ready = true;
    const requestedShore = page.url.searchParams.get('shore');
    shore = SHORE_IDS.includes(requestedShore as ShoreId)
      ? requestedShore as ShoreId
      : readShore() ?? 'dev';
  });

  function shoreRemembered() {
    writeShore(shore);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (running) return;
    error = null;
    running = true;
    try {
      const answer = await login(shore, username.trim(), password);
      writeToken(shore, answer.token);
      writeShore(shore);
      password = '';
      /*
        Whoever has no character yet does not want to see an empty list but
        to create one. Whoever has some wants to choose. The sign-in answer
        already says both — a second call would be nothing but waiting time.
      */
      await goto(localizedPath(lang, answer.characters.length ? '/konto' : '/erstellen'));
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
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
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
