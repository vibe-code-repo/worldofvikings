/**
 * Gegenstands-Katalog des Editors — alle Objekte des Spiels durchsehen,
 * einzeln laden und von allen Seiten anschauen.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Bisher gab es nur zwei Wege, ein Modell zu SEHEN: es im Testflug
 * platzieren (SpawnPanel, Taste B) oder den Namen kennen und hoffen. Wer
 * wissen wollte, wie „GrabDrachenkopf" aussieht, wie groß „WikingerBasis"
 * wirklich ist oder ob ein Prefab überhaupt ein Modell mitbringt, musste
 * jedes Mal eine Welt bauen. Der Katalog beantwortet genau das: Liste
 * links, Modell rechts, Maße darunter.
 *
 * ── Eigene Szene, eigene Engine ──────────────────────────────────────
 * Wie die Weltkarte (ui/WorldMap.ts) bringt der Katalog seine EIGENE
 * Babylon-Engine auf einem eigenen Canvas mit. Der Editor selbst ist
 * reines 2D (Canvas-Overlay über dem Karten-Worker) — es gibt hier keine
 * Spielszene, in die man ein Vorschaumodell hängen könnte, und eine
 * halbe Spielwelt nur zum Anschauen eines Baumes hochzuziehen wäre
 * absurd. Engine und Szene entstehen deshalb LAZY beim ersten Öffnen und
 * rendern nur, solange der Katalog sichtbar ist (runRenderLoop /
 * stopRenderLoop) — ein unsichtbarer Katalog kostet keine Bilder.
 *
 * ── Umgang mit fehlenden Modellen ────────────────────────────────────
 * Die Registry kennt 3.748 Prefabs MIT Modellnamen; auf dem Server liegen
 * aber nur die selbst gebauten GLBs. Ein Katalog, der davon nichts weiß,
 * zeigt entweder einen ewigen Ladebalken oder wirft. Beides ist hier
 * abgefangen:
 *   - `AssetManager.instantiate()` liefert null, wenn die GLB fehlt (der
 *     Ladefehler ist gefangen) ODER wenn die Hierarchie keine sichtbaren
 *     Vertices hat (mesh-lose Bone-Rigs des Valheim-Exports). Beides
 *     endet im selben sauberen Platzhalter: ein Drahtgitter-Quader in
 *     Prefab-Größe plus Klartext im Metadatenblock.
 *   - Zusätzlich eine Zeitgrenze (LADE_TIMEOUT): Hängt eine Anfrage
 *     (Proxy, schlafender Server), bricht die Vorschau ab statt ewig
 *     „lädt …" zu zeigen. Kommt das Modell später doch, wird es
 *     weggeworfen — die Auswahl ist dann längst eine andere.
 *   - Die Liste kann ihre Seite per HEAD-Anfragen abklopfen und
 *     markieren, was wirklich da ist. Bewusst auf Knopfdruck und nur für
 *     die SICHTBARE Seite: 3.748 automatische Anfragen wären eine
 *     kleine Denial-of-Service-Attacke auf den eigenen Dev-Server.
 *
 * ── Warum Seiten statt einer langen Liste ────────────────────────────
 * Auch rein im DOM sind 3.748 Zeilen je Tastendruck spürbar, und
 * gleichzeitig geladene Modelle wären es erst recht. Geladen wird immer
 * nur EINES (das gewählte), angezeigt werden SEITE_GROESSE Zeilen.
 * Vorgabe-Kategorie ist „Eigene Modelle" — die einzige Liste, die
 * überall vollständig vorhanden ist.
 *
 * ── Warum der Katalog eine Überlagerung ist (Entwurf August 2026) ─────
 * Er füllte vorher den ganzen Viewport randlos aus und sah damit aus wie
 * ein zweiter Editor. Jetzt liegt er als große Tafel auf einem
 * weichgezeichneten Vorhang: Man sieht am Rand, dass die Karte noch da
 * ist und nur wartet — und dass Schließen nichts wegwirft. Alle Farben,
 * Maße und Bedienelemente kommen aus `design.ts`; literale Farbwerte
 * sind in dieser Datei ein Fehler (einzige begründete Ausnahme: der
 * Verlauf der Vorschaubühne und der Schlagschatten der Tafel, s. dort).
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import {
  BAU_PREFABS,
  EIGENE_MODELLE,
  FOLIAGE,
  ITEM_DEFS,
  NPC_VORGABEN,
  PREFABS_BY_NAME,
  PREFAB_DEFS,
  isRenderable,
  istEigenesModell,
  type PrefabDef,
} from '@wov/shared';
import { AssetManager } from '../engine/AssetManager';
import {
  F,
  M,
  PFAD,
  SCHRIFT,
  auswahl,
  beiUeberfahren,
  beschriftungStil,
  el,
  grundregelnEinhaengen,
  knopf,
  kreuzfeld,
  luecke,
  lupenBild,
  marke,
  schwebendStil,
  sinnbild,
  stil,
  zierTitel,
} from './design';

/** Zeilen je Listenseite — s. Kopf („Warum Seiten"). */
const SEITE_GROESSE = 60;

/**
 * Geduld für EIN Modell (ms). Großzügig, weil einzelne GLBs des Exports
 * zweistellige Megabyte haben (Grabhügel: 17 MB) — aber endlich, damit
 * eine hängende Anfrage nicht als Dauerzustand erscheint.
 */
const LADE_TIMEOUT = 30_000;

/** Gleichzeitige HEAD-Anfragen der Verfügbarkeitsprüfung. */
const PRUEF_PARALLEL = 6;

/** Breite der Listenspalte (Entwurf). */
const SPALTE_BREITE = 322;

/** Schnellzugriff auf Item-Angaben (Icon, Gewicht, Stapel) je Prefabname. */
const ITEMS_NACH_NAME = new Map(ITEM_DEFS.map((i) => [i.name, i]));

/**
 * Anzeigetexte der ItemType-Werte.
 *
 * Bewusst eine Zahlentabelle statt `import { ItemType }`: Der Typ ist ein
 * `const enum`, und die werden von esbuild/Vite über Modulgrenzen hinweg
 * nicht zuverlässig aufgelöst. Für eine reine Beschriftung ist das die
 * Mühe nicht wert.
 */
const ITEM_TYP_TEXT: Readonly<Record<number, string>> = {
  1: 'Material',
  14: 'Zweihandwaffe',
  19: 'Werkzeug',
};

/** Nur Prefabs, die im Spiel überhaupt ein Bild bekommen (s. isRenderable). */
const MIT_MODELL = PREFAB_DEFS.filter((d) => d.model !== null && isRenderable(d));

interface Kategorie {
  name: string;
  /** Erklärung unter der Auswahl — was steckt in dieser Liste? */
  hinweis: string;
  namen: () => string[];
}

/**
 * Die Kategorien des Katalogs.
 *
 * Reihenfolge ist Absicht: „Eigene Modelle" steht vorn und ist die
 * Vorgabe, weil das die Liste ist, deren GLBs überall wirklich liegen.
 * Alles Weitere ist nach Nutzen sortiert (was man beim Weltbau sucht),
 * die vollständige Registry steht als letzter Ausweg am Ende.
 *
 * Gefiltert wird überall gegen PREFABS_BY_NAME: Ein Name ohne
 * Registry-Eintrag hätte weder Modell noch Maße — eine tote Zeile.
 *
 * Gegen EIGENE_MODELLE wird hier NICHT gefiltert — anders als im
 * SpawnPanel, und mit Absicht: Der Katalog setzt nichts in die Welt, er
 * zeigt. „Wie sah das aus, was da entfällt?" ist genau die Frage, die
 * man beim Nachbauen stellt, und ihre Antwort wegzunehmen hiesse, sich
 * die Vorlage zu verbauen. Gleichrangig bleibt es deshalb trotzdem
 * nicht: Ohne eigenes Modell steht die Zeile ausgegraut mit ⊘ da, der
 * Metadatenblock sagt es in Worten, und über der Liste steht die Quote
 * der Kategorie.
 */
const KATEGORIEN: readonly Kategorie[] = [
  {
    name: '★ Eigene Modelle',
    hinweis: 'Selbst gebaut (Blender/Tripo/Baumgenerator) — diese GLBs liegen immer vor.',
    namen: () => EIGENE_MODELLE.filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Vegetation',
    hinweis: 'Alles, was die Weltgenerierung streut (shared/vegetation.ts).',
    namen: () => [...new Set(FOLIAGE.map((f) => f.prefabName))].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Bauteile',
    hinweis: 'Was der Hammer setzen kann (PieceTable).',
    namen: () => [...BAU_PREFABS].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Figuren (NPC)',
    hinweis: 'Prefabs mit NPC-Vorgaben — Rolle, Fraktion, Stufe (shared/npc.ts).',
    namen: () => [...NPC_VORGABEN.keys()].filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Gegenstände (Items)',
    hinweis: 'Inventarfähige Dinge mit Icon und Gewicht (shared/items/itemDefs.ts).',
    namen: () => ITEM_DEFS.map((i) => i.name).filter((n) => PREFABS_BY_NAME.has(n)),
  },
  {
    name: 'Alle mit Modell',
    hinweis: `Die volle Registry, ${MIT_MODELL.length} Einträge — die meisten GLBs fehlen auf diesem Server.`,
    namen: () => MIT_MODELL.map((d) => d.name),
  },
];

/**
 * Einträge je Kategorie — einmal gezählt, dann gemerkt.
 *
 * Die Marken über der Liste tragen diese Zahlen und werden bei JEDEM
 * Listenaufbau neu gebaut. `namen()` läuft aber über bis zu 3.748
 * Einträge; das sechsmal je Tastendruck wäre genau das Ruckeln, gegen
 * das oben die Seitengröße steht. Die Listen sind statisch (Registry,
 * Vegetation, PieceTable) — einmal zählen genügt für die Sitzung.
 */
let katAnzahlen: readonly number[] | null = null;
function katAnzahl(): readonly number[] {
  if (!katAnzahlen) katAnzahlen = KATEGORIEN.map((k) => k.namen().length);
  return katAnzahlen;
}

/** Gemessene Kennzahlen des geladenen Modells. */
interface Kennzahlen {
  breite: number;
  hoehe: number;
  tiefe: number;
  dreiecke: number;
  meshes: number;
  materialien: number;
  mitte: Vector3;
}

/** Zustand der Statusplakette über der Bühne. */
type StatusArt = 'laedt' | 'da' | 'fehlt' | 'neutral';

export class GegenstandsKatalog {
  private readonly root: HTMLDivElement;
  private readonly leinwand: HTMLCanvasElement;
  private readonly liste: HTMLDivElement;
  private readonly blaetterZeile: HTMLDivElement;
  private readonly katHinweis: HTMLDivElement;
  private readonly markenZeile: HTMLDivElement;
  private readonly infoBlock: HTMLDivElement;
  private readonly pruefKnopf: HTMLButtonElement;
  private readonly sucheFeld: HTMLInputElement;
  /** Die <select>-Hülle der Kategorie — die Marken müssen sie mitführen. */
  private readonly katSelect: HTMLSelectElement | null;

  // ── Schwebende Anzeigen über der Bühne ────────────────────────────
  private readonly statusPlakette: HTMLSpanElement;
  private readonly statusPunkt: HTMLSpanElement;
  private readonly statusZeile: HTMLSpanElement;
  private readonly rasterPlakette: HTMLSpanElement;

  // ── Szene (erst beim ersten Öffnen, s. Kopf) ──────────────────────
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private kamera: ArcRotateCamera | null = null;
  private assets: AssetManager | null = null;
  /** Wurzel des gerade gezeigten Modells (oder des Platzhalters). */
  private gezeigt: TransformNode | null = null;
  /** Raster am Boden — Maßstabsreferenz, Kantenlänge = `rasterSchritt`. */
  private raster: Mesh | null = null;

  // ── Listenzustand ─────────────────────────────────────────────────
  private kategorie = 0;
  private suchtext = '';
  private seite = 0;
  private gewaehlt: string | null = null;
  private sucheTimer: number | null = null;

  /**
   * Laufende Nummer der Ladevorgänge. Jeder Klick erhöht sie; ein
   * Ergebnis, dessen Nummer nicht mehr die aktuelle ist, gehört zu einer
   * überholten Auswahl und wird verworfen (samt Freigabe der Instanz).
   * Ohne das überschreibt ein langsam geladener 17-MB-Grabhügel das
   * längst gewählte Blümchen.
   */
  private ladeNummer = 0;

  /**
   * Was über einzelne Modell-DATEIEN bekannt ist (Schlüssel ist
   * `PrefabDef.model`, nicht der Prefabname — Boar zeigt auf Boar_fixed).
   *
   * true  = liegt vor und hat sichtbare Geometrie,
   * false = nicht anzeigbar (404 oder mesh-lose Hierarchie),
   * gar kein Eintrag = ungeprüft.
   *
   * Gefüllt aus zwei Quellen: jedem tatsächlichen Ladeversuch und der
   * HEAD-Prüfung der sichtbaren Seite.
   */
  private readonly vorhanden = new Map<string, boolean>();

  /** Selbstdreher (Drehteller). Jeder Zieh-Vorgang schaltet ihn ab. */
  private drehen = true;
  /**
   * Der Haken dazu — er ist zugleich ANZEIGE: Wer selbst am Modell
   * zieht, will nicht, dass es ihm unter der Hand weiterdreht — das
   * Ziehen schaltet den Drehteller ab, und das muss man sehen. Weil
   * `kreuzfeld()` seinen Zustand beim Bauen einbrennt, hält der Katalog
   * die Hülle und tauscht den Kasten aus (s. drehSetzen).
   */
  private readonly drehHuelle: HTMLSpanElement;
  /**
   * Material des Platzhalter-Gitters. Einmal angelegt und wiederverwendet:
   * `dispose(false, false)` beim Wechsel lässt Materialien absichtlich
   * stehen (sie gehören sonst dem Asset-Cache) — ein frisches Material je
   * fehlendem Modell würde sich beim Durchblättern der vollen Registry
   * stillschweigend anhäufen.
   */
  private platzhalterMaterial: StandardMaterial | null = null;

  /**
   * Ruf zurück, wenn der Nutzer ein Modell auf die Karte setzen will.
   *
   * ── Warum als Rückruf und nicht als eigene Fähigkeit ─────────────
   * Der Katalog kennt das Weltdokument bewusst NICHT — er lädt eine
   * GLB, zeigt sie und misst sie, mehr nicht. Gäbe man ihm einen Zeiger
   * aufs Layout, hinge die schwerste Ansicht des Editors (Babylon, GLB-
   * Lader, gut zwei Megabyte) plötzlich am Zustand der Karte, und der
   * dynamische `import()`, der sie aus dem Erststart heraushält, wäre
   * nur noch eine Verzögerung statt einer Ersparnis.
   *
   * Der Rückruf dreht die Richtung um: Der Katalog meldet „dieses
   * Prefab, bitte", `editorMain.ts` schaltet daraufhin sein
   * Platzieren-Werkzeug scharf. Bleibt der Rückruf ungesetzt, fehlt der
   * Knopf — statt eines toten Bedienelements.
   */
  private readonly aufPlatzieren: ((prefab: string) => void) | null;

  constructor(eltern: HTMLElement, aufPlatzieren?: (prefab: string) => void) {
    this.aufPlatzieren = aufPlatzieren ?? null;

    // Bildlaufleisten, Textmarkierung und der pulsierende Punkt der
    // Ladeanzeige stecken in den Grundregeln — sie einzuhängen ist
    // mehrfach unschädlich (die Funktion prüft auf ihre eigene ID).
    grundregelnEinhaengen();

    // Der Katalog ist eine ANSICHT, kein Werkzeugfenster — man sucht
    // darin, statt nebenbei die Karte zu bearbeiten. Er liegt deshalb als
    // Tafel auf einem weichgezeichneten Vorhang über dem Viewport: Die
    // Karte bleibt am Rand sichtbar (Schließen wirft nichts weg), und der
    // Umbau der Shell bleibt uns erspart.
    this.root = el(
      'div',
      stil({
        position: 'absolute',
        inset: '0',
        'z-index': '20',
        display: 'none',
        'place-items': 'center',
        background: F.vorhang,
        'backdrop-filter': 'blur(3px)',
        'font-family': SCHRIFT.text,
        color: F.text,
        'font-size': '13px',
      })
    );

    // Fluide statt der 1420×820 des Entwurfs: Der Editor läuft auch auf
    // einem 13-Zoll-Laptop, und eine feste Tafel wäre dort abgeschnitten.
    // Der Schlagschatten ist der einzige literale Farbwert der Hülle —
    // `F` führt (bewusst) keine Schattentöne.
    const tafel = el(
      'div',
      stil({
        width: 'min(1420px, 94vw)',
        height: 'min(820px, 92vh)',
        display: 'flex',
        'flex-direction': 'column',
        background: F.flaeche,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': '12px',
        'box-shadow': '0 30px 80px rgba(0,0,0,.6)',
        overflow: 'hidden',
      })
    );
    this.root.appendChild(tafel);

    // ── Kopfzeile: Titel, Kategorie, Suche, Ansicht, Schließen ───────
    const kopf = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        padding: '14px 16px',
        'border-bottom': `1px solid ${F.randLeise}`,
        flex: 'none',
      })
    );
    const titelGruppe = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '9px', 'padding-right': '6px' }));
    const wuerfel = sinnbild(PFAD.objekte, 16, 1.8);
    wuerfel.style.color = F.akzent;
    titelGruppe.append(wuerfel, zierTitel('Gegenstands-Katalog', 15));
    kopf.appendChild(titelGruppe);

    const katWahl = auswahl(
      KATEGORIEN.map((k, i) => ({ id: String(i), name: k.name })),
      String(this.kategorie),
      (id) => this.kategorieSetzen(Number(id))
    );
    katWahl.style.flex = 'none';
    katWahl.style.width = '208px';
    this.katSelect = katWahl.querySelector('select');
    kopf.appendChild(katWahl);

    // Das Suchfeld baut sich von Hand: `feld()` kennt kein Sinnbild links
    // und keine Plakette rechts. Farben und Maße kommen trotzdem aus den
    // Marken des Gestaltungssystems.
    const sucheHuelle = el(
      'div',
      stil({
        flex: '1',
        'max-width': '380px',
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        height: '34px',
        padding: '0 11px',
        background: F.feld,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radius}px`,
      })
    );
    const lupe = lupenBild(13);
    lupe.style.color = F.gedimmt2;
    const suche = el(
      'input',
      stil({
        flex: '1',
        'min-width': '0',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        color: F.text,
        'font-family': 'inherit',
        'font-size': '12.5px',
      })
    );
    suche.placeholder = 'Suchen — eiche, grab, wood_roof …';
    suche.oninput = () => {
      this.suchtext = suche.value.trim().toLowerCase();
      // Entprellt: Bei jedem Anschlag über bis zu 3.748 Namen zu filtern
      // UND das DOM neu zu bauen, ruckelt beim Tippen spürbar.
      if (this.sucheTimer !== null) window.clearTimeout(this.sucheTimer);
      this.sucheTimer = window.setTimeout(() => {
        this.seite = 0;
        this.listeFuellen();
      }, 150);
    };
    this.sucheFeld = suche;
    const tastenPlakette = el(
      'span',
      stil({
        'font-family': SCHRIFT.mono,
        'font-size': '10px',
        color: F.gedimmt2,
        padding: '2px 5px',
        background: F.erhoben,
        'border-radius': '4px',
        flex: 'none',
      }),
      // Die Plakette ist kein Schmuck: Strg/⌘+K springt wirklich ins
      // Suchfeld (s. Tastaturzweig unten). Eine Taste anzuschreiben, die
      // nichts tut, wäre die schlimmere Sorte Gestaltung.
      '⌘K'
    );
    sucheHuelle.append(lupe, suche, tastenPlakette);
    kopf.append(sucheHuelle, luecke());

    // Drehteller: Kasten plus Text in einer Pille. Der Kasten selbst
    // schaltet NICHT (sein Klick liefe sonst zusätzlich auf die Pille und
    // schaltete zweimal) — die Pille tut es für beide.
    this.drehHuelle = el('span', stil({ display: 'flex', flex: 'none' }));
    const drehPille = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        height: '30px',
        padding: '0 11px',
        background: F.erhoben,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radiusKlein}px`,
        cursor: 'pointer',
        flex: 'none',
      })
    );
    drehPille.append(this.drehHuelle, el('span', stil({ 'font-size': '12px', color: F.textRuhig }), 'Drehteller'));
    drehPille.onclick = () => this.drehSetzen(!this.drehen);
    beiUeberfahren(drehPille, { 'border-color': F.randAktiv });
    this.drehHakenZeichnen();
    kopf.appendChild(drehPille);

    kopf.appendChild(
      knopf('Ansicht zurücksetzen', () => this.kameraRahmen(), { art: 'leise', hoehe: 30, pfad: PFAD.wuerfeln })
    );
    kopf.appendChild(
      // Warnfarbener Rand beim Überfahren: Schließen ist die einzige
      // Handlung hier, die etwas wegnimmt (die Ansicht).
      knopf('Schließen', () => this.schliesse(), {
        art: 'leise',
        hoehe: 30,
        pfad: PFAD.kreuz,
        randHover: F.warnRand,
      })
    );
    tafel.appendChild(kopf);

    // ── Hauptteil: Liste links, Vorschau rechts ──────────────────────
    const reihe = el('div', stil({ flex: '1', display: 'flex', 'min-height': '0' }));
    tafel.appendChild(reihe);

    const linkeSpalte = el(
      'div',
      stil({
        width: `${SPALTE_BREITE}px`,
        flex: 'none',
        'border-right': `1px solid ${F.randLeise}`,
        display: 'flex',
        'flex-direction': 'column',
        'min-height': '0',
      })
    );
    reihe.appendChild(linkeSpalte);

    this.katHinweis = el(
      'div',
      stil({
        padding: '13px 16px',
        'border-bottom': `1px solid ${F.randLeise}`,
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
        flex: 'none',
      })
    );
    linkeSpalte.appendChild(this.katHinweis);

    this.markenZeile = el(
      'div',
      stil({ padding: '9px 12px 0', display: 'flex', gap: '6px', 'flex-wrap': 'wrap', flex: 'none' })
    );
    linkeSpalte.appendChild(this.markenZeile);

    this.liste = el(
      'div',
      stil({
        flex: '1',
        'overflow-y': 'auto',
        'overscroll-behavior': 'contain',
        'min-height': '0',
        padding: '8px 10px 10px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '1px',
      })
    );
    linkeSpalte.appendChild(this.liste);

    const listenFuss = el(
      'div',
      stil({
        flex: 'none',
        padding: '10px 12px',
        'border-top': `1px solid ${F.randLeise}`,
        display: 'flex',
        'flex-direction': 'column',
        gap: '8px',
      })
    );
    this.blaetterZeile = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '8px' }));
    listenFuss.appendChild(this.blaetterZeile);

    this.pruefKnopf = knopf('Verfügbarkeit dieser Seite prüfen', () => {
      void this.pruefeSeite();
    }, { hoehe: 31 });
    this.pruefKnopf.style.width = '100%';
    this.pruefKnopf.style.justifyContent = 'center';
    this.pruefKnopf.title =
      'Fragt für die sichtbaren Einträge per HEAD ab, ob die GLB auf diesem Server liegt.';
    listenFuss.appendChild(this.pruefKnopf);
    linkeSpalte.appendChild(listenFuss);

    const rechteSpalte = el('div', stil({ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-width': '0' }));
    reihe.appendChild(rechteSpalte);

    // Der Verlauf ist die EINZIGE literale Farbangabe der Bühne und steht
    // hier mit Absicht: `F` beschreibt Flächen, keine Lichtstimmung, und
    // dieser Verlauf ist genau das — der Studio-Hintergrund, vor dem ein
    // Modell dreidimensional wirkt. Ein flaches `F.grund` ließe dunkle
    // Modelle in der Fläche verschwinden.
    const buehne = el(
      'div',
      stil({
        flex: '1',
        position: 'relative',
        'min-height': '0',
        background: 'radial-gradient(circle at 50% 45%,#132630,#0a161d 70%)',
      })
    );
    rechteSpalte.appendChild(buehne);

    this.leinwand = el(
      'canvas',
      stil({ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', cursor: 'grab' })
    );
    buehne.appendChild(this.leinwand);

    // Schwebende Plaketten oben links: Ladezustand und Maßstab. Beide
    // sagen etwas, das man sonst raten müsste — ob das da wirklich das
    // Modell ist (oder der Platzhalter) und wie groß eine Rastermasche
    // gerade ist.
    const plaketten = el(
      'div',
      stil({ position: 'absolute', top: '14px', left: '16px', display: 'flex', gap: '7px', 'pointer-events': 'none' })
    );
    this.statusPlakette = el(
      'span',
      schwebendStil({
        display: 'none',
        'align-items': 'center',
        gap: '6px',
        padding: '5px 10px',
        'border-radius': `${M.radiusKlein}px`,
        'font-size': '11.5px',
        color: F.textRuhig,
      })
    );
    this.statusPunkt = el(
      'span',
      stil({ width: '6px', height: '6px', 'border-radius': '50%', background: F.ok, flex: 'none' })
    );
    this.statusZeile = el('span', '');
    this.statusPlakette.append(this.statusPunkt, this.statusZeile);
    this.rasterPlakette = el(
      'span',
      schwebendStil({
        padding: '5px 10px',
        'border-radius': `${M.radiusKlein}px`,
        'font-family': SCHRIFT.mono,
        'font-size': '11px',
        color: F.gedimmt,
      }),
      'Raster 1,00 m'
    );
    plaketten.append(this.statusPlakette, this.rasterPlakette);
    buehne.appendChild(plaketten);

    const bedienHinweis = el(
      'span',
      schwebendStil({
        position: 'absolute',
        bottom: '14px',
        right: '16px',
        padding: '5px 10px',
        'border-radius': `${M.radiusKlein}px`,
        'font-size': '11px',
        color: F.gedimmt,
        'pointer-events': 'none',
      }),
      'Ziehen = drehen · Rad = Zoom · ↑/↓ blättert'
    );
    buehne.appendChild(bedienHinweis);

    this.infoBlock = el(
      'div',
      stil({
        flex: 'none',
        padding: '13px 18px',
        'border-top': `1px solid ${F.randLeise}`,
        background: F.spalte,
        display: 'flex',
        'flex-direction': 'column',
        gap: '11px',
        'min-height': '96px',
      })
    );
    this.infoBlock.appendChild(
      el(
        'div',
        stil({ 'font-size': '12px', 'line-height': '1.6', color: F.gedimmt }),
        'Links einen Eintrag anklicken. Ziehen dreht, Rad zoomt, ↑/↓ blättert durch die Auswahl. ' +
          'Das Bodenraster gibt den Maßstab (Maschenweite steht auf der Plakette oben links).'
      )
    );
    rechteSpalte.appendChild(this.infoBlock);

    eltern.appendChild(this.root);

    this.mausSteuerung();
    // Der Canvas hängt in einem Flex-Layout: Konsole ziehen, Fenster
    // ändern, Seitenleiste — alles ändert seine Pixelgröße, ohne dass ein
    // window-resize kommt. Der Beobachter meldet jede davon.
    new ResizeObserver(() => this.engine?.resize()).observe(buehne);

    // Escape schließt — im CAPTURE-Zweig und mit Stopp, damit der
    // Karteneditor darunter nicht gleichzeitig sein Werkzeug abbricht.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.istOffen) return;
        if (e.code === 'Escape') {
          e.stopPropagation();
          this.schliesse();
        } else if (e.code === 'KeyK' && (e.metaKey || e.ctrlKey)) {
          // Die ⌘K-Plakette am Suchfeld eingelöst: Springt hinein und
          // markiert, was dort steht — tippen ersetzt es dann sofort.
          e.preventDefault();
          e.stopPropagation();
          this.sucheFeld.focus();
          this.sucheFeld.select();
        } else if (
          (e.code === 'ArrowDown' || e.code === 'ArrowUp') &&
          // Im Suchfeld gehören die Pfeiltasten dem Textcursor.
          !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
        ) {
          e.preventDefault();
          e.stopPropagation();
          this.nachbarWaehlen(e.code === 'ArrowDown' ? 1 : -1);
        }
      },
      true
    );

    this.listeFuellen();
  }

  // ── Sichtbarkeit ───────────────────────────────────────────────────

  get istOffen(): boolean {
    return this.root.style.display !== 'none';
  }

  umschalten(): boolean {
    if (this.istOffen) this.schliesse();
    else this.oeffne();
    return this.istOffen;
  }

  oeffne(): void {
    if (this.istOffen) return;
    // `grid` statt `flex`: Die Tafel wird über `place-items:center`
    // mittig gesetzt — `istOffen` liest weiterhin nur „nicht none".
    this.root.style.display = 'grid';
    this.szeneSicherstellen();
    this.engine?.resize();
    // Rendern erst jetzt: Ein Katalog, der im Hintergrund Bilder rechnet,
    // stiehlt dem Karten-Worker die CPU (der Editor rechnet die Vorschau
    // im Worker, aber das Zeichnen läuft im selben Thread).
    this.engine?.runRenderLoop(this.frame);
  }

  schliesse(): void {
    if (!this.istOffen) return;
    this.root.style.display = 'none';
    this.engine?.stopRenderLoop(this.frame);
  }

  // ── Szene ──────────────────────────────────────────────────────────

  private szeneSicherstellen(): void {
    if (this.engine) return;
    // `alpha: true` und ein durchsichtiger Löschwert: Die Bühne bekommt
    // ihren Verlauf vom DIV darunter (s. buehne). Ein opaker Löschwert
    // würde ihn überdecken.
    const engine = new Engine(this.leinwand, true, { stencil: false, alpha: true }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.ambientColor = new Color3(0.3, 0.3, 0.32);

    // Blick leicht von schräg oben — dieselbe Haltung, in der man ein
    // Objekt in die Hand nimmt. Die Grenzen für Beta verhindern, dass die
    // Kamera durch den Boden kippt (dort ist nichts als das Raster).
    const kamera = new ArcRotateCamera('katalogkamera', -Math.PI / 2 + 0.7, 1.15, 6, Vector3.Zero(), scene);
    kamera.lowerBetaLimit = 0.05;
    kamera.upperBetaLimit = Math.PI - 0.05;
    kamera.minZ = 0.02;
    kamera.maxZ = 2000;

    // Zwei Lichter, kein IBL: Die Materialien kommen ohne
    // Umgebungstextur aus (AssetManager stellt Metallgrad 0 ein, s. dort),
    // eine Sonne plus Himmelslicht zeigt Form und Textur zuverlässig. Ein
    // echtes IBL wäre hübscher, wäre aber ein zweiter Renderpfad neben
    // dem des Spiels — und der Katalog soll zeigen, was das Spiel zeigt.
    const sonne = new DirectionalLight('katalogsonne', new Vector3(-0.55, -1, -0.4), scene);
    sonne.intensity = 2.6;
    const himmel = new HemisphericLight('kataloghimmel', new Vector3(0, 1, 0), scene);
    himmel.intensity = 0.55;
    himmel.diffuse = new Color3(0.8, 0.85, 1);
    himmel.groundColor = new Color3(0.28, 0.26, 0.22);

    this.engine = engine;
    this.scene = scene;
    this.kamera = kamera;
    this.assets = new AssetManager(scene);
    this.rasterBauen();
  }

  /**
   * Bodenraster als Maßstab: 20 × 20 Felder um den Ursprung, Kantenlänge
   * 1 in lokalen Einheiten. Die tatsächliche Maschenweite kommt aus der
   * Skalierung des Meshes (s. kameraRahmen) — so genügt EIN Mesh für ein
   * Blümchen von 20 cm wie für ein Langhaus von 30 m.
   *
   * Die Linienfarbe ist `F.randAktiv` — dieselbe, mit der der Entwurf
   * seine Hilfslinien zeichnet. Der Entwurf legt sein Raster als SVG über
   * die Bühne; hier bleibt es beim echten Mesh, denn nur das steht
   * perspektivisch richtig unter dem Modell.
   */
  private rasterBauen(): void {
    const linien: Vector3[][] = [];
    for (let i = -10; i <= 10; i++) {
      linien.push([new Vector3(i, 0, -10), new Vector3(i, 0, 10)]);
      linien.push([new Vector3(-10, 0, i), new Vector3(10, 0, i)]);
    }
    const netz = MeshBuilder.CreateLineSystem('katalograster', { lines: linien }, this.scene!);
    netz.color = Color3.FromHexString(F.randAktiv);
    netz.isPickable = false;
    this.raster = netz;
  }

  private readonly frame = (): void => {
    if (this.drehen && this.kamera) this.kamera.alpha += 0.0035;
    this.scene?.render();
  };

  /** Drehteller schalten — Zustand, Haken und Renderschleife hängen zusammen. */
  private drehSetzen(an: boolean): void {
    this.drehen = an;
    this.drehHakenZeichnen();
  }

  private drehHakenZeichnen(): void {
    this.drehHuelle.innerHTML = '';
    // Der Kasten selbst schaltet nicht (s. Konstruktor) — er zeigt nur.
    this.drehHuelle.appendChild(kreuzfeld(this.drehen, () => undefined));
  }

  /**
   * Kamera und Raster auf das gezeigte Objekt einstellen.
   *
   * Ohne das steht ein Grashalm als Punkt im Bild und ein Langhaus ragt
   * aus ihm heraus. Gerahmt wird über die gemessene Hülle (`letzteMasse`);
   * ohne Messung (Platzhalter, noch nichts geladen) gilt eine
   * Vorgabegröße von 2 m.
   */
  private kameraRahmen(): void {
    const k = this.kamera;
    if (!k) return;
    const m = this.letzteMasse;
    const spanne = m ? Math.max(m.breite, m.hoehe, m.tiefe, 0.05) : 2;
    k.setTarget(m ? m.mitte.clone() : new Vector3(0, 1, 0));
    k.radius = spanne * 2.4;
    k.alpha = -Math.PI / 2 + 0.7;
    k.beta = 1.12;
    // Nah- und Fernebene an die Größenordnung hängen: 0.02/2000 fest
    // führt bei 20-cm-Blüten zu Z-Kämpfen und bei 40-m-Bauten zum
    // Wegschneiden der Rückseite.
    k.minZ = Math.max(0.005, spanne * 0.01);
    k.maxZ = Math.max(50, spanne * 60);
    // Maschenweite auf eine „runde" Zahl unterhalb der Objektgröße
    // bringen (…, 0.1, 0.2, 0.5, 1, 2, 5, 10 …) — das Raster bleibt
    // lesbar und die Zahl auf der Plakette bleibt eine, die man im Kopf
    // hat.
    const roh = spanne / 8;
    const zehner = Math.pow(10, Math.floor(Math.log10(Math.max(roh, 1e-3))));
    const rest = roh / zehner;
    const schritt = zehner * (rest >= 5 ? 5 : rest >= 2 ? 2 : 1);
    this.rasterSchritt = schritt;
    this.raster?.scaling.setAll(schritt);
    this.rasterPlakette.textContent = `Raster ${fmt(schritt)} m`;
  }

  private letzteMasse: Kennzahlen | null = null;
  private rasterSchritt = 1;

  /**
   * Maus auf dem Canvas: Ziehen dreht, Rad zoomt.
   *
   * Von Hand statt über `camera.attachControl`: Der Editor bindet
   * nirgends Babylons Eingabe-Module ein (die Spielsteuerung läuft über
   * den eigenen InputManager), und für Drehen plus Zoom lohnt der
   * zusätzliche Modulbaum nicht. Nebenbei bleibt so das Verhalten in der
   * Hand — etwa das Abschalten des Drehtellers beim ersten Ziehen.
   */
  private mausSteuerung(): void {
    let zieht: { x: number; y: number } | null = null;
    this.leinwand.addEventListener('pointerdown', (e) => {
      zieht = { x: e.clientX, y: e.clientY };
      this.leinwand.setPointerCapture(e.pointerId);
      this.leinwand.style.cursor = 'grabbing';
      if (this.drehen) this.drehSetzen(false);
    });
    this.leinwand.addEventListener('pointermove', (e) => {
      if (!zieht || !this.kamera) return;
      this.kamera.alpha -= (e.clientX - zieht.x) * 0.008;
      this.kamera.beta = Math.min(
        Math.PI - 0.05,
        Math.max(0.05, this.kamera.beta - (e.clientY - zieht.y) * 0.008)
      );
      zieht = { x: e.clientX, y: e.clientY };
    });
    const ende = (e: PointerEvent): void => {
      zieht = null;
      this.leinwand.style.cursor = 'grab';
      if (this.leinwand.hasPointerCapture(e.pointerId)) this.leinwand.releasePointerCapture(e.pointerId);
    };
    this.leinwand.addEventListener('pointerup', ende);
    this.leinwand.addEventListener('pointercancel', ende);
    this.leinwand.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.kamera) return;
        // Multiplikativ: Nah bewegt man sich fein, fern grob — additiv
        // wäre der Zoom bei großen Bauten unbrauchbar langsam.
        const faktor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        this.kamera.radius = Math.min(4000, Math.max(0.05, this.kamera.radius * faktor));
      },
      { passive: false }
    );
  }

  // ── Liste ──────────────────────────────────────────────────────────

  /** Kategorie wechseln — von der Auswahl oben ODER von den Marken links. */
  private kategorieSetzen(i: number): void {
    if (i === this.kategorie) return;
    this.kategorie = i;
    this.seite = 0;
    if (this.katSelect) this.katSelect.value = String(i);
    this.listeFuellen();
  }

  /** Namen der aktuellen Kategorie nach Suchfilter. */
  private treffer(): string[] {
    const alle = KATEGORIEN[this.kategorie]!.namen();
    return this.suchtext ? alle.filter((n) => n.toLowerCase().includes(this.suchtext)) : alle;
  }

  /** Namen der aktuell SICHTBAREN Seite. */
  private seitenNamen(): string[] {
    const t = this.treffer();
    const start = this.seite * SEITE_GROESSE;
    return t.slice(start, start + SEITE_GROESSE);
  }

  private listeFuellen(): void {
    const kat = KATEGORIEN[this.kategorie]!;
    const alle = this.treffer();

    // Unter dem Kategorietext: wie viel dieser Liste den Umbau überlebt.
    // Ohne diese Zeile liest man 25 Gegenstände und merkt erst beim
    // dritten Klick, dass KEINER davon noch ein Modell hat. Grün, wenn
    // alles eigenes Modell ist (der Regelfall in „Eigene Modelle"), sonst
    // in Warnfarbe — die Quote IST die Nachricht.
    const eigen = alle.filter((n) => istEigenesModell(n)).length;
    this.katHinweis.innerHTML = '';
    this.katHinweis.appendChild(
      el('div', stil({ 'font-size': '11.5px', 'line-height': '1.55', color: F.gedimmt }), kat.hinweis)
    );
    if (alle.length > 0) {
      const gut = eigen === alle.length;
      const keins = eigen === 0;
      const kasten = el(
        'div',
        stil({
          display: 'flex',
          'align-items': 'center',
          gap: '9px',
          padding: '8px 10px',
          background: gut ? F.okFlaeche : F.warnFlaeche,
          border: `1px solid ${gut ? F.okRand : F.warnRand}`,
          'border-radius': `${M.radiusKlein}px`,
        })
      );
      const zeichen = sinnbild(gut ? PFAD.haken : PFAD.minus, 13, 2.4);
      zeichen.style.color = gut ? F.ok : keins ? F.fehler : F.warnText;
      const text = el(
        'span',
        stil({ 'font-size': '11.5px', 'line-height': '1.45', color: gut ? F.okText : keins ? F.fehler : F.warnText })
      );
      text.append(
        el('strong', stil({ color: gut ? F.textHell : 'inherit' }), `${eigen} von ${alle.length}`),
        document.createTextNode(gut ? ' mit eigenem Modell' : ' mit eigenem Modell — der Rest (⊘) entfällt mit Block A.')
      );
      kasten.append(zeichen, text);
      this.katHinweis.appendChild(kasten);
    }

    // Kategorien als Marken: dieselbe Wahl wie oben in der Auswahlliste,
    // aber mit den Zahlen daneben — „wie viele stecken da drin?" ist beim
    // Suchen die häufigste Frage, und eine Auswahlliste kann sie nicht
    // beantworten, ohne dass man sie aufklappt.
    this.markenZeile.innerHTML = '';
    const anzahlen = katAnzahl();
    KATEGORIEN.forEach((k, i) => {
      this.markenZeile.appendChild(
        marke(`${k.name} ${anzahlen[i] ?? 0}`, i === this.kategorie, () => this.kategorieSetzen(i))
      );
    });

    const seiten = Math.max(1, Math.ceil(alle.length / SEITE_GROESSE));
    if (this.seite >= seiten) this.seite = seiten - 1;
    const sichtbar = this.seitenNamen();

    this.liste.innerHTML = '';
    for (const name of sichtbar) {
      const zeile = this.zeileBauen(name);
      this.liste.appendChild(zeile);
      // Beim Blättern mit den Pfeiltasten wandert die Auswahl aus dem
      // sichtbaren Bereich — die Liste zieht nach. `nearest` scrollt nur,
      // wenn es nötig ist, und reißt die Ansicht beim bloßen Neuaufbau
      // (Verfügbarkeitsprüfung) nicht herum.
      if (name === this.gewaehlt) zeile.scrollIntoView({ block: 'nearest' });
    }
    if (sichtbar.length === 0) {
      this.liste.appendChild(
        el('div', stil({ padding: '8px 10px', color: F.gedimmt3, 'font-style': 'italic' }), 'keine Treffer')
      );
    }

    this.blaetterZeile.innerHTML = '';
    const zurueck = this.blaetterKnopf(PFAD.pfeilLinks, this.seite === 0, () => {
      this.seite = Math.max(0, this.seite - 1);
      this.listeFuellen();
    });
    const weiter = this.blaetterKnopf(PFAD.pfeilRechts, this.seite >= seiten - 1, () => {
      this.seite = Math.min(seiten - 1, this.seite + 1);
      this.listeFuellen();
    });
    const text = el('span', stil({ flex: '1', 'text-align': 'center', 'font-size': '11.5px', color: F.textRuhig }));
    text.append(
      document.createTextNode('Seite '),
      el('strong', stil({ color: F.textHell }), String(this.seite + 1)),
      document.createTextNode(` / ${seiten} · ${alle.length} Einträge`)
    );
    this.blaetterZeile.append(zurueck, text, weiter);
    this.pruefKnopf.disabled = sichtbar.length === 0;
    this.pruefKnopf.style.opacity = this.pruefKnopf.disabled ? '0.45' : '1';
  }

  /** Quadratischer Blätterknopf (‹ / ›) im Fuß der Liste. */
  private blaetterKnopf(pfad: string, gesperrt: boolean, bei: () => void): HTMLSpanElement {
    const s = el(
      'span',
      stil({
        width: '28px',
        height: '28px',
        flex: 'none',
        display: 'grid',
        'place-items': 'center',
        background: F.erhoben,
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radiusFeld}px`,
        color: F.gedimmt,
        cursor: gesperrt ? 'default' : 'pointer',
        opacity: gesperrt ? '0.4' : '1',
      })
    );
    s.appendChild(sinnbild(pfad, 12, 2.4));
    if (!gesperrt) {
      beiUeberfahren(s, { 'border-color': F.randAktiv, color: F.textHell });
      s.onclick = bei;
    }
    return s;
  }

  /** Eine Listenzeile: Stern, Name, Verfügbarkeitszeichen, Auswahlkasten. */
  private zeileBauen(name: string): HTMLDivElement {
    const aktiv = name === this.gewaehlt;
    const eigen = istEigenesModell(name);
    const zeile = el(
      'div',
      stil({
        display: 'flex',
        'align-items': 'center',
        gap: '9px',
        height: '30px',
        flex: 'none',
        padding: '0 10px',
        'border-radius': `${M.radiusKlein}px`,
        cursor: 'pointer',
        background: aktiv ? F.wahlFlaeche : 'transparent',
        // Der Ring liegt INNEN als Schatten statt als Rahmen: Ein Rahmen
        // würde die Zeile um zwei Pixel wachsen lassen und die ganze
        // Liste beim Anklicken springen.
        'box-shadow': aktiv ? `inset 0 0 0 1px ${F.akzent}` : 'none',
        color: aktiv ? F.textHell : eigen ? F.textRuhig : F.gedimmt2,
      })
    );
    if (!aktiv) beiUeberfahren(zeile, { background: F.erhoben });

    // ★ = eigenes Modell, ⊘ = entfällt. Der Punkt, der hier für „nicht
    // eigen" stand, war zu leise — er hiess „kein Stern", nicht „gehört
    // nicht mehr ins Spiel".
    // Bewusst NICHT ✕: Das steht in derselben Zeile schon für „GLB liegt
    // nicht auf dem Server" (Verfügbarkeitsprüfung). Zwei verschiedene
    // Fragen mit einem Zeichen zu beantworten verwischt beide — ein
    // eigenes Modell kann fehlen, ein fremdes kann daliegen.
    const zeichen = el(
      'span',
      stil({ width: '10px', flex: 'none', 'font-size': '11px', color: eigen ? F.akzent : F.fehler }),
      eigen ? '★' : '⊘'
    );
    const txt = el(
      'span',
      stil({ flex: '1', 'font-size': '12.5px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }),
      name
    );
    if (!eigen) {
      zeile.title =
        `${name} steht nicht in EIGENE_MODELLE (shared/src/prefabs.ts). Ansehen geht, ` +
        'setzen nicht — der Spawn-Editor bietet den Namen nicht mehr zur Platzierung an.';
    }
    zeile.append(zeichen, txt);

    // Gemerkt wird die DATEI, nicht der Prefabname: Manche Prefabs zeigen
    // auf eine anders heißende GLB (Boar → Boar_fixed, s. HINT_DEFS). Der
    // Entwurf zeigt an dieser Stelle eine Platzierungszahl — die kennt
    // der Katalog nicht (er redet nicht mit dem Weltdokument), also steht
    // hier das, was er wirklich weiß: liegt die Datei vor?
    const datei = PREFABS_BY_NAME.get(name)?.model;
    const da = datei ? this.vorhanden.get(datei) : undefined;
    if (da !== undefined) {
      const merker = el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', flex: 'none', color: da ? F.ok : F.fehler }),
        da ? '✓' : '✕'
      );
      merker.title = da
        ? 'Modell liegt vor und ist anzeigbar'
        : 'Kein anzeigbares Modell (GLB fehlt oder ohne Geometrie)';
      zeile.appendChild(merker);
    }

    // Auswahlkasten wie im Entwurf — reine Anzeige des Zustands; geklickt
    // wird die ganze Zeile.
    const kasten = el(
      'span',
      stil({
        width: '16px',
        height: '16px',
        flex: 'none',
        'border-radius': '4px',
        display: 'grid',
        'place-items': 'center',
        background: aktiv ? F.akzent : 'transparent',
        border: `1px solid ${aktiv ? F.akzentHell : F.randFeld}`,
      })
    );
    if (aktiv) {
      const haken = sinnbild(PFAD.haken, 10, 3.4);
      haken.style.color = F.aufAkzent;
      kasten.appendChild(haken);
    }
    zeile.appendChild(kasten);

    zeile.onclick = () => void this.waehle(name);
    return zeile;
  }

  /** Auswahl um `richtung` Zeilen verschieben (Pfeiltasten). */
  private nachbarWaehlen(richtung: number): void {
    const sichtbar = this.seitenNamen();
    if (sichtbar.length === 0) return;
    const i = this.gewaehlt ? sichtbar.indexOf(this.gewaehlt) : -1;
    const ziel = Math.min(sichtbar.length - 1, Math.max(0, i + richtung));
    const name = sichtbar[ziel];
    if (name && name !== this.gewaehlt) void this.waehle(name);
  }

  // ── Modell zeigen ──────────────────────────────────────────────────

  /**
   * Ein Prefab auswählen und sein Modell laden.
   *
   * Der Ablauf ist bewusst „erst aufräumen, dann laden": Das alte Modell
   * verschwindet sofort, damit die Bühne nicht wie eingefroren wirkt,
   * während ein großes GLB über die Leitung kommt.
   */
  private async waehle(name: string): Promise<void> {
    this.gewaehlt = name;
    this.listeFuellen();
    const def = PREFABS_BY_NAME.get(name) ?? null;
    this.infoSchreiben(name, def, null, null);

    this.szeneSicherstellen();
    const assets = this.assets;
    if (!assets) return;

    const nummer = ++this.ladeNummer;
    this.modellFreigeben();
    this.letzteMasse = null;
    this.kameraRahmen();

    if (!def || !def.model) {
      // Prefab ohne Modellangabe: Das ist kein Fehler, sondern Absicht
      // (Logik-Prefabs, reine Item-Marken). Platzhalter zeigen und den
      // Grund dazuschreiben.
      this.platzhalterZeigen(def);
      this.infoSchreiben(name, def, null, 'Kein Modell hinterlegt (model = null).');
      this.statusSetzen('Platzhalter — kein Modell hinterlegt', 'fehlt');
      return;
    }

    this.statusSetzen(`lädt ${def.model}.glb …`, 'laedt');

    // Wettlauf gegen die Uhr, s. Kopf (LADE_TIMEOUT).
    let uhr: number | null = null;
    const abbruch = new Promise<'timeout'>((fertig) => {
      uhr = window.setTimeout(() => fertig('timeout'), LADE_TIMEOUT);
    });
    let ergebnis: TransformNode | null | 'timeout';
    try {
      // `idle` als Wunschanimation: instantiate() nimmt einen
      // Teiltreffer, sonst die erste Gruppe — eine ruhende Figur ist
      // aussagekräftiger als die T-Pose des Bind-Space.
      ergebnis = await Promise.race([assets.instantiate(def.model, def.animation ?? 'idle'), abbruch]);
    } catch (err) {
      // instantiate fängt Ladefehler selbst ab; hier landet nur
      // Unerwartetes (kaputte GLB im Parser). Der Katalog darf daran
      // nicht sterben — er ist ein Werkzeug zum Durchsehen.
      console.warn('[katalog] Laden fehlgeschlagen', def.model, err);
      ergebnis = null;
    } finally {
      if (uhr !== null) window.clearTimeout(uhr);
    }

    if (nummer !== this.ladeNummer) {
      // Überholt: Die Instanz gehört zu einer alten Auswahl und muss
      // trotzdem wieder weg — sie hängt bereits in der Szene.
      if (ergebnis && ergebnis !== 'timeout') {
        assets.entsorgeAnimationen(ergebnis);
        ergebnis.dispose(false, false);
      }
      return;
    }

    if (ergebnis === 'timeout') {
      // Bewusst KEIN Eintrag in `vorhanden`: Eine Zeitüberschreitung sagt
      // nichts darüber, ob die Datei existiert — sie kam nur nicht an.
      this.platzhalterZeigen(def);
      this.infoSchreiben(name, def, null, `Zeitüberschreitung nach ${LADE_TIMEOUT / 1000} s — Server antwortet nicht.`);
      this.statusSetzen('Zeitüberschreitung — Platzhalter', 'fehlt');
      this.listeFuellen();
      return;
    }
    if (!ergebnis) {
      // Der vorgesehene Weg für „GLB fehlt" oder „Hierarchie ohne
      // sichtbare Vertices" (s. AssetManager.instantiate).
      this.vorhanden.set(def.model, false);
      this.platzhalterZeigen(def);
      this.infoSchreiben(
        name,
        def,
        null,
        `${def.model}.glb liegt nicht vor oder enthält keine sichtbare Geometrie — Platzhalter in Prefab-Größe.`
      );
      this.statusSetzen('GLB fehlt — Platzhalter', 'fehlt');
      this.listeFuellen();
      return;
    }

    this.vorhanden.set(def.model, true);
    // Weltskalierung wie im Spiel: Die GLB rendert in ihrer natürlichen
    // Größe MAL localScale (s. EntityManager.composeZdoWorld) — ohne das
    // wären die angezeigten Maße nicht die der Welt.
    ergebnis.scaling.set(def.localScale.x, def.localScale.y, def.localScale.z);
    this.gezeigt = ergebnis;
    const masse = this.messen(ergebnis);
    this.letzteMasse = masse;
    this.kameraRahmen();
    this.infoSchreiben(name, def, masse, null);
    this.statusSetzen('GLB geladen', 'da');
    this.listeFuellen();
  }

  /**
   * Statusplakette über der Bühne. Sie beantwortet die Frage, die man
   * beim Anschauen sofort hat: Ist das da das Modell — oder nur sein
   * Platz? Leerer Text blendet sie aus; es gibt keinen „nichts"-Zustand,
   * den man anschreiben müsste.
   */
  private statusSetzen(text: string, art: StatusArt): void {
    this.statusZeile.textContent = text;
    this.statusPlakette.style.display = text ? 'flex' : 'none';
    this.statusPunkt.style.background =
      art === 'da' ? F.ok : art === 'fehlt' ? F.fehler : art === 'laedt' ? F.akzentLicht : F.gedimmt2;
    // Nur beim Laden pulsiert er — ein dauerhaft blinkender Punkt wird
    // zum Hintergrundrauschen und meldet dann nichts mehr.
    this.statusPunkt.className = art === 'laedt' ? 'wov-puls' : '';
  }

  /** Gezeigtes Modell aus der Szene nehmen. */
  private modellFreigeben(): void {
    if (!this.gezeigt) return;
    // Materialien und Texturen NICHT mitentsorgen: Sie gehören dem
    // AssetContainer im Cache und werden von jeder weiteren Instanz
    // desselben Prefabs benutzt (instantiate klont sie nicht). Wer sie
    // hier wegwirft, macht das Modell beim zweiten Anschauen weiß.
    this.assets?.entsorgeAnimationen(this.gezeigt);
    this.gezeigt.dispose(false, false);
    this.gezeigt = null;
  }

  /**
   * Drahtgitter-Quader in der Größe, die das Prefab im Spiel als
   * Platzhalter bekommt (renderScale). Bewusst als Gitter und nicht als
   * Körper: Man soll auf den ersten Blick sehen, dass hier kein Modell
   * steht, sondern nur sein Platz.
   */
  private platzhalterZeigen(def: PrefabDef | null): void {
    const scene = this.scene;
    if (!scene) return;
    const w = Math.max(0.2, def?.renderScale.w ?? 1);
    const h = Math.max(0.2, def?.renderScale.h ?? 1);
    const box = MeshBuilder.CreateBox('katalogplatzhalter', { width: w, height: h, depth: w }, scene);
    box.position.y = h / 2;
    if (!this.platzhalterMaterial) {
      const mat = new StandardMaterial('katalogplatzhaltermat', scene);
      mat.wireframe = true;
      // Bronze wie die Handlungsfarbe des Editors — das Gitter ist die
      // einzige Fläche der Bühne, die nicht zum Modell gehört.
      mat.emissiveColor = Color3.FromHexString(F.akzent);
      mat.disableLighting = true;
      this.platzhalterMaterial = mat;
    }
    box.material = this.platzhalterMaterial;
    box.isPickable = false;
    this.gezeigt = box;
    this.letzteMasse = {
      breite: w,
      hoehe: h,
      tiefe: w,
      dreiecke: 0,
      meshes: 0,
      materialien: 0,
      mitte: new Vector3(0, h / 2, 0),
    };
    this.kameraRahmen();
  }

  /**
   * Hülle, Dreiecke, Meshes und Materialien der geladenen Hierarchie.
   *
   * Gezählt wird nur, was auch WIRKLICH gerendert wird: instantiate()
   * schaltet die höheren LOD-Schalen des Unity-Exports ab
   * (mesh.setEnabled(false)) — zählte man sie mit, wäre die Dreieckszahl
   * um ein Vielfaches zu hoch und die Hülle womöglich zu groß.
   *
   * Bei geskinnten Figuren ist die Hülle die des BIND-Zustands; eine
   * laufende Animation kann darüber hinausragen. Für „wie groß ist das
   * Ding" genügt das.
   */
  private messen(wurzel: TransformNode): Kennzahlen {
    wurzel.computeWorldMatrix(true);
    const alle: AbstractMesh[] = wurzel instanceof AbstractMesh ? [wurzel] : [];
    alle.push(...wurzel.getChildMeshes(false));
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    let dreiecke = 0;
    let meshes = 0;
    const materialien = new Set<number>();
    for (const m of alle) {
      if (!m.isEnabled() || m.getTotalVertices() === 0) continue;
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bb.minimumWorld);
      max = Vector3.Maximize(max, bb.maximumWorld);
      dreiecke += Math.round(m.getTotalIndices() / 3);
      meshes++;
      if (m.material) materialien.add(m.material.uniqueId);
    }
    if (meshes === 0) {
      min = Vector3.Zero();
      max = Vector3.Zero();
    }
    return {
      breite: max.x - min.x,
      hoehe: max.y - min.y,
      tiefe: max.z - min.z,
      dreiecke,
      meshes,
      materialien: materialien.size,
      mitte: min.add(max).scale(0.5),
    };
  }

  // ── Metadaten ──────────────────────────────────────────────────────

  /**
   * Der Block unter der Bühne: Name, Herkunftsmarke, Dateiname, und
   * darunter die gemessenen Kennzahlen als Spalten (Beschriftung in
   * Versalien, Wert in Mono — alles Gemessene steht im Editor in Mono).
   *
   * Der Entwurf zeigt hier rechts noch eine Platzierungsart (Einzeln /
   * Pinsel / Streuen) und „Auf Karte platzieren". Beides gibt es im
   * Katalog nicht: Er kennt das Weltdokument nicht und setzt nichts — ein
   * toter Umschalter wäre ein Versprechen, das die Datei nicht halten
   * kann. An seiner Stelle steht das, was hier wirklich zu melden ist:
   * die Warnung, wenn das Modell fehlt.
   */
  private infoSchreiben(
    name: string,
    def: PrefabDef | null,
    masse: Kennzahlen | null,
    warnung: string | null
  ): void {
    this.infoBlock.innerHTML = '';

    const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '11px', 'flex-wrap': 'wrap' }));
    const item = ITEMS_NACH_NAME.get(name);
    // Icon, wo es eines gibt: Für Gegenstände ist das Inventarbild oft
    // aussagekräftiger als das Modell (viele Item-GLBs sind winzig).
    const iconDatei = item?.icon ?? def?.sprite ?? null;
    if (iconDatei) {
      const bild = el(
        'img',
        stil({
          width: '30px',
          height: '30px',
          'object-fit': 'contain',
          border: `1px solid ${F.randFeld}`,
          'border-radius': `${M.radiusFeld}px`,
          background: F.feld,
        })
      );
      bild.src = `/assets/sprites/${iconDatei}.png`;
      // Die Sprite-Sammlung ist unvollständig; ein kaputtes Bild-Symbol
      // wäre irreführender als gar keines.
      bild.onerror = () => bild.remove();
      kopf.appendChild(bild);
    }
    kopf.appendChild(
      el(
        'span',
        stil({ 'font-size': '15px', 'font-weight': '600', color: F.textHell }),
        item?.label ? `${item.label} (${name})` : name
      )
    );

    // Die Marke spricht in BEIDE Richtungen. Vorher stand bei fremden
    // Prefabs gar nichts — und „nichts" liest sich wie „normal", nicht
    // wie „das gibt es im Spiel nicht mehr".
    const eigen = istEigenesModell(name);
    kopf.appendChild(
      el(
        'span',
        stil({
          display: 'flex',
          'align-items': 'center',
          gap: '5px',
          padding: '3px 9px',
          'border-radius': '999px',
          background: eigen ? F.warnFlaeche : F.feld,
          border: `1px solid ${eigen ? F.warnRand : F.randFeld}`,
          'font-size': '10.5px',
          color: eigen ? F.warnText : F.fehler,
        }),
        eigen ? '★ eigenes Modell' : '⊘ kein eigenes Modell — entfällt'
      )
    );
    kopf.appendChild(
      el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt2 }),
        def?.model ? `${def.model}.glb` : 'ohne Modelldatei'
      )
    );
    kopf.appendChild(luecke());
    if (warnung) {
      const w = el(
        'span',
        stil({
          padding: '5px 10px',
          'border-radius': `${M.radiusKlein}px`,
          background: F.feld,
          // `F` führt keine eigene Fehlerfläche — der Warnrand ist der
          // nächstliegende Ton, die Schrift trägt das Signal.
          border: `1px solid ${F.warnRand}`,
          'font-size': '11.5px',
          color: F.fehler,
        }),
        `⚠ ${warnung}`
      );
      kopf.appendChild(w);
    }
    // Die Handlung des Entwurfs (Mockup 500): der einzige bronzene Knopf
    // dieser Ansicht. Er erscheint nur, wenn ein Rückruf gesetzt IST und
    // das Prefab ein eigenes Modell hat — was die Whitelist ausschließt,
    // wird nicht platziert, und ein Knopf, der stillschweigend nichts
    // bewirkt, ist schlimmer als keiner.
    if (this.aufPlatzieren && eigen) {
      const setzen = knopf(
        'Auf Karte platzieren',
        () => {
          this.aufPlatzieren?.(name);
          this.schliesse();
        },
        { art: 'bronze', pfad: PFAD.platzieren, titel: `${name} als Platzierung setzen` }
      );
      kopf.appendChild(setzen);
    }
    this.infoBlock.appendChild(kopf);

    // Kennzahlen als Spalten — nur, was der Katalog wirklich gemessen
    // oder aus der Registry gelesen hat.
    const felder: [string, string][] = [];
    if (masse) {
      felder.push(
        ['Maße B×H×T', `${fmt(masse.breite)} × ${fmt(masse.hoehe)} × ${fmt(masse.tiefe)} m`],
        ['Dreiecke', masse.dreiecke.toLocaleString('de-DE')],
        ['Meshes', String(masse.meshes)],
        ['Materialien', String(masse.materialien)]
      );
    }
    if (def) {
      const ls = def.localScale;
      if (ls.x !== 1 || ls.y !== 1 || ls.z !== 1) {
        felder.push(['localScale', `${fmt(ls.x)} / ${fmt(ls.y)} / ${fmt(ls.z)}`]);
      }
      felder.push(['Platzhaltermaß', `${fmt(def.renderScale.w)} × ${fmt(def.renderScale.h)} m`]);
      if (def.animation) felder.push(['Animation', def.animation]);
      if (def.light) felder.push(['Lichtquelle', `Reichweite ${def.light.range} m`]);
    }
    if (item) {
      felder.push(
        ['Typ', ITEM_TYP_TEXT[item.itemType] ?? String(item.itemType)],
        ['Gewicht', fmt(item.weight)],
        ['Stapel', String(item.maxStackSize)]
      );
      if (item.pieceTable) felder.push(['Bau-Tafel', item.pieceTable]);
    }
    felder.push(['Raster', `${fmt(this.rasterSchritt)} m`]);

    const gitter = el('div', stil({ display: 'flex', gap: '26px', 'flex-wrap': 'wrap' }));
    for (const [k, v] of felder) {
      const spalte = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '3px' }));
      spalte.append(
        el('span', beschriftungStil(), k),
        el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '12px', color: F.textRuhig }), v)
      );
      gitter.appendChild(spalte);
    }
    this.infoBlock.appendChild(gitter);
  }

  // ── Verfügbarkeit ──────────────────────────────────────────────────

  /**
   * Für die sichtbare Seite abfragen, ob die GLB überhaupt ausgeliefert
   * wird — per HEAD, also ohne die Datei zu übertragen.
   *
   * Das beantwortet die Frage, die sich beim Durchblättern der vollen
   * Registry sofort stellt: Welche dieser 3.748 Einträge kann ich hier
   * überhaupt ansehen? Ein Klick auf jeden Einzelnen wäre die
   * Alternative — mit 17-MB-Downloads für die, die es gibt.
   *
   * `PRUEF_PARALLEL` deckelt die Gleichzeitigkeit: Der Dev-Server liest
   * jede Datei mit einem eigenen Stream, 60 auf einmal bringen ihn ins
   * Stocken. Ein Netzfehler lässt den Eintrag UNBEKANNT (kein Zeichen) —
   * „fehlt" behaupten wir nur bei einer echten Absage des Servers.
   */
  private async pruefeSeite(): Promise<void> {
    const namen = this.seitenNamen();
    const offen = namen
      .map((n) => PREFABS_BY_NAME.get(n)?.model)
      .filter((m): m is string => !!m && !this.vorhanden.has(m));
    if (offen.length === 0) {
      this.statusSetzen('Seite bereits geprüft.', 'neutral');
      window.setTimeout(() => this.statusSetzen('', 'neutral'), 2000);
      return;
    }
    this.pruefKnopf.disabled = true;
    this.pruefKnopf.textContent = `prüfe ${offen.length} Modelle …`;
    let naechster = 0;
    const arbeiter = async (): Promise<void> => {
      while (naechster < offen.length) {
        const datei = offen[naechster++]!;
        try {
          const antwort = await fetch(`/assets/models/${datei}.glb`, { method: 'HEAD' });
          // Ein 200 mit HTML ist die typische Antwort eines Servers, der
          // Unbekanntes auf die Startseite umbiegt — das ist kein Modell.
          const typ = antwort.headers.get('content-type') ?? '';
          this.vorhanden.set(datei, antwort.ok && !typ.includes('text/html'));
        } catch {
          /* Netzfehler: unbekannt lassen (s. Kopf) */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRUEF_PARALLEL, offen.length) }, arbeiter));
    this.pruefKnopf.textContent = 'Verfügbarkeit dieser Seite prüfen';
    this.pruefKnopf.disabled = false;
    this.listeFuellen();
    const da = namen.filter((n) => {
      const m = PREFABS_BY_NAME.get(n)?.model;
      return m ? this.vorhanden.get(m) === true : false;
    }).length;
    this.statusSetzen(`${da} von ${namen.length} Modellen dieser Seite liegen vor.`, da > 0 ? 'da' : 'fehlt');
  }
}

/** Kurze Zahl fürs Auge: 12,4 statt 12.412345678. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const stellen = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(stellen).replace('.', ',');
}
