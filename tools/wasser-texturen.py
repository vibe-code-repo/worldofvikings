#!/usr/bin/env python3
"""
Die vier Wassertexturen und die Gelaende-Gruenkarte — eigene statt gerippte.

    python3 tools/wasser-texturen.py [--nur wasser|gras]

── Was erzeugt wird ─────────────────────────────────────────────────
  water_foam_real.png       256x256   Schaum, dicht — Kanal r, Spitze ~0.65
  water_randomfoam_real.png 1024x1024 Schaumflocken, duenn — r, Spitze ~0.52
  water_normals_real.png    512x512   Wellen, DXT5nm-GEPACKT (siehe unten)
  water_normals_fine.png    512x512   feine Kraeuselung, normale Packung
  grass_terrain_color.png   1024x1024 Gruenton, den GrassClutter auf die
                                      Halme legt

── Die Packung von water_normals_real ist NICHT frei waehlbar ───────
`WaterPlugin.ts` liest die Steigung als `vec2(wN0.a, wN0.g)` — X steckt im
ALPHA-Kanal, Y im Gruenkanal. Unity packt DXT5nm als (1, y, y, x); der
Kommentar dort haelt fest, dass ueber alle 262.144 Pixel `max|G-B| = 0`
gilt. B wird deshalb exakt gleich G gesetzt, R bleibt 1. Wer hier eine
gewoehnliche Normal-Map ablegt, bekommt als Steigung (alpha, gruen) =
(1, y) und das Wasser kippt permanent in eine Richtung.

`water_normals_fine` ist dagegen normal gepackt und wird als
`.xyz * 2.0 - 1.0` gelesen.

── Helligkeiten ─────────────────────────────────────────────────────
Der Shader teilt den Schaum durch feste Werte (`f1 = …r / 0.65`,
`f2 = …r / 0.52`) und zieht fuer den Curl 0.33 ab. Die Mittel- und
Spitzenwerte der Texturen sind also Teil der Rechnung, nicht Geschmack.
Zielwerte aus den bisherigen Dateien: Schaum dicht Mittel 0.26,
Schaumflocken Mittel 0.04.

Wie ueberall in diesem Ordner ist das Rauschen periodisch
(`lib/rauschen.py`), weil die Texturen ueber die Wasserflaeche gekachelt
werden. Sinusanteile brauchen ganzzahlige Perioden ueber die Kante —
sonst steht an der Naht eine Kante im Meer.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from rauschen import furchen, oktaven  # noqa: E402

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(WURZEL, "assets/textures")


def auf_ziel(feld, mittel, spitze):
    """Feld auf Zielmittel und Zielspitze ziehen (0..1, nichts abgeschnitten)."""
    f = feld - feld.min()
    f = f / max(1e-6, f.max())
    # Gamma so waehlen, dass das Mittel passt: mean(f**g) = mittel/spitze
    ziel = np.clip(mittel / max(1e-6, spitze), 1e-3, 0.999)
    lo, hi = 0.05, 20.0
    for _ in range(40):
        g = 0.5 * (lo + hi)
        if (f ** g).mean() > ziel:
            lo = g
        else:
            hi = g
    return np.clip((f ** (0.5 * (lo + hi))) * spitze, 0, 1)


def schaum_dicht(rnd, n=256):
    """Dichter Schaum: wirbelige Straehnen, keine gleichmaessige Wolke."""
    straehnen = furchen(n, n, 6, 6, 4, 0.6, rnd)
    wirbel = oktaven(n, n, 3, 3, 4, rnd)
    fein = oktaven(n, n, 18, 18, 3, rnd)
    f = 0.5 * straehnen + 0.3 * wirbel + 0.2 * fein
    return auf_ziel(f, mittel=0.262, spitze=0.68)


def schaum_flocken(rnd, n=1024):
    """Duenne Flocken: fast schwarz, vereinzelt helle Fetzen."""
    grund = oktaven(n, n, 24, 24, 3, rnd)
    # Nur die obersten Prozent stehen lassen — daher der harte Schwellwert.
    flocken = np.clip(grund - 0.66, 0, 1) * 3.0
    fein = oktaven(n, n, 90, 90, 2, rnd)
    f = flocken * (0.6 + 0.4 * fein)
    return auf_ziel(f, mittel=0.036, spitze=0.55)


def wellenhoehe(n, rnd, richtungen, wellen, rausch_zellen, rausch_anteil):
    """Summe gekreuzter Wellenzuege plus Rauschen — periodisch.

    `wellen` ist die Zahl VOLLER Perioden ueber die Kante und muss deshalb
    ganzzahlig sein, sonst passt die Welle an der Kachelgrenze nicht auf
    sich selbst.
    """
    y, x = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    h = np.zeros((n, n))
    for (kx, ky), amp in zip(richtungen, wellen):
        phase = rnd.random() * 2 * np.pi
        h += amp * np.sin(2 * np.pi * (kx * x + ky * y) / n + phase)
    h = h / max(1e-6, np.abs(h).max())
    return (1 - rausch_anteil) * h + rausch_anteil * (
        oktaven(n, n, rausch_zellen, rausch_zellen, 4, rnd) * 2 - 1
    )


def normale(h, staerke):
    """Hoehenfeld -> Normalenvektoren (x, y, z), bereits normiert."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * staerke
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * staerke
    v = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def normals_real(rnd, n=512):
    """Grosse Wellen, Unity-DXT5nm gepackt: (1, y, y, x)."""
    h = wellenhoehe(n, rnd, [(3, 1), (-2, 3), (5, -4), (1, 6)],
                    [1.0, 0.7, 0.4, 0.25], 6, 0.35)
    v = normale(h, staerke=2.2)
    x = v[..., 0] * 0.5 + 0.5
    y = v[..., 1] * 0.5 + 0.5
    aus = np.zeros((n, n, 4), dtype=np.float32)
    aus[..., 0] = 1.0        # R: von Unity ungenutzt, im Original konstant 1
    aus[..., 1] = y          # G: Y
    aus[..., 2] = y          # B: EXAKT gleich G (max|G-B| = 0 im Original)
    aus[..., 3] = x          # A: X — hier liest der Shader
    return aus


def normals_fine(rnd, n=512):
    """Feine Kraeuselung, gewoehnlich gepackt (xyz in rgb)."""
    h = wellenhoehe(n, rnd, [(11, 7), (-9, 13), (17, -5)],
                    [1.0, 0.8, 0.5], 20, 0.5)
    v = normale(h, staerke=1.1)
    rgb = v * 0.5 + 0.5
    return np.concatenate([rgb, np.ones((n, n, 1), dtype=np.float32)], axis=-1)


def gras_gruen(rnd, n=1024):
    """Gruenkarte fuer GrassClutter — Zielmittel (0.349, 0.468, 0.260)."""
    grob = oktaven(n, n, 5, 5, 4, rnd)
    fein = oktaven(n, n, 22, 22, 3, rnd)
    f = np.clip(0.65 * grob + 0.35 * fein, 0, 1)
    dunkel = np.array([0.24, 0.34, 0.16], dtype=np.float32)
    hell = np.array([0.46, 0.60, 0.36], dtype=np.float32)
    rgb = dunkel[None, None, :] + f[..., None] * (hell - dunkel)[None, None, :]
    # Auf die Zielmittel nachziehen, damit die Halme nicht heller oder
    # fahler werden als bisher.
    ziel = np.array([0.349, 0.468, 0.260], dtype=np.float32)
    rgb *= (ziel / rgb.reshape(-1, 3).mean(axis=0))[None, None, :]
    return np.clip(rgb, 0, 1)


def schreibe(name, feld, modus=None):
    arr = (np.clip(feld, 0, 1) * 255).round().astype(np.uint8)
    bild = Image.fromarray(arr, mode=modus) if modus else Image.fromarray(arr)
    pfad = os.path.join(ZIEL, name)
    bild.save(pfad)
    a = np.asarray(bild.convert("RGBA"), dtype=np.float32) / 255
    print(f"  {name:26s} {bild.size[0]}x{bild.size[1]} {bild.mode:5s} "
          f"RGB=({a[...,0].mean():.3f},{a[...,1].mean():.3f},{a[...,2].mean():.3f}) "
          f"A={a[...,3].mean():.3f}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nur", choices=["wasser", "gras"])
    p.add_argument("--seed", type=int, default=20260813)
    args = p.parse_args()
    os.makedirs(ZIEL, exist_ok=True)

    if args.nur in (None, "wasser"):
        print("Wasser:")
        g = schaum_dicht(np.random.default_rng(args.seed))
        schreibe("water_foam_real.png",
                 np.concatenate([np.repeat(g[..., None], 3, -1),
                                 np.ones((*g.shape, 1), dtype=np.float32)], -1), "RGBA")
        g = schaum_flocken(np.random.default_rng(args.seed + 1))
        schreibe("water_randomfoam_real.png",
                 np.concatenate([np.repeat(g[..., None], 3, -1),
                                 np.ones((*g.shape, 1), dtype=np.float32)], -1), "RGBA")
        schreibe("water_normals_real.png",
                 normals_real(np.random.default_rng(args.seed + 2)), "RGBA")
        schreibe("water_normals_fine.png",
                 normals_fine(np.random.default_rng(args.seed + 3)), "RGBA")

    if args.nur in (None, "gras"):
        print("Gelaende-Gruen:")
        rgb = gras_gruen(np.random.default_rng(args.seed + 4))
        schreibe("grass_terrain_color.png",
                 np.concatenate([rgb, np.ones((*rgb.shape[:2], 1), dtype=np.float32)], -1),
                 "RGBA")


if __name__ == "__main__":
    main()
