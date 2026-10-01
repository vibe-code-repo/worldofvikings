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
  istAusruestungsSlot, istRarity, lebensmaximum, summiereWerte, waffenSchaden, werteFuerRuestungsteil,
  type AusruestungsSlot, type ItemShared, type ItemStats, type Rarity, type Werte,
} from '@wov/shared';
import { PROFILTEXT_MAX, type ArmoryZeile, type Kontendatenbank } from './Kontendatenbank.js';

/** Eintraege je Seite der Liste (fest, der Aufrufer kann sie nicht waehlen). */
export const ARMORY_SEITENGROESSE = 24;
/** Lebensdauer eines gepufferten Ergebnisses, s. Kopfkommentar. */
export const ARMORY_CACHE_MS = 30_000;
/** Hoechstzahl gepufferter Ergebnisse; ist sie erreicht, fliegt das aelteste hinaus. */
export const ARMORY_CACHE_MAX = 256;
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

type Eintrag<T> = { bis: number; wert: T };

export class Armory {
  /** Uhr in ms; Tests setzen sie. */
  uhr: () => number = () => Date.now();
  private readonly puffer = new Map<string, Eintrag<unknown>>();
  private stempel = '';

  constructor(
    private readonly db: Kontendatenbank,
    /** Benutzernamen der Standardkonten; ihre Charaktere erscheinen nie. */
    private readonly ausgeschlossen: readonly string[],
  ) {}

  /** `seiteRoh` und `qRoh` sind die ungeprueften Query-Werte. Wirft nie bei Eingaben. */
  liste(seiteRoh: unknown, qRoh: unknown): ArmoryListe {
    const suche = bereinigeSuche(qRoh);
    const gewuenscht = bereinigeSeite(seiteRoh);
    return this.gepuffert(`l:${gewuenscht}:${suche}`, () => {
      const jetzt = this.uhr();
      let seite = gewuenscht;
      let r = this.db.armoryZeilen({
        suche, ausgeschlossen: this.ausgeschlossen, limit: ARMORY_SEITENGROESSE,
        offset: (seite - 1) * ARMORY_SEITENGROESSE, jetzt,
      });
      const seiten = Math.max(1, Math.ceil(r.gesamt / ARMORY_SEITENGROESSE));
      if (seite > seiten) {
        seite = seiten;
        r = this.db.armoryZeilen({
          suche, ausgeschlossen: this.ausgeschlossen, limit: ARMORY_SEITENGROESSE,
          offset: (seite - 1) * ARMORY_SEITENGROESSE, jetzt,
        });
      }
      return {
        eintraege: r.zeilen.map(baueEintrag), seite, seitenGroesse: ARMORY_SEITENGROESSE, gesamt: r.gesamt, seiten,
      };
    });
  }

  /** Das Profil, oder null (unbekannt, geloescht, gebannt, Standardkonto). */
  profil(id: number): ArmoryProfil | null {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    // Die Sichtbarkeit wird bei JEDEM Aufruf an der Datenbank geprueft; gepuffert wird nur das teure Abbild.
    const zeile = this.db.armoryZeile(id, this.ausgeschlossen, this.uhr());
    if (!zeile) return null;
    return this.gepuffert(`p:${id}`, () => {
      const profil = baueProfil(zeile, this.db.armorySpielerdaten(zeile.spielerId));
      if (this.db.avatarVon(zeile.kontoId) === zeile.id) {
        const text = this.db.profilTextVon(zeile.kontoId);
        if (text !== '') profil.profil = text.slice(0, PROFILTEXT_MAX);
      }
      return profil;
    });
  }

  private gepuffert<T>(schluessel: string, berechne: () => T): T {
    const jetzt = this.uhr();
    const stempel = this.db.armoryStempel();
    if (stempel !== this.stempel) {
      this.puffer.clear();
      this.stempel = stempel;
    }
    const alt = this.puffer.get(schluessel) as Eintrag<T> | undefined;
    if (alt && alt.bis > jetzt) return alt.wert;
    const wert = berechne();
    if (alt) this.puffer.delete(schluessel);
    if (this.puffer.size >= ARMORY_CACHE_MAX) {
      for (const [k, e] of this.puffer) if (e.bis <= jetzt) this.puffer.delete(k);
      while (this.puffer.size >= ARMORY_CACHE_MAX) {
        const aeltester = this.puffer.keys().next();
        if (aeltester.done) break;
        this.puffer.delete(aeltester.value);
      }
    }
    this.puffer.set(schluessel, { bis: jetzt + ARMORY_CACHE_MS, wert });
    return wert;
  }
}

/** Seite ab 1; alles Unlesbare, Negative oder Riesige wird zu einer brauchbaren Zahl. */
export function bereinigeSeite(roh: unknown): number {
  if (typeof roh !== 'string' || !/^[0-9]{1,30}$/.test(roh)) return 1;
  return Math.min(1_000_000_000, Math.max(1, Number(roh)));
}

/** Suchbegriff: getrimmt, auf ARMORY_SUCHE_MAX Zeichen gekuerzt, kleingeschrieben. Leer = keine Suche. */
export function bereinigeSuche(roh: unknown): string {
  if (typeof roh !== 'string') return '';
  return Array.from(roh.trim()).slice(0, ARMORY_SUCHE_MAX).join('').toLowerCase();
}

function kennung(wert: unknown, vorgabe: string): string {
  return typeof wert === 'string' && wert.length > 0 && wert.length <= KENNUNG_MAX ? wert : vorgabe;
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
    figur: kennung(gespeichert.figur, z.figur),
    frisur: kennung(gespeichert.frisur, z.frisur),
    haarfarbe: kennung(gespeichert.haarfarbe, z.haarfarbe),
    augenfarbe: kennung(gespeichert.augenfarbe, z.augenfarbe),
  };

  const ausruestung: Partial<Record<AusruestungsSlot, ArmoryStueck>> = {};
  let waffe: ArmoryStueck | null = null;
  const stapel = Array.isArray(gespeichert.inventar) ? gespeichert.inventar.slice(0, INVENTAR_MAX) : [];
  for (const roh of stapel) {
    if (!roh || typeof roh !== 'object' || (roh as Record<string, unknown>).equipped !== true) continue;
    const s = roh as Record<string, unknown>;
    const item = typeof s.name === 'string' ? findItem(s.name) : undefined;
    if (!item) continue;
    const slot = item.ausruestung ?? SLOT_VORGABE;
    if (!istAusruestungsSlot(slot)) continue;
    const stueck = baueStueck(item, s.quality);
    if (slot === 'waffe') waffe ??= stueck;
    else ausruestung[slot as AusruestungsSlot] ??= stueck;
  }

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
    qualitaet: zahl(qualitaetRoh, 0),
    werte: nurStatistiken(item.stats),
    symbol: symbolPfad(item.icon),
  };
  if (item.textKey) stueck.textKey = item.textKey;
  return stueck;
}

function zahl(wert: unknown, vorgabe: number): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : vorgabe;
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
  const teile = typeof ruestung === 'string' ? Object.values(decodeArmor(ruestung)) : [];
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
