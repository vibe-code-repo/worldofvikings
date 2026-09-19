/**
 * Schatten: die fernen Kaskaden im Takt (G15).
 *
 * `FernKaskadenTakt` haengt sich an `_computeMatrices` des ECHTEN
 * `CascadedShadowGenerator` (NullEngine mit CSM-Meldung und einem Stellvertreter
 * fuer GL, wie in schatten-kaskadengrenze.ts). Geprueft wird, was fuer das Bild
 * zaehlt:
 *
 *  1. Im Takt 2 rendert jedes zweite Bild nur die erste Lage
 *     (`getRenderLayers` 1 statt 2), sonst beide.
 *  2. In einem uebersprungenen Bild bleiben Matrizen UND Ausdehnung der fernen
 *     Kaskade auf dem Stand des letzten Renderbildes, die Nahkaskade wandert
 *     weiter — sonst tasteten die Empfaenger mit Matrizen ab, zu denen die
 *     Karte nicht gezeichnet wurde.
 *  3. Bricht die Deckung (Teleport, schnelle Drehung), wird sofort neu gerendert.
 *  4. Takt 1 verhaelt sich wie vor G15; ein Bild, das `_computeMatrices` zweimal
 *     ruft, zaehlt einmal.
 *  5. Die reine Deckungspruefung `kaskadeDeckt`.
 *
 * Lauf: npx tsx client/test/schatten-fern-takt.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LOOK_VORGABE } from '../../shared/src/lookProfil.js';
import { FERN_TAKT_TOLERANZ_M, FernKaskadenTakt, Shadows, kaskadeDeckt } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten G15: ferne Kaskaden im Takt');

// ── 5. kaskadeDeckt: reine Rechnung ──────────────────────────────────
{
  // Karte mit Halbkante 10 m: x' = x / 10, y' = y / 10 (Reihenzeilen wie Babylon).
  const m = new Float32Array(16);
  m[0] = 0.1;
  m[5] = 0.1;
  m[10] = 1;
  m[15] = 1;
  const punkt = (x: number, y: number) => ({ x, y, z: 0 });
  pruefe(kaskadeDeckt(m, 10, [punkt(9.9, -9.9), punkt(0, 0)]), 'Ecken innerhalb werden als ausserhalb gemeldet');
  // Die Toleranz als ZAHL: 0,3 m ueber den Rand sind gedeckt, 0,35 m nicht.
  pruefe(FERN_TAKT_TOLERANZ_M === 0.3, `Toleranz ${FERN_TAKT_TOLERANZ_M} m, gemessen und festgelegt sind 0,3 m`);
  pruefe(kaskadeDeckt(m, 10, [punkt(10.25, 0)]), 'ein Rand 0,25 m ausserhalb gilt nicht als gedeckt');
  pruefe(!kaskadeDeckt(m, 10, [punkt(10.35, 0)]), 'ein Rand 0,35 m ausserhalb gilt als gedeckt');
  pruefe(!kaskadeDeckt(m, 10, [punkt(0, -11)]), 'y ausserhalb gilt als gedeckt');
  pruefe(!kaskadeDeckt(m, 0, [punkt(0, 0)]), 'eine leere Karte (Halbkante 0) deckt nichts');
  pruefe(!kaskadeDeckt(m, 10, [punkt(0, 0), punkt(Number.NaN, 0)]), 'NaN gilt als gedeckt');
  pruefe(kaskadeDeckt(m, 10, [punkt(10.5, 0)], 1), 'eine groessere Toleranz wird nicht beachtet');
}

// ── Der echte Generator ──────────────────────────────────────────────
function bau(takt: number) {
  const engine = new NullEngine({ renderWidth: 1600, renderHeight: 900, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
  (engine as unknown as { _features: { supportCSM: boolean } })._features.supportCSM = true;
  const stellvertreter: unknown = new Proxy(function () {}, {
    get: (_ziel, name) => (name === Symbol.toPrimitive || name === 'valueOf' ? () => 0 : stellvertreter),
    apply: () => stellvertreter,
    set: () => true,
  });
  (engine as unknown as { _gl: unknown })._gl = stellvertreter;
  const scene = new Scene(engine);
  const kamera = new FreeCamera('kamera', new Vector3(0, 2, 0), scene);
  kamera.minZ = 0.5;
  kamera.setTarget(new Vector3(0, 2, 10));
  scene.activeCamera = kamera;
  const sonne = new DirectionalLight('sonne', new Vector3(0.6, -0.7, 0.3), scene);
  const shadows = new Shadows(scene, sonne);
  (shadows as unknown as { profil: typeof LOOK_VORGABE }).profil = {
    ...LOOK_VORGABE,
    schatten: { ...LOOK_VORGABE.schatten, fernTakt: takt },
  };
  shadows.setLevel(2);
  const g = (shadows as unknown as { generator: { getShadowMap(): { getRenderLayers(): number; onBeforeBindObservable: { notifyObservers(x: unknown): void } }; getCascadeTransformMatrix(i: number): { m: Float32Array | number[] }; getCascadeMinExtents(i: number): Vector3; _transformMatricesAsArray: Float32Array } }).generator;
  const karte = g.getShadowMap();
  let bild = 0;
  (scene as unknown as { getFrameId: () => number }).getFrameId = () => bild;
  const lauf = (x: number, z: number, blickX = 0, blickZ = 10, doppelt = false) => {
    bild++;
    kamera.position.set(x, 2, z);
    kamera.setTarget(new Vector3(x + blickX, 2, z + blickZ));
    kamera.getViewMatrix(true);
    kamera.getProjectionMatrix(true);
    karte.onBeforeBindObservable.notifyObservers(karte);
    if (doppelt) karte.onBeforeBindObservable.notifyObservers(karte);
    return {
      lagen: karte.getRenderLayers(),
      nah: Array.from(g.getCascadeTransformMatrix(0).m),
      fern: Array.from(g.getCascadeTransformMatrix(1).m),
      // Das Feld, aus dem der Shader `lightMatrix` liest (`bindShadowLight`), nicht die Matrix-Objekte.
      nahFeld: Array.from(g._transformMatricesAsArray.slice(0, 16)),
      fernFeld: Array.from(g._transformMatricesAsArray.slice(16, 32)),
    };
  };
  const gleich = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
  const takter = (shadows as unknown as { fernTakt: FernKaskadenTakt }).fernTakt;
  const ende = () => {
    shadows.dispose();
    scene.dispose();
    engine.dispose();
  };
  return { lauf, gleich, takter, ende, karte };
}

// ── 1.+2. Takt 2, die Kamera geht mit Sprinttempo ────────────────────
{
  const t = bau(2);
  const b: Array<ReturnType<typeof t.lauf>> = [];
  for (let i = 0; i < 8; i++) b.push(t.lauf(0, i * 0.13));
  pruefe(b[0]!.lagen === 2, `erstes Bild rendert nicht beide Lagen (${b[0]!.lagen})`);
  const lagen = b.map((x) => x.lagen).join('');
  pruefe(lagen === '21212121', `Lagen im Takt 2: ${lagen}, erwartet 21212121 (Zwei Lagen, dann eine, im Wechsel)`);
  for (let i = 1; i < 8; i += 2) {
    pruefe(t.gleich(b[i]!.fern, b[i - 1]!.fern), `Bild ${i}: die ferne Kaskade hat sich im uebersprungenen Bild bewegt — die Empfaenger tasteten mit falschen Matrizen ab`);
    pruefe(!t.gleich(b[i]!.nah, b[i - 1]!.nah), `Bild ${i}: die Nahkaskade steht im uebersprungenen Bild still`);
    // Der Shader liest das FELD, nicht die Matrix-Objekte: bitgleich zum letzten Renderbild.
    pruefe(t.gleich(b[i]!.fernFeld, b[i - 1]!.fernFeld), `Bild ${i}: das Feld der fernen Kaskade (Quelle der Empfaengermatrizen) hat sich im uebersprungenen Bild bewegt`);
    pruefe(!t.gleich(b[i]!.nahFeld, b[i - 1]!.nahFeld), `Bild ${i}: das Feld der Nahkaskade steht im uebersprungenen Bild still`);
  }
  for (let i = 2; i < 8; i += 2) {
    pruefe(!t.gleich(b[i]!.fern, b[i - 1]!.fern), `Bild ${i}: die ferne Kaskade wurde im Renderbild nicht neu berechnet`);
    pruefe(!t.gleich(b[i]!.fernFeld, b[i - 1]!.fernFeld), `Bild ${i}: das Feld der fernen Kaskade wurde im Renderbild nicht neu berechnet`);
  }
  pruefe(t.takter.uebersprungen === 4 && t.takter.gerendert === 4, `Zaehler ${t.takter.uebersprungen}/${t.takter.gerendert}, erwartet 4/4`);
  t.ende();
}

// ── 3. Die Deckung bricht: sofort neu rendern ────────────────────────
{
  const t = bau(2);
  t.lauf(0, 0); // Renderbild
  const still = t.lauf(0, 0.13); // uebersprungen: Deckung haelt
  pruefe(still.lagen === 1, 'Vorbedingung: das zweite Bild ist ein uebersprungenes');
  t.lauf(0, 0.26); // Renderbild
  // Der Takt verlangt jetzt ein uebersprungenes Bild; die Kamera springt 300 m:
  // die alte Karte deckt nichts mehr, es muss trotzdem neu gerendert werden.
  const sprung = t.lauf(300, 0);
  pruefe(sprung.lagen === 2, 'nach einem Teleport wird nicht neu gerendert — die ferne Karte stuende am falschen Ort');
  pruefe(!t.gleich(sprung.fern, still.fern), 'nach einem Teleport blieb die ferne Kaskade stehen');
  pruefe(t.takter.luecken === 1, `Luecken-Zaehler ${t.takter.luecken}, erwartet 1`);
  t.lauf(300, 0.1); // uebersprungen
  t.lauf(300, 0.2); // Renderbild
  // Drehung um 90 Grad im uebersprungenen Bild: die Pyramide liegt ganz woanders.
  const dreh = t.lauf(300, 0.2, 10, 0);
  pruefe(dreh.lagen === 2, 'nach einer 90-Grad-Drehung wird nicht neu gerendert');
  pruefe(t.takter.luecken === 2, `Luecken-Zaehler ${t.takter.luecken}, erwartet 2`);
  t.ende();
}

// ── 4. Takt 1 und doppelte Aufrufe ───────────────────────────────────
{
  const t = bau(1);
  const b: Array<ReturnType<typeof t.lauf>> = [];
  for (let i = 0; i < 4; i++) b.push(t.lauf(0, i * 0.13));
  pruefe(b.every((x) => x.lagen === 2), 'Takt 1 rendert nicht in jedem Bild beide Lagen');
  pruefe(b.every((x, i) => i === 0 || !t.gleich(x.fern, b[i - 1]!.fern)), 'Takt 1 friert die ferne Kaskade ein');
  pruefe(t.takter.uebersprungen === 0, 'Takt 1 zaehlt uebersprungene Bilder');
  pruefe(t.takter.gerendert === 4, `Takt 1: Zaehler gerendert ${t.takter.gerendert}, erwartet 4 (ein Bild, ein Zaehler)`);
  t.ende();

  // Takt 1 mit doppeltem Aufruf je Bild: der Zaehler zaehlt Bilder, nicht Aufrufe.
  const z = bau(1);
  for (let i = 0; i < 6; i++) z.lauf(0, i * 0.13, 0, 10, true);
  pruefe(z.takter.gerendert === 6, `Takt 1, jedes Bild ruft zweimal: Zaehler gerendert ${z.takter.gerendert}, erwartet 6 (ein Bild, ein Zaehler)`);
  z.ende();

  const u = bau(2);
  const c: Array<ReturnType<typeof u.lauf>> = [];
  for (let i = 0; i < 6; i++) c.push(u.lauf(0, i * 0.13, 0, 10, true)); // jedes Bild ruft zweimal
  const lagen = c.map((x) => x.lagen).join('');
  pruefe(lagen === '212121', `ein Bild mit zwei Aufrufen verschiebt den Takt: ${lagen}`);
  pruefe(u.gleich(c[1]!.fern, c[0]!.fern) && u.gleich(c[3]!.fern, c[2]!.fern), 'beim doppelten Aufruf im uebersprungenen Bild bewegt sich die ferne Kaskade');
  u.ende();
}

// ── Takt 3: ein Renderbild, zwei uebersprungene ──────────────────────
{
  const t = bau(3);
  const b: Array<ReturnType<typeof t.lauf>> = [];
  for (let i = 0; i < 6; i++) b.push(t.lauf(0, i * 0.05));
  const lagen = b.map((x) => x.lagen).join('');
  pruefe(lagen === '211211', `Lagen im Takt 3: ${lagen}, erwartet 211211`);
  t.ende();
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchatten G15: Takt, eingefrorene Matrizen, Deckungsbruch und Takt 1 gruen.');
