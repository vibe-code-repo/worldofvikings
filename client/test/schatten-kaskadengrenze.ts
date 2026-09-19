/**
 * Schatten: Wo die scharfe Nahkaskade endet (G18).
 *
 * Aus dem Look-Profil gerechnet, nicht am Generator gelesen (der laeuft nicht
 * auf der NullEngine): Die Grenze muss so weit reichen, dass man sich im
 * Nahbereich bewegen kann, ohne dass die Schattenkante von scharf auf weich
 * springt. Die Rechnung ist an der Messung geeicht (9,05 m bei lambda 0,8,
 * minZ 0,5, 50 m, zwei Kaskaden); vorher endete die Nahkaskade bei 9 m und
 * die zweite Karte trug 5,4-fach groebere Texel.
 *
 * Zweiter Teil: der WEG vom Look-Profil zum Generator. `Shadows.setLevel` baut
 * den Generator ueber die Naht `erzeugeGenerator`; ein Test ersetzt sie durch
 * eine Attrappe und liest, was am Ende an lambda, Ueberblendung, Reichweite,
 * Kaskaden und Aufloesung steht. Ein Rueckfall auf Babylons Vorgaben
 * (`cascadeBlendPercentage = 0.1`) in `setLevel` faellt damit auf.
 *
 * Dritter Teil (H1): die Naht selbst. Der echte `CascadedShadowGenerator`
 * baut sich auf der NullEngine, wenn die Engine CSM meldet und ein Stellvertreter
 * die GL-Konstanten liefert; dann laeuft `erzeugeGenerator` ungeaendert und der
 * Test liest Aufloesung, Kaskaden, lambda und Ueberblendung am ECHTEN Objekt.
 * Eine feste 1024 im Rumpf der Naht faellt damit auf (die Attrappe oben sieht
 * nur das Argument, nicht, was der Generator daraus macht).
 *
 * Lauf: npx tsx client/test/schatten-kaskadengrenze.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LOOK_VORGABE } from '../../shared/src/lookProfil.js';
import {
  Shadows,
  MIN_KASKADEN,
  SHADOW_LEVELS,
  kaskadenGrenzen,
  schattenLambda,
  schattenMitLook,
  schattenUeberblendung,
} from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten G18: Kaskadengrenze');

// ── G18 Wo endet die scharfe Nahkaskade? ─────────────────────────────
{
  // Eichung: die am Generator gelesenen Sichttiefen (18.09.2026, minZ 0,5).
  const ist = kaskadenGrenzen(0.5, 50, 2, 0.8);
  pruefe(Math.abs(ist[0]! - 9.05) < 0.01 && ist[1] === 50, `Eichung: lambda 0,8 gab ${ist.map((v) => v.toFixed(2)).join(' / ')}, gemessen 9,05 / 50`);
  const drei = kaskadenGrenzen(0.5, 50, 3, 0.35);
  pruefe(
    Math.abs(drei[0]! - 11.86) < 0.02 && Math.abs(drei[1]! - 25.55) < 0.02,
    `Eichung: 3 Kaskaden, lambda 0,35: ${drei.map((v) => v.toFixed(2)).join(' / ')}, gemessen 11,86 / 25,55 / 50`
  );

  // Die ausgelieferte Vorgabe: Nahkaskade bis mindestens ~18 m.
  const s = LOOK_VORGABE.schatten;
  const kaskaden = Math.max(MIN_KASKADEN, s.kaskaden);
  const grenzen = kaskadenGrenzen(0.5, s.reichweite, kaskaden, s.lambda);
  pruefe(
    grenzen[0]! >= 18,
    `Nahkaskade endet bei ${grenzen[0]!.toFixed(1)} m — unter 18 m springt die Schattenkante im Bewegungsbereich von scharf auf weich`
  );
  pruefe(s.ueberblendung >= 0.15, `Ueberblendung ${s.ueberblendung} zu schmal, der Wechsel bleibt sichtbar`);
  // Der Sprung an der Grenze: Die Texelbreite folgt der Reichweite der Kaskade
  // (gemessen 2,26 → 12,22 cm = 5,4-fach bei 9,05 → 50 m = 5,5-fach). Ein
  // 2048er Look braucht ausserdem eine Stufe, die ihn nicht auf 1024 kappt.
  const stufe = SHADOW_LEVELS[2]!;
  const wirksam = schattenMitLook(stufe, s);
  pruefe(
    wirksam !== null && wirksam.aufloesung === s.aufloesung,
    `Stufe 2 deckelt den Look auf ${wirksam?.aufloesung} px, der Look will ${s.aufloesung}`
  );
  const sprung = grenzen[1]! / grenzen[0]!;
  pruefe(sprung <= 3, `Texelsprung an der Grenze ${sprung.toFixed(1)}-fach — vorher 5,4-fach, Ziel unter 3`);

  // Durchreichen: der Look bestimmt, nur das 100-FPS-Profil behaelt seinen Preis.
  pruefe(schattenLambda(2, false, 0.05) === 0.05, 'schattenLambda gibt den Profilwert nicht weiter');
  pruefe(schattenLambda(1, true, 0.05) === 0.2, 'das 100-FPS-Profil hat seinen Lambda-Wert verloren');
  pruefe(schattenLambda(2, false) === 0.8, 'schattenLambda: Vorgabe ohne Profilwert hat sich veraendert');
  pruefe(schattenUeberblendung(2, false, 0.25) === 0.25, 'schattenUeberblendung gibt den Profilwert nicht weiter');
  pruefe(schattenUeberblendung(1, true, 0.25) === 0.2, 'das 100-FPS-Profil hat seine Ueberblendung verloren');

  // Die Stufe bleibt ein Hardwarepreis: Die Look-Aufloesung wirkt nur bis
  // zu ihrem Deckel, Kaskadenzahl und Reichweite kommen aus dem Look.
  const deckel = schattenMitLook(SHADOW_LEVELS[2]!, { ...s, aufloesung: 8192 });
  pruefe(
    deckel !== null && deckel.aufloesung === SHADOW_LEVELS[2]!.aufloesung,
    'Look-Aufloesung wird nicht am Deckel der Stufe gekappt'
  );
}


// ── Look-Profil → Generator (setLevel) ───────────────────────────────
{
  class GeneratorAttrappe {
    numCascades = 0;
    shadowMaxZ = 0;
    stabilizeCascades = false;
    cascadeBlendPercentage = 0.1; // Babylons Vorgabe
    lambda = 0.5; // Babylons Vorgabe
    darkness = 0;
    bias = 0;
    normalBias = 0;
    autoCalcDepthBounds = true;
    freezeShadowCastersBoundingInfo = false;
    usePercentageCloserFiltering = false;
    filteringQuality = -1;
    constructor(readonly mapSize: number) {}
    addShadowCaster(): void {}
    getShadowMap() {
      // Das Uebrige, was FernKaskadenTakt beim Einhaengen anfasst (G15).
      return { renderList: [] as unknown[], getRenderLayers: () => 2 };
    }
    _computeMatrices(): void {}
    dispose(): void {}
  }
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sonne = new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene);
  const shadows = new Shadows(scene, sonne);
  const gebaut: GeneratorAttrappe[] = [];
  const intern = shadows as unknown as { erzeugeGenerator: (a: number) => unknown; profil: typeof LOOK_VORGABE };
  intern.erzeugeGenerator = (aufloesung: number) => {
    const g = new GeneratorAttrappe(aufloesung);
    gebaut.push(g);
    return g;
  };
  const letzter = (): GeneratorAttrappe => gebaut[gebaut.length - 1]!;

  // 1. Die ausgelieferte Vorgabe kommt am Generator an.
  shadows.setLevel(2);
  const v = LOOK_VORGABE.schatten;
  pruefe(gebaut.length === 1, `setLevel(2) hat ${gebaut.length} Generatoren gebaut`);
  pruefe(letzter().lambda === v.lambda, `Generator-lambda ${letzter().lambda}, Vorgabe ${v.lambda}`);
  pruefe(
    letzter().cascadeBlendPercentage === v.ueberblendung,
    `Generator-Ueberblendung ${letzter().cascadeBlendPercentage}, Vorgabe ${v.ueberblendung} (Rueckfall auf Babylons 0,1?)`
  );
  pruefe(letzter().numCascades === Math.max(MIN_KASKADEN, v.kaskaden), `Generator-Kaskaden ${letzter().numCascades}`);
  pruefe(letzter().shadowMaxZ === v.reichweite, `Generator-Reichweite ${letzter().shadowMaxZ}, Vorgabe ${v.reichweite}`);
  pruefe(letzter().mapSize === v.aufloesung, `Generator-Aufloesung ${letzter().mapSize}, Vorgabe ${v.aufloesung}`);
  pruefe(letzter().darkness === v.dunkelheit && letzter().stabilizeCascades === v.rasten, 'Dunkelheit/Rasten kommen nicht an');

  // 2. Ein ANDERER Profilwert kommt ebenso an (nicht nur die Vorgabe zufaellig richtig).
  intern.profil = {
    ...LOOK_VORGABE,
    schatten: { ...v, lambda: 0.05, ueberblendung: 0.25, aufloesung: 1024, kaskaden: 3, reichweite: 70, dunkelheit: 0.4, rasten: false },
  };
  shadows.setLevel(3);
  pruefe(letzter().lambda === 0.05, `Profil-lambda 0,05 kam als ${letzter().lambda} an`);
  pruefe(letzter().cascadeBlendPercentage === 0.25, `Profil-Ueberblendung 0,25 kam als ${letzter().cascadeBlendPercentage} an`);
  pruefe(letzter().numCascades === 3 && letzter().shadowMaxZ === 70, `Kaskaden/Reichweite: ${letzter().numCascades} / ${letzter().shadowMaxZ}`);
  pruefe(letzter().mapSize === 1024, `Aufloesung ${letzter().mapSize}: Look 1024 unter dem Deckel 2048`);
  pruefe(letzter().darkness === 0.4 && letzter().stabilizeCascades === false, 'Profil-Dunkelheit/Rasten kommen nicht an');

  // 3. Das 100-FPS-Profil auf Stufe 1 behaelt seine eigenen Werte.
  shadows.setHundertFpsProfil(true);
  shadows.setLevel(1);
  pruefe(letzter().lambda === 0.2, `100-FPS-Profil: lambda ${letzter().lambda}, erwartet 0,2 (nicht der Look-Wert)`);
  pruefe(letzter().cascadeBlendPercentage === 0.2, `100-FPS-Profil: Ueberblendung ${letzter().cascadeBlendPercentage}, erwartet 0,2`);

  shadows.dispose();
  scene.dispose();
  engine.dispose();
}

// ── H1 Die Naht selbst: der echte Generator ──────────────────────────
{
  const engine = new NullEngine();
  // Die NullEngine meldet kein CSM und hat kein GL. Beides ist Kulisse fuer den
  // Konstruktor; gezeichnet wird nichts. Der Stellvertreter antwortet auf jede
  // Konstante mit 0 und auf jeden Aufruf mit sich selbst.
  (engine as unknown as { _features: { supportCSM: boolean } })._features.supportCSM = true;
  const stellvertreter: unknown = new Proxy(function () {}, {
    get: (_ziel, name) => (name === Symbol.toPrimitive || name === 'valueOf' ? () => 0 : stellvertreter),
    apply: () => stellvertreter,
    set: () => true,
  });
  (engine as unknown as { _gl: unknown })._gl = stellvertreter;
  const scene = new Scene(engine);
  scene.activeCamera = new FreeCamera('kamera', new Vector3(0, 2, 0), scene);
  const sonne = new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene);
  const shadows = new Shadows(scene, sonne);
  const intern = shadows as unknown as { profil: typeof LOOK_VORGABE };
  const werte = () => {
    const w = shadows.messwerte() as Record<string, number | boolean | null>;
    return w;
  };

  shadows.setLevel(2);
  const v = LOOK_VORGABE.schatten;
  pruefe(werte().aufloesung === v.aufloesung, `echter Generator: Aufloesung ${werte().aufloesung}, Vorgabe ${v.aufloesung} (feste Zahl in der Naht?)`);
  pruefe(werte().kaskaden === Math.max(MIN_KASKADEN, v.kaskaden), `echter Generator: Kaskaden ${werte().kaskaden}`);
  pruefe(werte().lambda === v.lambda, `echter Generator: lambda ${werte().lambda}, Vorgabe ${v.lambda}`);
  pruefe(werte().ueberblendung === v.ueberblendung, `echter Generator: Ueberblendung ${werte().ueberblendung}, Vorgabe ${v.ueberblendung}`);
  pruefe(werte().dunkelheit === v.dunkelheit && werte().gerastet === v.rasten, 'echter Generator: Dunkelheit/Rasten kommen nicht an');
  pruefe(werte().reichweite === v.reichweite, `echter Generator: Reichweite ${werte().reichweite}, Vorgabe ${v.reichweite}`);

  // Ein anderes Profil, damit die Vorgabe nicht zufaellig die richtige Zahl hat.
  intern.profil = {
    ...LOOK_VORGABE,
    schatten: { ...v, lambda: 0.05, ueberblendung: 0.25, aufloesung: 1024, kaskaden: 3, reichweite: 70, dunkelheit: 0.4, rasten: false },
  };
  shadows.setLevel(3);
  pruefe(werte().aufloesung === 1024, `echter Generator: Aufloesung ${werte().aufloesung}, Look 1024`);
  pruefe(werte().kaskaden === 3 && werte().reichweite === 70, `echter Generator: Kaskaden/Reichweite ${werte().kaskaden} / ${werte().reichweite}`);
  pruefe(werte().lambda === 0.05 && werte().ueberblendung === 0.25, `echter Generator: lambda/Ueberblendung ${werte().lambda} / ${werte().ueberblendung}`);

  shadows.dispose();
  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchatten G18: Eichung, Vorgabe und Durchreichen des Look-Profils gruen.');
