"""Exportiert die modularen Figurenbausteine fuer den Web- und Spielclient.

Die Wikingerin entsteht am 71er-Rig der Standardfigur (dasselbe Rig wie
WikingerKoerper.glb: 63 deformierende Knochen plus IK-/Pole-Knochen, 48 Clips).
Koerper und Teile kommen aus master2, Rig und Actions aus der Standardfigur.

Gueltige Quelle fuer --standard ist die v1-Blend
(wov-player-standard_2026-09-29_1217_anim-kern_v1.blend). Mike hat am 29.09.2026
entschieden, dass die Liegeposen ohne Bodenkorrektur bleiben; die Blends v2 bis v4
sind verworfene Versuche und ergeben einen anderen Koerper.

Aufruf (headless). Blender-Dateien und --ausgabe absolut angeben; der --python-Pfad
ist relativ zum Arbeitsverzeichnis von Blender. Bei Flatpak ist das ein anderes
cwd als in der Shell (Sandbox), deshalb auch --python absolut schreiben:
  flatpak run org.blender.Blender --factory-startup -b --python-exit-code 1 \\
    --python <absoluter Pfad>/tools/web/charakterteile-exportieren.py -- \\
    --standard /home/mike/wov-assets/PlayerCharacter/temp/<standard>.blend \\
    --master /home/mike/wov-assets/PlayerCharacter/Blender/wov-player-master2.blend \\
    --ausgabe <ordner>

--python-exit-code 1 macht aus einem Abbruch des Skripts einen Fehlerstatus; ohne die
Option meldet Blender auch nach einem Abbruch 0.
Alle Ausgaben entstehen zuerst in einem Temp-Ordner <ausgabe>/.neu-<zufall>. Erst nach
allen Pruefungen ersetzt das Skript die Dateien im Ziel und entfernt nur die exakt
bekannten Namen (WikingerinKoerper.glb, teile-export.json sowie ^(H|B|AM|AF)_\\d{2}\\.glb$),
die nicht mehr erzeugt wurden. Andere Dateien im Ziel (H_01.glb.bak, H_notes.txt,
h_01.glb, ...) bleiben unberuehrt.
Bricht das Skript bis einschliesslich der Selbstpruefung ab, wird der Temp-Ordner
geloescht und das Ziel bleibt unveraendert. Bricht es erst WAEHREND des Verschiebens
ab (Rechte, voller Datentraeger, ein Verzeichnis unter einem Zielnamen), kann das Ziel
teils neu, teils alt sein; das Verschieben ist nicht atomar. Das Skript meldet diesen
Fall mit "ZIEL TEILWEISE AKTUALISIERT" und der Abhilfe: den Lauf wiederholen, bis er
mit "VEROEFFENTLICHT" endet. Ein von hartem Abbruch (SIGKILL) uebrig gebliebener
.neu-*-Ordner wird beim naechsten Lauf gemeldet, aber nicht geloescht.
Beide Blender-Dateien werden nur gelesen, nie gespeichert. Der Koerper muss aus
master2 kommen: master3 hat einen anderen Kopf (518 statt 495 Vertices) und
wird vom Skript abgelehnt.

Der maennliche Koerper kommt nicht von hier, sondern von
Tools/export_game_glb.py auf dem Arbeitsplatz. SPUREN unten und die Spurliste
dort muessen gleich bleiben (Namen, Actions, Reihenfolge), sonst passen die
Animationen von Wikinger und Wikingerin nicht zusammen.
"""

import argparse
import json
import re
import shutil
import struct
import sys
import tempfile
from pathlib import Path

import bpy

ERWARTETE_KNOCHEN = 71
ERWARTETE_ANIMATIONEN = 48
# Vertices des weiblichen Kopfes in der exportierten GLB (nach dem Aufteilen an
# UV-Kanten). master2 liefert 495, master3 518.
ERWARTETE_KOPF_VERTICES = 495

# Spurbelegung des Spiel-Exports: (Clip-Name im GLB, Action in der Standardfigur).
# Die ersten 28 stammen aus Tools/export_game_glb.py, die 20 dahinter sind die
# Kernanimationen. Reihenfolge nicht aendern: Clip-Indizes und Spielwerte
# haengen daran.
SPUREN = (
    ("idle", "Idle1"),
    ("gehen", "WalkFwd"),
    ("rennen", "RunFwd"),
    ("springen", "springen"),
    ("angriff", "schwertschlag"),
    ("angriff2", "schwertschlag2"),
    ("angriff3", "schwertschlag3"),
    ("faust", "BodyPunch1FromIdle"),
    ("faust2", "BodyPunch2FromIdle"),
    ("faust3", "BodyKickFromIdle"),
    ("arm_schwert", "SwordIdleMovement"),
    ("hand_schwert", "SwordIdle"),
    ("ausruesten", "SwordEquipFromIdle"),
    ("ablegen", "SwordUnequipFromIdle"),
    ("parade_links", "SwordParryLeft"),
    ("parade_rechts", "SwordParryRight"),
    ("parade_unten", "SwordParryDown"),
    ("stab_angriff", "KatanaAttack1FromIdle"),
    ("stab_angriff2", "KatanaAttack2FromIdle"),
    ("stab_angriff3", "KatanaAttack3FromIdle"),
    ("arm_stab", "KatanaIdle"),
    ("stab_ausruesten", "KatanaEquipFromIdle"),
    ("stab_ablegen", "KatanaUnequipFromIdle"),
    ("stab_parade_links", "KatanaParryLeft"),
    ("stab_parade_rechts", "KatanaParryRight"),
    ("stab_parade_unten", "KatanaParryDown"),
    ("arm_speer", "SpearIdle"),
    ("hand_speer", "SwordIdle"),
    ("tod_vorn", "DieFwd"),
    ("tod_hinten", "DieBwd"),
    ("aufstehen_vorn", "ReviveFwd"),
    ("aufstehen_hinten", "ReviveBwd"),
    ("treffer_vorn_links", "DamageVisualizationFrontLeft"),
    ("treffer_vorn_rechts", "DamageVisualizationFrontRight"),
    ("treffer_hinten_links", "DamageVisualizationBackLeft"),
    ("treffer_hinten_rechts", "DamageVisualizationBackRight"),
    ("treffer_schwer", "Hit Big Front"),
    ("rueckstoss", "ImpactKnockBackResponse"),
    ("umgeworfen", "Damage_KnockDown_02_iP"),
    ("aufrappeln", "Damage_Getup01_P_iP"),
    ("betaeubt", "Damage_Stun01_loop"),
    ("aufheben", "PickupItem"),
    ("buecken_runter", "Pick_Down"),
    ("buecken_hoch", "Pick_Up"),
    ("truhe_oeffnen", "InteractOpenChest"),
    ("tuer_links", "InteractOpenDoorLeft"),
    ("tuer_rechts", "InteractOpenDoorRight"),
    ("knopf", "InteractPressButton"),
)

# Namen, die dieses Skript im Ziel erzeugt. Nur diese ersetzt oder entfernt es.
BEKANNTE_NAMEN = re.compile(r"(?:(?:H|B|AM|AF)_\d{2}\.glb|WikingerinKoerper\.glb|teile-export\.json)")

PRAEFIXE = ("Chr_Hair_", "Chr_FacialHair_Male_", "Chr_Eyebrow_Male_", "Chr_Eyebrow_Female_")


def argumente() -> argparse.Namespace:
    nach_trenner = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--standard", required=True, help="Standardfigur mit 71 Knochen (.blend)")
    parser.add_argument("--master", required=True, help="wov-player-master2.blend")
    parser.add_argument("--ausgabe", required=True)
    return parser.parse_args(nach_trenner)


ARGS = argumente()
STANDARD = Path(ARGS.standard).expanduser().resolve()
MASTER = Path(ARGS.master).expanduser().resolve()
AUSGABE = Path(ARGS.ausgabe).expanduser().resolve()
for datei in (STANDARD, MASTER):
    if not datei.is_file():
        raise RuntimeError(f"Blender-Datei fehlt: {datei}")

# Die Standardfigur ist die Arbeitsdatei. Wurde Blender nicht schon mit ihr
# gestartet, wird sie hier geoeffnet. Gespeichert wird nie.
if Path(bpy.data.filepath).resolve() != STANDARD:
    bpy.ops.wm.open_mainfile(filepath=str(STANDARD))
TEMP = None
AUSGABE_NEU = not AUSGABE.exists()


def verwerfen() -> None:
    """Abbruch: Temp-Ordner weg, Ziel unveraendert (ein neu angelegtes leeres Ziel auch)."""
    if TEMP is not None:
        shutil.rmtree(TEMP, ignore_errors=True)
    if AUSGABE_NEU:
        try:
            AUSGABE.rmdir()
        except OSError:
            pass


def veroeffentlichen() -> None:
    """Erst nach allen Pruefungen: neue Dateien ins Ziel, dann nicht mehr erzeugte alte weg."""
    neue = sorted(p.name for p in TEMP.iterdir())
    try:
        for name in neue:
            (TEMP / name).replace(AUSGABE / name)
        TEMP.rmdir()
        entfernt = sorted(
            p.name
            for p in AUSGABE.iterdir()
            if BEKANNTE_NAMEN.fullmatch(p.name) and p.is_file() and p.name not in neue
        )
        for name in entfernt:
            (AUSGABE / name).unlink()
    except BaseException:
        print(
            "ZIEL TEILWEISE AKTUALISIERT: Fehler beim Verschieben, das Ziel kann teils neu, "
            "teils alt sein. Lauf wiederholen, bis VEROEFFENTLICHT gemeldet wird.",
            flush=True,
        )
        raise
    print(f"VEROEFFENTLICHT: {len(neue)} Dateien, entfernt (nicht mehr erzeugt): {entfernt}", flush=True)


try:
    for rest in sorted(AUSGABE.glob(".neu-*")) if AUSGABE.is_dir() else []:
        print(f"ALTER REST (nicht geloescht): {rest}", flush=True)
    AUSGABE.mkdir(parents=True, exist_ok=True)
    TEMP = Path(tempfile.mkdtemp(prefix=".neu-", dir=AUSGABE))

    ARMATUR = bpy.data.objects["WoV_Player_Armature"]
    if len(ARMATUR.data.bones) != ERWARTETE_KNOCHEN:
        raise RuntimeError(
            f"Standardfigur hat {len(ARMATUR.data.bones)} Knochen, erwartet {ERWARTETE_KNOCHEN}"
        )
    fehlende_actions = sorted({a for _, a in SPUREN if bpy.data.actions.get(a) is None})
    if fehlende_actions:
        raise RuntimeError(f"Actions fehlen in der Standardfigur: {fehlende_actions}")

    # Namenskonflikte vermeiden: vorhandene Objekte, Materialien und Bilder der
    # Standardfigur zur Seite benennen (nur im Speicher).
    for objekt in list(bpy.data.objects):
        if objekt.name.startswith(PRAEFIXE) or "_Female_" in objekt.name:
            objekt.name = objekt.name + "__std"
    for material in bpy.data.materials:
        material.name = material.name + "__std"
    for bild in bpy.data.images:
        bild.name = bild.name + "__std"

    # Koerper (Collection Player_Female) und Teile aus master2 anhaengen (kein Link).
    with bpy.data.libraries.load(str(MASTER), link=False) as (quelle, ziel):
        ziel.collections = ["Player_Female"]
        ziel.objects = [n for n in quelle.objects if n.startswith(PRAEFIXE)]

    weiblich = bpy.data.collections["Player_Female"]
    bpy.context.scene.collection.children.link(weiblich)
    teile_sammlung = bpy.data.collections.new("Teile_Import")
    bpy.context.scene.collection.children.link(teile_sammlung)
    for objekt in bpy.data.objects:
        if objekt.name.startswith(PRAEFIXE) and not objekt.users_collection:
            teile_sammlung.objects.link(objekt)

    # Die mitgekommene Armatur aus master2 wird durch die der Standardfigur ersetzt:
    # Parent und Armature-Modifier umhaengen, Vertexgruppen gegen die Knochen pruefen.
    fremde_armaturen = [o for o in bpy.data.objects if o.type == "ARMATURE" and o is not ARMATUR]
    for objekt in bpy.data.objects:
        if objekt.type != "MESH" or objekt.name.endswith("__std"):
            continue
        if not (objekt.name.startswith(PRAEFIXE) or objekt.name in weiblich.objects):
            continue
        welt = objekt.matrix_world.copy()
        if objekt.parent is not None and objekt.parent is not ARMATUR:
            objekt.parent = ARMATUR
            objekt.matrix_world = welt
        for modifikator in objekt.modifiers:
            if modifikator.type == "ARMATURE":
                modifikator.object = ARMATUR
        ohne_knochen = [g.name for g in objekt.vertex_groups if g.name not in ARMATUR.data.bones]
        if ohne_knochen:
            raise RuntimeError(f"{objekt.name}: Vertexgruppen ohne Knochen {ohne_knochen}")
    for armatur in fremde_armaturen:
        bpy.data.objects.remove(armatur, do_unlink=True)


    def sammlungen_einblenden(layer=None) -> None:
        layer = layer or bpy.context.view_layer.layer_collection
        layer.exclude = False
        layer.hide_viewport = False
        for kind in layer.children:
            sammlungen_einblenden(kind)


    def auswaehlen(objekte) -> None:
        for objekt in bpy.data.objects:
            objekt.select_set(False)
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


    def glb_kopf(pfad: Path) -> dict:
        """Liest den glTF-JSON-Kopf einer geschriebenen GLB-Datei."""
        daten = pfad.read_bytes()
        magie, _version, _laenge = struct.unpack_from("<4sII", daten, 0)
        if magie != b"glTF":
            raise RuntimeError(f"{pfad.name}: keine GLB-Datei")
        json_laenge, json_typ = struct.unpack_from("<I4s", daten, 12)
        if json_typ != b"JSON":
            raise RuntimeError(f"{pfad.name}: erster Block ist kein JSON")
        return json.loads(daten[20 : 20 + json_laenge])


    sammlungen_einblenden()

    # Spurbelegung setzen: eine stumme NLA-Spur je Clip, in der Reihenfolge von SPUREN.
    animation = ARMATUR.animation_data_create()
    for spur in list(animation.nla_tracks):
        animation.nla_tracks.remove(spur)
    animation.action = None
    for name, action_name in SPUREN:
        action = bpy.data.actions[action_name]
        spur = animation.nla_tracks.new()
        spur.name = name
        streifen = spur.strips.new(name, int(action.frame_range[0]), action)
        streifen.name = name
        spur.mute = True

    # Weiblicher Grundkoerper ohne die im Master nur als Beispiel eingesetzte
    # Frisur und Augenbraue. Beides wird im Editor als eigenes Modul aufgelegt.
    weiblich_koerper = [
        o
        for o in weiblich.objects
        if o.type == "MESH" and not o.name.startswith(("Chr_Hair_", "Chr_Eyebrow_"))
    ]
    if len(weiblich_koerper) != 11:
        raise RuntimeError(f"Erwartet 11 weibliche Koerperteile, gefunden: {len(weiblich_koerper)}")

    auswaehlen(weiblich_koerper)
    koerper_datei = TEMP / "WikingerinKoerper.glb"
    glb_exportieren(koerper_datei, True)

    # Selbstpruefung an der geschriebenen Datei (noch im Temp-Ordner).
    kopf_json = glb_kopf(koerper_datei)


    def kopf_vertices_in_glb(kopf: dict) -> int:
        treffer = [m for m in kopf.get("meshes", []) if m.get("name", "").startswith("Chr_Head_Female")]
        if len(treffer) != 1:
            raise RuntimeError(f"Erwartet einen Kopf Chr_Head_Female*, gefunden: {len(treffer)}")
        return sum(kopf["accessors"][p["attributes"]["POSITION"]]["count"] for p in treffer[0]["primitives"])


    kopf_vertices = kopf_vertices_in_glb(kopf_json)
    gelenke = sum(len(s["joints"]) for s in kopf_json.get("skins", [])[:1])
    animationen = len(kopf_json.get("animations", []))
    print(f"SELBSTPRUEFUNG gelenke={gelenke} animationen={animationen} kopf_vertices={kopf_vertices}", flush=True)
    if kopf_vertices != ERWARTETE_KOPF_VERTICES:
        raise RuntimeError(
            f"Kopf hat {kopf_vertices} Vertices, erwartet {ERWARTETE_KOPF_VERTICES} "
            f"(master2). Falsche Master-Datei? {MASTER.name}"
        )
    if gelenke != ERWARTETE_KNOCHEN or animationen != ERWARTETE_ANIMATIONEN:
        raise RuntimeError(
            f"WikingerinKoerper.glb hat {gelenke} Gelenke und {animationen} Animationen, "
            f"erwartet {ERWARTETE_KNOCHEN} und {ERWARTETE_ANIMATIONEN}"
        )

    # Teile ohne Animationen: ein Modul je Datei. Die stabilen Kurzkennungen H_XX/B_XX
    # stehen spaeter im Spielstand; der originale Blender-Objektname bleibt im Bericht.
    for spur in list(animation.nla_tracks):
        animation.nla_tracks.remove(spur)
    bericht = {
        "femaleBody": [o.name for o in weiblich_koerper],
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
            (
                o
                for o in bpy.data.objects
                if o.type == "MESH" and o.name.startswith(praefix) and not o.name.endswith("__std")
            ),
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
            glb_exportieren(TEMP / f"{datei}.glb", False)
            bericht[schluessel].append({"id": datei, "source": objekt.name})

    (TEMP / "teile-export.json").write_text(
        json.dumps(bericht, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"FERTIG: {len(bericht['hair'])} Haare, {len(bericht['beards'])} Baerte, "
        f"{len(bericht['eyebrowsMale'])} maennliche und "
        f"{len(bericht['eyebrowsFemale'])} weibliche Augenbrauen, "
        f"{len(bericht['femaleBody'])} weibliche Koerperteile",
        flush=True,
    )

    veroeffentlichen()
except BaseException:
    verwerfen()
    raise
