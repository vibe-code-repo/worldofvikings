/**
 * G1-Abnahmetest zur Messzelle `tools/messe-stonevault-logik.ts`.
 *
 * Warum ein Test AUF einem Messskript: Die Zahlen aus dem Befund
 * (Platten in belegten Zellen, aufgeteilt nach volle Wand / Treppen-
 * flanke / Eingang, dazu gestapelte Zellen und Doppelbelegungen) sind
 * die Ausgangslage, gegen die die Meilensteine G4…G7 gemessen werden.
 * Die geltenden Werte stehen bei Block A unten — sie sind mit G11 einmal
 * gewandert, aus dem dort genannten Grund.
 *
 * Eine Messzelle, die ihre eigene Ausgangslage nicht reproduziert, ist als Fortschrittsanzeige wertlos — dann misst
 * man ab G4 gegen eine Zahl, die sich unterwegs selbst verschoben hat.
 *
 * ── Zwei Blöcke seit G8 ──────────────────────────────────────────────
 * Mit dem Verteiler (G8) läuft `DG_StoneVault` über den Rasterpfad. Die
 * G1-Zahlen deshalb einfach zu überschreiben hiesse, den Zeugen
 * wegzuwerfen: Ohne sie liesse sich nicht mehr belegen, dass die
 * Messzelle die Fehlerklasse überhaupt SIEHT — eine Messung, die nur noch
 * Nullen kennt, ist von einer kaputten nicht zu unterscheiden.
 *
 * Block A misst deshalb weiter den 1.0-PFAD direkt (`generateDungeonLayout`,
 * nur importiert) und hält dort die Ausgangslage fest. Block B misst über
 * den VERTEILER — also das, was Server und Editor heute bauen — und hält
 * dort das Ergebnis fest. `--streng` muss auf A rot und auf B grün sein;
 * jede andere Kombination ist entweder eine blinde Messzelle oder ein
 * Generator, der sein Versprechen gebrochen hat.
 *
 * Aufruf: npx tsx tools/test/messe-stonevault-metrik.ts
 */
import {
  SEED_ANZAHL_VORGABE,
  erzeugeLayoutFuerKit,
  holeKit,
  messeRasterLayout,
  summiereRaster,
  verletzteInvarianten,
} from '../messe-stonevault-logik.js';
// Der 1.0-Pfad DIREKT — nicht über den Verteiler: Block A soll die
// Ausgangslage messen, und die hängt nicht davon ab, welchen Weg das Kit
// heute nimmt.
import { generateDungeonLayout } from '../../shared/src/dungeonGenerator.js';

let fehler = 0;
function pruefe(name: string, ist: unknown, soll: unknown): void {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${String(ist)}${ok ? '' : ` (erwartet ${String(soll)})`}`);
}

const def = holeKit('DG_StoneVault');

// ── Block A: der 1.0-Pfad, die Ausgangslage aus dem G1-Befund ────────
const alt = [];
for (let seed = 1; seed <= SEED_ANZAHL_VORGABE; seed++) {
  alt.push(messeRasterLayout(generateDungeonLayout(def, seed), def));
}
const a = summiereRaster(alt);

/*
  ── Warum die Zahlen am 04.09.2026 (G11) EINMAL gewandert sind ───────
  G11 hat die Kanten- und Connector-ERKLÄRUNG von `StoneVaultCorner` und
  `StoneVaultJunction` in x gespiegelt, weil die Module im Spiel
  seitenverkehrt zu ihrer Erklärung stehen (Blender-Ost ist −x, und die
  doppelte x-Negation aus `make-stonevault.py` und Babylons `__root__`
  hebt sich auf — gemessen von `tools/stonevault-kantensonde.ts`).

  Der 1.0-Pfad liest DIESELBEN Connectors. Seine Ausgangslage konnte
  darum nicht bleiben, wo sie war: Jeder Anbau an eine Ecke oder einen
  Abzweig fällt jetzt auf die andere Seite, also entstehen andere
  Layouts und andere Plattenzahlen. Die alten Werte waren 2856 / 952
  (531 + 414 + 7) / 1328.

  Was NICHT gewandert ist, ist die Rolle dieses Blocks: Er hält
  weiterhin eine Ausgangslage mit dreistelligen Fehlerzahlen fest, und
  `--streng` sieht sie weiterhin als verletzt. Genau das ist der Zeuge —
  eine Messzelle, die nur noch Nullen kennt, wäre von einer kaputten
  nicht zu unterscheiden.

  G11 mirrored the kit's edge declaration; the 1.0 path reads the same
  connectors, so its frozen baseline moved once. Its role — a witness
  that the measuring cell still SEES the error class — is unchanged.

  ── Und ein zweites Mal am 04.09.2026 (grosse Säle) ──────────────────
  Das Kit hat zwei Räume dazubekommen (`StoneVaultHallLarge` 3×3,
  `StoneVaultHallLong` 2×4). Damit ändert sich die AUSWAHLMENGE beider
  Pfade: `candidateRooms` zieht aus zehn statt aus acht Räumen, also
  fallen andere Würfe, entstehen andere Layouts und andere Plattenzahlen.
  Werte davor: A 2912 / 916 (527 + 372 + 17) / 1331, B 1067 / 133.

  Für Block B ist nur EINE Zahl gewandert — die gestapelten Zellen
  (133 → 128); die Plattenzahl 1067 steht unverändert, weil der
  Rasterpfad Säle als Stempel reserviert und ihre Aussenkanten nach
  derselben Tafel versiegelt wie jede andere Zelle. Alle Null-Aussagen
  von Block B sind Null geblieben: keine Platte in einer belegten Zelle,
  keine Doppelbelegung, keine unerklärte Nachbarschaft.

  A second, deliberate move: the kit gained two hall sizes, so both
  paths draw from a larger room set. Block B's zero statements all stayed
  zero.

  ── Und ein drittes Mal am 04.09.2026 (Eingang versiegelt) ───────────
  Der Rasterpfad nimmt den Eingangsport nicht mehr von der Kantentafel
  aus: Die Zelle davor bleibt für immer leer, ein offener Port war also
  ein Schacht ohne Decke und ohne Boden — Mikes „Lichtfuge". Block B
  bekommt dadurch GENAU EINE Platte je Saat dazu, 1067 → 1107. Mehr
  nicht: Sie steht auf der Kante und nicht im Stein, also bleibt
  „Platten in belegter Zelle" bei 0 und „… im Eingangsraum" ebenso.
  Block A (1.0-Pfad) rührt der Umbau nicht an — dort steht die alte
  Zahl 20 als Zeuge der abgeschafften Notfall-Ausnahme weiter.

  A third move: the grid path now seals the entrance port too, adding
  exactly one plate per seed (1067 → 1107). Every zero stayed zero.

  ── Und ein viertes Mal am 04.09.2026 (noch grössere Säle) ───────────
  Zwei weitere Räume (`StoneVaultHallGrand` 4×4, `StoneVaultHallVast`
  6×6) und, im Rasterpfad, ein GEWICHTETER Stempelwurf statt eines
  gleichverteilten (`pickStampOption`). Beides bewegt dieselbe Zahl aus
  demselben Grund wie beim zweiten Mal: Block A zieht aus zwölf statt
  aus zehn Räumen (4653 → 5453 Platten), Block B wählt seine Säle nach
  Kit-Gewicht statt nach Listenlänge. Werte davor: A 4653 / 1155
  (718 + 417 + 20) / 1028, B 1107 / 128.

  Bemerkenswert ist, wie WENIG sich in Block B bewegt: EINE Platte
  (1107 → 1108) und die gestapelten Zellen (128 → 116, weniger Treppen,
  weil ein Saal öfter den Platz bekommt). Jede Null-Aussage ist Null
  geblieben — keine Platte in einer belegten Zelle, keine
  Doppelbelegung, keine unerklärte Nachbarschaft, und das bei zwei
  Sälen, von denen der grössere 36 Zellen auf einmal belegt.

  A fourth move: two more hall sizes and a weighted stamp draw. Block A
  now draws from twelve rooms; Block B moved by a single plate. Every
  zero stayed zero.
*/
console.log(`=== Block A — 1.0-Pfad, DG_StoneVault, ${SEED_ANZAHL_VORGABE} Seeds, Kit-Vorgaben ===`);
pruefe('Wandplatten gesamt', a.plattenGesamt, 5453);
pruefe('Platten in belegter Zelle', a.platteInBelegterZelle, 1147);
pruefe('… gegen volle Wand (überflüssig)', a.plattenUeberfluessig, 688);
pruefe('… gegen Teilwand (Treppe, nötig)', a.plattenNoetig, 441);
pruefe('… im Eingangsraum (Altausnahme)', a.plattenEingang, 18);
pruefe('Doppelbelegungen', a.doppelbelegungen, 0);
pruefe('gestapelte Zellen', a.gestapelteZellen, 1084);

// ── Block B: der Verteiler — das, was heute wirklich gebaut wird ─────
const einzel = [];
for (let seed = 1; seed <= SEED_ANZAHL_VORGABE; seed++) {
  einzel.push(messeRasterLayout(erzeugeLayoutFuerKit(def, seed), def));
}
const g = summiereRaster(einzel);

console.log(`\n=== Block B — Verteiler (Rasterpfad seit G8), ${SEED_ANZAHL_VORGABE} Seeds ===`);
pruefe('Wandplatten gesamt', g.plattenGesamt, 1108);
pruefe('Platten in belegter Zelle', g.platteInBelegterZelle, 0);
pruefe('… gegen volle Wand (überflüssig)', g.plattenUeberfluessig, 0);
// 0 und nicht 414: Die Treppe kehrt ihre Keilflanke nur dort nach
// aussen, wo der Rasterpfad gar keine Nachbarzelle wachsen lässt — die
// Zeile-4-Ausnahme der Kantentafel bleibt trotzdem gültig, sie wird hier
// nur nicht mehr gebraucht.
pruefe('… gegen Teilwand (Treppe, nötig)', g.plattenNoetig, 0);
pruefe('… im Eingangsraum (Altausnahme)', g.plattenEingang, 0);
pruefe('Doppelbelegungen', g.doppelbelegungen, 0);
pruefe('gestapelte Zellen', g.gestapelteZellen, 116);

const driftOk = g.maxZellDrift < 1e-4 && a.maxZellDrift < 1e-4;
if (!driftOk) fehler++;
console.log(
  `${driftOk ? 'OK  ' : 'FAIL'} Zellmitten-Drift: A ${a.maxZellDrift.toExponential(2)} m, ` +
    `B ${g.maxZellDrift.toExponential(2)} m (< 1e-4)`
);

// Die Aufteilung muss aufgehen — sonst zählt eine Kategorie doppelt oder
// es fällt eine Platte durch alle Raster.
pruefe(
  'Summe der Klassen == Platten in belegter Zelle',
  g.plattenUeberfluessig + g.plattenNoetig + g.plattenEingang + g.plattenVorOeffnung,
  g.platteInBelegterZelle
);

// Determinismus: dieselbe Saat, dieselbe Zahl. Ohne diesen Zeugen ist
// jede Abnahmezahl oben nur eine Momentaufnahme.
const wieder = messeRasterLayout(erzeugeLayoutFuerKit(def, 7), def);
const einmal = einzel[6]!;
pruefe('Seed 7 reproduzierbar (Platten)', wieder.plattenGesamt, einmal.plattenGesamt);
pruefe('Seed 7 reproduzierbar (in belegter Zelle)', wieder.platteInBelegterZelle, einmal.platteInBelegterZelle);

// Der `--streng`-Pfad muss den ALTEN Stand als Verletzung sehen und den
// neuen nicht. Nur die zweite Hälfte zu prüfen wäre eine grüne Lampe an
// einem Gerät, von dem niemand mehr weiss, ob es angeschlossen ist.
const verletztA = verletzteInvarianten(a);
const strengRot = verletztA.length > 0;
if (!strengRot) fehler++;
console.log(
  `${strengRot ? 'OK  ' : 'FAIL'} --streng sieht den 1.0-Stand als verletzt: ${verletztA.length} Invariante(n)`
);
const verletztB = verletzteInvarianten(g);
const strengGruen = verletztB.length === 0;
if (!strengGruen) fehler++;
console.log(
  `${strengGruen ? 'OK  ' : 'FAIL'} --streng sieht den Rasterstand als sauber` +
    (strengGruen ? '' : `: ${verletztB.join('; ')}`)
);

console.log(fehler === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
