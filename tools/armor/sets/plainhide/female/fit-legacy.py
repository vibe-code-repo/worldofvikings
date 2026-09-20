"""Use the tested anatomical retarget for the Plainhide legacy-female variant.

Blender -b Female/WoV_Plainhide_Armor.blend --python THIS -- body.glb OUTPUT
(Female/WoV_Plainhide_Armor.blend is the output of female/build.py.) Executes the
text of ../../seidraven/female/fit-legacy.py with the set name substituted.

Two things differ from a seven-item set, both handled here and not in the shared script:

- Plainhide replaces eight of the eleven body regions. The shared script sorts every
  triangle of the game body into a region and keeps a list only for the regions the set
  has; the lists for the free regions (head, hands) are added, filled and never used.
- Plainhide's linings are the garment. The shared script rebuilds each lining from the
  game body, in one material and in the body's exact shape, and fits the ornaments by
  bone frames with widths tuned for plate that stands well clear. For thin clothes that
  is not enough, so three steps run on every region before it is joined:
  carry_paint  every rebuilt triangle takes the material of the nearest authored lining
               face (hide trousers, linen in the neck and under the wraps);
  drape        shirt and trousers are drawn taut over the body like cloth: smoothed inside
               their borders and never below the body, so they stop reading as body paint.
               The borders stay put, so the seams to the neighbouring regions stay exact;
  settle       every ornament vertex is laid back onto the lining at its authored height.
"""
from pathlib import Path
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

DRAPE = {'Torso': 30, 'Hips': 10}  # smoothing rounds; the other regions keep the body's shape
SCALE = .58  # the game figure against the authoring body
REACH = {'LegLeft': .012, 'LegRight': .012}  # no ornament stands further off than this (default .022): soles hug the foot


def drape(slot, data):
    """Smooth freely inside the borders, then let the cloth out until it clears the body everywhere: a loose
    garment instead of paint. The let-out fades to nothing over five edge rings, so the borders stay exact."""
    rounds = DRAPE.get(slot, 0)
    if not rounds:
        return
    bm = bmesh.new(); bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)  # the game body is split along its texture seams
    bm.normal_update(); verts = list(bm.verts)
    rest = [(v.co.copy(), v.normal.copy()) for v in verts]
    ring = {v: 0 for v in verts if v.is_boundary}; front = list(ring)
    while front:  # edge rings counted from the border
        reached = []
        for v in front:
            for w in (e.other_vert(v) for e in v.link_edges):
                if w not in ring:
                    ring[w] = ring[v]+1; reached.append(w)
        front = reached
    free = [k for k, v in enumerate(verts) if ring.get(v, 9) > 0]
    for _ in range(rounds):
        moved = {k: verts[k].co.lerp(sum((e.other_vert(verts[k]).co for e in verts[k].link_edges), Vector())
                                     / len(verts[k].link_edges), .5) for k in free}
        for k, co in moved.items():
            verts[k].co = co
    sunk = sorted(max(0, (rest[k][0]-verts[k].co).dot(rest[k][1])) for k in free)
    ease = sunk[-1]  # let out by the deepest dip, so nothing has to be lifted on its own and no lump remains
    for k in free:
        origin, normal = rest[k]
        verts[k].co += normal*ease*min(1, ring.get(verts[k], 9)/5)
        verts[k].co += normal*max(0, (origin-verts[k].co).dot(normal)+.001)
    tree = KDTree(len(verts))
    for k, (origin, _) in enumerate(rest):
        tree.insert(origin, k)
    tree.balance()
    for v in data.vertices:
        v.co = verts[tree.find(v.co)[1]].co.copy()
    bm.free(); data.update()
    draped[slot] = (len(free), round(ease, 4))


def surface(points, faces, others):
    """One search tree over a region's own lining and the body of every other region, so a band that straddles
    a border finds the neighbour's surface and not the border's edge."""
    points, faces = list(points), list(faces)
    for other_points, other_faces in others:
        offset = len(points); points += other_points
        faces += [tuple(i+offset for i in f) for f in other_faces]
    return BVHTree.FromPolygons(points, faces)


def settle(slot, original, lining_count, ornament, data):
    authored = surface([v.co.copy() for v in list(original.data.vertices)[:lining_count]],
                       [tuple(p.vertices) for p in original.data.polygons if max(p.vertices) < lining_count],
                       [([o.matrix_world@v.co for v in o.data.vertices], [tuple(p.vertices) for p in o.data.polygons])
                        for o in bpy.data.objects if o.name.startswith('WoV_BodyBase_Female_') and not o.name.endswith('_'+slot)])
    fitted = surface([v.co.copy() for v in data.vertices], [tuple(p.vertices) for p in data.polygons],
                     [([body.matrix_world@v.co for v in body.data.vertices],
                       [f for other, faces in triangles.items() if other != slot for f in faces])])
    for v in ornament.data.vertices:
        co = original.data.vertices[lining_count+v.index].co
        hit, normal, _, _ = authored.find_nearest(co)
        height = (co-hit).dot(normal)
        hit, normal, _, _ = fitted.find_nearest(v.co)
        v.co = hit+normal*min(REACH.get(slot, .022), max(.0012, height*SCALE))


def carry_paint(original, lining_count, data):
    names = {g.index: g.name for g in original.vertex_groups}
    fitted = []
    for v in list(original.data.vertices)[:lining_count]:
        ws = [(names[g.group], g.weight) for g in v.groups if g.weight > 1e-7]
        fitted.append(sum(((transforms[n]@v.co)*w for n, w in ws), Vector())/sum(w for n, w in ws))
    faces = [p for p in original.data.polygons if max(p.vertices) < lining_count]
    tree = KDTree(len(faces))
    for k, p in enumerate(faces):
        tree.insert(sum((fitted[i] for i in p.vertices), Vector())/len(p.vertices), k)
    tree.balance()
    slots = {}
    for polygon in data.polygons:
        centre = sum((data.vertices[i].co for i in polygon.vertices), Vector())/len(polygon.vertices)
        material = original.data.materials[faces[tree.find(centre)[1]].material_index]
        if material.name not in slots:
            slots[material.name] = len(data.materials); data.materials.append(material)
        polygon.material_index = slots[material.name]
    painted[original.name] = sorted(slots)


def swap(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


painted, draped = {}, {}
source = (Path(__file__).resolve().parent.parent.parent/'seidraven'/'female'/'fit-legacy.py').read_text()
source = source.replace('Seidraven', 'Plainhide').replace('seidraven', 'plainhide').replace('1400', '1000')
source = swap(source, 'triangles={s:[] for s in source}', "triangles={s:[] for s in [*source,'Head','HandLeft','HandRight']}")
source = swap(source, "    data.materials.append(bpy.data.materials['Plainhide_'+material])\n",
              '    carry_paint(original,lining_count,data);drape(slot,data);settle(slot,original,lining_count,ornament,data)\n')
exec(compile(source, 'plainhide-legacy-female-retarget', 'exec'))

# Witnesses: eight regions, five items, the free regions untouched, the paint carried over, every ornament kept.
assert sorted(armor) == sorted(s for p in equipment['parts'] for s in p['regions']) and len(armor) == 8, sorted(armor)
assert len(equipment['parts']) == 5 and not {'Head', 'HandLeft', 'HandRight'} & set(armor)
assert len(painted['WoV_Plainhide_Hips']) == 1 and painted['WoV_Plainhide_Hips'][0].endswith('_leather'), painted
assert len(painted['WoV_Plainhide_Torso']) == 2, painted
for slot, original in source.items():
    trim = [d.value for d in original.data.attributes['trim'].data]
    original.data.calc_loop_triangles()
    ornament = sum(1 for t in original.data.loop_triangles if all(trim[i] for i in t.vertices))
    part = report['parts'][slot]
    assert part['triangles']-part['liningTriangles'] == ornament, (slot, part, ornament)
assert sorted(draped) == ['Hips', 'Torso'] and min(n for n, _ in draped.values()) > 500, draped
print('PLAINHIDE_LEGACY', len(armor), 'regions', len(equipment['parts']), 'items', painted, draped, flush=True)
