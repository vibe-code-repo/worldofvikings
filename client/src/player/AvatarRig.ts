/**
 * AvatarRig — Spielercharakter aus `PlayerAvatar.glb` mit Geh- und
 * Rennzyklus, plus prozeduraler Klötzchenfigur als Rückfallebene.
 *
 * WARUM EIN FREMDMODELL UND NICHT DAS AUS DEM EXPORT:
 * In den gerippten Asset-Exporten existiert kein brauchbares
 * Spielermodell. Direkt aus den GLB-Dateien nachgemessen:
 *   Player.glb          0 Meshes  (reiner Rig ohne Geometrie)
 *   PlayerUnarmed.glb   1 Mesh, 149 Vertices, 0,14 m hoch,
 *                       Material "woodwall", eingebettete Textur 0 Byte
 *                       → ein fehlbenanntes Wand-/Prop-Fragment,
 *                         definitiv keine Spielfigur
 * Auch Animationen gibt es dort nicht: KEINE der 7.471 GLB-Dateien im
 * Asset-Ordner enthält einen `animations`- oder `skins`-Eintrag. Die
 * Dateien, die nach Animationen aussehen (player_idle.glb,
 * player@Walking.glb, player_Standard_Run_New.glb), enthalten
 * ausschließlich eine Knochen-Hierarchie (44–58 Nodes) ohne Keyframes,
 * ohne Mesh und ohne Skin. Das deckt sich mit der dokumentierten
 * Export-Lücke (Docs: Skins/Inverse-Bind-Matrizen wurden beim Rippen
 * systematisch verworfen — deshalb strippt tools/fix-creature-models.js
 * bei Boar/Deer/Greydwarf ebenfalls JOINTS/WEIGHTS).
 *
 * Deshalb kommt die Figur aus `assets/models/PlayerAvatar.glb` — ein
 * extern erzeugtes, gerigtes Modell (41 Knochen, Tripo-Export) mit zwei
 * Laufzyklen. Kommt die Datei nicht, bleibt die prozedurale Figur aus
 * Grundkörpern stehen; sie hat echte Gelenk-Pivots und wird über
 * dieselben Winkel bewegt.
 *
 * ── Die vier Clips ──────────────────────────────────────────────────
 * Der Export benennt sie nichtssagend (`NlaTrack`, `NlaTrack.001`,
 * `NlaTrack.002`, `NlaTrack.003`), und die Namen ändern sich mit jedem
 * Neuexport. Zugeordnet wird deshalb über die EINGEBACKENE Wegstrecke:
 *   0,0 m/s → Standposen (zwei Stück, 15,4 s und 17,6 s lange Schleifen)
 *   1,5 m/s → Gehzyklus  (1,88 s, Hüftweg 1,53)
 *   4,2 m/s → Rennzyklus (1,29 s, Hüftweg 2,98)
 * Aus derselben Messung ergibt sich das Referenztempo, mit dem
 * `speedRatio` gegen das Fußrutschen normiert wird — siehe
 * messeUndEntferneWurzelbewegung(). Kommen künftig weitere Clips dazu,
 * greift die Zuordnung weiter: langsamster bewegter = Gehen,
 * schnellster = Rennen.
 *
 * Der Bewegungs-Input folgt dem Original-Modell: Valheims Humanoid
 * steuert den Animator nicht über benannte Zustände, sondern über die
 * kontinuierlichen Floats `forward_speed`/`sideway_speed` (ZSyncAnimation)
 * — hier entsprechend `speed` statt eines Zustandsnamens; die Wahl
 * zwischen Gehen und Rennen kommt zusätzlich aus der Spielerabsicht
 * (Shift), genau wie Valheims `Character.m_run`.
 */
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Space } from '@babylonjs/core/Maths/math.axis';
import type { Bone } from '@babylonjs/core/Bones/bone';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** Körpermaße in Metern (Valheim-Figur ist ~1,8 m hoch). */
/** Modell ist 0,99 m hoch (BBox y −0.495…0.495), Valheims Figur ~1,8 m. */
const MODELL_SKALIERUNG = 1.8 / 0.99;
/** Halbe Modellhöhe: Das Modell ist um den Ursprung ZENTRIERT, die
 *  Rig-Wurzel sitzt aber auf dem Boden — ohne diese Anhebung steckt die
 *  Figur bis zur Hüfte im Terrain. */
const MODELL_HALBHOEHE = 0.495;
/**
 * Grenzen für `speedRatio`. Die Clips werden auf die tatsächliche
 * Geschwindigkeit normiert, damit die Füsse nicht über den Boden rutschen
 * ("foot sliding") — aber nicht unbegrenzt: Die Spielgeschwindigkeiten
 * (4,5 / 7,5 m/s) liegen deutlich über dem, wofür die Clips animiert
 * wurden, ungebremst würde die Figur hektisch trippeln.
 */
const TEMPO_MIN = 0.55;
const TEMPO_MAX = 1.75;
/**
 * Ruhepose: Anteil in den Gehzyklus, an dem die Figur beim Stillstand
 * einfriert. Gemessen am Clip (Frame 13 von 46, t = 0,542 s von 1,875 s):
 * dort ist der Fußabstand mit 0,045 am kleinsten — die Durchgangsphase, in
 * der beide Beine nebeneinanderstehen. Frame 0 wäre mitten im Schritt und
 * die Figur stünde auf einem Bein.
 */
const RUHE_ANTEIL = 0.289;
/** Ab dieser Geschwindigkeit (m/s) gilt die Figur als in Bewegung. */
const BEWEGT_AB = 0.15;
/** Übergangsdauer beim Wechsel zwischen zwei Clips, in Sekunden. */
const UEBERBLENDUNG = 0.12;
/** Schwungachse aller Gelenke — Beugen geschieht um die lokale X-Achse. */
const ACHSE_X = new Vector3(1, 0, 0);
/**
 * Ruhehaltung der Oberarme (Euler, lokal). Das Modell ist in der T-Pose
 * gebunden; diese Drehung bringt die Arme an den Körper. Die Werte wurden
 * im laufenden Bild eingestellt — siehe setRuhepose().
 */
const RUHE_ARM_L = new Vector3(0, 0, -1.25);
const RUHE_ARM_R = new Vector3(0, 0, 1.25);

const HIP_Y = 0.92;
const UPPER_LEG = 0.47;
const LOWER_LEG = 0.45;
const TORSO = 0.58;
const SHOULDER_Y = HIP_Y + TORSO - 0.06;
const UPPER_ARM = 0.31;
const LOWER_ARM = 0.29;
/** Schulterbreite: muss GRÖSSER sein als die halbe Brustkorbbreite
 *  (Kapselradius 0.19 × X-Skalierung 1.25 = 0.2375), sonst sitzen die
 *  Armgelenke im Rumpf und die Arme verschwinden darin. */
const SHOULDER_X = 0.26;
const HIP_X = 0.11;

/** Schrittfrequenz: Bogenmaß Laufzyklus pro zurückgelegtem Meter. Bei
 *  4,5 m/s (Gehen) ergibt das ~1,6 Schritte/s — plausibler Gang. */
const STRIDE_PER_METER = 2.2;
/** Beinausschlag bei voller Laufgeschwindigkeit (Bogenmaß). */
const LEG_SWING = 0.72;
const ARM_SWING = 0.55;

interface Joint {
  pivot: TransformNode;
  mesh: Mesh;
}

/** Ein Clip samt der in ihm eingebackenen Geschwindigkeit (m/s). */
interface Clip {
  grp: AnimationGroup;
  tempo: number;
}

export class AvatarRig {
  readonly root: TransformNode;
  private readonly hips: TransformNode;
  private readonly torso: TransformNode;
  private readonly legL: Joint;
  private readonly legR: Joint;
  private readonly kneeL: Joint;
  private readonly kneeR: Joint;
  private readonly armL: Joint;
  private readonly armR: Joint;
  private readonly elbowL: Joint;
  private readonly elbowR: Joint;
  private readonly head: Mesh;
  /** Attachment point at the end of the right forearm for a held tool. */
  readonly handR: TransformNode;
  private held: TransformNode | null = null;

  /** Laufzyklus-Phase (Bogenmaß), wächst mit der zurückgelegten Strecke. */
  /** Geladenes Charaktermodell; solange null, bleibt die Klötzchenfigur sichtbar. */
  private modell: TransformNode | null = null;
  /** Die für die Pose relevanten Knochen des geladenen Modells. */
  private readonly knochen: {
    huefte: Bone | null; rumpf: Bone | null; kopf: Bone | null;
    beinL: Bone | null; knieL: Bone | null; beinR: Bone | null; knieR: Bone | null;
    armL: Bone | null; ellbogenL: Bone | null; armR: Bone | null; ellbogenR: Bone | null;
  } = { huefte: null, rumpf: null, kopf: null, beinL: null, knieL: null, beinR: null,
        knieR: null, armL: null, ellbogenL: null, armR: null, ellbogenR: null };
  /** Bindepose je Knochen — der Schwung wird als Delta daraufgelegt. */
  private readonly ruhe = new Map<Bone, Quaternion>();
  /** Der tatsächlich zu drehende Node je Knochen (siehe ladeModell). */
  private readonly ziele = new Map<Bone, TransformNode | null>();
  /**
   * Die Clips aus der Datei; solange gesetzt, ersetzen sie die prozedurale
   * Pose. `tempo` ist die im Clip eingebackene Geschwindigkeit in m/s — die
   * Bezugsgröße für `speedRatio` und zugleich das Zuordnungsmerkmal.
   */
  private clipRuhe: Clip | null = null;
  /** Alle Standposen der Datei; `clipRuhe` ist die erste davon. */
  private clipsRuhe: Clip[] = [];
  private clipGehen: Clip | null = null;
  private clipRennen: Clip | null = null;
  /**
   * Sprungclip. Sonderfall unter den Clips: Er läuft EINMAL statt in
   * Schleife, immer von vorn, und sein Tempo hängt nicht an der
   * Laufgeschwindigkeit, sondern an der Flugdauer (siehe sprungDauer).
   */
  private clipSprung: Clip | null = null;
  /**
   * Wie lange ein Sprung dauert (s) — vom Absprung bis zur Landung. Setzt
   * der PlayerController, der die Sprungphysik kennt; der Clip wird darauf
   * gestreckt, damit die Landepose beim Aufsetzen erreicht ist und nicht
   * schon in der Luft.
   */
  private sprungDauer = 1;
  /** Aktuell laufender Clip. */
  private aktiv: Clip | null = null;
  /**
   * Laufende Überblendung zwischen zwei Clips. `t` zählt von 0 bis 1 über
   * UEBERBLENDUNG Sekunden; solange laufen beide Gruppen gleichzeitig und
   * werden über ihr Gewicht gemischt.
   */
  private blende: { von: Clip; nach: Clip; t: number } | null = null;
  /**
   * Ob die Clips aus der Datei benutzt werden.
   *
   * Stand bis zum 2026-07-30 auf FALSE: Die Datei hatte damals nur EINEN
   * Clip, und zwar den Renn­zyklus, dessen Oberkörper konstruktionsbedingt
   * 34° vornübergebeugt ist. Im Stand eingefroren sah das aus, als wäre
   * die Figur zusammengesackt — der Clip war aber in Ordnung, es fehlte
   * schlicht der aufrechte Gehzyklus. Seit dem Neuexport sind beide da.
   *
   * Umschalten zur Laufzeit: `__vb.anim(false)` fällt auf die prozedurale
   * Pose zurück.
   */
  private nutzeClip = true;
  private readonly tmpQuat = new Quaternion();
  private readonly tmpQuat2 = new Quaternion();
  private phase = 0;
  /** Geglättete Geschwindigkeit — verhindert ruckartige Posenwechsel beim
   *  Antippen/Loslassen der Laufttaste. */
  private smoothSpeed = 0;
  private breathe = 0;

  constructor(scene: Scene) {
    const skin = new StandardMaterial('avatar_skin', scene);
    skin.diffuseColor = new Color3(0.76, 0.58, 0.45);
    skin.specularColor = new Color3(0.05, 0.05, 0.05);
    const cloth = new StandardMaterial('avatar_cloth', scene);
    cloth.diffuseColor = new Color3(0.34, 0.28, 0.21);
    cloth.specularColor = new Color3(0.02, 0.02, 0.02);
    const hair = new StandardMaterial('avatar_hair', scene);
    hair.diffuseColor = new Color3(0.36, 0.26, 0.16);
    hair.specularColor = new Color3(0.03, 0.03, 0.03);

    this.root = new TransformNode('avatar', scene);
    void this.ladeModell(scene);

    this.hips = new TransformNode('avatar_hips', scene);
    this.hips.parent = this.root;
    this.hips.position.y = HIP_Y;

    // Rumpf: sitzt auf den Hüften und wächst nach oben
    this.torso = new TransformNode('avatar_torso', scene);
    this.torso.parent = this.hips;
    const chest = MeshBuilder.CreateCapsule('avatar_chest', { height: TORSO, radius: 0.19 }, scene);
    chest.position.y = TORSO / 2 - 0.04;
    chest.scaling.set(1.25, 1, 0.72); // breitere Schultern, flacherer Brustkorb
    chest.material = skin;
    chest.parent = this.torso;
    chest.isPickable = false;

    const belt = MeshBuilder.CreateCylinder('avatar_belt', { height: 0.22, diameter: 0.4 }, scene);
    belt.position.y = 0.02;
    belt.scaling.set(1, 1, 0.75);
    belt.material = cloth;
    belt.parent = this.hips;
    belt.isPickable = false;

    this.head = MeshBuilder.CreateSphere('avatar_head', { diameter: 0.26, segments: 12 }, scene);
    this.head.position.y = TORSO + 0.12;
    this.head.scaling.set(1, 1.15, 1.05);
    this.head.material = skin;
    this.head.parent = this.torso;
    this.head.isPickable = false;

    const hairMesh = MeshBuilder.CreateSphere('avatar_hair', { diameter: 0.27, segments: 12 }, scene);
    hairMesh.position.y = TORSO + 0.16;
    hairMesh.scaling.set(1.02, 0.85, 1.06);
    hairMesh.material = hair;
    hairMesh.parent = this.torso;
    hairMesh.isPickable = false;

    // Gliedmaßen — jeweils Pivot am Gelenk, Mesh hängt nach unten weg
    const makeJoint = (
      name: string,
      parent: TransformNode,
      length: number,
      radius: number,
      mat: StandardMaterial,
      offsetX: number,
      offsetY: number
    ): Joint => {
      const pivot = new TransformNode(`${name}_pivot`, scene);
      pivot.parent = parent;
      pivot.position.set(offsetX, offsetY, 0);
      const mesh = MeshBuilder.CreateCapsule(name, { height: length, radius }, scene);
      mesh.position.y = -length / 2;
      mesh.material = mat;
      mesh.parent = pivot;
      mesh.isPickable = false;
      return { pivot, mesh };
    };

    this.legL = makeJoint('avatar_legL', this.hips, UPPER_LEG, 0.1, cloth, HIP_X, 0);
    this.legR = makeJoint('avatar_legR', this.hips, UPPER_LEG, 0.1, cloth, -HIP_X, 0);
    this.kneeL = makeJoint('avatar_kneeL', this.legL.pivot, LOWER_LEG, 0.085, skin, 0, -UPPER_LEG);
    this.kneeR = makeJoint('avatar_kneeR', this.legR.pivot, LOWER_LEG, 0.085, skin, 0, -UPPER_LEG);

    this.armL = makeJoint('avatar_armL', this.torso, UPPER_ARM, 0.075, skin, SHOULDER_X, SHOULDER_Y - HIP_Y);
    this.armR = makeJoint('avatar_armR', this.torso, UPPER_ARM, 0.075, skin, -SHOULDER_X, SHOULDER_Y - HIP_Y);
    this.elbowL = makeJoint('avatar_elbowL', this.armL.pivot, LOWER_ARM, 0.065, skin, 0, -UPPER_ARM);
    this.elbowR = makeJoint('avatar_elbowR', this.armR.pivot, LOWER_ARM, 0.065, skin, 0, -UPPER_ARM);

    // Attachment point for a held tool: end of the right forearm. The elbow
    // pivot sits at the joint and the forearm hangs down to -LOWER_ARM.
    this.handR = new TransformNode('avatar_handR', scene);
    this.handR.parent = this.elbowR.pivot;
    this.handR.position.y = -LOWER_ARM;
  }

  /**
   * Attaches (or clears) a held object. The node is re-parented to the right
   * hand; the caller keeps ownership and disposes it.
   *
   * While something is held the right arm stops swinging (see update) —
   * otherwise the tool flails around with the walk cycle.
   */
  setHeldItem(node: TransformNode | null): void {
    if (this.held && this.held !== node) this.held.parent = null;
    this.held = node;
    // Parent only — the caller owns the node's local transform. Resetting it
    // here would fight the GLB import transform (which arrives as a
    // rotationQuaternion and silently overrides any Euler rotation set later).
    if (node) node.parent = this.handR;
  }

  /**
   * Lädt das Charaktermodell samt seiner beiden Laufzyklen.
   *
   * `PlayerAvatar.glb` bringt `skins: 1` mit 41 Knochen und seit dem
   * Neuexport vom 2026-07-30 `animations: 2` mit — Gehen und Rennen.
   *
   * ── Wozu die Knochenzuordnung trotzdem gebraucht wird ───────────────
   * Sie ist die Rückfallebene: Fehlen die Clips (älterer Export, defekte
   * Datei), rechnet diese Klasse die Bewegung wie bisher selbst aus
   * (Schrittphase an der Strecke, Armschwung, Atmung) und dreht damit die
   * benannten Knochen des Modells statt der Quader-Pivots. Ausserdem
   * hängt das getragene Werkzeug an einem dieser Knochen (`R_Hand`).
   *
   * Die Knochennamen des Modells sind eindeutig genug für eine feste
   * Zuordnung (`L_Thigh`, `L_Calf`, `L_Upperarm`, `L_Forearm`, `Head`,
   * `Hip`, `Spine01`). Twist-Knochen (`*Twist01/02`) bleiben unangetastet
   * — die sind für Verformungshilfen da, nicht für die Pose.
   *
   * ── Ruhepose merken statt überschreiben ─────────────────────────────
   * `bone.setRotationQuaternion(q)` ersetzt die Drehung KOMPLETT. Würde
   * man den Schwungwinkel direkt setzen, ginge die Bindepose verloren und
   * die Figur klappte in eine T-Haltung zusammen. Deshalb wird die
   * Ruhedrehung einmal gesichert und der Schwung als Delta daraufgelegt.
   *
   * Maßstab: Das Modell ist 0,99 m hoch mit Füssen im Ursprung (BBox
   * y 0.000…0.990), Valheims Figur misst rund 1,8 m — daher der Faktor.
   * Fällt der Ladevorgang aus, bleibt die prozedurale Figur sichtbar.
   */
  private async ladeModell(scene: Scene): Promise<void> {
    try {
      const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');
      await import('@babylonjs/loaders/glTF/2.0');
      const res = await SceneLoader.ImportMeshAsync('', '/assets/models/', 'PlayerAvatar.glb', scene);

      // Die prozeduralen Körperteile nur UNSICHTBAR schalten, nicht
      // deaktivieren: `handR` hängt am rechten Unterarm und ist der
      // Ankerpunkt fürs getragene Werkzeug — der muss weiter mitrechnen,
      // sonst liegt die Spitzhacke im Ursprung der Welt.
      for (const m of this.root.getChildMeshes()) m.isVisible = false;

      const halter = new TransformNode('avatar_modell', scene);
      halter.parent = this.root;
      for (const m of res.meshes) {
        if (!m.parent) m.parent = halter;
        m.isPickable = false;
        // Der Spieler steht im Gras; ohne das schneiden die Halme durch ihn.
        m.alphaIndex = 0;
      }
      for (const tn of res.transformNodes ?? []) if (!tn.parent) tn.parent = halter;

      halter.scaling.setAll(MODELL_SKALIERUNG);
      halter.position.y = MODELL_HALBHOEHE * MODELL_SKALIERUNG;
      // Modellvorderseite auf die Blickrichtung des Rigs drehen (+Z, siehe
      // PlayerController: "model forward is +Z").
      // Dieses Modell schaut bereits in +Z — keine Zusatzdrehung nötig.
      halter.rotation.y = 0;

      // ── Clips aus der Datei ─────────────────────────────────────
      // Haben Vorrang vor der prozeduralen Pose. Zugeordnet wird über das
      // gemessene Tempo, nicht über die Clipnamen (siehe Kopfkommentar).
      const clips = res.animationGroups
        .map((grp) => ({ grp, tempo: this.messeUndEntferneWurzelbewegung(grp) }))
        .sort((a, b) => a.tempo - b.tempo);
      // Ein Clip ohne nennenswerte Wegstrecke ist eine Standpose. Weitere
      // Standposen bleiben liegen und können später als Abwechslung im
      // Leerlauf eingestreut werden.
      //
      // Der Sprung wird ZUERST aussortiert und nimmt an der Tempo-Einteilung
      // nicht teil. Er hat zwar eine Wegstrecke — die Hüfte steigt um 0,49
      // Modelleinheiten —, aber die zeigt nach OBEN und ist keine
      // Fortbewegung. Ungefiltert zählte er als wandernder Clip und könnte
      // über die Fallback-Regeln als Geh- oder Rennzyklus einsortiert werden.
      const nachName = (muster: RegExp, aus: Clip[]): Clip | null =>
        aus.find((c) => muster.test(c.grp.name)) ?? null;
      this.clipSprung = nachName(/spring|jump/i, clips);
      const rest = clips.filter((c) => c !== this.clipSprung);
      const wandernd = rest.filter((c) => c.tempo > 0.1);
      this.clipsRuhe = rest.filter((c) => c.tempo <= 0.1);
      // Sprechende Namen schlagen die Messung. Der Tripo-Export vergibt
      // keine (`NlaTrack.002`), aber selbst eingebaute Clips — etwa ein bei
      // Mixamo geholter Ruhezyklus, den tools/mixamo-to-avatar.mjs unter
      // `idle` ablegt — sollen verlässlich dort landen, wo sie hingehören,
      // statt von der Tempo-Heuristik einsortiert zu werden.
      this.clipRuhe = nachName(/idle|ruhe|stand/i, this.clipsRuhe) ?? this.clipsRuhe[0] ?? null;
      this.clipGehen = nachName(/gehen|walk/i, wandernd) ?? wandernd[0] ?? null;
      this.clipRennen = nachName(/rennen|run|jog/i, wandernd) ?? wandernd[wandernd.length - 1] ?? null;
      if (clips.length) {
        const zeig = (c: Clip | null) => (c ? `"${c.grp.name}" ${c.tempo.toFixed(2)} m/s` : '—');
        console.log(
          `[avatar] Clips: ruhe ${zeig(this.clipRuhe)}` +
            (this.clipsRuhe.length > 1 ? ` (+${this.clipsRuhe.length - 1} weitere Standpose)` : '') +
            `, gehen ${zeig(this.clipGehen)}, rennen ${zeig(this.clipRennen)}` +
            `, sprung ${this.clipSprung ? `"${this.clipSprung.grp.name}" ${this.clipLaenge(this.clipSprung).toFixed(2)} s` : '—'}`
        );
        // KEIN `enableBlending` hier: Übergänge laufen über die Gewichte
        // der Gruppen (siehe wechsleZu). Beides zusammen blendet doppelt —
        // die Figur schlingert dann durch den Wechsel.
        this.stelleRuhepose();
      }

      const skelett = res.skeletons[0] ?? null;
      if (skelett) {
        const hole = (name: string): Bone | null => skelett.bones.find((b) => b.name === name) ?? null;
        const paare: Array<[keyof AvatarRig['knochen'], string]> = [
          ['huefte', 'Hip'], ['rumpf', 'Spine01'], ['kopf', 'Head'],
          ['beinL', 'L_Thigh'], ['knieL', 'L_Calf'],
          ['beinR', 'R_Thigh'], ['knieR', 'R_Calf'],
          ['armL', 'L_Upperarm'], ['ellbogenL', 'L_Forearm'],
          ['armR', 'R_Upperarm'], ['ellbogenR', 'R_Forearm'],
        ];
        for (const [feld, name] of paare) {
          const b = hole(name);
          if (!b) continue;
          this.knochen[feld] = b;
          // WICHTIG: Babylons glTF-Loader hängt an jeden Knochen einen
          // TransformNode und verknüpft ihn (`linkTransformNode`). Solange
          // die Verknüpfung besteht, wird die Drehung des KNOCHENS in jedem
          // Frame aus dem Node überschrieben — direkt am Knochen zu drehen
          // bleibt wirkungslos (genau das war der erste Fehlversuch: die
          // Figur blieb in der T-Pose stehen). Deshalb wird, wenn ein Node
          // vorhanden ist, dieser gedreht.
          const ziel = b.getTransformNode() ?? null;
          this.ziele.set(b, ziel);
          const q = ziel
            ? (ziel.rotationQuaternion ?? Quaternion.FromEulerAngles(ziel.rotation.x, ziel.rotation.y, ziel.rotation.z))
            : (b.rotationQuaternion ?? Quaternion.FromRotationMatrix(b.getLocalMatrix()));
          this.ruhe.set(b, q.clone());
        }
        const fehlend = paare.filter(([f]) => !this.knochen[f]).map(([, n]) => n);
        if (fehlend.length) console.warn('[avatar] Knochen nicht gefunden:', fehlend.join(', '));

        // ── Werkzeughand an den echten Handknochen hängen ────────────
        // Bisher hing `handR` am prozeduralen Ellbogen-Pivot. Das ging nur,
        // solange die prozedurale Pose die Figur bewegte: Sobald die Clips
        // die Knochen steuern, stehen die Pivots still und die Spitzhacke
        // bliebe reglos in der Luft, während der Arm darunter wegschwingt.
        const handKnochen = hole('R_Hand')?.getTransformNode() ?? null;
        if (handKnochen) {
          this.handR.parent = handKnochen;
          this.handR.position.setAll(0);
          // Der Halter skaliert das ganze Modell auf Spielergrösse; das
          // Werkzeug bringt seine eigene, bereits richtige Grösse mit und
          // darf nicht ein zweites Mal mitwachsen.
          this.handR.scaling.setAll(1 / MODELL_SKALIERUNG);
        } else {
          console.warn('[avatar] R_Hand nicht gefunden — Werkzeug bleibt am Ersatz-Pivot');
        }
      } else {
        console.warn('[avatar] Modell ohne Skelett — Figur bleibt statisch');
      }

      this.modell = halter;
    } catch (err) {
      // Kein Abbruch: die prozedurale Figur bleibt stehen.
      console.warn('[avatar] PlayerAvatar.glb nicht geladen, nutze Klötzchenfigur', err);
    }
  }

  /**
   * Misst die im Clip eingebackene Vorwärtsbewegung, entfernt sie und gibt
   * das Tempo in m/s zurück.
   *
   * ── Warum die Bewegung weg muss ─────────────────────────────────────
   * Beide Clips wandern: Die Hüfte legt im Rennzyklus 3,2, im Gehzyklus
   * 1,6 Modelleinheiten zurück. Mitgespielt liefe die Figur aus ihrer
   * eigenen Position heraus — die Fortbewegung steuert bei uns aber der
   * PlayerController über `root`.
   *
   * ── Warum nur EINE Achse und nicht die ganze Spur ───────────────────
   * Ein früherer Versuch entfernte die komplette Positionsspur der
   * wurzelnahen Knochen. Damit verschwindet aber auch das Auf-und-Ab der
   * Hüfte und der seitliche Versatz — der Gang wird brettsteif. Die
   * Wanderung steckt in genau einer lokalen Achse (Spannweite 3,2 gegen
   * 0,03 und 0,04 der beiden anderen); nur die wird auf ihren
   * Bindepose-Wert festgenagelt. Welche Achse das ist, wird gemessen statt
   * angenommen: Der glTF-Export kommt aus Blender (Z-up) und die
   * Achsenlage ändert sich mit den Exporteinstellungen.
   *
   * Ein weiterer Versuch verwarf ALLE Verschiebungsspuren aller Knochen.
   * Das tötete die Animation komplett — bei diesem Export haben die
   * Drehspuren nur 2 Keyframes, die Bewegung steckt fast vollständig in
   * den Translationen.
   */
  private messeUndEntferneWurzelbewegung(grp: AnimationGroup): number {
    let weiteste = 0;
    for (const ta of grp.targetedAnimations) {
      if (ta.animation.targetProperty !== 'position') continue;
      const zielName = (ta.target as { name?: string })?.name ?? '';
      // Nur wurzelnahe Knochen können den Körper als Ganzes versetzen.
      if (!/^(Root|Hip|Pelvis)$/.test(zielName)) continue;
      const keys = ta.animation.getKeys();
      if (keys.length < 2) continue;

      const min = (keys[0].value as Vector3).clone();
      const max = min.clone();
      for (const k of keys) {
        min.minimizeInPlace(k.value as Vector3);
        max.maximizeInPlace(k.value as Vector3);
      }
      const spann = max.subtract(min);
      const achse: 'x' | 'y' | 'z' =
        spann.x >= spann.y && spann.x >= spann.z ? 'x' : spann.y >= spann.z ? 'y' : 'z';
      const weite = spann[achse];
      // Ein Wippen von wenigen Zentimetern ist Gang, keine Wanderung.
      if (weite < 0.2) continue;

      // Festnageln auf den Wert der BINDEPOSE, nicht auf den ersten
      // Keyframe: Der Rennzyklus startet bereits 0,64 Einheiten vor dem
      // Ursprung: eingefroren stünde die Figur 1,2 m vor ihrem eigenen
      // Mittelpunkt und damit neben der Kollisionskapsel.
      const ruhewert = (ta.target as TransformNode).position[achse];
      for (const k of keys) (k.value as Vector3)[achse] = ruhewert;
      ta.animation.setKeys(keys);

      const fps = ta.animation.framePerSecond || 60;
      const dauer = (keys[keys.length - 1].frame - keys[0].frame) / fps;
      if (dauer > 0) weiteste = Math.max(weiteste, (weite / dauer) * MODELL_SKALIERUNG);
    }
    return weiteste;
  }

  /**
   * Figur in den Stand versetzen.
   *
   * Mit Ruheclip läuft der einfach in Schleife — die Figur steht dann nicht
   * bewegungslos da, sondern atmet und verlagert das Gewicht.
   *
   * Ohne Ruheclip (älterer Export) wird ersatzweise der Gehzyklus in der
   * Durchgangsphase eingefroren (siehe RUHE_ANTEIL). `play()` vor `pause()`
   * ist dabei Absicht: Babylon legt die Laufzeit-Animationen erst beim
   * Abspielen an, `goToFrame()` auf einer nie gestarteten Gruppe verpufft
   * — die Figur bliebe in der T-Pose der Bindestellung stehen.
   */
  private stelleRuhepose(): void {
    if (this.clipRuhe) {
      this.clipRuhe.grp.play(true);
      this.clipRuhe.grp.speedRatio = 1;
      // Volles Gewicht: Die Gruppe kann aus einer früheren Überblendung
      // noch ein Teilgewicht tragen und bliebe sonst halb unsichtbar.
      this.clipRuhe.grp.setWeightForAllAnimatables(1);
      this.aktiv = this.clipRuhe;
      this.blende = null;
      return;
    }
    const c = this.clipGehen;
    if (!c) return;
    c.grp.play(true);
    c.grp.pause();
    c.grp.goToFrame(c.grp.from + (c.grp.to - c.grp.from) * RUHE_ANTEIL);
    this.aktiv = null;
  }

  /**
   * Schwung als Delta auf die Bindepose legen.
   *
   * Zusätzlich zum Schwungwinkel um X kommt ein fester Euler-Offset dazu:
   * Das Modell ist in der T-POSE gebunden (Arme waagerecht abgespreizt).
   * Ohne diesen Offset stünde die Figur dauerhaft mit ausgestreckten
   * Armen da — der Schwung allein bringt sie nicht an den Körper.
   */
  private dreheKnochen(b: Bone | null, winkel: number, ruhepose?: Vector3): void {
    if (!b) return;
    const bind = this.ruhe.get(b);
    if (!bind) return;
    if (ruhepose) {
      Quaternion.FromEulerAnglesToRef(ruhepose.x + winkel, ruhepose.y, ruhepose.z, this.tmpQuat);
    } else {
      Quaternion.RotationAxisToRef(ACHSE_X, winkel, this.tmpQuat);
    }
    bind.multiplyToRef(this.tmpQuat, this.tmpQuat2);
    const ziel = this.ziele.get(b);
    if (ziel) {
      if (!ziel.rotationQuaternion) ziel.rotationQuaternion = this.tmpQuat2.clone();
      else ziel.rotationQuaternion.copyFrom(this.tmpQuat2);
    } else {
      b.setRotationQuaternion(this.tmpQuat2, Space.LOCAL);
    }
  }

  /** Länge eines Clips in Sekunden. */
  private clipLaenge(c: Clip): number {
    const fps = c.grp.targetedAnimations[0]?.animation.framePerSecond || 60;
    return fps > 0 ? (c.grp.to - c.grp.from) / fps : 0;
  }

  /**
   * Wechselt weich auf einen anderen Clip.
   *
   * `schleife: false` spielt den Clip einmal durch und lässt ihn in seiner
   * Endpose stehen — das braucht der Sprung: Ein Sprung, der in Schleife
   * läuft, setzt mitten im Flug erneut zum Absprung an. `vonVorn` erzwingt
   * den Einstieg bei Frame 0 statt an der übernommenen Schrittphase.
   *
   * ── Warum der Einstiegspunkt zählt ──────────────────────────────────
   * Bisher wurde der alte Clip angehalten und der neue mit `play()`
   * fortgesetzt — also an der Stelle, an der er beim letzten Mal
   * stehengeblieben war, beim allerersten Mal bei Frame 0. Frame 0 des
   * Gehzyklus liegt MITTEN IM SCHRITT mit weit ausgestelltem Bein. Aus dem
   * Stand heraus sprang die Figur damit sichtbar in die Grätsche, bevor
   * der Zyklus normal weiterlief.
   *
   * Deshalb wird der Einstieg passend gewählt:
   *   Stand → Gehen/Rennen: bei RUHE_ANTEIL, der Durchgangsphase, in der
   *     beide Beine nebeneinanderstehen — genau die Haltung des Stands.
   *   Gehen ↔ Rennen: die normierte Schrittphase wird übernommen, sonst
   *     zuckt beim Beschleunigen das Bein, das gerade hinten war, nach
   *     vorn.
   *   → Stand: der Ruheclip ist zyklisch und darf laufen, wo er will.
   *
   * ── Überblendung über Gewichte ──────────────────────────────────────
   * Beide Gruppen laufen während der Überblendung gleichzeitig und werden
   * über `weight` gemischt (Babylon mischt Animationen mit Gewicht additiv
   * auf denselben Knochen). Der alte Weg — hartes `pause()` — schnitt
   * stattdessen um, was den Wechsel selbst bei richtiger Phase ruckeln
   * ließ.
   */
  private wechsleZu(ziel: Clip, schleife = true, vonVorn = false): void {
    const von = this.aktiv;
    if (von === ziel) return;

    // Eine noch laufende Überblendung sofort abschließen: Drei Gruppen mit
    // Teilgewichten gleichzeitig ergeben eine Mischpose, die zu keinem der
    // Clips gehört.
    if (this.blende) {
      this.blende.von.grp.pause();
      this.blende.von.grp.setWeightForAllAnimatables(1);
      this.blende = null;
    }

    const spanne = (c: Clip) => c.grp.to - c.grp.from;
    ziel.grp.play(schleife);
    if (vonVorn) {
      ziel.grp.goToFrame(ziel.grp.from);
    } else if (ziel.tempo > 0) {
      const anteil = von && von.tempo > 0 && spanne(von) > 0
        ? Math.min(1, Math.max(0, (von.grp.getCurrentFrame() - von.grp.from) / spanne(von)))
        : RUHE_ANTEIL;
      ziel.grp.goToFrame(ziel.grp.from + anteil * spanne(ziel));
    }

    // Überblendet wird nur gegen einen Clip, der noch läuft. Ein
    // durchgelaufener Einmal-Clip (der Sprung) schreibt keine Knochen mehr;
    // gegen ihn zu blenden hieße, den neuen Clip mit Gewicht 0 zu starten,
    // während niemand die Pose treibt — die Figur bliebe für die Dauer der
    // Blende in der Landepose eingefroren.
    if (von && von.grp.isPlaying) {
      ziel.grp.setWeightForAllAnimatables(0);
      von.grp.setWeightForAllAnimatables(1);
      this.blende = { von, nach: ziel, t: 0 };
    } else {
      ziel.grp.setWeightForAllAnimatables(1);
    }
    this.aktiv = ziel;
  }

  /** Schreibt eine laufende Überblendung fort. */
  private treibeUeberblendung(dt: number): void {
    const b = this.blende;
    if (!b) return;
    b.t += dt / UEBERBLENDUNG;
    const w = Math.min(1, b.t);
    b.nach.grp.setWeightForAllAnimatables(w);
    b.von.grp.setWeightForAllAnimatables(1 - w);
    if (w >= 1) {
      b.von.grp.pause();
      // Gewicht zurücksetzen, sonst startet die Gruppe beim nächsten Mal
      // unsichtbar mit 0.
      b.von.grp.setWeightForAllAnimatables(1);
      this.blende = null;
    }
  }

  /** Clips aus der Datei statt der prozeduralen Pose benutzen. */
  setClipAnimation(an: boolean): boolean {
    if (!this.clipGehen && !this.clipRuhe) return false;
    this.nutzeClip = an;
    if (!an) {
      for (const c of [this.clipRuhe, this.clipGehen, this.clipRennen, this.clipSprung]) c?.grp.pause();
      this.aktiv = null;
    }
    return true;
  }

  /**
   * Flugdauer eines Sprungs in Sekunden — Absprung bis Landung.
   *
   * Der Sprungclip ist 0,80 s lang, die Flugphase im Spiel dauert 2·v/g.
   * Ohne Streckung wäre die Figur schon gelandet, während sie noch steigt.
   * Den Wert kennt nur der PlayerController (Sprungkraft und Gravitation),
   * deshalb kommt er von dort.
   */
  setSprungDauer(sekunden: number): void {
    if (sekunden > 0) this.sprungDauer = sekunden;
  }

  /** Nur zum Einstellen: Ruhehaltung der Arme zur Laufzeit ändern. */
  setRuhepose(links: { x: number; y: number; z: number }, rechts: { x: number; y: number; z: number }, drehung?: number): void {
    RUHE_ARM_L.set(links.x, links.y, links.z);
    RUHE_ARM_R.set(rechts.x, rechts.y, rechts.z);
    if (drehung !== undefined && this.modell) this.modell.rotation.y = drehung;
  }

  /**
   * @param dt      Sekunden seit dem letzten Frame
   * @param speed   aktuelle Horizontalgeschwindigkeit in m/s (0 = steht)
   * @param maxSpeed Bezugsgeschwindigkeit für die volle Ausschlagsamplitude
   * @param rennt   Spielerabsicht (Shift) — entscheidet zwischen Geh- und
   *                Rennzyklus. Wie in Valheim ist das ein eigener Zustand
   *                (`Character.m_run`) und nicht bloss eine Schwelle auf der
   *                Geschwindigkeit.
   * @param inDerLuft Kein Bodenkontakt — schaltet auf den Sprungclip, der
   *                Vorrang vor allen anderen hat.
   */
  update(dt: number, speed: number, maxSpeed: number, rennt = false, inDerLuft = false): void {
    // Geschwindigkeit glätten (Zeitkonstante ~0.12 s)
    const k = Math.min(1, dt / 0.12);
    this.smoothSpeed += (speed - this.smoothSpeed) * k;
    const s = this.smoothSpeed;
    const amount = Math.min(1, s / Math.max(0.001, maxSpeed));

    // Phase an der Strecke koppeln, nicht an der Zeit: sonst "rudert" die
    // Figur beim Stehenbleiben mit gleicher Frequenz weiter.
    this.phase += s * dt * STRIDE_PER_METER;
    this.breathe += dt;

    const swing = Math.sin(this.phase);
    const swingOpp = Math.sin(this.phase + Math.PI);

    // ── Fall 1: Laufzyklen aus der Datei ────────────────────────────
    // Sind Keyframes vorhanden, spielt Babylon sie ab und wir wählen nur
    // Clip und Tempo. Die prozedurale Pose MUSS dann unterbleiben — sie
    // würde in dieselben Knochen schreiben und gegen die Animation kämpfen.
    if ((this.clipGehen || this.clipRuhe) && this.nutzeClip) {
      const bewegt = s > BEWEGT_AB;
      // Der Sprung hat Vorrang: In der Luft gibt es keinen Schritt, der zu
      // normieren wäre, und die Geschwindigkeit sagt dort nichts über die
      // Pose. Fehlt der Clip, bleibt es beim bisherigen Verhalten.
      const springt = inDerLuft && this.clipSprung !== null;
      const ziel = springt
        ? this.clipSprung
        : !bewegt
          ? this.clipRuhe
          : (rennt ? this.clipRennen : this.clipGehen) ?? this.clipGehen ?? this.clipRuhe;

      if (ziel !== this.aktiv) {
        // Einmal durchspielen und von vorn beginnen — beides nur für den
        // Sprung (siehe wechsleZu).
        if (ziel) this.wechsleZu(ziel, !springt, springt);
        // Kein Ruheclip vorhanden: Gehzyklus einfrieren statt mitten im
        // Schritt stehenzubleiben.
        else this.stelleRuhepose();
      }
      this.treibeUeberblendung(dt);

      // Tempo an die Geschwindigkeit koppeln, sonst rutschen die Füsse über
      // den Boden. Begrenzt, weil die Spielgeschwindigkeiten deutlich über
      // dem Tempo liegen, für das die Clips animiert wurden. Der Ruheclip
      // (tempo 0) läuft unverändert in seinem Originaltempo.
      //
      // Der Sprung folgt einer anderen Regel: Er wird auf die Flugdauer
      // gestreckt, damit Absprung und Landung mit der Physik zusammenfallen.
      if (this.aktiv === this.clipSprung && this.clipSprung) {
        const laenge = this.clipLaenge(this.clipSprung);
        this.clipSprung.grp.speedRatio = laenge > 0 ? laenge / this.sprungDauer : 1;
      } else if (this.aktiv && this.aktiv.tempo > 0) {
        this.aktiv.grp.speedRatio = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, s / this.aktiv.tempo));
      }
      return;
    }

    // ── Fall 2: Modell mit Skelett, aber ohne Keyframes ─────────────
    // Dann bekommt es dieselben Winkel wie sonst die Quader — nur eben auf
    // echten Knochen.
    if (this.modell) {
      this.dreheKnochen(this.knochen.beinL, swing * LEG_SWING * amount);
      this.dreheKnochen(this.knochen.beinR, swingOpp * LEG_SWING * amount);
      // Knie beugen nur nach hinten — negatives Vorzeichen, weil die
      // Knochenachse des Modells andersherum liegt als der Quader-Pivot.
      this.dreheKnochen(this.knochen.knieL, -Math.max(0, -swing) * 1.05 * amount);
      this.dreheKnochen(this.knochen.knieR, -Math.max(0, -swingOpp) * 1.05 * amount);
      this.dreheKnochen(this.knochen.armL, swingOpp * ARM_SWING * amount, RUHE_ARM_L);
      this.dreheKnochen(this.knochen.armR, this.held ? -0.55 : swing * ARM_SWING * amount, RUHE_ARM_R);
      // Atmung: im Stand hebt sich der Brustkorb leicht.
      const atem = Math.sin(this.breathe * 1.6) * 0.035 * (1 - amount);
      this.dreheKnochen(this.knochen.rumpf, atem);
    }

    // Beine: gegenläufiger Ausschlag
    this.legL.pivot.rotation.x = swing * LEG_SWING * amount;
    this.legR.pivot.rotation.x = swingOpp * LEG_SWING * amount;
    // Knie beugen nur nach hinten, und am stärksten wenn das Bein hinten ist
    this.kneeL.pivot.rotation.x = Math.max(0, -swing) * 1.05 * amount;
    this.kneeR.pivot.rotation.x = Math.max(0, -swingOpp) * 1.05 * amount;

    // Arme: gegenläufig zu den Beinen; im Stand leichte Atem-Bewegung
    const idle = 1 - amount;
    const breath = Math.sin(this.breathe * 1.6) * 0.035;
    this.armL.pivot.rotation.x = swingOpp * ARM_SWING * amount;
    // Holding something pins the right arm into a carry pose instead of
    // letting it swing — a swinging arm drags the tool through the ground.
    this.armR.pivot.rotation.x = this.held ? -0.55 : swing * ARM_SWING * amount;
    // Leichte Abspreizung nach AUSSEN, im Lauf stärker. Vorzeichen: der
    // Arm hängt lokal bei (0,-L); eine Drehung um Z verschiebt ihn nach
    // x' = L·sin(θ). Der linke Arm sitzt bei +X, braucht also θ > 0, der
    // rechte θ < 0 — andersherum klappen die Arme in den Rumpf.
    const spread = 0.12 + 0.06 * amount;
    this.armL.pivot.rotation.z = spread;
    this.armR.pivot.rotation.z = -spread;
    this.elbowL.pivot.rotation.x = 0.15 + Math.max(0, swingOpp) * 0.55 * amount;
    this.elbowR.pivot.rotation.x = this.held
      ? 0.9 // bent, so the tool is carried in front of the body
      : 0.15 + Math.max(0, swing) * 0.55 * amount;

    // Rumpf: Vorlage beim Laufen, Auf-/Ab-Wippen im doppelten Takt,
    // Atmung im Stand.
    this.torso.rotation.x = 0.06 + 0.22 * amount;
    this.torso.rotation.y = -swing * 0.09 * amount;
    this.hips.position.y = HIP_Y + Math.abs(Math.sin(this.phase)) * 0.045 * amount + breath * idle;
    this.head.rotation.x = -0.05 - 0.16 * amount; // Blick bleibt waagerecht
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
