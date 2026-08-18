/**
 * AssetManager (Phase 2) — GLB loading with AssetContainer cache.
 *
 * Models live at /assets/models/<name>.glb (served from the project's own
 * assets/ folder by the Vite plugin). Loads happen lazily on first sight of
 * a prefab; the container is cached and either instantiated per entity
 * (dynamic) or used as thin-instance masters (static vegetation/pieces).
 *
 * Material fixes vs. the AssetRipper dummy shaders (same lessons as the
 * old client, Docs/02 §4): Unity vegetation renders as alpha-cutout,
 * double-sided cards — the export is OPAQUE single-sided. Textures that
 * actually use their alpha channel are detected via a downscaled readback
 * and switched to cutout + no back-face culling; those foliage materials
 * also get the wind plugin.
 *
 * Submeshes gleichen Materials werden dabei zu EINEM Master verschmolzen
 * — siehe verschmelzeNachMaterial(). Ohne das zerfällt ein Bauteil in
 * dutzende Master und damit in dutzende Zeichenaufrufe pro Bild.
 */
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Material } from '@babylonjs/core/Materials/material';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/loaders/glTF/2.0';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import { WindPlugin } from './WindPlugin';
import { GlutPuls } from './GlutPuls';

const MODEL_BASE_URL = '/assets/models/';
const TEXTUR_BASE_URL = '/assets/textures/';

/**
 * Prefabs, deren GLB ein Material OHNE Albedo-Textur mitbringt, samt der
 * Datei, die dort hingehört (ohne `.png`).
 *
 * `stubbe` ist der Baumstumpf im Wald. Sein Material heisst
 * `cylinder1_cylinder1_auvMat` und hat ein leeres
 * `pbrMetallicRoughness` — die Textur fehlt im Export schlicht, das
 * Modell rendert deshalb als weisser Zylinder. Die Geschwistermodelle
 * `stubbe_0.glb` und `stubbe_spawner.glb` tragen dieselbe Geometrie mit
 * dem Material `stump` UND dessen Textur; die ist Pixel für Pixel (100 %
 * geprüft) identisch mit `assets/textures/stump.png`.
 *
 * Bewusst eine kurze, kuratierte Liste statt einer Automatik: Von den 97
 * Prefabs, die als Vegetation gespawnt werden, ist genau DIESES eine
 * betroffen. (Über alle 4669 GLBs sind es 629 — aber das sind Bruch-,
 * LOD- und Menü-Varianten, die nie in der Welt stehen.) Eine Heuristik
 * über Materialnamen würde hier nichts finden: `cylinder1_cylinder1_auvMat`
 * verrät nichts über die gesuchte Datei.
 */
const FEHLENDE_ALBEDO: Readonly<Record<string, string>> = {
  stubbe: 'stump',
};


/**
 * Prefabs, die sich eine GLB TEILEN.
 *
 * `GrabhuegelGras` ist derselbe Bau wie `Grabhuegel`, nur mit Bewuchs auf
 * der Kuppel (HuegelGras.ts). Der Cache-Schlüssel bleibt der PREFABNAME,
 * die Variante bekommt also einen eigenen Container — nötig, weil Meshes
 * die Thin-Instance-Puffer ihres Buckets tragen und ein zweites Prefab auf
 * denselben Mastern die Instanzen des ersten überschriebe.
 */
const MODELL_ALIAS: Readonly<Record<string, string>> = {
  GrabhuegelGras: 'Grabhuegel',
};

/**
 * Kachelmass des Terrains: TerrainSplat rechnet uv = weltXZ × 0.5, eine
 * 256er-Bodenkachel deckt also 2 × 2 m.
 */
const TERRAIN_UV_SCALE = 0.5;


/**
 * Eigene Modelle, die sich im Wind biegen sollen, obwohl ihre Textur kein
 * Alpha-Cutout ist.
 *
 * Der reguläre Windpfad in `fixupMaterial` hängt am Cutout-Test: Wind
 * bekommt nur, was als freigestellte Laubkarte erkannt wurde. Bei den
 * Original-Assets ist das das verlässlichste Signal — Stroh- und
 * Reetdächer mussten sogar zusätzlich per Namen ausgeschlossen werden,
 * weil sie ebenfalls freigestellt sind.
 *
 * Modelle aus Photogrammetrie oder KI-Generatoren tragen ihr Laub dagegen
 * als geschlossene, opake Karte. Sie fallen durch den Test und blieben
 * dadurch starr, obwohl sie Gewächse sind. Für solche Modelle steht der
 * Name hier — das Signal, das die Textur nicht liefert.
 */
const WIND_TROTZ_OPAKER_TEXTUR = /^KiPine/i;

/**
 * Modelle, deren Emissive-Karte lebendig pulsieren soll (Lava, Glut, Feuer).
 *
 * Die Karte selbst entsteht offline aus der BaseColor (tools/glb-glut.py)
 * und leuchtet für sich genommen konstant — was sich als angemalt liest.
 * Erst die Schwankung macht daraus Feuer, und die kommt aus GlutPuls.
 */
const GLUEHEND = /^Surtr/i;
/** Unity LOD shells: Lod0/Lod1/…/LOD3_primitive1 etc. */
const LOD_NAME = /^lod\d/i;
const LOD0_NAME = /^lod0/i;
const NON_LOD0 = /^lod[1-9]\d*/i;

/** Master mesh + its transform relative to the prefab root. */
export interface PrefabMaster {
  mesh: Mesh;
  localMatrix: Matrix;
}

export class AssetManager {
  private readonly containers = new Map<string, Promise<AssetContainer | null>>();
  private readonly masters = new Map<string, PrefabMaster[]>();
  private readonly addedToScene = new Set<string>();
  private readonly alphaChecked = new Set<string>();
  /** Materialien, deren Metallgrad schon korrigiert wurde (siehe setzeMetallgrad). */
  private readonly metallGeprueft = new Set<number>();
  /** Models that failed to load (404, parse error) — counted for the HUD. */
  readonly failed = new Map<string, string>();

  constructor(private readonly scene: Scene) {}

  /** Load (once) and cache the container; null on failure. */
  private loadContainer(name: string): Promise<AssetContainer | null> {
    let p = this.containers.get(name);
    if (!p) {
      // Varianten laden die Datei ihres Alias-Ziels, behalten aber ihren
      // eigenen Container (Cache-Schlüssel bleibt `name` — s. MODELL_ALIAS).
      const datei = MODELL_ALIAS[name] ?? name;
      p = SceneLoader.LoadAssetContainerAsync(MODEL_BASE_URL, `${datei}.glb`, this.scene)
        .catch((err: unknown) => {
          this.failed.set(name, String(err));
          console.warn(`[assets] load failed: ${name}`, err);
          return null;
        });
      this.containers.set(name, p);
    }
    return p;
  }

  /**
   * Instantiate a fresh hierarchy for a dynamic entity. Null = no model —
   * either the GLB failed to load, or it's a mesh-less bone rig (the same
   * AssetRipper export gap already found on Boar/Greydwarf: the eponymous
   * GLB is 0 renderable meshes; callers are expected to fall back to a
   * differently-named "_fixed"/body variant or a placeholder).
   */
  async instantiate(name: string, animation?: string): Promise<TransformNode | null> {
    const container = await this.loadContainer(name);
    if (!container) return null;
    // doNotInstantiate: ECHTE Klone statt InstancedMesh.
    //
    // Mit `false` erzeugt Babylon für Meshes OHNE Skelett InstancedMeshes.
    // Deren Quell-Mesh bleibt im AssetContainer und kommt nie in die Szene —
    // gerendert wird die Instanz dann nicht. Gemessen an der Völva: Mesh in
    // der Szene, sichtbar, Textur geladen, und trotzdem im Bild nur ihr
    // SCHATTEN auf dem Boden (der läuft über die renderList des
    // ShadowGenerators, nicht über den Szenendurchlauf).
    //
    // Aufgefallen ist es erst jetzt, weil alle bisherigen dynamischen
    // Prefabs (Boar, Deer, NPC_1 …) Skelette tragen und deshalb ohnehin
    // als Klone entstehen. Ungeriggte Modelle fallen genau in diese Lücke.
    // Klone kosten etwas Speicher je Instanz — bei einer Handvoll NPCs
    // belanglos gegen ein Modell, das man nicht sieht.
    const inst = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    let hasVisibleGeometry = false;
    for (const mesh of collectMeshes(inst.rootNodes)) {
      // keep only the Lod0 shell — Unity GLBs carry all LOD levels as siblings
      if (NON_LOD0.test(mesh.name)) {
        mesh.setEnabled(false);
        continue;
      }
      await this.fixupMaterial(mesh.material, name, mesh);
      mesh.isPickable = false;
      if (mesh.getTotalVertices() > 0) hasVisibleGeometry = true;
    }
    if (!hasVisibleGeometry) {
      for (const node of inst.rootNodes) node.dispose();
      return null;
    }
    // Gewünschte Animationsgruppe in Schleife starten (PrefabDef.animation
    // — eigene NPC-GLBs bringen echte Skin-Clips mit; der Valheim-Export
    // nicht, dort ist die Liste schlicht leer und nichts passiert).
    if (animation && inst.animationGroups.length > 0) {
      const gruppe =
        inst.animationGroups.find((g) => g.name.includes(animation)) ?? inst.animationGroups[0]!;
      for (const g of inst.animationGroups) g.stop();
      gruppe.start(true);
    }
    const wurzel = (inst.rootNodes[0] as TransformNode) ?? null;
    // Die Gruppen dieser INSTANZ merken: instantiateModelsToScene klont sie
    // je Aufruf (jede Instanz hat eigene), scene.animationGroups wirft aber
    // alle in einen Topf. Ohne diese Zuordnung liesse sich zur Laufzeit
    // nicht sagen, welche Gruppe zu welchem NPC gehört.
    if (wurzel && inst.animationGroups.length > 0) {
      this.animGruppen.set(wurzel, inst.animationGroups);
    }
    return wurzel;
  }

  /**
   * Animationsgruppen je instanziierter Wurzel — Grundlage für den Wechsel
   * zur Laufzeit (s. wechsleAnimation). WeakMap: Wird der Knoten entsorgt,
   * verschwindet der Eintrag von selbst.
   */
  private readonly animGruppen = new WeakMap<TransformNode, AnimationGroup[]>();

  /**
   * Animationsgruppe einer BESTEHENDEN Instanz umschalten (Routen-NPCs:
   * `walk` beim Gehen, `idle` im Stand).
   *
   * Warum so schlank: Der Zustandsname vom Server IST der Gruppenname im
   * Modell — ein Teiltreffer ohne Gross-/Kleinschreibung genügt, damit
   * "Walking" aus npc_1_walk.glb ebenso trifft wie ein sauber benanntes
   * "walk". Eine Zuordnungstabelle je Prefab bräuchte es erst, wenn ein
   * Modell seine Zustände wirklich anders nennt.
   *
   * Fehlt die Gruppe (das noch ungeriggte Voelva-Modell, jedes Prefab ohne
   * Clips), passiert genau NICHTS ausser dass die bisherige Gruppe stoppt:
   * Ein Laufzyklus, der im Stand weiterläuft, wäre falscher als eine
   * ruhende Pose. Die Bewegung selbst hängt nicht daran — die kommt vom
   * Server.
   */
  wechsleAnimation(root: TransformNode, wunsch: string): void {
    const gruppen = this.animGruppen.get(root);
    if (!gruppen || gruppen.length === 0) return;
    const ziel = gruppen.find((g) => g.name.toLowerCase().includes(wunsch.toLowerCase()));
    for (const g of gruppen) {
      if (g !== ziel) g.stop();
    }
    if (ziel && !ziel.isPlaying) ziel.start(true);
  }

  /**
   * Animationsgruppen einer entsorgten Instanz freigeben. Sie hängen an
   * der Szene, nicht am Knoten — ohne dispose liefen sie nach dem
   * Entfernen des NPCs auf toten Zielen weiter.
   */
  entsorgeAnimationen(root: TransformNode): void {
    const gruppen = this.animGruppen.get(root);
    if (!gruppen) return;
    this.animGruppen.delete(root);
    for (const g of gruppen) g.dispose();
  }

  /**
   * Master meshes for thin instancing: the container's REAL meshes are added
   * to the scene once (instantiateModelsToScene only produces InstancedMesh
   * clones, which can't carry thin-instance buffers) and stay disabled until
   * instances exist. Only the Lod0 shell becomes a master — Unity exports
   * every LOD level as a sibling mesh. Each master's localMatrix bakes its
   * transform within the prefab hierarchy; instance matrices are
   * localMatrix × zdoWorld.
   *
   * Submeshes, die sich ein Material teilen, werden vorher zu einem
   * einzigen Master zusammengelegt (verschmelzeNachMaterial) — das ist
   * der Unterschied zwischen 435 und 124 Zeichenaufrufen, s. dort.
   */
  /**
   * Bereits gebaute Master OHNE Ladeanstoss — für Systeme, die auf fertige
   * Prefabs nur REAGIEREN (HuegelGras streut Halme auf die Grabhügel-
   * Kuppel). getMasters() würde die 17-MB-GLB auch dann laden, wenn nie
   * eine Instanz gespawnt wird; hier gibt es null, solange der
   * EntityManager das Modell nicht selbst angefordert hat.
   */
  mastersSofort(name: string): PrefabMaster[] | null {
    return this.masters.get(name) ?? null;
  }

  async getMasters(name: string): Promise<PrefabMaster[]> {
    const cached = this.masters.get(name);
    if (cached) return cached;

    const container = await this.loadContainer(name);
    if (!container) return [];
    if (!this.addedToScene.has(name)) {
      this.addedToScene.add(name);
      container.addAllToScene();
    }

    const withGeometry = container.meshes.filter(
      (m): m is Mesh => m instanceof Mesh && !!m.geometry
    );
    const hasLods = withGeometry.some((m) => LOD_NAME.test(m.name));

    // Erst sammeln, dann zusammenlegen: Das Verschmelzen braucht die GLB-
    // Hierarchie noch INTAKT (MergeMeshes liest die Weltmatrix jedes
    // Quellmeshes), das Zurücksetzen auf die Identität passiert deshalb
    // erst danach in zuMaster().
    const kandidaten: Mesh[] = [];
    for (const mesh of withGeometry) {
      if (hasLods && !LOD0_NAME.test(mesh.name)) {
        mesh.setEnabled(false); // higher LOD shells never render
        continue;
      }
      // Submeshes ohne echtes Material überspringen.
      //
      // "DefaultMaterial" ist der Platzhalter, den AssetRipper einsetzt,
      // wenn im Unity-Projekt kein Material am Renderer hing — er hat
      // keine Textur und rendert als weisse Fläche. In 42 Modellen kommt
      // das vor, unter anderem in Bush01, Bush01_heath und BlueberryBush:
      // dort standen weisse Splitter in den Büschen. Was in Unity kein
      // Material hatte, gehört auch bei uns nicht ins Bild.
      if (mesh.material?.name === 'DefaultMaterial') {
        mesh.setEnabled(false);
        continue;
      }
      // Meadows-Grabhügel: Die Erdkuppel bekommt Terrain-Kachel-UVs. Muss
      // HIER passieren, solange die GLB-Hierarchie noch intakt ist — die
      // planare Projektion braucht die Prefab-lokalen Weltkoordinaten,
      // die zuMaster() gleich danach in localMatrix wegbäckt.
      await this.fixupMaterial(mesh.material, name, mesh);
      mesh.isPickable = false;
      kandidaten.push(mesh);
    }

    const result = verschmelzeNachMaterial(kandidaten).map(zuMaster);
    this.masters.set(name, result);
    return result;
  }

  /**
   * Alpha-cutout + double-sided detection for foliage (see header).
   *
   * Mirrors the three.js reference (`valheim-browser` AssetManager
   * applyAlphaCutoutIfNeeded: alphaTest=0.5 + DoubleSide on any texture
   * with an alpha channel) — with refinements verified against the
   * Babylon source in node_modules (not by screenshot guessing):
   *  1. Nur echte Laubkarten bekommen den Cutout, Rinde bleibt OPAK —
   *     sonst rendert sie mit ausgestanzten Löchern. Unterschieden wird
   *     am Anteil WIRKLICH DURCHSICHTIGER Texel (Alpha < 16), nicht am
   *     Anteil irgendwie durchscheinender: Rinde trägt im Alpha-Kanal
   *     Smoothness-Daten mit Zwischenwerten, Laub hat Löcher. Details und
   *     Messwerte an der Zählschleife in `fixupMaterial`.
   *  2. Babylon's alpha-test define chain (verified in
   *     @babylonjs/core Materials/PBR/pbrBaseMaterial.js +
   *     materialHelper.functions.js PrepareDefinesForMisc +
   *     ShadersInclude/pbrBlockAlbedoOpacity.js):
   *       transparencyMode=MATERIAL_ALPHATEST
   *         ⇒ needAlphaTestingForMesh() = true   (short-circuit)
   *         ⇒ defines.ALPHATEST                  (PrepareDefinesForMisc)
   *       Shader: alpha *= albedoTexture.a  requires
   *         (ALPHAFROMALBEDO || ALPHATEST) — ALPHATEST alone suffices,
   *         then  if (alpha < ALPHATESTVALUE) discard.
   *     useAlphaFromAlbedoTexture + tex.hasAlpha are additionally set so
   *     the opaque fallback (bark etc.) keeps working if a texture is
   *     later probed for blending; alphaCutOff defines ALPHATESTVALUE.
   */
  /**
   * Metallgrad auf den Wert setzen, den das Original angibt.
   *
   * ── Warum das nötig ist ─────────────────────────────────────────────
   * Die glTF-Spezifikation setzt `metallicFactor` auf 1, wenn ein Material
   * nichts anderes sagt — und die AssetRipper-Exporte sagen nichts anderes:
   * gemessen in der laufenden Szene hatten 129 von 130 PBR-Materialien
   * `metallic = 1`, KEINES eine Metallic-Map.
   *
   * Ein vollmetallisches Material hat per Definition keine diffuse
   * Reflexion; seine gesamte Helligkeit kommt aus der gespiegelten
   * Umgebung. Die Szene hat aber keine `environmentTexture` (IBL), also
   * bleibt nur der Glanzpunkt des Richtungslichts übrig. Tagsüber
   * überdeckt die starke Sonne (Intensität 1.7) das noch halbwegs;
   * nachts steht dem Mondlicht mit 0.82 × Farbe (0.30, 0.31, 0.40) fast
   * nichts mehr gegenüber, und Bäume, Felsen und Gegenstände rendern
   * schwarz — während der Boden (eigenes NodeMaterial mit eigener
   * Beleuchtung, siehe TerrainSplat) normal weiterleuchtet und der Nebel
   * seine volle Helligkeit behält. Genau dieses Bild — schwarze Objekte
   * vor grauem Dunst — war der Anlass für diese Korrektur.
   *
   * ── Woher der Wert kommt ────────────────────────────────────────────
   * Aus den 1.489 Original-Materialien mit `_Metallic` in
   * `Valheim_Client/extracted_assets/Material/`: 1.299 davon stehen auf 0,
   * also 87 %. Rinde, Laub, Fels, Holz, Stoff — alles Dielektrika. Auf 1
   * stehen 153, praktisch ausschliesslich Erzadern, Metallwaffen und
   * -rüstungen; die deckt METALLISCH ab.
   *
   * Die Rauheit bleibt, wie sie ist: Babylon erbt aus dem glTF ebenfalls 1,
   * und `_Glossiness` ist im Original bei 725 von 1.454 Materialien genau 0
   * (matt) — der häufigste Einzelwert. Eine genauere Zuordnung scheitert
   * daran, dass die GLB-Materialnamen von den Unity-Namen abweichen
   * (`beech_leaf_small` gegen `beech_leaf`), sie bräuchte denselben
   * PathID-Abgleich wie die Texturwiederherstellung.
   */
  private setzeMetallgrad(material: PBRMaterial): void {
    if (this.metallGeprueft.has(material.uniqueId)) return;
    this.metallGeprueft.add(material.uniqueId);
    // Eine echte Metallic-Map ist die Ausnahme, aber wenn sie da ist, ist
    // der Faktor 1 richtig — dann steuert der Kanal, nicht der Faktor.
    if (material.metallicTexture) return;
    // FELS SCHLÄGT METALL.
    //
    // `rock1_copper` ist ein Kupfererz-Brocken: überwiegend Gestein, mit
    // ein paar grünen Adern durchzogen. Über `copper` griff aber die
    // Metallregel und setzte `metallic = 1` — und weil eine Metallic-Map
    // fehlt, gilt das für die GANZE Oberfläche, nicht nur die Adern. Ein
    // vollmetallisches Material hat keinen diffusen Anteil und braucht
    // eine Umgebung zum Spiegeln; ohne IBL (`scene.environmentTexture`
    // ist nirgends gesetzt) bleibt es nahezu schwarz. Gemeldet wurde das
    // als "hier fehlt die Textur" — die Textur ist einwandfrei da
    // (256², Fels mit grünen Adern und goldenen Einsprengseln), sie wurde
    // nur nicht beleuchtet.
    //
    // Betroffen sind sieben Materialien, alle ohne Metallic-Map und alle
    // Gestein mit Einschlüssen, keines ein Metallblock: rock1_copper,
    // rock3_silver, rock_copper_internal, rock_silver_internal,
    // ObsidianRock_mat, Guardstone_Oden_marble, bossstone_metal.
    //
    // Sobald ein IBL steht (Docs/07, Stufe 5), lässt sich das erneut
    // prüfen — dann wären echte Metallreflexe wieder darstellbar, und für
    // die Adern bräuchte es ohnehin eine Metallic-Map statt eines
    // globalen Faktors.
    const istFels = FELSIG.test(material.name);
    material.metallic = !istFels && METALLISCH.test(material.name) ? 1 : 0;
  }

  private async fixupMaterial(
    material: Material | null,
    modelName: string,
    mesh?: AbstractMesh
  ): Promise<void> {
    if (!material || !(material instanceof PBRMaterial)) return;
    this.setzeMetallgrad(material);

    // Wind für Modelle ohne Cutout-Laub — muss VOR dem Cutout-Block
    // stehen, dessen frühe `return`s solche Materialien sonst aussortieren
    // (siehe WIND_TROTZ_OPAKER_TEXTUR).
    if (WIND_TROTZ_OPAKER_TEXTUR.test(modelName)) this.setzeWind(material, mesh);

    // Glut zum Pulsen anmelden — ebenfalls vor dem Cutout-Block, aus
    // demselben Grund.
    if (GLUEHEND.test(modelName) && material.emissiveTexture) {
      GlutPuls.registriere(material, this.scene);
    }

    // Fehlende Albedo-Textur aus der Lückenliste nachreichen, bevor unten
    // irgendetwas an ihr gemessen wird (siehe FEHLENDE_ALBEDO).
    if (!material.albedoTexture) {
      const datei = FEHLENDE_ALBEDO[modelName];
      if (datei) {
        material.albedoTexture = new Texture(`${TEXTUR_BASE_URL}${datei}.png`, this.scene);
      }
    }

    const tex = material.albedoTexture;
    if (!(tex instanceof Texture)) return;

    // ── Was die Datei SAGT, schlägt was die Statistik VERMUTET ──────────
    //
    // Der Alpha-Test unten wird aus Texel-Anteilen ERRATEN. Das war
    // richtig, solange alle Modelle aus dem AssetRipper-Export kamen: Die
    // schreiben durchgehend `alphaMode: OPAQUE`, auch für Laubkarten, und
    // ohne Raten bliebe jedes Blatt ein volles Rechteck.
    //
    // Unsere EIGENEN Modelle sagen es dagegen selbst. `baum-generieren.py`
    // stellt den Blender-Blendmodus auf CLIP, und der glTF-Exporter macht
    // daraus `alphaMode: MASK` samt Cutoff — Babylons Loader setzt daraus
    // bereits `transparencyMode` und `alphaCutOff`. Hier nochmal zu raten
    // ist bestenfalls überflüssig und schlimmstenfalls falsch.
    //
    // Falsch wird es genau dann, wenn ein Atlas Laub UND Rinde trägt: Der
    // Lochanteil wird über das GANZE Bild gezählt, die opake Rindenhälfte
    // drückt ihn unter die 30-%-Schwelle, und die Laubkarten der Eiche
    // rendern als volle Rechtecke (gemessen: 38,3 % Löcher im Laubteil,
    // 19,2 % im kombinierten Atlas). Genau diese Bauart entsteht beim
    // Zusammenlegen von Rinden- und Laubmaterial —
    // tools/baum-material-zusammenlegen.mjs.
    //
    // Blast-Radius ausgezählt über alle 148 GLBs unter `assets/models`
    // (199 Materialien mit Basisfarb-Textur): **kein einziges** Material,
    // das MASK deklariert, verliert heute den Cutout durch die Heuristik.
    // Diese Abkürzung ändert an keinem bestehenden Modell etwas; sie hält
    // nur die neuen Atlanten aus der Statistik heraus.
    //
    // Die Gegenrichtung bleibt bewusst wie sie ist: 22 Materialien sagen
    // OPAQUE und bekommen den Cutout trotzdem (Beech1, Bush01,
    // SwampTree1/2, FirTree_small). Das sind Modelle aus der Rip-Zeit, die
    // über ihren Alphakanal lügen — dort ist das Raten der einzige Weg.
    if (material.transparencyMode === Material.MATERIAL_ALPHATEST) {
      material.backFaceCulling = false;
      material.useAlphaFromAlbedoTexture = true;
      tex.hasAlpha = true;
      if (swaysInWind(modelName)) this.setzeWind(material, mesh);
      return;
    }

    if (this.alphaChecked.has(tex.uid)) return;
    this.alphaChecked.add(tex.uid);

    try {
      const pixels = await readAlphaSample(tex);
      if (!pixels) return;
      // Gezählt wird, was WIRKLICH DURCHSICHTIG ist, nicht was irgendwie
      // durchscheint.
      //
      // Vorher lag die Grenze bei `< 250` und der Anteil musste über 50 %
      // liegen. Das trennt Laub und Rinde nicht: `birch_bark` kam damit auf
      // 44,6 %, `PineTree_01` nur auf 41,5 % — die Rinde war also
      // "durchscheinender" als die Kiefernnadeln. Die Kiefer fiel dadurch
      // unter die Schwelle, bekam keinen Cutout und rendert als volle
      // opake Karte. Genau so wurde es gemeldet: "Pinetree_01 hat
      // scheinbar keine richtigen Blatt-Texturen".
      //
      // Der Unterschied liegt nicht im Anteil, sondern in der ART der
      // Alphawerte: Eine Cutout-Karte hat LÖCHER (Alpha ≈ 0), ein
      // Datenkanal (Smoothness, Maske) hat Zwischenwerte. Auf `< 16`
      // gezählt fallen beide Gruppen sauber auseinander — gemessen über
      // alle Baum-Texturen des Exports:
      //
      //   Laub   beech 66 %  oak 64 %  birch 61 %  shrub_2 56 %
      //          PineTree_01 37 %  Pine_tree_texture_d 34 %
      //   Rinde  birch_bark 24 %  oak_bark 8 %  beech_bark 1 %
      //
      // 30 % liegt mit Abstand in der Lücke zwischen 24 % und 34 %.
      //
      // ABER: Dieses Kriterium ALLEIN reicht nicht, es hätte 17 Materialien
      // den Cutout genommen — sämtliche `straw_roof*` der Strohdächer.
      // Reet ist ebenfalls freigestellt, aber mit weichen, ausgefransten
      // Rändern statt mit Löchern: 69 % nicht-opak, davon nur 2,6 % wirklich
      // durchsichtig. Ohne Cutout rendern die Dachkanten als volle Rechtecke.
      //
      // Es sind also ZWEI Bauarten, und jede braucht ihr eigenes Maß:
      //
      //   Löcher    (Laub)    Alpha < 16 auf über 30 %
      //   Ausfransung (Reet)  Alpha < 250 auf über 50 %
      //
      // Verknüpft mit ODER. Rinde erfüllt keines von beidem — `birch_bark`
      // ist der engste Fall und liegt mit 44,6 % / 23,9 % unter beiden
      // Schwellen. Gegenprobe über alle 358 Vegetations- und
      // Bauteil-Materialien des Exports: Kein Material verliert den
      // Cutout, sechs bekommen ihn neu (die vier Pinetree_01-Varianten und
      // zwei Ashlands-Wurzeln) — genau die gemeldete Lücke.
      const KLAR_DURCHSICHTIG = 16;
      const MIN_LOECHER = 0.3;
      const NICHT_OPAK = 250;
      const MIN_AUSFRANSUNG = 0.5;
      let loecher = 0;
      let weich = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < KLAR_DURCHSICHTIG) loecher++;
        if (pixels[i] < NICHT_OPAK) weich++;
      }
      const gesamt = pixels.length / 4;
      const istCutout = loecher / gesamt >= MIN_LOECHER || weich / gesamt >= MIN_AUSFRANSUNG;
      if (!istCutout) return; // Smoothness-/Maskenkanal, keine freigestellte Karte
      // Materialien, die per NAME als Nicht-Laub feststehen, nie freistellen.
      //
      // Der Anteil-Test allein reicht nicht: "Rocks_3_roughness" und
      // "Rocks_4_roughness" tragen ihre Rauheit im Alpha-Kanal und wurden
      // dadurch als Laubkarte behandelt. Ergebnis waren Steine mit
      // ausgestanzten Löchern (alphaCutOff 0.5, backFaceCulling aus), die
      // zu allem Überfluss auch noch im Wind schwangen. Der Namensfilter
      // bleibt deshalb als zweite Sicherung, auch wenn das schärfere
      // Alpha-Kriterium oben diese Fälle inzwischen selbst abfängt.
      if (!isFoliageMaterial(material.name)) return;
      material.transparencyMode = Material.MATERIAL_ALPHATEST;
      material.alphaCutOff = 0.5;
      material.backFaceCulling = false;
      material.useAlphaFromAlbedoTexture = true; // AssetRipper leaves this off
      tex.hasAlpha = true; // AssetRipper writes opaque RGBA — alpha is real
      // Wind NUR auf Pflanzen. Der Alpha-Cutout allein reicht als Kriterium
      // nicht: Stroh- und Reetdächer sind ebenfalls freigestellte Karten und
      // bekamen dadurch denselben Sway — die Dachteile der Hütte am
      // Startplatz schwangen im Sturm wie Laub. Sichtbar wurde das erst mit
      // der korrigierten Amplitude; der Fehler steckte schon vorher drin.
      if (swaysInWind(modelName)) this.setzeWind(material, mesh);
    } catch {
      // texture not readable (already disposed etc.) — leave material as-is
    }
  }

  /**
   * Hängt das Wind-Plugin an, höchstens einmal je Material, und meldet ihm
   * die Kronenweite des Modells.
   *
   * Ein Material wird von mehreren Meshes geteilt, und `fixupMaterial`
   * läuft je Mesh — Babylons Plugin-Manager wirft beim zweiten Plugin
   * desselben Namens. Die Weite wird über alle diese Meshes zum Maximum
   * geführt: Sie ist der Bezug, ab dem der Wind voll angreift (siehe
   * vbAnsatzDaempfung in WindPlugin), und muss deshalb die äusserste
   * Blattspitze umfassen, nicht nur die des zuerst gesehenen Submesh.
   */
  private setzeWind(material: PBRMaterial, mesh?: AbstractMesh): void {
    const vorhanden = material.pluginManager?.getPlugin('Wind') as WindPlugin | null | undefined;
    const plugin = vorhanden ?? new WindPlugin(material);

    // Der Schattenwurf muss dieselbe Verschiebung mitmachen wie das Blatt
    // selbst. Sonst steht der Schatten still, während die Krone schwankt —
    // im Bild wirkt der Baum dann wie aufgeklebt.
    //
    // Grund: Die Schattenkarte rendert NICHT mit diesem Material, sondern
    // mit Babylons eigenem Tiefen-Shader (`shadowMap.vertex`). Dort gibt
    // es keinen Plugin-Manager, also auch kein `WindPlugin` und keine
    // `CUSTOM_VERTEX_UPDATE_POSITION`-Injektion — der Tiefenpass sieht die
    // unbewegte Ruhelage der Geometrie.
    //
    // `ShadowDepthWrapper` ist genau dafür da: Er baut den Tiefen-Shader
    // aus dem Basismaterial und übernimmt dessen Vertex-Code samt
    // Plugins. Die vom Wrapper erwartete Weltpositions-Variable heisst in
    // Babylons PBR-Vertexshader bereits `worldPos`, deshalb ist kein
    // `remappedVariables` nötig.
    //
    // Kosten: ein zusätzliches Shaderprogramm je Laubmaterial (rund ein
    // Dutzend), nur für den Schattenpass. Keine zusätzlichen Draw Calls —
    // die Werfer werden ohnehin gezeichnet.
    if (!material.shadowDepthWrapper) {
      material.shadowDepthWrapper = new ShadowDepthWrapper(material, material.getScene());
    }

    if (!mesh) return;
    const bb = mesh.getBoundingInfo().boundingBox;
    // Halbe Ausdehnung um die Modellachse, in lokalen Koordinaten — der
    // Shader rechnet mit `position`, nicht mit Weltkoordinaten.
    const weite = Math.max(
      Math.abs(bb.minimum.x), Math.abs(bb.maximum.x),
      Math.abs(bb.minimum.z), Math.abs(bb.maximum.z)
    );
    plugin.spread = Math.max(plugin.spread, weite);
  }
}


/**
 * Submeshes gleichen Materials zu je einem Mesh zusammenlegen.
 *
 * ── Warum das der grösste Hebel im Bild ist ──────────────────────────
 * Ein Master-Mesh ist ein Zeichenaufruf, egal wie viele Thin Instances
 * daran hängen. Die GLBs zerfallen aber in erschreckend viele Submeshes,
 * weil Unity jedes Bauteil aus Einzelstücken zusammensetzt (gemessen am
 * 2026-07-30 in einer Server-Welt mit 9896 statischen ZDOs):
 *
 *   wood_roof_top      54 Submeshes →  5 Materialien →   7 Instanzen
 *   wood_roof_top_45   53 Submeshes →  6 Materialien →   4 Instanzen
 *   wood_roof          34 Submeshes →  6 Materialien →  35 Instanzen
 *   wood_fence         26 Submeshes →  2 Materialien →  15 Instanzen
 *
 * 54 Zeichenaufrufe für sieben Dachspitzen. Über alle 54 sichtbaren
 * Prefabs waren es 435 Master; nach dem Zusammenlegen sind es 124 —
 * etwas mehr als die 119 Kombinationen aus Prefab und Material, weil
 * Submeshes mit verschiedenen Vertexattributen getrennt bleiben (s.u.).
 *
 * ── Diese Zahlen sind Geschichte (Stand D10, 2026-08-15) ─────────────
 * Sie stammen aus der Zeit der Valheim-Rips. Der Bestand unter
 * `assets/models` ist inzwischen ein EIGENER Satz von 119 GLBs
 * (tools/baeume-bauen.sh und Geschwister) — `wood_roof_top` und seine 54
 * Submeshes gibt es dort nicht mehr. Über alle 119 Dateien ausgezählt:
 *
 *   Primitive nach LOD-Filter        193
 *   Master nach dem Zusammenlegen    187   (das Verschmelzen spart 6)
 *   davon mit mehr als einem Master   60   fast alle sind Baum = Rinde
 *                                          + Laub, also genau zwei
 *   Ausreisser                        Grabhuegel mit 16 Submeshes und
 *                                     10 Materialien → 10 Master
 *
 * Geladen wird davon nur, was gerade gestreut ist: Die Grasland-Flora
 * (shared/src/flora.ts) umfasst 33 Prefabs → 51 Master, mit den
 * Layout-Platzierungen im Umkreis rund 58. An einer Biomgrenze mit
 * Nadelwald sind es rund 94. Die Roadmap rechnet mit 124 Mastern und
 * einer Ersparnis durch Prefab-Atlasse; das obere Ende eines Atlas wäre
 * hier "ein Master je Prefab", also 58 statt 51+ — rund zehn
 * Zeichenaufrufe, erkauft damit, dass die opake Rinde in dasselbe
 * alpha-getestete, beidseitig gezeichnete Material wanderte wie das Laub.
 * Deshalb ist es bei D10 beim Culling geblieben, s. zuMaster().
 *
 * Dass daran die ANZAHL hängt und nicht die Geometrie, zeigt der Test
 * mit 356 dieser Master: einmal auf thinInstanceCount = 1 gesetzt
 * (Zeichenaufrufe bleiben, 9196 Instanzen fallen weg), einmal ganz
 * abgeschaltet.
 *
 *   alle Master, alle Instanzen            11,5 ms/Bild
 *   Instanzen auf 1, Zeichenaufrufe bleiben 12,4 ms/Bild   (unverändert)
 *   Master ganz aus                         6,0 ms/Bild   (−5,6 ms)
 *
 * Die Instanzen kosten also NICHTS Messbares. Von der anderen Seite
 * bestätigt es die Auflösung: 1600×900 und 800×450 liefern beide
 * ~11,5 ms, die Pixelzahl ist gleichgültig. Das Bild hängt an der CPU,
 * nicht an der Grafikkarte.
 *
 * Der A/B-Vergleich dieser Funktion, beide Male 9896 statische ZDOs am
 * selben Ort, gemessen als Differenz zu "alle Prefab-Master aus":
 *
 *                  Master   mit Mastern   ohne Master   Kosten
 *   ohne Merging     435      20,1 ms       10,7 ms     9,4 ms
 *   mit Merging      124      10,5 ms        7,3 ms     3,3 ms
 *
 * Vorsicht bei den absoluten Werten: Die Grundlast schwankt zwischen
 * Sitzungen erheblich (10,7 gegen 7,3 ms für dieselbe Szene ohne
 * Prefabs — der Testrechner teilt sich die Grafikkarte). Belastbar ist
 * das VERHÄLTNIS: Die Prefab-Master kosten nach dem Zusammenlegen etwa
 * halb so viel, bei gleicher Grundlast gerechnet.
 *
 * Bei eingeschalteten Schatten zählt das mehrfach: Jede Kaskade rendert
 * die Werferliste komplett erneut (siehe Shadows.ts), und die schrumpft
 * im selben Verhältnis. Dazu kommt die CPU-Seite in EntityManager
 * .rebuildBucketInstances(): Die legt PRO MASTER ein Float32Array über
 * alle Instanzen an und multipliziert jede Matrix neu — bei
 * wood_roof_top bisher 54-mal dieselbe Arbeit statt 5-mal.
 *
 * ── Was hier NICHT zusammengelegt wird ───────────────────────────────
 * Verschmolzen wird ausschliesslich INNERHALB EINER GLB, also innerhalb
 * eines einzelnen Prefabs. Die 54 Submeshes von wood_roof_top sind die
 * Bretter und Balken, aus denen dieses EINE Dachteil modelliert ist —
 * kein Spieler setzt die einzeln.
 *
 * Zwei platzierte Wände bleiben dagegen zwei Instanzen im selben Bucket
 * (EntityManager.applyStatic) und werden über ihre Matrizen gesetzt und
 * per Swap-Remove wieder entfernt. Für die kommende Baufunktion ändert
 * sich dadurch nichts: Ein Bauteil ist weiterhin ein Prefab mit einem
 * eigenen ZDO, einzeln platzierbar und einzeln abreissbar. Würde man
 * über Prefab-Grenzen hinweg verschmelzen, wäre genau das kaputt — und
 * es geht auch gar nicht, weil jedes Prefab seine eigenen Instanzen hat.
 *
 * ── Warum MergeMeshes und nicht selbst backen ────────────────────────
 * MergeMeshes nimmt die WELTMATRIX jedes Quellmeshes (mesh.js,
 * _MergeMeshesCoroutine → getVertexDataFromMesh) und trägt damit genau
 * die GLB-Hierarchie ein, die zuMaster() sonst in localMatrix ablegt.
 * Entscheidend ist dabei der gespiegelte Fall: Bei negativer
 * Determinante dreht es die Dreieckswicklung des betroffenen Bereichs
 * selbst um (mesh.vertexData.js, _mergeCoroutine ruft _FlipFaces je
 * Quellmesh). Genau deshalb wird VOR der sideOrientation-Korrektur in
 * zuMaster() verschmolzen — sonst käme das zweimal zur Anwendung und
 * die hohlen Felsen und halbierten Stämme wären zurück.
 *
 * Die Quellmeshes werden NICHT entsorgt, nur abgeschaltet: Sie gehören
 * dem AssetContainer, aus dem instantiate() weiterhin dynamische
 * Entitäten zieht. Der Preis ist eine zweite Kopie der Geometrie im
 * Speicher; bei der Grössenordnung dieser Bauteile ist das nichts gegen
 * die eingesparten Zeichenaufrufe.
 */
function verschmelzeNachMaterial(kandidaten: Mesh[]): Mesh[] {
  // Gruppiert wird über die Material-INSTANZ (nicht den Namen: innerhalb
  // eines GLB ist beides gleichbedeutend, aber die Instanz ist das, was
  // Babylon beim Zeichnen bindet) UND über den Satz der Vertexattribute.
  //
  // Letzteres ist keine Vorsichtsmassnahme, sondern gemessen: Trifft ein
  // Submesh mit UV2 oder Vertexfarben auf eines ohne, WIRFT MergeMeshes
  // ("Cannot merge vertex data that do not have the same set of
  // attributes") statt null zurückzugeben — und riss damit getMasters()
  // mit, sodass das ganze Prefab unsichtbar blieb.
  const gruppen = new Map<string, { material: Material | null; meshes: Mesh[] }>();
  for (const mesh of kandidaten) {
    const attribute = mesh.getVerticesDataKinds().slice().sort().join(',');
    const schluessel = `${mesh.material?.uniqueId ?? 'ohne'}|${attribute}`;
    const gruppe = gruppen.get(schluessel);
    if (gruppe) gruppe.meshes.push(mesh);
    else gruppen.set(schluessel, { material: mesh.material, meshes: [mesh] });
  }

  const out: Mesh[] = [];
  for (const { material, meshes: gruppe } of gruppen.values()) {
    if (gruppe.length < 2) {
      out.push(...gruppe);
      continue;
    }
    // allow32BitsIndices: Ohne das bricht MergeMeshes ab 65536 Vertices
    // kommentarlos mit null ab. disposeSource bleibt aus, s. Kopf.
    //
    // Das try bleibt trotz der Gruppierung oben stehen: Ein fehlgeschlagenes
    // Verschmelzen darf niemals das Laden eines Prefabs verhindern — ohne
    // Master steht das Objekt gar nicht erst im Bild.
    let verschmolzen: Mesh | null = null;
    try {
      verschmolzen = Mesh.MergeMeshes(gruppe, false, true, undefined, false, false);
    } catch (err) {
      console.warn('[assets] Verschmelzen fehlgeschlagen', gruppe[0]?.name, err);
    }
    if (!verschmolzen) {
      // Kein Grund zur Sorge, nur kein Gewinn: MergeMeshes lehnt auch ab,
      // wenn die Quellen unterschiedliche sideOrientation tragen. Dann
      // bleibt es bei einem Master je Submesh — das Bild stimmt weiterhin.
      out.push(...gruppe);
      continue;
    }
    // Den Namen des ersten Quellmeshes beibehalten (MergeMeshes hängt
    // "_merged" an): Shadows.ts entscheidet über den Mesh-NAMEN, welches
    // Kleinzeug bei abgeschalteten fernen Schatten nicht mehr wirft.
    verschmolzen.material = material;
    verschmolzen.isPickable = false;
    for (const quelle of gruppe) quelle.setEnabled(false);
    out.push(verschmolzen);
  }
  return out;
}

/**
 * Ein Mesh zum Thin-Instance-Master machen: Hierarchie einfrieren und
 * die eigene Transformation auf die Identität zurücksetzen.
 *
 * Für ein verschmolzenes Mesh ist das ein Selbstläufer — es hängt an
 * keinem Elternknoten und steht bereits in Weltkoordinaten, localMatrix
 * wird also die Identität und der Determinantenzweig greift nicht.
 */
function zuMaster(mesh: Mesh): PrefabMaster {
  mesh.computeWorldMatrix(true);
  const localMatrix = mesh.getWorldMatrix().clone();
  // Babylon derives backface-culling orientation from the mesh's OWN
  // world-matrix determinant (Meshes/mesh.js, _getWorldMatrixDeterminant),
  // computed once per mesh — not per thin instance. A negative
  // determinant here (mirrored node somewhere in the GLB hierarchy, e.g.
  // AssetRipper's Unity->glTF handedness conversion) would normally be
  // compensated automatically while the mesh keeps that hierarchy. Once
  // we flatten it into `localMatrix` and reset the master to identity
  // below (determinant +1), that compensation is lost and the mesh
  // renders back-face-first — hollow-looking rocks, half-missing trunks.
  // Bake the compensation into sideOrientation instead, once per master.
  if (localMatrix.determinant() < 0) {
    mesh.sideOrientation =
      mesh.sideOrientation === Material.ClockWiseSideOrientation
        ? Material.CounterClockWiseSideOrientation
        : Material.ClockWiseSideOrientation;
  }
  // The captured matrix already contains the complete GLB hierarchy.
  // Thin-instance matrices are world matrices, so the master itself must
  // be identity or its hierarchy transform would be applied a second time.
  mesh.parent = null;
  mesh.position.setAll(0);
  mesh.rotation.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.scaling.setAll(1);
  mesh.setPivotMatrix(Matrix.Identity());
  mesh.computeWorldMatrix(true);
  mesh.setEnabled(false);
  // ── Frustum-Culling BLEIBT AN (D10) ─────────────────────────────────
  // Hier stand `alwaysSelectAsActiveMesh = true`. Die Begründung dafür war
  // plausibel und ist es nicht mehr: Ein Master steht im Ursprung, seine
  // Instanzen stehen über das ganze Streaming-Gebiet verteilt — ein
  // Hüllkörper, der nur den Master selbst umfasst, würde jeden Master
  // wegwerfen, sobald der Weltursprung aus dem Bild ist.
  //
  // Babylon führt den Hüllkörper aber längst über ALLE Thin Instances
  // nach: `thinInstanceSetBuffer('matrix', …)` ruft am Ende selbst
  // `thinInstanceRefreshBoundingInfo(false)` auf, solange
  // `doNotSyncBoundingInfo` aus ist (node_modules/@babylonjs/core/
  // Meshes/thinInstanceMesh.js:103). Der Kasten umschliesst dort jede
  // Instanz über die acht Ecken des Basis-Hüllkörpers — genau die
  // konservative Box, die dieses Flag ersetzen sollte. Sie wird also
  // ohnehin JEDES Mal berechnet; das Flag hat sie nur nicht benutzt.
  //
  // Was das bringt (statisch ausgezählt, nicht gemessen): Für die
  // gestreute Vegetation NICHTS — ihre Instanzen reichen bis an den Rand
  // des ZDO-Interessenradius, die Box enthält damit die Kamera und
  // besteht jede Frustumprüfung. Es zahlt sich bei den ORTSFESTEN
  // Prefabs aus, und das sind ausgerechnet die master-reichsten: Der
  // Grabhügel allein stellt 10 der rund 58 Master einer Grasland-Sitzung
  // (16 Submeshes, 10 Materialien) und steht als einzelnes Bauwerk in der
  // Landschaft. Liegt er hinter der Kamera, fallen 10 Zeichenaufrufe im
  // Bildpass weg und, über die Entfernungsprüfung in Shadows.darfWerfen(),
  // 10 × Kaskadenzahl im Schattenpass.
  //
  // Die Reserve gegen die Windbiegung setzt EntityManager
  // .huellkoerperAufweiten() nach jedem Puffer-Schreiben — der Shader
  // verschiebt Blattscheitel über den Kasten hinaus, den die Rohgeometrie
  // aufspannt.
  return { mesh, localMatrix };
}

/**
 * Materialien, die im Original wirklich metallisch sind.
 *
 * Abgeleitet aus den 158 Materialien mit `_Metallic >= 0.9` in
 * `Valheim_Client/extracted_assets/Material/` — das sind Erzadern
 * (`silverore`, `rock_silver_internal`), Metallwaffen und -rüstungen
 * (`blackmetalsword`, `BronzeArmorMesh_Mat`, `SilverShield_Mat`), Schmiede
 * und Kochgerät (`Forge_mat`, `MeadCauldron_MAT`, `Vise_mat`) sowie
 * Kristall und Marmor der Dvergr-Bauten.
 *
 * Die Muster sind bewusst eng gehalten. Ein zu breiter Ausdruck trifft
 * Vegetation und macht sie wieder schwarz — `bar` etwa steckt in `bark`
 * und `barrel`, `ore` in `forest`, `tin` in `painting`. Zinn und Erz
 * laufen deshalb über ihre vollen Namen statt über Wortfragmente.
 */
/**
 * Gestein — hat Vorrang vor METALLISCH (siehe setzeMetallgrad).
 *
 * Erzbrocken tragen den Metallnamen im Material (`rock1_copper`), sind
 * aber Fels mit Einschlüssen. Ohne Metallic-Map würde der Faktor 1 die
 * ganze Oberfläche metallisch machen.
 */
const FELSIG = /rock|stone|cliff/i;

const METALLISCH =
  /metal|iron|bronze|silver|copper|flametal|anvil|forge|cauldron|coin|crystal|sword|axe|mace|atgeir|arbalest|shield|armor|helm|chitin|marble|obsidian|silverore|copperore|tinore/i;

/**
 * Ist das ein echtes Laub-/Pflanzenmaterial?
 *
 * Ausgeschlossen wird, was erkennbar Fels, Gestein oder eine
 * Rauheitskarte ist — dort steckt im Alpha-Kanal eine Materialmaske,
 * keine Freistellung. Alles andere darf den Cutout bekommen; die
 * Alpha-Messung davor filtert bereits die klaren Fälle heraus.
 */
function isFoliageMaterial(name: string): boolean {
  return !/roughness|rock|stone|cliff|marble|metal|_wood$|bark/i.test(name);
}

/**
 * Darf sich dieses Modell im Wind biegen?
 *
 * Gebautes bleibt starr — im Original tragen nur Vegetationsmaterialien
 * die Sway-Parameter (_SwayDistance und _SwaySpeed, siehe
 * extracted_assets/Material). Bauteile heissen durchgehend "wood_...",
 * "stone_..." oder "iron_...", Vegetation trägt Artnamen. Der Prefab-Name
 * ist der verlässlichste Anhaltspunkt, den wir zur Ladezeit haben.
 */
function swaysInWind(modelName: string): boolean {
  return !/^(wood|stone|iron|piece|goblin|dvergr|darkwood|blackmarble|ashwood|charred|guard|portal|turf|straw|thatch|roof|wall|floor|beam|pole|stair|fence|door|ladder|chest|bed|chair|table|bench|banner|sign|cart|ship|raft|karve|longship|rock|cliff|mine|silvervein|ice|giant|grave|stubbe)/i.test(
    modelName
  );
}

/** Downscaled RGBA readback of a texture (alpha-channel probe). */
async function readAlphaSample(tex: Texture): Promise<Uint8Array | null> {
  const size = tex.getSize();
  if (!size.width || !size.height) return null;
  const data = await tex.readPixels();
  return data ? new Uint8Array(data.buffer) : null;
}

/** All renderable meshes of an instantiated hierarchy (root included). */
/**
 * All renderable meshes below the given roots.
 *
 * Collects AbstractMesh, not Mesh: instantiateModelsToScene() materializes
 * geometry as InstancedMesh whenever it can, and those are NOT instanceof
 * Mesh. Filtering on Mesh made instantiate() report "no visible geometry" for
 * perfectly good models — e.g. Hoe.glb, whose blade and handle both come back
 * as InstancedMesh — so it returned null and callers fell back to a
 * placeholder box.
 *
 * setEnabled / isPickable / material / getTotalVertices all work the same on
 * InstancedMesh, so the callers need no further change.
 */
function collectMeshes(rootNodes: import('@babylonjs/core/node').Node[]): AbstractMesh[] {
  const out: AbstractMesh[] = [];
  for (const node of rootNodes) {
    if (node instanceof AbstractMesh) out.push(node);
    if (node instanceof TransformNode) {
      for (const child of node.getChildMeshes()) out.push(child);
    }
  }
  return out;
}
