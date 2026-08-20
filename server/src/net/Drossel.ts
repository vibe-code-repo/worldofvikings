/**
 * Drossel.ts — Token-Bucket-Drosselung je Peer und Pakettyp (Roadmap A4).
 *
 * Reine Rechenlogik, KEINE Verdrahtung: Dieses Modul beantwortet nur die
 * Frage "darf dieser Peer JETZT ein Paket dieses Typs schicken?". Was bei
 * einer Ablehnung passiert (verwerfen, Meldung an den Client, bei grober
 * Überschreitung trennen), entscheidet der Einbau in NetManager/WovServer
 * — dieses Modul kennt weder Peer noch Socket.
 *
 * Zwei Zahlen je Pakettyp, mit Absicht getrennt (DrosselKonfiguration):
 *  - `eimergroesse`: wie viele Pakete in einem einzigen Stoß ohne jede
 *    Wartezeit durchgehen. Das ist die Toleranz für "mehrere Aktionen
 *    kurz hintereinander" — ein Doppelklick, ein Nachholen nach einem
 *    Ruckler, eine Warteschlange von Klicks, die sich waehrend eines
 *    kurzen Lags angestaut hat.
 *  - `fuellrateProSekunde`: wie viele Token pro Sekunde nachwachsen (bis
 *    zur Eimergröße als Deckel). Das ist der Dauerdurchsatz, den ein
 *    Sender auf ewig halten darf, ohne dass der Eimer je wieder leer
 *    bleibt.
 *  Beide zusammen beschreiben eine andere Kurve als ein einzelner
 *  Cooldown-Wert: ein Cooldown von 300 ms (wie bisher bei Chat) erlaubt
 *  NIEMALS einen Stoß von mehr als einem Paket, ein Eimer der Größe 1
 *  tut exakt das — deshalb bleibt die Eimergröße unten dort bei 1
 *  stehen, wo bisher ein reiner Cooldown lag (Chat, Schlag): das Modul
 *  reproduziert das alte Verhalten exakt, statt es beim Ersetzen
 *  stillschweigend zu lockern.
 *
 * Keine eigene Uhr: `jetzt` (ms, wie Date.now()) kommt bei jedem Aufruf
 * von AUSSEN herein — sonst lässt sich das Modul nicht ohne echten
 * Zeitablauf testen (gleiches Muster wie peer.letzterSchlag/letzterChat
 * im Server, nur nicht länger an Date.now() im Rumpf gebunden).
 *
 * Speicher: ein Eimer entsteht erst beim ersten Paket eines Peers für
 * einen bestimmten Pakettyp (kein Vorbelegen aller Typen für jeden
 * Peer). raeumeAufFuerPeer() nimmt beim Verbindungsabbau den gesamten
 * Zustand eines Peers wieder heraus — sonst wächst die Map über die
 * Laufzeit des Servers mit jedem jemals verbundenen Peer weiter, auch
 * wenn er längst weg ist.
 *
 * Herleitung der Vorgaben (Abschätzung aus Spielverhalten, keine
 * Messung): ein Mensch platziert keine 50 Bauteile pro Sekunde, aber ein
 * Skript kann Pakete so schnell abschicken, wie das Netz sie annimmt.
 * Die Grenzen unten liegen bewusst über dem, was ein zügiger Spieler je
 * erreicht — ein falscher Alarm gegen einen echten Spieler kostet mehr
 * Vertrauen, als ein paar zu viele Pakete von einem Bot kosten, den man
 * ohnehin noch anhand des Musters (dauerhaft am Limit) erkennt — aber
 * weit unter dem, was ein Netzwerkstapel an Paketen durchsetzt, wenn
 * niemand bremst.
 */

import { PacketType } from '@wov/shared';

export interface DrosselKonfiguration {
  /** Erlaubter Stoß: Pakete, die ohne Wartezeit hintereinander durchgehen. */
  eimergroesse: number;
  /** Dauerdurchsatz: Token, die pro Sekunde nachwachsen (gedeckelt durch eimergroesse). */
  fuellrateProSekunde: number;
}

/**
 * Vorgaben je Pakettyp. Nur Typen mit einem Eintrag werden gedrosselt —
 * ein Pakettyp ohne Eintrag ist in erlaubt() bewusst ungedrosselt (siehe
 * dort), damit dieselbe STANDARD_DROSSEL-Tabelle auch als Teilmenge
 * (nur die Typen, die man tatsächlich einbauen will) benutzt werden
 * kann, ohne den Rest des Servers unbeabsichtigt zu bremsen.
 */
export const STANDARD_DROSSEL: ReadonlyMap<PacketType, DrosselKonfiguration> = new Map([
  // Bisher: fester Cooldown 300 ms, kein Stoß (WovServer.ts, peer.letzterChat).
  // Eimergröße 1 reproduziert das exakt; die Füllrate 1/0,3 s hält den
  // gleichen Dauerdurchsatz. Chat ist getippter Text — ein Mensch tippt
  // keine zwei Nachrichten in derselben Zehntelsekunde ab.
  [PacketType.ChatMessage, { eimergroesse: 1, fuellrateProSekunde: 1 / 0.3 }],

  // Bisher: fester Cooldown 350 ms (WovServer.SCHLAG_COOLDOWN_MS). Gleiche
  // Überlegung wie Chat: Eimergröße 1 reproduziert den bisherigen strikten
  // Gate, keine Verhaltensänderung beim späteren Ersetzen.
  [PacketType.Attack, { eimergroesse: 1, fuellrateProSekunde: 1 / 0.35 }],

  // PlacePiece/RemovePiece hatten bisher GAR KEIN Limit. Ein Mensch, der
  // eine Fundamentreihe im Baumenü durchklickt, schafft kurzzeitig
  // 4-5 Klicks/s; ein Stoß von 8 deckt "die Leiste schnell durchklicken"
  // ab, ohne den anschließenden Dauerbau zu bremsen, solange der Spieler
  // in vernünftigem Tempo weiterbaut. Füllrate 4/s = ein Bauteil alle
  // 250 ms im Dauerbetrieb — schneller hält kein Mensch ohne Makro durch.
  // RemovePiece bekommt dieselbe Zahl: Abriss ist dieselbe Klickbewegung
  // wie Aufbau, nur umgekehrt.
  [PacketType.PlacePiece, { eimergroesse: 8, fuellrateProSekunde: 4 }],
  [PacketType.RemovePiece, { eimergroesse: 8, fuellrateProSekunde: 4 }],

  // TerrainOp kommt, solange die Grabhacke gehalten und die Maus bewegt
  // wird — ähnlich häufig wie Platzieren, aber jede einzelne Operation
  // ist server-seitig teurer (Heightmap-Schreibzugriff plus Nachsetzen
  // aller Objekte im Wirkradius, siehe handleTerrainOp), deshalb knapper
  // bemessen als PlacePiece.
  [PacketType.TerrainOp, { eimergroesse: 6, fuellrateProSekunde: 3 }],

  // Craft: ein Klick pro Rezept, meist Einzelklicks mit kurzer Überlegung
  // dazwischen. Ein Stoß von 5 deckt eine Warteschlange angesammelter
  // Klicks ab (z. B. nach dem Öffnen des Baumenüs mehrere Rezepte
  // nacheinander bestätigen), die Füllrate 2/s lässt kein Dauerfeuer zu.
  [PacketType.Craft, { eimergroesse: 5, fuellrateProSekunde: 2 }],

  // Interact (Taste E) wird wie Attack oft schnell hintereinander
  // gedrückt (Ernten, Türen, Altar), hat aber anders als Attack keinen
  // clientseitigen Animations-Cooldown, der es von sich aus bremst.
  // Gleiche Größenordnung wie Attack, im Stoß etwas großzügiger, weil
  // hier zusätzlich ganz legitime vereinzelte Klicks (eine Tür öffnen)
  // ohne jede Vorgeschichte im Eimer ankommen können.
  [PacketType.Interact, { eimergroesse: 4, fuellrateProSekunde: 1 / 0.3 }],

  // AdminCommand ist getippter Text und heute wegen everyone-admin:true
  // wirkungslos gegated (siehe Befund) — gerade deshalb soll wenigstens
  // die RATE nicht offen sein. Ein Mensch tippt keine 5 Befehle pro
  // Sekunde; ein Stoß von 3 deckt das Ausprobieren mehrerer Kurzbefehle
  // in Folge ab.
  [PacketType.AdminCommand, { eimergroesse: 3, fuellrateProSekunde: 1 }],

  // DungeonEditSave schreibt ein ganzes Dungeon-Dokument auf die Platte
  // (Editor-Speichern-Knopf). Selten und bewusst knapp gehalten: ein
  // Stoß von 2 lässt "einmal speichern, gleich danach eine Korrektur
  // nachspeichern" zu, mehr nicht — Dauerfeuer auf diesem Paket wäre
  // ausschließlich ein Angriff auf die Festplatte, kein Spielverhalten.
  [PacketType.DungeonEditSave, { eimergroesse: 2, fuellrateProSekunde: 1 / 2 }],

  // PlayerInput ist der bewusste SONDERFALL: der Client sendet FEST mit
  // 20 Hz (client/src/main.ts, INPUT_SEND_RATE_MS) — das ist keine
  // mögliche Spitzenlast, sondern der Normalbetrieb jedes einzelnen
  // verbundenen Spielers, ununterbrochen. Die Füllrate liegt deshalb
  // deutlich ÜBER 20/s (25/s), damit Jitter durch schwankende Frame-Zeit
  // niemals einen echten Spieler ausbremst; die Eimergröße 30 (= 1,5 s
  // Vorrat bei 20 Hz) fängt einen kurzen Ruckler oder Lag-Spike ab, nach
  // dem der Client mehrere fällige Pakete nachschickt, ohne dass die
  // Drosselung dabei anschlägt. Ein Bot, der PlayerInput missbraucht,
  // gewinnt dadurch nichts Spielrelevantes — die Bewegung ist ohnehin
  // serverautoritativ nachgerechnet (handlePlayerInput klemmt Werte und
  // Geschwindigkeit) — deshalb ist hier großzügiger sein sinnvoller als
  // bei den anderen Typen, bei denen jedes einzelne Paket eine Wirkung
  // auf die Welt hat, die ein Bot ausnutzen könnte.
  [PacketType.PlayerInput, { eimergroesse: 30, fuellrateProSekunde: 25 }],
]);

/** Eimerzustand für genau einen Peer und genau einen Pakettyp. */
interface Eimer {
  token: number;
  /** Zeitpunkt (ms) des letzten Aufrufs, der den Eimer tatsächlich
   *  aufgefüllt hat — siehe erlaubt() zum Umgang mit Zeitsprüngen. */
  letzteAktualisierung: number;
}

export class Drossel {
  private readonly konfiguration: ReadonlyMap<PacketType, DrosselKonfiguration>;
  private readonly zustand = new Map<string, Map<PacketType, Eimer>>();

  constructor(konfiguration: ReadonlyMap<PacketType, DrosselKonfiguration> = STANDARD_DROSSEL) {
    this.konfiguration = konfiguration;
  }

  /**
   * Beantwortet "darf `peerId` jetzt ein Paket vom Typ `typ` schicken?"
   * und verbraucht bei Ja sofort ein Token. Ein Pakettyp ohne Eintrag in
   * der Konfiguration ist ungedrosselt (liefert immer true).
   *
   * `peerId` ist absichtlich ein einfacher string statt eines Peer/
   * userId-Typs — welche Kennung stabil genug ist (Name? userId als
   * String?), entscheidet der Einbau, nicht dieses Modul.
   *
   * `jetzt`: Date.now()-kompatibler Zeitstempel in Millisekunden, IMMER
   * von außen übergeben (siehe Kopfkommentar).
   */
  erlaubt(peerId: string, typ: PacketType, jetzt: number): boolean {
    const konfig = this.konfiguration.get(typ);
    if (!konfig) return true;

    let proPeer = this.zustand.get(peerId);
    if (!proPeer) {
      proPeer = new Map();
      this.zustand.set(peerId, proPeer);
    }

    let eimer = proPeer.get(typ);
    if (!eimer) {
      // Neuer Eimer startet VOLL: die erste Aktion eines frisch
      // verbundenen Peers soll nicht schon an der Drosselung scheitern.
      eimer = { token: konfig.eimergroesse, letzteAktualisierung: jetzt };
      proPeer.set(typ, eimer);
    } else {
      // Nur VORWÄRTS auffüllen. Bei einem Zeitsprung rückwärts (verstellte
      // Systemuhr, NTP-Korrektur) bleibt `letzteAktualisierung` stehen,
      // statt aus einem negativen Delta Token zu erzeugen oder gar
      // abzuziehen — und bleibt danach auch die Bezugsgröße für den
      // nächsten Aufruf: Springt die Uhr wieder vor, zählt nur die Spanne
      // ab dem zuletzt GESEHENEN Zeitpunkt, nie ab dem kurzzeitig
      // verstellten. Ohne dieses Stehenbleiben würde ein
      // Rückwärts-dann-Vorwärts-Sprung ein riesiges Delta vortäuschen und
      // den Eimer mit einem Schlag randvoll machen — das wäre die
      // "unendlichen Token"-Lücke, die die Uhr-von-außen-Regel eigentlich
      // vermeiden soll, wenn man sie nicht auch hier beachtet.
      const deltaMs = jetzt - eimer.letzteAktualisierung;
      if (deltaMs > 0) {
        const nachschub = (deltaMs / 1000) * konfig.fuellrateProSekunde;
        eimer.token = Math.min(konfig.eimergroesse, eimer.token + nachschub);
        eimer.letzteAktualisierung = jetzt;
      }
    }

    if (eimer.token < 1) return false;
    eimer.token -= 1;
    return true;
  }

  /**
   * Zustand eines Peers vollständig entfernen (Verbindungsabbau). Ohne
   * diesen Aufruf beim Trennen wächst `zustand` mit jedem jemals
   * verbundenen Peer unbegrenzt weiter.
   */
  raeumeAufFuerPeer(peerId: string): void {
    this.zustand.delete(peerId);
  }

  /** Für Tests/Diagnose: wie viele Peers derzeit überhaupt Zustand belegen. */
  get bekanntePeers(): number {
    return this.zustand.size;
  }
}
