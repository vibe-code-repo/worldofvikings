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
 * Original (Vermessung der Spieldaten): ebenfalls 0,4 — die eine Zahl,
 * die nie abwich.
 */
export const KOERPER_RADIUS = 0.4;

/**
 * Hoehe der Spielerkapsel in m. Capsule height.
 *
 * ORIGINAL, und seit dem 11.09.2026 auch hier: 2,0. Die Spieldaten des
 * Vorbilds zeigen einen einzigen Kapselcollider am Kind `CapsuleCollider`
 * mit Radius 0,4, Hoehe 2,0 und Mitte (0 / 1,0 / 0) — die Mitte auf der
 * halben Hoehe heisst: die Sohle steht auf 0, der Scheitel auf 2,0
 * (Vault-Notiz „Original-Bewegung und Kollision — aus den Spieldaten",
 * Abschnitt A „Die Form"; Entscheidung Mike 11.09.2026).
 *
 * Es sind 20 cm KOPFRAUM, keine groessere Figur: Das sichtbare Modell
 * bleibt 1,8 m hoch (`AvatarRig.SPIELER_HOEHE`), und das Namensschild
 * haengt weiter ueber diesem Scheitel. Die Kapsel ist absichtlich hoeher
 * als die Figur — eine zu niedrige laeuft unter Balken und Tuerstuerzen
 * durch, die im Vorbild blocken.
 *
 * Die Kapsel wird ueber ihre MITTE gesetzt (Client:
 * `controller.setPosition(y + KOERPER_HOEHE / 2)`, Spiegel zurueck mit
 * `p.y - KOERPER_HOEHE / 2`). Beide Stellen rechnen mit derselben Zahl,
 * also bleiben die Fuesse an derselben Stelle — die Kapsel waechst nur
 * nach oben.
 */
export const KOERPER_HOEHE = 2.0;

/**
 * Steilste Flaeche, die noch begehbar ist, in Grad.
 *
 * Der Client setzt daraus `maxSlopeCosine` an seinem Havok-Controller;
 * serverseitig entscheidet dieselbe Zahl, ob eine getroffene Flaeche eine
 * WAND ist (dann stoppt/gleitet die Bewegung) oder ein HANG (dann laeuft
 * die Figur darueber und die Bodenabfrage hebt sie an). Beide muessen
 * dieselbe Zahl benutzen, sonst haelt der eine an, wo der andere geht.
 *
 * ORIGINAL, und seit dem 11.09.2026 auch hier: 60 Grad (`SlopeLimit: 60`
 * im Spielerblock der Vorbild-Szene; Vault-Notiz „Original-Bewegung und
 * Kollision — aus den Spieldaten", Abschnitt A4 und Tabelle B;
 * Entscheidung Mike 11.09.2026).
 *
 * Warum das keine Kosmetik ist: Die Gelaende des Vorbilds sind steil —
 * mittlere Neigung 24,1 Grad, Spitzen weit darueber. Mit 40 Grad sperrt
 * der Hang, ueber den im Vorbild ein Weg fuehrt. Ueber 60 Grad STOPPT die
 * Figur bergauf (sie rutscht nicht von selbst hinunter; das taete im
 * Vorbild die eigene Slide-Faehigkeit, die bildratenabhaengig ist und
 * bewusst nicht uebernommen wurde).
 *
 * Der Client geht MIT: `PlayerController` importiert diese Zahl, seit sie
 * dort nicht mehr als eigene Konstante steht.
 */
export const STEIGUNGS_GRENZE_GRAD = 60;

/**
 * cos(60 grad), fest ausgeschrieben.
 *
 * Der Bewegungsschritt darf keine Trigonometrie rufen (s. Kopf von
 * `schritt.ts`): `Math.cos` liefert in Node und im Browser nicht
 * garantiert dasselbe letzte Bit, und genau daran zerfaellt eine
 * Vorhersage, die auf beiden Seiten gleich ausgehen soll. Die Zahl steht
 * deshalb als Literal da, nicht als Rechnung.
 * cos(60 deg) spelled out — the step must not call trigonometry.
 *
 * HERLEITUNG: cos(60 Grad) = 1/2, exakt — das gleichseitige Dreieck. Das
 * ist der seltene Glueckfall, dass die Schwelle KEIN gerundetes Literal
 * mehr ist: 0,5 ist in IEEE-754 ohne Rest darstellbar, Node und Browser
 * vergleichen also garantiert dieselbe Zahl. (Der Vorgaenger cos(40) =
 * 0.766044443118978 war eine 15-stellige Rundung.) Ein Test haelt die
 * Herleitung gegen `Math.cos` fest — s. `shared/test/bewegung-schritt.ts`.
 */
export const STEIGUNGS_GRENZE_COS = 0.5;

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
 * wird getroffen. Der obere deckt den KOPF ab, damit eine Wand, deren
 * Fuss verdeckt ist (Zaun auf einem Absatz, Balken im Durchgang), nicht in
 * Huefthoehe durchschritten wird.
 *
 * WARUM DER OBERE AUF 1,6 STEHT (bis 11.09.2026: 1,4). Der Server fegt je
 * Hoehe eine KUGEL vom Koerperradius den Weg entlang (s.
 * `Kollisionswelt.ersterTreffer`). Die obere Kugel ist der Kopf der
 * Kapsel: Ihr Mittelpunkt plus Radius muss genau auf den Scheitel treffen,
 * sonst sieht der Server einen anderen Koerper als der Client.
 *   1,6 + KOERPER_RADIUS 0,4 = 2,0 = KOERPER_HOEHE.  (vorher: 1,4 + 0,4
 *   = 1,8, und 1,8 WAR die Kapselhoehe — dieselbe Rechnung, alte Zahl.)
 * Nach oben ist damit Schluss: Die untere Kugel reicht bis
 * 0,43 + 0,4 + 0,4 = 1,23, die obere beginnt bei 1,6 − 0,4 = 1,2. Es
 * bleiben 3 cm Ueberdeckung. Bei 1,7 klaffte dazwischen eine Luecke von
 * 7 cm, durch die ein waagerechter Balken faellt, ohne getroffen zu
 * werden. Ein Test haelt beide Rechnungen fest.
 *
 * GRENZE: Es gibt keinen dritten Strahl fuer den Sprung. Springen bleibt
 * Client-Sache (der Server kennt bis heute keinen Sprungzustand), und ein
 * springender Spieler kann deshalb ueber ein Hindernis kommen, das der
 * Server noch fuer im Weg haelt — die Abweichung ist dann kurz und
 * kleiner als der weiche Abgleich (1,5 m). Wer das aendert, braucht
 * zuerst einen Sprungzustand im Protokoll, nicht einen dritten Strahl.
 */
export const STRAHL_HOEHEN: readonly number[] = [STUFEN_HOEHE + 0.03, 1.6];

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
 * Wand oder Hang? Die eine Regel, nach der beide Seiten entscheiden.
 *
 * Eine Flaeche ist eine WAND, wenn sie steiler steht als die
 * Steigungsgrenze — dann stoppt die Bewegung in sie hinein und gleitet
 * hoechstens daran entlang. Alles Flachere ist HANG: Darueber laeuft die
 * Figur, und die Bodenabfrage hebt sie an.
 *
 * Sie steht hier und nicht beim Aufrufer, weil sonst je eine Kopie im
 * Server und im Client staende — und zwei Kopien einer Schwelle sind zwei
 * Schwellen, sobald jemand eine davon anfasst.
 *
 * `normale` muss ein Einheitsvektor sein, so wie ein Strahlwurf sie meldet.
 */
export function istWand(normale: { y: number }): boolean {
  return normale.y < STEIGUNGS_GRENZE_COS;
}

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
