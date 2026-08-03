#!/usr/bin/env python
"""G-VEG2: generiert Gras-Atlas-Texturen fuer das grasscross-Mesh.

Die gerippten Unity-Texturen sind unbrauchbar (nur 9,5 % Alpha in einem
Streifen am unteren Rand — vermutlich Terrain-Detail-Sprites bzw. kleinste
Mip-Stufe, NICHT die Cross-Atlas-Textur, die das Mesh per UV erwartet).

Das grasscross-Mesh sampelt drei horizontale UV-Spalten (u ~0.01-0.37,
0.37-0.66, 0.66-0.97) mit vollen Blatt-Hoehen (v 0.03-0.99). Wir zeichnen
daher drei Halme-Buendel-Spalten: Halme von unten (v=1, Boden) nach oben
zulaufend, Farbverlauf dunkle Basis -> helle Spitze, Alpha 255 im Halm.

Ausgabe: valheim_browser_assets/textures/grass_meadows_gen.png (gruen)
         valheim_browser_assets/textures/grass_heath_gen.png  (khaki/trocken)
         valheim_browser_assets/textures/grass_toon1_yellow_gen.png (Sumpf-Gelbgruen)

grass_toon1_yellow.png (swampGrass, mesh 'droopy' = grasscross.glb, siehe
glb-uv-dump: identisches 3-Spalten-UV-Layout wie clutter_default.glb) ist
derselbe Fehlerfall, nur subtiler: Alpha ist zwar über die volle Höhe verteilt
(kein reiner Bodenstreifen), aber die "Halme" sind nur 1px breite Linien ohne
Blattfläche — bei normaler Renderdistanz praktisch unsichtbare Striche statt
Gras (2026-07-26, Playwright-Vergleich mit den generierten Texturen).
"""
import math
import random
from PIL import Image, ImageDraw

W = H = 256
# UV-Spalten des Meshs (aus glb-uv-dump): drei Bereiche mit kleinen Raendern
COLUMNS = [(0.01, 0.37), (0.37, 0.66), (0.66, 0.975)]


def lerp(a, b, t):
    return a + (b - a) * t


def gen(path, base_rgb, tip_rgb, blades_per_col, seed):
    random.seed(seed)
    # RGB-Hintergrund mit mittlerer Halm-Farbe fuellen (Alpha 0): sonst
    # mischen die Mipmaps die Halme mit transparentem SCHWARZ und die
    # Bueschel werden mit Distanz schwarz (klassisches Alpha-Bleed-Problem).
    bg = tuple((base_rgb[i] + tip_rgb[i]) // 2 for i in range(3))
    im = Image.new('RGBA', (W, H), bg + (0,))
    dr = ImageDraw.Draw(im)
    for (u0, u1) in COLUMNS:
        x0, x1 = u0 * W, u1 * W
        for _ in range(blades_per_col):
            bx = random.uniform(x0 + 3, x1 - 3)          # Basis-x
            hgt = random.uniform(0.55, 0.97) * H          # Halm-Hoehe
            lean = random.uniform(-0.16, 0.16) * (x1 - x0)  # seitl. Drift
            w_base = random.uniform(3.0, 5.5)             # Breite unten
            tx = bx + lean
            ty = H - hgt
            # Halm als gefuelltes Polygon: unten breit, oben spitz,
            # mit leichter Biegung (Mittelpunkt versetzt)
            mx = (bx + tx) / 2 + lean * 0.35
            my = (H + ty) / 2
            shade = random.uniform(0.85, 1.15)
            pts_l, pts_r = [], []
            steps = 8
            for s in range(steps + 1):
                t = s / steps
                # quadratische Bezier-Interpolation der Mittellinie
                cx = (1 - t) ** 2 * bx + 2 * (1 - t) * t * mx + t ** 2 * tx
                cy = (1 - t) ** 2 * (H - 1) + 2 * (1 - t) * t * my + t ** 2 * ty
                w = w_base * (1 - t) ** 0.9 + 0.2
                pts_l.append((cx - w / 2, cy))
                pts_r.append((cx + w / 2, cy))
                col = tuple(
                    min(255, int(lerp(base_rgb[i], tip_rgb[i], t) * shade))
                    for i in range(3)
                ) + (255,)
                if s > 0:
                    # Segment zwischen s-1 und s als Vieleck fuellen
                    seg = [pts_l[s - 1], pts_l[s], pts_r[s], pts_r[s - 1]]
                    dr.polygon(seg, fill=col)
    im.save(path)
    solid = sum(1 for y in range(H) for x in range(W) if im.getpixel((x, y))[3] > 127)
    print(f'{path}: {W}x{H}, alpha>0.5 = {solid / (W * H):.2f}')


OUT = '../valheim_browser_assets/textures/'
gen(OUT + 'grass_meadows_gen.png', (52, 88, 30), (110, 155, 62), 42, seed=7)
gen(OUT + 'grass_heath_gen.png', (96, 84, 40), (168, 152, 88), 36, seed=13)
gen(OUT + 'grass_toon1_yellow_gen.png', (58, 66, 28), (150, 148, 72), 30, seed=21)
