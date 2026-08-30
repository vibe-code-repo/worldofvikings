/**
 * DungeonMaterial — Weltraum-Triplanar auf den Material-Arrays des
 * Dungeon-Generators 2.0, als `MaterialPluginBase` auf einem gewoehnlichen
 * `PBRMaterial`.
 * DungeonMaterial — world space triplanar on the material arrays of dungeon
 * generator 2.0, as a `MaterialPluginBase` on a plain `PBRMaterial`.
 *
 * Grundlage: `design/ARCHITECTURE.md` AP10/W4/W5/W8/W11 und
 * `design/render-tech.md` §1/§2/§4. Muster: `PbrNebelFix.ts` (Einspritzung),
 * `FackelLicht.ts` (UBO-Eintraege, Stufen-Define, Notbremse), `WaterPlugin.ts`
 * (eigene Sampler und Attribute).
 *
 * ── Warum ueberhaupt Triplanar ───────────────────────────────────────────
 * Die Dungeon-Geometrie entsteht zur Laufzeit aus Quadern (`builder.ts`) und
 * hat KEINE UV-Koordinaten — sie koennte auch keine sinnvollen haben, weil
 * dieselbe Wand je nach Grundriss unterschiedlich lang ist. Weltraum-Triplanar
 * loest das, ohne dass der Bauer je eine Naht legen muss: Jede Textur wird auf
 * den drei Weltebenen XY/XZ/YZ abgetastet und nach der Weltnormale gemischt.
 * The dungeon geometry is built at runtime from boxes (`builder.ts`) and has NO
 * UVs — nor could it have sensible ones, because the same wall is a different
 * length in every floor plan. World space triplanar solves that without the
 * builder ever laying a seam.
 *
 * ── Der Dominanz-Kollaps (W11) ───────────────────────────────────────────
 * Nach `pow(abs(n), SCHAERFE)` und Normierung wird `max(w - SCHWELLE, 0)`
 * gerechnet und erneut normiert. Fuer ein Steingrab aus achsausgerichteten
 * Quadern ist damit fast jede Flaeche EXAKT einachsig — und kostet einen
 * Texturzugriff statt dreier. Das ist der Grund, warum Triplanar hier
 * ueberhaupt bezahlbar ist. Der Schwellwert steht als Theme-Parameter da und
 * wird gemessen, nicht geglaubt (R5: sobald Schraegen haeufig werden, faellt
 * der Schnellpfad weg).
 * After `pow(abs(n), SHARPNESS)` and normalisation, `max(w - THRESHOLD, 0)` is
 * applied and normalised again. For a barrow of axis aligned boxes nearly every
 * surface is then EXACTLY single-axis — and costs one texture fetch instead of
 * three. The threshold is a theme parameter and is measured, not believed.
 *
 * ── Wo der Code landet (am installierten Babylon 8.56.2 NACHGEMESSEN) ────
 * `PbrNebelFix.ts` haelt fest, dass Chunk-Namen zwischen Babylon-Versionen
 * wandern. Die vier Orte unten sind deshalb im Quelltext von
 * `@babylonjs/core/Shaders/pbr.fragment.js` bzw. den dortigen Includes
 * nachgesehen worden; `client/test/dungeon2-material.ts` prueft sie bei jedem
 * Lauf gegen die installierte Fassung, damit ein Babylon-Update nicht still
 * ein Material ohne Textur hinterlaesst.
 *
 *   1. `CUSTOM_FRAGMENT_DEFINITIONS`  — Sampler, Varyings, Hilfsfunktionen.
 *      Steht in `pbr.fragment` VOR `#include<pbrBlockReflectivity>`; nur
 *      deshalb sind die globalen Zwischenwerte unten auch in dessen
 *      Funktionsrumpf sichtbar.
 *   2. `CUSTOM_FRAGMENT_BEFORE_LIGHTS` — die eigentliche Rechnung. Dort sind
 *      `normalW` (aus `pbrBlockNormalGeometric`/`pbrBlockNormalFinal`) und
 *      `surfaceAlbedo` beide bereits deklariert und noch veraenderbar, und es
 *      ist vor `ambientOcclusionBlock`, vor `reflectivityBlock` und vor der
 *      Lichtrechnung. Das ist der einzige Punkt, an dem beides zugleich gilt.
 *   3. `CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS` — Rauheit und Metallic.
 *      Liegt IM Rumpf von `reflectivityBlock()`, wo `metallicRoughness.rg` die
 *      lebende Groesse ist. WICHTIG: Babylon inlinet diese Funktion nur unter
 *      WebGPU/Native (`ShaderCodeInliner` wird nur dort gebaut), unter WebGL2
 *      bleibt sie eine echte Funktion — deshalb liest der Block dort AUSSCHLIESS-
 *      LICH globale Variablen und keine Locals aus `main()`.
 *   4. Ein Regex auf den Aufruf von `ambientOcclusionBlock(...)` — fuer die
 *      Occlusion gibt es KEINEN `CUSTOM_*`-Punkt in Babylon 8.56.2. Der Regex
 *      haengt eine Zeile HINTER den Aufruf; findet er nichts (Babylon-Update),
 *      faellt nur die Occlusion aus, nicht der Shader.
 * Where the code lands (MEASURED against the installed Babylon 8.56.2) — see
 * the German block above; `client/test/dungeon2-material.ts` re-measures all
 * four places on every run so a Babylon update cannot silently leave a
 * texture-less material behind.
 *
 * ── Verhaeltnis zu den vier bestehenden Plugins ──────────────────────────
 * `StandardGammaFix` (100), `PbrNebelFix` (110), `NebelRichtung` (120) und
 * `FackelLicht` (120) haengen sich an JEDES Material der Szene und greifen
 * SPAET an (Gammakorrektur, Nebelmischung, direkt vor dem Nebel). Dieses
 * Plugin hat Prioritaet 10 und greift FRUEH — vor der Lichtrechnung. Es gibt
 * keine Regex-Kollision, weil jene drei auf `color.rgb=toLinearSpace(...)`,
 * `uniform vec3 vFogColor;` und `mix(vFogColor,...)` zielen und keiner dieser
 * Texte in dem hier eingespritzten Code vorkommt — auch das prueft der Test,
 * indem er die Muster aus den drei Quelldateien ausliest statt sie
 * abzuschreiben. Und die Reihenfolge stimmt inhaltlich: Wir setzen Albedo und
 * Normale, die Fackeln beleuchten sie, der Nebel legt sich darueber.
 * Relation to the four existing plugins: they all hook EVERY material and act
 * LATE; this one has priority 10 and acts EARLY, before lighting. No regex
 * collision — the test reads their patterns out of their source files instead
 * of copying them, and asserts none of them matches our injected code.
 *
 * ── Notbremse und Killschalter ───────────────────────────────────────────
 * Ein Uebersetzungsfehler in einem Theme darf nicht den ganzen begehbaren
 * Dungeon unsichtbar machen (ARCHITECTURE AP10, Vorbild
 * `FackelLicht.fackelNotbremse()`). `dungeonNotbremse()` schaltet den
 * Rechenblock per Define ab; uebrig bleibt ein graues, aber vollstaendiges
 * PBR-Material — genau der AP6-Zustand, in dem der Dungeon nachweislich
 * begehbar war. Zusaetzlich schaltet `?triplanar=off` das Plugin von aussen
 * ab, damit A/B-Messungen ohne Codeaenderung gehen.
 * A compile error in one theme must not make the whole walkable dungeon
 * invisible. `dungeonNotbremse()` switches the block off by define, leaving a
 * grey but complete PBR material — exactly the AP6 state in which the dungeon
 * was provably walkable. `?triplanar=off` switches the plugin off from outside
 * so A/B measurements need no code change.
 *
 * ── WebGPU ───────────────────────────────────────────────────────────────
 * Reines GLSL, wie die vier bestehenden Plugins. `sampler2DArray` gibt es
 * ohnehin erst ab WebGL2; unter WebGL1 wird das Plugin gar nicht erst
 * installiert und der Dungeon bleibt grau.
 * Pure GLSL like the four existing plugins. `sampler2DArray` requires WebGL2
 * anyway; under WebGL1 the plugin is not installed at all and the dungeon stays
 * grey.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { Scene } from '@babylonjs/core/scene';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { DungeonMaterialArrays } from './DungeonMaterialArrays';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Vertraege nach aussen / contracts towards the outside
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grafikstufe. Genau die Tabelle aus `render-tech.md` §4, Materialseite:
 * Niedrig = nur Basisschicht, Mittel = plus Blending, Hoch = plus Cavity und
 * Parallax-Zweig.
 * Graphics tier. Exactly the material side of the table in `render-tech.md` §4.
 *
 * Der Wert wandert als ZAHLEN-DEFINE in den Shader (`DUNGEON_STUFE`), nicht als
 * Uniform. Das ist kein Geschmack: Babylon schluesselt seinen Effekt-Cache ueber
 * die Define-Zeichenkette. Waere die Stufe ein Uniform, bekaeme ein Wechsel von
 * Mittel auf Hoch denselben Cache-Schluessel und damit den ALTEN Shader zurueck
 * — der Schalter haette dann kein Symptom ausser dem fehlenden Effekt.
 * The tier travels as a NUMERIC DEFINE (`DUNGEON_STUFE`), not as a uniform.
 * Babylon keys its effect cache by the define string; as a uniform, switching
 * Medium -> High would hit the same cache key and return the OLD shader.
 */
export const enum DungeonGrafikStufe {
  Niedrig = 0,
  Mittel = 1,
  Hoch = 2,
}

/**
 * Name des Vertexattributs, das die Array-Ebene traegt.
 * Name of the vertex attribute carrying the array layer.
 *
 * `materialTag` je ECKE statt je Material: Der Client-Adapter (AP6) merged je
 * (Block x materialTag) — das WAERE ein Uniform. Als Attribut ist es trotzdem
 * richtig, weil damit auch ein Merge ueber mehrere Tags moeglich bleibt (ein
 * Block mit sechs belegten Tags waere sonst sechs Zeichenaufrufe statt eines)
 * und weil der Bauer den Tag ohnehin je Bauteil liefert. Fehlt das Attribut,
 * faellt der Shader auf die feste Ebene aus dem Uniform zurueck — dann ist ein
 * Mesh eben einschichtig.
 * `materialTag` per CORNER instead of per material: the client adapter (AP6)
 * merges per (block x materialTag), which WOULD be a uniform. As an attribute it
 * is still right, because a merge across several tags stays possible (a block
 * with six occupied tags would otherwise be six draw calls instead of one) and
 * because the builder delivers the tag per piece anyway. If the attribute is
 * missing the shader falls back to the fixed layer from the uniform.
 */
export const DUNGEON_SCHICHT_ATTRIBUT = 'dgSchicht';

/**
 * Name des Blend-Attributs. `uv2.x = hoeheUeberBoden` (Meter),
 * `uv2.y = kantenAbstand` (Meter, gedeckelt) — genau die beiden Werte, die
 * `builder.ts` je Ecke ausrechnet (ARCHITECTURE W4).
 * Name of the blend attribute. `uv2.x = height above floor` (metres),
 * `uv2.y = distance to the nearest concave edge` (metres, capped) — exactly the
 * two values `builder.ts` computes per corner (ARCHITECTURE W4).
 *
 * `uv2` und nicht der vierte Vertexfarben-Slot: datenmodell gewinnt gegen
 * render-technik (W4). Vertexfarben bleiben fuer spaetere Deko-Varianz frei,
 * und `uv2` ist in Babylon ohne Sonderweg an Bord.
 */
export const DUNGEON_BLEND_ATTRIBUT = 'uv2';

/**
 * Theme-Parameter je Materialinstanz. Bewusst NICHT statisch wie
 * `FackelLichter`: dort war Teilen richtig, weil alle Fackeln denselben
 * Szenenzustand abbilden — hier ist jedes Thema (Steingrab, Sumpf, Eis, Feuer)
 * ein anderer Satz Zahlen.
 * Theme parameters per material instance. Deliberately NOT static like
 * `FackelLichter`: there sharing was right because all torches mirror one scene
 * state — here every theme is a different set of numbers.
 */
export interface DungeonThema {
  /** Exponent vor dem Dominanz-Kollaps, 3..6 (render-tech §1.1). */
  /** Exponent before the dominance collapse, 3..6. */
  readonly schaerfe: number;
  /** Abzug im Kollaps; 0.15 als Startwert, GEMESSEN (W11). / Collapse cut-off. */
  readonly kollapsSchwelle: number;
  /**
   * Hash-Ursprung des prozeduralen Rauschens — `seeds.material` aus dem
   * Layout, uint32. Kein Kosmetikwert: derselbe Seed und derselbe ganzzahlige
   * Hash wie im Bauer (W8), damit ein Riss, den der Shader zeichnet, nicht
   * neben der Kante liegt, die der Bauer geformt hat.
   * Hash origin of the procedural noise — `seeds.material` from the layout.
   */
  readonly materialSeed: number;

  /** Meter ueber Boden, bis zu denen Moos waechst. / Metres above floor moss grows to. */
  readonly moosHoehe: number;
  /** Weichzeichnung der Hoehengrenze in Metern. / Softening of that limit, metres. */
  readonly moosUebergang: number;
  /** `dot(n, oben)` ab dem Moos ueberhaupt haelt. / `dot(n, up)` moss needs to stick. */
  readonly moosNormaleSchwelle: number;
  /** 0..1 Gesamtstaerke. / 0..1 overall strength. */
  readonly moosStaerke: number;
  readonly moosFarbe: Color3;

  /** Meter zur konkaven Kante, ab denen es trocken ist. / Metres to a concave edge. */
  readonly feuchteReichweite: number;
  readonly feuchteStaerke: number;
  /** Zielrauheit im Nassen (klein = spiegelnd). / Target roughness when wet. */
  readonly feuchteRauheit: number;
  /** Abdunkelung im Nassen, 0..1. / Darkening when wet. */
  readonly feuchteAbdunkeln: number;

  readonly schmutzHoehe: number;
  readonly schmutzUebergang: number;
  readonly schmutzStaerke: number;
  readonly schmutzFarbe: Color3;

  /** Risse je Meter. / Cracks per metre. */
  readonly rissDichte: number;
  /** Rauschschwelle, ab der ein Riss beginnt. / Noise threshold a crack starts at. */
  readonly rissSchwelle: number;
  /** Normalenversatz des Risses. / Normal offset of the crack. */
  readonly rissTiefe: number;

  /** Parallax-Tiefe in Kachelanteilen (nur Stufe Hoch). / Parallax depth. */
  readonly parallaxTiefe: number;
}

/**
 * Startwerte fuer das Thema `steingrab`. Sie sind BEGRUENDET, nicht gemessen —
 * das Abgleichen gegen Mikes Barrow-Referenzbild ist laut `material-plan.md`
 * ausdruecklich ein iterativer Termin und steht noch aus (AP11).
 * Starting values for the `steingrab` theme. They are REASONED, not measured —
 * matching them against Mike's barrow reference is explicitly an iterative
 * session and is still outstanding (AP11).
 */
export const STEINGRAB_THEMA: DungeonThema = {
  schaerfe: 4,
  kollapsSchwelle: 0.15,
  materialSeed: 0,
  moosHoehe: 1.2,
  moosUebergang: 0.6,
  moosNormaleSchwelle: 0.35,
  moosStaerke: 0.85,
  moosFarbe: new Color3(0.32, 0.42, 0.22),
  feuchteReichweite: 0.5,
  feuchteStaerke: 0.7,
  feuchteRauheit: 0.18,
  feuchteAbdunkeln: 0.45,
  schmutzHoehe: 0.35,
  schmutzUebergang: 0.35,
  schmutzStaerke: 0.6,
  schmutzFarbe: new Color3(0.18, 0.15, 0.12),
  rissDichte: 0.55,
  rissSchwelle: 0.72,
  rissTiefe: 0.6,
  parallaxTiefe: 0.04,
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. Der GLSL-Baustein / the GLSL block
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obergrenze der Ebenenzahl im Shader. Sechs Basismaterialien (W5, Tags 0..5);
 * die vier Overlays (6..9) sind Blend-Schichten und tauchen nie als
 * `materialTag` auf — `validateLayout()` erzwingt das bereits im Layout.
 * Upper bound of the layer count in the shader. Six base materials (W5, tags
 * 0..5); the four overlays (6..9) are blend layers and never appear as a
 * `materialTag`.
 */
export const DUNGEON_SCHICHTEN_MAX = 6;

/** 1 / 2^32, damit ein uint32-Hash zu [0,1) wird. / 1 / 2^32 for uint32 -> [0,1). */
const INV_2_HOCH_32 = '2.3283064365386963e-10';

/**
 * Die Deklarationen und Hilfsfunktionen.
 *
 * Exportiert, obwohl nur intern gebraucht — genau aus dem Grund, den
 * `FackelLicht.bausteinGlsl()` nennt: Ein GLSL-Fehler faellt sonst erst auf der
 * GPU auf. So laesst sich der fertige Text ohne laufendes Spiel pruefen, und
 * `client/test/dungeon2-material.ts` tut das je Stufe.
 * Exported although only needed internally, for the reason `FackelLicht`
 * states: a GLSL error would otherwise only surface on the GPU.
 *
 * Die Kommentare IM GLSL sind reines ASCII und englisch — GLSL ES schreibt
 * einen begrenzten Quellzeichensatz vor, und es gibt Treiber, die schon an
 * einem Umlaut im Kommentar aussteigen. Die deutsche Erklaerung steht deshalb
 * im TypeScript-Kommentar, nicht im Shader.
 * The comments INSIDE the GLSL are plain ASCII and English — GLSL ES prescribes
 * a limited source character set and there are drivers that choke on an umlaut
 * in a comment.
 */
export function dungeonDefinitionenGlsl(stufe: DungeonGrafikStufe): string {
  const n = DUNGEON_SCHICHTEN_MAX;
  // Der Blending-Block ist auf Niedrig NICHT vorhanden — nicht nur per
  // `#ifdef` abgeschaltet. Das ist Pruefkriterium 1 aus AP10: Auf Niedrig soll
  // der Shader kuerzer sein, nicht gleich lang mit einem toten Zweig. Der
  // `#ifdef DUNGEON_BLENDING` bleibt trotzdem darum stehen, weil er den
  // Effekt-Cache-Schluessel mitbestimmt (siehe `DungeonGrafikStufe`).
  // The blending block is ABSENT on Low, not merely switched off by `#ifdef`.
  const blending =
    stufe === DungeonGrafikStufe.Niedrig
      ? '    // tier Low: base layer only -- no moss, moisture, grime or cracks'
      : /* glsl */ `
#ifdef DUNGEON_BLENDING
    float hoeheUeberBoden = vDgBlend.x;
    float kantenAbstand = vDgBlend.y;
    float nachOben = dot(n, vec3(0.0, 1.0, 0.0));

    // -- cracks first: they sit UNDER everything that grows on the stone.
    float riss = 0.0;
    if (dgRiss.x > 0.0) {
      float rausch = dgWertRausch(vPositionW * dgRiss.x, dgSeed());
      riss = smoothstep(dgRiss.y, min(dgRiss.y + 0.12, 1.0), rausch);
      dgAlbedo *= mix(1.0, 0.45, riss);
      dgRauheit = mix(dgRauheit, 1.0, riss * 0.6);
      // Not real geometry, only a normal kink -- the design brief asks for
      // flat, calm surfaces, not for every joint in true depth.
      dgNormal = normalize(dgNormal - n * (riss * dgRiss.z));
    }

    // -- grime: pure height threshold, no normal condition (render-tech 2.3)
    float schmutz = (1.0 - smoothstep(dgSchmutz.x, dgSchmutz.x + dgSchmutz.y, hoeheUeberBoden)) * dgSchmutz.z;
    dgAlbedo = mix(dgAlbedo, dgSchmutzFarbe.rgb, schmutz * 0.7);
    dgRauheit = mix(dgRauheit, 1.0, schmutz * 0.5);

    // -- moss: height AND normal, AND-linked. Without the normal condition it
    //    grows on vertical walls near the floor just as strongly as on ledges.
    float moosHoehe = 1.0 - smoothstep(dgMoos.x - dgMoos.y, dgMoos.x + dgMoos.y, hoeheUeberBoden);
    float moosLage = smoothstep(dgMoos.z, 1.0, nachOben);
    float moos = moosHoehe * moosLage * dgMoos.w;
    if (moos > 0.0) {
      vec2 moosUv = vPositionW.xz * dgMoosFarbe.w;
      vec3 moosA = toLinearSpace(texture2D(dungeonMoosAlbedo, moosUv).rgb) * dgMoosFarbe.rgb;
      vec3 moosN = texture2D(dungeonMoosNormal, moosUv).rgb * 2.0 - 1.0;
      dgAlbedo = mix(dgAlbedo, moosA, moos);
      dgRauheit = mix(dgRauheit, 0.95, moos);
      dgNormal = normalize(mix(dgNormal, normalize(dgNormal + vec3(moosN.x, 0.0, moosN.y)), moos));
      dgMetall *= 1.0 - moos;
    }

    // -- moisture: from the BUILDER attribute, never from SSAO. SSAO is a post
    //    process after the material pass and is not readable here (W4). If the
    //    attribute is missing, kantenAbstand arrives large and moisture is off.
    float feuchte = (1.0 - smoothstep(0.0, dgFeuchte.x, kantenAbstand)) * dgFeuchte.y;
#ifdef DUNGEON_CAVITY
    // Tier High only, and expressly NOT a replacement when the attribute is
    // missing: a screen space fallback would be a second behaviour for the
    // same effect. It only sharpens what the attribute already says.
    float cavity = clamp(length(fwidth(n)) * 2.0, 0.0, 1.0);
    feuchte = clamp(feuchte + cavity * dgFeuchte.y * 0.5, 0.0, 1.0);
#endif
    dgAlbedo *= mix(1.0, 1.0 - dgFeuchte.w, feuchte);
    dgRauheit = mix(dgRauheit, dgFeuchte.z, feuchte);
#endif`;
  // Der ganzzahlige Hash unten ist eine ZEICHENGENAUE Uebersetzung von
  // `shared/src/dungeon2/hashing.ts` (Murmur3-Finalizer, dieselben zwei
  // Konstanten, dieselben drei Shifts, dieselbe Reihenfolge x, z, ebene).
  // `Math.imul` ist eine 32-Bit-Multiplikation mit Ueberlauf — in GLSL ist
  // `uint * uint` genau das, ohne Zutun. Der Test vergleicht die Konstanten
  // gegen den Quelltext von `hashing.ts`, damit die beiden nicht auseinander-
  // laufen koennen, ohne dass es jemand merkt.
  // The integer hash below is a CHARACTER-EXACT translation of
  // `shared/src/dungeon2/hashing.ts`.
  const rauschen =
    stufe === DungeonGrafikStufe.Niedrig
      ? '// tier Low: no procedural noise, no cracks'
      : /* glsl */ `
  // Value noise on the integer cell grid, trilinear. Coordinate order matches
  // hashPos(x, z, ebene) of the CPU builder: horizontal, horizontal, vertical.
  float dgWertRausch(vec3 p, uint seed) {
    vec3 g = floor(p);
    vec3 f = p - g;
    vec3 t = f * f * (3.0 - 2.0 * f);
    int gx = int(g.x); int gy = int(g.y); int gz = int(g.z);
    float c000 = dgHash01(gx,     gz,     gy,     seed);
    float c100 = dgHash01(gx + 1, gz,     gy,     seed);
    float c010 = dgHash01(gx,     gz,     gy + 1, seed);
    float c110 = dgHash01(gx + 1, gz,     gy + 1, seed);
    float c001 = dgHash01(gx,     gz + 1, gy,     seed);
    float c101 = dgHash01(gx + 1, gz + 1, gy,     seed);
    float c011 = dgHash01(gx,     gz + 1, gy + 1, seed);
    float c111 = dgHash01(gx + 1, gz + 1, gy + 1, seed);
    float x00 = mix(c000, c100, t.x);
    float x10 = mix(c010, c110, t.x);
    float x01 = mix(c001, c101, t.x);
    float x11 = mix(c011, c111, t.x);
    return mix(mix(x00, x10, t.y), mix(x01, x11, t.y), t.z);
  }`;

  return /* glsl */ `
#ifdef DUNGEON_TRIPLANAR
  // ---- three array samplers for all base materials together (render-tech 1.5)
  uniform sampler2DArray dungeonAlbedoArray;
  uniform sampler2DArray dungeonNormalArray;
  uniform sampler2DArray dungeonOrhArray;
  uniform sampler2D dungeonMoosAlbedo;
  uniform sampler2D dungeonMoosNormal;

  // ---- what the builder hands over per vertex
  varying vec2 vDgBlend;
  varying float vDgSchicht;

  // ---- results, written once in main() before the lighting, read again in
  //      reflectivityBlock() and after ambientOcclusionBlock(). Globals, because
  //      those two places are separate function bodies under WebGL2.
  vec3 dgAlbedo = vec3(0.5);
  vec3 dgNormal = vec3(0.0, 1.0, 0.0);
  float dgRauheit = 1.0;
  float dgMetall = 0.0;
  float dgAo = 1.0;

  // ---- integer hash, character-exact port of shared/src/dungeon2/hashing.ts
  uint dgAvalanche(uint h) {
    h ^= h >> 16u;
    h *= 0x85ebca6bu;
    h ^= h >> 13u;
    h *= 0xc2b2ae35u;
    h ^= h >> 16u;
    return h;
  }
  uint dgVerruehren(uint zustand, int wert) {
    return dgAvalanche(zustand ^ uint(wert));
  }
  uint dgHashPos(int x, int z, int ebene, uint seed) {
    uint h = dgAvalanche(seed);
    h = dgVerruehren(h, x);
    h = dgVerruehren(h, z);
    h = dgVerruehren(h, ebene);
    return h;
  }
  float dgHash01(int x, int z, int ebene, uint seed) {
    return float(dgHashPos(x, z, ebene, seed)) * ${INV_2_HOCH_32};
  }
  uint dgSeed() {
    // The seed travels as two 16 bit halves in a vec4. A single float would
    // lose the low bits above 2^24 and the shader noise would then no longer
    // follow seeds.material at all -- silently.
    return uint(dgTriplanar.z) | (uint(dgTriplanar.w) << 16u);
  }
${rauschen}

  // ---- one array tap on one world plane
  vec4 dgTap(sampler2DArray tex, vec2 uv, float schicht) {
    return texture(tex, vec3(uv, schicht));
  }

  /**
   * The whole surface: three (or, after the dominance collapse, usually one)
   * taps per map, then moss / moisture / grime / cracks on top.
   */
  void dgBerechne(vec3 n) {
    int schicht = int(clamp(vDgSchicht + 0.5, 0.0, ${(n - 1).toFixed(1)}));
    float schichtF = float(schicht);
    float skala = dgSchichtInfo[schicht].x;
    dgMetall = dgSchichtInfo[schicht].y;

    // -- weights: sharpness, normalise, dominance collapse, normalise again
    vec3 an = abs(n);
    vec3 w = pow(an, vec3(dgTriplanar.x));
    w /= max(w.x + w.y + w.z, 1e-6);
    w = max(w - vec3(dgTriplanar.y), vec3(0.0));
    w /= max(w.x + w.y + w.z, 1e-6);

    vec3 wp = vPositionW * skala;
    // Mirror the projection on the back sides, otherwise opposite walls show
    // the texture flipped and a corner reads as a seam.
    vec2 uvX = vec2(n.x < 0.0 ? -wp.z : wp.z, wp.y);
    vec2 uvY = vec2(wp.x, n.y < 0.0 ? -wp.z : wp.z);
    vec2 uvZ = vec2(n.z < 0.0 ? wp.x : -wp.x, wp.y);

#ifdef DUNGEON_PARALLAX
    // Offset limiting parallax on the DOMINANT plane only (render-tech 3.4).
    // After the collapse that plane is almost everywhere the only one, so the
    // special case is cheap instead of expensive.
    {
      vec3 sicht = normalize(vEyePosition.xyz - vPositionW);
      vec2 uvDom = w.x >= max(w.y, w.z) ? uvX : (w.y >= w.z ? uvY : uvZ);
      float hoehe = dgTap(dungeonOrhArray, uvDom, schichtF).b - 0.5;
      vec2 richtung = w.x >= max(w.y, w.z)
        ? vec2(sicht.z, sicht.y)
        : (w.y >= w.z ? vec2(sicht.x, sicht.z) : vec2(sicht.x, sicht.y));
      vec2 versatz = richtung * (hoehe * dgFest.y);
      uvX += versatz * w.x;
      uvY += versatz * w.y;
      uvZ += versatz * w.z;
    }
#endif

    // -- albedo. The array is uploaded sRGB encoded (RawTexture2DArray has no
    //    sRGB buffer flag), so it is linearised here with Babylon's own helper.
    vec3 albedo = vec3(0.0);
    vec3 orh = vec3(0.0);
    vec3 tn = vec3(0.0, 0.0, 1.0);
    vec3 normalWelt;
    if (w.x > 0.999) {
      albedo = dgTap(dungeonAlbedoArray, uvX, schichtF).rgb;
      orh = dgTap(dungeonOrhArray, uvX, schichtF).rgb;
      tn = dgTap(dungeonNormalArray, uvX, schichtF).rgb * 2.0 - 1.0;
      normalWelt = normalize(vec3(tn.z * sign(n.x), tn.y, tn.x));
    } else if (w.y > 0.999) {
      albedo = dgTap(dungeonAlbedoArray, uvY, schichtF).rgb;
      orh = dgTap(dungeonOrhArray, uvY, schichtF).rgb;
      tn = dgTap(dungeonNormalArray, uvY, schichtF).rgb * 2.0 - 1.0;
      normalWelt = normalize(vec3(tn.x, tn.z * sign(n.y), tn.y));
    } else if (w.z > 0.999) {
      albedo = dgTap(dungeonAlbedoArray, uvZ, schichtF).rgb;
      orh = dgTap(dungeonOrhArray, uvZ, schichtF).rgb;
      tn = dgTap(dungeonNormalArray, uvZ, schichtF).rgb * 2.0 - 1.0;
      normalWelt = normalize(vec3(tn.x, tn.y, tn.z * sign(n.z)));
    } else {
      vec3 aX = dgTap(dungeonAlbedoArray, uvX, schichtF).rgb;
      vec3 aY = dgTap(dungeonAlbedoArray, uvY, schichtF).rgb;
      vec3 aZ = dgTap(dungeonAlbedoArray, uvZ, schichtF).rgb;
      albedo = aX * w.x + aY * w.y + aZ * w.z;
      vec3 oX = dgTap(dungeonOrhArray, uvX, schichtF).rgb;
      vec3 oY = dgTap(dungeonOrhArray, uvY, schichtF).rgb;
      vec3 oZ = dgTap(dungeonOrhArray, uvZ, schichtF).rgb;
      orh = oX * w.x + oY * w.y + oZ * w.z;
      // Whiteout blend: the three tangent space normals live in three DIFFERENT
      // spaces, a weighted average of the raw vectors would average directions
      // across spaces. Swizzle each into world axes first, then add.
      vec3 nX = dgTap(dungeonNormalArray, uvX, schichtF).rgb * 2.0 - 1.0;
      vec3 nY = dgTap(dungeonNormalArray, uvY, schichtF).rgb * 2.0 - 1.0;
      vec3 nZ = dgTap(dungeonNormalArray, uvZ, schichtF).rgb * 2.0 - 1.0;
      vec3 tX = vec3(nX.xy + n.zy, nX.z * an.x);
      vec3 tY = vec3(nY.xy + n.xz, nY.z * an.y);
      vec3 tZ = vec3(nZ.xy + n.xy, nZ.z * an.z);
      normalWelt = normalize(tX.zyx * w.x + tY.xzy * w.y + tZ.xyz * w.z);
    }

    dgAlbedo = toLinearSpace(albedo);
    dgAo = orh.r;
    dgRauheit = orh.g;
    dgNormal = normalWelt;

${blending}

    dgRauheit = clamp(dgRauheit, 0.02, 1.0);
    dgAo = clamp(dgAo, 0.0, 1.0);
  }
#endif`;
}

/**
 * Der Aufruf im Hauptprogramm. Er steht an `CUSTOM_FRAGMENT_BEFORE_LIGHTS`,
 * dem einzigen Punkt, an dem `normalW` UND `surfaceAlbedo` beide deklariert
 * und noch veraenderbar sind und der trotzdem vor Occlusion, Reflectivity und
 * Lichtrechnung liegt.
 * The call in the main program, at `CUSTOM_FRAGMENT_BEFORE_LIGHTS` — the only
 * point where `normalW` AND `surfaceAlbedo` are both declared and still
 * mutable while still sitting before occlusion, reflectivity and lighting.
 */
export function dungeonAufrufGlsl(): string {
  return /* glsl */ `
#ifdef DUNGEON_TRIPLANAR
  dgBerechne(normalW);
  surfaceAlbedo = dgAlbedo;
  normalW = dgNormal;
#endif`;
}

/**
 * Vertexseite: Ebene und Blend-Werte durchreichen.
 *
 * `uv2` wird nur unter `#ifdef UV2` von Babylon selbst deklariert
 * (`uvAttributeDeclaration`, am installierten Shader nachgesehen) — deshalb
 * steht die eigene Deklaration unter `#ifndef UV2` und der Name bleibt in
 * beiden Faellen derselbe.
 * Vertex side: pass layer and blend values through. `uv2` is only declared by
 * Babylon itself under `#ifdef UV2` (checked against the installed shader), so
 * our own declaration sits under `#ifndef UV2` and the name stays the same in
 * both cases.
 */
export function dungeonVertexDefinitionenGlsl(): string {
  return /* glsl */ `
#ifdef DUNGEON_TRIPLANAR
  varying vec2 vDgBlend;
  varying float vDgSchicht;
  #ifdef DUNGEON_SCHICHT_ATTRIBUT
    attribute float dgSchicht;
  #endif
  #ifdef DUNGEON_BLEND_ATTRIBUT
    #ifndef UV2
      attribute vec2 uv2;
    #endif
  #endif
#endif`;
}

/** Zuweisung am Ende von `main()` im Vertexshader. / Assignment at main()'s end. */
export function dungeonVertexHauptGlsl(): string {
  return /* glsl */ `
#ifdef DUNGEON_TRIPLANAR
  #ifdef DUNGEON_SCHICHT_ATTRIBUT
    vDgSchicht = dgSchicht;
  #else
    vDgSchicht = dgFest.x;
  #endif
  #ifdef DUNGEON_BLEND_ATTRIBUT
    vDgBlend = uv2;
  #else
    // No attribute -> "far from floor, far from any edge": moss, grime and
    // moisture are then off. Deliberately not a substitute value that would
    // fake an effect nobody measured.
    vDgBlend = vec2(999.0, 999.0);
  #endif
#endif`;
}

/**
 * Regex-Einspritzpunkt fuer die Occlusion. Babylon 8.56.2 hat fuer den
 * AO-Block KEINEN `CUSTOM_*`-Punkt; der Aufruf steht aber woertlich in
 * `pbr.fragment`. `[\\s\\S]*?` laeuft bis zur ERSTEN schliessenden Klammer,
 * also genau bis zum Ende des Aufrufs, und `$0` setzt den gefundenen Text
 * wieder ein (`materialPluginManager.js` ersetzt `$0..$n` durch die
 * Fundgruppen).
 * Regex injection point for the occlusion. Babylon 8.56.2 has NO `CUSTOM_*`
 * point for the AO block, but the call sits verbatim in `pbr.fragment`.
 */
export const RX_AO_AUFRUF = '!!aoOut=ambientOcclusionBlock\\([\\s\\S]*?\\);';

/** Was hinter den AO-Aufruf gehaengt wird. / What is appended after the AO call. */
export function dungeonAoGlsl(): string {
  return /* glsl */ `$0
#ifdef DUNGEON_TRIPLANAR
  aoOut.ambientOcclusionColor *= vec3(dgAo);
#endif`;
}

/**
 * Rauheit und Metallic. Der Punkt liegt IM Rumpf von `reflectivityBlock()`,
 * im `METALLICWORKFLOW`-Zweig — deshalb setzt die Fabrik unten `metallic` und
 * `roughness` am Material, damit dieser Zweig ueberhaupt uebersetzt wird.
 * Roughness and metallic. The point sits INSIDE `reflectivityBlock()`, in the
 * `METALLICWORKFLOW` branch — which is why the factory below sets `metallic`
 * and `roughness` on the material so that branch is compiled at all.
 */
export function dungeonReflectivityGlsl(): string {
  return /* glsl */ `
#ifdef DUNGEON_TRIPLANAR
  metallicRoughness.r = dgMetall;
  metallicRoughness.g = dgRauheit;
#endif`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Das Plugin / the plugin
// ─────────────────────────────────────────────────────────────────────────────

/** Merker fuer die Notbremse, damit sie eine Sitzung ueberdauert. */
const NOTBREMSE_KEY = 'wov-dungeon-triplanar-notbremse';

/** Alle angehaengten Plugins — die Notbremse muss sie alle abschalten. */
const angehaengt = new Set<DungeonMaterialPlugin>();

/** Global gesetzte Stufe; jedes Plugin liest sie beim Define-Aufbau. */
let stufeGlobal: DungeonGrafikStufe = DungeonGrafikStufe.Mittel;

/**
 * Ob Parallax ueberhaupt eingeschaltet werden darf. Standard AUS: Parallax ist
 * laut ARCHITECTURE W9 Meilenstein 2, der `#ifdef`-Zweig steht aber schon im
 * Quelltext der Stufe Hoch, damit er dort gemessen werden kann.
 * Whether parallax may be switched on at all. Default OFF: parallax is
 * milestone 2 per ARCHITECTURE W9, but the `#ifdef` branch is already in the
 * High tier source so it can be measured there.
 */
let parallaxErlaubt = false;

class DungeonMaterialPlugin extends MaterialPluginBase {
  /** false schaltet den Rechenblock per Define aus (Notbremse). */
  private an = true;

  thema: DungeonThema;
  arrays: DungeonMaterialArrays;

  constructor(material: Material, arrays: DungeonMaterialArrays, thema: DungeonThema) {
    // Prioritaet 10: weit vor StandardGammaFix (100), PbrNebelFix (110) und
    // NebelRichtung/FackelLicht (120). Der Grund ist inhaltlich, nicht
    // numerisch (render-tech §1.3): Wir ERSETZEN Albedo, Normale, Rauheit und
    // Occlusion, bevor `finalColor` ueberhaupt entsteht; jene vier korrigieren
    // das fertige Ergebnis. Der sechste Parameter (`enable`) MUSS true sein,
    // sonst landet das Plugin nur in der passiven Liste — dieselbe Falle, die
    // in `ClutterWindPlugin` ausfuehrlich steht.
    // ALLE Defines muessen hier stehen, nicht nur der Hauptschalter:
    // `collectDefines()` legt genau die Schluessel dieses Objekts in der
    // `MaterialDefines`-Instanz an. Ein in `prepareDefinesBeforeAttributes()`
    // gesetzter Name, der hier fehlt, taucht in der Define-Zeichenkette nie auf
    // — der `#ifdef` waere dann still immer falsch, ohne Fehlermeldung.
    // ALL defines must be listed here, not just the main switch:
    // `collectDefines()` creates exactly the keys of this object. A name set in
    // `prepareDefinesBeforeAttributes()` but missing here never reaches the
    // define string — the `#ifdef` would silently always be false.
    super(
      material,
      'DungeonTriplanar',
      10,
      {
        DUNGEON_TRIPLANAR: true,
        DUNGEON_STUFE: 1,
        DUNGEON_BLENDING: true,
        DUNGEON_CAVITY: false,
        DUNGEON_PARALLAX: false,
        DUNGEON_SCHICHT_ATTRIBUT: false,
        DUNGEON_BLEND_ATTRIBUT: false,
      },
      true,
      true
    );
    this.arrays = arrays;
    this.thema = thema;
    angehaengt.add(this);
  }

  override getClassName(): string {
    return 'DungeonMaterialPlugin';
  }

  /** Nur GLSL — Begruendung im Kopfkommentar. / GLSL only, see header. */
  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  /** Schaltet den Rechenblock; die Uniforms bleiben deklariert. */
  setzeAn(an: boolean): void {
    if (this.an === an) return;
    this.an = an;
    this.markAllDefinesAsDirty();
  }

  /**
   * Die Defines HIER, nicht in `prepareDefines()`: Babylon sammelt die
   * Attribute NACH `prepareDefinesBeforeAttributes` und VOR `prepareDefines`
   * ein. Wer `DUNGEON_SCHICHT_ATTRIBUT` erst spaeter setzt, deklariert das
   * Attribut im Shader, ohne dass Babylon es je bindet.
   * The defines HERE, not in `prepareDefines()`: Babylon collects the
   * attributes AFTER `prepareDefinesBeforeAttributes` and BEFORE
   * `prepareDefines`.
   */
  override prepareDefinesBeforeAttributes(
    defines: MaterialDefines,
    _scene: Scene,
    mesh: AbstractMesh
  ): void {
    const aktiv = this.an;
    defines.DUNGEON_TRIPLANAR = aktiv;
    defines.DUNGEON_STUFE = stufeGlobal;
    defines.DUNGEON_BLENDING = aktiv && stufeGlobal >= DungeonGrafikStufe.Mittel;
    defines.DUNGEON_CAVITY = aktiv && stufeGlobal >= DungeonGrafikStufe.Hoch;
    defines.DUNGEON_PARALLAX = aktiv && parallaxErlaubt && stufeGlobal >= DungeonGrafikStufe.Hoch;
    defines.DUNGEON_SCHICHT_ATTRIBUT =
      aktiv && mesh.isVerticesDataPresent(DUNGEON_SCHICHT_ATTRIBUT);
    defines.DUNGEON_BLEND_ATTRIBUT = aktiv && mesh.isVerticesDataPresent(DUNGEON_BLEND_ATTRIBUT);
  }

  override isReadyForSubMesh(): boolean {
    // Fehlt eine Textur noch, waere das Bild eine Sekunde lang schwarz statt
    // grau — deshalb wartet der Effekt, bis alle drei Arrays bereit sind.
    // If a texture is still missing the picture would be black for a second
    // instead of grey, so the effect waits for all three arrays.
    if (!this.an) return true;
    return (
      this.arrays.albedo.isReady() && this.arrays.normal.isReady() && this.arrays.orh.isReady()
    );
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (!this.an) return;
    if (mesh.isVerticesDataPresent(DUNGEON_SCHICHT_ATTRIBUT)) {
      attributes.push(DUNGEON_SCHICHT_ATTRIBUT);
    }
    // `uv2` kann Babylon bei gesetztem UV2-Define schon selbst gemeldet haben;
    // ein zweiter Eintrag waere ein doppeltes Attribut im Effekt.
    // Babylon may already have listed `uv2` when the UV2 define is set; a
    // second entry would be a duplicate attribute in the effect.
    if (
      mesh.isVerticesDataPresent(DUNGEON_BLEND_ATTRIBUT) &&
      !attributes.includes(DUNGEON_BLEND_ATTRIBUT)
    ) {
      attributes.push(DUNGEON_BLEND_ATTRIBUT);
    }
  }

  override getSamplers(samplers: string[]): void {
    // Immer anmelden — die Methode laeuft bereits waehrend super(), und ein
    // Sampler, der im Shader deklariert ist, MUSS gebunden werden.
    samplers.push(
      'dungeonAlbedoArray',
      'dungeonNormalArray',
      'dungeonOrhArray',
      'dungeonMoosAlbedo',
      'dungeonMoosNormal'
    );
  }

  /**
   * Alles in den BESTEHENDEN Material-UBO-Block, kein eigener Block — aus dem
   * in `FackelLicht.ts` dokumentierten Grund: WebGL2 garantiert nur
   * `MAX_FRAGMENT_UNIFORM_BLOCKS = 12`, und Szene, Material, Mesh und die
   * Lichtbloecke sind davon schon mehrere. Acht vec4 plus sechs vec4 Ebenen-
   * information sind gegen die 33 vec4 aus `FackelLicht` unkritisch — kritisch
   * waere allein ein zusaetzlicher BLOCK.
   * Everything into the EXISTING material UBO block, no block of our own.
   */
  override getUniforms(): {
    ubo: Array<{ name: string; size: number; type: string; arraySize?: number }>;
  } {
    return {
      ubo: [
        // x = Schaerfe, y = Kollapsschwelle, z = Seed low 16, w = Seed high 16
        { name: 'dgTriplanar', size: 4, type: 'vec4' },
        // x = feste Ebene ohne Attribut, y = Parallaxtiefe
        { name: 'dgFest', size: 4, type: 'vec4' },
        // x = Mooshoehe, y = Uebergang, z = Normalenschwelle, w = Staerke
        { name: 'dgMoos', size: 4, type: 'vec4' },
        // rgb = Moostoenung, w = 1/Kachelmeter des Moos-Overlays
        { name: 'dgMoosFarbe', size: 4, type: 'vec4' },
        // x = Reichweite, y = Staerke, z = Zielrauheit, w = Abdunklung
        { name: 'dgFeuchte', size: 4, type: 'vec4' },
        // x = Hoehe, y = Uebergang, z = Staerke, w = frei
        { name: 'dgSchmutz', size: 4, type: 'vec4' },
        { name: 'dgSchmutzFarbe', size: 4, type: 'vec4' },
        // x = Dichte je Meter, y = Schwelle, z = Tiefe, w = frei
        { name: 'dgRiss', size: 4, type: 'vec4' },
        // je Ebene: x = 1/Kachelmeter, y = Metallic (Konstante, kein Kanal, W5)
        { name: 'dgSchichtInfo', size: 4, type: 'vec4', arraySize: DUNGEON_SCHICHTEN_MAX },
      ],
    };
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    if (!this.an) return;
    const t = this.thema;
    const seed = t.materialSeed >>> 0;
    uniformBuffer.updateFloat4(
      'dgTriplanar',
      t.schaerfe,
      t.kollapsSchwelle,
      seed & 0xffff,
      seed >>> 16
    );
    uniformBuffer.updateFloat4('dgFest', 0, t.parallaxTiefe, 0, 0);
    uniformBuffer.updateFloat4(
      'dgMoos',
      t.moosHoehe,
      Math.max(t.moosUebergang, 1e-3),
      t.moosNormaleSchwelle,
      t.moosStaerke
    );
    uniformBuffer.updateFloat4(
      'dgMoosFarbe',
      t.moosFarbe.r,
      t.moosFarbe.g,
      t.moosFarbe.b,
      1 / Math.max(this.arrays.moosKachelM, 1e-3)
    );
    uniformBuffer.updateFloat4(
      'dgFeuchte',
      Math.max(t.feuchteReichweite, 1e-3),
      t.feuchteStaerke,
      t.feuchteRauheit,
      t.feuchteAbdunkeln
    );
    uniformBuffer.updateFloat4(
      'dgSchmutz',
      t.schmutzHoehe,
      Math.max(t.schmutzUebergang, 1e-3),
      t.schmutzStaerke,
      0
    );
    uniformBuffer.updateFloat4(
      'dgSchmutzFarbe',
      t.schmutzFarbe.r,
      t.schmutzFarbe.g,
      t.schmutzFarbe.b,
      0
    );
    uniformBuffer.updateFloat4('dgRiss', t.rissDichte, t.rissSchwelle, t.rissTiefe, 0);

    // Ebeneninformation: immer alle Plaetze schicken. Der `UniformBuffer`
    // vergleicht ohnehin elementweise und schreibt nur bei Aenderung; eine
    // kuerzere Teilsicht je Bild waere eine Allokation je Material und Bild.
    // Always send all slots; the buffer compares elementwise anyway.
    const info = new Float32Array(DUNGEON_SCHICHTEN_MAX * 4);
    for (let i = 0; i < DUNGEON_SCHICHTEN_MAX; i++) {
      const s = this.arrays.schichten[i];
      info[i * 4] = 1 / Math.max(s?.tileMetres ?? 4, 1e-3);
      info[i * 4 + 1] = s?.metallic ?? 0;
    }
    uniformBuffer.updateFloatArray('dgSchichtInfo', info);

    uniformBuffer.setTexture('dungeonAlbedoArray', this.arrays.albedo);
    uniformBuffer.setTexture('dungeonNormalArray', this.arrays.normal);
    uniformBuffer.setTexture('dungeonOrhArray', this.arrays.orh);
    uniformBuffer.setTexture('dungeonMoosAlbedo', this.arrays.moosAlbedo);
    uniformBuffer.setTexture('dungeonMoosNormal', this.arrays.moosNormal);
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage?: ShaderLanguage
  ): Record<string, string> | null {
    if (shaderLanguage !== undefined && shaderLanguage !== ShaderLanguage.GLSL) return null;
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: dungeonVertexDefinitionenGlsl(),
        CUSTOM_VERTEX_MAIN_END: dungeonVertexHauptGlsl(),
      };
    }
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: dungeonDefinitionenGlsl(stufeGlobal),
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: dungeonAufrufGlsl(),
      CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: dungeonReflectivityGlsl(),
      [RX_AO_AUFRUF]: dungeonAoGlsl(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Aufbau, Stufe, Notbremse / setup, tier, emergency brake
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `?triplanar=off` in der Adresszeile schaltet das Plugin ab.
 *
 * Damit geht eine A/B-Messung (mit und ohne Triplanar) ohne Codeaenderung und
 * ohne Neustart des Bauens — genau das, was `PostProcessing.setSSAO()` mit
 * „eine Messung unter den Voreinstellungen ist keine Messung fuer den, der sie
 * geaendert hat" meint.
 * `?triplanar=off` in the address bar switches the plugin off, so an A/B
 * measurement needs no code change and no rebuild.
 */
export function triplanarAbgeschaltet(): boolean {
  try {
    return new URLSearchParams(location.search).get('triplanar') === 'off';
  } catch {
    // Kein `location` (Test, Worker) — dann gilt der Schalter als nicht gesetzt.
    return false;
  }
}

/**
 * Setzt die Grafikstufe fuer ALLE Dungeon-Materialien.
 *
 * Muster wie `FackelLichtPlugin.setzeAn()`: Der Zustand wird gesetzt und
 * `markAllDefinesAsDirty()` gerufen, statt in `prepareDefines()` zu pollen.
 * Ohne den Aufruf merkt Babylon den Wechsel nie — der Schalter haette kein
 * Symptom ausser dem fehlenden Effekt.
 * Sets the graphics tier for ALL dungeon materials, following the
 * `FackelLichtPlugin.setzeAn()` pattern.
 */
export function setzeDungeonStufe(stufe: DungeonGrafikStufe): void {
  if (stufeGlobal === stufe) return;
  stufeGlobal = stufe;
  for (const p of angehaengt) p.markAllDefinesAsDirty();
}

/** Die aktuell gesetzte Stufe. / The currently set tier. */
export function dungeonStufe(): DungeonGrafikStufe {
  return stufeGlobal;
}

/**
 * Schaltet den Parallax-Zweig frei (Meilenstein 2 / AP16). Der `#ifdef` steht
 * schon im Quelltext der Stufe Hoch, damit er gemessen werden kann, bevor
 * darueber entschieden wird (R6).
 * Enables the parallax branch (milestone 2 / AP16).
 */
export function erlaubeDungeonParallax(an: boolean): void {
  if (parallaxErlaubt === an) return;
  parallaxErlaubt = an;
  for (const p of angehaengt) p.markAllDefinesAsDirty();
}

/**
 * Notbremse: Rechenblock aus, alle Dungeon-Materialien werden grau.
 *
 * Wird gemerkt, damit die naechste Sitzung nicht wieder in denselben
 * Uebersetzungsfehler laeuft — auf demselben Geraet geht der ja wieder schief,
 * und ein grauer, aber begehbarer Dungeon ist besser als ein unsichtbarer.
 * Emergency brake: block off, all dungeon materials turn grey. Remembered so
 * the next session does not run into the same compile error again.
 */
export function dungeonNotbremse(grund: string): void {
  console.error(`[dungeon2] Notbremse: ${grund}`);
  for (const p of angehaengt) p.setzeAn(false);
  try {
    localStorage.setItem(NOTBREMSE_KEY, '1');
  } catch {
    // Kein localStorage (privater Modus) — dann gilt sie nur fuer diese Sitzung.
  }
}

/** Hebt die gemerkte Notbremse auf (Diagnose ueber `__dbg`). */
export function dungeonNotbremseLoesen(): void {
  try {
    localStorage.removeItem(NOTBREMSE_KEY);
  } catch {
    // s. o.
  }
}

function leseNotbremse(): boolean {
  try {
    return localStorage.getItem(NOTBREMSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Baut das Material fuer einen Dungeon-Block und haengt das Plugin an.
 *
 * Was hier NICHT passiert: das Plugin global ueber
 * `scene.onNewMaterialAddedObservable` an jedes Material haengen. Die vier
 * bestehenden Plugins tun das, weil sie eine globale Eigenschaft korrigieren
 * (Nebelkurve, Gammafehler) oder einen globalen Dienst liefern (Fackellicht).
 * Dieses hier braucht material-spezifische Theme-Daten und gehoert deshalb
 * gezielt an die Materialien, die der Dungeon-Bauer erzeugt (render-tech §1.2).
 * What does NOT happen here: hooking the plugin to every material via
 * `scene.onNewMaterialAddedObservable`. This plugin needs material specific
 * theme data and therefore belongs only on the builder's materials.
 *
 * @returns das Material; das Plugin fehlt, wenn WebGL1, Killschalter oder
 *          Notbremse dagegen sprechen — dann ist es ein graues PBR-Material,
 *          genau der AP6-Zustand.
 */
export function erzeugeDungeonMaterial(
  scene: Scene,
  name: string,
  arrays: DungeonMaterialArrays | null,
  thema: DungeonThema = STEINGRAB_THEMA
): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  // `metallic`/`roughness` gesetzt heisst `METALLICWORKFLOW` — und nur in
  // diesem Zweig gibt es `CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS`. Ohne die
  // beiden Zeilen laege unser Rauheitsblock in einem Zweig, den der
  // Praeprozessor wegwirft, und niemand saehe einen Fehler — nur eine Wand,
  // die immer gleich matt ist.
  // Setting `metallic`/`roughness` means `METALLICWORKFLOW`, and only that
  // branch has `CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS`.
  mat.metallic = 0;
  mat.roughness = 1;
  mat.albedoColor = new Color3(0.62, 0.6, 0.56);
  // Innenraeume haben keine Umgebungsspiegelung von aussen; ohne diese Zeile
  // legt Babylons Standard-Environment einen Himmelsschimmer auf jede Wand.
  // Interiors have no outside reflection; without this line Babylon's default
  // environment lays a sky sheen over every wall.
  mat.environmentIntensity = 0.35;

  if (!arrays) return mat;
  const engine = scene.getEngine();
  // `webGLVersion` sitzt auf `ThinEngine`, nicht auf `AbstractEngine` — ein
  // WebGPU- oder Null-Engine hat die Eigenschaft gar nicht. Fehlt sie, gilt
  // die Fassung als hinreichend; die einzige Fassung, die `sampler2DArray`
  // NICHT kann, ist WebGL1, und die meldet sich hier ausdruecklich.
  // `webGLVersion` lives on `ThinEngine`, not on `AbstractEngine`.
  const webGl = (engine as { webGLVersion?: number }).webGLVersion ?? 2;
  if (!engine.isWebGPU && webGl < 2) {
    console.warn('[dungeon2] WebGL1 — kein sampler2DArray, Dungeon bleibt grau.');
    return mat;
  }
  if (triplanarAbgeschaltet()) {
    console.warn('[dungeon2] ?triplanar=off — Dungeon bleibt grau (A/B-Messung).');
    return mat;
  }
  if (leseNotbremse()) {
    console.warn(
      '[dungeon2] Notbremse aus einer frueheren Sitzung aktiv. Zum Aufheben: ' +
        `localStorage.removeItem("${NOTBREMSE_KEY}")`
    );
    return mat;
  }

  new DungeonMaterialPlugin(mat, arrays, thema);

  // Rueckfallebene: Babylons `Material.onError` ist ein EINZELNER Rueckruf,
  // kein Observable — ein evtl. vorhandener wird weitergereicht statt
  // ueberschrieben (wortgleich zu `FackelLicht.installiere...`).
  // Fallback: `Material.onError` is a SINGLE callback, not an observable — an
  // existing one is passed on instead of overwritten.
  const alt = mat.onError;
  mat.onError = (effect, fehler) => {
    if (/uniform|too many|exceed|compile|sampler/i.test(fehler)) {
      dungeonNotbremse(`Uebersetzungsfehler an ${mat.name}: ${fehler.slice(0, 200)}`);
    }
    alt?.(effect, fehler);
  };
  return mat;
}
