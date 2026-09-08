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
 *     Vertices hat (mesh-lose Bone-Rigs des Fremdexports). Beides
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
 * ── Zweite Quelle: der Speicher (`assets/store/`) ────────────────────
 * Die Registry oben kennt nur Prefabs, und von denen nur GLBs. Im
 * Speicher liegen aber auch Texturen, Töne, Höhenfelder und Kulissen —
 * 672 Dateien, die bisher nur der Dateimanager zeigte. Sie stehen jetzt
 * als eigener Bereich („Speicher · …") in derselben Auswahl, mit einer
 * dreistufigen Ordnung: Art (Modelle · Texturen · Ton · Höhenfelder ·
 * Kulisse) → Gruppe (Gebäude, Requisiten, Vegetation, Boden-Texturen,
 * Schritte …) → Untergruppe als Filtermarken. Woher die Ordnung kommt,
 * steht in `StoreKatalogDaten.ts`; dieser Datei gehört nur die Bedienung.
 *
 * Drei Dinge sind dabei anders als beim Prefab-Weg:
 *   - Geladen wird DIREKT aus dem Speicher
 *     (`SceneLoader.LoadAssetContainerAsync('/assets/store/…')`), nicht
 *     über `AssetManager`. Der kennt die Store-Namen nicht — er löst
 *     Prefabnamen auf, und der Speicher hat keine.
 *   - Der Container gehört DIESER Ansicht und wird beim Wechsel ganz
 *     entsorgt (Meshes, Materialien, Texturen). Beim Prefab-Weg bleiben
 *     Materialien absichtlich stehen (sie gehören dem Asset-Cache); hier
 *     gibt es keinen Cache, also gäbe es auch niemanden, der sie später
 *     wieder freigäbe.
 *   - Nicht jede Art ist ein Modell. Texturen bekommen eine Bildbühne
 *     (mit Kachelansicht), Töne einen Abspieler. Die Bühne schaltet
 *     zwischen den dreien um; beim Wechsel hält der Ton an und das Bild
 *     wird gelöscht — sonst spielte der Schrittklang weiter, während man
 *     längst ein Haus ansieht.
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
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
/*
  Der glTF-Lader ist ein NEBENWIRKUNGS-Import: Ohne ihn kennt
  `SceneLoader` das Format nicht und liefert wortlos nichts. `AssetManager`
  bringt ihn zwar schon mit, aber darauf zu bauen hiesse, dass ein
  Aufräumen dort diese Ansicht stillschweigend blind macht — die Vorschau
  bliebe leer, ohne dass irgendwo ein Fehler stünde.
  Side-effect import: without it SceneLoader silently knows no glTF.
*/
import '@babylonjs/loaders/glTF/2.0';
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
import { AssetManager, modelUrl } from '../engine/AssetManager';
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
  schalter,
  schwebendStil,
  sinnbild,
  stil,
  zierTitel,
} from './design';
import {
  SPEICHER_WURZEL,
  STORE_ARTEN,
  gruppenDerArt,
  ladeStoreKatalog,
  sucheSpeicher,
  untergruppenDerGruppe,
  type StoreArt,
  type StoreEintrag,
} from './StoreKatalogDaten';

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
  /**
   * Gesetzt = diese Kategorie kommt aus dem SPEICHER, nicht aus der
   * Prefab-Registry. Die Liste heisst dann nicht „Prefabnamen", sondern
   * „Store-Ids", und Vorschau, Infoblock und Verfügbarkeitsprüfung nehmen
   * jeweils den anderen Zweig (s. `istSpeicher`).
   */
  speicher?: StoreArt;
}

/** Erklärungen der fünf Speicher-Arten — eine Zeile je Bereich. */
const SPEICHER_HINWEIS: Readonly<Record<StoreArt, string>> = {
  Modelle: 'Alle GLBs des Speichers — Gebäude, Requisiten, Gegenstände, Umgebung, Fahrzeuge, Vegetation.',
  Texturen: 'Bilder des Speichers: Boden-Texturen der Landschaft und die Atlanten der Modelle.',
  Ton: 'Klänge des Speichers (Opus in .ogg) — anhören mit dem Abspieler, „Weiter" geht die Untergruppe durch.',
  Höhenfelder: 'Gelände-GLBs (terrain/) — dieselbe 3D-Vorschau wie bei Modellen, nur größer.',
  Kulisse: 'Horizontschalen und Wolken. Bis 600 m Spannweite — die Kamera rückt dafür weiter weg.',
};

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
  /*
    Der Speicher als eigener Bereich — fünf Kategorien, eine je Art.

    Sie stehen HINTEN und nicht vorn: Die Vorgabe-Kategorie bleibt
    „★ Eigene Modelle", wie sie es war. Wer den Katalog öffnet, um ein
    Prefab nachzuschlagen, soll nicht plötzlich in einem Dateibrowser
    landen. Der Speicher ist die zweite Frage („was liegt überhaupt da?"),
    nicht die erste.

    `namen()` liefert hier eine LEERE Liste und wird nie gerufen: Der
    Bestand kommt aus zwei JSON-Dateien, die erst geladen werden müssen
    (s. `speicherTreffer`). Ein Rückgabewert, der so tut, als wäre er die
    Liste, wäre die schlechtere Lüge als eine leere.
  */
  ...STORE_ARTEN.map((art) => ({
    name: `Speicher · ${art}`,
    hinweis: SPEICHER_HINWEIS[art],
    namen: () => [],
    speicher: art,
  })),
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
function katAnzahl(speicher: readonly StoreEintrag[] | null): readonly number[] {
  if (!katAnzahlen) katAnzahlen = KATEGORIEN.map((k) => (k.speicher ? -1 : k.namen().length));
  /*
    Die Speicher-Zahlen können NICHT mitgemerkt werden: Beim ersten
    Listenaufbau ist der Bestand noch nicht geladen, und eine gemerkte
    Null bliebe für die Sitzung stehen — die Marke sagte dauerhaft „0
    Töne", während die Liste 44 zeigt. Sie werden deshalb jedes Mal
    gezählt; das ist ein Durchlauf über 672 Einträge und damit
    billiger als der Aufbau der Marken selbst.
  */
  return katAnzahlen.map((n, i) => {
    const art = KATEGORIEN[i]?.speicher;
    if (!art) return n;
    return speicher ? speicher.filter((e) => e.art === art).length : 0;
  });
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
  /** Zweite Ebene des Speichers: die Gruppen der gewählten Art. */
  private readonly gruppenZeile: HTMLDivElement;
  /** Dritte Ebene: die Untergruppen der gewählten Gruppe als Filtermarken. */
  private readonly untergruppenZeile: HTMLDivElement;
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

  // ── Speicher-Bühnen (Bild und Ton liegen über dem Canvas) ─────────
  private readonly bildFlaeche: HTMLDivElement;
  private readonly bildRahmen: HTMLDivElement;
  private readonly bild: HTMLImageElement;
  private readonly bildKachelKnopf: HTMLButtonElement;
  private readonly bildZeile: HTMLDivElement;
  private readonly tonFlaeche: HTMLDivElement;
  private readonly tonTitel: HTMLDivElement;
  private readonly tonSpieler: HTMLAudioElement;
  private readonly tonWeiter: HTMLButtonElement;

  // ── Listenzustand ─────────────────────────────────────────────────
  private kategorie = 0;
  private suchtext = '';
  private seite = 0;
  private gewaehlt: string | null = null;
  private sucheTimer: number | null = null;

  // ── Speicherzustand ───────────────────────────────────────────────
  /** Der geladene Bestand — null, solange nichts geladen ist. */
  private speicher: readonly StoreEintrag[] | null = null;
  private speicherLaedt = false;
  private speicherFehler: string | null = null;
  /** Nachschlagewerk Id → Eintrag; die Liste führt nur Ids. */
  private storeIndex = new Map<string, StoreEintrag>();
  /** Gewählte Gruppe der zweiten Ebene (null = alle). */
  private gruppe: string | null = null;
  /** Gewählte Untergruppe der dritten Ebene (null = alle). */
  private untergruppe: string | null = null;
  /** Kachelansicht der Texturvorschau (2 × 2 wiederholt). */
  private kachelAn = false;
  /**
   * Zeigt die reinen Kollisionsnetze mit an.
   *
   * Vorgabe AUS: Zwölf der GLBs im Speicher sind keine Modelle, sondern
   * unsichtbare Hüllen — texturlose graue Kästen, die zwischen den
   * Häusern stehen und wie kaputte Häuser aussehen. Neun davon sind
   * ausserdem verwaist (kein Prefab zeigt auf sie). Wer sie sucht,
   * findet sie über die Untergruppe „Kollisionsnetze" oder diesen
   * Schalter; wer sie nicht sucht, stolpert nicht über sie.
   */
  private netzeZeigen = false;
  /**
   * Der Container der Speicher-Vorschau. Er gehört DIESER Ansicht und
   * wird beim Wechsel ganz entsorgt — anders als beim Prefab-Weg, wo die
   * Materialien dem Asset-Cache gehören (s. Kopf).
   */
  private storeContainer: AssetContainer | null = null;
  /** Der gerade gezeigte Speicher-Eintrag (für Infoblock, Ton und Kachel). */
  private gezeigterStore: StoreEintrag | null = null;
  /** Gemessene Bildgröße der Texturvorschau — erst nach `onload` bekannt. */
  private bildMasse: { breite: number; hoehe: number } | null = null;

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
    // Im Speicher-Bereich sucht dasselbe Feld auch über Gruppe,
    // Untergruppe und Kennzeichen — „Fässer" und „Schnee" finden dort
    // etwas, obwohl kein Dateiname so heisst.
    suche.placeholder = 'Suchen — eiche, grab, Fässer, Nadelbäume, Schnee …';
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

    // Die zwei Ebenen unter der Art. Sie sind LEER und unsichtbar,
    // solange keine Speicher-Kategorie gewählt ist — eine dauerhaft
    // reservierte, leere Zeile über der Liste wäre nur verschenkter Platz
    // in der schmalsten Spalte des Editors.
    this.gruppenZeile = el(
      'div',
      stil({ padding: '9px 12px 0', display: 'none', gap: '6px', 'flex-wrap': 'wrap', flex: 'none' })
    );
    this.untergruppenZeile = el(
      'div',
      stil({ padding: '7px 12px 0', display: 'none', gap: '5px', 'flex-wrap': 'wrap', flex: 'none' })
    );
    linkeSpalte.append(this.gruppenZeile, this.untergruppenZeile);

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

    /*
      ── Bildbühne (Texturen) ─────────────────────────────────────────
      Eine Textur in einer 3D-Szene zu zeigen (auf einer Ebene, mit
      Kamera) wäre der aufwendigere Weg zum schlechteren Bild: Man sähe
      Perspektive, Beleuchtung und Filterung — alles Dinge, die man an
      einer Textur GERADE NICHT sehen will. Ein <img> zeigt die Pixel.

      Die Kachelansicht daneben beantwortet die einzige Frage, die ein
      Einzelbild nicht beantwortet: Setzt sich das nahtlos fort? Sie
      wiederholt dasselbe Bild 2 × 2 über `background-repeat` — dieselben
      Bytes, kein zweiter Ladevorgang.
    */
    this.bildFlaeche = el(
      'div',
      stil({
        position: 'absolute',
        inset: '0',
        display: 'none',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '12px',
        padding: '18px',
      })
    );
    this.bildRahmen = el(
      'div',
      stil({
        'max-width': '100%',
        'max-height': '100%',
        display: 'grid',
        'place-items': 'center',
        overflow: 'hidden',
        border: `1px solid ${F.randKnopf}`,
        'border-radius': `${M.radiusFeld}px`,
        background: F.feld,
      })
    );
    this.bild = el(
      'img',
      stil({ display: 'block', 'max-width': '100%', 'max-height': '100%', 'object-fit': 'contain' })
    );
    this.bild.alt = '';
    this.bildRahmen.appendChild(this.bild);
    this.bildZeile = el(
      'div',
      stil({ display: 'flex', 'align-items': 'center', gap: '10px', 'flex-wrap': 'wrap', 'justify-content': 'center' })
    );
    this.bildKachelKnopf = knopf('Kachelansicht 2 × 2', () => this.kachelSetzen(!this.kachelAn), {
      art: 'leise',
      hoehe: 30,
      pfad: PFAD.raster,
    });
    this.bildZeile.appendChild(this.bildKachelKnopf);
    this.bildFlaeche.append(this.bildRahmen, this.bildZeile);
    buehne.appendChild(this.bildFlaeche);

    /*
      ── Tonbühne ─────────────────────────────────────────────────────
      Ein echtes <audio controls> statt eigener Knöpfe: Es bringt
      Abspielen, Suchlauf, Dauer und Lautstärke mit, und zwar die des
      Browsers — also die, die Mike schon kennt. Eine Wellenform ist hier
      ausdrücklich nicht nötig; die Frage ist „wie klingt das", nicht „wie
      sieht das aus".

      Der „Weiter"-Knopf ist der eigentliche Gewinn: Neun Grasklänge
      einzeln anzuklicken sagt wenig, sie hintereinander zu hören sagt
      alles über die Streuung der Menge.
    */
    this.tonFlaeche = el(
      'div',
      stil({
        position: 'absolute',
        inset: '0',
        display: 'none',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '14px',
        padding: '18px',
      })
    );
    this.tonTitel = el(
      'div',
      stil({ 'font-family': SCHRIFT.mono, 'font-size': '12.5px', color: F.textRuhig, 'text-align': 'center' })
    );
    this.tonSpieler = el('audio', stil({ width: 'min(460px, 90%)' }));
    this.tonSpieler.controls = true;
    this.tonSpieler.preload = 'metadata';
    this.tonWeiter = knopf('Weiter in dieser Untergruppe', () => this.tonWeiterSpielen(), {
      art: 'leise',
      hoehe: 30,
      pfad: PFAD.pfeilRechts,
    });
    this.tonFlaeche.append(this.tonTitel, this.tonSpieler, this.tonWeiter);
    buehne.appendChild(this.tonFlaeche);

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
    // Ein geschlossener Katalog rechnet keine Bilder — und darf erst
    // recht keinen Ton mehr machen. Ein Schrittklang, der hinter der
    // Karte weiterläuft, ist die Sorte Fehler, die man erst sucht,
    // nachdem man sie eine Minute gehört hat.
    this.tonAnhalten();
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

    /*
      Messzelle für Lecks — nur im Entwicklungsserver.

      Der Katalog wechselt beim Durchblättern die Vorschau, und jede
      Vorschau bringt Meshes, Materialien und Texturen mit. Ob das
      Aufräumen wirklich aufräumt, sieht man an nichts: Ein Leck kostet
      Speicher, aber kein Bild und keine Fehlermeldung. Diese Funktion ist
      der Zeuge — eine Messung liest sie vor und nach zwanzig Wechseln und
      hält die Zahlen gegeneinander (`/home/mike/wov-lab-mess/
      katalog-speicher.mjs`). Im Produktionsbau wirft Vite den Zweig über
      die Konstante `import.meta.env.DEV` weg.
    */
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__wovKatalogZaehler = (): Record<string, number> => ({
        meshes: this.scene?.meshes.length ?? 0,
        materialien: this.scene?.materials.length ?? 0,
        texturen: this.scene?.textures.length ?? 0,
        tonElemente: document.querySelectorAll('audio').length,
      });
    }
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
    k.radius = spanne * this.kameraFaktor;
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
   * Wie weit die Kamera von der Objektgröße weg steht.
   *
   * 2,4 zeigt einen Körper ganz und mit Luft drumherum. Eine Kulisse ist
   * aber kein Körper, sondern eine Hohlschale von bis zu 600 m — bei 2,4
   * stünde man 1,4 km entfernt vor einem Punkt. Deshalb ist der Faktor
   * kein Festwert mehr, sondern gehört zur Auswahl.
   */
  private kameraFaktor = 2.4;

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
    // Die zwei unteren Ebenen gehören zur ART. Sie mit in die neue
    // Kategorie zu nehmen ergäbe eine leere Liste mit gesetztem Filter —
    // der klassische „ich sehe nichts und weiss nicht, warum"-Zustand.
    this.gruppe = null;
    this.untergruppe = null;
    if (this.katSelect) this.katSelect.value = String(i);
    if (KATEGORIEN[i]?.speicher) void this.speicherSicherstellen();
    this.listeFuellen();
  }

  /** Ist die aktuelle Kategorie ein Speicher-Bereich? Dann die Art, sonst null. */
  private get speicherArt(): StoreArt | null {
    return KATEGORIEN[this.kategorie]?.speicher ?? null;
  }

  /**
   * Bestand des Speichers besorgen — genau einmal.
   *
   * `ladeStoreKatalog()` merkt sich sein Versprechen selbst; der Wächter
   * hier verhindert nur die zweite ANZEIGE-Runde (Liste neu bauen), nicht
   * die zweite Anfrage.
   */
  private async speicherSicherstellen(): Promise<void> {
    if (this.speicher || this.speicherLaedt) return;
    this.speicherLaedt = true;
    this.speicherFehler = null;
    this.listeFuellen();
    try {
      const bestand = await ladeStoreKatalog();
      this.speicher = bestand;
      this.storeIndex = new Map(bestand.map((e) => [e.id, e]));
    } catch (err) {
      // Der Speicher liegt ausserhalb des Repos; auf einem Checkout ohne
      // ihn ist das kein Fehler des Katalogs, sondern eine Auskunft.
      this.speicherFehler = String(err);
      console.warn('[katalog] Speicher nicht lesbar', err);
    } finally {
      this.speicherLaedt = false;
      this.listeFuellen();
    }
  }

  /**
   * Die Speicher-Einträge der aktuellen Art nach Suche und Filtern.
   *
   * Reihenfolge ist Absicht: erst die ART, dann die SUCHE, erst danach
   * Gruppe und Untergruppe. Andersherum fände „Nadelbäume" nichts mehr,
   * sobald die Gruppe „Bäume" gewählt ist — und die Zahlen auf den
   * Gruppenmarken zeigten dann den Bestand statt der Treffer.
   */
  private speicherTreffer(): readonly StoreEintrag[] {
    const art = this.speicherArt;
    const bestand = this.speicher;
    if (!art || !bestand) return [];
    const derArt = bestand.filter(
      (e) => e.art === art && (this.netzeZeigen || !e.kennzeichen.includes('Kollisionsnetz'))
    );
    return sucheSpeicher(derArt, this.suchtext);
  }

  /** Dieselben Treffer, zusätzlich auf Gruppe und Untergruppe verengt. */
  private speicherGefiltert(): readonly StoreEintrag[] {
    return this.speicherTreffer().filter(
      (e) => (!this.gruppe || e.gruppe === this.gruppe) && (!this.untergruppe || e.untergruppe === this.untergruppe)
    );
  }

  /** Namen der aktuellen Kategorie nach Suchfilter. */
  private treffer(): string[] {
    if (this.speicherArt) return this.speicherGefiltert().map((e) => e.id);
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
    if (kat.speicher) {
      // Im Speicher-Bereich gibt es keine „eigenes Modell"-Quote — die
      // Frage stellt sich dort nicht (alles im Speicher IST eine Datei).
      // An ihrer Stelle steht der Ladezustand: Ohne ihn sähe ein noch
      // nicht geladener Bestand aus wie ein leerer.
      this.katHinweis.appendChild(this.speicherZustand());
      if (kat.speicher === 'Modelle') {
        // Nur bei den Modellen: Texturen, Töne, Höhenfelder und Kulissen
        // haben keine Kollisionsnetze, dort wäre der Schalter ein
        // Bedienelement ohne Wirkung.
        const netzZeile = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '9px' }));
        netzZeile.append(
          schalter(this.netzeZeigen, (an) => {
            this.netzeZeigen = an;
            this.seite = 0;
            this.listeFuellen();
          }),
          el(
            'span',
            stil({ 'font-size': '11.5px', color: F.gedimmt }),
            'Kollisionsnetze mitzeigen (12 unsichtbare Hüllen, 9 davon ohne Hauptmodell)'
          )
        );
        this.katHinweis.appendChild(netzZeile);
      }
    } else if (alle.length > 0) {
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
    const anzahlen = katAnzahl(this.speicher);
    KATEGORIEN.forEach((k, i) => {
      this.markenZeile.appendChild(
        marke(`${k.name} ${anzahlen[i] ?? 0}`, i === this.kategorie, () => this.kategorieSetzen(i))
      );
    });

    this.ebenenZeichnen();

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

  /**
   * Der Zustandskasten des Speicher-Bereichs: lädt / da / nicht lesbar.
   *
   * Er ersetzt die „eigenes Modell"-Quote der Prefab-Kategorien. Ohne ihn
   * wären „noch nicht geladen" und „nichts gefunden" auf dem Bildschirm
   * dasselbe Bild — eine leere Liste.
   */
  private speicherZustand(): HTMLDivElement {
    const laedt = this.speicherLaedt;
    const kaputt = this.speicherFehler !== null;
    const gut = !laedt && !kaputt && this.speicher !== null;
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
    zeichen.style.color = gut ? F.ok : kaputt ? F.fehler : F.warnText;
    const text = el(
      'span',
      stil({ 'font-size': '11.5px', 'line-height': '1.45', color: gut ? F.okText : kaputt ? F.fehler : F.warnText })
    );
    if (laedt) {
      text.textContent = 'Speicherverzeichnis wird gelesen …';
    } else if (kaputt) {
      text.textContent = `Speicher nicht lesbar — ${SPEICHER_WURZEL}manifest.json antwortet nicht.`;
    } else {
      const art = this.speicherArt;
      const derArt = (this.speicher ?? []).filter((e) => e.art === art).length;
      text.append(
        el('strong', stil({ color: F.textHell }), String(derArt)),
        document.createTextNode(` Einträge dieser Art · ${this.speicher?.length ?? 0} im ganzen Speicher`)
      );
    }
    kasten.append(zeichen, text);
    return kasten;
  }

  /**
   * Die zwei Ebenen unter der Art: Gruppen (mit Zahl) und Untergruppen.
   *
   * Gezählt wird auf dem Stand NACH der Suche (s. `speicherTreffer`) —
   * eine Marke „Requisiten 242", die nach dem Tippen von „fass" immer
   * noch 242 sagt, wäre eine Zahl über einen Bestand, den man gerade
   * nicht ansieht.
   */
  private ebenenZeichnen(): void {
    const art = this.speicherArt;
    this.gruppenZeile.innerHTML = '';
    this.untergruppenZeile.innerHTML = '';
    if (!art || !this.speicher) {
      this.gruppenZeile.style.display = 'none';
      this.untergruppenZeile.style.display = 'none';
      return;
    }
    const treffer = this.speicherTreffer();
    const gruppen = gruppenDerArt(treffer, art);
    this.gruppenZeile.style.display = gruppen.length > 1 ? 'flex' : 'none';
    if (gruppen.length > 1) {
      this.gruppenZeile.appendChild(
        marke(`Alle ${treffer.length}`, this.gruppe === null, () => this.gruppeSetzen(null))
      );
      for (const g of gruppen) {
        this.gruppenZeile.appendChild(
          marke(`${g.name} ${g.anzahl}`, this.gruppe === g.name, () => this.gruppeSetzen(g.name))
        );
      }
    }

    // Untergruppen nur, wenn eine Gruppe steht: Über alle Gruppen hinweg
    // wären es vierzig Marken, und „Fässer" hiesse dann bei Requisiten
    // etwas anderes als bei Gegenständen.
    if (!this.gruppe) {
      this.untergruppenZeile.style.display = 'none';
      return;
    }
    const unter = untergruppenDerGruppe(treffer, art, this.gruppe);
    this.untergruppenZeile.style.display = unter.length > 1 ? 'flex' : 'none';
    if (unter.length > 1) {
      this.untergruppenZeile.appendChild(marke('alle', this.untergruppe === null, () => this.untergruppeSetzen(null)));
      for (const u of unter) {
        this.untergruppenZeile.appendChild(
          marke(`${u.name} ${u.anzahl}`, this.untergruppe === u.name, () => this.untergruppeSetzen(u.name))
        );
      }
    }
  }

  private gruppeSetzen(name: string | null): void {
    if (this.gruppe === name) return;
    this.gruppe = name;
    // Eine Untergruppe der ALTEN Gruppe gibt es in der neuen nicht — sie
    // stehen zu lassen hiesse, eine leere Liste mit unsichtbarem Grund.
    this.untergruppe = null;
    this.seite = 0;
    this.listeFuellen();
  }

  private untergruppeSetzen(name: string | null): void {
    if (this.untergruppe === name) return;
    this.untergruppe = name;
    this.seite = 0;
    this.listeFuellen();
  }

  /**
   * Eine Zeile des Speicher-Bereichs.
   *
   * Statt Stern und ⊘ (die dort nichts bedeuten) trägt sie die
   * Untergruppe rechts — die Antwort auf „was ist das eigentlich?", ohne
   * dass man klicken muss.
   */
  private speicherZeileBauen(eintrag: StoreEintrag): HTMLDivElement {
    const aktiv = eintrag.id === this.gewaehlt;
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
        'box-shadow': aktiv ? `inset 0 0 0 1px ${F.akzent}` : 'none',
        color: aktiv ? F.textHell : F.textRuhig,
      })
    );
    if (!aktiv) beiUeberfahren(zeile, { background: F.erhoben });
    const txt = el(
      'span',
      stil({
        flex: '1',
        'font-size': '12.5px',
        overflow: 'hidden',
        'text-overflow': 'ellipsis',
        'white-space': 'nowrap',
      }),
      eintrag.name
    );
    zeile.title = `${eintrag.id} — ${eintrag.gruppe} / ${eintrag.untergruppe}`;
    const rechts = el(
      'span',
      stil({ 'font-size': '10.5px', color: F.gedimmt2, flex: 'none' }),
      eintrag.kennzeichen.length > 0 ? `${eintrag.untergruppe} · ${eintrag.kennzeichen[0]}` : eintrag.untergruppe
    );
    zeile.append(txt, rechts);

    const da = this.vorhanden.get(eintrag.pfad);
    if (da !== undefined) {
      const merker = el(
        'span',
        stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', flex: 'none', color: da ? F.ok : F.fehler }),
        da ? '✓' : '✕'
      );
      merker.title = da ? 'Datei liegt im Speicher' : 'Datei fehlt im Speicher (Manifest kennt sie, der Server nicht)';
      zeile.appendChild(merker);
    }
    zeile.onclick = () => void this.waehle(eintrag.id);
    return zeile;
  }

  /** Eine Listenzeile: Stern, Name, Verfügbarkeitszeichen, Auswahlkasten. */
  private zeileBauen(name: string): HTMLDivElement {
    const speicherEintrag = this.speicherArt ? this.storeIndex.get(name) : undefined;
    if (speicherEintrag) return this.speicherZeileBauen(speicherEintrag);
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
    const speicherEintrag = this.speicherArt ? this.storeIndex.get(name) : undefined;
    if (speicherEintrag) {
      await this.waehleSpeicher(speicherEintrag);
      return;
    }
    this.gewaehlt = name;
    this.listeFuellen();
    // Zurück aus einer Speicher-Ansicht: Bild und Ton müssen weg, sonst
    // liegt die Textur weiter über der Bühne, auf der das Modell steht.
    this.buehneUmschalten('modell');
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
    if (this.storeContainer) {
      /*
        Der Speicher-Container gehört DIESER Ansicht: Meshes, Materialien
        und Texturen gehen mit weg. `this.gezeigt` zeigt auf einen seiner
        Wurzelknoten — ihn zusätzlich einzeln zu entsorgen wäre ein
        zweites `dispose` auf denselben Knoten. Ohne diesen Zweig wüchse
        `scene.textures` bei jedem Wechsel; ein 4096er-Atlas je Haus
        summiert sich nach zwanzig Klicks auf mehrere hundert Megabyte.
      */
      this.storeContainer.dispose();
      this.storeContainer = null;
      this.gezeigt = null;
      return;
    }
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

  // ── Speicher: Vorschau je Art ──────────────────────────────────────

  /**
   * Die Bühne kann DREIERLEI zeigen, aber immer nur eines.
   *
   * Der Umschalter ist zugleich die Aufräumstelle: Wer von einem
   * Schrittklang zu einem Haus wechselt, will nicht, dass der Klang
   * weiterläuft, und wer von einer Textur weggeht, braucht ihr Bild nicht
   * mehr im Speicher. Beides hier zu erledigen statt an jeder Aufrufstelle
   * ist der Unterschied zwischen „meistens aufgeräumt" und „aufgeräumt".
   */
  private buehneUmschalten(was: 'modell' | 'bild' | 'ton'): void {
    this.leinwand.style.display = was === 'modell' ? 'block' : 'none';
    this.bildFlaeche.style.display = was === 'bild' ? 'flex' : 'none';
    this.tonFlaeche.style.display = was === 'ton' ? 'flex' : 'none';
    this.rasterPlakette.style.display = was === 'modell' ? '' : 'none';
    if (was !== 'ton') this.tonAnhalten();
    if (was !== 'bild') this.bildFreigeben();
  }

  /** Ton anhalten und die Quelle lösen. */
  private tonAnhalten(): void {
    if (!this.tonSpieler.getAttribute('src')) return;
    this.tonSpieler.pause();
    /*
      `removeAttribute` statt `src = ''`: Ein leerer String ist eine
      RELATIVE Adresse. Der Browser lädt daraufhin die Editorseite selbst
      als Tondatei und meldet einen Fehler, den niemand zuordnen kann.
    */
    this.tonSpieler.removeAttribute('src');
    this.tonSpieler.load();
  }

  /** Bild lösen — sonst hält der Browser die Pixel für die ganze Sitzung. */
  private bildFreigeben(): void {
    if (this.bild.getAttribute('src')) {
      this.bild.removeAttribute('src');
    }
    this.bildRahmen.style.backgroundImage = 'none';
    this.bildRahmen.style.width = '';
    this.bildRahmen.style.height = '';
    this.bild.style.display = 'block';
  }

  /**
   * Ein Speicher-Eintrag ist gewählt — je nach Art in eine andere Bühne.
   *
   * `autoplay` setzt nur der „Weiter"-Knopf: Der Klick darauf IST die
   * Nutzergeste, die der Browser für das Abspielen verlangt. Beim bloßen
   * Anklicken einer Zeile wäre selbsttätiger Ton eine Zumutung.
   */
  private async waehleSpeicher(eintrag: StoreEintrag, autoplay = false): Promise<void> {
    this.gewaehlt = eintrag.id;
    this.gezeigterStore = eintrag;
    this.listeFuellen();

    const nummer = ++this.ladeNummer;
    this.modellFreigeben();
    this.letzteMasse = null;

    if (eintrag.art === 'Ton') {
      this.tonZeigen(eintrag, autoplay);
      return;
    }
    if (eintrag.art === 'Texturen') {
      this.texturZeigen(eintrag, nummer);
      return;
    }
    await this.storeModellZeigen(eintrag, nummer);
  }

  /** Ton: Abspieler auf die Datei setzen, Infoblock schreiben. */
  private tonZeigen(eintrag: StoreEintrag, autoplay: boolean): void {
    this.buehneUmschalten('ton');
    this.tonTitel.textContent = `${eintrag.gruppe} · ${eintrag.untergruppe} — ${eintrag.pfad}`;
    this.tonSpieler.src = `${SPEICHER_WURZEL}${eintrag.pfad}`;
    this.tonSpieler.load();
    this.statusSetzen(`${eintrag.gruppe} — bereit`, 'neutral');
    this.speicherInfoSchreiben(eintrag, null);
    // Erst wenn die Dauer bekannt ist, kann sie im Infoblock stehen. Das
    // Manifest nennt sie zwar in `origin`, aber als Fliesstext — die
    // gemessene Zahl aus dem Element ist die verlässlichere Auskunft.
    /*
      BEIDE Ereignisse, und das ist kein Gürtel-und-Hosenträger: Bei
      Opus-in-Ogg meldet Chromium `loadedmetadata` noch mit `duration =
      Infinity` und reicht die echte Länge erst mit `durationchange`
      nach. Nur auf das erste zu hören liefert dauerhaft „— s".
      Chromium reports Infinity on loadedmetadata for Opus-in-Ogg.
    */
    const dauerZeigen = (): void => {
      if (this.gezeigterStore?.id !== eintrag.id) return;
      const d = this.tonSpieler.duration;
      this.statusSetzen(Number.isFinite(d) ? `${fmt(d)} s` : 'bereit', 'da');
      this.speicherInfoSchreiben(eintrag, null);
    };
    this.tonSpieler.onloadedmetadata = dauerZeigen;
    this.tonSpieler.ondurationchange = dauerZeigen;
    this.tonSpieler.onerror = () => {
      if (this.gezeigterStore?.id !== eintrag.id) return;
      this.vorhanden.set(eintrag.pfad, false);
      this.statusSetzen('Klang liegt nicht vor', 'fehlt');
      this.speicherInfoSchreiben(eintrag, 'Die Datei ist im Manifest verzeichnet, der Server liefert sie nicht aus.');
      this.listeFuellen();
    };
    const nachbarn = this.tonNachbarn(eintrag);
    this.tonWeiter.style.display = nachbarn.length > 1 ? '' : 'none';
    this.tonWeiter.textContent = `Weiter (${nachbarn.length} in „${eintrag.untergruppe}")`;
    if (autoplay) void this.tonSpieler.play().catch(() => undefined);
  }

  /** Alle Klänge derselben Untergruppe, in Listenreihenfolge. */
  private tonNachbarn(eintrag: StoreEintrag): readonly StoreEintrag[] {
    return (this.speicher ?? []).filter(
      (e) => e.art === 'Ton' && e.gruppe === eintrag.gruppe && e.untergruppe === eintrag.untergruppe
    );
  }

  /** Nächsten Klang der Untergruppe wählen und sofort abspielen. */
  private tonWeiterSpielen(): void {
    const jetzt = this.gezeigterStore;
    if (!jetzt || jetzt.art !== 'Ton') return;
    const liste = this.tonNachbarn(jetzt);
    if (liste.length === 0) return;
    const i = liste.findIndex((e) => e.id === jetzt.id);
    // Modulo statt Anschlag am Ende: Neun Grasklänge im Kreis zu hören
    // ist genau das, wofür der Knopf da ist — ein toter Knopf beim
    // letzten Eintrag wäre eine Sackgasse ohne Grund.
    const naechster = liste[(i + 1) % liste.length];
    if (naechster) void this.waehleSpeicher(naechster, true);
  }

  /** Textur: Bild laden, Abmessungen messen, Kachelansicht anbieten. */
  private texturZeigen(eintrag: StoreEintrag, nummer: number): void {
    this.buehneUmschalten('bild');
    this.statusSetzen(`lädt ${eintrag.pfad} …`, 'laedt');
    this.speicherInfoSchreiben(eintrag, null);
    this.kachelKnopfBeschriften();
    this.bild.onload = () => {
      if (nummer !== this.ladeNummer) return;
      this.vorhanden.set(eintrag.pfad, true);
      this.bildMasse = { breite: this.bild.naturalWidth, hoehe: this.bild.naturalHeight };
      this.statusSetzen(`${this.bild.naturalWidth} × ${this.bild.naturalHeight} px`, 'da');
      this.kachelZeichnen();
      this.speicherInfoSchreiben(eintrag, null);
      this.listeFuellen();
    };
    this.bild.onerror = () => {
      if (nummer !== this.ladeNummer) return;
      this.vorhanden.set(eintrag.pfad, false);
      this.bildMasse = null;
      this.statusSetzen('Bild liegt nicht vor', 'fehlt');
      this.speicherInfoSchreiben(eintrag, 'Die Datei ist im Manifest verzeichnet, der Server liefert sie nicht aus.');
      this.listeFuellen();
    };
    this.bildMasse = null;
    this.bild.src = `${SPEICHER_WURZEL}${eintrag.pfad}`;
  }

  private kachelSetzen(an: boolean): void {
    this.kachelAn = an;
    this.kachelKnopfBeschriften();
    this.kachelZeichnen();
  }

  private kachelKnopfBeschriften(): void {
    this.bildKachelKnopf.textContent = this.kachelAn ? 'Einzelbild' : 'Kachelansicht 2 × 2';
  }

  /**
   * Einzelbild oder 2 × 2 gekachelt.
   *
   * Die Kachelansicht benutzt DIESELBE Adresse als
   * `background-image` — der Browser hat die Pixel schon, es kostet also
   * keinen zweiten Ladevorgang. Sie beantwortet die einzige Frage, die
   * ein Einzelbild nicht beantwortet: Setzt sich das nahtlos fort?
   */
  private kachelZeichnen(): void {
    const quelle = this.bild.getAttribute('src');
    if (!quelle) return;
    if (!this.kachelAn) {
      this.bildRahmen.style.backgroundImage = 'none';
      this.bildRahmen.style.width = '';
      this.bildRahmen.style.height = '';
      this.bild.style.display = 'block';
      return;
    }
    this.bild.style.display = 'none';
    this.bildRahmen.style.width = '360px';
    this.bildRahmen.style.height = '360px';
    this.bildRahmen.style.backgroundImage = `url("${quelle}")`;
    this.bildRahmen.style.backgroundRepeat = 'repeat';
    this.bildRahmen.style.backgroundSize = '50% 50%';
  }

  /**
   * Modell, Höhenfeld oder Kulisse — direkt aus dem Speicher.
   *
   * Bewusst NICHT über `AssetManager.instantiate()`: Der löst
   * PREFABNAMEN auf (`modelBaseUrl` + `<name>.glb` unter
   * `assets/models/`) und kennt die Store-Pfade nicht. Er würde hier
   * für jeden Eintrag „liegt nicht vor" melden — eine falsche Auskunft
   * über einen Bestand, der vollständig da ist.
   */
  private async storeModellZeigen(eintrag: StoreEintrag, nummer: number): Promise<void> {
    this.buehneUmschalten('modell');
    this.szeneSicherstellen();
    const scene = this.scene;
    if (!scene) return;
    // Kulissen sind Hohlkugeln von bis zu 600 m — mit dem Faktor der
    // Modelle stünde man 1,4 km entfernt vor einem Punkt.
    this.kameraFaktor = eintrag.art === 'Kulisse' ? 1.25 : 2.4;
    this.kameraRahmen();
    this.statusSetzen(`lädt ${eintrag.pfad} …`, 'laedt');
    this.speicherInfoSchreiben(eintrag, null);

    const schraeg = eintrag.pfad.lastIndexOf('/');
    const ordner = `${SPEICHER_WURZEL}${schraeg >= 0 ? eintrag.pfad.slice(0, schraeg + 1) : ''}`;
    const datei = schraeg >= 0 ? eintrag.pfad.slice(schraeg + 1) : eintrag.pfad;

    let uhr: number | null = null;
    const abbruch = new Promise<'timeout'>((fertig) => {
      uhr = window.setTimeout(() => fertig('timeout'), LADE_TIMEOUT);
    });
    let ergebnis: AssetContainer | 'timeout' | null;
    try {
      ergebnis = await Promise.race([SceneLoader.LoadAssetContainerAsync(ordner, datei, scene), abbruch]);
    } catch (err) {
      console.warn('[katalog] Speicher-Modell nicht ladbar', eintrag.pfad, err);
      ergebnis = null;
    } finally {
      if (uhr !== null) window.clearTimeout(uhr);
    }

    if (nummer !== this.ladeNummer) {
      // Überholt — der Container hängt noch nicht in der Szene, muss aber
      // trotzdem weg: Er hält Geometrie und Texturen.
      if (ergebnis && ergebnis !== 'timeout') ergebnis.dispose();
      return;
    }
    if (ergebnis === 'timeout' || !ergebnis) {
      this.vorhanden.set(eintrag.pfad, ergebnis === 'timeout' ? true : false);
      this.statusSetzen(ergebnis === 'timeout' ? 'Zeitüberschreitung' : 'GLB liegt nicht vor', 'fehlt');
      this.speicherInfoSchreiben(
        eintrag,
        ergebnis === 'timeout'
          ? `Zeitüberschreitung nach ${LADE_TIMEOUT / 1000} s — Server antwortet nicht.`
          : 'Die Datei ist im Manifest verzeichnet, der Server liefert sie nicht aus.'
      );
      this.listeFuellen();
      return;
    }

    ergebnis.addAllToScene();
    this.storeContainer = ergebnis;
    this.vorhanden.set(eintrag.pfad, true);
    const wurzel = ergebnis.rootNodes.find((n): n is TransformNode => n instanceof TransformNode) ?? null;
    if (!wurzel) {
      this.statusSetzen('GLB ohne sichtbare Geometrie', 'fehlt');
      this.speicherInfoSchreiben(eintrag, 'Die Datei enthält keine Knoten — nichts zu zeigen.');
      this.listeFuellen();
      return;
    }
    this.gezeigt = wurzel;
    const masse = this.messen(wurzel);
    this.letzteMasse = masse;
    this.kameraRahmen();
    this.statusSetzen('GLB geladen', 'da');
    this.speicherInfoSchreiben(eintrag, null);
    this.listeFuellen();
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

  /**
   * Der Infoblock eines Speicher-Eintrags.
   *
   * Er beantwortet andere Fragen als der Prefab-Block darüber: Dort geht
   * es um Spielwerte (localScale, Item-Gewicht, Animation), hier um die
   * DATEI — wo sie liegt, wie gross sie ist, wie gross das Ding darin
   * ist, ob es eine Kollision hat und ob man es weitergeben darf.
   *
   * „Id kopieren" ist der einzige Knopf: Der Speicher-Name ist das, was
   * man gleich danach braucht — für eine Platzierung, eine Kuratierung
   * oder eine Nachfrage. Ihn von Hand abzutippen (`environment/
   * sm-bld-house-roof-thatch-peak-cap-beams-01`) ist eine Fehlerquelle
   * ohne Gegenwert.
   */
  private speicherInfoSchreiben(eintrag: StoreEintrag, warnung: string | null): void {
    this.infoBlock.innerHTML = '';

    const kopf = el('div', stil({ display: 'flex', 'align-items': 'center', gap: '11px', 'flex-wrap': 'wrap' }));
    kopf.appendChild(el('span', stil({ 'font-size': '15px', 'font-weight': '600', color: F.textHell }), eintrag.name));
    kopf.appendChild(
      el(
        'span',
        stil({
          display: 'flex',
          'align-items': 'center',
          gap: '5px',
          padding: '3px 9px',
          'border-radius': '999px',
          background: F.feld,
          border: `1px solid ${F.randFeld}`,
          'font-size': '10.5px',
          color: F.textRuhig,
        }),
        `${eintrag.art} · ${eintrag.gruppe} · ${eintrag.untergruppe}`
      )
    );
    for (const k of eintrag.kennzeichen) {
      kopf.appendChild(
        el(
          'span',
          stil({
            padding: '3px 8px',
            'border-radius': '999px',
            background: F.warnFlaeche,
            border: `1px solid ${F.warnRand}`,
            'font-size': '10.5px',
            color: F.warnText,
          }),
          k
        )
      );
    }
    kopf.appendChild(
      el('span', stil({ 'font-family': SCHRIFT.mono, 'font-size': '11px', color: F.gedimmt2 }), eintrag.pfad)
    );
    kopf.appendChild(luecke());
    if (warnung) {
      kopf.appendChild(
        el(
          'span',
          stil({
            padding: '5px 10px',
            'border-radius': `${M.radiusKlein}px`,
            background: F.feld,
            border: `1px solid ${F.warnRand}`,
            'font-size': '11.5px',
            color: F.fehler,
          }),
          `⚠ ${warnung}`
        )
      );
    }
    if (eintrag.kennzeichen.includes('Kollisionsnetz') && !eintrag.prefabName) {
      // Neun der zwoelf Netze sind verwaist. Das ist keine Warnung ueber
      // den Katalog, sondern eine Auskunft ueber den Speicher — und
      // genau die Sorte, die man beim Aufraeumen braucht.
      kopf.appendChild(
        el(
          'span',
          stil({
            padding: '5px 10px',
            'border-radius': `${M.radiusKlein}px`,
            background: F.feld,
            border: `1px solid ${F.warnRand}`,
            'font-size': '11.5px',
            color: F.warnText,
          }),
          'verwaist — kein Prefab verweist auf dieses Netz'
        )
      );
    }
    const kopieren = knopf(
      'Id kopieren',
      () => {
        void navigator.clipboard
          ?.writeText(eintrag.id)
          .then(() => this.statusSetzen(`„${eintrag.id}" kopiert`, 'da'))
          // Ohne sicheren Kontext (http auf fremdem Host) gibt es keine
          // Zwischenablage. Statt eines stummen Nichts sagt die Plakette,
          // was los ist — und die Id steht im Kopf daneben zum Markieren.
          .catch(() => this.statusSetzen('Zwischenablage nicht verfügbar', 'fehlt'));
      },
      { art: 'leise', hoehe: 30, pfad: PFAD.export, titel: eintrag.id }
    );
    kopf.appendChild(kopieren);
    this.infoBlock.appendChild(kopf);

    const felder: [string, string][] = [['Id', eintrag.id]];
    felder.push(['Dateigröße', fmtBytes(eintrag.bytes)]);
    const h = eintrag.bounds;
    if (h) {
      felder.push([
        'Hüllbox B×H×T',
        `${fmt(h.max[0] - h.min[0])} × ${fmt(h.max[1] - h.min[1])} × ${fmt(h.max[2] - h.min[2])} m`,
      ]);
    }
    if (h && h.min[1] < -0.001) {
      /*
        Der Ursprung liegt bei 257 Modellen ueber der Unterkante — meist
        Absicht (Bodenkontaktpunkt), bei drei Ausreissern nicht:
        `sm-item-horn` reicht 15,2 m nach unten. Wer das nicht sieht,
        setzt das Ding auf die Karte und sucht es dann unter dem Gelände.
      */
      felder.push(['Unterkante', `${fmt(h.min[1])} m unter dem Ursprung`]);
    }
    if (this.letzteMasse) {
      felder.push(['Dreiecke', this.letzteMasse.dreiecke.toLocaleString('de-DE')], ['Meshes', String(this.letzteMasse.meshes)]);
    }
    if (this.storeContainer) {
      /*
        Materialien und Texturen sind hier keine Neugier, sondern die
        Kontrolle: 468 der Store-GLBs holen ihre Texturen RELATIV
        (`textures/<name>.png` neben der Datei). Stimmt die Wurzel-URL
        nicht, kommt das Modell trotzdem — nur grau, und niemand sagt
        etwas. Eine Texturzahl von 0 an einem Modell, das eine haben
        müsste, ist genau dieser Fall.
      */
      felder.push(
        ['Materialien', String(this.storeContainer.materials.length)],
        ['Texturen geladen', String(this.storeContainer.textures.length)]
      );
    }
    if (eintrag.kollisionsdatei) {
      felder.push(['Kollisionsnetz', eintrag.kollisionsdatei]);
    }
    if (eintrag.kollision) {
      felder.push([
        'Kollision',
        eintrag.kollision === 'box' ? 'Quader' : eintrag.kollision === 'mesh' ? 'Netz' : 'keine',
      ]);
    }
    if (eintrag.art === 'Texturen') {
      felder.push(['Abmessung', this.bildMasse ? `${this.bildMasse.breite} × ${this.bildMasse.hoehe} px` : '—']);
      if (eintrag.gruppe === 'Boden-Texturen') {
        // Die Bodentexturen liegen im Gelände auf einer festen Kachel;
        // ohne den Hinweis rät man an der Pixelzahl herum, wie gross ein
        // Grasbüschel im Spiel wird.
        felder.push(['Kachel', 'Boden-Textur — wird im Gelände gekachelt (Kachelansicht zeigt den Stoß)']);
      }
    }
    if (eintrag.art === 'Ton') {
      const dauer = Number.isFinite(this.tonSpieler.duration) ? `${fmt(this.tonSpieler.duration)} s` : '—';
      felder.push(['Dauer (gemessen)', dauer]);
      if (eintrag.herkunft) {
        /*
          `origin` beginnt bei Ton mit „1.18 s, mono, 48 kHz, …" und geht
          dann in die Werkzeugkette über. Getrennt wird deshalb am KOMMA
          und nicht am Punkt — der Punkt ist hier das Dezimalzeichen, und
          eine Trennung dort machte aus 1,18 s ein „1".
        */
        felder.push(['Manifest', eintrag.herkunft.split(',').slice(0, 3).join(',').trim()]);
      }
    }
    felder.push(['Lizenz', eintrag.lizenzstatus]);
    if (eintrag.prefabName) felder.push(['Prefab-Id', eintrag.prefabName]);

    const gitter = el('div', stil({ display: 'flex', gap: '26px', 'flex-wrap': 'wrap' }));
    for (const [k, v] of felder) {
      const spalte = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '3px' }));
      spalte.append(
        el('span', beschriftungStil(), k),
        el(
          'span',
          stil({ 'font-family': SCHRIFT.mono, 'font-size': '12px', color: F.textRuhig, 'max-width': '460px' }),
          v
        )
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
    /*
      Im Speicher-Bereich ist der Schlüssel der PFAD und nicht der
      Modellname — dieselbe Frage, andere Adresse. Beides über einen
      Kamm zu scheren (`PREFABS_BY_NAME`) meldete für jeden
      Speicher-Eintrag „fehlt", denn die Registry kennt keinen davon.
    */
    if (this.speicherArt) {
      await this.pruefeSpeicherSeite(namen);
      return;
    }
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
          /*
            Die URL kommt aus `modelUrl()` und nicht als feste
            Zeichenkette: Seit E4 kann in `PREFABS_BY_NAME` auch ein zur
            Laufzeit registrierter Saal stehen, und dessen GLB liegt unter
            `assets/generiert/`. Fest verdrahtet meldete diese Prüfung ihn
            als „fehlt" — eine falsche Auskunft, die niemandem auffiele:
            Das Modell IST da, nur an einem anderen Pfad, und der Katalog
            sagte trotzdem, es gebe es nicht.
          */
          const antwort = await fetch(modelUrl(datei), { method: 'HEAD' });
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

  /**
   * Dasselbe für den Speicher — HEAD auf `/assets/store/<pfad>`.
   *
   * Auch hier nur die SICHTBARE Seite: 672 Anfragen auf einen Schlag
   * wären dieselbe kleine Denial-of-Service-Attacke wie bei der
   * Registry, nur mit einem Bestand, von dem fast alles daliegt.
   */
  private async pruefeSpeicherSeite(ids: readonly string[]): Promise<void> {
    const offen = ids
      .map((id) => this.storeIndex.get(id)?.pfad)
      .filter((p): p is string => !!p && !this.vorhanden.has(p));
    if (offen.length === 0) {
      this.statusSetzen('Seite bereits geprüft.', 'neutral');
      window.setTimeout(() => this.statusSetzen('', 'neutral'), 2000);
      return;
    }
    this.pruefKnopf.disabled = true;
    this.pruefKnopf.textContent = `prüfe ${offen.length} Dateien …`;
    let naechster = 0;
    const arbeiter = async (): Promise<void> => {
      while (naechster < offen.length) {
        const pfad = offen[naechster++]!;
        try {
          const antwort = await fetch(`${SPEICHER_WURZEL}${pfad}`, { method: 'HEAD' });
          const typ = antwort.headers.get('content-type') ?? '';
          this.vorhanden.set(pfad, antwort.ok && !typ.includes('text/html'));
        } catch {
          /* Netzfehler: unbekannt lassen (s. Kopf der Registry-Prüfung) */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PRUEF_PARALLEL, offen.length) }, arbeiter));
    this.pruefKnopf.textContent = 'Verfügbarkeit dieser Seite prüfen';
    this.pruefKnopf.disabled = false;
    this.listeFuellen();
    const da = ids.filter((id) => {
      const p = this.storeIndex.get(id)?.pfad;
      return p ? this.vorhanden.get(p) === true : false;
    }).length;
    this.statusSetzen(`${da} von ${ids.length} Dateien dieser Seite liegen vor.`, da > 0 ? 'da' : 'fehlt');
  }
}

/**
 * Dateigröße in der Einheit, in der man sie im Kopf hat.
 *
 * Bytes ausgeschrieben (`20560`) beantworten die Frage nicht, die man
 * stellt („ist das gross?"). Gerundet wird bewusst grob — auf ein
 * Kilobyte kommt es beim Durchsehen eines Speichers nie an.
 */
function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0).replace('.', ',')} kB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Kurze Zahl fürs Auge: 12,4 statt 12.412345678. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const stellen = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(stellen).replace('.', ',');
}
