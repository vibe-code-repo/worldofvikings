# Weiterleitung der alten Adressen — Anleitung fuer CT 103

Diese Datei liegt im Repo, weil der noetige Eingriff selbst NICHT im Repo
liegt: `wov-web` baut nur noch `/de/...` und `/en/...`; die alten
Top-Level-Seiten (`/saga`, `/karte`, `/ruestkammer`, `/ruhmeshalle`,
`/thing`, `/erstellen`) existieren nach dem Sprachumbau nicht mehr als
Datei im Build. Die Weiterleitung dorthin muss auf dem nginx von CT 103
gesetzt werden, gleichzeitig mit dem naechsten Ausrollen — nicht davor
(sonst leiten fuer eine Weile Seiten um, die es noch gibt) und nicht danach
(sonst 404en fuer eine Weile Seiten, die es nicht mehr gibt).

Nichts davon wurde hier ausgefuehrt. `wov-alte-adressen.conf` in diesem
Ordner ist die Datei, die auf CT 103 landen soll; unten steht, wie.

## 1. Snippet-Datei ablegen

```
scp wov-web/deploy/wov-alte-adressen.conf wov-host:/tmp/
ssh wov-host "pct push 103 /tmp/wov-alte-adressen.conf /etc/nginx/snippets/wov-alte-adressen.conf"
```

(oder per `pct exec 103 -- tee ...` / Editor auf dem Container — Hauptsache
die Datei landet unter genau diesem Pfad, neben den bestehenden
`wov-*.conf`-Snippets.)

## 2. Einbindung in den Server-Block eintragen

Datei: `/etc/nginx/sites-enabled/wov`. Eine Zeile VOR `location / {`
einfuegen:

```diff
     gzip on;
     gzip_types text/css application/javascript application/json image/svg+xml;
     gzip_min_length 1024;

+    # Adressen von vor dem Sprachumbau — s. deploy/wov-alte-adressen.conf im
+    # wov-web-Repo fuer die Begruendung.
+    include snippets/wov-alte-adressen.conf;
+
     # /ruestkammer statt /ruestkammer.html soll ebenfalls gehen.
     location / {
         try_files $uri $uri.html $uri/ =404;
```

Die Position ist wichtig: `rewrite` in der Snippet-Datei muss direkt im
`server{}`-Block stehen, nicht innerhalb eines `location{}`-Blocks (sonst
greift es nur fuer Anfragen, die diesen Block ohnehin schon erreicht haben —
bei `/saga` waere das nach `try_files` bereits das 404).

## 3. Pruefen und laden

```
ssh wov-host "pct exec 103 -- nginx -t"
ssh wov-host "pct exec 103 -- systemctl reload nginx"
```

## 4. Nachmessen (nach dem naechsten Ausrollen der neuen Seite, nicht vorher)

```
curl -sI https://world-of-vikings.com/saga       # erwartet: 301 -> /de/saga
curl -sI https://world-of-vikings.com/saga.html   # erwartet: 301 -> /de/saga
curl -sI https://world-of-vikings.com/erstellen   # erwartet: 301 -> /de/erstellen
curl -sI https://world-of-vikings.com/            # erwartet: 200 (unveraendert, keine Weiterleitung noetig)
```

Solange der alte Build noch auf CT 103 liegt (Dateien wie `saga.html` noch
im `root`-Verzeichnis vorhanden), liefert `location /` sie weiterhin selbst
aus und die Weiterleitung greift nicht — das ist beabsichtigt und kein
Fehler der Konfiguration. Sie wird erst wirksam, sobald der neue Build ohne
diese Dateien ausgerollt ist.

## Randbefund, nicht Teil dieser Datei: `location /thing/`

Der bestehende Block

```
location /thing/ {
    return 302 /thing.html;
}
```

leitet `/thing/` (mit Schraegstrich) auf `/thing.html` um — eine Datei, die
nach dem Ausrollen des neuen Builds ebenfalls nicht mehr existiert (neu:
`/de/thing.html` bzw. `/en/thing.html`). Das ist unabhaengig von der
Weiterleitung oben (die greift nur fuer `/thing` OHNE Schraegstrich) und
bricht zum selben Zeitpunkt aus demselben Grund. Nicht in
`wov-alte-adressen.conf` mit erledigt, weil es eine Aenderung an einem schon
bestehenden Block ist und nicht Teil des hier beauftragten Umbaus — aber
Mike sollte `return 302 /thing.html;` beim selben Ausrollen auf
`return 302 /de/thing;` (oder `/de/thing.html`) aendern, sonst bleibt genau
diese eine Adresse tot.
