#!/usr/bin/env python3
# Erzeugt: die Nass-Variante einer Stein-Albedo — dunkler und gesättigter; der Glanz kommt aus der Rauheit in texture-kit.py.
# Feucht/Nass-Variante aus einer Stein-Albedo ERZEUGEN. Nasser Stein ist dunkler
# und gesaettigter, besonders in den Vertiefungen; der eigentliche Nass-Eindruck
# kommt zusaetzlich aus NIEDRIGER RAUHEIT (Glanz), die texture-kit.py setzt.
# Aufruf: make-wet.py <in> <out> [staerke]
import sys
import numpy as np
from PIL import Image

ALB, OUT = sys.argv[1], sys.argv[2]
STAERKE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

img = Image.open(ALB).convert("RGB")
stein = np.asarray(img, dtype=np.float32) / 255.0
L = stein.mean(axis=2)

# In Vertiefungen (dunkel) staerker abdunkeln -> Wasser sammelt sich dort.
tiefe = np.clip((0.55 - L) / 0.4, 0.0, 1.0)[..., None]
faktor = 1.0 - (0.45 * STAERKE) * (0.4 + 0.6 * tiefe)  # ~0.55..0.85 dunkler
# Leichte Saettigung: Farbe etwas kraeftiger (nasser Stein wirkt satter).
mittel = stein.mean(axis=2, keepdims=True)
gesaettigt = mittel + (stein - mittel) * 1.25
aus = np.clip(gesaettigt * faktor, 0.0, 1.0)
Image.fromarray((aus * 255).astype(np.uint8), "RGB").save(OUT)
print("WET OK ->", OUT)
