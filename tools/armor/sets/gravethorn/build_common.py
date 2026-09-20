"""Build original Gravethorn replacement armor; reuse the proven fitting/export scaffold.

Shared implementation. Run it through the per-body entry points male/build.py and
female/build.py (the latter appends --female). Directly:
Blender -b WoV_BodyBase_{Male,Female}.blend --python THIS -- OUTPUT [--female] [--quick]
Only the common initialization/helpers and final validation/export sections are reused.
The Seidraven design section is never executed. Markers are asserted to fail closed.

Design: heavy grey-green grave steel whose pale bone rims run out into flame-shaped
thorns. Closed raven-beak helm with blade horns and a centre comb, stacked pauldrons
that carry a wolf skull and an upright blade, red gems on chest, belt and back, a
split plate skirt and a long back banner. Every glowing part (eyes, gems, skull eyes,
horn and skull flames) is emissive geometry that belongs to its item.

--quick keeps the scaffold's meaning (hero image, no pose checks, no GLBs, no .blend)
and adds cheap front, back and side review images. The shoulders are bound in three
steps: crown tier, wolf skull and blade are rigid on Shoulder_Attachment_L/R, the
middle tier is shared half and half with the upper arm, the great tier follows the
upper arm. So a raised arm lifts the lower plates instead of passing through them,
and nothing travels with the forearm. The helm horns are rigid on Head.
"""
from pathlib import Path

scaffold = (Path(__file__).resolve().parent.parent / 'seidraven' / 'build_common.py').read_text()
start = '# New geometry inspired by the supplied silhouette'
end = '# Join each replacement region and bind every component'
assert scaffold.count(start) == scaffold.count(end) == 1
scaffold = scaffold.replace('Seidraven', 'Gravethorn').replace('seidraven', 'gravethorn')
exec(compile(scaffold.split(start)[0], 'armor-common-initialization', 'exec'))

# Grave steel, bone rims, oxblood wool, charcoal banner cloth and a red glow.
EMISSIVE = {'red': 2.5, 'eyes': 3.5, 'glow': 2.5, 'core': 4}
colors = {'cloth': (.060, .009, .013), 'leather': (.017, .016, .015), 'plate': (.105, .128, .104),
          'metal': (.038, .047, .042), 'edge': (.27, .255, .195), 'gold': (.20, .185, .14),
          'black': (.004, .004, .005), 'feather': (.020, .022, .025),
          'red': (.90, .006, .010), 'eyes': (1, .020, .008), 'glow': (.85, .012, .006), 'core': (1, .075, .018)}
finish = {'plate': (.52, .50), 'metal': (.48, .55), 'edge': (.66, .04), 'gold': (.74, .04)}  # roughness, metallic
for name, color in colors.items():
    mat = materials[name]; mat.diffuse_color = (*color, 1)
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    if name in finish:
        shader.inputs['Roughness'].default_value, shader.inputs['Metallic'].default_value = finish[name]
    if name in EMISSIVE:
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = EMISSIVE[name]
for part, label in zip(PARTS, ['Grabdorn-Hörnerhelm', 'Grabdorn-Wolfsschultern', 'Grabdorn-Dornenharnisch',
                               'Grabdorn-Armschienen', 'Grabdorn-Panzerhandschuhe', 'Grabdorn-Plattenschurz',
                               'Grabdorn-Dornenstiefel']):
    part['label'] = label
    part['vfx'] = {'emissive': True, 'profile': 'gravethorn_red', 'attachedToItem': True}


def paint(obj, names, indices):
    """Face materials by index; names[0] is the material mesh() already assigned."""
    for name in names[1:]:
        obj.data.materials.append(materials[name])
    for polygon in obj.data.polygons:
        polygon.material_index = indices[polygon.index]


def hugger(surface, facing, clear, axis=1):
    """Map a point to the body lining seen along Y (front -1, back +1) or along X (axis=0: right -1, left +1)."""
    tree = surface[0]
    def snap(p):
        eye = Vector(p); eye[axis] = facing*2
        aim = Vector((0, 0, 0)); aim[axis] = -facing
        hit = tree.ray_cast(eye, aim)[0]
        if hit is None:
            eye[axis] = facing*.3; hit = tree.find_nearest(eye)[0]
        q = Vector(p); q[axis] = hit[axis]+facing*clear
        return q
    return snap


HOOKS = [(1.0, .42), (.48, .60), (.74, .47)]  # relative length, position on its stretch of the edge


def thorn_plate(name, core, normal, slot, bone, teeth=None, rim=.013, bulge=.012, back=.005,
                flow=(0, 0, -1), length=.04, material='plate', trim='edge', snap=None):
    """Faceted plate with a pale rim; the listed core edges grow flame teeth swept along flow."""
    core = [Vector(p) for p in core]; n = len(core)
    normal = Vector(normal).normalized(); flow = Vector(flow)
    centre = sum(core, Vector())/n
    def outward(p):
        d = p-centre
        return (d-normal*d.dot(normal)).normalized()
    flat = core+[p+outward(p)*rim for p in core]+[centre, centre]
    lift = [.004]*n+[0]*n+[bulge, -back]
    faces, index = [], []
    for i in range(n):
        j = (i+1) % n
        faces += [(i, j, 2*n), (i, n+i, n+j, j), (n+j, n+i, 2*n+1)]; index += [0, 1, 0]
    sweep = flow.normalized() if flow.length else Vector()
    for i, count in (teeth or {}).items():
        a0, b0 = flat[n+i], flat[n+(i+1) % n]
        out = outward((a0+b0)/2)
        for k in range(count):
            # Unequal hooks with a knee, and rim left bare between them: thorns, not a saw blade.
            size, place = HOOKS[(k+i) % len(HOOKS)]
            sa, sb = a0.lerp(b0, k/count), a0.lerp(b0, (k+1)/count)
            c = sa.lerp(sb, place); half = (sb-sa)*(.20+.17*size); reach = length*size
            knee = c+out*reach*.45+sweep*reach*.08
            tip = knee+(out*.30+sweep).normalized()*reach*.62
            at = len(flat)
            flat += [c-half, c+half, knee+half*.50, knee-half*.50, tip]; lift += [0, 0, .005, .005, 0]
            faces += [(at, at+1, at+2, at+3), (at+3, at+2, at+4)]; index += [1, 1]
    verts = [(snap(p) if snap else p)+normal*h for p, h in zip(flat, lift)]
    obj = mesh(name, verts, faces, slot, material, bone)
    paint(obj, [material, trim], index)
    return obj


def blade(name, spine, widths, outer, thick, slot, bone, facing=(0, 1, 0), material='plate', trim='edge'):
    """Flat crescent across `facing`: kite section, the outer edge carries the pale trim."""
    spine = [Vector(p) for p in spine]; facing = Vector(facing).normalized(); outer = Vector(outer)
    thick = thick if isinstance(thick, (list, tuple)) else [thick]*len(widths)
    verts, faces, index = [], [], []
    for k, width in enumerate(widths):
        tangent = (spine[k+1]-spine[max(k-1, 0)]).normalized()
        side = tangent.cross(facing).normalized()
        if side.dot(outer) < 0:
            side = -side
        c = spine[k]; depth = facing*thick[k]
        verts += [c+side*width, c+side*width*.35+depth, c-side*width, c+side*width*.35-depth]
    rings = len(widths)
    for k in range(rings-1):
        for e in range(4):
            a, b = k*4+e, k*4+(e+1) % 4
            faces.append((a, b, b+4, a+4)); index.append(1 if e in (0, 3) else 0)
    verts.append(spine[-1]); last = (rings-1)*4
    for e in range(4):
        faces.append((last+e, last+(e+1) % 4, len(verts)-1)); index.append(1 if e in (0, 3) else 0)
    faces.append((3, 2, 1, 0)); index.append(0)
    obj = mesh(name, verts, faces, slot, material, bone)
    paint(obj, [material, trim], index)
    return obj


def thorn(name, base, tip, width, slot, bone, material='edge'):
    a, b = Vector(base), Vector(tip); axis = (b-a).normalized()
    u = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()*width
    v = axis.cross(u).normalized()*width
    return mesh(name, [a+u, a-u*.5+v*.87, a-u*.5-v*.87, b], [(0, 1, 3), (1, 2, 3), (2, 0, 3), (2, 1, 0)],
                slot, material, bone)


def gem(name, centre, radius, normal, slot, bone, sides=8):
    """Domed red stone in a pale setting; it lies on a plate, so it has no back."""
    centre = Vector(centre); normal = Vector(normal).normalized()
    u = normal.cross(Vector((0, 0, 1))).normalized(); v = normal.cross(u)
    ring = lambda r, h: [centre+(u*math.cos(k*math.tau/sides)+v*math.sin(k*math.tau/sides))*r+normal*h
                         for k in range(sides)]
    verts = ring(radius, .006)+ring(radius*1.5, 0)+[centre+normal*radius*.6]
    faces = [(i, (i+1) % sides, 2*sides) for i in range(sides)]
    faces += [(i, sides+i, sides+(i+1) % sides, (i+1) % sides) for i in range(sides)]
    obj = mesh(name, verts, faces, slot, 'red', bone)
    paint(obj, ['red', 'edge'], [0]*sides+[1]*sides)
    return obj


def flame(name, base, height, slot, bone, lean=(0, .25, 0)):
    """Three unequal emissive tongues and a short core; geometry of the item, no particles and no light."""
    lean = Vector(lean)
    for tag, material, scale, shift, bend in [('', 'glow', 1, (0, 0, 0), 1), ('_side', 'glow', .62, (.30, .22, 0), 1.9),
                                              ('_low', 'glow', .40, (-.30, -.10, 0), -1.2), ('_core', 'core', .34, (0, -.16, .04), .6)]:
        h = height*scale; b = Vector(base)+Vector(shift)*height
        points = [b+lean*bend*h*t*t+Vector((sway*h, 0, t*h)) for t, sway in [(0, 0), (.3, .10), (.65, -.07), (1, .05)]]
        branch(name+tag, points, [.09*h, .16*h, .09*h, .004], slot, bone, material, 4)


# Dorned harness: breast and back plates hug each body's own lining; the belly stays wool.
surface = binding_surface(pieces['Torso'][0])
chest, back = hugger(surface, -1, .020), hugger(surface, 1, .020)
for sign in [-1, 1]:
    P = lambda x, z: (sign*x, 0, z)
    thorn_plate('Thorned_breastplate', [P(-.004, 1.452), P(.125, 1.468), P(.212, 1.400), P(.196, 1.300),
                P(.118, 1.232), P(-.004, 1.198)], (0, -1, 0), 'Torso', None, {3: 1, 4: 2}, bulge=.052,
                flow=(-sign*.6, 0, -1), length=.075, snap=chest)
    thorn_plate('Underbreast_lame', [P(-.004, 1.238), P(.120, 1.262), P(.202, 1.318), P(.194, 1.226),
                P(.112, 1.168), P(-.004, 1.148)], (0, -1, 0), 'Torso', None, {3: 1, 4: 2}, bulge=.034,
                flow=(-sign*.5, 0, -1), length=.050, material='metal', snap=hugger(surface, -1, .012))
    thorn_plate('Back_lame', [P(.060, 1.252), P(.192, 1.286), P(.186, 1.100), P(.072, 1.060)], (0, 1, 0),
                'Torso', None, {2: 2}, bulge=.028, flow=(-sign*.4, 0, -1), length=.050, material='metal',
                snap=hugger(surface, 1, .012))
    thorn_plate('Flank_plate', [P(.095, 1.205), P(.185, 1.245), P(.178, 1.060), P(.105, 1.010)], (0, -1, 0),
                'Torso', None, {2: 1, 3: 2}, bulge=.016, flow=(-sign*.7, 0, -.8), length=.055,
                material='metal', snap=hugger(surface, -1, .012))
    thorn_plate('Gem_wing', [P(.030, 1.338), P(.070, 1.383), P(.168, 1.418), P(.112, 1.340), P(.058, 1.300)],
                (0, -1, 0), 'Torso', None, {2: 3, 3: 1}, rim=.009, bulge=.008, flow=(sign*.4, 0, -1),
                length=.034, material='metal', snap=hugger(surface, -1, .040))
    thorn_plate('Thorned_backplate', [P(-.004, 1.462), P(.140, 1.466), P(.212, 1.400), P(.190, 1.268),
                P(.100, 1.200), P(-.004, 1.238)], (0, 1, 0), 'Torso', None, {3: 1, 4: 2}, bulge=.044,
                flow=(-sign*.6, 0, -1), length=.070, snap=back)
    thorn_plate('Side_plate', [(0, -.085, 1.300), (0, .110, 1.300), (0, .095, 1.030), (0, -.070, 1.030)], (sign, 0, 0),
                'Torso', None, {2: 2}, rim=.011, bulge=.020, flow=(0, 0, -1), length=.036,
                snap=hugger(surface, sign, .010, axis=0))
for row, z in enumerate([1.150, 1.095, 1.040]):
    points = [chest(Vector((x, 0, z+abs(x)*.22))) for x in [-.135, 0, .135]]
    branch('Belly_wrap_seam', points, [.0045]*3, 'Torso', None, 'leather', 4)
gem('Heart_gem', chest(Vector((0, 0, 1.338)))+Vector((0, -.024, 0)), .036, (0, -1, 0), 'Torso', None)
thorn('Heart_fang', chest(Vector((0, 0, 1.292)))+Vector((0, -.020, 0)),
      chest(Vector((0, 0, 1.205)))+Vector((0, -.012, 0)), .017, 'Torso', None)
# The gorget is soft on purpose: like every torso part it takes the lining's weights below, so it rises with the clavicles.
sleeve('Gorget', [(0, .022, 1.440), (0, .020, 1.515)], [(.138, .162), (.104, .116)], 'Torso', None, 'metal', 10)
sleeve('Gorget_bone_rim', [(0, .020, 1.509), (0, .020, 1.521)], [(.107, .119)]*2, 'Torso', None, 'edge', 10)
# Back banner, upper half: charcoal cloth with a bone border and a small winged gem.
banner = hugger(surface, 1, .036)
rows = [(1.335, .106), (1.215, .082), (1.095, .114), (.975, .084)]  # waisted, then flared: not a plain rectangle
verts = [banner(Vector((x, 0, z))) for z, half in rows for x in [-half, .016-half, 0, half-.016, half]]
faces = [(r*5+c, r*5+c+1, (r+1)*5+c+1, (r+1)*5+c) for r in range(3) for c in range(4)]
paint(mesh('Back_banner', verts, faces, 'Torso', 'feather'), ['feather', 'edge'], [1, 0, 0, 1]*3)
emblem = hugger(surface, 1, .044)
gem('Banner_gem', emblem(Vector((0, 0, 1.352))), .017, (0, 1, 0), 'Torso', None)
for sign in [-1, 1]:
    for j in range(3):
        leaf('Banner_raven_wing', emblem(Vector((sign*.024, 0, 1.358-j*.010))),
             emblem(Vector((sign*(.088+j*.016), 0, 1.412-j*.032))), .012, (0, 1, 0), 'Torso', None, 'edge', .004)
thorn('Banner_fang', emblem(Vector((0, 0, 1.322))), emblem(Vector((0, 0, 1.258))), .011, 'Torso', None)
for sign in [-1, 1]:  # counter hooks where the banner is widest
    thorn('Banner_hook', banner(Vector((sign*.108, 0, 1.100))), banner(Vector((sign*.168, 0, 1.040))), .014, 'Torso', None)
    thorn('Banner_hook', banner(Vector((sign*.100, 0, 1.325))), banner(Vector((sign*.150, 0, 1.290))), .011, 'Torso', None)
for obj in pieces['Torso'][1:]:
    attach_to_surface(obj, surface)


# Split plate skirt: every panel hangs from the belt and follows its own leg below it.
def hang_weights(obj, left=None):
    """Hips at the belt, the legs below it; left=None blends the two legs across the centre."""
    share = left
    for v in obj.data.vertices:
        hip = min(1, max(0, (v.co.z-.74)/.17))
        left = min(1, max(0, .5+v.co.x/.16)) if share is None else share
        for name, weight in [('Hips', hip), ('UpperLeg_L', (1-hip)*left), ('UpperLeg_R', (1-hip)*(1-left))]:
            if weight > 0:
                (obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)).add([v.index], weight, 'REPLACE')


def thorn_panel(name, angle, half, bottom, left, material='plate', flare=.055, tooth=.066, rows=5,
                shift=0, lift=0, sides=(-1, 1)):
    out = Vector((math.sin(angle), -math.cos(angle), 0)); along = Vector((math.cos(angle), math.sin(angle), 0))
    anchor = Vector((.206*math.sin(angle), .015-.178*math.cos(angle), 0))+along*shift+out*lift
    verts, faces, index = [], [], []
    for r in range(rows):
        f = r/(rows-1)
        width = half*(1+.20*math.sin(f*math.pi))*(1 if r < rows-1 else .80)
        c = anchor+out*flare*f+Vector((0, 0, .925+(bottom+.095-.925)*f))
        verts += [c+along*width*s+out*h for s, h in [(-1, 0), (-.70, .005), (0, .016), (.70, .005), (1, 0)]]
    for r in range(rows-1):
        for col in range(4):
            a = r*5+col
            faces.append((a, a+1, a+6, a+5)); index.append(1 if col in (0, 3) else 0)
    verts.append(anchor+out*flare*1.08+Vector((0, 0, bottom))); last = (rows-1)*5
    for col in range(4):
        faces.append((last+col, last+col+1, len(verts)-1)); index.append(1)
    for r in range(rows-1):
        for s, col in [(s, 0 if s < 0 else 4) for s in sides]:
            size, place = HOOKS[(r+col) % len(HOOKS)]
            a, b = verts[r*5+col], verts[(r+1)*5+col]; c = a.lerp(b, place); span = (b-a)*(.20+.17*size)
            knee = c+along*s*tooth*size*.40+Vector((0, 0, -tooth*size*.30))+out*.005
            tip = knee+(along*s*.45+Vector((0, 0, -1))).normalized()*tooth*size*.85
            at = len(verts)
            verts += [c-span, c+span, knee+span*.5, knee-span*.5, tip]
            faces += [(at, at+1, at+2, at+3), (at+3, at+2, at+4)]; index += [1, 1]
    obj = mesh(name, verts, faces, 'Hips', material)
    paint(obj, [material, 'edge'], index)
    hang_weights(obj, left)
    return obj


for sign, left in [(1, 1), (-1, 0)]:
    thorn_panel('Front_tasset', sign*math.radians(30), .064, .50, left)
    thorn_panel('Side_tasset', sign*math.radians(90), .078, .55, left)
    thorn_panel('Rear_tasset', sign*math.radians(146), .062, .50, left)
    thorn_panel('Front_hip_lame', sign*math.radians(30), .074, .66, left, 'metal', flare=.040, tooth=.050, rows=3, lift=.016)
    thorn_panel('Side_hip_lame', sign*math.radians(90), .088, .68, left, 'metal', flare=.040, tooth=.050, rows=3, lift=.016)
    thorn_panel('Rear_hip_lame', sign*math.radians(146), .072, .66, left, 'metal', flare=.040, tooth=.050, rows=3, lift=.016)
    # The centre cloth is two overlapping halves, one per leg: a single strip would be stretched between the thighs.
    thorn_panel('Front_tabard', 0, .024, .50, left, 'feather', flare=.030, tooth=.030, shift=sign*.016,
                lift=.003*(sign+1), sides=(sign,))
    thorn_panel('Back_banner_tail', math.pi, .056, .40, left, 'feather', flare=.050, tooth=.052, shift=-sign*.044,
                lift=.003*(sign+1), sides=(-sign,))
ring = 12
verts = [(.192*f*math.sin(j*math.tau/ring), .015-.164*f*math.cos(j*math.tau/ring), z)
         for z, f in [(.925, 1), (.800, 1.05), (.675, 1.10)] for j in range(ring)]
faces = [(r*ring+j, r*ring+(j+1) % ring, (r+1)*ring+(j+1) % ring, (r+1)*ring+j) for r in range(2) for j in range(ring)]
hang_weights(mesh('Charcoal_underskirt', verts, faces, 'Hips', 'feather'))
sleeve('War_belt', [(0, .015, .900), (0, .015, .978)], [(.172, .201)]*2, 'Hips', 'Hips', 'leather', 12)
sleeve('Belt_bone_rim', [(0, .015, .972), (0, .015, .984)], [(.175, .204)]*2, 'Hips', 'Hips', 'edge', 12)
thorn_plate('Belt_shield', [(-.058, -.172, .985), (.058, -.172, .985), (.076, -.172, .935), (0, -.172, .850),
            (-.076, -.172, .935)], (0, -1, 0), 'Hips', 'Hips', {2: 2, 3: 2}, bulge=.012, length=.040,
            flow=(0, 0, -.8), material='metal')
gem('Belt_gem', (0, -.188, .936), .026, (0, -1, 0), 'Hips', 'Hips')

# Stacked pauldrons: crown rigid on the socket, middle tier shared, great tier on the upper arm.
socketed = []
for sign, side, word in [(1, 'L', 'Left'), (-1, 'R', 'Right')]:
    shoulder = Vector(rig.data.bones['Shoulder_'+side].head_local)
    elbow = Vector(rig.data.bones['Elbow_'+side].head_local)
    hand = Vector(rig.data.bones['Hand_'+side].head_local)
    axis = (elbow-shoulder).normalized(); fore = (hand-elbow).normalized(); up = Vector((0, 0, 1))
    upper, lower, glove = 'ArmUpper'+word, 'ArmLower'+word, 'Hand'+word
    ub, lb, hb, socket = 'Shoulder_'+side, 'Elbow_'+side, 'Hand_'+side, 'Shoulder_Attachment_'+side
    fit = .90 if VARIANT == 'Female' else 1
    first = len(pieces[upper])
    P = lambda x, y, z: Vector((sign*x, y, z))
    tiers = [('Great_pauldron', 'plate', .016, .036, .092, {ub: 1}, [(.205, 1.532), (.410, 1.518), (.548, 1.455)],
              [(.500, -.140, 1.300), (.350, -.205, 1.285), (.215, -.160, 1.385)]),
             ('Middle_pauldron', 'metal', .014, .032, .080, {ub: .25, socket: .75}, [(.150, 1.590), (.365, 1.584), (.545, 1.488)],
              [(.470, -.118, 1.392), (.315, -.178, 1.384), (.160, -.125, 1.462)]),
             ('Crown_pauldron', 'plate', .012, .022, .052, {socket: 1}, [(.160, 1.630), (.285, 1.628), (.390, 1.568)],
              [(.338, -.070, 1.492), (.255, -.112, 1.486), (.165, -.080, 1.530)])]
    for tier, material, rim, bulge, length, share, ridge, eave in tiers:
        for facing in [-1, 1]:  # the rear half mirrors the front about the arm axis y=.045
            core = [P(x, .045, z) for x, z in ridge]+[P(x, y if facing < 0 else .090-y, z) for x, y, z in eave]
            obj = thorn_plate(tier, core, (0, facing*.75, .66), upper, None, {2: 1, 3: 2, 4: 2}, rim=rim,
                              bulge=bulge, flow=(sign*.9, 0, -.7), length=length, material=material)
            for group, weight in share.items():
                obj.vertex_groups.new(name=group).add(list(range(len(obj.data.vertices))), weight, 'REPLACE')
            if share == {socket: 1}:
                socketed.append(obj)
            if tier == 'Great_pauldron':  # a bone rib breaks the large face
                rib = leaf('Great_pauldron_rib', core[1].lerp(core[0], .25)+Vector((0, facing*.020, .016)),
                           core[4]+Vector((0, facing*.012, .030)), .016, (0, facing*.75, .66), upper, ub, 'edge', .010)
    first = len(pieces[upper])
    h = P(.83, -.55, 0)  # the blade stands diagonally, readable from the front and from the side
    foot = P(.235, .120, 1.575)
    blade('Pauldron_blade', [foot, foot+h*.075+up*.120, foot+h*.085+up*.225, foot+h*.045+up*.315],
          [.078, .062, .036], h, [.024, .020, .011], upper, socket, facing=P(.55, .83, 0))
    # Wolf skull lying on the crown tier, muzzle outward: own motif, bone with two burning eyes.
    snout = P(.80, -.45, -.40).normalized(); wide = snout.cross(up).normalized(); high = wide.cross(snout)
    origin = P(.262, .030, 1.640)
    rings = [(0, .050, .000, .070), (.064, .074, -.014, .098), (.128, .056, -.012, .068), (.224, .027, -.004, .034)]
    verts = [origin+snout*u+wide*w*a+high*(lo if b else hi) for u, w, lo, hi in rings
             for a, b in [(-1, 1), (1, 1), (1, 0), (-1, 0)]]
    faces = [(r*4+e, r*4+(e+1) % 4, (r+1)*4+(e+1) % 4, (r+1)*4+e) for r in range(3) for e in range(4)]
    mesh('Wolf_skull', verts, faces+[(3, 2, 1, 0), (12, 13, 14, 15)], upper, 'gold', socket)
    for w in [-1, 1]:
        eye = origin+snout*.094+wide*w*.068+high*.046
        leaf('Wolf_eye_socket', eye-snout*.034, eye+snout*.040, .025, wide*w, upper, socket, 'black', .002)
        leaf('Wolf_eye', eye-snout*.014+wide*w*.003, eye+snout*.022+wide*w*.003, .008, wide*w, upper, socket, 'eyes', .003)
        leaf('Wolf_brow', eye-snout*.044+high*.020+wide*w*.010, eye+snout*.050+high*.012+wide*w*.010, .014,
             wide*w+high*.6, upper, socket, 'gold', .012)  # a heavy brow shades the socket: carved bone, not a living head
        thorn('Wolf_ear', origin+snout*.020+wide*w*.034+high*.070, origin-snout*.085+wide*w*.052+high*.105, .020,
              upper, socket, 'gold')
        thorn('Wolf_fang', origin+snout*.192+wide*w*.020-high*.004, origin+snout*.202+wide*w*.022-high*.060, .009,
              upper, socket)
    flame('Skull_flame', origin-snout*.020+high*.092, .105, upper, socket, lean=P(-.10, .25, 0))
    socketed += pieces[upper][first:]
    sleeve('Rerebrace', [shoulder+axis*.205, shoulder+axis*.300], [(.084*fit, .074*fit)]*2, upper, ub, 'metal', 8)
    sleeve('Rerebrace_bone_rim', [shoulder+axis*.294, shoulder+axis*.306], [(.087*fit, .077*fit)]*2, upper, ub, 'edge', 8)

    # Flared vambrace: closed shell, a fin along the outer side and a thorned guard in front and behind.
    E = lambda u: elbow+fore*(hand-elbow).length*u
    sleeve('Vambrace', [E(.10), E(.52), E(.93)], [(a*fit, b*fit) for a, b in [(.083, .079), (.081, .077), (.061, .059)]],
           lower, lb, 'plate', 8)
    sleeve('Vambrace_bone_cuff', [E(.90), E(.95)], [(.064*fit, .062*fit)]*2, lower, lb, 'edge', 8)
    thorn_plate('Vambrace_fin', [E(.14)+up*.060*fit, E(.10)+up*.150, E(.34)+up*.130, E(.62)+up*.104,
                E(.86)+up*.052*fit], (0, -1, 0), lower, lb, {0: 1, 1: 2, 2: 2, 3: 2}, rim=.014, bulge=.012,
                back=.012, flow=-fore*.9+up*.5, length=.066)
    for facing in [-1, 1]:
        y = Vector((0, facing*(.083*fit+.004), 0))
        thorn_plate('Vambrace_guard', [E(.14)+y+up*.052, E(.86)+y*.80+up*.034, E(.86)+y*.80-up*.034,
                    E(.14)+y-up*.052], (0, facing, 0), lower, lb, {3: 3}, rim=.011, bulge=.014,
                    flow=-fore*.8, length=.042, material='metal')
    thorn('Elbow_thorn', elbow+Vector((0, .060, 0)), elbow-fore*.035+Vector((0, .165, .015)), .026, lower, lb)

    # Heavy dark gauntlet over the hand lining.
    sleeve('Gauntlet_cuff', [hand-fore*.030, hand+fore*.045], [(.066*fit, .062*fit), (.058, .054)], glove, hb, 'metal', 8)
    sleeve('Gauntlet_bone_rim', [hand-fore*.036, hand-fore*.024], [(.070*fit, .066*fit)]*2, glove, hb, 'edge', 8)
    p = hand+Vector((sign*.052, .004, .034))
    thorn_plate('Gauntlet_backplate', [p-fore*.036+Vector((0, -.044, 0)), p+fore*.058+Vector((0, -.040, 0)),
                p+fore*.058+Vector((0, .046, 0)), p-fore*.036+Vector((0, .050, 0))], (0, 0, 1), glove, hb,
                {3: 2}, rim=.008, bulge=.014, flow=-fore*.8, length=.034)
    first = len(pieces[glove])
    fingers = binding_surface(pieces[glove][0]); onto = hugger(fingers, 1, .006, axis=2)
    for j, (u, half) in enumerate([(.110, .054), (.140, .050), (.168, .044)]):  # overlapping lames, skinned like the fingers
        c = hand+Vector((sign*u, .030, 0))
        thorn_plate('Finger_lame', [c+Vector((-sign*.020, -half, 0)), c+Vector((sign*.020, -half, 0)),
                    c+Vector((sign*.020, half, 0)), c+Vector((-sign*.020, half, 0))], (0, 0, 1), glove, None,
                    rim=.005, bulge=.009-j*.002, snap=onto)
    knuckle = [Vector(rig.data.bones['Thumb_0%d%s' % (k, '' if sign > 0 else ' 1')].head_local) for k in (1, 3)]
    along = (knuckle[1]-knuckle[0]).normalized(); across = along.cross(up).normalized()*.015
    thorn_plate('Thumb_plate', [knuckle[0]+along*.012-across, knuckle[1]-across*.7, knuckle[1]+across*.7,
                knuckle[0]+along*.012+across], (0, 0, 1), glove, None, rim=.004, bulge=.007, snap=onto)
    for obj in pieces[glove][first:]:
        attach_to_surface(obj, fingers)
    for j in range(4):
        c = hand+Vector((sign*.096, -.022+j*.026, .034))
        thorn('Gauntlet_knuckle', c, c-fore*.012+up*.024, .011, glove, hb)

wing_binding_report = []
for obj in socketed:
    groups = {g.index: g.name for g in obj.vertex_groups}
    expected = 'Shoulder_Attachment_L' if sum(v.co.x for v in obj.data.vertices) > 0 else 'Shoulder_Attachment_R'
    assert all(len(v.groups) == 1 and groups[v.groups[0].group] == expected and abs(v.groups[0].weight-1) < 1e-7
               for v in obj.data.vertices), obj.name
    wing_binding_report.append({'mesh': obj.name, 'bone': expected, 'vertices': len(obj.data.vertices), 'weight': 1.0})

# Tall plate boots. Source left/right leg names differ between the bodies: resolve the side from geometry.
for slot in ['LegLeft', 'LegRight']:
    source = pieces[slot][0]
    x = .113 if sum(v.co.x for v in source.data.vertices) > 0 else -.113
    side = 'L' if x > 0 else 'R'; s = 1 if x > 0 else -1
    sleeve('Plate_boot_shaft', [(x, .020, .100), (x, .020, .250), (x, .022, .405)],
           [(.090, .082), (.109, .090), (.116, .094)], slot, 'LowerLeg_'+side, 'metal', 10)
    thorn_plate('Shin_plate', [(x-.058, -.100, .395), (x+.058, -.100, .395), (x+.066, -.098, .255),
                (x+.030, -.082, .125), (x-.030, -.082, .125), (x-.066, -.098, .255)], (0, -1, 0), slot, None,
                {1: 2, 5: 2}, bulge=.026, flow=(0, 0, -1.2), length=.046)
    for j, z in enumerate([.345, .270, .195]):
        thorn('Boot_side_thorn', (x+s*.102, .020, z), (x+s*.150, .028, z-.046), .019, slot, None)
    outline = [(-.080, .130), (.080, .130), (.086, -.070), (.058, -.178), (-.058, -.178), (-.086, -.070)]
    verts = [(x+dx, y, z) for z in [-.004, .034] for dx, y in outline]
    mesh('Closed_boot_sole', verts, [tuple(reversed(range(6))), tuple(range(6, 12))]
         + [(i, (i+1) % 6, (i+1) % 6+6, i+6) for i in range(6)], slot, 'black')
    top = [(x-.080, -.058, .082), (x+.080, -.058, .082), (x+.076, -.138, .062), (x+.036, -.190, .044),
           (x-.036, -.190, .044), (x-.076, -.138, .062)]
    mesh('Broad_bone_toecap', top+[(x, -.110, .112), (x, -.115, .030)],
         [(i, (i+1) % 6, 6) for i in range(6)]+[(i, 7, (i+1) % 6) for i in range(6)], slot, 'edge')
    thorn_plate('Instep_plate', [(x-.064, -.010, .118), (x+.064, -.010, .118), (x+.060, -.078, .100),
                (x-.060, -.078, .100)], (0, -.45, 1), slot, None, {2: 2}, rim=.010, bulge=.014,
                flow=(0, -1, -.2), length=.030, material='metal')
    thorn_plate('Outer_greave', [(x+s*.100, -.050, .385), (x+s*.101, .078, .385), (x+s*.096, .062, .200),
                (x+s*.093, -.036, .200)], (s, 0, 0), slot, None, {2: 2}, rim=.010, bulge=.018,
                flow=(0, 0, -1), length=.040)
    thorn_plate('Calf_plate', [(x-.056, .130, .385), (x+.056, .130, .385), (x+.046, .122, .200), (x-.046, .122, .200)],
                (0, 1, 0), slot, None, {2: 2}, rim=.010, bulge=.018, flow=(0, 0, -1), length=.040)
    thorn('Heel_thorn', (x, .118, .075), (x, .185, .105), .024, slot, None)
    limit = len(pieces[slot])
    # Knee cop with its crown of thorns: rigid on the lower leg, the knee joint is its pivot.
    sleeve('Knee_cuff', [(x, .020, .392), (x, .018, .478)], [(.112, .096), (.104, .094)], slot, 'LowerLeg_'+side, 'metal', 10)
    thorn_plate('Knee_cop', [(x-.070, -.086, .458), (x, -.100, .480), (x+.070, -.086, .458), (x+.062, -.112, .392),
                (x-.062, -.112, .392)], (0, -1, .15), slot, 'LowerLeg_'+side, {3: 3}, rim=.014,
                bulge=.034, flow=(0, 0, -1.4), length=.064)
    for j in range(7):
        a = (j-3)*.60
        c = Vector((x+.118*math.sin(a), .022-.096*math.cos(a), .398))
        d = Vector((math.sin(a), -math.cos(a), 0))
        thorn('Knee_crown_thorn', c, c+d*.040+Vector((0, 0, -.060)), .015, slot, 'LowerLeg_'+side)
    surface = binding_surface(source)
    for obj in pieces[slot][1:limit]:
        attach_to_surface(obj, surface)

# Closed raven-beak helm: dome and neck follow the head lining, visor, comb and horns are rigid.
rings = [(1.462, .121, .130), (1.560, .144, .150), (1.680, .155, .158), (1.770, .141, .147), (1.828, .088, .098)]
n = 10
verts = [(rx*math.sin(j*math.tau/n), .012-ry*math.cos(j*math.tau/n), z) for z, rx, ry in rings for j in range(n)]
verts.append((0, .014, 1.856))
faces = [(r*n+j, r*n+(j+1) % n, (r+1)*n+(j+1) % n, (r+1)*n+j) for r in range(len(rings)-1) for j in range(n)]
faces += [((len(rings)-1)*n+j, (len(rings)-1)*n+(j+1) % n, len(rings)*n) for j in range(n)]
dome = mesh('Grave_helm_dome', verts, faces, 'Head', 'plate')
attach_to_surface(dome, binding_surface(pieces['Head'][0]))
band = [(.159*math.sin(a), .012-.162*math.cos(a), 1.612) for a in [math.radians(112+j*17) for j in range(9)]]
branch('Helm_bone_band', band, [.009]*9, 'Head', 'Head', 'edge', 4)  # rear half only: the visor covers the front
for sign in [-1, 1]:
    P = lambda x, y, z: (sign*x, y, z)
    thorn_plate('Beak_visor', [P(.003, -.182, 1.752), P(.003, -.206, 1.660), P(.003, -.222, 1.560),
                P(.003, -.196, 1.468), P(.066, -.128, 1.500), P(.116, -.082, 1.560), P(.131, -.070, 1.665),
                P(.120, -.082, 1.752)], (sign*.62, -.78, 0), 'Head', 'Head', {3: 2, 4: 2}, rim=.012,
                bulge=.010, back=.030, flow=(sign*.3, 0, -1), length=.036)
    for tag, material, width, lift in [('socket', 'black', .017, .014), ('eye', 'eyes', .008, .017)]:
        a = Vector(P(.024, -.181, 1.676)); b = Vector(P(.098, -.104, 1.703)); off = Vector(P(.62, -.78, 0))*lift
        leaf('Helm_'+tag, a+off, b+off, width, P(.62, -.78, 0), 'Head', 'Head', material, .002)
    h = Vector(P(.89, .45, 0)); root = Vector(P(.118, -.010, 1.722))  # horns sweep outward and a little back
    horn = [root+h*a+Vector((0, b*.34, b)) for a, b in [(0, 0), (.088, .062), (.132, .165), (.112, .270), (.052, .348)]]
    blade('Helm_horn', horn, [.060, .054, .042, .025], h-Vector((0, 0, .2)), [.036, .034, .026, .013], 'Head', 'Head',
          facing=P(-.45, .89, 0))
    flame('Horn_flame', horn[-1]-Vector((0, 0, .015)), .125, 'Head', 'Head', lean=P(.10, .30, 0))
    leaf('Helm_brow', P(.004, -.196, 1.712), P(.150, -.070, 1.792), .022, P(.62, -.78, .1), 'Head', 'Head', 'edge', .010)
    for j in range(3):
        a = Vector(P(.040+j*.026, -.178+j*.027, 1.612)); off = Vector(P(.62, -.78, 0))*.013
        leaf('Helm_breath_slit', a+off, a+off+Vector((0, 0, -.070)), .0055, P(.62, -.78, 0), 'Head', 'Head', 'black', .001)
thorn_plate('Helm_comb', [(0, -.165, 1.762), (0, -.128, 1.868), (0, .000, 1.902), (0, .122, 1.852), (0, .160, 1.735)],
            (1, 0, 0), 'Head', 'Head', {1: 2, 2: 2, 3: 1}, rim=.012, bulge=.013, back=.013,
            flow=(0, .9, .6), length=.058)
thorn_plate('Neck_guard', [(-.112, .118, 1.585), (.112, .118, 1.585), (.128, .104, 1.490), (0, .150, 1.452),
            (-.128, .104, 1.490)], (0, 1, 0), 'Head', 'Neck', {2: 2, 3: 2}, bulge=.030, flow=(0, 0, -1),
            length=.034, material='metal')

def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


budget = sum(triangles(obj) for objects in pieces.values() for obj in objects)
assert budget <= 10000, budget  # checked here, before the tail renders or exports anything

tail = end+scaffold.split(end)[1]
def swap(text, old, new):
    assert old in text, old
    return text.replace(old, new)
tail = swap(tail, "'class': 'Seherin'", "'class': 'Grabritter'")
tail = swap(tail, '32_Wing_Light_Detail', '32_Thorn_Light_Detail')
tail = swap(swap(tail, '1400', '1200'), '2.90', '2.75')
tail = swap(tail, "view_transform = 'AgX'", "view_transform = 'Standard'")
tail = swap(tail, "look = 'AgX - Medium High Contrast'", "look = 'None'")
tail = swap(tail, "'split per-leg riding panels'", "'split per-leg plate panels'")
exec(compile(tail, 'armor-common-validation-export', 'exec'))

# Review images the scaffold does not make: a true side view, and front/back in a quick run.
for name, location in [('04_Gravethorn_Side', (7, 0, 1.65))]+([('02_Gravethorn_Front', (0, -7, 1.65)),
                                                               ('03_Gravethorn_Back', (-2.55, 7, 2.7))] if QUICK else []):
    cam.data.ortho_scale = 2.75; cam.location = location; target(cam, (0, 0, 1.05)); render(name)
camera()

# Effect ownership is per item, not a permanent avatar light. Numbers for the budget go into the report.
glowing = ['Gravethorn_'+name for name in EMISSIVE]
names = set(); lit = {}
for slot, obj in armor.items():
    obj.data.calc_loop_triangles(); lit[slot] = 0
    for triangle in obj.data.loop_triangles:
        material = obj.data.materials[obj.data.polygons[triangle.polygon_index].material_index].name
        names.add(material); lit[slot] += material in glowing
report['items'] = {part['item']: sum(report['slots'][s]['triangles'] for s in part['regions']) for part in PARTS}
report['emissive_by_item'] = {part['item']: sum(lit[s] for s in part['regions']) for part in PARTS}
report['materials_used'] = sorted(names)
report['emissive_triangles'] = sum(lit.values())
assert report['total_triangles'] == budget, (report['total_triangles'], budget)
equipment = json.loads((ROOT/'equipment.json').read_text())
for part in equipment['parts']:  # say what is true: only items that carry glowing geometry declare it
    part['vfx']['emissiveTriangles'] = report['emissive_by_item'][part['item']]
    part['vfx']['emissive'] = part['vfx']['emissiveTriangles'] > 0
equipment['vfx'] = {'profile': 'gravethorn_red', 'type': 'emissive_mesh', 'materials': glowing,
                    'itemBound': True, 'optionalRuntimeEffect': 'selective_glow', 'particleSystem': False}
(ROOT/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
report.pop('wing_effect', None)
report['shoulder_socket_binding'] = report.pop('wing_binding')
report['vfx'] = equipment['vfx']
(ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
