import de from '../data/texte/de.json';
import en from '../data/texte/en.json';

/**
 * Inhaltstexte, Namensraum `inhalt.*` (Items, NPCs, Ruestungssets). Client,
 * Server und die Webseite (ueber `@wov/shared`) lesen dieselben zwei
 * Dateien, damit ein Item-Name nicht an zwei Orten gepflegt wird.
 *
 * Befuellt wird der Katalog erst durch spaetere Karten (Game/Set-DEV); hier
 * steht nur ein Beispieleintrag, damit Ladepfad und Test bereits stehen.
 */
const KATALOGE = { de, en } as const;

export type InhaltSprache = keyof typeof KATALOGE;
export type InhaltSchluessel = keyof typeof de;

/**
 * Text zu einem Inhaltsschluessel. Fehlt er in der gewuenschten Sprache,
 * faellt die Funktion auf Deutsch zurueck, und fehlt er auch dort, auf den
 * Schluessel selbst (nie ein leerer Text im Spiel).
 */
export function inhaltText(schluessel: string, sprache: InhaltSprache): string {
  const katalog = KATALOGE[sprache] as Record<string, string>;
  const basis = de as Record<string, string>;
  return katalog[schluessel] ?? basis[schluessel] ?? schluessel;
}
