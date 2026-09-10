/**
 * Die Spielfigur ist HAUTFARBEN und nicht weiss.
 *
 * ── Der Fehler, gegen den dieser Test steht ──────────────────────────
 * Am 09.09.2026 wurde `wikinger/WikingerKoerper` die Vorgabefigur
 * (30e09c5). Seither stand eine WEISSE Figur mit dunkler Hose im Bild
 * (`~/.cache/wov-lab/felsen-lab3-messort.png`), vorher eine hautfarbene
 * (`boden3-lab-messort.png`, die Wikingerin).
 *
 * Die Ursache ist keine kaputte Textur: Im Spiel nachgemessen liefert
 * das Hautfeld des Atlas auf der GPU exakt sRGB 255/204/173, die Textur
 * ist richtig orientiert und wird über einen sRGB-Puffer gelesen. Genau
 * diese Zahl ist der Fehler — linear ist das ein Rotkanal von 1,000, und
 * eine Albedo von 1,0 gibt es nicht (Neuschnee liegt bei 0,9). Der Atlas
 * stammt aus Syntys POLYGON-Bestand und ist für einen nahezu
 * unbeleuchteten Unity-Shader gemalt; unter unserer Sonne läuft er über,
 * und die ACES-Kurve entsättigt alles über 1 gegen Weiss.
 *
 * Das ist ein Fehler OHNE Symptom im Testlauf: Die Datei lädt, das
 * Skelett steht, die Clips laufen, `npm test` bleibt grün. Nur die Figur
 * ist weiss. Deshalb dieser Test.
 *
 * ── Was hier gemessen wird ───────────────────────────────────────────
 *   (a) DECKUNG   Jede Figur aus `FIGUREN` hat eine Zeile in
 *                 `FIGUR_TOENUNG`. Das ist die Zeile, die 30e09c5
 *                 vergessen hat; ohne sie wäre der Fehler wieder
 *                 lautlos. Eine Figur ohne Korrekturbedarf trägt
 *                 ausdrücklich [1, 1, 1].
 *   (b) HERLEITUNG Die drei Zahlen sind nicht getippt, sondern gerechnet:
 *                 Hautfeld des Wikinger-Atlas MAL Tönung ergibt die
 *                 Hautkarte der Wikingerin — die Figur, die auf 0db27bf
 *                 hautfarben im Bild stand.
 *   (c) VERDRAHTUNG Der echte Weg bis ins Material, an einem echten
 *                 PBRMaterial unter der NullEngine, und zwar für BEIDE
 *                 Namensformen: `AvatarRig`/Vorschau reichen den
 *                 Dateinamen durch, der `AssetManager` den Modellnamen.
 *   (d) NEBENAN   Ein fremdes Modell wird nicht angefasst, und zweimal
 *                 Auftragen ändert nichts (Materialien sind geteilt —
 *                 multiplizieren statt setzen machte die Figur bei jedem
 *                 weiteren Körperteil dunkler).
 *
 * Ohne Weiche: Es wird kein GLB geladen. Die beiden gemessenen Farben
 * stehen als Konstanten hier, mit ihrer Herkunft daneben — `assets/`
 * liegt ausserhalb des Repos.
 *
 * Lauf:  npx tsx client/test/figur-toenung.ts
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

import { FIGUREN, FIGUR_TOENUNG, FIGUR_VORGABE, modellDateiZu, modellZu } from '@wov/shared';
import { toeneFigurMaterial, toeneFigurMeshes } from '../src/engine/FigurToenung';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}`);
  }
}

/**
 * sRGB-Kanal (0…255) → linear. Dieselbe Umrechnung, die Babylon im
 * Shader macht; ohne sie sind die drei Faktoren nicht nachrechenbar.
 */
function linear(k: number): number {
  const c = k / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function sRGB(x: number): number {
  return (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255;
}

/**
 * Das Hautfeld des Wikinger-Atlas (`PolygonFantasyHero_Texture_01_A`,
 * 1024², eingebettet in `wikinger/WikingerKoerper.glb`). Abgelesen am
 * Texel, auf das ALLE Hautteile zeigen — Arme, Beine, Hände und Kopf
 * tragen dort dieselbe UV (0,043 / 0,888), das Feld deckt 22,2 % des
 * Atlas. Im laufenden Spiel über `texture.readPixels` gegengelesen.
 */
const HAUT_WIKINGER = [255, 204, 173] as const;
/**
 * Die Hautkarte der Wikingerin (`wikingerin/WikingerinKoerper.glb`,
 * `base_color`, 2048²) — die Figur, die vor dem Wechsel im Bild stand.
 * Sie ist eine Fläche: Mittel 222,5/147,6/115,6, 90. Perzentil
 * 223/148/116.
 */
const HAUT_WIKINGERIN = [222, 148, 116] as const;

const engine = new NullEngine();
const scene = new Scene(engine);

console.log('(a) Deckung: jede Figur hat eine Tönung');
for (const figur of FIGUREN) {
  pruefe(
    Object.prototype.hasOwnProperty.call(FIGUR_TOENUNG, figur.modell),
    `${figur.id} (${figur.modell}) steht in FIGUR_TOENUNG`
  );
}
pruefe(
  Object.keys(FIGUR_TOENUNG).every((m) => FIGUREN.some((f) => f.modell === m)),
  'keine Tönung ohne Figur (sonst zeigt die Tabelle auf ein Modell, das niemand lädt)'
);

console.log('\n(b) Herleitung: Atlas mal Tönung ergibt die Referenzhaut');
/**
 * (b) und (c) hängen an DIESEM Modell und nicht an „der Vorgabefigur":
 * Die beiden gemessenen Farben unten gehören zu diesem Atlas. Wird
 * einmal eine andere Figur zur Vorgabe, soll dieser Test nicht deshalb
 * rot werden — dass die neue Figur ihre eigene Zeile braucht, prüft (a).
 */
const WIKINGER = 'wikinger/WikingerKoerper';
pruefe(
  FIGUREN.some((f) => f.modell === WIKINGER),
  `${WIKINGER} steht noch in FIGUREN (sonst prüfen (b) und (c) eine Leiche)`
);
pruefe(modellZu(FIGUR_VORGABE) === WIKINGER, 'und ist die Vorgabefigur — die Figur aus dem Befund');
const toenung = FIGUR_TOENUNG[WIKINGER];
pruefe(toenung !== undefined, 'der Wikinger hat eine Tönung');
if (toenung) {
  const ergebnis = HAUT_WIKINGER.map((k, i) => sRGB(linear(k) * toenung[i]!));
  for (const [i, kanal] of ['R', 'G', 'B'].entries()) {
    const ist = ergebnis[i]!;
    const soll = HAUT_WIKINGERIN[i]!;
    pruefe(
      Math.abs(ist - soll) < 0.5,
      `${kanal}: ${HAUT_WIKINGER[i]} × ${toenung[i]!.toFixed(4)} → ${ist.toFixed(1)} (Referenz ${soll})`
    );
  }
  // Der eigentliche Befund, als Zahl festgehalten: OHNE Tönung ist die
  // Albedo des Rotkanals 1,0 und damit physikalisch unmöglich. Diese
  // Zeile wird rot, wenn jemand die Tönung auf neutral zurückdreht.
  pruefe(linear(HAUT_WIKINGER[0]) >= 1, 'ungetönt ist der Rotkanal eine Albedo von 1,0 — der Befund');
  pruefe(
    linear(HAUT_WIKINGER[0]) * toenung[0]! < 0.8,
    `getönt liegt er bei ${(linear(HAUT_WIKINGER[0]) * toenung[0]!).toFixed(3)} — im Bereich echter Haut`
  );
}

console.log('\n(c) Verdrahtung: der Weg bis ins Material');
/** Ein Material wie es aus dem glTF-Lader kommt: Albedo 1/1/1, Textur trägt die Farbe. */
function frisch(name: string): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor.set(1, 1, 1);
  return m;
}
for (const [wie, modell] of [
  ['Modellname (AssetManager, fremde Spieler)', modellZu(FIGUR_VORGABE)],
  ['Dateiname (AvatarRig und Charaktervorschau)', modellDateiZu(FIGUR_VORGABE)],
] as const) {
  const mat = frisch(`figur_${wie}`);
  const getroffen = toeneFigurMaterial(mat, modell);
  pruefe(
    getroffen &&
      Math.abs(mat.albedoColor.r - toenung![0]!) < 1e-6 &&
      Math.abs(mat.albedoColor.g - toenung![1]!) < 1e-6 &&
      Math.abs(mat.albedoColor.b - toenung![2]!) < 1e-6,
    `${wie}: albedoColor steht auf der Tönung (ist ${mat.albedoColor.toString()})`
  );
}

// Über die Meshes — der Weg, den AvatarRig und die Vorschau nehmen.
const geteilt = frisch('atlas_geteilt');
const netze = ['Chr_Head_Male_00', 'Chr_Torso_Male_00', 'Chr_LegLeft_Male_00'].map((n) => {
  const m = new Mesh(n, scene);
  m.material = geteilt;
  return m;
});
const getoent = toeneFigurMeshes(netze, modellDateiZu(FIGUR_VORGABE));
pruefe(getoent === 1, `drei Meshes mit EINEM Material ergeben eine Tönung (ist ${getoent})`);

console.log('\n(d) Nebenan');
const vorher = geteilt.albedoColor.clone();
toeneFigurMeshes(netze, modellDateiZu(FIGUR_VORGABE));
pruefe(
  geteilt.albedoColor.equalsWithEpsilon(vorher, 1e-9),
  'zweimal auftragen ändert nichts (gesetzt, nicht multipliziert)'
);
const fremd = frisch('Beech1_mat');
pruefe(!toeneFigurMaterial(fremd, 'Beech1'), 'ein fremdes Modell wird nicht getönt');
pruefe(
  fremd.albedoColor.r === 1 && fremd.albedoColor.g === 1 && fremd.albedoColor.b === 1,
  'und behält seine Basisfarbe'
);

console.log(fehler === 0 ? '\nOK — die Figur ist hautfarben' : `\n${fehler} FEHLER`);
scene.dispose();
engine.dispose();
process.exit(fehler > 0 ? 1 : 0);
