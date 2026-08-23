/**
 * ChatPanel (F14) — Verlauf unten links + Eingabezeile. Enter öffnet die
 * Zeile bzw. sendet die getippte Nachricht und schliesst wieder, Escape
 * bricht ohne Senden ab. Nicht modal: das Spiel läuft beim Tippen weiter.
 *
 * Verdrahtung des Zeiger-/WASD-Abgebens folgt exakt dem Muster der
 * anderen Maus-Panels (main.ts, cursorNoetig/onMenuKey): Öffnen macht
 * main.ts über `input.onMenuKey('Enter', …)`, weil ein neuer Lock später
 * eine echte Nutzergeste braucht (Gecko) — dasselbe Bedürfnis wie beim
 * Schliessen, deshalb ruft `abschliessen()` unten dieselbe Geste-Regel
 * über den `wiederFangen`-Callback auf, der in main.ts auf
 * `input.captureFromGesture()` zeigt.
 *
 * WARUM `stopPropagation()` im eigenen keydown-Handler: InputManager
 * hört jedes keydown auf `window`-Ebene ab, unabhängig vom Fokus (siehe
 * dort) — ohne den Stopp würde z. B. das Tippen von "sag" das Zeichen
 * "s" als WASD-Rückwärtstaste an die Figur weiterreichen und sie
 * loslaufen lassen, während man schreibt. Genau der Fehler, vor dem die
 * Aufgabe warnt ("das macht jedes Spiel mit nachgerüstetem Chat einmal").
 * Enter/Escape werden deshalb NICHT ans Fenster durchgereicht, sondern
 * hier selbst behandelt.
 */
import { ChatMsgType } from '@wov/shared';

const MAX_VERLAUF = 50;
/**
 * Rein clientseitige Grenze fürs Eingabefeld (UX: kein sinnloses
 * Weitertippen). Durchgesetzt wird die Länge serverseitig
 * (server/src/spiel/ChatReichweite.ts MAX_CHAT_LAENGE) — ein
 * manipulierter Client hält sich an dieses `maxlength` nicht.
 */
const MAX_LAENGE_CLIENT = 256;

interface VerlaufEintrag {
  readonly senderName: string;
  readonly chatType: number;
  readonly text: string;
}

const TYP_PRAEFIX: Partial<Record<number, string>> = {
  [ChatMsgType.Whisper]: 'flüstert',
  [ChatMsgType.Shout]: 'ruft',
};

const TYP_FARBE: Partial<Record<number, string>> = {
  [ChatMsgType.Whisper]: '#a8916a',
  [ChatMsgType.Shout]: '#f2c86a',
};
const FARBE_NORMAL = '#e8d9b8';

export class ChatPanel {
  private readonly verlaufEl: HTMLDivElement;
  private readonly eingabeEl: HTMLInputElement;
  private readonly eintraege: VerlaufEintrag[] = [];
  private offen = false;

  constructor(
    /** main.ts verdrahtet das auf `socket?.sendChat(text, chatType)`. */
    private readonly senden: (text: string, chatType: number) => void,
    /** Zeiger zurückfordern, wenn die Eingabe schliesst — main.ts prüft
     *  dort selbst, ob noch ein anderes Panel offen ist. */
    private readonly wiederFangen: () => void
  ) {
    this.verlaufEl = document.createElement('div');
    this.verlaufEl.style.cssText =
      'position:fixed;left:8px;bottom:76px;width:340px;max-height:160px;overflow-y:auto;' +
      'display:flex;flex-direction:column;gap:2px;font:13px sans-serif;' +
      'pointer-events:none;z-index:4;text-shadow:0 1px 2px #000';
    document.body.appendChild(this.verlaufEl);

    this.eingabeEl = document.createElement('input');
    this.eingabeEl.type = 'text';
    this.eingabeEl.maxLength = MAX_LAENGE_CLIENT;
    this.eingabeEl.placeholder = 'Nachricht … (Enter senden, Esc abbrechen)';
    this.eingabeEl.style.cssText =
      'position:fixed;left:8px;bottom:34px;width:340px;display:none;z-index:5;' +
      'font:13px sans-serif;padding:5px 8px;border-radius:4px;box-sizing:border-box;' +
      'background:rgba(20,15,9,.85);border:1px solid #8a6a34;color:#e8d9b8;outline:none';
    document.body.appendChild(this.eingabeEl);

    this.eingabeEl.addEventListener('keydown', (e) => {
      // s. Kopfkommentar: JEDE Taste bleibt bei diesem Feld, nur Enter
      // (senden) und Escape (abbrechen) lösen etwas im Spiel aus.
      e.stopPropagation();
      if (e.code === 'Enter') {
        e.preventDefault();
        this.abschliessen(true);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.abschliessen(false);
      }
    });
    // KEIN stopPropagation() hier (anders als im keydown-Handler oben):
    // waere ein WASD-Keydown VOR dem Oeffnen des Chats erfolgt (Taste noch
    // gehalten), muesste das zugehoerige keyup trotzdem bis zu InputManager
    // durchkommen, sonst bleibt der Code in dessen `keys`-Set haengen und die
    // Figur laeuft nach dem Schliessen des Chats unkontrolliert weiter, bis
    // dieselbe Taste ausserhalb des Chats noch einmal gedrueckt UND
    // losgelassen wird. Ungefaehrlich: InputManager.keys.delete() auf einem
    // Code, der (wegen des keydown-Stopps) nie eingetragen wurde, ist ein
    // No-op.
  }

  get istOffen(): boolean {
    return this.offen;
  }

  /**
   * Von main.ts über `input.onMenuKey('Enter', …)` gerufen, wenn die
   * Zeile noch zu ist — läuft also synchron in der Tastendruck-Geste,
   * die InputManager für die anschliessende Zeiger-Freigabe braucht.
   */
  oeffnen(): void {
    if (this.offen) return;
    this.offen = true;
    this.eingabeEl.style.display = 'block';
    this.eingabeEl.value = '';
    this.eingabeEl.focus();
  }

  private abschliessen(senden: boolean): void {
    const text = this.eingabeEl.value.trim();
    this.offen = false;
    this.eingabeEl.style.display = 'none';
    this.eingabeEl.blur();
    if (senden && text) this.senden(text, ChatMsgType.Normal);
    this.wiederFangen();
  }

  /**
   * Eingehende Nachricht — eigene wie fremde. Der Server spiegelt die
   * eigene Nachricht immer mit (WovServer.handleChatMessage /
   * waehleChatEmpfaenger), ChatPanel muss sie also nicht selbst vorab
   * anzeigen.
   */
  empfangen(senderName: string, chatType: number, text: string): void {
    this.eintraege.push({ senderName, chatType, text });
    while (this.eintraege.length > MAX_VERLAUF) this.eintraege.shift();
    this.neuZeichnen();
  }

  private neuZeichnen(): void {
    this.verlaufEl.textContent = '';
    for (const e of this.eintraege) {
      const zeile = document.createElement('div');
      const praefix = TYP_PRAEFIX[e.chatType];
      const farbe = TYP_FARBE[e.chatType] ?? FARBE_NORMAL;
      zeile.style.cssText =
        `color:${farbe};background:rgba(0,0,0,.4);padding:2px 6px;border-radius:3px;width:fit-content;max-width:100%`;
      zeile.textContent = praefix ? `${e.senderName} ${praefix}: ${e.text}` : `${e.senderName}: ${e.text}`;
      this.verlaufEl.appendChild(zeile);
    }
    // Neueste Nachricht sichtbar halten, statt sie unten aus dem
    // begrenzten `max-height` herauslaufen zu lassen.
    this.verlaufEl.scrollTop = this.verlaufEl.scrollHeight;
  }
}
