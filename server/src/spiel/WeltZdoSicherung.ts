/**
 * F8 N2 — Behaelter- und Bau-ZDOs im selben Takt wie der Spielerzustand.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * F8 sichert das Inventar alle <= 30 s, Truheninhalt und Bauten standen aber
 * nur im Weltspeicher (30 min, Stopp). Nach einem harten Abbruch waren das
 * Inventar und die Welt damit von verschiedenen Zeitpunkten: Wer Holz aus
 * einer Truhe nahm, hatte es nach dem Kill im Inventar UND wieder in der
 * Truhe (Verdopplung); wer etwas hineinlegte, hatte es nirgends mehr
 * (Verlust). Der Angriff auf F8 (Befund B1, Proben P1/P2) hat das gezeigt.
 *
 * ── Weg b (gemessen, s. Bericht F8 N2) ───────────────────────────────
 * Ein volles Weltspeichern ist zu teuer, um es im Spielertakt zu fahren
 * (48.000 ZDOs: 212 ms Tick-Blockade synchron, 7-10 ms asynchron bei
 * 170-440 ms Laufzeit) und kann ohnehin nicht in derselben Transaktion wie
 * der Spielerzustand stehen. Stattdessen gehen NUR die geaenderten
 * Behaelter- und Bau-ZDOs (Truhen, Bauteile) in die Tabelle `weltzdo`, in
 * derselben Transaktion wie die Spielerzeilen (Kontendatenbank.zustandSchreiben).
 * Alles oder nichts: nach einem Kill stammen Inventar und Truhe vom selben Zeitpunkt.
 *
 * ── Wer wird gesichert ───────────────────────────────────────────────
 * Persistente ZDOs, deren Prefab ein Behaelter oder ein Bauteil ist (die
 * Auswahl trifft der Aufrufer ueber `istRelevant`). Erkannt wird eine
 * Aenderung an der Revisionsnummer des ZDO (`revision.raw`), nicht an
 * Schmutz-Flags: Jedes Setzen eines Mitglieds hebt sie. Ein abgebautes ZDO
 * erzeugt eine Grabstein-Zeile (`daten` = null).
 *
 * ── Beim Laden ───────────────────────────────────────────────────────
 * Nach dem Weltspeicher werden die Zeilen darueber gelegt (`ueberlagern`):
 * je ZDO gewinnt der NEUERE Stand, entschieden ueber die Datenrevision (23
 * Bit, ueber den Ueberlauf hinweg verglichen; bei Gleichstand gewinnt der
 * Weltspeicher). Ein Grabstein entfernt das ZDO. Nach einem erfolgreichen
 * Weltspeichern raeumt der Server die Zeilen bis zum Beginn dieses
 * Speicherns weg (`Kontendatenbank.weltzdoBereinigen`).
 */
import type { ZDO } from '../zdo/ZDO.js';
import type { ZDOManager } from '../zdo/ZDOManager.js';

export interface WeltZdoZeile {
  zdoId: string;
  weltId: string;
  stand: number;
  /** JSON des ZDO-Schnappschusses; null = abgebaut. */
  daten: string | null;
}

/** Was in diesem Lauf mitgeschrieben wird, plus die Quittung nach erfolgreichem Schreiben. */
export interface WeltZdoAenderung {
  zeilen: WeltZdoZeile[];
  erfolg(): void;
}

const DATEN_REV_MASK = (1 << 23) - 1;

/** Ist die Datenrevision `a` (wrap-sicher) STRIKT vor `b`? */
export function revisionVoraus(a: number, b: number): boolean {
  const d = (a - b) & DATEN_REV_MASK;
  return d !== 0 && d < (DATEN_REV_MASK + 1) / 2;
}

export class WeltZdoSicherung {
  /** zdoId -> Revisionsnummer des zuletzt ERFOLGREICH gesicherten (oder geladenen) Zustands. */
  private readonly zuletzt = new Map<string, number>();
  private grundlinie = false;

  constructor(
    private readonly weltId: string,
    /** Ist ein ZDO mit diesem Prefab ein Behaelter oder Bauteil (und persistent)? */
    private readonly istRelevant: (prefabHash: number) => boolean,
    /**
     * Das ZDO zu einer Kennung aus der ID-Tabelle des Servers (die Wahrheit).
     * Ereignisse reichen ZDOs aus Sektorlisten durch; die koennen nach dem
     * Start Doppelgaenger desselben ZDO sein (`destroyed` bleibt dort false,
     * obwohl das echte ZDO weg ist). Entschieden wird deshalb hier.
     */
    private readonly nachschlagen: (zdoId: string) => ZDO | undefined,
    private readonly jetzt: () => number = Date.now,
  ) {}

  /** Anzahl der beobachteten ZDOs (Diagnose, Tests). */
  get beobachtet(): number {
    return this.zuletzt.size;
  }

  /**
   * Nach dem Laden: der Ist-Zustand aller relevanten ZDOs gilt als
   * gesichert (er kommt aus Weltspeicher und Zeilen). Ohne diese Grundlinie
   * wuerde ein Abbau eines nie veraenderten Bauteils keinen Grabstein bekommen.
   */
  grundstand(alle: Iterable<ZDO>): void {
    this.zuletzt.clear();
    this.grundlinie = true;
    for (const z of alle) {
      if (z.destroyed || !this.istRelevant(z.prefabHash)) continue;
      this.zuletzt.set(z.zdoid.toString(), z.revision.raw);
    }
  }

  /** Vollabtastung (Takt, Stopp): alle relevanten ZDOs, dazu jeder Abbau seit dem letzten Mal. */
  abtasten(alle: Iterable<ZDO>): WeltZdoAenderung | null {
    if (!this.grundlinie) {
      // Nie gestartet (Stopp ohne Start, Tests): die Abtastung ist die Grundlinie, es gibt nichts zu schreiben.
      this.grundstand(alle);
      return null;
    }
    const zeilen: WeltZdoZeile[] = [];
    const neuerStand: [string, number | null][] = [];
    const stand = this.jetzt();
    const gesehen = new Set<string>();
    for (const z of alle) {
      if (z.destroyed || !this.istRelevant(z.prefabHash)) continue;
      const id = z.zdoid.toString();
      gesehen.add(id);
      if (this.zuletzt.get(id) === z.revision.raw) continue;
      zeilen.push({ zdoId: id, weltId: this.weltId, stand, daten: JSON.stringify(z.toSnapshot()) });
      neuerStand.push([id, z.revision.raw]);
    }
    for (const id of this.zuletzt.keys()) {
      if (gesehen.has(id)) continue;
      zeilen.push({ zdoId: id, weltId: this.weltId, stand, daten: null });
      neuerStand.push([id, null]);
    }
    return this.aenderung(zeilen, neuerStand);
  }

  /** Nur diese ZDOs pruefen (Ereignis: Truhe, Bauen, Abreissen) — ohne Vollabtastung. */
  pruefe(zdos: Iterable<ZDO>): WeltZdoAenderung | null {
    const zeilen: WeltZdoZeile[] = [];
    const neuerStand: [string, number | null][] = [];
    const stand = this.jetzt();
    for (const gereicht of zdos) {
      if (!this.istRelevant(gereicht.prefabHash)) continue;
      const id = gereicht.zdoid.toString();
      const z = this.nachschlagen(id);
      if (!z || z.destroyed) {
        // Auch ein ZDO, das seit der Grundlinie gebaut UND abgebaut wurde, bekommt
        // einen Grabstein: Ein Weltspeichern dazwischen kann es getragen haben.
        zeilen.push({ zdoId: id, weltId: this.weltId, stand, daten: null });
        neuerStand.push([id, null]);
        continue;
      }
      if (this.zuletzt.get(id) === z.revision.raw) continue;
      zeilen.push({ zdoId: id, weltId: this.weltId, stand, daten: JSON.stringify(z.toSnapshot()) });
      neuerStand.push([id, z.revision.raw]);
    }
    return this.aenderung(zeilen, neuerStand);
  }

  private aenderung(zeilen: WeltZdoZeile[], neuerStand: [string, number | null][]): WeltZdoAenderung | null {
    if (zeilen.length === 0) return null;
    return {
      zeilen,
      erfolg: () => {
        for (const [id, rev] of neuerStand) {
          if (rev === null) this.zuletzt.delete(id);
          else this.zuletzt.set(id, rev);
        }
      },
    };
  }
}

export interface UeberlagerungsErgebnis {
  /** Neu angelegt (im Weltspeicher nicht vorhanden). */
  neu: number;
  /** Bestehendes ZDO durch den neueren Stand der Zeile ersetzt. */
  ersetzt: number;
  /** Per Grabstein entfernt. */
  entfernt: number;
  /** Zeile nicht neuer als der Weltspeicher (oder unlesbar). */
  uebersprungen: number;
}

/**
 * Zeilen der Tabelle `weltzdo` ueber die frisch geladenen ZDOs legen. Je
 * ZDO gewinnt der NEUERE Stand (Datenrevision); Gleichstand: Weltspeicher.
 */
export function ueberlagern(
  zeilen: readonly { zdoId: string; daten: string | null }[],
  zdos: ZDOManager,
  zdoKlasse: { fromSnapshot(daten: Record<string, unknown>): ZDO },
  log: { error(text: string): void } = console,
): UeberlagerungsErgebnis {
  const erg: UeberlagerungsErgebnis = { neu: 0, ersetzt: 0, entfernt: 0, uebersprungen: 0 };
  for (const zeile of zeilen) {
    try {
      if (zeile.daten === null) {
        const vorhanden = zdos.getZDOByKey(zeile.zdoId);
        if (vorhanden) {
          zdos.destroyZDO(vorhanden.zdoid);
          erg.entfernt++;
        } else {
          erg.uebersprungen++;
        }
        continue;
      }
      const daten = JSON.parse(zeile.daten) as Record<string, unknown>;
      const neu = zdoKlasse.fromSnapshot(daten);
      const vorhanden = zdos.getZDO(neu.zdoid);
      if (!vorhanden) {
        zdos.restoreFromSnapshots([daten]);
        erg.neu++;
      } else if (revisionVoraus(neu.revision.dataRevision, vorhanden.revision.dataRevision)) {
        vorhanden.uebernehmeSchnappschuss(neu);
        erg.ersetzt++;
      } else {
        erg.uebersprungen++;
      }
    } catch (err) {
      log.error(`[Weltzustand] Zeile ${zeile.zdoId} unlesbar, uebersprungen: ${err}`);
      erg.uebersprungen++;
    }
  }
  // Beim Laden gibt es noch keinen Peer: die Abbau-Liste (fuer das Netz) leeren.
  zdos.consumeDestroyList();
  return erg;
}
