# tooling/fixtures

World data used by tests, kept out of `content/` on purpose: `content/` is
authored game data that ships, and a fixture is neither authored nor shipped.

| File                          | What it is for                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds/village-terrain.json` | The village tile as a world file: the terrain of ADR-0020 with the layer order and splat maps the game's probe uses. `terrain-fixture.test.ts` validates it against `@wov/world-schema` and checks every asset it names against `assets/manifest.json`. |

A fixture that no test reads is a file nobody maintains — add the test with the
fixture, in the same commit.
