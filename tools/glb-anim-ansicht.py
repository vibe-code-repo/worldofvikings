#!/usr/bin/env blender --background --python
"""Rendert drei Bilder einer GLB-Animation nebeneinander — zu, halb, offen."""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg('--glb', 'assets/models/HolzTruhe.glb')
ZIEL = arg('--ziel', '/tmp/anim.png')
BREITE = int(arg('--breite', '640'))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLB))

objekte = [o for o in bpy.context.scene.objects if o.type == 'MESH']
ecken = []
for o in objekte:
    ecken += [o.matrix_world @ Vector(e) for e in o.bound_box]
mitte = sum(ecken, Vector()) / len(ecken)
spanne = max(
    max(p.x for p in ecken) - min(p.x for p in ecken),
    max(p.y for p in ecken) - min(p.y for p in ecken),
    max(p.z for p in ecken) - min(p.z for p in ecken),
)
boden_z = min(p.z for p in ecken)

bpy.ops.mesh.primitive_plane_add(size=spanne * 8, location=(mitte.x, mitte.y, boden_z))
b = bpy.context.active_object
bm = bpy.data.materials.new('boden')
bm.use_nodes = True
bm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.25, 0.18, 1)
b.data.materials.append(bm)

sonne = bpy.data.objects.new('sonne', bpy.data.lights.new('sonne', 'SUN'))
bpy.context.collection.objects.link(sonne)
sonne.data.energy = 3.0
sonne.rotation_euler = (math.radians(52), 0, math.radians(30))

welt = bpy.context.scene.world
welt.use_nodes = True
welt.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.55, 0.7, 1)
welt.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

szene = bpy.context.scene
szene.render.engine = 'BLENDER_EEVEE'
szene.render.resolution_x = BREITE
szene.render.resolution_y = BREITE
szene.render.image_settings.file_format = 'PNG'

kam_daten = bpy.data.cameras.new('kam')
kam = bpy.data.objects.new('kam', kam_daten)
bpy.context.collection.objects.link(kam)
szene.camera = kam
# Leicht von schraeg vorn — von dort sieht man Schloss UND Deckelbewegung.
a = math.radians(38)
r = spanne * 2.7
kam.location = (mitte.x + math.sin(a) * r, mitte.y - math.cos(a) * r, mitte.z + spanne * 1.0)
kam.rotation_euler = (mitte - kam.location).to_track_quat('-Z', 'Y').to_euler()

ende = int(szene.frame_end)
bilder = [1, max(1, ende // 2), ende]
teile = []
for f in bilder:
    szene.frame_set(f)
    pfad = f'/tmp/_anim_{f:03d}.png'
    szene.render.filepath = pfad
    bpy.ops.render.render(write_still=True)
    teile.append(pfad)

try:
    from PIL import Image
    ims = [Image.open(p) for p in teile]
    g = Image.new('RGB', (sum(i.width for i in ims), ims[0].height))
    x = 0
    for i in ims:
        g.paste(i, (x, 0))
        x += i.width
    g.save(ZIEL)
    print(f'FERTIG {ZIEL} — Bilder {bilder} von 1..{ende}')
except ImportError:
    print('FERTIG einzeln: ' + ', '.join(teile))
