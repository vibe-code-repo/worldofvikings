/**
 * NebelRichtung — Valheims zweifarbiger Nebel, pro Pixel statt pro Frame.
 *
 * ── Worum es geht ────────────────────────────────────────────────────
 * Jeder Keyframe des Umgebungsmodells führt ZWEI Nebelfarben: `fogColor`
 * für den Blick von der Sonne weg und `fogColorSun` für den Blick zu ihr
 * hin. Dieser gerichtete, sonnengefärbte Dunst ist der wiedererkennbarste
 * Teil der Bildsprache — ein einziger flacher Nebelton liest sich nie als
 * Valheim, egal wie gut er abgestimmt ist.
 *
 * Babylons Nebel kennt nur EINEN szenenweiten Uniform (`vFogColor`,
 * `ShadersInclude/fogFragmentDeclaration`). Bis hierher hat `Lighting`
 * den Sonnen-/Blick-Term deshalb **einmal pro Frame auf der CPU** aus dem
 * Kamera-Forward gerechnet und das Ergebnis in `scene.fogColor`
 * geschrieben. Das war einheitlich und billig, aber der Ton war über das
 * ganze Bild konstant: Richtung Sonnenuntergang zu drehen wärmte das
 * gesamte Bild, statt nur um die Sonne herum zu glühen.
 *
 * Sichtbar falsch wurde das am Horizont. `ValheimSky` malt seinen
 * Sonnenschein längst pro Pixel (`vhSkyGradient`, `sunGlow` aus demselben
 * `fogColorSun`) — die Kuppel hatte also einen Verlauf, der Nebel davor
 * nicht. Genau an der Nahtstelle, an der beide dieselbe Farbe zeigen
 * müssten, liefen sie auseinander.
 *
 * ── Was dieses Plugin tut ────────────────────────────────────────────
 * Es ersetzt im aufgelösten Fragment-Shader die eine Zeile, die den Nebel
 * einmischt, durch dieselbe Rechnung pro Pixel:
 *
 *     t          = pow(max(dot(blickrichtung, zurSonne), 0), FOG_SUN_EXPONENT)
 *     nebelFarbe = mix(vFogColor, vFogColorSonne, t)
 *
 * Das ist Zeile für Zeile die Formel, die vorher auf der CPU lief
 * (`Lighting.directionalFogColorToRef`), mit einem einzigen Unterschied:
 * `blickrichtung` ist nicht mehr der Kamera-Forward des Frames, sondern
 * der Sehstrahl dieses Fragments. Der Exponent bleibt derselbe, damit die
 * Änderung den Bildeindruck verschiebt und nicht die Abstimmung.
 *
 * ── Warum über `vFogDistance` und nicht über `vPositionW` ────────────
 * Das Rezept in Docs/03 §2.1 schlug `vPositionW` + `vEyePosition` bei
 * `CUSTOM_FRAGMENT_BEFORE_FOG` vor, zusammen mit `material.fogEnabled =
 * false`. Der Weg hier ist kürzer und sicherer:
 *
 * `fogVertex` legt ohnehin `vFogDistance = (view * worldPos).xyz` an —
 * den Vektor vom Auge zum Fragment im SICHTRAUM. Er existiert überall
 * dort, wo `FOG` definiert ist, also überall dort, wo diese Ersetzung
 * greift; `normalize(vFogDistance)` IST die gesuchte Blickrichtung, ohne
 * ein einziges neues Varying. `vPositionW` dagegen wird nur unter
 * Bedingungen deklariert (Beleuchtung, Bump, Reflexion) und fehlt
 * ausgerechnet bei den einfachsten Materialien.
 *
 * Preis dieser Wahl: Die Sonnenrichtung muss im SICHTRAUM ankommen, nicht
 * in Weltkoordinaten — `Lighting` rechnet sie einmal pro Frame um. Das
 * Terrain-NodeMaterial führt seine eigene Nebelkette in Weltkoordinaten
 * und bekommt deshalb den Weltvektor; beide Wege stehen nebeneinander in
 * `Lighting.apply()`.
 *
 * ── Fallstricke ──────────────────────────────────────────────────────
 * 1. **`normalize()` am Augenpunkt.** Für ein Fragment exakt im
 *    Augenpunkt ist `vFogDistance` der Nullvektor, und `normalize(0)`
 *    ist in GLSL undefiniert (auf den meisten Treibern NaN, was als
 *    schwarzer Pixel durchschlägt). Die Division unten deckelt den Nenner
 *    deshalb nach unten ab. Bei einer Nebeldichte, die am Augenpunkt
 *    ohnehin `fog = 1` liefert, ist der Wert dort belanglos — aber „gleich
 *    unsichtbar" ist kein Grund, NaN in eine Farbe zu rechnen.
 * 2. **Leere Ersetzungen werden verworfen** (`materialPluginManager.js`
 *    prüft `injectedCode.length > 0`) — hier irrelevant, weil beide
 *    Ersetzungen Code tragen, aber es ist dieselbe Mechanik wie in
 *    `StandardGammaFix.ts` und `PbrNebelFix.ts`.
 * 3. **Beide Pfade führen `vFogColor` LINEAR**, und darauf setzt die
 *    Mischung auf. Bei PBR bindet Babylon selbst linear
 *    (`BindFogParameters(..., linearSpace = true)`), bei StandardMaterial
 *    schiebt `Lighting.bindeLinearenNebel()` den linearen Wert nach.
 *    `vFogColorSonne` wird deshalb ebenfalls linear gebunden — sonst
 *    mischten zwei Farbräume ineinander und der Sonnenton würde beim
 *    Überblenden heller statt wärmer.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Härte des Übergangs zwischen beiden Nebelfarben. Unverändert aus der
 * bisherigen CPU-Fassung übernommen — diese Änderung wechselt den Ort der
 * Rechnung, nicht ihre Abstimmung.
 *
 * Deutlich weicher als der Sonnenschein der Himmelskuppel (`pow(..., 8)`
 * in `ValheimSky.vhSkyGradient`), und das ist Absicht: Der Schein ist ein
 * enger Kranz um die Sonnenscheibe, der Nebel eine breite Wärmung der
 * halben Himmelsrichtung.
 */
export const FOG_SUN_EXPONENT = 2.5;

/**
 * Die Deklarationszeile aus `fogFragmentDeclaration`. Wir hängen die
 * beiden neuen Uniforms direkt daneben, damit sie garantiert im selben
 * `#ifdef FOG`-Block stehen — ein Uniform, den es ohne Nebel gar nicht
 * gibt, kann auch nicht ungenutzt herumstehen.
 *
 * `!!` = Regex ohne zusätzliche Flags (der Manager setzt `g` selbst).
 */
const RX_NEBEL_DEKLARATION = '!!uniform vec3 vFogColor;';
const DEKLARATION =
  'uniform vec3 vFogColor;uniform vec3 vFogColorSonne;uniform vec3 vZurSonneSicht;';

/**
 * Die eine Zeile, die den Nebel einmischt — aber sie heißt nicht überall
 * gleich.
 *
 * `fogFragment` wird über Babylons Include-MIT-PARAMETERN eingebunden, und
 * der ersetzt den Variablennamen beim Auflösen:
 *
 *     default.fragment  #include<fogFragment>                 → color
 *     pbr.fragment      #include<fogFragment>(color,finalColor) → finalColor
 *     background        #include<fogFragment>(color,baseColor)
 *     particles/sprites #include<fogFragment>(color,gl_FragColor)
 *
 * Ein Regex auf `color.rgb=mix(...)` trifft deshalb NUR StandardMaterial.
 * Genau das ist beim ersten Anlauf passiert: Der Uniform stand im
 * PBR-Shader, die Mischung fehlte — Bäume, Felsen und Gebäude behielten
 * den flachen Nebel, während Boden und Gras den gerichteten bekamen. Der
 * Fehler war unsichtbar bis auf die Nachmessung des übersetzten Shaders,
 * weil beide Töne dieselbe Familie sind und der Unterschied erst gegen die
 * Sonne auffällt.
 *
 * Zwei ausdrückliche Regeln statt eines Regex mit Rückverweis: Der Manager
 * ersetzt `$1` im Ersatzcode nur beim ERSTEN Vorkommen
 * (`materialPluginManager.js`: `newCode.replace("$" + i, match[i])` ohne
 * `g`), gebraucht würde der Name aber zweimal. `baseColor` und
 * `gl_FragColor` stehen bewusst nicht dabei — dieses Plugin hängt nur an
 * Standard- und PBR-Materialien, und ein Regex, der auf nichts passt, wäre
 * eine Behauptung ohne Deckung.
 */
const mischungFuer = (v: string): string =>
  'vec3 vhBlick=vFogDistance/max(length(vFogDistance),1e-4);' +
  `float vhSonne=pow(max(dot(vhBlick,vZurSonneSicht),0.0),${FOG_SUN_EXPONENT});` +
  `${v}.rgb=mix(mix(vFogColor,vFogColorSonne,vhSonne),${v}.rgb,fog);`;

const RX_MISCHUNG_STANDARD = '!!color\\.rgb=mix\\(vFogColor,color\\.rgb,fog\\);';
const RX_MISCHUNG_PBR = '!!finalColor\\.rgb=mix\\(vFogColor,finalColor\\.rgb,fog\\);';

class NebelRichtungPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priorität 120: nach StandardGammaFix (100) und PbrNebelFix (110).
    // Die drei fassen verschiedene Zeilen an, die Reihenfolge ist also
    // nicht zwingend — sie hält nur die Farbraum-Korrekturen vorn und die
    // eigentliche Bildsprache dahinter.
    super(material, 'NebelRichtung', 120, { NEBELRICHTUNG: true }, true, true);
  }

  get isEnabled(): boolean {
    return true;
  }

  prepareDefines(): void {
    // Immer an für die Materialien, die es dekoriert.
  }

  getClassName(): string {
    return 'NebelRichtungPlugin';
  }

  getCustomCode(shaderType: string): { [p: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      [RX_NEBEL_DEKLARATION]: DEKLARATION,
      [RX_MISCHUNG_STANDARD]: mischungFuer('color'),
      [RX_MISCHUNG_PBR]: mischungFuer('finalColor'),
    };
  }
}

/**
 * Hängt den gerichteten Nebel an jedes vorhandene und künftige Standard-
 * und PBR-Material der Szene. Einmal beim Aufbau aufrufen, VOR
 * `scene.blockMaterialDirtyMechanism = true` — sonst bliebe das
 * Neuübersetzen der Shader blockiert.
 *
 * Die Uniforms füllt `Lighting` (dort liegen die Farben und die
 * Sonnenrichtung); dieses Modul liefert nur den Shadercode dafür.
 */
export function installiereNebelRichtung(scene: Scene): void {
  const haenge = (m: Material): void => {
    if (!(m instanceof StandardMaterial) && !(m instanceof PBRBaseMaterial)) return;
    if (m.pluginManager?.getPlugin('NebelRichtung')) return;
    new NebelRichtungPlugin(m);
  };
  for (const m of scene.materials) haenge(m);
  scene.onNewMaterialAddedObservable.add(haenge);
}
