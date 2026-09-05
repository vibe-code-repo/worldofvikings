/**
 * Babylon.js side-effect imports the shared bootstrap guarantees.
 *
 * With the ES6 packages (`@babylonjs/core/...`) a feature only works once the
 * module that *registers* it has been imported. A missing import produces no
 * compiler error and no warning, and often not even a missing symbol: the
 * feature is simply inert. `Scene.pickWithRay` is declared in `scene.d.ts` and
 * exists as a function at runtime without `Culling/ray.js` — it throws when
 * called. So neither `tsc` nor a `typeof` check proves anything here.
 *
 * Rules for this file:
 *
 * 1. Only add an import that measurably changes behaviour. An import that
 *    merely *defines* exports belongs in the module using those exports — here
 *    it is pure bundle weight (see the note on mesh builders below).
 * 2. Every entry names the symptom it prevents, so nobody drops one to save
 *    bytes without knowing what breaks.
 * 3. Every entry has a case in `side-effects.test.ts` that *calls* the feature.
 *    A registration nobody exercises is a registration nobody can trust.
 *
 * This module is imported for its side effects only; it exports nothing.
 */

/**
 * `Scene.defaultMaterial`, and therefore every mesh created without an
 * explicit material.
 *
 * Symptom without it: `Scene.DefaultMaterialFactory` is still a function, but
 * reading `scene.defaultMaterial` throws "StandardMaterial needs to be
 * imported before as it contains a side-effect required by your code", and a
 * mesh without an explicit material never renders.
 */
import '@babylonjs/core/Materials/standardMaterial.js';

/**
 * Picking and ray casts: `Scene.pick`, `Scene.pickWithRay`,
 * `Scene.createPickingRay` and the multi-pick variants.
 *
 * Symptom without it: the methods exist and throw "Ray needs to be imported
 * before as it contains a side-effect required by your code". Needed by the
 * editor's selection and gizmos (spec §13) and by gameplay ground detection
 * and hit queries (spec §29).
 */
import '@babylonjs/core/Culling/ray.js';

/**
 * Deliberately NOT imported here: `@babylonjs/core/Meshes/meshBuilder.js`.
 *
 * It registers nothing. It only assembles the `MeshBuilder` object out of every
 * `Meshes/Builders/*` module. Code that wants `MeshBuilder.CreateBox` imports
 * `MeshBuilder` itself and gets a complete object whether or not this package
 * imported it first, so importing it here has no observable effect at all.
 *
 * What it does have is a price. Measured on the game bundle (Babylon 8.56.2,
 * `pnpm --filter @wov/game build`), adding it to this file drags in the whole
 * builder set — text, geodesic, goldberg, decal, polygon and the rest:
 *
 *     with:    1102.05 kB raw / 271.40 kB gzip
 *     without:  988.71 kB raw / 238.20 kB gzip
 *
 * 113 kB raw and 33 kB gzip for nothing, against a hard 60 FPS and payload
 * budget (spec §38, agent rule 13). Import the single builder you need
 * (`@babylonjs/core/Meshes/Builders/groundBuilder.js`) instead — which is what
 * `apps/game` and `apps/editor` do. See ADR-0006.
 */
