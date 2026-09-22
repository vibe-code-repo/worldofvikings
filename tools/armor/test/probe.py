"""Read-only review probe for a built armor blend: collision measurements and posed renders.

blender --factory-startup -b ARMOR.blend --python-exit-code 1 --python THIS -- MASTER.blend TARGET_DIR
    --prefix=WoV_<Set>_ --regions=N --items=key:Region+Region,... --body=Male|Female
    [--measure-only] [--glow]

--prefix, --regions, --items and --body are all required. --items uses the same
key:Region[+Region...] syntax as render-compare.py. The measured "hard" surface of
a region is not chosen by material name or by a builder-specific mesh attribute:
it is the largest connected vertex island of that region's <PREFIX>Region mesh
object, which is set-agnostic (a lining and its outer shell are always separate
mesh islands in every build script that uses the Seidraven scaffold; the shell is
the bigger one). Nothing here saves the blend or changes it.

The saved .blend keeps the scaffold's own preview Fog Glow compositor (some sets
want it); off here by default so it does not carry into review renders that were
never meant to show it, --glow keeps whatever the saved .blend already has.
"""
import bpy, sys, math, json
from collections import defaultdict
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

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


def largest_island(obj):
    """Points and (locally reindexed) triangles of the object's largest connected vertex island."""
    points, triangles = evaluated(obj)
    parent = list(range(len(points)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i

    for a, b, c in triangles:
        ra, rb, rc = find(a), find(b), find(c)
        parent[ra] = rb
        if rc != rb:
            parent[find(rc)] = rb
    groups = defaultdict(list)
    for t in triangles:
        groups[find(t[0])].append(t)
    island = groups[max(groups, key=lambda root: len({v for t in groups[root] for v in t}))]
    used = sorted({v for t in island for v in t})
    remap = {old: new for new, old in enumerate(used)}
    return [points[i] for i in used], [tuple(remap[i] for i in t) for t in island]


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


islands = {slot: largest_island(armor[slot]) for slot in armor}
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
    """One BVH over the largest island of every measured region: an approximate shell for the
    'body in plate' check below. Rebuilt at every pose since islands were evaluated at rest."""
    points, triangles = [], []
    for slot in armor:
        pts, tris = largest_island(armor[slot]); base = len(points)
        points += pts; triangles += [tuple(i+base for i in t) for t in tris]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True)


# 1. Stand-off in the stored build pose: how far do the largest-island (outer shell)
# vertices of a region sit from the body underneath them.
standoff = {}
for slot in armor:
    tree = tree_of(evaluated(body[slot]))
    pts, _ = islands[slot]
    standoff[slot] = stats([tree.find_nearest(p)[3] for p in pts])
report['rim_standoff_m'] = standoff

# 2. Shoulder armor against arm and hand, arms down and arms overhead.
for label, angle in [('arms_down_40', 40), ('arms_overhead_-95', -95)]:
    arms(angle)
    shell = whole_body(); entry = {}
    for slot in ['ArmUpperLeft', 'ArmLowerLeft', 'HandLeft']:
        if slot not in armor:
            continue
        pts, _ = largest_island(armor[slot])
        entry[slot] = {'hard_vertices': len(pts), 'inside_body': stats(inside(pts, shell))}
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

# 4. Every item's armor-in-body collision AND body-in-plate containment, at four diagnostic poses.
for name, frame in [('Idle1', 31), ('CrouchIdle1', 62), ('BodyKickFromIdle', 21), ('KatanaAttack1FromIdle', 29)]:
    if name not in actions:
        continue
    activate(name, frame)
    body_shell = whole_body(); armor_shell = whole_armor(); entry = {}
    for key, item_regions in ITEMS:
        armor_pts = [p for s in item_regions if s in armor for p in largest_island(armor[s])[0]]
        body_pts = [p for s in item_regions if s in body for p in evaluated(body[s])[0]]
        entry[key] = {
            'hard_vertices': len(armor_pts), 'inside_body': stats(inside(armor_pts, body_shell)),
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
