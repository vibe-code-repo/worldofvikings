/**
 * Eingebauter Anmeldedialog fuer den lokalen Klon.
 *
 * ── Wann er ueberhaupt erscheint ──────────────────────────────────────
 * Nur wenn main.ts weder ein Ticket noch ein gespeichertes SessionToken
 * hat UND die Webseite unter diesem Ursprung nicht erreichbar ist (kein
 * `/de/anmelden`, HEAD-Probe schlaegt fehl). Der normale Weg fuer einen
 * Besucher bleibt die Webseite; dieser Dialog ist der Rettungsanker fuer
 * "git clone, npm install, npm run dev" ohne den Rest der Installation.
 *
 * ── Warum er selbst Fetch-Aufrufe macht statt wov-web/src/lib/account.ts
 *    zu importieren ─────────────────────────────────────────────────────
 * client/ und wov-web/ sind zwei getrennte npm-Pakete mit getrennten
 * Bundlern (Vite hier, SvelteKit dort); ein Import quer drueber wuerde
 * eine Paketgrenze durchbrechen, die sonst nirgends durchbrochen wird.
 * Die paar Aufrufe (register/login/me/characters/play) sind klein genug,
 * um sie hier ohne Abhaengigkeit zu wiederholen — GLEICHE Pfade, GLEICHE
 * Felder wie in KontoApi.ts, damit beide Seiten sich nie widersprechen.
 *
 * ── Warum relative Pfade ───────────────────────────────────────────────
 * Dieser Dialog laeuft NUR, wenn Webseite und Spiel denselben Ursprung
 * teilen (das ist die ganze Pointe von "Anmeldung ohne Ticket-Sprung").
 * `fetch('/accounts/...')` geht deshalb an denselben Host wie die Seite
 * selbst — im Labor der Vite-Dev-Proxy (client/vite.config.ts, Praefix
 * `/accounts/`), im Betrieb nginx auf demselben Ursprung.
 *
 * ── Kontotoken bleibt im Speicher dieses Tabs, nicht in localStorage ───
 * Nur das SPIELTICKET (SessionToken) landet in localStorage — das ist
 * der Vertrag, den GameSocket.ts und main.ts schon kennen. Das Kontotoken
 * braucht dafuer nicht zu ueberleben: Ein zweites Fenster mit einem
 * gespeicherten Spielticket verbindet ohnehin ohne diesen Dialog (siehe
 * main.ts, `tokenLiegtVor`).
 */
import { UI, overlayStyle, panelStyle } from './theme';
import type { GameI18n, TranslationKey } from '../i18n';

/** Der Speicherschluessel des Spieltickets — MUSS mit GameSocket.ts uebereinstimmen. */
export const SESSION_TOKEN_KEY = 'wov-session-token';

interface Konto { username: string; email: string }
interface Charakter {
  id: number; name: string; figure: string; hairstyle: string;
  hairColor: string; top: string; legs: string;
}
interface AuthAntwort { token: string; account: Konto; characters: Charakter[] }
interface MeAntwort { account: Konto; characters: Charakter[] }
interface TicketAntwort { sessionToken: string; character: Charakter }

class ApiFehler extends Error {
  constructor(readonly schluessel: string) {
    super(schluessel);
  }
}

async function ruf<T>(
  pfad: string,
  init: { methode?: 'GET' | 'POST' | 'DELETE'; token?: string; koerper?: unknown } = {},
): Promise<T> {
  const kopf: Record<string, string> = {};
  if (init.koerper !== undefined) kopf['content-type'] = 'application/json';
  // X-WoV-Account statt Authorization — derselbe Grund wie in KontoApi.ts
  // und wov-web/src/lib/account.ts: ein Proxy vor dem Ursprung koennte
  // Authorization leeren.
  if (init.token) kopf['x-wov-account'] = init.token;

  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: init.methode ?? 'GET',
      headers: kopf,
      body: init.koerper === undefined ? undefined : JSON.stringify(init.koerper),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ApiFehler('network');
  }

  let daten: unknown = null;
  try { daten = await antwort.json(); } catch { /* leerer Koerper */ }

  if (!antwort.ok) {
    const schluessel = (daten as { error?: unknown } | null)?.error;
    throw new ApiFehler(typeof schluessel === 'string' ? schluessel : 'unknown');
  }
  return daten as T;
}

type Ansicht = 'anmelden' | 'registrieren' | 'charaktere' | 'laden';

export class Anmeldung {
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private kontoToken: string | null = null;
  private charaktere: Charakter[] = [];
  private ansicht: Ansicht = 'anmelden';
  private fehler: string | null = null;
  private busy = false;
  private erledigt: ((token: string) => void) | null = null;

  constructor(private readonly i18n: GameI18n) {
    this.overlay = document.createElement('div');
    this.overlay.dataset.ui = 'anmeldung';
    this.overlay.style.cssText = overlayStyle();

    this.panel = document.createElement('div');
    this.panel.style.cssText = panelStyle('min(420px,92vw)');
    this.overlay.appendChild(this.panel);

    document.body.appendChild(this.overlay);
    this.i18n.onChange(() => this.render());
  }

  /**
   * Zeigt den Dialog und loest erst auf, wenn ein gueltiges SessionToken
   * feststeht (im Speicher UND von einem Charakter geloest). Bricht nie
   * von selbst ab — der Besucher kann nur ueber "Spielen" weiterkommen.
   */
  anzeigen(): Promise<string> {
    this.overlay.style.display = 'flex';
    return new Promise((res) => {
      this.erledigt = res;
      this.ansicht = 'anmelden';
      this.render();
    });
  }

  private ausblenden(): void {
    this.overlay.style.display = 'none';
  }

  // ── Ablauf ──────────────────────────────────────────────────────────

  private async einloggenOderRegistrieren(
    modus: 'login' | 'register',
    benutzername: string,
    email: string,
    passwort: string,
  ): Promise<void> {
    this.busy = true; this.fehler = null; this.render();
    try {
      const antwort = modus === 'login'
        ? await ruf<AuthAntwort>('/accounts/login', { methode: 'POST', koerper: { username: benutzername, password: passwort } })
        : await ruf<AuthAntwort>('/accounts/register', { methode: 'POST', koerper: { username: benutzername, email, password: passwort } });
      this.kontoToken = antwort.token;
      this.charaktere = antwort.characters;
      this.ansicht = 'charaktere';
    } catch (e) {
      this.fehler = e instanceof ApiFehler ? e.schluessel : 'unknown';
    } finally {
      this.busy = false; this.render();
    }
  }

  private async charakterAnlegen(name: string): Promise<void> {
    if (!this.kontoToken) return;
    this.busy = true; this.fehler = null; this.render();
    try {
      // Vorgabe-Aussehen — Slots und Farbe lassen sich im Spiel selbst
      // aendern (CharakterPanel.ts). Dieser Dialog ist der Einstieg, kein
      // Ersatz fuer die Charaktererstellung der Webseite.
      const r = await ruf<{ character: Charakter }>('/accounts/characters', {
        methode: 'POST',
        token: this.kontoToken,
        koerper: { name, figure: 'wikingerin', hairstyle: 'H_01', hairColor: 'mittelbraun', top: '', legs: '' },
      });
      this.charaktere = [...this.charaktere, r.character];
    } catch (e) {
      this.fehler = e instanceof ApiFehler ? e.schluessel : 'unknown';
    } finally {
      this.busy = false; this.render();
    }
  }

  private async spielen(id: number): Promise<void> {
    if (!this.kontoToken) return;
    this.busy = true; this.fehler = null; this.render();
    try {
      const r = await ruf<TicketAntwort>(`/accounts/characters/${id}/play`, {
        methode: 'POST',
        token: this.kontoToken,
      });
      try { localStorage.setItem(SESSION_TOKEN_KEY, r.sessionToken); }
      catch { /* privater Modus: das Ticket lebt dann nur fuer diese Verbindung */ }
      this.ausblenden();
      this.erledigt?.(r.sessionToken);
    } catch (e) {
      this.fehler = e instanceof ApiFehler ? e.schluessel : 'unknown';
      this.busy = false; this.render();
    }
  }

  private async loeschen(id: number): Promise<void> {
    if (!this.kontoToken) return;
    this.busy = true; this.render();
    try {
      await ruf(`/accounts/characters/${id}`, { methode: 'DELETE', token: this.kontoToken });
      this.charaktere = this.charaktere.filter((c) => c.id !== id);
    } catch (e) {
      this.fehler = e instanceof ApiFehler ? e.schluessel : 'unknown';
    } finally {
      this.busy = false; this.render();
    }
  }

  // ── Darstellung ─────────────────────────────────────────────────────

  private t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  private fehlerText(): string | null {
    if (!this.fehler) return null;
    // Nur bekannte Server-Fehlerschluessel bekommen einen eigenen Satz —
    // ein unbekannter Schluessel (z. B. eine neue Serverantwort) faellt auf
    // den allgemeinen Satz zurueck, statt eine nicht vorhandene
    // Uebersetzungs-ID zu indizieren.
    const bekannt: readonly string[] = [
      'username-invalid', 'email-invalid', 'password-too-short', 'username-taken',
      'login-failed', 'too-many-attempts', 'not-signed-in', 'name-invalid',
      'name-taken', 'malformed-body', 'server-error', 'network', 'unknown',
    ];
    const key = (bekannt.includes(this.fehler) ? this.fehler : 'unknown') as
      'username-invalid' | 'email-invalid' | 'password-too-short' | 'username-taken'
      | 'login-failed' | 'too-many-attempts' | 'not-signed-in' | 'name-invalid'
      | 'name-taken' | 'malformed-body' | 'server-error' | 'network' | 'unknown';
    return this.t(`login.error.${key}` as TranslationKey);
  }

  private feld(typ: string, platzhalter: string, autocomplete?: string): HTMLInputElement {
    const el = document.createElement('input');
    el.type = typ;
    el.placeholder = platzhalter;
    if (autocomplete) el.setAttribute('autocomplete', autocomplete);
    el.style.cssText = [
      'display:block', 'width:100%', 'box-sizing:border-box', 'margin:6px 0',
      'padding:8px 10px', `background:${UI.slotBg}`, `border:1px solid ${UI.borderDim}`,
      'border-radius:4px', `color:${UI.text}`, 'font:inherit', 'font-size:14px',
    ].join(';');
    return el;
  }

  private knopf(text: string, primaer = true): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'display:block', 'width:100%', 'margin:10px 0 0', 'padding:8px 0',
      primaer ? `background:linear-gradient(180deg,#5a4726,#3a2d16)` : 'background:transparent',
      `color:${UI.gold}`, `border:1px solid ${UI.border}`, 'border-radius:4px',
      'font:inherit', 'font-size:14px', 'letter-spacing:.05em', 'cursor:pointer',
    ].join(';');
    return b;
  }

  private render(): void {
    this.panel.replaceChildren();

    const titel = document.createElement('div');
    titel.style.cssText = `font-size:22px;letter-spacing:.06em;color:${UI.gold};text-align:center;margin-bottom:4px;text-shadow:0 1px 2px #000`;
    titel.textContent = this.t(this.ansicht === 'charaktere' ? 'login.character.title' : 'login.title');
    this.panel.appendChild(titel);

    if (this.ansicht !== 'charaktere') {
      const unter = document.createElement('div');
      unter.style.cssText = `font-size:12px;color:${UI.muted};text-align:center;margin-bottom:14px`;
      unter.textContent = this.t('login.subtitle');
      this.panel.appendChild(unter);
    }

    const fehlertext = this.fehlerText();
    if (fehlertext) {
      const f = document.createElement('div');
      f.style.cssText = 'color:#e07a5f;font-size:13px;text-align:center;margin-bottom:8px';
      f.textContent = fehlertext;
      this.panel.appendChild(f);
    }

    if (this.ansicht === 'anmelden' || this.ansicht === 'registrieren') {
      this.renderAnmeldeformular();
    } else {
      this.renderCharaktere();
    }
  }

  private renderAnmeldeformular(): void {
    const registrieren = this.ansicht === 'registrieren';
    const benutzer = this.feld('text', this.t('login.username'), 'username');
    const email = registrieren ? this.feld('email', this.t('login.email'), 'email') : null;
    const passwort = this.feld('password', this.t('login.password'), registrieren ? 'new-password' : 'current-password');

    this.panel.appendChild(benutzer);
    if (email) this.panel.appendChild(email);
    this.panel.appendChild(passwort);

    const absenden = this.knopf(this.t(registrieren ? 'login.submit_register' : 'login.submit_login'));
    absenden.disabled = this.busy;
    if (this.busy) absenden.textContent = this.t('login.loading');
    const abschicken = () => {
      void this.einloggenOderRegistrieren(registrieren ? 'register' : 'login', benutzer.value.trim(), email?.value.trim() ?? '', passwort.value);
    };
    absenden.addEventListener('click', abschicken);
    passwort.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abschicken(); });
    this.panel.appendChild(absenden);

    const wechseln = this.knopf(this.t(registrieren ? 'login.switch_to_login' : 'login.switch_to_register'), false);
    wechseln.addEventListener('click', () => {
      this.ansicht = registrieren ? 'anmelden' : 'registrieren';
      this.fehler = null;
      this.render();
    });
    this.panel.appendChild(wechseln);

    benutzer.focus();
  }

  private renderCharaktere(): void {
    if (this.charaktere.length === 0) {
      const leer = document.createElement('div');
      leer.style.cssText = `color:${UI.muted};font-size:13px;text-align:center;margin:10px 0`;
      leer.textContent = this.t('login.character.none');
      this.panel.appendChild(leer);
    }

    for (const c of this.charaktere) {
      const zeile = document.createElement('div');
      zeile.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0';

      const name = document.createElement('div');
      name.textContent = c.name;
      name.style.cssText = `flex:1;color:${UI.text};font-size:15px`;
      zeile.appendChild(name);

      const spielen = this.knopf(this.t('login.character.play'));
      spielen.style.width = 'auto';
      spielen.style.margin = '0';
      spielen.style.padding = '6px 16px';
      spielen.disabled = this.busy;
      spielen.addEventListener('click', () => void this.spielen(c.id));
      zeile.appendChild(spielen);

      const loeschen = this.knopf(this.t('login.character.delete'), false);
      loeschen.style.width = 'auto';
      loeschen.style.margin = '0';
      loeschen.style.padding = '6px 12px';
      loeschen.style.fontSize = '12px';
      loeschen.disabled = this.busy;
      loeschen.addEventListener('click', () => void this.loeschen(c.id));
      zeile.appendChild(loeschen);

      this.panel.appendChild(zeile);
    }

    const trenner = document.createElement('div');
    trenner.style.cssText = `border-top:1px solid ${UI.borderDim};margin:14px 0 10px`;
    this.panel.appendChild(trenner);

    const neuerName = this.feld('text', this.t('login.character.new_name'));
    this.panel.appendChild(neuerName);
    const anlegen = this.knopf(this.t('login.character.create'), false);
    anlegen.disabled = this.busy;
    const abschicken = () => { if (neuerName.value.trim()) void this.charakterAnlegen(neuerName.value.trim()); };
    anlegen.addEventListener('click', abschicken);
    neuerName.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') abschicken(); });
    this.panel.appendChild(anlegen);

    const abmelden = this.knopf(this.t('login.logout'), false);
    abmelden.style.marginTop = '18px';
    abmelden.style.fontSize = '12px';
    abmelden.addEventListener('click', () => {
      this.kontoToken = null;
      this.charaktere = [];
      this.fehler = null;
      this.ansicht = 'anmelden';
      this.render();
    });
    this.panel.appendChild(abmelden);
  }
}
