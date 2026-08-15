#!/usr/bin/env blender --background --python
"""
Riggt die Voelva (Tripo-Figur, Seherin mit Stab) und legt ihr zwei
Animationen an: "idle" und "walk".

    blender --background --python tools/voelva-rig.py -- \
        --glb assets/models/Voelva.glb [--out ...] [--staerke 1.0]

── Warum kein Rigify ────────────────────────────────────────────────
Rigify liegt in dieser Blender-Installation bei (deaktiviert), traegt hier
aber nicht, und zwar aus drei nachgemessenen Gruenden:

1. Das Mesh ist kein Koerper, sondern eine Huelle. Unter dem bodenlangen
   Gewand gibt es KEINE getrennten Beine — der Querschnitt bei z = 0,15
   ist ein durchgehender Kegel ohne Luecke in der Mitte (gemessen: kein
   leeres Histogrammfach zwischen den Haelften). Ein humanoides Meta-Rig
   setzt Ober-/Unterschenkel voraus, die es hier nicht gibt.
2. Das Mesh ist topologisch zerschnitten: 258 Zusammenhangskomponenten
   auf 8154 Vertices, weil Tripo an jeder UV-Naht doppelt aufmacht.
   Blenders "Automatic Weights" (Bone Heat) braucht eine
   zusammenhaengende, mannigfaltige Flaeche; auf 258 Inseln liefert es
   entweder einen Fehler oder pro Insel geratene Gewichte — und genau
   dort reisst das Modell dann auf. Dieselbe Lektion steht schon im Kopf
   von tools/rig-idle.py.
3. Der Stab ist mit dem Mesh verschmolzen und steht auf dem Boden. Jedes
   Preset-Retargeting schwingt den Arm und zieht den Stab mit — 1 m
   Hebel an einer 1 m hohen Figur.

── Was stattdessen traegt ───────────────────────────────────────────
Der Weg aus rig-idle.py, erweitert: eigene Knochenkette, Gewichte aus der
GEOMETRIE statt aus Bone Heat. Zwei Dinge sind gegenueber Surtr neu:

* Die Gewichte sind eine stetige Funktion der POSITION (Abstand zum
  Knochensegment, kompakter Kern mit endlicher Reichweite). Stetig in
  der Position heisst: die an den UV-Naehten verdoppelten Vertices
  liegen aufeinander und bekommen deshalb IDENTISCHE Gewichte. Die 258
  Inseln koennen prinzipbedingt nicht auseinanderklaffen.
* Der Stab bekommt eine eigene Maske (Zylinder um die gemessene
  Stabachse) und einen eigenen Knochen, dessen KOPF im Griff sitzt.
  Damit dreht sich der Stab in der Hand statt die Hand am Stab zu
  zerren; der Stabarm haengt starr an der Wurzel, der Griffpunkt bewegt
  sich also nie relativ zum Stab.

Beine gibt es trotzdem — nicht als Anatomie, sondern als zwei Knochen im
Rockinneren mit weichem seitlichem Uebergang. Der Saum schwingt dann
abwechselnd, so wie Stoff ueber schreitenden Beinen. Das ist alles, was
eine bodenlange Kutte hergibt, und es kann nicht zerreissen.

Alle Knochenpunkte sind an der Figur abgemessen (orthografische Front-
und Seitenansicht, 600 px = 1,15 Einheiten): Figur 1,0 hoch, Blick nach
+x, Seitenachse y, Schulter z = 0,79, Guertel z = 0,61, Huefte z = 0,52,
Stabgriff (0,17 / -0,20 / 0,665), Stabspitze (0,157 / -0,189 / 0,0).
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
DAUER_IDLE = float(arg('--idle-dauer', '5.0'))
DAUER_WALK = float(arg('--walk-dauer', '1.0'))
FPS = 30
if not GLB:
    raise SystemExit('--glb fehlt')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFAD = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)
ZIEL = PFAD if not OUT else (OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT))

# ── Skelett ─────────────────────────────────────────────────────────
# (Name, Kopf, Spitze, Eltern, verbunden, Reichweite, Staerke)
# Reichweite = Radius, ab dem der Knochen keinen Vertex mehr zieht;
# Staerke = wie stark er sich innerhalb davon gegen die Nachbarn durchsetzt.
# Beides gross bei den Armen: nicht damit sie viel Stoff GREIFEN, sondern
# damit der Uebergang zum Rock ueber zehn Zentimeter laeuft statt ueber
# fuenf Millimeter. Wo zwei Knochen gegenlaeufig schwingen, entscheidet
# allein die BREITE des Uebergangs darueber, ob die Haut schert oder reisst.
X0, Y0 = 0.008, -0.016          # Koerperachse
KNOCHEN = [
    ('wurzel', (X0, Y0, 0.520), (X0, Y0, 0.600), None,     False, 0.34, 1.0),
    ('bauch',  (X0, Y0, 0.600), (X0, Y0, 0.700), 'wurzel', True,  0.30, 1.0),
    ('brust',  (X0, Y0, 0.700), (X0 + 0.004, Y0 - 0.002, 0.815), 'bauch', True, 0.30, 1.0),
    ('kopf',   (X0 + 0.004, Y0 - 0.002, 0.815), (0.030, Y0 - 0.002, 0.975),
     'brust', True, 0.20, 1.0),

    # freier Arm (ihre linke Seite, +y) — schwingt beim Gehen.
    # Grosse Reichweite bei kleinem Einfluss: Die Hand haengt nur zwei
    # Zentimeter neben dem Rock, und Arm und gleichseitiges Bein schwingen
    # GEGENLAEUFIG. Eine enge Reichweite laesst das Gewicht auf wenigen
    # Millimetern von der Hand aufs Bein kippen — genau dort scherte die
    # Haut im ersten Durchlauf um 0,09 (9 % der Figurhoehe). Weit und weich
    # verteilt dieselbe Differenz ueber gut zehn Zentimeter Stoff.
    ('arm_l',  (-0.005, 0.100, 0.790), (0.005, 0.120, 0.615), 'brust', False, 0.22, 1.3),
    ('hand_l', (0.005, 0.120, 0.615), (0.022, 0.126, 0.455), 'arm_l', True, 0.22, 1.3),

    # Stabarm (ihre rechte Seite, -y) — haengt an der WURZEL, nicht an der
    # Brust: so bleibt der Griffpunkt relativ zum Stab in Ruhe.
    ('arm_r',  (-0.005, -0.100, 0.790), (0.150, -0.196, 0.672), 'wurzel', False, 0.20, 1.3),

    # Stab: Kopf im GRIFF, Spitze am Boden. Drehung pivotiert damit in der
    # Hand — der Stab wird gesetzt, nicht geschleudert.
    ('stab',   (0.170, -0.200, 0.665), (0.157, -0.189, 0.005), 'wurzel', False, 0.0, 0.0),

    # "Beine" im Rockinneren
    ('bein_l', (X0, Y0 + 0.055, 0.520), (X0, Y0 + 0.058, 0.270), 'wurzel', False, 0.30, 1.0),
    ('fuss_l', (X0, Y0 + 0.058, 0.270), (X0 + 0.028, Y0 + 0.060, 0.020), 'bein_l', True, 0.28, 1.0),
    ('bein_r', (X0, Y0 - 0.055, 0.520), (X0, Y0 - 0.058, 0.270), 'wurzel', False, 0.30, 1.0),
    ('fuss_r', (X0, Y0 - 0.058, 0.270), (X0 + 0.028, Y0 - 0.060, 0.020), 'bein_r', True, 0.28, 1.0),
]

# Gemessene Stabachse (unten -> oben), Zylindermaske
STAB_UNTEN = Vector((0.157, -0.189, 0.000))
STAB_OBEN = Vector((0.194, -0.219, 1.000))

# ── Modell laden ────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

# Frueheres Rig restlos entfernen — sonst haengen zwei Skelette und alte
# Actions im Export. Die Weltlage des Meshes muss dabei erhalten bleiben.
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
print(f'MODELL {mesh.name}: {len(welt)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, Höhe {hoehe:.3f}')

# ── Armature ────────────────────────────────────────────────────────
arm_data = bpy.data.armatures.new('voelva_rig')
arm = bpy.data.objects.new('voelva_rig', arm_data)
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
# Erst die Stabmaske, dann fuer alles uebrige ein kompakter Kern um jedes
# Knochensegment. Beides haengt NUR von der Position ab — deshalb kann
# keine UV-Naht aufreissen.
def stab_maske(p):
    """1 innerhalb des Stabs, 0 ausserhalb, weicher Rand dazwischen.

    Der Radius folgt dem GEMESSENEN Stabquerschnitt: unten ist er ein
    duenner Schaft (rmax 0,015), auf Griffhoehe umschliesst ihn die Faust
    (0,039), oben traegt er den geschmiedeten Ring (0,069).

    Eng bleiben muss er vor allem unten. Der Saum schwingt dort waehrend
    des Gehens am weitesten, der Stab steht dagegen fast still — ein
    breiter Uebergangsrand faengt Saumvertices ein und zerrt sie gegen
    ihre Nachbarn. Gemessen waren das 0,036 Verschiebung auf einer 5 mm
    langen Kante, bevor der Rand von 0,075 auf 0,043 gekuerzt wurde."""
    d = abstand_segment(p, STAB_UNTEN, STAB_OBEN)
    voll = (0.026
            + 0.024 * glatt((p.z - 0.50) / 0.12)     # Faust am Griff
            + 0.025 * glatt((p.z - 0.78) / 0.20))    # Ring an der Spitze
    null = voll * 1.35 + 0.008
    return 1.0 - glatt((d - voll) / (null - voll))


ENVELOPE = [n for n, *_ in KNOCHEN if n != 'stab']
ARME = ('arm_l', 'hand_l', 'arm_r')
gruppen = {n: mesh.vertex_groups.new(name=n) for n, *_ in KNOCHEN}


def huelle(p):
    """Kompakter Kern um jedes Knochensegment, auf Summe 1 normiert."""
    roh = []
    for n in ENVELOPE:
        d = abstand_segment(p, *SEGMENTE[n])
        u = d / REICHWEITE[n]
        if u >= 1.0:
            continue
        # Faellt am Rand der Reichweite stetig auf 0 und ist nah am
        # Knochen stark. (1-u)^3 sorgt fuer den sauberen Nullabschluss.
        roh.append((n, BEINFLUSS[n] * (1.0 - u) ** 3 / (u * u + 0.02)))
    if not roh:
        # Kein Knochen in Reichweite (der weit hinten liegende Saum des
        # Umhangs) — an den naechsten Knochen haengen, damit kein Vertex
        # ungebunden bleibt und im Client auf den Ursprung faellt.
        n = min(ENVELOPE, key=lambda k: abstand_segment(p, *SEGMENTE[k]))
        roh = [(n, 1.0)]
    s = sum(w for _n, w in roh)
    return {n: w / s for n, w in roh}


def rock(p):
    """Gewichte im Rockinneren: senkrecht zwischen Ober- und Unterbein,
    seitlich zwischen linkem und rechtem Bein.

    Die reine Abstandshuelle taugt hier nicht: unter dem bodenlangen
    Gewand sind beide Beinknochen fast gleich weit vom Saum entfernt,
    ihre gegenlaeufigen Drehungen heben sich auf und der Saum steht
    still. Ein ausdruecklicher SEITLICHER Auftrag trennt die beiden
    Haelften — und bleibt trotzdem eine stetige Funktion von y, kann
    also nichts aufreissen.

    Der Uebergang wird nach UNTEN hin breiter. Oben, wo im Stoff wirklich
    zwei Beine stecken, darf er schmal sein; unten ist der Saum ein
    geschlossener Ring, und die beiden gegenlaeufigen Beine liegen dort am
    weitesten auseinander (Hebel 0,52 von der Huefte). Ein schmaler
    Uebergang presste diese Differenz auf wenige Zentimeter Saum — gemessen
    0,116 Verschiebung ueber eine 0,046 lange Kante. Breit verteilt bleibt
    der Ring zusammen und nur seine AUSSENkanten schwingen mit."""
    t = glatt((p.z - 0.16) / 0.20)               # 1 = Oberbein, 0 = Fuss
    breite = 0.15 + 0.45 * (1.0 - glatt(p.z / 0.20))
    lam = glatt((p.y - (Y0 - breite / 2)) / breite)   # 1 = ihre linke Seite
    return {'bein_l': t * lam, 'bein_r': t * (1 - lam),
            'fuss_l': (1 - t) * lam, 'fuss_r': (1 - t) * (1 - lam)}


stab_verts = 0
stab_rand = 0
for i, p in enumerate(welt):
    m = stab_maske(p)
    if m > 0.001:
        stab_rand += 1
    if m > 0.999:
        gruppen['stab'].add([i], 1.0, 'REPLACE')
        stab_verts += 1
        continue

    w = huelle(p)
    # Unterhalb der Huefte uebernimmt die Rockaufteilung — ausser dort, wo
    # ein Arm in der Naehe ist (die freie Hand haengt bis z = 0,455 herab
    # und darf nicht ans Bein geraten).
    arm_anteil = sum(w.get(n, 0.0) for n in ARME)
    unten = (1.0 - glatt((p.z - 0.44) / 0.12)) * (1.0 - arm_anteil)
    if unten > 0.001:
        r = rock(p)
        w = {n: (1 - unten) * w.get(n, 0.0) + unten * r.get(n, 0.0)
             for n in set(w) | set(r)}

    roh = sorted(((n, x) for n, x in w.items() if x > 1e-4), key=lambda t: -t[1])[:4]
    summe = sum(x for _n, x in roh)             # glTF: 4 Joints je Vertex
    for n, x in roh:
        gruppen[n].add([i], (x / summe) * (1.0 - m), 'REPLACE')
    if m > 0.001:
        gruppen['stab'].add([i], m, 'REPLACE')

print(f'GEWICHTE: {stab_verts} Vertices voll am Stab, {stab_rand - stab_verts} im '
      f'Uebergangsrand, Rest ueber Kern + Rockaufteilung')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mesh.parent = arm

# ── Posieren: Drehungen um WELTACHSEN ───────────────────────────────
# bone.matrix_local bildet Knochenraum -> Armature-Raum ab; die Armature
# steht auf dem Ursprung, Armature-Raum ist also Weltraum. Damit laesst
# sich eine Weltachse sauber in den lokalen Raum eines Knochens holen —
# ohne Raterei ueber Bone-Rolls.
HOCH = Vector((0, 0, 1))      # Gierachse
QUER = Vector((0, 1, 0))      # Seitenachse: Vor-/Zurueckschwingen
VOR = Vector((1, 0, 0))       # Blickachse: seitliches Wiegen


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


def aktion(name, dauer, pose_fn):
    """Backt eine Aktion. Frame 1..N+1, wobei N+1 die Kopie von Frame 1
    ist — dann schliesst die Schleife im Client ohne Sprung."""
    frames = int(round(dauer * FPS))
    arm.animation_data_create()
    akt = bpy.data.actions.new(name)
    akt.use_fake_user = True
    arm.animation_data.action = akt
    szene.frame_start = 1
    szene.frame_end = frames + 1
    for f in range(1, frames + 2):
        phase = ((f - 1) % frames) / frames * math.tau
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


# ── idle: Stehen, Atmen, Gewicht verlagern ──────────────────────────
def idle_pose(p):
    s, s2 = math.sin(p), math.sin(p * 2)
    c = math.cos(p)
    # Atmen (2 Zyklen je Runde) und ein langsames Wiegen (1 Zyklus)
    w = arm.pose.bones['wurzel']
    w.location = versatz(w, Vector((0.0, 0.004 * s, 0.0035 * s2))) * STAERKE
    setz('wurzel', (VOR, 0.9 * s), (HOCH, 1.1 * s))
    setz('bauch', (VOR, 0.7 * s), (QUER, 0.6 * s2))
    setz('brust', (QUER, -1.1 * s2), (VOR, 0.8 * s), (HOCH, -1.4 * s))
    # Der Kopf schaut sich um: andere Frequenz, damit es nicht mechanisch wirkt
    setz('kopf', (HOCH, 3.2 * math.sin(p * 2 + 0.7)), (QUER, 1.4 * math.sin(p * 3 + 1.9)))
    setz('arm_l', (QUER, 1.8 * s), (VOR, -1.2 * s))
    setz('hand_l', (QUER, 2.2 * math.sin(p + 0.6)))
    setz('arm_r', (QUER, 0.6 * s))
    # Der Stab steht: nur ein Hauch Wippen, sonst rutscht die Spitze
    setz('stab', (QUER, 0.5 * c))
    setz('bein_l', (QUER, 0.6 * s))
    setz('bein_r', (QUER, -0.6 * s))


# ── walk: Schrittzyklus, Arme gegenlaeufig zu den Beinen ────────────
def walk_pose(p):
    s, c = math.sin(p), math.cos(p)
    # Beine gegenlaeufig. +Grad um QUER = Bein nach HINTEN (Rechte-Hand-
    # Regel um +y zieht die -z-Richtung nach -x, und die Figur schaut +x).
    setz('bein_l', (QUER, 15.0 * s))
    setz('bein_r', (QUER, -15.0 * s))
    # Knie beugt sich in der Schwungphase (Bein kommt nach vorn)
    setz('fuss_l', (QUER, 12.0 * (0.5 - 0.5 * c)))
    setz('fuss_r', (QUER, 12.0 * (0.5 + 0.5 * c)))
    # Becken: hebt und senkt sich ZWEIMAL je Schritt (Hochachse z, doppelte
    # Frequenz), wiegt EINMAL zur Seite (Querachse y, einfache Frequenz).
    w = arm.pose.bones['wurzel']
    w.location = versatz(w, Vector((0.0, 0.010 * s, -0.009 * math.cos(p * 2)))) * STAERKE
    setz('wurzel', (HOCH, 3.5 * s), (VOR, -2.2 * s))
    setz('bauch', (HOCH, -1.5 * s), (VOR, 1.0 * s))
    # Schultern drehen gegen die Huefte
    setz('brust', (HOCH, -4.0 * s), (QUER, -1.5 * math.cos(p * 2)), (VOR, 1.2 * s))
    setz('kopf', (HOCH, 2.0 * s), (QUER, 1.0 * math.cos(p * 2)))
    # Freier Arm gegenlaeufig zum gleichseitigen Bein. Bewusst verhalten:
    # Die Hand haengt nur zwei Zentimeter neben dem Rock, und je weiter sie
    # gegen ihn anschwingt, desto mehr Stoff muss die Differenz aufnehmen.
    # Eine Greisin am Stab schlenkert ohnehin nicht.
    setz('arm_l', (QUER, -12.0 * s))
    setz('hand_l', (QUER, -6.0 * math.sin(p - 0.5) - 5.0))
    # Der Stabarm haengt starr; nur der Stab kippt im Griff — Spitze nach
    # vorn, wenn das linke Bein nach vorn geht (Stab und Gegenbein setzen
    # zusammen auf). Der Ausschlag ist so gewaehlt, dass die Spitze
    # ungefaehr so weit wandert wie der Saum daneben (10 Grad bei 0,66
    # Hebel = 0,115): Sonst schneidet der schwingende Stoff durch das Holz.
    setz('stab', (QUER, 10.0 * s), (VOR, 1.5 * c))


aktion('idle', DAUER_IDLE, idle_pose)
aktion('walk', DAUER_WALK, walk_pose)

# Ruhepose fuer den Export-Rest
szene.frame_set(1)
bpy.ops.object.mode_set(mode='OBJECT')

# ── Export ──────────────────────────────────────────────────────────
# export_animation_mode='ACTIONS' schreibt JEDE Action als eigene
# glTF-Animation unter ihrem Action-Namen. export_frame_range muss dabei
# AUS sein, sonst schneidet der Szenenbereich (1..151) die kurze
# Walk-Aktion nicht ab, aber die Idle-Aktion wuerde bei einem anderen
# Szenenbereich verlieren — jede Aktion soll ihren eigenen Bereich haben.
# ── Blickrichtung auf die Engine-Konvention drehen ──────────────────
# Das Tripo-Modell schaut in seinem eigenen Raum nach +X. Die Engine dreht
# eine laufende Figur ueber den Yaw-Winkel der Bewegungsrichtung und setzt
# dabei -Z als Blickrichtung voraus (so wie NPC_1). Ohne Korrektur laeuft
# die Voelva deshalb SEITWAERTS — im Spiel gemeldet.
#
# Gedreht wird um Blenders HOCHACHSE Z, nicht um Y — Y ist hier waagerecht,
# eine Drehung darum legt die Figur schlicht um (gemessen: Hoehe fiel von
# 1,00 auf 0,44).
#
# Das Vorzeichen ist AM LAUFENDEN SPIEL bestimmt, nicht hergeleitet: Ohne
# Drehung lief sie seitwaerts, mit +90 Grad rueckwaerts — also -90 Grad.
# (Die Herleitung ueber die Achsenabbildung haette das Vorzeichen nur
# geraten, weil unklar bleibt, ob die Figur nach +X oder -X blickt und ob
# die Engine -Z oder +Z als vorn nimmt. Zwei Unbekannte, ein Versuch.)
BLICK_DREHUNG = math.radians(-90.0)
for o in (arm, mesh):
    o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                        o.rotation_euler[2] + BLICK_DREHUNG)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

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
print(f'FERTIG {ZIEL} — {len(KNOCHEN)} Knochen, Aktionen "idle" und "walk", '
      f'{os.path.getsize(ZIEL)/1e6:.2f} MB')
