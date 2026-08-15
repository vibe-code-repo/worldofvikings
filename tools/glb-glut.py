#!/usr/bin/env python3
"""
Leitet aus der BaseColor eines Modells eine Emissive-Karte ab und bettet
sie ein — damit Lava, Glut und Feuer im Spiel wirklich leuchten.

    python3 tools/glb-glut.py assets/models/Surtr.glb [--staerke 1.6]

── Warum das nötig ist ──────────────────────────────────────────────
Tripo liefert BaseColor, ORM und Normal, aber KEINE Emissive-Karte. Die
Lavaadern des Feuerriesen sind damit bloß orange gemalt: Bei Tag sehen
sie passabel aus, nachts ist Surtr ein schwarzer Klotz. Emissiv heißt
dagegen, dass die Adern eigenes Licht abgeben — unabhängig von der
Beleuchtung.

── Wie die Glut erkannt wird ────────────────────────────────────────
Nicht über eine Farbliste, sondern über drei Bedingungen zugleich:
kräftiges Rot, deutlicher Rot-Blau-Abstand und hohe Sättigung. An Surtr
gemessen trennt das sauber (14,1 % der Fläche):

    Glut  RGB(175, 87, 34)
    Stein RGB( 56, 40, 34)

Der Übergang ist bewusst WEICH (ein Faktor statt einer Maske) — eine
harte Schwelle zeichnet sichtbare Ränder um jede Ader, und genau an
diesen Kanten schaut man bei glühendem Material zuerst hin.
"""

import argparse
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

MAGIC = b'glTF'


def lade(pfad):
    roh = open(pfad, 'rb').read()
    if roh[0:4] != MAGIC:
        raise SystemExit(f'{pfad}: keine GLB-Datei')
    jl = struct.unpack('<I', roh[12:16])[0]
    doc = json.loads(roh[20:20 + jl])
    bstart = 20 + jl
    bl = struct.unpack('<I', roh[bstart:bstart + 4])[0]
    return doc, roh[bstart + 8:bstart + 8 + bl]


def schreibe(pfad, doc, binaer):
    js = json.dumps(doc, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    binaer += b'\0' * ((4 - len(binaer) % 4) % 4)
    gesamt = 12 + 8 + len(js) + 8 + len(binaer)
    with open(pfad, 'wb') as f:
        f.write(MAGIC + struct.pack('<II', 2, gesamt))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(binaer)) + b'BIN\0' + binaer)


def glutkarte(im, staerke):
    """BaseColor → Emissive. Glühende Stellen behalten ihre Farbe, alles
    andere wird schwarz."""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)

    # Drei weiche Faktoren, multipliziert — jeder für sich lässt zu viel
    # durch: Helligkeit allein nimmt hellen Stein mit, der Rot-Blau-Abstand
    # allein auch braunes Gestein, Sättigung allein jede kräftige Farbe.
    f_hell = np.clip((r - 105.0) / 70.0, 0.0, 1.0)
    f_warm = np.clip((r - b * 1.35) / 60.0, 0.0, 1.0)
    f_satt = np.clip((sat - 0.30) / 0.25, 0.0, 1.0)
    faktor = f_hell * f_warm * f_satt

    glut = a * (faktor * staerke)[:, :, None]
    return Image.fromarray(np.clip(glut, 0, 255).astype(np.uint8), 'RGB'), float(faktor.mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb')
    ap.add_argument('--staerke', type=float, default=1.6,
                    help='Verstärkung der Glutfarbe (1.0 = wie in der BaseColor)')
    args = ap.parse_args()

    doc, binaer = lade(args.glb)
    views = doc.get('bufferViews', [])
    daten = [binaer[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    mat = doc['materials'][0]
    basis = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if basis is None:
        raise SystemExit('Material hat keine BaseColor-Textur')
    if 'emissiveTexture' in mat:
        print('Material hat bereits eine Emissive-Karte — wird ersetzt.')

    bild_idx = doc['textures'][basis['index']]['source']
    quelle = Image.open(io.BytesIO(daten[doc['images'][bild_idx]['bufferView']]))
    karte, anteil = glutkarte(quelle, args.staerke)

    puffer = io.BytesIO()
    karte.save(puffer, format='PNG', optimize=True)

    # Neuen BufferView, Image und Texture-Eintrag anhängen
    daten.append(puffer.getvalue())
    views.append({'buffer': 0, 'byteOffset': 0, 'byteLength': len(daten[-1])})
    doc.setdefault('images', []).append({
        'name': 'Emissive_glut', 'mimeType': 'image/png', 'bufferView': len(views) - 1,
    })
    doc.setdefault('textures', []).append({
        'source': len(doc['images']) - 1,
        **({'sampler': doc['textures'][basis['index']]['sampler']}
           if 'sampler' in doc['textures'][basis['index']] else {}),
    })
    mat['emissiveTexture'] = {'index': len(doc['textures']) - 1}
    mat['emissiveFactor'] = [1.0, 1.0, 1.0]

    # BIN neu aufbauen (die Offsets verschieben sich durch den Anhang)
    neu = bytearray()
    for i, v in enumerate(views):
        while len(neu) % 4:
            neu.append(0)
        v['byteOffset'] = len(neu)
        v['byteLength'] = len(daten[i])
        neu += daten[i]
    doc['buffers'][0]['byteLength'] = len(neu)

    vorher = os.path.getsize(args.glb)
    schreibe(args.glb, doc, bytes(neu))
    print(f'{os.path.basename(args.glb)}: Emissive-Karte eingebettet '
          f'({karte.size[0]}², Glutanteil {100 * anteil:.1f} %, Stärke {args.staerke})')
    print(f'  {vorher/1e6:.2f} → {os.path.getsize(args.glb)/1e6:.2f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
