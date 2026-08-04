# Firewall (Review-Punkt 29)

Regeln aktiv seit 04.08.2026, wiederhergestellt beim Boot durch
`wov-firewall.service` aus `/etc/iptables/rules.v[46]`.

| Zugang | Von wo | Zweck |
|---|---|---|
| 22 (SSH) | überall | Fernwartung |
| 5273, 5274 | **überall** | Spiel-Clients + Layout-Editor (öffentlich gewünscht) |
| 2466, 2467 | nur localhost + 10.10.10.0/24 | Game-Server; Browser erreichen sie über den `/ws`-Proxy des Vite-Servers |
| alles aus 10.10.10.0/24 | LAN | vertrauenswürdig (SSH, MCP-Werkzeuge, Browser-Tests) |
| Rest | — | DROP (INPUT und FORWARD) |

Kopien der Regeln liegen hier im Repo (`firewall-rules.v4/v6`), damit ein
neuer Host sie übernehmen kann:

```bash
sudo cp deploy/firewall-rules.v4 /etc/iptables/rules.v4
sudo cp deploy/firewall-rules.v6 /etc/iptables/rules.v6
sudo cp deploy/systemd/wov-firewall.service /etc/systemd/system/
sudo systemctl enable --now wov-firewall
```

**Achtung:** Das LAN-Subnetz ist hartkodiert (10.10.10.0/24) — auf einem
anderen Netz anpassen, sonst sperrt man sich aus. Direkte Client-Verbindungen
auf 2467 (statt über den Proxy) funktionieren aus dem Internet nicht mehr.
