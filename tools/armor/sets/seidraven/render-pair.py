"""Render both actual Seidraven variants in an authentic master idle pose.

Blender -b MALE_ARMOR.blend --python tools/armor/sets/seidraven/render-pair.py -- \\
        FEMALE_ARMOR.blend MASTER_ANIMATIONS.blend OUTPUT.png
MALE_ARMOR.blend and FEMALE_ARMOR.blend are the outputs of male/build.py and female/build.py;
MASTER_ANIMATIONS.blend is the master animation file (action Idle1, frame 31).
"""
import bpy
import sys
from pathlib import Path
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index('--')+1:]
female_path, master_path, output = args
scene = bpy.context.scene
male_rig = bpy.data.objects['WoV_Player_Armature']
male = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('WoV_Seidraven_')]
with bpy.data.libraries.load(female_path, link=False) as (source, destination):
    destination.objects = [n for n in source.objects if n.startswith('WoV_Seidraven_') or n == 'WoV_Player_Armature']
female = [o for o in destination.objects if o.type == 'MESH']
female_rig = next(o for o in destination.objects if o.type == 'ARMATURE')
for obj in destination.objects:
    scene.collection.objects.link(obj)
with bpy.data.libraries.load(master_path, link=False) as (source, destination):
    destination.actions = ['Idle1']
action = destination.actions[0]
for rig in [male_rig, female_rig]:
    rig.data.pose_position = 'POSE'
    rig.animation_data_create()
    for track in rig.animation_data.nla_tracks:
        track.mute = True
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
scene.frame_set(31)
bpy.context.view_layer.update()
originals = list(scene.objects)
for group, offset in [(male,-1.35),(female,1.35)]:
    for obj in group:
        obj.hide_set(False)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in group:
        data = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
        for vertex in data.vertices:
            vertex.co = obj.matrix_world @ vertex.co + Vector((offset,0,0))
        copy = bpy.data.objects.new('Pair_'+obj.name,data)
        scene.collection.objects.link(copy)
for obj in originals:
    if obj.type == 'MESH' and obj.name != 'Preview_Ground':
        obj.hide_render = True
camera = scene.camera
camera.location = (1.2,-9,2.65)
camera.rotation_euler = (Vector((0,0,1.05))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.ortho_scale = 5.65
scene.render.resolution_x = 2400
scene.render.resolution_y = 1250
scene.render.resolution_percentage = 100
scene.render.filepath = output
bpy.ops.render.render(write_still=True)
