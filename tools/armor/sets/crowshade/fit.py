"""The Crowshade fit to the game's female figure: the hooks of lib/fit_legacy.py.

The shared fit rewrites the body profile in equipment.json and leaves the rest of the set
header as the builder wrote it. One entry there names bones: `wingBinding`, the shoulder
sockets the feather crown and the claw pauldron hang on rigidly. The game's female figure
has no socket bones; the shared fit moves that geometry onto the clavicles. after_fit
corrects the header and checks it against the weights actually written: every vertex that
hung on a socket with weight one now hangs on the clavicle named in the header with weight
one, and the rigid belt parts (knives, pouch, buckles) hang on the pelvis the same way.
"""
import json

import bmesh

BONE_HINTS = ['wingBinding']  # the header entries that name bones


def rigid_vertices(obj, bone, first=0):
    """Indices (from `first` on) of the vertices bound to `bone` alone with weight one."""
    group = obj.vertex_groups.get(bone)
    if group is None:
        return []
    return [v.index for v in obj.data.vertices[first:]
            if len(v.groups) == 1 and v.groups[0].group == group.index and abs(v.groups[0].weight-1) < 1e-6]


def lining_count(obj):
    """The number of welded body vertices the builder put first in a region (as lib/fit_legacy.py counts them)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    count = len(bm.verts)
    bm.free()
    return count


def after_fit(ctx):
    equipment, mapping, rig, root, armor, source = ctx.equipment, ctx.mapping, ctx.rig, ctx.root, ctx.armor, ctx.source
    print('HEADER_AS_INHERITED', [name for key in BONE_HINTS for name in equipment.get(key, []) if name not in rig.data.bones],
          flush=True)
    assert equipment['wingBinding'] == ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'], equipment['wingBinding']
    equipment['wingBinding'] = [mapping[name] for name in equipment['wingBinding']]
    for key in BONE_HINTS:
        missing = [name for name in equipment.get(key, []) if name not in rig.data.bones]
        assert not missing, (key, missing)
    assert equipment['wingBinding'] == ['L_Clavicle', 'R_Clavicle'], equipment['wingBinding']
    # The header must name the bones the rigid parts are really weighted to: count them on both sides of the fit.
    binding = {}
    for slot, socket, target in [('ArmUpperLeft', 'Shoulder_Attachment_L', 'L_Clavicle'),
                                 ('ArmUpperRight', 'Shoulder_Attachment_R', 'R_Clavicle'), ('Hips', 'Hips', 'Pelvis')]:
        before = len(rigid_vertices(source[slot], socket, lining_count(ctx.source_base[slot])))
        after = len(rigid_vertices(armor[slot], target))
        assert before > 0 and after >= before, (slot, socket, before, target, after)
        binding[slot] = {'source': socket, 'sourceRigidVertices': before, 'bone': target, 'rigidVertices': after}
    for slot in ['ArmUpperLeft', 'ArmUpperRight']:
        assert not any(g.name.startswith('Shoulder_Attachment') for g in armor[slot].vertex_groups), slot
    (root/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
    report = json.loads((root/'fit-validation.json').read_text())
    report['rigidBinding'] = binding
    (root/'fit-validation.json').write_text(json.dumps(report, indent=2)+'\n')
    print('CROWSHADE_LEGACY', len(armor), 'regions', len(equipment['parts']), 'items', equipment['wingBinding'], binding,
          flush=True)
