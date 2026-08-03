/**
 * WaterWave — die Wellenformel des Originals als GLSL-Baustein.
 *
 * Portiert aus `WaterVolume.CalcWave`/`CreateWave`/`TrochSin` des
 * dekompilierten Clients. Sie steht hier und nicht im WaterPlugin, weil
 * ZWEI Shader dasselbe Ergebnis brauchen:
 *
 *  - die Wasseroberfläche selbst (WaterPlugin), und
 *  - alles, was auf ihr schwimmt (ClutterWindPlugin: Seerosen und
 *    Schilf, die Clutter-Einträge mit `snapToWater`).
 *
 * Beide MÜSSEN bitgenau dieselbe Höhe errechnen. Eine zweite, „ungefähr
 * gleiche" Kopie der Formel würde genau den Fehler wieder einführen, den
 * das Mitschwimmen beheben soll: Weicht die Pflanzenhöhe auch nur um
 * Zentimeter von der Wasserhöhe ab, taucht sie bei jedem Wellenberg unter
 * die inzwischen BLICKDICHTE Oberfläche (_SrcBlend One / _DstBlend Zero,
 * siehe Terrain.setWaterQuality) und ist schlicht weg.
 */

/** Tiefe (m), über die die Wellenamplitude hochläuft — `Depth()` im Original. */
export const WAVE_DEPTH_SCALE = 10;

/**
 * Mittelwert-Ausgleich der Wellensumme (Meter je Windeinheit), addiert in
 * `wCalcWave` vor der Windskalierung.
 *
 * CalcWave ist NICHT mittelwertfrei. Die Formel exakt nachgerechnet
 * (400k Proben über Ort und Zeit, depth01 = 1, wind = 1):
 *
 *   Mittelwert -1,417 m   Median -2,105 m
 *   75,4 % aller Werte liegen unter null, 65,1 % unter -1 m
 *
 * Der Grund ist das `- 0.2` in CreateWave zusammen mit der trochoidalen
 * Form: seltene spitze Kämme, dafür breite tiefe Täler. Ungefiltert liegt
 * die Wasseroberfläche damit im Mittel gut einen Meter UNTER dem
 * Wasserspiegel — Flachwasser fällt dauerhaft trocken, und genau das
 * waren die "braunen Wellen" (die Fläche blieb stehen und zeigte nackten
 * Sandgrund).
 *
 * Im Original gibt es dafür `WaterVolume.m_surfaceOffset`
 * (WaterVolume.cs:20, addiert in GetWaterSurface Zeile 176). Das Feld
 * wird im Prefab gesetzt und ist im Asset-Export nicht enthalten, sein
 * Wert also nicht direkt auslesbar. Der hier gemessene Ausgleich stellt
 * her, was er leisten muss: eine Wasseroberfläche, die im Mittel auf dem
 * Wasserspiegel liegt. Die trochoidale FORM bleibt dabei unangetastet.
 */
export const WAVE_MEAN_OFFSET = 1.417;

/**
 * Die Formel als GLSL. Definiert `wTrochSin`, `wCreateWave` und
 * `wCalcWave(wp, depth01, time, wind, wdir)`; `wp` ist (WeltX, WeltZ).
 *
 * Die Oktavenrichtungen sind fest verdrahtet wie im Original
 * (`s_createWaveDirections`); nur Oktave 0 läuft in Windrichtung.
 */
export const WAVE_GLSL = /* glsl */ `
  const float WATER_DEPTH_SCALE = ${WAVE_DEPTH_SCALE.toFixed(1)};

  // WaterVolume.TrochSin — spitze Kämme, flache Täler
  float wTrochSin(float x, float k) { return sin(x - cos(x) * k) * 0.5 + 0.5; }

  // WaterVolume.CreateWave. wp = (WeltX, WeltZ); im Original
  // v = -(pos.z*dir + pos.x*tangent), tangent = senkrecht zu dir.
  float wCreateWave(vec2 wp, float t, float speed, float len, float height, vec2 dir, float sharp) {
    vec2 tang = vec2(-dir.y, dir.x);
    vec2 v = -(wp.y * dir + wp.x * tang);
    float n = t * speed;
    return (wTrochSin(n + v.y * len, sharp)
          * wTrochSin(n * 0.123 + v.x * 0.13123 * len, sharp) - 0.2) * height;
  }

  // WaterVolume.CalcWave — 10 Oktaven (speed, waveLength, height,
  // sharpness). Oktave 0 läuft in WINDRICHTUNG (s_createWaveDirections[0]
  // = wind.xz im Original), die übrigen neun haben feste Richtungen.
  float wCalcWave(vec2 wp, float depth01, float time, float wind, vec2 wdir) {
    float t = time / 20.0;
    float s = 0.0;
    s += wCreateWave(wp, t, 10.0,    0.04, 8.0, normalize(wdir), 0.5);
    s += wCreateWave(wp, t, 14.123,  0.08, 6.0, normalize(vec2( 1.0312,  0.312)), 0.5);
    s += wCreateWave(wp, t, 22.312,  0.10, 4.0, normalize(vec2(-0.123,   1.12 )), 0.5);
    s += wCreateWave(wp, t, 31.42,   0.20, 2.0, normalize(vec2( 0.423,   0.124)), 0.5);
    s += wCreateWave(wp, t, 35.42,   0.40, 1.0, normalize(vec2( 0.123,  -0.64 )), 0.5);
    s += wCreateWave(wp, t, 38.1223, 1.00, 0.8, normalize(vec2(-0.523,  -0.64 )), 0.7);
    s += wCreateWave(wp, t, 41.1223, 1.20, 0.6, normalize(vec2( 0.223,   0.74 )), 0.8);
    s += wCreateWave(wp, t, 51.5123, 1.30, 0.4, normalize(vec2( 0.923,  -0.24 )), 0.9);
    s += wCreateWave(wp, t, 54.2,    1.30, 0.3, normalize(vec2(-0.323,   0.44 )), 0.9);
    s += wCreateWave(wp, t, 56.123,  1.50, 0.2, normalize(vec2( 0.5312, -0.812)), 0.9);
    // Mittelwert-Ausgleich, siehe WAVE_MEAN_OFFSET.
    return (s + ${WAVE_MEAN_OFFSET}) * mix(0.0, wind, depth01);
  }
`;

/**
 * Die beiden Windsätze, aus denen CalcWave gemischt wird, plus die Zeit.
 *
 * WaterPlugin füllt diese Felder pro Frame aus dem Wetter; das
 * Clutter-Plugin liest DIESELBEN Werte, damit die Pflanzen auf genau der
 * Welle liegen, die das Wasser zeichnet.
 */
export interface WaveState {
  time: number;
  windIntensity: number;
  windDirX: number;
  windDirZ: number;
  windIntensity2: number;
  windDir2X: number;
  windDir2Z: number;
  windAlpha: number;
}
