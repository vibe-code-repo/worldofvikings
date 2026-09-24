"""Plainhide: the starter clothes, five items, head and hands stay the player's.
Data only; the geometry is design.py."""

CONFIG = {
    'name': 'Plainhide',
    'family': 'plainhide',
    'items': [
        {'key': 'shoulders', 'label': 'Plainhide Sleeves', 'regions': ['ArmUpperLeft', 'ArmUpperRight'], 'hide_appearance': []},
        {'key': 'vest', 'label': 'Plainhide Tunic', 'regions': ['Torso'], 'hide_appearance': []},
        {'key': 'bracers', 'label': 'Plainhide Wraps', 'regions': ['ArmLowerLeft', 'ArmLowerRight'], 'hide_appearance': []},
        {'key': 'robe', 'label': 'Plainhide Trousers', 'regions': ['Hips'], 'hide_appearance': []},
        {'key': 'boots', 'label': 'Plainhide Shoes', 'regions': ['LegLeft', 'LegRight'], 'hide_appearance': []},
    ],
    # Head and hands belong to the player: no lining, no item, the source body shows there.
    'free_regions': ['Head', 'HandLeft', 'HandRight'],
    # Shirt hide, trouser hide, dark band and shoe leather, a thin darker under-hide, pale thread. Nothing shines.
    # The other seven materials are never used; they keep the scaffold's colours.
    'palette': {'cloth': (.300, .172, .066), 'leather': (.165, .090, .034), 'black': (.058, .030, .013),
                'gold': (.215, .128, .058), 'edge': (.600, .480, .270),
                'plate': (.080, .102, .145), 'metal': (.19, .24, .29), 'red': (.28, .009, .75), 'eyes': (.55, .06, 1.0),
                'feather': (.035, .014, .095), 'glow': (.16, .003, .80), 'core': (.32, .015, 1.0)},
    'finish': {name: (.92, 0) for name in ['cloth', 'leather', 'black', 'gold', 'edge']},
    'class_label': 'Neuling',
    'item_vfx': {'emissive': False},
    'vfx': {'type': 'none', 'emissive': False, 'particleSystem': False},
    'skirt_description': 'short shirt skirt, slit at the sides, over trousers',
    'render_resolution': 1200,
    'camera_scale': 2.55,
    'view_transform': 'Standard',
    'look': 'None',
    'preview_glare': 0,  # nothing glows: no preview halo either
    'detail_image': '32_Seam_Detail',
    'hood_image': '30_Collar_Detail',
    'fit_render_resolution': 1000,
}
