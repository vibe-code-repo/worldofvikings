"""The Crowshade design: a slim rogue in black leather, aged silver and warm brown straps.

A deep black hood over a silver raven-skull mask with a long beak, uneven shoulders (a
crown of black feathers on the right, a clawed silver pauldron with feathers behind it on
the left), a black leather jerkin with a silver breastplate, a knotwork medallion and a
brown bandolier, a double belt with three throwing knives and a pouch, ragged coat tails,
bracers with a comb of blades, claw gloves and tall strapped boots with silver toe caps.
Nothing glows: the scaffold's emissive materials are not used and emission is empty.

Binding: the feather crown, the claw pauldron and its feathers are rigid on
Shoulder_Attachment_L/R, so nothing on the shoulders travels with the forearm; the mask
is rigid on Head, the hood follows the head lining; the knives and the pouch are rigid on
Hips. Below the belt the front coat tails follow the thighs fully, the side and rear tails
share between hips and thighs, so a crouch neither drives the thighs through the rear tails
nor pushes the tails through the floor; the rear tails end at the knee.

Feathers are single flat blades with a folded spine and a ragged edge (drawn from both
sides), not volumes. design(ctx) adds the geometry to ctx.pieces[<region>], records the
socket-bound parts in ctx.wing_binding_report and the triangle budget in ctx.budget.
after_export(ctx) adds a side view (and front/back in a quick run) and the witnesses:
triangles per item, materials used, no emissive material.
"""
import json
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from config import CONFIG

UP, FRONT = Vector((0, 0, 1)), Vector((0, -1, 0))


def design(ctx):
    VARIANT, rig, pieces, materials = ctx.VARIANT, ctx.rig, ctx.pieces, ctx.materials
    mesh, leaf, branch, sleeve = ctx.mesh, ctx.leaf, ctx.branch, ctx.sleeve
    binding_surface, attach_to_surface = ctx.binding_surface, ctx.attach_to_surface
    fit = .92 if VARIANT == 'Female' else 1
    socketed = []

    def paint(obj, names, indices):
        """Face materials by index; names[0] is the material mesh() already assigned."""
        for name in names[1:]:
            obj.data.materials.append(materials[name])
        for polygon in obj.data.polygons:
            polygon.material_index = indices[polygon.index]

    def rigid(obj, weights):
        """Replace the object's skinning by fixed bone weights (they sum to one)."""
        obj.vertex_groups.clear()
        for name, weight in weights.items():
            obj.vertex_groups.new(name=name).add(list(range(len(obj.data.vertices))), weight, 'REPLACE')
        return obj

    def shell(*objects):
        """One BVH over one or more rest-pose meshes (world space = object space here)."""
        points, triangles = [], []
        for obj in objects:
            obj.data.calc_loop_triangles(); first = len(points)
            points += [v.co.copy() for v in obj.data.vertices]
            triangles += [tuple(i+first for i in t.vertices) for t in obj.data.loop_triangles]
        return BVHTree.FromPolygons(points, triangles, all_triangles=True)

    def onto(tree, facing, clear, axis=1):
        """Snap a point onto a surface seen along an axis (Y: front -1, back +1; X: right -1, left +1)."""
        def snap(p):
            eye = Vector(p); eye[axis] = facing*2
            aim = Vector((0, 0, 0)); aim[axis] = -facing
            hit = tree.ray_cast(eye, aim)[0]
            if hit is None:
                eye[axis] = facing*.3; hit = tree.find_nearest(eye)[0]
            q = Vector(p); q[axis] = hit[axis]+facing*clear
            return q
        return snap

    def lay(tree, p, toward, clear):
        """Put a point onto a surface along the line from p to a point inside; returns (position, outward)."""
        p, toward = Vector(p), Vector(toward); d = (toward-p).normalized()
        hit = tree.ray_cast(toward-d*1.5, d)[0]
        if hit is None:
            hit = tree.find_nearest(p)[0]
        return hit-d*clear, -d

    def trace(tree, waypoints, toward, clear, step=.03):
        waypoints = [Vector(w) for w in waypoints]; points = []
        for a, b in zip(waypoints, waypoints[1:]):
            count = max(1, round((b-a).length/step))
            points += [lay(tree, a.lerp(b, k/count), toward(a.lerp(b, k/count)), clear) for k in range(count)]
        return points+[lay(tree, waypoints[-1], toward(waypoints[-1]), clear)]

    def strap(name, points, width, slot, material='gold'):
        verts = []
        for i, (p, out) in enumerate(points):
            tangent = (points[min(i+1, len(points)-1)][0]-points[max(i-1, 0)][0]).normalized()
            side = tangent.cross(out).normalized()*width/2
            verts += [p+side, p-side]
        return mesh(name, verts, [(2*i, 2*i+1, 2*i+3, 2*i+2) for i in range(len(points)-1)], slot, material)

    def plate(name, core, normal, slot, bone, rim=.010, bulge=.016, back=.004, material='plate', trim='edge', snap=None):
        """Faceted plate with a raised centre and a trim rim; closed at the back."""
        core = [Vector(p) for p in core]; n = len(core)
        normal = Vector(normal).normalized()
        centre = sum(core, Vector())/n
        def outward(p):
            d = p-centre
            return (d-normal*d.dot(normal)).normalized()
        flat = core+[p+outward(p)*rim for p in core]+[centre, centre]
        lift = [.003]*n+[0]*n+[bulge, -back]
        faces, index = [], []
        for i in range(n):
            j = (i+1) % n
            faces += [(i, j, 2*n), (i, n+i, n+j, j), (n+j, n+i, 2*n+1)]; index += [0, 1, 0]
        verts = [(snap(p) if snap else p)+normal*h for p, h in zip(flat, lift)]
        obj = mesh(name, verts, faces, slot, material, bone)
        paint(obj, [material, trim], index)
        return obj

    def talon(name, base, tip, width, slot, bone, material='edge', bend=None):
        """Four-sided spike; with bend (a direction) it hooks like a claw."""
        a, b = Vector(base), Vector(tip)
        if bend is None:
            axis = (b-a).normalized()
            u = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()*width
            v = axis.cross(u).normalized()*width
            return mesh(name, [a+u, a-u*.5+v*.87, a-u*.5-v*.87, b], [(0, 1, 3), (1, 2, 3), (2, 0, 3), (2, 1, 0)],
                        slot, material, bone)
        m = a.lerp(b, .55)+Vector(bend)*(b-a).length*.22
        return branch(name, [a, m, b], [width, width*.55, .0008], slot, bone, material, 4)

    def feather(name, root, tip, width, normal, slot, bone, bend=.10, notch=0):
        """Flat feather blade: folded spine, curved, one ragged notch; drawn from both sides."""
        root, tip, normal = Vector(root), Vector(tip), Vector(normal).normalized()
        axis = tip-root; length = axis.length
        normal = (normal-axis.normalized()*normal.dot(axis.normalized())).normalized()
        side = axis.normalized().cross(normal).normalized()
        profile = [(0, .26), (.16, .74), (.40, 1.0), (.68, .96), (.88, .66)]
        spine, left, right = [], [], []
        for k, (t, w) in enumerate(profile):
            c = root+axis*t+normal*length*bend*math.sin(math.pi*t*.9)
            wl = w*width*(.45 if notch and k == notch else 1)
            wr = w*width*(.55 if notch and k == (notch+1) % 4+1 else 1)
            spine.append(c+normal*.005)
            left.append(c+side*wl-axis*.04*t)
            right.append(c-side*wr-axis*.04*t)
        n = len(profile)
        verts = spine+left+right+[tip+normal*length*bend*.3]
        tip_index = len(verts)-1
        faces = []
        for k in range(n-1):
            faces += [(k, n+k, n+k+1, k+1), (k, k+1, 2*n+k+1, 2*n+k)]
        faces += [(n-1, 2*n-1, tip_index), (n-1, tip_index, 3*n-1)]
        obj = mesh(name, verts, faces, slot, 'feather', bone)
        obj.data.materials.append(materials['black'])
        for p in obj.data.polygons:  # the spine's first stretch is darker quill
            p.material_index = 1 if p.index < 2 else 0
        return obj

    def prism(name, outline, thickness, facing, slot, bone, material='edge'):
        """A flat triangle (or quad) outline given thickness along `facing`."""
        outline = [Vector(p) for p in outline]; facing = Vector(facing).normalized()*thickness/2
        n = len(outline)
        verts = [p+facing for p in outline]+[p-facing for p in outline]
        faces = [tuple(range(n)), tuple(reversed(range(n, 2*n)))]
        faces += [(i, n+i, n+(i+1) % n, (i+1) % n) for i in range(n)]
        return mesh(name, verts, faces, slot, material, bone)

    # ---------------------------------------------------------------- hood and mask
    head = pieces['Head'][0]
    head_surface = binding_surface(head)
    # Rows of the cowl: height, half width, half depth, centre depth, half opening at the face (degrees),
    # and how far the opening's rim reaches forward past the mask.
    rows = [(1.462, .158, .158, .018, 30, .010), (1.545, .178, .176, .010, 44, .052), (1.640, .184, .184, .006, 47, .078),
            (1.735, .172, .180, .016, 42, .084), (1.815, .134, .156, .040, 30, .060), (1.872, .074, .104, .078, 18, .020)]
    columns = 14
    verts = []
    for r, (z, rx, ry, yc, opening, brim) in enumerate(rows):
        a0 = math.radians(opening)
        for j in range(columns+1):
            a = a0+(math.tau-2*a0)*j/columns
            p = Vector((rx*math.sin(a), yc-ry*math.cos(a), z))
            front = max(0, math.cos(a))/math.cos(a0)  # 1 at the opening's rim, 0 at the sides and the back
            p += Vector((0, -brim*front**3, 0))
            verts.append(p)
    verts.append(Vector((0, .128, 1.935)))  # the drooping point of the cowl
    faces = [(r*(columns+1)+j, r*(columns+1)+j+1, (r+1)*(columns+1)+j+1, (r+1)*(columns+1)+j)
             for r in range(len(rows)-1) for j in range(columns)]
    top = (len(rows)-1)*(columns+1)
    faces += [(top+j, top+j+1, len(verts)-1) for j in range(columns)]
    hood = mesh('Deep_hood', verts, faces, 'Head', 'cloth')
    if hood.data.polygons[len(faces)//2].normal.dot(hood.data.polygons[len(faces)//2].center-Vector((0, .01, 1.66))) < 0:
        hood.data.flip_normals()
    hood.data.materials.append(materials['black'])
    bpy.context.view_layer.objects.active = hood
    mod = hood.modifiers.new('Hood_lining', 'SOLIDIFY')
    mod.thickness, mod.offset, mod.material_offset, mod.material_offset_rim = .010, -1, 1, 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    attach_to_surface(hood, head_surface)

    # Raven-skull mask: a keeled silver face with a long beak, rigid on Head.
    mask_rows = [(1.748, .082), (1.706, .106), (1.656, .112), (1.606, .101), (1.556, .078), (1.506, .050), (1.462, .024)]
    def mask_point(x, z, u):
        y = -.160+3.4*x*x+max(0, z-1.665)*.75-.016*(1-abs(u))
        if z < 1.53:  # the beak leans forward below the mouth
            y -= (1.53-z)*.34*(1-abs(u)*.6)
        return Vector((x, y, z))
    cols = [-1, -2/3, -1/3, 0, 1/3, 2/3, 1]
    verts = [mask_point(u*half, z, u) for z, half in mask_rows for u in cols]
    verts.append(mask_point(0, 1.400, 0)+Vector((0, -.008, 0)))  # beak tip
    faces = [(r*7+c, r*7+c+1, (r+1)*7+c+1, (r+1)*7+c) for r in range(len(mask_rows)-1) for c in range(6)]
    last = (len(mask_rows)-1)*7
    faces += [(last+c, last+c+1, len(verts)-1) for c in range(6)]
    mask = mesh('Raven_mask', verts, faces, 'Head', 'plate', 'Head')
    bpy.context.view_layer.objects.active = mask
    mod = mask.modifiers.new('Mask_shell', 'SOLIDIFY')
    mod.thickness, mod.offset = .006, 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if mask.data.polygons[0].normal.y > 0:
        mask.data.flip_normals()
    mask_tree = shell(mask)
    on_mask = onto(mask_tree, -1, .002)
    for sign in [-1, 1]:
        P = lambda x, z: on_mask(Vector((sign*x, 0, z)))
        eye = [P(.010, 1.662), P(.036, 1.686), P(.086, 1.700), P(.104, 1.664), P(.080, 1.616), P(.030, 1.618)]
        c = sum(eye, Vector())/6
        # The hollow is a flat dark lens standing proud of the keeled mask (a flat hexagon behind the keel's crease
        # would vanish into the silver), framed by a raised silver rim.
        eye = [p+Vector((0, -.008, 0)) for p in eye]
        rim = [on_mask(c+(p-c)*1.24)+Vector((0, -.005, 0)) for p in eye]
        socket_mesh = mesh('Mask_eye_hollow', eye+rim+[c+Vector((0, -.010, 0))],
                           [(i, (i+1) % 6, 12) for i in range(6)]+[(i, 6+i, 6+(i+1) % 6, (i+1) % 6) for i in range(6)],
                           'Head', 'eyes', 'Head')
        paint(socket_mesh, ['eyes', 'edge'], [0]*6+[1]*6)
        leaf('Mask_brow', P(.006, 1.694), P(.108, 1.716), .013, (sign*.3, -1, .25), 'Head', 'Head', 'edge', .006)
        leaf('Mask_cheek_rune', P(.066, 1.606), P(.020, 1.470), .008, (sign*.4, -1, 0), 'Head', 'Head', 'edge', .003)
        leaf('Mask_nostril', P(.012, 1.560), P(.026, 1.530), .005, (0, -1, 0), 'Head', 'Head', 'eyes', .001)
    leaf('Mask_crest', on_mask(Vector((0, 0, 1.690))), on_mask(Vector((0, 0, 1.752))), .010, (0, -1, .3), 'Head', 'Head', 'edge', .007)

    # ---------------------------------------------------------------- jerkin, breastplate, bandolier
    torso = pieces['Torso'][0]
    surface = binding_surface(torso)
    body = shell(torso)
    chest = onto(body, -1, .016)
    def bridge(p):
        """The frontmost of three neighbouring snaps: the plate spans a cleavage instead of dipping into it."""
        front = min(chest(Vector(p)+Vector((dx, 0, 0))).y for dx in (-.05, 0, .05))
        return Vector((p[0], front, p[2]))
    outline = [(0, 1.428), (.070, 1.438), (.150, 1.405), (.172, 1.330), (.130, 1.252), (.070, 1.205), (0, 1.170)]
    core = [(x, 0, z) for x, z in outline]+[(-x, 0, z) for x, z in reversed(outline[1:-1])]
    breast = plate('Silver_breastplate', core, (0, -1, 0), 'Torso', None, rim=.012, bulge=.034, snap=bridge)
    for j, (z0, z1, half) in enumerate([(1.160, 1.118, .112), (1.112, 1.070, .104)]):  # two gunmetal belly lames
        plate('Belly_lame', [(-half, 0, z0), (half, 0, z0), (half*.92, 0, z1), (-half*.92, 0, z1)], (0, -1, 0), 'Torso', None,
              rim=.007, bulge=.010, material='metal', snap=onto(body, -1, .010))
    # A short ragged mantle over the back: the hood's cloth continues down to the shoulder blades.
    xs = [-.180, -.120, -.060, 0, .060, .120, .180]
    mantle_rows = [(1.462, .018), (1.390, .024), (1.310, .030), (1.235, .036)]
    verts = [onto(body, 1, clear)(Vector((x*(1-.10*r), 0, z-abs(x)*.25*(r == 0))))
             for r, (z, clear) in enumerate(mantle_rows) for x in xs]
    faces = [(r*7+c, r*7+c+1, (r+1)*7+c+1, (r+1)*7+c) for r in range(3) for c in range(6)]
    for c, drop in enumerate([.060, .110, .045, .120, .070, .095]):
        a, b = verts[21+c], verts[21+c+1]
        verts.append(a.lerp(b, .5)+Vector((0, .006, -drop)))
        faces.append((21+c, 21+c+1, len(verts)-1))
    backplate = mesh('Back_mantle', verts, faces, 'Torso', 'cloth')
    # Embossing, own motif: a rune stave with two swept raven wings and a knot medallion.
    on_plate = onto(shell(breast), -1, .002)
    leaf('Breast_stave', on_plate(Vector((0, 0, 1.360))), on_plate(Vector((0, 0, 1.190))), .011, (0, -1, 0), 'Torso', None, 'edge', .006)
    for sign in [-1, 1]:
        for j in range(4):
            a = on_plate(Vector((sign*.014, 0, 1.330-j*.030)))
            b = on_plate(Vector((sign*(.140-j*.018), 0, 1.392-j*.050)))
            leaf('Breast_wing_feather', a, b, .011-j*.0015, (sign*.2, -1, 0), 'Torso', None, 'edge', .005)
    m = on_plate(Vector((0, 0, 1.392)))+Vector((0, -.010, 0))
    ring = [m+Vector((.030*math.cos(k*math.tau/8), 0, .030*math.sin(k*math.tau/8))) for k in range(8)]
    inner = [m+Vector((.019*math.cos(k*math.tau/8), -.004, .019*math.sin(k*math.tau/8))) for k in range(8)]
    medal = mesh('Knot_medallion', ring+inner+[m+Vector((0, -.006, 0)), m+Vector((0, .006, 0))],
                 [(k, (k+1) % 8, 8+(k+1) % 8, 8+k) for k in range(8)]+[(8+k, 8+(k+1) % 8, 16) for k in range(8)]
                 + [((k+1) % 8, k, 17) for k in range(8)], 'Torso', 'edge')
    paint(medal, ['edge', 'metal'], [0]*8+[1]*8+[0]*8)
    for k in range(3):  # a three-armed knot on the medallion
        a = k*math.tau/3+math.pi/2
        leaf('Medallion_knot', m+Vector((0, -.008, 0)), m+Vector((.017*math.cos(a), -.008, .017*math.sin(a))), .005,
             (0, -1, 0), 'Torso', None, 'edge', .003)
    # Bandolier from the right shoulder across the plate to the left hip, and back up behind.
    over = shell(torso, breast, backplate)
    axis_of = lambda p: Vector((p.x*.3, .02, min(max(p.z, 1.0), 1.40)))
    front_run = trace(over, [(-.175, -.02, 1.462), (-.140, -.10, 1.400), (-.050, -.20, 1.300), (.060, -.20, 1.180),
                             (.150, -.10, 1.020)], axis_of, .006)
    back_run = trace(over, [(.150, .12, 1.020), (.060, .20, 1.180), (-.060, .20, 1.320), (-.150, .10, 1.440), (-.175, -.02, 1.462)],
                     axis_of, .006)
    strap('Bandolier', front_run+back_run[1:], .044, 'Torso')
    p, out = front_run[len(front_run)//2]
    tangent = (front_run[len(front_run)//2+1][0]-p).normalized(); side = tangent.cross(out).normalized()
    buckle = [p+out*.004+tangent*dt+side*ds for dt, ds in [(-.022, -.030), (.022, -.030), (.022, .030), (-.022, .030)]]
    plate('Bandolier_buckle', buckle, out, 'Torso', None, rim=.004, bulge=.004, material='metal', trim='edge')
    for k in (2, 4, len(front_run)-3):
        q, o = front_run[k]
        talon('Bandolier_stud', q+o*.002, q+o*.012, .007, 'Torso', None)
    for obj in pieces['Torso'][1:]:
        attach_to_surface(obj, surface)

    # ---------------------------------------------------------------- shoulders
    for sign, side, word in [(1, 'L', 'Left'), (-1, 'R', 'Right')]:
        upper, lower, glove = 'ArmUpper'+word, 'ArmLower'+word, 'Hand'+word
        ub, lb, hb, socket = 'Shoulder_'+side, 'Elbow_'+side, 'Hand_'+side, 'Shoulder_Attachment_'+side
        shoulder = Vector(rig.data.bones[ub].head_local)
        elbow = Vector(rig.data.bones[lb].head_local)
        hand = Vector(rig.data.bones[hb].head_local)
        axis = (elbow-shoulder).normalized(); fore = (hand-elbow).normalized()
        P = lambda x, y, z: Vector((sign*x, y, z))
        first = len(pieces[upper])
        if sign > 0:
            # Left: clawed silver pauldron in two tiers, three hooked claws on its ridge, feathers behind.
            for tier, material, ridge, eave, bulge in [
                    ('Claw_pauldron', 'plate', [(.165, 1.548), (.285, 1.538), (.375, 1.482)],
                     [(.366, -.092, 1.398), (.270, -.128, 1.410), (.170, -.098, 1.458)], .026),
                    ('Claw_pauldron_under', 'metal', [(.215, 1.500), (.330, 1.482), (.405, 1.418)],
                     [(.395, -.088, 1.352), (.300, -.118, 1.365), (.215, -.100, 1.400)], .018)]:
                for facing in [-1, 1]:
                    core = [P(x, .045, z) for x, z in ridge]+[P(x, y if facing < 0 else .090-y, z) for x, y, z in eave]
                    plate(tier, core, (0, facing*.75, .66), upper, socket, rim=.012, bulge=bulge, material=material)
            for k, (x, z, reach, lift) in enumerate([(.200, 1.560, .130, .150), (.278, 1.552, .160, .120), (.352, 1.506, .165, .060)]):
                base = P(x, .030, z)
                talon('Pauldron_claw', base, base+P(reach, -.012, lift), .032-k*.003, upper, socket, 'edge', bend=P(-.35, 0, 1))
            for k in range(5):
                a = math.radians(8+k*16)
                root = P(.190+k*.040, .085, 1.520-k*.012)
                tip = root+P(math.sin(a)*.8, .30, math.cos(a)).normalized()*(.270-k*.018)
                feather('Pauldron_back_feather', root, tip, .044, (0, 1, 0), upper, socket, .08, notch=1+k % 3)
        else:
            # Right: a crown of black feathers over a small gunmetal cap.
            for facing in [-1, 1]:
                ridge = [(.165, 1.530), (.270, 1.522), (.345, 1.470)]
                eave = [(.338, -.080, 1.400), (.250, -.108, 1.418), (.168, -.090, 1.452)]
                core = [P(x, .045, z) for x, z in ridge]+[P(x, y if facing < 0 else .090-y, z) for x, y, z in eave]
                plate('Feather_cap', core, (0, facing*.75, .66), upper, socket, rim=.010, bulge=.020, material='metal', trim='gold')
            for k in range(7):  # the upper fan: from nearly upright at the neck to flat over the arm
                a = math.radians(20+k*10.5)
                root = P(.190+k*.022, .050+(k % 2)*.034, 1.540-k*.007)
                tip = root+P(math.sin(a), .22+(k % 2)*.10, math.cos(a)).normalized()*(.350-k*.014)
                feather('Crown_feather', root, tip, .050, P(0, -1, .1), upper, socket, .10, notch=1+k % 3)
            for k in range(4):  # the lower row lies outward over the arm
                a = math.radians(72+k*8)
                root = P(.220+k*.036, -.030+(k % 2)*.025, 1.500-k*.010)
                tip = root+P(math.sin(a), -.15, math.cos(a)).normalized()*(.230-k*.012)
                feather('Crown_under_feather', root, tip, .044, P(0, -.3, 1), upper, socket, .07, notch=1+(k+1) % 3)
        socketed += pieces[upper][first:]
        # A brown strap on the upper arm, on the arm bone.
        sleeve('Upper_arm_strap', [shoulder+axis*.200, shoulder+axis*.232], [(.074*fit, .070*fit)]*2, upper, ub, 'gold', 8)

        # Bracers: gunmetal shell, silver cuffs, brown straps, a comb of blades on the back of the arm.
        E = lambda u: elbow+fore*(hand-elbow).length*u
        sleeve('Bracer', [E(.12), E(.52), E(.90)], [(a*fit, b*fit) for a, b in [(.078, .074), (.075, .071), (.060, .057)]],
               lower, lb, 'metal', 8)
        sleeve('Bracer_cuff', [E(.88), E(.94)], [(.064*fit, .061*fit)]*2, lower, lb, 'edge', 8)
        sleeve('Bracer_elbow_cuff', [E(.10), E(.16)], [(.081*fit, .077*fit)]*2, lower, lb, 'edge', 8)
        for u in (.34, .66):
            sleeve('Bracer_strap', [E(u), E(u+.06)], [(.080*fit, .076*fit), (.078*fit, .074*fit)], lower, lb, 'gold', 8)
        top = .066*fit
        for k, (u, size) in enumerate([(.20, 1.0), (.36, .75), (.50, .95), (.64, .70), (.78, .80)]):
            a, b = E(u)+UP*(top-.010), E(u+.12)+UP*(top-.010)
            tip = E(u-.02)+UP*(top+.052*size)
            prism('Bracer_blade', [a, b, tip], .008, (0, 1, 0), lower, lb, 'edge')
        # Claw gloves: a gunmetal cuff and knuckle plate, silver talons on every finger end.
        sleeve('Glove_cuff', [hand-fore*.034, hand+fore*.040], [(.064*fit, .060*fit), (.056, .052)], glove, hb, 'metal', 8)
        k0 = hand+Vector((sign*.050, .004, .030))
        plate('Knuckle_plate', [k0-fore*.030+Vector((0, -.040, 0)), k0+fore*.050+Vector((0, -.036, 0)),
              k0+fore*.050+Vector((0, .042, 0)), k0-fore*.030+Vector((0, .046, 0))], (0, 0, 1), glove, hb,
              rim=.006, bulge=.010, material='metal')
        # Talons sit on the finger ends of each body's own hand and take its skinning, so they bend with the fingers.
        hand_lining = pieces[glove][0]
        points = [v.co.copy() for v in hand_lining.data.vertices]
        reach = max(p.x*sign for p in points)
        ends = [p for p in points if p.x*sign > reach-.030]
        low, high = min(p.y for p in ends), max(p.y for p in ends)
        first = len(pieces[glove])
        for k in range(4):
            y = low+.012+(high-low-.024)*k/3
            row = [p for p in ends if abs(p.y-y) < .018] or ends
            base = Vector((sign*(reach-.016), y, max(p.z for p in row)-.008))
            talon('Glove_talon', base, base+Vector((sign*.052, 0, -.024)), .011, glove, None, 'edge', bend=(0, 0, 1))
        thumb = min(points, key=lambda p: p.y)
        out = (thumb-hand).normalized()
        talon('Glove_talon', thumb-out*.012, thumb+out*.040+Vector((0, 0, -.018)), .010, glove, None, 'edge', bend=(0, 0, 1))
        fingers = binding_surface(hand_lining)
        for obj in pieces[glove][first:]:
            attach_to_surface(obj, fingers)

    wing_binding_report = []
    for obj in socketed:
        groups = {g.index: g.name for g in obj.vertex_groups}
        expected = 'Shoulder_Attachment_L' if sum(v.co.x for v in obj.data.vertices) > 0 else 'Shoulder_Attachment_R'
        assert all(len(v.groups) == 1 and groups[v.groups[0].group] == expected and abs(v.groups[0].weight-1) < 1e-7
                   for v in obj.data.vertices), obj.name
        wing_binding_report.append({'mesh': obj.name, 'bone': expected, 'vertices': len(obj.data.vertices), 'weight': 1.0})

    # ---------------------------------------------------------------- double belt, knives, pouch, coat tails
    def on_hips(obj):
        return rigid(obj, {'Hips': 1})

    def belt(name, z, height, rx, ry, tilt=0, material='gold', segments=16):
        """Closed flat band; tilt lowers it toward the right hip (-X)."""
        verts = []
        for j in range(segments):
            a = j*math.tau/segments
            dz = tilt*math.sin(a)
            for dr, h in [(0, 0), (0, height), (-.006, height), (-.006, 0)]:
                verts.append(Vector(((rx+dr)*math.sin(a), .015-(ry+dr)*math.cos(a), z+dz+h)))
        faces = [(j*4+e, j*4+(e+1) % 4, ((j+1) % segments)*4+(e+1) % 4, ((j+1) % segments)*4+e)
                 for j in range(segments) for e in range(4)]
        return on_hips(mesh(name, verts, faces, 'Hips', material))

    def ring_point(a, rx, ry, z):
        return Vector((rx*math.sin(a), .015-ry*math.cos(a), z)), Vector((math.sin(a)*ry, -math.cos(a)*rx, 0)).normalized()

    def hang(obj, left, share):
        """Belt line on Hips; below it the thigh takes `share` of what the hips give up."""
        for v in obj.data.vertices:
            hip = min(1, max(0, (v.co.z-.74)/.17))
            leg = (1-hip)*share
            for name, weight in [('Hips', 1-leg), ('UpperLeg_L', leg*left), ('UpperLeg_R', leg*(1-left))]:
                if weight > 0:
                    (obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)).add([v.index], weight, 'REPLACE')

    TEETH = [.075, .034, .092, .048, .064, .028]
    def coat_tail(name, angle, half, bottom, share, flare, lift, seed):
        out = Vector((math.sin(angle), -math.cos(angle), 0)); along = Vector((math.cos(angle), math.sin(angle), 0))
        anchor, _ = ring_point(angle, .182, .148, 0)
        anchor += out*lift
        rows, verts = 6, []
        for r in range(rows):
            f = r/(rows-1)
            c = anchor+out*flare*f**1.3+Vector((0, 0, .948+(bottom-.948)*f))
            width = half*(1+.18*f)
            for k, s in enumerate([-1, -.5, 0, .5, 1]):
                w = width*s
                if r == 3 and k == (0 if seed % 2 else 4):  # one torn notch in the side
                    w *= .62
                verts.append(c+along*w+out*.010*(1-s*s))
        faces = [(r*5+k, r*5+k+1, (r+1)*5+k+1, (r+1)*5+k) for r in range(rows-1) for k in range(4)]
        last = (rows-1)*5
        for k in range(4):
            a, b = verts[last+k], verts[last+k+1]
            verts.append(a.lerp(b, .5)+Vector((0, 0, -TEETH[(k+seed) % len(TEETH)]))+out*.006)
            faces.append((last+k, last+k+1, len(verts)-1))
        obj = mesh(name, verts, faces, 'Hips', 'cloth')
        paint(obj, ['cloth', 'leather'], [1 if i < 4 else 0 for i in range(len(faces))])
        hang(obj, 1 if angle > 0 else 0, share)
        return obj

    for sign in [1, -1]:
        seed = 0 if sign > 0 else 3
        coat_tail('Front_coat_tail', sign*math.radians(30), .064, .440, 1.0, .050, 0, seed)
        coat_tail('Side_coat_tail', sign*math.radians(68), .072, .400, .80, .062, .006, seed+1)
        # The rear tails end at the knee and give the thigh a real share: hanging from the hips alone, a long tail
        # went 19 cm through the floor in a crouch (the pelvis drops about 40 cm).
        coat_tail('Rear_side_coat_tail', sign*math.radians(108), .074, .380, .65, .085, 0, seed+2)
        coat_tail('Rear_coat_tail', sign*math.radians(150), .072, .400, .55, .100, .006, seed+3)
    belt('Waist_belt', .932, .040, .160, .192)
    belt('Hip_belt', .862, .036, .178, .208, tilt=.022)
    for z, y in [(.952, -.163), (.872, -.186)]:
        plate('Belt_buckle', [(-.026, y, z+.024), (.026, y, z+.024), (.026, y, z-.020), (-.026, y, z-.020)], (0, -1, 0),
              'Hips', 'Hips', rim=.005, bulge=.006, material='metal')
    for j in range(12):
        a = math.radians(-150+j*25)
        if abs(math.degrees(a)) < 14:
            continue
        p, out = ring_point(a, .164, .196, .952)
        on_hips(talon('Belt_stud', p+out*.002, p+out*.010, .006, 'Hips', 'Hips'))
    # Three throwing knives on the left hip, hanging from the hip belt.
    for k in range(3):
        a = math.radians(66+k*15)
        p, out = ring_point(a, .186, .216, .868+.022*math.sin(a))
        down = (Vector((0, 0, -1))+out*.10).normalized()
        grip = p+out*.012
        on_hips(branch('Knife_grip', [grip+UP*.018, grip-UP*.030, grip+down*.058], [.009, .010, .008], 'Hips', 'Hips', 'black', 4))
        tangent = UP.cross(out).normalized()
        g = grip+down*.062
        on_hips(prism('Knife_guard', [g+tangent*.020, g-tangent*.020, g-tangent*.020+down*.008, g+tangent*.020+down*.008],
                      .010, out, 'Hips', 'Hips', 'metal'))
        s = g+down*.010
        blade = [s+tangent*.016, s+down*.050+tangent*.020, s+down*.120, s+down*.050-tangent*.020, s-tangent*.016]
        on_hips(prism('Knife_blade', blade, .004, out, 'Hips', 'Hips', 'red'))
        on_hips(mesh('Knife_loop', [grip+UP*.030+tangent*.012+out*d for d in (0, .006)]
                     + [grip+UP*.030-tangent*.012+out*d for d in (.006, 0)]
                     + [grip-UP*.004+tangent*.012+out*d for d in (0, .006)]
                     + [grip-UP*.004-tangent*.012+out*d for d in (.006, 0)],
                     [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'Hips', 'gold'))
    # A small leather pouch on the right hip.
    p, out = ring_point(math.radians(-80), .188, .214, .820)
    tangent = UP.cross(out).normalized()
    box = [p+tangent*dx+UP*dz+out*dy for dz in (0, .075) for dx, dy in [(-.036, 0), (.036, 0), (.036, .040), (-.036, .040)]]
    on_hips(mesh('Belt_pouch', box, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 'Hips', 'leather'))
    flap = [p+tangent*dx+UP*dz+out*dy for dx, dy, dz in [(-.038, .043, .077), (.038, .043, .077), (.030, .046, .038),
                                                         (0, .047, .026), (-.030, .046, .038)]]
    on_hips(plate('Pouch_flap', flap, out, 'Hips', 'Hips', rim=.004, bulge=.004, material='leather', trim='gold'))

    # ---------------------------------------------------------------- tall boots
    for slot in ['LegLeft', 'LegRight']:
        source = pieces[slot][0]
        x = .113 if sum(v.co.x for v in source.data.vertices) > 0 else -.113
        s = 1 if x > 0 else -1
        side = 'L' if x > 0 else 'R'
        sleeve('Boot_shaft', [(x, .020, .100), (x, .020, .250), (x, .022, .372)],
               [(.090, .082), (.106, .088), (.112, .092)], slot, 'LowerLeg_'+side, 'leather', 10)
        sleeve('Boot_cuff', [(x, .022, .360), (x, .022, .405)], [(.120, .098), (.124, .102)], slot, 'LowerLeg_'+side, 'black', 10)
        for z, r in [(.150, (.098, .086)), (.225, (.108, .090)), (.300, (.113, .094))]:
            sleeve('Boot_strap', [(x, .020, z), (x, .020, z+.026)], [(r[0]+.006, r[1]+.006)]*2, slot, 'LowerLeg_'+side, 'gold', 10)
            plate('Boot_buckle', [(x+s*(r[1]+.008), -.020, z+.030), (x+s*(r[1]+.008), .020, z+.030),
                  (x+s*(r[1]+.008), .020, z-.004), (x+s*(r[1]+.008), -.020, z-.004)], (s, 0, 0), slot, None,
                  rim=.003, bulge=.004, material='metal')
        plate('Shin_fitting', [(x-.040, -.112, .352), (x+.040, -.112, .352), (x+.032, -.104, .250), (x, -.098, .215),
              (x-.032, -.104, .250)], (0, -1, 0), slot, None, rim=.008, bulge=.014, material='plate')
        outline = [(-.078, .128), (.078, .128), (.084, -.070), (.050, -.182), (-.050, -.182), (-.084, -.070)]
        verts = [(x+dx, y, z) for z in [-.004, .030] for dx, y in outline]
        mesh('Boot_sole', verts, [tuple(reversed(range(6))), tuple(range(6, 12))]
             + [(i, (i+1) % 6, (i+1) % 6+6, i+6) for i in range(6)], slot, 'black')
        top = [(x-.078, -.060, .078), (x+.078, -.060, .078), (x+.074, -.136, .058), (x+.030, -.192, .040),
               (x-.030, -.192, .040), (x-.074, -.136, .058)]
        mesh('Silver_toecap', top+[(x, -.118, .104), (x, -.120, .028)],
             [(i, (i+1) % 6, 6) for i in range(6)]+[(i, 7, (i+1) % 6) for i in range(6)], slot, 'plate')
        sleeve('Instep_strap', [(x, -.040, .070), (x, -.020, .110)], [(.070, .086)]*2, slot, 'Ankle_'+side, 'gold', 8)
        leg_surface = binding_surface(source)
        for obj in pieces[slot][1:]:
            attach_to_surface(obj, leg_surface)

    def triangles(obj):
        obj.data.calc_loop_triangles()
        return len(obj.data.loop_triangles)

    budget = sum(triangles(obj) for objects in pieces.values() for obj in objects)
    assert budget <= 10000, budget  # checked here, before the tail renders or exports anything
    ctx.wing_binding_report = wing_binding_report
    ctx.budget = budget


def after_export(ctx):
    ROOT, QUICK, PARTS, armor, report, budget = ctx.ROOT, ctx.QUICK, ctx.PARTS, ctx.armor, ctx.report, ctx.budget
    cam, camera, render, target, equipment = ctx.cam, ctx.camera, ctx.render, ctx.target, ctx.equipment
    name = CONFIG['name']
    for image, location in [('04_%s_Side' % name, (7, 0, 1.65))]+([('02_%s_Front' % name, (0, -7, 1.65)),
                                                                 ('03_%s_Back' % name, (-2.55, 7, 2.7))] if QUICK else []):
        cam.data.ortho_scale = CONFIG['camera_scale']; cam.location = location; target(cam, (0, 0, 1.05)); render(image)
    camera()
    names = set()
    for obj in armor.values():
        obj.data.calc_loop_triangles()
        for triangle in obj.data.loop_triangles:
            names.add(obj.data.materials[obj.data.polygons[triangle.polygon_index].material_index].name)
    glowing = []
    for material in names:
        shader = bpy.data.materials[material].node_tree.nodes.get('Principled BSDF')
        if shader.inputs['Emission Strength'].default_value > 0 and any(shader.inputs['Emission Color'].default_value[:3]):
            glowing.append(material)
    assert not glowing, glowing
    report['items'] = {part['item']: sum(report['slots'][s]['triangles'] for s in part['regions']) for part in PARTS}
    report['materials_used'] = sorted(names)
    report['emissive_materials'] = glowing
    assert report['total_triangles'] == budget, (report['total_triangles'], budget)
    report.pop('wing_effect', None)
    report['shoulder_socket_binding'] = report.pop('wing_binding')
    report['vfx'] = equipment['vfx']
    (ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
