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

  /**
   * The key list orders fields; it does not decide which ones exist.
   *
   * It used to do both, and that made forgetting a name a silent way to lose
   * world data: `postProcessing.saturation` (ADR-0040) and the fog's `mode` and
   * `density` (ADR-0041) all validated, reached the editor, could be authored —
   * and vanished on the next save, with nothing failing anywhere. A field the
   * schema accepts now survives a round trip whether or not anybody remembered
   * to name it here.
   */
  it('keeps a lighting field the key list never heard of', () => {
    const text = serializeWorld({
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: 'example',
      name: 'Example World',
      lighting: {
        fog: { color: '#a3afbd', density: 0.0005, mode: 'exp', enabled: true },
        sky: { groundReflection: 0.6, enabled: true },
        postProcessing: { saturation: 0.68, enabled: true },
      },
      zones: [{ id: 'village', name: 'Village', entities: [] }],
    });

    const written = JSON.parse(text) as { lighting: Record<string, Record<string, unknown>> };
    expect(written.lighting['fog']).toEqual({
      enabled: true,
      mode: 'exp',
      density: 0.0005,
      color: '#a3afbd',
    });
    // Named in the list, so they come back in the schema's order and not the
    // caller's — which is what the canonical form is for.
    expect(Object.keys(written.lighting['fog'] ?? {})).toEqual([
      'enabled',
      'mode',
      'density',
      'color',
    ]);
    expect(written.lighting['sky']?.['groundReflection']).toBe(0.6);
    expect(written.lighting['postProcessing']?.['saturation']).toBe(0.68);
  });
});
