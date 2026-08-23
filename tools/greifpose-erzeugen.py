#!/usr/bin/env blender --background --python
"""
Baut die Greifpose der rechten Hand und zeigt sie mit dem Messer darin.

    blender --background --python tools/greifpose-erzeugen.py -- \
        [--beugung 55,65,50] [--daumen 30,40,30] [--ohne-messer] \
        [--blend /home/mike/.../greifpose.blend]

════════════════════════════════════════════════════════════════════
 Warum es diese Pose braucht
════════════════════════════════════════════════════════════════════
Die Figur hat eine OFFENE Hand in der Ruhepose. Ein Messer darin sieht
aus wie angeklebt: Der Griff verschwindet im Handnetz, statt umfasst zu
werden. Das faellt bei jedem Werkzeug an, nicht nur beim Messer.

════════════════════════════════════════════════════════════════════
 Die Beugeachse ist gemessen, nicht geraten
════════════════════════════════════════════════════════════════════
Ein Finger beugt sich um die Achse senkrecht zu Knochenrichtung und
Handflaeche. Das Kreuzprodukt aus beidem,

    (-0.426,-0.348,-0.835) x (0.827,-0.382,-0.413) = (-0.175,-0.866,0.451)

trifft die lokale X-Achse von R_Index01 (-0.176,-0.873,0.454) auf drei
Nachkommastellen. Gebeugt wird also um die lokale X, und POSITIV, weil
Blenders Drehung um X die Knochenrichtung (+Y) nach +Z fuehrt — und +Z
zeigt bei diesen Knochen zur Handflaeche.

Die Hand hat nur DREI Ketten: Zeigefinger, Ringfinger, Daumen. Der
Ringfinger vertritt Mittel-, Ring- und kleinen Finger.

════════════════════════════════════════════════════════════════════
 Wie weit die Beugung traegt — und warum nicht weiter
════════════════════════════════════════════════════════════════════
Die Vorgabewerte sind nicht "schoen genug", sondern die GRENZE des Rigs.
Darueber zerreisst das Handnetz in Splitter. Nachgemessen an der Figur:

    Beugung 40/45/35, Daumen  0/30/30   sauber   ← Vorgabe
    Beugung 40/45/35, Daumen 20/25/20   Riss am Daumenballen
    Beugung 45/55/45, Daumen  0/50/40   Riss in der Handflaeche
    Beugung 55/65/50, Daumen 30/40/30   Hand zerfaellt

Die Ruhehand ist sauber — es liegt also an der Beugung, nicht am Netz.
Ursache ist das Rig: Die Hand zeigt FUENF Finger, hat aber nur DREI
Knochenketten (Zeigefinger, Ringfinger, Daumen). Mittel- und kleiner
Finger haengen an fremden Gewichten und werden mitgezerrt; das
Daumengrundglied R_Thumb01 nimmt zuviel Handflaeche mit und bleibt
deshalb ungebeugt.

Weiter kaeme man nur ueber neue Gewichte an der Hand oder zwei
zusaetzliche Fingerketten — beides eine eigene Aufgabe.

════════════════════════════════════════════════════════════════════
 Was hier NICHT passiert
════════════════════════════════════════════════════════════════════
Der Weg ins Spiel. Die Pose liegt als Aktion `greifen` im .blend; sie
beim Halten eines Gegenstands additiv ueber die laufende Animation zu
legen, ist eine eigene Entscheidung und keine Nebenwirkung dieses
Werkzeugs.
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


WURZEL = '/home/mike/worldofvikings'
KOERPER = arg('--koerper', WURZEL + '/assets/models/wikingerin/WikingerinKoerper.glb')
MESSER = arg('--messer', WURZEL + '/assets/models/Messer.glb')
AUS = arg('--aus', WURZEL + '/tools/out/greifpose.png')
BLEND = arg('--blend', WURZEL + '/tools/out/greifpose.blend')
BEUGUNG = [float(v) for v in arg('--beugung', '40,45,35').split(',')]
DAUMEN = [float(v) for v in arg('--daumen', '0,30,30').split(',')]
SPREIZUNG = float(arg('--spreizung', '0'))     # Daumen quer, um Ring 1 zu 1
OHNE_MESSER = '--ohne-messer' in argv

# In Blender an der OFFENEN Hand bestimmt (tools/messer-in-hand.py) und
# als holdPosition/holdRotation in itemDefs.ts hinterlegt. Knochenraum,
# Modelleinheiten. Bei geschlossener Faust liegt der Griffkanal anders —
# deshalb hier einstellbar.
#
# ACHTUNG zu den Achsen: Knochen-+X zeigt nach VORN (in Blickrichtung
# der Figur), +Z zur Handflaeche hin (zum Koerper). Beim ersten Anlauf
# an der offenen Hand habe ich +X faelschlich "aus der Handflaeche"
# genannt; es war "vor die Hand".
VERSATZ = Vector([float(v) for v in arg('--versatz', '0.005,0.075,0.028').split(',')])
ROLLUNG = math.radians(90)
SKALIERUNG = 1.0 / 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=KOERPER)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.data.pose_position = 'POSE'
# Die mitgelieferte Aktion WEG. Sonst zeigt `POSE` nicht die Ruhehaltung
# mit meiner Fingerbeugung, sondern Bild 1 der eingebetteten Animation —
# im ersten Anlauf stand der Arm damit am Gesicht.
arm.animation_data_clear()
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler((0, 0, 0), 'XYZ')
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

KETTEN = {
    'R_Index': BEUGUNG,
    'R_Ring': BEUGUNG,
    'R_Thumb': DAUMEN,
}

for stamm, winkel in KETTEN.items():
    for i, grad in enumerate(winkel, start=1):
        name = '%s%02d' % (stamm, i)
        pb = arm.pose.bones.get(name)
        if pb is None:
            raise SystemExit('Knochen %r fehlt' % name)
        pb.rotation_mode = 'XYZ'
        # Beugen um die lokale X. Der Daumen bekommt zusaetzlich etwas
        # Quere um Z, sonst liegt er in der Handflaeche statt am Griff.
        quer = math.radians(SPREIZUNG) if (stamm == 'R_Thumb' and i == 1) else 0.0
        pb.rotation_euler = Euler((math.radians(grad), 0.0, quer), 'XYZ')
        print('POSE %-12s beugung %5.1f°%s' % (name, grad,
              '  quer %.1f°' % SPREIZUNG if quer else ''))

bpy.context.view_layer.update()

# ── Wie weit sind die Fingerspitzen jetzt vom Griff? ────────────────
knochen = arm.data.bones['R_Hand']
pb_hand = arm.pose.bones['R_Hand']
hand_welt = arm.matrix_world @ pb_hand.matrix
griff_mitte = hand_welt @ Vector((VERSATZ.x, VERSATZ.y - 0.028, VERSATZ.z))
GRIFF_R = 0.0125 * SKALIERUNG
for spitze in ('R_Index_End', 'R_Ring_End', 'R_Thumb_End'):
    p = arm.matrix_world @ arm.pose.bones[spitze].tail
    print('SPITZE %-13s Abstand zur Griffachse %.4f  (Griffradius %.4f)'
          % (spitze, (p - griff_mitte).length, GRIFF_R))

# ── Messer hineinlegen ──────────────────────────────────────────────
if not OHNE_MESSER:
    vorher = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=MESSER)
    messer = next(o for o in bpy.data.objects
                  if o not in vorher and o.type == 'MESH')
    messer.parent = None
    # POSE-Matrix, nicht matrix_local: sonst haengt das Messer an der
    # Ruhepose, waehrend die Finger sich schon bewegt haben.
    messer.matrix_world = (
        arm.matrix_world @ pb_hand.matrix
        @ Matrix.Translation(VERSATZ)
        @ Euler((0.0, ROLLUNG, 0.0), 'XYZ').to_matrix().to_4x4()
        @ Matrix.Scale(SKALIERUNG, 4))
bpy.context.view_layer.update()

# Pose als Aktion sichern. Die Bildmarken werden ueber keyframe_insert
# gesetzt und NICHT von Hand in eine Aktion geschrieben: In Blender 5
# bindet eine Aktion ueber einen Slot, dessen Kennung zum Objektnamen
# passen muss — von Hand angelegte Slots heissen generisch und tun dann
# stumm gar nichts (in diesem Projekt schon einmal passiert).
arm.animation_data_create()
arm.animation_data.action = bpy.data.actions.new('greifen')
for stamm, winkel in KETTEN.items():
    for i in range(1, len(winkel) + 1):
        arm.pose.bones['%s%02d' % (stamm, i)].keyframe_insert(
            'rotation_euler', frame=1)
# `Action.fcurves` gibt es in Blender 5 nicht mehr — Kurven liegen in
# Ebenen und Slots. Fuer die Kontrolle reicht der gebundene Slot.
slot = arm.animation_data.action_slot
print('AKTION %s, Slot %s' % (arm.animation_data.action.name,
                              getattr(slot, 'name_display', '—')))

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('BLEND %s' % BLEND)

# ── Bilder ──────────────────────────────────────────────────────────
szene = bpy.context.scene
szene.render.engine = 'BLENDER_EEVEE'
szene.render.resolution_x = 900
szene.render.resolution_y = 900

welt = bpy.data.worlds.new('w')
welt.use_nodes = True
hg = welt.node_tree.nodes['Background']
hg.inputs[0].default_value = (0.30, 0.34, 0.40, 1)
hg.inputs[1].default_value = 1.2
szene.world = welt

licht = bpy.data.objects.new('L', bpy.data.lights.new('L', 'SUN'))
licht.data.energy = 4.0
licht.rotation_euler = Euler((math.radians(55), 0, math.radians(35)), 'XYZ')
bpy.context.collection.objects.link(licht)

kam = bpy.data.objects.new('K', bpy.data.cameras.new('K'))
bpy.context.collection.objects.link(kam)
szene.camera = kam


def blick(ziel, abstand, richtung, datei):
    kam.location = Vector(ziel) + Vector(richtung).normalized() * abstand
    kam.rotation_euler = (Vector(ziel) - kam.location).to_track_quat('-Z', 'Y').to_euler()
    szene.render.filepath = datei
    bpy.ops.render.render(write_still=True)
    print('BILD %s' % datei)


mitte = arm.matrix_world @ pb_hand.matrix @ Vector((0.01, 0.03, 0.0))
stamm = os.path.splitext(AUS)[0]
# Von AUSSEN und von VORN — von innen steht der Unterarm davor.
blick(mitte, 0.22, (-1.3, -1.0, 0.25), AUS)
blick(mitte, 0.22, (-0.2, -1.4, 0.15), stamm + '-vorn.png')
blick(mitte, 0.22, (-0.9, 0.9, 0.5), stamm + '-oben.png')
# Und einmal die ganze Figur — im Spiel sieht man die Hand fast immer
# aus dieser Entfernung, nicht aus 20 cm.
blick((mitte.x, mitte.y, 0.95), 2.4, (-1.0, -1.4, 0.15), stamm + '-ganz.png')
