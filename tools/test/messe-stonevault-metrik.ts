/**
 * G1-Abnahmetest zur Messzelle `tools/messe-stonevault-logik.ts`.
 *
 * Warum ein Test AUF einem Messskript: Die Zahlen aus dem Befund
 * (952 Platten in belegten Zellen, davon 531 gegen eine volle Wand,
 * 414 gegen die Treppenflanke, 7 am Eingang; 1328 gestapelte Zellen;
 * 0 Doppelbelegungen) sind die Ausgangslage, gegen die die Meilensteine
 * G4…G7 gemessen werden. Eine Messzelle, die ihre eigene Ausgangslage
 * nicht reproduziert, ist als Fortschrittsanzeige wertlos — dann misst
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

console.log(`=== Block A — 1.0-Pfad, DG_StoneVault, ${SEED_ANZAHL_VORGABE} Seeds, Kit-Vorgaben ===`);
pruefe('Wandplatten gesamt', a.plattenGesamt, 2856);
pruefe('Platten in belegter Zelle', a.platteInBelegterZelle, 952);
pruefe('… gegen volle Wand (überflüssig)', a.plattenUeberfluessig, 531);
pruefe('… gegen Teilwand (Treppe, nötig)', a.plattenNoetig, 414);
pruefe('… im Eingangsraum (Altausnahme)', a.plattenEingang, 7);
pruefe('Doppelbelegungen', a.doppelbelegungen, 0);
pruefe('gestapelte Zellen', a.gestapelteZellen, 1328);

// ── Block B: der Verteiler — das, was heute wirklich gebaut wird ─────
const einzel = [];
for (let seed = 1; seed <= SEED_ANZAHL_VORGABE; seed++) {
  einzel.push(messeRasterLayout(erzeugeLayoutFuerKit(def, seed), def));
}
const g = summiereRaster(einzel);

console.log(`\n=== Block B — Verteiler (Rasterpfad seit G8), ${SEED_ANZAHL_VORGABE} Seeds ===`);
pruefe('Wandplatten gesamt', g.plattenGesamt, 1067);
pruefe('Platten in belegter Zelle', g.platteInBelegterZelle, 0);
pruefe('… gegen volle Wand (überflüssig)', g.plattenUeberfluessig, 0);
// 0 und nicht 414: Die Treppe kehrt ihre Keilflanke nur dort nach
// aussen, wo der Rasterpfad gar keine Nachbarzelle wachsen lässt — die
// Zeile-4-Ausnahme der Kantentafel bleibt trotzdem gültig, sie wird hier
// nur nicht mehr gebraucht.
pruefe('… gegen Teilwand (Treppe, nötig)', g.plattenNoetig, 0);
pruefe('… im Eingangsraum (Altausnahme)', g.plattenEingang, 0);
pruefe('Doppelbelegungen', g.doppelbelegungen, 0);
pruefe('gestapelte Zellen', g.gestapelteZellen, 133);

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
