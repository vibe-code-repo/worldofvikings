# Weltbau: Layout-Welt, Editor und MCP

Stand: 16.08.2026 (nach Block A). Beschreibt den Kartengenerierungs-Umbau
(Phasen 0–5b): die designer-definierte, wachsende Welt, ihre Werkzeuge und
den Weg vom Entwurf in die Live-Umgebung.

> **Was sich am 16.08.2026 geändert hat** — kurz, weil es fast jeden
> Abschnitt unten berührt:
>
> - Es gibt **eine Codebasis für zwei Container** (wov-dev, wov-live), ein
>   Branch `main`. `WOV_INSTANZ` aus `/etc/wov.env` (`dev`|`live`) bestimmt
>   alles Umgebungsabhängige; Auflöser ist `shared/src/instanz.ts`.
>   **`server/data/worldlayout.json` gibt es nicht mehr** — das Weltdokument
>   heißt `server/data/welten/<instanz>.json`.
> - Der Editor läuft auf **beiden** Containern und hat seit dem einen
>   **Leseweg**; „Publish per Export + Neustart" ist Geschichte.
> - Es werden **nur noch eigene Modelle** ausgeliefert. Locations und
>   Dungeons sind deshalb abgeschaltet (`world.features: false`,
>   `dungeons.enabled: false`) — was das für dieses Dokument bedeutet,
>   steht bei „Fortschritt & Progression".

## Idee

Statt des radialen Valheim-Seeds (10-km-Kreis, Biom-Ringe) beschreibt ein
**WorldLayout-Dokument** die Welt: Regionen (Polygone/Kreise) mit Biom und
Terrainparametern auf einer unbegrenzten Karte. **Alles außerhalb von
Regionen ist offener Ozean.** Das Perlin-Detail INNERHALB einer Region
(Hügel, Wald, Küstenrauschen) liefern unverändert die Valheim-
Biomhöhenfunktionen — nur die radiale Basis ist ersetzt.

## Datenfluss

```
server/data/welten/<instanz>.json      (Autorformat, JSON, klein, in Git)
  └─ sanitizeWorldLayout()             shared/src/worldlayout/sanitize.ts
      └─ RegionField (Distanzfeld)     shared/src/worldlayout/compile.ts
          └─ RegionGeo                 shared/src/worldgen/RegionGeo.ts
              ├─ Server: ZoneManager/SpawnSystem (Kuratierung je Region)
              ├─ Client: Terrain/Karte/Minimap (Paket 64 WorldLayoutData)
              └─ mapWorker (eigene Instanz, Maße im Request)
```

- **Welche Datei das ist, entscheidet `WOV_INSTANZ`**, nicht der Quellbaum:
  `weltDatei()` in `shared/src/instanz.ts` löst `dev` → `welten/dev.json`,
  `live` → `welten/live.json` auf. **Beide Dateien liegen auf beiden
  Containern** und stehen in Git — live ignoriert `dev.json` schlicht.
  Genau deshalb kann der Dev-Editor die Live-Welt bearbeiten, ohne sich mit
  live zu verbinden.
  *Bis 08/2026 stand der Weltname in `server/data/server.yml`
  (`world.world`, `world.layout`), und das Dokument hieß auf beiden
  Containern `server/data/worldlayout.json`. Deshalb durfte server.yml nie
  mitdeployed werden — eine Datei, die auf zwei Containern verschieden sein
  MUSS, lässt die Arbeitsbäume nach jedem Abgleich erneut auseinanderlaufen.
  Ein unbekannter Wert in `WOV_INSTANZ` bricht den Start hart ab: Ein
  Rückfallwert würde die falsche Welt öffnen und sie bei der nächsten
  30-Minuten-Sicherung überschreiben.*
- **Geschrieben wird das Dokument an genau einer Stelle**:
  `shared/src/worldlayout/layoutDatei.ts` (`layoutLesen`, `layoutSichern`,
  `layoutSchreiben`). Sanitisierung, zeitgestempelte Sicherung (letzte 10)
  und atomares `.tmp` + `rename` stecken dort; Betriebsdienst und MCP-Server
  benutzen dieselbe Funktion. *Vorher lag derselbe Dreisatz zweimal herum —
  im MCP-Server und im Speicher-Plugin von `client/vite.config.ts` —, und
  nur eine der beiden Kopien prüfte streng.* Die Byte-Darstellung
  (`JSON.stringify(…, null, 2)`, ohne Schlusszeilenumbruch) ist Teil des
  Vertrags: `shared/test/worldlayout.ts` hält für BEIDE Weltdateien fest,
  dass sie bytegleich durch den Sanitizer gehen.
- `createGeo({mode})` (shared/src/worldgen/factory.ts) ist die Modus-Weiche:
  `valheim` (radialer Übergangspfad) oder `layout`.
- Im Layout-Modus ist der **detailSeed DES DOKUMENTS** maßgeblich — auf
  Server, Client und MCP-Probe identisch.
- Der Server kündigt das Layout per ServerConfig-Flag (Bit 5) an und sendet
  `WorldLayoutData` (64); der Client baut seine Welt erst danach.
- Save-Schutz: Der Layout-Hash steht in der Save-Meta; Drift wird beim Laden
  gewarnt. Inkompatible Saves werden als `.orphan-<ts>` beiseitegelegt.
- Placement-Cache: `worlds/<instanz>.locations.json` (Schlüssel: Seed,
  genVersion, Layout-Hash, Feature-Anzahl) — Layout-Änderung würfelt
  automatisch neu. Der Cache ist gitignored, so wie der Spielstand
  `worlds/<instanz>.db.zst` daneben.
  *Er war der Grund, warum der Boot von Minuten auf ~6 s fiel. Seit
  `world.features: false` werden gar keine Locations mehr platziert; der
  Serverstart dauert jetzt ~2 s, und der Cache hält nur noch eine leere
  Buchung. Sobald es eigene Location-Modelle gibt, trägt er wieder.*

## Schema (Kurzfassung)

```jsonc
{
  "version": 1,
  "name": "World of Vikings",
  "detailSeed": "wov-alpha",          // Seed NUR fürs Perlin-Detail
  "continents": [{ "id": "vikingr", "name": "Vikingr", "faction": "viking" }],
  "regions": [{                        // Reihenfolge = Z-Ordnung (später überdeckt)
    "id": "vikingr-land",
    "biome": "grassland",             // grassland|blackforest|swamp|mountain|plains|mistlands|ashlands|deepnorth
                                       // ("meadows" wird beim Laden auf "grassland" migriert)
    "shape": { "kind": "polygon", "points": [[x, z], …] },  // oder circle{x,z,radius}
    "edgeFalloff": 450,               // Küsten-Falloff in m
    "baseLevel": 0.3,                 // Basis-Plateau (0.15 ⇔ Wasserlinie; ×200 = m)
    "heightScale": 1,                 // Amplitude des Perlin-Details
    "forestDensity": 1,               // 0 kahl … 2 dicht
    "vegetation": ["Eiche1"],         // KURATIERUNG: exklusive Liste je Region
                                       //   Liste voll  → exakt diese Arten, sonst nichts
                                       //   Liste LEER  → gar kein Bewuchs (Gras bleibt)
                                       //   Feld fehlt  → seit Block A ebenfalls kahl,
                                       //                 s. „Kuratierung je Biom"
    "locations": [], "spawns": []     // (fehlt ein Feld → Biom-Standardtabellen;
                                       //  beide seit Block A wirkungslos, s. unten)
  }],
  "placements": [{                     // Editor-Spawn: handplatzierte Objekte
    "prefab": "Eiche1", "x": 20, "z": 12, "yaw": 0.5, "scale": 1.2,
    "einebnen": 7,                     // optional: Sockel-Radius (m) — Terrain
    "route": "wache-hafen",            // wird dort auf Mittelpunkthöhe geebnet
    "npc": {                           // optional: NPC läuft diese Route
      "name": "Sigrun",                // nur die ABWEICHUNGEN von der
      "rolle": "quest",                // Prefab-Vorgabe (s. „NPC-Einordnung")
      "fraktion": "wikinger",
      "stufe": 12,
      "quest": "verfuegbar"
    }
  }],
  "rivers": [{ "id": "fluss-1", "points": [[x, z], …], "width": 50, "depth": 8 }],
  "lakes":  [{ "id": "see-1", "x": 0, "z": 0, "radius": 420, "depth": 12 }],
  "routes": [{                         // NPC-Routen (s. unten)
    "id": "wache-hafen",
    "points": [[x, z], [x, z, 5], …],  // [x,z] läuft durch, [x,z,pause] wartet
    "mode": "loop",                    // loop = im Kreis | pingpong = hin und zurück
    "speed": 1.5                       // m/s (Default 1.5)
  }],
  "defaultSpawn": [0, 0]              // neutraler Welt-Start; je Fraktion
}                                      // zusätzlich continent.spawn
```

Grenzen (sanitize): Bbox ±40 km (Dungeon-Band + float32), ≤512 Regionen,
≤512 Polygonpunkte, ≤2000 Placements, ≤256 kuratierte Arten je Region,
≤256 Routen zu je ≤512 Wegpunkten,
`speed` geklemmt 0,2–10 m/s, Wegpunkt-`pause` geklemmt 0–600 s
(Unsinn → 0), unbekannter `mode` → `loop`, `npc.stufe` geklemmt 1–99,
`npc.name` auf 32 Zeichen gekürzt (leer → Feld weg), unbekannte
`rolle`/`fraktion`/`quest` werden WEGGELASSEN statt auf einen Standard
gezwungen — dann greift die Prefab-Vorgabe. Höhen der
Placements werden NIE gespeichert — sie folgen beim Spawnen dem Boden.

## Kuratierung je Biom

`region.vegetation` ist eine **exklusive** Liste: Steht eine Art darin,
wächst genau die — und sonst nichts. Eine leere Liste ist deshalb eine
Aussage („hier wächst nichts") und kein vergessenes Feld.

Die Vorräte, aus denen sich die Listen bedienen, stehen in
`shared/src/flora.ts` als benannte Bündel:

| Konstante | Landschaft |
| --- | --- |
| `GRASLAND_FLORA_NAMEN` | Wiese mit Laubwaldinseln (Eiche, Birke, Hasel, Findling) |
| `NADELWALD_FLORA_NAMEN` | Nadelwald — zugleich die Liste des Bioms `blackforest` |
| `SUMPF_FLORA_NAMEN` | Bruchwald: Weiden, Seggen, nasser Grund |
| `HOCHNORD_FLORA_NAMEN` | Kältesteppe, weite Abstände |
| `ASCHE_FLORA_NAMEN` | **leer** — der gesamte eigene Bestand ist nordisch-grün |

Der Schwarzwald bekommt kein eigenes Bündel: „Nadelwald" IST seine
Landschaftsform, und zwei Listen mit demselben Inhalt liefen nach der
ersten Änderung auseinander. Was ihn ausmacht, ist allein die Enge — das
regeln die Regler, nicht die Artenwahl.

**Warum das Feld inzwischen nicht mehr fehlen darf.** Der Streudurchlauf
(`shared/src/worldgen/streuung.ts`) prüft zwei Dinge nacheinander: erst die
Biom-Maske des Eintrags, dann das Kuratierungstor der Region. Bis Block A
trugen alle eigenen Einträge `Biome.Meadows` — als zweiter Riegel gedacht,
tatsächlich aber schädlich: Weil die Maske VOR dem Tor greift, wären vier
Regionen (blackforest, swamp, deepnorth, ashlands) trotz gefüllter
Kuratierungsliste vollständig kahl geblieben, ohne Fehlermeldung. Seit
`ALLE_BIOME` ist die Maske durchlässig und die Liste die alleinige
Autorität. Umgekehrt gilt seitdem: Eine Region **ohne** Liste bleibt kahl,
weil `FOLIAGE` nach dem Herausfiltern der Valheim-Einträge nur noch aus
eigener Flora besteht (73 Einträge) und eigene Flora ohne Kuratierung
ausgeschlossen ist. Die „Biom-Standardtabelle" aus `vegetation.pkg` gibt es
nicht mehr — alle 17 Regionen der Live-Welt sind deshalb kuratiert.

*Verworfen: jeder Pflanze eine handgepflegte Biom-Liste zu geben. Das wäre
eine Zuweisung je Eintrag mit nie endender Pflegelast, es bildet die
Kuratierung gröber
ein zweites Mal nach (Listen nennen ARTEN, Masken nur BIOME), und es kann
ihr widersprechen — wobei die stillere Wahrheit gewinnt. Genau daraus waren
die vier kahlen Regionen entstanden.*

**Doppelte Buchführung, auf die man achten muss:** Wer eine Art in eine
`*_FLORA_NAMEN`-Liste aufnimmt, braucht IMMER auch einen Streueintrag in
`flora.ts` — der ZoneManager streut nur über `FOLIAGE`. Ohne den Eintrag
wird das Modell nie gestreut, auch wenn es in der Kuratierungsliste steht.
Dagegen steht `server/test/h4-graslandflora.ts`.

## Editor (client/editor.html)

Der Editor läuft auf **beiden** Containern —
`editor.dev.world-of-vikings.com` und `editor.world-of-vikings.com`, beide
hinter Basic-Auth. *Bis 08/2026 gab es ihn nur auf dev, weil sein
Speicherweg an einer Vite-Middleware hing und Vite auf live nicht läuft.*

Moderne Shell (`client/src/editor/Shell.ts`): Werkzeugleiste, einklappbare
Seitenleisten-Sektionen, Viewport, Statusleiste (Meldung ≠ Koordinaten) und
die **Server-Konsole** als Dock (Griff ziehbar; ▁/◫/⬒ = minimiert/Standard/
volle Höhe; zeigt weiter `journalctl -fu wov-server`, geliefert wird der
SSE-Strom seit Block A aber vom Betriebsdienst `wov-admin` über
`GET /api/serverlog` — auf dev reicht ihn der Vite-Proxy durch, auf live
nginx).

Über der Werkzeugleiste liegt ein **Farbband mit Instanz-Schild**
(`Shell.instanzZeigen`): dev unauffällig und schmal, jede andere Instanz
breit und in Warnfarbe. Woher der Name stammt, ist nicht beliebig — er
kommt aus DERSELBEN Antwort wie das Dokument (`GET /api/worldlayout`,
Felder `instanz` und `datei`). Hostname und URL können lügen (Reverse-Proxy,
SSH-Tunnel, Kopie der Domain); der Betriebsdienst kann es nicht, weil er
`WOV_INSTANZ` genauso auflöst wie der Spielserver.

- **Formen-Menü:** Kreis, Oval, Langinsel, Halbmond, Zackenküste, Plateau —
  `FORMEN`-Registry in editorMain.ts, ein Eintrag = neue Form.
- **Polygon:** Punkte klicken; schließen per Startpunkt-Klick, ✓-Knopf oder
  Doppelklick; Esc bricht ab.
- **Regionen verformen:** Griffe der gewählten Region — Mittelpunkt
  verschiebt, Radius-Handle skaliert den Kreis, Polygonpunkte einzeln
  ziehen, Alt+Klick entfernt einen Punkt.
- **≈ Fluss zeichnen:** Verlauf klicken, Breite/Tiefe einstellen,
  Abschluss per ✓-Knopf oder Doppelklick. Seen und Flüsse stehen in der
  Gewässerliste und sind dort einzeln löschbar.
- **Bewuchs-Bündel (Preset-Knöpfe):** 🌾 Grasland, 🌳🌲 Mischwald,
  🌲 Nadelwald, 🌲🌲 Schwarzwald, 🌿 Sumpf, 🏔 Hoher Norden,
  🌋 Aschewüste — dazu „Nur Terrain und Gras" (leere Liste) und
  „↩ Biom-Standard" (Feld weg). Ein Knopf setzt nicht nur die Artenliste
  aus `flora.ts`, sondern ein **Preset**: Artenwahl, `forestDensity`,
  `bewuchsDichte`, Waldkörnung und Abstandsfaktor zusammen — ein Nadelwald
  mit der Körnung einer Wiese wäre ein Flickenteppich aus Fichteninseln.
  Die drei Regler darunter bleiben danach frei justierbar, das
  Freitextfeld ebenfalls. Die Werte sind gemessen, nicht geschätzt (die
  Zahl im Knopftitel ist die Überschirmung: lichter Hain 0.3, Wald 0.8,
  Schwarzwald 1.5+). Sumpf, Hoher Norden und Aschewüste kamen erst am
  16.08.2026 dazu — vorher gab es sie nicht als Knopf, ihre Regionen waren
  deshalb unkuratiert, und seit der Umstellung auf eigene Modelle heißt
  das: kahl. Ein Bündel ohne Knopf ist ein Bündel, das niemand benutzt.
- **Undo/Redo:** Strg+Z / Strg+Y (50 Schritte).
- **Vorschau:** derselbe mapWorker wie im Spiel (RegionGeo) — keine Drift.
- **Testflug:** öffnet `/?offline=1&layout=editor` (Entwurf via localStorage
  `wov-editor-layout`) — echtes Terrain, begehbar. **Er ist NICHT der Weg,
  auf dem man die Welt beurteilt** — siehe den eigenen Abschnitt unten.
- **Spawn-Editor im Testflug (Taste B):** durchsuchbare Prefab-Liste
  (Vegetation/Bauteile/alle), Drehung/Abstand/Größe, Geist-Vorschau an der
  Maus, Klick setzt, Ziehen verschiebt (Leuchtring), Entf löscht,
  Rechtsklick bricht ab bzw. gibt die Maus frei. „Untergrund einebnen"
  (rein manueller Haken, startet immer AUS) schreibt `einebnen` an die
  Platzierung (Radius = halbe Diagonale der Grundfläche + 1 m, damit auch
  Vorbauten und gedrehte Ecken auf der Platte stehen): RegionGeo zieht das
  Gelände im Radius auf die Mittelpunkthöhe, mit Böschung nach außen, und
  auf der ganzen Platte wächst kein Klutter-Gras. Das passiert LIVE —
  Setzen, Verschieben und Löschen planieren sofort (Sockel wird in die
  laufende Geo nachgerückt, betroffene Kacheln + Gras neu gebaut) und das
  Bauwerk snappt auf die Plattenhöhe; Neuladen/Server rechnen dieselbe
  Höhe.
  Bei einer gewählten FIGUR (Völva, Surtr, NPC_1) erscheint zusätzlich
  der Block „👤 Figur" mit Name, Rolle, Fraktion, Stufe und — nur bei
  Rolle `quest` — dem Quest-Zustand; siehe „NPC-Einordnung".
- **Routen-Editor im Testflug (Taste R):** NPC-Wegpunkte ins Gelände
  klicken statt Koordinaten zu tippen; die NPCs laufen die Route sofort
  als Vorschau ab — Bedienung siehe „NPC-Routen".
- **Leseweg (Start):** Der Editor holt das Dokument beim Öffnen per
  `GET /api/worldlayout` vom Betriebsdienst (`weltdokument.ts`,
  `holeWeltdokument`) — hinter einem Vorhang, damit niemand auf einem
  Stand zeichnet, der gleich ersetzt wird.
- **Speicherweg:** „💾 In die Welt speichern" schickt
  `POST /api/worldlayout` an denselben Dienst, der über
  `layoutDatei.layoutSchreiben` sichert und atomar schreibt. Der Knopf
  heißt auf dev so und auf jeder anderen Instanz `💾 Speichern → LIVE`;
  vorher steht eine Rückfrage mit Gegenüberstellung. Danach muss der
  Server neu starten, damit er die Welt lädt. Der JSON-Export bleibt als
  zweiter Weg (und als Sicherung vor riskanten Schritten), ist aber nicht
  mehr der einzige.

  *Bis 08/2026 stand hier „Publish: JSON-Export → `worldlayout.json` +
  Neustart", und der Editor-Entwurf lebte bis dahin nur im localStorage —
  als bekannte Lücke geführt (Docs/09, Punkt 13). Das ist erledigt, und es
  war keine Kosmetik: Der localStorage hängt am BROWSER, nicht an der
  Instanz. Derselbe Tab, der eben dev bearbeitet hat, konnte seinen
  Entwurf nach `live.json` schreiben, ohne `live.json` je gesehen zu
  haben. Am 16.08.2026 ist genau das passiert — 17 Regionen durch ein
  Testlayout mit 4 Regionen ersetzt; dass die echte Welt daneben in Git
  lag, war Glück und kein Verfahren.*

### Wenn Serverstand und Entwurf auseinandergehen

Der localStorage-Entwurf bleibt, weil er ein echtes Bedürfnis ist: Wer den
Tab schließt, will seine halbfertige Insel wiederfinden. Beide
naheliegenden Automatismen sind falsch — „localStorage gewinnt" ist der
alte Fehler, nur schriftlich; „Server gewinnt" wirft ungespeicherte Arbeit
still weg. Deshalb entscheidet der Nutzer, und zwar informiert
(`weltdokument.ts` rechnet, `AbgleichDialog.ts` zeigt):

| Fall | Verhalten |
| --- | --- |
| Server nicht erreichbar | Instanz bleibt UNBEKANNT (Warnband), Entwurf bleibt stehen, Dialog sagt: du fliegst blind |
| kein Entwurf im Browser | Serverstand, kommentarlos |
| Entwurf == Serverstand | Serverstand, kommentarlos |
| Entwurf ≠ Serverstand | **Frage**, mit der Gegenüberstellung vor Augen |

Die Gegenüberstellung zeigt Regionen- und Platzierungszahl **immer** — das
sind die beiden Zahlen, an denen man den Unfall vom 16.08.2026 gesehen
hätte — und nennt die Regionen zusätzlich **namentlich**: nur auf dem
Server / nur im Entwurf / beidseitig, aber verändert (Kennungen, ab 9
abgekürzt). Zahlen allein verschleiern den Fall „eine gelöscht, eine neu":
Der Zähler bleibt gleich, die Welt nicht. Alles Übrige — Kontinente,
Flüsse, Seen, Routen, Weltname, Detail-Seed — erscheint nur bei
Abweichung, damit die Zeilen, die dastehen, auch etwas bedeuten.

Kein Standardknopf und kein Esc-Ausweg: Beide Antworten
werfen etwas weg, also darf keine von beiden voreingestellt sein. Ein
dritter Knopf sichert den Entwurf vorher als JSON — der einzige Ausgang,
der nichts verliert. Weicht zusätzlich die Instanz ab, für die der Entwurf
gezeichnet wurde (`EntwurfsStand.instanz`), steht das als ausdrückliche
Warnung darüber.

## Der Testflug: wofür er taugt und wofür nicht

`/?offline=1&layout=editor` baut die Welt im Browser aus dem
localStorage-Entwurf. Er ist unverzichtbar zum Zeichnen — Spawn-Editor,
Routen-Editor und Routen-Vorschau leben nur dort — und er ist der
sinnvolle Ort für **Determinismus-Prüfungen der Weltgenerierung**: gleiche
Eingabe, gleiche Welt, ohne Server dazwischen.

**Er ist aber nicht der Weg, auf dem man die Welt beurteilt.** Er ist der
einzige Pfad, den kein Spieler je nimmt — und war zugleich der einzige,
auf dem hingesehen wurde. Genau daran sind Editor und Live-Welt
auseinandergelaufen: Man begutachtete monatelang eine Welt, die so nie
ausgeliefert wurde. Am 16.08.2026 gemessen:

| | Meshes | Materialien | Texturen |
| --- | --- | --- | --- |
| online (das, was Spieler sehen) | 311 | 39 | 65 |
| Testflug | 414 | 86 | 592 |

Der Unterschied ist kein Rundungsfehler, sondern eine andere Welt. Wer
beurteilen will, wie die Welt aussieht, schaut sie sich **online** an —
auf `play.dev.world-of-vikings.com` bzw. `play.world-of-vikings.com`, mit
Server, mit `WorldLayoutData`, mit dem Bestand, der tatsächlich
ausgeliefert wird. Der Testflug zeigt, ob die GEOMETRIE stimmt, nicht ob
das BILD stimmt.

## MCP-Server (tools/worldlayout-mcp)

In `.mcp.json` eingebunden; KI-gestützter Weltbau im Gespräch:
`layout_get`, `region_set`, `region_delete` (sanitize-gesichert),
`layout_probe` (Höhe/Biom/Region wie der Spielserver) und `layout_deploy`
(systemd-Neustart von `wov-server`; der Start dauert seit der Abschaltung
der Locations ~2 s). Er arbeitet auf `weltDatei(WURZEL)`, also auf der
Datei der Instanz, in der er läuft, und schreibt über dieselbe
`layoutDatei.layoutSchreiben` wie der Betriebsdienst — daher auch dieselbe
Sicherung (`<instanz>.json.<ts>.bak`, letzte 10) und dieselbe
Byte-Darstellung. *Vorher trug er seine eigene Kopie dieses Ablaufs; sie
fing einen Fehler beim Sichern ab und schrieb trotzdem — genau der Fall,
in dem man die Sicherung gebraucht hätte.*

## Betrieb

- Modus: `server/data/server.yml` → `world.mode: layout`. **Die Schlüssel
  `world.layout` und `world.world` gibt es nicht mehr** — Weltdokument und
  Spielstand folgen aus `WOV_INSTANZ` (s. „Datenfluss"). server.yml ist
  damit umgebungsfrei und darf mitdeployed werden; genau das war vorher
  unmöglich.
- Ebenfalls in server.yml und für BEIDE Instanzen gleich, weil es eine
  Projektentscheidung ist und kein Umgebungsunterschied:
  `world.features: false` und `dungeons.enabled: false` (siehe
  „Fortschritt & Progression").
- Vier Domains: `play.world-of-vikings.com` (live, offen),
  `editor.world-of-vikings.com` (live, Basic-Auth),
  `play.dev.world-of-vikings.com` und `editor.dev.world-of-vikings.com`
  (dev, Editor mit Basic-Auth). In nginx sperrt eine `map $host`-Weiche
  `/editor.html` und `/api/` auf allem außer dem Editor-Host — die
  Basic-Auth hängt im Proxy am HOST, nicht am Pfad.
- Dienste: drei systemd-Units, auf beiden Containern identisch —
  `wov-server`, `wov-client`, `wov-admin`. `npm run service:*` fasst
  Start/Stop/Status zusammen.
- Ausrollen: `tools/wov-update.sh` (ersetzt das gelöschte
  `tools/deploy.sh`): `/etc/wov.env` lesen, Abbruch bei schmutzigem
  Arbeitsbaum, `git pull --ff-only origin main`, Dienste stoppen,
  `npm ci --include=dev`, typecheck und Tests OHNE Pipe, auf live
  Client-Build nach `dist.neu` mit Tausch, Dienste starten,
  Gesundheitsprüfung bis 120 s auf HTTP 426 an Port 2467.
- Tests (Runner `scripts/run-tests.mjs`, Docs/09 P26): `npm test` fährt die
  Kernliste (20 Dateien), `npm test -- --alle` zusätzlich die drei langen
  Läufe. Für dieses Dokument einschlägig: `shared/test/worldlayout.ts`,
  `shared/test/region-geo.ts`, `server/test/h1-layout.ts`,
  `server/test/h2-routen.ts`, `server/test/h3-routen-vorschau.ts`,
  `server/test/h4-graslandflora.ts` sowie die beiden neuen —
  `admin/test/betriebsdienst.ts` (der Speicherweg darf die Welt nicht
  beschädigen) und `client/test/welt-abgleich.ts` (die Abgleichlogik gegen
  das echte Bestandsdokument, DOM-frei).

## NPC-Routen

> **Im Testflug laufen die NPCs sofort** — als Vorschau, siehe unten.
> **In der echten Welt** laufen sie erst, wenn der Entwurf in der
> Weltdatei steht und der Server neu gestartet ist: Gelaufen wird dort auf
> dem SERVER. Der Knopf „💾 In die Welt speichern" liegt sowohl im
> Karten-Editor als auch im Routen-Panel des Testflugs (Taste R); beide
> schreiben über `POST /api/worldlayout` dieselbe Datei.


Eine Route ist eine benannte Folge von Wegpunkten; eine Platzierung
verweist per `route` darauf und läuft sie dann ab. Sie steht bewusst IM
Layout-Dokument: Wegpunkte sind Weltdesign wie Flüsse und Platzierungen
und nehmen so Sanitisierung, Editor/MCP und Deploy mit.

- **Bewegt wird auf dem SERVER** (`server/src/world/RoutenLaeufer.ts`) —
  er ist autoritativ, der Client bekommt nur das Ergebnis über den
  normalen ZDO-Sync. Die Wegpunkte selbst gehen nie an den Client.
- **Die Wegmathematik steht in `shared`**
  (`shared/src/worldlayout/routenlauf.ts`, Klasse `RoutenLauf`): reine
  xz-Rechnung ohne ZDO, Welt oder Babylon — Fortschritt entlang der
  Punkte, Verteilen der Schrittweite über mehrere Wegpunkte, Umkehr,
  Rundlauf, Einstieg am nächstgelegenen Punkt, Blickrichtung. Server
  (`RoutenLaeufer`) und Testflug-Vorschau (`RoutenVorschau`) benutzen
  denselben Code; `server/test/h3-routen-vorschau.ts` vergleicht beide
  Frame für Frame. Eine Vorschau, die anders rechnet als der Server, wäre
  schlimmer als keine.
- **Höhe immer aus `getGroundHeight`**: Der NPC folgt dem Gelände, auch
  wenn sich das Layout später ändert. Deshalb steht in der Route (wie in
  den Platzierungen) kein Y.
- **`loop`** schließt vom letzten zum ersten Punkt, **`pingpong`** kehrt an
  den Enden um. Eine Route mit nur EINEM Wegpunkt ist der Standposten:
  Der NPC läuft hin und bleibt dort (`pruefeLayout` weist darauf hin).
- **Pause je Wegpunkt**: `[x, z]` läuft durch, `[x, z, pause]` hält dort
  `pause` Sekunden an (0–600, `ROUTE_MAX_PAUSE`). Die Zeit hängt am PUNKT
  statt in einem parallelen Feld — jede Editor-Operation verschiebt
  Wegpunkte, und ein zweites Array müsste bei jeder mitgezogen werden;
  genau dort entstehen Versätze. Alte Dokumente bleiben wörtlich gültig
  (kein drittes Element = keine Pause), und der Sanitizer schreibt einen
  Punkt ohne Pause auch wieder ohne drittes Element (stabiler
  Round-Trip); Unsinn und negative Werte werden zu 0, zu große geklemmt.
  Während der Pause läuft `idle`, und die **Blickrichtung friert ein** —
  ein NPC, der sich beim Warten schon zum nächsten Punkt dreht, wirkt
  nervös. Bei `pingpong` wartet der Umkehrpunkt genau EINMAL, obwohl Hin-
  und Rückweg ihn berühren: Das Weiterschalten auf den nächsten Wegpunkt
  hängt am ENDE der Pause, nicht an der Ankunft — der Punkt kann also gar
  nicht ein zweites Mal auslösen. Ein Tick darf beliebig lang sein: Er
  arbeitet Pausen und Wegstücke der Reihe nach ab (Zeitbudget statt
  Schrittweite), verschluckt also keine Pause und verdoppelt keine.
- **Simuliert wird nur mit Spieler in der Nähe** (`SPAWN_SIM_RADIUS`),
  die ZDO-Revision steigt gedrosselt mit 4 Hz — beides wie bei den
  Kreaturen. Ein Routen-NPC wird dabei aus der Kreatur-Simulation
  entlassen, sonst zöge die Wander-KI an derselben Position.
- **Wiedererkennung über die Kennung**: Platzierungen werden beim Boot
  über den ZDO-Member `layoutId` wiedergefunden, nicht mehr nur über die
  Nähe zum Eintrag — ein Routen-NPC steht beim nächsten Start ja irgendwo
  auf seiner Runde.
- **Animation**: Der Server schreibt den Bewegungszustand in den
  ZDO-Member `anim` (`idle`/`walk`, nur bei Wechsel). Der Client startet
  die gleichnamige AnimationGroup der Instanz
  (`AssetManager.wechsleAnimation`, Teiltreffer ohne Groß-/Kleinschreibung
  — `walk` trifft damit auch `Walking`). Fehlt die Gruppe im Modell,
  stoppt nur die laufende Animation; die Bewegung hängt nicht daran.

Ausprobieren ohne animiertes Modell: eine Platzierung `NPC_1` (Gruppe
`Walking`) auf eine Route setzen — sie läuft und wechselt beim Halt auf
`idle`, wo mangels Gruppe schlicht nichts mehr abgespielt wird.

### Routen zeichnen (Testflug, Taste R)

`client/src/editor/RoutenEditor.ts` — Wegpunkte werden ins Gelände
geklickt, nicht ins JSON getippt. Geschrieben wird in denselben
localStorage-Entwurf wie die Platzierungen (`wov-editor-layout`), Feld
`routes`, in genau dem Schema, das `sanitizeWorldLayout` durchlässt.

1. **V** (Baumodus) einschalten und hochsteigen — von oben zeichnet es
   sich am besten; die Kamera darf im Testflug bis 120 m heraus.
2. **R** öffnet das Panel (links; das Spawn-Panel liegt rechts, beide
   dürfen gleichzeitig offen sein). Die Maus wird dabei freigegeben.
3. **+ Neue Route** legt eine Route mit Vorgabe-Kennung `route-1`,
   `route-2` … an (ID-Muster der Sanitisierung) und schaltet das Setzen
   sofort scharf.
4. **Klick aufs Gelände** hängt einen Wegpunkt an — in Klickreihenfolge.
   Jeder Punkt bekommt einen Pfosten (erster Punkt grün), dazwischen
   läuft eine Linie, die alle 4 m auf die Geländehöhe gelegt wird; bei
   `loop` auch vom letzten zum ersten Punkt. Nicht gewählte Routen
   stehen blau daneben.
5. **Kennung/Modus/Tempo** im Panel einstellen. Umbenennen zieht die
   Zuweisungen der Platzierungen mit; eine ungültige oder doppelte
   Kennung wird abgelehnt statt stillschweigend zurechtgebogen.
6. **✎** schaltet das Setzen an/aus, **↩** nimmt den letzten Wegpunkt
   zurück, **🗑** löscht die Route (samt der Verweise darauf).
   Einen Wegpunkt der GEWÄHLTEN Route kann man anklicken und ziehen.
7. **Pausen:** Die Wegpunktliste im Panel zeigt jeden Punkt als
   „3 · 12/−4 · 5 s" — die Wartezeiten sind also ablesbar, ohne jeden
   Punkt einzeln anzuklicken. Ein Klick auf die Zeile (oder das Anfassen
   des Punkts in der Welt) wählt ihn; darunter trägt „Pause am gewählten
   Punkt (s)" die Wartezeit ein, 0 nimmt sie wieder weg. Haltepunkte
   stehen in der Welt als **dicke rote Pfosten** statt als schlanke gelbe,
   sind also schon aus der Übersicht zu erkennen. Verschieben behält die
   Pause.
8. **Zuweisen:** die Platzierung in der Welt anklicken (sie wird
   gegriffen, Leuchtring), dann im Routen-Panel **→ zuweisen**; **×
   lösen** nimmt die Zuweisung wieder weg. Ein NPC ohne Route steht.

### Vorschau: die Route im Testflug ablaufen sehen

`client/src/editor/RoutenVorschau.ts` — sobald eine Platzierung eine
Route hat, läuft sie sie **sofort im Testflug** ab, ohne Speichern und
ohne Serverneustart. Nur dort (`?offline=1&layout=editor`); online bewegt
ausschließlich der Server, im normalen Offline-Spiel gibt es keinen
Entwurf.

- **Gleiche Rechnung wie der Server** (`RoutenLauf` aus `shared`), Höhe je
  Schritt aus `getGroundHeight`, Blickrichtung aus der Bewegung, Gangart
  `idle`/`walk` über `AssetManager.wechsleAnimation` — also genau das
  Bild, das die gespeicherte Welt später zeigt.
- **Live**: Wegpunkt gesetzt oder gezogen, Route zugewiesen/gelöst, Tempo
  oder Modus geändert — die Vorschau übernimmt es innerhalb von 0,2 s
  (sie klopft den localStorage-Entwurf ab). Wird eine Route **gelöst**,
  bleibt der NPC stehen, wo er ist (`idle`).
- **Beim Verschieben eines Wegpunkts** behält der NPC sein Ziel und zieht
  zur neuen Stelle; kommt ein Wegpunkt dazu oder fällt einer weg, steigt
  er am nächstgelegenen Punkt neu ein.
- **Griff schlägt Vorschau**: Eine mit der Maus gegriffene Platzierung
  hält an und folgt dem Zeiger — man soll nicht an etwas ziehen, das sich
  unter der Hand fortbewegt. Beim Loslassen läuft sie an der neuen Stelle
  weiter.
- **▶ Vorschau: AN/AUS** im Routen-Panel (Vorgabe AN). Beim Ausschalten
  kehren alle NPCs auf ihren gespeicherten Platz zurück — dort greift der
  Editor sie an, und dort stehen sie in der Weltdatei.

Abgrenzung zum Spawn-Editor: Zeichnen und Prefab-Platzieren schließen
einander aus — wer ✎ drückt, beendet den Platzier-Modus (der Geist
verschwindet), und ein Klick in der Prefab-Liste beendet das Zeichnen.
**Esc** beendet das Zeichnen, **Rechtsklick** verwirft wie gewohnt
alles. Die Marker/Linien sind nur bei offenem Panel sichtbar.

## NPC-Einordnung: Fraktion, Rolle, Quest-Zustand

Datenmodell: `shared/src/npc.ts` — `Fraktion`, `NpcRolle`,
`QuestZustand`, `NpcDef` (was an der Platzierung steht),
`NpcEinordnung` (vollständig aufgelöst), `haltungZwischen()`,
`questZeichen()`.

- **Ob ein NPC angreift, steht nicht am NPC**, sondern ergibt sich aus dem
  Verhältnis der Fraktionen (`haltungZwischen`). Ein Feld „feindlich"
  am Exemplar müsste bei jeder Weltänderung überall nachgepflegt werden,
  und Sachse↔Wikinger ist nicht dasselbe wie Sachse↔Wolf.
- **Vorgaben je Prefab** stehen in `NPC_VORGABEN` (ebenfalls `npc.ts`):
  Surtr = `monster`/`muspel`, Völva = `quest`/`wikinger`, NPC_1 =
  `zivil`/`wikinger`. Bewusst NICHT in `prefabs.ts` — dort stehen
  Render-Hinweise (Sprite, GLB, Licht), und `npc.ts` bleibt so
  abhängigkeitsfrei (Sanitizer, Editor und Schild ziehen nicht die
  3.700-Einträge-Registry mit). Ein Eintrag hier ist zugleich die
  Antwort auf „ist das eine Figur?" (`istNpcPrefab`) — neue Modelle
  gehören dort ergänzt, sonst zeigt der Editor ihre Felder nicht.
- **Aufgelöst wird an genau einer Stelle**: `loeseNpcAuf(prefab, npc)` —
  Platzierung schlägt Vorgabe, Ungesetztes erbt, alles andere fällt auf
  „ziviler Neutraler, Stufe 1, keine Quest". Niemand sonst darf
  `?? 'zivil'` schreiben.
- **Im Dokument stehen nur die Abweichungen.** Ein Eintrag ohne `npc`
  behält keinen — der Round-Trip ist stabil, und **beide** Weltdateien
  (`welten/dev.json`, `welten/live.json`; live führt 17 Regionen und 159
  Platzierungen) gehen bytegleich durch den Sanitizer (Test in
  `shared/test/worldlayout.ts`).

**Zum Client — ohne ein einziges zusätzliches Byte pro Tick:**

- *Online*: Der Server setzt beim Spawnen ohnehin den ZDO-Member
  `layoutId` (`LAYOUT_ID_MEMBER`, Wert `layoutKennung(p)` =
  `Prefab@x,z`); er wandert mit einem laufenden NPC mit. Der Client hat
  das Weltdokument ohnehin (Paket `WorldLayoutData`) und baut daraus die
  Tabelle Kennung → `NpcEinordnung` (`main.ts`, `buildWorld`) — der
  `EntityManager` verknüpft beides beim ZDO-Update
  (`setzeNpcQuelle`/`npcEinordnung`). Name, Rolle und Stufe ändern sich
  nie; sie in jeden Positions-Tick zu legen wäre der naheliegende, aber
  teure Weg.
- *Editor-Testflug* (`?offline=1&layout=editor`): Dort gibt es weder
  Server noch Kennung — `zeige()` löst die Einordnung direkt aus dem
  Entwurf auf und hängt sie ans Update. Damit sieht der Zeichner jede
  Änderung sofort am Schild. Der Vorschau-Geist an der Maus bekommt
  bewusst keines.

**Bedienung (Spawn-Panel, Taste B):** Der Block „👤 Figur" erscheint nur
für die GEWÄHLTE Platzierung und nur, wenn ihr Prefab eine Vorgabe hat —
für Bäume und Steine bleibt das Panel wie es war. Wählen = anklicken (der
Griff, mit dem man auch verschiebt und löscht); eine frisch gesetzte
Figur ist sofort gewählt. Felder: Name (leer = Vorgabe, als Platzhalter
sichtbar), Rolle, Fraktion, Stufe, und **nur bei Rolle `quest`** der
Quest-Zustand. Gespeichert wird ausschliesslich, was von der Vorgabe
abweicht; wer alles zurückstellt, verliert das `npc`-Feld wieder.

## Fortschritt & Progression

`region.tier` (0–5) ersetzt die Weltzentrums-Distanzen der Radialwelt:
In einer Region entstehen nur Locations bis zu ihrer Stufe
(`tierAusDistanz` übersetzt `feature.minDistance`). Führt eine Region
eigene `locations`, gilt ausschließlich diese Liste.

> **Seit 16.08.2026 liegt dieser ganze Mechanismus still.** Mit dem
> Verzicht auf Valheim-Modelle steht `world.features` auf `false` und
> `dungeons.enabled` ebenso: Alle 146 Einträge in `FEATURES` waren
> Valheim-Exporte, keiner steht in `EIGENE_MODELLE`. Gebucht würden sie
> trotzdem — jede Instanz legte ZDOs an, die der Client nicht darstellen
> kann, und der Spieler liefe durch unsichtbare Grabhügel. *Verworfen:
> sie nur clientseitig auszublenden; dann stünden die Geister-ZDOs
> weiterhin im Save und passten später nicht mehr zu der Buchung, die mit
> eigenen Modellen entsteht.* Ebenso gefiltert: `SPAWN_TABLE` (3 → 0),
> Bau-Pieces (9 → 2), die `model`-Felder der Gegenstände (25 → 0) und
> `FOLIAGE` — dort fielen alle 120 Einträge aus Valheims `vegetation.pkg`
> weg, übrig sind die 73 eigenen aus `shared/src/flora.ts`.
>
> **Die Folge, die klar dastehen muss:** Bis eigene Modelle vorliegen,
> kann im Spiel weder GEBAUT noch GEKÄMPFT werden. Das ist ein bewusst
> gewählter Zwischenzustand, kein Defekt. `region.tier`, `locations` und
> `spawns` bleiben im Schema stehen und greifen wieder, sobald eigene
> Location- und Kreaturenmodelle da sind.

`pruefeLayout()` meldet unbekannte Vegetations-/Location-/Spawn-Namen und
fehlende Startpunkte — die Befunde stehen im Boot-Log. Die Live-Welt ist
am 16.08.2026 neu entstanden (Weltschnitt): 17 Regionen, 159
Platzierungen, alle 17 Regionen kuratiert, **0 unbekannte Prefabs**.

## Bewusst offen

Eigene Location-, Bau- und Kreaturenmodelle — solange die fehlen, bleiben
`world.features` und `dungeons.enabled` aus, und Bauen wie Kämpfen liegen
still. Ferner: Karten-Zoomstufen ab ~40 km, Prefab-Vorschaubilder im
Spawn-Panel, Flora für die Aschewüste (`ASCHE_FLORA` ist leer, weil der
gesamte eigene Bestand nordisch-grün ist), Fraktions-Gameplay
(Zugehörigkeit, PvP-Regeln) über die Startpunkte hinaus. Siehe
Docs/09-Verbesserungsvorschlaege.md.
