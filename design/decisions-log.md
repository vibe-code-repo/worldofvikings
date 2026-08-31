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

---

## 2026-08-30 · AP5 · `dungeon2-schichten.ts` wird in AP5 nachgeholt, nicht in AP0

**Lücke:** `design/ARCHITECTURE.md` weist den Schichtentest (§4, AP0, Umfang 2)
ausdrücklich AP0 zu. AP0 ist laut allen vier bisherigen Arbeitsberichten
(AP1–AP4) nie gelaufen — es gibt weder `LEGACY.md` noch die Trennung von
`dungeonGenerator.ts`. Der AP5-Arbeitsauftrag verlangt aber wörtlich
„Schichtentest NEGATIV geprüft" als Teil der Beweis-Suite.

**Entscheidung:** `shared/test/dungeon2-schichten.ts` wird hier gebaut, mit dem
vollen Umfang aus ARCHITECTURE §4/AP0 (alle sieben verbotenen Muster,
negativ geprüft). Die Datei ersetzt AP0s Umfang 2 vollständig; die übrigen
AP0-Aufgaben (Datei teilen, `LEGACY.md`) bleiben offen und sind nicht Teil von
AP5.

**Grund:** Der Arbeitsauftrag ist eindeutiger als die Abhängigkeitsreihenfolge
im Dokument, und der Test ist ohnehin unabhängig von AP0s anderen zwei
Aufgaben (Datei-Trennung, `LEGACY.md`) — er braucht nur die bereits
existierenden `shared/src/dungeon2/*.ts`-Dateien. Ihn zurückzuhalten, bis AP0
nachgeholt wird, hätte die Beweis-Suite unvollständig gelassen, ohne dass
irgendetwas an AP0 dadurch schneller fertig würde.

---

## 2026-08-30 · AP5 · Zwei getrennte Scan-Durchläufe statt eines gemeinsamen

**Lücke:** ARCHITECTURE nennt die verbotenen Muster als eine Liste, sagt aber
nichts darüber, WIE gescannt wird — und die naheliegende Umsetzung (Kommentare
und Zeichenketten vor dem Scan entfernen, wie AP1 es AP0 ausdrücklich als
Warnung mitgab) widerspricht sich selbst bei Import-Pfaden: `import ... from
'@babylonjs/core'` benutzt eine Zeichenkette als Modulpfad. Wer erst alle
Zeichenketten entfernt, entfernt genau den Beweis, den er sucht.

**Entscheidung:** Import-/Require-/dynamische-Import-Spezifizierer werden mit
einer eigenen Regex auf dem ROHEN Quelltext gesucht (`from '...'`,
`require('...')`, `import('...')`). Alle übrigen Muster (`window`, `document`,
`Math.random`, `Date.now`, `performance.now`, `Math.sin`, `Math.cos`,
`insideUnitCircle`) werden erst NACH Entfernen von Kommentaren und
Zeichenketten gesucht.

**Grund:** Die Pflichtkommentare dieses Vorhabens nennen die verbotenen Muster
wörtlich (`generator.ts` Kopf: „kein `Math.random`, keine Uhr...") — ein
Scanner ohne Bereinigung färbt jede korrekt dokumentierte Datei rot. Ein
Scanner, der ALLES bereinigt, findet nie einen echten `@babylonjs`-Import,
weil der Pfad selbst eine Zeichenkette ist. Beide Fehler sind über
synthetische Positiv-/Negativ-Fixturen im Test selbst nachgewiesen (nicht nur
einmalig von Hand geprüft), plus eine Gegenprobe, dass die echten Dateien
`node:` und „Babylon" tatsächlich wörtlich in Kommentaren nennen — sonst wäre
die Bereinigung nie gefordert gewesen.

---

## 2026-08-30 · AP5 · Browser-Abgleich über `http.server` + In-Page-Vergleich, nicht `file://` + Rücktransport

**Lücke:** ARCHITECTURE nennt eine „Browser-Prüfseite" ohne Verfahren. Der
naheliegende Weg — Seite per `file://` öffnen, Ergebnistext zurück ins
Gespräch holen, dort mit den Node-Werten vergleichen — scheiterte praktisch:
`navigate` auf eine `file://`-URL blockierte wiederholt bis zum Timeout
(https-URLs funktionierten sofort), und der Ergebnistext (1000 Hash- plus 40
Bauwerte als JSON) sprengte die Ausgabegrenze des Text-Werkzeugs.

**Entscheidung:** Die Seite wird per `python3 -m http.server` aus
`shared/test/` lokal ausgeliefert (`http://127.0.0.1:8934/...`), NICHT per
`file://`. Der Vergleich gegen die Golden-Dateien läuft als `fetch()` +
Vergleichsschleife INNERHALB der Seite (per `javascript_tool`), nicht durch
Rücktransport der vollen Werte-Listen. Zurückgegeben wird nur eine
Zusammenfassung (Anzahl Werte, Anzahl Abweichungen, erste Abweichung).
Zusätzlich negativ geprüft: ein absichtlich verfälschter Golden-Wert lässt den
Vergleich genau eine Abweichung melden, bevor die Sabotage zurückgenommen
wurde (im Speicher der Seite, nicht in der Datei — die Golden-Datei blieb
unangetastet).

**Grund:** `file://` in dieser Umgebung ist unzuverlässig (vermutlich eine
Berechtigungsabfrage, die hier nie beantwortet wird); ein lokaler HTTP-Server
ist ohnehin das im Projekt etablierte Muster (`vite preview`). Ein
In-Page-Vergleich ist zudem die einzige Art, 1000 Werte zu prüfen, ohne an die
Textgrenze des Werkzeugs zu stoßen — und er prüft dieselbe Sache: JS-Werte, die
im Browser gerechnet wurden, gegen die in Node eingefrorenen.

---

## 2026-08-30 · AP5 · Seed-Umfang: 1000 für `hashPos` (billig), 40 für volle Geometrie (teuer)

**Lücke:** ARCHITECTURE AP1-Kriterium (c) nennt „1000 eingefrorene
`hashPos`-Werte", der AP5-Arbeitsauftrag sagt nur „mehrfach" für die
Ende-zu-Ende-Prüfung, ohne eine Zahl zu nennen.

**Entscheidung:** Die `hashPos`-Tabelle hat exakt 1000 Einträge (reine
Ganzzahlarithmetik, im Browser wie in Node Millisekunden). Die
Ende-zu-Ende-Prüfung (Layout **und** volle Geometrie, blockweise) läuft über
40 Seeds — dieselbe Größenordnung, die AP3/AP4 für vollständige Geometrie-Sweeps
gewählt haben (10–50 Seeds je nach Prüfung), weil ein voller Bau pro Seed
sowohl in Node als auch im Browser-Bundle Sekunden statt Millisekunden kostet.

**Grund:** Beide Zahlen sind an die Kosten der jeweiligen Operation angepasst,
nicht an eine runde Zahl. Der eigentliche Beweis (Node ≡ Browser) ist bei 40
Seeds genauso hart wie bei 1000 — ein Determinismus-Fehler zeigt sich beim
ersten abweichenden Seed, nicht erst beim tausendsten.

---

## 2026-08-30 · AP0 · LEGACY-Markierung ohne Dateiteilung; Datei-/Symbolnamen wie im Repo, nicht wie in ARCHITECTURE.md

**Lücke/Widerspruch:** Der Arbeitsauftrag zu diesem Paket verlangt exakt
„LEGACY-Markierung ... NICHTS funktional ändern, reine Kommentare/Doku".
`ARCHITECTURE.md` AP0 fasst Markierung, Dateiteilung
(`dungeonGenerator.ts` → `campGenerator.ts`) und den Schichtentest zu
einem Paket zusammen. Der Schichtentest wurde bereits in AP5 vorgezogen
(s. dortiger Eintrag oben); die Dateiteilung ist zum Zeitpunkt dieses
Pakets ebenfalls noch nicht erfolgt (`shared/src/campGenerator.ts`
existiert nicht, `generateCampLayout`/`CampGround` stehen weiterhin in
`dungeonGenerator.ts`).

**Entscheidung:** Nur die Markierung wurde gebaut. `dungeonGenerator.ts`
bekommt **keinen** Ganzdatei-Kopfkommentar, weil die Datei den noch aktiven
Camp-Teil enthält — stattdessen einen Kopfkommentar mit ausdrücklicher
Ausnahme plus gezielte LEGACY-Marken um `DungeonGeneratorSettings`,
`DEFAULT_GENERATOR_SETTINGS`, `generateDungeonLayout`,
`DungeonGenerationError` und den Editor-Helfer-Block
(`OpenConnection`/`computeOpenConnections`/`attachRoom`/`removeRoom`), und
eine "bleibt aktiv"-Gegenmarke um `CampGround`/`generateCampLayout`. Die
Dateiteilung selbst bleibt offen für einen künftigen AP0-Schritt.

Zusätzlich: Die Editor-Dateien tragen im Repo weiterhin deutsche Namen
(`DungeonGrundriss.ts`, `DungeonKatalog.ts`, `DungeonDokument.ts`,
`client/src/ui/DekoPlatzierung.ts`), während `ARCHITECTURE.md` §1.2/§5
bereits die künftigen englischen Namen (`DungeonFloorplan.ts`,
`DungeonCatalog.ts`, `DungeonDocument.ts`, `DecorPlacement.ts`) nennt. Die
Markierung sitzt an den tatsächlichen Dateien; `LEGACY.md` vermerkt die
Abweichung ausdrücklich, damit ein künftiges Umbenennen die Liste nicht
stillschweigend entwertet.

**Grund:** Eine Dateiteilung ist keine reine Kommentaränderung — sie
verschiebt Code zwischen Modulen und damit Importe, und das war
ausdrücklich nicht der Umfang dieses Pakets. Die Ganzdatei-Markierung von
`dungeonGenerator.ts` vor der Teilung wäre sachlich falsch gewesen (sie
hätte aktiven Oberweltcode als Löschkandidat gebrandmarkt) und wurde
deshalb bewusst nicht gesetzt.

---

## 2026-08-30 · AP5 · Browser-Entry dupliziert die Erzeugerfunktionen, statt sie zu importieren

**Lücke:** `dungeon2-determinismus.ts` und `dungeon2-browser-check.ts`
brauchen dieselben `seedsFuer`/`hashEingabeFuer`-Hilfsfunktionen.

**Entscheidung:** Die Browser-Seite schreibt diese zwei kleinen Funktionen
noch einmal aus, statt sie aus der Node-Testdatei zu importieren.

**Grund:** Ein gemeinsames drittes Modul für zwei Testdateien wäre eine neue,
ungeprüfte Kopplungsstelle; ein Import der Node-Testdatei in ein
Browser-Bundle würde `node:fs`/`node:path` mitziehen (die Datei liest/schreibt
Golden-Dateien) und entweder das Bundle sprengen oder den Schichtentest-Sinn
für Testcode ad absurdum führen. Die Duplikation ist absichtlich: zwei
unabhängig geschriebene Fassungen derselben Zahlenreihe sind ein stärkerer
Zeuge als eine geteilte Fassung, die auf beiden Seiten gleich falsch sein
könnte.

---

## 2026-08-30 · Bestuecker · Dateiname `decorator.ts`, nicht `bestuecker.ts`

**Lücke:** `ARCHITECTURE.md` §1.2/§1.1 nennt die Datei `bestuecker.ts`; der
Arbeitsauftrag verlangt englische Dateinamen für alles Neue.

**Entscheidung:** Die Datei heißt `shared/src/dungeon2/decorator.ts`, die
Funktion und der Typname bleiben deutsch (`bestuecke()`, `BestuecktesTeil`) wie
in `data-model.md` §2.5 eingefroren. Der Kopfkommentar nennt beide Namen
ausdrücklich, damit ein Leser, der von `ARCHITECTURE.md` kommt, die Datei
findet.

**Grund:** Nur der Dateiname ist von der Englisch-Vorgabe erfasst; Bezeichner
im eingefrorenen Datenformat/den eingefrorenen Signaturen zu übersetzen wäre
eine stille Formatänderung.

---

## 2026-08-30 · Bestuecker · Eingabe ist `dekoPlaetze` (Meter), nicht `DungeonLayout2`

**Lücke:** `data-model.md` §2.5 friert `bestuecke(layout, thema)` ein;
`ARCHITECTURE.md` §1.3 zeigt im Datenfluss dagegen `dekoPlaetze -> bestuecke ->
ZDOs`, also `BauErgebnis.dekoPlaetze` als Eingabe.

**Entscheidung:** `bestuecke(dekoPlaetze: readonly DekoPlatz[], thema:
ThemenProfil): readonly BestuecktesTeil[]` — die Datenfluss-Fassung aus
`ARCHITECTURE.md` gewinnt.

**Grund:** Nur der Bauer (`builder.ts`, `ankerPosition()`) übersetzt
Anker-Rasterkoordinaten (Achtel, Höhenstufen) in Meter. Ein zweiter,
unabhängig im Bestücker geschriebener Umrechnungspfad wäre ein Duplikat, das
mit der Zeit vom Bauer abweichen kann, ohne dass es auffiele — genau die Art
Fehler, die dieses Vorhaben an anderer Stelle (die geteilte Kantenfunktion,
§3.8) ausdrücklich vermeidet. `DekoPlatz.seed` ist bereits
`mische(seeds.deko, anker.id)` (von `generator.ts` in P9 gesetzt), also exakt
der Strom, den W7 für den Bestücker verlangt — der Bestücker muss `seeds.deko`
gar nicht kennen.

---

## 2026-08-30 · Bestuecker · Gefundene Lücke in `validation.ts`: `ebenen-abstand` vergleicht gegen die BodenOBERkante, nicht die -UNTERkante

**Fund, kein Umbau:** Der Determinismus-/Kollisionstest von
`dungeon2-decorator.ts` (Prüfung C2) stieß bei Seed 37 (Standard-Seedreihe
dieses Testpakets) auf ein bestücktes Bodenteil, dessen Position **innerhalb**
eines Kollisionskörpers der EIGENEN Ebene lag — nach Einschränkung auf die
eigene Ebene löste sich der Fall auf: Der Konflikt lag zwischen der Decke von
Ebene E und dem Boden von Ebene E+1 direkt darüber.

Ursache in `validation.ts` (`validateZellgitter`, Regel `ebenen-abstand`):
`bodenUnterkanteOben = oben.ebene * EBENE_IN_HOEHEN_SCHRITTEN + oben.boden`
verwendet die BodenOBERkante der oberen Zelle (die begehbare Fläche), nicht
ihre -UNTERkante (`... + oben.boden - BODEN_DICKE_STUFEN`, wie es der Bauer für
die tatsächliche Bodenplatte benutzt, `builder.ts`, `ys0: unten -
BODEN_DICKE_STUFEN`). Der Text der Regel in `ARCHITECTURE.md` §3.7 verlangt
wörtlich "Bodenunterkante", der Code prüft aber die Bodenoberkante — eine Lücke
von `BODEN_DICKE_STUFEN` (2 Stufen, 1 m), innerhalb derer eine Deckenplatte der
Ebene darunter bis 0,5 m in die Bodenplatte der Ebene darüber hineinragen kann,
ohne dass `validateLayoutVoll` das meldet. Beide Platten bleiben massiv
(kein sichtbares Loch), aber eine Bestückung, die exakt auf der Bodenoberkante
sitzt, kann numerisch innerhalb der fremden Deckenplatte liegen.

**Keine Änderung an `validation.ts`/`generator.ts` durch dieses Paket:** Eine
Korrektur der Formel kann für manche Seeds ein Layout, das bisher als gültig
durchging, neu als `fehler` einstufen und damit den P10-Rückfall auslösen —
das ändert erzeugte Layouts (und damit die eingefrorenen Golden-Prüfsummen aus
AP5) für Seeds, die dieses Paket nicht vermisst. Das ist eine Entscheidung für
den Eigentümer von AP2/AP4, nicht für den Bestücker. `decorator.ts` selbst ist
nicht betroffen: Der Bestücker übernimmt Positionen unverändert aus
`dekoPlaetze` und trifft keine eigene Höhenannahme.

**Testkonsequenz:** Prüfung C2 in `dungeon2-decorator.ts` vergleicht deshalb
bewusst nur gegen Kollisionskörper DERSELBEN Ebene wie das bestückte Teil
(Ebene über den begleitenden `BauStueck`-Eintrag nachgeschlagen) — ob die Decke
der Ebene darunter korrekt unter dem Boden dieser Ebene bleibt, ist die
`ebenen-abstand`-Invariante, keine Eigenschaft des Bestückers.

---

## 2026-08-30 · AP9/AP12 · Dateinamen `tools/dungeon2/make-materials.py` statt `tools/bake-barrow-materials.py`

**Lücke:** `ARCHITECTURE.md` §1.2 nennt `tools/bake-barrow-materials.py` und
`tools/pack-material-arrays.py`; der Arbeitsauftrag nennt
`tools/dungeon2/make-materials.py` und `tools/dungeon2/pack-material-arrays.py`.

**Entscheidung:** Die Namen des Arbeitsauftrags gelten. Beide Werkzeuge liegen
in `tools/dungeon2/`, die Ausgabe unter `assets/dungeon2/materials/<name>/`
(Ordnernamen englisch, Bindestrich, gleich dem `name` in `material.json`).

**Grund:** `tools/` enthält bereits über sechzig Skripte ohne Unterordner; ein
eigener Ordner je Vorhaben ist die Form, die den Dungeon-2.0-Bestand
zusammenhält. „bake" im Namen beschreibt zudem nur den halben Vorgang — das
Skript backt zwei Größen und rechnet Normale und Occlusion danach selbst.

---

## 2026-08-30 · AP9 · EMIT-Bake mit einem Sample statt DIFFUSE/NORMAL/ROUGHNESS-Bakes

**Lücke:** `material-plan.md` §4 (5) verlangt „Bake pro Kanal
(`bpy.ops.object.bake`, Typ `DIFFUSE`/`NORMAL`/`ROUGHNESS`)". Diese Bake-Typen
sind Monte-Carlo-Integrale: ihr Rauschen hängt an Sample-Zahl, Tile- und
Thread-Aufteilung. Das Determinismus-Gesetz verlangt aber byte-gleiche PNGs.

**Entscheidung:** Gebacken wird ausschließlich mit `type='EMIT'` und
`samples=1`. Gebacken werden nur ZWEI Größen: Albedo, und ein RGB-Paket aus
(Höhe, Rauheit, Overlay-Maske). **Normale und Occlusion werden danach in numpy
aus der Höhenkarte gerechnet**, im Wickel-Modus (`np.roll`), damit die Kachel
nahtlos bleibt.

**Grund:** Ein EMIT-Bake wertet den Shader an der Texelmitte aus, statt zu
integrieren — ein Sample genügt, das Ergebnis ist exakt. Ein NORMAL-Bake
bräuchte außerdem ein Hochpoly-Quellobjekt, das es hier gar nicht gibt: die
Struktur steckt im Node-Graph, nicht in der Geometrie. Die Occlusion aus einer
Mehrskalen-Kavität ist für eine flächige Optik völlig ausreichend und im
Gegensatz zu einem AO-Bake exakt reproduzierbar. Gemessen: zwei Läufe mit
gleichem Seed liefern byte-identische Dateien (`diff -r`), und ein Lauf mit
`--only metal,wall-block` (Tag 5 VOR Tag 0) liefert für beide dieselben Bytes.

---

## 2026-08-30 · AP9 · 4D-Torusabbildung für kachelnde Prozeduren

**Lücke:** `material-plan.md` verlangt „tileable" Maps und nennt als Bausteine
`Voronoi`, `Noise`, `ColorRamp` — sagt aber nicht, wie eine Blender-Prozedur
kachelt. Sie kachelt nicht: `Noise Texture` auf UV zeigt an der Kachelnaht eine
harte Kante.

**Entscheidung:** Jede Rauschquelle bekommt ihre Koordinaten aus
`torus(u, v)` = (cos 2πu, sin 2πu, cos 2πv) plus W = sin 2πv, also einen Punkt
auf einem Torus im 4D-Raum. Jede Funktion darauf ist in u UND v periodisch.
Rasterprozeduren (Quaderverband, Bretter) tilen über `WRAP` auf ganzzahlige
Spalten-/Reihenzahlen; die Zellindizes werden modulo Spalten/Reihen genommen.

**Grund:** Triplanar wiederholt jede Kachel über zehn Meter Wand — eine Naht
wäre nicht der Randfall, sondern die Regel. Sichtprüfung: alle zehn Materialien
2×2 gekachelt nebeneinander, keine Naht sichtbar.

---

## 2026-08-30 · AP9 · Das Werkzeug der Stilisierung ist die CONSTANT-ColorRamp — und ein Streckschritt davor

**Lücke:** „stilisiert-flächig, kein Fotorealismus" ist ein Bild, keine
Anweisung. `material-plan.md` nennt ColorRamp „zur Kontrastkurve".

**Entscheidung:** Jede Farbe entsteht aus einer ColorRamp mit Interpolation
`CONSTANT` und drei bis vier Stützstellen — das quantisiert jedes Rauschen in
wenige Flächen. Davor steht zwingend `spread()`, eine Map-Range von 0.33..0.67
auf 0..1.

**Grund, und das ist der Fehler, der zweimal auftrat:** Blenders `Noise
Texture`-Fac liegt fast vollständig zwischen 0.35 und 0.65. Eine Ramp mit
Stützstellen bei 0.0/0.4/0.7 sieht davon genau eine Stufe — das Ergebnis ist
eine einfarbige Fläche. Der Fehler hat kein Symptom außer „sieht langweilig
aus", und genau deshalb steht die Begründung im Quelltext an `spread()`.
(Der zweite Fehler derselben Klasse: `ramp()` verband anfangs seinen
`Fac`-Eingang nicht und wertete deshalb immer bei 0.5 aus — sichtbar erst am
Kontaktabzug, nicht an einer Ausnahme.)

---

## 2026-08-30 · AP12 · Senkrechter Streifen als Array-Dateiform; KTX2 optional statt Pflicht

**Lücke:** `ARCHITECTURE.md` AP12 verlangt „drei Layer-Stapel … → KTX2
(`toktx`)". `toktx` ist auf dieser Maschine nicht vorhanden, und Risiko R4
(`Texture2DArray` + Basis Universal) ist laut ARCHITECTURE ausdrücklich
unverifiziert und wird erst von AP8 entschieden.

**Entscheidung:** Die tragende Ausgabe ist ein senkrechter Streifen je Array
(Breite × Höhe·Layer) als PNG plus `materialArrayIndex.json`. `toktx` wird
benutzt, WENN es im Pfad liegt, und der Schritt sonst **laut** übersprungen
(Meldung auf stderr mit Verweis auf R4/AP8).

**Grund:** Das Projekt hat für „Texture2DArray auf der Platte" bereits eine
Form — `tools/extract-texture-arrays.py` schreibt und
`client/src/engine/TerrainSplat.ts` liest genau diesen senkrechten Streifen.
Sich hier auf KTX2 festzulegen, hieße eine unbewiesene Annahme in ein
Dateiformat zu gießen, bevor AP8 sie geprüft hat. Der Streifen lädt mit einem
einzigen `RawTexture2DArray`-Aufruf und ist in jedem Bildbetrachter prüfbar.

**Zusätzlich hart geprüft (nicht angenommen):** Bittiefe und Farbtyp jedes
Layers werden aus dem PNG-IHDR gelesen, nicht aus Pillows `mode` abgeleitet;
ein Layer mit abweichender Auflösung bricht den Lauf ab. Negativ geprüft: ein
auf 512² verkleinerter Layer beendet den Packer mit Code 1 und nennt Datei,
Ist- und Sollformat.

---

## 2026-08-30 · AP9 · Zehn Materialien, `mask.png` nur für die vier Overlays

**Lücke:** `material-plan.md` §2 spricht von acht Materialien, ARCHITECTURE W5
friert zehn Tags ein (0–5 Basis, 6–9 Overlays) und sagt zu Tag 7 „nur
Rauheitsabsenkung, keine eigene Textur".

**Entscheidung:** Alle zehn Tags werden gebacken. Tags 0–5 bekommen
Albedo/Normal/ORH, Tags 6–9 zusätzlich `mask.png` (Deckungsmaske, im Bake als
B-Kanal des Paket-Bakes erzeugt). Auch Tag 7 (Feuchte) bekommt Albedo und ORH.

**Grund:** Die Maske ist die Größe, die der Shader für einen Blend-Layer
wirklich braucht, und sie kostet im Paket-Bake keinen eigenen Durchlauf. Für
Tag 7 ist das Albedo bewusst eine Abdunklungsfarbe, kein Materialton, und die
Rauheit fällt auf 0.12 — der Shader kann daraus beides bauen (nur Rauheit, oder
Rauheit plus Abdunklung), ohne dass eine zweite Bake-Form nötig wird. Eine
Textur, die es nicht gibt, kann man später nicht mehr wollen; eine, die man
nicht benutzt, kostet nichts.

---

## 2026-08-30 · AP10 · Dateinamen `DungeonMaterial.ts` + `DungeonMaterialArrays.ts`

**Lücke:** `ARCHITECTURE.md` §1.2 nennt für AP10 genau eine Datei,
`client/src/engine/DungeonMaterial.ts`, und daneben `DungeonAtmosphere.ts`
(SSAO). Der Lader für die Textur-Arrays kommt in keinem der fünf Dokumente vor.

**Entscheidung:** Zwei Dateien: `client/src/engine/DungeonMaterial.ts` (Plugin,
Theme, Stufen, Notbremse) und `client/src/engine/DungeonMaterialArrays.ts`
(Streifen-PNG → `RawTexture2DArray`). `DungeonAtmosphere.ts` gehört nicht zu
diesem Auftrag und ist NICHT gebaut.

**Grund:** AP12 schreibt jede Ebene als senkrechten Streifen in EINE PNG-Datei
(Entscheidung „Senkrechter Streifen als Array-Dateiform"). Babylon hat keinen
Loader, der daraus ein `Texture2DArray` macht — `RawTexture2DArray` will einen
Puffer mit hintereinanderliegenden Ebenen. Dazwischen fehlt derselbe Schritt,
den W5 zwischen Bake und Array schon einmal gefunden hat, nur eine Ebene
weiter. Er gehört nicht in das Plugin: das Plugin darf nicht wissen, in welcher
Datei eine Textur liegt.

---

## 2026-08-30 · AP10 · Die vier Einspritzpunkte, am installierten Babylon 8.56.2 gemessen

**Lücke:** R3 sagt ausdrücklich, die Injektionsmarken seien unbekannt und AP8
messe sie; AP8 ist nicht gelaufen. `render-tech.md` §1.2 nennt vier
Injektionsorte (Albedo, Normal, Roughness/Metal, AO), aber keine Namen.

**Entscheidung (nachgemessen, nicht erinnert):**
1. `CUSTOM_FRAGMENT_DEFINITIONS` — Sampler, Varyings, Hilfsfunktionen.
2. `CUSTOM_FRAGMENT_BEFORE_LIGHTS` — Albedo UND Normale zusammen.
3. `CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS` — Rauheit und Metallic.
4. Ein `!!`-Regex auf den Aufruf von `ambientOcclusionBlock(...)` — Occlusion.

**Grund:** `CUSTOM_FRAGMENT_UPDATE_ALBEDO` und `CUSTOM_FRAGMENT_BUMP_FRAGMENT`
scheiden aus, obwohl sie nach ihren Namen passen. Der Albedo-Punkt liegt im
Rumpf von `albedoOpacityBlock()`, und `ShaderCodeInliner` wird in Babylon
8.56.2 nur von `webgpuEngine.js` und `thinNativeEngine.js` gebaut — unter
WebGL2 bleibt das eine echte Funktion, in der `normalW` (eine Local von
`main()`) nicht existiert. Der Bump-Punkt steht unter
`#ifdef BUMP && OBJECTSPACE_NORMALMAP`, und wir haben keine Bump-Textur.
`CUSTOM_FRAGMENT_BEFORE_LIGHTS` ist der einzige Punkt, an dem `normalW` UND
`surfaceAlbedo` beide deklariert und noch veränderbar sind und der trotzdem vor
Occlusion, Reflectivity und Lichtrechnung liegt.
Für die Occlusion gibt es in 8.56.2 **keinen** `CUSTOM_*`-Punkt — deshalb der
Regex, nach dem Muster von `PbrNebelFix.ts`. Er hängt eine Zeile HINTER den
gefundenen Aufruf (`$0` setzt den Fund wieder ein); trifft er nach einem
Babylon-Update nicht mehr, fällt nur die Occlusion aus, nicht der Shader.
`client/test/dungeon2-material.ts` misst alle vier Orte bei jedem Lauf am
`ShaderStore` nach, damit ein Update nicht still ein texturloses Material
hinterlässt.

---

## 2026-08-30 · AP10 · Zwischenwerte als GLSL-Globals, nicht als Locals

**Lücke:** Nicht behandelt: die vier Einspritzpunkte liegen in DREI
verschiedenen Gültigkeitsbereichen (`main()`, Rumpf von `reflectivityBlock()`,
hinter dem AO-Aufruf in `main()`).

**Entscheidung:** `dgAlbedo`, `dgNormal`, `dgRauheit`, `dgMetall` und `dgAo`
sind globale Variablen, deklariert an `CUSTOM_FRAGMENT_DEFINITIONS`. Der
Rechenblock läuft genau EINMAL, an `CUSTOM_FRAGMENT_BEFORE_LIGHTS`; die beiden
anderen Punkte lesen nur.

**Grund:** `CUSTOM_FRAGMENT_DEFINITIONS` steht in `pbr.fragment` vor
`#include<pbrBlockReflectivity>` — nur deshalb sind die Globals im Rumpf jener
Funktion überhaupt sichtbar. Die Alternative (dreimal rechnen) wäre dreimal
Triplanar je Bildpunkt; die andere Alternative (Locals durchreichen) ginge nur
mit Inlining, und das gibt es unter WebGL2 nicht.

---

## 2026-08-30 · AP10 · Schicht als Vertexattribut mit Uniform-Rückfall

**Widerspruch:** ARCHITECTURE W3/AP6 merged je (Block × `materialTag`) — dann
wäre die Array-Ebene eine Materialkonstante. Der Auftrag verlangt „Layer aus
Vertex-Attribut".

**Entscheidung:** Beides. Attribut `dgSchicht` (ein float je Ecke) wenn das Mesh
es führt (`DUNGEON_SCHICHT_ATTRIBUT`), sonst die feste Ebene aus `dgFest.x`.
Blend-Attribut ist `uv2` (`DUNGEON_BLEND_ATTRIBUT`); fehlt es, kommt
`vec2(999, 999)` an — „weit vom Boden, weit von jeder Kante", also Moos,
Schmutz und Feuchte AUS. Das ist wörtlich W4: „fehlt es, ist Feuchte aus."

**Grund:** Das Attribut kostet vier Byte je Ecke und hält den Weg offen, einen
Block mit sechs belegten Tags als EINEN Zeichenaufruf zu merken statt als sechs.
Der Rückfall kostet nichts und macht das Plugin an einem Mesh ohne Zusatzdaten
(Vorschau, Testquader) trotzdem brauchbar. Ein Ersatzwert von 0 statt 999 wäre
falsch gewesen: er hätte „direkt an der Kante" bedeutet und überall Feuchte
erfunden, die niemand gemessen hat.

---

## 2026-08-30 · AP10 · Moos wächst UNTEN, nicht oben — `render-tech.md` §2.1 ist verdreht

**Widerspruch:** `render-tech.md` §2.1 schreibt
`smoothstep(mossHoehe - 0.3, mossHoehe + 0.3, worldPos.y)`. Das steigt MIT der
Höhe, Moos wüchse also oben am stärksten. Der Fließtext daneben sagt das
Gegenteil („welcher Boden näher am Grundwasser/Erdreich liegt"), und
ARCHITECTURE W4 sagt es auch: `hoeheUeberBoden` treibt Moos und Schmutz.

**Entscheidung:** `1 - smoothstep(...)` über `vDgBlend.x` — Moos und Schmutz
sind unten stark und verschwinden nach oben.

**Grund:** Der Fließtext und W4 sind zweimal dasselbe, die Formel einmal das
Gegenteil; zwei gegen eins, und die Formel ist die Stelle, an der sich ein
Vorzeichen am leichtesten verirrt. Zweitens ist `worldPos.y` nicht dasselbe wie
`hoeheUeberBoden`: die absolute Welthöhe wäre in einem mehrstöckigen Grab
sinnlos, weil das zweite Stockwerk dann gar kein Moos bekäme. Der Bauer liefert
genau deshalb die RELATIVE Höhe.

---

## 2026-08-30 · AP10 · Der Seed reist als zwei 16-Bit-Hälften

**Lücke:** `render-tech.md` §1.4 nennt `seed: number` im Theme-Struct, sagt
aber nicht, wie eine uint32 in einen Shader kommt.

**Entscheidung:** `dgTriplanar.zw` tragen die untere und obere 16-Bit-Hälfte von
`seeds.material`; der Shader baut daraus
`uint(dgTriplanar.z) | (uint(dgTriplanar.w) << 16u)`.

**Grund:** Ein einzelner float verliert oberhalb von 2²⁴ die unteren Bits. Der
Seed käme dann gerundet an, das Rauschen folgte `seeds.material` nicht mehr —
und zwar still, weil ein gerundeter Seed genauso deterministisch aussieht wie
ein richtiger. Genau die Klasse Fehler, gegen die W8 den ganzzahligen Hash
überhaupt vorschreibt.

---

## 2026-08-30 · AP10 · Der GPU-Hash ist eine zeichengenaue Portierung, kein zweiter Hash

**Lücke:** W8 verlangt „denselben ganzzahligen Hash" auf CPU und GPU, sagt aber
nicht, wie das gegen Auseinanderdriften gesichert wird.

**Entscheidung:** `dgAvalanche`/`dgVerruehren`/`dgHashPos` im GLSL sind Zeile
für Zeile `shared/src/dungeon2/hashing.ts`. Der Test liest die beiden
Murmur3-Konstanten und die drei Shift-Weiten aus dem TypeScript-QUELLTEXT und
verlangt sie im GLSL wieder — abgeschrieben wird nichts.

**Grund:** `Math.imul` ist eine 32-Bit-Multiplikation mit Überlauf; in GLSL ist
`uint * uint` genau das, ohne Zutun. Der einzige verbleibende Unterschied ist
die letzte Stelle: JS teilt in `double` durch 2³², der Shader rundet beim
`float(uint)` auf float32. Das verschiebt eine Schwellwertentscheidung um
~1e-7 und ist für Risskanten folgenlos — der Bauer entscheidet nichts, was der
Shader bildpunktgenau nachvollziehen müsste. Dass die beiden Fassungen
überhaupt bit-nah bleiben, ist trotzdem Bedingung: sonst läge ein Moosfleck
neben der Kante, die der Bauer geformt hat.

---

## 2026-08-30 · AP10 · Stufe ist Define UND Textunterschied

**Lücke:** ARCHITECTURE AP10 verlangt „Tier-Werte als Defines, nicht als
Uniforms" und zugleich als Prüfkriterium „Niedrig enthält keinen
Blending-Block".

**Entscheidung:** Beides. `DUNGEON_STUFE` ist ein Zahlen-Define (Cache-Schlüssel),
UND `dungeonDefinitionenGlsl()` erzeugt auf Niedrig einen echt kürzeren Text
ohne Blending-Block und ohne Rauschfunktion.

**Grund:** Das Define allein reichte nicht für das Prüfkriterium (der tote
Zweig stünde noch da), der Textunterschied allein nicht für die Wirkung:
Babylon schlüsselt seinen Effekt-Cache über die Define-Zeichenkette, ein
Stufenwechsel ohne Define-Änderung bekäme den ALTEN Shader zurück — ein
Schalter ohne Symptom außer dem fehlenden Effekt.
Nebenbefund, der leicht kostet: **alle** Defines müssen im Konstruktor-Objekt
von `MaterialPluginBase` stehen. `collectDefines()` legt genau dessen Schlüssel
an; ein in `prepareDefinesBeforeAttributes()` gesetzter, dort fehlender Name
taucht in der Define-Zeichenkette nie auf, und der `#ifdef` ist still immer
falsch.

---

## 2026-08-30 · AP10 · Parallax ist gebaut, aber standardmäßig aus

**Widerspruch:** W9 stellt Parallax in Meilenstein 2. Prüfkriterium 1 von AP10
verlangt, dass die Stufe Hoch den Parallax-`#ifdef` enthält.

**Entscheidung:** Der Zweig (Offset-Limiting, nur dominante Ebene, ein
zusätzlicher Tap) steht im Quelltext der Stufe Hoch. Das Define
`DUNGEON_PARALLAX` ist nur gesetzt, wenn `erlaubeDungeonParallax(true)` es
ausdrücklich freigibt — Voreinstellung aus.

**Grund:** So ist R6 („Parallax bleibt teuer, das ist eine Schätzung, keine
Messung") messbar, ohne dass Meilenstein 1 ihn trägt. Ein Zweig, den man erst
schreiben muss, um ihn zu messen, wird nie gemessen.

---

## 2026-08-30 · AP10 · sRGB wird im Shader linearisiert, nicht beim Hochladen

**Lücke:** Nicht behandelt: `RawTexture2DArray` hat keinen `useSRGBBuffer`.

**Entscheidung:** Das Albedo-Array wird roh (sRGB-kodiert) hochgeladen und im
Shader mit Babylons eigenem `toLinearSpace()` linearisiert. Normale und ORH
sind linear und bleiben unangetastet.

**Grund:** Die Alternative wäre, beim Laden auf der CPU zu linearisieren — das
hieße 8 Bit linear, und die dunklen Stufen einer gedämpften Barrow-Palette
brächen sichtbar in Bänder auf. `toLinearSpace()` ist außerdem genau die
Funktion, die der PBR-Shader für `GAMMAALBEDO` benutzt; damit ist der
Farbraumweg derselbe wie bei jedem anderen Material im Spiel.

---

## 2026-08-30 · AP10 · Das Plugin hängt sich NICHT global an

**Widerspruch:** Die vier bestehenden Plugins hängen über
`scene.onNewMaterialAddedObservable` an jedem Material.

**Entscheidung:** `erzeugeDungeonMaterial()` hängt das Plugin gezielt an das
eine Material, das es baut.

**Grund:** Jene vier korrigieren eine globale Eigenschaft (Nebelkurve,
Gammafehler) oder liefern einen globalen Dienst (Fackellicht). Dieses braucht
material-spezifische Theme-Daten — global angehängt bekäme jeder Baum und jeder
Fels fünf zusätzliche Sampler und einen Triplanar-Block, den er nie benutzt.
Die Verträglichkeit mit den vier globalen Plugins bleibt: sie stapeln sich auf
demselben Material, und der Test belegt, dass keines ihrer drei Regex-Muster
unseren eingespritzten Code trifft und dass ihre Anker die Einspritzung
unverändert überstehen.

---

## 2026-08-30 · AP10 · Kein `node_modules` im Worktree — der Client-Test braucht eine Brücke

**Lücke:** Nicht behandelt: `client/test/*` importiert `@babylonjs/core`, im
Worktree fehlt aber `node_modules`.

**Entscheidung:** Der Test wird mit `tsx` aus `/home/mike/wov-wt-bundle` gefahren
und braucht dafür ein `node_modules` im Worktree, das auf die Einträge des
Bündel-Worktrees zeigt (`@wov/*` allerdings auf die EIGENEN Pakete). Das ist
Werkzeug, kein Zustand: es wird nach dem Lauf wieder entfernt, weil ein
`node_modules`, das auf einen anderen Worktree zeigt, sonst still den falschen
`shared`-Stand typprüfen ließe.

**Grund:** `@wov/shared` ist im Bündel-Worktree ein relativer Symlink auf dessen
eigenes `shared/`. Wer nur `node_modules` verlinkt, prüft seinen Client gegen
ein fremdes `shared` — und merkt es genau dann nicht, wenn beide Stände zufällig
noch zusammenpassen.

---

## 2026-08-30 · AP6 · `dungeon2` erreicht den Client als Namensraum, nicht flach

**Lücke:** Nicht behandelt: wie der Client an `shared/src/dungeon2/**` kommt.
`shared/package.json` hat kein `exports`-Feld, `main` zeigt auf `src/index.ts`,
und `dungeon2` stand im Barrel nicht drin. Ein Tiefimport
(`@wov/shared/src/dungeon2/builder.js`) hinge daran, dass der Bundler die Endung
`.js` auf die vorhandene `.ts` zurückbildet; ein relativer Pfad aus
`client/test/` heraus scheitert an `rootDir` (TS6059, gemessen).

**Entscheidung:** Neues Sammelmodul `shared/src/dungeon2/index.ts` (nur
Wiederausfuhren), im Hauptbarrel als **`export * as dungeon2`**.

**Grund:** Ein flaches `export *` wäre die Falle: `dungeon2/layout.ts` exportiert
`Kante`, `Tuer`, `ZELLE_M` — Namen, die `dungeons.ts` und `dungeonRaster.ts`
ähnlich führen. TypeScript meldet einen solchen Konflikt **nicht**, es lässt den
Namen still weg, und der Fehler erscheint erst an der Aufrufstelle als „gibt es
nicht". Der Namensraum macht die Herkunft außerdem am Aufruf sichtbar
(`dungeon2.baueGeometrie`), was bei zwei koexistierenden Dungeon-Systemen kein
Schmuck ist.

---

## 2026-08-30 · AP6 · Ein Mesh je (Block × materialTag) — trotz Schichtattribut

**Lücke:** `DungeonMaterial.ts` trägt das Vertexattribut `dgSchicht`. Damit wäre
**ein** Mesh je Block möglich (alle Tags in einem Zeichenaufruf), was die
Zeichenaufrufe halbierte: gemessen 28 Meshes bei 14 Blöcken, also genau zwei
belegte Tags je Block.

**Entscheidung:** Es bleibt bei einem Mesh je (Block × materialTag), wie
ARCHITECTURE AP6 es festschreibt. Das Attribut wird trotzdem geschrieben.

**Grund:** Das Prüfkriterium (a) des Pakets ist die Formel „Blöcke × belegte
materialTags"; sie stillschweigend zu unterschreiten hieße, das Kriterium
umzudefinieren statt zu erfüllen. Das Attribut **muss** trotzdem geschrieben
werden: ohne es fällt der Shader auf `dgFest.x` zurück, und das Plugin bindet
dort fest `0` — jede Wand trüge dann das Material der Ebene 0. Der
Zusammenlegungsgewinn ist damit gemessen und jederzeit hebbar, ohne dass
irgendetwas anderes sich ändern müsste.

---

## 2026-08-30 · AP6 · Rampenkollision als gekippte Platte, nicht als Stufenquader

**Lücke:** `KollisionsKoerper` mit `form: 'rampe'` liefert eine achsparallele
Hülle plus `steigung`; wie daraus eine Havok-Form wird, steht nirgends.

**Entscheidung:** Eine um `atan2(Hub, Lauf)` gekippte Platte von Bodendicke,
deren **Oberfläche** von der Bodenoberkante der tiefen Seite bis `Hub` darüber
läuft. Verschoben wird sie entlang der **Flächennormalen**, nicht senkrecht.

**Grund:** Der Bauer trennt ausdrücklich „Optik gestuft, Kollision glatt"; die
acht Stufenquader zu nehmen machte eine feinere Treppe zu einer Änderung des
Laufgefühls. Die Verschiebung entlang der Normalen ist kein Feinschliff: senkrecht
läge die Oberfläche um `(1−cos α)·Dicke/2` daneben, bei 45° also 15 cm — genug
für einen Hänger an der Treppenkante. Die Drehrichtung ist mit Babylons **eigener**
Matrix nachgerechnet (Test „Babylons Quaternion kippt die Rampe genauso"), weil
ein Vorzeichenfehler an einer Drehachse kein Symptom hat außer einer Treppe, die
nach unten führt.

**Fund nebenbei:** Der Generator erzeugt über 120 Seeds **keine einzige**
Treppenzelle (gemessen). Mehrstöckigkeit entsteht über Schächte. Die
Rampenrechnung ist deshalb an einem von Hand gebauten Layout geprüft — ein
Zweig, den kein Test betritt, ist kein Code, sondern eine Vermutung. Für AP4 ist
das ein offener Punkt, nicht für AP6.

---

## 2026-08-30 · AP6 · Ein Havok-Körper je Block, Sammelform statt Einzelkörper

**Entscheidung:** `PhysicsShapeContainer` mit einer `PhysicsShapeBox` je
Kollisionskörper, dazu **ein** `PhysicsBody` je Block.

**Grund:** Ein Steingrab hat 790 bis 1010 Kollisionskörper (gemessen über drei
Seeds). So viele Havok-Körper wären dieselbe Broadphase-Last wie ein ganzer Wald.
Nicht Havoks Instanz-Modus: `StaticColliderSet` hält fest, dass Babylons
`PhysicsCharacterController` instanzierte Körper **nicht** sieht — gegen einen
einzeln angelegten Körper stoppte der Spieler, durch einen instanzierten lief er
hindurch.

---

## 2026-08-30 · AP6 · Materialbesitz über einen Nutzerzähler, Texturen nie

**Entscheidung:** Ein Material je (Szene, Material-Seed, Thema-Kennwerte), mit
Zähler; die letzte Instanz gibt es mit `dispose(true, false)` frei. Meshes werden
mit `dispose(false, false)` abgeräumt. Die Texturarrays gehören dem Aufrufer und
werden hier **nie** freigegeben.

**Grund:** AP6 nennt die Falle wörtlich — `mesh.dispose(_, true)` schösse das
geteilte Dungeon-Material aller laufenden Instanzen ab. Der Zähler ist die
messbare Fassung davon: der Test baut zwei Instanzen, räumt die erste ab und
prüft, dass die zweite ihr Material behält; und er baut zwanzigmal auf und ab und
verlangt, dass Mesh-, Material-, Textur- und Knotenzahl der Szene **exakt** auf
den Ausgangswert zurückkehren. Der Material-Seed gehört in den Schlüssel, weil er
als Uniform im Shader steckt: zwei Gräber mit verschiedenem Material-Seed dürften
sich sonst ein Material teilen und hätten dieselben Risse.

---

## 2026-08-30 · AP6/AP10 · SSAO bekommt eine eigene Pipeline, mit gemessenen Zahlen

**Entscheidung:** `DungeonAtmosphere.ts` baut eine zweite
`SSAO2RenderingPipeline` (`dungeon2SSAO`) und trennt beim Betreten die
Außenwelt-Pipeline (`valheimSSAO`) von der Kamera — aber nur, wenn sie an dieser
Kamera überhaupt hing, und hängt genau die beim Verlassen zurück.
`maxZ = 60 m`, `radius = 0.45 m`.

**Grund und Messung:** Die Außen-Pipeline ist auf 4 km kalibriert
(`SSAO_MAX_Z = 1000`). Die Zahlen hier sind an der **Geometrie** gemessen, nicht
übernommen: über 40 erzeugte Steingräber und 47.328 Sichtlinien (freie Strecke
von jeder begehbaren Zelle in alle vier Richtungen) liegt der Median bei 8 m, das
90. Perzentil bei 28 m, das 99. bei 60 m, die längste bei 112 m — 60 m deckt also
99 % und ist zugleich das obere Ende des von `render-tech.md` §3 genannten
Fensters. Der Radius folgt `kantenAbstand`, der Größe, die SSAO zeigen soll:
über 330.376 Ecken Mittel 0,35 m, 90. Perzentil 1,0 m. Zwei Pipelines auf einer
Kamera rechneten die Verdeckung doppelt; das sieht nicht nach „doppelt" aus,
sondern nach „zu dunkel", und man sucht es im Material.

**Grenze, ausdrücklich:** Das ist eine Messung an der Geometrie, **kein Bild**.
AP10-Kriterium 3 verlangt gemessene Werte; ob sie gut *aussehen*, entscheidet
AP11.

---

## 2026-08-30 · AP6 · Zwei GPU-Fehler in AP10, die nur ein echter Lauf zeigt

Die Vorschauseite (`client/dungeon2.html`) hat beim ersten Lauf auf ANGLE/Vulkan
zwei Fehler in fremden, bereits „grünen" Dateien freigelegt. Beide sind hier
behoben, weil sie nachgewiesen sind und der Dungeon sonst grau bzw. schwarz
bleibt:

1. **`DungeonMaterial.ts`: `sampler2DArray` ohne Präzision.** GLSL ES 3.00 gibt
   `sampler2D` eine Vorgabepräzision, `sampler2DArray` **nicht**. Der
   Fragmentshader scheiterte viermal mit „No precision specified", die Notbremse
   griff, das ganze Grab war grau. Behoben mit `highp` an den drei Uniforms und
   am Parameter von `dgTap`. Die Shader-Textprüfung war vorher grün, weil sie nur
   nach dem **Namen** sah — sie verlangt jetzt die Präzision mit.
2. **`DungeonMaterialArrays.ts`: Maße nach `ImageBitmap.close()` gelesen.** Die
   Spezifikation setzt `width`/`height` beim Schließen auf 0. Die Bilddaten waren
   richtig, die Maße 0×0 — `RawTexture2DArray` legte drei Texturen der Größe 0
   an, jeder `texture()`-Zugriff lieferte Schwarz. Kein Fehler in der Konsole,
   nur eine WebGL-Warnung über Mipmaps einer „zero-size texture". Behoben, plus
   eine harte Prüfung auf 0×0.

**Lehre (dieselbe wie „Node-Krypto ist nicht Browser-Krypto"):** Eine
Shader-Textprüfung ohne GPU findet, was im Text steht, nicht was der Übersetzer
verlangt. Der eine Lauf gegen echte Hardware hat mehr gefunden als 41
Textprüfungen.

---

## 2026-08-30 · AP6 · Der Vorschaupfad fasst den Betriebspfad nicht an

**Entscheidung:** Eigene Seite `client/dungeon2.html` + `src/dungeon2Preview.ts`,
eigener Vite-Einstieg. `client/src/main.ts` bleibt **unberührt** — der Einbau in
die Weltwechsel-Logik gehört zu AP13 (Adapter, Teleportpaket, Sanitizer-Weiche).

**Grund:** Ein Bauer, den man nur im Vollbetrieb sehen kann, wird im Vollbetrieb
gesucht: Anmeldung, Weltwechsel und Teleportpaket lägen zwischen jedem Versuch
und dem Bild. Die Seite lädt die Texturen zuerst unter `/assets/dungeon2/` (der
Entwicklungsserver reicht den Repo-Ordner dort durch) und fällt auf
`/dungeon2/` zurück, den Fundort im ausgelieferten Client — dieselbe Seite läuft
damit in beiden Fällen. Der Eintrag in `vite.config.ts` ist Pflicht und kein
Beiwerk: ohne ihn baut Vite die Seite stillschweigend nicht, und im Dev-Server
fällt das nie auf.

---

## 2026-08-30 · AP6/AP11 · Die Quader waren verdreht — SSAO hat es nur sichtbar gemacht

**Befund:** Ab Grafikstufe Mittel wurde das Bild fast schwarz (gemessen, Seed
4242, Spawnblick: Niedrig Ø 87,2, Mittel Ø 18,9 = 21,7 %). Verdächtigt war die
`SSAO2RenderingPipeline` in `DungeonAtmosphere.ts` — `forceGeometryBuffer`,
`HALF_FLOAT`, die Kalibrierung, ein Konflikt mit den Material-Plugins. Keines
davon war es. Ein Parametersweep an der lebenden Vorschau zeigte, dass die
Verdunkelung mit dem Radius skaliert (0,05 → Ø 55,9; 0,15 → Ø 37,8; 0,45 →
Ø 22,5) und mit `epsilon` verschwindet (0,5 → Ø 77,2) — das Muster einer
**gleichmäßig falschen Halbkugelrichtung**, nicht einer Fehlkalibrierung.

**Ursache:** `shared/src/dungeon2/builder.ts` (`stueckZuNetz`, `FLAECHEN`)
liefert die Dreiecke so, dass die Rechte-Hand-Normale der Umlaufrichtung **mit**
der ausgeschriebenen Flächennormale zusammenfällt; `shared/test/dungeon2-builder.ts`
(B1) verlangt genau das („vorzeichenbehaftetes Volumen positiv"). Babylon zählt
in seinem linkshändigen System umgekehrt — an `CreateBoxVertexData` abgelesen:
dort zeigt die Rechte-Hand-Normale **entgegen** der Flächennormale.
`DungeonBuilder.baueMeshes` hat die Indizes unverändert übernommen. Folge: die
Rückflächenentfernung verwarf genau die Seiten, die in den Raum blicken, und
sichtbar blieb die Rückseite jedes Quaders. Am GeometryBuffer nachgemessen:
**1290 von 1290 sichtbaren Pixeln mit `dot(Normale, Sichtstrahl) > 0`** — jede
Normale zeigte von der Kamera weg. SSAO2 legte seine Halbkugel damit in den
Stein, fand jede Probe verdeckt und löschte das Bild aus.

**Entscheidung:** Die Umkehr steht in `client/src/engine/DungeonBuilder.ts`,
nicht in `shared`. `shared/src/dungeon2` kennt keine Engine, und die
Vorzeichenregel des Volumens ist eine Aussage über Geometrie, keine über
Babylon. Die SSAO-Zahlen (`maxZ = 60`, `radius = 0,45`, `totalStrength = 1,1`)
bleiben unverändert — sie waren nie das Problem.

**Messung nach dem Fix** (Seed 4242, 1280×720, Fackelflackern angehalten,
mittlere Bildhelligkeit 0–255):

| Framing | Niedrig | Mittel ohne SSAO | Mittel | Hoch | Mittel/Niedrig | SSAO-Anteil |
|---|---|---|---|---|---|---|
| Gang | 91,2 | 80,8 | 78,7 | 79,5 | 86,2 % | 2,7 % |
| Raum | 92,2 | 62,9 | 62,4 | 62,5 | 67,8 % | 0,8 % |
| Übergang | 90,0 | 78,4 | 77,9 | 77,8 | 86,5 % | 0,8 % |

Der Rest des Abstands Niedrig→Mittel ist **nicht** SSAO, sondern das
Material-Blending, das auf Niedrig aus ist: die Spalte „Mittel ohne SSAO" trennt
beides. Im Raum-Framing liegt Mittel bei 67,8 % statt der als Richtwert
genannten 70 % — der Boden dieses Raums ist stark bemoost (Moos wächst unten),
und das ist Materialentwurf, keine Auslöschung. SSAO selbst kostet dort 0,8 %
Gesamthelligkeit bei lokal bis zu 41/255 Verdunkelung in den konkaven Kanten.

**Wächter:** Eine verdrehte Umlaufrichtung hat in **keiner** Zählung ein
Symptom — Dreiecks- und Vertexzahlen stimmen, jeder Manifold-Test bleibt grün,
das Grab bleibt sichtbar. `client/test/dungeon2-bauer.ts` prüft deshalb jetzt je
Dreieck, dass die Rechte-Hand-Normale entgegen der Flächennormale zeigt, und der
Vergleich „kein Dreieck verloren" baut seine Erwartung mit derselben Umkehr auf —
ohne das bliebe er auch dann grün, wenn der Bauer die Umkehr wieder verlöre.

**Lehre (verwandt mit „Zwei GPU-Fehler in AP10"):** Der erste Verdacht lag auf
dem zuletzt geänderten Modul. Gefunden hat es erst eine Messung an der Zwischen-
stufe — dem GeometryBuffer —, nicht am Endbild. Wo ein Effekt „global" statt
lokal wirkt, ist meist seine Eingabe verdreht und nicht sein Parameter falsch.

---

## 2026-08-30 · AP4/AP-Bauer · Treppen waren tote Zweige — der Generator baute Schächte, nie Stufen

**Befund (gemessen, nicht vermutet):** Im Spiel lag an jedem Aufgang ein
**flacher Boden**. `shared/src/dungeon2/builder.ts` behauptet ab `baueStufen()`
„acht Stufenquader entlang der Neigungsachse". Die Zählung am erzeugten Grab
(Seed 2, STEINGRAB):

| | Treppenzellen | `stufe`-Stücke | Kollision `rampe` |
|---|---|---|---|
| vorher | **0** | **0** | **0** |
| nachher | 12 | 96 | 12 |

**Ursache:** `baueStufen()` war unerreichbar. `stempelSetzen()` (`cells.ts`)
schreibt jeder Zelle `art = Boden`; die einzige Stelle, an der `generator.ts`
die Art überschrieb, setzte **`Schacht`** — für beide Zellen des
`treppe`-Stempels, auf zwei Ebenen übereinander. Ein Schacht ist ein Loch: die
Ebene darüber war erreichbar (`erreichbareZellen()` läuft senkrecht durch
Schächte), aber es gab nichts zum Hinaufsteigen — acht Meter Luft. Die Regel
`treppe-anschluss` und die Rampenrechnung im Client waren damit ebenfalls
ungeprüfter Code; `client/test/dungeon2-bauer.ts` sagte es sogar wörtlich: „Der
Generator erzeugt über 120 Seeds KEINE einzige Treppenzelle (gemessen)."

**Entscheidung 1 — der Aufgang ist ein Treppenhaus aus DREI Zellen:** zwei
`Treppe`-Zellen auf der unteren Ebene (je 8 Höhenstufen = 4 m Anstieg über eine
4-m-Zelle, also 45°) und darüber die `Schacht`-Mündung, in die der obere Lauf
austritt. Zwei Läufe, weil 16 Höhenstufen durch 2 ganzzahlig teilbar sind und
durch 3 nicht; ein einziger Lauf müsste 8 m auf 4 m schaffen (63°) — das ist
eine Leiter, keine Treppe.

**Entscheidung 2 — das obere Ende einer Treppe darf senkrecht sein.** Die Regel
`treppe-anschluss` verlangte an beiden Enden eine begehbare Nachbarzelle **auf
derselben Ebene**. Damit war ein Aufgang zwischen zwei Ebenen im eingefrorenen
Format **nicht ausdrückbar**. Sie akzeptiert jetzt zusätzlich die
Schachtmündung direkt über der Zelle; `baueStufen()` misst den Anstieg an
derselben Stelle (`anstiegStufen()`).

**Entscheidung 3 — `ebenen-abstand` gilt nicht unter einem Schacht.** Steht ein
`Schacht` unmittelbar über einer offenen Zelle, lässt `hatBodenPlatte()` die
Bodenplatte und `hatDeckenPlatte()` die Deckenplatte weg, und `obenStufen()`
zieht **eine** lichte Säule durch. Es gibt dort keine zwei Platten, die sich
durchdringen könnten — die Regel prüfte ein Bauteil, das der Bauer nie baut,
und verbot genau den Aufstieg, für den es den Schacht gibt.

**Entscheidung 4 — `erreichbareZellen()` hängt am Schacht, nicht am Herkommen.**
Nach OBEN geht es, wenn über einem ein Schacht steht (dieselbe Bedingung, unter
der `hatBodenPlatte()` die Platte weglässt), nach UNTEN, wenn man selbst der
Schacht ist. Vorher war die Verbindung einseitig; ein Treppenlauf, der in eine
Mündung austritt, war von unten her eine Sackgasse — sichtbar erst als „obere
Ebene nicht erreichbar".

**Entscheidung 5 — ein Treppenhaus ist eine Röhre.** Aus den Läufen wächst
nichts nach (P2/P2b überspringen sie), ihre Flanken sind keine
Schleifen-Kandidaten (P5) und werden zugemauert (P7). Grund: eine Schleife an
der Flanke des oberen Laufs wird in P8 zu einer **Tür**, und
`durchgangErzwungen` schlägt `wandErzwungen` — die Tür riss die gerade gesetzte
Wand wieder auf und öffnete sie auf den massiven Unterbau der Treppe.

**Zwei Fallen, die keine Prüfung meldete:**

1. *Der Unterbau.* Zwischen den beiden Läufen steht **keine** Wand (sonst mauert
   die Höhenregel §3.3 die Treppe in ihrer Mitte zu). Die Stufenquader des
   oberen Laufs begannen aber erst an seiner eigenen Bodenunterkante — man sah
   an dieser Kante **unter** den oberen Lauf ins Nichts. `sockelStufen()` zieht
   die Quader jetzt bis zur Bodenunterkante der tieferen Nachbarin hinab. Der
   **Rampenkörper bleibt unverändert**: `kollisionsForm()` im Client rechnet die
   Lauffläche aus `ys0 = unten − BODEN_DICKE_STUFEN` zurück.
2. *Der Kopfraum.* `TREPPE_KOPFRAUM_STUFEN = 6`, nicht 7. Die bindende Schranke
   ist **nicht** `ebenen-abstand`: die Regel vergleicht `boden + decke` mit der
   Sohle darüber und lässt die **Dicke** der Deckenplatte aus. Bei 7 blieb sie
   grün, die Deckenplatte des unteren Laufs stand aber einen halben Meter über
   der Sohle der Ebene darüber und legte sich quer in die Tür eines Raums, der
   dort später wuchs — gefunden hat es allein der Begehbarkeitslauf
   (`client/test/dungeon2-bauer.ts`, „Hänger").

**`NavZelle.mitte.y` ist die Standhöhe in der ZELLMITTE**, bei einer Treppe also
eine halbe Steigung über `Zelle.boden` (das laut Format die Höhe an der TIEFEN
Kante ist). Vorher hätte jede Wegfindung und jede Spawnprüfung die Treppe zwei
Meter zu tief gesehen.

**Zwei Tests mussten sich ändern, weil sie das Probenraster maßen, nicht das
Grab:**

* `dungeon2-builder.ts` (B2) probte in der **Zellmitte** — die fällt bei einer
  Treppenzelle genau auf die Naht zwischen dem vierten und fünften Stufenquader,
  und `imFesten()` zählt einen Punkt genau auf einer Fläche (richtigerweise) als
  außen. Eine nahtbreite Fuge ist kein Leck. Die Probe liegt jetzt ein halbes
  Achtel daneben.
* `dungeon2-bauer.ts` (Begehbarkeit) verglich die Bodenhöhe mit einer **Geraden
  zwischen zwei Zellmitten**. Über eine Treppe ist der Boden flach, dann
  geneigt, dann flach — die Gerade läge dort bis zu 2 m daneben, ohne dass ein
  einziger Schritt zu groß wäre. Gemessen wird jetzt die **Stetigkeit von Probe
  zu Probe**: wer die Gerade prüft, verbietet Rampen; wer die Stetigkeit prüft,
  verbietet Stürze. Gemessene Strecke stieg von 3304 m auf **4796 m** — die
  Treppen sind jetzt begehbar.

**Wächter.** Der Fehler hatte in **keiner** Zählung ein Symptom: acht
Stufenquader entstehen auch bei Anstieg 0, jeder Manifold- und Dichtheitstest
bleibt grün, und das Grab sieht vollständig aus. Gemessen wird deshalb die
**Zahl der verschiedenen Oberkanten** je Treppenzelle — acht, nicht eine:

* `shared/test/dungeon2-builder.ts` (E): Treppenzellen kommen in erzeugten
  Grabmälern vor, jede liefert acht **steigende** Quader, und jeder Lauf
  überwindet genau eine halbe Ebene (4 m). Gegenprobe: nimmt man den senkrechten
  Zweig aus `anstiegStufen()` heraus, meldet der Test „8 Stufenquader mit **1**
  verschiedenen Oberkanten".
* `client/test/dungeon2-bauer.ts`: in der Zellsäule einer Treppe liegen acht
  verschiedene waagerechte Flächenhöhen — die Trittflächen erreichen die
  fertigen Meshes.

**Eingefrorene Tabellen neu ausgegeben** (`dungeon2-generator.ts`,
`dungeon2-builder.ts`, `golden/dungeon2-e2e.json`): der Grundriss ändert sich
absichtlich, weil ein Aufgang jetzt drei Zellen statt zwei belegt.

**Bildbeweis** (Seed 2, Vorschau auf :5901, Chromium mit ANGLE/Vulkan):
`~/.cache/wov-tripo-test/dungeon2-treppe.png` (vom Fuß, Zelle (−2,6)) und
`dungeon2-treppe-oben.png` (aus der Mündung auf Ebene 1, 8 m, 45° herab). Die
Stufen sind plastisch, das Triplanar liegt auf den Trittflächen, am Übergang
Boden→Treppe und Treppe→Mündung ist kein Loch. Die Vorschau nimmt dafür jetzt
zusätzlich `?neigung=Grad` (Nickwinkel) — ohne ihn lässt sich eine Treppe nur
von der Seite zeigen, nie von oben herab.

**Lehre:** Ein Zweig, den kein Test je betritt, ist kein Code, sondern eine
Vermutung — und ein Kommentar, der das offen sagt („der Generator erzeugt über
120 Seeds KEINE einzige Treppenzelle"), ist ein Fehlerbericht, den niemand als
solchen gelesen hat.

---

## 2026-08-30 · AP4 · Ein Treppenaufgang muss oben in einen Raum münden

**Lücke:** Der Vorgänger machte die Treppen echt, ließ aber offen, wohin sie
führen. Der Aufgang setzte drei Zellen (zwei Läufe unten, die `Schacht`-Mündung
oben) und trug die Mündung nur als **Wachstumsfront** ein. Ob dort je ein Raum
wuchs, entschied der Zufall: war die gezogene Zielgröße erreicht, bevor die
Hauptschleife die Mündungskante zog, blieb oben eine 1×1-Kammer ohne Ausgang
stehen. Regelkonform — `erreichbar` ist erfüllt, sobald der Schacht vom Eingang
aus erreicht wird — und trotzdem Unsinn. Gemessen über 200 Seeds: **171 von 225
Mündungen (76 %) angebunden**, bei Vorschau-Seed 2 **vier von sechs Mündungen
ohne jeden Nachbarn**, eine fünfte nur an eine 1×1-Nische.

**Entscheidung 1 — die Anbindung wird erzwungen, nicht gehofft.** Direkt nach
dem Setzen des Treppenhauses wächst aus der Mündung **sofort** ein Raum: die
freien Randkanten der Mündung werden in gezogener Reihenfolge durchprobiert, je
Kante bis zu `MAX_TYP_VERSUCHE` Raumtypen. Das ist derselbe Weg, den die
Hauptschleife geht (`versucheZuSetzen` ruft sich rekursiv auf) — kein zweiter
Setzpfad, den niemand misst.

**Entscheidung 2 — an einer Mündung zählt nur ein echter Raum.** `zieheTyp()`
bekommt den Schalter `nurEchteRaeume`, der `treppe`, `nische` und `abschluss`
aussortiert. Eine 1×1-Nische verschöbe die Sackgasse um einen Schritt, ein
zweites Treppenhaus um eine Ebene. Übrig bleiben `gang` (1×L, L≥3), `kammer`,
`saal`, `schatzkammer`, `grabkammer`.

**Entscheidung 3 — geht oben nichts, fällt das GANZE Treppenhaus.** Eine Treppe
in einen Verschlag ist schlechter als keine Treppe. `verwirfTreppenhaus()` baut
alle drei Stempel zurück: Belegung, Eltern, `treppenLaeufe`, die
Verbindungskante, die drei Korrektureinträge, die Anschlussliste und
`naechsteId`. Die **Ziehungen** werden nicht zurückgenommen — das wäre ein
zweiter Zufallszustand neben dem Strom. Determinismus verlangt gleiche Eingabe →
gleiche Ausgabe, nicht ziehungsfreie Sackgassen.

**Nicht angefasst — die beiden dokumentierten Fallen bleiben stehen:** Die
**Röhren-Regel** (alles außer Fuß und Kopf der Läufe wird zugemauert, und die
Läufe stehen in `treppenLaeufe`, also weder in `nachwuchs()` noch in den
Berührungskanten) gilt unverändert; die Mündung ist ausdrücklich **kein** Lauf
und darf deshalb Türen tragen. `TREPPE_KOPFRAUM_STUFEN = 6` ist unberührt.

**Wächter** (`shared/test/dungeon2-generator.ts`, Kriterium (g), 200 Seeds):
Jede `Schacht`-Zelle hat mindestens einen Nachbarn derselben Ebene, der offen
ist, keine Wand dazwischen hat (`wandZwischen`, also inklusive der abgeleiteten
Höhenregel), zu einem **Nicht-Treppen**-Stempel gehört und **größer als 1×1**
ist. Dazu die Gegenprobe gegen das billige Grün: **wie viele Seeds überhaupt
noch eine Treppe haben** — sonst erfüllte man (g), indem man alle Treppen
wegwirft.

| | vorher | nachher |
|---|---|---|
| Seeds mit Treppe (von 200) | 98 (49 %) | **98 (49 %)** |
| Schachtmündungen gesamt | 225 | 183 |
| davon angebunden | 171 (76 %) | **183 (100 %)** |

Die Zahl der Mündungen sinkt um 19 % — das sind die verworfenen Treppenhäuser.
Die Zahl der Seeds **mit** Treppe bleibt gleich; kein Grab verliert seine
Mehrstöckigkeit, es werden nur die überzähligen Aufgänge knapper. Der Test hält
die Schranke bei 90 von 200, damit ein echter Einbruch auffällt statt sich als
„immer noch Treppen da" wegzureden.

**Eingefrorene Tabellen neu ausgegeben** (`dungeon2-generator.ts`,
`dungeon2-builder.ts`, `golden/dungeon2-e2e.json`, Verfahren
`DUNGEON2_EINFRIEREN=1`): Der Grundriss ändert sich absichtlich — ein verworfenes
Treppenhaus verschiebt alles, was danach gezogen wird.

**Bildbeweis** (Seed 2, Vorschau auf :5901, Chromium mit ANGLE/Vulkan):
`~/.cache/wov-tripo-test/dungeon2-muendung.png`, Kamera in der Mündung
(−7,−4) auf Ebene 1, Weltmitte (−26, −12.8), 10 m hoch, Blick 180°, Neigung 6°.
Links steht die Laibung der Mündung, dahinter öffnet sich der angeschlossene
**Saal 6×7 Zellen (24 × 28 m)** mit Fackel und ferner Südwand — kein
1×1-Verschlag. Bei diesem Seed bleibt nach dem Fix genau **eine** Mündung übrig
(vorher sechs), und die führt in den größten Raum der oberen Ebene.

**Lehre:** „Erreichbar" ist keine Aussage über Begehbarkeit. Eine Regel, die nur
fragt, ob der Spieler **hinkommt**, sagt nichts darüber, ob es sich lohnt — und
genau diese Lücke hatte in (a)–(d) kein einziges Symptom.

---

## 2026-08-30 · AP6 · Zwei Geometriefehler des Bauers: Streifen im Boden, Quader vor der Wand

**Befund (Mike, Vorschau STEINGRAB, zwei Screenshots).** (1) Auf Bodenflächen
flackerten streifenweise helle Mauerwerkstexturen durch. (2) An manchen Stellen
standen langgestreckte Quader sichtbar VOR einer sonst planen Wand.

### Befund 1 — Z-Fighting: die Wand steckte in Boden- und Deckenplatte

**Ursache** (`shared/src/dungeon2/cells.ts`, `zellKanteZuQuaderGanz`): Die
senkrechte Ausdehnung eines Wandquaders war die Vereinigung der **Bau**-Säulen
(`saeuleUnten`/`saeuleOben`), also *einschliesslich* Boden- und Deckenplatte.
Damit lag die Unterseite der Wand exakt in der Ebene der Bodenplatten-Unterseite
und ihre Oberseite exakt in der Ebene der Deckenplatten-Oberseite. Zwei
deckungsgleiche Flächen in einer Ebene sind Z-Fighting; sichtbar wurde es auf dem
Stockwerk **darüber**, weil `materialFuer()` senkrechten Bauteilen den WAND-Tag
gibt und waagerechten den Zell-Tag — heller Sandstein gegen dunklen Boden.
Dieselbe Ursache in drei weiteren Bauteilen: Tür**pfosten** (`untenMin` aus
`saeuleUnten`), Tür**sturz** (`ys1 = max(saeuleOben)`) und die Deckenplatte
selbst, die im bündigen Fall volumengleich mit der Bodenplatte des Stockwerks
darüber lag.

**Fix — was in einer Platte steckt, bekommt keine Fläche:**

* Wandquader: `ys0 = min(bodenStufen)`, `ys1 = max(obenStufen)` — Aussenhaut von
  der Boden-OBERKANTE bis zur Decken-UNTERKANTE. Dicht bleibt es, weil dort die
  Platte selbst steht; sie deckt den ganzen Zellfussabdruck ab, also auch die
  Hälfte des Wandstreifens, die in der Zelle liegt.
* Neuer Deckel `deckelDurchStockwerkDarueber()`: kein Wandquader fährt durch die
  Bodenplatte des Stockwerks darüber. Er gilt für **beide** Seiten des Streifens,
  auch für eine Felsseite — über Fels kann sehr wohl ein Raum liegen, und genau
  dort fuhren die Aussenwände durch dessen Boden. (Der Fall entsteht, weil
  `obenStufen()` die lichte Säule bis an einen Schachtboden hebt: steht der
  Schacht nur über EINER der beiden Zellen, nimmt der Quader trotzdem die höhere
  Säule.)
* `deckenOberkante()`: die Deckenplatte endet spätestens an der Unterkante der
  Bodenplatte darüber. Wird der Deckel bindend, entfällt sie ganz — von unten
  sieht man dann die Unterseite des Bodens darüber statt einer zweiten Platte.
* Türpfosten beginnen an der Boden-Oberkante, der Sturz endet an der
  **niedrigeren** Deckenunterkante und fällt danach in denselben Laibungs-Zweig
  wie eine Öffnung ohne Tür: eine Türkante IST eine offene Kante mit Rahmen.
* Simse: keine in Treppenzellen (dort ist der Boden selbst gestuft), Enden um die
  halbe Wanddicke eingezogen, und an einer Ecke mit zwei Simsen weicht der
  entlang X — sonst belegen beide dasselbe Eckstück.

### Befund 2 — das Füllstück über einer Öffnung nahm den ganzen Kantenstreifen

**Ursache** (`shared/src/dungeon2/builder.ts`, `baueKante`, alter Zweig
`obenMax > obenMin`): Über einer offenen Kante mit ungleichen Deckenhöhen wurde
ein Quader über den **ganzen** Kantenstreifen gelegt. Der Streifen liegt mittig
auf der Zellgrenze — also ragte ein halber Meter davon in den lichten Raum des
höheren Raums. Gemessen über 8 Seeds: **75 solcher Balken**, bis zu 2,5 m hoch,
0,5 m vor der Wandflucht. Zusätzlich reichte das Stück bis zur Decken-OBERkante
statt bis zur Decken-Unterkante.

**Fix — die Laibung ist eine halbe Sache:** neu `kantenStreifenHaelfte()`; das
Stück belegt nur die Hälfte auf der Seite der **niedrigeren** Zelle, von deren
Deckenplatten-Oberkante bis zur höchsten Deckenunterkante. Die andere Hälfte hat
nichts zu dichten — dort steht die Deckenplatte des höheren Raums.

### Zwei Sackgassen, beide gemessen und beide verworfen

1. **Trittflächen quer stutzen.** Naheliegend (die Stufen stecken eine halbe
   Wanddicke in der flankierenden Wand) und **falsch**: unter dem oberen Lauf
   eines Treppenhauses SIND die Stufenquader der Unterbau (`sockelStufen`), die
   flankierende Wand beginnt aber erst vier Meter höher an der Bodenoberkante
   ihrer Zelle. Der Beschnitt riss dort eine handbreite Spalte auf.
2. **Die Wand an der niedrigeren Decke enden lassen** und darüber einen halben
   Streifen aufsetzen. Auf der hohen Seite bündig — aber hinter dem Aufsatz
   bleibt ein Hohlraum, den (B2) zu Recht als Leck meldet; auf der niedrigen
   Seite klafft stattdessen eine halbmeter-tiefe Nische durch den ganzen Raum.
   Ein Wandeck Z-Fighting ist beides Mal das kleinere Übel.

Der Beschnitt entfernt seither nur, was **nachweislich** von einer Platte oder
einer Wand verdeckt ist. Deshalb auch zwei Einzugsregeln: `einzugZier` (Pfosten,
dichten nichts — eine Querwand auf EINER Seite genügt) und `einzugDicht` (Sturz —
BEIDE Seiten müssen eine Querwand haben, sonst nimmt man dem Sturz auf der
wandlosen Seite ein Stück weg, das niemand ersetzt; genau so entstand im ersten
Anlauf ein schwarzer Spalt neben der Laibung).

### Wächter

**(F) Koplanarität** (`shared/test/dungeon2-builder.ts`, 12 Seeds): gesucht sind
Flächenpaare, die (1) in derselben Ebene liegen, (2) in dieselbe Richtung
blicken und (3) sich mit echter Fläche überlappen — nur diese drei zusammen sind
Z-Fighting. Zwei koplanare Flächen, die voneinander WEG blicken, sind eine
Berührung; davon lebt jeder Quaderbau. Und nur, was man sehen kann: die Probe
einen Hauch vor der Fläche muss im lichten Raum liegen und darf nicht in einem
dritten Bauteil stecken.

| | vorher | nachher |
|---|---|---|
| waagerechte Sichtfläche (Boden/Decke/Stufe/Sims), grösser als ein Wandeck | Seed 0: `decke/wand`, **0,5 m × 4,0 m** | **0** |
| Rest (senkrechte Stirnflächen, Eckstücke) | 478 Fälle, grösste 4,00 m² | 49 Fälle, grösste 0,75 m² |

Der **Rest** ist benannt und beschränkt, nicht weggeredet: Wandzug, Laibung und
Deckenplatte laufen an derselben Zellgrenze aus und enden dort in einer Ebene.
Er ist höchstens ein Wandeck breit und liegt am Rand des Blickfelds; beide
Versuche, ihn wegzuschneiden, stehen oben.

**(G) Wandflucht** (12 Seeds): der lichte Raum jeder begehbaren Zelle —
waagerecht bis an die Wandflucht (halbe Wanddicke an jeder Kante mit Wand ODER
Türrahmen, denn der Rahmen IST dort die Wandflucht), senkrecht von der
Bodenoberkante bis zur Deckenunterkante. Kein Stück darf mit echtem Volumen
darin liegen.

| | vorher | nachher |
|---|---|---|
| Stücke vor der Wandflucht | Seed 0: `wand` ragt **0,5 m × 1,0 m** in Zelle (−14,−7) | **0** |

Zwei Ausnahmen mit eigener Regel statt eines Freibriefs: Trittflächen in
Treppenzellen (sie SIND dort der Boden) und Simse — deren Auskragung ist
gewollt und wird darum nicht übergangen, sondern **schärfer** geprüft: genau
`SIMS_TIEFE_ACHTEL` tief und nur an einer Kante mit Wand (5 400 Simse geprüft).

**(B2) verschärft.** Die Dichtheitsprobe sass bisher in der MITTE jeder Zellkante
und sah die Naht nicht, an der die Wandstreifen zweier Richtungen aneinander
stossen. Sie probt jetzt an **drei** Stellen jeder Kante, dicht bei beiden Ecken
— und genau dort hat sie die Spalte aus Sackgasse 1 gefunden (387 306 statt
129 102 Proben). Eine Probe in der Mitte misst die Wand, nicht ihre Nähte.

**Nebenbefund, nicht gefixt:** Die Regel `ebenen-abstand` vergleicht
`boden + decke` mit der Sohle darüber und lässt die **Dicke** der Bodenplatte des
Stockwerks darüber aus. Wo der Abstand knapp ist, hängt diese Platte bis zu einen
halben Meter in den Raum darunter; `NavZelle.lichteHoehe` ist dort um so viel zu
gross. (G) misst deshalb gegen die wirkliche Deckenunterkante. Das gehört in die
Layoutregel, nicht in den Bauer.

**Eingefrorene Tabellen neu ausgegeben** (`dungeon2-builder.ts`,
`golden/dungeon2-e2e.json`, `DUNGEON2_EINFRIEREN=1`): Die Geometrie ändert sich
absichtlich. Der Grundriss NICHT — `layoutPruefsumme` ist unverändert, nur
`bauPruefsumme` und die Blockschlüssel. Seed 0: 1042 → **1018 Stücke**, 963 →
939 Körper, Nav unverändert (303). Es entstehen weniger Dreiecke, nicht mehr:
weggeschnitten wird nur, was ohnehin niemand sah.

**Bildbeweis** (Vorschau auf :5901, Chromium mit ANGLE/Vulkan, je ein Vorher-Bild
zum Vergleich geschossen):
`~/.cache/wov-tripo-test/dungeon2-boden-fix.png` — Seed 11, Ebene 1, flacher
Blick über den Korridorboden bei (2, 9.4, −6), Blick 90°, Neigung 6°. Vorher lag
quer über dem Boden am Korridorende ein heller Mauerwerksstreifen; nachher ist
der Boden durchgehend dunkel, und der Blick geht bis ans Ende durch.
`dungeon2-flucht-fix.png` — Seed 7, Schrägblick eine lange Wand entlang bei
(7, 2.3, −46), Blick −6°, Neigung −7°. Vorher stand über der Öffnung ein Sturz
einen halben Meter vor der Wandflucht (im Bild als vorspringende Platte mit
eigener Untersicht); nachher ist die Wand plan. Beide Bilder auf sehr dunkle
Pixel abgesucht: **null** — keine schwarzen Spalten an Boden- oder Deckenkante.

**Lehre:** Ein Beschnitt ist kein Sparprogramm, sondern eine Behauptung — „das
verdeckt jemand anders". Wo die Behauptung nicht bewiesen ist, entsteht statt
eines Flackerns ein Loch, und das Loch sieht man erst im Bild. Die Regel, die
daraus folgt: im Zweifel weniger schneiden, und die Dichtheitsprobe dorthin
setzen, wo die Bauteile enden — nicht dorthin, wo sie am dicksten sind.

---

## 2026-08-30 · AP2/AP4 · `ebenen-abstand` verglich die falschen Flächen — Regel korrigiert, Generator nachgezogen, Golden neu eingefroren

**Aufgegriffener Nebenbefund** (Eintrag „Gefundene Lücke in `validation.ts`" vom
selben Tag). Nachgemessen ist er größer als dort beschrieben: Der Code verglich
die Decken-UNTERkante (`boden + decke`) mit der Boden-OBERkante der Zelle
darüber (`boden`). Beide Male die falsche Fläche, und beide Fehler zeigen in
dieselbe Richtung — die Regel ließ `DECKE_DICKE_STUFEN + BODEN_DICKE_STUFEN` =
4 Stufen (2 m) Überdeckung durch, die ihr eigener Text (`ARCHITECTURE.md` §3.7:
„Deckenoberkante unten < Bodenunterkante oben") verbietet.

**Was wirklich passierte, gemessen über 60 Seeds:** Die Platte hing *nicht* in
den Raum darunter — 0 von 783 gestapelten Zellpaaren. Betroffen waren 86 Paare,
und das Symptom saß eine Ebene tiefer: `deckenOberkante()` im Bauer stutzt die
Deckenplatte stillschweigend auf die Sohle des Stockwerks darüber. Wo die Regel
Überdeckung durchließ, blieb davon eine Deckenplatte der Dicke **null** (52
Fälle) oder der halben Dicke (34 Fälle) übrig — ein Quader ohne Volumen, der als
Sichtgeometrie **und** als Havok-Box in den Bau ging. Bei `hoehe = 15` unter
einer belegten Zelle wäre die gestutzte Platte sogar negativ dick geworden; kein
Seed traf das, das Format erlaubt es.

**Entscheidung (drei Teile):**

1. **`validation.ts`** vergleicht die Kanten der PLATTEN:
   `obenStufen(zelle) + DECKE_DICKE_STUFEN < bodenStufen(oben) - BODEN_DICKE_STUFEN`.
   Geprüft wird nur noch, wo es beide Platten gibt (beide Zellen begehbar); ist
   eine Seite Fels, baut `baueZelle()` dort nichts. Die Schacht-Ausnahme bleibt.
2. **`generator.ts`, neue Phase P8b „Deckenbeschnitt"**: statt alle Raumhöhen
   global auf das Maximum unter einem Stockwerk zu deckeln (ein Saal wäre dann
   ÜBERALL 5,5 m statt 7,5 m hoch, auch dort, wo über ihm nur Fels steht),
   beschneidet die Phase `decke` genau in den Zellen, unter denen wirklich ein
   Stockwerk liegt. Sie **zieht nicht, sie rechnet** — sie steht zwischen P8 und
   P9 und verschiebt keine Ziehung des Architekturstroms (W7). Unter
   `MIN_LICHTE_STUFEN` wird nicht beschnitten: das ist ein Grundrissfehler und
   gehört laut in P10, nicht still in eine Korrektur.
3. **`generator.ts`, `gesperrt`-Menge**: Über dem UNTEREN Treppenlauf darf kein
   Raum wachsen. Rechnung: 8 Stufen Anstieg + Kopfraum + Deckenplatte (2) +
   ein Stufe Fels + Bodenplatte des Stockwerks darüber (2) passen nicht in die
   16 Stufen einer Ebene. Gemessen wuchs über 60 Seeds in **24** Fällen ein Raum
   über einen Lauf; dem Lauf blieben dann 1,5 m lichte Höhe — die Spielerkapsel
   (1,8 m) kommt dort nicht durch, und `lichte-hoehe` sieht es **nicht**, weil
   `Zelle.decke` an der TIEFEN Laufkante gemessen wird. Nach der Sperre: 0.

**Folgefehler derselben Familie, im selben Zug gefunden und behoben:** Die
LAIBUNG über einer Öffnung (`builder.ts`) bekam nicht den Deckel, den der
Wandquader in `c1cc08c` bekommen hat. Nach dem Deckenbeschnitt fuhr sie einen
halben Meter in die Bodenplatte des Stockwerks darüber, und ihre Stirnfläche lag
koplanar zu deren Stirnfläche: gemessen **4,00 m × 0,50 m**, das Vierfache des in
`dungeon2-builder.ts` (F) dokumentierten Restmaßes von 1 m². `zellKanteZuQuaderGanz`
und die Laibung benutzen jetzt beide `deckelDurchStockwerkDarueber()`.

**Wächter mit Gegenprobe (beide nachweislich rot gewesen):**
- `dungeon2-invarianten.ts`: vier Fälle `hoehe = 11|12|13|14` unter einem
  belegten Stockwerk. Gegenprobe mit der alten Formel: **3 rot** (12/13/14
  blieben stumm), mit der neuen: 27/27 grün.
- `dungeon2-builder.ts` (H): „jede Deckenplatte ist 1 m dick" + „kein Bauteil und
  kein Kollisionskörper ohne Volumen", 60 Seeds. Gegenprobe am Stand vor dem Fix:
  **rot** (`Seed 9: Deckenplatte 0.5 m statt 1 m bei (14, 6.75, -10)`, 17499
  Platten), danach grün.
- (F) meldet jetzt zusätzlich den GRÖSSTEN Rest, nicht nur den ersten — die
  Schranke fällt an der Fläche, und wer dann den ersten Fall liest, sucht am
  falschen Ort.

**Golden neu eingefroren** (`DUNGEON2_EINFRIEREN=1`), weil die Layoutänderung
gewollt ist: `dungeon2-builder.ts` (Bau-Werte), `dungeon2-generator.ts`
(Wertetabelle), `shared/test/golden/dungeon2-e2e.json`.
`golden/dungeon2-hashpos-1000.json` blieb **unverändert** — der Hash hat sich
nicht bewegt, und das ist der Zeuge dafür, dass hier ein Grundriss geändert
wurde und keine Rechenregel.

**Nicht geändert:** 200 Seeds erzeugen weiterhin **0** Rückfälle auf die
einfache Form; Zyklusanteil 195/200, mehrstöckig 102/200, mit Treppe 98/200,
alle 176 Mündungen angebunden. Der Beschnitt kostet Deckenhöhe nur dort, wo ein
Stockwerk darüber liegt (235 Zellen über 60 Seeds).

---

## 2026-08-30 · M1-1 · Der Läufer: Havok unter Node — und die Treppen waren unbegehbar

**Das Paket.** `client/test/dungeon2-laeufer.ts`: eine Spielerkapsel (1,8 m ×
r 0,4 m, Steigungsgrenze 40°, Beschleunigung 8 — alles aus `PlayerController`
IMPORTIERT, nicht abgeschrieben) läuft mit echtem Havok, echtem `DungeonBauer`
(`physik: true`) und echtem `PhysicsCharacterController` mehrere Seeds ab.

**Havok läuft unter Node** — der Kopfkommentar von `dungeon2-bauer.ts` sagte
„startet unter Node nicht verlässlich". Das galt für den Standardweg: die
UMD-Fassung ruft `fetch('HavokPhysics.wasm')` und das ist unter Node ein
`ERR_INVALID_URL`. Reicht man das WASM als Puffer (`wasmBinary`), startet sie.
Damit braucht der Beweis **keinen** Browser und keine GPU — er ist ein
gewöhnlicher Testlauf.

**Gemessen wird die Strecke, nicht die Zeit** (Vault-Notiz): jeder Lauf endet an
einem Wegpunkt, die Kennzahl ist „Meter abgelaufen".

**Messzahlen, 6 Seeds** (Stand nach den Fixes): 13.212 m in 199.860
Physikschritten · 0 Durchfälle · 0 Hänger · Treppen 4/4 · Türen 55/55 (jede
Kante in BEIDE Richtungen) · 2 dokumentierte Mündungsabsätze (siehe unten).

### Was der Läufer gefunden hat (vor jedem Fix, mit Zahlen)

**(1) Die Treppen waren unbegehbar. Alle.** Zwei Läufe zu 8 Höhenstufen über je
eine 4-m-Zelle sind genau 45°; `PlayerController` setzt `maxSlopeCosine` auf 40°.
Gemessen am Lauf (−7,−4,E0), Seed 2:

| Steigungsgrenze | höchste Fußhöhe (Start 6,00 m, Ziel 8,00 m) |
|---|---|
| 40° (das Spiel) | **6,00 m** — die Kapsel bewegte sich keinen Zentimeter |
| 45° | 6,00 m |
| 46° | 7,62 m |

Der Fehler hatte kein Symptom in irgendeiner Prüfung: die Treppe stand, sah
richtig aus, war regelkonform. **Fix:** drei ungleiche Läufe 6 + 5 + 5 Stufen
(36,9° / 32,0° / 32,0°). 16 teilt sich nicht durch 3; gleich lange Läufe gibt es
bei 16 Stufen und drei Läufen nicht, und die Ebenenhöhe ist eingefrorenes Format.

**(2) Das Treppenhaus braucht eine Schachtröhre, keine Decke.** Mit drei Läufen
stieß die Kapsel am Übergang vom mittleren zum obersten Lauf mit dem KOPF in die
Deckenplatte des mittleren (je zwei Hänger in Seeds 2 und 5, in beide
Richtungen). Es gibt keinen Deckenwert, der das auflöst: unter 16 Stufen ist der
Kopfraum zu klein, bei 16 fällt die Unterseite der Platte mit der Unterseite der
Mündungswand zusammen (4,00 m × 0,50 m koplanar → (F)), über 16 ragt die lichte
Säule in die Ebene darüber → (G). **Fix:** über JEDEM Lauf steht eine
Schachtzelle. Ein Treppenhaus IST ein Schacht; ohne Platte gibt es die Frage
nicht mehr.

**(3) `NavZelle.mitte.y` log über einem Schacht ohne Bodenplatte.** Sie meldete
die Sohle des Schachts — dort steht aber niemand, darunter liegt die Rampe.
Zwei bis vier Meter Luft, und die Spawn-Platzprüfung des Servers hätte den
Spieler dort abgesetzt. **Fix:** die Standhöhe wird durch die Schächte hindurch
auf die tragende Zelle zurückgeführt.

**(4) Der Ausgang oben muss geradeaus liegen.** Die Mündung hat keine
Bodenplatte; in der Zellmitte steht man 1,25 m unter der Ebenensohle. In
Anstiegsrichtung läuft die Rampe ohne Absatz auf die Bodenplatte des Raums —
seitlich ist es eine 1,25-m-Stufe, und Havoks Charaktercontroller kennt keine
Stufenhöhe. **Fix:** der Raum oben wächst bevorzugt geradeaus, und zwar **ohne
Ziehung** (eine Ziehung hätte den Architekturstrom verschoben, W7).
**Nicht** gefixt: die übrigen Mündungskanten bleiben offen. Sie zuzumauern hat
**35 von 200 Seeds** unerreichbar gemacht (gemessen) — die Lösung gehört zur
Form der Mündung und ist ein eigener Arbeitsschritt. Der Läufer führt sie als
**dokumentierten Rest**: „Mündungsabsatz", höchstens 2 je Seed, getrennt vom
Hänger-Zähler, der auf NULL steht. Zwei Klassen, und die Trennung ist der Befund.

### Falschmessungen des Läufers, die erst der Lauf zeigte

- **Durchfallen gegen `nav.mitte.y` zu messen ist falsch:** bei einer Treppe ist
  das die Standhöhe in der ZELLMITTE, eine halbe Steigung über dem Zellboden. So
  gemessen war jeder Spieler am FUSS eines Laufs „durchgefallen" — 70 falsche
  Meldungen über fünf Seeds. Gemessen wird jetzt gegen `bodenStufen()` aus dem
  Gitter.
- **Nach `setPosition` trägt der Controller einen Schritt lang die alten
  Kontakte.** Ohne zehn Ruhebilder blieb die Kapsel am Fuß des untersten Laufs
  stehen, obwohl derselbe Aufgang von einem frisch angelegten Controller aus
  mühelos begangen wird. Ein Messgerät, das den vorigen Standort misst, misst
  nichts.

### Mitgezogen

`PlayerController` exportiert jetzt `BODY_RADIUS`, `BODY_HEIGHT`,
`STEIGUNGS_GRENZE_GRAD` und `FIGUR_BESCHLEUNIGUNG` — ein Testläufer mit
abgeschriebenen Zahlen läuft still auseinander. Die beiden Literale im
Quelltext sind durch die Konstanten ersetzt.

Angepasste Erwartungen (alle mit Begründung im Test): (E) zählt jetzt eine
Trittfläche je Höhenstufe statt acht je Zelle und prüft zusätzlich, dass die
Läufe eines Aufgangs ZUSAMMEN eine Ebene überwinden; die Mündung ist nur noch
die oberste Schachtzelle (sonst zählte der Generator-Test 492 Mündungen statt
163); die Schranke des dokumentierten Restes in (F) steigt von 60 auf 80 Fälle,
weil das Treppenhaus sechs Zellen statt drei belegt — die GRÖSSE des Restes ist
dabei von 1,00 m² auf 0,50 m² **gesunken**.

**Golden zum zweiten Mal am selben Tag neu eingefroren** (`DUNGEON2_EINFRIEREN=1`).
Sweep unverändert gut: 200 Seeds, **0** Rückfälle, 191 mit Zyklus, 102
mehrstöckig, 98 mit Treppe, 163/163 Mündungen angebunden.

---

## 2026-08-30 · AP6 · `?physik=1` war seit AP6 wirkungslos

**Befund:** Die Vorschau reichte `physik: params.get('physik') === '1'` an den
Bauer weiter — der fragt aber `scene.getPhysicsEngine()` und steigt still aus,
wenn keine Engine da ist. Die Vorschauseite hat Havok nie gestartet. Der
Schalter war also seit AP6 ein Schalter ohne Draht, und zwar **ohne Symptom**:
die Seite lief, das Bild stand, nur Kollisionskörper gab es keine.
Vault-Notiz „Messzellen brauchen Zeugen": ohne Zustandsgröße merkt man einen
wirkungslosen Schalter nie.

**Entscheidung:** `?physik=1` startet Havok (`initPhysics`, dynamisch importiert
wie im Spielclient) **vor** dem Bau, und die Meldezeile trägt seither das Feld
`Physik: Havok | aus | AUS (Start fehlgeschlagen)`. Gemessen, Seed 14:
`19 Körper (988 Formen) · Physik Havok`.

**Nebenbefund, kein Produktfehler:** Im **Dev-Server** dieses Worktrees lässt
sich das Havok-WASM nicht laden — `node_modules` ist eine Brücke in einen
anderen Worktree, Vite löst das `?url`-Import darum über `/@fs/…` auf und
liefert `application/wasm` an einen Modul-Import. Im **gebauten** Client
(`vite build` + `vite preview`) funktioniert es. Für Bilder mit Material muss
man die Texturen dann nach `client/dist/dungeon2/` kopieren, weil das
`assetFolder`-Plugin nur im Dev-Server läuft.

---

## 2026-08-31 · M1-Schritt 2 · Sichtbare Deko: `AssetManager` wiederverwendet, nicht neu gebaut

**Lücke:** Der Arbeitsauftrag verlangt „Nachladen und Platzieren der
sichtbaren Modelle im Client-Renderer", sagt aber nichts darüber, ob der
Bauer sein eigenes Ladewerkzeug bekommt oder ein vorhandenes benutzt.

**Entscheidung:** `DungeonBauer.baueDeko(quelle: DekoModellQuelle)` nimmt eine
Modellquelle als Parameter, statt selbst einen `AssetManager` zu besitzen.
`DekoModellQuelle` ist strukturell nur `{ getMasters(name) }` — die eine
Methode, die `client/src/engine/AssetManager.ts` (Phase 2, gestreute
Aussenwelt) bereits liefert: Ein Ladevorgang je Prefab, Thin-Instance-Master,
Submesh-Zusammenlegung, Metallgrad-/Wind-/Flammen-Fixups — alles bereits
vorhanden und geprüft. Ein zweites, dungeon-eigenes Ladewerkzeug wäre ein
zweiter, unabhängig geschriebener Pfad zu genau demselben Ziel.

**Grund:** `AssetManager` ist ausdrücklich scenen-, nicht bauer-gebunden
(sein Cache gilt über alle Prefabs der Szene hinweg). Ein Fackel-Modell, das
auch im Dorf oder in einer zweiten Dungeon-Instanz vorkommt, lädt dadurch
nur einmal.

**Offener Punkt, dokumentiert statt verschwiegen:** Zwei GLEICHZEITIG
laufende `DungeonBauer`-Instanzen DESSELBEN Themas teilen sich denselben
Fackel-Master — ihre Thin-Instance-Puffer überschreiben sich beim zweiten
`baueDeko()`-Aufruf gegenseitig (`master.mesh.thinInstanceSetBuffer` kennt
nur EINEN aktuellen Puffer je Mesh). Für die heutige Vorschau (eine Instanz)
und für serverseitige Dungeon-Instanzen mit je eigener Szene ist das
folgenlos; für zwei Spieler in DEMSELBEN Dungeon-Thema in DERSELBEN Szene
(client-seitiges Multi-Instancing, gibt es heute nicht) wäre es ein
Symptom ohne Fehlermeldung — genau die Klasse Fehler, die dieses Log
festhält, damit niemand sie zweimal findet.

---

## 2026-08-31 · M1-Schritt 2 · Deko-Wächter testet mit einer Attrappen-Modellquelle, nicht mit echten GLBs

**Lücke:** Das Kriterium „Ankerzahl == platzierte Instanzen (kein stiller
Schwund)" lässt offen, WIE unter Node geprüft wird — ein echter GLB-Fetch
scheitert dort (kein Vite-Devserver, kein `fetch` auf `/assets/models/…`),
wie es bereits `design/decisions-log.md`s AP6-Eintrag zu Havok für WASM
festhält.

**Entscheidung:** `DungeonDeko.baue()` hängt an einer strukturellen
Schnittstelle (`DekoModellQuelle`), nicht an `AssetManager` selbst.
`client/test/dungeon2-deko.ts` setzt eine Attrappe ein (ein `MeshBuilder`-
Würfel statt eines geladenen GLB) und prüft damit den ECHTEN Weg —
Gruppierung, Matrixbau, `thinInstanceSetBuffer`, Buchhaltung — ohne Netz.
Die sichtbare Fackel selbst ist per Bildschirmfoto geprüft
(`/home/mike/dungeon2-deko.png`, `/home/mike/dungeon2-deko-nah.png`), nicht
per Node-Test.

**Grund:** Ein Test, der `fetch` gegen einen Dev-Server unter Node
nachbildet, prüft seinen eigenen Nachbau, nicht den Bauer. Die pure
Trennung (Gruppierung/Matrixmathematik vs. Engine-Aufruf) ist dagegen
deterministisch und lief bereits als Gegenprobe rot, bevor die
`ohneModell`-Zählung eingebaut war (siehe Test „Gegenprobe: die
Schwund-Fassung färbt dieselbe Zusicherung rot").

**Nebenbefund:** Von den acht Deko-Rollen des Steingrabs hat nur `fackel`
(`CryptWallTorch`) heute ein GLB im erreichbaren Bestand
(`/home/mike/wov-dungeon-bau/ausgabe/CryptWallTorch.glb`, nach
`assets/models/` kopiert — `assets/` ist vollständig `.gitignore`t). Die
übrigen sieben Prefabnamen (`Steingrab_Geroell_A/B`, `Steingrab_Altar`,
`Steingrab_Sarkophag`, `Steingrab_Saeule`, `Steingrab_Urne`,
`piece_walltorch`, `chest_wood`, `Spawner_Skeleton`) sind laut
`themen.ts`-Kommentar ausdrücklich Platzhalter für künftige Tripo-Unikate
bzw. legacy Fremdmodelle, die auf dieser Maschine nicht vorliegen —
`DungeonDeko` zählt ihre Anker korrekt als `ohneModell`, baut aber nichts
Sichtbares (gemessen, Seed 14: 28 platziert, 74 ohne Modell). Kein Fehler
dieses Pakets — der Arbeitsauftrag erlaubt „1-2 weitere Rollen, wenn
passende GLBs im Bestand sind", und keine weitere Rolle ist es.

---

## 2026-08-31 · AP13 · Zwei Dokumentenkarten im `DungeonManager`, kein Union-Typ

**Lücke:** `data-model.md` §4.1 sagt, `sanitizeDungeonDokument(raw)` werde zum
Weichensteller (`version >= 10` → neuer Weg). Es sagt nicht, wie der
`DungeonManager` danach BEIDE Formate hält — er führt eine
`Map<string, DungeonDocument>`, und rund zwei Dutzend Stellen im Server, im
Betriebsdienst und im Editor lesen `doc.base` oder `doc.layout.rooms`.

**Entscheidung:** Eine ZWEITE Karte (`dokumente2`) neben der ersten, kein
Union-Typ in einer gemeinsamen. `getDocument()` sieht weiterhin nur
Altdokumente, `getDokument2()` nur 2.0-Dokumente, und `hatDokument(id)` ist für
die Aufrufstellen da, die nur „kenne ich das?" fragen.

**Grund:** Das Abnahmekriterium (a) aus `ARCHITECTURE.md` AP13 lautet, ein
2.0-Dokument dürfe nachweislich NIE durch den Alt-Sanitizer laufen und
umgekehrt. Mit einem Union-Typ wäre jede dieser zwei Dutzend Stellen eine
Stelle, an der ein `if` fehlen kann — und der Fehler zeigte sich als
`undefined` in einer Textausgabe, nicht als Übersetzerfehler. Mit zwei Karten
hält der Übersetzer die Aussage „das sind zwei Formate" selbst. Der Preis ist
ein zweiter Getter; er ist gering und sichtbar.

**Zwei Stellen, an denen die Weiche ein zweites Mal steht** (bewusst, nicht
aus Versehen): `upsertDocument()` lehnt ein 2.0-Dokument ausdrücklich ab, statt
es an den Alt-Sanitizer zu reichen — der würde an `base` scheitern und „ungültig"
melden, wo „falscher Weg" gemeint ist. Und `handleDungeonEditSave` in
`WovServer.ts` verzweigt, weil die beiden `upsert`-Rückgabetypen verschieden
sind.

---

## 2026-08-31 · AP13 · Die ZDO-Kennung kommt aus der Anker-Id — mit einer Faltung, die begründet werden muss

**Lücke:** AP13 verlangt „Objekt-IDs kommen aus der Layout-Position (Zellindex
+ Rolle), nie aus der Ziehreihenfolge". `DekoAnker.id` ist genau das. Aber
`ZDOID` packt Nutzerindex und Objektnummer in ein uint32 und lässt der Nummer
**22 Bit** (`server/src/zdo/ZDOID.ts`) — die Anker-Id ist ein 32-Bit-Hash.

**Entscheidung:** `ankerId & 0x3FFFFF`, und bei Kollision lineares Sondieren
(höchstens 64 Schritte, danach eine fortlaufende Kennung). `ZDOManager` bekommt
dafür `zdoidFuer(id)`, damit `serverUserId` privat bleiben kann.

**Grund:** Die Zusage, die AP13 meint, ist „dieselbe Truhe behält ihren
Zustand, auch wenn sich anderswo etwas ändert" — und die hält die Faltung: Die
Anker werden in fester Reihenfolge (nach `ankerId`, `bestuecke()` sortiert
selbst) durchlaufen, dieselbe Instanz ergibt also immer dieselbe Zuordnung. Bei
einigen hundert Ankern in vier Millionen Plätzen ist der erste Versuch
praktisch immer frei.

**Falle, die ein Lauf gezeigt hat:** `createZDOWithID()` ist für das
WIEDEREINLESEN aus dem Spielstand gebaut und setzt deshalb `isNew` und `dirty`
auf `false`. `collectDirtyZDOs()` sammelt ausschliesslich, was eines von beiden
trägt. Ohne die zwei Zeilen, die beide Flags danach wieder setzen, stünde der
Spieler in einer Instanz ohne Truhen — ohne Fehlermeldung, ohne Warnung, ohne
irgendetwas Auffälliges.

---

## 2026-08-31 · AP13 · `ROLLEN_MIT_ZDO` ist die EINE Trennlinie zwischen Server und Client

**Lücke:** `data-model.md` §4.3 sagt, 2.0 vergebe ZDOs „nur für Bewegliches/
Interaktives: Türen, Truhen, Fackeln, Spawner, Kreaturen". Seit M1-Schritt 2
baut der Client aber ALLE Deko-Anker selbst als Thin Instances
(`DungeonDeko`) — Fackeln eingeschlossen. Beides zusammen hiesse: Eine Truhe
steht zweimal da, einmal als Instanz und einmal als Entity.

**Entscheidung:** `shared/src/dungeon2/themen.ts` führt
`ROLLEN_MIT_ZDO = ['truhe', 'spawner']`. Der Server materialisiert genau diese
Rollen, der Client lässt genau diese Rollen beim Deko-Bau aus
(`baueDeko(quelle, ausgelasseneRollen)`). Fackeln, Geröll, Altar, Sarkophag,
Säule und Urne haben keinen Zustand und bleiben Client-Geometrie.

**Grund:** Die Liste ist eine Trennlinie, und eine Trennlinie darf nur an
einer Stelle stehen. Zweimal geschrieben wäre die Doppelung kein
Übersetzungsfehler, sondern eine doppelte Truhe im Bild — und niemand hätte
etwas falsch gemacht.

**Nebenbefund, gemessen (Seed 4242/77/99):** 83 Anker, davon genau **einer**
mit Zustand (`TreasureChest_meadows`). Ein Spawner-Anker kam in diesem Layout
nicht vor. Die ZDO-Zahl je Instanz fällt damit von **306** (Altbestand,
34-Raum-ForestCrypt) auf **1**. `data-model.md` schätzte „Größenordnung ein
Fünftel"; die Schätzung war viel zu vorsichtig, weil sie noch damit rechnete,
dass Fackeln ZDOs bleiben.

---

## 2026-08-31 · AP13 · Der Ladebildschirm fällt auf `dungeonBereit`, und der Vorhang bekommt eine Kennung

**Lücke:** Die Vault-Notiz „Ladebildschirm hängt am Gelände" beschreibt den
gelösten Fall: Der Auto-Sprung (`?dungeon=`) wartet, bis `terrain.ready` steht,
damit der Vorhang vorher fällt. Für 2.0 genügt das nicht — wer über Taste E
oder den Admin-Befehl mitten im Weltaufbau eintritt, steht in einer fertig
gebauten Instanz unter einem Vorhang bei 1 %.

**Entscheidung:** `Dungeon2Instanz.betrete()` löst auf, sobald
`DungeonBauer.dungeonBereit` erfüllt ist; erst dann ruft `main.ts`
`loading.update(1, true)`, taut die Figur auf und setzt sie an ihren Platz.
Der Ladebildschirm bekommt zusätzlich die Kennung `loading-screen`.

**Grund für die Kennung:** Ohne sie liesse sich der Vorhang von aussen nur an
seinem TEXT erkennen — und der ist übersetzt. Eine Messung, die an der Sprache
hängt, misst irgendwann die Sprache. Der Ende-zu-Ende-Lauf prüft damit beides:
`vorhangSteht: true` vor dem Betreten (bei `terrain.ready = false`,
Ladefortschritt 1,2 %) und `vorhangWeg: true` danach.

**Reihenfolge, die nicht umgestellt werden darf:** `DungeonAtmosphaere.betrete()`
hängt die Postprocessing-Kette des Spiels von der Kamera AB, `verlasse()` hängt
dieselbe wieder an. `Dungeon2Instanz.verlasse()` gibt sie deshalb ZUERST zurück
und reisst erst danach ab — andernfalls liesse ein Fehler beim Abriss die
Oberwelt ohne Tiefenunschärfe zurück, und man sähe es zwei Räume später.

---

## 2026-08-31 · AP13 · Der Ende-zu-Ende-Lauf betritt über den Admin-Befehl, nicht über `?dungeon=`

**Lücke:** Der naheliegende Weg für einen Ende-zu-Ende-Lauf ist die Adresse
`?dungeon=<id>` — der Client springt dann von selbst hinein.

**Entscheidung:** `tools/dungeon2-e2e.mjs` öffnet die Seite OHNE den Parameter
und schickt `dungeon enter <id>` als Admin-Befehl, sobald der Socket steht.

**Zwei Gründe:** (a) Der Auto-Sprung wartet auf `terrain.ready`. In einer frisch
erzeugten Radialwelt ohne Spielstand dauert das Gelände beliebig lange —
gemessen: nach 300 s stand der Ladefortschritt bei 1,2 %. Der Lauf hätte damit
die Oberwelt gemessen statt den Dungeon. (b) Der Admin-Weg ist der SCHÄRFERE
Fall: Dort steht der Ladebildschirm beim Betreten noch, und nur die neue
Auflösung über `dungeonBereit` kann ihn fallen lassen. Der Auto-Sprung hätte
den Fehler, den dieses Paket behebt, gar nicht auslösen können.

**Drei Dinge, die der Lauf über die Umgebung gelernt hat und die notiert
gehören, weil sie sonst jeder wieder findet:**

1. **Vite muss aus `client/` gestartet werden.** `vite.config.ts` sagt
   `root: '.'`; aus der Wurzel heraus findet Vite die `index.html` nicht und
   liefert eine leere Seite mit genau EINEM 404 — ohne jeden Hinweis worauf.
2. **Der Worktree-Symlink auf `@babylonjs` bricht Havok.** `node_modules/@babylonjs`
   zeigt auf `wov-wt-bundle`; Vite liefert `HavokPhysics.wasm` dann über
   `/@fs/…` mit MIME `application/wasm` aus, und der Modulimport scheitert an
   der strengen MIME-Prüfung. Folge: `[physics] Havok konnte nicht geladen
   werden`, keine Kollision, kein begehbarer Dungeon. Behelf auf dieser
   Maschine: die Scope-Verknüpfung durch ein echtes Verzeichnis mit
   Einzel-Symlinks ersetzen und `@babylonjs/havok` (4,2 MB) wirklich hineinkopieren.
   Kein Repo-Änderung, eine Umgebungsfrage — aber eine, die aussieht wie ein
   Fehler des Bauers.
3. **Der Client gibt nach drei Verbindungsversuchen auf** und geht zur Anmeldung
   auf der Webseite (`main.ts`, `onDisconnected`). Trifft der erste Versuch den
   Vite-Proxy, bevor dessen WebSocket-Weiterleitung steht, ist der Lauf
   unwiderruflich weg — nicht weil etwas kaputt ist, sondern weil der Client
   sich genau richtig verhält. Der Lauf wiederholt deshalb bis zu viermal.

**Die Anmeldeschranke wird nicht umgangen, sondern bedient:** Das Startskript
des Laufs würfelt das Sitzungsgeheimnis selbst und reicht es in
`createWovServer({ sessionSecret })`; damit kann derselbe Prozess über
`tokenAusstellen()` ein GÜLTIGES Token ausstellen. Ein zurechtgebasteltes Token
täte es auch (der Server vergibt dann eine frische Identität), aber dann prüfte
der Lauf einen Rückfallpfad statt des Wegs, den ein Spieler geht.

**Messzahlen des grünen Laufs** (Chromium headless, ANGLE/Vulkan auf einer
RX 7900 XT — kein SwiftShader, der Renderer-String wird geprüft):
Prüfsumme Server `b852b8a2` == Client `b852b8a2`, 0 Layout-Fehler,
**744 ms bis baubereit**, 818 ms bis vollständig, 15 Blöcke, 29 Meshes,
11 112 Dreiecke, 15 Havok-Körper aus 868 Formen, ein Material, Deko 23 gesetzt
/ 60 ohne Modell, gelaufene Strecke 1,27 m (die Figur läuft in die Gangwand —
die Kollision steht), y bleibt bei 0,003 (kein Durchfallen),
0 Konsolenfehler, 0 unbehandelte Ausnahmen, 0 Prefab-Fehler, 0 ZDO-Fehler.
Beweisbild: `~/.cache/wov-tripo-test/dungeon2-ingame.png`.

---

## 2026-08-31 · Hygiene · Vierzehn Dungeon-2.0-Tests liefen nur von Hand

**Befund:** Sämtliche `shared/test/dungeon2-*.ts` und `client/test/dungeon2-*.ts`
waren in `scripts/run-tests.mjs` nicht eingetragen — vom Schichtenwächter über
den Determinismus-Prüfstand bis zum Havok-Läufer. Alle vierzehn zusammen
brauchen unter einer Minute.

**Entscheidung:** Alle in `KERN`, mit je einer Begründungszeile nach Hausbrauch.
Ausgenommen bleibt `shared/test/dungeon2-browser-check.ts`: Das ist kein
Node-Test, sondern der Bündel-Einstieg der Browser-Seite des
Determinismus-Prüfstands — er benutzt `document` und stürbe unter `tsx` sofort.
Die Ausnahme steht jetzt im Kopfkommentar des Runners, neben den vier anderen.

**Grund:** Ein Test, der da ist, grün ist und den niemand fährt, ist die
gefährlichste Sorte: Er beruhigt, ohne zu prüfen. Der Zeitgewinn des
Nicht-Fahrens war knapp fünfzig Sekunden.

**Gesamtlauf danach:** 88 von 91 grün. Die drei roten sind alle
umgebungsbedingt und älter als dieses Paket: `tools/test/manifest-vollstaendig.ts`
und `server/test/f17-figurenwahl.ts` scheitern daran, dass `assets/models/` auf
dieser Maschine bis auf eine Datei leer ist (Mike sichert die Modelle
ausserhalb des Repos), und `server/test/k1-konten.ts` erwartet den Fehlercode
`benutzername-vergeben`, wo die Konten-API `username-taken` liefert.

---

## 2026-08-31 · Fehler · Der Teleport in `steingrab-2` riss die Verbindung ab

**Der Befund von aussen:** `?dungeon=steingrab-2` auf play.dev. Serverseitig
stand alles: `54 stamps, 1154 pieces, 333 nav cells`. Im Client keine einzige
`[dungeon2]`-Zeile, dann ein Reconnect zurück in die Oberwelt
(„bestehende Weltsysteme werden weiterverwendet", „0 Eingänge"). Der
Ende-zu-Ende-Lauf war grün.

**Die Ursache** (`server/src/WovServer.ts`, `teleportPeer`): Die drei
Layout-Seeds gingen mit `writeInt32` über die Leitung. Sie sind aber **uint32**
— `dungeon2.mische()` erzeugt sie so, und `dungeon create2` mischt damit
Material- und Deko-Seed. `Buffer.writeInt32LE` **wirft** über 2^31-1, statt
abzuschneiden. Für `steingrab-2` ist der Deko-Seed 3 333 651 121; die Ausnahme
fiel mitten in den Paketaufbau, `NetManager` wertete sie als Paketfehler und
**trennte die Verbindung**:

    [NetManager] Paketfehler von Viking: The value of "value" is out of range.
    It must be >= -2147483648 and <= 2147483647. Received 3333651121
    — Verbindung wird getrennt

Der Client hing also nie. Er war ausgeworfen. Der Firefox-Abbruch in
`isInFrustum`/`_evaluateActiveMeshes`, den man daneben sah, war nicht die
Ursache — der längste gemessene Frame-Stillstand beim Wechsel liegt bei
**309 ms**.

**Die Behebung:** `writeUInt32`. Die Leitung ändert sich nicht — vier Bytes
little-endian, dieselben Bits; der Client liest sie ohnehin schon als
`readInt32() >>> 0`.

**Warum der grüne Lauf nichts wusste** — und das ist die eigentliche Lehre:
Beide Prüfstände wählten ihre Seeds **von Hand und klein**. `tools/dungeon2-e2e.mjs`
nahm `{4242, 77, 99}`, `server/test/g9-dungeon2-e2e.ts` dieselben. Der Weg, den
ein Spieler geht, mischt sie dagegen mit `mische()` — und damit liegt jeder
zweite Seed über 2^31-1. Eine handgewählte Zahl im Prüfstand, wo im Betrieb
eine gewürfelte steht, ist eine Prüfung, die genau den Wertebereich auslässt,
in dem der Fehler wohnt.

**Wächter, damit es nicht wiederkommt:**

1. `g9-dungeon2-e2e.ts` mischt die Seeds jetzt wie `dungeon create2` und prüft
   zuerst, dass **mindestens einer über 2^31-1 liegt** (der Zeuge für den
   Zeugen), danach, dass Material- und Deko-Seed **unversehrt** am anderen Ende
   ankommen. Negativ geprüft: mit `writeInt32` bricht der Test mit genau der
   Meldung von wov-dev ab.
2. `tools/dungeon2-e2e.mjs` kennt `--ausNormalwelt`: Betreten erst **nach**
   `terrain.ready` und weggeblendetem Ladebildschirm — der Weg, den Mike ging.
   Dazu `DG2_SEED` (mit `DG2_SEED=2` entsteht exakt `steingrab-2`), ein
   Reconnect-Zähler über den Wechsel (0 verlangt) und ein eigener
   rAF-Zeuge für den **längsten Frame-Stillstand** (Grenze 2000 ms; Firefox
   beendet Skripte bei 10 s, Chromium hält länger durch und zeigt denselben
   Fehler deshalb NICHT).

**Nebenbefund im selben Journal, eigene Ursache:** „0 ZDOs, 1 anchor without a
registered prefab". Die Truhen-Tabelle von `steingrab` führte
`chest_wood` — das ist der **Modellname** des Registry-Eintrags, nicht sein
**Prefabname** (`HolzTruhe`). `findPrefabByName` fand nichts, und
`Materialisierung2` lässt einen unbekannten Anker ausdrücklich weg. Die einzige
Truhe von `steingrab-2` fehlte damit ganz. Behoben; Wächter in
`shared/test/dungeon2-decorator.ts`: Jedes Prefab einer Rolle aus
`ROLLEN_MIT_ZDO` muss registriert sein — und nur die, denn die übrige Deko baut
der Client aus GLBs und braucht keinen Registry-Eintrag.

**Messzahlen nach der Behebung** (Chromium headless, ANGLE/Vulkan, RX 7900 XT,
`DG2_SEED=2` = `steingrab-2`):

| | direkt (Ladebildschirm) | aus der Normalwelt |
|---|---|---|
| Szene vor dem Wechsel | 17 Meshes, 1 Chunk | 265 Meshes, 81 Chunks, `terrain.ready` |
| Reconnects beim Wechsel | 0 | 0 |
| längster Frame-Stillstand | 244 ms | 309 ms |
| bis baubereit | 574 ms | 574 ms |
| Prüfsumme Server == Client | `1a875b7f` | `1a875b7f` |
| Materialisierung | 54 Stempel, 1154 Stücke, 333 Navzellen, **1 ZDO** (vorher 0) | dito |
| gelaufene Strecke | 1,28 m | 1,28 m |

Vorher, mit demselben Seed und derselben Oberwelt: Abbruch, `imDungeon: false`,
Reconnect nach 1,0 s.

---

## 2026-08-31 · Vier Befunde aus dem Durchlauf durch `steingrab-2` auf play.dev

Mike ist durch `steingrab-2` gelaufen und hat vier Dinge gemeldet. Drei davon
haben **dieselbe Ursache in verschiedenen Verkleidungen**, und die gehört
zuerst notiert, weil sie sonst ein viertes Mal auftritt:

> **Der Vorschauweg und der Spielweg sind zwei Wege, und nur einer wird
> angesehen.** `dungeon2Preview.ts` verdrahtet den `LightPool` an
> `bauer.lichtquellen()`, das Spiel tut es nicht. Die Vorschau hat keine
> Spielfigur, das Spiel schon. Die Vorschau hat ein eigenes Licht, das Spiel
> hat `Lighting`. Jedes Mal, wenn wir etwas „in der Vorschau gesehen" haben,
> haben wir den anderen Weg NICHT gesehen — und der andere Weg ist der, den
> Mike geht.

Konsequenz für die Prüfstände: Die drei neuen Wächter stehen in
`tools/dungeon2-e2e.mjs` und nicht in einem Modultest. Ein Modultest hätte
alle drei Fehler mitgetragen, weil alle drei GRÜNE Bauteile falsch
zusammengesteckt waren.

### Befund 1 — die Füße stecken im Boden

**Ursache** (`client/src/player/PlayerController.ts:342`, alte Fassung):

    this.avatar.setBodenSonde((x, z) => this.world.getGroundHeight(x, z));

Die Fußanpassung des Rigs (`AvatarRig.messeFussVersatz`) maß gegen die
**Heightmap der Oberwelt** — fest, ohne Fallunterscheidung. In einer Instanz
beschreibt die Heightmap das Gelände über bzw. neben dem Grab und nicht dessen
Bodenplatte. Der Versatz wurde damit zur Differenz zweier völlig
unterschiedlicher Flächen und lief in den Deckel `FUSS_ABSENK_MAX = 0,35 m`.

Das ist der Grund, warum es wie ein Kunstfehler aussah und nicht wie ein
Absturz: 0,35 m ist knöcheltief. Ein Meter wäre aufgefallen, zehn Zentimeter
hätte niemand gemeldet.

**Behebung:** `bodenFuerFuesse()` — im Dungeon dieselbe Sonde, die zwanzig
Zeilen tiefer schon die KAPSEL trägt (`bodenHoeheUnter`, Havok-Strahl gegen die
Instanzkörper), in der Oberwelt weiter die Heightmap. Kein Rückfall auf die
Heightmap, wenn der Strahl nichts trifft: Dann gilt die Haltehöhe, mit der auch
die Kapsel wartet — ein Rückfall wäre genau der Fehler von oben.

**Wächter:** `__dg2live.fuesse()` liefert `sohleY` (tieferer Fußknochen minus
der beim Laden gemessenen `knoechelHoehe` — der Knochen als Zeuge, nicht die
Bounding-Box, s. Vault „Begrenzungskörper lügt bei Skinning"), `bodenY` und den
Abstand. Der Lauf verlangt ±0,06 m.

**Einschränkung, die notiert gehört:** Auf DIESER Maschine ist `assets/models/`
bis auf eine Datei leer, es lädt also kein Figuren-GLB, `fussKnoten` bleibt
leer und `messeFussVersatz()` liefert konstant 0. Der lokale Lauf kann diesen
Befund deshalb **nicht** rot färben — er belegt nur, dass die Messkette steht.
Die Gegenprobe ist auf play.dev gefahren worden.

### Befund 2 — die Fackeln erzeugen kein Licht

**Ursache** (`client/src/main.ts:1736`, alte Fassung):

    lightPool = new LightPool(scene, (x, z, r) => entities?.lichtquellen(x, z, r) ?? []);

Der Pool wird EINMAL beim Weltaufbau angelegt und fragt fest die
ZDO-Entitäten. Die Fackeln eines 2.0-Grabs sind aber ausdrücklich keine ZDOs —
`ROLLEN_MIT_ZDO` führt nur `truhe` und `spawner`, alles andere baut der Client
als Thin Instances (die Entscheidung steht weiter oben in dieser Datei). Der
Pool fand also in einem Grab mit **50 Fackeln** genau **0 Quellen**:
`fackeln 0/16 array`.

Bemerkenswert ist, wie widerspruchsfrei das aussah. Der Pool war da, das Array
war da, die Plätze waren da, die Fackeln standen im Bild — es fehlte nur die
Liste, und eine leere Liste sieht aus wie ein Dungeon ohne Fackeln.

**Behebung:** Die Quelle des Pools ist umschaltbar. Steht eine 2.0-Instanz,
liefert `Dungeon2Instanz.lichtquellen()`, sonst der `EntityManager`. Die Weiche
sitzt im Pool-Konstruktor und damit an EINER Stelle; `__dbg.fackeln()` nennt
seit heute zusätzlich, WELCHE Liste gerade zählt — vorher fragte die Diagnose
fest `entities` und log ihrerseits.

**Wächter, Gegenprobe gefahren:** Mit der alten Zeile meldet der Lauf
`Fackeln: 37 Quellen im Umkreis (50 im Grab), 0/16 brennen — Pool 0/16 array`
und wird ROT. Mit der neuen: `16/16 brennen`.

### Befund 3 — die Fackeln schweben gleichmäßig vor der Wand

**Ursache** (`shared/src/dungeon2/generator.ts`, `setzeAnker`, Muster
`wandfackeln` und `wandnische`):

    setze(wk.zelle, ANKER_ORT.Wand, 'fackel', 4, 4, 5, ...)

`u = 4, v = 4` ist die **Zellmitte**. Eine Zelle ist 8 Achtel = 4 m, die Wand
ist `WAND_DICKE_ACHTEL = 2` dick und liegt **mittig auf der Zellgrenze**
(`kantenStreifen`), ihre Fläche also ein Achtel innerhalb der Zelle. Von der
Mitte bis dorthin sind es 3 Achtel = **1,5 m**.

**Gemessen vor dem Fix**, waagerechter Abstand jedes Wandankers zur nächsten
Kollisionsfläche auf Ankerhöhe, über 40 Seeds und 1914 Anker:
Median **1,500 m**, Maximum **1,500 m**. Über vier einzeln geprüfte Seeds
(2, 1234, 7, 99) dasselbe Bild. Gleichmäßig heißt systematisch — Mikes
Formulierung war schon die Diagnose.

**Behebung:** `wandAnkerVersatz(kante)` in `cells.ts`, dort wo
`WAND_DICKE_ACHTEL` wohnt und die Wandquader gerechnet werden. Nord/Ost →
7 Achtel, Süd/West → 1 Achtel, die Achse ENTLANG der Wand bleibt auf 4 (dort
ist die Mitte richtig). Der Generator schreibt die Zahl nicht mehr selbst hin.

**Nach dem Fix:** Median **0,000 m**, Maximum **0,000 m** über dieselben
1914 Anker.

**Wächter:** `shared/test/dungeon2-generator.ts`, Kriterium (h). Er misst
gegen die GEBAUTE Kollisionsgeometrie und nicht gegen `wandAnkerVersatz()` —
sonst prüfte die Funktion sich selbst. Gegenprobe gefahren: mit dem alten
`4, 4` meldet er `schlimmster Abstand 1.500 m, Median 1.500 m ueber 1914 Anker`
und wird rot.

**Golden neu eingefroren, mit Begründung:** Drei Tabellen wandern
(`dungeon2-builder.ts`, `dungeon2-generator.ts`, `golden/dungeon2-e2e.json`).
Die Rechtfertigung steht in den Zahlen NEBEN den Prüfsummen: Stücke, Körper,
Navzellen, Stempel, Zellen, Türen und Ankerzahl sind **Spalte für Spalte
unverändert** (1018/939/303, 35/303/16/91, …). Es hat sich kein Quader bewegt
und kein Anker ist dazu- oder weggekommen — dieselben Anker an anderen
Stellen. Wäre eine dieser Zahlen mitgewandert, wäre die Neueinfrierung nicht zu
rechtfertigen gewesen. **Die ZDO-Kennungen bleiben unberührt:** `ankerId()`
geht aus Zelle, Ebene, Ort und Rolle hervor, nicht aus `u`/`v` — eine geöffnete
Truhe behält ihren Zustand.

### Befund 4 — Grundhelligkeit je Dungeon (Feature)

**Was es ist:** `ambientLicht` (0..1) — der Anteil der Eigenhelligkeit
(Sonne, Hemisphärenlicht und Umgebungsintensität aus `innenUmgebung`), der
drinnen ankommt. 1 = wie bisher, 0 = stockdunkel, nur die platzierten Quellen.

**Warum ein Faktor und keine zweite `innenUmgebung`:** Der Umgebungsname trägt
ein ganzes Bild (Nebelfarbe, Himmel, Sonnenfarbe). Ein Zwilling „Crypt, aber
dunkler" wären zwei Einträge, die bei der nächsten Änderung an einem
auseinanderlaufen. Ein Faktor bleibt eine Zahl mit einer Bedeutung.

**Warum ALLE DREI Regler gedämpft werden** (Sonne, Hemisphäre,
`scene.environmentIntensity`): Zwei hätten bei 0 kein dunkles Grab ergeben,
sondern ein Grab mit Himmelsschimmer auf jeder Wand — und man hätte den Rest
im Material gesucht. Gemessen bei `ambient=0`: Sonne 0, Hemisphäre 0,
Umgebung 0, und die Fackeln brennen weiter (16/16).

**Warum die Dämpfung in `Lighting.apply()` steht und nicht beim Betreten:**
`apply()` schreibt beide Intensitäten in JEDEM Bild neu aus der Umgebung. Ein
einmal gesetzter Wert wäre einen Frame später überschrieben — der Schalter
sähe eingebaut aus und täte nichts (Vault: „Messzellen brauchen Zeugen").

**`null` ist nicht `1`:** Bei `null` fasst `Lighting` den Regler gar nicht
mehr an. Nur so kann ihn jemand anders benutzen, ohne dass ihn ein Dungeon,
den man vor zehn Minuten verlassen hat, überschreibt.

**Versionierung.** Die Dokumentfassung springt von 10 auf **11**, und die
WEICHE wird davon getrennt: `DOKUMENT_2_AB_VERSION = 10` ist eingefroren und
entscheidet allein, ob ein Dokument zum Format 2.0 gehört.

Ohne diese Trennung wäre `istDokument2()` mit der Fassung mitgewandert, und
sämtliche gespeicherten Fassung-10-Dokumente auf wov-dev wären still aus dem
Format herausgefallen — `istDokument2() === false` heißt „Altformat", der
Alt-Sanitizer scheitert an `base`, und die Meldung hieße „ungültig", wo
„ältere Fassung" gemeint ist.

Die Anhebung 10 → 11 ist **wertneutral**: Ein altes Dokument hat das Feld
nicht, `leseAmbientLicht` liefert `undefined`, und `undefined` heißt „nimm die
Vorgabe des Themas" — die auf dem heutigen Wert steht. Genau deshalb ist das
Feld optional und nicht mit einer Vorgabe belegt: Ein hineingeschriebener Wert
wäre eine Behauptung über einen Dungeon, die niemand aufgestellt hat, und
würde eine spätere Änderung der Themen-Vorgabe stumm überstimmen.

**Ein kaputter Wert macht das Dokument nicht ungültig.** Text, `NaN`, `-3`,
`17` fallen auf „nicht gesetzt" zurück bzw. werden geklemmt. Die Asymmetrie
der Folgen entscheidet: Ein Grab, das wegen einer verrutschten
Helligkeitszahl nicht mehr lädt, ist ein verlorener Spielstand; eines mit der
Helligkeit von gestern ist ein Grab.

**Die 0 ist der Fall, an dem schlampiger Code scheitert.** `?? vorgabe`,
`|| 1`, `Number('')` — alle drei machen aus der 0 klammheimlich die Vorgabe.
Deshalb prüft der Admin-Befehl auf ANWESENHEIT des Arguments, der Deskriptor
trägt die AUFGELÖSTE Zahl statt eines optionalen Feldes (der Client müsste
sonst „fehlt" von „ist 0" unterscheiden), der Serverschreiber setzt als
Ersatzwert `1` und nicht `0`, und drei Tests prüfen die 0 ausdrücklich.

**Weg der Zahl:** `ThemenProfil.ambientLicht` (Vorgabe) bzw.
`DungeonDokument2.ambientLicht` (Überschreibung) → `ambientLichtVon()` → 
`LayoutDeskriptor` → Teleportpaket (`writeFloat32`, angehängt, `remaining`
entscheidet) → `Dungeon2Deskriptor` → `DungeonAtmosphaere` → `Grundlicht`.

`Grundlicht` ist eine Schnittstelle mit EINER Methode und kein `Lighting`-
Import: Die Vorschau hat kein `Lighting`, sondern ein `HemisphericLight`, und
sie soll denselben Regler bedienen — sonst misst man in der Vorschau eine
Zahl, die im Spiel eine andere Wirkung hat.

**Bedienung:**

    dungeon create2 steingrab 2 steingrab-dunkel 0     # stockdunkel
    dungeon create2 steingrab 2 steingrab-2            # Vorgabe des Themas
    /dungeon2.html?seed=1234&ambient=0                 # Vorschau
    DG2_AMBIENT=0 node tools/dungeon2-e2e.mjs          # Prüfstand

### Messzahlen der grünen Läufe (Chromium headless, ANGLE/Vulkan, RX 7900 XT, `DG2_SEED=2`)

| | direkt | aus der Normalwelt | `DG2_AMBIENT=0` |
|---|---|---|---|
| Prüfsumme Server == Client | `b5cb1d88` | `b5cb1d88` | `b5cb1d88` |
| bis baubereit | 593 ms | 538 ms | 562 ms |
| längster Frame-Stillstand | 330 ms | 293 ms | 303 ms |
| Blöcke / Meshes / Körper | 19 / 30 / 16 | 19 / 30 / 16 | 19 / 30 / 16 |
| Fackeln im Grab / im Umkreis / brennend | 50 / 37 / **16 von 16** | 50 / 37 / 16 | 50 / 37 / 16 |
| Sohle über Boden | 0,003 m | 0,003 m | 0,003 m |
| Sonne / Hemisphäre / Umgebung | 0 / 0,886 / 1 | 0 / 0,868 / 1 | **0 / 0 / 0** |
| gelaufene Strecke | 1,28 m | 1,27 m | 1,28 m |
| Konsolenfehler / ZDO / Prefab | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

(Die Sonnenintensität ist in `Crypt` ohnehin 0 — die Innenumgebung hat keine.
Das Grundlicht kommt dort aus Hemisphäre und Umgebung, und genau die beiden
fallen bei `ambient=0` auf null.)

### Nachweis auf play.dev (wov-dev), 31.08.2026

**Testcharakter, kein Konto, kein Passwort.** Der Client prüft an einem
Sitzungstoken nur die FORM und das Ablaufdatum (die Signatur kann er nicht
prüfen, das Geheimnis liegt im Server). Ein formgerechtes, nicht abgelaufenes,
aber ungültig signiertes Token passiert diese Weiche — und der Server würfelt
daraufhin eine FRISCHE Identität (`NetManager`, F3). Der Name kommt dann aus
`?name=`. Mikes Charakter und `steingrab-7` sind unberührt geblieben.

Zwei Fallen aus diesem Lauf, weil beide Zeit gekostet haben und beide
wiederkommen:

1. **Basic-Auth NICHT in die Adresse einbetten**, sondern über Playwrights
   `httpCredentials`. Eingebettete Zugangsdaten vererben sich auf Vites
   `/@fs/`-Adressen, und `fetch` verweigert eine URL mit Zugangsdaten — Folge:
   `[physics] Havok konnte nicht geladen werden`, also ein Grab ohne
   Kollision und eine Fußmessung ohne Boden. Sieht aus wie ein Fehler des
   Bauers, ist einer der Messanordnung. (Ergänzt die Vault-Notiz
   „Browser-Basic-Auth eingebettete Zugangsdaten".)
2. **Je Lauf ein eigener Name.** Zweimal derselbe Name, während der vorige Peer
   noch hängt, heißt „Name already in use" — und der Lauf stirbt in einem
   Timeout, der nach einem kaputten Client aussieht.

**Gegenprobe zu Befund 1, gemessen am NOCH NICHT ausgerollten Stand** (das
Fenster dafür gibt es nur einmal): Die Figur stand in `steingrab-2` auf
y = 0,00; `world.getGroundHeight()` an derselben Stelle lieferte
**−55,47 m**. Das war die Fläche, gegen die die Fußanpassung maß — 55 Meter
unter dem Boden, auf dem die Figur stand. `messeFussVersatz()` verlangte
folglich in jedem Bild die volle Absenkung und lief in den Deckel
`FUSS_ABSENK_MAX`; deshalb war der Fehler auch konstant und nicht schwankend.

**Nach dem Ausrollen, gemessen an derselben Stelle:**

| | |
|---|---|
| Renderer | ANGLE (AMD Radeon RX 7900 XT, RADV NAVI31) — kein SwiftShader |
| Prüfsumme Server == Client | `185c11a6` |
| Sohle über Boden | **−1,3 · 10⁻⁷ m** (Sonde `bodenY` = 0,000) |
| Fußversatz | −0,00007 m (vorher: der Deckel −0,35 m) |
| Fackeln | 50 im Grab, 31 im Umkreis, **16 von 16 brennen** — HUD `fackeln 16/16 array` |
| Grundhelligkeit `steingrab-2` | ambientLicht 1, verdrahtet, Sonne 0 / Hemisphäre 0,868 / Umgebung 1 |
| Grundhelligkeit `steingrab-dunkel` | ambientLicht 0 → Sonne 0 / Hemisphäre **0** / Umgebung **0**, Fackeln weiter 16/16 |

Die Zeile `fackeln 16/16 array` im Debug-Overlay ist die unmittelbare
Gegenschrift zu Mikes `fackeln 0/16 array`.

**Beweisbilder:** `~/.cache/wov-tripo-test/dungeon2-fixes4.png` (Testcharakter
vor einer Wandfackel: Fackel AN der Wand, Lichtschein auf dem Mauerwerk, Füße
flach auf der Bodenplatte) und `~/.cache/wov-tripo-test/dungeon2-dunkel.png`
(dieselbe Stelle in `steingrab-dunkel`, `ambient=0` — nur noch Fackellicht,
die Figur als Schattenriss, die Nachbargänge schwarz).

**Angelegt für den Nachweis:** `steingrab-dunkel`
(`dungeon create2 steingrab 2 steingrab-dunkel 0`) — dasselbe Layout wie
`steingrab-2`, nur ohne Eigenhelligkeit. Kann gelöscht werden
(`dungeon delete steingrab-dunkel`), ist aber als lebendes Beispiel des
Merkmals nützlich.

---

## 31.08.2026 — Grafischer Vollausbau (M2): Parallax, Godrays, SSR und die PrePass-Frage

Der Beschluss „Vollausbau Stufe 1: SSAO, Godrays, SSR, Parallax"
(ARCHITECTURE §W9) wird eingelöst — mit einem Ergebnis, das von der
Erwartung abweicht: **Zwei der drei nachgezogenen Effekte gehen in die Stufe
Hoch, der dritte nicht.** Stufe Mittel bleibt unverändert bei Umfang und
Tempo von M1; das war Bedingung und ist gemessen (siehe Tabelle).

### Der Messstand — und warum die erste Messreihe wertlos war

`tools/pw-dungeon2-effekte.mjs`: eigener Vite, Vorschauseite, feste Kamera,
je Variante 600 Bilder, vier **verschränkte** Durchgänge (die Lehre aus
`PostProcessing.setSSAO()`: die ersten Läufe werden systematisch schneller).

**Drei** Fehler dieses Messstands haben je einen Lauf gekostet, und alle drei
sind so gebaut, dass sie wie ein Erfolg aussehen:

1. **Bildschirmsynchronisation.** Der erste Lauf meldete für ALLE elf
   Varianten exakt `16,70 ms / 59,9 fps` — von „Niedrig" bis „Hoch mit
   allem". Das ist der 60-Hz-Takt von `requestAnimationFrame`, nicht das
   Bild. Eine Tabelle voller identischer Zahlen liest sich als „die Effekte
   kosten nichts". Behoben mit `--disable-gpu-vsync --disable-frame-rate-limit`.
2. **Die Kamera stand im Fels.** Die Messstelle wurde aus dem nächsten
   Lichtschacht berechnet, aber auf Spawn-Höhe gesetzt — bei einem Schacht
   im Stockwerk darüber steht die Kamera dann in einer Wand. Bildzeit
   0,4 ms, jeder Effekt 0 %. Behoben, indem `Lichtschacht` seither die
   Bodenhöhe des Raumes UNTER der Mündung mitführt (`boden`).
3. **Der Median hatte nicht genug Auflösung.** `performance.now()` ist in
   Chromium auf 100 µs gerundet; bei einer Bildzeit um 1,8 ms kann ein Median
   deshalb nur in Schritten von 5,6 % springen. Zwei Läufe derselben Sache
   widersprachen sich scheinbar (Parallax 6 einmal +10,5 %, einmal 0,0 %) —
   nicht weil die Messung schwankte, sondern weil die Zahl gar nichts
   Feineres annehmen KANN. Gewertet wird deshalb der MITTELWERT über alle
   Bilder; er mittelt die Rundung heraus, und die Streuung zwischen den vier
   Durchgängen fiel damit unter 1 % (Spalte „Spanne").

Renderer: `ANGLE (AMD Radeon RX 7900 XT (RADV NAVI31), radv)`, 1920×1080,
Seed 2 (dasselbe Grab wie `steingrab-2` auf wov-dev), Messstelle: Schacht
bei (−22 / 15,5 / −14), Kamera 12 m davor.

### Die PrePass-Frage: NEIN — und die bisherige Begründung war überholt

`render-tech.md` §3.2 hielt fest, für echtes SSR führe am PrePassRenderer
kein Weg vorbei, weil der GeometryBufferRenderer keine Reflektivitäts-MRT
liefere. **Das stimmt für Babylon 8.56 nicht mehr:**
`GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE = 4` existiert, und
`SSRRenderingPipeline(..., forceGeometryBuffer = true)` schaltet sie selbst
ein (`ssrRenderingPipeline.js`, Zeile 486 ff.). Modernes SSR hängt sich
damit an GENAU DIE Passage, die unser SSAO2 (`forceGeometryBuffer = true`)
ohnehin bezahlt.

Der PrePass-Weg wurde trotzdem gebaut und gemessen — und er ist nicht
„teuer", sondern **unverträglich**:

> `scene.enablePrePassRenderer()` ruft
> `PrePassRenderer._refreshGeometryBufferRendererLink()`, und dieser Pfad
> ruft `scene.disableGeometryBufferRenderer()`. Danach ist
> `scene.geometryBufferRenderer` **null** — und unser SSAO2, das ihn je Bild
> liest, rechnet ins Leere.

Der Zeuge steht in der Messreihe: Der PrePass-Lauf ist der EINZIGE mit
`{prepass: true, gbuffer: false}`, alle anderen haben `gbuffer: true`.
Und er ist mit 1,357 ms **schneller** als die Grundlinie Hoch (1,775 ms,
−23,5 %) — genau daran erkennt man ihn. Ein Effekt, der die Bildrate hebt,
hat etwas abgeschaltet. Das Bild bestätigt es: 99,9 % der Bildpunkte
geändert, mittlere Abweichung 76,9, sichtbar dunkler und körniger.

**Beschluss:** Kein PrePassRenderer. Der Seiteneffekt-Import
(`prePassRendererSceneComponent`) wird deshalb NACHGELADEN und nicht oben
importiert — er hängt eine Szenenkomponente an jede Szene des Clients, auch
an die der Oberwelt, die ihn seit jeher meidet. Ein Weg, der die Messung
verlieren kann, darf den ausgelieferten Client nicht dauerhaft belasten.

### SSR: gebaut, gemessen, NICHT in Stufe Hoch

| Weg | Bildzeit | ggü. Hoch-M1 | geänderte Bildpunkte | mittlere Abweichung |
|---|---|---|---|---|
| `?ssr=1` `ScreenSpaceReflectionPostProcess` | 5,056 ms | **+184,9 %** | 13,7 % | 14,2 |
| `?ssr=2` `SSRRenderingPipeline` über GBuffer | 2,462 ms | **+38,7 %** | **0,7 %** | 25,3 |
| `?ssr=3` dieselbe über PrePass | 1,357 ms | −23,5 % | 99,9 % | 76,9 (SSAO tot) |

**0,7 % geänderte Bildpunkte für 38,7 % Bildzeit.** Zum Vergleich, an
derselben Stelle: der Unterschied zwischen Stufe Mittel und Stufe Hoch
(also Cavity an oder aus) ändert 16,5 % der Bildpunkte. SSR ändert ein
Fünfundzwanzigstel davon. Die beiden Bilder sind mit bloßem Auge nicht zu
unterscheiden — nachgesehen, nicht nur gerechnet.

**Die Ursache ist strukturell und nicht durch Zahlen zu drehen:** Der
GeometryBufferRenderer baut seinen Effekt aus einer festen Liste
(`geometryBufferRenderer.js`) — **MaterialPlugins laufen darin nicht**.
Unser Triplanar-Plugin rechnet Normale, Rauheit und die Feuchte-Maske im
Fragment-Shader des Materials; in der GBuffer-Passage kommt davon nichts an.
SSR sieht `metallic = 0, roughness = 1`, also den Materialwert, nicht den
Bildpunktwert. „Nur der feuchte Boden spiegelt" ist auf diesem Weg nicht
wissbar. Die Schwelle so weit zu senken, bis etwas erscheint, ließe JEDEN
trockenen Felsen spiegeln — der Kirmes-Effekt, den das Leitbild ausschließt.

**Beschluss:** SSR ist nicht Teil der Stufe Hoch (`SSR_WEG_HOCH = Aus`). Der
Code bleibt gebaut und über `?ssr=0|1|2|3` wählbar, weil die Entscheidung an
einer Eigenschaft von Babylon 8.56 hängt, die eine spätere Fassung ändern
kann. Ein gelöschter Weg wäre eine Messung, die man neu bauen muss.

Der Weg zurück, falls SSR doch gewollt ist, ist damit auch benannt und ist
KEINE Einstellung: Die Feuchte müsste als eigener Kanal aus dem Material
heraus in den GBuffer — also entweder ein Vertex-Attribut „nass" schon im
Bauer (dann weiß es die GBuffer-Passage über das Material) oder der
PrePass-Weg, und der kostet nach heutigem Stand das SSAO.

### Godrays: EINE Passage, der nächste Schacht, sonst nichts

`VolumetricLightScatteringPostProcess` rendert eine eigene
Verdeckungspassage der ganzen Szene — je Instanz. `render-tech.md` §3.3
verbot „ein Godray je Fackel"; dieselbe Rechnung verbietet auch „eines je
Schacht". Gebaut ist deshalb **eine** Instanz, deren Quelle je Bild auf die
nächstgelegene Schachtmündung gesetzt wird (Reichweite 30 m — das
90. Perzentil der gemessenen Sichtstrecken; Hysterese 0,8, damit die Quelle
zwischen zwei gleich weit entfernten Schächten nicht springt).

Die Mündungen kommen aus `dungeon2.lichtschaechte()` im REINEN Modul, nicht
aus dem Client: Zwei Clients mit demselben Seed müssen dieselben Schächte
finden, sonst leuchtet ein Effekt bei einem Spieler und beim Nachbarn nicht.
Eine Mündung ist die oberste `Schacht`-Zelle eines Stapels über einer
begehbaren Zelle — beide Bedingungen tragen, und beide sind geprüft
(`shared/test/dungeon2-builder.ts`): ohne die erste hinge an einem tiefen
Schacht dreimal derselbe Effekt, ohne die zweite leuchtete ein Strahl in
einen Raum, den es nicht gibt.

**Zwei Fallstricke, beide gemessen:**

1. **Babylon lässt seine Verdeckungspassage liegen.** Der Konstruktor mit
   Kamera legt die Zieltextur in `camera.customRenderTargets`, `dispose(camera)`
   räumt aber nur `scene.customRenderTargets` auf
   (`volumetricLightScatteringPostProcess.js`, Zeile 260 gegen 291). Wer sich
   darauf verlässt, lässt bei JEDEM Stufenwechsel eine vollständige
   Szenenpassage in der Kamera liegen: Effekt weg, Kosten bleiben. Die Klasse
   räumt die Liste selbst. Leckprobe (10× Hoch↔Mittel): Verdeckungspassagen an
   der Kamera **1**, nicht 11.
2. **Ohne Schacht in Reichweite war der Effekt trotzdem sichtbar.** Die Quelle
   nur hinter die Kamera zu schieben genügt nicht — der radiale Blur zieht
   seine Probe trotzdem durchs Bild, und das Ergebnis ist ein flächiger
   Schleier. Der liest sich nicht als „Godray", sondern als „das Grab ist auf
   Hoch flauer", und man suchte ihn in der Beleuchtung. Behoben mit
   `exposure = 0`, wenn kein Schacht gewählt ist — damit ist der Effekt
   ausserhalb von 30 m nicht nur unauffällig, sondern beitragsfrei.

### Parallax: Occlusion mit sechs Schritten, nur Stufe Hoch

Der `#ifdef`-Zweig existierte seit M1 als Offset-Limiting mit einem
Zusatzgriff. Neu ist ein zweiter Zweig hinter demselben `#ifdef`, gewählt
über das ZAHLEN-Define `DUNGEON_PARALLAX_SCHRITTE`: Der Strahl läuft durch
das Höhenfeld und hält beim ersten Schritt, den das Feld überragt, mit einer
linearen Verfeinerung zwischen den letzten beiden Schritten (ohne sie zeigt
die Silhouette jedes Steins die Schrittzahl als Terrassen — und man
verdächtigte die Höhenkarte).

Ein Define und kein Uniform, aus demselben Grund wie bei `DUNGEON_STUFE`:
Babylon schlüsselt seinen Effekt-Cache über die Define-Zeichenkette; als
Uniform bekäme ein Wechsel von 1 auf 6 denselben Schlüssel und damit den
ALTEN Shader zurück.

| Schritte | Bildzeit | ggü. Hoch-M1 | geänderte Bildpunkte |
|---|---|---|---|
| aus | 1,775 ms | 0 % | — |
| 1 (Offset-Limiting, M1) | 1,808 ms | +1,8 % | 59,2 % |
| **6 (gewählt)** | **1,860 ms** | **+4,8 %** | 73,2 % |
| 12 | 1,912 ms | +7,7 % | 73,4 % |

6 liegt im von `render-tech.md` §3.4 genannten Fenster 4–8, und der Sprung
von 6 auf 12 kostet weitere drei Prozentpunkte, ohne das Bild noch messbar zu
ändern (73,2 % gegen 73,4 %). Damit ist auch **R6 beantwortet**: Parallax
bleibt, er kostet ein Zwanzigstel und nicht ein Drittel — und der Schritt von
Offset-Limiting auf Occlusion kostet drei Prozent und bringt 14 Prozentpunkte
mehr geänderte Bildfläche.

### Die Tabelle

Vorschau, 1920×1080, Seed 2, feste Kamera 12 m vor einer Schachtmündung,
Median aus vier verschränkten Durchgängen à 600 Bildern; gewertet wird der
Mittelwert der Bildzeit. Bildvergleich jeweils gegen `hoch-M1`.

| Variante | Bildzeit | fps | p95 | Spanne | ggü. Mittel | ggü. Hoch-M1 | geänderte Bildpunkte |
|---|---|---|---|---|---|---|---|
| Niedrig | 0,592 ms | 1690 | 1,30 | 0,494–0,632 | −58,0 % | −66,7 % | — |
| **Mittel (unverändert)** | **1,408 ms** | **710** | 2,50 | 1,364–1,600 | 0 % | −20,7 % | 16,5 % |
| Hoch wie in M1 | 1,775 ms | 563 | 2,60 | 1,769–1,799 | +26,1 % | 0 % | (Grundlage) |
| Hoch + Parallax 1 | 1,808 ms | 553 | 2,70 | 1,791–1,814 | +28,4 % | +1,8 % | 59,2 % |
| **Hoch + Parallax 6** | 1,860 ms | 538 | 2,90 | 1,855–1,873 | +32,1 % | **+4,8 %** | 73,2 % |
| Hoch + Parallax 12 | 1,912 ms | 523 | 2,80 | 1,892–1,917 | +35,9 % | +7,7 % | 73,4 % |
| **Hoch + Godrays** | 1,707 ms | 586 | 2,80 | 1,692–1,714 | +21,3 % | **−3,8 %** | 91,5 % |
| Hoch + SSR einfach | 5,056 ms | 198 | 5,80 | 5,012–5,079 | +259,2 % | +184,9 % | 13,7 % |
| Hoch + SSR GBuffer | 2,462 ms | 406 | 3,30 | 2,424–2,464 | +74,9 % | +38,7 % | 0,7 % |
| Hoch + SSR PrePass | 1,357 ms | 737 | 2,00 | 1,156–1,377 | −3,6 % | −23,5 % | 99,9 % (SSAO tot) |
| **Hoch, Vollausbau wie ausgeliefert** | **1,729 ms** | **578** | 2,90 | 1,707–1,732 | +22,8 % | **−2,6 %** | 89,5 % |

**Der ganze Vollausbau kostet gegenüber der Stufe Hoch von M1 nichts** — er
misst sich sogar 2,6 % schneller. Das ist die Zeile, die man nicht glauben
soll, ohne die Zeugen zu lesen, denn genau so sah der kaputte PrePass-Lauf
auch aus. Hier sind sie: `parallax {erlaubt: true, schritte: 6}`,
`godrays {an: true, gewaehlt: 2, passagen: 1}`, `gbuffer: true` — der
GeometryBuffer läuft, das SSAO rechnet, beide Effekte hängen, und 89,5 % der
Bildpunkte sind andere als ohne sie.

**Die Godray-Zeile bleibt trotzdem eine offene Frage.** −3,8 % über vier
Durchgänge mit einer Streuung unter 1,5 % ist kein Rauschen. Ausgeschlossen
ist der Verdacht „der Effekt läuft gar nicht" (Zeuge oben, und 91,5 %
geänderte Bildpunkte). Der naheliegende Rest: Ein zusätzlicher
Nachbearbeitungsschritt ändert die Passagenkette — das Szenenbild geht in ein
Zwischenziel, statt direkt in den Bildpuffer, und was Babylon dabei an
Auflöse-Arbeit spart, ist offenbar mehr als die Verdeckungspassage in einem
Innenraum kostet. Aufgeschrieben als Beobachtung, nicht als Erklärung.

**Stufe Mittel ist unverändert.** Die Zeile ist kein Nebenbefund, sondern
die Zusage des Auftrags — und sie steht als Zahl da, nicht als Behauptung:
Der Zeuge `effekte()` meldet für Mittel `parallax {erlaubt: false}`,
`godrays {an: false}`, `ssr {weg: 0}`.

### Der Schalter für den Spieler

Neu in den Grafikeinstellungen: **„Dungeon-Grafik"** (Niedrig / Mittel /
Hoch), Voreinstellung Mittel. Ein eigener Regler und nicht einer der
bestehenden, aus demselben Grund, aus dem `DUNGEON_SSAO_MAX_Z` nicht 1000
ist: Die Dungeon-Effekte messen sich an einer anderen Szene. Draußen kostet
die Verdeckungspassage die Vegetation, drinnen die Wände; draußen gibt es
eine Sonne, drinnen sechzehn Fackeln.

Er wirkt zur Laufzeit, auch im offenen Dungeon
(`Dungeon2Instanz.setzeStufe()` stellt Material, Nachbearbeitung UND
Geometrie um — wer nur eines davon ruft, bekommt einen halb umgestellten
Dungeon, und der sieht nicht nach „halb" aus, sondern nach einem Fehler an
der Stelle, die man gerade ansieht). Und er wirkt auch, wenn gerade kein
Dungeon offen ist: `setzeDungeonStufe()` ist die globale Größe, die der
nächste Dungeon beim Betreten liest.

### Und dieselbe Frage im ECHTEN Client

Die Vorschau hat weder Oberwelt-Nachbearbeitung noch Figur, HUD oder Netz.
Ein Effekt steht dort vor einem viel kleineren Nenner — +4,8 % in der
Vorschau sind nicht +4,8 % im Spiel. Deshalb misst `tools/dungeon2-e2e.mjs`
jetzt am Ende jedes Laufes 400 Bilder im fertig betretenen Dungeon, und die
Stufe kommt über `DG2_STUFE` in die **gespeicherten Einstellungen** — genau
die Tür, die der Regler „Dungeon-Grafik" im Spiel benutzt. Ein Lauf, der
eine andere Tür nimmt, beweist nichts über die, die der Spieler bedient.

| Stufe | Bildzeit | fps | p95 | Zeugen |
|---|---|---|---|---|
| Mittel | 5,110 ms | 196 | 6,80 ms | `proben 8`, `verhaeltnis 0.5`, Parallax aus, Godrays aus |
| **Hoch, Vollausbau** | **5,657 ms** | **177** | 7,60 ms | `proben 16`, `verhaeltnis 0.75`, `parallax {schritte: 6}`, `godrays {gewaehlt: 9, passagen: 1}` |

**+10,7 % Bildzeit für den Sprung von Mittel auf den kompletten Vollausbau**
— und darin steckt das dichtere SSAO (16 statt 8 Proben, 0,75 statt 0,5
Auflösung) genauso wie Parallax und Godrays.

**Mit eingeschalteter Bildschirmsynchronisation halten beide Stufen 60 fps**
(gemessen: 16,666 ms, p95 16,70 ms, in beiden Läufen). Das ist die Zahl, die
für Mike zählt; die 5,7 ms darüber sagen, wie viel Luft bis dahin bleibt.

Der Lauf ohne Synchronisation braucht `DG2_OHNE_VSYNC=1` und ist
ausdrücklich NICHT die Voreinstellung: Der E2E-Lauf prüft in erster Linie die
Kette und soll den Client so laufen lassen wie beim Spieler.

**Alle drei E2E-Pfade grün** (direkt Stufe Mittel, direkt Stufe Hoch, aus der
Normalwelt heraus Stufe Hoch): Prüfsumme Server == Client, 19/19 Blöcke,
34 Meshes, 0 Konsolen-/ZDO-/Prefab-Fehler, `imDungeon = false` nach dem
Verlassen.
