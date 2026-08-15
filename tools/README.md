# Werkzeugkasten

Alles unter `tools/` ist **Rezept**, nicht Ergebnis. Die erzeugten Dateien
liegen unter `assets/` und sind gitignored (`.gitignore:17`) — wer ein
Modell oder eine Textur braucht, baut sie mit dem passenden Skript neu.
Deshalb muss jedes Skript reproduzierbar laufen und seinen Zweck im
Dateikopf erklären.

> **Regel: Ein neues Werkzeug gehört hier hinein.**
> Wer `tools/` um ein Skript erweitert, ergänzt in derselben Änderung eine
> Zeile in dieser Datei. Ohne das wächst der Ordner zu, und beim nächsten
> Mal schreibt jemand ein Werkzeug, das es längst gibt — bei 75 Dateien ist
> das keine hypothetische Sorge. Ein Werkzeug, das aus dem Verkehr gezogen
> wird, verschwindet auch hier.

Zwei wiederkehrende Aufrufformen:

```bash
blender --background --python tools/<skript>.py -- <argumente>   # Blender 4.0.2, Z-up
node tools/<skript>.mjs <argumente>                              # Node, oft mit Playwright
```

---

## Modelle bauen

| Werkzeug | Zweck |
|---|---|
| `baum-generieren.py` | Nadel- und Laubbäume als GLB (Fichte, Tanne, Birke, Eiche, **Kiefer**). `--kartenfaktor` skaliert die Blattkarten mit der Höhe (`leafScale` ist bei Sapling eine ABSOLUTE Länge — ohne das wird ein 22-m-Baum licht), `--stammfaktor` die Stammstärke (`ratio`). Beide mit Vorgabe 1, damit bestehende Bäume unverändert bleiben. — prozedurale Geometrie, Blattkarten geometrisch an die Astenden gelegt (BVH-Suche). Die Artprofile (Fichte, Tanne, Birke, Eiche …) stehen im Skript. |
| `baeume-bauen.sh` | Baut sämtliche Bäume neu. `tools/baeume-bauen.sh` für alle, `… birke` für eine Gruppe. |
| `busch-generieren.py` | Sträucher als GLB (zehn Arten: Hasel, Wacholder, Weide, Holunder, Brombeere, Heidekraut, Ginster, Schlehe, Hartriegel, Heidelbeere). Anders als beim Baum wird je **Trieb** ein eigener Sapling-Lauf gemacht und das Bündel am Fuß zusammengesetzt — `baseSplits` teilt erst auf halber Höhe und lässt den unteren Bereich kahl. `--hoehe` meint die Höhe des fertigen Busches: Zwei Messläufe legen die Gerade `Höhe = a · Trieblänge + Sockel` fest, der dritte Lauf trifft. Arten mit `stamm` im Profil (bisher nur der Holunder) bekommen darunter einen kurzen kräftigen Stamm, auf dem das Bündel sitzt. |
| `buesche-bauen.sh` | Baut sämtliche Büsche neu. `tools/buesche-bauen.sh` für alle, `… wacholder` für eine Art. Zeichnet fehlende Texturen selbst. |
| `blumen-generieren.py` | Blumen- und Unkrauthorste als GLB (zehn Arten). **Ohne Sapling**: reine Kartenbündel, je Pflanze ein Viereck — ein Horst kostet 18–40 Dreiecke. `--hoehe` meint die Pflanze, nicht das Viereck; wie weit die Karte gefüllt ist, wird aus dem Alphakanal gemessen. Normalen bleiben flächensenkrecht, weil Babylons glTF-Loader bei `doubleSided` die Normale spiegelt (`twoSidedLighting`) und nach oben gerichtete dadurch von hinten unbeleuchtet wären. |
| `blumen-bauen.sh` | Baut sämtliche Blumen- und Unkrauthorste neu. `tools/blumen-bauen.sh` für alle, `… distel` für eine Art. |
| `felsen-generieren.py` | Felsen als GLB (Findling, Block, Nadel, Platte, Sandsteinbank). Verformte Ikosphäre statt Sapling — ein Fels hat keine Verzweigung. 80 Dreiecke je Stück. Der Pivot sitzt bewusst **über** dem tiefsten Punkt: Ein Fels steckt im Boden, er liegt nicht darauf. |
| `felsen-bauen.sh` | Baut sämtliche Felsen neu. `tools/felsen-bauen.sh` für alle, `… findling` für eine Art. |
| `grabhuegel-bauen.py` | Wikingerzeitlicher Grabhügel: außen Erdhügel mit Steinkranz, innen Grabkammer mit Schiff. Das erste prozedurale *Bauwerk* des Projekts. |
| `clutter-meshes.py` | Die sechs Clutter-Meshes aus `MESH_FILES` in `GrassClutter.ts` (`clutter_default`, `grasscross`, `clutter_plane`, `clutter_fern`, `clutter_vass`, `clutter_lily`). **Ohne Blender**: gekrümmte Kartenstreifen mit exakt vorgegebenen UVs, GLB direkt geschrieben — ein Exporter dürfte Vertices zusammenlegen und umsortieren, und genau die UV-Belegung ist hier der Vertrag mit `clutter-texturen.py`. `buffers[0].byteLength` und die BIN-Chunk-Länge stammen aus derselben Variablen (der Fehler aus Docs/06-Roadmap.md „AssetRipper-GLBs"). Die Bounding-Boxen halten die Maße der früheren Dateien ein, weil `prefabScale`, `scaleMin/Max` und `topY` in ENTRIES darauf getunt sind. |
| `tripo-generate.mjs` | Erzeugt ein Modell über die Tripo-API und legt es spielfertig ab. Braucht `TRIPO_API_SECRET` mit `tsk_`-Präfix (`tcli_`-Schlüssel werden abgelehnt). |

## Texturen erzeugen

| Werkzeug | Zweck |
|---|---|
| `eiche-texturen.py` | Laubkarte und Rinde der Eiche — die einzige Baumart ohne Valheim-Material. |
| `felsen-texturen.py` | Drei Gesteinsarten (Granit kristallin mit Moos, Basalt feinkörnig dunkel, Sandstein waagerecht geschichtet). Periodisch, weil die Kugelprojektion die Textur mehrfach über den Fels wiederholt. |
| `busch-texturen.py` | Laubkarte und Rinde je Strauchart, alle zehn gerechnet statt gerippt. Fünf Blattformen (rund-gesägt, lanzettlich, gefiedert, derb-gezähnt, Schuppe) plus Nadelquirle, dazu Beerendolden, einzeln sitzende Früchte und Blütenähren; Rinde wahlweise längsrissig oder glatt mit Lentizellen. 128² statt 256² — ein Busch nimmt im Bild nie so viel Platz ein wie ein Baum. |
| `blumen-texturen.py` | Je Blumen- und Unkrautart EINE Karte (Straucharten brauchen zwei, weil ihr Holz sichtbar ist — eine Blume hat keins). Vier Kartenbauarten (Stengel mit Blüte, beblätterter Stengel, Grashorst, Farnwedel) und sieben Blütenformen von der nickenden Glocke bis zum Distelkorb. 96², gefiederte Arten 128². |
| `grabhuegel-texturen.py` | Stein, Grassode, Holz, Schild-Atlas und Segel des Grabhügels. |
| `gen-grass-texture.py` | Die drei Gras-Atlanten für die Bündel-Meshes (`grass_meadows_gen`, `grass_heath_gen`, `grass_toon1_yellow_gen`) — Wiese, Heide, Sumpf. Zeichnet in **drei senkrechte Spalten**; dieselbe Aufteilung greift `clutter-meshes.py` als UV ab, wer sie hier verschiebt, muss dort mitziehen. (Schrieb bis 08/2026 nach `../valheim_browser_assets/` — dem Ordner des three.js-Vorläufers, der hier nicht existiert.) |
| `clutter-texturen.py` | Die acht Clutter-Texturen, die `gen-grass-texture.py` nicht abdeckt: Waldboden (grün/braun), Farnwedel (grün/Sumpf), Strauch, Heideblume, Schilf, Seerosenblatt. Alle nach derselben Konvention wie die Gras-Atlanten — **Vollbild-Billboard, v=1 ist der Boden**, weil der HD-Umschalter in `GrassClutter.ts` die Textur tauscht, ohne die UVs anzufassen. `forest_groundcover(_brown)` kachelt waagerecht (ENTRIES setzt dort `texRepeatU: 2`). Deckungsgrade bewusst niedrig gehalten — 60 % gefüllte Halmkarten waren der „Neonteppich" aus dem `MEADOWS_TINT`-Kommentar. |
| `wasser-texturen.py` | Die vier Wassertexturen für `WaterPlugin.ts` plus `grass_terrain_color.png`. **Achtung:** `water_normals_real.png` ist Unity-DXT5nm gepackt — `(1, y, y, x)`, X liegt im Alphakanal und B muss exakt gleich G sein, sonst kippt das Wasser dauerhaft in eine Richtung. Die Schaum-Mittelwerte gehen als feste Divisoren in den Shader ein. |
| `item-icons.py` | Die 25 Item-Icons aus `itemDefs.ts` (`icon:`) plus `cultivate_ground` aus `PieceTable.ts` als 64² RGBA, vierfach überabgetastet gezeichnet. `--nur name1,name2` für einzelne, `--blatt` legt eine Übersicht nach `out/icons.png`. Die Bauteil-Icons landen im selben Ordner `/assets/sprites/`; `hoe` und `stone` fallen mit Gegenstands-Icons zusammen, `cultivate_ground` ist das einzige eigene. |
| `terrain-texturen.py` | Die neun Bodentexturen für `TerrainSplat.ts` — 16 Albedo-Tiles im 256×4096-Stapel, der Variety-Noise und sieben Normal-Maps. Drei Vorgaben sind nicht frei wählbar: die Tile-Reihenfolge (`TILE`-Enum), die Kanalmittel des Noise (im Shader als `VAR_MITTE_*` fest verdrahtet) und die Periodizität, weil der Shader mit `fract(uv)` kachelt. `--nur splat\|noise\|normal` baut einzelne Gruppen. |
| `make-hd-clutter.py` | Bereitet die HD-Grastexturen für `GrassClutter.ts` auf (13 Einträge). |
| `texture-catalog.py` | Katalogisiert die extrahierten Valheim-Texturen nach Unity-Namenskonvention (`_d` Albedo, `_n` Normal, `_m` Maske, `_e` Emission). |
| `lib/karten.py` | Geteilte Bausteine der Pflanzenkarten (`mischen`, `gedreht`, `umriss`, `achse`, `abschliessen`). Benutzt von `busch-texturen.py` und `blumen-texturen.py`. Enthält die zwei Regeln, an denen beide hängen: Stiel bei v=0, und Hintergrund in mittlerer Pflanzenfarbe statt transparentem Schwarz. |
| `lib/rauschen.py` | Geteilte Rauschfunktionen (`wertrauschen`, `oktaven`, `furchen`, `normiert`). **Periodisch**, weil alle Texturen gekachelt werden. |

## Rigging und Animation

| Werkzeug | Zweck |
|---|---|
| `voelva-rig.py` | Riggt die Völva (12 Knochen) mit `idle` und `walk`. Gewichte als **stetige Funktion der Position** — Bone Heat scheitert an 258 Zusammenhangskomponenten. |
| `surtr-rig.py` | Riggt Surtr mit `idle`, `walk`, `attack`. Enthält die Herleitung des Takts (Bein als Pendel) und die Messwerte des Laufzyklus im Kopfkommentar. |
| `furloc-rig.py` | Riggt den Furloc-Fischer (18 Knochen) mit `idle`, `walk`, `attack`. **Vier Gelenke je Bein** und ein Laufzyklus, der aus der Sohlenbahn per Zweigelenk-IK rückwärts gerechnet wird — die Antwort auf Surtrs Gangfehler. Der Dreizack bekommt eine **Richtungsvorgabe** statt eines Winkels, damit der Stich nicht seitlich ausschert. |
| `furloc-volk-rig.py` | Riggt die fünf übrigen Figuren des Furloc-Volkes (`--figur Krieger\|Haeuptling\|Kind\|Aeltester\|Schamane`) nach demselben Verfahren wie `furloc-rig.py`, mit einer **je Figur nachgemessenen** Gelenktabelle. Quelle ist immer die `-roh`-Datei, nie das eigene Ergebnis. |
| `furloc-krieger-rigify.py` | **Baut den ausgelieferten Furloc-Krieger** aus `assets/upload/furloc_krieger.glb` (handanimiertes Rigify-Skelett, 160 DEF-Knochen). Reines Einbauen statt Reparieren: Clipnamen (Action **und** NLA-Spur — der Exporter nimmt die Spur), Maßeinheit, Sohlenlage, Material aus der `-roh`-Datei. Misst das Eigentempo des Gangs und staucht nur **innerhalb eines Kadenzbandes**. |
| `meshy-anim-uebernehmen.py` | Reparaturwerkstatt für ein von **Meshy auto-geriggtes** Modell: baut einen fehlenden Leerlauf aus der Bindepose, hebt die Sohle je Bild aus dem Boden, gibt Speer und Schild eigene Knochen mit Weltrichtungsführung, sucht unter mehreren Angriffen den schleifenfähigen. Baute bis 08/2026 den Krieger; seit dem handanimierten Upload steht dafür `furloc-krieger-rigify.py`. Bleibt als Weg für den nächsten Auto-Rig-Upload. |
| `spieler-vermessen.py` | Vermisst eine humanoide GLB und liefert die Landmarken (Sohle, Schritt, Hüfte, Taille, Schulter, Hals, Beinachsen, Knie, Knöchel, Ballen, Armachse, Blickrichtung). Arbeitet über die **Mittelsäule** — sonst hält es in einer A-Pose den Spalt zwischen Arm und Rumpf für den Schritt. |
| `spieler-rig.py` | Riggt den nackten Basis-Spielerkörper (24 Knochen) mit `idle`, `gehen`, `rennen`, `angriff`. Die Knochennamen sind **Tripos Auto-Rig-Schema** (`Hip`, `Spine01`, `R_Hand` …), weil `client/src/player/AvatarRig.ts` und `mixamo-to-avatar.mjs` danach suchen. Knochenpunkte kommen aus `spieler-vermessen.py`, nicht aus einer Tabelle — vom Spielerkörper wird es mehrere geben. Beckensenkung und Zyklusweg sind **gerechnet**, `gehen`/`rennen` tragen Wurzelbewegung (AvatarRig misst sie und normiert `speedRatio` daran). |
| `rig-idle.py` | Vorgänger: gibt einem statischen Modell vier Knochen auf der Hochachse und eine Idle-Animation. Für Figuren ohne Beinbewegung. |
| `gang-diagnose.py` | Misst einen Laufzyklus nach: Fußrutschen, Bodendurchdringung, Standphasenanteil, Sohlenneigung. Das Gegenstück zu jeder Gangarbeit — **erst messen, dann urteilen**. |
| `mixamo-to-avatar.mjs` | Überträgt Mixamo-Animationen auf ein Modell mit eigenem Rig (Weltdrehung relativ zur Bindepose, handgeschriebene Knochentabelle). Läuft in Node mit three, ohne Blender. |
| `glb-anim-probe.mjs` | Wertet die Animationen einer GLB aus und zeigt, was die Knochen tatsächlich tun. Gegenprobe zu `mixamo-to-avatar.mjs`. |
| `_surtr-blick.mjs` | Misst im laufenden Client den Winkel zwischen Blickrichtung und Bewegungsrichtung. Blickrichtung **messen statt ansehen** — daran ist die Völva zweimal gescheitert. |

## GLB inspizieren und reparieren

| Werkzeug | Zweck |
|---|---|
| `glb-vorschau.py` | Rendert ein GLB als Vorschaubild, ohne den Client zu starten. |
| `glb-bbox.js` | Bounding-Box im Szenenraum (Knotenbaum durchlaufen, Transformationen anwenden). |
| `glb-size-check.mjs` | Weltraum-Bounding-Box plus größte Knotenskalierung, ohne three/Babylon. |
| `glb-dump.js` | Knotenbaum, Mesh-/Skin-/Material-Übersicht, Puffergrößen. |
| `glb-inspect.js` | Wurzelskalierungen und Materialinfos. |
| `glb-mesh-info.js` | Meshnamen, Primitiv-Attribute, Materialverweise. |
| `glb-node-xf.js` | Welt-Transformationen einzelner Knoten, reine Mat4-Mathematik. |
| `glb-uv-dump.js` | UV-Bereiche und Vertexgeometrie. |
| `glb-ascii.js` | ASCII-Projektionen aus den echten POSITION-Daten. |
| `inspect-glb.cjs`, `inspect-glb2.cjs` | Einzeiler-Übersicht: Meshes, Primitive, Skins, Knoten, Dateigröße. |
| `glb-glut.py` | Leitet aus der BaseColor eine Emissive-Karte ab und bettet sie ein — Lava und Glut leuchten damit im Spiel. |
| `glb-textur-verkleinern.py` | Verkleinert eingebettete Texturen einer GLB. |
| `glb-texture-jpeg.mjs` | Kodiert eingebettete PNG-Texturen nach JPEG um (Dateigröße). |
| `fix-glb-buffer-length.mjs` | Repariert falsche `buffers[0].byteLength` aus AssetRipper. Three toleriert das, Babylon validiert streng. |
| `fix-creature-models.js` | Rettet Kreaturenmodelle aus dem AssetRipper-Export — die Prefab-GLBs haben kein eingebettetes Material. |
| `recover-textures.mjs` | Holt echte Texturen aus dem Client-Export zurück (2.639 von 2.763 PNGs waren 0 Byte). |
| `test-glb-parse.ts` | Lädt GLBs durch threes GLTFLoader wie der Client, um „Model missing" außerhalb des Browsers zu reproduzieren. |

## Assets aus Valheim holen

| Werkzeug | Zweck |
|---|---|
| `asset-extractor/` | Workspace-Paket, `npm run extract:assets`. |
| `prefab-parser/` | Workspace-Paket, `npm run parse:prefabs` → `prefabData.json`. |
| `assetripper/` | Arbeitsverzeichnis von AssetRipper (Ex- und Import). |
| `extract-hd-bundle.py` | Zieht die HD-Grastexturen aus dem WillybachHD-Bundle. |
| `extract-texture-arrays.py` | Holt `Texture2DArray` und `Texture3D` aus dem Client — der normale Export enthält nur `Texture2D`, Valheims Boden liegt aber als Array vor. |
| `dump-envsetup.mjs` | Extrahiert Valheims echte EnvSetup-Lichtwerte für `shared/src/environment.ts`. |

## Live-Prüfung im Browser (`pw-*`)

Playwright-Skripte gegen den laufenden Client. Screenshots und Messwerte
statt Vermutungen.

| Werkzeug | Zweck |
|---|---|
| `pw-shots.mjs` | Allgemeine Screenshot-Strecke, robust gegen Reconnects. |
| `pw-grafik-messung.mjs` | Die Kennzahlen hinter `Docs/07-Grafik-Konzept.md` aus der laufenden Szene. |
| `pw-sky-verify.mjs` | Prüft ValheimSkys GLSL headless — rohes GLSL sieht kein `tsc`. |
| `pw-daylight-shots.mjs` | Erzwingt Morgenlicht clientseitig und schießt definierte Motive. |
| `pw-terraform-check.mjs` | Belegt Höhenänderungen numerisch **und** im Bild. |
| `pw-placement-check.mjs` | Bau-Modus, Modus-Menü, Terrain-Operationen; jeder Abschnitt an unberührter Weltstelle. |
| `pw-inventory-check.mjs` | Hotbar, Ausrüsten, Inventar-Overlay samt Drag & Drop. |
| `pw-creature-probe.mjs`, `pw-deer-*.mjs`, `pw-texture-check.mjs` | Kreaturen: Spawn, Modellzustand, Materialien, Nahaufnahmen. |
| `pw-grass-*.mjs`, `pw-hd-gras-vergleich.mjs` | Gras: Instanzpositionen, Rendering, Wasserkante, HD-Vergleich. |
| `pw-babylon-*.mjs` | Babylon-Grundlagen: Container, Instanzen, Bucket-Zustand, Basisbild. |
| `pw-firefox-app.mjs`, `pw-firefox-drag.mjs`, `pw-firefox-rmb.mjs` | Firefox-Eigenheiten: WebGL nur mit Xvfb, `movementX/Y` ohne Pointer-Lock, Maustastenverhalten. |
| `pw-cam-override.mjs`, `pw-scene-probe.mjs`, `pw-statue-look.mjs`, `pw-glb-probe.mjs`, `pw-retry-probe.mjs`, `pw-placeholder-preview.mjs`, `pw-clock-check.mjs`, `pw-caps.mjs` | Punktuelle Sonden für einzelne Fehlerbilder. |
| `shot-stats.mjs` | Bildstatistik eines Screenshots — die Zahlen hinter dem Grafikkonzept. |
| `shot-upload-server.mjs` | Nimmt Screenshots von einem anderen Rechner entgegen (playwright-gpu läuft auf echter Grafikhardware, deren Dateisystem von hier nicht erreichbar ist). |
| `png-stats.mjs` | Dekodiert ein PNG vollständig und gibt Min/Max/Mittel je Kanal aus. |

## Server, Netz und Welt

| Werkzeug | Zweck |
|---|---|
| `deploy.sh` | Bringt Code und Assets auf die Container (`bau`/`live`/`beide`, `--assets`). Prüft **lokal** Typecheck und Tests, bevor etwas übertragen wird, baut auf Live den Client (dort liefert nginx aus `dist`) und startet neu. Das Weltdokument geht NUR mit `--karte` mit; Spielstände und `server.yml` nie. |
| `worldlayout-mcp/` | MCP-Server für das Weltlayout (lesen, setzen, ausrollen). Benutzt `sanitizeWorldLayout` aus `shared`. |
| `ws-check.mjs` | Prüft, ob `/ws` steht — lokal und über den Reverse-Proxy. |
| `dump-spawn-zdos.ts` | Listet ZDOs nahe dem Weltursprung aus einem Save. |
| `scan-missing-models.mts` | Prüft für jedes renderbare Prefab, ob seine GLB existiert und Meshes enthält. |

## Bekannte Mängel

Hier stehen Werkzeuge, die **falsche Ergebnisse liefern** — damit niemand
ihren Zahlen glaubt, bevor sie repariert sind.

- `scan-missing-models.mts` enthält einen fest verdrahteten Windows-Pfad und
  meldet dadurch alle 3.580 Modelle als fehlend.
- `glb-vorschau.py` zählt Blenders Skelett-Hilfsobjekt „Icosphere" als
  zweites Modell und rahmt gerigte Figuren dadurch falsch ein.
- `_pruef.mjs` ist ein Wegwerf-Schnipsel ohne Kopfkommentar. Wenn es
  gebraucht wird, gehört ihm einer; sonst kann es weg.
