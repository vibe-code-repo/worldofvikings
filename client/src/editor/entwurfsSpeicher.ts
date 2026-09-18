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
 *     unterwegs). Er kostet ein `getItem` je Schreibvorgang.
 * Jede Prüfung liest den Speicher NEU, statt dem Ereignis zu glauben.
 * Damit ist die Reihenfolge der Ereignisse gleichgültig.
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
import { ENTWURF_KEY, STAND_KEY, gleich, type EntwurfsQuelle, type EntwurfsStand } from './weltdokument';

/** Name des BroadcastChannel — eigener Name, damit kein anderer Kanal mithört. */
export const ENTWURF_KANAL = 'wov-editor-entwurf';

/** Der Teil von `Storage`, den der Speicher braucht. */
export interface KvSpeicher {
  getItem(schluessel: string): string | null;
  setItem(schluessel: string, wert: string): void;
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
}

export type SchreibErgebnis =
  /** Geschrieben. */
  | 'ok'
  /** Speicher voll oder nicht verfügbar — der Aufrufer muss es melden. */
  | 'voll'
  /** Ein fremder Stand stand im Weg; nichts geschrieben, `beiFremdem` lief. */
  | 'fremd';

function zufallsId(): string {
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
  private readonly beiStorage = (e: { key: string | null }): void => {
    // `key === null`: der Speicher wurde geleert.
    if (e.key === null || e.key === ENTWURF_KEY) this.pruefe('ereignis', this.aktuell());
  };

  constructor(opt: EntwurfsSpeicherOptionen) {
    this.speicher = opt.speicher;
    this.ereignisse = opt.ereignisse ?? null;
    this.kanal = opt.kanal ?? null;
    this.tabId = opt.tabId ?? zufallsId();
    this.jetzt = opt.jetzt ?? Date.now;
    this.aktuell = opt.aktuell;
    this.beiFremdem = opt.beiFremdem;
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
    const roh = this.rohLesen();
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

  /** Entwurf lesen — `null`, wenn keiner da ist. Merkt sich den Rohtext als `bekannt`. */
  lesen(): WorldLayout | null {
    const roh = this.rohLesen();
    this.bekannt = roh ?? null;
    if (!roh) return null;
    try {
      return sanitizeWorldLayout(JSON.parse(roh));
    } catch {
      return null;
    }
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
    try {
      this.speicher.setItem(ENTWURF_KEY, roh);
      this.bekannt = roh;
      // Der Zettel NACH dem Entwurf: Reisst die Quote, fehlt lieber der
      // Zettel als der Entwurf.
      this.speicher.setItem(
        STAND_KEY,
        JSON.stringify({
          zeit: new Date(zeit).toISOString(),
          instanz,
          quelle,
          geaendertUm: zeit,
          tabId: this.tabId,
        } satisfies EntwurfsStand)
      );
    } catch {
      return 'voll';
    }
    try {
      this.kanal?.postMessage({ typ: 'entwurf', tabId: this.tabId, geaendertUm: zeit });
    } catch {
      // Ein geschlossener Kanal ist kein Grund, den Speichervorgang zu melden.
    }
    return 'ok';
  }
}

/**
 * Speicher, Ereignisquelle und Kanal des Browsers. Wo etwas fehlt
 * (privater Modus, Worker), kommt eine Attrappe bzw. `null` — der Editor
 * arbeitet dann wie vorher, nur ohne Schutz.
 */
export function browserUmgebung(): {
  speicher: KvSpeicher;
  ereignisse: EreignisQuelle | null;
  kanal: Kanal | null;
} {
  const g = globalThis as {
    localStorage?: KvSpeicher;
    addEventListener?: unknown;
    BroadcastChannel?: new (name: string) => Kanal;
  };
  let speicher: KvSpeicher;
  try {
    if (!g.localStorage) throw new Error('kein localStorage');
    speicher = g.localStorage;
  } catch {
    // Zugriff auf `localStorage` kann selbst werfen (blockierte Website-Daten).
    speicher = {
      getItem: () => null,
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
