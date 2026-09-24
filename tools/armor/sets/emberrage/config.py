"""Emberrage: charcoal steel, oxblood wool and a red glow. Data only; the geometry is design.py."""

CONFIG = {
    'name': 'Emberrage',
    'family': 'emberrage',
    'items': [
        {'key': 'hood', 'label': 'Glutzorn-Spalthelmer', 'regions': ['Head'], 'hide_appearance': ['hair', 'beard', 'eyebrows']},
        {'key': 'shoulders', 'label': 'Glutzorn-Bruchschultern', 'regions': ['ArmUpperLeft', 'ArmUpperRight'], 'hide_appearance': []},
        {'key': 'vest', 'label': 'Glutzorn-Schwarzstahlharnisch', 'regions': ['Torso'], 'hide_appearance': []},
        {'key': 'bracers', 'label': 'Glutzorn-Armschienen', 'regions': ['ArmLowerLeft', 'ArmLowerRight'], 'hide_appearance': []},
        {'key': 'gloves', 'label': 'Glutzorn-Panzerhandschuhe', 'regions': ['HandLeft', 'HandRight'], 'hide_appearance': []},
        {'key': 'robe', 'label': 'Glutzorn-Runenschurz', 'regions': ['Hips'], 'hide_appearance': []},
        {'key': 'boots', 'label': 'Glutzorn-Stiefel', 'regions': ['LegLeft', 'LegRight'], 'hide_appearance': []},
    ],
    'free_regions': [],
    # Distinct charcoal steel, oxblood wool and red/orange hot fracture palette.
    'palette': {'cloth': (.13, .006, .012), 'leather': (.024, .009, .009),
                'plate': (.023, .030, .039), 'metal': (.080, .088, .102),
                'edge': (.22, .23, .25), 'gold': (.17, .065, .025), 'black': (.003, .004, .007),
                'red': (.85, .003, .008), 'eyes': (1, .016, .006),
                'glow': (.75, .001, .004), 'core': (1, .003, .001), 'feather': (.024, .005, .008)},
    'emission': {'red': 2, 'eyes': 3, 'glow': 2, 'core': 3},
    'class_label': 'Berserker',
    # Effect ownership is per item, not a permanent avatar light.
    'item_vfx': {'emissive': True, 'profile': 'emberrage_red', 'attachedToItem': True},
    'vfx': {'profile': 'emberrage_red', 'type': 'emissive_mesh',
            'materials': ['Emberrage_red', 'Emberrage_eyes', 'Emberrage_glow', 'Emberrage_core'],
            'itemBound': True, 'optionalRuntimeEffect': 'selective_glow', 'particleSystem': False},
    'render_resolution': 1000,
    'camera_scale': 2.55,
    'view_transform': 'Standard',
    'look': 'None',
    'detail_image': '32_Fracture_Light_Detail',
    'export_in_quick': True,  # --quick still writes the GLBs and the .blend (README, "what --quick does")
    'fit_render_resolution': 1000,
}
