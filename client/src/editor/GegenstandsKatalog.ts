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
import { THEME } from './Shell';

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

export class GegenstandsKatalog {
  private readonly root: HTMLDivElement;
  private readonly leinwand: HTMLCanvasElement;
  private readonly liste: HTMLDivElement;
  private readonly blaetterZeile: HTMLDivElement;
  private readonly katHinweis: HTMLDivElement;
  private readonly infoBlock: HTMLDivElement;
  private readonly statusZeile: HTMLDivElement;
  private readonly pruefKnopf: HTMLButtonElement;

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
  /** Der Haken dazu — er zeigt auch, wenn das Ziehen ihn abgeschaltet hat. */
  private drehEingabe: HTMLInputElement | null = null;
  /**
   * Material des Platzhalter-Gitters. Einmal angelegt und wiederverwendet:
   * `dispose(false, false)` beim Wechsel lässt Materialien absichtlich
   * stehen (sie gehören sonst dem Asset-Cache) — ein frisches Material je
   * fehlendem Modell würde sich beim Durchblättern der vollen Registry
   * stillschweigend anhäufen.
   */
  private platzhalterMaterial: StandardMaterial | null = null;

  constructor(eltern: HTMLElement) {
    this.root = document.createElement('div');
    // Deckt den Viewport vollständig ab: Der Katalog ist eine ANSICHT,
    // kein Werkzeugfenster — man sucht darin, statt nebenbei die Karte zu
    // bearbeiten. Über der Karte liegend spart er den Umbau der Shell.
    this.root.style.cssText =
      `position:absolute;inset:0;z-index:20;display:none;flex-direction:column;` +
      `background:${THEME.hintergrund};font-family:Georgia,serif;color:${THEME.text};font-size:13px;`;

    // ── Kopfzeile: Titel, Kategorie, Suche, Schließen ────────────────
    const kopf = document.createElement('div');
    kopf.style.cssText =
      `display:flex;align-items:center;gap:10px;padding:6px 10px;background:${THEME.flaeche};` +
      `border-bottom:1px solid ${THEME.rand};flex:0 0 auto;`;
    const titel = document.createElement('div');
    titel.textContent = '📦 Gegenstands-Katalog';
    titel.style.cssText = `color:${THEME.akzent};font-size:15px;white-space:nowrap;`;
    kopf.appendChild(titel);

    const katWahl = document.createElement('select');
    katWahl.style.cssText = this.feldStil('auto');
    KATEGORIEN.forEach((k, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = k.name;
      katWahl.appendChild(o);
    });
    katWahl.onchange = () => {
      this.kategorie = Number(katWahl.value);
      this.seite = 0;
      this.listeFuellen();
    };
    kopf.appendChild(katWahl);

    const suche = document.createElement('input');
    suche.placeholder = 'Suchen … (z. B. eiche, grab, wood_roof)';
    suche.style.cssText = this.feldStil('260px');
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
    kopf.appendChild(suche);

    const abstand = document.createElement('div');
    abstand.style.cssText = 'flex:1;';
    kopf.appendChild(abstand);

    const drehKasten = document.createElement('label');
    drehKasten.style.cssText = `display:flex;align-items:center;gap:4px;color:${THEME.gedimmt};font-size:11px;`;
    const dreh = document.createElement('input');
    dreh.type = 'checkbox';
    dreh.checked = this.drehen;
    dreh.onchange = () => (this.drehen = dreh.checked);
    drehKasten.append(dreh, document.createTextNode('Drehteller'));
    kopf.appendChild(drehKasten);
    // Merken, weil der Haken zugleich ANZEIGE ist: Wer selbst am Modell
    // zieht, will nicht, dass es ihm unter der Hand weiterdreht — das
    // Ziehen schaltet den Drehteller ab, und das muss man sehen.
    this.drehEingabe = dreh;

    kopf.appendChild(this.knopf('⟳ Ansicht zurück', () => this.kameraRahmen()));
    kopf.appendChild(this.knopf('✕ Schließen', () => this.schliesse()));
    this.root.appendChild(kopf);

    // ── Hauptteil: Liste links, Vorschau rechts ──────────────────────
    const reihe = document.createElement('div');
    reihe.style.cssText = 'display:flex;flex:1;min-height:0;';
    this.root.appendChild(reihe);

    const linkeSpalte = document.createElement('div');
    linkeSpalte.style.cssText =
      `width:280px;min-width:280px;display:flex;flex-direction:column;background:${THEME.flaeche};` +
      `border-right:1px solid ${THEME.rand};`;
    reihe.appendChild(linkeSpalte);

    this.katHinweis = document.createElement('div');
    this.katHinweis.style.cssText = `padding:4px 8px;font-size:11px;color:${THEME.gedimmt};line-height:1.35;`;
    linkeSpalte.appendChild(this.katHinweis);

    this.liste = document.createElement('div');
    this.liste.style.cssText = 'flex:1;overflow-y:auto;overscroll-behavior:contain;min-height:0;';
    linkeSpalte.appendChild(this.liste);

    this.blaetterZeile = document.createElement('div');
    this.blaetterZeile.style.cssText =
      `display:flex;align-items:center;gap:4px;padding:4px 6px;border-top:1px solid ${THEME.rand};` +
      `font-size:11px;color:${THEME.gedimmt};`;
    linkeSpalte.appendChild(this.blaetterZeile);

    this.pruefKnopf = this.knopf('⟳ Verfügbarkeit dieser Seite prüfen', () => {
      void this.pruefeSeite();
    });
    this.pruefKnopf.style.margin = '0 6px 6px';
    this.pruefKnopf.title =
      'Fragt für die sichtbaren Einträge per HEAD ab, ob die GLB auf diesem Server liegt.';
    linkeSpalte.appendChild(this.pruefKnopf);

    const rechteSpalte = document.createElement('div');
    rechteSpalte.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';
    reihe.appendChild(rechteSpalte);

    const buehne = document.createElement('div');
    buehne.style.cssText = 'flex:1;position:relative;min-height:0;';
    rechteSpalte.appendChild(buehne);

    this.leinwand = document.createElement('canvas');
    this.leinwand.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;';
    buehne.appendChild(this.leinwand);

    this.statusZeile = document.createElement('div');
    this.statusZeile.style.cssText =
      `position:absolute;left:10px;top:8px;font-size:12px;color:${THEME.gedimmt};` +
      'background:rgba(11,14,20,0.72);padding:2px 8px;border-radius:4px;pointer-events:none;';
    buehne.appendChild(this.statusZeile);

    this.infoBlock = document.createElement('div');
    this.infoBlock.style.cssText =
      `flex:0 0 auto;border-top:1px solid ${THEME.rand};background:${THEME.flaeche};padding:6px 10px;` +
      'font-size:12px;line-height:1.5;min-height:56px;';
    this.infoBlock.textContent =
      'Links einen Eintrag anklicken. Ziehen dreht, Rad zoomt, ↑/↓ blättert durch die Auswahl. ' +
      'Das Bodenraster gibt den Maßstab (Maschenweite steht bei den Angaben).';
    this.infoBlock.style.color = THEME.gedimmt;
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
    this.root.style.display = 'flex';
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
    const engine = new Engine(this.leinwand, true, { stencil: false }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.043, 0.055, 0.078, 1);
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
   */
  private rasterBauen(): void {
    const linien: Vector3[][] = [];
    for (let i = -10; i <= 10; i++) {
      linien.push([new Vector3(i, 0, -10), new Vector3(i, 0, 10)]);
      linien.push([new Vector3(-10, 0, i), new Vector3(10, 0, i)]);
    }
    const netz = MeshBuilder.CreateLineSystem('katalograster', { lines: linien }, this.scene!);
    netz.color = new Color3(0.23, 0.2, 0.15);
    netz.isPickable = false;
    this.raster = netz;
  }

  private readonly frame = (): void => {
    if (this.drehen && this.kamera) this.kamera.alpha += 0.0035;
    this.scene?.render();
  };

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
    // lesbar und die Zahl im Infoblock bleibt eine, die man im Kopf hat.
    const roh = spanne / 8;
    const zehner = Math.pow(10, Math.floor(Math.log10(Math.max(roh, 1e-3))));
    const rest = roh / zehner;
    const schritt = zehner * (rest >= 5 ? 5 : rest >= 2 ? 2 : 1);
    this.rasterSchritt = schritt;
    this.raster?.scaling.setAll(schritt);
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
      if (this.drehen) {
        this.drehen = false;
        if (this.drehEingabe) this.drehEingabe.checked = false;
      }
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

    // Zweite Zeile unter dem Kategorietext: wie viel dieser Liste den
    // Umbau überlebt. Ohne sie liest man 25 Gegenstände und merkt erst
    // beim dritten Klick, dass KEINER davon noch ein Modell hat.
    const eigen = alle.filter((n) => istEigenesModell(n)).length;
    this.katHinweis.innerHTML = '';
    const katText = document.createElement('div');
    katText.textContent = kat.hinweis;
    this.katHinweis.appendChild(katText);
    if (alle.length > 0) {
      const quote = document.createElement('div');
      quote.textContent = `${eigen} von ${alle.length} mit eigenem Modell — der Rest (⊘) entfällt mit Block A.`;
      quote.style.color = eigen === 0 ? THEME.fehler : THEME.gedimmt;
      this.katHinweis.appendChild(quote);
    }
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
      const leer = document.createElement('div');
      leer.textContent = 'keine Treffer';
      leer.style.cssText = `padding:6px 8px;color:${THEME.gedimmt};font-style:italic;`;
      this.liste.appendChild(leer);
    }

    this.blaetterZeile.innerHTML = '';
    const zurueck = this.knopf('‹', () => {
      this.seite = Math.max(0, this.seite - 1);
      this.listeFuellen();
    });
    const weiter = this.knopf('›', () => {
      this.seite = Math.min(seiten - 1, this.seite + 1);
      this.listeFuellen();
    });
    zurueck.disabled = this.seite === 0;
    weiter.disabled = this.seite >= seiten - 1;
    for (const b of [zurueck, weiter]) {
      b.style.flex = '0 0 auto';
      b.style.padding = '2px 8px';
      b.style.opacity = b.disabled ? '0.4' : '1';
    }
    const text = document.createElement('span');
    text.style.cssText = 'flex:1;text-align:center;';
    text.textContent = `Seite ${this.seite + 1}/${seiten} — ${alle.length} Einträge`;
    this.blaetterZeile.append(zurueck, text, weiter);
    this.pruefKnopf.disabled = sichtbar.length === 0;
  }

  /** Eine Listenzeile: Name, Eigen-Marke, Verfügbarkeitszeichen. */
  private zeileBauen(name: string): HTMLDivElement {
    const zeile = document.createElement('div');
    const aktiv = name === this.gewaehlt;
    zeile.style.cssText =
      `padding:3px 8px;cursor:pointer;display:flex;gap:6px;align-items:baseline;` +
      (aktiv ? `background:#243044;color:${THEME.akzent};` : '');
    const eigen = istEigenesModell(name);
    const marke = document.createElement('span');
    // ★ = eigenes Modell, ⊘ = entfällt. Der Punkt, der hier für „nicht
    // eigen" stand, war zu leise — er hiess „kein Stern", nicht „gehört
    // nicht mehr ins Spiel".
    // Bewusst NICHT ✕: Das steht in derselben Zeile schon für „GLB liegt
    // nicht auf dem Server" (Verfügbarkeitsprüfung). Zwei verschiedene
    // Fragen mit einem Zeichen zu beantworten verwischt beide — ein
    // eigenes Modell kann fehlen, ein fremdes kann daliegen.
    marke.textContent = eigen ? '★' : '⊘';
    marke.style.cssText = `width:10px;color:${eigen ? THEME.akzent : THEME.fehler};`;
    const txt = document.createElement('span');
    txt.textContent = name;
    txt.style.cssText =
      'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      (eigen || aktiv ? '' : `color:${THEME.gedimmt};`);
    if (!eigen) {
      zeile.title =
        `${name} steht nicht in EIGENE_MODELLE (shared/src/prefabs.ts). Ansehen geht, ` +
        'setzen nicht — der Spawn-Editor bietet den Namen nicht mehr zur Platzierung an.';
    }
    zeile.append(marke, txt);
    // Gemerkt wird die DATEI, nicht der Prefabname: Manche Prefabs zeigen
    // auf eine anders heißende GLB (Boar → Boar_fixed, s. HINT_DEFS).
    const datei = PREFABS_BY_NAME.get(name)?.model;
    const da = datei ? this.vorhanden.get(datei) : undefined;
    if (da !== undefined) {
      const zeichen = document.createElement('span');
      zeichen.textContent = da ? '✓' : '✕';
      zeichen.title = da
        ? 'Modell liegt vor und ist anzeigbar'
        : 'Kein anzeigbares Modell (GLB fehlt oder ohne Geometrie)';
      zeichen.style.cssText = `font-size:11px;color:${da ? THEME.ok : THEME.fehler};`;
      zeile.appendChild(zeichen);
    }
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
      this.statusZeile.textContent = '';
      return;
    }

    this.statusZeile.textContent = `lädt ${def.model}.glb …`;

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

    this.statusZeile.textContent = '';
    if (ergebnis === 'timeout') {
      // Bewusst KEIN Eintrag in `vorhanden`: Eine Zeitüberschreitung sagt
      // nichts darüber, ob die Datei existiert — sie kam nur nicht an.
      this.platzhalterZeigen(def);
      this.infoSchreiben(name, def, null, `Zeitüberschreitung nach ${LADE_TIMEOUT / 1000} s — Server antwortet nicht.`);
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
    this.listeFuellen();
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
      mat.emissiveColor = new Color3(0.78, 0.66, 0.34);
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

  private infoSchreiben(
    name: string,
    def: PrefabDef | null,
    masse: Kennzahlen | null,
    warnung: string | null
  ): void {
    this.infoBlock.innerHTML = '';
    this.infoBlock.style.color = THEME.text; // der Einstiegshinweis war gedimmt

    const kopf = document.createElement('div');
    kopf.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const item = ITEMS_NACH_NAME.get(name);
    // Icon, wo es eines gibt: Für Gegenstände ist das Inventarbild oft
    // aussagekräftiger als das Modell (viele Item-GLBs sind winzig).
    const iconDatei = item?.icon ?? def?.sprite ?? null;
    if (iconDatei) {
      const bild = document.createElement('img');
      bild.src = `/assets/sprites/${iconDatei}.png`;
      bild.style.cssText = `width:32px;height:32px;object-fit:contain;border:1px solid ${THEME.rand};border-radius:3px;background:#0d1420;`;
      // Die Sprite-Sammlung ist unvollständig; ein kaputtes Bild-Symbol
      // wäre irreführender als gar keines.
      bild.onerror = () => bild.remove();
      kopf.appendChild(bild);
    }
    const titel = document.createElement('span');
    titel.textContent = item?.label ? `${item.label} (${name})` : name;
    titel.style.cssText = `color:${THEME.akzent};font-size:15px;`;
    kopf.appendChild(titel);
    // Die Marke spricht jetzt in BEIDE Richtungen. Vorher stand bei
    // fremden Prefabs gar nichts — und „nichts" liest sich wie „normal",
    // nicht wie „das gibt es im Spiel nicht mehr".
    const eigen = istEigenesModell(name);
    const marke = document.createElement('span');
    marke.textContent = eigen ? '★ eigenes Modell' : '⊘ kein eigenes Modell — entfällt';
    marke.style.cssText =
      `font-size:11px;color:${eigen ? THEME.ok : THEME.fehler};border:1px solid ${THEME.rand};` +
      'padding:1px 6px;border-radius:8px;';
    kopf.appendChild(marke);
    this.infoBlock.appendChild(kopf);

    const felder: string[] = [];
    felder.push(`Modell: ${def?.model ? `${def.model}.glb` : '—'}`);
    if (masse) {
      felder.push(
        `Maße (B×H×T): ${fmt(masse.breite)} × ${fmt(masse.hoehe)} × ${fmt(masse.tiefe)} m`,
        `Dreiecke: ${masse.dreiecke.toLocaleString('de-DE')}`,
        `Meshes: ${masse.meshes}`,
        `Materialien: ${masse.materialien}`
      );
    }
    if (def) {
      const ls = def.localScale;
      if (ls.x !== 1 || ls.y !== 1 || ls.z !== 1) {
        felder.push(`localScale: ${fmt(ls.x)} / ${fmt(ls.y)} / ${fmt(ls.z)}`);
      }
      felder.push(`Platzhaltermaß: ${fmt(def.renderScale.w)} × ${fmt(def.renderScale.h)} m`);
      if (def.animation) felder.push(`Animation: ${def.animation}`);
      if (def.light) felder.push(`Lichtquelle: Reichweite ${def.light.range} m`);
    }
    if (item) {
      felder.push(
        `Typ: ${ITEM_TYP_TEXT[item.itemType] ?? item.itemType}`,
        `Gewicht: ${fmt(item.weight)}`,
        `Stapel: ${item.maxStackSize}`
      );
      if (item.pieceTable) felder.push(`Bau-Tafel: ${item.pieceTable}`);
    }
    felder.push(`Raster: ${fmt(this.rasterSchritt)} m`);

    const gitter = document.createElement('div');
    gitter.style.cssText =
      `display:flex;flex-wrap:wrap;gap:2px 18px;margin-top:3px;color:${THEME.text};font-size:12px;`;
    for (const f of felder) {
      const s = document.createElement('span');
      s.textContent = f;
      gitter.appendChild(s);
    }
    this.infoBlock.appendChild(gitter);

    if (warnung) {
      const w = document.createElement('div');
      w.textContent = `⚠ ${warnung}`;
      w.style.cssText = `margin-top:3px;color:${THEME.fehler};font-size:12px;`;
      this.infoBlock.appendChild(w);
    }
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
      this.statusZeile.textContent = 'Seite bereits geprüft.';
      window.setTimeout(() => (this.statusZeile.textContent = ''), 2000);
      return;
    }
    this.pruefKnopf.disabled = true;
    this.pruefKnopf.textContent = `⟳ prüfe ${offen.length} Modelle …`;
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
    this.pruefKnopf.textContent = '⟳ Verfügbarkeit dieser Seite prüfen';
    this.pruefKnopf.disabled = false;
    this.listeFuellen();
    const da = namen.filter((n) => {
      const m = PREFABS_BY_NAME.get(n)?.model;
      return m ? this.vorhanden.get(m) === true : false;
    }).length;
    this.statusZeile.textContent = `${da} von ${namen.length} Modellen dieser Seite liegen vor.`;
  }

  // ── Kleinkram ──────────────────────────────────────────────────────

  private feldStil(breite: string): string {
    return (
      `width:${breite};background:${THEME.feld};color:${THEME.text};border:1px solid ${THEME.rand};` +
      'padding:3px 6px;font-family:inherit;font-size:12px;box-sizing:border-box;'
    );
  }

  private knopf(text: string, cb: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      `padding:4px 10px;background:#1d2431;color:${THEME.text};border:1px solid ${THEME.rand};` +
      'border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;white-space:nowrap;';
    b.onclick = () => {
      cb();
      // Fokus abgeben: Ein fokussierter Knopf feuert sonst später auf
      // Enter/Leertaste erneut (dieselbe Falle wie im SpawnPanel).
      b.blur();
    };
    return b;
  }
}

/** Kurze Zahl fürs Auge: 12,4 statt 12.412345678. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const stellen = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return v.toFixed(stellen).replace('.', ',');
}
