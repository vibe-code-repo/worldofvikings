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
  "schemaVersion": 2,
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
});
