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

## Elemente der Dungeon-Kits → `tools/elements/`

Die Skripte, die **Dungeon-Bausteine** erzeugen und prüfen, liegen in einem
eigenen Unterordner: [`tools/elements/`](elements/README.md). Sie kamen am
04.09.2026 aus `~/wov-ai/elements/` und `~/wov-ai/pipeline-1.0/` herein — der
Kit, an dem gerade gearbeitet wird (`DG_StoneVault`), war der einzige, dessen
Bauskript ausserhalb des Repos lag.

| Unterordner | Inhalt |
|---|---|
| `elements/blender/` | Bauskripte: `make-stonevault.py` (die 12 Module des Kits), `make-elements.py`, die `compose-*.py`-Nachweisbilder. |
| `elements/pruefung/` | Sonden und Messungen: `check-*`, `measure-*`, `render-*`, `zaehle-naht.py`, `dach-sonde.py`, `strahl-sonde.py`, `stonevault-kantensonde.ts`. |
| `elements/pipeline/` | Textur-Pipeline (`texture-kit.py`, `make-normal.py`, `make-moss.py`, `make-frost.py`, `make-wet.py`) und die Browser-Aufnahmen; Quelltexturen unter `elements/pipeline/quellen/`. |
| `elements/ts/` | Noch ohne Werkzeug — für die TypeScript-Skripte aus Vorhaben 1; `elements/ts/README.md` sagt an Ort und Stelle, was hierher gehört. |

Dort gelten zusätzlich drei Konventionen, jede mit einem Wächter in
`scripts/run-tests.mjs` (schnell und assetfrei — sie lesen nur Text):

- **Kopfzeile.** Die erste Kommentarzeile jeder Datei beginnt mit `Erzeugt:`,
  `Prüft:` oder `Hilfsmittel:` — `tools/elements/pruefe-koepfe.mjs`.
- **Orte.** Kein Skript verdrahtet einen Pfad ausserhalb des Repos; Eingaben
  kommen aus `$WOV_MODELLE` (Vorgabe `assets/models`), Ergebnisse gehen nach
  `$WOV_ELEMENTE_AUS` (Vorgabe `~/wov-elemente`) — `tools/elements/pruefe-pfade.mjs`.
- **Verzeichnis.** Jeder Pfad, den diese Datei oder
  `tools/elements/README.md` nennt, existiert; und jede Datei unter
  `tools/elements/` steht in einer der beiden — `tools/elements/pruefe-readme.mjs`.

Seit dem 04.09.2026 sind die alten Orte `~/wov-ai/elements/` und
`~/wov-ai/pipeline-1.0/` geleert; sie tragen nur noch je eine
`~/wov-ai/…/VERSCHOBEN.md` und ihre Ergebnisordner.

### Was ein Pfad in Backticks hier bedeutet

Seit S4 ist eine Code-Spanne, die wie ein Pfad aussieht, eine **Zusage**:
Diese Datei gibt es. Der Wächter oben liest beide README und schlägt jeden
Pfad nach. Zwei Ausnahmen macht er, und beide folgen der Regel ganz oben —
Rezept, nicht Ergebnis:

- **Erzeugnisse** (`assets/…`, `out/…`, ein blosser Bild- oder Modellname)
  werden nicht nachgeschlagen. Sie sind gitignored und fehlen im
  CI-Checkout; ihre Existenz zu verlangen hiesse, den Testlauf an
  `assets/` zu binden, das S3 gerade gelöst hat.
- **Kein Pfad ist,** was Platzhalter (`<skript>`), Umgebungsvariablen
  (`$WOV_MODELLE`), Heimat- (`~/…`) oder Wurzelpfade (`/ws`) enthält.

Wer etwas nennt, das es (noch) nicht gibt — ein geplantes Skript, eine
gelöschte Datei, eine Datei ausserhalb des Repos —, schreibt es **ohne**
Backticks oder mit seinem vollen Ort ausserhalb. Sonst behauptet der Text
etwas, das der nächste Leser vergeblich sucht. Beim ersten Lauf des
Wächters waren das neun Stellen in beiden Dateien zusammen, und sechs
Dateien standen in keiner von beiden.

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
| `eiche-texturen.py` | Laubkarte und Rinde der Eiche — die einzige Baumart ohne Fremdmaterial. |
| `felsen-texturen.py` | Drei Gesteinsarten (Granit kristallin mit Moos, Basalt feinkörnig dunkel, Sandstein waagerecht geschichtet). Periodisch, weil die Kugelprojektion die Textur mehrfach über den Fels wiederholt. |
| `busch-texturen.py` | Laubkarte und Rinde je Strauchart, alle zehn gerechnet statt gerippt. Fünf Blattformen (rund-gesägt, lanzettlich, gefiedert, derb-gezähnt, Schuppe) plus Nadelquirle, dazu Beerendolden, einzeln sitzende Früchte und Blütenähren; Rinde wahlweise längsrissig oder glatt mit Lentizellen. 128² statt 256² — ein Busch nimmt im Bild nie so viel Platz ein wie ein Baum. |
| `blumen-texturen.py` | Je Blumen- und Unkrautart EINE Karte (Straucharten brauchen zwei, weil ihr Holz sichtbar ist — eine Blume hat keins). Vier Kartenbauarten (Stengel mit Blüte, beblätterter Stengel, Grashorst, Farnwedel) und sieben Blütenformen von der nickenden Glocke bis zum Distelkorb. 96², gefiederte Arten 128². |
| `grabhuegel-texturen.py` | Stein, Grassode, Holz, Schild-Atlas und Segel des Grabhügels. |
| `gen-grass-texture.py` | Die drei Gras-Atlanten für die Bündel-Meshes (`grass_meadows_gen`, `grass_heath_gen`, `grass_toon1_yellow_gen`) — Wiese, Heide, Sumpf. Zeichnet in **drei senkrechte Spalten**; dieselbe Aufteilung greift `clutter-meshes.py` als UV ab, wer sie hier verschiebt, muss dort mitziehen. (Schrieb bis 08/2026 in den Asset-Ordner des three.js-Vorläufers, der hier nicht existiert.) |
| `clutter-texturen.py` | Die acht Clutter-Texturen, die `gen-grass-texture.py` nicht abdeckt: Waldboden (grün/braun), Farnwedel (grün/Sumpf), Strauch, Heideblume, Schilf, Seerosenblatt. Alle nach derselben Konvention wie die Gras-Atlanten — **Vollbild-Billboard, v=1 ist der Boden**, weil der HD-Umschalter in `GrassClutter.ts` die Textur tauscht, ohne die UVs anzufassen. `forest_groundcover(_brown)` kachelt waagerecht (ENTRIES setzt dort `texRepeatU: 2`). Deckungsgrade bewusst niedrig gehalten — 60 % gefüllte Halmkarten waren der „Neonteppich" aus dem `MEADOWS_TINT`-Kommentar. |
| `wasser-texturen.py` | Die vier Wassertexturen für `WaterPlugin.ts` plus `grass_terrain_color.png`. **Achtung:** `water_normals_real.png` ist Unity-DXT5nm gepackt — `(1, y, y, x)`, X liegt im Alphakanal und B muss exakt gleich G sein, sonst kippt das Wasser dauerhaft in eine Richtung. Die Schaum-Mittelwerte gehen als feste Divisoren in den Shader ein. |
| `item-icons.py` | Die 25 Item-Icons aus `itemDefs.ts` (`icon:`) plus `cultivate_ground` aus `PieceTable.ts` als 64² RGBA, vierfach überabgetastet gezeichnet. `--nur name1,name2` für einzelne, `--blatt` legt eine Übersicht nach `out/icons.png`. Die Bauteil-Icons landen im selben Ordner `/assets/sprites/`; `hoe` und `stone` fallen mit Gegenstands-Icons zusammen, `cultivate_ground` ist das einzige eigene. |
| `terrain-texturen.py` | Die neun Bodentexturen für `TerrainSplat.ts` — 16 Albedo-Tiles im 256×4096-Stapel, der Variety-Noise und sieben Normal-Maps. Drei Vorgaben sind nicht frei wählbar: die Tile-Reihenfolge (`TILE`-Enum), die Kanalmittel des Noise (im Shader als `VAR_MITTE_*` fest verdrahtet) und die Periodizität, weil der Shader mit `fract(uv)` kachelt. `--nur splat\|noise\|normal` baut einzelne Gruppen. |
| `texture-catalog.py` | Katalogisiert die extrahierten Fremdtexturen nach Unity-Namenskonvention (`_d` Albedo, `_n` Normal, `_m` Maske, `_e` Emission). |
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

### Der Asset-Speicher: Reihenfolge ist Pflicht

```
npm run store:aufbereiten
```

führt die beiden Store-Werkzeuge in der EINZIG richtigen Reihenfolge aus:

1. `tools/store-vegetation-aufbereiten.mjs` schreibt `assets/store-lab/vegetation/`,
2. `tools/store-prefabs.mjs` schreibt `shared/src/storePrefabs.ts` (**mit `tsx`**, nicht mit `node` — die Einsortierregel ist TypeScript).

Andersherum ist es kein Fehler, sondern ein STILLER Rückschritt. Der
Generator setzt je Vegetationsmodell `model: 'store-lab/vegetation/<name>'`,
**wenn die aufbereitete Datei da ist**, und sonst `'store/vegetation/<name>'`
— er sieht nach, statt zu glauben. Läuft er vor der Aufbereitung, zeigen
alle 94 Einträge auf den ROHEN Store: Der Wald steht dann, er ist nur
grau, und kein Test wird davon rot. Umgekehrt genügt ein Lauf in der
richtigen Reihenfolge; `git diff shared/src/storePrefabs.ts` zeigt, ob es
gewirkt hat (94 Zeilen mit `store-lab/`).

Beide Werkzeuge sind deterministisch: Ein zweiter Lauf ändert nichts.
Ohne `assets/store` (Symlink auf den Store ausserhalb des Repos) brechen
sie ab, statt eine halbe Wahrheit zu schreiben.

| Werkzeug | Zweck |
|---|---|
| `glb-vorschau.py` | Rendert ein GLB als Vorschaubild, ohne den Client zu starten. |
| `vorschaubilder.py` | Rendert Icon-Vorschaubilder für VIELE GLBs in EINEM Blender-Lauf (Kamera je Modell an dessen Hüllbox ausgerichtet, transparenter Hintergrund, 160²) — Bildquelle für die Namensliste in client/src/editor/SpawnPanel.ts. Modelle ohne Geometrie liefern bewusst kein Bild, nur eine Meldung im Log. `--liste` erwartet `Name<TAB>Pfad` je Zeile, Ablage unter `assets/vorschau/<Name>.png`. |
| `glb-bbox.js` | Bounding-Box im Szenenraum (Knotenbaum durchlaufen, Transformationen anwenden). |
| `glb-size-check.mjs` | Weltraum-Bounding-Box plus größte Knotenskalierung, ohne three/Babylon. |
| `asset-manifest.mjs` | Baut `assets/manifest.json`: Hüllbox (min/max je Achse, daraus Breite/Höhe/Tiefe), Dreieckszahl, Dateigröße, Materialien, eingebettete Bilder, Animationen (Name + Dauer), mesh-lose Rigs (kein einziger Dreiecksindex) und Foliage-Kennzeichen (EIGENE_FLORA) -- je GLB unter `assets/models/`. Braucht `tsx` statt `node` (liest `@wov/shared` mit). **ERGÄNZT** das Manifest: was hier fehlt, wird aus dem bisherigen Stand übernommen und unter `uebernommen` namentlich geführt -- ein Arbeitsbaum mit Teilbestand löscht sonst Einträge aus einer getrackten Datei. `--neu` schreibt es ohne Rücksicht auf den Vorgänger (Maschine mit VOLLEM Bestand; nur so verschwindet eine Leiche). `--abgleich` vergleicht zusätzlich gegen `renderScale` in `shared/src/prefabs.ts` (nur Bericht, ändert nichts), löst dabei `MODELL_ALIAS` auf und führt abgeleitete Module (`RockVault*`) auf ihr Stammmodul zurück, statt jede Abweichung des Stamms ein zweites Mal zu listen. `--ziel <pfad>` schreibt woandershin, statt die getrackte Datei anzufassen -- so prüft `tools/test/generiert-getrennt.ts` das Werkzeug, ohne es zu beschädigen. `assets/generiert/` (zur Laufzeit gebaute Säle) bleibt bewusst draussen. |
| `store-messprobe.mjs` | Misst die GLB des Asset-Stores, ohne Engine: Hüllbox in Modellkoordinaten, Ursprungslage (min y), Knotenbaum mit Weltort und Hüllmitte JE Knoten, gespiegelte Knoten (negative Determinante der Knotenmatrix), Kollisionsknoten nach Namensmuster, Dreiecke/Materialien/Bilder — und den Abgleich gegen die `bounds` aus der Prefab-Liste des Stores. Argumente sind Prefab-Ids, Store-Pfade oder Modellnamen aus `assets/models/`; `--uebersicht` zählt den GANZEN Store durch (Modelle unter y = 0, Riesen > 80 m, leere Meshes, Kollisionsdateien). Die Knotenmatrix-Mathematik ist wortgleich aus `glb-size-check.mjs` übernommen, liest aber zusätzlich `byteStride` mit — die Store-Exporte sind interleaved, und dicht gepackt gelesen ergäben sie stillen Unsinn. Der Store liegt ausserhalb des Repos; sein Ort kommt aus `$WOV_STORE`. Die Auswertung, auf die es hinausläuft, steht in `design/store-konventionen.md`. |
| `manifest-zuordnung.ts` | Hilfsmittel für den Abgleich: liest `MODELL_ALIAS` aus `client/src/engine/AssetManager.ts` (Prefab → GLB-Datei; wirft, wenn die Tabelle verschoben ist) und baut Fels-Modul → Stammmodul aus `KIT_DERIVATIONS`. Genutzt von `asset-manifest.mjs` und `modell-abgleich.ts`. |
| `store-prefabs.mjs` | Erzeugt ZWEI Dateien aus `assets/store/manifest.json` und `assets/store/prefabs.json`. `shared/src/storePrefabs.ts` — die Asset-Brücke, was Server und Spiel brauchen: 569 `PrefabDef` (Name = `id` aus prefabs.json, `model` = `store/<pfad>` bzw. `store-lab/<pfad>` für Bauer Bs abgeleitete Vegetation, `renderScale` aus der Hüllbox, Flag `PERSISTENT`), `STORE_MODELL_NAMEN`, `STORE_NICHT_STREUEN`. Und `shared/src/storeKatalogDaten.ts` — `STORE_KATALOG` mit ALLEN 670 vorhandenen Dateien, auch Texturen, Töne und Kollisionsnetze, sauber einsortiert nach Art/Gruppe/Untergruppe. **Der Katalog steht bewusst in einer eigenen Datei und NICHT im Barrel** (`shared/src/index.ts`): Er wiegt 291 KB Quelltext und wird nur vom Editor gelesen; zusammen mit den PrefabDefs in einer Datei lud ihn jeder Spieler mit (gemessen 08.09.2026: 670-mal `lizenzstatus` im ausgelieferten Spiel-Chunk, 682 KB roh / 118,66 KB gzip — nach dem Schnitt 0 Treffer und 421,90 KB / 64,57 KB). Wer ihn braucht, nennt seinen Pfad: `@wov/shared/src/storeKatalogDaten.js`. Die Einsortierregel steht NICHT hier, sondern in `einsortieren()` in `client/src/editor/StoreKatalogDaten.ts` — dieselbe, mit der der Gegenstands-Katalog seine Schubladen baut; bis zur Zusammenführung gab es sie zweimal, und die beiden widersprachen sich bei 477 der 670 Einträge. Deshalb läuft der Generator mit **`tsx`**, nicht mit `node`. Wächter: `tools/test/store-einsortierung.ts` (Einsortierung) und `tools/test/store-erzeugung.ts` (Determinismus beider Dateien, Aktualität beider, und dass das Barrel den Katalog nicht exportiert). Deterministisch und idempotent: zweiter Lauf byteidentisch, kein Zeitstempel. `--pruefen` schreibt nichts und endet mit Code 1, wenn die eingecheckte Datei veraltet ist; `--nach <ordner>` schreibt beide Erzeugnisse woandershin (nutzt `tools/test/store-erzeugung.ts`, damit ein Test keine getrackte Quelldatei anfasst). Typen und der Spiegelungs-Schalter stehen von Hand in `shared/src/storeKatalog.ts`. Ohne `assets/store` bricht der Lauf mit Code 2 ab. |
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
| `store-vegetation-aufbereiten.mjs` | Bereitet die 94 Vegetations-GLBs aus `assets/store/vegetation/` nach `assets/store-lab/vegetation/` auf (gitignoriert, erzeugt) und schreibt daneben `BERICHT.json` mit Materialien vorher/nachher, Rolle, Tönung, Dreiecken und Hüllbox je Modell. Drei Dinge: (1) **Materialien zusammenlegen** — alles, was sich Bild, Alphamodus und Tönung teilt, wird EIN Material; Rinde und Laub bleiben getrennt, weil ihre UVs KACHELN (bis u = 8,5) und ein Atlas mit Wiederholung unmöglich ist. (2) **Verlorene Zuweisungen zurückholen** — 33 Primitive zeigen im Store auf ein texturloses `DefaultMaterial`; 19 finden ihr Material über den SHA1 ihrer POSITION-Bytes in einem Geschwistermodell, die restlichen 14 über die Bauart (Laubkarten haben exakt 2,00 Vertices je Dreieck, Körper 0,65–1,85). (3) **Tönen** — die Laub-, Nadel- und Ahorn-Atlanten sind Helligkeitsmasken (gemessen R = G = B, Laub 0,452); ohne `baseColorFactor` ist das Laub grau. Der Faktor des Quellmaterials hat VORRANG und wird je Material übernommen (39 von 151, in fünf verschiedenen Werten — deshalb steckt er im Zusammenlegungsschlüssel und nicht nur die Rolle). Wo keiner steht, kommt der Wert aus dem Original-Material der Spieldaten: dessen Laub-Shader färbt die graue Karte mit einer Ober- und einer Unterfarbe, glTF kennt nur einen Faktor, gesetzt wird das MITTEL aus beiden (`UNITY_LAUB` im Werkzeug, gemessen 08.09.2026). (4) **Die verschachtelten LOD-Schalen abtragen** (Vorgabe an, `--lod-behalten` stellt den alten Zustand her) — 34 Modelle tragen ihre eigene Fernstufe MIT IN DERSELBEN DATEI, als Kind der Nahstufe (`Tree_1E1` hält `Tree_1E1_1` und `Tree_1E1_2`, `Massive_Tree_1A1 1 Dark` hält `Massive_Tree_1A1_LOD_1`). Unity hätte umgeschaltet, Babylon zeichnet alle übereinander; die Abwehr des Clients (`AssetManager`, `/^lod\d/i`) greift nicht, weil kein Store-Name mit „lod" beginnt. Das sind 149.362 von 584.136 Dreiecken (25,6 %) und 7,8 MiB. Erkannt an drei Bedingungen ZUSAMMEN, nie am Namen allein: Der Name behauptet eine Stufe, der Knoten hängt in oder neben einer behaltenen Schale, und er misst sich kleiner mit einer Hüllbox innerhalb der behaltenen (Toleranz 0,2 % der längsten Kante). Der Bericht nennt jeden gefallenen Knoten UND jeden, der wie einer hiess und stehenblieb. **Sichtbare Folge, am Bild nachgesehen:** Die Krone wird nicht dünn, sondern SAUBER. Vorher lagen zwei bis drei Laubschalen ineinander und ergaben eine dunkle, flimmernde Masse mit z-Kampf; nachher liest man einzelne Blattbüschel und den Astverlauf, und das Kronendach lässt etwas mehr Himmel durch. Wer die alte Dichte trotzdem will, erhöht die Streuzahl in `storeFlora.ts` — nicht die Schalen, die kosteten ein Viertel aller Dreiecke für ein zufällig verschattetes Doppelbild. Ändert den JSON-Teil der GLB; der BIN-Block wird bufferView-weise neu gepackt und innerhalb eines Views auf die Spanne der überlebenden Accessoren zugeschnitten — die überlebende Geometrie bleibt bitgleich (nachgewiesen an allen 145 Primitiven), der zweite Lauf byteidentisch, aber `bounds` aus `prefabs.json` gilt für die aufbereitete Datei NICHT mehr: Die nachgemessene `huellbox` steht in BERICHT.json, und `store-prefabs.mjs` nimmt sie für `renderScale`. Prüfer: `tools/test/store-vegetation.ts`, `tools/test/store-flora.ts`. |
| `welt-flora-auffrischen.mjs` | Schreibt die Kuratierungslisten (`RegionDef.vegetation`) einer Weltdatei aus den `*_FLORA_NAMEN` des Codes neu. Hintergrund: Die Liste in `server/data/welten/dev.json` ist eine ABSCHRIFT, kein Verweis — `STORE_FLORA_AKTIV` erreicht eine bestehende Welt deshalb nicht, und zwar lautlos (die alten Prefabs sind alle noch registriert, es wächst also weiter etwas). `--nur-pruefen` schreibt nichts, meldet je Region die Abweichung und endet mit Code 1, wenn Datei und Code auseinandergehen. Ohne `--nach <pfad>` wird NIE geschrieben, und Quelle = Ziel ist verboten: Eine Weltdatei ist Handarbeit. Braucht `tsx`. |
| `fix-glb-buffer-length.mjs` | Repariert falsche `buffers[0].byteLength` aus AssetRipper. Three toleriert das, Babylon validiert streng. |
| `fix-creature-models.js` | Rettet Kreaturenmodelle aus dem AssetRipper-Export — die Prefab-GLBs haben kein eingebettetes Material. |
| `recover-textures.mjs` | Holt echte Texturen aus dem Client-Export zurück (2.639 von 2.763 PNGs waren 0 Byte). |
| `test-glb-parse.ts` | Lädt GLBs durch threes GLTFLoader wie der Client, um „Model missing" außerhalb des Browsers zu reproduzieren. |

## Fremdassets extrahieren (historisch, seit Block A ungenutzt)

| Werkzeug | Zweck |
|---|---|
| `asset-extractor/` | Workspace-Paket, `npm run extract:assets`. |
| `prefab-parser/` | Workspace-Paket, `npm run parse:prefabs` → `prefabData.json`. |
| `assetripper/` | Arbeitsverzeichnis von AssetRipper (Ex- und Import). |
| `extract-texture-arrays.py` | Holt `Texture2DArray` und `Texture3D` aus dem Client — der normale Export enthält nur `Texture2D`, der Boden liegt dort aber als Array vor. |
| `dump-envsetup.mjs` | Extrahiert die echten Lichtwerte des Vorbilds für `shared/src/environment.ts`. |

## Live-Prüfung im Browser (`pw-*`)

Playwright-Skripte gegen den laufenden Client. Screenshots und Messwerte
statt Vermutungen.

| Werkzeug | Zweck |
|---|---|
| `pw-shots.mjs` | Allgemeine Screenshot-Strecke, robust gegen Reconnects. |
| `pw-grafik-messung.mjs` | Die Kennzahlen hinter `Docs/07-Grafik-Konzept.md` aus der laufenden Szene. |
| `pw-sky-verify.mjs` | Prüft das GLSL der Himmelskuppel headless — rohes GLSL sieht kein `tsc`. |
| `pw-daylight-shots.mjs` | Erzwingt Morgenlicht clientseitig und schießt definierte Motive. |
| `pw-terraform-check.mjs` | Belegt Höhenänderungen numerisch **und** im Bild. |
| `pw-placement-check.mjs` | Bau-Modus, Modus-Menü, Terrain-Operationen; jeder Abschnitt an unberührter Weltstelle. |
| `pw-inventory-check.mjs` | Hotbar, Ausrüsten, Inventar-Overlay samt Drag & Drop. |
| `pw-creature-probe.mjs`, `pw-deer-*.mjs`, `pw-texture-check.mjs` | Kreaturen: Spawn, Modellzustand, Materialien, Nahaufnahmen. |
| `pw-grass-*.mjs` | Gras: Instanzpositionen, Rendering, Wasserkante. |
| `pw-editor-saal-bauen.mjs` | Das Fenster zu E8 UND E9: einen Saal aus dem Editor-Formular „Neuer Saal" bauen (4x3), Seite neu laden, Modul im Katalog, Dokument anlegen, Saal setzen, Kanten schliessen, speichern, 3D-Bild, im Spiel betreten, Diagonale laufen, Lichtfugen zaehlen -- danach der Loeschweg: das Loeschen wird abgelehnt und nennt das Dokument, `dungeon delete` ueber `__vb.admin`, zweiter Anlauf geht durch, Registry und `assets/generiert` deckungsgleich. Der Lauf raeumt hinter sich auf und ist damit wiederholbar. Braucht `dungeons.modulbau: true` in `server/data/server.yml` UND einen Serverneustart -- Flags erreichen einen Client nur beim Anmelden; fehlt der Schalter, bricht der Lauf mit genau diesem Satz ab. Laeuft LOKAL, nicht auf wov-dev. Bilder unter `~/.cache/wov-stonevault-sicht/`. |
| `pw-babylon-*.mjs` | Babylon-Grundlagen: Container, Instanzen, Bucket-Zustand, Basisbild. |
| `pw-firefox-app.mjs`, `pw-firefox-drag.mjs`, `pw-firefox-rmb.mjs` | Firefox-Eigenheiten: WebGL nur mit Xvfb, `movementX/Y` ohne Pointer-Lock, Maustastenverhalten. |
| `pw-cam-override.mjs`, `pw-scene-probe.mjs`, `pw-statue-look.mjs`, `pw-glb-probe.mjs`, `pw-retry-probe.mjs`, `pw-placeholder-preview.mjs`, `pw-clock-check.mjs`, `pw-caps.mjs` | Punktuelle Sonden für einzelne Fehlerbilder. |
| `shot-stats.mjs` | Bildstatistik eines Screenshots — die Zahlen hinter dem Grafikkonzept. |
| `shot-upload-server.mjs` | Nimmt Screenshots von einem anderen Rechner entgegen (playwright-gpu läuft auf echter Grafikhardware, deren Dateisystem von hier nicht erreichbar ist). |
| `png-stats.mjs` | Dekodiert ein PNG vollständig und gibt Min/Max/Mittel je Kanal aus. |
| `flora-zensus.ts` | Streut je Biom 13x13 Zonen einer Testinsel und zaehlt die Pflanzen nach Art - beantwortet 'waechst das ueberhaupt, und wie oft?'. |
| `hoehen-histogramm.ts` | Tastet ein Weltdokument ab und misst die Hoehenverteilung der Landflaeche. Sagt, wie viel Welt ein Hoehenfenster wie maxAlt ueberhaupt trifft. |
| `modell-abgleich.ts` | Prueft Whitelist, Prefab-Tabelle und Plattenbestand gegeneinander. Faellt eine der drei aus, bleibt eine Art lautlos unsichtbar. |
| `gen-coverage-mips.mjs` | Baut coverage-erhaltende Mipmaps fuer Alpha-Test-Texturen und meldet die Deckung je Stufe. Beantwortet vor allem: Braucht diese Maske die Korrektur ueberhaupt? |
| `listen-putzen.ts` | Filtert die Kuratierungslisten eines Weltdokuments gegen die Whitelist. Ein unbekannter Name streut nie, verwirrt aber jeden Leser. |

## Server, Netz und Welt

| Werkzeug | Zweck |
|---|---|
| `wov-update.sh` | Holt den aktuellen Stand aus Git und stellt den Container darauf um. Bricht ab, wenn der Arbeitsbaum schmutzig ist — der Commit soll die Wahrheit sagen. Typecheck und Tests laufen **ohne Pipe**, ein Fehlschlag startet nichts. Auf `live` baut es den Client nach `dist.neu` und tauscht erst danach. Gesundheitsprüfung fragt den Server, statt `systemctl is-active` zu glauben. `server/data/` wird nie angefasst. Ersetzt deploy.sh (16.08.2026 gelöscht) — der schob ein Tar von der Entwicklungsmaschine und verschluckte jeden Exit-Code. |
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
