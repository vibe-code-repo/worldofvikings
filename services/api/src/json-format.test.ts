import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { formatJsonDocument } from './json-format.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const exampleWorldPath = join(repoRoot, 'content/worlds/example.json');

/**
 * What Prettier would leave of the given text, using the repository's own
 * configuration. `pnpm format:check` is the acceptance criterion for every file
 * the API writes, and it passes exactly when Prettier changes nothing.
 *
 * The check has to be "Prettier leaves our output alone", not "our output
 * equals Prettier's output for a one-line document": Prettier keeps an object
 * that was written expanded expanded, so both shapes are Prettier-clean and
 * only ours is stable.
 */
async function prettierWouldRewrite(text: string): Promise<string> {
  const options = await prettier.resolveConfig(exampleWorldPath);
  return prettier.format(text, { ...options, parser: 'json' });
}

const cases: Record<string, unknown> = {
  'a world-shaped document': {
    schemaVersion: 1,
    id: 'example',
    name: 'Example World',
    zones: [
      {
        id: 'village',
        name: 'Village',
        entities: [
          {
            id: 'tree_001',
            prefab: 'pine_tree_01',
            position: [24.3, 1.2, -56.4],
            rotation: [0, 2.1, 0],
            scale: [1.1, 1.1, 1.1],
          },
        ],
      },
    ],
  },
  'empty containers': { zones: [], meta: {}, nested: [[], {}] },
  'a short array of strings': { tags: ['forest', 'north', 'winter'] },
  'a long array of strings': {
    tags: [
      'a-fairly-long-tag-name',
      'another-fairly-long-tag-name',
      'a-third-fairly-long-tag-name',
      'a-fourth-fairly-long-tag-name',
    ],
  },
  'a long array of numbers': { heights: Array.from({ length: 60 }, (_, index) => index * 3) },
  'deeply indented numbers': {
    a: { b: { c: { d: { e: Array.from({ length: 40 }, (_, index) => index) } } } },
  },
  'strings that need escaping': { name: 'Björn\'s "hall"\n\t⚔' },
  'negative and fractional numbers': { position: [-0.5, 0, 1e-7] },
  'an array of objects': {
    entities: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 2, 3] },
    ],
  },
};

describe('formatJsonDocument', () => {
  it('ends with exactly one newline', () => {
    const text = formatJsonDocument({ id: 'example' });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  for (const [label, value] of Object.entries(cases)) {
    it(`formats ${label} so that Prettier changes nothing`, async () => {
      const formatted = formatJsonDocument(value);
      expect(await prettierWouldRewrite(formatted)).toBe(formatted);
    });
  }

  it('keeps a vector on one line and fills a long number array', () => {
    expect(formatJsonDocument({ position: [24.3, 1.2, -56.4] })).toBe(
      '{\n  "position": [24.3, 1.2, -56.4]\n}\n',
    );
    expect(formatJsonDocument({ heights: [1, 2, 3] }, 24)).toBe('{\n  "heights": [1, 2, 3]\n}\n');
    expect(formatJsonDocument({ heights: [111, 222, 333, 444] }, 20)).toBe(
      '{\n  "heights": [\n    111, 222, 333,\n    444\n  ]\n}\n',
    );
  });

  it('reproduces the committed example world byte for byte', async () => {
    const text = await readFile(exampleWorldPath, 'utf8');
    expect(formatJsonDocument(JSON.parse(text))).toBe(text);
  });

  it('refuses values JSON cannot represent instead of writing null', () => {
    expect(() => formatJsonDocument({ broken: undefined })).toThrow();
    expect(() => formatJsonDocument({ broken: Number.NaN })).toThrow();
  });
});
