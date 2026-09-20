"""Use the tested anatomical retarget for the Gravethorn legacy-female variant.

Blender -b Female/WoV_Gravethorn_Armor.blend --python THIS -- body.glb OUTPUT
(Female/WoV_Gravethorn_Armor.blend is the output of female/build.py.) Executes the
text of ../../seidraven/female/fit-legacy.py with the set name substituted.

The shared script rewrites the body profile in equipment.json and leaves the rest of the
set header as the builder wrote it. One entry there names bones: `wingBinding`, the
shoulder sockets the rigid pauldron parts hang on. The game's female figure has no socket
bones; the shared script binds that geometry to the clavicles. The header is corrected
here, and every bone it names must exist in the skeleton the items are skinned to.
"""
import json
from pathlib import Path
source = (Path(__file__).resolve().parent.parent.parent/'seidraven'/'female'/'fit-legacy.py').read_text()
source = source.replace('Seidraven', 'Gravethorn').replace('seidraven', 'gravethorn').replace('1400', '1000')
exec(compile(source, 'gravethorn-legacy-female-retarget', 'exec'))

BONE_HINTS = ['wingBinding']  # the header entries that name bones
print('HEADER_AS_INHERITED', [name for key in BONE_HINTS for name in equipment.get(key, []) if name not in rig.data.bones], flush=True)
assert equipment['wingBinding'] == ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'], equipment['wingBinding']
equipment['wingBinding'] = [mapping[name] for name in equipment['wingBinding']]
for key in BONE_HINTS:
    missing = [name for name in equipment.get(key, []) if name not in rig.data.bones]
    assert not missing, (key, missing)
assert equipment['wingBinding'] == ['L_Clavicle', 'R_Clavicle'], equipment['wingBinding']
(root/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
print('GRAVETHORN_LEGACY', len(armor), 'regions', len(equipment['parts']), 'items', equipment['wingBinding'], flush=True)
