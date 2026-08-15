#!/usr/bin/env blender --background --python
"""
Riggt Surtr (Feuerriese, Tripo-Modell) und legt ihm drei Bewegungen an:
"idle", "walk" und "attack".

    blender --background --python tools/surtr-rig.py -- \
        --glb assets/models/Surtr-roh.glb --out assets/models/Surtr.glb \
        [--staerke 1.0] [--walk-dauer 3.4] [--tempo 1.5] [--scale 9]

QUELLE ist Surtr-roh.glb, NICHT das fertige Surtr.glb: Das Skript backt
zum Schluss die Blickdrehung ins Mesh, und alle Knochenpunkte unten sind
im ungedrehten Raum gemessen. Ein zweiter Lauf auf das eigene Ergebnis
setzt das Skelett quer in die Figur; das Skript bricht deshalb ab, wenn
es die Eingabe schon einmal bearbeitet hat.

── Warum wieder ein handgebautes Rig ────────────────────────────────
Tripos Auto-Rigging ist an dieser Figur zweimal gescheitert (v2.5
zerlegte die Geometrie schon beim Riggen, v1.0 riggte sauber, aber das
Retargeting von "preset:idle" zerriss sie doch). Blenders "Automatic
Weights" scheidet ebenfalls aus, und zwar nachgemessen: Das Mesh zerfaellt
in 170 ZUSAMMENHANGSKOMPONENTEN auf 9.593 Vertices — Tripo macht an jeder
UV-Naht auf. Bone Heat braucht eine zusammenhaengende Flaeche und raet
sonst je Insel; genau dort klafft das Modell dann auf.

Dieselbe Lektion steht schon in tools/voelva-rig.py, und der Weg hier ist
derselbe: eigene Knochenkette, Gewichte als STETIGE FUNKTION DER POSITION.
Stetig in der Position heisst, dass die an den Naehten verdoppelten
Vertices exakt aufeinanderliegen und deshalb identische Gewichte bekommen
— die 170 Inseln koennen prinzipbedingt nicht auseinanderklaffen.

Gegenueber dem ersten Surtr-Rig (tools/rig-idle.py, vier Knochen auf der
Hochachse) kommen Arme und Beine dazu. Vier gestapelte Knochen koennen
wiegen, aber nicht gehen und nicht schlagen.

── Die Knochenpunkte sind gemessen, nicht geschaetzt ────────────────
Alle Zahlen unten stammen aus Scheibenmessungen am importierten Modell
(Tripo normiert auf Kantenlaenge 1, Fusssohle liegt auf z = 0,000):

  Blickrichtung        +x (Gesicht, Bart, Zehen); seine LINKE Seite = +y
  Koerperachse         x = -0,07   y = +0,05
  Huefte / Guertel     z = 0,42 / 0,51
  Schulter             z = 0,75
  Kopfansatz           z = 0,78, Scheitel 1,00
  Knie                 z = 0,235 (rechts) / 0,245 (links)
  Knoechel             z = 0,100 (rechts) / 0,105 (links)
  Zehenballen          z = 0,018 (rechts) / 0,020 (links)
  Sohle                z = 0,000 (rechts) / 0,008 (links) — er steht schief
  Beinachsen           y = -0,12 (rechts) und +0,20 (links)
  Schwertgriff         (-0,02 / -0,33 / 0,365), Klingenspitze
                       (+0,30 / -0,46 / 0,225)
  Schurz zwischen den Beinen: y = 0,00 .. 0,10, z = 0,21 .. 0,41,
                       beidseits durch eine echte Luecke von 0,043
                       vom Oberschenkel getrennt

── Der Schurz haengt an der Huefte ──────────────────────────────────
Zwischen den Beinen haengt eine Lendenplatte. Die reine Abstandshuelle
gaebe ihr rund ein Viertel Beingewicht, und weil beide Beine GEGENLAEUFIG
schwingen, scherte sie damit im Takt. Sie bekommt deshalb eine eigene
Maske (gemessener Quader, weiche Raender) und haengt starr an der Wurzel —
so wie der Stab der Voelva an ihrer Hand. Kosten darf das nichts: Die
Platte ist eine eigene Flaeche mit 0,043 Luft zum Oberschenkel.
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
DAUER_IDLE = float(arg('--idle-dauer', '6.0'))
DAUER_WALK = float(arg('--walk-dauer', '3.4'))
DAUER_ATTACK = float(arg('--attack-dauer', '2.6'))
TEMPO = float(arg('--tempo', '1.5'))     # m/s, ROUTE_DEFAULT_SPEED
SKALA = float(arg('--scale', '9.0'))     # PrefabDef.localScale
FPS = 30
if not GLB:
    raise SystemExit('--glb fehlt')

# ── Der Gang in Zahlen ──────────────────────────────────────────────
STAND = 0.60            # Anteil des Zyklus, den ein Fuss am Boden steht
ROLL_FERSE = 0.18       # ... davon: Fersenauftritt bis Sohle flach
ROLL_BALLEN = 0.65      # ... ab hier hebt die Ferse, Abstoss ueber den Ballen
NEIGUNG_AUF = -14.0     # Sohlenneigung beim Aufsetzen (Zehen hoch)
NEIGUNG_AB = 20.0       # ... beim Abstossen (Ferse hoch, Stand auf dem Ballen)
NEIGUNG_SCHWUNG = -8.0  # ... im Durchschwingen
FREIGANG = 0.035        # Luft unter der Sohle im Durchschwingen (0,32 m)
BECKEN_TIEF = -0.024    # Dauerhafte Absenkung gegenueber der Ruhelage
BECKEN_HUB = 0.010      # ... zusaetzlich hoch im Einbeinstand, tief beim Auftritt
ZENTRUM = 0.000         # Mitte des Standwegs, in x unter der Huefte

# Weg je Zyklus: Der Server schiebt ihn mit TEMPO; laufen zwei Schritte in
# DAUER_WALK, ist der Zyklusweg genau TEMPO * DAUER_WALK — in Modellmass
# geteilt durch localScale. Jede andere Zahl heisst Rutschen.
ZYKLUSWEG = TEMPO / SKALA * DAUER_WALK

# Wie hoch der ganze Zyklus ueber dem Gelaende liegt. Steht nach dem
# ersten Backen NICHT mehr auf null: Die Bahn rechnet mit der Sohle als
# starrem Koerper, die Haut wird aber linear zwischen zwei Knochen
# gemischt (Linear Blend Skinning) und knickt an Knoechel und Ballen um
# ein paar Millimeter nach innen. Diese Millimeter werden am fertig
# gebackenen Mesh GEMESSEN und der Zyklus danach einmal angehoben — das
# ist genauer, als sie zu schaetzen, und haelt auch dann, wenn sich
# Gewichte oder Winkel spaeter aendern.
BODENSPIEL = {'r': 0.0, 'l': 0.0}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFAD = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)
ZIEL = PFAD if not OUT else (OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT))

# ── Skelett ─────────────────────────────────────────────────────────
# (Name, Kopf, Spitze, Eltern, verbunden, Reichweite, Staerke)
# Reichweite = Radius, ab dem der Knochen keinen Vertex mehr zieht;
# Staerke = wie stark er sich innerhalb davon gegen die Nachbarn durchsetzt.
#
# Die Reichweiten sind fuer diesen Koerperbau GROSSZUEGIG. Surtr ist bei
# gleicher Normhoehe fast dreimal so breit wie die Voelva (Schultern 0,79
# gegen 0,28); mit deren Radien blieben Panzerplatten und Schulterfelsen
# ohne Knochen in Reichweite und fielen auf den Notnagel "naechster
# Knochen" zurueck — eine harte Kante mitten im Stein. Teuer ist eine
# grosse Reichweite nicht: Der Kern faellt mit (1-u)^3 ab, jenseits der
# halben Reichweite traegt ein Knochen unter zwei Prozent.
X0, Y0 = -0.07, 0.05            # Koerperachse
KNOCHEN = [
    ('wurzel', (-0.05, Y0, 0.420), (X0, Y0, 0.520), None,     False, 0.45, 1.0),
    ('bauch',  (X0, Y0, 0.520), (X0, Y0, 0.640), 'wurzel', True,  0.45, 1.0),
    ('brust',  (X0, Y0, 0.640), (-0.09, Y0, 0.780), 'bauch', True,  0.45, 1.0),
    ('kopf',   (-0.09, Y0, 0.780), (-0.055, Y0, 1.000), 'brust', True, 0.34, 1.0),

    # Rechter Arm — traegt das Schwert. Er haengt hinter der Huefte
    # (x = -0,19 am Ellbogen) und schwingt zum Griff nach vorn.
    ('arm_r',  (-0.13, -0.20, 0.750), (-0.19, -0.28, 0.520), 'brust', False, 0.32, 1.3),
    ('hand_r', (-0.19, -0.28, 0.520), (-0.04, -0.32, 0.400), 'arm_r', True,  0.32, 1.6),
    # Schwert: Kopf im GRIFF, Spitze an der Klinge. Die Drehung pivotiert
    # damit in der Faust — sonst wandert der Griff aus der Hand.
    ('schwert', (-0.02, -0.33, 0.365), (0.30, -0.46, 0.225), 'hand_r', False, 0.24, 1.2),

    # Linker Arm — frei, schwingt beim Gehen weiter aus als der Schwertarm.
    ('arm_l',  (-0.12, 0.24, 0.750), (-0.04, 0.38, 0.530), 'brust', False, 0.32, 1.3),
    ('hand_l', (-0.04, 0.38, 0.530), (0.07, 0.42, 0.325), 'arm_l', True,  0.32, 1.6),

    # ── Beine: VIER Gelenke je Seite ────────────────────────────────
    # Huefte -> Knie -> Knoechel -> Zehenballen -> Spitze. Die drei
    # unteren Punkte sind an der Geometrie ausgemessen (tools sind im
    # Kopfkommentar beschrieben), nicht aus dem alten Zweiknochen-Rig
    # uebernommen — dessen "Knie" bei z = 0,205 lag drei Zentimeter unter
    # dem echten Gelenk, und ein Knoechel fehlte ganz.
    #
    # Messverfahren: waagerechte Scheiben (2 cm Fenster, 5 mm Schritt) in
    # einem engen y-Band um jede Beinachse, damit weder Lendenschurz
    # (y = 0,00..0,10) noch Schwert (y = -0,33..-0,46) hineinragen.
    # Gesucht ist jeweils die TAILLE, also das Minimum der Beinbreite:
    #
    #   Knoechel  rechts z = 0,100 (Breite 0,145)   links z = 0,105 (0,142)
    #   Knie      rechts z = 0,235 (Breite 0,156)   links z = 0,245 (0,153)
    #
    # Der Ballen ist der KNICK IM FUSSRUECKEN: Bis dorthin ist der Fuss
    # 0,12 hoch, davor nur noch 0,063 — das sind die Zehen. Er liegt bei
    # beiden Fuessen auf 73 bis 75 % der Sohlenlaenge, wie beim Menschen.
    #
    # In der HOEHE sitzt er dicht ueber der Sohle (0,018 / 0,020), nicht
    # in der Fussmitte: Beim Abstoss knicken Fuss und Zeh dort um 20 Grad
    # gegeneinander, und die lineare Hautmischung zieht die Stelle umso
    # tiefer nach innen, je weiter das Gelenk vom Boden weg liegt.
    # Anatomisch ist das Grundgelenk ebenfalls sohlennah.
    ('bein_r',  (0.000, -0.100, 0.420), (-0.062, -0.126, 0.235), 'wurzel', False, 0.30, 1.1),
    ('schien_r', (-0.062, -0.126, 0.235), (-0.105, -0.130, 0.100), 'bein_r', True, 0.17, 1.1),
    ('fuss_r',  (-0.105, -0.130, 0.100), (-0.040, -0.165, 0.018), 'schien_r', True, 0.17, 1.8),
    ('zeh_r',   (-0.040, -0.165, 0.018), (0.020, -0.180, 0.014), 'fuss_r', True, 0.14, 2.8),
    ('bein_l',  (0.000, 0.200, 0.420), (0.013, 0.230, 0.245), 'wurzel', False, 0.30, 1.1),
    ('schien_l', (0.013, 0.230, 0.245), (-0.040, 0.240, 0.105), 'bein_l', True, 0.17, 1.1),
    ('fuss_l',  (-0.040, 0.240, 0.105), (0.033, 0.258, 0.020), 'schien_l', True, 0.17, 1.8),
    ('zeh_l',   (0.033, 0.258, 0.020), (0.093, 0.285, 0.016), 'fuss_l', True, 0.14, 2.8),
]

# ── Wo der Fuss aufsetzt ────────────────────────────────────────────
# Nur der Ballen wird hier von Hand vorgegeben (der gemessene Knick im
# Fussruecken: dahinter ist der Fuss 0,12 hoch, davor nur noch 0,063).
# Ferse, Spitze und alles dazwischen holt sich `sohlenhuelle` direkt aus
# der Geometrie — die Sohle ist keine Ebene, und Zahlen aus einer
# Scheibenmessung waeren hier auf den Millimeter falsch.
#
# Wie falsch, zeigt der Vergleich: Der hinterste Sohlenpunkt des rechten
# Fusses liegt auf z = 0,017, der tiefste Punkt desselben Fusses weiter
# vorn auf z = 0,000; der linke Fuss steht in der Skulptur insgesamt
# 0,008 hoeher als der rechte. Ein gemeinsamer, flacher "Sohlenwert"
# laesst im Spiel einen Fuss um 7 bis 15 cm schweben oder einsinken.
FUSSPUNKTE = {'r': -0.040, 'l': 0.033}    # x des Zehenballens
# y-Band, in dem die Sohle eines Fusses liegt — Trennlinie zwischen den
# beiden Fuessen ist y = 0,05, die Koerperachse.
YBAND = {'r': (-0.30, 0.02), 'l': (0.10, 0.40)}

# Gemessener Schurz zwischen den Beinen (Quader mit weichen Raendern).
SCHURZ_Y = 0.050        # Mitte
SCHURZ_HALB = 0.058     # bis hier voll ...
SCHURZ_RAND = 0.030     # ... und ueber diese Strecke auf 0
SCHURZ_Z = (0.185, 0.520)
SCHURZ_X_MIN = -0.075   # nur die vordere Platte, nicht der Schritt dahinter

# ── Modell laden ────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

# Frueheres Rig restlos entfernen (die GLB traegt beim Nachbessern schon
# eins) — zwei Skelette und alte Actions ergaeben im Export Unsinn. Die
# WELTLAGE des Meshes muss dabei erhalten bleiben.
#
# Zugleich die Frage, ob dieses Skript schon einmal ueber diese Datei
# gelaufen ist: Die Blickdrehung unten wird ins MESH gebacken, ein zweiter
# Lauf wuerde es ein zweites Mal drehen. Erkennungsmerkmal ist der Name der
# Armature — den vergibt nur dieses Skript.
#
# Ein zweiter Lauf ist nicht bloss ueberfluessig, er ist FALSCH: Alle
# Knochenpunkte oben sind im Rohraum gemessen, in dem Surtr nach +x
# schaut. Auf ein bereits gedrehtes Mesh gesetzt liegen sie quer zum
# Koerper — das Skelett steht dann seitlich in der Figur. Frueher hat die
# Erkennung nur die zweite Drehung unterdrueckt und diesen Fall stillschweigend
# durchgelassen. Deshalb hier ein harter Abbruch mit Wegbeschreibung.
schon_gedreht = any(o.type == 'ARMATURE' and o.name.startswith('surtr_rig')
                    for o in bpy.data.objects)
if schon_gedreht:
    raise SystemExit(
        f'{PFAD} traegt bereits ein surtr_rig und ist damit auf die\n'
        'Engine-Blickrichtung gedreht. Dieses Skript braucht das UNGEDREHTE\n'
        'Rohmodell (Gesicht nach +x). Nimm die Tripo-Quelle und schreibe mit\n'
        '--out nach assets/models/Surtr.glb.')
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
hoehe = zmax - zmin

# ── Steht er auf seiner Sohle? ──────────────────────────────────────
# Der Prefab-Ursprung IST der Punkt, auf den der Server die Gelaendehoehe
# setzt. Liegt die Sohle darueber, schwebt die Figur im Spiel um genau
# diese Strecke mal localScale. Deshalb wird das hier gemessen und
# gemeldet, statt spaeter in einer Client-Konstanten zu landen — die waere
# beim naechsten Modellwechsel falsch.
#
# Gemessen wird nicht der tiefste Punkt (das kann ein einzelner Zacken
# sein), sondern die Hoehe, ab der die Sohle wirklich auf dem Boden
# aufliegt: die tiefste Scheibe mit mindestens 1 % der Vertices.
FAECHER = 400
fach = [0] * FAECHER
for v in welt:
    fach[min(FAECHER - 1, int((v.z - zmin) / (zmax - zmin) * FAECHER))] += 1
schwelle = len(welt) * 0.01
sohle = next((i for i, c in enumerate(fach) if c >= schwelle), 0) * (zmax - zmin) / FAECHER
print(f'MODELL {mesh.name}: {len(welt)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, Höhe {hoehe:.4f}')
print(f'SOHLE: tiefster Punkt z={zmin:.4f}, tragende Sohle z={zmin + sohle:.4f} '
      f'({sohle * 100:.2f} % der Höhe; bei localScale 9 sind das {sohle * 9:.3f} m)')

# ── Armature ────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new('surtr_rig')
arm = bpy.data.objects.new('surtr_rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, kopf, spitze, eltern, verbunden, _r, _s in KNOCHEN:
    b = arm_data.edit_bones.new(name)
    b.head = Vector(kopf)
    b.tail = Vector(spitze)
    if eltern:
        b.parent = arm_data.edit_bones[eltern]
        b.use_connect = bool(verbunden)
bpy.ops.object.mode_set(mode='OBJECT')

SEGMENTE = {n: (Vector(k), Vector(s)) for n, k, s, *_ in KNOCHEN}

# ── Wo ein Knochen WIEGT, ist nicht immer, wo er DREHT ───────────────
# Der Fussknochen laeuft vom Knoechel zum Ballen — nach VORN. Die Ferse
# steht 0,11 dahinter, und ueber ihr liegt damit gar kein Knochen: Sie ist
# von Fuss und Schienbein gleich weit entfernt und bekommt von beiden je
# rund die Haelfte. Beim Fersenauftritt stehen die beiden aber 14 Grad
# auseinander, und die lineare Mischung zweier so verschiedener Drehungen
# zieht die Hacke nach INNEN — gemessen 7 mm, im Spiel 6 cm unter das
# Gelaende.
#
# Deshalb wiegt der Fuss laengs seiner SOHLE, von der Ferse bis zum
# Ballen. Gedreht wird weiterhin im Knoechel; nur die Abstandsfunktion
# sieht ein anderes Segment.
SEGMENTE['fuss_r'] = (Vector((-0.205, -0.125, 0.025)), Vector((-0.040, -0.165, 0.018)))
SEGMENTE['fuss_l'] = (Vector((-0.150, 0.225, 0.025)), Vector((0.033, 0.258, 0.020)))
REICHWEITE = {n: r for n, _k, _s, _e, _v, r, _st in KNOCHEN}
BEINFLUSS = {n: st for n, _k, _s, _e, _v, _r, st in KNOCHEN}


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


def glatt(u):
    """smoothstep 0..1"""
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


# ── Gewichte ────────────────────────────────────────────────────────
ALLE = [n for n, *_ in KNOCHEN]
gruppen = {n: mesh.vertex_groups.new(name=n) for n in ALLE}


def huelle(p):
    """Kompakter Kern um jedes Knochensegment, auf Summe 1 normiert."""
    roh = []
    for n in ALLE:
        d = abstand_segment(p, *SEGMENTE[n])
        u = d / REICHWEITE[n]
        if u >= 1.0:
            continue
        # Faellt am Rand der Reichweite stetig auf 0 und ist nah am
        # Knochen stark. (1-u)^3 sorgt fuer den sauberen Nullabschluss.
        roh.append((n, BEINFLUSS[n] * (1.0 - u) ** 3 / (u * u + 0.02)))
    if not roh:
        # Kein Knochen in Reichweite — an den naechsten haengen, damit kein
        # Vertex ungebunden bleibt und im Client auf den Ursprung faellt.
        n = min(ALLE, key=lambda k: abstand_segment(p, *SEGMENTE[k]))
        roh = [(n, 1.0)]
    s = sum(w for _n, w in roh)
    return {n: w / s for n, w in roh}


def schurz_maske(p):
    """1 mitten im Lendenschurz, 0 ausserhalb, weicher Rand dazwischen."""
    if p.x < SCHURZ_X_MIN:
        return 0.0
    q = abs(p.y - SCHURZ_Y)
    seit = 1.0 - glatt((q - SCHURZ_HALB) / SCHURZ_RAND)
    unten = glatt((p.z - SCHURZ_Z[0]) / 0.045)
    oben = 1.0 - glatt((p.z - SCHURZ_Z[1]) / 0.050)
    vorn = glatt((p.x - SCHURZ_X_MIN) / 0.030)
    return seit * unten * oben * vorn


schurz_voll = 0
schurz_rand = 0
notnagel = 0
for i, p in enumerate(welt):
    m = schurz_maske(p)
    if m > 0.001:
        schurz_rand += 1
    if m > 0.999:
        gruppen['wurzel'].add([i], 1.0, 'REPLACE')
        schurz_voll += 1
        continue

    w = huelle(p)
    # glTF haelt nur 4 Joints je Vertex — die schwaechsten fallen weg, der
    # Rest wird nachnormiert.
    roh = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
    summe = sum(x for _n, x in roh)
    for n, x in roh:
        gruppen[n].add([i], (x / summe) * (1.0 - m), 'REPLACE')
    if m > 0.001:
        # ADD statt REPLACE: Die Wurzel kann schon aus der Huelle einen
        # Anteil haben, der Maskenanteil kommt oben drauf.
        gruppen['wurzel'].add([i], m, 'ADD')

print(f'GEWICHTE: {schurz_voll} Vertices voll am Schurz, '
      f'{schurz_rand - schurz_voll} im Uebergangsrand')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mesh.parent = arm

# ── Posieren: Drehungen um WELTACHSEN ───────────────────────────────
# bone.matrix_local bildet Knochenraum -> Armature-Raum ab; die Armature
# steht auf dem Ursprung, Armature-Raum ist also Weltraum. Damit laesst
# sich eine Weltachse sauber in den lokalen Raum eines Knochens holen —
# ohne Raterei ueber Bone-Rolls.
HOCH = Vector((0, 0, 1))      # Gierachse (umsehen, Schultern gegen Huefte)
QUER = Vector((0, 1, 0))      # Seitenachse: Vor-/Zurueckschwingen.
#                               +Grad = nach HINTEN (Rechte-Hand-Regel um
#                               +y zieht -z nach -x, und Surtr schaut +x)
VOR = Vector((1, 0, 0))       # Blickachse: seitliches Wiegen, +Grad = nach rechts


def q(pb, achse, grad):
    m = pb.bone.matrix_local.to_3x3()
    a = (m.inverted() @ achse)
    if a.length < 1e-9:
        return Quaternion()
    return Quaternion(a.normalized(), math.radians(grad))


def versatz(pb, vek):
    return pb.bone.matrix_local.to_3x3().inverted() @ vek


bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

szene = bpy.context.scene
szene.render.fps = FPS


def aktion(name, dauer, pose_fn, schleife=True):
    """Backt eine Aktion.

    Bei `schleife` ist der letzte Frame die Kopie des ersten, und die
    Phase laeuft von 0 bis tau — dann schliesst der Zyklus im Client ohne
    Sprung. Sonst laeuft die Phase von 0 bis 1 ueber die volle Laenge.
    """
    frames = int(round(dauer * FPS))
    arm.animation_data_create()
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    arm.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = frames + 1
    for f in range(1, frames + 2):
        if schleife:
            phase = ((f - 1) % frames) / frames * math.tau
        else:
            phase = (f - 1) / frames
        szene.frame_set(f)
        for pb in arm.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = (0.0, 0.0, 0.0)
        pose_fn(phase)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
        arm.pose.bones['wurzel'].keyframe_insert('location', frame=f)
    for fc in akt.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    akt.name = name
    print(f'AKTION {name}: {frames + 1} Frames ({dauer:.1f} s), '
          f'{len(akt.fcurves)} F-Kurven')
    return akt


def setz(name, *drehungen):
    pb = arm.pose.bones[name]
    ges = Quaternion()
    for achse, grad in drehungen:
        ges = ges @ q(pb, achse, grad * STAERKE)
    pb.rotation_quaternion = ges


def setz_roh(name, grad):
    """Dreht um QUER, OHNE `--staerke`.

    Die Beinwinkel im Laufzyklus sind keine Geschmackswerte, sondern die
    Loesung einer Gleichung: Sie halten die Sohle auf z = 0 und den
    Standfuss weltfest. Mit `--staerke` skaliert waeren sie sofort wieder
    falsch — der Fuss rutschte oder stuende in der Luft.
    """
    pb = arm.pose.bones[name]
    pb.rotation_quaternion = q(pb, QUER, grad)


# ── Rechnen in der Gehebene ─────────────────────────────────────────
# Alle Beindrehungen laufen um dieselbe WELTACHSE +y (QUER). Dadurch
# addieren sich die Winkel entlang der Kette einfach auf: Der Weltwinkel
# des Unterschenkels ist der des Oberschenkels plus dessen eigener. Das
# macht die ganze Beinkette in der x-z-Ebene rechenbar, ohne dass Blender
# eine IK-Kette braucht (die der glTF-Export ohnehin nicht mitnaehme).
#
# Winkelkonvention wie bei QUER: phi ist die Drehung aus der Senkrechten,
# +phi = nach HINTEN. Ein Einheitsvektor dieser Richtung ist deshalb
# (-sin phi, -cos phi) in (x, z).
def eben(v):
    """(x, z) eines Vektors — die Gehebene. Um +y gedreht bleibt y fest."""
    return (v[0], v[2])


def winkel(x, z):
    """Winkel aus der Senkrechten, + = nach hinten."""
    return math.atan2(-x, -z)


def dreh(x, z, w):
    """Dreht (x, z) um w um die Achse +y."""
    c, s = math.cos(w), math.sin(w)
    return (x * c + z * s, -x * s + z * c)


def neigungen(s):
    """Sohlen- und Zehenwinkel in der Standphase (s laeuft 0..1).

    Fersenauftritt, flache Sohle, Abstoss ueber den Ballen — die drei
    Abschnitte eines Schritts. Beim Abstoss bleibt der ZEHENWINKEL bei
    null: Die Zehen liegen flach am Boden, waehrend der Fuss sich ueber
    sie aufrichtet. Genau dafuer gibt es das Zehengelenk; ohne es bohrte
    sich die Spitze bei 20 Grad Fussneigung 2 cm (18 cm im Spiel) in den
    Boden.
    """
    if s < ROLL_FERSE:
        sigma = math.radians(NEIGUNG_AUF) * (1.0 - glatt(s / ROLL_FERSE))
        return sigma, sigma
    if s < ROLL_BALLEN:
        return 0.0, 0.0
    t = (s - ROLL_BALLEN) / (1.0 - ROLL_BALLEN)
    return math.radians(NEIGUNG_AB) * glatt(t), 0.0


def sohlenhuelle(band, kx, kz):
    """Untere konvexe Huelle eines Fussprofils, relativ zum Knoechel.

    Monotone Kette nach Andrew: nach x sortieren und alles verwerfen, was
    keine Linksdrehung ergibt. Uebrig bleibt der Linienzug, auf dem der
    Fuss abrollt.
    """
    ylo, yhi = band
    pkt = sorted({(round(v.x, 4), round(v.z, 4))
                  for v in welt if v.z < 0.06 and ylo <= v.y <= yhi})
    huelle = []
    for q in pkt:
        while len(huelle) >= 2:
            (ax, az), (bx, bz) = huelle[-2], huelle[-1]
            if (bx - ax) * (q[1] - az) - (bz - az) * (q[0] - ax) < 0:
                huelle.pop()
            else:
                break
        huelle.append(q)
    return [(x - kx, z - kz) for x, z in huelle]


def huellen_z(huelle, x):
    """Hoehe der Sohlenhuelle an der Stelle x (linear dazwischen)."""
    for (ax, az), (bx, bz) in zip(huelle, huelle[1:]):
        if ax <= x <= bx:
            t = (x - ax) / (bx - ax) if bx > ax else 0.0
            return az + (bz - az) * t
    return huelle[0][1] if x < huelle[0][0] else huelle[-1][1]


class Bein:
    """Ein Bein als zweigliedrige Kette mit Fuss und Zeh.

    Kennt seine RUHEWINKEL und -laengen in der Gehebene und rechnet
    daraus, welche Gelenkdrehungen den Knoechel an einen gewuenschten
    Punkt und die Sohle in eine gewuenschte Neigung bringen.
    """

    def __init__(self, seite):
        self.s = seite
        p = {n: (Vector(k), Vector(sp)) for n, k, sp, *_ in KNOCHEN}
        self.hueft = eben(p[f'bein_{seite}'][0])
        d1 = p[f'bein_{seite}'][1] - p[f'bein_{seite}'][0]
        d2 = p[f'schien_{seite}'][1] - p[f'schien_{seite}'][0]
        self.l1 = Vector(eben(d1)).length
        self.l2 = Vector(eben(d2)).length
        self.phi1 = winkel(*eben(d1))
        self.phi2 = winkel(*eben(d2))
        # ── Sohle: was den Boden wirklich beruehren kann ─────────────
        # Nicht jeder tiefe Vertex ist ein Auftrittspunkt. Die Stiefel-
        # sohle biegt sich an Ferse und Spitze nach oben; ein Punkt, der
        # ueber der Verbindungslinie zweier anderer liegt, kommt beim
        # Kippen nie zuerst auf. Genau die Punkte, die aufkommen KOENNEN,
        # sind die UNTERE KONVEXE HUELLE des Fussprofils — und nur sie
        # bestimmen, wie hoch der Knoechel stehen muss.
        #
        # Das ist der Unterschied zwischen "gemessen" und "geschaetzt":
        # Der gemessene hinterste Sohlenpunkt des rechten Fusses liegt
        # z = 0,017 hoch, der tiefste Punkt des Fusses aber weiter vorn
        # auf z = 0,000. Nimmt man die Ferse als Drehpunkt auf Bodenhoehe,
        # steht der halbe Fuss beim Auftritt 1,7 cm zu tief.
        kx, kz = eben(p[f'fuss_{seite}'][0])
        self.huelle = sohlenhuelle(YBAND[seite], kx, kz)
        self.ferse = self.huelle[0]
        self.spitze = self.huelle[-1]
        # Der Ballen ist der gemessene Knick im Fussruecken. Er ist KEIN
        # Eckpunkt der Huelle — eine gewoelbte Sohle hat dort keine Kante
        # —, also wird seine Hoehe auf der Huelle interpoliert. Nur so
        # liegt der Drehpunkt beim Abstoss wirklich auf der Sohle.
        bx = FUSSPUNKTE[seite] - kx
        self.ballen = (bx, huellen_z(self.huelle, bx))
        self.reichweite = self.l1 + self.l2
        self.stand = self._standbahn()

    def _standbahn(self):
        """Die Standphase, aus der ABROLLBEDINGUNG integriert.

        Statt einen Drehpunkt festzulegen und zu hoffen, dass er auf dem
        Boden liegt, wird hier gerechnet, was Abrollen physikalisch heisst:
        Der momentane Beruehrpunkt steht STILL. Fuer einen Koerper, der
        sich um die Achse +y dreht, folgt daraus unmittelbar

            d(Knoechel_x) = d(Zehwinkel) * Ballenhoehe
                          + d(Sohlenwinkel) * (Knoechelhoehe - Ballenhoehe)

        — der erste Summand ist das Abrollen ueber die Zehen, der zweite
        das Kippen des Fusses ueber den Ballen. Solange die Zehen mit dem
        Fuss starr sind, faellt beides zusammen und es bleibt
        d(Knoechel_x) = d(Winkel) * Knoechelhoehe.

        Dazu kommt der Vorschub: Der Koerper wandert je Zyklus um
        ZYKLUSWEG nach vorn, im Koerperraum laeuft ein weltfester Punkt
        also entsprechend nach hinten. Was hier herauskommt, KANN darum
        nicht rutschen, gleich wie die Sohle geformt ist.
        """
        n = 240
        bahn = [(0.0, 0.0)] * (n + 1)
        x = 0.0
        sig, ta = neigungen(0.0)
        z = -self.sohle_z(sig, ta)
        bahn[0] = (x, z)
        for i in range(1, n + 1):
            s = i / n
            sig2, ta2 = neigungen(s)
            z2 = -self.sohle_z(sig2, ta2)
            # Ballenhoehe ueber Grund, in der Mitte des Schritts genommen
            zb = (z + dreh(*self.ballen, sig)[1] + z2 + dreh(*self.ballen, sig2)[1]) / 2
            zk = (z + z2) / 2
            x += (ta2 - ta) * zb + (sig2 - sig) * (zk - zb) - ZYKLUSWEG * STAND / n
            bahn[i] = (x, z2)
            sig, ta, z = sig2, ta2, z2
        # Den Standweg mittig unter die Huefte schieben, sonst schleppt er
        # ein Bein hinterher.
        mitte = (min(q[0] for q in bahn) + max(q[0] for q in bahn)) / 2
        return [(q[0] - mitte + ZENTRUM, q[1]) for q in bahn]

    def sohle_z(self, sigma, tau):
        """Tiefster Sohlenpunkt (relativ zum Knoechel).

        Alles hinter dem Ballen haengt am Fussknochen, alles davor am
        Zeh — und der dreht beim Abstoss GEGEN den Fuss. Wer die Zehen
        mit sigma statt mit tau dreht, misst einen Boden, den es nicht
        gibt.
        """
        b = dreh(*self.ballen, sigma)
        tief = 1.0
        for q in self.huelle:
            if q[0] <= self.ballen[0]:
                tief = min(tief, dreh(*q, sigma)[1])
            else:
                d = dreh(q[0] - self.ballen[0], q[1] - self.ballen[1], tau)
                tief = min(tief, b[1] + d[1])
        return tief

    def loese(self, huefte, ziel):
        """Welt-Drehwinkel fuer Ober- und Unterschenkel (Bogenmass).

        Zweigliedrige Umkehrkinematik in der Ebene. Das Knie zeigt nach
        VORN — deshalb phi = psi - alpha und nicht psi + alpha; mit dem
        anderen Vorzeichen knickte das Bein wie bei einem Vogel.
        """
        tx = ziel[0] - huefte[0]
        tz = ziel[1] - huefte[1]
        r = math.hypot(tx, tz)
        # Nie ganz durchgestreckt: Bei r = l1+l2 ist die Kniekehle steif,
        # und jeder Rundungsfehler laesst den Fuss durch den Boden
        # springen. 0,5 % Rest-Beugung kosten optisch nichts.
        rmax = self.reichweite * 0.995
        rmin = abs(self.l1 - self.l2) + 0.004
        r = max(rmin, min(rmax, r))
        psi = winkel(tx, tz)
        cos_a = (r * r + self.l1 * self.l1 - self.l2 * self.l2) / (2 * r * self.l1)
        alpha = math.acos(max(-1.0, min(1.0, cos_a)))
        w1 = psi - alpha
        kx = huefte[0] - math.sin(w1) * self.l1
        kz = huefte[1] - math.cos(w1) * self.l1
        w2 = winkel(ziel[0] - kx, ziel[1] - kz)
        return w1 - self.phi1, w2 - self.phi2


BEIN = {s: Bein(s) for s in ('r', 'l')}
PRUEF = {s: (0.0, 0.0) for s in ('r', 'l')}
for _s, _b in BEIN.items():
    print(f'BEIN {_s}: Oberschenkel {_b.l1:.4f} + Unterschenkel {_b.l2:.4f} '
          f'= {_b.reichweite:.4f} in der Gehebene ({_b.reichweite * SKALA:.2f} m), '
          f'Knoechel {-_b.sohle_z(0.0, 0.0):.4f} ueber der Sohle, '
          f'Sohle {_b.spitze[0] - _b.ferse[0]:.4f} lang, '
          f'Ballen bei {(_b.ballen[0] - _b.ferse[0]) / (_b.spitze[0] - _b.ferse[0]) * 100:.0f} %')
print(f'GANG: {ZYKLUSWEG:.4f} Zyklusweg = {ZYKLUSWEG * SKALA:.2f} m in {DAUER_WALK} s '
      f'bei {TEMPO} m/s, also {ZYKLUSWEG * SKALA / 2:.2f} m je Schritt; '
      f'Standphase {STAND * 100:.0f} %, Doppelstand {(2 * STAND - 1) * 100:.0f} %')


# ── idle: stehen, atmen, Gewicht verlagern ──────────────────────────
# Sparsam dosiert. Ein Koloss von neun Metern bewegt sich langsam und in
# kleinen WINKELN — sichtbar wird es durch die Hebel von selbst: zwei Grad
# an der Brust sind an der Schwertspitze schon ein halber Meter.
def idle_pose(p):
    s, c = math.sin(p), math.cos(p)
    s2 = math.sin(p * 2)
    w = arm.pose.bones['wurzel']
    # Atmen (zwei Zuege je Runde) und ein langsames Wiegen
    w.location = versatz(w, Vector((0.0, 0.004 * s, 0.0045 * s2))) * STAERKE
    setz('wurzel', (VOR, 0.8 * s))
    setz('bauch', (VOR, 0.7 * s), (QUER, -0.9 * s2))
    setz('brust', (QUER, -1.4 * s2), (VOR, 0.9 * s), (HOCH, -1.2 * s))
    # Der Kopf sieht sich um — andere Frequenz, sonst wirkt alles mechanisch
    setz('kopf', (HOCH, 3.0 * math.sin(p * 2 + 0.7)), (QUER, 1.6 * math.sin(p * 3 + 1.9)))
    # Arme haengen und pendeln kaum; das Schwert atmet mit dem Arm
    setz('arm_r', (QUER, 1.6 * s), (VOR, -0.8 * s))
    setz('hand_r', (QUER, 2.0 * math.sin(p + 0.5)))
    setz('schwert', (QUER, 1.4 * c))
    setz('arm_l', (QUER, -1.8 * s), (VOR, -1.0 * s))
    setz('hand_l', (QUER, 2.4 * math.sin(p + 0.6)))
    # Die Beine tragen nur; sie verlagern das Gewicht, sie gehen nicht.
    # Neu ist die GEGENDREHUNG im Knoechel: Ohne sie kippte die Sohle mit
    # dem Bein mit — bei 0,24 Sohlenlaenge heben 0,5 Grad die Zehe schon
    # zwei Zentimeter vom Boden. Mit dem Sprunggelenk kostet es eine Zeile.
    setz('bein_r', (QUER, 0.5 * s), (VOR, 0.4 * s))
    setz('fuss_r', (QUER, -0.5 * s))
    setz('bein_l', (QUER, -0.5 * s), (VOR, 0.4 * s))
    setz('fuss_l', (QUER, 0.5 * s))


# ── walk: Riesengang ────────────────────────────────────────────────
# Ein Zyklus = ZWEI Schritte in 3,4 Sekunden. Der Vorgaenger brauchte 2,6,
# und der Fuss rutschte dabei 1 bis 3,4 m/s. Dass es jetzt laenger dauert,
# ist keine Geschmacksentscheidung, sondern das Ergebnis von zwei
# Ungleichungen, die sich gegenseitig einklemmen.
#
# ── Warum nicht einfach weiter ausschreiten ──────────────────────────
# Der Server schiebt Surtr mit ROUTE_DEFAULT_SPEED = 1,5 m/s. Damit ist
# der Zyklusweg an die Zyklusdauer GEKETTET: 1,5 m/s * T. Wer laenger
# ausschreiten will, muss den Zyklus verlangsamen — oder das Tempo an
# Surtrs ROUTE heben, was hier bewusst nicht getan wird (der Vorgabewert
# gilt fuer alle NPCs, und die Route liegt in server/data/worldlayout.json).
#
# Nach oben begrenzt die BEINLAENGE. In der Gehebene misst das linke Bein
# 0,325 (Huefte -> Knoechel), das rechte 0,337; der Knoechel steht 0,090
# bis 0,095 ueber der Sohle. Damit der Standfuss den ganzen Weg am Boden
# bleibt, muss das Bein an beiden Enden der Standphase noch hinreichen:
#
#   halber Knoechelweg^2 + (Huefthoehe - Knoechelhoehe)^2 <= Beinlaenge^2
#
# Bei 60 % Standphase und abgesenktem Becken (0,402) laesst das einen
# Knoechelweg von rund 0,27 zu. Der Fussabrollvorgang schenkt noch einmal
# 0,07 dazu — beim Auftritt steht der Knoechel 0,083 vor der Ferse, beim
# Abstoss 0,019 hinter dem Ballen —, sodass der Zyklusweg auf 0,34 kommt,
# also 3,06 m Boden je Zyklus zuzueglich der 0,17 Fusslaenge, die das
# Abrollen ueberbrueckt. Das ergibt 5,10 m Zyklusweg = 2,55 m je Schritt.
#
#   1,5 m/s * T = 5,10 m   ->   T = 3,4 s
#
# ── Und warum das auch vom Takt her stimmt ──────────────────────────
# Ein Bein ist ein PHYSISCHES PENDEL. Fuer einen gleichmaessigen Stab der
# Laenge L ist die Schwingdauer eines Schritts pi*sqrt(2L/3g); bei
# L = 3,78 m (Huefte ueber Sohle, mal localScale 9) sind das 1,59 s je
# Schritt, also 3,18 s je Zyklus. 3,4 s liegen 7 % darueber — die Beine
# schwingen also nahezu frei. Die alten 2,6 s waren 18 % ZU SCHNELL: Er
# musste die Beine gegen die Schwerkraft vorwerfen, und genau das liest
# das Auge als "trippelt".
#
# Voellige dynamische Aehnlichkeit zum Menschen (Froude-Zahl 0,22 statt
# der jetzigen 0,06) verlangte 2,9 m/s und 5,9 m Zyklusweg bei nur 2,1 s.
# Das waere ein Tempo-Eintrag an seiner Route, kein Wert dieses Skripts —
# und der Zyklus hier passt dann nicht mehr. Deshalb steht die Rechnung
# oben ausdruecklich auf TEMPO: Wird die Route je schneller gestellt, ist
# `--tempo` mitzugeben, sonst rutscht der Fuss wieder.
#
# ── Was der Zyklus koennen muss ─────────────────────────────────────
# Gemessen wurde am Vorgaenger (tools/gang-diagnose.py, auf localScale 9):
# Sohle bis 17 cm UNTER dem Gelaende, 1 bis 3,4 m/s Rutschen im Stand,
# 22 bis 28 % Standphase, Sohlenneigung im Stand bis -26 Grad. Alle vier
# Zahlen haben dieselbe Ursache: zwei Knochen je Bein, kein Sprunggelenk.
#
# Die Kette hat jetzt vier Gelenke, und der Zyklus rechnet rueckwaerts —
# vom Bodenpunkt zum Knoechel zu den Winkeln (s. `bahn` und
# `stelle_bein`), statt Winkel zu setzen und zu hoffen.
def bahn(b, u):
    """Knoechel-Lage und Sohlen-/Zehenneigung eines Beins zur Phase u.

    u laeuft von 0 (Fersenauftritt) bis 1. Zurueck kommt (x, z, sigma,
    tau) in Modellmass bzw. Bogenmass: sigma ist die Neigung der Sohle,
    tau die des Zehenglieds — beide gegen die Ruhelage, + = Zehen nach
    unten.

    Die Standphase kommt fertig aus `Bein._standbahn` (dort steht, warum
    sie nicht rutschen kann). Hier bleibt die Schwungphase: Sie muss den
    Fuss nur wieder nach vorn bringen und ihm dabei Luft lassen.
    """
    if u < STAND:
        w = u / STAND * (len(b.stand) - 1)
        i = min(len(b.stand) - 2, int(w))
        f = w - i
        x = b.stand[i][0] + (b.stand[i + 1][0] - b.stand[i][0]) * f
        z = b.stand[i][1] + (b.stand[i + 1][1] - b.stand[i][1]) * f
        sigma, tau = neigungen(u / STAND)
        return x, z + BODENSPIEL[b.s], sigma, tau

    s = (u - STAND) / (1.0 - STAND)
    # 15 % linear beigemischt: Eine reine Smoothstep-Rampe steht an beiden
    # Enden still, waehrend der Standfuss mit voller Fahrt laeuft — das
    # liest sich als Stocken.
    x = b.stand[-1][0] + (b.stand[0][0] - b.stand[-1][0]) * (0.15 * s + 0.85 * glatt(s))
    sigma = math.radians(
        NEIGUNG_AB + (NEIGUNG_SCHWUNG - NEIGUNG_AB) * glatt(min(1.0, s / 0.30))
        + (NEIGUNG_AUF - NEIGUNG_SCHWUNG) * glatt(max(0.0, (s - 0.70) / 0.30)))
    # Die Zehen rollen aus der Abstossstellung zurueck in die Flucht des
    # Fusses.
    tau = sigma * glatt(min(1.0, s / 0.20))
    # Der Knoechel sitzt so hoch, dass der TIEFSTE Sohlenpunkt gerade den
    # Boden beruehrt, plus Freigang. Eine Bodendurchdringung ist damit
    # rechnerisch ausgeschlossen, nicht nur hoffentlich vermieden.
    #
    # Hoch mit einem STEILEN Anfang (Exponent unter 1), nicht mit einem
    # sanften Sinus: Ein Fuss loest sich beim Abstoss ruckartig vom Boden.
    # Mit dem glatten Sinus schleift die Sohle noch ein halbes Dutzend
    # Bilder knapp ueber dem Gelaende, waehrend sie schon nach vorn faehrt.
    z = -b.sohle_z(sigma, tau) + FREIGANG * math.sin(math.pi * s) ** 0.55
    return x, z + BODENSPIEL[b.s], sigma, tau


def walk_pose(p):
    u_r = (p / math.tau) % 1.0
    u_l = (u_r + 0.5) % 1.0
    s, c = math.sin(p), math.cos(p)

    # ── Rumpf zuerst ────────────────────────────────────────────────
    # Die Beine rechnen gleich mit der TATSAECHLICHEN Hueftlage, die von
    # Beckenhub und -drehung abhaengt. Also muss der Rumpf vorher stehen.
    #
    # Das Becken sitzt dauerhaft 0,018 tiefer als in der Ruhelage. Das ist
    # nachgerechnet, nicht Geschmack: Das LINKE Bein misst in der Gehebene
    # nur 0,325, der Knoechel steht 0,095 ueber der Sohle. Bei
    # Huefthoehe 0,420 muesste es sich also auf 0,325 durchstrecken, um
    # mit flachem Fuss zu stehen — also ganz steif, ohne jede Reserve.
    # 0,018 tiefer bleiben 97,5 % Streckung, und das Knie kann noch federn.
    hub = BECKEN_TIEF + BECKEN_HUB * math.cos(math.tau * 2 * (u_r - 0.30))
    w = arm.pose.bones['wurzel']
    w.location = versatz(w, Vector((0.0, 0.012 * s, hub)))
    setz('wurzel', (HOCH, 3.0 * s), (VOR, -2.5 * s))
    # Leichte Vorlage des Rumpfs: Wer neun Meter Masse in Gang haelt,
    # steht nicht senkrecht (-Grad um QUER = nach vorn).
    setz('bauch', (HOCH, -1.5 * s), (QUER, -2.5), (VOR, 1.2 * s))
    setz('brust', (HOCH, -3.5 * s), (QUER, -2.0 - 1.8 * math.cos(p * 2)), (VOR, 1.4 * s))
    setz('kopf', (HOCH, 2.0 * s), (QUER, 2.5 + 1.2 * math.cos(p * 2)))
    # Arme gegenlaeufig zum gleichseitigen Bein. Der Schwertarm schwingt
    # weniger — die Klinge wiegt, und ihre Spitze faehrt bei 0,34 Hebel
    # sonst durch den eigenen Oberschenkel.
    setz('arm_r', (QUER, -7.0 * s))
    setz('hand_r', (QUER, -4.0 * math.sin(p - 0.4)))
    setz('schwert', (QUER, 3.0 * s), (VOR, 2.0 * c))
    setz('arm_l', (QUER, 12.0 * s))
    setz('hand_l', (QUER, 6.0 * math.sin(p - 0.5) - 4.0))

    # ── und dann die Beine auf ihre Bahn ────────────────────────────
    for seite, u in (('r', u_r), ('l', u_l)):
        b = BEIN[seite]
        zx, zz, sigma, tau = bahn(b, u)
        stelle_bein(b, (zx, zz), sigma, tau)


def stelle_bein(b, ziel, sigma, tau):
    """Dreht die vier Gelenke, bis Knoechel und Sohle wirklich sitzen.

    Die Umkehrkinematik rechnet in der Gehebene und nimmt an, dass sich
    die Weltwinkel entlang der Kette einfach addieren. Das stimmt exakt,
    solange alles um QUER dreht — das Becken dreht aber zusaetzlich um
    HOCH und VOR, und daran haengt die Huefte. Statt diesen Rest
    abzuschaetzen, wird er GEMESSEN: Nach jedem Versuch liest die
    Schleife die tatsaechliche Knoechellage aus der ausgewerteten Pose und
    verschiebt das Ziel um den Fehler. Drei Durchgaenge bringen den
    Restfehler unter einen Zehntelmillimeter.
    """
    kopf = f'bein_{b.s}'
    knoechel = f'fuss_{b.s}'
    korr = (0.0, 0.0)
    for _ in range(3):
        huefte = eben(arm.pose.bones[kopf].matrix.translation)
        w1, w2 = b.loese(huefte, (ziel[0] + korr[0], ziel[1] + korr[1]))
        # Weltwinkel -> lokale Drehung: Was die Eltern schon mitbringen,
        # muss abgezogen werden.
        setz_roh(f'bein_{b.s}', math.degrees(w1))
        setz_roh(f'schien_{b.s}', math.degrees(w2 - w1))
        setz_roh(f'fuss_{b.s}', math.degrees(sigma - w2))
        setz_roh(f'zeh_{b.s}', math.degrees(tau - sigma))
        bpy.context.view_layer.update()
        ist = eben(arm.pose.bones[knoechel].matrix.translation)
        korr = (korr[0] + ziel[0] - ist[0], korr[1] + ziel[1] - ist[1])
    # Mitschreiben, was die Loesung gekostet hat: Wie weit war das Bein
    # gestreckt, und wie genau sitzt der Knoechel am Ende? Beides wird
    # nach dem Backen gedruckt — ein Zyklus, der still an die Streckgrenze
    # stoesst, sieht steif aus und faellt sonst niemandem auf.
    huefte = eben(arm.pose.bones[kopf].matrix.translation)
    streck = math.hypot(ziel[0] - huefte[0], ziel[1] - huefte[1]) / b.reichweite
    rest = math.hypot(ziel[0] - ist[0], ziel[1] - ist[1])
    PRUEF[b.s] = (max(PRUEF[b.s][0], streck), max(PRUEF[b.s][1], rest))


# ── attack: Schlag von oben auf einen Menschen ──────────────────────
# Er trifft etwas, das ihm bis ans Knie reicht. Der Schlag muss deshalb
# NACH UNTEN durchgehen und nicht waagerecht durchziehen: Am Ende steht
# die Klinge steil vor seinen Fuessen.
#
# ── Was hier zuerst falsch herum war ────────────────────────────────
# Arm und Klinge haben ENTGEGENGESETZTE Ruhelagen: Der Oberarm haengt
# nach unten, die Klinge steht nach vorn/unten aus der Faust. Dieselbe
# Drehung um QUER wirkt darum gegensaetzlich — sie schwingt den Arm nach
# HINTEN und kippt die Klinge nach UNTEN. Im ersten Durchlauf trug die
# ganze Kette dasselbe Vorzeichen; gemessen (tools-Probe an der
# Schwertspitze) endete der "Schlag" mit der Spitze auf z = 1,11, also
# ueber seinem eigenen Kopf. Ein Aufwaertshaken statt eines Hiebs.
#
# Richtig ist ein Bogen ueber die Schulter: Ausholen mit GROSSEM PLUS
# (Arm nach hinten-oben, Klinge hinter den Kopf), Schlag zurueck bis
# knapp hinter die Ruhelage — und dort kippt zusaetzlich die KLINGE nach
# unten, damit die Spitze am Ende vor seinen Fuessen steht statt vor
# seinem Bauch.
#
# Der Bogen kommt aus DREI Gelenken statt aus einem. Eine Huelle vertraegt
# keine 160 Grad an einer Schulter — der Schulterfels kollabiert dann zur
# Tuete. Rumpf, Schulter, Ellbogen und Klinge teilen sich den Weg.
#
# Der Zeitplan (Phase 0..1, 2,6 s):
#   0,00-0,14  Ruhe     — der Clip beginnt und endet in der Idle-Haltung
#   0,14-0,44  Ausholen — Klinge hinter die Schulter, Gewicht nach hinten
#   0,44-0,62  Schlag   — der ganze Oberkoerper faellt nach vorn
#   0,62-0,78  Treffer  — kurzes Nachfedern, kein sauberes Anhalten
#   0,78-1,00  Zurueck  — aufrichten in die Ruhehaltung
#
# Die Ruhephasen am Anfang UND am Ende sind Absicht: Der Client startet
# jede Gruppe in Schleife (AssetManager.wechsleAnimation ruft start(true)),
# der Clip laeuft also vorerst rund. Mit Ruhe an beiden Enden liest sich
# das als "schlagen, ausholen, schlagen" statt als Zuckung.
def _rampe(p, a, b):
    """0 vor a, 1 nach b, weich dazwischen."""
    return glatt((p - a) / (b - a)) if b > a else (1.0 if p >= b else 0.0)


def attack_pose(p):
    # aus = 1 im Ausholen, schlag = 1 nach dem Durchschlagen
    aus = _rampe(p, 0.14, 0.44) * (1.0 - _rampe(p, 0.44, 0.62))
    schlag = _rampe(p, 0.44, 0.62) * (1.0 - _rampe(p, 0.78, 1.00))
    # Nachfedern nach dem Treffer: eine gedaempfte Schwingung
    federn = (math.sin((p - 0.62) * math.tau * 2.2) * math.exp(-(p - 0.62) * 9.0)
              if 0.62 <= p < 0.92 else 0.0)

    w = arm.pose.bones['wurzel']
    # Gewicht zurueck beim Ausholen, Ausfall nach vorn beim Schlag.
    # AUSDRUECKLICH ohne Absacken: Die Beine koennen nicht kuerzer werden,
    # ein tieferes Becken zieht die Fuesse mit unter das Gelaende.
    # Das -0,016 beim Schlag ist NACHGEMESSEN, nicht Geschmack: Die
    # Ausfallschritt-Winkel heben beide Fuesse vom Boden ab (ein Bein wird
    # beim Drehen um die Huefte kuerzer, nicht laenger). Ohne die
    # Absenkung schwebt er im Treffer.
    #
    # Frueher stand hier -0,025. Seit der Fuss ein eigenes Gelenk hat und
    # die Sohle waagerecht gehalten wird, senkt sich die Figur weniger
    # tief in ihre eigenen Beine — gemessen sank die Sohle mit dem alten
    # Wert 17 cm unter das Gelaende.
    w.location = versatz(w, Vector((0.030 * schlag - 0.014 * aus, 0.0,
                                    -0.016 * schlag))) * STAERKE
    setz('wurzel', (QUER, 7.0 * aus - 6.0 * schlag), (HOCH, -10.0 * aus + 8.0 * schlag))
    setz('bauch', (QUER, 9.0 * aus - 9.0 * schlag + 2.0 * federn),
         (HOCH, -9.0 * aus + 9.0 * schlag))
    setz('brust', (QUER, 22.0 * aus - 14.0 * schlag + 3.0 * federn),
         (HOCH, -15.0 * aus + 17.0 * schlag), (VOR, -6.0 * aus + 4.0 * schlag))
    # Der Kopf sieht dem Schlag nach — auf das, was unten steht
    setz('kopf', (QUER, -8.0 * aus - 18.0 * schlag), (HOCH, 8.0 * aus - 10.0 * schlag))

    # Schwertarm. +QUER = nach hinten/oben ueber die Schulter.
    setz('arm_r', (QUER, 62.0 * aus + 8.0 * schlag + 3.0 * federn),
         (VOR, -14.0 * aus + 8.0 * schlag), (HOCH, 12.0 * aus - 14.0 * schlag))
    setz('hand_r', (QUER, 58.0 * aus - 6.0 * schlag + 4.0 * federn))
    # Und die Klinge kippt beim Durchschlagen zusaetzlich nach unten —
    # das ist der Unterschied zwischen "haelt das Schwert vor sich" und
    # "hat gerade etwas in den Boden geschlagen".
    setz('schwert', (QUER, 20.0 * aus + 60.0 * schlag + 4.0 * federn))
    # Der freie Arm balanciert gegen: beim Ausholen nach vorn, beim Schlag
    # nach hinten. Ohne ihn kippt die Figur optisch aus dem Bild.
    setz('arm_l', (QUER, -22.0 * aus + 24.0 * schlag), (VOR, 10.0 * aus - 6.0 * schlag))
    setz('hand_l', (QUER, -14.0 * aus + 10.0 * schlag - 4.0))

    # Ausfallschritt: das rechte Bein stemmt hinten, das linke nimmt vorn
    # den Stoss auf.
    #
    # Diese Winkel standen frueher auf `fuss_*` — das hiess damals
    # UNTERSCHENKEL. Sie gehoeren jetzt auf `schien_*`; `fuss_*` ist ein
    # echter Fuss geworden. Und weil der Fuss nun ein eigenes Gelenk hat,
    # bekommt er die SUMME der Beinwinkel mit umgekehrtem Vorzeichen:
    # Damit bleibt die Sohle waagerecht, statt mit dem Schienbein
    # wegzukippen. Nur die Ferse des hinteren Beins darf sich beim
    # Durchschlagen loesen — wer sich in den Boden stemmt, steht am Ende
    # auf dem Ballen.
    r_ober = 9.0 * aus + 6.0 * schlag
    r_unter = -5.0 * aus + 9.0 * schlag
    l_ober = -4.0 * aus - 12.0 * schlag
    l_unter = 7.0 * aus + 14.0 * schlag
    setz('bein_r', (QUER, r_ober))
    setz('schien_r', (QUER, r_unter))
    setz('fuss_r', (QUER, -(r_ober + r_unter) + 10.0 * schlag))
    setz('zeh_r', (QUER, -10.0 * schlag))
    setz('bein_l', (QUER, l_ober))
    setz('schien_l', (QUER, l_unter))
    setz('fuss_l', (QUER, -(l_ober + l_unter)))


aktion('idle', DAUER_IDLE, idle_pose)
aktion('walk', DAUER_WALK, walk_pose)


def tiefste_sohle(nur_flach=False):
    """Tiefster Punkt der VERFORMTEN Sohle, JE FUSS, ueber den Zyklus.

    Je Fuss, nicht gemeinsam: Die beiden Fuesse knicken unterschiedlich
    stark ein. Wer beide um den schlechteren Wert anhebt, laesst den
    besseren schweben.

    `nur_flach` beschraenkt die Messung auf den Abschnitt, in dem die
    Sohle FLACH auf dem Boden liegen soll. Nur der wird ausgeregelt: Beim
    Fersenauftritt und beim Abstoss knickt die Haut an Knoechel und Ballen
    unvermeidlich ein paar Millimeter nach innen (lineare
    Knochenmischung), und diese kurzen Spitzen mit einem dauerhaften
    Anheben zu erschlagen hiesse, die Figur den ganzen Schritt lang
    schweben zu lassen — sichtbar an der Schattenfuge, waehrend die Spitze
    selbst im Gras verschwindet.
    """
    idx = {s: [i for i, v in enumerate(welt)
               if v.z < 0.06 and YBAND[s][0] <= v.y <= YBAND[s][1]]
           for s in BEIN}
    tief = {s: 1.0 for s in BEIN}
    n = szene.frame_end - szene.frame_start
    for f in range(szene.frame_start, szene.frame_end + 1):
        szene.frame_set(f)
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        m = ev.to_mesh()
        u_r = (f - szene.frame_start) / n
        for s, ii in idx.items():
            u = u_r if s == 'r' else (u_r + 0.5) % 1.0
            if nur_flach and not (ROLL_FERSE * STAND <= u < ROLL_BALLEN * STAND):
                continue
            tief[s] = min(tief[s], min(m.vertices[i].co.z for i in ii))
        ev.to_mesh_clear()
    return tief


_flach = tiefste_sohle(nur_flach=True)
print('GANG: flach aufliegende Sohle im ersten Durchgang ' +
      ', '.join(f'{s} {v:+.4f} ({v * SKALA:+.2f} m)' for s, v in _flach.items()))
if any(abs(v) > 0.0002 for v in _flach.values()):
    # Nachbacken mit ausgeregeltem Zyklus. Ein Durchgang genuegt: Die
    # Verformung haengt an den Gelenkwinkeln, und die aendern sich durch
    # ein paar Millimeter Hoehe praktisch nicht.
    for _s, _v in _flach.items():
        BODENSPIEL[_s] = -_v
    bpy.data.actions.remove(bpy.data.actions['walk'])
    aktion('walk', DAUER_WALK, walk_pose)
    _flach = tiefste_sohle(nur_flach=True)
print('GANG: Ausgleich ' + ', '.join(f'{s} {v:+.4f}' for s, v in BODENSPIEL.items()) +
      ' — flache Sohle jetzt ' +
      ', '.join(f'{s} {v:+.4f} ({v * SKALA:+.2f} m)' for s, v in _flach.items()))
_alles = tiefste_sohle()
print('GANG: tiefster Punkt ueber den GANZEN Zyklus (Spitzen beim Auftritt '
      'und Abstoss) ' +
      ', '.join(f'{s} {v:+.4f} ({v * SKALA:+.2f} m)' for s, v in _alles.items()))
for _s, (_streck, _rest) in PRUEF.items():
    print(f'GANG {_s}: Bein hoechstens zu {_streck * 100:.1f} % gestreckt, '
          f'Knoechel-Restfehler {_rest * SKALA * 1000:.2f} mm im Spielmassstab')
aktion('attack', DAUER_ATTACK, attack_pose, schleife=False)

# Ruhepose fuer den Export-Rest
szene.frame_set(1)
bpy.ops.object.mode_set(mode='OBJECT')

# ── Blickrichtung auf die Engine-Konvention drehen ──────────────────
# Die Engine dreht eine laufende Figur um die Hochachse mit
# yaw = atan2(dx, dz) (shared/worldlayout/routenlauf.ts) — vorn ist also
# die +Z-Achse des Babylon-Raums.
#
# Welche Blender-Achse das ist, wurde NICHT hergeleitet, sondern an den
# beiden Modellen abgelesen, die im Spiel nachweislich richtig herum
# laufen: npc_1_walk.glb (Valheim-Export, Animation "Walking") und
# Voelva.glb (nach ihrer Korrektur). Beide schauen im importierten
# Blender-Raum nach -Y. Surtr schaut nach +X (Gesicht, Bart und Zehen
# liegen dort). Von +X nach -Y sind es -90 Grad um die HOCHACHSE Z.
#
# Um Z, nicht um Y: Y ist hier waagerecht, eine Drehung darum legt die
# Figur schlicht um.
BLICK_DREHUNG = math.radians(-90.0)
for o in (arm, mesh):
    o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                        o.rotation_euler[2] + BLICK_DREHUNG)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

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
