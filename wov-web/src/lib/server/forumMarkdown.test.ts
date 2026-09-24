import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './forumMarkdown';

describe('renderMarkdown', () => {
  it('reicht kein rohes HTML durch', () => {
    const html = renderMarkdown('vorher <script>alert(1)</script> nachher');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('maskiert eingebettete Bilder mit Ereignis-Attribut', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('setzt sichere Attribute an Links und Bildern', () => {
    expect(renderMarkdown('[a](https://example.org)')).toContain('rel="nofollow ugc noopener"');
    const bild = renderMarkdown('![b](https://example.org/b.png)');
    expect(bild).toContain('loading="lazy"');
    expect(bild).toContain('referrerpolicy="no-referrer"');
  });

  it('lehnt javascript:-Verweise ab', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript:');
  });

  it('leerer Text ergibt leeres HTML', () => {
    expect(renderMarkdown('   ')).toBe('');
  });
});
