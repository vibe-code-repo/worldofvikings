"""Build Ashenveil replacement armor on the unmodified WoV male rest rig.

Blender --factory-startup -b BODY_BASE_MALE.blend --python-exit-code 1 \\
        --python tools/armor/sets/ashenveil/male/build.py -- OUTPUT_DIR [--quick]
Run with SOURCE.blend = WoV_BodyBase_Male.blend. Optionally --quick (hero only).
Geometry is deterministic, no paid APIs.
"""
import bpy
import bmesh
import json
import math
import random
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
ROOT = Path(ARGS[0]).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
RENDERS = ROOT / 'renders'
RENDERS.mkdir(exist_ok=True)
QUICK = '--quick' in ARGS
PREFIX = 'WoV_Ashenveil_'
SLOTS = ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft',
         'ArmLowerRight', 'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight']
PARTS = [
    {'item':'ashenveil_hood','label':'Schattenkapuze','regions':['Head']},
    {'item':'ashenveil_shoulders','label':'Dornenmantel','regions':['ArmUpperLeft','ArmUpperRight']},
    {'item':'ashenveil_vest','label':'Dunkler Brustharnisch','regions':['Torso']},
    {'item':'ashenveil_bracers','label':'Runenarmschienen','regions':['ArmLowerLeft','ArmLowerRight']},
    {'item':'ashenveil_gloves','label':'Schattenhandschuhe','regions':['HandLeft','HandRight']},
    {'item':'ashenveil_robe','label':'Kultistenrobe','regions':['Hips']},
    {'item':'ashenveil_boots','label':'Runenpanzerstiefel','regions':['LegLeft','LegRight']},
]
scene = bpy.context.scene
rig = bpy.data.objects['WoV_Player_Armature']
source_path = bpy.data.filepath
base = {s: bpy.data.objects['WoV_BodyBase_Male_' + s] for s in SLOTS}
pose = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
collection = bpy.data.collections.new('Ashenveil_Equipment')
scene.collection.children.link(collection)
pieces = {s: [] for s in SLOTS}
materials = {}
palette = {
    'cloth':(.018,.011,.023), 'leather':(.013,.010,.017),
    'plate':(.075,.031,.041), 'edge':(.195,.112,.123),
    'metal':(.115,.107,.127), 'black':(.003,.002,.006),
    'red':(.36,.006,.013), 'eyes':(.9,.002,.008),
}
for name, color in palette.items():
    mat = bpy.data.materials.new('Ashenveil_' + name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .78 if name in ['cloth','leather','black'] else .43
    shader.inputs['Metallic'].default_value = .65 if name in ['plate','metal','edge'] else 0
    if name in ['red','eyes']:
        shader.inputs['Emission Color'].default_value = (*color,1)
        shader.inputs['Emission Strength'].default_value = 1 if name == 'eyes' else .15
    materials[name] = mat


def mesh(name, vertices, faces, slot, material, bone=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(materials[material])
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(vertices))), 1, 'REPLACE')
    pieces[slot].append(obj)
    return obj


def leaf(name, start, end, width, normal, slot, bone, material='plate', fold=.008):
    """Closed eight-sided lanceolate leaf with a raised central vein."""
    start, end, normal = Vector(start), Vector(end), Vector(normal).normalized()
    axis = end - start
    normal = (normal - axis.normalized() * normal.dot(axis.normalized())).normalized()
    cross = axis.normalized().cross(normal).normalized() * width
    outline = [start, start + axis*.22 + cross*.65, start + axis*.52 + cross,
               start + axis*.80 + cross*.55, end, start + axis*.80 - cross*.55,
               start + axis*.52 - cross, start + axis*.22 - cross*.65]
    vertices = outline + [start + axis*.48 + normal*fold, start + axis*.48 - normal*.002]
    faces = [(i, (i+1) % 8, 8) for i in range(8)] + [(i, 9, (i+1) % 8) for i in range(8)]
    obj = mesh(name, vertices, faces, slot, material, bone)
    secondary = 'edge' if material == 'metal' else material
    obj.data.materials.append(materials[secondary])
    for p in obj.data.polygons:
        if p.index < 4:
            p.material_index = 1
    return obj


def branch(name, points, radii, slot, bone, material='metal', segments=6):
    points = [Vector(p) for p in points]
    vertices = []
    for i, (point, radius) in enumerate(zip(points, radii)):
        axis = (points[min(i+1, len(points)-1)] - points[max(i-1, 0)]).normalized()
        cross = axis.cross(Vector((0, 1, 0))).normalized()
        other = axis.cross(cross).normalized()
        vertices += [point + radius * (math.cos(j*2*math.pi/segments)*cross + math.sin(j*2*math.pi/segments)*other) for j in range(segments)]
    faces = [tuple(reversed(range(segments))), tuple(range(len(vertices)-segments, len(vertices)))]
    for k in range(len(points)-1):
        for j in range(segments):
            a = k*segments+j
            b = k*segments+(j+1) % segments
            faces.append((a, b, b+segments, a+segments))
    obj = mesh(name, vertices, faces, slot, material, bone)
    return obj


def sleeve(name, points, radii, slot, bone, material, segments=12):
    points = [Vector(p) for p in points]
    axis = (points[-1]-points[0]).normalized()
    front = Vector((0, -1, 0))
    front = (front-axis*front.dot(axis)).normalized()
    other = axis.cross(front).normalized()
    vertices = []
    for point, (depth, width) in zip(points, radii):
        vertices += [point+front*math.cos(j*2*math.pi/segments)*depth+other*math.sin(j*2*math.pi/segments)*width for j in range(segments)]
    faces = [(k*segments+j, k*segments+(j+1) % segments, (k+1)*segments+(j+1) % segments, (k+1)*segments+j) for k in range(len(points)-1) for j in range(segments)]
    obj = mesh(name, vertices, faces, slot, material, bone)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Closed_shell', 'SOLIDIFY')
    mod.thickness = .003
    mod.offset = -1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def robe_weights(obj):
    """Continuous skirt skin: blend both legs across the front/back centre."""
    groups = {n: obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n) for n in ['Hips', 'UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R']}
    for v in obj.data.vertices:
        hip = min(1, max(0, (v.co.z-.70)/.20))
        knee = min(.90, max(0, (.53-v.co.z)/.30)) * (1-hip)
        # Spread opposing strides over the hem instead of one narrow centre strip.
        blend_width = .20 + .40*min(1, max(0, (.80-v.co.z)/.50))
        left = min(1, max(0, .5+v.co.x/blend_width))
        weights = [('Hips', hip)]
        for side, fraction in [('L', left), ('R', 1-left)]:
            weights += [('UpperLeg_'+side, (1-hip-knee)*fraction), ('LowerLeg_'+side, knee*fraction)]
        for name, weight in weights:
            if weight > 0:
                groups[name].add([v.index], weight, 'REPLACE')


def binding_surface(obj):
    """Capture a triangulated rest surface for ornament weight interpolation."""
    obj.data.calc_loop_triangles()
    points = [v.co.copy() for v in obj.data.vertices]
    triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
    weights = [{obj.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 0}
               for v in obj.data.vertices]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True), points, triangles, weights


def attach_to_surface(obj, surface, conform=False, offset=0):
    """Decoration inherits the underlying garment's interpolated skinning."""
    tree, points, triangles, weights = surface
    obj.vertex_groups.clear()
    for v in obj.data.vertices:
        hit, normal, face, _ = tree.find_nearest(v.co)
        a, b, c = triangles[face]
        u, w, p = points[b]-points[a], points[c]-points[a], hit-points[a]
        uu, ww, uw = u.dot(u), w.dot(w), u.dot(w)
        determinant = uu*ww-uw*uw
        assert abs(determinant) > 1e-16
        beta = (ww*p.dot(u)-uw*p.dot(w))/determinant
        gamma = (uu*p.dot(w)-uw*p.dot(u))/determinant
        if conform:
            # Leaf outline, front ridge and back centre remain distinct layers.
            clearance = .020 if v.index == 8 else (.006 if v.index == 9 else .009)
            v.co = hit+normal*(clearance+offset)
        combined = {}
        for index, factor in [(a, 1-beta-gamma), (b, beta), (c, gamma)]:
            for name, weight in weights[index].items():
                combined[name] = combined.get(name, 0)+max(0, factor)*weight
        strongest = sorted(combined.items(), key=lambda kv: kv[1], reverse=True)[:4]
        total = sum(weight for _, weight in strongest)
        assert total > 0
        for name, weight in strongest:
            if weight > 0:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([v.index], weight/total, 'REPLACE')


# Complete source regions form the retained lining/body under the armor.
for slot, src in base.items():
    obj = src.copy()
    obj.data = src.data.copy()
    obj.name = 'Ashenveil_' + slot + '_lining'
    collection.objects.link(obj)
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    obj.modifiers.clear()
    for v in obj.data.vertices:
        v.co = world @ v.co
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (.0005 if slot in ['Head', 'HandLeft', 'HandRight'] else .002)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.clear()
    material = 'black' if slot == 'Head' else ('leather' if slot.startswith(('Leg','Hand')) else 'cloth')
    obj.data.materials.append(materials[material])
    obj.data.materials.append(materials['leather'])
    for polygon in obj.data.polygons:
        polygon.material_index = 0
        polygon.use_smooth = False
        if slot.startswith('Hand') and abs(polygon.center.x) < .875:
            polygon.material_index = 1
    # Correct reversed thigh assignments without a discontinuity at x=0.
    if slot == 'Hips':
        vg = {g.index: g.name for g in obj.vertex_groups}
        for v in obj.data.vertices:
            thigh = sum(g.weight for g in v.groups if vg[g.group] in ['UpperLeg_L', 'UpperLeg_R'])
            left = min(1, max(0, .5+v.co.x/.08))
            for name, fraction in [('UpperLeg_L', left), ('UpperLeg_R', 1-left)]:
                group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.remove([v.index])
                if thigh*fraction > 0:
                    group.add([v.index], thigh*fraction, 'REPLACE')
    pieces[slot].append(obj)


# New geometry inspired by the supplied silhouette, fitted to the existing male.
def jewel(name, center, width, height, slot, bone, material='red'):
    x,y,z = center
    return leaf(name,(x,y,z+height/2),(x,y,z-height/2),width/2,(0,-1,0),slot,bone,material,.009)


def crest(name, center, radius, slot, bone):
    x,y,z = center
    pts=[(x+radius*math.sin(i*math.tau/12),y,z+radius*math.cos(i*math.tau/12)) for i in range(13)]
    branch(name+'_ring',pts,[.006]*13,slot,bone,'edge',4)
    jewel(name+'_core',(x,y-.004,z),radius*.75,radius*1.40,slot,bone)
    for i in range(8):
        a=i*math.tau/8
        p=Vector((x+radius*.70*math.sin(a),y,z+radius*.70*math.cos(a)))
        q=Vector((x+radius*1.22*math.sin(a),y,z+radius*1.22*math.cos(a)))
        branch(name+'_rune',[p,q],[.004,.001],slot,bone,'edge',4)


def skull(name, center, scale, slot, bone):
    x,y,z=center
    # Broad brow, tapering cheeks and a separate jaw silhouette.
    outline=[(-.7,.65),(-.4,1),(.4,1),(.7,.65),(.58,-.25),(.3,-.7),(-.3,-.7),(-.58,-.25)]
    verts=[(x+a*scale,y-.015,z+b*scale) for a,b in outline]+[(x,y-.035,z+.15*scale),(x,y+.025,z)]
    faces=[(i,(i+1)%8,8) for i in range(8)]+[(i,9,(i+1)%8) for i in range(8)]
    mesh(name,verts,faces,slot,'metal',bone)
    for sign in [-1,1]:
        jewel(name+'_socket',(x+sign*.26*scale,y-.037,z+.25*scale),.35*scale,.27*scale,slot,bone,'black')
    jewel(name+'_nose',(x,y-.041,z-.12*scale),.15*scale,.25*scale,slot,bone,'black')
    for i in range(3):
        branch(name+'_tooth',[(x+(i-1)*scale*.18,y-.020,z-scale*.48),(x+(i-1)*scale*.18,y-.024,z-scale*.77)],[scale*.07,scale*.035],slot,bone,'edge',4)


def armor_plate(name, outline, slot, bone, material='plate', depth=.01):
    pts=[Vector(p) for p in outline]
    center=sum(pts,Vector())/len(pts)
    verts=pts+[center+Vector((0,-depth,0)),center+Vector((0,.002,0))]
    n=len(pts)
    return mesh(name,verts,[(i,(i+1)%n,n) for i in range(n)]+[(i,n+1,(i+1)%n) for i in range(n)],slot,material,bone)


# Sculpted breastplate, rib plates and pointed waist armor.
vest_surface=binding_surface(pieces['Torso'][0])
for sign in [-1,1]:
    armor_plate('Breastplate',[(sign*.012,-.178,1.41),(sign*.145,-.172,1.40),
                             (sign*.197,-.128,1.30),(sign*.142,-.180,1.19),
                             (sign*.017,-.202,1.20)],'Torso',None,depth=.016)
    for row in range(3):
        z=1.19-row*.076
        armor_plate('Abdominal_lame',[(sign*.010,-.176,z+.042),(sign*.138,-.159,z+.033),
                                     (sign*.154,-.145,z-.028),(sign*.035,-.190,z-.054)],
                    'Torso',None,'plate',.009)
    for j in range(3):
        x=sign*(.05+.036*j)
        branch('Collar_trim',[(x,-.160,1.43),(x+sign*.023,-.173,1.395)],[.006,.003],
               'Torso',None,'edge',4)
    # Rear armor has the same language without duplicating the front emblem.
    armor_plate('Back_plate',[(sign*.015,.160,1.405),(sign*.14,.13,1.39),
                             (sign*.16,.13,1.15),(sign*.015,.172,1.04)],'Torso',None,'plate',-.008)
jewel('Collar_clasp',(0,-.209,1.40),.064,.047,'Torso',None,'metal')
for obj in pieces['Torso'][1:]:
    attach_to_surface(obj,vest_surface)


# A continuous skirt with wide leg blending and tailored dark panels.
levels=[(.932,.195,.160),(.84,.203,.164),(.74,.212,.175),(.64,.220,.188),
        (.54,.229,.198),(.44,.238,.207),(.34,.247,.216),(.24,.256,.222),(.15,.262,.228)]
segments=32
def robe_point(z,angle,offset=0):
    for i in range(len(levels)-1):
        high,low=levels[i],levels[i+1]
        if high[0]>=z>=low[0]:
            t=(high[0]-z)/(high[0]-low[0])
            rx=high[1]*(1-t)+low[1]*t; ry=high[2]*(1-t)+low[2]*t
            break
    else:
        _,rx,ry=levels[0] if z>levels[0][0] else levels[-1]
    pleat=1+.045*math.cos(8*angle)
    return Vector(((rx*pleat+offset)*math.sin(angle),.015-(ry*pleat+offset)*math.cos(angle),z))
vertices=[robe_point(z,col*math.tau/segments) for z,_,_ in levels for col in range(segments)]
faces=[]
for row in range(len(levels)-1):
    for col in range(segments):
        a=row*segments+col; b=row*segments+(col+1)%segments
        faces.extend([(a,b,b+segments),(a,b+segments,a+segments)])
robe=mesh('Continuous_cultist_robe',vertices,faces,'Hips','cloth')
robe.data.materials.append(materials['black'])
for p in robe.data.polygons:
    if (p.index//2)%segments in [0,1,14,15,16,17,30,31]: p.material_index=1
robe_weights(robe)
robe_surface=binding_surface(robe)
bpy.context.view_layer.objects.active=robe
mod=robe.modifiers.new('Hem_thickness','SOLIDIFY');mod.thickness=.004
bpy.ops.object.modifier_apply(modifier=mod.name)


def robe_strip(name, angle, width, material, offset=.006):
    pts=[]
    for z,_,_ in levels:
        pts.extend([robe_point(z,angle-width,offset),robe_point(z,angle+width,offset)])
    obj=mesh(name,pts,[(i,i+1,i+3,i+2) for i in range(0,len(pts)-2,2)],'Hips',material)
    attach_to_surface(obj,robe_surface)
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new('Trim_thickness','SOLIDIFY');mod.thickness=.002
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj
for a in [.52,-.52,math.pi-.52,math.pi+.52]:
    robe_strip('Oxblood_inset',a,.14,'plate')
    for delta in [-.14,.14]:
        robe_strip('Inset_binding',a+delta,.015,'metal',.009)
    for z in [.76,.65,.54,.43,.32]:
        p=robe_point(z,a,.014)
        obj=leaf('Stitched_rune',p+Vector((-.008,0,.018)),p+Vector((.008,0,-.018)),
                 .009,(math.sin(a),-math.cos(a),0),'Hips',None,'edge',.003)
        attach_to_surface(obj,robe_surface)
for sector in range(8):
    a=sector*math.tau/8
    for d in [-.12,.12]:
        p=robe_point(.27,a+d,.012);q=robe_point(.165,a,.018)
        obj=leaf('Crimson_hem_chevron',p,q,.014,(math.sin(a),-math.cos(a),0),'Hips',None,'red',.004)
        attach_to_surface(obj,robe_surface)
    p=robe_point(.20,a,.025)
    obj=leaf('Hem_iron_point',p+Vector((0,0,.065)),p-Vector((0,0,.040)),.031,
             (math.sin(a),-math.cos(a),0),'Hips',None,'metal',.005)
    attach_to_surface(obj,robe_surface)
# Belt, red central seal, overlapping pointed tassets.
pts=[robe_point(z,col*math.tau/segments,.008) for z in [.151,.166] for col in range(segments)]
obj=mesh('Continuous_hem_binding',pts,
         [(i,(i+1)%segments,(i+1)%segments+segments,i+segments) for i in range(segments)],'Hips','metal')
attach_to_surface(obj,robe_surface)
sleeve('Waist_girdle',[(0,.015,.91),(0,.015,.974)],[ (.168,.203)]*2,'Hips','Hips','plate')
for z in [.916,.966]:
    sleeve('Girdle_trim',[(0,.015,z),(0,.015,z+.009)],[ (.172,.207)]*2,'Hips','Hips','metal')
crest('Waist_seal',(0,-.175,.929),.041,'Hips','Hips')
for sign in [-1,1]:
    obj=armor_plate('Hip_guard',[(sign*.035,-.176,.92),(sign*.183,-.139,.935),
                                 (sign*.19,-.143,.843),(sign*.075,-.203,.774)],
                    'Hips',None,'plate',.012)
    attach_to_surface(obj,robe_surface)
jewel('Pointed_tabard',(0,-.216,.813),.095,.19,'Hips','Hips','metal')


# Thorn pauldrons, engraved bracers and full black gloves.
for side,suffix,word in [(1,'L','Left'),(-1,'R','Right')]:
    shoulder=Vector(rig.data.bones['Shoulder_'+suffix].head_local)
    elbow=Vector(rig.data.bones['Elbow_'+suffix].head_local)
    hand=Vector(rig.data.bones['Hand_'+suffix].head_local)
    axis=(elbow-shoulder).normalized();fore=(hand-elbow).normalized()
    upper,lower='ArmUpper'+word,'ArmLower'+word
    ub,lb='Shoulder_'+suffix,'Elbow_'+suffix
    sleeve('Pauldron_shell',[shoulder+axis*.015,shoulder+axis*.12,shoulder+axis*.25],
           [(.130,.145),(.153,.160),(.123,.120)],upper,ub,'plate',10)
    for row in range(3):
        p=shoulder+axis*(.035+row*.075)
        sleeve('Pauldron_ridge',[p-axis*.006,p+axis*.006],
               [(.142+row*.001,.155-row*.007)]*2,upper,ub,'edge',10)
    for i in range(4):
        p=shoulder+axis*(.02+i*.066)+Vector((0,.015,.14))
        q=p+axis*(.055+i*.024)+Vector((0,.012,.20-(i%2)*.03))
        branch('Shoulder_thorn',[p,p.lerp(q,.68),q],[.039,.018,.001],
               upper,ub,'metal',5)
    stalk=shoulder+axis*.19+Vector((0,.08,.12))
    tip=stalk+axis*.15+Vector((0,.012,.20))
    branch('Skull_spike',[stalk,tip],[.032,.008],upper,ub,'plate',5)
    skull('Shoulder_skull',tip,.046,upper,ub)
    crest('Pauldron_seal',shoulder+axis*.16+Vector((0,-.160,.008)),.047,upper,ub)
    # Small overlapping plates form the lower shoulder edge.
    for j in range(3):
        p=shoulder+axis*.20+Vector((0,-.10+j*.09,.02))
        leaf('Pauldron_flange',p,p+axis*.135+Vector((0,0,-.023)),.046,
             (0,-1,.3),upper,ub,'plate',.012)
    sleeve('Bracer_shell',[elbow.lerp(hand,.12),elbow.lerp(hand,.5),elbow.lerp(hand,.94)],
           [(.079,.075),(.077,.073),(.057,.054)],lower,lb,'metal',10)
    for row in range(3):
        p=elbow.lerp(hand,.21+row*.20)+Vector((0,-.082,0))
        for direction in [-1,1]:
            leaf('Bracer_chevron',p+Vector((0,0,direction*.043)),p+fore*.072,.012,
                 (0,-1,0),lower,lb,'red',.004)
    sleeve('Glove_cuff',[hand-fore*.023,hand+fore*.041],[ (.056,.052)]*2,'Hand'+word,'Hand_'+suffix,'plate')
    p=hand+Vector((side*.052,-.003,.051))
    leaf('Glove_backplate',p-fore*.029,p+fore*.07,.036,(0,0,1),'Hand'+word,'Hand_'+suffix,'metal',.006)
    for j in range(3):
        p=hand+Vector((side*.080,-.023+j*.025,.037))
        leaf('Glove_knuckle',p,p+fore*.043,.009,(0,0,1),'Hand'+word,'Hand_'+suffix,'edge',.003)


# Closed fitted boots, soles and pointed armored toe caps; no exposed toes.
for x,suffix,slot in [(-.113,'R','LegLeft'),(.113,'L','LegRight')]:
    sleeve('Boot_shaft',[(x,.020,.11),(x,.022,.24),(x,.025,.405)],
           [(.087,.076),(.108,.082),(.111,.087)],slot,'LowerLeg_'+suffix,'leather',12)
    for z in [.18,.35,.394]:
        sleeve('Boot_binding',[(x,.022,z),(x,.022,z+.012)],
               [(.115,.090)]*2,slot,'LowerLeg_'+suffix,'metal',12)
    jewel('Shin_plate',(x,-.114,.294),.105,.217,slot,None,'plate')
    jewel('Boot_rune',(x,-.126,.30),.032,.071,slot,None,'red')
    # Solid low sole, broad heel and pointed closed toe.
    outline=[(-.073,.141),(.073,.141),(.088,.015),(.076,-.127),(.023,-.196),
             (-.023,-.196),(-.076,-.127),(-.088,.015)]
    verts=[(x+dx,y,z) for z in [-.006,.025] for dx,y in outline]
    faces=[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    mesh('Closed_boot_sole',verts,faces,slot,'black')
    # Toe shell extends over the original foot rather than leaving sandals.
    top=[(x-.076,-.058,.069),(x+.076,-.058,.069),(x+.071,-.132,.053),
         (x+.022,-.193,.038),(x-.022,-.193,.038),(x-.071,-.132,.053)]
    obj=mesh('Armored_toe',top+[(x,-.108,.101),(x,-.110,.028)],
             [(i,(i+1)%6,6) for i in range(6)]+[(i,7,(i+1)%6) for i in range(6)],slot,'metal')
    leaf('Toe_red_inlay',(x,-.071,.100),(x,-.166,.064),.013,(0,-.3,1),slot,None,'red',.003)
    surface=binding_surface(pieces[slot][0])
    for obj in pieces[slot][1:]: attach_to_surface(obj,surface)


# Deep fitted hood: thick face opening, opaque veil and red eyes.
outer=[(0,1.953),(.106,1.91),(.174,1.81),(.185,1.66),(.17,1.49),(.095,1.435),
       (0,1.423),(-.095,1.435),(-.17,1.49),(-.185,1.66),(-.174,1.81),(-.106,1.91)]
inner=[(x*.70,1.68+(z-1.68)*.83) for x,z in outer]
n=len(outer)
verts=[(x,-.194,z) for x,z in outer]+[(x,-.224,z) for x,z in inner]
verts += [(x*.95,.065,1.69+(z-1.69)*.93) for x,z in outer]
verts += [(0,.176,1.70)]
faces=[]
for i in range(n):
    j=(i+1)%n
    faces.extend([(i,j,j+n,i+n),(i,2*n+i,2*n+j,j),(2*n+i,3*n,2*n+j)])
mesh('Hood_outer_cowl',verts,faces,'Head','cloth','Neck')
branch('Hood_fold_lip',[(x,-.227,z) for x,z in inner+[inner[0]]],[.014]*13,'Head','Neck','leather',5)
for row in range(3):
    z=1.505-row*.033
    points=[(-.151,-.157,z+.075),(-.136,-.199,z+.020),(-.075,-.230,z-.013),
            (0,-.241,z-.024),(.075,-.230,z-.013),(.136,-.199,z+.020),(.151,-.157,z+.075)]
    branch('Draped_cowl_fold',points,[.020,.021,.023,.024,.023,.021,.020],
           'Head','Neck','cloth' if row%2 else 'leather',5)
# Face backing is in front of the retained source head, not an empty hole.
armor_plate('Opaque_face_veil',[(x,-.202,z) for x,z in inner],'Head','Neck','black',.003)
for sign in [-1,1]:
    jewel('Ember_eye',(sign*.041,-.220,1.733),.022,.033,'Head','Neck','eyes')
    branch('Veil_fold',[(sign*.025,-.214,1.70),(sign*.04,-.216,1.60),(sign*.014,-.221,1.51)],
           [.010,.009,.001],'Head','Neck','cloth',4)
# A broken metal halo with linked rectangular segments behind the hood.
for i in range(13):
    a=-.35+i*(math.pi+.70)/12
    center=Vector((.223*math.cos(a),.078,1.81+.235*math.sin(a)))
    tangent=Vector((-math.sin(a),0,math.cos(a)))
    radial=Vector((math.cos(a),0,math.sin(a)))
    pts=[center+tangent*u+radial*v for u,v in [(-.033,-.014),(.033,-.014),(.033,.014),(-.033,.014),(-.033,-.014)]]
    if i%2:
        pts=[Vector((p.x,p.y+(p-center).dot(radial)*.8,p.z)) for p in pts]
    branch('Halo_chain_link',pts,[.008]*5,'Head','Neck','metal',4)
branch('Halo_central_spire',[(0,.08,2.043),(0,.08,2.18)],[.029,.001],'Head','Neck','plate',5)
jewel('Halo_ruby',(0,.048,2.060),.023,.038,'Head','Neck','red')


# Join each replacement region and bind every component to the shared source rig.
armor = {}
for slot, objects in pieces.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = PREFIX+slot
    obj.data.name = obj.name
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    modifier = obj.modifiers.new('Shared_body_skin', 'ARMATURE')
    modifier.object = rig
    obj['replaces'] = slot
    obj['complete_source_region_retained'] = True
    obj['hips_source_weights_corrected'] = slot == 'Hips'
    armor[slot] = obj
rig.data.pose_position = 'POSE'
bpy.context.view_layer.update()


def visible(slots):
    for slot in SLOTS:
        armor[slot].hide_render = slot not in slots
        armor[slot].hide_set(slot not in slots)
        base[slot].hide_render = slot in slots
        base[slot].hide_set(slot in slots)


def target(obj, point):
    obj.rotation_euler = (Vector(point)-obj.location).to_track_quat('-Z', 'Y').to_euler()


studio = bpy.data.collections.new('Preview_Studio')
scene.collection.children.link(studio)
for obj in list(scene.objects):
    if obj.type in ['LIGHT', 'CAMERA']:
        bpy.data.objects.remove(obj, do_unlink=True)
    elif obj.type == 'MESH' and obj not in base.values() and obj not in armor.values():
        obj.hide_render = True
cam = bpy.data.objects.new('Preview_Camera', bpy.data.cameras.new('Preview_Camera'))
studio.objects.link(cam)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.43
scene.camera = cam


def camera(view='hero'):
    cam.data.ortho_scale = 2.43
    cam.location = {'hero': (2.55, -7, 2.70), 'front': (0, -7, 1.65), 'back': (-2.55, 7, 2.7)}[view]
    target(cam, (0, 0, 1.05))


camera()
for name, loc, energy, size, color in [
    ('Key', (-3, -4, 5), 500, 4, (1, .91, .78)),
    ('Fill', (3, -2, 3), 300, 3, (.74, .86, 1)),
    ('Rim', (0, 3, 4), 620, 3, (.86, 1, .86)),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.size, data.color = energy, size, color
    obj = bpy.data.objects.new(name, data)
    studio.objects.link(obj)
    obj.location = loc
    target(obj, (0, 0, 1))
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
floor = bpy.context.object
floor.name = 'Preview_Ground'
for coll in list(floor.users_collection):
    coll.objects.unlink(floor)
studio.objects.link(floor)
ground = bpy.data.materials.new('Preview_Ground')
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.041, .062, .064, 1)
ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .95
floor.data.materials.append(ground)
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.15, .20, .22, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .40
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = 1400
scene.render.resolution_percentage = 75 if QUICK else 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'


def render(name):
    scene.render.filepath = str(RENDERS/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('RENDER', name, flush=True)


report = {'source': source_path, 'name': 'Ashenveil', 'slots': {}, 'pose_checks': [],
          'version': 1, 'robe_foundation': 'continuous', 'closed_boots': True,
          'decoration_binding': 'barycentric garment weights',
          'collision_certified': False, 'cloth_simulation': False, 'source_overwritten': False}
for slot, obj in armor.items():
    obj.data.calc_loop_triangles()
    invalid = sum(not all(math.isfinite(c) for c in v.co) for v in obj.data.vertices)
    unweighted = sum(abs(sum(g.weight for g in v.groups)-1) > .001 for v in obj.data.vertices)
    zero_area = sum(p.area < 1e-12 for p in obj.data.polygons)
    report['slots'][slot] = {'vertices': len(obj.data.vertices), 'triangles': len(obj.data.loop_triangles),
                            'nonfinite_vertices': invalid, 'bad_weight_sums': unweighted, 'zero_area_faces': zero_area}
    assert not (invalid or unweighted or zero_area), (slot, report['slots'][slot])
report['total_triangles'] = sum(r['triangles'] for r in report['slots'].values())
assert report['total_triangles'] < 16000, report['total_triangles']
visible(SLOTS)
render('01_Ashenveil_Hero')
if not QUICK:
    camera('front'); render('02_Ashenveil_Front')
    camera('back'); render('03_Ashenveil_Back')
    camera()
    for i, part in enumerate(PARTS):
        visible(part['regions']); render('%02d_%s' % (10+i, part['item']))
    visible([]); render('00_Body_Reference')
    visible(SLOTS)
    cam.data.ortho_scale = .96
    cam.location = (.5, -2.5, 2.02)
    target(cam, (0, 0, 1.78)); render('30_Hood_Detail')
    visible(['LegLeft','LegRight'])
    cam.data.ortho_scale = .65
    cam.location = (.8,-2,.7)
    target(cam,(0,0,.19)); render('31_Boot_Detail')
    visible(SLOTS)
    camera()
    for name, changes in [
        ('Stride', {'UpperLeg_L': (.40, 0, 0), 'UpperLeg_R': (-.40, 0, 0), 'LowerLeg_L': (.50, 0, 0)}),
        ('Elbows', {'Elbow_L': (0, 0, .65), 'Elbow_R': (0, 0, -.65)}),
        ('TorsoTurn', {'Spine_02': (0, .30, 0), 'Spine_03': (0, .15, 0)}),
        ('HeadTurn', {'Neck': (0, .38, 0)}),
    ]:
        for b in rig.pose.bones:
            b.matrix_basis = pose[b.name]
        for bone, angles in changes.items():
            rot = Matrix.Identity(4)
            for angle, axis in zip(angles, 'XYZ'):
                rot = rot @ Matrix.Rotation(angle, 4, axis)
            rig.pose.bones[bone].matrix_basis = pose[bone] @ rot
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        points = []
        for obj in armor.values():
            ev = obj.evaluated_get(dg); data = ev.to_mesh()
            points.extend(ev.matrix_world @ v.co for v in data.vertices)
            ev.to_mesh_clear()
        assert all(all(math.isfinite(c) and abs(c) < 4 for c in p) for p in points), name
        report['pose_checks'].append({'pose': name, 'finite_and_bounded': True})
        render('20_Pose_'+name)
for b in rig.pose.bones:
    b.matrix_basis = pose[b.name]
bpy.context.view_layer.update()
visible(SLOTS)
camera()


def export(filename, objects):
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False)
    rig.select_set(True)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(ROOT/filename), export_format='GLB', use_selection=True,
                             export_animations=False, export_skins=True, export_extras=True)


if not QUICK:
    export('WoV_Ashenveil_Armor.glb', list(armor.values()))
    for part in PARTS:
        export(part['item']+'.glb', [armor[s] for s in part['regions']])
    visible(SLOTS)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'WoV_Ashenveil_Armor.blend'))
(ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
(ROOT/'equipment.json').write_text(json.dumps({'name': 'Ashenveil', 'prefix': PREFIX, 'parts': PARTS, 'hipsAlreadyFixed': True}, indent=2)+'\n')
print('DONE', report['total_triangles'], flush=True)
