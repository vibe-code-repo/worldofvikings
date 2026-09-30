/**
 * Spawn-Panel des 3D-Testflugs — ein richtiges Editor-Interface:
 * durchsuchbare Liste ALLER platzierbaren Prefabs (Vegetation, Felsen,
 * Bauteile, freie Suche über die ganze Registry), dazu Drehung, Abstand
 * und Größe. Muster: DungeonEditor (reines DOM, Callback-Interface,
 * keine Socket-/Szenen-Kopplung).
 *
 * Seit Block A ist „platzierbar" enger als „steht in der Registry":
 * Gesetzt werden darf nur, was in EIGENE_MODELLE steht
 * (istEigenesModell). Alles andere bleibt in der Liste STEHEN,
 * ausgegraut und ohne Klick. Es ganz zu streichen wäre die kürzere
 * Lösung und ist verworfen: Ein spurlos fehlender Eintrag liest sich wie
 * ein eigener Tippfehler, und wer den Fehler bei sich sucht, findet ihn
 * nicht. Ohne beides fiele es erst im Boot-Log des Servers auf, wenn
 * pruefeLayout die fertige Welt zurückweist.
 *
 * Bedienung im Testflug: B öffnet/schließt (Esc gibt den Cursor frei).
 * Platziert wird NUR im aktiven Platzier-Modus: Ein Klick auf einen
 * Listeneintrag startet ihn (Geist hängt an der Maus), Klick/P setzt
 * GENAU EINMAL und beendet den Modus wieder — nach dem Setzen hängt
 * nichts mehr an der Maus. Abbruch ohne Setzen: zweiter Klick auf den
 * Eintrag, Esc oder Rechtsklick. Ohne aktiven Modus setzt ein Klick in
 * die Welt NICHTS — der zuletzt gewählte Eintrag bleibt nur Vorauswahl.
 */
import {
  FOLIAGE,
  BAU_PREFABS,
  PREFABS_BY_NAME,
  EIGENE_MODELLE,
  FRAKTIONEN,
  NPC_ROLLEN,
  QUEST_ZUSTAENDE,
  NPC_NAME_MAX,
  NPC_STUFE_MAX,
  NPC_STUFE_MIN,
  istEigenesModell,
  istNpcPrefab,
  istStoreModell,
  loeseNpcAuf,
  STORE_MODELL_NAMEN,
} from '@wov/shared';
import type { Fraktion, NpcDef, NpcRolle, QuestZustand } from '@wov/shared';
// GrabhuegelGras teilt sich per MODELL_ALIAS die GLB von Grabhuegel (s.
// AssetManager.ts) -- ohne diese Konsultation zeigt vorschauBild() auf
// eine nie erzeugte GrabhuegelGras.png und faellt auf reinen Text zurueck.
import { MODELL_ALIAS } from '../engine/AssetManager';
import { SKALA_MAX, SKALA_MIN } from './testflug/vorschauZeichnen';
import { ladeSerie, speichereSerie } from './testflug/greifen';
import {
  klemmeRadius,
  klemmeZiel,
  ZIEL_MAX,
  ZIEL_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  RADIUS_START,
  STAERKE_MAX,
  STAERKE_MIN,
  STAERKE_START,
  type Werkzeug,
} from './testflug/gelaendePinsel';
import { t } from './i18n';
import type { TranslationKey } from '../i18n';

export interface SpawnEinstellung {
  prefab: string;
  /** Radiant; null = zufällige Drehung je Platzierung. */
  yaw: number | null;
  /** Abstand vor dem Spieler in Metern. */
  abstand: number;
  scale: number;
  /** Untergrund unter der Grundfläche einebnen (Sockel im Layout). */
  einebnen: boolean;
  /** Series: place mode stays on after a placement (Esc or right click ends it). */
  serie: boolean;
}

/** Settings of the terrain tab (brush tool, radius in m, strength in cm per stamp). */
export interface GelaendeEinstellung {
  werkzeug: Werkzeug;
  radius: number;
  staerke: number;
  /** Target ground height of the level tool in m (pipette or number field); `null` = not chosen yet. */
  ziel: number | null;
}

export interface SpawnPanelCallbacks {
  platzieren: () => void;
  entferneLetztes: () => void;
  anzahl: () => number;
  /**
   * Tageszeit in Stunden (0–24) setzen und den Zyklus dabei anhalten.
   *
   * Ohne Anhalten wandert jeder eingestellte Wert sofort weiter — ein
   * Weltentag dauert im Spiel 30 Minuten, zum Beurteilen einer Szene bei
   * Sonnenuntergang ist das zu schnell.
   */
  setzeZeit?: (stunden: number, angehalten: boolean) => void;
  /** Aktuelle Tageszeit in Stunden, für die Anzeige beim Öffnen. */
  zeit?: () => number;
  /**
   * Die GEWÄHLTE (angeklickte) Platzierung — null, wenn keine gewählt ist.
   *
   * Die NPC-Felder hängen bewusst an der Auswahl und nicht an der
   * Vorauswahl der Liste: Ein Name gehört zu einer bestimmten Figur in der
   * Welt, nicht zu „der nächsten Völva, die ich setze". Wer die Angaben
   * einer neuen Figur ändern will, klickt sie an — derselbe Griff wie zum
   * Verschieben und Löschen.
   */
  gewaehlteNpc?: () => { prefab: string; npc?: NpcDef } | null;
  /**
   * Geänderte Angaben zurückschreiben; `undefined` entfernt das Feld
   * wieder (alles steht auf Prefab-Vorgabe).
   */
  setzeNpc?: (npc: NpcDef | undefined) => void;
  /** Button „In Welt speichern“ of the terrain tab: publish the draft (same way as the route editor). */
  speichernGelaende?: () => void;
}

/** Anzeigetexte der Listen aus shared/npc.ts (unbekanntes zeigt sich roh). */
const ROLLE_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  zivil: 'testflug.spawn.rolle.zivil',
  quest: 'testflug.spawn.rolle.quest',
  haendler: 'testflug.spawn.rolle.haendler',
  monster: 'testflug.spawn.rolle.monster',
};
const FRAKTION_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  neutral: 'testflug.spawn.fraktion.neutral',
  wikinger: 'testflug.spawn.fraktion.wikinger',
  sachsen: 'testflug.spawn.fraktion.sachsen',
  wild: 'testflug.spawn.fraktion.wild',
  muspel: 'testflug.spawn.fraktion.muspel',
};
const QUEST_SCHLUESSEL: Readonly<Record<string, TranslationKey>> = {
  keine: 'testflug.spawn.quest.keine',
  verfuegbar: 'testflug.spawn.quest.verfuegbar',
  laeuft: 'testflug.spawn.quest.laeuft',
  fertig: 'testflug.spawn.quest.fertig',
};

/**
 * N1 (Angriff „Editor T0a", Befund B5): vorher wurden `ROLLE_TEXT` u. a. als
 * `const … = Object.fromEntries(…, t(v))` beim MODUL-Laden gebaut — vor
 * jeder Sprachwahl der Sitzung. `schluesselText()` übersetzt jetzt erst beim
 * Aufruf (aus dem Panel-Konstruktor, s. u.), also mit der Sprache, die zu dem
 * Zeitpunkt gilt.
 */
function schluesselText(schluessel: Readonly<Record<string, TranslationKey>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(schluessel).map(([k, v]) => [k, t(v)]));
}

/**
 * Pfad zum Vorschaubild eines eigenen Modells (tools/vorschaubilder.py),
 * oder null ohne Modellnamen. Der <img>-Tag traegt selbst den Rueckfall
 * auf den reinen Namen (onerror entfernt ihn), falls unter
 * assets/vorschau/<Modell>.png nichts liegt — etwa weil das Bild noch
 * nicht neu erzeugt wurde.
 */
function vorschauBild(name: string): string | null {
  const modell = PREFABS_BY_NAME.get(name)?.model;
  if (!modell) return null;
  /*
    Für den Asset-Speicher gibt es keine Vorschaubilder —
    `tools/vorschaubilder.py` läuft über `assets/models/`, und der Store
    liegt woanders. Der `onerror`-Rückfall des <img> finge das zwar auf,
    aber um den Preis von bis zu 80 sinnlosen 404 je Listenseite. Ein
    Bild, von dem man weiss, dass es nicht existiert, fragt man nicht ab.
  */
  if (istStoreModell(modell)) return null;
  const datei = MODELL_ALIAS[modell] ?? modell;
  return `/assets/vorschau/${datei}.png`;
}

/**
 * Platzierbares nach vorn, Gesperrtes ans Ende; innerhalb beider Gruppen
 * bleibt die Reihenfolge, wie sie war.
 *
 * Nötig wegen des Fensters von 80 Zeilen: In „Alle (mit Modell)" stehen
 * 113 eigene Namen zwischen 3.557 fremden, in der Vegetation 54 zwischen
 * 97. Unsortiert bestünde die sichtbare Seite fast nur aus gesperrten
 * Zeilen — die Liste wäre als Werkzeug unbrauchbar, ohne dass man ihr
 * ansieht, warum.
 *
 * Verworfen: die Gesperrten gar nicht erst zurückgeben. Dann stünde in
 * „Bauteile" nur noch zwei von neun Einträgen, und niemand könnte
 * unterscheiden, ob die anderen sieben entfallen sind oder nie existiert
 * haben.
 */
function eigeneZuerst(namen: readonly string[]): string[] {
  return [
    ...namen.filter((n) => istEigenesModell(n)),
    ...namen.filter((n) => !istEigenesModell(n)),
  ];
}

/**
 * Die Store-Namen als Menge — einmal gebaut statt 569-mal gesucht.
 *
 * `listeFuellen()` läuft bei jedem Tastendruck im Suchfeld; ein
 * `includes` über 569 Namen je Zeile wäre eine Bremse, die man beim
 * Tippen spürt.
 */
const STORE_NAMEN_MENGE: ReadonlySet<string> = new Set(STORE_MODELL_NAMEN);

/**
 * N1 (Befund B5, wie oben): `nameSchluessel` statt eines beim Modul-Laden
 * schon übersetzten `name` — `t()` läuft erst am Aufbau der Auswahl (Panel-
 * Konstruktor), mit der zu dem Zeitpunkt aktiven Sprache.
 */
const KATEGORIEN: ReadonlyArray<{ nameSchluessel: TranslationKey; namen: () => string[] }> = [
  // Zuerst, und damit die Vorgabe beim Öffnen: die kurze Liste der selbst
  // erzeugten Modelle. In den anderen Kategorien gehen sie zwischen
  // hunderten Einträgen unter (die Liste zeigt nur die ersten 80).
  // Nicht vorhandene Namen werden gefiltert, damit ein Eintrag ohne
  // passende GLB die Auswahl nicht mit einer toten Zeile verstopft.
  {
    nameSchluessel: 'testflug.spawn.kategorie.eigene_modelle',
    namen: () =>
      EIGENE_MODELLE.filter((n) => PREFABS_BY_NAME.has(n) && !STORE_NAMEN_MENGE.has(n)),
  },
  /*
    Der Asset-Speicher als EIGENE Kategorie.

    Ohne sie wäre er zwar setzbar, aber unauffindbar: Er hängt in
    `EIGENE_MODELLE` hinten an 113 Altnamen, und die Liste zeigt 80
    Zeilen. Man müsste den Namen bereits kennen und ihn eintippen — genau
    der Zustand, gegen den „Eigene Modelle" seinerzeit eingeführt wurde.

    Die Suche darüber trägt hier mehr als anderswo: Die Namen sind nach
    Gruppe geordnet (`environment-sm-prop-barrel-…`), ein „barrel" im
    Suchfeld holt also das ganze Fach.
  */
  { nameSchluessel: 'testflug.spawn.kategorie.asset_speicher', namen: () => [...STORE_MODELL_NAMEN] },
  {
    nameSchluessel: 'testflug.spawn.kategorie.vegetation',
    namen: () => eigeneZuerst([...new Set(FOLIAGE.map((f) => f.prefabName))]),
  },
  { nameSchluessel: 'testflug.spawn.kategorie.bauteile', namen: () => eigeneZuerst([...BAU_PREFABS]) },
  {
    nameSchluessel: 'testflug.spawn.kategorie.alle_mit_modell',
    namen: () =>
      eigeneZuerst([...PREFABS_BY_NAME.values()].filter((d) => d.model).map((d) => d.name)),
  },
];

/**
 * Vorgabe der Vorauswahl. Hier stand 'Beech1' — eine Buche aus dem
 * Fremdexport, die es seit Block A nicht mehr gibt. Die hohe Birke ist
 * der nächstliegende Ersatz: derselbe Zweck (ein Laubbaum zum
 * Ausprobieren) und der erste Eintrag von EIGENE_MODELLE, also das, was
 * die Liste beim Öffnen ohnehin ganz oben zeigt.
 */
const VORGABE_PREFAB = 'BirkeHoch1';

/**
 * Vorauswahl der letzten Sitzung — aber nur, wenn sie noch ins Spiel
 * gehört.
 *
 * Jeder Browser, der den Editor vor Block A offen hatte, trägt einen
 * Fremdnamen in localStorage. Gesetzt bekäme man ihn zwar nicht (der
 * Platzier-Modus wird erst durch den Klick auf eine Listenzeile scharf,
 * und gesperrte Zeilen nehmen keinen Klick mehr an), aber er stünde in
 * der Fußzeile als „Vorauswahl: Beech1" — eine Angabe, die die Liste
 * darunter nirgends bestätigt.
 */
function vorauswahl(): string {
  const gemerkt = localStorage.getItem('wov-editor-spawn-prefab');
  return gemerkt !== null && istEigenesModell(gemerkt) ? gemerkt : VORGABE_PREFAB;
}

export class SpawnPanel {
  /** Wird bei jeder Änderung von Wahl/Modus gerufen — main.ts gleicht den Geist ab. */
  aufWahl: (() => void) | null = null;
  /** Called when the terrain tool turns on or off (tab change, panel closed, `beendeGelaendeModus`). */
  aufGelaende: (() => void) | null = null;
  /** Brush settings of the terrain tab. */
  readonly gelaendeEinstellung: GelaendeEinstellung = { werkzeug: 'anheben', radius: RADIUS_START, staerke: STAERKE_START, ziel: null };
  private tab: 'objekte' | 'gelaende' = 'objekte';
  private objekteBlock!: HTMLDivElement;
  private gelaendeBlock!: HTMLDivElement;
  private zielFeld: HTMLInputElement | null = null;
  private tabKnoepfe: Record<'objekte' | 'gelaende', HTMLButtonElement> | null = null;
  private werkzeugKnoepfe = new Map<Werkzeug, HTMLButtonElement>();
  private radiusRegler: HTMLInputElement | null = null;
  private radiusWert: HTMLSpanElement | null = null;
  /**
   * Platzier-Modus: erst der BEWUSSTE Klick auf einen Listeneintrag schaltet
   * ihn scharf. Ohne ihn ist `einstellung.prefab` reine Vorauswahl (aus
   * localStorage) — sonst hinge nach jedem Laden sofort ein Geist an der
   * Maus und jeder Klick in die Welt setzte ungewollt ein Objekt.
   */
  private modusAktiv = false;
  readonly einstellung: SpawnEinstellung = {
    prefab: vorauswahl(),
    yaw: null,
    abstand: 4,
    scale: 1,
    // Einebnen ist eine BEWUSSTE Entscheidung und startet immer AUS. Der
    // erste Anlauf (Vorgabe AN ab 8 m renderScale-Breite) griff daneben:
    // Die Breite misst z. B. bei Bäumen die KRONE, und weil erst der Klick
    // auf den Listeneintrag den Platzier-Modus scharf schaltet, überschrieb
    // die Vorgabe dabei jede Handabwahl — der Boden wurde trotz
    // abgewähltem Haken planiert.
    einebnen: false,
    serie: ladeSerie(),
  };
  private readonly root: HTMLDivElement;
  private readonly liste: HTMLDivElement;
  /** Zeile unter der Liste: wie viel der Kategorie gesperrt ist. */
  private readonly gesperrtZeile: HTMLDivElement;
  private readonly zaehler: HTMLDivElement;
  private suchtext = '';
  private kategorie = 0;
  // ── NPC-Felder (nur bei NPC-Prefabs sichtbar, s. npcAktualisiere) ──
  private readonly npcBlock: HTMLDivElement;
  private readonly npcName: HTMLInputElement;
  private readonly npcRolle: HTMLSelectElement;
  private readonly npcFraktion: HTMLSelectElement;
  private readonly npcStufe: HTMLInputElement;
  private readonly npcQuest: HTMLSelectElement;
  private readonly npcQuestZeile: HTMLDivElement;
  /** Prefab der Platzierung, die die Felder gerade zeigen ('' = keine). */
  private npcPrefab = '';
  /** Läuft der Tageszyklus gerade, oder steht er auf einem festen Wert? */
  private zeitAngehalten = false;
  private laufKasten: HTMLInputElement | null = null;

  constructor(private readonly cb: SpawnPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:60px;right:12px;width:280px;max-height:80vh;overflow-y:auto;' +
      'background:rgba(18,22,31,0.94);border:1px solid #3a3325;border-radius:6px;padding:10px;' +
      'font-family:Georgia,serif;font-size:13px;color:#d8cfa8;z-index:900;display:none;';
    // ── Kein Durchfallen ins Spiel ───────────────────────────────────
    // Klicks und Rad im Panel gehören ausschließlich dem Panel: Die
    // Spiel-Handler hängen auf window/document (Platzieren bei gefangener
    // Maus in main.ts, Kamera-Zoom im InputManager) und würden im Bubbling
    // sonst mitlaufen — der Auswahl-Klick dürfte dann selbst setzen bzw.
    // das Rad die Kamera zoomen statt die Liste zu scrollen.
    // pointerup/mouseup bleiben bewusst frei: Ein Drag, der auf dem Canvas
    // beginnt und über dem Panel endet, muss sein window-pointerup noch
    // bekommen (sonst klebt die gegriffene Platzierung an der Maus).
    for (const typ of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
      this.root.addEventListener(typ, (e) => e.stopPropagation());
    }
    this.root.addEventListener('contextmenu', (e) => {
      // Rechtsklick im Panel: weder Browser-Menü noch das „Verwerfen" des Spiels.
      e.preventDefault();
      e.stopPropagation();
    });
    const titel = document.createElement('div');
    titel.textContent = t('testflug.spawn.titel');
    titel.style.cssText = 'font-size:15px;color:#e8d48a;margin-bottom:6px;';
    this.root.appendChild(titel);

    // Tabs: the object list (everything below, moved into `objekteBlock` at the end
    // of this constructor) and the terrain brush.
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    const tabObjekte = this.knopf(t('testflug.gelaende.reiter_objekte'), () => this.setzeTab('objekte'));
    const tabGelaende = this.knopf(t('testflug.gelaende.reiter_gelaende'), () => this.setzeTab('gelaende'));
    this.tabKnoepfe = { objekte: tabObjekte, gelaende: tabGelaende };
    tabs.append(tabObjekte, tabGelaende);
    this.root.appendChild(tabs);

    // Kategorie + Suche
    const kat = document.createElement('select');
    kat.style.cssText = this.feldStil();
    KATEGORIEN.forEach((k, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = t(k.nameSchluessel);
      kat.appendChild(o);
    });
    kat.onchange = () => {
      this.kategorie = Number(kat.value);
      this.listeFuellen();
    };
    this.root.appendChild(kat);

    const suche = document.createElement('input');
    suche.placeholder = t('testflug.spawn.suchen_platzhalter');
    suche.style.cssText = this.feldStil();
    let sucheTimer: number | null = null;
    suche.oninput = () => {
      this.suchtext = suche.value.trim().toLowerCase();
      if (sucheTimer !== null) window.clearTimeout(sucheTimer);
      sucheTimer = window.setTimeout(() => this.listeFuellen(), 150);
    };
    this.root.appendChild(suche);

    this.liste = document.createElement('div');
    // overscroll-behavior: Am Listenende soll das Rad nicht ans Panel/die
    // Seite weiterreichen — sonst „springt" beim Durchscrollen der Prefabs
    // plötzlich das ganze Panel.
    this.liste.style.cssText =
      'max-height:220px;overflow-y:auto;overscroll-behavior:contain;' +
      'border:1px solid #3a3325;border-radius:4px;margin:4px 0;';
    this.root.appendChild(this.liste);

    // Die Quote gehört UNTER den Kasten, nicht hinein: Im Kasten wäre sie
    // eine Zeile unter 80 und beim ersten Scrollen weg — gefragt wird sie
    // aber genau dann, wenn man auf die grauen Zeilen schaut.
    this.gesperrtZeile = document.createElement('div');
    this.gesperrtZeile.style.cssText = 'font-size:10px;color:#9a8f6a;margin:-2px 0 2px;';
    this.root.appendChild(this.gesperrtZeile);

    // Drehung
    this.root.appendChild(this.label(t('testflug.spawn.drehung')));
    const drehZeile = document.createElement('div');
    drehZeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const dreh = document.createElement('input');
    dreh.type = 'range';
    dreh.min = '0';
    dreh.max = '360';
    dreh.value = '0';
    dreh.style.cssText = 'flex:1;';
    const drehWert = document.createElement('span');
    drehWert.textContent = t('testflug.spawn.zufaellig');
    drehWert.style.cssText = 'width:58px;font-size:11px;';
    const zufall = document.createElement('input');
    zufall.type = 'checkbox';
    zufall.checked = true;
    const drehAktualisieren = (): void => {
      this.einstellung.yaw = zufall.checked ? null : (Number(dreh.value) * Math.PI) / 180;
      drehWert.textContent = zufall.checked ? t('testflug.spawn.zufaellig') : `${dreh.value}°`;
    };
    dreh.oninput = () => {
      zufall.checked = false;
      drehAktualisieren();
    };
    zufall.onchange = drehAktualisieren;
    drehZeile.append(dreh, drehWert, zufall);
    this.root.appendChild(drehZeile);

    // Abstand + Größe
    this.root.appendChild(this.schieber(t('testflug.spawn.abstand_m'), 2, 20, 4, 1, (v) => (this.einstellung.abstand = v)));
    this.root.appendChild(this.schieber(t('testflug.spawn.groesse'), SKALA_MIN, SKALA_MAX, 1, 0.1, (v) => (this.einstellung.scale = v)));

    // ── Untergrund einebnen ──────────────────────────────────────────
    // Rein manuell: Der Haken gilt für die folgenden Platzierungen der
    // Sitzung und wird von der Prefab-Wahl NICHT angefasst — keine
    // Automatik, die eine Handabwahl übersteuern könnte (s. einstellung).
    const sockelZeile = document.createElement('div');
    sockelZeile.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;';
    const sockel = document.createElement('input');
    sockel.type = 'checkbox';
    sockel.checked = this.einstellung.einebnen;
    sockel.onchange = () => (this.einstellung.einebnen = sockel.checked);
    const sockelTxt = document.createElement('span');
    sockelTxt.textContent = t('testflug.spawn.untergrund_einebnen');
    sockelTxt.style.cssText = 'font-size:11px;color:#9a8f6a;';
    sockelZeile.append(sockel, sockelTxt);
    this.root.appendChild(sockelZeile);

    // ── Serie: Modus bleibt nach dem Setzen ──────────────────────────
    const serieZeile = document.createElement('div');
    serieZeile.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px;';
    const serie = document.createElement('input');
    serie.type = 'checkbox';
    serie.checked = this.einstellung.serie;
    serie.onchange = () => {
      this.einstellung.serie = serie.checked;
      speichereSerie(serie.checked);
      // Fokus abgeben: Sonst schaltet die Leertaste („Leer steigt“) den Haken um.
      serie.blur();
    };
    const serieTxt = document.createElement('span');
    serieTxt.textContent = t('testflug.spawn.serie');
    serieTxt.style.cssText = 'font-size:11px;color:#9a8f6a;';
    serieZeile.append(serie, serieTxt);
    this.root.appendChild(serieZeile);

    // ── NPC: Name, Rolle, Fraktion, Stufe, Quest ─────────────────────
    // Der ganze Block ist ausgeblendet, solange keine FIGUR gewählt ist
    // (istNpcPrefab) — bei Bäumen und Steinen wären fünf zusätzliche
    // Felder nur Wegstrecke zwischen Liste und „Platzieren".
    this.npcBlock = document.createElement('div');
    this.npcBlock.style.cssText =
      'display:none;margin-top:8px;padding-top:6px;border-top:1px solid #3a3325;';
    const npcTitel = document.createElement('div');
    npcTitel.textContent = t('testflug.spawn.npc.titel');
    npcTitel.style.cssText = 'font-size:12px;color:#e8d48a;margin-bottom:2px;';
    this.npcBlock.appendChild(npcTitel);

    this.npcBlock.appendChild(this.label(t('testflug.spawn.npc.name')));
    this.npcName = document.createElement('input');
    this.npcName.maxLength = NPC_NAME_MAX;
    this.npcName.style.cssText = this.feldStil();
    // `change` statt `input`: Bei jedem Tastenanschlag zu speichern hiesse,
    // die Platzierung im Entwurf und die Instanz in der Welt buchstabenweise
    // neu zu schreiben. Der Fokusverlust bzw. Enter genügt.
    this.npcName.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(this.npcName);

    this.npcRolle = this.npcAuswahl(t('testflug.spawn.npc.rolle'), NPC_ROLLEN, schluesselText(ROLLE_SCHLUESSEL));
    this.npcFraktion = this.npcAuswahl(t('testflug.spawn.npc.fraktion'), FRAKTIONEN, schluesselText(FRAKTION_SCHLUESSEL));

    this.npcBlock.appendChild(this.label(t('testflug.spawn.npc.stufe')));
    this.npcStufe = document.createElement('input');
    this.npcStufe.type = 'number';
    this.npcStufe.min = String(NPC_STUFE_MIN);
    this.npcStufe.max = String(NPC_STUFE_MAX);
    this.npcStufe.step = '1';
    this.npcStufe.value = '1';
    this.npcStufe.style.cssText = this.feldStil();
    this.npcStufe.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(this.npcStufe);

    // Quest-Zustand nur bei Rolle `quest`: Ein Händler mit „Quest läuft"
    // wäre eine Angabe, die nirgends gelesen wird (s. questZeichen).
    this.npcQuestZeile = document.createElement('div');
    this.npcQuestZeile.style.cssText = 'display:none;';
    this.npcQuestZeile.appendChild(this.label(t('testflug.spawn.npc.quest_zustand')));
    this.npcQuest = document.createElement('select');
    this.npcQuest.style.cssText = this.feldStil();
    const questText = schluesselText(QUEST_SCHLUESSEL);
    for (const q of QUEST_ZUSTAENDE) {
      const o = document.createElement('option');
      o.value = q;
      o.textContent = questText[q] ?? q;
      this.npcQuest.appendChild(o);
    }
    this.npcQuest.onchange = () => this.npcSchreiben();
    this.npcQuestZeile.appendChild(this.npcQuest);
    this.npcBlock.appendChild(this.npcQuestZeile);

    const npcTip = document.createElement('div');
    npcTip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    npcTip.textContent = t('testflug.spawn.npc.tip');
    this.npcBlock.appendChild(npcTip);
    this.root.appendChild(this.npcBlock);

    // ── Tageszeit ────────────────────────────────────────────────────
    // Am Regler zu ziehen hält den Zyklus an: Wer eine Szene bei
    // Sonnenuntergang beurteilen will, hat sonst zwei Minuten, bevor es
    // Nacht ist (ein Weltentag dauert 30 Minuten).
    if (this.cb.setzeZeit) {
      this.zeitAngehalten = false;
      const start = Math.round((this.cb.zeit?.() ?? 12) * 10) / 10;
      this.root.appendChild(
        this.schieber(t('testflug.spawn.tageszeit_h'), 0, 24, start, 0.25, (v) => {
          this.zeitAngehalten = true;
          this.cb.setzeZeit?.(v, true);
          if (this.laufKasten) this.laufKasten.checked = false;
        })
      );
      const zeile = document.createElement('div');
      zeile.style.cssText = 'display:flex;gap:6px;align-items:center;margin:-4px 0 6px;';
      const kasten = document.createElement('input');
      kasten.type = 'checkbox';
      kasten.checked = true;
      kasten.onchange = () => {
        this.zeitAngehalten = !kasten.checked;
        this.cb.setzeZeit?.(this.cb.zeit?.() ?? 12, this.zeitAngehalten);
      };
      this.laufKasten = kasten;
      const txt = document.createElement('span');
      txt.textContent = t('testflug.spawn.zeit_laeuft_weiter');
      txt.style.cssText = 'font-size:11px;color:#9a8f6a;';
      zeile.append(kasten, txt);
      this.root.appendChild(zeile);
    }

    // Aktionen
    const aktionen = document.createElement('div');
    aktionen.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    aktionen.appendChild(this.knopf(t('testflug.spawn.platzieren_p'), () => this.cb.platzieren()));
    aktionen.appendChild(this.knopf(t('testflug.spawn.letztes_weg'), () => {
      this.cb.entferneLetztes();
      this.aktualisiere();
    }));
    this.root.appendChild(aktionen);

    this.zaehler = document.createElement('div');
    this.zaehler.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    this.root.appendChild(this.zaehler);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    tip.textContent = t('testflug.spawn.tip');
    this.root.appendChild(tip);

    // Everything built so far except title and tabs belongs to the object tab.
    this.objekteBlock = document.createElement('div');
    for (const kind of [...this.root.children]) {
      if (kind !== titel && kind !== tabs) this.objekteBlock.appendChild(kind);
    }
    this.root.appendChild(this.objekteBlock);
    this.gelaendeBlock = this.baueGelaendeBlock();
    this.root.appendChild(this.gelaendeBlock);
    this.tabMarkieren();

    document.body.appendChild(this.root);
    this.listeFuellen();
  }

  /** The terrain tab: tools, radius, strength, save button, hint. */
  private baueGelaendeBlock(): HTMLDivElement {
    const block = document.createElement('div');
    block.style.cssText = 'display:none;';
    const werkzeuge: ReadonlyArray<readonly [Werkzeug, TranslationKey]> = [
      ['anheben', 'testflug.gelaende.werkzeug.anheben'],
      ['absenken', 'testflug.gelaende.werkzeug.absenken'],
      ['glaetten', 'testflug.gelaende.werkzeug.glaetten'],
      ['ebnen', 'testflug.gelaende.werkzeug.ebnen'],
      ['zuruecksetzen', 'testflug.gelaende.werkzeug.zuruecksetzen'],
    ];
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;';
    for (const [werkzeug, schluessel] of werkzeuge) {
      const k = this.knopf(t(schluessel), () => {
        this.gelaendeEinstellung.werkzeug = werkzeug;
        this.werkzeugMarkieren();
        this.aufGelaende?.();
      });
      this.werkzeugKnoepfe.set(werkzeug, k);
      zeile.appendChild(k);
    }
    block.appendChild(zeile);
    this.werkzeugMarkieren();

    // Radius: also set from the keys (`setzeRadius`), so the slider is built by hand.
    block.appendChild(this.label(t('testflug.gelaende.radius_m')));
    const radiusZeile = document.createElement('div');
    radiusZeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const regler = document.createElement('input');
    regler.type = 'range';
    regler.min = String(RADIUS_MIN);
    regler.max = String(RADIUS_MAX);
    regler.step = '1';
    regler.value = String(this.gelaendeEinstellung.radius);
    regler.style.cssText = 'flex:1;';
    const wert = document.createElement('span');
    wert.textContent = String(this.gelaendeEinstellung.radius);
    wert.style.cssText = 'width:36px;font-size:11px;';
    regler.oninput = () => this.setzeRadius(Number(regler.value));
    radiusZeile.append(regler, wert);
    block.appendChild(radiusZeile);
    this.radiusRegler = regler;
    this.radiusWert = wert;

    block.appendChild(
      this.schieber(t('testflug.gelaende.staerke_cm'), STAERKE_MIN, STAERKE_MAX, this.gelaendeEinstellung.staerke, 1, (v) => (this.gelaendeEinstellung.staerke = v))
    );

    // Target height of the level tool: filled by the pipette (Ctrl/Cmd+click on the ground) or typed.
    block.appendChild(this.label(t('testflug.gelaende.ziel_m')));
    const ziel = document.createElement('input');
    ziel.type = 'number';
    ziel.step = '0.1';
    ziel.min = String(ZIEL_MIN);
    ziel.max = String(ZIEL_MAX);
    ziel.placeholder = '—';
    ziel.style.cssText = this.feldStil();
    ziel.onchange = () => {
      this.gelaendeEinstellung.ziel = ziel.value.trim() === '' ? null : klemmeZiel(Number(ziel.value));
      if (this.gelaendeEinstellung.ziel !== null) ziel.value = String(this.gelaendeEinstellung.ziel);
    };
    block.appendChild(ziel);
    this.zielFeld = ziel;

    const speichern = document.createElement('div');
    speichern.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    speichern.appendChild(this.knopf(t('testflug.gelaende.speichern'), () => this.cb.speichernGelaende?.()));
    block.appendChild(speichern);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:6px;';
    tip.textContent = t('testflug.gelaende.tip');
    block.appendChild(tip);
    const tip3 = document.createElement('div');
    tip3.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    tip3.textContent = t('testflug.gelaende.tip3');
    block.appendChild(tip3);
    return block;
  }

  private werkzeugMarkieren(): void {
    for (const [w, k] of this.werkzeugKnoepfe) {
      const aktiv = w === this.gelaendeEinstellung.werkzeug;
      k.style.background = aktiv ? '#243044' : '#1d2431';
      k.style.color = aktiv ? '#e8d48a' : '#d8cfa8';
    }
  }

  private tabMarkieren(): void {
    if (!this.tabKnoepfe) return;
    for (const [name, k] of Object.entries(this.tabKnoepfe)) {
      const aktiv = name === this.tab;
      k.style.background = aktiv ? '#243044' : '#1d2431';
      k.style.color = aktiv ? '#e8d48a' : '#d8cfa8';
    }
    this.objekteBlock.style.display = this.tab === 'objekte' ? 'block' : 'none';
    this.gelaendeBlock.style.display = this.tab === 'gelaende' ? 'block' : 'none';
  }

  private setzeTab(tab: 'objekte' | 'gelaende'): void {
    if (tab === this.tab) return;
    this.tab = tab;
    // Placing and the brush exclude each other: a prefab ghost must not hang on the mouse under the brush.
    if (tab === 'gelaende') this.beendePlatzierModus();
    this.tabMarkieren();
    this.aufGelaende?.();
  }

  /** Terrain tool on: the panel is open and its terrain tab is showing. */
  get istGelaendeModus(): boolean {
    return this.istOffen && this.tab === 'gelaende';
  }

  /** Terrain tool off (Esc, right click): back to the object tab. */
  beendeGelaendeModus(): void {
    if (this.tab === 'objekte') return;
    this.setzeTab('objekte');
  }

  /** Target height in m (from the pipette), clamped to whole cm; keeps the field in step. */
  setzeZiel(hoehe: number): void {
    const h = klemmeZiel(hoehe);
    this.gelaendeEinstellung.ziel = h;
    if (this.zielFeld) this.zielFeld.value = String(h);
  }

  /** Radius in whole metres, clamped; keeps the slider in step. */
  setzeRadius(r: number): void {
    const radius = klemmeRadius(r);
    this.gelaendeEinstellung.radius = radius;
    if (this.radiusRegler) this.radiusRegler.value = String(radius);
    if (this.radiusWert) this.radiusWert.textContent = String(radius);
  }

  private feldStil(): string {
    return 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:4px;margin:2px 0;box-sizing:border-box;';
  }

  private label(text: string): HTMLDivElement {
    const l = document.createElement('div');
    l.textContent = text;
    l.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    return l;
  }

  private knopf(text: string, cb: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'flex:1;padding:6px;background:#1d2431;color:#d8cfa8;border:1px solid #3a3325;border-radius:4px;cursor:pointer;font-family:inherit;';
    b.onclick = () => {
      cb();
      // Fokus sofort abgeben: Ein fokussierter Knopf feuert später auf
      // Enter/Leertaste ERNEUT — auch wenn das Menü längst zu ist.
      b.blur();
    };
    return b;
  }

  private schieber(
    name: string,
    min: number,
    max: number,
    start: number,
    schritt: number,
    setz: (v: number) => void
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.appendChild(this.label(name));
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(schritt);
    s.value = String(start);
    s.style.cssText = 'flex:1;';
    const wert = document.createElement('span');
    wert.textContent = String(start);
    wert.style.cssText = 'width:36px;font-size:11px;';
    s.oninput = () => {
      setz(Number(s.value));
      wert.textContent = s.value;
    };
    zeile.append(s, wert);
    wrap.appendChild(zeile);
    return wrap;
  }

  /** Beschriftetes Auswahlfeld im NPC-Block (Rolle, Fraktion). */
  private npcAuswahl(
    name: string,
    werte: readonly string[],
    texte: Readonly<Record<string, string>>
  ): HTMLSelectElement {
    this.npcBlock.appendChild(this.label(name));
    const s = document.createElement('select');
    s.style.cssText = this.feldStil();
    for (const w of werte) {
      const o = document.createElement('option');
      o.value = w;
      // Fällt auf den rohen Wert zurück: Wächst FRAKTIONEN um einen
      // Eintrag, steht er sofort zur Wahl — auch ohne Anzeigetext.
      o.textContent = texte[w] ?? w;
      s.appendChild(o);
    }
    s.onchange = () => this.npcSchreiben();
    this.npcBlock.appendChild(s);
    return s;
  }

  /**
   * Felder auf die gewählte Platzierung stellen (oder den Block ausblenden).
   *
   * Gezeigt wird der AUFGELÖSTE Zustand — also das, was auch am
   * Namensschild steht: Was die Platzierung nicht selbst sagt, kommt aus
   * der Prefab-Vorgabe. Der Name bleibt als Platzhalter stehen statt im
   * Feld, damit man sieht, was geerbt und was gesetzt ist.
   */
  private npcAktualisiere(): void {
    const ziel = this.cb.gewaehlteNpc?.() ?? null;
    if (!ziel || !istNpcPrefab(ziel.prefab)) {
      this.npcBlock.style.display = 'none';
      this.npcPrefab = '';
      return;
    }
    const ist = loeseNpcAuf(ziel.prefab, ziel.npc);
    const vorgabe = loeseNpcAuf(ziel.prefab);
    if (!ist || !vorgabe) return;
    this.npcPrefab = ziel.prefab;
    this.npcBlock.style.display = 'block';
    this.npcName.value = ziel.npc?.name ?? '';
    this.npcName.placeholder = vorgabe.name;
    this.npcRolle.value = ist.rolle;
    this.npcFraktion.value = ist.fraktion;
    this.npcStufe.value = String(ist.stufe);
    this.npcQuest.value = ist.quest;
    this.npcQuestZeile.style.display = ist.rolle === 'quest' ? 'block' : 'none';
  }

  /**
   * Felder → Entwurf. Gespeichert wird nur, was von der Prefab-Vorgabe
   * ABWEICHT (s. PlacementDef.npc): Wer nichts umstellt, bekommt keinen
   * `npc`-Block ins Dokument, und eine spätere Änderung an NPC_VORGABEN
   * schlägt auf alle Platzierungen durch, die sie nicht ausdrücklich
   * übersteuern.
   */
  private npcSchreiben(): void {
    if (!this.npcPrefab || !this.cb.setzeNpc) return;
    const vorgabe = loeseNpcAuf(this.npcPrefab);
    if (!vorgabe) return;
    const def: {
      name?: string;
      rolle?: NpcRolle;
      fraktion?: Fraktion;
      stufe?: number;
      quest?: QuestZustand;
    } = {};
    const name = this.npcName.value.trim().slice(0, NPC_NAME_MAX);
    if (name.length > 0 && name !== vorgabe.name) def.name = name;
    const rolle = this.npcRolle.value as NpcRolle;
    if (rolle !== vorgabe.rolle) def.rolle = rolle;
    const fraktion = this.npcFraktion.value as Fraktion;
    if (fraktion !== vorgabe.fraktion) def.fraktion = fraktion;
    const stufe = Math.min(
      NPC_STUFE_MAX,
      Math.max(NPC_STUFE_MIN, Math.round(Number(this.npcStufe.value) || vorgabe.stufe))
    );
    this.npcStufe.value = String(stufe);
    if (stufe !== vorgabe.stufe) def.stufe = stufe;
    // Ohne Quest-Rolle wird der Zustand gar nicht erst geschrieben.
    const quest = this.npcQuest.value as QuestZustand;
    if (rolle === 'quest' && quest !== vorgabe.quest) def.quest = quest;
    this.npcQuestZeile.style.display = rolle === 'quest' ? 'block' : 'none';
    this.cb.setzeNpc(Object.keys(def).length > 0 ? def : undefined);
  }

  private listeFuellen(): void {
    this.liste.innerHTML = '';
    const alle = KATEGORIEN[this.kategorie]!.namen();
    const gefiltert = this.suchtext
      ? alle.filter((n) => n.toLowerCase().includes(this.suchtext))
      : alle;
    const treffer = gefiltert.slice(0, 80);
    for (const name of treffer) {
      // Gesperrt heißt: kein eigenes Modell, also nichts, was in der Welt
      // stehen darf. Die Zeile bleibt trotzdem, nur grau und ohne Klick —
      // s. Kopf der Datei.
      const gesperrt = !istEigenesModell(name);
      const zeile = document.createElement('div');
      // Bild neben dem Namen — 149 Vorschaubilder gleichzeitig zu laden
      // waere die naheliegende und falsche Lösung, deshalb loading="lazy"
      // (der Browser lädt nur, was im sichtbaren Ausschnitt der Liste
      // steht) und onerror als Textrückfall, wenn kein Bild existiert.
      const vorschau = gesperrt ? null : vorschauBild(name);
      if (vorschau) {
        const bild = document.createElement('img');
        bild.src = vorschau;
        bild.loading = 'lazy';
        bild.alt = '';
        bild.style.cssText = 'width:20px;height:20px;object-fit:contain;flex:none;';
        bild.onerror = () => bild.remove();
        zeile.appendChild(bild);
      }
      const text = document.createElement('span');
      text.textContent = gesperrt ? t('testflug.spawn.kein_eigenes_modell', { name }) : name;
      zeile.appendChild(text);
      // Zwei Markierungen: kräftig hinterlegt = Platzier-Modus AKTIV,
      // nur Randstreifen = bloße Vorauswahl (localStorage) ohne Modus.
      const gewaehlt = name === this.einstellung.prefab;
      zeile.style.cssText =
        'display:flex;align-items:center;gap:6px;' +
        (gesperrt
          ? 'padding:2px 6px;cursor:not-allowed;color:#6f664e;'
          : 'padding:2px 6px;cursor:pointer;' +
            (gewaehlt
              ? this.modusAktiv
                ? 'background:#243044;color:#e8d48a;'
                : 'color:#e8d48a;border-left:2px solid #6a5d35;padding-left:4px;'
              : ''));
      if (gesperrt) {
        // Der Grund im Klartext, an der Zeile selbst — sonst bleibt nur
        // die Vermutung, der Editor sei kaputt.
        zeile.title = t('testflug.spawn.gesperrt_titel', { name });
        this.liste.appendChild(zeile);
        continue;
      }
      zeile.onclick = () => {
        if (this.modusAktiv && name === this.einstellung.prefab) {
          // Zweiter Klick auf den aktiven Eintrag = Abwahl: Der Modus
          // endet, die Vorauswahl bleibt bestehen.
          this.modusAktiv = false;
        } else {
          this.modusAktiv = true;
          this.einstellung.prefab = name;
          localStorage.setItem('wov-editor-spawn-prefab', name);
          // Den Einebnen-Haken bewusst NICHT anfassen: Dieser Klick schaltet
          // den Platzier-Modus scharf — eine Vorgabe an dieser Stelle hat
          // jede Handabwahl direkt vor dem Setzen wieder überschrieben.
        }
        this.aufWahl?.();
        this.listeFuellen();
      };
      this.liste.appendChild(zeile);
    }
    const gesamt = gefiltert.length;
    if (gesamt > treffer.length) {
      const mehr = document.createElement('div');
      mehr.textContent = t('testflug.spawn.weitere', { n: gesamt - treffer.length });
      mehr.style.cssText = 'padding:2px 6px;color:#9a8f6a;font-style:italic;';
      this.liste.appendChild(mehr);
    }
    if (treffer.length === 0) {
      const leer = document.createElement('div');
      leer.textContent = t('testflug.spawn.keine_treffer');
      leer.style.cssText = 'padding:4px 6px;color:#9a8f6a;';
      this.liste.appendChild(leer);
    }
    const gesperrtGesamt = gefiltert.filter((n) => !istEigenesModell(n)).length;
    this.gesperrtZeile.textContent =
      gesperrtGesamt === 0
        ? ''
        : t('testflug.spawn.gesperrt_zeile', { gesperrt: gesperrtGesamt, gesamt });
  }

  aktualisiere(): void {
    // Die NPC-Felder hängen an der AUSWAHL, und die ändert sich genau
    // dann, wenn das hier gerufen wird (Greifen, Setzen, Löschen).
    this.npcAktualisiere();
    this.zaehler.textContent =
      t('testflug.spawn.zaehler', { n: this.cb.anzahl() }) +
      (this.modusAktiv
        ? t('testflug.spawn.zaehler_platziert', { prefab: this.einstellung.prefab })
        : t('testflug.spawn.zaehler_vorauswahl', { prefab: this.einstellung.prefab }));
  }

  /** Nur im aktiven Modus darf irgendein Pfad (Klick, P, Knopf) setzen. */
  get istPlatzierModus(): boolean {
    return this.modusAktiv;
  }

  /** Modus beenden (Esc, Rechtsklick, Abwahl) — die Vorauswahl bleibt. */
  beendePlatzierModus(): void {
    if (!this.modusAktiv) return;
    this.modusAktiv = false;
    this.aufWahl?.(); // main.ts räumt darüber den Geist an der Maus ab
    this.listeFuellen();
  }

  toggle(): boolean {
    const sichtbar = this.root.style.display === 'none';
    this.root.style.display = sichtbar ? 'block' : 'none';
    if (sichtbar) this.aktualisiere();
    // A closed panel leaves the terrain tool: opening it again starts on the object tab.
    else if (this.tab === 'gelaende') {
      this.tab = 'objekte';
      this.tabMarkieren();
      this.aufGelaende?.();
    }
    return sichtbar;
  }

  get istOffen(): boolean {
    return this.root.style.display !== 'none';
  }
}
