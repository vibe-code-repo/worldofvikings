#!/usr/bin/env blender --background --python
"""
Rendert ein GLB aus drei Blickwinkeln nebeneinander — Sichtprobe fuer
erzeugte Modelle, damit niemand etwas ausliefert, das er nie gesehen hat.

    blender --background --python tools/glb-ansicht.py -- \
        --glb assets/models/HolzTruhe.glb --ziel /tmp/ansicht.png
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg('--glb', 'assets/models/HolzTruhe.glb')
ZIEL = arg('--ziel', '/tmp/ansicht.png')
BREITE = int(arg('--breite', '640'))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLB))
objekte = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not objekte:
    raise SystemExit('kein Mesh im GLB')

# Gemeinsame Huelle, damit die Kamera zum Objekt passt statt umgekehrt.
ecken = []
for o in objekte:
    ecken += [o.matrix_world @ Vector(e) for e in o.bound_box]
mitte = sum(ecken, Vector()) / len(ecken)
spanne = max(
    max(p.x for p in ecken) - min(p.x for p in ecken),
    max(p.y for p in ecken) - min(p.y for p in ecken),
    max(p.z for p in ecken) - min(p.z for p in ecken),
)

# Boden, damit das Objekt nicht im Nichts schwebt und man sieht, ob der
# Pivot stimmt.
bpy.ops.mesh.primitive_plane_add(size=spanne * 8, location=(mitte.x, mitte.y, min(p.z for p in ecken)))
boden = bpy.context.active_object
bm = bpy.data.materials.new('boden')
bm.use_nodes = True
bm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.25, 0.18, 1)
boden.data.materials.append(bm)

sonne = bpy.data.objects.new('sonne', bpy.data.lights.new('sonne', 'SUN'))
bpy.context.collection.objects.link(sonne)
sonne.data.energy = 3.0
sonne.rotation_euler = (math.radians(55), 0, math.radians(35))

welt = bpy.context.scene.world
welt.use_nodes = True
welt.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.55, 0.7, 1)
welt.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

szene = bpy.context.scene
szene.render.engine = 'BLENDER_EEVEE'
szene.render.film_transparent = False
szene.render.resolution_y = BREITE
szene.render.image_settings.file_format = 'PNG'

kam_daten = bpy.data.cameras.new('kam')
kam = bpy.data.objects.new('kam', kam_daten)
bpy.context.collection.objects.link(kam)
szene.camera = kam

WINKEL = [('vorn', 0), ('schraeg', 45), ('seite', 90)]
teile = []
for name, grad in WINKEL:
    r = spanne * 2.6
    a = math.radians(grad)
    kam.location = (mitte.x + math.sin(a) * r, mitte.y - math.cos(a) * r, mitte.z + spanne * 0.9)
    richtung = mitte - kam.location
    kam.rotation_euler = richtung.to_track_quat('-Z', 'Y').to_euler()
    szene.render.resolution_x = BREITE
    pfad = f'/tmp/_ansicht_{name}.png'
    szene.render.filepath = pfad
    bpy.ops.render.render(write_still=True)
    teile.append(pfad)

# Die drei Bilder nebeneinander legen.
try:
    from PIL import Image
    bilder = [Image.open(p) for p in teile]
    gesamt = Image.new('RGB', (sum(b.width for b in bilder), bilder[0].height))
    x = 0
    for b in bilder:
        gesamt.paste(b, (x, 0))
        x += b.width
    gesamt.save(ZIEL)
    print(f'FERTIG {ZIEL} — {gesamt.width}x{gesamt.height}, Blickwinkel: ' + ', '.join(n for n, _ in WINKEL))
except ImportError:
    print('FERTIG (einzeln): ' + ', '.join(teile))
