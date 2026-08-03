#!/usr/bin/env python3
"""
extract-texture-arrays.py — Texture2DArrays und Texture3D aus dem Client holen.

── Warum es dieses Werkzeug gibt ────────────────────────────────────
Der vorhandene Client-Export unter `Valheim_Client/extracted_assets/`
enthält NUR `Texture2D`. Valheims Boden liegt aber als `Texture2DArray`
vor, und genau die beiden fehlten deshalb komplett:

    terrain_d_array   256×256, 16 Layer   (_DiffuseArrayTex)
    terrain_n_array   256×256,  4 Layer   (_NormalArrayTex)

Beide hängen am Terrain-Material `Heightmap_basematerial`
(`extracted_assets/Material/unnamed_7.json`), zusammen mit zwölf
weiteren Slots — von denen im Export nur vier lagen.

── Wo die Daten stecken ─────────────────────────────────────────────
NICHT in resources.assets oder sharedassets0.assets: Valheim lädt sie
aus einem AssetBundle unter

    valheim_Data/StreamingAssets/SoftRef/Bundles/c4210710

Das Bundle enthält 291.921 Objekte; die Pixel selbst liegen nicht im
Objekt, sondern per `m_StreamData` in der begleitenden `.resS`-Ressource
(Offset + Länge). UnityPy löst diesen Verweis bei Bundles nicht selbst
auf — `obj.read().image` wirft "Texture2D has no image data". Deshalb
liest dieses Skript den `.resS`-Block von Hand.

── Das Format ───────────────────────────────────────────────────────
`m_Format` ist hier Unitys GraphicsFormat, nicht das TextureFormat-Enum:

    108 = BC7 SRGB   (terrain_d_array)
    109 = BC7 UNorm  (terrain_n_array)

BC7 belegt wie BC3 genau 1 Byte je Pixel — die Grösse allein verrät das
Format also NICHT, und mit BC3 dekodiert entsteht plausibel aussehendes
graubraunes Rauschen (alle 16 Layer hatten eine mittlere Farbe um
(105, 100, 92), kein grüner Gras- und kein heller Sandlayer darunter).
Verifiziert wurde BC7 gegen die bereits vorhandene, aus einem
AssetRipper-Lauf stammende `assets/textures/terrain_d_array.png`:
pixelgleich, maximale Abweichung 0.

── Benutzung ────────────────────────────────────────────────────────
Braucht UnityPy, Pillow und texture2ddecoder in einer venv:

    python3 -m venv --without-pip venv
    curl -sS https://bootstrap.pypa.io/get-pip.py | ./venv/bin/python -
    ./venv/bin/python -m pip install UnityPy Pillow numpy
    ./venv/bin/python tools/extract-texture-arrays.py [ZIEL]

Geschrieben werden je Array ein senkrechter Atlas (Breite × Höhe·Layer,
also 256×4096 bzw. 256×1024 — genau das Format, das TerrainSplat.ts
erwartet) und zusätzlich jeder Layer einzeln.

── Hinweis zu terrain_n_array ───────────────────────────────────────
Die vier Normal-Layer sind DXT5nm-gepackt: gemessene mittlere Farbe
(255, 128, 128), X liegt also im ALPHA-Kanal und Y in Grün, Rot ist
konstant 1. Wer sie benutzt, muss die Normale daraus rekonstruieren —
dieselbe Falle wie bei `water_normals_real.png`, siehe WaterPlugin.ts.

── CurlNoise (Texture3D) ────────────────────────────────────────────
Der letzte Slot des Terrain-Materials ist ein 128³-Volumen. Es liegt
NICHT im .resS, sondern inline im Objekt, und `m_Format = 48` heisst
R16G16B16A16_SFloat: 8 Byte je Texel, gemessener Wertebereich
-1.0908 .. 2.7246. Die drei Farbkanäle unterscheiden sich (echtes
Vektorfeld, wie bei Curl-Noise zu erwarten), Alpha ist konstant 2.0 und
wird deshalb nicht mitgeschrieben. Das Volumen ist praktisch nahtlos:
die mittlere Differenz zwischen gegenüberliegenden Rändern liegt bei
0.03 gegen eine Streuung von 0.57.

Geschrieben werden zwei Fassungen:

  CurlNoise_rgb_f16.bin   roh und verlustfrei, float16 RGB in der
                          Reihenfolge z, y, x, Kanal (12 MB)
  CurlNoise.png           Slice-Atlas 16×8 Kacheln = 2048×1024, linear
                          auf 0..255 normalisiert

Für das PNG gilt  wert = pixel / 255 · (2.7246 + 1.0908) - 1.0908.
Die 8-Bit-Stufung kostet dabei höchstens 0.0075 an Genauigkeit.
"""
import os
import sys

import numpy as np
import UnityPy
import texture2ddecoder
from PIL import Image

BUNDLE = ('/root/Valheim_Client/Valheim/valheim_Data/StreamingAssets'
          '/SoftRef/Bundles/c4210710')

# PathIDs aus Heightmap_basematerial. Als int-Literal und nicht aus dem
# Material-JSON gelesen: die IDs sind 64-bit, und json.load() rundet sie
# in Pythons float-Pfad kaputt, sobald sie über 2^53 liegen.
ARRAYS = {
    -4418745866935824791: '_DiffuseArrayTex',
    -3717166463683967554: '_NormalArrayTex',
}
VOLUMEN = {-6028947363461567598: '_CurlNoise'}


def schreibe_volumen(d, ziel: str, slot: str) -> None:
    """Texture3D als rohes float16-RGB plus Slice-Atlas ablegen."""
    b, h, t = int(d.m_Width), int(d.m_Height), int(d.m_Depth)
    vol = np.frombuffer(bytes(d.image_data), dtype=np.float16).reshape(t, h, b, 4)
    rgb = vol[..., :3]
    rgb.astype(np.float16).tofile(os.path.join(ziel, f'{d.m_Name}_rgb_f16.bin'))

    f = rgb.astype(np.float32)
    lo, hi = float(f.min()), float(f.max())
    norm = np.clip((f - lo) / (hi - lo), 0, 1)
    # Quadratisches Kachelraster statt eines 128-fach hohen Streifens.
    spalten = 16
    zeilen = (t + spalten - 1) // spalten
    atlas = Image.new('RGB', (spalten * b, zeilen * h))
    for z in range(t):
        scheibe = (norm[z] * 255.0 + 0.5).astype(np.uint8)
        atlas.paste(Image.fromarray(scheibe, 'RGB'), ((z % spalten) * b, (z // spalten) * h))
    atlas.save(os.path.join(ziel, f'{d.m_Name}.png'))
    print(f'{d.m_Name}: {b}×{h}×{t} float16 ({slot}), Bereich {lo:.4f} .. {hi:.4f}')


def main(ziel: str) -> int:
    if not os.path.exists(BUNDLE):
        print(f'Bundle nicht gefunden: {BUNDLE}', file=sys.stderr)
        return 1
    os.makedirs(ziel, exist_ok=True)

    env = UnityPy.load(BUNDLE)
    ress = next((v for k, v in env.cabs.items() if k.endswith('.ress')), None)
    if ress is None:
        print('Keine .resS-Ressource im Bundle', file=sys.stderr)
        return 1
    roh = ress.bytes if hasattr(ress, 'bytes') else ress.read()

    for obj in env.objects:
        if obj.path_id in VOLUMEN:
            schreibe_volumen(obj.read(), ziel, VOLUMEN[obj.path_id])
            continue
        if obj.path_id not in ARRAYS:
            continue
        d = obj.read()
        name = d.m_Name
        breite, hoehe, tiefe = int(d.m_Width), int(d.m_Height), int(d.m_Depth)
        sd = d.m_StreamData
        daten = roh[sd.offset:sd.offset + sd.size]
        je_layer = len(daten) // tiefe

        layer = []
        for i in range(tiefe):
            px = texture2ddecoder.decode_bc7(
                daten[i * je_layer:(i + 1) * je_layer], breite, hoehe)
            # BGRA aus dem Decoder; Unitys Bildursprung liegt unten links.
            bild = Image.frombytes('RGBA', (breite, hoehe), px, 'raw', 'BGRA')
            bild = bild.transpose(Image.FLIP_TOP_BOTTOM)
            layer.append(bild)
            bild.save(os.path.join(ziel, f'{name}_layer{i:02d}.png'))

        atlas = Image.new('RGBA', (breite, hoehe * tiefe))
        for i, bild in enumerate(layer):
            atlas.paste(bild, (0, i * hoehe))
        atlas.save(os.path.join(ziel, f'{name}.png'))
        print(f'{name}: {breite}×{hoehe * tiefe} ({tiefe} Layer, {ARRAYS[obj.path_id]})')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'assets/textures'))
