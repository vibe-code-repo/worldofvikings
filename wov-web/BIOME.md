# Warum Biome hier keine .svelte-Dateien anfasst

Biome liest aus einer `.svelte`-Datei nur den `<script>`-Block — die Vorlage
darunter kennt es nicht. Alles, was ausschliesslich in der Vorlage benutzt wird
(Komponenten-Importe, Zustandsvariablen, abgeleitete Werte), hält es deshalb für
tot und meldet `noUnusedImports` bzw. `noUnusedVariables`.

Am 23.08.2026 waren das 86 Warnungen, von denen **keine einzige** zutraf. Eine
Liste, in der nichts stimmt, liest nach zwei Tagen niemand mehr — und dann geht
die eine echte Meldung darin unter.

Svelte-Dateien prüft stattdessen `npm run check` (svelte-check). Das versteht
Vorlagen, prüft Typen über die Grenze zwischen Skript und Markup hinweg und
kennt die Barrierefreiheitsregeln. Biome bleibt für `.ts`, `.js` und `.json`
zuständig, wo es vollständig sieht, was da steht.

Beide zusammen sind die Prüfung — einzeln ist keines von beiden vollständig.
