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
  X_DEFAULT_ADRESSE,
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

  it('x-default ist auf JEDER Seite dieselbe eine Adresse: die Startseite auf world-of-mmorpg.com', () => {
    // Angriffsbefund M2 (Opus-Prüfung c2c2765): x-default ist Mikes
    // ausdrückliche Vorgabe, exakt DIESE eine Adresse — nicht
    // `startsWith('https://world-of-mmorpg.com')`, was auch eine
    // je-Seite lokalisierte Fassung (`.com/de/saga`) hätte durchgelassen.
    expect(X_DEFAULT_ADRESSE).toBe('https://world-of-mmorpg.com/');
  });
});

describe('sitemapAdresse', () => {
  it('de und en landen auf verschiedenen Domains', () => {
    expect(sitemapAdresse('de', '/saga')).toBe('https://world-of-mmorpg.de/de/saga');
    expect(sitemapAdresse('en', '/saga')).toBe('https://world-of-mmorpg.com/en/saga');
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
