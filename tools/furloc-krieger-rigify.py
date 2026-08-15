#!/usr/bin/env blender --background --python
"""
Macht aus dem HANDGERIGGTEN Furloc-Krieger (`assets/upload/furloc_krieger.glb`,
Rigify-Skelett mit 160 DEF-Knochen) die spielfertige Datei.

    blender --background --python tools/furloc-krieger-rigify.py -- \\
        --glb assets/upload/furloc_krieger.glb \\
        --roh assets/models/FurlocKrieger-roh.glb \\
        --out assets/models/FurlocKrieger.glb

── Warum dieses Werkzeug und nicht meshy-anim-uebernehmen.py ────────
Weil die beiden Dateien verschiedene KRANKHEITEN haben. Das andere
Werkzeug ist eine Reparaturwerkstatt für Meshys Auto-Rig: Es baut einen
fehlenden Leerlauf, hebt die Sohle je Bild aus dem Boden, gibt Speer und
Schild eigene Knochen und sucht unter drei Angriffen den einzigen, der
sich schleifen lässt. Nichts davon trifft hier zu — nachgemessen an der
evaluierten Haut:

  * Alle drei Clips schliessen EXAKT zur Schleife (mittlerer Vertex-
    Abstand zwischen erstem und letztem Bild: 0,0000 — auch beim Angriff).
  * Die Sohlen bleiben in jedem Bild ÜBER der Sohlenebene (+0,4 bis
    +1,2 cm). Meshys Gang sank 21 cm ein, und zwar WÄHREND der Standphase.
  * Es gibt einen echten `Idle`; Meshy lieferte keinen.
  * Speer und Schild sitzen, wo sie hingehören.

Dieselbe Maschinerie hier noch einmal anzuwerfen hiesse, die Handarbeit
des Autors auszuregeln. Was bleibt, ist Einbau, nicht Reparatur:
Clipnamen, Material, Maßeinheit, Sohlenlage und Gangtempo.

── Die vier Dinge, die trotzdem nicht von allein stimmen ────────────
 1. NAMEN. Der Client schaltet auf den String aus dem ZDO-Member `anim`,
    und der IST der Gruppenname in der GLB (AssetManager.wechsleAnimation,
    Teilstringvergleich). `Idle` trifft „idle" von selbst und
    `Attack_SpeerStoss` trifft „attack" — `Laufen` trifft „walk" NICHT.
    Umbenannt werden trotzdem alle drei: Ein Clip, dessen Name nur
    zufällig als Teilstring passt, ist eine Falle für den Nächsten.

 2. MASSEINHEIT. Die Datei kommt mit einer Armature auf Skalierung 0,01
    (Blender-Export in Zentimetern), das Modell wäre im Spiel 1,9 cm
    hoch. Die Skalierung wird deshalb auf 1 gesetzt und eingerechnet;
    danach steht die Figur in derselben Einheit wie die vier anderen
    Furlocs, und `localScale` bleibt bei rund 1,0 statt bei 100.

 3. SOHLE. Der Prefab-Ursprung IST im Spiel die Geländehöhe. Gemessen
    wird die FUSSSOHLE über die Vertexgruppen `DEF-foot`/`DEF-toe` und
    nicht der tiefste Punkt der Datei: Der ist das Speerende, das in der
    Ruhepose 1,1 cm unter der Sohle auf dem Boden aufsteht. Ein Schaft
    darf im Gras verschwinden, ein Fuss darf nicht schweben — dieselbe
    Abwägung wie in tools/furloc-volk-rig.py.

 4. MATERIAL. Meshys Exporter setzt `emissiveFactor` [1,1,1] MIT DER
    BASECOLOR als Emissionskarte (die Figur leuchtet in voller Eigenfarbe
    und wirkt ausgewaschen), lässt `metallicFactor` weg — glTF-Vorgabe ist
    dann 1,0, also vollmetallisch — und stellt `alphaMode` auf BLEND, ohne
    dass es etwas Durchsichtiges gäbe.

── Warum die Texturen aus der "-roh"-Datei kommen ───────────────────
Das ist kein Ersetzen, sondern das Gegenteil: Die 4096er-Karte des
Uploads und die 1024er `Baked_BaseColor` der roh-Datei sind DASSELBE
BILD. Nachgemessen an den Mittelwerten von acht Kachelvierteln stimmen
sie auf vier Nachkommastellen überein (0,21933 gegen 0,21954 …) — die
roh-Karte ist die verkleinerte Fassung derselben Textur.

Die roh-Datei bringt aber zusätzlich die MetallicRoughness-Karte mit, die
im Upload fehlt, und ihre Emissionskarte ist schwarz. Sie zu übernehmen
erhält also das Aussehen exakt, macht die Figur den vier Verwandten
gleich und spart die 27 MB, die eine 4096er-RGBA-Karte im Videospeicher
kostet.

── Der Gang und ROUTE_DEFAULT_SPEED ─────────────────────────────────
Der Server schiebt den NPC mit 1,5 m/s über seine Route; der Clip hat
seine eigene Schrittweite. Passt beides nicht zusammen, schleift der
Standfuss. Das Eigentempo wird deshalb gemessen (s. `messe_tempo`) und
der Clip auf der ZEITACHSE gestaucht — nicht neu abgetastet: Die Posen
sind Handarbeit und bleiben unangetastet, verschoben werden nur die
Zeitpunkte der Schlüsselbilder.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pfad(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


GLB = pfad(arg('--glb', 'assets/upload/furloc_krieger.glb'))
ROH = pfad(arg('--roh', 'assets/models/FurlocKrieger-roh.glb'))
OUT = pfad(arg('--out', 'assets/models/FurlocKrieger.glb'))
TEMPO = float(arg('--tempo', '1.5'))            # m/s, ROUTE_DEFAULT_SPEED
ZIELHOEHE = float(arg('--zielhoehe', '1.794'))  # m, Körperhöhe wie bisher
# Ohne `--gang-dehnen nein` wird der Gang auf das Servertempo gestaucht —
# aber nur innerhalb dieses Bandes, s. die Begründung unten am Zweig.
GANG_ANPASSEN = arg('--gang-dehnen', 'ja') != 'nein'
GANG_BAND = (float(arg('--gang-band-min', '0.75')), float(arg('--gang-band-max', '1.35')))

# Quellname → Engine-Name. Die drei Pflichtnamen des Clients; was hier
# nicht steht, würde stumm durchgereicht und wäre eine Falle (s. Kopf).
UMBENENNUNG = {
    'Idle': 'idle',
    'Laufen': 'walk',
    'Attack_SpeerStoss': 'attack',
}
# Vertexgruppen des Rigify-Rigs, die die Sohle tragen.
FUSS_GRUPPEN = ('DEF-foot.L', 'DEF-toe.L', 'DEF-foot.R', 'DEF-toe.R')

# ── Speer und Schild: Masse aus der Furloc-Messtabelle ──────────────
# Nicht neu vermessen. Die Zahlen stehen seit tools/furloc-volk-rig.py in
# der Messtabelle des Kriegers (sohlenrelativ, in Koordinaten der
# "-roh"-Datei), und diese Datei ist dieselbe Geometrie, nur ähnlich
# transformiert. Der Faktor wird UNTEN AUS DEN BOUNDING BOXES GEMESSEN
# statt hier hingeschrieben: Der Upload vom 9. August steht auf 1,40273,
# der Meshy-Biped vom 8. auf 1,3869 — wer den Faktor festschreibt, misst
# beim nächsten Export das Falsche.
SCHAFT_MITTE_T = (-0.7995, -0.0991, 0.7871)
SCHAFT_ACHSE = Vector((-0.1155, -0.0325, +0.9928)).normalized()
SCHAFT_T = (-0.7986, +0.5533)
SCHILD_MITTE_T = (+0.7900, -0.1250, 0.5302)
SCHILD_R = 0.230


def abstand_segment(p, a, b):
    ab = b - a
    l2 = ab.length_squared
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


# ── Laden ───────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Meshys Exporter legt der Szene eine leere Icosphere bei (42 Vertices,
# kein Material, keine Armature) — im Spiel wäre das eine unsichtbare
# Kugel um die Figur.
for o in list(bpy.data.objects):
    if o.type == 'MESH' and len(o.data.vertices) < 200:
        print(f'VERWORFEN: {o.name} ({len(o.data.vertices)} Vertices, keine Figur)')
        bpy.data.objects.remove(o, do_unlink=True)

mesh = max([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
szene = bpy.context.scene
FPS = szene.render.fps
arm.animation_data_create()

print(f'MODELL: {len(mesh.data.vertices)} Vertices, '
      f'{sum(len(p.vertices) - 2 for p in mesh.data.polygons)} Dreiecke, '
      f'{len(arm.data.bones)} Knochen, {len(bpy.data.actions)} Clips bei {FPS} fps')

# ── Masseinheit: die 0,01 der Armature herausnehmen ─────────────────
# Das Modell selbst liegt in derselben Einheit wie die vier anderen
# Furlocs; nur die Armature trägt eine Zentimeter-Skalierung. Sie wird auf
# 1 gesetzt, statt sie in `localScale` weiterzureichen — sonst stünde dort
# eine 100, und niemand wüsste beim nächsten Mal, warum.
alt = tuple(round(x, 5) for x in arm.matrix_world.to_scale())
arm.scale = (1.0, 1.0, 1.0)
arm.location = (0.0, 0.0, 0.0)
bpy.context.view_layer.update()
print(f'EINHEIT: Armature-Skalierung {alt} -> (1.0, 1.0, 1.0)')

MW = mesh.matrix_world.copy()
ruhe = [MW @ v.co for v in mesh.data.vertices]

# ── Blickrichtung: gemessen, nicht angenommen ───────────────────────
# Die Engine dreht eine laufende Figur mit yaw = atan2(dx, dz)
# (shared/worldlayout/routenlauf.ts); im importierten Blender-Raum ist das
# -Y. Belegt an den Zehen, die vor den Knöcheln liegen müssen.
_zehen = sum((arm.data.bones[f'DEF-toe.{s}'].head_local.y
              - arm.data.bones[f'DEF-foot.{s}'].head_local.y) for s in ('L', 'R'))
print(f'BLICK: Zehen liegen {_zehen:+.3f} in y vor den Knöcheln — die Figur schaut nach '
      f'{"-y (Engine-Konvention, keine Drehung nötig)" if _zehen < 0 else "?? PRÜFEN"}')
if _zehen >= 0:
    raise SystemExit('Blickrichtung ist nicht -y; hier fehlt die Drehung '
                     '(s. BLICK_DREHUNG in tools/furloc-volk-rig.py)')

# ── Ähnlichkeitsfaktor zur "-roh"-Datei messen ──────────────────────
vorher_obj = set(bpy.data.objects)
vorher_img = set(bpy.data.images)
bpy.ops.import_scene.gltf(filepath=ROH)
roh_neu = [o for o in bpy.data.objects if o not in vorher_obj]
roh_bilder = {i.name: i for i in bpy.data.images if i not in vorher_img}
roh_mesh = max([o for o in roh_neu if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
roh_welt = [roh_mesh.matrix_world @ v.co for v in roh_mesh.data.vertices]


def spanne(punkte, achse):
    w = [getattr(p, achse) for p in punkte]
    return max(w) - min(w)


F = sum(spanne(ruhe, a) / spanne(roh_welt, a) for a in 'xyz') / 3.0
_streu = max(abs(spanne(ruhe, a) / spanne(roh_welt, a) - F) for a in 'xyz')
print(f'FAKTOR gegen {os.path.basename(ROH)}: {F:.5f} (Streuung über x/y/z {_streu:.5f})')
if _streu > 1e-3:
    raise SystemExit('Der Upload ist gegenüber der roh-Datei nicht ÄHNLICH '
                     'transformiert — die Messtabelle für Speer und Schild '
                     'passt dann nicht mehr.')

# ── Sohle, Höhe, Requisiten ─────────────────────────────────────────
gname = [g.name for g in mesh.vertex_groups]


def haupt(i):
    g = sorted(mesh.data.vertices[i].groups, key=lambda g: -g.weight)
    return gname[g[0].group] if g else '-'


sohle_idx = [i for i in range(len(ruhe)) if haupt(i) in FUSS_GRUPPEN]
if not sohle_idx:
    raise SystemExit(f'keine Fussgruppen {FUSS_GRUPPEN} gefunden — anderes Rig?')
SOHLE = min(ruhe[i].z for i in sohle_idx)


def nach_hier(p):
    """Messtabelle (sohlenrelativ, roh-Koordinaten) -> diese Datei."""
    return Vector((F * p[0], F * p[1], F * p[2] + SOHLE))


SCHAFT_MITTE = nach_hier(SCHAFT_MITTE_T)
SCHAFT_A = SCHAFT_MITTE + SCHAFT_ACHSE * (SCHAFT_T[0] * F)
SCHAFT_B = SCHAFT_MITTE + SCHAFT_ACHSE * (SCHAFT_T[1] * F)
SCHILD_MITTE = nach_hier(SCHILD_MITTE_T)

speer = [i for i, v in enumerate(ruhe)
         if SCHAFT_T[0] * F - 0.1 <= (v - SCHAFT_MITTE).dot(SCHAFT_ACHSE) <= SCHAFT_T[1] * F + 0.1
         and abstand_segment(v, SCHAFT_A, SCHAFT_B) <= 0.24 * F]
schild = [i for i, v in enumerate(ruhe)
          if (v - SCHILD_MITTE).length <= SCHILD_R * 1.35 * F and i not in set(speer)]
koerper = [i for i in range(len(ruhe)) if i not in set(speer) | set(schild)]

HOEHE = max(ruhe[i].z for i in koerper) - SOHLE
SPITZE = max(ruhe[i].z for i in speer) - SOHLE
SKALA = round(ZIELHOEHE / HOEHE, 3)
print(f'MASSE: Sohle bei z={SOHLE:+.4f}, Körperhöhe {HOEHE:.4f}, Speerspitze '
      f'{SPITZE:.4f} über der Sohle; Speer {len(speer)} / Schild {len(schild)} Vertices')
print(f'MASSE: localScale {SKALA} ergibt {HOEHE * SKALA:.3f} m Körper und '
      f'{SPITZE * SKALA:.3f} m bis zur Speerspitze (Ziel {ZIELHOEHE:.3f} m)')

# Auf die Sohle stellen. Die Armature trägt das Mesh, also reicht ein
# Versatz an ihr — Skinning und Clips bleiben unberührt.
arm.location.z -= SOHLE
bpy.context.view_layer.update()
MW = mesh.matrix_world.copy()
ruhe = [MW @ v.co for v in mesh.data.vertices]


def haut():
    dgl = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dgl)
    m = ev.to_mesh()
    out = [MW @ m.vertices[i].co.copy() for i in range(len(m.vertices))]
    ev.to_mesh_clear()
    return out


# ── Umbenennen ──────────────────────────────────────────────────────
# Der glTF-Import hängt den Objektnamen an ("Idle" -> Action "Idle_rig"),
# deshalb wird über den Präfix gesucht und nicht auf Gleichheit geprüft.
#
# ── Und warum die NLA-SPUR mit umbenannt werden muss ─────────────────
# Weil sie es ist, die im Export zählt. Der glTF-Import legt je Animation
# eine NLA-Spur mit einem Strip an, und der Exporter nimmt in ACTIONS-
# Modus den SPURNAMEN als Name der glTF-Animation. Wer nur die Action
# umbenennt, bekommt eine Datei, in der die Clips weiterhin `Idle`,
# `Laufen` und `Attack_SpeerStoss` heissen — geprüft und genau so
# passiert. Der Client fände dann „walk" nicht und der NPC bliebe im
# Gehen stehen.
#
# Dem alten meshy-anim-uebernehmen.py konnte das nicht passieren: Es baut
# seine Actions mit `bpy.data.actions.new()` selbst, dort gibt es gar
# keine NLA-Spur.
aktionen = {}
spuren = {t.name: t for o in bpy.data.objects if o.animation_data
          for t in o.animation_data.nla_tracks}
for quelle, ziel in UMBENENNUNG.items():
    treffer = [a for a in bpy.data.actions if a.name.startswith(quelle)]
    if not treffer:
        raise SystemExit(f'Clip "{quelle}" fehlt in {os.path.basename(GLB)} — '
                         f'vorhanden: {[a.name for a in bpy.data.actions]}')
    akt = treffer[0]
    akt.name = ziel
    akt.use_fake_user = True
    aktionen[ziel] = akt
    spur = spuren.get(quelle)
    if spur is None:
        raise SystemExit(f'Zu "{quelle}" gibt es keine NLA-Spur — der Export '
                         f'würde den alten Namen schreiben. Bitte prüfen.')
    spur.name = ziel
    for strip in spur.strips:
        strip.name = ziel
for a in list(bpy.data.actions):
    if a.name not in aktionen:
        print(f'HINWEIS: Clip "{a.name}" steht in keiner Umbenennung und wird verworfen')
        bpy.data.actions.remove(a)
print('CLIPS: ' + ', '.join(f'{q} -> {z}' for q, z in UMBENENNUNG.items())
      + ' (Action UND NLA-Spur)')


# ── Gang nachmessen ─────────────────────────────────────────────────
def messe_tempo(akt, dauer):
    """Eigentempo eines Laufzyklus an der evaluierten Haut.

    In jedem Bild zählt der Fuss, der sich am stärksten nach HINTEN
    bewegt (+y, denn die Figur schaut nach -y) — das ist der tragende.
    Die Summe seiner Rückwärtswege über den Zyklus ist der Weg, den der
    Körper in dieser Zeit machen muss, damit er stehen bleibt.

    Nicht „wer Bodenkontakt hat": Ein Höhenschwellwert erklärt in der
    Doppelstandphase beide Füsse für stehend und mittelt den
    vorschwingenden gegen den tragenden weg. Und nicht „Schrittweite mal
    Kadenz": das zählt genau diese Doppelphase doppelt.
    """
    arm.animation_data.action = akt
    f0, f1 = akt.frame_range
    n = max(8, int(round(f1 - f0)))
    fuesse = {'R': [i for i in sohle_idx if ruhe[i].x < 0],
              'L': [i for i in sohle_idx if ruhe[i].x >= 0]}
    spur = {s: [] for s in fuesse}
    for k in range(n + 1):
        f = f0 + (f1 - f0) * k / n
        szene.frame_set(int(f), subframe=f - int(f))
        w = haut()
        for s, idx in fuesse.items():
            spur[s].append(sum(w[i].y for i in idx) / len(idx))
    weg = sum(max(spur[s][k] - spur[s][k - 1] for s in spur) for k in range(1, n + 1))
    return weg / dauer


walk = aktionen['walk']
DAUER_WALK = (walk.frame_range[1] - walk.frame_range[0]) / FPS
V_CLIP = messe_tempo(walk, DAUER_WALK)
V_SPIEL = V_CLIP * SKALA
print(f'\n=== GANG ===')
print(f'Zyklus {DAUER_WALK:.4f} s; der Standfuss wandert mit {V_CLIP:.4f} Einheiten/s '
      f'nach hinten. Bei localScale {SKALA} sind das {V_SPIEL:.3f} m/s Eigentempo.')
print(f'Der Server schiebt mit {TEMPO:.2f} m/s. Die beiden ehrlichen Wege:')
print(f'  (a) RouteDef.speed an seiner Route auf {V_SPIEL:.2f} m/s setzen '
      f'(Zyklus bleibt {DAUER_WALK:.3f} s)')
print(f'  (b) den Clip auf {DAUER_WALK * V_SPIEL / TEMPO:.3f} s stauchen '
      f'(Faktor {V_SPIEL / TEMPO:.3f}, Kadenz {2 * TEMPO / (DAUER_WALK * V_SPIEL):.2f} Schritte/s)')

faktor = V_SPIEL / TEMPO if V_SPIEL > 0 else 1.0
kadenz_neu = 2 * TEMPO / (DAUER_WALK * V_SPIEL) if V_SPIEL > 0 else 0.0
if GANG_ANPASSEN and not (GANG_BAND[0] <= faktor <= GANG_BAND[1]):
    # Hier wird ausdrücklich NICHT gestaucht, und das ist der Kern dieses
    # Werkzeugs gegenüber dem alten: Stauchen ist billig, aber es ändert
    # die KADENZ, und die ist beim handanimierten Gang eine gestalterische
    # Entscheidung. Der Zyklus hier läuft mit 1,9 Schritten je Sekunde —
    # der Takt eines gehenden Zweibeiners. Auf 1,5 m/s gepresst wären es
    # 4,9, und das liest kein Auge mehr als Gehen, sondern als Trippeln.
    # Genau daran krankt das handgebaute Rig der vier anderen Furlocs:
    # `furloc-volk-rig.py` leitet seine Schrittweite aus der (sehr kurzen)
    # Beinlänge ab und landet bei 8 Schritten je Sekunde.
    #
    # Innerhalb des Bandes bleibt das Stauchen richtig: Ein Drittel mehr
    # oder weniger Takt sieht niemand, ein schleifender Fuss dagegen
    # sofort.
    print(f'NICHT GESTAUCHT: Der nötige Faktor {faktor:.3f} liegt ausserhalb des '
          f'Bandes {GANG_BAND[0]:.2f}..{GANG_BAND[1]:.2f}. Der Clip behält seine '
          f'{DAUER_WALK:.3f} s ({2 / DAUER_WALK:.2f} Schritte/s);')
    print(f'  bei {TEMPO:.2f} m/s würde der Standfuss um {TEMPO - V_SPIEL:+.2f} m/s '
          f'schleifen. Der richtige Weg ist hier (a): `speed: {V_SPIEL:.2f}` an der '
          f'RouteDef seiner Route.')
elif GANG_ANPASSEN and V_SPIEL > 0:
    # Stauchen auf der ZEITACHSE: Die Posen sind Handarbeit und werden
    # nicht neu abgetastet — verschoben werden nur die Zeitpunkte der
    # Schlüsselbilder samt ihrer Bezier-Griffe. Der Exporter tastet
    # anschliessend selbst mit der Szenen-Bildrate ab.
    f0 = walk.frame_range[0]
    for fc in walk.fcurves:
        for kp in fc.keyframe_points:
            for punkt in (kp.co, kp.handle_left, kp.handle_right):
                punkt.x = f0 + (punkt.x - f0) * faktor
        fc.update()
    neu = (walk.frame_range[1] - walk.frame_range[0]) / FPS
    print(f'GEWÄHLT: (b) — ROUTE_DEFAULT_SPEED gilt für alle NPCs und die Route '
          f'liegt in server/data/worldlayout.json.')
    print(f'NACHGEMESSEN am gestauchten Zyklus ({neu:.3f} s): '
          f'{messe_tempo(walk, neu) * SKALA:.3f} m/s (Ziel {TEMPO:.3f})')
else:
    print('GEWÄHLT: (a) — der Clip behält seine Dauer.')

# ── Gegenprobe an der evaluierten Haut ──────────────────────────────
print('\n=== PROBE (tiefster Punkt je Teil, über den ganzen Clip) ===')
for name in ('idle', 'walk', 'attack'):
    akt = aktionen[name]
    arm.animation_data.action = akt
    f0, f1 = int(akt.frame_range[0]), int(math.ceil(akt.frame_range[1]))
    tief = {'Sohle': 1e9, 'Körper': 1e9, 'Speer': 1e9, 'Schild': 1e9}
    hoch = -1e9
    for f in range(f0, f1 + 1):
        szene.frame_set(f)
        w = haut()
        tief['Sohle'] = min(tief['Sohle'], min(w[i].z for i in sohle_idx))
        tief['Körper'] = min(tief['Körper'], min(w[i].z for i in koerper))
        tief['Speer'] = min(tief['Speer'], min(w[i].z for i in speer))
        tief['Schild'] = min(tief['Schild'], min(w[i].z for i in schild))
        hoch = max(hoch, max(w[i].z for i in koerper))
    print(f'{name:7s} ' + '  '.join(f'{k} {v:+.4f} ({v * SKALA * 100:+.1f} cm)'
                                    for k, v in tief.items())
          + f'   Scheitel {hoch * SKALA:.3f} m')

# ── Material aus der "-roh"-Datei ───────────────────────────────────
BASIS = next(i for n, i in roh_bilder.items() if 'BaseColor' in n)
MERO = next((i for n, i in roh_bilder.items() if 'MetallicRoughness' in n), None)
print(f'\nMATERIAL: aus {os.path.basename(ROH)} übernommen — BaseColor '
      f'{BASIS.size[0]}x{BASIS.size[1]}'
      + (f', MetallicRoughness {MERO.size[0]}x{MERO.size[1]}' if MERO else '')
      + '; dasselbe Bild wie die 4096er-Karte des Uploads, nur verkleinert')

mat = mesh.data.materials[0]
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
for n in [n for n in nt.nodes if n.type in ('TEX_IMAGE', 'SEPARATE_COLOR')]:
    nt.nodes.remove(n)
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = BASIS
BASIS.colorspace_settings.name = 'sRGB'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
if MERO:
    # glTF packt Rauheit nach G und Metall nach B. Der Umweg über
    # "Separate Color" ist genau die Zerlegung, die der glTF-Export
    # wiedererkennt und als metallicRoughnessTexture zurückschreibt.
    mr = nt.nodes.new('ShaderNodeTexImage')
    mr.image = MERO
    MERO.colorspace_settings.name = 'Non-Color'
    trenn = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(mr.outputs['Color'], trenn.inputs['Color'])
    nt.links.new(trenn.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(trenn.outputs['Blue'], bsdf.inputs['Metallic'])
else:
    bsdf.inputs['Metallic'].default_value = 0.0
# alphaMode OPAQUE: Im Alphakanal der Upload-Karte liegen 306 von 16,8
# Mio Texeln unter 0,99 — es gibt nichts Durchsichtiges zu sortieren, und
# BLEND kostet eine Sortierung je Bild.
bsdf.inputs['Alpha'].default_value = 1.0
bsdf.inputs['Emission Strength'].default_value = 0.0
bsdf.inputs['Emission Color'].default_value = (0.0, 0.0, 0.0, 1.0)
bsdf.inputs['Specular Tint'].default_value = (1.0, 1.0, 1.0, 1.0)
mat.blend_method = 'OPAQUE'
mat.use_backface_culling = False
for o in roh_neu:
    bpy.data.objects.remove(o, do_unlink=True)
for img in list(bpy.data.images):
    if img.users == 0:
        bpy.data.images.remove(img)
print('MATERIAL: emissive aus, alphaMode OPAQUE, doubleSided bleibt '
      '(die Blattfransen brauchen es)')

# ── Export ──────────────────────────────────────────────────────────
# export_animation_mode='ACTIONS' schreibt jede Action als eigene
# glTF-Animation unter ihrem Action-Namen; export_frame_range muss dabei
# AUS sein, sonst schneidet der Szenenbereich der zuletzt gesetzten
# Aktion die anderen ab (Lehre aus tools/surtr-rig.py).
arm.animation_data.action = aktionen['idle']
szene.frame_set(int(aktionen['idle'].frame_range[0]))
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_frame_range=False,
    export_skins=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)
print(f'\nFERTIG {OUT} — {os.path.getsize(OUT) / 1e6:.2f} MB, Clips "idle", '
      f'"walk", "attack", {len(arm.data.bones)} Knochen; Körperhöhe '
      f'{HOEHE * SKALA:.3f} m bei localScale {SKALA}')
