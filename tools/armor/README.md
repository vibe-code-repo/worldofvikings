# Armor tooling

Everything needed to build an armor set, export it for the game and check it lives
in this folder. The five armor sets (Ironward, Wildwarden, Ashenveil, Seidraven,
Emberrage) were built with these scripts: procedurally and deterministically in
Blender, from code, without paid generation services. The same script and the same
body source produce the same geometry, byte for byte.

The tools do **not** register anything by themselves. Registering a set (item
definitions, catalog entries) is code in `shared/src/` that a person writes after
the export and the checks have passed; see [Adding a new set](#adding-a-new-set).

## What can be run without the source assets

The body sources (`WoV_BodyBase_Male.blend`, `WoV_BodyBase_Female.blend`), the master
animation file, the canonical body GLBs and the built armor files are **not in this
repository**, and the asset package is not published yet (`AGENTS.md` §1). So today:

| You have | You can run |
|---|---|
| Only this repository (`npm ci`) | The Node checks on synthetic GLBs: `test/export-attachment.mjs`, `test/skin-gate-selftest.mjs`, `test/wildwarden-pipeline.mjs` (all three run inside `npm test`), and `catalog/equipment-sets-json.mjs`. |
| The body sources and Blender | Every `build.py` and `fit-legacy.py`, `test/armor-motion.py`, `export/render-icons.py`. |
| Also the canonical body GLBs and the built armor | `export/export-armor.mjs`, `test/skin-gate.mjs`, `test/validate-glbs.cjs`. |
| A deployed site | `test/equipment-set-assets.mjs`, `test/emberrage-browser.mjs`. |

Requirements: Blender 5.x (the scripts were last run with 5.2 LTS; run it headless,
`blender -b --factory-startup`), Node with the repository's dev dependencies
(`node_modules/.bin/tsx`), and for glTF validation the `gltf-validator` npm package
installed anywhere outside this repository. Python files need only the Python that
ships with Blender (`bpy`, `bmesh`, `mathutils`, `numpy`).

## Layout

```
tools/armor/
  README.md                           this file
  sets/
    ironward/male/
      build.py                        builds the set; writes only to OUTPUT_DIR
      armor_spec.json                 materials and size limits, read by build.py
      check_roundtrip.py              re-imports the built GLB, checks skinning, renders
      inspect_accessories.py          prints head/hand bones and vertex groups of the body
    wildwarden/male/build.py          builds the set (7 items, the crown is an attachment)
    ashenveil/male/build.py           builds the set
    seidraven/
      build_common.py                 the shared implementation for both bodies
      male/build.py                   entry point, male body
      female/build.py                 entry point, female body (adds --female)
      female/fit-legacy.py            fits the female set to the game's current female avatar
      render-pair.py                  renders the male and the female set side by side
    emberrage/
      build_common.py                 own design on top of the Seidraven scaffold
      male/build.py                   entry point, male body
      female/build.py                 entry point, female body (adds --female)
      female/fit-legacy.py            fits the female set to the game's current female avatar
      package.mjs                     writes integration metadata from real exports
  export/
    export-armor.mjs                  armor GLB -> seven canonical-skin item GLBs + manifest
    render-icons.py                   inventory icons from the exported GLBs
  catalog/
    equipment-sets-json.mjs           writes the set catalog assets/equipment-sets.json
  dev/
    grant-set-dev.mts                 gives a DEV test character a whole set (admin protocol)
  test/
    armor-motion.py                   evaluates all master animation clips on a built set
    skin-gate.mjs                     the gate: canonical skin, registry, body masking
    skin-gate-selftest.mjs            proves the gate fails when it should (runs in npm test)
    export-attachment.mjs             proves the exporter tags attachments (runs in npm test)
    wildwarden-pipeline.mjs           builder table, registry and shipped GLBs agree (npm test)
    validate-glbs.cjs                 glTF validator over a native and a canonical directory
    legacy-female-armor.mjs           masking on the shipped monolithic female body
    equipment-set-assets.mjs          read-only delivery check against a running site
    emberrage-assets.mjs              runtime checks of the Emberrage exports
    emberrage-browser.mjs             Chromium check of the Emberrage preview (repo root, needs wov-web/build)
    emberrage-glow.ts                 lifecycle test of the Emberrage glow adapter
```

Every `build.py` under `sets/*/male` and `sets/*/female` can be called directly.
The two Seidraven and the two Emberrage entry points are thin: they set the variant
and run `build_common.py`; no geometry is duplicated.

Ironward, Wildwarden and Ashenveil have only a `male/` folder: their builders look
up the objects `WoV_BodyBase_Male_<region>` in the source file, and the set
definitions register them for the male body only (`bodyVariant: male`). A female
version would need its own build against the female body plus a legacy fit.

## Vocabulary

**Items.** A set has seven items: `hood`, `shoulders`, `vest`, `bracers`, `gloves`,
`robe`, `boots` (Ironward uses its own inventory names such as `IronwardHelmet`;
see `docs/equipment-set-catalog.md`). Each item is one skinned GLB.

**Body regions.** The body is cut into eleven regions; an item replaces one or more:

| Item | Regions it replaces |
|---|---|
| hood | `Head` |
| shoulders | `ArmUpperLeft`, `ArmUpperRight` |
| vest | `Torso` |
| bracers | `ArmLowerLeft`, `ArmLowerRight` |
| gloves | `HandLeft`, `HandRight` |
| robe | `Hips` |
| boots | `LegLeft`, `LegRight` |

**`regions`, `sourceRegions`, `attachment`.** In a set's `equipment.json`, `regions`
lists the body regions an item hides while worn. `sourceRegions`, if present, lists
the geometry that is exported for the item. Without it, the exported geometry is
`regions`. An item whose `regions` is empty but which exports `sourceRegions` is an
*attachment*: it hides nothing and the exporter tags its GLB nodes
`extras.attachment` (the Wildwarden antler crown is one; the original head stays
visible). A replacing item's nodes carry `extras.replaces` with the region name.

**`hideAppearance`.** A list of appearance layers (`hair`, `beard`, `eyebrows`) that
the item hides. Only closed helmets use it; the game hides the union over all worn
items.

**Body policy: `bodyVariant`, `bodyProfile`, `figure`.** Every fitted item declares
which body it fits. The game rejects a mismatch even if the character owns the item.

| Set / variant | `bodyVariant` | `bodyProfile` | `figure` | Skeleton |
|---|---|---|---|---|
| Ironward, Wildwarden, Ashenveil | `male` | `wov-male-v1` | `wikinger` | 63-bone authoring rig, 71-bone canonical game skin |
| Seidraven / Emberrage male | `male` | `wov-male-v1` | `wikinger` | same |
| Seidraven / Emberrage female, as built by `female/build.py` | `female` | `wov-female-v1` | (not playable) | 63-bone authoring rig |
| Seidraven / Emberrage female, after `fit-legacy.py` | `female` | `legacy-female-v1` | `wikingerin` | the game's current 51-bone female avatar |

**There are two female skeletons. Never conclude the body profile from a file name:**
both `female/build.py` and `fit-legacy.py` write items called `<set>_female_<key>`,
but only the `bodyProfile` inside `equipment.json` says which skeleton the geometry
is skinned to. Check that field. The set that ships for the female figure today is
the `legacy-female-v1` one.

The 51-bone female avatar is a single monolithic mesh, so `fit-legacy.py` rebuilds
each item's lining from an exact triangle partition of that body and the game masks
exactly those triangles. Details: `docs/armor-body-variants.md`.

## The chain: from build script to a registered set

`BODY_BASE_MALE.blend` / `BODY_BASE_FEMALE.blend` are the body sources,
`MASTER_ANIMATIONS.blend` the master animation file, `GAME_BODY.glb` the canonical
game body of the matching figure (male: `wikinger/WikingerKoerper.glb`, 71 bones;
female: `wikingerin/WikingerinKoerper.glb`, 51 bones), `<SET>` and `<PREFIX>` the set
folder and the Blender object prefix (`WoV_<Set>_`). Run from the repository root.

1. **Build** (Blender). Writes the native GLBs, `equipment.json`, `validation.json`,
   the `.blend` and renders into `OUTPUT_DIR`. `--quick` renders only the hero image
   and the metadata; it does not write GLBs or the `.blend`.

   ```sh
   blender --factory-startup -b BODY_BASE_MALE.blend --python-exit-code 1 \
     --python tools/armor/sets/<SET>/male/build.py -- OUTPUT_DIR [--quick]
   # sets with two bodies:
   blender --factory-startup -b BODY_BASE_FEMALE.blend --python-exit-code 1 \
     --python tools/armor/sets/<SET>/female/build.py -- OUTPUT_DIR [--quick]
   ```

   Look at `validation.json` (triangle count, geometry checks). The entry points fail
   closed: `male/build.py` refuses `--female`, and the wrong body source stops with a
   missing-object error.

2. **Motion test** (Blender). Evaluates every master clip frame by frame on the saved
   armor blend and renders diagnostic poses.

   ```sh
   blender --factory-startup -b OUTPUT_DIR/WoV_<Set>_Armor.blend --python-exit-code 1 \
     --python tools/armor/test/armor-motion.py -- MASTER_ANIMATIONS.blend OUTPUT_DIR/motion \
     [--prefix=<PREFIX>] [--compact] [--quick]
   ```

   The default prefix is `WoV_Wildwarden_`. With wings (Seidraven) it also checks
   every rigid shoulder-socket vertex against its expected transform.

3. **Legacy female fit** (Blender; female variants of Seidraven and Emberrage only).
   Run it on the female authoring blend from step 1, with the actual female avatar:

   ```sh
   blender --factory-startup -b OUTPUT_DIR/WoV_<Set>_Armor.blend --python-exit-code 1 \
     --python tools/armor/sets/<SET>/female/fit-legacy.py -- GAME_BODY.glb LEGACY_OUTPUT_DIR
   ```

   Use `LEGACY_OUTPUT_DIR` (its GLBs and `equipment.json`, which now says
   `legacy-female-v1`) for the next steps of the female variant. The motion test
   from step 2 is a check on the authoring rig, not on the legacy avatar.

4. **Canonical export.** Re-skins the native GLBs onto the game's 71-bone skin (or the
   51-bone one) and writes seven independent item GLBs plus `manifest.json`.

   ```sh
   node_modules/.bin/tsx tools/armor/export/export-armor.mjs \
     OUTPUT_DIR/WoV_<Set>_Armor.glb GAME_BODY.glb OUTPUT_DIR/game-ready OUTPUT_DIR/equipment.json
   ```

5. **Skin gate, unregistered.** Deformation only: every game animation clip on the
   canonical skin. Use `--unregistered` while the set has no registry entry.

   ```sh
   node_modules/.bin/tsx tools/armor/test/skin-gate.mjs GAME_BODY.glb OUTPUT_DIR/game-ready \
     --unregistered [--variant=male|female] [--write-report]
   ```

6. **glTF validation.** Native exports may warn about non-root skinned nodes (expected);
   the canonical exports must have zero errors and zero warnings.

   ```sh
   node tools/armor/test/validate-glbs.cjs OUTPUT_DIR PATH_TO_GLTF_VALIDATOR_PACKAGE [canonical-folder]
   ```

7. **Icons** (Blender). Renders one icon per item from the exported GLBs; the last
   argument is the object prefix (default `WoV_Ironward_`).

   ```sh
   blender -b --factory-startup --python-exit-code 1 --python tools/armor/export/render-icons.py -- \
     OUTPUT_DIR/game-ready OUTPUT_DIR/icons <PREFIX>
   ```

8. **Register** (code, by a person): `shared/src/<set>.ts` and
   `shared/src/equipmentSets.ts`, plus the places listed under
   [Adding a new set](#adding-a-new-set). Copy the item GLBs and icons to where the
   game serves models and sprites.

9. **Catalogs.** `node_modules/.bin/tsx tools/armor/catalog/equipment-sets-json.mjs`
   writes `assets/equipment-sets.json` from the shared catalog;
   `npm run aussehen:json` (`tools/aussehen-json.mjs`) writes the appearance lists for
   the website; `node tools/vorschau-buendeln.mjs` rebuilds the website's preview
   bundle. (`tools/kleidung-richten.py` and `tools/web/charakterteile-exportieren.py`
   are related character-part tools that live outside this folder.)

10. **Skin gate, registered.** The same command as step 5 **without** `--unregistered`.
    Now the registry drives it: every item the registry lists must be in the manifest
    and on disk, the `replaces` / `attachment` extras must name exactly the registered
    regions, and full-set masking and restoration on the body is tested.

    ```sh
    node_modules/.bin/tsx tools/armor/test/skin-gate.mjs GAME_BODY.glb OUTPUT_DIR/game-ready \
      --family=<set> [--variant=male|female]
    ```

11. **Delivery check** against the running site: catalog, every model and every icon
    are fetched and compared. Read-only; it does not log in.

    ```sh
    node_modules/.bin/tsx tools/armor/test/equipment-set-assets.mjs http://127.0.0.1/
    ```

`sets/emberrage/package.mjs ROOT` (with `ROOT/Male` and `ROOT/Female`, each holding
`equipment.json` and `game-ready/manifest.json`) collects the real export data into a
prepared, not-registered `equipment-sets.json` and a `vfx-profile.json`. It never
changes the game. `dev/grant-set-dev.mts` puts a set into a DEV test character's
inventory through the normal admin protocol and is meant for a development server only.

## Adding a new set

Emberrage is the worked example: a new design that reuses everything that is not
design from the Seidraven builder.

1. **Copy the pattern.** Create `sets/<new>/build_common.py` from
   `sets/emberrage/build_common.py`, and `sets/<new>/male/build.py` (and
   `female/build.py`) from an Emberrage entry point, changing the set name in the
   header and in the path of the `build_common.py` they run.
2. **Understand what is reused.** `build_common.py` reads the text of
   `../seidraven/build_common.py`, replaces the set name (`Seidraven`/`seidraven` to
   yours), and executes it in two pieces. Two marker lines in the Seidraven file
   delimit the part that is *not* reused:

   ```python
   # New geometry inspired by the supplied silhouette, fitted to the existing male.   <- start
   ...                                                                                  (Seidraven design)
   # Join each replacement region and bind every component to the shared source rig.   <- end
   ```

   Everything before the start marker (arguments, `PARTS`, body lining copies,
   materials, and the helpers `mesh`, `leaf`, `branch`, `sleeve`, `binding_surface`,
   `attach_to_surface`) and everything after the end marker (joining per region,
   weights, checks, renders, export, `equipment.json`) is reused. The builder
   asserts that each marker occurs exactly once, so a change to either line in the
   Seidraven file makes every dependent builder fail closed instead of building
   something different. Do not edit those two lines without updating every builder
   that names them.
3. **Write the design between the markers.** In your `build_common.py`, after
   `exec(compile(scaffold.split(start)[0], ...))`, add your geometry using the helpers,
   appending to `pieces[<region>]` (index 0 of each region is the body lining copy the
   scaffold created; attach new parts to its surface with `binding_surface` /
   `attach_to_surface`). Set the colors of the `materials` the scaffold created, give
   every entry of `PARTS` its `label`, and define `wing_binding_report = []` (the
   reused tail records it). Then run the reused tail with
   `exec(compile(end + scaffold.split(end)[1], ..., 'exec'))` as Emberrage does, and
   adjust the strings you need in the tail through `.replace()` (class name, look),
   asserting each replacement changed something if it matters.
4. **Build both bodies** with the entry points, compare the triangle counts in
   `validation.json` with what you expect, then follow the chain above from step 2.
5. **Register** (code, the Emberrage commit is the template):
   `shared/src/<new>.ts` (parts with `key`, `name`, `slot`, `equipment`, `regions`,
   `hideAppearance`, `weight`, generated ids `<new>_<variant>_<key>`, the body policy
   from `shared/src/armorCompatibility.ts`), export it from `shared/src/index.ts`,
   add it to the `RUESTUNG` list in `shared/src/aussehen.ts`, to the item definitions
   in `shared/src/items/itemDefs.ts`, to the model list in `shared/src/prefabs.ts` and
   to the catalog in `shared/src/equipmentSets.ts` (set entries and, where wanted, the
   class mapping). `git grep -n emberrage -- shared client server` lists every place
   an existing set is wired. Item ids and set ids must stay stable across later
   visual revisions.
6. Continue with steps 9 to 11 of the chain.

## What the checks do not promise

- **No clipping approval.** The motion test proves finite, bounded geometry and an
  exact rest matrix over every frame of every master clip. It does not prove that
  armor and body never intersect. Deep crouches and high kicks stretch the `Hips`
  region locally by roughly 4.4 times; those are review points, not a release claim.
- **No cloth simulation** and no test of mixed sets or of runtime animation layers.
- **No performance approval.** A set has about 53 to 62 render primitives (flat
  materials, no texture atlas). Triangle count alone says nothing about draw-call
  cost in a crowd.
- The skin gate runs the real Babylon GLB loader with CPU skinning and no GPU; it says
  nothing about how a device renders.
- The legacy female fit is verified against the shipped 51-bone avatar only. The
  authoring female (`wov-female-v1`) is not playable in the game today.

## Moved from

The tools used to sit loosely in `tools/` and `tools/test/`, under names of the first
set that used them. Some names did not say what the tool does (`export-ironward.mjs`
exports every set). Behavior and outputs are unchanged.

| Was | Now |
|---|---|
| `tools/build-druid-armor.py` | `tools/armor/sets/wildwarden/male/build.py` |
| `tools/build-seidraven-armor.py` | `tools/armor/sets/seidraven/build_common.py` (entry points `male/build.py`, `female/build.py` are new) |
| `tools/build-emberrage-armor.py` | `tools/armor/sets/emberrage/build_common.py` (entry points are new) |
| `tools/fit-seidraven-legacy-female.py` | `tools/armor/sets/seidraven/female/fit-legacy.py` |
| `tools/fit-emberrage-legacy-female.py` | `tools/armor/sets/emberrage/female/fit-legacy.py` |
| `tools/package-emberrage.mjs` | `tools/armor/sets/emberrage/package.mjs` |
| `tools/export-ironward.mjs` | `tools/armor/export/export-armor.mjs` |
| `tools/ironward-icons.py` | `tools/armor/export/render-icons.py` |
| `tools/equipment-sets-json.mjs` | `tools/armor/catalog/equipment-sets-json.mjs` |
| `tools/grant-ironward-dev.mts` | `tools/armor/dev/grant-set-dev.mts` |
| `tools/test/armor-motion.py` | `tools/armor/test/armor-motion.py` (now takes `--prefix=` and `--compact`) |
| `tools/test/ironward-skin.mjs` | `tools/armor/test/skin-gate.mjs` |
| `tools/test/armor-skin-gate.mjs` | `tools/armor/test/skin-gate-selftest.mjs` |
| `tools/test/armor-export-attachment.mjs` | `tools/armor/test/export-attachment.mjs` |
| `tools/test/wildwarden-pipeline.mjs` | `tools/armor/test/wildwarden-pipeline.mjs` |
| `tools/test/validate-armor-glbs.cjs` | `tools/armor/test/validate-glbs.cjs` |
| `tools/test/legacy-female-armor.mjs` | `tools/armor/test/legacy-female-armor.mjs` |
| `tools/test/equipment-set-assets.mjs` | `tools/armor/test/equipment-set-assets.mjs` |
| `tools/test/emberrage-assets.mjs`, `emberrage-browser.mjs`, `emberrage-glow.ts` | `tools/armor/test/` (same names) |

New in this folder (they existed only outside the repository): the Ironward builder
(`sets/ironward/male/`, now taking `OUTPUT_DIR` after `--` and writing nothing next to
itself), the Ashenveil builder, `sets/seidraven/render-pair.py`, and the generalised
`test/armor-motion.py`.
