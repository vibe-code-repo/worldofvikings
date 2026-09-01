/**
 * AP15.1 — Speicher-Netzweg für den Dungeon Generator 2.0 im Karteneditor.
 * AP15.1 — save network path for Dungeon Generator 2.0 in the map editor.
 *
 * Kein neues Paket: Der Server verzweigt bereits in `WovServer.handleDungeonEditSave`
 * (siehe `dungeon2.istDokument2(raw)`) auf `upsertDokument2()`, sobald das
 * gesendete JSON `version >= DOKUMENT_2_AB_VERSION` trägt. Dieser Client-Weg
 * ist deshalb dieselbe Leitung wie im LEGACY-`DungeonSpeichern.ts`
 * (`DungeonEditSave` → `DungeonEditData`), nur mit einem `DungeonDokument2`
 * als Nutzlast statt eines `DungeonDocument`. `GameSocket.sendDungeonEditSave`
 * nimmt bereits eine rohe JSON-Zeichenkette entgegen — auch dort ist nichts
 * neu zu bauen.
 * No new packet: the server already branches in `WovServer.handleDungeonEditSave`
 * (see `dungeon2.istDokument2(raw)`) to `upsertDokument2()` once the sent JSON
 * carries `version >= DOKUMENT_2_AB_VERSION`. This client path is therefore the
 * SAME wire as the LEGACY `DungeonSpeichern.ts` (`DungeonEditSave` →
 * `DungeonEditData`), just with a `DungeonDokument2` payload instead of a
 * `DungeonDocument`. `GameSocket.sendDungeonEditSave` already accepts a raw
 * JSON string — nothing new to build there either.
 *
 * ── Warum `host` statt `location.host` ────────────────────────────────────
 * Das LEGACY-Vorbild liest Protokoll und Host direkt aus `location` — im
 * Browser richtig, aber das macht die Funktion ausserhalb eines Browsers
 * (Testlauf unter Node/tsx gegen einen echten `WovServer`) unbenutzbar.
 * `host` ist deshalb ein Parameter (z. B. `127.0.0.1:2499` im Test oder
 * `location.host` im echten Editor); das Protokoll (`ws`/`wss`) wird — wenn
 * vorhanden — weiter aus `location.protocol` abgeleitet, sonst faellt es auf
 * `ws` zurück.
 * Why `host` instead of `location.host`: the LEGACY template reads protocol
 * and host straight from `location` — correct in a browser, but that makes
 * the function unusable outside one (a test run under Node/tsx against a real
 * `WovServer`). `host` is therefore a parameter; the protocol still comes from
 * `location.protocol` when present, else falls back to `ws`.
 *
 * ── Warum `nurEditor` ──────────────────────────────────────────────────────
 * Wie im LEGACY-Vorbild: Ohne die Marke legt der Server einen Charakter an
 * und der Duplikatszweig wirft einen offenen Spielclient desselben Kontos
 * hinaus (s. Kopfkommentar `DungeonSpeichern.ts`). Dieselbe Begründung gilt
 * unverändert für 2.0-Dokumente — der Speicherweg ist identisch, nur die
 * Nutzlast ist neu.
 * Same as the LEGACY template: without the flag the server creates a
 * character and the duplicate-name branch evicts an open game client of the
 * same account. The same reasoning applies unchanged for 2.0 documents.
 */
import { PacketType, dungeon2 } from '@wov/shared';
import { GameSocket } from '../../net/GameSocket';

/** Wartezeit auf Verbindung bzw. Antwort — wie im LEGACY-Vorbild. */
/** Wait time for connection resp. reply — same as the LEGACY template. */
const FRIST_MS = 10_000;

export interface Dungeon2SpeicherOptionen {
  /**
   * Wird mit jeder Statuszeile aufgerufen (verbunden, gesendet, Quittung) —
   * für eine spätere UI (AP15.2-Katalog), die "Speichere …" anzeigen will,
   * ohne auf das fertige Promise zu warten. Optional; ohne Angabe passiert
   * nichts.
   * Called with every status line (connected, sent, reply) — for a later UI
   * (AP15.2 catalogue) that wants to show "Saving …" without waiting for the
   * settled promise. Optional; a no-op when omitted.
   */
  aufMeldung?: (meldung: string) => void;
}

export interface Dungeon2SpeicherErgebnis {
  ok: boolean;
  /** Das vom Server geprüfte Dokument — maßgeblich, nicht das gesendete. */
  /** The document as checked by the server — authoritative, not the one sent. */
  dokument?: dungeon2.DungeonDokument2;
  /** Nur gesetzt, wenn `ok === false`. */
  /** Only set when `ok === false`. */
  fehler?: string;
}

/** `ws`/`wss` je nach Browser-Kontext, sonst `ws` (Testlauf unter Node). */
/** `ws`/`wss` depending on browser context, else `ws` (test run under Node). */
function protokoll(): string {
  return typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
}

/**
 * Ein 2.0-Dokument zum Spielserver schicken und auf die Quittung warten.
 *
 * Wirft nicht; jeder Ausgang kommt als `Dungeon2SpeicherErgebnis` zurück —
 * dieselbe Zusicherung wie im LEGACY-Vorbild, damit der Aufrufer (AP15.2)
 * nicht zwischen "kein Server", "keine Rechte" und "Dokument abgelehnt"
 * unterscheiden muss.
 *
 * Never throws; every outcome comes back as a `Dungeon2SpeicherErgebnis` —
 * same guarantee as the LEGACY template, so the caller (AP15.2) never has to
 * tell "no server", "no permission" and "document rejected" apart.
 */
export async function speichereDungeon2(
  host: string,
  dokument: dungeon2.DungeonDokument2,
  optionen: Dungeon2SpeicherOptionen = {}
): Promise<Dungeon2SpeicherErgebnis> {
  const { aufMeldung } = optionen;
  const melde = (m: string): void => aufMeldung?.(m);

  // Der Name ist Beiwerk (wie im LEGACY-Vorbild): Der Server ersetzt ihn
  // durch den des Kontos, sobald das Sitzungstoken einen Charakter benennt.
  // The name is decoration (as in the LEGACY template): the server replaces
  // it with the account's once the session token names a character.
  const socket = new GameSocket(`${protokoll()}://${host}/ws`, 'Editor', true);

  return new Promise<Dungeon2SpeicherErgebnis>((fertig) => {
    let erledigt = false;
    // Genau EIN Ausgang, egal welcher Weg zuerst da ist — wie im
    // LEGACY-Vorbild (Kopfkommentar dort erklärt, warum das nötig ist).
    // Exactly ONE outcome, no matter which path arrives first — same
    // reasoning as the LEGACY template.
    const ende = (e: Dungeon2SpeicherErgebnis): void => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      socket.onDisconnected = null;
      socket.disconnect();
      fertig(e);
    };

    const uhr = setTimeout(() => {
      const meldung = `Keine Antwort vom Spielserver (${FRIST_MS / 1000} s)`;
      melde(meldung);
      ende({ ok: false, fehler: meldung });
    }, FRIST_MS);

    socket.on(PacketType.DungeonEditData, (reader) => {
      const ok = reader.readBool();
      const meldung = reader.readString();
      const json = reader.readString();
      melde(meldung);

      if (!ok) {
        ende({ ok: false, fehler: meldung });
        return;
      }

      // Das SERVERGEPRÜFTE Dokument übernehmen, nicht das gesendete — der
      // Server hat es sanitisiert (upsertDokument2), und genau dieser Stand
      // muss im Editor landen.
      // Adopt the SERVER-CHECKED document, not the one sent — the server has
      // sanitized it, and exactly that state must end up back in the editor.
      let geprueft: unknown;
      try {
        geprueft = json ? JSON.parse(json) : undefined;
      } catch {
        geprueft = undefined;
      }
      // Verteidigung gegen einen theoretisch falsch geroutet zurückkommenden
      // Altbestand: Ohne diese Prüfung würde ein DungeonDocument stillschweigend
      // als DungeonDokument2 durchgereicht.
      // Defense against a legacy document theoretically routed back wrongly:
      // without this check a DungeonDocument would silently pass as a
      // DungeonDokument2.
      if (!geprueft || !dungeon2.istDokument2(geprueft)) {
        ende({ ok: false, fehler: 'Server-Antwort war kein 2.0-Dokument' });
        return;
      }
      ende({ ok: true, dokument: geprueft as dungeon2.DungeonDokument2 });
    });

    socket.onConnected = () => {
      melde('Verbunden, sende Dokument …');
      socket.sendDungeonEditSave(JSON.stringify(dokument));
    };

    socket.onDisconnected = (grund) => {
      // Vor der Quittung getrennt heisst: Der Server hat uns abgewiesen —
      // wie im LEGACY-Vorbild.
      // Disconnected before the reply means the server rejected us — same
      // as the LEGACY template.
      const meldung = grund ? `Verbindung beendet: ${grund}` : 'Verbindung beendet';
      melde(meldung);
      ende({ ok: false, fehler: meldung });
    };

    socket.connect();
  });
}
