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

/**
 * Ob ein empfangenes (schon als gültig geprüftes) Ereignis übernommen
 * werden soll. `false` nur bei einem echten WERT-Duplikat: derselbe Name
 * meldet dieselbe Grundskala wie die zuletzt übernommene Meldung (B5,
 * Kopfkommentar). `zuletzt` wird bei Übernahme aktualisiert; andere
 * Modellnamen darin bleiben unberührt.
 */
export function sollGrundskalaUebernehmen(
  zuletzt: Map<string, number>,
  ereignis: GrundskalaEreignis
): boolean {
  if (zuletzt.get(ereignis.name) === ereignis.grundskala) return false;
  zuletzt.set(ereignis.name, ereignis.grundskala);
  return true;
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
 * Rückgabefunktion nicht aufgerufen wurde. Ungültige Meldungen (B4) und
 * Wert-Duplikate (B5) filtert diese Funktion heraus, bevor `uebernehmen`
 * läuft — sie wirft nie, egal was auf dem Kanal ankommt. Ohne
 * `BroadcastChannel` ein No-Op mit leerer Abmeldefunktion.
 */
export function hoereGrundskalaGeaendert(uebernehmen: (name: string) => void): () => void {
  const Kanal = kanalQuelle();
  if (!Kanal) return () => {};
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  const zuletzt = new Map<string, number>();
  const hoerer = (e: MessageEvent<unknown>): void => {
    if (!istGueltigesEreignis(e.data)) return;
    if (!sollGrundskalaUebernehmen(zuletzt, e.data)) return;
    uebernehmen(e.data.name);
  };
  kanal.addEventListener('message', hoerer);
  return () => {
    kanal.removeEventListener('message', hoerer);
    kanal.close();
  };
}
