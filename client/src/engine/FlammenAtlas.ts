/**
 * Lässt Flammen brennen — schaltet den Sprite-Atlas eines Feuer-Materials
 * Bild für Bild weiter.
 *
 * Die Karten (tools/flame-cards.py) tragen ein Material namens `Flamme`
 * mit einem 4×4-Atlas (tools/flame-texture.py). Die Geometrie kennt den
 * Atlas nicht: Ihre UVs decken die erste Kachel ab, und weitergeschaltet
 * wird hier, indem `uOffset`/`vOffset` der Textur je Bild versetzt werden.
 *
 * ── Warum kein MaterialPlugin ────────────────────────────────────────
 * Aus demselben Grund wie bei `GlutPuls`: Ein Shader-Plugin könnte pro
 * Pixel rechnen und wäre die schönere Lösung, aber `uOffset` ist ein
 * Uniform, den man pro Frame setzen kann. Für eine Handvoll Feuer reicht
 * das vollständig — und ein Eingriff weniger in den PBR-Shader ist ein
 * Eingriff weniger, der bei der nächsten Babylon-Version bricht.
 *
 * ── Was das kostet, und warum es hier zu verschmerzen ist ────────────
 * Ein Uniform gilt fürs MATERIAL, und alle Fackeln teilen sich eines.
 * Sie zeigen deshalb dasselbe Bild. Im Gang sieht man selten zwei
 * gleichzeitig, und was man im Raum wirklich als Bewegung wahrnimmt, ist
 * ohnehin das LICHT — und das flackert je Lichtplatz für sich
 * (`PrefabDef.light.flicker`). Wenn später ein Lagerfeuer neben einer
 * Fackel steht und der Gleichtakt auffällt, bekommt es eine eigene
 * Materialkopie; dafür ist der Atlas schon vorbereitet.
 *
 * ── Warum 12 Bilder pro Sekunde ──────────────────────────────────────
 * Feuer bewegt sich schnell, aber nicht gleichmässig. Bei 24 wirkt die
 * Schleife glatt und dadurch mechanisch; bei 8 sieht man die einzelnen
 * Bilder. 12 liegt in dem Bereich, in dem das Auge Bewegung sieht und
 * keinen Takt — dieselbe Größenordnung, in der Zeichentrickfeuer läuft.
 */
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** Kachelraster des Atlas (4×4 = 16 Bilder). */
const RASTER = 4;
/** Bilder je Sekunde. */
const TAKT = 12;

interface Eintrag {
  material: PBRMaterial;
  /**
   * Zeitversatz in Bildern, damit zwei verschiedene Feuer nicht im
   * Gleichtakt laufen. Aus dem Materialnamen abgeleitet und nicht
   * zufällig: Dasselbe Modell brennt nach einem Neuladen wieder gleich.
   */
  versatz: number;
}

export class FlammenAtlas {
  private static readonly eintraege: Eintrag[] = [];
  private static angehaengt: WeakSet<Scene> = new WeakSet();
  private static zeit = 0;

  /** Wie viele Materialien gerade brennen — Diagnose. */
  static get anzahl(): number {
    return this.eintraege.length;
  }

  /**
   * Zustand für die Konsole (`__vb.flammen()`).
   *
   * Ein Feuer, das man nicht sieht, hat mehrere mögliche Ursachen, die von
   * aussen gleich aussehen: kein Material angemeldet, falsche Kachel
   * gewählt, oder die Karten fehlen im Modell. Die Zahlen hier trennen sie
   * in einem Blick — und ersparen die Runde, in der geraten wird.
   */
  static diagnose(): Record<string, unknown> {
    const erster = this.eintraege[0];
    return {
      materialien: this.eintraege.map((e) => e.material.name),
      zeit: Number(this.zeit.toFixed(2)),
      bild: erster ? (Math.floor(this.zeit * TAKT) + erster.versatz) % (RASTER * RASTER) : null,
      kachel: erster
        ? this.texturen(erster.material).map((t) => ({
            name: t.name,
            uOffset: Number(t.uOffset.toFixed(3)),
            vOffset: Number(t.vOffset.toFixed(3)),
            uScale: t.uScale,
          }))
        : [],
    };
  }

  /**
   * Ein Flammenmaterial anmelden.
   *
   * Setzt zugleich die Darstellung: beidseitig, ueberstrahlend, mit
   * Alphatest. Eine Flamme ist eine Flaeche ohne Rueckseite — wer sie von
   * hinten sieht, soll sie trotzdem sehen.
   */
  static registriere(material: PBRMaterial, scene: Scene): void {
    if (this.eintraege.some((e) => e.material === material)) return;

    // KEIN `unlit`. Das war der erste Anlauf und der Grund, warum die
    // Flamme im Spiel unsichtbar blieb: `unlit` zeichnet in Babylon nur
    // `albedoColor x albedoTexture` und ignoriert Emissive — und die
    // Karten tragen ihre Farbe genau dort, bei schwarzer Grundfarbe.
    // Herausgekommen ist eine schwarze Flamme mit sauberer Transparenz,
    // auf dunkler Wand also nichts.
    //
    // Unbeleuchtet ist sie trotzdem, nur anders herum begruendet: Die
    // Grundfarbe IST schwarz, also traegt jede Beleuchtung null bei, und
    // was man sieht, ist allein das Emissive. Das hat den Vorteil, dass
    // Werte ueber 1 in den Bloom laufen — eine Flamme darf ueberstrahlen.
    material.emissiveIntensity = 1.8;
    material.backFaceCulling = false;
    // ALPHATEST statt ALPHABLEND, und das Tiefenschreiben bleibt AN.
    //
    // Die Flamme hat seit der Umstellung auf den flachen Stil eine harte
    // Silhouette — jedes Pixel ist ganz da oder gar nicht. Damit ist der
    // Alphatest die richtige Wahl: Er braucht keine Sortierung nach Tiefe,
    // und genau die war das Problem bei zwei gekreuzten Karten, die sich
    // je nach Zeichenreihenfolge gegenseitig ausstanzten. Mit Tiefentest
    // UND Tiefenschreiben lösen sie sich sauber gegeneinander auf.
    //
    // Bei einer weich auslaufenden Flamme wäre das falsch — dort braucht
    // es Blending. Der Stil entscheidet hier über die Technik.
    material.transparencyMode = 1; // ALPHATEST
    material.alphaCutOff = 0.5;
    material.disableDepthWrite = false;
    material.separateCullingPass = false;

    for (const t of this.texturen(material)) {
      t.uScale = 1 / RASTER;
      t.vScale = 1 / RASTER;
      t.hasAlpha = true;
      // Kein Wiederholen: Am Kachelrand zöge der Filter sonst die
      // Nachbarflamme herein — ein feiner heller Saum, der wandert.
      t.wrapU = 0; // CLAMP_ADDRESSMODE
      t.wrapV = 0;
    }

    let h = 2166136261;
    for (const c of material.name) h = ((h ^ c.charCodeAt(0)) * 16777619) >>> 0;
    this.eintraege.push({ material, versatz: h % (RASTER * RASTER) });

    if (!this.angehaengt.has(scene)) {
      this.angehaengt.add(scene);
      scene.onBeforeRenderObservable.add(() => {
        this.zeit += scene.getEngine().getDeltaTime() / 1000;
        this.aktualisiere();
      });
    }
  }

  /** Alle angemeldeten Materialien vergessen (Szenenwechsel). */
  static leere(): void {
    this.eintraege.length = 0;
  }

  private static texturen(material: PBRMaterial): Texture[] {
    return [material.emissiveTexture, material.albedoTexture, material.opacityTexture]
      .filter((t): t is Texture => !!t && 'uScale' in t);
  }

  private static aktualisiere(): void {
    const bilder = RASTER * RASTER;
    for (const e of this.eintraege) {
      const bild = (Math.floor(this.zeit * TAKT) + e.versatz) % bilder;
      const spalte = bild % RASTER;
      // Zeile direkt, ohne Umdrehen. Der glTF-Import lässt `invertY` auf
      // false (an der fertigen GLB nachgemessen), v = 0 ist also die OBERE
      // Bildkante — dieselbe Richtung, in der der Atlas gefüllt wird. Die
      // erste Fassung drehte hier um und spielte die Zeilen rückwärts; das
      // erkennt man nicht als Fehler, sondern nur als „sieht komisch aus".
      const zeile = Math.floor(bild / RASTER);
      for (const t of this.texturen(e.material)) {
        t.uOffset = spalte / RASTER;
        t.vOffset = zeile / RASTER;
      }
    }
  }
}
