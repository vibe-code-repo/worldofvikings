/**
 * uploadedModelGroessenvorschlag.ts — Vorschlag für die Zielgröße beim
 * Hochladen eines Modells (Karte „Editor Upload-Größe", Auftrag Punkt 4).
 *
 * DOM-frei mit Absicht: Der Editor (`GegenstandsKatalog.ts`) ruft das hier
 * nur auf und schreibt das Ergebnis in ein Feld — die eigentliche Logik
 * (Reihenfolge, Namensvergleich, Schwellen) steht so an EINER Stelle und
 * lässt sich ohne Browser/Babylon testen (s. `shared/test/
 * upload-grundskala-vorschlag.ts`).
 *
 * Reihenfolge, wie im Auftrag verlangt:
 *   (a) ein ähnliches VORHANDENES hochgeladenes Modell über den Namen —
 *       z. B. „Marktstand2" → `U_Marktstand` (4,0 m);
 *   (b) sonst die Größentabelle (`uploadedModelGroessentabelle.ts`);
 *   (c) sonst die Rohgröße der gerade gewählten Datei.
 *
 * Die Ähnlichkeit ist ein NORMALISIERTER Namenskern ohne Zahl am Ende:
 * „Marktstand2", „Marktstand1" und „U_Marktstand" liefern alle den Kern
 * „marktstand". Gibt es unter den Treffern einen OHNE Zahl am Ende
 * („U_Marktstand"), gewinnt der — er ist das kanonische Vorbild, nicht
 * eine seiner nummerierten Varianten.
 */
import { grundskalaVon, schreibeUmlauteAus, type UploadedModelEntry } from './uploadedModelRegistry.js';
import { kategorieFuerName } from './uploadedModelGroessentabelle.js';

export type Zieldimension = 'breite' | 'hoehe';

export type Vorschlagsquelle = 'aehnliches-modell' | 'kategorie' | 'rohgroesse';

export interface Groessenvorschlag {
  readonly meter: number;
  readonly quelle: Vorschlagsquelle;
  /** Ganzer Satz für die Anzeige neben dem Feld — kein Statuscode, kein Kürzel. */
  readonly begruendung: string;
}

/**
 * `U_`-Präfix weg, Umlaute ausgeschrieben, Kleinschreibung, nur `[a-z0-9]` —
 * der Vergleichskern eines Namens.
 *
 * N3 (Angriff „Editor Upload-Größe"): Ohne `schreibeUmlauteAus` (dieselbe
 * Funktion wie in `uploadedModelRegistry.erzwingeName`, die den TATSÄCHLICH
 * gespeicherten Registry-Namen bestimmt) traf „Käsestand2" nicht auf ein
 * schon registriertes „Kaesestand2" — die Registry schreibt Umlaute beim
 * Speichern aus, dieser Vergleich hier tat es vorher nicht.
 */
function normKern(s: string): string {
  return schreibeUmlauteAus(s.replace(/^u_/i, '').toLowerCase()).replace(/[^a-z0-9]/g, '');
}

/** Denselben Kern ohne eine Zahl am Ende — „marktstand2" → „marktstand". */
function ohneEndZahl(kern: string): string {
  return kern.replace(/[0-9]+$/, '');
}

function kandidatKern(m: Pick<UploadedModelEntry, 'anzeigename' | 'name'>): string {
  return normKern(m.anzeigename || m.name);
}

/**
 * Zielgröße vorschlagen — reine Funktion, wirft nie.
 *
 * @param anzeigename der vom Nutzer eingegebene (oder schon vergebene) Name
 * @param dimension welche Kante die Maske gerade einstellt
 * @param rohMasse die am Modell GEMESSENE Hüllbox (vor jeder Grundskala)
 * @param kandidaten alle schon registrierten Uploads (für den Namensvergleich)
 * @param ausschlussName beim „nachträglich ändern": der eigene Name, damit
 *   ein Modell sich nicht selbst als Vorbild vorschlägt
 */
export function schlageZielgroesseVor(
  anzeigename: string,
  dimension: Zieldimension,
  rohMasse: { readonly breite: number; readonly hoehe: number },
  kandidaten: readonly UploadedModelEntry[],
  ausschlussName?: string
): Groessenvorschlag {
  const zielKern = ohneEndZahl(normKern(anzeigename));
  if (zielKern.length > 0) {
    const treffer = kandidaten.filter(
      (k) => k.name !== ausschlussName && ohneEndZahl(kandidatKern(k)) === zielKern
    );
    if (treffer.length > 0) {
      // Kandidat OHNE Zahl am Ende zuerst (das kanonische Vorbild), sonst
      // der erste Treffer in Registrierreihenfolge — deterministisch.
      const sauber = treffer.filter((k) => kandidatKern(k) === zielKern);
      const gewaehlt = (sauber.length > 0 ? sauber : treffer)[0]!;
      const g = grundskalaVon(gewaehlt);
      const meter = dimension === 'breite' ? gewaehlt.breite * g : gewaehlt.hoehe * g;
      return {
        meter,
        quelle: 'aehnliches-modell',
        begruendung: `wie vorhandenem Modell '${gewaehlt.anzeigename}' (${meter.toFixed(2)} m)`,
      };
    }
  }

  const kategorie = kategorieFuerName(anzeigename);
  if (kategorie) {
    return {
      meter: kategorie.meter,
      quelle: 'kategorie',
      begruendung: `Kategorie „${kategorie.kategorie}" (${kategorie.meter.toFixed(2)} m)`,
    };
  }

  const meter = dimension === 'breite' ? rohMasse.breite : rohMasse.hoehe;
  return { meter, quelle: 'rohgroesse', begruendung: `Rohgröße der Datei (${meter.toFixed(2)} m)` };
}

/**
 * Ab dieser Rohgröße (in jeder Kante) ist ein cm-Export wahrscheinlicher
 * als ein tatsächlich so großes Objekt — Warnung, kein stilles Umrechnen
 * (Auftrag Punkt 4, Plausibilität). Das Angebot lautet ×0,01.
 */
export const CM_VERDACHT_SCHWELLE_M = 50;

/** Ob die Rohgröße den cm-Verdacht auslöst — größte Kante über der Schwelle. */
export function cmVerdacht(rohMasse: {
  readonly breite: number;
  readonly hoehe: number;
  readonly tiefe: number;
}): boolean {
  return Math.max(rohMasse.breite, rohMasse.hoehe, rohMasse.tiefe) > CM_VERDACHT_SCHWELLE_M;
}
