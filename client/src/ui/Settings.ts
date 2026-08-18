/**
 * SettingsStore — persisted, user-adjustable render settings.
 *
 * Mirrors two real Valheim graphics settings (Settings.SettingsGui/
 * GraphicsSettings.cs, GraphicsSettingInt enum — see extracted_assets in
 * /root/Valheim_Client for the decompiled source and localization strings
 * this project uses verbatim):
 *  - "Vegetationsqualität" (settings_vegetation, GraphicsSettingInt.Vegetation)
 *    → GrassClutter's clutter render/fade distance (GrassClutter.ts,
 *    VEGETATION_QUALITY_SCALE).
 *  - "Detailgrad" (settings_lod, "Draw distance / level of detail",
 *    GraphicsSettingInt.LOD) → TerrainManager's near/far ring radius
 *    (Terrain.ts, DETAIL_PRESETS).
 *
 * Both use the real game's 4 quality levels (Niedrig/Mittel/Hoch/Sehr
 * hoch — settings_low/medium/high/veryhigh), index 0..3.
 */
export interface GameSettings {
  vegetationQuality: number;
  /**
   * Sichtweite fuer Baeume und Buesche (Index in VEGETATION_RANGE).
   * Anders als `vegetationQuality` betrifft das nicht Gras, sondern die
   * Thin-Instance-Puffer der grossen Vegetation. Index 3 bedeutet wie
   * bisher: das gesamte geladene Streaming-Fenster zeichnen.
   */
  vegetationRange: number;
  detailQuality: number;
  /**
   * Renderauflösung in Prozent (Index in RENDER_SCALE).
   *
   * Der wirksamste Performance-Regler überhaupt: Die Kosten des
   * Fragment-Shaders — Gras, Terrain, Post-Processing — wachsen mit der
   * PIXELZAHL, also quadratisch. 75 % bedeutet 44 % weniger Pixel.
   * Das Original hat dafür "Target3DResolutionVertical" plus einen
   * Upscaling-Algorithmus (GraphicsSettingInt).
   */
  renderScale: number;
  /**
   * Grasdichte (Index in GRASS_DENSITY). Regelt die ANZAHL der Halme,
   * nicht deren Sichtweite — siehe GrassClutter.setDensity().
   */
  grassDensity: number;
  /**
   * Schattenqualität (Index in SHADOW_LEVELS: Aus/Niedrig/Mittel/Hoch).
   * Die drei oberen Stufen sind die Original-Werte aus
   * GraphicsSettingsManager.ApplyQualitySettings() — siehe Shadows.ts.
   */
  shadowQuality: number;
  /**
   * Wasserqualität (Index in WATER_QUALITY_RATIO): Auflösung des
   * Refraktionspasses, durch den man im Wasser den Grund sieht.
   *
   * Kein Original-Setting — im Spiel ist die Brechung fester Bestandteil
   * des Wassershaders. Bei uns ist sie ein zusätzlicher Szenendurchlauf
   * und braucht deshalb eine Notbremse. Auf "Aus" fällt das Wasser auf
   * Alpha-Blending zurück (WaterPlugin, ALPHA_SHALLOW/ALPHA_DEEP).
   */
  waterQuality: number;
  /**
   * Ferne Schatten (GraphicsSettingBool.DistantShadows, im Original an).
   * Aus: Kleinzeug wirft nicht mehr, und Werfer jenseits der halben
   * Kaskadendistanz fallen weg — siehe Shadows.darfWerfen().
   */
  distantShadows: boolean;
  /**
   * Gemessenes 100-FPS-Profil für die schwere Insel.
   *
   * Erzwingt zwei Schattenkaskaden, schaltet ferne Schatten und teure
   * zeitliche Postprozesse ab und zeichnet die Dick-Varianten der Bäume
   * über den jeweiligen normalen Master. Position, Höhe, Krone und
   * Kollision bleiben erhalten; nur die zusätzliche Stammstärke entfällt.
   */
  hundertFpsProfil: boolean;
  /** Post-Process-Schalter — dieselben, die das Original als Grafikoption
   *  anbietet (GraphicsSettingBool). Werte/Herkunft: engine/PostProcessing.ts. */
  bloom: boolean;
  motionBlur: boolean;
  chromaticAberration: boolean;
  antiAliasing: boolean;
  /**
   * Tiefenunschärfe (Fernunschärfe). Im Original eine echte Grafikoption
   * (GraphicsSettingBool.DepthOfField), dort standardmäßig AN.
   */
  depthOfField: boolean;
  /**
   * Sonnenstrahlen (GraphicsSettingBool.SunShafts). Im Original an, bei uns
   * aus — der Effekt kostet eine komplette zusätzliche Szenenpassage und
   * halbiert die Bildrate. Begründung siehe PostProcessing.setSunShafts().
   */
  sunShafts: boolean;
  /**
   * Umgebungsverdeckung (SSAO2). Im Original-Profil an, hier aus — die
   * Begründung samt Messwert steht in `PostProcessing.setSSAO()`.
   */
  ambientOcclusion: boolean;
  /**
   * Zeitliche Kantenglättung (TAA).
   *
   * Kein Original-Setting im engeren Sinn — das Original HAT TAA, bietet
   * es aber nicht als Schalter an. Bei uns muss es einer sein, weil TAA
   * ohne Bewegungsvektoren Schlieren zieht: Es tauscht Flimmern gegen
   * Ghosting, und welches von beidem mehr stört, entscheidet der Spieler.
   * Begründung und Messreihen in PostProcessing.setTemporalAA().
   */
  temporalAA: boolean;
  /**
   * Pointer-Lock benutzen (Cursor fangen, Standard). Aus: der Cursor bleibt
   * sichtbar und die Kamera dreht sich per Ziehen mit gedrückter Maustaste.
   *
   * Kein Original-Setting — es gibt hier, weil der Browser den Lock jederzeit
   * verweigern darf (z. B. direkt nach dem Freigeben mit Esc, was Firefox
   * strenger handhabt als Chromium) und dabei auch seinen eigenen Hinweis
   * einblendet. Ohne Lock entfällt beides.
   */
  pointerLock: boolean;
  /**
   * Namen der gespawnten Objekte über ihnen einblenden.
   *
   * Kein Original-Setting, sondern ein Diagnosewerkzeug: Wenn irgendwo
   * etwas Unerwartetes steht, ist die einzige Frage, die zählt, wie das
   * Prefab heisst — danach lässt es sich in prefabData.json nachschlagen.
   */
  showObjectNames: boolean;
  /**
   * Namensschilder über Figuren (Name, Stufe, Lebensbalken, Quest-Zeichen).
   *
   * Anders als `showObjectNames` kein Diagnosewerkzeug, sondern ein
   * Spielelement — deshalb an. Abschaltbar bleibt es trotzdem: Für
   * Bildschirmfotos und für die Beurteilung von Modellen im Testflug
   * stehen die Schilder im Weg.
   */
  nameplates: boolean;
  /**
   * Auch über dem EIGENEN Kopf ein Schild.
   *
   * Voreinstellung aus, obwohl die Verfolgerperspektive es hergäbe: Der
   * eigene Name steht genau dort, wo man beim Laufen hinsieht, und Leben
   * wie Ausdauer zeigt das HUD unten links ohnehin. Wer sich im Getümmel
   * lieber selbst markiert sieht (in WoW die persönliche Anzeige), schaltet
   * es hier ein.
   */
  eigenesNameplate: boolean;
}

const STORAGE_KEY = 'valheim-babylon-settings-v1';
/** Auswählbare Renderauflösungen (Faktor auf die Fensterbreite). */
export const RENDER_SCALE = [0.5, 0.75, 0.85, 1.0] as const;
/** Meter fuer Baeume/Buesche; 0 bedeutet das volle Streaming-Fenster. */
export const VEGETATION_RANGE = [160, 200, 240, 0] as const;

const DEFAULTS: GameSettings = {
  vegetationQuality: 2,
  vegetationRange: 3, // unbegrenzt — bestehende Darstellung unveraendert
  detailQuality: 2,
  renderScale: 3, // 100 %
  grassDensity: 3, // volle Dichte
  /**
   * "Mittel" (3 Kaskaden, 120 m, 1024 px) — eine Stufe unter dem Original
   * (`m_shadowQuality = 2` entspricht hier Index 3).
   *
   * Stand hier bis 2026-08-01 auf "Aus", mit dieser Messung vom 30.07.:
   *
   *   Aus      43 fps   Median 17,1 ms
   *   Niedrig  27 fps   Median 33,2 ms
   *   Mittel   26 fps   Median 33,2 ms
   *   Hoch     22 fps   Median 49,3 ms
   *
   * Der Zusatz "und sichtbar ist derzeit NICHTS davon, weil der Boden
   * keine Schatten empfangen kann" traf zu — die Ursache war aber nicht
   * ein fehlender LightBlock, sondern vier verkettete Fehler (drei in
   * Babylons Einzellicht-Zweig, einer im Zusammenspiel mit
   * `blockMaterialDirtyMechanism` — siehe SonnenSchattenBlock.ts und
   * Shadows.nodeMaterialsNeuUebersetzen()). Seit dem Fix empfangen BODEN
   * und Gras. Den Kosten steht damit ein Gegenwert
   * gegenüber: Ohne Schatten ist der warm/kalt-Kontrast aus dem EnvSetup
   * (warme Sonne, blaues Ambient) nirgends sichtbar, weil es keine
   * Fläche gibt, auf der die Sonne fehlt — der Hauptgrund für den
   * flachen Bildeindruck (Docs/07-Grafik-Konzept.md, Ursache B).
   *
   * "Mittel" statt "Hoch" als Voreinstellung, weil die vierte Kaskade
   * die Werferliste ein weiteres Mal komplett rendert und im Bild am
   * wenigsten beiträgt. Die Messung oben ist vor dem Fix entstanden und
   * nach dem Umbau (PCF an, Empfangen entkoppelt) neu zu erheben.
   */
  shadowQuality: 2,
  /**
   * "Mittel" = halbe Renderauflösung. Das Refraktionsbild wird von der
   * bewegten Wasseroberfläche ohnehin verzerrt, die halbe Auflösung ist
   * dort nicht auszumachen — sie kostet aber nur ein Viertel der Pixel.
   */
  waterQuality: 2,
  distantShadows: true,
  hundertFpsProfil: false,
  bloom: true,
  motionBlur: true,
  chromaticAberration: true,
  antiAliasing: true,
  depthOfField: true,
  sunShafts: false,
  ambientOcclusion: false,
  // Voreinstellung AUS — der Effekt tauscht ein Artefakt gegen ein
  // anderes, das gehört gesehen und nicht verordnet.
  temporalAA: false,
  pointerLock: true,
  showObjectNames: false,
  nameplates: true,
  eigenesNameplate: false,
};

/**
 * Liest den gespeicherten Stand und lässt ungültige/fehlende Felder WEG
 * (statt sie als `undefined` zu liefern): der Aufrufer merged via
 * `{...DEFAULTS, ...loadSaved()}`, und ein explizites `undefined` würde
 * dabei den Default überschreiben statt ihn stehen zu lassen.
 *
 * Dass hier jedes Feld einzeln aufgeführt ist, erledigt nebenbei das
 * ABSCHAFFEN von Einstellungen: Ein Schlüssel, der in dieser Liste fehlt,
 * fällt aus jedem gespeicherten Stand heraus — so geschehen mit
 * `hdClutter`. Ein pauschales `{...DEFAULTS, ...JSON.parse(raw)}` hätte das
 * nicht geleistet; dort schleppte jeder Browser, der die Seite früher
 * einmal geladen hat, den abgeschafften Wert unbegrenzt weiter.
 */
function loadSaved(): Partial<GameSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const out: Partial<GameSettings> = {};
    const q = { vegetationQuality: clamp(parsed.vegetationQuality), vegetationRange: clamp(parsed.vegetationRange), detailQuality: clamp(parsed.detailQuality), renderScale: clamp(parsed.renderScale), grassDensity: clamp(parsed.grassDensity), shadowQuality: clamp(parsed.shadowQuality), waterQuality: clamp(parsed.waterQuality) };
    if (q.vegetationQuality !== undefined) out.vegetationQuality = q.vegetationQuality;
    if (q.vegetationRange !== undefined) out.vegetationRange = q.vegetationRange;
    if (q.detailQuality !== undefined) out.detailQuality = q.detailQuality;
    if (q.renderScale !== undefined) out.renderScale = q.renderScale;
    if (q.grassDensity !== undefined) out.grassDensity = q.grassDensity;
    if (q.shadowQuality !== undefined) out.shadowQuality = q.shadowQuality;
    if (q.waterQuality !== undefined) out.waterQuality = q.waterQuality;
    const b = {
      bloom: bool(parsed.bloom),
      motionBlur: bool(parsed.motionBlur),
      chromaticAberration: bool(parsed.chromaticAberration),
      antiAliasing: bool(parsed.antiAliasing),
      depthOfField: bool(parsed.depthOfField),
      sunShafts: bool(parsed.sunShafts),
      ambientOcclusion: bool(parsed.ambientOcclusion),
      temporalAA: bool(parsed.temporalAA),
      distantShadows: bool(parsed.distantShadows),
      hundertFpsProfil: bool(parsed.hundertFpsProfil),
      pointerLock: bool(parsed.pointerLock),
      showObjectNames: bool(parsed.showObjectNames),
      nameplates: bool(parsed.nameplates),
      eigenesNameplate: bool(parsed.eigenesNameplate),
    };
    if (b.bloom !== undefined) out.bloom = b.bloom;
    if (b.motionBlur !== undefined) out.motionBlur = b.motionBlur;
    if (b.chromaticAberration !== undefined) out.chromaticAberration = b.chromaticAberration;
    if (b.antiAliasing !== undefined) out.antiAliasing = b.antiAliasing;
    if (b.depthOfField !== undefined) out.depthOfField = b.depthOfField;
    if (b.sunShafts !== undefined) out.sunShafts = b.sunShafts;
    if (b.ambientOcclusion !== undefined) out.ambientOcclusion = b.ambientOcclusion;
    if (b.temporalAA !== undefined) out.temporalAA = b.temporalAA;
    if (b.distantShadows !== undefined) out.distantShadows = b.distantShadows;
    if (b.hundertFpsProfil !== undefined) out.hundertFpsProfil = b.hundertFpsProfil;
    if (b.pointerLock !== undefined) out.pointerLock = b.pointerLock;
    if (b.showObjectNames !== undefined) out.showObjectNames = b.showObjectNames;
    if (b.nameplates !== undefined) out.nameplates = b.nameplates;
    if (b.eigenesNameplate !== undefined) out.eigenesNameplate = b.eigenesNameplate;
    return out;
  } catch {
    return {};
  }
}

function clamp(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(0, Math.min(3, Math.round(v)));
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export class SettingsStore {
  private state: GameSettings = { ...DEFAULTS, ...loadSaved() };
  private readonly listeners = new Set<(s: GameSettings) => void>();

  get(): Readonly<GameSettings> {
    return this.state;
  }

  set(partial: Partial<GameSettings>): void {
    this.state = { ...this.state, ...partial };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // localStorage unavailable (private mode/quota) — settings stay session-only
    }
    for (const fn of this.listeners) fn(this.state);
  }

  /** Fires immediately with the current state, then on every change. */
  onChange(fn: (s: GameSettings) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
}
