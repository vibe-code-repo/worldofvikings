# Armor body variants and Seidraven legacy-female fitting

Implemented in an isolated DEV worktree on its own branch. Deployed to the running DEV deployment on 2026-09-13 at approximately 13:58 UTC, code `6bbcc4d`, after merging the intervening DEV/Wildwarden fixes. No old production deployment, inventory grant, body-file replacement or account migration.

## One compatibility policy

Every fitted armor definition now carries `bodyVariant` (`male` / `female`), `bodyProfile` (exact body/rig version), and `figure` (playable figure ID). `canWearArmor` is shared by request validation and rendering. A missing/unknown target fails closed for fitted equipment. The profile distinguishes the two incompatible female rigs; a female label alone is insufficient.

| Family / variant | bodyVariant | bodyProfile | figure | catalog ID |
| --- | --- | --- | --- | --- |
| Ironward, Wildwarden, Ashenveil | male | wov-male-v1 | wikinger | existing IDs unchanged |
| Seidraven male | male | wov-male-v1 | wikinger | seidraven_male |
| Seidraven female | female | legacy-female-v1 | wikingerin | seidraven_female |
| Emberrage male / female | male / female | wov-male-v1 / legacy-female-v1 | wikinger / wikingerin | emberrage_male / emberrage_female |
| Plainhide male / female (starter clothing, five items) | male / female | wov-male-v1 / legacy-female-v1 | wikinger / wikingerin | plainhide_male / plainhide_female |
| Gravethorn male / female | male / female | wov-male-v1 / legacy-female-v1 | wikinger / wikingerin | gravethorn_male / gravethorn_female |
| Web preview body of the female set (63 bones) | female | wov-female-v1 (the catalog's `previewBodyProfile`) | not playable in-game | files under `armor/<family>/`, chosen from the register |

The two registered Seidraven variants share `familyId: seidraven`, but have separate stable set/item IDs (`seidraven_male_*` and `seidraven_female_*`). The catalog retains schema version 1 because the existing fields/IDs remain compatible and the policy fields are additive. The two old leather pieces are explicitly legacy-female-only.

ItemShared, appearance definitions, catalog sets/parts and generated figure metadata carry the policy. The server rejects incompatible equip requests even if the item is owned; inventory synchronization also removes incompatible equipped selections after a body change while keeping every owned item. All four rendering paths use the same policy. Character creation chooses the matching Seidraven variant for Seherin; unsupported class/body combinations are not offered. Existing `hideAppearance` flags are unchanged: Seidraven helmets hide hair, beard and eyebrows, other Seidraven parts hide none. Wildwarden retains its textured head and cosmetics.

Character creation still sends its existing empty top/legs fields. The login grant (`grantStarterSet`, see `docs/equipment-set-catalog.md`) consumes the variant catalog and item IDs and delivers the Plainhide set that fits the figure to every new character. Do not trust client-supplied compatibility flags or use them instead of server-side item definitions.

## Real female avatar fitting

Asset output: the `Female_Legacy_v1` folder of the Seidraven set in the authoring asset store.

`tools/armor/sets/seidraven/female/fit-legacy.py` reads the prior female authoring armor and the actual `wikingerin/WikingerinKoerper` GLB. It removes the prior lining, fits ornaments with explicit anatomical rest-frame transforms (not bone renaming alone), transfers weights to the 51-bone legacy rig, and rebuilds lining from an exact partition of the actual female body. Wings use rigid `L_Clavicle` / `R_Clavicle` binding. Original files remain unchanged.

**The 63-bone web body and the 51-bone game figure.** Both female skeletons use the same file names (`<family>_female_<key>.glb`); only the `bodyProfile` inside the file says which one it is skinned to. The client picks the file from the body it actually loaded: on the 63-bone web body `armorFileForSkeleton` asks the register (`femaleWebArmorFile`) and loads `armor/<family>/<item>`, so no family is hard-coded in a pattern. The registered skin gate checks that fit with `--web` (see `tools/armor/README.md`).

**Free regions.** A set need not cover the whole body. Plainhide replaces eight regions and never masks `Head`, `HandLeft` and `HandRight`; the registry's regions per item drive the mask, so the free regions stay visible and unmasked without any special case.

The shipped female body is monolithic. `prepareLegacyFemaleBody` marks only freshly loaded body meshes and creates independent geometry per character. `updateLegacyFemaleMask` hides exact triangle partitions by skin-bone contribution, using the same classifier as the fitted lining. Vertices, UVs, textures and weights remain intact. Removing equipment restores the exact original index list; cosmetics and other characters are not affected. No replacement base-body GLB needs deploying.

The complete Seidraven female set is 28,796 triangles: 21,030 triangles are the unchanged original body surface retained as replacement lining, and 7,766 are armor geometry. (Plainhide keeps 7,573 head and hand triangles of the original body and brings 14,539 triangles, 13,457 of them lining; Gravethorn replaces all 21,030 and brings 26,791.) This preserves exact seams at partial equipment boundaries; it is not a new low-poly body optimization.

## Verification

- Four workspace typechecks; client build; website check/build; web preview bundle.
- Catalog and server tests: 35 registered items, stable IDs, correct body policies, mixed-body rejection, ownership, invalid saved selections repaired without deleting items.
- Actual female GLB: 6 complete native animations / 492 frames in Blender; canonical export tested in Babylon against the exact 51-bone target and inverse bind matrices (5 samples per clip).
- Seven canonical female item files: zero glTF errors or warnings; emissive material declarations retained.
- Each part hides exactly its own fitted lining triangle count; full set hides the body, removal restores original indices, another character and unmarked cosmetics stay unchanged. Light feathers verified rigidly bound to the correct clavicle.
- Existing four-path appearance visibility tests pass after updating stale Wildwarden crown assertions to the current head-preserving behavior.

The wider repository suite runs in an isolated checkout without the complete asset store; asset-dependent skips/environment failures are not evidence of a complete release gate. Neither these numeric tests nor selected Blender previews certify collision freedom, mixed animation layers, or the final in-game glow halo. Runtime bloom configuration remains separate integration work.

## Deployed integration

`/assets/equipment-sets.json` and `/assets/appearance.json` expose identical set policies. The served preview was rebuilt and its cache key advanced to `seidraven-body-variants-v1-20260913`. HTTP verification passed for all five sets, 35 GLBs and 35 icons, including Seidraven mesh-node body tags and replacement regions. All three services are active; website/client return HTTP 200 and the game socket endpoint returns the expected HTTP 426. No account was logged into for the smoke test.

Rollback materials are a backup of the previous deployment: previous code, website build, catalogs and VERSION, plus the deployed Seidraven assets. Roll back code, website and both JSON catalogs together; do not restore world/account data. Assets are not tracked in Git, and no new GitHub asset release was published. A fresh clone using the previous release package will not obtain these files automatically.

The DEV deployment currently serves both DEV hostnames and the public website; those routes share this deployment. The old production container was not touched. Login/start-item grants and runtime bloom remain separate work.
