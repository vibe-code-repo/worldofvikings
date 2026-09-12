# deploy/nginx/wov-lab.conf

Ein Ursprung fuer den Container wov-lab: nginx auf Port 80 verteilt an
Webseite, Spiel-Client, Editor, beide APIs und die Assets — siehe den
Kopfkommentar in `wov-lab.conf` fuer die Wegeliste und die Begruendungen.

Nicht zu verwechseln mit `deploy/nginx-live.conf` (Container wov-live,
zwei Hostnamen `play.*`/`editor.*`, statischer Client-Build, Kompression).
Beide Dateien duerfen auseinanderlaufen — es sind zwei verschiedene
Betriebsorte mit verschiedenen Fragen.

## Einhaengung (einmalig, ausserhalb dieses Repos)

```
apt install nginx
ln -sfn /opt/worldofvikings/deploy/nginx/wov-lab.conf /etc/nginx/sites-available/wov-lab
ln -sfn /etc/nginx/sites-available/wov-lab /etc/nginx/sites-enabled/wov-lab
rm -f /etc/nginx/sites-enabled/default   # Debians Standardseite auf :80
```

Vorher anlegen, sonst startet nginx nicht (siehe Kopfkommentar in
`wov-lab.conf`):

```
install -m 0600 -o root -g root /dev/null /etc/nginx/wov-admin-token.conf
echo "proxy_set_header x-wov-token \"$(cat /etc/wov-admin.token)\";" \
  > /etc/nginx/wov-admin-token.conf
```

Danach `nginx -t && systemctl reload nginx`.

`deploy/install-services.sh` verlinkt die Site automatisch mit; das
Token-File legt es NICHT an (derselbe Grundsatz wie bei `/etc/wov.env` und
`/etc/wov-admin.token` selbst: Geheimnisse gehoeren dem Container, nicht
dem Code).

## Am Nginx Proxy Manager (Host)

Die Eintraege 14/15 zeigen bisher direkt auf `10.10.10.17:5274`
(Vite-Dev-Server). Nach der Einhaengung zeigen sie stattdessen auf
`10.10.10.17:80` — dieses nginx uebernimmt ab dort die Verteilung, inklusive
`/ws` (WebSocket-Durchreichung muss im Proxy-Manager-Eintrag selbst
weiterhin erlaubt sein, wie zuvor).

## Ohne echten nginx pruefen

`which nginx` meldet auf dieser Entwicklungsmaschine nichts — der Nachweis
laeuft deshalb gegen `tools/dev-ursprung.mjs`, einen kleinen
Node-Rueckwaerts-Proxy, der die Regeln dieser Datei 1:1 nachbildet (gleiche
sieben Wege, gleiche rewrite-Regel fuer `/api/accounts/`). Ist auf dem
Zielcontainer ein Paket-nginx vorhanden, sollte er stattdessen gegen die
echte Konfiguration laufen (`nginx -t -c ...` bzw. ein Testcontainer) —
`tools/dev-ursprung.mjs` ist der Ersatz fuer eine Maschine ohne nginx,
keine zweite Wahrheit ueber die Regeln.

`tools/test/nginx-wov-lab-pfade.ts` liest `wov-lab.conf` als Text und
prueft, dass alle sieben Wege (`/`, `/play/`, `/editor/`, `/api/accounts/`,
`/api/`, `/assets/`, `/ws`) je einen `location`-Block haben — ein
Textnachweis, kein Ersatz fuer den echten Server. Er steht in der
KERN-Liste (`scripts/run-tests.mjs`, `npm test`).
