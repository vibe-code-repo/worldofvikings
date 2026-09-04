#!/usr/bin/env python3
# Erzeugt: die Moos-Variante einer Stein-Albedo — Maske aus den dunklen Fugen mal Fleckenrauschen.
# Moos-Variante aus einer Stein-Albedo ERZEUGEN (kein neues Foto noetig).
# Moos setzt sich in Fugen/Vertiefungen ab -> Maske aus dunklen Bereichen
# (niedrige Helligkeit) MAL Fleckenrauschen. Gruen eingefaerbt, Steinhelligkeit
# bleibt erhalten. Aufruf: make-moss.py <albedo.png> <out.png> [staerke]
import sys
import numpy as np
from PIL import Image

ALB, OUT = sys.argv[1], sys.argv[2]
STAERKE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

img = Image.open(ALB).convert("RGB")
W, H = img.size
stein = np.asarray(img, dtype=np.float32) / 255.0
L = stein.mean(axis=2)  # Helligkeit 0..1

# Fugen-Maske: hoch, wo dunkel. Weiche Schwelle um den unteren Helligkeitsbereich.
lo, hi = 0.28, 0.55
fugen = np.clip((hi - L) / (hi - lo), 0.0, 1.0)
fugen = fugen ** 1.5  # Kontrast: nur die echten Vertiefungen

# Fleckenrauschen: grobkoerniges Zufallsfeld, weich hochskaliert -> Moos-Inseln.
rng = np.random.default_rng(7)
klein = rng.random((max(1, H // 24), max(1, W // 24))).astype(np.float32)
flecken = np.asarray(Image.fromarray((klein * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255.0
flecken = np.clip((flecken - 0.4) / 0.4, 0.0, 1.0)  # nur die dichteren Stellen

moos_maske = np.clip(fugen * flecken * STAERKE, 0.0, 1.0)[..., None]

# Moos-Farbe: gedaempftes Gruen, an die lokale Steinhelligkeit gekoppelt, damit
# es nicht wie aufgemalt wirkt.
moos_ton = np.array([0.22, 0.40, 0.14], dtype=np.float32)
moos = moos_ton[None, None, :] * (0.5 + 0.9 * L[..., None])

aus = stein * (1.0 - moos_maske) + moos * moos_maske
Image.fromarray((np.clip(aus, 0, 1) * 255).astype(np.uint8), "RGB").save(OUT)
print("MOSS OK ->", OUT, "bedeckung=%.1f%%" % (100 * (moos_maske > 0.15).mean()))
