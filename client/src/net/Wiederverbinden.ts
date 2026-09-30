/**
 * F10 — Wiederverbinden nach Serverneustart (DOM-frei, getestet in
 * `client/test/f10-wiederverbinden.ts`).
 *
 * Ein Serverneustart (Ausrollen, Absturz) wirft den Spieler nicht mehr zur Anmeldung:
 * Der Client bleibt stehen, zeigt einen Zaehler und versucht es geduldig weiter.
 *
 *  - Erwartete Trennung (wiederholen): kein Grund (Netz weg, Server tot), der Grund
 *    `DISCONNECT_NEUSTART` (geplanter Stopp) und der Grund des Vorgaengers
 *    (`'Server shutting down'`, damit der erste Rollout mit dem alten Server auch hilft).
 *  - Jeder andere Grund ist ein Kick (gebannt, abgeloest, Konto geloescht, falsches Passwort):
 *    keine Wiederholung, zurueck zur Webseite.
 *  - Wartezeit 1, 2, 4, 8, 16, 32, 60, 60 … s (`WARTE_MAX_MS`); nach der Ansage des Servers
 *    wartet der erste Versuch mindestens `retryAfterSec`.
 *  - Nach `ZEITLIMIT_MS` ohne Erfolg wird aufgegeben (10 min: ein Ausrollen dauert 10 bis
 *    15 s, ein haengender Neustart oder ein ausgefallener Server soll aber bemerkt werden
 *    und den Spieler nicht ewig vor einem toten Bildschirm sitzen lassen).
 */
import { DISCONNECT_NEUSTART } from '@wov/shared';

/** Wartezeiten der ersten Versuche; danach gilt `WARTE_MAX_MS`. */
export const WARTE_FOLGE_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000];
/** Obergrenze des Abstands zwischen zwei Versuchen. */
export const WARTE_MAX_MS = 60_000;
/** Gesamtdauer ohne Erfolg, nach der aufgegeben wird. */
export const ZEITLIMIT_MS = 10 * 60_000;
/**
 * So lange muss die Verbindung nach `PeerInfo` halten, bevor die Serie (Zaehler, Backoff,
 * 10-min-Frist) zurueckgesetzt wird. Sperre und Meldung fallen schon bei `PeerInfo`. Grund: Ein
 * Server, dessen Beitrittsweg nach `PeerInfo` wirft und schliesst, schickt `PeerInfo` und trennt
 * ohne Grund; ein sofortiger Reset liesse den Client jede Sekunde neu verbinden, ohne je
 * aufzugeben (Kurzpruefung R1).
 */
export const HALTEZEIT_MS = 10_000;
/** Trenngrund des Vorgaengerstandes beim Stopp (alter Server waehrend des ersten Rollouts). */
const GRUND_ALT_NEUSTART = 'Server shutting down';

export interface Entscheidung {
  /** Wartezeit bis zum naechsten Versuch. */
  warteMs: number;
  /** true: kein weiterer Versuch, zurueck zur Webseite. */
  aufgeben: boolean;
}

/** Ist diese Trennung eine, nach der man es wieder versucht (kein Kick)? */
export function istErwarteteTrennung(reason: string | undefined): boolean {
  return !reason || reason === DISCONNECT_NEUSTART || reason === GRUND_ALT_NEUSTART;
}

/** Wartezeit vor dem Versuch Nummer `versuche + 1` (`versuche` = bisherige Versuche). */
export function wartezeitMs(versuche: number): number {
  return versuche < WARTE_FOLGE_MS.length ? WARTE_FOLGE_MS[versuche]! : WARTE_MAX_MS;
}

/**
 * Entscheidet nach einer Trennung.
 * @param versuche bisherige Wiederverbindungsversuche dieser Serie (0 bei der ersten Trennung)
 * @param verstrichenMs Zeit seit der ersten Trennung dieser Serie
 * @param ansageMs Wartezeit aus der Serverankuendigung (nur fuer den ersten Versuch)
 */
export function naechsterVersuch(
  reason: string | undefined,
  versuche: number,
  verstrichenMs = 0,
  ansageMs = 0
): Entscheidung {
  if (!istErwarteteTrennung(reason)) return { warteMs: 0, aufgeben: true };
  const basis = wartezeitMs(versuche);
  const warteMs = versuche === 0 ? Math.max(basis, ansageMs) : basis;
  if (verstrichenMs + warteMs > ZEITLIMIT_MS) return { warteMs: 0, aufgeben: true };
  return { warteMs, aufgeben: false };
}

/** Die drei Katalogschluessel dieses Moduls (client/src/i18n/katalog). */
export type WiederverbindenText = 'netz.neustart.ansage' | 'netz.verloren.versuch' | 'netz.verloren.verbinde';

export interface WiederverbindenOptionen {
  /** Baut die Verbindung neu auf. */
  verbinde: () => void;
  /** Stehende Bildschirmmeldung setzen; `null` nimmt sie weg. */
  zeige: (text: string | null) => void;
  uebersetze: (schluessel: WiederverbindenText, vars?: Record<string, string | number>) => string;
  /**
   * Eigene Eingabesperre der Wiederverbindung (`InputManager.netzGesperrt`): die Figur steht
   * waehrenddessen still. Bewusst NICHT `InputManager.gesperrt`: Die gehoert `TodTreffer`
   * (tot bis zur Wiederbelebung); zwei Besitzer einer Variablen loeschten sich gegenseitig
   * die Sperre. So gibt die Wiederverbindung nur ihre eigene frei.
   */
  sperre: { netzGesperrt: boolean };
  /** Wird gerufen, wenn die Serie OHNE eine Trennung von aussen endet (Zeitlimit nach einem Fehler beim Verbinden). */
  aufgegeben?: () => void;
  jetzt?: () => number;
  setzeTimer?: (fn: () => void, ms: number) => unknown;
  loescheTimer?: (handle: unknown) => void;
}

/** Zustand einer Wiederverbindungsserie; `main.ts` ruft nur diese drei Methoden. */
export class WiederverbindenSteuerung {
  private versuche = 0;
  /** Startzeit der Serie (monotone Uhr: ein Uhrsprung aendert Wartezeit und Zeitlimit nicht). */
  private start = 0;
  private ansageMs = 0;
  private timer: unknown = null;
  /** Wartet nach `PeerInfo` die Haltezeit ab, erst dann ist die Serie zurueckgesetzt. */
  private haltTimer: unknown = null;
  /** Uhrzeit der Annahme (`PeerInfo`): die Haltezeit gilt nach der Uhr, auch wenn der Timer (Tab eingefroren) zu spaet kommt. */
  private angenommenAb: number | null = null;
  private readonly jetzt: () => number;
  private readonly setzeTimer: (fn: () => void, ms: number) => unknown;
  private readonly loescheTimer: (handle: unknown) => void;

  constructor(private readonly opt: WiederverbindenOptionen) {
    this.jetzt = opt.jetzt ?? (() => performance.now());
    this.setzeTimer = opt.setzeTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.loescheTimer = opt.loescheTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Wie viele Versuche der laufenden Serie begonnen wurden (0 = verbunden). */
  get anzahlVersuche(): number {
    return this.versuche;
  }

  /** Serverankuendigung (`ServerNeustart`): Text zeigen, ersten Versuch verzoegern. */
  ansage(retryAfterSec: number): void {
    this.ansageMs = Math.max(0, Math.min(retryAfterSec, WARTE_MAX_MS / 1000)) * 1000;
    this.opt.zeige(this.opt.uebersetze('netz.neustart.ansage'));
  }

  /**
   * Die Verbindung ist weg. Liefert `true`, wenn neu verbunden wird (Zaehler laeuft),
   * `false`, wenn aufgegeben ist (Kick oder Zeitlimit; Meldung und Sperre sind dann weg).
   */
  beiGetrennt(reason: string | undefined): boolean {
    this.stoppeHaltTimer(); // nicht lange genug gehalten: die Serie laeuft weiter, der Backoff waechst
    // Nach der Uhr lange genug gehalten, der Haltetimer aber nicht rechtzeitig gelaufen (eingefrorener
    // oder gedrosselter Tab): die Serie gilt als erledigt, wie beim Haltetimer (Nachpruefung B1/B3).
    if (this.angenommenAb !== null && this.jetzt() - this.angenommenAb >= HALTEZEIT_MS) this.versuche = 0;
    this.angenommenAb = null;
    if (this.versuche === 0) this.start = this.jetzt();
    const e = naechsterVersuch(reason, this.versuche, this.jetzt() - this.start, this.ansageMs);
    if (e.aufgeben) {
      this.beende();
      return false;
    }
    this.versuche++;
    this.ansageMs = 0;
    this.opt.sperre.netzGesperrt = true;
    this.zaehle(this.jetzt() + e.warteMs);
    return true;
  }

  /**
   * Der Transport steht (Anmeldepaket ist raus). Bewusst KEIN Zuruecksetzen: Ein Server, der den
   * Handshake annimmt und danach ohne Grund schliesst, wuerde sonst jede Serie auf 1 s
   * zuruecksetzen und nie aufgegeben werden (Angriff F1). Zurueck auf Null geht es erst
   * in `beiAngenommen()`.
   */
  beiVerbunden(): void {
    // nichts: die Serie laeuft weiter, bis der Server den Spieler angenommen hat
  }

  /**
   * Der Server hat den Spieler angenommen (`PeerInfo`): Figur freigeben, Meldung weg. Zaehler,
   * Backoff und Frist bleiben, bis die Verbindung `HALTEZEIT_MS` gehalten hat; trennt der Server
   * vorher, zaehlt der Versuch als gescheitert (`beiGetrennt` stoppt den Haltetimer).
   */
  beiAngenommen(): void {
    this.stoppeHaltTimer();
    this.angenommenAb = this.jetzt();
    if (this.timer !== null) this.loescheTimer(this.timer);
    this.timer = null;
    const warGetrennt = this.versuche > 0 || this.ansageMs > 0;
    this.ansageMs = 0;
    if (warGetrennt) {
      this.opt.sperre.netzGesperrt = false;
      this.opt.zeige(null);
    }
    if (this.versuche > 0) {
      this.haltTimer = this.setzeTimer(() => {
        this.haltTimer = null;
        this.angenommenAb = null;
        this.versuche = 0;
      }, HALTEZEIT_MS);
    }
  }

  private stoppeHaltTimer(): void {
    if (this.haltTimer !== null) this.loescheTimer(this.haltTimer);
    this.haltTimer = null;
  }

  private zaehle(zielMs: number): void {
    // Nie zwei Zaehler gleichzeitig: ein alter Timer wuerde einen zweiten Verbindungsversuch ausloesen.
    if (this.timer !== null) this.loescheTimer(this.timer);
    this.timer = null;
    const rest = zielMs - this.jetzt();
    if (rest <= 0) {
      this.opt.zeige(this.opt.uebersetze('netz.verloren.verbinde'));
      this.timer = null;
      try {
        this.opt.verbinde();
      } catch (fehler) {
        // F2: Wirft das Verbinden (ungueltige Adresse, Browser verweigert), zaehlt der Versuch
        // als gescheitert; sonst bliebe die Sperre ohne Ausweg stehen.
        console.error('[Wiederverbinden] Verbinden fehlgeschlagen:', fehler);
        if (!this.beiGetrennt('')) this.opt.aufgegeben?.();
      }
      return;
    }
    this.opt.zeige(
      this.opt.uebersetze('netz.verloren.versuch', { sekunden: Math.ceil(rest / 1000), versuch: this.versuche })
    );
    this.timer = this.setzeTimer(() => this.zaehle(zielMs), Math.min(rest, 1000));
  }

  private beende(): void {
    this.stoppeHaltTimer();
    this.angenommenAb = null;
    if (this.timer !== null) this.loescheTimer(this.timer);
    this.timer = null;
    const warGetrennt = this.versuche > 0 || this.ansageMs > 0;
    this.versuche = 0;
    this.ansageMs = 0;
    if (warGetrennt) {
      this.opt.sperre.netzGesperrt = false;
      this.opt.zeige(null);
    }
  }
}
