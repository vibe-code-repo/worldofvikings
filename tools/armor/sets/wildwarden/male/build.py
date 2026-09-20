"""Build Wildwarden replacement armor on the unmodified WoV male rest rig.

Blender --factory-startup -b BODY_BASE_MALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/wildwarden/male/build.py -- OUTPUT_DIR [--quick]
Run with SOURCE.blend = WoV_BodyBase_Male.blend. Optionally --quick (hero only).
Geometry is deterministic, no paid APIs.
"""
import bpy
import bmesh
import json
import math
import random
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
ROOT = Path(ARGS[0]).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
RENDERS = ROOT / 'renders'
RENDERS.mkdir(exist_ok=True)
QUICK = '--quick' in ARGS
PREFIX = 'WoV_Wildwarden_'
BODY_SLOTS = ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft',
              'ArmLowerRight', 'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight']
REPLACEMENT_SLOTS = [slot for slot in BODY_SLOTS if slot != 'Head']
SLOTS = REPLACEMENT_SLOTS + ['Crown']
PARTS = [
    {'item': 'wildwarden_crown', 'label': 'Geweihkrone', 'regions': [], 'sourceRegions': ['Crown']},
    {'item': 'wildwarden_mantle', 'label': 'Blattschultern', 'regions': ['ArmUpperLeft', 'ArmUpperRight']},
    {'item': 'wildwarden_vest', 'label': 'Rindenwams', 'regions': ['Torso']},
    {'item': 'wildwarden_bracers', 'label': 'Wurzelarmschienen', 'regions': ['ArmLowerLeft', 'ArmLowerRight']},
    {'item': 'wildwarden_gloves', 'label': 'Lederhandschuhe', 'regions': ['HandLeft', 'HandRight']},
    {'item': 'wildwarden_robe', 'label': 'Waldrobe', 'regions': ['Hips']},
    {'item': 'wildwarden_boots', 'label': 'Wanderstiefel', 'regions': ['LegLeft', 'LegRight']},
]
scene = bpy.context.scene
rig = bpy.data.objects['WoV_Player_Armature']
source_path = bpy.data.filepath
base = {s: bpy.data.objects['WoV_BodyBase_Male_' + s] for s in BODY_SLOTS}
pose = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
collection = bpy.data.collections.new('Wildwarden_Equipment')
scene.collection.children.link(collection)
pieces = {s: [] for s in SLOTS}
materials = {}
palette = {
    'bark': (.135, .062, .026), 'bark_light': (.245, .125, .050),
    'bark_dark': (.063, .030, .015), 'leather': (.100, .058, .032),
    'cloth': (.046, .069, .027), 'leaf': (.080, .215, .019),
    'leaf_light': (.185, .335, .035), 'leaf_dark': (.027, .096, .018),
    'antler': (.420, .283, .125), 'antler_tip': (.680, .510, .265),
    'ivory': (.570, .515, .306), 'gold': (.440, .291, .084),
    'jade': (.041, .340, .118), 'skin': (.730, .296, .175),
}
for name, color in palette.items():
    mat = bpy.data.materials.new('Wildwarden_' + name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .72 if name != 'jade' else .3
    shader.inputs['Metallic'].default_value = .3 if name == 'gold' else 0
    materials[name] = mat


def mesh(name, vertices, faces, slot, material, bone=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(materials[material])
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(vertices))), 1, 'REPLACE')
    pieces[slot].append(obj)
    return obj


def leaf(name, start, end, width, normal, slot, bone, material='leaf', fold=.008):
    """Closed eight-sided lanceolate leaf with a raised central vein."""
    start, end, normal = Vector(start), Vector(end), Vector(normal).normalized()
    axis = end - start
    normal = (normal - axis.normalized() * normal.dot(axis.normalized())).normalized()
    cross = axis.normalized().cross(normal).normalized() * width
    outline = [start, start + axis*.22 + cross*.65, start + axis*.52 + cross,
               start + axis*.80 + cross*.55, end, start + axis*.80 - cross*.55,
               start + axis*.52 - cross, start + axis*.22 - cross*.65]
    vertices = outline + [start + axis*.48 + normal*fold, start + axis*.48 - normal*.002]
    faces = [(i, (i+1) % 8, 8) for i in range(8)] + [(i, 9, (i+1) % 8) for i in range(8)]
    obj = mesh(name, vertices, faces, slot, material, bone)
    secondary = 'leaf_light' if material == 'leaf' else ('bark_light' if material == 'bark' else material)
    obj.data.materials.append(materials[secondary])
    for p in obj.data.polygons:
        if p.index < 4:
            p.material_index = 1
    return obj


def branch(name, points, radii, slot, bone, material='bark', segments=6):
    points = [Vector(p) for p in points]
    vertices = []
    for i, (point, radius) in enumerate(zip(points, radii)):
        axis = (points[min(i+1, len(points)-1)] - points[max(i-1, 0)]).normalized()
        cross = axis.cross(Vector((0, 1, 0))).normalized()
        other = axis.cross(cross).normalized()
        vertices += [point + radius * (math.cos(j*2*math.pi/segments)*cross + math.sin(j*2*math.pi/segments)*other) for j in range(segments)]
    faces = [tuple(reversed(range(segments))), tuple(range(len(vertices)-segments, len(vertices)))]
    for k in range(len(points)-1):
        for j in range(segments):
            a = k*segments+j
            b = k*segments+(j+1) % segments
            faces.append((a, b, b+segments, a+segments))
    obj = mesh(name, vertices, faces, slot, material, bone)
    if material == 'antler':
        obj.data.materials.append(materials['antler_tip'])
        for p in obj.data.polygons:
            if p.index >= len(faces) - segments:
                p.material_index = 1
    return obj


def sleeve(name, points, radii, slot, bone, material, segments=12):
    points = [Vector(p) for p in points]
    axis = (points[-1]-points[0]).normalized()
    front = Vector((0, -1, 0))
    front = (front-axis*front.dot(axis)).normalized()
    other = axis.cross(front).normalized()
    vertices = []
    for point, (depth, width) in zip(points, radii):
        vertices += [point+front*math.cos(j*2*math.pi/segments)*depth+other*math.sin(j*2*math.pi/segments)*width for j in range(segments)]
    faces = [(k*segments+j, k*segments+(j+1) % segments, (k+1)*segments+(j+1) % segments, (k+1)*segments+j) for k in range(len(points)-1) for j in range(segments)]
    obj = mesh(name, vertices, faces, slot, material, bone)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Closed_shell', 'SOLIDIFY')
    mod.thickness = .003
    mod.offset = -1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def robe_weights(obj):
    """Continuous skirt skin: blend both legs across the front/back centre."""
    groups = {n: obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n) for n in ['Hips', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R']}
    for v in obj.data.vertices:
        hip = min(1, max(0, (v.co.z-.70)/.20))
        knee = min(.90, max(0, (.53-v.co.z)/.30)) * (1-hip)
        # Spread opposing strides over the hem instead of one narrow centre strip.
        blend_width = .20 + .40*min(1, max(0, (.80-v.co.z)/.50))
        left = min(1, max(0, .5+v.co.x/blend_width))
        weights = [('Hips', hip)]
        for side, fraction in [('L', left), ('R', 1-left)]:
            weights += [('UpperLeg_'+side, (1-hip-knee)*fraction), ('LowerLeg_'+side, knee*fraction)]
        for name, weight in weights:
            if weight > 0:
                groups[name].add([v.index], weight, 'REPLACE')


def binding_surface(obj):
    """Capture a triangulated rest surface for ornament weight interpolation."""
    obj.data.calc_loop_triangles()
    points = [v.co.copy() for v in obj.data.vertices]
    triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
    weights = [{obj.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 0}
               for v in obj.data.vertices]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True), points, triangles, weights


def attach_to_surface(obj, surface, conform=False, offset=0):
    """Decoration inherits the underlying garment's interpolated skinning."""
    tree, points, triangles, weights = surface
    obj.vertex_groups.clear()
    for v in obj.data.vertices:
        hit, normal, face, _ = tree.find_nearest(v.co)
        a, b, c = triangles[face]
        u, w, p = points[b]-points[a], points[c]-points[a], hit-points[a]
        uu, ww, uw = u.dot(u), w.dot(w), u.dot(w)
        determinant = uu*ww-uw*uw
        assert abs(determinant) > 1e-16
        beta = (ww*p.dot(u)-uw*p.dot(w))/determinant
        gamma = (uu*p.dot(w)-uw*p.dot(u))/determinant
        if conform:
            # Leaf outline, front ridge and back centre remain distinct layers.
            clearance = .020 if v.index == 8 else (.006 if v.index == 9 else .009)
            v.co = hit+normal*(clearance+offset)
        combined = {}
        for index, factor in [(a, 1-beta-gamma), (b, beta), (c, gamma)]:
            for name, weight in weights[index].items():
                combined[name] = combined.get(name, 0)+max(0, factor)*weight
        strongest = sorted(combined.items(), key=lambda kv: kv[1], reverse=True)[:4]
        total = sum(weight for _, weight in strongest)
        assert total > 0
        for name, weight in strongest:
            if weight > 0:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([v.index], weight/total, 'REPLACE')


# Complete replaced source regions form the undergarment. Hands retain exposed skin;
# Head is deliberately absent because the crown is only an attachment.
for slot, src in base.items():
    if slot not in REPLACEMENT_SLOTS:
        continue
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = 'Wildwarden_' + slot + '_lining'
    collection.objects.link(obj)
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.modifiers.clear()
    for v in obj.data.vertices:
        v.co = world @ v.co
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (.0005 if slot in ['Head', 'HandLeft', 'HandRight'] else .002)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.clear()
    material = 'skin' if slot in ['Head', 'HandLeft', 'HandRight'] else ('leather' if slot.startswith('Leg') else 'cloth')
    obj.data.materials.append(materials[material])
    obj.data.materials.append(materials['leather'])
    for polygon in obj.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = False
        if slot.startswith('Hand') and abs(polygon.center.x) < .875:
            polygon.material_index = 1
    # Correct reversed thigh assignments without a discontinuity at x=0.
    if slot == 'Hips':
        vg = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            thigh = sum(g.weight for g in v.groups if vg[g.group] in ['UpperLeg_L', 'UpperLeg_R'])
            left = min(1, max(0, .5+v.co.x/.08))
            for name, fraction in [('UpperLeg_L', left), ('UpperLeg_R', 1-left)]:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.remove([v.index])
                if thigh*fraction > 0:
                    group.add([v.index], thigh*fraction, 'REPLACE')
    pieces[slot].append(obj)

# Layered bark scales conform to a torso-shaped envelope, front and back.
for row, (z, rx, depth, bone) in enumerate([(1.36, .193, .176, 'Spine_03'), (1.25, .195, .181, 'Spine_02'), (1.14, .167, .168, 'Spine_02'), (1.035, .153, .157, 'Spine_01')]):
    for back in [-1, 1]:
        for col in range(5):
            x = (col-2)*rx*.36
            y = back*(depth-.038*(abs(x)/rx)**2) + .010
            leaf('Woven_bark_%s_%s_%s' % (row, back, col), (x, y, z+.065), (x+(.010 if col % 2 else -.010), y+back*.010, z-.11), .044,
                 (0, back, 0), 'Torso', bone, 'bark' if (row+col) % 3 else 'bark_dark', .012)
# Broad ivory feather/leaf collar.
for sign in [-1, 1]:
    for i in range(5):
        x = sign*(.046+i*.027)
        leaf('Ivory_collar', (x, -.120-i*.009, 1.465-i*.013), (x*.64, -.196-i*.004, 1.285-i*.016), .016,
             (0, -1, 0), 'Torso', 'Spine_03', 'ivory', .008)
leaf('Heartwood_medallion', (0, -.213, 1.36), (0, -.224, 1.24), .037, (0, -1, 0), 'Torso', 'Spine_03', 'gold', .008)
leaf('Heartwood_jade', (0, -.228, 1.345), (0, -.238, 1.264), .022, (0, -1, 0), 'Torso', 'Spine_03', 'jade', .012)

# Bark and collar follow the body-derived vest, including torso bending.
vest_surface = binding_surface(pieces['Torso'][0])
for obj in pieces['Torso'][1:]:
    attach_to_surface(obj, vest_surface)

# One continuous A-line robe shell, not eight independently opening panels.
levels = [(.926,.195,.155),(.84,.214,.174),(.73,.235,.194),(.62,.253,.216),
          (.51,.267,.230),(.41,.281,.242),(.31,.291,.249),(.21,.302,.256),(.13,.308,.261)]
segments = 24
vertices = []
for row, (z, rx, ry) in enumerate(levels):
    for col in range(segments):
        angle = col*2*math.pi/segments
        pleat = 1 + .025*math.cos(angle*8)
        vertices.append((rx*math.sin(angle)*pleat, .015-ry*math.cos(angle)*pleat, z))
faces = []
for row in range(len(levels)-1):
    for col in range(segments):
        a, b = row*segments+col, row*segments+(col+1) % segments
        faces.extend([(a,b,b+segments),(a,b+segments,a+segments)])
robe = mesh('Continuous_robe_foundation', vertices, faces, 'Hips', 'leather')
robe_weights(robe)
robe_surface = binding_surface(robe)
bpy.context.view_layer.objects.active = robe
mod = robe.modifiers.new('Hem_thickness', 'SOLIDIFY'); mod.thickness = .004
bpy.ops.object.modifier_apply(modifier=mod.name)
robe['continuous_circumference'] = True
for sector in range(8):
    start_angle = sector*math.pi/4
    end_angle = (sector+1)*math.pi/4
    # Individual overlapping bark scales create the woven surface, not a texture.
    for row, (z, rx, ry) in enumerate([(.76,.232,.191),(.59,.268,.226),(.42,.290,.251),(.26,.307,.269)]):
        for col in range(2):
            angle = start_angle+(end_angle-start_angle)*(.27+col*.46)
            p = Vector((rx*math.sin(angle), .015-ry*math.cos(angle), z))
            obj = leaf('Robe_bark_scale', p+Vector((0, 0, .095)), p-Vector((0, 0, .080)), .047,
                       (math.sin(angle), -math.cos(angle), 0), 'Hips', None,
                       'bark' if (sector+row+col) % 3 else 'bark_dark', .008)
            attach_to_surface(obj, robe_surface, conform=True)
    for col in range(3):
        angle = start_angle+(end_angle-start_angle)*(.12+col*.38)
        p = Vector((.319*math.sin(angle), .015-.276*math.cos(angle), .17))
        obj = leaf('Golden_hem_leaf', p+Vector((0, 0, .085)), p-Vector((0, 0, .035)), .026,
                   (math.sin(angle), -math.cos(angle), 0), 'Hips', None, 'antler', .004)
        attach_to_surface(obj, robe_surface, conform=True)
sleeve('Woven_belt', [(0, .015, .906), (0, .015, .967)], [(.160, .201)]*2, 'Hips', 'Hips', 'bark_dark')
for z in [.908, .957]:
    sleeve('Belt_piping', [(0, .015, z), (0, .015, z+.008)], [(.164, .205)]*2, 'Hips', 'Hips', 'gold')
leaf('Belt_seed', (0, -.163, .963), (0, -.171, .904), .031, (0, -1, 0), 'Hips', 'Hips', 'jade')
for i in range(14):
    angle = (i+.5)*2*math.pi/14
    p = Vector((.214*math.sin(angle), .015-.177*math.cos(angle), .905))
    obj = leaf('Waist_foliage', p, p+Vector((.030*math.sin(angle), -.025*math.cos(angle), -.17-(i % 2)*.035)), .040,
               (math.sin(angle), -math.cos(angle), 0), 'Hips', None, 'leaf' if i % 2 else 'leaf_dark')
    attach_to_surface(obj, robe_surface, conform=True, offset=.017)

# Arm coordinates derive from joint heads; right bone tail axes are not mirrored.
rng = random.Random(731)
for side, suffix, word in [(1, 'L', 'Left'), (-1, 'R', 'Right')]:
    shoulder = Vector(rig.data.bones['Shoulder_'+suffix].head_local)
    elbow = Vector(rig.data.bones['Elbow_'+suffix].head_local)
    hand = Vector(rig.data.bones['Hand_'+suffix].head_local)
    axis = (elbow-shoulder).normalized()
    upper, lower = 'ArmUpper'+word, 'ArmLower'+word
    ub, lb = 'Shoulder_'+suffix, 'Elbow_'+suffix
    sleeve('Mantle_leather_base', [shoulder+axis*.015, shoulder+axis*.13, shoulder+axis*.225], [(.12, .12), (.11, .11), (.086, .086)], upper, ub, 'bark_dark')
    # Foliage only: five overlapping leaf tiers, no shoulder branches or twigs.
    for row in range(5):
        for j in range(11):
            angle = -math.pi*.69+j*math.pi*1.38/10+(row % 2)*.035
            radial = Vector((0, math.sin(angle), math.cos(angle)))
            root = shoulder+axis*(.004+row*.042)+radial*(.125-row*.007)
            tip = root+axis*(.125+rng.uniform(-.016, .024))+radial*(.042+rng.uniform(-.01, .012))
            leaf('Mantle_leaf', root, tip, .038+rng.uniform(-.005, .005), radial, upper, ub,
                 ['leaf', 'leaf_dark', 'leaf', 'leaf_light'][(row+j) % 4], .010)
    fore = (hand-elbow).normalized()
    sleeve('Leather_bracer', [elbow.lerp(hand, .13), elbow.lerp(hand, .43), elbow.lerp(hand, .92)], [(.079, .071), (.075, .071), (.057, .052)], lower, lb, 'antler')
    for t in [.16, .87]:
        p = elbow.lerp(hand, t)
        r = .080*(1-t)+.054*t
        sleeve('Bracer_binding', [p-fore*.007, p+fore*.007], [(r+.004, r)]*2, lower, lb, 'bark_dark')
    for j in [-1, 0, 1]:
        p = elbow.lerp(hand, .2)+Vector((0, -.077, j*.029))
        q = elbow.lerp(hand, .82)+Vector((0, -.062, j*.021))
        leaf('Bracer_root', p, q, .015, (0, -1, 0), lower, lb, 'bark')
    sleeve('Glove_cuff', [hand-fore*.016, hand+fore*.050], [(.054, .048), (.051, .044)], 'Hand'+word, 'Hand_'+suffix, 'leather')
    leaf('Glove_leaf', hand+Vector((side*.025, -.012, .052)), hand+Vector((side*.095, -.012, .047)), .024,
         (0, 0, 1), 'Hand'+word, 'Hand_'+suffix, 'leaf_dark')

# The original leg meshes also contain feet, preserving ankle and toe skinning.
for x, suffix, slot in [(-.113, 'R', 'LegLeft'), (.113, 'L', 'LegRight')]:
    sleeve('Boot_upper', [(x, .020, .10), (x, .020, .24), (x, .025, .39)], [(.087, .064), (.104, .074), (.109, .08)], slot, 'LowerLeg_'+suffix, 'leather')
    for z in [.13, .29, .365]:
        sleeve('Boot_wrap', [(x, .022, z), (x, .022, z+.017)], [(.114 if z > .2 else .094, .083 if z > .2 else .069)]*2, slot, 'LowerLeg_'+suffix, 'bark_light')
    leaf('Boot_cuff_leaf', (x, -.097, .395), (x, -.098, .285), .040, (0, -1, 0), slot, 'LowerLeg_'+suffix, 'leaf_dark')
    boot_surface = binding_surface(pieces[slot][0])
    for obj in pieces[slot][1:]:
        attach_to_surface(obj, boot_surface)

# Open antler crown: an attachment only. The textured game head remains visible.
sleeve('Crown_band', [(0, .005, 1.715), (0, .005, 1.742)], [(.144, .146), (.140, .143)], 'Crown', 'Neck', 'bark_dark', 16)
for side in [-1, 1]:
    path = [(side*.106, .016, 1.74), (side*.195, .018, 1.80), (side*.253, .030, 1.91), (side*.259, .044, 2.035), (side*.225, .050, 2.135)]
    branch('Crown_antler', path, [.030, .027, .021, .013, .0015], 'Crown', 'Neck', 'antler')
    branch('Crown_outer_tine', [path[1], (side*.302, .017, 1.863), (side*.35, .02, 1.962)], [.020, .010, .0015], 'Crown', 'Neck', 'antler')
    branch('Crown_inner_tine', [path[2], (side*.171, .021, 1.984), (side*.165, .024, 2.052)], [.016, .008, .0015], 'Crown', 'Neck', 'antler')
    branch('Crown_high_tine', [path[3], (side*.31, .06, 2.087)], [.010, .001], 'Crown', 'Neck', 'antler')
    for i in range(4):
        leaf('Crown_laurel', (side*(.025+i*.028), -.142+i*.013, 1.720),
             (side*(.060+i*.025), -.147+i*.013, 1.775+(i % 2)*.014), .023,
             (0, -1, 0), 'Crown', 'Neck', 'leaf' if i % 2 else 'leaf_dark')
leaf('Crown_seed_frame', (0, -.151, 1.823), (0, -.161, 1.690), .033, (0, -1, 0), 'Crown', 'Neck', 'gold')
leaf('Crown_seed_stone', (0, -.165, 1.793), (0, -.177, 1.711), .019, (0, -1, 0), 'Crown', 'Neck', 'jade', .014)

# Join each replacement region and bind every component to the shared source rig.
armor = {}
for slot, objects in pieces.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = PREFIX+slot
    obj.data.name = obj.name
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    modifier = obj.modifiers.new('Shared_body_skin', 'ARMATURE')
    modifier.object = rig
    if slot in BODY_SLOTS:
        obj['replaces'] = slot
        obj['complete_source_region_retained'] = True
    else:
        obj['attachment'] = True
    obj['hips_source_weights_corrected'] = slot == 'Hips'
    armor[slot] = obj
rig.data.pose_position = 'POSE'
bpy.context.view_layer.update()


def visible(slots):
    for slot in SLOTS:
        armor[slot].hide_render = slot not in slots
        armor[slot].hide_set(slot not in slots)
    for slot in BODY_SLOTS:
        base[slot].hide_render = slot in slots
        base[slot].hide_set(slot in slots)


def target(obj, point):
    obj.rotation_euler = (Vector(point)-obj.location).to_track_quat('-Z', 'Y').to_euler()


studio = bpy.data.collections.new('Preview_Studio')
scene.collection.children.link(studio)
for obj in list(scene.objects):
    if obj.type in ['LIGHT', 'CAMERA']:
        bpy.data.objects.remove(obj, do_unlink=True)
    elif obj.type == 'MESH' and obj not in base.values() and obj not in armor.values():
        obj.hide_render = True
cam = bpy.data.objects.new('Preview_Camera', bpy.data.cameras.new('Preview_Camera'))
studio.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.43
scene.camera = cam


def camera(view='hero'):
    cam.data.ortho_scale = 2.43
    cam.location = {'hero': (2.55, -7, 2.70), 'front': (0, -7, 1.65), 'back': (-2.55, 7, 2.7)}[view]
    target(cam, (0, 0, 1.05))


camera()
for name, loc, energy, size, color in [
    ('Key', (-3, -4, 5), 500, 4, (1, .91, .78)),
    ('Fill', (3, -2, 3), 300, 3, (.74, .86, 1)),
    ('Rim', (0, 3, 4), 620, 3, (.86, 1, .86)),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.size, data.color = energy, size, color
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = loc
    target(obj, (0, 0, 1))
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
floor = bpy.context.object
floor.name = 'Preview_Ground'
for coll in list(floor.users_collection):
    coll.objects.unlink(floor)
studio.objects.link(floor)
ground = bpy.data.materials.new('Preview_Ground')
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.041, .062, .064, 1)
ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .95
floor.data.materials.append(ground)
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.15, .20, .22, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .40
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = 1400
scene.render.resolution_percentage = 75 if QUICK else 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def render(name):
    scene.render.filepath = str(RENDERS/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('RENDER', name, flush=True)


report = {'source': source_path, 'name': 'Wildwarden', 'slots': {}, 'pose_checks': [],
          'version': 3, 'robe_foundation': 'continuous', 'shoulder_branches': 0,
          'head_attachment_only': True,
          'decoration_binding': 'barycentric garment weights',
          'collision_certified': False, 'cloth_simulation': False, 'source_overwritten': False}
for slot, obj in armor.items():
    obj.data.calc_loop_triangles()
    invalid = sum(not all(math.isfinite(c) for c in v.co) for v in obj.data.vertices)
    unweighted = sum(abs(sum(g.weight for g in v.groups)-1) > .001 for v in obj.data.vertices)
    zero_area = sum(p.area < 1e-12 for p in obj.data.polygons)
    report['slots'][slot] = {'vertices': len(obj.data.vertices), 'triangles': len(obj.data.loop_triangles),
                            'nonfinite_vertices': invalid, 'bad_weight_sums': unweighted, 'zero_area_faces': zero_area}
    assert not (invalid or unweighted or zero_area), (slot, report['slots'][slot])
report['total_triangles'] = sum(r['triangles'] for r in report['slots'].values())
assert report['total_triangles'] < 16000, report['total_triangles']
visible(SLOTS)
render('01_Wildwarden_Hero')
if not QUICK:
    camera('front'); render('02_Wildwarden_Front')
    camera('back'); render('03_Wildwarden_Back')
    camera()
    for i, part in enumerate(PARTS):
        visible(part.get('sourceRegions', part['regions'])); render('%02d_%s' % (10+i, part['item']))
    visible([]); render('00_Body_Reference')
    visible(SLOTS)
    cam.data.ortho_scale = .96
    cam.location = (.5, -2.5, 2.02)
    target(cam, (0, 0, 1.78)); render('30_Crown_Detail')
    camera()
    for name, changes in [
        ('Stride', {'UpperLeg_L': (.40, 0, 0), 'UpperLeg_R': (-.40, 0, 0), 'LowerLeg_L': (.50, 0, 0)}),
        ('Elbows', {'Elbow_L': (0, 0, .65), 'Elbow_R': (0, 0, -.65)}),
        ('TorsoTurn', {'Spine_02': (0, .30, 0), 'Spine_03': (0, .15, 0)}),
        ('HeadTurn', {'Neck': (0, .38, 0)}),
    ]:
        for b in rig.pose.bones:
            b.matrix_basis = pose[b.name]
        for bone, angles in changes.items():
            rot = Matrix.Identity(4)
            for angle, axis in zip(angles, 'XYZ'):
                rot = rot @ Matrix.Rotation(angle, 4, axis)
            rig.pose.bones[bone].matrix_basis = pose[bone] @ rot
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        points = []
        for obj in armor.values():
            ev = obj.evaluated_get(dg); data = ev.to_mesh()
            points.extend(ev.matrix_world @ v.co for v in data.vertices)
            ev.to_mesh_clear()
        assert all(all(math.isfinite(c) and abs(c) < 4 for c in p) for p in points), name
        report['pose_checks'].append({'pose': name, 'finite_and_bounded': True})
        render('20_Pose_'+name)
for b in rig.pose.bones:
    b.matrix_basis = pose[b.name]
bpy.context.view_layer.update()
visible(SLOTS)
camera()


def export(filename, objects):
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False)
    rig.select_set(True)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(ROOT/filename), export_format='GLB', use_selection=True,
                             export_animations=False, export_skins=True, export_extras=True)


if not QUICK:
    export('WoV_Wildwarden_Armor.glb', list(armor.values()))
    for part in PARTS:
        export(part['item']+'.glb', [armor[s] for s in part.get('sourceRegions', part['regions'])])
    visible(SLOTS)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'WoV_Wildwarden_Armor.blend'))
(ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
(ROOT/'equipment.json').write_text(json.dumps({'name': 'Wildwarden', 'prefix': PREFIX, 'parts': PARTS, 'hipsAlreadyFixed': True}, indent=2)+'\n')
print('DONE', report['total_triangles'], flush=True)
