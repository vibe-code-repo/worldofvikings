"""Render inventory icons from the actual exported GLBs; never saves the input.
blender -b --factory-startup --python tools/ironward-icons.py -- models-dir sprites-dir
"""
import bpy, json, sys
from pathlib import Path
from mathutils import Vector

model_dir, output_dir = map(Path, sys.argv[sys.argv.index('--') + 1:])
output_dir.mkdir(parents=True, exist_ok=True)
manifest = json.loads((model_dir / 'manifest.json').read_text())
for part in manifest['items']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model_dir / part['file']))
    scene = bpy.context.scene
    for obj in scene.objects:
        if obj.type == 'ARMATURE': obj.data.pose_position = 'REST'
    meshes = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('WoV_Ironward_')]
    # A single member of a pair makes the silhouette legible at 64 pixels.
    chosen = [o for o in meshes if len(part['regions']) == 1 or part['regions'][0] in o.name]
    for obj in meshes: obj.hide_render = obj not in chosen
    bpy.context.view_layer.update()
    points = []
    for obj in chosen:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        evaluated.to_mesh_clear()
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (lo + hi) / 2
    camera_data = bpy.data.cameras.new('IconCamera')
    camera = bpy.data.objects.new('IconCamera', camera_data); scene.collection.objects.link(camera)
    camera.location = center + Vector((1.6, -4, 1.3))
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.type = 'ORTHO'
    rotation = camera.rotation_euler.to_matrix().transposed()
    projected = [rotation @ (p - center) for p in points]
    camera_data.ortho_scale = max(max(p[i] for p in projected) - min(p[i] for p in projected) for i in [0, 1]) * 1.16
    scene.camera = camera
    print('ICON_BOUNDS', part['item'], tuple(lo), tuple(hi), 'scale', camera_data.ortho_scale, 'camera', tuple(camera.location), flush=True)
    world = bpy.data.worlds.new('Studio'); world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.6, .65, .75, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
    scene.world = world
    for name, offset, energy, size in [('Key', (-3, -4, 4), 650, 4), ('Fill', (3, -2, 2), 450, 3), ('Rim', (1, 3, 3), 800, 3)]:
        data = bpy.data.lights.new(name, 'AREA'); data.energy = energy; data.shape = 'DISK'; data.size = size
        obj = bpy.data.objects.new(name, data); scene.collection.objects.link(obj)
        obj.location = center + Vector(offset)
        obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 24
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.resolution_percentage = 100; scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = str(output_dir / (part['id'] + '.png'))
    bpy.ops.render.render(write_still=True)
