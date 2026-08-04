# Verbesserungsvorschläge (Projekt-Review)

Stand: 04.08.2026 — Ergebnis einer systematischen Durchsicht von Server/Shared
(58 Dateien), Client (53 Dateien, 20.282 Zeilen) und Infrastruktur/Tests/Docs.
Priorisiert in Kritisch / Wichtig / Editor & UX / Qualität & Betrieb.
Datei:Zeile-Angaben sind Stand der Durchsicht und können wandern.

**Empfohlene Reihenfolge:** Zuerst der Sicherheits-Dreier (1, 2, 4) plus die
Betriebs-Handgriffe (5, 6) — ein Tag Arbeit, beseitigt die Existenzrisiken.
Danach als eigener Block das Server-Inventar (8), das Bauen/Essen/Abriss/
Editor-Rechte auf einmal auf solide Füße stellt.

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

6. **npm-Scripts/Units steuern das falsche Projekt**
   - Root-`package.json` `service:*`-Scripts zeigen auf `valheim.target` —
     `npm run service:restart` im wov-Repo startet valheim-babylon neu.
   - Die laufenden wov-Units (`/etc/systemd/system/wov-*.service`,
     `wov.target`) sind nicht versioniert; `deploy/systemd/` enthält noch
     die valheim-Units mit alten Ports; `deploy/install-services.sh` ebenso.

7. **Save-/Layout-Schutz fehlt**
   - `WorldManager.load()` verwirft den Save bei Seed-/Version-Mismatch
     still → nächster Autosave überschreibt ihn. → als
     `.orphan-<ts>` wegbenennen statt freigeben.
   - `worldlayout.json` hat keine Backup-Rotation (MCP `schreibe()` nur
     tmp+rename) → zeitgestempelte `.bak`-Kopien, letzte 10 behalten.
   - Ein geändertes Layout verschiebt Terrain unter bestehenden ZDOs ohne
     Warnung → Layout-Hash in die Save-Meta und beim Laden prüfen
     (`WovServer.ts:249-252` vs. `WorldManager.ts:131-136`).

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

13. **Editor und MCP schreiben in verschiedene Töpfe** — editor.html
    persistiert nur localStorage + manueller Download, der MCP-Server
    schreibt `server/data/worldlayout.json` direkt. → kleiner
    Save-Endpoint (Vite-Middleware `POST /api/worldlayout` mit
    sanitize) als gemeinsame Quelle. Zudem hinterlassen gelöschte
    `placements` ihre ZDOs (`WovServer.ts:393-423`) → `layoutId`-Member
    je ZDO und Abgleich beim Boot.

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

24. **main.ts mit 1763 Zeilen** — vier klare Extraktionen (Debug-API,
    Paket-Handler, Testflug-/Spawn-Block, Game-Loop) brächten es auf
    ~450 Zeilen Bootstrapping.

25. **Kein Touch-/Mobile-Pfad, HUD-Pixelmaße fix** — entweder sauber
    ausschließen (Hinweisseite) oder virtuelle Sticks + relative Maße.

---

## 🟢 Qualität & Betrieb

26. **Kein Test-Runner, keine CI** — 29 Testdateien nur einzeln von Hand
    startbar, kein `test`-Script, kein `.github/`. Client hat NULL Tests.
    Lohnendster Einstieg: BinaryWriter/Reader-Roundtrip, `imPolygon`,
    `worldlayout/compile.ts`. Assertion-Stil vereinheitlichen
    (`node:test` statt Mix aus exit(1) und assert).

27. **Kartengenerierungs-Umbau undokumentiert** — kein Doc zu
    worldlayout/RegionGeo/Editor/MCP/Spawn-Editor (nur Commits und
    Datei-Header). → `Docs/10-Weltbau-Layout-und-Editor.md`.
    README widerspricht sich (nennt 5273/2466 UND 5274/2467, „Phase 0").

28. **Kein lint/format/typecheck** — Root-tsconfig kaputt
    (`rootDir: "src"` ohne src/), `client` hat kein typecheck-Script.
    → Solution-tsconfig + `typecheck`/`lint`-Scripts je Workspace.

29. **Firewall offen** — 2466/2467/5273/5274 lauschen auf allen
    Interfaces, Vite-Dev öffentlich; iptables Policy ACCEPT ohne Regeln.
    → Dev-Ports auf LAN/VPN beschränken oder Reverse-Proxy mit Auth.

30. **Repo-/Platten-Hygiene** — ~13 GB Rohdaten doppelt zwischen
    valheim-babylon und worldofvikings (Hardlinks/`/root/shared-assets`);
    `tsc-log.txt` eingecheckt (veraltet); `tools/worldlayout-mcp` fehlt
    in den Workspaces; `probe.ts` ohne Assertions; `.mcp.json` mit
    hartkodiertem Pfad; `.gitignore`-Lücken bei `tools/assetripper/`.

31. **Kleinere Server-Punkte** — `GameSocket.disconnect()` lässt
    `connected=true`; Paket-Log je Paket (`NetManager.ts:121`) ist
    I/O-Last; Destroy-Liste wächst bei 0 Peers unbegrenzt
    (`WovServer.ts:551-555`); doppelt registrierter `teleport`-Handler
    wird still überschrieben; Loot nutzt `Math.random()` statt seeded
    RNG (keine reproduzierbaren Bug-Reports); `handleRpcCall` ist
    unfertig und ungeschützt (TODO) — entfernen oder whitelisten.

32. **Layout-Modus fachlich offen** — Flüsse/Seen fehlen (Schema:
    Fluss-Splines als Layout-Inhalt); Progression unkuratierter Regionen
    unkontrolliert (`minDistance` stillgelegt → `progressionTier` je
    Region); Spawn hart (0,0) statt `spawnPoints` je Fraktion im Schema;
    RegionField: Objekt-Allokation pro Sample, stille Verdrängung bei
    >4 überlappenden Regionen pro Zelle (Editor-Warnung fehlt);
    Sanitizer meldet unbekannte Prefab-Namen nicht zurück
    (Validierungsbericht für Editor/MCP).
