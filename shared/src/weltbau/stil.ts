/**
 * stil.ts — der Stilführer für KI-Weltbau (MCP-Ressource `style_guide`).
 *
 * Was sich aus dem Code ergibt, wird ERZEUGT (Wasserlinie, Biome und ihre
 * Grundhöhe, Begehbarkeitsmaße, Zone, Grenzen, Katalog-Gliederung, die
 * Dorf-Vorlage) — dann kann der Text nicht von den Konstanten abweichen. Was
 * kuratiert ist, steht unten in `STIL_VORSCHLAG` und trägt im Text den
 * Vermerk „Vorschlag — von Mike zu bestätigen“: im Repo gibt es dafür keinen
 * Kanon (Baustil je Region, Hausabstände, Dorfgrößen, Stufe je Biom).
 *
 * Style guide for AI world building. Everything derivable from the code is
 * generated; the curated proposals are named constants marked as unconfirmed.
 */
import { WATER_LEVEL } from '../worldgen/Heightmap.js';
import { KOERPER_RADIUS, KOERPER_HOEHE, STEIGUNGS_GRENZE_GRAD, STUFEN_HOEHE } from '../bewegung/masse.js';
import { ZONE_SIZE } from '../constants.js';
import { BIOME_BY_NAME, DEFAULT_BASE_LEVEL } from '../worldlayout/types.js';
import { OP_LIMITS } from '../worldlayout/ops.js';
import { VILLAGE_REGION } from '../villageBiome.js';
import { STORE_KATALOG } from '../storeKatalogDaten.js';
import * as G from './grenzen.js';

/** Normierte Grundhöhe → Meter (siehe `DEFAULT_BASE_LEVEL`: ×200). */
export const GRUNDHOEHE_MAL = 200;

/** Höchstlänge des Stilführers in Zeichen (Grenze aus der Spezifikation: 20 KB). */
export const STIL_MAX_ZEICHEN = 20_000;

/** Kuratierte Vorschläge. ANNAHMEN — Mike bestätigt oder ändert sie. */
export const STIL_VORSCHLAG = {
  /** Abstand zwischen zwei Häusern, Traufe zu Traufe (m). */
  hausAbstandMin: 4,
  /** Breite von Wegen (m). */
  wegBreiteMin: 2,
  /** Ein kleines Dorf: so viele Häuser. */
  kleinesDorfHaeuserMin: 4,
  kleinesDorfHaeuserMax: 8,
  /** Progressionsstufe 0 nur in diesem Biom. */
  stufe0Biom: 'grassland',
} as const;

const meter = (n: number): string => `${Math.round(n * 10) / 10}`;

function katalogGruppen(): string {
  const je = new Map<string, Set<string>>();
  const anzahl = new Map<string, number>();
  for (const e of STORE_KATALOG) {
    if (e.art !== 'modell' || e.platzierbar === false || e.prefabName === undefined) continue;
    (je.get(e.gruppe) ?? je.set(e.gruppe, new Set()).get(e.gruppe)!).add(e.untergruppe);
    anzahl.set(e.gruppe, (anzahl.get(e.gruppe) ?? 0) + 1);
  }
  return [...je.keys()]
    .sort()
    .map((g) => `- ${g} (${anzahl.get(g)} Modelle): ${[...je.get(g)!].sort().join(', ')}`)
    .join('\n');
}

/** Der Stilführer als Markdown. Deterministisch; höchstens `STIL_MAX_ZEICHEN` Zeichen. */
export function erzeugeStilfuehrer(): string {
  const biome = [...BIOME_BY_NAME.keys()]
    .map((b) => `- ${b}: Grundhöhe ${meter((DEFAULT_BASE_LEVEL.get(b) ?? 0) * GRUNDHOEHE_MAL)} m`)
    .join('\n');
  const v = VILLAGE_REGION;
  const text = `# Stilführer Weltbau

Dieser Text ist zu großen Teilen aus dem Code erzeugt; Zahlen stehen dort, wo ihre Quelle liegt. Die Abschnitte
„Vorschlag“ sind NICHT bestätigt.

## Arbeitsweise

1. Erst sehen: \`layout_get\`, \`area_describe\`, \`map_render\`.
2. Passende Modelle suchen: \`catalog_search\` (nur dort gefundene Namen sind gültig), \`uploads_list\` für eigene Uploads.
3. Ändern in kleinen Schritten: \`ops_apply\` mit \`trocken: true\`, dann echt; \`undo_last\` nimmt den letzten eigenen Vorgang zurück.
4. Prüfen: \`world_check\` (Ampel) und \`world_diff\` (was hat sich geändert). Erst bei Ampel GRÜN gilt ein Abschnitt als fertig.
5. Gelände (Regionen, Flüsse, Seen, Kontinente, \`einebnen\`) wirkt erst nach einem Neustart des Spielservers; Objekte wirken sofort.

## Gelände

- Wasserlinie: ${WATER_LEVEL} m. Was tiefer liegt, ist Wasser; Objekte dort sind Fehler (außer Stege, Docks, Boote).
- Biome (${BIOME_BY_NAME.size}); die Grundhöhe je Biom ist die Vorgabe einer Region ohne \`baseLevel\`:
${biome}
- Progressionsstufe \`tier\` 0–5 einer Region: Orte mit höherer Stufe entstehen dort nicht. Ohne Angabe gilt keine Beschränkung.
- Bewuchsregler einer Region: \`forestDensity\` (wo Wald ist, 0 kahl bis 2 dicht), \`bewuchsDichte\` (wie viele je Fläche, 0,1 bis 4, Vorgabe 1),
  \`waldKoernung\`, \`abstandFaktor\`, \`nester\`.

## Begehbarkeit (Spielmaße)

- Körperradius ${KOERPER_RADIUS} m, Körperhöhe ${KOERPER_HOEHE} m.
- Steigungsgrenze ${STEIGUNGS_GRENZE_GRAD}° (steiler ist nicht begehbar), Stufenhöhe ${STUFEN_HOEHE} m.
- Zone: ${ZONE_SIZE} m Kantenlänge; Objektbudget je Zone siehe \`world_check\`.

## Grenzen des Dokuments

- Platzierungen: höchstens ${OP_LIMITS.placements} (\`ops_apply\` lehnt mehr ab).
- Regionen ${OP_LIMITS.regions}, Routen ${OP_LIMITS.routes}, Flüsse ${OP_LIMITS.rivers}, Seen ${OP_LIMITS.lakes}, Kontinente ${OP_LIMITS.continents}.
- \`einebnen\` einer Platzierung: 1 bis 100 m Radius.

## Prüfgrenzen von world_check (Vorgaben, änderbar)

- Hangneigung: gelb ab ${G.HANG_GRAD_GELB}°, rot ab ${G.HANG_GRAD_ROT}°.
- Gebäude: Höhenspanne unter der Grundfläche gelb ab ${G.GEBAEUDE_SPANNE_GELB} m, rot ab ${G.GEBAEUDE_SPANNE_ROT} m.
- Objekte je ${ZONE_SIZE}-m-Zone: gelb ab ${G.ZONE_OBJEKTE_GELB}, rot ab ${G.ZONE_OBJEKTE_ROT}.
- Überlappung fester Grundflächen (Anteil der kleineren): gelb ab ${G.UEBERLAPPUNG_GELB}, rot ab ${G.UEBERLAPPUNG_ROT}.
- Ein Haus: fester Körper mit mindestens ${G.HAUS_MIN_KANTE} × ${G.HAUS_MIN_KANTE} m Grundfläche und ${G.HAUS_MIN_HOEHE} m Höhe.
- Prüfbereich: Kante höchstens ${G.BEREICH_MAX_KANTE} m.

## Dorf-Vorlage

Die Vorlage des Startdorfs: Biom ${v.biome}, Stufe ${v.tier}, Küstenfalloff ${v.edgeFalloff} m, \`forestDensity\` ${v.forestDensity},
\`bewuchsDichte\` ${v.bewuchsDichte}, \`waldKoernung\` ${v.waldKoernung}, \`abstandFaktor\` ${v.abstandFaktor}, \`nester\` ${v.nester};
kuratierte Bewuchsliste mit ${v.vegetation.length} Baum-, Busch- und Felsvarianten (\`region.vegetation\`).

## Katalog (setzbare Modelle nach Gruppe)

${katalogGruppen()}

Uploads stehen in der Gruppe „Hochgeladen“; Namen beginnen mit \`U_\`. Gebäude bestehen aus Bausatzteilen (Gruppe „Gebäude“), die
absichtlich ineinandergreifen dürfen; ganze Häuser mit bekannter Türseite gibt es noch nicht (world_check meldet „Eingang geschätzt“).

## Vorschlag — von Mike zu bestätigen

Diese Werte sind Annahmen, kein Kanon:

- Häuser: Abstand Traufe zu Traufe mindestens ${STIL_VORSCHLAG.hausAbstandMin} m.
- Wege: mindestens ${STIL_VORSCHLAG.wegBreiteMin} m breit.
- Ein kleines Dorf hat ${STIL_VORSCHLAG.kleinesDorfHaeuserMin} bis ${STIL_VORSCHLAG.kleinesDorfHaeuserMax} Häuser.
- Progressionsstufe 0 nur im Biom ${STIL_VORSCHLAG.stufe0Biom}.
- Einen Baustil je Region gibt es noch nicht festgelegt: Bei Unsicherheit ein Haus als Vorschlag setzen, prüfen, zeigen und fragen.
`;
  if (text.length > STIL_MAX_ZEICHEN) throw new Error(`Stilführer zu lang: ${text.length} > ${STIL_MAX_ZEICHEN}`);
  return text;
}
