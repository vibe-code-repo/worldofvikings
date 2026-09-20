"""Fit Seidraven ornaments and exact replacement lining to the shipped female rig.

Blender -b Female/WoV_Seidraven_Armor.blend --python THIS -- body.glb OUTPUT
(Female/WoV_Seidraven_Armor.blend is the output of female/build.py.)
Source bodies/armor stay read-only. The legacy body keeps its original skin.
"""
import bpy
import bmesh
import json
import math
import sys
from pathlib import Path
from mathutils import Vector, Matrix

body_path, destination = sys.argv[sys.argv.index('--')+1:][:2]
root = Path(destination); root.mkdir(parents=True,exist_ok=True)
renders = root/'renders'; renders.mkdir(exist_ok=True)
scene=bpy.context.scene
source_rig=bpy.data.objects['WoV_Player_Armature']
source_rig.data.pose_position='REST'
source={o.name.removeprefix('WoV_Seidraven_'):o for o in scene.objects if o.type=='MESH' and o.name.startswith('WoV_Seidraven_')}
source_base={s:bpy.data.objects['WoV_BodyBase_Female_'+s] for s in source}
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=body_path)
imported=set(bpy.data.objects)-before
rig=next(o for o in imported if o.type=='ARMATURE')
body=next(o for o in imported if o.type=='MESH' and len(o.data.vertices)>1000)
rig.data.pose_position='REST'
if rig.animation_data: rig.animation_data.action=None
for track in rig.animation_data.nla_tracks: track.mute=True
bpy.context.view_layer.update()
assert rig.matrix_world == Matrix.Identity(4)

def region(bone):
    if bone.startswith(('L_Index','L_Ring','L_Thumb')) or bone=='L_Hand': return 'HandLeft'
    if bone.startswith(('R_Index','R_Ring','R_Thumb')) or bone=='R_Hand': return 'HandRight'
    for side,word in [('L','Left'),('R','Right')]:
        if bone==side+'_Upperarm': return 'ArmUpper'+word
        if bone==side+'_Forearm': return 'ArmLower'+word
        if bone.startswith(tuple(side+'_'+s for s in ['Calf','Foot','Toe'])): return 'Leg'+word
    if bone in ['Head','Head_End','NeckTwist01']: return 'Head'
    if bone in ['Waist','Spine01','Spine02','L_Clavicle','R_Clavicle']: return 'Torso'
    return 'Hips'

groups={g.index:g.name for g in body.vertex_groups}
body.data.calc_loop_triangles()
triangles={s:[] for s in source}
for tri in body.data.loop_triangles:
    scores={}
    for i in tri.vertices:
        for g in body.data.vertices[i].groups:
            key=region(groups[g.group]);scores[key]=scores.get(key,0)+g.weight
    winner=sorted(scores,key=lambda s:(-math.floor(scores[s]*1e6+.5),s))[0]
    triangles[winner].append(tuple(tri.vertices))

mapping={'Root':'Root','Hips':'Pelvis','Spine_01':'Waist','Spine_02':'Spine01','Spine_03':'Spine02','Neck':'Head','Head':'Head'}
ends={'Hips':'Spine_01','Spine_01':'Spine_02','Spine_02':'Spine_03','Spine_03':'Neck'}
target_ends={'Pelvis':'Waist','Waist':'Spine01','Spine01':'Spine02','Spine02':'NeckTwist01'}
for side in ['L','R']:
    for old,new,end,new_end in [('Shoulder','Upperarm','Elbow','Forearm'),('Elbow','Forearm','Hand','Hand'),
                                ('UpperLeg','Thigh','LowerLeg','Calf'),('LowerLeg','Calf','Ankle','Foot'),
                                ('Ankle','Foot','Toes','Toe_End'),('Ball','ToeBase','Toes','Toe_End')]:
        mapping[old+'_'+side]=side+'_'+new
        ends[old+'_'+side]=end+'_'+side;target_ends[side+'_'+new]=side+'_'+new_end
    mapping['Hand_'+side]=side+'_Hand';ends['Hand_'+side]='IndexFinger_01'+(' 1' if side=='R' else '')
    target_ends[side+'_Hand']=side+'_Index01'
    mapping['Clavicle_'+side]=side+'_Clavicle'
    mapping['Shoulder_Attachment_'+side]=side+'_Clavicle'
    for old,new,count in [('Finger','Ring',4),('IndexFinger','Index',4),('Thumb','Thumb',3)]:
        for i in range(1,count+1):
            name=old+'_%02d'%i+(' 1' if side=='R' else '')
            target=side+'_'+new+('%02d'%i if i<4 else '_End')
            mapping[name]=target

def point(r,name): return r.matrix_world@r.data.bones[name].head_local
def frame(head,tail):
    axis=(tail-head).normalized(); front=Vector((0,-1,0))
    if abs(front.dot(axis))>.96: front=Vector((0,0,1))
    front=(front-axis*front.dot(axis)).normalized(); cross=front.cross(axis).normalized()
    m=Matrix((cross,front,axis)).transposed().to_4x4();m.translation=head
    return m

transforms={}
for name,target in mapping.items():
    if name not in source_rig.data.bones or target not in rig.data.bones: continue
    if name in ['Head','Neck']:
        sh=point(source_rig,'Head');th=point(rig,'Head')
        transforms[name]=Matrix.Translation(th)@Matrix.Diagonal((.53,.53,.53,1))@Matrix.Translation(-sh)
    elif name.startswith(('Shoulder_Attachment','Clavicle')):
        side=name[-1];sh=point(source_rig,'Shoulder_'+side);th=point(rig,side+'_Upperarm')
        transforms[name]=Matrix.Translation(th)@Matrix.Diagonal((.56,.55,.55,1))@Matrix.Translation(-sh)
    else:
        sh=point(source_rig,name);th=point(rig,target)
        st=point(source_rig,ends[name]) if name in ends else source_rig.data.bones[name].tail_local
        tt=point(rig,target_ends[target]) if target in target_ends else rig.data.bones[target].tail_local
        length=(tt-th).length/max((st-sh).length,.001)
        width=.60 if name.startswith(('Hips','UpperLeg','LowerLeg','Ankle','Ball')) else .50
        if name.startswith(('Finger','IndexFinger','Thumb','Hand')): width=.60
        transforms[name]=frame(th,tt)@Matrix.Diagonal((width,width,min(1.2,max(.25,length)),1))@frame(sh,st).inverted()

armor={};report={'targetBody':body_path,'bodyVariant':'female','bodyProfile':'legacy-female-v1','parts':{},'sourceOverwritten':False}
for slot,original in source.items():
    # The builder joins the welded lining first; remove it before fitting ornaments.
    bm=bmesh.new();bm.from_mesh(source_base[slot].data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    lining_count=len(bm.verts);bm.free()
    ornament=original.copy();ornament.data=original.data.copy();scene.collection.objects.link(ornament)
    ornament.modifiers.clear();ornament.parent=None;ornament.matrix_world=Matrix.Identity(4)
    bm=bmesh.new();bm.from_mesh(ornament.data);bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=list(bm.verts)[:lining_count],context='VERTS')
    bm.to_mesh(ornament.data);bm.free()
    old_names={g.index:g.name for g in ornament.vertex_groups}
    weights=[]
    for v in ornament.data.vertices:
        ws=[(old_names[g.group],g.weight) for g in v.groups if g.weight>1e-7]
        assert all(n in transforms for n,w in ws),ws
        v.co=sum(((transforms[n]@v.co)*w for n,w in ws),Vector())/sum(w for n,w in ws)
        combined={}
        for n,w in ws: combined[mapping[n]]=combined.get(mapping[n],0)+w
        weights.append(combined)
    ornament.vertex_groups.clear()
    for i,ws in enumerate(weights):
        for n,w in ws.items():
            g=ornament.vertex_groups.get(n) or ornament.vertex_groups.new(name=n);g.add([i],w,'REPLACE')
    # Exact legacy surface partition: matches runtime triangle masking by bone weights.
    faces=triangles[slot];used=sorted({i for f in faces for i in f});remap={v:i for i,v in enumerate(used)}
    data=bpy.data.meshes.new('Legacy_lining_'+slot)
    data.from_pydata([body.matrix_world@body.data.vertices[i].co for i in used],[],[tuple(remap[i] for i in f) for f in faces]);data.update()
    obj=bpy.data.objects.new('Legacy_lining_'+slot,data);scene.collection.objects.link(obj)
    material='black' if slot=='Head' else ('leather' if slot.startswith(('Hand','Leg')) else 'cloth')
    data.materials.append(bpy.data.materials['Seidraven_'+material])
    for i,index in enumerate(used):
        for g in body.data.vertices[index].groups:
            name=groups[g.group];vg=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name);vg.add([i],g.weight,'REPLACE')
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);ornament.select_set(True)
    bpy.context.view_layer.objects.active=obj;bpy.ops.object.join()
    obj.name='WoV_SeidravenLegacy_'+slot;obj.parent=rig;obj.matrix_world=Matrix.Identity(4)
    mod=obj.modifiers.new('Exact_legacy_skin','ARMATURE');mod.object=rig
    obj['replaces']=slot;obj['bodyProfile']='legacy-female-v1';armor[slot]=obj
    data=obj.data;data.calc_loop_triangles()
    report['parts'][slot]={'triangles':len(data.loop_triangles),'liningTriangles':len(faces),'vertices':len(data.vertices)}
    assert all(abs(sum(g.weight for g in v.groups)-1)<.001 for v in data.vertices)
    assert all(all(math.isfinite(c) for c in v.co) for v in data.vertices)

for obj in scene.objects:
    if obj.type=='MESH': obj.hide_render=obj not in armor.values() and obj.name!='Preview_Ground'
rig.data.pose_position='POSE'
actions=[a for a in bpy.data.actions if a.name in ['idle','gehen','rennen','springen','weitsprung','angriff']]
assert len(actions)==6,[a.name for a in bpy.data.actions]
def activate(action,frame):
    rig.animation_data.action=action
    if action.slots: rig.animation_data.action_slot=action.slots[0]
    for b in rig.pose.bones: b.matrix_basis=Matrix.Identity(4)
    scene.frame_set(frame);bpy.context.view_layer.update()

cam=scene.camera;cam.data.ortho_scale=1.56;cam.location=(1.1,-4,1.5)
cam.rotation_euler=(Vector((0,0,.59))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_x=scene.render.resolution_y=1400
scene.render.resolution_percentage=100
report['animations']=[]
for action in actions:
    first,last=map(int,action.frame_range);max_span=0
    for frame_number in range(first,last+1):
        activate(action,frame_number)
        graph=bpy.context.evaluated_depsgraph_get();points=[]
        for obj in armor.values():
            evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
            points.extend(evaluated.matrix_world@v.co for v in mesh.vertices);evaluated.to_mesh_clear()
        assert all(all(math.isfinite(c) for c in p) for p in points)
        span=max(max(p[a] for p in points)-min(p[a] for p in points) for a in range(3))
        assert span<2.5,(action.name,frame_number,span)
        max_span=max(max_span,span)
    report['animations'].append({'name':action.name,'frames':last-first+1,'finite':True,'maxSpan':max_span})
    activate(action,(first+last)//2)
    offset=rig.pose.bones['Pelvis'].head-point(rig,'Pelvis')
    cam.location=Vector((1.1,-4,1.5))+offset
    cam.rotation_euler=(Vector((0,0,.59))+offset-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(renders/(action.name+'.png'));bpy.ops.render.render(write_still=True)
    print('CLIP',action.name,flush=True)
idle=next(a for a in actions if a.name=='idle');activate(idle,int(idle.frame_range[0]))
offset=rig.pose.bones['Pelvis'].head-point(rig,'Pelvis')
cam.location=Vector((1.1,-4,1.5))+offset
cam.rotation_euler=(Vector((0,0,.59))+offset-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(renders/'Seidraven_Legacy_Female_Hero.png');bpy.ops.render.render(write_still=True)
equipment=json.loads((Path(bpy.data.filepath).parent/'equipment.json').read_text())
equipment.update({'prefix':'WoV_SeidravenLegacy_','bodyVariant':'female','bodyProfile':'legacy-female-v1','figure':'wikingerin'})
for part in equipment['parts']: part.update({'bodyVariant':'female','bodyProfile':'legacy-female-v1','figure':'wikingerin'})
def export(path,objects):
    bpy.ops.object.select_all(action='DESELECT');rig.hide_set(False);rig.select_set(True)
    for obj in objects: obj.hide_set(False);obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(root/path),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_extras=True)
export('WoV_Seidraven_Legacy_Female.glb',list(armor.values()))
for part in equipment['parts']: export(part['item']+'.glb',[armor[s] for s in part['regions']])
bpy.ops.wm.save_as_mainfile(filepath=str(root/'WoV_Seidraven_Legacy_Female.blend'))
report['totalTriangles']=sum(p['triangles'] for p in report['parts'].values())
report['collisionCertified']=False
(root/'fit-validation.json').write_text(json.dumps(report,indent=2)+'\n')
(root/'equipment.json').write_text(json.dumps(equipment,indent=2)+'\n')
print('DONE',report['totalTriangles'],flush=True)
