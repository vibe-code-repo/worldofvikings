import { describe, expect, it } from 'vitest';
import { CURRENT_WORLD_SCHEMA_VERSION } from '@wov/world-schema';
import { serializeWorld } from './world-file.js';

describe('serializeWorld', () => {
  it('writes the fields in schema order, whatever order the editor sent', () => {
    const text = serializeWorld({
      zones: [
        {
          entities: [
            { scale: [1, 1, 1], position: [0, 0, 0], prefab: 'pine_tree_01', id: 'tree_001' },
          ],
          name: 'Village',
          id: 'village',
        },
      ],
      name: 'Example World',
      id: 'example',
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    });

    expect(text).toBe(
      `{
  "schemaVersion": ${String(CURRENT_WORLD_SCHEMA_VERSION)},
  "id": "example",
  "name": "Example World",
  "zones": [
    {
      "id": "village",
      "name": "Village",
      "entities": [
        {
          "id": "tree_001",
          "prefab": "pine_tree_01",
          "position": [0, 0, 0],
          "scale": [1, 1, 1]
        }
      ]
    }
  ]
}
`,
    );
  });

  it('omits optional fields that were not sent', () => {
    const text = serializeWorld({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'example',
      name: 'Example World',
      zones: [
        {
          id: 'village',
          name: 'Village',
          entities: [{ id: 'a', prefab: 'b', position: [0, 0, 0] }],
        },
      ],
    });

    expect(text).not.toContain('rotation');
    expect(text).not.toContain('scale');
    expect(text).not.toContain('terrain');
  });

  it('writes a zone terrain in schema order, after the entities', () => {
    const text = serializeWorld({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'example',
      name: 'Example World',
      zones: [
        {
          id: 'village',
          name: 'Village',
          entities: [],
          terrain: {
            splat: ['textures/village-splat-a.png'],
            layers: [{ tileSize: 2, texture: 'textures/terrain-grass-a.png' }],
            size: [300, 300],
            position: [0, 0, 0],
            heightField: 'terrain/village-257.glb',
          },
        },
      ],
    });

    expect(text).toContain(`      "terrain": {
        "heightField": "terrain/village-257.glb",
        "position": [0, 0, 0],
        "size": [300, 300],
        "layers": [
          {
            "texture": "textures/terrain-grass-a.png",
            "tileSize": 2
          }
        ],
        "splat": ["textures/village-splat-a.png"]
      }`);
  });

  it('writes the lighting profile a world carries, in schema order', () => {
    const text = serializeWorld({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'example',
      name: 'Example World',
      // Deliberately in the wrong order and with holes: the file must come back
      // canonical, and a profile the editor never touched must survive a save
      // instead of being silently dropped (ADR-0024).
      lighting: {
        postProcessing: { bloom: { weight: 0.4 }, enabled: true },
        sun: { intensity: 3.1, direction: [0.62, -0.36, 0.7] },
      },
      zones: [
        {
          id: 'village',
          name: 'Village',
          entities: [],
          lighting: { fog: { end: 60, enabled: true } },
        },
      ],
    });

    const written = JSON.parse(text) as {
      lighting: Record<string, unknown>;
      zones: { lighting: Record<string, unknown> }[];
    };
    // The profile survived the save at all — the failure this test was written
    // for was it being dropped, which loses a whole evening's look on one click.
    expect(Object.keys(written.lighting)).toEqual(['sun', 'postProcessing']);
    expect(Object.keys(written.lighting['sun'] as object)).toEqual(['direction', 'intensity']);
    expect(Object.keys(written.lighting['postProcessing'] as object)).toEqual(['enabled', 'bloom']);
    expect(written.zones[0]?.lighting).toEqual({ fog: { enabled: true, end: 60 } });
    // Nothing invented: a profile that says two things says two things.
    expect(text).not.toContain('"toneMapping"');
    expect(text).not.toContain('"shadows"');
  });
});
