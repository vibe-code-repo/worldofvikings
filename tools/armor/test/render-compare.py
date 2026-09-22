"""Shared comparison renders for a built armor set: turntable, per-item tiles, two diagnostic poses.

Blender -b ARMOR.blend --python-exit-code 1 --python THIS -- TARGET_DIR MASTER.blend
    --prefix=WoV_<Set>_ --regions=N --items=key:Region+Region,key2:Region3,...
    [--quick] [--glow] [--frame=<m>]

--prefix, --regions and --items are required; there is no per-set default, unlike
armor-motion.py. --items lists the set's items in display order, each as
key:Region[+Region...] (the body regions that item's armor mesh occupies under
--prefix), e.g. for Gravethorn:
  --items=hood:Head,shoulders:ArmUpperLeft+ArmUpperRight,vest:Torso,bracers:ArmLowerLeft+ArmLowerRight,gloves:HandLeft+HandRight,robe:Hips,boots:LegLeft+LegRight
Nothing here reads a material name or a builder-specific mesh attribute; both the
turntable and the per-item tiles only ever touch the <PREFIX>Region mesh objects
named by --items and --regions.

The four general-view turntable shots (front, three-quarter, side, back) fit the
camera to the actual geometry: the orthographic scale is derived from every item
object's rest-pose bounding radius around the vertical axis through the shot centre
(so it stays framed at every rotation angle, not just the one it happened to be
measured at) and its half-height, with a margin -- a fixed scale silently cropped
wide sets such as Seidraven's wings. --frame=<m> overrides the computed scale (for a
tighter or looser composition); giving one smaller than what the geometry needs is a
hard error naming the minimum, not a silent crop. The per-item tiles and the two
diagnostic poses (arms overhead, a master-clip crouch) already size themselves from
the geometry of what they show and are unaffected.

The scaffold's own build images keep its preview Fog Glow compositor (some sets want
the halo, e.g. Emberrage/Gravethorn); it is saved with the .blend and would otherwise
carry into every comparison image too, including sets without emission. Off here by
default; --glow keeps whatever the saved .blend already has.
"""
import bpy, sys, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--')+1:]
target_dir = Path(args[0]).resolve(); target_dir.mkdir(parents=True, exist_ok=True)
master_path = Path(args[1])
quick = '--quick' in args
prefix = next((a.split('=', 1)[1] for a in args if a.startswith('--prefix=')), None)
regions_arg = next((a.split('=', 1)[1] for a in args if a.startswith('--regions=')), None)
items_arg = next((a.split('=', 1)[1] for a in args if a.startswith('--items=')), None)
frame_arg = next((a.split('=', 1)[1] for a in args if a.startswith('--frame=')), None)
if not (prefix and regions_arg and items_arg):
    sys.exit('render-compare.py: --prefix=WoV_<Set>_, --regions=N and --items=key:Region+Region,... are all required')
regions = int(regions_arg)
ITEMS = [(spec.split(':', 1)[0], spec.split(':', 1)[1].split('+')) for spec in items_arg.split(',')]

scene = bpy.context.scene; rig = bpy.data.objects['WoV_Player_Armature']
if '--glow' not in args:
    scene.compositing_node_group = None
armor = {o.name[len(prefix):]: o for o in scene.objects if o.type == 'MESH' and o.name.startswith(prefix)}
assert len(armor) == regions, (len(armor), regions)
for o in scene.objects:
    if o.type == 'MESH':
        o.hide_render = o not in armor.values()
for o in armor.values():
    o.hide_set(False)
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.018, .018, .020, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 1
cam = scene.camera; cam.data.type = 'ORTHO'
lights = [o for o in scene.objects if o.type == 'LIGHT']; home = {o.name: o.matrix_world.copy() for o in lights}
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
# The shared builder used Standard; do not inherit this builder's AgX look.
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -.55
stored = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}


def restore():
    if rig.animation_data:
        rig.animation_data.action = None
    for n, m in stored.items():
        rig.pose.bones[n].matrix_basis = m
    bpy.context.view_layer.update()


def fit_scale(objects, centre, size, margin=1.08):
    """The orthographic scale (Blender's own convention: the view size along the LONGER
    render dimension) so every vertex of `objects`, evaluated in the pose they are about
    to be shot in, stays inside the frame at `centre`, at every rotation angle around the
    vertical (Z) axis through it -- so one number frames the whole turntable, not just the
    angle it happened to be checked at."""
    dg = bpy.context.evaluated_depsgraph_get()
    radius = half_height = 0.0
    for obj in objects:
        ev = obj.evaluated_get(dg); data = ev.to_mesh()
        for v in data.vertices:
            p = ev.matrix_world @ v.co
            radius = max(radius, math.hypot(p.x - centre[0], p.y - centre[1]))
            half_height = max(half_height, abs(p.z - centre[2]))
        ev.to_mesh_clear()
    width, height = size
    long_side, short_side = max(width, height), min(width, height)
    needed_for_height = 2 * half_height * margin
    needed_for_width = 2 * radius * margin * (long_side / short_side)
    return max(needed_for_height, needed_for_width)


def shoot(name, angle, centre=(0, 0, 1.12), scale=2.50, size=(900, 1200), height=None):
    turn = Matrix.Rotation(math.radians(angle), 4, 'Z')
    for o in lights:
        o.matrix_world = turn @ home[o.name]
    eye = turn @ Vector((0, -8, 0))
    cam.location = (eye.x+centre[0], eye.y+centre[1], centre[2] if height is None else height)
    cam.rotation_euler = (Vector(centre)-cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = str(target_dir/(name+'.png')); bpy.ops.render.render(write_still=True)


def swing(bone, axis, angle):
    pb = rig.pose.bones[bone]; head = rig.matrix_world @ pb.head
    turn = Matrix.Translation(head) @ Matrix.Rotation(math.radians(angle), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = rig.matrix_world.inverted() @ turn @ rig.matrix_world @ pb.matrix
    bpy.context.view_layer.update()


def diagnostic_poses():
    restore()
    if 'Shoulder_L' in rig.pose.bones and 'Shoulder_R' in rig.pose.bones:
        for side, sign in [('L', 1), ('R', -1)]:
            swing('Shoulder_'+side, Vector((0, 1, 0)), -95*sign)
        shoot('pose-arme-hoch', 0, (0, 0, 1.30), 2.9)
        restore()
    with bpy.data.libraries.load(str(master_path), link=False) as (source, destination):
        destination.actions = ['CrouchIdle1']
    action = destination.actions[0]
    rig.animation_data_create()
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    scene.frame_set(62); bpy.context.view_layer.update()
    shoot('pose-hocke', 0, (0, 0, .95), 2.3)


metrics = {'view_transform': scene.view_settings.view_transform, 'exposure': scene.view_settings.exposure,
           'camera_height_m': 1.12, 'image_size': [900, 1200]}
if 'ArmUpperLeft' in armor and 'ArmUpperRight' in armor:
    for side, sign in [('L', 1), ('R', -1)]:
        swing('Shoulder_'+side, Vector((0, 1, 0)), sign*40)
        pb = rig.pose.bones['Elbow_'+side]
        along = ((rig.matrix_world@pb.tail)-(rig.matrix_world@pb.head)).normalized()
        swing('Elbow_'+side, along.cross(Vector((0, -1, 0))).normalized(), 14)
    dg = bpy.context.evaluated_depsgraph_get(); shoulder_x = []
    for key in ['ArmUpperLeft', 'ArmUpperRight']:
        ev = armor[key].evaluated_get(dg); data = ev.to_mesh()
        shoulder_x.extend((ev.matrix_world@v.co).x for v in data.vertices); ev.to_mesh_clear()
    metrics['arms_down_shoulder_width_m'] = max(shoulder_x)-min(shoulder_x)
turntable_centre = (0, 0, 1.12); turntable_size = (900, 1200)
needed_scale = fit_scale(armor.values(), turntable_centre, turntable_size)
if frame_arg is not None:
    turntable_scale = float(frame_arg)
    if turntable_scale < needed_scale:
        sys.exit(f'render-compare.py: --frame={frame_arg} is too small; the item objects need '
                 f'at least {needed_scale:.3f} m to stay fully in frame at every turntable angle')
else:
    turntable_scale = needed_scale
metrics['orthographic_scale'] = turntable_scale
(target_dir/'comparison-pose-metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
views = [('vergleich-1-front', 0), ('vergleich-2-dreiviertel', -42), ('vergleich-3-seite', -90), ('vergleich-4-ruecken', 180)]
for name, angle in views:
    if not quick or angle in [0, -90, 180]:
        shoot(name, angle, turntable_centre, turntable_scale, turntable_size)
if quick:
    diagnostic_poses()
    print('DONE', flush=True)
    sys.exit(0)
restore()
cell = 600; tiles = []
for key, item_regions in ITEMS:
    for slot, obj in armor.items():
        obj.hide_render = slot not in item_regions
    dg = bpy.context.evaluated_depsgraph_get(); points = []
    for slot in item_regions:
        ev = armor[slot].evaluated_get(dg); data = ev.to_mesh()
        points += [ev.matrix_world@v.co for v in data.vertices]; ev.to_mesh_clear()
    lo = Vector([min(p[i] for p in points) for i in range(3)])
    hi = Vector([max(p[i] for p in points) for i in range(3)])
    centre = (lo+hi)/2; extent = max((hi-lo).x*.95, (hi-lo).z, .35)*1.18
    name = '_item_'+key; shoot(name, -28, tuple(centre), extent, (cell, cell), centre.z+extent*.9)
    tiles.append(target_dir/(name+'.png'))
cols = min(4, len(tiles)); rows = -(-len(tiles)//cols)  # ceil
sheet = np.zeros((rows*cell, cols*cell, 4), dtype=np.float32); sheet[..., 3] = 1
for i, path in enumerate(tiles):
    image = bpy.data.images.load(str(path)); pixels = np.array(image.pixels[:], dtype=np.float32).reshape(cell, cell, 4)
    row, col = divmod(i, cols)
    if i == 0:
        sheet[..., :] = pixels[2, 2]
    sheet[(rows-1-row)*cell:(rows-row)*cell, col*cell:(col+1)*cell] = pixels
    bpy.data.images.remove(image); path.unlink()
out = bpy.data.images.new('items', cols*cell, rows*cell, alpha=True)
out.pixels = sheet.ravel().tolist(); out.filepath_raw = str(target_dir/'vergleich-items.png'); out.file_format = 'PNG'; out.save()
for obj in armor.values():
    obj.hide_render = False
diagnostic_poses()
print('DONE', flush=True)
