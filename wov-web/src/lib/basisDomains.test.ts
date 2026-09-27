/**
 * Karte D1: Basisdomains — bekannte Hosts, kanonische Heimat je Sprache,
 * hreflang/x-default und das Weiterleitungsziel für world-of-vikings.com.
 *
 * Jeder Fall hier war auf `origin/main` rot (die Datei gab es dort nicht /
 * `URSPRUNG` war eine feste Konstante ohne Sprachunterscheidung).
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_HOME,
  hreflangAdresse,
  istBekannterHost,
  kanonischeAdresse,
  MMORPG_COM,
  MMORPG_DE,
  sitemapAdresse,
  VIKINGS_COM_UEBERGANG,
  weiterleitungsZielVikings,
  X_DEFAULT_URSPRUNG,
  xDefaultAdresse,
} from './basisDomains';

describe('istBekannterHost', () => {
  it('erkennt beide Hauptdomains, die Übergangsdomain und ihr www.', () => {
    for (const domain of [MMORPG_COM, MMORPG_DE, VIKINGS_COM_UEBERGANG]) {
      expect(istBekannterHost(domain)).toBe(true);
      expect(istBekannterHost(`www.${domain}`)).toBe(true);
      expect(istBekannterHost(domain.toUpperCase())).toBe(true);
    }
  });

  it('erkennt localhost für vite dev/preview', () => {
    expect(istBekannterHost('localhost')).toBe(true);
    expect(istBekannterHost('127.0.0.1')).toBe(true);
  });

  it('lehnt einen fremden Host ab', () => {
    expect(istBekannterHost('evil.example')).toBe(false);
    expect(istBekannterHost('world-of-mmorpg.com.evil.example')).toBe(false);
    expect(istBekannterHost('play.world-of-mmorpg.com')).toBe(false);
  });
});

describe('canonical, hreflang, x-default', () => {
  it('kanonische Adresse: /de auf .de, /en auf .com', () => {
    expect(kanonischeAdresse('de', '/de/saga')).toBe('https://world-of-mmorpg.de/de/saga');
    expect(kanonischeAdresse('en', '/en/saga')).toBe('https://world-of-mmorpg.com/en/saga');
  });

  it('hreflang zeigt jede Fassung auf ihre EIGENE Heimat-Domain', () => {
    const de = hreflangAdresse('de', '/saga');
    const en = hreflangAdresse('en', '/saga');
    expect(de.startsWith(CANONICAL_HOME.de)).toBe(true);
    expect(en.startsWith(CANONICAL_HOME.en)).toBe(true);
    expect(de).not.toBe(en);
  });

  it('x-default zeigt immer auf world-of-mmorpg.com, nicht auf DEFAULT_LOCALE (de)', () => {
    expect(X_DEFAULT_URSPRUNG).toBe('https://world-of-mmorpg.com');
    expect(xDefaultAdresse('/saga').startsWith('https://world-of-mmorpg.com')).toBe(true);
  });
});

describe('sitemapAdresse', () => {
  it('de und en landen auf verschiedenen Domains', () => {
    const de = sitemapAdresse('de', '/saga');
    const en = sitemapAdresse('en', '/saga');
    expect(de.startsWith('https://world-of-mmorpg.de')).toBe(true);
    expect(en.startsWith('https://world-of-mmorpg.com')).toBe(true);
  });
});

describe('weiterleitungsZielVikings', () => {
  it('/de/… geht auf world-of-mmorpg.de, Pfad und Query bleiben', () => {
    expect(weiterleitungsZielVikings('/de/saga', '?x=1')).toBe(
      'https://world-of-mmorpg.de/de/saga?x=1',
    );
  });

  it('/en/… geht auf world-of-mmorpg.com', () => {
    expect(weiterleitungsZielVikings('/en/login')).toBe('https://world-of-mmorpg.com/en/login');
  });

  it('alles andere geht auf world-of-mmorpg.com', () => {
    expect(weiterleitungsZielVikings('/robots.txt')).toBe('https://world-of-mmorpg.com/robots.txt');
    expect(weiterleitungsZielVikings('/')).toBe('https://world-of-mmorpg.com/');
  });

  it('eine Suche ohne führendes ? bekommt eins', () => {
    expect(weiterleitungsZielVikings('/de', 'a=1')).toBe('https://world-of-mmorpg.de/de?a=1');
  });
});
