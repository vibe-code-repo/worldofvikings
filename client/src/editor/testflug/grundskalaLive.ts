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
 *     Meldung mit demselben Wert als „schon erledigt”, obwohl nichts
 *     angewendet wurde — der Fehlerfall war für denselben Wert unheilbar,
 *     ausser über einen Neuladen oder einen anderen Wert. (Diese N1-Fassung
 *     ist inzwischen durch N3 unten ersetzt — der Filter selbst ist weg.)
 *
 * N3 (Nachbesserung nach Nachangriff N2, Befunde N2-1/N2-2/N2-4):
 *
 *   - **N2-1/N2-2** — der Wert-Duplikatfilter (`zuletzt`) ist GESTRICHEN.
 *     `ladeHochgeladeneRegistrierung` (der echte Registry-Lader) WIRFT NIE
 *     (Kopfkommentar dort) — bei HTTP 500 oder Netzfehler löst er mit der
 *     ALTEN Registry auf, kein Fehlschlag, den N1-3 hätte auffangen können.
 *     Der Filter markierte also selbst einen fehlgeschlagenen Abruf als
 *     „übernommen” (N2-1: ein 500 sperrte denselben Wert dauerhaft) UND
 *     verglich beim EMPFANG gegen einen Stand, der erst nach Abarbeitung
 *     galt (N2-2: A → B → A endete bei B, wenn der Abruf zu B noch lief,
 *     als das zweite A gesendet wurde). Beide Fehler sind Folgen des
 *     Filters selbst, keine Ausnahmefälle, die sich absichern liessen. Der
 *     Registry-Abruf ist idempotent (derselbe Wert wird einfach erneut
 *     geholt), und die Kette (N1-2 oben) sorgt schon für die Reihenfolge —
 *     ein doppelter Lauf kostet nur einen zusätzlichen `fetch`, mehr
 *     Absicherung braucht es nicht.
 *   - **N2-4** — die Kette lief nach dem Abmelden (Szene geschlossen)
 *     weiter: schon eingereihte Einträge riefen `aktualisiereGrundskala`
 *     und `flush` noch auf einer verworfenen Szene auf. `verdrahteGrundskalaLive`
 *     prüft jetzt ein `beendet`-Flag, das die Abmeldefunktion setzt, vor
 *     `aktualisiereGrundskala` UND vor `flush` — ein zu diesem Zeitpunkt
 *     schon laufender `ladeRegistry`-Abruf darf zu Ende laufen (er wirft
 *     nie und hat keine sichtbare Nebenwirkung), nur die beiden
 *     Szenen-Zugriffe danach unterbleiben. Zusätzlich ein Zeitlimit für
 *     den Registry-Abruf NUR in dieser Verdrahtung (nicht im gemeinsamen
 *     `ladeHochgeladeneRegistrierung` — der hat andere Aufrufer, z. B.
 *     `main.ts` beim Start, für die ein hartes Zeitlimit falsch wäre):
 *     ein hängender `fetch` (toter Proxy) blockierte die Kette sonst
 *     unbegrenzt. Nach dem Zeitlimit läuft die Kette mit dem zu diesem
 *     Zeitpunkt bekannten Registry-Stand weiter, statt zu hängen.
 *
 * N4 (Nachbesserung nach Nachangriff N3, Befunde N3-1/N3-2; N3-3 bewusst
 * NICHT ausgebaut, s. `grundskala-live-wirkung.ts`):
 *
 *   - **N3-1** — das N2-4-Zeitlimit oben liess nur die KETTE weiterlaufen,
 *     der `fetch` in `ladeHochgeladeneRegistrierung` lief im Hintergrund
 *     unbeobachtet weiter. Kam die späte Antwort irgendwann an, schrieb sie
 *     die GLOBALE Registry des Fensters — mit dem Stand, den der Server
 *     beim (längst überholten) Anfrageeingang hatte — und überschrieb damit
 *     still einen inzwischen neueren, schon korrekt angewendeten Wert
 *     (Angriffsproben S4b/S4d). `ladeHochgeladeneRegistrierung` bekommt
 *     jetzt ein optionales `signal?: AbortSignal` (durchgereicht an
 *     `fetch`, andere Aufrufer unverändert). Diese Verdrahtung legt PRO
 *     ABRUF einen eigenen `AbortController` an (`mitZeitlimit` unten) und
 *     bricht ihn ZWEIFACH aus: beim Zeitlimit UND beim Abmelden — ein
 *     abgebrochener Abruf landet im `catch` von `ladeHochgeladeneRegistrierung`
 *     (wirft dort nie) und schreibt die Registry nicht mehr.
 *   - **N3-2** — die Kette prüfte `beendet` bisher erst NACH dem
 *     Registry-Abruf. Ein zum Abmeldezeitpunkt schon EINGEREIHTER, aber
 *     noch nicht gestarteter Eintrag löste dadurch trotzdem noch einen
 *     Netzabruf und einen Schreibzugriff auf die Registry eines Fensters
 *     aus, dessen Szene schon verworfen war (Probe S5). `if (beendet)
 *     return;` steht jetzt als ERSTE Zeile im Ketten-Eintrag — ein nach dem
 *     Abmelden noch anlaufender Eintrag tut gar nichts mehr.
 */

import { uploadedModelRegistry } from '@wov/shared';

/** Kanalname — eigener Name, damit kein anderer Kanal mithört. */
export const GRUNDSKALA_KANAL = 'wov-grundskala-live';

/**
 * Eine Meldung: der Registry-Name (`UploadedModelEntry.name`, z. B.
 * `U_Fass1`) und die neue Grundskala — nur zur STRENGEN Prüfung (B4 oben,
 * kein Duplikatfilter mehr, N3/N2-1/N2-2). Die tatsächlich angewendete
 * Grundskala holt der Empfänger immer frisch über
 * `ladeHochgeladeneRegistrierung`, nie aus diesem Feld — eine Kanalmeldung
 * ist same-origin, aber same-origin heißt nicht vertrauenswürdig (jeder
 * Tab kann auf denselben Kanal senden).
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
 * N1-2/N3 (Kopfkommentar): `uebernehmen` darf eine Zusage zurückgeben.
 * Mehrere Meldungen werden über `kette` STRENG NACHEINANDER verarbeitet
 * (N1-2). Kein Wert-Duplikatfilter mehr (N3/N2-1/N2-2) — jede gültige
 * Meldung löst einen Lauf aus, ein doppelter Lauf kostet nur einen
 * zusätzlichen Abruf. Eine abgelehnte Zusage geht nur in `console.warn`,
 * nie als unbehandelter Fehler zum Aufrufer.
 */
export function hoereGrundskalaGeaendert(
  uebernehmen: (name: string, grundskala: number) => void | Promise<void>
): () => void {
  const Kanal = kanalQuelle();
  if (!Kanal) return () => {};
  const kanal = new Kanal(GRUNDSKALA_KANAL);
  let kette: Promise<void> = Promise.resolve();
  const hoerer = (e: MessageEvent<unknown>): void => {
    if (!istGueltigesEreignis(e.data)) return;
    const ereignis = e.data;
    kette = kette
      .then(() => uebernehmen(ereignis.name, ereignis.grundskala))
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
  /**
   * Lädt die Upload-Registry DIESES Fensters neu (Blocker B1: ohne das
   * bleibt `AssetManager.wendeGrundskalaAn` beim alten Wert). N4/N3-1:
   * bekommt das `AbortSignal` dieses Abrufs — beim Zeitlimit UND beim
   * Abmelden abgebrochen (durchreichen an `fetch`, z. B.
   * `ladeHochgeladeneRegistrierung(basis, signal)`), damit ein zu
   * langsamer oder hängender Abruf die Registry nicht mehr still mit
   * einem überholten Stand überschreiben kann.
   */
  readonly ladeRegistry: (signal: AbortSignal) => Promise<unknown>;
  /** `EntityManager.aktualisiereGrundskala`, mit dem VOLLEN Prefab-Namen inklusive Upload-Präfix. */
  readonly aktualisiereGrundskala: (model: string) => Promise<unknown>;
  /** Den markierten Bucket noch in diesem Tick ausführen. */
  readonly flush: () => void;
}

/** N2-4: Zeitlimit für den Registry-Abruf NUR in dieser Verdrahtung — der gemeinsame Lader (andere Aufrufer, z. B. `main.ts`) bleibt unverändert. */
const REGISTRY_ZEITLIMIT_MS = 10_000;

/**
 * `p` abwarten, aber nach `ms` spätestens weitermachen (N2-4: ein
 * hängender `fetch`, z. B. toter Proxy, darf die Kette nicht unbegrenzt
 * blockieren) UND `abbruch` auslösen (N4/N3-1: der `fetch` selbst muss
 * wirklich enden, sonst schreibt eine späte Antwort später still einen
 * überholten Stand in die globale Registry). Löst IMMER auf, nie ab —
 * `ladeRegistry` wirft ohnehin nie (Kopfkommentar
 * `UploadedModelRegistryLoad.ts`), dieser Wrapper ist nur die zeitliche
 * Grenze, kein Fehlerpfad.
 */
function mitZeitlimit(p: Promise<unknown>, ms: number, abbruch: AbortController): Promise<void> {
  return new Promise((resolve) => {
    let erledigt = false;
    const timer = setTimeout(() => {
      erledigt = true;
      abbruch.abort();
      resolve();
    }, ms);
    p.then(
      () => {
        if (erledigt) return;
        erledigt = true;
        clearTimeout(timer);
        resolve();
      },
      () => {
        if (erledigt) return;
        erledigt = true;
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

export function verdrahteGrundskalaLive(
  empfaenger: GrundskalaLiveEmpfaenger,
  zeitlimitMs: number = REGISTRY_ZEITLIMIT_MS
): () => void {
  let beendet = false;
  let laufenderAbbruch: AbortController | null = null;
  const abmelden = hoereGrundskalaGeaendert(async (name) => {
    // N3-2: ganz am Anfang, VOR dem Registry-Abruf — ein zum Abmeldezeitpunkt
    // schon eingereihter, aber noch nicht gestarteter Eintrag tut dann gar
    // nichts mehr, statt noch einen Netzabruf auszulösen.
    if (beendet) return;
    const abbruch = new AbortController();
    laufenderAbbruch = abbruch;
    await mitZeitlimit(empfaenger.ladeRegistry(abbruch.signal), zeitlimitMs, abbruch);
    laufenderAbbruch = null;
    if (beendet) return;
    await empfaenger.aktualisiereGrundskala(`${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${name}`);
    if (beendet) return;
    empfaenger.flush();
  });
  return () => {
    beendet = true;
    // N3-1: ein noch laufender Abruf darf nicht mehr fertig werden und
    // später still die Registry schreiben.
    laufenderAbbruch?.abort();
    abmelden();
  };
}
