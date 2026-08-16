# World of Vikings

Ein Browser-MMORPG „Angelsachsen gegen Wikinger" auf Basis von **Babylon.js** — Valheim als
Browsergame, ohne Download. Kürzel: **wov**.

Der Server ist ein 1:1-Port des C++-Servers aus Valhalla2.0 nach TypeScript und ist
autoritativ für Bewegung, Inventar, Craft- und Baukosten, Terraforming und Beute. Der Client
ist mit Babylon.js neu gebaut: WebGPU mit WebGL2-Rückfall, Thin Instances, Havok-Physik,
Kaskadenschatten, Volumetrics. Die Weltgenerierung teilen sich Client und Server über
`shared/` — sie ist gegen den C++-Server bit-genau verifiziert.

Die Welt kommt **nicht** aus Valheims radialem Seed-Kreis, sondern aus einem
**WorldLayout-Dokument**: Regionen als Polygone und Kreise mit Biom und Terrainparametern auf
unbegrenzter Karte, alles außerhalb ist Ozean. Der Weltbau-Editor schreibt dieses Dokument,
der Server kompiliert es zu einem Distanzfeld. Das Perlin-Detail *innerhalb* einer Region
stammt weiterhin aus den Original-Biomhöhenfunktionen.

> [!IMPORTANT]
> **Alle Modelle und Texturen sind Eigenbau.** Seit dem 16.08.2026 benutzt das Projekt keine
> aus Valheim extrahierten Assets mehr — weder in der Welt noch im Spielinhalt. Die Whitelist
> ist `EIGENE_MODELLE` in `shared/src/prefabs.ts`; alles andere wird aus den Tabellen
> gefiltert.
>
> **Folge, solange die eigenen Modelle fehlen: Im Spiel kann nicht gebaut und nicht gekämpft
> werden.** Von neun Bauteilen haben zwei ein Modell, Kreaturen und Locations keines. Das ist
> ein bewusst gewählter Zwischenzustand, kein Defekt. Die Welt selbst steht und ist begehbar.

## Zwei Umgebungen, eine Codebasis

Das ist das Betriebsmodell, und es erklärt fast alle Entscheidungen weiter unten.

| | `wov-dev` | `wov-live` |
|---|---|---|
| Rolle | entwickeln, testen, Welt bauen | Produktion |
| Auslieferung | Vite-Dev-Server, Port 5274 | nginx auf `client/dist` |
| `WOV_INSTANZ` | `dev` | `live` |
| Codestand | vorne | folgt per `git pull` |

Beide Container fahren **denselben Klon** unter `/opt/worldofvikings`, auf demselben Branch,
auf demselben Commit. Es gibt keine Quelldatei, die sich zwischen ihnen unterscheiden muss.
Der Unterschied steckt vollständig in `/etc/wov.env`:

```sh
WOV_INSTANZ=dev|live     # bestimmt Weltdokument UND Spielstand
WOV_WATCH=watch|         # auf live leer: kein Neustart bei Codeänderungen
NODE_ENV=development|production
WOV_ADMIN_ADRESSE=10.10.10.12|10.10.10.11
```

`WOV_INSTANZ` löst auf (`shared/src/instanz.ts`):

```
server/data/welten/<instanz>.json          Weltdokument  — in Git, beide auf beiden Containern
server/data/worlds/<instanz>.db.zst        Spielstand    — gitignored, gehört dem Server
server/data/worlds/<instanz>.locations.json  Placement-Cache
```

Ein unbekannter Wert bricht den Start hart ab, statt still die andere Welt zu öffnen. Ein
Tippfehler in der Unit würde sonst den Live-Server den Dev-Spielstand laden und ihn bei der
ersten Sicherung überschreiben lassen.

**Drei Regeln, die den Rest tragen:**

1. **Was du schreibst, commitest du** — egal auf welchem Container. Das Weltdokument ist
   versioniert.
2. **`git pull` bricht auf schmutzigem Arbeitsbaum ab.** Das ist die Kontrolle, die dafür
   sorgt, dass der Commit die Wahrheit sagt.
3. **Spielstände reisen nie.** Sie gehören dem Server, auf dem sie entstanden sind.

## Starten

```bash
sudo deploy/install-services.sh     # einmalig: Units installieren
systemctl start wov.target          # alle drei Dienste
journalctl -fu wov-server
```

Drei Units, auf beiden Containern identisch:

| Unit | Port | Was |
|---|---|---|
| `wov-server` | 2467 | Spielserver, WebSocket. Der Client verbindet über `/ws` |
| `wov-client` | 5274 | Vite-Dev-Server mit Editor — nur auf dev aktiviert |
| `wov-admin` | 2468 | Betriebsdienst: Weltdokument, Server-Konsole, Dienststeuerung |

Ohne systemd, beide Logs in einem Terminal:

```bash
npm run dev
```

Port 2467 geht erst auf, wenn die Welt geladen ist — „Port offen" heißt also wirklich
„bereit". Ein Kaltstart ohne Placement-Cache dauerte früher rund 40 s; seit die Locations
entfallen sind, sind es etwa **zwei Sekunden**. Eine HTTP-Anfrage an den Port beantwortet der
Server mit `426 Upgrade Required` — genau darauf prüft die Gesundheitsprüfung.

## Ausrollen

```bash
tools/wov-update.sh
```

Liest `/etc/wov.env`, **bricht bei schmutzigem Arbeitsbaum ab**, zieht `origin main`, stoppt
die Dienste, `npm ci --include=dev`, dann Typecheck und Tests — **ohne Pipe**. Auf live
zusätzlich der Client-Build nach `dist.neu` mit anschließendem Tausch, damit nginx bei einem
Abbruch nie eine Mischung ausliefert. Zum Schluss Dienste starten und bis 120 s auf eine echte
Antwort warten.

> Der Vorgänger `tools/deploy.sh` prüfte mit `npm run typecheck 2>&1 | tail -1`. Der
> Exit-Code einer Pipeline ist der des letzten Glieds — also immer der von `tail`, also immer
> 0. Typecheck, Tests **und der Client-Build** durften durchfallen, das Skript startete den
> Server trotzdem neu. Deshalb steht das `&&` hier so ausdrücklich da.

## Die Welt bearbeiten

Der Editor läuft auf **beiden** Containern unter `/editor.html`, hinter Basic-Auth.

Er holt sein Dokument beim Start vom Server (`GET /api/worldlayout`) und speichert dorthin
zurück. Weicht ein ungespeicherter Entwurf im Browser vom Serverstand ab, stellt er beide
gegenüber — Regionen namentlich — und lässt dich entscheiden. Ein Farbband über der
Werkzeugleiste zeigt unübersehbar, welche Instanz offen ist.

Eine Welt nach live bringen:

```bash
cp server/data/welten/dev.json server/data/welten/live.json
git commit -am "Welt: …"  &&  git push
# auf live:  tools/wov-update.sh
```

Das Tor ist der **Commit**, nicht der Deploy: Eine halbfertige Insel ist eine uncommittete
Änderung und geht nirgendwohin.

**Kuratierung.** Jede Region trägt eine `vegetation`-Liste, und die ist **exklusiv** — steht
sie da, wächst genau das und sonst nichts; eine leere Liste heißt „hier wächst nichts". Die
fertigen Bündel stehen in `shared/src/flora.ts` (`GRASLAND_`, `NADELWALD_`, `SUMPF_`,
`HOCHNORD_`, `ASCHE_FLORA_NAMEN`) und lassen sich im Editor per Knopf eintragen.

## Tests

```bash
npm run typecheck                  # shared, server, client, admin
node scripts/run-tests.mjs         # Kernliste, ~50 s
node scripts/run-tests.mjs --alle  # zusätzlich die langen
```

23 Tests, davon 20 in der Kernliste. Die Bedingung für die Kernliste: ohne Assets, Browser
und GPU lauffähig, in Sekunden.

Zwei davon sind Wächter gegen konkrete Vorfälle statt gegen abstrakte Fehler:
`shared/test/heightmap-determinismus.ts` lässt über 59.021 Höhenwerte **0,000 m** Abweichung
zu — die Bremse gegen jede Beschleunigung, die die Welt unter den Füßen des Spielers
verschiebt. `client/test/welt-abgleich.ts` prüft, dass ein überschriebenes Weltdokument als
Verlust erkannt wird, auch wenn die Zählerstände gleich bleiben.

## Dokumentation

Die Kommentare im Code sind Teil der Dokumentation — sie halten fest, *warum* etwas so ist
und welche Alternative verworfen wurde. Wer eine Entscheidung rückgängig machen will, findet
dort meist schon den Grund, warum sie getroffen wurde.

| | |
|---|---|
| [00 — Master Plan](Docs/00-Master-Plan.md) | Zielbild und Gesamtaufbau |
| [01 — Warum Babylon.js?](Docs/01-Warum-Babylon.md) | Engine-Entscheidung |
| [02 — Migration von valheim-browser](Docs/02-Migration-von-valheim-browser.md) | Herkunft aus dem Three.js-Prototyp |
| [03 — Rendering und Engine](Docs/03-Rendering-und-Engine.md) | Client-Innenleben |
| [04 — Asset-Pipeline](Docs/04-Asset-Pipeline.md) | Wie Modelle und Texturen entstehen |
| [05 — Server-Architektur](Docs/05-Server-Architektur.md) | ZDOs, Zonen, Betrieb |
| [06 — Roadmap](Docs/06-Roadmap.md) | Meilensteine und Historie |
| [07 — Grafik-Konzept](Docs/07-Grafik-Konzept.md) | Bildsprache, gemessen statt geschätzt |
| [08 — Dungeon-System](Docs/08-Dungeon-System.md) | Generatoren und Instanzen |
| [09 — Verbesserungsvorschläge](Docs/09-Verbesserungsvorschlaege.md) | Repo-interne Befundliste |
| [10 — Weltbau, Layout und Editor](Docs/10-Weltbau-Layout-und-Editor.md) | Das WorldLayout und sein Werkzeug |
| [Analyse — Modelle und Weltgenerierung](Docs/Analyse-Modelle-und-Weltgenerierung.md) | Momentaufnahme |
| [Migrationsplan](Docs/Migrationsplan-Differenzen-und-Aufgaben.md) | Momentaufnahme |

## Aufbau

```
server/    autoritativer Spielserver (TypeScript, tsx — kein Build)
client/    Babylon.js-Client, Weltbau-Editor, Karte
shared/    Weltgenerierung, Prefabs, Protokoll — Client UND Server
admin/     Betriebsdienst: Weltdokument, Server-Konsole, Dienststeuerung
tools/     Asset-Erzeugung (Blender, Python), Messwerkzeuge, wov-update.sh
deploy/    systemd-Units, nginx, Installationsskript
Docs/      siehe oben
```

`assets/` (Modelle, Texturen, Audio) liegt bewusst außerhalb der Versionierung.
