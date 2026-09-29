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
 */

/** Kanalname — eigener Name, damit kein anderer Kanal mithört. */
export const GRUNDSKALA_KANAL = 'wov-grundskala-live';

/** Eine Meldung: der Registry-Name (`UploadedModelEntry.name`, z. B. `U_Fass1`). */
export interface GrundskalaEreignis {
  readonly name: string;
  readonly zeitpunkt: number;
}

/**
 * Ob ein empfangenes Ereignis übernommen werden soll. `false` bei einem
 * VERALTETEN Ereignis (Zeitstempel nicht neuer als der zuletzt für DIESEN
 * Namen übernommene) — das deckt sowohl ein echtes Duplikat (derselbe
 * Zeitstempel, z. B. weil zwei Kanal-Instanzen dieselbe Nachricht liefern)
 * als auch einen Nachzügler ab, der nach einer schon neueren Änderung
 * desselben Modells eintrifft. `zuletzt` wird bei Übernahme aktualisiert;
 * andere Modellnamen darin bleiben unberührt.
 */
export function sollGrundskalaUebernehmen(
  zuletzt: Map<string, number>,
  ereignis: GrundskalaEreignis
): boolean {
  const bekannt = zuletzt.get(ereignis.name);
  if (bekannt !== undefined && ereignis.zeitpunkt <= bekannt) return false;
  zuletzt.set(ereignis.name, ereignis.zeitpunkt);
  return true;
}

/** Der Teil von `BroadcastChannel`, den dieses Modul braucht — DOM-frei testbar. */
interface KanalQuelle {
  new (name: string): {
    postMessage(msg: unknown): void;
    addEventListener(art: 'message', hoerer: (e: MessageEvent<GrundskalaEreignis>) => void): void;
    removeEventListener(art: 'message', hoerer: (e: MessageEvent<GrundskalaEreignis>) => void): void;
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
export function sendeGrundskalaGeaendert(name: string): void {
  const Kanal = kanalQuelle();
  if (!Kanal) return;
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  const ereignis: GrundskalaEreignis = { name, zeitpunkt: Date.now() };
  kanal.postMessage(ereignis);
  kanal.close();
}

/**
 * Empfänger-Seite (Testflug): auf Grundskala-Änderungen hören, solange die
 * Rückgabefunktion nicht aufgerufen wurde. Veraltete/doppelte Ereignisse
 * filtert `sollGrundskalaUebernehmen` heraus, bevor `uebernehmen` läuft.
 * Ohne `BroadcastChannel` ein No-Op mit leerer Abmeldefunktion.
 */
export function hoereGrundskalaGeaendert(uebernehmen: (name: string) => void): () => void {
  const Kanal = kanalQuelle();
  if (!Kanal) return () => {};
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  const zuletzt = new Map<string, number>();
  const hoerer = (e: MessageEvent<GrundskalaEreignis>): void => {
    if (!sollGrundskalaUebernehmen(zuletzt, e.data)) return;
    uebernehmen(e.data.name);
  };
  kanal.addEventListener('message', hoerer);
  return () => {
    kanal.removeEventListener('message', hoerer);
    kanal.close();
  };
}
