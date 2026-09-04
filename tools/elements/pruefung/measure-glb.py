# Prüft: Hüllbox und Ursprung aller Objekte eines GLB (headless).
# Misst Bounding-Box und Ursprung aller Objekte eines GLB (headless).
# flatpak run org.blender.Blender --factory-startup -b --python measure-glb.py -- <a.glb> [<b.glb> ...]
import bpy, sys
from mathutils import Vector

pfade = sys.argv[sys.argv.index("--") + 1:]
for pfad in pfade:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=pfad)
    print(f"=== {pfad}")
    gmin = Vector((1e9,)*3); gmax = Vector((-1e9,)*3)
    for o in bpy.data.objects:
        print(f"  OBJ {o.name} type={o.type} loc={tuple(round(v,4) for v in o.location)} "
              f"rot={tuple(round(v,4) for v in o.rotation_euler)} scale={tuple(round(v,4) for v in o.scale)} "
              f"parent={o.parent.name if o.parent else None}")
        if o.type != "MESH":
            continue
        mats = [m.name if m else None for m in o.data.materials]
        print(f"      verts={len(o.data.vertices)} faces={len(o.data.polygons)} mats={mats}")
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                gmin[i] = min(gmin[i], w[i]); gmax[i] = max(gmax[i], w[i])
    # Blender ist Z-up; glTF-Import wandelt Y-up -> Z-up: glTF y = Blender z, glTF z = -Blender y
    print(f"  BLENDER-BBOX min={tuple(round(v,4) for v in gmin)} max={tuple(round(v,4) for v in gmax)}")
    print(f"  GLTF-BBOX (Y-up) x=[{gmin.x:.4f},{gmax.x:.4f}] y=[{gmin.z:.4f},{gmax.z:.4f}] z=[{-gmax.y:.4f},{-gmin.y:.4f}]")
