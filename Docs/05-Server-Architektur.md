# 05 — Server-Architektur (C++ → TypeScript)

Der Kern des Servers ist der 1:1-Port des C++-Servers aus `valheim.community` (Valhalla2.0). Er wurde in `valheim-browser` weitgehend umgesetzt und **unverändert übernommen** — die Engine-Migration berührte ihn nicht. Seither ist Eigenes dazugekommen, das im C++-Vorbild keine Entsprechung hat: die Layout-Welt ([10](10-Weltbau-Layout-und-Editor.md)), NPC-Routen, Dungeon-Instanzen ([08](08-Dungeon-System.md)) — und der Betriebsteil am Ende dieses Dokuments.

> Dieses Dokument ist auch **Betriebsanleitung**. `deploy/systemd/wov-server.service` verweist
> mit `Documentation=` hierher; wer den Dienst untersucht, landet auf dieser Seite. Deshalb
> steht der Startweg hier und nicht nur die Portierungstabelle.

---

## C++ → TypeScript Mapping

| C++ (`valheim.community/library/src`) | TypeScript (`server/src`) | Status |
|---|---|---|
| `Main.cpp` (core) | `main.ts` | ✅ vorhanden |
| `ValhallaServer.cpp` | `WovServer.ts` (hieß beim Import `ValhallaServer.ts`) | ✅ vorhanden |
| `ZDO.cpp / ZDOManager.cpp` | `zdo/ZDO.ts, ZDOManager.ts` | ✅ vorhanden |
| `ZDOID.cpp` | `zdo/ZDOID.ts` | ✅ vorhanden |
| `Prefab.cpp / PrefabManager.cpp` | `prefab/Prefab.ts, PrefabManager.ts` | ✅ vorhanden |
| `ZoneManager.cpp` | `world/ZoneManager.ts` | ✅ vorhanden |
| `Heightmap*.cpp, GeoManager.cpp, FastNoise.cpp` | `shared/src/worldgen/*` | ✅ **gegen C++ verifiziert** (Analyse: Phase B–D abgeschlossen, Weltkarten-Diff vorhanden) |
| `WorldManager.cpp` | `world/WorldManager.ts` | ✅ vorhanden |
| `NetManager.cpp / Peer.cpp / NetSocket*.cpp` | `net/NetManager.ts, Peer.ts, WebSocketAcceptor.ts` | ✅ WebSocket statt Steam Sockets |
| `Rpc.h` | `net/Rpc.ts` | ✅ vorhanden |
| `Reader/Writer/Stream.cpp` | `io/Reader.ts, Writer.ts, Stream.ts` | ✅ vorhanden |
| Spawn-Logik | `world/SpawnSystem.ts` | ✅ vorhanden |
| — (eigen) | `world/RoutenLaeufer.ts` | ✅ NPCs laufen die Wegpunkte des WorldLayouts ab (Docs/10) |
| — (eigen) | `world/WorldContext.ts` | ✅ Fundament gegen das Singleton (Review-Punkt 15), 2026-08-04 |
| `Vector/Quaternion/Types/BitPack` | `util/*` | ✅ vorhanden |
| `DungeonGenerator/DungeonManager.cpp` | `world/dungeon/DungeonManager.ts` | ✅ portiert 2026-08-02 ([08](08-Dungeon-System.md)) — seit Block A per `dungeons.enabled: false` **stillgelegt** (s. u.) |
| `RandomEventManager.cpp` | in `WovServer.ts` (verschlankt) | ✅ 2026-08-02 — "Der Wald bewegt sich"; ohne Kreaturen derzeit ohne Wirkung |
| `RouteManager.cpp` | — | ⬜ offen (Pfadsuche); die eigenen NPC-Routen laufen über `world/RoutenLaeufer.ts` |
| `IWCManager.cpp` (Inter-World-Chat?) | — | ⬜ optional |
| `HousingRegistry.cpp / APIHousing.cpp` | — | ⬜ später (Community-Feature) |
| `DiscordManager.cpp, RestApiManager.cpp` | — | ⬜ optional (Admin/Integration) |
| `ModManager.cpp` (Lua) | — | ⬜ bewusst später — Lua-Modding API |

> Hinweis: Die Tabelle ist der Auszug aus dem Mapping in valheim-browser/PLAN.md plus Datei-Abgleich mit `valheim.community/library/src`. Der Import (Phase 0) ist am 2026-07-26 gelaufen; die Statusspalte trägt seither den Ist-Stand dieses Repos, nicht mehr den von valheim-browser.

---

## Datenfluss ZDO-Sync (unverändert)

```
Server (autoritativ)
  ZDOManager ──Delta (50 ms)──▶ NetManager ──WS/Binary──▶ Client
      ▲                                                      │
      └──────────── Input (20 Hz) / RPC ◀────────────────────┘
```

- Sektor-basierte ZDO-Speicherung (`objectsBySector`), Delta-Sync an Peers nach Sichtradius
- Flags: Persistent, Distant, Type1, Type2; Member: float, Vector3, Quaternion, int32, int64, string, bytes
- Persistenz: World-Meta + ZDO-Snapshot als **eigener JSON-Umschlag, zstd-gepackt** (`world/WorldManager.ts`, `<instanz>.db.zst`), Save-Interval konfigurierbar. SQLite stand im Master-Plan und wurde 2026-08 verworfen — ein Save pro Welt, atomar über tmp+rename, brachte hier alles, was gebraucht wird, ohne neue Abhängigkeit. Seit D8 (2026-08-15) läuft das Schreiben asynchron in einen zstd-Strom, statt den Event-Loop zu blockieren.

## Offene Server-Themen

1. ~~**Spawn-Daten komplettieren**: Scale/Rotation in die Spawn-Pakete~~ — ✅ war mit Phase E bereits importiert (`ZoneManager` sendet `scaleScalar` + Boden-Neigungs-Rotation).
2. ~~**Vegetationssystem serverseitig**~~ — ✅ portiert. Seit 2026-08-16 läuft jeder Eintrag gegen `istEigenesModell()`; aus `vegetation.pkg` bleibt damit nichts übrig (120 von 120 gefiltert). `FOLIAGE` besteht heute aus den 73 eigenen Einträgen in `shared/src/flora.ts`. Folge: Es gibt keine Biom-Standardtabelle mehr — eine Region ohne Kuratierungsliste bleibt kahl.
3. **Locations** (Analyse Phase F): Die features.pkg-Platzierung (146 Locations) ist gebaut, steht aber seit 2026-08-16 auf `world.features: false`. Grund: Alle 146 Einträge sind Valheim-Exporte. Gebucht würden sie trotzdem — jede Instanz legte ZDOs an, die der Client nicht darstellen kann, und der Spieler liefe durch unsichtbare Grabhügel. Verworfen wurde, sie nur clientseitig auszublenden: dann stünden die Geister-ZDOs weiter im Save und passten später nicht mehr zu der Buchung, die mit eigenen Modellen entsteht. Dasselbe gilt für `dungeons.enabled: false`, das zwingend folgt — ohne gebuchte Krypta gibt es keinen Eingang.
4. **Tests**: `npm run typecheck` und `node scripts/run-tests.mjs` sind seit Block A das Tor im Ausrollskript und müssen grün bleiben (23 Tests, Kernliste 20). Das Weltgen-Diff-Tool gegen C++ (`geo-compare`, `heightmap-compare`, `geo-map`) braucht Referenz-Dumps als Argument und steht bewusst außerhalb der Liste — es gehört zum eingefrorenen `valheim`-Übergangspfad.
5. **Kreaturen**: `SPAWN_TABLE` ist aus demselben Grund leer (3 von 3 Einträgen gefiltert). Der Spawn-Code läuft, findet aber nichts zu spawnen — bis eigene Kreaturenmodelle vorliegen, kann im Spiel nicht gekämpft werden.

---

## Betrieb: zwei Container, eine Codebasis

Bis 08/2026 trug jeder Container seinen eigenen Stand: dev hieß `wov-bau`, ausgerollt wurde per tar über `tools/deploy.sh`, und `server/data/server.yml` trug den Weltnamen (`world: bau` gegen `world: vikings`). Genau deshalb durfte diese Datei nie mitdeployt werden — und genau deshalb liefen die Bäume nach jedem Abgleich wieder auseinander. Eine Datei, die sich zwischen zwei Containern unterscheiden **muss**, ist eine Bruchstelle mit Ansage.

Seit 16.08.2026 gilt: ein Repo, ein Branch `main` (`master` ist gelöscht), beide Container fahren denselben Klon unter `/opt/worldofvikings` auf demselben Commit. Es gibt keine Quelldatei mehr, die sich unterscheiden muss. Der Unterschied steckt vollständig in `/etc/wov.env`, das außerhalb des Baums liegt und dem Container gehört.

### Drei Dienste

| Unit | Port | Aufgabe |
|---|---|---|
| `wov-server` | 2467 | Spielserver, WebSocket (`/ws`) |
| `wov-client` | 5274 | Vite mit Editor und Testflug — nur auf dev aktiviert; auf live liefert nginx `client/dist` aus |
| `wov-admin` | 2468 | Betriebsdienst: Weltdokument, Server-Konsole, Dienststeuerung |

Die drei Unit-Dateien in `deploy/systemd/` sind auf beiden Containern zeichengleich; installiert werden sie mit `sudo deploy/install-services.sh`. `wov-firewall.service` ist entfallen — die Regeln liegen als `deploy/firewall-rules.v4/.v6` und werden von netfilter-persistent geladen; eine Unit, die beim Start dasselbe noch einmal tat, war eine zweite Wahrheit.

### `WOV_INSTANZ` bestimmt alles Umgebungsabhängige

```
WOV_INSTANZ=dev|live   →  Weltdokument  server/data/welten/<instanz>.json      (in Git, beide auf beiden)
                          Spielstand    server/data/worlds/<instanz>.db.zst    (gitignored)
                          Placement-Cache server/data/worlds/<instanz>.locations.json
```

Aufgelöst wird das an genau einer Stelle: `shared/src/instanz.ts`. Ein **unbekannter** Wert bricht den Start hart ab; ein Tippfehler in der Unit (`WOV_INSTANZ=liv`) darf nicht dazu führen, dass der Live-Server still den Dev-Spielstand öffnet und ihn bei der ersten 30-Minuten-Sicherung überschreibt. Eine **fehlende** Variable fällt dagegen auf `dev` zurück — das trifft Werkzeuge und Tests, die ohne Unit laufen, und zeigt im Zweifel auf die Umgebung, in der ein Fehler nichts kostet.

Zwei Folgen, die man kennen muss:

- `server/data/worldlayout.json` **gibt es nicht mehr**. An seine Stelle sind die beiden Weltdokumente unter `server/data/welten/` getreten.
- `server.yml` ist damit umgebungsfrei; die Schlüssel `world.world` und `world.layout` sind entfernt. Die Datei wird deshalb ganz normal mit ausgerollt.

### Startweg des Spielservers

1. systemd liest `/etc/wov.env` (`EnvironmentFile=`), `WorkingDirectory=/opt/worldofvikings/server`.
2. `ExecStart=/opt/worldofvikings/node_modules/.bin/tsx $WOV_WATCH src/main.ts` — **kein Build**, der Server läuft aus dem Quellbaum. `$WOV_WATCH` ist auf dev `watch` und auf live leer; ein leeres `$VAR` fällt bei systemd ersatzlos aus der Argumentliste.
   *Warum direkt `node_modules/.bin/tsx` und nicht `npx tsx`:* npx löste bei jedem Start neu auf, und `tsx` stand bis 16.08.2026 in `devDependencies` — ein sauberes `npm ci --omit=dev` hätte den Live-Server nicht mehr starten lassen. Seither steht tsx in `dependencies`.
3. `server/src/main.ts` liest `instanzName()`, dann `server/data/server.yml`. Fehlt im Layout-Modus die Weltdatei `welten/<instanz>.json`, endet der Start mit lesbarer Meldung — vorher warf erst `readFileSync` mitten im Start ein nacktes ENOENT, und `Restart=always` machte daraus eine Neustartschleife ohne Hinweis auf die Ursache.
4. `WovServer` kompiliert das Layout, lädt Spielstand und Placement-Cache.
5. Erst danach geht Port 2467 auf. „Port offen" heißt also wirklich „bereit". Eine HTTP-Anfrage beantwortet der Server mit **`426 Upgrade Required`** — genau darauf prüft die Gesundheitsprüfung des Ausrollskripts.

Der Kaltstart dauert seit dem Wegfall der Locations rund **2 s** statt der früheren ~37 s: Es werden keine Locations mehr platziert.

### Editor-Endpunkte liegen im Betriebsdienst

`POST`/`GET /api/worldlayout` und `GET /api/serverlog` steckten bis Block A als Middleware in `client/vite.config.ts`. Vite läuft aber nur auf dev — auf live gab es beide Endpunkte schlicht nicht, der Editor konnte dort nicht speichern. Ein Speicherweg, der nur existiert, solange ein Entwicklungsserver läuft, ist keine Architektur, sondern ein Zufall.

Sie liegen jetzt in `admin/` (Port 2468). Auf dev proxyt Vite dorthin, auf live nginx. Nicht in den Spielserver, weil `server/src` gar keinen HTTP-Server hat (nur den `WebSocketAcceptor`) und sich nach dem Speichern selbst neu starten müsste. Der einzige Schreibweg auf das Weltdokument ist `shared/src/worldlayout/layoutDatei.ts` — Sicherung mit Rotation, `sanitizeWorldLayout`, tmp+rename. Details in [10](10-Weltbau-Layout-und-Editor.md).

### Vier Domains

| Domain | Container | Zugang |
|---|---|---|
| `play.world-of-vikings.com` | live | offen |
| `editor.world-of-vikings.com` | live | Basic-Auth |
| `play.dev.world-of-vikings.com` | dev | |
| `editor.dev.world-of-vikings.com` | dev | Basic-Auth |

Die Passwortabfrage hängt im Proxy am **Host**, nicht am Pfad. Deshalb sperrt in `deploy/nginx-live.conf` eine `map $host`-Weiche `/editor.html` und `/api/` auf allem außer dem Editor-Host — sonst wären beide über `play.*` ohne Passwort erreichbar.

### Ausrollen

`tools/wov-update.sh` ersetzt seit 16.08.2026 `tools/deploy.sh` (gelöscht). Ablauf: `/etc/wov.env` lesen → **Abbruch bei schmutzigem Arbeitsbaum** → `git pull --ff-only origin main` → Dienste stoppen → `npm ci --include=dev` → Typecheck und Tests → auf live zusätzlich Client-Build nach `dist.neu` mit anschließendem Tausch → Dienste starten → Gesundheitsprüfung bis 120 s auf HTTP 426.

Der Vorgänger prüfte mit `npm run typecheck 2>&1 | tail -1`. Der Exit-Code einer Pipeline ist der des letzten Glieds, also immer der von `tail`, also immer 0: Typecheck, Tests und Client-Build durften durchfallen, neu gestartet wurde trotzdem. Deshalb laufen beide Prüfungen heute **ohne Pipe**.

`server/data/` bleibt dabei unberührt — Spielstände und Weltdokumente gehören dem Server, nicht dem Ausrollvorgang. Ein Weltdokument reist über den **Commit**, nicht über den Deploy.
