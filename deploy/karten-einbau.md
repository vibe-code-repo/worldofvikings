# Weltkarte automatisch erneuern — Einbau auf wov-dev

Stand: Karte W-Karte (24.09.2026). Die Karten kommen nicht mehr per SSH nach
CT 103, sondern werden lokal erzeugt und von nginx aus
`/var/lib/wov-karten/oeffentlich/` ausgeliefert. Rückfall: die Dateien in
`wov-web/static/assets/karten/` (so wie sie im Bau liegen).

Einbauen nur mit Mikes Go, nach dem Merge und dem Ausrollen von `main` auf
`/opt/worldofvikings` (nginx-Konfiguration und Skript kommen mit dem Checkout):

```
cd /opt/worldofvikings
# 1. Einheiten übernehmen (sie liegen als Kopie in /etc/systemd/system)
install -m 0644 deploy/systemd/wov-karten.service deploy/systemd/wov-karten.timer /etc/systemd/system/
systemctl daemon-reload
# 2. Einmal von Hand rendern (rund 30-60 s), Ergebnis prüfen
systemctl start wov-karten.service   # Handstart NUR so (Umgebung, Sperre, Journal)
journalctl -u wov-karten -n 20 --no-pager
cat /var/lib/wov-karten/oeffentlich/karten.json | head -3
# 3. nginx: Konfiguration prüfen, dann neu laden
nginx -t && systemctl reload nginx
curl -s http://127.0.0.1/assets/karten/karten.json | head -3   # "erzeugt" von eben
# 4. Stündliche Prüfung einschalten
systemctl enable --now wov-karten.timer
systemctl list-timers wov-karten.timer --no-pager
```

Rückbau: `systemctl disable --now wov-karten.timer`; ohne Timer liefert die
Webseite weiter die zuletzt abgelegten Karten. Löscht man
`/var/lib/wov-karten/oeffentlich/`, greift der Rückfall auf die Repo-Karten.

Vorbedingung: world-of-vikings.com muss auf wov-dev zeigen (der Dienst
`wov-web` dort ist der Auslieferer; gestoppt liefert die Adresse 502). Der
`curl` in Schritt 3 prüft nur den lokalen nginx.

Wichtig:
- `tools/wov-update.sh` fasst die Einheiten nicht an. Nach jeder Änderung an
  `deploy/systemd/*` Schritt 1 (`install` + `daemon-reload`) erneut ausführen.
- `/etc/nginx/sites-enabled/wov-lab` ist ein Symlink auf
  `deploy/nginx/wov-lab.conf`: Ein Merge legt die Konfiguration sofort auf
  Platte, wirksam wird sie beim nächsten `nginx -t && systemctl reload nginx`.
  Bis `oeffentlich/` existiert, greift der Rückfall auf die Repo-Karten.
- Der Lauf ist gesperrt (`/run/wov-karten/sperre`, tmpfs, `RuntimeDirectory=`
  der Unit). Ein zweites `systemctl start` wartet auf den laufenden oneshot
  (systemd führt die Läufe hintereinander aus) und endet **nicht** mit 75.
  Status 75 gibt es nur, wenn ein Lauf außerhalb von systemd dieselbe Sperre
  hält. Danach steht der Dienst bis zum nächsten erfolgreichen Lauf auf
  „failed“; der Timer läuft normal weiter.
- `RuntimeDirectoryPreserve=no` löscht beim Dienstende `/run/wov-karten`,
  also auch die Sperre eines gleichzeitigen Handlaufs außerhalb von systemd.
  Deshalb gilt die Regel „Handläufe nur per `systemctl`“. Aus demselben Grund
  (Dateirechte kommen aus der umask): Ein Handlauf mit strenger umask legt
  Dateien mit 0600 bzw. den Ordner mit 0700 an, nginx liefert dann 403 oder
  still die Repo-Karte.

Sperre hängt? (Lauf außerhalb von systemd endet mit Status 75, obwohl nichts läuft)
```
cat /run/wov-karten/sperre                 # PID des Halters
ps -p "$(cat /run/wov-karten/sperre)" -o pid,args   # nennt die Zeile weltkarte-veroeffentlichen?
systemctl status wov-karten.service        # läuft der Dienst wirklich?
```
Nennt `ps` das Skript nicht oder gibt es die PID nicht, gilt die Sperre schon
als frei und der nächste Lauf übernimmt sie selbst. Läuft es wirklich, abwarten
(ein Lauf mit Rendern dauert bis zu 1 Minute). Nur wenn `systemctl status` nichts
Laufendes zeigt und der Status 75 bleibt: `rm /run/wov-karten/sperre`. Nach einem
Neustart des Containers ist sie ohnehin weg.
Daneben gibt es die Kurzsperre `/run/wov-karten/sperre.uebernahme`, die nur
während der Übernahme einer toten Sperre besteht; ist sie älter als 10 s,
wird sie von einem Lauf übernommen (also nichts von Hand löschen).

Restrisiko (unter systemd praktisch ausgeschlossen, weil systemd die Läufe
ohnehin hintereinander ausführt): (1) Ist ein Übernehmer mehr als 10 s
angehalten (z. B. `SIGSTOP`), kann ein zweiter die Kurzsperre übernehmen und es
gibt kurz zwei Halter. (2) Trägt ein fremder Prozess nach PID-Umlauf einen
Namen mit `weltkarte-veroeffentlichen` in der Kommandozeile, hält er die
Sperre scheinbar dauerhaft; dann Status 75 wie oben behandeln.

Hinweise:
- Ein Bild wird vor dem Ablegen dekodiert und auf die Breite geprüft
  (`WOV_KARTEN_BREITE`, Vorgabe 4096; erlaubt sind ganze Zahlen von 256 bis
  8192, alles andere beendet den Lauf sofort mit Exit 1). Ist es kaputt,
  rendert der Lauf neu; scheitert auch das, gilt **diese Welt** als
  ausgefallen: Ihre zuletzt veröffentlichten Dateien bleiben stehen und sie
  bleibt in `karten.json`, die anderen Welten werden trotzdem veröffentlicht.
  Der Lauf endet am Schluss mit Exit 1 (Dienst „failed“, der Timer läuft
  weiter), damit der Ausfall im Journal und in `systemctl status` sichtbar ist.
  Das gilt auch für eine unlesbare Weltdatei oder einen Renderfehler.
  Scheitert erst das Ablegen mitten im Paar Bild/Beschreibung (volle Platte,
  E/A-Fehler), wird die zuletzt vollständig veröffentlichte Fassung
  wiederhergestellt und `karten.json` zeigt auf sie; ein Mischzustand aus neuem
  Bild und alter Beschreibung bleibt nie stehen. Ändert sich nur die Breite, rendert
  der Lauf alle Welten in einem Durchgang neu (Exit 0).
  Ein leeres `WOV_KARTEN_BREITE=` (etwa ein leeres `Environment=`) gilt als nicht gesetzt (4096).
- Alte `*.tmp` in `/var/lib/wov-karten` und `oeffentlich/` werden beim Start gelöscht.
- Bekannte Grenze: Bild und Beschreibung werden nacheinander abgelegt und je bis
  zu 300 s vom Browser gecacht; nach einer Weltänderung kann die
  Koordinatenanzeige kurz zum alten Bild passen.
- Rendern nur, wenn sich das Weltdokument geändert hat (SHA-256-Fingerabdruck
  in `<instanz>.json`). Neu erzwingen: `rm /var/lib/wov-karten/<instanz>.json`
  und `systemctl start wov-karten.service`. Die Schalter `--neu` und
  `--nur-rendern` sind für Proben gedacht, mit gesetzten `WOV_KARTEN_ARBEIT`,
  `WOV_KARTEN_AUSGABE` und `WOV_KARTEN_SPERRE` (siehe
  `tools/test/weltkarte-probe.mjs`), nie mit den Standardpfaden von Hand.
- Fehlt `server/data/welten/<instanz>.json` (Karenz, Entscheidung des
  Orchestrators vom 26.09.2026): Der **erste** Lauf ohne Weltdatei warnt nur
  („Lauf 1 von 2 in Folge“); die öffentlichen Dateien bleiben und die Welt
  bleibt in `karten.json`. Erst der **zweite Lauf in Folge** ohne Weltdatei
  entfernt `<instanz>.webp` und `<instanz>.json` aus `oeffentlich/` und nimmt
  die Welt aus `karten.json` (Repo-Rückfall, Warnung im Journal). Der Zähler
  ist die Datei `/var/lib/wov-karten/<instanz>.fehlt`; sie wird gelöscht,
  sobald die Weltdatei wieder da ist (auch bei `--nur-rendern`). `--nur-rendern` zählt nicht mit. Grund:
  Ein einzelner Lauf während eines Checkouts oder nach einem Tippfehler soll
  die Karte nicht sofort von der Webseite nehmen.
- Der alte Schlüssel `/root/.ssh/wov_karten` und `karten-empfang` auf CT 103
  werden nicht mehr gebraucht; Entfernen ist Sache des Orchestrators.
- Probe: `node tools/test/weltkarte-probe.mjs` ist die kleine Probe (256 px,
  rund 15–20 s, ohne den Parallel-Lauf); sie steht im Sammellauf
  (`npm test`). Die große Probe mit 4096 px und allen Fällen, rund 1 min:
  `node tools/test/weltkarte-probe.mjs --gross` (von Hand vor Änderungen an der
  Kartenveröffentlichung). Beide rendern in `/tmp`.
