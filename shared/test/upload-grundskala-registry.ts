/**
 * Grundskala in der Upload-Registry (Karte „Editor Upload-Größe").
 *
 * Deckt:
 *   1. Ein Eintrag OHNE `grundskala` (jeder Eintrag vor dieser Karte)
 *      gilt als 1 — `grundskalaVon` und `grundskalaFuerModell`.
 *   2. `pruefeRegistryEintrag` lässt das Feld fehlen, akzeptiert die
 *      Grenzen `GRUNDSKALA_MIN`/`GRUNDSKALA_MAX` genau, lehnt darunter/
 *      darüber/NaN/Infinity/Nicht-Zahl ab.
 *   3. Die Hülle (`huellenAufloeser`, gemeinsame Grundlage von
 *      `freiflaechenHuellen` UND `pruefungen.ts`) multipliziert
 *      `breite`/`hoehe`/`tiefe` mit der Grundskala — an EINER Stelle
 *      (`huelle.ts` `ausUpload`), nicht doppelt und nicht vergessen.
 *      Die Zahlen sind dieselben wie im Auftrag: `U_Marktstand2`-Maße
 *      (1,00 × 0,72 × 0,60 m) mit Grundskala 4 → 4,00 × 2,88 × 2,40 m.
 *
 * Lauf:  npx tsx shared/test/upload-grundskala-registry.ts
 */
import {
  applyUploadedModelRegistry,
  GRUNDSKALA_MAX,
  GRUNDSKALA_MIN,
  grundskalaFuerModell,
  grundskalaVon,
  pruefeRegistryEintrag,
  registerUploadedPrefab,
  unregisterUploadedPrefab,
  uploadedModelEntry,
  UPLOAD_MODEL_PREFIX,
  type UploadedModelEntry,
} from '../src/uploadedModelRegistry.js';
import { huellenAufloeser } from '../src/weltbau/huelle.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    fehler++;
  }
}

function basisEintrag(zusatz: Partial<UploadedModelEntry> = {}): UploadedModelEntry {
  return {
    name: 'U_Testgrundskala',
    anzeigename: 'Testgrundskala',
    bytes: 1000,
    dreiecke: 100,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: false,
    // Dieselben Maße wie U_Marktstand2 in der Diagnose (26.09.): 1,00 ×
    // 0,7200686 × 0,5992432 m, hier auf zwei Nachkommastellen gekürzt.
    breite: 1.0,
    hoehe: 0.72,
    tiefe: 0.6,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: new Date().toISOString(),
    ...zusatz,
  };
}

console.log('\n1. Ohne Feld gilt Grundskala 1\n');
{
  const m = basisEintrag();
  pruefe(grundskalaVon(m) === 1, 'grundskalaVon(ohne Feld) === 1');
  pruefe(pruefeRegistryEintrag(m) === null, 'Eintrag ohne grundskala ist strukturell gültig');
}

console.log('\n2. Grenzen des Feldes\n');
{
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: GRUNDSKALA_MIN })) === null,
    `GRUNDSKALA_MIN (${GRUNDSKALA_MIN}) selbst wird angenommen`
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: GRUNDSKALA_MAX })) === null,
    `GRUNDSKALA_MAX (${GRUNDSKALA_MAX}) selbst wird angenommen`
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: GRUNDSKALA_MIN - 0.001 })) !== null,
    'knapp unter GRUNDSKALA_MIN wird abgelehnt'
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: GRUNDSKALA_MAX + 0.001 })) !== null,
    'knapp über GRUNDSKALA_MAX wird abgelehnt'
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: Number.NaN })) !== null,
    'NaN wird abgelehnt'
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: Number.POSITIVE_INFINITY })) !== null,
    'Infinity wird abgelehnt'
  );
  pruefe(
    pruefeRegistryEintrag(basisEintrag({ grundskala: '4' as unknown as number })) !== null,
    "ein Text ('4') statt einer Zahl wird abgelehnt"
  );
}

console.log('\n3. grundskalaVon/grundskalaFuerModell mit gesetztem Feld\n');
{
  const m = basisEintrag({ grundskala: 4 });
  pruefe(grundskalaVon(m) === 4, 'grundskalaVon(grundskala: 4) === 4');
  // Ein Wert ausserhalb des Bereichs (Handarbeit an der Datei, an
  // `pruefeRegistryEintrag` vorbei) faellt defensiv auf 1 zurueck, statt
  // eine unplausible Groesse anzuwenden.
  const kaputt = basisEintrag({ grundskala: 500 });
  pruefe(grundskalaVon(kaputt) === 1, 'grundskalaVon fällt bei einem Wert ausserhalb des Bereichs auf 1 zurück');
}

console.log('\n4. grundskalaFuerModell — Loader-Nachschlagepunkt über den Modellnamen\n');
{
  pruefe(grundskalaFuerModell('hochgeladen/U_NichtRegistriert') === 1, 'unregistriertes Modell -> 1');
  pruefe(grundskalaFuerModell('store/environment/rock-03') === 1, 'kein Upload-Modell (falsches Präfix) -> 1');

  registerUploadedPrefab(basisEintrag({ grundskala: 4 }));
  try {
    pruefe(
      grundskalaFuerModell(`${UPLOAD_MODEL_PREFIX}U_Testgrundskala`) === 4,
      'registriertes Upload-Modell mit grundskala 4 -> grundskalaFuerModell === 4'
    );
  } finally {
    unregisterUploadedPrefab('U_Testgrundskala');
  }
}

console.log('\n5. Hülle (huellenAufloeser/ausUpload) — multipliziert, nicht abgeschrieben\n');
{
  registerUploadedPrefab(basisEintrag({ grundskala: 4 }));
  try {
    const huellen = huellenAufloeser();
    const h = huellen('U_Testgrundskala');
    pruefe(h !== null, 'Hülle wird für einen registrierten Upload gefunden');
    if (h) {
      pruefe(h.quelle === 'upload', "Quelle ist 'upload'");
      // Auftrag: U_Marktstand2 mit Grundskala 4 -> 4,0 × 2,88 × 2,4 m.
      pruefe(Math.abs(h.halbX * 2 - 4.0) < 1e-9, `Breite 2×halbX = ${(h.halbX * 2).toFixed(4)} (erwartet 4.0)`);
      pruefe(Math.abs((h.maxY - h.minY) - 2.88) < 1e-9, `Höhe maxY-minY = ${(h.maxY - h.minY).toFixed(4)} (erwartet 2.88)`);
      pruefe(Math.abs(h.halbZ * 2 - 2.4) < 1e-9, `Tiefe 2×halbZ = ${(h.halbZ * 2).toFixed(4)} (erwartet 2.4)`);
    }
  } finally {
    unregisterUploadedPrefab('U_Testgrundskala');
  }

  // Gegenprobe: OHNE grundskala bleibt die Hülle die ROHE Hüllbox — sonst
  // bewiese Schritt 5 nur, dass IRGENDEINE Zahl herauskommt.
  registerUploadedPrefab(basisEintrag());
  try {
    const huellen = huellenAufloeser();
    const h = huellen('U_Testgrundskala');
    pruefe(h !== null && Math.abs(h.halbX * 2 - 1.0) < 1e-9, 'ohne grundskala: Breite bleibt die rohe 1,0 m');
  } finally {
    unregisterUploadedPrefab('U_Testgrundskala');
  }
}

console.log('\n6. applyUploadedModelRegistry übernimmt eine geänderte grundskala bei bekanntem Namen (H1)\n');
{
  const v1 = { version: 1, modelle: [basisEintrag({ grundskala: 1 })] };
  const erg1 = applyUploadedModelRegistry(v1);
  try {
    pruefe(erg1.geladen === 1, 'erster apply: 1 Eintrag geladen');
    pruefe(erg1.geaendert.length === 0, 'erster apply (neu): nichts als geändert gemeldet');
    pruefe(
      grundskalaFuerModell(`${UPLOAD_MODEL_PREFIX}U_Testgrundskala`) === 1,
      'nach apply v1: grundskalaFuerModell === 1'
    );

    const v2 = { version: 1, modelle: [basisEintrag({ grundskala: 4 })] };
    const erg2 = applyUploadedModelRegistry(v2);
    pruefe(erg2.geladen === 1, 'zweiter apply (geändert): weiterhin 1 geladen');
    pruefe(erg2.geaendert.includes('U_Testgrundskala'), "zweiter apply meldet 'U_Testgrundskala' als geändert");
    pruefe(
      grundskalaFuerModell(`${UPLOAD_MODEL_PREFIX}U_Testgrundskala`) === 4,
      'nach apply v2 (g=4): grundskalaFuerModell === 4 (H1 — auf 2c0a7ed blieb das bei 1)'
    );
    pruefe(uploadedModelEntry('U_Testgrundskala')?.grundskala === 4, 'uploadedModelEntry(...) trägt jetzt grundskala 4');

    // Ein DRITTER apply mit UNVERÄNDERTEM Inhalt meldet nichts als geändert
    // (eintraegeGleich) — sonst würde jeder blosse Abgleich (Betriebsdienst,
    // jede Anfrage) den Eintrag fälschlich als "geändert" zählen.
    const erg3 = applyUploadedModelRegistry(v2);
    pruefe(erg3.geaendert.length === 0, 'dritter apply mit gleichem Inhalt: nichts als geändert gemeldet');

    // Dieselbe Hülle spiegelt die Änderung, weil huellenAufloeser() jedes
    // Mal frisch gebaut wird und ausUpload() live nachschlägt.
    const huellen = huellenAufloeser();
    const h = huellen('U_Testgrundskala');
    pruefe(
      h !== null && Math.abs(h.halbX * 2 - 4.0) < 1e-9,
      `Hülle nach Änderung: Breite = ${h ? (h.halbX * 2).toFixed(4) : '?'} (erwartet 4.0)`
    );
  } finally {
    unregisterUploadedPrefab('U_Testgrundskala');
  }
}

console.log('\n7. Eine manipulierte grundskala bei einem SCHON registrierten Modell verwirft nur die Änderung (fail closed, N5)\n');
{
  registerUploadedPrefab(basisEintrag({ grundskala: 2 }));
  try {
    const kaputt = { version: 1, modelle: [basisEintrag({ grundskala: -1 })] };
    const erg = applyUploadedModelRegistry(kaputt);
    pruefe(erg.geladen === 1, 'eine ungültige Änderung zählt trotzdem als (weiter) geladen — der alte Stand bleibt');
    pruefe(erg.geaendert.length === 0, 'eine ungültige Änderung wird NICHT als geändert gemeldet');
    pruefe(erg.meldungen.length > 0, 'eine ungültige Änderung erzeugt eine Meldung (Warnung im Log)');
    pruefe(
      grundskalaFuerModell(`${UPLOAD_MODEL_PREFIX}U_Testgrundskala`) === 2,
      'der zuletzt gültige Stand (2) bleibt registriert, nicht die kaputte -1 (fail closed)'
    );
  } finally {
    unregisterUploadedPrefab('U_Testgrundskala');
  }
}

console.log(fehler === 0 ? '\nOK — Grundskala in Registry und Hülle korrekt.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
