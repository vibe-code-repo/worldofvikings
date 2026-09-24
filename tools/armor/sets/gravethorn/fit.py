"""The Gravethorn fit to the game's female figure: the hooks of lib/fit_legacy.py.

The shared fit rewrites the body profile in equipment.json and leaves the rest of the set
header as the builder wrote it. One entry there names bones: `wingBinding`, the shoulder
sockets the rigid pauldron parts hang on. The game's female figure has no socket bones;
the shared fit binds that geometry to the clavicles. after_fit corrects the header, and
every bone it names must exist in the skeleton the items are skinned to.
"""
import json

BONE_HINTS = ['wingBinding']  # the header entries that name bones


def after_fit(ctx):
    equipment, mapping, rig, root, armor = ctx.equipment, ctx.mapping, ctx.rig, ctx.root, ctx.armor
    print('HEADER_AS_INHERITED', [name for key in BONE_HINTS for name in equipment.get(key, []) if name not in rig.data.bones], flush=True)
    assert equipment['wingBinding'] == ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'], equipment['wingBinding']
    equipment['wingBinding'] = [mapping[name] for name in equipment['wingBinding']]
    for key in BONE_HINTS:
        missing = [name for name in equipment.get(key, []) if name not in rig.data.bones]
        assert not missing, (key, missing)
    assert equipment['wingBinding'] == ['L_Clavicle', 'R_Clavicle'], equipment['wingBinding']
    (root/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
    print('GRAVETHORN_LEGACY', len(armor), 'regions', len(equipment['parts']), 'items', equipment['wingBinding'], flush=True)
