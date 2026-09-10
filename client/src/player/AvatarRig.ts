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
 * Der Bewegungs-Input folgt dem Original-Modell: Dessen Humanoid
 * steuert den Animator nicht über benannte Zustände, sondern über die
 * kontinuierlichen Floats `forward_speed`/`sideway_speed` (ZSyncAnimation)
 * — hier entsprechend `speed` statt eines Zustandsnamens; die Wahl
 * zwischen Gehen und Rennen kommt zusätzlich aus der Spielerabsicht
 * (Shift), genau wie das `Character.m_run` des Vorbilds.
 */
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { faerbeHaar } from './haarfarbe.js';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Space } from '@babylonjs/core/Maths/math.axis';
import type { Bone } from '@babylonjs/core/Bones/bone';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Animation } from '@babylonjs/core/Animations/animation';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Nullable } from '@babylonjs/core/types';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { AUSSEHEN_ORDNER, FIGUR_VORGABE, modellDateiZu } from '@wov/shared';
import { toeneFigurMeshes } from '../engine/FigurToenung.js';

/** Körpermaße in Metern (die Figur ist ~1,8 m hoch). */
const SPIELER_HOEHE = 1.8;
/**
 * Ersatzmaße, falls sich das Modell nicht vermessen lässt (Datei ohne
 * Geometrie). Entsprechen `PlayerAvatar.glb`: 0,99 m hoch, um den
 * Ursprung zentriert.
 */
const MODELL_SKALIERUNG = SPIELER_HOEHE / 0.99;
const MODELL_HALBHOEHE = 0.495;

/**
 * Knochennamen je Rolle — der ERSTE Treffer gewinnt.
 *
 * WARUM MEHRERE NAMEN: Die eigenen Modelle kommen aus Tripo und heissen
 * `Hip`, `Spine01`, `R_Hand`. Ein bei Mixamo geriggtes Modell (die
 * Walküre) bringt dieselben Knochen unter `mixamorig:Hips`,
 * `mixamorig:Spine1`, `mixamorig:RightHand` mit. Ohne die Zweitnamen
 * findet AvatarRig an so einem Modell KEINEN Knochen: die prozedurale
 * Pose greift ins Leere und — schlimmer, weil man es erst beim Graben
 * merkt — das Werkzeug bleibt am Ersatz-Pivot statt in der Hand.
 */
// Dritter Namensatz (09.09.2026): der Wikinger aus dem Synty-Rig —
// `Hips`, `Spine_01`, `Shoulder_L`, `Elbow_L`, `UpperLeg_L`, `LowerLeg_L`,
// `Ankle_L`, `Hand_R`.
const KNOCHEN_NAMEN = {
  huefte: ['Hip', 'Hips', 'mixamorig:Hips'],
  rumpf: ['Spine01', 'Spine_01', 'mixamorig:Spine1'],
  kopf: ['Head', 'mixamorig:Head'],
  beinL: ['L_Thigh', 'UpperLeg_L', 'mixamorig:LeftUpLeg'],
  knieL: ['L_Calf', 'LowerLeg_L', 'mixamorig:LeftLeg'],
  beinR: ['R_Thigh', 'UpperLeg_R', 'mixamorig:RightUpLeg'],
  knieR: ['R_Calf', 'LowerLeg_R', 'mixamorig:RightLeg'],
  armL: ['L_Upperarm', 'Shoulder_L', 'mixamorig:LeftArm'],
  ellbogenL: ['L_Forearm', 'Elbow_L', 'mixamorig:LeftForeArm'],
  armR: ['R_Upperarm', 'Shoulder_R', 'mixamorig:RightArm'],
  ellbogenR: ['R_Forearm', 'Elbow_R', 'mixamorig:RightForeArm'],
} as const satisfies Record<string, readonly string[]>;

/** Fussknochen — dieselbe Zweitnamen-Regel wie bei KNOCHEN_NAMEN. */
const FUSS_LINKS = ['L_Foot', 'Ankle_L', 'mixamorig:LeftFoot'] as const;
const FUSS_RECHTS = ['R_Foot', 'Ankle_R', 'mixamorig:RightFoot'] as const;

/**
 * Grenzen der Fussanpassung.
 *
 * MAX: Weiter als eine halbe Schrittlänge wird nie korrigiert. An einer
 * Felskante liegt unter dem einen Fuss ein Abgrund; ohne Deckel schnellte
 * die Figur dort meterweit nach oben.
 *
 * ZEITKONSTANTE: Die Höhe unter einem Fuss springt beim Gehen von
 * Vertex zu Vertex. Ungeglättet zittert die Figur; geglättet folgt sie
 * dem Gelände mit einem kaum wahrnehmbaren Nachlauf.
 */
const FUSS_VERSATZ_MAX = 0.45;
/**
 * Wie weit die Figur ABGESENKT werden darf.
 *
 * WARUM ES DAS BRAUCHT: Die Kollisionskapsel hat 0,40 m Radius. Eine
 * Kugel dieses Radius liegt auf einer um θ geneigten Fläche senkrecht
 * gemessen `r · (1/cos θ − 1)` über dem Boden — bei 30° sind das 6 cm,
 * bei 41° schon 13 cm. Die Physik hält die Figur dort also ZU HOCH, und
 * genau das sieht man als Schweben (gemeldet am 23.08.2026, gemessen
 * 0,128 m). Die erste Fassung dieser Anpassung liess nur Anheben zu und
 * konnte deshalb gar nichts ausrichten.
 *
 * Der Deckel trennt diesen Fall von einem anderen: Wer auf einem Felsen
 * oder Hausdach steht, liegt legitim ÜBER dem Gelände — dort trägt ihn
 * der Kollider, und die Figur darf nicht durch das Dach nach unten
 * gezogen werden. 0,35 m deckt die Kapselgeometrie bis rund 50° ab und
 * liegt deutlich unter jeder Stufe, auf die man sich stellen kann.
 */
const FUSS_ABSENK_MAX = 0.35;
const FUSS_GLAETTUNG_S = 0.09;
/**
 * Fuss-IK je Fuss (Stufe 2, 10.09.2026): Wie weit ein Fuss hoechstens
 * gegenueber der Animation gehoben oder gesenkt wird (m), und ab welcher
 * animierten Sohlenhoehe ueber dem Rig-Boden ein Fuss als „aufgesetzt"
 * gilt und den Halter mitziehen darf. Ein Schwungfuss mitten im Schritt
 * darf das Becken nicht in die Tiefe reissen.
 */
const IK_HUB_MAX = 0.5;
/** Ein-/Ausblenden des Fuss-IK (Sprung, Modellwechsel). */
const IK_BLENDE = 0.15;
/**
 * Nach dem Vorbild (Opsive CharacterIK.PositionLowerBody, dekompiliert
 * unter ~/wov-assets/Scripts): die Huefte folgt dem Gelaende unter den
 * Fuessen mit 4/s (m_HipsPositionAdjustmentSpeed), ein Fuss-IK-Gewicht
 * steigt mit 10/s (m_FootWeightActiveAdjustmentSpeed) und faellt mit 2/s
 * (m_FootWeightInactiveAdjustmentSpeed). Gehoben wird NUR ein Fuss, der
 * sonst im Boden steckte; ein Fuss ueber dem Boden bleibt bei der
 * Animation. Genau das unterscheidet das Original vom ersten Anlauf am
 * 10.09., der jeden Fuss jedes Bild auf den Boden zog (wabbelige Beine)
 * und die Huefte nach der animierten Sohle statt nach dem Gelaende
 * setzte (gebeugte Haltung).
 */
const IK_HUEFTE_TEMPO = 4;
const IK_GEWICHT_AN = 10;
const IK_GEWICHT_AUS = 2;
/** Boden weiter unter dem Fuss als das zaehlt nicht mehr (Kante, Grube). */
const IK_REICHWEITE = 0.9;
/** Abstand (m) vor/hinter dem Knoechel fuer die Hangneigung unter dem Fuss. */
const IK_NEIGUNG_SCHRITT = 0.12;

/** Der Knochen, an dem das getragene Werkzeug hängt. */
const HAND_NAMEN = ['R_Hand', 'Hand_R', 'mixamorig:RightHand'] as const;
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
/**
 * Wie lange nach dem Ende eines Schlags der naechste noch als Teil der
 * Kombo zaehlt (s). Kuerzer als der Schlagtakt darf es nicht sein, sonst
 * kaeme man nie zu Hieb 2; laenger als eine knappe Sekunde, und jeder
 * gelegentliche Klick landet im Finisher.
 */
const KOMBO_FENSTER = 0.6;

/**
 * Tempo, mit dem Schlagclips laufen (Vorbild: Player-Animator des
 * Originals, Attack 1/2/3 mit Speed 2,5). Die Clips sind seit dem
 * 10.09.2026 abends KOMPLETT (Ausholen, Hieb, Rueckkehr in die Ruhepose,
 * ~3 s) — bei 2,5 also 1,2 s je Hieb. Vorher waren sie um den Hieb
 * geschnitten und auf den Schlagtakt gestaucht; sie endeten mitten in der
 * Bewegung, und der Wechsel in die Ruhepose war ein Sprung.
 */
const ANGRIFF_TEMPO = 2.5;
/** Ueberblendung Hieb → Hieb (Original: Transition Duration 0,15 s). */
const UEBERBLEND_ANGRIFF = 0.15;
/** Ueberblendung Ruhe/Gehen → erster Hieb (Original: AnyState-Transition 0,08 s). */
const UEBERBLEND_EINSTIEG = 0.08;
/**
 * Ueberblendung Hieb → Ruhe/Gehen (Original: Exit-Transition 0,25 s).
 * Sie BEGINNT diese Zeit vor dem Clipende, solange der Hieb noch laeuft:
 * Babylon raeumt eine beendete Einmal-Abspielung sofort ab, und eine
 * Ueberblendung, deren Quelle verschwindet, springt — genau das Zittern
 * bei der Rueckkehr in die Ruhepose, das Mike am 10.09. gemeldet hat
 * (gemessen: 45 m/s an der Hand in einem einzigen Bild).
 */
const UEBERBLEND_AUSSTIEG = 0.25;
/** Ein-/Ausblenden der Waffenschichten (Arm, Finger). */
const SCHICHT_BLENDE = 0.15;
/**
 * Knochen der Armschicht (Original: „Right Arm Layer", Clip
 * SwordIdleMovement — der Arm haelt die Waffe, waehrend der Koerper den
 * normalen Ruhe-/Geh-/Rennzyklus spielt).
 */
const SCHICHT_ARM = ['Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R'] as const;

/**
 * Eine Animationsschicht nach dem Muster der Unity-Layer: ein Clip, der
 * NUR bestimmte Knochen ueberschreibt und ueber den laufenden Koerperclip
 * gelegt wird. Babylon kennt so etwas nicht (zwei Gruppen auf demselben
 * Knochen mischen sich per Gewicht statt sich zu ueberschreiben), deshalb
 * wird der Clip hier selbst abgetastet und nach der Animationsauswertung
 * per Slerp auf die Knoten geschrieben.
 */
interface Schicht {
  name: string;
  kanaele: Array<{ knoten: TransformNode; anim: Animation }>;
  von: number;
  bis: number;
  fps: number;
  /** Dauerschicht (Arm/Finger, Schleife) oder Einmal-Aktion (Ausruesten, Parade). */
  schleife: boolean;
  /** Abspieltempo (Original: Ausruesten 2,75, Ablegen 2,25, Parade 1,5). */
  tempo: number;
}

/**
 * Laufende Einmal-Aktion auf der Oberkoerperschicht (Ausruesten, Ablegen,
 * Parade). Waehrend sie laeuft, ruhen Arm- und Fingerschicht — im
 * Original liegt der Upperbody Layer ueber dem Right Arm Layer.
 */
interface Aktion {
  schicht: Schicht;
  zeit: number;
  /** Laufzeit in Sekunden (Clipdauer / Tempo). */
  dauer: number;
}

/** Ein-/Ausblenden einer Einmal-Aktion (Original: Transition 0,1–0,15 s). */
const AKTION_BLENDE = 0.1;
/**
 * Knochen der Oberkoerperschicht (Original: „Upperbody Layer" fuer
 * Ausruesten, Ablegen, Parieren). Finger beider Haende kommen ueber die
 * Nachfahren von Hand_L/Hand_R dazu.
 */
const SCHICHT_OBERKOERPER = [
  'Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head',
  'Clavicle_L', 'Shoulder_L', 'Elbow_L', 'Hand_L',
  'Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R',
] as const;
const AKTION_TEMPO: Record<string, number> = { ausruesten: 2.75, ablegen: 2.25, parade: 1.5 };

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
  /** Skelett des geladenen Koerpers — Traeger fuer alle nachgeladenen Teile. */
  private skelett: import('@babylonjs/core/Bones/skeleton').Skeleton | null = null;
  /** Knoten, unter dem Koerper und Teile haengen (traegt Massstab und Hoehe). */
  private halter: TransformNode | null = null;
  /**
   * Anhebung des Modells im Ruhezustand (aus `vermesseModell`). Der
   * Fussversatz kommt oben drauf — deshalb gemerkt statt einmal gesetzt.
   */
  private grundAnhebung = 0;
  /**
   * Geländehöhe an einer Stelle, oder null. Setzt der PlayerController;
   * ohne Sonde bleibt die Fussanpassung einfach aus (Vorschau im
   * Charakterfenster, Testszenen).
   */
  private bodenSonde: ((x: number, z: number) => number) | null = null;
  /** Aktueller, geglätteter Fussversatz in Metern (≥ 0 = angehoben). */
  private fussVersatz = 0;
  /** Weltpositionen der beiden Fussknochen — einmal geholt, dann gemerkt. */
  private fussKnoten: TransformNode[] = [];
  /**
   * Beinketten fuer das Fuss-IK: Oberschenkel, Unterschenkel, Knoechel je
   * Seite (Reihenfolge wie fussKnoten: links, rechts). Leer, wenn das
   * Modell die Knochen nicht mitbringt — dann bleibt es bei der
   * Halter-Absenkung.
   */
  private ikBeine: Array<{ bein: TransformNode; knie: TransformNode; fuss: TransformNode }> = [];
  /** Aktuelles Gewicht des Fuss-IK (0…1), wird bei Sprung/Fall ausgeblendet. */
  private ikGewicht = 0;
  /** Gewicht je Fuss (0…1): 10/s hoch, solange er gehoben wird, 2/s runter. */
  private ikFussGewicht = [0, 0];
  /** Geglaettete Hebung je Fuss (m), gegen Rauschen der Bodensonde. */
  private ikHebung = [0, 0];
  /** Fuss-IK an/aus (Messzellen vergleichen beide Zustaende). */
  ikAn = true;
  /** Letzter Flugzustand aus update(), fuer das IK-Gewicht. */
  private inDerLuftMerker = false;
  /**
   * Abstand Knöchel → Sohle in Metern, beim Laden aus der Ruhepose
   * gemessen.
   *
   * WARUM DAS NÖTIG IST: Der Knöchelknochen sitzt ÜBER der Sohle (bei der
   * Wikingerin rund 11 cm). Vergleicht man ihn direkt mit dem Boden, setzt
   * die Korrektur erst ein, wenn der Fuss bereits knöcheltief im Hang
   * steckt — also genau dann, wenn es längst auffällt.
   */
  private knoechelHoehe = 0;
  /** Bereits geladene Teile nach Dateiname — Umschalten kostet dann nichts. */
  private readonly teile = new Map<string, import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[]>();
  /** Was gerade in welchem Slot steckt. */
  private readonly getragen = new Map<string, string>();
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
   * Schlagclip. Wie der Sprung eine EINMALIGE Abspielung, aber im
   * Gegensatz zu ihm nicht an einen Zustand gebunden, den die Physik
   * meldet — er wird von `schlage()` angestossen und laeuft dann ab.
   */
  private clipAngriff: Clip | null = null;
  /**
   * Alle Schlagclips in Kombo-Reihenfolge (`angriff`, `angriff2`,
   * `angriff3`, …). `clipAngriff` ist immer der gerade gewaehlte davon.
   *
   * Vorbild (10.09.2026, Player-Animator des Originals): drei Schwert-
   * hiebe, die bei aufeinanderfolgenden Schlaegen 1 → 2 → 3 durchlaufen
   * und danach wieder von vorn beginnen. Dort schaltet der Waffen-
   * Substate (2/3/4) den Zustand um; hier zaehlt `schlage()` selbst
   * weiter, solange der naechste Schlag ins Kombo-Fenster faellt.
   */
  private clipsAngriff: Clip[] = [];
  /** Index des zuletzt gestarteten Schlags in `clipsAngriff`. */
  private angriffIndex = -1;
  /**
   * Restzeit des Kombo-Fensters (s): faellt der naechste Schlag hinein,
   * geht die Kette weiter, sonst beginnt sie bei Hieb 1. Laeuft ab dem
   * Start eines Schlags fuer Schlagdauer + KOMBO_FENSTER.
   */
  private komboRest = 0;
  /** Waffenschichten (Arm, Finger), nur wirksam solange etwas gehalten wird. */
  private schichten: Schicht[] = [];
  /** Aktuelles Gewicht der Waffenschichten (0…1), wird ein-/ausgeblendet. */
  private schichtGewicht = 0;
  /** Laufzeit der Schichtclips (s), fuer die Abtastposition. */
  private schichtZeit = 0;
  /** Einmal-Schichten nach Name (ausruesten, ablegen, parade_links, …). */
  private aktionen = new Map<string, Schicht>();
  private aktion: Aktion | null = null;
  private schichtBeobachter: Nullable<Observer<Scene>> = null;
  /**
   * Restlaufzeit des Schlags in Sekunden; > 0 heisst „schlaegt gerade".
   *
   * Eine Uhr statt einer Abfrage an der Animationsgruppe: Babylons
   * `onAnimationGroupEndObservable` feuert bei `speedRatio`-Wechseln und
   * beim Ueberblenden unzuverlaessig, und ein haengengebliebenes Flag
   * liesse die Figur dauerhaft in der Schlagpose stehen. Eine Uhr laeuft
   * immer ab.
   */
  private angriffRest = 0;
  /**
   * Solldauer eines Schlags (s). Vorgabe passend zum Schlagtakt in
   * main.ts; wird von dort gesetzt, damit beide nie auseinanderlaufen.
   */
  private angriffDauer = 0.5;
  /**
   * Wie lange ein Sprung dauert (s) — vom Absprung bis zur Landung. Setzt
   * der PlayerController, der die Sprungphysik kennt; der Clip wird darauf
   * gestreckt, damit die Landepose beim Aufsetzen erreicht ist und nicht
   * schon in der Luft.
   */
  private sprungDauer = 1;
  /**
   * Faktor vom Modellmaß auf Spielergrösse — beim Laden gemessen, nicht
   * angenommen. Bis das Modell da ist, gilt das Maß von `PlayerAvatar`.
   *
   * Er wird an drei Stellen gebraucht: für den Halter, für das getragene
   * Werkzeug (das seine eigene Grösse mitbringt und nicht ein zweites Mal
   * mitwachsen darf) und beim Umrechnen der im Clip eingebackenen
   * Wegstrecke in m/s.
   */
  private modellSkalierung = MODELL_SKALIERUNG;
  /** Aktuell laufender Clip. */
  private aktiv: Clip | null = null;
  /**
   * Laufende Überblendung zwischen zwei Clips. `t` zählt von 0 bis 1 über
   * UEBERBLENDUNG Sekunden; solange laufen beide Gruppen gleichzeitig und
   * werden über ihr Gewicht gemischt.
   */
  private blende: { von: Clip; nach: Clip; t: number; dauer: number } | null = null;
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

  /**
   * Dateiname des Figurenmodells unter /assets/models/.
   *
   * Frueher stand hier fest `PlayerAvatar.glb`. Seit der Figurenwahl
   * kommt der Name von aussen — die Liste steht in shared/figuren.ts,
   * damit Client und Server dieselbe kennen.
   */
  private readonly modellDatei: string;

  constructor(scene: Scene, modellDatei: string = modellDateiZu(FIGUR_VORGABE)) {
    this.modellDatei = modellDatei;
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
    const vorher = this.held !== null;
    if (this.held && this.held !== node) this.held.parent = null;
    this.held = node;
    // Beim Ergreifen die Schichtclips von vorn, damit Arm und Finger nicht
    // mitten im Zyklus einsteigen.
    if (node) this.schichtZeit = 0;
    if (node && !vorher) this.starteAktion('ausruesten');
    else if (!node && vorher) this.starteAktion('ablegen');
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
   * y 0.000…0.990), unsere Figur misst rund 1,8 m — daher der Faktor.
   * Fällt der Ladevorgang aus, bleibt die prozedurale Figur sichtbar.
   */
  private async ladeModell(scene: Scene): Promise<void> {
    try {
      const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');
      await import('@babylonjs/loaders/glTF/2.0');
      const res = await SceneLoader.ImportMeshAsync('', '/assets/models/', this.modellDatei, scene);

      // Tönung auftragen, bevor das erste Bild steht — Begründung und
      // Messung stehen an `FIGUR_TOENUNG` (shared/src/figuren.ts).
      toeneFigurMeshes(res.meshes, this.modellDatei);

      // JETZT vermessen, vor dem Umhängen: Solange die Meshes am
      // Szenenwurzel hängen, IST ihr Weltmaß das Modellmaß. Nach
      // `parent = halter` steckt die Spielerposition mit drin.
      const mass = this.vermesseModell(res.meshes);

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

      // Auf Spielergrösse bringen und so anheben, dass der TIEFSTE Punkt
      // des Modells auf der Rig-Wurzel steht — die sitzt auf dem Boden.
      this.modellSkalierung = SPIELER_HOEHE / mass.hoehe;
      halter.scaling.setAll(this.modellSkalierung);
      this.grundAnhebung = -mass.unten * this.modellSkalierung;
      halter.position.y = this.grundAnhebung;
      console.log(
        `[avatar] ${this.modellDatei}: ${mass.hoehe.toFixed(3)} m hoch ` +
          `(y ${mass.unten.toFixed(3)}…${(mass.unten + mass.hoehe).toFixed(3)}), ` +
          `Faktor ${this.modellSkalierung.toFixed(3)}, angehoben um ` +
          `${(-mass.unten * this.modellSkalierung).toFixed(3)} m`
      );
      // Modellvorderseite auf die Blickrichtung des Rigs drehen (+Z, siehe
      // PlayerController: "model forward is +Z").
      // Dieses Modell schaut bereits in +Z — keine Zusatzdrehung nötig.
      halter.rotation.y = 0;

      // ── Clips aus der Datei ─────────────────────────────────────
      // Haben Vorrang vor der prozeduralen Pose. Zugeordnet wird über das
      // gemessene Tempo, nicht über die Clipnamen (siehe Kopfkommentar).
      // ── Welcher Clip ist der Sprung? ─────────────────────────────
      // VOR der Messung, weil der Sprung dort anders behandelt wird.
      //
      // Unter mehreren Bewerbern gewinnt der KUERZESTE. Das ist keine
      // Willkuer: Ein Sprungclip enthaelt den Flug; ein laengerer enthaelt
      // zusaetzlich Stand, Hocke und Aufrichten — Phasen, die waehrend des
      // Fluges nichts zu suchen haben. Bei der Wikingerin stehen
      // `springen` (3,29 s: Stand, Hocke, Bogen, Landung, Aufrichten) und
      // `weitsprung` (0,96 s: ein vollstaendiger Sprung) zur Wahl,
      // waehrend der Flug 1,0 s dauert. Der lange Clip musste auf die
      // Flugzeit gestaucht werden und liess alle fuenf Phasen in einer
      // Sekunde ablaufen — Mike beschrieb es am 23.08.2026 als „flattert
      // wie ein Vogel", spaeter als „der Charakter schlaegt": Im Flug sah
      // man nur den Ausschlag der Arme im Scheitel.
      const sprungGruppe = res.animationGroups
        // `sprung` MUSS im Muster stehen: "weitsprung" enthaelt die
        // Zeichenfolge "spring" NICHT (s-p-r-U-n-g). Genau darauf hatte
        // der Name gezielt, damit der Clip keinem Zustand untergeschoben
        // wird — was hier aber dazu fuehrte, dass der bessere Sprungclip
        // gar nicht erst zur Wahl stand.
        .filter((g) => /sprung|spring|jump|leap/i.test(g.name))
        .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] ?? null;

      const clips = res.animationGroups
        .map((grp) => ({ grp, tempo: this.messeUndEntferneWurzelbewegung(grp, grp === sprungGruppe) }))
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
      // Denselben Clip nehmen, der oben bestimmt wurde — eine zweite
      // Namenssuche koennte etwas anderes finden als die Messung
      // behandelt hat.
      this.clipSprung = clips.find((c) => c.grp === sprungGruppe) ?? null;
      // Der Angriff wird aus DEMSELBEN Grund aussortiert: Ein Schlag holt
      // aus, die Hüfte wandert dabei ein Stück, und die Tempo-Einteilung
      // hielte ihn für einen Fortbewegungszyklus. Bei der Wikingerin misst
      // `angriff` genug Weg, um als "wandernd" zu gelten — ungefiltert
      // könnte er über die Ersatzregel `wandernd[letzter]` zum RENNZYKLUS
      // werden, und die Figur schlüge beim Sprinten um sich.
      //
      // `weitsprung` (nur die Wikingerin hat ihn) fängt keines der Muster
      // ab und bleibt bewusst ein unbenutzter Clip: Er gehört zu keinem
      // Zustand, den das Spiel kennt.
      // Kombo-Kette: alle Clips, die mit `angriff` beginnen, in Namens-
      // reihenfolge (angriff, angriff2, angriff3). Gibt es keine solche
      // Reihe, bleibt es beim einen Schlagclip nach dem alten Muster.
      const kette = clips
        .filter((c) => /^angriff/i.test(c.grp.name))
        .sort((x, y) => x.grp.name.localeCompare(y.grp.name, undefined, { numeric: true }));
      const einzel = kette.length ? null : nachName(/angriff|attack|schlag|punch|hit/i, clips);
      this.clipsAngriff = kette.length ? kette : einzel ? [einzel] : [];
      this.clipAngriff = this.clipsAngriff[0] ?? null;
      this.angriffIndex = -1;
      this.komboRest = 0;
      // Waffenschichten (arm_*, hand_*) sind keine Zustaende: Sie werden
      // unten zu Schichten und nehmen an keiner Einteilung teil.
      const schichtClips = clips.filter((c) => /^(arm|hand)_|^(ausruesten|ablegen|parade)/i.test(c.grp.name));
      this.baueSchichten(schichtClips);
      const rest = clips.filter(
        (c) => c !== this.clipSprung && !this.clipsAngriff.includes(c) && !schichtClips.includes(c)
      );
      const wandernd = rest.filter((c) => c.tempo > 0.1);
      this.clipsRuhe = rest.filter((c) => c.tempo <= 0.1);
      // Sprechende Namen schlagen die Messung. Der Tripo-Export vergibt
      // keine (`NlaTrack.002`), aber selbst eingebaute Clips — etwa ein bei
      // Mixamo geholter Ruhezyklus, den tools/mixamo-to-avatar.mjs unter
      // `idle` ablegt — sollen verlässlich dort landen, wo sie hingehören,
      // statt von der Tempo-Heuristik einsortiert zu werden.
      this.clipRuhe = nachName(/idle|ruhe|stand/i, this.clipsRuhe) ?? this.clipsRuhe[0] ?? null;
      if (this.clipRuhe) this.gleicheHueftversatzAn(clips, this.clipRuhe);
      this.clipGehen = nachName(/gehen|walk/i, wandernd) ?? wandernd[0] ?? null;
      this.clipRennen = nachName(/rennen|run|jog/i, wandernd) ?? wandernd[wandernd.length - 1] ?? null;
      if (clips.length) {
        const zeig = (c: Clip | null) => (c ? `"${c.grp.name}" ${c.tempo.toFixed(2)} m/s` : '—');
        console.log(
          `[avatar] Clips: ruhe ${zeig(this.clipRuhe)}` +
            (this.clipsRuhe.length > 1 ? ` (+${this.clipsRuhe.length - 1} weitere Standpose)` : '') +
            `, gehen ${zeig(this.clipGehen)}, rennen ${zeig(this.clipRennen)}` +
            `, sprung ${this.clipSprung ? `"${this.clipSprung.grp.name}" ${this.clipLaenge(this.clipSprung).toFixed(2)} s` : '—'}` +
            `, angriff ${this.clipAngriff ? `"${this.clipAngriff.grp.name}" ${this.clipLaenge(this.clipAngriff).toFixed(2)} s` : '—'}` +
            (this.clipsAngriff.length > 1
              ? ` (Kombo: ${this.clipsAngriff.map((c) => `${c.grp.name} ${this.clipLaenge(c).toFixed(2)} s`).join(' → ')})`
              : '') +
            (this.schichten.length
              ? `, Schichten ${this.schichten.map((s) => `${s.name} (${s.kanaele.length} Knochen)`).join(', ')}`
              : '') +
            (this.aktionen.size ? `, Aktionen ${[...this.aktionen.keys()].join(', ')}` : '')
        );
        // KEIN `enableBlending` hier: Übergänge laufen über die Gewichte
        // der Gruppen (siehe wechsleZu). Beides zusammen blendet doppelt —
        // die Figur schlingert dann durch den Wechsel.
        this.stelleRuhepose();
      }

      const skelett = res.skeletons[0] ?? null;
      if (skelett) {
        // Erster passender Name gewinnt — siehe KNOCHEN_NAMEN.
        const hole = (namen: readonly string[]): Bone | null => {
          for (const n of namen) {
            const b = skelett.bones.find((k) => k.name === n);
            if (b) return b;
          }
          return null;
        };
        const paare = Object.entries(KNOCHEN_NAMEN) as Array<
          [keyof AvatarRig['knochen'], readonly string[]]
        >;
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
        const fehlend = paare.filter(([f]) => !this.knochen[f]).map(([, n]) => n[0]);
        if (fehlend.length) console.warn('[avatar] Knochen nicht gefunden:', fehlend.join(', '));

        // ── Werkzeughand an den echten Handknochen hängen ────────────
        // Bisher hing `handR` am prozeduralen Ellbogen-Pivot. Das ging nur,
        // solange die prozedurale Pose die Figur bewegte: Sobald die Clips
        // die Knochen steuern, stehen die Pivots still und die Spitzhacke
        // bliebe reglos in der Luft, während der Arm darunter wegschwingt.
        const handKnochen = hole(HAND_NAMEN)?.getTransformNode() ?? null;
        if (handKnochen) {
          this.handR.parent = handKnochen;
          this.handR.position.setAll(0);
          // Der Halter skaliert das ganze Modell auf Spielergrösse; das
          // Werkzeug bringt seine eigene, bereits richtige Grösse mit und
          // darf nicht ein zweites Mal mitwachsen.
          this.handR.scaling.setAll(1 / this.modellSkalierung);
        } else {
          console.warn('[avatar] R_Hand nicht gefunden — Werkzeug bleibt am Ersatz-Pivot');
        }
      } else {
        console.warn('[avatar] Modell ohne Skelett — Figur bleibt statisch');
      }

      this.modell = halter;
      this.halter = halter;
      this.skelett = res.skeletons[0] ?? null;
      // Fussknochen für die Bodenanpassung. Erster Treffer gewinnt, damit
      // ein mixamorig-Skelett genauso bedient wird wie das Tripo-Rig.
      this.fussKnoten = [];
      for (const namen of [FUSS_LINKS, FUSS_RECHTS]) {
        for (const n of namen) {
          const tn = this.skelett?.bones.find((b) => b.name === n)?.getTransformNode();
          if (tn) { this.fussKnoten.push(tn); break; }
        }
      }
      // Beinketten fuer das Fuss-IK — nur wenn beide Seiten komplett sind.
      this.ikBeine = [];
      if (this.fussKnoten.length === 2 && this.skelett) {
        const finde = (namen: readonly string[]) => {
          for (const n of namen) {
            const tn = this.skelett!.bones.find((b) => b.name === n)?.getTransformNode();
            if (tn) return tn;
          }
          return null;
        };
        const seiten: Array<[readonly string[], readonly string[]]> = [
          [KNOCHEN_NAMEN.beinL, KNOCHEN_NAMEN.knieL],
          [KNOCHEN_NAMEN.beinR, KNOCHEN_NAMEN.knieR],
        ];
        const ketten = seiten.map(([b, k], i) => {
          const bein = finde(b);
          const knie = finde(k);
          const fuss = this.fussKnoten[i]!;
          return bein && knie && fuss.parent === knie && knie.parent === bein ? { bein, knie, fuss } : null;
        });
        if (ketten.every((k) => k !== null)) this.ikBeine = ketten as typeof this.ikBeine;
        else console.warn('[avatar] Beinketten unvollstaendig — Fuss-IK aus, nur Halter-Absenkung');
      }
      if (this.fussKnoten.length < 2) {
        console.warn('[avatar] Fussknochen nicht gefunden — keine Bodenanpassung');
      } else {
        // Sohlenabstand JETZT messen: Das Modell steht in Ruhepose, kein
        // Clip hat die Beine bewegt. Danach wäre der Knöchel irgendwo im
        // Schrittzyklus und der Wert zufällig.
        //
        // Gemessen wird gegen den TIEFSTEN GEZEICHNETEN PUNKT, nicht gegen
        // die Rig-Wurzel. Der Unterschied ist nicht theoretisch: Gegen die
        // Wurzel gerechnet war der Wert 13 mm zu gross, und die Anpassung
        // hob die Figur auf EBENEM Grund um genau diese 13 mm an — ein
        // Fehler, den die erste Prüfung nicht finden konnte, weil sie
        // denselben Bezugspunkt benutzte (Knöchel minus Wurzel, geprüft
        // gegen die Wurzel: per Konstruktion null).
        //
        // `applySkeleton: true` ist dabei entscheidend — ohne das bleibt
        // die Begrenzung bei den rohen Vertexdaten stehen und folgt der
        // gezeichneten Figur nicht.
        let sohleWelt = Infinity;
        const sammle = (knoten: TransformNode): void => {
          for (const kind of knoten.getChildren()) {
            const netz = kind as unknown as AbstractMesh;
            if (typeof netz.getTotalVertices === 'function' && netz.getTotalVertices() > 0) {
              netz.refreshBoundingInfo({ applySkeleton: true });
              netz.computeWorldMatrix(true);
              sohleWelt = Math.min(sohleWelt, netz.getBoundingInfo().boundingBox.minimumWorld.y);
            }
            sammle(kind as TransformNode);
          }
        };
        halter.computeWorldMatrix(true);
        sammle(halter);

        let tiefster = Infinity;
        for (const k of this.fussKnoten) {
          k.computeWorldMatrix(true);
          tiefster = Math.min(tiefster, k.getAbsolutePosition().y - sohleWelt);
        }
        this.knoechelHoehe =
          Number.isFinite(tiefster) && Number.isFinite(sohleWelt) ? Math.max(0, tiefster) : 0;
        console.log(
          `[avatar] Knöchel sitzt ${this.knoechelHoehe.toFixed(3)} m über der Sohle ` +
            `(Sohle ${Number.isFinite(sohleWelt) ? (sohleWelt - this.root.getAbsolutePosition().y).toFixed(3) : '?'} m über der Rig-Wurzel)`
        );
      }
      // Was vor dem Laden schon gewaehlt wurde, jetzt nachziehen: Der
      // Aufrufer setzt das Aussehen oft, bevor das Modell da ist.
      if (this.offenesAussehen) {
        const a = this.offenesAussehen;
        this.offenesAussehen = null;
        void this.setzeAussehen(a);
      }
    } catch (err) {
      // Kein Abbruch: die prozedurale Figur bleibt stehen.
      console.warn(`[avatar] ${this.modellDatei} nicht geladen, nutze Klötzchenfigur`, err);
    }
  }

  /**
   * Stufe 1 der Fussanpassung: die ganze Figur so weit anheben, dass kein
   * Fuss im Boden steckt.
   *
   * ════════════════════════════════════════════════════════════════
   *  Warum ANHEBEN und nicht absenken
   * ════════════════════════════════════════════════════════════════
   * Am Hang steht der bergseitige Fuss auf höherem Grund als der
   * talseitige. Ohne Bein-IK lässt sich nur einer von beiden richtig
   * setzen — und die Wahl ist nicht beliebig: Ein Fuss, der IM Hang
   * steckt, liest sich als Fehler; ein Fuss, der knapp darüber schwebt,
   * liest sich als ungenaue Animation. Deshalb bestimmt der HÖCHSTE
   * Boden unter den Füssen die Anhebung. Den zweiten Fuss holt Stufe 2
   * (Bein-IK, s. Feature-Liste).
   *
   * ════════════════════════════════════════════════════════════════
   *  Warum das den Halter bewegt und nicht die Wurzel
   * ════════════════════════════════════════════════════════════════
   * `root` IST die Spielerposition — sie wird jeden Frame aus der Physik
   * gesetzt und trägt die Kollisionskapsel. Dort etwas zu addieren hiesse,
   * die Figur wirklich anzuheben; sie würde schweben und der nächste
   * Physikschritt zöge sie zurück. Der Halter darunter ist reine Optik.
   *
   * ════════════════════════════════════════════════════════════════
   *  Warum die Fusspositionen einen Frame alt sind
   * ════════════════════════════════════════════════════════════════
   * Babylon wertet die Animationsgruppen erst in `scene.render()` aus,
   * diese Methode läuft davor. Gelesen wird also die Pose des VORIGEN
   * Bildes. Bei einer Grösse, die sich über Meter hinweg ändert, ist das
   * unsichtbar — und es erspart einen zweiten Einstiegspunkt in den
   * Bildablauf.
   */
  private passeAnBodenAn(dt: number, inDerLuft: boolean): void {
    if (!this.halter) return;
    // In der Luft gibt es nichts anzupassen; der Versatz läuft aber
    // weich aus, damit die Figur beim Absprung nicht zuckt.
    const ziel = inDerLuft || !this.bodenSonde || this.fussKnoten.length < 2
      ? 0
      : this.messeFussVersatz();

    const mitIk = this.ikAn && this.ikBeine.length === 2;
    const k = Math.min(1, mitIk ? dt * IK_HUEFTE_TEMPO : dt / FUSS_GLAETTUNG_S);
    this.fussVersatz += (ziel - this.fussVersatz) * k;
    this.halter.position.y = this.grundAnhebung + this.fussVersatz;
  }

  /**
   * Wie weit muss die Figur hoch ODER RUNTER, damit die Füsse den Boden
   * treffen?
   *
   * Genommen wird der GRÖSSTE der beiden Werte: Damit steckt kein Fuss im
   * Boden, und der tiefere von beiden steht auf. Der andere schwebt am
   * Hang weiterhin — das holt Stufe 2 (Bein-IK).
   */
  private messeFussVersatz(): number {
    // Mit Fuss-IK (Stufe 2) wie im Original: Die Huefte sinkt um den
    // groessten Gelaendeabfall unter einem der Fuesse gegenueber der
    // Standflaeche der Kapsel (root.y) — nie hoeher, nur tiefer. Was das
    // Gelaende dann unter einem Fuss anhebt, holt das IK am Bein nach.
    // Der Bezug ist das GELAENDE, nicht die animierte Sohle: So bleibt
    // die Huefte ruhig, waehrend die Fuesse im Schrittzyklus schwingen.
    const mitIk = this.ikAn && this.ikBeine.length === 2;
    if (mitIk) {
      const rigBoden = this.root.getAbsolutePosition().y;
      let abfall = 0;
      for (const knoten of this.fussKnoten) {
        knoten.computeWorldMatrix(true);
        const p = knoten.getAbsolutePosition();
        const boden = this.bodenSonde!(p.x, p.z);
        if (!Number.isFinite(boden)) continue;
        const tiefe = rigBoden - boden;
        // Kante oder Grube: ausserhalb der Reichweite zaehlt der Fuss nicht.
        if (tiefe > IK_REICHWEITE) continue;
        abfall = Math.max(abfall, tiefe);
      }
      return -Math.min(abfall, FUSS_ABSENK_MAX);
    }
    let noetig = -Infinity;
    for (const knoten of this.fussKnoten) {
      knoten.computeWorldMatrix(true);
      const p = knoten.getAbsolutePosition();
      const boden = this.bodenSonde!(p.x, p.z);
      if (!Number.isFinite(boden)) continue;
      // Nicht der Knöchel zählt, sondern die SOHLE darunter, und der schon
      // wirkende Versatz wird herausgerechnet (siehe Kommentar der Stufe 1).
      const sohleOhneVersatz = p.y - this.knoechelHoehe - this.fussVersatz;
      noetig = Math.max(noetig, boden - sohleOhneVersatz);
    }
    if (!Number.isFinite(noetig)) return 0;
    return Math.min(Math.max(noetig, -FUSS_ABSENK_MAX), FUSS_VERSATZ_MAX);
  }

  /**
   * Höhe und Fusshöhe des frisch geladenen Modells.
   *
   * WARUM GEMESSEN STATT ANGENOMMEN: Bis hierher standen zwei Zahlen fest
   * im Code — 0,99 m Höhe und „um den Ursprung zentriert". Beides gilt nur
   * für `PlayerAvatar.glb`. Es gibt aber keine Übereinkunft, an die sich
   * ein Modellierwerkzeug halten müsste:
   *
   *  - `WikingerinBasis.glb` legt die Füsse in den Ursprung (y 0…1,0).
   *    Mit der Annahme „zentriert" wurde sie um eine halbe Körperlänge zu
   *    hoch gesetzt und LIEF IN DER LUFT.
   *  - `Walkuere.glb` kommt aus Mixamo und ist 1,90 m hoch. Mit dem festen
   *    Faktor 1,818 wäre sie 3,46 m gross geworden und dabei 0,83 m im
   *    Boden versunken.
   *
   * Beide Fehler sehen im Code gleich harmlos aus und fallen erst im Spiel
   * auf — und auch dort nur, wenn man hinschaut. Deshalb wird jetzt
   * gemessen: Der tiefste Punkt kommt auf den Boden, die Gesamthöhe auf
   * SPIELER_HOEHE. Ein Modell, das sich nicht vermessen lässt, fällt auf
   * die alten Maße zurück, statt zu verschwinden.
   *
   * Gemessen wird die BINDEPOSE (Babylons Begrenzungskörper eines
   * Skinning-Meshes stammt aus den rohen Vertexdaten). Das ist genau das
   * gewünschte Maß: die aufrechte Ruhehaltung, nicht ein zufällig
   * geduckter Einzelframe.
   */
  private vermesseModell(meshes: readonly AbstractMesh[]): { hoehe: number; unten: number } {
    let unten = Infinity;
    let oben = -Infinity;
    for (const m of meshes) {
      // Der glTF-Loader hängt einen leeren `__root__` davor; nur Meshes
      // mit echter Geometrie tragen ein sinnvolles Maß.
      if (m.getTotalVertices() === 0) continue;
      m.computeWorldMatrix(true);
      const kasten = m.getBoundingInfo().boundingBox;
      unten = Math.min(unten, kasten.minimumWorld.y);
      oben = Math.max(oben, kasten.maximumWorld.y);
    }
    const hoehe = oben - unten;
    if (!Number.isFinite(hoehe) || hoehe < 0.01) {
      console.warn(
        `[avatar] ${this.modellDatei}: Höhe nicht messbar — nutze die Maße von PlayerAvatar`
      );
      return { hoehe: SPIELER_HOEHE / MODELL_SKALIERUNG, unten: -MODELL_HALBHOEHE };
    }
    return { hoehe, unten };
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
  private messeUndEntferneWurzelbewegung(grp: AnimationGroup, istSprung = false): number {
    let weiteste = 0;
    for (const ta of grp.targetedAnimations) {
      if (ta.animation.targetProperty !== 'position') continue;
      const zielName = (ta.target as { name?: string })?.name ?? '';
      // Nur wurzelnahe Knochen können den Körper als Ganzes versetzen.
      // `mixamorig:Hips` gehört dazu: Ohne den Namen blieb die eingebackene
      // Wegstrecke der Walküre unentdeckt — sie wurde weder entfernt (die
      // Figur wäre beim Laufen aus ihrer eigenen Kollisionskapsel gewandert)
      // noch gemessen, weshalb alle vier Clips als Standpose galten und es
      // schlicht kein "gehen" und kein "rennen" gab.
      if (!/^(Root|Hip|Hips|Pelvis|mixamorig:Hips)$/.test(zielName)) continue;
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

      // Von Modelleinheiten auf METER: Die Keyframes stehen im ELTERNraum
      // des Hüftknotens, also zählt dessen Weltmaßstab — nicht der Faktor
      // des Halters allein.
      //
      // Für unsere eigenen Modelle ist beides dasselbe (zwischen Halter und
      // Hüfte sitzt nur eine Verschiebung). Die Walküre bringt aber eine
      // Armature mit Maßstab 0,01 mit, weil Mixamo in Zentimetern rechnet:
      // Ihre Gehstrecke steht als 186 in der Datei und sind 1,86 m.
      const eltern = (ta.target as TransformNode).parent as TransformNode | null;
      eltern?.computeWorldMatrix(true);
      const massstab = eltern?.absoluteScaling?.x ?? this.modellSkalierung;
      const weiteMeter = weite * massstab;

      // Ein Wippen von wenigen Zentimetern ist Gang, keine Wanderung.
      // Die Schwelle steht in METERN, seit es Modelle mit anderem Maßstab
      // gibt: In Modelleinheiten gemessen hätte das Atmen der Walküre
      // (5,9 Einheiten = 5,6 cm) als Wanderung gegolten und ihr die
      // Auf-und-ab-Bewegung im Stand genommen.
      if (weiteMeter < 0.2) continue;

      // Festnageln auf den Wert der BINDEPOSE, nicht auf den ersten
      // Keyframe: Der Rennzyklus startet bereits 0,64 Einheiten vor dem
      // Ursprung: eingefroren stünde die Figur 1,2 m vor ihrem eigenen
      // Mittelpunkt und damit neben der Kollisionskapsel.
      // Sonst NUR die wandernde Achse — beim Sprung ALLE DREI.
      //
      // Waehrend des Fluges gehoert die Position der Figur vollstaendig
      // der Physik: Sie hebt, traegt vorwaerts und laesst fallen. Legt
      // der Clip auch nur eine Achse mit drauf, addieren sich beide.
      // Beim Sprungclip `weitsprung` sind das 0,32 Modelleinheiten nach
      // oben (0,58 m) ZUSAETZLICH zum physikalischen Sprung — die Figur
      // schoesse doppelt so hoch, ohne dass die Kollision davon wuesste.
      const achsen: Array<'x' | 'y' | 'z'> = istSprung ? ['x', 'y', 'z'] : [achse];
      for (const ax of achsen) {
        const ruhewert = (ta.target as TransformNode).position[ax];
        for (const k of keys) (k.value as Vector3)[ax] = ruhewert;
      }
      ta.animation.setKeys(keys);

      const fps = ta.animation.framePerSecond || 60;
      const dauer = (keys[keys.length - 1].frame - keys[0].frame) / fps;
      if (dauer > 0) weiteste = Math.max(weiteste, weiteMeter / dauer);
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
  private wechsleZu(ziel: Clip, schleife = true, vonVorn = false, dauer = UEBERBLENDUNG): void {
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
      this.blende = { von, nach: ziel, t: 0, dauer };
    } else {
      ziel.grp.setWeightForAllAnimatables(1);
    }
    this.aktiv = ziel;
  }

  /** Schreibt eine laufende Überblendung fort. */
  private treibeUeberblendung(dt: number): void {
    const b = this.blende;
    if (!b) return;
    b.t += dt / b.dauer;
    // Quelle schon zu Ende (Einmal-Abspielung abgelaufen): Babylon hat
    // ihre Animatables entfernt, ein Restgewicht darauf springt. Dann
    // sofort fertig — die Rueckkehr wird unten ohnehin vor dem Clipende
    // gestartet, so dass dieser Fall die Ausnahme bleibt.
    if (!b.von.grp.isPlaying) b.t = 1;
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
      for (const c of [this.clipRuhe, this.clipGehen, this.clipRennen, this.clipSprung, this.clipAngriff])
        c?.grp.pause();
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
  /**
   * Einen Schlag anstossen — Waffe oder Faust, die Animation ist dieselbe.
   *
   * WARUM DIE FIGUR DAS NICHT SELBST MERKT: Der Schlag ist das einzige
   * Ereignis in dieser Klasse. Gangart und Sprung liest `update()` aus
   * Geschwindigkeit und Bodenkontakt ab, also aus Zustaenden, die jeden
   * Frame neu gelten. Ein Schlag gilt genau einmal, im Moment des Klicks —
   * dafuer gibt es keine Groesse, die man abfragen koennte.
   *
   * Ein erneuter Klick waehrend des Schlags setzt ihn von vorn an, statt
   * ihn zu verlaengern: So folgt die Figur dem Klicktakt des Spielers,
   * auch wenn der schneller ist als der Clip lang.
   *
   * @returns false, wenn das Modell keinen Schlagclip mitbringt — dann
   *          bleibt es beim reinen Serverschlag ohne sichtbare Geste.
   */
  schlage(): boolean {
    if (!this.clipsAngriff.length || !this.nutzeClip) return false;
    // Kombo: innerhalb des Fensters den naechsten Hieb der Kette, sonst
    // wieder Hieb 1. Ein einzelner Schlagclip laeuft damit wie bisher.
    const n = this.clipsAngriff.length;
    this.angriffIndex = this.komboRest > 0 && this.angriffIndex >= 0 ? (this.angriffIndex + 1) % n : 0;
    const clip = this.clipsAngriff[this.angriffIndex]!;
    this.clipAngriff = clip;
    this.setzeAngriffTempo();
    // Die Uhr endet UEBERBLEND_AUSSTIEG vor dem Clipende: dann beginnt die
    // Rueckkehr, waehrend der Hieb noch seine letzten Bilder spielt.
    this.angriffRest = Math.max(0.05, this.hiebDauer(clip) - UEBERBLEND_AUSSTIEG);
    this.komboRest = this.angriffRest + KOMBO_FENSTER;

    if (this.aktiv === clip) {
      // ── Schon am Schlagen: SELBST neu anstossen ──────────────────
      // `wechsleZu` steigt bei `von === ziel` in der ersten Zeile aus.
      // Beim zweiten Klick wurde deshalb zwar die Uhr neu gestellt, der
      // Clip aber NICHT neu gestartet: Er lief als Einmal-Abspielung zu
      // Ende, hoerte auf, Knochen zu schreiben — und die frische Uhr
      // hielt ihn trotzdem als „aktiv" fest. Die Figur stand fuer die
      // Dauer einer weiteren Uhr in der Endpose. Genau das ist das
      // Aussetzen, das Mike am 23.08.2026 gemeldet hat.
      //
      // Eine laufende Ueberblendung wird dabei abgeraeumt, sonst zieht
      // sie das Gewicht des neu gestarteten Clips gleich wieder herunter.
      if (this.blende) {
        this.blende.von.grp.pause();
        this.blende.von.grp.setWeightForAllAnimatables(1);
        this.blende = null;
      }
      clip.grp.play(false);
      clip.grp.goToFrame(clip.grp.from);
      clip.grp.setWeightForAllAnimatables(1);
      return true;
    }

    const ausHieb = this.aktiv !== null && this.clipsAngriff.includes(this.aktiv);
    this.wechsleZu(clip, false, true, ausHieb ? UEBERBLEND_ANGRIFF : UEBERBLEND_EINSTIEG);
    return true;
  }

  /**
   * Hueftversatz aller Clips an den Ruheclip angleichen (waagerecht).
   *
   * Jeder Clip bringt seine eigene Huefte-Startposition mit — die Quelle
   * legt den Ursprung je Aufnahme woanders hin, und das Entfernen der
   * Wurzelbewegung nimmt nur den linearen Drift, nicht den Anfangswert.
   * Gemessen am 10.09.2026 am Wikinger: Ruhe z 0,051, Gehen und alle
   * Hiebe z 0. Bei jedem Wechsel rutschte die Figur damit 5 cm nach
   * hinten — im Einstieg in den ersten Hieb zusammen mit Armwechsel und
   * Kauern der sichtbare Ruck. Die Hoehe bleibt: Kauern und Aufrichten
   * gehoeren zur Bewegung.
   */
  private gleicheHueftversatzAn(clips: Clip[], ruhe: Clip): void {
    // Ausdruecklich die HUEFTE, nicht `Root`: Der Wurzelknoten steht in
    // jedem Clip gleich (0/0/0) und haette als erster Treffer die Angleichung
    // still zu einem Nichts gemacht — genau so lief der erste Anlauf am
    // 10.09. ins Leere.
    const hueftKeys = (grp: AnimationGroup) => {
      for (const ta of grp.targetedAnimations) {
        if (ta.animation.targetProperty !== 'position') continue;
        const zielName = (ta.target as { name?: string })?.name ?? '';
        if (/^(Hip|Hips|Pelvis|mixamorig:Hips)$/.test(zielName)) return ta.animation.getKeys();
      }
      return null;
    };
    const ref = hueftKeys(ruhe.grp);
    if (!ref || !ref.length) return;
    const soll = ref[0]!.value as Vector3;
    let verschoben = 0;
    for (const c of clips) {
      if (c === ruhe) continue;
      const keys = hueftKeys(c.grp);
      if (!keys || !keys.length) continue;
      const ist = keys[0]!.value as Vector3;
      const dx = soll.x - ist.x;
      const dz = soll.z - ist.z;
      if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) continue;
      // Babylon fuehrt das erste Schluesselbild doppelt (keys[0] und keys[1]
      // zeigen auf DASSELBE Vector3); wer stur ueber die Liste geht, schiebt
      // den Anfang doppelt und den Rest einfach — gemessen am 10.09.:
      // z 0,101 am Anfang, 0,051 am Ende. Deshalb je Objekt nur einmal.
      const gesehen = new Set<Vector3>();
      for (const k of keys) {
        const v = k.value as Vector3;
        if (gesehen.has(v)) continue;
        gesehen.add(v);
        v.x += dx;
        v.z += dz;
      }
      verschoben++;
    }
    if (verschoben) console.log(`[avatar] Hueftversatz von ${verschoben} Clips an "${ruhe.grp.name}" angeglichen`);
  }

  /**
   * Wie lange ein Schlag dauern soll (s) — der Clip wird darauf gestreckt
   * oder gestaucht, genau wie der Sprung auf die Flugdauer.
   *
   * WARUM NICHT DIE CLIPLAENGE: Der Rohclip der Wikingerin dauert 1,29 s,
   * der Schlagtakt des Spiels ist 0,5 s. Ungestaucht wirkte der Schlag
   * traege, und jeder zweite Klick fiel mitten in den laufenden Clip.
   * Auf den Takt gestaucht ist die Geste vorbei, wenn der naechste Schlag
   * erlaubt ist — schnell genug UND ohne Ueberlappung.
   */
  setAngriffDauer(sekunden: number): void {
    if (sekunden > 0) {
      this.angriffDauer = sekunden;
      if (this.angriffRest > 0) this.setzeAngriffTempo();
    }
  }

  /** Clip auf `angriffDauer` normieren. */
  private setzeAngriffTempo(): void {
    if (!this.clipAngriff) return;
    const laenge = this.clipLaenge(this.clipAngriff);
    const dauer = this.hiebDauer(this.clipAngriff);
    this.clipAngriff.grp.speedRatio = laenge > 0 ? laenge / dauer : 1;
    // NUR das Tempo, keine Uhr: setAngriffDauer() ruft hierher, und wer
    // hier die Uhr stellte, hielte sie bei jedem Aufruf wieder auf Anfang
    // (so lief am 10.09. jeder Hieb bis zum harten Gruppenende durch).
  }

  /**
   * Wie lange ein Hieb laeuft (s): volle Clips mit ANGRIFF_TEMPO wie im
   * Original, aber nie kuerzer als der Schlagtakt (angriffDauer), sonst
   * ueberlappten sich zwei Klicks im selben Clip.
   */
  private hiebDauer(clip: Clip): number {
    return Math.max(this.angriffDauer, this.clipLaenge(clip) / ANGRIFF_TEMPO);
  }

  /** Laeuft gerade ein Schlag? Fuer HUD und Messzellen. */
  get schlaegt(): boolean {
    return this.angriffRest > 0;
  }

  /**
   * Woher die Geländehöhe kommt. Ohne Sonde bleibt die Fussanpassung aus.
   */
  setBodenSonde(sonde: ((x: number, z: number) => number) | null): void {
    this.bodenSonde = sonde;
  }

  /** Nur zum Messen: der aktuell wirkende Fussversatz in Metern. */
  /** For measuring only: the foot offset currently applied, in metres. */
  get fussVersatzMeter(): number {
    return this.fussVersatz;
  }

  /**
   * Nur zum Messen: die Welthöhe der SOHLE — der tiefere der beiden
   * Fussknochen, abzüglich der beim Laden gemessenen Knöchelhöhe.
   *
   * Warum nicht die Bounding-Box: Vault-Notiz „Begrenzungskörper lügt bei
   * Skinning" — eine Box über einem verformten Netz meldet die BINDEPOSE.
   * Der Knochen ist der Zeuge, und `knoechelHoehe` ist genau der Betrag, der
   * ihn in eine Sohle übersetzt (beim Laden aus der Ruhepose gemessen).
   *
   * For measuring only: the world height of the SOLE — the lower of the two
   * foot bones minus the ankle height measured at load time. Not the bounding
   * box: a box over a skinned mesh reports the bind pose.
   */
  get sohleWeltY(): number {
    let tiefste = Number.POSITIVE_INFINITY;
    for (const knoten of this.fussKnoten) {
      knoten.computeWorldMatrix(true);
      tiefste = Math.min(tiefste, knoten.getAbsolutePosition().y - this.knoechelHoehe);
    }
    return Number.isFinite(tiefste) ? tiefste : this.root.getAbsolutePosition().y;
  }

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
   *                Rennzyklus. Wie im Vorbild ist das ein eigener Zustand
   *                (`Character.m_run`) und nicht bloss eine Schwelle auf der
   *                Geschwindigkeit.
   * @param inDerLuft Kein Bodenkontakt — schaltet auf den Sprungclip, der
   *                Vorrang vor allen anderen hat.
   */
  update(dt: number, speed: number, maxSpeed: number, rennt = false, inDerLuft = false): void {
    this.inDerLuftMerker = inDerLuft;
    // Fussanpassung ZUERST: Sie liest die Pose des vorigen Bildes und
    // setzt nur den Halter — die Clipwahl weiter unten stört sie nicht.
    this.passeAnBodenAn(dt, inDerLuft);

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
      // Der Schlag laeuft auf einer Uhr ab, nicht auf einem Zustand.
      // Solange sie laeuft, hat er VORRANG vor allem anderen — auch vor
      // dem Sprung: Wer im Fallen zuschlaegt, soll den Schlag sehen, und
      // ein Sprungclip, der den Schlag ueberschreibt, sieht aus wie ein
      // verschluckter Klick.
      if (this.komboRest > 0) this.komboRest = Math.max(0, this.komboRest - dt);
      if (this.angriffRest > 0) {
        this.angriffRest = Math.max(0, this.angriffRest - dt);
        // SELBSTHEILUNG: Die Uhr ist die Absicht, die Gruppe die
        // Wirklichkeit. Ist der Einmal-Clip durchgelaufen, schreibt er
        // keine Knochen mehr — eine Uhr, die dann noch laeuft, haelt die
        // Figur in der Endpose fest. Sagt die Wirklichkeit „fertig",
        // endet der Schlag sofort, statt auf die Uhr zu warten.
        if (this.angriffRest > 0 && this.clipAngriff && !this.clipAngriff.grp.isPlaying) {
          this.angriffRest = 0;
        }
      }
      const schlaegt = this.angriffRest > 0 && this.clipAngriff !== null;

      const springt = !schlaegt && inDerLuft && this.clipSprung !== null;
      const ziel = schlaegt
        ? this.clipAngriff
        : springt
          ? this.clipSprung
          : !bewegt
            ? this.clipRuhe
            : (rennt ? this.clipRennen : this.clipGehen) ?? this.clipGehen ?? this.clipRuhe;

      if (ziel !== this.aktiv) {
        // Einmal durchspielen und von vorn beginnen — beides nur für den
        // Sprung (siehe wechsleZu). Der Schlag startet nicht hier, sondern
        // in `schlage()`; hier wird nur ZURUECK gewechselt, wenn die Uhr
        // abgelaufen ist.
        if (ziel) {
          const ausHieb = this.aktiv !== null && this.clipsAngriff.includes(this.aktiv);
          this.wechsleZu(ziel, !springt, springt, ausHieb ? UEBERBLEND_AUSSTIEG : UEBERBLENDUNG);
        }
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
      } else if (this.aktiv === this.clipAngriff && this.clipAngriff) {
        // Der Schlag folgt dem Schlagtakt, nicht der Laufgeschwindigkeit.
        // Er hat eine Wegstrecke (die Figur holt aus), fiele damit unter
        // `tempo > 0` und würde von der Normierung unten an die
        // Geschwindigkeit gekoppelt: Im Stand wäre `s = 0`, der Faktor
        // liefe in seine untere Schranke (0,55) und der Schlag käme in
        // Zeitlupe. Dieselbe Sonderbehandlung wie beim Sprung.
        this.setzeAngriffTempo();
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

  /**
   * Schichten aus den Clips bauen: `arm_*` ueberschreibt die Armknochen
   * (SCHICHT_ARM), `hand_*` alle Knoten unterhalb von Hand_R (die Finger).
   * Genommen werden nur Rotationskanaele — die Translationen der Knochen
   * sind in den Exporten konstant und tragen nichts bei.
   */
  private baueSchichten(clips: Clip[]): void {
    this.schichten = [];
    this.aktionen.clear();
    this.aktion = null;
    if (this.schichtBeobachter) {
      this.root.getScene().onAfterAnimationsObservable.remove(this.schichtBeobachter);
      this.schichtBeobachter = null;
    }
    // Auch ohne Schichtclips wird der Beobachter gebraucht: Er traegt das Fuss-IK.
    const scene = this.root.getScene();
    const hand = scene.getTransformNodeByName('Hand_R');
    const finger = new Set(hand ? hand.getDescendants(false).map((n) => n.name) : []);
    const handL = scene.getTransformNodeByName('Hand_L');
    const oberkoerper = new Set<string>([
      ...SCHICHT_OBERKOERPER,
      ...finger,
      ...(handL ? handL.getDescendants(false).map((n) => n.name) : []),
    ]);
    for (const clip of clips) {
      const istArm = /^arm_/i.test(clip.grp.name);
      const istAktion = /^(ausruesten|ablegen|parade)/i.test(clip.grp.name);
      const maske = (name: string) =>
        istAktion
          ? oberkoerper.has(name)
          : istArm
            ? (SCHICHT_ARM as readonly string[]).includes(name)
            : finger.has(name);
      const kanaele: Schicht['kanaele'] = [];
      let fps = 60;
      for (const ta of clip.grp.targetedAnimations) {
        const ziel = ta.target as TransformNode;
        if (ta.animation.targetProperty !== 'rotationQuaternion' || !maske(ziel.name)) continue;
        kanaele.push({ knoten: ziel, anim: ta.animation });
        fps = ta.animation.framePerSecond;
      }
      if (kanaele.length) {
        const schicht: Schicht = {
          name: clip.grp.name, kanaele, von: clip.grp.from, bis: clip.grp.to, fps,
          schleife: !istAktion,
          tempo: istAktion ? AKTION_TEMPO[clip.grp.name.split('_')[0]!.toLowerCase()] ?? 1 : 1,
        };
        if (istAktion) this.aktionen.set(clip.grp.name.toLowerCase(), schicht);
        else this.schichten.push(schicht);
      }
      // Als Zustand darf die Gruppe nie laufen.
      clip.grp.stop();
    }
    this.schichtBeobachter = scene.onAfterAnimationsObservable.add(() => {
      this.wendeSchichtenAn();
      this.wendeFussIkAn();
    });
  }

  /**
   * Einmal-Aktion auf der Oberkoerperschicht starten: `ausruesten`,
   * `ablegen`, `parade_links|rechts|unten` oder nur `parade` (zufaellige
   * Richtung — das Original waehlt sie nach der Richtung des eingehenden
   * Treffers, die der Client hier nicht kennt).
   *
   * @returns false, wenn die Figur keinen solchen Clip mitbringt oder
   *          gerade ein Hieb laeuft (im Original ueberschreibt der Full
   *          Body Layer alles, eine Parade waehrend des Hiebs ist unsichtbar).
   */
  starteAktion(name: string): boolean {
    if (!this.nutzeClip) return false;
    let schluessel = name.toLowerCase();
    if (schluessel === 'parade') {
      const richtungen = [...this.aktionen.keys()].filter((k) => k.startsWith('parade_'));
      if (!richtungen.length) return false;
      schluessel = richtungen[Math.floor(Math.random() * richtungen.length)]!;
    }
    const schicht = this.aktionen.get(schluessel);
    if (!schicht) return false;
    if (schluessel.startsWith('parade') && this.angriffRest > 0) return false;
    const spanne = (schicht.bis - schicht.von) / schicht.fps;
    this.aktion = { schicht, zeit: 0, dauer: spanne / schicht.tempo };
    return true;
  }

  /** Laeuft gerade eine Parade? Fuer HUD und Messzellen. */
  get pariert(): boolean {
    return this.aktion !== null && this.aktion.schicht.name.toLowerCase().startsWith('parade');
  }

  /**
   * Nach der Animationsauswertung: Schichtclips abtasten und mit dem
   * aktuellen Gewicht auf die Knoten schreiben. Ziel 1, solange etwas
   * gehalten wird und kein Hieb laeuft (im Original ueberschreibt der
   * Full-Body-Layer mit dem Hieb alle Schichten, und die Hiebclips
   * greifen den Griff selbst); sonst 0.
   */
  private wendeSchichtenAn(): void {
    const dt = this.root.getScene().getEngine().getDeltaTime() / 1000;

    // ── Einmal-Aktion (Oberkoerper) ──────────────────────────────────
    // Ihr Gewicht: Einblenden am Anfang, Ausblenden am Ende, dazwischen 1.
    let aktionGewicht = 0;
    const ak = this.aktion;
    if (ak) {
      ak.zeit += dt;
      if (ak.zeit >= ak.dauer || (this.angriffRest > 0 && !ak.schicht.name.toLowerCase().startsWith('ablegen'))) {
        // Zu Ende — oder ein Hieb hat sie ueberholt (Full Body Layer).
        this.aktion = null;
      } else {
        aktionGewicht = Math.min(1, ak.zeit / AKTION_BLENDE, (ak.dauer - ak.zeit) / AKTION_BLENDE);
        const s = ak.schicht;
        const frame = Math.min(s.bis, s.von + ak.zeit * s.tempo * s.fps);
        this.schreibeSchicht(s, frame, aktionGewicht);
      }
    }

    // ── Dauerschichten (Arm, Finger) ─────────────────────────────────
    // Das Gewicht haengt an der laufenden Ueberblendung, nicht an einer
    // eigenen Uhr: Beim Wechsel in den Hieb sinkt es genau so, wie das
    // Gewicht des Hiebclips steigt, und beim Ausstieg umgekehrt. Ein
    // getrenntes Ausblenden liess fuer einige Bilder den unbewaffneten
    // Arm des Ruheclips durchscheinen — das „Zucken" beim ersten Hieb,
    // das Mike am 10.09. gemeldet hat.
    let ziel = 0;
    if (this.held && this.nutzeClip) {
      const b = this.blende;
      const hieb = (c: Clip | null) => c !== null && this.clipsAngriff.includes(c);
      if (this.angriffRest > 0 || hieb(this.aktiv)) {
        ziel = b && hieb(b.nach) && !hieb(b.von) ? 1 - Math.min(1, b.t) : 0;
      } else {
        ziel = b && hieb(b.von) ? Math.min(1, b.t) : 1;
      }
    }
    // Waehrend einer Aktion tritt die Dauerschicht zurueck (Upperbody
    // Layer liegt im Original ueber dem Right Arm Layer).
    ziel *= 1 - aktionGewicht;
    // Ohne Ueberblendung (z. B. Waffe weg) weich nachziehen.
    const schritt = dt / SCHICHT_BLENDE;
    this.schichtGewicht = this.blende
      ? ziel
      : this.schichtGewicht + Math.max(-schritt, Math.min(schritt, ziel - this.schichtGewicht));
    if (this.schichtGewicht <= 0) return;
    this.schichtZeit += dt;
    for (const s of this.schichten) {
      const spanne = s.bis - s.von;
      const frame = spanne > 0 ? s.von + ((this.schichtZeit * s.fps) % spanne) : s.von;
      this.schreibeSchicht(s, frame, this.schichtGewicht);
    }
  }

  /** Schicht bei `frame` abtasten und mit `gewicht` auf ihre Knoten legen. */
  private schreibeSchicht(s: Schicht, frame: number, gewicht: number): void {
    if (gewicht <= 0) return;
    for (const k of s.kanaele) {
      const q = k.anim.evaluate(frame) as Quaternion;
      if (!k.knoten.rotationQuaternion) k.knoten.rotationQuaternion = q.clone();
      else if (gewicht >= 1) k.knoten.rotationQuaternion.copyFrom(q);
      else Quaternion.SlerpToRef(k.knoten.rotationQuaternion, q, gewicht, k.knoten.rotationQuaternion);
    }
  }

  /**
   * Fuss-IK je Fuss (Stufe 2): Jeder Fuss bekommt die Hoehe des Bodens
   * unter IHM, mit der animierten Hebung darueber — der Schrittzyklus
   * bleibt, nur das Gelaende kommt dazu. Zwei-Knochen-IK auf
   * Oberschenkel und Unterschenkel, Kniebeugeebene aus der Animation;
   * der Knoechel behaelt seine animierte Weltdrehung und neigt sich
   * zusaetzlich mit dem Hang unter dem Fuss. Laeuft nach der
   * Animationsauswertung (und nach den Waffenschichten), damit die
   * Knochen nicht gleich wieder ueberschrieben werden.
   */
  private wendeFussIkAn(): void {
    const dt = this.root.getScene().getEngine().getDeltaTime() / 1000;
    const ziel = this.ikAn && this.bodenSonde && this.ikBeine.length === 2 && !this.inDerLuftMerker && this.nutzeClip ? 1 : 0;
    const schritt = dt / IK_BLENDE;
    this.ikGewicht += Math.max(-schritt, Math.min(schritt, ziel - this.ikGewicht));
    if (this.ikGewicht <= 0 || !this.bodenSonde) return;
    const rigBoden = this.root.getAbsolutePosition().y;
    const sonde = this.bodenSonde;
    const vorn = this.root.forward.clone();
    vorn.y = 0;
    vorn.normalize();

    this.ikBeine.forEach(({ bein, knie, fuss }, i) => {
      bein.computeWorldMatrix(true);
      knie.computeWorldMatrix(true);
      fuss.computeWorldMatrix(true);
      const H = bein.getAbsolutePosition().clone();
      const K = knie.getAbsolutePosition().clone();
      const A = fuss.getAbsolutePosition().clone();
      const boden = sonde(A.x, A.z);
      // Wie tief steckt die animierte Sohle (samt Hueftabsenkung) im Boden?
      // Nur DAS wird gehoben — ein Fuss ueber dem Boden bleibt, wie die
      // Animation ihn setzt (Original: Bedingung `… - footOffset - hipsOffset < 0`).
      const eindringen = Number.isFinite(boden) && rigBoden - boden <= IK_REICHWEITE
        ? boden - (A.y - this.knoechelHoehe)
        : 0;
      const aktiv = eindringen > 0.003;
      const zielGewicht = aktiv ? 1 : 0;
      const tempo = aktiv ? IK_GEWICHT_AN : IK_GEWICHT_AUS;
      const alt = this.ikFussGewicht[i]!;
      this.ikFussGewicht[i] = Math.max(0, Math.min(1, alt + Math.max(-tempo * dt, Math.min(tempo * dt, zielGewicht - alt))));
      // Hebung leicht geglaettet (Sondenrauschen), aber ohne Nachlauf nach
      // unten: Steckt der Fuss nicht mehr, faellt die Hebung sofort weg.
      const sollHebung = Math.min(IK_HUB_MAX, Math.max(0, eindringen));
      this.ikHebung[i] = sollHebung <= 0 ? 0 : this.ikHebung[i]! + (sollHebung - this.ikHebung[i]!) * Math.min(1, dt * 20);
      const dy = this.ikHebung[i]! * this.ikGewicht;
      const fussWeltVorher = fuss.getWorldMatrix().clone();
      if (dy > 0.002) {
        const T = new Vector3(A.x, A.y + dy, A.z);
        const l1 = Vector3.Distance(H, K);
        const l2 = Vector3.Distance(K, A);
        const richtung = T.subtract(H);
        let d = richtung.length();
        if (d < 1e-4 || l1 < 1e-4 || l2 < 1e-4) return;
        const dMax = (l1 + l2) * 0.995;
        if (d > dMax) {
          richtung.scaleInPlace(dMax / d);
          d = dMax;
          T.copyFrom(H).addInPlace(richtung);
        }
        const e = richtung.scale(1 / d);
        // Kniebeugeebene aus der Animation: Anteil von (K-H) quer zu e.
        const hk = K.subtract(H);
        const quer = hk.subtract(e.scale(Vector3.Dot(hk, e)));
        if (quer.lengthSquared() < 1e-6) quer.copyFrom(vorn);
        quer.normalize();
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        const K2 = H.add(e.scale(a)).addInPlace(quer.scale(h));
        this.dreheZu(bein, H, K, K2);
        knie.computeWorldMatrix(true);
        const K2w = knie.getAbsolutePosition().clone();
        fuss.computeWorldMatrix(true);
        const A2 = fuss.getAbsolutePosition().clone();
        this.dreheZu(knie, K2w, A2, T);
        knie.computeWorldMatrix(true);
        // Knoechel: animierte Weltdrehung wiederherstellen
        //   fussWelt = fussLokal * knieWelt  →  fussLokal = fussWeltVorher * knieWelt⁻¹
        const lokal = fussWeltVorher.multiply(Matrix.Invert(knie.getWorldMatrix()));
        const q = new Quaternion();
        lokal.decompose(undefined, q, undefined);
        if (!fuss.rotationQuaternion) fuss.rotationQuaternion = q;
        else fuss.rotationQuaternion.copyFrom(q);
      }
      // Hangneigung unter dem Fuss — nur mit dem Fussgewicht, also nur
      // fuer einen Fuss, der auf dem Boden steht (Original: Rotation aus
      // der Bodennormalen, gewichtet wie die Position).
      const g = this.ikFussGewicht[i]! * this.ikGewicht;
      if (g > 0.01) {
        const vornH = sonde(A.x + vorn.x * IK_NEIGUNG_SCHRITT, A.z + vorn.z * IK_NEIGUNG_SCHRITT);
        const hintenH = sonde(A.x - vorn.x * IK_NEIGUNG_SCHRITT, A.z - vorn.z * IK_NEIGUNG_SCHRITT);
        if (Number.isFinite(vornH) && Number.isFinite(hintenH)) {
          const neigung = Math.atan2(vornH - hintenH, 2 * IK_NEIGUNG_SCHRITT) * g;
          if (Math.abs(neigung) > 0.005) {
            const querAchse = Vector3.Cross(Vector3.Up(), vorn).normalize();
            this.dreheUm(fuss, querAchse, -neigung);
          }
        }
      }
    });
  }

  /**
   * Dreht `knoten` so, dass die Weltrichtung (von → alt) auf (von → neu)
   * zeigt. Gerechnet im Raum des Elternknotens, damit die Spiegelung des
   * glTF-Wurzelknotens (Skalierung 1/1/-1) mit hineinfaellt.
   */
  private dreheZu(knoten: TransformNode, von: Vector3, alt: Vector3, neu: Vector3): void {
    const eltern = knoten.parent as TransformNode | null;
    const inv = eltern ? Matrix.Invert(eltern.getWorldMatrix()) : Matrix.Identity();
    const v1 = Vector3.TransformNormal(alt.subtract(von), inv).normalize();
    const v2 = Vector3.TransformNormal(neu.subtract(von), inv).normalize();
    if (Vector3.Dot(v1, v2) > 0.99999) return;
    const delta = Quaternion.FromUnitVectorsToRef(v1, v2, new Quaternion());
    const q = knoten.rotationQuaternion ?? Quaternion.Identity();
    // Reihenfolge GEMESSEN (10.09.2026, Hang 47°): `delta * q` bringt beide
    // Fuesse auf ±2,5 cm an den Boden, `q * delta` liess den Bergfuss 12 cm
    // im Hang stecken — die Korrektur liegt im Elternraum, also links.
    knoten.rotationQuaternion = delta.multiply(q);
  }

  /** Dreht `knoten` um eine Weltachse (durch seinen Ursprung) um `winkel`. */
  private dreheUm(knoten: TransformNode, achseWelt: Vector3, winkel: number): void {
    const eltern = knoten.parent as TransformNode | null;
    const inv = eltern ? Matrix.Invert(eltern.getWorldMatrix()) : Matrix.Identity();
    const achse = Vector3.TransformNormal(achseWelt, inv).normalize();
    // Spiegelung (Determinante < 0) kehrt den Drehsinn um.
    const det = eltern ? eltern.getWorldMatrix().determinant() : 1;
    const delta = Quaternion.RotationAxis(achse, det < 0 ? -winkel : winkel);
    const q = knoten.rotationQuaternion ?? Quaternion.Identity();
    knoten.rotationQuaternion = delta.multiply(q);
  }

  dispose(): void {
    if (this.schichtBeobachter) {
      this.root.getScene().onAfterAnimationsObservable.remove(this.schichtBeobachter);
      this.schichtBeobachter = null;
    }
    this.root.dispose(false, true);
  }

  /** Vom Aufrufer gesetztes Aussehen, das auf das Modell wartet. */
  private offenesAussehen: Record<string, string | null> | null = null;
  /** sRGB-Hex der Haarfarbe; leer = so lassen, wie das Modell es liefert. */
  private haarHex = '';

  /**
   * Frisur und Ruestung anlegen — je Slot ein Teil, `null` raeumt ihn.
   *
   * Die Teile liegen als eigene Dateien neben dem Koerper
   * (assets/models/wikingerin/) und werden EINZELN geladen: Alle 21
   * Frisuren zusammen waeren 17,5 MB fuer eine, die man traegt.
   *
   * Jedes Teil bringt sein eigenes Skelett mit. Benutzt wird trotzdem
   * das des KOERPERS — sonst stuende die Frisur in der Bindepose,
   * waehrend der Koerper laeuft. Zulaessig ist das nur, weil alle
   * Teildateien dieselbe Gelenkliste tragen; tools/asset-aufteilen.py
   * erzeugt sie aus derselben Armatur und prueft das nach.
   */
  async setzeAussehen(teile: Record<string, string | null>): Promise<void> {
    // Frisuren und Ruestung sind Teildateien der Wikingerin (aussehen.ts)
    // und tragen DEREN Gelenkliste. An einer anderen Figur — dem Wikinger
    // aus dem Synty-Rig — saessen sie am falschen Knochen; dort wird das
    // Aussehen deshalb schlicht nicht angezogen.
    if (!this.modellDatei.startsWith(`${AUSSEHEN_ORDNER}/`)) return;
    if (!this.halter) {
      // Modell noch nicht da — merken und nach dem Laden nachziehen.
      this.offenesAussehen = { ...(this.offenesAussehen ?? {}), ...teile };
      return;
    }
    for (const [slot, datei] of Object.entries(teile)) {
      if (this.getragen.get(slot) === (datei ?? '')) continue;
      const vorher = this.getragen.get(slot);
      if (vorher) this.zeigeTeil(vorher, false);
      this.getragen.set(slot, datei ?? '');
      if (datei) await this.ladeTeil(datei);
    }
    // Nach dem Laden faerben, nicht davor: Eine gerade gewechselte
    // Frisur bringt ihr eigenes Material mit und waere sonst wieder
    // platzhalterbraun.
    this.faerbeFrisur();
  }

  /**
   * Haarfarbe setzen. Wirkt sofort auf die getragene Frisur und gilt
   * fuer jede spaeter geladene weiter — sonst muesste jeder Aufrufer
   * die Reihenfolge von Frisur und Farbe kennen.
   */
  setzeHaarfarbe(hex: string): void {
    this.haarHex = hex;
    this.faerbeFrisur();
  }

  private faerbeFrisur(): void {
    if (!this.haarHex) return;
    const datei = this.getragen.get('frisur');
    if (!datei) return;
    // Kein Klon: `ladeTeil` holt jedes Teil ueber `ImportMeshAsync`, und
    // das erzeugt je Aufruf eigene Materialien. Geteilt wird hier
    // nichts — anders als bei den Mitspielern (s. haarfarbe.ts).
    faerbeHaar(this.teile.get(datei) ?? [], this.haarHex, false);
  }

  private async ladeTeil(datei: string): Promise<void> {
    if (!this.teile.has(datei)) {
      try {
        const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');
        const res = await SceneLoader.ImportMeshAsync(
          '', '/assets/models/', `${datei}.glb`, this.halter!.getScene());
        const netze = res.meshes.filter((m) => m.getTotalVertices() > 0);
        // NUR die elternlosen Knoten umhaengen — genau wie beim Koerper
        // weiter oben. Der glTF-Import legt ueber die Netze einen
        // `__root__`-Knoten, der die Haendigkeit von glTF nach Babylon
        // umrechnet (gespiegelte Z-Achse). Haengt man die NETZE direkt an
        // den Halter, faellt dieser Knoten aus der Kette, und das Teil
        // sitzt gespiegelt auf dem Koerper — sichtbar als Kleidung, die
        // nicht am Rumpf liegt, waehrend die Vorschau (die nichts
        // umhaengt) richtig aussah.
        for (const m of res.meshes) if (!m.parent) m.parent = this.halter;
        for (const tn of res.transformNodes ?? []) if (!tn.parent) tn.parent = this.halter;
        for (const m of netze) {
          if (this.skelett) m.skeleton = this.skelett;
          m.isPickable = false;
          m.alphaIndex = 0;
        }
        // Das mitgelieferte Skelett bleibt ungenutzt liegen; freigeben
        // wuerde die Netze mitreissen, die auf seine Bindematrizen zeigen.
        this.teile.set(datei, netze);
      } catch (err) {
        console.warn(`[avatar] Teil "${datei}" nicht geladen`, err);
        this.teile.set(datei, []);
        return;
      }
    }
    this.zeigeTeil(datei, true);
  }

  private zeigeTeil(datei: string, sichtbar: boolean): void {
    for (const m of this.teile.get(datei) ?? []) m.setEnabled(sichtbar);
  }

}
