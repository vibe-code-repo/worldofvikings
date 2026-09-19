"""Load generated .blend, replace the character with exported GLB, verify/render.

Blender -b OUTPUT_DIR/WoV_Ironward_Armor.blend --python-exit-code 1 \\
        --python tools/armor/sets/ironward/male/check_roundtrip.py -- OUTPUT_DIR
OUTPUT_DIR is the directory build.py wrote to; it must contain WoV_Ironward_Equipped.glb.
"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector

root=Path(sys.argv[sys.argv.index('--')+1]).resolve()
scene=bpy.context.scene
for obj in list(scene.objects):
    if obj.type=='ARMATURE' or (obj.type=='MESH' and obj.name!='Preview_Ground'):
        bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(root/'WoV_Ironward_Equipped.glb'))
meshes=[o for o in scene.objects if o.type=='MESH' and o.name.startswith('WoV_')]
rigs=[o for o in scene.objects if o.type=='ARMATURE']
assert len(meshes)==11,[(o.name,len(o.data.vertices)) for o in meshes]
assert len(rigs)==1,len(rigs)
assert all(any(m.type=='ARMATURE' and m.object==rigs[0] for m in o.modifiers) for o in meshes)
dg=bpy.context.evaluated_depsgraph_get()
points=[]
triangles=0
for obj in meshes:
    ev=obj.evaluated_get(dg); me=ev.to_mesh(); me.calc_loop_triangles()
    points.extend(ev.matrix_world@v.co for v in me.vertices)
    triangles+=len(me.loop_triangles); ev.to_mesh_clear()
assert all(all(math.isfinite(c) for c in p) for p in points)
report={'meshes':len(meshes),'rigs':len(rigs),'bones':len(rigs[0].data.bones),'triangles_equipped':triangles,'bounds_min':[min(p[i] for p in points) for i in range(3)],'bounds_max':[max(p[i] for p in points) for i in range(3)],'mesh_names':[o.name for o in meshes],'all_meshes_skinned':True}
(root/'roundtrip_validation.json').write_text(json.dumps(report,indent=2))
scene.render.filepath=str(root/'renders/04_Export_Roundtrip.png')
bpy.ops.render.render(write_still=True)
print(json.dumps(report),flush=True)
