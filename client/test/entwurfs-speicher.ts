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
  /** Beim nächsten setItem einen Quotenfehler werfen. */
  quotaFehler = false;
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

  setItem(von: object | null, k: string, v: string): void {
    if (this.quotaFehler) throw new Error('QuotaExceededError');
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
    return { getItem: (k) => this.getItem(k), setItem: (k, v) => this.setItem(tab, k, v) };
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
 * Das Verhalten des Editors, so knapp wie im Editor: `merkeSchritt` legt
 * den Stand auf den Stapel; jede Änderung schreibt sofort den Entwurf;
 * `beiFremdem` = `merkeSchritt(); layout = fremd` und KEIN Zurückschreiben
 * (editorMain.ts, `entwurfsSpeicher`; die Quelltextprüfung unten hält beides
 * am echten Code fest).
 */
class EditorAttrappe {
  layout: WorldLayout;
  readonly vergangenheit: WorldLayout[] = [];
  fremdUebernahmen = 0;
  letzteInfo: FremdInfo | null = null;
  readonly speicher: EntwurfsSpeicher;
  constructor(
    readonly name: string,
    profil: Profil,
    opt: { ereignisse?: boolean; kanal?: boolean; jetzt?: () => number } = {}
  ) {
    const tab = this;
    this.speicher = new EntwurfsSpeicher({
      speicher: profil.speicherFuer(tab),
      ereignisse: opt.ereignisse === false ? null : profil.ereignisseFuer(tab),
      kanal: opt.kanal === false ? null : profil.kanalFuer(tab),
      tabId: name,
      jetzt: opt.jetzt,
      aktuell: () => this.layout,
      beiFremdem: (fremd, info) => {
        this.vergangenheit.push(this.layout);
        this.layout = fremd;
        this.fremdUebernahmen++;
        this.letzteInfo = info;
      },
    });
    this.layout = this.speicher.lesen() ?? basis;
  }
  /** Eine Änderung im Editor: Schritt merken, Layout ersetzen, Entwurf schreiben. */
  aendern(f: (l: WorldLayout) => WorldLayout): string {
    this.vergangenheit.push(this.layout);
    this.layout = f(this.layout);
    return this.speicher.schreiben(this.layout, 'bearbeitet', 'dev');
  }
  rueckgaengig(): void {
    const v = this.vergangenheit.pop();
    if (v) this.layout = v;
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
  const iM = rueckruf.indexOf('merkeSchritt();');
  const iL = rueckruf.indexOf('layout = fremd;');
  check('Rückruf beiFremdem gefunden', rueckruf.length > 0);
  check('… legt den Rückgängig-Punkt VOR der Übernahme an', iM >= 0 && iL > iM, `Positionen ${iM} < ${iL}`);
  check('… und schreibt nicht zurück: alles(…, false)', /alles\('bearbeitet', false\)/.test(rueckruf));
  check('… und meldet es', rueckruf.includes('Entwurf aus einem anderen Tab übernommen'));
  check('Der Editor liest und schreibt den Entwurf nur noch über den Speicher (kein entwurfSchreiben/entwurfLesen mehr)', !/\bentwurfSchreiben\s*\(/.test(quelle) && !/\bentwurfLesen\s*\(/.test(quelle));
  check('Der Abgleich beim Start prüft zuerst auf fremde Änderungen (abgleichen() vor lesen())', quelle.indexOf('entwurfsSpeicher.abgleichen()') > 0 && quelle.indexOf('entwurfsSpeicher.abgleichen()') < quelle.indexOf('const entwurf = entwurfsSpeicher.lesen()'));
}

console.log(fehler === 0 ? '\nalle Prüfungen bestanden' : `\n${fehler} Prüfung(en) FEHLGESCHLAGEN`);
process.exit(fehler === 0 ? 0 : 1);
