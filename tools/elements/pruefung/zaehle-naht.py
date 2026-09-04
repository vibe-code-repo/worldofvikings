# Prüft: die hellen Pixel eines Naht-Renderings — jedes einzelne ist Licht durch eine Modulfuge.
# Zaehlt die "hellen" Pixel eines Naht-Renderings (render-naht.py).
# Hell = Licht der weissen Aussenwelt, das durch eine Modulfuge faellt.
# Der Stein liegt im Rendering weit darunter (schwache Innenlampe, matt).
#
# python3 zaehle-naht.py <bild.png> [<bild2.png> ...]
import sys
import numpy as np
from PIL import Image

SCHWELLE = 200          # 8-Bit-sRGB; Stein liegt bei ~110..150, Loch bei 255

for pfad in sys.argv[1:]:
    a = np.asarray(Image.open(pfad).convert("RGB")).astype(np.int32)
    hell = a.max(axis=2) >= SCHWELLE
    h, w = hell.shape
    ys, xs = np.nonzero(hell)
    print(f"=== {pfad}  ({w}x{h})")
    print(f"  helle Pixel (>= {SCHWELLE}): {int(hell.sum())}")
    print(f"  Steinhelligkeit: p50={int(np.percentile(a.max(axis=2), 50))} "
          f"p99={int(np.percentile(a.max(axis=2), 99))} max={int(a.max())}")
    if len(ys):
        print(f"  Zeilen {ys.min()}..{ys.max()}, Spalten {xs.min()}..{xs.max()}")
    # Nahtzonen im Bild (aus der festen Kamera von render-naht.py):
    zonen = {"Decke/Wand (obere 25%)": (0, h // 4),
             "Wandflaeche (Mitte 50%)": (h // 4, 3 * h // 4),
             "Boden/Wand (untere 25%)": (3 * h // 4, h)}
    for name, (y0, y1) in zonen.items():
        print(f"    {name}: {int(hell[y0:y1].sum())}")
    # Innenecke: senkrechter Streifen um die Bildmitte
    x0, x1 = w // 2 - 25, w // 2 + 25
    print(f"    Innenecke (Spalten {x0}..{x1}): {int(hell[:, x0:x1].sum())}")
