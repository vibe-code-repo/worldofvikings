"""Build original Emberrage replacement armor; reuse the proven fitting/export scaffold.

Blender -b WoV_BodyBase_{Male,Female}.blend --python THIS -- OUTPUT [--female] [--quick]
Only the common initialization/helpers and final validation/export sections are reused.
The Seidraven design section is never executed. Markers are asserted to fail closed.
"""
from pathlib import Path

scaffold = Path(__file__).with_name('build-seidraven-armor.py').read_text()
start = '# New geometry inspired by the supplied silhouette'
end = '# Join each replacement region and bind every component'
assert scaffold.count(start) == scaffold.count(end) == 1
scaffold = scaffold.replace('Seidraven', 'Emberrage').replace('seidraven', 'emberrage')
exec(compile(scaffold.split(start)[0], 'armor-common-initialization', 'exec'))

# Distinct charcoal steel, oxblood wool and red/orange hot fracture palette.
colors = {'cloth':(.13,.006,.012), 'leather':(.024,.009,.009),
          'plate':(.023,.030,.039), 'metal':(.080,.088,.102),
          'edge':(.22,.23,.25), 'gold':(.17,.065,.025), 'black':(.003,.004,.007),
          'red':(.85,.003,.008), 'eyes':(1,.016,.006),
          'glow':(.75,.001,.004), 'core':(1,.003,.001), 'feather':(.024,.005,.008)}
for name,color in colors.items():
    mat=materials[name];mat.diffuse_color=(*color,1)
    shader=mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value=(*color,1)
    if name in ['red','eyes','glow','core']:
        shader.inputs['Emission Color'].default_value=(*color,1)
        shader.inputs['Emission Strength'].default_value={'red':2,'eyes':3,'glow':2,'core':3}[name]
for part,label in zip(PARTS,['Glutzorn-Spalthelmer','Glutzorn-Bruchschultern','Glutzorn-Schwarzstahlharnisch',
                           'Glutzorn-Armschienen','Glutzorn-Panzerhandschuhe','Glutzorn-Runenschurz','Glutzorn-Stiefel']):
    part['label']=label
    part['vfx']={'emissive':True,'profile':'emberrage_red','attachedToItem':True}

def plate(name,outline,slot,bone,material='plate',depth=.016):
    pts=[Vector(p) for p in outline];c=sum(pts,Vector())/len(pts);n=len(pts)
    return mesh(name,pts+[c+Vector((0,-depth,0)),c+Vector((0,.004,0))],
                [(i,(i+1)%n,n) for i in range(n)]+[(i,n+1,(i+1)%n) for i in range(n)],slot,material,bone)

def crack(name,points,slot,bone,radius=.0035):
    branch(name,points,[radius]*len(points),slot,bone,'glow',4)
    branch(name+'_hot_core',[Vector(p)+Vector((0,-.002,0)) for p in points],
           [radius*.28]*len(points),slot,bone,'core',4)

def shard(name,base,tip,width,slot,bone,material='metal'):
    a,b=Vector(base),Vector(tip);axis=(b-a).normalized()
    u=axis.cross(Vector((0,1,0))).normalized()*width;v=axis.cross(u).normalized()*width*.70
    return mesh(name,[a+u,a+v,a-u,a-v,b,a-axis*width*.3],
                [(i,(i+1)%4,4) for i in range(4)]+[(i,5,(i+1)%4) for i in range(4)],slot,material,bone)

def rune(center,size,slot,bone):
    x,y,z=center
    crack('Blazing_bindrune',[(x,y,z-size),(x-size*.45,y,z),(x,y,z+size),
         (x+size*.45,y,z),(x,y,z-size)],slot,bone,.0025)
    crack('Bindrune_stem',[(x,y,z-size*1.3),(x,y,z+size*1.3)],slot,bone,.002)

# Articulated breast plates and segmented spine, not a rigid torso cone.
surface=binding_surface(pieces['Torso'][0])
for sign in [-1,1]:
    plate('Broken_breastplate',[(sign*.008,-.175,1.43),(sign*.16,-.155,1.44),
        (sign*.212,-.12,1.34),(sign*.16,-.190,1.23),(sign*.023,-.203,1.22)],'Torso',None,'metal',.023)
    for row in range(4):
        z=1.24-row*.065
        plate('Layered_blacksteel',[(sign*.012,-.190,z+.028),(sign*.161,-.152,z+.040),
            (sign*.16,-.16,z-.012),(sign*.060,-.193,z-.041)],'Torso',None)
    crack('Breast_fracture',[(sign*.04,-.217,1.40),(sign*.073,-.220,1.36),
          (sign*.052,-.223,1.325),(sign*.11,-.209,1.285)],'Torso',None)
    branch('Chest_binding',[(sign*.18,-.153,1.41),(sign*.15,-.203,1.28),
           (sign*.17,-.162,1.05)],[.009]*3,'Torso',None,'gold',5)
    plate('Back_flank',[(sign*.015,.181,1.43),(sign*.16,.142,1.39),
           (sign*.155,.15,1.06),(sign*.026,.194,1.035)],'Torso',None,'metal',-.018)
    crack('Back_lava_seam',[(sign*.050,.207,1.37),(sign*.11,.182,1.29),
          (sign*.07,.207,1.22),(sign*.12,.188,1.13)],'Torso',None)
for j in range(5):
    z=1.38-j*.07
    shard('Spinal_rivet',(0,.187,z),(0,.232,z+.025),.021,'Torso',None)
rune((0,-.239,1.344),.059,'Torso',None)
for obj in pieces['Torso'][1:]: attach_to_surface(obj,surface)

# Four independent knee-length split panels maintain stride clearance.
def panel_weights(obj,side):
    for v in obj.data.vertices:
        hip=min(1,max(0,(v.co.z-.74)/.17))
        for name,w in [('Hips',hip),('UpperLeg_'+side,1-hip)]:
            if w>0:
                g=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name);g.add([v.index],w,'REPLACE')
for side,sign in [('L',1),('R',-1)]:
    for facing in [-1,1]:
        verts=[]
        for row,z in enumerate([.94,.83,.71,.59,.47]):
            for col in range(3):
                verts.append((sign*(.093+(col-1)*.086),facing*(.184+row*.008),z+(.045 if row==4 and col!=1 else 0)))
        obj=mesh('Split_oxblood_wool',verts,[(r*3+c,r*3+c+1,(r+1)*3+c+1,(r+1)*3+c) for r in range(4) for c in range(2)],'Hips','cloth')
        panel_weights(obj,side)
        bpy.context.view_layer.objects.active=obj
        mod=obj.modifiers.new('Wool_shell','SOLIDIFY');mod.thickness=.004;bpy.ops.object.modifier_apply(modifier=mod.name)
        first=len(pieces['Hips'])
        for c in [0,2]:
            branch('Panel_iron_border',[Vector(verts[r*3+c])+Vector((0,facing*.005,0)) for r in range(5)],
                   [.006]*5,'Hips',None,'metal',4)
        for z in [.77,.64,.52]: rune((sign*.092,facing*(.228-(z-.47)*.075),z),.025,'Hips',None)
        for p in pieces['Hips'][first:]: panel_weights(p,side)
    plate('Hip_fang',[(sign*.16,-.16,.94),(sign*.238,-.08,.89),(sign*.23,-.09,.73),
                     (sign*.185,-.17,.66)],'Hips','UpperLeg_'+side,'metal')
sleeve('War_belt',[(0,.015,.91),(0,.015,.982)],[ (.183,.213)]*2,'Hips','Hips','leather',12)
rune((0,-.189,.947),.032,'Hips','Hips')

# Massive fracture pauldrons. No wings: each shoulder owns a broken red ring.
for sign,side,word in [(1,'L','Left'),(-1,'R','Right')]:
    shoulder=Vector(rig.data.bones['Shoulder_'+side].head_local)
    elbow=Vector(rig.data.bones['Elbow_'+side].head_local)
    hand=Vector(rig.data.bones['Hand_'+side].head_local)
    axis=(elbow-shoulder).normalized();fore=(hand-elbow).normalized()
    upper,lower='ArmUpper'+word,'ArmLower'+word;ub,lb='Shoulder_'+side,'Elbow_'+side
    sleeve('Blacksteel_pauldron',[shoulder-axis*.018,shoulder+axis*.12,shoulder+axis*.245],
           [(.13,.14),(.177,.18),(.12,.12)],upper,ub,'plate',8)
    center=shoulder+axis*.11+Vector((0,-.182,0))
    for j in range(9):
        a=j*math.tau/9;u=Vector((math.sin(a),0,math.cos(a)))
        c=center+u*.118
        plate('Floating_fracture_block',[c+Vector((-.039,0,.032)),c+Vector((.031,0,.041)),
              c+Vector((.048,0,-.02)),c+Vector((-.018,0,-.045))],upper,ub,'metal',.016)
        pts=[center+Vector((math.sin(a+t)*.162,-.022,math.cos(a+t)*.162)) for t in [0,.16,.30,.48]]
        crack('Shoulder_broken_ring',pts,upper,ub,.005)
    for j in range(4):
        p=shoulder+axis*(.025+j*.055)+Vector((0,.008,.139))
        shard('Pauldron_obsidian_fang',p,p+Vector((sign*(.025+j*.012),.005,.13-j*.015)),.039,upper,ub)
    rune(center+Vector((0,-.045,0)),.068,upper,ub)
    fit=.91 if VARIANT=='Female' else 1
    sleeve('War_bracer',[elbow.lerp(hand,.12),elbow.lerp(hand,.56),elbow.lerp(hand,.93)],
           [(a*fit,b*fit) for a,b in [(.085,.080),(.086,.082),(.061,.060)]],lower,lb,'plate',8)
    p=elbow.lerp(hand,.55)+Vector((0,-.097*fit,0))
    for j in range(3):
        c=p+fore*(j-1)*.061
        shard('Forearm_fragment',c,c+Vector((0,-.038,.046)),.030,lower,lb)
    crack('Forearm_fracture',[p-fore*.11,p-fore*.045+Vector((0,-.01,.026)),
          p+Vector((0,-.012,-.012)),p+fore*.09],lower,lb,.004)
    glove='Hand'+word;hb='Hand_'+side
    sleeve('Gauntlet_cuff',[hand-fore*.02,hand+fore*.045],[ (.06,.058)]*2,glove,hb,'metal',8)
    p=hand+Vector((sign*.056,0,.052))
    leaf('Gauntlet_backplate',p-fore*.025,p+fore*.078,.041,(0,0,1),glove,hb,'plate',.013)
    crack('Glove_ember_vein',[p-fore*.01,p+fore*.025+Vector((0,-.01,.005)),p+fore*.070],glove,hb,.003)
    for j in range(3):
        c=hand+Vector((sign*.092,-.023+j*.023,.048))
        shard('Gauntlet_knuckle',c,c+Vector((0,0,.026)),.010,glove,hb)

for slot in ['LegLeft','LegRight']:
    source=pieces[slot][0];x=.113 if sum(v.co.x for v in source.data.vertices)>0 else -.113
    side='L' if x>0 else 'R'
    sleeve('Armored_boot',[(x,.02,.105),(x,.02,.28),(x,.02,.41)],
           [(.089,.081),(.114,.092),(.118,.095)],slot,'LowerLeg_'+side,'plate',10)
    first=len(pieces[slot])
    plate('Angular_shin',[(x-.065,-.12,.395),(x+.06,-.12,.40),(x+.068,-.132,.245),
          (x+.034,-.126,.12),(x-.034,-.126,.12),(x-.07,-.13,.27)],slot,None,'metal')
    crack('Shin_lava',[(x-.036,-.15,.37),(x+.015,-.157,.32),(x-.014,-.154,.27),
          (x+.033,-.148,.225),(x,-.148,.17)],slot,None,.004)
    outline=[(-.078,.13),(.078,.13),(.081,-.08),(.052,-.18),(-.052,-.18),(-.081,-.08)]
    verts=[(x+dx,y,z) for z in [-.004,.035] for dx,y in outline]
    mesh('Closed_boot_sole',verts,[tuple(reversed(range(6))),tuple(range(6,12))]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)],slot,'black')
    plate('Steel_toe',[(x-.072,-.06,.09),(x+.072,-.06,.09),(x+.055,-.178,.043),
           (x,-.201,.035),(x-.055,-.178,.043)],slot,None,'metal',.009)
    surface=binding_surface(source)
    for obj in pieces[slot][1:]: attach_to_surface(obj,surface)

# Cracked, closed war mask under an open split-iron crest.
rings=[(1.47,.119,.128),(1.61,.15,.155),(1.75,.157,.158),(1.81,.11,.12)]
n=12;verts=[(rx*math.sin(j*math.tau/n),.012-ry*math.cos(j*math.tau/n),z) for z,rx,ry in rings for j in range(n)]
verts.append((0,.014,1.85))
faces=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(3) for j in range(n)]
faces += [(3*n+j,3*n+(j+1)%n,4*n) for j in range(n)]
mesh('Berserker_war_helm',verts,faces,'Head','plate','Neck')
plate('Fractured_face_guard',[(-.114,-.155,1.71),(.114,-.155,1.71),(.086,-.183,1.58),
       (0,-.202,1.48),(-.086,-.183,1.58)],'Head','Neck','metal',.023)
for sign in [-1,1]:
    leaf('Burning_eye',(sign*.019,-.244,1.68),(sign*.084,-.225,1.695),.008,(0,-1,0),'Head','Neck','eyes',.003)
    crack('Mask_fracture',[(sign*.037,-.205,1.745),(sign*.065,-.21,1.723),
          (sign*.03,-.22,1.68),(sign*.061,-.219,1.627),(sign*.019,-.225,1.576)],'Head','Neck',.003)
    branch('Split_iron_crest',[(sign*.127,.008,1.76),(sign*.166,.019,1.89),
           (sign*.095,.034,2.008),(sign*.06,.022,2.058)],[.038,.035,.022,.001],'Head','Neck','metal',5)
    shard('Temple_fang',(sign*.143,.003,1.73),(sign*.218,.032,1.83),.034,'Head','Neck')
rune((0,-.171,1.794),.030,'Head','Neck')

wing_binding_report=[]
tail=end+scaffold.split(end)[1]
tail=tail.replace("'class': 'Seherin'", "'class': 'Berserker'")
tail=tail.replace('32_Wing_Light_Detail','32_Fracture_Light_Detail')
tail=tail.replace('1400','1000').replace('2.90','2.55')
tail=tail.replace("view_transform = 'AgX'", "view_transform = 'Standard'")
tail=tail.replace("look = 'AgX - Medium High Contrast'", "look = 'None'")
tail=tail.replace("if not QUICK:\n    export(","if True:\n    export(")
exec(compile(tail,'armor-common-validation-export','exec'))
# Effect ownership is per item, not a permanent avatar light.
equipment=json.loads((ROOT/'equipment.json').read_text())
equipment.pop('wingBinding',None)
equipment['vfx']={'profile':'emberrage_red','type':'emissive_mesh',
    'materials':['Emberrage_red','Emberrage_eyes','Emberrage_glow','Emberrage_core'],
    'itemBound':True,'optionalRuntimeEffect':'selective_glow','particleSystem':False}
(ROOT/'equipment.json').write_text(json.dumps(equipment,indent=2)+'\n')
report.pop('wing_binding',None);report.pop('wing_effect',None)
report['vfx']=equipment['vfx']
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
