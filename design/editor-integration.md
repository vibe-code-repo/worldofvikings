# Editor-Anbindung — Dungeon Generator 2.0

Entwurf für das neue Editor-Modul, das Layout + Bau (zellbasiert, Laufzeit-Geometrie) im bestehenden Karteneditor bedienbar macht. Bezug: [Dungeon Generator 2.0](../../../02%20Projekte/World-of-Vikings/Dungeon%20Generator%202.0.md), [Konzept Editor und Live-Welt](../../../02%20Projekte/World-of-Vikings/Konzept%20Editor%20und%20Live-Welt.md).

## 1. Ist-Zustand: wie der Editor heute aufgebaut ist

### 1.1 Rahmen (`client/src/editor/Shell.ts`)

`EditorShell` ist ein reines Layout-Gerüst mit benannten Andockplätzen — kein Werkzeug baut sich sein eigenes DOM-Gerüst:

- **Betriebsarten** (`shell.betriebsart(id, label, icon, onClick)`) füllen die linke Symbolspalte (74 px). Es gibt bereits `terrain`, `gewaesser`, `objekte`, `biome`, `routen`, `dungeons`, `flug`. `setzeBetriebsart(id)` färbt nur um, der Callback entscheidet, ob der Wechsel überhaupt stattfindet (ungespeicherte Änderung, laufender Testflug blockieren).
- **Seitenleiste** (332 px): `seitenkopf(titel, text)` fester Kopf, `sektion(titel, offen)` liefert einklappbare Container im scrollenden Mittelteil, `seitenfuss` fest unten.
- **Viewport**: eine `<div>`-Fläche, in die jedes Werkzeug seine eigene Zeichenfläche hängt (Canvas-Ebenen übereinander, sichtbar geschaltet über `display`). Die Weltkarten-Canvas und `DungeonGrundriss`' eigene Canvas koexistieren genau so.
- **Fußleiste**: `meldung()`, `fussZahlen()`, `koordinaten()`, Server-Konsole (`konsoleZeile`, schwebt über der Karte, kein Flex-Kind).
- **Instanz-Band**: Farbcodierung dev/live/unbekannt oben im Fenster — jedes Werkzeug, das schreibt, muss diese Warnung respektieren, nicht neu erfinden.

Farben/Maße kommen ausschließlich aus `design.ts` (`F`, `M`, `SCHRIFT`, `PFAD`, `stil()`, `el()`) — ein neues Modul führt keine eigenen Literalfarben ein.

### 1.2 Bestehendes Dungeon-Werkzeug (LEGACY-Vorbild fürs Muster, nicht für den Inhalt)

Drei Dateien, sauber getrennt, exakt das Muster, dem das neue Modul folgen sollte:

- **`DungeonFloorplan.ts`** — die Zeichenfläche (eigenes Canvas im Viewport, Draufsicht, Pan/Zoom ums Mausrad, Klick wählt einen Raum). Wichtigster Grundsatz, wörtlich aus dem Kopfkommentar: *„Gebaut wird ausschließlich mit `attachRoom`, `removeRoom` und `computeOpenConnections` aus `shared/src/dungeonGenerator.ts` — denselben Funktionen, die Server, Generator und der F4-Editor benutzen. Eine zweite Bau-Logik im Editor wäre die eine Sache, die dieses Vorhaben ausdrücklich ausschließt."* Das ist die Regel, die das neue Modul 1:1 übernimmt, nur mit dem neuen Geometrie-Bauer statt `attachRoom`.
- **`DungeonCatalog.ts`** (Klasse `DungeonSeite`) — die Seitenleiste: Dungeon-Liste laden, Kopfzeile mit Kennzahlen, Ebenen-Filter, Raumbibliothek als `<select>`, Anfügen/Entfernen, Prüfen (Sanitizer-Trockenlauf ohne Server), Speichern, Betreten (öffnet den Dungeon im echten Spielclient in neuem Tab).
- **`DungeonSpeichern.ts`** — der Netzwerkweg zum Schreiben (siehe 2.2).

Zwei-Wege-Prinzip, das für das neue Modul unverändert gilt: **Gelesen wird über den Betriebsdienst** (`GET /api/…`, kein Spielserver nötig, dev und live gleichermaßen erreichbar), **geschrieben wird über den Spielserver** (der hält Dokument und Instanz im Speicher, eine vom Betriebsdienst geschriebene Datei sähe er nicht, bis er neu startet).

### 1.3 Editor-Hauptdatei (`client/src/editor/editorMain.ts`, 3465 Zeilen)

Verdrahtet nur — Werkzeuge stehen daneben, genau nach dem in `DungeonCatalog.ts` benannten Vorbild von `RoutenEditor.ts`. Andockpunkt für ein neues Modul ist eine weitere `shell.betriebsart('dungeon2', …)`-Zeile plus Instanziierung von zwei bis drei neuen Klassen (Canvas-Werkzeug + Seitenleiste + ggf. Zellen-Ebene), analog zu den Zeilen um 446–460, wo `DungeonGrundriss` und `DungeonSeite` gebaut werden.

## 2. Editor-Verbindung ohne Weltbeitritt (`Peer.nurEditor`)

### 2.1 Die Falle, die das Feld beseitigt

Vor Einführung von `nurEditor` (28.08.2026 gemessen) kostete **jeder** Speicherklick im Editor:

1. **Einen Phantom-Charakter** — Charakter-ZDO, Startausrüstung, 12,3 KB Terraforming, ein 15k-ZDO-Scan fürs Baubudget, sichtbar für alle anderen Spieler.
2. **Eine verdrängte Sitzung** — der Servername kommt aus dem Konto, nicht vom Client (`NetManager.ts`: „The NAME comes from the account"). Zwei Verbindungen derselben Kennung tragen denselben Namen; der Duplikatszweig löste die ältere ab → Speichern im Karteneditor warf den offenen Spielclient hinaus.
3. Beim Verbindungsende (`onPeerQuit`) wäre der gemerkte Spielerstand (`savedPlayers`, geschlüsselt über `spielerId`) mit dem Nichts einer Verbindung überschrieben worden, die nie in der Welt war — Standort, Fliegen, Spawnpunkt weg, ohne Fehlermeldung.

### 2.2 Wie es heute funktioniert

- `GameSocket`-Konstruktor nimmt ein drittes Argument `nurEditor: boolean` (`client/src/net/GameSocket.ts:205`), das im Handshake als **angehängtes Feld** hinter `PasswordAuth` mitgeschickt wird (`writeBool`, `NetManager.ts:314` liest es optional — `reader.remaining() > 0`, damit alte Clients ohne das Feld weiter funktionieren).
- Server setzt `peer.nurEditor = nurEditor` (`NetManager.ts:411`).
- `WovServer.onPeerAuthenticated`: Wenn `peer.nurEditor`, **kein** `ServerConfig`-Paket, kein Terrain, kein Spawn — der Peer bleibt authentifiziert und darf Editor-Pakete senden (Rechte weiterhin ausschließlich über `peer.isAdmin`), betritt aber die Welt nicht.
- `WovServer.onPeerQuit`: Bei `peer.nurEditor` sofortiger Return, **bevor** `savedPlayers` angefasst wird — das ist die Zeile, die den Bestandsschaden aus 2.1 Punkt 3 verhindert.
- `DungeonSpeichern.ts` (`speichereDungeon()`) baut die Verbindung **just-in-time**: Socket auf, `sendDungeonEditSave`, auf `DungeonEditData`-Quittung warten (Frist 10 s), Socket **sofort wieder zu** — egal ob Erfolg, Fehler oder Timeout (`ende()`-Funktion mit Einmal-Riegel `erledigt`). Kein dauerhafter Editor-Socket.
- Übernommen wird **das vom Server geprüfte Dokument**, nicht das gesendete — der Sanitizer dort ist die letzte Instanz.
- Bewacht von `server/test/g9-editor-verbindung.ts` — Regressionstest, der `nurEditor` explizit als angehängtes Feld verbindet und die Namensgleichheits-Logik prüft.

### 2.3 Was das für das neue Dungeon-Modul heißt

Identisches Muster übernehmen, nicht neu erfinden:

- Jede schreibende Aktion (Layout speichern, Zellen-Änderung committen) geht über eine kurzlebige `GameSocket(..., nurEditor=true)`-Verbindung, verbindet, sendet, wartet auf Quittung, trennt.
- Lesende Aktionen (Katalog laden, Layout zum Bearbeiten holen) bleiben beim Betriebsdienst — der muss dafür nicht laufen dürfen zu schreiben (siehe 2.1-Fallstrick im Konzept: „Betriebsdienst darf Dungeon-Dateien nicht schreiben, weil der laufende Spielserver sie nicht bemerken würde").
- Ein neues Paket (`DungeonZellenSave` o. ä. statt/neben `DungeonEditSave`) sollte dieselbe Rundreise fahren: Client sendet Dokument, Server sanitized + baut Instanz-Geometrie serverseitig neu auf (Kollision!) + schickt geprüftes Dokument zurück.
- **Determinismus-Kopplung**: Weil der neue Geometrie-Bauer in `shared/` liegt und Server wie Client denselben Code für Kollision/Darstellung nutzen (Beschluss aus Dungeon Generator 2.0), kann der Server nach dem Sanitizing sofort real bauen und dessen Kennzahlen (Zellenzahl, Raumanzahl, evtl. Warnungen aus einem Layout-Validator) in der Quittung mitschicken — das ist die Grundlage für „Prüfen" ohne Speichern (siehe `DungeonKatalog.pruefe()`, dieselbe Idee mit Zellen statt Räumen).

## 3. Entwurf: das neue Editor-Modul

Dateizuschnitt parallel zum Altbestand, LEGACY bleibt unter den bisherigen Namen unangetastet:

```
client/src/editor/
  DungeonFloorplan.ts        LEGACY (Räume/GLB, unverändert)
  DungeonCatalog.ts          LEGACY (unverändert)
  DungeonSpeichern.ts        LEGACY (unverändert)
  dungeon2/
    CellCanvas.ts          neue Zeichenfläche (Zellen + Räume + Live-Vorschau)
    CellTools.ts       Boden heben/senken, Wandflags, Materialtag-Pinsel
    RoomStampPalette.ts    Seitenleiste: Stempel wählen, aufs Raster setzen
    Dungeon2Catalog.ts       Seitenleiste: Laden/Speichern/Prüfen/Betreten (Analogie zu DungeonKatalog)
    Dungeon2Speichern.ts     Netzwerkweg (Analogie zu DungeonSpeichern, neues Paket)
    Dungeon2Vorschau.ts      Live-3D-Vorschau über denselben Geometrie-Bauer (Babylon-Canvas statt 2D)
```

### 3.1 Andockpunkt in der Shell

Neue Betriebsart `shell.betriebsart('dungeon2', 'Dungeon 2.0', PFAD.dungeon2, () => stelleEin('dungeon2', …))` neben der bestehenden `dungeons`-Art — **nicht ersetzen**, solange Altbestand parallel läuft (Beschluss: LEGACY bleibt lauffähig bis Mikes Abnahme + einem Lösch-Commit). Empfehlung: Icon deutlich unterscheidbar machen (z. B. Zellen-Raster-Symbol statt Tür-Symbol), damit ein Rechtsklick-Vergleich zwischen alt und neu beim Testen nicht zur Ratefrage wird.

Seitenleiste bekommt zwei Sektionen übereinander (`shell.sektion(...)`), analog zum bestehenden Muster:

1. **Zellen-Ebene** (Grundwerkzeug, ganz oben — sie ist die Wahrheit, Stempel sind nur ein Hilfsmittel darüber)
2. **Raum-Stempel** (Bequemlichkeitsschicht: einen vordefinierten Zellblock auf einen Schlag setzen)

### 3.2 Zellen-Werkzeuge

Analog zu den Terrain-Pinseln, die der Editor an anderer Stelle schon führt (Höhen-/Biom-Pinsel bei `terrain`/`biome` — gleiche Interaktionslogik: Radius, Stärke, Ziehen bei gedrückter Maustaste). Für Zellen konkret:

- **Boden heben/senken**: Klick/Ziehen auf einer Zelle ändert deren Bodenhöhe in diskreten Schritten (Rastergröße aus dem Layout-Format, vermutlich analog zum bisherigen 4-m-Kit-Raster in `DungeonGrundriss`, aber pro Zelle konfigurierbar). Live-Vorschau zeichnet sofort neu — kein Server-Roundtrip nötig, weil derselbe deterministische Geometrie-Bauer im Client läuft (Kernvoraussetzung aus dem Konzept: „Geometrie-Bauer deterministisch in `shared/`").
- **Wandflags**: Pro Zellkante ein Toggle (Wand ja/nein, evtl. Tür/Durchgang als Flag-Wert statt eigenem Objekttyp — zu klären mit dem Datenmodell-Entwurf, sobald der steht). UI-Muster: Kante unter dem Mauszeiger hervorheben (Hover-Feedback wie in `DungeonGrundriss.waehleBei`), Klick togglet.
- **Materialtag-Pinsel**: Zelle (oder Zellfläche: Boden/Wand/Decke einzeln) bekommt ein Materialtag zugewiesen, das der Triplanar-Shader für Blending (Moos, Feuchte, Schmutz) konsumiert. Werkzeug ist ein Radius-Pinsel wie bei Terrain-Biomen, Palette der Tags kommt aus dem Material-Plan (paralleler Design-Strang), nicht aus diesem Dokument.

Alle drei Werkzeuge schreiben unmittelbar ins In-Memory-Layout-Dokument (kein Server-Write pro Strich) — genau wie die bestehenden Terrain-Pinsel lokal zeichnen und erst ein expliziter „Speichern"-Klick den Server-Roundtrip auslöst (`schmutzig`-Flag-Muster aus `DungeonSeite` 1:1 übernehmen: jede Änderung setzt `schmutzig = true`, der Speichern-Knopf zeigt `Speichern *`).

### 3.3 Raum-Stempel-Palette

Bequemlichkeitsschicht über den Zellen: ein Stempel ist eine vordefinierte Zellblock-Schablone (Größe, Bodenhöhen-Profil, Standard-Wandflags, Standard-Materialtags), die man mit einem Klick aufs Raster setzt — Rotation in 90°-Schritten wie gehabt (`PlacedRoom.rot` als Quaternion im Altbestand; ob das neue Format ebenfalls Quaternion oder nur 4 Kardinalrichtungen braucht, ist eine offene Frage ans Datenmodell, aber die Editor-Bedienung sollte auf einfache Rotations-Buttons setzen statt Freihanddrehung — bei Zellen macht ohnehin nur Vielfaches von 90° Sinn).

Palette-UI wie die bestehende Raumbibliothek in `DungeonKatalog.baue()`: `<select>` mit Vorschau-Größe im Label, sortiert (Eingangsräume/Endkappen zuerst oder zuletzt, wie im Altbestand mit `endCap`-Sortierung). Nach dem Setzen eines Stempels bleibt das Ergebnis reine Zellen — der Stempel selbst ist kein persistentes Objekt im Dokument, sondern nur der Weg, wie die Zellen entstanden sind (entspricht dem Analogieprinzip „Auto-Generator und Hand-Bau teilen dasselbe Layout-Format" aus dem Konzept: eine gestempelte und eine von Hand gepinselte Zelle sind im gespeicherten Dokument nicht unterscheidbar).

### 3.4 Laden/Nachbearbeiten generierter Layouts

Gleicher Zwei-Wege-Fluss wie beim Altbestand:

- **Laden**: `GET /api/…` (Betriebsdienst) liefert das Zellen-Layout-Dokument — Katalogliste + Einzeldokument, analog zu `holeDungeonListe()`/`holeDungeon()` in `DungeonDocument.ts`.
- **Ein generiertes Layout ist ab dem ersten Handeingriff `mode: 'custom'`** — exakt das bestehende Prinzip aus `DungeonGrundriss.fuegeAn()`/`entferne()` (`doc.mode = 'custom'`, mit Kommentar: „Von Hand gebaut heisst 'custom': Ein 'generated'-Dokument wird beim nächsten Materialisieren aus Seed und Regeln neu erzeugt, und der angefügte Raum wäre spurlos weg"). Für Zellen gilt dasselbe: Sobald ein Pinselstrich oder Stempel eine generierte Zelle überschreibt, kippt das Dokument auf `custom`, sonst verschluckt der nächste Seed-Rebuild die Handarbeit.
- **Prüfen ohne Speichern**: Client-seitiger Sanitizer-Trockenlauf wie `DungeonKatalog.pruefe()` — mit dem deterministischen Geometrie-Bauer zusätzlich möglich: eine echte Baukosten-Schätzung (Zellenzahl, Dreieckszahl, Materialwechsel) direkt im Editor, bevor überhaupt gespeichert wird.

### 3.5 Live-Vorschau über denselben Geometrie-Bauer

Zentrale Neuerung gegenüber dem Altbestand: `DungeonGrundriss` zeichnet eine abstrahierte 2D-Draufsicht (Canvas 2D, Rechtecke). Das neue Modul kann zusätzlich (oder alternativ, je nach Performance-Messung) eine **echte 3D-Vorschau** anbieten, weil derselbe Geometrie-Bauer, der im Spiel läuft, auch im Editor-Client läuft (`shared/`-Determinismus-Vorgabe macht das ohne Doppelimplementierung möglich).

Empfehlung für den Zuschnitt:

- **2D-Zellenraster bleibt die primäre Arbeitsfläche** — für Präzision beim Pinseln ist eine Draufsicht schneller zu bedienen als eine 3D-Kamera, und das bestehende Pan/Zoom-Muster aus `DungeonGrundriss` (Zoom ums Mausrad um den Zeiger, Ziehen mit gedrückter Maustaste) lässt sich 1:1 übernehmen.
- **3D-Vorschau als zweite Ebene im selben Viewport** (analog zur bestehenden Koexistenz von Weltkarten-Canvas und Dungeon-Canvas über `display:block/none`), umschaltbar oder als Splitscreen — zu entscheiden, sobald ein erster Klick-Prototyp zeigt, wie teuer ein Rebuild pro Pinselstrich ist. Falls jeder Strich einen vollen Geometrie-Rebuild auslöst und das spürbar ruckelt, braucht es Debouncing (Rebuild erst X ms nach dem letzten Strich) — dasselbe Problem, das die Roadmap-Notiz für Hot-Reload des Weltlayouts beschreibt („Placement-Cache müsste zonenscharf statt global verschlüsselt werden").
- Die 3D-Vorschau nutzt **exakt** die Grafikstufen-Konfiguration, die auch im Spiel gilt (kein Editor-Sonderpfad für SSAO/Godrays/Triplanar) — sonst sieht man im Editor etwas anderes, als am Ende live steht. Genau der Fehler, den der Offline-Testflug im Konzeptdokument als Ursache allen Vertrauensverlusts benennt (18.08-Messung: 414/86/592 vs. 311/39/65 Meshes/Materialien/Texturen zwischen Testflug und Online-Pfad).

### 3.6 Speichern ins Layout-Format

Gleicher Roundtrip wie `speichereDungeon()`, mit den unter 2.3 genannten Anpassungen:

1. Klick auf „Speichern" → `speichertGerade = true`, Seitenleiste neu zeichnen (Knopf zeigt „Speichert …", deaktiviert — 1:1 aus `DungeonKatalog.speichere()`).
2. `nurEditor`-Socket auf, neues Paket mit dem Zellen-Dokument senden.
3. Server: sanitizen, Instanz-Geometrie serverseitig neu bauen (Kollision), geprüftes Dokument zurückschicken.
4. Client übernimmt **das serverseitig geprüfte Dokument**, nicht das gesendete (Grundsatz aus `DungeonSpeichern.ts` unverändert: „Der Sanitizer dort ist die letzte Instanz").
5. Socket sofort trennen — kein Dauer-Editor-Socket, kein Phantom-Charakter, `savedPlayers` bleibt unberührt (Abschnitt 2.2).
6. `schmutzig = false`, Katalogliste neu laden (Kennzahlen in der Liste sonst veraltet).

„Betreten"-Knopf bleibt sinnvoll analog zu `DungeonKatalog.betrete()`: öffnet den generierten/bearbeiteten Dungeon im echten Online-Spielclient (nicht im Testflug — der läuft ohne Server), mit derselben Host-Übersetzung (`spielHost()`) und demselben Sitzungstoken-Fallback bei fremdem Ursprung.

## 4. Offene Fragen an das Datenmodell (nicht Gegenstand dieses Dokuments)

- Exakte Feldstruktur einer Zelle (Bodenhöhe(n) pro Ecke oder pro Zelle flach? Wandflags als Bitmaske pro Kante oder vier Einzelfelder?) — bestimmt direkt, wie granular die Pinselwerkzeuge greifen können.
- Rotationsdarstellung für Stempel: Kardinalrichtung (0/90/180/270°) reicht vermutlich, spart der Editor-UI die volle Quaternion-Freihanddrehung, die der Altbestand für GLB-Räume brauchte.
- Wie referenziert ein Layout-Dokument sein Theme/seinen Material-Seed (für Tint-Varianten) — das entscheidet, ob die Editor-Seitenleiste einen zusätzlichen Theme-Wähler braucht (analog zum `base`-Feld im Altbestand-Dokument).

## 5. Zusammenfassung der Andockpunkte

| Was | Woher übernehmen | Datei/Muster |
|---|---|---|
| Betriebsart-Registrierung | 1:1 Muster | `Shell.betriebsart()` |
| Seitenleiste-Bausteine | 1:1 Muster | `Shell.sektion()`, `seitenkopf()` |
| Canvas-Koexistenz im Viewport | 1:1 Muster | `DungeonGrundriss`-Konstruktor |
| „Ein Weg baut, keine zweite Logik" | Prinzip 1:1, Funktion neu (Geometrie-Bauer statt `attachRoom`) | Kopfkommentar `DungeonFloorplan.ts` |
| `schmutzig`/Speichern-Knopf-Zustände | 1:1 Muster | `DungeonKatalog.baue()` |
| Editor-Verbindung ohne Weltbeitritt | 1:1 unverändert übernehmen | `nurEditor` (Peer.ts, GameSocket.ts, WovServer.ts) |
| Kurzlebiger Speicher-Socket | 1:1 Muster, neues Paket | `DungeonSpeichern.ts` |
| „generated" kippt zu „custom" bei Handeingriff | Prinzip 1:1 | `DungeonGrundriss.fuegeAn()/entferne()` |
| Betreten im echten Client | 1:1 Muster | `DungeonKatalog.betrete()`, `spielHost()` |
