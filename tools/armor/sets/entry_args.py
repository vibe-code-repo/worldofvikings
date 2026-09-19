"""Command-line check shared by the four thin build entry points.

sets/{seidraven,emberrage}/{male,female}/build.py call prepare() before they start
the shared build_common.py, so a bad command line stops within seconds instead of
after a full build. Standard library only (no bpy), so it can be tested without
Blender.

The accepted form, after Blender's own arguments, is

    -- OUTPUT_DIR [--quick]              male entry points
    -- OUTPUT_DIR [--quick] [--female]   female entry points (--female is implied)

Everything else is refused with a message and exit code 1: a missing `--` or output
directory, an output directory that looks like a switch, unknown or repeated
switches, `--female` on a male entry point, and any of --quick/--female/--male placed
in front of the `--` (Blender would ignore them silently).
"""
import sys

QUICK = '--quick'
FEMALE = '--female'
# Switches of this tool. In front of the `--` they would be Blender arguments.
BUILD_SWITCHES = (QUICK, FEMALE, '--male')
BODY_SOURCE = {'male': 'BODY_BASE_MALE.blend', 'female': 'BODY_BASE_FEMALE.blend'}


class EntryArgsError(ValueError):
    pass


def parse(argv, variant):
    """Return (output_dir, switches) for a valid command line, else raise EntryArgsError."""
    if '--' in argv:
        split = argv.index('--')
        before, after = argv[1:split], argv[split + 1:]
    else:
        before, after = argv[1:], None
    misplaced = [a for a in before if a in BUILD_SWITCHES]
    if misplaced:
        raise EntryArgsError(f"{' '.join(misplaced)} in front of '--' is a Blender argument and "
                             "would be ignored; put it after '--'")
    if after is None:
        raise EntryArgsError("missing '--' before the output directory")
    if not after:
        raise EntryArgsError("missing output directory after '--'")
    output = after[0]
    if not output or output.startswith('-'):
        raise EntryArgsError(f"expected the output directory as the first argument after '--', got {output!r} "
                             "(a directory name that starts with '-' needs a './' prefix)")
    allowed = [QUICK] + ([FEMALE] if variant == 'female' else [])
    switches = []
    for arg in after[1:]:
        if arg == FEMALE and variant == 'male':
            raise EntryArgsError('the male entry point does not accept --female; use ../female/build.py')
        if arg not in allowed:
            hint = '; the female entry point builds the female body only' if arg == '--male' else ''
            raise EntryArgsError(f"unknown argument {arg!r} (allowed: {' '.join(allowed)}){hint}")
        if arg in switches:
            raise EntryArgsError(f'{arg} given twice')
        switches.append(arg)
    return output, switches


def prepare(script, variant, argv=None):
    """Check sys.argv for the entry point `script`; exit with a message if it is wrong.

    On success the female entry points get --female appended, which is how
    build_common.py learns the variant.
    """
    argv = sys.argv if argv is None else argv
    try:
        _, switches = parse(argv, variant)
    except EntryArgsError as error:
        optional = ' [--quick] [--female]' if variant == 'female' else ' [--quick]'
        sys.exit(f'{script}: {error}\n'
                 f'usage: blender --factory-startup -b {BODY_SOURCE[variant]} --python-exit-code 1 '
                 f'--python {script} -- OUTPUT_DIR{optional}')
    if variant == 'female' and FEMALE not in switches:
        argv.append(FEMALE)
