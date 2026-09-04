#!/usr/bin/env python3
# Erzeugt: eine Tangent-Space-Normal-Map aus einer Stein-Albedo (Sobel auf der Helligkeit als Höhe).
# Aus einer Stein-Albedo eine Tangent-Space-Normal-Map ableiten (Sobel auf der
# Helligkeit als Hoehe). Kein Ersatz fuer gebackene Normalen, aber gibt der
# flachen Wand glaubwuerdige Tiefe. Aufruf: make-normal.py <albedo.png> <out_normal.png> [staerke]
import sys
from PIL import Image, ImageFilter
import numpy as np

ALB, OUT = sys.argv[1], sys.argv[2]
STAERKE = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

img = Image.open(ALB).convert("L")
h = np.asarray(img, dtype=np.float32) / 255.0
# Sobel-Gradienten
gx = np.zeros_like(h); gy = np.zeros_like(h)
gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
nx = -gx * STAERKE
ny = -gy * STAERKE
nz = np.ones_like(h)
length = np.sqrt(nx*nx + ny*ny + nz*nz)
nx, ny, nz = nx/length, ny/length, nz/length
# von [-1,1] nach [0,255], Standard-Normal-Map (Y nach oben)
rgb = np.stack([(nx*0.5+0.5), (ny*0.5+0.5), (nz*0.5+0.5)], axis=-1)
Image.fromarray((rgb*255).astype(np.uint8), "RGB").save(OUT)
print("NORMAL OK ->", OUT)
