# Wildwarden v2 and persistent armor inventories on DEV

Scope: DEV only, character Gast. No LIVE deployment. The implementation is isolated in `/opt/wov-worktrees/wildwarden`, branch `codex/wildwarden-dev`, based on `1b22fbd`.

## Why Ironward disappeared

The assets and item registry were still present. The real game logout handler rebuilt the saved player record without `inventar`. The periodic world snapshot preserved inventories for connected players, but disconnected players came from this incomplete record. Gast's current and previous saved records therefore no longer contained an inventory, consistent with the recorded logout events.

`onPeerQuit` now includes a serialized inventory, matching the world snapshot. `server/test/inventory-logout.ts` reproduced the missing inventory on the old code and passes after the fix. It checks equipped flags, relog loading, snapshot isolation and the editor-session guard. This fixes future loss; it does not reconstruct unrelated items already lost before this fix.

## New set

`shared/src/wildwarden.ts` registers seven Wildwarden items (model version v3, see below), seven equipment slots and ten body-replacement regions; the crown replaces none. IDs are `wildwarden_crown`, `wildwarden_vest`, `wildwarden_robe`, `wildwarden_mantle`, `wildwarden_bracers`, `wildwarden_gloves` and `wildwarden_boots`.

Models: `assets/models/wildwarden/<id>.glb`; icons: `assets/sprites/<id>.png`. Source: `/home/mike/wov-assets/PlayerCharacter/Armor/Wildwarden_v3/game-ready` (v2 until 2026-09-13, see below). The source manifest records the canonical body SHA-256 `abb6d4a75a9a496beebd413f6af0a66eb80d3060349a2d7934c3f116427c5bea`, verified against DEV before deployment.

The family uses the existing equipment, ownership, networking, preview and body-mask logic. The crown is an attachment: it replaces no body region and hides no hair or face, so the textured head stays visible. All seven items are visual prototypes without new combat stats, recipes or loot.

## Delivery and regression verification

Both commands stage missing items atomically, retain existing items/equipment/position and request the normal world save:

```text
item ironward Gast
item wildwarden Gast
```

The authenticated DEV helper accepts `--set=wildwarden` (default remains Ironward):

```sh
node_modules/.bin/tsx tools/grant-ironward-dev.mts Gast --set=wildwarden --apply
node_modules/.bin/tsx tools/grant-ironward-dev.mts Gast --apply
```

When a pre-fix record lacks its entire inventory, use one explicit `--game-session --apply` login while the character is **offline**. The normal game login initializes its standard starter inventory and the command adds the selected set; no save file is edited. The default helper remains editor-only and does not enter the world.

Use `--game-session --verify-sets` while the character is offline to receive and assert all fourteen items through the real login protocol, without granting anything. Repeat after disconnect; run an idempotent editor-only grant afterward to request a fresh save and verify persistence on disk. Do not log in as the character while they are playing.

## Tests and previews

- Typecheck all four application workspaces.
- Client and server Ironward/Wildwarden tests: slots, ownership, serialization, equip/unequip, replacement masks, atomic grants, duplicate prevention and permissions.
- Logout regression: actual disconnect handler and saved-state lookup.
- `tools/test/ironward-skin.mjs BODY MODEL_DIR --family=wildwarden`: real Babylon GLB loader, canonical skin, all 28 game clips sampled four times, complete body replacement and restoration. Default family remains Ironward.
- `/play/test/wildwarden-view.html` and `/play/test/ironward-view.html`: the game's actual character preview, full set, single pieces and unequip.

The earlier Blender motion audit covered 741 frames across 19 master actions. Extreme kicks and crouched locomotion remain deformation stress cases; this integration is not a collision-free certification. The user should test both sets on DEV using I for inventory and K for the character window.

## Model version and reproduction (2026-09-18)

**Version.** The seven GLBs in `wov-web/static/assets/models/armor/wildwarden/` and in the DEV asset package are byte-identical to `Wildwarden_v3/game-ready` (sha256 compared file by file). v3 differs from v2 only in the crown: v2's crown carried a copy of the head and replaced it (112,984 bytes), v3's crown is geometry only and an attachment (89,992 bytes). The other six game-ready files are byte-identical in v2 and v3. The DEV `manifest.json` still records the `sourceSha256` of the v2 source GLB (`a323282454da...`) although its crown file is the v3 one; the v3 export manifest names `2b2678e5f526...`.

**Pipeline.** Three tools in this repository rebuild the set from the Blender sources (all inputs are read-only, outputs go into a new directory):

```sh
# 1. Build the seven items on the unmodified male rest rig (Blender 5.2, ~50 s incl. renders).
flatpak run org.blender.Blender --factory-startup -b WoV_BodyBase_Male.blend --python-exit-code 1 \
  --python ABSOLUTE_REPO/tools/build-druid-armor.py -- OUTPUT          # --quick: hero render only, no GLB export
# 2. Optional motion check against the master clips (--quick: 3 clips; without it 19 clips, every frame).
flatpak run org.blender.Blender --factory-startup -b OUTPUT/WoV_Wildwarden_Armor.blend --python-exit-code 1 \
  --python ABSOLUTE_REPO/tools/test/armor-motion.py -- wov-player-master2.blend OUTPUT/motion [--quick]
# 3. Export against the game's own skin (equipment.json comes from step 1).
node_modules/.bin/tsx tools/export-ironward.mjs OUTPUT/WoV_Wildwarden_Armor.glb WikingerKoerper.reference.glb OUTPUT/game-ready OUTPUT/equipment.json
node_modules/.bin/tsx tools/test/ironward-skin.mjs WikingerKoerper.reference.glb OUTPUT/game-ready --family=wildwarden [--write-report]
node tools/test/validate-armor-glbs.cjs OUTPUT PATH_TO_GLTF_VALIDATOR_PACKAGE
```

`ironward-skin.mjs` hides exactly the regions the registry lists for the set (ten for Wildwarden, eleven for Ironward) and checks that the body comes back on unequip. `--unregistered` skips the registry and masking for sets without an entry. `--write-report` stores `animation-validation.json` next to the models; without it nothing is written.

**What was measured.** Step 1 on the sources named above reproduces `Wildwarden_v3` exactly: the seven native GLBs, the combined GLB, `equipment.json` and `validation.json` are byte-identical (9,286 triangles). Exporting with the exporter of commit `0dc555d` reproduces the seven game-ready GLBs and their `manifest.json` byte for byte. Today's exporter additionally writes `extras.itemId` on every mesh node (as for the other equipment sets); geometry, skin and every other byte of the binary chunk are unchanged, so a rebuild differs from the shipped files in that one field only.

**Limits.** Numeric motion checks (finite geometry, edge stretch, hem height against the boots) are not a collision certificate. The earlier full run over 19 clips reported edge stretch above 3x in seven clips and a hem more than 2 cm below the boots in two; look at the rendered stills before any gameplay approval.
