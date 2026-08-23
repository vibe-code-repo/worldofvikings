/**
 * Eingabeverwerfung.ts (F6) — die reine Entscheidungsregel für Client-
 * Vorhersage-Reconciliation: "welche vorhergesagten Eingaben sind durch
 * die letzte vom Server bestätigte Sequenznummer bereits erledigt und
 * dürfen aus der Warteschlange fallen, welche müssen beim nächsten
 * Replay erneut angewendet werden?"
 *
 * NICHT VERDRAHTET — bewusst. Es gibt heute keine Vorhersage-
 * Warteschlange im Client: player/PlayerController.ts hält fest, dass
 * Client und Server dieselbe Bewegung rechnen "so both sides agree
 * without reconciliation for now", und main.ts (Frame-Loop) korrigiert
 * Drift stattdessen weich über die Distanz zur zuletzt gemeldeten
 * Serverposition (serverPos), nicht über gespeicherte/wiederholte
 * Eingaben.
 *
 * Der Server schickt seit F6 die zuletzt verarbeitete Eingabe-
 * Sequenznummer im PlayerState-Paket zurück (WovServer.sendPlayerState);
 * main.ts liest sie bereits aus. Die eigentliche Reconciliation — eine
 * Warteschlange gesendeter Eingaben führen, hier verwerfen, den Rest neu
 * simulieren — ist NICHT gebaut: eine halbe Umsetzung (Regel vorhanden,
 * aber ohne echte Warteschlange in die Bewegung eingehängt) wäre
 * trügerischer als eine sauber benannte Lücke. Diese Funktion ist die
 * Regel, isoliert und getestet, für den Tag, an dem jemand die
 * Warteschlange baut.
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
