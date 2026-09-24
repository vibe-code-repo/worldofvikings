"""Seidraven: the set the scaffold was written for. Data only; the geometry is design.py."""

CONFIG = {
    'name': 'Seidraven',
    'family': 'seidraven',
    'items': [
        {'key': 'hood', 'label': 'Runenhelm', 'regions': ['Head'], 'hide_appearance': ['hair', 'beard', 'eyebrows']},
        {'key': 'shoulders', 'label': 'Rabenlicht-Schultern', 'regions': ['ArmUpperLeft', 'ArmUpperRight'], 'hide_appearance': []},
        {'key': 'vest', 'label': 'Seidr-Lamellenharnisch', 'regions': ['Torso'], 'hide_appearance': []},
        {'key': 'bracers', 'label': 'Runenarmschienen', 'regions': ['ArmLowerLeft', 'ArmLowerRight'], 'hide_appearance': []},
        {'key': 'gloves', 'label': 'Seidr-Handschuhe', 'regions': ['HandLeft', 'HandRight'], 'hide_appearance': []},
        {'key': 'robe', 'label': 'Runen-Schurz', 'regions': ['Hips'], 'hide_appearance': []},
        {'key': 'boots', 'label': 'Runenpanzerstiefel', 'regions': ['LegLeft', 'LegRight'], 'hide_appearance': []},
    ],
    'free_regions': [],
    'palette': {
        'cloth': (.035, .009, .105), 'leather': (.029, .024, .034),
        'plate': (.080, .102, .145), 'edge': (.38, .43, .48),
        'metal': (.19, .24, .29), 'black': (.005, .004, .012),
        'red': (.28, .009, .75), 'eyes': (.55, .06, 1.0),
        'gold': (.39, .23, .09), 'feather': (.035, .014, .095),
        'glow': (.16, .003, .80), 'core': (.32, .015, 1.0),
    },
    'class_label': 'Seherin',
    'vfx': {'type': 'emissive_mesh', 'optionalRuntimeEffect': 'bloom', 'particleSystem': False},
    # The rigid raven-feather wings hang on the shoulder sockets.
    'wing_binding': ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'],
}
