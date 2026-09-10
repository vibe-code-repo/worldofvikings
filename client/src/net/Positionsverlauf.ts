/**
 * Positionsverlauf.ts — Abgleich Client↔Server gegen die Clientposition
 * ZUM ZEITPUNKT der bestätigten Eingabe.
 *
 * Das Problem, das hier gelöst wird (gemessen, nicht vermutet): Der
 * Server meldet seine Spielerposition im `PlayerState`-Paket. Diese
 * Position ist zwangsläufig ALT — sie entstand aus einer Eingabe, die
 * der Client vor einer halben Netzrunde abgeschickt hat, und der Client
 * ist seitdem weitergelaufen. Der bisherige Abgleich in `main.ts`
 * verglich diese alte Serverposition mit der AKTUELLEN Clientposition;
 * die Differenz war deshalb im Gehen wie im Sprint dauerhaft mehrere
 * Meter groß, obwohl beide Seiten dieselbe Bewegung rechnen. Über 1,5 m
 * zog der Abgleich die Figur weich zurück — jedes Mal, ununterbrochen.
 * Genau das hat Mike als „wirkt wie Lag" gemeldet.
 *
 * Die Zahl, die verglichen werden MUSS, ist also nicht
 *
 *     serverPos  −  clientPos(jetzt)          ← enthält die Latenz
 *
 * sondern
 *
 *     serverPos  −  clientPos(als Eingabe `seq` abging)
 *
 * Der Server schickt seit F6 die zuletzt verarbeitete Sequenznummer im
 * PlayerState mit (`WovServer.sendPlayerState`, Feld `seq`), und seit
 * dem Umbau desselben Tages steht dieser Versand NACH der
 * Positionsberechnung — der gemeldete `seq` gehört damit wirklich zur
 * gemeldeten Position. Der Client muss dazu nur wissen, wo er stand,
 * als er `seq` abschickte: das ist dieser Verlauf.
 *
 * KEIN Replay. Der Client fährt Havok; eine Eingabefolge lässt sich
 * nicht deterministisch nachspielen. Stattdessen wird der so gemessene
 * VERSATZ (serverPos − clientPos(seq)) auf die aktuelle Position
 * angewandt — weich über τ, hart nur, wenn die Wahrheiten wirklich
 * auseinandergelaufen sind.
 *
 * Warum „hart" trotzdem auf die Serverposition SETZT statt den Versatz
 * anzuwenden: Nach einem Teleport (Admin, Dungeon-Ein-/Ausstieg,
 * Respawn) steht im Verlauf noch der alte Ort. Ein Versatz aus diesem
 * Bezug wäre die Teleportstrecke selbst und würde die Figur ein zweites
 * Mal um diese Strecke versetzen. Das Setzen auf die Serverposition
 * heilt diesen Fall von selbst und ist zugleich unverändert das, was
 * der Abgleich bisher über 8 m tat.
 */

import { verwerfeBestaetigteEingaben } from './Eingabeverwerfung.js';

export interface VerlaufPunkt {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Punkt3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Ringpuffer über die zuletzt gesendeten Eingaben und die Position, die
 * der Client bei ihrem Absenden hatte.
 *
 * „Ring" heißt hier: feste Obergrenze, ältester Eintrag fällt hinten
 * heraus (FIFO). 64 Einträge sind bei 20 Hz Eingabetakt gut 3 Sekunden
 * Geschichte — ein Vielfaches jeder Netzrunde, die ein spielbarer
 * Server zulässt, und trotzdem so klein, dass ein lineares Suchen darin
 * nichts kostet.
 */
export class Positionsverlauf {
  private eintraege: VerlaufPunkt[] = [];

  constructor(private readonly kapazitaet = 64) {}

  get laenge(): number {
    return this.eintraege.length;
  }

  /** Position festhalten, mit der die Eingabe `seq` abgeschickt wurde. */
  merke(seq: number, x: number, y: number, z: number): void {
    this.eintraege.push({ seq, x, y, z });
    if (this.eintraege.length > this.kapazitaet) {
      this.eintraege.splice(0, this.eintraege.length - this.kapazitaet);
    }
  }

  /** Der Punkt zu genau dieser Sequenznummer, oder null (zu alt/unbekannt). */
  hole(seq: number): VerlaufPunkt | null {
    for (let i = this.eintraege.length - 1; i >= 0; i -= 1) {
      const e = this.eintraege[i]!;
      if (e.seq === seq) return e;
    }
    return null;
  }

  /**
   * Alles verwerfen, was ÄLTER ist als `seq` — der Eintrag zu `seq`
   * selbst bleibt liegen.
   *
   * Warum er bleibt: Ein zweites PlayerState mit derselben `seq` kommt
   * regelmäßig vor (Schaden, Respawn, Vitals senden dasselbe Paket
   * außer der Reihe). Würde `seq` mitverworfen, fände der zweite
   * Vergleich seinen Bezugspunkt nicht mehr und fiele auf das alte
   * Verhalten zurück — ausgerechnet in dem Moment, in dem die Figur
   * gerade getroffen wurde.
   *
   * Gerechnet wird mit `verwerfeBestaetigteEingaben` (F6), der bereits
   * getesteten Regel: sie behält, was NEUER ist als die übergebene
   * Marke; `seq - 1` als Marke behält deshalb `seq` selbst.
   */
  verwirfAelterAls(seq: number): void {
    this.eintraege = verwerfeBestaetigteEingaben(this.eintraege, seq - 1);
  }

  /** Verlauf komplett vergessen (Teleport, Weltwechsel). */
  leere(): void {
    this.eintraege = [];
  }
}

export interface AbgleichRegeln {
  /** Weiche Schwelle, wenn der Bezugspunkt aus dem Verlauf kam (m). */
  readonly weich: number;
  /** Weiche Schwelle im Rückfall auf das alte Verhalten (m). */
  readonly weichRueckfall: number;
  /** Ab hier wird hart auf die Serverposition gesetzt (m). */
  readonly hart: number;
  /** Zeitkonstante des weichen Nachziehens (s). */
  readonly tau: number;
}

/**
 * Die Zahlen.
 *
 * `weich` = 1,0 m. Der Gedanke war 0,5 m: Mit dem verlaufsbezogenen
 * Vergleich steckt die Latenz nicht mehr in der Differenz, die alte
 * 1,5-m-Schwelle musste die Netzrunde mit abdecken. Die Messung (12 s
 * Gehen auf freiem Feld, ~150 PlayerState-Pakete) sagt dazu:
 *
 *   • Im STAND liegen Client und Server 0,06 m auseinander — der
 *     Bodensatz der Rechnung selbst.
 *   • IN BEWEGUNG pendelt der Abstand zwischen 0,3 und 0,6 m, auch wenn
 *     nichts im Weg steht. Das ist der Preis dafür, dass beide Seiten
 *     dieselbe Bewegung mit verschiedenen Mitteln rechnen: Havok-Kapsel
 *     gegen feste Schritte auf der Heightmap.
 *
 * Eine Schwelle von 0,5 m liegt damit MITTEN im Rauschen — gemessen
 * 33 Eingriffe in 12 s Gehen, also alle 0,4 s einer. 1,0 m liegt
 * darüber und lässt genau das stehen, wogegen kein Nachziehen hilft.
 * Wer die Schwelle weiter senken will, muss zuerst den Auseinanderlauf
 * selbst kleiner machen, nicht die Zahl.
 *
 * `weichRueckfall` = 1,5 m: Findet sich kein Bezugspunkt, wird wieder
 * gegen die aktuelle Position verglichen; dann gilt auch wieder die
 * alte, latenztolerante Schwelle. Eine engere Schwelle auf einen
 * latenzbehafteten Vergleich losgelassen wäre schlechter als vorher.
 *
 * `hart` = 8 m und `tau` = 0,4 s: unverändert aus `main.ts`.
 */
export const ABGLEICH_STANDARD: AbgleichRegeln = {
  weich: 1.0,
  weichRueckfall: 1.5,
  hart: 8,
  tau: 0.4,
};

export type AbgleichBefehl =
  /** Hart auf diese Stelle setzen. `y === null`: y des Clients behalten (Dungeon). */
  | { readonly art: 'setzen'; readonly x: number; readonly y: number | null; readonly z: number }
  /** Weich um diesen Betrag schieben (Anteil dieses Bildes). */
  | { readonly art: 'schieben'; readonly dx: number; readonly dy: number; readonly dz: number };

export interface AbgleichDiagnose {
  /** Wie oft der Abgleich überhaupt eingegriffen hat (weich + hart). */
  readonly ereignisse: number;
  /** Davon harte Setzungen. */
  readonly hart: number;
  /** Wie oft kein Bezugspunkt im Verlauf lag (altes Verhalten). */
  readonly rueckfaelle: number;
  /** Zuletzt gemessene Drift (m) — gegen den Verlaufspunkt, nicht gegen jetzt. */
  readonly letzteDrift: number;
  /** Größte gemessene Drift seit Sitzungsbeginn (m). */
  readonly maxDrift: number;
  /** Verarbeitete PlayerState-Meldungen. */
  readonly meldungen: number;
  /** Einträge im Verlauf. */
  readonly verlauf: number;
}

/**
 * Der Abgleich selbst: nimmt Eingaben und Servermeldungen entgegen und
 * gibt je Bild den Befehl aus, der auf die Spielerposition anzuwenden
 * ist. Kennt weder Babylon noch DOM — deshalb DOM-frei testbar.
 */
export class Abgleicher {
  private readonly verlauf: Positionsverlauf;
  private rest: { dx: number; dy: number; dz: number } | null = null;
  private hartZiel: { x: number; y: number | null; z: number } | null = null;
  private zaehlerEreignisse = 0;
  private zaehlerHart = 0;
  private zaehlerRueckfall = 0;
  private zaehlerMeldungen = 0;
  private driftZuletzt = 0;
  private driftMax = 0;

  constructor(
    private readonly regeln: AbgleichRegeln = ABGLEICH_STANDARD,
    kapazitaet = 64
  ) {
    this.verlauf = new Positionsverlauf(kapazitaet);
  }

  /** Beim Absenden einer Eingabe: Sequenznummer und eigene Position merken. */
  merkeEingabe(seq: number, pos: Punkt3): void {
    this.verlauf.merke(seq, pos.x, pos.y, pos.z);
  }

  /**
   * Ein PlayerState ist eingetroffen. `seq` ist die zuletzt vom Server
   * verarbeitete Eingabe (−1: der Server hat das Feld nicht geschickt).
   * `clientJetzt` dient nur als Rückfall-Bezug.
   *
   * Entscheidet, OB nachgezogen wird — das Anwenden macht `schritt()`.
   */
  serverMeldung(serverPos: Punkt3, seq: number, clientJetzt: Punkt3, imDungeon: boolean): void {
    this.zaehlerMeldungen += 1;
    const punkt = seq >= 0 ? this.verlauf.hole(seq) : null;
    const bezug: Punkt3 = punkt ?? clientJetzt;
    if (punkt) this.verlauf.verwirfAelterAls(seq);
    else this.zaehlerRueckfall += 1;

    const dx = serverPos.x - bezug.x;
    // Im Dungeon ist der Client für y autoritativ (Raum-Collider statt
    // Heightmap) — dort zählt nur die Ebene.
    const dy = imDungeon ? 0 : serverPos.y - bezug.y;
    const dz = serverPos.z - bezug.z;
    const drift = Math.hypot(dx, dy, dz);
    this.driftZuletzt = drift;
    if (drift > this.driftMax) this.driftMax = drift;

    /*
      Die HARTE Schwelle prüft zusätzlich gegen die AKTUELLE Position —
      absichtlich der latenzbehaftete Vergleich, der aus dem weichen
      Abgleich verbannt wurde.

      Grund: Der Verlauf allein kann eine echte Entzweiung übersehen.
      Springt der Client aus eigener Kraft (Debug-Teleport, Kartensprung,
      ein manipulierter Client), stehen im Verlauf lauter Punkte vom
      ALTEN Ort; der Server bestätigt sie brav, die Drift gegen den
      Verlauf bleibt winzig — und die beiden Wahrheiten stünden dauerhaft
      hundert Meter auseinander, ohne dass irgendetwas eingriffe. Der
      Vergleich gegen jetzt kostet hier nichts: Bei 7,5 m/s und 0,1 s
      Paketalter trägt die Latenz 0,75 m bei, die harte Schwelle liegt
      bei 8 m.
    */
    const driftJetzt = Math.hypot(
      serverPos.x - clientJetzt.x,
      imDungeon ? 0 : serverPos.y - clientJetzt.y,
      serverPos.z - clientJetzt.z
    );

    const schwelle = punkt ? this.regeln.weich : this.regeln.weichRueckfall;
    if (drift > this.regeln.hart || driftJetzt > this.regeln.hart) {
      this.hartZiel = { x: serverPos.x, y: imDungeon ? null : serverPos.y, z: serverPos.z };
      this.rest = null;
      this.zaehlerHart += 1;
      this.zaehlerEreignisse += 1;
      // Nach einem harten Setzen ist jeder ältere Bezugspunkt wertlos.
      this.verlauf.leere();
    } else if (drift > schwelle) {
      this.rest = { dx, dy, dz };
      this.zaehlerEreignisse += 1;
    } else {
      // Frische Meldung unter der Schwelle: ein laufendes Nachziehen ist
      // damit erledigt und wird NICHT zu Ende gezogen — sonst schöbe der
      // Abgleich noch an einer Differenz, die es nicht mehr gibt.
      this.rest = null;
    }
  }

  /**
   * Der Anteil dieses Bildes. `null`: nichts zu tun — der Normalfall.
   *
   * Der Rest wird exponentiell abgetragen (τ), nicht je Bild neu aus der
   * Serverposition berechnet: Ein fester Versatz, den man Bild für Bild
   * zu einem Bruchteil anwendet und NICHT verkleinert, liefe unbegrenzt
   * weiter. Hier schrumpft er mit jedem Bild um genau den angewandten
   * Betrag.
   */
  schritt(dt: number): AbgleichBefehl | null {
    if (this.hartZiel) {
      const z = this.hartZiel;
      this.hartZiel = null;
      this.rest = null;
      return { art: 'setzen', x: z.x, y: z.y, z: z.z };
    }
    if (!this.rest) return null;
    const f = 1 - Math.exp(-dt / this.regeln.tau);
    const dx = this.rest.dx * f;
    const dy = this.rest.dy * f;
    const dz = this.rest.dz * f;
    const rest = { dx: this.rest.dx - dx, dy: this.rest.dy - dy, dz: this.rest.dz - dz };
    this.rest = Math.hypot(rest.dx, rest.dy, rest.dz) < 0.01 ? null : rest;
    return { art: 'schieben', dx, dy, dz };
  }

  /** Verlauf und laufendes Nachziehen vergessen (Teleport, Weltwechsel). */
  zuruecksetzen(): void {
    this.verlauf.leere();
    this.rest = null;
    this.hartZiel = null;
  }

  /** Zahlen für die Messung (`__dbg.abgleich`). */
  get diagnose(): AbgleichDiagnose {
    return {
      ereignisse: this.zaehlerEreignisse,
      hart: this.zaehlerHart,
      rueckfaelle: this.zaehlerRueckfall,
      letzteDrift: this.driftZuletzt,
      maxDrift: this.driftMax,
      meldungen: this.zaehlerMeldungen,
      verlauf: this.verlauf.laenge,
    };
  }

  /** Zähler auf null — damit ein Messabschnitt bei 0 anfängt. */
  zaehlerZuruecksetzen(): void {
    this.zaehlerEreignisse = 0;
    this.zaehlerHart = 0;
    this.zaehlerRueckfall = 0;
    this.zaehlerMeldungen = 0;
    this.driftMax = 0;
  }
}
