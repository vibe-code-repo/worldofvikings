/**
 * F8 — Spielerzustand write-behind in die Konten-SQLite.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Vor F8 stand der Zustand eines verbundenen Spielers (Position, Inventar,
 * Ruestung, Bettpunkt) nur an zwei Stellen auf der Platte: beim Verlassen
 * (onPeerQuit -> savedPlayers) UND im Weltspeicher, und der schreibt alle
 * SAVE_INTERVAL_MS (30 min) sowie beim Stopp. Stuerzt der Server ab oder
 * wird er hart beendet (SIGKILL, OOM, Stromausfall), fehlt jeder Fortschritt
 * seit dem letzten Weltspeichern: bis zu 30 Minuten.
 *
 * ── Was hier passiert ───────────────────────────────────────────────
 *  - Regelmaessig (SPIELER_SICHERUNG_INTERVALL_MS = 30 s): jeder
 *    verbundene Spieler, dessen Stand sich seit dem letzten ERFOLGREICHEN
 *    Schreiben geaendert hat ("schmutzig"), geht in einer einzigen
 *    Transaktion in die Tabelle `spielerzustand`. Erkannt wird das durch
 *    Vergleich des serialisierten Stands, nicht durch Schmutz-Flags an
 *    jeder Aenderungsstelle: Es gibt Dutzende Stellen, die Inventar oder
 *    Position aendern, und jede vergessene waere ein stiller Verlust.
 *  - Bei Ereignissen sofort (sichere(..., grund)): Ausruestungswechsel,
 *    Schlafplatz, Abmelden, Stopp. Die Ereignis-API ist absichtlich
 *    allgemein — der Server kennt heute weder Erfahrung/Levelaufstieg noch
 *    Handel/Uebergabe zwischen Spielern; kommen sie, rufen sie dieselbe
 *    Funktion.
 *  - Fehler sind laut (console.error mit Kennung SPIELER_SICHERUNG_FEHLER)
 *    und lassen den Eintrag schmutzig: der naechste Lauf versucht es neu.
 *
 * ── Warum 30 s ──────────────────────────────────────────────────────
 * Ziel der Roadmap ist ein Verlustfenster unter einer Minute. Das
 * Zeitintervall ist die OBERE Grenze fuer alles, was kein Ereignis ist;
 * 30 s haelt Luft fuer einen verzoegerten Lauf (Tick-Stau, ein einzelner
 * fehlgeschlagener Versuch), ohne die 60 s zu reissen. Die Kosten sind
 * klein: ein Lauf schreibt nur die veraenderten Spieler in einer
 * Transaktion (Messwerte im Bericht / in stats()).
 *
 * ── Warum synchron und trotzdem nicht blockierend ────────────────────
 * node:sqlite ist synchron. Ein Upsert je Spieler im WAL-Modus kostet
 * Bruchteile einer Millisekunde; ein ganzer Lauf ist EINE Transaktion (ein
 * fsync, nicht einer je Spieler). Jeder Lauf wird gemessen (stats().maxMs)
 * und ab WARN_MS laut gemeldet. Ein asynchroner Worker waere hier mehr
 * Risiko (zweite Verbindung, Reihenfolge gegen den Stopp-Speicherweg) als
 * Nutzen.
 *
 * ── Beim Laden: der NEUERE Stand gewinnt ─────────────────────────────
 * Zwei Quellen: Weltspeicher (players[]) und diese Tabelle. Jeder Stand
 * traegt `gespeichertAm` (ms); `neuerAls` entscheidet, strikt: bei
 * Gleichstand oder fehlendem Zeitstempel (Stand von vor F8 = 0) gewinnt der
 * schon geladene Eintrag aus dem Weltspeicher. So geht weder ein
 * Admin-Eingriff in einen Offline-Datensatz (gleicher Stempel) noch ein
 * spaeter geschriebener Weltspeicher verloren, und ein aelterer
 * Weltspeicher (z. B. nach einem Absturz) macht keinen Rueckschritt.
 *
 * Zeilen tragen die `welt_id` (Seed + Modus, NICHT das Layout). Zeilen einer
 * anderen Welt werden beim Start nur ignoriert, nie geloescht; geloescht wird
 * ausschliesslich beim ausdruecklichen "Welt zuruecksetzen" (Admin-Dienst).
 *
 * ── Truhen und Bauten im selben Schreibvorgang (F8 N2) ───────────────
 * `sichere` nimmt optional die geaenderten Behaelter-/Bau-ZDOs
 * (spiel/WeltZdoSicherung.ts) mit und schreibt sie in DERSELBEN Transaktion
 * wie die Spielerzeilen. Nach einem Kill stammen Inventar und Truhe damit vom
 * selben Zeitpunkt: keine Verdopplung, kein Verlust.
 */
import type { Kontendatenbank } from '../konto/Kontendatenbank.js';
import type { SavedPlayer } from '../world/WorldManager.js';
import type { WeltZdoAenderung } from './WeltZdoSicherung.js';

/** Obergrenze des Verlustfensters ausserhalb von Ereignissen. Roadmap F8: unter einer Minute. */
export const SPIELER_SICHERUNG_INTERVALL_MS = 30_000;

/** Ein Sicherungslauf, der laenger als das dauert, wird laut gemeldet. */
const WARN_MS = 25;

/** Ist `a` STRIKT neuer als `b`? Fehlender Eintrag/Zeitstempel zaehlt als 0. */
export function neuerAls(a: SavedPlayer | undefined, b: SavedPlayer | undefined): boolean {
  if (!a) return false;
  return (a.gespeichertAm ?? 0) > (b?.gespeichertAm ?? 0);
}

export interface SicherungsStatistik {
  laeufe: number;
  zeilen: number;
  /** F8 N2: mitgeschriebene ZDO-Zeilen (Truhen, Bauten, Grabsteine). */
  zdoZeilen: number;
  fehler: number;
  summeMs: number;
  maxMs: number;
}

export interface SicherungsLog {
  warn(text: string): void;
  error(text: string): void;
}

export class SpielerSicherung {
  /** spielerId -> serialisierter Stand (ohne Zeitstempel) des letzten ERFOLGREICHEN Schreibens. */
  private readonly zuletzt = new Map<string, string>();
  private readonly zaehler: SicherungsStatistik = { laeufe: 0, zeilen: 0, zdoZeilen: 0, fehler: 0, summeMs: 0, maxMs: 0 };

  constructor(
    private readonly db: Kontendatenbank,
    private readonly weltId: string,
    private readonly jetzt: () => number = Date.now,
    private readonly log: SicherungsLog = console,
  ) {}

  stats(): Readonly<SicherungsStatistik> {
    return { ...this.zaehler };
  }

  /**
   * Alle Staende dieser Welt aus der Tabelle. Zeilen anderer Welten bleiben
   * unberuehrt (nur ignoriert); unlesbare Zeilen werden uebersprungen und gemeldet.
   */
  laden(): SavedPlayer[] {
    const staende: SavedPlayer[] = [];
    for (const z of this.db.spielerzustandLesen(this.weltId)) {
      try {
        const s = JSON.parse(z.daten) as SavedPlayer;
        if (typeof s !== 'object' || s === null || typeof s.name !== 'string' || typeof s.position !== 'object') {
          throw new Error('kein Spielerstand');
        }
        staende.push({ ...s, spielerId: z.spielerId, gespeichertAm: z.stand });
      } catch (err) {
        this.log.error(`[Spielerzustand] Zeile ${z.spielerId} unlesbar, uebersprungen: ${err}`);
      }
    }
    return staende;
  }

  /**
   * Schmutzige Staende schreiben. Liefert die Zahl der geschriebenen Zeilen
   * oder -1, wenn das Schreiben gescheitert ist (dann bleiben alle
   * schmutzig). Wirft nie: Ein Fehler im Nebenweg darf den Tick und den
   * Stopp nicht reissen.
   */
  sichere(staende: readonly SavedPlayer[], grund: string, welt: WeltZdoAenderung | null = null): number {
    const zeilen: { spielerId: string; weltId: string; stand: number; daten: string }[] = [];
    const schluessel: [string, string][] = [];
    const stand = this.jetzt();
    for (const s of staende) {
      if (!s.spielerId) continue;
      const vergleich = JSON.stringify({ ...s, gespeichertAm: undefined });
      if (this.zuletzt.get(s.spielerId) === vergleich) continue;
      zeilen.push({
        spielerId: s.spielerId,
        weltId: this.weltId,
        stand,
        daten: JSON.stringify({ ...s, gespeichertAm: stand }),
      });
      schluessel.push([s.spielerId, vergleich]);
    }
    const zdoZeilen = welt?.zeilen ?? [];
    if (zeilen.length === 0 && zdoZeilen.length === 0) return 0;

    const t0 = performance.now();
    try {
      this.db.zustandSchreiben(zeilen, zdoZeilen);
    } catch (err) {
      this.zaehler.fehler++;
      this.log.error(
        `[Spielerzustand] SPIELER_SICHERUNG_FEHLER (${grund}, ${zeilen.length} Zeile(n), ${zdoZeilen.length} ZDO-Zeile(n)) — bleiben schmutzig: ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }`,
      );
      return -1;
    }
    const ms = performance.now() - t0;
    for (const [id, vergleich] of schluessel) this.zuletzt.set(id, vergleich);
    welt?.erfolg();
    this.zaehler.zdoZeilen += zdoZeilen.length;
    this.zaehler.laeufe++;
    this.zaehler.zeilen += zeilen.length;
    this.zaehler.summeMs += ms;
    this.zaehler.maxMs = Math.max(this.zaehler.maxMs, ms);
    if (ms > WARN_MS) {
      this.log.warn(`[Spielerzustand] Sicherungslauf (${grund}) dauerte ${ms.toFixed(1)} ms fuer ${zeilen.length} Zeile(n) + ${zdoZeilen.length} ZDO-Zeile(n)`);
    }
    return zeilen.length + zdoZeilen.length;
  }

  /** Spieler hat die Verbindung verlassen: Merker freigeben (die Zeile bleibt). */
  abgemeldet(spielerId: string): void {
    this.zuletzt.delete(spielerId);
  }

  /** Zeilen endgueltig entfernen (Konto geloescht, `spieler entfernen`). */
  vergiss(spielerIds: readonly string[]): void {
    for (const id of spielerIds) this.zuletzt.delete(id);
    try {
      this.db.spielerzustandLoeschen(spielerIds);
    } catch (err) {
      this.log.error(`[Spielerzustand] Loeschen fehlgeschlagen: ${err}`);
    }
  }
}
