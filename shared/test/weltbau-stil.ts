/**
 * style_guide: jede Zahl im erzeugten Teil wird gegen ihre Quellkonstante
 * geprüft (Abweichungen 0), der Text hat höchstens 20 KB und enthält keine
 * Herkunftsnamen.
 *
 * Lauf: npx tsx shared/test/weltbau-stil.ts   (aus shared/)
 */
import { WATER_LEVEL } from '../src/worldgen/Heightmap.js';
import { KOERPER_RADIUS, KOERPER_HOEHE, STEIGUNGS_GRENZE_GRAD, STUFEN_HOEHE } from '../src/bewegung/masse.js';
import { ZONE_SIZE } from '../src/constants.js';
import { PLATZIERUNGEN_GRENZE } from '../src/worldlayout/layoutDatei.js';
import { BIOME_BY_NAME, DEFAULT_BASE_LEVEL } from '../src/worldlayout/types.js';
import { OP_LIMITS } from '../src/worldlayout/ops.js';
import { VILLAGE_REGION } from '../src/villageBiome.js';
import * as G from '../src/weltbau/grenzen.js';
import { erzeugeStilfuehrer, STIL_VORSCHLAG, STIL_MAX_ZEICHEN } from '../src/weltbau/stil.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const text = erzeugeStilfuehrer();
pruefe('Deterministisch: zwei Aufrufe gleich', text === erzeugeStilfuehrer());
pruefe(`Höchstens ${STIL_MAX_ZEICHEN} Zeichen`, text.length <= STIL_MAX_ZEICHEN, `${text.length} Zeichen`);
pruefe('Kein unaufgelöster Platzhalter (undefined/NaN/[object)', !/undefined|NaN|\[object/.test(text));

// Jede Zahl gegen ihre Quelle: die Zeile muss den Wert der Konstante tragen.
const zahlen: Array<[string, RegExp]> = [
  ['WATER_LEVEL', new RegExp(`Wasserlinie: ${WATER_LEVEL} m`)],
  ['KOERPER_RADIUS', new RegExp(`Körperradius ${KOERPER_RADIUS} m`)],
  ['KOERPER_HOEHE', new RegExp(`Körperhöhe ${KOERPER_HOEHE} m`)],
  ['STEIGUNGS_GRENZE_GRAD', new RegExp(`Steigungsgrenze ${STEIGUNGS_GRENZE_GRAD}°`)],
  ['STUFEN_HOEHE', new RegExp(`Stufenhöhe ${STUFEN_HOEHE} m`)],
  ['ZONE_SIZE', new RegExp(`Zone: ${ZONE_SIZE} m Kantenlänge`)],
  ['PLATZIERUNGEN_GRENZE', new RegExp(`Platzierungen: höchstens ${PLATZIERUNGEN_GRENZE} `)],
  ['OP_LIMITS.placements = PLATZIERUNGEN_GRENZE', new RegExp(`höchstens ${OP_LIMITS.placements} `)],
  ['OP_LIMITS Rest', new RegExp(`Regionen ${OP_LIMITS.regions}, Routen ${OP_LIMITS.routes}, Flüsse ${OP_LIMITS.rivers}, Seen ${OP_LIMITS.lakes}, Kontinente ${OP_LIMITS.continents}`)],
  ['HANG', new RegExp(`gelb ab ${G.HANG_GRAD_GELB}°, rot ab ${G.HANG_GRAD_ROT}°`)],
  ['GEBAEUDE_SPANNE', new RegExp(`gelb ab ${G.GEBAEUDE_SPANNE_GELB} m, rot ab ${G.GEBAEUDE_SPANNE_ROT} m`)],
  ['ZONE_OBJEKTE', new RegExp(`gelb ab ${G.ZONE_OBJEKTE_GELB}, rot ab ${G.ZONE_OBJEKTE_ROT}`)],
  ['UEBERLAPPUNG', new RegExp(`gelb ab ${G.UEBERLAPPUNG_GELB}, rot ab ${G.UEBERLAPPUNG_ROT}`)],
  ['HAUS', new RegExp(`${G.HAUS_MIN_KANTE} × ${G.HAUS_MIN_KANTE} m Grundfläche und ${G.HAUS_MIN_HOEHE} m Höhe`)],
  ['BEREICH_MAX_KANTE', new RegExp(`Kante höchstens ${G.BEREICH_MAX_KANTE} m`)],
  ['Anzahl Biome', new RegExp(`Biome \\(${BIOME_BY_NAME.size}\\)`)],
  ['Dorf-Vorlage', new RegExp(`Biom ${VILLAGE_REGION.biome}, Stufe ${VILLAGE_REGION.tier}, Küstenfalloff ${VILLAGE_REGION.edgeFalloff} m`)],
  ['Dorf-Bewuchsliste', new RegExp(`Bewuchsliste mit ${VILLAGE_REGION.vegetation.length} `)],
];
let abweichungen = 0;
for (const [name, muster] of zahlen) {
  const passt = muster.test(text);
  if (!passt) abweichungen++;
  pruefe(`Zahl ${name} stimmt mit der Quelle überein`, passt);
}
for (const [biom, niveau] of DEFAULT_BASE_LEVEL) {
  const passt = text.includes(`- ${biom}: Grundhöhe ${Math.round(niveau * 200 * 10) / 10} m`);
  if (!passt) abweichungen++;
  pruefe(`Grundhöhe ${biom}`, passt);
}
pruefe('Abweichungen insgesamt: 0', abweichungen === 0, `${abweichungen}`);

// Der Vorschlagsabschnitt trägt die Vermerke und die benannten Konstanten.
const vorschlag = text.slice(text.indexOf('## Vorschlag'));
pruefe('Abschnitt „Vorschlag — von Mike zu bestätigen“ vorhanden', /^## Vorschlag — von Mike zu bestätigen/.test(vorschlag));
pruefe('Vorschlagswerte kommen aus STIL_VORSCHLAG', vorschlag.includes(`mindestens ${STIL_VORSCHLAG.hausAbstandMin} m`) && vorschlag.includes(`${STIL_VORSCHLAG.kleinesDorfHaeuserMin} bis ${STIL_VORSCHLAG.kleinesDorfHaeuserMax} Häuser`) && vorschlag.includes(STIL_VORSCHLAG.stufe0Biom));
pruefe('Gruppen des Katalogs stehen drin (Gebäude, Vegetation)', /- Gebäude \(\d+ Modelle\)/.test(text) && /- Vegetation \(\d+ Modelle\)/.test(text));

// Keine Herkunftsspuren: Liste bewusst kurz, Namen nur als Zeichenfolgen in Stücken, damit dieser Test sie nicht selbst trägt.
const VERBOTEN = [['val', 'heim'], ['iron', 'gate'], ['coffee', 'stain'], ['unity'], ['c++']].map((t) => t.join(''));
const treffer = VERBOTEN.filter((w) => text.toLowerCase().includes(w));
pruefe('Herkunftsnamen im Text: 0 Treffer', treffer.length === 0, treffer.join(','));

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
