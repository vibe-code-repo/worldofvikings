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

/**
 * F6: Ring 2 bis `SYNC_MITTE_RING` ist die MITTLERE Gruppe. Sie wird nur in
 * jedem `SYNC_MITTE_TAKT`-ten Tick geprüft (halber Takt): 100 m bis 256 m vom
 * Spieler entfernt sieht man eine Änderung eine Zwanzigstelsekunde später
 * nicht anders. Ring 4 (`> SYNC_MITTE_RING`) ist die ÄUSSERE Gruppe: Sie wird
 * nur geprüft, wenn ihre Zonen Zu- oder Abgänge hatten oder als Sicherheitsnetz
 * alle `SYNC_AUSSEN_NETZ_TICKS` Ticks. Das Netz braucht es, weil sich ein ZDO
 * ändern kann, ohne dass sich der Bestand seiner Zone ändert (Kreatur läuft,
 * Tür geht auf) — die Zonengeneration sieht das nicht.
 *
 * Der Wert 2 (100 ms) stammt aus F2: Dessen Test verlangt, dass das hinterste
 * geänderte ZDO (Ring 4) in höchstens ceil(Fenster / Deckel) + 1 Ticks
 * ankommt, bei einem Fenster unter zwei Deckeln also in 3. Ein Netz von 20
 * Ticks (1 s) hätte diese Schranke gerissen, und die Schranke bleibt. Die
 * beiden Gruppen laufen im Wechsel (mittlere in geraden, äußere in ungeraden
 * Ticks je Peer), damit ein Tick nie beide Gruppen und damit nie den ganzen
 * Deckel für eine allein aufbraucht.
 */
export const SYNC_MITTE_RING = 3;
export const SYNC_MITTE_TAKT = 2;
export const SYNC_AUSSEN_NETZ_TICKS = 2;

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
  get cursor(): number {
    return this.cursorMitte + this.cursorAussen;
  }
  /**
   * F6: Wo der nächste Lauf in der mittleren bzw. äußeren Gruppe weiterprüft,
   * als Abstand ab dem Gruppenanfang (`nahEnde` bzw. `mitteEnde`). Die
   * Bedeutung ist die des früheren gemeinsamen Cursors, nur je Gruppe: Ein
   * Lauf der einen Gruppe darf die Fortschritte der anderen nicht
   * zurücksetzen, sonst verhungerte bei einem Fenster über dem Deckel die
   * Gruppe, die nie bis zum Ende kommt.
   */
  cursorMitte = 0;
  cursorAussen = 0;
  /**
   * Anzahl der Einträge in den Zonen bis Ring `SYNC_NAH_RING`: der nahe Teil
   * der Liste, der jeden Tick vollständig geprüft wird. Gilt für die Liste,
   * die `hole` zuletzt geliefert hat.
   */
  nahEnde = 0;
  /** Ende der mittleren Gruppe: Einträge in den Zonen bis Ring `SYNC_MITTE_RING`. */
  mitteEnde = 0;
  /** Zähler der Ticks, in denen `plane` für diesen Peer lief (nicht: Serverticks). */
  private takt = 0;
  /** Ab diesem `takt` ist die mittlere Gruppe wieder dran. */
  private mitteFaelligAb = 0;
  /** `takt` des letzten vollständigen Laufs der äußeren Gruppe. */
  private aussenLetzterLauf = 0;
  /** Zählt hoch, wenn eine äußere Zone Zu-/Abgänge hatte oder das Fenster neu beginnt. */
  private aussenVersion = 1;
  private aussenGesehen = 0;
  /** `aussenVersion` zu Beginn des laufenden Rundgangs durch die äußere Gruppe. */
  private aussenLaufVersion = 0;
  /** Erster Lauf nach Zonenwechsel/Weltwechsel/Anlage: jede Gruppe ist sofort dran. */
  private erstMitte = true;
  private erstAussen = true;
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

    const zoneWechsel = zoneX !== this.zoneX || zoneY !== this.zoneY;
    if (zoneWechsel) {
      this.cursorMitte = 0;
      this.cursorAussen = 0;
      this.erstMitte = true;
      this.erstAussen = true;
      this.aussenVersion++;
    }
    this.zoneX = zoneX;
    this.zoneY = zoneY;
    this.liste.length = 0;
    // Die Ringpaare sind ringweise sortiert: die ersten (2r+1)² Zonen sind
    // genau die bis Ring r.
    const nahZonen = Math.min(anzahl, (2 * SYNC_NAH_RING + 1) ** 2);
    const mitteZonen = Math.min(anzahl, (2 * SYNC_MITTE_RING + 1) ** 2);
    this.nahEnde = 0;
    this.mitteEnde = 0;
    let aussenGeaendert = false;
    for (let i = 0; i < anzahl; i++) {
      const zx = zoneX + this.ringe[i * 2]!;
      const zy = zoneY + this.ringe[i * 2 + 1]!;
      const g = zdos.zonenGeneration(zx, zy);
      if (i >= mitteZonen && g !== this.gen[i]) aussenGeaendert = true;
      this.gen[i] = g;
      const menge = zdos.zdosInZoneXY(zx, zy);
      if (menge) for (const zdo of menge) this.liste.push(zdo);
      if (i + 1 === nahZonen) this.nahEnde = this.liste.length;
      if (i + 1 === mitteZonen) this.mitteEnde = this.liste.length;
    }
    if (aussenGeaendert) this.aussenVersion++;
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
    this.cursorMitte = 0;
    this.cursorAussen = 0;
    this.nahEnde = 0;
    this.mitteEnde = 0;
    this.erstMitte = true;
    this.erstAussen = true;
    this.aussenVersion++;
  }

  /**
   * F6: Welche fernen Gruppen sind in DIESEM Tick dran? Einmal je Tick und
   * Peer aufrufen, nachdem `hole` die Liste geliefert hat. Die nahe Gruppe
   * (Ring 0–1) ist immer dran und hier nicht aufgeführt.
   *
   * Beide Gruppen sind „fällig“, bis der Aufrufer das Ende ihres Laufs mit
   * `mitteErledigt`/`aussenErledigt` meldet. Ein vom Budget oder vom Deckel
   * abgeschnittener Lauf bleibt also fällig und wird im nächsten Tick
   * fortgesetzt, statt einen Takt zu verlieren.
   */
  plane(): { mitte: boolean; aussen: boolean } {
    this.takt++;
    return {
      mitte: this.erstMitte || this.takt >= this.mitteFaelligAb,
      aussen:
        this.erstAussen ||
        this.aussenVersion !== this.aussenGesehen ||
        this.takt - this.aussenLetzterLauf >= SYNC_AUSSEN_NETZ_TICKS,
    };
  }

  /**
   * Die mittlere Gruppe ist einmal vollständig durchlaufen. Nach dem ersten
   * Lauf eines Fensters versetzt `versatz` (aus der Verbindungskennung) den
   * Takt um einen Tick, damit nicht alle Peers, die im selben Tick kamen, die
   * mittleren Ringe im selben Tick fahren; jede Gruppe ist danach höchstens
   * `SYNC_MITTE_TAKT` Ticks entfernt.
   */
  mitteErledigt(versatz: number): void {
    this.mitteFaelligAb = this.takt + (this.erstMitte ? 1 + (versatz & 1) : SYNC_MITTE_TAKT);
    this.erstMitte = false;
  }

  /**
   * Ein Rundgang durch die äußere Gruppe beginnt (Cursor 0). Die Version
   * wird JETZT gemerkt: Ein Rundgang über mehrere Ticks (Fenster über dem
   * Deckel) darf einen Zugang, der nach seinem Anfang kam, nicht als
   * gesehen verbuchen.
   */
  aussenBeginn(): void {
    this.aussenLaufVersion = this.aussenVersion;
  }

  /**
   * Der Rundgang durch die äußere Gruppe ist am Ende angekommen. Nach dem
   * ersten Lauf legt `versatz` fest, welche Gruppe zuerst wieder dran ist
   * (s. `mitteErledigt`): so laufen beide im Wechsel, und Peers mit
   * verschiedenem Versatz liegen in Gegenphase.
   */
  aussenErledigt(versatz: number): void {
    this.aussenGesehen = this.aussenLaufVersion;
    this.aussenLetzterLauf =
      this.takt - (this.erstAussen && (versatz & 1) === 1 ? SYNC_AUSSEN_NETZ_TICKS - 1 : 0);
    this.erstAussen = false;
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
