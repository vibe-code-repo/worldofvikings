"""Build Gravethorn armor, female body (one-call entry point).

Entry point for the female body. It sets the variant and runs the shared
implementation ../build_common.py; no geometry lives here. The command line is checked first, by
../../entry_args.py (see there for what is refused).

Blender --factory-startup -b BODY_BASE_FEMALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/gravethorn/female/build.py -- OUTPUT_DIR [--quick] [--female]

Result: equipment.json in OUTPUT_DIR carries bodyVariant "female", bodyProfile
"wov-female-v1", figure "wikingerin" and item ids "gravethorn_female_<key>".
This is the 63-bone authoring rig (bodyProfile wov-female-v1). The game's current
female avatar has a different 51-bone skeleton; a legacy fit is not part of this set yet.
"""
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # tools/armor/sets
import entry_args  # noqa: E402

entry_args.prepare(__file__, 'female')
runpy.run_path(str(Path(__file__).resolve().parent.parent / 'build_common.py'), run_name='__main__')
