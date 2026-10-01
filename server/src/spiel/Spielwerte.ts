/**
 * Spielwerte je Charakter: Tode und Spielzeit.
 *
 * Beide stehen im Spielerzustand (`SavedPlayer.tode`, `SavedPlayer.spielzeitSek`) und
 * gehen von dort in die Ruestkammer (`konto/Armory.ts`). Dieses Modul ist DOM-, Netz-
 * und Datenbankfrei, damit die Regeln ohne Server pruefbar sind.
 *
 * - Tode: ein Zaehler, `zaehleTod()` genau einmal je Tod (der Aufrufer sitzt dort, wo
 *   ein Lebender stirbt; ein Toter nimmt keinen Schaden mehr). Der Zaehler steigt VOR
 *   der Sicherung des Todes, damit er in derselben Zeile landet.
 * - Spielzeit: aktive Zeit seit dem Anmelden, gemessen mit einer MONOTONEN Uhr
 *   (Vorgabe `performance.now`), nie mit der Wanduhr: eine Uhrumstellung aendert nichts.
 *   `stand()` schreibt die bisher gelaufene Spanne gut und setzt den Messpunkt weiter,
 *   damit zwei Sicherungen hintereinander dieselbe Zeit nie doppelt zaehlen.
 *   `beende()` (Abmelden) bucht den Rest und stoppt: danach laeuft nichts mehr.
 * - Altstaende ohne Felder gelten als "noch nicht erfasst": `tode`/`spielzeitSek`
 *   fehlen dort, und die Ruestkammer zeigt nichts (nicht 0). Ab dem ersten `stand()`
 *   gibt es beide Felder.
 */

/** Obergrenzen gegen kaputte oder manipulierte Staende. */
export const TODE_MAX = 1_000_000;
export const SPIELZEIT_MAX_SEK = 100 * 365 * 24 * 3600;

/**
 * Ein Wert aus einem gespeicherten Stand: eine ganze Zahl in 0..max, sonst `undefined`
 * ("nicht erfasst"). Negative Werte, NaN, Unendlich und Nicht-Zahlen fallen weg; zu grosse
 * werden auf `max` gekappt.
 */
export function bereinigeZaehler(wert: unknown, max: number): number | undefined {
  if (typeof wert !== 'number' || !Number.isFinite(wert) || wert < 0) return undefined;
  return Math.min(max, Math.floor(wert));
}

export interface SpielwerteStand {
  tode: number;
  spielzeitSek: number;
}

export type MonotoneUhr = () => number;

const monotoneUhr: MonotoneUhr = () => performance.now();

export class Spielwerte {
  private tode: number | undefined;
  /** Bisher gebuchte Spielzeit in Millisekunden (Rest unter einer Sekunde bleibt hier erhalten). */
  private spielMs: number | undefined;
  /** Messpunkt der laufenden Spanne; `null` = es laeuft nichts (nicht angemeldet oder beendet). */
  private lauf: number | null = null;

  constructor(private readonly uhr: MonotoneUhr = monotoneUhr) {}

  /** Beim Anmelden: gespeicherte Werte uebernehmen (bereinigt) und die Spanne starten. */
  laden(gespeichert: { tode?: unknown; spielzeitSek?: unknown } | undefined): void {
    this.tode = bereinigeZaehler(gespeichert?.tode, TODE_MAX);
    const sek = bereinigeZaehler(gespeichert?.spielzeitSek, SPIELZEIT_MAX_SEK);
    this.spielMs = sek === undefined ? undefined : sek * 1000;
    this.lauf = this.uhr();
  }

  /** Ein Tod. */
  zaehleTod(): void {
    this.tode = Math.min(TODE_MAX, (this.tode ?? 0) + 1);
  }

  /** Die gelaufene Spanne gutschreiben und den Messpunkt weiterschieben. Eine rueckwaerts springende Uhr bucht nichts. */
  private buche(): void {
    if (this.lauf === null) return;
    const jetzt = this.uhr();
    const spanne = jetzt - this.lauf;
    this.lauf = jetzt;
    if (spanne > 0 && Number.isFinite(spanne)) {
      this.spielMs = Math.min(SPIELZEIT_MAX_SEK * 1000, (this.spielMs ?? 0) + spanne);
    }
  }

  /** Der Stand fuer die Sicherung: beide Felder, Spielzeit in ganzen Sekunden abgerundet. */
  stand(): SpielwerteStand {
    this.buche();
    return { tode: this.tode ?? 0, spielzeitSek: Math.floor((this.spielMs ?? 0) / 1000) };
  }

  /** Abmelden: den Rest buchen und stoppen. Weitere `stand()`-Aufrufe zaehlen nichts mehr. */
  beende(): SpielwerteStand {
    this.buche();
    this.lauf = null;
    return this.stand();
  }
}
