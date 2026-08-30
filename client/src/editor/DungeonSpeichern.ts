/**
 * LEGACY — wird nach Erfolg von Dungeon Generator 2.0 geloescht / will be
 * deleted once Dungeon Generator 2.0 succeeds. Speichert das Altformat
 * (`DungeonDocument`); ersetzt durch `client/src/editor/dungeon2/`
 * (design/ARCHITECTURE.md §1.1/§1.2, Dungeon2Speichern). Siehe
 * `LEGACY.md`.
 * Saves the old format (`DungeonDocument`); replaced by
 * `client/src/editor/dungeon2/` (design/ARCHITECTURE.md §1.1/§1.2,
 * Dungeon2Speichern). See `LEGACY.md`.
 *
 * Dungeon-Dokument aus dem Karteneditor speichern.
 *
 * Gelesen wird über den Betriebsdienst (`DungeonDokument.ts`), geschrieben
 * über den SPIELSERVER — und das ist kein Schönheitsfehler, sondern der
 * Grund, warum es überhaupt funktioniert: Der laufende Spielserver hält
 * `documents` und `instances` im Arbeitsspeicher und liest die Dateien nur
 * beim Start. Eine vom Betriebsdienst geschriebene Datei wäre für ihn
 * unsichtbar, bis jemand den Dienst neu startet.
 *
 * `DungeonEditSave` dagegen prüft, schreibt UND baut die Instanz gleich neu
 * auf. Ein Weg, drei Wirkungen, alle am selben Ort — das ist derselbe Weg,
 * den der F4-Editor im Spiel nimmt.
 *
 * ── Die Verbindung lebt nur für einen Speichervorgang ────────────────
 * Aufgebaut wird sie beim Klick und sofort danach wieder geschlossen. Der
 * Editor soll ohne Spielserver benutzbar bleiben: Lesen und Zeichnen
 * hängen an nichts, und eine Verbindung, die beim Öffnen des Editors
 * entsteht, wäre eine Abhängigkeit, die man erst bemerkt, wenn sie fehlt.
 *
 * ── Warum sie sich als „nur Editor" anmeldet ─────────────────────────
 * Das dritte Argument des Konstruktors ist kein Beiwerk. Ohne es kostete
 * jeder Speichervorgang zwei Dinge, beide gemessen am 28.08.2026 und
 * beide lautlos:
 *
 *  - Der Server legte einen CHARAKTER an — Charakter-ZDO, Startausrüstung,
 *    12,3 KB Terraforming, ein 15k-ZDO-Scan fürs Baubudget. Ein
 *    Phantom-Wikinger je Klick, sichtbar für alle anderen.
 *  - Der Name kommt AUS DEM KONTO, nicht vom Client (NetManager.ts, „The
 *    NAME comes from the account"). Zwei Verbindungen derselben Kennung
 *    tragen also denselben Namen, und der Duplikatszweig löste die ältere
 *    ab: Speichern im Editor warf den offenen Spielclient hinaus.
 *
 * Die Marke nimmt beides weg und gibt nichts: Der Riegel vor
 * `DungeonEditSave` bleibt `peer.isAdmin`. Bewacht von
 * `server/test/g9-editor-verbindung.ts`, samt Gegenprobe.
 *
 * ── Das Sitzungstoken bleibt nötig ───────────────────────────────────
 * Auf dev steht `everyone-admin: true`, dort speichert die Verbindung
 * auch ohne. Auf einem Server ohne diesen Schalter entscheidet die
 * Admin-Liste über die spielerId — und die kommt allein aus dem
 * Sitzungstoken im localStorage. Ohne Anmeldung gibt es dort also keine
 * Rechte, und das ist richtig so.
 */
import { PacketType, type DungeonDocument } from '@wov/shared';
import { GameSocket } from '../net/GameSocket';

/** Wartezeit auf Verbindung bzw. Antwort. */
const FRIST_MS = 10_000;

export interface SpeicherErgebnis {
  ok: boolean;
  meldung: string;
  /** Das vom Server geprüfte Dokument — maßgeblich, nicht das gesendete. */
  doc?: DungeonDocument;
}

/**
 * Ein Dokument zum Spielserver schicken und auf die Quittung warten.
 *
 * Wirft nicht; jeder Ausgang kommt als `SpeicherErgebnis` zurück. Der
 * Aufrufer soll eine Meldung anzeigen und nicht zwischen Fehlerarten
 * unterscheiden müssen — für ihn sind „kein Server", „keine Rechte" und
 * „Dokument abgelehnt" dasselbe: nicht gespeichert, hier steht warum.
 */
export async function speichereDungeon(doc: DungeonDocument): Promise<SpeicherErgebnis> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Der Name ist Beiwerk: Der Server ersetzt ihn durch den des Kontos,
  // sobald das Sitzungstoken einen Charakter benennt. Er steht hier nur,
  // weil der Konstruktor ihn verlangt, und heisst deshalb, was er ist.
  const socket = new GameSocket(`${proto}://${location.host}/ws`, 'Editor', true);

  return new Promise<SpeicherErgebnis>((fertig) => {
    let erledigt = false;
    // Genau EIN Ausgang, egal welcher Weg zuerst da ist: Quittung,
    // Verbindungsabbruch oder Frist. Ohne diese Sperre loest ein Abbruch
    // NACH der Quittung das Versprechen ein zweites Mal — folgenlos fuer
    // das Promise, aber die zweite Meldung ueberschriebe die erste in der
    // Fusszeile, und die letzte Meldung ist die, die man liest.
    const ende = (e: SpeicherErgebnis): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      socket.onDisconnected = null;
      socket.disconnect();
      fertig(e);
    };

    const uhr = setTimeout(
      () => ende({ ok: false, meldung: `Keine Antwort vom Spielserver (${FRIST_MS / 1000} s)` }),
      FRIST_MS
    );

    socket.on(PacketType.DungeonEditData, (reader) => {
      const ok = reader.readBool();
      const meldung = reader.readString();
      const json = reader.readString();
      let geprueft: DungeonDocument | undefined;
      try {
        geprueft = json ? (JSON.parse(json) as DungeonDocument) : undefined;
      } catch {
        geprueft = undefined;
      }
      ende({ ok, meldung, doc: geprueft });
    });

    socket.onConnected = () => socket.sendDungeonEditSave(JSON.stringify(doc));

    socket.onDisconnected = (grund) => {
      // Vor der Quittung getrennt heisst: Der Server hat uns abgewiesen.
      // Sein Grund ist die brauchbarste Auskunft, die es hier gibt —
      // „Wrong password", „Name already in use", Serverneustart.
      ende({ ok: false, meldung: grund ? `Verbindung beendet: ${grund}` : 'Verbindung beendet' });
    };

    socket.connect();
  });
}
