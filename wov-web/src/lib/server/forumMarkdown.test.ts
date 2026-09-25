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

  // Gefaehrliche Schemata duerfen weder als href noch als src im Ergebnis
  // stehen; geprueft wird das Attribut selbst, nicht ein bestimmtes Schema, damit
  // auch eine geschwaechte Pruefung (nur `javascript:` in Kleinschreibung)
  // auffaellt.
  it.each([
    ['[x](javascript:alert(1))'],
    ['[x](JAVASCRIPT:alert(1))'],
    ['[x](  javascript:alert(1))'],
    ['[x](data:text/html,<script>alert(1)</script>)'],
    ['[x](vbscript:msgbox(1))'],
    ['![b](javascript:alert(1))'],
  ])('setzt aus %s kein href/src', (text) => {
    expect(renderMarkdown(text)).not.toMatch(/(?:href|src)=/i);
  });

  it('leerer Text ergibt leeres HTML', () => {
    expect(renderMarkdown('   ')).toBe('');
  });
});
