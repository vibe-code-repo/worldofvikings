/**
 * Entwurfsspeicher — der Browser-Entwurf des Editors, gegen fremde Schreiber
 * abgesichert.
 *
 * ── Das Problem ──────────────────────────────────────────────────────
 * Der Entwurf liegt unter EINEM localStorage-Schlüssel, und den schreiben
 * mehrere Tabs: der Editor und der Offline-Testflug (`?offline=1&layout=editor`,
 * client/src/main.ts), der dort Platzierungen und Routen setzt. Der Editor
 * schrieb bei jeder Änderung seinen Stand hinaus, ohne je nachzusehen, ob
 * unter dem Schlüssel inzwischen etwas anderes stand. Wer im Testflug ein
 * Objekt setzte, verlor es bei der nächsten Editor-Änderung — still.
 *
 * ── Die Regel ────────────────────────────────────────────────────────
 * Dieser Tab schreibt den Entwurf nur, wenn unter dem Schlüssel noch das
 * steht, was er selbst zuletzt gelesen oder geschrieben hat (`bekannt`,
 * der Rohtext). Steht dort etwas anderes, hat ein anderer Tab geschrieben:
 * Der Rohtext ist der Zeuge, nicht ein Stempel — der Testflug schreibt
 * keinen. Dann gilt:
 *
 *   1. Der eigene Schreibversuch entfällt (`schreiben` liefert 'fremd').
 *   2. `beiFremdem` bekommt den fremden Stand. Der Aufrufer MUSS seinen
 *      jetzigen Stand als Rückgängig-Schritt festhalten, bevor er den
 *      fremden übernimmt — so geht weder der fremde noch der eigene
 *      Stand verloren: der fremde ist der Entwurf, der eigene der
 *      Rückgängig-Stapel.
 *   3. Übernommen wird OHNE Zurückschreiben. Sonst würde der andere Tab
 *      unsere Übernahme als fremde Änderung sehen, sie zurückübernehmen
 *      und so weiter: ein Ping-Pong ohne Ende.
 *
 * „Jünger" heisst dabei schlicht: später in den Speicher geschrieben. Der
 * Speicher hält immer den letzten Schreiber; was dort vom Bekannten
 * abweicht, ist zwangsläufig nach unserem Stand entstanden. Der Stempel
 * (`geaendertUm`, `tabId` im Begleitzettel und in der Kanalnachricht) ist
 * eine Auskunft für die Meldung, keine Entscheidungsgrundlage.
 *
 * ── Woher der Anstoss kommt ──────────────────────────────────────────
 * Drei Wege, alle führen in dieselbe idempotente Prüfung (`pruefe`):
 *   - `storage`-Ereignis (der Browser liefert es nie an den schreibenden
 *     Tab selbst, nur an die anderen),
 *   - `BroadcastChannel`, wo vorhanden,
 *   - der Schreibversuch selbst — der letzte Riegel, der auch dann hält,
 *     wenn ein Ereignis ausbleibt (Tab im Hintergrund, Ereignis noch
 *     unterwegs). Er kostet zwei `getItem` je Schreibvorgang: eines auf den
 *     Entwurf (die Prüfung) und eines auf den Begleitzettel (dessen Basis
 *     bleibt beim Schreiben erhalten).
 * Jede Prüfung liest den Speicher NEU, statt dem Ereignis zu glauben.
 * Damit ist die Reihenfolge der Ereignisse gleichgültig.
 *
 * ── Die Basis gilt je BROWSER, nicht je Tab ──────────────────────────
 * Entwurf und Begleitzettel (`STAND_KEY`, Feld `basis`) liegen je einmal im
 * localStorage, alle Tabs und der Testflug teilen sie. Entscheidet Tab B im
 * Dialog „Entwurf behalten" über den Serverstand hB, gilt hB als Basis auch
 * für Tab A, dessen Dialog noch einen älteren Stand zeigt: Speichert A danach,
 * ersetzt es hB, ohne dass A's Nutzer ihn gesehen hat. Formal gedeckt (der
 * Nutzer hat in B ausdrücklich entschieden), aber ohne Warnung in A. Der
 * Editor prüft vor jedem Speichern, ob ein anderer Tab den Entwurf geändert hat
 * (`abgleichen`, editorMain `fremderEntwurfUebernommen`); die Basis ist davon
 * nicht betroffen.
 *
 * ── Bewusst DOM-frei ─────────────────────────────────────────────────
 * Speicher, Ereignisquelle, Kanal, Uhr und Tab-Kennung werden
 * hereingereicht; der Browser-Standard steht in `browserUmgebung()`. So
 * läuft die Zwei-Tab-Prüfung in Node mit einer Attrappe (client/test/
 * entwurfs-speicher.ts).
 *
 * Der Entwurf selbst bleibt ein reines WorldLayout (main.ts, RoutenEditor
 * und RoutenVorschau lesen ihn Feld für Feld); der Stempel steht im
 * Begleitzettel unter `STAND_KEY`.
 */
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import { ENTWURF_KEY, STAND_KEY, enthaelt, gleich, type EntwurfsQuelle, type EntwurfsStand } from './weltdokument';

/** Name des BroadcastChannel — eigener Name, damit kein anderer Kanal mithört. */
export const ENTWURF_KANAL = 'wov-editor-entwurf';

/**
 * Der Begleitzettel, wie er geschrieben wird: `EntwurfsStand` plus die BASIS —
 * der Hash des Serverdokuments, AUF DEM DER ENTWURF BERUHT. Das ist enger als
 * „zuletzt gesehen": Ein Editor, der einen neueren Serverstand nur geholt und
 * dem Nutzer gezeigt hat, ändert die Basis nicht. Sie wird nur gesetzt, wenn
 *   1. Serverinhalt den Entwurf ersetzt (Serverstand laden, Start ohne
 *      Entwurf, „Serverstand übernehmen"),
 *   2. ein Speichern in die Welt gelang (Entwurf == Server) oder
 *   3. der Nutzer im Dialog ausdrücklich „Entwurf behalten" wählt (dann
 *      ersetzt das nächste Speichern den gesehenen Serverstand — bewusst).
 * Wer ohne den Editor auf den Server schreibt (der Testflug,
 * `LocalStoragePersistenz`), schickt genau diese Basis als `If-Match` mit;
 * der Betriebsdienst lehnt jeden Stand ab, auf dem der Entwurf nicht beruht.
 * Der Testflug schreibt am Zettel nur dieses eine Feld (nach einem
 * erfolgreichen Speichern), sonst nichts: Stempel und Kennung bleiben, wie
 * sie sind.
 */
export interface Begleitzettel extends EntwurfsStand {
  basis?: string;
}

/** Die Basis aus dem Rohtext des Begleitzettels; `null`, wenn keiner da, nicht lesbar oder ohne Basis. */
export function zettelBasisLesen(roh: string | null | undefined): string | null {
  if (!roh) return null;
  try {
    const d = JSON.parse(roh) as { basis?: unknown } | null;
    return d && typeof d.basis === 'string' && d.basis.trim() !== '' ? d.basis : null;
  } catch {
    return null;
  }
}

/**
 * Der Rohtext des Zettels mit gesetzter (`basis`) bzw. entfernter (`null`)
 * Basis, alle übrigen Felder unverändert. `null`, wenn es keinen lesbaren
 * Zettel gibt: einen Zettel aus dem Nichts erfindet diese Funktion nicht.
 */
export function zettelMitBasis(roh: string | null | undefined, basis: string | null): string | null {
  if (!roh) return null;
  try {
    const d = JSON.parse(roh) as Record<string, unknown> | null;
    if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.zeit !== 'string') return null;
    if (basis) d.basis = basis;
    else delete d.basis;
    return JSON.stringify(d);
  } catch {
    return null;
  }
}

/** Der Teil von `Storage`, den der Speicher braucht. */
export interface KvSpeicher {
  getItem(schluessel: string): string | null;
  setItem(schluessel: string, wert: string): void;
  /** Fehlt bei einem Speicher, der nichts entfernen kann; dann bleibt ein alter Zettel stehen. */
  removeItem?(schluessel: string): void;
}

/** Was der Ring braucht: alle Schlüssel durchsuchen und einzelne entfernen (jeder Eintrag ist ein eigener Schlüssel). */
export interface RingSpeicher extends KvSpeicher {
  readonly length: number;
  key(index: number): string | null;
  removeItem(schluessel: string): void;
}

/** Der Teil von `window`, der `storage`-Ereignisse liefert. */
export interface EreignisQuelle {
  addEventListener(art: 'storage', hoerer: (e: { key: string | null }) => void): void;
  removeEventListener(art: 'storage', hoerer: (e: { key: string | null }) => void): void;
}

/** Der Teil von `BroadcastChannel`, den der Speicher braucht. */
export interface Kanal {
  postMessage(nachricht: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

/** Wodurch der fremde Stand bemerkt wurde. */
export type FremdWeg = 'ereignis' | 'kanal' | 'schreiben' | 'abgleich';

export interface FremdInfo {
  wie: FremdWeg;
  /** Kennung des schreibenden Tabs; `null` bei Schreibern ohne Stempel (Testflug). */
  tabId: string | null;
  /** Zeitpunkt der fremden Änderung laut Stempel (ms); `null` ohne Stempel. */
  geaendertUm: number | null;
}

export interface EntwurfsSpeicherOptionen {
  speicher: KvSpeicher;
  ereignisse?: EreignisQuelle | null;
  kanal?: Kanal | null;
  tabId?: string;
  jetzt?: () => number;
  /** Der Stand, den dieser Tab gerade zeigt — Vergleichsbasis für „fremd". */
  aktuell: () => WorldLayout;
  /**
   * Ein anderer Tab hat einen abweichenden Entwurf geschrieben. Der
   * Aufrufer legt zuerst einen Rückgängig-Punkt an, übernimmt `fremd` und
   * schreibt NICHT zurück (Ping-Pong, s. Kopf der Datei).
   */
  beiFremdem: (fremd: WorldLayout, info: FremdInfo) => void;
  /**
   * Ein Schreibvorgang ersetzt einen im Speicher stehenden FREMDEN Stand
   * (übernommen, seither nicht von diesem Tab überschrieben) durch einen
   * anderen, der ihn nicht enthält. Sicherheitsnetz für den Fall, dass der
   * fremde Stand in keinem Stapel des Aufrufers mehr liegt: Der Aufrufer
   * prüft das und sichert ihn dann (Ring der verdrängten Entwürfe).
   */
  beiVerdraengt?: (alt: WorldLayout, neu: WorldLayout) => void;
  /**
   * Der ENTWURF passt nicht mehr in den Speicher (Quote): Der Aufrufer macht
   * Platz (der Editor entfernt den ältesten Eintrag des Rings) und liefert
   * `true`, wenn er etwas freigegeben hat. Der Speicher versucht es dann
   * erneut — bis der Entwurf passt oder nichts mehr frei wird. Der Entwurf hat
   * Vorrang vor dem Ring.
   */
  platzSchaffen?: () => boolean;
  /**
   * Nach einer Folge von `platzSchaffen`-Aufrufen: `true`, der Entwurf passt
   * jetzt (das Freigegebene bleibt frei); `false`, er passt auch ohne alles,
   * was frei zu machen war — der Aufrufer gibt es zurück.
   */
  platzErgebnis?: (entwurfPasst: boolean) => void;
}

export type SchreibErgebnis =
  /** Entwurf und Begleitzettel geschrieben. */
  | 'ok'
  /**
   * Der ENTWURF ist geschrieben, nur der Begleitzettel (Uhr, Instanz,
   * Stempel) nicht — die Quote reichte für den Entwurf, aber nicht mehr für
   * die paar Byte danach. Nichts ging verloren; „Speicher voll" wäre hier
   * eine falsche Diagnose. Ein alter Zettel wird dabei ENTFERNT: Er würde
   * sonst Zeit, Quelle und Instanz eines früheren Stands zum neuen Entwurf
   * behaupten (der Startdialog liest ihn). Kein Zettel ist die wahrere
   * Auskunft als ein falscher.
   */
  | 'ohne-zettel'
  /** Speicher voll oder nicht verfügbar — der Aufrufer muss es melden. */
  | 'voll'
  /** Ein fremder Stand stand im Weg; nichts geschrieben, `beiFremdem` lief. */
  | 'fremd';

export interface UebernahmeErgebnis {
  /** Es wurde ein Rückgängig-Schritt angelegt. */
  schritt: boolean;
  /** Anzahl der dabei entfallenen Wiederherstellen-Schritte. */
  verworfen: number;
}

/**
 * Warum ein Stand aus dem Verlauf (oder von der Anzeige) gefallen ist.
 * Grundlage der Frage „wandert er in den Ring der verdrängten Entwürfe?"
 * (`sollInRing`).
 */
export type AbgangsGrund =
  /** Eine eigene Änderung verwirft den Wiederherstellen-Ast (Standard-Undo). */
  | 'redo-eigene-aenderung'
  /** Import oder Laden ersetzt den Entwurf und verwirft den Wiederherstellen-Ast. */
  | 'redo-ersetzt'
  /** Eine Übernahme verwirft den Wiederherstellen-Ast. */
  | 'redo-uebernahme'
  /** Eine Übernahme ersetzt einen angezeigten fremden Stand, der in keinem Stapel liegt. */
  | 'uebernahme-ersetzt'
  /** Der Rückgängig-Stapel läuft über die Grenze. */
  | 'kappe-undo'
  /** Der Wiederherstellen-Stapel läuft über die Grenze. */
  | 'kappe-redo';

/**
 * Wird für jeden Stand gerufen, der den Verlauf verlässt, ohne dass ihn
 * jemand ausdrücklich verworfen hat. `bezug` ist der Stand, der bleibt (bei
 * einer Übernahme der übernommene, sonst der angezeigte) — enthält er den
 * verlassenden Stand schon, ist nichts verloren.
 */
export type AbgangHoerer<T> = (stand: T, grund: AbgangsGrund, bezug: T) => void;

/**
 * Die Regel des Rings: Was aus dem Verlauf fällt, ohne dass sein Inhalt
 * anderswo steht, wird gesichert — ausser dem, was Standard-Undo ohnehin
 * verwirft: EIGENE Stände, die eine eigene Änderung aus dem Wiederherstellen-
 * Ast wirft oder die 50er-Grenze vom alten Ende des Rückgängig-Stapels
 * schiebt. Fremde Stände sind nie verzichtbar; und wenn eine Übernahme, ein
 * Import oder das Laden einen Wiederherstellen-Ast verwirft, geht auch der
 * eigene mit in den Ring (das war keine Änderung, die der Nutzer als
 * Weiterarbeiten im Kopf hat).
 */
export function sollInRing(grund: AbgangsGrund, herkunft: 'fremd' | 'eigen', abgedeckt: boolean): boolean {
  if (abgedeckt) return false;
  switch (grund) {
    case 'redo-uebernahme':
    case 'redo-ersetzt':
    case 'uebernahme-ersetzt':
      return true;
    case 'redo-eigene-aenderung':
    case 'kappe-undo':
    case 'kappe-redo':
      return herkunft === 'fremd';
  }
}

/**
 * Warum eine Meldung des Schreibversuchs stehen bleiben muss (Rückgabe von
 * `speichereEntwurf`/`alles` im Editor):
 *  - 'ok': nichts gemeldet, der Aufrufer darf seine Erfolgsmeldung setzen;
 *  - 'fremd': ein anderer Tab hatte den Entwurf geändert und wurde übernommen;
 *  - 'voll': der Entwurf passt nicht in den Speicher (auch nicht mit leerem Ring);
 *  - 'knapp': der Entwurf ist gespeichert, aber nur, weil Ring-Einträge Platz gemacht haben.
 */
export type SpeicherGrund = 'ok' | 'fremd' | 'voll' | 'knapp';

/** Der Grund aus dem Ergebnis des Speichers und der Zahl der dabei geopferten Ring-Einträge. */
export function speicherGrund(ergebnis: SchreibErgebnis, geopfert: number): SpeicherGrund {
  if (ergebnis === 'fremd') return 'fremd';
  if (ergebnis === 'voll') return 'voll';
  return geopfert > 0 ? 'knapp' : 'ok';
}

/** Was der Aufrufer nach dem Schreiben eines Serverstands sagt. */
export type ServerstandFolge = 'geladen' | 'nicht-geladen' | 'stehen-lassen';

/**
 * „Serverstand geladen" nur, wenn nichts anderes zu melden ist. Nur bei einem
 * tatsächlich übernommenen fremden Stand ist der Serverstand NICHT geladen;
 * bei 'voll' und 'knapp' bleibt deren Meldung stehen (die richtige, und keine
 * falsche Behauptung über einen anderen Tab darüber).
 */
export function serverstandFolge(grund: SpeicherGrund): ServerstandFolge {
  if (grund === 'ok') return 'geladen';
  if (grund === 'fremd') return 'nicht-geladen';
  return 'stehen-lassen';
}

/**
 * Steht der Entwurf, den der Aufrufer eben schreiben wollte, jetzt im
 * Speicher? 'ok' und 'knapp' ja; bei 'fremd' hat ein anderer Tab ihn ersetzt
 * (nichts geschrieben), bei 'voll' passte er nicht. Nur dann darf der Editor
 * die Basis des Begleitzettels weiterschieben: Sie beschreibt den Entwurf im
 * Speicher, nicht den im Arbeitsspeicher des Editors.
 */
export function entwurfImSpeicher(grund: SpeicherGrund): boolean {
  return grund === 'ok' || grund === 'knapp';
}

/**
 * Rückgängig-/Wiederherstellen-Stapel des Editors — samt der Regel, wann eine
 * Übernahme fremder Entwürfe einen Schritt anlegt.
 *
 * Übernahmen sind EINE Schrittklasse: Die erste nach einer eigenen Änderung
 * legt den eigenen Stand auf den Stapel; jede weitere, solange seither nichts
 * anderes geschehen ist, legt nichts mehr an. Sonst belegte jeder fremde
 * Schreibvorgang einen der 50 Plätze (der Testflug schreibt bei jedem
 * gesetzten Objekt), und nach 51 wäre der eigene Stand aus dem Stapel
 * gefallen, während die Meldung weiter behauptet, er liege unter „Rückgängig".
 *
 * Die Entscheidung hängt an einem ausdrücklichen Zustand, nicht an der
 * Identität eines Layout-Objekts: `uebernahmeOben` heisst „oben auf dem
 * Stapel liegt der Stand vor einer Übernahme, und seitdem gab es nur
 * Übernahmen". JEDE andere Zustandsänderung setzt es zurück — eigene Änderung
 * und Import (`merke`), Rückgängig (`zurueck`), Wiederherstellen (`vor`) und
 * das Ersetzen ohne Schritt (`ohneSchritt`: Laden vom Server, Start). Eine
 * Identitätsprüfung verwechselte „derselbe Stand" mit „derselbe Schritt": ein
 * Strg+Z auf den Übernahmestand legte dasselbe Objekt später wieder oben ab.
 * Im Zweifel legt die Übernahme einen Schritt zu viel an, nie einen zu wenig.
 *
 * Der Wiederherstellen-Stapel gehört zum verdrängten Stand: Eine Übernahme
 * verwirft ihn (wie eine eigene Änderung). Bliebe er stehen, könnte ein
 * späteres Strg+Y einen eigenen, ÄLTEREN Stand sofort in den gemeinsamen
 * Entwurf schreiben und die fremde Arbeit dort verdrängen — bei einem
 * Schreiber ohne Zuhörer (dem Testflug) unwiederbringlich. Wie viele
 * Wiederherstellen-Schritte dabei entfallen, meldet `uebernahme`, damit der
 * Editor es dem Nutzer sagen kann. Der EIGENE Stand vor der Übernahme bleibt
 * per Strg+Z erreichbar, und Strg+Z bringt danach den fremden Stand per
 * Strg+Y zurück.
 *
 * Kein Stand geht still verloren — bis zur Ring-Grenze von 5 Einträgen;
 * darüber wird der älteste mit Meldung verworfen. Jeder Stand, der den
 * Verlauf verlässt (Wiederherstellen-Ast verworfen, Grenze überschritten,
 * angezeigter fremder Stand durch die nächste Übernahme ersetzt), wird dem
 * `AbgangHoerer` gemeldet; der Editor sichert ihn nach `sollInRing` im Ring
 * der verdrängten Entwürfe (`VerdraengtRing`), aus dem der Nutzer ihn wieder
 * einsetzen kann.
 *
 * DOM-frei und ohne Wissen vom Editor: `aktuell` ist immer der gerade
 * angezeigte Stand, den der Aufrufer danach ersetzt.
 */
export class SchrittVerlauf<T> {
  readonly vergangenheit: T[] = [];
  readonly zukunft: T[] = [];
  private uebernahmeOben = false;

  constructor(
    private readonly grenze = 50,
    private readonly hoerer?: AbgangHoerer<T>
  ) {}

  private ablegen(stand: T, bezug: T): void {
    this.vergangenheit.push(stand);
    if (this.vergangenheit.length > this.grenze) {
      const weg = this.vergangenheit.shift() as T;
      this.hoerer?.(weg, 'kappe-undo', bezug);
    }
  }

  private redoLeeren(grund: AbgangsGrund, bezug: T): number {
    const weg = this.zukunft.splice(0);
    for (const s of weg) this.hoerer?.(s, grund, bezug);
    return weg.length;
  }

  /**
   * Eigene Änderung (oder Import/Laden, `ersetzt`) steht bevor: den jetzigen
   * Stand ablegen. `ersetzt`: der Entwurf wird durch einen ANDEREN ersetzt
   * (Import, Serverstand) und nicht weitergebaut — dann sichert auch der
   * verworfene eigene Wiederherstellen-Ast.
   */
  merke(aktuell: T, ersetzt = false): void {
    this.redoLeeren(ersetzt ? 'redo-ersetzt' : 'redo-eigene-aenderung', aktuell);
    this.ablegen(aktuell, aktuell);
    this.uebernahmeOben = false;
  }

  /**
   * Ein fremder Entwurf (`ersatz`) ersetzt den angezeigten. `schritt`: dabei
   * wurde ein Schritt angelegt (`aktuell` liegt jetzt oben). `verworfen`: so
   * viele Wiederherstellen-Schritte sind entfallen. Liegt `aktuell` in keinem
   * Stapel (mehrere Übernahmen in Folge), fällt auch er von der Anzeige.
   */
  uebernahme(aktuell: T, ersatz?: T): UebernahmeErgebnis {
    const bezug = ersatz ?? aktuell;
    const verworfen = this.redoLeeren('redo-uebernahme', bezug);
    if (this.uebernahmeOben) {
      this.hoerer?.(aktuell, 'uebernahme-ersetzt', bezug);
      return { schritt: false, verworfen };
    }
    this.ablegen(aktuell, bezug);
    this.uebernahmeOben = true;
    return { schritt: true, verworfen };
  }

  /** Strg+Z: der vorige Stand, oder `undefined`, wenn keiner da ist. */
  zurueck(aktuell: T): T | undefined {
    if (this.vergangenheit.length === 0) return undefined;
    const vorher = this.vergangenheit.pop() as T;
    this.zukunft.push(aktuell);
    // Dieselbe Grenze wie beim Rückgängig-Stapel; die ältesten Wiederherstellen-Stände fallen zuerst.
    if (this.zukunft.length > this.grenze) {
      const weg = this.zukunft.shift() as T;
      this.hoerer?.(weg, 'kappe-redo', vorher);
    }
    this.uebernahmeOben = false;
    return vorher;
  }

  /** Strg+Y: der nächste Stand, oder `undefined`. */
  vor(aktuell: T): T | undefined {
    if (this.zukunft.length === 0) return undefined;
    const wieder = this.zukunft.pop() as T;
    this.ablegen(aktuell, wieder);
    this.uebernahmeOben = false;
    return wieder;
  }

  /**
   * Beide Stapel vergessen: Nach dem Zurücksetzen der Welt (K4.0) gibt es keinen früheren Stand, zu dem man zurück
   * könnte — ein Strg+Z auf den alten Entwurf ließe das nächste Speichern das Zurücksetzen überschreiben. Ohne
   * Meldung an den `AbgangHoerer`: Der Aufrufer verwirft hier ausdrücklich, nichts fällt heraus.
   */
  leeren(): void {
    this.vergangenheit.splice(0);
    this.zukunft.splice(0);
    this.uebernahmeOben = false;
  }

  /** Der Stand wurde OHNE Schritt ersetzt (Laden vom Server): die Regel neu beginnen. */
  ohneSchritt(): void {
    this.uebernahmeOben = false;
  }

  /** Liegt ein Stand, auf den `passt` zutrifft, in einem der beiden Stapel? */
  enthaelt(passt: (stand: T) => boolean): boolean {
    return this.vergangenheit.some(passt) || this.zukunft.some(passt);
  }
}

// ── Ring der verdrängten Entwürfe ────────────────────────────────────
/**
 * Jeder Eintrag ist ein EIGENER localStorage-Schlüssel
 * `wov-editor-verdraengt:<tabId>:<zeit>:<zähler>`; die Liste entsteht durch
 * Durchsuchen der Schlüssel mit diesem Präfix. So gibt es kein
 * Lesen-Ändern-Schreiben auf einem Sammelschlüssel mehr, bei dem zwei Tabs,
 * die gleichzeitig sichern, einander einen Eintrag wegschreiben; und die
 * Kennung enthält die Tab-Kennung, damit „entfernen" nur den einen Eintrag
 * trifft.
 */
export const VERDRAENGT_PRAEFIX = 'wov-editor-verdraengt:';

export interface VerdraengtEintrag {
  /** `<tabId>:<zeit>:<zähler>` — der Schlüssel ist `VERDRAENGT_PRAEFIX + id`. */
  id: string;
  /** ms seit 1970, wann der Stand verdrängt wurde. */
  zeit: number;
  herkunft: 'fremd' | 'eigen';
  /** Kennung des Tabs, der den Stand geschrieben hat, wenn bekannt. */
  tabId: string | null;
  grund: string;
  regionen: number;
  platzierungen: number;
  /** Zeichen des Eintrags im Speicher (Schlüssel + Wert). */
  groesse: number;
  layout: WorldLayout;
}

export type RingErgebnis =
  /** Gesichert. */
  | 'ok'
  /** Ein gesicherter Eintrag enthält den Stand schon. */
  | 'schon-da'
  /** Konnte nicht gesichert werden (zu gross oder Speicher voll) — der Aufrufer muss es melden. */
  | 'voll';

/**
 * Die letzten verdrängten Entwürfe: höchstens `max` (5) Einträge und
 * `maxBytes` (1.000.000) Zeichen zusammen; darüber fällt der älteste heraus,
 * und `verworfen` zählt es, damit der Editor es sagen kann. Kein Stand geht
 * still verloren — bis zur Ring-Grenze von 5 Einträgen; darüber wird der
 * älteste mit Meldung verworfen. Quotenfehler werden toleriert (`'voll'`),
 * damit der Editor nie an der Sicherung scheitert; umgekehrt macht der Ring
 * Platz, wenn der ENTWURF nicht mehr passt (`aeltestenEntfernen`): Der
 * Entwurf hat Vorrang.
 */
export class VerdraengtRing {
  private readonly max: number;
  private readonly maxBytes: number;
  private readonly jetzt: () => number;
  private readonly tabId: string;
  private zaehler = 0;
  /** Wie viele Einträge diese Ring-Instanz wegen der Grenzen (Anzahl/Größe) verworfen hat. */
  verworfen = 0;
  /** Was der Entwurfs-Vorrang dem Ring vorläufig genommen hat: wird zurückgegeben, wenn der Entwurf trotzdem nicht passt. */
  private opferLog: { schluessel: string; roh: string }[] = [];
  /** Zerlegte Einträge je Schlüssel: bei jedem Sektionsaufbau nur neu lesen, was sich geändert hat. */
  private readonly cache = new Map<string, { roh: string; eintrag: VerdraengtEintrag | null }>();

  constructor(
    private readonly speicher: RingSpeicher,
    opt: { max?: number; maxBytes?: number; jetzt?: () => number; tabId?: string } = {}
  ) {
    this.max = opt.max ?? 5;
    this.maxBytes = opt.maxBytes ?? 1_000_000;
    this.jetzt = opt.jetzt ?? Date.now;
    this.tabId = opt.tabId ?? neueTabId();
  }

  private schluessel(): string[] {
    const aus: string[] = [];
    try {
      for (let i = 0; i < this.speicher.length; i++) {
        const k = this.speicher.key(i);
        if (k !== null && k.startsWith(VERDRAENGT_PRAEFIX)) aus.push(k);
      }
    } catch {
      return [];
    }
    return aus;
  }

  /** Die Einträge, älteste zuerst. Unlesbares wird übersprungen. */
  liste(): VerdraengtEintrag[] {
    const aus: VerdraengtEintrag[] = [];
    const lebende = new Set<string>();
    for (const k of this.schluessel()) {
      let roh: string | null;
      try {
        roh = this.speicher.getItem(k);
      } catch {
        continue;
      }
      if (roh === null) continue;
      lebende.add(k);
      let z = this.cache.get(k);
      if (!z || z.roh !== roh) {
        z = { roh, eintrag: this.zerlegen(k, roh) };
        this.cache.set(k, z);
      }
      if (z.eintrag) aus.push(z.eintrag);
    }
    for (const k of [...this.cache.keys()]) if (!lebende.has(k)) this.cache.delete(k);
    aus.sort((a, b) => a.zeit - b.zeit || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return aus;
  }

  private zerlegen(k: string, roh: string): VerdraengtEintrag | null {
    try {
      const e = JSON.parse(roh) as Partial<VerdraengtEintrag>;
      const layout = sanitizeWorldLayout(e?.layout);
      if (!layout || typeof e.zeit !== 'number') return null;
      return {
        id: k.slice(VERDRAENGT_PRAEFIX.length),
        zeit: e.zeit,
        herkunft: e.herkunft === 'fremd' ? 'fremd' : 'eigen',
        tabId: typeof e.tabId === 'string' ? e.tabId : null,
        grund: typeof e.grund === 'string' ? e.grund : '',
        regionen: layout.regions.length,
        platzierungen: layout.placements?.length ?? 0,
        groesse: k.length + roh.length,
        layout,
      };
    } catch {
      return null;
    }
  }

  private entfernenSchluessel(k: string): void {
    try {
      this.speicher.removeItem(k);
    } catch {
      // Ein Eintrag, der sich nicht entfernen lässt, ist harmlos.
    }
    this.cache.delete(k);
  }

  ablegen(layout: WorldLayout, herkunft: 'fremd' | 'eigen', grund: string, tabId: string | null = null): RingErgebnis {
    const liste = this.liste();
    if (liste.some((e) => enthaelt(e.layout, layout))) return 'schon-da';
    const zeit = this.jetzt();
    const id = `${this.tabId}:${zeit.toString(36)}:${(this.zaehler++).toString(36)}`;
    const k = VERDRAENGT_PRAEFIX + id;
    const text = JSON.stringify({
      zeit,
      herkunft,
      tabId,
      grund,
      layout,
    });
    if (k.length + text.length > this.maxBytes) return 'voll'; // der Stand allein sprengt die Grenze
    // Ein setItem auf einen NEUEN Schlüssel: kein Lesen-Ändern-Schreiben. Passt es
    // nicht (Quote), wird der älteste Eintrag geopfert und noch einmal versucht.
    const alle = [...liste];
    const weg: { schluessel: string; roh: string }[] = [];
    for (;;) {
      try {
        this.speicher.setItem(k, text);
        break;
      } catch {
        const alt = alle.shift();
        if (!alt) {
          // Auch ohne die älteren Einträge passt der neue nicht: sie nicht umsonst opfern.
          this.zurueckschreiben(weg);
          this.verworfen -= weg.length;
          return 'voll';
        }
        const sk = VERDRAENGT_PRAEFIX + alt.id;
        const roh = this.speicher.getItem(sk);
        if (roh !== null) weg.push({ schluessel: sk, roh });
        this.entfernenSchluessel(sk);
        this.verworfen++;
      }
    }
    // Grenzen: höchstens `max` Einträge und `maxBytes` Zeichen; der älteste fällt zuerst.
    let summe = k.length + text.length + alle.reduce((n, e) => n + e.groesse, 0);
    let anzahl = alle.length + 1;
    while (alle.length > 0 && (anzahl > this.max || summe > this.maxBytes)) {
      const alt = alle.shift()!;
      this.entfernenSchluessel(VERDRAENGT_PRAEFIX + alt.id);
      this.verworfen++;
      summe -= alt.groesse;
      anzahl--;
    }
    return 'ok';
  }

  /** Genau einen Eintrag entfernen (der Nutzer hat ihn verworfen). Die Kennung enthält die Tab-Kennung: kein anderer Tab wird getroffen. */
  entfernen(id: string): void {
    this.entfernenSchluessel(VERDRAENGT_PRAEFIX + id);
  }

  private zurueckschreiben(weg: { schluessel: string; roh: string }[]): void {
    for (const e of weg) {
      try {
        this.speicher.setItem(e.schluessel, e.roh);
      } catch {
        // Was sich nicht zurückschreiben lässt, war schon vorher verloren.
      }
    }
  }

  /**
   * Den ältesten Eintrag entfernen, um Platz zu schaffen (der Entwurf hat
   * Vorrang vor dem Ring). `false`, wenn nichts mehr zu entfernen ist. Das
   * Entfernte wird VORLÄUFIG gemerkt: `opferAbschliessen` entscheidet, ob es
   * weg bleibt (der Entwurf passt jetzt) oder zurückgegeben wird (er passt
   * auch ohne Ring nicht, dann wäre das Opfer umsonst).
   */
  aeltestenEntfernen(): boolean {
    const alt = this.liste()[0];
    if (!alt) return false;
    const sk = VERDRAENGT_PRAEFIX + alt.id;
    const roh = this.speicher.getItem(sk);
    if (roh !== null) this.opferLog.push({ schluessel: sk, roh });
    this.entfernenSchluessel(sk);
    return true;
  }

  /** Schließt eine Folge von `aeltestenEntfernen` ab: `behalten` — Entfernte bleiben weg (Anzahl als Ergebnis); sonst werden sie zurückgeschrieben (Ergebnis 0). */
  opferAbschliessen(behalten: boolean): number {
    const log = this.opferLog;
    this.opferLog = [];
    if (behalten) return log.length;
    this.zurueckschreiben(log);
    return 0;
  }
}

/** Der Sammelschlüssel der Vorgängerfassung des Rings (ohne Doppelpunkt): Er wird nicht mehr gelesen. */
export const ALTER_RING_SCHLUESSEL = 'wov-editor-verdraengt';

/**
 * Entfernt beim Start einen vorhandenen alten Sammelschlüssel: Er würde sonst
 * als unsichtbarer Ballast in der Quote liegen bleiben (bis zu 2.000.000
 * Zeichen). `true`, wenn er da war. Die Einträge im neuen Schema (mit
 * Doppelpunkt) bleiben unberührt.
 */
export function alterRingSchluesselEntfernen(speicher: RingSpeicher): boolean {
  try {
    if (speicher.getItem(ALTER_RING_SCHLUESSEL) === null) return false;
    speicher.removeItem(ALTER_RING_SCHLUESSEL);
    return true;
  } catch {
    return false;
  }
}

/** Eine neue Kennung für einen Editor-Tab (Speicher und Ring tragen dieselbe). */
export function neueTabId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class EntwurfsSpeicher {
  readonly tabId: string;
  /** Rohtext unter `ENTWURF_KEY`, wie dieser Tab ihn zuletzt gesehen oder geschrieben hat. */
  private bekannt: string | null = null;
  private readonly speicher: KvSpeicher;
  private readonly ereignisse: EreignisQuelle | null;
  private readonly kanal: Kanal | null;
  private readonly jetzt: () => number;
  private readonly aktuell: () => WorldLayout;
  private readonly beiFremdem: (fremd: WorldLayout, info: FremdInfo) => void;
  private readonly beiVerdraengt: ((alt: WorldLayout, neu: WorldLayout) => void) | null;
  private readonly platzSchaffen: (() => boolean) | null;
  private readonly platzErgebnis: ((entwurfPasst: boolean) => void) | null;
  /** Der Rohtext in `bekannt` stammt von einem anderen Tab und ist seither nicht überschrieben worden. */
  private bekanntFremd = false;
  /** Basis des Entwurfs (Hash), wie dieser Tab sie zuletzt gesetzt hat, s. `basisMerken`. */
  private basis: string | null = null;
  private readonly beiStorage = (e: { key: string | null }): void => {
    // `key === null`: der Speicher wurde geleert.
    if (e.key === null || e.key === ENTWURF_KEY) this.pruefe('ereignis', this.aktuell());
  };

  constructor(opt: EntwurfsSpeicherOptionen) {
    this.speicher = opt.speicher;
    this.ereignisse = opt.ereignisse ?? null;
    this.kanal = opt.kanal ?? null;
    this.tabId = opt.tabId ?? neueTabId();
    this.jetzt = opt.jetzt ?? Date.now;
    this.aktuell = opt.aktuell;
    this.beiFremdem = opt.beiFremdem;
    this.beiVerdraengt = opt.beiVerdraengt ?? null;
    this.platzSchaffen = opt.platzSchaffen ?? null;
    this.platzErgebnis = opt.platzErgebnis ?? null;
    this.ereignisse?.addEventListener('storage', this.beiStorage);
    if (this.kanal) {
      this.kanal.onmessage = (e) => {
        const d = e.data as { tabId?: unknown } | null;
        // Eigene Nachrichten kommen nie zurück; die Prüfung wäre ohnehin
        // wirkungslos (bekannt == Speicher), aber sie kostet einen Lesezugriff.
        if (d && typeof d === 'object' && d.tabId !== this.tabId) this.pruefe('kanal', this.aktuell());
      };
    }
  }

  /** Klinkt Ereignis und Kanal aus. */
  schliessen(): void {
    this.ereignisse?.removeEventListener('storage', this.beiStorage);
    if (this.kanal) {
      this.kanal.onmessage = null;
      this.kanal.close();
    }
  }

  /**
   * Der Entwurf beruht ab jetzt auf diesem Serverstand (`null` = auf keinem
   * bekannten): Er kommt in den Begleitzettel, damit der Testflug ihn als
   * Basis benutzen kann. NICHT aufrufen, wenn der Editor einen Serverstand
   * bloss geholt hat — nur, wenn Serverinhalt in den Entwurf geschrieben
   * wurde, ein Speichern gelang oder der Nutzer „Entwurf behalten" gewählt
   * hat (s. `Begleitzettel`). Ohne vorhandenen Zettel wird keiner erfunden;
   * der nächste `schreiben` legt ihn mit dieser Basis an. `true`, wenn ein
   * Zettel aktualisiert wurde.
   */
  basisMerken(hash: string | null): boolean {
    this.basis = hash;
    try {
      const neu = zettelMitBasis(this.speicher.getItem(STAND_KEY), hash);
      if (neu === null) return false;
      this.speicher.setItem(STAND_KEY, neu);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Die Basis des Entwurfs: die im Begleitzettel (sie gehört zum Entwurf im
   * Speicher, und der Testflug schiebt sie nach einem eigenen Speichern
   * weiter), sonst die zuletzt gemerkte. `null`, wenn keine bekannt ist —
   * dann darf niemand auf den Server schreiben.
   */
  basisLesen(): string | null {
    let roh: string | null = null;
    try {
      roh = this.speicher.getItem(STAND_KEY);
    } catch {
      /* nicht lesbar: dann gilt die gemerkte Basis */
    }
    return zettelBasisLesen(roh) ?? this.basis;
  }

  private rohLesen(): string | null | undefined {
    try {
      return this.speicher.getItem(ENTWURF_KEY);
    } catch {
      return undefined; // Speicher nicht lesbar: nichts behaupten
    }
  }

  private stempelLesen(): { tabId: string | null; geaendertUm: number | null } {
    try {
      const roh = this.speicher.getItem(STAND_KEY);
      if (!roh) return { tabId: null, geaendertUm: null };
      const d = JSON.parse(roh) as Partial<EntwurfsStand>;
      // Trägt der Zettel UNSERE Kennung, der Entwurf aber ist ein anderer,
      // dann hat ein Schreiber OHNE Stempel (Testflug) geschrieben: der
      // Zettel ist für diesen Inhalt nicht zuständig.
      if (typeof d.tabId !== 'string' || d.tabId === this.tabId) return { tabId: null, geaendertUm: null };
      return { tabId: d.tabId, geaendertUm: typeof d.geaendertUm === 'number' ? d.geaendertUm : null };
    } catch {
      return { tabId: null, geaendertUm: null };
    }
  }

  /**
   * Die eine Prüfung hinter allen Wegen. Liefert `true`, wenn ein fremder
   * Stand übernommen wurde (`beiFremdem` lief). Idempotent: Was einmal
   * gesehen ist, ist `bekannt`.
   */
  private pruefe(wie: FremdWeg, aktuell: WorldLayout): boolean {
    return this.pruefeRoh(wie, aktuell, this.rohLesen());
  }

  /** `pruefe` mit einem bereits gelesenen Rohtext — damit Lesen und Entscheiden EIN Zugriff sind. */
  private pruefeRoh(wie: FremdWeg, aktuell: WorldLayout, roh: string | null | undefined): boolean {
    // Nicht lesbar oder gelöscht: nichts Fremdes zu übernehmen. Ein
    // späteres Schreiben legt den Entwurf neu an.
    if (roh === undefined || roh === null || roh === this.bekannt) return false;
    this.bekannt = roh;
    let fremd: WorldLayout | null;
    try {
      fremd = sanitizeWorldLayout(JSON.parse(roh));
    } catch {
      fremd = null;
    }
    // Unbrauchbarer Inhalt ist keine Arbeit, die man schützen müsste.
    if (!fremd) return false;
    // Dasselbe Dokument in anderer Schreibweise (z. B. der Testflug hat
    // nur neu formatiert): nichts zu übernehmen.
    if (gleich(fremd, aktuell)) return false;
    this.bekanntFremd = true;
    this.beiFremdem(fremd, { wie, ...this.stempelLesen() });
    return true;
  }

  /**
   * Nachsehen, ob ein anderer Tab seit dem letzten Lesen/Schreiben etwas
   * geändert hat, und es gegebenenfalls übernehmen (`beiFremdem`). Für die
   * Stellen, die den Speicher neu lesen wollen und sich nicht darauf
   * verlassen dürfen, dass ein Ereignis schon angekommen ist.
   */
  abgleichen(): boolean {
    return this.pruefe('abgleich', this.aktuell());
  }

  private parsen(roh: string | null | undefined): WorldLayout | null {
    if (!roh) return null;
    try {
      return sanitizeWorldLayout(JSON.parse(roh));
    } catch {
      return null;
    }
  }

  /**
   * Entwurf beim START lesen — `null`, wenn keiner da ist. Merkt sich den
   * Rohtext als `bekannt`, ohne etwas zu übernehmen: Das ist nur richtig,
   * solange der Aufrufer genau diesen Stand zu seinem angezeigten macht (der
   * Editor beim Laden). Wer später neu lesen will, nimmt
   * `entwurfNachAbgleich`.
   */
  lesen(): WorldLayout | null {
    const roh = this.rohLesen();
    this.bekannt = roh ?? null;
    this.bekanntFremd = false;
    return this.parsen(roh);
  }

  /**
   * Den Entwurf für einen Vergleich lesen — mit EINEM Zugriff auf den
   * Speicher: Steht dort etwas anderes als das, was dieser Tab kennt und
   * anzeigt, wird es übernommen (`beiFremdem`), und zurück kommt genau
   * dieser gelesene Stand. So kann zwischen „nachsehen" und „lesen" kein
   * fremder Schreibvorgang mehr fallen, der danach für `bekannt` gilt, aber
   * nie übernommen wurde.
   */
  entwurfNachAbgleich(): WorldLayout | null {
    const roh = this.rohLesen();
    this.pruefeRoh('abgleich', this.aktuell(), roh);
    return this.parsen(roh);
  }

  /**
   * Entwurf samt Begleitzettel schreiben — nie über einen ungesehenen
   * fremden Stand hinweg. Bei 'fremd' ist NICHTS geschrieben worden; der
   * Aufrufer hat über `beiFremdem` den fremden Stand bekommen.
   */
  schreiben(layout: WorldLayout, quelle: EntwurfsQuelle, instanz: string | null): SchreibErgebnis {
    if (this.pruefe('schreiben', layout)) return 'fremd';
    const roh = JSON.stringify(layout);
    const zeit = this.jetzt();
    const altRoh = this.bekannt;
    const altWarFremd = this.bekanntFremd;
    let platzGeschaffen = false;
    for (;;) {
      try {
        this.speicher.setItem(ENTWURF_KEY, roh);
        break;
      } catch {
        // Passt der Entwurf nicht, gibt der Ring Platz frei — Eintrag für Eintrag, bis er passt.
        if (!this.platzSchaffen?.()) {
          // Auch mit leerem Ring passt er nicht: NICHTS geschrieben, und der Ring bekommt zurück, was er umsonst hergab.
          if (platzGeschaffen) this.platzErgebnis?.(false);
          return 'voll';
        }
        platzGeschaffen = true;
      }
    }
    if (platzGeschaffen) this.platzErgebnis?.(true);
    // Ab hier steht der Entwurf im Speicher, was danach auch schiefgeht.
    this.bekannt = roh;
    this.bekanntFremd = false;
    // Sicherheitsnetz: Ein fremder Stand, den dieser Schreibvorgang ersetzt,
    // ohne dass der neue ihn enthält, wird dem Aufrufer gemeldet.
    if (altWarFremd && this.beiVerdraengt) {
      const alt = this.parsen(altRoh);
      if (alt && !enthaelt(layout, alt)) this.beiVerdraengt(alt, layout);
    }
    // Der Zettel NACH dem Entwurf: Reisst die Quote, fehlt lieber der
    // Zettel als der Entwurf — und der Entwurf wird deswegen nicht als
    // „nicht gespeichert" gemeldet.
    // Die Basis des Zettels bleibt, wie sie ist: Hat der Testflug sie nach
    // einem eigenen Speichern weitergeschoben, darf ein Editor-Schreibvorgang
    // sie nicht mit dem älteren Wert dieses Tabs überschreiben. Ohne Zettel
    // gilt, was dieser Tab zuletzt gemerkt hat.
    let alterZettel: string | null = null;
    try {
      alterZettel = this.speicher.getItem(STAND_KEY);
    } catch {
      /* nicht lesbar: dann gilt die gemerkte Basis */
    }
    const basis = zettelBasisLesen(alterZettel) ?? this.basis;
    const zettel = JSON.stringify({
      zeit: new Date(zeit).toISOString(),
      instanz,
      quelle,
      geaendertUm: zeit,
      tabId: this.tabId,
      ...(basis ? { basis } : {}),
    } satisfies Begleitzettel);
    let ergebnis: SchreibErgebnis = 'ok';
    try {
      this.speicher.setItem(STAND_KEY, zettel);
    } catch {
      // Den alten Zettel entfernen (schafft nebenbei Platz) und noch einmal
      // versuchen; gelingt auch das nicht, bleibt der Entwurf ohne Zettel.
      ergebnis = 'ohne-zettel';
      try {
        this.speicher.removeItem?.(STAND_KEY);
        this.speicher.setItem(STAND_KEY, zettel);
        ergebnis = 'ok';
      } catch {
        // Zettel bleibt weg (oder, ohne removeItem, veraltet).
      }
    }
    try {
      this.kanal?.postMessage({ typ: 'entwurf', tabId: this.tabId, geaendertUm: zeit });
    } catch {
      // Ein geschlossener Kanal ist kein Grund, den Speichervorgang zu melden.
    }
    return ergebnis;
  }
}

/**
 * Speicher, Ereignisquelle und Kanal des Browsers. Wo etwas fehlt
 * (privater Modus, Worker), kommt eine Attrappe bzw. `null` — der Editor
 * arbeitet dann wie vorher, nur ohne Schutz.
 */
export function browserUmgebung(): {
  speicher: RingSpeicher;
  ereignisse: EreignisQuelle | null;
  kanal: Kanal | null;
} {
  const g = globalThis as {
    localStorage?: RingSpeicher;
    addEventListener?: unknown;
    BroadcastChannel?: new (name: string) => Kanal;
  };
  let speicher: RingSpeicher;
  try {
    if (!g.localStorage) throw new Error('kein localStorage');
    speicher = g.localStorage;
  } catch {
    // Zugriff auf `localStorage` kann selbst werfen (blockierte Website-Daten).
    speicher = {
      length: 0,
      key: () => null,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('localStorage nicht verfügbar');
      },
    };
  }
  let kanal: Kanal | null = null;
  try {
    kanal = g.BroadcastChannel ? new g.BroadcastChannel(ENTWURF_KANAL) : null;
  } catch {
    kanal = null;
  }
  return {
    speicher,
    ereignisse: typeof g.addEventListener === 'function' ? (g as unknown as EreignisQuelle) : null,
    kanal,
  };
}
