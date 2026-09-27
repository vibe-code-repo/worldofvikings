# Welt-Arbeitskopie (K5.7) — Einbau auf DEV und live

Die Welt liegt zur Laufzeit als Arbeitskopie **außerhalb von Git**: `WOV_WELT_VERZEICHNIS` (absolut), auf DEV und live
`/var/lib/wov/welten`. Ohne die Variable liegt sie in `<Wurzel>/server/data/welten-arbeit/` (von Git ignoriert).
`server/data/welten/<instanz>.json` im Repo ist der abgenommene Stand; dazwischen vermittelt nur
`tools/welt-abnehmen.sh`. Nichts davon ist ausgerollt; das Ausrollen braucht Mikes Go.

The world lives at run time as a working copy outside Git. On DEV and live the units set
`WOV_WELT_VERZEICHNIS=/var/lib/wov/welten`. The variable belongs **only in the units** — **never in `/etc/wov.env`**
(`wov-update.sh` exports that file into the test run, and a test would then write into the real world).

## Reihenfolge beim Ausrollen / Rollout order

1. **Merge-Vorbereitung** (bestätigtes Rezept, K5.0-N5/K5.7-N4 gegeneinander gegengelesen — bei einem Merge mit
   `agent/sonnet/layout-live` **unverändert gültig**, unabhängig vom genauen Commit): `git merge --no-commit --no-ff
   origin/agent/sonnet/layout-live`, danach von Hand:
   1. `server/src/main.ts`: **beide** Importe behalten (`quittungLoeschenSicher, quittungsDatei` aus `quittung.js`
      und `weltAbgleichen` aus `weltArbeitskopie.js`).
   2. `tools/worldlayout-mcp/probe-kontext.ts`: die layout-live-Zeile nehmen (mit `WOV_QUITTUNG: 'aus'`,
      `NODE_ENV: 'test'`, `WOV_WELT_VERZEICHNIS`) — **beide** Schlüssel bleiben stehen.
   3. `tools/worldlayout-mcp/server.ts`: `import { platzierungenFehler } from
      '@wov/shared/src/worldlayout/sanitize.js';` und `import { mcp, ADMIN_URL, CHECKOUT_WURZEL, lade, schreibe,
      zusammenfassung } from './kern.js';`.
   4. Doppeltes `WOV_WELT_VERZEICHNIS` entfernen (jeweils die **zweite** Zeile ohne K5.7-Kommentar):
      `admin/test/betriebsdienst.ts`, `testwelt-einstellungen.ts`, `welt-ops.ts`, `welt-zuruecksetzen.ts` (dort steht
      die zweite Zeile vor `NODE_ENV`), `weltdokument-basis.ts`.
   5. `admin/test/welt-ohne-variable.ts` (`umgebung`): `WOV_QUITTUNG: 'aus', NODE_ENV: 'test'`.
   6. `admin/test/welt-arbeitskopie.ts` (`dienstStarten`, nach `WOV_ADMIN_PORT`): dieselben zwei Schlüssel.
   7. `scripts/run-tests.mjs` wird automatisch zusammengeführt.
   Danach prüfen: `tools/sperre.sh build -- npm run typecheck` (0 `error TS`), `node
   scripts/pruefe-runner-liste.mjs` (OK), die betroffenen Tests einzeln, dann der Volltest unter `tools/sperre.sh
   test`. Ein älterer Plan in dieser Datei nannte statt Schritt 4–6 eine Umstellung von
   `admin/test/weltops-quittung.ts`; im gegengelesenen Merge-Stand war die Datei **ohne** Änderung grün — Schritt 4–6
   oben sind die tatsächlich nötigen.
2. **Vor dem Rollout auf wov-dev:** `git -C /opt/worldofvikings status --porcelain` ist leer (keine unabgenommene
   Bearbeitung in `server/data/welten/dev.json`). **Eine offene Editor-Bearbeitung in `dev.json` wird vor dem Rollout
   abgenommen — nie mit `git checkout --` verworfen:** das löscht sie unwiederbringlich. `wov-update.sh` bricht mit
   ihr schon in der Sauberkeitsprüfung ab (nichts getan). Solange die Welt-Arbeitskopie (dieser Stand) noch nicht
   ausgerollt ist, liest und schreibt der Server diese Datei noch direkt im Checkout; `tools/welt-abnehmen.sh` (das
   liest die Arbeitskopie unter `WOV_WELT_VERZEICHNIS`/`welten-arbeit/`) greift hier also noch nicht. Reihenfolge:
   1. Bearbeitung in einen eigenen Worktree kopieren: `cp /opt/worldofvikings/server/data/welten/dev.json
      <worktree>/server/data/welten/dev.json`, dort committen, Pull Request, mergen.
   2. Auf wov-dev prüfen, dass der Inhalt jetzt in `main` steckt: `git -C /opt/worldofvikings fetch origin main &&
      git -C /opt/worldofvikings diff --quiet origin/main -- server/data/welten/dev.json` (Exit 0 heißt: gleich).
   3. **Erst dann**, nie vorher: `git -C /opt/worldofvikings checkout -- server/data/welten/dev.json`. Gehört die
      Bearbeitung einer anderen Sitzung, entscheidet die, ob sie so übernommen wird.
3. **Units zuerst, aus dem neuen Stand, bei laufendem alten Code — beim ERSTEN Rollout dieses Stands von Hand.**
   Beim ersten Rollout läuft noch das **alte** `wov-update.sh` ohne jede Prüfung (Stufe 1 führt die Fassung aus, die vor
   dem Pull auf der Platte liegt). Die Prüfung unten greift daher erst ab dem Rollout **nach** diesem Stand. Für den
   ersten (und für jeden Rollout nach einem `zurueck` auf einen Stand vor K5.7) gilt: Units vorher von Hand installieren
   und prüfen. **Ohne `sudo`:** auf wov-dev läuft die Sitzung schon als root, `sudo` ist dort nicht einmal installiert.
   Auf einer Maschine, auf der die Sitzung selbst nicht root ist, `sudo` vor `bash -c '…'` setzen. **Erst holen, dann
   installieren, nie die Unit-Datei direkt mit einer Pipe überschreiben** (ein gescheiterter `git show` würde sie
   sonst leeren), und **`origin/main` auf genau den geprüften Commit pinnen** (sonst kann zwischen dem `fetch` und dem
   `install` ein fremder Push den Stand unter der Hand wechseln):
   `sha` in der **eigenen** Shell setzen (nicht in einer verschachtelten `bash -c '…'`, sonst ist die Variable danach
   wieder leer, s. N5-4/N6) und an den Installationsblock als Positionsparameter weiterreichen. Die ganze Zeile steht
   in einer `&&`-Kette (N7/B5): scheitert `fetch` (Netz weg, Remote nicht erreichbar), bricht die Zeile VOR dem
   `sha=$(…)` ab, `sha` bleibt leer/ungesetzt statt eines veralteten Werts, und es wird nichts installiert:
   ```bash
   git -C /opt/worldofvikings fetch origin main && sha=$(git -C /opt/worldofvikings rev-parse origin/main) && echo "sha=$sha" && bash -c 'set -euo pipefail
   for u in wov-server wov-admin wov-sicherung; do
     [ "$u" = wov-sicherung ] && [ ! -e /etc/systemd/system/wov-sicherung.service ] && continue
     t=$(mktemp)
     git -C /opt/worldofvikings show "$1:deploy/systemd/$u.service" > "$t"
     test -s "$t"
     install -m 644 "$t" /etc/systemd/system/$u.service
     rm -f "$t"
   done
   systemctl daemon-reload' _ "$sha"
   ```
   Die ausgegebene `sha=…`-Zeile mit dem Merge-Commit des PR vergleichen, bevor die Handprüfung als „gleich" gilt.
   (`wov-sicherung` installiert die Schleife selbst nur, wenn die Unit auf dem Container **schon** installiert ist —
   sie legt sie nicht neu an.) Danach die **Handprüfung**, je Unit, in **derselben** Shell wie oben — `sha` steht dort
   noch, weil es außerhalb des `bash -c '…'` gesetzt wurde. Die erste Zeile bricht sofort ab, wenn `sha` (etwa nach
   einem neuen Login oder in einer anderen Shell als Block 1) doch leer ist, statt still gegen den lokalen Index zu
   vergleichen (N7/B5, derselbe Mechanismus wie N5-4):
   ```bash
   : "${sha:?sha fehlt — Block 1 in DIESER Shell ausführen, nicht in einer neuen}"
   for u in wov-server wov-admin wov-sicherung; do
     diff <(git -C /opt/worldofvikings show "$sha:deploy/systemd/$u.service") /etc/systemd/system/$u.service && echo "$u: Datei gleich"
     systemctl show -p NeedDaemonReload,Environment,UnsetEnvironment,EnvironmentFiles $u
   done
   ```
   Erwartet: `diff` ohne Ausgabe, `NeedDaemonReload=no`, `Environment=` enthält `WOV_WELT_VERZEICHNIS=/var/lib/wov/welten`,
   `UnsetEnvironment=` nennt die Variable nicht, und `/etc/wov.env` setzt sie nicht — die Prüfung dafür erkennt auch ein
   vorangestelltes `export` und führenden Leerraum, nicht nur die nackte Zuweisung:
   `grep -Ec '^[[:space:]]*(export[[:space:]]+)?WOV_WELT_VERZEICHNIS[[:space:]]*=' /etc/wov.env` → 0 (der Inhalt der
   Datei wird dabei nicht angezeigt). Der alte Code kennt die Variable nicht; das ist unschädlich, und es wird nichts
   neu gestartet.
   **Ab dem Rollout nach diesem Stand prüft `wov-update.sh` das selbst (Stufe 1, vor Pull und jeder Änderung)** für die
   drei Units: (a) installierte Datei = `origin/main:deploy/systemd/<unit>.service` (der beim Fetch geprüfte Commit
   wird dabei festgehalten und danach für den Merge, die Installationsbefehle in der Meldung und die Handprüfung oben
   verwendet, nicht ein zwischenzeitlich weitergewanderter `origin/main`), (b) `NeedDaemonReload=no`,
   (c) die wirksame Umgebung (`systemctl show -p Environment`, Unit plus Drop-ins) enthält
   `WOV_WELT_VERZEICHNIS=<absoluter Pfad>`; der Schlüssel wird exakt gelesen, Werte mit Leerzeichen bleiben ganz,
   (d) der wirksame Wert gleicht dem der Unit-Datei, (e) `UnsetEnvironment` nennt die Variable nicht, (f) keine
   `EnvironmentFile` (etwa `/etc/wov.env`) setzt sie („Variable nie in wov.env“). `wov-sicherung` wird nur geprüft,
   wenn die Unit installiert ist; fehlt sie, gibt es eine Warnung und keinen Abbruch (`wov-server` und `wov-admin` sind
   Pflicht). Bei einer Abweichung bricht es mit „NICHTS getan“ ab und nennt Unit und einen sicheren Befehl (`bash -c
   'set -o pipefail; … git -C /opt/worldofvikings show <sha>:… > "$t" && test -s "$t" && install -m 644 …&& systemctl
   daemon-reload'`, **ohne `sudo`**: das Skript läuft an dieser Stelle selbst schon als root). Nach dem `git merge
   --ff-only` auf genau diesen Commit prüft es zusätzlich, dass HEAD wirklich dort gelandet ist (nicht schon vorher
   dort stand, etwa durch einen lokalen Commit auf `main`); sonst bricht es ab, **bevor** irgendein Dienst gestoppt
   wird.
   Vor dem Test-Tor entfernt das Skript `WOV_WELT_VERZEICHNIS` und `WOV_ADMIN_URL` aus der Umgebung (`unset`); der Runner
   tut es zusätzlich, samt `WOV_DEV_CHECKOUT`. **Nach dem Start** prüft es (in Stufe 2, also auch beim ersten Rollout),
   dass die laufenden `wov-server` **und** `wov-admin` die Variable wirklich, mit demselben Wert wie in
   `deploy/systemd/` und untereinander gleich, in ihrer Umgebung haben (`/proc/<MainPID>/environ`); eine MainPID von 0
   (kurze Neustart-Lücke) wird bis zu 10s erneut geprüft, bevor gemeldet wird. Weicht einer der beiden ab, bricht es
   laut ab **und** schreibt eine Journalzeile (`logger -t wov-update`), die klar sagt: „Dienste laufen, aber auf
   falscher Welt; Units prüfen, Rückweg: …“ — die Dienste laufen dann weiter (nur eben auf der falschen Welt), ein
   zweiter Lauf nach dem Unit-Fix verliert dabei nicht den Rückweg auf den Stand vor K5.7 (`WOV_UPDATE_VORHER` bleibt
   so lange der zuletzt wirklich bestätigte Stand, wie diese Prüfung nie grün war). Der Prüfhaken `WOV_UNIT_VERZEICHNIS`
   gilt nur mit der Testmarke `WOV_KAEFIG=1` des Käfigs; sie wirkt nur aus der eigenen Aufrufumgebung, nie aus
   `/etc/wov.env` (dort gesourct, aber unmittelbar davor gesichert und danach wiederhergestellt).
   (`deploy/install-services.sh` installiert aus dem **eigenen** Checkout; vor dem Pull ausgeführt, installiert es
   die alten Units.)
4. Die Variable **nicht** nach `/etc/wov.env`.
5. `tools/wov-update.sh`: stoppt und startet alle Dienste, die dann mit der Variable laufen. Der erste Start legt
   `/var/lib/wov/welten/dev.json` aus dem Repo an (`angelegt`).
6. **Nachweis direkt danach:**
   - `journalctl -u wov-server -n 50 | grep '\[Welt\]'` nennt `/var/lib/wov/welten/dev.json`;
   - die Admin-Logzeile „bereit … Welt /var/lib/wov/welten/dev.json“;
   - `ls /opt/worldofvikings/server/data/welten-arbeit` → existiert nicht.
7. Läuft die Sicherung mit einer alten Unit (ohne die Variable) gegen den neuen Stand, sichert sie Spielstand, Konten
   und Forum trotzdem, verweigert nur den Welt-Teil und endet mit Exit 1 (Lauf-Ordner `….fehlerhaft`, Meldung im
   Journal: `journalctl -u wov-sicherung`, `systemctl --failed`). Ein `OnFailure=` gibt es nicht: keine Meldeeinheit
   vorhanden, und die Verweigerung steht ohnehin im Journal.
   `systemctl start wov-sicherung` einmal von Hand; im Protokoll steht „kopiere /var/lib/wov/welten/dev.json … dev.basis“.
8. **Abnehmen auf DEV:** `tools/welt-abnehmen.sh dev --status|--diff|--verwerfen` liest die Variable aus der Unit
   (`systemctl show -p Environment`) und verlangt, dass **`wov-server` und `wov-admin` denselben Wert** haben; fehlt er in
   einer der beiden oder widersprechen sie sich, verweigert es. Gelingt das nicht, verweigert es mit Exit 2 und nennt
   `WOV_WELT_VERZEICHNIS=/var/lib/wov/welten tools/welt-abnehmen.sh dev --status`. Abnehmen und `--commit` gibt es
   nur im eigenen Worktree.

Ohne neue Units läuft DEV nicht kaputt (Server und Betriebsdienst nehmen dann `welten-arbeit/` im Checkout), aber die
Bearbeitungen liegen am falschen Ort; werden die Units später installiert, sind sie unsichtbar. Deshalb Units zuerst.
Wird nur **eine** der Units `wov-server`/`wov-admin` neu gestartet, schreibt der Dienst eine andere Datei, als der
Server beobachtet.

## Rückweg / Rollback

Ein Zurückrollen (`wov-update.sh zurueck`) auf einen Stand vor K5.7 liest wieder `server/data/welten/dev.json` im
Checkout; Bearbeitungen in `/var/lib/wov/welten/dev.json` sind dann unsichtbar (nicht verloren). Vorher die
DEV-Arbeitskopie abnehmen oder sichern; danach einen etwaigen Ordner `server/data/welten-arbeit/` im Checkout
entfernen (im alten Stand nicht ignoriert, sonst bricht der nächste `wov-update.sh` in der Sauberkeitsprüfung ab).

## Bekannte Grenzen

- Nach dem Abnehmen weiterbearbeitet: Der Fall bleibt `konflikt`, bis auch dieser Stand abgenommen oder verworfen ist.
  Nichts geht verloren.
- Enthält die Arbeitskopie ein Feld, das der Sanitizer verwirft, meldet die nächste Repo-Änderung `konflikt` statt
  `nachgezogen` (sicher, aber laut).
- `layout_deploy` im MCP startet den DEV-Spielserver nur im DEV-Checkout mit ausdrücklich gesetzter `WOV_ADMIN_URL`.
- Die Sperrdatei (`<datei>.lock`) wird atomar angelegt (Tmp-Datei + `link`); eine leere oder unlesbare Sperre gilt als
  verwaist und wird sofort gebrochen.
