#!/usr/bin/env python3
"""
Rechnet die eingebetteten Texturen einer GLB auf eine tragbare Größe herunter.

    python3 tools/glb-textur-verkleinern.py assets/models/Voelva.glb [--max 1024]
    python3 tools/glb-textur-verkleinern.py assets/models/*.glb --max 1024

── Warum das nötig ist ──────────────────────────────────────────────
Tripo liefert grundsätzlich 4096²-Texturen, und zwar drei Stück je Modell
(BaseColor, ORM, Normal). Das sind 3 × 4096² × 4 Byte = **201 MB**
Videospeicher für EIN Objekt, mit Mipmaps rund 268 MB.

Die Folge ist kein langsames Bild, sondern gar keines: Gemessen an der
Völva meldete das PBRMaterial dauerhaft `isReady() == false`, womit
Babylon das Mesh im Zeichendurchlauf überspringt. Sichtbar blieb allein
ihr Schatten — der läuft über einen Tiefen-Shader, der keine Texturen
braucht. Gemeldet wurde das als "es gibt keine Texturen"; tatsächlich
wurde die Figur überhaupt nicht gezeichnet.

1024² reicht für eine mannshohe Figur mehr als aus und kostet ein
Sechzehntel. Die Geometrie bleibt unangetastet.

── Warum der BIN-Chunk komplett neu gebaut wird ─────────────────────
Verkleinerte Bilder sind kürzer, damit verschieben sich die Offsets ALLER
folgenden bufferViews. Sie einzeln nachzurechnen ist fehleranfällig;
stattdessen werden alle Views frisch hintereinandergelegt.
"""

import argparse
import io
import json
import os
import struct
import sys

from PIL import Image

# Die Signatur steht als ASCII in der Datei — sie als Zahl zu lesen lädt nur
# zur Endian-Verwechslung ein (little liest 0x46546C67, big 0x676C5446).
MAGIC = b'glTF'


def lade(pfad):
    roh = open(pfad, 'rb').read()
    if roh[0:4] != MAGIC:
        raise SystemExit(f'{pfad}: keine GLB-Datei')
    json_len = struct.unpack('<I', roh[12:16])[0]
    doc = json.loads(roh[20:20 + json_len])
    # Zweiter Chunk: 4 Byte Länge, 4 Byte Typ, dann die Daten
    bin_start = 20 + json_len
    bin_len = struct.unpack('<I', roh[bin_start:bin_start + 4])[0]
    binaer = roh[bin_start + 8:bin_start + 8 + bin_len]
    return doc, binaer


def schreibe(pfad, doc, binaer):
    js = json.dumps(doc, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)          # Spec 4.4.2: mit Leerzeichen
    binaer += b'\0' * ((4 - len(binaer) % 4) % 4)  # BIN mit Nullen
    gesamt = 12 + 8 + len(js) + 8 + len(binaer)
    with open(pfad, 'wb') as f:
        f.write(MAGIC + struct.pack('<II', 2, gesamt))
        f.write(struct.pack('<I', len(js)) + b'JSON' + js)
        f.write(struct.pack('<I', len(binaer)) + b'BIN\0' + binaer)


def verkleinere(pfad, maxkante):
    doc, binaer = lade(pfad)
    views = doc.get('bufferViews', [])
    # Alle View-Daten herausziehen, damit sie gleich neu abgelegt werden können
    daten = [binaer[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    geaendert = []
    for bild in doc.get('images', []):
        vi = bild.get('bufferView')
        if vi is None:
            continue
        im = Image.open(io.BytesIO(daten[vi]))
        if max(im.size) <= maxkante:
            continue
        alt = im.size
        neu = maxkante if im.width >= im.height else round(maxkante * im.width / im.height)
        neu_h = maxkante if im.height > im.width else round(maxkante * im.height / im.width)
        im = im.resize((max(1, neu), max(1, neu_h)), Image.LANCZOS)
        puffer = io.BytesIO()
        # PNG bleibt PNG (Normal- und ORM-Karten vertragen kein JPEG-Rauschen)
        im.save(puffer, format='PNG', optimize=True)
        vorher, nachher = len(daten[vi]), puffer.tell()
        daten[vi] = puffer.getvalue()
        geaendert.append((bild.get('name', f'#{vi}'), alt, im.size, vorher, nachher))

    if not geaendert:
        print(f'  {os.path.basename(pfad)}: nichts zu tun (alle ≤ {maxkante})')
        return False

    # BIN-Chunk frisch aufbauen, Offsets neu vergeben (4-Byte-Ausrichtung)
    neu_bin = bytearray()
    for i, v in enumerate(views):
        while len(neu_bin) % 4:
            neu_bin.append(0)
        v['byteOffset'] = len(neu_bin)
        v['byteLength'] = len(daten[i])
        neu_bin += daten[i]
    doc['buffers'][0]['byteLength'] = len(neu_bin)

    vorher_gesamt = os.path.getsize(pfad)
    schreibe(pfad, doc, bytes(neu_bin))
    nachher_gesamt = os.path.getsize(pfad)
    print(f'  {os.path.basename(pfad)}: {vorher_gesamt/1e6:.2f} → {nachher_gesamt/1e6:.2f} MB')
    for name, alt, neu, vb, nb in geaendert:
        print(f'      {name[:34]:36} {alt[0]}² → {neu[0]}²  ({vb/1e6:.2f} → {nb/1e6:.2f} MB)')
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glb', nargs='+')
    ap.add_argument('--max', type=int, default=1024, help='längste Kante in Pixeln')
    args = ap.parse_args()
    n = 0
    for pfad in args.glb:
        if verkleinere(pfad, args.max):
            n += 1
    print(f'\n{n} von {len(args.glb)} Dateien geändert.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
