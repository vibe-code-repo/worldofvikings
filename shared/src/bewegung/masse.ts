/**
 * Die EINE Quelle der Bewegungszahlen: Tempi, Kapselmasse, Steigungsgrenze.
 * The one source of the movement numbers: speeds, capsule, slope limit.
 *
 * Warum eine eigene Datei: Bis hierher standen die Tempi (4,5 / 7,5 m/s)
 * dreimal im Baum — `client/src/player/PlayerController.ts` (WALK_SPEED /
 * RUN_SPEED), `WovServer.handlePlayerInput` (Oberwelt) und noch einmal im
 * Dungeon-Zweig desselben Handlers. Solange Client und Server dieselbe
 * Bewegung rechnen SOLLEN, ist jede zweite Kopie eine Stelle, an der die
 * beiden auseinanderlaufen koennen, ohne dass es jemand merkt: Der Server
 * schiebt die Figur weiter als der Client, und was der Spieler sieht, ist
 * ein Ruck (Nutzerbericht „haengt am Felsen, springt dann nach vorne").
 *
 * Das Modul ist rein: keine Babylon-Typen, keine `node:`-Importe, keine
 * Uhr. Der Client-Controller darf es genauso importieren wie der Server.
 * Pure module: no Babylon, no `node:`, no clock — importable from both
 * client and server.
 */

/** Gehtempo in m/s (Referenzwert des Vorbilds). Walk speed. */
export const GEH_TEMPO = 4.5;

/** Lauftempo in m/s — nur mit Ausdauer. Run speed. */
export const LAUF_TEMPO = 7.5;

/**
 * Halbe Breite der Spielerkapsel in m. Capsule radius.
 * Original (Vermessung der Spieldaten): ebenfalls 0,4.
 */
export const KOERPER_RADIUS = 0.4;

/**
 * Hoehe der Spielerkapsel in m. Capsule height.
 * ORIGINAL: 2,0 — hier steht 1,8, weil der Client-Controller heute mit
 * 1,8 gebaut wird (`PlayerController.BODY_HEIGHT`) und der Server dem
 * CLIENT gleichen muss, nicht dem Original. Wer auf die Originalwerte
 * umstellt, aendert diese Datei und den Controller in EINEM Schritt.
 */
export const KOERPER_HOEHE = 1.8;

/**
 * Steilste Flaeche, die noch begehbar ist, in Grad.
 *
 * Der Client setzt daraus `maxSlopeCosine` an seinem Havok-Controller;
 * serverseitig entscheidet dieselbe Zahl, ob eine getroffene Flaeche eine
 * WAND ist (dann stoppt/gleitet die Bewegung) oder ein HANG (dann laeuft
 * die Figur darueber und die Bodenabfrage hebt sie an). Beide muessen
 * dieselbe Zahl benutzen, sonst haelt der eine an, wo der andere geht.
 *
 * ORIGINAL: 60 Grad. Bewusst NICHT uebernommen: Der Client faehrt heute
 * 40, und diese Aufgabe raeumt die Abweichung zwischen Client und Server
 * auf — sie darf keine neue aufmachen. Die Umstellung auf 60 ist ein
 * Einzeiler HIER, sobald der Controller mitgeht.
 */
export const STEIGUNGS_GRENZE_GRAD = 40;

/**
 * cos(40 grad), fest ausgeschrieben.
 *
 * Der Bewegungsschritt darf keine Trigonometrie rufen (s. Kopf von
 * `schritt.ts`): `Math.cos` liefert in Node und im Browser nicht
 * garantiert dasselbe letzte Bit, und genau daran zerfaellt eine
 * Vorhersage, die auf beiden Seiten gleich ausgehen soll. Die Zahl steht
 * deshalb als Literal da, nicht als Rechnung.
 * cos(40 deg) spelled out — the step must not call trigonometry.
 */
export const STEIGUNGS_GRENZE_COS = 0.766044443118978;

/**
 * Was noch eine Stufe ist und keine Wand, in m.
 *
 * ORIGINAL: `m_MaxStepHeight` = 0,4 — und genau die steht hier, seit die
 * Spieldaten vermessen sind (vorher 0,45 aus dem Vorbild-Entwurf).
 *
 * Dieselbe Zahl an drei Stellen, und das ist der Punkt: Die unteren
 * Hindernisstrahlen liegen KNAPP DARUEBER (eine Kante bis 0,40 m wird also
 * gar nicht erst getroffen), und der Bodenstrahl startet GENAU so weit
 * ueber den Fuessen (was er nicht erreicht, ist unbesteigbar). Waeren die
 * beiden verschieden, stiesse die Figur an eine Kante, auf der sie steht.
 */
export const STUFEN_HOEHE = 0.4;

/**
 * Wie weit unter den Fuessen der Boden noch „klebt", in m.
 *
 * ORIGINAL: `m_StickToGroundDistance` = 0,3. Liegt der Boden nicht weiter
 * darunter, wird die Figur aufgesetzt statt fallen gelassen. Ohne diese
 * Zahl flattert eine Figur, die eine Treppe hinunterlaeuft oder ueber eine
 * Gelaendekante rollt, im Wechsel zwischen „faellt" und „steht" — und
 * jeder dieser Wechsel ist ein Stueckchen Drift gegenueber dem Client.
 */
export const BODEN_KLEBEN = 0.3;

/**
 * Seitlicher Versatz der Bodenstrahlen als Anteil des Koerperradius.
 *
 * Das Original setzt die Figur mit einem KAPSEL-Sweep auf den Boden, wir
 * mit Strahlen. Ein einzelner Fussstrahl faellt zwischen zwei konvexen
 * Felsnetzen in die Luecke und meldet dort das Gelaende — die Figur
 * saeckt dann auf einem Felsfeld im Meterrhythmus ein und aus. Vier
 * Versaetze rund um die Mitte decken die Standflaeche der Kapsel ab; 0,7
 * statt 1,0, damit sie nicht genau auf der Silhouette liegen, wo eine
 * Kante sie gerade so verfehlt.
 */
export const BODEN_VERSATZ = 0.7;

/**
 * Hoehen ueber den Fuessen, in denen die Hindernisstrahlen laufen, in m.
 *
 * Zwei, und beide werden gebraucht. Der untere liegt 3 cm ueber der
 * Stufenhoehe: Ein 0,40-m-Absatz laeuft darunter durch, ein 0,5-m-Sockel
 * wird getroffen. Der obere sitzt auf Brusthoehe, damit eine Wand, deren
 * Fuss verdeckt ist (Zaun auf einem Absatz, Balken im Durchgang), nicht in
 * Huefthoehe durchschritten wird.
 *
 * GRENZE: Es gibt keinen dritten Strahl fuer den Sprung. Springen bleibt
 * Client-Sache (der Server kennt bis heute keinen Sprungzustand), und ein
 * springender Spieler kann deshalb ueber ein Hindernis kommen, das der
 * Server noch fuer im Weg haelt — die Abweichung ist dann kurz und
 * kleiner als der weiche Abgleich (1,5 m). Wer das aendert, braucht
 * zuerst einen Sprungzustand im Protokoll, nicht einen dritten Strahl.
 */
export const STRAHL_HOEHEN: readonly number[] = [STUFEN_HOEHE + 0.03, 1.4];

/**
 * Fallgeschwindigkeit in m/s, serverseitig konstant.
 *
 * Der Server integriert keine Beschleunigung (der Client tut es, mit
 * −20 m/s²); er zieht die Figur mit fester Rate auf den Boden. Das ist der
 * Bestand und bleibt es hier: Diese Aufgabe raeumt die WAAGERECHTE Drift
 * auf, nicht die senkrechte.
 */
export const FALL_TEMPO = 15;

/** Laenge eines Simulationsschritts in Sekunden (60 Hz). Fixed step length. */
export const SCHRITT_LAENGE = 1 / 60;

/**
 * Wie viele Schritte ein einzelner Aufruf hoechstens rechnet.
 *
 * Schutz vor der Todesspirale: Ein Aufruf, der 3 s Rueckstand aufholen
 * will, kostet 180 Schritte und macht den naechsten Rueckstand groesser.
 * Der Server setzt eine eigene, hoehere Grenze — s. `SERVER_MAX_SCHRITTE`.
 */
export const MAX_SCHRITTE = 5;

/**
 * Der Deckel des SERVERS — hoeher als `MAX_SCHRITTE`, und mit Grund.
 *
 * `handlePlayerInput` klemmt die Wanduhr-Spanne zwischen zwei Paketen seit
 * jeher auf 0,5 s. Ein Deckel von 5 Schritten (0,083 s) waere damit KEIN
 * Schutz mehr, sondern eine stille Bremse: Ein Client, dessen Pakete alle
 * 100 ms ankommen, liefe serverseitig nur noch halb so schnell wie
 * clientseitig — also genau die Drift, die diese Aufgabe wegnimmt, nur mit
 * anderem Vorzeichen. 30 Schritte sind 0,5 s und decken die Klemme also
 * vollstaendig ab; darueber hinaus faellt ohnehin nichts mehr an.
 */
export const SERVER_MAX_SCHRITTE = 30;
