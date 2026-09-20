"""Use the tested anatomical retarget for the Gravethorn legacy-female variant.

Blender -b Female/WoV_Gravethorn_Armor.blend --python THIS -- body.glb OUTPUT
(Female/WoV_Gravethorn_Armor.blend is the output of female/build.py.) Executes the
text of ../../seidraven/female/fit-legacy.py with the set name substituted.
"""
from pathlib import Path
source = (Path(__file__).resolve().parent.parent.parent/'seidraven'/'female'/'fit-legacy.py').read_text()
source = source.replace('Seidraven', 'Gravethorn').replace('seidraven', 'gravethorn').replace('1400', '1000')
exec(compile(source, 'gravethorn-legacy-female-retarget', 'exec'))
