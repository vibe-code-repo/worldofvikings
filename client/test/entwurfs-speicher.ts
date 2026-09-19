/**
 * Entwurfsspeicher (K0.3): zwei Tabs, ein localStorage-Schlüssel.
 *
 * Geprüft wird die Regel aus client/src/editor/entwurfsSpeicher.ts: Ein Tab
 * schreibt den Entwurf nie über einen fremden Stand, den er nicht gesehen
 * hat; der fremde Stand wird übernommen, der eigene liegt danach im
 * Rückgängig-Stapel. Ohne Browser: eine Attrappe für localStorage,
 * `storage`-Ereignisse und BroadcastChannel, gemeinsam für alle „Tabs" eines
 * „Profils". Die Attrappe kann Ereignisse zurückhalten (Tab im Hintergrund)
 * und einen Schreiber OHNE Stempel nachbilden (der Testflug, main.ts): Er
 * schreibt den Entwurf und, nach einem gelungenen Speichern in die Welt, das
 * eine Feld `basis` des Begleitzettels (LocalStoragePersistenz), sonst nichts.
 *
 * Zusätzlich Quelltextprüfungen an editorMain.ts für das, was sich ohne
 * Editorfenster nicht ausführen lässt (Platzieren-Zweig, Rückruf).
 *
 * Lauf:  npx tsx test/entwurfs-speicher.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import {
  EntwurfsSpeicher,
  SchrittVerlauf,
  VerdraengtRing,
  ALTER_RING_SCHLUESSEL,
  VERDRAENGT_PRAEFIX,
  alterRingSchluesselEntfernen,
  serverstandFolge,
  speicherGrund,
  zettelBasisLesen,
  zettelMitBasis,
  type SpeicherGrund,
  type RingSpeicher,
  sollInRing,
  type AbgangsGrund,
  type EreignisQuelle,
  type FremdInfo,
  type Kanal,
  type KvSpeicher,
} from '../src/editor/entwurfsSpeicher';
import * as speicherModul from '../src/editor/entwurfsSpeicher';
import {
  ENTWURF_KEY,
  STAND_KEY,
  entwurfLesen,
  entwurfStandLesen,
  brauchtSchrittVorErsetzen,
  enthaelt,
  layoutMitPlatzierung,
  leeresLayout,
} from '../src/editor/weltdokument';

// Optional access: a stand without the export fails by assertion, not by aborting the run.
const entwurfImSpeicher = (g: SpeicherGrund): boolean =>
  (speicherModul as { entwurfImSpeicher?: (x: SpeicherGrund) => boolean }).entwurfImSpeicher?.(g) ?? false;

const basisLesen = (sp: EntwurfsSpeicher): string | null | undefined => {
  const f = (sp as unknown as { basisLesen?: () => string | null }).basisLesen;
  return f ? f.call(sp) : undefined; // undefined: a stand without basisLesen fails by assertion
};

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../..');

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

// ── Attrappe: ein Browser-Profil mit mehreren Tabs ───────────────────
type Hoerer = (e: { key: string | null }) => void;

class Profil {
  readonly daten = new Map<string, string>();
  /** Zähler: wie oft wurde geschrieben (setItem), über alle Tabs. */
  schreibvorgaenge = 0;
  /** Ereignisquellen der Tabs (storage-Hörer). */
  private readonly hoerer: { tab: object; fn: Hoerer }[] = [];
  private readonly kanaele: KanalAttrappe[] = [];
  /** true: Ereignisse und Kanalnachrichten sammeln sich, bis `zustellen()`. */
  zurueckhalten = false;
  private wartend: (() => void)[] = [];
  /** Jedes setItem wirft einen Quotenfehler. */
  quotaFehler = false;
  /** Nur setItem auf diesen Schlüssel wirft einen Quotenfehler. */
  quotaSchluessel: string | null = null;
  /** setItem auf diesen Schlüssel wirft GENAU EINMAL einen Quotenfehler. */
  quotaEinmalFuer: string | null = null;
  /** getItem wirft (blockierte Website-Daten). */
  lesenKaputt = false;
  /** Hartes Quoten-Modell: Summe aller Schlüssel- und Wertlängen darf diese Zeichenzahl nicht übersteigen (Chromium: 5 MiB je Ursprung, 2 Byte je Zeichen = 2.621.440). */
  quotaZeichen: number | null = null;
  /** Zeichen, die im Speicher belegt sind (Schlüssel + Wert, alle Einträge). */
  belegt(): number {
    let n = 0;
    for (const [k, v] of this.daten) n += k.length + v.length;
    return n;
  }
  /** Eine Aktion, die vor dem nächsten getItem einmal läuft (für verschränkte Zugriffe zweier Tabs). */
  vorNaechstemLesen: (() => void) | null = null;
  /** Eine Aktion, die nach dem nächsten setItem einmal läuft. */
  nachNaechstemSchreiben: (() => void) | null = null;

  private zustellenOderMerken(f: () => void): void {
    if (this.zurueckhalten) this.wartend.push(f);
    else f();
  }
  zustellen(): void {
    const w = this.wartend;
    this.wartend = [];
    for (const f of w) f();
  }
  /** Zurückgehaltene Ereignisse gehen verloren (Seite im Vor-/Zurück-Zwischenspeicher). */
  verwerfen(): void {
    this.wartend = [];
  }
  removeItem(von: object | null, k: string): void {
    this.daten.delete(k);
    for (const h of this.hoerer) if (h.tab !== von) this.zustellenOderMerken(() => h.fn({ key: k }));
  }

  setItem(von: object | null, k: string, v: string): void {
    if (this.quotaFehler || this.quotaSchluessel === k) throw new Error('QuotaExceededError');
    if (this.quotaEinmalFuer === k) {
      this.quotaEinmalFuer = null;
      throw new Error('QuotaExceededError');
    }
    if (this.quotaZeichen !== null) {
      const alt = this.daten.get(k);
      const neu = this.belegt() - (alt === undefined ? 0 : k.length + alt.length) + k.length + v.length;
      if (neu > this.quotaZeichen) throw new Error('QuotaExceededError');
    }
    this.daten.set(k, v);
    this.schreibvorgaenge++;
    const danach = this.nachNaechstemSchreiben;
    this.nachNaechstemSchreiben = null;
    danach?.();
    // Wie im Browser: das Ereignis geht an alle ANDEREN Tabs, nie an den Schreiber.
    for (const h of this.hoerer) {
      if (h.tab !== von) this.zustellenOderMerken(() => h.fn({ key: k }));
    }
  }
  getItem(k: string): string | null {
    if (this.lesenKaputt) throw new Error('SecurityError');
    const davor = this.vorNaechstemLesen;
    this.vorNaechstemLesen = null;
    davor?.();
    return this.daten.get(k) ?? null;
  }
  /** localStorage.clear() in einem anderen Tab. */
  leeren(von: object | null): void {
    this.daten.clear();
    for (const h of this.hoerer) if (h.tab !== von) this.zustellenOderMerken(() => h.fn({ key: null }));
  }

  speicherFuer(tab: object): RingSpeicher {
    const profil = this;
    return {
      get length() {
        return profil.daten.size;
      },
      key: (i) => [...profil.daten.keys()][i] ?? null,
      getItem: (k) => this.getItem(k),
      setItem: (k, v) => this.setItem(tab, k, v),
      removeItem: (k) => this.removeItem(tab, k),
    };
  }
  ereignisseFuer(tab: object): EreignisQuelle {
    return {
      addEventListener: (_art, fn) => void this.hoerer.push({ tab, fn }),
      removeEventListener: (_art, fn) => {
        const i = this.hoerer.findIndex((h) => h.tab === tab && h.fn === fn);
        if (i >= 0) this.hoerer.splice(i, 1);
      },
    };
  }
  kanalFuer(tab: object): Kanal {
    const k = new KanalAttrappe(this, tab);
    this.kanaele.push(k);
    return k;
  }
  /** Nur für KanalAttrappe. */
  verteile(von: KanalAttrappe, nachricht: unknown): void {
    for (const k of this.kanaele) {
      if (k !== von && !k.zu) this.zustellenOderMerken(() => k.onmessage?.({ data: nachricht }));
    }
  }

  /** Der Testflug ändert den Entwurf: schreibt den Entwurf, ohne Stempel, ohne Kanal, ohne den Zettel anzufassen. */
  testflugSchreibt(layout: unknown): void {
    this.setItem(null, ENTWURF_KEY, JSON.stringify(layout));
  }
  /** Der Testflug hat gespeichert (200): am Begleitzettel ändert sich NUR das Feld `basis` (LocalStoragePersistenz.basisNachziehen). */
  testflugSpeichertBasis(hash: string | null): void {
    const neu = zettelMitBasis(this.daten.get(STAND_KEY), hash);
    if (neu !== null) this.setItem(null, STAND_KEY, neu);
  }
}

class KanalAttrappe implements Kanal {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  zu = false;
  constructor(
    private readonly profil: Profil,
    _tab: object
  ) {}
  postMessage(n: unknown): void {
    this.profil.verteile(this, n);
  }
  close(): void {
    this.zu = true;
  }
}

/**
 * Die Stapelregeln der früheren Stände, als Zeugen: Sie haben dieselbe
 * Oberfläche wie `SchrittVerlauf` und dienen nur dazu, dem Test zu zeigen,
 * dass er den jeweiligen Fehler auch FINDET. Keiner kennt den Abgangs-Hörer
 * des Rings — so wenig wie die echten Stände damals.
 */
interface VerlaufLike<T = WorldLayout> {
  readonly vergangenheit: T[];
  readonly zukunft: T[];
  merke(aktuell: T, ersetzt?: boolean): void;
  uebernahme(aktuell: T, ersatz?: T): unknown;
  zurueck(aktuell: T): T | undefined;
  vor(aktuell: T): T | undefined;
  ohneSchritt(): void;
}
/** Stand 5eb78eb: JEDE Übernahme legt einen Schritt an (und leert den Wiederherstellen-Stapel). */
class Verlauf5eb78eb<T = WorldLayout> implements VerlaufLike<T> {
  readonly vergangenheit: T[] = [];
  readonly zukunft: T[] = [];
  merke(a: T): void {
    this.vergangenheit.push(a);
    if (this.vergangenheit.length > 50) this.vergangenheit.shift();
    this.zukunft.length = 0;
  }
  uebernahme(a: T): boolean {
    this.merke(a);
    return true;
  }
  zurueck(a: T): T | undefined {
    const v = this.vergangenheit.pop();
    if (v) this.zukunft.push(a);
    return v;
  }
  vor(a: T): T | undefined {
    const w = this.zukunft.pop();
    if (w) {
      this.vergangenheit.push(a);
      if (this.vergangenheit.length > 50) this.vergangenheit.shift();
    }
    return w;
  }
  ohneSchritt(): void {}
}
/** Stand 88277f5: Übernahmeschritt wird an der OBJEKTIDENTITÄT des obersten Schritts erkannt. */
class Verlauf88277f5<T = WorldLayout> extends Verlauf5eb78eb<T> {
  private marke: T | null = null;
  override uebernahme(a: T): boolean {
    const oben = this.vergangenheit[this.vergangenheit.length - 1];
    if (this.marke !== null && oben === this.marke) {
      this.zukunft.length = 0;
      return false;
    }
    this.marke = a;
    this.merke(a);
    return true;
  }
}
/**
 * Stand 5916752: Flag statt Identität, die Übernahme leert den
 * Wiederherstellen-Stapel — aber OHNE Ring: Was dabei entfällt, ist weg.
 */
class Verlauf5916752<T = WorldLayout> extends Verlauf5eb78eb<T> {
  private oben = false;
  override merke(a: T): void {
    super.merke(a);
    this.oben = false;
  }
  override uebernahme(a: T): boolean {
    this.zukunft.length = 0;
    if (this.oben) return false;
    this.vergangenheit.push(a);
    if (this.vergangenheit.length > 50) this.vergangenheit.shift();
    this.oben = true;
    return true;
  }
  override zurueck(a: T): T | undefined {
    const v = super.zurueck(a);
    if (v) this.oben = false;
    return v;
  }
  override vor(a: T): T | undefined {
    const w = super.vor(a);
    if (w) this.oben = false;
    return w;
  }
  override ohneSchritt(): void {
    this.oben = false;
  }
}

/**
 * Das Verhalten des Editors, so knapp wie im Editor: `verlauf.merke` vor jeder
 * eigenen Änderung (Grenze 50); jede Änderung schreibt sofort den Entwurf;
 * `beiFremdem` = `verlauf.uebernahme(layout); layout = fremd` und KEIN
 * Zurückschreiben (editorMain.ts, `entwurfsSpeicher`; die Quelltextprüfung
 * unten hält das am echten Code fest). Der Verlauf ist dieselbe Klasse wie im
 * Editor (`SchrittVerlauf`), sofern der Test keinen alten Stand einsetzt.
 */
class EditorAttrappe {
  layout: WorldLayout;
  readonly verlauf: VerlaufLike;
  /** Der Ring der verdrängten Entwürfe: ein Schlüssel je Eintrag im selben Profil-Speicher wie der Entwurf. */
  readonly ring: VerdraengtRing;
  /** Herkunft übernommener Stände und der eigenen, die auf einem fremden aufbauen (wie `fremdeStaende`/`fremdHaltig` im Editor). */
  private readonly fremdeStaende = new WeakSet<WorldLayout>();
  private readonly fremdHaltig = new WeakSet<WorldLayout>();
  private istHaltig(x: WorldLayout): boolean {
    return this.fremdeStaende.has(x) || this.fremdHaltig.has(x);
  }
  get vergangenheit(): WorldLayout[] {
    return this.verlauf.vergangenheit;
  }
  get zukunft(): WorldLayout[] {
    return this.verlauf.zukunft;
  }
  fremdUebernahmen = 0;
  /** Wie oft die Meldung „dein bisheriger Stand liegt unter Rückgängig" käme. */
  meldungen = 0;
  /** Wie oft beim Melden der letzte eigene Stand NICHT im Stapel lag. */
  falscheMeldungen = 0;
  /** Alle Meldungen in der Reihenfolge, wie der Editor sie setzt (die letzte steht am Ende da). */
  readonly meldungsVerlauf: string[] = [];
  /** Wie viele Stände in den Ring gingen / nicht gesichert werden konnten / den ältesten kosteten / zugunsten des Entwurfs geopfert wurden. */
  ringNeu = 0;
  ringVoll = 0;
  ringVerworfen = 0;
  ringGeopfert = 0;
  letzteInfo: FremdInfo | null = null;
  readonly speicher: EntwurfsSpeicher;
  constructor(
    readonly name: string,
    profil: Profil,
    opt: { ereignisse?: boolean; kanal?: boolean; jetzt?: () => number; verlauf?: VerlaufLike; ringMax?: number } = {}
  ) {
    const tab = this;
    this.ring = new VerdraengtRing(profil.speicherFuer(tab), { tabId: name, max: opt.ringMax ?? 5 });
    this.verlauf =
      opt.verlauf ??
      new SchrittVerlauf<WorldLayout>(50, (stand, grund, bezug) => this.beiAbgang(stand, grund, bezug));
    this.speicher = new EntwurfsSpeicher({
      speicher: profil.speicherFuer(tab),
      ereignisse: opt.ereignisse === false ? null : profil.ereignisseFuer(tab),
      kanal: opt.kanal === false ? null : profil.kanalFuer(tab),
      tabId: name,
      jetzt: opt.jetzt,
      aktuell: () => this.layout,
      // Der Entwurf hat Vorrang vor dem Ring — und der Ring bekommt zurück, was er umsonst hergab (wie im Editor).
      platzSchaffen: () => this.ring.aeltestenEntfernen(),
      platzErgebnis: (entwurfPasst) => {
        this.ringGeopfert += this.ring.opferAbschliessen(entwurfPasst);
      },
      beiVerdraengt: (alt) => {
        if (enthaelt(this.layout, alt) || this.verlauf.zukunft.concat(this.verlauf.vergangenheit).some((x) => enthaelt(x, alt))) return;
        this.ringen(alt, 'fremd', 'ersetzt');
      },
      beiFremdem: (fremd, info) => {
        this.fremdeStaende.add(fremd);
        const vor = this.ringNeu;
        const verworfenVor = this.ringVerworfen;
        this.verlauf.uebernahme(this.layout, fremd);
        this.layout = fremd;
        this.fremdUebernahmen++;
        this.letzteInfo = info;
        this.meldungen++;
        this.meldungsVerlauf.push(
          `Entwurf aus einem anderen Tab übernommen${this.ringNeu > vor ? ` — ${this.ringNeu - vor} gesichert` : ''}${this.ringVerworfen > verworfenVor ? ' — Ältester verdrängter Entwurf verworfen' : ''}`
        );
        // Die Meldung sagt: der bisherige EIGENE Stand liegt unter Rückgängig.
        if (this.eigenerStand !== null && !this.vergangenheit.includes(this.eigenerStand)) this.falscheMeldungen++;
      },
    });
    this.layout = this.speicher.lesen() ?? basis;
  }
  private ringen(stand: WorldLayout, herkunft: 'fremd' | 'eigen', grund: string): void {
    const verworfenVor = this.ring.verworfen;
    const r = this.ring.ablegen(stand, herkunft, grund, herkunft === 'fremd' ? null : this.name);
    this.ringVerworfen += this.ring.verworfen - verworfenVor;
    if (r === 'ok') this.ringNeu++;
    else if (r === 'voll') {
      this.ringVoll++;
      this.meldungsVerlauf.push('ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden (Speicher voll)!');
    }
  }
  private beiAbgang(stand: WorldLayout, grund: AbgangsGrund, bezug: WorldLayout): void {
    const herkunft = this.istHaltig(stand) ? 'fremd' : 'eigen';
    if (sollInRing(grund, herkunft, enthaelt(bezug, stand))) this.ringen(stand, herkunft, grund);
  }
  /**
   * Wie `speichereEntwurf` im Editor — mit denselben reinen Funktionen (`speicherGrund`): schreibt und setzt die
   * Meldungen, die kein Aufrufer überschreiben darf, und liefert den GRUND ('ok' | 'fremd' | 'voll' | 'knapp').
   */
  private schreibenMitMeldung(quelle: 'bearbeitet' | 'import' | 'server'): SpeicherGrund {
    const geopfertVor = this.ringGeopfert;
    const ergebnis = this.speicher.schreiben(this.layout, quelle, 'dev');
    this.letztesErgebnis = ergebnis;
    const geopfert = this.ringGeopfert - geopfertVor;
    const opfer = geopfert > 0 ? ` Dafür wurden ${geopfert} verdrängte Stände aus dem Ring verworfen (ältester zuerst).` : '';
    const grund = speicherGrund(ergebnis, geopfert);
    if (grund === 'voll') this.meldungsVerlauf.push('Entwurf zu groß für localStorage — bitte als JSON exportieren!' + opfer);
    else if (grund === 'knapp') this.meldungsVerlauf.push(`Speicher knapp — der Entwurf ist gespeichert.${opfer}`);
    return grund;
  }
  /** Ergebnis des letzten Schreibens (für Tests, die den Rückgabewert brauchen). */
  letztesErgebnis: string = 'ok';
  /** Der letzte EIGENE Stand — die Größe, deren Erreichbarkeit die Meldung zusagt. */
  eigenerStand: WorldLayout | null = null;
  /** Eine Änderung im Editor: Schritt merken, Layout ersetzen, Entwurf schreiben. */
  aendern(f: (l: WorldLayout) => WorldLayout): string {
    const haltig = this.istHaltig(this.layout);
    this.verlauf.merke(this.layout);
    this.layout = f(this.layout);
    if (haltig) this.fremdHaltig.add(this.layout);
    this.eigenerStand = this.layout;
    this.schreibenMitMeldung('bearbeitet');
    return this.letztesErgebnis;
  }
  /** Ersetzen durch einen ANDEREN Entwurf (Import, Serverstand, wieder eingesetzter Stand). */
  ersetzen(neu: WorldLayout): string {
    this.verlauf.merke(this.layout, true);
    this.layout = neu;
    this.eigenerStand = this.layout;
    const grund = this.schreibenMitMeldung('import');
    if (grund === 'ok') this.meldungsVerlauf.push('Import übernommen');
    return grund;
  }
  /** Strg+Z — wie `rueckgaengig()` im Editor, samt Meldung und Reihenfolge. */
  rueckgaengig(): void {
    const v = this.verlauf.zurueck(this.layout);
    if (v === undefined) return;
    this.layout = v;
    // Wie im Editor: eine schon gesetzte Meldung (fremder Stand übernommen, zu groß, Speicher knapp) bleibt stehen.
    if (this.schreibenMitMeldung('bearbeitet') === 'ok') this.meldungsVerlauf.push(`Rückgängig (${this.verlauf.vergangenheit.length} weitere Schritte)`);
  }
  wiederherstellen(): void {
    const w = this.verlauf.vor(this.layout);
    if (w === undefined) return;
    this.layout = w;
    if (this.schreibenMitMeldung('bearbeitet') === 'ok') this.meldungsVerlauf.push('Wiederhergestellt');
  }
  /**
   * „Serverstand laden" — wie `uebernehmen` im Start-Abgleich: „geladen" nur, wenn es wirklich geladen wurde.
   * Mit `hash` (der Serverstand kam mit einer Kennung): Erst NACH dem Schreiben des Entwurfs beruht er auf ihr —
   * und nur, wenn er im Speicher steht (`entwurfImSpeicher`), sonst bleibt die Basis des Zettels, wie sie war.
   */
  serverstandLaden(server: WorldLayout, hash?: string | null): void {
    if (brauchtSchrittVorErsetzen(this.layout, server)) this.verlauf.merke(this.layout, true);
    else this.verlauf.ohneSchritt();
    this.layout = server;
    // Derselbe Weg wie im Editor (weltAbgleich.uebernehmen und 409): schreiben → Grund → serverstandFolge.
    const grund = this.schreibenMitMeldung('server');
    if (hash !== undefined && entwurfImSpeicher(grund)) this.speicher.basisMerken(hash);
    const folge = serverstandFolge(grund);
    if (folge === 'geladen') this.meldungsVerlauf.push('Serverstand geladen');
    else if (folge === 'nicht-geladen') this.meldungsVerlauf.push('Serverstand NICHT geladen — ein anderer Tab hat den Entwurf zwischenzeitlich geändert');
    // 'stehen-lassen': 'voll'/'knapp' haben ihre Meldung schon gesetzt — nichts darüberschreiben.
  }
  /** Der Nutzer wählt im Dialog ausdrücklich „Entwurf behalten": der gezeigte Serverstand wird die Basis (bei 'fremd' nicht). */
  entwurfBehalten(hash: string | null): void {
    const grund = this.schreibenMitMeldung('bearbeitet');
    if (grund !== 'fremd') this.speicher.basisMerken(hash);
  }
}

// ── Testdaten: das Bestandsdokument, mit 3 Platzierungen als Ausgangsstand ──
const echt = sanitizeWorldLayout(
  JSON.parse(readFileSync(resolve(WURZEL, 'server/data/welten/dev.json'), 'utf-8'))
)!;
const basis: WorldLayout = { ...echt, placements: (echt.placements ?? []).slice(0, 3) };
const anzahl = (l: WorldLayout | null): number => l?.placements?.length ?? 0;
const hat = (l: WorldLayout | null, x: number): boolean => (l?.placements ?? []).some((p) => p.x === x && p.z === x);
const setze = (x: number) => (l: WorldLayout): WorldLayout => layoutMitPlatzierung(l, 'Beech1', x, x, 0.5);
const P1 = 1111;
const P2 = 2222;
const gespeichert = (p: Profil): WorldLayout | null => {
  const roh = p.daten.get(ENTWURF_KEY);
  return roh ? sanitizeWorldLayout(JSON.parse(roh)) : null;
};
const beide = (p: Profil): string => `n=${anzahl(gespeichert(p))} P1=${hat(gespeichert(p), P1)} P2=${hat(gespeichert(p), P2)}`;

/** Zwei Tabs, beide mit dem Ausgangsstand geladen (3 Platzierungen). */
function zweiTabs(opt: { ereignisse?: boolean; kanal?: boolean } = {}): { profil: Profil; a: EditorAttrappe; b: EditorAttrappe } {
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const a = new EditorAttrappe('tab-a', profil, opt);
  const b = new EditorAttrappe('tab-b', profil, opt);
  return { profil, a, b };
}

// ── 1. Zwei Tabs: das Ereignis kommt VOR der zweiten Änderung ────────
console.log('▶ Zwei Tabs, Ereignis kommt rechtzeitig');
{
  const { profil, a, b } = zweiTabs();
  check('Ausgangsstand: beide Tabs zeigen 3 Platzierungen', anzahl(a.layout) === 3 && anzahl(b.layout) === 3);
  const wa = a.aendern(setze(P1));
  check('A schreibt P1', wa === 'ok' && hat(gespeichert(profil), P1), beide(profil));
  check('B hat den fremden Stand übernommen (4 Platzierungen, P1 dabei)', anzahl(b.layout) === 4 && hat(b.layout, P1), `n=${anzahl(b.layout)}`);
  check('… genau einmal, über das storage-Ereignis oder den Kanal', b.fremdUebernahmen === 1, `Übernahmen=${b.fremdUebernahmen}, wie=${b.letzteInfo?.wie}`);
  check('… und B hat dabei NICHT geschrieben (kein Ping-Pong): 2 Schreibvorgänge insgesamt (A: Entwurf + Zettel)', profil.schreibvorgaenge === 2, `Schreibvorgänge=${profil.schreibvorgaenge}`);
  check('A hat nichts übernommen (eigene Schreibvorgänge lösen bei sich nichts aus)', a.fremdUebernahmen === 0);
  check('Vor der Übernahme lag B’s alter Stand (3) im Rückgängig-Stapel', b.vergangenheit.length === 1 && anzahl(b.vergangenheit[0]!) === 3);

  const wb = b.aendern(setze(P2));
  const im = gespeichert(profil);
  check('B setzt P2 auf dem übernommenen Stand', wb === 'ok');
  check('Gespeichert sind P1 UND P2, 0 Verluste (5 Platzierungen)', anzahl(im) === 5 && hat(im, P1) && hat(im, P2), beide(profil));
  check('A übernimmt jetzt den Stand von B (5 Platzierungen)', anzahl(a.layout) === 5 && hat(a.layout, P2) && a.fremdUebernahmen === 1);
}

// ── 2. Zwei Tabs: B ändert, BEVOR das Ereignis ankommt ───────────────
console.log('▶ Zwei Tabs, B ändert vor dem Ereignis (Tab im Hintergrund)');
{
  const { profil, a, b } = zweiTabs();
  profil.zurueckhalten = true;
  a.aendern(setze(P1));
  check('A schreibt P1 (Ereignisse für B sind zurückgehalten)', hat(gespeichert(profil), P1) && b.fremdUebernahmen === 0, beide(profil));
  const schreibvorher = profil.schreibvorgaenge;
  const wb = b.aendern(setze(P2));
  check('B versucht P2 zu speichern: Ergebnis „fremd“, es wurde NICHT geschrieben', wb === 'fremd' && profil.schreibvorgaenge === schreibvorher, `Ergebnis=${wb}, Schreibvorgänge ${schreibvorher}→${profil.schreibvorgaenge}`);
  const im = gespeichert(profil);
  check('Im Speicher steht weiter A’s Stand: P1 da, 4 Platzierungen (P1 nicht verloren)', anzahl(im) === 4 && hat(im, P1) && !hat(im, P2), beide(profil));
  check('B zeigt jetzt A’s Stand (4 Platzierungen, P1)', anzahl(b.layout) === 4 && hat(b.layout, P1) && b.fremdUebernahmen === 1);
  const mitP2 = b.vergangenheit.filter((l) => hat(l, P2));
  check('B’s P2 steht im Rückgängig-Stapel (nicht still verloren)', mitP2.length === 1 && anzahl(mitP2[0]!) === 4, `Stapel=${b.vergangenheit.map(anzahl).join(',')}`);
  check('Der Stapel enthält davor B’s Ausgangsstand (3)', b.vergangenheit.some((l) => anzahl(l) === 3 && !hat(l, P2) && !hat(l, P1)));
  b.rueckgaengig();
  check('Rückgängig bringt B’s Stand mit P2 zurück (4 Platzierungen, P2 da, P1 nicht)', hat(b.layout, P2) && !hat(b.layout, P1) && anzahl(b.layout) === 4);
  const uebernahmenVorher = b.fremdUebernahmen;
  profil.zustellen();
  check('Das verspätete Ereignis findet nichts Neues: keine zweite Übernahme', b.fremdUebernahmen === uebernahmenVorher, `Übernahmen=${b.fremdUebernahmen}`);
}

// ── 3. Der Testflug schreibt OHNE Stempel ────────────────────────────
console.log('▶ Testflug als Schreiber ohne Stempel');
{
  const { profil, b } = zweiTabs();
  profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 1));
  check('Der Editor erkennt den Stand des Testflugs als fremd (4 Platzierungen, P1)', b.fremdUebernahmen === 1 && anzahl(b.layout) === 4 && hat(b.layout, P1));
  check('… ohne Stempel: tabId und geaendertUm unbekannt', b.letzteInfo?.tabId === null && b.letzteInfo?.geaendertUm === null, JSON.stringify(b.letzteInfo));
  check('B hat nicht zurückgeschrieben (1 Schreibvorgang insgesamt, der des Testflugs)', profil.schreibvorgaenge === 1);
}
{
  // Dasselbe, wenn die Ereignisse ganz ausbleiben: der Schreibversuch fängt es.
  const { profil, b } = zweiTabs({ ereignisse: false, kanal: false });
  profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 1));
  check('Ohne jedes Ereignis: B weiss nichts (0 Übernahmen)', b.fremdUebernahmen === 0);
  const w = b.aendern(setze(P2));
  const im = gespeichert(profil);
  check('B’s Schreibversuch wird abgefangen (fremd), P1 bleibt im Speicher', w === 'fremd' && hat(im, P1) && !hat(im, P2), `${w} · ${beide(profil)}`);
  check('B’s P2 liegt im Rückgängig-Stapel', b.vergangenheit.some((l) => hat(l, P2)));
}

// ── 4. Nur BroadcastChannel (kein storage-Ereignis) ──────────────────
console.log('▶ Nur BroadcastChannel');
{
  const { profil, a, b } = zweiTabs({ ereignisse: false });
  a.aendern(setze(P1));
  check('B übernimmt über den Kanal (4 Platzierungen, wie=kanal)', b.fremdUebernahmen === 1 && anzahl(b.layout) === 4 && b.letzteInfo?.wie === 'kanal', `wie=${b.letzteInfo?.wie}`);
  check('… und der Stempel kommt mit: tabId=tab-a', b.letzteInfo?.tabId === 'tab-a' && typeof b.letzteInfo?.geaendertUm === 'number', JSON.stringify(b.letzteInfo));
  check('Kein Ping-Pong (2 Schreibvorgänge insgesamt)', profil.schreibvorgaenge === 2);
}

// ── 5. Stempel im Begleitzettel ──────────────────────────────────────
console.log('▶ Stempel');
{
  const profil = new Profil();
  const uhr = { t: 1_800_000_000_000 };
  const a = new EditorAttrappe('tab-a', profil, { jetzt: () => uhr.t });
  a.aendern(setze(P1));
  const zettel = JSON.parse(profil.daten.get(STAND_KEY)!) as { tabId: string; geaendertUm: number; quelle: string; instanz: string; zeit: string };
  check('Zettel trägt tabId und geaendertUm', zettel.tabId === 'tab-a' && zettel.geaendertUm === uhr.t, JSON.stringify(zettel));
  check('… sowie die bisherigen Felder (zeit, instanz, quelle)', zettel.quelle === 'bearbeitet' && zettel.instanz === 'dev' && zettel.zeit === new Date(uhr.t).toISOString());
  const roh = JSON.parse(profil.daten.get(ENTWURF_KEY)!) as Record<string, unknown>;
  check('Der Entwurf selbst bleibt ein reines WorldLayout (kein Stempelfeld darin)', !('geaendertUm' in roh) && !('tabId' in roh));
  // Der Zettel wird von der bestehenden Leseroutine mitgelesen.
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => profil.daten.get(k) ?? null };
  const gelesen = entwurfStandLesen();
  check('entwurfStandLesen() gibt den Stempel weiter', gelesen?.tabId === 'tab-a' && gelesen?.geaendertUm === uhr.t);
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

// ── 6. Grenzfälle ────────────────────────────────────────────────────
console.log('▶ Grenzfälle');
{
  // Fremd geschriebener, aber inhaltsgleicher Stand: nichts zu übernehmen.
  const { profil, a, b } = zweiTabs();
  profil.testflugSchreibt(a.layout);
  check('Inhaltsgleicher fremder Stand: keine Übernahme', b.fremdUebernahmen === 0 && a.fremdUebernahmen === 0);
  check('… und B schreibt danach normal', b.aendern(setze(P2)) === 'ok' && hat(gespeichert(profil), P2));
}
{
  // Unbrauchbarer Inhalt ist keine schützenswerte Arbeit.
  const { profil, b } = zweiTabs();
  profil.daten.set(ENTWURF_KEY, '{kaputt');
  check('Unlesbarer Inhalt löst keine Übernahme aus', b.aendern(setze(P2)) === 'ok' && b.fremdUebernahmen === 0);
  check('… B schreibt seinen Stand (P2 gespeichert)', hat(gespeichert(profil), P2));
}
{
  // localStorage.clear() in einem anderen Tab.
  const { profil, b } = zweiTabs();
  profil.leeren(null);
  check('Nach clear() in einem anderen Tab: B schreibt seinen Stand neu (ok)', b.aendern(setze(P2)) === 'ok' && hat(gespeichert(profil), P2) && b.fremdUebernahmen === 0);
}
{
  // Speicher voll.
  const { profil, b } = zweiTabs();
  profil.quotaFehler = true;
  const vorher = profil.daten.get(ENTWURF_KEY);
  check('Speicher voll: „voll“, Speicher unverändert', b.aendern(setze(P2)) === 'voll' && profil.daten.get(ENTWURF_KEY) === vorher);
  profil.quotaFehler = false;
  check('… und danach geht es wieder (kein hängengebliebener Zustand)', b.aendern(setze(P1)) === 'ok' && hat(gespeichert(profil), P1));
}
{
  // getItem wirft.
  const profil = new Profil();
  profil.lesenKaputt = true;
  const a = new EditorAttrappe('tab-a', profil);
  check('Lesen wirft: lesen() liefert null, der Editor startet mit dem Ausgangsdokument', anzahl(a.layout) === 3);
  profil.lesenKaputt = false;
  check('… Schreiben geht danach', a.aendern(setze(P1)) === 'ok');
}
{
  // schliessen() klinkt aus.
  const { profil, a, b } = zweiTabs();
  b.speicher.schliessen();
  a.aendern(setze(P1));
  check('Nach schliessen() kommt kein Ereignis mehr an', b.fremdUebernahmen === 0, `Übernahmen=${b.fremdUebernahmen}`);
  void profil;
}
{
  // Erster Schreibversuch ohne vorheriges Lesen gegen vorhandenen Entwurf: nicht blind überschreiben.
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 1)));
  let uebernommen = 0;
  const s = new EntwurfsSpeicher({
    speicher: profil.speicherFuer({}),
    aktuell: () => basis,
    beiFremdem: () => void uebernommen++,
  });
  check('Schreiben ohne vorheriges lesen(): fremd statt Überschreiben', s.schreiben(basis, 'bearbeitet', null) === 'fremd' && uebernommen === 1 && hat(gespeichert(profil), P1));
}

// ── 7. Vergleichsprobe: der ALTE Schreibweg verliert P1 ──────────────
console.log('▶ Vergleichsprobe: alter Schreibweg (ungeprüft schreiben)');
{
  /** Der Schreibweg vor K0.3 (Stand-in für das entfernte `entwurfSchreiben`): Entwurf, dann Zettel, ohne nachzusehen. */
  const entwurfSchreiben = (layout: WorldLayout, quelle: string, instanz: string | null): void => {
    const ls = (globalThis as { localStorage: { setItem(k: string, v: string): void } }).localStorage;
    ls.setItem(ENTWURF_KEY, JSON.stringify(layout));
    ls.setItem(STAND_KEY, JSON.stringify({ zeit: new Date().toISOString(), instanz, quelle }));
  };
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => profil.daten.get(k) ?? null,
    setItem: (k: string, v: string) => void profil.setItem(null, k, v),
  };
  const ladeA = entwurfLesen()!;
  const ladeB = entwurfLesen()!; // B hat vorher geladen
  entwurfSchreiben(layoutMitPlatzierung(ladeA, 'Beech1', P1, P1, 1), 'bearbeitet', 'dev'); // A schreibt P1
  entwurfSchreiben(layoutMitPlatzierung(ladeB, 'Beech1', P2, P2, 1), 'bearbeitet', 'dev'); // B schreibt seinen Stand
  const im = gespeichert(profil);
  check('Der alte Weg: P2 steht da, P1 ist VERLOREN (das ist der Fehler, den der Speicher verhindert)', hat(im, P2) && !hat(im, P1) && anzahl(im) === 4, beide(profil));
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

// ── 8. Platzieren: n → setzen → n+1 → Rückgängig → n ─────────────────
console.log('▶ Platzieren-Werkzeug und Rückgängig');
{
  const n = anzahl(basis);
  const neu = layoutMitPlatzierung(basis, 'Beech1', 10.4, 20.6, 1.25);
  check('Platzierungszahl n → n+1', anzahl(neu) === n + 1, `${n} → ${anzahl(neu)}`);
  check('Das alte Layout bleibt unverändert (n) — Voraussetzung des Schnappschuss-Undo', anzahl(basis) === n);
  const p = neu.placements![n]!;
  check('Koordinaten gerundet wie bisher, Yaw unverändert durchgereicht', p.x === 10 && p.z === 21 && p.yaw === 1.25 && p.prefab === 'Beech1', JSON.stringify(p));

  // Der Zweig im Editor, mit dessen Undo-Stapel nachgestellt.
  const stapel: WorldLayout[] = [];
  let l = basis;
  const platzieren = (): void => {
    stapel.push(l); // merkeSchritt()
    l = layoutMitPlatzierung(l, 'Beech1', 5, 5, 0);
  };
  platzieren();
  check('Nachgestellt: n+1 nach dem Setzen', anzahl(l) === n + 1);
  l = stapel.pop()!; // rueckgaengig()
  check('Nachgestellt: Rückgängig → n', anzahl(l) === n, `${n} → ${n + 1} → ${anzahl(l)}`);
}

// ── 8b. Übernahmen fluten den Rückgängig-Stapel nicht (B1) ───────────
console.log('▶ 50 eigene Schritte + k fremde Schreibvorgänge');
{
  const fremdeLayout = (j: number): WorldLayout => layoutMitPlatzierung(basis, 'Beech1', 100 + 5 * j, 100 + 5 * j, 0);
  const zeilen: string[] = [];
  const lauf = (k: number, verlauf?: VerlaufLike): { erreichbar: boolean; genau: boolean; stapel: number; uebernahmen: number; falsch: number } => {
    const profil = new Profil();
    profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
    const b = new EditorAttrappe('tab-b', profil, { verlauf });
    for (let i = 0; i < 50; i++) b.aendern(setze(1000 + i));
    const eigen = b.layout;
    for (let j = 0; j < k; j++) profil.testflugSchreibt(fremdeLayout(j));
    const erreichbar = k === 0 ? b.layout === eigen : b.vergangenheit.includes(eigen);
    const stapel = b.vergangenheit.length;
    b.rueckgaengig();
    return { erreichbar, genau: k === 0 || b.layout === eigen, stapel, uebernahmen: b.fremdUebernahmen, falsch: b.falscheMeldungen };
  };
  for (const k of [0, 1, 2, 5, 51, 200]) {
    const r = lauf(k);
    zeilen.push(`k=${String(k).padStart(3)}  Stapel=${r.stapel}  Übernahmen=${r.uebernahmen}  eigener Stand erreichbar=${r.erreichbar}  1× Strg+Z liefert ihn=${r.genau}  falsche Meldungen=${r.falsch}`);
    check(`k=${k}: Übernahmen=${r.uebernahmen}, letzter eigener Stand per Rückgängig erreichbar (1× Strg+Z), 0 falsche Meldungen, Stapel ≤ 50`, r.uebernahmen === k && r.erreichbar && r.genau && r.falsch === 0 && r.stapel <= 50, `Stapel=${r.stapel}`);
  }
  console.log(zeilen.map((z) => `      ${z}`).join('\n'));
  // Gegenprobe: mit der Regel von 5eb78eb (jede Übernahme ein Schritt) ist der Test rot.
  const alt51 = lauf(51, new Verlauf5eb78eb());
  const alt50 = lauf(50, new Verlauf5eb78eb());
  const alt200 = lauf(200, new Verlauf5eb78eb());
  check('Gegenprobe 5eb78eb k=50: eigener Stand gerade noch im Stapel', alt50.erreichbar);
  check('Gegenprobe 5eb78eb k=51: eigener Stand AUS DEM STAPEL GEFALLEN, Meldung falsch', !alt51.erreichbar && alt51.falsch > 0, `erreichbar=${alt51.erreichbar}, falsche Meldungen=${alt51.falsch}, Stapel=${alt51.stapel}`);
  check('Gegenprobe 5eb78eb k=200: 150 falsche Meldungen', alt200.falsch === 150, `falsche Meldungen=${alt200.falsch}`);

  // Nach einer eigenen Änderung zählt wieder die erste Übernahme.
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const b = new EditorAttrappe('tab-b', profil);
  b.aendern(setze(1000));
  profil.testflugSchreibt(fremdeLayout(0));
  profil.testflugSchreibt(fremdeLayout(1));
  const nachFlut = b.vergangenheit.length;
  const eigen2 = b.aendern(setze(1001)) === 'ok' ? b.layout : null;
  profil.testflugSchreibt(fremdeLayout(2));
  check('Eigene Änderung dazwischen: die nächste Übernahme legt wieder einen Schritt an (Stapel +2: Änderung, Übernahme)', b.vergangenheit.length === nachFlut + 2 && eigen2 !== null && b.vergangenheit.includes(eigen2), `Stapel ${nachFlut} → ${b.vergangenheit.length}`);
  // Der Wiederherstellen-Stapel gehört zum verdrängten Stand: Eine Übernahme verwirft ihn und meldet, wie viele Schritte entfallen sind.
  const v2 = new SchrittVerlauf<string>();
  v2.merke('a');
  v2.merke('b');
  v2.zurueck('c'); // Wiederherstellen-Stapel: 1 Schritt
  const u1 = v2.uebernahme('x');
  const u2 = v2.uebernahme('y');
  check('Übernahme verwirft den Wiederherstellen-Ast und meldet ihn: 1 Schritt entfallen, Schritt angelegt', u1.verworfen === 1 && u1.schritt && v2.zukunft.length === 0, JSON.stringify(u1));
  check('… die zweite Übernahme in Folge: nichts mehr zu verwerfen, kein neuer Schritt', u2.verworfen === 0 && !u2.schritt, JSON.stringify(u2));
  const profil2 = new Profil();
  profil2.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const c = new EditorAttrappe('tab-c', profil2);
  c.aendern(setze(1000));
  c.aendern(setze(1001));
  c.rueckgaengig();
  const zuk = c.zukunft.length;
  profil2.testflugSchreibt(fremdeLayout(0));
  check('Im Editor-Modell: Übernahme nach Strg+Z leert den Wiederherstellen-Stapel (1 → 0), Strg+Y danach ohne Wirkung', zuk === 1 && c.zukunft.length === 0 && c.verlauf.vor(c.layout) === undefined, `zukunft ${zuk} → ${c.zukunft.length}`);
}

// ── 8b2. SchrittVerlauf: Grenze und Umkehrbarkeit ────────────────────
console.log('▶ SchrittVerlauf: Grenze 50, Umkehrbarkeit');
{
  const v = new SchrittVerlauf<number>();
  for (let i = 0; i < 60; i++) v.merke(i);
  check('merke kappt bei 50 (60 Schritte → 50, ältester ist 10)', v.vergangenheit.length === 50 && v.vergangenheit[0] === 10, `Länge=${v.vergangenheit.length}, ältester=${v.vergangenheit[0]}`);
  const k = new SchrittVerlauf<number>(2);
  k.merke(1);
  k.merke(2);
  check('zurueck → 2, dann → 1, Wiederherstellen-Stapel [9, 2]', k.zurueck(9) === 2 && k.zurueck(2) === 1 && k.zukunft.join() === '9,2', k.zukunft.join());
  check('vor(1) → 2 und die Grenze 2 hält auch hier (Stapel ≤ 2)', k.vor(1) === 2 && k.vergangenheit.length <= 2, `Länge=${k.vergangenheit.length}`);
  const l = new SchrittVerlauf<number>();
  check('leer: zurueck und vor liefern undefined, ohne den Stapel zu ändern', l.zurueck(1) === undefined && l.vor(1) === undefined && l.vergangenheit.length === 0 && l.zukunft.length === 0);
  // A2: beide Stapel bleiben unter der Grenze — 50 eigene Schritte, 50× Strg+Z, dann 200× [fremd, Strg+Z]
  {
    const w = new SchrittVerlauf<number>();
    let cur = 0;
    for (let i = 1; i <= 50; i++) {
      w.merke(cur);
      cur = i;
    }
    for (let i = 0; i < 50; i++) cur = w.zurueck(cur) as number;
    let maxV = w.vergangenheit.length;
    let maxZ = w.zukunft.length;
    let erreichbar = true;
    for (let j = 0; j < 200; j++) {
      w.uebernahme(cur); // die Meldung sagt: der bisherige Stand (cur) liegt unter Rückgängig
      if (!w.vergangenheit.includes(cur)) erreichbar = false;
      cur = 1000 + j; // fremder Stand
      cur = w.zurueck(cur) as number; // Strg+Z zurück auf den eigenen
      maxV = Math.max(maxV, w.vergangenheit.length);
      maxZ = Math.max(maxZ, w.zukunft.length);
    }
    check('50 eigene + 50× Strg+Z + 200× [fremd, Strg+Z]: beide Stapel ≤ 50 (Rückgängig max ' + maxV + ', Wiederherstellen max ' + maxZ + ')', maxV <= 50 && maxZ <= 50, `v=${maxV}, z=${maxZ}, am Ende v=${w.vergangenheit.length}, z=${w.zukunft.length}`);
    check('… und der von der Übernahme-Meldung zugesagte Stand war bei jeder der 200 Übernahmen im Rückgängig-Stapel', erreichbar);
    const kappe = new SchrittVerlauf<number>(3);
    for (let i = 0; i < 3; i++) kappe.merke(i);
    for (let i = 0; i < 3; i++) kappe.zurueck(10 + i);
    check('zurueck() kappt den Wiederherstellen-Stapel mit derselben Grenze (Grenze 3: Länge ≤ 3)', kappe.zukunft.length <= 3, `Länge=${kappe.zukunft.length}`);
  }
  const u = new SchrittVerlauf<number | undefined>();
  u.merke(undefined);
  check('Ein abgelegter Wert undefined wird nicht mit „leer" verwechselt', u.zurueck(1) === undefined && u.zukunft.length === 1);
}

// ── 8b3. Erschöpfende Prüfung: alle Folgen bis Länge 7 ────────────────
console.log('▶ Erschöpfend: alle Folgen bis Länge 7 über {eigen, import, fremd, fremdZ, undo, redo, laden}');
{
  /**
   * Zugmodell, wie es der Angriff 4 verlangt hat:
   *  - `fremd`: der Testflug — OHNE Zuhörer, schreibt per read-modify-write auf dem AKTUELLEN Speicher
   *    (main.ts: lesen, ein Objekt ergänzen, zurückschreiben). Sein neuer Stand enthält also den Speicher,
   *    aber NICHT, was dieser Editor nur angezeigt oder im Stapel hat.
   *  - `fremdZ`: ein zweiter Editor-Tab MIT Zuhörer, der seinen eigenen, unabhängigen Stand schreibt.
   *  - `eigen`/`import`/`undo`/`redo`/`laden`: dieser Editor. `import` steht für jedes Ersetzen durch einen
   *    ANDEREN Entwurf (Import, Serverstand laden, wieder einsetzen) — im Code derselbe Weg (`merke(…, true)`).
   *    `laden` ist das Ersetzen durch inhaltlich denselben Entwurf (nur `ohneSchritt`).
   * Ein Stand ist eine Menge von Objekten; verfolgt werden die OBJEKTE, nicht die Stände (Angriff 4, A6).
   * Kennungen: Start 1, eigen 100+, import 200+, fremd 300+, fremdZ 400+.
   */
  type Zug = 'eigen' | 'import' | 'fremd' | 'fremdZ' | 'undo' | 'redo' | 'laden';
  const ZUEGE: readonly Zug[] = ['eigen', 'import', 'fremd', 'fremdZ', 'undo', 'redo', 'laden'];
  interface St {
    id: number;
    objs: readonly number[];
    art: 'start' | 'eigen' | 'import' | 'fremd';
    /** Der letzte nicht-fremde Stand vor diesem (bei nicht-fremden: er selbst). */
    eigener: St | null;
  }
  const istFremd = (o: number): boolean => o >= 300;
  type Folge = readonly Zug[];
  interface Ergebnis {
    folgen: number;
    zuege: number;
    uebernahmen: number;
    /** (1) Übernahmen, bei denen der zuvor angezeigte (nicht-fremde bzw. letzte nicht-fremde) Stand nicht per Rückgängig erreichbar war = die Meldung wäre falsch. */
    falscheMeldungen: number;
    /** (2a) Folgen, in denen ein FREMDES Objekt, das je im Speicher stand oder angezeigt wurde, am Ende in Speicher ∪ Rückgängig ∪ Wiederherstellen ∪ Ring fehlt. */
    verlusteFremd: number;
    /** (2b) Folgen, in denen ein EIGENES Objekt fehlt, ohne dass eine eigene Änderung den Wiederherstellen-Ast verworfen (oder die Grenze es hinausgeschoben) hat. */
    verlusteEigen: number;
    /** (3) Wiederherstellen-Stapel verändert sich anders als: Strg+Z (+1), Strg+Y (−1), eigene Änderung/Import/Übernahme (leer). */
    redoVerstoesse: number;
    /** Wie oft der Ring gebraucht wurde (Einträge insgesamt / Folgen mit mindestens einem). */
    ringEintraege: number;
    ringFolgen: number;
    kuerzesteMeldung: Folge | null;
    kuerzesterVerlustFremd: Folge | null;
    kuerzesterVerlustEigen: Folge | null;
    kuerzesterRedo: Folge | null;
  }
  interface Lauf {
    meldung: boolean;
    verlustFremd: boolean;
    verlustEigen: boolean;
    redo: boolean;
    uebernahmen: number;
    falsche: number;
    ring: number;
  }
  const teilmenge = (klein: readonly number[], gross: readonly number[]): boolean => klein.every((o) => gross.includes(o));

  /** Eine Folge durchspielen; Verstöße je Invariante zählen. `grenze` klein → die Kappung greift. */
  const spielen = (folge: Folge, neu: (h: (s: St, g: AbgangsGrund, b: St) => void) => VerlaufLike<St>, importErsetzt: boolean): Lauf => {
    const ringListe: St[] = []; // Kapazität im Test: unbegrenzt
    let kappeDiesenZug = false;
    let kappeSchon = false; // die Kappung hat irgendwann in dieser Folge gegriffen: „liegt unter Rückgängig" kann dann nicht mehr für jeden Stand gelten
    let zaehler = 0;
    const v = neu((stand, grund, bezug) => {
      if (grund === 'kappe-undo' || grund === 'kappe-redo') kappeDiesenZug = kappeSchon = true;
      // Herkunft: ein Stand, der fremde Objekte mitträgt (auch ein eigener, der auf einem fremden aufbaut), ist so wenig verzichtbar wie ein fremder.
      const herkunft = stand.objs.some(istFremd) ? 'fremd' : 'eigen';
      if (sollInRing(grund, herkunft, teilmenge(stand.objs, bezug.objs))) ringListe.push(stand);
    });
    let id = 0;
    const st = (art: St['art'], objs: readonly number[], eigener: St | null): St => {
      const x: St = { id: id++, objs, art, eigener };
      if (art !== 'fremd') x.eigener = x;
      return x;
    };
    let aktuell = st('start', [1], null);
    let imSpeicher: St = aktuell;
    const gesehenEigen = new Set<number>([1]);
    const gesehenFremd = new Set<number>();
    let zObjekte: number[] = [];
    const r: Lauf = { meldung: false, verlustFremd: false, verlustEigen: false, redo: false, uebernahmen: 0, falsche: 0, ring: 0 };
    const merken = (x: St): void => {
      for (const o of x.objs) (istFremd(o) ? gesehenFremd : gesehenEigen).add(o);
    };
    for (const zug of folge) {
      const vorher = aktuell;
      const zukunftVorher = [...v.zukunft];
      kappeDiesenZug = false;
      let verwirftRedo = false; // eigene Änderung/Import/Übernahme: der Wiederherstellen-Ast darf entfallen
      let eigeneAenderung = false; // eine EIGENE Änderung: der Ast darf ohne Ring entfallen
      const ringVor = ringListe.length;
      if (zug === 'eigen' || zug === 'import') {
        const neuSt = zug === 'eigen' ? st('eigen', [...vorher.objs, 100 + zaehler++], null) : st('import', [200 + zaehler++], null);
        if (zug === 'eigen' || importErsetzt) {
          v.merke(aktuell, zug === 'import');
          verwirftRedo = true;
          eigeneAenderung = zug === 'eigen';
        }
        aktuell = neuSt;
        imSpeicher = neuSt;
        merken(neuSt);
      } else if (zug === 'fremd' || zug === 'fremdZ') {
        const basisStand = vorher.art !== 'fremd' ? vorher : vorher.eigener!;
        let objs: number[];
        if (zug === 'fremd') objs = [...new Set([...imSpeicher.objs, 300 + zaehler++])].sort((x, y) => x - y);
        else {
          zObjekte = [...zObjekte, 400 + zaehler++];
          objs = zObjekte;
        }
        const f = st('fremd', objs, basisStand);
        imSpeicher = f;
        merken(f);
        v.uebernahme(aktuell, f);
        verwirftRedo = true;
        r.uebernahmen++;
        // Die Meldung „dein bisheriger Stand liegt unter Rückgängig" behauptet: der letzte nicht-fremde Stand ist im Stapel.
        if (!v.vergangenheit.some((x) => x === basisStand) && !kappeSchon) {
          r.meldung = true;
          r.falsche++;
        }
        aktuell = f;
      } else if (zug === 'undo') {
        const x = v.zurueck(aktuell);
        if (x !== undefined) {
          aktuell = x;
          imSpeicher = x;
        }
      } else if (zug === 'redo') {
        const x = v.vor(aktuell);
        if (x !== undefined) {
          aktuell = x;
          imSpeicher = x;
        }
      } else {
        v.ohneSchritt(); // Serverstand inhaltlich gleich: nur die Regel beginnt neu
      }
      r.ring += ringListe.length - ringVor;
      // (3) Wiederherstellen-Stapel
      const erwartet: St[] = verwirftRedo
        ? []
        : zug === 'undo' && v.zukunft.length === zukunftVorher.length + 1
          ? [...zukunftVorher, vorher]
          : zug === 'redo' && v.zukunft.length === zukunftVorher.length - 1
            ? zukunftVorher.slice(0, -1)
            : zukunftVorher;
      if (v.zukunft.length !== erwartet.length || v.zukunft.some((x, i) => x !== erwartet[i])) r.redo = true;
      // (2) Kein Objekt geht verloren: erreichbar = Anzeige ∪ Speicher ∪ Rückgängig ∪ Wiederherstellen ∪ Ring.
      merken(aktuell);
      const erreichbar = new Set<number>();
      for (const x of [aktuell, imSpeicher, ...v.vergangenheit, ...v.zukunft, ...ringListe]) for (const o of x.objs) erreichbar.add(o);
      for (const o of gesehenFremd) {
        if (!erreichbar.has(o)) {
          r.verlustFremd = true;
          gesehenFremd.delete(o);
        }
      }
      for (const o of gesehenEigen) {
        if (erreichbar.has(o)) continue;
        // Standard-Undo: eine EIGENE Änderung verwirft den Wiederherstellen-Ast; die Grenze schiebt das alte Ende hinaus.
        if (!(eigeneAenderung || kappeDiesenZug)) r.verlustEigen = true;
        gesehenEigen.delete(o);
      }
    }
    return r;
  };

  const alleFolgen = (tiefe: number): Folge[] => {
    const aus: Folge[] = [];
    const rec = (f: Zug[]): void => {
      if (f.length > 0) aus.push([...f]);
      if (f.length === tiefe) return;
      for (const z of ZUEGE) rec([...f, z]);
    };
    rec([]);
    return aus;
  };
  const pruefe = (folgen: Folge[], neu: (h: (s: St, g: AbgangsGrund, b: St) => void) => VerlaufLike<St>, importErsetzt: boolean): Ergebnis => {
    const e: Ergebnis = { folgen: 0, zuege: 0, uebernahmen: 0, falscheMeldungen: 0, verlusteFremd: 0, verlusteEigen: 0, redoVerstoesse: 0, ringEintraege: 0, ringFolgen: 0, kuerzesteMeldung: null, kuerzesterVerlustFremd: null, kuerzesterVerlustEigen: null, kuerzesterRedo: null };
    const kuerzer = (alt: Folge | null, f: Folge): Folge => (!alt || f.length < alt.length ? f : alt);
    for (const f of folgen) {
      const r = spielen(f, neu, importErsetzt);
      e.folgen++;
      e.zuege += f.length;
      e.uebernahmen += r.uebernahmen;
      e.falscheMeldungen += r.falsche;
      e.ringEintraege += r.ring;
      if (r.ring > 0) e.ringFolgen++;
      if (r.meldung) e.kuerzesteMeldung = kuerzer(e.kuerzesteMeldung, f);
      if (r.verlustFremd) {
        e.verlusteFremd++;
        e.kuerzesterVerlustFremd = kuerzer(e.kuerzesterVerlustFremd, f);
      }
      if (r.verlustEigen) {
        e.verlusteEigen++;
        e.kuerzesterVerlustEigen = kuerzer(e.kuerzesterVerlustEigen, f);
      }
      if (r.redo) {
        e.redoVerstoesse++;
        e.kuerzesterRedo = kuerzer(e.kuerzesterRedo, f);
      }
    }
    return e;
  };
  const zeige = (name: string, e: Ergebnis): void =>
    console.log(
      `      ${name}: Folgen=${e.folgen}, Züge=${e.zuege}, Übernahmen=${e.uebernahmen}, falsche Meldungen=${e.falscheMeldungen}, Verlust-Folgen fremd=${e.verlusteFremd} / eigen=${e.verlusteEigen}, Redo-Verstöße=${e.redoVerstoesse}, Ring: ${e.ringEintraege} Einträge in ${e.ringFolgen} Folgen` +
        `${e.kuerzesteMeldung ? ` · kürzeste falsche Meldung: ${e.kuerzesteMeldung.join('→')}` : ''}` +
        `${e.kuerzesterVerlustFremd ? ` · kürzester Verlust (fremd): ${e.kuerzesterVerlustFremd.join('→')}` : ''}` +
        `${e.kuerzesterVerlustEigen ? ` · kürzester Verlust (eigen): ${e.kuerzesterVerlustEigen.join('→')}` : ''}` +
        `${e.kuerzesterRedo ? ` · kürzester Redo-Verstoß: ${e.kuerzesterRedo.join('→')}` : ''}`
    );

  const FOLGEN7 = alleFolgen(7);
  const echt = (grenze: number) => (h: (s: St, g: AbgangsGrund, b: St) => void): VerlaufLike<St> => new SchrittVerlauf<St>(grenze, h);
  const neuE = pruefe(FOLGEN7, echt(50), true);
  zeige('SchrittVerlauf + Ring (jetzt), Grenze 50', neuE);
  check('Anzahl der geprüften Folgen: 7¹+7²+…+7⁷ = 960799', neuE.folgen === 960799, String(neuE.folgen));
  check('SchrittVerlauf + Ring: 0 falsche Meldungen', neuE.falscheMeldungen === 0 && neuE.uebernahmen > 0, `Übernahmen=${neuE.uebernahmen}, falsch=${neuE.falscheMeldungen}`);
  check('SchrittVerlauf + Ring: 0 Folgen, in denen ein FREMDES Objekt (je im Speicher oder angezeigt) am Ende fehlt', neuE.verlusteFremd === 0, `Verlust-Folgen=${neuE.verlusteFremd}`);
  check('SchrittVerlauf + Ring: 0 Folgen mit Verlust eines EIGENEN Objekts, ausser durch eine eigene Änderung (Standard-Undo)', neuE.verlusteEigen === 0, `Verlust-Folgen=${neuE.verlusteEigen}`);
  check('SchrittVerlauf + Ring: 0 Verstöße gegen „Wiederherstellen-Stapel ändert sich nur durch Strg+Z/Strg+Y und eigene Änderung/Import/Übernahme“', neuE.redoVerstoesse === 0, `Verstöße=${neuE.redoVerstoesse}`);
  check('Der Ring wird gebraucht (nicht leerlaufend): mindestens ein Eintrag in mindestens einer Folge', neuE.ringEintraege > 0 && neuE.ringFolgen > 0, `${neuE.ringEintraege} Einträge in ${neuE.ringFolgen} Folgen`);

  // Die Kappung greift erst bei Tiefe > Grenze: derselbe Test mit Grenze 2 bis Länge 6.
  const FOLGEN6 = alleFolgen(6);
  const kappe = pruefe(FOLGEN6, echt(2), true);
  zeige('SchrittVerlauf + Ring, Grenze 2 (die Kappung greift)', kappe);
  check('Grenze 2, Länge ≤ 6: 0 falsche Meldungen, 0 Verlust-Folgen fremd, 0 Verlust-Folgen eigen (ausser Standard-Undo/Kappung), 0 Redo-Verstöße', kappe.falscheMeldungen === 0 && kappe.verlusteFremd === 0 && kappe.verlusteEigen === 0 && kappe.redoVerstoesse === 0, `${kappe.falscheMeldungen}/${kappe.verlusteFremd}/${kappe.verlusteEigen}/${kappe.redoVerstoesse}`);

  // Die Prüfung muss die früheren Fehler FINDEN (sonst wäre sie wertlos): Zeugen ohne Ring.
  const ohne = <V extends VerlaufLike<St>>(k: new () => V) => (_h: (s: St, g: AbgangsGrund, b: St) => void): VerlaufLike<St> => new k();
  const v5916 = pruefe(FOLGEN7, ohne(Verlauf5916752<St>), true);
  const id1 = pruefe(FOLGEN7, ohne(Verlauf88277f5<St>), false); // Import ohne Schritt
  const id2 = pruefe(FOLGEN7, ohne(Verlauf88277f5<St>), true);
  const alt = pruefe(FOLGEN7, ohne(Verlauf5eb78eb<St>), true);
  zeige('5916752 (Flag, Übernahme leert Wiederherstellen, KEIN Ring)', v5916);
  zeige('88277f5 (Identität, Import ohne Schritt)', id1);
  zeige('88277f5 (Identität, Import mit Schritt)', id2);
  zeige('5eb78eb (jede Übernahme ein Schritt, Import mit Schritt)', alt);
  const zeuge = ['eigen', 'fremd', 'undo', 'fremd'] as const;
  check('Gegenprobe 5916752: eigen→fremd→undo→fremd (Länge 4, der Zeuge des Angriffs) vernichtet ein fremdes Objekt', spielen(zeuge, ohne(Verlauf5916752<St>), true).verlustFremd, `kürzeste Verlustfolge überhaupt: ${v5916.kuerzesterVerlustFremd?.join('→') ?? 'nichts'} (${v5916.verlusteFremd} Folgen)`);
  check('Dieselbe Folge mit SchrittVerlauf + Ring: nichts geht verloren, und der Ring hält den Stand', !spielen(zeuge, echt(50), true).verlustFremd && spielen(zeuge, echt(50), true).ring > 0);
  check('Gegenprobe 88277f5: fremd→import→fremd (Länge 3) wird als falsche Meldung gefunden; kürzeste Länge überhaupt = 3', spielen(['fremd', 'import', 'fremd'], ohne(Verlauf88277f5<St>), false).meldung && id1.kuerzesteMeldung?.length === 3, id1.kuerzesteMeldung?.join('→') ?? 'nichts');
  check('Gegenprobe 88277f5: fremd→undo→eigen→fremd (Länge 4) wird gefunden, auch wenn der Import einen Schritt anlegt; kürzeste Länge = 4', spielen(['fremd', 'undo', 'eigen', 'fremd'], ohne(Verlauf88277f5<St>), true).meldung && id2.kuerzesteMeldung?.length === 4, id2.kuerzesteMeldung?.join('→') ?? 'nichts');
  check('Dieselben zwei Folgen sind mit SchrittVerlauf in Ordnung', !spielen(['fremd', 'import', 'fremd'], echt(50), true).meldung && !spielen(['fremd', 'undo', 'eigen', 'fremd'], echt(50), true).meldung);
  check('Gegenprobe 5eb78eb: bis Länge 7 keine falsche Meldung (die Flut braucht k ≥ 51, s. o.)', alt.falscheMeldungen === 0, `falsch=${alt.falscheMeldungen}`);
  check('Gegenprobe: ohne Ring verlieren alle drei alten Stände fremde Objekte (die Prüfung sieht es)', v5916.verlusteFremd > 0 && id2.verlusteFremd > 0 && alt.verlusteFremd > 0, `${v5916.verlusteFremd} / ${id2.verlusteFremd} / ${alt.verlusteFremd}`);
}

// ── 8c. Quota trifft nur den Begleitzettel (B2) ──────────────────────
console.log('▶ Quota nur beim Begleitzettel');
{
  const { profil, a, b } = zweiTabs();
  profil.quotaSchluessel = STAND_KEY;
  const r = a.aendern(setze(P1));
  check('Ergebnis \u201Eohne-zettel\u201C, nicht \u201Evoll\u201C', r === 'ohne-zettel', `Ergebnis=${r}`);
  check('Der Entwurf IST geschrieben (4 Platzierungen, P1)', anzahl(gespeichert(profil)) === 4 && hat(gespeichert(profil), P1), beide(profil));
  check('Der andere Tab bekommt ihn trotzdem (Kanal/Ereignis): 4 Platzierungen', b.fremdUebernahmen === 1 && anzahl(b.layout) === 4);
  const w2 = a.aendern(setze(P2));
  check('Nächster Schreibvorgang von A: kein falsches \u201Efremd\u201C (bekannt war gesetzt), Entwurf 5 Platzierungen', w2 === 'ohne-zettel' && anzahl(gespeichert(profil)) === 5, `Ergebnis=${w2}`);
  profil.quotaSchluessel = null;
  check('Quota wieder frei: \u201Eok\u201C', a.aendern(setze(P1 + 1)) === 'ok');
  // Entwurf selbst passt nicht → weiter 'voll'
  const p2 = new Profil();
  p2.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const c = new EditorAttrappe('tab-c', p2);
  p2.quotaSchluessel = ENTWURF_KEY;
  check('Quota trifft den Entwurf selbst: weiter \u201Evoll\u201C', c.aendern(setze(P1)) === 'voll' && anzahl(gespeichert(p2)) === 3);
}

// ── 8d. Quota: der Begleitzettel wird nicht veraltet stehen gelassen (A2) ──
console.log('▶ Begleitzettel bei Quota');
{
  const { profil, a } = zweiTabs();
  a.aendern(setze(P1)); // schreibt einen ersten, vollständigen Zettel
  const alterZettel = profil.daten.get(STAND_KEY);
  check('Vorher: ein Zettel steht da (quelle=bearbeitet, instanz=dev, tabId=tab-a)', !!alterZettel && alterZettel.includes('"tabId":"tab-a"'));
  profil.quotaSchluessel = STAND_KEY;
  const r = a.aendern(setze(P2));
  check('Quota trifft den Zettel: Ergebnis \u201Eohne-zettel\u201C', r === 'ohne-zettel', r);
  check('Der Entwurf ist geschrieben (5 Platzierungen, P1 und P2)', anzahl(gespeichert(profil)) === 5 && hat(gespeichert(profil), P2), beide(profil));
  check('Der VERALTETE Zettel ist entfernt (kein falsches Datum, keine falsche Quelle/Instanz)', profil.daten.has(STAND_KEY) === false);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => profil.daten.get(k) ?? null };
  check('Der Startdialog liest keinen Zettel mehr (entwurfStandLesen() === null → „kein Zeitstempel")', entwurfStandLesen() === null);
  delete (globalThis as { localStorage?: unknown }).localStorage;
}
{
  // Klappt der zweite Versuch nach dem Entfernen (Platz frei geworden), ist der Zettel wieder frisch.
  const { profil, a } = zweiTabs();
  a.aendern(setze(P1));
  const alt = JSON.parse(profil.daten.get(STAND_KEY)!) as { geaendertUm: number };
  profil.quotaEinmalFuer = STAND_KEY;
  const r = a.aendern(setze(P2));
  const neu = profil.daten.get(STAND_KEY) ? (JSON.parse(profil.daten.get(STAND_KEY)!) as { geaendertUm: number }) : null;
  check('Zweiter Versuch nach dem Entfernen gelingt: Ergebnis \u201Eok\u201C, frischer Zettel', r === 'ok' && neu !== null && neu.geaendertUm >= alt.geaendertUm, r);
}
{
  // Ein Speicher ohne removeItem: kein Absturz, Ergebnis ehrlich.
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const ohneRemove: KvSpeicher = { getItem: (k) => profil.getItem(k), setItem: (k, v) => profil.setItem(null, k, v) };
  const s = new EntwurfsSpeicher({ speicher: ohneRemove, aktuell: () => basis, beiFremdem: () => undefined });
  s.lesen();
  s.schreiben(basis, 'bearbeitet', 'dev');
  profil.quotaSchluessel = STAND_KEY;
  check('Speicher ohne removeItem: \u201Eohne-zettel\u201C, kein Wurf', s.schreiben(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 0), 'bearbeitet', 'dev') === 'ohne-zettel');
}

// ── 8e. Seite kehrt aus dem Zwischenspeicher zurück (A4) ─────────────
console.log('▶ Rückkehr aus dem Vor-/Zurück-Zwischenspeicher');
{
  const { profil, a, b } = zweiTabs();
  profil.zurueckhalten = true; // B ist eingefroren: Ereignisse kommen nicht an
  a.aendern(setze(P1));
  profil.verwerfen(); // … und gehen verloren, statt später zugestellt zu werden
  profil.zurueckhalten = false;
  check('Eingefroren verpasst B den fremden Stand (0 Übernahmen)', b.fremdUebernahmen === 0);
  const uebernommen = b.speicher.abgleichen();
  check('abgleichen() bei der Rückkehr (pageshow persisted) holt ihn nach: 1 Übernahme, 4 Platzierungen mit P1', uebernommen && b.fremdUebernahmen === 1 && anzahl(b.layout) === 4 && hat(b.layout, P1), `Übernahmen=${b.fremdUebernahmen}`);
  check('… und ist danach idempotent (zweites abgleichen(): nichts)', b.speicher.abgleichen() === false && b.fremdUebernahmen === 1);
  check('Der Speicher ist bei bfcache-Rückkehr NICHT geschlossen (pagehide schliesst nur bei !persisted): ein späteres Ereignis kommt an', (() => { a.aendern(setze(P2)); return b.fremdUebernahmen === 2 && hat(b.layout, P2); })());
}

// ── 8f. Ersetzen des Entwurfs beim Start: wann ein Rückgängig-Schritt (A5) ──
console.log('▶ Start-Abgleich: Schritt vor dem Ersetzen');
{
  const server = { ...basis, name: 'Server-Welt' } as WorldLayout;
  const nurSee = { ...leeresLayout(), lakes: [{ id: 'see-1', x: 100, z: 100, radius: 200, depth: 8 }] } as WorldLayout;
  const nurSeed = { ...leeresLayout(), detailSeed: 'anderer-seed' } as WorldLayout;
  const mitRegion = { ...leeresLayout(), regions: basis.regions.slice(0, 1) } as WorldLayout;
  check('Der Entwurf enthält NUR einen See (keine Region, keine Platzierung): Schritt nötig', brauchtSchrittVorErsetzen(nurSee, server), 'lakes=1');
  check('Der Entwurf weicht nur im detailSeed ab: Schritt nötig', brauchtSchrittVorErsetzen(nurSeed, server));
  check('Der Entwurf hat eine Region: Schritt nötig', brauchtSchrittVorErsetzen(mitRegion, server));
  check('Der Entwurf gleicht dem Serverstand: kein Schritt (nichts geht verloren)', !brauchtSchrittVorErsetzen(server, server));
  check('Der wirklich leere Startzustand: kein Schritt (sonst löschte das erste Strg+Z die Welt)', !brauchtSchrittVorErsetzen(leeresLayout(), server));
  check('Flüsse und Kontinente zählen wie Seen: ein Entwurf nur mit Kontinent braucht einen Schritt', brauchtSchrittVorErsetzen({ ...leeresLayout(), continents: basis.continents.slice(0, 1) } as WorldLayout, server) || basis.continents.length === 0, `Kontinente im Testdokument: ${basis.continents.length}`);
}

/** EIN Editor-Tab im Profil (der Ring liegt im gemeinsamen Speicher: mit zwei Tabs mischten sich ihre Einträge). */
function einTab(opt: { ereignisse?: boolean; kanal?: boolean; ringMax?: number } = {}): { profil: Profil; b: EditorAttrappe } {
  const profil = new Profil();
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  return { profil, b: new EditorAttrappe('tab-b', profil, opt) };
}

// ── 8g. Ring der verdrängten Entwürfe ─────────────────────────────────
console.log('▶ Ring der verdrängten Entwürfe: Regel, Grenzen, Wiederherstellen');
{
  // sollInRing: die ganze Tabelle
  const alleGruende: AbgangsGrund[] = ['redo-eigene-aenderung', 'redo-ersetzt', 'redo-uebernahme', 'uebernahme-ersetzt', 'kappe-undo', 'kappe-redo'];
  const erwartetFremd = (_g: AbgangsGrund): boolean => true;
  const erwartetEigen = (g: AbgangsGrund): boolean => g === 'redo-ersetzt' || g === 'redo-uebernahme' || g === 'uebernahme-ersetzt';
  let regelOk = true;
  for (const g of alleGruende) {
    if (sollInRing(g, 'fremd', false) !== erwartetFremd(g)) regelOk = false;
    if (sollInRing(g, 'eigen', false) !== erwartetEigen(g)) regelOk = false;
    if (sollInRing(g, 'fremd', true) || sollInRing(g, 'eigen', true)) regelOk = false; // abgedeckt: nie
  }
  check('sollInRing: fremde Stände immer; eigene nur bei Übernahme/Import/Laden/Ersetzen (nicht bei eigener Änderung und Kappung); abgedeckte nie (6 Gründe × 2 Herkünfte × 2)', regelOk);

  // SchrittVerlauf meldet, was hinausfällt
  const abgang: string[] = [];
  const hv = new SchrittVerlauf<string>(2, (x, g, b) => abgang.push(`${x}:${g}:${b}`));
  hv.merke('a');
  hv.merke('b');
  hv.merke('c'); // Grenze 2: 'a' fällt
  check('Kappung meldet den hinausgeschobenen Stand: a (kappe-undo, Bezug c)', abgang.join() === 'a:kappe-undo:c', abgang.join());
  abgang.length = 0;
  hv.zurueck('d'); // Wiederherstellen-Stapel: [d]
  hv.merke('e'); // eigene Änderung verwirft d
  check('Eigene Änderung meldet den verworfenen Wiederherstellen-Stand: d (redo-eigene-aenderung, Bezug e)', abgang.join() === 'd:redo-eigene-aenderung:e', abgang.join());
  abgang.length = 0;
  hv.zurueck('f');
  hv.merke('g', true);
  check('Ersetzen (Import/Laden) meldet ihn als redo-ersetzt', abgang.join() === 'f:redo-ersetzt:g', abgang.join());
  abgang.length = 0;
  const hu = new SchrittVerlauf<string>(50, (x, g, b) => abgang.push(`${x}:${g}:${b}`));
  hu.merke('a');
  hu.zurueck('b');
  hu.uebernahme('a', 'F1'); // verwirft 'b', legt 'a' ab
  hu.uebernahme('F1', 'F2'); // Flag gesetzt: F1 wird nur angezeigt, in keinem Stapel → fällt von der Anzeige
  check('Übernahme meldet den verworfenen Ast (b: redo-uebernahme, Bezug F1) und den ersetzten angezeigten Stand (F1: uebernahme-ersetzt, Bezug F2)', abgang.join() === 'b:redo-uebernahme:F1,F1:uebernahme-ersetzt:F2', abgang.join());
  check('enthaelt() findet Stände in beiden Stapeln', hv.enthaelt((x) => x === 'g') && hv.enthaelt((x) => x === 'b') && !hv.enthaelt((x) => x === 'zzz'));

  // enthaelt() auf Layouts
  const l1 = layoutMitPlatzierung(basis, 'Beech1', 100, 100, 0);
  const l2 = layoutMitPlatzierung(l1, 'Beech1', 200, 200, 0);
  check('enthaelt: ein Stand mit zusätzlichem Objekt enthält seinen Vorgänger, nicht umgekehrt', enthaelt(l2, l1) && !enthaelt(l1, l2) && enthaelt(l1, l1));
  check('enthaelt: gleiche Regionen/Platzierungen unabhängig von der Reihenfolge; anderer Name oder Seed → nicht enthalten', enthaelt({ ...l2, placements: [...l2.placements!].reverse() } as WorldLayout, l1) && !enthaelt({ ...l2, name: 'anders' } as WorldLayout, l1) && !enthaelt({ ...l2, detailSeed: 'anders' } as WorldLayout, l1));

  // VerdraengtRing: ein Schlüssel je Eintrag — Einträge, Grenzen, Quote
  /** Ein Speicher (Map) mit Ring-Schnittstelle; `gesamt`: Summe aller Schlüssel- und Wertlängen darf das nicht übersteigen. */
  const kv = (gesamt = Infinity): RingSpeicher & { daten: Map<string, string> } => {
    const daten = new Map<string, string>();
    const belegt = (): number => [...daten].reduce((n, [k, v]) => n + k.length + v.length, 0);
    return {
      daten,
      get length() {
        return daten.size;
      },
      key: (i) => [...daten.keys()][i] ?? null,
      getItem: (k) => daten.get(k) ?? null,
      removeItem: (k) => void daten.delete(k),
      setItem: (k, v) => {
        const alt = daten.get(k);
        if (belegt() - (alt === undefined ? 0 : k.length + alt.length) + k.length + v.length > gesamt) throw new Error('QuotaExceededError');
        daten.set(k, v);
      },
    };
  };
  const st = (i: number): WorldLayout => layoutMitPlatzierung(basis, 'Beech1', 500 + i, 500 + i, 0);
  let uhr = 1_800_000_000_000;
  const speicher1 = kv();
  const ring = new VerdraengtRing(speicher1, { jetzt: () => (uhr += 1000), tabId: 'tab-r' });
  check('leerer Ring: keine Einträge', ring.liste().length === 0);
  check('Ablegen: ok, mit Zeit, Herkunft, tabId, Zahlen (Regionen/Platzierungen)', (() => {
    const r = ring.ablegen(st(1), 'fremd', 'redo-uebernahme', 'tab-x');
    const e = ring.liste()[0];
    return r === 'ok' && e !== undefined && e.herkunft === 'fremd' && e.tabId === 'tab-x' && e.zeit > 0 && e.regionen === basis.regions.length && e.platzierungen === 4 && e.grund === 'redo-uebernahme';
  })(), JSON.stringify(ring.liste()[0] && { ...ring.liste()[0], layout: undefined }));
  check('Jeder Eintrag ist ein EIGENER Schlüssel wov-editor-verdraengt:<tabId>:<zeit>:<zähler>; die Kennung enthält die Tab-Kennung', (() => {
    const e = ring.liste()[0]!;
    return [...speicher1.daten.keys()].filter((k) => k.startsWith(VERDRAENGT_PRAEFIX)).length === 1 && speicher1.daten.has(VERDRAENGT_PRAEFIX + e.id) && e.id.startsWith('tab-r:') && /^tab-r:[0-9a-z]+:[0-9a-z]+$/.test(e.id);
  })(), ring.liste()[0]!.id);
  check('derselbe Stand noch einmal: schon-da, kein zweiter Eintrag', ring.ablegen(st(1), 'fremd', 'x') === 'schon-da' && ring.liste().length === 1);
  check('ein Stand, den ein Eintrag schon enthält: schon-da', ring.ablegen(basis, 'eigen', 'x') === 'schon-da' && ring.liste().length === 1);
  for (let i = 2; i <= 7; i++) ring.ablegen(st(i), 'fremd', 'x');
  check('höchstens 5 Einträge: 7 verschiedene → 5, der älteste fällt zuerst (übrig: Stand 3…7), 2 als verworfen gezählt', ring.liste().length === 5 && ring.liste().every((e, i) => hat(e.layout, 503 + i)) && ring.verworfen === 2, `Länge=${ring.liste().length}, verworfen=${ring.verworfen}`);
  const entryBytes = ring.liste()[0]!.groesse;
  const klein = new VerdraengtRing(kv(), { max: 5, maxBytes: Math.floor(entryBytes * 2.5), tabId: 'tab-k' });
  for (let i = 1; i <= 4; i++) klein.ablegen(st(i), 'fremd', 'x');
  check('Byte-Grenze: bei Platz für ~2,5 Einträge bleiben höchstens 2, die neuesten (verworfen: 2)', klein.liste().length === 2 && hat(klein.liste()[1]!.layout, 504) && hat(klein.liste()[0]!.layout, 503) && klein.verworfen === 2, `Länge=${klein.liste().length}, verworfen=${klein.verworfen}`);
  check('Ein Stand, der allein die Byte-Grenze sprengt: voll, Ring unverändert leer', new VerdraengtRing(kv(), { maxBytes: 100 }).ablegen(st(1), 'fremd', 'x') === 'voll');
  const eng = new VerdraengtRing(kv(Math.floor(entryBytes * 2.2)), { tabId: 'tab-e' });
  eng.ablegen(st(1), 'fremd', 'x');
  eng.ablegen(st(2), 'fremd', 'x');
  const rQ = eng.ablegen(st(3), 'fremd', 'x');
  check('Quote (Gesamtspeicher für ~2,2 Einträge): der älteste wird geopfert, der neue kommt hinein (ok, ≤ 2 Einträge, der neueste ist da)', rQ === 'ok' && eng.liste().length <= 2 && hat(eng.liste()[eng.liste().length - 1]!.layout, 503) && eng.verworfen >= 1, `${rQ}, Länge=${eng.liste().length}`);
  check('Quote: passt nicht einmal ein Eintrag: voll (der Editor meldet es), kein Wurf', new VerdraengtRing(kv(50)).ablegen(st(1), 'fremd', 'x') === 'voll');
  const kaputt = kv();
  kaputt.daten.set(VERDRAENGT_PRAEFIX + 'tab-z:1:0', '{kaputt');
  kaputt.daten.set('wov-editor-verdraengt', '[{"alt":"Sammelschlüssel der Vorgängerfassung"}]');
  kaputt.daten.set('anderer-schluessel', 'x');
  const rk = new VerdraengtRing(kaputt);
  check('Beschädigter Eintrag und fremde Schlüssel (auch der alte Sammelschlüssel) werden übersprungen; Ablegen geht trotzdem', rk.liste().length === 0 && rk.ablegen(st(1), 'fremd', 'x') === 'ok' && rk.liste().length === 1 && kaputt.daten.has('anderer-schluessel'));
  const eid = ring.liste()[0]!.id;
  const vorher = ring.liste().length;
  ring.entfernen(eid);
  check('Entfernen wirkt auf genau EINEN Schlüssel: Eintrag weg, die anderen bleiben', !ring.liste().some((e) => e.id === eid) && ring.liste().length === vorher - 1 && !speicher1.daten.has(VERDRAENGT_PRAEFIX + eid));
  check('aeltestenEntfernen(): entfernt den ältesten, liefert false bei leerem Ring', (() => {
    const r = new VerdraengtRing(kv(), { tabId: 'tab-a' });
    r.ablegen(st(1), 'fremd', 'x');
    r.ablegen(st(2), 'fremd', 'x');
    const erster = r.aeltestenEntfernen();
    const rest = r.liste();
    const zweiter = r.aeltestenEntfernen();
    return erster && rest.length === 1 && hat(rest[0]!.layout, 502) && zweiter && !r.aeltestenEntfernen();
  })());

  // Zwei Tabs, ein Ring
  const zweiRinge = (uhrFest: number | null = 1_800_000_000_000): { kv: RingSpeicher & { daten: Map<string, string> }; a: VerdraengtRing; b: VerdraengtRing } => {
    const k = kv();
    return { kv: k, a: new VerdraengtRing(k, { tabId: 'tab-A', jetzt: () => uhrFest ?? Date.now(), max: 100 }), b: new VerdraengtRing(k, { tabId: 'tab-B', jetzt: () => uhrFest ?? Date.now(), max: 100 }) };
  };
  {
    // Zwei Tabs, GLEICHE Zeit (dieselbe Millisekunde): verschiedene Kennungen, „entfernen“ löscht nur einen
    const { a, b } = zweiRinge();
    a.ablegen(st(1), 'fremd', 'x');
    b.ablegen(st(2), 'fremd', 'x');
    const ia = a.liste().find((e) => hat(e.layout, 501))!.id;
    const ib = a.liste().find((e) => hat(e.layout, 502))!.id;
    check('Zwei Tabs, gleiche Zeit und gleicher Zählerstand: verschiedene Kennungen (tab-A:…, tab-B:…)', ia !== ib && ia.startsWith('tab-A:') && ib.startsWith('tab-B:'), `${ia} / ${ib}`);
    a.entfernen(ia);
    check('„entfernen“ des Eintrags von Tab A löscht NUR diesen: der von Tab B bleibt (in beiden Sichten)', a.liste().length === 1 && b.liste().length === 1 && hat(b.liste()[0]!.layout, 502));
  }
  {
    // Der verschränkte Zeuge des Angriffs: Tab B legt zwischen dem Lesen und dem Schreiben von Tab A ab.
    const { kv: k, a, b } = zweiRinge();
    let eingeschoben = false;
    const echtesSet = k.setItem;
    k.setItem = (key, v) => {
      // Genau der Augenblick zwischen dem Lesen und dem Schreiben von Tab A: Tab B legt jetzt ab.
      if (!eingeschoben && key.includes('tab-A')) {
        eingeschoben = true;
        b.ablegen(st(2), 'fremd', 'b-zwischendurch');
      }
      echtesSet(key, v);
    };
    const rA = a.ablegen(st(1), 'fremd', 'a');
    k.setItem = echtesSet;
    check('Verschränkt (B legt ab, während A zwischen Lesen und Schreiben steht): beide Einträge bleiben, in beiden Sichten, beide Ablagen ok', eingeschoben && rA === 'ok' && a.liste().some((e) => hat(e.layout, 501)) && a.liste().some((e) => hat(e.layout, 502)) && b.liste().length === 2 && a.liste().length === 2, `A sieht ${a.liste().length}, B sieht ${b.liste().length}`);
  }
  {
    // Erschöpfend: alle Folgen bis Länge 6 über {A legt ab, B legt ab, A entfernt (ihren ältesten sichtbaren), B entfernt (den neuesten sichtbaren)}, gleiche Zeit
    let folgen = 0;
    let verstoesse = 0;
    let kuerzeste: string | null = null;
    const ops = ['A+', 'B+', 'A-', 'B-'] as const;
    const durchlaufen = (folge: (typeof ops)[number][]): void => {
      const { a, b } = zweiRinge();
      const modell = new Set<string>();
      let n = 0;
      let ok = true;
      for (const op of folge) {
        if (op === 'A+' || op === 'B+') {
          const r = (op === 'A+' ? a : b);
          const vorher = new Set(r.liste().map((e) => e.id));
          const res = r.ablegen(st(100 + n++), 'fremd', op);
          const neu = r.liste().filter((e) => !vorher.has(e.id));
          if (res !== 'ok' || neu.length !== 1) ok = false;
          else modell.add(neu[0]!.id);
        } else {
          const r = op === 'A-' ? a : b;
          const l = r.liste();
          const e = op === 'A-' ? l[0] : l[l.length - 1];
          if (e) {
            r.entfernen(e.id);
            modell.delete(e.id);
          }
        }
        const sichtA = a.liste().map((e) => e.id).sort().join();
        const sichtB = b.liste().map((e) => e.id).sort().join();
        if (sichtA !== [...modell].sort().join() || sichtB !== sichtA) ok = false;
      }
      folgen++;
      if (!ok) {
        verstoesse++;
        if (kuerzeste === null || folge.length < kuerzeste.split(' ').length) kuerzeste = folge.join(' ');
      }
    };
    const rec = (f: (typeof ops)[number][]): void => {
      if (f.length > 0) durchlaufen(f);
      if (f.length === 6) return;
      for (const o of ops) rec([...f, o]);
    };
    rec([]);
    check(`Zwei Tabs am selben Ring, alle Folgen bis Länge 6 über {A legt ab, B legt ab, A entfernt, B entfernt}: ${folgen} Folgen, ${verstoesse} Verstöße (Ring-Inhalt = Modell, beide Sichten gleich, jede Ablage ok)`, folgen === 5460 && verstoesse === 0, kuerzeste ?? 'keine');
  }
}

{
  // Der Zeuge des Angriffs: eigen → Testflug T1 → Strg+Z → Testflug T2 — T1 liegt im Ring und lässt sich wieder einsetzen.
  const T = (l: WorldLayout, x: number): WorldLayout => layoutMitPlatzierung(l, 'Beech1', x, x, 1);
  const { profil, b } = einTab();
  b.aendern(setze(P1)); // eigene Änderung
  profil.testflugSchreibt(T(gespeichert(profil)!, 3101)); // Testflug: T1 (liest den Speicher, hängt an)
  const t1Stand = b.layout;
  check('Nach T1: der Editor zeigt T1 (Übernahme), Ring noch leer', hat(b.layout, 3101) && b.ring.liste().length === 0);
  b.rueckgaengig(); // Strg+Z: zurück auf den eigenen Stand, T1 liegt im Wiederherstellen-Stapel
  check('Nach Strg+Z: eigener Stand angezeigt, T1 im Wiederherstellen-Stapel (1 Eintrag)', !hat(b.layout, 3101) && b.zukunft.length === 1 && hat(b.zukunft[0]!, 3101));
  profil.testflugSchreibt(T(gespeichert(profil)!, 3102)); // Testflug: T2 — baut auf dem Speicher auf, der T1 NICHT enthält
  check('Nach T2: T1 ist weder im Speicher noch angezeigt noch in Rückgängig/Wiederherstellen …', !hat(gespeichert(profil), 3101) && !hat(b.layout, 3101) && !b.vergangenheit.concat(b.zukunft).some((x) => hat(x, 3101)));
  check('… aber im Ring (1 Eintrag, Herkunft fremd, mit Zahlen)', b.ring.liste().length === 1 && hat(b.ring.liste()[0]!.layout, 3101) && b.ring.liste()[0]!.herkunft === 'fremd' && b.ring.liste()[0]!.platzierungen === anzahl(t1Stand), JSON.stringify(b.ring.liste().map((e) => [e.herkunft, e.regionen, e.platzierungen, e.grund])));
  check('Die Meldung der Übernahme nennt den Ring', b.meldungsVerlauf[b.meldungsVerlauf.length - 1]!.includes('gesichert'), b.meldungsVerlauf[b.meldungsVerlauf.length - 1]);
  // Wieder einsetzen = eigene Änderung mit Undo-Schritt
  const vorEinsetzen = b.layout;
  const e0 = b.ring.liste()[0]!;
  const schritteVor = b.vergangenheit.length;
  b.ersetzen(e0.layout);
  check('Wieder einsetzen: der Stand ist da (T1), der vorige liegt unter Rückgängig, der Speicher zieht mit', hat(b.layout, 3101) && b.vergangenheit.length === schritteVor + 1 && b.vergangenheit[b.vergangenheit.length - 1] === vorEinsetzen && hat(gespeichert(profil), 3101));
  b.rueckgaengig();
  check('… und Strg+Z macht es rückgängig (T2-Stand wieder da)', !hat(b.layout, 3101) && hat(b.layout, 3102));
}
{
  // A5 belegt: eigen → Strg+Z → Serverstand laden — der eigene Stand im Wiederherstellen-Stapel geht in den Ring (verlustfrei).
  const { profil, b: a } = einTab();
  a.aendern(setze(P1));
  a.rueckgaengig(); // eigener Stand P1 liegt im Wiederherstellen-Stapel
  const server = { ...basis, name: 'Server-Welt' } as WorldLayout;
  a.serverstandLaden(server);
  check('Laden leert den Wiederherstellen-Stapel …', a.zukunft.length === 0);
  check('… aber der eigene Stand (P1) liegt jetzt im Ring: nichts geht verloren', a.ring.liste().length === 1 && hat(a.ring.liste()[0]!.layout, P1) && a.ring.liste()[0]!.herkunft === 'eigen', JSON.stringify(a.ring.liste().map((e) => [e.herkunft, e.grund])));
  check('Und der Serverstand ist wirklich geladen (Meldung „Serverstand geladen“)', a.layout === server && a.meldungsVerlauf[a.meldungsVerlauf.length - 1] === 'Serverstand geladen');
  void profil;
}
{
  // Sicherheitsnetz (a): ein fremder Stand wird im Speicher ersetzt, ohne dass ein Stapel ihn hält.
  const { profil, b } = einTab();
  profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', 3201, 3201, 1)); // wird übernommen (angezeigt)
  check('Ausgangslage: fremder Stand angezeigt, Stapel hält den davor', hat(b.layout, 3201));
  // Der Editor ersetzt den Stand OHNE Schritt (ein Fehler des Aufrufers): das Netz sichert den fremden Stand.
  b.layout = layoutMitPlatzierung(basis, 'Beech1', 4444, 4444, 1);
  b.speicher.schreiben(b.layout, 'bearbeitet', 'dev');
  check('Sicherheitsnetz: der ersetzte fremde Stand (3201) liegt im Ring, obwohl in keinem Stapel', b.ring.liste().some((e) => hat(e.layout, 3201)) && !b.vergangenheit.concat(b.zukunft).some((x) => hat(x, 3201)), JSON.stringify(b.ring.liste().map((e) => e.grund)));
  // …und schweigt, wenn der Stand erreichbar ist (kein Ring-Lärm bei normalem Weiterarbeiten)
  const z = einTab();
  z.profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', 3301, 3301, 1));
  z.b.aendern(setze(P2)); // eigene Änderung auf dem fremden Stand: der liegt im Rückgängig-Stapel
  check('Weiterarbeiten auf einem fremden Stand: kein Ring-Eintrag (er liegt im Rückgängig-Stapel)', z.b.ring.liste().length === 0);
}

// ── 8h. Meldungsreihenfolge (A2) ───────────────────────────────────────
console.log('▶ Meldungen: die des Riegels wird nicht überschrieben');
{
  // Ereignis bleibt aus (Tab im Hintergrund): der Schreibversuch beim Strg+Z findet den fremden Stand.
  const { profil, b } = zweiTabs({ ereignisse: false, kanal: false });
  b.aendern(setze(P1));
  b.aendern(setze(P2));
  profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(profil)!, 'Beech1', 3401, 3401, 1)); // unbemerkt
  b.rueckgaengig(); // Strg+Z → Schreibversuch findet T1 → Übernahme
  const letzte = b.meldungsVerlauf[b.meldungsVerlauf.length - 1]!;
  check('Strg+Z über einem unbemerkten fremden Stand: die LETZTE Meldung ist die der Übernahme, nicht „Rückgängig …“', letzte.startsWith('Entwurf aus einem anderen Tab übernommen') && !b.meldungsVerlauf.some((m) => m.startsWith('Rückgängig')), b.meldungsVerlauf.join(' | '));
  check('Angezeigt wird der fremde Stand (T1), und der Undo-Zug steht unter Rückgängig', hat(b.layout, 3401));
  const w = zweiTabs({ ereignisse: false, kanal: false });
  w.b.aendern(setze(P1));
  w.b.rueckgaengig();
  w.profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(w.profil)!, 'Beech1', 3402, 3402, 1));
  w.b.wiederherstellen();
  check('Strg+Y über einem unbemerkten fremden Stand: keine Meldung „Wiederhergestellt“, die Übernahme steht da', !w.b.meldungsVerlauf.includes('Wiederhergestellt') && w.b.meldungsVerlauf[w.b.meldungsVerlauf.length - 1]!.startsWith('Entwurf aus einem anderen Tab übernommen'), w.b.meldungsVerlauf.join(' | '));
  // W7: „Serverstand geladen" nur, wenn er wirklich geladen wurde
  const l = zweiTabs({ ereignisse: false, kanal: false });
  l.b.aendern(setze(P1));
  l.profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(l.profil)!, 'Beech1', 3403, 3403, 1)); // unbemerkt
  const server = { ...basis, name: 'Server-Welt' } as WorldLayout;
  l.b.serverstandLaden(server);
  const m = l.b.meldungsVerlauf[l.b.meldungsVerlauf.length - 1]!;
  check('Serverstand laden über einem unbemerkten fremden Stand: die Meldung sagt „NICHT geladen“ (nicht „geladen“)', m.startsWith('Serverstand NICHT geladen') && !l.b.meldungsVerlauf.includes('Serverstand geladen'), m);
  check('… und angezeigt wird der fremde Stand (3403), nicht der Serverstand', hat(l.b.layout, 3403) && l.b.layout !== server);
  // Normalfall bleibt unverändert
  const n = zweiTabs();
  n.b.aendern(setze(P1));
  n.b.rueckgaengig();
  check('Normalfall ohne fremden Stand: „Rückgängig (…)“ wie bisher', n.b.meldungsVerlauf[n.b.meldungsVerlauf.length - 1]!.startsWith('Rückgängig'));
}

// ── 8i. Abgleich mit EINEM Zugriff (A3, Zeuge W8) ───────────────────────
console.log('▶ Abgleich: kein Rennen zwischen Nachsehen und Lesen');
{
  /** Ein Speicher, der genau nach dem ERSTEN Lesen des Entwurfs einen fremden Schreibvorgang einschiebt (zwei Prozesse, ein localStorage). */
  const rennen = () => {
    const profil = new Profil();
    profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
    let liest = 0;
    let scharf = false;
    const F = layoutMitPlatzierung(basis, 'Beech1', 101, 101, 1);
    const roh: KvSpeicher = {
      getItem: (k) => {
        const v = profil.getItem(k);
        // der fremde Schreibvorgang fällt unmittelbar nach dem ersten Lesen, seit der Start-Lauf vorbei ist
        if (k === ENTWURF_KEY && scharf && ++liest === 1) profil.daten.set(ENTWURF_KEY, JSON.stringify(F));
        return v;
      },
      setItem: (k, v) => profil.setItem(null, k, v),
    };
    let layout: WorldLayout = basis;
    let uebernommen = 0;
    const s = new EntwurfsSpeicher({
      speicher: roh,
      aktuell: () => layout,
      beiFremdem: (f) => {
        layout = f;
        uebernommen++;
      },
    });
    s.lesen(); // Start: layout = basis
    scharf = true;
    return { profil, s, get layout() { return layout; }, set layout(l: WorldLayout) { layout = l; }, uebernommen: () => uebernommen, F };
  };
  // ALTER Weg: abgleichen() (1. Lesen), fremder Schreibvorgang, lesen() (2. Lesen) — bekannt = F, aber nie übernommen
  const alt = rennen();
  alt.s.abgleichen();
  const gelesen = alt.s.lesen();
  const rueckAlt = alt.s.schreiben(alt.layout, 'server', 'dev');
  check('Alter Weg (abgleichen() dann lesen()): der fremde Entwurf wird gelesen, aber nie übernommen — und beim nächsten Schreiben still überschrieben (der Fehler)', hat(gelesen, 101) && alt.uebernommen() === 0 && rueckAlt === 'ok' && !hat(gespeichert(alt.profil), 101), `Ergebnis=${rueckAlt}, übernommen=${alt.uebernommen()}`);
  // NEUER Weg: entwurfNachAbgleich() liest EINMAL; der fremde Schreibvorgang danach wird vom Riegel übernommen
  const neu = rennen();
  const entwurf = neu.s.entwurfNachAbgleich();
  check('Neuer Weg: entwurfNachAbgleich() liest einmal (der Entwurf davor, die Basis)', !hat(entwurf, 101) && entwurf !== null);
  const rueckNeu = neu.s.schreiben(neu.layout, 'server', 'dev');
  check('… der Schreibversuch danach findet den fremden Stand: fremd (übernommen), NICHT überschrieben', rueckNeu === 'fremd' && neu.uebernommen() === 1 && hat(gespeichert(neu.profil), 101) && hat(neu.layout, 101), `Ergebnis=${rueckNeu}, übernommen=${neu.uebernommen()}`);
  // Und ohne Rennen liefert entwurfNachAbgleich() den fremden Stand UND übernimmt ihn — die angezeigte Gegenüberstellung passt zur Wirkung
  const { profil, b } = zweiTabs({ ereignisse: false, kanal: false });
  profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', 3501, 3501, 1));
  const e2 = b.speicher.entwurfNachAbgleich();
  check('Kein Rennen: entwurfNachAbgleich() übernimmt den fremden Stand und liefert genau ihn (Anzeige = Vergleichsstand)', hat(e2, 3501) && hat(b.layout, 3501) && b.fremdUebernahmen === 1);
  check('lesen() setzt bekannt nur für den Start: nach entwurfNachAbgleich() ist ein zweites Nachsehen still (kein zweiter Fund)', b.speicher.abgleichen() === false && b.fremdUebernahmen === 1);
}

// ── 8j. enthaelt(): Z-Reihenfolge und Doppelte (B4) ─────────────────────
console.log('▶ enthaelt: Regionen als geordnete Folge, Listen als Multimenge');
{
  const ra = { ...basis.regions[0]!, id: 'reg-a' };
  const rb = { ...basis.regions[0]!, id: 'reg-b' };
  const rc = { ...basis.regions[0]!, id: 'reg-c' };
  const mit = (regions: typeof ra[]): WorldLayout => ({ ...basis, regions }) as WorldLayout;
  check('Der Zeuge des Angriffs: Regionen [a,b] vs [b,a] (andere Z-Ordnung) → NICHT enthalten, in beiden Richtungen', !enthaelt(mit([ra, rb]), mit([rb, ra])) && !enthaelt(mit([rb, ra]), mit([ra, rb])));
  check('Gleiche Reihenfolge: [a,b] enthält [a,b], [a] und [b]; [a,c,b] enthält [a,b] (dazwischen darf anderes stehen)', enthaelt(mit([ra, rb]), mit([ra, rb])) && enthaelt(mit([ra, rb]), mit([ra])) && enthaelt(mit([ra, rb]), mit([rb])) && enthaelt(mit([ra, rc, rb]), mit([ra, rb])));
  check('Reihenfolge ohne Lücke geprüft: [a,c,b] enthält [b,a] nicht; [a] enthält [a,b] nicht (Element fehlt)', !enthaelt(mit([ra, rc, rb]), mit([rb, ra])) && !enthaelt(mit([ra]), mit([ra, rb])));
  const P = { prefab: 'Beech1', x: 100, z: 100, yaw: 0 };
  const mitP = (placements: (typeof P)[]): WorldLayout => ({ ...basis, placements }) as WorldLayout;
  check('Multimenge: [P] enthält [P,P] NICHT (Doppelte zählen), [P,P] enthält [P] und [P,P]', !enthaelt(mitP([P]), mitP([P, P])) && enthaelt(mitP([P, P]), mitP([P])) && enthaelt(mitP([P, P]), mitP([P, P])));
  check('Multimenge unabhängig von der Reihenfolge: [P,Q] enthält [Q,P]', enthaelt(mitP([P, { ...P, x: 200 }]), mitP([{ ...P, x: 200 }, P])));
  check('Ein Stand, der nur die Z-Ordnung ändert, wird gesichert: der Ring bekommt ihn (Editor-Zeuge: F1 = [a,b] angezeigt, F2 = [b,a] kommt)', (() => {
    const { profil, b } = einTab();
    profil.testflugSchreibt(mit([ra, rb]));
    profil.testflugSchreibt(mit([rb, ra]));
    return b.ring.liste().some((e) => e.layout.regions.map((r) => r.id).join() === 'reg-a,reg-b');
  })());
}

// ── 8k. Ring und Quote: der Entwurf hat Vorrang (B1) ────────────────────
console.log('▶ Quote: voller Ring + grosser Entwurf, harte Quote (5 MiB, 2 Byte je Zeichen)');
{
  const QUOTE = 2_621_440; // 5 MiB / 2 Byte je UTF-16-Zeichen
  /** Ein Entwurf mit vielen grossen Regionen, mindestens `ziel` Zeichen als JSON. */
  const gross = (ziel: number, saat: number): WorldLayout => {
    const regionen: WorldLayout['regions'][number][] = [];
    let laenge = JSON.stringify({ ...basis, regions: [], placements: [] }).length;
    let r = 0;
    while (laenge < ziel) {
      // Ein einfacher Vieleck-Umriss (der Sanitizer verwirft entartete Polygone); Mitte und Radius machen jede Region und jeden Stand verschieden.
      const mx = ((saat * 997 + r * 131) % 20000) - 10000;
      const mz = ((saat * 577 + r * 271) % 20000) - 10000;
      const rad = 800 + ((saat * 13 + r * 7) % 400);
      const punkte: [number, number][] = Array.from({ length: 400 }, (_, i) => [Math.round(mx + Math.cos((i / 400) * 2 * Math.PI) * rad), Math.round(mz + Math.sin((i / 400) * 2 * Math.PI) * rad)]);
      const region = { ...basis.regions[0]!, id: `gross-${saat}-${r++}`, shape: { kind: 'polygon', points: punkte } } as WorldLayout['regions'][number];
      regionen.push(region);
      laenge += JSON.stringify(region).length + 1;
    }
    return sanitizeWorldLayout({ ...basis, regions: regionen, placements: [] })!;
  };
  const eintragGroesse = JSON.stringify(gross(190_000, 1)).length;
  check('Testdaten: ein Ring-Stand hat ~190.000 Zeichen, fünf davon ~950.000 (unter der Ring-Grenze von 1.000.000)', eintragGroesse >= 190_000 && eintragGroesse < 200_000, String(eintragGroesse));
  const entwurf = gross(1_300_000, 99);
  check('Testdaten: der grosse Entwurf hat ≥ 1.300.000 Zeichen', JSON.stringify(entwurf).length >= 1_300_000, String(JSON.stringify(entwurf).length));

  const aufbau = (filler: number): { profil: Profil; a: EditorAttrappe } => {
    const profil = new Profil();
    profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
    profil.daten.set('spiel-daten', 'x'.repeat(filler)); // Spielclient, Sitzung, andere Schlüssel desselben Ursprungs
    profil.quotaZeichen = QUOTE;
    const a = new EditorAttrappe('tab-q', profil);
    for (let i = 1; i <= 5; i++) a.ring.ablegen(gross(190_000, i), 'fremd', 'x');
    return { profil, a };
  };
  {
    const { profil, a } = aufbau(500_000);
    const ringVor = a.ring.liste().reduce((n, e) => n + e.groesse, 0);
    const belegtVor = profil.belegt();
    check('Ausgangslage: Ring voll (5 Einträge, ≤ 1.000.000 Zeichen), Speicher belegt ' + belegtVor + ' von ' + QUOTE, a.ring.liste().length === 5 && ringVor <= 1_000_000 && belegtVor < QUOTE, `Ring=${ringVor}`);
    // Ohne Vorrang würde der Entwurf scheitern: Rest = QUOTE − belegt + alter Entwurf < 1,3 Mio.
    const rest = QUOTE - (belegtVor - JSON.stringify(basis).length - ENTWURF_KEY.length);
    check('… und ohne Platzmachen passte der Entwurf NICHT (frei für den Entwurf: ' + rest + ' < ' + JSON.stringify(entwurf).length + ')', rest < JSON.stringify(entwurf).length, String(rest));
    const r = a.aendern(() => entwurf);
    const gespeichertLen = profil.daten.get(ENTWURF_KEY)?.length ?? 0;
    check('Der grosse Entwurf wird GESCHRIEBEN (nicht „voll“), Speicher innerhalb der Quote', r !== 'voll' && gespeichertLen >= 1_300_000 && profil.belegt() <= QUOTE, `Ergebnis=${r}, Entwurf=${gespeichertLen}, belegt=${profil.belegt()}`);
    check('Der Ring wurde gekürzt (weniger als 5 Einträge), genau so viele wie als geopfert gezählt', a.ring.liste().length < 5 && a.ringGeopfert === 5 - a.ring.liste().length && a.ringGeopfert >= 1, `Ring=${a.ring.liste().length}, geopfert=${a.ringGeopfert}`);
    const m = a.meldungsVerlauf[a.meldungsVerlauf.length - 1] ?? '';
    check('Die Meldung stimmt: „Speicher knapp — der Entwurf ist gespeichert“ mit der Zahl der geopferten Ring-Einträge', m.startsWith('Speicher knapp') && m.includes(`${a.ringGeopfert} verdrängte Stände`), m);
    check('Die ÄLTESTEN Einträge gingen zuerst (übrig sind die neuesten)', a.ring.liste().every((e, i, l) => i === 0 || l[i - 1]!.zeit <= e.zeit) && a.ring.liste().every((e) => e.layout.regions.some((x) => /^gross-([3-5])-/.test(x.id)) || a.ringGeopfert < 3));
  }
  {
    const { profil, a } = aufbau(1_500_000); // auch mit leerem Ring passt der Entwurf nicht mehr
    const ringIdsVor = a.ring.liste().map((e) => e.id).join();
    const belegtVor = profil.belegt();
    const r = a.ersetzen(entwurf);
    check('Passt der Entwurf auch OHNE Ring nicht: „voll“, der Ring bleibt UNANGETASTET (5 Einträge, derselbe Inhalt, nichts geopfert), der alte Entwurf steht unverändert', a.ring.liste().length === 5 && a.ring.liste().map((e) => e.id).join() === ringIdsVor && a.ringGeopfert === 0 && (profil.daten.get(ENTWURF_KEY)?.length ?? 0) === JSON.stringify(basis).length && profil.belegt() === belegtVor, `${r}, geopfert=${a.ringGeopfert}, Ring=${a.ring.liste().length}`);
    const m = a.meldungsVerlauf[a.meldungsVerlauf.length - 1] ?? '';
    check('Die Meldung „Entwurf zu groß“ wird von keiner Erfolgsmeldung („Import übernommen“) verdeckt und behauptet KEIN Opfer („Dafür wurden …“)', m.startsWith('Entwurf zu groß') && !m.includes('Dafür wurden') && !a.meldungsVerlauf.includes('Import übernommen'), a.meldungsVerlauf.join(' | '));
    a.serverstandLaden(entwurf);
    check('Serverstand laden über einem zu grossen Entwurf: „Entwurf zu groß“ statt „Serverstand geladen“', a.meldungsVerlauf[a.meldungsVerlauf.length - 1]!.startsWith('Entwurf zu groß') && !a.meldungsVerlauf.includes('Serverstand geladen'), a.meldungsVerlauf[a.meldungsVerlauf.length - 1]);
    // Strg+Z / Strg+Y über „voll“: die Meldung bleibt
    const { profil: p2, a: a2 } = aufbau(1_500_000);
    a2.aendern(setze(P1)); // kleiner Schritt passt
    a2.ersetzen(entwurf); // scheitert
    void p2;
  }
  // Der Ring selbst kann nicht mehr gesichert werden (Quote), im eigenen Änderungspfad: sofort gemeldet
  {
    const { profil, b } = einTab();
    b.aendern(setze(P1));
    profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(profil)!, 'Beech1', 3101, 3101, 1)); // T1 wird übernommen
    b.rueckgaengig();
    // Der Testflug schreibt noch (Quote ohne Grenze für ihn); danach, VOR der Übernahme im Editor, ist der Speicher voll.
    profil.nachNaechstemSchreiben = () => {
      profil.quotaZeichen = profil.belegt() + 20; // kein Platz mehr für einen Ring-Eintrag
    };
    profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(profil)!, 'Beech1', 3102, 3102, 1)); // T2: T1 fällt aus dem Wiederherstellen-Stapel → Ring voll
    check('Ring-Schreiben scheitert (Speicher voll): sofort gemeldet („ACHTUNG … NICHT gesichert“), gezählt, kein Wurf', b.ringVoll === 1 && b.meldungsVerlauf.some((m) => m.startsWith('ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden')), b.meldungsVerlauf.join(' | '));
  }
}

// ── 8l. Ring-Grenze: der älteste fällt MIT Meldung heraus (B6) ──────────
console.log('▶ Ring-Grenze mit Meldung');
{
  const T = (l: WorldLayout, x: number): WorldLayout => layoutMitPlatzierung(l, 'Beech1', x, x, 1);
  const { profil, b } = einTab({ ringMax: 1 });
  b.aendern(setze(P1));
  profil.testflugSchreibt(T(gespeichert(profil)!, 3101));
  b.rueckgaengig();
  profil.testflugSchreibt(T(gespeichert(profil)!, 3102)); // T1 → Ring (1 Eintrag)
  const m1 = b.meldungsVerlauf[b.meldungsVerlauf.length - 1]!;
  b.rueckgaengig();
  profil.testflugSchreibt(T(gespeichert(profil)!, 3103)); // der Stand mit T2 → Ring, Grenze 1: T1 fällt
  const m2 = b.meldungsVerlauf[b.meldungsVerlauf.length - 1]!;
  check('Erster Ring-Eintrag: gesichert, keine Verwerfen-Meldung', m1.includes('gesichert') && !m1.includes('Ältester') && b.ringVerworfen === 0 || b.ring.liste().length === 1, m1);
  check('Zweiter Eintrag über der Grenze: der älteste (T1) fällt heraus und die Meldung SAGT es („Ältester verdrängter Entwurf verworfen“)', b.ringVerworfen === 1 && m2.includes('Ältester verdrängter Entwurf verworfen') && b.ring.liste().length === 1 && !b.ring.liste().some((e) => hat(e.layout, 3101)), m2);
}

// ── 8m. Start-Abgleich: Grund statt „gemeldet“ (N1) ─────────────────────
console.log('▶ Serverstand laden: nur bei übernommenem fremdem Stand „NICHT geladen“');
{
  check('serverstandFolge: ok → geladen, fremd → nicht-geladen, voll und knapp → stehen-lassen', serverstandFolge('ok') === 'geladen' && serverstandFolge('fremd') === 'nicht-geladen' && serverstandFolge('voll') === 'stehen-lassen' && serverstandFolge('knapp') === 'stehen-lassen');
  check('speicherGrund aus Ergebnis und geopferten Ring-Einträgen: fremd/voll gewinnen, geopfert > 0 → knapp, sonst ok (auch ohne-zettel)', speicherGrund('fremd', 3) === 'fremd' && speicherGrund('voll', 2) === 'voll' && speicherGrund('ok', 1) === 'knapp' && speicherGrund('ohne-zettel', 1) === 'knapp' && speicherGrund('ok', 0) === 'ok' && speicherGrund('ohne-zettel', 0) === 'ok');
  // Der Fehler von 6bdb8f0, als Zeuge: dort galt JEDE gemeldete Meldung als „fremder Stand übernommen“.
  const alteEntscheidung = (gemeldet: boolean): string => (gemeldet ? 'nicht-geladen' : 'geladen');
  check('Zeuge des Fehlers: nach der alten Boolean-Regel hieße „voll“ und „knapp“ fälschlich „nicht-geladen“ (ein anderer Tab war nicht beteiligt)', alteEntscheidung(speicherGrund('voll', 0) !== 'ok') === 'nicht-geladen' && alteEntscheidung(speicherGrund('ok', 2) !== 'ok') === 'nicht-geladen' && serverstandFolge(speicherGrund('voll', 0)) !== 'nicht-geladen' && serverstandFolge(speicherGrund('ok', 2)) !== 'nicht-geladen');

  const QUOTE = 2_621_440;
  const gross = (ziel: number, saat: number): WorldLayout => {
    const regionen: WorldLayout['regions'][number][] = [];
    let laenge = JSON.stringify({ ...basis, regions: [], placements: [] }).length;
    let r = 0;
    while (laenge < ziel) {
      const mx = ((saat * 997 + r * 131) % 20000) - 10000;
      const mz = ((saat * 577 + r * 271) % 20000) - 10000;
      const rad = 800 + ((saat * 13 + r * 7) % 400);
      const punkte: [number, number][] = Array.from({ length: 400 }, (_, i) => [Math.round(mx + Math.cos((i / 400) * 2 * Math.PI) * rad), Math.round(mz + Math.sin((i / 400) * 2 * Math.PI) * rad)]);
      const region = { ...basis.regions[0]!, id: `gross-${saat}-${r++}`, shape: { kind: 'polygon', points: punkte } } as WorldLayout['regions'][number];
      regionen.push(region);
      laenge += JSON.stringify(region).length + 1;
    }
    return sanitizeWorldLayout({ ...basis, regions: regionen, placements: [] })!;
  };
  const entwurf = gross(1_300_000, 99);
  const aufbau = (filler: number, ringEintraege: number): { profil: Profil; a: EditorAttrappe } => {
    const profil = new Profil();
    profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
    profil.daten.set('spiel-daten', 'x'.repeat(filler));
    profil.quotaZeichen = QUOTE;
    const a = new EditorAttrappe('tab-n1', profil);
    for (let i = 1; i <= ringEintraege; i++) a.ring.ablegen(gross(190_000, i), 'fremd', 'x');
    return { profil, a };
  };
  {
    // 'voll': der Serverstand passt nicht, auch nicht ohne Ring; KEIN anderer Tab beteiligt
    const { a } = aufbau(1_500_000, 0);
    a.serverstandLaden(entwurf);
    const m = a.meldungsVerlauf;
    check('Serverstand laden, Entwurf zu gross (voll): die Meldung „Entwurf zu groß“ steht; KEINE „NICHT geladen“-Behauptung über einen anderen Tab, kein „geladen“', m.length === 1 && m[0]!.startsWith('Entwurf zu groß') && !m.some((x) => x.includes('NICHT geladen')) && !m.includes('Serverstand geladen') && a.fremdUebernahmen === 0, m.join(' | '));
  }
  {
    // 'knapp': der Serverstand passt nur nach einem Ring-Opfer
    const { a } = aufbau(500_000, 5);
    a.serverstandLaden(entwurf);
    const m = a.meldungsVerlauf;
    check('Serverstand laden, passt nur nach Ring-Opfer (knapp): „Speicher knapp“ steht; keine „NICHT geladen“-Behauptung, kein „geladen“ darüber', m.length === 1 && m[0]!.startsWith('Speicher knapp') && !m.some((x) => x.includes('NICHT geladen')) && a.ringGeopfert >= 1 && a.fremdUebernahmen === 0, m.join(' | '));
  }
  {
    // 'fremd': ein anderer Tab hat den Entwurf geändert (Ereignis bleibt aus) — nur dann „NICHT geladen“
    const { profil, b } = einTab({ ereignisse: false, kanal: false });
    b.aendern(setze(P1));
    profil.testflugSchreibt(layoutMitPlatzierung(gespeichert(profil)!, 'Beech1', 3601, 3601, 1));
    b.serverstandLaden({ ...basis, name: 'Server-Welt' } as WorldLayout);
    check('Serverstand laden über einem unbemerkten fremden Stand (fremd): „NICHT geladen“ (und die Übernahme-Meldung davor), kein „geladen“', b.meldungsVerlauf.some((x) => x.startsWith('Serverstand NICHT geladen')) && !b.meldungsVerlauf.includes('Serverstand geladen') && b.fremdUebernahmen === 1, b.meldungsVerlauf.join(' | '));
    const n = einTab();
    n.b.serverstandLaden({ ...basis, name: 'Server-Welt' } as WorldLayout);
    check('Normalfall (ok): „Serverstand geladen“', n.b.meldungsVerlauf[n.b.meldungsVerlauf.length - 1] === 'Serverstand geladen');
  }
}

// ── 8n. Der Entwurfs-Vorrang opfert nur, wenn es den Entwurf rettet (N2) ──
console.log('▶ Ring-Opfer nur, wenn der Entwurf danach passt');
{
  const st = (i: number): WorldLayout => layoutMitPlatzierung(basis, 'Beech1', 500 + i, 500 + i, 0);
  const kvG = (gesamt: number): RingSpeicher & { daten: Map<string, string> } => {
    const daten = new Map<string, string>();
    const belegt = (): number => [...daten].reduce((n, [k, v]) => n + k.length + v.length, 0);
    return {
      daten,
      get length() {
        return daten.size;
      },
      key: (i) => [...daten.keys()][i] ?? null,
      getItem: (k) => daten.get(k) ?? null,
      removeItem: (k) => void daten.delete(k),
      setItem: (k, v) => {
        const alt = daten.get(k);
        if (belegt() - (alt === undefined ? 0 : k.length + alt.length) + k.length + v.length > gesamt) throw new Error('QuotaExceededError');
        daten.set(k, v);
      },
    };
  };
  {
    // Ring-Ebene: aeltestenEntfernen vorläufig, opferAbschliessen(false) gibt zurück, (true) behält
    const r = new VerdraengtRing(kvG(Infinity), { tabId: 'tab-o' });
    for (let i = 1; i <= 3; i++) r.ablegen(st(i), 'fremd', 'x');
    const vorher = r.liste().map((e) => e.id).join();
    r.aeltestenEntfernen();
    r.aeltestenEntfernen();
    check('Nach zwei vorläufigen Opfern fehlen zwei Einträge', r.liste().length === 1);
    check('opferAbschliessen(false): die zwei Einträge sind zurück (gleiche Ids, gleicher Inhalt), Ergebnis 0', r.opferAbschliessen(false) === 0 && r.liste().map((e) => e.id).join() === vorher);
    r.aeltestenEntfernen();
    check('opferAbschliessen(true): der Eintrag bleibt weg, Ergebnis 1 (gezählt)', r.opferAbschliessen(true) === 1 && r.liste().length === 2 && r.opferAbschliessen(true) === 0);
  }
  {
    // ablegen: passt der NEUE Ring-Eintrag auch nach dem Opfern aller älteren nicht, bleiben die älteren
    const messen = new VerdraengtRing(kvG(Infinity), { tabId: 'tab-m' });
    messen.ablegen(st(1), 'fremd', 'x');
    const groesse = messen.liste()[0]!.groesse;
    const k = kvG(Math.floor(groesse * 1.5)); // Platz für 1 Eintrag, nicht für 2
    const r = new VerdraengtRing(k, { tabId: 'tab-m' });
    r.ablegen(st(1), 'fremd', 'x');
    const vorher = r.liste().map((e) => e.id).join();
    // ein Eintrag, der allein nicht in den Speicher passt
    const riesig = layoutMitPlatzierung(st(2), 'Beech1', 900, 900, 0);
    const kleinerK = kvG(groesse + 30);
    const r2 = new VerdraengtRing(kleinerK, { tabId: 'tab-m', maxBytes: 1_000_000 });
    r2.ablegen(st(1), 'fremd', 'x');
    const vorher2 = r2.liste().map((e) => e.id).join();
    const res = r2.ablegen(riesig, 'fremd', 'x');
    check('Ring-Ablegen: passt der neue Eintrag auch nach dem Opfern der älteren nicht, bleiben die älteren stehen (voll, nichts als verworfen gezählt)', res === 'voll' && r2.liste().map((e) => e.id).join() === vorher2 && r2.verworfen === 0, `${res}, verworfen=${r2.verworfen}`);
    // gemeinter Fall: passt nach dem Opfern des älteren, wird geopfert und gezählt
    const ok = r.ablegen(st(3), 'fremd', 'x');
    check('Gemeinter Fall bleibt: passt der neue Eintrag nach dem Opfern des älteren, wird geopfert und gezählt', ok === 'ok' && r.liste().length === 1 && hat(r.liste()[0]!.layout, 503) && r.verworfen === 1 && vorher !== '', `${ok}, verworfen=${r.verworfen}`);
  }
}

// ── 8o. continents als geordnete Folge (N9) ─────────────────────────────
console.log('▶ enthaelt: Kontinente in Reihenfolge');
{
  const k1 = { id: 'k1', name: 'Erste', spawn: [100, 100] as [number, number] };
  const k2 = { id: 'k2', name: 'Zweite', spawn: [200, 200] as [number, number] };
  const k3 = { id: 'k3', name: 'Dritte' };
  const mitK = (continents: unknown[]): WorldLayout => ({ ...basis, continents }) as WorldLayout;
  check('Kontinente [k1,k2] vs [k2,k1] (der Server nimmt den ERSTEN mit Spawn): NICHT enthalten, in beiden Richtungen', !enthaelt(mitK([k1, k2]), mitK([k2, k1])) && !enthaelt(mitK([k2, k1]), mitK([k1, k2])));
  check('Gleiche Reihenfolge: [k1,k2] enthält [k1], [k2], [k1,k2]; [k1,k3,k2] enthält [k1,k2]; [k1] enthält [k1,k2] nicht', enthaelt(mitK([k1, k2]), mitK([k1])) && enthaelt(mitK([k1, k2]), mitK([k2])) && enthaelt(mitK([k1, k2]), mitK([k1, k2])) && enthaelt(mitK([k1, k3, k2]), mitK([k1, k2])) && !enthaelt(mitK([k1]), mitK([k1, k2])));
  check('Übrige Listen bleiben Multimengen (Platzierungen, Flüsse, Seen, Routen unabhängig von der Reihenfolge): Kontrolle mit Seen', enthaelt({ ...basis, lakes: [{ id: 'a', x: 1, z: 1, radius: 5, depth: 1 }, { id: 'b', x: 2, z: 2, radius: 5, depth: 1 }] } as WorldLayout, { ...basis, lakes: [{ id: 'b', x: 2, z: 2, radius: 5, depth: 1 }, { id: 'a', x: 1, z: 1, radius: 5, depth: 1 }] } as WorldLayout));
  check('Ring-Folge: ein Stand, der nur die Kontinent-Reihenfolge ändert, wird gesichert (Editor-Zeuge)', (() => {
    const { profil, b } = einTab();
    profil.testflugSchreibt(mitK([k1, k2]));
    profil.testflugSchreibt(mitK([k2, k1]));
    return b.ring.liste().some((e) => e.layout.continents.map((c) => c.id).join() === 'k1,k2');
  })());
}

// ── 8p. Alter Sammelschlüssel wird beim Start entfernt (N3) ─────────────
console.log('▶ Alter Sammelschlüssel');
{
  const daten = new Map<string, string>();
  const sp: RingSpeicher = {
    get length() {
      return daten.size;
    },
    key: (i) => [...daten.keys()][i] ?? null,
    getItem: (k) => daten.get(k) ?? null,
    setItem: (k, v) => void daten.set(k, v),
    removeItem: (k) => void daten.delete(k),
  };
  daten.set(ALTER_RING_SCHLUESSEL, 'x'.repeat(1_600_000));
  daten.set(VERDRAENGT_PRAEFIX + 'tab-n:1:0', '{}');
  daten.set(ENTWURF_KEY, '{}');
  check('Alter Sammelschlüssel (ohne Doppelpunkt) vorhanden: wird entfernt (true)', alterRingSchluesselEntfernen(sp) === true && !daten.has(ALTER_RING_SCHLUESSEL));
  check('Einträge im neuen Schema und der Entwurf bleiben unberührt', daten.has(VERDRAENGT_PRAEFIX + 'tab-n:1:0') && daten.has(ENTWURF_KEY) && daten.size === 2);
  check('Ein zweites Mal: nichts zu tun (false), kein Wurf', alterRingSchluesselEntfernen(sp) === false && daten.size === 2);
  check('Der alte Schlüssel heißt genau wov-editor-verdraengt (ohne Doppelpunkt) und ist nicht das Präfix der neuen', ALTER_RING_SCHLUESSEL === 'wov-editor-verdraengt' && !ALTER_RING_SCHLUESSEL.endsWith(':') && VERDRAENGT_PRAEFIX.startsWith(ALTER_RING_SCHLUESSEL));
  // Der Fall des Angriffs: der Ballast lässt einen passenden Entwurf scheitern; nach dem Aufräumen passt er
  const profil = new Profil();
  profil.quotaZeichen = 2_621_440;
  profil.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  profil.daten.set(ALTER_RING_SCHLUESSEL, 'x'.repeat(1_600_000));
  const a = new EditorAttrappe('tab-alt', profil);
  const gross = ((): WorldLayout => {
    const regionen: WorldLayout['regions'][number][] = [];
    let laenge = 0;
    let r = 0;
    while (laenge < 1_100_000) {
      const rad = 800 + ((r * 7) % 400);
      const punkte: [number, number][] = Array.from({ length: 400 }, (_, i) => [Math.round(((r * 131) % 20000) - 10000 + Math.cos((i / 400) * 2 * Math.PI) * rad), Math.round(((r * 271) % 20000) - 10000 + Math.sin((i / 400) * 2 * Math.PI) * rad)]);
      const region = { ...basis.regions[0]!, id: `alt-${r++}`, shape: { kind: 'polygon', points: punkte } } as WorldLayout['regions'][number];
      regionen.push(region);
      laenge += JSON.stringify(region).length + 1;
    }
    return sanitizeWorldLayout({ ...basis, regions: regionen, placements: [] })!;
  })();
  const vorher = a.aendern(() => gross);
  alterRingSchluesselEntfernen(profil.speicherFuer(a));
  const nachher = a.aendern(() => gross);
  check('Mit dem Ballast scheitert ein Entwurf (voll), der ohne ihn passt; nach dem Entfernen wird er geschrieben', vorher === 'voll' && nachher !== 'voll' && (profil.daten.get(ENTWURF_KEY)?.length ?? 0) >= 1_100_000, `${vorher} → ${nachher}`);
}

// ── 9. Quelltextprüfung an editorMain.ts ─────────────────────────────
// ── 8n. Basis des Entwurfs (E1 K1.0): der Zettel führt den Serverstand, auf dem der Entwurf BERUHT ──
console.log('▶ Basis des Entwurfs: holen ändert sie nicht, Entscheidung und Speichern schon');
{
  /** Ein Betriebsdienst-Modell: Hash des Serverdokuments; der Testflug speichert nur mit passender Basis (If-Match). */
  const dienst = { hash: 'h1', layout: basis, posts: 0 };
  const zettelBasis = (p: Profil): string | null => zettelBasisLesen(p.daten.get(STAND_KEY));
  /** LocalStoragePersistenz.speichern gegen das Modell: Basis aus dem Zettel, 409 bei Abweichung, bei 200 rückt nur `basis` vor. */
  const testflugSpeichert = (p: Profil, neuerHash: string): '200' | '409' | 'ohne-basis' => {
    const b = zettelBasis(p);
    if (b === null) return 'ohne-basis';
    dienst.posts++;
    if (b !== dienst.hash) return '409';
    dienst.hash = neuerHash;
    p.testflugSpeichertBasis(neuerHash);
    return '200';
  };
  const neuerDienst = (hash: string): void => {
    dienst.hash = hash;
    dienst.posts = 0;
  };

  // Zettel-Grundlagen
  {
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    check('Ohne Zettel erfindet basisMerken keinen (false) und basisLesen kennt die gemerkte Basis', a.speicher.basisMerken('h1') === false && !profil.daten.has(STAND_KEY) && basisLesen(a.speicher) === 'h1');
    a.serverstandLaden(basis, 'h1');
    check('Serverstand laden (ok): der Zettel trägt die Basis h1, basisLesen liest sie', zettelBasis(profil) === 'h1' && basisLesen(a.speicher) === 'h1', String(zettelBasis(profil)));
    check('Der Zettel bleibt sonst unverändert lesbar (Stempel, quelle=server)', JSON.parse(profil.daten.get(STAND_KEY)!).quelle === 'server' && JSON.parse(profil.daten.get(STAND_KEY)!).tabId === 'A');
    a.speicher.basisMerken(null);
    check('basisMerken(null) entfernt die Basis: Zettel ohne Basis, basisLesen === null (dann geht nichts auf den Server)', zettelBasis(profil) === null && basisLesen(a.speicher) === null);
    const b = new EditorAttrappe('B', profil);
    profil.daten.set(STAND_KEY, '{kaputt');
    b.speicher.basisMerken('hx');
    check('Kaputter Zettel: basisLesen fällt auf die gemerkte Basis zurück, basisMerken erfindet keinen Zettel', basisLesen(b.speicher) === 'hx' && profil.daten.get(STAND_KEY) === '{kaputt');
    profil.lesenKaputt = true;
    check('Speicher nicht lesbar: basisLesen wirft nicht (gemerkte Basis), basisMerken meldet false', basisLesen(b.speicher) === 'hx' && b.speicher.basisMerken('hy') === false);
    profil.lesenKaputt = false;
    check('entwurfImSpeicher: ok und knapp ja; fremd und voll nein', entwurfImSpeicher('ok') && entwurfImSpeicher('knapp') && !entwurfImSpeicher('fremd') && !entwurfImSpeicher('voll'));
  }

  // S5: Entwurf auf S1, fremder Schreiber speichert S2, der Editor HOLT S2 — Dialog noch offen
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1'); // der Editor hat S1 geladen
    a.aendern(setze(P1)); // eigene Arbeit auf S1
    check('Vorbereitung: der Entwurf beruht auf h1', zettelBasis(profil) === 'h1');
    dienst.hash = 'h2'; // ein anderer Browser speichert S2
    // Start-Abgleich: der Editor holt S2 und öffnet den Dialog — bis zur Antwort ändert sich NICHTS an der Basis.
    check('Dialog offen: die Basis des Entwurfs ist weiter h1 (Holen ändert sie nicht)', zettelBasis(profil) === 'h1' && basisLesen(a.speicher) === 'h1');
    profil.testflugSchreibt(layoutMitPlatzierung(a.layout, 'Beech1', 3333, 3333, 1)); // Testflug setzt ein Objekt
    check('Testflug speichert bei offenem Dialog: 409 (nichts ersetzt)', testflugSpeichert(profil, 'hT') === '409' && dienst.hash === 'h2', `Dienst-Hash ${dienst.hash}`);
    check('… die Basis bleibt h1 (nur der Nutzer kann sie ändern)', zettelBasis(profil) === 'h1');
    // Dialog: „Entwurf behalten" — ausdrücklich der gezeigte Stand h2
    a.speicher.abgleichen();
    a.entwurfBehalten('h2');
    check('„Entwurf behalten": die Basis ist jetzt h2 (der gezeigte Stand)', zettelBasis(profil) === 'h2' && basisLesen(a.speicher) === 'h2');
    check('Testflug speichert danach: 200 (bewusste Entscheidung), die Basis rückt auf hT', testflugSpeichert(profil, 'hT') === '200' && dienst.hash === 'hT' && zettelBasis(profil) === 'hT');
  }
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    a.aendern(setze(P1));
    dienst.hash = 'h2';
    // Dialog: „Serverstand übernehmen" — der Entwurf IST S2 und beruht auf h2
    const s2 = layoutMitPlatzierung(basis, 'Beech1', P2, P2, 1);
    a.serverstandLaden(s2, 'h2');
    check('„Serverstand übernehmen": Entwurf = S2 und Basis = h2', hat(gespeichert(profil), P2) && !hat(gespeichert(profil), P1) && zettelBasis(profil) === 'h2');
    profil.testflugSchreibt(layoutMitPlatzierung(s2, 'Beech1', 4444, 4444, 1)); // eigene Änderung im Testflug
    check('Testflug speichert mit eigener Änderung: 200', testflugSpeichert(profil, 'h3') === '200' && dienst.hash === 'h3');
    check('… der Editor liest danach die vom Testflug weitergeschobene Basis (basisLesen: h3)', basisLesen(a.speicher) === 'h3');
  }
  // Während der Dialog offen ist, speichert jemand S3: Entscheidung über S2 gilt nicht für S3
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    a.aendern(setze(P1));
    dienst.hash = 'h2'; // gesehen im Dialog
    dienst.hash = 'h3'; // danach, noch vor der Antwort im Dialog
    a.entwurfBehalten('h2'); // der Nutzer sah h2
    check('Behalten gilt nur für den GEZEIGTEN Stand h2: der inzwischen gespeicherte h3 wird nicht ersetzt (Testflug: 409)', testflugSpeichert(profil, 'hT') === '409' && dienst.hash === 'h3');
  }

  // Die Fälle, in denen die Basis NICHT vorrücken darf
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    // Ein anderer Tab hat den Entwurf geändert; das Ereignis ist noch unterwegs → 'fremd'
    profil.zurueckhalten = true;
    profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', P2, P2, 1));
    a.serverstandLaden(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 1), 'h9');
    check('Serverstand laden bei fremd (Entwurf wurde nicht geschrieben): die Basis bleibt h1, nicht h9', a.letztesErgebnis === 'fremd' && zettelBasis(profil) === 'h1', `${a.letztesErgebnis} / ${String(zettelBasis(profil))}`);
    profil.zustellen();
    profil.zurueckhalten = false;
  }
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    profil.zurueckhalten = true;
    profil.testflugSchreibt(layoutMitPlatzierung(basis, 'Beech1', P2, P2, 1));
    a.entwurfBehalten('h9');
    check('„Entwurf behalten", während ein anderer Tab den Entwurf geändert hat (fremd): keine Basis — über DEN Entwurf wurde nicht entschieden', a.letztesErgebnis === 'fremd' && zettelBasis(profil) === 'h1', String(zettelBasis(profil)));
    profil.zustellen();
    profil.zurueckhalten = false;
  }
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    profil.quotaSchluessel = ENTWURF_KEY; // der Entwurf passt nicht mehr in den Speicher
    a.serverstandLaden(layoutMitPlatzierung(basis, 'Beech1', P1, P1, 1), 'h9');
    check('Serverstand laden bei „voll" (Entwurf nicht gespeichert): die Basis bleibt h1 — der gespeicherte Entwurf beruht weiter auf h1', a.letztesErgebnis === 'voll' && zettelBasis(profil) === 'h1', `${a.letztesErgebnis} / ${String(zettelBasis(profil))}`);
    profil.quotaSchluessel = null;
  }

  // Der Zettel trägt beim Editor-Schreiben die Basis weiter (auch die vom Testflug vorgeschobene)
  {
    neuerDienst('h1');
    const profil = new Profil();
    const a = new EditorAttrappe('A', profil);
    a.serverstandLaden(basis, 'h1');
    profil.testflugSpeichertBasis('h5');
    a.aendern(setze(P1));
    check('Ein Editor-Schreibvorgang lässt die vom Testflug vorgeschobene Basis h5 stehen', zettelBasis(profil) === 'h5');
    const ohne = new Profil();
    const b = new EditorAttrappe('B', ohne);
    b.speicher.basisMerken('hm');
    b.aendern(setze(P2));
    check('Ohne Zettel legt der erste Schreibvorgang ihn mit der gemerkten Basis an', zettelBasis(ohne) === 'hm');
  }
}

console.log('▶ Quelltextprüfung editorMain.ts');
{
  const quelle = readFileSync(resolve(HIER, '../src/editor/editorMain.ts'), 'utf-8');
  const zweig = /if \(werkzeug === 'platzieren'\) \{([\s\S]*?)\n  \}/.exec(quelle)?.[1] ?? '';
  const iMerke = zweig.indexOf('merkeSchritt();');
  const iSetzen = zweig.indexOf('layoutMitPlatzierung(');
  const iSpeichern = zweig.indexOf('speichereEntwurf();');
  check('Platzieren-Zweig gefunden', zweig.length > 0);
  check('merkeSchritt() steht VOR dem Setzen des Layouts', iMerke >= 0 && iSetzen > iMerke && iSpeichern > iSetzen, `Positionen ${iMerke} < ${iSetzen} < ${iSpeichern}`);
  check('Zufalls-Yaw bleibt (Math.random() * Math.PI * 2)', /Math\.random\(\) \* Math\.PI \* 2/.test(zweig));

  const rueckruf = /beiFremdem: \(fremd, info\) => \{([\s\S]*?)\n  \},\n\}\);/.exec(quelle)?.[1] ?? '';
  const iM = rueckruf.indexOf('verlauf.uebernahme(layout, fremd);');
  const iL = rueckruf.indexOf('layout = fremd;');
  check('Rückruf beiFremdem gefunden', rueckruf.length > 0);
  check('… legt den Rückgängig-Punkt VOR der Übernahme an (verlauf.uebernahme(layout) vor layout = fremd)', iM >= 0 && iL > iM, `Positionen ${iM} < ${iL}`);
  check('… und schreibt nicht zurück: alles(…, false)', /alles\('bearbeitet', false\)/.test(rueckruf));
  check('… und meldet es', rueckruf.includes('Entwurf aus einem anderen Tab übernommen'));
  check('… entscheidet über den Schritt nur im SchrittVerlauf (eine Schrittklasse, Flag statt Objektidentität), ohne eigenen Zugriff auf den Wiederherstellen-Stapel', !/zukunft/.test(rueckruf) && !/brauchtSchritt\(|UebernahmeSchritte|uebernahmeSchritte/.test(quelle));
  check('… und sagt bei verworfenem Wiederherstellen-Ast dazu, dass Wiederherstellen nicht mehr möglich ist', /const \{ verworfen \} = verlauf\.uebernahme\(layout, fremd\);/.test(rueckruf) && /verworfen > 0 \? ' Wiederherstellen ist nach der Übernahme nicht mehr möglich\.'/.test(rueckruf));
  check('… setzt halbfertige Werkzeuge zurück: griff, flussPunkte, polygonPunkte, startpunktModus', /griff = null;/.test(rueckruf) && /flussPunkte = \[\];/.test(rueckruf) && /polygonPunkte = \[\];/.test(rueckruf) && /startpunktModus = null;/.test(rueckruf));
  const wieder = /function wiederherstellen\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  const zurueck = /function rueckgaengig\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  check('Editor benutzt den SchrittVerlauf: merkeSchritt → verlauf.merke(layout), Strg+Z → verlauf.zurueck(layout), Strg+Y → verlauf.vor(layout) (Grenze 50 liegt in der Klasse)', /function merkeSchritt\(ersetzt = false\): void \{\s*verlauf\.merke\(layout, ersetzt\);/.test(quelle) && /verlauf\.zurueck\(layout\)/.test(zurueck) && /verlauf\.vor\(layout\)/.test(wieder) && !/const vergangenheit|const zukunft/.test(quelle));
  const speichern = /function speichereEntwurf\([\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('speichereEntwurf: \u201Ezu groß\u201C nur bei \u201Evoll\u201C, \u201Eohne-zettel\u201C hat eine eigene, harmlose Meldung', /=== 'voll'\) \{\s*shell\.meldung\('Entwurf zu groß/.test(speichern) && /'ohne-zettel'\) \{[\s\S]*?Begleitzettel fehlt/.test(speichern) && (speichern.match(/zu groß/g) ?? []).length === 1);
  check('pageshow mit persisted gleicht den Entwurf ab (bfcache-Seite bekam keine Ereignisse)', /addEventListener\('pageshow', \(e\) => \{\s*if \(e\.persisted\) entwurfsSpeicher\.abgleichen\(\);/.test(quelle));
  check('pagehide hängt den Speicher aus (nicht bei bfcache: persisted)', /addEventListener\('pagehide', \(e\) => \{\s*if \(!e\.persisted\) entwurfsSpeicher\.schliessen\(\);/.test(quelle));
  check('Der Editor liest und schreibt den Entwurf nur noch über den Speicher (kein entwurfSchreiben/entwurfLesen mehr)', !/\bentwurfSchreiben\s*\(/.test(quelle) && !/\bentwurfLesen\s*\(/.test(quelle));
  const abgleichTeil = quelle.slice(quelle.indexOf('async function weltAbgleich'));
  check('Der Abgleich beim Start liest und übernimmt mit EINEM Zugriff (entwurfNachAbgleich, kein getrenntes abgleichen()/lesen())', abgleichTeil.includes('entwurfsSpeicher.entwurfNachAbgleich()') && !abgleichTeil.includes('entwurfsSpeicher.lesen()') && !abgleichTeil.includes('entwurfsSpeicher.abgleichen()'));
  check('Start-Abgleich: der Schritt vor dem Ersetzen hängt an brauchtSchrittVorErsetzen(layout, stand.layout) — nicht mehr an Regionen/Platzierungen', /if \(brauchtSchrittVorErsetzen\(layout, stand\.layout\)\) \{\s*merkeSchritt\(true\);/.test(abgleichTeil) && !/layout\.regions\.length > 0 \|\| \(layout\.placements/.test(quelle));
  check('Laden vom Server ohne Schritt setzt die Übernahme-Regel zurück (verlauf.ohneSchritt())', /else \{\s*verlauf\.ohneSchritt\(\);[^}]*\}\s*layout = stand\.layout;/.test(abgleichTeil));

  // Jede Zuweisung an `layout` ausser den bekannten legt vorher einen Schritt an.
  const zeilen = quelle.split('\n');
  const ohneSchritt: string[] = [];
  let zuweisungen = 0;
  zeilen.forEach((z, i) => {
    if (!/^\s*layout = /.test(z)) return;
    zuweisungen++;
    const davor = zeilen.slice(Math.max(0, i - 14), i).join('\n');
    if (/merkeSchritt\(/.test(davor)) return;
    ohneSchritt.push(`${i + 1}: ${z.trim()}`);
  });
  const erwartet = ['layout = vorher;', 'layout = wieder;', 'layout = fremd;', 'layout = {'];
  const unerwartet = ohneSchritt.filter((z) => !erwartet.some((e) => z.endsWith(e)));
  check(`Alle ${zuweisungen} Zuweisungen an layout ausser Rückgängig/Wiederherstellen/Übernahme/Griff-Ziehen haben einen merkeSchritt() davor (unerwartet ohne: ${unerwartet.length})`, unerwartet.length === 0, unerwartet.join(' | '));
  const griffZiehen = ohneSchritt.filter((z) => z.endsWith('layout = {'));
  check('… ausgenommen ist genau das Ziehen eines Griffs (1 Stelle; der Schritt entsteht beim Anfassen)', griffZiehen.length === 1 && /shape: neueForm/.test(zeilen.slice(Number(griffZiehen[0]!.split(':')[0]), Number(griffZiehen[0]!.split(':')[0]) + 4).join('\n')), griffZiehen.join(' | '));
  const importZweig = /if \(s\) \{[\s\S]{0,900}?merkeSchritt\(true\);\s*layout = s;/.test(quelle);
  check('Import legt vor dem Ersetzen einen Schritt an', importZweig);

  // Ring der verdrängten Entwürfe: Verdrahtung im Editor
  check('Ring: new VerdraengtRing(umgebung.speicher), Verlauf mit Abgang-Hörer new SchrittVerlauf<WorldLayout>(50, beiAbgang)', /const ring = new VerdraengtRing\(umgebung\.speicher, \{ tabId \}\);/.test(quelle) && /const verlauf = new SchrittVerlauf<WorldLayout>\(50, beiAbgang\);/.test(quelle));
  const abgangFn = /function beiAbgang\([\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('beiAbgang entscheidet mit sollInRing(grund, herkunft, enthaelt(bezug, stand)) und sichert per ringen()', /sollInRing\(grund, herkunft, enthaelt\(bezug, stand\)\)/.test(abgangFn) && /ringen\(stand, herkunft, grund/.test(abgangFn) && /istFremdHaltig\(stand\)/.test(abgangFn));
  check('Sicherheitsnetz beiVerdraengt: sichert nur, wenn der Stand in keinem Stapel liegt und nicht angezeigt wird', /beiVerdraengt: \(alt\) => \{[\s\S]*?verlauf\.enthaelt\(\(x\) => gleich\(x, alt\)\)[\s\S]*?ringen\(alt, 'fremd', 'ersetzt', null\);/.test(quelle));
  check('Fremdhaltige Stände: merkeSchritt setzt baueAufFremdem (nicht beim Ersetzen), speichereEntwurf markiert den neuen Stand', /baueAufFremdem = !ersetzt && istFremdHaltig\(layout\);/.test(quelle) && /if \(baueAufFremdem && !fremdeStaende\.has\(layout\)\) fremdHaltig\.add\(layout\);/.test(quelle));
  const ersetzenStellen = (quelle.match(/merkeSchritt\(true\)/g) ?? []).length;
  check(`Ersetzen ohne Weiterbauen ruft merkeSchritt(true): Import, Serverstand (Start-Abgleich), Serverstand nach 409, wieder einsetzen (${ersetzenStellen} Stellen, erwartet 4)`, ersetzenStellen === 4, String(ersetzenStellen));
  const sektion = /function ringSektionBauen\(\): void \{[\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('Sektion „Verdrängte Entwürfe“: Liste aus dem Ring, Knopf „wieder einsetzen“ (merkeSchritt(true), also mit Undo-Schritt), Knopf zum Entfernen', sektion.includes('Verdrängte Entwürfe') && sektion.includes("'wieder einsetzen'") && /merkeSchritt\(true\);\s*layout = e\.layout;/.test(sektion) && /ring\.entfernen\(e\.id\)/.test(sektion) && /ringSektionBauen\(\);\s*\}\s*\n\s*\/\*\*\s*\n \* „Verdrängte Entwürfe"/.test(quelle));
  check('Die Meldungen nennen den Ring: Übernahme, Rückgängig, Wiederherstellen, Import, Serverstand — und ihr Fehlschlag (ACHTUNG … NICHT gesichert)', (quelle.match(/ringHinweis\(ring(?:Vor|Neu)/g) ?? []).length >= 6 && /ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden/.test(quelle), String((quelle.match(/ringHinweis\(ring/g) ?? []).length));

  // A2: Meldungsreihenfolge
  check('alles() liefert den GRUND (\'ok\' | \'fremd\' | \'voll\' | \'knapp\') von speichereEntwurf, nicht nur „gemeldet“', /function alles\([^)]*\): SpeicherGrund \{\s*const grund: SpeicherGrund = entwurfSchreiben \? speichereEntwurf\(quelle\) : 'ok';/.test(quelle) && /return grund;/.test(quelle));
  const zurueckFn = /function rueckgaengig\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  const wiederFn = /function wiederherstellen\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  check('Rückgängig und Wiederherstellen setzen ihre Meldung nur, wenn der Schreibversuch NICHT übernommen hat (const grund = alles(); nur bei grund ok …)', /const grund = alles\(\);[\s\S]*?if \(grund === 'ok'\)/.test(zurueckFn) && /const grund = alles\(\);[\s\S]*?if \(grund === 'ok'\)/.test(wiederFn));
  check('Serverstand: „NICHT geladen“, wenn der Schreibversuch einen fremden Stand übernommen hat — im Start-Abgleich und nach 409', /const geschrieben = alles\('server'\);\s*const folge = serverstandFolge\(geschrieben\);[\s\S]*?if \(folge === 'nicht-geladen'\) \{[\s\S]*?Serverstand NICHT geladen[\s\S]*?if \(folge === 'stehen-lassen'\) return;/.test(abgleichTeil) && /const grund = alles\('server'\);\s*const folge = serverstandFolge\(grund\);[\s\S]*?if \(folge === 'geladen'\) \{[\s\S]*?Serverstand geladen/.test(quelle) && !/serverstandFolge\(alles\(/.test(quelle) && !/alles\('server'\)\) \{/.test(quelle));
  check('Import und wieder einsetzen: keine eigene Meldung über der der Übernahme (if (grund === \'ok\'))', /const grund = alles\('import'\);[\s\S]*?if \(grund === 'ok'\)/.test(quelle) && /const grund = alles\(\);\s*vorschauAnstossen\(\);\s*if \(grund === 'ok'\) \{\s*shell\.meldung\(\s*`Verdrängten Entwurf wieder eingesetzt/.test(sektion));

  // Runde 5: Quote, Vorrang des Entwurfs, Ring-Grenze, Texte
  check('Entwurf hat Vorrang vor dem Ring: EntwurfsSpeicher bekommt platzSchaffen/platzErgebnis (ältesten Ring-Eintrag vorläufig entfernen; nur wenn der Entwurf passt, zählt das Opfer, sonst bekommt der Ring es zurück)', /platzSchaffen: \(\) => ring\.aeltestenEntfernen\(\),\s*platzErgebnis: \(entwurfPasst\) => \{\s*ringGeopfert \+= ring\.opferAbschliessen\(entwurfPasst\);/.test(quelle));
  const speichernFn = /function speichereEntwurf\([\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('speichereEntwurf liefert den Grund bei fremdem Stand, „Entwurf zu groß“ und „Speicher knapp“ (geopferte Ring-Einträge genannt) — kein Aufrufer überschreibt sie', /function speichereEntwurf\([^)]*\): SpeicherGrund/.test(speichernFn) && /const grund = speicherGrund\(ergebnis, geopfert\);/.test(speichernFn) && /Entwurf zu groß für localStorage[^;]*opferText/.test(speichernFn) && /Speicher knapp — der Entwurf ist gespeichert/.test(speichernFn) && /return grund;/.test(speichernFn));
  check('Ring-Schreiben scheitert im eigenen Änderungspfad: ringen() meldet sofort („ACHTUNG … NICHT gesichert“) und zählt', /else if \(r === 'voll'\) \{\s*ringVoll\+\+;[\s\S]*?shell\.meldung\('ACHTUNG: Ein verdrängter Stand konnte NICHT gesichert werden/.test(quelle));
  check('Fällt der älteste Ring-Eintrag wegen der Grenze, sagt es die Meldung („Ältester verdrängter Entwurf verworfen“); ringen() zählt ring.verworfen', /Ältester verdrängter Entwurf verworfen \(der Ring fasst höchstens 5/.test(quelle) && /ringVerworfen \+= ring\.verworfen - verworfenVor;/.test(quelle));
  check('Ring und Speicher tragen dieselbe Tab-Kennung (neueTabId): EntwurfsSpeicher({ …, tabId, … })', /const tabId = neueTabId\(\);/.test(quelle) && /\.\.\.umgebung,\s*tabId,/.test(quelle));
  const sektionText = /function ringSektionBauen\(\): void \{[\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('Sektionstext ehrlich: nennt Übernahme/Import/Laden, dass eine spätere eigene Änderung Standard-Undo ist, und die Grenze von 5 mit Meldung; kein „ein Import … drängt Stände hierher“ ohne Einschränkung', sektionText.includes('Standard-Undo') && sektionText.includes('Höchstens 5 Einträge') && sektionText.includes('mit Meldung heraus') && !sektionText.includes('das Verwerfen von Wiederherstellen aus dem Verlauf gedrängt hat'));
  check('Sektion zeigt eine gescheiterte Sicherung dauerhaft (ringVoll > 0), auch ohne Einträge', /if \(ringVoll > 0\) \{[\s\S]*?konnte ein verdrängter Stand nicht gesichert werden/.test(sektionText));
  const ringQuelle = readFileSync(resolve(HIER, '../src/editor/entwurfsSpeicher.ts'), 'utf-8');
  check('Klassenkommentar ehrlich: „Kein Stand geht still verloren — bis zur Ring-Grenze von 5 Einträgen; darüber wird der älteste mit Meldung verworfen.“ (Verlauf und Ring)', (ringQuelle.replace(/\s*\n\s*\*\s*/g, ' ').match(/bis zur Ring-Grenze von 5 Einträgen; darüber wird der älteste mit Meldung verworfen/g) ?? []).length >= 2, String((ringQuelle.match(/Ring-Grenze von 5/g) ?? []).length));
  check('Ring: ein Schlüssel JE Eintrag (VERDRAENGT_PRAEFIX + id), kein Sammelschlüssel mehr; Ring-Grenze 1.000.000 Zeichen', /VERDRAENGT_PRAEFIX = 'wov-editor-verdraengt:'/.test(ringQuelle) && !/VERDRAENGT_KEY/.test(ringQuelle) && /opt\.maxBytes \?\? 1_000_000/.test(ringQuelle) && /opt\.max \?\? 5/.test(ringQuelle));

  // Runde 6
  check('Start entfernt einen alten Sammelschlüssel einmal, mit Konsolen-Hinweis: if (alterRingSchluesselEntfernen(umgebung.speicher)) { console.info(… wov-editor-verdraengt … entfernt', /if \(alterRingSchluesselEntfernen\(umgebung\.speicher\)\) \{\s*console\.info\(\s*'\[editor\][^']*wov-editor-verdraengt\) entfernt/.test(quelle));
  check('Kein `uebernommen`-Boolean-Weg mehr: keine Aufrufstelle wertet alles()/speichereEntwurf() als „übernommen“ (const uebernommen = alles… kommt nicht mehr vor)', !/const uebernommen = alles\(/.test(quelle) && !/if \(!uebernommen\)/.test(quelle) && !/if \(uebernommen\)/.test(quelle));
  const poly = /function polygonSchliessen[\s\S]*?merkeSchritt\(\);[^\n]*\n\s*layout = \{ \.\.\.layout, regions/.test(quelle);
  const hoch = /\[arr\[i\], arr\[i \+ 1\]\] = [^\n]*\n\s*merkeSchritt\(\);[^\n]*\n\s*layout = \{ \.\.\.layout, regions: arr \}/.test(quelle);
  check('Polygon schliessen und „nach oben" (bisher ohne Schritt) legen jetzt einen an', poly && hoch, `polygon=${poly}, nachOben=${hoch}`);
}

console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
