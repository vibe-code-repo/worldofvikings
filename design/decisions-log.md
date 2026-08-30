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

---

## 2026-08-30 · AP4 · Paketnummer: Auftrag „AP3" = ARCHITECTURE-„AP4"

**Widerspruch:** Der Arbeitsauftrag überschreibt dieses Paket mit „AP3 — der
Auto-Generator (`shared/src/dungeon2/generator.ts`)". In `ARCHITECTURE.md` §4 ist
AP3 der **Geometrie-Bauer** (`builder.ts`) und AP4 sind `generator.ts` +
`themen.ts`.

**Entscheidung:** Gebaut wurde der **Inhalt** des Auftrags — `generator.ts` und
`themen.ts` — und geprüft wurde gegen die **AP4-Prüfkriterien** aus
`ARCHITECTURE.md` (200 Seeds, Zellenzahl, Schleifen, Erreichbarkeit,
Reihenfolge-Stabilität), ergänzt um den Determinismus über 100 Seeds aus dem
Auftrag.

**Grund:** Der Auftrag benennt Datei, Phasen und Prüfkriterien eindeutig; die
Nummer ist die einzige Abweichung. `builder.ts` (das ARCHITECTURE-AP3) bleibt
unberührt und offen.

---

## 2026-08-30 · AP4 · Der Auto-Generator dreht keine Stempel (`drehung: 0`)

**Lücke:** `RaumStempel.drehung` ist eingefroren, aber `ARCHITECTURE.md` sagt
nirgends, wer Drehungen erzeugt. AP2 hat eine Drehformel geschrieben und
ausdrücklich angemerkt, dass AP4 sie gegenprüfen soll.

**Entscheidung:** Der Auto-Generator setzt **immer `drehung: 0`**. Die
Ausrichtung eines Raums an der Anschlussachse geschieht durch **Tausch von
`breite` und `tiefe`** (ein Gang nach Osten ist entlang x lang).

**Grund:** Ein um 90° gedrehtes Rechteck *ist* dasselbe Rechteck mit
vertauschter Breite und Tiefe. Die Drehformel wäre damit halb benutzt —
belastbar für die vier achsparallelen Fälle, ungeprüft für alles andere. Halb
benutzt ist die schlechteste Lage: Sie sieht nach Deckung aus, ohne welche zu
sein. Die Formel bleibt für den Editor (Handarbeit) erhalten, im Auto-Generator
unbenutzt. **Folge für AP2s offenen Punkt:** Die Drehformel ist von AP4 *nicht*
gegengeprüft — sie ist umgangen. Der erste echte Prüfer wird der Editor (AP15).

---

## 2026-08-30 · AP4 · `materialTag` kommt aus dem Raumtyp, über eine Rückrufoption

**Lücke:** `cells.ts` (AP2) setzt beim Stempeln einen festen Platzhalter
(`materialTag = 2`) und vermerkt als offenen Punkt, dass AP4 ihn über `themen.ts`
ersetzen muss. Das Dokument nennt sein Thema aber nur als **Text**; ein
Themen-Nachschlag im Zellkern wäre eine Registry im reinen Modul und würde die
`"sideEffects": false`-Zusage von `shared/package.json` untergraben.

**Entscheidung:** `cells.ts` bekommt einen **optionalen, additiven** Parameter
`AufbauOptionen { materialTagFuerStempel?(s): number }`, den
`stempelSetzen`/`zellenAufbauen`/`validateLayoutVoll` durchreichen. Ohne Option
bleibt der Platzhalter — das Verhalten von AP2, unverändert, AP2s Tests bleiben
grün. Der Materialtag selbst hängt **nur am Raumtyp** (`RaumTypProfil.materialTag`),
nicht an einer Ziehung.

**Grund:** Der Aufrufer kennt das Thema, der Zellkern nicht. Eine reine Funktion
hereinzureichen ist billiger als eine Themen-Tabelle in `cells.ts` und hält die
Schichtgrenze. Dass der Tag nicht gezogen wird, ist die Voraussetzung dafür, dass
ein neuer `seeds.material` den Grundriss nicht verschiebt (W2).

---

## 2026-08-30 · AP4 · `variante` wird gehasht, nicht gezogen; `VARIANTEN` ist eine Modulkonstante

**Lücke:** `RaumStempel.variante` heißt „Themenvariante (Materialsatz-Index)",
aber weder `ARCHITECTURE.md` noch `data-model.md` §2.2 nennen einen Wertebereich
oder eine Quelle.

**Entscheidung:** `variante = hashPos(x, z, ebene, seeds.material) % VARIANTEN`,
mit `VARIANTEN = 4` als Konstante in `themen.ts` — **keine** neue Feld im
eingefrorenen `ThemenProfil`.

**Grund:** W2 sagt zu, dass der Material-Seed jederzeit neu gewürfelt werden
darf. Eine Ziehung aus dem Architekturstrom würde den Grundriss an den
Material-Seed binden; ein Hash über die Position tut das nicht (W8, derselbe
Grundsatz wie beim Bauer). Der Test misst genau das: anderer Material-Seed →
gleiche Fußabdrücke, andere Varianten.

---

## 2026-08-30 · AP4 · Ebenenwechsel läuft über `Schacht`, nicht über `Treppe`

**Widerspruch:** `data-model.md` §2.3 P4 sagt „Treppenstempel spannen zwei
Ebenen". AP2 hat die Erreichbarkeit aber so gebaut, dass die Flutfüllung
**ausschließlich über `ZellenArt.Schacht`** senkrecht läuft (AP2-Entscheidung 5,
aus dem Enum-Kommentar „offen nach oben/unten"), und `treppe-anschluss` prüft
Nachbarn **derselben** Ebene.

**Entscheidung:** Ein `treppe`-Stempel erzeugt **zwei** 1×1-Stempel an derselben
(x,z) auf `ebene` und `ebene+1`, deren Zellen per Korrektur zu `Schacht` werden.
Die Belegungsprüfung läuft über beide Ebenen (genau die Zusage von P4). Der
Raumtyp heißt weiter `treppe` — er ist der Durchstieg, wie die Stufen darin
aussehen, entscheidet der Bauer.

**Grund:** Die Alternative wäre gewesen, AP2s Erreichbarkeit zu ändern. Das ist
teurer und riskanter als ein Stempelpaar: `art: Treppe` bedeutet in AP2 eine
Rampe **innerhalb** einer Ebene, und diese Bedeutung ist bereits durch acht
Invarianten und deren Negativfälle abgestützt.

---

## 2026-08-30 · AP4 · Zielgröße wird einmal gezogen; `zielZellen[1]` bleibt harte Grenze

**Lücke:** „Zellenzahl liegt in `zielZellen`" sagt nicht, ob man bei der
Untergrenze aufhört oder eine Größe zieht.

**Entscheidung:** **Eine** Ziehung `zielMenge = rangeInt(min, max+1)` in P0; die
Wachstumsschleife läuft, bis `zielMenge` erreicht ist, und jede Platzierung, die
`zielZellen[1]` überschreiten würde, wird abgelehnt.

**Grund:** Ohne die Ziehung war gemessen jedes Grab 220–227 Zellen groß — die
obere Hälfte des Bereichs wäre Zierde gewesen. Die harte Obergrenze bleibt
daneben stehen, weil der letzte gesetzte Saal die Zielmenge sonst überschießen
könnte.

---

## 2026-08-30 · AP4 · P2b: deterministische Auffüllung statt Neuwürfeln

**Lücke:** `ARCHITECTURE.md` AP4 verlangt „Validierung mit **deterministischem
Rückfall** auf eine einfache Form (nie neu würfeln)", sagt aber nichts über den
Fall, dass das gewichtete Wachstum die Zielmenge gar nicht erreicht (jeder freie
Platz ist zu klein für die gezogenen Typen).

**Entscheidung:** Eine **ziehungsfreie** Phase P2b setzt auf die kanonisch erste
freie Nachbarzelle einen 1×1-`abschluss`, bis die Zielmenge steht. Die Zahl der
Auffüllungen steht im `Erzeugungsbericht` und wird vom Test ausgegeben
(gemessen: **0 über 200 Seeds** — das Netz hängt, es trägt heute nichts).

**Grund:** Ein Netz, das nie zieht und nie würfelt, kostet nichts und macht das
Kriterium „Zellenzahl in `zielZellen`" zu einer Zusage statt zu einer Hoffnung.

---

## 2026-08-30 · AP4 · Anker-Id aus der Layout-Position, nicht aus der Ziehreihenfolge

**Lücke:** `DekoAnker.id` ist eingefroren, aber niemand sagt, woher sie kommt.

**Entscheidung:**
`id = (((ebene' · 4096 + z') · 4096 + x') · 4 + ort) · |ROLLEN| + rollenIndex`,
mit grenzenrelativen Koordinaten (`x' = x − grenzen.minX` usw.). Liegt eine
Position außerhalb der Spannweiten oder ist die Id schon vergeben, entsteht
**kein** Anker.

**Grund:** `ARCHITECTURE.md` AP13: „Objekt-IDs kommen aus der Layout-Position
(Zellindex + Rolle), nie aus der Ziehreihenfolge — sonst wandert der ZDO-Zustand
einer geöffneten Truhe auf eine andere." Die Folge ist, dass `ROLLEN` in
`themen.ts` **nur angehängt, nie umsortiert** werden darf; das steht dort als
Kommentar an der Liste.

---

## 2026-08-30 · AP4 · Ein Architekturstrom für P0–P8, verschlossene Türen nur an der Schatzkammer

**Entscheidung 1:** P0–P8 teilen sich **einen** `XorShiftRandom`, wie W7 es
wörtlich sagt — P5 (Schleifen) und P8 (Türen) bekommen **keine** eigenen Ströme.

**Grund:** W7 erlaubt eigene Ströme ausdrücklich nur für *neue* Merkmale.
Schleifen und Türen sind in der eingefrorenen Phasenliste enthalten, also keine
neuen Merkmale. Der Buchstabe ist hier konservativer als die Bequemlichkeit.

**Entscheidung 2:** `zustand: 'verschlossen'` entsteht **nur** an einer Kante,
an der eine `schatzkammer` liegt, immer mit `schluessel: '<thema>-schatzkammer'`.

**Grund:** `validateLayout` lehnt eine verschlossene Tür ohne Schlüssel ab
(`tuer-feld`). Ein zufällig verteilter Schlüsselbedarf ohne Schlüsselquelle wäre
ein Spielproblem, das der Generator nicht lösen kann; die Schatzkammer ist der
eine Ort, an dem ein Schloss etwas erzählt.

---

## 2026-08-30 · AP4 · `bodenVersatz` ist immer 0

**Entscheidung:** Alle erzeugten Stempel stehen auf der Ebenensohle.

**Grund:** Die abgeleitete Wandregel (§3.3) setzt eine Wand, sobald
`|boden_A − boden_B| > 1`. Ein gezogener Bodenversatz würde also Verbindungen
still zumauern, die der Generator gerade geöffnet hat — und der Fehler hätte
kein Symptom außer „dieser Raum ist manchmal nicht erreichbar". Höhenspiel
gehört in eine spätere Phase mit einer eigenen Zusage, nicht als Nebenwirkung
einer Ziehung in P2.

---

## 2026-08-30 · AP4 · `zusatzZiehungInP9` ist ein Messhaken in der Schnittstelle

**Entscheidung:** `Erzeugungsvorgaben` trägt ein Feld, das in P9 je Stempel
**eine** zusätzliche Ziehung in den Deko-Strom schiebt — ausschließlich, damit
`shared/test/dungeon2-generator.ts` das Abnahmekriterium (e) messen kann.

**Grund:** Die Alternative wäre ein Test, der den Generator nachbaut. Ein Test,
der den Prüfling nachbaut, misst den Nachbau. Der Haken kostet ein `boolean` und
ist in beiden Sprachen als reines Messwerkzeug beschriftet; die Gegenprobe im
Test (die **Anker müssen** sich ändern) sorgt dafür, dass er nicht versehentlich
wirkungslos wird.

---

## 2026-08-30 · AP-Bauer · Paketnummer: „AP4" im Auftrag, „AP3" in ARCHITECTURE

**Widerspruch:** Der Arbeitsauftrag nennt dieses Paket „AP4 — der Geometrie-Bauer";
`ARCHITECTURE.md` §4 führt `builder.ts` als **AP3** und `generator.ts`+`themen.ts`
als AP4 (die das Vorgängerpaket bereits gebaut hat, dort ebenfalls unter einer
verschobenen Nummer).

**Entscheidung:** Gebaut wurde der **Inhalt** des Auftrags (`builder.ts`), geprüft
gegen die **Kriterien von ARCHITECTURE-AP3** plus die drei im Auftrag zusätzlich
genannten (blockweise Gleichheit über Seeds, geschlossene Volumina als
Kanten-Manifold-Zahlentest, Kollision aus demselben Layout).

**Grund:** Der Inhalt ist eindeutig, die Nummer nicht. Wer nach der Nummer statt
nach dem Inhalt baut, baut das falsche Modul.

---

## 2026-08-30 · AP-Bauer · `BauStueck` bleibt Quader; Netzdaten sind eine ABGELEITETE Schicht

**Widerspruch:** `ARCHITECTURE.md` §3.8 friert `BauStueck` als **Quader** ein
(`mitte`, `groesse`, `drehung`, `blend`). Der Arbeitsauftrag verlangt vom Bauer
„Positionen/Indizes/Normalen/Materiallayer/Blend-Attribute".

**Entscheidung:** Der eingefrorene Quadervertrag bleibt unangetastet. Daneben
steht `stueckZuNetz(stueck)` → `Netz { positionen, normalen, uv2, indizes }` als
**reine, ableitende** Funktion.

**Grund:** Das Eingefrorene zu ändern wäre laut §3 eine Versionserhöhung, kein
Edit — und der Client-Adapter (AP6) merged ohnehin je (Block × materialTag), er
braucht also Netzdaten, nicht ein anderes `BauStueck`. Die Ableitung erfüllt die
Forderung des Auftrags vollständig und macht zusätzlich die
Kanten-Manifold-Prüfung überhaupt erst möglich (ohne Dreiecke gibt es keine
Kanten zu zählen). 24 Eckpunkte je Quader (vier je Fläche), damit die Normalen
flach bleiben; `drehung` wird beim Vernetzen **nicht** angewandt, weil die Quader
achsparallel sind und `groesse` bereits in Weltachsen steht — sie ist reine
Ausrichtungsangabe für den Adapter.

---

## 2026-08-30 · AP-Bauer · Alles in ganzen Achteln und Höhenstufen, genau eine Multiplikation

**Lücke:** ARCHITECTURE Vertragsregel 3 sagt „Meter durch Multiplikation, nie
durch Addition", legt aber keine Rechenform fest.

**Entscheidung:** Jede waagerechte Länge wird in **ganzen Zellachteln**
(`ACHTEL_M = ZELLE_M/8 = 0,5`), jede senkrechte in **ganzen Höhenstufen**
(`HOEHEN_SCHRITT_M = 0,5`) gerechnet; `quaderInMeter()` ist der **einzige** Ort,
an dem daraus Meter werden — Mitte über `(a0+a1) * 0,25`, Größe über
`(a1-a0) * 0,5`.

**Grund:** Beide Konstanten sind binär exakt. Damit ist jede Zellgrenze von
beiden Seiten bitgleich, der Haarriss ist bauartbedingt unmöglich statt nur
klein, und auch die aus `mitte ± groesse/2` zurückgerechneten Ecken sind exakt.
Der Test misst die stärkere Zusage: größte Lücke **0**, nicht < 1e-6.

---

## 2026-08-30 · AP-Bauer · Eigentümer einer Kante ist der Block ihrer KANONISCHEN Zelle

**Lücke:** ARCHITECTURE W3 legt den Block als Chunk fest, sagt aber nicht, zu
welchem Block eine Wand **zwischen** zwei Blöcken gehört.

**Entscheidung:** Zellteile (Boden, Decke, Stufen, Simse) gehören dem Block ihrer
Zelle; Kantenteile (Wand, Sturz, Türrahmen) gehören dem Block der **kanonischen**
Zelle der Kante (`kanonisiereKante`, also der mit kleinerem (ebene,z,x)).
`bloeckeDesGitters()` nimmt deshalb ausdrücklich **auch** die Blöcke der
kanonisierten Kanten auf, nicht nur die der Zellen.

**Grund:** Ohne eine solche Regel käme eine Wand an einer Blockgrenze entweder
doppelt oder gar nicht — beides bricht die blockweise Gleichheit. Die kanonische
Zelle ist bereits die Konvention des Formats (Türen, §3.4), eine zweite wäre eine
zweite. Der Nebenpunkt ist teuer erkauft: die kanonische Zelle darf **Fels** sein
und außerhalb jedes bewohnten Blocks liegen (die Südkante von `z = -8`
kanonisiert auf `z = -9`, also einen Blockstreifen tiefer). Wer diese Blöcke aus
der Blockliste vergisst, verliert genau die Außenwände am unteren/linken
Blockrand — und zwar still, weil nur die Vereinigung sie verliert, der Vollbau
aber nicht. Genau das ist beim Bauen passiert und hat den Test rot gemacht.

---

## 2026-08-30 · AP-Bauer · Schächte: keine Bodenplatte, keine Decke darunter — und die Wandsäule wächst hoch

**Lücke:** `ZellenArt.Schacht` heißt „offen nach oben/unten"; der Vorgänger (AP4)
gibt als offenen Punkt weiter, der Bauer müsse dort „Stufen erzeugen, sonst ist
es ein Loch". ARCHITECTURE sagt dazu nichts.

**Entscheidung:** Eine `Schacht`-Zelle über einer begehbaren Zelle bekommt
**keine Bodenplatte**, die Zelle darunter **keine Deckenplatte** — und
`obenStufen()` zieht die lichte Säule der unteren Zelle bis auf die **Bodenhöhe
des Schachts** hinauf, damit die Wände beider Zellen lückenlos aneinander
stoßen. **Stufen erfindet der Bauer nicht.**

**Grund:** Der Bauer darf keine Entscheidung treffen, die dem Generator gehört.
Ob ein Ebenenwechsel eine Wendeltreppe, eine Leiter (ein Deko-Anker) oder eine
`Treppe`-Zellenkette ist, ist Spielgefühl und gehört vor Mikes Blick — eine
erfundene 8-m-Stiege in einer 4-m-Zelle wäre ein 63°-Steilstück und würde
verworfen, nicht verfeinert. Was der Bauer sehr wohl schuldet, ist die
**Dichtheit**: ohne die hochgezogene Säule bliebe zwischen der weggelassenen
Decke unten und dem Schachtboden oben ein Ring ohne Wand. Der Handfall im Test
misst genau das (Sabotage-Probe: Säule nicht hochziehen → 92 Lecks).

---

## 2026-08-30 · AP-Bauer · Der Sturz: offene Kanten mit verschiedenen Deckenhöhen werden oben geschlossen

**Lücke:** Nirgends steht, was an einer offenen Kante zwischen zwei Räumen
UNGLEICHER Deckenhöhe geschieht.

**Entscheidung:** Der Bauer setzt dort einen **Sturz** — einen `wand`-Quader über
der Kantenbreite, senkrecht von der niedrigeren bis zur höheren Deckenoberkante.
An einer Tür übernimmt der Türsturz dieselbe Aufgabe (er reicht von der lichten
Türhöhe bis zur höheren Deckenoberkante).

**Grund:** Ohne ihn sieht man vom höheren Raum aus über die Decke des niedrigeren
hinweg in den Fels. Das ist der klassische Leak, er hat kein Symptom in einer
Invariantenprüfung des Layouts, und er ist genau die Klasse, die WoCs
Paritätstest gefunden hat. Die Sabotage-Probe (Sturz weglassen) macht die
Hüllenprüfung rot.

---

## 2026-08-30 · AP-Bauer · Wandmaterial: Zelltag für Waagerechtes, Tag 0 für Senkrechtes — außer im Fels

**Lücke:** `Zelle.materialTag` ist laut `themen.ts` das **Zell**material (der
Boden des Raumtyps); die W5-Tabelle führt Tag 0 als „Wand-Quader" und Tag 1 als
„Fels roh". Welcher Tag an eine Wand gehört, steht nirgends.

**Entscheidung:** `boden` und `stufe` nehmen `zelle.materialTag`; `wand`,
`decke`, `sims` und `tuerrahmen` nehmen Tag **0** — außer die Zelle trägt Tag 1
(Fels roh), dann nehmen sie ebenfalls 1.

**Grund:** Ein aus dem Fels geschlagener Raum hat Felswände, ein verlegter Boden
hat trotzdem Quaderwände. Jede feinere Regel wäre eine Materialentscheidung, und
die gehört ins Themenprofil, nicht in den Bauer — sie kann dort später als Feld
nachgereicht werden, ohne den eingefrorenen Vertrag zu berühren.

---

## 2026-08-30 · AP-Bauer · `kantenAbstand` ist der Abstand zu Boden, Decke und Wandebenen der eigenen Zelle

**Lücke:** ARCHITECTURE W4 verlangt `kantenAbstand` als „Meter zur nächsten
konkaven Kante", definiert „konkave Kante" aber nicht rechnerisch.

**Entscheidung:** Je Quaderecke das Minimum aus (a) Abstand zur
Bodenoberkante der Eigentümerzelle, (b) Abstand zu ihrer Deckenunterkante,
(c) Abstand zu jeder Zellgrenze der Eigentümerzelle, an der eine Wand steht —
gedeckelt bei **2 m**.

**Grund:** Die konkaven Kanten eines Quaderdungeons sind genau die Linien, an
denen eine Wand auf Boden oder Decke trifft; (a)–(c) sind die Ebenen, deren
Schnitt diese Linien sind, und das Minimum der Ebenenabstände ist die
konservative (nie zu große) Schätzung des Kantenabstands. Der Deckel bei 2 m ist
kein Sparzwang, sondern Präzision: weiter weg ist „mittendrin", und ein
unbegrenzter Wert verschenkt in `uv2` nur Auflösung.

---

## 2026-08-30 · AP-Bauer · Simse sind die einzige Variation — und sie sind rein optisch

**Lücke:** Vertragsregel 2 („der Bauer hasht") und Regel 5 („der Bauer kennt
keine Grafikstufe, `art` entscheidet") verlangen beide etwas, das es im Modell
noch nicht gab: eine gehashte Variation und ein Bauteil, das auf Niedrig
entfallen darf.

**Entscheidung:** An rund einem Viertel der Wandkanten (Schwelle auf
`hashPos(x, z, ebene, mische(seeds.material, kante))`) sitzt ein `sims` — ein
Simsband auf 3 m Höhe, 0,5 m auskragend. Es bekommt **keinen**
Kollisionskörper.

**Grund:** Ohne ein einziges gehashtes Merkmal wäre Regel 2 unbelegt und die
blockweise Gleichheit triviale Buchhaltung statt einer Messung. Und die Kollision
darf nicht an der Grafikstufe hängen: ein Sims, den man auf Niedrig nicht sieht,
darf einen auf Niedrig auch nicht aufhalten. Der Paritätstest nimmt Simse
deshalb ausdrücklich aus — und prüft im selben Atemzug, dass es überhaupt welche
gibt, denn eine Ausnahme, die nie greift, ist eine Zeile Prosa.

---

## 2026-08-30 · AP-Bauer · Treppen: gestufte Optik, glatte Rampe als Kollision

**Lücke:** `ZellenArt.Treppe` und `Zelle.neigung` stehen im eingefrorenen Format,
der heutige Generator erzeugt sie nicht, und `KollisionsKoerper.form: 'rampe'`
hat bisher keinen Erzeuger.

**Entscheidung:** Eine `Treppe`-Zelle liefert **acht** `stufe`-Quader entlang der
Neigungsachse (ohne eigene Kollision) und **einen** Rampenkörper mit
`steigung` = gemessener Anstieg in Höhenstufen. Der Anstieg wird an der
Nachbarzelle in Neigungsrichtung gemessen, nicht angenommen.

**Grund:** Genau Vertragsregel 1 — ein späterer Kunstpass darf die Treppe feiner
stufen, ohne das Laufgefühl zu ändern. Gemessen, nicht angenommen, weil
`Zelle.boden` laut Format die Höhe an der Kante mit dem kleineren Index ist und
das Ziel damit ausschließlich in der Nachbarzelle steht. Ein Handfall im Test
deckt den Pfad ab, den der Auto-Generator heute nie betritt.

---

## 2026-08-30 · AP-Bauer · `zellKanteZuQuader` ist symmetrisch in Mitte und Größe, gegenläufig in `drehung`

**Lücke:** ARCHITECTURE §3.8 verlangt „eine geteilte Kantenfunktion, nicht zwei
gleiche" und nennt Mitte, Größe **und** Vierteldrehung als Ergebnis — sagt aber
nicht, ob die Drehung von beiden Seiten dieselbe ist.

**Entscheidung:** Mitte und Größe sind von beiden Seiten **bitgleich** (der
Streifen liegt mittig auf der Zellgrenze, die senkrechte Ausdehnung ist die
Vereinigung beider Wandsäulen). `drehung` ist **absichtlich gegenläufig**: sie
sagt, welche Seite in den Raum blickt, und das ist von Norden aus etwas anderes
als von Süden. Der Test prüft beides getrennt.

**Grund:** Hätte man `drehung` mitsymmetrisiert, wäre die Angabe wertlos; hätte
man sie stillschweigend mitverglichen, wäre der Symmetrietest falsch rot (genau
das ist beim Bauen passiert). Die Wandquader des Bauers entstehen ohnehin immer
aus der **kanonischen** Kante, sind also eindeutig.

---

## 2026-08-30 · AP-Bauer · Spawnpunkt und Prüfsumme bei Teilbauten

**Lücke:** `BauErgebnis` trägt `spawnPunkt`, `huelle` und `pruefsumme`; was diese
drei bei `baueGeometrie(l, {bloecke:[b]})` bedeuten, steht nicht da.

**Entscheidung:** `spawnPunkt` wird **immer** aus dem vollen Gitter gerechnet und
ist von der Blockauswahl unabhängig (der Test misst das). `huelle` und
`pruefsumme` beziehen sich dagegen ausdrücklich nur auf das **Gebaute** — die
Prüfsumme eines Teilbaus ist die Prüfsumme dieses Teils.

**Grund:** Der Spawnpunkt ist eine Eigenschaft des Grabes, nicht des Chunks; ein
Teilbau, der den Spieler woandershin setzt, wäre ein Fehler mit dem Symptom
„manchmal steht man falsch". Huelle und Prüfsumme dagegen sind Eigenschaften der
Ausgabe; eine „Prüfsumme des Ganzen" an einem Teil wäre eine Lüge über etwas,
das gar nicht gebaut wurde.
