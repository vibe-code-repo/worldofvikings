/**
 * Entwurfsspeicher (K0.3): zwei Tabs, ein localStorage-Schlüssel.
 *
 * Geprüft wird die Regel aus client/src/editor/entwurfsSpeicher.ts: Ein Tab
 * schreibt den Entwurf nie über einen fremden Stand, den er nicht gesehen
 * hat; der fremde Stand wird übernommen, der eigene liegt danach im
 * Rückgängig-Stapel. Ohne Browser: eine Attrappe für localStorage,
 * `storage`-Ereignisse und BroadcastChannel, gemeinsam für alle „Tabs" eines
 * „Profils". Die Attrappe kann Ereignisse zurückhalten (Tab im Hintergrund)
 * und einen Schreiber OHNE Stempel nachbilden (der Testflug, main.ts).
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
  type EreignisQuelle,
  type FremdInfo,
  type Kanal,
  type KvSpeicher,
} from '../src/editor/entwurfsSpeicher';
import {
  ENTWURF_KEY,
  STAND_KEY,
  entwurfLesen,
  entwurfSchreiben,
  entwurfStandLesen,
  layoutMitPlatzierung,
} from '../src/editor/weltdokument';

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
    this.daten.set(k, v);
    this.schreibvorgaenge++;
    // Wie im Browser: das Ereignis geht an alle ANDEREN Tabs, nie an den Schreiber.
    for (const h of this.hoerer) {
      if (h.tab !== von) this.zustellenOderMerken(() => h.fn({ key: k }));
    }
  }
  getItem(k: string): string | null {
    if (this.lesenKaputt) throw new Error('SecurityError');
    return this.daten.get(k) ?? null;
  }
  /** localStorage.clear() in einem anderen Tab. */
  leeren(von: object | null): void {
    this.daten.clear();
    for (const h of this.hoerer) if (h.tab !== von) this.zustellenOderMerken(() => h.fn({ key: null }));
  }

  speicherFuer(tab: object): KvSpeicher {
    return {
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

  /** Der Testflug: schreibt NUR den Entwurf, ohne Stempel und ohne Kanal — main.ts. */
  testflugSchreibt(layout: unknown): void {
    this.setItem(null, ENTWURF_KEY, JSON.stringify(layout));
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
 * Die Stapelregeln der beiden früheren Stände, als Zeugen: Sie haben dieselbe
 * Oberfläche wie `SchrittVerlauf` und dienen nur dazu, dem Test zu zeigen,
 * dass er den jeweiligen Fehler auch FINDET.
 */
interface VerlaufLike {
  readonly vergangenheit: WorldLayout[];
  readonly zukunft: WorldLayout[];
  merke(aktuell: WorldLayout): void;
  uebernahme(aktuell: WorldLayout): boolean;
  zurueck(aktuell: WorldLayout): WorldLayout | undefined;
  vor(aktuell: WorldLayout): WorldLayout | undefined;
  ohneSchritt(): void;
}
/** Stand 5eb78eb: JEDE Übernahme legt einen Schritt an (und leert den Wiederherstellen-Stapel). */
class Verlauf5eb78eb implements VerlaufLike {
  readonly vergangenheit: WorldLayout[] = [];
  readonly zukunft: WorldLayout[] = [];
  merke(a: WorldLayout): void {
    this.vergangenheit.push(a);
    if (this.vergangenheit.length > 50) this.vergangenheit.shift();
    this.zukunft.length = 0;
  }
  uebernahme(a: WorldLayout): boolean {
    this.merke(a);
    return true;
  }
  zurueck(a: WorldLayout): WorldLayout | undefined {
    const v = this.vergangenheit.pop();
    if (v) this.zukunft.push(a);
    return v;
  }
  vor(a: WorldLayout): WorldLayout | undefined {
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
class Verlauf88277f5 extends Verlauf5eb78eb {
  private marke: WorldLayout | null = null;
  override uebernahme(a: WorldLayout): boolean {
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
  letzteInfo: FremdInfo | null = null;
  readonly speicher: EntwurfsSpeicher;
  constructor(
    readonly name: string,
    profil: Profil,
    opt: { ereignisse?: boolean; kanal?: boolean; jetzt?: () => number; verlauf?: VerlaufLike } = {}
  ) {
    const tab = this;
    this.verlauf = opt.verlauf ?? new SchrittVerlauf<WorldLayout>();
    this.speicher = new EntwurfsSpeicher({
      speicher: profil.speicherFuer(tab),
      ereignisse: opt.ereignisse === false ? null : profil.ereignisseFuer(tab),
      kanal: opt.kanal === false ? null : profil.kanalFuer(tab),
      tabId: name,
      jetzt: opt.jetzt,
      aktuell: () => this.layout,
      beiFremdem: (fremd, info) => {
        this.verlauf.uebernahme(this.layout);
        this.layout = fremd;
        this.fremdUebernahmen++;
        this.letzteInfo = info;
        this.meldungen++;
        // Die Meldung sagt: der bisherige EIGENE Stand liegt unter Rückgängig.
        if (this.eigenerStand !== null && !this.vergangenheit.includes(this.eigenerStand)) this.falscheMeldungen++;
      },
    });
    this.layout = this.speicher.lesen() ?? basis;
  }
  /** Der letzte EIGENE Stand — die Größe, deren Erreichbarkeit die Meldung zusagt. */
  eigenerStand: WorldLayout | null = null;
  /** Eine Änderung im Editor: Schritt merken, Layout ersetzen, Entwurf schreiben. */
  aendern(f: (l: WorldLayout) => WorldLayout): string {
    this.verlauf.merke(this.layout);
    this.layout = f(this.layout);
    this.eigenerStand = this.layout;
    return this.speicher.schreiben(this.layout, 'bearbeitet', 'dev');
  }
  rueckgaengig(): void {
    const v = this.verlauf.zurueck(this.layout);
    if (v !== undefined) this.layout = v;
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
console.log('▶ Vergleichsprobe: alter Schreibweg (entwurfSchreiben ohne Prüfung)');
{
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
  // Der Wiederherstellen-Stapel gehört dem Nutzer: eine Übernahme verwirft ihn nicht.
  const profil2 = new Profil();
  profil2.daten.set(ENTWURF_KEY, JSON.stringify(basis));
  const c = new EditorAttrappe('tab-c', profil2);
  c.aendern(setze(1000));
  c.aendern(setze(1001));
  c.rueckgaengig(); // Wiederherstellen-Stapel: 1 Eintrag
  const zuk = c.zukunft.length;
  profil2.testflugSchreibt(fremdeLayout(0));
  profil2.testflugSchreibt(fremdeLayout(1));
  check('Übernahmen lassen den Wiederherstellen-Stapel stehen (Redo-Ast nur durch eine eigene Änderung verloren)', zuk === 1 && c.zukunft.length === 1, `zukunft ${zuk} → ${c.zukunft.length}`);
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
  const u = new SchrittVerlauf<number | undefined>();
  u.merke(undefined);
  check('Ein abgelegter Wert undefined wird nicht mit „leer" verwechselt', u.zurueck(1) === undefined && u.zukunft.length === 1);
}

// ── 8b3. Erschöpfende Prüfung: alle Folgen bis Länge 7 ────────────────
console.log('▶ Erschöpfend: alle Folgen bis Länge 7 über {eigen, import, fremd, undo, redo}');
{
  type Zug = 'eigen' | 'import' | 'fremd' | 'undo' | 'redo';
  const ZUEGE: readonly Zug[] = ['eigen', 'import', 'fremd', 'undo', 'redo'];
  interface St {
    id: number;
    art: 'start' | 'eigen' | 'import' | 'fremd';
    /** Der letzte nicht-fremde Stand vor diesem (bei nicht-fremden: er selbst). */
    eigener: St | null;
  }
  type Folge = readonly Zug[];
  interface Ergebnis {
    folgen: number;
    /** Übernahmen, bei denen der zuvor angezeigte (nicht-fremde bzw. letzte nicht-fremde) Stand nicht per Rückgängig erreichbar war = die Meldung wäre falsch. */
    falscheMeldungen: number;
    uebernahmen: number;
    /** Ein nicht-fremder Stand ist aus Stapel, Wiederherstellen-Stapel und Anzeige verschwunden, ohne dass eine eigene Änderung den Wiederherstellen-Ast verworfen hat. */
    verluste: number;
    /** Der Wiederherstellen-Stapel hat sich anders verändert als durch Rückgängig/Wiederherstellen/eigene Änderung. */
    redoVerstoesse: number;
    kuerzesteMeldung: Folge | null;
    kuerzesterVerlust: Folge | null;
    kuerzesterRedo: Folge | null;
  }

  /** Eine Folge durchspielen; Verstöße je Invariante zählen. */
  const spielen = (folge: Folge, neu: () => VerlaufLike, importMerkt: boolean): { meldung: boolean; verlust: boolean; redo: boolean; uebernahmen: number; falsche: number } => {
    const v = neu();
    let id = 0;
    const st = (art: St['art'], eigener: St | null): St => {
      const x: St = { id: id++, art, eigener };
      if (art !== 'fremd') x.eigener = x;
      return x;
    };
    const wl = new Map<St, WorldLayout>(); // Layout-Objekt je Stand (der Verlauf speichert Layouts, nicht Stände)
    const stVon = new Map<WorldLayout, St>();
    const layoutFuer = (x: St): WorldLayout => {
      let l = wl.get(x);
      if (!l) {
        l = { ...basis, name: `stand-${x.id}` };
        wl.set(x, l);
        stVon.set(l, x);
      }
      return l;
    };
    let aktuell = st('start', null);
    const alle = new Set<St>([aktuell]); // nicht-fremde Stände, die noch da sein müssen
    let meldung = false;
    let verlust = false;
    let redo = false;
    let uebernahmen = 0;
    let falsche = 0;
    for (const zug of folge) {
      const vorher = aktuell;
      const zukunftVorher = v.zukunft.map((l) => stVon.get(l)!);
      const zukunftVorherLayouts = [...v.zukunft];
      let verwirftRedo = false;
      if (zug === 'eigen' || zug === 'import') {
        const neuSt = st(zug, null);
        if (zug === 'eigen' || importMerkt) {
          v.merke(layoutFuer(aktuell));
          verwirftRedo = true;
        }
        aktuell = neuSt;
        alle.add(neuSt);
      } else if (zug === 'fremd') {
        const vor = aktuell;
        const basisStand = vor.art !== 'fremd' ? vor : vor.eigener!;
        v.uebernahme(layoutFuer(vor));
        const f = st('fremd', basisStand);
        uebernahmen++;
        // Die Meldung „dein bisheriger Stand liegt unter Rückgängig" behauptet: der letzte nicht-fremde Stand ist im Stapel.
        if (!v.vergangenheit.some((l) => stVon.get(l) === basisStand)) {
          meldung = true;
          falsche++;
        }
        aktuell = f;
        // Fremder Stand ist NIE in `alle`: er darf durch den nächsten ersetzt werden.
      } else if (zug === 'undo') {
        const x = v.zurueck(layoutFuer(aktuell));
        if (x !== undefined) aktuell = stVon.get(x)!;
      } else {
        const x = v.vor(layoutFuer(aktuell));
        if (x !== undefined) aktuell = stVon.get(x)!;
      }
      // Redo-Standard: nur eine eigene Änderung verwirft den Wiederherstellen-Ast.
      const zukunftNachher = v.zukunft.map((l) => stVon.get(l)!);
      if (!verwirftRedo) {
        const erwartet =
          zug === 'undo' && zukunftNachher.length === zukunftVorher.length + 1
            ? [...zukunftVorher, vorher]
            : zug === 'redo' && zukunftNachher.length === zukunftVorher.length - 1
              ? zukunftVorher.slice(0, -1)
              : zukunftVorher;
        if (zukunftNachher.length !== erwartet.length || zukunftNachher.some((x, i) => x !== erwartet[i])) redo = true;
      }
      // Kein Verlust: jeder nicht-fremde Stand ist im Stapel, im Wiederherstellen-Stapel oder angezeigt — ausser dem Wiederherstellen-Ast, den eine eigene Änderung verwirft.
      const erreichbar = new Set<St>([aktuell, ...v.vergangenheit.map((l) => stVon.get(l)!), ...v.zukunft.map((l) => stVon.get(l)!)]);
      const erlaubt = new Set<St>(verwirftRedo ? zukunftVorherLayouts.map((l) => stVon.get(l)!) : []);
      for (const x of [...alle]) {
        if (erreichbar.has(x)) continue;
        if (erlaubt.has(x)) {
          alle.delete(x);
          continue;
        }
        verlust = true;
        alle.delete(x);
      }
    }
    return { meldung, verlust, redo, uebernahmen, falsche };
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
  const FOLGEN = alleFolgen(7);
  const pruefe = (neu: () => VerlaufLike, importMerkt: boolean): Ergebnis => {
    const e: Ergebnis = { folgen: 0, falscheMeldungen: 0, uebernahmen: 0, verluste: 0, redoVerstoesse: 0, kuerzesteMeldung: null, kuerzesterVerlust: null, kuerzesterRedo: null };
    for (const f of FOLGEN) {
      const r = spielen(f, neu, importMerkt);
      e.folgen++;
      e.uebernahmen += r.uebernahmen;
      e.falscheMeldungen += r.falsche;
      if (r.meldung && (!e.kuerzesteMeldung || f.length < e.kuerzesteMeldung.length)) e.kuerzesteMeldung = f;
      if (r.verlust) {
        e.verluste++;
        if (!e.kuerzesterVerlust || f.length < e.kuerzesterVerlust.length) e.kuerzesterVerlust = f;
      }
      if (r.redo) {
        e.redoVerstoesse++;
        if (!e.kuerzesterRedo || f.length < e.kuerzesterRedo.length) e.kuerzesterRedo = f;
      }
    }
    return e;
  };
  const zeige = (name: string, e: Ergebnis): void =>
    console.log(
      `      ${name}: Folgen=${e.folgen}, Übernahmen=${e.uebernahmen}, falsche Meldungen=${e.falscheMeldungen}, Verlust-Folgen=${e.verluste}, Redo-Verstöße=${e.redoVerstoesse}` +
        `${e.kuerzesteMeldung ? ` · kürzeste falsche Meldung: ${e.kuerzesteMeldung.join('→')}` : ''}` +
        `${e.kuerzesterVerlust ? ` · kürzester Verlust: ${e.kuerzesterVerlust.join('→')}` : ''}` +
        `${e.kuerzesterRedo ? ` · kürzester Redo-Verstoß: ${e.kuerzesterRedo.join('→')}` : ''}`
    );

  const neuE = pruefe(() => new SchrittVerlauf<WorldLayout>(), true);
  zeige('SchrittVerlauf (jetzt)', neuE);
  check('Anzahl der geprüften Folgen: 5+5²+…+5⁷ = 97655', neuE.folgen === 97655, String(neuE.folgen));
  check('SchrittVerlauf: 0 falsche Meldungen in allen Folgen', neuE.falscheMeldungen === 0 && neuE.uebernahmen > 0, `Übernahmen=${neuE.uebernahmen}, falsch=${neuE.falscheMeldungen}`);
  check('SchrittVerlauf: 0 Folgen mit Verlust eines nicht-fremden Stands', neuE.verluste === 0, `Verlust-Folgen=${neuE.verluste}`);
  check('SchrittVerlauf: 0 Verstöße gegen „Redo-Ast nur durch eigene Änderung verloren"', neuE.redoVerstoesse === 0, `Verstöße=${neuE.redoVerstoesse}`);

  // Die Prüfung muss die früheren Fehler FINDEN (sonst wäre sie wertlos).
  const id1 = pruefe(() => new Verlauf88277f5(), false); // Stand 88277f5: Identität, Import ohne Schritt
  const id2 = pruefe(() => new Verlauf88277f5(), true); // dasselbe, aber Import mit Schritt
  const alt = pruefe(() => new Verlauf5eb78eb(), true); // mit Import-Schritt: nur die Übernahme-Regel von 5eb78eb ist der Prüfling
  zeige('88277f5 (Identität, Import ohne Schritt)', id1);
  zeige('88277f5 (Identität, Import mit Schritt)', id2);
  zeige('5eb78eb (jede Übernahme ein Schritt, Import mit Schritt)', alt);
  check('Gegenprobe 88277f5: fremd→import→fremd (Länge 3) wird als falsche Meldung gefunden; kürzeste Länge überhaupt = 3', spielen(['fremd', 'import', 'fremd'], () => new Verlauf88277f5(), false).meldung && id1.kuerzesteMeldung?.length === 3, id1.kuerzesteMeldung?.join('→') ?? 'nichts');
  check('Gegenprobe 88277f5: fremd→undo→eigen→fremd (Länge 4) wird gefunden, auch wenn der Import einen Schritt anlegt; kürzeste Länge = 4', spielen(['fremd', 'undo', 'eigen', 'fremd'], () => new Verlauf88277f5(), true).meldung && id2.kuerzesteMeldung?.length === 4, id2.kuerzesteMeldung?.join('→') ?? 'nichts');
  check('Dieselben zwei Folgen sind mit SchrittVerlauf in Ordnung', !spielen(['fremd', 'import', 'fremd'], () => new SchrittVerlauf<WorldLayout>(), true).meldung && !spielen(['fremd', 'undo', 'eigen', 'fremd'], () => new SchrittVerlauf<WorldLayout>(), true).meldung);
  check('Gegenprobe 88277f5: Verlust-Folgen gefunden (Identität + Import)', id1.verluste > 0 && id2.verluste > 0, `${id1.verluste} / ${id2.verluste}`);
  check('Gegenprobe 88277f5 leert den Wiederherstellen-Stapel bei Übernahme: Redo-Verstöße gefunden', id1.redoVerstoesse > 0, `Verstöße=${id1.redoVerstoesse}`);
  check('Gegenprobe 5eb78eb: bis Länge 7 keine falsche Meldung (die Flut braucht k ≥ 51, s. o.) — aber Redo-Verstöße', alt.falscheMeldungen === 0 && alt.redoVerstoesse > 0, `falsch=${alt.falscheMeldungen}, Redo=${alt.redoVerstoesse}`);
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

// ── 9. Quelltextprüfung an editorMain.ts ─────────────────────────────
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

  const rueckruf = /beiFremdem: \(fremd\) => \{([\s\S]*?)\n  \},\n\}\);/.exec(quelle)?.[1] ?? '';
  const iM = rueckruf.indexOf('verlauf.uebernahme(layout);');
  const iL = rueckruf.indexOf('layout = fremd;');
  check('Rückruf beiFremdem gefunden', rueckruf.length > 0);
  check('… legt den Rückgängig-Punkt VOR der Übernahme an (verlauf.uebernahme(layout) vor layout = fremd)', iM >= 0 && iL > iM, `Positionen ${iM} < ${iL}`);
  check('… und schreibt nicht zurück: alles(…, false)', /alles\('bearbeitet', false\)/.test(rueckruf));
  check('… und meldet es', rueckruf.includes('Entwurf aus einem anderen Tab übernommen'));
  check('… entscheidet über den Schritt nur im SchrittVerlauf (eine Schrittklasse, Flag statt Objektidentität) und verwirft den Wiederherstellen-Stapel nicht', !/zukunft/.test(rueckruf) && !/brauchtSchritt|UebernahmeSchritte|uebernahmeSchritte/.test(quelle));
  check('… setzt halbfertige Werkzeuge zurück: griff, flussPunkte, polygonPunkte, startpunktModus', /griff = null;/.test(rueckruf) && /flussPunkte = \[\];/.test(rueckruf) && /polygonPunkte = \[\];/.test(rueckruf) && /startpunktModus = null;/.test(rueckruf));
  const wieder = /function wiederherstellen\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  const zurueck = /function rueckgaengig\(\): void \{([\s\S]*?)\n\}\n/.exec(quelle)?.[1] ?? '';
  check('Editor benutzt den SchrittVerlauf: merkeSchritt → verlauf.merke(layout), Strg+Z → verlauf.zurueck(layout), Strg+Y → verlauf.vor(layout) (Grenze 50 liegt in der Klasse)', /function merkeSchritt\(\): void \{\s*verlauf\.merke\(layout\);\s*\}/.test(quelle) && /verlauf\.zurueck\(layout\)/.test(zurueck) && /verlauf\.vor\(layout\)/.test(wieder) && !/const vergangenheit|const zukunft/.test(quelle));
  const speichern = /function speichereEntwurf\([\s\S]*?\n\}\n/.exec(quelle)?.[0] ?? '';
  check('speichereEntwurf: \u201Ezu groß\u201C nur bei \u201Evoll\u201C, \u201Eohne-zettel\u201C hat eine eigene, harmlose Meldung', /=== 'voll'\) \{\s*shell\.meldung\('Entwurf zu groß/.test(speichern) && /'ohne-zettel'\) \{[\s\S]*?Begleitzettel fehlt/.test(speichern) && (speichern.match(/zu groß/g) ?? []).length === 1);
  check('pageshow mit persisted gleicht den Entwurf ab (bfcache-Seite bekam keine Ereignisse)', /addEventListener\('pageshow', \(e\) => \{\s*if \(e\.persisted\) entwurfsSpeicher\.abgleichen\(\);/.test(quelle));
  check('pagehide hängt den Speicher aus (nicht bei bfcache: persisted)', /addEventListener\('pagehide', \(e\) => \{\s*if \(!e\.persisted\) entwurfsSpeicher\.schliessen\(\);/.test(quelle));
  check('Der Editor liest und schreibt den Entwurf nur noch über den Speicher (kein entwurfSchreiben/entwurfLesen mehr)', !/\bentwurfSchreiben\s*\(/.test(quelle) && !/\bentwurfLesen\s*\(/.test(quelle));
  const abgleichTeil = quelle.slice(quelle.indexOf('async function weltAbgleich'));
  check('Der Abgleich beim Start prüft zuerst auf fremde Änderungen (abgleichen() vor lesen())', abgleichTeil.indexOf('entwurfsSpeicher.abgleichen()') > 0 && abgleichTeil.indexOf('entwurfsSpeicher.abgleichen()') < abgleichTeil.indexOf('const entwurf = entwurfsSpeicher.lesen()'));
  check('Laden vom Server ohne Schritt setzt die Übernahme-Regel zurück (verlauf.ohneSchritt())', /else \{\s*verlauf\.ohneSchritt\(\);[^}]*\}\s*layout = stand\.layout;/.test(abgleichTeil));

  // Jede Zuweisung an `layout` ausser den bekannten legt vorher einen Schritt an.
  const zeilen = quelle.split('\n');
  const ohneSchritt: string[] = [];
  let zuweisungen = 0;
  zeilen.forEach((z, i) => {
    if (!/^\s*layout = /.test(z)) return;
    zuweisungen++;
    const davor = zeilen.slice(Math.max(0, i - 14), i).join('\n');
    if (/merkeSchritt\(\)/.test(davor)) return;
    ohneSchritt.push(`${i + 1}: ${z.trim()}`);
  });
  const erwartet = ['layout = vorher;', 'layout = wieder;', 'layout = fremd;', 'layout = {'];
  const unerwartet = ohneSchritt.filter((z) => !erwartet.some((e) => z.endsWith(e)));
  check(`Alle ${zuweisungen} Zuweisungen an layout ausser Rückgängig/Wiederherstellen/Übernahme/Griff-Ziehen haben einen merkeSchritt() davor (unerwartet ohne: ${unerwartet.length})`, unerwartet.length === 0, unerwartet.join(' | '));
  const griffZiehen = ohneSchritt.filter((z) => z.endsWith('layout = {'));
  check('… ausgenommen ist genau das Ziehen eines Griffs (1 Stelle; der Schritt entsteht beim Anfassen)', griffZiehen.length === 1 && /shape: neueForm/.test(zeilen.slice(Number(griffZiehen[0]!.split(':')[0]), Number(griffZiehen[0]!.split(':')[0]) + 4).join('\n')), griffZiehen.join(' | '));
  const importZweig = /if \(s\) \{\s*(\/\/[^\n]*\n\s*)*merkeSchritt\(\);\s*layout = s;/.test(quelle);
  check('Import legt vor dem Ersetzen einen Schritt an', importZweig);
  const poly = /function polygonSchliessen[\s\S]*?merkeSchritt\(\);[^\n]*\n\s*layout = \{ \.\.\.layout, regions/.test(quelle);
  const hoch = /\[arr\[i\], arr\[i \+ 1\]\] = [^\n]*\n\s*merkeSchritt\(\);[^\n]*\n\s*layout = \{ \.\.\.layout, regions: arr \}/.test(quelle);
  check('Polygon schliessen und „nach oben" (bisher ohne Schritt) legen jetzt einen an', poly && hoch, `polygon=${poly}, nachOben=${hoch}`);
}

console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
