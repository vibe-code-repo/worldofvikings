/**
 * Karte D1, Angriffsbefund M4: `SHORES.live` folgt der aktuellen Domain
 * statt einer festen `play.world-of-vikings.com` — sonst würde "innerhalb
 * einer Domain bleiben" verletzt, sobald Midgard für Konten öffnet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { liveBasisDomain, SHORES } from './account';

describe('liveBasisDomain', () => {
  it('bleibt auf .de für world-of-mmorpg.de und dessen www.', () => {
    expect(liveBasisDomain('world-of-mmorpg.de')).toBe('world-of-mmorpg.de');
    expect(liveBasisDomain('www.world-of-mmorpg.de')).toBe('world-of-mmorpg.de');
    expect(liveBasisDomain('WORLD-OF-MMORPG.DE')).toBe('world-of-mmorpg.de');
  });

  it('fällt sonst auf .com zurück (world-of-mmorpg.com, world-of-vikings.com, unbekannt, leer)', () => {
    expect(liveBasisDomain('world-of-mmorpg.com')).toBe('world-of-mmorpg.com');
    expect(liveBasisDomain('world-of-vikings.com')).toBe('world-of-mmorpg.com');
    expect(liveBasisDomain('evil.example')).toBe('world-of-mmorpg.com');
    expect(liveBasisDomain('')).toBe('world-of-mmorpg.com');
  });
});

describe('SHORES.live', () => {
  afterEach(() => {
    // @ts-expect-error -- Testaufbau: es gibt in der vitest-Umgebung
    // (environment: 'node') kein echtes window, wir täuschen nur den einen
    // gelesenen Pfad vor.
    delete globalThis.window;
  });

  it('ohne window (Vorrendern): origin/apiPrefix fallen auf .com zurück', () => {
    expect(SHORES.live.origin).toBe('https://play.world-of-mmorpg.com');
    expect(SHORES.live.apiPrefix).toBe(SHORES.live.origin);
    expect(SHORES.live.playPath).toBe('/');
  });

  it('mit window auf .de: origin zeigt auf play.world-of-mmorpg.de', () => {
    // @ts-expect-error -- Testaufbau, s. o.
    globalThis.window = { location: { hostname: 'world-of-mmorpg.de' } };
    expect(SHORES.live.origin).toBe('https://play.world-of-mmorpg.de');
    expect(SHORES.live.apiPrefix).toBe('https://play.world-of-mmorpg.de');
  });

  it('mit window auf .com: origin zeigt auf play.world-of-mmorpg.com', () => {
    // @ts-expect-error -- Testaufbau, s. o.
    globalThis.window = { location: { hostname: 'world-of-mmorpg.com' } };
    expect(SHORES.live.origin).toBe('https://play.world-of-mmorpg.com');
  });
});
