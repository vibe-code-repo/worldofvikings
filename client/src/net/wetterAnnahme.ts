/**
 * Wetter vom Server (F9): Der Server zieht das Wetter je Biom und schickt es
 * dem Spieler als Paket `WetterZustand` (Umgebung, Zustands-Id, Fenster). Der
 * Client würfelt dann nicht mehr selbst, sondern übernimmt die Umgebung als
 * Override des `WeatherManager` — Übergänge, Niederschlag und Wind laufen
 * unverändert über ihn.
 *
 * DOM-frei, damit `client/test/wetter-annahme.ts` es ohne Babylon fahren kann
 * (`main.ts` selbst ist nicht ladbar). Ein alter Server schickt das Paket
 * nie: Dann bleibt `umgebung` leer und der lokale Würfel gilt wie bisher.
 */

/** Das Stück des `WeatherManager`, das hier gebraucht wird. */
export interface WetterZiel {
  setEnvironmentOverride(name: string | null): boolean;
}

/** Das Stück des Paket-Lesers, das hier gebraucht wird. */
export interface WetterLeser {
  readString(): string;
  readInt32(): number;
  readonly remaining: number;
}

export class WetterAnnahme {
  /** Umgebung vom Server; `null` = keine Aussage (alter Server, nicht verbunden). */
  umgebung: string | null = null;
  /** Zustands-Id (Schlüssel für den Anzeigenamen), leer = keine Aussage. */
  zustand = '';
  /** Wetterfenster des Servers, -1 = keins. */
  fenster = -1;
  private angewandtAuf: WetterZiel | null = null;
  private angewandt: string | null = null;

  /** Liest das Paket. Ein kaputtes Paket lässt den alten Stand stehen. */
  lies(leser: WetterLeser): void {
    try {
      const umgebung = leser.readString();
      const zustand = leser.remaining > 0 ? leser.readString() : '';
      const fenster = leser.remaining > 0 ? leser.readInt32() : -1;
      this.umgebung = umgebung === '' ? null : umgebung;
      this.zustand = zustand;
      this.fenster = fenster;
    } catch (e) {
      console.warn('[wetter] WetterZustand unlesbar — der bisherige Stand bleibt', e);
    }
  }

  /** Nach dem Trennen: zurück zum lokalen Würfel. */
  vergiss(): void {
    this.umgebung = null;
    this.zustand = '';
    this.fenster = -1;
  }

  /**
   * Gibt dem `WeatherManager` den Stand, wenn er sich geändert hat (oder der
   * Manager neu ist). Billig genug für jeden Frame. Rückgabe: ob gesetzt wurde.
   */
  uebertrage(ziel: WetterZiel): boolean {
    if (this.angewandtAuf === ziel && this.angewandt === this.umgebung) return false;
    if (this.umgebung === null && this.angewandtAuf !== ziel) {
      // Noch nichts vom Server: den lokalen Würfel nicht anrühren.
      this.angewandtAuf = ziel;
      this.angewandt = null;
      return false;
    }
    if (!ziel.setEnvironmentOverride(this.umgebung)) {
      console.warn(`[wetter] Server nennt unbekannte Umgebung "${this.umgebung}"`);
    }
    this.angewandtAuf = ziel;
    this.angewandt = this.umgebung;
    return true;
  }
}
