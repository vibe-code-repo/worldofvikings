/**
 * F6: seq-Verwerfungsregel für Client-Vorhersage-Reconciliation — reine
 * Funktion aus client/src/net/Eingabeverwerfung.ts, DOM-frei. Ruft
 * dieselbe Funktion, die für eine künftige Vorhersage-Warteschlange
 * gedacht ist (s. Kopfkommentar der Produktivdatei für den Stand der
 * Verdrahtung — heute keine).
 */
import { verwerfeBestaetigteEingaben, type EingabeMitSeq } from '../src/net/Eingabeverwerfung';

function fordere(an: boolean, text: string): void {
  if (!an) throw new Error(text);
}

console.log('[1] bestätigte Einträge fallen raus, neuere bleiben');
{
  const ausstehend: EingabeMitSeq[] = [{ seq: 5 }, { seq: 6 }, { seq: 7 }, { seq: 8 }];
  const rest = verwerfeBestaetigteEingaben(ausstehend, 6);
  fordere(rest.length === 2, `2 verbleibende erwartet, erhalten ${rest.length}`);
  fordere(rest[0]!.seq === 7 && rest[1]!.seq === 8, `seq 7 und 8 erwartet, erhalten ${JSON.stringify(rest)}`);
}

console.log('[2] Grenzwert: seq === bestaetigterSeq gilt als bestätigt, fliegt raus');
{
  const rest = verwerfeBestaetigteEingaben([{ seq: 10 }], 10);
  fordere(rest.length === 0, `leere Liste erwartet, erhalten ${JSON.stringify(rest)}`);
}

console.log('[3] bestaetigterSeq = -1 (noch nichts bestätigt) lässt alles stehen');
{
  const ausstehend: EingabeMitSeq[] = [{ seq: 0 }, { seq: 1 }, { seq: 2 }];
  const rest = verwerfeBestaetigteEingaben(ausstehend, -1);
  fordere(rest.length === 3, `alle 3 erwartet, erhalten ${rest.length}`);
}

console.log('[4] leere Warteschlange bleibt leer');
{
  const rest = verwerfeBestaetigteEingaben([], 42);
  fordere(rest.length === 0, `leere Liste erwartet, erhalten ${JSON.stringify(rest)}`);
}

console.log('[5] Reihenfolge bleibt erhalten (kein Sortieren, nur Filtern)');
{
  const ausstehend: EingabeMitSeq[] = [{ seq: 9 }, { seq: 3 }, { seq: 11 }];
  const rest = verwerfeBestaetigteEingaben(ausstehend, 5);
  fordere(rest.length === 2 && rest[0]!.seq === 9 && rest[1]!.seq === 11,
    `[9, 11] in Originalreihenfolge erwartet, erhalten ${JSON.stringify(rest)}`);
}

console.log('[6] beliebiger Eingabetyp — nur `seq` zählt (generisch, s. Signatur)');
{
  interface Eingabe extends EingabeMitSeq {
    moveX: number;
  }
  const ausstehend: Eingabe[] = [
    { seq: 1, moveX: 0.5 },
    { seq: 2, moveX: -1 },
  ];
  const rest = verwerfeBestaetigteEingaben(ausstehend, 1);
  fordere(rest.length === 1 && rest[0]!.moveX === -1, `Feld moveX bleibt erhalten, erhalten ${JSON.stringify(rest)}`);
}

console.log('\nAlle F6-Verwerfungsregel-Tests grün.');
