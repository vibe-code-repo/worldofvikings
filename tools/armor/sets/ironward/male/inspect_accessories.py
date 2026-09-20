"""Print head, neck and hand bones and the male body's head/hand vertex groups (read-only).

Blender -b BODY_BASE_MALE.blend --python tools/armor/sets/ironward/male/inspect_accessories.py
"""
import bpy,json
rig=bpy.data.objects['WoV_Player_Armature']; rig.data.pose_position='REST'
bpy.context.view_layer.update()
for b in rig.data.bones:
    if any(s in b.name.lower() for s in ['head','neck','hand','finger','thumb','index','middle','ring','pinky']):
        print('BONE',b.name,list(b.head_local),list(b.tail_local))
for name in ['Head','HandLeft','HandRight']:
    o=bpy.data.objects['WoV_BodyBase_Male_'+name]
    pts=[o.matrix_world@v.co for v in o.data.vertices]
    print('BOUNDS',name,[min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)])
    for g in o.vertex_groups:
        vv=[o.matrix_world@v.co for v in o.data.vertices if any(x.group==g.index and x.weight>.4 for x in v.groups)]
        if vv: print('GROUP',g.name,len(vv),[round(min(p[i] for p in vv),4) for i in range(3)],[round(max(p[i] for p in vv),4) for i in range(3)])
