#!/usr/bin/env blender --background --python
"""
Rendert ein GLB als Gegenstandssymbol — 64x64, durchsichtiger Grund.

    flatpak run org.blender.Blender --background --python symbol-rendern.py -- \
        --glb R_LederBH.glb --out leder_bh.png [--kante 512] [--samples 48]

── Warum Cycles und nicht EEVEE ─────────────────────────────────────
Dieselbe Begruendung wie in tools/glb-vorschau.py: EEVEE braucht einen
GL-Kontext, den ein Hintergrundlauf nicht zuverlaessig bekommt. Cycles
rechnet auf der CPU.

── Warum gross rendern und danach verkleinern ───────────────────────
Ein 64-px-Bild hat fuer einen Lederriemen zwei bis drei Bildpunkte
Breite. Direkt in dieser Groesse gerendert entscheidet der Zufall der
Abtastung, ob der Riemen sichtbar ist. Gerendert wird auf `--kante`
(512) und danach in Blender selbst heruntergerechnet — das mittelt ueber
64 Bildpunkte je Ziel-Pixel und laesst duenne Teile stehen.

── Warum die Kamera das Objekt umfaehrt statt fest zu stehen ────────
Die Teile haben sehr verschiedene Proportionen (ein BH ist breit und
flach, eine Hose hoch). Eine feste Kameraentfernung liesse das eine
Symbol winzig und schnitte das andere an. Gerahmt wird deshalb ueber die
umfassende Kugel des Objekts.
"""

import sys
import math

import bpy
from mathutils import Vector


def argumente():
    roh = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    werte = {"--kante": "512", "--samples": "48"}
    i = 0
    while i < len(roh) - 1:
        werte[roh[i]] = roh[i + 1]
        i += 2
    return werte


def leere_szene():
    """
    Alles weg — und zwar WIRKLICH alles.

    `read_factory_settings(use_empty=True)` allein genuegt nicht: In
    diesem Blender laedt ein Addon (tripo) beim Start eine Icosphere in
    die Szene. Sie spannt die umfassende Kugel auf Radius 1,7 auf,
    waehrend der BH nur 0,15 misst — das Symbol zeigte daraufhin einen
    Punkt in einem leeren Bild. Der Fehler steckte NICHT im Modell; die
    Datei enthaelt genau ein Mesh.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def umfassung(objekte):
    """Mittelpunkt und Radius ueber alle Eckpunkte der Weltkisten."""
    punkte = []
    for o in objekte:
        if o.type != "MESH":
            continue
        for ecke in o.bound_box:
            punkte.append(o.matrix_world @ Vector(ecke))
    if not punkte:
        return Vector((0, 0, 0)), 1.0
    mn = Vector((min(p[i] for p in punkte) for i in range(3)))
    mx = Vector((max(p[i] for p in punkte) for i in range(3)))
    mitte = (mn + mx) / 2
    radius = max((mx - mn).length / 2, 1e-4)
    return mitte, radius


def main():
    a = argumente()
    glb, ziel = a["--glb"], a["--out"]
    kante, samples = int(a["--kante"]), int(a["--samples"])

    leere_szene()
    bpy.ops.import_scene.gltf(filepath=glb)

    # NUR das Objekt rendern, das auch in der Datei steht.
    #
    # Ein Addon dieser Blender-Installation (tripo) haengt sich in den
    # glTF-Import und legt dabei eine Icosphere von 2 m Durchmesser in die
    # Szene. Nachgewiesen: Vor dem Import ist die Szene leer, danach
    # stehen drei Objekte darin — waehrend die Datei selbst genau EIN Mesh
    # enthaelt (nachgezaehlt im glTF-JSON). Ungefiltert spannte sie die
    # umfassende Kugel auf Radius 1,70 statt 0,15 auf, und das Symbol
    # zeigte einen Punkt in einem leeren Bild.
    #
    # Gefiltert wird ueber den DATEINAMEN, nicht ueber "was ist neu": Der
    # Stoerenfried entsteht waehrend des Imports und waere in jeder
    # Vorher-Nachher-Liste ebenfalls neu.
    import os
    stamm = os.path.splitext(os.path.basename(glb))[0]
    fremd = [o for o in bpy.context.scene.objects
             if o.type == "MESH" and not o.name.startswith(stamm)]
    for o in fremd:
        print("SYMBOL_ENTFERNT", o.name)
        bpy.data.objects.remove(o, do_unlink=True)

    objekte = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objekte:
        print("SYMBOL_FEHLER keine Geometrie in", glb)
        sys.exit(1)

    mitte, radius = umfassung(objekte)

    # Dreiviertelansicht, leicht von oben — wie die vorhandenen Symbole.
    kam_data = bpy.data.cameras.new("kam")
    kam_data.type = "ORTHO"
    # Orthografisch statt perspektivisch: Ein Symbol soll die FORM zeigen,
    # nicht die Fluchtlinien einer nahen Kamera.
    kam_data.ortho_scale = radius * 2.25
    kam = bpy.data.objects.new("kam", kam_data)
    bpy.context.scene.collection.objects.link(kam)

    richtung = Vector((0.55, -1.0, 0.45)).normalized()
    kam.location = mitte + richtung * (radius * 4)
    kam.rotation_mode = "QUATERNION"
    kam.rotation_quaternion = (-richtung).to_track_quat("-Z", "Y")
    bpy.context.scene.camera = kam

    # Licht: eine Sonne aus der Kamerarichtung plus heller Weltgrund,
    # damit die Rueckseite nicht absaeuft. Kein Studioaufbau — die
    # Vorlagen sind ebenso schlicht ausgeleuchtet.
    sonne_data = bpy.data.lights.new("sonne", type="SUN")
    sonne_data.energy = 3.0
    sonne = bpy.data.objects.new("sonne", sonne_data)
    sonne.rotation_mode = "QUATERNION"
    sonne.rotation_quaternion = (-Vector((0.4, -1.0, 0.8)).normalized()).to_track_quat("-Z", "Y")
    bpy.context.scene.collection.objects.link(sonne)

    welt = bpy.data.worlds.new("welt")
    welt.use_nodes = True
    welt.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    bpy.context.scene.world = welt

    szene = bpy.context.scene
    szene.render.engine = "CYCLES"
    szene.cycles.samples = samples
    szene.cycles.use_denoising = True
    szene.render.resolution_x = kante
    szene.render.resolution_y = kante
    szene.render.film_transparent = True   # durchsichtiger Grund wie die Vorlagen
    szene.render.image_settings.file_format = "PNG"
    szene.render.image_settings.color_mode = "RGBA"
    szene.render.filepath = ziel
    bpy.ops.render.render(write_still=True)

    # Auf Symbolgroesse bringen — in Blender selbst, damit kein weiteres
    # Werkzeug noetig ist.
    bild = bpy.data.images.load(ziel)
    bild.scale(64, 64)
    bild.file_format = "PNG"
    bild.save(filepath=ziel)
    print(f"SYMBOL_FERTIG {ziel} (aus {kante}px, {samples} Samples)")


main()
