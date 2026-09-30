/**
 * EntityManager (Phase 2) — maps ZDO updates to the scene.
 *
 * Static ZDOs (trees, rocks, building pieces, …) become THIN INSTANCES in
 * per-prefab buckets (the only sane way to render this much vegetation
 * density — see Docs/03 §4). Dynamic ZDOs (creatures, item drops, ships,
 * other players) become instantiated hierarchies with per-entity
 * transforms. LocationProxy ZDOs carry the feature hash for terrain
 * leveling (Unity TerrainModifier parity) and stay invisible.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ARMOR_SLOTS, decodeArmor, appearancePath, hiddenAppearanceForFiles, APPEARANCE_ATTACHMENTS } from '@wov/shared';
import { updateArmorVisibility, verifyArmorSkin, prepareLegacyFemaleBody, armorFileForSkeleton } from '../player/armorVisibility.js';
import { stabilizeHeadSkin } from '../player/headSkin.js';
import { TOD_CLIPS, canWearArmor, parseEinmal } from '@wov/shared';

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import type { Scene } from '@babylonjs/core/scene';
import {
  PrefabFlag,
  findPrefabByHash,
  isRenderable,
  getFeatureByHash,
  getRoomByHash,
  getStableHash,
  getTerrainLeveling,
  FOLIAGE_HASHES,
  lebenAnteil,
  modellZu,
  AUSSEHEN_ORDNER,
  frisurZu,
  bartAusFrisur,
  augenbraueAusFrisur,
  haarfarbeZu,
  ruestungZu,
  istFrisur,
  // ── Kollision: alles aus `shared`, nichts mehr von hier ─────────────
  // `istFesterKoerperImSpiel` sagt (inkl. Upload-Wahl), WELCHES Prefab einen Koerper bekommt,
  // `kollisionsForm` WELCHE Form, `BEGEHBAR_NAME`, welches Bauwerk das
  // Flag-Gatter umgehen darf, `formUebersteuerung`, welche Handvoll
  // Prefabs ihre Form von Hand bekommt (die grossen Buesche), und
  // `storeKollision`, was der Speicher selbst ueber seine Kollision
  // sagt. Alle liest der Server ebenfalls — daran haengt, dass Bild und
  // Serverrechnung dieselben Hindernisse sehen.
  kollisionsModellPfad,
  storeKollision,
} from '@wov/shared';
import type { NpcEinordnung, SteinKitConfig } from '@wov/shared';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { weiseSteinMaterialZu, setzeDokumentSteinKit, holeSteinMaterial } from './steinMaterial';
import { faerbeHaar } from '../player/haarfarbe.js';
import { faerbeAugen } from '../player/augenfarbe.js';
import { StaticColliderSet } from '../engine/Physics';
import '../engine/Physics';

import {
  IMPOSTOR_GRENZE_M_VORGABE,
  SPRITE_STRIDE,
  teileZelle,
  yawUndSkala,
  zellLage,
} from '../engine/BaumImpostorKern';
// TYP-Import, damit hier kein Laufzeit-Zyklus entsteht: BaumImpostor.ts
// holt sich aus dieser Datei huellkoerperAufweiten() und
// zellMeshAusPrototyp() (die abgesegneten Bauwege), und ein Typ-Import
// wird beim Uebersetzen restlos entfernt. Ausserdem bleibt der statische
// Pfad damit ohne Szene konstruierbar (client/test/entity-index.ts baut
// `new EntityManager(null, …)`).
import type { BaumImpostor } from '../engine/BaumImpostor';
import type { AssetManager } from '../engine/AssetManager';
import type { TerrainManager } from '../engine/Terrain';
import {
  markiereAlsGestreuteLandschaft,
} from '../engine/RefraktionsAuswahl';
import type { ClientWorld } from '../world/World';
import type { ZDOEntityUpdate } from '../net/ZDOSync';
import { clipRate } from './clipTempo';
import { pausiereFuerMessung } from './gruppenSicherung';
import { ANIMATIONS_LOD_GRENZE_M, sollAnimieren, wendeAnimationsLodAn } from './animationsLod';
import {
  DYNAMIC_FLAGS,
  f32,
  COLLIDER_RANGE,
  REBUILD_BUDGET_MS,
  COLLIDER_REBUILD_STEP,
  VEGETATIONS_NEUPACK_M,
  vegetationsMatrizenImRadius,
  zellenSchluessel,
  RENDER_ZELLE_M,
  ZELL_MAX_INSTANZEN,
  ZELL_SCHNITT_AB,
  SPRITE_NEUPACK_M,
  ZELL_POOL_DECKEL,
} from './konstanten';
import { bucketSchluessel, leseSteinKitOverride } from './typen';
import type {
  StatischeInstanz,
  IndexEintrag,
  StaticBucket,
  DynamischeInstanz,
  Vector3Like,
  DynamicEntity,
} from './typen';
import {
  GANG_NICK_TMP,
  ANIMATIONS_LOD_MIN_RADIUS_M,
  LOD_MITTE_TMP,
  berechneLodHuelle,
  istKugelImSichtkegel,
} from './lod';
import { INSTANZ_TOENUNG_AN, darfGetoentWerden, schreibeToenung } from './toenung';
import {
  schreibeInstanzen,
  alsOrtsfestEinfrieren,
  zellMeshAusPrototyp,
} from './zellMesh';
import { composeZdoWorld } from './zdoMatrix';
import { makePlaceholder } from './platzhalter';
import { nearbyInstances, indexSetzen, ausZelleLoesen, indexEntfernen } from './raumIndex';
import { enablePhysics, rebuildBucketColliders } from './kollisionsEimer';
// Re-exports: these names moved into the modules next to this file; importers keep their path.
export { vegetationsMatrizenImRadius } from './konstanten';
export type { StatischeInstanz, DynamischeInstanz } from './typen';
export { huellkoerperAufweiten } from './lod';
export {
  INSTANZ_TOENUNG_AN,
  TOENUNG_LUMA,
  TOENUNG_TON,
  toenungsRauschen,
  instanzToenung,
} from './toenung';
export {
  groessteInstanzSkala,
  gemesseneModellHoehe,
  alsOrtsfestEinfrieren,
  zellMeshAusPrototyp,
} from './zellMesh';


/** Is `anim` the lying pose of a dead player figure? */
const istTodAnim = (anim: string | undefined): anim is string => anim !== undefined && (TOD_CLIPS as readonly string[]).includes(anim);
export class EntityManager {
  readonly buckets = new Map<string, StaticBucket>();
  /**
   * Bewusster Qualitätstausch des gemessenen 100-FPS-Profils.
   *
   * Normale und `*Dick`-Bäume bleiben getrennte ZDOs und Collider. Nur
   * ihre Renderinstanzen landen gemeinsam auf der normalen Geometrie —
   * dadurch entfällt je Familie ein Master in Bild- und Schattenpässen.
   */
  private hundertFpsProfil = false;
  /** 0 = das gesamte geladene Streaming-Fenster (bisheriger Stand). */
  private vegetationsGrenzeM = 0;
  private vegetationsMitteX = 0;
  private vegetationsMitteZ = 0;
  private vegetationsMitteBekannt = false;
  /** zdoKey → Bucket-Schlüssel (s. {@link bucketSchluessel}). */
  private readonly bucketOf = new Map<string, string>();
  private readonly dynamics = new Map<string, DynamicEntity>();
  /**
   * Einordnung der NPC-Instanzen (Namensschild), Schlüssel wie bei den
   * ZDOs. Bewusst NEBEN `dynamics` und nicht darin: Die Angaben kommen von
   * woanders her (Layout-Dokument statt ZDO-Transform), und eine statische
   * Platzierung dürfte sie genauso tragen. Position und Höhe holt sich das
   * Schild aus `dynamischeInstanzen()` — die ändern sich pro Frame, die
   * Einordnung nie.
   */
  private readonly npcs = new Map<string, NpcEinordnung>();
  /**
   * Auflösung `layoutId` → Einordnung. Setzt main.ts, sobald das
   * Weltdokument da ist; ohne Layout-Welt bleibt sie null und der ganze
   * NPC-Pfad kostet nichts.
   */
  private npcQuelle: ((layoutId: string) => NpcEinordnung | null) | null = null;
  private readonly appliedLocations = new Set<string>();
  /**
   * Bucket-Schlüssel, deren Master gerade geladen werden bzw. schon geladen
   * sind. Je BUCKET und nicht je Prefabhash: Ein Override-Bucket braucht
   * eigene Master, auch wenn der Prefab längst geladen ist.
   * Bucket keys whose render prep is already in flight.
   */
  private readonly pending = new Set<string>();
  /**
   * Räumlicher Index der statischen Instanzen: Zellenschlüssel → Einträge.
   *
   * ── Warum überhaupt ──────────────────────────────────────────────
   * `nearbyInstances()` lief vorher linear über JEDEN Bucket und JEDE
   * Instanz darin — bei rund 9.900 ZDOs also knapp 10.000 Durchläufe, und
   * das je Frame gleich zweimal (Fadenkreuz und Namensschilder), plus die
   * Minimap. Gesucht wurde dabei ein Umkreis von 5 bis 70 m; der Rest der
   * Welt wurde nur angefasst, um ihn zu verwerfen. Schlimmer noch: Es
   * skaliert mit dem Inhalt der Welt und mit allem, was Spieler bauen.
   *
   * Der Index dreht das um: Nur die Zellen, die der Suchkreis berührt,
   * werden angefasst. Aus O(alle Instanzen) wird O(Instanzen in der
   * Nachbarschaft).
   *
   * Die Einträge halten die Position SELBST und nicht einen Verweis auf
   * `bucket.matrices`, weil die Matrixindizes beim Löschen per Swap-Remove
   * wandern — ein Index auf eine wandernde Stelle wäre der klassische
   * Weg, still auf die falsche Instanz zu zeigen.
   */
  readonly zellen = new Map<number, IndexEintrag[]>();
  /** ZDO-Schlüssel → Indexeintrag. Nur statische ZDOs stehen hier. */
  readonly indexVon = new Map<string, IndexEintrag>();

  constructor(
    readonly scene: Scene,
    private readonly world: ClientWorld,
    private readonly assets: AssetManager,
    private readonly terrain: TerrainManager
  ) {}

  /** Stats for the HUD. */
  staticCount = 0;
  dynamicCount = 0;
  nearbyInstances(
    x: number,
    z: number,
    radius: number,
    aus: StatischeInstanz[] = []
  ): StatischeInstanz[] {
    return nearbyInstances(this, x, z, radius, aus);
  }

  // ── Räumlicher Index der statischen Instanzen ────────────────────
  private indexSetzen(key: string, prefab: string, x: number, y: number, z: number): void {
    return indexSetzen(this, key, prefab, x, y, z);
  }
  ausZelleLoesen(e: IndexEintrag): void {
    return ausZelleLoesen(this, e);
  }
  private indexEntfernen(key: string): void {
    return indexEntfernen(this, key);
  }

  /** Diagnose: Anzahl indizierter Instanzen und belegter Zellen. */
  get indexStats(): { instanzen: number; zellen: number } {
    return { instanzen: this.indexVon.size, zellen: this.zellen.size };
  }

  /**
   * Alle dynamischen Instanzen (Kreaturen, NPCs, fremde Spieler) mit ihrer
   * aktuellen Pose — Futter für die Namensschilder.
   *
   * Schreibt in eine vom Aufrufer GEHALTENE Liste und liefert die Anzahl
   * zurück, statt ein Array anzulegen: Das hier läuft in jedem Frame, und
   * ein frisches Array je Frame ist genau die Sorte Müll, die den GC in
   * regelmässigen Abständen für ein paar Millisekunden anhält.
   *
   * `skalierungY` ist die WELTSKALIERUNG der Instanz (localScale des
   * Prefabs mal ZDO-Skalierung, siehe applyDynamic) — mit ihr lässt sich
   * die Modellhöhe aus dem Prefab auf dieses Exemplar umrechnen.
   */
  dynamischeInstanzen(out: DynamischeInstanz[]): number {
    let n = 0;
    for (const [key, dyn] of this.dynamics) {
      let e = out[n];
      if (!e) {
        e = { key: '', prefab: '', x: 0, y: 0, z: 0, skalierungY: 1, leben: -1 };
        out.push(e);
      }
      const p = dyn.root.position;
      e.key = key;
      e.prefab = dyn.root.name;
      e.x = p.x;
      e.y = p.y;
      e.z = p.z;
      e.skalierungY = dyn.root.scaling.y;
      e.leben = dyn.leben ?? -1;
      n++;
    }
    return n;
  }

  /**
   * World positions of the active collision bodies. Diagnosis only — lets a
   * test walk deliberately into one instead of hoping to hit something.
   */
  colliderPositions(): Array<{ prefab: string; x: number; z: number }> {
    const out: Array<{ prefab: string; x: number; z: number }> = [];
    for (const [prefab, e] of this.colliders) {
      const buf = e.carrier.thinInstanceGetWorldMatrices();
      for (const m of buf) out.push({ prefab, x: m.m[12]!, z: m.m[14]! });
    }
    return out;
  }

  /** Active collision bodies and prefabs we could not derive a shape for. */
  get colliderStats(): { bodies: number; havok: number; prefabs: number; ohneForm: number } {
    let bodies = 0;
    let havok = 0;
    for (const e of this.colliders.values()) {
      bodies += e.set.count;
      havok += e.set.bodyInstances;
    }
    return { bodies, havok, prefabs: this.colliders.size, ohneForm: this.colliderless.size };
  }

  /**
   * Woher die NPC-Einordnung einer Online-Instanz kommt (s. npcQuelle).
   * Einmal je Welt gesetzt — die Zuordnung ist statisch.
   */
  setzeNpcQuelle(quelle: ((layoutId: string) => NpcEinordnung | null) | null): void {
    this.npcQuelle = quelle;
  }

  /**
   * Einordnung EINER Instanz (null = kein NPC oder nicht aus dem Layout).
   *
   * Die Auskunft ist bewusst je Schlüssel und nicht als Umkreisliste: Wer
   * Schilder zeichnet, geht ohnehin über `dynamischeInstanzen()` und
   * braucht dann nur noch die Angaben zum bereits gefundenen Exemplar.
   */
  npcEinordnung(key: string): NpcEinordnung | null {
    return this.npcs.get(key) ?? null;
  }

  applyUpdate(u: ZDOEntityUpdate): void {
    if (u.isOwnPlayer) return; // our own character is the camera (Phase 4: avatar)

    // F4: terrain leveling under locations (Unity TerrainModifier parity)
    if (u.locationFeatureHash !== undefined && !this.appliedLocations.has(u.key)) {
      this.appliedLocations.add(u.key);
      this.applyLocationLeveling(u.locationFeatureHash, u.position);
      return; // LocationProxy itself is invisible (isRenderable false)
    }

    const def = findPrefabByHash(u.prefabHash);
    if (!def || !isRenderable(def)) return;

    // Einordnung mitführen: offline liegt sie am Update (Testflug), online
    // kommt sie über die Herkunft aus dem Layout-Dokument. Bewusst bei
    // JEDEM Update neu bestimmt statt einmal gemerkt — im Editor ändert
    // ein Feld die Einordnung, und der Eintrag wird mit demselben
    // Schlüssel neu gezeichnet. Zwei Map-Zugriffe sind billiger als eine
    // Sonderbehandlung für „Schild muss wieder verschwinden".
    const einordnung = u.npc ?? (u.layoutId ? (this.npcQuelle?.(u.layoutId) ?? null) : null);
    if (einordnung) {
      this.npcs.set(u.key, einordnung);
    } else {
      this.npcs.delete(u.key);
    }

    const isDynamic = (def.flags & DYNAMIC_FLAGS) !== 0n;
    if (isDynamic) {
      // Tiere/Monster ohne echten Clip bekommen den prozeduralen Gang;
      // Player/NPC bringen Animationsgruppen mit und bleiben davon frei.
      const belebt =
        (def.flags & (PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI)) !== 0n && !def.animation;
      // Fremde SPIELER tragen ihre gewaehlte Figur als ZDO-Member; sie
      // schlaegt das Vorgabemodell des Prefabs. Ohne das saehe man jeden
      // anderen als `npc_1_walk` — das Modell, das am Player-Prefab
      // haengt und mit der eigenen Figur nie etwas zu tun hatte. Wer
      // seine Wahl im Spiel aendert, aendert denselben Member, und der
      // Sync traegt sie hierher.
      const modell = u.figur ? modellZu(u.figur) : def.model;
      void this.applyDynamic(u, def.name, modell, def.animation, belebt).then(() => {
        if (u.augenfarbe !== undefined) {
          const dyn = this.dynamics.get(u.key);
          if (dyn && dyn.augenfarbe !== u.augenfarbe) {
            faerbeAugen(dyn.root.getChildMeshes(), u.augenfarbe);
            dyn.augenfarbe = u.augenfarbe;
          }
        }
        // Frisur und Ruestung NACH dem Koerper: Sie brauchen dessen
        // Skelett. Fehlt der Member, traegt der Spieler nichts — kein
        // Rueckfall auf eine Vorgabefrisur, sonst saehe man bei jedem
        // Fremden etwas anderes als er selbst.
        if (u.frisur !== undefined || u.ruestung !== undefined || u.haarfarbe !== undefined) {
          void this.setzeFremdesAussehen(u, modell);
        }
      });
    } else {
      this.applyStatic(u, def.name, def.model);
    }
  }

  /**
   * Frisur und Ruestung eines FREMDEN Spielers anlegen.
   *
   * Die Teile liegen als eigene Dateien neben dem Koerper und werden
   * einzeln geladen — dieselbe Aufteilung wie beim eigenen Avatar.
   *
   * Jedes Teil bringt sein eigenes Skelett mit; benutzt wird das des
   * KOERPERS, sonst stuende die Frisur in der Bindepose, waehrend der
   * Fremde laeuft. Zulaessig nur, weil alle Teildateien dieselbe
   * Gelenkliste tragen (tools/asset-aufteilen.py prueft das nach).
   *
   * Der `__root__`-Knoten des Teils bleibt in der Kette: Er traegt die
   * Haendigkeitsumrechnung von glTF nach Babylon. Haengt man die Netze
   * direkt um, sitzt das Teil gespiegelt — genau dieser Fehler ist beim
   * eigenen Avatar schon einmal passiert.
   */
  private readonly armorRequests = new WeakMap<TransformNode, object>();
  private async setzeFremdesAussehen(u: ZDOEntityUpdate, modell: string | null): Promise<void> {
    const dyn = this.dynamics.get(u.key);
    if (!dyn) return;
    // Nur die beiden spielbaren Körper kennen die modularen Aussehensteile;
    // die zusätzliche Geometrie-Kompatibilität wird je Slot geprüft.
    if (u.figur && !/^(wikinger\/|wikingerin\/)/.test(modellZu(u.figur))) return;
    dyn.aussehen ??= new Map();
    const request = {};
    this.armorRequests.set(dyn.root, request);
    const refresh = (): void => {
      const files = [...dyn.aussehen!.values()]
        .filter(v => v.wurzel.getChildMeshes().some(mesh => mesh.getTotalVertices() > 0))
        .map(v => v.datei);
      updateArmorVisibility(dyn.root.getChildMeshes(), files);
      const hidden = hiddenAppearanceForFiles(files);
      for (const [slot, feature] of Object.entries(APPEARANCE_ATTACHMENTS)) {
        dyn.aussehen!.get(slot)?.wurzel.setEnabled(!hidden.has(feature));
      }
    };

    // Skelett des Koerpers suchen — an ihm haengen alle Teile.
    let skelett = null as import('@babylonjs/core/Bones/skeleton').Skeleton | null;
    for (const m of dyn.root.getChildMeshes()) {
      if (m.skeleton) { skelett = m.skeleton; break; }
    }
    if (!skelett) return;

    const parts = decodeArmor(u.ruestung ?? '|');
    const gewuenscht: Record<string, string | null> = {
      // Nur der H_01-Alt-Export passt nicht zum neuen Wikingerkopf.
      frisur: u.frisur && istFrisur(u.frisur)
        && !(modell?.startsWith('wikinger/') && frisurZu(u.frisur).id === 'H_01')
        ? `${AUSSEHEN_ORDNER}/${frisurZu(u.frisur).datei}` : null,
      bart: u.frisur && istFrisur(u.frisur) && bartAusFrisur(u.frisur)
        ? `${AUSSEHEN_ORDNER}/${bartAusFrisur(u.frisur)!.datei}` : null,
      augenbraue: u.frisur && istFrisur(u.frisur) && augenbraueAusFrisur(u.frisur)
        ? `${AUSSEHEN_ORDNER}/${augenbraueAusFrisur(u.frisur)!.datei}` : null,
      ...Object.fromEntries(ARMOR_SLOTS.map(s => {
        const p = ruestungZu(parts[s]);
        return [s, p && canWearArmor(p, u.figur) ? appearancePath(p.datei) : null];
      })),
    };
    const haarfarbe = haarfarbeZu(u.haarfarbe);
    const haarfarbeGeaendert = dyn.haarfarbe !== undefined && dyn.haarfarbe !== haarfarbe.id;
    dyn.haarfarbe = haarfarbe.id;

    for (const [slot, datei] of Object.entries(gewuenscht)) {
      const alt = dyn.aussehen.get(slot);
      if ((alt?.datei ?? null) === datei) {
        if (alt && haarfarbeGeaendert && (slot === 'frisur' || slot === 'bart' || slot === 'augenbraue')) {
          faerbeHaar(alt.wurzel.getChildMeshes(), haarfarbe.hex, true);
        }
        continue;
      }
      if (alt) {
        alt.wurzel.dispose(false, false);
        dyn.aussehen.delete(slot);
        refresh();
      }
      if (!datei) continue;
      const wurzel = await this.assets.instantiate(armorFileForSkeleton(datei, skelett));
      if (!wurzel) continue;
      if (dyn.root.isDisposed() || this.armorRequests.get(dyn.root) !== request) { wurzel.dispose(); return; }
      try { verifyArmorSkin(skelett, wurzel.getChildMeshes().find(m => m.skeleton)?.skeleton ?? null, datei); }
      catch (error) { wurzel.dispose(); console.warn(error); continue; }
      // Das Rennen um denselben Slot verlieren: Ein zweites Update kann
      // waehrend des Ladens dasselbe getan haben.
      if (!this.dynamics.has(u.key) || dyn.aussehen.has(slot)) {
        wurzel.dispose(false, false);
        continue;
      }
      wurzel.parent = dyn.root;
      wurzel.position.setAll(0);
      wurzel.rotationQuaternion = null;
      wurzel.rotation.setAll(0);
      wurzel.scaling.setAll(1);
      const netze = wurzel.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
      for (const m of netze) {
        m.skeleton = skelett;
        m.isPickable = false;
      }
      if (slot === 'frisur') stabilizeHeadSkin(dyn.root.getChildMeshes(), netze);
      // MIT Klon: Diese Netze stammen aus dem Container-Cache, und
      // `instantiateModelsToScene` teilt Materialien zwischen allen
      // Instanzen. Ohne Klon faerbte der erste Spieler mit dieser
      // Frisur alle anderen mit (s. haarfarbe.ts).
      if (slot === 'frisur' || slot === 'bart' || slot === 'augenbraue') {
        faerbeHaar(netze, haarfarbe.hex, true);
      }
      dyn.aussehen.set(slot, { datei, wurzel });
      refresh();
    }
  }

  /**
   * Eine statische Instanz aus ihrem Bucket nehmen (Swap-Remove auf dem
   * Matrixpuffer).
   *
   * Eigene Methode, seit ein ZDO den Bucket WECHSELN kann: Mit dem
   * Raum-Steinmaterial gehört ein Raum je nach Override in einen anderen
   * Bucket, und ein Wechsel ohne dieses Ausräumen liesse dieselbe Instanz in
   * beiden stehen — sichtbar als doppelte Wand, unsichtbar als doppelter
   * Kollisionskörper.
   * Extracted because a ZDO can now MOVE between buckets (per-room stone
   * material); leaving it in the old one would draw it twice.
   */
  private ausBucketEntfernen(key: string): void {
    const bucketKey = this.bucketOf.get(key);
    if (bucketKey === undefined) return;
    const bucket = this.buckets.get(bucketKey);
    const idx = bucket?.indexOf.get(key);
    if (bucket && idx !== undefined) {
      // swap-remove the matrix
      const last = bucket.matrices.length / 16 - 1;
      if (idx !== last) {
        bucket.matrices.copyWithin(idx * 16, last * 16, last * 16 + 16);
        for (const [k, v] of bucket.indexOf) {
          if (v === last) {
            bucket.indexOf.set(k, idx);
            break;
          }
        }
      }
      bucket.matrices.length = last * 16;
      bucket.indexOf.delete(key);
      bucket.dirty = true;
      this.staticCount--;
    }
    this.bucketOf.delete(key);
  }

  removeZDO(key: string): void {
    this.npcs.delete(key);
    // Vor dem Bucket-Abbau: Der Index steht unabhängig davon, ob der Bucket
    // die Instanz noch kennt — ein Eintrag, der ihn überlebt, wäre ein
    // Geisterobjekt unter dem Fadenkreuz.
    this.indexEntfernen(key);
    this.ausBucketEntfernen(key);
    const dyn = this.dynamics.get(key);
    if (dyn) {
      this.assets.entsorgeAnimationen(dyn.root);
      // NUR die Instanz abräumen — NIEMALS Material und Texturen.
      //
      // `dispose(_, true)` sah nach gründlichem Aufräumen aus und war in
      // Wahrheit die Ursache für „die Völva hat keine Texturen":
      // AssetManager.instantiate ruft instantiateModelsToScene mit
      // cloneMaterials = FALSE — alle Instanzen eines Prefabs teilen sich
      // also EIN PBRMaterial samt seiner Texturen, und das gehört dem
      // gecachten AssetContainer, nicht dieser Instanz.
      //
      // Babylon macht daraus (abstractMesh.dispose → material.dispose(
      // false, true) → pbrBaseMaterial.dispose) zweierlei: Es entsorgt
      // albedo-/metallic-/bump-Textur, UND es läuft über scene.meshes und
      // setzt `mesh.material = null`, wo dasselbe Material hing. Ein
      // einziges entferntes Exemplar zieht damit allen übrigen — und
      // jedem später erzeugten, weil der Container gecacht bleibt — das
      // Material unter den Füßen weg; sie rendern ab da mit Babylons
      // Standardmaterial, also weiß und ohne Textur.
      //
      // Aufgefallen an der Völva, weil im Spawn-Editor ständig eine
      // Instanz verschwindet: Der Vorschau-Geist (`edghost`) wird bei
      // jedem Setzen, jedem Prefab-Wechsel und jedem Rechtsklick
      // entfernt, und alleNeuZeichnen wirft nach dem Löschen alle
      // `edplace-*` weg. Es trifft aber jedes dynamische Prefab, auch
      // despawnende Kreaturen.
      //
      // Nichts leckt dadurch: Material und Texturen hängen ohnehin am
      // Container, den `AssetManager.containers` absichtlich für die
      // ganze Sitzung hält.
      dyn.root.dispose(false, false);
      this.dynamics.delete(key);
      this.dynamicCount--;
    }
  }

  /**
   * Geänderte Thin-Instance-Puffer neu aufbauen (einmal pro Frame).
   *
   * ── Warum hier ein Budget steht ──────────────────────────────────
   * Ein Neuaufbau ist teuer: Für jedes Sub-Mesh des Prefabs wird ein
   * frischer Float32Array über ALLE Instanzen angelegt und jede Matrix
   * neu multipliziert, danach laufen die Havok-Körper nach. Ein einziges
   * geändertes ZDO markiert dabei den ganzen Bucket — bei einem Prefab
   * mit hunderten Instanzen also hunderte Multiplikationen wegen eines
   * einzelnen Objekts.
   *
   * Ohne Budget passierte das für alle geänderten Buckets IM SELBEN
   * FRAME, und zwar im Takt der Server-Updates. Gemessen am 2026-07-29
   * im Regen: Der Median lag bei 17,1 ms (also 60 fps), aber 30 % der
   * Frames brauchten über 25 ms — im Abstand von exakt 3–4 Frames, das
   * sind die 20 Hz der Netzwerkschleife. Über 8,7 s gingen so 2013 ms
   * verloren; daraus entstand die gemeldete "43 fps", obwohl das Bild
   * die meiste Zeit mit voller Rate lief.
   *
   * Das Budget macht aus einem grossen Ruckler mehrere unsichtbare
   * kleine. Die Buckets bleiben als geändert markiert und kommen in den
   * Folgeframes dran — es geht nichts verloren, es dauert nur länger.
   *
   * ── Grenze des Budgets seit dem Zellschnitt (E19 c) ──────────────
   * Abgebrochen wird zwischen BUCKETS, nicht innerhalb. Ein
   * geschnittener Vegetations-Bucket packt jetzt in EINEM Zug seine
   * sämtlichen Zellen; die Rechenarbeit ist dieselbe wie vorher (gleich
   * viele Matrixmultiplikationen), hinzu kommen mehrere kleine
   * GPU-Uploads statt eines grossen. Die Regel „mindestens ein Element
   * pro Frame" (verarbeitet > 0) gilt weiterhin, sonst friert der Aufbau
   * unter Dauerlast ein. Eine Taktung auf ZELLEN-Ebene samt
   * `dirtyZellen`-Merker je Bucket ist die zweite Ausbaustufe — erst
   * messen, dann bauen (s. Roadmap E19/E20).
   */
  flush(): void {
    const budgetEnde = performance.now() + REBUILD_BUDGET_MS;
    let verarbeitet = 0;
    for (const bucket of this.buckets.values()) {
      if (!bucket.mastersReady || (!bucket.dirty && !bucket.colliderDirty)) continue;
      if (verarbeitet > 0 && performance.now() >= budgetEnde) break;
      if (bucket.dirty) {
        // Renderdaten UND Collider betroffen (ZDO-Änderung) — voller Umbau.
        bucket.dirty = false;
        bucket.colliderDirty = false;
        this.rebuildBucketInstances(bucket);
      } else {
        // Nur das Kollisionsfenster ist weitergerückt (Spieler bewegt sich)
        // — die Thin-Instance-Renderpuffer sind unverändert und brauchen
        // keinen Neuaufbau samt GPU-Upload. rebuildBucketCollidersOnly()
        // filtert intern ohnehin per Signatur: ändert sich die Nah-Auswahl
        // gar nicht, passiert danach nichts weiter.
        bucket.colliderDirty = false;
        this.rebuildBucketCollidersOnly(bucket);
      }
      verarbeitet++;
    }
    // ── Sprite-Zellen EINMAL am Ende zusammensetzen ─────────────────
    // Ein Sprite-Zellmesh traegt die Beitraege MEHRERER Buckets (ein
    // Zeichenaufruf je Zelle statt einer je Zelle x Prefab — das IST der
    // Hebel). Die Schleife oben arbeitet prefabweise; wuerde die Zelle
    // dort bei jedem Bucket neu zusammengesetzt, liefe derselbe Puffer
    // mehrfach pro Bild ueber den Bus. Genau diese Sorte GPU-Verkehr ist
    // in SchattenInstanzKeulung.ts mit 18 -> 59 ms vermessen.
    //
    // Ausserhalb des Budgets: Zusammengesetzt wird nur, was in DIESEM
    // Durchlauf schmutzig wurde — abgebrochene Buckets bleiben dirty und
    // liefern ihre Beitraege im Folgeframe nach.
    this.impostoren?.baueZellen();
  }

  // ── Static (thin instances) ──────────────────────────────────────

  /**
   * PROTOTYPEN je Prefab, ein Eintrag je verschmolzenem Submesh.
   *
   * Seit dem Zellschnitt (E19 c) sind sie zweierlei: Für kleine Buckets
   * (bis ZELL_SCHNITT_AB Instanzen) tragen sie ihre Instanzen weiterhin
   * SELBST — das ist der unveränderte Weg von D10. Für geschnittene
   * Buckets sind sie reine Vorlage: dauerhaft abgeschaltet, ohne
   * Matrixpuffer, Quelle für die Zellgeometrie UND weiterhin Quelle der
   * Kollisionsform (rebuildBucketColliders liest getTotalIndices und
   * baut buildMeshCollider/deriveCollider aus genau diesen beiden Maps —
   * der Kollisionspfad bleibt prefabweise und merkt vom Schnitt nichts).
   */
  masterMeshes = new Map<string, import('@babylonjs/core/Meshes/mesh').Mesh[]>();
  masterLocals = new Map<string, Matrix[]>();
  /**
   * Die REINEN KOLLISIONSNETZE je masterKey (`_col`-Meshes der GLB, s.
   * AssetManager-Kopf) — bewusst NEBEN `masterMeshes`, nicht darin.
   *
   * Sie stehen damit vollständig ausserhalb des Renderwegs: kein
   * Thin-Instance-Puffer, kein Zellschnitt, kein Steinmaterial, kein
   * Klon für Override-Buckets. Das ist kein Sparen, sondern die
   * einzige Stelle, an der es überhaupt richtig sein kann — Babylon
   * hängt die Instanzpuffer an die GEOMETRY (s. prepareMasters), zwei
   * Buckets desselben Prefabs dürften sich also kein instanziertes Mesh
   * teilen. Kollision braucht die Instanzen gar nicht:
   * `buildMeshCollider()` liest nur Positionen, Indizes und `local`,
   * und die Weltlagen kommen ohnehin aus den ZDO-Matrizen.
   */
  kollisionsMasters = new Map<string, import('@babylonjs/core/Meshes/mesh').Mesh[]>();
  kollisionsLocals = new Map<string, Matrix[]>();
  /**
   * KI-Steinmaterialien der 1.0-Kits, gecacht je Konfiguration (Master leben die
   * ganze Sitzung, also EIN Material je Kit). Ein gemeinsames Material für alle
   * Kit-Teile heißt: die Verwitterungs-Masken leben in EINEM Weltraum und laufen
   * nahtlos über Teilgrenzen. Siehe `DungeonSteinMaterial.ts`.
   */
  steinMaterials = new Map<string, PBRMaterial>();
  /**
   * Die Steinteile je prefabHash — die Master, die `weiseSteinMaterialZu`
   * beim Dokumentwechsel ERNEUT bemalen muss.
   *
   * Eine eigene Karte, weil `masterMeshes` nach prefabName geht: Vom Namen
   * zurück auf den Hash käme man nur über eine Suche, und `prepareMasters`
   * läuft je Hash genau EINMAL pro Sitzung (nichts leert `pending`). Wer
   * das zweite Grab betritt, bekommt also keinen zweiten Ladevorgang — die
   * Master von eben sind alles, was es je geben wird.
   * Stone masters per prefabHash: `prepareMasters` runs exactly ONCE per
   * hash per session, so re-painting these is the only way a second
   * document can look different.
   */
  steinMasters = new Map<
    string,
    { bucket: StaticBucket; masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[] }
  >();
  /**
   * Das Steinmaterial des BETRETENEN Dokuments (1.0), sonst null. Liegt
   * über der Kit-Vorgabe und unter dem Raum-Override.
   */
  dokumentSteinKit: Partial<SteinKitConfig> | null = null;
  /**
   * Übergibt fertige Vegetations-Matrixpuffer an Shadows. Wert-Callback
   * statt Modulimport: EntityManager bleibt ohne Szene testbar und der
   * Schattenpfad kann die sichtbaren Puffer niemals selbst überschreiben.
   */
  private vegetationsSchattenEmpfaenger:
    | ((mesh: Mesh, matrizen: Float32Array | null) => void)
    | null = null;

  setVegetationsSchattenEmpfaenger(
    empfaenger: ((mesh: Mesh, matrizen: Float32Array | null) => void) | null
  ): void {
    this.vegetationsSchattenEmpfaenger = empfaenger;
    if (!empfaenger) return;
    // Registrierung geschieht normalerweise vor dem ersten Weltpaket.
    // Falls beim Wiederverbinden schon Master existieren, erzwingt dirty
    // einen vollständigen Replay statt einen still schattenlosen Bestand.
    for (const bucket of this.buckets.values()) {
      if (bucket.mastersReady && FOLIAGE_HASHES.has(bucket.prefabHash)) bucket.dirty = true;
    }
  }

  private meldeVegetationsSchatten(
    bucket: StaticBucket,
    mesh: Mesh,
    matrizen: Float32Array | null
  ): void {
    if (!FOLIAGE_HASHES.has(bucket.prefabHash)) return;
    this.vegetationsSchattenEmpfaenger?.(mesh, matrizen);
  }
  /**
   * Zell-Master der geschnittenen Buckets:
   * prefabName → Zellenschlüssel → [Prototyp-Index][Überlaufblock].
   */
  private readonly zellMaster = new Map<string, Map<number, Mesh[][]>>();
  /**
   * Abgeschaltete Zell-Master zur Wiederverwendung, je
   * `${prefabName}|${prototypIndex}`.
   *
   * ── Warum poolen statt entsorgen ─────────────────────────────────
   * Zwei Gründe. Erstens Kosten: Ein frischer Zell-Master lädt seine
   * ganze Geometrie neu auf die Grafikkarte; beim Laufen wandern Zellen
   * aber ständig aus dem Streaming-Fenster heraus und wieder herein.
   * Zweitens Sicherheit: `mesh.dispose()` räumt sich zwar selbst aus
   * `shadowMap.renderList` (abstractMesh.js:1768), NICHT aber aus dem
   * über mehrere Frames laufenden Werfer-Scan in Shadows.tick() — ein
   * dort noch gemerktes, inzwischen entsorgtes Mesh landete in der
   * nächsten renderList. Ein abgeschaltetes Mesh kostet dagegen nichts:
   * der Schattenpass überspringt es (objectRenderer.js:695), der
   * Bildpass ebenso.
   *
   * Wiederverwendet wird NUR innerhalb desselben (Prefab, Prototyp),
   * also auf identischer Geometrie. Über diese Grenze hinweg wäre es ein
   * stiller Fehler: Babylon cacht rawBoundingInfo und boundingVectors je
   * Mesh einmalig aus der Rohgeometrie (thinInstanceMesh.js:236-249) und
   * setzt sie beim Geometriewechsel nicht zurück — die Hülle wäre falsch,
   * der Werfer würde als Ganzes gekeult, und man sähe nur fehlende
   * Schatten.
   */
  private readonly zellPool = new Map<string, Mesh[]>();
  /**
   * Meldeweg fuer wiederverwendete Zell-Master, verdrahtet in main.ts mit
   * Shadows.meldeWerfer(). Noetig, weil onNewMeshAddedObservable nur bei
   * der Konstruktion feuert und der Pool bestehende Meshes wieder ausgibt
   * — ohne die Meldung fehlen nach Teleport + Stillstand die Schatten der
   * reaktivierten Zellen (Review-Fund E19 c, kritisch). Optional, damit
   * EntityManager keinen Import auf Shadows braucht.
   */
  onMasterBelebt: ((mesh: Mesh) => void) | null = null;
  /**
   * Das Sprite-Fernfeld. Optional und von aussen gesetzt (main.ts) —
   * derselbe Grund wie bei onMasterBelebt: Der EntityManager soll keinen
   * Wertimport auf ein Babylon-Modul brauchen, und der statische Pfad
   * muss ohne Szene konstruierbar bleiben (client/test/entity-index.ts).
   * Bleibt das Feld null, verhaelt sich alles wie vor diesem Umbau.
   */
  impostoren: BaumImpostor | null = null;
  /**
   * Uebergabegrenze in Metern. Wird von main.ts aus BaumImpostor.grenze
   * nachgefuehrt, damit der geplante Sweep zur Laufzeit greift, ohne dass
   * diese Datei das Modul importieren muss.
   */
  impostorGrenze = IMPOSTOR_GRENZE_M_VORGABE;
  /**
   * Mitte des Sprite-Fensters — die Position, gegen die die Zuteilung
   * echt/Sprite gerechnet wurde. Rueckt in Schritten von SPRITE_NEUPACK_M
   * nach, s. setPlayerPosition().
   */
  private spriteMitteX = 0;
  private spriteMitteZ = 0;
  /** Erst wenn die Spielerposition EINMAL angekommen ist, darf getauscht
   *  werden — s. die Begruendung in baueZellMaster(). */
  private spielerBekannt = false;
  /**
   * Gegenstueck fuer die Entsorgung: erst beim Schattensystem abmelden,
   * dann dispose. Verdrahtet in main.ts.
   *
   * `endgueltig` trennt die ZWEI Faelle, in denen `zellMeshFreigeben()`
   * diesen Rueckkanal zieht: `true` heisst „gleich kommt dispose()",
   * `false` heisst „geht abgeschaltet in den Pool und kommt ueber
   * onMasterBelebt zurueck". Der Empfaenger MUSS beides unterscheiden
   * koennen, weil an einem Master mehr haengen kann als Listeneintraege
   * — s. Shadows.vergissMaster(). Ein Parameter statt zweier Callbacks:
   * So kann keine der beiden Stellen den anderen Weg stillschweigend
   * uebersehen, der Typ erzwingt die Entscheidung.
   */
  onMasterEntsorgt: ((mesh: Mesh, endgueltig: boolean) => void) | null = null;
  /** Invisible collision carriers, one per prefab — see rebuildBucketColliders. */
  readonly colliders = new Map<
    string,
    { carrier: Mesh; set: StaticColliderSet; signature: string }
  >();
  /** Abgeleitete Formen je Prefab — Diagnose. */
  readonly colliderSpecs = new Map<string, unknown>();
  /** Prefabs whose meshes yielded no usable shape — never retried, because
   *  deriveCollider walks every vertex and repeating that stalls frames. */
  readonly colliderless = new Set<string>();
  /** Set once Havok is up; before that collider building is skipped. */
  physicsEnabled = false;
  /** Centre of the collision window — see setPlayerPosition. */
  colliderCenterX = 0;
  colliderCenterZ = 0;

  /**
   * Ob nahe (x,z) bereits ein Kollisionskörper steht. Ladeprüfung nach dem
   * Instanz-Teleport (Phase G): Der Spieler bleibt eingefroren, bis der
   * Mesh-Collider des Eingangsraums existiert — sonst fällt er durch den
   * noch ladenden Dungeon (GLB-Fetch + Bucket-Aufbau brauchen Sekunden).
   */
  colliderNahe(x: number, z: number, radius: number, nurRaeume = false): boolean {
    for (const [prefabName, e] of this.colliders) {
      // Beim Warten aufs Dungeon zählt nur der RAUM-Collider: eine bereits
      // geladene Fackel/Truhe hätte zwar einen Körper, aber keinen Boden.
      if (nurRaeume && getRoomByHash(getStableHash(prefabName)) === undefined) continue;
      if (e.set.hasBodyNear(x, z, radius)) return true;
    }
    return false;
  }

  /**
   * Nächstes interagierbares Objekt (Pickable/Tür/Truhe) im Umkreis — Ziel
   * der E-Taste. Liefert Prefab-Hash + Position für PacketType.Interact.
   */
  naechstesInteragierbares(
    x: number,
    z: number,
    radius: number
  ): { prefab: string; prefabHash: number; x: number; y: number; z: number } | null {
    const F = PrefabFlag;
    // BED (Schlafplatz), FIREPLACE (Braten) und die Namens-Sonderfälle
    // (Portal-Reise, Eikthyr-Altar) gehören ebenfalls zur E-Zielsuche.
    const wanted =
      F.PICKABLE | F.PICKABLE_ITEM | F.ITEM_DROP | F.DOOR | F.CONTAINER | F.BED | F.FIREPLACE;
    const SONDER = new Set(['portal_wood', 'StatueDeer']);
    let bestD = radius * radius;
    let best: { prefab: string; prefabHash: number; x: number; y: number; z: number } | null = null;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      if (!def || ((def.flags & wanted) === 0n && !SONDER.has(def.name))) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { prefab: def.name, prefabHash: bucket.prefabHash, x: px, y: bucket.matrices[i * 16 + 13]!, z: pz };
        }
      }
    }
    return best;
  }

  /**
   * Alle Lichtquellen-Instanzen im Umkreis (Prefabs mit `PrefabDef.light`)
   * — Futter für den LightPool. Nur statische Buckets; Fackeln/Feuer sind
   * nie dynamisch.
   */
  lichtquellen(
    x: number,
    z: number,
    radius: number
  ): Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> {
    const out: Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> = [];
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      const licht = def?.light;
      if (!licht) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > r2) continue;
        out.push({ x: px, y: bucket.matrices[i * 16 + 13]!, z: pz, licht });
      }
    }
    return out;
  }

  enablePhysics(): void {
    return enablePhysics(this);
  }

  /**
   * Move the collision window. Throttled by distance: the bodies only need
   * to exist around the player, and rebuilding them every frame is exactly
   * what makes this expensive.
   */
  setPlayerPosition(x: number, z: number): void {
    // ── Sprite-Fenster ZUERST und OHNE Physik-Gatter ────────────────
    // Die frühe Rückkehr bei !physicsEnabled unten ist für den
    // Kollisionspfad richtig (ohne Havok gibt es nichts zu bauen), für
    // das Sprite-Fenster wäre sie fatal: Solange Havok nicht steht,
    // erreichte die Spielerposition den EntityManager gar nicht, die
    // Fenstermitte bliebe auf (0,0) — und genau in dieser Phase steht der
    // Spieler beim Laden herum und schaut sich um.
    this.spielerBekannt = true;
    // Baeume und Buesche benutzen EINEN gemeinsamen Puffer fuer Bild und
    // Schatten. Die Auswahl folgt dem Spieler absichtlich nur in groben
    // Schritten: So bleibt die Grenze live, ohne beim Laufen pro Frame
    // saemtliche Vegetationsmaster neu auf die GPU zu schreiben.
    const vdx = x - this.vegetationsMitteX;
    const vdz = z - this.vegetationsMitteZ;
    if (
      !this.vegetationsMitteBekannt ||
      (this.vegetationsGrenzeM > 0 &&
        vdx * vdx + vdz * vdz >= VEGETATIONS_NEUPACK_M * VEGETATIONS_NEUPACK_M)
    ) {
      this.vegetationsMitteBekannt = true;
      this.vegetationsMitteX = x;
      this.vegetationsMitteZ = z;
      if (this.vegetationsGrenzeM > 0) this.markiereVegetationDirty();
    }
    const sdx = x - this.spriteMitteX;
    const sdz = z - this.spriteMitteZ;
    if (
      this.impostoren !== null &&
      sdx * sdx + sdz * sdz >= SPRITE_NEUPACK_M * SPRITE_NEUPACK_M
    ) {
      this.spriteMitteX = x;
      this.spriteMitteZ = z;
      // Nur die GESCHNITTENEN Buckets — nur die haben überhaupt eine
      // Sprite-Seite. Hier muss es `dirty` sein und nicht
      // `colliderDirty`: Die Zuteilung echt/Sprite ändert die
      // Renderpuffer, das ist der teure Pfad. Deshalb ist
      // SPRITE_NEUPACK_M mit 32 m fast dreimal so gross wie
      // COLLIDER_REBUILD_STEP.
      for (const bucket of this.buckets.values()) {
        if (bucket.dirty) continue;
        // `zellMaster` ist und bleibt nach PREFABNAME geschlüsselt (s.
        // rebuildBucketInstances: Override-Buckets nehmen den Zellschnitt nie).
        if (this.zellMaster.has(bucket.prefabName)) bucket.dirty = true;
      }
    }

    if (!this.physicsEnabled) return;
    const dx = x - this.colliderCenterX;
    const dz = z - this.colliderCenterZ;
    if (dx * dx + dz * dz < COLLIDER_REBUILD_STEP * COLLIDER_REBUILD_STEP) return;
    this.colliderCenterX = x;
    this.colliderCenterZ = z;
    // Nur Buckets colliderDirty markieren, die tatsächlich eine Instanz im
    // neuen Fenster (COLLIDER_RANGE + COLLIDER_REBUILD_STEP, grosszügig
    // genug für den Versatz seit der letzten Fenstermitte) haben — und NUR
    // colliderDirty, nicht dirty: Das Verschieben des Kollisionsfensters
    // ändert an den Renderdaten (Thin-Instance-Puffer) nichts, nur an der
    // Nah-Auswahl für die Physik. dirty triggert dagegen den vollen,
    // GPU-Upload-lastigen Instanz-Neuaufbau in rebuildBucketInstances —
    // beim Sprinten (alle 1,6 s ein neues Fenster) traf das bislang JEDEN
    // betroffenen Bucket, obwohl nur die Collider neu ausgewählt werden
    // mussten. s. flush()/rebuildBucketCollidersOnly().
    const grenze = COLLIDER_RANGE + COLLIDER_REBUILD_STEP;
    const r2 = grenze * grenze;
    for (const bucket of this.buckets.values()) {
      if (bucket.dirty || bucket.colliderDirty) continue;
      const mats = bucket.matrices;
      for (let i = 12; i < mats.length; i += 16) {
        const bx = mats[i]! - x;
        const bz = mats[i + 2]! - z;
        if (bx * bx + bz * bz <= r2) {
          bucket.colliderDirty = true;
          break;
        }
      }
    }
  }

  /** Das gemessene 100-FPS-Profil ein- oder ausschalten. */
  setHundertFpsProfil(an: boolean): void {
    if (an === this.hundertFpsProfil) return;
    this.hundertFpsProfil = an;
    // Beide Seiten jeder Familie neu schreiben. So stellt auch ein
    // Umschalten im laufenden Spiel die getrennten Master vollständig
    // wieder her, ohne Welt-Reload und ohne zweite Datenwahrheit.
    for (const bucket of this.buckets.values()) {
      if (FOLIAGE_HASHES.has(bucket.prefabHash) &&
          (bucket.prefabName.endsWith('Dick') || this.bucketNachPrefab(`${bucket.prefabName}Dick`))) {
        bucket.dirty = true;
      }
    }
  }

  /**
   * Sichtweite fuer Baeume und Buesche in Metern; 0 hebt die Begrenzung
   * auf. Der Neuaufbau laeuft ueber das bestehende Frame-Budget und gilt
   * fuer Farbbild UND Schatten, weil beide denselben Master verwenden.
   */
  setVegetationsGrenze(meter: number): void {
    const naechste = Number.isFinite(meter) ? Math.max(0, Math.round(meter)) : 0;
    if (naechste === this.vegetationsGrenzeM) return;
    this.vegetationsGrenzeM = naechste;
    this.markiereVegetationDirty();
  }

  private markiereVegetationDirty(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.mastersReady && FOLIAGE_HASHES.has(bucket.prefabHash)) bucket.dirty = true;
    }
  }

  /**
   * Läuft die Instanz-Tönung? Vorgabe `INSTANZ_TOENUNG_AN`; nur
   * `toenungSetzen()` verändert sie.
   */
  toenungAn = INSTANZ_TOENUNG_AN;

  /**
   * Die Instanz-Tönung zur LAUFZEIT umlegen — für A/B-Messungen.
   *
   * `__dbg.entities.toenungSetzen(false)` und wieder `true`, ohne den
   * Client neu zu laden. Der Grund ist nicht Bequemlichkeit: Auf dieser
   * Maschine messen mehrere Bauer gleichzeitig, die Systemlast schwankt
   * um den Faktor fünf, und zwei Messungen aus zwei Sitzungen sind
   * deshalb nicht vergleichbar. Im Wechsel innerhalb EINER Sitzung
   * gemessen ist der Unterschied der Tönung zuzuschreiben und nicht dem
   * Nachbarn.
   *
   * Zurück kommt, wie viele Buckets daraufhin neu gebaut werden — die
   * Zustandsgrösse, an der man sieht, dass der Schalter überhaupt etwas
   * bewirkt hat. Ohne sie sähe ein wirkungsloser Schalter genauso aus
   * wie ein wirksamer.
   */
  toenungSetzen(an: boolean): { an: boolean; buckets: number } {
    this.toenungAn = an;
    let n = 0;
    for (const bucket of this.buckets.values()) {
      if (!bucket.mastersReady) continue;
      bucket.dirty = true;
      n++;
    }
    return { an, buckets: n };
  }

  /**
   * G1 (Grundskala live im Testflug, Mikes Beschluss 27.09.): nach einem
   * PATCH `/api/modell-hochladen` (`GegenstandsKatalog.
   * grundskalaAendernAusfuehren`) erst `assets.getMasters(model)` erneut
   * anstossen — der Cache-Treffer dort lässt `wendeGrundskalaAn()` erneut
   * laufen und schreibt `master.localMatrix` IN PLACE auf den neuen Wert
   * (Kopfkommentar `AssetManager.wendeGrundskalaAn`). `masterLocals` hält
   * dieselben Matrix-Objekte (keine Kopien, s. `prepareMasters`), sieht die
   * Änderung also automatisch mit — was fehlt, ist ein erneutes Schreiben
   * der schon auf die GPU geladenen Thin-Instance-Puffer. Das übernimmt
   * `bucket.dirty = true`; `rebuildBucketInstances()` liest `masterLocals`
   * beim nächsten Tick neu.
   *
   * Nur Buckets DIESES Modells werden angefasst (`findPrefabByHash(...)
   * .model`) — ein Testflug, der das geänderte Modell (noch) nicht gesetzt
   * hat, bleibt unberührt.
   *
   * N1 (Nachbesserung nach Angriff, Befund B3): Vor dieser Fassung lief
   * `assets.getMasters(model)` bedingungslos — für ein Modell, das dieser
   * Testflug (noch) gar nicht gesetzt UND (noch) nicht selbst geladen hat,
   * war das kein „reiner Cache-Vergleich", sondern der ERSTE Aufruf für
   * diesen Namen: `getMasters` lädt dann die GLB und hängt sie in die Szene
   * (`AssetManager.baueMasters` → `loadContainer` → `addAllToScene`). Der
   * Wächter `assets.mastersSofort(model)` unterscheidet „schon einmal
   * angefordert" von „noch nie" OHNE selbst etwas anzustossen; ist er leer,
   * bricht die Funktion sofort ab — die inzwischen neu geladene Registry
   * (B1, `Testflug.ts`) reicht: Eine SPÄTERE Setzung dieses Modells ruft
   * `getMasters` ohnehin zum ersten Mal auf und bekommt die neue Grundskala
   * automatisch (`AssetManager.baueMasters` wendet sie am Ende jedes
   * Aufbaus an, unabhängig davon, ob das hier vorher lief).
   *
   * `this.colliders` (Kopfkommentar dort) baut die Kollisionsform je
   * `masterKey` genau EINMAL und danach nie wieder — ein Verhalten, das
   * bisher stimmte, weil sich die Form eines schon geladenen Prefabs nie
   * änderte. Eine Grundskala-Änderung bricht diese Annahme; der veraltete
   * Eintrag wird hier verworfen (samt Havok-Körpern und Träger-Mesh), damit
   * `rebuildBucketColliders()` ihn beim nächsten `flush()` aus den jetzt
   * aktuellen `masterLocals` neu ableitet.
   *
   * N1 (Befund B6): `this.colliderless` (Kopfkommentar dort) merkt sich je
   * `prefabName`, dass sich aus dem Netz KEINE Form ableiten liess, und
   * überspringt die Ableitung danach für immer — auch das ist eine Aussage
   * über die GRÖSSE des Netzes und muss mit der Grundskala mit verworfen
   * werden, sonst bliebe ein Prefab, das vor der Änderung `colliderless`
   * war, das für immer, selbst wenn die neue Größe eine Form ergäbe.
   */
  async aktualisiereGrundskala(model: string): Promise<{ buckets: number }> {
    if (!this.assets.mastersSofort(model)) return { buckets: 0 };
    await this.assets.getMasters(model);
    let n = 0;
    for (const bucket of this.buckets.values()) {
      if (!bucket.mastersReady) continue;
      if (findPrefabByHash(bucket.prefabHash)?.model !== model) continue;
      const alterCollider = this.colliders.get(bucket.masterKey);
      if (alterCollider) {
        alterCollider.set.dispose();
        alterCollider.carrier.dispose();
        this.colliders.delete(bucket.masterKey);
        this.colliderSpecs.delete(bucket.masterKey);
      }
      this.colliderless.delete(bucket.prefabName);
      bucket.dirty = true;
      n++;
    }
    return { buckets: n };
  }

  /** Diagnose fuer A/B-Messungen ueber window.__dbg.entities. */
  vegetationsGrenzeInfo(): {
    grenzeM: number;
    auswahlRadiusM: number;
    gesamt: number;
    sichtbar: number;
  } {
    let gesamt = 0;
    let sichtbar = 0;
    const radius = this.vegetationsGrenzeM > 0
      ? this.vegetationsGrenzeM + VEGETATIONS_NEUPACK_M
      : 0;
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      if (!FOLIAGE_HASHES.has(bucket.prefabHash)) continue;
      const n = bucket.matrices.length / 16;
      gesamt += n;
      if (radius <= 0 || !this.vegetationsMitteBekannt) {
        sichtbar += n;
        continue;
      }
      for (let i = 12; i < bucket.matrices.length; i += 16) {
        const dx = bucket.matrices[i]! - this.vegetationsMitteX;
        const dz = bucket.matrices[i + 2]! - this.vegetationsMitteZ;
        if (dx * dx + dz * dz <= r2) sichtbar++;
      }
    }
    return { grenzeM: this.vegetationsGrenzeM, auswahlRadiusM: radius, gesamt, sichtbar };
  }

  rebuildBucketColliders(bucket: StaticBucket, zdoMats: readonly Matrix[]): void {
    return rebuildBucketColliders(this, bucket, zdoMats);
  }

  private applyStatic(u: ZDOEntityUpdate, prefabName: string, model: string | null): void {
    // Raum-Steinmaterial (ZDO-Member `steinKit`) entscheidet über den Bucket:
    // Nur so können zwei Kammern desselben Prefabs verschieden aussehen — ein
    // Bucket hat genau einen Satz Master und damit genau ein Material.
    const ueber = u.steinKit ?? '';
    const schluessel = bucketSchluessel(u.prefabHash, ueber);
    // Wechselt ein ZDO den Bucket (Override gekommen/gegangen), erst drüben
    // ausräumen — sonst stünde die Instanz in beiden.
    const alterBucket = this.bucketOf.get(u.key);
    if (alterBucket !== undefined && alterBucket !== schluessel) {
      this.ausBucketEntfernen(u.key);
    }
    let bucket = this.buckets.get(schluessel);
    if (!bucket) {
      bucket = {
        prefabName,
        prefabHash: u.prefabHash,
        schluessel,
        masterKey: ueber ? `${prefabName}#${ueber}` : prefabName,
        steinKitOverride: ueber,
        steinKitCfg: leseSteinKitOverride(ueber),
        indexOf: new Map(),
        matrices: [],
        dirty: false,
        colliderDirty: false,
        mastersReady: false,
      };
      this.buckets.set(schluessel, bucket);
      this.prepareMasters(bucket, model);
    }

    const world = composeZdoWorld(u, findPrefabByHash(u.prefabHash)?.localScale);
    // Umkreis-Index mitführen. Die Position wird aus der fertigen Matrix
    // gelesen (Translation liegt row-major auf 12/13/14) und nicht aus
    // `u.position`: Die lineare Suche las bislang genau diese Werte, und
    // die Matrix ist ein Float32Array — sie rundet. Aus derselben Quelle zu
    // lesen heisst, dass Index und alte Suche bitgleiche Werte liefern.
    const m = world.m;
    this.indexSetzen(u.key, prefabName, m[12]!, m[13]!, m[14]!);
    if (bucket.indexOf.has(u.key)) {
      const idx = bucket.indexOf.get(u.key)!;
      world.copyToArray(bucket.matrices, idx * 16);
    } else {
      bucket.indexOf.set(u.key, bucket.matrices.length / 16);
      // Umkehrindex MITFÜHREN. `removeZDO` schlägt den Bucket über
      // `bucketOf` nach — ohne diesen Eintrag findet es nichts und
      // entfernt still gar nichts. Statische Objekte waren dadurch
      // unlöschbar: Der Platzierungs-Geist des Editors blieb nach dem
      // Setzen auf dem neuen Bauwerk stehen (gemessen: der Bucket hielt
      // `edghost` UND `edplace-0`), und es sah aus, als würde doppelt
      // gesetzt. `applyDynamic` pflegt seinen Index längst — hier fehlte er.
      this.bucketOf.set(u.key, schluessel);
      world.toArray(bucket.matrices, bucket.matrices.length);
      this.staticCount++;
    }
    bucket.dirty = true;
  }

  private prepareMasters(bucketVorlage: StaticBucket, model: string | null): void {
    const schluessel = bucketVorlage.schluessel;
    if (this.pending.has(schluessel)) return;
    this.pending.add(schluessel);
    if (!model) {
      // no GLB in the export — nothing to instance (sprites come in Phase 5)
      return;
    }
    /*
      Das eigene Kollisionsnetz des Speichers — eine ZWEITE Datei.

      Der Altbestand trägt seines im Modell (`_col`-Mesh); der Speicher
      nennt es in `prefabs.json` als `…-collision.glb`, und in keiner
      seiner GLBs steckt ein `_col`-Knoten. Beide Wege enden hier in
      derselben Liste `kollision`, damit die Formableitung nur EINEN Fall
      kennt: „es gibt ein eigenes Netz" oder „es gibt keines".

      Betroffen sind vier Bauwerke (Treppe, Unterstand, Steg, Torbogen) —
      die 15 Höhenfelder mit `art: 'mesh'` bekommen ohnehin nie einen
      Körper (`istFesterStoreKoerper`). Geladen wird die zweite Datei
      also fast nie, und wenn, dann genau dort, wo eine Hüllbox den
      Durchgang zumauerte.
    */
    const netz = storeKollision(bucketVorlage.prefabName)?.netz;
    const laden =
      netz === undefined
        ? this.assets.getMasters(model)
        : Promise.all([
            this.assets.getMasters(model),
            this.assets.getKollisionsMasters(kollisionsModellPfad(netz)),
          ]).then(([a, b]) => [...a, ...b]);
    void laden.then((masters) => {
      const bucket = this.buckets.get(schluessel);
      if (!bucket || masters.length === 0) return;
      // E23: FOLIAGE wird nur über Wasser gestreut. Die gemeinsame Hülle
      // seiner Thin Instances darf deshalb nicht entscheiden, ob der ganze
      // Bestand ein zweites Mal im Unterwasser-Pass gezeichnet wird.
      if (FOLIAGE_HASHES.has(bucket.prefabHash)) {
        for (const master of masters) markiereAlsGestreuteLandschaft(master.mesh);
      }
      // ── Override-Bucket: EIGENE Master ───────────────────────────────
      //
      // `getMasters()` liefert je Modell dieselben Prototypen an alle
      // Aufrufer. Ein zweiter Bucket darf sie nicht mitbenutzen: Babylon
      // hängt die Instanzmatrizen an die GEOMETRY, nicht ans Mesh
      // (thinInstanceMesh.js:88 → mesh.js:1396) — beide Buckets
      // überschrieben sich also gegenseitig ihre Instanzen, samt Hülle.
      // Aus demselben Grund ist es NICHT `mesh.clone()`: Ein Klon reicht die
      // Geometry der Quelle einfach weiter (mesh.js:350).
      //
      // `zellMeshAusPrototyp()` ist der im Haus bereits bewiesene Weg (E19 c,
      // client/test/master-huelle.ts): eigene Geometry samt eigener Hülle,
      // die CPU-seitigen Typed Arrays werden geteilt — genau die
      // „Geometrie teilen, Puffer nicht"-Grenze, die hier gebraucht wird.
      // Own masters for an override bucket: thin-instance buffers live on the
      // GEOMETRY, so sharing it (clone included) would make two buckets
      // overwrite each other. zellMeshAusPrototyp gives an own geometry while
      // sharing the CPU-side vertex data.
      //
      // Die reinen Kollisionsnetze (`_col`, s. AssetManager-Kopf) werden
      // hier ABGETRENNT und NICHT geklont: Sie tragen nie Instanzen,
      // also gibt es auch nichts, was sich zwei Buckets überschreiben
      // könnten — und ein Klon kostete nur Speicher.
      const sichtbar = masters.filter((m) => !m.nurKollision);
      const kollision = masters.filter((m) => m.nurKollision);
      const meshes = bucket.steinKitOverride
        ? sichtbar.map((m, i) =>
            zellMeshAusPrototyp(m.mesh, `${bucket.masterKey}_${i}`, this.scene)
          )
        : sichtbar.map((m) => m.mesh);
      this.masterMeshes.set(bucket.masterKey, meshes);
      this.masterLocals.set(bucket.masterKey, sichtbar.map((m) => m.localMatrix));
      if (kollision.length > 0) {
        this.kollisionsMasters.set(bucket.masterKey, kollision.map((m) => m.mesh));
        this.kollisionsLocals.set(bucket.masterKey, kollision.map((m) => m.localMatrix));
      }
      this.weiseSteinMaterialZu(bucket, meshes);
      bucket.mastersReady = true;
      bucket.dirty = true; // rebuild with instances now
    });
  }

  weiseSteinMaterialZu(
    bucket: StaticBucket,
    masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[]
  ): void {
    return weiseSteinMaterialZu(this, bucket, masters);
  }

  setzeDokumentSteinKit(cfg: Partial<SteinKitConfig> | null): void {
    return setzeDokumentSteinKit(this, cfg);
  }

  holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial {
    return holeSteinMaterial(this, cfg);
  }

  /** bucket.matrices (flach) in Matrix-Objekte entpacken — von beiden
   *  Rebuild-Pfaden gebraucht, s. rebuildBucketInstances/-CollidersOnly. */
  private buildZdoMats(bucket: StaticBucket): Matrix[] {
    const count = bucket.matrices.length / 16;
    const zdoMats = new Array<Matrix>(count);
    for (let i = 0; i < count; i++) {
      zdoMats[i] = Matrix.FromArray(bucket.matrices, i * 16);
    }
    return zdoMats;
  }

  /**
   * Begrenzte Renderauswahl fuer FOLIAGE. Die rohen `bucket.matrices`
   * bleiben vollstaendig: Kollision, Interaktion und Weltzustand duerfen
   * von einer Grafikoption nicht veraendert werden.
   */
  private sichtbareVegetationsMatrizen(
    bucket: StaticBucket,
    zdoMats: readonly Matrix[]
  ): readonly Matrix[] {
    if (
      this.vegetationsGrenzeM <= 0 ||
      !this.vegetationsMitteBekannt ||
      !FOLIAGE_HASHES.has(bucket.prefabHash)
    ) return zdoMats;
    const radius = this.vegetationsGrenzeM + VEGETATIONS_NEUPACK_M;
    return vegetationsMatrizenImRadius(
      zdoMats,
      this.vegetationsMitteX,
      this.vegetationsMitteZ,
      radius
    );
  }

  /**
   * Expand the bucket's persistent zdoWorld store into thin-instance
   * buffers: instance = masterLocal × zdoWorld (row-major).
   *
   * Seit E19 c gibt es dafür ZWEI Wege — den alten Vollmaster für kleine
   * Buckets und den Zellschnitt für die dicke Vegetation, s.
   * zellSchnittTaugt(). Was beide teilen: dieselben zdoMats, dieselbe
   * Multiplikation, dieselbe Dreierfolge schreibeInstanzen(). Der
   * Kollisionspfad hängt unverändert an den ROHEN zdoMats und bleibt
   * prefabweise.
   */
  /**
   * ZDO-Schluessel (`userId:id`), deren Instanz gerade NICHT gezeichnet
   * werden soll.
   *
   * Gebraucht fuer die geoeffnete Truhe: Sie wird als echte, animierte
   * Kopie ueber `AssetManager.instantiate()` an dieselbe Stelle gesetzt.
   * Bliebe die Thin Instance daneben stehen, saehe man zwei Deckel.
   *
   * Bewusst eine MENGE und keine Matrixmanipulation: Ein direkt in den
   * Puffer geschriebener Nullwert waere beim naechsten Neuaufbau des
   * Buckets wieder weg (jede ZDO-Aenderung in der Naehe loest einen
   * aus). Ueber die Menge ueberlebt das Verbergen jeden Neuaufbau.
   *
   * Collider bleiben unberuehrt — man soll nicht durch eine offene
   * Truhe hindurchlaufen koennen.
   */
  private readonly verborgeneInstanzen = new Set<string>();

  /** Instanz ausblenden bzw. wieder zeigen. `zdoKey` ist `userId:id`. */
  setzeInstanzVerborgen(zdoKey: string, verborgen: boolean): void {
    const vorher = this.verborgeneInstanzen.has(zdoKey);
    if (vorher === verborgen) return;
    if (verborgen) this.verborgeneInstanzen.add(zdoKey);
    else this.verborgeneInstanzen.delete(zdoKey);
    for (const b of this.buckets.values()) {
      if (b.indexOf.has(zdoKey)) b.dirty = true;
    }
  }

  /**
   * Weltposition einer Instanz — der Aufrufer braucht sie, um die
   * animierte Kopie an dieselbe Stelle zu setzen.
   */
  instanzPosition(zdoKey: string): { x: number; y: number; z: number } | null {
    for (const b of this.buckets.values()) {
      const flach = b.indexOf.get(zdoKey);
      if (flach === undefined) continue;
      return { x: b.matrices[flach + 12]!, y: b.matrices[flach + 13]!, z: b.matrices[flach + 14]! };
    }
    return null;
  }

  /** Verborgene Instanzen aus der Renderliste nehmen. */
  private ohneVerborgene(
    bucket: StaticBucket,
    zdoMats: readonly Matrix[],
    renderMats: readonly Matrix[]
  ): readonly Matrix[] {
    if (this.verborgeneInstanzen.size === 0) return renderMats;
    const raus = new Set<Matrix>();
    for (const key of this.verborgeneInstanzen) {
      const flach = bucket.indexOf.get(key);
      if (flach === undefined) continue;
      const m = zdoMats[flach / 16];
      if (m) raus.add(m);
    }
    if (raus.size === 0) return renderMats;
    return renderMats.filter((m) => !raus.has(m));
  }

  private rebuildBucketInstances(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.masterKey);
    const locals = this.masterLocals.get(bucket.masterKey);
    if (!masters || !locals) return;

    const zdoMats = this.buildZdoMats(bucket);
    if (this.hundertFpsProfil && this.baueGefalteteBaumfamilie(bucket)) {
      // Collider bleiben prefabtreu: Die Dick-Variante behält ihre eigene
      // Geometrie. Nur der Renderpfad verwendet den normalen Master.
      this.rebuildBucketColliders(bucket, zdoMats);
      return;
    }
    const renderMats = this.ohneVerborgene(
      bucket,
      zdoMats,
      this.sichtbareVegetationsMatrizen(bucket, zdoMats)
    );
    // Der Zellschnitt (samt Sprite-Fernfeld) ist nach PREFABNAME geschlüsselt
    // — `zellMaster`, der Zell-Pool und der Impostor-Atlas. Ein Bucket mit
    // Raum-Steinmaterial teilt sich diesen Namen mit dem Bucket ohne Override
    // und würde ihm die Zellen wegräumen. Er nimmt deshalb immer den
    // Vollmaster: Es sind Dungeon-Räume, ein paar Dutzend Instanzen — der
    // Schnitt ist für gestreute Vegetation gebaut und griffe hier ohnehin nie.
    // Override buckets always take the full master: the cell cut is keyed by
    // prefab NAME and is meant for scattered vegetation, not dungeon rooms.
    if (!bucket.steinKitOverride && this.zellSchnittTaugt(masters, renderMats.length)) {
      this.baueZellMaster(bucket, masters, locals, renderMats);
    } else {
      this.baueVollMaster(bucket, masters, locals, renderMats);
    }

    this.rebuildBucketColliders(bucket, zdoMats);
  }

  private bucketNachPrefab(prefabName: string): StaticBucket | null {
    for (const bucket of this.buckets.values()) {
      if (bucket.prefabName === prefabName) return bucket;
    }
    return null;
  }

  /**
   * Faltet `<Baum>` und `<Baum>Dick` auf den normalen Render-Master.
   *
   * Die generierten Paare haben dieselbe Topologie und dieselben lokalen
   * Hüllmaße; die Dick-GLB unterscheidet sich nur in der Stammstärke. Die
   * ZDO-Weltmatrizen dürfen daher gemeinsam mit der lokalen Matrix des
   * normalen Modells instanziert werden. Stimmen Masterzahl oder
   * Indizes irgendwann nicht mehr überein, greift der sichere alte Weg.
   */
  private baueGefalteteBaumfamilie(ausloeser: StaticBucket): boolean {
    if (!FOLIAGE_HASHES.has(ausloeser.prefabHash)) return false;
    const basisName = ausloeser.prefabName.endsWith('Dick')
      ? ausloeser.prefabName.slice(0, -4)
      : ausloeser.prefabName;
    const dickName = `${basisName}Dick`;
    const basisBucket = this.bucketNachPrefab(basisName);
    const dickBucket = this.bucketNachPrefab(dickName);
    if (!basisBucket?.mastersReady || !dickBucket?.mastersReady) return false;

    const basisMasters = this.masterMeshes.get(basisName);
    const basisLocals = this.masterLocals.get(basisName);
    const dickMasters = this.masterMeshes.get(dickName);
    if (!basisMasters || !basisLocals || !dickMasters || basisMasters.length !== dickMasters.length) return false;
    for (let i = 0; i < basisMasters.length; i++) {
      if (basisMasters[i]!.getTotalIndices() !== dickMasters[i]!.getTotalIndices()) return false;
    }

    this.zellenAbbauen(basisName);
    this.zellenAbbauen(dickName);
    this.impostoren?.setzePrefab(basisName, null);
    this.impostoren?.setzePrefab(dickName, null);
    const basisMats = this.sichtbareVegetationsMatrizen(
      basisBucket,
      this.buildZdoMats(basisBucket)
    );
    const dickMats = this.sichtbareVegetationsMatrizen(
      dickBucket,
      this.buildZdoMats(dickBucket)
    );
    const count = basisMats.length + dickMats.length;
    for (let m = 0; m < basisMasters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = basisLocals[m]!;
      let ziel = 0;
      for (const world of basisMats) local.multiply(world).toArray(data, ziel++ * 16);
      for (const world of dickMats) local.multiply(world).toArray(data, ziel++ * 16);
      const puffer = count > 0 ? data : null;
      schreibeInstanzen(basisMasters[m]!, puffer);
      schreibeInstanzen(dickMasters[m]!, null);
      this.meldeVegetationsSchatten(basisBucket, basisMasters[m]!, puffer);
      this.meldeVegetationsSchatten(dickBucket, dickMasters[m]!, null);
    }
    return true;
  }

  /**
   * Darf dieser Bucket zellweise geschnitten werden?
   *
   * Drei Bedingungen, jede aus einem eigenen Grund:
   *  - Genug Instanzen (ZELL_SCHNITT_AB). Darunter lohnt der Schnitt
   *    nicht und würde nur Zeichenaufrufe vervielfachen.
   *  - Höchstens EIN Submesh je Prototyp. `VertexData.applyToMesh()`
   *    legt genau ein Submesh an; ein Prototyp mit MultiMaterial
   *    verlöre beim Kopieren seine Materialzuordnung. Nach dem
   *    Verschmelzen nach Material (AssetManager) ist das der Normalfall,
   *    aber verlassen will man sich darauf nicht.
   *  - Eine Szene. Der statische Pfad ist ohne Szene konstruierbar
   *    (client/test/entity-index.ts baut `new EntityManager(null,…)`),
   *    dort entsteht kein einziges Mesh.
   */
  private zellSchnittTaugt(masters: readonly Mesh[], anzahl: number): boolean {
    if (anzahl <= ZELL_SCHNITT_AB) return false;
    if (!this.scene) return false;
    for (const m of masters) {
      if (m.subMeshes && m.subMeshes.length > 1) return false;
    }
    return true;
  }

  /** Der Weg von D10: ein Master je Submesh trägt ALLE Instanzen. */
  private baueVollMaster(
    bucket: StaticBucket,
    masters: readonly Mesh[],
    locals: readonly Matrix[],
    zdoMats: readonly Matrix[]
  ): void {
    // Der Bucket kann geschrumpft sein (Instanzen entfernt) und vorher
    // geschnitten gewesen sein — dann tragen noch Zell-Master seine
    // Instanzen, und ohne diesen Abbau stünde jedes Objekt doppelt im
    // Bild.
    this.zellenAbbauen(bucket.prefabName);
    // Dasselbe für das Sprite-Fernfeld, aus demselben Grund: Ein
    // liegengebliebener Sprite-Beitrag zeichnete den Baum ein zweites
    // Mal. Der Vollmaster trägt IMMER alle Instanzen — Sprites gibt es
    // nur im geschnittenen Betrieb.
    this.impostoren?.setzePrefab(bucket.prefabName, null);
    const count = zdoMats.length;
    // Die Tönung hängt am MODELL, nicht am Prefabnamen: `PrefabDef.model`
    // sagt, aus welchem Bestand die Datei stammt (s. darfGetoentWerden).
    const modell = findPrefabByHash(bucket.prefabHash)?.model ?? null;
    for (let m = 0; m < masters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = locals[m]!;
      for (let i = 0; i < count; i++) {
        local.multiply(zdoMats[i]!).toArray(data, i * 16);
      }
      const puffer = count > 0 ? data : null;
      schreibeInstanzen(masters[m]!, puffer);
      // NACH schreibeInstanzen: `thinInstanceSetBuffer('matrix', …)` setzt
      // `instancesCount`, und der Farbpuffer wird gegen diese Zahl
      // gelesen. Umgekehrt stünde die Farbe für einen Moment gegen die
      // Instanzzahl des vorigen Aufbaus.
      const toenen = puffer !== null && darfGetoentWerden(masters[m]!, modell, this.toenungAn);
      schreibeToenung(masters[m]!, toenen ? zdoMats : null, null, toenen ? count : 0);
      this.meldeVegetationsSchatten(bucket, masters[m]!, puffer);
    }
  }

  /**
   * Der Zellschnitt (E19 c): die Instanzen eines Prefabs auf einen Master
   * je (Prototyp × 128-m-Zelle × Überlaufblock) verteilen.
   *
   * ── Was das bewirkt ──────────────────────────────────────────────
   * Gleich viele Instanzen, gleich viele Matrixmultiplikationen, nur
   * verteilt auf mehr und kleinere Puffer. Der Gewinn kommt
   * ausschliesslich daraus, dass die HÜLLEN klein werden und damit die
   * beiden vorhandenen Keulungen greifen, die bisher an der 425-m-Hülle
   * des Vollmasters wirkungslos abprallten: die Frustumprüfung im
   * Bildpass und die Entfernungsprüfung in Shadows.darfWerfen() für die
   * Werferliste. Gemessen auf der Insel erreichten je Kaskade nur 14–15 %
   * der 24.265 Vegetationsinstanzen die Schattenkarte — die übrigen 85 %
   * wurden eingereicht, transformiert und verworfen (E20).
   *
   * ── Was hier NICHT passiert ──────────────────────────────────────
   * `bucket.matrices` bleibt EINE flache Liste je Prefab. Vier Pfade
   * lesen sie indexbasiert (Swap-Remove in removeZDO, der Scan in
   * setPlayerPosition, naechstesInteragierbares, lichtquellen), und
   * client/test/entity-index.ts prüft genau dieses Layout. Der Schnitt
   * lebt allein im Renderpfad und wird bei jedem Neuaufbau frisch
   * gerechnet; es gibt keine zweite Wahrheit, die auseinanderlaufen
   * könnte.
   *
   * Ebenso bleibt der Umkreis-Index (INDEX_ZELLE_M = 32) unangetastet:
   * andere Zellgrösse, andere Gründe, anderer Lebenszyklus. Geteilt wird
   * nur `zellenSchluessel()`.
   */
  private baueZellMaster(
    bucket: StaticBucket,
    masters: readonly Mesh[],
    locals: readonly Matrix[],
    zdoMats: readonly Matrix[]
  ): void {
    // Die Prototypen zeichnen im Zellbetrieb nie selbst. Über
    // schreibeInstanzen(…, null) abschalten und nicht etwa über
    // setEnabled(false) allein: Sonst behielten sie ihren alten
    // Matrixpuffer samt 425-m-Hülle und blieben mit ihr in der
    // Werferliste stehen.
    for (const proto of masters) {
      if (proto.isEnabled() || proto.thinInstanceCount > 0) schreibeInstanzen(proto, null);
      // Dem Schattensystem dasselbe melden (G16 a): Wechselt der Bucket vom
      // Voll- in den Zellbetrieb, hielt der Vollmaster dort seine Buchung
      // samt Klon und warf weiter Schatten fuer einen Bestand, den er nicht
      // mehr zeichnet. `null` leert die Buchung; ein Master, der nie
      // gemeldet war, bekommt dadurch keine (Shadows.setVegetationsInstanzen).
      // Tell the shadow system too: the full master's booking must be emptied.
      this.meldeVegetationsSchatten(bucket, proto, null);
    }

    // Zellzuordnung aus DERSELBEN Quelle wie der Umkreis-Index: der
    // Translation der fertigen Weltmatrix (row-major auf 12/13/14). Nicht
    // aus u.position — die Matrix ist f32-gerundet, und zwei verschiedene
    // Quellen ergäben Grenzfälle, in denen eine Instanz in einer anderen
    // Zelle landet als ihr Indexeintrag.
    const proZelle = new Map<number, number[]>();
    for (let i = 0; i < zdoMats.length; i++) {
      const m = zdoMats[i]!.m;
      const schluessel = zellenSchluessel(
        Math.floor(m[12]! / RENDER_ZELLE_M),
        Math.floor(m[14]! / RENDER_ZELLE_M)
      );
      const liste = proZelle.get(schluessel);
      if (liste) liste.push(i);
      else proZelle.set(schluessel, [i]);
    }

    let zellen = this.zellMaster.get(bucket.prefabName);
    if (!zellen) this.zellMaster.set(bucket.prefabName, (zellen = new Map()));

    // s. baueVollMaster — dieselbe Quelle, damit ein Prefab im
    // geschnittenen und im ungeschnittenen Betrieb dieselbe Farbe trägt.
    const toenungsModell = findPrefabByHash(bucket.prefabHash)?.model ?? null;

    // ── Sprite-Fernfeld: gibt es fuer dieses Prefab einen Atlas? ─────
    // `melde()` baeckt beim ersten Mal (8 Ansichten, einmal je Sitzung
    // und Archetyp) und liefert danach sofort. Schlaegt das Backen fehl
    // oder ist das Prefab zu klein, bleibt `atlas` false — und dann
    // faellt JEDE Instanz auf die echte Darstellung zurueck, niemals auf
    // gar keine. Das ist der Fail-Soft, den Leitplanke 4 verlangt.
    //
    // `spielerBekannt` ist der zweite Riegel: Vor dem ersten
    // setPlayerPosition() steht die Fenstermitte auf (0,0), und ein
    // Spieler, der auf der Insel bei 10077/-18723 einloggt, saehe seinen
    // gesamten Wald als Sprites. Symptom waere "beim Start ist der halbe
    // Wald weg, nach dem ersten Schritt kommt er" — der Fehler, vor dem
    // die Analyse ausdruecklich warnt.
    const imp = this.impostoren;
    let atlas = false;
    if (imp !== null && this.spielerBekannt) {
      // `kennt()` spart den Aufbau der Master-Liste im Normalfall — der
      // Bucket wird bei jeder Spielerbewegung neu gebaut, das Backen
      // passiert aber genau einmal je Archetyp und Sitzung.
      atlas = imp.kennt(bucket.prefabName)
        ? imp.atlasBereit(bucket.prefabName)
        : imp.melde(bucket.prefabName, this.masterQuelle(bucket.prefabName));
    }
    const grenze = this.impostorGrenze;
    const spriteZellen = atlas ? new Map<number, Float32Array>() : null;
    const nah: number[] = [];
    const fern: number[] = [];

    for (const [schluessel, alleIndizes] of proZelle) {
      const cx = (schluessel >>> 16) - 0x8000;
      const cz = (schluessel & 0xffff) - 0x8000;
      // Die EINE Zuteilung. `zellLage` ist nur der billige Vorfilter
      // (ganz nah / ganz fern), `teileZelle` die Regel — beide aus
      // derselben Ungleichung abgeleitet, damit es keine zwei Wahrheiten
      // gibt. s. BaumImpostorKern.
      const lage = zellLage(cx, cz, RENDER_ZELLE_M, this.spriteMitteX, this.spriteMitteZ, grenze, atlas);
      teileZelle(
        alleIndizes,
        (i) => zdoMats[i]!.m[12]!,
        (i) => zdoMats[i]!.m[14]!,
        lage,
        this.spriteMitteX,
        this.spriteMitteZ,
        grenze,
        nah,
        fern
      );

      if (spriteZellen && fern.length > 0) {
        spriteZellen.set(schluessel, this.spriteDaten(bucket.prefabName, zdoMats, fern));
      }

      const indizes = nah;
      let bloecke = zellen.get(schluessel);
      if (!bloecke) {
        if (indizes.length === 0) continue; // reine Sprite-Zelle: kein Master
        zellen.set(schluessel, (bloecke = masters.map(() => [] as Mesh[])));
      }
      const gebraucht = Math.ceil(indizes.length / ZELL_MAX_INSTANZEN);
      for (let m = 0; m < masters.length; m++) {
        const local = locals[m]!;
        const reihe = bloecke[m]!;
        for (let b = 0; b < gebraucht; b++) {
          const von = b * ZELL_MAX_INSTANZEN;
          const bis = Math.min(von + ZELL_MAX_INSTANZEN, indizes.length);
          const data = new Float32Array((bis - von) * 16);
          for (let k = von; k < bis; k++) {
            local.multiply(zdoMats[indizes[k]!]!).toArray(data, (k - von) * 16);
          }
          let mesh = reihe[b];
          if (!mesh) {
            mesh = this.zellMeshHolen(bucket.prefabName, m, masters[m]!, schluessel, b);
            reihe[b] = mesh;
          }
          schreibeInstanzen(mesh, data);
          // Dieselbe Tönung wie im Vollmaster-Pfad, und aus derselben
          // Quelle: der Weltposition. Ein Baum darf seine Farbe nicht
          // ändern, nur weil er in eine Zelle gerutscht ist.
          const toenen = darfGetoentWerden(mesh, toenungsModell, this.toenungAn);
          schreibeToenung(mesh, toenen ? zdoMats : null, indizes.slice(von, bis), toenen ? bis - von : 0);
        }
        // Überzählige Blöcke (die Zelle ist dünner geworden — oder ihre
        // Instanzen sind ins Sprite-Feld gewandert) freigeben.
        for (let b = reihe.length - 1; b >= gebraucht; b--) {
          this.zellMeshFreigeben(bucket.prefabName, m, reihe[b]!);
          reihe.length = b;
        }
      }
      // Eine Zelle, die vollstaendig ins Sprite-Feld gewandert ist, haelt
      // jetzt nur noch leere Reihen — raus aus der Buchfuehrung, sonst
      // zaehlt zellStats() sie als lebende Zelle.
      if (indizes.length === 0) zellen.delete(schluessel);
    }

    // Leergelaufene Zellen: Puffer auf null, abgeschaltet, zurück in den
    // Pool. Nicht entsorgen — s. zellPool.
    for (const [schluessel, bloecke] of zellen) {
      if (proZelle.has(schluessel)) continue;
      for (let m = 0; m < bloecke.length; m++) {
        for (const mesh of bloecke[m]!) this.zellMeshFreigeben(bucket.prefabName, m, mesh);
      }
      zellen.delete(schluessel);
    }

    // Die Sprite-Beitraege dieses Prefabs VOLLSTAENDIG ersetzen — auch
    // wenn sie leer sind. Ein liegengebliebener Beitrag waere ein
    // DOPPELBILD (der Baum stuende echt und als Sprite zugleich), und das
    // ist genau der Fehlermodus, den Leitplanke 4 ausschliesst.
    this.impostoren?.setzePrefab(bucket.prefabName, spriteZellen);
  }

  /**
   * Instanzdaten fuer das Sprite-Feld: je Instanz x, y, z, Kartenbreite,
   * Kartenhoehe, Gierwinkel (Stride SPRITE_STRIDE).
   *
   * Die Kartenmasse kommen aus der gebackenen Atlaszeile (Modellmasse in
   * Metern) und werden mit der Instanzskalierung multipliziert — dieselbe
   * Quelle, aus der auch der Rahmen der Backkamera stammt. Waeren es zwei
   * Quellen, saesse der Sprite systematisch neben seinem Zwilling.
   */
  private spriteDaten(
    prefabName: string,
    zdoMats: readonly Matrix[],
    indizes: readonly number[]
  ): Float32Array {
    const masse = this.impostoren!.zeileVon(prefabName)!;
    const aus = new Float32Array(indizes.length * SPRITE_STRIDE);
    for (let k = 0; k < indizes.length; k++) {
      const m = zdoMats[indizes[k]!]!.m;
      const { yaw, sxz, sy } = yawUndSkala(m, 0);
      const o = k * SPRITE_STRIDE;
      aus[o] = m[12]!;
      aus[o + 1] = m[13]!;
      aus[o + 2] = m[14]!;
      aus[o + 3] = masse.breite * sxz;
      aus[o + 4] = masse.hoehe * sy;
      aus[o + 5] = yaw;
    }
    return aus;
  }

  /** Die Prototypen eines Prefabs als PrefabMaster-Paare — fuer den Backer. */
  private masterQuelle(prefabName: string): Array<{ mesh: Mesh; localMatrix: Matrix }> {
    const meshes = this.masterMeshes.get(prefabName) ?? [];
    const locals = this.masterLocals.get(prefabName) ?? [];
    const aus: Array<{ mesh: Mesh; localMatrix: Matrix }> = [];
    for (let i = 0; i < meshes.length && i < locals.length; i++) {
      aus.push({ mesh: meshes[i]!, localMatrix: locals[i]! });
    }
    return aus;
  }

  /**
   * Einen Zell-Master besorgen — aus dem Pool oder frisch.
   *
   * Der Name behält den Prototypnamen als PRÄFIX und bekommt die Zelle
   * als Suffix (`leaves_merged#78_-146`, Überlaufblöcke mit `_1`, `_2`).
   * Das ist kein Schmuck: Shadows.NIE_WERFEN ist auf `^` verankert
   * (clutter|sky|water|col_|avatar_…) und Shadows.KLEINZEUG bewusst
   * nicht; ein vorangestelltes Zellkürzel würde die eine Regel
   * stillschweigend aushebeln und die andere weiterhin treffen. Auch die
   * Diagnose in main.ts klassifiziert über Namenspräfixe.
   */
  private zellMeshHolen(
    prefabName: string,
    prototypIndex: number,
    proto: Mesh,
    zelle: number,
    block: number
  ): Mesh {
    const cx = (zelle >>> 16) - 0x8000;
    const cz = (zelle & 0xffff) - 0x8000;
    const name = `${proto.name}#${cx}_${cz}${block > 0 ? `_${block}` : ''}`;
    const frei = this.zellPool.get(`${prefabName}|${prototypIndex}`)?.pop();
    if (frei) {
      // Umbenennen ist gefahrlos: Der Schattengenerator merkt sich
      // Meshes über die Objektidentität, und die Namensregeln greifen
      // auf den unveränderten Präfix.
      frei.name = name;
      this.onMasterBelebt?.(frei);
      return frei;
    }
    const frisch = zellMeshAusPrototyp(proto, name, this.scene);
    // Ortsfest: Ein Zell-Master steht im Ursprung, die Weltmatrizen seiner
    // Instanzen stecken im Thin-Instance-Puffer. Das Streaming schreibt
    // diesen Puffer neu, versetzt den Master aber nie — s.
    // alsOrtsfestEinfrieren() für die Stellen, an denen aufgetaut werden
    // müsste, und warum das NICHT in zellMeshAusPrototyp() steht.
    alsOrtsfestEinfrieren(frisch);
    return frisch;
  }

  /**
   * Zell-Master leeren, abschalten und zur Wiederverwendung ablegen.
   *
   * Der Pool ist GEDECKELT (Review-Fund E19 c): Jeder Zell-Master haelt
   * eine eigene GPU-Kopie der Prototyp-Geometrie, und ohne Deckel wuchs
   * der Pool bis zum Sitzungsmaximum — jede je besuchte Zelle blieb als
   * GPU-Speicher liegen. 16 je (Prefab, Prototyp) deckt den Streaming-
   * Takt (Zellen kommen und gehen ringweise); was darueber liegt, wird
   * beim Schattensystem abgemeldet und entsorgt. Die Geometry ist je
   * Zelle EIGEN (zellMeshAusPrototyp), dispose gibt sie also wirklich
   * frei; das Material ist geteilt und bleibt (dispose(false, false)).
   */
  private zellMeshFreigeben(prefabName: string, prototypIndex: number, mesh: Mesh): void {
    schreibeInstanzen(mesh, null);
    const schluessel = `${prefabName}|${prototypIndex}`;
    const pool = this.zellPool.get(schluessel);
    if (!pool) {
      // Auch der ALLERERSTE Master eines Schluessels wird abgemeldet. Er
      // legt den Pool an und nahm bisher als einziger Pfad den Rueckkanal
      // nicht — abgeschaltet, aber weiter je Kaskade durchgesehen.
      this.onMasterEntsorgt?.(mesh, false);
      this.zellPool.set(schluessel, [mesh]);
      return;
    }
    if (pool.length >= ZELL_POOL_DECKEL) {
      // ENDGUELTIG: gleich folgt dispose(). Der Empfaenger muss deshalb
      // alles wegraeumen, was an diesem Mesh haengt, nicht nur die
      // Listeneintraege — s. Shadows.vergissMaster().
      this.onMasterEntsorgt?.(mesh, true);
      mesh.dispose(false, false);
      return;
    }
    // Auch GEPOOLTE Master abmelden (Review-Fund 18.08.): Abgeschaltete
    // Meshes kosten in der Werferliste nicht "nur einen Listenplatz" —
    // der Schattenpass iteriert sie je Kaskade. Ohne Abmeldung sammeln
    // sich bis zu DECKEL x Prefabs x Prototypen tote Eintraege. Der
    // Callback entsorgt nichts, er raeumt nur Listen; beim Reaktivieren
    // meldet onMasterBelebt -> meldeWerfer wieder an. Deshalb hier
    // `endgueltig = false`: Das Mesh lebt weiter, und was sonst noch an
    // ihm haengt (Schattenklon samt eigener Geometrie) soll es behalten,
    // statt es beim Wiederbeleben neu auf die Grafikkarte zu laden.
    this.onMasterEntsorgt?.(mesh, false);
    pool.push(mesh);
  }

  /** Alle Zell-Master eines Prefabs freigeben (Rückfall auf den Vollmaster). */
  private zellenAbbauen(prefabName: string): void {
    const zellen = this.zellMaster.get(prefabName);
    if (!zellen || zellen.size === 0) return;
    for (const bloecke of zellen.values()) {
      for (let m = 0; m < bloecke.length; m++) {
        for (const mesh of bloecke[m]!) this.zellMeshFreigeben(prefabName, m, mesh);
      }
    }
    zellen.clear();
  }

  /**
   * Diagnose des Zellschnitts — die Zahlen, an denen E19 c gemessen wird.
   *
   * `aktiv` ist die entscheidende: Sie sagt, wie viele Zeichenaufrufe der
   * Schnitt tatsächlich stellt. `frei` sind abgeschaltete Master im Pool;
   * sie stehen weiter in scene.meshes und in der Werferliste (Shadows
   * lässt abgeschaltete Meshes ungeprüft drin), kosten dort aber nur
   * einen Listenplatz — deshalb ist `werferAnzahl()` allein nach diesem
   * Umbau kein brauchbares Mass mehr.
   */
  zellStats(): {
    prefabs: number;
    zellen: number;
    master: number;
    aktiv: number;
    frei: number;
    /**
     * Das Sprite-Fernfeld — die zweite Haelfte derselben Rechnung.
     *
     * `aktiv` allein sagt seit dem Impostor-Umbau nicht mehr, wie teuer
     * die Vegetation ist: Was hier an Zell-Mastern fehlt, steht drueben
     * als `sprites.zellen` (Zeichenaufrufe) und `sprites.instanzen`.
     * Beide Zahlen gehoeren in dieselbe Momentaufnahme, sonst laesst sich
     * hinterher nicht sagen, welcher der beiden Hebel gezogen hat.
     * `zeilen`/`budget` zeigen, wie voll der Atlas ist; `abgelehnt` zaehlt
     * die Archetypen, die auf die echte Darstellung zurueckgefallen sind.
     */
    sprites: {
      zeilen: number;
      budget: number;
      atlasPx: number;
      abgelehnt: number;
      zellen: number;
      instanzen: number;
    } | null;
    /** Uebergabegrenze, gegen die zuletzt zugeteilt wurde (m). */
    spriteGrenze: number;
  } {
    let zellenGesamt = 0;
    let master = 0;
    let aktiv = 0;
    for (const zellen of this.zellMaster.values()) {
      zellenGesamt += zellen.size;
      for (const bloecke of zellen.values()) {
        for (const reihe of bloecke) {
          for (const mesh of reihe) {
            master++;
            if (mesh.isEnabled()) aktiv++;
          }
        }
      }
    }
    let frei = 0;
    for (const pool of this.zellPool.values()) frei += pool.length;
    return {
      prefabs: this.zellMaster.size,
      zellen: zellenGesamt,
      master,
      aktiv,
      frei,
      sprites: this.impostoren?.stats() ?? null,
      spriteGrenze: this.impostorGrenze,
    };
  }

  /**
   * Nur die Collider-Auswahl neu ausrechnen, ohne den teuren
   * Thin-Instance-Renderpuffer (Matrixmultiplikation je Submesh × Instanz
   * plus GPU-Upload) anzufassen — für colliderDirty-Buckets, deren
   * Renderdaten sich gar nicht geändert haben. s. setPlayerPosition().
   */
  private rebuildBucketCollidersOnly(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.masterKey);
    if (!masters) return;
    this.rebuildBucketColliders(bucket, this.buildZdoMats(bucket));
  }

  /**
   * Dynamische Entities pro Frame Richtung Server-Ziel gleiten
   * (exponentielle Annäherung, Halbwertszeit ~60 ms — glättet den
   * 50-ms-Sync-Takt, ohne spürbar nachzuhängen). Im Game-Loop aufrufen.
   */
  /** Diagnose: Prefab-Namen der aktiven dynamischen Entities. */
  dynamicList(): string[] {
    return [...this.dynamics.values()].map((d) => d.root.name || '?');
  }

  /**
   * Diagnose: Pose des ersten Dynamics, dessen Name den Teilstring trägt.
   *
   * `yaw` und `anim` sind für das Kampfsystem dazugekommen: Ob ein NPC
   * den Spieler ansieht und ob er zuschlägt, sind genau die beiden Werte,
   * die der Server über ZDO-Rotation und ANIM_MEMBER steuert — und ohne
   * sie lässt sich von aussen nicht nachprüfen, ob das ankommt. Ein
   * Bildschirmfoto beantwortet das nicht: Bei Nacht und aus zwanzig
   * Metern sieht ein drohend dastehender Riese aus wie ein wartender.
   */
  dynamicPose(
    name: string
  ): {
    pos: Vector3Like;
    rotX: number;
    yaw: number;
    anim: string | null;
    tempo: number;
    /** Smoothed ground speed of the coupled clip, m/s (-1 = not coupled). */
    tempoIst: number;
    /** The group that really plays and the rate it really has. */
    gruppe: { name: string; speedRatio: number } | null;
    /** Life in percent (-1 = unknown). */
    leben: number;
  } | null {
    for (const d of this.dynamics.values()) {
      if (!(d.root.name || '').includes(name)) continue;
      const p = d.root.position;
      const e = d.root.rotationQuaternion?.toEulerAngles();
      return {
        pos: { x: p.x, y: p.y, z: p.z },
        rotX: e?.x ?? 0,
        yaw: e?.y ?? 0,
        anim: d.anim ?? null,
        tempo: d.gang?.tempo ?? -1,
        tempoIst: d.clipTempo?.ist ?? -1,
        gruppe: this.assets.aktiveGruppe(d.root),
        leben: d.leben ?? -1,
      };
    }
    return null;
  }

  /**
   * Diagnostics: the size of a dynamic creature as Babylon really draws it.
   *
   * Measured on the DEFORMED mesh (`applySkeleton`) in the first frame of the
   * clip `clip`, with the root turned to the identity so that width and
   * length are the model's own axes and not the axes of whatever heading the
   * animal has. This is the number to hold against the sizes the prefab
   * declares (`renderScale`): the manifest cannot answer it, it measures the
   * bind pose. Sets the clip back to playing afterwards.
   *
   * `sohle` is the lowest drawn point above the root's origin (the ground
   * point the server sends); it is what keeps the feet on the ground.
   */
  dynamicMasse(
    name: string,
    clip = 'idle'
  ): { breite: number; hoehe: number; laenge: number; sohle: number } | null {
    for (const d of this.dynamics.values()) {
      if (!(d.root.name || '').includes(name)) continue;
      const gruppen = this.assets.gruppenVon(d.root);
      const g = gruppen.find((x) => x.name.toLowerCase().includes(clip));
      const zurueck = pausiereFuerMessung(gruppen, g);
      const rot = d.root.rotationQuaternion?.clone() ?? null;
      d.root.rotationQuaternion = Quaternion.Identity();
      d.root.computeWorldMatrix(true);
      for (const tn of d.root.getChildTransformNodes(false)) tn.computeWorldMatrix(true);
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const m of d.root.getChildMeshes()) {
        if (m.getTotalVertices() === 0) continue;
        m.skeleton?.prepare(true);
        m.refreshBoundingInfo({ applySkeleton: true });
        m.computeWorldMatrix(true);
        const b = m.getBoundingInfo().boundingBox;
        lo.minimizeInPlace(b.minimumWorld);
        hi.maximizeInPlace(b.maximumWorld);
      }
      const y0 = d.root.position.y;
      d.root.rotationQuaternion = rot;
      zurueck();
      return { breite: hi.x - lo.x, hoehe: hi.y - lo.y, laenge: hi.z - lo.z, sohle: lo.y - y0 };
    }
    return null;
  }

  /**
   * Diagnostics: how far the drawn mesh jumps where a clip wraps around.
   *
   * The largest and the mean distance a vertex moves between the LAST and the
   * FIRST frame of `clip` (root turned to the identity, deformed mesh) — the
   * jump the player sees every time a looping clip starts over. Sets the clip
   * back to playing afterwards.
   */
  dynamicSprung(
    name: string,
    clip: string
  ): { max: number; mittel: number; vertices: number; zurMitteMax: number } | null {
    for (const d of this.dynamics.values()) {
      if (!(d.root.name || '').includes(name)) continue;
      const gruppen = this.assets.gruppenVon(d.root);
      const g = gruppen.find((x) => x.name.toLowerCase().includes(clip));
      if (!g) return null;
      const zurueck = pausiereFuerMessung(gruppen, g);
      const rot = d.root.rotationQuaternion?.clone() ?? null;
      d.root.rotationQuaternion = Quaternion.Identity();
      const lies = (bild: number): Float32Array[] => {
        g.goToFrame(bild);
        d.root.computeWorldMatrix(true);
        for (const tn of d.root.getChildTransformNodes(false)) tn.computeWorldMatrix(true);
        const aus: Float32Array[] = [];
        for (const m of d.root.getChildMeshes()) {
          if (m.getTotalVertices() === 0) continue;
          m.skeleton?.prepare(true);
          m.computeWorldMatrix(true);
          const daten = m.getPositionData(true);
          if (daten) aus.push(Float32Array.from(daten as ArrayLike<number>));
        }
        return aus;
      };
      const erstes = lies(g.from);
      const letztes = lies(g.to);
      // Control: the same reading to the MIDDLE of the clip. A jump of 0 means
      // nothing if the frame change did not reach the mesh at all.
      const mitte = lies((g.from + g.to) / 2);
      d.root.rotationQuaternion = rot;
      zurueck();
      let max = 0;
      let summe = 0;
      let n = 0;
      let zurMitteMax = 0;
      erstes.forEach((a, k) => {
        const c = mitte[k]!;
        for (let i = 0; i + 2 < a.length; i += 3) {
          zurMitteMax = Math.max(zurMitteMax, Math.hypot(a[i]! - c[i]!, a[i + 1]! - c[i + 1]!, a[i + 2]! - c[i + 2]!));
        }
      });
      erstes.forEach((a, k) => {
        const b = letztes[k]!;
        for (let i = 0; i + 2 < a.length; i += 3) {
          const dist = Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!);
          max = Math.max(max, dist);
          summe += dist;
          n++;
        }
      });
      return { max, mittel: n ? summe / n : 0, vertices: n, zurMitteMax };
    }
    return null;
  }

  updateDynamics(dt: number): void {
    const f = 1 - Math.exp(-dt / 0.09);
    // Animations-LOD (fps-analyse #9): die Kamerafrustum-Ebenen kostet EINMAL
    // je Bild etwas, nicht je Instanz — dieselben sechs Ebenen gelten fuer
    // alle. Ohne aktive Kamera (z. B. im allerersten Bild) passiert nichts.
    const kamera = this.scene.activeCamera;
    const lodEbenen = kamera ? Frustum.GetPlanes(kamera.getTransformationMatrix()) : null;
    const lodKameraPos = kamera ? kamera.globalPosition : null;
    for (const dyn of this.dynamics.values()) {
      if (lodEbenen && lodKameraPos) this.aktualisiereAnimationsLod(dyn, lodEbenen, lodKameraPos);
      const z = dyn.ziel;
      if (!z) continue;
      const g = dyn.gang;
      if (!g) {
        const vorherX = dyn.root.position.x;
        const vorherZ = dyn.root.position.z;
        Vector3.LerpToRef(dyn.root.position, z.pos, f, dyn.root.position);
        if (dyn.root.rotationQuaternion) {
          Quaternion.SlerpToRef(dyn.root.rotationQuaternion, z.rot, f, dyn.root.rotationQuaternion);
        }
        if (dyn.clipTempo) {
          this.koppleClipTempo(
            dyn,
            dt,
            Math.hypot(dyn.root.position.x - vorherX, dyn.root.position.z - vorherZ)
          );
        }
        continue;
      }
      // ── Prozeduraler Gang ─────────────────────────────────────────
      // Die BASIS gleitet zum Server-Ziel; das Tempo kommt aus ihrer
      // eigenen Bewegung, nicht aus den 50-ms-Sprüngen des Ziels.
      const vorherX = g.basisPos.x;
      const vorherZ = g.basisPos.z;
      Vector3.LerpToRef(g.basisPos, z.pos, f, g.basisPos);
      Quaternion.SlerpToRef(g.basisRot, z.rot, f, g.basisRot);
      const schritt = Math.hypot(g.basisPos.x - vorherX, g.basisPos.z - vorherZ);
      const tempoRoh = dt > 0 ? schritt / dt : 0;
      g.tempo += (tempoRoh - g.tempo) * Math.min(1, dt * 6);

      const bewegt = g.tempo > 0.3;
      // Schrittfrequenz wächst mit dem Tempo (Trab → Galopp); im Stand
      // bleibt ein langsames Atmen übrig.
      g.phase += dt * (bewegt ? 1.6 + g.tempo * 0.5 : 0.4) * Math.PI * 2;
      // |sin|: zwei Bodenkontakte pro Periode — das typische Auf-und-Ab
      // eines Vierbeiners statt eines schwebenden Sinus.
      const hub = bewegt
        ? Math.abs(Math.sin(g.phase)) * Math.min(0.05 + g.tempo * 0.02, 0.16)
        : 0;
      const nick = bewegt ? Math.sin(g.phase) * 0.06 : Math.sin(g.phase) * 0.012;
      dyn.root.position.set(g.basisPos.x, g.basisPos.y + hub, g.basisPos.z);
      if (dyn.root.rotationQuaternion) {
        Quaternion.FromEulerAnglesToRef(nick, 0, 0, GANG_NICK_TMP);
        g.basisRot.multiplyToRef(GANG_NICK_TMP, dyn.root.rotationQuaternion);
      }
    }
  }

  /**
   * Animations-LOD (fps-analyse #9): pausiert die Animationsgruppen einer
   * Instanz, die weder im Sichtkegel noch naeher als
   * {@link ANIMATIONS_LOD_GRENZE_M} steht, und setzt sie beim Rueckkehren
   * ohne Sprung fort (animationsLod.ts).
   *
   * `attack` ist ein Kampfzustand: der Server schickt ihn nur waehrend ein
   * NPC gerade zuschlaegt, und ein zuschlagendes NPC pausieren hiesse, es im
   * Ausholen einzufrieren, sobald es zufaellig aus dem Sichtkegel faellt.
   * Der lokale Spieler laeuft NIE durch diese Funktion — er haengt nicht in
   * `dynamics` und hat gar keine `animGruppen` (AvatarRig.ts treibt sein
   * Rig prozedural, nicht ueber AssetManager.wechsleAnimation).
   *
   * FREMDE Spieler (`dyn.istSpieler`) sind ebenfalls ausgenommen — die
   * Karte verlangt "Spieler ... laufen immer" ausdruecklich getrennt von
   * "die eigene Figur": anders als NPCs sind es nur eine Handvoll
   * Instanzen, und ein anderer Mitspieler soll nie durch einen
   * LOD-Stillstand auffallen.
   *
   * Die Spawn-Vorschau im Editor-Testflug (`dyn.istVorschau`) ist ebenso
   * ausgenommen (Nachbesserung B6) — s. Feldkommentar an `istVorschau`.
   *
   * Sichtbarkeit (Nachbesserung B4): keine Punktprobe an der Fusssohle
   * mehr, sondern eine Kugel um die gemessene Huellmitte
   * (`berechneLodHuelle`, `istKugelImSichtkegel`) — ein Punkttest liess
   * sichtbare Figuren am Bildrand faelschlich einfrieren, besonders lange
   * Tiere und bei Blick nach oben/unten.
   *
   * Skalierung (Nachbesserung N2, A5): `lodMitteY`/`lodRadius` sind vom
   * Messzeitpunkt eingefroren. Weicht `dyn.root.scaling` seither von
   * `dyn.lodSkalierungBeiMessung` ab, wird NACHskaliert statt neu vermessen
   * (kein Alloc je Bild). Heute nicht erreichbar (Kreaturen aendern ihre
   * Skalierung zur Laufzeit nicht, und Testflug-/Editor-Vorschau sind ohnehin
   * ausgenommen), aber ohne Kosten fuer den Fall, dass sich das aendert.
   *
   * Vergessene Pausen (Hinweis, A6): eine gemerkte, pausierte Gruppe, die
   * NIE zurueckkehrt (z. B. weil eine kuenftige Ueberblendung zwei Gruppen
   * gleichzeitig spielen liesse und nur eine von `wendeAnimationsLodAn`
   * fortgesetzt wird), bleibt fuer immer `isStarted && !isPlaying` stehen.
   * Ein spaeterer `start()` auf GENAU dieser Gruppe wuerde in Babylon 9.28
   * sofort abbrechen (`_isStarted`-Wächter), die Figur bliebe dann starr.
   * Heute nicht erreichbar: jeder Verdrahtungsweg (`wechsleAnimation`,
   * `spieleEinmal(Kreatur)`, `starteAnfangsgruppe`) stoppt vorher ALLE
   * anderen Gruppen der Instanz. Robuster waere, eine vergessene Gruppe mit
   * `stop()` statt stillschweigend liegenzulassen — keine Aenderung hier,
   * nur der Hinweis fuer eine kuenftige Mehrgruppen-Verdrahtung.
   */
  private aktualisiereAnimationsLod(dyn: DynamicEntity, ebenen: Plane[], kameraPos: Vector3): void {
    if (dyn.istSpieler || dyn.istVorschau) return;
    if (dyn.anim === 'attack') {
      if (dyn.lodPausiert) dyn.lodPausiert = wendeAnimationsLodAn(this.assets.gruppenVon(dyn.root), dyn.lodPausiert, true);
      return;
    }
    const distanzM = Vector3.Distance(kameraPos, dyn.root.position);
    let mitteY = dyn.lodMitteY ?? 0.9;
    let radius = dyn.lodRadius ?? ANIMATIONS_LOD_MIN_RADIUS_M;
    const gemessen = dyn.lodSkalierungBeiMessung;
    if (gemessen) {
      const aktuell = dyn.root.scaling;
      mitteY *= gemessen.y !== 0 ? aktuell.y / gemessen.y : 1;
      radius *= Math.max(
        gemessen.x !== 0 ? aktuell.x / gemessen.x : 1,
        gemessen.y !== 0 ? aktuell.y / gemessen.y : 1,
        gemessen.z !== 0 ? aktuell.z / gemessen.z : 1
      );
    }
    LOD_MITTE_TMP.copyFrom(dyn.root.position);
    LOD_MITTE_TMP.y += mitteY;
    const imSichtkegel = istKugelImSichtkegel(LOD_MITTE_TMP, radius, ebenen);
    const animieren = sollAnimieren(distanzM, imSichtkegel, ANIMATIONS_LOD_GRENZE_M);
    dyn.lodPausiert = wendeAnimationsLodAn(this.assets.gruppenVon(dyn.root), dyn.lodPausiert, animieren);
  }

  /**
   * Couple the playing walk/run clip to the ground speed the root really
   * has this frame (clipTempo.ts). Idle and every state without an entry in
   * `animationTempo` play as authored.
   */
  private koppleClipTempo(dyn: DynamicEntity, dt: number, schritt: number): void {
    const k = dyn.clipTempo!;
    const roh = dt > 0 ? schritt / dt : 0;
    k.ist += (roh - k.ist) * Math.min(1, dt * 6);
    const rate = clipRate(k.ist, dyn.anim ? k.tabelle[dyn.anim] : undefined);
    if (Math.abs(rate - k.rate) < 0.005) return;
    k.rate = rate;
    this.assets.setzeAnimationsTempo(dyn.root, rate);
  }

  // ── Dynamic (instantiated hierarchies) ───────────────────────────

  /**
   * Show the state the server sent. `attack` is a blow, not a pose: it plays
   * once and falls back (looping it jumped by up to 9 cm at the wrap). A model
   * without an attack clip keeps the old way (the group is not found).
   */
  private spieleZustand(dyn: DynamicEntity, zustand: string): void {
    // The state `attack` only says "in striking range". The blow itself is an
    // event (`animEinmal`), written when the damage happens — playing a swing
    // here showed blows without damage (the wolf strikes up to 2 s later).
    this.assets.wechsleAnimation(dyn.root, zustand === 'attack' ? 'idle' : zustand);
  }

  /**
   * After a one-shot: back to the state the server last sent. `attack` as a
   * state means "next to the target, striking" — the animal stands there, so
   * it falls back to `idle`, not to the run it arrived with.
   */
  private faelltZurueck(dyn: DynamicEntity): void {
    if (dyn.stirbt) return;
    // A player figure has no movement state from the server (its prefab default `Walking` names no group of
    // the body models): after a hit reaction it stands in `idle`, it must not stop with no group at all.
    const z = !dyn.istSpieler && dyn.anim && dyn.anim !== 'attack' ? dyn.anim : 'idle';
    this.assets.wechsleAnimation(dyn.root, z);
    // The fresh start plays as authored: tell the tempo coupling.
    if (dyn.clipTempo) dyn.clipTempo.rate = 1;
  }

  /** A player figure lies down with `clip` (tod_vorn / tod_hinten): plays once and stays; no state moves it afterwards. */
  private legeHin(dyn: DynamicEntity, clip: string): void {
    if (this.assets.spieleEinmalKreatur(dyn.root, clip, null)) dyn.stirbt = true;
  }

  /** One-shot events from the server (`animEinmal`): blow, hit, death. */
  private pruefeEinmal(dyn: DynamicEntity, wert: string | undefined): void {
    const e = parseEinmal(wert);
    if (!e) return;
    if (e.n === dyn.einmalN) return;
    dyn.einmalN = e.n;
    if (dyn.stirbt) return;
    if (e.clip === 'die' || istTodAnim(e.clip)) {
      // A creature dies with `die`, a player figure with `tod_vorn` / `tod_hinten` (todTreffer.ts): once, then it lies.
      this.legeHin(dyn, e.clip);
      return;
    }
    this.assets.spieleEinmalKreatur(dyn.root, e.clip, () => this.faelltZurueck(dyn));
  }

  private async applyDynamic(
    u: ZDOEntityUpdate,
    prefabName: string,
    model: string | null,
    animation?: string,
    belebt = false
  ): Promise<void> {
    // Bewegungszustand des Servers ('idle'/'walk') hat Vorrang vor der
    // festen Prefab-Animation: Routen-NPCs wechseln damit zur Laufzeit,
    // alle anderen Prefabs schicken kein `anim` und bleiben wie gehabt.
    const wunschAnim = u.anim ?? animation;
    let dyn = this.dynamics.get(u.key);
    const warNeu = !dyn;
    if (!dyn) {
      let root: TransformNode | null = null;
      if (model) {
        // A creature first seen mid-swing starts standing: `attack` is a
        // one-shot, and looping it here would be the very jump it avoids.
        root = await this.assets.instantiate(model, wunschAnim === 'attack' || istTodAnim(wunschAnim) ? 'idle' : wunschAnim);
      }
      if (!root) {
        root = makePlaceholder(this.scene, prefabName);
      }
      if (this.dynamics.has(u.key)) {
        // lost the race — another update instantiated first
        this.assets.entsorgeAnimationen(root);
        // Ohne Material/Texturen — die teilt sich diese Instanz mit allen
        // anderen desselben Prefabs (s. removeZDO).
        root.dispose(false, false);
        return;
      }
      // GLB-Wurzeln heissen alle "__root__" — für Diagnose (dynamicList,
      // dynamicPose) den Prefab-Namen drauflegen.
      root.name = prefabName;
      // An event already in the member when we first see the creature is
      // history (no late joiner replays a swing); no member counts as 0.
      dyn = {
        root,
        anim: wunschAnim,
        einmalN: parseEinmal(u.animEinmal)?.n ?? 0,
        istSpieler: prefabName === 'Player',
        istVorschau: u.key.startsWith('edplace-') || u.key === 'edghost',
      };
      const clipTabelle = findPrefabByHash(u.prefabHash)?.animationTempo;
      if (clipTabelle) dyn.clipTempo = { tabelle: clipTabelle, ist: 0, rate: 1 };
      if (model) prepareLegacyFemaleBody(root.getChildMeshes(), model);
      if (model) stabilizeHeadSkin(root.getChildMeshes());
      if (belebt) {
        dyn.gang = {
          basisPos: new Vector3(u.position.x, u.position.y, u.position.z),
          basisRot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
          // Phasen leicht streuen, damit eine Herde nicht im Gleichschritt wippt.
          phase: (getStableHash(u.key) & 0xff) * 0.1,
          tempo: 0,
        };
      }
      this.dynamics.set(u.key, dyn);
      this.dynamicCount++;
      // A player who lies dead when we first see him: show the lying pose (the fall itself is history).
      if (dyn.istSpieler && istTodAnim(wunschAnim)) this.legeHin(dyn, wunschAnim);
    } else if (wunschAnim && wunschAnim !== dyn.anim) {
      dyn.anim = wunschAnim;
      // A revived player figure stands up again: its lying pose (`anim` = tod_*) went back to a normal state.
      if (dyn.istSpieler && dyn.stirbt) dyn.stirbt = false;
      // The lying pose plays ONCE (never as a looping state): the death event plays the fall, this keeps the pose.
      if (dyn.istSpieler && istTodAnim(wunschAnim)) this.legeHin(dyn, wunschAnim);
      else if (!dyn.stirbt) this.spieleZustand(dyn, wunschAnim);
    }
    this.pruefeEinmal(dyn, u.animEinmal);
    // Trefferpunkte → Prozent. Hier und nicht im Namensschild, weil an
    // dieser Stelle Wert und Prefabname ohnehin beide vorliegen.
    if (u.health !== undefined) dyn.leben = lebenAnteil(prefabName, u.health);
    // Interpolation statt hartem Setzen: ZDO-Updates kommen im Sync-Takt
    // (50 ms + Netz-Jitter) — direktes Setzen ließe Kreaturen und fremde
    // Spieler ruckeln. Ziel merken, updateDynamics() gleitet pro Frame hin.
    const ziel = {
      pos: new Vector3(u.position.x, u.position.y, u.position.z),
      rot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    };
    if (!dyn.ziel || Vector3.DistanceSquared(dyn.root.position, ziel.pos) > 30 * 30) {
      // Erstes Update oder Teleport (Dungeon, Admin): hart setzen statt
      // quer durch die Welt zu gleiten — auch die Gang-Basis.
      dyn.root.position.copyFrom(ziel.pos);
      dyn.root.rotationQuaternion = ziel.rot.clone();
      if (dyn.gang) {
        dyn.gang.basisPos.copyFrom(ziel.pos);
        dyn.gang.basisRot.copyFrom(ziel.rot);
        dyn.gang.tempo = 0;
      }
    }
    dyn.ziel = ziel;
    // Grundskalierung des Prefabs MIT der ZDO-Skalierung verrechnen.
    //
    // Statische Prefabs bekommen ihre localScale über composeZdoWorld; im
    // dynamischen Pfad stand hier nur die ZDO-Skalierung. Prefabs, deren
    // Modell nicht in Metern vorliegt, standen dadurch in Rohgröße da — die
    // Völva mit localScale 1.75 war einen Meter groß, weil ihr GLB (wie alles
    // aus dem Generator) auf Kantenlänge 1 normiert ist.
    //
    // Für alle bisherigen dynamischen Prefabs ist localScale 1, an ihnen
    // ändert sich damit nichts.
    const basis = findPrefabByHash(u.prefabHash)?.localScale ?? { x: 1, y: 1, z: 1 };
    const s = u.scale;
    const f =
      typeof s === 'number' ? { x: s, y: s, z: s } : s ? { x: s.x, y: s.y, z: s.z } : { x: 1, y: 1, z: 1 };
    dyn.root.scaling = new Vector3(basis.x * f.x, basis.y * f.y, basis.z * f.z);
    // Animations-LOD B4: die Huelle EINMAL messen, nachdem Position, Rotation
    // UND Skalierung der neuen Instanz feststehen — nicht frueher (die rohe,
    // unskalierte Geometrie waere zu klein) und nicht jedes Mal (das waere
    // die Allokation je Figur und Bild, die B4 ausschliesst).
    if (warNeu) {
      const huelle = berechneLodHuelle(dyn.root);
      dyn.lodMitteY = huelle.mitteY;
      dyn.lodRadius = huelle.radius;
      // A5: `dyn.root.scaling` wird nie in-place mutiert (immer ein neues
      // Vector3 oben), die Referenz bleibt also auf dem Messwert stehen.
      dyn.lodSkalierungBeiMessung = dyn.root.scaling;
    }
  }

  // ── Location terrain leveling (F4) ───────────────────────────────

  private applyLocationLeveling(featureHash: number, position: { x: number; y: number; z: number }): void {
    const feature = getFeatureByHash(featureHash);
    if (!feature) return;
    const leveling = getTerrainLeveling(feature);
    if (!leveling) return;
    const affected = this.world.heightmaps.addTerrainModifier({
      x: position.x,
      z: position.z,
      targetHeight: f32(position.y + leveling.levelOffset),
      levelRadius: leveling.levelRadius,
      smoothRadius: leveling.smoothRadius,
      smoothPower: leveling.smoothPower,
      square: leveling.square,
    });
    this.terrain.rebuildZones(affected);
  }
}
