"""Use the tested anatomical retarget for the Emberrage legacy-female variant."""
from pathlib import Path
source=Path(__file__).with_name('fit-seidraven-legacy-female.py').read_text()
source=source.replace('Seidraven','Emberrage').replace('seidraven','emberrage').replace('1400','1000')
exec(compile(source,'emberrage-legacy-female-retarget','exec'))
