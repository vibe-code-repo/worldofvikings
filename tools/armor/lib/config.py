"""Schema of a set's configuration, and its check. Standard library only (no bpy), so
tools/armor/test/scaffold-config.mjs can check every set without Blender.

A set is a folder sets/<family>/ with

  config.py   CONFIG = {...}: data only -- names, items, palette, render values, vfx
  design.py   design(ctx): the geometry; optional after_export(ctx)
  fit.py      optional: lining(ctx, ...) and after_fit(ctx) for the legacy-female fit

Every value that one of the former text-replacing builders swapped in the scaffold's
tail is a named field here. Fields without a default are set-specific and must be
given: init() refuses a configuration that lacks one, so a set can never silently
build with another set's class name, glow or item list.
"""

# The regions of the eleven-piece body, in the scaffold's order.
REGIONS = ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft',
           'ArmLowerRight', 'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight']
# The scaffold's materials, in creation order. A palette must colour every one of them:
# the helpers and the linings refer to them by name.
MATERIALS = ['cloth', 'leather', 'plate', 'edge', 'metal', 'black', 'red', 'eyes', 'gold', 'feather', 'glow', 'core']
# What the scaffold gives a material that the set does not override: (roughness, metallic).
DEFAULT_FINISH = {name: (.78 if name in ['cloth', 'leather', 'black'] else .43,
                         .65 if name in ['plate', 'metal', 'edge', 'gold'] else 0) for name in MATERIALS}
# Emission strength of the scaffold's glowing materials (emission colour = base colour).
DEFAULT_EMISSION = {'eyes': 2, 'red': .7, 'glow': 1.5, 'core': 3}
APPEARANCE_LAYERS = ['hair', 'beard', 'eyebrows']

# field -> (what it replaces in the old text-swapped tail, default or REQUIRED)
REQUIRED = object()
FIELDS = {
    'name': ("'Seidraven' in object, material, collection, image and file names", REQUIRED),
    'family': ("'seidraven' in item ids", REQUIRED),
    'items': ('the PARTS table: key, label, regions, hide_appearance per item', REQUIRED),
    'free_regions': ("regions no item replaces; the set's linings and items for them are dropped", REQUIRED),
    'palette': ('the twelve material colours', REQUIRED),
    'finish': ('roughness/metallic overrides per material', {}),
    'emission': ('emission strength per glowing material', DEFAULT_EMISSION),
    'class_label': ("'class': 'Seherin' in equipment.json", REQUIRED),
    'vfx': ('the set-level vfx entry of equipment.json', REQUIRED),
    'item_vfx': ('the vfx entry every item carries, or None', None),
    'wing_binding': ('wingBinding in equipment.json and wing_binding/wing_effect in validation.json, or None', None),
    'skirt_description': ("'robe_foundation' in validation.json", 'split per-leg riding panels'),
    'render_resolution': ("the tail's 1400", 1400),
    'camera_scale': ("the tail's 2.90", 2.90),
    'view_transform': ("view_transform = 'AgX'", 'AgX'),
    'look': ("look = 'AgX - Medium High Contrast'", 'AgX - Medium High Contrast'),
    'preview_glare': ("glare Strength 1.2 (the preview's fog glow)", 1.2),
    'detail_image': ("the render '32_Wing_Light_Detail'", '32_Wing_Light_Detail'),
    'hood_image': ("the render '30_Hood_Detail'", '30_Hood_Detail'),
    'boot_image': ("the render '31_Boot_Detail'", '31_Boot_Detail'),
    'export_in_quick': ("'if not QUICK: export(' turned into 'if True:'", False),
    'triangle_limit': ("the tail's 'total_triangles < 16000'", 16000),
    'fit_render_resolution': ("the fit's 1400", 1400),
}
WING_EFFECT = 'emissive geometry; preview compositor fog glow; runtime bloom required for halo'


class ConfigError(ValueError):
    pass


def complete(config):
    """The configuration with every default filled in; raises ConfigError if a required
    field is missing, a field is unknown or the items do not describe a whole set."""
    unknown = sorted(set(config) - set(FIELDS))
    if unknown:
        raise ConfigError(f'unknown field(s) {unknown}; the fields are {sorted(FIELDS)}')
    missing = [f for f, (_, default) in FIELDS.items() if default is REQUIRED and f not in config]
    if missing:
        raise ConfigError(f'missing required field(s) {missing}')
    full = {f: config.get(f, default) for f, (_, default) in FIELDS.items()}
    if not (isinstance(full['name'], str) and full['name'].isalpha() and full['name'][0].isupper()):
        raise ConfigError(f"name must be a capitalised word, got {full['name']!r}")
    if full['family'] != full['name'].lower():
        raise ConfigError(f"family must be the lower-case name, got {full['family']!r}")
    if sorted(full['palette']) != sorted(MATERIALS):
        raise ConfigError(f'palette must colour exactly {MATERIALS}, got {sorted(full["palette"])}')
    for name, color in full['palette'].items():
        if len(color) != 3 or not all(isinstance(c, (int, float)) for c in color):
            raise ConfigError(f'palette[{name!r}] must be three numbers')
    for table in ('finish', 'emission'):
        bad = sorted(set(full[table]) - set(MATERIALS))
        if bad:
            raise ConfigError(f'{table} names unknown materials {bad}')
    if set(full['free_regions']) - set(REGIONS):
        raise ConfigError(f'free_regions outside {REGIONS}: {full["free_regions"]}')
    covered = []
    for item in full['items']:
        keys = set(item)
        if keys != {'key', 'label', 'regions', 'hide_appearance'}:
            raise ConfigError(f'item {item} must have exactly key, label, regions, hide_appearance')
        if not item['regions'] or set(item['regions']) - set(REGIONS):
            raise ConfigError(f"item {item['key']}: regions must be a non-empty subset of {REGIONS}")
        if set(item['hide_appearance']) - set(APPEARANCE_LAYERS):
            raise ConfigError(f"item {item['key']}: hide_appearance outside {APPEARANCE_LAYERS}")
        covered += item['regions']
    if sorted(covered) != sorted(set(REGIONS) - set(full['free_regions'])):
        raise ConfigError(f'items must replace every region except the free ones exactly once; '
                          f'replaced {sorted(covered)}, free {sorted(full["free_regions"])}')
    if len({item['key'] for item in full['items']}) != len(full['items']):
        raise ConfigError('item keys must be unique')
    if full['wing_binding'] is not None and not isinstance(full['wing_binding'], list):
        raise ConfigError('wing_binding must be a list of bone names or None')
    return full


def describe(full):
    """What the config test compares with shared/src/<family>.ts: item keys, regions,
    hidden appearance layers and the free regions."""
    return {'family': full['family'],
            'items': [{'key': i['key'], 'regions': i['regions'], 'hideAppearance': i['hide_appearance']} for i in full['items']],
            'freeRegions': full['free_regions']}
