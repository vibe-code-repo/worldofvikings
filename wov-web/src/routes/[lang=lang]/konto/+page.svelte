<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Kopfdaten from '$lib/Kopfdaten.svelte';
  import { type MessageKey, localeFrom, localizedPath, messages } from '$lib/i18n';
  import { datumKurz, holeJson, vorWieLange } from '$lib/formate';
  import {
    type Account,
    ApiError,
    type Character,
    SHORE_IDS,
    SHORE_LABEL,
    type ShoreId,
    clearAllTokens,
    clearToken,
    deleteCharacter,
    errorMessageKey,
    isLoggedOut,
    me,
    play,
    playUrl,
    readShore,
    readToken,
    signedInShore,
    writeShore,
  } from '$lib/account';
  import '$lib/stil/account.css';

  /**
   * The account page: which characters exist, and what can be done with them.
   *
   * ── Why the default state is "not signed in" ─────────────────────────
   * The page is written once at build time. At that moment nobody can know
   * who will open it later — "not signed in" is therefore not merely the
   * safe assumption but the only one that actually holds. That same state is
   * also what a browser without JavaScript gets to see: an explanatory
   * paragraph and two links, never an empty list that looks like a failure.
   *
   * ── Why the list is fetched again despite the sign-in answer ──────────
   * Whoever arrives from /anmelden would already have it. Whoever opens a
   * bookmark or reloads the page has nothing but the token in localStorage.
   * A second code path for that case would be a second code path that is
   * used more rarely and is therefore broken LATER -- broken without anyone
   * noticing, until the day somebody walks it.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  let ready = $state(false);
  let shore = $state<ShoreId>('dev');
  let signedIn = $state(false);
  /**
   * The shore did not answer (or answered with an error that says nothing
   * about the sign-in). A state of its own next to `signedIn`, because
   * neither "signed in" nor "not signed in" is true here — both would claim
   * something nobody knows at that moment.
   */
  let unreachable = $state(false);
  let loading = $state(false);
  let account = $state<Account | null>(null);
  let characters = $state<Character[]>([]);
  let error = $state<MessageKey | null>(null);
  /** The character the delete question is currently standing for. */
  let deleteAsk = $state<number | null>(null);
  /** The character a call is running for — locks only that one's buttons. */
  let busy = $state<number | null>(null);

  /* -------------------------------------------------------- appearance */

  interface AppearanceEntry {
    id: string;
    name: string;
  }
  interface Appearance {
    figuren: AppearanceEntry[];
    frisuren: AppearanceEntry[];
    ruestung: AppearanceEntry[];
  }

  /**
   * id → display name, out of the same file /erstellen builds its choices
   * from. Stays empty when the file is missing; then the bare id is what
   * shows. That is uglier, but it is true — and it does not kill the page
   * when a rollout forgets the file.
   *
   * The names in it are German, like the rest of the runtime data under
   * `static/api/`. On /en/konto there is therefore an English frame around
   * German clothing names — the same open spot the saga and the hall of
   * fame have.
   */
  let names = $state<Record<string, string>>({});

  function nameOf(id: string): string {
    return id ? (names[id] ?? id) : t['create.appearance.chest.none'];
  }

  /* ------------------------------------------------------------ loading */

  async function load() {
    error = null;
    unreachable = false;
    deleteAsk = null;
    const token = readToken(shore);
    if (!token) {
      signedIn = false;
      account = null;
      characters = [];
      return;
    }
    loading = true;
    try {
      const data = await me(shore, token);
      account = data.account;
      characters = data.characters;
      signedIn = true;
    } catch (err) {
      if (isLoggedOut(err)) {
        clearToken(shore);
        signedIn = false;
        account = null;
        characters = [];
      } else {
        // A server error or a broken connection is NOT a confirmed sign-in.
        // This used to say `signedIn = true`: the page then showed the
        // surface of a signed-in account together with an EMPTY character
        // list — that is, "you have no characters", where "we did not
        // reach the shore" would have been right.
        //
        // The token stays put (no clearToken): it may well be fine, we
        // simply do not know right now. The next load will tell.
        unreachable = true;
        error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
      }
    } finally {
      loading = false;
    }
  }

  async function shoreChanged() {
    writeShore(shore);
    await load();
  }

  /* ------------------------------------------------------------ actions */

  /** Token gone, back to sign-in — the only way out after a 401. */
  async function toLogin() {
    clearToken(shore);
    signedIn = false;
    await goto(`${localizedPath(lang, '/anmelden')}?abgelaufen=1`);
  }

  async function setSail(c: Character) {
    if (busy !== null) return;
    const token = readToken(shore);
    if (!token) return toLogin();
    error = null;
    busy = c.id;
    try {
      const ticket = await play(shore, token, c.id);
      // The credential travels in the address fragment, never as a
      // parameter — the reasoning is at `playUrl` in `$lib/account.ts`.
      location.href = playUrl(shore, ticket.character, ticket.sessionToken);
    } catch (err) {
      busy = null;
      if (isLoggedOut(err)) return toLogin();
      if (err instanceof ApiError && err.key === 'unbekannt') {
        // A second tab deleted it. That makes the list here wrong, not the
        // answer — so the list is the thing that gets corrected.
        characters = characters.filter((x) => x.id !== c.id);
        error = 'account.page.delete.already_gone';
        return;
      }
      error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
    }
  }

  async function remove(c: Character) {
    if (busy !== null) return;
    const token = readToken(shore);
    if (!token) return toLogin();
    error = null;
    busy = c.id;
    try {
      await deleteCharacter(shore, token, c.id);
      characters = characters.filter((x) => x.id !== c.id);
    } catch (err) {
      if (isLoggedOut(err)) return toLogin();
      if (err instanceof ApiError && err.key === 'unbekannt') {
        // A 404 means "was already gone" here — the goal is reached, so it
        // disappears from the list instead of inheriting an error message.
        characters = characters.filter((x) => x.id !== c.id);
        error = 'account.page.delete.already_gone';
      } else {
        error = err instanceof ApiError ? errorMessageKey(err.key) : 'account.error.unexpected';
      }
    } finally {
      busy = null;
      deleteAsk = null;
    }
  }

  /**
   * Signing out means: forgetting the token.
   *
   * More is not possible and is not pretended here either. The token is
   * self-carrying and HMAC-signed, the API knows no endpoint for revoking
   * it — it expires by itself after 30 days.
   */
  function logout() {
    // ALL shores, not just the chosen one — see clearAllTokens().
    clearAllTokens();
    signedIn = false;
    unreachable = false;
    account = null;
    characters = [];
    error = null;
  }

  onMount(async () => {
    ready = true;
    shore = signedInShore() ?? readShore() ?? 'dev';

    void (async () => {
      try {
        const data = await holeJson<Appearance>('/assets/aussehen.json');
        const map: Record<string, string> = {};
        for (const e of [...data.figuren, ...data.frisuren, ...data.ruestung]) {
          map[e.id] = e.name;
        }
        names = map;
      } catch {
        /* no names: then the ids are what shows */
      }
    })();

    await load();
  });
</script>

<Kopfdaten
  titel={t['account.page.meta.title']}
  beschreibung={t['account.page.meta.description']}
  noindex
/>

<main class="mitte seite">
  <div class="account-narrow">
    <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['account.page.heading']}</h1>

    {#if unreachable}
      <!--
        Neither signed in nor signed out: the shore did not answer. Claiming
        either would be wrong — "Not signed in" would send somebody off to
        sign in although their token may be perfectly fine, and the signed-in
        view would show an empty character list as if they had none.
      -->
      <div class="account-panel" style="margin-top:1.2rem">
        <h2 style="margin-top:0">{t['account.page.unreachable.title']}</h2>
        {#if error}
          <p class="account-notice" role="alert" style="margin:0.8rem 0 0">{t[error]}</p>
        {/if}
        <div class="account-actions">
          <button class="knopf" type="button" onclick={() => void load()}>
            {t['account.page.unreachable.retry']}
          </button>
          <button class="knopf knopf-rand" type="button" onclick={logout}>
            {t['account.logout']}
          </button>
        </div>
      </div>
    {:else if signedIn}
      <div class="account-panel" style="margin-top:1.2rem">
        <div class="account-field" style="margin-bottom:0.8rem">
          <label class="account-label" for="account-shore">
            {t['create.voyage.shore.label']}
          </label>
          <select
            class="account-input"
            id="account-shore"
            bind:value={shore}
            onchange={shoreChanged}
          >
            {#each SHORE_IDS as s (s)}
              <option value={s}>{t[SHORE_LABEL[s]]}</option>
            {/each}
          </select>
        </div>

        {#if account}
          <p class="account-character-data" style="margin-bottom:0">
            <span>{t['account.page.logged_in_as']} <b>{account.username}</b></span>
            <span>{t['account.page.email']} <b>{account.email}</b></span>
          </p>
        {/if}

        <div class="account-actions">
          <a class="knopf" href={localizedPath(lang, '/erstellen')}>
            {t['account.page.button.new']}
          </a>
          <button class="knopf knopf-rand" type="button" onclick={logout}>
            {t['account.logout']}
          </button>
        </div>
      </div>

      {#if error}
        <p class="account-notice" role="alert" style="margin-top:1.2rem">{t[error]}</p>
      {/if}

      {#if loading}
        <p class="account-empty">{t['account.page.loading']}</p>
      {:else if error && characters.length === 0}
        <!--
          Nothing further. "No character yet" would be a claim about the
          shore that nobody has checked: the list is empty because the
          answer never came — not because none stands there. The error
          message above already says what is going on.
        -->
      {:else if characters.length === 0}
        <p class="account-empty">{t['account.page.empty']}</p>
      {:else}
        <div class="account-list">
          {#each characters as c (c.id)}
            <article class="account-character">
              <h2 class="account-character-name">{c.name}</h2>
              <p class="account-character-data">
                <span>{t['create.appearance.figure.label']} <b>{nameOf(c.figur)}</b></span>
                <span>{t['create.appearance.hair.label']} <b>{nameOf(c.frisur)}</b></span>
                <span>{t['create.appearance.chest.label']} <b>{nameOf(c.ober)}</b></span>
                <span>{t['create.appearance.legs.label']} <b>{nameOf(c.beine)}</b></span>
              </p>
              <p class="account-character-data">
                <span>
                  {t['account.page.created']}
                  <b>{datumKurz(new Date(c.created).toISOString(), lang)}</b>
                </span>
                <span>
                  {#if c.lastPlayed === null}
                    <b>{t['account.page.never_sailed']}</b>
                  {:else}
                    {t['account.page.last_seen']}
                    <b>{vorWieLange(new Date(c.lastPlayed).toISOString(), lang)}</b>
                  {/if}
                </span>
              </p>

              {#if deleteAsk === c.id}
                <!-- Two steps instead of a browser dialog: `confirm()` can
                     neither be translated nor styled, and it halts the whole
                     tab while it is up. -->
                <p class="account-notice" style="margin:0.8rem 0 0">
                  {t['account.page.delete.question']}
                </p>
                <div class="account-actions">
                  <button
                    class="knopf knopf-rand"
                    type="button"
                    disabled={busy === c.id}
                    onclick={() => remove(c)}
                  >
                    {t['account.page.delete.yes']}
                  </button>
                  <button class="knopf" type="button" onclick={() => (deleteAsk = null)}>
                    {t['account.page.delete.no']}
                  </button>
                </div>
              {:else}
                <div class="account-actions">
                  <button
                    class="knopf"
                    type="button"
                    disabled={busy !== null}
                    onclick={() => setSail(c)}
                  >
                    {busy === c.id
                      ? t['account.page.play.loading']
                      : t['create.button.set_sail']}
                  </button>
                  <button
                    class="knopf knopf-rand"
                    type="button"
                    disabled={busy !== null}
                    onclick={() => (deleteAsk = c.id)}
                  >
                    {t['account.page.button.delete']}
                  </button>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    {:else}
      <!--
        The default state. It stands like this in the prerendered HTML and is
        therefore also what shows without JavaScript: an explanation and two
        ways onward, no half button and no empty list.
      -->
      <div class="account-panel" style="margin-top:1.2rem">
        <h2 style="margin-top:0">{t['account.page.locked.title']}</h2>
        <p style="color:var(--matt)">{t['account.page.locked.text']}</p>
        {#if ready && loading}
          <p class="account-empty">{t['account.page.loading']}</p>
        {/if}
        <div class="account-actions">
          <a class="knopf" href={localizedPath(lang, '/anmelden')}>
            {t['account.page.locked.login']}
          </a>
          <a class="knopf knopf-rand" href={localizedPath(lang, '/registrieren')}>
            {t['account.page.locked.register']}
          </a>
        </div>
      </div>
    {/if}
  </div>
</main>
