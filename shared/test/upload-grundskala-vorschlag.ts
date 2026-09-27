/**
 * Zielgrößen-Vorschlag beim Hochladen (Karte „Editor Upload-Größe",
 * Auftrag Punkt 4) — DOM-frei, wie der Kopfkommentar von
 * `uploadedModelGroessenvorschlag.ts` es verlangt: `schlageZielgroesseVor`
 * nimmt nur Werte entgegen und gibt nur Werte zurück, kein Browser, kein
 * Babylon, kein Editor.
 *
 * Deckt die drei Stufen aus dem Auftrag, in der geforderten Reihenfolge:
 *   (a) ein ähnliches VORHANDENES Modell über den Namen,
 *   (b) sonst die Größentabelle,
 *   (c) sonst die Rohgröße der Datei,
 * dazu die cm-Verdachtsschwelle (Punkt 4, Plausibilität) als eigene
 * Funktion `cmVerdacht`.
 *
 * Lauf:  npx tsx shared/test/upload-grundskala-vorschlag.ts
 */
import { cmVerdacht, CM_VERDACHT_SCHWELLE_M, schlageZielgroesseVor } from '../src/uploadedModelGroessenvorschlag.js';
import { kategorieFuerName } from '../src/uploadedModelGroessentabelle.js';
import type { UploadedModelEntry } from '../src/uploadedModelRegistry.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    fehler++;
  }
}

function kandidat(zusatz: Partial<UploadedModelEntry> & Pick<UploadedModelEntry, 'name' | 'anzeigename'>): UploadedModelEntry {
  return {
    bytes: 1000,
    dreiecke: 100,
    meshes: 1,
    materialien: 1,
    bilder: 0,
    fehlendeTexturen: false,
    breite: 4.0,
    hoehe: 3.37,
    tiefe: 2.5,
    kollisionsart: 'fest',
    hatKollisionsnetz: false,
    kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test',
    zeitpunkt: new Date().toISOString(),
    ...zusatz,
  };
}

console.log('\n1. (a) Ähnliches vorhandenes Modell über den Namen — Marktstand2 -> U_Marktstand\n');
{
  const kandidaten = [kandidat({ name: 'U_Marktstand', anzeigename: 'Marktstand', breite: 4.0, hoehe: 3.37 })];
  const rohMasse = { breite: 1.0, hoehe: 0.72 };
  const vorschlagBreite = schlageZielgroesseVor('Marktstand2', 'breite', rohMasse, kandidaten);
  pruefe(vorschlagBreite.quelle === 'aehnliches-modell', "Quelle ist 'aehnliches-modell'");
  pruefe(vorschlagBreite.meter === 4.0, `Breite-Vorschlag ist 4.0 (${vorschlagBreite.meter})`);
  const vorschlagHoehe = schlageZielgroesseVor('Marktstand2', 'hoehe', rohMasse, kandidaten);
  pruefe(vorschlagHoehe.meter === 3.37, `Höhe-Vorschlag folgt der gewählten Dimension: 3.37 (${vorschlagHoehe.meter})`);

  // Mehrere Nummern desselben Kerns: U_Marktstand1 UND U_Marktstand2 sind
  // registriert, aber KEIN kanonisches "U_Marktstand" ohne Zahl — dann
  // gewinnt der erste Treffer in Registrierreihenfolge (deterministisch).
  const nurNummeriert = [
    kandidat({ name: 'U_Marktstand1', anzeigename: 'Marktstand1', breite: 3.5 }),
    kandidat({ name: 'U_Marktstand9', anzeigename: 'Marktstand9', breite: 5.5 }),
  ];
  const v = schlageZielgroesseVor('Marktstand3', 'breite', rohMasse, nurNummeriert);
  pruefe(v.quelle === 'aehnliches-modell' && v.meter === 3.5, `ohne kanonisches Vorbild: erster Treffer gewinnt (${v.meter})`);

  // Ein kanonisches Vorbild OHNE Zahl gewinnt, auch wenn es NACH den
  // nummerierten Varianten in der Liste steht.
  const mitKanonisch = [
    kandidat({ name: 'U_Marktstand1', anzeigename: 'Marktstand1', breite: 3.5 }),
    kandidat({ name: 'U_Marktstand', anzeigename: 'Marktstand', breite: 4.0 }),
  ];
  const v2 = schlageZielgroesseVor('Marktstand2', 'breite', rohMasse, mitKanonisch);
  pruefe(v2.meter === 4.0, `kanonisches Vorbild (ohne Zahl) gewinnt trotz Reihenfolge (${v2.meter})`);
}

console.log('\n2. `ausschlussName` — ein Modell schlägt sich beim "nachträglich ändern" nicht selbst vor\n');
{
  // Nur EIN Kandidat: das Modell selbst (schon registriert, Aufruf über
  // die "nachträglich ändern"-Maske). Ohne Ausschluss ist es der einzige
  // Treffer und würde sich SELBST als Vorbild vorschlagen (seine eigene,
  // rohe 1,0 m) — sinnlos, weil das keine neue Information liefert.
  const nurSichSelbst = [kandidat({ name: 'U_Marktstand2', anzeigename: 'Marktstand2', breite: 1.0, hoehe: 0.72 })];
  const rohMasse = { breite: 1.0, hoehe: 0.72 };
  const ohneAusschluss = schlageZielgroesseVor('Marktstand2', 'breite', rohMasse, nurSichSelbst);
  pruefe(
    ohneAusschluss.quelle === 'aehnliches-modell' && ohneAusschluss.meter === 1.0,
    `ohne ausschlussName: das Modell schlägt sich selbst vor (${ohneAusschluss.meter}, ${ohneAusschluss.quelle})`
  );
  const mitAusschluss = schlageZielgroesseVor('Marktstand2', 'breite', rohMasse, nurSichSelbst, 'U_Marktstand2');
  pruefe(
    mitAusschluss.quelle !== 'aehnliches-modell',
    `mit ausschlussName: das Modell fällt als eigenes Vorbild weg (bekommen ${mitAusschluss.quelle})`
  );

  // Mit einem ZWEITEN, echten Vorbild daneben gewinnt (mit Ausschluss)
  // genau dieses, statt auf die Kategorie zurückzufallen.
  const mitEchtemVorbild = [
    kandidat({ name: 'U_Marktstand2', anzeigename: 'Marktstand2', breite: 1.0, hoehe: 0.72 }),
    kandidat({ name: 'U_Marktstand', anzeigename: 'Marktstand', breite: 4.0, hoehe: 3.37 }),
  ];
  const v = schlageZielgroesseVor('Marktstand2', 'breite', rohMasse, mitEchtemVorbild, 'U_Marktstand2');
  pruefe(
    v.quelle === 'aehnliches-modell' && v.meter === 4.0,
    `mit ausschlussName UND einem echten Vorbild daneben: U_Marktstand gewinnt (${v.meter})`
  );
}

console.log('\n3. (b) Größentabelle — kein ähnliches Modell, aber ein GANZES Wort aus der Liste passt\n');
{
  // B2 (Nachangriff N2): Komposita treffen jetzt NUR noch über eine
  // ausdrückliche Liste (holzfass, marktstand, zaunstück/palisadenstück,
  // drachenboot/langschiff, langhaus/halle), nie mehr über ein Wortende —
  // "Bierfass"/"Schatztruhe"/"Ochsenkarren"/"Fischerhütte" sind darum HIER
  // bewusst durch ein vorangestelltes Wort ERSETZT ("Volles Fass" statt
  // "Bierfass"): Der Bestandteil "fass" ist dann ein eigener, GANZER
  // Bestandteil (Leerzeichen trennt), kein Kompositum-Ende mehr.
  const rohMasse = { breite: 1.0, hoehe: 1.0 };
  const faelle: [string, number][] = [
    ['Neues Langhaus', 8],
    ['Kleine Hütte', 8],
    ['Marktbude Nord', 4],
    ['Palisadenstück', 2],
    ['Volles Fass', 0.7],
    ['Alte Truhe', 1],
    ['Brauner Karren', 3],
    ['Drachenboot Rot', 10],
  ];
  for (const [name, erwartet] of faelle) {
    const v = schlageZielgroesseVor(name, 'breite', rohMasse, []);
    pruefe(v.quelle === 'kategorie' && v.meter === erwartet, `'${name}' -> Kategorie ${erwartet} m (bekommen ${v.meter}, ${v.quelle})`);
  }
  // B2 (Nachangriff N2): "Marktstandzaun" endet auf "zaun" — als GANZER
  // unzerlegter Bestandteil "marktstandzaun" trifft es aber weder "zaun"
  // (kein Kompositum-Ende mehr) noch "marktstand" (das steht nicht am
  // ENDE des Bestandteils) — unter der neuen, strengeren Regel also KEIN
  // Treffer mehr. „Lieber kein Vorschlag als ein falscher" (Auftrag B2–B6).
  pruefe(kategorieFuerName('Marktstandzaun') === null, "'Marktstandzaun' trifft unter der neuen Regel KEINE Kategorie mehr (kein Kompositum-Ende)");
}

console.log('\n4. (c) Rohgröße — weder ähnliches Modell noch Kategorie passt\n');
{
  const rohMasse = { breite: 2.345, hoehe: 1.111 };
  const vBreite = schlageZielgroesseVor('Mysteriöses Ding', 'breite', rohMasse, []);
  pruefe(vBreite.quelle === 'rohgroesse' && vBreite.meter === 2.345, `Breite fällt auf die Rohgröße zurück (${vBreite.meter})`);
  const vHoehe = schlageZielgroesseVor('Mysteriöses Ding', 'hoehe', rohMasse, []);
  pruefe(vHoehe.quelle === 'rohgroesse' && vHoehe.meter === 1.111, `Höhe fällt auf die Rohgröße zurück (${vHoehe.meter})`);
  pruefe(kategorieFuerName('Mysteriöses Ding') === null, "kein Kategorie-Treffer für 'Mysteriöses Ding'");
}

console.log('\n5. Reihenfolge: ein ähnliches Modell schlägt die Kategorie, auch wenn beide passen würden\n');
{
  // "Marktstand2" triggert sowohl (a) über U_Marktstand ALS AUCH (b) über
  // das Muster "markt" in der Tabelle -- (a) muss gewinnen.
  const kandidaten = [kandidat({ name: 'U_Marktstand', anzeigename: 'Marktstand', breite: 4.0 })];
  const v = schlageZielgroesseVor('Marktstand2', 'breite', { breite: 1.0, hoehe: 1.0 }, kandidaten);
  pruefe(v.quelle === 'aehnliches-modell', `(a) gewinnt vor (b), obwohl beide passen würden (bekommen ${v.quelle})`);
}

console.log('\n6. cm-Verdacht — Warnung ab > 50 m, keine an der Schwelle selbst\n');
{
  pruefe(CM_VERDACHT_SCHWELLE_M === 50, `Schwelle ist 50 m (${CM_VERDACHT_SCHWELLE_M})`);
  pruefe(cmVerdacht({ breite: 1, hoehe: 1, tiefe: 1 }) === false, 'normale Größe löst keinen Verdacht aus');
  pruefe(cmVerdacht({ breite: CM_VERDACHT_SCHWELLE_M, hoehe: 1, tiefe: 1 }) === false, 'GENAU an der Schwelle (50) noch kein Verdacht');
  pruefe(cmVerdacht({ breite: CM_VERDACHT_SCHWELLE_M + 0.001, hoehe: 1, tiefe: 1 }) === true, 'knapp über der Schwelle -> Verdacht');
  pruefe(cmVerdacht({ breite: 1, hoehe: 1, tiefe: 51 }) === true, 'jede der drei Kanten kann den Verdacht auslösen (hier: Tiefe)');
  // Realistischer Fall: ein 2 m hoher Tisch, in cm exportiert -> 200 auf jeder Kante.
  pruefe(cmVerdacht({ breite: 200, hoehe: 150, tiefe: 90 }) === true, 'typischer cm-Export (200 × 150 × 90) löst den Verdacht aus');
}

console.log('\n7. Nachweis-Tabelle B2–B6 (Nachangriff N2) — kein Treffer\n');
{
  // Jedes dieser Wörter ist ENTWEDER ein Kompositum-ENDE, das die alte
  // N2-Regel noch fing (B4: Gegenstand/Zustand/Abstand/Vogelhaus/
  // Puppenhaus/Skybox), ODER eine CamelCase-Schreibweise, die die alte
  // Regel durch den Wortanfang wieder öffnete (B3: StandUhr/BoxSack/
  // WagenRad/FassAde), ODER ein „stück"-Wort ohne den Zaun-Wortanfang
  // (B2: Frühstück/Goldstück/Möbelstück/Werkstück/Stück), ODER ein
  // doppelsinniges Kurzwort in einem längeren Bestandteil (Leather_Boot,
  // Friendship). Unter der neuen Regel (ganzes Wort aus einer festen
  // Liste, nie Kompositum-Ende) treffen sie alle NICHT.
  const keineKategorie = [
    'Frühstück', 'Goldstück', 'Möbelstück', 'Werkstück', 'Stück',
    'StandUhr', 'BoxSack', 'WagenRad', 'FassAde',
    'Gegenstand', 'Zustand', 'Abstand',
    'Vogelhaus', 'Puppenhaus', 'Skybox',
    'Leather_Boot', 'Friendship',
  ];
  for (const name of keineKategorie) {
    const treffer = kategorieFuerName(name);
    pruefe(treffer === null, `'${name}' trifft KEINE Kategorie (bekommen '${treffer?.kategorie}')`);
  }
  // Zusätzlich die schon aus N1/N2 bekannten Fehltreffer, die weiterhin
  // abgewiesen bleiben müssen.
  for (const name of ['Fassade', 'Fassung', 'Standuhr', 'Boxsack', 'Abstandshalter', 'Abstandhalter', 'Wagenräder', 'Wagenrad', 'Fassadenteil', 'Shuttle', 'Boxhandschuh']) {
    pruefe(kategorieFuerName(name) === null, `'${name}' trifft weiterhin KEINE Kategorie`);
  }
}

console.log('\n8. Nachweis-Tabelle B2–B6 (Nachangriff N2) — richtiger Treffer\n');
{
  const faelle: [string, string][] = [
    ['Fass.001', 'Fass'],
    ['Barrel.001', 'Fass'],
    ['Kiste(1)', 'Kiste'],
    ['Haus.glb', 'Haus'],
    ['Kisten', 'Kiste'],
    ['Hütten', 'Haus'],
    ['Boote', 'Boot'],
    ['Wooden Hut', 'Haus'],
    [`Holzhu${'̈'}tte`, 'Haus'], // NFD: 'u' + KOMBINIERENDER TREMA statt 'ü' (macOS-Dateiname)
    [`Zaunstu${'̈'}ck`, 'Zaunstück'], // NFD-Zaunstück, dieselbe Bauart
    ['Holzfass', 'Fass'],
    ['Marktstand2', 'Marktstand'],
  ];
  for (const [name, erwartet] of faelle) {
    const treffer = kategorieFuerName(name);
    pruefe(treffer?.kategorie === erwartet, `'${name}' -> '${erwartet}' (bekommen '${treffer?.kategorie}')`);
  }
}

console.log('\n9. Ähnlichkeitsvergleich ist umlaut- und NFD-unabhängig (N3/F6) — Käsestand2, NFD-Käsestand2, Crêpestand2\n');
{
  const rohMasse = { breite: 1.0, hoehe: 1.0 };
  const kandidaten = [kandidat({ name: 'U_Kaesestand', anzeigename: 'Käsestand', breite: 3.0 })];
  const v1 = schlageZielgroesseVor('Käsestand2', 'breite', rohMasse, kandidaten);
  pruefe(
    v1.quelle === 'aehnliches-modell' && v1.meter === 3.0,
    `'Käsestand2' (mit Umlaut) findet 'Käsestand' (${v1.meter}, ${v1.quelle})`
  );
  const v2 = schlageZielgroesseVor('Kaesestand2', 'breite', rohMasse, kandidaten);
  pruefe(
    v2.quelle === 'aehnliches-modell' && v2.meter === 3.0,
    `'Kaesestand2' (ausgeschrieben) findet ebenfalls 'Käsestand' (${v2.meter}, ${v2.quelle})`
  );

  // 'K', 'a', KOMBINIERENDER TREMA (U+0308), 'sestand2' — dieselbe Anzeige
  // wie 'Käsestand2', aber ZERLEGT statt als ein einziges Zeichen 'ä'
  // (genau die Schreibweise, die macOS für Dateinamen liefert).
  const nfd = `K${'ä'}sestand2`;
  pruefe(nfd !== 'Käsestand2', 'Gegenprobe: die NFD-Schreibweise ist als JS-String tatsächlich ANDERS als die vorkomponierte');
  pruefe(nfd.normalize('NFC') === 'Käsestand2', 'Gegenprobe: NFC-normalisiert sind beide dieselbe Zeichenkette');
  const v3 = schlageZielgroesseVor(nfd, 'breite', rohMasse, kandidaten);
  pruefe(
    v3.quelle === 'aehnliches-modell' && v3.meter === 3.0,
    `NFD-'Käsestand2' findet 'Käsestand' (${v3.meter}, ${v3.quelle})`
  );

  // Nebenbefund F6: ein anderer Akzent (nicht in der Umlauttabelle) verliert
  // ihn zwar, behält aber den Grundbuchstaben — 'Crêpestand' und
  // 'Crepestand2' finden sich gegenseitig.
  const kandidatenCrepe = [kandidat({ name: 'U_Crepestand', anzeigename: 'Crêpestand', breite: 2.5 })];
  const vCrepe = schlageZielgroesseVor('Crepestand2', 'breite', rohMasse, kandidatenCrepe);
  pruefe(
    vCrepe.quelle === 'aehnliches-modell' && vCrepe.meter === 2.5,
    `'Crepestand2' (ohne Akzent) findet 'Crêpestand' (${vCrepe.meter}, ${vCrepe.quelle})`
  );
}

console.log(fehler === 0 ? '\nOK — Vorschlagslogik korrekt.\n' : `\n${fehler} FEHLER\n`);
process.exit(fehler > 0 ? 1 : 0);
