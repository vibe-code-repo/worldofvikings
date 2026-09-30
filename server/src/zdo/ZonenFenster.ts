/**
 * Zwischengespeichertes Sichtfenster eines Peers (D7).
 *
 * `syncZDOs` lief alle 50 ms je Peer über 81 Zonen und zählte jede ZDO darin
 * an — auch wenn sich weder der Peer noch der Zoneninhalt seit dem letzten
 * Tick bewegt hatte. Bei 48.000 ZDOs und einem Dutzend Spielern ist das der
 * Löwenanteil der Sync-Kosten, und er fällt 20×/s an.
 *
 * Das Fenster hält die eingesammelte Liste fest und baut sie nur neu auf,
 * wenn der Peer die Zone wechselt ODER eine der 81 Zonen ihren Bestand
 * geändert hat. Letzteres verrät der Generationszähler im ZDOManager: die
 * Prüfung kostet 81 Zahlenvergleiche statt 81 Set-Durchläufen.
 *
 * Bewusst konservativ: Der Zähler steigt bei JEDEM Zu- und Abgang einer Zone,
 * also auch bei einer Kreatur, die nur eine Zonengrenze überschreitet. Lieber
 * einmal zu viel neu sammeln als ein frisch gespawntes Objekt übersehen — ein
 * überflüssiger Neuaufbau kostet exakt das, was der alte Code IMMER tat.
 *
 * Die Liste ist nach RINGEN sortiert (Chebyshev-Abstand 0, 1, 2, …): Damit
 * ist die Entfernungspriorisierung des Bandbreitenbudgets (D6) geschenkt —
 * wer die Liste von vorn abarbeitet und beim Budget aufhört, hat automatisch
 * das Nahe zuerst geschickt. Innerhalb eines Rings ist die Reihenfolge egal,
 * eine Zone ist nur 64 m breit.
 */

import type { ZDO } from './ZDO.js';
import type { ZDOManager } from './ZDOManager.js';

/**
 * Höchstens so viele ZDOs prüft `syncZDOs` je Peer und Tick (F2). Ohne Deckel
 * läuft die Schleife bei einem Peer, dem nichts zu schicken ist, jedes Mal bis
 * zum Ende des Fensters. Das Fenster ist ringweise sortiert; was der Deckel
 * abschneidet, holt der Cursor (`ZonenFenster.cursor`) im nächsten Tick nach,
 * sonst wären die hinteren Ringe für diesen Peer unsichtbar.
 */
export const SYNC_PRUEFUNGEN_MAX = 4096;

/**
 * Bis zu diesem Ring (Chebyshev-Abstand in Zonen, 0 = eigene Zone) prüft
 * `syncZDOs` das Fenster JEDEN Tick vollständig; der Deckel und der Cursor
 * gelten nur für den Rest. Ring 1 = 3×3 Zonen = 192 m um den Spieler: Dort
 * laufen die Kreaturen und Mitspieler, deren 20-Hz-Aktualisierung man sieht
 * (Interpolation überbrückt ein paar Ticks, aber nicht 2–5 s). Die Grenze
 * hängt an der ENTFERNUNG, nicht an einer Eintragszahl: In einem dichten Dorf
 * liegen mehr ZDOs darin, und genau das sind die, die man sieht.
 */
export const SYNC_NAH_RING = 1;

export class ZonenFenster {
  /**
   * Wo der nächste Tick im FERNEN Teil des Fensters (hinter `nahEnde`)
   * weiterprüft, als Abstand ab `nahEnde`. 0 = ab dem ersten fernen Eintrag.
   * `syncZDOs` setzt ihn, wenn der Deckel die Schleife mitten im fernen Teil
   * abgeschnitten hat, und auf 0 zurück, sobald das Ende erreicht ist. Wechselt
   * der Peer die Zone oder wird das Fenster verworfen, beginnt es wieder bei 0;
   * ein Neuaufbau bei gleicher Zone lässt ihn stehen (die Liste bleibt
   * ringweise geordnet, ein verschobener Index kostet höchstens eine Runde).
   */
  cursor = 0;
  /**
   * Anzahl der Einträge in den Zonen bis Ring `SYNC_NAH_RING`: der nahe Teil
   * der Liste, der jeden Tick vollständig geprüft wird. Gilt für die Liste,
   * die `hole` zuletzt geliefert hat.
   */
  nahEnde = 0;
  /** F6: Zähler der `ferneDran`-Aufrufe; seine Parität ist die (deterministische) Phase. */
  private takt = 0;
  /** F6: nach Zonen-/Weltwechsel kommt der ferne Teil sofort (Erstübertragung). */
  private ferneSofort = true;
  /**
   * F6: Der letzte ferne Durchlauf ist am Budget abgebrochen (`syncZDOs`
   * setzt es). Solange das so ist, läuft der ferne Teil jeden Tick weiter: Bei
   * vollem Budget wäre jeder ausgesetzte Tick verschenktes Budget, und ferne
   * ZDOs kämen langsamer an als ohne F6.
   */
  ferneAktiv = false;
  private zoneX = NaN;
  private zoneY = NaN;
  private radius = -1;
  /** Generation je Fensterzone, in derselben Reihenfolge wie `ringe`. */
  private gen = new Int32Array(0);
  /** Ringweise sortierte (dx, dy)-Paare, flach: [dx0, dy0, dx1, dy1, …]. */
  private ringe = new Int32Array(0);
  private liste: ZDO[] = [];

  /**
   * Die ZDOs im Sichtfenster, nahe Zonen zuerst. Das Ergebnis gehört dem
   * Fenster und darf NICHT verändert werden — es überlebt bis zum nächsten
   * Neuaufbau.
   */
  hole(zdos: ZDOManager, zoneX: number, zoneY: number, radius: number): readonly ZDO[] {
    if (radius !== this.radius) this.baueRinge(radius);

    const anzahl = this.ringe.length / 2;
    let gueltig = zoneX === this.zoneX && zoneY === this.zoneY;
    if (gueltig) {
      for (let i = 0; i < anzahl; i++) {
        const g = zdos.zonenGeneration(zoneX + this.ringe[i * 2]!, zoneY + this.ringe[i * 2 + 1]!);
        if (g !== this.gen[i]) {
          gueltig = false;
          break;
        }
      }
    }
    if (gueltig) return this.liste;

    if (zoneX !== this.zoneX || zoneY !== this.zoneY) {
      this.cursor = 0;
      this.ferneSofort = true;
    }
    this.zoneX = zoneX;
    this.zoneY = zoneY;
    this.liste.length = 0;
    // Die Ringpaare sind ringweise sortiert: die ersten (2r+1)² Zonen sind
    // genau die bis Ring r.
    const nahZonen = Math.min(anzahl, (2 * SYNC_NAH_RING + 1) ** 2);
    this.nahEnde = 0;
    for (let i = 0; i < anzahl; i++) {
      const zx = zoneX + this.ringe[i * 2]!;
      const zy = zoneY + this.ringe[i * 2 + 1]!;
      this.gen[i] = zdos.zonenGeneration(zx, zy);
      const menge = zdos.zdosInZoneXY(zx, zy);
      if (menge) for (const zdo of menge) this.liste.push(zdo);
      if (i + 1 === nahZonen) this.nahEnde = this.liste.length;
    }
    return this.liste;
  }

  /**
   * Das Fenster verwerfen.
   *
   * Gebraucht beim Weltwechsel: Das Fenster gilt nur zusammen mit den
   * Zonen-Generationen SEINES ZDO-Raums, und die zählen in jeder Welt bei
   * null los. Ohne Verwerfen könnte ein Peer, der die Zone (0,0) der
   * Oberwelt kennt, die Zone (0,0) einer frischen Instanz für unverändert
   * halten — beide stehen auf Generation 0 — und bekäme dort nichts
   * geschickt.
   */
  zuruecksetzen(): void {
    this.zoneX = NaN;
    this.zoneY = NaN;
    this.liste.length = 0;
    this.cursor = 0;
    this.nahEnde = 0;
    this.ferneSofort = true;
  }

  /**
   * F6: Ist der FERNE Teil (hinter `nahEnde`) in diesem Tick dran? Einmal je
   * Tick und Peer aufrufen. Er wird nur in jedem 2. Tick geprüft: 100 m und
   * mehr vom Spieler entfernt sieht man eine Änderung 50 ms später nicht. Gegenüber dem Stand vor F6 kommt eine ferne Änderung damit höchstens 1 Tick später an (bei Fenstern unter dem Deckel 2 statt 1 Tick); Ring 0–1 nie später. Immer
   * dran ist er, solange ein Rundgang läuft (`cursor` ≠ 0: Fenster über dem
   * Deckel oder Budgetabbruch; dort wäre Aussetzen nur langsamer, nicht
   * billiger), solange der letzte ferne Durchlauf am Budget abbrach (`ferneAktiv`)
   * und im ersten Tick nach Zonen-/Weltwechsel. Die Phase ist die
   * Parität des Tickzählers dieses Fensters, also deterministisch.
   */
  ferneDran(): boolean {
    this.takt++;
    if (this.ferneSofort || this.cursor !== 0 || this.ferneAktiv) {
      this.ferneSofort = false;
      return true;
    }
    return (this.takt & 1) === 0;
  }

  /**
   * (dx, dy) aller Fensterzonen, nach Chebyshev-Abstand aufsteigend. Einmal
   * je Radius gebaut; der Radius ist heute konstant, aber ein Fenster, das
   * sich beim ersten Aufruf still auf den falschen Radius festlegt, wäre ein
   * unauffindbarer Fehler.
   */
  private baueRinge(radius: number): void {
    this.radius = radius;
    const paare: number[] = [];
    for (let ring = 0; ring <= radius; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          paare.push(dx, dy);
        }
      }
    }
    this.ringe = Int32Array.from(paare);
    this.gen = new Int32Array(paare.length / 2);
    this.zoneX = NaN; // erzwingt den Neuaufbau im selben Aufruf
  }
}
