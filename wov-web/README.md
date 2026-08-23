# wov-web — world-of-vikings.com

Die öffentliche Seite von World of Vikings. Getrennt vom Spiel-Repo, so wie sie
auch getrennt läuft: eigener Container, eigener Quellbaum.

**SvelteKit 2 · Svelte 5 · Vite 8 · TypeScript · Biome** — dieselbe Werkzeugkette
wie [World of ClaudeCraft](https://github.com/levy-street/world-of-claudecraft),
mit einem Unterschied, der hier zählt (siehe unten).

## Was hier anders ist als bei ClaudeCraft

ClaudeCraft rendert im Browser: mehrere HTML-Einstiege, Svelte clientseitig
gemountet, kein Prerendering. Für ein Spiel ist das richtig — dort ist die Seite
die Anwendung.

Diese Seite ist ein Schaufenster, und sie war vor dem Umbau ohne JavaScript
vollständig lesbar. Deshalb `adapter-static` mit vollem Vorrendern: Der Build
wirft fertige HTML-Dateien aus, nginx liefert sie wie bisher aus, und im Browser
übernimmt nur noch, was Bewegung braucht (Kartenbetrachter, Weltstatus,
Ruhmestafel, Charaktervorschau). Fällt das aus, steht der Text trotzdem.

Nachweis nach jedem Build:

```
tools/ohne-js-pruefen.sh
```

## Aufbau

```
src/
  app.html              Grundgerüst: Symbole, Schriften, Manifest
  lib/
    seiten.ts           Navigation — eine Quelle für Kopf, Mobilleiste, Fuß, Sitemap
    formate.ts          Datum, Zeitspannen, JSON holen
    recken.ts           Typen der Reckendaten und die Tafeln der Ruhmeshalle
    Kopf/MobilNav/Fuss  die Hülle, die vorher siebenmal kopiert war
    Kopfdaten.svelte    Titel, Beschreibung, canonical, Open Graph je Seite
    IkonenVorrat        SVG-Symbolsammlung, einmal statt siebenmal
    Kartenbetrachter    Zoom, Schieben, Kneifen, Legende
    Reckenprofil        die Armory-Ansicht
    stil/wov.css        das Entwurfssystem „Rune & Iron"
  routes/
    +layout.svelte      Hülle um alle Seiten
    +page.svelte        Halle          → /            (index.html)
    saga/               Die Saga       → /saga        (saga.html)
    karte/              Die Karte      → /karte       (karte.html)
    ruestkammer/        Rüstkammer     → /ruestkammer
    ruhmeshalle/        Ruhmeshalle    → /ruhmeshalle
    thing/              Das Thing      → /thing
    erstellen/          Charakter      → /erstellen
    sitemap.xml/        erzeugt aus seiten.ts
static/                 unverändert ausgelieferte Dateien
```

### Die Adressen bleiben, wie sie waren

`trailingSlash` steht auf `never`. Der Adapter schreibt deshalb `build/saga.html`
und nicht `build/saga/index.html` — Zeichen für Zeichen dieselben Dateinamen wie
vor dem Umbau. Alte Links auf `/saga.html` gehen weiter, `/saga` ebenso (nginx:
`try_files $uri $uri.html`). Welche die richtige ist, sagt das
`<link rel="canonical">`.

### Was NICHT durch Vite läuft

`static/assets/js/vorschau.js` — das Babylon-Bündel der Charaktervorschau, 2,8 MB.
Es wird im **Spiel-Repo** gebaut (`tools/vorschau-buendeln.mjs`), weil Babylon
dort ohnehin liegt. Die Seite bekommt nur das Ergebnis und lädt es zur Laufzeit
mit `import(/* @vite-ignore */ …)`.

Ebenso erzeugt und nur hierher kopiert: `static/assets/aussehen.json`
(`tools/aussehen-json.mjs`) und `static/assets/karten/*`
(`tools/weltkarte-veroeffentlichen.mjs`).

## Befehle

```
npm run dev        Entwicklungsserver auf Port 5280
npm run build      baut nach build/
npm run vorschau   baut und liefert das Ergebnis lokal aus
npm run check      svelte-check (Typen und Vorlagen)
npm run lint       Biome
npm run format     Biome, schreibend
```

## Ausrollen

Läuft von Mikes Arbeitsplatz aus, weil nur der beide Enden erreicht: `wov-bau`
für den Build und `wov-host` für den Zugang zu CT 103.

```
tools/ausrollen.sh            # baut auf wov-dev und legt das Ergebnis auf CT 103
tools/ausrollen.sh --trocken  # baut und zeigt nur, was sich ändern würde
```

Das Skript legt vor jedem Lauf eine Sicherung neben den Zielordner.

## Content-Security-Policy

Sie steht in `svelte.config.js`, nicht mehr in nginx. Grund: SvelteKit setzt für
die Hydration ein Inline-Skript, und ein Kopf mit `script-src 'self'` blockt das
— der Browser erzwingt den Durchschnitt aller Regelwerke. `mode: 'hash'` schreibt
je Seite den passenden Hash in ein `<meta>`; das pflegt sich mit jedem Build
selbst.

In nginx bleibt für HTML nur `frame-ancestors 'none'` stehen — diese eine
Anweisung ignoriert der Browser im `<meta>`, sie muss ein Kopf sein. Alle
übrigen Sicherheitsköpfe sind unverändert.

`connect-src` erlaubt zusätzlich `play.world-of-vikings.com` und
`play.dev.world-of-vikings.com`. Ohne das ist die Charaktervorschau blockiert —
das war sie bis zum 23.08.2026 nachweislich.

## Offen (Block H der Roadmap)

- **H3** Bilder — es gibt inzwischen Heldenbild, Wappen und vier Kacheln, aber
  keinen echten Screenshot aus dem Spiel.
- **H4** Barrierefreiheit — das Suchfeld hat jetzt einen Namen, Skip-Link und
  Fußkontrast stehen noch aus.
- **H6** echter API-Endpunkt statt der Demo-JSON unter `static/api/`.
- **H8** Forum.
- **H9** englische Fassung mit hreflang. Mit `seiten.ts` und `Kopfdaten.svelte`
  ist der Weg dorthin jetzt kurz.
- **H10** Systemanforderungen, Kontakt, Fehlermeldeweg.
