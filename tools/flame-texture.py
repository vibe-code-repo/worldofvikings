#!/usr/bin/env python3
"""
Generate a flame sprite atlas — the texture behind every fire in the game.

    python3 tools/flame-texture.py --out assets/textures/flame.png

── Why an atlas and not one still image ─────────────────────────────
Fire reads as fire through its SHAPE changing, not through its
brightness. A single flame image, however pretty, is a painted flame; the
eye recognises fire by edges that tear off and dissolve. Sixteen frames
played in a loop give exactly that, and the shader only has to offset UVs
— no noise maths per pixel, nothing to tune by eye through a compile
cycle.

── How the frames are made ──────────────────────────────────────────
Layered value noise, advected upward with a per-frame offset, multiplied
by a flame-shaped mask (wide and round at the base, narrow and unstable
at the tip). The noise is TILEABLE in time: frame 16 continues into frame
1, otherwise the loop jumps once a second and that is the one thing the
eye catches immediately.

Colour comes from the resulting intensity, not from the noise: hot core
white-yellow, body orange, dying edges deep red. Alpha is the same
intensity, so the flame dissolves at its edges instead of ending in a
cut-out silhouette.

Deterministic: the noise is seeded from a fixed value, so two runs give
the same file. A texture that changes on every run makes every diff
unreadable.
"""

import argparse
import math
import os

import numpy as np
from PIL import Image


def value_noise(rng, h, w, cells_y, cells_x, frames, phase_cells):
    """
    Value noise on a coarse grid, smoothly interpolated, looping in time.

    The time axis is a CIRCLE: the grid is sampled around a ring of
    `phase_cells` steps, so the last frame flows back into the first.
    """
    # Periodisch in x UND y: `np.roll` unten verschiebt die Zeilen, und ein
    # Gitter, das oben nicht in sich zurücklaeuft, zieht dabei eine
    # sichtbare Naht quer durch jede Flamme.
    grid = rng.random((phase_cells, cells_y, cells_x))
    ys = np.linspace(0, cells_y, h, endpoint=False)
    xs = np.linspace(0, cells_x, w, endpoint=False)
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    # Smoothstep — linear interpolation leaves visible grid creases.
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)

    out = np.empty((frames, h, w), dtype=np.float32)
    for f in range(frames):
        t = f / frames * phase_cells
        t0 = int(t) % phase_cells
        t1 = (t0 + 1) % phase_cells
        ft = t - int(t)
        ft = ft * ft * (3 - 2 * ft)
        a = grid[t0]
        b = grid[t1]
        g = a * (1 - ft) + b * ft
        y1 = (y0 + 1) % cells_y
        x1 = (x0 + 1) % cells_x
        c00 = g[y0][:, x0]
        c10 = g[y1][:, x0]
        c01 = g[y0][:, x1]
        c11 = g[y1][:, x1]
        out[f] = (
            c00 * (1 - fy) * (1 - fx)
            + c01 * (1 - fy) * fx
            + c10 * fy * (1 - fx)
            + c11 * fy * fx
        )
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', default='assets/textures/flame.png')
    p.add_argument('--size', type=int, default=1024, help='atlas edge in pixels')
    p.add_argument('--grid', type=int, default=4, help='frames per row (grid x grid frames)')
    p.add_argument('--seed', type=int, default=7)
    args = p.parse_args()

    grid = args.grid
    frames = grid * grid
    tile = args.size // grid
    rng = np.random.default_rng(args.seed)

    # Flame mask in tile space. v = 0 at the bottom, 1 at the tip.
    v = np.linspace(0.0, 1.0, tile, endpoint=False)[::-1][:, None]
    u = np.linspace(-1.0, 1.0, tile, endpoint=False)[None, :]

    # Schmal und hoch. Der erste Anlauf war 0.85 breit und ergab einen
    # Kegel — eine Fackelflamme ist gut dreimal so hoch wie breit.
    breite = np.clip(0.62 * (1.0 - v) ** 0.5 + 0.04, 1e-3, None)
    koerper = np.clip(1.0 - (np.abs(u) / breite) ** 2.0, 0.0, 1.0)
    # Kein weicher Fuss: Die Karte steckt im Brennmaterial, und ein
    # durchsichtiger Fuss zeigt genau die Schnittkante darunter.
    fuss = np.clip(v / 0.02, 0.0, 1.0)
    maske = koerper * fuss

    # Drei Oktaven statt zwei, die feinste am schnellsten: Der Unterschied
    # in der Geschwindigkeit ist das, was die Spitze abreissen laesst,
    # statt die ganze Flamme zu verschieben.
    grob = value_noise(rng, tile, tile, 3, 3, frames, 4)
    mittel = value_noise(rng, tile, tile, 7, 5, frames, 6)
    fein = value_noise(rng, tile, tile, 15, 11, frames, 8)

    atlas = np.zeros((args.size, args.size, 4), dtype=np.float32)
    for f in range(frames):
        # Upward advection: shift the noise rows by the frame index. Wraps,
        # so the loop stays closed.
        s_grob = np.roll(grob[f], -int(f * tile / frames * 1.0), axis=0)
        s_mittel = np.roll(mittel[f], -int(f * tile / frames * 1.8), axis=0)
        s_fein = np.roll(fein[f], -int(f * tile / frames * 3.2), axis=0)
        rausch = 0.50 * s_grob + 0.32 * s_mittel + 0.18 * s_fein

        # Das Rauschen FRISST die Maske von aussen, und nach oben hin immer
        # gieriger — so zerfaellt die Flamme in Zungen, statt gleichmaessig
        # duenner zu werden.
        hunger = 0.42 + 1.35 * v
        i = np.clip(maske - hunger * (1.0 - rausch), 0.0, 1.0)
        i = np.clip(i / 0.55, 0.0, 1.0)

        # ── Flach statt weich ────────────────────────────────────────
        # Die Welt ist Low Poly: flaechige Farben, harte Kanten, keine
        # Verlaeufe. Eine weich ausgeblendete Flamme sieht darin aus wie
        # ein Fremdkoerper aus einem anderen Spiel — genau so ist der
        # erste Anlauf angekommen.
        #
        # Deshalb wird die Intensitaet in STUFEN gelegt: drei Baender fuer
        # die Farbe, eine harte Schwelle fuer die Silhouette. Das Rauschen
        # bleibt, es macht jetzt aber Zacken statt Nebel.
        stufen = np.floor(np.clip(i, 0.0, 0.999) * 3.0) / 2.0   # 0, 0.5, 1
        harte_kante = (i > 0.34).astype(np.float32)

        # Drei Farben, sonst nichts: aussen tiefes Rot, Mitte Orange,
        # Kern helles Gelb.
        r = np.where(stufen >= 1.0, 1.00, np.where(stufen >= 0.5, 0.98, 0.78))
        g = np.where(stufen >= 1.0, 0.92, np.where(stufen >= 0.5, 0.55, 0.18))
        b = np.where(stufen >= 1.0, 0.55, np.where(stufen >= 0.5, 0.13, 0.05))
        a = harte_kante

        ry, rx = divmod(f, grid)
        y0, x0 = ry * tile, rx * tile
        atlas[y0:y0 + tile, x0:x0 + tile, 0] = r
        atlas[y0:y0 + tile, x0:x0 + tile, 1] = g
        atlas[y0:y0 + tile, x0:x0 + tile, 2] = b
        atlas[y0:y0 + tile, x0:x0 + tile, 3] = a

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    Image.fromarray((atlas * 255).astype(np.uint8), 'RGBA').save(args.out)
    belegt = float((atlas[..., 3] > 0.02).mean())
    print(
        f'{args.out}: {args.size}² atlas, {grid}x{grid} = {frames} frames of {tile}²,'
        f' {belegt * 100:.1f} % covered'
    )


main()
