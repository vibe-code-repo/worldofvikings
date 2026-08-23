#!/usr/bin/env blender --background --python
"""
Erzeugt die Holztruhe als GLB — Eichenbohlen mit Eisenbeschlag.

    blender --background --python tools/truhe-generieren.py -- \
        --name HolzTruhe --ziel assets/models

Die Textur kommt aus `tools/truhe-texturen.py` und MUSS vorher laufen.

── Warum von Hand gesetzte Kaesten statt eines Generators ───────────
Eine Truhe ist Hartflaeche: sechs rechtwinklige Teile, keine Streuung,
keine Zufallsvariation. Der Sapling-Weg der Baeume und die Verformung
der Felsen waeren hier falsches Werkzeug — beides erzeugt Unregel-
maessigkeit, und genau die will man an einem Tischlerstueck nicht. Was
zaehlt, sind saubere Kanten und ein Dreiecksbudget im dreistelligen
Bereich.

── Dreiecksbudget ───────────────────────────────────────────────────
Richtschnur ist der Hausstil der geskripteten Modelle: Findling und
Felsplatte tragen 80 Dreiecke bei 78 KB. Die Tripo-Truhe daneben braucht
2.774 Dreiecke und 3,4 MB fuer dasselbe Objekt. Diese hier landet bei
gut 300 — genug fuer Beschlaege, weit weg von der Tripo-Groessenordnung.

── UV: eine Textur, zwei Zonen ──────────────────────────────────────
`truhe_holz.png` traegt oben Holz, unten Eisen. Blender misst v von
UNTEN, PIL schreibt Zeile 0 oben — die Zonen liegen deshalb genau
andersherum als im Bild:

    Holz   Bildzeilen 0..191   ->  v 0.27 .. 0.98
    Eisen  Bildzeilen 192..255 ->  v 0.02 .. 0.23

Jedes Teil wird wuerfelprojiziert und sein v danach in die passende Zone
gestaucht. Fuer das Holz ist das eine milde senkrechte Stauchung (die
Bohlenbreite steckt in u und bleibt unberuehrt), fuer das Eisen faellt
sie nicht auf, weil dort nur Rauschen liegt.

── Masse ────────────────────────────────────────────────────────────
0,90 x 0,52 x 0,58 m (B x T x H, Deckel geschlossen). Angelehnt an den
Eintrag `piece_chest_wood` in `shared/src/prefabs.ts`, der mit
renderScale 1.0 x 0.8 gefuehrt wird — der Wert stammt aber vom
geloeschten Valheim-Modell. Der tatsaechliche Wert wird unten gemessen
und ausgegeben; er gehoert in den Prefab-Eintrag.

Der Pivot liegt auf dem BODEN (min z = 0), anders als bei den Felsen,
die absichtlich ein Stueck im Grund stecken. Eine Truhe steht auf dem
Boden, sie waechst nicht heraus.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'HolzTruhe')
ZIEL = arg('--ziel', 'assets/models')
TEXTUR = arg('--textur', 'assets/textures/truhe_holz.png')
ZIEL_PFAD = os.path.join(ZIEL, f'{NAME}.glb')

# Aussenmasse in Metern.
BREITE = 0.90
TIEFE = 0.52
KASTEN_H = 0.40
#: Wandstaerke von Boden und Seiten. 4 cm ist die Bohlenstaerke, die
#: zur Textur passt (sechs Bohlen auf 90 cm = 15 cm breit).
WAND = 0.04
DECKEL_H = 0.18
# Beschlaege stehen leicht vor, sonst verschwinden sie in der Holzflaeche.
BAND_DICK = 0.018
BAND_BREIT = 0.075
#: Hoehe des waagerechten Gurts unter der Deckelfuge.
GURT_H = 0.06
#: Sichtbarer Spalt zwischen Kasten und Deckel. Ohne ihn liest sich
#: das Ganze als ein Block mit aufgemalten Baendern.
FUGE_LUFT = 0.012
#: Oeffnungswinkel des Deckels in Grad. 102 statt 90, damit der Deckel
#: sichtbar nach HINTEN ueberkippt und offen bleibt — bei genau 90
#: steht er senkrecht und wirkt, als koennte er jeden Moment zufallen.
OEFFNUNGSWINKEL = 102.0
#: Bilder der Oeffnen-Bewegung bei 24 fps. 18 Bilder = 0,75 s: schnell
#: genug, dass niemand wartet, langsam genug, dass man es sieht.
ANIM_BILDER = 18

#: v-Bereiche der beiden Texturzonen, siehe Kopfkommentar.
ZONE_HOLZ = (0.27, 0.98)
ZONE_EISEN = (0.02, 0.23)


def leere_szene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(block):
            if d.users == 0:
                block.remove(d)


def bogen_profil(tiefe, hoehe, segmente=7):
    """Querschnitt des Deckels: halbe Ellipse von Kante zu Kante.

    Der erste Entwurf hatte einen Kasten mit nach innen gezogener
    Oberkante. Gerendert las sich das als Kiste mit Fase, nicht als
    Truhe — die gewoelbte Haube ist das Merkmal, an dem man eine Truhe
    ueberhaupt als Truhe erkennt.
    """
    punkte = []
    for i in range(segmente + 1):
        t = math.pi * i / segmente
        punkte.append((-math.cos(t) * tiefe / 2, math.sin(t) * hoehe))
    return punkte


def bogen_koerper(name, x_mitte, x_breite, profil, z_basis):
    """Profil entlang x strecken und schliessen."""
    x0, x1 = x_mitte - x_breite / 2, x_mitte + x_breite / 2
    ecken, flaechen = [], []
    n = len(profil)
    for x in (x0, x1):
        for y, z in profil:
            ecken.append((x, y, z_basis + z))
    for i in range(n - 1):
        flaechen.append((i, i + 1, n + i + 1, n + i))
    # Unterseite, damit der Koerper geschlossen ist.
    flaechen.append((n - 1, 0, n, 2 * n - 1))
    # Stirnseiten.
    flaechen.append(tuple(range(n - 1, -1, -1)))
    flaechen.append(tuple(range(n, 2 * n)))

    me = bpy.data.meshes.new(name)
    me.from_pydata(ecken, [], flaechen)
    me.validate()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def kasten(name, mitte, groesse):
    """Ein achsparalleler Quader. Gibt das Objekt zurueck."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=mitte)
    o = bpy.context.active_object
    o.name = name
    o.scale = groesse
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def uv_in_zone(obj, zone, kachel):
    """Wuerfelprojektion, danach v in die Texturzone stauchen."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=kachel)
    bpy.ops.object.mode_set(mode='OBJECT')

    unten, oben = zone
    spanne = oben - unten
    for d in obj.data.uv_layers.active.data:
        u, v = d.uv
        # v auf 0..1 falten, damit die Stauchung nicht ausserhalb der Zone
        # landet — cube_project liefert je nach Groesse auch Werte > 1.
        v = v - math.floor(v)
        d.uv = (u, unten + v * spanne)


def material():
    mat = bpy.data.materials.new('truhe_holz')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    # Holz und Eisen teilen sich ein Material — die Rauheit ist ein
    # Kompromiss. 0.75 laesst das Eisen matt genug wirken, ohne dass das
    # Holz speckig glaenzt.
    bsdf.inputs['Roughness'].default_value = 0.75
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular' in bsdf.inputs:
        bsdf.inputs['Specular'].default_value = 0.15
    elif 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.15
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.abspath(TEXTUR), check_existing=True)
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def main():
    leere_szene()

    # Vier Listen: Korpus und Deckel bleiben GETRENNTE Objekte, damit
    # der Deckel eine eigene Drehachse bekommen kann. Innerhalb einer
    # Gruppe wird nach Texturzone getrennt (Holz/Eisen).
    holz = []
    eisen = []
    deckel_holz = []
    deckel_eisen = []

    # ── Kasten ──────────────────────────────────────────────────────
    # ── Kasten: HOHL, aus Boden und vier Waenden ────────────────────
    # Der erste Entwurf war ein massiver Quader. Beim Oeffnen sah man
    # deshalb eine Holzplatte statt eines Innenraums — bei einer Truhe,
    # die man aufmacht, faellt genau das sofort auf. Fuenf Teile statt
    # einem kosten 48 Dreiecke mehr; das ist der Innenraum wert.
    holz.append(kasten('boden', (0, 0, WAND / 2), (BREITE, TIEFE, WAND)))
    wand_h = KASTEN_H - WAND
    wand_z = WAND + wand_h / 2
    for vz in (-1, 1):
        holz.append(kasten(
            f'wand_y{vz}',
            (0, vz * (TIEFE - WAND) / 2, wand_z),
            (BREITE, WAND, wand_h),
        ))
        holz.append(kasten(
            f'wand_x{vz}',
            (vz * (BREITE - WAND) / 2, 0, wand_z),
            (WAND, TIEFE - WAND * 2, wand_h),
        ))

    # ── Deckel: gewoelbte Haube mit Ueberstand ──────────────────────
    deckel = bogen_koerper(
        'deckel', 0.0, BREITE + 0.06,
        bogen_profil(TIEFE + 0.06, DECKEL_H),
        KASTEN_H + FUGE_LUFT,
    )
    deckel_holz.append(deckel)

    # ── Eisenbaender ────────────────────────────────────────────────
    # Drei senkrechte am Kasten, drei als Boegen ueber den Deckel — sie
    # muessen der Woelbung folgen, sonst stehen sie an den Flanken ab.
    for x in (-BREITE * 0.32, 0.0, BREITE * 0.32):
        eisen.append(kasten(
            f'band_v{x:.2f}',
            (x, 0, (KASTEN_H - GURT_H) / 2),
            (BAND_BREIT, TIEFE + BAND_DICK * 2, KASTEN_H - GURT_H),
        ))
        deckel_eisen.append(bogen_koerper(
            f'band_d{x:.2f}', x, BAND_BREIT * 0.9,
            bogen_profil(TIEFE + 0.06 + BAND_DICK * 2, DECKEL_H + BAND_DICK),
            KASTEN_H + FUGE_LUFT,
        ))

    # ── Gurt unter dem Deckel ───────────────────────────────────────
    # Sitzt UNTER der Fuge, nicht auf ihr: Die Fuge selbst muss als
    # dunkle Linie sichtbar bleiben, sonst verschmelzen Kasten und
    # Deckel optisch zu einem Block.
    # VIER Streifen rundherum, kein Quader: Der erste Entwurf war ein
    # massiver Kasten ueber die volle Grundflaeche und verschloss damit die
    # Oeffnung — beim aufgeklappten Deckel sah man eine Eisenplatte statt
    # des Innenraums. Faellt nur auf, wenn man die Animation rendert.
    gz = KASTEN_H - GURT_H / 2
    for vz in (-1, 1):
        eisen.append(kasten(
            f'gurt_y{vz}',
            (0, vz * (TIEFE / 2 + BAND_DICK / 2), gz),
            (BREITE + BAND_DICK * 2, BAND_DICK * 2, GURT_H),
        ))
        eisen.append(kasten(
            f'gurt_x{vz}',
            (vz * (BREITE / 2 + BAND_DICK / 2), 0, gz),
            (BAND_DICK * 2, TIEFE + BAND_DICK * 2, GURT_H),
        ))

    # ── Schloss ─────────────────────────────────────────────────────
    # Zweiteilig, wie an einer echten Truhe: Eine UEBERFALLE haengt vom
    # Deckel herab, darunter sitzt am Korpus der Schlosskasten mit
    # Schluesselloch. Der erste Entwurf hatte nur eine Platte, die
    # buendig hinter dem mittleren Band lag — im Rendering war sie nicht
    # zu finden, und Mike hat sie am 20.08.2026 zu Recht vermisst.
    #
    # Die Ueberfalle gehoert zum DECKEL und wandert beim Oeffnen mit;
    # der Kasten bleibt am Korpus. Genau daran liest man, dass die Truhe
    # offen ist, auch wenn man den Deckel selbst nicht sieht.
    y_vorn = -(TIEFE / 2)
    eisen.append(kasten(
        'schloss_kasten',
        (0, y_vorn - 0.035, KASTEN_H - 0.115),
        (0.20, 0.070, 0.17),
    ))
    # Schluesselloch: ein dunkler Zapfen, der aus dem Kasten heraussteht.
    eisen.append(kasten(
        'schloss_loch',
        (0, y_vorn - 0.072, KASTEN_H - 0.125),
        (0.045, 0.012, 0.075),
    ))
    deckel_eisen.append(kasten(
        'ueberfalle',
        (0, y_vorn - 0.035, KASTEN_H - 0.010),
        (0.10, 0.055, 0.13),
    ))
    for o in holz + deckel_holz:
        uv_in_zone(o, ZONE_HOLZ, kachel=0.55)
    for o in eisen + deckel_eisen:
        uv_in_zone(o, ZONE_EISEN, kachel=0.30)

    def lege_zusammen(teile, name):
        bpy.ops.object.select_all(action='DESELECT')
        for t in teile:
            t.select_set(True)
        bpy.context.view_layer.objects.active = teile[0]
        bpy.ops.object.join()
        o = bpy.context.active_object
        o.name = name
        return o

    korpus = lege_zusammen(holz + eisen, NAME)
    deckel_obj = lege_zusammen(deckel_holz + deckel_eisen, 'deckel')

    # ── Drehachse des Deckels ───────────────────────────────────────
    # Der Ursprung muss auf die HINTERE UNTERE Deckelkante — das ist das
    # Scharnier. Liegt er wie sonst in der Objektmitte, dreht sich der
    # Deckel um sich selbst und faehrt durch den Korpus.
    scharnier = (0.0, TIEFE / 2, KASTEN_H + FUGE_LUFT)
    bpy.context.scene.cursor.location = scharnier
    bpy.ops.object.select_all(action='DESELECT')
    deckel_obj.select_set(True)
    bpy.context.view_layer.objects.active = deckel_obj
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.context.scene.cursor.location = (0, 0, 0)

    # ── Oeffnen-Animation ───────────────────────────────────────────
    # Sie liegt IM GLB, nicht im Client. Der AssetManager laedt
    # Animationsgruppen ohnehin (animGruppen) und der Avatar spielt sie
    # bereits ab — eine handgeschriebene Drehung im Client waere ein
    # zweiter Weg fuer dieselbe Sache.
    import math as _m
    szene = bpy.context.scene
    szene.frame_start = 1
    szene.frame_end = ANIM_BILDER
    deckel_obj.rotation_mode = 'XYZ'
    deckel_obj.rotation_euler = (0.0, 0.0, 0.0)
    deckel_obj.keyframe_insert('rotation_euler', frame=1)
    # NEGATIV: Das Scharnier liegt hinten (+y). Eine positive Drehung um x
    # zieht die Vorderkante nach UNTEN in den Korpus — im ersten Rendern
    # sah es aus, als versinke der Deckel in der Truhe. Negativ hebt sie
    # nach oben und hinten, wie ein Deckel es tut.
    deckel_obj.rotation_euler = (_m.radians(-OEFFNUNGSWINKEL), 0.0, 0.0)
    deckel_obj.keyframe_insert('rotation_euler', frame=ANIM_BILDER)
    if deckel_obj.animation_data and deckel_obj.animation_data.action:
        deckel_obj.animation_data.action.name = 'oeffnen'
    deckel_obj.rotation_euler = (0.0, 0.0, 0.0)

    # Deckel an den Korpus haengen, damit der Client EINE Wurzel bekommt.
    deckel_obj.parent = korpus
    deckel_obj.matrix_parent_inverse = korpus.matrix_world.inverted()

    obj = korpus
    mat = material()
    for o in (korpus, deckel_obj):
        o.data.materials.clear()
        o.data.materials.append(mat)

    # Hartflaeche: flach schattieren. Eine weich schattierte Truhe sieht
    # aus wie aus Ton geformt.
    for o in (korpus, deckel_obj):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_flat()

    # Doppelte Eckpunkte an den Beruehrungsflaechen entfernen, aber nur
    # sehr nah — sonst zieht es Beschlaege in die Holzflaeche hinein.
    for o in (korpus, deckel_obj):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.0005)
        bpy.ops.object.mode_set(mode='OBJECT')

    # ── Pivot auf den Boden ─────────────────────────────────────────
    # Der Korpus steht schon auf z=0 (die Kaesten wurden so gesetzt);
    # ein transform_apply hier wuerde die frisch gesetzte Deckelachse
    # wieder verschieben. Deshalb nur pruefen statt verschieben.
    ecken = [korpus.matrix_world @ Vector(e) for e in korpus.bound_box]
    if abs(min(p.z for p in ecken)) > 1e-4:
        print(f'WARNUNG Korpus steht nicht auf z=0: {min(p.z for p in ecken):.4f}')

    os.makedirs(os.path.dirname(ZIEL_PFAD) or '.', exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    korpus.select_set(True)
    deckel_obj.select_set(True)
    bpy.context.view_layer.objects.active = korpus
    bpy.ops.export_scene.gltf(
        filepath=ZIEL_PFAD,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_animations=True,
        export_frame_range=True,
    )

    ecken = [o.matrix_world @ Vector(e) for o in (korpus, deckel_obj) for e in o.bound_box]
    breite = max(
        max(p.x for p in ecken) - min(p.x for p in ecken),
        max(p.y for p in ecken) - min(p.y for p in ecken),
    )
    hoehe = max(p.z for p in ecken) - min(p.z for p in ecken)
    dreiecke = sum(len(p.vertices) - 2 for o in (korpus, deckel_obj) for p in o.data.polygons)
    kb = os.path.getsize(ZIEL_PFAD) / 1024
    print(f'FERTIG {ZIEL_PFAD} — {dreiecke} Dreiecke, {kb:.0f} KB, '
          f'renderScale {breite:.2f} x {hoehe:.2f} m, Animation "oeffnen" ({ANIM_BILDER} Bilder, {OEFFNUNGSWINKEL:.0f} Grad)')


main()
