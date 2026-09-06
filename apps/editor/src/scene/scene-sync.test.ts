import { describe, expect, it } from 'vitest';
import { textureFileName } from './scene-sync.js';

describe('textureFileName', () => {
  it('names the file a store texture came from', () => {
    expect(
      textureFileName('http://localhost:9000/store/environment/textures/atlas-2a217835.png'),
    ).toBe('atlas-2a217835.png');
  });

  it('drops a cache-busting query', () => {
    expect(textureFileName('http://host/textures/atlas.png?v=3')).toBe('atlas.png');
  });

  it('sees through the `data:` prefix Babylon puts on a glTF texture URL', () => {
    // Not a data URI: this is what a texture loaded out of a GLB reports.
    expect(
      textureFileName('data:http://localhost:9000/store/vegetation/textures/leaves-46087926.png'),
    ).toBe('leaves-46087926.png');
  });

  it('ignores textures with no file behind them', () => {
    expect(textureFileName('data:image/png;base64,iVBORw0KGgo=')).toBeUndefined();
    expect(textureFileName('data:EnvironmentBRDFTexture0')).toBeUndefined();
    expect(textureFileName('atlas-a_Mat_01_A (Base Color)')).toBeUndefined();
  });

  it('ignores a trailing slash rather than reporting an empty name', () => {
    expect(textureFileName('http://host/textures/')).toBeUndefined();
  });
});
