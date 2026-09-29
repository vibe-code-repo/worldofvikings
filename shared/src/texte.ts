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

/** Repo-Katalog only: the text, or `undefined` if the key is in neither language of the catalog. */
export function repoText(schluessel: string, sprache: string | undefined): string | undefined {
  const katalog: Record<string, string> = Object.hasOwn(KATALOGE, sprache ?? '')
    ? (KATALOGE as Record<InhaltSprache, Record<string, string>>)[sprache as InhaltSprache]
    : de;
  if (Object.hasOwn(katalog, schluessel)) return katalog[schluessel];
  if (Object.hasOwn(de, schluessel)) return (de as Record<string, string>)[schluessel];
  return undefined;
}

/**
 * Zweite Schicht hinter dem Repo-Katalog: die Texte der Datengegenstaende
 * (shared/src/items/gegenstandsDaten.ts). Je Sprache eine Map (kein Objekt, damit
 * kein Schluessel ein Prototypname sein kann). Sie wird mit dem Datenstand als
 * Ganzes ersetzt (`ersetzeDatenTexte`), nie einzeln gefuellt.
 */
type DatenTexte = { readonly de: ReadonlyMap<string, string>; readonly en: ReadonlyMap<string, string> };
let datenTexte: DatenTexte = { de: new Map(), en: new Map() };

/** Replaces the whole data-text layer at once. */
export function ersetzeDatenTexte(neu: { de: ReadonlyMap<string, string>; en: ReadonlyMap<string, string> }): void {
  datenTexte = { de: new Map(neu.de), en: new Map(neu.en) };
}

/**
 * Text zu einem Inhaltsschluessel. Der Sprachparameter ist bewusst `string`
 * (nicht `InhaltSprache`): Aufrufer aus Server, Webseite oder gespeicherten
 * Werten haben die Sprache oft nur als ungeprueften String vorliegen, und
 * genau dafuer ist der Rueckfall gedacht.
 *
 * Fehlt der Schluessel in der gewuenschten Sprache, faellt die Funktion auf
 * Deutsch zurueck, und fehlt er auch dort, auf den Schluessel selbst (nie
 * ein leerer Text im Spiel). Eine unbekannte oder fehlende Sprache faellt
 * ebenso auf Deutsch zurueck, ohne zu werfen.
 *
 * Der Zugriff laeuft durchgehend ueber `Object.hasOwn`, nicht `in` oder
 * `??` auf dem Objekt selbst: Ein Schluessel wie `constructor`,
 * `__proto__`, `toString`, `hasOwnProperty` oder `valueOf` waere sonst ein
 * Treffer auf `Object.prototype` statt auf den Katalog (liefert eine
 * Funktion bzw. `[object Object]` statt Text).
 */
export function inhaltText(schluessel: string, sprache: string | undefined): string {
  // Repo catalog wins, whatever the language of the hit.
  const repo = repoText(schluessel, sprache);
  if (repo !== undefined) return repo;
  const ebene = sprache === 'en' ? datenTexte.en : datenTexte.de;
  return ebene.get(schluessel) ?? datenTexte.de.get(schluessel) ?? schluessel;
}
