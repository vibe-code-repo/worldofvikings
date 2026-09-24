"""Build Seidraven armor on the shared scaffold (tools/armor/lib): init, design, finish.

Run it through the per-body entry points male/build.py and female/build.py (the latter
appends --female); they check the command line first. Directly:
Blender -b WoV_BodyBase_{Male,Female}.blend --python THIS -- OUTPUT [--female] [--quick]
The set is config.py (data) and design.py (geometry); nothing here is edited per set.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1])]  # this set, then tools/armor for lib/
import design  # noqa: E402
from config import CONFIG  # noqa: E402
from lib import scaffold  # noqa: E402

scaffold.build(CONFIG, design)
