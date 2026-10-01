/**
 * Kern der 3D-Figur: aus dem Aussehen eines Recken wird ein Ladeplan, und eine
 * Steuerung führt ihn gegen das Vorschau-Bündel aus. Kein DOM, kein Babylon:
 * Bündel, WebGL-Probe und Bildtakt kommen von außen, damit der Ablauf mit
 * Attrappen prüfbar ist (`reckenVorschauKern.test.ts`).
 *
 * Die Abläufe stammen unverändert aus der Charaktererstellung; sie sind nur
 * herausgezogen, damit Erstellen und Rüstkammer dieselbe Figur zeigen.
 */

import { canWearArmor } from '../../../shared/src/armorCompatibility';
import type { EquipmentSetCatalog } from '../../../shared/src/equipmentSets';

/** Ein Eintrag aus `assets/appearance.json` (Feldnamen englisch, Drahtformat). */
export interface Eintrag {
  /** sRGB-Hex, nur bei Haarfarben belegt. */
  hex?: string;
  id: string;
  name: string;
  nameEn?: string;
  file?: string;
  model?: string;
  slot?: string;
  figure?: string;
}

/** `assets/appearance.json`, soweit die Figur es braucht. */
export interface AussehenDaten {
  folder: string;
  body: string;
  figures: Eintrag[];
  hairstyles: Eintrag[];
  beards: Eintrag[];
  eyebrows: Eintrag[];
  hairColors: Eintrag[];
  eyeColors: Eintrag[];
  equipment: Eintrag[];
  equipmentSets?: EquipmentSetCatalog['sets'];
  defaultFigure?: string;
  defaultHairstyle?: string;
  defaultBeard?: string;
  defaultEyebrows?: Record<string, string>;
  defaultHairColor?: string;
  defaultEyeColor?: string;
  timeOfDay?: { marks: Record<string, string> };
}

export type Waffenart = 'schwert' | 'stab';

/** Was vom Vorschau-Bündel benutzt wird — gemessen an `vorschau.js`. */
export interface VorschauApi {
  setzeWurzel(url: string): Promise<void>;
  ladeKoerper(pfad: string): Promise<boolean>;
  setzeWaffe(art: Waffenart | null): Promise<void>;
  setze(slot: string, datei: string | null): Promise<void>;
  /** sRGB-Hex; leer lässt die Farbe des Modells stehen. */
  setzeHaarfarbe(hex: string): void;
  setzeAugenfarbe(id: string): void;
  drehe(winkel: number): void;
  blickZurueck(): void;
  /** Optional: ein noch gecachtes älteres Bündel kennt den Kopf-Zoom nicht. */
  zoomeKopf?(nah?: boolean): void;
  beiKopfZustand?: ((zustand: KopfZustand) => void) | null;
  dispose(): void;
}

export interface KopfZustand {
  nah: boolean;
  ueber: boolean;
  gueltig?: boolean;
}

export interface BuendelModul {
  Vorschau: new (leinwand: HTMLCanvasElement, wurzel: string) => VorschauApi;
}

/** Cache-Kennung für die zusammengehörigen Figurenliste und 3D-Vorschau. */
export const FIGUREN_STAND = 'ruestungen-plainhide-gravethorn-v2-20260924';
/** sessionStorage: Der Kopf-Zoom wurde in dieser Sitzung schon einmal benutzt. */
export const KOPFZOOM_SPEICHER = 'wov-kopfzoom';
export const MODELL_WURZEL = '/assets/models/';
export const BUENDEL_PFAD = `/assets/js/vorschau.js?v=${FIGUREN_STAND}`;
export const AUSSEHEN_PFAD = `/assets/appearance.json?v=${FIGUREN_STAND}`;
/** Die Vorschau kennt sieben Rüstungsplätze (`klassenruestung-0` … `-6`). */
export const RUESTUNGS_PLAETZE = 7;

/* ----------------------------------------------------------- Aussehen */

/**
 * Das Aussehen, wie es die Rüstkammer kennt. `frisur` darf die Drahtform der
 * Erstellung tragen: `H_04+B_02+AM_01` (Frisur, Bart, Augenbraue).
 */
export interface FigurAussehen {
  klasse: string;
  figur: string;
  frisur: string;
  haarfarbe: string;
  augenfarbe: string;
  bart?: string;
  augenbraue?: string;
}

/**
 * Ein angelegtes Stück: nur die Gegenstandskennung zählt (`kennung` des
 * Rüstkammer-Endpunkts, z. B. `IronwardHelmet`). `name` ist dort der
 * Anzeigename und taugt nicht zur Zuordnung; das Feld gibt es hier bewusst nicht.
 */
export interface AusruestungsStueck {
  kennung: string;
}

export interface RuestungsTeil {
  datei: string;
  regionen: readonly string[];
  slot: string;
}

/** Zerlegt `H_04+B_02+AM_01`; eine Kennung ohne `+` ist nur die Frisur. */
export function zerlegeFrisur(
  daten: Pick<AussehenDaten, 'beards' | 'eyebrows'>,
  roh: string,
): { frisur: string; bart: string; augenbraue: string } {
  const teile = roh.split('+').filter(Boolean);
  const frisur = teile[0] ?? '';
  let bart = '';
  let augenbraue = '';
  for (const teil of teile.slice(1)) {
    if (daten.beards.some((e) => e.id === teil)) bart = teil;
    else if (daten.eyebrows.some((e) => e.id === teil)) augenbraue = teil;
  }
  return { frisur, bart, augenbraue };
}

/** H_01 ist das alte, hinter dem neuen Wikingerkopf schwebende Haarteil. */
export function frisurenFuer(daten: AussehenDaten | null, figur: string): Eintrag[] {
  return daten?.hairstyles.filter((eintrag) => figur !== 'wikinger' || eintrag.id !== 'H_01') ?? [];
}

export function augenbrauenFuer(daten: AussehenDaten | null, figur: string): Eintrag[] {
  return daten?.eyebrows?.filter((a) => a.figure === figur) ?? [];
}

export function brauenVorgabe(daten: AussehenDaten | null, figur: string): string {
  return daten?.defaultEyebrows?.[figur] ?? augenbrauenFuer(daten, figur)[0]?.id ?? '';
}

export function dateiFuer(
  daten: AussehenDaten | null,
  liste: Eintrag[],
  id: string,
): string | null {
  const e = liste.find((x) => x.id === id);
  return e?.file && daten ? `${daten.folder}/${e.file}` : null;
}

/** Das Körpermodell der gewählten Figur, relativ zu /assets/models/. */
export function koerperDatei(daten: AussehenDaten | null, figur: string): string {
  const ausgewaehlt = daten?.figures.find((eintrag) => eintrag.id === figur);
  return ausgewaehlt?.model ?? (daten ? `${daten.folder}/${daten.body}` : '');
}

export function waffeFuerKlasse(id: string): Waffenart | null {
  if (id === 'krieger') return 'schwert';
  if (id === 'druide') return 'stab';
  return null;
}

/** Belegt die sieben Plätze der Reihe nach; ein ausgeblendeter Helm wird zu `null`. */
export function ruestungsPlaetze(
  teile: readonly RuestungsTeil[] | undefined,
  helmAus: boolean,
): (string | null)[] {
  return Array.from({ length: RUESTUNGS_PLAETZE }, (_, index) => {
    const teil = teile?.[index];
    return teil && !(helmAus && teil.slot === 'kopf') ? teil.datei : null;
  });
}

/**
 * Die angelegten Stücke eines Recken als Rüstungsteile. Erkannt wird ein Stück
 * an seiner `kennung` gegen die Gegenstandskennung (`itemId`) eines Teils aus
 * `equipmentSets`, ohne Rücksicht auf Groß-/Kleinschreibung. Es zählen Sets,
 * die der Körper der Figur tragen darf (`canWearArmor`, wie im Bündel).
 * Waffen, Schmuck und Unbekanntes bleiben draußen. Je Körperplatz zählt ein
 * Stück; bei mehreren gewinnt das später genannte.
 */
export function ruestungAusStuecken(
  daten: AussehenDaten | null,
  figur: string,
  stuecke: readonly AusruestungsStueck[] | undefined,
): RuestungsTeil[] {
  if (!daten?.equipmentSets || !stuecke?.length) return [];
  const teile = new Map<string, RuestungsTeil>();
  for (const set of daten.equipmentSets) {
    if (!canWearArmor(set, figur)) continue;
    for (const teil of set.parts) {
      teile.set(teil.itemId.toLowerCase(), {
        datei: teil.model.replace(/\.glb$/, ''),
        regionen: teil.regions,
        slot: teil.appearanceSlot,
      });
    }
  }
  const jePlatz = new Map<string, RuestungsTeil>();
  for (const stueck of stuecke) {
    const kennung = typeof stueck?.kennung === 'string' ? stueck.kennung.toLowerCase() : '';
    const teil = teile.get(kennung);
    if (teil) jePlatz.set(teil.slot, teil);
  }
  return [...jePlatz.values()].slice(0, RUESTUNGS_PLAETZE);
}

/** Alles, was die Figur braucht, als Dateien und Farben. */
export interface LadePlan {
  klasse: string;
  koerper: string;
  waffe: Waffenart | null;
  frisur: string | null;
  bart: string | null;
  augenbraue: string | null;
  /** sRGB-Hex; leer lässt die Farbe des Modells stehen. */
  haarton: string;
  augenfarbe: string;
  ruestung: (string | null)[];
}

export interface PlanOptionen {
  teile?: readonly RuestungsTeil[];
  helmAus?: boolean;
}

export function baueLadePlan(
  daten: AussehenDaten,
  a: FigurAussehen,
  opt: PlanOptionen = {},
): LadePlan {
  const frisuren = frisurenFuer(daten, a.figur);
  return {
    klasse: a.klasse,
    koerper: koerperDatei(daten, a.figur),
    waffe: waffeFuerKlasse(a.klasse),
    frisur:
      dateiFuer(daten, frisuren, a.frisur) ?? dateiFuer(daten, frisuren, frisuren[0]?.id ?? ''),
    // Bärte gibt es im Master nur für den männlichen Grundkörper.
    bart: a.figur === 'wikinger' ? dateiFuer(daten, daten.beards ?? [], a.bart ?? '') : null,
    augenbraue: dateiFuer(daten, daten.eyebrows ?? [], a.augenbraue ?? ''),
    haarton: (daten.hairColors ?? []).find((h) => h.id === a.haarfarbe)?.hex ?? '',
    augenfarbe: a.augenfarbe,
    ruestung: ruestungsPlaetze(opt.teile, opt.helmAus ?? false),
  };
}

/**
 * Plan für ein gespeichertes Aussehen (Rüstkammer): zerlegt die Drahtform der
 * Frisur und legt die angelegten Rüstungsstücke dazu. Fehlende Angaben fallen
 * auf die Vorgaben aus `appearance.json` zurück.
 */
export function planFuerRecke(
  daten: AussehenDaten,
  aussehen: FigurAussehen,
  ausruestung?: readonly AusruestungsStueck[],
): LadePlan {
  const figur = daten.figures.some((f) => f.id === aussehen.figur)
    ? aussehen.figur
    : (daten.defaultFigure ?? daten.figures[0]?.id ?? '');
  const text = (wert: unknown) => (typeof wert === 'string' ? wert : '');
  const z = zerlegeFrisur(daten, text(aussehen.frisur));
  return baueLadePlan(
    daten,
    {
      klasse: text(aussehen.klasse),
      haarfarbe: text(aussehen.haarfarbe),
      augenfarbe: text(aussehen.augenfarbe),
      figur,
      frisur: z.frisur,
      bart: aussehen.bart ?? (z.bart || daten.defaultBeard || ''),
      augenbraue: aussehen.augenbraue ?? (z.augenbraue || brauenVorgabe(daten, figur)),
    },
    {
      teile: ruestungAusStuecken(
        daten,
        figur,
        Array.isArray(ausruestung) ? ausruestung : undefined,
      ),
    },
  );
}

/* ---------------------------------------------------------- Steuerung */

export type FigurFehler =
  | { art: 'kein-webgl' }
  | { art: 'buendel'; fehler: unknown }
  /** `url`: das Körpermodell, wenn dessen Laden scheiterte; sonst leer. */
  | { art: 'laden'; fehler: unknown; url: string };

export interface SteuerungAbhaengigkeiten {
  ladeBuendel: () => Promise<BuendelModul>;
  hatWebGL: () => boolean;
  /** Wartet auf gezeichnete Bilder; Standard sind drei `requestAnimationFrame`. */
  warteBilder?: (anzahl?: number) => Promise<void>;
  wurzel?: string;
}

export interface SteuerungRueckrufe {
  beiFertig?: (fertig: boolean) => void;
  beiFehler?: (fehler: FigurFehler | null) => void;
  beiKopf?: (zustand: KopfZustand) => void;
  /** Das Bündel kennt den Kopf-Zoom (ein altes, gecachtes nicht). */
  beiKopfZoomBereit?: (bereit: boolean) => void;
  /** Ein einzelnes Rüstungsteil ließ sich nicht anlegen; sein Platz wurde geleert. */
  beiTeilFehler?: (slot: string, datei: string, fehler: unknown) => void;
}

function standardWarteBilder(anzahl = 3): Promise<void> {
  return new Promise((resolve) => {
    const weiter = () => {
      anzahl -= 1;
      if (anzahl <= 0) resolve();
      else requestAnimationFrame(weiter);
    };
    requestAnimationFrame(weiter);
  });
}

/**
 * Hält genau eine Vorschau-Engine. Jeder Ladevorgang trägt eine Laufnummer,
 * damit ein älterer keine neuere Wahl überschreibt; `dispose()` entsorgt die
 * Engine und lässt alles Spätere ins Leere laufen.
 */
export class FigurSteuerung {
  vorschau: VorschauApi | null = null;
  private ladeLauf = 0;
  private ruestungsLauf = 0;
  private zerstoert = false;
  private aufbau: Promise<boolean> | null = null;
  private readonly wurzel: string;

  constructor(
    private readonly abh: SteuerungAbhaengigkeiten,
    private readonly rueckruf: SteuerungRueckrufe = {},
  ) {
    this.wurzel = abh.wurzel ?? MODELL_WURZEL;
  }

  /**
   * Baut die Engine auf. Ohne WebGL oder ohne ladbares Bündel bleibt es bei
   * `false` und einem gemeldeten Fehler; es entsteht keine Engine.
   */
  starte(leinwand: HTMLCanvasElement): Promise<boolean> {
    if (this.zerstoert) return Promise.resolve(false);
    // Zwei gleichzeitige Aufrufe teilen sich einen Aufbau: nie zwei Engines.
    if (!this.aufbau) {
      const aufbau = this.baueAuf(leinwand);
      this.aufbau = aufbau;
      // Ein gescheiterter Aufbau (kein WebGL, Bündel fehlt) darf neu versucht werden.
      void aufbau.then((ok) => {
        if (!ok && this.aufbau === aufbau) this.aufbau = null;
      });
    }
    return this.aufbau;
  }

  private async baueAuf(leinwand: HTMLCanvasElement): Promise<boolean> {
    if (this.zerstoert) return false;
    if (this.vorschau) return true;
    if (!this.abh.hatWebGL()) {
      this.rueckruf.beiFehler?.({ art: 'kein-webgl' });
      return false;
    }
    try {
      const modul = await this.abh.ladeBuendel();
      // Verlassen, während das Bündel lud: keine Engine mehr anlegen.
      if (this.zerstoert) return false;
      const vorschau = new modul.Vorschau(leinwand, this.wurzel);
      this.vorschau = vorschau;
      this.rueckruf.beiKopfZoomBereit?.(typeof vorschau.zoomeKopf === 'function');
      vorschau.beiKopfZustand = (zustand) => this.rueckruf.beiKopf?.(zustand);
      return true;
    } catch (fehler) {
      this.rueckruf.beiFehler?.({ art: 'buendel', fehler });
      return false;
    }
  }

  private warte(): Promise<void> {
    return (this.abh.warteBilder ?? standardWarteBilder)();
  }

  async zeigeAussehen(plan: () => LadePlan, lauf?: number): Promise<boolean> {
    const vorschau = this.vorschau;
    if (!vorschau) return false;
    const istAktuell = () => lauf === undefined || lauf === this.ladeLauf;
    if (!istAktuell()) return false;
    await vorschau.setze('frisur', plan().frisur);
    if (!istAktuell()) return false;
    await vorschau.setze('bart', plan().bart);
    if (!istAktuell()) return false;
    await vorschau.setze('augenbraue', plan().augenbraue);
    if (!istAktuell()) return false;
    // Die Haarfarbe ist kein Modell, sondern eine Tönung auf dem Frisurmodell
    // — deshalb NACH der Frisur und über einen eigenen Weg.
    const p = plan();
    vorschau.setzeHaarfarbe(p.haarton);
    vorschau.setzeAugenfarbe(p.augenfarbe);
    return istAktuell();
  }

  /** Legt die Rüstung des Plans an oder räumt sie ab (alle sieben Plätze). */
  async zeigeRuestung(plan: () => LadePlan, lauf?: number): Promise<boolean> {
    const vorschau = this.vorschau;
    if (!vorschau) return false;
    const aufruf = ++this.ruestungsLauf;
    const istAktuell = () =>
      (lauf === undefined || lauf === this.ladeLauf) && aufruf === this.ruestungsLauf;
    // Der Plan wird im selben Atemzug gelesen: Die Vorschau setzt jeden Platz
    // sofort, der letzte Aufruf gewinnt.
    const plaetze = plan().ruestung;
    await Promise.all(
      Array.from({ length: RUESTUNGS_PLAETZE }, (_, index) =>
        vorschau.setze(`klassenruestung-${index}`, plaetze[index] ?? null),
      ),
    );
    return istAktuell();
  }

  /**
   * Wie `zeigeRuestung`, aber ein Teil, das sich nicht anlegen lässt (etwa weil
   * es nicht zum Körper passt), leert nur seinen Platz und wird gemeldet; die
   * übrigen Teile und die Figur bleiben. Für das Profil, wo niemand zurückschalten kann.
   */
  async zeigeRuestungNachsichtig(plan: () => LadePlan, lauf?: number): Promise<boolean> {
    const vorschau = this.vorschau;
    if (!vorschau) return false;
    const aufruf = ++this.ruestungsLauf;
    const istAktuell = () =>
      (lauf === undefined || lauf === this.ladeLauf) && aufruf === this.ruestungsLauf;
    const plaetze = plan().ruestung;
    await Promise.all(
      Array.from({ length: RUESTUNGS_PLAETZE }, async (_, index) => {
        const slot = `klassenruestung-${index}`;
        const datei = plaetze[index] ?? null;
        try {
          await vorschau.setze(slot, datei);
        } catch (fehler) {
          // Ein überholter oder entsorgter Lauf rührt den Platz nicht mehr an: Er
          // gehört inzwischen einem neueren Lauf, oder die Engine ist weg.
          if (!istAktuell()) return;
          if (datei) this.rueckruf.beiTeilFehler?.(slot, datei, fehler);
          try {
            await vorschau.setze(slot, null);
          } catch {
            /* der Platz bleibt, wie er ist */
          }
        }
      }),
    );
    return istAktuell();
  }

  async setzeWaffe(art: Waffenart | null): Promise<void> {
    await this.vorschau?.setzeWaffe(art);
  }

  /** Körper, Waffe, Aussehen und Rüstung der Reihe nach; `true`, wenn alles steht. */
  async ladeAlles(plan: () => LadePlan): Promise<boolean> {
    const vorschau = this.vorschau;
    if (!vorschau) return false;
    const lauf = ++this.ladeLauf;
    const istAktuell = () => lauf === this.ladeLauf;
    this.rueckruf.beiFertig?.(false);
    this.rueckruf.beiFehler?.(null);
    // Nur beim Körper ist seine Adresse die richtige Auskunft über den Fehler.
    let koerperUrl = '';
    try {
      await vorschau.setzeWurzel(this.wurzel);
      if (!istAktuell()) return false;
      const koerper = plan().koerper;
      koerperUrl = `${this.wurzel}${koerper}.glb`;
      const geladen = await vorschau.ladeKoerper(koerper);
      koerperUrl = '';
      if (!geladen || !istAktuell()) return false;
      await vorschau.setzeWaffe(plan().waffe);
      if (!istAktuell()) return false;
      if (!(await this.zeigeAussehen(plan, lauf))) return false;
      if (!(await this.zeigeRuestungNachsichtig(plan, lauf))) return false;
      // Während Frisur und Kleidung nachladen, kann bereits eine andere Klasse
      // gewählt worden sein. Solange abgleichen, bis genau diese Wahl samt
      // Haltung fertig ist; danach drei echte Renderframes warten.
      while (true) {
        const abgeglichen = plan();
        await vorschau.setzeWaffe(abgeglichen.waffe);
        if (!istAktuell()) return false;
        await this.warte();
        if (!istAktuell()) return false;
        if (plan().klasse === abgeglichen.klasse) break;
      }
      this.rueckruf.beiFertig?.(true);
      return true;
    } catch (fehler) {
      if (!istAktuell() || this.zerstoert) return false;
      this.rueckruf.beiFertig?.(false);
      this.rueckruf.beiFehler?.({ art: 'laden', fehler, url: koerperUrl });
      return false;
    }
  }

  drehe(winkel: number): void {
    this.vorschau?.drehe(winkel);
  }

  blickZurueck(): void {
    this.vorschau?.blickZurueck();
  }

  zoomeKopf(nah?: boolean): void {
    this.vorschau?.zoomeKopf?.(nah);
  }

  /** Entsorgt die Engine; spätere Aufrufe und noch laufende Ladevorgänge laufen ins Leere. */
  dispose(): void {
    this.zerstoert = true;
    this.ladeLauf += 1;
    this.ruestungsLauf += 1;
    const vorschau = this.vorschau;
    this.vorschau = null;
    vorschau?.dispose();
  }
}

/* ------------------------------------------------ WebGL und Sichtbarkeit */

/** Fragt, ob ein WebGL-Kontext möglich ist; der Probe-Kontext wird gleich freigegeben. */
export function webGLVerfuegbar(
  erzeuge: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  try {
    const probe = erzeuge();
    const gl = (probe.getContext('webgl2') ??
      probe.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export interface SichtbarkeitsBeobachter {
  observe(ziel: Element): void;
  disconnect(): void;
}

export type SichtbarkeitsFabrik = new (
  rueckruf: (eintraege: { isIntersecting: boolean }[]) => void,
  optionen?: { rootMargin?: string },
) => SichtbarkeitsBeobachter;

/**
 * Meldet `true`, sobald das Element in die Nähe des Bildschirms kommt. Ohne
 * `IntersectionObserver` gilt es sofort als sichtbar. Gibt die Abmeldung zurück.
 */
export function ueberwacheSichtbarkeit(
  ziel: Element,
  beiSichtbar: () => void,
  fabrik: SichtbarkeitsFabrik | undefined = (
    globalThis as { IntersectionObserver?: SichtbarkeitsFabrik }
  ).IntersectionObserver,
): () => void {
  if (!fabrik) {
    beiSichtbar();
    return () => {};
  }
  const beobachter = new fabrik(
    (eintraege) => {
      if (eintraege.some((e) => e.isIntersecting)) {
        beobachter.disconnect();
        beiSichtbar();
      }
    },
    { rootMargin: '200px' },
  );
  beobachter.observe(ziel);
  return () => beobachter.disconnect();
}

/**
 * Setzt `{name}`-Platzhalter aus dem Katalog. Was nicht besetzt ist, bleibt
 * unverändert stehen — das ist sichtbar und damit reparierbar.
 */
export function fuelle(vorlage: string, werte: Record<string, string | number>): string {
  return vorlage.replace(/\{(\w+)\}/g, (ganz: string, name: string) =>
    name in werte ? String(werte[name]) : ganz,
  );
}
