/**
 * ChatReichweite.ts (F14) — reine Logik dafür, WEN eine Chat-Nachricht
 * beim Broadcast überhaupt erreicht. Kennt weder Peer noch Socket
 * (gleiches Prinzip wie Drossel.ts) — testbar ohne Server.
 *
 * Die drei Reichweiten sind aus vorhandenen Referenzgrössen abgeleitet,
 * nicht frei erfunden:
 *
 *  - WHISPER (Flüstern): 12 m. Deutlich über der Nahkampfreichweite —
 *    "man steht sich gegenüber" —, aber klar unter einer ganzen Zone.
 *    Flüstern soll man nur hören, wenn man buchstäblich daneben steht.
 *    (Bezugsgrösse war WovServer.NAHKAMPF_REICHWEITE = 8 m. Seit Paket
 *    0.3 stehen dort 3,5 m; die 12 bleiben trotzdem. Sie waren nie ein
 *    Vielfaches der Reichweite, sondern die Distanz, auf die man sich
 *    noch zuraunt — wer flüstern will, soll nicht erst in Schlagweite
 *    treten müssen.)
 *  - NORMAL: 64 m = ZONE_SIZE (shared/src/constants.ts). Eine Zone ist
 *    im Server ohnehin die Einheit, in der Objekte/Kreaturen gruppiert
 *    und geladen werden (ZDOManager) — normales Reden trägt so weit wie
 *    die unmittelbare Umgebung.
 *  - SHOUT (Rufen): 256 m = 4 × ZONE_SIZE. Die 4 ist
 *    WovServer.SICHT_RADIUS_ZONEN (syncZDOs) — die Kante, bis zu der der
 *    Server überhaupt ZDOs an einen Peer streamt. Weiter zu rufen wäre
 *    wirkungslos: der Empfänger sieht den Rufer ja nicht einmal auf der
 *    eigenen Karte. (Der Wert steht hier als eigene Konstante, nicht als
 *    Import aus WovServer.ts — die Zahl ist eine private Klassenkonstante
 *    dort; sollte sie sich je ändern, muss diese Herleitung von Hand
 *    nachgezogen werden, s. Kommentar dort.)
 */
import { ChatMsgType, ZONE_SIZE, type Vector3 } from '@wov/shared';

const WHISPER_REICHWEITE_M = 12;
const NORMAL_REICHWEITE_M = ZONE_SIZE; // 64
/** s. WovServer.SICHT_RADIUS_ZONEN (syncZDOs) — Herleitung im Kopfkommentar. */
const SICHT_RADIUS_ZONEN = 4;
const SHOUT_REICHWEITE_M = SICHT_RADIUS_ZONEN * ZONE_SIZE; // 256

/**
 * Reichweite in Metern für einen Chat-Typ (ChatMsgType). Unbekannte Werte
 * — heute nur ChatMsgType.Ping, der noch an keine Oberfläche angebunden
 * ist — fallen auf NORMAL zurück, statt den ganzen Broadcast lahmzulegen.
 */
export function chatReichweite(chatType: number): number {
  switch (chatType) {
    case ChatMsgType.Whisper:
      return WHISPER_REICHWEITE_M;
    case ChatMsgType.Shout:
      return SHOUT_REICHWEITE_M;
    case ChatMsgType.Normal:
    default:
      return NORMAL_REICHWEITE_M;
  }
}

export interface ChatEmpfaengerKandidat {
  readonly id: string;
  /** Die Welt, in der der Kandidat steht (Hauptwelt oder eine Instanz). */
  readonly worldId: string;
  readonly position: Vector3;
}

/**
 * Wählt aus `kandidaten` die Empfänger einer Chat-Nachricht aus:
 * horizontale Entfernung (x/z — Höhe zählt nicht mit, gleiches Muster wie
 * ZDOManager.getZDOsInRadius und die Nahkampf-/Interaktions-Reichweiten
 * in WovServer.ts) innerhalb der Reichweite von `chatType`.
 *
 * Nur Kandidaten DERSELBEN Welt wie der Absender (`senderWorldId`) kommen
 * in Frage. Die Koordinaten zweier Welten sind nicht vergleichbar
 * (Instanzen liegen am Ursprung): Ohne die Weltprüfung hörte ein Spieler im
 * Dungeon jedes Flüstern, das in der Oberwelt auf denselben x/z fällt. Die
 * Prüfung steht VOR dem Absender-Sonderfall, damit er nicht an einer Welt
 * vorbeigeht — der Absender steht in seiner eigenen Welt ohnehin.
 *
 * Der Absender (`kandidaten`-Eintrag mit `id === senderId`) ist IMMER
 * dabei, unabhängig von der Reichweite — sonst wirkt der Chat für ihn
 * kaputt, sobald niemand sonst in der Nähe ist (ausdrückliche Vorgabe
 * der Aufgabe).
 */
export function waehleChatEmpfaenger<T extends ChatEmpfaengerKandidat>(
  kandidaten: readonly T[],
  senderId: string,
  senderWorldId: string,
  senderPosition: Vector3,
  chatType: number
): T[] {
  const reichweite = chatReichweite(chatType);
  const reichweiteQuadrat = reichweite * reichweite;
  return kandidaten.filter((k) => {
    if (k.worldId !== senderWorldId) return false;
    if (k.id === senderId) return true;
    const dx = k.position.x - senderPosition.x;
    const dz = k.position.z - senderPosition.z;
    return dx * dx + dz * dz <= reichweiteQuadrat;
  });
}

/**
 * Serverseitige Textlängengrenze (F14). Eine rein clientseitige Grenze
 * (z. B. `maxlength` im Eingabefeld) hält einen manipulierten oder
 * zweiten Client nie auf — deshalb hier, nicht nur in ChatPanel.ts.
 */
export const MAX_CHAT_LAENGE = 256;

/** Kappt `text` auf MAX_CHAT_LAENGE (bzw. `maxLaenge`). Reine Funktion,
 *  eigens benannt statt eines nackten `.slice()` im Handler, damit der
 *  Test dieselbe Funktion ruft, die auch WovServer.handleChatMessage
 *  benutzt. */
export function kuerzeChatText(text: string, maxLaenge = MAX_CHAT_LAENGE): string {
  return text.slice(0, maxLaenge);
}
