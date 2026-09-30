/**
 * Types of the entity layer: static and dynamic instances, the entries of the
 * spatial index and the static buckets. With them the two helpers of the bucket
 * key: the key itself and the reader of a room's stone kit override.
 * Moved verbatim out of EntityManager.ts.
 */

import type { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { SteinKitConfig } from '@wov/shared';
import type { SicherbareGruppeMitZustand } from './animationsLod';

/**
 * Eine statische Instanz, wie `nearbyInstances()` sie herausgibt.
 *
 * Bewusst nur lesbar: Die Aufrufer bekommen die INTERNEN Indexeinträge
 * gereicht, nicht Kopien. Das spart pro Frame ein frisches Objektliteral je
 * gefundener Instanz — wer etwas davon behalten will, muss die Felder
 * einzeln übernehmen (s. ObjectLabels), niemals das Objekt selbst.
 */
export interface StatischeInstanz {
  readonly prefab: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Indexeintrag EINER statischen Instanz — Nutzsicht ist `StatischeInstanz`. */
interface IndexEintrag {
  prefab: string;
  x: number;
  y: number;
  z: number;
  /** Zelle, in der der Eintrag gerade hängt. */
  zelle: number;
  /** Platz im Zellen-Array. Macht das Entfernen O(1) statt indexOf(). */
  platz: number;
}

/**
 * Schlüssel eines statischen Buckets: der Prefabhash allein — und NUR wenn
 * ein Raum-Steinmaterial daran hängt, der Hash plus dessen JSON.
 *
 * Warum das JSON und nicht der Raumindex: Zwei Kammern mit demselben
 * Override sollen auch denselben Bucket (und damit ein Material und einen
 * Zeichenaufruf) teilen — der Index würde sie trennen, obwohl sie gleich
 * aussehen. Und ohne Override bleibt der Schlüssel wortgleich der alte,
 * es entsteht also kein zweiter Bucket, wo es früher einen gab.
 * Bucket key: prefab hash alone, or hash + the room override's JSON.
 */
function bucketSchluessel(prefabHash: number, ueberschreibung: string): string {
  return ueberschreibung ? `${prefabHash}|${ueberschreibung}` : String(prefabHash);
}

/**
 * Das JSON des Raum-Overrides einmal lesen. Unlesbares ergibt `undefined` —
 * dann gilt die Kette bis zum `RoomDef`, und die Kammer sieht aus wie ihr Typ.
 * Ein Wurf wäre hier falsch: Der Wert kommt über die Leitung, und ein einzelner
 * kaputter Member darf nicht den Aufbau der ganzen Welt anhalten.
 */
function leseSteinKitOverride(json: string): Partial<SteinKitConfig> | undefined {
  if (!json) return undefined;
  try {
    const roh: unknown = JSON.parse(json);
    if (!roh || typeof roh !== 'object') return undefined;
    return roh as Partial<SteinKitConfig>;
  } catch {
    console.warn('[EntityManager] unlesbares steinKit am Raum-ZDO — ignoriert');
    return undefined;
  }
}

interface StaticBucket {
  prefabName: string;
  /** Prefab des Buckets — der Collider-Pfad braucht die Prefab-Definition. */
  prefabHash: number;
  /** Schlüssel in `buckets`, s. {@link bucketSchluessel}. */
  schluessel: string;
  /**
   * Schlüssel für `masterMeshes`/`masterLocals`/`zellMaster`/`colliders` —
   * `prefabName`, oder `prefabName#<Override-JSON>` beim Override-Bucket.
   *
   * Getrennt vom Prefabnamen, weil sich zwei Buckets desselben Prefabs sonst
   * gegenseitig Master UND Kollisionsauswahl (samt deren Signatur)
   * überschrieben. Ohne Override ist er gleich `prefabName` — alles bleibt
   * wie zuvor.
   */
  masterKey: string;
  /**
   * Rohes JSON des Raum-Overrides (ZDO-Member `steinKit`), '' wenn keiner —
   * wortgleich vom Server übernommen und Teil von `schluessel`.
   */
  steinKitOverride: string;
  /** `steinKitOverride` EINMAL geparst; undefined, wenn keiner/unlesbar. */
  steinKitCfg?: Partial<SteinKitConfig>;
  /** zdoKey → flat matrix index */
  indexOf: Map<string, number>;
  /** flat f32 matrix buffer (16 per instance), swap-remove on destroy */
  matrices: number[];
  /** Renderdaten (Thin-Instance-Puffer) UND Collider müssen neu — ZDO-Änderung. */
  dirty: boolean;
  /** Nur der Collider muss neu — reines Verschieben des Kollisionsfensters,
   *  s. setPlayerPosition(). Renderdaten bleiben unverändert. */
  colliderDirty: boolean;
  mastersReady: boolean;
}

/**
 * Eine dynamische Instanz, wie die Namensschilder sie brauchen: wer sie ist,
 * wo sie steht und wie gross sie geraten ist. Wird WIEDERVERWENDET —
 * siehe dynamischeInstanzen().
 */
export interface DynamischeInstanz {
  /** ZDO-Schlüssel (`userId:id`, im Testflug `edplace-<i>`/`edghost`). */
  key: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  /** Weltskalierung auf der Hochachse (localScale × ZDO-Skalierung). */
  skalierungY: number;
  /**
   * Leben in PROZENT, oder -1 für „unbekannt".
   *
   * Prozent und nicht Trefferpunkte, weil hier der einzige Ort ist, an dem
   * Wert und Prefabname sicher zusammenliegen — das Namensschild bekommt
   * die Instanz, kennt aber deren Maximalwert nicht ohne einen zweiten
   * Tabellenzugriff. Umgerechnet wird mit `lebenAnteil` (shared/leben.ts).
   */
  leben: number;
}

/** Minimalform von Vector3 aus den Prefab-Daten. */
interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface DynamicEntity {
  root: TransformNode;
  /**
   * Angelegte Aussehen-Teile eines FREMDEN Spielers, nach Slot.
   * Gemerkt wird, WAS haengt, damit ein Wechsel im Spiel nur den
   * betroffenen Slot austauscht statt alles neu zu laden.
   */
  aussehen?: Map<string, { datei: string; wurzel: TransformNode }>;
  haarfarbe?: string;
  augenfarbe?: string;
  /** Letztes Server-Ziel — updateDynamics() gleitet pro Frame dorthin. */
  ziel?: { pos: Vector3; rot: Quaternion };
  /**
   * Prozedurale Gangart für Kreaturen OHNE echte Animationsclips — und das
   * sind alle Tiere: sämtliche 1.142 AnimationClips des Exports haben null
   * Kurven (komprimiertes Mecanim wurde nie dekodiert), die Tier-GLBs sind
   * ungeskinnte Starrkörper. Basis (Server-Ziel) und Anzeige (Wippen)
   * liegen getrennt, sonst flösse der Wipp-Offset in die nächste
   * Interpolation ein und die Kreatur schaukelte sich auf.
   */
  gang?: { basisPos: Vector3; basisRot: Quaternion; phase: number; tempo: number };
  /**
   * Zuletzt gestartete Animationsgruppe. Der Server schickt den
   * Bewegungszustand nur bei Änderung, aber JEDES Update trägt ihn — ohne
   * diesen Vergleich würde die Gruppe im Sync-Takt neu gestartet und der
   * Zyklus bliebe im ersten Bild hängen.
   */
  anim?: string;
  /** Counter of the last one-shot event seen (`animEinmal`); set when the creature is first seen. */
  einmalN?: number;
  /** Death clip started: the body stays as it lies, no state may move it again. */
  stirbt?: boolean;
  /**
   * Coupling of a walk/run clip to the ground speed (clipTempo.ts): the
   * prefab's clip speeds, the smoothed speed of the root and the rate last
   * given to the group. Only prefabs with `animationTempo` carry it.
   */
  clipTempo?: { tabelle: Readonly<Record<string, number>>; ist: number; rate: number };
  /**
   * Leben in Prozent, -1 = unbekannt. Wird NUR überschrieben, wenn das
   * Update den Member wirklich trägt: Ein Tick ohne `health` heisst „hat
   * sich nicht geändert", nicht „ist auf null gefallen".
   */
  leben?: number;
  /**
   * Animations-LOD (fps-analyse #9): die Gruppe, die
   * `wendeAnimationsLodAn()` pausiert hat, oder `undefined`, solange nichts
   * pausiert ist. Gehalten HIER und nicht in der Regel selbst — der
   * Aufrufer merkt sich den Zustand je Instanz, s. animationsLod.ts.
   */
  lodPausiert?: SicherbareGruppeMitZustand;
  /**
   * Animations-LOD (fps-analyse #9): FREMDER Spieler-Avatar (Prefab
   * `Player`, s. `HINT_DEFS` in shared/src/prefabs.ts) — von der Karte
   * ausdrücklich von der Pause ausgenommen ("Spieler, NPCs im Kampf und die
   * eigene Figur laufen immer"). Einmal bei der Instanziierung gesetzt und
   * danach unveränderlich, wie `prefabName` selbst.
   */
  istSpieler?: boolean;
  /**
   * Animations-LOD (fps-analyse #9, Nachbesserung B6): die Spawn-Vorschau
   * im Editor-Testflug (ZDO-Schlüssel `edplace-<i>`/`edghost`,
   * s. vorschauZeichnen.ts) — von der Pause ausgenommen. Diese Instanzen
   * werden meist aus einer hoch stehenden Editor-Kamera betrachtet, unter
   * der sie staendig ausserhalb des 60-m-Kegels oder der Distanzgrenze
   * fallen wuerden; anders als bei echten NPCs waere ein einfrierendes
   * Vorschaumodell im laufenden Editieren sofort sichtbar und verwirrend.
   * Einmal bei der Instanziierung gesetzt, wie `istSpieler`.
   */
  istVorschau?: boolean;
  /**
   * Animations-LOD (fps-analyse #9, Nachbesserung B4): Y-Versatz der
   * Huellmitte gegenueber `root.position` und Huellradius, EINMAL bei der
   * Instanziierung aus den Meshes gemessen (s. `berechneLodHuelle`). Ein
   * Punkttest an der Fusssohle liess sichtbare Figuren am Bildrand
   * (besonders lange Tiere, Blick nach oben/unten) faelschlich einfrieren.
   */
  lodMitteY?: number;
  lodRadius?: number;
  /**
   * Animations-LOD (Nachbesserung N2, A5): `root.scaling` IM MOMENT der
   * Huellmessung — dieselbe Referenz, die `applyDynamic` beim naechsten
   * Update durch ein NEUES `Vector3` ersetzt (nie in-place mutiert), bleibt
   * also eingefroren auf dem Messwert. Weicht die AKTUELLE Skalierung
   * spaeter davon ab, skaliert `aktualisiereAnimationsLod` `lodMitteY`/
   * `lodRadius` mit dem Verhaeltnis nach, statt neu zu vermessen (das waere
   * die Allokation je Figur und Bild, die B4 ausschliesst).
   */
  lodSkalierungBeiMessung?: Vector3Like;
}

export { bucketSchluessel, leseSteinKitOverride };
export type { IndexEintrag, StaticBucket, Vector3Like, DynamicEntity };
