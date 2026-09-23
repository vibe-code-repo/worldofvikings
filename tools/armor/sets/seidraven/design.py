"""The Seidraven design: a violet-and-silver seeress set with raven-feather wings.

design(ctx) adds its geometry to ctx.pieces[<region>] with the scaffold's helpers and
records the rigid wing parts in ctx.wing_binding_report. Nothing here renders or exports;
that is lib/scaffold.py's finish(). The geometry is the one the set shipped with.
"""
import math
import bpy
from mathutils import Vector


def design(ctx):
    VARIANT, rig, pieces, materials = ctx.VARIANT, ctx.rig, ctx.pieces, ctx.materials
    mesh, leaf, branch, sleeve = ctx.mesh, ctx.leaf, ctx.branch, ctx.sleeve
    binding_surface, attach_to_surface = ctx.binding_surface, ctx.attach_to_surface

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
    ctx.wing_binding_report = wing_binding_report
