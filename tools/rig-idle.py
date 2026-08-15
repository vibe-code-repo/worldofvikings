#!/usr/bin/env blender --background --python
"""
Gibt einem statischen Modell ein einfaches Rig und eine Idle-Animation.

    blender --background --python tools/rig-idle.py -- \
        --glb assets/models/Surtr.glb [--staerke 1.0] [--dauer 5.0]

── Warum nicht Tripos Auto-Rigging ──────────────────────────────────
Beide Rig-Modelle wurden an Surtr versucht. v2.5 zerlegte die Geometrie
schon beim Riggen; v1.0 riggte sauber, aber das Retargeting von
"preset:idle" zerriss das Modell trotzdem — Beine zu Spitzen gezogen,
Rumpf aufgerissen. Der Grund ist immer derselbe: Die Presets sind auf
normale Menschenproportionen retargetet, und ein 9-m-Riese mit
Panzerplatten, Stummelbeinen und Schwert liegt zu weit davon entfernt.

── Warum dieses Rig stattdessen trägt ───────────────────────────────
Es versucht gar keine Anatomie. Vier Knochen stehen übereinander auf der
Hochachse, und die Gewichte werden NICHT von Blenders "Automatic Weights"
geraten, sondern aus der Vertexhöhe gerechnet — genau die Stelle, an der
Auto-Rigging scheitert. Was daraus entsteht, ist kein Gehen und kein
Greifen, sondern ein Wiegen: Der Koloss steht, atmet und verlagert sein
Gewicht. Für einen Idle ist das alles, was man braucht, und es kann
prinzipbedingt nicht zerreißen — benachbarte Vertices bekommen immer
benachbarte Gewichte.

Die Knochenhöhen sind an der Massenverteilung abgelesen (Surtr: Füße bis
20 %, Hüfte und Schwertarm bis 50 %, Oberkörper bis 90 %, Helm darüber).
"""

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg('--glb')
STAERKE = float(arg('--staerke', '1.0'))
DAUER = float(arg('--dauer', '5.0'))     # Sekunden für einen Durchlauf
FPS = 30
if not GLB:
    raise SystemExit('--glb fehlt')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PFAD = GLB if os.path.isabs(GLB) else os.path.join(ROOT, GLB)

# Knochen: (Name, relative Höhe des Fußpunkts, relative Höhe der Spitze)
KNOCHEN = [
    ('wurzel', 0.00, 0.20),   # Füße — bleibt stehen
    ('huefte', 0.20, 0.50),
    ('brust', 0.50, 0.80),
    ('kopf', 0.80, 1.00),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PFAD)

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices)]
if not meshes:
    raise SystemExit('keine Mesh-Geometrie gefunden')
mesh = max(meshes, key=lambda o: len(o.data.vertices))

# Vorhandene Armature (z. B. von einem früheren Rig-Versuch) entfernen —
# zwei Skelette auf einem Mesh ergeben im Export Unsinn.
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(mesh.modifiers):
    if m.type == 'ARMATURE':
        mesh.modifiers.remove(m)
mesh.vertex_groups.clear()

welt = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
zmin = min(v.z for v in welt)
zmax = max(v.z for v in welt)
hoehe = zmax - zmin
mitte_x = (min(v.x for v in welt) + max(v.x for v in welt)) / 2
mitte_y = (min(v.y for v in welt) + max(v.y for v in welt)) / 2
print(f'MODELL {mesh.name}: {len(welt)} Vertices, Höhe {hoehe:.3f}')

# ── Armature aufbauen ────────────────────────────────────────────────
arm_data = bpy.data.armatures.new('idle_rig')
arm = bpy.data.objects.new('idle_rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')

eltern = None
for name, u, o in KNOCHEN:
    b = arm_data.edit_bones.new(name)
    b.head = Vector((mitte_x, mitte_y, zmin + hoehe * u))
    b.tail = Vector((mitte_x, mitte_y, zmin + hoehe * o))
    if eltern:
        b.parent = eltern
        b.use_connect = True
    eltern = b
bpy.ops.object.mode_set(mode='OBJECT')

# ── Gewichte aus der Vertexhöhe ──────────────────────────────────────
# Jeder Vertex verteilt sich auf die zwei nächstgelegenen Knochen, linear
# zwischen deren Mittelpunkten. Das ergibt einen stetigen Verlauf über das
# ganze Modell — die Voraussetzung dafür, dass nichts aufreißt.
gruppen = {name: mesh.vertex_groups.new(name=name) for name, _, _ in KNOCHEN}
zentren = [(name, (u + o) / 2) for name, u, o in KNOCHEN]

for i, v in enumerate(welt):
    t = (v.z - zmin) / hoehe if hoehe else 0.0
    # Knochenpaar finden, zwischen dem dieser Vertex liegt
    if t <= zentren[0][1]:
        gruppen[zentren[0][0]].add([i], 1.0, 'REPLACE')
        continue
    if t >= zentren[-1][1]:
        gruppen[zentren[-1][0]].add([i], 1.0, 'REPLACE')
        continue
    for k in range(len(zentren) - 1):
        n1, z1 = zentren[k]
        n2, z2 = zentren[k + 1]
        if z1 <= t <= z2:
            f = (t - z1) / (z2 - z1) if z2 > z1 else 0.0
            # Weiche Übergangskurve statt linear: an den Knochenmitten
            # bleibt das Gewicht satt bei 1, nur dazwischen wird gemischt.
            f = f * f * (3 - 2 * f)
            gruppen[n1].add([i], 1.0 - f, 'REPLACE')
            gruppen[n2].add([i], f, 'REPLACE')
            break

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mesh.parent = arm

# ── Idle-Animation ───────────────────────────────────────────────────
# Sehr sparsam dosiert: Ein Koloss von neun Metern bewegt sich langsam und
# WENIG. Sichtbar wird die Bewegung durch die Höhe von selbst — zwei Grad
# an der Brust sind an der Schwertspitze schon eine Handbreit.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

szene = bpy.context.scene
szene.render.fps = FPS
frames = int(DAUER * FPS)
szene.frame_start = 1
szene.frame_end = frames

# Grad je Knochen: (nicken vor/zurück, wiegen seitlich, Frequenzfaktor)
BEWEGUNG = {
    'wurzel': (0.0, 0.0, 1.0),
    'huefte': (0.8, 1.2, 1.0),
    'brust': (1.6, 1.0, 1.0),
    'kopf': (1.2, 1.6, 2.0),   # der Kopf schaut sich um: doppelte Frequenz
}

for f in range(1, frames + 1):
    szene.frame_set(f)
    p = (f - 1) / frames * math.tau      # ein voller Umlauf = nahtlose Schleife
    for pb in arm.pose.bones:
        nick, wieg, ff = BEWEGUNG.get(pb.name, (0, 0, 1))
        pb.rotation_euler[0] = math.radians(nick * STAERKE) * math.sin(p * ff)
        pb.rotation_euler[1] = math.radians(wieg * STAERKE) * math.sin(p * ff * 0.5 + 1.1)
        pb.keyframe_insert('rotation_euler', frame=f)
    # Atmen: die ganze Gestalt hebt und senkt sich um ein halbes Prozent
    wurzel = arm.pose.bones['wurzel']
    wurzel.location[1] = hoehe * 0.005 * STAERKE * math.sin(p * 2)
    wurzel.keyframe_insert('location', frame=f)

# Interpolation glätten, sonst ruckt die Schleife an den Keyframes
for fc in arm.animation_data.action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = 'BEZIER'
arm.animation_data.action.name = 'idle'
bpy.ops.object.mode_set(mode='OBJECT')

# ── Export ───────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=PFAD,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=True,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_frame_range=True,
)
print(f'FERTIG {PFAD} — {len(KNOCHEN)} Knochen, "idle" über {frames} Frames '
      f'({DAUER:.1f} s), {os.path.getsize(PFAD)/1e6:.2f} MB')
