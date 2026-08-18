/**
 * BaumImpostor — das Sprite-Fernfeld der Vegetation.
 *
 * Ferne Bäume werden nicht KLEINER gezeichnet, sondern durch zwei Dreiecke
 * ersetzt: ein kamerazugewandtes Rechteck, das eine vorab gebackene
 * Rundumansicht des Modells trägt. Ein Zeichenaufruf je 384-m-Zelle für
 * ALLE Archetypen darin.
 *
 * ── Der Anlass ───────────────────────────────────────────────────────
 * Messung Insel 10077/-18723, headed, Tageszeit 0,42 gepinnt, 29.556
 * Instanzen:
 *
 *   Voll-Master (heute)   16,3 ms CPU   17,1 ms GPU @ 2564 MHz    546 Calls
 *   Zellschnitt 384 m     17,2 ms CPU   13,5 ms GPU @ 2519 MHz   1128 Calls
 *   Zellschnitt 128 m     26,6 ms CPU   20,3 ms GPU @ 1255 MHz   ...
 *
 * Der Zellschnitt allein tauscht GPU-Arbeit gegen Zeichenaufrufe; die
 * Kurven schneiden sich nicht (Sweep-Kommentar an ZELL_SCHNITT_AB in
 * EntityManager.ts). Der Sprite-Ersatz senkt BEIDE: Die GPU zeichnet
 * statt hunderter alphagetesteter Laubdreiecke zwei opake, und die CPU
 * spart die Zell-Master der fernen Zellen samt ihrer Einreichung in Bild-
 * und Schattenpass.
 *
 * ── Vorbild ──────────────────────────────────────────────────────────
 * ClaudeCrafts produktives System (Three.js): foliage_impostor.ts,
 * foliage_impostor_core.ts, foliage_collapse.ts. Übernommen sind die
 * GESETZE (Ansichtspaar-Blend, geneigte Zylindernormale, Clearfarbe
 * Kronengrün, Sprites nie in die Werferliste). NICHT übernommen ist der
 * Code — andere Engine, andere Fallstricke. Die bewussten Abweichungen
 * stehen jeweils an ihrer Stelle; die drei grössten:
 *
 *   1. Festes Atlasraster statt Regalpacker (WoV streamt Prefabs nach).
 *   2. Zuteilung echt/Sprite auf der CPU in EINER Schleife statt über
 *      zwei Shader mit identischer GLSL-Zeile (s. BaumImpostorKern.
 *      teileZelle — die Referenz dokumentiert selbst, dass ihre Variante
 *      an Treiber-Kontraktion brechen kann).
 *   3. Der Atlas trägt REINES ALBEDO, nicht eine eingebackene
 *      Hemisphärenbeleuchtung (s. backMaterial()).
 */
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { PrefabMaster } from './AssetManager';
import { WindPlugin } from './WindPlugin';
import { huellkoerperAufweiten, zellMeshAusPrototyp } from '../entities/EntityManager';
import {
  ATLAS_KANTE_PX,
  IMPOSTOR_ALPHA_SCHNITT,
  IMPOSTOR_ANSICHTEN,
  IMPOSTOR_EMISSIONS_SOCKEL,
  IMPOSTOR_FAECHER,
  IMPOSTOR_GRENZE_M_VORGABE,
  IMPOSTOR_MIN_HOEHE_M,
  IMPOSTOR_NEIGUNG,
  SPRITE_STRIDE,
  atlasRaster,
  ansichtRechteck,
  karteMasse,
  zeilenUv,
} from './BaumImpostorKern';

/**
 * Namenspräfix JEDES Meshes, das dieses Modul erzeugt — Sprite-Zellen wie
 * Backmeshes.
 *
 * Das ist keine Kosmetik, sondern die EINZIGE Absicherung gegen Leitplanke
 * 3: Shadows.ts nimmt über `scene.onNewMeshAddedObservable` jedes neue
 * Mesh in die Werferliste auf und schliesst nur über den auf `^`
 * verankerten Regex NIE_WERFEN aus. `receiveShadows = false` und
 * `castShadow`-Flags helfen dort NICHT. Der Präfix muss in Shadows.ts
 * eingetragen sein, BEVOR das erste solche Mesh entsteht.
 *
 * Warum ein Sprite niemals werfen darf: Ein Billboard ist aus
 * Sonnenrichtung eine papierdünne Fläche. Je nach Sonnenstand wäre sein
 * Schatten entweder verschwunden oder ein Streifen quer über die
 * Landschaft. Nötig ist es ohnehin nicht — die Kaskaden reichen 150 m,
 * die Uebergabegrenze liegt bei 240 m (s. IMPOSTOR_GRENZE_M_VORGABE).
 */
export const IMPOSTOR_PRAEFIX = 'impostor';

/**
 * Clearfarbe des Atlas: mittleres Kronengrün bei Alpha 0.
 *
 * Aus der Referenz übernommen (0x86a868) samt Begründung: Die Mipkette
 * mittelt Randtexel gegen die Clearfarbe. Bei Schwarz kippen ferne
 * Sprites — deren tiefe Mips FAST NUR solche Mittelwerte sind — nach
 * dunklen Silhouetten. Alpha 0, damit der Alphaschnitt den Hintergrund
 * weiterhin sauber wegschneidet.
 *
 * Die Werte sind LINEAR angesetzt (0x86a868 sRGB ≈ 0.24/0.39/0.15
 * linear): Der Atlas ist ein Ziel unserer linearen Pipeline und wird als
 * sRGB-Puffer geschrieben.
 */
const KRONEN_GRUEN = new Color4(0.24, 0.39, 0.15, 0);

/**
 * Prefabs, deren Sprites NICHT im Wind schwingen dürfen.
 *
 * Harte Null, keine kleine Amplitude: Ein Findling oder eine Steinbank,
 * die in der Buschböe mitschwingt, liest sich aus jeder Entfernung
 * kaputt (Regel aus der Referenz, IMPOSTOR_CATEGORY_WIND rock 0).
 */
const STARR = /(rock|stein|fels|findling|silvervein|minerock|boulder)/i;

/** Eine gebackene Atlaszeile — ein Archetyp. */
interface AtlasZeile {
  /** Index im festen Raster. */
  index: number;
  /** UV der Ansicht 0. */
  u0: number;
  v0: number;
  /** Kartenmasse des MODELLS in Metern (vor der Instanzskalierung). */
  breite: number;
  hoehe: number;
  /** 1 = schwingt mit dem Wind, 0 = starr. */
  wind: number;
}

/**
 * Reserve auf den Hüllkörper einer Sprite-Zelle, über die grösste Karte
 * der Zelle hinaus (m).
 *
 * Die Rohgeometrie ist ein 1x1-Quad und die Instanzmatrizen sind reine
 * Translationen — Babylon spannt daraus eine Hülle, die die im Shader
 * aufgezogene Karte um ein Vielfaches unterschreitet. Ohne Aufweitung
 * verschwinden ganze Sprite-Zellen aus schrägen Blickwinkeln; das ist
 * derselbe Fehlermodus, den `master-huelle.ts` für die echten Zell-Master
 * bewacht (fehlende Darstellung ohne jede Fehlermeldung). Der Zuschlag
 * deckt zusätzlich den Windausschlag.
 */
const SPRITE_RESERVE_M = 2.5;

/** Obergrenze des Wiederverwendungs-Pools für Sprite-Zellmeshes. */
const SPRITE_POOL_DECKEL = 12;

// ── Material-Plugin ─────────────────────────────────────────────────

/** 2*PI als GLSL-Literal — einmal, damit die Rundung überall gleich ist. */
const ZWEI_PI = '6.283185307179586';

/**
 * Der Shader des Sprite-Feldes.
 *
 * Sitzt auf einem StandardMaterial, damit StandardGammaFix (lineare
 * Pipeline), NebelRichtung (gerichteter Nebel), Lighting.bindeLinearenNebel
 * und FackelLicht ohne eine Zeile Zusatzcode greifen — alle vier hängen
 * sich über `scene.onNewMaterialAddedObservable` an jedes Standard-
 * Material. Das ist Leitplanke 5: Der Nebel ist Teil der Bildsprache, und
 * ein eigenes ShaderMaterial müsste vFogColor/vFogColorSonne/
 * vZurSonneSicht und die EXP2-Kurve von Hand nachbauen und wäre bei jeder
 * künftigen Änderung an Lighting.ts still falsch.
 *
 * ── Warum das Material BELEUCHTET ist und nicht "unlit" ──────────────
 * Der Auftrag nannte "unlit, damit Nebel/GammaFix/FackelLicht gratis
 * erben". Das ZIEL stimmt, die Begründung trägt aber nicht: Geerbt wird,
 * weil es ein StandardMaterial IST, nicht weil es unbeleuchtet ist. Und
 * unbeleuchtet hätte einen Preis, der den ganzen Umbau sichtbar macht —
 * ein unbeleuchtetes Sprite steht um Mitternacht in Mittagshelligkeit,
 * während der echte Baum 240 m davor dunkel ist. Deshalb: Atlas trägt
 * reines Albedo, die Beleuchtung passiert hier, EINMAL, mit derselben
 * Sonne und derselben Umgebung wie beim echten Baum.
 *
 * Drei Eingriffe halten die Helligkeitsparität:
 *  (a) Spekular ist NULL (specularColor schwarz). Er ist der einzige
 *      Term, der nicht mit dem Atlas-Texel multipliziert wird, und läge
 *      auf einer flachen Karte mit glatter synthetischer Normale als
 *      gleichmässige Farbfläche über der Textur (die Referenz misst
 *      Faktor 2,2 zu hell mit, 1,6 ohne).
 *  (b) Die Schattierungsnormale ist eine geneigte, gefächerte
 *      ZYLINDER-Normale statt einer Hoch-Normalen (s.
 *      CUSTOM_VERTEX_UPDATE_NORMAL).
 *  (c) Ein Emissionssockel, mit dem Atlas-Texel multipliziert, damit das
 *      Sprite nachts keine schwarze Silhouette ist.
 */
class BaumImpostorPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priorität 220: nach WindPlugin (200) und ClutterWind (210), damit
    // die Reihenfolge im Code der Reihenfolge in der Pipeline entspricht.
    // Der 6. Ctor-Parameter (`enable`) ist PFLICHT — ohne ihn landet das
    // Plugin nur in der PASSIVEN Liste, getCustomCode() wird nie
    // ausgewertet und nichts passiert (in WindPlugin.ts und
    // ClutterWindPlugin.ts ausführlich dokumentiert; dort einmal teuer
    // gelernt).
    super(material, 'BaumImpostor', 220, { BAUMIMPOSTOR: true }, true, true);
  }

  get isEnabled(): boolean {
    return true;
  }

  isReadyForSubMesh(
    _defines: MaterialDefines,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): boolean {
    return true;
  }

  prepareDefines(): void {
    // immer an für das eine Material, das es dekoriert
  }

  getClassName(): string {
    return 'BaumImpostorPlugin';
  }

  /**
   * Die Pro-Instanz-Attribute anmelden.
   *
   * `Mesh.thinInstanceSetBuffer(kind, …)` legt für jedes fremde `kind`
   * einen instanzierten Vertexpuffer an; damit der Effekt ihn auch
   * abholt, muss der Name hier stehen UND im Shader deklariert sein
   * (CUSTOM_VERTEX_DEFINITIONS). Vorbild: WaterPlugin.getAttributes().
   */
  getAttributes(attributes: string[]): void {
    attributes.push('aImpUv', 'aImpKarte');
  }

  getSamplers(samplers: string[]): void {
    // Immer anmelden — die Methode läuft bereits während super(), und ein
    // Sampler, der im Shader deklariert ist, MUSS gebunden werden.
    samplers.push('impAtlas');
  }

  getUniforms(): { ubo: Array<{ name: string; size: number; type: string }> } {
    // NUR was sich zur Laufzeit ändert. Atlasraster, Neigung, Fächer,
    // Alphaschnitt und Emissionssockel sind Konstanten aus
    // BaumImpostorKern und stehen unten als GLSL-Literale im Code — das
    // spart nicht nur Uniforms (FackelLicht.ts:111 hält fest, dass wir
    // an MAX_FRAGMENT_UNIFORM_VECTORS kratzen), sondern lässt den
    // Übersetzer auch konstant falten.
    return {
      ubo: [
        // xy = Windrichtung, z = 0..1 Stärke, w = Zeit in Sekunden.
        { name: 'impWindA', size: 4, type: 'vec4' },
        { name: 'impWindB', size: 4, type: 'vec4' },
        // x = Blend zwischen beiden Vektoren, y = Amplitude je Meter Höhe.
        { name: 'impWindC', size: 4, type: 'vec4' },
      ],
    };
  }

  /** Die Atlas-Textur — von aussen gesetzt, sobald sie steht. */
  atlas: BaseTexture | null = null;

  bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    // Wind aus DENSELBEN Statics wie die echten Bäume (WindPlugin). Nur
    // so friert das Schwanken beim Übergang echt→Sprite nicht ein — ein
    // Wald, in dem die hintere Hälfte stillsteht, macht die
    // Uebergabegrenze sichtbar, und das ist genau der Fehler, den
    // Leitplanke 4 meint.
    uniformBuffer.updateFloat4(
      'impWindA',
      WindPlugin.dirX,
      WindPlugin.dirZ,
      WindPlugin.intensity,
      WindPlugin.time
    );
    uniformBuffer.updateFloat4(
      'impWindB',
      WindPlugin.dir2X,
      WindPlugin.dir2Z,
      WindPlugin.intensity2,
      WindPlugin.time
    );
    uniformBuffer.updateFloat4('impWindC', WindPlugin.alpha, WindPlugin.strength, 0, 0);
    if (this.atlas) uniformBuffer.setTexture('impAtlas', this.atlas);
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    const uv = zeilenUv(0);
    const A = IMPOSTOR_ANSICHTEN.toFixed(1);

    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: /* glsl */ `
          attribute vec2 aImpUv;    // u0, v0 der Ansicht 0 dieser Zeile
          attribute vec4 aImpKarte; // Breite(m), Hoehe(m), Gierwinkel(rad), Windanteil

          varying vec2 vImpUvA;
          varying vec2 vImpUvB;
          varying float vImpMisch;

          /**
           * Billboard-Basis, im Positionsschritt gesetzt und im
           * Normalenschritt weiterbenutzt. Babylon stellt beide
           * Injektionspunkte unmittelbar hintereinander in main()
           * (default.vertex.js: CUSTOM_VERTEX_UPDATE_POSITION direkt
           * gefolgt von CUSTOM_VERTEX_UPDATE_NORMAL) — deshalb reicht
           * eine globale Variable und es braucht kein zweites Rechnen.
           */
          vec3 gImpFwd;
          vec3 gImpRight;

          /**
           * Weltposition des Instanzursprungs.
           *
           * finalWorld gibt es hier noch nicht: Babylon setzt
           * CUSTOM_VERTEX_UPDATE_POSITION VOR <instancesVertex>, wo die
           * Matrix erst zusammengesetzt wird. Wortgleich zu
           * WindPlugin.vbObjektUrsprung() — dieselbe Falle, dieselbe
           * Lösung.
           */
          vec3 impUrsprung() {
          #ifdef INSTANCES
            #ifdef THIN_INSTANCES
              return (world * world3).xyz;
            #else
              return world3.xyz;
            #endif
          #else
            return world[3].xyz;
          #endif
          }

          /**
           * Dieselbe wandernde Böe wie WindPlugin.windOffset() — gleiche
           * Phasenkonstanten (0.35/0.31 je Meter), gleiche Frequenzen
           * (1.1 stetig, 2.6 quer), gleiche Gewichte. Nur die
           * Ansatzdämpfung fehlt: Eine Sprite-Karte hat keinen Ast, der
           * am Stamm sitzt.
           */
          vec2 impBoe(vec3 ursprung, vec2 dir, float gust, float t, float amp) {
            float phase = ursprung.x * 0.35 + ursprung.z * 0.31;
            float lean = (0.6 + 0.4 * sin(t * 1.1 + phase)) * gust;
            vec2 o = dir * (lean * amp);
            vec2 side = vec2(-dir.y, dir.x);
            o += side * (sin(t * 2.6 + phase * 1.4) * 0.45 * gust * amp);
            return o;
          }
        `,
        CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `
        {
          vec3 impPos = impUrsprung();

          // ── Billboard-Basis ────────────────────────────────────────
          // Die Instanzmatrix trägt AUSSCHLIESSLICH die Translation
          // (Grösse und Gierwinkel liegen in aImpKarte), und das Mesh
          // selbst steht im Ursprung. Damit IST der lokale Raum der
          // Weltraum, und die ganze Rückrechnung der Referenz
          // (un-rotieren, durch die Skala teilen, Normalen mit der Skala
          // multiplizieren) entfällt ersatzlos. Das ist die billigste
          // und zugleich fehlerärmste Bauform.
          vec3 impZurKam = vEyePosition.xyz - impPos;
          float impL = length(impZurKam.xz);
          gImpFwd = impL > 1e-4 ? vec3(impZurKam.x / impL, 0.0, impZurKam.z / impL)
                                : vec3(0.0, 0.0, 1.0);
          // cross(hoch, fwd) für hoch = (0,1,0) — schon normiert.
          gImpRight = vec3(gImpFwd.z, 0.0, -gImpFwd.x);

          // ── Ansichtswahl ───────────────────────────────────────────
          // Backkonvention: Ansicht k zeigt das um +k/N Umdrehungen
          // gedrehte Modell, aufgenommen von +Z. Für eine Instanz mit
          // Gierwinkel phi, die aus Weltrichtung f betrachtet wird, ist
          // die passende Ansicht bei phi - atan2(f.x, f.z) — hergeleitet
          // aus Babylons linkshändiger Y-Drehung, Kontrolle in
          // BaumImpostorKern (Kopfkommentar) und im Backer.
          //
          // ⚠ Ein Vorzeichendreher hier SPIEGELT DEN GANZEN ANSICHTSRING.
          // Der Wald sieht dabei völlig richtig aus; nur wer einen
          // EINZELNEN Baum an der Uebergabegrenze umrundet, sieht die
          // falsche Seite. Die Referenz warnt an genau dieser Stelle
          // namentlich davor.
          float impWinkel = aImpKarte.z - atan(gImpFwd.x, gImpFwd.z);
          float impRel = fract(impWinkel / ${ZWEI_PI});
          float impVp = impRel * ${A};
          float impV0 = floor(impVp);
          vImpMisch = impVp - impV0;
          float impV1 = mod(impV0 + 1.0, ${A});

          // Die Quad-UV kommt aus der POSITION, nicht aus dem
          // uv-Attribut: Ohne diffuseTexture setzt Babylon UV1 gar nicht
          // erst, und das Attribut uv waere im Shader nicht deklariert.
          vec2 impLokalUv = vec2((position.x + 0.5) * ${uv.ub.toFixed(9)},
                                  position.y * ${uv.vh.toFixed(9)});
          vImpUvA = aImpUv + vec2(impV0 * ${uv.schrittU.toFixed(9)}, 0.0) + impLokalUv;
          vImpUvB = aImpUv + vec2(impV1 * ${uv.schrittU.toFixed(9)}, 0.0) + impLokalUv;

          // ── Karte aufspannen ───────────────────────────────────────
          vec3 impOff = gImpRight * (position.x * aImpKarte.x);
          impOff.y += position.y * aImpKarte.y;

          // ── Wind, in Parität zu den echten Kronen ──────────────────
          float impAmp = impWindC.y * aImpKarte.w * (position.y * aImpKarte.y);
          vec2 impW = mix(
            impBoe(impPos, impWindA.xy, impWindA.z, impWindA.w, impAmp),
            impBoe(impPos, impWindB.xy, impWindB.z, impWindB.w, impAmp),
            impWindC.x
          );
          impOff.xz += impW;

          positionUpdated = impOff;
        }
        `,
        CUSTOM_VERTEX_UPDATE_NORMAL: /* glsl */ `
        #ifdef NORMAL
        {
          // ── Warum nicht einfach (0,1,0) ────────────────────────────
          // Eine Hoch-Normale nimmt die Lichtantwort der BODENEBENE. Die
          // Sonne dieses Projekts steht nie hoch; bei tiefem Stand ist
          // dot(hoch, sonne) nahe null und JEDES Sprite flacht im selben
          // Bild zu einer gleichmässig ambient beleuchteten Fläche ab,
          // während der echte Baum daneben noch eine warme Licht- und
          // eine dunkle Rückseite zeigt. Genau daran liest man die
          // Uebergabegrenze als Ring im Wald ab.
          //
          // Stattdessen: Die Normale um NEIGUNG von der Senkrechten zur
          // Kamera kippen UND über die Kartenbreite fächern. Die Karte
          // schattiert dann wie ein stehender ZYLINDER und trägt selbst
          // eine Licht- und eine Schattenseite.
          //
          // Die Instanzmatrix ist eine reine Translation, ihre
          // Normalenmatrix also die Einheit — es braucht weder
          // Un-Rotation noch die Skalen-Multiplikation der Referenz.
          float impFan = position.x * ${(2 * IMPOSTOR_FAECHER).toFixed(6)};
          vec3 impSeit = gImpFwd * cos(impFan) + gImpRight * sin(impFan);
          normalUpdated = normalize(mix(vec3(0.0, 1.0, 0.0), impSeit, ${IMPOSTOR_NEIGUNG.toFixed(
            4
          )}));
        }
        #endif
        `,
      };
    }

    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
          varying vec2 vImpUvA;
          varying vec2 vImpUvB;
          varying float vImpMisch;
          uniform sampler2D impAtlas;
          /** Das gemischte Atlas-Texel — im Diffusschritt gesetzt, vor dem
           *  Nebel für den Emissionssockel wiederverwendet. */
          vec3 gImpTexel;
        `,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: /* glsl */ `
        {
          // Beide Ansichten des Paares abtasten und mischen. Ohne den
          // Blend schnappt das Bild beim Umkreisen alle 45 Grad um.
          vec4 impA = texture2D(impAtlas, vImpUvA);
          vec4 impB = texture2D(impAtlas, vImpUvB);
          vec4 impT = mix(impA, impB, vImpMisch);
          // Der Alphaschnitt passiert HIER und nicht über Babylons
          // ALPHATEST: Ohne diffuseTexture gibt es keinen eingebauten
          // Test, und das Material bleibt damit OPAK einsortiert —
          // Tiefenschreiben an, keine Sortierkosten, keine Nebelnähte.
          if (impT.a < ${IMPOSTOR_ALPHA_SCHNITT.toFixed(4)}) discard;
          gImpTexel = impT.rgb;
          baseColor.rgb = impT.rgb;
        }
        `,
        CUSTOM_FRAGMENT_BEFORE_FOG: /* glsl */ `
          // Emissionssockel der Krone, MIT dem Texel multipliziert: Es
          // leuchtet nur, wo auch Laub ist. Ohne ihn steht das Sprite
          // nachts als schwarze Silhouette, während der echte Baum
          // diesseits der Grenze noch Umgebungslicht trägt.
          // Vor dem Nebel, nicht danach — sonst leuchtete es durch die
          // Nebelwand hindurch.
          color.rgb += gImpTexel * ${IMPOSTOR_EMISSIONS_SOCKEL.toFixed(4)};
        `,
      };
    }
    return null;
  }
}

// ── Das Feld ────────────────────────────────────────────────────────

/** Diagnosezahlen — landen über zellStats() in `window.__vb.perf`. */
export interface ImpostorStats {
  /** Gebackene Archetypen. */
  zeilen: number;
  /** Wie viele der Atlas insgesamt fasst. */
  budget: number;
  /** Kantenlänge des Atlas in Bildpunkten. */
  atlasPx: number;
  /** Archetypen, die keinen Atlas bekommen haben (zu klein / Budget voll). */
  abgelehnt: number;
  /** Sprite-Zellmeshes = Zeichenaufrufe des Fernfeldes. */
  zellen: number;
  /** Sprite-Instanzen gesamt. */
  instanzen: number;
}

export class BaumImpostor {
  /**
   * Uebergabegrenze in Metern — s. IMPOSTOR_GRENZE_M_VORGABE.
   * Static, damit der geplante Sweep 150/180/240 zur Laufzeit über
   * `window.__dbg` gefahren werden kann, ohne neu zu bauen.
   */
  static grenze = IMPOSTOR_GRENZE_M_VORGABE;

  private readonly atlas: RenderTargetTexture;
  private readonly material: StandardMaterial;
  private readonly plugin: BaumImpostorPlugin;
  private readonly backKamera: FreeCamera;
  /** Prefabname → gebackene Zeile. */
  private readonly zeilen = new Map<string, AtlasZeile>();
  /** Prefabs, die keine Zeile bekommen (zu klein, Budget voll, Backfehler). */
  private readonly abgelehnt = new Set<string>();
  private naechsteZeile = 0;
  /** Backmaterialien je Quellmaterial — ein Kompilat statt eines je Prefab. */
  private readonly backMaterialien = new Map<Material, StandardMaterial>();

  /** prefabName → Zellenschlüssel → Instanzdaten (Stride SPRITE_STRIDE). */
  private readonly beitraege = new Map<string, Map<number, Float32Array>>();
  private readonly schmutzig = new Set<number>();
  private readonly zellMeshes = new Map<number, Mesh>();
  private readonly pool: Mesh[] = [];
  /** Rohgeometrie des Einheitsquads — EIN Satz Typed Arrays, je Mesh
   *  eine EIGENE Geometry (s. quadMesh()). */
  private readonly quadDaten: VertexData;

  /** Meldeweg an Shadows, analog EntityManager.onMasterEntsorgt. */
  onMeshEntsorgt: ((mesh: Mesh) => void) | null = null;

  constructor(private readonly scene: Scene) {
    this.atlas = new RenderTargetTexture(
      `${IMPOSTOR_PRAEFIX}Atlas`,
      { width: ATLAS_KANTE_PX, height: ATLAS_KANTE_PX },
      scene,
      {
        // Mipmaps bleiben WÄHREND des Backens aus und werden nach jeder
        // fertigen Zeile EINMAL erzeugt (s. mipsErneuern). Babylon baut
        // die 2048er-Kette sonst bei JEDEM unBindFramebuffer neu — bei
        // 8 Ansichten je Archetyp wären das acht Vollketten pro Baum.
        generateMipMaps: false,
        generateDepthBuffer: true,
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
        // ── Farbraum ──────────────────────────────────────────────
        // Der Atlas ist ein Ziel UNSERER LINEAREN Pipeline und wird
        // danach als Textur wieder gelesen. Ohne sRGB-Puffer stünden
        // lineare Werte in 8 Bit (Bandenbildung in den dunklen
        // Kronenpartien), und beim Abtasten fehlte die Dekodierung —
        // StandardMaterial dekodiert Texturen nicht im Shader. Genau
        // deshalb lädt GrassClutter seine Halmtexturen mit
        // useSRGBBuffer: true. Der Alphakanal ist von sRGB nicht
        // betroffen, die Alphaschwelle verschiebt sich also nicht.
        useSRGBBuffer: true,
        // KEIN MSAA: Ein 2048er-Resolve je Zellrender kostet Ladezeit,
        // und die Kanten sind bei 60-70 Bildpunkten Anzeigegrösse gegen
        // eine 80x128-Zelle ohnehin überabgetastet. Nachrüstbar, wenn
        // die Silhouetten im Bild stören.
      }
    );
    this.atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.atlas.anisotropicFilteringLevel = 4;
    // NICHT in scene.customRenderTargets: Der Atlas wird von Hand
    // gerendert, einmal je Archetyp, nie pro Bild.
    this.atlas.renderList = [];

    this.backKamera = new FreeCamera(
      `${IMPOSTOR_PRAEFIX}BackKamera`,
      new Vector3(0, 0, 1),
      scene,
      false
    );
    this.backKamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.atlas.activeCamera = this.backKamera;

    // Den Atlas EINMAL komplett mit Kronengrün bei Alpha 0 füllen —
    // auch die Zwickel zwischen den Zeilen, damit die Mipkette überall
    // gegen dieselbe Farbe mittelt. Danach nie wieder löschen: Jeder
    // Zellrender würde sonst den ganzen Atlas leeren, weil glClear den
    // Viewport ignoriert.
    this.atlas.clearColor = KRONEN_GRUEN;
    this.atlas.skipInitialClear = false;
    this.backKamera.viewport = new Viewport(0, 0, 1, 1);
    this.atlas.render();
    this.atlas.skipInitialClear = true;

    this.material = new StandardMaterial(`${IMPOSTOR_PRAEFIX}Material`, scene);
    // KEINE diffuseTexture: Der Atlas wird über den eigenen Sampler
    // `impAtlas` mit den im Vertex gerechneten UVs gelesen. Babylons
    // Diffus-Pfad käme nur an vDiffuseUV heran, und das ist die falsche
    // Koordinate. Nebeneffekt und erwünscht: Ohne Alphatextur bleibt das
    // Material OPAK einsortiert (kein Sortieren, Tiefenschreiben an).
    this.material.diffuseColor = Color3.White();
    this.material.specularColor = Color3.Black();
    this.material.ambientColor = Color3.Black();
    this.material.emissiveColor = Color3.Black();
    this.material.backFaceCulling = false;
    // twoSidedLighting BEWUSST AUS. Es liesse Babylon die Normale auf
    // Rueckseiten per gl_FrontFacing umdrehen — bei einer echten
    // doppelseitigen Blattkarte richtig, bei unserer SYNTHETISCHEN
    // Zylindernormalen falsch: Licht- und Schattenseite kippten. Die
    // Referenz macht diesen Flip aus demselben Grund von Hand wieder
    // rueckgaengig (`normal *= faceDirection`). Ein Sprite dreht sich der
    // Kamera ohnehin zu; Rueckseiten entstehen praktisch nicht, und wenn,
    // dann ist die ungeflippte Normale die richtige.
    this.material.twoSidedLighting = false;
    this.plugin = new BaumImpostorPlugin(this.material);
    this.plugin.atlas = this.atlas;

    this.quadDaten = new VertexData();
    // Einheitsquad: x zentriert (-0.5..0.5), Basis auf y = 0, damit der
    // Fuss der Karte exakt auf der ZDO-Höhe sitzt.
    this.quadDaten.positions = [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0];
    this.quadDaten.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    this.quadDaten.indices = [0, 1, 2, 2, 1, 3];
  }

  // ── Atlas ─────────────────────────────────────────────────────────

  /** Hat dieses Prefab eine gebackene Zeile? */
  atlasBereit(prefabName: string): boolean {
    return this.zeilen.has(prefabName);
  }

  /**
   * Ist ueber dieses Prefab schon entschieden (gebacken ODER abgelehnt)?
   *
   * Nur dafuer da, dem Aufrufer den Aufbau der Master-Liste zu ersparen:
   * baueZellMaster() laeuft bei jedem Bucket-Umbau, melde() haette aber
   * nur beim allerersten Mal etwas zu tun.
   */
  kennt(prefabName: string): boolean {
    return this.zeilen.has(prefabName) || this.abgelehnt.has(prefabName);
  }

  /**
   * Einen Archetyp anmelden und, wenn nötig, backen.
   *
   * Lazy statt einmalig beim Weltaufbau: `AssetManager.getMasters()` ist
   * asynchron, und welche Prefabs eine Sitzung überhaupt sieht, steht
   * erst fest, wenn der Spieler dort ist. Gebacken wird deshalb, sobald
   * der EntityManager einen Bucket zellweise schneidet — also genau für
   * die dichte Vegetation, um die es geht.
   *
   * @returns true, wenn eine Zeile bereitsteht.
   */
  melde(prefabName: string, masters: readonly PrefabMaster[]): boolean {
    if (this.zeilen.has(prefabName)) return true;
    if (this.abgelehnt.has(prefabName)) return false;
    try {
      return this.backe(prefabName, masters);
    } catch (e) {
      // ── Fail-Soft, aber LAUT ─────────────────────────────────────
      // Der reine Kern wirft beim Ueberschreiten des Zeilenbudgets
      // (ansichtRechteck) — dort ist die Strenge richtig und der Test
      // hält sie fest. Zur LAUFZEIT darf ein voller Atlas dagegen nur
      // das Sprite-Fernfeld kosten, niemals die echten Bäume: Wer hier
      // durchwirft, bricht mitten in flush() den Instanz-Neuaufbau ab
      // und lässt einen halb gefüllten Bucket stehen. Also: laut in die
      // Konsole, Prefab abgelehnt, echte Darstellung bis ans Ende der
      // Sichtweite.
      console.error(`[impostor] Atlas-Zeile für ${prefabName} fehlgeschlagen:`, e);
      this.abgelehnt.add(prefabName);
      return false;
    }
  }

  /**
   * Einen Archetyp in den Atlas backen — IMPOSTOR_ANSICHTEN Gierwinkel.
   *
   * Läuft in EINEM synchronen Task: Die Backmeshes existieren nur
   * innerhalb dieses Aufrufs und sind vor der Rückkehr wieder entsorgt.
   * Sonst stünden sie in einem gerenderten Bild mitten in der Welt und —
   * schlimmer — in der Werferliste (Shadows.ts nimmt jedes neue Mesh über
   * onNewMeshAddedObservable auf; der IMPOSTOR_PRAEFIX fängt das ab, aber
   * darauf allein soll sich niemand verlassen müssen).
   */
  private backe(prefabName: string, masters: readonly PrefabMaster[]): boolean {
    if (masters.length === 0) {
      this.abgelehnt.add(prefabName);
      return false;
    }

    // ── Kartenmasse aus der ECHTEN Geometrie ────────────────────────
    // Nicht aus PrefabDef.renderScale: Die Werte dort sind von Hand
    // gepflegt und weichen messbar ab (Fichte1 real 5,84 x 12,18 m gegen
    // renderScale 6,4 x 12,0; Wacholder1 real 1,3 x 1,0 gegen 1,0 x 0,7).
    // Als Plausibilitätsprüfung taugen sie, als Quelle nicht.
    const box = this.huelleAusMastern(masters);
    if (!box) {
      this.abgelehnt.add(prefabName);
      return false;
    }
    const { breite, hoehe } = karteMasse(box.minX, box.minZ, box.maxX, box.maxZ, box.maxY);
    if (hoehe < IMPOSTOR_MIN_HOEHE_M || breite <= 0) {
      // Bodenpflanzen und Kleinbüsche — s. IMPOSTOR_MIN_HOEHE_M.
      this.abgelehnt.add(prefabName);
      return false;
    }

    const zeile = this.naechsteZeile;
    // Wirft, wenn das Raster voll ist — bewusst VOR jeder Zustandsänderung,
    // damit ein gesprengtes Budget keinen halb gebackenen Archetyp
    // hinterlässt.
    ansichtRechteck(zeile, 0);

    // ── Backmeshes aufbauen ─────────────────────────────────────────
    const halter = new TransformNode(`${IMPOSTOR_PRAEFIX}Halter`, this.scene);
    const teile: Mesh[] = [];
    for (let i = 0; i < masters.length; i++) {
      const quelle = masters[i]!.mesh;
      // Über den abgesegneten Weg: VertexData.ExtractFromMesh auf ein
      // FRISCHES Mesh. Nie mesh.clone() — Babylon reicht dabei die
      // Geometry der Quelle weiter, und geteilte Geometry plus
      // thinInstanceSetBuffer ist Leitplanke 2 (Symptom: ganze Bäume
      // verschwinden). Hier laufen zwar keine Thin Instances, aber der
      // Prototyp trägt womöglich noch einen Matrixpuffer samt dessen
      // Hülle, und die käme über mesh.clone() mit.
      const teil = zellMeshAusPrototyp(
        quelle,
        `${IMPOSTOR_PRAEFIX}Back_${prefabName}_${i}`,
        this.scene
      );
      teil.material = this.backMaterial(quelle.material);
      teil.receiveShadows = false;
      teil.parent = halter;
      // Die localMatrix bäckt die GLB-Hierarchie ein (AssetManager.zuMaster,
      // samt Determinantenkorrektur über sideOrientation). Sie muss hier
      // wieder aufgetragen werden, sonst stünden Rinde und Laub nicht
      // übereinander.
      teil.rotationQuaternion = Quaternion.Identity();
      masters[i]!.localMatrix.decompose(teil.scaling, teil.rotationQuaternion, teil.position);
      teil.setEnabled(true);
      teile.push(teil);
    }

    // ── Kamera rahmen ───────────────────────────────────────────────
    // Orthographisch, exakt auf (breite x hoehe). Die Kartenbreite ist
    // die WORST-CASE-Reichweite über alle Gierwinkel (karteMasse), damit
    // alle 8 Ansichten denselben Massstab haben und keine die Krone
    // abschneidet.
    const radius = breite / 2;
    const abstand = radius * 2 + 0.5;
    this.backKamera.position.copyFromFloats(0, hoehe / 2, abstand);
    this.backKamera.setTarget(new Vector3(0, hoehe / 2, 0));
    this.backKamera.orthoLeft = -radius;
    this.backKamera.orthoRight = radius;
    this.backKamera.orthoBottom = -hoehe / 2;
    this.backKamera.orthoTop = hoehe / 2;
    this.backKamera.minZ = 0.05;
    this.backKamera.maxZ = abstand + radius + 1;

    const vorherigeListe = this.atlas.renderList;
    this.atlas.renderList = teile;
    const vorherigeAktive = this.scene.activeCamera;
    try {
      for (let k = 0; k < IMPOSTOR_ANSICHTEN; k++) {
        // Backkonvention: Ansicht k zeigt das um +k/N Umdrehungen
        // gedrehte Modell. Das Gegenstück steht im Vertexshader
        // (impWinkel = yaw - atan2(fwd.x, fwd.z)); wer eines von beiden
        // dreht, spiegelt den ganzen Ansichtsring.
        halter.rotation.y = (k / IMPOSTOR_ANSICHTEN) * Math.PI * 2;
        halter.computeWorldMatrix(true);
        for (const t of teile) t.computeWorldMatrix(true);
        const r = ansichtRechteck(zeile, k);
        this.backKamera.viewport = new Viewport(
          r.x / ATLAS_KANTE_PX,
          r.y / ATLAS_KANTE_PX,
          r.b / ATLAS_KANTE_PX,
          r.h / ATLAS_KANTE_PX
        );
        this.atlas.render();
      }
    } finally {
      this.atlas.renderList = vorherigeListe;
      this.scene.activeCamera = vorherigeAktive;
      for (const t of teile) t.dispose(false, false);
      halter.dispose();
    }

    this.mipsErneuern();

    const uv = zeilenUv(zeile);
    this.zeilen.set(prefabName, {
      index: zeile,
      u0: uv.u0,
      v0: uv.v0,
      breite,
      hoehe,
      wind: STARR.test(prefabName) ? 0 : 1,
    });
    this.naechsteZeile++;
    return true;
  }

  /**
   * Mipkette EINMAL je fertiger Zeile neu erzeugen.
   *
   * Nicht je Ansicht (das wären 8 Vollketten je Baum) und nicht nie: Ein
   * Sprite bei 300 m misst rund 50 Bildpunkte gegen eine 128 px hohe
   * Zelle, wird also um Faktor 2,5 verkleinert — ohne Mipkette flimmert
   * das bei jeder Kamerabewegung.
   */
  private mipsErneuern(): void {
    const intern = this.atlas.getInternalTexture();
    if (!intern) return;
    this.scene.getEngine().updateTextureSamplingMode(Texture.TRILINEAR_SAMPLINGMODE, intern, true);
  }

  /**
   * Ein billiges, UNBELEUCHTETES Backmaterial zu einem Quellmaterial.
   *
   * ── Warum der Atlas reines Albedo trägt ─────────────────────────────
   * Die Referenz backt mit einem Hemisphären-Rig (BAKE_SKY 1.15*PI,
   * BAKE_GROUND 0.62*PI) und beleuchtet die Karte danach NOCHMALS. Das
   * gibt dem Sprite innere Form, kostet aber die schwierigste
   * Kalibrierung des ganzen Pakets: Die PI-Faktoren heben Lamberts 1/PI
   * auf, das THREES MeshLambertMaterial einrechnet — Babylons
   * StandardMaterial rechnet ohne, ein blind übernommener Faktor macht
   * die Sprites um Faktor 3 zu hell oder zu dunkel. Dazu käme unsere
   * lineare Pipeline (StandardGammaFix) als zweite Fehlerquelle.
   *
   * Deshalb hier: Der Atlas enthält EXAKT das, was auch die Baumtextur
   * enthält. Die Beleuchtung passiert genau einmal, im Zeichenmaterial,
   * mit derselben Sonne wie beim echten Baum. Das nimmt der
   * Helligkeitsparität — dem wahrscheinlichsten sichtbaren Fehler — ihre
   * Hauptursache.
   *
   * Der Preis: Dem Sprite fehlt die INNERE Schattierung (die Unterseite
   * eines Astes ist so hell wie seine Oberseite). Bei 240 m durch Nebel
   * auf 60 Bildpunkten liegt das unter der Wahrnehmungsschwelle; wenn
   * die Sprites im Bild dennoch flach lesen, ist das Hemisphären-Rig der
   * nächste Schritt — und dann MIT Nachmessung gegen einen echten Baum,
   * nicht mit den PI-Faktoren der Referenz.
   *
   * ── Wie "unbeleuchtet" hier zustandekommt ───────────────────────────
   * default.fragment rechnet
   *   finalDiffuse = clamp(diffuseBase*diffuseColor + vAmbientColor,0,1) * baseColor.rgb
   *   color        = clamp(finalDiffuse*baseAmbient + spekular + … + emissiveColor, 0, 1)
   * Mit `disableLighting` bleibt diffuseBase null, ambientColor ist
   * schwarz, spekular aus — es bleibt `emissiveColor`, und der ist bei
   * vEmissiveColor = schwarz genau `emissiveTexture * level`, also das
   * Albedo. Der Alphakanal kommt über useAlphaFromDiffuseTexture aus
   * derselben Textur, damit der Alphaschnitt greift.
   */
  private backMaterial(quelle: Material | null): StandardMaterial {
    const schluessel = quelle ?? this.material;
    const da = this.backMaterialien.get(schluessel);
    if (da) return da;

    const m = new StandardMaterial(`${IMPOSTOR_PRAEFIX}Back_${schluessel.name}`, this.scene);
    const tex = albedoVon(quelle);
    if (tex) {
      m.diffuseTexture = tex;
      m.emissiveTexture = tex;
      m.useAlphaFromDiffuseTexture = true;
      m.transparencyMode = Material.MATERIAL_ALPHATEST;
      // Die Quellmodelle laufen mit alphaMode MASK / alphaCutoff 0.5.
      m.alphaCutOff = 0.5;
    }
    m.diffuseColor = Color3.Black();
    m.emissiveColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.ambientColor = Color3.Black();
    m.disableLighting = true;
    m.backFaceCulling = false;
    // Nebel würde die Kronen im Atlas grau einfärben — der Nebel gehört
    // ins Bild, nicht in die Textur.
    m.fogEnabled = false;
    this.backMaterialien.set(schluessel, m);
    return m;
  }

  /** Vereinigter Huellquader aller Master, in Prefab-Koordinaten. */
  private huelleAusMastern(
    masters: readonly PrefabMaster[]
  ): { minX: number; minZ: number; maxX: number; maxZ: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const p = new Vector3();
    for (const master of masters) {
      const roh = master.mesh.getVerticesData('position');
      if (!roh || roh.length < 3) continue;
      // Erst die ROHE Box aus den Vertices — nicht über
      // getBoundingInfo(): Der Prototyp trägt im Zellbetrieb einen über
      // huellkoerperAufweiten() um 1,5 m aufgeblasenen Kasten, und
      // 1,5 m Fehler auf der Kartenbreite sind bei einem 3-m-Busch die
      // Hälfte.
      let rx0 = Infinity;
      let ry0 = Infinity;
      let rz0 = Infinity;
      let rx1 = -Infinity;
      let ry1 = -Infinity;
      let rz1 = -Infinity;
      for (let i = 0; i < roh.length; i += 3) {
        const x = roh[i]!;
        const y = roh[i + 1]!;
        const z = roh[i + 2]!;
        if (x < rx0) rx0 = x;
        if (y < ry0) ry0 = y;
        if (z < rz0) rz0 = z;
        if (x > rx1) rx1 = x;
        if (y > ry1) ry1 = y;
        if (z > rz1) rz1 = z;
      }
      // Die 8 Ecken durch die localMatrix — die trägt die eingebackene
      // GLB-Hierarchie samt Skalierung und Drehung.
      for (let e = 0; e < 8; e++) {
        p.copyFromFloats(e & 1 ? rx1 : rx0, e & 2 ? ry1 : ry0, e & 4 ? rz1 : rz0);
        const w = Vector3.TransformCoordinates(p, master.localMatrix);
        if (w.x < minX) minX = w.x;
        if (w.y < minY) minY = w.y;
        if (w.z < minZ) minZ = w.z;
        if (w.x > maxX) maxX = w.x;
        if (w.y > maxY) maxY = w.y;
        if (w.z > maxZ) maxZ = w.z;
      }
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minZ, maxX, maxZ, maxY };
  }

  // ── Sprite-Feld ───────────────────────────────────────────────────

  /**
   * Die Sprite-Beiträge EINES Prefabs vollständig ersetzen.
   *
   * Bewusst „alles auf einmal" statt „Zelle für Zelle": Der EntityManager
   * rechnet die Zuteilung bei jedem Bucket-Neuaufbau ohnehin komplett
   * neu, und ein vollständiger Ersatz hat keinen Pfad, auf dem ein alter
   * Beitrag liegenbleiben könnte. Ein liegengebliebener Beitrag wäre ein
   * DOPPELBILD — der Baum stünde echt und als Sprite zugleich.
   *
   * @param daten Zellenschlüssel → Float32Array mit Stride SPRITE_STRIDE
   *              (x, y, z, breite, hoehe, yaw). `null` löscht alles.
   */
  setzePrefab(prefabName: string, daten: Map<number, Float32Array> | null): void {
    const alt = this.beitraege.get(prefabName);
    if (alt) for (const k of alt.keys()) this.schmutzig.add(k);
    if (!daten || daten.size === 0) {
      this.beitraege.delete(prefabName);
      return;
    }
    this.beitraege.set(prefabName, daten);
    for (const k of daten.keys()) this.schmutzig.add(k);
  }

  /** Kartenmasse eines Archetyps — der EntityManager skaliert damit. */
  zeileVon(prefabName: string): { breite: number; hoehe: number } | null {
    const z = this.zeilen.get(prefabName);
    return z ? { breite: z.breite, hoehe: z.hoehe } : null;
  }

  /**
   * Alle schmutzigen Zellen neu zusammensetzen — EINMAL am Ende von
   * EntityManager.flush().
   *
   * ── Warum aufgeschoben ───────────────────────────────────────────
   * Ein Sprite-Zellmesh trägt die Beiträge MEHRERER Buckets (das ist der
   * ganze Hebel: ein Zeichenaufruf je Zelle statt einer je Zelle x
   * Prefab). flush() arbeitet aber prefabweise. Würde die Zelle bei
   * jedem Bucket neu zusammengesetzt, liefe derselbe Puffer mehrfach pro
   * Bild über den Bus — genau die Sorte Pufferverkehr, die in
   * SchattenInstanzKeulung.ts mit 18 → 59 ms vermessen ist.
   */
  baueZellen(): void {
    if (this.schmutzig.size === 0) return;
    for (const zelle of this.schmutzig) this.baueZelle(zelle);
    this.schmutzig.clear();
  }

  private baueZelle(zelle: number): void {
    let gesamt = 0;
    for (const proZelle of this.beitraege.values()) {
      const d = proZelle.get(zelle);
      if (d) gesamt += d.length / SPRITE_STRIDE;
    }

    if (gesamt === 0) {
      const alt = this.zellMeshes.get(zelle);
      if (alt) {
        this.zellMeshes.delete(zelle);
        this.meshFreigeben(alt);
      }
      return;
    }

    const mat = new Float32Array(gesamt * 16);
    const uv = new Float32Array(gesamt * 2);
    const karte = new Float32Array(gesamt * 4);
    let n = 0;
    let reserve = 0;
    for (const [prefabName, proZelle] of this.beitraege) {
      const d = proZelle.get(zelle);
      if (!d) continue;
      const zeile = this.zeilen.get(prefabName);
      // Kann nicht passieren (der EntityManager fragt atlasBereit()
      // vorher), aber ein Beitrag ohne Zeile würde ein fremdes
      // Atlasrechteck zeichnen — lieber gar nicht.
      if (!zeile) continue;
      for (let i = 0; i < d.length; i += SPRITE_STRIDE) {
        const o = n * 16;
        // Reine TRANSLATION. Grösse und Gierwinkel liegen in aImpKarte —
        // dadurch ist der lokale Raum des Shaders der Weltraum und die
        // Rückrechnung der Referenz entfällt (s. Vertexshader).
        mat[o] = 1;
        mat[o + 5] = 1;
        mat[o + 10] = 1;
        mat[o + 15] = 1;
        mat[o + 12] = d[i]!;
        mat[o + 13] = d[i + 1]!;
        mat[o + 14] = d[i + 2]!;
        uv[n * 2] = zeile.u0;
        uv[n * 2 + 1] = zeile.v0;
        const b = d[i + 3]!;
        const h = d[i + 4]!;
        karte[n * 4] = b;
        karte[n * 4 + 1] = h;
        karte[n * 4 + 2] = d[i + 5]!;
        karte[n * 4 + 3] = zeile.wind;
        if (h > reserve) reserve = h;
        if (b > reserve) reserve = b;
        n++;
      }
    }

    let mesh = this.zellMeshes.get(zelle);
    if (!mesh) {
      mesh = this.meshHolen(zelle);
      this.zellMeshes.set(zelle, mesh);
    } else {
      mesh.name = this.zellName(zelle);
    }

    // ── Die Reihenfolge ist fest ────────────────────────────────────
    // Erst 'matrix' (setzt instancesCount), dann die Eigenattribute,
    // dann die Hülle, dann sichtbar schalten — dieselbe Dreierfolge wie
    // EntityManager.schreibeInstanzen(), aus demselben Grund.
    // thinInstanceSetBuffer setzt instancesCount NUR beim kind 'matrix';
    // liefen die Puffer auseinander, läse der Shader fremde Instanzdaten
    // (falsche Atlaszelle, falsche Grösse) — ohne Absturz, ohne Meldung.
    mesh.thinInstanceSetBuffer('matrix', mat.subarray(0, n * 16), 16, false);
    mesh.thinInstanceSetBuffer('aImpUv', uv.subarray(0, n * 2), 2, false);
    mesh.thinInstanceSetBuffer('aImpKarte', karte.subarray(0, n * 4), 4, false);
    huellkoerperAufweiten(mesh, reserve + SPRITE_RESERVE_M);
    mesh.setEnabled(true);
  }

  private zellName(zelle: number): string {
    const cx = (zelle >>> 16) - 0x8000;
    const cz = (zelle & 0xffff) - 0x8000;
    return `${IMPOSTOR_PRAEFIX}_${cx}_${cz}`;
  }

  /**
   * Ein Sprite-Zellmesh besorgen.
   *
   * Der Pool darf hier GLOBAL sein — anders als bei den echten
   * Zell-Mastern, die nur innerhalb desselben (Prefab, Prototyp)
   * wiederverwendet werden dürfen. Grund: Babylon cacht rawBoundingInfo
   * je Mesh einmalig aus der Rohgeometrie und setzt sie beim
   * Geometriewechsel nicht zurück (thinInstanceMesh.js:236-249). Alle
   * Sprite-Meshes haben aber DIESELBE Rohgeometrie — dasselbe
   * Einheitsquad —, also kann diese Falle nicht zuschnappen. Das ist die
   * einzige Stelle, an der die Sprite-Seite einfacher ist als die echte.
   */
  private meshHolen(zelle: number): Mesh {
    const frei = this.pool.pop();
    if (frei) {
      frei.name = this.zellName(zelle);
      return frei;
    }
    const mesh = new Mesh(this.zellName(zelle), this.scene);
    // EIGENE Geometry je Mesh (Leitplanke 2): applyToMesh legt sie an.
    // Die CPU-seitigen Arrays werden geteilt, das ist gewollt und billig
    // — die GPU-Puffer nicht.
    this.quadDaten.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    // Jenseits von shadowMaxZ (150 m) ist ohnehin nichts beschattet, und
    // eine Schattenabtastung je Fragment kostet.
    mesh.receiveShadows = false;
    // Das Frustum-Culling je Zelle IST der Grund für den Zellzuschnitt
    // der Sprite-Seite — hier darf nichts bedingungslos eingereicht
    // werden.
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.computeWorldMatrix(true);
    return mesh;
  }

  private meshFreigeben(mesh: Mesh): void {
    mesh.thinInstanceSetBuffer('matrix', null, 16, false);
    mesh.setEnabled(false);
    if (this.pool.length >= SPRITE_POOL_DECKEL) {
      this.onMeshEntsorgt?.(mesh);
      mesh.dispose(false, false);
      return;
    }
    this.pool.push(mesh);
  }

  stats(): ImpostorStats {
    let instanzen = 0;
    let zellen = 0;
    for (const mesh of this.zellMeshes.values()) {
      if (!mesh.isEnabled()) continue;
      zellen++;
      instanzen += mesh.thinInstanceCount;
    }
    return {
      zeilen: this.zeilen.size,
      budget: atlasRaster().budget,
      atlasPx: ATLAS_KANTE_PX,
      abgelehnt: this.abgelehnt.size,
      zellen,
      instanzen,
    };
  }

  dispose(): void {
    for (const mesh of this.zellMeshes.values()) mesh.dispose(false, false);
    this.zellMeshes.clear();
    for (const mesh of this.pool) mesh.dispose(false, false);
    this.pool.length = 0;
    for (const m of this.backMaterialien.values()) m.dispose();
    this.backMaterialien.clear();
    this.material.dispose();
    this.atlas.dispose();
    this.backKamera.dispose();
  }
}

/**
 * Die Albedo-Textur eines Vegetationsmaterials.
 *
 * Die Bäume kommen als PBRMaterial aus dem GLB-Ladeweg (AssetManager);
 * StandardMaterial deckt den Fall ab, dass jemand später eines
 * unterschiebt. Beides über `instanceof` statt über Namen — ein
 * Materialname ist keine Zusicherung.
 */
function albedoVon(m: Material | null): Texture | null {
  if (m instanceof PBRMaterial && m.albedoTexture instanceof Texture) return m.albedoTexture;
  if (m instanceof StandardMaterial && m.diffuseTexture instanceof Texture) {
    return m.diffuseTexture;
  }
  return null;
}

/** Nur für die Diagnose: Gehört das Mesh zum Sprite-Fernfeld? */
export function istImpostorMesh(mesh: AbstractMesh): boolean {
  return mesh.name.startsWith(IMPOSTOR_PRAEFIX);
}
