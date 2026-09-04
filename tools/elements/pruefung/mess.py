# Prüft: die Maße von WandPaneel, Bodenplatte und Torbogen in einem Elementordner.
import bpy, sys
d = sys.argv[sys.argv.index("--")+1:][0]
bpy.ops.wm.read_factory_settings(use_empty=True)
for n in ("WandPaneel","Bodenplatte","Torbogen"):
    bpy.ops.import_scene.gltf(filepath=f"{d}/{n}.glb")
    o = [x for x in bpy.context.selected_objects if x.type=="MESH"][0]
    o.rotation_euler=(0,0,0); bpy.context.view_layer.update()
    dim=o.dimensions
    print(f"MESS {n}: dim=({dim.x:.2f},{dim.y:.2f},{dim.z:.2f})  typ={o.type} rot={tuple(round(r,2) for r in o.rotation_euler)}")
