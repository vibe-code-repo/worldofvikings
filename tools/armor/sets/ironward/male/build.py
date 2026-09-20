"""Reproducible WoV replacement armor. Run with Blender's --python option.

All generated geometry is constructed in the source skeleton's REST coordinates.
Whole source slots supply the garment geometry and their existing weights.
Plates are rigidly weighted. No mesh segmentation or box fitting is involved.

Blender --factory-startup -b BODY_BASE_MALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/ironward/male/build.py -- OUTPUT_DIR [--quick]
Run with SOURCE.blend = WoV_BodyBase_Male.blend. armor_spec.json is read from the
directory of this script; everything generated is written to OUTPUT_DIR.
"""
import bpy, bmesh, json, math, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ARGS=sys.argv[sys.argv.index('--')+1:]
assert ARGS and not ARGS[0].startswith('--'), 'Expected OUTPUT_DIR after --'
ROOT=Path(ARGS[0]).resolve()
ROOT.mkdir(parents=True,exist_ok=True)
SPEC=json.loads((Path(__file__).resolve().parent/'armor_spec.json').read_text())
RENDERS=ROOT/'renders'
RENDERS.mkdir(exist_ok=True)
SLOTS=['Torso','Hips','ArmUpperLeft','ArmUpperRight','ArmLowerLeft','ArmLowerRight','LegLeft','LegRight','Head','HandLeft','HandRight']
rig=bpy.data.objects['WoV_Player_Armature']
scene=bpy.context.scene
base={s:bpy.data.objects['WoV_BodyBase_Male_'+s] for s in SLOTS}
pose={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
rig.data.pose_position='REST'
bpy.context.view_layer.update()
pieces={s:[] for s in SLOTS}
components=[]
materials={}
collection=bpy.data.collections.new('WoV_Ironward_Equipment')
scene.collection.children.link(collection)

for name,(r,g,b,metal,rough) in SPEC['materials'].items():
    mat=bpy.data.materials.new('Ironward_'+name)
    mat.diffuse_color=(r,g,b,1)
    mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(r,g,b,1)
    shader.inputs['Metallic'].default_value=metal
    shader.inputs['Roughness'].default_value=rough
    materials[name]=mat

def add_mesh(name,vs,fs,slot,material='steel',bone=None):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vs,[],fs); mesh.update()
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj)
    obj.data.materials.append(materials[material])
    if bone:
        vg=obj.vertex_groups.new(name=bone); vg.add(list(range(len(vs))),1.0,'REPLACE')
    pieces[slot].append(obj)
    components.append({'name':name,'slot':slot,'bone':bone,'vertices':len(vs)})
    return obj

def panel(name,outline,slot,bone,material='steel',ridge=0.009,trim=True,thickness=None):
    """Closed beveled plate; outline lies in 3D, front points towards -Y."""
    pts=[Vector(p) for p in outline]; n=len(pts)
    center=sum(pts,Vector())/n
    direction=-1 if ridge>=0 else 1
    inner=[center+(p-center)*0.92+Vector((0,direction*0.004,0)) for p in pts]
    thick=thickness or SPEC['plate_thickness_m']
    rear=[p+Vector((0,-direction*thick,0)) for p in pts]
    v=pts+inner+[center+Vector((0,-ridge,0))]+rear
    f=[]
    for i in range(n):
        j=(i+1)%n
        f.append((i,j,n+j,n+i))
        f.append((n+i,n+j,2*n))
        f.append((i,2*n+1+i,2*n+1+j,j))
    f.append(tuple(range(2*n+1,3*n+1)))
    obj=add_mesh(name,v,f,slot,material,bone)
    if trim:
        obj.data.materials.append(materials['edge'])
        for i in range(n): obj.data.polygons[3*i].material_index=1
    return obj

def tube(name,points,radii,slot,bone,material='steel',segments=10,thickness=.008):
    """Closed-wall polygonal sleeve, including inner wall and annular end rims."""
    points=[Vector(p) for p in points]
    axis=(points[-1]-points[0]).normalized()
    a=Vector((0,-1,0)); a=(a-axis*a.dot(axis)).normalized(); b=axis.cross(a).normalized()
    vs=[]; count=len(points)
    for inward in [False,True]:
        for p,(ra,rb) in zip(points,radii):
            if inward: ra=max(ra-thickness,.008); rb=max(rb-thickness,.008)
            for i in range(segments):
                theta=2*math.pi*i/segments
                vs.append(p+a*math.cos(theta)*ra+b*math.sin(theta)*rb)
    fs=[]; layer=count*segments
    for k in range(count-1):
        for i in range(segments):
            j=(i+1)%segments; q=k*segments
            fs.append((q+i,q+j,q+segments+j,q+segments+i))
            fs.append((layer+q+j,layer+q+i,layer+q+segments+i,layer+q+segments+j))
    for q in [0,(count-1)*segments]:
        for i in range(segments):
            j=(i+1)%segments
            fs.append((q+i,layer+q+i,layer+q+j,q+j))
    return add_mesh(name,vs,fs,slot,material,bone)

def bead(name,pos,radius,slot,bone):
    p=Vector(pos); r=radius
    vs=[p+Vector(d)*r for d in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]]
    fs=[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]
    return add_mesh(name,vs,fs,slot,'edge',bone)

# Full replacement garments retain the source's world matrices and skinning.
for slot,src in base.items():
    obj=src.copy(); obj.data=src.data.copy(); obj.name='Ironward_'+slot+'_lining'
    collection.objects.link(obj)
    world=obj.matrix_world.copy()
    obj.parent=None; obj.matrix_world=Matrix.Identity(4)
    for v in obj.data.vertices: v.co=world@v.co
    obj.modifiers.clear()
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.normal_update()
    for v in bm.verts: v.co+=v.normal*SPEC['garment_clearance_m']
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    obj.data.materials.clear(); obj.data.materials.append(materials['cloth' if slot not in ['LegLeft','LegRight'] else 'leather'])
    for p in obj.data.polygons: p.material_index=0; p.use_smooth=False
    pieces[slot].append(obj)

# Cuirass: breastplate, backplate, articulation lames, neck ring and heraldic insert.
panel('Breastplate',[
    (-.085,-.104,1.449),(.085,-.104,1.449),(.186,-.145,1.376),(.208,-.172,1.290),
    (.175,-.163,1.183),(0,-.182,1.115),(-.175,-.163,1.183),(-.208,-.172,1.290),(-.186,-.145,1.376)
], 'Torso','Spine_03',ridge=.052)
panel('Backplate',[
    (-.090,.176,1.432),(.090,.176,1.432),(.184,.185,1.374),(.196,.190,1.273),
    (.151,.176,1.153),(-.151,.176,1.153),(-.196,.190,1.273),(-.184,.185,1.374)
], 'Torso','Spine_03',ridge=-.025)
for i,(z,rx,ry) in enumerate([(1.104,.162,.140),(1.053,.157,.137),(.998,.159,.139)]):
    tube('Abdominal_lame_%d'%i,[(0,.012,z-.028),(0,.012,z+.028)],[(rx,ry),(rx-.003,ry-.003)],'Torso','Spine_01','dark_steel',12)
    tube('Abdominal_trim_%d'%i,[(0,.012,z-.028),(0,.012,z-.022)],[(rx+.001,ry+.001)]*2,'Torso','Spine_01','edge',12,thickness=.004)
tube('Gorget',[(0,.015,1.443),(0,.015,1.488)],[(.123,.098),(.102,.087)],'Torso','Spine_03','dark_steel',12)
tube('Gorget_rim',[(0,.015,1.480),(0,.015,1.490)],[(.105,.090)]*2,'Torso','Spine_03','edge',12,thickness=.004)
panel('Chest_teal_escutcheon',[(-.043,-.223,1.350),(.043,-.223,1.350),(.038,-.230,1.279),(0,-.237,1.246),(-.038,-.230,1.279)],'Torso','Spine_03','teal',ridge=.006)
panel('Chest_sigil',[(0,-.246,1.329),(.014,-.247,1.299),(0,-.248,1.271),(-.014,-.247,1.299)],'Torso','Spine_03','edge',ridge=.002,trim=False)
for x in [-.147,.147]:
    bead('Chest_rivet',(x,-.187,1.330),.006,'Torso','Spine_03')

# Waist and full trousers (original Hips slot includes both thighs).
tube('Leather_belt',[(0,.015,.901),(0,.015,.966)],[(.139,.185)]*2,'Hips','Hips','leather',12)
for z in [.906,.955]:
    tube('Belt_trim',[(0,.015,z),(0,.015,z+.008)],[(.144,.187)]*2,'Hips','Hips','edge',12,thickness=.004)
panel('Buckle',[(-.035,-.137,.947),(.035,-.137,.947),(.035,-.139,.907),(-.035,-.139,.907)],'Hips','Hips','edge',ridge=.003)
panel('Buckle_inlay',[(-.021,-.145,.937),(.021,-.145,.937),(.021,-.146,.918),(-.021,-.146,.918)],'Hips','Hips','dark_steel',ridge=.001,trim=False)
for side,suffix in [(1,'L'),(-1,'R')]:
    upper='UpperLeg_'+suffix
    x=side*.102
    panel('Tasset_'+suffix,[(x-side*.061,-.137,.885),(x+side*.065,-.136,.879),(x+side*.080,-.167,.735),(x,-.178,.697),(x-side*.055,-.168,.726)],'Hips',upper,ridge=.014)
    panel('Thigh_plate_'+suffix,[(x-.047,-.101,.696),(x+.047,-.101,.696),(x+.051,-.099,.506),(x,-.120,.476),(x-.051,-.099,.506)],'Hips',upper,'dark_steel',ridge=.018)
    # rear armor keeps the silhouette readable from all views.
    panel('Rear_tasset_'+suffix,[(x-.063,.146,.880),(x+.063,.146,.880),(x+.059,.157,.752),(x,.155,.718),(x-.059,.157,.752)],'Hips',upper,'dark_steel',ridge=-.01)

# Arms are built along actual rest joint positions (bone axes are not symmetric).
for side,suffix,word in [(1,'L','Left'),(-1,'R','Right')]:
    shoulder=Vector(rig.data.bones['Shoulder_'+suffix].head_local)
    elbow=Vector(rig.data.bones['Elbow_'+suffix].head_local)
    hand=Vector(rig.data.bones['Hand_'+suffix].head_local)
    upper_slot='ArmUpper'+word; lower_slot='ArmLower'+word
    upper_bone='Shoulder_'+suffix; lower_bone='Elbow_'+suffix
    axis=(elbow-shoulder).normalized()
    # Layered closed shoulder volumes, capped by the body-derived lining inside.
    for i,(start,end,rad) in enumerate([(.005,.104,.114),(.091,.160,.097),(.147,.199,.085)]):
        centers=[shoulder+axis*start,shoulder+axis*(start+.02),shoulder+axis*end]
        rr=[(rad*.87,rad*.87),(rad,rad),(rad*.86,rad*.85)]
        tube('Pauldron_%s_%d'%(suffix,i),centers,rr,upper_slot,upper_bone,'steel',10)
        tube('Pauldron_edge_%s_%d'%(suffix,i),[centers[-1]-axis*.007,centers[-1]],[(rad*.87,rad*.86)]*2,upper_slot,upper_bone,'edge',10,thickness=.004)
    tube('Rerebrace_'+suffix,[shoulder.lerp(elbow,.54),shoulder.lerp(elbow,.88)],[(.077,.071),(.069,.064)],upper_slot,upper_bone,'dark_steel')
    tube('Elbow_band_'+suffix,[elbow-axis*.029,elbow+axis*.017],[(.077,.068)]*2,upper_slot,upper_bone,'leather')
    fore=(hand-elbow).normalized()
    tube('Vambrace_'+suffix,[elbow.lerp(hand,.10),elbow.lerp(hand,.35),elbow.lerp(hand,.90)],[(.076,.068),(.079,.071),(.052,.050)],lower_slot,lower_bone,'steel')
    for t in [.12,.88]:
        p=elbow.lerp(hand,t); r=.076*(1-t)+.052*t+.003
        tube('Vambrace_rim_'+suffix,[p-fore*.006,p+fore*.006],[(r,r*.94)]*2,lower_slot,lower_bone,'edge',10,thickness=.004)
    # Vertical engraved ridge along the visible forearm front.
    p=elbow.lerp(hand,.25)+Vector((0,-.079,0)); q=elbow.lerp(hand,.78)+Vector((0,-.059,0))
    cross=Vector((-fore.z,0,fore.x))*.014
    panel('Vambrace_crest_'+suffix,[p+cross,p-cross,q-cross*.55,q+cross*.55],lower_slot,lower_bone,'dark_steel',ridge=.003)

# Slots named LegLeft / LegRight are opposite to the sign used by rig L/R.
for x,suffix,slot in [(-.113,'R','LegLeft'),(.113,'L','LegRight')]:
    bone='LowerLeg_'+suffix
    tube('Greave_'+suffix,[(x,.020,.090),(x,.020,.22),(x,.020,.354)],[(.091,.066),(.108,.078),(.098,.078)],slot,bone,'steel',10)
    tube('Knee_gasket_'+suffix,[(x,.035,.345),(x,.035,.425)],[(.115,.081)]*2,slot,bone,'leather',10)
    panel('Kneecap_'+suffix,[(x-.055,-.088,.437),(x+.055,-.088,.437),(x+.075,-.105,.397),(x,-.119,.347),(x-.075,-.105,.397)],slot,bone,ridge=.021)
    panel('Shin_ridge_'+suffix,[(x-.020,-.100,.338),(x+.020,-.100,.338),(x+.014,-.099,.140),(x,-.097,.115),(x-.014,-.099,.140)],slot,bone,'dark_steel',ridge=.012)
    for z,r in [(.128,.100),(.314,.105)]:
        tube('Greave_band_'+suffix,[(x,.020,z),(x,.020,z+.010)],[(r+.004,.083)]*2,slot,bone,'edge',10,thickness=.004)
    # Broad low boots and overlapping toe plates, bound to the original ankle.
    bootbone='Ankle_'+suffix
    for i,(front,back,top) in enumerate([(-.047,.122,.114),(-.112,-.024,.087),(-.175,-.090,.057)]):
        # bevel-like clipped plan footprint and raised center ridge
        w=.067
        outline=[(x-w*.78,front,top),(x+w*.78,front,top),(x+w,front+.014,top),(x+w,back-.008,top),(x+w*.72,back,top),(x-w*.72,back,top),(x-w,back-.008,top),(x-w,front+.014,top)]
        verts=[Vector(p) for p in outline]+[Vector((p[0],p[1],.003)) for p in outline]
        faces=[tuple(range(8)),tuple(range(8,16))]+[(k,(k+1)%8,(k+1)%8+8,k+8) for k in range(8)]
        obj=add_mesh('Sabaton_%s_%d'%(suffix,i),verts,faces,slot,'dark_steel' if i==0 else 'steel',bootbone)

# Helmet: the source head is weighted to Neck, not Head. Follow the source
# contract so the hood and rigid shell move together without changing the rig.
helmet_bone='Neck'
def octagon(w,d,z):
    return [(-w*.68,-d,z),(w*.68,-d,z),(w,-d*.62,z),(w,d*.60,z),(w*.65,d,z),(-w*.65,d,z),(-w,d*.60,z),(-w,-d*.62,z)]
rings=[octagon(.146,.149,1.515),octagon(.151,.159,1.660),octagon(.148,.150,1.745),octagon(.108,.112,1.807),octagon(.050,.069,1.826)]
vs=[v for ring in rings for v in ring]; fs=[]
for level in range(len(rings)-1):
    for k in range(8):
        if level==0 and k==0: continue # real front opening for the visor
        fs.append((level*8+k,level*8+(k+1)%8,(level+1)*8+(k+1)%8,(level+1)*8+k))
fs.append(tuple(range(32,40)))
shell=add_mesh('Helm_faceted_shell',vs,fs,'Head','steel',helmet_bone)
bpy.context.view_layer.objects.active=shell
solid=shell.modifiers.new('Shell_thickness','SOLIDIFY'); solid.thickness=.007; solid.offset=-1
bpy.ops.object.modifier_apply(modifier=solid.name)
panel('Helm_brow',[(-.105,-.166,1.676),(.105,-.166,1.676),(.107,-.170,1.660),(-.107,-.170,1.660)],'Head',helmet_bone,'edge',ridge=.003,trim=False)
panel('Helm_visor_shadow',[(-.105,-.157,1.660),(.105,-.157,1.660),(.101,-.160,1.627),(-.101,-.160,1.627)],'Head',helmet_bone,'cloth',ridge=.001,trim=False)
panel('Helm_faceplate',[(-.107,-.171,1.627),(.107,-.171,1.627),(.112,-.164,1.568),(.074,-.156,1.512),(0,-.173,1.497),(-.074,-.156,1.512),(-.112,-.164,1.568)],'Head',helmet_bone,'steel',ridge=.025)
panel('Helm_nasal',[(0,-.185,1.694),(.012,-.186,1.675),(.010,-.203,1.589),(0,-.205,1.575),(-.010,-.203,1.589),(-.012,-.186,1.675)],'Head',helmet_bone,'edge',ridge=.003,trim=False)
for sign in [-1,1]:
    for i in range(3):
        x=sign*(.037+i*.021)
        panel('Helm_vent',[(x-.004,-.199,1.581),(x+.004,-.199,1.581),(x+.004,-.199,1.554),(x-.004,-.199,1.554)],'Head',helmet_bone,'cloth',ridge=.001,trim=False,thickness=.002)
    bead('Helm_visor_rivet',(sign*.105,-.174,1.632),.007,'Head',helmet_bone)
panel('Helm_forehead_badge',[(0,-.163,1.741),(.024,-.170,1.716),(0,-.180,1.686),(-.024,-.170,1.716)],'Head',helmet_bone,'teal',ridge=.003)

# Gauntlets: whole hand lining preserves all source finger weights. Plates are
# derived from each source finger group, not from the mirrored bone tail axes.
hand_surfaces={}
def dorsal_plate(name,outline,slot,bone,material='steel',trim=True):
    # panel() faces -Y; rotate its construction to the back of the hand (+Z).
    mapped=[(p[0],-p[2],p[1]) for p in outline]
    obj=panel(name,mapped,slot,bone,material,ridge=.004,trim=trim,thickness=.004)
    for v in obj.data.vertices:
        x,y,z=v.co; v.co=(x,z,-y)
    if slot not in hand_surfaces:
        src=base[slot]
        hand_surfaces[slot]=BVHTree.FromPolygons([src.matrix_world@v.co for v in src.data.vertices],[list(p.vertices) for p in src.data.polygons])
    tree=hand_surfaces[slot]
    center=sum((Vector(p) for p in outline),Vector())/len(outline)
    # Project to the actual dorsal surface; preserve plate thickness and ridge.
    for v in obj.data.vertices:
        original=v.co.copy(); sample=v.co.copy()
        hit=None
        for attempt in range(9):
            hit,normal,index,distance=tree.ray_cast(Vector((sample.x,sample.y,2)),Vector((0,0,-1)))
            if hit is not None: break
            sample=sample.lerp(center,.18)
        if hit is not None:
            v.co=(sample.x,sample.y,hit.z+.008+(original.z-center.z))
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(obj.data); bm.free()
    return obj
for sign,suffix,word in [(1,'L','Left'),(-1,'R','Right')]:
    slot='Hand'+word; bone='Hand_'+suffix
    wrist=Vector(rig.data.bones[bone].head_local)
    tube('Gauntlet_cuff_'+suffix,[wrist+Vector((-sign*.015,0,0)),wrist+Vector((sign*.030,0,0))],[(.050,.041),(.054,.044)],slot,bone,'dark_steel',10,thickness=.005)
    tube('Gauntlet_cuff_trim_'+suffix,[wrist+Vector((sign*.023,0,0)),wrist+Vector((sign*.032,0,0))],[(.055,.045)]*2,slot,bone,'edge',10,thickness=.003)
    dorsal_plate('Gauntlet_handplate_'+suffix,[(sign*.824,-.016,1.398),(sign*.872,-.021,1.402),(sign*.906,.008,1.399),(sign*.900,.080,1.397),(sign*.850,.087,1.393),(sign*.824,.066,1.391)],slot,bone)
    src=base[slot]
    for group in src.vertex_groups:
        if not any(t in group.name for t in ['Finger_','Thumb_']): continue
        pts=[src.matrix_world@v.co for v in src.data.vertices if any(g.group==group.index and g.weight>.4 for g in v.groups)]
        if len(pts)<3: continue
        # Conservatively smaller than the full segment footprint; the flexible
        # glove remains visible between plates and at the fingertips.
        lo=[min(p[i] for p in pts) for i in range(3)]; hi=[max(p[i] for p in pts) for i in range(3)]
        a=lo[0]+.004; b=hi[0]-.004; c=lo[1]+.004; d=hi[1]-.004; z=hi[2]+.008
        if b-a<.006 or d-c<.006: continue
        cut=min(.007,(b-a)*.2,(d-c)*.2)
        outline=[(a+cut,c,z),(b-cut,c,z),(b,c+cut,z),(b,d-cut,z),(b-cut,d,z),(a+cut,d,z),(a,d-cut,z),(a,c+cut,z)]
        dorsal_plate('Gauntlet_'+group.name,outline,slot,group.name,'steel',trim=False)
    for y in [.008,.063]:
        hit,_,_,_=hand_surfaces[slot].ray_cast(Vector((sign*.884,y,2)),Vector((0,0,-1)))
        bead('Gauntlet_knuckle_rivet_'+suffix,(sign*.884,y,hit.z+.011),.0045,slot,bone)

# Assemble one swappable weighted object per source body slot.
armor={}
for slot,objects in pieces.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object; obj.name='WoV_Ironward_'+slot
    obj['equipment_slot']=slot; obj['replaces']=base[slot].name
    obj['contains_complete_garment']=True
    world=obj.matrix_world.copy(); obj.parent=rig; obj.matrix_world=world
    mod=obj.modifiers.new('WoV_Skin','ARMATURE'); mod.object=rig
    armor[slot]=obj

rig.data.pose_position='POSE'; bpy.context.view_layer.update()

def visible_slots(active):
    for slot in SLOTS:
        equipped=slot in active
        base[slot].hide_render=equipped; base[slot].hide_set(equipped)
        armor[slot].hide_render=not equipped; armor[slot].hide_set(not equipped)
    bpy.context.view_layer.update()

def target(obj,p): obj.rotation_euler=(Vector(p)-obj.location).to_track_quat('-Z','Y').to_euler()

# Separate studio collection is excluded from game exports.
studio=bpy.data.collections.new('Preview_Studio'); scene.collection.children.link(studio)
for obj in list(scene.objects):
    if obj.type in ['LIGHT','CAMERA']: bpy.data.objects.remove(obj,do_unlink=True)
cam=bpy.data.objects.new('Preview_Camera',bpy.data.cameras.new('Preview_Camera')); studio.objects.link(cam)
cam.data.type='ORTHO'; cam.data.ortho_scale=2.04; scene.camera=cam
def camera(view='hero'):
    cam.location={'hero':(2.25,-5.7,2.38),'front':(0,-6,1.45),'back':(-2.3,5.7,2.25)}[view]
    target(cam,(0,0,.92))
camera()
for name,loc,energy,size,color in [('Key',(-3,-4,5),380,4,(1,.91,.80)),('Fill',(3,-1,3),220,3,(.70,.83,1)),('Rim',(0,3,4),480,3,(.78,.87,1))]:
    ld=bpy.data.lights.new(name,'AREA'); ld.energy=energy; ld.shape='DISK'; ld.size=size; ld.color=color
    lo=bpy.data.objects.new(name,ld); studio.objects.link(lo); lo.location=loc; target(lo,(0,0,1))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012))
floor=bpy.context.object; floor.name='Preview_Ground'
for c in list(floor.users_collection): c.objects.unlink(floor)
studio.objects.link(floor)
floor_mat=bpy.data.materials.new('Preview_Ground'); floor_mat.diffuse_color=(.083,.102,.129,1); floor_mat.use_nodes=True
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.083,.102,.129,1)
floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.95
floor.data.materials.append(floor_mat)
scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.20,.27,1); scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1200; scene.render.resolution_y=1200; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGB'
scene.view_settings.view_transform='AgX'; scene.view_settings.look='AgX - Medium High Contrast'

def render(name):
    scene.render.filepath=str(RENDERS/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('RENDER',name,flush=True)

def validate_geometry():
    report={'source':SPEC['source_blend'],'design':SPEC['name'],'slots':{},'checks':{}}
    for slot,obj in armor.items():
        obj.data.calc_loop_triangles()
        bm=bmesh.new(); bm.from_mesh(obj.data)
        zero=sum(1 for f in bm.faces if f.calc_area()<1e-12)
        unweighted=sum(1 for v in obj.data.vertices if sum(g.weight for g in v.groups)<.99)
        invalid=sum(1 for v in obj.data.vertices if not all(math.isfinite(k) for k in v.co))
        report['slots'][slot]={'triangles':len(obj.data.loop_triangles),'vertices':len(obj.data.vertices),'unweighted_vertices':unweighted,'nonfinite_vertices':invalid,'zero_area_faces':zero,'boundary_edges':sum(e.is_boundary for e in bm.edges),'replaces':base[slot].name}
        bm.free()
        assert unweighted==0 and invalid==0 and zero==0,(slot,unweighted,invalid,zero)
    total=sum(s['triangles'] for s in report['slots'].values())
    report['total_armor_triangles']=total
    assert total<=SPEC['target_max_triangles_armor'],total
    return report

visible_slots(SLOTS)
report=validate_geometry()
# Store native scene before exports/renders for immediate review and recovery.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'WoV_Ironward_Armor.blend'))
render('01_Ironward_Hero')
camera('front'); render('02_Ironward_Front')
camera('back'); render('03_Ironward_Back')
camera('hero')
if '--quick' not in sys.argv:
    for i,slot in enumerate(SLOTS):
        visible_slots([slot]); render('%02d_%s'%(10+i,slot))
    visible_slots([]); render('00_Body_Reference')
    visible_slots(SLOTS)
    cam.data.ortho_scale=.55; cam.location=(.66,-1.9,1.89); target(cam,(0,0,1.65))
    render('30_Helmet_Detail')
    bpy.context.view_layer.update()
    dg=bpy.context.evaluated_depsgraph_get()
    hand_obj=armor['HandLeft'].evaluated_get(dg); hand_me=hand_obj.to_mesh()
    hand_center=sum((hand_obj.matrix_world@v.co for v in hand_me.vertices),Vector())/len(hand_me.vertices)
    hand_obj.to_mesh_clear()
    cam.data.ortho_scale=.39; cam.location=hand_center+Vector((.10,-.55,.53)); target(cam,hand_center)
    render('31_Gauntlet_Detail')
    cam.data.ortho_scale=2.04; camera('hero')

# Automated joint perturbation checks. These are bounded diagnostic poses, not
# a claim of collision-free movement in every possible gameplay animation.
visible_slots(SLOTS)
pose_tests=[('Elbows',{'Elbow_L':(.0,.0,.65),'Elbow_R':(.0,.0,-.65)}),('Stride',{'UpperLeg_L':(.32,0,0),'UpperLeg_R':(-.32,0,0),'LowerLeg_L':(.48,0,0)}),('TorsoTurn',{'Spine_02':(0,.30,0),'Spine_03':(0,.15,0)})]
pose_tests.append(('HeadTurn',{'Neck':(0,.38,0)}))
pose_tests.append(('Fingers',{'Finger_01':(0,0,-.35),'Finger_02':(0,0,-.30),'IndexFinger_01':(0,0,-.30),'Thumb_01':(.18,0,0),'Hand_L':(.20,0,0)}))
report['pose_checks']=[]
for test,changes in pose_tests:
    for b in rig.pose.bones: b.matrix_basis=pose[b.name]
    for name,angles in changes.items():
        rot=Matrix.Identity(4)
        for angle,axis in zip(angles,'XYZ'): rot=rot@Matrix.Rotation(angle,4,axis)
        rig.pose.bones[name].matrix_basis=pose[name]@rot
    bpy.context.view_layer.update(); dg=bpy.context.evaluated_depsgraph_get()
    finite=True; bounds=[]
    for obj in armor.values():
        ev=obj.evaluated_get(dg); mesh=ev.to_mesh()
        ps=[ev.matrix_world@v.co for v in mesh.vertices]
        finite &= all(all(math.isfinite(c) for c in p) for p in ps)
        bounds.extend(ps); ev.to_mesh_clear()
    span=[max(p[i] for p in bounds)-min(p[i] for p in bounds) for i in range(3)]
    assert finite and max(span)<3.0,(test,span)
    report['pose_checks'].append({'name':test,'finite':finite,'world_span_m':span,'collision_certified':False})
    if '--quick' not in sys.argv:
        render('20_Pose_'+test)
        if test=='Fingers':
            cam.data.ortho_scale=.42; cam.location=hand_center+Vector((.10,-.55,.53)); target(cam,hand_center)
            render('32_Gauntlet_FingerPose')
            cam.data.ortho_scale=2.04; camera('hero')
for b in rig.pose.bones: b.matrix_basis=pose[b.name]
bpy.context.view_layer.update()

# GLB exports deliberately select only the rig and intended render meshes.
def export(name,objects):
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False); rig.select_set(True)
    for o in objects: o.hide_set(False); o.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(ROOT/name),export_format='GLB',use_selection=True,export_animations=False,export_skins=True,export_extras=True)
retained=[] # Head and both hands are now replacement slots too.
export('WoV_Ironward_Equipped.glb',list(armor.values())+retained)
export('WoV_Ironward_ArmorOnly.glb',list(armor.values()))
export('WoV_Ironward_Helmet.glb',[armor['Head']])
export('WoV_Ironward_Gauntlets.glb',[armor['HandLeft'],armor['HandRight']])
visible_slots(SLOTS)
camera('hero')
report['checks']['complete_source_garment_retained_per_slot']=True
report['checks']['source_blend_overwritten']=False
report['checks']['pose_collision_scan']='not yet implemented; inspect diagnostic renders'
(ROOT/'validation.json').write_text(json.dumps(report,indent=2))
(ROOT/'components.json').write_text(json.dumps(components,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'WoV_Ironward_Armor.blend'))
print('DONE',report['total_armor_triangles'],flush=True)
