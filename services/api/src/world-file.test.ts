import { describe, expect, it } from 'vitest';
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
      schemaVersion: 1,
    });

    expect(text).toBe(
      `{
  "schemaVersion": 1,
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
      schemaVersion: 1,
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
  });
});
