# World of Vikings — Arbeitsregeln fuer dieses Repo

## Die Entwicklung findet auf Englisch statt

Neuer Quelltext, Bezeichner, Kommentare und Dokumentation IM REPO werden
englisch geschrieben. Das Repo liegt oeffentlich auf GitHub, und Englisch
ist dort die Verkehrssprache.

**Der Altbestand ist deutsch und bleibt es.** Bezeichner wie
`figurKnoten` oder `ueberaufloesung`, die deutschen Kommentare und
`Docs/` stammen aus der Zeit davor. Die Regel gilt ab dem 23.08.2026 und
NICHT rueckwirkend -- eine Uebersetzung des Bestands waere ein eigenes
Vorhaben. Wer neue Zeilen in eine deutsche Datei schreibt, moege sich am
umgebenden Stil orientieren, statt eine Datei halb umzustellen.

## Commit-Nachrichten: Englisch, darunter eine deutsche Uebersetzung

```
Editor: one click places ONE island -- the shape tool ends after it

Why ... (the reasoning, not a list of the diff)

--- Deutsche Übersetzung ---

Editor: Ein Klick setzt EINE Insel -- Formen-Werkzeug endet danach

Warum ... (die Begruendung)
```

Die erste Zeile ist der ENGLISCHE Betreff -- das ist, was
`git log --oneline` zeigt.

**Warum trotzdem deutsch dazu:** Die Commit-Texte dieses Projekts sind
ungewoehnlich ausfuehrlich und tragen die Begruendung; sie sind
Dokumentation, nicht nur Etikett. Sie sollen auch auf Deutsch lesbar
bleiben.

**Stil:** die Wirkung nennen, nicht die Datei. „Editor: one click places
ONE island" ist besser als „update SpawnPanel.ts". Der Fliesstext traegt
die BEGRUENDUNG -- warum so und nicht anders, was gemessen wurde, was
offen bleibt. Rueckverweise auf Roadmap-Kennungen (`F17`, `G7`,
`Review 11/12/27`) gehoeren dazu, wo es sie gibt.

Projekteigene Begriffe ohne sinnvolle Uebersetzung bleiben stehen:
Dateinamen, die `__vb`-Haken, `wov-web`, die Roadmap-Kennungen.

## Zeilenenden: nicht plattmachen

105 der 544 versionierten Dateien tragen noch **CRLF** aus dem
urspruenglichen Windows-Import; eine `.gitattributes`, die das
vereinheitlicht, gibt es nicht.

Pythons `pathlib.read_text()` wandelt CRLF beim Lesen still in LF um und
`write_text()` schreibt LF zurueck. Ein Skript ueber viele Dateien macht
daraus unbeabsichtigt einen Diff ueber die GANZEN Dateien. Deshalb binaer
lesen und schreiben (`read_bytes`/`write_bytes`) oder
`open(..., newline='')`.

Gegenprobe: Steht in `git diff --shortstat` ein Vielfaches der erwarteten
Zeilenzahl, sind es die Zeilenenden.

## Nur auf DEV arbeiten

Aenderungen entstehen immer auf `wov-dev` (CT 102, SSH-Alias `wov-bau`).
Nie direkt auf `wov-live` — dorthin kommt Code ueber `git pull` bzw.
`tools/wov-update.sh`.

## Vor dem Schreiben Aenderungszeiten pruefen

An diesem Repo arbeiten mehrere Sitzungen parallel, und es wird selten
committet. Vor dem ersten Schreiben in eine Datei `stat` oder
`git status` ansehen: Ein Ueberschreiben fremder, nicht committeter
Arbeit ist endgueltig.

## Die Webseite liegt in `wov-web/`

Eigenes npm-Projekt im selben Repo, **bewusst kein Workspace** — sonst
zoege `npm ci` an der Wurzel SvelteKit und Vite auf jeden Container, auch
auf den reinen Spielserver. Sie bringt eigene `node_modules` und einen
eigenen Lockfile mit. Ausgerollt wird mit `wov-web/tools/ausrollen.sh`.
