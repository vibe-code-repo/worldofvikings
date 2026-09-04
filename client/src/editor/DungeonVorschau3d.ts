/**
 * 3D-Ansicht des 1.0-Dungeon-Dokuments im Karteneditor — die zweite Sicht
 * auf DENSELBEN Zustand, den `DungeonGrundriss.ts` von oben zeichnet.
 *
 * ── Warum eine zweite Ansicht und kein zweiter Editor ────────────────
 * Gebaut, angefügt und entfernt wird weiterhin ausschliesslich über den
 * Grundriss und die Seitenleiste (`DungeonKatalog.ts`) — diese Datei
 * BESITZT kein Dokument. Sie bekommt eines gezeigt, meldet Klicks als
 * Indizes zurück (`raumAngeklickt`, `connectorAngeklickt`) und baut nach
 * jeder Änderung neu. Ein zweiter Bauweg wäre genau die Sorte Duplikat,
 * die erst im Spiel auffällt: Zwei Ansichten, die sich verschieden
 * verrechnen, sehen beide plausibel aus.
 *
 * ── Warum sie aussieht wie das Spiel ─────────────────────────────────
 * Die Module kommen über DIESELBE Kette wie im Spiel: `AssetManager.
 * getMasters(prefabName)` lädt die GLB, verschmilzt je Material, trennt
 * `_col`-Netze als unsichtbare Kollisionsmaster ab — und bäckt vor allem
 * die GLB-Hierarchie samt Babylons `__root__` (x-Spiegelung der
 * glTF-Konvertierung) in `PrefabMaster.localMatrix` ein. Ein selbst
 * geladenes GLB oder eine selbst gebaute Matrix hätte hier zwei
 * Möglichkeiten, und beide sähen im Bild „irgendwie richtig" aus:
 * gespiegelt oder versetzt.
 *
 * Die Instanzmatrix ist deshalb WÖRTLICH die des Spiels
 * (`EntityManager.baueVollMaster`, dort Zeile `local.multiply(zdoMats[i])`,
 * mit `composeZdoWorld` = `Matrix.Compose(scale, rot, pos)`):
 *
 *     welt = master.localMatrix × Matrix.Compose(1, raum.rot, raum.pos)
 *
 * Skalierung ist 1: Ein `PlacedRoom` trägt keine, und die Modul-Prefabs
 * haben keine abweichende `localScale` (im Spiel käme sie aus dem ZDO
 * bzw. dem Prefab-Eintrag, hier gibt es beides nicht).
 *
 * ── Was NICHT mitkommt ───────────────────────────────────────────────
 * Die Raum-EINRICHTUNG (`netViews` aus `roomPieces.ts`, ~5 MB). Die
 * Abflachung läuft über `flattenRooms` (`@wov/shared`, additiv neben
 * `flattenLayout`) — dieselben Positionen, ohne das Bündel. Begründung im
 * Kopf jener Funktion.
 *
 * ── Aufbau nach `dungeon2/Dungeon2Vorschau.ts` ───────────────────────
 * Eigene Canvas im Viewport (display-Umschaltung, z-index über dem
 * Grundriss), Engine/Szene erst bei der ersten Sichtbarkeit, Render-
 * Schleife nur solange sichtbar, Entprellung und Sichtbarkeits-Zustand
 * über die dort schon ohne WebGL geprüfte `VorschauSteuerung`. Nur der
 * Inhalt ist ein anderer: Prefab-Instanzen statt Zellgeometrie.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
// Nebenwirkungs-Import (wie `ui/WorldMap.ts`): Erst dieses Modul hängt das
// ECHTE `Scene.prototype.pick` ein. Ohne es bleibt Babylons Baumschnitt-
// Attrappe aus `scene.js` stehen — die wirft nicht, sondern liefert ein
// leeres `PickingInfo` (`hit === false`) und schreibt nur eine Warnung. Ein
// Klick träfe also stumm nie etwas, und kein Test ohne Browser sähe es.
import '@babylonjs/core/Culling/ray';

import {
  DUNGEONS_BY_NAME,
  ambientLichtVon,
  anbaubareKanten,
  ebenenMasse,
  flattenRooms,
  getKitByPrefabHash,
  getRoomByHash,
  type AnbaubareKante,
  type DungeonDocument,
  type SteinKitConfig,
} from '@wov/shared';
import { AssetManager, type PrefabMaster } from '../engine/AssetManager';
import { erzeugeSteinKitMaterial, mergeSteinKit } from '../engine/DungeonSteinMaterial';
import { installiereFackelLicht } from '../engine/FackelLicht';
import { ebeneVon, rasterVonBasis, zeichenHuelle } from './DungeonGrundriss';
import { VorschauSteuerung, type VorschauTreiber, type Zeitgeber } from './dungeon2/vorschauSteuerung';

/** Grundhelligkeit des Hemisphärenlichts (wie in `Dungeon2Vorschau.ts`). */
const GRUNDHELLIGKEIT = 0.55;

/** Radius der Kantenmarken in Metern — dieselbe Grössenordnung wie in 2D. */
const MARKE_RADIUS_M = 0.35;

/**
 * Wie weit UNTER der Deckenunterkante geschnitten wird, wenn die Decke aus
 * ist.
 *
 * Nicht exakt auf die Unterkante: Boden- und Deckenplatte sind 0,25 m dick
 * und die Wände stecken absichtlich in ihnen (`make-stonevault.py`, −0,25 …
 * 3,75). Ein Schnitt genau auf 3,5 liesse die Wandköpfe als Zahnkranz
 * stehen und träfe ausserdem die deckungsgleiche Fläche selbst — 10 cm
 * darunter schneidet sauber durch die Wand.
 */
const DECKEN_LUFT_M = 0.1;

/**
 * Toleranz beim Vergleich einer Ebene mit einer Höhe.
 *
 * Dieselbe Grössenordnung wie `ebeneVon` (0,1 m Raster) rundet: Positionen
 * kommen aus Quaternion-Rechnungen, und ein `===` auf 3,5 wäre eine Wette
 * auf das letzte Bit.
 */
const EBENEN_TOLERANZ_M = 0.05;

export interface DungeonVorschau3dRueckrufe {
  /** Statuszeile der Shell. */
  meldung?(text: string, fehler?: boolean): void;
  /**
   * Eine Kantenmarke wurde angeklickt — `idx` zählt in `anbaubareKanten`,
   * also in DERSELBEN Liste wie `GrundrissRueckrufe.connectorAngeklickt`
   * und wie der erste Parameter von `DungeonGrundriss.fuegeAn`.
   */
  connectorAngeklickt?(idx: number): void;
  /**
   * Ein Raum wurde angeklickt — `roomIndex` zählt in `layout.rooms`, also
   * genau die Zahl, die `DungeonGrundriss.waehle(index)` erwartet.
   */
  raumAngeklickt?(roomIndex: number): void;
}

/** Ein Satz Master samt eigenem Material — Schlüssel s. `masterSchluessel`. */
interface MasterGruppe {
  meshes: Mesh[];
  locals: Matrix[];
}

/**
 * Ein gebautes Netz mit der HÖHENSPANNE, die es einnimmt — das Futter des
 * Ebenenfilters.
 *
 * `hoehe = 0` heisst „punktuell": Marken, Türen und Deko gehören genau der
 * Ebene, auf der sie stehen. Ein Raum dagegen spannt von `von` bis
 * `von + hoehe`, und genau daran hängt der einzige interessante Fall —
 * `StoneVaultStairs` ist 7 m hoch und gehört damit BEIDEN angrenzenden
 * Ebenen. Ein Filter nach `ebeneVon(pos.y)` allein liesse die Treppe von
 * der oberen Ebene verschwinden, also von der, auf der man weiterbaut.
 */
interface EbenenTeil {
  mesh: AbstractMesh;
  von: number;
  hoehe: number;
}

export class DungeonVorschau3d {
  private readonly canvas: HTMLCanvasElement;

  // Babylon-Seite — erst bei der ersten Sichtbarkeit angelegt (lazy), damit
  // ein nie geöffneter Reiter keinen WebGL-Kontext hält.
  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private kamera: ArcRotateCamera | null = null;
  private licht: HemisphericLight | null = null;
  private assets: AssetManager | null = null;
  /**
   * Ob Engine UND Szene uns gehören.
   *
   * Der Test reicht einen vorbereiteten `AssetManager` herein (derselbe
   * Haken wie in `client/test/kollisionsnetz.ts`); dessen Szene ist die des
   * Tests, und die dürfen wir weder anlegen noch abräumen — sonst zöge
   * `dispose()` dem Test die Szene unter den Füssen weg. Ausserdem läuft
   * dann KEINE Render-Schleife: Eine NullEngine-Schleife hielte den
   * Node-Prozess am Leben.
   */
  private eigeneSzene = true;
  private readonly fremdeAssets: AssetManager | null;

  private doc: DungeonDocument | null = null;
  private gewaehlt = -1;
  /** Kanten des zuletzt gebauten Standes — Index = `metadata.kanteIndex`. */
  private kanten: AnbaubareKante[] = [];

  /** Master je (Prefab × Steinmaterial) — sie überleben jeden Neubau. */
  private readonly gruppen = new Map<string, MasterGruppe>();
  /** Ein Steinmaterial je Konfiguration (wie `EntityManager.holeSteinMaterial`). */
  private readonly steinMaterialien = new Map<string, Material>();
  /** Alles, was der letzte Bau in die Szene gestellt hat. */
  private gebaut: AbstractMesh[] = [];
  /** Dasselbe, nur mit Höhenspanne — s. `EbenenTeil`. */
  private ebenenBuch: EbenenTeil[] = [];
  /** Nur Räume dieser Ebene zeigen; `null` = alle. Quelle: der Grundriss. */
  private ebene: number | null = null;
  /** Decke zeigen? Vorgabe AUS — im Editor blickt man von oben hinein. */
  private decke = false;
  /** Zählt Bauten, damit ein spät zurückkehrender Ladevorgang nichts nachträgt. */
  private bauGeneration = 0;

  private markeOffen: StandardMaterial | null = null;
  private markeWand: StandardMaterial | null = null;
  private auswahlMaterial: StandardMaterial | null = null;

  private readonly steuerung: VorschauSteuerung;
  private readonly aufResize: () => void;
  private readonly frame: () => void;
  private readonly aufKlick: (e: MouseEvent) => void;
  private readonly aufDoppelklick: (e: MouseEvent) => void;

  constructor(
    viewport: HTMLElement,
    private readonly cb: DungeonVorschau3dRueckrufe = {},
    assets?: AssetManager
  ) {
    this.fremdeAssets = assets ?? null;

    const c = document.createElement('canvas');
    // Koexistenz über display wie beim Grundriss; z-index darüber (dort 2),
    // damit die aktive Ansicht oben liegt und die Klicks bekommt.
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;outline:none;z-index:4';
    c.tabIndex = 0; // damit die Kamera Tastatur/Rad bekommt
    viewport.appendChild(c);
    this.canvas = c;

    this.frame = (): void => {
      this.scene?.render();
    };
    this.aufResize = (): void => this.engine?.resize();
    window.addEventListener('resize', this.aufResize);

    this.aufKlick = (e: MouseEvent): void => this.klickBei(e.offsetX, e.offsetY);
    c.addEventListener('click', this.aufKlick);
    // Doppelklick = auswählen UND hinfahren. Die Auswahl macht schon der
    // einfache Klick davor (jeder Doppelklick sendet erst zwei `click`) —
    // hier bleibt nur die Kamera.
    this.aufDoppelklick = (e: MouseEvent): void => {
      this.klickBei(e.offsetX, e.offsetY);
      if (this.gewaehlt >= 0) this.fokussiere();
    };
    c.addEventListener('dblclick', this.aufDoppelklick);

    // Der Treiber verdrahtet die pure Steuerung (`dungeon2/vorschauSteuerung.ts`,
    // dort ohne WebGL geprüft) mit dieser Babylon-Hälfte. Sie ist auf
    // `DungeonLayout2` typisiert, REICHT ihr Argument aber nur durch — sie
    // liest es nie. Deshalb der Cast an genau diesen zwei Stellen, statt eine
    // zweite Zustandsmaschine daneben zu stellen, die dann ungeprüft wäre.
    const treiber: VorschauTreiber = {
      baueNeu: (doc) => this.baueNeuIntern(doc as unknown as DungeonDocument | null),
      starteSchleife: () => this.starteSchleifeIntern(),
      stoppeSchleife: () => this.stoppeSchleifeIntern(),
      abbauen: () => this.abbauenIntern(),
    };
    const zeitgeber: Zeitgeber = {
      setzen: (r, ms) => window.setTimeout(r, ms),
      loeschen: (h) => window.clearTimeout(h),
    };
    this.steuerung = new VorschauSteuerung(treiber, zeitgeber);
  }

  // ── Öffentliche API ────────────────────────────────────────────────────

  /**
   * Das Dokument übernehmen (oder `null` = leeren).
   *
   * Auch der Weg für „hat sich geändert": Der Aufrufer reicht dasselbe
   * Objekt erneut herein, nachdem der Grundriss angefügt oder entfernt hat.
   * Gebaut wird entprellt und nur, solange die Ansicht sichtbar ist.
   */
  setzeDokument(doc: DungeonDocument | null): void {
    this.doc = doc;
    if (this.gewaehlt >= (doc?.layout.rooms.length ?? 0)) this.gewaehlt = -1;
    this.steuerung.setzeLayout(doc as unknown as never);
  }

  /** Raum per Index auswählen — Gegenstück zu einem Klick in 3D. */
  waehle(index: number): void {
    const anzahl = this.doc?.layout.rooms.length ?? 0;
    this.gewaehlt = index >= 0 && index < anzahl ? index : -1;
    this.zeichneAuswahl();
    // Der Schnitt folgt der Auswahl, solange kein Ebenenfilter steht
    // (s. `schnittEbene`): Wer ein Modul im Obergeschoss anklickt, will
    // dort hineinsehen und nicht in den Eingangsraum.
    this.setzeSchnittebene();
  }

  get gewaehlterRaum(): number {
    return this.gewaehlt;
  }

  /**
   * Ebenenfilter — dieselbe Zahl, die `DungeonGrundriss.setzeEbene` bekommt.
   *
   * Die Vorschau HÄLT diesen Zustand nicht, sie bekommt ihn gereicht: Die
   * eine Quelle ist das Auswahlfeld der Seitenleiste, das auf den Grundriss
   * zeigt. Zwei Filter, die man einzeln stellen kann, wären genau die Sorte
   * Doppelzustand, bei der man in 2D die obere Ebene sieht und in 3D die
   * untere und beides für richtig hält.
   *
   * Ausgeblendet, NICHT abgebaut: Ein Ebenenwechsel darf keinen Neubau
   * kosten, sonst blinkt bei jedem Klick der ganze Dungeon.
   */
  setzeEbene(y: number | null): void {
    this.ebene = y;
    this.wendeEbeneAn();
  }

  get aktiveEbene(): number | null {
    return this.ebene;
  }

  /** Decke der Module zeigen (`false` = Blick von oben hinein). */
  setzeDecke(an: boolean): void {
    this.decke = an;
    this.setzeSchnittebene();
  }

  get deckeAn(): boolean {
    return this.decke;
  }

  zeige(an: boolean): void {
    this.steuerung.zeige(an);
  }

  get sichtbar(): boolean {
    return this.steuerung.istSichtbar;
  }

  dispose(): void {
    // Erst die Steuerung (stoppt Schleife, ruft `abbauen`), dann die
    // Zuhörer. Idempotent über die Steuerung.
    this.steuerung.dispose();
    window.removeEventListener('resize', this.aufResize);
    this.canvas.removeEventListener('click', this.aufKlick);
    this.canvas.removeEventListener('dblclick', this.aufDoppelklick);
  }

  // ── Babylon-Hälfte, von der Steuerung getrieben ────────────────────────

  private starteSchleifeIntern(): void {
    this.szeneSicherstellen();
    this.canvas.style.display = 'block';
    if (!this.eigeneSzene) return;
    this.engine?.resize();
    // Rendern erst jetzt: eine Vorschau, die unsichtbar rechnet, stiehlt
    // dem Karten-Worker die CPU (s. `Dungeon2Vorschau.starteSchleifeIntern`).
    this.engine?.runRenderLoop(this.frame);
  }

  private stoppeSchleifeIntern(): void {
    this.canvas.style.display = 'none';
    if (this.eigeneSzene) this.engine?.stopRenderLoop(this.frame);
  }

  /** Engine/Szene/Kamera/Licht einmal anlegen. Idempotent. */
  private szeneSicherstellen(): void {
    if (this.scene !== null) return;

    if (this.fremdeAssets !== null) {
      // Testhaken: Szene und Engine gehören dem Aufrufer (s. `eigeneSzene`).
      const fremd = (this.fremdeAssets as unknown as { scene: Scene }).scene;
      this.scene = fremd;
      this.engine = fremd.getEngine();
      this.assets = this.fremdeAssets;
      this.eigeneSzene = false;
    } else {
      const engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true }, true);
      const scene = new Scene(engine);
      scene.clearColor = new Color4(0.02, 0.02, 0.03, 1);
      this.engine = engine;
      this.scene = scene;
      this.assets = new AssetManager(scene);
    }
    const scene = this.scene;

    // Ein Innenraum hat kein Aussenlicht; der schwache Hemisphärenanteil
    // macht die Module ohne Fackeln überhaupt sichtbar.
    const licht = new HemisphericLight('vorschau3dLicht', new Vector3(0, 1, 0), scene);
    licht.diffuse = new Color3(0.8, 0.82, 0.9);
    licht.groundColor = new Color3(0.12, 0.11, 0.1);
    this.licht = licht;
    this.setzeGrundlicht();

    // ArcRotate statt fester Spielkamera: Im Editor umkreist man den
    // Dungeon, um ihn zu inspizieren.
    const kamera = new ArcRotateCamera(
      'vorschau3dKamera',
      -Math.PI / 2 + 0.6,
      1.05,
      24,
      Vector3.Zero(),
      scene
    );
    kamera.lowerRadiusLimit = 2;
    kamera.upperRadiusLimit = 400;
    kamera.minZ = 0.1;
    kamera.maxZ = 800;
    kamera.wheelDeltaPercentage = 0.02;
    // Nur an einer echten Canvas: Der Testhaken reicht einen Stummel herein,
    // dem die Eingabe-Ereignisse fehlen.
    if (this.eigeneSzene) kamera.attachControl(this.canvas, true);
    this.kamera = kamera;

    // Fackellicht VOR dem ersten Bau installieren: Das Plugin hängt sich an
    // jedes künftige Material — später gäbe es eine sichtbare Neuübersetzung.
    if (this.eigeneSzene) installiereFackelLicht(scene);

    // Der Deckenschalter kann VOR der ersten Sichtbarkeit gestellt worden
    // sein (der Aufrufer zieht seinen Zustand beim Anlegen nach) — dann gäbe
    // es die Szene noch nicht, an die die Schnittebene gehört.
    this.setzeSchnittebene();
  }

  /**
   * Grundhelligkeit aus dem Dokument (`ambientLicht`, 0..3).
   *
   * Derselbe FAKTOR wie im Spiel: 1 heisst „unverändert", 0 ist ein
   * gültiger Wert (stockdunkel, das Grab lebt nur von seinen Fackeln) und
   * ausdrücklich etwas anderes als „fehlt" — deshalb `ambientLichtVon` und
   * kein `?? 1` an dieser Stelle.
   */
  private setzeGrundlicht(): void {
    if (this.licht === null) return;
    const faktor = this.doc ? ambientLichtVon(this.doc) : 1;
    this.licht.intensity = GRUNDHELLIGKEIT * faktor;
  }

  /**
   * Vollneubau: alles Gebaute verwerfen, aus dem Dokument neu stellen.
   *
   * ── Warum alles und nicht nur das Geänderte ──────────────────────────
   * Ein Dungeon-Dokument des Karteneditors hat Dutzende Module, keine
   * Tausende — der ganze Neubau kostet weniger als die Buchführung, die
   * ein Diff bräuchte, und ein Diff hätte genau einen Fehlermodus:
   * Instanzen, die stehen bleiben, obwohl ihr Raum weg ist. Die MASTER
   * bleiben dagegen (`this.gruppen`): Sie zu verwerfen hiesse, die GLBs
   * nach jedem Klick neu zu laden.
   */
  private baueNeuIntern(doc: DungeonDocument | null): void {
    if (this.scene === null) return;
    this.doc = doc;
    this.setzeGrundlicht();

    for (const m of this.gebaut) m.dispose();
    this.gebaut = [];
    this.ebenenBuch = [];
    this.kanten = doc ? anbaubareKanten(doc.layout, doc.base) : [];
    this.setzeSchnittebene();

    if (doc === null) {
      this.cb.meldung?.('Kein Dungeon geladen — links einen auswählen.');
      return;
    }

    const generation = ++this.bauGeneration;
    const flach = flattenRooms(doc.layout, doc.base);

    // Marken und Auswahl stehen SOFORT — sie brauchen kein GLB. Die Module
    // trudeln ein, sobald ihre Master geladen sind.
    this.baueMarken();
    this.zeichneAuswahl();

    const auftraege: Array<Promise<void>> = [];
    for (const raum of flach.rooms) {
      auftraege.push(
        this.stelleAuf(raum.prefabName, raum.pos, raum.rot, generation, {
          steinKit: this.steinKitFuer(doc, raum.prefabHash, raum.steinKit),
          metadata: { roomIndex: raum.roomIndex },
          // Die Höhe der Raumdefinition, nicht die der Zeichenhülle: Der
          // Ebenenfilter fragt, über welche Stockwerke ein Modul REICHT.
          spanne: { von: raum.pos.y, hoehe: getRoomByHash(raum.prefabHash)?.size.y ?? 0 },
        })
      );
    }
    // Türen und Deko: dieselbe Kette, nur ohne Rückweg zur Auswahl — man
    // baut sie nicht an, man bekommt sie mit dem Raum.
    for (const teil of [...flach.doors, ...flach.props]) {
      auftraege.push(
        this.stelleAuf(teil.prefabName, teil.pos, teil.rot, generation, {
          spanne: { von: teil.pos.y, hoehe: 0 },
        })
      );
    }

    void Promise.all(auftraege).then(() => {
      if (generation !== this.bauGeneration) return; // veraltet
      this.rahmeEin();
      // Erst jetzt: Vorher gibt es nichts zum Ausblenden — die Instanzen
      // trudeln mit ihren Mastern ein.
      this.wendeEbeneAn();
      this.cb.meldung?.(
        `${flach.rooms.length} Module · ${flach.doors.length} Türen · ` +
          `${this.kanten.length} anbaubare Kanten`
      );
    });
  }

  /**
   * Mischkette des Steinmaterials — WÖRTLICH die des Spiels
   * (`EntityManager.weiseSteinMaterialZu`): Kit-Vorgabe → Dokument →
   * `RoomDef` → PLATZIERTER Raum, unten gewinnt. Eine andere Reihenfolge
   * hiesse, dass ein Grab im Editor anders aussieht als in der Welt.
   *
   * `null` heisst „kein Steinkit" — Prefabs ausserhalb eines Kits (Türen,
   * Deko) behalten ihr gebackenes GLB-Material.
   */
  private steinKitFuer(
    doc: DungeonDocument,
    prefabHash: number,
    platzierung?: Partial<SteinKitConfig>
  ): SteinKitConfig | null {
    const kitCfg = getKitByPrefabHash(prefabHash)?.steinKit;
    if (!kitCfg) return null;
    return mergeSteinKit(
      mergeSteinKit(mergeSteinKit(kitCfg, doc.steinKit), getRoomByHash(prefabHash)?.steinKit),
      platzierung
    );
  }

  /**
   * Ein Prefab an Position/Drehung stellen — die Instanzen eines Teils.
   *
   * Die Matrix ist die des Spiels (s. Kopfkommentar): `localMatrix` des
   * Masters mal der Weltmatrix der Platzierung. Zerlegt wird sie danach
   * wieder, weil eine `InstancedMesh` ihre Lage über Position/Drehung/
   * Skalierung führt — dieselbe Zahlenkette, nur anders abgelegt.
   *
   * `InstancedMesh` statt Thin Instances, weil hier ANGEKLICKT wird: Ein
   * Thin-Instance-Treffer gibt nur einen Index im Puffer zurück, und der
   * Rückweg zum `roomIndex` wäre eine zweite Buchführung neben dem Puffer.
   * Ein paar Dutzend Module kosten diesen Luxus nicht.
   */
  private async stelleAuf(
    prefabName: string,
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number; w: number },
    generation: number,
    opt: {
      steinKit?: SteinKitConfig | null;
      metadata?: Record<string, unknown>;
      spanne?: { von: number; hoehe: number };
    }
  ): Promise<void> {
    const gruppe = await this.holeGruppe(prefabName, opt.steinKit ?? null);
    if (generation !== this.bauGeneration || this.scene === null) return;

    const welt = Matrix.Compose(
      Vector3.One(),
      new Quaternion(rot.x, rot.y, rot.z, rot.w),
      new Vector3(pos.x, pos.y, pos.z)
    );
    gruppe.meshes.forEach((master, i) => {
      const instanz = master.createInstance(`${prefabName}_${this.gebaut.length}_${i}`);
      const gesamt = gruppe.locals[i]!.multiply(welt);
      const skalierung = new Vector3();
      const drehung = new Quaternion();
      const versatz = new Vector3();
      gesamt.decompose(skalierung, drehung, versatz);
      instanz.scaling = skalierung;
      instanz.rotationQuaternion = drehung;
      instanz.position = versatz;
      // Ohne diese Zeile wäre der Raum unsichtbar für `scene.pick`: Der
      // Master ist `isPickable = false` (s. `AssetManager.getMasters`), und
      // eine frische Instanz erbt seinen Zustand.
      instanz.isPickable = opt.metadata !== undefined;
      if (opt.metadata) instanz.metadata = opt.metadata;
      this.gebaut.push(instanz);
      if (opt.spanne) {
        this.ebenenBuch.push({ mesh: instanz, von: opt.spanne.von, hoehe: opt.spanne.hoehe });
        // Sofort auf den geltenden Filter setzen: Eine Instanz, die spät
        // eintrudelt, stünde sonst bis zum nächsten Filterwechsel im Bild.
        instanz.setEnabled(this.passtAufEbene(opt.spanne.von, opt.spanne.hoehe));
      }
    });
  }

  /**
   * Master eines Prefabs, ggf. mit eigenem Steinmaterial.
   *
   * ── Warum eigene Master je Steinmaterial ─────────────────────────────
   * Das Material hängt am MASTER, nicht an der Instanz — zwei Kammern
   * desselben Prefabs mit verschiedenem Stein brauchen also zwei Master.
   * Genau diese Trennung führt der `EntityManager` über seine Buckets
   * (`bucketSchluessel(prefabHash, steinKit)`). Anders als dort darf es
   * hier ein `mesh.clone()` sein: Geteilte Geometrie ist nur bei THIN
   * Instances das Problem (der Matrixpuffer hängt an der Geometry) — eine
   * `InstancedMesh` trägt ihre Lage selbst.
   */
  private async holeGruppe(
    prefabName: string,
    steinKit: SteinKitConfig | null
  ): Promise<MasterGruppe> {
    const schluessel = steinKit ? `${prefabName}#${JSON.stringify(steinKit)}` : prefabName;
    const da = this.gruppen.get(schluessel);
    if (da) return da;

    const roh: PrefabMaster[] = (await this.assets?.getMasters(prefabName)) ?? [];
    // Kollisionsnetze (`_col`) laufen an ALLEM vorbei, was fürs Bild
    // gemacht ist — `getMasters` markiert sie, hier fallen sie heraus.
    const sichtbar = roh.filter((m) => !m.nurKollision);
    const schon = this.gruppen.get(schluessel);
    if (schon) return schon; // zwei Aufträge auf dasselbe Prefab gleichzeitig

    const material = steinKit ? this.holeSteinMaterial(steinKit) : null;
    const meshes = sichtbar.map((m, i) => {
      if (!material) return m.mesh;
      const klon = m.mesh.clone(`${schluessel}_${i}`, null, true);
      klon.material = material;
      klon.setEnabled(false);
      klon.isPickable = false;
      return klon;
    });
    const gruppe: MasterGruppe = { meshes, locals: sichtbar.map((m) => m.localMatrix) };
    this.gruppen.set(schluessel, gruppe);
    return gruppe;
  }

  /** Ein Steinmaterial je Konfiguration (wie im `EntityManager`). */
  private holeSteinMaterial(cfg: SteinKitConfig): Material {
    const schluessel = JSON.stringify(cfg);
    let mat = this.steinMaterialien.get(schluessel);
    if (!mat && this.scene !== null) {
      mat = erzeugeSteinKitMaterial(
        this.scene,
        `vorschau3dStein_${this.steinMaterialien.size}`,
        cfg
      );
      this.steinMaterialien.set(schluessel, mat);
    }
    return mat!;
  }

  /**
   * Eine Kugel je anbaubarer Kante — grün offen, bernstein zugemauert.
   *
   * Dieselben Farben wie im Grundriss und dieselbe Liste
   * (`anbaubareKanten`), damit ein Klick hier und ein Klick dort denselben
   * Index meinen. Der Index steht als `metadata.kanteIndex` am Mesh: Er ist
   * der ganze Rückweg zur Seitenleiste.
   */
  private baueMarken(): void {
    const scene = this.scene;
    if (scene === null) return;
    if (this.markeOffen === null) {
      this.markeOffen = new StandardMaterial('vorschau3dMarkeOffen', scene);
      this.markeOffen.emissiveColor = new Color3(0.25, 0.75, 0.3);
      this.markeOffen.disableLighting = true;
      this.markeWand = new StandardMaterial('vorschau3dMarkeWand', scene);
      this.markeWand.emissiveColor = new Color3(0.85, 0.6, 0.2);
      this.markeWand.disableLighting = true;
    }
    this.kanten.forEach((k, idx) => {
      const kugel = MeshBuilder.CreateSphere(
        `vorschau3dMarke_${idx}`,
        { diameter: MARKE_RADIUS_M * 2, segments: 8 },
        scene
      );
      kugel.position.set(k.pos.x, k.pos.y, k.pos.z);
      kugel.material = k.wandIndex === undefined ? this.markeOffen : this.markeWand;
      kugel.metadata = { kanteIndex: idx };
      kugel.isPickable = true;
      this.gebaut.push(kugel);
      // Nach IHRER Höhe, nicht nach der ihres Raums — dieselbe Begründung
      // wie bei `DungeonGrundriss.connectorAufEbene`: Der obere Ausgang der
      // Treppe ist ein Arbeitspunkt auf der oberen Ebene, obwohl sein Raum
      // unten steht.
      this.ebenenBuch.push({ mesh: kugel, von: k.pos.y, hoehe: 0 });
      kugel.setEnabled(this.passtAufEbene(k.pos.y, 0));
    });
  }

  /**
   * Gehört ein Ding mit dieser Höhenspanne auf die gewählte Ebene?
   *
   * `hoehe = 0` ist der punktuelle Fall (Marke, Tür, Deko), sonst gilt das
   * halboffene Intervall [von, von+hoehe): Eine 3,5 m hohe Zelle auf y = 0
   * gehört zu Ebene 0 und nicht zu 3,5, die 7 m hohe Treppe zu beiden.
   */
  private passtAufEbene(von: number, hoehe: number): boolean {
    const e = this.ebene;
    if (e === null) return true;
    if (hoehe <= 0) return Math.abs(e - ebeneVon(von)) < EBENEN_TOLERANZ_M;
    return e > von - EBENEN_TOLERANZ_M && e < von + hoehe - EBENEN_TOLERANZ_M;
  }

  /** Den Ebenenfilter auf alles Gebaute anwenden. */
  private wendeEbeneAn(): void {
    for (const t of this.ebenenBuch) t.mesh.setEnabled(this.passtAufEbene(t.von, t.hoehe));
    // Die Schnitthöhe hängt an der Ebene mit: Auf 3,5 muss die Decke von
    // 3,5 fallen, nicht die von 0.
    this.setzeSchnittebene();
  }

  /**
   * Die Decke wegschneiden — per `scene.clipPlane`, nicht per Mesh.
   *
   * ── Warum kein Decken-Mesh abgeschaltet wird ─────────────────────────
   * Es gibt keins. Die Kit-GLBs sind EIN verschmolzenes Netz je Modul
   * (Boden + Wände + Decke aus einem `bmesh`, s. `make-stonevault.py`), und
   * `DungeonSteinMaterial.ts` trennt Wand/Decke/Boden erst im Shader über
   * die Weltnormale — genau weil es keine getrennten Submeshes gibt. Ein
   * Kamera-Clip (`camera.maxZ`) wiederum schneidet nach ABSTAND, nicht nach
   * Höhe: Aus der Schrägsicht risse er die hinteren Module mit auf.
   *
   * Geschnitten wird deshalb waagerecht knapp unter der Deckenunterkante
   * der gerade GEZEIGTEN Ebene — s. `schnittEbene`. EINE Ebene, weil eine
   * Ebene ist, was eine Ebene ist: Ein Dungeon mit drei Stockwerken lässt
   * sich mit einer waagerechten Fläche nicht überall gleichzeitig öffnen,
   * und der Versuch (Schnitt über der obersten Decke) endet in genau dem
   * Bild, das man vermeiden wollte — von aussen ein geschlossener Klotz.
   */
  private setzeSchnittebene(): void {
    const scene = this.scene;
    if (scene === null) return;
    if (this.decke || this.doc === null) {
      scene.clipPlane = null;
      return;
    }
    const sprung = ebenenMasse(rasterVonBasis(this.doc.base)).ebene;
    const hoehe = this.schnittEbene() + sprung - DECKEN_LUFT_M;
    // Babylon verwirft, wo `n·p + d > 0` ist — mit n = (0,1,0) und
    // d = −hoehe fällt also alles ÜBER `hoehe`.
    scene.clipPlane = new Plane(0, 1, 0, -hoehe);
  }

  /**
   * Die Ebene, deren Decke fällt.
   *
   * Der Ebenenfilter gewinnt — er ist die ausdrückliche Ansage. Ohne ihn
   * zählt der GEWÄHLTE Raum: Man arbeitet an einem Modul und will in dessen
   * Stockwerk sehen, nicht in irgendeines. Ohne Auswahl bleibt der erste
   * Raum, und das ist der Eingang — der Boden, auf dem jedes Grab anfängt.
   */
  private schnittEbene(): number {
    if (this.ebene !== null) return this.ebene;
    const rooms = this.doc?.layout.rooms ?? [];
    const raum = (this.gewaehlt >= 0 ? rooms[this.gewaehlt] : undefined) ?? rooms[0];
    return raum ? ebeneVon(raum.pos.y) : 0;
  }

  /**
   * Kamera auf den gewählten Raum — ohne Auswahl auf das ganze Dungeon.
   *
   * Direkt statt animiert: Ein Fokus, der eine Sekunde fliegt, ist im
   * Editor ein Warteschritt, kein Komfort — und ein halb gelandeter Flug
   * wäre der einzige Zustand, in dem `radius` etwas anderes sagt als das
   * Bild zeigt.
   */
  fokussiere(): void {
    const kamera = this.kamera;
    const doc = this.doc;
    if (kamera === null) return;
    const platziert = doc && this.gewaehlt >= 0 ? doc.layout.rooms[this.gewaehlt] : undefined;
    if (!platziert || !doc) {
      this.rahmeEin(true);
      return;
    }
    const def = DUNGEONS_BY_NAME.get(doc.base)?.rooms.find((r) => r.name === platziert.room);
    // Dieselbe Hülle wie beim Auswahlkasten — der Fokus zielt genau auf
    // das, was der Kasten umschliesst.
    const huelle = def
      ? zeichenHuelle(def, rasterVonBasis(doc.base))
      : { x: 2, y: 2, z: 2 };
    kamera.setTarget(
      new Vector3(platziert.pos.x, platziert.pos.y + huelle.y / 2, platziert.pos.z)
    );
    kamera.radius = Math.max(6, Math.max(huelle.x, huelle.z) * 2.4);
  }

  /**
   * Der gewählte Raum als Drahtkasten.
   *
   * Kein Emissive am Modul selbst: Das Material hängt am MASTER und wäre
   * damit an allen Instanzen desselben Prefabs auf einmal hell — der
   * Kasten markiert genau eine Platzierung. Seine Masse kommen aus
   * `zeichenHuelle` (`DungeonGrundriss.ts`), also aus derselben Rechnung
   * wie das Rechteck im Grundriss; eine zweite hier hiesse, dass sich die
   * beiden Ansichten beim nächsten Modulmass widersprechen.
   */
  private zeichneAuswahl(): void {
    const scene = this.scene;
    const doc = this.doc;
    const alt = this.gebaut.find((m) => m.name === 'vorschau3dAuswahl');
    if (alt) {
      this.gebaut = this.gebaut.filter((m) => m !== alt);
      this.ebenenBuch = this.ebenenBuch.filter((t) => t.mesh !== alt);
      alt.dispose();
    }
    if (scene === null || doc === null || this.gewaehlt < 0) return;
    const platziert = doc.layout.rooms[this.gewaehlt];
    if (!platziert) return;
    const def = DUNGEONS_BY_NAME.get(doc.base)?.rooms.find((r) => r.name === platziert.room);
    if (!def) return;
    const huelle = zeichenHuelle(def, rasterVonBasis(doc.base));

    if (this.auswahlMaterial === null) {
      this.auswahlMaterial = new StandardMaterial('vorschau3dAuswahlMat', scene);
      this.auswahlMaterial.emissiveColor = new Color3(1, 0.82, 0.5);
      this.auswahlMaterial.disableLighting = true;
      this.auswahlMaterial.wireframe = true;
    }
    const kasten = MeshBuilder.CreateBox(
      'vorschau3dAuswahl',
      { width: huelle.x, height: huelle.y, depth: huelle.z },
      scene
    );
    kasten.position.set(platziert.pos.x, platziert.pos.y + huelle.y / 2, platziert.pos.z);
    kasten.rotationQuaternion = new Quaternion(
      platziert.rot.x,
      platziert.rot.y,
      platziert.rot.z,
      platziert.rot.w
    );
    kasten.material = this.auswahlMaterial;
    kasten.isPickable = false;
    this.gebaut.push(kasten);
    // Der Kasten folgt dem Ebenenfilter wie sein Raum: Eine Markierung um
    // ein ausgeblendetes Modul zeigt auf nichts.
    this.ebenenBuch.push({ mesh: kasten, von: platziert.pos.y, hoehe: huelle.y });
    kasten.setEnabled(this.passtAufEbene(platziert.pos.y, huelle.y));
  }

  /**
   * Klick: erst Kantenmarke, dann Raum — dieselbe Rangfolge wie in 2D
   * (`DungeonGrundriss.waehleBei`). Eine Marke steht immer VOR einem
   * Modul; würde der Raum zuerst gefragt, wäre sie sichtbar, aber nie zu
   * treffen.
   */
  private klickBei(px: number, py: number): void {
    const scene = this.scene;
    if (scene === null) return;
    const treffer = scene.pick(px, py, (m) => m.isPickable && m.isEnabled());
    const meta = treffer?.pickedMesh?.metadata as
      | { kanteIndex?: number; roomIndex?: number }
      | undefined;
    if (meta?.kanteIndex !== undefined) {
      this.cb.connectorAngeklickt?.(meta.kanteIndex);
      return;
    }
    if (meta?.roomIndex !== undefined) {
      this.waehle(meta.roomIndex);
      this.cb.raumAngeklickt?.(meta.roomIndex);
      return;
    }
    // Ins Leere geklickt: Auswahl aufheben, wie der Grundriss es tut.
    if (this.gewaehlt !== -1) {
      this.waehle(-1);
      this.cb.raumAngeklickt?.(-1);
    }
  }

  /**
   * Kamera auf das Gebaute richten — nur, wenn sie noch nie gerichtet
   * wurde oder das Dokument gewechselt hat. Ein Kamerasprung nach jedem
   * Anfügen wäre unbrauchbar: Man baut in kleinen Schritten und will dabei
   * hinsehen, wo man gerade ist.
   */
  private rahmeEin(erzwingen = false): void {
    const doc = this.doc;
    if (this.kamera === null || doc === null) return;
    // `erzwingen` ist der Weg des Fokus-Knopfes ohne Auswahl: Dort will man
    // ausdrücklich zurück auf das Ganze, auch beim selben Dokument.
    if (!erzwingen && this.eingerahmtFuer === doc.id) return;
    this.eingerahmtFuer = doc.id;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let summeY = 0;
    for (const r of doc.layout.rooms) {
      minX = Math.min(minX, r.pos.x);
      maxX = Math.max(maxX, r.pos.x);
      minZ = Math.min(minZ, r.pos.z);
      maxZ = Math.max(maxZ, r.pos.z);
      summeY += r.pos.y;
    }
    if (!Number.isFinite(minX)) return;
    const mitteY = doc.layout.rooms.length > 0 ? summeY / doc.layout.rooms.length : 0;
    this.kamera.setTarget(new Vector3((minX + maxX) / 2, mitteY + 1.5, (minZ + maxZ) / 2));
    this.kamera.radius = Math.max(12, Math.max(maxX - minX, maxZ - minZ) * 1.4);
  }

  /** Dokument, für das die Kamera zuletzt gerichtet wurde. */
  private eingerahmtFuer: string | null = null;

  /** Alles endgültig abräumen — kein Leak, keine laufende Schleife danach. */
  private abbauenIntern(): void {
    // Die Schnittebene ist ein Zustand der SZENE — bei einer fremden Szene
    // (Testhaken) bliebe sie sonst stehen und schnitte dem Aufrufer ins Bild.
    if (this.scene !== null) this.scene.clipPlane = null;
    if (this.eigeneSzene) {
      this.engine?.stopRenderLoop(this.frame);
      this.assets = null;
      this.scene?.dispose();
      this.engine?.dispose();
    } else {
      // Fremde Szene (Testhaken): nur das eigene Zeug wegräumen, die Szene
      // selbst gehört dem Aufrufer.
      for (const m of this.gebaut) m.dispose();
      this.kamera?.dispose();
      this.licht?.dispose();
    }
    this.gebaut = [];
    this.ebenenBuch = [];
    this.gruppen.clear();
    this.steinMaterialien.clear();
    this.scene = null;
    this.engine = null;
    this.kamera = null;
    this.licht = null;
    this.markeOffen = null;
    this.markeWand = null;
    this.auswahlMaterial = null;
    this.canvas.remove();
  }
}
