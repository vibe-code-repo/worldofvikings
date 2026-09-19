"""Build Emberrage armor, female body (one-call entry point).

Entry point for the female body. It sets the variant and runs the shared
implementation ../build_common.py; no geometry lives here.

Blender --factory-startup -b BODY_BASE_FEMALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/emberrage/female/build.py -- OUTPUT_DIR [--quick]

Result: equipment.json in OUTPUT_DIR carries bodyVariant "female", bodyProfile
"wov-female-v1", figure "wikingerin" and item ids "emberrage_female_<key>".
This is the 63-bone authoring rig (bodyProfile wov-female-v1). The game's current
female avatar has a different 51-bone skeleton: run fit-legacy.py next.
"""
import runpy
import sys
from pathlib import Path

ARGS = sys.argv[sys.argv.index('--') + 1:]
if '--female' not in ARGS:
    sys.argv.append('--female')
runpy.run_path(str(Path(__file__).resolve().parent.parent / 'build_common.py'), run_name='__main__')
