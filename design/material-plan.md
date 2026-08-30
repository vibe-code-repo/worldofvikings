---
tags: [wov, dungeon-generator-2, material, shader, design]
status: entwurf
erstellt: 2026-08-30
---

# Material-Plan: Barrow-Stilbibliothek

Teil-Ergebnis des Design-Workflows für [[Dungeon Generator 2.0]]. Betrifft die
Oberflächen-Ebene (Triplanar-PBR per `MaterialPluginBase`, siehe `PbrNebelFix.ts`
und `StandardGammaFix.ts` als Vorbild für den Plugin-Mechanismus). Referenz für
den Zielstil: Mikes Barrow-Bild (helle ruhige Steinquader, dunkles Runenholz,
sandiger Boden, warmes Fackellicht, flächig-stilisiert, kein Fotoscan-Look).

## 1. Beschaffung: Fremdquelle vs. Eigenbau

### Recherche-Ergebnis zu CC0-Quellen

Geprüft wurden Polyhaven, ambientCG, 3DTextures.me sowie stilisierte Pakete auf
itch.io/OpenGameArt:

- **Polyhaven / ambientCG / 3DTextures.me**: groß, hochwertig, aber
  ausnahmslos **fotoreale Scans/Photogrammetrie**. Polyhaven grenzt sich sogar
  explizit als "hand-crafted, kein Generative-AI" ab — aber "hand-crafted"
  heißt hier Fotoscan-Nachbearbeitung, nicht stilisierte Malerei. Diese Maps
  tragen echtes Rauschen, echte Verwitterungs-Zufälligkeit und feine
  Hoch-Frequenz-Details, die dem gewünschten flächigen Barrow-Look
  widersprechen (siehe Leitbild: ruhige Quader, gedämpfte Palette, NICHT
  fotoreal). Direkt einsetzbar nur, wenn stark heruntergerechnet/stilisiert
  nachbearbeitet — dann ist der Zeitaufwand ähnlich wie Eigenbau, nur ohne
  Kontrolle über das Ausgangsmaterial.
- **Stilisierte CC0/freie Pakete existieren**, sind aber verstreut und
  uneinheitlich in Qualität und Lizenz-Klarheit, z. B. "Stylized Textures –
  Dungeon Starter Pack" (oleekconder, itch.io, handgemalt, Stein/Dungeon-Fokus)
  oder Quaternius' Stylized-Reihen (CC0, aber Fokus Natur/Requisiten, nicht
  Architektur-Flächenmaterial). Diese Pakete wurden nur über Suchergebnisse
  geprüft, nicht die Lizenztexte selbst geöffnet (itch.io blockt automatisierten
  Zugriff) — **vor Einsatz Lizenz manuell auf der Seite verifizieren**.
- Kein Paket deckt alle 6-8 gebrauchten Materialien in einheitlichem Stil,
  einheitlicher Auflösung und einheitlichem Tiling-Maßstab ab. Mischbetrieb
  aus mehreren Quellen erzeugt Stilbrüche (unterschiedliche Pinselführung,
  unterschiedliche Kontrastkurven) — genau das Risiko, das das Leitbild
  ausschließen soll.

### Empfehlung: Eigenbau prozedural in Blender, gebacken

**Grund:**

1. **Stilkontrolle.** Shader-Node-Prozeduren (Voronoi für Steinfugen, Noise für
   Fels-Bruchflächen, Wave/Noise-Kombination für Holzmaserung) lassen sich exakt
   auf Mikes Referenzbild einregeln — Kontrastkurve, Fugenbreite, Farbpalette
   sind Parameter, keine Zufallsfunde in einer Fremdquelle.
2. **Determinismus ist Gesetz** (Projektbeschluss). Ein Blender-Skript mit
   festem Seed erzeugt bei jedem Lauf byte-identische Maps — nachvollziehbar
   versioniert, reproduzierbar nach Jahren, ohne Abhängigkeit von einer
   externen Website, die morgen offline sein kann.
3. **Theme-Varianten aus einer Quelle.** Krypta/Sumpf/Eis/Feuer sollen laut
   Beschluss über Tint + Material-Seed entstehen (Abschnitt 3). Das setzt
   voraus, dass Basis-Maps (v. a. Höhen-/Rauheits-Information) parametrisch
   und nicht fotografisch fixiert sind — ein Scan liefert genau eine Beleuchtungs-
   und Verwitterungssituation, eine Shader-Node-Prozedur liefert eine ganze
   Familie.
4. **Passt zum bestehenden Werkzeugkasten.** Blender läuft im Projekt bereits
   headless über Flatpak für andere Pipelines ([[wov-blender-ueber-flatpak]]-
   Muster: absolute Pfade unter `$HOME`, `--factory-startup`). Ein weiteres
   `tools/`-Skript reiht sich ein, statt eine neue Lizenz- und Update-Kette
   (CC0-Paket X, Version Y, Attribution-Datei Z) im Repo zu verankern.
5. **Kein Lizenzrisiko, keine Attribution-Pflicht**, kein Rätselraten, ob ein
   itch.io-CC0-Tag beim Weiterverkauf/Server-Betrieb wirklich greift.

**Gegen Eigenbau spricht** der einmalige Entwicklungsaufwand für die
Shader-Node-Graphen (Woche statt Tag) und dass Fels/Holz-Maserung von Hand
weniger organisch wirken kann als ein gutes Fotoscan-Derivat. Beides wird als
akzeptabel bewertet, weil (a) das Ergebnis exakt zum Stil passt statt
angenähert zu werden, und (b) "organisch" hier ohnehin nicht das Ziel ist —
das Leitbild verlangt ausdrücklich ruhige, flächige Formen, keine
Natur-Textur-Authentizität.

**Praktischer Kompromiss:** Ein bis zwei stilisierte CC0-Referenzpakete
(oleekconder Dungeon Starter Pack als erstes) werden **nicht direkt verbaut**,
sondern als Stimmungs-/Kontrastkurven-Referenz neben Mikes Bild gelegt, bevor
die Node-Graphen gebaut werden. Das spart Rate-Aufwand bei "wie hart ist der
Ambient-Occlusion-Kontrast bei diesem Stil üblich", ohne Lizenz- oder
Konsistenzrisiko einzugehen.

## 2. Startbibliothek: 8 Materialien

Alle Maps als **Basisfarbe (Albedo), Normal, ORM (Occlusion/Rauheit/Metallic
in einer Textur, wie in PBR-Engines üblich, spart Texture-Units), Height**
(für Parallax, nur bei Stufe Hoch aktiv). Auflösung durchgehend **1K
(1024×1024)**, tileable, gebacken via Cycles-Bake auf ein flaches Ebenen-Mesh.

Begründung 1K statt höher: Triplanar-Projektion auf Barrow-Quader zeigt jede
Fläche aus mittlerer Entfernung; die stilisierte, flächige Optik verlangt
ohnehin keine Groß-Auflösungs-Details (Poren, Kratzer im Zoll-Bereich), die
1K nicht mehr trüge. Spart VRAM auf Mittelklasse-Zielhardware (Performance-
Beschluss: 60 fps Mittelklasse bei Stufe Mittel).

**Format: KTX2 (Basis Universal, UASTC für Normal/Height, ETC1S für
Albedo/ORM)** — komprimiert on-disk, GPU-nativ dekomprimiert, kein CPU-seitiges
PNG-Decoding beim Laden. Das Bake-Skript exportiert zunächst PNG (verlustfrei,
zur Kontrolle/Versionierung), ein zweiter Schritt (`toktx`/Babylon-KTX2-Tool)
komprimiert nach KTX2 für die Laufzeit. PNG-Zwischenstand bleibt im Repo
außerhalb von `assets/` unpraktikabel groß — beide Stände liegen daher wie
Modelle üblich außerhalb des Repos ([[wov-assets-bleiben-ausserhalb-des-repos]]),
nur das Bake-Skript ist versioniert.

| # | Material | Verwendung | Besonderheit der Maps |
|---|---|---|---|
| 1 | Wand-Quader (Sandstein hell) | Haupt-Wandflächen, Grabkammer-Blöcke | Albedo hell-warm (Referenzbild: gebrochenes Weiß/Ocker), Normal mit klaren rechteckigen Fugen (Voronoi + Bevel-Kante), Rauheit mittel-matt, kein Metallic |
| 2 | Fels roh (Bruchstein) | Höhlenwände, unbearbeiteter Übergang zu Quadern | Albedo kühler/grauer als Wand-Quader (Kontrastanker zu "bearbeitet vs. gewachsen"), Normal mit großflächigen Musher-Facetten (Noise mit niedriger Frequenz, harte Voronoi-Kanten), höhere Rauheit-Varianz |
| 3 | Boden-Platten (verlegt) | begehbare Kammerböden, Gänge | Albedo wie Wand-Quader, aber Fugenraster größer/regelmäßiger (Draufsicht-Nutzung in Triplanar Y-Achse), leichte Trittmulden im Height |
| 4 | Erde/Sand (Boden roh) | unbefestigte Gänge, Außenübergänge | Albedo sandig-warm (Referenzbild-Boden), Normal fein-körnig (hochfrequentes Noise, sehr flach), keine Fugenstruktur |
| 5 | Holz (Runenholz dunkel) | Balken, Türrahmen, Stützen, Palisaden | Albedo dunkelbraun, Normal mit Maserung (gestrecktes Noise entlang einer Achse), zusätzlicher **Runen-Kanal** als separate Graustufen-Maske (Vertex-Farbe oder eigene Textur) für spätere emissive Glyphen |
| 6 | Metall (Beschläge, Ketten, Gitter) | Türbeschläge, Fackelhalter, Gitterstäbe | Albedo dunkles Eisen/Bronze, ORM mit hohem Metallic, Rauheit fleckig (Rost-Patches über Noise-Maske), kleine Nutzfläche → auch bei 1K sehr detailliert wirkend |
| 7 | Moos-Overlay | Blend-Layer unten an Wänden/Fels | **Nur Albedo + Normal + eigene Blend-Maske** (kein eigenständiges Rauheit/Metallic nötig, übernimmt Basis-ORM abgeschwächt), satter gedämpfter Grünton passend zur Palette |
| 8 | Feuchte/Nässe-Overlay | Blend-Layer Ecken/Bodenrinnen, Basis für SSR | **Nur Rauheit-Absenkung + leichte Normal-Glättung** über Blend-Maske, kein eigenes Albedo (dunkelt Basisfarbe nur ab) — treibt direkt den SSR-Effekt aus dem Atmosphäre-Paket |

Materialien 7 und 8 sind bewusst keine vollständigen PBR-Sets, sondern
**Blend-Layer**, die im Triplanar-Shader über eine Maske (Höhe, Normalen-
Weltausrichtung nach oben/unten, oder gebackene Vertex-Maske aus dem
Layout-Generator) mit 1–6 gemischt werden — genau das im Beschluss geforderte
"Material-Blending (Moos unten, Feuchte in Ecken, Schmutz, Risse)". Ein
neunter Blend-Layer "Schmutz/Risse" kann bei Bedarf als reine
Rauheit+Normal-Maske ergänzt werden, ohne die Kern-8 zu berühren.

## 3. Theme-Varianten per Tint

Vier Themes laut Beschluss: **Krypta, Sumpf, Eis, Feuer**. Umsetzung NICHT
über separate Textur-Sätze (vervielfacht Bake-Aufwand und VRAM), sondern über
**Shader-Parameter auf denselben 8 Basis-Maps**, gesetzt pro Dungeon-Instanz
aus dem Layout-Seed (Determinismus: Theme-Parameter sind reine Funktion des
Seeds, kein Zufall zur Laufzeit).

| Parameter | Krypta (Basis) | Sumpf | Eis | Feuer |
|---|---|---|---|---|
| Albedo-Tint (Wand/Fels/Boden) | neutral (Referenzbild-Palette) | Grünstich + Sättigung -10 % | Blaustich + Helligkeit +15 % | Rotstich + Sättigung +10 % |
| Moos-Deckungsgrad (Blend-Maske-Schwelle) | niedrig (nur unterste Reihe) | hoch (bis Kammermitte) | 0 (kein Moos) | niedrig, durch Ruß-Variante ersetzt (s. u.) |
| Feuchte-Intensität (Rauheit-Absenkung) | mittel | hoch (fast alle Bodenflächen) | 0 (durch Frost-Parameter ersetzt) | niedrig |
| Zusatzparameter | — | Rauheit-Grundwert +0.1 (matt/schlammig) | **Frost-Overlay**: eigener 9. Blend-Layer (weißliche Kanten-Textur, additiv auf Normal-Kanten) | **Ruß-Overlay**: eigener 9. Blend-Layer (dunkle Albedo-Abdunklung an Deckenflächen, analog Moos-Maske aber umgekehrte Höhenrichtung) |
| Fackellicht-Farbtemperatur | warm 2000K (Referenzbild) | kühler-grün 2400K | kalt-bläulich, Lichtintensität -20 % | heiß-orange, Intensität +20 %, Glut-Partikel (Atmosphäre-Paket) |
| Emissive Runen (Material 6) | schwach warm | schwach grün-fahl | schwach bläulich-weiß | kräftig orange, pulsierend (an bestehendes `GlutPuls.ts`-Muster andocken) |

Damit bleiben Eis und Feuer nicht bei reinem Tint stehen (ein reiner Farbstich
würde bei diesen beiden Extremen unglaubwürdig wirken), sondern bekommen
je einen zusätzlichen, aber wiederverwendbaren Blend-Layer (Frost/Ruß), der
technisch genauso funktioniert wie Moos/Feuchte — kein neuer Mechanismus,
nur zwei weitere Masken-Layer in derselben Blend-Pipeline.

## 4. Produktionsweg: Blender-Skript

**Werkzeug:** Blender headless über Flatpak, analog dem bestehenden Projekt-
Muster ([[wov-blender-ueber-flatpak]]): absolute Pfade unter `$HOME`,
`--factory-startup` (keine User-Add-ons/Prefs im Bake), keine offene
interaktive Blender-Sitzung anfassen — das Skript läuft in einer eigenen
Headless-Instanz oder als CLI-Batch.

```
flatpak run org.blender.Blender --background --factory-startup \
  --python /home/mike/wov-wt-dungeon2/tools/bake-barrow-materials.py -- \
  --seed 20260830 --out /home/mike/wov-assets/dungeon2/materials --res 1024
```

**Aufbau des Skripts (`tools/bake-barrow-materials.py`):**

1. **Neue leere Szene pro Material** (`bpy.ops.wm.read_factory_settings`),
   damit kein Zustand zwischen Materialien durchsickert — RAM-schonend, weil
   nach jedem Bake die Szene verworfen und neu aufgebaut wird statt 8 Material-
   Setups gleichzeitig im Speicher zu halten.
2. **Ebenen-Mesh (Plane, 2×2 m gedacht)** mit korrekten UVs als Bake-Ziel,
   plus ein zweites, gekrümmtes Testobjekt (Zylinder-Ausschnitt) nur für die
   visuelle Kontrolle im Screenshot-Schritt — nicht mitgebacken.
3. **Node-Graph pro Material** aus Python (`bpy.data.materials.new`,
   `node_tree.nodes.new`), keine `.blend`-Vorlagedatei — das Skript ist die
   einzige Quelle der Wahrheit, reproduzierbar aus dem Repo-Stand heraus ohne
   binäre Blend-Anhängsel. Zentrale Bausteine, je nach Material kombiniert:
   - `Voronoi Texture` (Fugen, Bruchflächen) mit festem `W`-Seed-Input
   - `Noise Texture` (Rauheit-Varianz, Erde/Sand-Körnung, Holzmaserung via
     gestreckte Koordinaten)
   - `ColorRamp` zur Kontrastkurve (hier wird die Referenzbild-Palette
     eingeregelt: gedämpfte, keine übersättigten Werte)
   - `Bump`/`Normal Map`-Kette für die Normal-Ausgabe
4. **Determinismus:** Jeder Zufallseingang (`Voronoi.W`, `Noise.W`,
   `mapping.location`) wird aus `--seed` **plus einem festen Material-Index**
   abgeleitet (`material_seed = seed * 100 + material_index`), NICHT aus
   Blenders globalem `bpy.context.scene.cycles.seed` allein — das verhindert,
   dass eine spätere Reihenfolge-Änderung im Skript (Material 3 vor Material 2
   gebacken) andere Ergebnisse für unveränderte Materialien erzeugt. Cycles
   selbst läuft mit `use_persistent_data = False` und festem `seed`, damit
   auch das Sample-Rauschen reproduzierbar ist.
5. **Bake pro Kanal** (`bpy.ops.object.bake`, Typ `DIFFUSE`/`NORMAL`/
   `ROUGHNESS`/… je nach Zielkanal), Ausgabe direkt in `.png` (16-bit für
   Height, 8-bit sonst). ORM wird **nicht** von Cycles nativ gebacken, sondern
   im Skript per Pixel-Kompositing aus drei Einzel-Bakes in die RGB-Kanäle
   eines Bildes geschrieben (`bpy.data.images`, `pixels`-Array, kanalweise
   kopiert) — RAM-schonend, weil das nur am Ende einmal pro Material passiert,
   nicht pro Sample.
6. **Theme-Overlays (Frost/Ruß, Abschnitt 3)** werden als eigene, kleine
   Bake-Durchläufe direkt danach erzeugt (eigene Maske + Normal-Anteil),
   nicht als Teil der 8 Basis-Materialien — hält den Kern-Satz stabil, falls
   später ein fünftes Theme dazukommt.
7. **RAM-Disziplin:** `res=1024` als Default (Bake-Auflösung = Ziel-Auflösung,
   kein Downscale-Schritt), Cycles-Device CPU (kein GPU-Kontext nötig für
   reines Node-Bake, vermeidet den bekannten "Headless Chromium braucht die
   GPU"-Fallstrick in umgekehrter Form: hier braucht NICHTS die GPU, also
   auch keine ANGLE-Flags/Xvfb-Sorgen), Bild-Objekte nach jedem Bake explizit
   mit `bpy.data.images.remove()` freigeben statt der Garbage Collection zu
   überlassen.
8. **Kontrollausgabe:** Nach jedem Material ein Thumbnail-Render (Kugel +
   gekrümmtes Testobjekt unter Studio-Beleuchtung, ähnlich Marmoset-Vorschau)
   als PNG neben die Maps — Abnahme-Regel des Projekts verlangt ohnehin
   "Messung + Rendering + Mikes Blick", dieser Schritt liefert das Rendering
   für die Materialien vorab, bevor sie überhaupt im Client landen.
9. **KTX2-Kompression als separater Schritt** (`toktx` CLI oder Babylon-
   Tooling), NICHT im Blender-Skript selbst — Trennung von "Inhalt erzeugen"
   (deterministisch, Blender) und "Inhalt verpacken" (Zielformat-Detail, kann
   sich ändern ohne die Maps neu zu backen).
10. **Zweisprachige Kommentare** im Skript (Deutsch + Englisch je Abschnitt),
    wie im Projekt verbindlich vorgeschrieben.

**Offene Punkte für die Umsetzung** (nicht Teil dieses Plans, sondern Hinweis
für die nächste Stufe): genaue ColorRamp-Stützstellen und Voronoi-Skalen
müssen am Bildschirm gegen Mikes Referenzbild abgeglichen werden — das ist
ein iterativer Blender-Termin, kein reiner Code-Schreibvorgang.
