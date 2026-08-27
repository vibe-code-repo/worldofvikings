#!/usr/bin/env blender --background --python
"""
Turn a raw generated wall-mounted model into a game-ready one.

    blender --background --factory-startup --python tools/torch-fixup.py -- \
        --glb assets/models/CryptWallTorch.glb \
        --out assets/models/CryptWallTorch.glb \
        --measure-only

Written for a Tripo output, but nothing here is specific to Tripo: the
same four defects show up in anything that comes out of a generator or a
scan.

── The four things it fixes ─────────────────────────────────────────
1. DETACHED FRAGMENTS. Generators regularly leave a shard floating
   beside the model. Without this a stone splinter hovers next to every
   torch in the crypt.

   Removing them by SIZE does not work, and measuring says why: this
   torch is not one body plus one shard, it is 115 separate shells — the
   plate, the flame, and every single rivet. The largest holds 201 of
   3805 faces. A size threshold would delete the rivets and keep the
   shard.

   So the rule is spatial. Islands are clustered by proximity (bounding
   boxes within `--gap` of each other count as connected), and only the
   heaviest cluster survives. A rivet sits ON the plate and joins it; the
   shard floats in the air and does not.

2. ORIENTATION. A wall fixture only makes sense against a plane, and the
   generator has no idea which plane that is. The thinnest axis of the
   bounding box is the one pointing away from the wall, so the model is
   rotated to put that axis on the game's -z (the direction a connector
   faces out of a room). `--face` overrides the guess.

3. PIVOT. `tripo-generate.mjs` drops the origin to the bottom of the
   bounding box, which is right for anything that stands and wrong for
   anything that hangs: a wall torch is placed AT the wall, so its origin
   belongs on the mounting plate's back face, centred horizontally. Put
   it anywhere else and the fixture ends up half inside the masonry or
   floating in front of it.

4. HANDEDNESS. The client loads glTF into a left-handed Babylon scene and
   puts a `__root__` node with determinant -1 over every model, while ZDO
   positions are taken unchanged — measured 27.08.2026, see
   `tools/steingrab-erzeugen.py`, `in_spielachsen_spiegeln`. Geometry is
   therefore mirrored along x relative to its position. Own models have
   to be exported pre-mirrored; imported Valheim assets already carry
   that conversion from AssetRipper.

Run with `--measure-only` first. It prints the bounding box and the
island sizes and writes nothing — orientation is the one step worth
looking at before it is baked in.
"""

import sys
import os

import bpy
import bmesh
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
OUT = arg('out', GLB)
GAP = float(arg('gap', '0.02'))
FACE = arg('face')                       # '-z' | '+z' | '-x' | '+x'
MEASURE_ONLY = '--measure-only' in argv
NO_MIRROR = '--no-mirror' in argv
MAX_TEXTURE = int(arg('max-texture', '0'))

if not GLB:
    raise SystemExit('usage: --glb <file> [--out <file>] [--face -z] [--measure-only]')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    raise SystemExit('no mesh in the file')

# Everything into ONE object first. A generator may or may not split its
# output; the island pass below works on geometry, not on the object tree.
for o in bpy.context.selected_objects:
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def islands(bm):
    """Connected components of a bmesh, largest first."""
    seen = set()
    gruppen = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stapel = [face]
        seen.add(face.index)
        gruppe = []
        while stapel:
            f = stapel.pop()
            gruppe.append(f)
            for edge in f.edges:
                for nachbar in edge.link_faces:
                    if nachbar.index not in seen:
                        seen.add(nachbar.index)
                        stapel.append(nachbar)
        gruppen.append(gruppe)
    gruppen.sort(key=len, reverse=True)
    return gruppen


def box_of(faces):
    """Axis-aligned bounds of a face group."""
    xs = [v.co for f in faces for v in f.verts]
    return (
        Vector((min(p.x for p in xs), min(p.y for p in xs), min(p.z for p in xs))),
        Vector((max(p.x for p in xs), max(p.y for p in xs), max(p.z for p in xs))),
    )


def near(a, b, gap):
    """Do two boxes touch, or come within `gap` of each other?"""
    (alo, ahi), (blo, bhi) = a, b
    for i in range(3):
        if alo[i] - gap > bhi[i] or blo[i] - gap > ahi[i]:
            return False
    return True


bm = bmesh.new()
bm.from_mesh(obj.data)
bm.faces.ensure_lookup_table()
gruppen = islands(bm)
boxen = [box_of(g) for g in gruppen]
print(f'\nislands: {len(gruppen)} (largest {len(gruppen[0])} faces of {len(bm.faces)})')

# Cluster the islands: union-find over "boxes within GAP of each other".
eltern = list(range(len(gruppen)))


def wurzel(i):
    while eltern[i] != i:
        eltern[i] = eltern[eltern[i]]
        i = eltern[i]
    return i


spanne = max((b[1] - b[0]).length for b in boxen)
gap = GAP * spanne
for i in range(len(gruppen)):
    for j in range(i + 1, len(gruppen)):
        if wurzel(i) != wurzel(j) and near(boxen[i], boxen[j], gap):
            eltern[wurzel(i)] = wurzel(j)

cluster = {}
for i, g in enumerate(gruppen):
    cluster.setdefault(wurzel(i), []).extend(g)
grossen = sorted(cluster.values(), key=len, reverse=True)
print(f'clusters at gap {gap:.4f}: {[len(c) for c in grossen[:8]]}')
for k, c in enumerate(grossen[:6]):
    lo_c, hi_c = box_of(c)
    print(
        f'  cluster {k}: {len(c):5d} faces  '
        f'x {lo_c.x:+.2f}…{hi_c.x:+.2f}  y {lo_c.y:+.2f}…{hi_c.y:+.2f}  z {lo_c.z:+.2f}…{hi_c.z:+.2f}'
    )

entfernt = 0
if len(grossen) > 1:
    weg = [f for c in grossen[1:] for f in c]
    entfernt = len(weg)
    if not MEASURE_ONLY:
        bmesh.ops.delete(bm, geom=weg, context='FACES')
if not MEASURE_ONLY:
    bm.to_mesh(obj.data)
bm.free()

# ── Measure in Blender axes (z up) ───────────────────────────────────
ecken = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
lo = Vector((min(p.x for p in ecken), min(p.y for p in ecken), min(p.z for p in ecken)))
hi = Vector((max(p.x for p in ecken), max(p.y for p in ecken), max(p.z for p in ecken)))
groesse = hi - lo
print(f'bounds (blender xyz): {groesse.x:.3f} x {groesse.y:.3f} x {groesse.z:.3f}')
print(f'  x {lo.x:+.3f}…{hi.x:+.3f}   y {lo.y:+.3f}…{hi.y:+.3f}   z {lo.z:+.3f}…{hi.z:+.3f}')
print(f'faces removed as detached: {entfernt}')

# The thinnest HORIZONTAL axis is the one that points away from the wall.
# Blender's z is up here, so only x and y are candidates.
dick = 'x' if groesse.x <= groesse.y else 'y'
print(f'thinnest horizontal axis: {dick} — that is the wall normal')

if MEASURE_ONLY:
    print('\nmeasure-only: nothing written')
    raise SystemExit(0)

# ── Orientation ──────────────────────────────────────────────────────
# glTF export (export_yup) maps blender -y to game +z. A connector points
# OUT of the room along its own +z, so a fixture mounted on that wall
# faces the room along -z, i.e. blender +y. Rotate the wall normal there.
drehung = {'x': 90.0, 'y': 0.0}[dick] if FACE is None else float(FACE)
if drehung:
    obj.rotation_euler = (0.0, 0.0, drehung * 3.141592653589793 / 180.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

# ── Pivot to the mounting plane ──────────────────────────────────────
ecken = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
lo = Vector((min(p.x for p in ecken), min(p.y for p in ecken), min(p.z for p in ecken)))
hi = Vector((max(p.x for p in ecken), max(p.y for p in ecken), max(p.z for p in ecken)))
# Centre in x and z, back face in y: that is where the plate meets stone.
versatz = Vector((-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2))
obj.location = versatz
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
print(f'pivot moved by ({versatz.x:+.3f}, {versatz.y:+.3f}, {versatz.z:+.3f}) — back face on 0')

# ── Handedness ───────────────────────────────────────────────────────
if not NO_MIRROR:
    obj.scale.x = -1.0
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # A negative scale turns every face inside out, and an inside-out mesh
    # is drawn from within — walls you can see straight through.
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')
    print('mirrored along x for the game axes')

# ── Textures ─────────────────────────────────────────────────────────
if MAX_TEXTURE:
    for img in bpy.data.images:
        if img.size[0] > MAX_TEXTURE or img.size[1] > MAX_TEXTURE:
            vorher = tuple(img.size)
            faktor = MAX_TEXTURE / max(img.size)
            img.scale(max(1, int(img.size[0] * faktor)), max(1, int(img.size[1] * faktor)))
            print(f'texture {img.name}: {vorher[0]}x{vorher[1]} -> {img.size[0]}x{img.size[1]}')

for o in bpy.context.selected_objects:
    o.select_set(False)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)

tiefe = bpy.context.evaluated_depsgraph_get()
netz = obj.evaluated_get(tiefe).to_mesh()
dreiecke = sum(len(p.vertices) - 2 for p in netz.polygons)
obj.evaluated_get(tiefe).to_mesh_clear()
print(f'\nWRITTEN {OUT} — {dreiecke} triangles, {os.path.getsize(OUT) / 1e6:.2f} MB')
