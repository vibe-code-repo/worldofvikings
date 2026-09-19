# Equipment sets for character creation

`shared/src/equipmentSets.ts` is the shared set catalog. It is registration data only: importing it does not grant, equip or persist items. Ashenveil v1 is registered for the male `wikinger` body. No player inventory was seeded as part of this integration.

## Stable identifiers

| Set ID | Asset revision | Items |
| --- | --- | --- |
| `ironward` | 3 | 7 |
| `wildwarden` | 2 | 7 |
| `ashenveil` | 1 | 7 |

The folder name `Ashenveil_v1` is an authoring path, not the set ID. Store `ashenveil` as the selected set; the separate version identifies the asset revision. Set IDs and existing item IDs must remain stable across visual revisions.

| Ashenveil item / appearance ID | Appearance slot | Inventory equipment slot |
| --- | --- | --- |
| `ashenveil_hood` | `kopf` | `kopf` |
| `ashenveil_vest` | `oberkoerper` | `hemd` |
| `ashenveil_robe` | `beine` | `hose` |
| `ashenveil_shoulders` | `schultern` | `schultern` |
| `ashenveil_bracers` | `unterarme` | `unterarme` |
| `ashenveil_gloves` | `haende` | `haende` |
| `ashenveil_boots` | `fuesse` | `schuhe` |

Inventory item IDs are the strings accepted by `findItem`, not numeric database IDs and not instance IDs. Ashenveil and Wildwarden use the same item and appearance IDs. **Ironward does not:** `IronwardHelmet` is the inventory item ID; `ironward_helm` is its appearance ID. Use the catalog fields instead of deriving one from the other.

## Website handoff

Run `node_modules/.bin/tsx tools/armor/catalog/equipment-sets-json.mjs` to generate `assets/equipment-sets.json`. DEV serves it at `/assets/equipment-sets.json`. This is separate from the older appearance list and does not require changing the website in this task.

Schema version 1 provides `sets[]` with `id`, `version`, `name`, `figure`, `itemIds`, `appearance`, and `parts`. Each part carries `itemId`, `appearanceId`, `equipmentSlot`, `appearanceSlot`, `model`, `icon`, and `regions`.

## Per-item appearance visibility

Each registered part now also carries `hideAppearance`, a list of `hair`, `beard`, and/or `eyebrows`. Missing or empty lists hide nothing. It is an additive field in catalog schema version 1 and is also exposed on `ItemShared`, `RUESTUNG`, and the generated website `appearance.json` under `equipmentSets`.

- Wildwarden crown: `hideAppearance: []` (all selected cosmetic attachments remain visible).
- Ashenveil hood and Ironward helmet: `hideAppearance: ['hair', 'beard', 'eyebrows']`.
- Other current items: `hideAppearance: []`.

`regions` and `hideAppearance` are independent: a crown can replace the Head mesh without hiding its separately selected hair, beard or eyebrows. Across mixed items, the union of hidden features wins. There is no "force show" override that could reveal hair through another equipped helmet.

The shared visibility resolver is used by the local avatar, remote player rendering, inventory preview and website preview. Call it with successfully loaded, currently selected item models only. Recompute after selection changes and load completion; keep cosmetic selection and color unchanged while hidden. A failed or stale load must not hide the body or attachments. Compatible male hairstyles remain available in all four views; the incompatible H_01 export stays blocked.

The website's class-to-set mapping now references stable set IDs; item paths and regions come from the generated catalog, not a second handwritten item list. Regenerate both `equipment-sets.json` and the website `appearance.json`, rebuild `tools/web/vorschau-web.ts` into `wov-web/static/assets/js/vorschau.js`, and build the website when changing registered policies.

No inventory or account migration is required: saved items resolve their current shared definitions by item ID. Do not persist or trust client-supplied visibility flags as gameplay authority. Character selection and login continue to carry item/appearance IDs; the registered definition supplies the policy. This update does not add or grant equipment at login.

Regression test: `client/test/appearance-visibility.ts` exercises all four real rendering paths, catalog/definition consistency, inventory save/load, mixed equipment, delayed/unloaded items, restoration and hair compatibility. It runs in the normal test suite without a GPU or player login.

- Resolve `model` relative to `/assets/models/` (it already ends in `.glb`).
- Resolve `icon` relative to `/assets/sprites/` (it already ends in `.png`).
- Use `appearance` as the slot-to-appearance-ID map for previews.
- Hide original body regions only after the corresponding replacement model loaded successfully; restore them on removal. Reuse the game's armor visibility and skeleton checks.
- Do not offer these sets for the female body: they target the canonical male skeleton.

Example selection (a handoff proposal, not an implemented account API):

```json
{ "figure": "wikinger", "equipmentSetId": "ashenveil" }
```

The other character-editor task still needs to save this choice and implement its trusted, idempotent login grant. Resolve and validate the set on the server, check body compatibility, preserve existing inventory, avoid duplicates on repeated logins, and equip only successfully assigned items. Do not accept arbitrary client-supplied item lists as authority. The current appearance handler correctly rejects unowned armor; sending appearance IDs alone will not grant it.

## Verification

- `server/test/equipment-sets.ts`: all 21 IDs resolve, slots/masks match, ownership is enforced, appearance requests do not grant items, owned Ashenveil equips and unequips.
- Existing Ironward and Wildwarden server tests and the Ironward client test remain green.
- `tools/armor/test/skin-gate.mjs BODY ASHENVEIL_MODELS --family=ashenveil`: canonical 71-bone skin, full-set body masking/restoration, 53 primitives, 28 animation clips with four samples each.
- Shared/server/client/admin typechecks and client production build pass.
- `tools/armor/test/equipment-set-assets.mjs http://127.0.0.1/`: read-only delivery check for the catalog, all 21 model files and all 21 icons. Does not log in to a player account.

The asset manifest was regenerated on DEV and now includes all 21 armor models; Ironward and Wildwarden had previously been missing from that manifest despite existing on disk.

The long robe still distorts in deep crouches and high kicks. These tests do not certify collision-free clothing or mixed-set motion. Source assets and visual tests remain in `/home/mike/wov-assets/PlayerCharacter/Armor/Ashenveil_v1/`.
