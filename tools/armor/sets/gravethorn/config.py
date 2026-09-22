"""Gravethorn: grave steel with bone rims that end in flame thorns, and a red glow.
Data only; the geometry is design.py."""

CONFIG = {
    'name': 'Gravethorn',
    'family': 'gravethorn',
    'items': [
        {'key': 'hood', 'label': 'Gravethorn Helm', 'regions': ['Head'], 'hide_appearance': ['hair', 'beard', 'eyebrows']},
        {'key': 'shoulders', 'label': 'Gravethorn Pauldrons', 'regions': ['ArmUpperLeft', 'ArmUpperRight'], 'hide_appearance': []},
        {'key': 'vest', 'label': 'Gravethorn Cuirass', 'regions': ['Torso'], 'hide_appearance': []},
        {'key': 'bracers', 'label': 'Gravethorn Bracers', 'regions': ['ArmLowerLeft', 'ArmLowerRight'], 'hide_appearance': []},
        {'key': 'gloves', 'label': 'Gravethorn Gauntlets', 'regions': ['HandLeft', 'HandRight'], 'hide_appearance': []},
        {'key': 'robe', 'label': 'Gravethorn Tassets', 'regions': ['Hips'], 'hide_appearance': []},
        {'key': 'boots', 'label': 'Gravethorn Greaves', 'regions': ['LegLeft', 'LegRight'], 'hide_appearance': []},
    ],
    'free_regions': [],
    # Grave steel, bone rims, oxblood wool, charcoal banner cloth and a red glow.
    'palette': {'cloth': (.060, .009, .013), 'leather': (.017, .016, .015), 'plate': (.105, .128, .104),
                'metal': (.038, .047, .042), 'edge': (.27, .255, .195), 'gold': (.20, .185, .14),
                'black': (.004, .004, .005), 'feather': (.020, .022, .025),
                'red': (.90, .006, .010), 'eyes': (1, .020, .008), 'glow': (.85, .012, .006), 'core': (1, .075, .018)},
    'finish': {'plate': (.52, .50), 'metal': (.48, .55), 'edge': (.66, .04), 'gold': (.74, .04),  # roughness, metallic
               'feather': (.90, 0)},  # banner cloth is matt: with the scaffold's gloss the underskirt mirrored the sky between crouching legs
    'emission': {'red': 2.5, 'eyes': 3.5, 'glow': 2.5, 'core': 4},
    'class_label': 'Grabritter',
    'item_vfx': {'emissive': True, 'profile': 'gravethorn_red', 'attachedToItem': True},
    'vfx': {'profile': 'gravethorn_red', 'type': 'emissive_mesh',
            'materials': ['Gravethorn_red', 'Gravethorn_eyes', 'Gravethorn_glow', 'Gravethorn_core'],
            'itemBound': True, 'optionalRuntimeEffect': 'selective_glow', 'particleSystem': False},
    # Crown tier, wolf skull and blade of the pauldrons hang rigidly on the shoulder sockets.
    'wing_binding': ['Shoulder_Attachment_L', 'Shoulder_Attachment_R'],
    'skirt_description': 'split per-leg plate panels',
    'render_resolution': 1200,
    'camera_scale': 2.75,
    'view_transform': 'Standard',
    'look': 'None',
    'detail_image': '32_Thorn_Light_Detail',
    'fit_render_resolution': 1000,
}
