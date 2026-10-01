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
 * ── Puffer ────────────────────────────────────────────────────────────
 * Antworten liegen ARMORY_CACHE_MS im Speicher. 30 s, weil der Spielerzustand
 * hoechstens alle 30 s geschrieben wird (SpielerSicherung): Die Anzeige ist
 * damit hoechstens rund eine Minute alt (Puffer plus Schreibabstand), und ein
 * kuerzerer Puffer brachte keine frischeren Daten, nur mehr JSON-Parsen. Das
 * Abbild eines Charakters kostet einen Parse von `spielerzustand.daten`; ohne
 * Puffer wuerde jeder Seitenaufruf eines Besuchers (oder eines Schleifenskripts)
 * die Datenbank belasten. Die Groesse ist begrenzt, damit verschiedene
 * Suchbegriffe den Speicher nicht fuellen koennen. Aendert sich, wer sichtbar
 * ist (Loeschung, Bann, neuer Charakter), wird der Puffer sofort geleert.
 */
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
    if (this.drosselung.size >= DROSSEL_KARTE_MAX) {
      for (const [k, e] of this.drosselung) if (e.bis <= jetzt) this.drosselung.delete(k);
      while (this.drosselung.size >= DROSSEL_KARTE_MAX) {
        const aeltester = this.drosselung.keys().next();
        if (aeltester.done) break;
        this.drosselung.delete(aeltester.value);
      }
    }
    const e = this.drosselung.get(herkunft);
    if (!e || e.bis <= jetzt) {
      this.drosselung.set(herkunft, { anzahl: 1, bis: jetzt + ARMORY_DROSSEL_FENSTER_MS });
      return true;
    }
    e.anzahl += 1;
    return e.anzahl <= ARMORY_DROSSEL_MAX;
  }

  /** `seiteRoh` und `qRoh` sind die ungeprueften Query-Werte. Wirft nie bei Eingaben. */
  liste(seiteRoh: unknown, qRoh: unknown): ArmoryListe {
    const a = this.aktuelleAufnahme();
    const suche = bereinigeSuche(qRoh);
    let treffer: ArmoryZeile[];
    if (suche === '') treffer = a.zeilen;
    else {
      treffer = [];
      for (let i = 0; i < a.zeilen.length; i++) if (a.gefaltet[i].includes(suche)) treffer.push(a.zeilen[i]);
    }
    const seiten = Math.max(1, Math.ceil(treffer.length / ARMORY_SEITENGROESSE));
    // Die Seite wird auf den gueltigen Bereich begrenzt, bevor irgendetwas von ihr abhaengt.
    const seite = Math.min(bereinigeSeite(seiteRoh), seiten);
    const von = (seite - 1) * ARMORY_SEITENGROESSE;
    return {
      eintraege: treffer.slice(von, von + ARMORY_SEITENGROESSE).map(baueEintrag),
      seite, seitenGroesse: ARMORY_SEITENGROESSE, gesamt: treffer.length, seiten,
    };
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

  private aktuelleAufnahme(): Aufnahme {
    const jetzt = this.uhr();
    const alt = this.aufnahme;
    // Ein Neubau kostet bei grossem Bestand zig Millisekunden; wer Charaktere anlegt und loescht, soll ihn nicht
    // je Anfrage erzwingen koennen. Daher hoechstens einer je ARMORY_NEUBAU_MIN_MS, auch bei geaendertem Stempel.
    if (alt && alt.bis > jetzt && jetzt - alt.gebaut < ARMORY_NEUBAU_MIN_MS) return alt;
    const stempel = this.db.armoryStempel();
    if (alt && alt.stempel === stempel && alt.bis > jetzt) return alt;
    const zeilen = this.db.armoryAlle(jetzt).filter((z) => !this.ausgeschlossen.has(falte(z.kontoName)));
    const neu: Aufnahme = {
      zeilen,
      gefaltet: zeilen.map((z) => falte(z.name)),
      nachId: new Map(zeilen.map((z) => [z.id, z])),
      stempel,
      gebaut: jetzt,
      bis: jetzt + ARMORY_CACHE_MS,
    };
    this.aufnahme = neu;
    this.profile.clear();
    return neu;
  }
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
