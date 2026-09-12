/**
 * Grading — `ShadowsMidtonesHighlights` des Vorbilds als 3D-Nachschlagetabelle.
 *
 * Grading — the original's ShadowsMidtonesHighlights as a 3D LUT.
 *
 * ── Welche Szene der Massstab ist ────────────────────────────────────
 * Bis zum 11.09.2026 stand hier LEVEL1 als Vorbild. Das war die falsche
 * Szene: Level1 ist die Wildnis-Stimmung (kein Tonemapper, flach,
 * Bildkontrast p95/p5 = 0,14…0,43); gemeint war aber immer das DORF —
 * warm, satt, mit blaeulichen Schatten. Seit der Entscheidung E1 der
 * Analyse ist VILLAGE1 das Leitbild fuer die freie Welt; die
 * Level1-Werte bleiben der Massstab fuer Hoehle und Nacht.
 *
 * Beide Zahlensaetze stehen unten, weil der Unterschied genau in den
 * zwei Zeilen liegt, um die es geht — und weil ein Profil, das wieder
 * auf Level1 zeigt, dann drei Zeilen in `server.yml` ist und keine
 * Archaeologie.
 *
 * ── Die Zahlen, wie das Vorbild sie ablegt ───────────────────────────
 * GELESEN aus den Spieldaten, Kette Szene → Profil → Komponente, beide
 * Male ganz nachgegangen statt aus einer Zusammenfassung abgeschrieben
 * (die Fundstellen stehen in der Analyse-Notiz, §B und §E):
 *
 *   DORF (Leitbild)
 *     schatten    (0,9800831 / 0,92229587 / 1,0)       Offset −0,044477392
 *     mitten      (1,0 / 0,960438 / 0,9038545)         Offset −0,014825796
 *     lichter     NICHT ueberschrieben → (1/1/1), Offset 0
 *     schattenStart 0     schattenEnde 0,3
 *     lichterStart 0,55   lichterEnde 1,0    (beide nicht ueberschrieben)
 *     dazu Tonemapping `Neutral` und postExposure +0,2 EV
 *
 *   WILDNIS (fuer Hoehle/Nacht)
 *     schatten    NICHT ueberschrieben → (1/1/1), Offset 0
 *     mitten      (1,0 / 0,96118146 / 0,9367113)       Offset 0
 *     lichter     (1,0 / 0,91309065 / 0,78004485)      Offset −0,16403778
 *     schattenStart 0  schattenEnde 0,3  lichterStart 1,07  lichterEnde 1,58
 *
 * VORBEREITET (`gradingZeile` unten) wird aus der Dorf-Schattenzeile
 * 0,911 / 0,788 / 0,956 und aus der Mittenzeile 0,985 / 0,898 / 0,780 —
 * die Zahlen, unter denen die Analyse sie fuehrt. Das Profil fuehrt
 * Farben als HEX, also auf 8 Bit gerundet: `#faebff` und `#fff5e6`. Was
 * die Rundung kostet, ist gerechnet und nicht geschaetzt — im groessten
 * Fall 0,0038 auf dem vorbereiteten Blau der Mittenzeile (0,7765 statt
 * 0,7803; das Nachbarbyte 231 laege mit 0,0041 noch weiter daneben,
 * naeher kommt ein Hex nicht heran). Auf einem Himmel bei Byte 147 sind
 * das rund 0,3 sRGB-Byte.
 *
 * ── Was die Schattenzeile tut, und warum sie bisher nichts tat ───────
 * Sie stand auf `#ffffff` mit Offset 0 — also auf der Eins. Die Rechnung
 * unten hat sie immer schon mitgefuehrt, sie hat nur nichts bewirkt.
 * „Schattenzeile ergaenzen" hiess deshalb NICHT: Code nachziehen,
 * sondern den Wert eintragen (`server.yml`, `look.grading.schatten*`) —
 * und vorher wissen, was er anrichtet.
 *
 * GEMESSEN am laufenden Client (Pose `weitblick`, 12:00, Rechtecke der
 * Analyse; alles andere unveraendert, nur die Tabelle getauscht):
 *
 *   Wiesenboden  L 44,2 → 39,8   S 0,605 → 0,595   H 48,8 → 41,5
 *   Himmel       L 146,5 → 145,0  S 0,180 → 0,146   H 201,7 → 191,0
 *
 * Die Zeile DUNKELT also und zieht den Farbton ins Warme; sie ist kein
 * Aufheller. Wer mit ihr auf die Zielhelligkeit will, braucht den
 * zweiten Regler dazu (`look.kontrast`, die Herleitung steht in
 * `lookProfil.ts`).
 *
 * Warum sie so deutlich wirkt, steht in der Bandverteilung: 0,3 LINEARE
 * Luminanz ist sRGB-Byte 149. Im ausgelieferten Stand liegt unser
 * Wiesengrund bei linearer Luminanz 0,035 und der Himmel bei 0,268 — der
 * Boden ist damit zu 96 % „Schatten", der Himmel zu 97 % „Mitten". Die
 * zwei Zeilen teilen das Bild also sauber in Grund und Himmel; die
 * Schattenzeile ist hier der Griff an den BODEN.
 *
 * ── Die Lichter-Zeile ────────────────────────────────────────────────
 * In der Wildnis feuert sie NIE: `lichterStart` steht auf 1,07, und der
 * Eingang dieser Tabelle kann 1,0 nicht ueberschreiten (Beleg gleich
 * darunter). Wer diese Zeile uebertraegt, uebertraegt eine Zahl, die im
 * Vorbild nichts tut.
 *
 * Im Dorf steht sie auf 0,55…1,0 und KANN feuern — sie ist dort die
 * Eins. Das heisst NICHT „sie tut nichts": `fM = 1 − fS − fH` verdraengt
 * ueber Luminanz 0,55 das MITTENgewicht, die Mittentoenung laeuft in den
 * hellsten Flaechen also aus. Genau das ist die Handschrift des Dorfs —
 * Weiss bleibt dort neutral, waehrend es in der Wildnis bis ins letzte
 * Byte gewaermt wird (255/255/255 gegen 255/245/239, nachgerechnet im
 * Test). Was sie NICHT kann, ist eine eigene Farbe hinzufuegen: sie
 * zieht ausschliesslich zur unveraenderten Farbe hin, ueber die ganze
 * Tabelle geprueft.
 *
 * In unserer Szene ist der Unterschied trotzdem null — GEMESSEN liefert
 * dieselbe Pose mit `lichterStart` 0,55 und mit 1,07 Boden L 39,8 und
 * Himmel L 145,0 gegen 145,1, ein Zehntel Luma. Grund ist wieder die
 * Bandverteilung: der Himmel liegt bei 0,268 und damit weit unter 0,55.
 * Sichtbar wird der Unterschied erst an Flaechen ueber sRGB-Byte 195
 * (Sonnenscheibe, Schnee, Glanzlichter).
 *
 * ── Warum der Eingang garantiert LDR ist ─────────────────────────────
 * `imageProcessingFunctions` (Babylon 8.56) rechnet in dieser
 * Reihenfolge:
 *
 *   exposure → vignette → tonemapping → toGammaSpace → SATURATE
 *   → contrast → COLORGRADING (diese Tabelle) → colorCurves
 *
 * Das `saturate()` VOR dem Grading ist die Garantie: was hier abgetastet
 * wird, liegt in [0, 1], und die Luminanz unten kann 1,0 nie
 * ueberschreiten. Dieselbe Stelle der Kette wie im Vorbild, und der
 * Grund, aus dem eine 1,07 eine Zahl ohne Wirkung ist.
 *
 * Der Kontrastregler liegt VOR der Tabelle — auch das wie im Vorbild, wo
 * `contrast` im LUT-Bau vor SMH steht. Wer an `look.kontrast` dreht,
 * verschiebt damit die Baender mit; die Zahlen oben gelten fuer den
 * ausgelieferten Stand (`kontrast` 0,84).
 *
 * ── Die Falle, die kein Symptom hat ──────────────────────────────────
 * `fM = 1 − fS − fH`. Ueberlappen die Baender (`schattenEnde` groesser
 * als `lichterStart`), wird das Mittengewicht NEGATIV und die Tabelle
 * kehrt Farben um. Das Vorbild rechnet genauso und klemmt ebenfalls
 * nicht; die Pruefung in `shared/src/lookProfil.ts` kennt nur Bereiche,
 * keine Reihenfolge. Deshalb steht in `setzeGrading` eine Warnung — sie
 * kostet einen Vergleich je Profilwechsel und ist das Einzige, was
 * diesen Fehler ueberhaupt sichtbar macht.
 *
 * ── Warum eine LUT und kein eigener Nachbearbeitungsschritt ──────────
 * Weil das Vorbild es genauso macht und Babylon den Steckplatz dafür
 * hat: `ImageProcessingConfiguration.colorGradingTexture` wird im Shader
 * NACH Tonemapping, Gammawandlung und Kontrast auf das fertige
 * sRGB-Bild angewandt (Block `COLORGRADING`) — dieselbe Stelle der
 * Kette. Ein eigener Vollbild-Durchgang wäre eine zusätzliche Passage
 * für dieselbe Rechnung.
 *
 * ── Und warum NICHT `ColorCurves` ────────────────────────────────────
 * Babylons `ColorCurves` hat zwar Schatten/Mitten/Lichter, führt sie
 * aber als Hue/Density/Saturation/Exposure über HSB und mischt sie mit
 * einer FESTEN Rampe (`luma·3 − 1,5`). Weder die Farbe (ein RGB-Tripel
 * ist dort nicht eintragbar) noch die Schwellen (0,3 / 0,55) liessen
 * sich damit treffen. Der Sättigungsregler dieser Klasse bleibt
 * unabhängig davon nutzbar — was er kostet, steht in `lookProfil.ts`.
 *
 * ── Genauigkeit ──────────────────────────────────────────────────────
 * 32³ Stützstellen mit trilinearer Interpolation — die Gittergrösse, die
 * das Vorbild auf der wirksamen Qualitätsstufe selbst fährt
 * (LUT-Größe 32). Die Tabelle wird EINMAL je Profiländerung gebaut
 * (32³ × 4 Byte = 128 kB) und danach nur noch abgetastet.
 *
 * Nachgerechnet wird das alles ohne WebGL in
 * `client/test/grading-schatten.ts`.
 */
import { RawTexture3D } from '@babylonjs/core/Materials/Textures/rawTexture3D';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { LookGrading } from '@wov/shared';

/** Kantenlänge der Nachschlagetabelle — die LUT-Größe des Vorbilds. */
export const GRADING_LUT_KANTE = 32;

/**
 * sRGB-Byteanteil (0..1) → linear. NICHT die exakte sRGB-EOTF, sondern
 * `pow(x, 2.2)` — Babylon setzt in diesem Client `useExactSrgbConversions`
 * nirgends (Default `false`) und rechnet Farbraumwandlungen deshalb mit der
 * einfachen Gammakurve. Die LUT muss mit derselben Kurve gebaut werden, mit
 * der Babylon das Bild kodiert hat, sonst passt sie nicht zur Textur.
 *
 * Not the exact sRGB EOTF but `pow(x, 2.2)` — this client never sets
 * Babylon's `useExactSrgbConversions` (default `false`), so Babylon's own
 * colour-space conversions use the simple gamma curve. The LUT must be
 * built with the same curve Babylon used to encode the image, or it won't
 * line up with the texture.
 */
function zuLinear(s: number): number {
  return Math.pow(s, 2.2);
}

/** linear → sRGB-Anteil (0..1). Gegenstück zu `zuLinear`, siehe dort. */
function zuSrgb(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  return Math.pow(c, 1 / 2.2);
}

/** `#rrggbb` → drei Anteile 0..1, ohne Farbraumwandlung. */
function hexAnteile(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Eine der drei Zeilen so aufbereiten, wie das Vorbild es tut.
 *
 * Zwei Schritte, und beide sind leicht zu übersehen:
 *  1. Die Farbe steht im Inspektor als GAMMA und wird linearisiert.
 *  2. Der Offset (`.w` im Vector4) wird bei POSITIVEM Vorzeichen
 *     vervierfacht, bei negativem nicht — eine Asymmetrie, die man
 *     einer Zahl wie −0,164 nicht ansieht. Danach `max(…, 0)`.
 *
 * Exportiert, damit der Test die vorbereiteten Zahlen nachrechnen kann
 * (Dorf-Schatten → 0,911 / 0,788 / 0,956). Eine Zeile, deren
 * VORBEREITETER Wert niemand prüft, ist ein Hex mit Hoffnung.
 */
export function gradingZeile(hex: string, offset: number): [number, number, number] {
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
 * Die drei Bandgewichte zu einer LINEAREN Luminanz — die Mischformel des
 * Vorbilds, Zeile für Zeile.
 *
 * Eigene Funktion, weil sie sonst zweimal existierte: einmal in der
 * Tabelle unten und einmal im Test. Zwei Kopien einer Mischformel laufen
 * genau so lange gleich, bis jemand eine davon anfasst.
 */
export function gradingGewichte(
  g: LookGrading,
  luma: number
): { schatten: number; mitten: number; lichter: number } {
  const fS = 1 - glatt(g.schattenStart, g.schattenEnde, luma);
  const fH = glatt(g.lichterStart, g.lichterEnde, luma);
  return { schatten: fS, mitten: 1 - fS - fH, lichter: fH };
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
 * Exportiert, weil `client/test/grading-schatten.ts` sie ohne WebGL
 * nachrechnet — eine Rechnung, die nur im laufenden Client existiert,
 * ist keine geprüfte.
 */
export function gradingLutDaten(g: LookGrading, kante = GRADING_LUT_KANTE): Uint8Array {
  const S = gradingZeile(g.schatten, g.schattenOffset);
  const M = gradingZeile(g.mitten, g.mittenOffset);
  const H = gradingZeile(g.lichter, g.lichterOffset);
  const daten = new Uint8Array(kante * kante * kante * 4);
  let i = 0;
  for (let z = 0; z < kante; z++) {
    const lb = zuLinear(z / (kante - 1));
    for (let y = 0; y < kante; y++) {
      const lg = zuLinear(y / (kante - 1));
      for (let x = 0; x < kante; x++) {
        const lr = zuLinear(x / (kante - 1));
        const luma = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const { schatten: fS, mitten: fM, lichter: fH } = gradingGewichte(g, luma);
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
  /*
    Ueberlappende Baender kehren Farben um, ohne dass irgendetwas
    ausfaellt (Kopfkommentar, „Die Falle, die kein Symptom hat"). Eine
    Warnung statt einer Klemme: geklemmt rechnete die Tabelle
    stillschweigend etwas anderes als das Vorbild, und damit waere der
    Vergleich kaputt statt der Fehler sichtbar.
  */
  if (profil.schattenEnde > profil.lichterStart) {
    console.warn(
      `[Grading] look.grading.schattenEnde (${profil.schattenEnde}) liegt ueber ` +
        `lichterStart (${profil.lichterStart}) — das Mittengewicht wird negativ ` +
        `und die Tabelle kehrt Farben um.`
    );
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
