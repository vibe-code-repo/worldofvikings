<script lang="ts">
  import {
    type Account,
    ApiError,
    type ShoreId,
    changeEmail,
    changePassword,
    clearToken,
    deleteAccount,
    errorMessageKey,
    isLoggedOut,
    readToken,
    setProfile,
    writeToken,
  } from '$lib/account';
  import { type MessageKey, localeFrom, messages } from '$lib/i18n';
  import {
    PROFILTEXT_MAX,
    emailPruefen,
    loeschenBereit,
    passwortWechselPruefen,
    profilLaenge,
    profilZuLang,
  } from '$lib/kontoverwaltung';
  import { page } from '$app/state';

  /**
   * Konto verwalten (Karte W3): Profiltext, E-Mail, Passwort, Löschen.
   *
   * ── Was hier bewusst NICHT passiert ──────────────────────────────────
   * Passwörter stehen nur in den Feldern dieser Datei und in der Anfrage,
   * nie in einem Speicher und nie im Adresszeilen-Fragment. Nach jedem
   * Absenden, ob es klappt oder nicht, werden die Passwortfelder geleert.
   *
   * Der Profiltext wird als Text angezeigt und gesendet, nie als HTML oder
   * Markdown. Die Regeln (erlaubte Zeichen, 300 Graphem-Cluster) prüft allein
   * der Server; die Anzeige hier zählt nur mit.
   *
   * Ein 401 `not-signed-in` heißt: Token weg (Passwort in einer anderen
   * Sitzung gewechselt, Konto gelöscht) — dann `onLoggedOut`, nicht ein
   * Satz, der nach einem Fehler des Formulars aussieht.
   */
  let {
    shore,
    account,
    profile,
    manageable,
    onAccount,
    onProfile,
    onDeleted,
    onLoggedOut,
  }: {
    shore: ShoreId;
    account: Account;
    profile: string;
    manageable: boolean;
    onAccount: (a: Account) => void;
    onProfile: (text: string) => void;
    onDeleted: () => void;
    onLoggedOut: () => void;
  } = $props();

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  interface Abschnitt {
    busy: boolean;
    error: MessageKey | null;
    done: MessageKey | null;
  }
  const leer = (): Abschnitt => ({ busy: false, error: null, done: null });

  /* ------------------------------------------------------------ Profil */
  let text = $state('');
  let textGeladen = $state('');
  let pro = $state<Abschnitt>(leer());
  $effect(() => {
    // Der Server-Stand gewinnt, wenn die Seite ihn (neu) liefert.
    text = profile;
    textGeladen = profile;
  });
  const laenge = $derived(profilLaenge(text));
  const zuLang = $derived(profilZuLang(text));

  /* ------------------------------------------------------------ E-Mail */
  let emailAktuell = $state('');
  let emailNeu = $state('');
  let mail = $state<Abschnitt>(leer());

  /* ---------------------------------------------------------- Passwort */
  let pwAktuell = $state('');
  let pwNeu = $state('');
  let pwWiederholt = $state('');
  let pw = $state<Abschnitt>(leer());

  /* ------------------------------------------------------------ Löschen */
  let loeschPw = $state('');
  let loeschName = $state('');
  let del = $state<Abschnitt>(leer());

  function fehlerSchluessel(err: unknown): MessageKey {
    return err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
  }

  /** Gemeinsamer Ablauf: Anfrage, Fehler als Satz, 401 als Abmeldung. */
  async function ausfuehren(lauf: (token: string) => Promise<void>): Promise<Abschnitt> {
    const token = readToken(shore);
    if (!token) {
      onLoggedOut();
      return leer();
    }
    const next: Abschnitt = { busy: true, error: null, done: null };
    try {
      await lauf(token);
    } catch (err) {
      if (isLoggedOut(err)) {
        clearToken(shore);
        onLoggedOut();
        return leer();
      }
      next.error = fehlerSchluessel(err);
    }
    next.busy = false;
    return next;
  }

  async function profilSpeichern(e: Event) {
    e.preventDefault();
    if (pro.busy || zuLang) return;
    pro = { ...pro, busy: true, error: null, done: null };
    const ergebnis = await ausfuehren(async (token) => {
      const r = await setProfile(shore, token, text);
      text = r.profile;
      textGeladen = r.profile;
      onProfile(r.profile);
    });
    pro = ergebnis.error === null && !ergebnis.busy ? { ...ergebnis, done: 'account.manage.profile.saved' } : ergebnis;
  }

  async function emailAendern(e: Event) {
    e.preventDefault();
    if (mail.busy) return;
    const mangel = emailAktuell === '' ? 'account.manage.error.current_required' : emailPruefen(emailNeu);
    if (mangel) {
      mail = { busy: false, error: mangel, done: null };
      return;
    }
    const passwort = emailAktuell;
    emailAktuell = '';
    mail = { ...mail, busy: true, error: null, done: null };
    const ergebnis = await ausfuehren(async (token) => {
      const r = await changeEmail(shore, token, passwort, emailNeu.trim());
      onAccount(r.account);
      emailNeu = '';
    });
    mail = ergebnis.error === null && !ergebnis.busy ? { ...ergebnis, done: 'account.manage.email.saved' } : ergebnis;
  }

  async function passwortAendern(e: Event) {
    e.preventDefault();
    if (pw.busy) return;
    const mangel = passwortWechselPruefen({ current: pwAktuell, next: pwNeu, repeat: pwWiederholt });
    if (mangel) {
      pw = { busy: false, error: mangel, done: null };
      return;
    }
    const alt = pwAktuell;
    const neu = pwNeu;
    pwAktuell = pwNeu = pwWiederholt = '';
    pw = { ...pw, busy: true, error: null, done: null };
    const ergebnis = await ausfuehren(async (token) => {
      const r = await changePassword(shore, token, alt, neu);
      // Das alte Token dieser Sitzung ist ungültig; das neue ersetzt es sofort.
      writeToken(shore, r.token);
    });
    pw = ergebnis.error === null && !ergebnis.busy ? { ...ergebnis, done: 'account.manage.password.saved' } : ergebnis;
  }

  async function kontoLoeschen(e: Event) {
    e.preventDefault();
    if (del.busy || !loeschenBereit(account.username, loeschPw, loeschName)) return;
    const passwort = loeschPw;
    const name = loeschName;
    loeschPw = '';
    del = { ...del, busy: true, error: null, done: null };
    let geloescht = false;
    const ergebnis = await ausfuehren(async (token) => {
      await deleteAccount(shore, token, passwort, name.trim());
      geloescht = true;
    });
    del = ergebnis;
    if (geloescht) {
      // Der Server hat das Konto gelöscht; das Token gilt nirgends mehr.
      clearToken(shore);
      onDeleted();
    }
  }
</script>

<section class="konto-verwaltung" aria-labelledby="konto-verwaltung-titel">
  <h2 id="konto-verwaltung-titel" class="konto-verwaltung-titel">{t['account.manage.heading']}</h2>

  <form class="account-panel konto-abschnitt" onsubmit={profilSpeichern} aria-labelledby="km-profil">
    <h3 id="km-profil">{t['account.manage.profile.heading']}</h3>
    {#if !manageable}
      <p class="account-hint">{t['account.manage.standard']}</p>
    {:else}
      <div class="account-field">
        <label class="account-label" for="km-profil-text">{t['account.manage.profile.label']}</label>
        <!-- Reiner Text: `bind:value` und ein Textfeld, kein Editor, kein HTML. -->
        <textarea
          class="account-input konto-text"
          id="km-profil-text"
          rows="4"
          spellcheck="true"
          bind:value={text}
          aria-describedby="km-profil-hinweis km-profil-zaehler"
        ></textarea>
        <p class="account-hint" id="km-profil-hinweis">{t['account.manage.profile.hint']}</p>
        <p
          class="account-hint konto-zaehler"
          class:konto-zaehler-voll={zuLang}
          id="km-profil-zaehler"
          aria-live="polite"
        >
          {laenge} / {PROFILTEXT_MAX} {t['account.manage.profile.count']}
        </p>
      </div>
      {#if pro.error}<p class="account-error" role="alert">{t[pro.error]}</p>{/if}
      {#if pro.done}<p class="account-notice" role="status">{t[pro.done]}</p>{/if}
      <div class="account-actions">
        <button
          class="knopf account-primary"
          type="submit"
          disabled={pro.busy || zuLang || text === textGeladen}
        >
          {pro.busy ? t['account.manage.saving'] : t['account.manage.profile.save']}
        </button>
      </div>
    {/if}
  </form>

  {#if manageable}
    <form class="account-panel konto-abschnitt" onsubmit={emailAendern} aria-labelledby="km-email">
      <h3 id="km-email">{t['account.manage.email.heading']}</h3>
      <div class="account-field">
        <label class="account-label" for="km-email-pw">{t['account.manage.current_password']}</label>
        <input
          class="account-input"
          id="km-email-pw"
          type="password"
          autocomplete="current-password"
          maxlength="200"
          bind:value={emailAktuell}
        />
      </div>
      <div class="account-field">
        <label class="account-label" for="km-email-neu">{t['account.manage.email.new']}</label>
        <input
          class="account-input"
          id="km-email-neu"
          type="email"
          autocomplete="email"
          maxlength="254"
          bind:value={emailNeu}
        />
        <p class="account-hint">{t['account.manage.email.hint']}</p>
      </div>
      {#if mail.error}<p class="account-error" role="alert">{t[mail.error]}</p>{/if}
      {#if mail.done}<p class="account-notice" role="status">{t[mail.done]}</p>{/if}
      <div class="account-actions">
        <button class="knopf account-primary" type="submit" disabled={mail.busy}>
          {mail.busy ? t['account.manage.saving'] : t['account.manage.email.save']}
        </button>
      </div>
    </form>

    <form class="account-panel konto-abschnitt" onsubmit={passwortAendern} aria-labelledby="km-pw">
      <h3 id="km-pw">{t['account.manage.password.heading']}</h3>
      <div class="account-field">
        <label class="account-label" for="km-pw-alt">{t['account.manage.current_password']}</label>
        <input
          class="account-input"
          id="km-pw-alt"
          type="password"
          autocomplete="current-password"
          maxlength="200"
          bind:value={pwAktuell}
        />
      </div>
      <div class="account-field">
        <label class="account-label" for="km-pw-neu">{t['account.manage.password.new']}</label>
        <input
          class="account-input"
          id="km-pw-neu"
          type="password"
          autocomplete="new-password"
          maxlength="200"
          bind:value={pwNeu}
        />
      </div>
      <div class="account-field">
        <label class="account-label" for="km-pw-wdh">{t['account.manage.password.repeat']}</label>
        <input
          class="account-input"
          id="km-pw-wdh"
          type="password"
          autocomplete="new-password"
          maxlength="200"
          bind:value={pwWiederholt}
        />
        <p class="account-hint">{t['account.manage.password.hint']}</p>
      </div>
      {#if pw.error}<p class="account-error" role="alert">{t[pw.error]}</p>{/if}
      {#if pw.done}<p class="account-notice" role="status">{t[pw.done]}</p>{/if}
      <div class="account-actions">
        <button class="knopf account-primary" type="submit" disabled={pw.busy}>
          {pw.busy ? t['account.manage.saving'] : t['account.manage.password.save']}
        </button>
      </div>
    </form>

    <form class="account-panel konto-abschnitt konto-gefahr" onsubmit={kontoLoeschen} aria-labelledby="km-del">
      <h3 id="km-del">{t['account.manage.delete.heading']}</h3>
      <p class="account-notice">{t['account.manage.delete.warning']}</p>
      <div class="account-field">
        <label class="account-label" for="km-del-pw">{t['account.manage.current_password']}</label>
        <input
          class="account-input"
          id="km-del-pw"
          type="password"
          autocomplete="current-password"
          maxlength="200"
          bind:value={loeschPw}
        />
      </div>
      <div class="account-field">
        <label class="account-label" for="km-del-name">
          {t['account.manage.delete.confirm_label']} <b>{account.username}</b>
        </label>
        <input
          class="account-input"
          id="km-del-name"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="24"
          bind:value={loeschName}
        />
      </div>
      {#if del.error}<p class="account-error" role="alert">{t[del.error]}</p>{/if}
      <div class="account-actions">
        <button
          class="knopf knopf-rand"
          type="submit"
          disabled={del.busy || !loeschenBereit(account.username, loeschPw, loeschName)}
        >
          {del.busy ? t['account.manage.saving'] : t['account.manage.delete.button']}
        </button>
      </div>
    </form>
  {:else}
    <p class="account-hint">{t['account.manage.standard']}</p>
  {/if}
</section>

<style>
  .konto-verwaltung {
    margin-top: 2.4rem;
    display: grid;
    gap: 1.2rem;
    max-width: 560px;
  }
  .konto-verwaltung-titel {
    margin: 0;
  }
  .konto-abschnitt h3 {
    margin: 0 0 0.8rem;
    font-size: 18px;
  }
  .konto-text {
    width: 100%;
    resize: vertical;
    min-height: 6rem;
    font: inherit;
  }
  .konto-zaehler {
    text-align: right;
  }
  .konto-zaehler-voll {
    color: var(--fehler, #c0392b);
  }
  .konto-gefahr {
    border-color: var(--fehler, #c0392b);
  }
  @media (max-width: 480px) {
    .konto-verwaltung {
      max-width: 100%;
    }
  }
</style>
