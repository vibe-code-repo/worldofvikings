/**
 * Ruestkammer: das OEFFENTLICHE Abbild eines Charakters.
 *
 * ── Warum es dieses Modul gibt ───────────────────────────────────────
 * Die Webseite zeigt Charaktere samt angelegter Ausruestung. Die Quelle ist
 * der Spielerzustand (`SavedPlayer`), und der enthaelt vieles, was nie nach
 * aussen darf: Position, Bettpunkt, Welt, das gesamte Inventar. Dieses Modul
 * ist die EINE Stelle, die beides kennt, und es arbeitet mit einer
 * POSITIVLISTE: Jedes Feld der Antwort wird unten einzeln gesetzt. Es gibt
 * kein "kopiere alles ausser ...", denn ein neues Feld im Spielstand (und es
 * kommen laufend neue) waere dann sofort oeffentlich.
 *
 * ── Was NICHT ausgeliefert wird ──────────────────────────────────────
 * Kontoname, Konto-Id, E-Mail, spielerId, Position, Bett/Spawn, Welt,
 * Inventar ausser den ANGELEGTEN Stuecken. Standardkonten und gebannte
 * Konten erscheinen nicht (Regel in `Kontendatenbank.armoryZeilen`).
 *
 * ── Erweiterbar ohne Umbau ───────────────────────────────────────────
 * Stufe/Erfahrung, Fertigkeiten, Tode und Spielzeit gibt es im Spiel noch
 * nicht. `ArmoryProfil` fuehrt sie als OPTIONALE Felder; die Antwort laesst
 * sie weg, solange der Server sie nicht kennt. Kommen sie, setzt `baueProfil`
 * sie, und die Webseite liest `undefined` als "unbekannt".
 *
 * ── Speicherstand statt Puffer je Anfrage ───────────────────────────
 * Die Liste kommt aus EINEM Speicherstand aller sichtbaren Charaktere
 * (ARMORY_CACHE_MS = 30 s; Neubau hoechstens je ARMORY_NEUBAU_MIN_MS, auch
 * wenn sich die Sichtbarkeit aendert). Suche und Seiten sind Array-Arbeit auf
 * diesem Stand: `q` und `seite` bestimmen nichts, was gespeichert wird, ein
 * Angreifer kann den Speicher also nicht fuellen und keine Datenbankarbeit je
 * Anfrage erzwingen. 30 s, weil der Spielerzustand hoechstens alle 30 s
 * geschrieben wird (SpielerSicherung): die Anzeige ist rund eine Minute alt.
 * Profile werden einzeln je 30 s gepuffert (hoechstens ARMORY_CACHE_MAX), ihre
 * Sichtbarkeit aber bei jedem Aufruf an der Datenbank geprueft und der
 * Profiltext nie gepuffert. Eine Drossel je Herkunft (`erlaubt`) ist die zweite
 * Linie; nginx sperrt den Weg von aussen (deploy/nginx/wov-lab.conf).
 */
import { performance } from 'node:perf_hooks';
import {
  AUSRUESTUNG_SLOTS, KEINE_WERTE, STAT_IDS, SLOT_VORGABE, ausgehenderNahkampfSchaden, decodeArmor, findItem,
  istAugenfarbe, istAusruestungsSlot, istFigur, istFrisur, istHaarfarbe, istRarity, lebensmaximum, summiereWerte, waffenSchaden, werteFuerRuestungsteil,
  type AusruestungsSlot, type ItemShared, type ItemStats, type Rarity, type Werte,
} from '@wov/shared';
import { PROFILTEXT_MAX, type ArmoryZeile, type Kontendatenbank } from './Kontendatenbank.js';

/** Eintraege je Seite der Liste (fest, der Aufrufer kann sie nicht waehlen). */
export const ARMORY_SEITENGROESSE = 24;
/** Lebensdauer eines gepufferten Ergebnisses, s. Kopfkommentar. */
export const ARMORY_CACHE_MS = 30_000;
/** Fruehestens nach so vielen ms wird die Liste wegen geaenderter Sichtbarkeit neu gebaut. */
export const ARMORY_NEUBAU_MIN_MS = 1_000;
/** Hoechstzahl gepufferter Profile; ist sie erreicht, fliegt das aelteste hinaus. */
export const ARMORY_CACHE_MAX = 256;
/** Drossel je Herkunft: so viele Anfragen je Fenster. */
export const ARMORY_DROSSEL_MAX = 300;
export const ARMORY_DROSSEL_FENSTER_MS = 10_000;
const DROSSEL_KARTE_MAX = 4096;
/** Hoechstdauer eines Arbeitsstuecks des Neubaus, danach gibt der Faden frei (Ziel: Takt des Spiels unter 20 ms). */
export const ARMORY_SCHRITT_MS = 2;
/** Eine Suche braucht mindestens so viele Zeichen (Codepunkte, nach Faltung); kuerzere sind keine Suche. */
export const ARMORY_SUCHE_MIN = 2;
/** Zahl der Eimer des Suchindex (fest). */
export const ARMORY_EIMER = 65_536;
const ARMORY_SEITE_ZEILEN = 500;
const ARMORY_LAUF = 2048;
const ARMORY_MISCH_MASKE = 2047;
const ARMORY_INDEX_MASKE = 1023;
/** Ergebnis-Puffer der Suche je Speicherstand: Eintraege und Gesamtzahl der Positionen. */
const ARMORY_SUCH_CACHE_MAX = 256;
const ARMORY_SUCH_CACHE_INTS = 2_000_000;
/** Eimer eines Buchstabenpaars (UTF-16-Einheiten): Hash ueber beide Einheiten, 16 Bit. */
function eimerVon(a: number, b: number): number {
  return Math.imul((a << 16) | b, 0x9e3779b1) >>> 16;
}
/** Immer ausgeschlossen, auch wenn die Konfiguration keinen `standard-konto`-Block hat. */
const FESTE_STANDARDKONTEN = ['gast', 'guest', 'admin'];
/** Laengste `ruestung`-Zeichenkette, die wir dekodieren (echte Werte sind unter 500 Zeichen). */
const RUESTUNG_MAX_ZEICHEN = 1000;
/** Laenge des Suchbegriffs in Zeichen (Namen haben hoechstens 24). */
export const ARMORY_SUCHE_MAX = 32;
/** Groesster Spielerzustand, den wir parsen; darueber gilt er als unlesbar. */
const DATEN_MAX_ZEICHEN = 4 * 1024 * 1024;
/** So viele Inventarstapel werden hoechstens angesehen. */
const INVENTAR_MAX = 1000;
/** Laengste Aussehens-Kennung, die wir weiterreichen. */
const KENNUNG_MAX = 40;

/** Das Aussehen, soweit die Webvorschau es braucht. */
export interface ArmoryAussehen {
  figur: string;
  frisur: string;
  haarfarbe: string;
  augenfarbe: string;
}

/** Ein Listeneintrag. Nur der Charaktername, nie etwas vom Konto. */
export interface ArmoryEintrag {
  id: number;
  name: string;
  klasse: string;
  aussehen: ArmoryAussehen;
  /** Zeitstempel in ms. */
  erstellt: number;
  /** Zeitstempel in ms; null, wenn der Charakter noch nie gespielt wurde. */
  zuletztGespielt: number | null;
}

export interface ArmoryListe {
  eintraege: ArmoryEintrag[];
  /** Die ausgelieferte Seite, ab 1 (eine zu grosse Anfrage ergibt die letzte). */
  seite: number;
  seitenGroesse: number;
  /** Alle Treffer ueber alle Seiten. */
  gesamt: number;
  /** Zahl der Seiten, mindestens 1. */
  seiten: number;
  /** Die tatsaechlich angewandte Suche (gefaltet); '' wenn keine Suche gilt, auch bei einem zu kurzen `q`. */
  suche: string;
}

/** Ein angelegtes Stueck. */
export interface ArmoryStueck {
  /** Item-Kennung (`ItemShared.name`). */
  kennung: string;
  /** Anzeigename als Rueckfall; mit `textKey` gilt der Katalogtext. */
  name: string;
  /** Katalogschluessel des Namens (`inhalt.item.*`), falls das Item einen hat. */
  textKey?: string;
  seltenheit: Rarity;
  itemStufe: number;
  qualitaet: number;
  werte: ItemStats;
  /** Relativer Pfad des Symbols, so wie der Spielclient es laedt; null ohne gueltigen Namen. */
  symbol: string | null;
}

/** Abgeleitete Werte der angelegten Ausruestung (Formeln aus shared/src/items/stats.ts). */
export interface ArmoryWerte {
  damage: number;
  armor: number;
  strength: number;
  vitality: number;
  agility: number;
  /** Lebensmaximum ohne Essensbonus. */
  lebenMax: number;
  /** Schaden eines Schlags gegen Wesen: Waffenschaden mit Staerke. */
  nahkampfSchaden: number;
}

export interface ArmoryProfil extends ArmoryEintrag {
  ausruestung: Partial<Record<AusruestungsSlot, ArmoryStueck>>;
  /** Die getragene Waffe, null = Faust. */
  waffe: ArmoryStueck | null;
  werte: ArmoryWerte;
  /** Profiltext, nur beim Avatar-Charakter des Kontos. */
  profil?: string;
  // Folgt, sobald das Spiel es speichert; bis dahin fehlen die Felder in der Antwort.
  stufe?: number;
  erfahrung?: number;
  tode?: number;
  spielzeitMinuten?: number;
  fertigkeiten?: { name: string; stufe: number }[];
}

/** Alle sichtbaren Charaktere zu einem Zeitpunkt, in Anzeigereihenfolge; Suche und Seiten sind Array-Arbeit. */
interface Aufnahme {
  zeilen: ArmoryZeile[];
  /** Gefaltete Namen, gleiche Reihenfolge wie `zeilen`. */
  gefaltet: string[];
  nachId: Map<number, ArmoryZeile>;
  /**
   * Suchindex fester Groesse: die Buchstabenpaare (UTF-16) jedes Namens fallen in ARMORY_EIMER Eimer (Hash). `offsets`/`ids`
   * sind das CSR-Feld dazu: Eimer b liegt in `ids[offsets[b]..offsets[b+1]]`, aufsteigend, je Name hoechstens einmal.
   * Der Speicher haengt nur von der Zahl der Namen und ihrer Laenge ab, nie von der Vielfalt der Zeichen.
   */
  index: { offsets: Int32Array; ids: Int32Array };
  /** Ergebnisse je normalisiertem `q` (Positionen in `zeilen`); lebt und stirbt mit dem Stand. */
  suchCache: Map<string, Int32Array>;
  suchCacheZahl: number;
  /** Fingerabdruck der Sichtbarkeit beim Bau. */
  stempel: string;
  gebaut: number;
  bis: number;
}

export class Armory {
  /** Uhr in ms; Tests setzen sie. */
  uhr: () => number = () => Date.now();
  private aufnahme: Aufnahme | null = null;
  /** Fertige Profile ohne Profiltext, je ARMORY_CACHE_MS gueltig; fliegen auch mit einer neuen Aufnahme hinaus. */
  private readonly profile = new Map<number, { bis: number; wert: ArmoryProfil }>();
  private readonly drosselung = new Map<string, { anzahl: number; bis: number }>();
  /** Groesse der Drosselkarte; Tests verkleinern sie. */
  drosselKarteMax = DROSSEL_KARTE_MAX;
  /** Messwerte des Neubaus in Haeppchen (fuer Tests und Betriebsanzeige). */
  readonly statistik = { schritte: 0, laengsterSchrittMs: 0, neubauten: 0, suchKandidaten: 0, suchTreffer: 0, indexBytes: 0 };
  /** Nach einem Fehler des Neubaus fruehestens ab diesem Zeitpunkt (ms, `uhr`) ein neuer Versuch. */
  private sperreBis = 0;
  /** Der laufende Neubau des Speicherstands (in Haeppchen), sonst null. */
  private lauf: Generator<void, Aufnahme> | null = null;
  /** Benutzernamen, die nie erscheinen: die der Konfiguration PLUS die fest eingebauten. */
  private readonly ausgeschlossen: ReadonlySet<string>;

  constructor(
    private readonly db: Kontendatenbank,
    /** Benutzernamen der Standardkonten aus der Konfiguration; ihre Charaktere erscheinen nie. */
    konfiguriert: readonly string[],
  ) {
    this.ausgeschlossen = new Set([...FESTE_STANDARDKONTEN, ...konfiguriert].map(falte));
  }

  /**
   * Zweite Linie gegen Last: je Herkunft hoechstens ARMORY_DROSSEL_MAX
   * Anfragen je ARMORY_DROSSEL_FENSTER_MS. Hinter einem Proxy kommt die
   * Herkunft aus `X-Forwarded-For` (net/Herkunft.ts); die Webseite, die
   * serverseitig ueber Loopback fragt, teilt sich eine Herkunft.
   */
  erlaubt(herkunft: string): boolean {
    const jetzt = this.uhr();
    if (this.drosselung.size >= this.drosselKarteMax && !this.drosselung.has(herkunft)) {
      for (const [k, e] of this.drosselung) if (e.bis <= jetzt) this.drosselung.delete(k);
      // Gesperrte Herkuenfte werden nie verdraengt: sonst setzte eine Flut fremder Schluessel eine Sperre zurueck.
      // Verdraengt wird der aelteste NICHT gesperrte Eintrag.
      if (this.drosselung.size >= this.drosselKarteMax) {
        for (const [k, e] of this.drosselung) {
          if (e.anzahl <= ARMORY_DROSSEL_MAX) { this.drosselung.delete(k); break; }
        }
      }
      // Notbremse: besteht die Karte nur noch aus gesperrten Herkuenften, kommt keine neue hinein
      // und jede unbekannte Herkunft wird abgewiesen, bis ein Fenster ablaeuft.
      if (this.drosselung.size >= this.drosselKarteMax) return false;
    }
    const e = this.drosselung.get(herkunft);
    if (!e || e.bis <= jetzt) {
      this.drosselung.set(herkunft, { anzahl: 1, bis: jetzt + ARMORY_DROSSEL_FENSTER_MS });
      return true;
    }
    e.anzahl += 1;
    return e.anzahl <= ARMORY_DROSSEL_MAX;
  }

  /** `seiteRoh` und `qRoh` sind die ungeprueften Query-Werte. Wirft nie bei Eingaben; null, solange der erste Speicherstand noch gebaut wird. */
  liste(seiteRoh: unknown, qRoh: unknown): ArmoryListe | null {
    const lage = this.aktuelleAufnahme();
    if (!lage) return null; // der erste Aufbau laeuft noch, oder ein Fehler sperrt kurz
    const a = lage.stand;
    // Weniger als ARMORY_SUCHE_MIN Zeichen (nach Faltung, in Codepunkten) sind keine Suche: die Antwort ist die der Liste ohne Suche.
    let suche = bereinigeSuche(qRoh);
    if (Array.from(suche).length < ARMORY_SUCHE_MIN) suche = '';
    const treffer = suche === '' ? null : this.sucheIn(a, suche);
    const gesamt = treffer ? treffer.length : a.zeilen.length;
    const seiten = Math.max(1, Math.ceil(gesamt / ARMORY_SEITENGROESSE));
    // Die Seite wird auf den gueltigen Bereich begrenzt, bevor irgendetwas von ihr abhaengt.
    const seite = Math.min(bereinigeSeite(seiteRoh), seiten);
    const von = (seite - 1) * ARMORY_SEITENGROESSE;
    const bis = Math.min(gesamt, von + ARMORY_SEITENGROESSE);
    let zeilen: ArmoryZeile[] = [];
    for (let p = von; p < bis; p++) zeilen.push(a.zeilen[treffer ? treffer[p] : p]);
    // Ist bekannt, dass sich die Sichtbarkeit seit dem Bau des Stands geaendert hat (Loeschen, Bann, neuer Charakter),
    // wird jeder ausgelieferte Eintrag vor der Antwort gegen die Datenbank geprueft: Geloeschte und Gebannte erscheinen
    // nie, auch wenn der Stand uralt ist. Die Zahlen (`gesamt`, `seiten`) bleiben die des Stands.
    if (lage.unsicher) {
      const jetzt = this.uhr();
      zeilen = zeilen.filter((z) => this.db.armoryEinzeln(z.id, jetzt) !== null);
    }
    return { eintraege: zeilen.map(baueEintrag), seite, seitenGroesse: ARMORY_SEITENGROESSE, gesamt, seiten, suche };
  }

  /**
   * Positionen aller Namen, die `q` (schon gefaltet) enthalten. Aus dem Ergebnis-Puffer, sonst ueber den Paar-Index:
   * die kuerzeste Liste der Buchstabenpaare von `q` liefert die Kandidaten, nur die werden geprueft. Einzelne
   * Zeichen werden gescannt (es gibt nur wenige verschiedene, ihr Ergebnis steht dann im Puffer).
   */
  private sucheIn(a: Aufnahme, q: string): Int32Array {
    const alt = a.suchCache.get(q);
    if (alt) {
      this.statistik.suchTreffer += 1;
      return alt;
    }
    // Kandidaten: der kleinste Eimer unter den Buchstabenpaaren von `q`; Kollisionen schaden nicht, jeder Kandidat wird geprueft.
    const { offsets, ids } = a.index;
    let von = 0;
    let bis = 0;
    let kleinste = Infinity;
    for (let i = 0; i + 2 <= q.length; i++) {
      const b = eimerVon(q.charCodeAt(i), q.charCodeAt(i + 1));
      const n = offsets[b + 1] - offsets[b];
      if (n < kleinste) { kleinste = n; von = offsets[b]; bis = offsets[b + 1]; }
    }
    this.statistik.suchKandidaten += bis - von;
    const l: number[] = [];
    for (let k = von; k < bis; k++) if (a.gefaltet[ids[k]].includes(q)) l.push(ids[k]);
    const ergebnis = Int32Array.from(l);
    if (ergebnis.length <= ARMORY_SUCH_CACHE_INTS) {
      if (a.suchCache.size >= ARMORY_SUCH_CACHE_MAX || a.suchCacheZahl + ergebnis.length > ARMORY_SUCH_CACHE_INTS) {
        a.suchCache.clear();
        a.suchCacheZahl = 0;
      }
      a.suchCache.set(q, ergebnis);
      a.suchCacheZahl += ergebnis.length;
    }
    return ergebnis;
  }

  /** Das Profil, oder null (unbekannt, geloescht, gebannt, Standardkonto). */
  profil(id: number): ArmoryProfil | null {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    // Die Sichtbarkeit eines Profils wird bei JEDEM Aufruf an der Datenbank geprueft (eine Zeile, billig):
    // Geloeschte und gebannte Charaktere verschwinden sofort, auch wenn die Liste noch eine Sekunde alt ist.
    const zeile = this.db.armoryEinzeln(id, this.uhr());
    if (!zeile || this.ausgeschlossen.has(falte(zeile.kontoName))) return null;
    const jetzt = this.uhr();
    let basis = this.profile.get(id);
    if (!basis || basis.bis <= jetzt) {
      this.profile.delete(id);
      basis = { bis: jetzt + ARMORY_CACHE_MS, wert: baueProfil(zeile, this.db.armorySpielerdaten(zeile.spielerId)) };
      if (this.profile.size >= ARMORY_CACHE_MAX) {
        const aeltester = this.profile.keys().next();
        if (!aeltester.done) this.profile.delete(aeltester.value);
      }
      this.profile.set(id, basis);
    }
    // Profiltext und Avatar werden bei JEDEM Aufruf gelesen, nie gepuffert: ein Avatarwechsel
    // gilt sofort, und der Text haengt nie an einem anderen Charakter.
    const ergebnis: ArmoryProfil = { ...basis.wert };
    if (this.db.avatarVon(zeile.kontoId) === zeile.id) {
      const text = this.db.profilTextVon(zeile.kontoId);
      if (text !== '') ergebnis.profil = text.slice(0, PROFILTEXT_MAX);
    }
    return ergebnis;
  }

  /** Wartet, bis kein Neubau mehr laeuft (fuer Tests und geordnetes Beenden). */
  async bereit(): Promise<void> {
    while (this.lauf) await new Promise<void>((ok) => setImmediate(ok));
  }

  /**
   * Der Speicherstand und ob bekannt ist, dass sich die Sichtbarkeit seit seinem Bau geaendert hat (`unsicher`);
   * null vor dem allerersten Stand. Ist ein Neubau faellig, wird er in Haeppchen gestartet (siehe `bauePlan`); bis er
   * fertig ist, gilt der alte Stand, bei `unsicher` nur mit Pruefung jedes ausgelieferten Eintrags. So blockiert
   * kein Neubau den Faden des Spielservers, auch nicht bei 100 000 Charakteren, und ein geloeschter oder gebannter
   * Charakter erscheint nie laenger als etwa ARMORY_NEUBAU_MIN_MS, auch nach einer Stunde ohne Aufruf.
   */
  private aktuelleAufnahme(): { stand: Aufnahme; unsicher: boolean } | null {
    const jetzt = this.uhr();
    const alt = this.aufnahme;
    if (!alt) {
      if (!this.lauf && jetzt >= this.sperreBis) this.starteNeubau(jetzt, this.db.armoryStempel());
      return null;
    }
    // Hoechstens ein Neubau je ARMORY_NEUBAU_MIN_MS: wer Charaktere anlegt und loescht, soll Neubauten nicht
    // je Anfrage erzwingen koennen. Ein Stand, der juenger ist, gilt ohne Pruefung des Stempels.
    if (alt.bis > jetzt && jetzt - alt.gebaut < ARMORY_NEUBAU_MIN_MS) return { stand: alt, unsicher: false };
    const stempel = this.db.armoryStempel();
    const geaendert = stempel !== alt.stempel;
    if (!this.lauf && (alt.bis <= jetzt || geaendert) && jetzt >= this.sperreBis) this.starteNeubau(jetzt, stempel);
    return { stand: alt, unsicher: geaendert };
  }

  private starteNeubau(jetzt: number, stempel: string): void {
    this.statistik.neubauten += 1;
    this.lauf = this.bauePlan(jetzt, stempel);
    setImmediate(() => this.schritt());
  }

  /** Ein Zeitstueck Arbeit (hoechstens ARMORY_SCHRITT_MS), dann gibt der Faden frei. */
  private schritt(): void {
    const lauf = this.lauf;
    if (!lauf) return;
    const t0 = performance.now();
    try {
      for (;;) {
        const r = lauf.next();
        if (r.done || performance.now() - t0 >= ARMORY_SCHRITT_MS) {
          this.statistik.schritte += 1;
          this.statistik.laengsterSchrittMs = Math.max(this.statistik.laengsterSchrittMs, performance.now() - t0);
        }
        if (r.done) {
          this.aufnahme = r.value;
          this.profile.clear();
          this.lauf = null;
          return;
        }
        if (performance.now() - t0 >= ARMORY_SCHRITT_MS) break;
      }
    } catch (e) {
      this.lauf = null; // der alte Stand bleibt; ein neuer Versuch fruehestens nach ARMORY_NEUBAU_MIN_MS
      this.sperreBis = this.uhr() + ARMORY_NEUBAU_MIN_MS;
      console.error('[Armory] Neubau des Speicherstands fehlgeschlagen:', e);
      return;
    }
    setImmediate(() => this.schritt());
  }

  /**
   * Der Neubau als Generator: jedes `yield` ist eine Stelle, an der der Faden freigegeben werden darf. Die Zeilen
   * kommen seitenweise nach Id (Primaerschluessel, billig), dann wird in Laeufen sortiert und die Laeufe werden
   * schrittweise gemischt; jedes Stueck Arbeit liegt im Bereich von Millisekunden, unabhaengig vom Bestand.
   * Eine Obergrenze gibt es nicht.
   */
  private *bauePlan(jetzt: number, stempel: string): Generator<void, Aufnahme> {
    const gebannt = this.db.armoryBanns(jetzt);
    const roh: ArmoryZeile[] = [];
    for (let nach = 0; ;) {
      const teil = this.db.armorySeite(nach, ARMORY_SEITE_ZEILEN);
      if (teil.length === 0) break;
      for (const z of teil) {
        if (gebannt.konten.has(String(z.kontoId)) || gebannt.spieler.has(z.spielerId.toLowerCase())) continue;
        if (this.ausgeschlossen.has(falte(z.kontoName))) continue;
        roh.push(z);
      }
      nach = teil[teil.length - 1].id;
      yield;
    }
    let laeufe: ArmoryZeile[][] = [];
    for (let i = 0; i < roh.length; i += ARMORY_LAUF) {
      const lauf = roh.slice(i, i + ARMORY_LAUF);
      lauf.sort(anzeigeReihenfolge);
      laeufe.push(lauf);
      yield;
    }
    while (laeufe.length > 1) {
      const gemischt: ArmoryZeile[][] = [];
      for (let i = 0; i < laeufe.length; i += 2) {
        if (i + 1 === laeufe.length) { gemischt.push(laeufe[i]); continue; }
        const x = laeufe[i];
        const y = laeufe[i + 1];
        const m: ArmoryZeile[] = new Array<ArmoryZeile>(x.length + y.length);
        let p = 0;
        let q = 0;
        let k = 0;
        while (p < x.length && q < y.length) {
          m[k++] = anzeigeReihenfolge(x[p], y[q]) <= 0 ? x[p++] : y[q++];
          if ((k & ARMORY_MISCH_MASKE) === 0) yield;
        }
        while (p < x.length) { m[k++] = x[p++]; if ((k & ARMORY_MISCH_MASKE) === 0) yield; }
        while (q < y.length) { m[k++] = y[q++]; if ((k & ARMORY_MISCH_MASKE) === 0) yield; }
        gemischt.push(m);
        yield;
      }
      laeufe = gemischt;
    }
    const zeilen = laeufe[0] ?? [];
    const gefaltet: string[] = [];
    const nachId = new Map<number, ArmoryZeile>();
    for (let i = 0; i < zeilen.length; i++) {
      gefaltet.push(falte(zeilen[i].name));
      nachId.set(zeilen[i].id, zeilen[i]);
      if ((i & ARMORY_MISCH_MASKE) === ARMORY_MISCH_MASKE) yield;
    }
    // Suchindex fester Groesse (CSR ueber ARMORY_EIMER Eimer), in zwei Durchgaengen in Haeppchen: zaehlen, dann fuellen.
    const offsets = new Int32Array(ARMORY_EIMER + 1);
    const zuletzt = new Int32Array(ARMORY_EIMER).fill(-1);
    for (let i = 0; i < gefaltet.length; i++) {
      const g = gefaltet[i];
      for (let c = 0; c + 2 <= g.length; c++) {
        const b = eimerVon(g.charCodeAt(c), g.charCodeAt(c + 1));
        if (zuletzt[b] !== i) { zuletzt[b] = i; offsets[b + 1]++; }
      }
      if ((i & ARMORY_INDEX_MASKE) === ARMORY_INDEX_MASKE) yield;
    }
    for (let b = 0; b < ARMORY_EIMER; b++) offsets[b + 1] += offsets[b];
    yield;
    const ids = new Int32Array(offsets[ARMORY_EIMER]);
    const fuell = offsets.slice(0, ARMORY_EIMER);
    zuletzt.fill(-1);
    for (let i = 0; i < gefaltet.length; i++) {
      const g = gefaltet[i];
      for (let c = 0; c + 2 <= g.length; c++) {
        const b = eimerVon(g.charCodeAt(c), g.charCodeAt(c + 1));
        if (zuletzt[b] !== i) { zuletzt[b] = i; ids[fuell[b]++] = i; }
      }
      if ((i & ARMORY_INDEX_MASKE) === ARMORY_INDEX_MASKE) yield;
    }
    this.statistik.indexBytes = offsets.byteLength + ids.byteLength;
    const index = { offsets, ids };
    return {
      zeilen, gefaltet, nachId, index, suchCache: new Map(), suchCacheZahl: 0, stempel, gebaut: jetzt, bis: jetzt + ARMORY_CACHE_MS,
    };
  }
}

/** Anzeigereihenfolge: zuletzt gespielt absteigend (nie Gespielte zuletzt), dann neuere zuerst, dann Id. */
function anzeigeReihenfolge(a: ArmoryZeile, b: ArmoryZeile): number {
  return (b.zuletztGespielt ?? 0) - (a.zuletztGespielt ?? 0) || b.erstellt - a.erstellt || b.id - a.id;
}

/** Namensvergleich ohne Rücksicht auf Schreibung und Unicode-Form (NFC, klein). */
function falte(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/** Seite ab 1; alles Unlesbare, Negative oder Riesige wird zu einer brauchbaren Zahl. */
export function bereinigeSeite(roh: unknown): number {
  if (typeof roh !== 'string' || !/^[0-9]{1,30}$/.test(roh)) return 1;
  return Math.min(1_000_000_000, Math.max(1, Number(roh)));
}

/** Suchbegriff: getrimmt, auf ARMORY_SUCHE_MAX Zeichen gekuerzt, NFC und klein. Leer = keine Suche. */
export function bereinigeSuche(roh: unknown): string {
  if (typeof roh !== 'string') return '';
  return falte(Array.from(roh.trim()).slice(0, ARMORY_SUCHE_MAX).join(''));
}

/** Ein Aussehenswert aus dem Spielstand gilt nur, wenn die Kennung zu den erlaubten gehoert; sonst die Konten-Zeile. */
function kennung(wert: unknown, erlaubt: (id: unknown) => boolean, vorgabe: string): string {
  return typeof wert === 'string' && wert.length <= KENNUNG_MAX && erlaubt(wert) ? wert : vorgabe;
}

export function baueEintrag(z: ArmoryZeile): ArmoryEintrag {
  return {
    id: z.id,
    name: z.name,
    klasse: z.klasse,
    aussehen: { figur: z.figur, frisur: z.frisur, haarfarbe: z.haarfarbe, augenfarbe: z.augenfarbe },
    erstellt: z.erstellt,
    zuletztGespielt: z.zuletztGespielt,
  };
}

/** `daten` ist der JSON-Text des Spielerzustands oder null; kaputter Text ergibt ein Profil ohne Ausruestung. */
export function baueProfil(z: ArmoryZeile, daten: string | null): ArmoryProfil {
  const gespeichert = liesZustand(daten);
  const eintrag = baueEintrag(z);
  // Das Aussehen im Spielstand ist juenger als die Zeile beim Anlegen des Charakters.
  eintrag.aussehen = {
    figur: kennung(gespeichert.figur, istFigur, z.figur),
    frisur: kennung(gespeichert.frisur, istFrisur, z.frisur),
    haarfarbe: kennung(gespeichert.haarfarbe, istHaarfarbe, z.haarfarbe),
    augenfarbe: kennung(gespeichert.augenfarbe, istAugenfarbe, z.augenfarbe),
  };

  // Nur ANGELEGTE Stapel (`equipped === true`) mit bekanntem Item zaehlen.
  const ausruestung: Partial<Record<AusruestungsSlot, ArmoryStueck>> = {};
  const hand = new Map<string, ArmoryStueck>();
  let ersteHand: string | null = null;
  const stapel = Array.isArray(gespeichert.inventar) ? gespeichert.inventar.slice(0, INVENTAR_MAX) : [];
  for (const roh of stapel) {
    if (!roh || typeof roh !== 'object' || (roh as Record<string, unknown>).equipped !== true) continue;
    const s = roh as Record<string, unknown>;
    const item = typeof s.name === 'string' ? findItem(s.name) : undefined;
    if (!item) continue;
    const slot = item.ausruestung ?? SLOT_VORGABE;
    if (!istAusruestungsSlot(slot)) continue;
    const stueck = baueStueck(item, s.quality);
    if (slot === 'waffe') {
      if (!hand.has(item.name)) hand.set(item.name, stueck);
      ersteHand ??= item.name;
    } else ausruestung[slot as AusruestungsSlot] ??= stueck;
  }
  // Die Hand wie der Spielserver (WovServer, Laden): `waffe` im Spielstand gilt, sonst der erste angelegte Handstapel.
  // Ein angelegter Stapel, der nicht die Waffe ist (z. B. Holz), erscheint nicht.
  const waffenName = typeof gespeichert.waffe === 'string' ? gespeichert.waffe : ersteHand;
  const waffe = (waffenName !== null && hand.get(waffenName)) || null;

  return {
    ...eintrag,
    ausruestung: Object.fromEntries(
      AUSRUESTUNG_SLOTS.filter((d) => d.id !== 'waffe' && ausruestung[d.id]).map((d) => [d.id, ausruestung[d.id]]),
    ),
    waffe,
    werte: leiteWerteAb(gespeichert.ruestung, waffe),
  };
}

function liesZustand(daten: string | null): Record<string, unknown> {
  if (daten === null || daten.length > DATEN_MAX_ZEICHEN) return {};
  try {
    const wert: unknown = JSON.parse(daten);
    return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function baueStueck(item: ItemShared, qualitaetRoh: unknown): ArmoryStueck {
  const stueck: ArmoryStueck = {
    kennung: item.name,
    name: item.label,
    seltenheit: istRarity(item.rarity) ? item.rarity : 'common',
    itemStufe: zahl(item.itemLevel, 1),
    qualitaet: qualitaet(qualitaetRoh),
    werte: nurStatistiken(item.stats),
    symbol: symbolPfad(item.icon),
  };
  if (item.textKey) stueck.textKey = item.textKey;
  return stueck;
}

function zahl(wert: unknown, vorgabe: number): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : vorgabe;
}

/** Qualitaet ist eine kleine Spielzahl; Werte ausserhalb 0..1000 werden gekappt. */
function qualitaet(wert: unknown): number {
  return Math.min(1000, Math.max(0, zahl(wert, 0)));
}

function nurStatistiken(stats: ItemStats | undefined): ItemStats {
  const aus: ItemStats = {};
  for (const id of STAT_IDS) {
    const w = stats?.[id];
    if (typeof w === 'number' && Number.isFinite(w)) aus[id] = w;
  }
  return aus;
}

/**
 * Wo der Spielclient das Symbol laedt: `/assets/sprites/<icon>.png`
 * (client/src/ui/Hotbar.ts). Der Name darf nur aus harmlosen Zeichen
 * bestehen, weil Items auch aus Daten kommen und der Pfad in einen Link geht.
 */
function symbolPfad(icon: unknown): string | null {
  return typeof icon === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(icon) ? `/assets/sprites/${icon}.png` : null;
}

/**
 * Wie der Spielserver rechnet (Peer.ruestung): Rueckwaerts aus dem Aussehens-
 * Eintrag der Ruestung, plus der Schaden der Waffe. Ein fehlendes oder
 * kaputtes `ruestung` ergibt "nichts angelegt".
 */
function leiteWerteAb(ruestung: unknown, waffe: ArmoryStueck | null): ArmoryWerte {
  const teile = typeof ruestung === 'string' && ruestung.length <= RUESTUNG_MAX_ZEICHEN ? Object.values(decodeArmor(ruestung)) : [];
  const summe: Werte = teile.length > 0 ? summiereWerte(teile.map((id) => werteFuerRuestungsteil(id))) : KEINE_WERTE;
  const schaden = waffenSchaden(waffe?.werte);
  return {
    damage: schaden,
    armor: summe.armor,
    strength: summe.strength,
    vitality: summe.vitality,
    agility: summe.agility,
    lebenMax: lebensmaximum(summe.vitality, 0),
    nahkampfSchaden: ausgehenderNahkampfSchaden(schaden, summe.strength),
  };
}
