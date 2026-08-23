#!/usr/bin/env blender --background --python
"""
Steckt das Messer in die rechte Faust der Wikingerin und rendert das.

    blender --background --python tools/messer-in-hand.py -- \
        --drehung 0,0,0 [--aus /home/mike/.../messer-in-hand.png]

════════════════════════════════════════════════════════════════════
 Warum hier und nicht im Spiel
════════════════════════════════════════════════════════════════════
Im Browser hingen zwei Fragen aneinander: Sitzt das Messer richtig, und
warum zeichnet Babylon es nicht? Hier ist nur noch die erste uebrig —
Blender zeichnet, was da ist, ohne Sichtkegelpruefung und ohne
Nachbearbeitungskette.

Das Ergebnis ist auf `holdRotation` in itemDefs.ts uebertragbar, weil die
Kette dieselbe ist: Knochen → Huellknoten mit Drehung → Modell. Nur die
Haendigkeit unterscheidet sich, und die betrifft das Vorzeichen der
Y-Drehung, nicht das Bild von der Seite.
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
AUS = arg('--aus', WURZEL + '/tools/out/messer-in-hand.png')
DREHUNG = [math.radians(float(v)) for v in arg('--drehung', '0,0,0').split(',')]
KNOCHEN = arg('--knochen', 'R_Hand')
# Versatz im KNOCHENRAUM, in Modelleinheiten (Figur = 1,0 hoch).
# +Y laeuft vom Handgelenk zu den Knoecheln.
VERSATZ = [float(v) for v in arg('--versatz', '0,0,0').split(',')]

bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.import_scene.gltf(filepath=KOERPER)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
# Ruhepose: die Pose kommt im Spiel aus der Animation, fuer den Sitz in
# der Faust ist sie ohne Belang — und eine halb abgespielte Animation
# haette schon einmal ein Haar neben den Schaedel gestellt.
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()

if KNOCHEN not in arm.data.bones:
    raise SystemExit('Knochen %r fehlt. Vorhanden: %s'
                     % (KNOCHEN, ', '.join(b.name for b in arm.data.bones)))

vorher = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=MESSER)
neu = [o for o in bpy.data.objects if o not in vorher]
messer = next(o for o in neu if o.type == 'MESH')
# Die Importwurzel wegwerfen: sie traegt nur die Haendigkeitsdrehung des
# glTF-Imports, und die will ich hier nicht mitschleppen.
messer.parent = None
messer.matrix_world.identity()

# ── An den Knochen setzen ───────────────────────────────────────────
# Kein `parent_type = 'BONE'`: Blender haengt dabei an den SCHWANZ des
# Knochens, und die Ruecktransformation von Hand war schief (Knauf lag
# 60 cm neben der Faust). In Ruhepose reicht die Weltmatrix direkt.
#
# MASSSTAB: Das Figurenmodell ist 1,0 Einheiten hoch, im Spiel wird es
# mit 1.8 multipliziert — genau das rechnet AvatarRig an `handR` mit
# `scaling.setAll(1 / modellSkalierung)` wieder heraus. Hier steht die
# Figur unskaliert, also muss stattdessen das Messer geteilt werden.
SKALIERUNG = 1.0 / 1.8
knochen = arm.data.bones[KNOCHEN]
messer.parent = None
messer.matrix_world = (
    arm.matrix_world @ knochen.matrix_local
    @ Matrix.Translation(VERSATZ)
    @ Euler(DREHUNG, 'XYZ').to_matrix().to_4x4()
    @ Matrix.Scale(SKALIERUNG, 4))
bpy.context.view_layer.update()

print('OBJEKTE ' + ', '.join('%s(%s,%d Ecken)' % (o.name, o.type,
      len(o.data.vertices) if o.type == 'MESH' else 0) for o in neu))
print('MESSEROBJEKT %s — Ecken %d, hide_render %s, hide_viewport %s, '
      'sichtbar %s, Sammlungen %s, Material %s'
      % (messer.name, len(messer.data.vertices), messer.hide_render,
         messer.hide_viewport, messer.visible_get(),
         [c.name for c in messer.users_collection],
         [m.name for m in messer.data.materials]))

kopf = arm.matrix_world @ knochen.head_local
print('KNOCHEN %s Kopf %.3f %.3f %.3f, Laenge %.3f'
      % (KNOCHEN, kopf.x, kopf.y, kopf.z, knochen.length))
# Achsen des Knochens in WELTrichtungen — Bruecke zu Babylon. Dort ist
# gemessen: Handknoten-+Y zeigt zu den Fingern (wie hier), +Z zeigt zum
# Koerper hin. Welche Blender-Achse dem entspricht, entscheidet das
# Skalarprodukt mit derselben Bezugsrichtung.
M3 = (arm.matrix_world @ knochen.matrix_local).to_3x3()
innen = Vector((-kopf.x, 0.0, 0.0)); innen.normalize()
for name, a in (('X', (1, 0, 0)), ('Y', (0, 1, 0)), ('Z', (0, 0, 1))):
    w = (M3 @ Vector(a)).normalized()
    print('BLENDERACHSE %s welt %6.3f %6.3f %6.3f   zum Koerper %6.3f'
          % (name, w.x, w.y, w.z, w.dot(innen)))

ecken = [messer.matrix_world @ v.co for v in messer.data.vertices]
print('MESSER  z von %.3f bis %.3f, naechster Punkt zum Knochenkopf %.3f'
      % (min(v.z for v in ecken), max(v.z for v in ecken),
         min((v - kopf).length for v in ecken)))

# ── Kamera auf die Hand ─────────────────────────────────────────────
# Zwei Bilder: eins auf die Faust, eins auf die ganze Figur. Die Faust
# zeigt den Sitz, die Figur zeigt, ob die Klinge im Bein steckt.
szene = bpy.context.scene
szene.render.engine = 'BLENDER_EEVEE'
szene.render.film_transparent = False
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

kam_d = bpy.data.cameras.new('K')
kam = bpy.data.objects.new('K', kam_d)
bpy.context.collection.objects.link(kam)
szene.camera = kam


def blick(ziel, abstand, richtung, datei):
    kam.location = Vector(ziel) + Vector(richtung).normalized() * abstand
    d = Vector(ziel) - kam.location
    kam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    szene.render.filepath = datei
    bpy.ops.render.render(write_still=True)
    print('BILD %s' % datei)


mitte = sum(ecken, Vector()) / len(ecken)
blick(mitte, 0.5, (-1.3, -1.0, 0.25), AUS)
blick(mitte, 0.5, (-0.2, -1.4, 0.15), os.path.splitext(AUS)[0] + '-vorn.png')
# Entscheidungsbild: dieselbe Kamera, nur ohne Koerper. Erscheint das
# Messer hier, verdeckt es die Hand; erscheint es nicht, wird es gar
# nicht gezeichnet.
for o in bpy.data.objects:
    if o.type == 'MESH' and o is not messer:
        o.hide_render = True
blick(mitte, 0.5, (-1.3, -1.0, 0.25), os.path.splitext(AUS)[0] + '-solo.png')
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.hide_render = False

ganz = os.path.splitext(AUS)[0] + '-ganz.png'
blick((kopf.x, kopf.y, 0.95), 2.6, (-1.0, -1.4, 0.15), ganz)
