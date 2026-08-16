# Verbesserungsvorschläge (Projekt-Review)

> **Diese Liste ist ein Befund, keine Arbeitsliste.** Sie hält fest, was eine
> Durchsicht am 04.08.2026 gefunden hat, und was daraus geworden ist. Die
> führende Aufgabenliste des Projekts wird inzwischen außerhalb des Repos
> geführt; diese Datei ist ihr Repo-interner Vorgänger. Erledigtes wird
> **mit Datum gekennzeichnet statt gelöscht** — sonst bliebe von einem
> Review nur die Behauptung übrig, es habe mal einen gegeben.

> **Stand 16.08.2026**
>
> **Abgearbeitet:** 1–16 **außer 3**, 18, 19, 20, 21, 22, 26 (bis auf CI), 27, 29,
> 30 (bis auf Kleinigkeiten), 32 (bis auf die stille Verdrängung im
> RegionField) sowie die Reste von 12 (Save asynchron D8, TerrainOps
> verdichtet D9 — beides 15.08.2026).
>
> **Zurückgestellt:** 17 (Accounts/Identität — erst vor dem Live-Gang
> nötig, Entscheidung des Projektinhabers).
>
> **Offen:** 3 (`everyone-admin: true` — und seit Block A gilt dieselbe
> `server.yml` auch auf live), 23, 24 (schlimmer geworden:
> `client/src/main.ts` hat heute 2553 statt 1763 Zeilen), 25, 28
> (Typecheck steht, lint/format nicht), 31.
>
> **Was Block A (16.08.2026) beigetragen hat:** die Endfassung von 6
> (drei versionierte Units, auf beiden Containern identisch) und 13
> (**ein** Schreibweg auf das Weltdokument), dazu Teile von 27, 28 und
> 30. Einzelheiten stehen bei den Punkten.
>
> **Stand 04.08.2026 (Original-Kopfzeile, zum Vergleich):** abgearbeitet
> 1–16, 18, 19, 21, 22, 26, 27, 29, 30 (teils), 13; offen 20, 23, 24, 25,
> 28, 31, 32 sowie die Reste von 12 und 30.

Stand: 04.08.2026 — Ergebnis einer systematischen Durchsicht von Server/Shared
(58 Dateien), Client (53 Dateien, 20.282 Zeilen) und Infrastruktur/Tests/Docs.
Priorisiert in Kritisch / Wichtig / Editor & UX / Qualität & Betrieb.
Datei:Zeile-Angaben sind Stand der Durchsicht und können wandern.

**Empfohlene Reihenfolge:** Zuerst der Sicherheits-Dreier (1, 2, 4) plus die
Betriebs-Handgriffe (5, 6) — ein Tag Arbeit, beseitigt die Existenzrisiken.
Danach als eigener Block das Server-Inventar (8), das Bauen/Essen/Abriss/
Editor-Rechte auf einmal auf solide Füße stellt.

*(So ist es gelaufen — mit einer Ausnahme: Punkt 3 blieb liegen, siehe
dort.)*

---

## 🔴 Kritisch — Sicherheit & Datenverlust

1. **Pakete werden vor der Authentifizierung verarbeitet**
   (`server/src/net/NetManager.ts:114-142`): `handlePacket` routet jeden Typ
   ohne `peer.authenticated`-Prüfung — ein frischer Socket kann sofort
   `Attack`, `SetTimeOfDay`, `DungeonEditSave` senden.
   → Auth-Gate vor dem Switch (`VersionCheck`/`PasswordAuth` ausgenommen).

2. **Ein defektes Paket beendet den Serverprozess**
   (`server/src/io/Stream.ts:31-37` wirft, `NetManager.handlePacket` und
   `WovServer.onPacket` fangen nicht, kein `uncaughtException`-Handler in
   `server/src/main.ts`). Ein 1-Byte-Paket ist ein DoS.
   → try/catch pro Paket mit Peer-Disconnect + globaler Handler.

3. **`everyone-admin: true` ist Produktivzustand**
   (`server/src/WovServer.ts:100`, `server/data/server.yml`): Jeder Client
   darf spawnen, teleportieren, Dungeons löschen, Dateien via Editor-Save
   schreiben. → userId-basierte Admin-Liste; everyone-admin nur im Dev.
   ⬜ **weiterhin offen** (geprüft 16.08.2026): `server.yml` steht
   unverändert auf `everyone-admin: true`, `NetManager` setzt
   `peer.isAdmin` daraus, und `AdminCommands` schreibt selbst, dass der
   Admin-Modus damit ungeschützt ist. Neu ist die Schärfe der Lage:
   `server.yml` ist seit Block A **umgebungsfrei** und wird auf beide
   Container ausgerollt — der Wert gilt also für live genauso wie für
   dev. Die im Punkt vorgeschlagene Trennung („everyone-admin nur im
   Dev") wäre heute kein Datei-Unterschied mehr, sondern müsste an
   `WOV_INSTANZ` hängen oder an einer Admin-Liste.
   *(Die Kopfzeile vom 04.08.2026 zählte diesen Punkt zu 1–16 und damit
   zu den abgearbeiteten. Das war er nicht.)*

4. **Kampf/Ernte/Abriss ohne Reichweite und Besitz, Input ungeklemmt**
   - `handleAttack` (`WovServer.ts:1227-1252`) und `handleHarvest`
     (`:1286-1319`) wirken an der CLIENT-Position ohne Abgleich mit
     `peer.position` → weltweites Töten/Abbauen; kein Schlag-Cooldown.
   - `handleRemovePiece` (`:1032-1058`): kein Distanz-Check, Besitz nur
     `spieler==1` statt userId → jeder reißt jedes Spielerbauwerk ab
     (mit Materialgewinn). → `owner`-Member + Rechte-/Reichweitenprüfung.
   - `handlePlayerInput` (`:870-954`): `moveX/moveZ/moveY` ohne
     `Number.isFinite`/Clamp — NaN/1e9 vergiftet Position und Save.

5. **Kein Git-Remote** — 25+ Commits existieren nur auf dieser Platte
   (`git remote -v` leer). → privates Remote anlegen, regelmäßig pushen.
   ✅ **erledigt** — `origin` steht; seit 16.08.2026 ist das Remote
   zugleich der Auslieferungsweg: Beide Container ziehen `origin main`
   per `tools/wov-update.sh`. Was auf live läuft, sagt seither der
   Commit und nicht mehr der, der zuletzt deployt hat.

6. **npm-Scripts/Units steuern das falsche Projekt**
   - Root-`package.json` `service:*`-Scripts zeigen auf `valheim.target` —
     `npm run service:restart` im wov-Repo startet valheim-babylon neu.
   - Die laufenden wov-Units (`/etc/systemd/system/wov-*.service`,
     `wov.target`) sind nicht versioniert; `deploy/systemd/` enthält noch
     die valheim-Units mit alten Ports; `deploy/install-services.sh` ebenso.

   ✅ **erledigt, Endfassung 16.08.2026 (Block A):** `deploy/systemd/`
   trägt genau drei Units — `wov-server` (2467), `wov-client` (5274),
   `wov-admin` (2468) — plus `wov.target`, und sie sind auf dev und live
   Zeichen für Zeichen identisch. Der Unterschied steckt allein in
   `/etc/wov.env`, das `install-services.sh` anlegt, aber nie
   überschreibt. Die `service:*`-Scripts zeigen auf `wov.target`.

7. **Save-/Layout-Schutz fehlt**
   - `WorldManager.load()` verwirft den Save bei Seed-/Version-Mismatch
     still → nächster Autosave überschreibt ihn. → als
     `.orphan-<ts>` wegbenennen statt freigeben.
   - `worldlayout.json` hat keine Backup-Rotation (MCP `schreibe()` nur
     tmp+rename) → zeitgestempelte `.bak`-Kopien, letzte 10 behalten.
   - Ein geändertes Layout verschiebt Terrain unter bestehenden ZDOs ohne
     Warnung → Layout-Hash in die Save-Meta und beim Laden prüfen
     (`WovServer.ts:249-252` vs. `WorldManager.ts:131-136`).

   ✅ Sicherung mit Rotation liegt seit 16.08.2026 an genau einer Stelle:
   `shared/src/worldlayout/layoutDatei.ts` — dieselbe Prüfung, dieselbe
   Sicherung, dieselbe Byte-Darstellung für jeden Verwender. Die
   zeitgestempelten `.bak`-Kopien liegen neben dem Weltdokument.

---

## 🟠 Wichtig — Architektur & Stabilität

8. **Inventar/Crafting sind Client-Trust** (dokumentiert
   `WovServer.ts:1003-1004`, `:1202-1205`): Items frei erfindbar, Bauen
   kostenlos/unbegrenzt (ZDO-Spam → RAM), `handleEat` ohne Besitzprüfung.
   `shared/src/items/Inventory.ts` wird serverseitig nirgends benutzt.
   → Server-Inventar pro Peer, Rezepte/Kosten server-autoritativ,
   Piece-Budget pro Spieler. Größter Einzelposten fürs MMORPG.

9. **Reconnect leakt die komplette Welt** (`client/src/main.ts:404`):
   `buildWorld` hat keine Guard — erneutes Verbinden erzeugt Terrain,
   Physik, Entities, Karten-Engine doppelt, alte Instanzen/Sockets werden
   nie disposed. Kein Auto-Reconnect (`GameSocket.ts:114-127`).
   → idempotentes `buildWorld` + `teardownWorld()` + Backoff-Reconnect
   mit Overlay.

10. **Shader-Fehler-Ursache: Licht-Uniforms** —
    `client/src/engine/LightPool.ts:52-56` hebt `maxSimultaneousLights`
    global auf 8 für ALLE Materialien (auch künftige); mit CSM-Kaskaden
    sprengt das WebGL2-Uniform-Limits („Unable to compile effect", ~196
    Fehler pro Sitzung), ohne Fallback (Material bleibt schwarz).
    → Pool auf 4, Limit nur nahe Fackeln, Compile-Error-Fallback.

11. **Keine Rate-Limits, kein Heartbeat** — Chat ohne Längen-/
    Frequenzlimit (`WovServer.ts:965-983`), unbegrenzt viele
    unauthentifizierte Sockets, `Peer.ping` wird nie aktualisiert,
    `players.timeout` wirkungslos → halboffene Peers bleiben ewig.

12. **ZDO-Sync/Save teuer** — 81 Zonen je Peer alle 50 ms mit
    Array-Kopien (`ZDOManager.ts:165`), kein Byte-Budget je Tick;
    `saveWorld` synchron im Main-Thread (`WorldManager.ts:96-103`);
    `terrainOps` wachsen unbegrenzt und gehen komplett an jeden neuen
    Peer. → Iteratoren/Dirty-Queues, Save im Worker, TerrainOps zu
    Zonen-Deltas verdichten. Ebenso `getZDOsInRadius`-Allokationen in
    heißen Pfaden (Attack/Harvest/Interact/Boss-Check r=60).

    ✅ **Reste erledigt 15.08.2026:** D8 schreibt den Weltsave asynchron
    in einen zstd-Strom, D9 verdichtet das Terraforming zum Endzustand
    statt zur Operationsliste; D6/D7 gaben dem ZDO-Sync ein
    Bandbreitenbudget und Nahpriorität. Tests: `server/test/d8-save-async.ts`,
    `d9-terrain-verdichtung.ts`, `d6-zdo-delta.ts`.

13. **Editor und MCP schreiben in verschiedene Töpfe** — editor.html
    persistiert nur localStorage + manueller Download, der MCP-Server
    schreibt `server/data/worldlayout.json` direkt. → kleiner
    Save-Endpoint (Vite-Middleware `POST /api/worldlayout` mit
    sanitize) als gemeinsame Quelle. Zudem hinterlassen gelöschte
    `placements` ihre ZDOs (`WovServer.ts:393-423`) → `layoutId`-Member
    je ZDO und Abgleich beim Boot.

    ✅ **erledigt, Endfassung 16.08.2026 (Block A).** Die damals
    vorgeschlagene Vite-Middleware war der halbe Weg und hat sich als zu
    kurz erwiesen: Vite läuft nur auf dev, auf live gab es den Endpunkt
    gar nicht — der Editor konnte dort nicht speichern. Beide Endpunkte
    liegen jetzt im Betriebsdienst `admin/` (Port 2468), auf dev proxyt
    Vite dorthin, auf live nginx. Geschrieben wird ausschließlich über
    `shared/src/worldlayout/layoutDatei.ts`. Dazu hat der Editor endlich
    einen **Leseweg** bekommen: Er holt das Dokument beim Start per GET
    und stellt einen abweichenden localStorage-Entwurf gegenüber, statt
    ihn blind darüberzuschreiben. Anlass war ein realer Verlust am
    16.08.2026 (17 Regionen durch ein 4-Regionen-Testlayout ersetzt);
    dass die echte Welt daneben in Git lag, war Glück und kein
    Verfahren. `client/test/welt-abgleich.ts` hält den Fall fest.
    `server/data/worldlayout.json` gibt es nicht mehr — an seiner Stelle
    stehen `server/data/welten/dev.json` und `live.json`.

14. **Boot-Placement dauert Minuten** (Layout-Modus ~2–5 min,
    `ZoneManager.ts:733-919`): lineare Similar-Scans, Terrain-Deltas vor
    billigen Gates, Ergebnis wird trotz Determinismus jedes Mal neu
    gewürfelt. → Grid-Index, Gate-Reihenfolge, Platzierung in den Save.

15. **Singleton blockiert Multi-World/Housing** — globaler
    ZDOManager/ZoneManager/Geo pro Prozess, `Wov()`-Singleton;
    Dungeon-Band als Koordinaten-Workaround an ≥6 Stellen.
    → `WorldContext`-Objekt als Einheit (war Phase 6 des Umbau-Plans).

16. **Dungeon-Höhe kommt vom Client** (`WovServer.ts:923-936`, moveY
    absolut) — serverseitige Boden-Ebenen je Raum wären genug.

17. **Schwache Identität** — Name/userId frei vom Client, `savedPlayers`
    per Name übernehmbar; Passwort = 32-Bit-Hash, replaybar
    (`NetManager.ts:52,156-200`). → Token-/Account-Layer, Challenge.

---

## 🟡 Editor & UX

18. **Kein Undo/Redo im 2D-Editor** — Region löschen ist endgültig;
    `layout` wird bereits immutabel ersetzt, ein Snapshot-Stack mit
    Strg+Z/Y kostet ~20 Zeilen (`editorMain.ts:619-623`).

19. **Regionen nach dem Zeichnen nicht editierbar** — kein Verschieben,
    keine Polygon-Punkt-Handles, kein Radius-Feld in der Seitenleiste
    (Kreisradius fest 1500 bei Anlage).

20. **Statuszeile wird von jedem pointermove überschrieben**
    (`editorMain.ts:342`) — Fehlermeldungen („Import verworfen",
    Worker-Fortschritt) verschwinden beim ersten Mauswackeln.
    → getrennte Koordinaten- und Meldungszeile mit Timeout.
    ✅ **erledigt 04.08.2026** mit der Editor-Shell: `Shell.ts` trennt
    Meldung und Koordinaten; `statuszeile` in `editorMain.ts` ist nur
    noch ein Shim, der bestehende `.textContent`-Aufrufer auf
    `shell.meldung()` umlenkt.

21. **3D-Spawn: localStorage-Vollzyklus pro Mausereignis**
    (`main.ts`, Drag-Pfad): JSON.parse/stringify des ganzen Entwurfs bei
    ~120 Hz; Writes ohne Quota-try/catch (Editor stirbt still bei 5-MB-
    Limit). → In-Memory-Arbeitskopie, Write auf pointerup/debounced.

22. **SpawnPanel-Feinschliff** — keine Prefab-Vorschaubilder, stille
    80-Treffer-Kappung („… und N weitere" fehlt), Liste wird pro
    Tastendruck komplett neu gebaut (debouncen); Editor-Vorschau-Worker
    wird nach Fertigstellung nie terminiert (WorldMap macht es richtig).

23. **Fehler unsichtbar** — Havok-Ladefehler und Asset-Fehler landen nur
    in Konsole/Debugzeile; `hud.meldung()` als Toast für beide nutzen.
    ⬜ **offen** (geprüft 16.08.2026): `hud.meldung()` gibt es und wird
    an vielen Stellen benutzt — der Havok-Ladefehler geht weiterhin nur
    auf die Konsole (`client/src/main.ts`).

24. **main.ts mit 1763 Zeilen** — vier klare Extraktionen (Debug-API,
    Paket-Handler, Testflug-/Spawn-Block, Game-Loop) brächten es auf
    ~450 Zeilen Bootstrapping.
    ⬜ **offen und gewachsen:** 2553 Zeilen (Stand 16.08.2026).

25. **Kein Touch-/Mobile-Pfad, HUD-Pixelmaße fix** — entweder sauber
    ausschließen (Hinweisseite) oder virtuelle Sticks + relative Maße.

---

## 🟢 Qualität & Betrieb

26. **Kein Test-Runner, keine CI** — 29 Testdateien nur einzeln von Hand
    startbar, kein `test`-Script, kein `.github/`. Client hat NULL Tests.
    Lohnendster Einstieg: BinaryWriter/Reader-Roundtrip, `imPolygon`,
    `worldlayout/compile.ts`. Assertion-Stil vereinheitlichen
    (`node:test` statt Mix aus exit(1) und assert).
    ✅ **Runner seit 04.08.2026** (`scripts/run-tests.mjs`): 23 Tests,
    Kernliste 20, Bedingung für die Kernliste ist „ohne Assets, Browser
    und GPU, in Sekunden". Der Client hat inzwischen drei Tests darin.
    Seit 16.08.2026 ist die Liste zugleich das Tor im Ausrollskript.
    ⬜ **Offen bleibt die CI** — es gibt kein `.github/`. Der Grund ist
    kein Versehen: Beide Container ziehen selbst, und die Prüfung läuft
    beim Ausrollen. Eine CI würde dieselben Tests ein zweites Mal fahren.

27. **Kartengenerierungs-Umbau undokumentiert** — kein Doc zu
    worldlayout/RegionGeo/Editor/MCP/Spawn-Editor (nur Commits und
    Datei-Header). → `Docs/10-Weltbau-Layout-und-Editor.md`.
    README widerspricht sich (nennt 5273/2466 UND 5274/2467, „Phase 0").
    ✅ **erledigt:** `Docs/10-Weltbau-Layout-und-Editor.md` steht seit
    04.08.2026; die README ist am 16.08.2026 auf den Block-A-Stand
    gebracht worden und nennt nur noch 2467/5274/2468.

28. **Kein lint/format/typecheck** — Root-tsconfig kaputt
    (`rootDir: "src"` ohne src/), `client` hat kein typecheck-Script.
    → Solution-tsconfig + `typecheck`/`lint`-Scripts je Workspace.
    🟡 **halb erledigt:** `npm run typecheck` fährt seit 16.08.2026
    `shared`, `server`, `client` **und** `admin` und ist Teil des
    Ausrollskripts — ein Typfehler hält seither die Auslieferung an,
    statt nur eine Konsole zu färben. **Offen:** lint und format fehlen
    weiterhin, und die Root-`tsconfig.json` trägt unverändert
    `rootDir: "src"` ohne `src/`. Sie fällt nicht auf, weil `shared`,
    `server` und `client` sie zwar per `extends` erben, den Wert aber
    jeweils selbst setzen (`admin` erbt sie gar nicht) — ein Stolperstein
    für den nächsten, der einen Workspace anlegt und sich auf die
    Vorgabe verlässt.

29. **Firewall offen** — 2466/2467/5273/5274 lauschen auf allen
    Interfaces, Vite-Dev öffentlich; iptables Policy ACCEPT ohne Regeln.
    → Dev-Ports auf LAN/VPN beschränken oder Reverse-Proxy mit Auth.

30. **Repo-/Platten-Hygiene** — ~13 GB Rohdaten doppelt zwischen
    valheim-babylon und worldofvikings (Hardlinks/`/root/shared-assets`);
    `tsc-log.txt` eingecheckt (veraltet); `tools/worldlayout-mcp` fehlt
    in den Workspaces; `probe.ts` ohne Assertions; `.mcp.json` mit
    hartkodiertem Pfad; `.gitignore`-Lücken bei `tools/assetripper/`.
    ✅ **weitgehend erledigt:** `tools/worldlayout-mcp` steht in den
    Workspaces, `.mcp.json` trägt einen relativen Pfad, `tsc-log.txt`
    ist weg, `tools/assetripper/` fällt unter `.gitignore`. Die
    Platten-Deduplizierung hat sich am 16.08.2026 von selbst erledigt:
    Der Valheim-Export ist gelöscht (11.869 Dateien, 5,1 GB), `assets/`
    trägt 212 eigene Dateien / 158 MB. `tools/assetripper/` ist auf
    32 KB geschrumpft — womit auch die Werkzeuge, die aus dem Export
    lesen (`dump-envsetup.mjs`, `recover-textures.mjs`), keine Quelle
    mehr haben.

31. **Kleinere Server-Punkte** — `GameSocket.disconnect()` lässt
    `connected=true`; Paket-Log je Paket (`NetManager.ts:121`) ist
    I/O-Last; Destroy-Liste wächst bei 0 Peers unbegrenzt
    (`WovServer.ts:551-555`); doppelt registrierter `teleport`-Handler
    wird still überschrieben; Loot nutzt `Math.random()` statt seeded
    RNG (keine reproduzierbaren Bug-Reports); `handleRpcCall` ist
    unfertig und ungeschützt (TODO) — entfernen oder whitelisten.
    🟡 **teils erledigt:** Die Destroy-Liste wird inzwischen konsumiert
    (`ZDOManager.consumeDestroyList()`), `GameSocket.disconnect()` setzt
    `connected = false`. Die übrigen Unterpunkte sind nicht nachgeprüft.

32. **Layout-Modus fachlich offen** — Flüsse/Seen fehlen (Schema:
    Fluss-Splines als Layout-Inhalt); Progression unkuratierter Regionen
    unkontrolliert (`minDistance` stillgelegt → `progressionTier` je
    Region); Spawn hart (0,0) statt `spawnPoints` je Fraktion im Schema;
    RegionField: Objekt-Allokation pro Sample, stille Verdrängung bei
    >4 überlappenden Regionen pro Zelle (Editor-Warnung fehlt);
    Sanitizer meldet unbekannte Prefab-Namen nicht zurück
    (Validierungsbericht für Editor/MCP).

    ✅ **erledigt bis auf einen Punkt.** Flüsse und Seen sind seit
    04.08.2026 Layout-Inhalt (`RiverDef`, `compile.ts`); `progressionTier`
    (0–5) ersetzt die Weltzentrums-Distanz der Radialwelt; Startpunkte je
    Fraktion stehen im Schema; `worldlayout/pruefung.ts` liefert den
    Bericht, den Editor, MCP und Boot-Log anzeigen — seit Block A prüft
    er zusätzlich gegen `istEigenesModell()`, weil ein Name bekannt und
    trotzdem unerwünscht sein kann. Die Objekt-Allokation pro Sample ist
    am 16.08.2026 gefallen (vorzerlegte Formen, Zahlenschlüssel, Memo).
    ⬜ **Offen bleibt** die stille Verdrängung: `MAX_KANDIDATEN = 4` je
    Zelle, der Z-niedrigste Kandidat fliegt kommentarlos heraus
    (`worldlayout/compile.ts`), und der Editor warnt nicht.

    *(Randnotiz zur Kuratierung: Seit Block A ist eine Region ohne
    `vegetation`-Liste nicht mehr „Standardbewuchs", sondern kahl — es
    gibt keine Biom-Standardtabelle mehr. Die 17 Regionen der Live-Welt
    sind deshalb alle kuratiert.)*
