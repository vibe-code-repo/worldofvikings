"""The shared armor build: initialisation, helpers, joining, checks, renders, export.

    ctx = init(CONFIG, args)   Blender scene, names, PARTS, materials, linings, helpers
    design(ctx)                the set's geometry, appended to ctx.pieces[<region>]
    finish(ctx)                join per region, bind to the rig, check, render, export,
                               equipment.json and validation.json
    build(CONFIG, design_module) does the three in a row and calls the module's
                               after_export(ctx), if it has one

`args` is the command line after Blender's `--`: OUTPUT_DIR [--quick] [--female]
(the thin entry points check it first, sets/entry_args.py). Everything a set may vary
is a field of its configuration (lib/config.py); nothing here is edited per set.
Geometry is deterministic, no paid APIs.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from types import SimpleNamespace
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

from . import config as schema


def init(config, args):
    cfg = schema.complete(config)
    ctx = SimpleNamespace(config=cfg)
    NAME, FAMILY = cfg['name'], cfg['family']
    ctx.ARGS = ARGS = list(args)
    ctx.ROOT = ROOT = Path(ARGS[0]).resolve()
    ROOT.mkdir(parents=True, exist_ok=True)
    ctx.RENDERS = ROOT / 'renders'
    ctx.RENDERS.mkdir(exist_ok=True)
    ctx.QUICK = '--quick' in ARGS
    ctx.VARIANT = VARIANT = 'Female' if '--female' in ARGS else 'Male'
    ctx.PREFIX = 'WoV_' + NAME + '_'
    ctx.ITEM_PREFIX = FAMILY + '_' + VARIANT.lower() + '_'
    ctx.BODY_POLICY = BODY_POLICY = {'bodyVariant': VARIANT.lower(), 'bodyProfile': 'wov-female-v1' if VARIANT == 'Female' else 'wov-male-v1', 'figure': 'wikingerin' if VARIANT == 'Female' else 'wikinger'}
    ctx.SLOTS = SLOTS = list(schema.REGIONS)
    ctx.PARTS = PARTS = []
    for item in cfg['items']:
        part = {'item': ctx.ITEM_PREFIX + item['key'], 'label': item['label'], 'regions': list(item['regions'])}
        part.update(BODY_POLICY)
        part['hideAppearance'] = list(item['hide_appearance'])
        if cfg['item_vfx'] is not None:
            part['vfx'] = dict(cfg['item_vfx'])
        PARTS.append(part)
    ctx.scene = scene = bpy.context.scene
    ctx.rig = rig = bpy.data.objects['WoV_Player_Armature']
    ctx.source_path = bpy.data.filepath
    ctx.base = base = {s: bpy.data.objects['WoV_BodyBase_' + VARIANT + '_' + s] for s in SLOTS}
    # Renders go through the scene's first view layer. The female source keeps some body
    # regions in collections that layer excludes; link such regions to the scene root so a
    # consumer that makes one hide_render=False (a free region, a review tool's --keep-body)
    # actually shows it. hide_render is untouched, so nothing changes for a region that stays
    # hidden, and no exported GLB is affected -- only what a later, deliberate unhide can show.
    for obj in base.values():
        if not obj.visible_get(view_layer=scene.view_layers[0]):
            scene.collection.objects.link(obj)
    ctx.pose = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    ctx.collection = collection = bpy.data.collections.new(NAME + '_Equipment')
    scene.collection.children.link(collection)
    ctx.pieces = pieces = {s: [] for s in SLOTS}
    ctx.materials = materials = {}
    for name in schema.MATERIALS:
        color = tuple(cfg['palette'][name])
        roughness, metallic = cfg['finish'].get(name, schema.DEFAULT_FINISH[name])
        mat = bpy.data.materials.new(NAME + '_' + name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*color, 1)
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = metallic
        if name in cfg['emission']:
            shader.inputs['Emission Color'].default_value = (*color, 1)
            shader.inputs['Emission Strength'].default_value = cfg['emission'][name]
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

    ctx.mesh, ctx.leaf, ctx.branch, ctx.sleeve = mesh, leaf, branch, sleeve
    ctx.binding_surface, ctx.attach_to_surface = binding_surface, attach_to_surface

    # Complete source regions form the retained lining/body under the armor.
    for slot, src in base.items():
        obj = src.copy()
        obj.data = src.data.copy()
        obj.name = NAME + '_' + slot + '_lining'
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

    # Regions no item replaces belong to the player: drop their linings, keep the source
    # body visible there in every image, and leave only the items of the other regions.
    ctx.free_regions = FREE = list(cfg['free_regions'])
    for slot in FREE:
        for obj in pieces.pop(slot):
            bpy.data.objects.remove(obj, do_unlink=True)
        SLOTS.remove(slot)
        base[slot].hide_render = False; base[slot].hide_set(False)
    PARTS[:] = [part for part in PARTS if not set(part['regions']) & set(FREE)]
    ctx.wing_binding_report = []
    return ctx


def finish(ctx):
    cfg = ctx.config
    NAME = cfg['name']
    ROOT, RENDERS, QUICK, VARIANT, PREFIX = ctx.ROOT, ctx.RENDERS, ctx.QUICK, ctx.VARIANT, ctx.PREFIX
    SLOTS, PARTS, scene, rig, base, pose, pieces = ctx.SLOTS, ctx.PARTS, ctx.scene, ctx.rig, ctx.base, ctx.pose, ctx.pieces
    if cfg['wing_binding'] is None:
        assert not ctx.wing_binding_report, 'a design that binds parts rigidly to the shoulder sockets needs wing_binding in its configuration'

    # Join each replacement region and bind every component to the shared source rig.
    ctx.armor = armor = {}
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
    ctx.cam = cam = bpy.data.objects.new('Preview_Camera', bpy.data.cameras.new('Preview_Camera'))
    studio.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = cfg['camera_scale']
    scene.camera = cam

    def camera(view='hero'):
        cam.data.ortho_scale = cfg['camera_scale']
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
    scene.render.resolution_x = scene.render.resolution_y = cfg['render_resolution']
    scene.render.resolution_percentage = 75 if QUICK else 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = cfg['view_transform']
    scene.view_settings.look = cfg['look']
    scene.view_settings.exposure = -.55
    # Blender 5 compositor: exported materials emit light; preview bloom is separate.
    tree=bpy.data.node_groups.new(NAME+'_Preview_Bloom','CompositorNodeTree')
    scene.compositing_node_group=tree
    tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
    layers=tree.nodes.new('CompositorNodeRLayers')
    glare=tree.nodes.new('CompositorNodeGlare')
    glare.inputs['Type'].default_value='Fog Glow'
    glare.inputs['Threshold'].default_value=.25
    glare.inputs['Strength'].default_value=cfg['preview_glare']
    glare.inputs['Size'].default_value=.7
    output=tree.nodes.new('NodeGroupOutput')
    tree.links.new(layers.outputs['Image'],glare.inputs['Image'])
    tree.links.new(glare.outputs['Image'],output.inputs[0])

    def render(name):
        scene.render.filepath = str(RENDERS/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        print('RENDER', name, flush=True)

    ctx.visible, ctx.target, ctx.camera, ctx.render = visible, target, camera, render

    report = {'source': ctx.source_path, 'name': NAME, 'slots': {}, 'pose_checks': [],
              'version': 1, 'variant': VARIANT, 'robe_foundation': cfg['skirt_description']}
    if cfg['wing_binding'] is not None:
        report.update({'wing_binding': ctx.wing_binding_report, 'wing_effect': schema.WING_EFFECT})
    report.update({'closed_boots': True,
                   'decoration_binding': 'barycentric garment weights',
                   'collision_certified': False, 'cloth_simulation': False, 'source_overwritten': False})
    ctx.report = report
    for slot, obj in armor.items():
        obj.data.calc_loop_triangles()
        invalid = sum(not all(math.isfinite(c) for c in v.co) for v in obj.data.vertices)
        unweighted = sum(abs(sum(g.weight for g in v.groups)-1) > .001 for v in obj.data.vertices)
        zero_area = sum(p.area < 1e-12 for p in obj.data.polygons)
        report['slots'][slot] = {'vertices': len(obj.data.vertices), 'triangles': len(obj.data.loop_triangles),
                                'nonfinite_vertices': invalid, 'bad_weight_sums': unweighted, 'zero_area_faces': zero_area}
        assert not (invalid or unweighted or zero_area), (slot, report['slots'][slot])
    report['total_triangles'] = sum(r['triangles'] for r in report['slots'].values())
    assert report['total_triangles'] < cfg['triangle_limit'], report['total_triangles']
    visible(SLOTS)
    render('01_'+NAME+'_Hero')
    if not QUICK:
        cam.data.ortho_scale=2.65
        cam.location=(0,-7,1.8); target(cam,(0,0,1.35)); render(cfg['detail_image'])
        camera('front'); render('02_'+NAME+'_Front')
        camera('back'); render('03_'+NAME+'_Back')
        camera()
        for i, part in enumerate(PARTS):
            visible(part['regions']); render('%02d_%s' % (10+i, part['item']))
        visible([]); render('00_Body_Reference')
        visible(SLOTS)
        cam.data.ortho_scale = .96
        cam.location = (.5, -2.5, 2.02)
        target(cam, (0, 0, 1.78)); render(cfg['hood_image'])
        visible(['LegLeft','LegRight'])
        cam.data.ortho_scale = .65
        cam.location = (.8,-2,.7)
        target(cam,(0,0,.19)); render(cfg['boot_image'])
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

    ctx.export = export
    if cfg['export_in_quick'] or not QUICK:
        export('WoV_'+NAME+'_Armor.glb', list(armor.values()))
        for part in PARTS:
            export(part['item']+'.glb', [armor[s] for s in part['regions']])
        visible(SLOTS)
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/('WoV_'+NAME+'_Armor.blend')))
    (ROOT/'validation.json').write_text(json.dumps(report, indent=2)+'\n')
    equipment = {**ctx.BODY_POLICY, 'name': NAME, 'variant': VARIANT.lower(), 'class': cfg['class_label'], 'version': 1, 'prefix': PREFIX, 'parts': PARTS, 'hipsAlreadyFixed': True, 'registrationStatus': 'not_registered'}
    if cfg['wing_binding'] is not None:
        equipment['wingBinding'] = list(cfg['wing_binding'])
    equipment['appearanceMetadata'] = 'hideAppearance is an item-level hide list; union of equipped items'
    equipment['vfx'] = cfg['vfx']
    if ctx.free_regions:
        equipment['freeRegions'] = list(ctx.free_regions)
    ctx.equipment = equipment
    (ROOT/'equipment.json').write_text(json.dumps(equipment, indent=2)+'\n')
    print('DONE', report['total_triangles'], flush=True)
    return ctx


def build(config, design, args=None):
    """init, the module's design(ctx), finish, then the module's after_export(ctx) if any."""
    import sys
    args = sys.argv[sys.argv.index('--') + 1:] if args is None else args
    ctx = init(config, args)
    design.design(ctx)
    finish(ctx)
    after = getattr(design, 'after_export', None)
    if after:
        after(ctx)
    return ctx
