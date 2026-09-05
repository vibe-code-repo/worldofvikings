#!/usr/bin/env node
// Prüft: dass kein Skript unter tools/elements/ einen Ort ausserhalb des Repos fest verdrahtet hat.
/*
  S2 (Elemente-Umzug). Der Umzug ins Repo ist erst dann etwas wert, wenn die
  Skripte auch OHNE ihren alten Ort laufen. Beim Kopieren fällt das nicht auf:
  Auf Mikes Rechner gibt es ~/wov-ai weiterhin, das Skript findet seine Datei
  und niemand merkt, dass es sie am falschen Ort gefunden hat. Erst der
  nächste Checkout — ein zweiter Rechner, wov-dev, CI — läuft ins Leere, und
  dann ist der Zusammenhang zum Umzug längst vergessen.

  Der Wächter hält deshalb die Zusage fest, die S2 gibt:

    Kein Skript unter `tools/elements/` nennt einen Pfad ausserhalb des
    Repos. Eingaben kommen aus `$WOV_MODELLE` (Vorgabe: `assets/models`
    dieses Repos), Ergebnisse nach `$WOV_ELEMENTE_AUS` (Vorgabe
    `~/wov-elemente`) — beides mit Vorgaben, die jeder Checkout hat.

  KOMMENTARE SIND AUSGENOMMEN, und das ist Absicht: Woher eine Datei kam,
  gehört in ihren Kopf (`run-kit.sh` erklärt genau das). Verboten ist der
  fremde Ort im WIRKSAMEN Teil — dort, wo ihn ein Lauf benutzt.

  Aufruf:  node tools/elements/pruefe-pfade.mjs [wurzel]
  `wurzel` zeigt auf einen anderen Baum (z. B. einen Auszug aus git) — damit
  lässt sich nachweisen, dass der Wächter überhaupt rot werden kann.
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url))));

/* Die Orte, an denen die Skripte bis zum 04.09.2026 hingen. `wov-ai` sind die
   beiden Quellordner des Umzugs; die drei anderen sind FREMDE Arbeitsbäume —
   ein Skript, das dorthin schreibt, greift in die Arbeit einer anderen
   Aufgabe ein. `/home/<name>` fängt den allgemeinen Fall: einen absoluten
   Pfad in jemandes Heimatverzeichnis. */
const VERBOTEN = [
  [/wov-ai\b/, 'liegt ausserhalb des Repos (alter Ort des Umzugs)'],
  [/wov-wt-tripo-texture\b/, 'fremder Arbeitsbaum'],
  [/wov-wt-dungeon2\b/, 'fremder Arbeitsbaum'],
  [/wov-treppe\b/, 'fremder Arbeitsbaum'],
  [/\/home\/[a-z]/i, 'absoluter Pfad in ein Heimatverzeichnis'],
];

const SKRIPTE = /\.(py|sh|mjs|js|ts)$/;

/* Diese Datei prüft sich nicht selbst — sie ist die einzige, die die
   verbotenen Orte NENNEN muss, um sie zu erkennen. Die Ausnahme ist auf
   genau einen Dateinamen eng gezogen und nicht auf ein Muster: Wer hier
   einen echten Pfad einbaut, wird von keinem Wächter erwischt, sondern nur
   von einem Leser. */
const SELBST = 'pruefe-pfade.mjs';

// Kommentarzeilen erkennen. Python und Shell kennen nur `#`; für die
// JS-Familie kommt der Blockkommentar dazu, der über Zeilen läuft — ohne ihn
// fiele der Kopf dieser Datei selbst durch.
//
// Diese Erklärung steht bewusst in Zeilenkommentaren: Sie muss den
// Blockkommentar-SCHLUSS wörtlich nennen, und in einem Blockkommentar hätte
// genau das ihn hier beendet — der Rest des Absatzes wäre Quelltext geworden.
// (Genau so ist es beim Schreiben dieser Datei passiert.) Zeichenketten mit
// zwei Schrägstrichen (z. B. "http://…") können den Blockzustand nicht
// verstellen, weil nur auf Blockanfang und Blockschluss geachtet wird und
// beide in URLs nicht vorkommen.
function nutzzeilen(text, datei) {
  const jsArt = /\.(mjs|js|ts)$/.test(datei);
  const zeilen = text.split('\n');
  let imBlock = false;
  return zeilen.map((zeile, i) => {
    const t = zeile.trim();
    let kommentar = t.startsWith('#') || (jsArt && t.startsWith('//'));
    if (jsArt) {
      if (imBlock) kommentar = true;
      if (t.includes('/*')) { kommentar = true; imBlock = !t.slice(t.indexOf('/*')).includes('*/'); }
      else if (imBlock && t.includes('*/')) imBlock = false;
    }
    return { nr: i + 1, text: zeile, kommentar };
  });
}

function dateien(ordner) {
  const raus = [];
  for (const eintrag of readdirSync(ordner)) {
    const pfad = join(ordner, eintrag);
    if (statSync(pfad).isDirectory()) raus.push(...dateien(pfad));
    else if (SKRIPTE.test(eintrag) && eintrag !== SELBST) raus.push(pfad);
  }
  return raus;
}

const alle = dateien(WURZEL);
let treffer = 0;
for (const pfad of alle) {
  for (const zeile of nutzzeilen(readFileSync(pfad, 'utf8'), pfad)) {
    if (zeile.kommentar) continue;
    for (const [muster, grund] of VERBOTEN) {
      if (!muster.test(zeile.text)) continue;
      treffer += 1;
      console.log(`${relative(WURZEL, pfad)}:${zeile.nr}: ${grund}\n    ${zeile.text.trim()}`);
      break;
    }
  }
}

// Leerlauf-Falle: findet der Wächter keine Dateien, hat er nichts geprüft —
// und ein Lauf ohne Prüfling darf nicht wie ein bestandener aussehen.
if (alle.length === 0) {
  console.log(`PFAD-WÄCHTER ROT — keine Skripte unter ${WURZEL} gefunden.`);
  process.exit(1);
}
if (treffer > 0) {
  console.log(`\nPFAD-WÄCHTER ROT — ${treffer} fest verdrahtete(r) Fremdpfad(e) in ${alle.length} Skripten.`);
  process.exit(1);
}
console.log(`PFAD-WÄCHTER OK — ${alle.length} Skripte, kein Ort ausserhalb des Repos.`);
