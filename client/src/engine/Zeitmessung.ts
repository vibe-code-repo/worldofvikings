/**
 * Feinmessung einzelner Abschnitte — Diagnosewerkzeug, kein Spielcode.
 *
 * WARUM ES DAS BRAUCHT: `main.ts` misst die Spielschleife bereits grob
 * nach Teilsystem (`spieler`, `terrain`, `gras`, `entities`). Damit steht
 * fest, dass `terrain` mit ~46 ms im schlechtesten Frame alles andere
 * dominiert — aber nicht, WOMIT. Die Vermutungen reichen von der
 * Rauschauswertung ueber den Gitterbau bis zum Havok-Shape-Cooking, und
 * sie fuehren zu voellig verschiedenen Loesungen: eine teure
 * Rauschfunktion behebt man algorithmisch, ein BVH-Cooking durch den
 * richtigen Shape-Typ, einen GPU-Upload gar nicht.
 *
 * VERSCHACHTELUNG: Die Abschnitte liegen ineinander — `getZone()` laeuft
 * innerhalb des Gitterbaus. Wuerde man beide naiv stoppen, zaehlte die
 * Rauschzeit doppelt und die Summe ergaebe mehr als der Frame dauert.
 * Deshalb fuehrt `misst()` einen Stapel und zieht die Zeit eines
 * Kindabschnitts von seinem Elternabschnitt ab. Jeder Posten weist damit
 * seine EIGENE Zeit aus, und die Summe bleibt ehrlich.
 *
 * KOSTEN: `performance.now()` ist nicht gratis. Gemessen wird deshalb nur
 * an wenigen groben Stellen und nur, solange `aktiv` gesetzt ist — im
 * Normalbetrieb ist der Aufruf ein Funktionssprung und ein Bool-Test.
 */

interface Posten {
  /** Eigenzeit in ms, ohne die der Kindabschnitte. */
  summe: number;
  /** Groesste Einzelmessung — der Ausreisser, um den es hier geht. */
  max: number;
  /** Zahl der Messungen. */
  n: number;
}

const posten: Record<string, Posten> = Object.create(null) as Record<string, Posten>;

/** Zeit, die Kindabschnitte des gerade laufenden Abschnitts verbraucht haben. */
const kindZeit: number[] = [];

/**
 * Standardmaessig AUS. Die Messung schaltet `__vb.feinmessung(true)` ein —
 * sie soll im Spielbetrieb nichts kosten.
 */
export let aktiv = false;

export function setzeAktiv(an: boolean): void {
  aktiv = an;
}

/** Einen Abschnitt messen. Bei ausgeschalteter Messung nur ein Aufruf. */
export function misst<T>(name: string, fn: () => T): T {
  if (!aktiv) return fn();
  const t0 = performance.now();
  kindZeit.push(0);
  let r: T;
  try {
    r = fn();
  } finally {
    const gesamt = performance.now() - t0;
    const kinder = kindZeit.pop() ?? 0;
    const eigen = gesamt - kinder;
    // Die eigene Gesamtzeit zaehlt beim Elternabschnitt als Kindzeit.
    if (kindZeit.length > 0) kindZeit[kindZeit.length - 1] += gesamt;
    let p = posten[name];
    if (!p) {
      p = { summe: 0, max: 0, n: 0 };
      posten[name] = p;
    }
    p.summe += eigen;
    p.n++;
    if (eigen > p.max) p.max = eigen;
  }
  return r;
}

/** Auslesen UND zuruecksetzen — wie `__vb.profil()` es fuer die Grobmessung tut. */
export function leseUndLeere(): Record<string, { summeMs: number; maxMs: number; n: number }> {
  const raus: Record<string, { summeMs: number; maxMs: number; n: number }> = {};
  for (const k of Object.keys(posten)) {
    const p = posten[k]!;
    raus[k] = { summeMs: +p.summe.toFixed(2), maxMs: +p.max.toFixed(2), n: p.n };
    p.summe = 0;
    p.max = 0;
    p.n = 0;
  }
  return raus;
}
