"""Build the Plainhide starter clothes; reuse the proven fitting/export scaffold.

Shared implementation. Run it through the per-body entry points male/build.py and
female/build.py (the latter appends --female). Directly:
Blender -b WoV_BodyBase_{Male,Female}.blend --python THIS -- OUTPUT [--female] [--quick]
Only the common initialization/helpers and final validation/export sections are reused.
The Seidraven design section is never executed. Markers are asserted to fail closed.

Design: what every new character wears. A rough hide shirt with a wide stitched neck,
a plain band as a belt, a short skirt of the shirt over hide trousers, linen under the
sleeves, hide wraps on forearms and shins, laced turnshoes. No metal, no emblem, no glow.

Five items, not seven: head and hands stay the character's own body, so their skin tone,
face, hair and beard are never replaced. The scaffold prepares linings and items for all
eleven regions; Head, HandLeft and HandRight are removed right after its initialization,
before anything is joined, rendered or exported, and that is asserted again at the end.
No replaced region shows skin: upper arms, forearms and shins are clothed, not bare.
The scaffold's lining is the garment itself: shirt and trousers are softened (smoothed and
let out a few millimetres inside their borders) so the cloth does not show the body's
facets. Everything added is hems, seams, band and wraps laid onto each body's own lining
by ray casts, so both bodies are fitted. The preview glow of the scaffold is switched off.

--quick keeps the scaffold's meaning (hero image, no pose checks, no GLBs, no .blend)
and adds cheap front, back and side review images.
"""
from pathlib import Path

scaffold = (Path(__file__).resolve().parent.parent / 'seidraven' / 'build_common.py').read_text()
start = '# New geometry inspired by the supplied silhouette'
end = '# Join each replacement region and bind every component'
assert scaffold.count(start) == scaffold.count(end) == 1
scaffold = scaffold.replace('Seidraven', 'Plainhide').replace('seidraven', 'plainhide')
exec(compile(scaffold.split(start)[0], 'armor-common-initialization', 'exec'))

# Head and hands belong to the player: drop their linings and their two items.
FREE = ['Head', 'HandLeft', 'HandRight']
for slot in FREE:
    for obj in pieces.pop(slot):
        bpy.data.objects.remove(obj, do_unlink=True)
    SLOTS.remove(slot)
    base[slot].hide_render = False; base[slot].hide_set(False)  # the source body shows there in every image
# The image is rendered through the scene's first view layer. The female source keeps its body regions in
# collections which that layer excludes, so they would be missing from every image: link such regions to the scene root.
for obj in base.values():
    if not obj.visible_get(view_layer=scene.view_layers[0]):
        scene.collection.objects.link(obj)
PARTS[:] = [part for part in PARTS if not set(part['regions']) & set(FREE)]
assert [part['item'].rsplit('_', 1)[1] for part in PARTS] == ['shoulders', 'vest', 'bracers', 'robe', 'boots']

# Shirt hide, trouser hide, dark band and shoe leather, a thin darker under-hide, pale thread. Nothing shines.
colors = {'cloth': (.300, .172, .066), 'leather': (.165, .090, .034), 'black': (.058, .030, .013),
          'gold': (.215, .128, .058), 'edge': (.600, .480, .270)}
for name, color in colors.items():
    mat = materials[name]; mat.diffuse_color = (*color, 1)
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .92
    shader.inputs['Metallic'].default_value = 0
for part, label in zip(PARTS, ['Schlichtleder-Ärmel', 'Schlichtleder-Hemd', 'Schlichtleder-Armwickel',
                               'Schlichtleder-Hose', 'Schlichtleder-Bundschuhe']):
    part['label'] = label
    part['vfx'] = {'emissive': False}


def shell(*objects):
    """One BVH over one or more linings (rest pose, world space)."""
    points, triangles = [], []
    for obj in objects:
        obj.data.calc_loop_triangles(); first = len(points)
        points += [v.co.copy() for v in obj.data.vertices]
        triangles += [tuple(i+first for i in t.vertices) for t in obj.data.loop_triangles]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True)


def lay(tree, p, toward, clear):
    """Put a point onto the lining along the line from p to a point inside the body; returns (position, outward)."""
    p, toward = Vector(p), Vector(toward); d = (toward-p).normalized()
    hit = tree.ray_cast(toward-d*1.5, d)[0]
    if hit is None:
        hit = tree.find_nearest(p)[0]
    return hit-d*clear, -d


def trace(tree, waypoints, toward, clear, step=.025):
    """A rough polyline becomes closely spaced surface points."""
    waypoints = [Vector(w) for w in waypoints]; points = []
    for a, b in zip(waypoints, waypoints[1:]):
        count = max(1, round((b-a).length/step))
        points += [lay(tree, a.lerp(b, k/count), toward(a.lerp(b, k/count)), clear) for k in range(count)]
    return points+[lay(tree, waypoints[-1], toward(waypoints[-1]), clear)]


def strip(name, points, width, slot, material):
    """Flat band along surface points; width may taper (one value per point)."""
    widths = width if isinstance(width, (list, tuple)) else [width]*len(points)
    verts = []
    for i, ((p, out), w) in enumerate(zip(points, widths)):
        tangent = (points[min(i+1, len(points)-1)][0]-points[max(i-1, 0)][0]).normalized()
        side = tangent.cross(out).normalized()*w/2
        verts += [p+side, p-side]
    return mesh(name, verts, [(2*i, 2*i+1, 2*i+3, 2*i+2) for i in range(len(points)-1)], slot, material)


def stitches(name, points, slot, spacing=.032, length=.022, width=.0065, lift=.003, across=True):
    """Coarse pale stitches: short bars across (or along) a seam."""
    verts, faces = [], []; travelled = 0; due = spacing/2
    for (p0, o0), (p1, o1) in zip(points, points[1:]):
        run = (p1-p0).length
        if run < 1e-6:
            continue
        tangent = (p1-p0)/run
        while due <= travelled+run:
            f = (due-travelled)/run; out = o0.lerp(o1, f).normalized(); p = p0.lerp(p1, f)+out*lift
            side = tangent.cross(out).normalized()
            a, b = (side*length/2, tangent*width/2) if across else (tangent*length/2, side*width/2)
            k = len(verts); verts += [p-a-b, p+a-b, p+a+b, p-a+b]; faces.append((k, k+1, k+2, k+3))
            due += spacing
        travelled += run
    return mesh(name, verts, faces, slot, 'edge')


def band(name, tree, origin, axis, zero, rows, slot, material, segments=10, begin=0, sweep=math.tau, tilt=0, phase=0,
         upright=False, tuck=0):
    """Sheet around a limb or the trunk: rows of (distance along the axis, clearance); tilt makes a wrap.
    upright: every column stands at its widest row, like a belt that does not dip into the small of the back.
    tuck: clearance shrinks by this share on the underside (toward -Z), so a sleeve runs out into the armpit."""
    origin, axis, zero = Vector(origin), Vector(axis).normalized(), Vector(zero).normalized()
    other = axis.cross(zero); closed = abs(sweep-math.tau) < 1e-6
    columns = segments if closed else segments+1
    grid = []
    for j in range(columns):
        a = begin+sweep*j/segments; radial = zero*math.cos(a)+other*math.sin(a)
        column = []
        for along, clear in rows:
            centre = origin+axis*(along+tilt*math.cos(a-phase))
            column.append((centre, *lay(tree, centre+radial, centre, clear*(1-tuck*max(0, -radial.z)))))
        reach = max((p-centre).length for centre, p, _ in column)
        grid += [(centre+radial*reach if upright else p, out) for centre, p, out in column]
    n = len(rows)
    faces = [(j*n+r, j*n+r+1, ((j+1) % columns)*n+r+1, ((j+1) % columns)*n+r)
             for j in range(segments) for r in range(n-1)]
    obj = mesh(name, [p for p, _ in grid], faces, slot, material)
    return obj, grid


def soften(obj, rounds, grow):
    """Worn cloth, not body paint: smooth the lining inside its borders and let it out; the borders stay put,
    so neighbouring regions and the free body still meet it without a step."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for _ in range(rounds):
        moved = {v: v.co.lerp(sum((e.other_vert(v).co for e in v.link_edges), Vector())/len(v.link_edges), .5)
                 for v in bm.verts if not v.is_boundary}
        for v, co in moved.items():
            v.co = co
    bm.normal_update()
    for v in bm.verts:
        if not v.is_boundary:
            v.co += v.normal*grow
    bm.to_mesh(obj.data); bm.free(); obj.data.update()


def repaint(obj, base=None, rules=()):
    """Linings are the garment: give them their tone, and other tones where a rule on the face centre says so."""
    if base:
        obj.data.materials[0] = materials[base]
    for material, _ in rules:
        if materials[material].name not in [m.name for m in obj.data.materials]:
            obj.data.materials.append(materials[material])
    slots = {m.name: i for i, m in enumerate(obj.data.materials)}
    for polygon in obj.data.polygons:
        for material, test in rules:
            if test(polygon.center):
                polygon.material_index = slots[materials[material].name]
                break


def hang_weights(obj, waist=None):
    """The legs below the band, blended across the centre so a skirt behaves like cloth. Above, either the Hips
    bone or, with `waist` (a binding surface), whatever the waist there follows: then a skirt turns with the trunk."""
    above = {}
    if waist:
        attach_to_surface(obj, waist)
        above = {v.index: {obj.vertex_groups[g.group].name: g.weight for g in v.groups} for v in obj.data.vertices}
        obj.vertex_groups.clear()
    for v in obj.data.vertices:
        hip = min(1, max(0, (v.co.z-.74)/.17)); left = min(1, max(0, .5+v.co.x/.16))
        shares = {name: weight*hip for name, weight in above.get(v.index, {'Hips': 1}).items()}
        for name, weight in [('UpperLeg_L', (1-hip)*left), ('UpperLeg_R', (1-hip)*(1-left))]:
            shares[name] = shares.get(name, 0)+weight
        for name, weight in shares.items():
            if weight > 0:
                (obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)).add([v.index], weight, 'REPLACE')


UP, FRONT = (0, 0, 1), (0, -1, 0)

# Shirt: the torso lining is the hide; linen shows in the wide neck, the rest is seams.
torso = pieces['Torso'][0]; soften(torso, 2, .006); tree = shell(torso)  # the shirt only: softened trousers dent at the knee
repaint(torso, 'cloth', [('gold', lambda c: abs(c.x) < .112 and c.z > (1.335+abs(c.x)*1.25 if c.y < .02 else 1.425+abs(c.x)*.42))])
neck = lambda p: Vector((p.x*.35, .02, 1.30)); trunk = lambda p: Vector((0, .01, p.z))
collar = trace(tree, [(-.108, -.05, 1.47), (-.055, -.13, 1.40), (0, -.15, 1.335), (.055, -.13, 1.40), (.108, -.05, 1.47),
                      (.10, .10, 1.465), (.05, .16, 1.445), (0, .17, 1.425), (-.05, .16, 1.445), (-.10, .10, 1.465),
                      (-.108, -.05, 1.47)], neck, .005)
strip('Neck_binding', collar, .028, 'Torso', 'leather')
stitches('Neck_stitches', [(p+out*.002, out) for p, out in collar], 'Torso', spacing=.040)
for sign in [-1, 1]:
    for y, z0, z1 in [(-.11, 1.452, 1.345), (.135, 1.458, 1.355)]:  # raglan seams, front and back
        seam = trace(tree, [(sign*.118, y, z0), (sign*.205, y, z1)], lambda p: Vector((p.x*.4, .02, 1.25)), .003)
        stitches('Shoulder_seam', seam, 'Torso', spacing=.030)
for x0, x1, z, facing in [(-.105, .015, 1.085, -1), (-.01, .115, 1.118, -1), (-.06, .07, 1.048, -1), (-.10, .03, 1.10, 1), (.0, .11, 1.06, 1)]:
    fold = trace(tree, [(x0, facing*.3, z), (x1, facing*.3, z-.018)], trunk, .003, step=.04)
    strip('Shirt_fold', fold, [.002]+[.013]*(len(fold)-2)+[.002], 'Torso', 'leather')
band('Shirt_overhang', shell(torso, pieces['Hips'][0]), (0, .015, 0), UP, FRONT, [(.972, .010), (1.004, .016), (1.046, .006)], 'Torso', 'cloth', 12)
surface = binding_surface(torso)
for obj in pieces['Torso'][1:]:
    attach_to_surface(obj, surface)

# Trousers, the band and the short skirt of the shirt.
hips = pieces['Hips'][0]; tree = shell(hips); waist = shell(torso, hips); waistline = binding_surface(torso)
repaint(hips, 'leather')
axis0 = (0, .015, 0)
for begin in [math.radians(-80), math.radians(100)]:  # front and back panel; the sides stay slit
    skirt, grid = band('Shirt_skirt', waist, axis0, UP, FRONT, [(.948, .004), (.920, .008), (.855, .024)], 'Hips', 'cloth', 8, begin, math.radians(160))
    hem = []
    for j in range(9):  # the last row hangs free below the hug rows: a little out and down
        p, out = grid[j*3+2]; flat = Vector((out.x, out.y, 0)).normalized()
        hem.append((p+flat*.020+Vector((0, 0, -.088)), flat))
    verts = [v.co.copy() for v in skirt.data.vertices]+[p for p, _ in hem]
    faces = [tuple(f.vertices) for f in skirt.data.polygons]+[(j*3+2, 27+j, 27+j+1, (j+1)*3+2) for j in range(8)]
    pieces['Hips'].remove(skirt); bpy.data.objects.remove(skirt, do_unlink=True)
    hang_weights(mesh('Shirt_skirt', verts, faces, 'Hips', 'cloth'), waistline)
    hang_weights(stitches('Skirt_hem_stitches', [(p+Vector((0, 0, .016)), out) for p, out in hem], 'Hips', spacing=.044, across=False), waistline)
belt, grid = band('Waist_band', waist, axis0, UP, FRONT, [(.925, .026), (.945, .026), (.965, .026)], 'Hips', 'black', 16, upright=True)
attach_to_surface(belt, waistline)  # the band turns with the waist it is tied around, like the skirt under it
for f in [.5]:  # one row of running stitches along the middle, taken from the band's own surface
    circle = [(grid[3*(j % 16)][0].lerp(grid[3*(j % 16)+2][0], f), grid[3*(j % 16)][1]) for j in range(17)]
    thread = stitches('Band_stitches', circle, 'Hips', spacing=.050, length=.020, width=.0045, across=False)
    attach_to_surface(thread, waistline)
for dx, drop in [(-.018, .075), (.022, .055)]:  # the tied ends of the band: short, and on the waist only, so a crouch does not splay them
    top = lay(waist, (dx, -1, .938), (dx, .015, .938), .032)[0]
    tie = strip('Band_end', [(top+Vector((dx*.6*k, -.004*k, -drop*k/2)), Vector((0, -1, 0))) for k in range(3)], .026, 'Hips', 'black')
    attach_to_surface(tie, waistline)
first = len(pieces['Hips'])
for sign in [-1, 1]:
    leg = lambda p: Vector((sign*.10, .02, p.z))
    stitches('Trouser_seam', trace(tree, [(sign*.30, .02, .74), (sign*.30, .02, .42)], leg, .003), 'Hips', spacing=.038)
    for z in [.500, .455]:
        fold = trace(tree, [(sign*.045, -.3, z), (sign*.165, -.3, z+.012)], leg, .003, step=.04)
        strip('Knee_fold', fold, [.002]+[.012]*(len(fold)-2)+[.002], 'Hips', 'black')
surface = binding_surface(hips)
for obj in pieces['Hips'][first:]:
    attach_to_surface(obj, surface)

for sign, side, word in [(1, 'L', 'Left'), (-1, 'R', 'Right')]:
    shoulder = Vector(rig.data.bones['Shoulder_'+side].head_local)
    elbow = Vector(rig.data.bones['Elbow_'+side].head_local)
    hand = Vector(rig.data.bones['Hand_'+side].head_local)
    axis = (elbow-shoulder).normalized(); fore = (hand-elbow).normalized()

    # Short hide sleeve with a stitched hem; linen sleeve below it, so no skin in a replaced region.
    upper = 'ArmUpper'+word; arm = pieces[upper][0]; tree = shell(arm)
    repaint(arm, 'cloth', [('gold', lambda c: (c-shoulder).dot(axis) > .19)])
    band('Sleeve', tree, shoulder, axis, UP, [(.040, .007), (.115, .010), (.192, .014)], upper, 'cloth', 8, tuck=.7)
    band('Sleeve_hem', tree, shoulder, axis, UP, [(.178, .015), (.200, .017)], upper, 'leather', 8, tuck=.7)
    other = axis.cross(Vector(UP))
    circle = [lay(tree, shoulder+axis*.189+Vector(UP)*math.cos(a)+other*math.sin(a), shoulder+axis*.189,
                  .0185*(1-.7*max(0, -math.cos(a)))) for a in [k*math.tau/16 for k in range(17)]]
    stitches('Sleeve_hem_stitches', circle, upper, spacing=.038, length=.016)
    fold = trace(tree, [shoulder+axis*.27+Vector((0, -.3, .03)), shoulder+axis*.31+Vector((0, -.3, -.03))],
                 lambda p: shoulder+axis*(p-shoulder).dot(axis), .003, step=.04)
    strip('Linen_fold', fold, [.002]+[.010]*(len(fold)-2)+[.002], upper, 'leather')
    surface = binding_surface(arm)
    for obj in pieces[upper][1:]:
        attach_to_surface(obj, surface)

    # Forearm: linen sleeve under crossed hide wraps, tied at the wrist.
    lower = 'ArmLower'+word; arm = pieces[lower][0]; tree = shell(arm)
    repaint(arm, 'gold')
    for along in [.050, .098, .146, .194]:
        band('Forearm_wrap', tree, elbow, fore, UP, [(along-.013, .009), (along+.013, .010)], lower, 'leather', 8, tilt=.020)
    band('Wrist_tie', tree, elbow, fore, UP, [(.228, .008), (.246, .008)], lower, 'black', 8)
    surface = binding_surface(arm)
    for obj in pieces[lower][1:]:
        attach_to_surface(obj, surface)

# Trouser end below the knee, shin wraps over linen, laced turnshoe. Resolve the side from geometry.
for slot in ['LegLeft', 'LegRight']:
    leg = pieces[slot][0]; tree = shell(leg)
    x = .113 if sum(v.co.x for v in leg.data.vertices) > 0 else -.113
    repaint(leg, 'leather', [('black', lambda c: c.z < .095), ('gold', lambda c: c.z < .330)])
    origin = (x, .02, 0)
    band('Trouser_hem', tree, origin, UP, FRONT, [(.318, .022), (.368, .012)], slot, 'leather', 8)
    circle = [lay(tree, Vector((x+math.sin(a), .02-math.cos(a), .338)), (x, .02, .338), .0205) for a in [k*math.tau/16 for k in range(17)]]
    stitches('Trouser_hem_stitches', circle, slot, spacing=.042)
    for z in [.140, .192, .244, .296]:
        band('Shin_wrap', tree, origin, UP, FRONT, [(z-.014, .008), (z+.014, .009)], slot, 'cloth', 8, tilt=.022,
             phase=math.pi if x < 0 else 0)
    band('Shoe_collar', tree, origin, UP, FRONT, [(.082, .010), (.112, .013)], slot, 'leather', 8)
    lace = trace(tree, [(x, -.058, .30), (x, -.118, .30)], lambda p: Vector((x, p.y+.02, -.05)), .004, step=.02)
    stitches('Shoe_lacing', lace, slot, spacing=.024, length=.030, width=.004)
    outline = [(-.050, .105), (.050, .105), (.070, .030), (.072, -.060), (.050, -.132), (.020, -.152), (-.020, -.152),
               (-.050, -.132), (-.072, -.060), (-.070, .030)]
    n = len(outline); verts = [(x+dx, y, z) for z in [-.004, .005] for dx, y in outline]
    mesh('Turnshoe_sole', verts, [tuple(reversed(range(n))), tuple(range(n, 2*n))]
         + [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)], slot, 'black')
    surface = binding_surface(leg)
    for obj in pieces[slot][1:]:
        attach_to_surface(obj, surface)

# Mark everything that is not lining (a mesh attribute, never exported): measuring tools can tell trim from lining.
for objects in pieces.values():
    for k, obj in enumerate(objects):
        layer = obj.data.attributes.new('trim', 'INT', 'POINT')
        layer.data.foreach_set('value', [int(k > 0)]*len(obj.data.vertices))


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


budget = sum(triangles(obj) for objects in pieces.values() for obj in objects)
assert budget <= 3500, budget  # checked before the tail renders or exports anything
wing_binding_report = []

tail = end+scaffold.split(end)[1]
def swap(text, old, new):
    assert old in text, old
    return text.replace(old, new)
tail = swap(tail, "'class': 'Seherin'", "'class': 'Neuling'")
tail = swap(tail, '32_Wing_Light_Detail', '32_Seam_Detail')
tail = swap(tail, '30_Hood_Detail', '30_Collar_Detail')
tail = swap(swap(tail, '1400', '1200'), '2.90', '2.55')
tail = swap(tail, "view_transform = 'AgX'", "view_transform = 'Standard'")
tail = swap(tail, "look = 'AgX - Medium High Contrast'", "look = 'None'")
tail = swap(tail, "glare.inputs['Strength'].default_value=1.2", "glare.inputs['Strength'].default_value=0")  # nothing glows: no preview halo either
tail = swap(tail, "'split per-leg riding panels'", "'short shirt skirt, slit at the sides, over trousers'")
exec(compile(tail, 'armor-common-validation-export', 'exec'))

# Review images the scaffold does not make: a true side view, and front/back in a quick run.
for name, location in [('04_Plainhide_Side', (7, 0, 1.65))]+([('02_Plainhide_Front', (0, -7, 1.65)),
                                                              ('03_Plainhide_Back', (-2.55, 7, 2.7))] if QUICK else []):
    cam.data.ortho_scale = 2.55; cam.location = location; target(cam, (0, 0, 1.05)); render(name)
camera()

# Witnesses: five items, head and hands free, nothing glows, five materials at most.
assert sorted(armor) == sorted(SLOTS) and len(armor) == 8 and not set(armor) & set(FREE)
assert not [o.name for o in bpy.data.objects if o.name.startswith(PREFIX) and ('Head' in o.name or 'Hand' in o.name)]
used = set(); glowing = 0
for obj in armor.values():
    obj.data.calc_loop_triangles()
    for triangle in obj.data.loop_triangles:
        material = obj.data.materials[obj.data.polygons[triangle.polygon_index].material_index]
        used.add(material.name)
        glowing += material.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value > 0
assert glowing == 0 and len(used) <= 5, (glowing, sorted(used))
assert report['total_triangles'] == budget, (report['total_triangles'], budget)
if not QUICK:  # the exported files themselves: no mesh node may be a head or a hand
    import struct
    for glb in sorted(ROOT.glob('*.glb')):
        raw = glb.read_bytes(); size = struct.unpack('<I', raw[12:16])[0]
        nodes = [n['name'] for n in json.loads(raw[20:20+size])['nodes'] if 'mesh' in n]
        assert nodes and not [n for n in nodes if 'Head' in n or 'Hand' in n], (glb.name, nodes)
    assert len(list(ROOT.glob('plainhide_*.glb'))) == 5
report['items'] = {part['item']: sum(report['slots'][s]['triangles'] for s in part['regions']) for part in PARTS}
report['materials_used'] = sorted(used); report['emissive_triangles'] = glowing
report['free_regions'] = FREE
for key in ['wing_binding', 'wing_effect']:
    report.pop(key, None)
equipment = json.loads((ROOT/'equipment.json').read_text())
assert len(equipment['parts']) == 5 and all(p['hideAppearance'] == [] for p in equipment['parts'])
equipment.pop('wingBinding', None)
equipment['vfx'] = {'type': 'none', 'emissive': False, 'particleSystem': False}
equipment['freeRegions'] = FREE
(ROOT/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
report['vfx'] = equipment['vfx']
(ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
