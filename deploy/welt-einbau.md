# Welt-Arbeitskopie (K5.7) — Einbau auf DEV und live

Die Welt liegt zur Laufzeit als Arbeitskopie **außerhalb von Git**: `WOV_WELT_VERZEICHNIS` (absolut), auf DEV und live
`/var/lib/wov/welten`. Ohne die Variable liegt sie in `<Wurzel>/server/data/welten-arbeit/` (von Git ignoriert).
`server/data/welten/<instanz>.json` im Repo ist der abgenommene Stand; dazwischen vermittelt nur
`tools/welt-abnehmen.sh`. Nichts davon ist ausgerollt; das Ausrollen braucht Mikes Go.

The world lives at run time as a working copy outside Git. On DEV and live the units set
`WOV_WELT_VERZEICHNIS=/var/lib/wov/welten`. The variable belongs **only in the units** — **never in `/etc/wov.env`**
(`wov-update.sh` exports that file into the test run, and a test would then write into the real world).

## Reihenfolge beim Ausrollen / Rollout order

1. **Merge-Vorbereitung:** Wer als Zweiter von K5.7/K5.0 mergt, stellt `admin/test/weltops-quittung.ts` (K5.0) auf
   `welten-arbeit/dev.json` oder ein eigenes `WOV_WELT_VERZEICHNIS` um und `admin/test/welt-ohne-variable.ts` (K5.7) auf
   200 **oder** 202 (oder `WOV_QUITTUNG=aus`); in `tools/worldlayout-mcp/probe-kontext.ts` bleiben `WOV_QUITTUNG` und
   `WOV_WELT_VERZEICHNIS` beide stehen. Danach voller `npm test` grün.
2. **Vor dem Rollout auf wov-dev:** `git -C /opt/worldofvikings status --porcelain` ist leer (keine unabgenommene
   Bearbeitung in `server/data/welten/dev.json`).
3. **Units zuerst, aus dem neuen Stand, bei laufendem alten Code:**
   ```bash
   for u in wov-server wov-admin wov-sicherung; do
     git -C /opt/worldofvikings show origin/main:deploy/systemd/$u.service > /etc/systemd/system/$u.service
   done
   systemctl daemon-reload
   ```
   Der alte Code kennt die Variable nicht; das ist unschädlich, und es wird nichts neu gestartet.
   (`deploy/install-services.sh` installiert aus dem **eigenen** Checkout; vor dem Pull ausgeführt, installiert es
   die alten Units.)
4. Die Variable **nicht** nach `/etc/wov.env`.
5. `sudo tools/wov-update.sh`: stoppt und startet alle Dienste, die dann mit der Variable laufen. Der erste Start legt
   `/var/lib/wov/welten/dev.json` aus dem Repo an (`angelegt`).
6. **Nachweis direkt danach:**
   - `journalctl -u wov-server -n 50 | grep '\[Welt\]'` nennt `/var/lib/wov/welten/dev.json`;
   - die Admin-Logzeile „bereit … Welt /var/lib/wov/welten/dev.json“;
   - `ls /opt/worldofvikings/server/data/welten-arbeit` → existiert nicht.
7. `systemctl start wov-sicherung` einmal von Hand; im Protokoll steht „kopiere /var/lib/wov/welten/dev.json … dev.basis“.
8. **Abnehmen auf DEV:** `tools/welt-abnehmen.sh dev --status|--diff|--verwerfen` liest die Variable aus der Unit
   (`systemctl show -p Environment wov-server`). Gelingt das nicht, verweigert es mit Exit 2 und nennt
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
