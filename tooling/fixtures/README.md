# tooling/fixtures

World data used by tests, kept out of `content/` on purpose: `content/` is
authored game data that ships, and a fixture is neither authored nor shipped.

| File                          | What it is for                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds/village-terrain.json` | The village tile as a world file: the terrain of ADR-0020 with the layer order and splat maps the game's probe uses. `terrain-fixture.test.ts` validates it against `@wov/world-schema` and checks every asset it names against `assets/manifest.json`.                                                                                                                                           |
| `scenes/village-fixture.glb`  | The smallest thing that is still a scene bundle: a zone root, two nodes named after `base.json`'s one prefab, and a triangle. 752 bytes. It is what lets the scene import be tested without the 150 MB private export — `services/api/src/actions.test.ts` and the editor-parity smoke test both run the real import against it. Regenerate with `npx tsx tooling/fixtures/make-scene-bundle.ts`. |

A fixture that no test reads is a file nobody maintains — add the test with the
fixture, in the same commit.
