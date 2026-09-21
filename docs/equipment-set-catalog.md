# Equipment sets for character creation

`shared/src/equipmentSets.ts` is the shared set catalog. It is registration data only: importing it does not grant, equip or persist items. Ashenveil v1 is registered for the male `wikinger` body. Plainhide and Gravethorn are registered for both bodies (see below).

## Stable identifiers

| Set ID | Asset revision | Items |
| --- | --- | --- |
| `ironward` | 3 | 7 |
| `wildwarden` | 2 | 7 |
| `ashenveil` | 1 | 7 |
| `seidraven_male`, `seidraven_female` | 1 | 7 each |
| `emberrage_male`, `emberrage_female` | 1 | 7 each |
| `plainhide_male`, `plainhide_female` | 1 | **5** each |
| `gravethorn_male`, `gravethorn_female` | 1 | 7 each |

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

## Plainhide and Gravethorn

**Plainhide** (`plainhide_male` for `wikinger`, `plainhide_female` for `wikingerin`) is the plain leather clothing every new character starts in. It has **five** items on purpose, keyed `shoulders`, `vest`, `bracers`, `robe`, `boots` (labels Plainhide Sleeves, Tunic, Wraps, Trousers, Shoes): there is no hood and no gloves, so the head and both hands stay the player's own body (skin tone, face, hair, beard). The set entry says so with two additive fields: `starter: true` and `freeRegions: ['Head', 'HandLeft', 'HandRight']`, the body regions no piece replaces. Nothing masks a free region; on the 51-bone game figure the mask leaves 7,573 head and hand triangles visible and hides the 13,457 lining triangles of the eight replaced regions.

**Gravethorn** (`gravethorn_male`, `gravethorn_female`) is the thorned plate set with red glowing seams; the class mapping `CLASS_EQUIPMENT_FAMILIES.berserker = 'gravethorn'` gives it to the Berserker (`classId: 'berserker'` in the catalog, which is how the website's armor button picks it). Seven items (Gravethorn Helm, Pauldrons, Cuirass, Bracers, Gauntlets, Tassets, Greaves); only the helm hides hair, beard and eyebrows. Every item carries `vfxProfile: 'gravethorn_red'`; the emission itself is geometry (four emissive materials, 568 emissive triangles per body), and the selective glow layer picks the materials `Gravethorn_red`, `_eyes`, `_glow`, `_core`. Emberrage uses the same layer with its own `emberrage_red` materials.

The register is the only source for names, slots, regions, `hideAppearance`, `figure` and `vfxProfile`. The `class` field in the authoring `equipment.json` files is a placeholder and is not used.

### Starting equipment

`starterSetForClass(classId, figure)` returns the Plainhide set for the figure for **every valid class** (nine classes, two figures) and nothing for an unknown class. The class sets (Ironward, Wildwarden, Ashenveil, Seidraven, Emberrage, Gravethorn) stay registered and keep their class mapping for the catalog and the previews, but the login no longer delivers them; how a player earns them is not decided yet.

`grantStarterSet` (unchanged) delivers at login when the character's marker `starterSetGranted` is empty. A character that already carries a marker, whichever family it names, keeps its items and gets nothing new; nothing is removed and nothing is created automatically. The delivery is atomic: a bag that cannot take all five pieces is left untouched and the delivery is retried at the next login. Pieces that were delivered by hand count as delivered. If the figure changes later, the marker still wins: no second grant and no removal; pieces of the other body stay in the bag but cannot be worn (`canWearArmor`).

## Website handoff

Run `node_modules/.bin/tsx tools/armor/catalog/equipment-sets-json.mjs` to generate `assets/equipment-sets.json`. DEV serves it at `/assets/equipment-sets.json`. This is separate from the older appearance list and does not require changing the website in this task.

Schema version 1 provides `sets[]` with `id`, `version`, `name`, `figure`, `itemIds`, `appearance`, and `parts`. Each part carries `itemId`, `appearanceId`, `equipmentSlot`, `appearanceSlot`, `model`, `icon`, and `regions`. Additive fields: `starter` and `freeRegions` on the set (Plainhide only), `previewModel` (the `armor/` web fit for every female set, taken from the same registry function the client uses to pick the file for the 63-bone web body).

## Per-item appearance visibility

Each registered part now also carries `hideAppearance`, a list of `hair`, `beard`, and/or `eyebrows`. Missing or empty lists hide nothing. It is an additive field in catalog schema version 1 and is also exposed on `ItemShared`, `RUESTUNG`, and the generated website `appearance.json` under `equipmentSets`.

- Wildwarden crown: `hideAppearance: []` (all selected cosmetic attachments remain visible).
- Ashenveil hood and Ironward helmet: `hideAppearance: ['hair', 'beard', 'eyebrows']`.
- Gravethorn helm (both bodies): `hideAppearance: ['hair', 'beard', 'eyebrows']`.
- Plainhide (all five pieces, both bodies) and every other current item: `hideAppearance: []`.

`regions` and `hideAppearance` are independent: a crown can replace the Head mesh without hiding its separately selected hair, beard or eyebrows. Across mixed items, the union of hidden features wins. There is no "force show" override that could reveal hair through another equipped helmet.

The shared visibility resolver is used by the local avatar, remote player rendering, inventory preview and website preview. Call it with successfully loaded, currently selected item models only. Recompute after selection changes and load completion; keep cosmetic selection and color unchanged while hidden. A failed or stale load must not hide the body or attachments. Compatible male hairstyles remain available in all four views; the incompatible H_01 export stays blocked.

The website's class-to-set mapping now references stable set IDs; item paths and regions come from the generated catalog, not a second handwritten item list. Regenerate both `equipment-sets.json` and the website `appearance.json`, rebuild `tools/web/vorschau-web.ts` into `wov-web/static/assets/js/vorschau.js`, and build the website when changing registered policies.

No inventory or account migration is required: saved items resolve their current shared definitions by item ID. Do not persist or trust client-supplied visibility flags as gameplay authority. Character selection and login continue to carry item/appearance IDs; the registered definition supplies the policy. This update does not add or grant equipment at login.

Regression test: `client/test/appearance-visibility.ts` exercises all four real rendering paths, catalog/definition consistency, inventory save/load, mixed equipment, delayed/unloaded items, restoration and hair compatibility. It runs in the normal test suite without a GPU or player login.

- Resolve `model` relative to `/assets/models/` (it already ends in `.glb`).
- Resolve `icon` relative to `/assets/sprites/` (it already ends in `.png`).
- Use `appearance` as the slot-to-appearance-ID map for previews.
- Hide original body regions only after the corresponding replacement model loaded successfully; restore them on removal. Reuse the game's armor visibility and skeleton checks.
- Offer a set only for the figure it fits (`canWearArmor`); Ironward, Wildwarden and Ashenveil target the canonical male skeleton only.

Example selection (a handoff proposal, not an implemented account API):

```json
{ "figure": "wikinger", "equipmentSetId": "ashenveil" }
```

The login grant is implemented (see Starting equipment) and is trusted server-side: it resolves and validates the set, checks body compatibility, preserves the existing inventory, avoids duplicates on repeated logins and does not equip anything. Do not accept arbitrary client-supplied item lists as authority. The appearance handler rejects unowned armor; sending appearance IDs alone will not grant it.

## Verification

- `server/test/equipment-sets.ts`: all 73 items in 11 sets resolve, slots/masks match (Plainhide: five items, eight replaced regions, the free regions derived from them), ownership is enforced, appearance requests do not grant items, owned sets equip and unequip, a set of the other body is refused.
- `server/test/starter-sets.ts` and `starter-sets-e2e.ts`: Plainhide for nine classes and both figures, no class piece delivered, older markers win, atomic delivery, real login over HTTP and websocket with world save, restart and reconnect.
- Existing Ironward and Wildwarden server tests and the Ironward client test remain green.
- `tools/armor/test/skin-gate.mjs BODY ASHENVEIL_MODELS --family=ashenveil`: canonical 71-bone skin, full-set body masking/restoration, 53 primitives, 28 animation clips with four samples each.
- Shared/server/client/admin typechecks and client production build pass.
- `tools/armor/test/equipment-set-assets.mjs http://127.0.0.1/`: read-only delivery check for the catalog, all 21 model files and all 21 icons. Does not log in to a player account.

The asset manifest was regenerated on DEV and includes every armor model; Ironward and Wildwarden had previously been missing from that manifest despite existing on disk. Plainhide and Gravethorn add 24 game GLBs (`assets/models/<family>/`, five plus seven per body) and 24 icons, plus 12 web fits under `wov-web/static/assets/models/armor/<family>/`. A green skin gate is not a collision approval: the Plainhide skirt and the Gravethorn tassets still reach 5 to 6 cm into the body in the sword attack (male body measured; not measured for the female bodies), and the Plainhide fit on the 51-bone figure is an adaptation of the male design (tight leggings-like trousers, ragged region edges at neck, wrists and ankles), visibly rougher than the male fit.

The long robe still distorts in deep crouches and high kicks. These tests do not certify collision-free clothing or mixed-set motion. Source assets and visual tests remain in `/home/mike/wov-assets/PlayerCharacter/Armor/Ashenveil_v1/`.
