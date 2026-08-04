# World of Vikings


> Eigenständiges Projekt auf Basis von valheim-babylon (MMORPG „Angelsachsen gegen Wikinger"). Abkürzung: **wov**. Server-Port 2467, Client-Port 5274, Dienste über `systemctl start wov.target`.
Valheim als Browsergame auf Basis von **Babylon.js** — Port des C++-Servers aus
[`valheim.community`](../valheim.community) (Valhalla2.0) mit Original-Assets.

Nachfolgeprojekt von [`valheim-browser`](../valheim-browser) (Three.js-Prototyp).
Server, Shared-Code (verifizierte Weltgenerierung), Tools und Assets werden übernommen;
der Client wird mit Babylon.js neu gebaut (Clustered Lighting, CSM, Volumetrics,
Thin Instances, Havok Physics, WebGPU).

## Dokumentation

Siehe [Docs/](Docs/):

1. [00 — Master Plan](Docs/00-Master-Plan.md)
2. [01 — Warum Babylon.js?](Docs/01-Warum-Babylon.md)
3. [02 — Migration von valheim-browser](Docs/02-Migration-von-valheim-browser.md)
4. [03 — Rendering & Engine](Docs/03-Rendering-und-Engine.md)
5. [04 — Asset-Pipeline](Docs/04-Asset-Pipeline.md)
6. [05 — Server-Architektur](Docs/05-Server-Architektur.md)
7. [06 — Roadmap & Meilensteine](Docs/06-Roadmap.md)

## Starten

Als systemd-Dienst (Dauerbetrieb, Autostart nach Reboot):

```bash
sudo deploy/install-services.sh    # einmalig: Units installieren + aktivieren

systemctl start wov.target         # Server + Client
systemctl stop  wov.target
systemctl restart valheim-server   # nur den Game-Server
systemctl status valheim-server valheim-client
journalctl -fu valheim-server -u valheim-client
```

Die gleichen Befehle gibt es als npm-Scripts: `npm run service:start`,
`service:stop`, `service:restart`, `service:status`, `service:logs`.

Beide Dienste laufen im Watch-Modus (`tsx watch` bzw. Vite) und übernehmen
Codeänderungen ohne Neustart.

Ohne systemd, beide Logs in einem Terminal:

```bash
npm run dev                        # Server + Client parallel im Vordergrund
```

| Dienst | Port | Adresse |
| --- | --- | --- |
| Client (Vite) | 5274 | http://<host>:5274 (Editor: /editor.html) |
| Game-Server (WebSocket) | 2467 | Client proxyt über `/ws` |

Der Game-Server braucht beim Start ~40 s für die Weltgenerierung, bevor er auf
Port 2467 lauscht (Boot dank Placement-Cache ~6 s).

## Status

Layout-Welt aktiv (designer-definierte Karte, Docs/10) — Historie in der [Roadmap](Docs/06-Roadmap.md).
