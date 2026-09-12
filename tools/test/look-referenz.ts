/**
 * Prüft: dass der Boden die Zahlen des VORBILDS trägt und nicht wieder
 * die des Labors.
 *
 * Bis zum 10.09.2026 stand hier das Gegenteil: Der Test hielt vier am
 * Referenzbild kalibrierte TÖNUNGEN fest und wäre rot geworden, wenn
 * jemand sie neutralisiert. Genau das ist inzwischen passiert, und zwar
 * mit Grund — `design/original-boden.md` ist aus den Spieldateien selbst
 * gelesen, und dort gibt es keine Tönung (F24). Ein Test, der eine
 * Erfindung bewacht, ist schlimmer als keiner: Er macht sie unantastbar.
 *
 *   npx tsx tools/test/look-referenz.ts
 *
 * ── Wogegen er jetzt steht ───────────────────────────────────────────
 *
 *  (a) EINE ZEILE BEKOMMT WIEDER EINE TÖNUNG. Der nächste „der Hang ist
 *      zu hell"-Befund lässt sich in zehn Minuten mit einem Faktor
 *      erschlagen — und legt damit eine Lichtfarbe in die Albedo zurück.
 *      Wer eine Tönung braucht, braucht zuerst eine Messung am Vorbild.
 *
 *  (b) EINE OBERFLÄCHE FÄLLT AUF DIE ALTEN WERTE ZURÜCK. Metallic 0,85
 *      auf `rock-a` und Kachel 3 m / Normale 5 auf `rock-rough` sind
 *      die zwei Zahlenpaare, die Mikes Befund „ich lese den Fels als
 *      Erde" erzeugt haben. Dass `SCHICHTEN` und `SCHICHT_OBERFLAECHE`
 *      dieselben Zahlen führen, prüft `terrain-schichten.ts`; WELCHE
 *      Zahlen richtig sind, dieser Test.
 *
 *  (c) DIE RAMPE STELLT WIEDER HART AUF FELS. Das Vorbild hat bei ≥ 45°
 *      nur 0,425 Felsgewicht — Moos bleibt in der Wand. Ohne Deckel
 *      steht dort 1,0, und das ist nicht eine feinere Fassung derselben
 *      Karte, sondern eine andere Aussage.
 *
 *  (d) DIE HALMHÖHE LÄUFT WEG. Das Vorbild misst 0,50–0,75 m (hoch) und
 *      0,25–0,38 m (kurz am Steilhang). Die alte Zahl 0,64–1,04 m war
 *      aus dem Bild gegen eine Figur geschätzt, die näher an der Kamera
 *      stand; die Detail-Prototypen sagen es genauer.
 *
 *  (e) GRAS WIRFT PLÖTZLICH SCHATTEN — unverändert, siehe unten.
 *  (f) EIN LAUBMATERIAL REISST AUS — unverändert, siehe unten.
 *  (g) EIN VORRANG OHNE ORIGINALZAHL kommt zurück.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ZUORDNUNG, SCHICHTEN } from '../store-terrain-schichten.mjs';
import { RAMPEN, nyBeiGrad } from '../../client/src/engine/TerrainSplat.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const STORE_LAB_VEG = join(WURZEL, 'assets/store-lab/vegetation');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── (a) Keine Zeile trägt eine Tönung ────────────────────────────────
/*
  Das Vorbild färbt keine Bodentextur um: alle `m_DiffuseRemapMin/Max`
  stehen auf 0…1, alle `m_Specular` sind schwarz, und das gilt für ALLE
  zwölf Terrains des Spiels (design/original-boden.md §A, F24). Die
  Farbe kommt aus Sonne, Grundlicht, Nebel und Grading — vier Stellen,
  die jede ihre eigene gemessene Zahl haben.

  Geprüft wird nicht „ungefähr neutral", sondern EXAKT 1: Ein Faktor
  0,98 wäre bereits wieder eine Meinung ohne Messung.
*/
{
  const bunt = (ZUORDNUNG as Array<{ name: string; toenung?: number[] }>)
    .filter((z) => z.toenung && !z.toenung.every((t) => t === 1))
    .map((z) => `${z.name} [${z.toenung!.join(', ')}]`);
  check(
    `keine der ${ZUORDNUNG.length} Zeilen trägt eine Tönung (das Vorbild hat keine — F24)`,
    bunt.length === 0,
    bunt.join('; ')
  );
}

// ── (b) Die Oberflächen stehen auf den Werten des Vorbilds ───────────
/*
  Tabelle A der Spezifikation, Spalte für Spalte. Sie steht hier ein
  zweites Mal, und das ist Absicht: `SCHICHTEN` ist der Ort, an dem
  jemand eine Zahl ändert, dieser Block der Ort, an dem er dafür einen
  Grund nennen muss.

  Welche Store-Datei welche Ebene des Vorbilds ist, steht im Kopf von
  `tools/store-terrain-schichten.mjs`. `rock-rough` ist die eine Zeile
  mit einer Ersatzrechnung: Die Diffuse-Textur von
  `Terrain_Meadow_Rock_Moss_01` liegt nicht im Speicher, übernommen sind
  deshalb nur Kachelmaß und Normalstärke.
*/
{
  type Oberflaeche = { kachelMeter: number; normalStaerke: number; metallic: number; smoothness: number };
  const ORIGINAL: Record<string, [Oberflaeche, string]> = {
    'gravel-path': [{ kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 }, 'Ani Dark Pebbles_Sand'],
    gravel: [{ kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 }, 'Ani Dark Pebbles_Sand'],
    'rock-a': [{ kachelMeter: 5, normalStaerke: 1.5, metallic: 0.2, smoothness: 0.2 }, 'Ani Dark Rockwall 3'],
    'grass-a': [{ kachelMeter: 2, normalStaerke: 2, metallic: 0.7, smoothness: 0 }, 'Ani Grass 2'],
    'grass-b': [{ kachelMeter: 2, normalStaerke: 2, metallic: 0.7, smoothness: 0 }, 'Ani Grass 2 (geerbt)'],
    'rock-rough': [{ kachelMeter: 7, normalStaerke: 2, metallic: 0, smoothness: 0 }, 'Terrain_Meadow_Rock_Moss_01'],
    moss: [{ kachelMeter: 2, normalStaerke: 1.2, metallic: 0, smoothness: 0 }, 'Moss very Dark'],
  };
  const ist = SCHICHTEN as Record<string, Oberflaeche>;
  for (const [name, [soll, ebene]] of Object.entries(ORIGINAL)) {
    const s = ist[name];
    if (!s) {
      check(`Schicht ${name} existiert`, false);
      continue;
    }
    const abweichung = (Object.keys(soll) as Array<keyof Oberflaeche>)
      .filter((k) => Math.abs(s[k] - soll[k]) > 1e-6)
      .map((k) => `${k} ${s[k]} statt ${soll[k]}`);
    check(`${name} trägt die Werte von „${ebene}"`, abweichung.length === 0, abweichung.join(', '));
  }
  /*
    Die zwei Zahlen, an denen es zuletzt gehangen hat, noch einmal
    namentlich — damit ein Rückfall nicht nur als „eine Abweichung"
    dasteht, sondern mit seiner Geschichte:
  */
  check(
    'rock-a ist NICHT mehr `Ani Dark Rockwall` (Metallic 0,85 / 2 m) — die benutzt Level1 nicht (F25)',
    ist['rock-a']!.metallic < 0.5 && ist['rock-a']!.kachelMeter > 3
  );
  check(
    'keine Schicht trägt Normalstärke 5 — das Maximum aller im Spiel BENUTZTEN Ebenen ist 3,0 (F27)',
    Object.values(ist).every((s) => s.normalStaerke <= 3)
  );
}

// ── (c) Die Rampe hat einen Deckel ───────────────────────────────────
/*
  Das Felsgewicht des Vorbilds je Neigungsband (§A, „Die Rampe ist
  gemalt, nicht gerechnet — mit Zahlen"):

      < 15°  0,076    15–30°  0,110    30–45°  0,216    ≥ 45°  0,425

  Nachgerechnet wird mit DERSELBEN Formel, die der Shader fährt (der
  Kommentar bei `RAMPEN` erklärt, warum sie in `ny` und nicht in Grad
  läuft):

      kF = clamp((cos B_f − ny) / (cos B_f − cos V_f)) · anteil_f
      kR = clamp((cos B_r − ny) / (cos B_r − cos V_r)) · anteil_r
      Fels = kF · (1 − kR) + kR

  Zwei Bänder KANN diese Formel nicht treffen, und das ist kein Fehler,
  sondern der Befund: Unter 30° hat das Vorbild 0,076 bis 0,110 Fels,
  weil sein Autor einen FLUSSLAUF und Grate gemalt hat — eine Karte,
  die eine Neigungsformel nicht kennt (F21). Wer sie nachahmen wollte,
  müsste Fels gleichmässig über jede flache Wiese streuen; gemessen ist,
  wie das aussieht (Kommentar bei `RAMPEN`: „ein Steinschleier über
  jedem Grashügel"). Geprüft werden deshalb die zwei Bänder, in denen
  die Neigung wirklich die Ursache ist — und der Deckel.
*/
{
  const felsGewicht = (grad: number): number => {
    const ny = nyBeiGrad(grad);
    const rampe = (b: number, v: number): number =>
      Math.min(1, Math.max(0, (nyBeiGrad(b) - ny) / (nyBeiGrad(b) - nyBeiGrad(v))));
    const kF = rampe(RAMPEN.fels.beginn, RAMPEN.fels.voll) * RAMPEN.fels.anteil;
    const kR = rampe(RAMPEN.rau.beginn, RAMPEN.rau.voll) * RAMPEN.rau.anteil;
    return kF * (1 - kR) + kR;
  };
  /** Mittleres Gewicht über ein Band, gleichverteilt in GRAD abgetastet. */
  const bandMittel = (von: number, bis: number): number => {
    let s = 0;
    const n = 60;
    for (let i = 0; i < n; i++) s += felsGewicht(von + ((bis - von) * (i + 0.5)) / n);
    return s / n;
  };

  const b3045 = bandMittel(30, 45);
  check(
    `Felsgewicht 30–45° ${b3045.toFixed(3)} liegt bei den 0,216 des Vorbilds (±0,06)`,
    Math.abs(b3045 - 0.216) <= 0.06
  );
  const b45 = bandMittel(45, 60);
  check(
    `Felsgewicht ≥ 45° ${b45.toFixed(3)} liegt bei den 0,425 des Vorbilds (±0,08)`,
    Math.abs(b45 - 0.425) <= 0.08
  );
  /*
    Der Deckel ist die eigentliche Aussage dieses Blocks. Vor dem
    10.09.2026 hatte `rau` keinen `anteil` und deckte damit voll: Ab 50°
    stand der Boden auf 1,0 Fels, während das Vorbild dort 0,425 hat.
    Genau das zeigt Bild 2 der Referenz — grüne Moosinseln mitten in der
    Felswand.
  */
  check(
    'bei 90° bleibt Fels unter 0,60 — Moos bleibt in der Wand (Vorbild 0,425)',
    felsGewicht(90) < 0.6,
    felsGewicht(90).toFixed(3)
  );
  check(
    'unter 25° bleibt der Boden felsfrei (kein Steinschleier über der Wiese)',
    felsGewicht(25) === 0,
    felsGewicht(25).toFixed(3)
  );
  /*
    Übergangsbreite: Das Vorbild misst 2,7–4,3 m Median-Kantenbreite
    (§A). Eine GRADSPANNE ist etwas anderes als eine Meterbreite — sie
    hängt an der Krümmung des Hangs. Die Umrechnung steht in F23: An
    einem 30°-Hang entsprechen 10° Spanne rund 3 bis 5 m. Geprüft wird
    deshalb die Spanne, mit der Zahl aus dem Vorbild als Begründung.
  */
  for (const [name, r] of [
    ['hang', RAMPEN.hang],
    ['fels', RAMPEN.fels],
    ['rau', RAMPEN.rau],
  ] as const) {
    const spanne = r.voll - r.beginn;
    check(
      `Rampe ${name} spannt ${spanne}° — an einem 30°-Hang 3 bis 5 m (Vorbild 2,7–4,3 m, F23)`,
      spanne >= 8 && spanne <= 16
    );
  }
}

// ── (d) Die Halmhöhen des Vorbilds ───────────────────────────────────
/*
  §B der Spezifikation, Detail-Prototypen 0/5 und 2/6. Die Höhe ist
  `Prefab-Höhe × H-Skala`; unser Store-Büschel ist 0,223 m hoch, die
  Skala steht als `storeScale.prefabScale[1]` mal `scaleMin`/`scaleMax`.

      0/5  SM_Env_Grass_Short_Clump_01   0,50–0,75 m   überall
      2/6  dasselbe Prefab, kleiner      0,25–0,38 m   am Steilhang

  Die alte Zahl 0,64–1,04 m stammte aus `design/look-referenz.md` und
  war gegen eine Figur gemessen, die im Bild NÄHER an der Kamera steht
  als die Büschel — die Schätzung ist damit systematisch zu hoch (F28).
*/
{
  const quelle = readFileSync(join(WURZEL, 'client/src/engine/GrassClutter.ts'), 'utf8');
  const MODELL_HOEHE = 0.223;
  const ZIEL: Record<string, [number, number]> = {
    meadowsGrass: [0.5, 0.75],
    meadowsGrassShort: [0.25, 0.38],
  };
  for (const [key, ziel] of Object.entries(ZIEL)) {
    const [untenSoll, obenSoll] = ziel;
    const m = new RegExp(
      `key: '${key}'[^\\n]*?storeScale: \\{ prefabScale: \\[[0-9.]+, ([0-9.]+), [0-9.]+\\], scaleMin: ([0-9.]+), scaleMax: ([0-9.]+) \\}`
    ).exec(quelle);
    check(`${key} führt eine storeScale`, Boolean(m), 'Muster nicht gefunden');
    if (!m) continue;
    const unten = MODELL_HOEHE * Number(m[1]) * Number(m[2]);
    const oben = MODELL_HOEHE * Number(m[1]) * Number(m[3]);
    check(
      `${key}: ${unten.toFixed(2)}–${oben.toFixed(2)} m trifft die ${untenSoll}–${obenSoll} m des Vorbilds (±0,05)`,
      Math.abs(unten - untenSoll) <= 0.05 && Math.abs(oben - obenSoll) <= 0.05,
      `prefabScale.y ${m[1]}, scaleMin ${m[2]}, scaleMax ${m[3]}`
    );
  }
  /*
    Und die zweite Hälfte von F29: Kurzes Gras gehört an den HANG, nicht
    in die Ebene. Im Vorbild wachsen die Prototypen 2 und 6 zu 89 %
    beziehungsweise 76 % über 30° (§B, „Wo wächst was"), während die
    Blumen bei über 22° praktisch aus sind. Ohne `minTiltCos` stünden
    beide Grashöhen auf derselben Fläche und unterschieden sich nur in
    der Menge — das ist der Zustand, den diese Zeile beendet.
  */
  check(
    'meadowsGrassShort ist an die Neigung gebunden (minTiltCos)',
    /key: 'meadowsGrassShort'[^\n]*?minTiltCos:/.test(quelle),
    'ohne die Bindung wächst kurzes Gras in der Ebene statt am Steilhang (F29)'
  );
  /*
    Die Tönungskarte des Wiesengrases: Das Vorbild führt `healthyColor`
    und `dryColor` seiner Detail-Ebenen auf WEISS (§B, F30) — es tönt
    seine Grasmeshes nicht. `terrainTint` muss für die beiden
    Store-Einträge deshalb aus sein.
  */
  for (const key of ['meadowsGrass', 'meadowsGrassShort']) {
    const zeile = new RegExp(`key: '${key}'[^\\n]*`).exec(quelle)?.[0] ?? '';
    check(
      `${key} tönt nicht über das Terrain (Vorbild: healthyColor = dryColor = weiss, F30)`,
      /terrainTint: false/.test(zeile),
      zeile.slice(0, 80)
    );
  }
}

// ── (e) Gras wirft weiterhin keinen Schatten ─────────────────────────
/*
  Zwei Hälften einer Zusage, und sie stehen in zwei Dateien: GrassClutter
  benennt seine Meshes `clutter_<zelle>_<eintrag>`, Shadows.ts wirft alles
  aus der Werferliste, was mit `clutter` beginnt. Beide Hälften werden
  hier gegeneinander gehalten — eine Umbenennung auf der einen Seite
  bricht die Zusage auf der anderen, ohne dass irgendwo etwas rot wird.
*/
{
  const gras = readFileSync(join(WURZEL, 'client/src/engine/GrassClutter.ts'), 'utf8');
  const schatten = readFileSync(join(WURZEL, 'client/src/engine/Shadows.ts'), 'utf8');
  const name = /new Mesh\(`([a-z_]+)_\$\{key\}_\$\{variant\.entry\.key\}`/.exec(gras);
  check('GrassClutter benennt seine Zell-Meshes nach festem Muster', Boolean(name), 'new Mesh(...) nicht gefunden');
  const regexZeile = /const NIE_WERFEN =\s*\n?\s*(\/\^\([^\n]*\/i);/.exec(schatten);
  check('Shadows.ts führt NIE_WERFEN als verankerten Regex', Boolean(regexZeile), 'Muster nicht gefunden');
  if (name && regexZeile) {
    // Der Regex kommt aus dem EIGENEN Quelltext (Shadows.ts), nicht von
    // aussen; `Function` statt einer Nachbildung, damit hier nicht eine
    // zweite, abweichende Kopie der Regel entsteht.
    const re = new Function(`return ${regexZeile[1]!};`)() as RegExp;
    const beispiel = `${name[1]!}_12_-7_meadowsGrass`;
    check(
      `ein Clutter-Mesh (${beispiel}) fällt aus der Werferliste — ADR-0027 hängt nicht an der Halmhöhe`,
      re.test(beispiel)
    );
  }
}

// ── (g) Der Vorrang: nur, wo das Vorbild eine Zahl liefert ───────────
/*
  `TOENUNG_VORRANG` schlägt den `baseColorFactor`, den ein Store-Material
  aus dem Original mitbringt. Das ist ein starker Eingriff und darf
  deshalb genau einen Grund haben: dass die ANDERE Zahl auch aus dem
  Original stammt und die bessere ist.

    ahorn   BLEIBT. Der Store-Faktor [0,62, 1,00, 0,20] lässt den
            hellsten Laubatlas des Bestands ungebremst durch (2,39 ×
            Median); genommen wird statt dessen `Maple Leaves 1` aus den
            Spieldaten — eine gemessene Originalfarbe, keine Bildkorrektur.

    gras    IST RAUS (10.09.2026). Die Zahl [0,46, 0,22, 0,04] war aus
            Referenzbild 1 zurückgerechnet, also eine Bildkorrektur an
            der Albedo — genau die Sorte Eingriff, die diese Runde aus
            dem Boden entfernt hat. Das Vorbild tönt seine Grasbüschel
            nicht (`healthyColor` = `dryColor` = weiss, §B/F30); was der
            Halm an Farbe hat, hat er aus seinem Material, und das ist
            der Store-Faktor [0,85, 1,00, 0,60].
*/
{
  const quelle = readFileSync(join(WURZEL, 'tools/store-vegetation-aufbereiten.mjs'), 'utf8');
  const menge = /const TOENUNG_VORRANG = new Set\(\[([^\]]*)\]/.exec(quelle)?.[1] ?? '';
  check(
    'TOENUNG_VORRANG führt die Rolle ahorn (Originalmaterial „Maple Leaves 1")',
    /'ahorn'/.test(menge),
    menge
  );
  check(
    'TOENUNG_VORRANG führt gras NICHT mehr (die Zahl war aus dem Bild zurückgerechnet)',
    !/'gras'/.test(menge),
    menge
  );
  check(
    'der Vorrang wird vor dem Store-Faktor gelesen',
    /const gewaehlt = gemessen \?\? vorrang \?\? ausStore/.test(quelle),
    'die Reihenfolge in Schritt 2 ist die ganze Wirkung'
  );

  /*
    ── Und seit dem 11.09.2026 (A8) steht davor noch eine Stufe ───────

    `UNITY_JE_MATERIAL` gibt je QUELLMATERIAL die gemessene Farbe des
    Vorbilds. Das ist die stärkste Auskunft, die es gibt — dieselbe
    Alphakarte, aber die Farbe dessen, der sie benutzt hat, statt der
    des Asset-Herstellers. Sie muss deshalb ganz vorn stehen.

    Geprüft wird beides: dass die Tabelle die Materialien führt, die im
    Speicher wirklich vorkommen, und dass sie VOR dem Store-Faktor
    gelesen wird. Ohne die zweite Hälfte wäre die Tabelle da und
    wirkungslos, und das sähe man keiner Zeile an.
  */
  /*
    Seit dem 12.09.2026 stehen die Zahlen NICHT mehr im Werkzeug,
    sondern in `shared/src/laubSpitzen.ts` — dort führt der Client
    beide Farben des Vorbilds, und das Werkzeug rechnet sich sein
    Mittel daraus (`Bauer Laub-Spitzenfarben`). Geprüft wird deshalb
    die Tabelle an ihrem neuen Ort UND die Ableitung im Werkzeug: Eine
    Tabelle, aus der niemand mehr liest, wäre genauso wirkungslos wie
    eine fehlende.
  */
  const jeMaterial = readFileSync(join(WURZEL, 'shared/src/laubSpitzen.ts'), 'utf8');
  check(
    'das Werkzeug leitet UNITY_JE_MATERIAL aus shared/src/laubSpitzen.ts ab',
    /import \{ LAUB_SPITZEN, laubMittel \} from '\.\.\/shared\/src\/laubSpitzen\.js'/.test(quelle)
      && /const UNITY_JE_MATERIAL = Object\.fromEntries\(/.test(quelle),
    'sonst liegen dieselben Zahlen wieder zweimal im Baum'
  );
  const gefordert = [
    'Leaves 1', 'Leaves 2', 'Leaves 3',
    'Leaves Birch 1', 'Leaves Birch 2', 'Leaves Birch 3 Dark',
    'Pine 1', 'Pine 2', 'Maple Leaves 1',
    'Grass_Short_Plant_Leaves_1A1_Yellow',
  ];
  const fehlend = gefordert.filter((n) => !jeMaterial.includes(n));
  check(
    `LAUB_SPITZEN führt die ${String(gefordert.length)} Quellmaterialien des Speichers`,
    fehlend.length === 0,
    fehlend.join(', ')
  );
  check(
    'die gemessene Originalfarbe wird VOR dem Vorrang und dem Store-Faktor gelesen',
    /const gemessen = UNITY_JE_MATERIAL\[eintrag\.quellMat\]/.test(quelle) &&
      /gemessen \?\? vorrang/.test(quelle),
    'sonst steht die Tabelle da und wirkt nicht'
  );
  check(
    'grasGelb ist keine Schätzung mehr (Originalmaterial „…_Yellow")',
    jeMaterial.includes('Grass_Short_Plant_Leaves_1A1_Yellow'),
    'die letzte geratene Zeile des Bestands'
  );
}

// ── (f) Kein Laubmaterial reisst aus ─────────────────────────────────
/*
  Wogegen dieser Block steht: EIN Baum, der doppelt so hell ist wie
  seine Nachbarn. Das ist Mikes Befund vom 10.09.2026 („Bäume sind
  stellenweise sehr hell vom Blattlaub her, nicht alle, einzelne"), und
  es gibt dafür keine Fehlermeldung — die Datei lädt, das Material
  rendert, nur die Zahl darin ist eine andere als bei allen anderen.

  Gemessen wird, was am Bildschirm ankommt: der Atlasmittelwert über die
  DECKENDEN Texel (Alpha >= 128, linear gerechnet) MAL dem
  `baseColorFactor` des Materials. Beides steht in den AUFBEREITETEN
  GLBs unter `assets/store-lab/vegetation/`.

  Die Schranke ist relativ (1,3 × Median) und nicht absolut — sie wandert
  mit dem Bestand mit, und was hier auffällt, ist genau das, was auch im
  Bild auffällt. Ausnahme: Schnee IST hell, und dass er im Hohen Norden
  bleibt, prüft der Block darunter.
*/
async function laubZensus(): Promise<void> {
  if (!existsSync(STORE_LAB_VEG)) {
    console.log('   (assets/store-lab/vegetation fehlt — Laub-Zensus übersprungen, Weiche in run-tests.mjs)');
    return;
  }
  const atlas = new Map<string, [number, number, number]>();
  const zuLin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  /** Mittel der DECKENDEN Texel eines Atlas, linear. */
  async function atlasMittel(pfad: string): Promise<[number, number, number] | null> {
    const zwischen = atlas.get(pfad);
    if (zwischen) return zwischen;
    if (!existsSync(pfad)) return null;
    const { data, info } = await sharp(pfad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const k = info.channels;
    const summe = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < data.length; i += k) {
      if (data[i + 3]! < 128) continue;
      summe[0]! += zuLin(data[i]!);
      summe[1]! += zuLin(data[i + 1]!);
      summe[2]! += zuLin(data[i + 2]!);
      n++;
    }
    if (!n) return null;
    const m: [number, number, number] = [summe[0]! / n, summe[1]! / n, summe[2]! / n];
    atlas.set(pfad, m);
    return m;
  }

  /** Der JSON-Teil eines GLB. */
  function glbJson(pfad: string): Record<string, unknown> {
    const buf = readFileSync(pfad);
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.toString('utf8', 20, 20 + len)) as Record<string, unknown>;
  }

  type Zeile = { modell: string; material: string; luma: number; faktor: number[]; atlas: string };
  const zeilen: Zeile[] = [];
  /*
    NUR Laub. Die Grasbüschel stehen bewusst NICHT in dieser Familie:
    Sie haben ihre eigene Zielzahl im Vorbild (Bild 1, Büschel/Grund
    1,12), während das Laub gegen Krone/Boden und Krone/Himmel gemessen
    wird. Beide in einen Median zu werfen hiesse, zwei Zielvorgaben
    gegeneinander zu mitteln.
  */
  const LAUB_ROLLE = /^(laub|laubDunkel|laubSchnee|nadeln|ahorn)$/;
  for (const datei of readdirSync(STORE_LAB_VEG).filter((f) => f.endsWith('.glb')).sort()) {
    const j = glbJson(join(STORE_LAB_VEG, datei)) as {
      materials?: Array<{ name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } }>;
      textures?: Array<{ source: number }>;
      images?: Array<{ uri?: string }>;
    };
    for (const mat of j.materials ?? []) {
      const name = mat.name ?? '';
      if (!LAUB_ROLLE.test(name)) continue;
      const pbr = mat.pbrMetallicRoughness ?? {};
      const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
      const ti = pbr.baseColorTexture?.index;
      if (ti === undefined) continue;
      const uri = j.images?.[j.textures?.[ti]?.source ?? -1]?.uri;
      if (!uri) continue;
      const m = await atlasMittel(join(STORE_LAB_VEG, uri));
      if (!m) continue;
      const a = [m[0] * f[0]!, m[1] * f[1]!, m[2] * f[2]!];
      zeilen.push({
        modell: datei.replace(/\.glb$/, ''),
        material: name,
        luma: 0.2126 * a[0]! + 0.7152 * a[1]! + 0.0722 * a[2]!,
        faktor: f.slice(0, 3),
        atlas: basename(uri),
      });
    }
  }
  check('der Laub-Zensus findet Materialien', zeilen.length > 40, `${zeilen.length} Zeilen`);
  if (!zeilen.length) return;

  const sortiert = zeilen.map((z) => z.luma).sort((a, b) => a - b);
  const median = sortiert[Math.floor(sortiert.length / 2)]!;
  /*
    ── Warum 1,5 und nicht mehr 1,3 (A8, 11.09.2026) ─────────────────
    Die Schranke ist eine Ausreisser-Sperre, kein Zielwert. Mikes Befund
    war ein Material bei 2,39 × Median; 1,3 war damals der nächste runde
    Wert darunter.

    Seit A8 trägt JEDES Laubmaterial die gemessene Farbe des Vorbilds
    (`UNITY_JE_MATERIAL`), und der Median ist dadurch von 0,1376 auf
    0,1070 gefallen — die Familie ist als ganze dunkler geworden. Die
    SPREIZUNG ist damit die des Vorbilds selbst: von 0,0840
    (`Leaves Birch 3 Dark`) bis 0,1481 (`Maple Leaves 1`), also 1,38 ×
    Median am oberen Ende. Eine Schranke bei 1,3 würde ab jetzt die
    Originalfarbe des Ahorns beanstanden — sie wäre eine Sperre gegen
    die Quelle, aus der sie sich rechtfertigt.

    1,5 lässt die gemessene Spreizung durch und fängt den Fehlermodus
    weiter ab, um den es geht: ein Material, das ums Doppelte ausreisst.
  */
  const schranke = 1.5 * median;
  // Schnee darf hell sein — solange er im Hohen Norden bleibt.
  const schnee = /schnee|snow/i;
  const ausreisser = zeilen.filter((z) => z.luma > schranke && !(schnee.test(z.material) || schnee.test(z.modell)));
  check(
    `kein Laubmaterial über 1,5 × Median (Median ${median.toFixed(4)}, Schranke ${schranke.toFixed(4)}, ${zeilen.length} Materialien)`,
    ausreisser.length === 0,
    ausreisser.map((z) => `${z.modell}/${z.material} ${z.luma.toFixed(4)} = ${(z.luma / median).toFixed(2)} × [${z.faktor.join(', ')}]`).join('; ')
  );
  const ahorn = zeilen.filter((z) => z.material === 'ahorn');
  check('der Ahorn steht in der Familie (≤ 1,5 × Median)', ahorn.length > 0 && ahorn.every((z) => z.luma <= schranke),
    ahorn.map((z) => `${z.modell} ${z.luma.toFixed(4)} = ${(z.luma / median).toFixed(2)} ×`).join('; ') || 'kein ahorn-Material gefunden');
}

/*
  Die andere Hälfte der Schnee-Ausnahme: Sie gilt nur, weil die
  `-snow`-Modelle ausschliesslich im Hohen Norden stehen.
*/
{
  const flora = readFileSync(join(WURZEL, 'shared/src/storeFlora.ts'), 'utf8');
  const schneeZeilen = flora.split('\n').filter((l) => /name: '[^']*-snow'/.test(l));
  check('storeFlora führt Schnee-Modelle', schneeZeilen.length > 0, `${schneeZeilen.length}`);
  const zeilen = flora.split('\n');
  let block = '';
  const falsch: string[] = [];
  for (const l of zeilen) {
    const m = /^const ([A-Z_0-9]+):/.exec(l) ?? /^export const ([A-Z_0-9]+):/.exec(l);
    if (m) block = m[1]!;
    if (/name: '[^']*-snow'/.test(l) && !/HOCHNORD/.test(block)) falsch.push(`${block}: ${l.trim().slice(0, 60)}`);
  }
  check('jedes -snow-Modell steht in einer HOCHNORD-Liste', falsch.length === 0, falsch.join(' | '));
}

// ── Die zwei Referenzdateien ─────────────────────────────────────────
/*
  `original-boden.md` ist die Spezifikation (Zahlen aus den Spieldaten),
  `look-referenz.md` die Bildmessung (Verhältnisse aus den Screenshots).
  Beide werden gebraucht, und zwar für Verschiedenes: Die eine sagt,
  WAS eingestellt ist, die andere, WIE das Ergebnis aussehen muss.
*/
{
  const spez = join(WURZEL, 'design/original-boden.md');
  check('design/original-boden.md liegt im Repo', existsSync(spez));
  if (existsSync(spez)) {
    const text = readFileSync(spez, 'utf8');
    for (const [was, muster] of [
      ['die Schichttabelle (Tabelle A)', /Ani Dark Rockwall 3/],
      ['die Nebelzahlen', /m_LinearFogStart/],
      ['die Grading-Zahlen', /ShadowsMidtonesHighlights/],
    ] as const) {
      check(`original-boden.md führt ${was}`, muster.test(text));
    }
  }
  const pfad = join(WURZEL, 'design/look-referenz.md');
  check('design/look-referenz.md liegt im Repo', existsSync(pfad));
  if (existsSync(pfad)) {
    const text = readFileSync(pfad, 'utf8');
    // Ohne Rechtecke ist die Datei eine Meinung. Jede Messzeile muss ihr
    // Rechteck mitführen, sonst kann niemand nachmessen.
    const zeilen = text.split('\n').filter((l) => /^\| .+ \| \d+,\d+–\d+,\d+ \|/.test(l));
    check(`jede Messzeile führt ihr Rechteck mit (${zeilen.length} Zeilen)`, zeilen.length >= 18, String(zeilen.length));
  }
}

// ── Zum Schluss der asynchrone Zensus, dann das Urteil ───────────────
void laubZensus().then(() => {
  if (fehler > 0) {
    console.error(`\n${fehler} Fehlschläge`);
    process.exit(1);
  }
  console.log('\nalles grün');
});
