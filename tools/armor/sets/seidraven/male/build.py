"""Build Seidraven armor, male body (one-call entry point).

Entry point for the male body. It sets the variant and runs the shared
implementation ../build_common.py; no geometry lives here. The command line is checked first, by
../../entry_args.py (see there for what is refused).

Blender --factory-startup -b BODY_BASE_MALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/seidraven/male/build.py -- OUTPUT_DIR [--quick]

Result: equipment.json in OUTPUT_DIR carries bodyVariant "male", bodyProfile
"wov-male-v1", figure "wikinger" and item ids "seidraven_male_<key>".
"""
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # tools/armor/sets
import entry_args  # noqa: E402

entry_args.prepare(__file__, 'male')
runpy.run_path(str(Path(__file__).resolve().parent.parent / 'build_common.py'), run_name='__main__')
