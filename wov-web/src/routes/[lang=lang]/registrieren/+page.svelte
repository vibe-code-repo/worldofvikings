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
    type ShoreId,
    errorMessageKey,
    readShore,
    registrieren,
    writeShore,
    writeToken,
  } from '$lib/konto';
  import '$lib/stil/konto.css';

  /**
   * Konto anlegen.
   *
   * ── Warum hier kein echtes Formular abgeschickt wird ─────────────────
   * Die Seite ist vorgerendert und liegt als Datei auf nginx; es gibt
   * keinen Prozess, der ein POST entgegennehmen könnte. Ein natives
   * `action="https://play…"` wäre ausserdem von der CSP verboten
   * (`form-action: ['self']`). Der Weg zum Gestade führt deshalb über
   * `fetch`, und das braucht JavaScript.
   *
   * ── Warum der Knopf erst mit JavaScript erscheint ────────────────────
   * Ein Knopf, der ohne Skript nichts tut, sieht aus wie ein Fehler. An
   * seiner Stelle steht darum im vorgerenderten HTML der Satz, der es
   * erklärt (`konto.ohne_js`), und `onMount` tauscht ihn gegen den Knopf.
   * Alles Übrige — Überschrift, Beschriftungen, Hilfetexte, die Links zu
   * den Nachbarseiten — steht ohne Skript vollständig da.
   *
   * ── Warum das Formular trotzdem `method="post"` trägt ────────────────
   * Es hat ohne Skript keinen Absendeknopf, und mehr als ein Textfeld
   * verhindert die stille Absendung per Eingabetaste. Sollte doch einmal
   * ein Weg dorthin führen, entscheidet `method`, wohin das PASSWORT
   * gerät: bei `get` in die Adresszeile, den Verlauf und jedes Protokoll —
   * bei `post` in einen Rumpf, den nginx mit 405 abweist. Ein Passwort
   * gehört unter keinen Umständen in eine Adresse.
   */

  const lang = $derived(localeFrom(page.params.lang));
  const t = $derived(messages(lang));

  /** True as soon as scripting has taken over — see the header comment. */
  let bereit = $state(false);
  let laeuft = $state(false);

  let gestade = $state<ShoreId>('dev');
  let benutzername = $state('');
  let email = $state('');
  let passwort = $state('');
  let passwortWieder = $state('');
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

    // Der Abgleich der Wiederholung passiert NUR hier. Sie wird nie
    // mitgeschickt — der Server hat mit ihr nichts zu tun.
    if (passwort !== passwortWieder) {
      fehler = 'registrieren.fehler.ungleich';
      return;
    }

    laeuft = true;
    try {
      const antwort = await registrieren(gestade, benutzername.trim(), email.trim(), passwort);
      writeToken(gestade, antwort.token);
      writeShore(gestade);
      // Das Passwort verlässt den Speicher, sobald es nicht mehr gebraucht
      // wird. Abgelegt wird es ohnehin nirgends.
      passwort = '';
      passwortWieder = '';
      /*
        Ein frisches Konto hat keine Recken. Der Umweg über /konto wäre eine
        leere Liste mit genau einem Knopf darin — deshalb geht es direkt auf
        die Bühne. Die Abfrage bleibt trotzdem stehen: Sie kostet nichts und
        stimmt auch dann noch, wenn es einmal Konten mit Recken von anderswo
        gibt.
      */
      await goto(localizedPath(lang, antwort.charaktere.length ? '/konto' : '/erstellen'));
    } catch (err) {
      fehler = err instanceof ApiError ? errorMessageKey(err.key) : 'konto.fehler.unerwartet';
      laeuft = false;
    }
  }
</script>

<Kopfdaten
  titel={t['registrieren.kopf.titel']}
  beschreibung={t['registrieren.kopf.beschreibung']}
  noindex
/>

<main class="mitte seite">
  <div class="konto-schmal">
    <h1 style="font-size:clamp(1.8rem,5vw,2.8rem)">{t['registrieren.ueberschrift']}</h1>
    <p style="color:var(--matt)">{t['registrieren.einleitung']}</p>

    <div class="konto-tafel" style="margin-top:1.5rem">
      <form method="post" onsubmit={absenden}>
        <div class="konto-feld">
          <label class="konto-name" for="reg-gestade">{t['erstellen.fahrt.gestade.label']}</label>
          <select
            class="konto-eingabe"
            id="reg-gestade"
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
          <label class="konto-name" for="reg-name">{t['registrieren.benutzername.label']}</label>
          <input
            class="konto-eingabe"
            id="reg-name"
            type="text"
            name="benutzername"
            autocomplete="username"
            maxlength="24"
            placeholder={t['registrieren.benutzername.platzhalter']}
            bind:value={benutzername}
          />
          <p class="konto-hilfe">{t['registrieren.benutzername.hilfe']}</p>
        </div>

        <div class="konto-feld">
          <label class="konto-name" for="reg-email">{t['registrieren.email.label']}</label>
          <input
            class="konto-eingabe"
            id="reg-email"
            type="email"
            name="email"
            autocomplete="email"
            maxlength="254"
            placeholder={t['registrieren.email.platzhalter']}
            bind:value={email}
          />
          <p class="konto-hilfe">{t['registrieren.email.hilfe']}</p>
        </div>

        <div class="konto-feld">
          <label class="konto-name" for="reg-passwort">{t['registrieren.passwort.label']}</label>
          <input
            class="konto-eingabe"
            id="reg-passwort"
            type="password"
            name="passwort"
            autocomplete="new-password"
            maxlength="200"
            bind:value={passwort}
          />
          <p class="konto-hilfe">{t['registrieren.passwort.hilfe']}</p>
        </div>

        <div class="konto-feld">
          <label class="konto-name" for="reg-passwort2">{t['registrieren.passwort2.label']}</label>
          <input
            class="konto-eingabe"
            id="reg-passwort2"
            type="password"
            name="passwort-wieder"
            autocomplete="new-password"
            maxlength="200"
            bind:value={passwortWieder}
          />
          <p class="konto-hilfe">{t['registrieren.passwort2.hilfe']}</p>
        </div>

        <!-- role="alert" wird beim Einfügen vorgelesen. Die Meldung
             erscheint erst nach einem Klick — ohne das erführe niemand
             davon, der die Seite vorlesen lässt. -->
        {#if fehler}
          <p class="konto-melder" role="alert">{t[fehler]}</p>
        {/if}

        <div class="konto-tat">
          {#if bereit}
            <button class="knopf" type="submit" disabled={laeuft}>
              {laeuft ? t['registrieren.knopf.laeuft'] : t['registrieren.knopf']}
            </button>
          {:else}
            <p class="konto-hilfe" style="margin:0">{t['konto.ohne_js']}</p>
          {/if}
        </div>
      </form>

      <p class="konto-wechsel">
        {t['registrieren.wechsel.text']}
        <a href={localizedPath(lang, '/anmelden')}>{t['registrieren.wechsel.link']}</a>
      </p>
    </div>
  </div>
</main>
