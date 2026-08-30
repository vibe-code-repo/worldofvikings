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

---

## 2026-08-30 · AP2 · Drehformel für Stempel-Fußabdrücke

**Lücke:** `RaumStempel.drehung` ist eingefroren (§3.4), aber weder
`ARCHITECTURE.md` noch `data-model.md` sagen, WIE ein `breite`×`tiefe`-
Fußabdruck bei einer Vierteldrehung auf dem Raster abgebildet wird. Die einzige
Angabe ist „Ankerzelle (kleinste x/z-Ecke) **vor** der Drehung" —
`editor-integration.md` §3.5 nennt die Rotationsdarstellung selbst als offene
Frage ans Datenmodell.

**Entscheidung:** `stempelVersaetze()` (`cells.ts`) rotiert jeden lokalen
Zellversatz `(lx,lz) ∈ [0,breite)×[0,tiefe)` gegen den Uhrzeigersinn
(Norden=+z, Osten=+x) um den Ursprung und verschiebt das Ergebnis so, dass es
wieder bei `(0,0)` beginnt:

```
drehung 0: (lx, lz)
drehung 1: (lz, breite-1-lx)
drehung 2: (breite-1-lx, tiefe-1-lz)
drehung 3: (tiefe-1-lz, lx)
```

Die Weltposition der Ankerzelle (`stempel.x`/`stempel.z`) bleibt bei jeder
Drehung unverändert; bei 90°/270° tauschen `breite` und `tiefe` ihre
Ausdehnung.

**Grund:** Konservativ und symmetrisch — die einzige Eigenschaft, die
ARCHITECTURE tatsächlich festlegt ("kleinste x/z-Ecke bleibt Anker"), ist
mit dieser Formel für alle vier Drehungen erfüllt, ohne eine Annahme über
Templates oder Richtungsmuster zu treffen, die es in AP2 noch nicht gibt.
`generator.ts` (AP4) ist der einzige heutige Erzeuger von `drehung` und prüft
dort, ob die Konvention seinen Anforderungen genügt — bis dahin ist das eine
dokumentierte Wahl, kein Vertrag.

---

## 2026-08-30 · AP2 · `zellKanteZuQuader()` wird NICHT in AP2 gebaut

**Widerspruch:** `ARCHITECTURE.md` §1.2 listet `zellKanteZuQuader()` in der
Dateizeile von `cells.ts`; §3.8 beschreibt dieselbe Funktion aber explizit als
Teil des **Bauer-Vertrags** ("Sichtgeometrie und Kollision rufen dieselbe
Funktion") — also als Sache von `builder.ts` (AP3). Der AP2-Arbeitsauftrag
selbst nennt nur `zellenAufbauen`, `wandZwischen`, `stempelSetzen`/
`-Entfernen` und die Kantenableitung.

**Entscheidung:** `zellKanteZuQuader()` bleibt für AP3 offen. AP2 liefert
stattdessen `zelleOderLeer()`, `nachbarBegehbar()` und
`EBENE_IN_HOEHEN_SCHRITTEN` als die Bausteine, die eine spätere
Kantenfunktion sowieso braucht.

**Grund:** Konservativ entscheiden heißt hier: keine Geometriefunktion mit
Metern und Vierteldrehungen bauen, deren tatsächliche Anforderungen erst der
Paritätstest aus AP3 (Wand liegt auf Kollision, beide Richtungen) festlegt.
Eine in AP2 geratene Fassung würde in AP3 vermutlich verworfen, nicht verfeinert.

---

## 2026-08-30 · AP2 · Was `stempelSetzen()` an Zellfeldern befüllt

**Lücke:** `RaumStempel` trägt keinen `materialTag`, keine Wand-/
Durchgangsmuster und keine `ZellenArt` außer implizit "begehbarer Raum". Diese
Felder gehören zu `Zelle`, nicht zu `RaumStempel` — die Themen-/Materiallogik
lebt aber erst in `themen.ts`/`generator.ts` (AP4).

**Entscheidung:** `stempelSetzen()` erzeugt für jede Fußabdruckzelle
`art = Boden`, `boden = stempel.bodenVersatz`, `decke = stempel.hoehe`,
`materialTag = 2` (Boden-Platten, Platzhalter), `wandErzwungen =
durchgangErzwungen = 0`, `oberflaeche = 0`. `generator.ts`/`themen.ts` (AP4)
überschreiben `materialTag`/`oberflaeche` über eigene Logik oder Korrekturen;
Treppen/Sonderarten entstehen ebenfalls über `ZellenKorrektur` (siehe
Treppentest in `dungeon2-invarianten.ts`).

**Grund:** Ein fester, dokumentierter Platzhalter ist ehrlicher als eine
geratene Materiallogik, die AP4 ohnehin ersetzt. Die Wandableitung bleibt
unberührt, weil sie nur von `art`/`boden`/`wandErzwungen`/`durchgangErzwungen`
abhängt — alles Felder, die hier explizit und neutral gesetzt werden.

---

## 2026-08-30 · AP2 · `stempelEntfernen()` arbeitet auf dem Gitter, nicht auf dem Dokument

**Lücke:** `data-model.md` §1.4 nennt `stempelSetzen`/`stempelEntfernen` als
Teil der „Bau-Logik in `shared/`", ohne zu sagen, ob sie auf dem
`DungeonLayout2`-Dokument oder auf dem bereits ausgerollten `ZellenGitter`
operieren.

**Entscheidung:** Beide Funktionen operieren auf `ZellenGitter` (reine
Funktionen, Gitter rein → Gitter raus). `stempelEntfernen()` löscht alle
Zellen, deren AKTUELLER `stempelId` passt, und gibt sie auf Fels zurück. Ein
darunterliegender, zuvor überschriebener Stempel kommt dadurch NICHT zurück —
dafür muss der Aufrufer den Stempel aus `layout.stempel` streichen und
`zellenAufbauen()` neu laufen lassen.

**Grund:** `zellenAufbauen()` aus dem Dokument ist die einzige vollständig
korrekte Quelle der Wahrheit (Stempel sind Autorenschicht, Zellen sind
Wahrheit, W1). Eine Gitter-Operation ist die billige Editor-Vorschau für den
Regelfall „letzten Raum wieder wegnehmen" — sie als Vollrückbau misszuverstehen
wäre die gefährlichere Annahme.

---

## 2026-08-30 · AP2 · Vertikale Erreichbarkeit läuft über `Schacht`-Zellen

**Lücke:** `ZellenArt.Schacht` ist als "offen nach oben/unten" dokumentiert
(`layout.ts`-Kommentar zum Enum), aber keine der fünf Quellanalysen sagt, WIE
die Erreichbarkeitsprüfung (§3.7, "Flutfüllung über offene Kanten") zwischen
zwei `ebene`-Werten wechselt — `Kante` ist nur eine horizontale Bitmaske.

**Entscheidung:** `erreichbareZellen()` (`cells.ts`) behandelt `Schacht`-Zellen
als zusätzliche vertikale Verbindung zu `(x,z,ebene±1)`, wenn die
Nachbarzelle begehbar ist — ohne Wandprüfung (Wände sind ein horizontales
Konzept). Alle anderen Zellenarten verbinden nur horizontal über
`nachbarZelle`/`wandZwischen`.

**Grund:** Das ist die einzige Lesart, die den Namen und den Kommentar der
Zellenart ernst nimmt, ohne ein neues Datenfeld zu erfinden. Ein Stockwerk-
wechsel ohne jede Schachtzelle wäre unsichtbar kaputt — die Flutfüllung würde
ihn ohnehin als unerreichbar melden, was korrekt ist, solange Treppen künftig
(`generator.ts`, AP4) ebenfalls über eine Schachtzelle an die nächste Ebene
anschließen oder ganz innerhalb einer Ebene bleiben.

---

## 2026-08-30 · AP2 · `rueckgrat` prüft die notwendige, nicht die hinreichende Bedingung

**Lücke:** §3.7 letzte Zeile verlangt „ein garantiertes Rückgrat vom Eingang
zum tiefsten Pflichtraum, das kein Stempel überschreiben darf". Das
eingefrorene Format kennzeichnet aber keinen „Pflichtraum" — es gibt nur
`RaumStempel.tiefeImBaum`, eine Zahl ohne definierte Bedeutung „das ist die
Zielkammer".

**Entscheidung:** `validateZellgitter()` prüft: der Stempel mit der größten
`tiefeImBaum` (Tiebreak: kleinste `id`) hat mindestens eine Zelle, die vom
Eingang aus erreichbar ist. Die stärkere Zusage — dass KEIN künftiger Stempel
dieses Rückgrat kappen darf — ist eine Erzeugungsregel für `generator.ts`
(AP4), keine statische Eigenschaft eines fertigen Layouts.

**Grund:** Das ist die einzige Teilprüfung, die mit den heute eingefrorenen
Feldern überhaupt entscheidbar ist. Sie überschneidet sich in der Praxis oft
mit `erreichbar` (ein unerreichbarer tiefster Raum ist auch eine unerreichbare
Zelle), meldet aber unter ihrem EIGENEN Regelnamen — das reicht, damit AP4
später eine schärfere, generatorseitige Zusage daraufsetzen kann, ohne den
Regelnamen zu verschieben.

---

## 2026-08-30 · AP2 · `mische`/`hashPos`: Seed zuerst avalanchen

**Risiko (beim Testen entdeckt, kein Beschluss verletzt):** Eine erste Fassung
von `mische(seed, salt) = avalanche32((seed ^ salt) >>> 0)` liefert für
**jedes** `seed === salt` (als Bitmuster, auch `seed = salt = -1`) exakt `0` —
`avalanche32(0) === 0` ist ein bekannter Fixpunkt des Murmur3-Finalizers.
Zwei nach Zufall gleich benannte Ströme (z. B. ein Stempel mit `id` gleich dem
`architektur`-Seed) wären damit ununterscheidbar von einem zweiten, ebenso
degenerierten Fall.

**Entscheidung:** `mische()`/`hashPos()` avalanchen den Seed zuerst für sich
(`avalanche32(seed >>> 0)`) und verrühren erst DANACH mit Salz bzw.
Koordinaten. `mische(0, 0)` (und `hashPos(0,0,0,0)`) bleiben `0` — der einzige
verbleibende Fixpunkt ist der vollständig degenerierte Fall „alles Null", der
in der Praxis nicht als echter Seed vorkommt.

**Grund:** Determinismus verlangt keine kryptographische Bijektivität, aber
zwei erkennbar verschiedene Eingaben sollten nicht auf denselben Strom-Seed
fallen, nur weil sie zufällig bitgleich sind. Die eingefrorene Wertetabelle in
`shared/test/dungeon2-hashing.ts` ist gegen die KORRIGIERTE Fassung
eingefroren.
