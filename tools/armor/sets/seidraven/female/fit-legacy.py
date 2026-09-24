"""Fit the Seidraven female set to the game's current female avatar (51 bones).

Blender -b Female/WoV_Seidraven_Armor.blend --python-exit-code 1 --python THIS -- body.glb OUTPUT
(Female/WoV_Seidraven_Armor.blend is the output of female/build.py, body.glb the game's
female body.) The shared fit is lib/fit_legacy.py; the set is config.py.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parents[2])]  # this set, then tools/armor for lib/
from config import CONFIG  # noqa: E402
from lib import fit_legacy  # noqa: E402

fit_legacy.fit(CONFIG, None)
