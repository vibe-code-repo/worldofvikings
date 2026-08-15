#!/usr/bin/env blender --background --python
"""
Riggt den Furloc-Fischer (kroetenartiges Fischervolk, Meshy-Modell) und
legt ihm drei Bewegungen an: "idle", "walk" und "attack".

    blender --background --python tools/furloc-rig.py -- \
        --glb assets/models/FurlocFischer.glb [--out ...] [--staerke 1.0]

── Warum wieder ein handgebautes Rig ────────────────────────────────
Dieselbe Lektion wie bei tools/voelva-rig.py und tools/surtr-rig.py, hier
noch einmal nachgemessen: Das Mesh zerfaellt in 3.225
ZUSAMMENHANGSKOMPONENTEN auf 16.296 Vertices — der Generator macht an
jeder UV-Naht auf. Blenders "Automatic Weights" (Bone Heat) braucht eine
zusammenhaengende Flaeche und raet sonst je Insel; genau dort klafft das
Modell dann auf.

Der Weg ist derselbe: eigene Knochenkette, Gewichte als STETIGE FUNKTION
DER POSITION. Stetig in der Position heisst, dass die an den Naehten
verdoppelten Vertices exakt aufeinanderliegen und deshalb identische
Gewichte bekommen — die 3.225 Inseln koennen prinzipbedingt nicht
auseinanderklaffen.

── Was dieses Rig anders macht als Surtrs ───────────────────────────
1. VIER GELENKE JE BEIN statt zwei. Surtrs Laufzyklus ist an genau dieser
   Stelle gescheitert (nachgemessen in tools/gang-diagnose.py: Fuss faehrt
   15 cm durch den Boden, Sohle kippt in der Standphase um 15 Grad,
   Standphase nur 22-28 % statt 60 %). Mit Huefte, Knie, KNOECHEL und
   ZEHENGELENK kann sich das Bein verkuerzen und die Sohle flach stehen
   bleiben.
2. Der Laufzyklus ist nicht aus Sinuskurven zusammengesetzt, sondern
   RUECKWAERTS AUS DER KINEMATIK gerechnet: Erst wird die Bahn der Sohle
   vorgegeben (flach am Boden, mit Koerpertempo nach hinten), dann loest
   eine Zweigelenk-IK Huefte und Knie dazu auf. Fussrutschen ist damit
   nicht "klein", sondern konstruktionsbedingt NULL.
3. Der Dreizack bekommt eine RICHTUNGSVORGABE statt eines Winkels
   (`setz_richtung`): Beim Zustechen wird die Schaftrichtung in
   Weltkoordinaten festgehalten, und der Stoss selbst ist eine reine
   VERSCHIEBUNG laengs dieser Richtung. Ein Stich, der seitlich
   ausschert, ist damit ausgeschlossen — nicht "unwahrscheinlich".

── Die Zahlen sind gemessen, nicht geschaetzt ───────────────────────
Alle Werte unten stammen aus einer FLAECHENTREUEN Abtastung des Meshes
(600.000 Punkte auf den Dreiecken, nicht die Vertices — Beine und Fuesse
sind sehr grob aufgeloest, eine Vertex-Scheibe misst dort Loecher).
Koordinaten im importierten Blender-Raum, Rohdatei, Z nach oben:

  Blickrichtung        -y  (Gesicht, Schnauze, Zehen)
  seine LINKE Seite    +x  (dort haengt der Reusenkorb)
  seine RECHTE Seite   -x  (dort steht der Dreizack)
  Fusssohle            z = -0,7554        Dreizack-Schaftende z = -0,7786
  Hutspitze            z = +0,677         Dreizack-Zinken     z = +0,7697
  Huefte               z = -0,470, x = +-0,20
  Knie                 z = -0,600, x = -0,270 / +0,285
  Knoechel             z = -0,700, x = -0,300 / +0,316, y = -0,020
  Ballen               z = -0,748, y = -0,130
  Zehenspitze          z = -0,752, y = -0,225   Ferse y = +0,105
  Schulter             z = +0,03,  x = +-0,34
  Faust am Dreizack    (-0,744 / -0,084 / -0,026)
  Schaftachse          Richtung (-0,154 / -0,062 / +0,986), Laenge 1,569
  Kehlsack (Vorwoelbung der Schnauzenunterseite) z 0,15..0,28, y bis -0,42
  Korb                 x 0,49..0,86, z -0,72..+0,10
  Ausgestreckter linker Arm  x 0,34..0,92 bei z ~ 0,0, y ~ -0,05

── Der Ursprung wird ins Modell gebacken ────────────────────────────
Die gelieferte Datei ist ZENTRIERT: Der Ursprung liegt 0,755 ueber der
Fusssohle. Der Prefab-Ursprung IST im Spiel die Gelaendehoehe — ohne
Korrektur steckte die Figur bis zur Brust im Boden. Der Versatz gehoert
deshalb ins Modell und nicht in eine Client-Konstante, die beim naechsten
Modellwechsel falsch waere. Das Skript misst die Sohle und hebt Mesh und
Skelett um genau diesen Betrag.

Der Dreizack ragt 0,023 UNTER die Sohle. Er wird deshalb in jeder Pose um
mindestens diesen Betrag am Schaft angehoben (Knochenverschiebung, der
Schaft rutscht in der Faust) — sonst waere der tiefste Punkt der Figur
nicht die Sohle, sondern das Schaftende, und die Fuesse schwebten.

── Was die Messung am fertigen Rig sagt ─────────────────────────────
Nachgemessen an der EVALUIERTEN Haut, nicht an den Knochen
(tools/gang-diagnose.py, --tempo 1.5 --scale 1.05, mit 240 fps
abgetastet — bei Blenders Vorgabe von 24 fps blieben von einem 0,267 s
langen Zyklus nur sieben Bilder, und die Standphasenerkennung verschmiert
dann Stand und Schwung):

  Schrittweite            0,211 Einheiten = 0,22 m je Fuss
  Standphase              63 % / 62 % des Zyklus   (echter Gang: ~60 %)
  Sohle flach aufliegend  62 % / 58 % der Bilder
  Fussrutschen, flache
    Standphase            unter 0,08 m/s          (Surtr: 1,1 / 3,4 m/s)
  Fusshoehe               -0,003 .. +0,094 und -0,005 .. +0,059
  Sohlenneigung im Stand  -10,5..+6,2 / -12,2..+6,1 Grad — das ist hier
                          das gewollte ABROLLEN (6 Grad Zehe hoch beim
                          Aufsetzen, 19 Grad runter beim Abstossen), nicht
                          ein mitkippender Fuss: Der Bodenpunkt bleibt
                          dabei nachweislich stehen.
  Tiefster Punkt der Haut idle -0,000 .. +0,003, walk -0,005, attack
                          -0,002 (0 = Gelaende). Ruhepose: +0,0002.
  Stich                   0,269 Einheiten = 0,28 m Weg, Abweichung von
                          der Schaftrichtung 0,00 Grad, Endhoehe der
                          Zinkenspitze 1,13 Einheiten = 1,19 m.

Die im Mittel gemeldeten 0,17-0,22 m/s Rutschen betreffen die Bilder, in
denen tools/gang-diagnose.py den ANHEBENDEN Fuss noch zur Standphase
zaehlt (Schwelle: Sohle hoechstens 1,2 cm ueber dem tiefsten Punkt). In
der flachen Standphase selbst liegt der Fehler bei 0,0002 Einheiten je
Bild.

── Das Tempo passt nicht zur Anatomie, die Schrittweite schon ──────
ROUTE_DEFAULT_SPEED ist 1,5 m/s. Der Furloc hat aber nur 0,30 m lange
Beine (Huefte 0,285 Einheiten ueber der Sohle, mal localScale 1,05). Sein
Schritt kann deshalb hoechstens 0,22 m lang sein — mehr gibt die
Beinlaenge nicht her, ohne dass der Fuss den Boden verliert. Aus
Schrittweite und Tempo folgt zwingend ein Zyklus von 0,267 s, also 7,5
Schritte je Sekunde. Das ist ein hektisches Watscheln; ein Mensch mit
dreimal so langen Beinen kaeme bei gleichem Tempo mit 2 Schritten aus.
Wer den Furloc gemaechlich gehen lassen will, setzt am Wegpunkt
`speed` (RouteDef.speed, erlaubt 0,2..10) auf etwa 0,8 m/s und ruft
dieses Skript mit `--tempo 0.8` erneut auf — die Zyklusdauer rechnet
sich dann selbst neu.

── Blickrichtung: gemessen, nicht beurteilt ─────────────────────────
Die Engine dreht eine laufende Figur mit yaw = atan2(dx, dz)
(shared/worldlayout/routenlauf.ts). Welche Blender-Achse das ist, wurde
NICHT hergeleitet, sondern an den beiden Modellen abgelesen, die im Spiel
nachweislich richtig herum laufen: Voelva.glb (nach ihren zwei
Fehlversuchen) und Surtr.glb (Winkel im laufenden Client gemessen,
tools/_surtr-blick.mjs). Beide zeigen in einer orthografischen Ansicht aus
-Y ihr GESICHT, blicken im importierten Blender-Raum also nach -Y.

Der Furloc tut das bereits von sich aus (dieselbe Ansicht, dieselbe
Kamerastellung — Kamera bei -Y, Eulerwinkel (90,0,0), Bild-Rechts = +x:
Gesicht zur Kamera). Zusaetzlich numerisch: Sein Fussgrundriss reicht von
y = -0,229 (Zehen) bis y = +0,105 (Ferse), ragt also 2,2-mal so weit nach
-y wie nach +y. BLICK_DREHUNG bleibt deshalb 0 — anders als bei Voelva und
Surtr, die beide -90 Grad brauchten.
"""

import math
import os
import sys

import bpy
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg('--glb')
OUT = arg('--out')
STAERKE = float(arg('--staerke', '1.0'))
DAUER_IDLE = float(arg('--idle-dauer', '4.0'))
DAUER_ATTACK = float(arg('--attack-dauer', '1.3'))
TEMPO = float(arg('--tempo', '1.5'))        # m/s, ROUTE_DEFAULT_SPEED
SKALA = float(arg('--scale', '1.05'))       # PrefabDef.localScale
FPS = 60
if not GLB:
    raise SystemExit('--glb fehlt')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFAD = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)
ZIEL = PFAD if not OUT else (OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT))


def glatt(u):
    """smoothstep 0..1"""
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


# ── Skelett ─────────────────────────────────────────────────────────
# (Name, Kopf, Spitze, Eltern, verbunden, Reichweite)
# Koordinaten in der ROHDATEI (Sohle bei z = -0,7554); das Skript hebt
# alles spaeter um ZHEB an. So stehen hier dieselben Zahlen wie im
# Messprotokoll oben.
#
# Die Beinknochen heissen bewusst "oberbein/unterbein/fuss/fusszehen":
# tools/gang-diagnose.py zaehlt die Gelenke je Bein ueber die Teilstrings
# "bein" und "fuss". Ein Knochen namens "schien" oder "zehe" faende es
# nicht und meldete zwei Gelenke, wo vier sind.
X0, Y0 = 0.010, -0.010          # Koerperachse
KNOCHEN = [
    ('wurzel', (X0, Y0, -0.470), (X0, Y0, -0.330), None, False, 0.60),
    ('bauch',  (X0, Y0, -0.330), (0.015, -0.015, -0.170), 'wurzel', True, 0.60),
    ('brust',  (0.015, -0.015, -0.170), (0.020, -0.020, 0.040), 'bauch', True, 0.60),
    ('kopf',   (0.020, -0.020, 0.040), (0.010, -0.060, 0.400), 'brust', True, 0.60),
    # Kehlsack: die Schnauzenunterseite woelbt sich zwischen z 0,15 und
    # 0,28 bis y = -0,42 vor, darunter zieht sich der Rumpf auf -0,34
    # zurueck. Genau diese Woelbung bekommt einen eigenen Knochen, der im
    # Leerlauf PULSIERT (Skalierung, nicht Drehung).
    ('kehle',  (0.020, -0.130, 0.235), (0.020, -0.330, 0.220), 'kopf', False, 0.16),

    # Rechter Arm (-x) — haelt den Dreizack. Der Unterarm ist ein Rohr von
    # 0,078 Radius, das waagerecht zum Schaft hinuebergreift.
    ('arm_r',  (-0.340, -0.010, 0.030), (-0.560, 0.000, -0.010), 'brust', False, 0.20),
    ('hand_r', (-0.560, 0.000, -0.010), (-0.710, -0.050, -0.022), 'arm_r', True, 0.20),
    # Dreizack: Kopf in der FAUST, Spitze an den Zinken. Die Drehung
    # pivotiert damit im Griff — sonst wandert der Schaft aus der Hand.
    ('dreizack', (-0.744, -0.084, -0.026), (-0.869, -0.134, 0.768), 'hand_r', False, 0.0),

    # Linker Arm (+x) — waagerecht ausgestreckt, ueber dem Reusenkorb.
    ('arm_l',  (0.340, -0.040, 0.035), (0.620, -0.060, 0.012), 'brust', False, 0.20),
    ('hand_l', (0.620, -0.060, 0.012), (0.900, -0.045, 0.000), 'arm_l', True, 0.20),

    # Beine: vier Gelenke je Seite. Huefte -> Knie -> Knoechel -> Ballen
    # -> Zehenspitze.
    #
    # Die Reichweite von Fuss und Zehen ist mit 0,24 groesser als die
    # Knochen lang sind (0,12 bzw. 0,10). Das ist Absicht: Der Fuss ist
    # 0,26 BREIT, seine Aussenecke liegt 0,14 neben der Knochenachse. Mit
    # einer Reichweite in Knochenlaenge fiel die vordere Aussenecke aus der
    # Zehenhuelle heraus, blieb beim Abrollen starr am Fuss haengen und
    # tauchte 3,2 cm unter den Boden (nachgemessen an der Haut).
    ('oberbein_r',  (-0.200, -0.010, -0.470), (-0.270, -0.010, -0.600), 'wurzel', False, 0.22),
    ('unterbein_r', (-0.270, -0.010, -0.600), (-0.300, -0.020, -0.700),
     'oberbein_r', True, 0.20),
    ('fuss_r',      (-0.300, -0.020, -0.700), (-0.300, -0.130, -0.748),
     'unterbein_r', True, 0.24),
    ('fusszehen_r', (-0.300, -0.130, -0.748), (-0.300, -0.225, -0.752), 'fuss_r', True, 0.24),
    ('oberbein_l',  (0.215, -0.010, -0.470), (0.285, -0.010, -0.600), 'wurzel', False, 0.22),
    ('unterbein_l', (0.285, -0.010, -0.600), (0.316, -0.020, -0.700),
     'oberbein_l', True, 0.20),
    ('fuss_l',      (0.316, -0.020, -0.700), (0.316, -0.130, -0.748), 'unterbein_l', True, 0.24),
    ('fusszehen_l', (0.316, -0.130, -0.748), (0.316, -0.225, -0.752), 'fuss_l', True, 0.24),
]

KETTE_ARM_R = ('arm_r', 'hand_r')
KETTE_ARM_L = ('arm_l', 'hand_l')
KETTE_BEIN_R = ('oberbein_r', 'unterbein_r', 'fuss_r', 'fusszehen_r')
KETTE_BEIN_L = ('oberbein_l', 'unterbein_l', 'fuss_l', 'fusszehen_l')
RUMPF = ('wurzel', 'bauch', 'brust', 'kopf')

# Gemessene Schaftachse des Dreizacks (Hauptachse der 676 Schaftpunkte)
SCHAFT_MITTE = Vector((-0.7821, -0.0995, 0.2151))
SCHAFT_ACHSE = Vector((-0.1542, -0.0617, 0.9861)).normalized()
SCHAFT_T = (-1.0082, 0.5608)     # Ausdehnung laengs der Achse

# Reusenkorb: gemessener Quader an seiner linken Huefte.
# Der Rand liegt bei 0,485: Der linke Fuss reicht bis x = 0,474, der
# Korbboden faengt bei 0,529 an. Griffe die Maske frueher, bekaeme die
# Aussenkante des Fusses Korbgewicht und saenke beim Auftreten in den Boden
# (nachgemessen: 35 % Bauch am Vertex bei x = 0,464, 3,7 cm Einsinken).
KORB_X = 0.530          # ab hier voll ...
KORB_X_RAND = 0.045     # ... ueber diese Strecke davor auf 0
KORB_Z_OBEN = 0.130

# ── Modell laden ────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

# Frueheres Rig restlos entfernen — sonst haengen zwei Skelette und alte
# Actions im Export. Die WELTLAGE des Meshes muss dabei erhalten bleiben.
# Zugleich die Frage, ob dieses Skript schon einmal ueber die Datei
# gelaufen ist: Dann traegt sie den Hoehenversatz bereits, und ein zweiter
# Lauf wuerde sie ein zweites Mal anheben. Erkennungsmerkmal ist der Name
# der Armature — den vergibt nur dieses Skript.
schon_gehoben = any(o.type == 'ARMATURE' and o.name.startswith('furloc_rig')
                    for o in bpy.data.objects)
mw = mesh.matrix_world.copy()
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(mesh.modifiers):
    if m.type == 'ARMATURE':
        mesh.modifiers.remove(m)
mesh.parent = None
mesh.matrix_world = mw
mesh.vertex_groups.clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
zmin = min(v.z for v in welt)
zmax = max(v.z for v in welt)

# ── Wie hoch steht der Ursprung ueber der Sohle? ────────────────────
# Gemessen wird die Sohle des KOERPERS, nicht der tiefste Punkt der Datei:
# Der tiefste Punkt ist das Schaftende des Dreizacks, und der gehoert nicht
# auf den Boden gestellt, sondern in die Hand. Der Dreizack wird ueber
# seine x-Lage abgetrennt (Schaft und Faust liegen bei x < -0,52, der
# linke Fuss endet bei x = -0,446).
koerper = [v for v in welt if v.x > -0.52]
SOHLE = min(v.z for v in koerper)
ZOFF = 0.0 if schon_gehoben else -SOHLE
# Die Knochentabelle ist in den Koordinaten der ROHDATEI geschrieben, deren
# Sohle bei -0,7554 lag. Umgerechnet wird deshalb IMMER gegen diesen Wert
# und nie gegen ZOFF: Laeuft das Skript ein zweites Mal ueber eine schon
# gehobene Datei, ist ZOFF null — die Knochen muessen trotzdem an dieselbe
# Stelle. (Beim ersten Versuch fehlte diese Unterscheidung, und der zweite
# Lauf setzte das ganze Skelett 0,755 unter die Figur.)
SOHLE_TABELLE = -0.7554
ZHEB = -SOHLE_TABELLE
if abs(SOHLE - (SOHLE_TABELLE if not schon_gehoben else 0.0)) > 0.01:
    print(f'WARNUNG: gemessene Sohle {SOHLE:+.4f} weicht von der Tabelle ab — '
          f'stammt die GLB noch aus derselben Quelle?')
# Wie weit steht das Schaftende UNTER der Sohle? Genau so weit muss der
# Dreizack in jeder Pose am Schaft hochrutschen.
SCHAFT_UNTER_SOHLE = SOHLE - zmin
print(f'MODELL {mesh.name}: {len(welt)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, '
      f'Hoehe {zmax - zmin:.4f}')
print(f'SOHLE: Koerper z={SOHLE:.4f}, tiefster Punkt (Schaftende) z={zmin:.4f} '
      f'-> Hoehenversatz {ZOFF:+.4f}, Schaft steht {SCHAFT_UNTER_SOHLE:.4f} tiefer')
if schon_gehoben:
    print('HINWEIS: Datei traegt schon ein furloc_rig — nicht erneut angehoben')

# Mesh auf die Sohle stellen. Ab hier ist z = 0 der Boden; alle
# Knochenkoordinaten aus der Tabelle bekommen ZHEB aufgeschlagen.
mesh.location.z += ZOFF
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
mesh.select_set(False)
welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]


def hoch(p):
    """Punkt aus der Messtabelle in den angehobenen Raum."""
    return Vector((p[0], p[1], p[2] + ZHEB))


# ── Armature ────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new('furloc_rig')
arm = bpy.data.objects.new('furloc_rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, kopf, spitze, eltern, verbunden, _r in KNOCHEN:
    b = arm_data.edit_bones.new(name)
    b.head = hoch(kopf)
    b.tail = hoch(spitze)
    if eltern:
        b.parent = arm_data.edit_bones[eltern]
        b.use_connect = bool(verbunden)
bpy.ops.object.mode_set(mode='OBJECT')

SEGMENTE = {n: (hoch(k), hoch(s)) for n, k, s, *_ in KNOCHEN}
REICHWEITE = {n: r for n, _k, _s, _e, _v, r in KNOCHEN}
ALLE = [n for n, *_ in KNOCHEN]
ELTERN = {n: e for n, _k, _s, e, _v, _r in KNOCHEN}


# ── Gewichte ────────────────────────────────────────────────────────
# Der Furloc ist ein FASS: Der Rumpf misst 0,95 in der Breite und 0,85 in
# der Tiefe bei 1,43 Hoehe. Eine reine Abstandshuelle um die Rumpfkette
# taugt dafuer nicht — die Huelle mueste weiter reichen als der halbe
# Koerper, und dann zoege die Schulter die Bauchflanke und der Hut den
# Arm. Deshalb drei getrennte Zustaendigkeiten, alle stetig im ORT:
#
#   1. MASKEN fuer die drei Anbauteile (Dreizack, Reusenkorb, sie liegen
#      raeumlich getrennt vom Koerper und duerfen nichts vom Nachbarn
#      abbekommen).
#   2. GLIEDMASSEN: je Kette ein Naehe-Mass. Innerhalb der Kette
#      entscheidet die uebliche Huelle, welcher Knochen zieht.
#   3. RUMPF: was uebrig bleibt, wird allein ueber die HOEHE verteilt.
#      Ein Fass hat keine Taille, an der man den Abstand messen koennte;
#      die Hoehe ist das einzige verlaessliche Mass. Hut, Ruestung und
#      Reusenkorb bleiben so am Rumpf, statt an den Gliedmassen zu haengen.
#
# Alle drei haengen ausschliesslich von der POSITION ab. Die 3.225
# UV-Inseln koennen deshalb prinzipbedingt nicht auseinanderklaffen.
gruppen = {n: mesh.vertex_groups.new(name=n) for n in ALLE}

SCHAFT_A = SCHAFT_MITTE + SCHAFT_ACHSE * SCHAFT_T[0] + Vector((0, 0, ZHEB))
SCHAFT_B = SCHAFT_MITTE + SCHAFT_ACHSE * SCHAFT_T[1] + Vector((0, 0, ZHEB))


def kette_naehe(p, kette, innen, aussen):
    """1 innerhalb `innen` um die Kette, 0 ab `aussen`, weich dazwischen."""
    d = min(abstand_segment(p, *SEGMENTE[n]) for n in kette)
    return 1.0 - glatt((d - innen) / (aussen - innen))


def dreizack_maske(p):
    """1 im Dreizack, 0 daneben.

    Der Radius folgt dem GEMESSENEN Querschnitt laengs der Schaftachse:
    unten ein glatter Schaft (r_95 = 0,045), oben die Zinken samt Bindung
    (r_95 bis 0,156). Weit genug muss er oben sein, weil der Rumpf dort
    keine Konkurrenz hat — ohne Maske faenden die Zinken auf Hutkroenchen-
    hoehe den KOPF als naechsten Knochen und flatterten beim Umsehen mit.

    Die Faust wird ausdruecklich AUSGENOMMEN: Sie gehoert an die Hand,
    nicht an den Schaft, sonst kippte sie beim Zustechen mit der Waffe um
    90 Grad. Der kurze Schaftabschnitt, der dabei mit ausgenommen wird,
    liegt im Drehpunkt des Dreizacks — dort bewegen Hand und Schaft sich
    ohnehin gleich."""
    t = (p - (SCHAFT_MITTE + Vector((0, 0, ZHEB)))).dot(SCHAFT_ACHSE)
    if not (SCHAFT_T[0] - 0.05 <= t <= SCHAFT_T[1] + 0.05):
        return 0.0
    d = abstand_segment(p, SCHAFT_A, SCHAFT_B)
    voll = 0.055 + 0.115 * glatt((t - 0.02) / 0.24)
    null = voll * 1.30 + 0.012
    m = 1.0 - glatt((d - voll) / (null - voll))
    return m * (1.0 - kette_naehe(p, ('hand_r', 'arm_r'), 0.085, 0.145))


def korb_maske(p):
    """1 im Reusenkorb, 0 daneben.

    Der Korb haengt zwischen x = 0,49 und 0,86 und reicht von z = -0,72
    bis +0,10 herab. Ohne Maske faende sein unteres Drittel das LINKE BEIN
    als naechsten Knochen (0,3 entfernt, der Rumpf 0,6) und schwaenge im
    Schritttakt mit. Er haengt aber an einem Riemen ueber der Schulter,
    also an der Huefte.

    Der ausgestreckte linke Arm laeuft mitten durch dasselbe Fenster und
    wird deshalb ausgenommen — sonst waere er festgenagelt."""
    if p.x < KORB_X - KORB_X_RAND or p.z > KORB_Z_OBEN + 0.06:
        return 0.0
    seit = glatt((p.x - (KORB_X - KORB_X_RAND)) / KORB_X_RAND)
    oben = 1.0 - glatt((p.z - KORB_Z_OBEN) / 0.06)
    return seit * oben * (1.0 - kette_naehe(p, KETTE_ARM_L, 0.085, 0.145))


def rumpf_hoehe(z):
    """Rumpfgewichte allein aus der Hoehe — stetig, ohne Abstandsmass."""
    t1 = glatt((z - (-0.440)) / 0.150)      # wurzel -> bauch
    t2 = glatt((z - (-0.260)) / 0.190)      # bauch  -> brust
    t3 = glatt((z - 0.080) / 0.190)         # brust  -> kopf
    return {'wurzel': 1 - t1, 'bauch': t1 * (1 - t2),
            'brust': t2 * (1 - t3), 'kopf': t3}


def huelle(p, kette):
    """Verteilung innerhalb einer Kette: kompakter Kern je Segment."""
    roh = []
    for n in kette:
        d = abstand_segment(p, *SEGMENTE[n])
        u = d / REICHWEITE[n]
        if u >= 1.0:
            continue
        roh.append((n, (1.0 - u) ** 3 / (u * u + 0.02)))
    if not roh:
        n = min(kette, key=lambda k: abstand_segment(p, *SEGMENTE[k]))
        roh = [(n, 1.0)]
    s = sum(w for _n, w in roh)
    return {n: w / s for n, w in roh}


def gewichte(p):
    w = {}
    m_dz = dreizack_maske(p)
    m_kb = korb_maske(p) * (1.0 - m_dz)
    if m_dz > 0.0:
        w['dreizack'] = m_dz
    if m_kb > 0.0:
        w['bauch'] = w.get('bauch', 0.0) + m_kb
    rest = max(0.0, 1.0 - m_dz - m_kb)
    if rest <= 1e-4:
        return w

    # Gliedmassen. Der Deckel ueber z verhindert, dass die Arme in die
    # Hutkrempe greifen (sie liegt 0,2 ueber der Schulter und waere sonst
    # in Reichweite) und die Beine in den Rocksaum.
    arm_deckel = 1.0 - glatt((p.z - (0.120 + ZHEB)) / 0.120)
    bein_deckel = 1.0 - glatt((p.z - (-0.440 + ZHEB)) / 0.100)
    # Unter dem Knoechel greift das Bein WEITER. Der Fuss ist 0,26 breit
    # und spreizt nach aussen; seine Aussenkante liegt 0,159 vom
    # Fussknochen entfernt und faende sonst zu einem Drittel den Rumpf —
    # eine Fussecke, die beim Auftreten stehen bleibt, waehrend der Rest
    # des Fusses geht.
    unter_knoechel = 1.0 - glatt((p.z - (-0.700 + ZHEB)) / 0.055)
    bein_innen = 0.120 + 0.115 * unter_knoechel
    bein_aussen = 0.215 + 0.115 * unter_knoechel
    anteile = [
        (KETTE_ARM_R, kette_naehe(p, KETTE_ARM_R, 0.100, 0.210) * arm_deckel),
        (KETTE_ARM_L, kette_naehe(p, KETTE_ARM_L, 0.100, 0.210) * arm_deckel),
        (KETTE_BEIN_R, kette_naehe(p, KETTE_BEIN_R, bein_innen, bein_aussen) * bein_deckel),
        (KETTE_BEIN_L, kette_naehe(p, KETTE_BEIN_L, bein_innen, bein_aussen) * bein_deckel),
    ]
    summe = sum(a for _k, a in anteile)
    if summe > 1.0:
        anteile = [(k, a / summe) for k, a in anteile]
        summe = 1.0
    for kette, a in anteile:
        if a <= 1e-4:
            continue
        teil = huelle(p, kette)
        if kette in (KETTE_BEIN_R, KETTE_BEIN_L):
            # Unterhalb des Knoechels gehoert ALLES dem Fuss.
            #
            # Ohne diese Regel bekam die FERSE 77 % Unterschenkel und nur
            # 14 % Fuss (nachgemessen): Sie liegt hinter dem Knoechel, der
            # Fussknochen zeigt aber nach vorn — beide Knochen sind damit
            # gleich weit weg, und der laengere Unterschenkel mit seiner
            # groesseren Reichweite gewinnt. Die Folge war eine Ferse, die
            # beim Fersenauftritt 3 cm in den Boden sank, obwohl der
            # Knoechel richtig stand.
            f = unter_knoechel
            if f > 1e-4:
                nur_fuss = huelle(p, kette[2:])
                teil = {n: (1 - f) * teil.get(n, 0.0) + f * nur_fuss.get(n, 0.0)
                        for n in set(teil) | set(nur_fuss)}
        for n, x in teil.items():
            w[n] = w.get(n, 0.0) + rest * a * x

    # Rumpf und Kehlsack teilen sich den Rest.
    kern = rest * (1.0 - summe)
    if kern > 1e-4:
        rh = rumpf_hoehe(p.z - ZHEB)
        kehle = 0.85 * (1.0 - glatt(
            (abstand_segment(p, *SEGMENTE['kehle']) - 0.070) / 0.090))
        for n, x in rh.items():
            if n == 'kopf' and kehle > 0.0:
                w['kehle'] = w.get('kehle', 0.0) + kern * x * kehle
                x *= (1.0 - kehle)
            w[n] = w.get(n, 0.0) + kern * x
    return w


zaehler = {'dreizack': 0, 'korb': 0}
for i, p in enumerate(welt):
    if dreizack_maske(p) > 0.9:
        zaehler['dreizack'] += 1
    if korb_maske(p) > 0.9:
        zaehler['korb'] += 1
    w = gewichte(p)
    # glTF haelt nur 4 Joints je Vertex — die schwaechsten fallen weg, der
    # Rest wird nachnormiert.
    roh = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
    s = sum(x for _n, x in roh) or 1.0
    for n, x in roh:
        gruppen[n].add([i], x / s, 'REPLACE')

print(f'GEWICHTE: {zaehler["dreizack"]} Vertices voll am Dreizack, '
      f'{zaehler["korb"]} voll am Reusenkorb, Rest ueber Gliedmassen-Naehe '
      f'und Rumpfhoehe')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mesh.parent = arm


# ── Posieren: Drehungen um WELTACHSEN ───────────────────────────────
# bone.matrix_local bildet Knochenraum -> Armature-Raum ab; die Armature
# steht auf dem Ursprung, Armature-Raum ist also Weltraum. Damit laesst
# sich eine Weltdrehung sauber in den lokalen Raum eines Knochens holen —
# ohne Raterei ueber Bone-Rolls.
#
# Der Furloc blickt nach -y. Die Achsen heissen deshalb anders herum als
# bei Surtr (der schaut vor der Blickdrehung nach +x):
HOCH = Vector((0, 0, 1))       # Gierachse: umsehen, Schultern gegen Huefte
QUER = Vector((1, 0, 0))       # Seitenachse. +Grad kippt +z nach -y, also
#                                nach VORN; ein nach unten zeigender
#                                Beinknochen schwingt damit nach HINTEN.
VOR = Vector((0, -1, 0))       # Blickachse: seitliches Wiegen

# Weltdrehung je Knochen in der gerade gebauten Pose. Wird gebraucht, um
# dem Dreizack eine RICHTUNG statt eines Winkels vorgeben zu koennen: seine
# Weltlage ist das Produkt der Drehungen der ganzen Kette.
WELTDREHUNG = {}


def _welt_zu_knochen(pb, qwelt):
    m = pb.bone.matrix_local.to_3x3()
    return (m.inverted() @ qwelt.to_matrix() @ m).to_quaternion()


def setz(name, *drehungen):
    """Setzt einen Knochen ueber Drehungen um WELTACHSEN."""
    ges = Quaternion()
    for achse, grad in drehungen:
        ges = ges @ Quaternion(achse.normalized(), math.radians(grad * STAERKE))
    WELTDREHUNG[name] = ges
    arm.pose.bones[name].rotation_quaternion = _welt_zu_knochen(
        arm.pose.bones[name], ges)


def kettendrehung(name):
    """Weltdrehung der ELTERNKETTE ueber `name` (Wurzel zuerst)."""
    kette = []
    e = ELTERN[name]
    while e:
        kette.append(e)
        e = ELTERN[e]
    q = Quaternion()
    for n in reversed(kette):
        q = q @ WELTDREHUNG.get(n, Quaternion())
    return q


def setz_richtung(name, ziel):
    """Dreht einen Knochen so, dass er in WELTKOORDINATEN nach `ziel` zeigt.

    Fuer den Dreizack ist das der entscheidende Unterschied zu einem
    Winkel: Beim Zustechen muss die SCHAFTRICHTUNG feststehen, egal was
    Rumpf, Schulter und Handgelenk gerade tun. Wer stattdessen Winkel
    stapelt, bekommt eine Richtung, die von fuenf Gelenken abhaengt — und
    genau dann schert der Stich seitlich aus."""
    kopf, spitze = SEGMENTE[name]
    ruhe = (spitze - kopf).normalized()
    eltern = kettendrehung(name)
    welt = eltern.inverted() @ ruhe.rotation_difference(Vector(ziel).normalized())
    WELTDREHUNG[name] = welt
    arm.pose.bones[name].rotation_quaternion = _welt_zu_knochen(
        arm.pose.bones[name], welt)


def versatz(pb, vek):
    return pb.bone.matrix_local.to_3x3().inverted() @ Vector(vek)


def schiebe(name, vek):
    """Verschiebt einen Knochen um `vek` in WELTKOORDINATEN.

    Die Drehung der Elternkette wird herausgerechnet. Fuer den Stoss ist
    das wesentlich: Wenn Rumpf und Schulter schon gedreht sind, laege eine
    im Knochenraum gemessene Verschiebung nicht mehr in Schaftrichtung —
    und genau das waere der seitlich ausscherende Stich. Voraussetzung ist,
    dass die Eltern in derselben Pose VORHER gesetzt wurden."""
    pb = arm.pose.bones[name]
    lokal = kettendrehung(name).inverted() @ (Vector(vek) * STAERKE)
    pb.location = versatz(pb, lokal)


bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

szene = bpy.context.scene
szene.render.fps = FPS


def aktion(name, dauer, pose_fn, schleife=True):
    """Backt eine Aktion.

    Bei `schleife` ist der letzte Frame die Kopie des ersten und die Phase
    laeuft von 0 bis 1 ueber `frames` Schritte — dann schliesst der Zyklus
    im Client ohne Sprung. Sonst laeuft die Phase ueber die volle Laenge.

    Geschluesselt werden Drehung UND Verschiebung ALLER Knochen sowie die
    Skalierung des Kehlsacks. Die Verschiebung braucht nicht nur die
    Wurzel: Die Beine bekommen ihre Laenge aus der IK und der Dreizack
    rutscht am Schaft hoch."""
    frames = int(round(dauer * FPS))
    arm.animation_data_create()
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    arm.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = frames + 1
    for f in range(1, frames + 2):
        phase = ((f - 1) % frames) / frames if schleife else (f - 1) / frames
        szene.frame_set(f)
        WELTDREHUNG.clear()
        for pb in arm.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0.0, 0.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)
        pose_fn(phase)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
        arm.pose.bones['kehle'].keyframe_insert('scale', frame=f)
    for fc in akt.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    akt.name = name
    print(f'AKTION {name}: {frames + 1} Frames ({dauer:.3f} s bei {FPS} fps), '
          f'{len(akt.fcurves)} F-Kurven')
    return akt


# ── Beinkinematik ───────────────────────────────────────────────────
# Alles hier ist AM MODELL GEMESSEN (siehe Kopf). Die Laengen sind die
# Projektionen in die Schrittebene (y,z); der seitliche Versatz der Beine
# (die Fuesse stehen 0,3 auseinander) bleibt starr und stoert die Rechnung
# nicht.
OBER = 0.130            # Huefte -> Knie
UNTER = 0.1005          # Knie -> Knoechel
HUEFT_UEBER_KNOECHEL = 0.230
KNOECHEL_UEBER_BODEN = -0.700 + 0.7554     # 0,0554
Y_KNOECHEL_RUHE = -0.010                   # Knoechel-y gegen die Huefte
# Sohlenpunkte im Fussraum, gemessen vom Knoechel aus. Die z-Werte sind
# ausdruecklich die der SOHLENHAUT (0,0554 unter dem Knoechel), nicht die
# der Knochenspitzen: Beim Abrollen dreht der Fuss um den Punkt, der den
# Boden beruehrt, und das ist die Haut. Vier Millimeter Unterschied sind
# hier ein Viertel der ganzen Bodenfreiheit.
FERSE_LOK = (0.125, -0.0554)               # Knoechel -> Ferse   (y, z)
BALLEN_LOK = (-0.110, -0.0554)             # Knoechel -> Ballen  (y, z)


def bein_ik(dy, dz, hub):
    """Loest Huefte und Knie zu einem Knoechelort auf.

    dy/dz: Versatz des Knoechels gegen die Ruhelage.
    hub:   Versatz der HUEFTE (Beckensenkung, negativ = tiefer).
    Rueckgabe: (Oberschenkelwinkel, Kniebeugung, Schienbeinwinkel) in Grad,
    jeweils gegen die Senkrechte, + = nach HINTEN.

    Es wird ausdruecklich der Ast mit dem Knie NACH VORN genommen
    (theta = phi - alpha). Die Ruhelage des Modells liegt mit 0,006
    Knieversatz haarscharf auf dem anderen Ast; einmal falsch gewaehlt,
    knickt das Bein beim ersten Schritt nach hinten durch."""
    Y = Y_KNOECHEL_RUHE + dy
    Z = HUEFT_UEBER_KNOECHEL + hub - dz
    L = min(math.hypot(Y, Z), (OBER + UNTER) * 0.998)
    L = max(L, abs(OBER - UNTER) + 1e-4)
    phi = math.atan2(Y, Z)
    ca = (OBER * OBER + L * L - UNTER * UNTER) / (2 * OBER * L)
    cb = (UNTER * UNTER + L * L - OBER * OBER) / (2 * UNTER * L)
    alpha = math.acos(max(-1.0, min(1.0, ca)))
    beta = math.acos(max(-1.0, min(1.0, cb)))
    ober = phi - alpha
    schien = phi + beta
    return math.degrees(ober), math.degrees(schien - ober), math.degrees(schien)


# Die RUHEWINKEL des Modells, aus der Knochentabelle gerechnet: Der
# Oberschenkel haengt senkrecht (0 Grad), das Schienbein steht 5,7 Grad
# nach vorn.
#
# Sie sind NICHT dasselbe wie die Loesung der IK fuer die Ruhelage
# (-5,67 / +1,62 Grad): Das Modell steht mit haarscharf nach HINTEN
# durchgedruecktem Knie, die IK waehlt den Ast mit dem Knie nach vorn.
# Wer die Gelenkwinkel gegen die IK-Ruhelage verrechnet statt gegen die
# MODELL-Ruhelage, verschiebt jedes Bein um diese Differenz — gemessen
# stand die Sohle dann 2,5 cm unter dem Boden, obwohl die IK stimmte.
def _modellwinkel(kopf, spitze):
    return math.degrees(math.atan2(spitze[1] - kopf[1], kopf[2] - spitze[2]))


_kn = {n: (k, s) for n, k, s, *_ in KNOCHEN}
OBER_MODELL = _modellwinkel(*_kn['oberbein_r'])
SCHIEN_MODELL = _modellwinkel(*_kn['unterbein_r'])
KNIE_MODELL = SCHIEN_MODELL - OBER_MODELL
print(f'BEIN: Modell-Ruhewinkel Oberschenkel {OBER_MODELL:+.2f}, '
      f'Schienbein {SCHIEN_MODELL:+.2f} Grad; IK-Ruheloesung '
      f'{bein_ik(0.0, 0.0, 0.0)[0]:+.2f} / {bein_ik(0.0, 0.0, 0.0)[2]:+.2f} Grad')


def pivot_versatz(lok, grad):
    """Wohin muss der Knoechel, damit `lok` beim Neigen liegen bleibt?

    Beim Fersenauftritt dreht der Fuss um die FERSE, beim Abstossen um den
    BALLEN. In beiden Faellen steht der Drehpunkt still und der Knoechel
    wandert — genau dieser Versatz macht den Unterschied zwischen einer
    Sohle, die abrollt, und einer, die ueber den Boden schleift."""
    r = math.radians(grad)
    s, c = math.sin(r), math.cos(r)
    y2 = lok[0] * c - lok[1] * s
    z2 = lok[0] * s + lok[1] * c
    return lok[0] - y2, lok[1] - z2


# ── Laufzyklus: erst die Sohle, dann das Bein ───────────────────────
# Standphasenanteil und Fusswinkel sind Gestaltung, die SCHRITTWEITE ist
# es nicht. Sie folgt aus der Beinlaenge: Der Knoechel kann sich hoechstens
# so weit von der Huefte entfernen, wie das gestreckte Bein lang ist
# (0,2305). Bei 0,11 waagerechtem Ausschlag sind das 28,6 Grad Hueftwinkel,
# und das Becken muss dafuer um 0,028 absacken. Mehr gibt die Anatomie
# nicht her.
STAND = 0.58            # Anteil der Standphase am Zyklus
FERSE_ANT = 0.10        # Anteil der Standphase mit Fersendrehung
BALLEN_ANT = 0.78       # ab hier rollt der Fuss ueber den Ballen ab
NEIG_FERSE = 6.0        # Grad Zehe HOCH beim Aufsetzen
NEIG_BALLEN = 19.0      # Grad Zehe RUNTER beim Abstossen
SCHWUNG_HUB = 0.070     # wie hoch der Knoechel im Schwung steigt

# Der Sollweg der Sohle je Standphase. Aus ihm folgt die Zyklusdauer, denn
# eine stehende Sohle MUSS sich im Koerperraum genau so schnell nach hinten
# bewegen, wie der Server die Figur nach vorn schiebt:
#     Sohlenweg / (Standanteil * Zyklusdauer) = TEMPO / SKALA
# Die Rundung auf ganze Bilder wird in die Schrittweite zurueckgerechnet,
# damit auch nach der Rundung KEIN Rest bleibt.
SCHRITT_WUNSCH = 0.220
_v = TEMPO / SKALA                       # Modelleinheiten je Sekunde
DAUER_WALK = SCHRITT_WUNSCH / (STAND * _v)
FRAMES_WALK = max(4, int(round(DAUER_WALK * FPS)))
DAUER_WALK = FRAMES_WALK / FPS
SCHRITT = STAND * _v * DAUER_WALK
print(f'GANG: Tempo {TEMPO} m/s bei localScale {SKALA} = {_v:.4f} Einheiten/s. '
      f'Sohlenweg je Standphase {SCHRITT:.4f} Einheiten ({SCHRITT*SKALA:.3f} m), '
      f'Standanteil {STAND:.2f} -> Zyklus {DAUER_WALK:.4f} s ({FRAMES_WALK} Bilder), '
      f'{2/DAUER_WALK:.2f} Schritte/s')

_DY_AB, _DZ_AB = pivot_versatz(BALLEN_LOK, NEIG_BALLEN)
_DY_AUF, _DZ_AUF = pivot_versatz(FERSE_LOK, -NEIG_FERSE)
STAND_ENDE = (SCHRITT / 2 + _DY_AB, _DZ_AB, NEIG_BALLEN, -NEIG_BALLEN)
STAND_ANFANG = (-SCHRITT / 2 + _DY_AUF, _DZ_AUF, -NEIG_FERSE, 0.0)


def fuss_bahn(tau):
    """Knoechelversatz, Sohlenneigung, Zehenwinkel und Standflagge.

    Standphase: Der BODENPUNKT (Ferse, dann ganze Sohle, dann Ballen)
    wandert streng linear mit `SCHRITT` je Standphase nach hinten — genau
    mit Koerpertempo. Das ist die Bedingung fuer null Rutschen, und sie ist
    hier nicht angenaehert, sondern eingebaut.

    Schwungphase: Der Fuss wird angehoben und nach vorn gefuehrt; Anfangs-
    und Endwerte sind ausdruecklich die der Standphase, damit der Zyklus
    ohne Knick schliesst."""
    if tau < STAND:
        u = tau / STAND
        dy = -SCHRITT / 2 + SCHRITT * u
        dz = 0.0
        neig = 0.0
        zeh = 0.0
        if u < FERSE_ANT:
            neig = -NEIG_FERSE * (1.0 - u / FERSE_ANT)
            vy, vz = pivot_versatz(FERSE_LOK, neig)
            dy += vy
            dz += vz
        elif u > BALLEN_ANT:
            neig = NEIG_BALLEN * glatt((u - BALLEN_ANT) / (1.0 - BALLEN_ANT))
            vy, vz = pivot_versatz(BALLEN_LOK, neig)
            dy += vy
            dz += vz
            # Die Zehen bleiben flach am Boden liegen, waehrend die Ferse
            # steigt. Ohne dieses Gelenk bohrte sich die Zehenspitze beim
            # Abstossen 3,8 cm in den Boden (nachgerechnet).
            zeh = -neig
        return dy, dz, neig, zeh, 1.0

    v = (tau - STAND) / (1.0 - STAND)
    w = glatt(v)
    dy = STAND_ENDE[0] + (STAND_ANFANG[0] - STAND_ENDE[0]) * w
    dz = (STAND_ENDE[1] + (STAND_ANFANG[1] - STAND_ENDE[1]) * w
          + SCHWUNG_HUB * math.sin(math.pi * v) ** 0.9)
    neig = STAND_ENDE[2] + (STAND_ANFANG[2] - STAND_ENDE[2]) * glatt((v - 0.05) / 0.55)
    zeh = STAND_ENDE[3] * (1.0 - glatt(v / 0.35))
    return dy, dz, neig, zeh, 0.0


def beckenhub(tau_r, tau_l):
    """Wie tief muss das Becken, damit das Standbein den Boden erreicht?

    Das Bein ist in der Ruhelage praktisch gestreckt (0,2302 von 0,2305).
    Es kann also nicht laenger werden — schwingt es aus, MUSS das Becken
    sinken. Genau das ist der Kompassgang: hoch in der Einzelstuetze, tief
    in der Doppelstuetze. Die Rechnung nimmt je Bild das TIEFERE der
    beiden Standbeine."""
    huebe = []
    for tau in (tau_r, tau_l):
        if tau % 1.0 < STAND:
            dy, dz, _n, _t, _s = fuss_bahn(tau % 1.0)
            Y = Y_KNOECHEL_RUHE + dy
            rest = (OBER + UNTER) ** 2 * 0.996 - Y * Y
            huebe.append(math.sqrt(max(1e-6, rest)) + dz - HUEFT_UEBER_KNOECHEL)
    return min(huebe) if huebe else 0.0


def bein_setzen(seite, dy, dz, neig, zeh, hub_seite,
                rumpf_quer=0.0, rumpf_vor=0.0, rumpf_gier=0.0):
    """Traegt eine Knoechelvorgabe in die vier Gelenke ein.

    `rumpf_quer` und `rumpf_vor` sind die Drehungen, die die WURZEL in
    dieser Pose schon mitbringt. Sie werden herausgerechnet, denn die IK
    rechnet mit einer aufrechten Huefte: Neigt sich das Becken um vier
    Grad nach vorn, wandert der Knoechel sonst 1,6 cm mit, und beim
    seitlichen Wiegen kippt die Sohle mit dem Becken — bei 0,11 halber
    Fussbreite reicht das, um die Aussenkante 8 mm einzugraben.

    `rumpf_gier` ebenso: Die Hueftpfannen sitzen 0,21 neben der
    Koerperachse: Dreht sich das Becken um 4,5 Grad, wandert jede Pfanne
    1,6 cm in Laufrichtung. Ohne Korrektur schob das den Standfuss im
    Schritttakt vor und zurueck — gemessen 30 % Geschwindigkeitsfehler
    mitten in der Standphase, obwohl die Fussbahn selbst stimmte."""
    x_rel = SEGMENTE[f'oberbein_{seite}'][0].x - SEGMENTE['wurzel'][0].x
    dy = dy - x_rel * math.sin(math.radians(rumpf_gier))
    ober, knie, schien = bein_ik(dy, dz, hub_seite)
    setz(f'oberbein_{seite}', (QUER, ober - OBER_MODELL - rumpf_quer), (VOR, -rumpf_vor))
    setz(f'unterbein_{seite}', (QUER, knie - KNIE_MODELL))
    # Der Fuss bekommt die Drehung der Kette abgezogen: Was uebrig bleibt,
    # ist genau die SOHLENNEIGUNG in der Welt. Ohne diese Verrechnung
    # kippte die Sohle mit dem Unterschenkel mit — der Fehler, den
    # tools/gang-diagnose.py an Surtr mit 15 Grad Sohlendrehung gemessen
    # hat.
    setz(f'fuss_{seite}', (QUER, neig - (schien - SCHIEN_MODELL)))
    setz(f'fusszehen_{seite}', (QUER, zeh))


# ── Der Dreizack steht auf dem Boden, aber nie darunter ─────────────
# Sein Schaftende liegt 0,023 unter der Sohle. In der Ruhe wird er um
# genau diesen Betrag plus etwas Luft angehoben — dann ist der tiefste
# Punkt der Figur die SOHLE und nicht das Schaftende. Beim Gehen wird er
# hoeher getragen: Ein Schaft, der auf Bodenhoehe mitwandert, pfluegt sonst
# durchs Gelaende.
# Die Zugabe ist NACHGEMESSEN, nicht geschaetzt: Auch ein ruhiger Arm
# bewegt den Griff im Leerlauf um rund einen Zentimeter, und der Schaft
# steht 0,78 darunter. Mit nur 5 mm Luft tauchte das Schaftende in der
# ersten Fassung 2,3 cm unter den Boden (gemessen an der evaluierten Haut).
DREIZACK_RUHE = SCHAFT_UNTER_SOHLE + 0.055
DREIZACK_GANG = SCHAFT_UNTER_SOHLE + 0.130
SCHAFT_LAENGE = (SEGMENTE['dreizack'][1] - SEGMENTE['dreizack'][0]).length


def grundstellung():
    """Was in JEDER Pose gilt, bevor die Bewegung darauf kommt."""
    setz('wurzel')
    setz('bauch')
    setz('brust')
    setz('kopf')


# ── idle: stehen, atmen, Kehlsack pulsieren ─────────────────────────
# Klein dosiert. Die Figur ist gedrungen; grosse Winkel lesen sich sofort
# als Wackeln. Der Kehlsack traegt den kroetenhaften Zug: Er bleibt lange
# ruhig und blaeht sich dann zweimal kurz auf — eine Kroete atmet nicht
# gleichmaessig, sie pumpt.
def idle_pose(p):
    t = p * math.tau
    s, c = math.sin(t), math.cos(t)
    s2 = math.sin(t * 2)

    # Beide Fuesse stehen. Das Becken wiegt und atmet; die IK haelt die
    # Sohlen dabei auf dem Boden — ohne sie schoebe die Figur die Fuesse
    # bei jedem Atemzug in den Boden.
    hub = 0.004 * s2
    seit = 0.006 * s
    setz('wurzel', (VOR, 0.5 * s), (HOCH, 0.9 * math.sin(t + 0.4)))
    schiebe('wurzel', (seit, 0.0, hub))
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        bein_setzen(seite, 0.0, 0.0, 0.0, 0.0,
                    hub + vz * 0.20 * math.sin(math.radians(0.5 * s)),
                    rumpf_vor=0.5 * s, rumpf_gier=0.9 * math.sin(t + 0.4))

    setz('bauch', (VOR, 0.4 * s), (QUER, 0.7 * s2))
    setz('brust', (QUER, 1.2 * s2), (VOR, 0.4 * s), (HOCH, -1.1 * s))
    setz('kopf', (HOCH, 3.4 * math.sin(t * 2 + 0.7)), (QUER, -1.8 * math.sin(t * 3 + 1.9)))

    # Kehlsack: zwei kurze Pumpstoesse je Runde, dazwischen Ruhe.
    puls = max(0.0, math.sin(t * 2 - 0.6)) ** 6
    b = 1.0 + 0.16 * puls * STAERKE
    arm.pose.bones['kehle'].scale = (b, 1.0 + 0.07 * puls * STAERKE, b)

    # Dreizackarm: der Schaft STEHT auf dem Boden, der Arm atmet nur mit.
    # Die Winkel sind bewusst winzig — ein Grad an der Schulter sind am
    # 0,86 entfernten Schaftende schon anderthalb Zentimeter.
    setz('arm_r', (QUER, 0.5 * s), (VOR, -0.4 * s))
    setz('hand_r', (QUER, 0.6 * math.sin(t + 0.5)))
    # Und die Schaftrichtung wird in WELTkoordinaten gehalten statt aus
    # Armwinkeln zusammengesetzt: Sonst kippt der aufgestellte Dreizack mit
    # jedem Atemzug mit, und sein Ende bohrt sich in den Boden.
    ruhe_r = (SEGMENTE['dreizack'][1] - SEGMENTE['dreizack'][0]).normalized()
    setz_richtung('dreizack', ruhe_r + Vector((0.004 * c, 0.004 * s, 0.0)))
    schiebe('dreizack', (0.0, 0.0, DREIZACK_RUHE))
    # Freier Arm: haengt waagerecht ueber dem Korb und wippt.
    setz('arm_l', (VOR, 2.2 * s - 1.5), (QUER, -1.6 * s))
    setz('hand_l', (VOR, 3.0 * math.sin(t + 0.6)), (QUER, -2.0 * s))


# ── walk: watschelnder Gang ─────────────────────────────────────────
# Die Beine kommen vollstaendig aus fuss_bahn() + bein_ik(); hier stehen
# nur noch Rumpf, Arme und das Watscheln.
#
# Das Watscheln ist eine seitliche BECKENROLLE. Sie hebt die Huefte des
# Schwungbeins an — genau deshalb geht sie in die IK ein (hub_seite), sonst
# schoebe sie das Standbein durch den Boden.
def walk_pose(p):
    tau_r = p
    tau_l = (p + 0.5) % 1.0
    hub = beckenhub(tau_r, tau_l)
    rolle = 4.0 * math.sin(p * math.tau)          # Grad, + = rechts tiefer
    gier = 4.5 * math.sin(p * math.tau)

    setz('wurzel', (VOR, rolle), (HOCH, gier))
    schiebe('wurzel', (0.012 * math.sin(p * math.tau), 0.0, hub))
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        tau = tau_r if seite == 'r' else tau_l
        dy, dz, neig, zeh, _st = fuss_bahn(tau)
        # Die Rolle hebt/senkt die Hueftpfanne um x * sin(rolle).
        bein_setzen(seite, dy, dz, neig, zeh,
                    hub + vz * 0.20 * math.sin(math.radians(rolle)),
                    rumpf_vor=rolle, rumpf_gier=gier)

    # Rumpf: leichte Vorlage, Schultern gegen die Huefte, doppelte
    # Nickfrequenz aus dem Beckenhub.
    setz('bauch', (QUER, 2.5), (HOCH, -2.0 * math.sin(p * math.tau)),
         (VOR, -1.5 * math.sin(p * math.tau)))
    setz('brust', (QUER, 2.0 + 2.2 * math.cos(p * math.tau * 2)),
         (HOCH, -4.5 * math.sin(p * math.tau)), (VOR, -1.2 * math.sin(p * math.tau)))
    setz('kopf', (QUER, -3.0 - 2.0 * math.cos(p * math.tau * 2)),
         (HOCH, 2.5 * math.sin(p * math.tau)))
    arm.pose.bones['kehle'].scale = (1.0 + 0.04 * math.cos(p * math.tau * 2), 1.0,
                                     1.0 + 0.04 * math.cos(p * math.tau * 2))

    # Arme gegenlaeufig zum gleichseitigen Bein.
    schwung = math.sin(p * math.tau)
    setz('arm_r', (QUER, -9.0 * schwung), (VOR, -3.0 * schwung))
    setz('hand_r', (QUER, -5.0 * math.sin(p * math.tau - 0.4)))
    setz('dreizack', (QUER, 4.0 * schwung), (VOR, 2.5 * math.cos(p * math.tau)))
    schiebe('dreizack', (0.0, 0.0, DREIZACK_GANG))
    setz('arm_l', (QUER, 11.0 * schwung), (VOR, 3.5 * schwung - 2.0))
    setz('hand_l', (QUER, 6.0 * math.sin(p * math.tau - 0.5)))


# ── attack: Zustechen mit dem Dreizack ──────────────────────────────
# Kein Schlag, ein STICH. Der Unterschied ist nicht die Heftigkeit,
# sondern die Bahn: Beim Stich bewegt sich die Waffe in ihrer eigenen
# LAENGSRICHTUNG. Weicht sie davon ab, sieht es sofort nach Keule aus.
#
# Deshalb ist der Stoss hier eine reine VERSCHIEBUNG:
#   * Beim Ausholen dreht sich der Dreizack aus der Senkrechten in die
#     Zielrichtung (setz_richtung, Weltkoordinaten — der Winkel haengt
#     damit NICHT an Rumpf, Schulter und Handgelenk).
#   * Waehrend des Stosses steht JEDE Drehung still. Becken und Arm
#     verschieben sich um t * L entlang genau dieser Zielrichtung. Die
#     Zinkenspitze kann dabei gar nicht anders, als auf der Schaftgeraden
#     zu bleiben.
#
# Zielhoehe: Der Furloc ist 1,55 Einheiten hoch, mit localScale 1,05 also
# 1,63 m — ein Mensch ueberragt ihn. Der Stich geht deshalb SCHRAEG NACH
# OBEN (8 Grad) und endet auf Brusthoehe eines Erwachsenen.
STOSS_RICHTUNG = Vector((-0.10, -0.985, 0.14)).normalized()
STOSS_BECKEN = 0.10      # wie weit das Becken nach vorn faellt
STOSS_ARM = 0.17         # wie weit der Arm zusaetzlich nachschiebt
HOCK = 0.030             # Kniebeuge beim Ausholen
ZURUECK = 0.045          # wie weit das Gewicht beim Ausholen nach hinten geht

ZEIT = {'ruhe': (0.00, 0.08), 'aushol': (0.08, 0.36),
        'stoss': (0.36, 0.60), 'treffer': (0.60, 0.72), 'zurueck': (0.72, 1.00)}


def _rampe(p, a, b):
    """0 vor a, 1 nach b, weich dazwischen."""
    return glatt((p - a) / (b - a)) if b > a else (1.0 if p >= b else 0.0)


def attack_pose(p):
    # aus: 1 sobald ausgeholt ist und bis zum Rueckzug; stoss: 0..1
    aus = _rampe(p, *ZEIT['aushol']) * (1.0 - _rampe(p, *ZEIT['zurueck']))
    stoss = _rampe(p, *ZEIT['stoss']) * (1.0 - _rampe(p, 0.74, 0.92))
    # Nachfedern nach dem Treffer: gedaempfte Schwingung, ausdruecklich NUR
    # entlang der Schaftrichtung — quer waere sie ein Wackeln der Waffe.
    federn = (math.sin((p - 0.60) * math.tau * 2.4) * math.exp(-(p - 0.60) * 11.0)
              if 0.60 <= p < 0.90 else 0.0)
    weg = STOSS_BECKEN * stoss + 0.010 * federn

    # Becken: erst zurueck und in die Hocke, dann laengs der Stossrichtung
    # nach vorn. Der z-Anteil der Stossrichtung hebt es dabei wieder an —
    # deshalb die Hocke vorher, sonst reichten die Beine nicht.
    root = (Vector((0.0, ZURUECK, -HOCK)) * aus) + STOSS_RICHTUNG * weg
    # ── Warum in dieser Kette KEIN `stoss`-Term steht ────────────────
    # Die Zinkenspitze sitzt am Ende der Kette Wurzel-Bauch-Brust-Arm-Hand-
    # Dreizack. `setz_richtung` haelt zwar die Schaftrichtung fest, aber der
    # GRIFF wandert mit jeder Drehung dieser Kette. Bewegt er sich quer zum
    # Schaft, wandert die Spitze mit — und der Stich schert aus.
    # Waehrend des Stosses steht die Kette deshalb STILL; ihre einzige
    # Bewegung ist die Verschiebung laengs STOSS_RICHTUNG. Leben bekommt die
    # Pose aus Kopf, freiem Arm und Beinen, die alle nicht dazwischenliegen
    # (der Kopf haengt zwar an der Brust, dreht aber nur sich selbst).
    setz('wurzel', (QUER, 4.0 * aus), (HOCH, -9.0 * aus), (VOR, 2.5 * aus))
    schiebe('wurzel', root)

    # Beine: der linke Fuss (+x) steht vorn, der rechte hinten. Beim Stoss
    # kommt die hintere Ferse hoch und der Fuss rollt ueber den BALLEN ab —
    # dieselbe Mechanik wie im Gang, und der einzige Weg, den Ausfall zu
    # machen, ohne dass die Beinlaenge nicht mehr reicht.
    for seite, vz in (('r', -1.0), ('l', 1.0)):
        vorn = 0.055 * aus * (-vz)          # rechts nach hinten, links nach vorn
        neig = 24.0 * stoss if seite == 'r' else -4.0 * stoss
        if seite == 'r':
            vy, vz2 = pivot_versatz(BALLEN_LOK, neig)
        else:
            vy, vz2 = pivot_versatz(FERSE_LOK, neig)
        bein_setzen(seite, vorn + vy - root.y, vz2, neig,
                    -neig if seite == 'r' else 0.0,
                    root.z + vz * 0.20 * math.sin(math.radians(2.5 * aus)),
                    rumpf_quer=4.0 * aus, rumpf_vor=2.5 * aus,
                    rumpf_gier=-9.0 * aus)

    setz('bauch', (QUER, 6.0 * aus), (HOCH, -8.0 * aus))
    setz('brust', (QUER, -9.0 * aus), (HOCH, -14.0 * aus), (VOR, 5.0 * aus))
    setz('kopf', (QUER, 8.0 * aus + 6.0 * stoss + 2.0 * federn),
         (HOCH, 10.0 * aus - 14.0 * stoss))
    arm.pose.bones['kehle'].scale = (1.0 + 0.20 * aus * (1 - stoss), 1.0,
                                     1.0 + 0.20 * aus * (1 - stoss))

    # Dreizackarm: hebt sich und zieht zurueck. Die 42 Grad an der Schulter
    # sind noetig, damit die Faust hoch genug kommt — der Furloc sticht zu
    # einem groesseren Gegner AUFWAERTS.
    setz('arm_r', (VOR, -42.0 * aus), (QUER, -26.0 * aus), (HOCH, -12.0 * aus))
    setz('hand_r', (VOR, -14.0 * aus), (QUER, -10.0 * aus))
    # Erst hier steht die Schaftrichtung fest — und zwar in WELTkoordinaten.
    ruhe_r = (SEGMENTE['dreizack'][1] - SEGMENTE['dreizack'][0]).normalized()
    setz_richtung('dreizack', ruhe_r.slerp(STOSS_RICHTUNG, aus))
    schiebe('dreizack', (0.0, 0.0, DREIZACK_RUHE * (1.0 - aus)))
    schiebe('arm_r', STOSS_RICHTUNG * (STOSS_ARM * stoss + 0.018 * federn)
            - Vector((0.0, 0.05, 0.0)) * aus)

    # Der freie Arm balanciert gegen: beim Ausholen nach vorn, beim Stoss
    # nach hinten. Ohne ihn kippt die Figur optisch aus dem Bild.
    setz('arm_l', (QUER, 16.0 * aus - 20.0 * stoss), (VOR, 10.0 * aus - 6.0 * stoss))
    setz('hand_l', (QUER, 10.0 * aus - 8.0 * stoss))


aktion('idle', DAUER_IDLE, idle_pose)
aktion('walk', DAUER_WALK, walk_pose)
aktion('attack', DAUER_ATTACK, attack_pose, schleife=False)

# ── Gegenprobe an der EVALUIERTEN Haut, nicht an den Knochen ────────
# Was der Spieler sieht, ist die Haut. Zwei Zahlen entscheiden, ob das Rig
# taugt, und beide lassen sich hier direkt ablesen:
#   * tiefster Punkt je Bild — alles unter 0 steckt im Gelaende,
#   * Bahn der Zinkenspitze — sie belegt den Stich.
szene.frame_set(1)
bpy.ops.object.mode_set(mode='OBJECT')

_ruhe = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
_t = [(v - (SCHAFT_MITTE + Vector((0, 0, ZHEB)))).dot(SCHAFT_ACHSE) for v in _ruhe]
SPITZE_I = max(range(len(_ruhe)), key=lambda i: _t[i])


def probe(name):
    akt = bpy.data.actions[name]
    arm.animation_data.action = akt
    f0, f1 = int(akt.frame_range[0]), int(akt.frame_range[1])
    tiefst = []
    bahn = []
    for f in range(f0, f1 + 1):
        szene.frame_set(f)
        dgl = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dgl)
        m = ev.to_mesh()
        tiefst.append(min((mesh.matrix_world @ v.co).z for v in m.vertices))
        bahn.append(mesh.matrix_world @ m.vertices[SPITZE_I].co.copy())
        ev.to_mesh_clear()
    print(f'PROBE {name}: tiefster Punkt {min(tiefst):+.4f} .. {max(tiefst):+.4f} '
          f'(0 = Boden), Bild 1 bei {tiefst[0]:+.5f}')
    return bahn, f0, f1


for _n in ('idle', 'walk'):
    probe(_n)

_bahn, _f0, _f1 = probe('attack')
print('SPITZE (attack): Bahn der Zinkenspitze in Modellkoordinaten')
print(f'{"p":>6}{"x":>9}{"y":>9}{"z":>9}{"|dv| je Bild":>14}{"Winkel zur Schaftrichtung":>28}')
_n = _f1 - _f0
for _k in range(0, _n + 1, max(1, _n // 12)):
    _v = _bahn[_k]
    if _k == 0:
        print(f'{0.0:6.2f}{_v.x:9.3f}{_v.y:9.3f}{_v.z:9.3f}{"—":>14}{"—":>28}')
        continue
    _d = _v - _bahn[_k - 1]
    _w = (math.degrees(math.acos(max(-1.0, min(1.0, _d.normalized().dot(STOSS_RICHTUNG)))))
          if _d.length > 1e-6 else float('nan'))
    print(f'{_k/_n:6.2f}{_v.x:9.3f}{_v.y:9.3f}{_v.z:9.3f}{_d.length:14.4f}{_w:28.1f}')
_s0, _s1 = ZEIT['stoss']
_i0, _i1 = int(_s0 * _n), int(_s1 * _n)
_dges = _bahn[_i1] - _bahn[_i0]
_winkel = math.degrees(math.acos(max(-1.0, min(1.0, _dges.normalized().dot(STOSS_RICHTUNG)))))
print(f'STOSS: Spitze von {tuple(round(x,3) for x in _bahn[_i0])} nach '
      f'{tuple(round(x,3) for x in _bahn[_i1])}, Weg {_dges.length:.4f} Einheiten '
      f'({_dges.length*SKALA:.3f} m), Abweichung von der Schaftrichtung {_winkel:.2f} Grad')
print(f'STOSS: Endhoehe der Spitze {_bahn[_i1].z:.3f} Einheiten = '
      f'{_bahn[_i1].z*SKALA:.3f} m ueber dem Boden')

szene.frame_set(1)
arm.animation_data.action = bpy.data.actions['idle']
szene.frame_set(1)

# ── Blickrichtung ───────────────────────────────────────────────────
# Gemessen, nicht beurteilt (Herleitung im Kopfkommentar): Der Furloc
# blickt bereits nach -y, wie Voelva und Surtr nach ihrer Korrektur. Es
# bleibt trotzdem eine benannte Konstante — beim naechsten Modell aus
# derselben Quelle ist die Frage sofort wieder da.
BLICK_DREHUNG = 0.0
if BLICK_DREHUNG:
    for o in (arm, mesh):
        o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                            o.rotation_euler[2] + BLICK_DREHUNG)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
print(f'BLICK: Drehung um die Hochachse {math.degrees(BLICK_DREHUNG):+.1f} Grad '
      f'(Modell schaut bereits nach -y)')

# ── Export ──────────────────────────────────────────────────────────
# export_animation_mode='ACTIONS' schreibt JEDE Action als eigene
# glTF-Animation unter ihrem Action-Namen; export_frame_range muss dabei
# AUS sein, sonst schneidet der Szenenbereich der zuletzt gebackenen
# Aktion die anderen ab.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=ZIEL,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_frame_range=False,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)
print(f'FERTIG {ZIEL} — {len(KNOCHEN)} Knochen, Aktionen "idle", "walk" und '
      f'"attack", {os.path.getsize(ZIEL) / 1e6:.2f} MB')
