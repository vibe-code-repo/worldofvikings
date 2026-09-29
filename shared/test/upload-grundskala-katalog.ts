/**
 * M1 (Angriff „Editor Upload-Größe", PR #110): Der Weltbau-Katalog
 * (`shared/src/weltbau/katalog.ts`, Grundlage von `tools/worldlayout-mcp`)
 * muss für hochgeladene Modelle die GRUNDSKALIERTEN Maße melden, nicht die
 * rohe Hüllbox der Datei — sonst plant der KI-Weltbau mit einem Bruchteil
 * der tatsächlichen Kante (bei Grundskala 4: einem Viertel), während die
 * Kollisionshülle (`huelle.ts` `ausUpload`) längst skaliert ist.
 *
 * Zahlen wie im Auftrag: `U_Marktstand2`-Rohmaße (1,00 × 0,72 × 0,60 m) mit
 * Grundskala 4 -> 4,00 × 2,88 × 2,40 m im Katalogeintrag.
 *
 * Lauf:  npx tsx shared/test/upload-grundskala-katalog.ts
 */
import type { UploadedModelEntry } from '../src/uploadedModelRegistry.js';
import { baueKatalog } from '../src/weltbau/katalog.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    fehler++;
  }
}

function upload(zusatz: Partial<UploadedModelEntry> & Pick<UploadedModelEntry, 'name' | 'anzeigename'>): UploadedModelEntry {
  return {
    bytes: 1000,
    dreiecke: 100,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: false,
    breite: 1.0,
    hoehe: 0.72,
    tiefe: 0.6,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: '2026-09-27T00:00:00Z',
    ...zusatz,
  };
}

console.log('\n1. Katalogeintrag eines Uploads mit Grundskala 4 zeigt die skalierten Maße\n');
{
  const uploads = [upload({ name: 'U_Katalogtestvier', anzeigename: 'Katalogtestvier', grundskala: 4 })];
  const katalog = baueKatalog({ uploads });
  const eintrag = katalog.find((e) => e.name === 'U_Katalogtestvier');
  pruefe(eintrag !== undefined, 'Eintrag steht im Katalog');
  if (eintrag) {
    pruefe(eintrag.breite === 4, `Breite = ${eintrag.breite} (erwartet 4, H1-Nachbesserung M1 — vorher 1)`);
    pruefe(eintrag.hoehe === 2.88, `Höhe = ${eintrag.hoehe} (erwartet 2.88)`);
    pruefe(eintrag.tiefe === 2.4, `Tiefe = ${eintrag.tiefe} (erwartet 2.4)`);
  }
}

console.log('\n2. Gegenprobe: ohne grundskala (Feld fehlt) bleiben die rohen Maße unverändert\n');
{
  const uploads = [upload({ name: 'U_Katalogtestohne', anzeigename: 'Katalogtestohne' })];
  const katalog = baueKatalog({ uploads });
  const eintrag = katalog.find((e) => e.name === 'U_Katalogtestohne');
  pruefe(eintrag !== undefined, 'Eintrag steht im Katalog');
  if (eintrag) {
    pruefe(eintrag.breite === 1, `ohne Grundskala: Breite bleibt roh 1,0 (${eintrag.breite})`);
    pruefe(eintrag.hoehe === 0.72, `ohne Grundskala: Höhe bleibt roh 0,72 (${eintrag.hoehe})`);
  }
}

console.log(fehler === 0 ? '\nOK — Weltbau-Katalog grundskaliert Upload-Maße korrekt.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
