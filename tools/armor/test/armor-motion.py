"""Evaluate full master clips and render diagnostic poses without changing assets.

Blender -b armor.blend --python-exit-code 1 --python THIS -- master.blend OUTPUT --regions=N
Optional --quick checks three clips and produces only a three-pose contact sheet.
Use --prefix=WoV_Ashenveil_ to test another set; the default is WoV_Wildwarden_.
--regions=N is required: the exact number of <PREFIX>-named armor mesh objects the
build produced (11 for the eleven-region sets; fewer for a set that replaces only
some body regions, e.g. 8 for Plainhide). --keep-body=Region,Region names source-body
regions (matched as WoV_BodyBase_*_Region, any body variant) that stay visible next to
the armor in the renders and the overview montage because the set does not replace
them, e.g. --keep-body=Head,HandLeft,HandRight; default none, matching every set that
replaces all eleven regions. A region outside the eleven-region body, one this armor
already replaces (it would then show twice), or a second --keep-body option are all
refused with a message; an empty list and a region repeated within one --keep-body
change nothing and are allowed (see keep_body.py, tested without Blender in
keep-body-args.mjs).

Known gap, not closed here (follow-up card): `--keep-body Head` (a space instead of
`=`) is not recognized as the option at all, so it is silently read as no --keep-body
and returns an empty list -- unlike --regions, which does reject a missing `=`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from keep_body import KeepBodyError, parse_keep_body  # noqa: E402

import bpy
import json
import numpy as np
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--')+1:]
master_path, output_path = Path(args[0]), Path(args[1])
output_path.mkdir(parents=True, exist_ok=True)
quick = '--quick' in args
compact = '--compact' in args
prefix = next((a.split('=',1)[1] for a in args if a.startswith('--prefix=')), 'WoV_Wildwarden_')
assert prefix.startswith('WoV_') and prefix.endswith('_') and prefix.replace('_','').isalnum()
family = prefix[4:-1]
regions_arg = next((a.split('=',1)[1] for a in args if a.startswith('--regions=')), None)
if regions_arg is None:
    sys.exit('armor-motion.py: missing required --regions=N (the number of armor mesh '
             'objects the build produced under --prefix); see the module docstring')
regions = int(regions_arg)


def is_kept_body(obj):
    return obj.name.startswith('WoV_BodyBase_') and obj.name.endswith(tuple('_'+r for r in keep_body))


scene = bpy.context.scene
rig = bpy.data.objects['WoV_Player_Armature']
armor = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(prefix)]
assert len(armor) == regions, (len(armor), regions)
try:
    keep_body = parse_keep_body(args, {o.name[len(prefix):] for o in armor})
except KeepBodyError as error:
    sys.exit(f'armor-motion.py: {error}')
names = ['Idle1', 'WalkFwd', 'CrouchIdle1'] if quick else [
    'Idle1', 'WalkFwd', 'WalkBwd', 'WalkStrafeLeft', 'RunFwd', 'RunStrafeLeft',
    'StartRunFwd', 'StopLeftRunFwd', 'JumpStart', 'JumpUp', 'JumpMidAir', 'FallEnd',
    'CrouchIdle1', 'CrouchFwd', 'BodyKickFromIdle', 'KatanaAttack1FromIdle',
    'KatanaAttack2FromIdle', 'KatanaAttack3FromIdle', 'KatanaParryLeft',
]
with bpy.data.libraries.load(str(master_path), link=False) as (source, destination):
    assert all(n in source.actions for n in names), set(names)-set(source.actions)
    destination.actions = list(names)
    destination.objects = ['WoV_Player_Armature']
reference = destination.objects[0]
assert set(rig.data.bones.keys()) == set(reference.data.bones.keys())
matrix_error = max(abs(rig.data.bones[n].matrix_local[i][j]-reference.data.bones[n].matrix_local[i][j])
                   for n in rig.data.bones.keys() for i in range(4) for j in range(4))
assert matrix_error < 1e-6
bpy.data.objects.remove(reference, do_unlink=True)
actions = dict(zip(names, destination.actions))
for action in actions.values():
    action.use_fake_user = True
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.data.pose_position = 'POSE'
for obj in scene.objects:
    if obj.type == 'MESH' and obj not in armor and obj.name != 'Preview_Ground':
        obj.hide_render = not is_kept_body(obj)
for obj in armor:
    obj.hide_render = False
    obj.hide_set(False)
cam = scene.camera


def activate(name, frame):
    rig.animation_data.action = actions[name]
    if actions[name].slots:
        rig.animation_data.action_slot = actions[name].slots[0]
    # Clear unanimated components from the saved presentation pose.
    for b in rig.pose.bones:
        b.matrix_basis = Matrix.Identity(4)
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def geometry(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    points = np.empty(len(data.vertices)*3, dtype=np.float64)
    data.vertices.foreach_get('co', points)
    points = points.reshape((-1,3))
    world = np.array(evaluated.matrix_world)
    points = points @ world[:3,:3].T + world[:3,3]
    evaluated.to_mesh_clear()
    return points


report = {'asset': bpy.data.filepath, 'master': str(master_path), 'rest_matrix_error': matrix_error,
          'method': 'every integer source frame; selected stills and montage',
          'collisions_certified': False, 'runtime_layers_tested': False, 'clips': []}
wing_vertices = {}
for obj in armor:
    for bone in ['Shoulder_Attachment_L', 'Shoulder_Attachment_R']:
        group = obj.vertex_groups.get(bone)
        if not group:
            continue
        indices = [v.index for v in obj.data.vertices
                   if len(v.groups) == 1 and v.groups[0].group == group.index and abs(v.groups[0].weight-1) < 1e-6]
        if indices:
            points = np.array([list(obj.data.vertices[i].co)+[1] for i in indices])
            wing_vertices[(obj.name,bone)] = (indices,points)
report['wing_attachment_vertices'] = sum(len(indices) for indices,_ in wing_vertices.values())
report['wing_max_attachment_error_m'] = 0
robe = next(o for o in armor if o.name.endswith('_Hips'))
rest_points = np.array([list(robe.matrix_world@v.co) for v in robe.data.vertices])
edges = np.array([list(e.vertices) for e in robe.data.edges])
lengths = np.linalg.norm(rest_points[edges[:,1]]-rest_points[edges[:,0]], axis=1)
valid_edges = lengths > .002
lengths = lengths[valid_edges]
edges = edges[valid_edges]
for name, action in actions.items():
    first, last = map(int, action.frame_range)
    entry = {'name': name, 'frames': [first,last], 'evaluated_frames': 0,
             'finite': True, 'max_span_m': 0, 'robe_lowest_z': 999, 'robe_max_edge_stretch': 1,
             'robe_max_edge_stretch_frame': first, 'robe_below_boots_m': 0}
    for frame in range(first, last+1):
        activate(name, frame)
        all_points = []
        robe_min, boots_min = 999, 999
        for obj in armor:
            p = geometry(obj)
            assert np.isfinite(p).all(), (name, frame, obj.name)
            for bone in ['Shoulder_Attachment_L', 'Shoulder_Attachment_R']:
                if (obj.name,bone) not in wing_vertices:
                    continue
                indices, rest = wing_vertices[(obj.name,bone)]
                matrix = np.array(rig.matrix_world @ rig.pose.bones[bone].matrix @ rig.data.bones[bone].matrix_local.inverted())
                expected = (rest @ matrix.T)[:,:3]
                error = float(np.abs(p[indices]-expected).max())
                report['wing_max_attachment_error_m'] = max(report['wing_max_attachment_error_m'],error)
                assert error < 1e-5, (name,frame,obj.name,bone,error)
            all_points.append(p)
            if obj.name.endswith(('_LegLeft', '_LegRight')):
                boots_min = min(boots_min, float(p[:,2].min()))
            if obj == robe:
                robe_min = float(p[:,2].min())
                entry['robe_lowest_z'] = min(entry['robe_lowest_z'], float(p[:,2].min()))
                stretch = np.linalg.norm(p[edges[:,1]]-p[edges[:,0]], axis=1)/lengths
                maximum = float(stretch.max())
                if maximum > entry['robe_max_edge_stretch']:
                    entry['robe_max_edge_stretch'] = maximum
                    entry['robe_max_edge_stretch_frame'] = frame
        entry['robe_below_boots_m'] = max(entry['robe_below_boots_m'], boots_min-robe_min)
        p = np.concatenate(all_points)
        span = float((p.max(axis=0)-p.min(axis=0)).max())
        assert span < 4, (name, frame, span)
        entry['max_span_m'] = max(entry['max_span_m'], span)
        entry['evaluated_frames'] += 1
    report['clips'].append(entry)
    print('CLIP', json.dumps(entry), flush=True)


def aim(camera, point):
    camera.rotation_euler = (Vector(point)-camera.location).to_track_quat('-Z','Y').to_euler()


def view(name='front'):
    center = rig.matrix_world@rig.pose.bones['Hips'].head
    focus = Vector((center.x, center.y, 1.06))
    cam.location = focus+Vector({'front': (0,-7,.3), 'side': (7,-.3,.3), 'back': (0,7,.3)}[name])
    cam.data.ortho_scale = 2.95 if wing_vertices else 2.50
    aim(cam, focus)
    scene.render.resolution_x = scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100


def render(name):
    scene.render.filepath = str(output_path/(name+'.png'))
    bpy.ops.render.render(write_still=True)


if not quick:
    stills = [('Idle1',31), ('WalkFwd',9), ('RunFwd',5), ('CrouchIdle1',62),
              ('BodyKickFromIdle',20), ('KatanaAttack1FromIdle',20)]
    for name, frame in stills:
        action = actions[name]
        frame = min(int(action.frame_range[1]), frame)
        activate(name, frame)
        for direction in (['front'] if compact else ['front','side','back']):
            view(direction)
            render(name+'_'+str(frame)+'_'+direction)

    # Separate review file: source armor and master remain unchanged.
    activate('Idle1', 31)
    view('front')
    scene.frame_start, scene.frame_end = 1, 120
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path/('WoV_'+family+'_Motion_Review.blend')))

# Side-by-side colored garment comparison using actual evaluated geometry. Visible source
# body parts (--keep-body) join the armor so they don't float unrendered at each pose.
snapshots = []
preview_objects = armor + [o for o in scene.objects if o.type == 'MESH' and is_kept_body(o)]
for col, (name, frame) in enumerate([('Idle1',31), ('WalkFwd',9), ('CrouchIdle1',62)]):
    activate(name, frame)
    center = rig.matrix_world@rig.pose.bones['Hips'].head
    dg = bpy.context.evaluated_depsgraph_get()
    for obj in preview_objects:
        data = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), depsgraph=dg)
        for v in data.vertices:
            point = obj.matrix_world@v.co
            v.co = (point.x-center.x+(col-1)*(2.65 if wing_vertices else 1.55), point.y-center.y, point.z)
        snap = bpy.data.objects.new('Snapshot_'+name+'_'+obj.name, data)
        scene.collection.objects.link(snap)
        snapshots.append(snap)
for obj in preview_objects:
    obj.hide_render = True
cam.location = (1,-9,2.5)
aim(cam, (0,0,1.10))
cam.data.ortho_scale = 8.2 if wing_vertices else 5.25
scene.render.resolution_x = 2400 if wing_vertices else 1800
scene.render.resolution_y = 950
render('Movement_Overview')
report['total_frames'] = sum(c['evaluated_frames'] for c in report['clips'])
report['status'] = 'NUMERIC_PASS_VISUAL_REVIEW_REQUIRED'
report['warnings'] = [
    {'clip': c['name'], 'stretch_above_3x': c['robe_max_edge_stretch'] > 3,
     'robe_below_boots_over_2cm': c['robe_below_boots_m'] > .02}
    for c in report['clips'] if c['robe_max_edge_stretch'] > 3 or c['robe_below_boots_m'] > .02
]
(output_path/'motion-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('DONE', report['total_frames'], flush=True)
