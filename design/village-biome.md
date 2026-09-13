# Village grove rendering profile

The start island now uses the **Dorfhain** region preset. It is a curated
grassland biome, not a new network biome bit: existing terrain edits,
spawn coordinates and progression compatibility remain intact. Other regions
retain their authored vegetation lists. The Village atmosphere is the global
DEV look, matching the request to carry the reference style across the project.

## Reference and evidence

Inspected the installed Unity export and the decompiled game scripts.
Village1 differs from Level1; the earlier defaults had mixed both.

* Village1 RenderSettings: exp2 fog, density 0.015, RGB
  (0.3745098, 0.56013644, 0.7490196). Half visibility at 55.50 m;
  10% visibility at 101.16 m. Linear 0/300 values are inactive.
* Sun: RGB (1, 0.883333, 0.75), intensity 2, elevation 50 degrees,
  shadow strength 0.87. Babylon darkness means remaining light: 0.13.
  Retain the existing day/night path and calibrated Babylon radiance scale,
  multiplied by the measured Village/Level1 intensity ratio 2/2.3.
  Unity's fixed sun azimuth and baked sky illumination are not reproduced.
* Fantasy1: Neutral, +0.2 EV, bloom threshold 1/intensity 2,
  blue shadows/warm midtones, Gaussian far blur 30–50 m and radius 0.5.
  Existing calibrated exposure, saturation, vignette and grade remain where
  their engine units differ. The new far-blur curve uses the existing
  depth-aware 13-tap pass; it is not a byte-identical Unity Gaussian filter.
* Moss Dark.terrainlayer references texture GUID
  008d4f32cb6632648ac5e26edf212073, matching Moss-Dark-A.png.meta.
  Copy unchanged to terrain-moss-village.png, outside Git.
  Tile 11 uses it; tiles 1 and 10 retain the darker forest source.
  Linear mean luminance: village 0.03665, forest 0.01803.
* Meadow slopes use matte Rockwall 3 (5 m, metallic 0.2, smoothness 0.2)
  before the existing moss-covered cliff layer. Procedural slope/noise blends
  approximate the hand-painted Unity splat maps; terrain shape stays procedural.
* The 26-model palette selects tree/bush/rock families found in Village1.
  Where the store deduplicates an identical textured rock sibling, reuse the
  registered sibling. Retain original materials, leaf gradients, instancing
  and the already imported grass prototype heights.

The decompiled VisibilityGOSystem uses a 100 m distance and scans objects
every frame. Retain our spatial buckets and shadow-instance culling instead.
PostprocessingSetter only toggles the Volume; there is no hidden runtime
colour transformation in that script to port.

## Performance and compatibility

* Reduce the start-island species palette; reuse existing meshes/materials
  and instance buffers instead of importing duplicate assets.
* Keep two 1024 shadow cascades over 50 m (Babylon clamps to at least two).
* Enable view-gated sun shafts for fresh settings; preserve explicit saved choices.
* Grass visibility now uses the actual fog equation, including disabled and
  linear fog. Previously it always used the exp2 density formula.
* No extra texture-array layers, full-resolution passes or per-frame scene scans.

Source textures remain external. On another machine provide
terrain-moss-village.png with the other ground sources, run npm run store:boden,
and include the generated arrays in the asset package. Missing village source
fails explicitly instead of silently displaying the forest colour.

## Validation

Typecheck and client production build passed. Focused checks cover registered
palette entries, editor round trips, source fog values, fog modes, terrain
source mapping and texture luminance. Visual proof includes midday, evening
and night on RX 7900 XT, WebGL2/Vulkan, 1440×900.
Screenshots and raw frame samples: /home/mike/wov-village-proof on the workstation.
Final test and performance results are recorded in the Vault; spawn measurements
are not a world-wide FPS guarantee.

During validation the concurrent Emberrage release added 14 equipment assets.
Its updated main manifest is incorporated before the final full test run.
This change does not modify equipment assets.
