# World of Vikings — Arbeitsregeln fuer dieses Repo

## Commit-Nachrichten sind zweisprachig

Deutscher Betreff und Fliesstext zuerst, darunter durch `--- English ---`
getrennt dieselbe Aussage auf Englisch.

```
Editor: Ein Klick setzt EINE Insel — Formen-Werkzeug endet danach

Warum ... (deutscher Fliesstext)

--- English ---

Editor: one click places ONE island — the shape tool ends after it

Why ... (English body)
```

**Warum beides:** Deutsch ist die Arbeitssprache — Bezeichner, Kommentare
und die gesamte bisherige Historie sind deutsch. Das Repo liegt aber
oeffentlich auf GitHub; eine rein deutsche Historie schliesst jeden aus,
der von aussen daraufschaut.

Die **erste Zeile bleibt deutsch** — das ist, was `git log --oneline`
zeigt, und der Rest der Historie ist es auch. Die englische Fassung ist
keine Wort-fuer-Wort-Uebersetzung; sie muss dieselbe Begruendung tragen,
darf aber anders formuliert sein.

**Stil der Betreffs:** die Wirkung nennen, nicht die Datei. „Editor: Ein
Klick setzt EINE Insel" ist besser als „SpawnPanel.ts angepasst".
Rueckverweise auf Roadmap-Kennungen (`F17`, `G7`, `Review 11/12/27`)
gehoeren dazu, wo es sie gibt.

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
