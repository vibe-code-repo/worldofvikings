/**
 * Eingabeverwerfung.ts (F6) — die reine Entscheidungsregel für Client-
 * Vorhersage-Reconciliation: "welche vorhergesagten Eingaben sind durch
 * die letzte vom Server bestätigte Sequenznummer bereits erledigt und
 * dürfen aus der Warteschlange fallen, welche müssen beim nächsten
 * Replay erneut angewendet werden?"
 *
 * SEIT DEM ABGLEICH PER EINGABESEQUENZ VERDRAHTET: Die Warteschlange
 * gibt es — client/src/net/Positionsverlauf.ts führt zu jeder gesendeten
 * Eingabe die Position mit, die der Client bei ihrem Absenden hatte, und
 * `verwirfAelterAls` räumt sie mit dieser Regel wieder ab.
 *
 * Was es weiterhin NICHT gibt, ist ein Replay: Der Client fährt Havok,
 * eine Eingabefolge lässt sich damit nicht deterministisch nachspielen.
 * Die Warteschlange dient deshalb nicht dem Wiederholen, sondern dem
 * MESSEN — sie beantwortet die Frage „wo stand ich, als der Server
 * das hier bestätigte?", und der so gemessene Versatz wird auf die
 * aktuelle Position angewandt. Der Kommentar in
 * player/PlayerController.ts ("so both sides agree without
 * reconciliation for now") beschreibt weiterhin die Bewegung selbst,
 * nicht diesen Abgleich.
 */

export interface EingabeMitSeq {
  readonly seq: number;
}

/**
 * Alle Einträge aus `ausstehend`, deren `seq` NEUER ist als die zuletzt
 * vom Server bestätigte (`bestaetigterSeq`) — diese sind noch nicht in
 * der Serverposition eingerechnet und beim Replay erneut anzuwenden.
 * Ein Eintrag mit `seq <= bestaetigterSeq` gilt als bestätigt und
 * verschwindet aus der Warteschlange.
 *
 * Reine Funktion, generisch über den Eingabetyp — kennt nur `seq`,
 * fasst weder Zeit noch Bewegung an.
 */
export function verwerfeBestaetigteEingaben<T extends EingabeMitSeq>(
  ausstehend: readonly T[],
  bestaetigterSeq: number
): T[] {
  return ausstehend.filter((e) => e.seq > bestaetigterSeq);
}
