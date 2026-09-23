"""Crowshade: a slim rogue's set in black leather, aged silver and warm brown straps,
inspired by a supplied silhouette. Nothing glows. Data only; the geometry is design.py."""

CONFIG = {
    'name': 'Crowshade',
    'family': 'crowshade',
    'items': [
        {'key': 'hood', 'label': 'Krähenschatten-Maske', 'regions': ['Head'], 'hide_appearance': ['hair', 'beard', 'eyebrows']},
        {'key': 'shoulders', 'label': 'Krähenschatten-Schultern', 'regions': ['ArmUpperLeft', 'ArmUpperRight'], 'hide_appearance': []},
        {'key': 'vest', 'label': 'Krähenschatten-Wams', 'regions': ['Torso'], 'hide_appearance': []},
        {'key': 'bracers', 'label': 'Krähenschatten-Klingenschienen', 'regions': ['ArmLowerLeft', 'ArmLowerRight'], 'hide_appearance': []},
        {'key': 'gloves', 'label': 'Krähenschatten-Klauen', 'regions': ['HandLeft', 'HandRight'], 'hide_appearance': []},
        {'key': 'robe', 'label': 'Krähenschatten-Schoß', 'regions': ['Hips'], 'hide_appearance': []},
        {'key': 'boots', 'label': 'Krähenschatten-Stiefel', 'regions': ['LegLeft', 'LegRight'], 'hide_appearance': []},
    ],
    'free_regions': [],
    # Near-black leather and hood cloth, blue-black feathers, aged silver with a paler trim, gunmetal, warm brown
    # straps ('gold' is only the name of the scaffold slot). 'red' is the pale steel of the knife blades and 'eyes' the
    # mask's dark eye hollows. 'glow' and 'core' are never used.
    'palette': {'cloth': (.016, .016, .018), 'leather': (.026, .021, .018), 'black': (.005, .005, .006),
                'plate': (.46, .46, .44), 'edge': (.66, .64, .58), 'metal': (.085, .085, .088),
                'gold': (.150, .070, .028), 'feather': (.011, .012, .016),
                'red': (.52, .52, .50), 'eyes': (.003, .003, .004), 'glow': (.05, .05, .05), 'core': (.05, .05, .05)},
    'finish': {'cloth': (.92, 0), 'leather': (.66, 0), 'black': (.90, 0), 'gold': (.70, 0), 'feather': (.52, 0),
               'plate': (.40, .70), 'edge': (.36, .75), 'metal': (.45, .60), 'red': (.30, .80), 'eyes': (.95, 0)},
    'emission': {},  # nothing glows
    'class_label': 'Schattenläufer',
    'vfx': {'type': 'none', 'emissive': False, 'particleSystem': False},
    # The feather crown and the claw pauldron hang rigidly on the shoulder sockets.
    'wing_binding': ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'],
    'skirt_description': 'ragged coat tails on a double belt, front tails follow the thighs, rear tails shared between hips and thighs',
    'render_resolution': 1200,
    'camera_scale': 2.75,
    'view_transform': 'Standard',
    'look': 'None',
    'preview_glare': 0,  # nothing glows: no preview halo either
    'detail_image': '32_Mask_Detail',
    'fit_render_resolution': 1000,
}
