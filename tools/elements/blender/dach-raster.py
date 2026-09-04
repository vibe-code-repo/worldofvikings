# Prüft: eine Dachaufsicht auf Löcher und beschriftet die hellen Kacheln in Weltkoordinaten.
# Wertet eine Dachaufsicht (render-szene.py --dach) als KARTE aus:
# helle Kacheln = Loecher, in Weltkoordinaten beschriftet.
#   python3 dach-raster.py <bild.png> <cx> <cz> <breite> [kachel=0.25]
import sys
import numpy as np
from PIL import Image

bild, cx, cz, br = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
kachel = float(sys.argv[5]) if len(sys.argv) > 5 else 0.25
a = np.asarray(Image.open(bild).convert("RGB")).astype(int).max(axis=2)
h, w = a.shape
hell = a >= 200
n = int(round(br / kachel))
print(f"{bild}: {int(hell.sum())} helle Pixel von {h*w}  ({kachel} m je Kachel)")
kopf = "        " + "".join("|" if (ix * kachel + cx - br / 2) % 1 == 0 else " " for ix in range(n))
print(kopf)
for iy in range(n):
    z = cz - br / 2 + (iy + 0.5) * kachel
    zeile = ""
    for ix in range(n):
        blk = hell[iy * h // n:(iy + 1) * h // n, ix * w // n:(ix + 1) * w // n]
        m = blk.mean()
        zeile += "#" if m > 0.6 else ("+" if m > 0.05 else ".")
    print(f"z{z:+6.2f} {zeile}")
print("x von", cx - br / 2, "bis", cx + br / 2)
