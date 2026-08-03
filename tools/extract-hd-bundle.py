#!/usr/bin/env python3
"""
Extrahiert Texturen aus einem Unity-AssetBundle (z. B. Willybach's HD Textures)
nach PNG. Die Ordnerstruktur des Bundles (Assets/<Pack>/<Kategorie>/<Prefab>/)
bleibt erhalten, Dateinamen behalten das Saison-Suffix (@spring/@summer/@fall/@winter).

Aufruf:
    python3 tools/extract-hd-bundle.py <bundle> <ziel-ordner> [--jobs N]

Beispiel:
    python3 tools/extract-hd-bundle.py \
        screenshots/newtexture/willybachhd.bundle assets/textures-hd
"""

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import UnityPy


def strip_root(path: str) -> str:
    """Assets/WillybachHD/Grass/Meadows/x.png -> Grass/Meadows/x.png"""
    parts = path.split("/")
    if parts and parts[0].lower() == "assets":
        parts = parts[1:]
    if len(parts) > 1:
        parts = parts[1:]  # Pack-Name (WillybachHD) weglassen
    return "/".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle")
    ap.add_argument("outdir")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--force", action="store_true", help="vorhandene PNGs überschreiben")
    args = ap.parse_args()

    print(f"[1/3] Lade Bundle: {args.bundle}")
    env = UnityPy.load(args.bundle)

    # Pfad -> Objekt über den AssetBundle-Container auflösen
    targets = []
    for path, obj in env.container.items():
        if obj.type.name != "Texture2D":
            continue
        rel = strip_root(path)
        if not rel.lower().endswith(".png"):
            rel += ".png"
        targets.append((rel, obj))

    print(f"[2/3] {len(targets)} Texturen gefunden")
    if not targets:
        print("Keine Texturen im Container – Bundle leer oder anderes Format.", file=sys.stderr)
        return 1

    done = [0]
    failed = []

    def export(item):
        rel, obj = item
        dest = os.path.join(args.outdir, rel)
        if os.path.exists(dest) and not args.force:
            done[0] += 1
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            data = obj.read()
            img = data.image  # dekodiert BC7/DXT/… nach RGBA
            img.save(dest, optimize=False)
        except Exception as exc:  # einzelne Textur darf den Lauf nicht killen
            failed.append((rel, repr(exc)))
        done[0] += 1
        if done[0] % 25 == 0:
            print(f"      {done[0]}/{len(targets)} …", flush=True)

    print(f"[3/3] Exportiere nach {args.outdir} (jobs={args.jobs})")
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        list(pool.map(export, targets))

    print(f"Fertig: {len(targets) - len(failed)} PNG geschrieben, {len(failed)} Fehler")
    for rel, err in failed:
        print(f"  FEHLER {rel}: {err}", file=sys.stderr)
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
