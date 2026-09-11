/**
 * Was ein Koerper tut, wenn eine Wand im Weg steht.
 * What a body does when a wall is in the way.
 *
 * DIE REGEL. Eine Bewegung, die auf eine Flaeche trifft, wird nicht
 * weggeworfen, sondern auf deren Ebene FALLEN GELASSEN: Der Anteil IN die
 * Flaeche hinein faellt weg, der Anteil ENTLANG bleibt, und der verkuerzte
 * Weg wird erneut abgefragt. Wer gegen eine Huettenwand laeuft, behaelt
 * damit den Teil seines Laufs, der an der Huette entlangfuehrt — das ist
 * der Unterschied zwischen „an der Wand entlanggehen" und „an ihr kleben".
 *
 * WARUM ZWEI UMLENKUNGEN UND NICHT MEHR. Jeder Versuch kostet eine
 * Hindernisabfrage, und eine Abfrage sind sechs Strahlen. Zwei
 * Umlenkungen decken ab, was ein Dorf an Formen hat — eine Wand, und eine
 * Wand, die man beim Entlanggleiten trifft. Der dritte Fall ist eine
 * Ecke, und dort ist Anhalten die ehrliche Antwort.
 *
 * WARUM EINE ECKE STOPPT, STATT SICH FUER EINE SEITE ZU ENTSCHEIDEN. Zwei
 * Flaechen, deren freie Richtungen einander widersprechen, lassen in der
 * Waagerechten nichts uebrig, woran man entlanggehen koennte. Sich
 * trotzdem fuer eine zu entscheiden ist der Weg, auf dem ein Koerper IN
 * der anderen Wand landet. Rueckwaerts wieder heraus geht immer, weil eine
 * Flaeche nur eine Bewegung blockiert, die sich ihr NAEHERT
 * (`HindernisAbfrage.ersterTreffer`).
 *
 * Rein: kein Babylon, kein `node:`, keine Uhr, keine Trigonometrie.
 */
import type { Vek3 } from '../kollision/form.js';
import type { BodenAbfrage, HindernisAbfrage } from './abfragen.js';

/**
 * Wie oft eine blockierte Bewegung auf eine Flaeche fallen darf, bevor sie
 * aufgegeben wird. Hoechstens drei Abfragen also: der Weg wie gewuenscht,
 * und einer nach jeder Umlenkung.
 */
export const MAX_GLEIT_VERSUCHE = 2;

/**
 * Der kuerzeste Weg, den erneut abzufragen sich noch lohnt, in m.
 *
 * Was nach einer Umlenkung weniger uebrig laesst, war eine Bewegung
 * frontal in die Wand: entlang der Flaeche bleibt nichts zu gehen. Ein
 * Mikrometer ist zugleich die Aufloesung, unterhalb derer „naehert sich
 * der Flaeche" in einfach genauer Kollisionsgeometrie nichts mehr heisst.
 */
const MIN_GLEIT_METER = 1e-6;

/** Waagerechte Laenge — `Math.hypot` ist hier bewusst nicht erlaubt. */
function laenge2d(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** Eine waagerechte Bewegung, die zu loesen ist. */
export interface GleitAuftrag {
  /** Wo der Koerper jetzt steht — an den Fuessen, wie die Position. */
  readonly von: Vek3;
  /** Wohin er moechte, wenn nichts im Weg staende. */
  readonly nachX: number;
  readonly nachZ: number;
  /** Halbe Breite des Koerpers in m. */
  readonly radius: number;
  /** Liefert die Hoehe, auf die jeder Suchweg zielt — so folgt er dem Hang. */
  readonly boden: BodenAbfrage;
  readonly hindernis: HindernisAbfrage;
}

/** Wo die Bewegung geendet hat und was sie unterwegs getroffen hat. */
export interface GleitErgebnis {
  readonly x: number;
  readonly z: number;
  /**
   * Die getroffenen Flaechen in der Reihenfolge, in der sie getroffen
   * wurden — leer bei freier Bahn. Herausgegeben statt verschluckt: Der
   * Aufrufer nimmt das Tempo, mit dem in eine Wand gedrueckt wurde, von
   * der Geschwindigkeit ab.
   */
  readonly normalen: readonly Vek3[];
  /** Wahr, wenn nichts von der Bewegung uebrig blieb. */
  readonly blockiert: boolean;
}

/**
 * Die Flaeche, wie die Waagerechte sie sieht: ein Einheitsvektor in x/z,
 * oder `null` fuer eine Flaeche, in die eine waagerechte Bewegung gar
 * nicht hineinlaufen kann (Boden oder Decke).
 *
 * Herausgegeben, seit der Gelaendehang dieselbe Umlenkung braucht
 * (`gelaendeHang.ts`): Ein zu steiler Hang wird von derselben Regel
 * behandelt wie eine Wand, und zwei Kopien einer Regel sind zwei Regeln.
 */
export function waagerechteFlaeche(normale: Vek3): Vek3 | null {
  const laenge = laenge2d(normale.x, normale.z);
  return laenge === 0 ? null : { x: normale.x / laenge, y: 0, z: normale.z / laenge };
}

/**
 * Der Teil von `(x, z)`, der ENTLANG `flaeche` laeuft — oder `null`, wenn
 * keiner das tut (Bewegung verlaesst die Flaeche schon, oder sie traf
 * frontal auf). Herausgegeben aus demselben Grund wie
 * `waagerechteFlaeche`.
 */
export function entlangFlaeche(x: number, z: number, flaeche: Vek3): { x: number; z: number } | null {
  const hinein = x * flaeche.x + z * flaeche.z;
  if (hinein >= 0) return null;
  const gx = x - hinein * flaeche.x;
  const gz = z - hinein * flaeche.z;
  return laenge2d(gx, gz) < MIN_GLEIT_METER ? null : { x: gx, z: gz };
}

/** Ob `(x, z)` in eine Flaeche zurueckdrueckt, die diese Bewegung schon stoppte. */
function druecktHinein(x: number, z: number, flaechen: readonly Vek3[]): boolean {
  for (const f of flaechen) {
    if (x * f.x + z * f.z < -MIN_GLEIT_METER) return true;
  }
  return false;
}

/**
 * Loest eine waagerechte Bewegung gegen die Hindernisse neben dem Koerper.
 *
 * Die zurueckgegebene Stelle ist immer eine, die die Hindernisabfrage
 * angenommen hat, oder die, an der der Koerper losging. Sie meldet nie
 * einen Ort, den die Abfrage abgelehnt hat — das ist es, was den Koerper
 * aus der Wand haelt, in die er gelaufen ist.
 */
export function gleitBewegung(auftrag: GleitAuftrag): GleitErgebnis {
  const { von, radius, boden, hindernis } = auftrag;
  let wegX = auftrag.nachX - von.x;
  let wegZ = auftrag.nachZ - von.z;
  const normalen: Vek3[] = [];

  for (let versuch = 0; ; versuch += 1) {
    // Nullbewegung kostet keine Abfrage — sechs Strahlen fuer „steht still"
    // waeren bei 25 Spielern und 60 Schritten je Sekunde reine Last.
    if (wegX === 0 && wegZ === 0) {
      return { x: von.x, z: von.z, normalen, blockiert: false };
    }

    const x = von.x + wegX;
    const z = von.z + wegZ;
    const treffer = hindernis.ersterTreffer(
      von,
      { x, y: boden.hoeheBei(x, z, von.y) ?? von.y, z },
      radius
    );
    if (treffer === null) {
      return { x, z, normalen, blockiert: false };
    }

    // Jede getroffene Flaeche wird gemeldet, auch die, an der aufgegeben
    // wird: Der Aufrufer braucht die letzte, um nicht weiter hineinzudruecken.
    const bisher = normalen.length;
    const flaeche = waagerechteFlaeche(treffer.normale);
    normalen.push(flaeche ?? treffer.normale);
    if (versuch >= MAX_GLEIT_VERSUCHE || flaeche === null) break;

    const entlang = entlangFlaeche(wegX, wegZ, flaeche);
    // Eine Umlenkung, die in eine schon getroffene Flaeche laeuft, ist eine
    // Ecke. Dann gibt es keine waagerechte Richtung mehr, und die Bewegung
    // wird aufgegeben statt in eine ihrer beiden Waende aufgeloest.
    if (entlang === null || druecktHinein(entlang.x, entlang.z, normalen.slice(0, bisher))) break;
    wegX = entlang.x;
    wegZ = entlang.z;
  }

  return { x: von.x, z: von.z, normalen, blockiert: true };
}
