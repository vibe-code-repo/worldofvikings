#!/usr/bin/env python3
"""
Bereitet die HD-Clutter-Texturen für den Client auf: verkleinert die
Willybach-Vorlagen aus `assets/textures-hd/grass/` auf eine web-taugliche
Kantenlänge und legt sie flach unter `assets/textures/hd-clutter/` ab.

Warum nicht direkt die Originale laden: die Vorlagen sind 1024²–2048² und in
Summe knapp 90 MB allein für das Gras — für Billboard-Halme, die im Bild selten
mehr als ~100 px hoch sind, ist das um Größenordnungen zu viel.

Alpha wird premultipliziert skaliert. Ohne das mischt der Filter die (schwarzen)
RGB-Werte vollständig transparenter Pixel in die Halmränder und das Gras
bekommt dunkle Säume — bei Cutout-Texturen der klassische Fehler.

    python3 tools/make-hd-clutter.py [--size 512] [--seasons summer,fall]
"""

import argparse
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/textures-hd/grass")
DST = os.path.join(ROOT, "assets/textures/hd-clutter")

# Quelle (unter assets/textures-hd/grass/) → Zielname ohne Saison.
# Deckt alle 13 ClutterEntry-Texturen aus GrassClutter.ts ab.
SOURCES = [
    "meadows/grasscross_meadows",
    "meadows/grasscross_meadows_short",
    "meadows/clutter_shrub",
    "blackforest/ormbunke",
    "blackforest/vass",
    "blackforest/clutter_waterlilies",
    "blackforest/grasscross_forest",
    "blackforest/grasscross_forest_brown",
    "plains/grasscross_heath",
    "plains/grasscross_heath_flower",
    "swamp/grasscross_swamp",
    "swamp/ormbunke_yellow",
    "mistlands/grasscross_mistlands_short",
    "ashlands/grasscross_ashlands_short",
]

SEASONS = ["spring", "summer", "fall", "winter"]


def resize_cutout(im: Image.Image, size: int) -> Image.Image:
    """Alpha-korrekt verkleinern (premultiply → resize → unpremultiply).

    ── Zwei Fehler, die hier steckten (2026-08-02) ──────────────────────
    Die erste Fassung speicherte das premultiplizierte Bild vor dem
    Verkleinern als uint8 zwischen. Bei dünnen Halmen ist `rgb × alpha`
    aber winzig: bei alpha = 0.02 landet ein Grün von 0.4 als
    0.4 × 0.02 × 255 ≈ 2 im Byte. Die anschließende Division durch
    dasselbe kleine Alpha multipliziert den Quantisierungsfehler wieder
    hoch — aus ±0.5/255 werden ±10 %. Gemessen am Ergebnis:

        halbtransparente Ränder   RGB(109, 144, 107)
        sichtbare Halme           RGB( 72, 101,  70)

    In der 2048er-Quelle sind beide praktisch gleich (73,104,72) gegen
    (70,98,68). Die Ränder wurden also beim Verkleinern deutlich zu hell.
    Da 23 % aller Pixel halbtransparent sind und der Alpha-Cutout sie als
    volle Pixel zeichnet, ergab das im Spiel einen ausgebleicht wirkenden,
    fast weißen Grasteppich. Behoben: die Kanäle werden als 32-bit-Float
    verkleinert, es gibt keinen uint8-Zwischenschritt mehr.

    Zweitens setzte der Code vollständig transparente Pixel auf WEISS
    ("Farbe ist dort beliebig"). Beliebig ist sie aber nur, solange
    niemand sie mittelt — genau das tut die GPU beim Erzeugen der
    Mipmaps, und dann blutet das Weiß in die Halmränder. Stattdessen
    bekommen sie jetzt die mittlere Halmfarbe: neutral in jeder
    Mip-Stufe, in der Basisstufe unsichtbar.
    """
    import numpy as np

    src = np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = src[:, :, 3]
    pm = src[:, :, :3] * alpha[:, :, None]

    def skaliere(kanal: "np.ndarray") -> "np.ndarray":
        """Einen Kanal in voller Float-Genauigkeit verkleinern."""
        bild = Image.fromarray(kanal, "F").resize((size, size), Image.LANCZOS)
        return np.asarray(bild, dtype=np.float32)

    a = np.clip(skaliere(alpha), 0.0, 1.0)
    prem = np.stack([skaliere(pm[:, :, i]) for i in range(3)], axis=2)

    # Unterhalb dieser Deckung ist die Division numerisch nicht mehr
    # tragfähig — dort zählt ohnehin nur, dass die Farbe beim Mipmapping
    # nicht stört.
    MIN_ALPHA = 1.0 / 255.0
    tragfaehig = a >= MIN_ALPHA
    rgb = np.where(
        tragfaehig[:, :, None],
        prem / np.maximum(a, MIN_ALPHA)[:, :, None],
        0.0,
    )

    # Mittlere Farbe der gut gedeckten Halme als Füllung für alles, was
    # (nahezu) nichts deckt.
    deckend = a > 0.5
    if deckend.any():
        fuellung = rgb[deckend].reshape(-1, 3).mean(axis=0)
    else:
        fuellung = np.zeros(3, dtype=np.float32)
    rgb = np.where(tragfaehig[:, :, None], rgb, fuellung[None, None, :])

    res = np.concatenate([np.clip(rgb, 0.0, 1.0), a[:, :, None]], axis=2)
    return Image.fromarray((res * 255.0 + 0.5).astype(np.uint8), "RGBA")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--seasons", default=",".join(SEASONS))
    args = ap.parse_args()
    seasons = [s.strip() for s in args.seasons.split(",") if s.strip()]

    os.makedirs(DST, exist_ok=True)
    written, missing = 0, []
    for rel in SOURCES:
        for season in seasons:
            src = os.path.join(SRC, f"{rel}@{season}.png")
            if not os.path.exists(src):
                missing.append(f"{rel}@{season}")
                continue
            name = os.path.basename(rel)
            dst = os.path.join(DST, f"{name}@{season}.png")
            with Image.open(src) as im:
                resize_cutout(im, args.size).save(dst, optimize=True)
            written += 1
            print(f"  {name}@{season}  {im.size[0]}² → {args.size}²", flush=True)

    total = sum(os.path.getsize(os.path.join(DST, f)) for f in os.listdir(DST))
    print(f"\n{written} Texturen → {os.path.relpath(DST, ROOT)} ({total/1e6:.1f} MB)")
    if missing:
        print(f"nicht gefunden ({len(missing)}): {', '.join(missing)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
