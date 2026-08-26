#!/usr/bin/env blender --background --python
"""
Rendert ein Dungeon-Bauteil aus der AUGENHOEHE DER FIGUR.

    blender --background --python tools/gang-innenansicht.py -- \
        --glb assets/models/SteingrabGang.glb --out /tmp/innen.png

── Warum nicht `glb-vorschau.py` ────────────────────────────────────
Das dortige Bild steht frontal vor dem Modell, und das ist fuer einen
Baum genau richtig: Man fragt nach der Silhouette. Ein Dungeon-Bauteil
beantwortet eine andere Frage — wie es sich anfuehlt, hindurchzugehen.
Frontal sieht man von einem Mauerwerk am wenigsten: Die Stossfugen
laufen von der Kamera weg und verschwinden in der Perspektive.

Die Kamera steht deshalb IM Gang, auf 1,70 m (die Figur ist 1,80 m
hoch), leicht aus der Mitte, und blickt die Laenge hinunter.

── Warum ein warmes Licht und kein Studiolicht ──────────────────────
Im Spiel steht in einem Steingrab eine Fackel, keine Softbox. Ein
flaechiges Studiolicht zeigt jede Fuge gleich hell und verrat damit
nichts darueber, ob das Relief unter bewegtem Licht traegt.
"""

import sys
import os
import math

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    key = f'--{name}'
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


GLB = arg('glb')
OUT = arg('out', '/tmp/innen.png')
BREITE = int(arg('breite', '1000'))
AUGENHOEHE = float(arg('augenhoehe', '1.70'))

if not GLB:
    raise SystemExit('--glb fehlt')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

netze = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not netze:
    raise SystemExit('kein Netz im GLB')

"""
ACHSEN: Der glTF-IMPORT dreht Y-hoch wieder auf Blenders Z-hoch zurueck.
Nach dem Import liegt die Laenge also auf y und die Hoehe auf z — genau
wie beim Bauen, nicht wie in der Datei. Der erste Lauf dieses Skripts
stellte die Kamera quer, weil ich das andersherum angenommen hatte; die
Ausgabe meldete brav „Gang 4,30 m lang, 8,00 m hoch".
"""
ecken = [o.matrix_world @ Vector(e) for o in netze for e in o.bound_box]
miny, maxy = min(p.y for p in ecken), max(p.y for p in ecken)
minz, maxz = min(p.z for p in ecken), max(p.z for p in ecken)
laenge = maxy - miny
hoehe = maxz - minz

# Kamera kurz hinter dem einen Durchgang, leicht aus der Mitte, damit
# beide Waende im Bild sind und die Flucht nicht symmetrisch einschlaeft.
bpy.ops.object.camera_add(location=(0.55, miny + 0.4, AUGENHOEHE))
kam = bpy.context.object
kam.data.lens = 24  # weit, wie eine Spielkamera — sonst wirkt der Gang eng
ziel = Vector((-0.2, maxy, AUGENHOEHE * 0.92))
kam.rotation_euler = (ziel - kam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = kam

# Fackel: warm, punktfoermig, etwa zwei Meter voraus auf Schulterhoehe.
bpy.ops.object.light_add(type='POINT', location=(-0.9, miny + 2.2, 1.55))
fackel = bpy.context.object
fackel.data.energy = 420
fackel.data.color = (1.0, 0.72, 0.42)
fackel.data.shadow_soft_size = 0.25

# Ein schwaches kaltes Gegenlicht vom offenen Ende — sonst ist die
# hintere Haelfte des Gangs schwarz und man beurteilt ein leeres Bild.
bpy.ops.object.light_add(type='AREA', location=(0, maxy + 0.6, hoehe * 0.5))
himmel = bpy.context.object
himmel.data.energy = 60
himmel.data.size = 3.5
himmel.data.color = (0.55, 0.68, 0.85)
himmel.rotation_euler = (math.radians(90), 0, 0)

szene = bpy.context.scene
szene.render.engine = 'CYCLES'
szene.cycles.samples = 64
szene.cycles.use_denoising = True
szene.render.resolution_x = BREITE
szene.render.resolution_y = int(BREITE * 0.62)
szene.render.filepath = OUT
szene.render.image_settings.file_format = 'PNG'
szene.view_settings.look = 'AgX - Medium High Contrast'

bpy.ops.render.render(write_still=True)

dreiecke = sum(
    sum(len(p.vertices) - 2 for p in o.data.polygons) for o in netze
)
print(f'\nINNENANSICHT {OUT} — {dreiecke} Dreiecke, Gang {laenge:.2f} m lang, '
      f'{hoehe:.2f} m hoch, Kamera auf {AUGENHOEHE:.2f} m')
