<script lang="ts">
  import { onMount } from 'svelte';
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
    readShore,
    register,
    writeAccountName,
    writeShore,
    writeToken,
  } from '$lib/account';
  import '$lib/stil/account.css';

  /**
   * Creating an account.
   *
   * ── Why no real form is submitted here ───────────────────────────────
   * The page is prerendered and sits as a file on nginx; there is no
   * process that could take a POST. A native `action="https://play…"`
   * would moreover be forbidden by the CSP (`form-action: ['self']`). The
   * way to the shore therefore goes through `fetch`, and that needs
   * JavaScript.
   *
   * ── Why the button only appears with JavaScript ──────────────────────
   * A button that does nothing without scripting looks like a fault. In
   * its place the prerendered HTML holds the sentence that explains it
   * (`account.without_js`), and `onMount` swaps it for the button.
   * Everything else — heading, labels, hints, the links to the neighbouring
   * pages — is fully there without scripting.
   *
   * ── Why the form carries `method="post"` all the same ────────────────
   * It has no submit button without scripting, and more than one text field
   * prevents the silent submit on Enter. Should a way there ever open up
   * anyway, `method` decides where the PASSWORD ends up: with `get` in the
   * address bar, the history and every log — with `post` in a body that
   * nginx rejects with 405. A password belongs in an address under no
   * circumstances.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** True as soon as scripting has taken over — see the header comment. */
  let ready = $state(false);
  let running = $state(false);

  let shore = $state<ShoreId>('dev');
  let username = $state('');
  let email = $state('');
  let password = $state('');
  let passwordRepeat = $state('');
  let error = $state<MessageKey | null>(null);

  onMount(() => {
    ready = true;
    shore = readShore() ?? 'dev';
  });

  function shoreRemembered() {
    writeShore(shore);
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (running) return;
    error = null;

    // The repetition is compared ONLY here. It is never sent along — the
    // server has nothing to do with it.
    if (password !== passwordRepeat) {
      error = 'register.error.mismatch';
      return;
    }

    running = true;
    try {
      const answer = await register(shore, username.trim(), email.trim(), password);
      writeToken(shore, answer.token);
      writeShore(shore);
      // Für die Kopfleiste — Begründung in `account.ts`.
      writeAccountName(shore, answer.account.username);
      // The password leaves memory as soon as it is no longer needed. It is
      // not stored anywhere in the first place.
      password = '';
      passwordRepeat = '';
      /*
        A fresh account has no characters. The detour via /konto would be an
        empty list with exactly one button in it — which is why this goes
        straight to the stage. The check stays all the same: it costs
        nothing and still holds once there are accounts with characters
        from elsewhere.
      */
      await goto(localizedPath(lang, answer.characters.length ? '/konto' : '/erstellen'));
    } catch (err) {
      error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
      running = false;
    }
  }
</script>

<Kopfdaten
  titel={t['register.meta.title']}
  beschreibung={t['register.meta.description']}
  noindex
/>

<main class="mitte seite">
  <div class="account-column">
    <div class="account-head">
      <h1 style="font-size:clamp(28px,4.5vw,38px)">{t['register.heading']}</h1>
      <p>{t['register.intro']}</p>
    </div>

    <div class="account-panel">
      <form class="account-form" method="post" onsubmit={submit}>
        <div class="account-field">
          <label class="account-label" for="register-shore">{t['create.voyage.shore.label']}</label>
          <select
            class="account-input"
            id="register-shore"
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
          <label class="account-label" for="register-username">{t['register.username.label']}</label>
          <input
            class="account-input"
            id="register-username"
            type="text"
            name="username"
            autocomplete="username"
            maxlength="24"
            placeholder={t['register.username.placeholder']}
            bind:value={username}
          />
          <p class="account-hint">{t['register.username.hint']}</p>
        </div>

        <div class="account-field">
          <label class="account-label" for="register-email">{t['register.email.label']}</label>
          <input
            class="account-input"
            id="register-email"
            type="email"
            name="email"
            autocomplete="email"
            maxlength="254"
            placeholder={t['register.email.placeholder']}
            bind:value={email}
          />
          <p class="account-hint">{t['register.email.hint']}</p>
        </div>

        <div class="account-field">
          <label class="account-label" for="register-password">{t['register.password.label']}</label>
          <input
            class="account-input"
            id="register-password"
            type="password"
            name="password"
            autocomplete="new-password"
            maxlength="200"
            bind:value={password}
          />
          <p class="account-hint">{t['register.password.hint']}</p>
        </div>

        <div class="account-field">
          <label class="account-label" for="register-password-repeat">
            {t['register.password_repeat.label']}
          </label>
          <input
            class="account-input"
            id="register-password-repeat"
            type="password"
            name="password-repeat"
            autocomplete="new-password"
            maxlength="200"
            bind:value={passwordRepeat}
          />
          <p class="account-hint">{t['register.password_repeat.hint']}</p>
        </div>

        <!-- role="alert" is read out when it is inserted. The message only
             appears after a click — without it, nobody who has the page read
             aloud would ever learn of it. -->
        {#if error}
          <p class="account-notice" role="alert">{t[error]}</p>
        {/if}

        <div class="account-actions">
          {#if ready}
            <button class="knopf account-primary" type="submit" disabled={running}>
              {running ? t['register.button.loading'] : t['register.button']}
            </button>
          {:else}
            <p class="account-hint">{t['account.without_js']}</p>
          {/if}
        </div>
      </form>

      <p class="account-switch">
        {t['register.switch.text']}
        <a href={localizedPath(lang, '/anmelden')}>{t['register.switch.link']}</a>
      </p>
    </div>
  </div>
</main>
