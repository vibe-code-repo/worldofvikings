#!/usr/bin/env node
/**
 * Erzeugt: die Bodenschichten des Vorbilds als Texturstapel für den Splat.
 *
 * Liest die sechs handgemalten Bodentexturen aus `assets/store/textures/`
 * (NUR lesend — der Store liegt ausserhalb des Repos) und baut daraus die
 * zwei Stapel, die `client/src/engine/TerrainSplat.ts` sampelt:
 *
 *   assets/generiert/terrain/store_d_array.png   Farbe,  16 Zeilen à K²
 *   assets/generiert/terrain/store_n_array.png   Normale, 16 Zeilen à K²
 *   assets/generiert/terrain/store-schichten.json  die Tabelle dazu
 *
 * `assets/` ist gitignored; die Dateien entstehen neu, wenn man das
 * Werkzeug laufen lässt. Der Dev-Server liefert den ganzen Ordner unter
 * `/assets/` aus (client/vite.config.ts, `assetHandler`), der Client lädt
 * sie also unter `/assets/generiert/terrain/`.
 *
 *   node tools/store-terrain-schichten.mjs                 # 512², Vorgabe
 *   node tools/store-terrain-schichten.mjs --kante 1024
 *   node tools/store-terrain-schichten.mjs --nur-pruefen    # nur die Tabelle
 *
 * ── Warum ein 16-Zeilen-Stapel und nicht sechs eigene Texturen ───────
 * Weil der Splat genau das schon sampelt. `terrain_d_array.png` ist ein
 * 256×4096-Stapel aus 16 Kacheln, und `vbTileSample_*` rechnet die
 * Zeilennummer aus dem Tile-Index des Vertex. Wer stattdessen sechs
 * Einzeltexturen bindet, muss die Auswahl im Shader nachbauen (sechs
 * `step()`-Masken je Abtastung, wie es die alte Normal-Map-Gruppierung
 * tut) und verliert die Eigenschaft, dass Farbe und Normale garantiert
 * dieselbe Zeile treffen. Derselbe Stapel für beides heisst: EIN
 * Zeilenindex, zwei Abtastungen, kein Auseinanderlaufen möglich.
 *
 * ── Warum nicht alle 16 Zeilen aus dem Store kommen ──────────────────
 * Zwei Zeilen bleiben Altbestand, und beide aus einem Grund, den man am
 * Bild sieht:
 *
 *   7  Ash        Die Asche der AshLands hat im Store keine Entsprechung.
 *                 Die Analyse sagt für dieses Biom „rauer Fels + Asche-
 *                 Altbestand" — der rauhe Fels kommt aus dem Store
 *                 (Zeilen 5/14), die Asche bleibt, was sie war.
 *   15 LavaCrust  Das ist gar keine Farbkachel, sondern die GRAUSTUFEN-
 *                 EMISSIONSMASKE der glühenden Risse (`emisSS` im Shader
 *                 liest ihren Rotkanal). Eine Store-Textur an dieser
 *                 Stelle würde die Risse dorthin legen, wo ihr Gestein
 *                 hell ist — sichtbar falsch, ohne Fehlermeldung.
 *
 * Beide werden aus `assets/textures/terrain_d_array.png` übernommen und
 * auf die Zielkante skaliert.
 *
 * ── Die Zahlen je Schicht ────────────────────────────────────────────
 * `kachelMeter`, `normalStaerke`, `metallic` und `smoothness` sind NICHT
 * geraten. Sie stehen im `terrain`-Block der Zone `village` von
 * `content/worlds/village1.json` des Schwesterprojekts, wo sie am Bild
 * kalibriert wurden (ADR-0032). Nachgelesen am 09.09.2026:
 *
 *   terrain-gravel-path  2 m  normal 3    metallic 0.75  smooth 0.10
 *   terrain-rock-a       2 m  normal 1.5  metallic 0.85  smooth 0.10
 *   terrain-grass-a      2 m  normal 2    metallic 0.50  smooth 0
 *   terrain-gravel       2 m  normal 3    metallic 0.75  smooth 0.10
 *   terrain-rock-rough   3 m  normal 5    metallic 0     smooth 0
 *   terrain-moss         2 m  normal 1.2  metallic 0     smooth 0
 *
 * `terrain-grass-b` führt der Weltdatei keine eigene Zeile; es teilt sich
 * die Normalmap mit `grass-a` und erbt deshalb dessen Werte.
 *
 * Metallic 0,5 bis 0,85 bei Glätte 0,1 ist der Kern des Looks und
 * zugleich seine Falle: Ein Boden mit Metallic 0,85 hat fast keine
 * Eigenfarbe mehr, er zeigt den Himmel. OHNE einen Himmelsterm im Shader
 * wird er schwarz. Der Term steht in `TerrainSplat.ts` (`terrainHimmel`);
 * diese Zahlen ohne ihn zu setzen ist ein Rückschritt, kein Fortschritt.
 *
 * ── Determinismus ────────────────────────────────────────────────────
 * Zweimal laufen lassen muss byteidentische Dateien ergeben, sonst ist
 * der Ordner bei jedem Lauf „geändert" und niemand kann mehr sehen, ob
 * sich etwas geändert HAT. Dafür: fester Skalierungskern (`lanczos3`),
 * feste PNG-Einstellungen, keine Zeitstempel, und die Tabelle wird mit
 * `JSON.stringify(..., 2)` in fester Schlüsselreihenfolge geschrieben.
 * `scripts/run-tests.mjs` fährt genau das nach.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const STORE = resolve(WURZEL, 'assets/store/textures');
const ALTBESTAND = resolve(WURZEL, 'assets/textures');
const AUS = resolve(WURZEL, 'assets/generiert/terrain');

/** Zeilen des Altbestand-Stapels — 16 Kacheln à 256², oben beginnend. */
const ALT_KANTE = 256;
const ZEILEN = 16;

/**
 * Die Schichten, wie sie im Store liegen, mit den Werten aus village1.json.
 *
 * `farbe` und `normale` sind Dateinamen ohne Endung unter `STORE`.
 */
export const SCHICHTEN = {
  'gravel-path': { farbe: 'terrain-gravel-path', normale: 'terrain-gravel-normal', kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 },
  'rock-a': { farbe: 'terrain-rock-a', normale: 'terrain-rock-a-normal', kachelMeter: 2, normalStaerke: 1.5, metallic: 0.85, smoothness: 0.1 },
  'grass-a': { farbe: 'terrain-grass-a', normale: 'terrain-grass-normal', kachelMeter: 2, normalStaerke: 2, metallic: 0.5, smoothness: 0 },
  'grass-b': { farbe: 'terrain-grass-b', normale: 'terrain-grass-normal', kachelMeter: 2, normalStaerke: 2, metallic: 0.5, smoothness: 0 },
  gravel: { farbe: 'terrain-gravel', normale: 'terrain-gravel-normal', kachelMeter: 2, normalStaerke: 3, metallic: 0.75, smoothness: 0.1 },
  'rock-rough': { farbe: 'terrain-rock-rough', normale: 'terrain-rock-rough-normal', kachelMeter: 3, normalStaerke: 5, metallic: 0, smoothness: 0 },
  moss: { farbe: 'terrain-moss', normale: 'terrain-moss-normal', kachelMeter: 2, normalStaerke: 1.2, metallic: 0, smoothness: 0 },
};

/**
 * Tile-Index → Schicht. Die Reihenfolge ist die von `TILE` in
 * `client/src/engine/TerrainSplat.ts` und darf sich nicht verschieben:
 * die Indizes stehen in den Vertex-Attributen jedes Chunks.
 *
 * `toenung` multipliziert die Farbe (linear gerechnet, nicht auf den
 * sRGB-Bytes — sonst dunkelt eine Tönung von 0,6 um mehr als 40 %).
 * Sie ist der Weg, aus sechs gemalten Schichten sechzehn Untergründe zu
 * machen, ohne eine siebte zu malen: Sumpfmoos ist dasselbe Moos, nur
 * dunkler und entsättigt.
 *
 * `altbestand: true` heisst „Zeile aus terrain_d_array.png übernehmen".
 */
export const ZUORDNUNG = [
  /* 0  Grass      */ { name: 'Grass', schicht: 'grass-a', toenung: [1, 1, 1] },
  /* 1  Forest     */ { name: 'Forest', schicht: 'moss', toenung: [0.88, 0.92, 0.85] },
  /* 2  Dirt       */ { name: 'Dirt', schicht: 'gravel', toenung: [1.15, 1.02, 0.85] },
  /* 3  Cleared    */ { name: 'Cleared', schicht: 'gravel-path', toenung: [0.9, 0.84, 0.74] },
  /* 4  Rock       */ { name: 'Rock', schicht: 'rock-a', toenung: [1, 1, 1] },
  /* 5  Cliff      */ { name: 'Cliff', schicht: 'rock-rough', toenung: [1, 1, 1] },
  /* 6  LavaEmber  */ { name: 'LavaEmber', schicht: 'rock-rough', toenung: [0.55, 0.4, 0.36] },
  /* 7  Ash        */ { name: 'Ash', altbestand: true },
  /* 8  Heath      */ { name: 'Heath', schicht: 'grass-b', toenung: [1.25, 1.12, 0.9] },
  /* 9  Sand       */ { name: 'Sand', schicht: 'gravel-path', toenung: [1.05, 1.0, 0.9] },
  /* 10 SwampMud   */ { name: 'SwampMud', schicht: 'moss', toenung: [0.62, 0.6, 0.52] },
  /* 11 Moss       */ { name: 'Moss', schicht: 'moss', toenung: [1, 1, 1] },
  /* 12 Paved      */ { name: 'Paved', schicht: 'gravel-path', toenung: [1, 1, 1] },
  /* 13 SwampDark  */ { name: 'SwampDark', schicht: 'gravel', toenung: [0.75, 0.75, 0.68] },
  /* 14 Basalt     */ { name: 'Basalt', schicht: 'rock-rough', toenung: [0.55, 0.53, 0.52] },
  /* 15 LavaCrust  */ { name: 'LavaCrust', altbestand: true },
];

/**
 * Normalmap-Zeile für die zwei Altbestand-Kacheln.
 *
 * KEINE flache Normale (128,128,255) — die wäre zwar unschädlich, aber
 * sie nähme der Asche das Relief, das sie heute hat. Die beiden erben
 * stattdessen die Gruppen-Normalmap, unter der sie im Altbestand liefen
 * (`vbTileNormalGroup`: Ash → Gruppe 2, LavaCrust → Gruppe 4).
 */
const ALT_NORMALE = { 7: 'terraintile_n_1', 15: 'gouacherock_big_n' };

/** sRGB-Byte → linear. */
function zuLinear(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
/** linear → sRGB-Byte. */
function zuSrgb(l) {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** 256er Nachschlagetabelle je Kanal — 3 statt 3·K² pow()-Aufrufe. */
function toenungsTabelle(faktor) {
  const t = new Uint8Array(256);
  for (let v = 0; v < 256; v++) t[v] = zuSrgb(zuLinear(v) * faktor);
  return t;
}

/** Ein RGB-Bild auf `kante`² bringen; Alpha fällt weg. */
async function laden(pfad, kante) {
  return sharp(pfad)
    .removeAlpha()
    .resize(kante, kante, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer();
}

/** Eine Zeile aus dem Altbestand-Stapel schneiden und auf `kante` bringen. */
async function altZeile(datei, zeile, kante) {
  return sharp(datei)
    .extract({ left: 0, top: zeile * ALT_KANTE, width: ALT_KANTE, height: ALT_KANTE })
    .removeAlpha()
    .resize(kante, kante, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer();
}

/** Prüft, dass jede Datei da ist, die die Tabelle verspricht. */
export function fehlendeDateien() {
  const fehlt = [];
  for (const s of Object.values(SCHICHTEN)) {
    for (const n of [s.farbe, s.normale]) {
      const p = resolve(STORE, `${n}.png`);
      if (!existsSync(p)) fehlt.push(p);
    }
  }
  if (!existsSync(resolve(ALTBESTAND, 'terrain_d_array.png'))) {
    fehlt.push(resolve(ALTBESTAND, 'terrain_d_array.png'));
  }
  for (const n of Object.values(ALT_NORMALE)) {
    const p = resolve(ALTBESTAND, `${n}.png`);
    if (!existsSync(p)) fehlt.push(p);
  }
  return fehlt;
}

/**
 * Die Tabelle, die der Client liest: je Tile-Index Herkunft und Material.
 *
 * `kachelFaktor` ist die Zahl, die im Shader steht: der Splat kachelt mit
 * `uvScale = 0.5`, also EINE Wiederholung je 2 Weltmeter. Eine Schicht mit
 * `kachelMeter: 3` braucht deshalb den Faktor 2/3.
 */
export function tabelle(kante) {
  return {
    kante,
    zeilen: ZEILEN,
    /** Weltmeter, die eine Wiederholung im Splat heute abdeckt (uvScale 0.5). */
    grundKachelMeter: 2,
    tiles: ZUORDNUNG.map((z, i) => {
      if (z.altbestand) {
        return {
          tile: i,
          name: z.name,
          quelle: 'altbestand',
          kachelMeter: 2,
          kachelFaktor: 1,
          normalStaerke: 0.7,
          metallic: 0,
          smoothness: 0.1,
        };
      }
      const s = SCHICHTEN[z.schicht];
      return {
        tile: i,
        name: z.name,
        quelle: z.schicht,
        farbe: s.farbe,
        normale: s.normale,
        toenung: z.toenung,
        kachelMeter: s.kachelMeter,
        kachelFaktor: +(2 / s.kachelMeter).toFixed(6),
        normalStaerke: s.normalStaerke,
        metallic: s.metallic,
        smoothness: s.smoothness,
      };
    }),
  };
}

async function baue(kante) {
  const fehlt = fehlendeDateien();
  if (fehlt.length) {
    console.error('[terrain-schichten] Es fehlen Dateien:\n  ' + fehlt.join('\n  '));
    process.exit(2);
  }
  mkdirSync(AUS, { recursive: true });
  const altArray = resolve(ALTBESTAND, 'terrain_d_array.png');

  const farbe = Buffer.alloc(kante * kante * ZEILEN * 3);
  const normale = Buffer.alloc(kante * kante * ZEILEN * 3);
  const zeilenBytes = kante * kante * 3;

  for (let i = 0; i < ZEILEN; i++) {
    const z = ZUORDNUNG[i];
    if (z.altbestand) {
      (await altZeile(altArray, i, kante)).copy(farbe, i * zeilenBytes);
      (await laden(resolve(ALTBESTAND, `${ALT_NORMALE[i]}.png`), kante)).copy(normale, i * zeilenBytes);
      continue;
    }
    const s = SCHICHTEN[z.schicht];
    const roh = await laden(resolve(STORE, `${s.farbe}.png`), kante);
    const [tr, tg, tb] = z.toenung.map(toenungsTabelle);
    const ziel = i * zeilenBytes;
    for (let p = 0; p < zeilenBytes; p += 3) {
      farbe[ziel + p] = tr[roh[p]];
      farbe[ziel + p + 1] = tg[roh[p + 1]];
      farbe[ziel + p + 2] = tb[roh[p + 2]];
    }
    (await laden(resolve(STORE, `${s.normale}.png`), kante)).copy(normale, ziel);
  }

  const schreiben = async (daten, datei) => {
    await sharp(daten, { raw: { width: kante, height: kante * ZEILEN, channels: 3 } })
      .png({ compressionLevel: 9, effort: 10, palette: false })
      .toFile(resolve(AUS, datei));
  };
  await schreiben(farbe, 'store_d_array.png');
  await schreiben(normale, 'store_n_array.png');
  writeFileSync(resolve(AUS, 'store-schichten.json'), JSON.stringify(tabelle(kante), null, 2) + '\n');

  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(`[terrain-schichten] ${kante}² × ${ZEILEN} Zeilen`);
  for (const d of ['store_d_array.png', 'store_n_array.png']) {
    console.log(`  ${d.padEnd(20)} ${mb(readFileSync(resolve(AUS, d)).length)} MB Datei, ` +
      `${mb(kante * kante * ZEILEN * 4)} MB roh im VRAM (ohne Mipmaps)`);
  }
  console.log(`  Ausgabe: ${AUS}`);
}

if (process.argv[1] && process.argv[1].endsWith('store-terrain-schichten.mjs')) {
  const i = process.argv.indexOf('--kante');
  const kante = i >= 0 ? Number(process.argv[i + 1]) : 512;
  if (![256, 512, 1024, 2048].includes(kante)) {
    console.error('[terrain-schichten] --kante muss 256, 512, 1024 oder 2048 sein.');
    process.exit(2);
  }
  if (process.argv.includes('--nur-pruefen')) {
    const fehlt = fehlendeDateien();
    console.log(JSON.stringify(tabelle(kante), null, 2));
    if (fehlt.length) {
      console.error('Es fehlen:\n  ' + fehlt.join('\n  '));
      process.exit(2);
    }
  } else {
    // Kein `await` auf oberster Ebene: `tools/test/terrain-schichten.ts`
    // importiert diese Datei, um ihre Tabelle zu lesen statt sie
    // nachzubilden — und tsx uebersetzt sie dafuer nach CJS, wo ein
    // Top-Level-await nicht uebersetzbar ist. Der Test staerbe dann an
    // einer Zeile, die mit dem Test nichts zu tun hat.
    void baue(kante).catch((e) => {
      console.error('[terrain-schichten] ' + String(e));
      process.exit(1);
    });
  }
}
