/**
 * Grundskala live im Testflug (Karte G1, Mikes Beschluss 27.09., Option a):
 * Ändert der Katalog per PATCH `/api/modell-hochladen` die Grundskala eines
 * hochgeladenen Modells, soll ein schon OFFENER Testflug das ohne Neuladen
 * zeigen — auch dann, wenn Katalog und Testflug in zwei verschiedenen
 * Browser-Tabs laufen (`Testflug.ts` öffnet den Flug immer als eigenes
 * Fenster, `window.opener` zeigt zurück zum Editor, s. dort). Der Katalog
 * kennt seine offenen Testflug-Tabs nicht (kein `window.open`-Rückgriff),
 * `BroadcastChannel` erreicht dagegen jeden gleichursprünglichen Tab, ohne
 * dass Sender und Empfänger sich kennen — derselbe Grund, aus dem
 * `entwurfsSpeicher.ts` ihn für den Draft-Abgleich verwendet.
 *
 * Bewusst OHNE `storage`-Fallback (anders als `entwurfsSpeicher.ts`): Dort
 * drohte ein echter Datenverlust (verlorene Platzierung), hier nur ein
 * entgangenes Live-Update — der Katalog-Statustext nennt "Neuladen" ja
 * ohnehin als Rückfallebene, falls `BroadcastChannel` fehlt oder die
 * Nachricht den Tab nicht erreicht.
 *
 * N1 (Nachbesserung nach Angriff, Befunde B4/B5): Die Meldung trägt seit
 * dieser Fassung die neue Grundskala selbst mit (vorher nur Name +
 * Zeitstempel). Zwei Gründe:
 *
 *   - **B4** — eine gefälschte oder verstümmelte Meldung (`null`, ein
 *     String, ein Objekt mit falschen Feldtypen) darf nicht ungeprüft beim
 *     Empfänger ankommen: `istGueltigesEreignis` prüft Objekt, `name` gegen
 *     dasselbe Namensmuster wie die Registry selbst
 *     (`uploadedModelRegistry.NAME_MUSTER`) und `grundskala` als endliche
 *     Zahl im erlaubten Bereich (`GRUNDSKALA_MIN`/`GRUNDSKALA_MAX`, #110).
 *     Alles andere wird verworfen, ohne zu werfen — der Empfänger
 *     (`Testflug.ts`) bekommt nie einen unbehandelten Fehler aus diesem
 *     Kanal.
 *   - **B5** — der bisherige Zeitstempel-Vergleich (`zeitpunkt <= bekannt`)
 *     verwarf eine echte Folgeänderung, sobald die Absenderuhr gegenüber
 *     der vorherigen Meldung stillstand oder zurücksprang (NTP-Korrektur,
 *     zwei Meldungen in derselben Millisekunde). Der Empfänger holt sich
 *     die WIRKSAME Grundskala ohnehin frisch über `ladeHochgeladeneRegistrierung`
 *     (B1) — der Kanal muss also nur noch ein WIRKLICHES Duplikat
 *     unterdrücken, kein verspätetes Original. Ein Vergleich mit dem
 *     zuletzt ÜBERNOMMENEN WERT (statt der Uhrzeit) tut genau das: zwei
 *     Meldungen mit demselben Wert hintereinander (z. B. zwei
 *     Kanal-Instanzen liefern dieselbe Nachricht) werden verworfen, jede
 *     Meldung mit einem ANDEREN Wert — auch zurück auf einen früheren
 *     Stand — wird übernommen, unabhängig von Uhrzeit oder Reihenfolge.
 *
 * N1 (Nachangriff, Befunde N1-1/N1-2/N1-3):
 *
 *   - **N1-1** — der Empfänger-Handler lag bisher als anonyme Funktion
 *     direkt in `Testflug.ts`; ein Test, der ihn prüfen wollte, musste die
 *     Verdrahtung im Test selbst nachbauen und sah damit nie die echte
 *     Datei — zwei Mutationen, die den ursprünglichen Blocker B1 wieder
 *     eingebaut hätten (Abruf nur angestoßen statt abgewartet, Modellname
 *     ohne Upload-Präfix), blieben unbemerkt. `verdrahteGrundskalaLive`
 *     unten ist jetzt die EINE Fassung dieses Handlers; `Testflug.ts` und
 *     der Test (`grundskala-live-wirkung.ts`) importieren beide sie.
 *   - **N1-2** — mehrere Meldungen kurz hintereinander liefen bisher
 *     PARALLEL (jede rief `uebernehmen` sofort auf, ohne auf die vorherige
 *     zu warten): ein langsamer erster Registry-Abruf konnte einen später
 *     gestarteten, aber früher fertigen Abruf überschreiben (Probe im
 *     Angriffsbericht: 2→3→4 mit langsamem ersten Abruf endete bei 3 statt
 *     4). Eine Promise-Kette JE EMPFÄNGER (`kette` unten) serialisiert die
 *     Verarbeitung: `uebernehmen` für eine Meldung startet erst, nachdem
 *     die vorherige vollständig verarbeitet ist. Jede Folge endet damit
 *     beim ZULETZT GESENDETEN Wert, unabhängig von der Antwortzeit.
 *   - **N1-3** — der Wert-Duplikatfilter merkte sich einen Wert schon beim
 *     EMPFANG, bevor `uebernehmen` überhaupt lief. Scheiterte der Abruf
 *     (Server kurz nicht erreichbar), verwarf der Filter jede spätere
 *     Meldung mit demselben Wert als „schon erledigt“, obwohl nichts
 *     angewendet wurde — der Fehlerfall war für denselben Wert unheilbar,
 *     ausser über einen Neuladen oder einen anderen Wert. `zuletzt` wird
 *     jetzt erst NACH erfolgreichem `uebernehmen` gesetzt; scheitert es
 *     (die zurückgegebene Zusage lehnt ab), bleibt der alte Stand
 *     vermerkt und eine erneute Meldung mit demselben Wert wird wieder
 *     versucht (nur `console.warn`, kein unbehandelter Fehler).
 */

import { uploadedModelRegistry } from '@wov/shared';

/** Kanalname — eigener Name, damit kein anderer Kanal mithört. */
export const GRUNDSKALA_KANAL = 'wov-grundskala-live';

/**
 * Eine Meldung: der Registry-Name (`UploadedModelEntry.name`, z. B.
 * `U_Fass1`) und die neue Grundskala — nur zur STRENGEN Prüfung und zum
 * Duplikatfilter (B4/B5 oben). Die tatsächlich angewendete Grundskala holt
 * der Empfänger immer frisch über `ladeHochgeladeneRegistrierung`, nie aus
 * diesem Feld — eine Kanalmeldung ist same-origin, aber same-origin heißt
 * nicht vertrauenswürdig (jeder Tab kann auf denselben Kanal senden).
 */
export interface GrundskalaEreignis {
  readonly name: string;
  readonly grundskala: number;
}

/**
 * Strenge Formprüfung EINER empfangenen Meldung (B4): Objekt (kein `null`,
 * keine Liste), `name` passt auf dasselbe Muster wie ein Registry-Name,
 * `grundskala` ist eine endliche Zahl im erlaubten Bereich. Alles andere —
 * `null`, ein String, fehlende Felder, `NaN`, `0`, negativ, riesig, ein
 * Name ausserhalb des Musters — ist ungültig.
 */
export function istGueltigesEreignis(x: unknown): x is GrundskalaEreignis {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  if (typeof e.name !== 'string' || !uploadedModelRegistry.NAME_MUSTER.test(e.name)) return false;
  const g = e.grundskala;
  return (
    typeof g === 'number' &&
    Number.isFinite(g) &&
    g >= uploadedModelRegistry.GRUNDSKALA_MIN &&
    g <= uploadedModelRegistry.GRUNDSKALA_MAX
  );
}

/** Der Teil von `BroadcastChannel`, den dieses Modul braucht — DOM-frei testbar. */
interface KanalQuelle {
  new (name: string): {
    postMessage(msg: unknown): void;
    addEventListener(art: 'message', hoerer: (e: MessageEvent<unknown>) => void): void;
    removeEventListener(art: 'message', hoerer: (e: MessageEvent<unknown>) => void): void;
    close(): void;
  };
}

function kanalQuelle(): KanalQuelle | null {
  const g = globalThis as { BroadcastChannel?: KanalQuelle };
  return g.BroadcastChannel ?? null;
}

/**
 * Sender-Seite (Katalog, `GegenstandsKatalog.grundskalaAendernAusfuehren`):
 * allen anderen Tabs melden, dass sich die Grundskala von `name` geändert
 * hat. Ohne `BroadcastChannel` (s. Kopfkommentar) ein stiller No-Op.
 */
export function sendeGrundskalaGeaendert(name: string, grundskala: number): void {
  const Kanal = kanalQuelle();
  if (!Kanal) return;
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  const ereignis: GrundskalaEreignis = { name, grundskala };
  kanal.postMessage(ereignis);
  kanal.close();
}

/**
 * Empfänger-Seite (Testflug): auf Grundskala-Änderungen hören, solange die
 * Rückgabefunktion nicht aufgerufen wurde. Ungültige Meldungen (B4) filtert
 * diese Funktion heraus, bevor `uebernehmen` läuft — sie wirft nie, egal was
 * auf dem Kanal ankommt. Ohne `BroadcastChannel` ein No-Op mit leerer
 * Abmeldefunktion.
 *
 * N1-2/N1-3 (Kopfkommentar): `uebernehmen` darf eine Zusage zurückgeben.
 * Mehrere Meldungen werden über `kette` STRENG NACHEINANDER verarbeitet
 * (N1-2), und `zuletzt` — der Wert-Duplikatfilter (B5) — wird erst nach
 * erfolgreichem `uebernehmen` aktualisiert (N1-3), nie schon beim Empfang.
 * Eine abgelehnte Zusage geht nur in `console.warn`, nie als unbehandelter
 * Fehler zum Aufrufer.
 */
export function hoereGrundskalaGeaendert(
  uebernehmen: (name: string, grundskala: number) => void | Promise<void>
): () => void {
  const Kanal = kanalQuelle();
  if (!Kanal) return () => {};
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  const zuletzt = new Map<string, number>();
  let kette: Promise<void> = Promise.resolve();
  const hoerer = (e: MessageEvent<unknown>): void => {
    if (!istGueltigesEreignis(e.data)) return;
    const ereignis = e.data;
    if (zuletzt.get(ereignis.name) === ereignis.grundskala) return;
    kette = kette
      .then(() => uebernehmen(ereignis.name, ereignis.grundskala))
      .then(() => {
        zuletzt.set(ereignis.name, ereignis.grundskala);
      })
      .catch((fehler: unknown) => {
        console.warn(
          '[grundskalaLive] Übernahme fehlgeschlagen, wird bei einer erneuten Meldung wiederholt:',
          ereignis.name,
          fehler
        );
      });
  };
  kanal.addEventListener('message', hoerer);
  return () => {
    kanal.removeEventListener('message', hoerer);
    kanal.close();
  };
}

/**
 * Der DOM-freie Empfänger-Handler selbst (N1-1): `Testflug.ts` ruft GENAU
 * diese Funktion auf und enthält keine eigene Verdrahtungslogik mehr — sie
 * bekommt ihre Abhängigkeiten (Registry-Lader, `aktualisiereGrundskala`,
 * `flush`) als Parameter, ist damit DOM-frei aufrufbar und wird von
 * `client/test/grundskala-live-wirkung.ts` im Worker-Realm importiert und
 * benutzt, statt die Verdrahtung nachzubauen.
 */
export interface GrundskalaLiveEmpfaenger {
  /** Lädt die Upload-Registry DIESES Fensters neu (Blocker B1: ohne das bleibt `AssetManager.wendeGrundskalaAn` beim alten Wert). */
  readonly ladeRegistry: () => Promise<unknown>;
  /** `EntityManager.aktualisiereGrundskala`, mit dem VOLLEN Prefab-Namen inklusive Upload-Präfix. */
  readonly aktualisiereGrundskala: (model: string) => Promise<unknown>;
  /** Den markierten Bucket noch in diesem Tick ausführen. */
  readonly flush: () => void;
}

export function verdrahteGrundskalaLive(empfaenger: GrundskalaLiveEmpfaenger): () => void {
  return hoereGrundskalaGeaendert(async (name) => {
    await empfaenger.ladeRegistry();
    await empfaenger.aktualisiereGrundskala(`${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${name}`);
    empfaenger.flush();
  });
}
