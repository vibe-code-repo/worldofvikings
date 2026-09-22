"""Read-only review probe for a built armor blend: collision measurements and posed renders.

blender --factory-startup -b ARMOR.blend --python-exit-code 1 --python THIS -- MASTER.blend TARGET_DIR
    --prefix=WoV_<Set>_ --regions=N --items=key:Region+Region,... --body=Male|Female
    [--measure-only] [--glow]

--prefix, --regions, --items and --body are all required. --items uses the same
key:Region[+Region...] syntax as render-compare.py. Nothing here saves the blend or
changes it.

Every item mesh's vertices are split into two named, geometrically determined
populations -- not by material name, not by a builder-specific mesh attribute (an
earlier version of this tool picked the region's largest connected vertex island as
"the outer shell", which an independent attack found to be wrong: at Gravethorn's
hips the largest island IS the lining, at the torso it is only part of it, and at
every limb it is a single hard plate with zero lining vertices on it -- the same
selection means a different thing in every region):

- `lining`: vertices that geometrically match the scaffold's own lining recipe
  (sets/seidraven/build_common.py, "Complete source regions form the retained
  lining/body under the armor"): take the source body region, weld at 1e-5 m,
  recompute normals, and push every vertex out along its normal by the scaffold's
  own gap (0.0005 m for Head/HandLeft/HandRight, 0.002 m elsewhere). An item vertex
  within 1e-5 m of one of those points is lining. This reconstructs the recipe from
  the body, not from the item, so it does not depend on how the item's geometry was
  authored.
- `hard`: every other vertex of the item mesh -- decorative or structural, whatever
  is not lining.

`body_outside_plate` measures against a shell built from `hard` vertices only (the
visible plate a body could stick out through); `inside_body` is reported for both
populations at every diagnostic pose, each explicitly labelled.

The saved .blend keeps the scaffold's own preview Fog Glow compositor (some sets
want it); off here by default so it does not carry into review renders that were
never meant to show it, --glow keeps whatever the saved .blend already has.
"""
import bpy, bmesh, sys, math, json
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

# The scaffold's own lining gap (sets/seidraven/build_common.py:224); every set built
# from that scaffold uses these two constants for every region.
_LINING_GAP_SMALL_M = .0005    # Head, HandLeft, HandRight
_LINING_GAP_M = .002           # every other region
_LINING_SMALL_SLOTS = ('Head', 'HandLeft', 'HandRight')
_WELD_M = 1e-5                 # bmesh.ops.remove_doubles distance the scaffold itself uses
_MATCH_M = 1e-5                # position-match tolerance to call an item vertex "lining"

args = sys.argv[sys.argv.index('--')+1:]
master, target = Path(args[0]), Path(args[1]).resolve(); target.mkdir(parents=True, exist_ok=True)
MEASURE_ONLY = '--measure-only' in args
prefix = next((a.split('=', 1)[1] for a in args if a.startswith('--prefix=')), None)
regions_arg = next((a.split('=', 1)[1] for a in args if a.startswith('--regions=')), None)
items_arg = next((a.split('=', 1)[1] for a in args if a.startswith('--items=')), None)
variant = next((a.split('=', 1)[1] for a in args if a.startswith('--body=')), None)
if not (prefix and regions_arg and items_arg and variant):
    sys.exit('probe.py: --prefix=WoV_<Set>_, --regions=N, --items=key:Region+Region,... and '
             '--body=Male|Female are all required')
regions = int(regions_arg)
ITEMS = [(spec.split(':', 1)[0], spec.split(':', 1)[1].split('+')) for spec in items_arg.split(',')]
SLOTS = ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight',
         'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight']

scene = bpy.context.scene
if '--glow' not in args:
    scene.compositing_node_group = None
rig = bpy.data.objects['WoV_Player_Armature']
armor = {o.name[len(prefix):]: o for o in scene.objects if o.type == 'MESH' and o.name.startswith(prefix)}
assert len(armor) == regions, (len(armor), regions)
body = {s: bpy.data.objects['WoV_BodyBase_'+variant+'_'+s] for s in SLOTS}
for obj in list(armor.values())+list(body.values()):
    obj.hide_set(False); obj.hide_viewport = False   # hidden objects are not evaluated
bpy.context.view_layer.update()
report = {'asset': bpy.data.filepath, 'body_has_armature_modifier':
          {s: any(m.type == 'ARMATURE' for m in body[s].modifiers) for s in ['Torso', 'Head']}}


def evaluated(obj):
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg); data = ev.to_mesh()
    points = [ev.matrix_world @ v.co for v in data.vertices]
    data.calc_loop_triangles()
    triangles = [tuple(t.vertices) for t in data.loop_triangles]
    ev.to_mesh_clear()
    return points, triangles


def lining_ids(obj, body_obj, slot):
    """Indices (in obj.data.vertices, rest pose) of the item mesh's vertices that match the
    scaffold's own lining recipe reconstructed from the source body region -- see the module
    docstring. Index-based and computed once at rest, so it stays valid across every pose
    (posing moves vertex positions, never their indices or count)."""
    bm = bmesh.new()
    bm.from_mesh(body_obj.data)
    for v in bm.verts:
        v.co = body_obj.matrix_world @ v.co
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=_WELD_M)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    gap = _LINING_GAP_SMALL_M if slot in _LINING_SMALL_SLOTS else _LINING_GAP_M
    expected = [v.co + v.normal * gap for v in bm.verts]
    bm.free()
    kd = KDTree(len(expected))
    for i, p in enumerate(expected):
        kd.insert(p, i)
    kd.balance()
    return {v.index for v in obj.data.vertices if kd.find(obj.matrix_world @ v.co)[2] < _MATCH_M}


def population(obj, body_obj, slot):
    """(lining_ids, hard_ids): a full index partition of obj.data.vertices, rest pose."""
    lining = lining_ids(obj, body_obj, slot)
    hard = set(range(len(obj.data.vertices))) - lining
    return lining, hard


def population_points(obj, ids):
    """Evaluated (posed) points of the item mesh restricted to an index set from population()."""
    points, _ = evaluated(obj)
    return [points[i] for i in ids if i < len(points)]


def population_subset(obj, ids):
    """Evaluated points and locally reindexed triangles restricted to an index set: a
    trimmed sub-mesh for building a BVH shell from one population only. A triangle survives
    only if every one of its vertices is in `ids` (a triangle straddling the lining/hard
    boundary is dropped from both, which never happens for a proper Seidraven-scaffold
    lining -- it is a topologically separate piece, sharing no triangle with the shell)."""
    points, triangles = evaluated(obj)
    kept = [t for t in triangles if all(i in ids for i in t)]
    used = sorted({v for t in kept for v in t})
    remap = {old: new for new, old in enumerate(used)}
    return [points[i] for i in used], [tuple(remap[i] for i in t) for t in kept]


def tree_of(points_triangles):
    points, triangles = points_triangles
    return BVHTree.FromPolygons(points, triangles, all_triangles=True)


def stats(values):
    values = sorted(values)
    if not values:
        return None
    pick = lambda q: round(values[min(len(values)-1, int(q*len(values)))], 4)
    return {'n': len(values), 'median': pick(.5), 'p90': pick(.9), 'max': round(values[-1], 4)}


def parity_votes(p, tree):
    votes = 0
    for d in [Vector((1, .013, .007)), Vector((-.011, 1, .017)), Vector((.009, -.015, 1))]:
        d.normalize(); origin = p.copy(); crossings = 0
        while crossings < 60:
            hit = tree.ray_cast(origin, d)[0]
            if hit is None:
                break
            crossings += 1; origin = hit+d*1e-5
        votes += crossings % 2
    return votes


def inside(points, tree):
    """Distance to the nearest surface of every point that lies inside a closed shell."""
    return [tree.find_nearest(p)[3] for p in points if parity_votes(p, tree) >= 2]


def outside(points, tree):
    """Distance to the nearest surface of every point that lies outside a closed shell."""
    return [tree.find_nearest(p)[3] for p in points if parity_votes(p, tree) < 2]


populations = {slot: population(armor[slot], body[slot], slot) for slot in armor}
report['population_vertices'] = {
    slot: {'total': len(lining) + len(hard), 'lining': len(lining), 'hard': len(hard)}
    for slot, (lining, hard) in populations.items()
}
stored = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}


def restore():
    if rig.animation_data:
        rig.animation_data.action = None
    for bone, basis in stored.items():
        rig.pose.bones[bone].matrix_basis = basis
    bpy.context.view_layer.update()


def swing(bone, axis, angle):
    pb = rig.pose.bones[bone]; head = rig.matrix_world @ pb.head
    turn = Matrix.Translation(head) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-head)
    pb.matrix = rig.matrix_world.inverted() @ turn @ rig.matrix_world @ pb.matrix
    bpy.context.view_layer.update()


def arms(angle):
    restore()
    if 'Shoulder_L' in rig.pose.bones and 'Shoulder_R' in rig.pose.bones:
        for side, sign in [('L', 1), ('R', -1)]:
            swing('Shoulder_'+side, Vector((0, 1, 0)), sign*math.radians(angle))


def whole_body():
    """One BVH over all eleven body regions: a closed shell, so ray parity decides inside/outside."""
    points, triangles = [], []
    for obj in body.values():
        pts, tris = evaluated(obj); base = len(points)
        points += pts; triangles += [tuple(i+base for i in t) for t in tris]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True)


def whole_armor():
    """One BVH over the `hard` population of every measured region: the visible plate a body
    part could stick out through. Rebuilt at every pose since population() indices are
    rest-pose but the points must be evaluated at the current pose."""
    points, triangles = [], []
    for slot in armor:
        _, hard = populations[slot]
        pts, tris = population_subset(armor[slot], hard); base = len(points)
        points += pts; triangles += [tuple(i+base for i in t) for t in tris]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True)


# 1. Stand-off in the stored build pose: how far do a region's lining and hard vertices sit
# from the body underneath them (lining should read close to the scaffold's own gap -- a
# sanity check on the reconstruction itself, not just a collision number).
standoff = {}
for slot in armor:
    tree = tree_of(evaluated(body[slot]))
    lining, hard = populations[slot]
    standoff[slot] = {
        'lining': stats([tree.find_nearest(p)[3] for p in population_points(armor[slot], lining)]),
        'hard': stats([tree.find_nearest(p)[3] for p in population_points(armor[slot], hard)]),
    }
report['rim_standoff_m'] = standoff

# 2. Shoulder armor against arm and hand, arms down and arms overhead: both populations.
for label, angle in [('arms_down_40', 40), ('arms_overhead_-95', -95)]:
    arms(angle)
    shell = whole_body(); entry = {}
    for slot in ['ArmUpperLeft', 'ArmLowerLeft', 'HandLeft']:
        if slot not in armor:
            continue
        lining, hard = populations[slot]
        entry[slot] = {
            'lining': {'vertices': len(lining), 'inside_body': stats(inside(population_points(armor[slot], lining), shell))},
            'hard': {'vertices': len(hard), 'inside_body': stats(inside(population_points(armor[slot], hard), shell))},
        }
    if entry:
        report[label] = entry
restore()

# 3. Does the Head bone move against the Neck bone in the master clips? (helm parts bound to Neck would not follow)
clips = ['Idle1', 'WalkFwd', 'RunFwd', 'CrouchIdle1', 'KatanaAttack1FromIdle', 'BodyKickFromIdle', 'JumpUp']
with bpy.data.libraries.load(str(master), link=False) as (source, destination):
    destination.actions = [c for c in clips if c in source.actions]
actions = {a.name: a for a in destination.actions}
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True


def activate(name, frame):
    rig.animation_data.action = actions[name]
    if actions[name].slots:
        rig.animation_data.action_slot = actions[name].slots[0]
    for b in rig.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    scene.frame_set(frame); bpy.context.view_layer.update()


neck, head = rig.pose.bones['Neck'], rig.pose.bones['Head']
rest = neck.bone.matrix_local.inverted() @ head.bone.matrix_local
headneck = {}
for name, action in actions.items():
    first, last = map(int, action.frame_range); worst = (0, first)
    for frame in range(first, last+1, 2):
        activate(name, frame)
        relative = rest.inverted() @ (neck.matrix.inverted() @ head.matrix)
        angle = math.degrees(relative.to_quaternion().angle)
        worst = max(worst, (angle, frame))
    headneck[name] = {'max_head_vs_neck_deg': round(worst[0], 2), 'frame': worst[1]}
report['head_vs_neck'] = headneck

# 4. Every item's armor-in-body collision (both populations) AND body-in-plate containment
# (against the `hard`-only shell -- explicitly the population body_outside_plate uses), at
# four diagnostic poses.
report['body_outside_plate_population'] = 'hard'
for name, frame in [('Idle1', 31), ('CrouchIdle1', 62), ('BodyKickFromIdle', 21), ('KatanaAttack1FromIdle', 29)]:
    if name not in actions:
        continue
    activate(name, frame)
    body_shell = whole_body(); armor_shell = whole_armor(); entry = {}
    for key, item_regions in ITEMS:
        lining_pts = [p for s in item_regions if s in armor for p in population_points(armor[s], populations[s][0])]
        hard_pts = [p for s in item_regions if s in armor for p in population_points(armor[s], populations[s][1])]
        body_pts = [p for s in item_regions if s in body for p in evaluated(body[s])[0]]
        entry[key] = {
            'lining': {'vertices': len(lining_pts), 'inside_body': stats(inside(lining_pts, body_shell))},
            'hard': {'vertices': len(hard_pts), 'inside_body': stats(inside(hard_pts, body_shell))},
            'body_vertices': len(body_pts), 'body_outside_plate': stats(outside(body_pts, armor_shell)),
        }
    report['%s_%d' % (name, frame)] = entry
(target/'probe.json').write_text(json.dumps(report, indent=2)+'\n')
print('MEASURED', flush=True)

# 5. Renders
for o in scene.objects:
    if o.type == 'MESH':
        o.hide_render = o.name not in [a.name for a in armor.values()]
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.018, .018, .020, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
cam = scene.camera; cam.data.type = 'ORTHO'
lights = [o for o in scene.objects if o.type == 'LIGHT']; home = {o.name: o.matrix_world.copy() for o in lights}
scene.render.resolution_percentage = 100


def shoot(name, angle, centre=(0, 0, 1.12), scale=2.5, size=(900, 1200)):
    turn = Matrix.Rotation(math.radians(angle), 4, 'Z')
    for o in lights:
        o.matrix_world = turn @ home[o.name]
    eye = turn @ Vector((0, -8, 0))
    cam.location = (eye.x+centre[0], eye.y+centre[1], centre[2])
    cam.rotation_euler = (Vector(centre)-cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(target/(name+'.png')); bpy.ops.render.render(write_still=True)
    print('RENDER', name, flush=True)


if MEASURE_ONLY:
    if 'KatanaAttack1FromIdle' in actions:
        activate('KatanaAttack1FromIdle', 29)
        centre = rig.matrix_world @ rig.pose.bones['Head'].head
        shoot('angriff1-bild29-kopf', 0, (centre.x, centre.y, centre.z+.12), 1.0, (900, 900))
        shoot('angriff1-bild29-kopf-seite', -90, (centre.x, centre.y, centre.z+.12), 1.0, (900, 900))
    print('DONE', flush=True); sys.exit(0)
restore()
shoot('ruhe-seite-nah-kopf-brust', -90, (0, 0, 1.50), .95, (900, 900))
shoot('ruhe-dreiviertel-nah-kopf-brust', -42, (0, 0, 1.50), .95, (900, 900))
arms(40)
shoot('arme-unten-front', 0); shoot('arme-unten-dreiviertel', -42)
arms(-95)
shoot('arme-hoch-front', 0, (0, 0, 1.30), 2.9)
restore()
if 'CrouchIdle1' in actions:
    activate('CrouchIdle1', 62); shoot('hocke-front', 0, (0, 0, .95), 2.3); shoot('hocke-seite', -90, (0, 0, .95), 2.3)
if 'BodyKickFromIdle' in actions:
    activate('BodyKickFromIdle', 21); shoot('tritt-seite', -90, (0, 0, 1.05), 2.6)
print('DONE', flush=True)
