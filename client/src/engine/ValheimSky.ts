/**
 * ValheimSky — stylised sky dome driven by the SAME environment data as the fog.
 *
 * ── Why not Babylon's SkyMaterial ────────────────────────────────────
 * `@babylonjs/materials/sky` implements the **Preetham analytic daylight
 * model**: it derives the sky colour physically from turbidity and the sun
 * position, and it has no knowledge whatsoever of our environment
 * colours. That is a real defect, not a matter of taste — the horizon it
 * paints CANNOT match `scene.fogColor`, so sky and fog visibly disagree
 * exactly where they meet. In the original they match by construction: the
 * horizon *is* the fog colour, which is why the world reads as one
 * atmosphere instead of a backdrop behind a foggy scene.
 *
 * That sky is also not physical to begin with — it is a stylised
 * vertical gradient with a sun/moon disc, stars and scrolling cloud
 * layers, in the same family as the well-known stylised-skybox recipe
 * (three-stop gradient, sun/moon from the directional light, stars masked
 * by `1 - clouds`).
 *
 * So this dome is built from the environment model instead:
 *   horizon  = look.himmel.horizont   (oder die Nebelfarbe, s. unten)
 *   zenith   = look.himmel.zenit      → der senkrechte Verlauf
 *   sun glow = state.sunColor         → ties the glow to the same keyframes
 *   sun/moon disc at the TRUE sun direction (below horizon at night)
 *   stars    fade in with night, masked by clouds
 *   clouds   procedural FBM, coverage from EnvSetup.rainCloudAlpha
 *
 * ── Stand nach Block A (A5, A6, A12) ─────────────────────────────────
 * Bis zum 11.09.2026 standen `zenit` und `horizont` beide auf `#819195`
 * — eine gleichmässige Kuppel, mit der Begründung „ein Verlauf wäre eine
 * Erfindung, aus einem einzigen Messwert folgen keine zwei Stützpunkte"
 * (`server.yml`). Tor T2 der Roadmap hebt das auf, und der zweite
 * Stützpunkt ist inzwischen da: Die Original-Würfelkarte `Sky1 L1`
 * (`~/wov-assets/Assets/Cubemap/AllSky_FantasyClouds_High3`) liegt
 * lokal vor und sagt, in welche RICHTUNG der Verlauf geht — Zenit
 * dunkler und deutlich blauer, Horizont heller und fast weiss (gemessen
 * mit Tint #B2D1FE und Exposure 0,8: L 113 / S 0,58 bei +42°, L 168 /
 * S 0,33 bei +5°). Dieselbe Richtung misst Bild 3 der Referenz auf dem
 * Bildschirm, nur flacher: L 137,7 oben gegen L 154,6 weiter unten.
 *
 * Drei Dinge kommen damit dazu, und jedes hat einen Regler in
 * `shared/src/lookHimmel.ts` und einen Zeugen in
 * `~/wov-lab-mess/himmel-mess.mjs`:
 *
 *   A5   Wolken    dritte, mit Parallaxe abgesetzte Lage und ein
 *                  Silberrand zur Sonne; die Wolkenfarbe wird aus dem
 *                  Himmel AN DIESER STELLE gewonnen, nicht aus einer
 *                  eigenen Farbe.
 *   A6   Nebelwand die Kuppel wird in ihrem untersten Band selbst zur
 *                  Nebelfarbe — die Naht Kuppel/Nebel verschwindet, ohne
 *                  dass der Himmel seine kalibrierte Farbe verliert.
 *   A12  Halo      ein ZWEITER, breiterer Sonnenhof neben dem schmalen
 *                  Kern; das Vorbild hat beides.
 *
 * Mit `?sky=flach` steht wieder genau der Stand davor (Weiche in beide
 * Richtungen), mit `?sky=cubemap` die Original-Würfelkarte als
 * Messvergleich — beides nur lokal, s. `diagnose` unten.
 *
 * Everything is procedural: no ripped sky textures, so this needs nothing
 * from the 4.9 GB asset export. Swapping in the real cloud/star textures
 * later is a texture bind, not a rewrite.
 *
 * Implementation note: a raw `ShaderMaterial` (not NodeMaterial) because
 * the dome needs a handful of trig/noise operations that are far clearer —
 * and cheaper to review — as GLSL than as a node graph. Rendered on a
 * back-face sphere with `infiniteDistance`, depth-write off, fog off.
 */
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial';
// SEITENEFFEKT, nicht wegoptimieren: `BaseTexture.sphericalPolynomial` ist
// eine Modul-Erweiterung und existiert bei den granularen Imports dieses
// Projekts nur, wenn diese Datei geladen wurde. Ohne sie geht die
// Zuweisung unten still ins Leere — dieselbe Klasse von Fallstrick wie der
// fehlende PrePass-Scene-Component in PostProcessing.ts.
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import type { EnvState } from '@wov/shared';
import {
  haloExponent,
  kuppelNacht,
  liesHimmelPlus,
  LOOK_HIMMEL_PLUS_VORGABE,
  type LookHimmelPlus,
} from '@wov/shared';
import { beiLook, hexLinear, HORIZONT_AUS_NEBEL, look, type LookProfil } from './lookProfil';

const SHADER_NAME = 'valheimSky';

/**
 * Die Himmelsfarbe, auf der `design/look-referenz.md` kalibriert ist —
 * Bild 3, Rechteck 1220,20–1290,70, RGB 129/145,4/148,6.
 *
 * Sie steht hier nur noch für den Diagnoseschalter `?sky=flach`, der den
 * Stand VOR A5 wiederherstellt: eine gleichmässige Kuppel auf genau
 * diesem Wert. Der Betrieb liest Zenit und Horizont aus dem Profil.
 *
 * The single sky colour the reference was calibrated on; kept for the
 * `?sky=flach` diagnostic switch, which restores the pre-A5 flat dome.
 */
const VOR_A5_HIMMEL = '#819195';

/**
 * Abtastrichtungen für die Kugelharmonischen des Umgebungslichts.
 * 128 sind für neun Koeffizienten reichlich — die zweite Bande ist bei
 * einem so glatten Verlauf ohnehin fast leer.
 */
const IBL_RICHTUNGEN = 128;
/** Sekunden zwischen zwei Neuberechnungen — Begründung an der Methode. */
const IBL_ABSTAND_S = 2;
/** Goldener Winkel in Radiant: π · (3 − √5). */
const GOLDENER_WINKEL = Math.PI * (3 - Math.sqrt(5));

/**
 * Der Himmelsverlauf als eigenständige GLSL-Funktion — EINE Quelle für die
 * Kuppel und für die Spiegelung im Wasser.
 *
 * ── Warum das geteilt wird ──────────────────────────────────────────
 * Das Wasser las vorher stumpf `state.fogColorSun`, also die Farbe
 * RICHTUNG SONNE, und mischte sie mit bis zu 75 % über die ganze Fläche —
 * unabhängig davon, wohin man blickt. Bei `fogColorSun` (0.92, 0.55,
 * 0.32) am Abend landet man damit bei rund (0.50, 0.30, 0.17): ein
 * flächendeckendes Braun in JEDE Blickrichtung. Genau das hat der Nutzer
 * als "merkwürdige braune Spiegelungen" gemeldet.
 *
 * Für den Nebel macht `Lighting.directionalFogColor()` längst eine
 * Blickrichtungs-Mischung — das Wasser umging sie als einziges.
 *
 * Statt dem Wasser jetzt EINE besser gewählte Farbe zu reichen, wertet es
 * dieselbe Funktion an der Spiegelrichtung aus. Konsistenz zwischen
 * Kuppel und Wasserspiegel ist damit strukturell garantiert und nicht
 * das Ergebnis von Nachjustieren.
 *
 * Bewusst NICHT enthalten: Sonnenscheibe, Wolken und Sterne. Die brauchen
 * die Zusatz-Uniforms und das FBM der Kuppel, und in der bewegten
 * Spiegelung einer Wasserfläche wäre davon ohnehin kaum etwas zu
 * erkennen. Wer sie will, nimmt eine ReflectionProbe mit
 * `renderList = [sky.mesh]` — der Verlauf hier bleibt dann die Grundlage,
 * über die sie geblendet wird.
 *
 * `toSun` zeigt ZUR Sonne (wie `EnvState.sunDir`), nicht in
 * Lichtausbreitungsrichtung.
 */
export const SKY_GRADIENT_GLSL = /* glsl */ `
vec3 vhSkyGradient(vec3 dir, vec3 horizon, vec3 zenith, vec3 sunGlow, vec3 toSun, float night,
                   float glutBreite, float haloBreite, float haloStaerke) {
  // Zum Horizont hin gestaucht, damit der Himmel dort als "dicke Luft"
  // liest. Exponentiell statt pow(up, 0.45): pow hat bei up=0 eine
  // UNENDLICHE Steigung und setzt damit eine sichtbar harte Kante genau
  // auf den Horizont. exp hat dort eine endliche Steigung und trifft die
  // Null trotzdem exakt — und t(0)=0 ist das, was den Horizont gleich
  // der Nebelfarbe macht.
  float t = 1.0 - exp(-3.2 * max(clamp(dir.y, -1.0, 1.0), 0.0));
  vec3 col = mix(horizon, zenith, t);
  // Breiter Glow: hält die Abendwärme über den Himmel verteilt.
  //
  // Die Schärfe kommt aus 'look.himmel.sonnenglühen' und folgt der
  // Abbildung des Schwesterprojekts (sky-shader.ts): 0 = harte kleine
  // Scheibe (Exponent 220), 1 = über den halben Himmel (Exponent 3).
  // Der Profilwert 0,2 landet bei 176 — deutlich enger als die 8,0, die
  // hier fest standen. Das ist gewollt: Die alte 8,0 kam aus einer Zeit,
  // in der der Glow die ZWEITE Nebelfarbe trug und den halben Himmel
  // wärmen musste. Er trägt jetzt die Sonnenfarbe, und die gehört um die
  // Sonne herum, nicht über den ganzen Himmel.
  // Sharpness follows the sister project's mapping: 0 = hard disc, 1 = wide.
  float schaerfe = mix(220.0, 3.0, clamp(glutBreite, 0.0, 1.0));
  float sunDot = max(dot(dir, toSun), 0.0);
  float kern = pow(sunDot, schaerfe) * 0.55;
  /*
    ── A12: der ZWEITE, breitere Hof ──────────────────────────────────

    Gemessen an Bild 3 der Referenz (Sonnenhof oben links, radiales
    Profil um den hellsten Punkt): Über dem Himmelsgrund von rund L 152
    steht der Kern bei +45 Luma, bei etwa 6° noch bei +14, und ab rund
    9° ist nichts mehr messbar. EIN Term kann das nicht leisten:
    'sonnenglühen' 0,2 ist Exponent 176 und damit bei 5° schon halbiert
    — der Kern stimmt, der Hof fehlt.

    Deshalb ein zweiter Summand mit eigener Breite und eigener Stärke.
    Die Abbildung ist dieselbe wie oben, nur auf einem weiteren Bereich;
    sie steht als 'haloExponent()' in shared/src/lookHimmel.ts, damit
    Shader, CPU-Kopie und Test dieselbe Zahl benutzen. Der Vorgabewert
    0,28 landet bei Exponent 65 und damit bei 8,4° Halbwertsbreite.

    A12: a second, wider halo term — one term cannot be both a
    few-degree core and a ~9-degree glow, and the reference has both.
  */
  float hofExp = mix(90.0, 1.5, clamp(haloBreite, 0.0, 1.0));
  float hof = pow(sunDot, hofExp) * clamp(haloStaerke, 0.0, 1.0);
  return mix(col, sunGlow, clamp(kern + hof, 0.0, 1.0) * (1.0 - night));
}

// Ohne die beiden Halo-Argumente: der Stand, auf dem
// 'design/look-referenz.md' kalibriert ist. Wer so ruft, bekommt
// bewusst keinen Hof.
vec3 vhSkyGradient(vec3 dir, vec3 horizon, vec3 zenith, vec3 sunGlow, vec3 toSun, float night, float glutBreite) {
  return vhSkyGradient(dir, horizon, zenith, sunGlow, toSun, night, glutBreite, 0.0, 0.0);
}

// Die alte Signatur mit SECHS Argumenten bleibt — 'WaterPlugin.ts' ruft
// sie so, und das Wasser gehört einem anderen Bauer. 0.977 ist nicht
// gegriffen, sondern die Umkehrung: mix(220,3,x) = 8 hat die Lösung
// x = (220−8)/217 = 0.9770, also exakt der Exponent, der vorher fest
// hier stand. Das Wasser sieht dadurch aus wie zuvor.
// The six-argument signature stays for WaterPlugin; 0.977 inverts
// mix(220,3,x) = 8, i.e. exactly the exponent that used to be hard-coded.
vec3 vhSkyGradient(vec3 dir, vec3 horizon, vec3 zenith, vec3 sunGlow, vec3 toSun, float night) {
  return vhSkyGradient(dir, horizon, zenith, sunGlow, toSun, night, 0.977, 0.0, 0.0);
}
`;

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  // Direction from the dome centre — the only thing the sky needs.
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform vec3 uHorizon;      // Himmelsfarbe am Horizont (look.himmel.horizont)
uniform vec3 uZenith;       // Himmelsfarbe im Zenit    (look.himmel.zenit)
uniform vec3 uNebel;        // = EnvState.fogColor, die Farbe der Nebelwand (A6)
uniform vec3 uSunGlow;      // = EnvState.sunColor
uniform vec3 uSunColor;     // = EnvState.sunColor
uniform vec3 uSunDir;       // TRUE sun direction, y<0 after sunset
uniform float uNight;       // 0 = full day, 1 = full night
uniform float uCloud;       // coverage 0..1 (EnvSetup.rainCloudAlpha)
uniform float uGlutBreite;  // look.himmel.sonnenglühen, 0..1
uniform float uHaloBreite;  // look.himmel.haloBreite, 0..1        (A12)
uniform float uHaloStaerke; // look.himmel.haloStaerke, 0..1       (A12)
uniform float uWolkeHell;   // look.himmel.wolkenHelligkeit        (A5)
uniform float uWolkeDunkel; // look.himmel.wolkenSchatten          (A5)
uniform float uWolkeParallaxe; // look.himmel.wolkenParallaxe      (A5)
uniform float uSilberrand;  // look.himmel.silberrand              (A5)
uniform float uNebelwand;   // Höhe der Nebelwand in sin(Elevation) (A6)
uniform float uTime;        // seconds, drives cloud drift

${SKY_GRADIENT_GLSL}

// ── value noise + fbm (cheap, no texture needed) ──────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

/**
 * 3D hash for the star field. Deliberately NOT the sin()-based hash above:
 * star cells are quantised direction * 220, so the inputs reach ~+-220 and
 * sin(dot(p, big)) * 43758 loses all precision in float32 there — it
 * degenerates and produced a completely EMPTY night sky (measured: 0 bright
 * pixels). This is the standard sine-free integer hash, which stays well
 * distributed at those magnitudes.
 */
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Star field: sparse bright points from a thresholded hash on a quantised
// direction, so they stay fixed to the sky instead of swimming.
float stars(vec3 dir) {
  vec3 q = floor(dir * 220.0);
  float h = hash31(q);
  float s = smoothstep(0.997, 1.0, h);
  // twinkle
  return s * (0.7 + 0.3 * sin(uTime * 2.0 + h * 100.0));
}

void main(void) {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, -1.0, 1.0);

  // ── vertical gradient + broad sun glow ──────────────────────────
  // Beides steckt in vhSkyGradient (siehe SKY_GRADIENT_GLSL oben) —
  // dieselbe Funktion wertet das WaterPlugin an der Spiegelrichtung aus.
  //
  // max(up, 0.0) darin lässt die GESAMTE untere Halbkugel auf exakt
  // uHorizon — und darüber legt sich weiter unten die Nebelwand (A6),
  // die dort ohnehin voll deckt. Ein früherer Versuch, unterhalb des
  // Horizonts abzudunkeln, sah plausibel aus, brach aber die
  // Nebel-Übereinstimmung (0.002 → 0.155) — deshalb fehlt er bewusst.
  vec3 toSun = normalize(uSunDir);
  vec3 col = vhSkyGradient(dir, uHorizon, uZenith, uSunGlow, toSun, uNight,
                           uGlutBreite, uHaloBreite, uHaloStaerke);
  // Der Verlauf AN DIESER STELLE, bevor Scheibe und Sterne dazukommen —
  // aus ihm entsteht unten die Wolkenfarbe. Die Wolke erbt damit Farbort
  // und Sättigung des Himmels, unter dem sie steht; eine eigene
  // Wolkenfarbe wäre eine zweite Kalibrierung, die niemand pflegt.
  vec3 himmelHier = col;

  // ── sun / moon ──────────────────────────────────────────────────
  float sunDot = dot(dir, toSun);
  // tight disc — sun by day, moon by night (the moon is the same direction
  // mirrored, so use -sunDir once the sun is down)
  float disc = smoothstep(0.9995, 0.9999, sunDot);
  col += uSunColor * disc * 3.0 * (1.0 - uNight);
  float moonDot = dot(dir, normalize(-uSunDir));
  float moonDisc = smoothstep(0.9992, 0.9998, moonDot);
  float moonGlow = pow(max(moonDot, 0.0), 64.0);
  col += vec3(0.75, 0.8, 0.95) * (moonDisc * 2.0 + moonGlow * 0.25) * uNight;

  // ── clouds ──────────────────────────────────────────────────────
  /*
    Auf eine Ebene über dem Betrachter projiziert. Der Summand 0.22 ist
    kein Sicherheitsabstand gegen die Division, sondern der Grund, aus
    dem man die Wolken überhaupt SIEHT:

    Die Kamera dieses Spiels ist ein Ausleger, der auf die Figur zielt.
    Ihre Höhe ist damit an die Neigung gekoppelt, und die Neigung ist bei
    −0,9 rad am Anschlag (BOOM_MIN_PITCH) — noch bevor sie dort ist,
    klemmt der Boden die Kamera. Gemessen an der Pose 'weitblick': Was
    im Bild steht, sind die Elevationen −8° bis +37°, mehr Himmel
    bekommt ein Spieler nie zu sehen.

    Mit dem alten 'dir.xz / max(up, 0.06)' schrumpft das Muster genau in
    diesem Band auf das Zehnfache der Frequenz zusammen: Bei 6°
    Elevation stand cp bei ~10, und fbm(cp · 1,2) ist dort Rauschen und
    keine Wolke. Die 0,22 halten den Nenner in dem Bereich, in dem das
    Muster Formen hat — die perspektivische Stauchung zum Horizont hin
    bleibt (der Nenner wächst weiter mit up), sie wird nur endlich.

    The camera's boom couples height to pitch, so the visible sky is
    roughly -8°..+37°; the old projection turned the clouds into noise
    exactly there.
  */
  float h = up + 0.22;
  vec2 cp = dir.xz / h;
  float c1 = fbm(cp * 0.9 + vec2(uTime * 0.006, uTime * 0.004));
  float c2 = fbm(cp * 1.9 - vec2(uTime * 0.011, uTime * 0.008));
  /*
    ── Die dritte Lage, und warum sie eine ANDERE Ebene braucht ──────

    c1 und c2 liegen auf derselben Projektionsebene. Zwei Muster auf
    EINER Ebene wandern beim Drehen der Kamera gleich schnell — was man
    sieht, ist ein Muster mit mehr Zacken, keine zweite Lage. Tiefe
    entsteht erst, wenn sich die Lagen gegeneinander verschieben.

    Deshalb teilt c3 durch (h + uWolkeParallaxe): eine höher gelegte
    Ebene. Derselbe Blickstrahl trifft sie flacher, ihr Muster ist über
    den Himmel gestreckt und wandert langsamer — das ist Parallaxe im
    Wortsinn, und sie kostet eine Division.

    The third layer is projected onto a HIGHER plane so it drifts
    against the other two; two layers on one plane only add detail.
  */
  vec2 cp3 = dir.xz / (h + uWolkeParallaxe);
  float c3 = fbm(cp3 * 0.55 + vec2(uTime * 0.0022, -uTime * 0.0016));
  /*
    ── Von der Dichte zur Deckkraft, und warum die alte Rechnung nie
       eine Wolke ergeben hat ─────────────────────────────────────────

    Hier stand 'clamp(dichte * 1.6 - (1.25 - uCloud * 1.15), 0.0, 1.0)'.
    Die Zahlen 1,6 / 1,25 / 1,15 unterstellen, dass die Dichte den
    ganzen Bereich 0..1 durchläuft. Nachgemessen über 4.800 Richtungen
    des sichtbaren Himmels tut sie das nicht:

        Mittel 0,466   Streuung 0,069   p5 0,363   p95 0,584

    Ein FBM aus fünf Oktaven ist eine Summe unabhängiger Terme, und die
    landet nach dem Grenzwertsatz um ihren Mittelwert, nicht an den
    Rändern. Mit 'uCloud' 0,34 stand die Schwelle bei 0,859, das
    1,6-fache der Dichte im Mittel bei 0,745 — die Differenz war fast
    immer negativ, und wo sie positiv war, lag sie bei 0,05. Das
    Ergebnis war eine Wolke mit 5 % Deckkraft: rechnerisch vorhanden,
    im Bild nicht zu sehen. Genau das stand in der Roadmap als „Himmel
    oben ohne Wolken".

    Deshalb wird die Dichte zuerst auf ihre eigene Streuung normiert
    (Mitte 0,466, Faktor 4,0 → Mittel 0,5 bei Streuung 0,28) und erst
    dann gegen '1 − Deckung' geprüft. Danach heisst 'uCloud' das, was
    sein Name sagt: der ungefähre ANTEIL des Himmels, der Wolke ist.
    Gegengerechnet: 0,20 → 11 %, 0,34 → 24 %, 0,50 → 41 %.

    The old mapping assumed the fbm spans 0..1; measured, it sits at
    0.466 ± 0.069. Normalising it first is what makes uCloud mean the
    covered fraction — and what makes a cloud opaque enough to see.
  */
  float dichte = c1 * 0.45 + c2 * 0.25 + c3 * 0.30;
  float genormt = (dichte - 0.466) * 4.0 + 0.5;
  // Rohwert um die Schwelle: negativ = klarer Himmel, positiv = Wolke,
  // die NULL ist die Wolkenkante. Beide Seiten werden gebraucht.
  float roh = genormt - (1.0 - clamp(uCloud, 0.0, 1.0));
  // Rampe statt Abschneiden: der Kern deckt voll, nur der RAND ist weich.
  float clouds = smoothstep(0.0, 0.10, roh);
  /*
    Ausblenden zum Horizont hin, damit dort kein hartes Band entsteht.
    Die Schwelle lag bei 0,28 (≈ 16°) — mehr als ein Drittel des Himmels,
    den die Kamera überhaupt zeigt, war damit wolkenfrei. Seit die
    Nebelwand (A6) das unterste Band ohnehin deckt, darf das Ausblenden
    dort ansetzen, wo sie aufhört, statt weit darüber.
  */
  float obenRaus = smoothstep(uNebelwand, uNebelwand + 0.09, up);
  clouds *= obenRaus;
  /*
    ── Silberrand ────────────────────────────────────────────────────

    Angesetzt am RAND und nicht in der Fläche: |roh| ist der Abstand zur
    Wolkenkante, das schmale Band darum ist ihre Kontur. Eine über die
    ganze Wolke gelegte Sonnenfarbe wäre eine gefärbte Wolke; im Vorbild
    ist es eine helle KANTE zur Sonne hin.
  */
  float rand = clamp(1.0 - abs(roh) * 14.0, 0.0, 1.0) * obenRaus;
  /*
    Die Wolke wird aus der Himmelsfarbe AN DIESER STELLE aufgehellt
    bzw. abgedunkelt (himmelHier oben). Vorher stand hier
    'uSunGlow * 0.9 + uSunColor * 0.25' — seit der Schein die
    SONNENFARBE trägt (#FFC98C), wären das orange Wolken über einem
    Himmel, dessen Sättigung auf 0,13 kalibriert ist.
  */
  vec3 wolkeHell = mix(himmelHier, vec3(1.0), clamp(uWolkeHell, 0.0, 1.0) * (1.0 - uNight));
  vec3 wolkeDunkel = himmelHier * mix(clamp(uWolkeDunkel, 0.0, 1.0), 0.62, uNight);
  vec3 cloudCol = mix(wolkeDunkel, wolkeHell, pow(max(sunDot, 0.0), 2.0) * 0.6 + 0.4);
  cloudCol += uSunColor * (rand * uSilberrand * pow(max(sunDot, 0.0), 3.0) * (1.0 - uNight));

  // ── stars (behind the clouds) ───────────────────────────────────
  // uNight squared: stars should vanish quickly once the sky starts to
  // brighten. At dusk/dawn uNight is still ~0.44, and a linear fade left
  // them clearly visible against an already-blue sky.
  col += vec3(stars(dir)) * uNight * uNight * (1.0 - clouds) * smoothstep(0.0, 0.15, up);

  col = mix(col, cloudCol, clouds);

  /*
    ── A6: die Nebelwand ────────────────────────────────────────────

    Seit 'look.himmel.horizont' eine eigene Farbe trägt (Tor T2), treffen
    am Meereshorizont zwei verschiedene Farben aufeinander: unten der
    Nebel, ab 'nebelEnde' volldeckend, oben die Kuppel. server.yml nennt
    diese Naht ausdrücklich als offene Frage.

    Sie wird NICHT dadurch behoben, dass der Horizont wieder die
    Nebelfarbe wird — dann wäre die kalibrierte Himmelsluma nur um den
    Preis der Nebelfarbe zu treffen (Himmel S 0,13 gegen Nebel S 0,55,
    design/look-referenz.md). Sie wird dadurch behoben, dass die Kuppel
    in ihrem UNTERSTEN Band selbst zur Nebelfarbe wird: Was man dort
    sieht, IST Nebel — in jeder Blickrichtung, zu jeder Tageszeit, bei
    jedem Wetter, ohne eine zweite Zahl.

    Der Verlauf zur Nebelfarbe hin ist weich (smoothstep), und das ist
    der Punkt: eine harte Grenze wäre nur eine Kante an einer anderen
    Stelle.

    A6: the dome fades into the fog colour in its lowest band, so there
    is no edge where the fog wall meets the sky — and the calibrated sky
    colour above it stays untouched.
  */
  col = mix(col, uNebel, 1.0 - smoothstep(0.0, max(uNebelwand, 0.0005), up));

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

let registered = false;
function registerShader(): void {
  if (registered) return;
  Effect.ShadersStore[`${SHADER_NAME}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = FRAGMENT;
  registered = true;
}

export class ValheimSky {
  readonly mesh: Mesh;
  /**
   * Würfelkarte des Himmels für die Wasserspiegelung — mit Wolken,
   * Sternen und Sonnenscheibe, die der analytische Verlauf allein nicht
   * liefert.
   *
   * Kostet fast nichts: die Renderliste enthält GENAU ein Mesh (die
   * Kuppel), die Auflösung ist 128², und aktualisiert wird nur jeden
   * 15. Frame. Zum Vergleich die Messwerte in WaterRefraction.ts — dort
   * kostet ein Pass über ~630 Meshes 12 fps. Eine Spiegelung der echten
   * Szene (MirrorTexture) wäre teurer als das und ist deshalb bewusst
   * nicht gebaut.
   *
   * Die Position bleibt im Ursprung: die Kuppel hat `infiniteDistance`,
   * wird also um die jeweilige Renderkamera zentriert — was die Sonde
   * sieht, hängt damit nicht davon ab, wo sie steht.
   *
   * `vhSkyGradient` bleibt trotzdem im Wassershader: solange die Sonde
   * ihren ersten Durchlauf nicht hinter sich hat, ist ihre Textur
   * schwarz, und ein schwarz spiegelndes Meer wäre schlimmer als ein
   * Verlauf ohne Wolken.
   */
  readonly probe: ReflectionProbe;
  private readonly material: ShaderMaterial;
  private time = 0;
  /** Sekunden seit der letzten Neuberechnung des Umgebungslichts. */
  private iblAlter = Number.POSITIVE_INFINITY;
  /** Gehaltene Puffer der Kugelharmonischen-Rechnung (kein Müll pro Lauf). */
  private readonly iblRichtung = new Vector3();
  private readonly iblFarbe = new Color3();
  /**
   * Mittlere LINEARE Leuchtdichte der Kuppel über alle Richtungen — das
   * Mass dafür, wie viel Licht das Umgebungslicht tatsächlich liefert.
   *
   * Nachts nahe null, mittags gross. `Lighting` rechnet damit aus, wie
   * viel es dem HemisphericLight wegnehmen darf, ohne dass am Ende
   * weniger Grundlicht in der Szene steht als vorher.
   */
  umgebungsHelligkeit = 0;

  /**
   * Momentaufnahme für alles, was den Himmel spiegeln will (heute: das
   * WaterPlugin). Enthält genau die Werte, die auch in die Uniforms der
   * Kuppel gehen — hier zu lesen statt sie beim Aufrufer nachzubauen,
   * damit Kuppel und Spiegelbild nicht auseinanderlaufen können.
   *
   * Wird in `update()` befüllt und in place beschrieben (kein neues
   * Objekt je Frame).
   */
  readonly reflectState = {
    /** = EnvState.fogColor, identisch mit scene.fogColor */
    horizon: new Color3(),
    /** abgedunkelter, blauerer Horizont */
    zenith: new Color3(),
    /** = EnvState.fogColorSun */
    sunGlow: new Color3(),
    /** Richtung ZUR Sonne (normalisiert), y < 0 nach Sonnenuntergang */
    toSun: new Vector3(0, 1, 0),
    /** 0 = voller Tag, 1 = volle Nacht (aus der Sonnenhöhe, nicht binär) */
    night: 0,
  };

  /**
   * Die restlichen Uniform-Werte, ebenfalls gehalten statt pro Frame neu.
   *
   * `update()` legte pro Frame acht Objekte an: `new Color3(...)` für
   * Horizont, Zenit, Sonnenglühen und Sonnenfarbe, davon drei mit einem
   * zweiten aus `toLinearSpace()`, dazu ein `new Vector3` für `uSunDir`.
   * Das Muster stand direkt daneben — `reflectState` ist ausdrücklich als
   * „wird in place beschrieben (kein neues Objekt je Frame)" dokumentiert;
   * es war nur nicht auf die Uniforms durchgezogen.
   *
   * ShaderMaterial.setColor3/setVector3 merken sich die REFERENZ und lesen
   * sie erst beim Binden — ein gehaltenes, in place beschriebenes Objekt
   * ist hier also nicht nur billiger, sondern der eigentlich gemeinte Weg.
   */
  private readonly sonnenFarbe = new Color3();
  private readonly sonnenRichtung = new Vector3(0, 1, 0);

  /**
   * Zenit und Horizont aus `look.himmel`, bereits in LINEAR — einmal
   * umgerechnet und danach nur noch gelesen. `update()` läuft in jedem
   * Bild, eine Hex-Umrechnung pro Frame wäre Müll ohne Gegenwert.
   */
  private readonly profilZenit = new Color3();
  private readonly profilHorizont = new Color3();
  /** Ob `look.himmel.horizont` eine Farbe nennt oder dem Nebel folgt. */
  private horizontAusNebel = true;
  private glutBreite = 0.2;
  /**
   * Die Felder aus `shared/src/lookHimmel.ts` (A5/A12).
   *
   * Sie stehen dort und nicht in `LookHimmel`, weil `lookProfil.ts` in
   * diesem Workflow dem Integrator gehört; `liesHimmelPlus()` fällt auf
   * die Vorgaben zurück, solange sie nicht eingehängt sind. Für diese
   * Klasse ändert das spätere Einhängen keine einzige Zeile.
   */
  private himmelPlus: LookHimmelPlus = { ...LOOK_HIMMEL_PLUS_VORGABE };
  /** Die Nebelfarbe in LINEAR — die Farbe der Nebelwand (A6). */
  private readonly nebelFarbe = new Color3();
  /**
   * A6 — Höhe der Nebelwand in sin(Elevation).
   *
   * 0,035 sind 2,0° und kein runder Griff: Gemessen wird die Naht als
   * ΔRGB zwischen dem Band 0,3°…1,2° über und unter der Horizontlinie
   * (`~/wov-lab-mess/himmel-mess.mjs`, Zeuge `naht`). Unterhalb von etwa
   * 1,5° bleibt eine sichtbare Kante stehen; oberhalb von 3° frisst die
   * Wand den unteren Himmel und die Himmelsluma der Pose `weitblick`
   * fällt aus ihrem Fenster von 142 ± 3.
   */
  private nebelwand = 0.035;
  /**
   * Diagnoseschalter `?sky=` — für Messläufe, nicht für den Spielbetrieb.
   *
   *   `?sky=flach`    Verlauf, Wolken, Hof und Nebelwand aus, Kuppel
   *                   gleichmässig auf VOR_A5_HIMMEL: genau der Stand
   *                   vor A5. Das ist die Weiche, die ein Prüfer in
   *                   BEIDE Richtungen greifen kann — ohne sie wäre
   *                   „der Verlauf wirkt" eine Behauptung über ein Bild.
   *   `?sky=cubemap`  die Original-Würfelkarte statt des Verlaufs, als
   *                   Messvergleich. Lädt ausschliesslich lokal
   *                   vorhandene Dateien (`assets/generiert/himmel/`);
   *                   fehlen sie, bleibt die Kuppel unverändert stehen.
   *
   * Gelesen wie `params.has('flat')` in `Terrain.ts` — der Schalter
   * gehört zu dem Stück, das er schaltet, und nicht in `main.ts`.
   */
  private readonly diagnose: string =
    typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('sky') ?? '');

  constructor(scene: Scene, radius = 3000) {
    registerShader();

    this.material = new ShaderMaterial(
      'valheimSkyMat',
      scene,
      SHADER_NAME,
      {
        attributes: ['position'],
        uniforms: [
          'worldViewProjection',
          'uHorizon',
          'uZenith',
          'uNebel',
          'uSunGlow',
          'uSunColor',
          'uSunDir',
          'uNight',
          'uCloud',
          'uTime',
          'uGlutBreite',
          'uHaloBreite',
          'uHaloStaerke',
          'uWolkeHell',
          'uWolkeDunkel',
          'uWolkeParallaxe',
          'uSilberrand',
          'uNebelwand',
        ],
        // Der Quelltext oben liegt im GLSL-Store. Ohne die explizite Sprache
        // sucht ShaderMaterial unter WebGPU nach einer WGSL-Datei namens
        // valheimSky.fragment.fx; Vite beantwortet den unbekannten Pfad mit
        // index.html, das danach als WGSL geparst wird (schwarzes Bild).
        shaderLanguage: ShaderLanguage.GLSL,
      }
    );
    // The dome is the backdrop: never occlude, never be fogged, never lit.
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;

    this.mesh = MeshBuilder.CreateSphere(
      'valheimSky',
      { segments: 48, diameter: radius * 2 },
      scene
    );
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    // Render before everything else so it can't overdraw the world.
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true;

    // `useFloat` und `linearSpace` (5. und 6. Parameter) sind beide
    // Voraussetzung dafür, dass die Probe nicht nur das Wasser spiegelt,
    // sondern als Umgebungslicht taugt (Grafik-Konzept Stufe 5):
    //
    //  · **useFloat** hält Werte über 1 fest. Der Himmel um die Sonne ist
    //    genau das — ein 8-Bit-Ziel schnitte die Spitze ab, und mit ihr
    //    den Unterschied zwischen „hell" und „Lichtquelle".
    //  · **linearSpace** sagt Babylon, dass hier bereits LINEARE Werte
    //    stehen. Ohne die Angabe linearisiert der PBR-Pfad die
    //    Himmelsfarbe ein zweites Mal — derselbe Fehlertyp wie die
    //    doppelte Gammakodierung aus Ursache A des Grafik-Konzepts.
    //
    // Für das Wasser ändert sich dadurch nichts: Es bindet die Würfelkarte
    // über `uniformBuffer.setTexture` aus einem Plugin heraus und liest
    // die Texel roh, ohne Babylons Farbraum-Automatik.
    this.probe = new ReflectionProbe('skyProbe', 128, scene, true, true, true);
    this.probe.renderList!.push(this.mesh);
    this.probe.refreshRate = 15;
    this.probe.position.set(0, 0, 0);
    // ⚠ Ohne diese Zeile wird die Würfelkarte NIE gezeichnet und bleibt
    // schwarz. Babylon rendert ein RenderTargetTexture nur, wenn es in
    // customRenderTargets steht oder von einem Material referenziert
    // wird, das die Szene selbst als benutzt erkennt. Das Wasser bindet
    // sie über uniformBuffer.setTexture aus einem Material-Plugin heraus
    // — das zählt nicht. Symptom war ein durchgehend dunkles Meer
    // (nachgemessen: Mittelwert der +Y-Fläche exakt 0,0,0).
    // WaterRefraction.ts macht dasselbe für seinen Szenenpass.
    scene.customRenderTargets.push(this.probe.cubeTexture);

    this.uebernimmLook(look());
    beiLook((profil) => this.uebernimmLook(profil));
    if (this.diagnose === 'cubemap') void this.ladeWuerfelkarte(scene);
  }

  /**
   * `?sky=cubemap` — die Original-Würfelkarte als MESSVERGLEICH.
   *
   * Nicht als Standard und ausdrücklich nicht als Ziel: Die Karte liegt
   * nur lokal (`~/wov-assets/Assets/Cubemap/AllSky_FantasyClouds_High3`,
   * ein Streifen von 6 × 2048², daraus sechs Flächen unter
   * `assets/generiert/himmel/`), sie wird nicht ausgerollt und sie steht
   * in keinem Commit. Sie beantwortet genau eine Frage: In welche
   * RICHTUNG geht der Verlauf des Vorbilds, und wie stark? Die Antwort
   * steht als Messung im Kopf dieser Datei.
   *
   * Der Import ist dynamisch, damit `StandardMaterial` und `CubeTexture`
   * nicht im Hauptbündel landen — ein Diagnosepfad darf das Spiel nichts
   * kosten. Fehlen die Dateien, bleibt die Kuppel stehen: der Tausch des
   * Materials haengt am `onLoad` der Wuerfelkarte, `onError` raeumt auf.
   */
  private async ladeWuerfelkarte(scene: Scene): Promise<void> {
    try {
      const [{ StandardMaterial }, { CubeTexture }, { Texture }] = await Promise.all([
        import('@babylonjs/core/Materials/standardMaterial'),
        import('@babylonjs/core/Materials/Textures/cubeTexture'),
        import('@babylonjs/core/Materials/Textures/texture'),
      ]);
      // Das Material erst tauschen, wenn alle sechs Flaechen geladen sind.
      // Vorher stand `this.mesh.material = mat` synchron VOR dem Laden, und
      // ein 404 (die Karte liegt auf keinem ausgerollten Host) liess die
      // Kuppel mit kaputter Reflexion stehen — `catch` sieht nur den
      // Import, nicht das asynchrone Laden (Pruefer Block A, 11.09.2026).
      // Swap the material only once all six faces loaded; a 404 must
      // leave the dome untouched.
      const tex = new CubeTexture(
        '/assets/generiert/himmel/allsky',
        scene,
        ['_px.jpg', '_py.jpg', '_pz.jpg', '_nx.jpg', '_ny.jpg', '_nz.jpg'],
        false,
        null,
        () => {
          tex.coordinatesMode = Texture.SKYBOX_MODE;
          const mat = new StandardMaterial('valheimSkyCubemap', scene);
          mat.backFaceCulling = false;
          mat.disableLighting = true;
          mat.reflectionTexture = tex;
          mat.diffuseColor.set(0, 0, 0);
          mat.specularColor.set(0, 0, 0);
          mat.fogEnabled = false;
          this.mesh.material = mat;
          console.info('[ValheimSky] ?sky=cubemap — Original-Würfelkarte statt Verlauf (nur lokal).');
        },
        (meldung) => {
          tex.dispose();
          console.warn('[ValheimSky] ?sky=cubemap: Würfelkarte fehlt, Kuppel bleibt:', meldung);
        },
      );
    } catch (e) {
      console.warn('[ValheimSky] ?sky=cubemap fehlgeschlagen, Kuppel bleibt:', e);
    }
  }

  /** Zenit, Horizont, Glühbreite und die A5/A12-Felder übernehmen. */
  private uebernimmLook(profil: LookProfil): void {
    this.himmelPlus = liesHimmelPlus(profil.himmel);
    if (this.diagnose === 'flach') {
      /*
        Der Stand VOR A5, in einer Zeile: gleichmässige Kuppel auf der
        kalibrierten Farbe, kein Hof, keine Wolken, keine Nebelwand.
        Bewusst HIER und nicht als Uniform-Nullung an vier Stellen — so
        kann keine davon vergessen werden.
      */
      hexLinear(VOR_A5_HIMMEL, this.profilZenit);
      hexLinear(VOR_A5_HIMMEL, this.profilHorizont);
      this.horizontAusNebel = false;
      this.glutBreite = profil.himmel['sonnenglühen'];
      this.himmelPlus = { ...this.himmelPlus, wolken: 0, haloStaerke: 0, silberrand: 0 };
      this.nebelwand = 0;
      return;
    }
    hexLinear(profil.himmel.zenit, this.profilZenit);
    this.horizontAusNebel = profil.himmel.horizont.trim() === HORIZONT_AUS_NEBEL;
    if (!this.horizontAusNebel) hexLinear(profil.himmel.horizont, this.profilHorizont);
    this.glutBreite = profil.himmel['sonnenglühen'];
    this.nebelwand = 0.035;
  }

  /**
   * Messwerte für den Zeugen — was der Himmel gerade TATSÄCHLICH fährt.
   *
   * Ohne diese Auskunft ist jeder der sieben neuen Regler eine Zahl in
   * einer Datei: Man sähe am Bild, dass sich etwas geändert hat, aber
   * nicht, WELCHER Wert angekommen ist. Gelesen wird sie von
   * `~/wov-lab-mess/himmel-mess.mjs` über `window.__dbg.lighting.sky`.
   */
  himmelMesswerte(): Record<string, unknown> {
    return {
      diagnose: this.diagnose || 'aus',
      zenit: [this.profilZenit.r, this.profilZenit.g, this.profilZenit.b].map((v) => +v.toFixed(4)),
      horizont: this.horizontAusNebel
        ? 'nebel'
        : [this.profilHorizont.r, this.profilHorizont.g, this.profilHorizont.b].map((v) => +v.toFixed(4)),
      glutBreite: this.glutBreite,
      nebelwand: this.nebelwand,
      wolkenDeckung: this.wolkenDeckung,
      ...this.himmelPlus,
    };
  }

  /**
   * Die Deckung, mit der die Kuppel gerade rechnet.
   *
   * `look.himmel.wolken` < 0 heisst „dem Wetter folgen" — dann steht hier
   * `EnvState.cloudAlpha`. Gehalten, damit der Zeuge oben nicht raten muss.
   */
  private wolkenDeckung = 0;

  /**
   * Die beiden Farben, aus denen der Verlauf entsteht — in LINEAR, wie sie
   * im Shader stehen.
   *
   * Für Bauer „Boden": Der Splat braucht einen HIMMELSTERM für Schichten
   * mit Metallic 0,5–0,95, sonst wird Fels schwarz (`groundReflection` im
   * Schwesterprojekt, Analyse §4). Bis diese Auskunft existierte, blieb
   * dort nur `scene.fogColor` — das ist der HORIZONT und sagt nichts
   * darüber, was senkrecht über der Fläche steht.
   *
   * KOPIEN, keine Referenzen: `update()` beschreibt `reflectState` in
   * place, ein durchgereichter Zeiger änderte sich dem Empfänger unter
   * den Händen. Wer pro Frame fragt, gibt ein Ziel mit.
   * For Bauer "Boden": the two gradient colours in LINEAR. Copies, not
   * references — `update()` writes reflectState in place.
   */
  gibHimmelsfarben(zielZenit = new Color3(), zielHorizont = new Color3()): {
    zenit: Color3;
    horizont: Color3;
  } {
    return {
      zenit: zielZenit.copyFrom(this.reflectState.zenith),
      horizont: zielHorizont.copyFrom(this.reflectState.horizon),
    };
  }

  /**
   * Push one frame of environment state into the dome.
   *
   * `night` is derived from the sun elevation rather than `state.isNight`
   * so the sky eases through dusk instead of flipping the instant the sun
   * crosses the horizon.
   */
  update(state: EnvState, dtSeconds: number): void {
    this.time += dtSeconds;

    // LINEAR, wie alles, was ohne Babylon-Material direkt in den Buffer
    // geht — der ImageProcessing-Pass wandelt am Ende nach Gamma. Siehe
    // den Farbraum-Block in Lighting.ts; `scene.fogColor` selbst bleibt
    // dort bewusst Gamma, deshalb wird hier umgerechnet statt kopiert.
    //
    // Geschrieben wird gleich in `reflectState` — das ist derselbe Wert,
    // der auch in die Uniforms geht, und genau dafür ist es gedacht.
    /*
      ── Dieselbe Uhr wie das Licht, jetzt auch als Code ────────────────

      Hier stand die Rampe ausgeschrieben: `1 - clamp((elevation + 0.25)
      / 0.45)`. Die Zahlen sind UNVERÄNDERT — Sterne, Mond und
      Sonnenscheibe hängen im Fragment-Shader an genau diesem Wert und
      verblassen zur selben Sekunde wie bisher. Was sich ändert, ist der
      Ort: `kuppelNacht` steht in `shared/src/environment.ts` neben
      `tagseitenAnteil`, der Uhr, die Nebel, Sonne und Grundlicht fährt.

      Warum das mehr ist als Aufräumen: Das schwarze Band am Horizont
      entstand aus einem WIDERSPRUCH zwischen beiden — die Kuppel stand
      auf Tagfarbe, während Licht und Nebel schon Nacht rechneten. Als
      zwei Ausdrücke an zwei Orten war das niemandem nachzuweisen; als
      zwei Funktionen nebeneinander ist es eine Eigenschaft, die ein Test
      festhalten kann (`shared/test/umgebung-tageslauf.ts`, Abschnitt 6).

      Same clock as the light — identical numbers (0.25 / 0.45), moved
      next to `tagseitenAnteil` so the two can be checked against each
      other.
    */
    const night = kuppelNacht(state.elevation);

    const horizon = this.reflectState.horizon;
    horizon.set(state.fogColor.r, state.fogColor.g, state.fogColor.b);
    horizon.toLinearSpaceToRef(horizon);
    // Die ROHE Nebelfarbe, bevor das Profil den Horizont überschreibt —
    // die Nebelwand (A6) braucht genau sie und nicht den Himmelshorizont.
    this.nebelFarbe.copyFrom(horizon);
    /*
      ── Horizont = Nebelfarbe, ausser das Profil sagt etwas anderes ────

      Die Vorgabe (`look.himmel.horizont: nebel`) laesst es beim
      Nebelwert, und das ist keine Faulheit: Die untere Halbkugel der
      Kuppel liegt exakt auf dieser Farbe (s. Kommentar am Fragment), und
      genau dadurch gibt es am Meereshorizont keine Naht zu verstecken.
      Wer eine feste Farbe eintraegt, bekommt sie — aber ZUM TAG HIN
      eingeblendet. Nachts stuende sie sonst unveraendert hell ueber
      einer dunklen Welt, waehrend der Nebel laengst schwarz ist.
    */
    if (!this.horizontAusNebel) Color3.LerpToRef(this.profilHorizont, horizon, night, horizon);
    // Zenith: a deeper, slightly bluer version of the horizon. Derived
    // rather than authored so any EnvSetup — including ones only the dump
    // tool knows about — gets a sane sky without extra data.
    //
    // Der Blau-Sockel ist mit dem Horizont mitgewandert: 0.04 war ein
    // Gamma-Betrag, linear sind das ~0.001. Unverändert übernommen hätte
    // er den Zenit überstrahlt, weil die linearen Nachtfarben rund eine
    // Zehnerpotenz kleiner sind als die Gamma-Werte vorher.
    const zenith = this.reflectState.zenith;
    zenith.set(horizon.r * 0.45, horizon.g * 0.55, Math.min(1, horizon.b * 0.8 + 0.001));
    /*
      ── Zenit aus dem Profil, zur NACHT hin auf den abgeleiteten Wert ──

      Der abgeleitete Zenit oben bleibt stehen und ist der Nachtwert. Ein
      fest gesetztes #17478f haette den Mitternachtshimmel auf einem
      kraeftigen Blau eingefroren, waehrend Nebel und Boden schwarz
      werden — dieselbe Sorte Fehler wie ein fester Ambient-Abzug in der
      Nacht (Lighting.ts, Messung vom 16.08.2026).
    */
    Color3.LerpToRef(this.profilZenit, zenith, night, zenith);

    /*
      ── Der Schein traegt die SONNENFARBE, nicht die zweite Nebelfarbe ─

      Hier stand `state.fogColorSun`. Das trug, solange jedes Wetter zwei
      verschiedene Nebelfarben hatte. `Klar-Comic` hat sie absichtlich
      NICHT (eine kuehle Dunstfarbe, Waerme aus Himmel und Strahlen) —
      damit waeren `sunGlow` und `horizon` identisch und der ganze
      Glow-Term ein Nullbetrag: ein Himmel ohne Sonne, an einem Profil,
      das ein Abend ist.
      Die Sonnenfarbe kommt aus DENSELBEN vier Keyframes, das Argument
      des alten Kommentars gilt also unveraendert weiter.

      The glow carries the sun colour, not the second fog colour: with a
      single cool haze colour the old term would be a no-op.
    */
    const sunGlow = this.reflectState.sunGlow;
    sunGlow.set(state.sunColor.r, state.sunColor.g, state.sunColor.b);
    sunGlow.toLinearSpaceToRef(sunGlow);
    const sunColor = this.sonnenFarbe;
    sunColor.set(state.sunColor.r, state.sunColor.g, state.sunColor.b);
    sunColor.toLinearSpaceToRef(sunColor);

    // Für Konsumenten der Spiegelung (WaterPlugin): horizon/zenith/sunGlow
    // sind oben bereits IN reflectState geschrieben worden, hier bleiben
    // nur die beiden übrigen Felder.
    this.reflectState.toSun.set(state.sunDir.x, state.sunDir.y, state.sunDir.z).normalize();
    this.reflectState.night = night;

    // uSunDir ist die ROHE Sonnenrichtung, nicht die normalisierte aus
    // reflectState.toSun — deshalb ein eigener gehaltener Vektor.
    this.sonnenRichtung.set(state.sunDir.x, state.sunDir.y, state.sunDir.z);

    const p = this.himmelPlus;
    /*
      `wolken` < 0 heisst „dem Wetter folgen" — dann bleibt es bei
      `EnvState.cloudAlpha`, also bei `rainCloudAlpha` des laufenden
      Wetters (Klar-Comic). Ein Wert ≥ 0 übersteuert das für JEDES
      Wetter und ist deshalb ein Diagnose- und kein Look-Regler; wer ihn
      setzt, hat auch im Regen dieselbe Decke.
    */
    this.wolkenDeckung = p.wolken >= 0 ? Math.min(1, p.wolken) : state.cloudAlpha;

    this.material.setColor3('uHorizon', horizon);
    this.material.setColor3('uZenith', zenith);
    this.material.setColor3('uNebel', this.nebelFarbe);
    this.material.setColor3('uSunGlow', sunGlow);
    this.material.setColor3('uSunColor', sunColor);
    this.material.setVector3('uSunDir', this.sonnenRichtung);
    this.material.setFloat('uNight', night);
    this.material.setFloat('uCloud', this.wolkenDeckung);
    this.material.setFloat('uGlutBreite', this.glutBreite);
    this.material.setFloat('uHaloBreite', p.haloBreite);
    this.material.setFloat('uHaloStaerke', p.haloStaerke);
    this.material.setFloat('uWolkeHell', p.wolkenHelligkeit);
    this.material.setFloat('uWolkeDunkel', p.wolkenSchatten);
    this.material.setFloat('uWolkeParallaxe', p.wolkenParallaxe);
    this.material.setFloat('uSilberrand', p.silberrand);
    this.material.setFloat('uNebelwand', this.nebelwand);
    this.material.setFloat('uTime', this.time);

    // Umgebungslicht nachziehen — aber nicht mit 60 Hz, siehe dort.
    this.iblAlter += dtSeconds;
    if (this.iblAlter >= IBL_ABSTAND_S) {
      this.iblAlter = 0;
      this.berechneUmgebungslicht();
    }
  }

  /**
   * Der diffuse Anteil des Umgebungslichts, analytisch aus demselben
   * Verlauf gerechnet, den die Kuppel zeichnet.
   *
   * ── Warum nicht aus der Würfelkarte lesen ────────────────────────────
   * Babylon KANN die Kugelharmonischen aus einer Textur gewinnen — dazu
   * muss es sie aber von der GPU zurücklesen, und ein Rücklesen hält die
   * Pipeline an. Der Setter für `sphericalPolynomial` existiert daneben,
   * also rechnen wir sie selbst: `SKY_GRADIENT_GLSL` steht als
   * eigenständige Funktion da und ist auf der CPU ein Dutzend Zeilen
   * (`himmelsFarbeToRef` unten). Der Nebeneffekt ist der eigentliche
   * Gewinn: Kuppel, Spiegelung, Nebel UND Umgebungslicht stammen damit
   * garantiert aus derselben Quelle und können nicht auseinanderlaufen.
   *
   * ── Die Abtastung ───────────────────────────────────────────────────
   * 128 Richtungen auf einer Fibonacci-Kugel. Die Punkte liegen dort
   * gleichmässig ohne die Polhäufung eines Kugelkoordinaten-Rasters, und
   * jede Richtung trägt denselben Raumwinkel `4π/N` — nur deshalb darf
   * `deltaSolidAngle` ein konstanter Wert sein.
   *
   * `convertIncidentRadianceToIrradiance` faltet mit dem Kosinuslappen,
   * `convertIrradianceToLambertianRadiance` teilt durch π. Beide Schritte
   * sind Pflicht: Ohne sie stünde in der Polynomialform die
   * EINSTRAHLDICHTE statt der abgegebenen Leuchtdichte, und die Szene
   * wäre um Faktor π zu hell.
   *
   * ── Warum alle zwei Sekunden ────────────────────────────────────────
   * Der Lauf kostet rund eine halbe Millisekunde. Bei 60 Hz wären das
   * 3 % der Frame-Zeit für eine Grösse, die sich mit dem Sonnenstand
   * ändert — also über Minuten. Zwei Sekunden sind unterhalb jeder
   * Wahrnehmungsschwelle für eine Ambient-Änderung und kosten 0,03 %.
   */
  private berechneUmgebungslicht(): void {
    const sh = new SphericalHarmonics();
    const raumwinkel = (4 * Math.PI) / IBL_RICHTUNGEN;
    let summe = 0;
    for (let i = 0; i < IBL_RICHTUNGEN; i++) {
      // Fibonacci-Kugel: y läuft gleichmässig von +1 nach −1, der
      // Azimut in Schritten des goldenen Winkels.
      const y = 1 - (2 * i + 1) / IBL_RICHTUNGEN;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * GOLDENER_WINKEL;
      this.iblRichtung.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
      this.himmelsFarbeToRef(this.iblRichtung, this.iblFarbe);
      sh.addLight(this.iblRichtung, this.iblFarbe, raumwinkel);
      summe += 0.299 * this.iblFarbe.r + 0.587 * this.iblFarbe.g + 0.114 * this.iblFarbe.b;
    }
    sh.convertIncidentRadianceToIrradiance();
    sh.convertIrradianceToLambertianRadiance();
    this.probe.cubeTexture.sphericalPolynomial = SphericalPolynomial.FromHarmonics(sh);
    // Mittelwert über dieselben Abtastungen — kostet nichts, weil die
    // Schleife oben ohnehin lief, und ist genau die Grösse, die fehlt,
    // wenn man das doppelte Grundlicht sauber aufteilen will.
    this.umgebungsHelligkeit = summe / IBL_RICHTUNGEN;
  }

  /**
   * CPU-Fassung von `vhSkyGradient` aus `SKY_GRADIENT_GLSL`.
   *
   * Zeile für Zeile dasselbe wie im Shader — wenn dort etwas geändert
   * wird, gehört es hier nachgezogen. Die beiden auseinanderlaufen zu
   * lassen hiesse, das Umgebungslicht aus einem Himmel zu rechnen, den
   * niemand sieht.
   *
   * ⚠ Genau das war der Fall, und es ist beim Einbau des Hofs (A12)
   * aufgefallen: Hier stand `Math.pow(sonne, 8)`, im Shader längst
   * `mix(220, 3, glutBreite)` — bei `sonnenglühen` 0,2 also 176. Acht
   * ist ein Lappen von 23° Halbwertsbreite, 176 einer von 5°; das
   * Umgebungslicht trug damit eine Sonnenwärme über rund ein Achtel der
   * Kugel, die die Kuppel nirgends zeichnet. Die Zahl stammt aus der
   * Zeit VOR dem Profilregler und ist beim Umbau auf `glutBreite` nur
   * hier stehen geblieben.
   *
   * NICHT enthalten sind die Wolken. Sie stehen nur im Fragment, und das
   * ist Absicht: Der diffuse Anteil des Umgebungslichts mittelt über die
   * ganze Kugel, und eine wandernde Wolkendecke würde ihn im Sekundentakt
   * atmen lassen — sichtbar als Flackern an jeder Fläche der Szene.
   *
   * The CPU twin of `vhSkyGradient`. It had drifted: `pow(sonne, 8)`
   * here against the shader's profile-driven exponent (176 at the
   * default), i.e. a 23-degree lobe against a 5-degree one. Clouds stay
   * out on purpose — drifting cloud cover would make the ambient breathe.
   */
  private himmelsFarbeToRef(richtung: Vector3, ziel: Color3): Color3 {
    const s = this.reflectState;
    const hoch = Math.max(Math.min(Math.max(richtung.y, -1), 1), 0);
    const t = 1 - Math.exp(-3.2 * hoch);
    const r = s.horizon.r + (s.zenith.r - s.horizon.r) * t;
    const g = s.horizon.g + (s.zenith.g - s.horizon.g) * t;
    const b = s.horizon.b + (s.zenith.b - s.horizon.b) * t;
    const sonne = Math.max(0, Vector3.Dot(richtung, s.toSun));
    const schaerfe = 220 - 217 * Math.max(0, Math.min(1, this.glutBreite));
    const kern = Math.pow(sonne, schaerfe) * 0.55;
    const hof = Math.pow(sonne, haloExponent(this.himmelPlus.haloBreite))
      * Math.max(0, Math.min(1, this.himmelPlus.haloStaerke));
    const k = Math.min(1, kern + hof) * (1 - s.night);
    ziel.set(
      r + (s.sunGlow.r - r) * k,
      g + (s.sunGlow.g - g) * k,
      b + (s.sunGlow.b - b) * k
    );
    return ziel;
  }

  dispose(): void {
    this.probe.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
