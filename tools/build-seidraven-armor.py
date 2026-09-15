"""Build Seidraven male/female armor on unmodified WoV source rest rigs.

Run Blender with --factory-startup -b SOURCE.blend --python THIS.py -- OUTPUT
and optionally --quick (hero only). Geometry is deterministic, no paid APIs.
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
VARIANT = 'Female' if '--female' in ARGS else 'Male'
PREFIX = 'WoV_Seidraven_'
ITEM_PREFIX = 'seidraven_' + VARIANT.lower() + '_'
BODY_POLICY = {'bodyVariant': VARIANT.lower(), 'bodyProfile': 'wov-female-v1' if VARIANT == 'Female' else 'wov-male-v1', 'figure': 'wikingerin' if VARIANT == 'Female' else 'wikinger'}
SLOTS = ['Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft',
         'ArmLowerRight', 'LegLeft', 'LegRight', 'Head', 'HandLeft', 'HandRight']
PARTS = [
    {'item':'seidraven_hood','label':'Runenhelm','regions':['Head']},
    {'item':'seidraven_shoulders','label':'Rabenlicht-Schultern','regions':['ArmUpperLeft','ArmUpperRight']},
    {'item':'seidraven_vest','label':'Seidr-Lamellenharnisch','regions':['Torso']},
    {'item':'seidraven_bracers','label':'Runenarmschienen','regions':['ArmLowerLeft','ArmLowerRight']},
    {'item':'seidraven_gloves','label':'Seidr-Handschuhe','regions':['HandLeft','HandRight']},
    {'item':'seidraven_robe','label':'Runen-Schurz','regions':['Hips']},
    {'item':'seidraven_boots','label':'Runenpanzerstiefel','regions':['LegLeft','LegRight']},
]
for part in PARTS:
    part.update(BODY_POLICY)
    part['item'] = part['item'].replace('seidraven_', ITEM_PREFIX)
    part['hideAppearance'] = ['hair', 'beard', 'eyebrows'] if part['regions'] == ['Head'] else []
scene = bpy.context.scene
rig = bpy.data.objects['WoV_Player_Armature']
source_path = bpy.data.filepath
base = {s: bpy.data.objects['WoV_BodyBase_' + VARIANT + '_' + s] for s in SLOTS}
pose = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()
collection = bpy.data.collections.new('Seidraven_Equipment')
scene.collection.children.link(collection)
pieces = {s: [] for s in SLOTS}
materials = {}
palette = {
    'cloth':(.035,.009,.105), 'leather':(.029,.024,.034),
    'plate':(.080,.102,.145), 'edge':(.38,.43,.48),
    'metal':(.19,.24,.29), 'black':(.005,.004,.012),
    'red':(.28,.009,.75), 'eyes':(.55,.06,1.0),
    'gold':(.39,.23,.09), 'feather':(.035,.014,.095),
    'glow':(.16,.003,.80), 'core':(.32,.015,1.0),
}
for name, color in palette.items():
    mat = bpy.data.materials.new('Seidraven_' + name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .78 if name in ['cloth','leather','black'] else .43
    shader.inputs['Metallic'].default_value = .65 if name in ['plate','metal','edge','gold'] else 0
    if name in ['red','eyes','glow','core']:
        shader.inputs['Emission Color'].default_value = (*color,1)
        shader.inputs['Emission Strength'].default_value = {'eyes': 2, 'red': .7, 'glow': 1.5, 'core': 3}[name]
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
    obj.name = 'Seidraven_' + slot + '_lining'
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




def armor_plate(name, outline, slot, bone, material='plate', depth=.01):
    pts=[Vector(p) for p in outline]
    center=sum(pts,Vector())/len(pts)
    verts=pts+[center+Vector((0,-depth,0)),center+Vector((0,.002,0))]
    n=len(pts)
    return mesh(name,verts,[(i,(i+1)%n,n) for i in range(n)]+[(i,n+1,(i+1)%n) for i in range(n)],slot,material,bone)



# Nordic lamellar armor: fitted separately to each body's rest surface.
vest_surface = binding_surface(pieces['Torso'][0])
for sign in [-1, 1]:
    armor_plate('Raven_breast', [(sign*.012,-.165,1.432),(sign*.150,-.155,1.409),
        (sign*.202,-.116,1.330),(sign*.155,-.183,1.247),(sign*.025,-.189,1.222)],
        'Torso',None,'metal',.014)
    for row in range(4):
        z=1.235-row*.070
        width=.151 if VARIANT == 'Male' else .140
        armor_plate('Overlapping_lamella',[(sign*.011,-.175,z+.019),(sign*width,-.145,z+.037),
            (sign*(width+.014),-.143,z-.011),(sign*.046,-.190,z-.050)],
            'Torso',None,'plate',.008)
        branch('Lamellar_silver_binding',[(sign*.024,-.186,z+.016),(sign*.105,-.175,z+.030),
            (sign*width,-.154,z+.035)],[.004]*3,'Torso',None,'edge',4)
    # Interlaced shoulder-to-belt straps with bronze rivets.
    branch('Braided_harness',[(sign*.16,-.157,1.414),(sign*.123,-.210,1.30),
        (sign*.104,-.188,1.16),(sign*.143,-.160,1.01)],[.009]*4,'Torso',None,'gold',5)
    for row in range(5):
        z=1.05+row*.064
        jewel('Harness_rivet',(sign*.126,-.204,z),.009,.011,'Torso',None,'gold')
    armor_plate('Rear_lamellar_back',[(sign*.012,.170,1.42),(sign*.148,.140,1.37),
        (sign*.161,.143,1.15),(sign*.025,.180,1.035)],'Torso',None,'plate',-.012)
    branch('Back_silver_seam',[(sign*.025,.185,1.07),(sign*.13,.160,1.26),
        (sign*.09,.166,1.40)],[.005]*3,'Torso',None,'edge',4)
# Stylized twin ravens: angular wings and a downward beak.
for sign in [-1,1]:
    for j in range(3):
        leaf('Chest_raven_feather',(sign*.020,-.212,1.360-j*.011),
             (sign*(.105+j*.020),-.194,1.420-j*.035),.014,(0,-1,0),
             'Torso',None,'edge',.005)
jewel('Seidr_heart',(0,-.221,1.337),.052,.094,'Torso',None,'red')
branch('Raven_beak',[(0,-.227,1.32),(0,-.224,1.275)],[.014,.001],'Torso',None,'gold',4)
for obj in pieces['Torso'][1:]:
    attach_to_surface(obj,vest_surface)

# Split Norse riding panels. Each flap follows only its own leg below the belt.
# There is deliberately no continuous ankle-length surface spanning both knees.
def panel_weights(obj, side):
    for v in obj.data.vertices:
        hip=min(1,max(0,(v.co.z-.73)/.18))
        for name, weight in [('Hips',hip),('UpperLeg_'+side,1-hip)]:
            if weight>0:
                group=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                group.add([v.index],weight,'REPLACE')

for side,sign in [('L',1),('R',-1)]:
    for facing in [-1,1]:
        vertices=[]
        for row,z in enumerate([.925,.82,.71,.60,.49,.38]):
            t=row/5
            width=.083+.012*t
            center=.083+.010*t
            depth=(.160+.039*t)*facing
            for col in range(5):
                x=sign*(center+(col/4-.5)*2*width)
                vertices.append((x,depth+facing*.012*math.cos(col*math.pi/2),z+(.025 if row==5 and col in [0,4] else 0)))
        faces=[(r*5+c,r*5+c+1,(r+1)*5+c+1,(r+1)*5+c) for r in range(5) for c in range(4)]
        obj=mesh('Split_woven_panel',vertices,faces,'Hips','cloth')
        panel_weights(obj,side)
        bpy.context.view_layer.objects.active=obj
        mod=obj.modifiers.new('Wool_thickness','SOLIDIFY');mod.thickness=.004
        bpy.ops.object.modifier_apply(modifier=mod.name)
        # Edge bindings share exactly the panel's per-leg weight function.
        for col in [0,4]:
            pts=[Vector(vertices[r*5+col])+Vector((0,facing*.006,0)) for r in range(6)]
            trim=branch('Woven_bronze_edge',pts,[.005]*6,'Hips',None,'gold',4)
            panel_weights(trim,side)
        # Angular decorative rune strokes, deliberately not a translated inscription.
        for row in range(4):
            x=sign*.09;y=facing*(.175+row*.007);z=.79-row*.095
            for a,b in [((x,y,z+.025),(x,y,z-.025)),
                        ((x,y,z+.014),(x+sign*.020,y,z+.026)),
                        ((x,y,z-.006),(x+sign*.020,y,z+.007))]:
                obj=branch('Woven_rune',[a,b],[.003,.002],'Hips',None,'edge',4)
                panel_weights(obj,side)
    # Short outward tasset leaves the hip silhouette readable.
    armor_plate('Hip_lamellar_tasset',[(sign*.143,-.155,.92),(sign*.218,-.075,.88),
        (sign*.224,-.076,.68),(sign*.153,-.172,.72)],'Hips','UpperLeg_'+side,'plate',.009)
sleeve('Broad_leather_belt',[(0,.015,.91),(0,.015,.978)],[ (.166,.198)]*2,'Hips','Hips','leather',16)
for z in [.918,.966]:
    sleeve('Belt_binding',[(0,.015,z),(0,.015,z+.007)],[ (.169,.201)]*2,'Hips','Hips','gold',16)
crest('Seidr_belt_seal',(0,-.169,.944),.038,'Hips','Hips')

# Shoulder-mounted spectral raven fans, not back or head accessories.
wing_checks=[]
for side,suffix,word in [(1,'L','Left'),(-1,'R','Right')]:
    shoulder=Vector(rig.data.bones['Shoulder_'+suffix].head_local)
    elbow=Vector(rig.data.bones['Elbow_'+suffix].head_local)
    hand=Vector(rig.data.bones['Hand_'+suffix].head_local)
    axis=(elbow-shoulder).normalized();fore=(hand-elbow).normalized()
    upper,lower='ArmUpper'+word,'ArmLower'+word
    ub,lb='Shoulder_'+suffix,'Elbow_'+suffix
    wb='Shoulder_Attachment_'+suffix
    shell=sleeve('Rounded_Norse_pauldron',[shoulder+axis*.010,shoulder+axis*.105,shoulder+axis*.22],
           [(.110,.124),(.137,.148),(.105,.105)],upper,ub,'plate',10)
    cap=[v.co.copy() for v in list(shell.data.vertices)[:10]]
    cap.append(shoulder-axis*.020)
    mesh('Closed_pauldron_crown',cap,[(i,(i+1)%10,10) for i in range(10)],upper,'metal',ub)
    for row in range(3):
        p=shoulder+axis*(.038+row*.072)
        sleeve('Pauldron_silver_rim',[p-axis*.005,p+axis*.005],
               [(.129,.146-row*.012)]*2,upper,ub,'edge',10)
    for row in range(5):
        p=shoulder+axis*(.05+row*.033)+Vector((0,-.080,.079))
        leaf('Forged_raven_scale',p,p+axis*.095+Vector((0,-.015,-.076)),.031,
             (0,-1,.5),upper,ub,'metal',.011)
    crest('Shoulder_seidr_seal',shoulder+axis*.095+Vector((0,-.140,.02)),.034,upper,ub)
    # Root bracket and each feather are rigidly bound to the named shoulder socket.
    root=Vector((side*.270,.152,1.465))
    branch('Wing_socket_bracket',[shoulder+Vector((0,.035,-.005)),root,
        root+Vector((side*.10,.01,.08))],[.040,.033,.020],upper,wb,'metal',6)
    spine=[root,Vector((side*.47,.19,1.69)),Vector((side*.70,.21,1.88)),
           Vector((side*.86,.20,1.92))]
    branch('Raven_wing_silver_spar',spine,[.036,.031,.018,.003],upper,wb,'edge',6)
    # Layered forged coverts and luminous primary feathers form a clear raven fan.
    for j in range(8):
        t=j/7
        start=Vector((side*(.34+.37*t),.203,1.55+.285*t))
        end=Vector((side*(.46+.72*t),.225+.035*t,2.03-.57*t))
        physical=leaf('Wing_dark_primary',start,end,.046,(0,-1,.05),upper,wb,'feather',.009)
        glow=leaf('Wing_spectral_primary',start+Vector((0,-.016,.005)),
            end+Vector((side*.045,-.016,-.015)),.029,(0,-1,.05),upper,wb,'glow',.004)
        core=leaf('Wing_light_vein',start+Vector((0,-.024,0)),
            end+Vector((0,-.024,0)),.006,(0,-1,0),upper,wb,'core',.002)
        wing_checks.extend([physical,glow,core])
    for j in range(6):
        p=root+Vector((side*(.015+j*.062),-.018,.06+j*.048))
        leaf('Silver_raven_covert',p,p+Vector((side*.14,-.009,.012-j*.016)),.027,
             (0,-1,0),upper,wb,'metal',.008)
    # Forearm shells adapt to the thinner female lining.
    fit=.90 if VARIANT=='Female' else 1
    sleeve('Runic_bracer',[elbow.lerp(hand,.11),elbow.lerp(hand,.5),elbow.lerp(hand,.94)],
           [(a*fit,b*fit) for a,b in [(.079,.075),(.077,.073),(.057,.054)]],
           lower,lb,'metal',10)
    p=elbow.lerp(hand,.54)+Vector((0,-.084*fit,0))
    leaf('Bracer_violet_enamel',p-fore*.073,p+fore*.068,.030,(0,-1,0),lower,lb,'cloth',.005)
    for row in range(3):
        p=elbow.lerp(hand,.25+row*.21)+Vector((0,-.091*fit,0))
        branch('Bracer_rune',[p+Vector((0,0,-.018)),p+Vector((0,0,.018)),p+fore*.020],
               [.003]*3,lower,lb,'gold',4)
    sleeve('Leather_glove_cuff',[hand-fore*.023,hand+fore*.041],[ (.056,.052)]*2,'Hand'+word,'Hand_'+suffix,'leather')
    p=hand+Vector((side*.052,-.003,.051))
    leaf('Glove_iron_backplate',p-fore*.029,p+fore*.07,.036,(0,0,1),'Hand'+word,'Hand_'+suffix,'metal',.006)
    for j in range(3):
        p=hand+Vector((side*.080,-.023+j*.025,.040))
        leaf('Glove_knuckle',p,p+fore*.041,.008,(0,0,1),'Hand'+word,'Hand_'+suffix,'gold',.003)

wing_binding_report=[]
for obj in wing_checks:
    groups={g.index:g.name for g in obj.vertex_groups}
    expected='Shoulder_Attachment_L' if sum(v.co.x for v in obj.data.vertices)>0 else 'Shoulder_Attachment_R'
    assert all(len(v.groups)==1 and groups[v.groups[0].group]==expected and abs(v.groups[0].weight-1)<1e-7 for v in obj.data.vertices)
    wing_binding_report.append({'mesh':obj.name,'bone':expected,'vertices':len(obj.data.vertices),'weight':1.0})

# Source left/right leg region names differ between male and female.
# Resolve the actual side from geometry, never from the label.
for slot in ['LegLeft','LegRight']:
    source=pieces[slot][0]
    x=sum(v.co.x for v in source.data.vertices)/len(source.data.vertices)
    x=.113 if x>0 else -.113
    suffix='L' if x>0 else 'R'
    sleeve('Wrapped_boot_shaft',[(x,.020,.11),(x,.022,.24),(x,.025,.402)],
           [(.087,.076),(.108,.082),(.111,.087)],slot,'LowerLeg_'+suffix,'leather',12)
    for z in [.18,.27,.36,.392]:
        sleeve('Boot_braided_binding',[(x,.022,z),(x,.022,z+.009)],
               [(.112,.088)]*2,slot,'LowerLeg_'+suffix,'gold',12)
    jewel('Forged_shin_guard',(x,-.117,.285),.109,.233,slot,None,'metal')
    jewel('Seidr_shin_inlay',(x,-.133,.292),.033,.082,slot,None,'red')
    outline=[(-.073,.130),(.073,.130),(.078,.015),(.069,-.127),(.024,-.183),
             (-.024,-.183),(-.069,-.127),(-.078,.015)]
    verts=[(x+dx,y,z) for z in [-.006,.024] for dx,y in outline]
    faces=[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    mesh('Closed_boot_sole',verts,faces,slot,'black')
    top=[(x-.071,-.052,.071),(x+.071,-.052,.071),(x+.065,-.130,.055),
         (x+.020,-.180,.039),(x-.020,-.180,.039),(x-.065,-.130,.055)]
    mesh('Rounded_iron_toecap',top+[(x,-.102,.106),(x,-.109,.028)],
         [(i,(i+1)%6,6) for i in range(6)]+[(i,7,(i+1)%6) for i in range(6)],slot,'metal')
    leaf('Toe_silver_ridge',(x,-.064,.107),(x,-.170,.065),.010,(0,-.3,1),slot,None,'edge',.003)
    surface=binding_surface(source)
    for obj in pieces[slot][1:]: attach_to_surface(obj,surface)

# A Nordic spectacle helmet over a violet coif: no demonic horns or halo.
# The mask intentionally covers hair, beard and eyebrows.
rings=[(1.45,.124,.126),(1.59,.144,.149),(1.73,.151,.154),(1.81,.102,.111)]
segments=16
verts=[(rx*math.sin(j*math.tau/segments),.014-ry*math.cos(j*math.tau/segments),z)
       for z,rx,ry in rings for j in range(segments)]
verts.append((0,.018,1.865))
faces=[(r*segments+j,r*segments+(j+1)%segments,(r+1)*segments+(j+1)%segments,(r+1)*segments+j)
       for r in range(3) for j in range(segments)]
faces += [(3*segments+j,3*segments+(j+1)%segments,4*segments) for j in range(segments)]
helmet=mesh('Riveted_Nordic_helmet',verts,faces,'Head','metal','Neck')
helmet.data.materials.append(materials['cloth'])
for p in helmet.data.polygons:
    if p.index<16: p.material_index=1
for z,rx,ry in [(1.73,.155,.160),(1.59,.148,.155)]:
    pts=[(rx*math.sin(j*math.tau/16),.014-ry*math.cos(j*math.tau/16),z) for j in range(17)]
    branch('Helmet_forged_band',pts,[.008]*17,'Head','Neck','edge',5)
armor_plate('Closed_seer_faceplate',[(-.096,-.157,1.70),(.096,-.157,1.70),(.088,-.170,1.57),
    (.042,-.178,1.49),(-.042,-.178,1.49),(-.088,-.170,1.57)],'Head','Neck','plate',.025)
for sign in [-1,1]:
    # Narrow glowing eye slits beneath the characteristic spectacle brow.
    leaf('Seer_eye_slit',(sign*.021,-.187,1.680),(sign*.076,-.177,1.694),.006,
         (0,-1,0),'Head','Neck','eyes',.002)
    branch('Spectacle_brow',[(sign*.012,-.190,1.710),(sign*.054,-.189,1.720),
        (sign*.107,-.157,1.705),(sign*.109,-.163,1.666),(sign*.073,-.177,1.655)],
        [.009]*5,'Head','Neck','edge',5)
    leaf('Cheek_raven_engraving',(sign*.100,-.169,1.641),(sign*.040,-.200,1.533),
         .021,(0,-1,0),'Head','Neck','metal',.007)
branch('Nasal_guard',[(0,-.187,1.759),(0,-.201,1.699),(0,-.215,1.610)],
       [.015,.013,.002],'Head','Neck','gold',5)
jewel('Forehead_amethyst',(0,-.169,1.777),.033,.046,'Head','Neck','red')
# Low raven crest and curved bronze knotwork retain a practical Viking silhouette.
leaf('Helmet_raven_crest',(0,-.08,1.85),(0,.125,1.895),.017,
     (1,0,0),'Head','Neck','metal',.007)
for sign in [-1,1]:
    branch('Helmet_knotwork',[(sign*.035,-.151,1.78),(sign*.070,-.128,1.82),
        (sign*.039,-.117,1.84),(sign*.022,-.127,1.807)],[.004]*4,'Head','Neck','gold',4)

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
cam.data.ortho_scale = 2.90
scene.camera = cam


def camera(view='hero'):
    cam.data.ortho_scale = 2.90
    cam.location = {'hero': (2.55, -7, 2.70), 'front': (0, -7, 1.65), 'back': (-2.55, 7, 2.7)}[view]
    target(cam, (0, 0, 1.05))


camera()
for name, loc, energy, size, color in [
    ('Key', (-3, -4, 5), 500, 4, (1, .91, .78)),
    ('Fill', (3, -2, 3), 300, 3, (.74, .86, 1)),
    ('Rim', (0, 3, 4), 620, 3, (.68, .72, 1)),
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
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.035, .040, .055, 1)
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
scene.view_settings.exposure = -.55
# Blender 5 compositor: exported materials emit light; preview bloom is separate.
tree=bpy.data.node_groups.new('Seidraven_Preview_Bloom','CompositorNodeTree')
scene.compositing_node_group=tree
tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
layers=tree.nodes.new('CompositorNodeRLayers')
glare=tree.nodes.new('CompositorNodeGlare')
glare.inputs['Type'].default_value='Fog Glow'
glare.inputs['Threshold'].default_value=.25
glare.inputs['Strength'].default_value=1.2
glare.inputs['Size'].default_value=.7
output=tree.nodes.new('NodeGroupOutput')
tree.links.new(layers.outputs['Image'],glare.inputs['Image'])
tree.links.new(glare.outputs['Image'],output.inputs[0])


def render(name):
    scene.render.filepath = str(RENDERS/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('RENDER', name, flush=True)


report = {'source': source_path, 'name': 'Seidraven', 'slots': {}, 'pose_checks': [],
          'version': 1, 'variant': VARIANT, 'robe_foundation': 'split per-leg riding panels', 'wing_binding': wing_binding_report, 'wing_effect': 'emissive geometry; preview compositor fog glow; runtime bloom required for halo', 'closed_boots': True,
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
render('01_Seidraven_Hero')
if not QUICK:
    cam.data.ortho_scale=2.65
    cam.location=(0,-7,1.8); target(cam,(0,0,1.35)); render('32_Wing_Light_Detail')
    camera('front'); render('02_Seidraven_Front')
    camera('back'); render('03_Seidraven_Back')
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
        ('ShoulderRaise', {'Clavicle_L': (0, 0, .30), 'Clavicle_R': (0, 0, -.30), 'Shoulder_L': (0, 0, .5), 'Shoulder_R': (0, 0, -.5)}),
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
    export('WoV_Seidraven_Armor.glb', list(armor.values()))
    for part in PARTS:
        export(part['item']+'.glb', [armor[s] for s in part['regions']])
    visible(SLOTS)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'WoV_Seidraven_Armor.blend'))
(ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
(ROOT/'equipment.json').write_text(json.dumps({**BODY_POLICY, 'name': 'Seidraven', 'variant': VARIANT.lower(), 'class': 'Seherin', 'version': 1, 'prefix': PREFIX, 'parts': PARTS, 'hipsAlreadyFixed': True, 'registrationStatus': 'not_registered', 'wingBinding': ['Shoulder_Attachment_L','Shoulder_Attachment_R'], 'appearanceMetadata': 'hideAppearance is an item-level hide list; union of equipped items', 'vfx': {'type': 'emissive_mesh', 'optionalRuntimeEffect': 'bloom', 'particleSystem': False}}, indent=2)+'\n')
print('DONE', report['total_triangles'], flush=True)
