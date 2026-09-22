# Ironward: vom passgenauen Modell ins DEV-Inventar

Stand: 13.09.2026. Ziel ist **DEV**, Charakter **Gast**. Entwicklung in einem eigenen Worktree; keine Änderung an LAB oder LIVE. Die genehmigte v3-Quelle liegt außerhalb des Repos in einer eigenen Asset-Ablage.

## Verbindlicher Asset-Vertrag

- Sieben Gegenstände ersetzen elf Körperregionen. Paare werden zusammen angelegt.
- `shared/src/ironward.ts` definiert Namen, Slots, Regionen und Exportgruppen gemeinsam.
- Die Blender-Quelle hat 63 Bones; der aktuelle Spielkörper `wikinger/WikingerKoerper.glb` hat **71**. Die acht zusätzlichen Steuerknochen und geänderten Bindematrizen müssen berücksichtigt werden.
- Der Export übernimmt die vollständige Hierarchie, Gelenkreihenfolge und inversen Bindematrizen des tatsächlichen Spielkörpers. Die Geometrie bleibt in Welt-REST-Koordinaten. JOINTS werden über Bone-Namen zugeordnet.
- Nur beim Hips-Stoff werden die vertauschten UpperLeg-Gruppen aus der Neutralquelle berichtigt. Die starren Platten waren bereits richtig. Die Originaldateien bleiben unverändert.
- Helm ersetzt den ganzen Kopf einschließlich einer geschlossenen Unterlage. Geladener Helm blendet außerdem Frisur, Bart und Augenbrauen aus; Ablegen stellt sie wieder her.
- Fehlt ein Modell oder passt sein Skelett nicht, darf sein Körperteil **nicht** unsichtbar werden.
- Nur männlicher Wikinger. Automatisches weibliches Fitting ist nicht enthalten.

## Reproduzierbare Erzeugung

Aus der Repo-Wurzel, mit installierten Abhängigkeiten:

```sh
node_modules/.bin/tsx tools/armor/export/export-armor.mjs SOURCE_ARMOR.glb GAME_BODY.glb OUTPUT_MODELS
flatpak run org.blender.Blender -b --factory-startup --python ABSOLUTE_REPO/tools/armor/export/render-icons.py -- OUTPUT_MODELS OUTPUT_SPRITES
node_modules/.bin/tsx tools/armor/test/skin-gate.mjs GAME_BODY.glb OUTPUT_MODELS
```

Der Export erzeugt sieben GLBs plus `manifest.json` mit SHA-256 der Eingaben und Ausgaben. Die Icons werden aus diesen GLBs gerendert, nicht separat erfunden. Der gesamte Satz hat 7.466 Dreiecke und derzeit 48 Material-Primitives. Ein Materialatlas/Draw-Call-Optimierung ist ein separater nächster Schritt.

| Gegenstand | Ausrüstungsslot | Ersetzte Regionen |
| --- | --- | --- |
| IronwardHelmet | Kopf | Head |
| IronwardCuirass | Hemd | Torso |
| IronwardLeggings | Hose | Hips einschließlich Oberschenkel |
| IronwardPauldrons | Schultern | ArmUpperLeft, ArmUpperRight |
| IronwardBracers | Unterarme | ArmLowerLeft, ArmLowerRight |
| IronwardGauntlets | Handschuhe | HandLeft, HandRight |
| IronwardBoots | Schuhe | LegLeft, LegRight |

## Einbau und Übergabe

1. DEV-HEAD und Arbeitsbaum prüfen; aus genau diesem Stand einen eigenen Worktree anlegen. Fremde Änderungen nicht übernehmen oder überschreiben.
2. Tests im Worktree: `npm run typecheck`, `tsx client/test/ironward.ts`, `tsx server/test/ironward.ts`, GLB-Validator und Skin-Test gegen den aktuellen Spielkörper.
3. Sichtprüfung: `/play/test/ironward-view.html` am Vite-Server. Ganzes Set, jedes Teil einzeln, Ablegen und schnelles Wechseln prüfen. Die Seite nutzt dieselbe `CharakterVorschau` wie das Charakterfenster; keine separate Render-Imitation.
4. Neue GLBs nach `assets/models/ironward/`, Icons nach `assets/sprites/`. Körperdatei nicht austauschen. Vorher/nachher ihren SHA-256 vergleichen. Assets gehören nicht in Git.
5. Nur geprüften Commit auf DEV übernehmen, sofern HEAD/Arbeitsbaum weiterhin passen. Spielserver kontrolliert neu starten; eine aktive Spielsitzung wird dabei kurz getrennt und muss eventuell neu angemeldet werden.
6. Als Admin `item ironward Gast` ausführen. Der Befehl liefert fehlende Teile einmalig an den online oder offline vorhandenen Charakter. Kein voller Sack wird teilweise verändert. Vorhandene Gegenstände, Position und angelegte Kleidung bleiben erhalten. Er fordert einen normalen Welt-Save an.
7. Hilfsprogramm auf DEV: `node_modules/.bin/tsx tools/armor/dev/grant-set-dev.mts Gast --apply`. Ohne `--apply` nur Online-Übersicht. Es nutzt die normale Anmeldung des bereits konfigurierten Testkontos und eine reine Editor-Verbindung; es schreibt weder Zugangsdaten noch direkt in die Spielstanddatei. Nach der Übergabe prüft es alle sieben Items im gespeicherten DEV-Spielstand.

Wichtig: Editor-Verbindungen teilen sich unter Umständen die Spieler-ID mit dem Spielclient. Sie werden deshalb beim Speichern übersprungen, damit ihr leeres Inventar niemals den echten Charakter überschreibt.

## Im Spiel ausprobieren

Spiel neu laden/anmelden, **I** für das Inventar und **K** für das Charakterfenster. Gegenstand doppelklicken oder in seinen passenden Slot ziehen. Zum Ablegen den belegten Slot anklicken. Das Item bleibt währenddessen im Inventar.

Der Server validiert Kennung, Slot, Körperkompatibilität und Besitz. Das bestehende `ober|beine`-Format bleibt lesbar; weitere Slots hängen als JSON-Suffix daran. Inventar-Snapshots stellen die Ausrüstung anhand der gespeicherten Flags wieder her. Eigener Avatar, Charaktervorschau und andere Spieler nutzen denselben Regionenvertrag.

## Grenzen

Dies ist ein ausrüstbarer visueller Prototyp, kein fertig ausbalanciertes Rüstungssystem: keine neuen Schutzwerte, Rezepte, Loot-Tabellen, weibliche Variante oder beschädigten Zustände. Bewegungsproben prüfen alle 28 Clips und die Skin-Matrizen; sie ersetzen keine vollständige Clipping-Abnahme jedes Animation-Frames und jeder Körpervariante.
