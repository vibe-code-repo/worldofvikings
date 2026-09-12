"""Exportiert die modularen Figurenbausteine fuer den Web- und Spielclient.

Aufruf:
  flatpak run org.blender.Blender --background \
    /home/mike/wov-assets/PlayerCharacter/Blender/wov-player-master2.blend \
    --python tools/web/charakterteile-exportieren.py -- \
    --ausgabe wov-web/static/assets/models/wikingerin

Die Master-Datei wird nur gelesen. Alle Ausgaben tragen dieselbe Armatur und
damit dieselbe Gelenkreihenfolge wie der maennliche Spielkoerper.
"""

import argparse
import json
from pathlib import Path

import bpy


def argumente() -> argparse.Namespace:
    nach_trenner = []
    if "--" in __import__("sys").argv:
        nach_trenner = __import__("sys").argv[__import__("sys").argv.index("--") + 1 :]
    parser = argparse.ArgumentParser()
    parser.add_argument("--ausgabe", required=True)
    parser.add_argument(
        "--waffen-animationen",
        help="Optionale Blender-Datei mit zusaetzlichen Actions wie SpearIdle",
    )
    return parser.parse_args(nach_trenner)


ARGS = argumente()
AUSGABE = Path(ARGS.ausgabe).expanduser().resolve()
AUSGABE.mkdir(parents=True, exist_ok=True)

ARMATUR = bpy.data.objects["WoV_Player_Armature"]


def fehlende_waffen_animationen_laden() -> None:
    if not ARGS.waffen_animationen:
        return
    quelle = Path(ARGS.waffen_animationen).expanduser().resolve()
    if not quelle.is_file():
        raise RuntimeError(f"Datei mit Waffenanimationen fehlt: {quelle}")
    benoetigt = [name for name in ("SpearIdle",) if bpy.data.actions.get(name) is None]
    if not benoetigt:
        return
    namen = list(benoetigt)
    with bpy.data.libraries.load(str(quelle), link=False) as (_, ziel):
        # Blender ersetzt die Einträge dieser Liste beim Laden durch die
        # erzeugten Action-Objekte; deshalb die Namensliste separat halten.
        ziel.actions = list(namen)
    weiterhin_fehlen = [name for name in namen if bpy.data.actions.get(name) is None]
    if weiterhin_fehlen:
        raise RuntimeError(f"Waffenanimationen fehlen in {quelle}: {weiterhin_fehlen}")


def sammlungen_einblenden(layer=None) -> None:
    layer = layer or bpy.context.view_layer.layer_collection
    layer.exclude = False
    layer.hide_viewport = False
    for kind in layer.children:
        sammlungen_einblenden(kind)


def auswahl_leeren() -> None:
    for objekt in bpy.data.objects:
        objekt.select_set(False)


def auswaehlen(objekte) -> None:
    auswahl_leeren()
    for objekt in objekte:
        objekt.hide_set(False)
        objekt.hide_viewport = False
        objekt.hide_render = False
        objekt.select_set(True)
    ARMATUR.hide_set(False)
    ARMATUR.hide_viewport = False
    ARMATUR.hide_render = False
    ARMATUR.select_set(True)
    bpy.context.view_layer.objects.active = ARMATUR


def glb_exportieren(ziel: Path, animationen: bool) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(ziel),
        export_format="GLB",
        use_selection=True,
        export_animations=animationen,
        export_animation_mode="NLA_TRACKS" if animationen else "ACTIONS",
        export_skins=True,
        export_apply=False,
        export_yup=True,
        export_morph=False,
        export_materials="EXPORT",
    )
    print(f"EXPORT {ziel.name} {ziel.stat().st_size}", flush=True)


def spiel_animationen_vorbereiten() -> None:
    zuordnung = [
        ("idle", "Idle1"),
        ("gehen", "WalkFwd"),
        ("rennen", "RunFwd"),
        # Fuer die Vorschau und den ersten Spieleinsatz reicht der vollstaendige
        # Aufwaertsclip; der maennliche Export besitzt zusaetzlich den aus drei
        # Quellen zusammengesetzten Sprung.
        ("springen", "JumpUp"),
        ("angriff", "SwordAttack1FromIdle"),
        ("angriff2", "SwordAttack2FromIdle"),
        ("angriff3", "SwordAttack3FromIdle"),
        ("faust", "BodyPunch1FromIdle"),
        ("faust2", "BodyPunch2FromIdle"),
        ("faust3", "BodyKickFromIdle"),
        ("arm_schwert", "SwordIdleMovement"),
        ("hand_schwert", "SwordIdle"),
        # Beidhändige Stabhaltung für Druiden. Der männliche Standardexport
        # trägt denselben Clip unter diesem stabilen Web-/Spielnamen.
        ("arm_stab", "KatanaIdle"),
        # Senkrechte Stabhaltung: der Arm richtet die lokale Hand-X-Achse
        # nach oben, die Handspur schliesst die Finger um den Schaft.
        ("arm_speer", "SpearIdle"),
        ("hand_speer", "SwordIdle"),
        ("ausruesten", "SwordEquipFromIdle"),
        ("ablegen", "SwordUnequipFromIdle"),
        ("parade_links", "SwordParryLeft"),
        ("parade_rechts", "SwordParryRight"),
        ("parade_unten", "SwordParryDown"),
    ]
    ARMATUR.animation_data_create()
    daten = ARMATUR.animation_data
    for spur in list(daten.nla_tracks):
        daten.nla_tracks.remove(spur)
    daten.action = None
    for name, action_name in zuordnung:
        action = bpy.data.actions.get(action_name)
        if action is None:
            raise RuntimeError(f"Animation fehlt im Master: {action_name}")
        spur = daten.nla_tracks.new()
        spur.name = name
        streifen = spur.strips.new(name, int(action.frame_range[0]), action)
        streifen.name = name
        spur.mute = True


sammlungen_einblenden()
fehlende_waffen_animationen_laden()

# Weiblicher Grundkoerper ohne die im Master nur als Beispiel eingesetzte
# Frisur und Augenbraue. Beides wird im Editor als eigenes Modul aufgelegt.
female = [
    objekt
    for objekt in bpy.data.collections["Player_Female"].objects
    if objekt.type == "MESH"
    and not objekt.name.startswith(("Chr_Hair_", "Chr_Eyebrow_"))
]
if len(female) != 11:
    raise RuntimeError(f"Erwartet 11 weibliche Koerperteile, gefunden: {len(female)}")
spiel_animationen_vorbereiten()
auswaehlen(female)
glb_exportieren(AUSGABE / "WikingerinKoerper.glb", True)

# Ein Modul je Datei. Die stabilen Kurzkennungen H_XX/B_XX stehen spaeter im
# Spielstand; der originale Blender-Objektname bleibt im Bericht erhalten.
bericht = {
    "femaleBody": [o.name for o in female],
    "hair": [],
    "beards": [],
    "eyebrowsMale": [],
    "eyebrowsFemale": [],
}
for praefix, ziel_praefix, schluessel, erwartet in (
    ("Chr_Hair_", "H_", "hair", 38),
    ("Chr_FacialHair_Male_", "B_", "beards", 18),
    ("Chr_Eyebrow_Male_", "AM_", "eyebrowsMale", 10),
    ("Chr_Eyebrow_Female_", "AF_", "eyebrowsFemale", 7),
):
    objekte = sorted(
        (o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(praefix)),
        key=lambda o: int(o.name.rsplit("_", 1)[1]),
    )
    if len(objekte) != erwartet:
        raise RuntimeError(
            f"Erwartet {erwartet} Objekte fuer {schluessel}, gefunden: {len(objekte)}"
        )
    for objekt in objekte:
        nummer = int(objekt.name.rsplit("_", 1)[1])
        datei = f"{ziel_praefix}{nummer:02d}"
        auswaehlen([objekt])
        glb_exportieren(AUSGABE / f"{datei}.glb", False)
        bericht[schluessel].append({"id": datei, "source": objekt.name})

(AUSGABE / "teile-export.json").write_text(
    json.dumps(bericht, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(
    f"FERTIG: {len(bericht['hair'])} Haare, {len(bericht['beards'])} Baerte, "
    f"{len(bericht['eyebrowsMale'])} maennliche und "
    f"{len(bericht['eyebrowsFemale'])} weibliche Augenbrauen, "
    f"{len(bericht['femaleBody'])} weibliche Koerperteile",
    flush=True,
)
