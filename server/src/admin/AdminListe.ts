/**
 * AdminListe — dauerhafte Admin-Berechtigung ueber stabile Spieler-IDs
 * (Roadmap S6, Security-Review).
 *
 * Hintergrund: `players.everyone-admin` machte bis zum 13.09.2026 JEDEN
 * verbundenen Spieler zum Admin. Seit Paket 0.1 steht der Schalter im
 * Repo auf `false`, und damit ist DIESE Liste die Berechtigung — nicht
 * mehr eine zusaetzliche neben ihr. Wer hier mit seiner spielerId (F3)
 * steht, darf Admin-Befehle nutzen; wer nicht, nicht. Ihr erster Eintrag
 * kommt vom Adminkonto aus `standard-konto:` (StandardKonto.ts), weil
 * sich eine leere Liste sonst nie fuellen liesse.
 *
 * ── Warum server/data/worlds/ und NICHT server/data/server.yml ─────────
 * server.yml ist GIT-VERSIONIERT und wird bei jedem Deploy (`git pull`,
 * siehe wov-nur-auf-dev-arbeiten) durch den Stand aus dem Repo ERSETZT —
 * eine dort abgelegte Admin-Liste waere nach dem naechsten Pull weg bzw.
 * stuende im oeffentlichen Repo und waere auf jeder Instanz gleich.
 * `server/data/worlds/` ist dagegen bereits die etablierte Ablage fuer
 * instanzspezifischen, NICHT versionierten Zustand (.gitignore:
 * `server/data/worlds/`, dort liegen die .db.zst-Weltstaende und der
 * Placement-Cache) — sie ueberlebt sowohl einen Serverneustart als auch
 * ein Deploy, und dev/live bekommen ueber den Dateinamen (Instanzname)
 * getrennte Listen, ohne dass dieses Modul irgendetwas ueber Instanzen
 * wissen muss (der Pfad kommt fertig vom Aufrufer).
 *
 * Spieler-IDs sind KEINE Geheimnisse (128 Bit Zufall, aber nicht dazu
 * gedacht, etwas zu beweisen — das SessionToken tut das, siehe
 * Identitaet.ts) — diese Datei ist also keine Zugangsdatei im Sinne des
 * Geheimnis-Verbots, sondern eine gewoehnliche Konfigurationsliste.
 *
 * ── Warum die Datei bei jeder Abfrage nachgesehen wird (Paket 0.1) ────
 * Seit `everyone-admin` auf `false` steht, ist diese Liste der einzige
 * Weg zu Adminrechten — und damit auch die Stelle, an der ein ZWEITER
 * Adminweg ansetzen muss: Der Betriebsdienst (admin/src/main.ts) hat
 * heute keine Adminroute, und er laeuft in einem EIGENEN Prozess. Er kann
 * diese Datei lesen und schreiben, aber nicht in den Speicher des
 * Spielservers greifen.
 *
 * Bis 0.1 wurde die Datei genau einmal gelesen, im Konstruktor. Eine
 * Aenderung von aussen waere also bis zum naechsten Serverneustart
 * wirkungslos geblieben — und zwar OHNE SYMPTOM: Die Datei saehe richtig
 * aus, `admin liste` im Spiel meldete etwas anderes, und niemand haette
 * einen Anhaltspunkt. Deshalb vergleicht jede Abfrage vorher
 * Aenderungszeit und Groesse der Datei und liest bei Abweichung neu. Das
 * kostet ein `statSync` pro Anmeldung (nicht pro Paket) — die Abfrage
 * haengt an `NetManager.handlePasswordAuth`, einem Vorgang, der ohnehin
 * scrypt rechnet.
 *
 * Grenze dieser Erkennung, bewusst in Kauf genommen: Zwei Schreibvorgaenge
 * innerhalb derselben Millisekunde, die dieselbe Dateigroesse ergeben,
 * bleiben unbemerkt. Fuer eine von Menschen bediente Rechteliste ist das
 * kein realistischer Fall; die Alternative (`fs.watch`) haengt an
 * Plattform-Eigenheiten und haelt einen Handle offen.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { istSpielerId, type SpielerId } from '../net/Identitaet.js';

export interface AdminEintrag {
  spielerId: SpielerId;
  /** Letzter bekannter Anzeigename — NUR fuer die Lesbarkeit der Datei
   *  und der `admin liste`-Ausgabe, nicht sicherheitsrelevant (die
   *  Berechtigung haengt ausschliesslich an spielerId). */
  name: string;
  /** ISO-Zeitstempel, wann der Eintrag hinzugefuegt wurde (Diagnose). */
  seit: string;
}

export class AdminListe {
  private eintraege = new Map<SpielerId, AdminEintrag>();
  /**
   * Aenderungszeit und Groesse des Dateistands, der gerade in
   * `eintraege` steht — der Vergleichswert fuer `abgleichen()`.
   * `''` = keine Datei (oder noch nie gelesen).
   */
  private gelesenerStand = '';

  constructor(private readonly pfad: string) {
    this.laden();
  }

  /** Die Kennung des Dateistands: `''`, wenn es die Datei nicht gibt. */
  private dateiStand(): string {
    try {
      const s = statSync(this.pfad);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return '';
    }
  }

  /**
   * Hat jemand ANDERES die Datei angefasst? Dann gilt die Datei, nicht
   * der Speicher — sie ist die Wahrheit, und dieser Prozess ist nur einer
   * von mehreren, die sie schreiben duerfen (siehe Kopfkommentar).
   *
   * Auch der Fall "Datei ist weg" wird uebernommen: Wer sie loescht, will
   * die Liste los sein. Das entzieht Rechte und vergibt keine — der
   * Rueckfall ist also der sichere.
   */
  private abgleichen(): void {
    const stand = this.dateiStand();
    if (stand === this.gelesenerStand) return;
    this.eintraege.clear();
    this.laden();
  }

  private laden(): void {
    // ZUERST, nicht zuletzt: Wer den Stand erst nach dem Lesen merkt,
    // uebersieht ein Schreiben, das zwischen readFileSync und statSync
    // faellt, fuer immer.
    this.gelesenerStand = this.dateiStand();
    if (!existsSync(this.pfad)) return;
    try {
      const roh = JSON.parse(readFileSync(this.pfad, 'utf-8')) as unknown;
      if (!Array.isArray(roh)) {
        console.error(`[AdminListe] ${this.pfad}: kein Array — starte mit leerer Liste`);
        return;
      }
      for (const eintrag of roh) {
        if (
          eintrag &&
          typeof eintrag === 'object' &&
          istSpielerId((eintrag as Partial<AdminEintrag>).spielerId)
        ) {
          const e = eintrag as AdminEintrag;
          this.eintraege.set(e.spielerId, e);
        }
      }
    } catch (err) {
      // Kaputte/unlesbare Datei darf den Serverstart nicht verhindern —
      // leere Liste ist der sichere Rueckfall (niemand bekommt Rechte,
      // die er vorher nicht hatte).
      console.error(`[AdminListe] ${this.pfad} unlesbar, starte mit leerer Liste: ${err}`);
    }
  }

  private speichern(): void {
    mkdirSync(dirname(this.pfad), { recursive: true });
    const tmp = `${this.pfad}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.eintraege.values()], null, 2));
    // Atomarer Ersatz (rename statt direktem writeFileSync auf den
    // Zielpfad) — bei einem Absturz mitten im Schreiben bleibt entweder
    // die alte oder die neue Datei vollstaendig stehen, nie ein
    // halb geschriebener Torso.
    renameSync(tmp, this.pfad);
    // Der eigene Schreibvorgang darf beim naechsten `abgleichen()` nicht
    // wie eine fremde Aenderung aussehen — sonst laese dieser Prozess
    // nach jedem eigenen Schreiben die Datei erneut ein.
    this.gelesenerStand = this.dateiStand();
  }

  enthaelt(id: SpielerId): boolean {
    this.abgleichen();
    return this.eintraege.has(id);
  }

  /** @returns true, wenn NEU hinzugefuegt (false = war schon Admin). */
  hinzufuegen(id: SpielerId, name: string): boolean {
    // Vor dem Schreiben abgleichen, sonst ueberschreibt `speichern()`
    // eine fremde Aenderung mit dem veralteten Speicherstand.
    this.abgleichen();
    if (this.eintraege.has(id)) return false;
    this.eintraege.set(id, { spielerId: id, name, seit: new Date().toISOString() });
    this.speichern();
    return true;
  }

  /** @returns true, wenn ENTFERNT (false = war nicht in der Liste). */
  entfernen(id: SpielerId): boolean {
    this.abgleichen();
    if (!this.eintraege.delete(id)) return false;
    this.speichern();
    return true;
  }

  alle(): AdminEintrag[] {
    this.abgleichen();
    return [...this.eintraege.values()];
  }

  get anzahl(): number {
    this.abgleichen();
    return this.eintraege.size;
  }
}
