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
 * Der Test hält deshalb den HEUTIGEN Stand fest, nicht den gewünschten.
 * Er ist absichtlich kein Invariantentest: `--streng` am Messskript ist
 * der (heute rote) Invariantenpfad, dieser Test hier ist grün, solange
 * die Messung stimmt. Wird der Rastergenerator scharfgeschaltet, ist er
 * die Stelle, an der die neuen Zahlen bewusst eingetragen werden.
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

let fehler = 0;
function pruefe(name: string, ist: unknown, soll: unknown): void {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${String(ist)}${ok ? '' : ` (erwartet ${String(soll)})`}`);
}

const def = holeKit('DG_StoneVault');
const einzel = [];
for (let seed = 1; seed <= SEED_ANZAHL_VORGABE; seed++) {
  einzel.push(messeRasterLayout(erzeugeLayoutFuerKit(def, seed), def));
}
const g = summiereRaster(einzel);

console.log(`=== DG_StoneVault, ${SEED_ANZAHL_VORGABE} Seeds, Kit-Vorgaben ===`);
pruefe('Wandplatten gesamt', g.plattenGesamt, 2856);
pruefe('Platten in belegter Zelle', g.platteInBelegterZelle, 952);
pruefe('… gegen volle Wand (überflüssig)', g.plattenUeberfluessig, 531);
pruefe('… gegen Teilwand (Treppe, nötig)', g.plattenNoetig, 414);
pruefe('… im Eingangsraum (Altausnahme)', g.plattenEingang, 7);
pruefe('Doppelbelegungen', g.doppelbelegungen, 0);
pruefe('gestapelte Zellen', g.gestapelteZellen, 1328);

const driftOk = g.maxZellDrift < 1e-4;
if (!driftOk) fehler++;
console.log(`${driftOk ? 'OK  ' : 'FAIL'} Zellmitten-Drift: ${g.maxZellDrift.toExponential(2)} m (< 1e-4)`);

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

// Der `--streng`-Pfad muss den heutigen Stand als Verletzung sehen —
// sonst ist der Schalter eine grüne Lampe an einem kaputten Gerät.
const verletzt = verletzteInvarianten(g);
const strengRot = verletzt.length > 0;
if (!strengRot) fehler++;
console.log(`${strengRot ? 'OK  ' : 'FAIL'} --streng meldet den heutigen Stand als verletzt: ${verletzt.length} Invariante(n)`);

console.log(fehler === 0 ? '\nAlle Prüfungen bestanden.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
process.exit(fehler === 0 ? 0 : 1);
