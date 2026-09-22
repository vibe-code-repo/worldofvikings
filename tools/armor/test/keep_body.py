"""--keep-body= contract for armor-motion.py. Standard library only (no bpy), so it can
be tested without Blender; tools/armor/test/keep-body-args.mjs does exactly that.
"""

# The body's fixed eleven-region vocabulary (tools/armor/sets/seidraven/build_common.py's
# SLOTS and every other set's own copy of it); an attachment name such as Wildwarden's
# Crown is not one of these and can therefore never be named in --keep-body.
BODY_SLOTS = ('Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight',
              'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight')


class KeepBodyError(ValueError):
    pass


def parse_keep_body(args, replaced_regions):
    """Return the --keep-body region list from `args` (the tokens after Blender's own --),
    or raise KeepBodyError. `replaced_regions` is the set of body regions the armor mesh
    objects already replace (their <PREFIX>Region names) -- a kept region must be neither
    one of those nor outside BODY_SLOTS. An empty list and a region repeated within the
    same --keep-body are both allowed and change nothing; a second --keep-body option is
    refused outright rather than silently keeping only the first.
    """
    matches = [a for a in args if a.startswith('--keep-body=')]
    if len(matches) > 1:
        raise KeepBodyError(f'--keep-body given {len(matches)} times; only one is allowed '
                             '(list every region in that one option, comma-separated)')
    if not matches:
        return []
    values = [r for r in matches[0].split('=', 1)[1].split(',') if r]
    unknown = [r for r in values if r not in BODY_SLOTS]
    if unknown:
        raise KeepBodyError(f'--keep-body names a region outside the eleven-region body '
                             f'({", ".join(BODY_SLOTS)}): {", ".join(unknown)}')
    conflicting = [r for r in values if r in replaced_regions]
    if conflicting:
        raise KeepBodyError('--keep-body names a region this armor already replaces under '
                             f'--prefix, so it would be shown twice: {", ".join(conflicting)}')
    return values
