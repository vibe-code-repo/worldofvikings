# Klassen und Startsets

Die Charaktererstellung sendet `classId` an die Konten-API. Der Server validiert
die Kennung und speichert sie als `charaktere.klasse`. Die Vorschau und der Server
verwenden dieselbe Zuordnung in `shared/src/equipmentSets.ts`:

| Klasse | Set | Vorhandene Körpervarianten |
| --- | --- | --- |
| Krieger | Ironward | Wikinger |
| Hexer | Ashenveil | Wikinger |
| Druide | Wildwarden | Wikinger |
| Seherin | Seidraven | Wikinger und Wikingerin |
| Runenmagier | Glutzorn / Emberrage | Wikinger und Wikingerin |

Beim ersten Spieleinstieg kommt das vollständige kompatible Set ins Inventar,
unabhängig vom Vorschauschalter „Rüstung anzeigen“. Es wird nicht automatisch
angezogen. Die alten Lederteile gehören nicht mehr zur Startausrüstung;
bereits vorhandene Gegenstände werden nicht entfernt.

`starterSetGranted` wird zusammen mit dem Inventar im Weltspielstand gespeichert.
Erneutes Einloggen oder ein Serverneustart erzeugen keine weiteren Teile, auch
nicht nach Verkauf oder Wegwerfen. Bereits manuell vergebene Teile zählen zur
Erstausgabe. Reicht der Platz nicht für alle fehlenden Teile, bleibt das Inventar
unverändert und der Server versucht die Vergabe beim nächsten Login erneut.

Für Klassen ohne Set oder noch fehlende Körpervarianten wird nichts vergeben.
Die Vergabe bleibt offen, damit ein später ergänztes kompatibles Set beim
nächsten Login geliefert werden kann.

Alte Charaktere erhalten bei der Datenbankmigration eine leere Klasse. Ihre
frühere Vorschauauswahl wurde nicht gespeichert und lässt sich nicht sicher
rekonstruieren. Eine Nachvergabe braucht deshalb eine ausdrückliche Zuordnung
des vorhandenen Charakters zu seiner Klasse; sie wird nicht geraten.

Prüfungen: `server/test/starter-sets.ts` testet Zuordnung, volle Inventare und
Migration. `server/test/starter-sets-e2e.ts` prüft die echte HTTP-Erstellung und
WebSocket-Anmeldung für alle sieben Varianten sowie Wiederanmeldung und Neustart.
