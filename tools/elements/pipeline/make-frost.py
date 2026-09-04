#!/usr/bin/env python3
# Erzeugt: die Frost-Variante einer Stein-Albedo — dieselbe Maske, aber bläulich-weiß und aufhellend.
# Frost-Variante aus einer Stein-Albedo ERZEUGEN. Frost/Reif setzt sich hell in
# Fugen und auf Flaechen ab -> Maske aus Fugen (dunkel) plus Fleckenrauschen,
# aber BLAEULICH-WEISS und aufhellend statt gruen. Aufruf: make-frost.py <in> <out> [staerke]
import sys
import numpy as np
from PIL import Image

ALB, OUT = sys.argv[1], sys.argv[2]
STAERKE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

img = Image.open(ALB).convert("RGB")
W, H = img.size
stein = np.asarray(img, dtype=np.float32) / 255.0
L = stein.mean(axis=2)

# Frost mag Fugen UND leicht die Flaechen -> weichere Schwelle als Moos.
lo, hi = 0.30, 0.62
fugen = np.clip((hi - L) / (hi - lo), 0.0, 1.0) ** 1.2

rng = np.random.default_rng(19)
klein = rng.random((max(1, H // 20), max(1, W // 20))).astype(np.float32)
flecken = np.asarray(Image.fromarray((klein * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=np.float32) / 255.0
flecken = np.clip((flecken - 0.35) / 0.45, 0.0, 1.0)

frost_maske = np.clip(fugen * flecken * STAERKE, 0.0, 1.0)[..., None]

# Kaltes Blau-Weiss; hell, damit es wie Reif liegt.
frost_ton = np.array([0.82, 0.88, 0.96], dtype=np.float32)
aus = stein * (1.0 - frost_maske) + frost_ton[None, None, :] * frost_maske
Image.fromarray((np.clip(aus, 0, 1) * 255).astype(np.uint8), "RGB").save(OUT)
print("FROST OK ->", OUT, "bedeckung=%.1f%%" % (100 * (frost_maske > 0.15).mean()))
