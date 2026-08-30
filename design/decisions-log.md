---
tags: [wov, dungeon-generator-2, entscheidungen]
status: laufend
erstellt: 2026-08-30
---

# Zusatzentscheidungen der Umsetzung

Hier steht, was `ARCHITECTURE.md` an einer Stelle offen liess oder wo zwei
Stellen einander widersprachen — und wie konservativ im Geist der Beschlüsse
entschieden wurde. **Jeder Eintrag: Datum, Paket, Entscheidung, Grund.**
Diese Datei ersetzt `ARCHITECTURE.md` nicht; sie ergänzt sie.

---

## 2026-08-30 · AP1 · Himmelsrichtungen: Norden = +z, Osten = +x

**Lücke:** `ARCHITECTURE.md` §3.3 friert `Kante { Nord=1, Ost=2, Sued=4, West=8 }`
ein, sagt aber nirgends, welche Achsenrichtung „Nord" ist. Ohne diese Festlegung
kann `nachbarZelle()` nicht geschrieben werden, und die Kanonisierung von Türen
(§3.4: „an der Zelle mit kleinerem (ebene,z,x)") ist unbestimmt.

**Entscheidung:** Norden = **+z**, Osten = **+x**, Süden = −z, Westen = −x.

**Grund:** Das ist die bereits belegte Projektkonvention, nicht eine neue
Erfindung — `client/src/ui/Minimap.ts` („Koordinaten: Norden = +z (oben), Osten =
+x (rechts)"), `client/src/ui/WorldMap.ts` und `shared/src/weather.ts`
(„0 = +Z (north), growing towards +X"). Eine zweite Konvention im Dungeon wäre
genau der Fehler, der einmal falsch herum implementiert wird.

**Folge:** Kanonische Türkanten sind damit **genau `Nord` und `Ost`** (die
Nachbarzelle liegt dort bei größerem z bzw. x, die eigene Zelle ist also die mit
dem kleineren (ebene,z,x)). `validateLayout` lehnt Türen auf `Sued`/`West` mit
der Regel `tuer-kanonisch` ab; `kanonisiereKante()` klappt sie um.

---

## 2026-08-30 · AP1 · `validateLayout` liegt in `layout.ts`, die Gitterregeln in `validation.ts`

**Widerspruch:** Der Arbeitsauftrag zu AP1 verlangt `validateLayout` mit „allen
Invarianten" in `layout.ts`. `ARCHITECTURE.md` §1.2/AP2 weist `validation.ts`
mit denselben Invarianten dem Paket AP2 zu. Beides zugleich geht nicht: Acht der
elf Invarianten aus §3.7 (Erreichbarkeit, lichte Höhe je Zelle, Doppelbelegung,
Ebenenabstand, Treppenanschluss, Tür im Fels, Anker in der Luft, Rückgrat)
brauchen das **ausgerollte Zellgitter** aus `cells.ts` — und `cells.ts` gibt es
in AP1 noch nicht. Ein Import von `cells.ts` in `layout.ts` wäre außerdem ein
Zyklus, weil `cells.ts` die Typen aus `layout.ts` braucht.

**Entscheidung:** `layout.ts` exportiert `validateLayout(layout): Befund[]` und
prüft darin **alle Invarianten, die ohne Zellgitter entscheidbar sind**
(Ganzzahligkeit, Prüfsumme, `materialTag ≤ 5`, Kantenbits, Vierteldrehungen,
doppelte Ids/Korrekturen/Türen, Türkanonisierung, Stempelmaße und -lichte,
Grenzen, Raster, Format/Version). Der Befund-Typ `Befund`, die Schwere-Skala und
**die Kurznamen ALLER Regeln aus §3.7** — auch der acht gitterabhängigen —
stehen ebenfalls in `layout.ts`.

`validation.ts` (AP2) ruft diese Funktion auf, **ergänzt** ihre Befunde um die
gitterabhängigen und exportiert das Ergebnis. Es ersetzt sie nicht.

**Grund:** (a) Die Regelnamen sind Vertragsfläche für Tests und den
Editor-Prüfbericht; ein Regelname an zwei Orten ist ein Regelname, der an einem
der beiden Orte umbenannt wird. (b) Der Ganzzahl-Grundsatz aus §3.1 ist eine
**Format**zusage — sie gehört zum Format, nicht zur Geometrie. (c) So kann
bereits AP1 messend nachweisen, dass eine eingeschmuggelte Fließkommazahl
abgelehnt wird (Prüfkriterium (d)), ohne AP2 vorwegzunehmen.

---

## 2026-08-30 · AP1 · Die „Typprüfung" gegen Fließkomma ist `migriere()`, nicht TypeScript

**Lücke:** Prüfkriterium (d) verlangt, dass ein Layout mit eingeschmuggelter
Fließkommazahl „von der Typprüfung **und** von `validateLayout`" abgelehnt wird.

**Entscheidung:** Die Typprüfung des Formats ist der strenge Leseweg in
`migriere()` (intern `leseLayout()`), der jedes Ganzzahlfeld mit
`Number.isInteger` prüft und bei Verstoß `null` liefert.

**Grund:** TypeScript kann `0.5` nicht von `1` unterscheiden — beides ist
`number`. Eine Brandung („branded integer types") über das eingefrorene Format
zu legen wäre eine Änderung der eingefrorenen Interfaces und damit verboten.
Eine echte Fließkommazahl kommt in der Praxis ohnehin nicht aus dem TypeScript-
Code, sondern **über JSON aus einem gespeicherten Dokument** — genau dort steht
jetzt die Prüfung. Der Test schmuggelt sie deshalb auch über `JSON.parse` ein.

---

## 2026-08-30 · AP1 · `raster.hoehenSchrittM` darf gebrochen sein

**Lücke:** §3.1 sagt „Das Layout enthält keine Fließkommazahlen", §3.2 setzt
gleichzeitig `HOEHEN_SCHRITT_M = 0.5`, und §3.5 schreibt das Raster ins Dokument.

**Entscheidung:** Der Ganzzahl-Grundsatz gilt für **Koordinaten** (Zellindex,
Ebenenindex, Höhenstufe, Vierteldrehung). Der Block `raster` enthält
**Metermaße**, keine Koordinaten; `hoehenSchrittM` wird als endliche positive
Zahl geprüft, `zelleM`, `ebeneM` und `blockZellen` als Ganzzahlen.

**Grund:** Der Grundsatz will Bit-Gleichheit der *Geometrie-Eingaben* sichern.
`hoehenSchrittM` ist eine Konstante des Dokuments, kein pro-Zelle-Wert; sie geht
als ein einziger, wörtlich serialisierter Wert in die Prüfsumme ein und kann
deshalb nicht schleichend auseinanderlaufen.

---

## 2026-08-30 · AP1 · Laufzeit-Spiegel neben den `const enum`s

**Risiko:** `ARCHITECTURE.md` §3.3/§3.4 friert `Kante`, `ZellenArt` und
`AnkerOrt` als `export const enum` ein. Im Projekt ist aber belegt
(`client/src/editor/GegenstandsKatalog.ts`, Kommentar dort), dass esbuild/Vite
`const enum` **über Modulgrenzen hinweg nicht zuverlässig auflösen**. Ein
`Kante.Nord`, das im Browser-Bündel zu `undefined` wird, hat kein Symptom außer
einer falschen Wand.

**Entscheidung:** Die `const enum`s bleiben unverändert (Format ist eingefroren).
Zusätzlich exportiert `layout.ts` die Laufzeit-Spiegel `KANTE`, `ZELLEN_ART`,
`ANKER_ORT` (eingefrorene `as const`-Objekte mit denselben Zahlen) sowie `KANTEN`
und `KANTE_ALLE`. **Wo ein Wert gebraucht wird, wird der Spiegel benutzt; wo ein
Typ gebraucht wird, das `const enum`.**

**Grund:** Additive Exporte, kein Formatfeld — die eingefrorenen Interfaces
bleiben Zeichen für Zeichen wie beschlossen. Der Spiegel kostet nichts und nimmt
eine stille Fehlerklasse aus dem Weg.

---

## 2026-08-30 · AP1 · Kanonisierung: Schreibweisen werden vereinheitlicht

**Lücke:** §3.6 sagt „sortiert wird vor dem Serialisieren", sagt aber nichts
über zwei Schreibweisen desselben Sachverhalts.

**Entscheidung:** In `kanonisch()` und im Leseweg gilt:
`loeschen: false` ≡ fehlendes `loeschen` · `-0` ≡ `0` · fehlende optionale
Felder (`neigung`, `kante`, `schluessel`, `prefab`) werden mit einem festen
Platzhalter serialisiert, nie ausgelassen · die Felder einer `ZellenAenderung`
stehen in **fester** Reihenfolge (`ZELL_FELDER`), nie in Objektschlüssel-
reihenfolge · bei gleichem Sortierschlüssel entscheidet der **serialisierte Text**
des Eintrags, nie die Eingabereihenfolge.

**Grund:** Sonst hat dasselbe Grab zwei Prüfsummen, je nachdem wer es
geschrieben hat — und der Zeuge meldet einen Unterschied, den es nicht gibt.
Der letzte Punkt ist die eigentliche Absicherung gegen §3.6 („eine
`Map`-Iterationsreihenfolge darf nie in die Prüfsumme eingehen").

---

## 2026-08-30 · AP1 · Prüfsumme bei Migration

**Lücke:** §3.6 beschreibt die Migrationskette, sagt aber nicht, was mit
`pruefsumme` geschieht.

**Entscheidung:** Lief **kein** Migrationsschritt, bleibt `pruefsumme`
unangetastet. Lief **mindestens einer**, wird sie neu gerechnet.

**Grund:** Ohne Schritt ist das Dokument unverändert — der alte Zeuge muss
weiter stimmen, sonst könnte die Migration einen echten Fehler zudecken. Mit
Schritt hat sich der Inhalt berechtigt geändert, und eine alte Prüfsumme wäre
ein falscher Zeuge.

---

## 2026-08-30 · AP1 · Hinweis an AP0: der Schichtentest muss Kommentare ausblenden

**Kein Beschluss, eine Warnung.** Die zweisprachige Kommentarregel führt dazu,
dass englische Kommentare Wörter wie `document`, `window` oder `Math.random`
enthalten (in `layout.ts` z. B. „the same document", „no `Math.random`"). Ein
Schichtentest, der den **Rohtext** scannt, meldet diese Dateien falsch rot.
`shared/test/dungeon2-schichten.ts` (AP0) muss Kommentare und Zeichenketten
**vor** dem Scannen entfernen — sonst ist der Schutzzaun ab der ersten Datei
unbrauchbar.
