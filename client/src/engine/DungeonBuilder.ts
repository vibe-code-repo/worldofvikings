/**
 * DungeonBauer — der Client-Adapter des Dungeon-Generators 2.0 (AP6).
 * DungeonBuilder — the client adapter of dungeon generator 2.0 (AP6).
 *
 * Er nimmt die Bauteile aus `shared/src/dungeon2/builder.ts` und macht daraus
 * Babylon-Meshes, Havok-Koerper und Lichtquellen. Er entscheidet NICHTS ueber
 * Form: jede Zahl, die hier in einen Vertex geht, kommt aus dem reinen Bauer.
 * It takes the pieces from `shared/src/dungeon2/builder.ts` and turns them into
 * Babylon meshes, Havok bodies and light sources. It decides NOTHING about
 * shape: every number that enters a vertex here comes from the pure builder.
 *
 * ── Die vier Zusagen dieses Moduls / the four promises of this module ───────
 *
 * (1) EIN gemergtes Mesh je (Block x materialTag) — nicht je Bauteil und nicht
 *     eines fuer den ganzen Dungeon (ARCHITECTURE W3). Bloecke sind gleich
 *     gross und gitterausgerichtet; ein Raum waere es nicht, weil Stempel sich
 *     ueberlappen duerfen.
 *     ONE merged mesh per (block x materialTag) — not per piece and not one for
 *     the whole dungeon (ARCHITECTURE W3).
 *
 * (2) Kollision kommt aus `BauErgebnis.kollision`, NIE aus der Sichtgeometrie
 *     (ARCHITECTURE W10, Vertragsregel 1). Damit aendert ein Kunstpass nicht
 *     das Laufgefuehl — und die Grafikstufe erst recht nicht: die Stufe filtert
 *     `stuecke`, `kollision` bleibt bitgleich. `stufeAendertKollisionNicht()`
 *     misst genau das.
 *     Collision comes from `BauErgebnis.kollision`, NEVER from the rendered
 *     mesh (ARCHITECTURE W10, contract rule 1).
 *
 * (3) Ressourcenbesitz je Instanzwurzel. `mesh.dispose(_, true)` wuerde das
 *     GETEILTE Dungeon-Material aller laufenden Instanzen mitreissen — deshalb
 *     raeumt dieses Modul Meshes ausdruecklich mit `dispose(false, false)` ab
 *     und zaehlt die Materialnutzer selbst. Die Texturarrays gehoeren dem
 *     Aufrufer und werden hier NIE freigegeben.
 *     Resource ownership per instance root. `mesh.dispose(_, true)` would tear
 *     down the SHARED dungeon material of every running instance.
 *
 * (4) `dungeonBereit` ist eine Zusage ueber die Bloecke UM DEN SPAWN, nicht
 *     ueber den ganzen Dungeon. In einer Instanz gibt es kein `terrain.ready`;
 *     ohne diese Zusage blendet der Ladebildschirm aus, waehrend der Spieler
 *     noch durch den Boden faellt (Vault: „Ladebildschirm haengt am Gelaende").
 *     `dungeonBereit` is a promise about the blocks AROUND THE SPAWN, not about
 *     the whole dungeon. Inside an instance there is no `terrain.ready`.
 */
import { Mesh, TransformNode, VertexData } from '@babylonjs/core/Meshes';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import {
  PhysicsShape,
  PhysicsShapeBox,
  PhysicsShapeContainer,
} from '@babylonjs/core/Physics/v2/physicsShape';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { dungeon2, findPrefabByName, type PrefabDef } from '@wov/shared';
import {
  DUNGEON_SCHICHT_ATTRIBUT,
  DungeonGrafikStufe,
  STEINGRAB_THEMA,
  dungeonStufe,
  erzeugeDungeonMaterial,
  setzeDungeonStufe,
  type DungeonThema,
} from './DungeonMaterial';
import type { DungeonMaterialArrays } from './DungeonMaterialArrays';
import type { Lichtquelle } from './LightPool';

type BlockId = dungeon2.BlockId;
type BauStueck = dungeon2.BauStueck;
type BauStueckArt = dungeon2.BauStueckArt;
type BauErgebnis = dungeon2.BauErgebnis;
type KollisionsKoerper = dungeon2.KollisionsKoerper;
type DungeonLayout2 = dungeon2.DungeonLayout2;
type ZellenGitter = dungeon2.ZellenGitter;

/**
 * Bauteilarten, die auf Stufe Niedrig entfallen. Genau die beiden, die der
 * Bauer selbst als erste nennt (`BauStueckArt`-Kommentar): reine Zier ohne
 * Kollisionskoerper. Waeren es tragende Teile, haenge das Laufgefuehl an der
 * Grafikstufe — Vertragsregel 5, und der Grund, warum der Bauer die Stufe gar
 * nicht erst kennt.
 * Piece kinds dropped on the Low tier — exactly the two the builder itself
 * names first: pure ornament without a collision body. Were they load bearing,
 * the way it walks would depend on the graphics tier (contract rule 5).
 */
const NIEDRIG_ENTFAELLT: ReadonlySet<BauStueckArt> = new Set<BauStueckArt>(['sims', 'kante']);

/**
 * Vierundzwanzig Vertices je Quader (vier je Flaeche) — der Bauer liefert es so
 * (`stueckZuNetz`), damit Normalen flach bleiben. Die Zahl steht hier als
 * KONSTANTE und wird im Test gegen die tatsaechliche Netzlaenge gehalten: ein
 * Wechsel auf geteilte Ecken wuerde die Kanten weich machen, und weiche Kanten
 * sind das Gegenteil des Leitbilds.
 * Twenty-four vertices per box (four per face) — that is how the builder
 * delivers it, so normals stay flat. The constant is held against the actual
 * mesh length in the test.
 */
export const VERTICES_JE_QUADER = 24;

/**
 * Radius um den Spawnpunkt, ab dem `dungeonBereit` erfuellt ist (Meter).
 *
 * 48 m und nicht „ein Block": Ein Block ist 32 m, der Spawn kann an seinem Rand
 * liegen, und dann stuende der Spieler beim Ausblenden vor einem Loch. 48 m
 * deckt den Spawnblock plus seine Nachbarn in Blickrichtung ab und ist immer
 * noch weniger als ein halber Dungeon.
 * Radius around the spawn point at which `dungeonBereit` is fulfilled (metres).
 * 48 m rather than "one block": a block is 32 m and the spawn may sit at its
 * edge — the player would then face a hole when the loading screen fades.
 */
export const BEREIT_RADIUS_M = 48;

/**
 * Wie viele Bloecke ein Nachziehschritt hoechstens baut.
 *
 * Der Wert steuert die Ruckelgroesse beim Nachladen, nicht die Gesamtdauer:
 * `baueWeiter()` ist der Schritt, den der Aufrufer in seinen Bildlauf haengt.
 * Vier Bloecke sind rund 130 m Kantenlaenge — genug, dass ein Dungeon
 * ueblicher Groesse (14-22 Bloecke, gemessen ueber 120 Seeds) in fuenf
 * Schritten steht.
 * How many blocks one catch-up step builds at most. It steers stutter size, not
 * total duration.
 */
export const BLOECKE_JE_SCHRITT = 4;

/** Was der Bauer erzeugt hat — zum Messen, nicht zum Spielen. */
/** What the builder produced — for measuring, not for playing. */
export interface DungeonBauStatistik {
  /** Bloecke, die ueberhaupt etwas enthalten. / Blocks containing anything. */
  readonly bloeckeGesamt: number;
  readonly bloeckeGebaut: number;
  /** Meshes = Zeichenaufrufe der Architektur. / Meshes = architecture draw calls. */
  readonly meshes: number;
  readonly dreiecke: number;
  readonly vertices: number;
  /** Havok-Koerper (einer je Block). / Havok bodies (one per block). */
  readonly koerper: number;
  /** Einzelformen in den Koerpern. / Individual shapes inside the bodies. */
  readonly formen: number;
  /** Materialien, die dieser Bauer besitzt. / Materials this builder owns. */
  readonly materialien: number;
}

/** Stellschrauben des Bauers. / Knobs of the builder. */
export interface DungeonBauOptionen {
  /** Material-Thema; `materialSeed` wird aus dem Layout gesetzt. / Material theme. */
  readonly thema?: DungeonThema;
  /** Texturarrays; `null` = graue Kaesten (der AP6-Zustand). / Texture arrays. */
  readonly arrays?: DungeonMaterialArrays | null;
  /**
   * Havok-Koerper anlegen. Voreinstellung: ja, sobald die Szene eine Physik
   * hat. Ohne Physik ist der Dungeon eine Kulisse — der Vorschaumodus nutzt
   * genau das.
   * Create Havok bodies. Default: yes, as soon as the scene has physics.
   */
  readonly physik?: boolean;
  /** Radius der `dungeonBereit`-Zusage in Metern. / Radius of the ready promise. */
  readonly bereitRadiusM?: number;
  /** Namenspraefix aller erzeugten Knoten. / Name prefix of all created nodes. */
  readonly name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Geteilte Materialien / shared materials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein Material je (Szene, Thema, Material-Seed) — mit Nutzerzaehler.
 *
 * Warum ueberhaupt teilen: Zwei Instanzen desselben Dungeons (zwei Spieler in
 * getrennten Kopien) haben dieselben Zahlen im Shader; zwei Materialien waeren
 * zwei Effekte und zwei Uebersetzungen. Warum ein ZAEHLER und kein einfaches
 * „gehoert der Szene": Der Abbautest verlangt, dass Mesh-, Material- und
 * Texturzahl der Szene nach zwanzig Auf-/Abbauten EXAKT auf den Ausgangswert
 * zurueckkehrt. Ein Material, das „einfach liegen bleibt", ist ein Leck, das
 * erst nach Stunden auffaellt.
 * One material per (scene, theme, material seed), with a user count. Sharing:
 * two instances of the same dungeon have the same shader numbers. Counting: the
 * teardown test demands the scene's mesh, material and texture counts return
 * EXACTLY to their starting values after twenty build/teardown cycles.
 *
 * Der Seed gehoert in den Schluessel, weil er im Uniform steckt (`dgTriplanar`,
 * Seed als zwei 16-Bit-Haelften). Zwei Graeber mit verschiedenem Material-Seed
 * duerfen sich das Material NICHT teilen — sonst haetten beide dieselben Risse.
 * The seed belongs in the key because it sits in a uniform: two barrows with
 * different material seeds must NOT share a material, else both get the same
 * cracks.
 */
interface MaterialEintrag {
  readonly material: PBRMaterial;
  nutzer: number;
}
const materialRegister = new WeakMap<Scene, Map<string, MaterialEintrag>>();

function materialSchluessel(thema: DungeonThema, arrays: DungeonMaterialArrays | null): string {
  return `${thema.materialSeed >>> 0}|${arrays === null ? 'grau' : 'array'}|${thema.schaerfe}|${thema.kollapsSchwelle}`;
}

function holeMaterial(
  scene: Scene,
  name: string,
  thema: DungeonThema,
  arrays: DungeonMaterialArrays | null
): PBRMaterial {
  let proSzene = materialRegister.get(scene);
  if (proSzene === undefined) {
    proSzene = new Map<string, MaterialEintrag>();
    materialRegister.set(scene, proSzene);
  }
  const schluessel = materialSchluessel(thema, arrays);
  const vorhanden = proSzene.get(schluessel);
  if (vorhanden !== undefined) {
    vorhanden.nutzer++;
    return vorhanden.material;
  }
  const material = erzeugeDungeonMaterial(scene, `${name}_mat`, arrays, thema);
  proSzene.set(schluessel, { material, nutzer: 1 });
  return material;
}

function gibMaterialFrei(scene: Scene, material: PBRMaterial): void {
  const proSzene = materialRegister.get(scene);
  if (proSzene === undefined) return;
  for (const [schluessel, eintrag] of proSzene) {
    if (eintrag.material !== material) continue;
    eintrag.nutzer--;
    if (eintrag.nutzer > 0) return;
    proSzene.delete(schluessel);
    // `dispose(true, false)`: Effekt weg, TEXTUREN NICHT. Die Arrays gehoeren
    // dem Aufrufer (`ladeDungeonMaterialArrays`) und ueberleben absichtlich
    // jede Instanz — sie einmal je Betreten zu laden waere ein Ladebalken je
    // Tuer.
    // `dispose(true, false)`: drop the effect, NOT the textures. The arrays
    // belong to the caller and deliberately outlive every instance.
    eintrag.material.dispose(true, false);
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Kollisionsformen / collision shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eine fertig gerechnete Kollisionsform: Mitte, halbe Ausdehnungen und Drehung
 * — in Weltkoordinaten, ohne Babylon.
 * A finished collision shape: centre, half extents and rotation — in world
 * coordinates, without Babylon.
 *
 * Sie ist ein eigener Typ, weil die Rampenrechnung sonst nur mit laufender
 * Physik pruefbar waere. Havok laesst sich in Node nicht verlaesslich starten;
 * die Zahlen aber schon — und die Zahlen sind es, auf denen der Spieler steht.
 * It is a type of its own because the ramp maths would otherwise only be
 * checkable with a running physics engine. Havok does not start reliably under
 * Node; the numbers do — and the numbers are what the player stands on.
 */
export interface KollisionsForm {
  readonly mitte: { x: number; y: number; z: number };
  /** Halbe Kantenlaengen VOR der Drehung. / Half edge lengths BEFORE rotation. */
  readonly halbe: { x: number; y: number; z: number };
  /** Drehachse ('x' | 'z') und Winkel im Bogenmass; 0 = achsparallel. */
  /** Rotation axis and angle in radians; 0 = axis aligned. */
  readonly achse: 'x' | 'z' | null;
  readonly winkel: number;
}

/** Dicke der Bodenplatte in Metern — dieselbe Zahl wie in `cells.ts`. */
/** Floor slab thickness in metres — the same number as in `cells.ts`. */
const BODEN_DICKE_M = dungeon2.BODEN_DICKE_STUFEN * dungeon2.HOEHEN_SCHRITT_M;

/**
 * Kollisionskoerper -> Form. Boxen gehen eins zu eins durch; eine Rampe wird
 * zur GEKIPPTEN Platte.
 * Collision body -> shape. Boxes pass through one to one; a ramp becomes a
 * TILTED slab.
 *
 * Warum gekippt und nicht die Stufenquader der Optik: Der Bauer liefert
 * ausdruecklich EINEN Rampenkoerper je Treppenzelle und acht Stufenquader fuer
 * das Bild — „die Optik ist gestuft, die Kollision glatt". Wer hier die Stufen
 * naehme, machte eine feinere Treppe zu einer Aenderung des Laufgefuehls.
 * Why tilted rather than the visual step boxes: the builder explicitly delivers
 * ONE ramp body per stair cell and eight step boxes for the picture — "the
 * visuals are stepped, the collision smooth".
 *
 * `steigung` ist der Anstieg in Hoehenstufen ueber EINE Zelle, gemessen in
 * Neigungsrichtung; `drehung` ist diese Richtung (0 = +z, 1 = +x, 2 = -z,
 * 3 = -x, dieselbe Zuordnung wie `cells.kantenDrehung`). Ein nicht positiver
 * Anstieg kommt vor — der Bauer klemmt die Oberkante dann selbst auf die
 * Bodenhoehe, die Form ist also eine flache Platte und keine Rampe.
 * `steigung` is the rise in height steps over ONE cell, measured along the
 * ascent direction; `drehung` is that direction. A non-positive rise occurs —
 * the builder clamps the top edge to floor height itself.
 */
export function kollisionsForm(koerper: KollisionsKoerper): KollisionsForm {
  const halbe = {
    x: koerper.groesse.x / 2,
    y: koerper.groesse.y / 2,
    z: koerper.groesse.z / 2,
  };
  const anstieg = koerper.steigung ?? 0;
  if (koerper.form !== 'rampe' || anstieg <= 0) {
    return { mitte: { ...koerper.mitte }, halbe, achse: null, winkel: 0 };
  }

  // Laengs der Neigung: 0/2 zeigen in z, 1/3 in x.
  // Along the ascent: 0/2 point along z, 1/3 along x.
  const laengsZ = koerper.drehung === 0 || koerper.drehung === 2;
  const lauf = laengsZ ? koerper.groesse.z : koerper.groesse.x;
  const quer = laengsZ ? koerper.groesse.x : koerper.groesse.z;
  const hub = anstieg * dungeon2.HOEHEN_SCHRITT_M;
  const winkel = Math.atan2(hub, lauf);
  const laenge = Math.sqrt(lauf * lauf + hub * hub);

  // Die Oberkante der Rampe laeuft von der Bodenoberkante der tiefen Seite bis
  // `hub` darueber. Ihre Mitte liegt also genau `hub/2` ueber der tiefen
  // Bodenoberkante — und die ist die Unterkante des Rampenquaders plus die
  // Bodendicke (`baueStufen` setzt `ys0 = unten - BODEN_DICKE_STUFEN`).
  // The ramp's top edge runs from the low side's floor top up by `hub`. Its
  // midpoint therefore sits exactly `hub/2` above that floor top, which is the
  // ramp box's underside plus the slab thickness.
  const bodenOben = koerper.mitte.y - halbe.y + BODEN_DICKE_M;
  const obenMitte = { x: koerper.mitte.x, y: bodenOben + hub / 2, z: koerper.mitte.z };

  // Vom Mittelpunkt der Oberflaeche um eine halbe Dicke ENTLANG DER
  // FLAECHENNORMALEN nach unten — nicht senkrecht. Senkrecht waere um
  // `1 - cos(winkel)` daneben, bei 45 Grad also um 15 cm: genug, dass ein
  // Spieler an der Treppenkante haengt.
  // From the surface midpoint half a thickness down ALONG THE SURFACE NORMAL,
  // not vertically. Vertically would be off by `1 - cos(angle)`.
  const cos = Math.cos(winkel);
  const sin = Math.sin(winkel);
  const vor = koerper.drehung === 0 || koerper.drehung === 1 ? 1 : -1;
  const mitte = {
    x: obenMitte.x + (laengsZ ? 0 : vor * sin * (BODEN_DICKE_M / 2)),
    y: obenMitte.y - cos * (BODEN_DICKE_M / 2),
    z: obenMitte.z + (laengsZ ? vor * sin * (BODEN_DICKE_M / 2) : 0),
  };

  return {
    mitte,
    halbe: laengsZ
      ? { x: quer / 2, y: BODEN_DICKE_M / 2, z: laenge / 2 }
      : { x: laenge / 2, y: BODEN_DICKE_M / 2, z: quer / 2 },
    // Steigt es in +z, muss die Platte um die X-Achse NEGATIV gedreht werden:
    // eine positive Drehung um +X schickt lokales +z nach unten.
    // Rising along +z means a NEGATIVE turn about X: a positive turn about +X
    // sends local +z downwards.
    achse: laengsZ ? 'x' : 'z',
    winkel: laengsZ ? -vor * winkel : vor * winkel,
  };
}

/** Hoehe der Oberflaeche einer Form an (x,z), oder `null` ausserhalb. */
/** Height of a shape's surface at (x,z), or `null` outside of it. */
export function formOberkante(form: KollisionsForm, x: number, z: number): number | null {
  if (form.achse === null) {
    if (Math.abs(x - form.mitte.x) > form.halbe.x) return null;
    if (Math.abs(z - form.mitte.z) > form.halbe.z) return null;
    return form.mitte.y + form.halbe.y;
  }
  // Gekippte Platte: die Oberflaeche ist eine Ebene durch die Mitte, um
  // `halbe.y` entlang der Normalen angehoben.
  // Tilted slab: the surface is a plane through the centre, lifted by `halbe.y`
  // along the normal.
  const cos = Math.cos(form.winkel);
  const sin = Math.sin(form.winkel);
  const dx = x - form.mitte.x;
  const dz = z - form.mitte.z;
  // Drehung um X: lokal (dx, dy, dz) -> die Laengsachse ist z.
  // Turn about X: the long axis is z.
  const laengs = form.achse === 'x' ? dz : dx;
  const quer = form.achse === 'x' ? dx : dz;
  const halbLaengs = form.achse === 'x' ? form.halbe.z : form.halbe.x;
  const halbQuer = form.achse === 'x' ? form.halbe.x : form.halbe.z;
  if (Math.abs(quer) > halbQuer) return null;
  // Laengsanteil IN Plattenkoordinaten. Nicht `laengs * cos`: die Oberflaeche
  // liegt eine halbe Dicke ueber der Plattenmitte, und dieser Versatz hat
  // seinerseits einen Laengsanteil (`halbe.y * sin`). Wer ihn weglaesst,
  // schneidet die Rampe an ihren Enden um bis zu eine halbe Dicke zu kurz ab —
  // genau dort, wo der Spieler auf die Treppe tritt.
  // Longitudinal component IN slab coordinates. Not `laengs * cos`: the surface
  // sits half a thickness above the slab centre and that offset has a
  // longitudinal component of its own.
  const vorzeichen = form.achse === 'x' ? -1 : 1;
  const u = (laengs + vorzeichen * form.halbe.y * sin) / cos;
  if (Math.abs(u) > halbLaengs) return null;
  return form.mitte.y + vorzeichen * laengs * (sin / cos) + form.halbe.y / cos;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Der Bauer / the builder
// ─────────────────────────────────────────────────────────────────────────────

/** Was ein gebauter Block an Ressourcen haelt. / Resources of one built block. */
interface GebauterBlock {
  readonly schluessel: string;
  readonly meshes: Mesh[];
  koerper: PhysicsBody | null;
  formenSchale: PhysicsShape | null;
  kindFormen: PhysicsShape[];
  knoten: TransformNode | null;
  readonly formen: readonly KollisionsForm[];
  dreiecke: number;
  vertices: number;
}

export class DungeonBauer {
  /** Instanzwurzel — alles, was dieser Bauer besitzt, haengt darunter. */
  /** Instance root — everything this builder owns hangs below it. */
  readonly wurzel: TransformNode;

  /** Erfuellt, sobald die Bloecke um den Spawn stehen. / Resolved once ready. */
  readonly dungeonBereit: Promise<void>;

  private bereitAufloesen!: () => void;
  private bereitErfuellt = false;

  private readonly scene: Scene;
  private readonly layout: DungeonLayout2;
  private readonly gitter: ZellenGitter;
  private readonly thema: DungeonThema;
  private readonly arrays: DungeonMaterialArrays | null;
  private readonly physikGewuenscht: boolean;
  private readonly bereitRadiusM: number;
  private readonly name: string;

  private material: PBRMaterial | null;
  private readonly gebaut = new Map<string, GebauterBlock>();
  /** Alle Bloecke, nach Spawnnaehe sortiert. / All blocks, nearest spawn first. */
  private readonly reihenfolge: readonly BlockId[];
  private naechster = 0;
  private abgeraeumt = false;

  /** Der ausdrueckliche Spawnpunkt aus dem Bauer. / The explicit spawn point. */
  readonly spawnPunkt: Vector3;
  /** Deko-Plaetze mit aufgeloestem Prefab. / Decor places with resolved prefabs. */
  readonly dekoTeile: readonly dungeon2.BestuecktesTeil[];

  constructor(scene: Scene, layout: DungeonLayout2, optionen: DungeonBauOptionen = {}) {
    this.scene = scene;
    this.layout = layout;
    this.name = optionen.name ?? `dungeon2_${layout.id}`;
    this.arrays = optionen.arrays ?? null;
    this.bereitRadiusM = optionen.bereitRadiusM ?? BEREIT_RADIUS_M;

    // Das Gitter EINMAL ausrollen und in jeden Blockbau hineinreichen. Ohne das
    // rollt `baueGeometrie` je Block erneut aus — dasselbe Ergebnis, aber die
    // Arbeit eines Vollbaus je Block. Der Bauer sagt das ausdruecklich zu.
    // Roll out the grid ONCE and hand it into every block build. Without it
    // `baueGeometrie` rolls out per call — same result, full-build work each.
    this.gitter = dungeon2.zellenAufbauen(layout);

    // Der Material-Seed des Layouts ist der Hash-Ursprung im Shader (W8). Er
    // wird hier gesetzt und nicht vom Aufrufer erwartet: ein Thema ohne den
    // Seed des Dungeons zeichnete in jedem Grab dieselben Risse.
    // The layout's material seed is the shader's hash origin (W8). It is set
    // here, not expected from the caller.
    const basis = optionen.thema ?? STEINGRAB_THEMA;
    this.thema = { ...basis, materialSeed: layout.seeds.material >>> 0 };

    const profil = dungeon2.themaFinden(layout.thema);
    const voll = dungeon2.baueGeometrie(layout, { gitter: this.gitter });
    this.spawnPunkt = new Vector3(voll.spawnPunkt.x, voll.spawnPunkt.y, voll.spawnPunkt.z);
    this.dekoTeile = profil === undefined ? [] : dungeon2.bestuecke(voll.dekoPlaetze, profil);

    this.physikGewuenscht = optionen.physik ?? scene.getPhysicsEngine() !== null;

    this.reihenfolge = sortiereNachSpawn(dungeon2.bloeckeDesGitters(this.gitter), voll.spawnPunkt);

    this.wurzel = new TransformNode(this.name, scene);
    this.material = holeMaterial(scene, this.name, this.thema, this.arrays);

    this.dungeonBereit = new Promise<void>((aufloesen) => {
      this.bereitAufloesen = aufloesen;
    });
  }

  /** Alle Bloecke auf einmal. Fuer Tests und kleine Graeber. / All at once. */
  baueAlles(): void {
    while (this.baueWeiter(Number.MAX_SAFE_INTEGER)) {
      /* leer — `baueWeiter` zaehlt selbst weiter / empty, it counts itself */
    }
  }

  /**
   * Baut die Bloecke im `bereitRadiusM` um den Spawn und loest `dungeonBereit`.
   * Builds the blocks within `bereitRadiusM` of the spawn and resolves.
   *
   * Der Spawnblock ist IMMER dabei, auch wenn der Radius auf 0 stuende: Ein
   * Ladebildschirm, der ausblendet, waehrend unter dem Spieler nichts liegt,
   * ist schlimmer als einer, der eine Sekunde laenger steht.
   * The spawn block is ALWAYS included, even at radius 0.
   */
  baueSpawnBloecke(): void {
    const spawn = { x: this.spawnPunkt.x, y: this.spawnPunkt.y, z: this.spawnPunkt.z };
    let gebaut = 0;
    while (this.naechster < this.reihenfolge.length) {
      const block = this.reihenfolge[this.naechster]!;
      const nah = blockAbstand(block, spawn) <= this.bereitRadiusM;
      if (!nah && gebaut > 0) break;
      this.baueBlock(block);
      this.naechster++;
      gebaut++;
      if (!nah) break;
    }
    this.meldeBereit();
  }

  /**
   * Baut den naechsten Schwung Bloecke. Rueckgabe: ob noch etwas aussteht.
   * Builds the next batch of blocks. Returns whether anything is left.
   */
  baueWeiter(hoechstens: number = BLOECKE_JE_SCHRITT): boolean {
    let zahl = 0;
    while (this.naechster < this.reihenfolge.length && zahl < hoechstens) {
      this.baueBlock(this.reihenfolge[this.naechster]!);
      this.naechster++;
      zahl++;
    }
    if (this.naechster >= this.reihenfolge.length) this.meldeBereit();
    return this.naechster < this.reihenfolge.length;
  }

  /** Ob die Spawnumgebung steht. / Whether the spawn surroundings stand. */
  get bereit(): boolean {
    return this.bereitErfuellt;
  }

  /** Ob alles gebaut ist. / Whether everything is built. */
  get vollstaendig(): boolean {
    return this.naechster >= this.reihenfolge.length;
  }

  /**
   * Wechselt die Grafikstufe.
   *
   * Zwei Dinge, nicht eines: Der Shader bekommt die Stufe als Define
   * (`setzeDungeonStufe`), die GEOMETRIE aber muss neu zusammengelegt werden,
   * weil Niedrig Bauteile weglaesst. Wer nur das erste tut, sieht auf Niedrig
   * dieselben Simse in einem billigeren Shader — und misst dann eine Ersparnis,
   * die es nicht gibt.
   * Switches the graphics tier. Two things, not one: the shader gets the tier as
   * a define, but the GEOMETRY has to be merged anew because Low drops pieces.
   */
  setzeStufe(stufe: DungeonGrafikStufe): void {
    const vorher = dungeonStufe();
    setzeDungeonStufe(stufe);
    if (geometrieStufe(vorher) === geometrieStufe(stufe)) return;
    this.neuAufbauen();
  }

  /**
   * Lichtquellen fuer den `LightPool` — die Fackeln dieses Dungeons.
   * Light sources for the `LightPool` — this dungeon's torches.
   *
   * Der Bauer erzeugt KEINE Lichter. Er liefert die Liste, und der bestehende
   * Pool sucht sich die naechsten daraus: Genau so leuchten Dorffackeln und
   * Lagerfeuer heute schon, und genau deshalb gilt die Obergrenze von sechzehn
   * gleichzeitigen Quellen auch hier — ohne dass ein Dungeon mit vierzig
   * Fackeln (gemessen: 34-40 je Steingrab) vierzig Lichter aufmacht.
   * The builder creates NO lights. It supplies the list and the existing pool
   * picks the nearest from it — the same way village torches and camp fires work
   * today, and the reason the sixteen-source cap applies here too.
   */
  lichtquellen(x: number, z: number, radius: number): Lichtquelle[] {
    const r2 = radius * radius;
    const quellen: Lichtquelle[] = [];
    for (const teil of this.dekoTeile) {
      const def: PrefabDef | undefined = findPrefabByName(teil.prefab);
      if (def?.light === undefined) continue;
      const dx = teil.position.x - x;
      const dz = teil.position.z - z;
      if (dx * dx + dz * dz > r2) continue;
      quellen.push({ x: teil.position.x, y: teil.position.y, z: teil.position.z, licht: def.light });
    }
    return quellen;
  }

  /** Alle Kollisionsformen dieses Baus. / All collision shapes of this build. */
  formen(): KollisionsForm[] {
    const alle: KollisionsForm[] = [];
    for (const block of this.gebaut.values()) alle.push(...block.formen);
    return alle;
  }

  statistik(): DungeonBauStatistik {
    let meshes = 0;
    let dreiecke = 0;
    let vertices = 0;
    let koerper = 0;
    let formen = 0;
    for (const block of this.gebaut.values()) {
      meshes += block.meshes.length;
      dreiecke += block.dreiecke;
      vertices += block.vertices;
      if (block.koerper !== null) koerper++;
      formen += block.formen.length;
    }
    return {
      bloeckeGesamt: this.reihenfolge.length,
      bloeckeGebaut: this.gebaut.size,
      meshes,
      dreiecke,
      vertices,
      koerper,
      formen,
      materialien: this.material === null ? 0 : 1,
    };
  }

  /**
   * Raeumt alles ab, was dieser Bauer erzeugt hat — und NUR das.
   * Tears down everything this builder created — and ONLY that.
   *
   * `mesh.dispose(false, false)`: kein Material, keine Texturen. Das zweite
   * Argument ist die Falle aus AP6: `dispose(_, true)` gaebe das GETEILTE
   * Dungeon-Material frei, und jede andere laufende Instanz stuende in einer
   * Szene mit einem entsorgten Material — sichtbar als schwarze Waende in einem
   * Dungeon, den man gar nicht verlassen hat.
   * `mesh.dispose(false, false)`: no material, no textures. The second argument
   * is the AP6 trap: `dispose(_, true)` would free the SHARED dungeon material.
   */
  dispose(): void {
    if (this.abgeraeumt) return;
    this.abgeraeumt = true;
    for (const block of this.gebaut.values()) this.raeumeBlock(block);
    this.gebaut.clear();
    if (this.material !== null) {
      gibMaterialFrei(this.scene, this.material);
      this.material = null;
    }
    this.wurzel.dispose();
    // Ein nie erfuelltes Versprechen ist ein haengender Ladebildschirm. Wer
    // abbaut, bevor der Spawn stand, bekommt trotzdem eine Antwort.
    // An unresolved promise is a hanging loading screen.
    this.meldeBereit();
  }

  // ── innen / internals ─────────────────────────────────────────────────────

  private meldeBereit(): void {
    if (this.bereitErfuellt) return;
    this.bereitErfuellt = true;
    this.bereitAufloesen();
  }

  private neuAufbauen(): void {
    const bisher = this.naechster;
    for (const block of this.gebaut.values()) this.raeumeBlock(block);
    this.gebaut.clear();
    this.naechster = 0;
    while (this.naechster < bisher) {
      this.baueBlock(this.reihenfolge[this.naechster]!);
      this.naechster++;
    }
  }

  private raeumeBlock(block: GebauterBlock): void {
    for (const mesh of block.meshes) mesh.dispose(false, false);
    block.meshes.length = 0;
    block.koerper?.dispose();
    block.koerper = null;
    // Reihenfolge: erst der Koerper, dann die Schale, dann die Kinder. Eine
    // Form, die noch an einem Koerper haengt, laesst Havok nicht los.
    // Order: body, then container, then children. Havok will not release a
    // shape that is still attached to a body.
    block.formenSchale?.dispose();
    block.formenSchale = null;
    for (const form of block.kindFormen) form.dispose();
    block.kindFormen.length = 0;
    block.knoten?.dispose();
    block.knoten = null;
  }

  private baueBlock(block: BlockId): void {
    const schluessel = dungeon2.blockSchluessel(block);
    if (this.gebaut.has(schluessel)) return;

    // `blockMaterialDirtyMechanism` waehrend des Baus: jedes neue Mesh an einem
    // Material stiesse sonst eine Neuberechnung der Defines an — bei 28 bis 42
    // Meshes je Dungeon (gemessen ueber drei Seeds) also 28 bis 42 mal.
    // With `blockMaterialDirtyMechanism` during the build, every new mesh on a
    // material would otherwise trigger a define recomputation.
    const vorherBlockiert = this.scene.blockMaterialDirtyMechanism;
    this.scene.blockMaterialDirtyMechanism = true;
    try {
      const ergebnis = dungeon2.baueGeometrie(this.layout, {
        bloecke: [block],
        gitter: this.gitter,
      });
      const eintrag: GebauterBlock = {
        schluessel,
        meshes: [],
        koerper: null,
        formenSchale: null,
        kindFormen: [],
        knoten: null,
        formen: ergebnis.kollision.map(kollisionsForm),
        dreiecke: 0,
        vertices: 0,
      };
      this.baueMeshes(ergebnis, eintrag);
      this.baueKoerper(eintrag);
      this.gebaut.set(schluessel, eintrag);
    } finally {
      this.scene.blockMaterialDirtyMechanism = vorherBlockiert;
    }
  }

  private baueMeshes(ergebnis: BauErgebnis, eintrag: GebauterBlock): void {
    const proTag = new Map<number, BauStueck[]>();
    const niedrig = geometrieStufe(dungeonStufe()) === 'niedrig';
    for (const stueck of ergebnis.stuecke) {
      if (niedrig && NIEDRIG_ENTFAELLT.has(stueck.art)) continue;
      let liste = proTag.get(stueck.materialTag);
      if (liste === undefined) {
        liste = [];
        proTag.set(stueck.materialTag, liste);
      }
      liste.push(stueck);
    }

    // Aufsteigend nach Tag, damit die Meshnamen einer festen Ordnung folgen —
    // eine `Map`-Reihenfolge im Namen waere ein Zufall im Fehlerbild.
    // Ascending by tag so the mesh names follow a fixed order.
    for (const tag of [...proTag.keys()].sort((a, b) => a - b)) {
      const stuecke = proTag.get(tag)!;
      const positionen: number[] = [];
      const normalen: number[] = [];
      const uv2: number[] = [];
      const schicht: number[] = [];
      const indizes: number[] = [];

      for (const stueck of stuecke) {
        const netz = dungeon2.stueckZuNetz(stueck);
        const basis = positionen.length / 3;
        positionen.push(...netz.positionen);
        normalen.push(...netz.normalen);
        uv2.push(...netz.uv2);
        for (let i = 0; i < netz.positionen.length / 3; i++) schicht.push(stueck.materialTag);
        // UMLAUFRICHTUNG UMDREHEN — hier ist die Grenze zwischen der Mathematik
        // des Bauers und Babylons Rasterisierer, und die beiden zaehlen
        // gegenlaeufig.
        //
        // `stueckZuNetz` liefert die Dreiecke so, dass die Rechte-Hand-Normale
        // aus der Umlaufrichtung MIT der ausgeschriebenen Flaechennormale
        // zusammenfaellt; `shared/test/dungeon2-builder.ts` (B1) haengt daran
        // („vorzeichenbehaftetes Volumen positiv"). Babylon zaehlt in seinem
        // linkshaendigen System umgekehrt: bei `CreateBoxVertexData` steht die
        // Rechte-Hand-Normale ENTGEGEN der Flaechennormale. Uebernimmt man die
        // Indizes unveraendert, verwirft die Rueckflaechenentfernung genau die
        // Seiten, die in den Raum blicken — sichtbar bleibt die Rueckseite jedes
        // Quaders, und ihre Normale zeigt VON der Kamera weg.
        //
        // Das hat drei Symptome, von denen nur das dritte auffiel: der Raum
        // wirkt um eine Wandstaerke groesser; das Hemisphaerenlicht beleuchtet
        // die Decke wie einen Boden; und SSAO2 legt seine Halbkugel in den
        // Stein statt in den Raum, findet dort jede Probe verdeckt und loescht
        // ab Stufe Mittel das ganze Bild aus (gemessen: 1290 von 1290
        // GBuffer-Pixeln mit `dot(Normale, Sichtstrahl) > 0`).
        //
        // Die Umkehr steht HIER und nicht in `shared`: `shared/src/dungeon2`
        // kennt keine Engine, und die Vorzeichenregel des Volumens ist eine
        // Aussage ueber Geometrie, keine ueber Babylon.
        //
        // REVERSE THE WINDING — this is the seam between the builder's
        // mathematics and Babylon's rasteriser, and the two count in opposite
        // directions. `stueckZuNetz` emits triangles whose right-hand normal
        // agrees with the written face normal (the shared test asserts a
        // positive signed volume). Babylon's left-handed convention is the
        // reverse (see `CreateBoxVertexData`). Taken verbatim, back-face
        // culling drops exactly the sides facing into the room; what remains
        // is each box's far side, with its normal pointing AWAY from the
        // camera — which made SSAO2 sample into solid rock and black out the
        // whole image from tier Medium upwards. The reversal belongs here, not
        // in `shared`: `shared/src/dungeon2` knows no engine.
        for (let t = 0; t < netz.indizes.length; t += 3) {
          indizes.push(basis + netz.indizes[t]!, basis + netz.indizes[t + 2]!, basis + netz.indizes[t + 1]!);
        }
      }

      const mesh = new Mesh(`${this.name}_${eintrag.schluessel}_t${tag}`, this.scene);
      const daten = new VertexData();
      daten.positions = positionen;
      daten.normals = normalen;
      // `uvs2` ist Babylons Name fuer `uv2` — der Shader liest `uv2`
      // (`DUNGEON_BLEND_ATTRIBUT`). Zwei Namen fuer dieselbe Sache, und der
      // Unterschied hat kein Symptom ausser einem Blending, das nie ausschlaegt.
      // `uvs2` is Babylon's name for `uv2`, which is what the shader reads.
      daten.uvs2 = uv2;
      daten.indices = indizes;
      daten.applyToMesh(mesh, false);

      // Die Ebene je Vertex. Ohne dieses Attribut nimmt der Shader `dgFest.x`,
      // und das ist fest 0 — jede Wand traege dann das Material von Ebene 0.
      // Vier Byte je Vertex sind dagegen wohlfeil.
      // The layer per vertex. Without this attribute the shader falls back to
      // `dgFest.x`, which is a fixed 0 — every wall would wear layer 0.
      mesh.setVerticesData(DUNGEON_SCHICHT_ATTRIBUT, schicht, false, 1);

      mesh.material = this.material;
      mesh.parent = this.wurzel;
      mesh.isPickable = false;
      // Die Architektur bewegt sich nie. `freezeWorldMatrix` spart die
      // Matrixrechnung je Bild; `doNotSyncBoundingInfo` waere hier falsch, weil
      // die Huelle fuer das Frustum-Culling gebraucht wird.
      // The architecture never moves. `doNotSyncBoundingInfo` would be wrong
      // here because the bounds are needed for frustum culling.
      mesh.freezeWorldMatrix();
      // Ein Dungeon wirft keine Sonnenschatten — er hat keine Sonne. Der
      // Schattenwerfer-Zweig kostet sonst eine zweite Geometrie-Passage fuer
      // Licht, das es in einer Instanz nicht gibt.
      // A dungeon casts no sun shadows — it has no sun.
      mesh.receiveShadows = false;

      eintrag.meshes.push(mesh);
      eintrag.vertices += positionen.length / 3;
      eintrag.dreiecke += indizes.length / 3;
    }
  }

  private baueKoerper(eintrag: GebauterBlock): void {
    if (!this.physikGewuenscht) return;
    if (eintrag.formen.length === 0) return;
    if (this.scene.getPhysicsEngine() === null) return;

    // EIN Koerper je Block mit einer Sammelform. Nicht ein Koerper je Quader:
    // ein Steingrab hat 790 bis 1000 Kollisionskoerper (gemessen ueber drei
    // Seeds), und so viele Havok-Koerper waeren dieselbe Broadphase-Last wie
    // ein ganzer Wald.
    // ONE body per block with a container shape. Not one body per box: a barrow
    // has 790 to 1000 collision bodies (measured over three seeds).
    const knoten = new TransformNode(`${this.name}_${eintrag.schluessel}_koll`, this.scene);
    knoten.parent = this.wurzel;
    const schale = new PhysicsShapeContainer(this.scene);
    for (const form of eintrag.formen) {
      const drehung =
        form.achse === null
          ? Quaternion.Identity()
          : Quaternion.RotationAxis(
              form.achse === 'x' ? Vector3.Right() : Vector3.Forward(),
              form.winkel
            );
      const kind = new PhysicsShapeBox(
        new Vector3(form.mitte.x, form.mitte.y, form.mitte.z),
        drehung,
        new Vector3(form.halbe.x * 2, form.halbe.y * 2, form.halbe.z * 2),
        this.scene
      );
      schale.addChild(kind);
      eintrag.kindFormen.push(kind);
    }
    const koerper = new PhysicsBody(knoten, PhysicsMotionType.STATIC, false, this.scene);
    koerper.shape = schale;
    eintrag.knoten = knoten;
    eintrag.formenSchale = schale;
    eintrag.koerper = koerper;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Kleinkram / small helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nur zwei Geometriefassungen, nicht drei: Mittel und Hoch bauen dieselben
 * Bauteile, sie unterscheiden sich allein im Shader. Ohne diese Unterscheidung
 * bauete `setzeStufe(Hoch)` die ganze Geometrie neu, ohne dass sich ein
 * einziger Vertex aenderte.
 * Only two geometry variants, not three: Medium and High build the same pieces
 * and differ in the shader alone.
 */
function geometrieStufe(stufe: DungeonGrafikStufe): 'niedrig' | 'voll' {
  return stufe === DungeonGrafikStufe.Niedrig ? 'niedrig' : 'voll';
}

/** Weltmitte eines Blocks in der Ebene. / World centre of a block in plan. */
function blockMitte(block: BlockId): { x: number; z: number } {
  const kante = dungeon2.BLOCK_ZELLEN * dungeon2.ZELLE_M;
  return { x: (block.bx + 0.5) * kante, z: (block.bz + 0.5) * kante };
}

/**
 * Abstand eines Punktes zum Block — 0 innerhalb. Gemessen gegen die
 * Blockhuelle, nicht gegen die Blockmitte: bei 32 m Kante laege ein Punkt an
 * der Blockgrenze sonst 22 m „entfernt" von dem Block, in dem er steht.
 * Distance of a point to a block — 0 inside. Measured against the block's
 * footprint, not its centre.
 */
function blockAbstand(block: BlockId, punkt: { x: number; y: number; z: number }): number {
  const kante = dungeon2.BLOCK_ZELLEN * dungeon2.ZELLE_M;
  const mitte = blockMitte(block);
  const dx = Math.max(0, Math.abs(punkt.x - mitte.x) - kante / 2);
  const dz = Math.max(0, Math.abs(punkt.z - mitte.z) - kante / 2);
  const dy = Math.abs(block.ebene * dungeon2.EBENE_M - punkt.y);
  return Math.sqrt(dx * dx + dz * dz + dy * dy);
}

/**
 * Bauordnung: Spawnnaehe zuerst, danach die feste Ordnung (ebene, bz, bx).
 * Der zweite Teil ist kein Schmuck — ohne ihn haetten gleich weit entfernte
 * Bloecke eine von `Array.sort` abhaengige Reihenfolge, und der Ladefortschritt
 * saehe bei jedem Betreten anders aus, obwohl sich nichts geaendert hat.
 * Build order: nearest to spawn first, then the fixed order (storey, bz, bx).
 * The second part is not decoration — without it equidistant blocks would sort
 * unpredictably and the loading progress would look different every time.
 */
function sortiereNachSpawn(
  bloecke: readonly BlockId[],
  spawn: { x: number; y: number; z: number }
): BlockId[] {
  return [...bloecke].sort((a, b) => {
    const da = blockAbstand(a, spawn);
    const db = blockAbstand(b, spawn);
    if (da !== db) return da - db;
    if (a.ebene !== b.ebene) return a.ebene - b.ebene;
    if (a.bz !== b.bz) return a.bz - b.bz;
    return a.bx - b.bx;
  });
}
