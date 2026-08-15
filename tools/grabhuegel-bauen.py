#!/usr/bin/env blender --background --python
"""
Baut einen wikingerzeitlichen Grabhuegel als GLB — aussen Erdhuegel mit
Steinkranz, innen eine Grabkammer mit Schiff.

    blender --background --python tools/grabhuegel-bauen.py -- \
        --name Grabhuegel [--seed 5] [--ziel assets/models]

── Warum die Kammer auf y=0 liegt ───────────────────────────────────
Der Huegel soll als Startpunkt dienen, und zwar INNEN. Der Weltspawn
loest seine Hoehe ueber das Gelaende auf (`WovServer.weltSpawn`,
server/src/WovServer.ts:499-510) — der Spieler landet also immer auf
Gelaendehoehe. Und Positionen im Dungeon-Band werden beim Login
verworfen (WovServer.ts:778-798), ein Dungeon-Innenraum kann deshalb
gar kein Login-Spawn sein.

Beides zusammen ergibt die Bauweise: Der Kammerboden liegt knapp ueber
Gelaendehoehe (BODEN_Y = 1 m, gegen durchwoelbendes Terrain), und der
Huegel ist DARUEBER aufgeschuettet. Wer auf den Mittelpunkt spawnt,
landet damit in der Kammer — der Server setzt den Spawn 1,5 m ueber
Gelaende ab (weltSpawn), sodass man auf den Steinboden FAELLT statt in
ihm zu stecken. Kein Sonderweg noetig, nur Geometrie.

── Warum der Huegel eine Schale ist ─────────────────────────────────
Der Erdhuegel ist eine offene Kuppel ohne Boden, aus der nur die
Tuer ausgeschnitten wird. Kammer und Gang sind SEPARATE Koerper mit
nach INNEN gedrehten Normalen. Haette man stattdessen den Hohlraum aus
einem Vollkoerper gebohrt, trueg die Kammerwand die Erdtextur, und man
muesste die Flaechen hinterher nach Lage sortieren, um Stein
zuzuweisen — fehleranfaellig und schlecht zu aendern.

Die Rueckseiten werden weggeschnitten (`doubleSided: false` wie beim
Steinkreis), deshalb sieht man von aussen nur die Kuppel und von innen
nur den Stein.

── Kollision ────────────────────────────────────────────────────────
Das Modell braucht EXAKTE Mesh-Kollision, sonst steht eine Box im
Durchgang. Dafuer muss `Grabhuegel` in `BEGEHBAR` in
client/src/entities/EntityManager.ts:51-64 aufgenommen werden — genau
wie der Steinkreis, aus genau demselben Grund.
"""
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector

# ── Argumente hinter "--" ────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


NAME = arg('--name', 'Grabhuegel')
SEED = int(arg('--seed', '5'))
ZIEL = arg('--ziel', 'assets/models')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Masse ────────────────────────────────────────────────────────────
# Ein Schiffsgrab ist gross: Oseberg misst rund 40 m im Durchmesser. Das
# waere im Spiel unbegehbar weit, deshalb auf Spielmass gebracht — aber
# gross genug, dass ein 14-m-Schiff INNEN Platz hat und man um es
# herumgehen kann.
HUEGEL_RX, HUEGEL_RZ = 19.0, 14.0      # Grundriss der Kuppel
# Oseberg ist 40 m breit bei 6,5 m Hoehe — real also sehr flach. Im Spiel
# liest sich das als Bodenwelle statt als Grabhuegel, deshalb hier
# deutlich steiler (3:1 statt 6:1). Es muss ohnehin die Kammer plus eine
# tragende Erddecke darueber fassen.
HUEGEL_H = 12.0

# Lichte Weite innen. Der erste Wurf (17 × 8,4 × 4,4) war als Grabkammer
# zu eng — mit Schiff, Mast und Beigaben blieb kaum Umgang. Jetzt passt
# ein 14-m-Schiff hinein, und man kann rundherum gehen.
KAMMER_L, KAMMER_B, KAMMER_H = 26.0, 14.0, 6.5
GANG_B, GANG_H = 3.2, 3.6                       # Zugang von -x
# Der Gang laeuft vom Huegelfuss bis in die Kammerwand. Berechnet statt
# gesetzt, damit er beim Aendern der Masse nicht heraussteht oder in der
# Erde endet.
GANG_X_AUSSEN = -(HUEGEL_RX + 1.0)
GANG_X_INNEN = -KAMMER_L / 2 + 0.4
GANG_L = GANG_X_INNEN - GANG_X_AUSSEN

SCHIFF_L, SCHIFF_B, SCHIFF_H = 14.0, 3.4, 1.55  # Rumpf ohne Steven

# Der Steinboden liegt einen METER ueber dem Gelaende. Die erste Fassung
# lag bei 8 cm — im Spiel woelbte sich die Wiese mitten in der Kammer
# durch den Steinboden, denn das Terrain unter einem 26-m-Raum ist nie
# eben. Ein Meter deckt normale Bodenwellen ab; hinein kommt man trotzdem
# stufenlos, weil der Gang als RAMPE auf Kammerhoehe steigt.
BODEN_Y = 1.0
# Der Rampenfuss liegt UNTER dem Gelaende, nicht darueber. Die zweite
# Fassung begann bei +0,12 m — gedacht als "stufenlos", tatsaechlich
# stand damit eine 12-cm-Steilkante am Eingang: Der Havok-
# CharacterController kennt keine Tritthoehe, und an einer 12-cm-Stufe
# trifft die Kapselrundung (Radius 0,4 m, PlayerController.BODY_RADIUS)
# den Kantenrand unter ~46 Grad — steiler als die 40-Grad-Grenze
# (maxSlopeCosine), also gilt die Kante als unbegehbar und man bleibt
# stehen. Die Heightmap-Klemme hilft dort auch nicht: Sie hebt nur bis
# auf GELAENDEhoehe, und das planierte Gelaende liegt bei y=0.
# Gemeldet: "wenn ich in den Eingang laufen will, bleibe ich an einer
# Kante haengen." (2026-08-06)
#
# Mit -0,35 m taucht der Rampenfuss sicher unter die planierte Platte;
# die begehbare Flaeche schneidet das Gelaende bei x ≈ -18,2 auf
# Nullhoehe. Es gibt damit KEINE Kante mehr, nur noch die Steigung der
# Rampe selbst (1,35 m auf 7 m bis zur Kammerwand ≈ 11 Grad, weit
# unter der Grenze).
# Der Rampenfuss liegt EXAKT auf Plateauhoehe. Beide frueheren Werte waren
# Extreme: +0,12 ergab eine senkrechte Stufe, an der man haengenblieb (der
# Havok-Charakter hat keine Tritthoehe), -0,35 legte den Fuss unter das
# Gelaende — seit die Platzierung planiert, standen dadurch 5,8 m² Terrain
# bis 35 cm hoch IM Tuerrahmen und flimmerten gegen die Bodenplatte.
#
# Null loest beides: keine senkrechte Flaeche, also keine Stufe, und die
# Rampe liegt ueberall auf oder ueber dem Boden, also keine Erde im
# Eingang. Deckungsgleich ist nur die Fusslinie selbst — die Rampe steigt
# mit 7,7 Grad sofort weg, nach 8 cm Weg ist sie schon 1 cm frei.
GANG_BODEN_AUSSEN = 0.0

MAT_SODE = 'sode'
MAT_STEIN = 'stein'
MAT_HOLZ = 'holz'
MAT_SCHILD = 'schild'
MAT_SEGEL = 'segel'
MAT_RUNEN = 'stein_runen'

TEXTUREN = {
    MAT_SODE: 'assets/textures/grab_sode.png',
    MAT_STEIN: 'assets/textures/grab_stein.png',
    MAT_HOLZ: 'assets/textures/grab_holz.png',
    # Bemalte Rundschilde (2×2-Atlas), Wollsegel und Runenrelief — die
    # "Farbe" des Grabs. Alle drei aus tools/grabhuegel-texturen.py.
    MAT_SCHILD: 'assets/textures/grab_schild.png',
    MAT_SEGEL: 'assets/textures/grab_segel.png',
    MAT_RUNEN: 'assets/textures/grab_stein_runen.png',
}

rnd = random.Random(SEED)


# ── Werkzeuge ────────────────────────────────────────────────────────

def leere_szene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(schluessel):
    """Principled auf die Kacheltextur.

    Rauheit und Metallgrad sind an der ORM-Karte der WIKINGERSTATUE
    gemessen (0,94 / 0,02) — dieselbe Quelle wie die Steinfarben in
    `tools/grabhuegel-texturen.py`, damit der Huegel neben ihr nicht
    aus dem Rahmen faellt.
    """
    vorhanden = bpy.data.materials.get(schluessel)
    if vorhanden is not None:
        return vorhanden
    mat = bpy.data.materials.new(schluessel)
    mat.use_nodes = True
    # Rueckseiten wegschneiden. Fuer die GLB ist das genau genommen
    # ueberfluessig: Blender 4.0 schreibt `doubleSided` gar nicht erst in
    # die Datei, und laut glTF-Spezifikation ist der Vorgabewert FALSE —
    # einseitig ist also ohnehin der Normalfall, genau wie beim Steinkreis
    # (der es nur explizit ausschreibt). Gesetzt wird es trotzdem, damit
    # das Modell im Blender-Viewport dasselbe zeigt wie im Spiel; sonst
    # steht die nach innen gedrehte Kammer beim Betrachten scheinbar als
    # Steinkasten vor dem Huegel.
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.94
    bsdf.inputs['Metallic'].default_value = 0.02
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(ROOT, TEXTUREN[schluessel]),
                                     check_existing=True)
    tex.extension = 'REPEAT'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def aus_bmesh(bm, name, mat_schluessel, kachel=2.0, nach_innen=False, glatt=False,
              projizieren=True):
    """Macht aus einem BMesh ein Objekt mit Material und kachelnden UVs.

    `kachel` ist die Kantenlaenge in METERN, auf die eine Texturkachel
    faellt — Wuerfelprojektion statt Smart-UV, weil Smart-UV auf 0..1
    normiert und die Textur dann ueber eine 15-m-Kuppel EINMAL laeuft.

    `glatt` interpoliert die Normalen ueber die Flaechengrenzen. Fuer
    Huegel und Findlinge ist das der halbe Unterschied zwischen "kantig"
    und "abgenutzt": Dieselbe Geometrie liest sich flach schattiert als
    Kristall, glatt schattiert als vom Wetter rundgeschliffen.
    """
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material(mat_schluessel))

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # Umlaufrichtung nicht raten, sondern ausrechnen lassen. Bei den
    # Findlingen haengt sie von Winkel und Vorzeichen ab; eine falsch
    # gewickelte Flaeche waere im Spiel unsichtbar (Rueckseiten werden
    # weggeschnitten) und faellt in der Vorschau nicht auf, weil Cycles
    # beidseitig rendert.
    bpy.ops.mesh.normals_make_consistent(inside=False)
    if nach_innen:
        # Innenraeume: Normalen umdrehen, damit man die Waende von INNEN
        # sieht. Ohne das schneidet das Backface-Culling sie weg und man
        # blickt aus der Kammer in die Landschaft.
        bpy.ops.mesh.flip_normals()
    if projizieren:
        bpy.ops.uv.cube_project(cube_size=kachel)
    bpy.ops.object.mode_set(mode='OBJECT')
    if glatt:
        bpy.ops.object.shade_smooth()
    return obj


# Flaechen eines Quaders ueber die Eckindizes. Die Ecken entstehen unten in
# der Reihenfolge (dx, dy, dz) als Binaerzaehler, daher index = 4dx+2dy+dz.
QUADER_FLAECHEN = {
    '-x': (0, 1, 3, 2), '+x': (4, 6, 7, 5),
    '-y': (0, 4, 5, 1), '+y': (2, 3, 7, 6),
    '-z': (0, 2, 6, 4), '+z': (1, 5, 7, 3),
}


def quader(bm, mitte, groesse, offen=(), drehung=0.0):
    """Quader, wahlweise mit OFFENEN Seiten.

    Die offenen Seiten sind der Grund, warum es diesen Parameter gibt: Ein
    rundum geschlossener Kasten als Gang hat Stirnwaende an beiden Enden.
    Genau daran ist der erste Bau gescheitert — der Huegel sah begehbar
    aus, aber vor dem Eingang stand eine Wand, und in der Kammerwand
    dahinter noch eine zweite.
    """
    cx, cy, cz = mitte
    sx, sy, sz = (g / 2.0 for g in groesse)
    c, s = math.cos(drehung), math.sin(drehung)
    verts = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                x, y, z = dx * sx, dy * sy, dz * sz
                verts.append(bm.verts.new((cx + x * c - z * s, cy + y, cz + x * s + z * c)))
    bm.verts.ensure_lookup_table()
    for seite, idx in QUADER_FLAECHEN.items():
        if seite in offen:
            continue
        bm.faces.new([verts[i] for i in idx])
    return verts


def rechteck_x(bm, x, y0, y1, z0, z1):
    """Eine senkrechte Flaeche bei festem x.

    Die Umlaufrichtung entspricht der '-x'-Seite von `quader`, damit das
    spaetere Umdrehen der Normalen (nach_innen) beide gleich behandelt.
    """
    a = bm.verts.new((x, y0, z0))
    b = bm.verts.new((x, y0, z1))
    c = bm.verts.new((x, y1, z1))
    d = bm.verts.new((x, y1, z0))
    bm.faces.new([a, b, c, d])


def wand_mit_oeffnung(bm, x, hoehe, breite, tuer_b, tuer_h, y0=0.0):
    """Wand bei festem x mit einer Tueroeffnung in der Mitte.

    Drei Stuecke: links und rechts der Tuer ueber die volle Hoehe, darueber
    der Sturz. Unterhalb der Tuer bleibt nichts, sie steht auf dem Boden.
    """
    halb = breite / 2.0
    t = tuer_b / 2.0
    rechteck_x(bm, x, y0, y0 + hoehe, -halb, -t)
    rechteck_x(bm, x, y0, y0 + hoehe, t, halb)
    rechteck_x(bm, x, y0 + tuer_h, y0 + hoehe, -t, t)


def findling(bm, mitte, groesse, drehung=0.0, unruhe=0.08, ringe=8, segmente=14,
             kante=0.62):
    """Ein gerundeter Feldstein.

    ── Warum kein verzerrter Wuerfel ────────────────────────────────
    Der erste Bau setzte Steine als Quader mit verschobenen Ecken. Das
    ergab acht scharfe Kanten und drei ebene Flaechen je Stein — aus der
    Naehe liest sich das als Betonpoller, nicht als Findling. Gemeldet
    wurde es als "sehr scharfkantig und wenig realistisch".

    Stattdessen wird hier ein SUPERELLIPSOID abgetastet: eine Kugel,
    deren Winkelfunktionen mit einem Exponenten unter eins vorzeichentreu
    potenziert werden. Bei 1,0 bliebe eine Kugel, gegen 0 entstuende ein
    Wuerfel — dazwischen liegt genau die Form eines abgerollten
    Feldsteins: fuellig wie ein Block, aber ohne eine einzige harte Kante.

    Darueber liegt ein Rauschen auf dem Radius, damit kein Stein dem
    anderen gleicht.
    """
    cx, cy, cz = mitte
    sx, sy, sz = (g / 2.0 for g in groesse)
    c, s = math.cos(drehung), math.sin(drehung)
    # `kante`: Exponent des Superellipsoids, kleiner = kantiger. 0,62 ist
    # der Vorgabewert fuer freistehende Findlinge — die erste Fassung mit
    # 0,45 und grobem Rauschen las sich immer noch als behauener Block.

    def pot(v, e):
        return math.copysign(abs(v) ** e, v) if v != 0.0 else 0.0

    def ort(x, y, z):
        return bm.verts.new((cx + x * c - z * s, cy + y, cz + x * s + z * c))

    # Die Pole bekommen je EINEN Punkt. Wuerde man sie wie die uebrigen
    # Ringe mit `segmente` Punkten belegen, laegen die alle uebereinander
    # und die Flaechen dazwischen waeren entartet.
    oben = ort(0.0, sy * (1.0 + rnd.uniform(-unruhe, unruhe)), 0.0)
    unten = ort(0.0, -sy * (1.0 + rnd.uniform(-unruhe, unruhe)), 0.0)

    gitter = []
    for i in range(1, ringe):
        theta = math.pi * i / ringe
        st, ct = math.sin(theta), math.cos(theta)
        reihe = []
        for j in range(segmente):
            phi = 2 * math.pi * j / segmente
            r = 1.0 + rnd.uniform(-unruhe, unruhe)
            reihe.append(ort(sx * pot(st, kante) * pot(math.cos(phi), kante) * r,
                             sy * pot(ct, kante) * r,
                             sz * pot(st, kante) * pot(math.sin(phi), kante) * r))
        gitter.append(reihe)
    bm.verts.ensure_lookup_table()

    for j in range(segmente):
        j2 = (j + 1) % segmente
        bm.faces.new([oben, gitter[0][j], gitter[0][j2]])
        bm.faces.new([unten, gitter[-1][j], gitter[-1][j2]])
    for i in range(len(gitter) - 1):
        for j in range(segmente):
            j2 = (j + 1) % segmente
            bm.faces.new([gitter[i][j], gitter[i + 1][j],
                          gitter[i + 1][j2], gitter[i][j2]])


# ── Tripo-Teile ──────────────────────────────────────────────────────
# Einzelelemente aus tools/tripo-generate.mjs (assets/models/Grab*.glb).
# Sie werden als VORLAGE geladen und dann mehrfach in einen BMesh
# gestempelt: bm.from_mesh() haengt Geometrie an, die neuen Ecken werden
# anschliessend je Stempel transformiert. Objektkopien schieden aus, weil
# transform_apply an Mehrfachnutzer-Meshes scheitert und obj.location an
# der End-Drehung vorbeilaeuft (siehe Schiffs-Lektion oben).

def tripo_vorlage(name, dezimieren=1.0):
    """Laedt assets/models/<name>.glb als Vorlage.

    Rueckgabe (mesh, material, hoehe) oder None, wenn die Datei fehlt —
    jeder Verwender hat einen prozeduralen Rueckfall, damit der Bau auch
    ohne Tripo-Assets durchlaeuft (assets/ ist gitignored).

    `dezimieren` < 1 duennt die Vorlage aus. Noetig fuer Teile, die oft
    gestempelt werden: Der ganze Huegel hat ~10k Dreiecke, ein einzelner
    Tripo-Menhir 3,5k — zwoelf davon unverduennt waeren das Vierfache des
    restlichen Bauwerks.
    """
    pfad = os.path.join(ROOT, 'assets/models', f'{name}.glb')
    if not os.path.exists(pfad):
        print(f'HINWEIS {name}.glb fehlt — prozeduraler Rueckfall')
        return None
    vorher = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=pfad)
    neu_objs = [o for o in bpy.data.objects if o not in vorher and o.type == 'MESH']
    if not neu_objs:
        return None
    obj = neu_objs[0]
    # Objekttransformation INS MESH backen, bevor gemessen wird: Der
    # glTF-Importer traegt die y-hoch→z-hoch-Umrechnung je nach Datei als
    # OBJEKT-Drehung ein statt in die Eckdaten. Wer dann nur das Mesh
    # misst und stempelt, uebernimmt die Rohachsen — gemessen am
    # Runenstein, der flach im Gras lag und von vorn wie ein Bogen aussah,
    # waehrend die Menhire zu gedrungenen Feldsteinen wurden.
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    if dezimieren < 1.0:
        mod = obj.modifiers.new('dez', 'DECIMATE')
        mod.ratio = dezimieren
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier='dez')
    mesh = obj.data
    material_ = mesh.materials[0] if mesh.materials else None
    # Hoehe der Vorlage: nach dem glTF-Import liegt sie auf Blender-Z.
    zs = [v.co.z for v in mesh.vertices]
    hoehe = max(zs) - min(zs)
    # Objekt aus der Szene nehmen, das Mesh bleibt als Datenblock erhalten.
    for o in neu_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return mesh, material_, hoehe


def stempeln(bm, vorlage_mesh, matrix):
    """Haengt die Vorlage einmal an `bm` an und transformiert nur die
    neuen Ecken."""
    vorher = len(bm.verts)
    bm.from_mesh(vorlage_mesh)
    bm.verts.ensure_lookup_table()
    neu_verts = [bm.verts[i] for i in range(vorher, len(bm.verts))]
    bmesh.ops.transform(bm, matrix=matrix, verts=neu_verts)


def stempel_matrix(pos, yaw, skal):
    """Vorrotations-Raum: Hoehe auf Y. Die Vorlage kommt z-hoch aus dem
    Import, daher zuerst -90 Grad um X, dann Skalierung, Drehung, Ort."""
    from mathutils import Matrix
    return (Matrix.Translation(Vector(pos)) @
            Matrix.Rotation(yaw, 4, 'Y') @
            Matrix.Scale(skal, 4) @
            Matrix.Rotation(-math.pi / 2, 4, 'X'))


def tripo_objekt(bm, name, material_):
    """Wie aus_bmesh, aber mit dem MATERIAL DER VORLAGE (eingebettete
    Tripo-Texturen) statt eines eigenen; UVs bleiben unangetastet."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if material_ is not None:
        obj.data.materials.append(material_)
    return obj


# ── Huegelschale ─────────────────────────────────────────────────────

def huegel():
    """Elliptische Kuppel ohne Boden, mit ausgeschnittener Tuer.

    Die Kuppel wird als halbes Ellipsoid mit einer Potenzkurve gebaut:
    ein reiner Halbkreis steht zu steil und sieht aus wie ein Iglu, ein
    Kegel zu spitz. Der Exponent 1.6 auf den Radius ergibt die flach
    auslaufende Form eines aufgeschuetteten Huegels.
    """
    bm = bmesh.new()
    # Fein genug, dass die ausgesparte Tuer nicht viel groesser wird als
    # der Gang: Bei 72 Segmenten misst ein Feld am Fuss rund 1,7 m, bei
    # 16 Ringen 0,75 m in der Hoehe. Die 3,2 × 3,6 m grosse Oeffnung
    # trifft das auf etwa eine Feldbreite genau.
    ringe, segmente = 16, 72
    gitter = []
    # Der Scheitel ist EIN Punkt, kein Ring. Vorher lief die Schleife bis
    # t=1, wo der Radius null wird — der oberste Ring bestand aus 72
    # uebereinanderliegenden Ecken und die Felder dazwischen waren
    # entartet. Genau dort war die Kuppel je nach Blickwinkel offen.
    # Der unterste Ring liegt EINGEGRABEN, nicht auf dem Boden. Genau auf
    # y=0 waere er koplanar mit dem Gelaende — seit die Platzierung das
    # Terrain planiert, ist der Boden darunter exakt eben, und ein
    # koplanarer Ring flimmert bei jeder Kamerabewegung (Z-Fighting am
    # ganzen Fuss). 40 cm Einbindung sind unsichtbar und beenden das.
    FUSS_EINBINDUNG = 0.4
    for i in range(ringe):
        t = i / ringe                       # 0 unten, unterhalb des Scheitels
        r = (1.0 - t ** 1.6) ** 0.55
        y = HUEGEL_H * t - (FUSS_EINBINDUNG if i == 0 else 0.0)
        reihe = []
        for j in range(segmente):
            w = 2 * math.pi * j / segmente
            # Leichte Unruhe im Grundriss — ein exaktes Ellipsoid wirkt
            # gegossen, ein Grabhuegel ist geschuettet.
            unruhe = 1.0 + 0.05 * math.sin(3 * w + SEED) + 0.03 * math.sin(7 * w)
            x = HUEGEL_RX * r * math.cos(w) * unruhe
            z = HUEGEL_RZ * r * math.sin(w) * unruhe
            reihe.append(bm.verts.new((x, y, z)))
        gitter.append(reihe)
    spitze = bm.verts.new((0.0, HUEGEL_H, 0.0))
    bm.verts.ensure_lookup_table()
    for i in range(ringe - 1):
        for j in range(segmente):
            j2 = (j + 1) % segmente
            bm.faces.new([gitter[i][j], gitter[i][j2],
                          gitter[i + 1][j2], gitter[i + 1][j]])
    for j in range(segmente):
        j2 = (j + 1) % segmente
        bm.faces.new([gitter[-1][j], gitter[-1][j2], spitze])
    bm.faces.ensure_lookup_table()

    # ── Tuer aussparen ──────────────────────────────────────────────
    # Frueher stand hier ein Boolean gegen einen Schnittquader. Das war
    # falsch: Die Kuppel ist eine OFFENE Schale, und der exakte Solver
    # verschliesst den Schnitt am Ende des Quaders mit einer Deckflaeche.
    # Gemessen mit einem Strahl durch den Gang lag die bei x = -11,6 und
    # versperrte den Weg auf JEDER Hoehe — der Huegel sah begehbar aus,
    # war es aber nicht.
    #
    # Stattdessen werden die Felder weggelassen, deren Mitte im Tuerfeld
    # liegt. Das kann keine Deckflaeche erzeugen, weil gar nichts
    # geschnitten wird.
    # Zugabe: Ohne sie ragte die Schale an der oberen Ecke noch in den Gang
    # (gemessen bei 2,6 und 3,3 m Hoehe). Sie faellt nicht auf, weil die
    # Schale den Gang ohnehin nur unmittelbar am Eingang kreuzt — dahinter
    # liegt er im Huegel — und dort steht das Portal davor.
    ZUGABE = 0.7
    weg = []
    for f in bm.faces:
        m = f.calc_center_median()
        if m.x < 0 and abs(m.z) <= GANG_B / 2 + ZUGABE and m.y <= GANG_H + ZUGABE:
            weg.append(f)
    bmesh.ops.delete(bm, geom=weg, context='FACES')
    print(f'TUER {len(weg)} Kuppelfelder ausgespart')

    return aus_bmesh(bm, 'huegel', MAT_SODE, kachel=3.5, glatt=True)


# ── Innenraeume ──────────────────────────────────────────────────────

def kammer():
    """Grabkammer mit Walmdecke, Normalen nach innen.

    ── Warum keine flache Decke auf voller Hoehe ────────────────────
    Die Kammer ist ein Rechteck, die Kuppel eine Ellipse: An den vier
    Diagonalen ist die Kuppel deutlich niedriger als an den Achsen. Mit
    flacher Decke auf 6,5 m stiessen die Kammerecken durch die
    Kuppelflaeche — von aussen standen vier steinerne Dreiecke im Gras
    (gemessen: Kuppelhoehe ueber der Kammerecke 5,2 m).

    Die Walmdecke loest das ohne Verzicht auf Raumhoehe: Die Waende
    enden bei WAND_H, darueber laufen vier Schraegen auf eine flache
    Decke ueber dem inneren Rechteck zu. Die Ecken bleiben niedrig
    (5,0 m < 5,2 m Kuppelhoehe an der Diagonalen), die Mitte hoch.
    """
    WAND_H = 4.0
    SCHRAEGE = 3.0                     # Einzug der Decke je Seite
    xl, xr = -KAMMER_L / 2, KAMMER_L / 2
    zv, zh = -KAMMER_B / 2, KAMMER_B / 2
    ix_l, ix_r = xl + SCHRAEGE, xr - SCHRAEGE
    iz_v, iz_h = zv + SCHRAEGE, zh - SCHRAEGE
    y0, yw, yd = BODEN_Y, BODEN_Y + WAND_H, BODEN_Y + KAMMER_H

    bm = bmesh.new()
    V = bm.verts.new

    # Boden
    bm.faces.new([V((xl, y0, zv)), V((xr, y0, zv)),
                  V((xr, y0, zh)), V((xl, y0, zh))])
    # Waende: +x geschlossen, ±z geschlossen, -x mit Tuer
    rechteck_x(bm, xr, y0, yw, zv, zh)
    bm.faces.new([V((xl, y0, zv)), V((xr, y0, zv)),
                  V((xr, yw, zv)), V((xl, yw, zv))])
    bm.faces.new([V((xl, y0, zh)), V((xr, y0, zh)),
                  V((xr, yw, zh)), V((xl, yw, zh))])
    wand_mit_oeffnung(bm, xl, WAND_H, KAMMER_B, GANG_B, GANG_H, y0=y0)

    # Vier Walm-Schraegen: Wandkrone -> Deckenrechteck. Bei gleichem
    # Einzug auf allen Seiten treffen sich die Trapeze in den Ecken
    # kantenbuendig, es entsteht keine Luecke.
    bm.faces.new([V((xl, yw, zv)), V((xr, yw, zv)),
                  V((ix_r, yd, iz_v)), V((ix_l, yd, iz_v))])
    bm.faces.new([V((xl, yw, zh)), V((xr, yw, zh)),
                  V((ix_r, yd, iz_h)), V((ix_l, yd, iz_h))])
    bm.faces.new([V((xl, yw, zv)), V((xl, yw, zh)),
                  V((ix_l, yd, iz_h)), V((ix_l, yd, iz_v))])
    bm.faces.new([V((xr, yw, zv)), V((xr, yw, zh)),
                  V((ix_r, yd, iz_h)), V((ix_r, yd, iz_v))])
    # Flache Decke ueber dem inneren Rechteck
    bm.faces.new([V((ix_l, yd, iz_v)), V((ix_r, yd, iz_v)),
                  V((ix_r, yd, iz_h)), V((ix_l, yd, iz_h))])

    # Doppelte Eckpunkte verschmelzen — JEDE Flaeche oben hat ihre eigenen
    # Ecken bekommen. Ohne gemeinsame Kanten kann normals_make_consistent
    # die Wicklung nicht von Flaeche zu Flaeche weiterreichen, und einzelne
    # Waende blieben falsch herum: Im Spiel fehlten Deckenmitte und eine
    # Seitenwand, man sah aus der Grabkammer die Sterne.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)

    return aus_bmesh(bm, 'kammer', MAT_STEIN, kachel=3.4, nach_innen=True)


def gang():
    """Zugang von der Tuer zur Kammer — als Rampe, Normalen nach innen.

    Boden und Decke steigen von aussen (GANG_BODEN_AUSSEN) auf den
    Kammerboden (BODEN_Y); die lichte Hoehe GANG_H bleibt ueberall gleich.
    Beide Stirnseiten offen: aussen die Tuer, innen der Durchbruch.

    Die Rampe endet an der KAMMERWAND (x = -KAMMER_L/2), nicht erst am
    inneren Gangende: Der Gang ragt 0,4 m in die Kammer hinein
    (GANG_X_INNEN), damit am Durchbruch kein Spalt bleibt. Stieg die
    Rampe bis dorthin, laege sie an der Wandebene noch UNTER dem
    Kammerboden, und dessen Plattenkante stuende als Stufe im Weg
    (gemessen 7,3 cm — die Kapselrundung trifft das mit ~35 Grad, knapp
    unter der 40-Grad-Grenze: begehbar, aber ein spuerbarer Huckel).
    Deshalb drei Stuetzstellen: aussen -> Wand als Rampe, Wand -> innen
    eben auf Kammerhoehe, buendig mit dem Kammerboden.
    """
    bm = bmesh.new()
    V = bm.verts.new
    xw = -KAMMER_L / 2                      # Wandebene der Kammer
    zl, zr = -GANG_B / 2, GANG_B / 2
    # Stuetzstellen (x, Bodenhoehe) von aussen nach innen.
    stuetzen = [(GANG_X_AUSSEN, GANG_BODEN_AUSSEN), (xw, BODEN_Y),
                (GANG_X_INNEN, BODEN_Y)]

    for (x0, y0), (x1, y1) in zip(stuetzen, stuetzen[1:]):
        bm.faces.new([V((x0, y0, zl)), V((x1, y1, zl)),
                      V((x1, y1, zr)), V((x0, y0, zr))])
        bm.faces.new([V((x0, y0 + GANG_H, zl)), V((x1, y1 + GANG_H, zl)),
                      V((x1, y1 + GANG_H, zr)), V((x0, y0 + GANG_H, zr))])
        bm.faces.new([V((x0, y0, zl)), V((x1, y1, zl)),
                      V((x1, y1 + GANG_H, zl)), V((x0, y0 + GANG_H, zl))])
        bm.faces.new([V((x0, y0, zr)), V((x1, y1, zr)),
                      V((x1, y1 + GANG_H, zr)), V((x0, y0 + GANG_H, zr))])
    # Wie bei der Kammer: getrennt erzeugte Ecken verschmelzen, sonst kann
    # normals_make_consistent die Wicklung nicht ueber die Kanten reichen.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    return aus_bmesh(bm, 'gang', MAT_STEIN, kachel=2.4, nach_innen=True)


# ── Steinwerk aussen ─────────────────────────────────────────────────

def steinkranz():
    """Randsteine rund um den Huegelfuss.

    Die HAUPTSTEINE sind Tripo-Menhire (GrabMenhir.glb) — bemooster
    Granit mit Runenritzung, dieselbe Machart wie der Steinkreis. Auf
    halber Aufloesung gestempelt: zwoelf Stueck in voller Dichte waeren
    das Vierfache des restlichen Huegels. Dazwischen stehen kleinere
    prozedurale Findlinge, damit der Kranz nicht wie zwoelfmal dasselbe
    Denkmal aussieht.
    """
    vorlage = tripo_vorlage('GrabMenhir', dezimieren=0.5)
    ergebnis = []

    def fussort(w, abstand=0.35):
        unruhe_fuss = 1.0 + 0.05 * math.sin(3 * w + SEED) + 0.03 * math.sin(7 * w)
        return ((HUEGEL_RX * unruhe_fuss + abstand) * math.cos(w),
                (HUEGEL_RZ * unruhe_fuss + abstand) * math.sin(w))

    def tuerseite(w):
        return abs(math.cos(w)) > 0.86 and math.cos(w) < 0

    if vorlage is not None:
        mesh, material_, hoehe = vorlage
        bm = bmesh.new()
        anzahl_gross = 12
        for i in range(anzahl_gross):
            w = 2 * math.pi * (i + 0.5) / anzahl_gross
            if tuerseite(w):
                continue
            x, z = fussort(w, 0.45)
            ziel = rnd.uniform(1.9, 2.9)
            # 30 cm eingesenkt: gesetzte Steine stehen nicht AUF dem Gras,
            # und die Spitze eines fernen Menhirs lugte sonst in der
            # Frontalansicht ueber die Kuppelsilhouette.
            stempeln(bm, mesh, stempel_matrix(
                (x, -0.3, z), w + math.pi / 2 + rnd.uniform(-0.25, 0.25),
                ziel / hoehe))
        ergebnis.append(tripo_objekt(bm, 'steinkranz_menhire', material_))

    bm = bmesh.new()
    anzahl_klein = 22
    for i in range(anzahl_klein):
        w = 2 * math.pi * i / anzahl_klein
        if tuerseite(w):
            continue
        h = rnd.uniform(0.9, 1.5) if vorlage is not None else rnd.uniform(1.6, 2.7)
        b = rnd.uniform(0.7, 1.1)
        x, z = fussort(w)
        findling(bm, (x, h / 2, z), (b, h, b * 0.72),
                 drehung=w + rnd.uniform(-0.3, 0.3), unruhe=0.07)
    ergebnis.append(aus_bmesh(bm, 'steinkranz', MAT_STEIN, kachel=2.0, glatt=True))
    return ergebnis


def portal():
    """Zwei Tragsteine und ein Deckstein ueber dem Eingang — ein Dolmen.

    Der Deckstein liegt bewusst etwas schief: Ein waagerechter Sturz
    wirkt gemauert, ein leicht gesackter wirkt alt.
    """
    bm = bmesh.new()
    x = GANG_X_AUSSEN + 0.2
    for seite in (-1, 1):
        z = seite * (GANG_B / 2 + 0.55)
        findling(bm, (x, 2.15, z), (1.5, 4.3, 1.25), unruhe=0.05)
    findling(bm, (x, 4.55, 0.0), (1.6, 0.95, GANG_B + 3.0),
             drehung=0.05, unruhe=0.04)
    return aus_bmesh(bm, 'portal', MAT_RUNEN, kachel=2.6, glatt=True)


def vorbau():
    """Steinerner Torgang vor dem Eingang — zwei Wangen und ein Deckstein.

    Er ist nicht nur Zier: Die Tuer wird aus der Kuppel ausgespart, indem
    ganze Felder wegfallen, und die entstehende Oeffnung ist zwangslaeufig
    groesser als der Gangquerschnitt (Feldraster plus Zugabe). Durch den
    Spalt zwischen Lochrand und Gangwand sah man ins Leere — der Huegel
    wirkte "nicht geschlossen". Die Wangen und der Deckstein liegen genau
    in diesem Spalt und schliessen ihn von aussen.

    Die Masse ergeben sich aus der Aussparung: Lochrand maximal
    GANG_B/2 + ZUGABE + halbes Kuppelfeld von der Achse, die Wangen
    reichen mit 1,3 m Staerke darueber hinaus. Innen bleiben sie hinter
    der Gangwand (|z| >= 1,85 > GANG_B/2), der Deckstein beginnt ueber
    der Gangdecke.
    """
    bm = bmesh.new()
    x0 = GANG_X_AUSSEN + 0.6
    x1 = -HUEGEL_RX * 0.55          # tief genug, um den Lochrand zu decken
    laenge = x1 - x0
    mitte_x = (x0 + x1) / 2
    for seite in (-1, 1):
        findling(bm, (mitte_x, 2.4, seite * 2.55), (laenge, 5.4, 1.4),
                 unruhe=0.04, kante=0.35)
    findling(bm, (mitte_x, GANG_H + 0.85, 0.0), (laenge, 1.5, 6.6),
             unruhe=0.04, kante=0.35)
    return aus_bmesh(bm, 'vorbau', MAT_STEIN, kachel=2.4, glatt=True)


def runenstein():
    """Bautastein neben dem Eingang — Tripo-Runenstein, sonst Platte."""
    vorlage = tripo_vorlage('GrabRunenstein')
    if vorlage is not None:
        mesh, material_, hoehe = vorlage
        bm = bmesh.new()
        stempeln(bm, mesh, stempel_matrix(
            (GANG_X_AUSSEN - 2.0, 0.0, -4.6), 0.5, 3.4 / hoehe))
        return tripo_objekt(bm, 'runenstein', material_)
    bm = bmesh.new()
    findling(bm, (GANG_X_AUSSEN - 2.0, 1.7, -4.6), (1.7, 3.4, 0.55),
             drehung=0.35, unruhe=0.04, kante=0.45)
    return aus_bmesh(bm, 'runenstein', MAT_RUNEN, kachel=1.7, glatt=True)


def drachenkoepfe():
    """Drachenkoepfe auf Bug- und Hecksteven (Tripo), sonst nichts —
    die prozeduralen Steven tragen auch ohne Kopf."""
    vorlage = tripo_vorlage('GrabDrachenkopf', dezimieren=0.6)
    if vorlage is None:
        return None
    mesh, material_, hoehe = vorlage
    bm = bmesh.new()
    for richtung in (-1, 1):
        # Auf die SPITZE des Stevenbogens (endet bei etwa Rumpf + 2,5 m),
        # Blick nach AUSSEN. Die fruehere Herleitung ("Vorlage schaut nach
        # -x") war falsch — der Nutzer meldete die Richtung im Spiel als
        # verkehrt. Am Profil-Render nachgemessen: Bei yaw = 0 schaut die
        # Vorlage QUER (Steuerbord, Vorrotations-z). Also Viertel-Drehung:
        # -90 Grad am Bug (+x), +90 Grad am Heck (-x).
        x = 0.6 + richtung * (SCHIFF_L / 2 + 1.35)
        yaw = -richtung * math.pi / 2
        stempeln(bm, mesh, stempel_matrix(
            (x, BODEN_Y + SCHIFF_H + 2.45, 0.0), yaw, 1.5 / hoehe))
    return tripo_objekt(bm, 'drachenkoepfe', material_)


# ── Schiff ───────────────────────────────────────────────────────────

def schiff():
    """Klinkergebauter Rumpf mit hochgezogenen Steven.

    Der Rumpf entsteht als Schar von Spanten (Querschnitten) entlang der
    Laengsachse, die zu Flaechen verbunden werden. Jeder Spant ist ein
    halbes U: unten schmal (Kiel), oben breit (Dollbord). Breite und
    Tiefe laufen ueber eine Sinuskurve aus, damit Bug und Heck spitz
    zulaufen statt abgeschnitten zu enden.
    """
    bm = bmesh.new()
    spanten, hoch = 26, 7
    gitter = []
    for i in range(spanten + 1):
        t = i / spanten
        laengs = math.sin(math.pi * t) ** 0.62      # Voelle ueber die Laenge
        x = (t - 0.5) * SCHIFF_L
        reihe = []
        for k in range(hoch + 1):
            u = k / hoch                            # 0 Kiel, 1 Dollbord
            # Rumpfquerschnitt: unten fast senkrecht, oben ausfallend.
            breite = SCHIFF_B / 2 * laengs * (0.16 + 0.84 * u ** 0.72)
            y = SCHIFF_H * u
            reihe.append((x, y, breite))
        gitter.append(reihe)

    # Beide Seiten spiegeln
    knoten = {}
    for i, reihe in enumerate(gitter):
        for k, (x, y, b) in enumerate(reihe):
            for s in (-1, 1):
                if b < 1e-4 and s == 1 and (x, y, b) in [(x, y, 0)]:
                    pass
                knoten[(i, k, s)] = bm.verts.new((x, y, s * b))
    bm.verts.ensure_lookup_table()
    for i in range(spanten):
        for k in range(hoch):
            for s in (-1, 1):
                bm.faces.new([knoten[(i, k, s)], knoten[(i + 1, k, s)],
                              knoten[(i + 1, k + 1, s)], knoten[(i, k + 1, s)]])
    # Deck schliessen, damit man nicht in einen hohlen Rumpf sieht
    for i in range(spanten):
        bm.faces.new([knoten[(i, hoch, -1)], knoten[(i + 1, hoch, -1)],
                      knoten[(i + 1, hoch, 1)], knoten[(i, hoch, 1)]])

    # Steven: Bug und Heck als hochgezogene Boegen. Sie sind das, woran
    # man ein Wikingerschiff auf Entfernung erkennt.
    for ende, richtung in ((0, -1), (spanten, 1)):
        basis = Vector((gitter[ende][hoch][0], SCHIFF_H, 0.0))
        vorher = None
        for s in range(9):
            u = s / 8
            bogen = Vector((basis.x + richtung * 1.5 * math.sin(u * 1.5),
                            basis.y + 2.5 * u ** 0.8,
                            0.0))
            dick = 0.20 * (1 - 0.45 * u)
            ring = [bm.verts.new((bogen.x + dx, bogen.y + dy, dz))
                    for dx, dy, dz in ((-dick, 0, -dick), (dick, 0, -dick),
                                       (dick, 0, dick), (-dick, 0, dick))]
            if vorher is not None:
                for q in range(4):
                    bm.faces.new([vorher[q], vorher[(q + 1) % 4],
                                  ring[(q + 1) % 4], ring[q]])
            vorher = ring

    # Versatz INS MESH backen statt in obj.location: Die Hochachsen-Drehung
    # am Ende dreht nur die Meshdaten — ein Objektversatz bleibt in den
    # alten Achsen stehen und wandert nach der Drehung zur Seite statt nach
    # oben. Gemessen: Der Rumpf sass 1 m zu tief (halb im Steinboden) und
    # 1 m neben der Achse, waehrend die Schilde darueber schwebten.
    bmesh.ops.translate(bm, verts=list(bm.verts), vec=(0.6, BODEN_Y, 0.0))
    return aus_bmesh(bm, 'schiff', MAT_HOLZ, kachel=1.1)


def schilde():
    """Rundschilde am Dollbord — bemalt, wie die Schildreihen der Zeit.

    Jeder Schild ist eine geschlossene Linse (vorderer und hinterer
    Flachkegel); die VORDERSEITE bekommt per Hand-UV einen der drei
    bemalten Atlas-Quadranten (Viertel, Ringe, Sektoren), die Rueckseite
    den Holzquadranten mit Griffbrett. Deshalb KEINE Wuerfelprojektion
    (projizieren=False) — die wuerde die Kreise zerschneiden.
    """
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    # Quadranten des Atlas in UV (v zaehlt von unten): drei bemalte, ein Holz
    BEMALT = [(0.0, 0.5), (0.5, 0.5), (0.0, 0.0)]
    HOLZ_Q = (0.5, 0.0)
    R_UV = 0.2305          # Kreisradius im Atlas (118 px / 512)

    def fan(spitze, ring, quadrant, gedreht):
        qx, qy = quadrant
        cx, cy = qx + 0.25, qy + 0.25
        n = len(ring)
        for k in range(n):
            k2 = (k + 1) % n
            ecken = [spitze, ring[k], ring[k2]] if not gedreht else [spitze, ring[k2], ring[k]]
            f = bm.faces.new(ecken)
            winkel = [None, 2 * math.pi * k / n, 2 * math.pi * k2 / n]
            if gedreht:
                winkel = [None, winkel[2], winkel[1]]
            for li, w in zip(f.loops, winkel):
                if w is None:
                    li[uv].uv = (cx, cy)
                else:
                    li[uv].uv = (cx + R_UV * math.cos(w), cy + R_UV * math.sin(w))

    anzahl = 11
    for i in range(anzahl):
        t = (i + 0.5) / anzahl
        x = (t - 0.5) * SCHIFF_L * 0.78 + 0.6
        for seite in (-1, 1):
            z = seite * (SCHIFF_B / 2 * math.sin(math.pi * t) ** 0.62 + 0.10)
            r = 0.46
            y = BODEN_Y + SCHIFF_H + 0.14
            vorn = bm.verts.new((x, y, z + seite * 0.10))     # Schildbuckel
            hinten = bm.verts.new((x, y, z - seite * 0.04))
            ring = [bm.verts.new((x + r * math.cos(2 * math.pi * k / 12),
                                  y + r * math.sin(2 * math.pi * k / 12), z))
                    for k in range(12)]
            bm.verts.ensure_lookup_table()
            fan(vorn, ring, BEMALT[rnd.randrange(3)], gedreht=False)
            fan(hinten, ring, HOLZ_Q, gedreht=True)
    return aus_bmesh(bm, 'schilde', MAT_SCHILD, projizieren=False)


def segelrolle():
    """Gerefftes Segel auf der Rahe — die Wollbahnen geben dem Schiff
    seine Farbe, auch zusammengerollt. Ein bauchiger Zylinder laengs der
    Rahe, an den Enden duenner (dort ist weniger Tuch aufgewickelt)."""
    bm = bmesh.new()
    laenge = 5.6
    schritte, seg = 10, 10
    y0 = BODEN_Y + 5.05
    ringe = []
    for i in range(schritte + 1):
        t = i / schritte
        z = (t - 0.5) * laenge
        r = 0.14 + 0.20 * math.sin(math.pi * t) ** 0.5
        ring = [bm.verts.new((0.6 + r * math.cos(2 * math.pi * k / seg),
                              y0 + r * math.sin(2 * math.pi * k / seg), z))
                for k in range(seg)]
        ringe.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(schritte):
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new([ringe[i][k], ringe[i][k2],
                          ringe[i + 1][k2], ringe[i + 1][k]])
    for ende, ring in ((0, ringe[0]), (1, ringe[-1])):
        mitte = bm.verts.new((0.6, y0, (ende - 0.5) * laenge))
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new([mitte, ring[k], ring[k2]])
    return aus_bmesh(bm, 'segelrolle', MAT_SEGEL, kachel=1.3, glatt=True)


def mast():
    bm = bmesh.new()
    quader(bm, (0.6, BODEN_Y + 3.0, 0.0), (0.38, 6.0, 0.38))
    # Rahe quer darueber
    quader(bm, (0.6, BODEN_Y + 5.3, 0.0), (0.26, 0.26, 6.0))
    return aus_bmesh(bm, 'mast', MAT_HOLZ, kachel=1.0)


# ── Grabbeigaben ─────────────────────────────────────────────────────

def fass(bm, mitte, hoehe, radius):
    """Fassform als Drehkoerper — bauchig, mit Deckel und Boden."""
    cx, cy, cz = mitte
    seg = 10
    profil = [(0.00, 0.82), (0.18, 0.96), (0.5, 1.0), (0.82, 0.96), (1.00, 0.82)]
    ringe = []
    for t, f in profil:
        ring = [bm.verts.new((cx + radius * f * math.cos(2 * math.pi * k / seg),
                              cy + t * hoehe,
                              cz + radius * f * math.sin(2 * math.pi * k / seg)))
                for k in range(seg)]
        ringe.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(ringe) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new([ringe[i][k], ringe[i][k2],
                          ringe[i + 1][k2], ringe[i + 1][k]])
    for ende, ring in ((0.0, ringe[0]), (hoehe, ringe[-1])):
        mitte_v = bm.verts.new((cx, cy + ende, cz))
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new([mitte_v, ring[k], ring[k2]])


def truhe(bm, mitte, breite, hoehe, tiefe, drehung):
    """Kastentruhe mit uebergreifendem Deckel — liest sich auch ohne
    Beschlaege als Truhe, weil der Deckel VORSTEHT."""
    cx, cy, cz = mitte
    quader(bm, (cx, cy + hoehe * 0.35, cz), (breite, hoehe * 0.7, tiefe),
           drehung=drehung)
    quader(bm, (cx, cy + hoehe * 0.85, cz),
           (breite * 1.08, hoehe * 0.3, tiefe * 1.12), drehung=drehung)


def beigaben():
    """Grabbeigaben im Umgang: Truhen, Faesser, Kisten und die
    Traegerpfosten. Bewusst NICHT symmetrisch — eine Grabkammer ist
    beladen worden, nicht eingerichtet."""
    ergebnis = []
    vorlage = tripo_vorlage('GrabTruhe', dezimieren=0.6)
    if vorlage is not None:
        mesh, material_, hoehe = vorlage
        tb = bmesh.new()
        stempeln(tb, mesh, stempel_matrix((-9.4, BODEN_Y, 5.3), 0.3, 0.95 / hoehe))
        stempeln(tb, mesh, stempel_matrix((8.6, BODEN_Y, 5.5), 1.1, 0.85 / hoehe))
        ergebnis.append(tripo_objekt(tb, 'truhen_tripo', material_))
    bm = bmesh.new()
    if vorlage is None:
        truhe(bm, (-9.4, BODEN_Y, 5.3), 1.5, 0.95, 0.9, 0.3)
        truhe(bm, (8.6, BODEN_Y, 5.5), 1.3, 0.85, 0.85, 1.1)
    truhe(bm, (2.0, BODEN_Y, -5.8), 1.4, 0.9, 0.85, 0.9)
    fass(bm, (-7.2, BODEN_Y, -5.4), 1.1, 0.44)
    fass(bm, (-6.1, BODEN_Y, -5.9), 0.9, 0.38)
    fass(bm, (10.2, BODEN_Y, -5.1), 1.1, 0.44)
    quader(bm, (-10.8, BODEN_Y + 0.3, -4.9), (0.7, 0.6, 0.6), drehung=0.5)
    quader(bm, (-3.6, BODEN_Y + 0.38, 5.9), (0.9, 0.75, 0.65), drehung=1.0)
    quader(bm, (5.2, BODEN_Y + 0.35, 5.6), (0.8, 0.7, 0.55), drehung=0.4)
    # Traegerpfosten unter dem inneren Deckenrechteck
    for sx in (-1, 1):
        for sz in (-1, 1):
            quader(bm, (sx * 7.0, BODEN_Y + KAMMER_H / 2,
                        sz * 3.6), (0.48, KAMMER_H, 0.48))
    ergebnis.append(aus_bmesh(bm, 'beigaben', MAT_HOLZ, kachel=1.0))
    return ergebnis


def feuerschalen():
    """Zwei steinerne Schalen — sie geben dem Raum einen Blickfang und
    markieren den Weg vom Gang zum Schiff."""
    bm = bmesh.new()
    for z in (-4.6, 4.6):
        findling(bm, (-KAMMER_L * 0.34, BODEN_Y + 0.45, z),
                 (1.15, 0.9, 1.15), unruhe=0.06)
    return aus_bmesh(bm, 'feuerschalen', MAT_STEIN, kachel=0.9, glatt=True)


# ── Zusammenbau ──────────────────────────────────────────────────────

def dreiecke(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def main():
    leere_szene()
    roh = [huegel(), kammer(), gang(), steinkranz(), portal(), vorbau(), runenstein(),
           schiff(), schilde(), segelrolle(), mast(), drachenkoepfe(), beigaben(),
           feuerschalen()]
    teile = []
    for t in roh:
        if t is None:
            continue
        teile.extend(t) if isinstance(t, list) else teile.append(t)

    for o in teile:
        print(f'TEIL {o.name:14s} {dreiecke(o):6d} Dreiecke')

    bpy.ops.object.select_all(action='DESELECT')
    for o in teile:
        o.select_set(True)
    bpy.context.view_layer.objects.active = teile[0]

    # ── Hochachse drehen ────────────────────────────────────────────
    # Der ganze Bau rechnet mit y = HOEHE, weil sich Masse so lesen wie
    # im Spiel. Blender ist aber Z-up: Ohne Drehung landet die Hoehe auf
    # einer waagerechten Achse, und `export_yup` macht daraus einen
    # Huegel, der auf der Seite liegt — gemessen 21,6 m "hoch" bei 8,7 m
    # "tief", also genau Breite und Hoehe vertauscht.
    #
    # +90 Grad um X bildet (x, y, z) auf (x, -z, y) ab, die Rechenhoehe
    # wird damit zu Blenders Z. Der anschliessende Export nach y-up dreht
    # sie zurueck auf die glTF-Hochachse.
    for o in teile:
        o.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    # Nullpunkt: Der Kammerboden liegt bereits auf y=0 — genau das ist die
    # Bedingung fuer den Spawn (siehe Kopf). Deshalb wird hier NICHT auf
    # die tiefste Ecke normiert wie bei den Baeumen.
    ziel = os.path.join(ROOT, ZIEL, f'{NAME}.glb')
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=ziel,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )
    gesamt = sum(dreiecke(o) for o in teile)
    mb = os.path.getsize(ziel) / 1e6
    print(f'FERTIG {ziel} — {gesamt} Dreiecke, {mb:.2f} MB')


main()
