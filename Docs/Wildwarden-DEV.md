# Wildwarden v2 and persistent armor inventories on DEV

Scope: DEV only, character Gast. No LIVE deployment. The implementation is isolated in `/opt/wov-worktrees/wildwarden`, branch `codex/wildwarden-dev`, based on `1b22fbd`.

## Why Ironward disappeared

The assets and item registry were still present. The real game logout handler rebuilt the saved player record without `inventar`. The periodic world snapshot preserved inventories for connected players, but disconnected players came from this incomplete record. Gast's current and previous saved records therefore no longer contained an inventory, consistent with the recorded logout events.

`onPeerQuit` now includes a serialized inventory, matching the world snapshot. `server/test/inventory-logout.ts` reproduced the missing inventory on the old code and passes after the fix. It checks equipped flags, relog loading, snapshot isolation and the editor-session guard. This fixes future loss; it does not reconstruct unrelated items already lost before this fix.

## New set

`shared/src/wildwarden.ts` registers seven Wildwarden v2 items, seven equipment slots and eleven body-replacement regions. IDs are `wildwarden_crown`, `wildwarden_vest`, `wildwarden_robe`, `wildwarden_mantle`, `wildwarden_bracers`, `wildwarden_gloves` and `wildwarden_boots`.

Models: `assets/models/wildwarden/<id>.glb`; icons: `assets/sprites/<id>.png`. Source: `/home/mike/wov-assets/PlayerCharacter/Armor/Wildwarden_v2/game-ready`. The source manifest records the canonical body SHA-256 `abb6d4a75a9a496beebd413f6af0a66eb80d3060349a2d7934c3f116427c5bea`, verified against DEV before deployment.

The family uses the existing equipment, ownership, networking, preview and body-mask logic. The crown replaces the head and suppresses the original hair/facial attachments under the existing helmet rule. All seven items are visual prototypes without new combat stats, recipes or loot.

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
