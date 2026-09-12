# Running a World of Vikings server

This is the operator's guide: everything needed to take a fresh checkout of this
repository and end up with a running game server and website on your own machine,
using only what ships in the repo. It describes exactly what the scripts in
`deploy/` and `tools/` do — not what they are meant to do — so read the warnings as
literally as the commands.

It assumes a machine (or LXC/VM container) you fully control, reachable at some
`<host>` (IP or hostname), running Debian 12 or 13, with root access. It does **not**
assume Mike's own lab network, hostnames, or any container topology mentioned
elsewhere in this repo's comments — those are development-only and are called out
below wherever they leak into a script.

## 0. Terminology this guide relies on

- **Instance**: `WOV_INSTANZ` is either `dev` or `live` — no other value is
  accepted (`shared/src/instanz.ts` throws on anything else, to avoid silently
  loading the wrong world/save file). It selects `server/data/welten/<instanz>.json`
  (the world layout, committed to git) and `server/data/worlds/<instanz>.db.zst`
  (the save file, not committed). There is no way to name your instance anything
  else; treat `live` as "the instance the public plays on" regardless of what you
  actually call your server in `server.yml`'s `server.name`.
- **The one origin**: `deploy/install-services.sh` and `deploy/nginx/wov-lab.conf`
  set up nginx on port 80 as the single entry point for the website, the game
  client, the editor, both APIs, and the WebSocket. All instructions below build
  toward that config, referred to as "the lab config" because that is its name in
  the repo (`wov-lab.conf`) — it is generic enough for any single-container
  install, not specific to Mike's lab.

## 1. Prerequisites

On a fresh Debian 12/13 host or container:

```bash
sudo apt update
sudo apt install -y git nginx zstd curl ca-certificates gnupg
```

- `nginx` — serves the one origin (§6). `deploy/install-services.sh` does **not**
  install it for you; it only checks `command -v nginx` and prints a warning if
  it's missing.
- `zstd` (the CLI package, not just the Node built-in) — `tools/wov-sicherung.sh`
  shells out to `zstd -t` to verify backups (§10). The asset downloader
  (`tools/assets-paket.mjs`) does **not** need this package; it decompresses
  through Node's own `node:zlib` zstd support instead.

Install Node.js 22.5 or newer (`package.json` `engines.node`). In practice you want
a **current** Node 22.x — the asset pipeline and the updater use `node:zlib`'s
built-in zstd (`createZstdDecompress`/`zstdCompressSync`), which only exists on
fairly recent Node 22 builds; NodeSource's current 22.x already qualifies. Either
of these works:

```bash
# NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# or nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# open a new shell, then:
nvm install 22
```

Create the project directory. This is not a suggestion: `deploy/install-services.sh`
hard-aborts unless the checkout lives at exactly `/opt/worldofvikings`, because the
systemd units under `deploy/systemd/` spell that path out literally in
`ExecStart=`/`WorkingDirectory=` (see the comment at the top of the install
script). There's no override flag — either the project lives there, or you edit
every unit file yourself.

```bash
sudo mkdir -p /opt/worldofvikings
sudo chown "$USER" /opt/worldofvikings
```

## 2. Clone and install dependencies

```bash
git clone https://github.com/vibe-code-repo/worldofvikings.git /opt/worldofvikings
cd /opt/worldofvikings
npm ci --include=dev
```

`npm ci --include=dev` installs the root workspaces (`admin`, `server`, `client`,
`shared`, `tools/asset-extractor`, `tools/prefab-parser`, `tools/worldlayout-mcp`).
`--include=dev` matters: `tsx`, which the systemd units invoke directly
(`node_modules/.bin/tsx`), lives in devDependencies.

The website is a **separate** npm project inside the same repo, not a workspace —
install it on its own:

```bash
cd /opt/worldofvikings/wov-web
npm ci --include=dev   # SvelteKit and Vite are devDependencies; with NODE_ENV=production a plain `npm ci` would skip them and the build fails
cd /opt/worldofvikings
```

## 3. Fetch the game assets

Models, textures and audio are not in the repository (`.gitignore`: `assets/*`).
They ship as one archive on GitHub Releases and are downloaded by
`tools/assets-paket.mjs`, wired up as an npm script:

```bash
npm run assets:holen
```

This reads the version your checkout expects from `tools/assets-version.txt`,
downloads `https://github.com/vibe-code-repo/worldofvikings/releases/download/assets-<version>/wov-assets-paket.tar.zst`, verifies its sha256 against the
matching `.sha256` file next to it, and unpacks it into `assets/`. If you ever need
to point at a different archive (e.g. one you built yourself with
`npm run assets:bauen`), set `WOV_ASSETS_URL` (a `file://` URL works too) before
running the command again.

Then derive the aggregated/staged folders the client and dungeon generator expect:

```bash
npm run store:aufbereiten   # runs tools/store-vegetation-aufbereiten.mjs and tools/store-prefabs.mjs
npm run store:boden         # runs tools/store-boden-quellen.mjs and tools/store-terrain-schichten.mjs
```

Finally, generate the appearance list the website's character creator reads
(`assets/appearance.json` — needs no downloaded archive, only `shared/src/aussehen.ts`):

```bash
npm run aussehen:json
```

(`npm run dev`, used for local development, does all four of these automatically
when the corresponding folder is missing — as a warning, not a hard stop, if the
download fails. For a server install, run them explicitly and check they actually
succeed.)

`assets/generiert/` (runtime-built dungeon halls and their `modul-registry.json`)
is deliberately **not** part of this archive — the game server creates that folder
and an empty, valid `modul-registry.json` there on its own first start if neither
exists yet (§8 shows the client's 404 on that file as expected on a fresh install
before any hall has been built).

## 4. Container-wide environment: `/etc/wov.env` and the admin token

`/etc/wov.env` is the **only** place this project's environment differs between
installs — every one of the three systemd services reads it via
`EnvironmentFile=`. It is deliberately outside the repo (`deploy/wov.env.beispiel`
is only the template) and, per `deploy/install-services.sh`, is created from that
template **once**, on first run — a later `sudo deploy/install-services.sh` run
never overwrites an existing `/etc/wov.env`.

Create it now, adjusting the lab-network defaults in the template to your own
setup:

```bash
sudo install -m 0640 deploy/wov.env.beispiel /etc/wov.env
sudo $EDITOR /etc/wov.env
```

Set, at minimum:

- `WOV_INSTANZ=live` — the template defaults to `dev` (which also runs
  `wov-client.service`, the Vite dev server, and enables the hourly
  `wov-karten.timer`; see §6's autostart note). For a normal public server you
  want `live`.
- `WOV_WATCH=` (empty) — the template's `WOV_WATCH=watch` restarts the server on
  every source change; leave it empty for a stable server.
- `NODE_ENV=production`
- `WOV_ADMIN_ADRESSE=127.0.0.1` — the template's example value
  (`10.10.10.12`/`10.10.10.11`) is Mike's own lab IP. `admin/src/main.ts` already
  defaults to `127.0.0.1` when the variable is absent, and `wov-lab.conf` proxies
  to the admin service on `127.0.0.1:2468` — so `127.0.0.1` is what you want here,
  not any LAN address of your own.
- `WOV_ALLOWED_HOSTS=<host>,localhost` — comma-separated hostnames the game
  client's Vite dev server will accept as `Host:` header. Its own default,
  hardcoded in `client/vite.config.ts`, is `.world-of-vikings.com,localhost` (Mike's
  domain) — leaving this unset means the dev server rejects every request that
  doesn't carry that Host header ("Blocked request. This host is not allowed").
  Set it to whatever hostname visitors will actually use.

Two more variables are read by the admin service but are **not** in the template
because their defaults are Mike's lab subnets, not yours:

- `WOV_NAHE_NETZE` (default `127.0.0.1,::1,10.10.10.*,192.168.*`) — the IP guard in
  front of the admin/editor API (`admin/src/main.ts`). Both the raw TCP peer *and*
  the client address resolved through `X-Forwarded-For` must match one of these
  prefixes, or the request gets a flat 403 before the token is even checked. Behind
  `wov-lab.conf` (which always forwards the real visitor IP, see §6), this means:
  **anyone connecting to the world editor / admin console from outside
  `127.0.0.1`/`::1`/`10.10.10.*`/`192.168.*` is blocked by default**, token or no
  token. If your editor/admin users are not on one of those ranges (e.g. you're
  editing the world from home over a public IP, or the machine has no
  `192.168.*`/`10.10.10.*` network at all), set `WOV_NAHE_NETZE` to a list that
  actually covers them — comma-separated, entries may end in `*` for a prefix
  match (e.g. `WOV_NAHE_NETZE=127.0.0.1,::1,203.0.113.0*`). Set this **before**
  first login as an admin, or you'll be locked out of the very API you'd use to
  fix it.
- `WOV_PROXY_ADRESSEN` (default `127.0.0.1,::1,10.10.10.*`) — which peer addresses
  the admin service trusts to *supply* `X-Forwarded-For` at all. `wov-lab.conf`'s
  proxy always runs on the same host (peer address `127.0.0.1`), so the default
  already covers it; you only need to touch this if you put another proxy between
  nginx and the admin service.

`WOV_SESSION_SECRET_HEX` is **optional** and not in the template.
`server/src/WovServer.ts` explains why: without it, the server picks a fresh random
session secret from memory on every restart, which invalidates every previously
issued session token (players just log in again) — accepted as fine for normal
operation. Set it only if you specifically need session tokens to survive a
restart:

```bash
echo "WOV_SESSION_SECRET_HEX=$(openssl rand -hex 32)" | sudo tee -a /etc/wov.env
```

The admin service's access token is a separate file, `/etc/wov-admin.token`. You
can create it yourself:

```bash
sudo install -m 0600 -o root -g root /dev/null /etc/wov-admin.token
openssl rand -hex 24 | sudo tee /etc/wov-admin.token >/dev/null
```

...but note `admin/src/main.ts` generates one itself (32 random bytes as hex, mode
`0600`) the first time it starts and finds the file missing — creating it up front
is only useful so you know the value before the service's first log line tells you.

## 5. `server/data/server.yml`

This file is committed to git and is the same on every clone — it is **not** where
the instance name or world file lives (that's `WOV_INSTANZ`, §4); it only holds
gameplay/server settings that `server/src/ServerKonfig.ts` actually reads (anything
else in the file makes the server refuse to start, by design — see the file's own
header comment).

Two settings you should change before exposing the server publicly:

```yaml
server:
  password: ""          # empty = no password; set one for a private server

players:
  everyone-admin: true   # committed default — DO NOT ship this to a public server
```

**`everyone-admin: true` makes every connected player an admin.** It's the
project's own committed default (meant for a single trusted player/lab), not a
placeholder — set it to `false` for anything public. Once it's `false`, admin
rights come only from the persistent admin list, which is **not** a config file:
connect once (while `everyone-admin` is still `true`, or as the first player),
then grant yourself and others durable admin rights with the in-game/console admin
chat command:

```
admin add <PlayerName>
admin remove <PlayerName>
admin liste
```

(`server/src/WovServer.ts`'s `registerAdminListeCommands`; stored per-instance in
`server/data/worlds/admins.<instance>.json`, which is not committed.)

## 6. Install the systemd services and nginx site

```bash
sudo deploy/install-services.sh
```

What this actually does, in order:

1. Refuses to run unless `/opt/worldofvikings` is the checkout path (§1).
2. Creates `/etc/wov.env` from the template **only if it doesn't already exist**
   (it won't touch the one you just edited in §4).
3. Installs `wov-server.service`, `wov-client.service`, `wov-admin.service`,
   `wov.target`, `wov-karten.service` and `wov-karten.timer` into
   `/etc/systemd/system/` and runs `systemctl daemon-reload`. **It does not
   install `wov-sicherung.service`/`wov-sicherung.timer`** — those exist under
   `deploy/systemd/` but are left for you to install by hand (§10).
4. Removes a leftover `wov-firewall.service` if one is enabled from a previous
   version of this repo.
5. If `nginx` is installed, symlinks `deploy/nginx/wov-lab.conf` to
   `/etc/nginx/sites-available/wov-lab` and into `sites-enabled/`. If nginx is
   missing, it prints a warning and does nothing further for nginx — installing
   the package is left to you (§1). **Before the first reload will succeed**, it
   also needs `/etc/nginx/wov-admin-token.conf` to exist (next step); if that file
   is missing, the script prints a note and does **not** run `nginx -t`/reload —
   it leaves the symlink in place but nginx keeps serving whatever config (or no
   config) it had before.
6. If `wov-web/` exists, runs `npm ci && bash tools/ausrollen.sh` inside it to
   produce the first `wov-web/build` (the directory nginx serves `/` from). A
   failure here is reported but does not abort the script. `tools/ausrollen.sh`,
   called with no arguments (as it is here), only builds locally and has no
   hardcoded host — ignore its `--fern` mode entirely: that's an alternate path
   hardcoded for Mike's own second container (`wov-bau`/`wov-host`/CT 103), not
   something a fresh install ever needs.
7. Unless called with `--no-enable`, enables `wov.target`, `wov-server.service`
   and `wov-admin.service` for autostart. `wov-client.service` (the Vite dev
   server) and `wov-karten.timer` (world-map rendering for the website) are only
   enabled when `/etc/wov.env` has `WOV_INSTANZ=dev` — on `live` they're installed
   but left disabled, since nginx serves the client's built bundles instead (see
   the next note) and there is exactly one world to render maps from.

Remove Debian's default nginx site, which otherwise competes for port 80:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

**The `wov-lab.conf` shipped in this repo proxies `/play/` to the Vite *dev*
server on port 5274** (`wov-client.service`) — that's what "the lab config" means:
it's built for running from source, not for a hardened production bundle. A
commented-out block in the same file shows the alternative (`alias
/opt/worldofvikings/client/dist/` serving pre-built static files instead) if you'd
rather not run a dev server continuously; switching to it means also building
`client/dist` yourself and keeping it updated, which this repo's own update path
(§9) does not do for you.

Now create the file `deploy/install-services.sh` was waiting for:

```bash
sudo install -m 0600 -o root -g root /dev/null /etc/nginx/wov-admin-token.conf
printf 'proxy_set_header x-wov-token "%s";\n' "$(cat /etc/wov-admin.token)" \
  | sudo tee /etc/nginx/wov-admin-token.conf >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

Finally, start everything:

```bash
sudo systemctl start wov.target
```

## 7. Putting TLS / a reverse proxy in front

Nothing in this repo terminates TLS — `wov-lab.conf` listens on plain port 80 and
is meant to be the **single, direct** hop between visitors and the services behind
it: every proxy block in that file overwrites (not appends) `X-Forwarded-For` with
`$remote_addr`, and the admin service's IP guard (§4, `WOV_NAHE_NETZE`) trusts that
one hop. Two ways to add TLS without breaking that:

- **Terminate TLS on this same nginx** (recommended): get a certificate (e.g.
  `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`) and let
  it add a `listen 443 ssl;` server block to `wov-lab.conf`/its own file. Visitors
  still connect directly to this nginx, so `$remote_addr` stays correct.
- **Put another reverse proxy in front of it** (Caddy, a second nginx, a cloud load
  balancer) forwarding to `127.0.0.1:80`: this adds a second hop, so the address
  `wov-lab.conf` sees as `$remote_addr` becomes *that proxy's* address, not the
  visitor's — every downstream `X-Forwarded-For` it sets is then wrong, the admin
  API's origin-based checks and the account API's rate limiter both end up
  keyed on the same address for everyone. Only do this if you also change
  `wov-lab.conf` to read the real client IP from whatever header your outer proxy
  sets (it doesn't do this out of the box) and adjust `WOV_PROXY_ADRESSEN`/
  `WOV_NAHE_NETZE` (§4) to trust that outer proxy's address.

Either way, the outer edge (whichever nginx terminates TLS) must forward WebSocket
upgrades for `/ws` — `wov-lab.conf`'s own `/ws` block already does this for the
plain-HTTP hop; an outer proxy needs the equivalent (`Upgrade`/`Connection: upgrade`
headers, and a proxy timeout longer than defaults — `wov-lab.conf` uses 3600s).

## 8. Verify

```bash
curl -I http://<host>/                      # website, expect 200
curl -I http://<host>/play/                 # game client, expect 200
curl -I http://<host>/editor/               # world editor, expect 200 (redirected from /play/editor.html)
curl -s http://<host>/api/accounts/status   # account API, expect JSON with a player count
curl -I http://<host>/assets/manifest.json  # asset manifest, expect 200
curl -I http://<host>/assets/generiert/modul-registry.json  # expect 200 with an
     # empty registry once the game server has started at least once (§3) — the
     # server creates this file itself, no hall needs to have been built yet
curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     http://<host>/ws                       # expect 101 Switching Protocols

systemctl status wov.target --no-pager
journalctl -u wov-server -n 30 --no-pager
```

To check the whole chain the way a visitor does, sign in with one of the two standard
accounts `server/data/server.yml` creates on first start: `gast`/`gast` on the German
pages, `guest`/`guest` on the English ones (see the `standard-konto:` block there and the
README). `/api/accounts/status` lists them under `standardKonten`; if that field is
missing, the game server never created them — check `journalctl -u wov-server` for a
`[Konfig] server.yml standard-konto:` warning.

A plain `curl http://<host>:2467/` against the game server itself (bypassing
nginx) is expected to answer `426 Upgrade Required` — that's how
`tools/wov-update.sh`'s own health check recognizes a live server; anything else
(including `000`, meaning nothing is listening) means it isn't up.

## 9. Updating

```bash
sudo tools/wov-update.sh
```

Stops `wov-server`/`wov-client`/`wov-admin` (only the ones currently enabled),
`git pull --ff-only origin main`, `npm ci --include=dev`, re-runs
`store:aufbereiten`/`store:boden` (§3 — it does **not** re-fetch the asset archive
itself; that only happens if you run `assets:holen` yourself), `npm run typecheck`,
runs the test suite, builds `wov-web` (`npm ci && npm run build` inside `wov-web/`,
plus its own no-JS/syntax check), restarts the services it stopped, and then polls
the game server (expects `426`, see §8) and, if `wov-admin` is enabled, the admin
service's `/status` endpoint using the token from `/etc/wov-admin.token`. If any of
these steps fails, nothing after it runs, and the script tells you which of "the
services are stopped" vs. "the services are running but the health check failed"
applies.

`sudo tools/wov-update.sh zurueck` undoes exactly the last such update (checks out
the previous commit and, where relevant, restores the previously-built client
bundle from `/var/backups/wov/`) — one step, not a stack.

`server/data/` (world documents, save files, the admin token list) is never
touched by this script.

## 10. Backups

`tools/wov-sicherung.sh` backs up the current instance's save file
(`server/data/worlds/<instanz>.db.zst` and its `.prev`) and world document
(`server/data/welten/<instanz>.json`) into `/var/backups/wov/welten/<instanz>/`
(override with `WOV_SICHERUNG_ZIEL`), verifying each `.db.zst` copy with `zstd -t`
(the reason `zstd` is a prerequisite in §1) and retrying once if a copy lands mid-write.

The corresponding systemd units (`wov-sicherung.service`, a nightly
`wov-sicherung.timer` at 03:17) ship in `deploy/systemd/` but, unlike the other
units, **`deploy/install-services.sh` does not install or enable them** — do it
yourself once:

```bash
sudo install -m 0644 deploy/systemd/wov-sicherung.service deploy/systemd/wov-sicherung.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wov-sicherung.timer
```

Accounts (`server/data/konten/<instanz>.db`) are not covered by this script and
are not backed up by anything in this repo — back them up yourself if you care
about preserving player accounts across a disaster.

## 11. Troubleshooting

- **`/api/...` returns 502 or times out**: usually the admin service isn't
  running, or `/etc/nginx/wov-admin-token.conf` never got created (§6) — nginx
  then never picked up the reload that would let `/api/` work at all. Check
  `systemctl status wov-admin` and `journalctl -u wov-admin`.
- **`/api/...` returns 401**: the token in `/etc/nginx/wov-admin-token.conf`
  doesn't match `/etc/wov-admin.token`. Re-run the two commands from §6's last
  step and reload nginx.
- **`/api/...` (world editor / admin console) returns 403 "Zugriff nur aus dem
  lokalen Netz"**: your IP address doesn't match `WOV_NAHE_NETZE` (§4). This is
  the most common surprise for anyone editing the world from outside Mike's own
  lab subnets — fix `WOV_NAHE_NETZE` in `/etc/wov.env` and `systemctl restart
  wov-admin`.
- **The client's dev server refuses every request ("Blocked request. This host is
  not allowed")**: `WOV_ALLOWED_HOSTS` (§4) doesn't list the hostname you're
  browsing to.
- **`/de/` (with a trailing slash) is a 403, `/de` isn't**: intentional —
  `wov-lab.conf`'s comment explains this is deliberate, not a broken rollout;
  bookmark `/de` (and `/en`), not `/de/`.
- **The world loads but players fall through terrain / walk through everything,
  and the server log shows** `[Kollision] KEINE Formen — Spieler laufen durch
  alle Hindernisse`: the asset archive (§3) never made it into `assets/models` —
  run `npm run assets:holen` and check its output for the actual download error.
- **The character creator on the website shows empty dropdowns / "assets/
  appearance.json nicht erreichbar"**: `npm run aussehen:json` (§3) was never run,
  or nginx's `/assets/` block (§6) can't reach `assets/appearance.json`.
- **`sudo deploy/install-services.sh` aborts immediately** with a path mismatch:
  the checkout isn't at `/opt/worldofvikings` (§1) — there's no flag to change
  this, only moving the checkout or hand-editing every unit file.
- General log commands:

  ```bash
  journalctl -fu wov-server
  journalctl -fu wov-client
  journalctl -fu wov-admin
  sudo nginx -t
  ```

---

## Kurzfassung (Deutsch)

Dieses Dokument beschreibt, wie ein fremder Betreiber allein aus diesem Repo einen
Spielserver samt Webseite aufsetzt.

1. **Voraussetzungen**: Debian 12/13, `apt install git nginx zstd curl`, Node
   22.5+ (NodeSource oder nvm — praktisch ein aktuelles Node 22, wegen des in
   `node:zlib` eingebauten zstd, das Asset-Downloader und Updater nutzen). Projekt
   MUSS unter `/opt/worldofvikings` liegen — die systemd-Units tragen diesen Pfad
   fest verdrahtet, `install-services.sh` bricht sonst sofort ab.
2. **Klonen**: `git clone … /opt/worldofvikings`, dort `npm ci --include=dev`
   (Root-Workspaces), zusätzlich `cd wov-web && npm ci` (eigenes, kein Workspace).
3. **Assets**: `npm run assets:holen` lädt das signierte Release-Paket von GitHub
   (Alternative: `WOV_ASSETS_URL`), danach `npm run store:aufbereiten && npm run
   store:boden` sowie `npm run aussehen:json` (Aussehens-Listen der Webseite).
4. **`/etc/wov.env`** aus `deploy/wov.env.beispiel` anlegen: `WOV_INSTANZ=live`,
   `WOV_WATCH=` leer, `NODE_ENV=production`, `WOV_ADMIN_ADRESSE=127.0.0.1`,
   `WOV_ALLOWED_HOSTS=<eigene Domain>,localhost`. **Wichtig, aber nicht in der
   Vorlage**: `WOV_NAHE_NETZE` (Vorgabe `127.0.0.1,::1,10.10.10.*,192.168.*`,
   Mikes Labornetz!) — wer Editor/Admin-API nicht aus einem dieser Netze
   erreicht, bekommt sonst dauerhaft ein 403, egal wie richtig der Token ist.
   `WOV_SESSION_SECRET_HEX` ist optional (ohne sie: neues Geheimnis bei jedem
   Neustart, akzeptierter Normalfall laut Quelltext-Kommentar). Token:
   `/etc/wov-admin.token` selbst anlegen oder den Betriebsdienst beim ersten
   Start eines erzeugen lassen.
5. **`server/data/server.yml`**: Passwort setzen, `everyone-admin: false` (der
   committete Vorgabewert ist `true` — für einen öffentlichen Server ZWINGEND
   ändern!). Admins danach per Chat-/Konsolenbefehl `admin add <Name>` vergeben,
   nicht in einer Konfigurationsdatei.
6. **`sudo deploy/install-services.sh`**: installiert die drei Dienste + `wov.target`
   + Kartentimer, verlinkt `deploy/nginx/wov-lab.conf`, baut die Webseite einmalig
   — installiert aber NICHT die Sicherungs-Units (Punkt 10) und reicht `nginx -t`/
   Reload nur nach, wenn `/etc/nginx/wov-admin-token.conf` schon existiert. Diese
   Datei selbst anlegen (Token aus `/etc/wov-admin.token` hineinschreiben),
   `/etc/nginx/sites-enabled/default` entfernen, `nginx -t && systemctl reload
   nginx`, dann `systemctl start wov.target`.
7. **TLS/Reverse-Proxy davor**: am saubersten direkt auf diesem nginx terminieren
   (z. B. certbot), weil jeder Block in `wov-lab.conf` `X-Forwarded-For`
   überschreibt und davon ausgeht, selbst der einzige Sprung zu sein. Ein
   zusätzlicher Proxy davor verfälscht sonst die erkannte Besucheradresse
   (Admin-Guard, Anmeldesperre) — nur mit angepasstem `wov-lab.conf` und
   `WOV_PROXY_ADRESSEN`/`WOV_NAHE_NETZE` sicher.
8. **Prüfen**: curl auf `/`, `/play/`, `/editor/`, `/api/accounts/status`,
   `/assets/manifest.json`, WebSocket-Handshake auf `/ws` (101), sowie
   `systemctl status wov.target`.
9. **Update**: `sudo tools/wov-update.sh` — stoppt Dienste, `git pull --ff-only`,
   `npm ci`, Store aufbereiten, Typecheck, Tests, Webseite bauen, Dienste neu
   starten, Gesundheitsprüfung (Spielserver erwartet HTTP 426, Betriebsdienst
   `/status`). `tools/wov-update.sh zurueck` macht genau einen Schritt rückgängig.
10. **Sicherung**: `tools/wov-sicherung.sh` sichert Spielstand und Weltdokument
    nach `/var/backups/wov/welten/<instanz>/` — die zugehörigen systemd-Units
    (`wov-sicherung.service`/`.timer`) installiert `install-services.sh` NICHT
    automatisch, das muss von Hand nachgeholt werden. Konten
    (`server/data/konten/`) sichert nichts in diesem Repo.
11. **Fehlersuche**: 502/401 auf `/api/` → Token/Token-Datei fehlt oder passt
    nicht; 403 „Zugriff nur aus dem lokalen Netz" → `WOV_NAHE_NETZE` passt nicht
    zur eigenen Adresse; `/de/` (mit Schrägstrich) ist absichtlich 403, `/de`
    nicht; „KEINE Formen" im Server-Log → Asset-Paket fehlt; leere
    Charaktererstellung auf der Webseite → `npm run aussehen:json` fehlt oder
    `/assets/` liefert die Datei nicht aus.
