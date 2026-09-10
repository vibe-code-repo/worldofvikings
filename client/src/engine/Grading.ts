/**
 * Grading — `ShadowsMidtonesHighlights` des Vorbilds als 3D-Nachschlagetabelle.
 *
 * Grading — the original's ShadowsMidtonesHighlights as a 3D LUT.
 *
 * ── Was das Vorbild tut ──────────────────────────────────────────────
 * Level1 von Tale of Dark Lands fährt seinen ganzen Farbcharakter über
 * EINE URP-Komponente (`design/original-boden.md` §E): Tonemapping steht
 * auf `None`, `ColorAdjustments` ist AUS (Sättigung wird in KEINER Szene
 * des Spiels überschrieben), und übrig bleibt
 * `ShadowsMidtonesHighlights` mit
 *
 *   midtones    (1,000 / 0,961 / 0,937)  Offset  0,000
 *   highlights  (1,000 / 0,913 / 0,780)  Offset −0,164
 *   highlightsStart 1,07   highlightsEnd 1,58
 *   shadows     unberührt (1/1/1), Start 0, Ende 0,3
 *
 * ── Der Befund, den man beim Abschreiben verpasst ────────────────────
 * `highlightsStart` steht auf **1,07**. URP rechnet die Komponente beim
 * LUT-Bau auf einer Farbe, deren Luminanz in [0, 1] liegt
 * (`ColorGradingMode` ist in allen drei Qualitätsstufen des Spiels
 * **LDR**, s. §D) — `smoothstep(1,07, 1,58, luma ≤ 1)` ist damit
 * IMMER null. **Die Lichter-Zeile des Vorbilds feuert nie.** Wer sie
 * überträgt, überträgt eine Zahl, die im Vorbild nichts tut; sie steht
 * hier trotzdem im Profil, damit die Rechnung nachvollziehbar bleibt und
 * jemand mit einer anderen `lichterStart` sofort sieht, was passiert.
 *
 * Übrig bleibt also eine Mitten-Tönung, eingeblendet über
 * `1 − smoothstep(0, 0,3; luma)`. Das ist weniger, als es klingt, und
 * zugleich genau das Richtige: 0,3 LINEARE Luminanz ist sRGB-Byte 149.
 * Ein Wiesengrund bei Byte 60 (linear 0,046) bekommt davon 6 %, der
 * Himmel bei Byte 142 (linear 0,26) 95 %. Das Vorbild wärmt die HELLEN
 * Flächen und lässt die dunklen in Ruhe.
 *
 * ── Warum eine LUT und kein eigener Nachbearbeitungsschritt ──────────
 * Weil URP es genauso macht (`LutBuilder3D.shader`) und Babylon den
 * Steckplatz dafür hat: `ImageProcessingConfiguration.colorGradingTexture`
 * wird im Shader NACH Tonemapping, Gammawandlung und Kontrast auf das
 * fertige sRGB-Bild angewandt (`imageProcessingFunctions.fx`, Block
 * `COLORGRADING`) — dieselbe Stelle der Kette wie in URP. Ein eigener
 * Vollbild-Durchgang wäre eine zusätzliche Passage für dieselbe Rechnung.
 *
 * ── Und warum NICHT `ColorCurves` ────────────────────────────────────
 * Babylons `ColorCurves` hat zwar Schatten/Mitten/Lichter, führt sie
 * aber als Hue/Density/Saturation/Exposure über HSB und mischt sie mit
 * einer FESTEN Rampe (`luma·3 − 1,5`). Weder die Farbe (ein RGB-Tripel
 * ist dort nicht eintragbar) noch die Schwellen (0,3 / 1,07) liessen
 * sich damit treffen. Der Sättigungsregler dieser Klasse bleibt
 * unabhängig davon nutzbar; das Vorbild dreht ihn nur nirgends.
 *
 * ── Genauigkeit ──────────────────────────────────────────────────────
 * 32³ Stützstellen mit trilinearer Interpolation — die Gittergrösse, die
 * das URP-Asset des Vorbilds auf der wirksamen Stufe „Balanced" selbst
 * fährt (`LUT-Größe 32`, §D). Die Tabelle wird EINMAL je Profiländerung
 * gebaut (32³ × 4 Byte = 128 kB) und danach nur noch abgetastet.
 */
import { RawTexture3D } from '@babylonjs/core/Materials/Textures/rawTexture3D';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { LookGrading } from '@wov/shared';

/** Kantenlänge der Nachschlagetabelle — die LUT-Größe des Vorbilds (§D). */
export const GRADING_LUT_KANTE = 32;

/** sRGB-Byteanteil (0..1) → linear. Dieselbe Kurve wie `Mathf.GammaToLinearSpace`. */
function zuLinear(s: number): number {
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** linear → sRGB-Anteil (0..1). */
function zuSrgb(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** `#rrggbb` → drei Anteile 0..1, ohne Farbraumwandlung. */
function hexAnteile(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Eine der drei Zeilen so aufbereiten, wie URP es tut
 * (`ColorUtils.PrepareShadowsMidtonesHighlights`).
 *
 * Zwei Schritte, und beide sind leicht zu übersehen:
 *  1. Die Farbe steht im Inspektor als GAMMA und wird linearisiert.
 *  2. Der Offset (`.w` im Vector4) wird bei POSITIVEM Vorzeichen
 *     vervierfacht, bei negativem nicht — eine Asymmetrie, die man
 *     einer Zahl wie −0,164 nicht ansieht. Danach `max(…, 0)`.
 */
function zeile(hex: string, offset: number): [number, number, number] {
  const [r, g, b] = hexAnteile(hex);
  const w = offset * (offset < 0 ? 1 : 4);
  return [
    Math.max(zuLinear(r) + w, 0),
    Math.max(zuLinear(g) + w, 0),
    Math.max(zuLinear(b) + w, 0),
  ];
}

function glatt(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Die Tabelle rechnen: RGBA-Bytes, x = Rot, y = Grün, z = Blau.
 *
 * Der Index i entspricht dem Eingangswert `i / (kante − 1)` — genau die
 * Abbildung, die Babylons `colorTransformSettings`
 * (`rgb · (N−1)/N + 0,5/N`) auf die Texelmitten legt. Eine Verschiebung
 * um einen halben Texel hier wäre ein Farbstich, den niemand einer LUT
 * ansieht.
 *
 * Exportiert, weil `tools/test/original-grading.ts` sie ohne WebGL
 * nachrechnet — eine Rechnung, die nur im laufenden Client existiert,
 * ist keine geprüfte.
 */
export function gradingLutDaten(g: LookGrading, kante = GRADING_LUT_KANTE): Uint8Array {
  const S = zeile(g.schatten, g.schattenOffset);
  const M = zeile(g.mitten, g.mittenOffset);
  const H = zeile(g.lichter, g.lichterOffset);
  const daten = new Uint8Array(kante * kante * kante * 4);
  let i = 0;
  for (let z = 0; z < kante; z++) {
    const lb = zuLinear(z / (kante - 1));
    for (let y = 0; y < kante; y++) {
      const lg = zuLinear(y / (kante - 1));
      for (let x = 0; x < kante; x++) {
        const lr = zuLinear(x / (kante - 1));
        const luma = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const fS = 1 - glatt(g.schattenStart, g.schattenEnde, luma);
        const fH = glatt(g.lichterStart, g.lichterEnde, luma);
        const fM = 1 - fS - fH;
        daten[i++] = Math.round(255 * zuSrgb(lr * (S[0] * fS + M[0] * fM + H[0] * fH)));
        daten[i++] = Math.round(255 * zuSrgb(lg * (S[1] * fS + M[1] * fM + H[1] * fH)));
        daten[i++] = Math.round(255 * zuSrgb(lb * (S[2] * fS + M[2] * fM + H[2] * fH)));
        daten[i++] = 255;
      }
    }
  }
  return daten;
}

/**
 * Die Tabelle an die Bildbearbeitung hängen (oder sie abschalten).
 *
 * Die Textur wird WIEDERVERWENDET, wenn schon eine hängt: Ein neues
 * `RawTexture3D` je Profiländerung wäre ein Leck, und der Weg über
 * `update()` erspart zugleich das Neuübersetzen der Shader — die Defines
 * (`COLORGRADING`, `COLORGRADING3D`) bleiben unverändert, solange die
 * Textur dieselbe ist.
 */
export function setzeGrading(
  szene: Scene,
  ip: ImageProcessingConfiguration,
  profil: LookGrading
): void {
  if (!profil.an) {
    ip.colorGradingEnabled = false;
    return;
  }
  const daten = gradingLutDaten(profil);
  const vorhanden = ip.colorGradingTexture as RawTexture3D | null;
  if (vorhanden && vorhanden.is3D && vorhanden.getSize().width === GRADING_LUT_KANTE) {
    vorhanden.update(daten);
  } else {
    const tex = new RawTexture3D(
      daten,
      GRADING_LUT_KANTE,
      GRADING_LUT_KANTE,
      GRADING_LUT_KANTE,
      Constants.TEXTUREFORMAT_RGBA,
      szene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE
    );
    // Ohne CLAMP zieht der Rand der Tabelle auf die andere Seite herum —
    // sichtbar als Farbumschlag in den hellsten und dunkelsten Texeln.
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.wrapR = Texture.CLAMP_ADDRESSMODE;
    // `level` IST das Mischgewicht im Shader (`colorTransformSettings.w`).
    tex.level = 1;
    ip.colorGradingTexture = tex;
  }
  ip.colorGradingEnabled = true;
}
