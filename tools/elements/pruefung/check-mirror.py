# Prüft: Wickelrichtung (signiertes Volumen) und x-Asymmetrie eines GLB — negatives Volumen heißt vorgespiegelt.
# Prueft Wickelrichtung (Signed Volume) und x-Asymmetrie eines GLB.
# Signed Volume > 0  => Normalen zeigen nach aussen (kein reines Vertex-Spiegeln)
# Signed Volume < 0  => Geometrie wurde gespiegelt ohne Winding-Flip (= vorgespiegelt)
import bpy, sys

pfade = sys.argv[sys.argv.index("--") + 1:]
for pfad in pfade:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=pfad)
    print(f"=== {pfad}")
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        me = o.data
        me.calc_loop_triangles()
        vol = 0.0
        for t in me.loop_triangles:
            a, b, c = (o.matrix_world @ me.vertices[i].co for i in t.vertices)
            vol += a.dot(b.cross(c)) / 6.0
        # Masse-Schwerpunkt in x: verraet Asymmetrie
        sx = sum((o.matrix_world @ v.co).x for v in me.vertices) / len(me.vertices)
        sz = sum((o.matrix_world @ v.co).y for v in me.vertices) / len(me.vertices)
        print(f"  {o.name}: signed_volume={vol:.4f}  det={o.matrix_world.determinant():.4f} "
              f"schwerpunkt_x={sx:.4f} schwerpunkt_blendery={sz:.4f}")
