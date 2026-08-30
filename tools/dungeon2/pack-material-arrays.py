#!/usr/bin/env python3
"""
pack-material-arrays.py — die gebackenen PNG-Saetze zu Textur-Arrays stapeln (AP12).
pack-material-arrays.py — stack the baked PNG sets into texture arrays (AP12).

    python3 tools/dungeon2/pack-material-arrays.py \\
      --in  /home/mike/wov-wt-dungeon2/assets/dungeon2/materials \\
      --out /home/mike/wov-wt-dungeon2/assets/dungeon2/arrays

── Warum es diesen Schritt gibt / Why this step exists ───────────────
`make-materials.py` liefert EINZELNE PNGs je Material, der Renderer erwartet
laut `design/render-tech.md` §1.5 drei `sampler2DArray`:

    dungeonAlbedoArray   RGB Albedo
    dungeonNormalArray   RG Normale (Z wird rekonstruiert)
    dungeonOrhArray      R Occlusion, G Rauheit, B Hoehe

Zwischen beidem fehlte ein Schritt — das ist Widerspruch W5 in
`design/ARCHITECTURE.md`, und dieses Werkzeug ist seine Aufloesung.
`make-materials.py` produces SINGLE PNGs per material, the renderer expects
three `sampler2DArray` according to `design/render-tech.md` §1.5. A step was
missing between the two — that is contradiction W5 in
`design/ARCHITECTURE.md`, and this tool is its resolution.

── Warum ein senkrechter Streifen / Why a vertical strip ─────────────
Ein `Texture2DArray` hat kein Dateiformat auf der Platte. Das Projekt hat
dafuer bereits eine Form: `tools/extract-texture-arrays.py` schreibt und
`client/src/engine/TerrainSplat.ts` liest einen senkrechten Streifen
(Breite × Hoehe·Layer). Diese Form wird hier fortgefuehrt — sie laesst sich
mit einem einzigen `RawTexture2DArray`-Aufruf hochladen, sie ist mit jedem
Bildbetrachter pruefbar, und sie braucht keine Werkzeugkette, die es auf
dieser Maschine nicht gibt.
A `Texture2DArray` has no on-disk file format. The project already has a
shape for this: `tools/extract-texture-arrays.py` writes and
`client/src/engine/TerrainSplat.ts` reads a vertical strip (width ×
height·layers). That shape is continued here — it uploads with a single
`RawTexture2DArray` call, it can be inspected in any image viewer, and it
needs no tool chain that does not exist on this machine.

KTX2 bleibt vorgesehen, aber optional: `toktx` wird benutzt, WENN es im
Pfad liegt, und der Schritt wird sonst laut uebersprungen. Risiko R4
(`Texture2DArray` + Basis Universal) ist ohnehin unverifiziert und wird
laut ARCHITECTURE erst von AP8 entschieden — sich hier darauf festzulegen,
hiesse eine unbewiesene Annahme in ein Dateiformat zu giessen.
KTX2 stays planned but optional: `toktx` is used IF it is on the path, and
the step is loudly skipped otherwise. Risk R4 (`Texture2DArray` + Basis
Universal) is unverified anyway and is to be decided by AP8 according to
ARCHITECTURE — committing to it here would mean casting an unproven
assumption into a file format.

── Was hart geprueft wird / What is checked hard ─────────────────────
Alle Layer eines Arrays MUESSEN dieselbe Aufloesung und dasselbe PNG-Format
haben (Bittiefe und Farbtyp aus dem IHDR gelesen, nicht aus der Bibliothek
geraten). Ein Array aus ungleichen Layern laedt entweder gar nicht oder,
schlimmer, es laedt schief und niemand sieht warum.
All layers of an array MUST have the same resolution and the same PNG format
(bit depth and colour type read from the IHDR, not guessed from the library).
An array of unequal layers either fails to load or, worse, loads skewed and
nobody sees why.
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys

import numpy as np
from PIL import Image

# Die drei Arrays und die Quelldatei je Layer.
# The three arrays and the source file per layer.
ARRAYS = [
    ('albedo', 'albedo.png', 'dungeonAlbedoArray', 'sRGB',
     'RGB Albedo / RGB albedo'),
    ('normal', 'normal.png', 'dungeonNormalArray', 'linear',
     'Tangentenraum-Normale, OpenGL / tangent space normal, OpenGL'),
    ('orh', 'orh.png', 'dungeonOrhArray', 'linear',
     'R=Occlusion G=Rauheit B=Hoehe / R=occlusion G=roughness B=height'),
]

# Nur die Tags 0..5 liegen im Basis-Array. 6..9 sind Blend-Layer und kommen
# als eigenstaendige Detailtexturen ins Material (ARCHITECTURE W5).
# Only tags 0..5 live in the base array. 6..9 are blend layers and enter the
# material as standalone detail textures (ARCHITECTURE W5).
BASE_TAGS = list(range(6))


def png_format(path):
    """Bittiefe und Farbtyp direkt aus dem IHDR lesen. Pillows `mode` ist eine
    Auslegung, das IHDR ist die Datei.
    Read bit depth and colour type straight from the IHDR. Pillow's `mode` is an
    interpretation, the IHDR is the file."""
    with open(path, 'rb') as f:
        head = f.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise SystemExit(f'{path}: kein PNG mit IHDR / not a PNG with IHDR')
    w, h, depth, ctype = struct.unpack('>IIBB', head[16:26])
    return w, h, depth, ctype


def read_meta(root):
    """Alle material.json einlesen und nach Tag ordnen.
    Read all material.json files and order them by tag."""
    metas = {}
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name, 'material.json')
        if not os.path.isfile(p):
            continue
        with open(p, encoding='utf-8') as f:
            m = json.load(f)
        if m['tag'] in metas:
            raise SystemExit(f'Tag {m["tag"]} zweimal vergeben / tag assigned twice: '
                             f'{metas[m["tag"]]["name"]} und/and {m["name"]}')
        metas[m['tag']] = m
    if not metas:
        raise SystemExit(f'{root}: keine material.json gefunden / no material.json found')
    return metas


def stack(root, metas, tags, source, dest):
    """Layer uebereinander stapeln. Reihenfolge ist der TAG, nicht die
    Verzeichnisreihenfolge — der Layer-Index IST der `materialTag` der Zelle,
    und eine alphabetisch sortierte Platte waere ein stiller Materialtausch.
    Stack layers on top of each other. The order is the TAG, not the directory
    order — the layer index IS the cell's `materialTag`, and an alphabetically
    sorted disk would be a silent material swap."""
    first = None
    planes = []
    for tag in tags:
        m = metas[tag]
        path = os.path.join(root, m['name'], source)
        if not os.path.isfile(path):
            raise SystemExit(f'fehlt / missing: {path}')
        fmt = png_format(path)
        if first is None:
            first = fmt
        elif fmt != first:
            raise SystemExit(
                f'{path}: Layer passt nicht / layer does not match — '
                f'{fmt} statt/instead of {first}')
        planes.append(np.asarray(Image.open(path).convert('RGB'), dtype=np.uint8))
    w, h, depth, ctype = first
    strip = np.concatenate(planes, axis=0)
    Image.fromarray(strip, mode='RGB').save(dest, optimize=True)
    return {
        'file': os.path.basename(dest),
        'width': w,
        'height': h,
        'layers': len(planes),
        'bitDepth': depth,
        'pngColourType': ctype,
        # Der Streifen ist von OBEN nach unten Layer 0..n-1 — dieselbe Richtung,
        # die TerrainSplat.ts fuer den Terrain-Atlas benutzt.
        # The strip runs TOP-down as layers 0..n-1 — the same direction that
        # TerrainSplat.ts uses for the terrain atlas.
        'layout': 'vertical-strip-top-down',
        'stripHeight': strip.shape[0],
    }


def to_ktx2(png_path, uastc):
    """Optional: KTX2 daneben legen, wenn `toktx` vorhanden ist.
    Optional: place a KTX2 alongside if `toktx` is present."""
    exe = shutil.which('toktx')
    if not exe:
        return None
    dest = os.path.splitext(png_path)[0] + '.ktx2'
    cmd = [exe, '--t2', '--genmipmap']
    # UASTC fuer Normale und ORH (Kanaltreue), ETC1S fuer Albedo (Groesse).
    # UASTC for normal and ORH (channel fidelity), ETC1S for albedo (size).
    cmd += ['--uastc', '2'] if uastc else ['--bcmp']
    cmd += [dest, png_path]
    subprocess.run(cmd, check=True)
    return os.path.basename(dest)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--in', dest='src',
                   default='/home/mike/wov-wt-dungeon2/assets/dungeon2/materials')
    p.add_argument('--out', dest='dst',
                   default='/home/mike/wov-wt-dungeon2/assets/dungeon2/arrays')
    p.add_argument('--no-ktx2', action='store_true')
    a = p.parse_args(argv)

    metas = read_meta(a.src)
    missing = [t for t in BASE_TAGS if t not in metas]
    if missing:
        raise SystemExit(f'Basis-Layer fehlen / base layers missing: {missing}')
    os.makedirs(a.dst, exist_ok=True)

    index = {
        'format': 'wov-dungeon-material-arrays',
        'version': 1,
        # Der Layer-Index ist der `materialTag` aus shared/src/dungeon2/layout.ts.
        # The layer index is the `materialTag` from shared/src/dungeon2/layout.ts.
        'layerIndexIsMaterialTag': True,
        'arrays': {},
        'layers': [],
        'overlays': [],
    }

    for key, source, sampler, space, note in ARRAYS:
        dest = os.path.join(a.dst, f'{key}-array.png')
        info = stack(a.src, metas, BASE_TAGS, source, dest)
        info['sampler'] = sampler
        info['colourSpace'] = space
        info['note'] = note
        if not a.no_ktx2:
            ktx = to_ktx2(dest, uastc=(key != 'albedo'))
            if ktx:
                info['ktx2'] = ktx
        index['arrays'][key] = info
        print(f'[dungeon2] {sampler}: {info["layers"]} Layer / layers '
              f'{info["width"]}x{info["height"]} → {dest}')

    for tag in BASE_TAGS:
        m = metas[tag]
        index['layers'].append({
            'layer': tag,
            'name': m['name'],
            'label': m['label'],
            # Metallic ist die Layer-Konstante aus W5, KEIN Texturkanal.
            # Metallic is the per-layer constant from W5, NOT a texture channel.
            'metallic': m['metallic'],
            # Weltmeter je Kachelwiederholung, vom Triplanar-Shader gebraucht.
            # World metres per tile repeat, needed by the triplanar shader.
            'tileMetres': m['tileMetres'],
            'seed': m['seed'],
        })

    for tag in sorted(t for t in metas if t not in BASE_TAGS):
        m = metas[tag]
        index['overlays'].append({
            'tag': tag,
            'name': m['name'],
            'label': m['label'],
            'tileMetres': m['tileMetres'],
            'seed': m['seed'],
            'maps': m['maps'],
            'directory': os.path.relpath(os.path.join(a.src, m['name']), a.dst),
        })

    path = os.path.join(a.dst, 'materialArrayIndex.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write('\n')
    print(f'[dungeon2] {path}')

    if not a.no_ktx2 and not shutil.which('toktx'):
        # Laut, nicht still: ein fehlender Kompressionsschritt darf sich nicht
        # als "hat ja funktioniert" tarnen.
        # Loud, not silent: a missing compression step must not disguise itself
        # as "it worked".
        print('[dungeon2] HINWEIS / NOTE: `toktx` nicht im Pfad — KTX2 uebersprungen. '
              '`toktx` not on the path — KTX2 skipped. (ARCHITECTURE R4/AP8)',
              file=sys.stderr)


if __name__ == '__main__':
    main()
