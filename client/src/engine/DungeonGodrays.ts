/**
 * Godrays im Dungeon — Lichtschaechte, nicht Fackeln (M2 / AP18).
 * Godrays in a dungeon — light shafts, not torches.
 *
 * ── Warum EINE Passage und nicht eine je Schacht ──────────────────────
 * `VolumetricLightScatteringPostProcess` ist kein Filter ueber dem fertigen
 * Bild: Er rendert eine eigene VERDECKUNGS-PASSAGE der ganzen Szene in eine
 * Zieltextur und blurrt die anschliessend radial. Der Aufwand haengt also an
 * der Geometrie, nicht nur an der Bildflaeche — und er faellt JE INSTANZ an.
 * Ein Grab mit vier Schaechten und vier Instanzen renderte seine Geometrie
 * fuenfmal je Bild. `render-tech.md` §3.3 sagt deshalb „nicht ein Godray je
 * Fackel"; dieselbe Rechnung verbietet auch „ein Godray je Schacht".
 * VLS is not a filter over the finished image: it renders its own OCCLUSION
 * PASS of the whole scene into a render target. The cost hangs off the
 * geometry, and it is paid PER INSTANCE.
 *
 * Deshalb: EINE Instanz, deren Quelle je Bild auf die naechstgelegene
 * Schachtmuendung gesetzt wird. Das ist keine Naeherung, die man merkt — zwei
 * Schachtmuendungen sind in einem Steingrab nie gleichzeitig im Bild (die
 * Sichtstreckenmessung aus `DungeonAtmosphere.ts` sagt: Median 8 m), und wenn
 * doch, leuchtet die naehere.
 * Therefore: ONE instance whose source is set to the nearest shaft mouth each
 * frame. Two mouths are never in frame at once in a barrow.
 *
 * ── Und ausserhalb der Reichweite gar nicht ───────────────────────────
 * Steht der Spieler in einem Gang ohne Schacht — der Normalfall —, ist der
 * Effekt komplett abgehaengt. Das ist der eigentliche Kostenhebel: Nicht „ein
 * Godray ist billig", sondern „ein Godray laeuft selten".
 * Standing in a corridor without a shaft — the normal case — the effect is
 * fully detached. That is the actual cost lever.
 *
 * ── Der Leck-Fallstrick in Babylon ────────────────────────────────────
 * `VolumetricLightScatteringPostProcess` legt seine Zieltextur in
 * `camera.customRenderTargets`, wenn es mit einer Kamera gebaut wurde — sein
 * `dispose(camera)` raeumt aber nur `scene.customRenderTargets` auf
 * (nachgelesen in `volumetricLightScatteringPostProcess.js`, Zeile 260 gegen
 * 291). Wer sich darauf verlaesst, laesst bei jedem Stufenwechsel eine
 * vollstaendige Szenenpassage in der Kamera liegen: Der Effekt ist weg, die
 * Kosten bleiben — und wachsen mit jedem Wechsel. Diese Klasse raeumt die
 * Liste deshalb selbst.
 * Babylon's `dispose(camera)` only cleans `scene.customRenderTargets`, while
 * the constructor with a camera pushes into `camera.customRenderTargets`. Every
 * tier switch would leave a complete scene pass behind: the effect gone, the
 * cost staying, growing with each switch. This class cleans that list itself.
 */
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { dungeon2 } from '@wov/shared';

/**
 * Aufloesungsanteil der Verdeckungspassage und Abtastzahl des radialen Blurs —
 * beide woertlich aus `PostProcessing.setSunShafts()`, wo sie das Ergebnis
 * einer Messung sind (0.5/100 kostete 40 -> 17 fps, 0.25/60 sieht praktisch
 * gleich aus). Sie stehen hier als Startpunkt, nicht als Wahrheit fuer
 * Innenraeume; die Dungeon-Messung entscheidet.
 * Ratio of the occlusion pass and sample count of the radial blur, taken
 * verbatim from the outdoor sun shafts, where they are a measured compromise.
 */
const VERHAELTNIS = 0.25;
const PROBEN = 60;

/**
 * Ab welcher Entfernung ein Schacht den Effekt ueberhaupt einschaltet (Meter).
 *
 * 30 m ist nicht gegriffen: Die Sichtstreckenmessung ueber 40 Graeber
 * (`DungeonAtmosphere.ts`, 47.328 Sichtlinien) ergab 90. Perzentil 28 m. Ein
 * Schacht weiter weg als das ist in neun von zehn Faellen gar nicht sichtbar,
 * und ein Effekt fuer etwas Unsichtbares ist reine Rechenzeit.
 * From what distance a shaft switches the effect on at all (metres). Not a
 * guess: the sight-line measurement over 40 barrows gives a 90th percentile of
 * 28 m; a shaft further away is invisible nine times out of ten.
 */
const REICHWEITE_M = 30;

/**
 * Wie viel naeher ein anderer Schacht sein muss, damit umgeschaltet wird.
 *
 * Ohne diese Schwelle springt die Quelle zwischen zwei fast gleich weit
 * entfernten Schaechten hin und her, sobald der Spieler einen Schritt macht —
 * und ein springender Lichtkegel sieht nicht nach „zwei Schaechte" aus,
 * sondern nach einem Fehler.
 * How much nearer another shaft must be before the source switches. Without
 * this the cone would jump back and forth between two near-equidistant shafts
 * on every step, and a jumping cone does not read as "two shafts".
 */
const WECHSEL_SCHWELLE = 0.8;

/** Erscheinungsbild — gedaempfter als die Sonne, es ist ein Loch in der Decke. */
/** Look — dimmer than the sun; it is a hole in a ceiling, not a sky. */
const BELICHTUNG = 0.22;
const ABFALL = 0.96;
const GEWICHT = 0.45;
const DICHTE = 0.93;

export class DungeonGodrays {
  private strahlen: VolumetricLightScatteringPostProcess | null = null;
  /** Index des gerade bedienten Schachts; -1 = keiner. / -1 = none. */
  private gewaehlt = -1;
  private abgeraeumt = false;
  /** Wiederverwendete Position — `customMeshPosition` wird je Bild gelesen. */
  private readonly quelle = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly kamera: Camera,
    private readonly schaechte: readonly dungeon2.Lichtschacht[]
  ) {}

  /** Zahl der gefundenen Muendungen. / Number of mouths found. */
  get anzahl(): number {
    return this.schaechte.length;
  }

  /**
   * Effekt an- oder abschalten. `false` raeumt die Passage vollstaendig ab —
   * ein blosses Abhaengen der Kamera liesse die Verdeckungspassage
   * weiterlaufen (siehe Kopfkommentar).
   * Switch on or off. `false` tears the pass down completely.
   */
  setzeAn(an: boolean): void {
    if (this.abgeraeumt) return;
    if (an && this.strahlen === null) {
      // Ohne Schaechte gar nicht erst bauen: Ein Effekt ohne Quelle kostet
      // dieselbe Passage und zeigt nichts.
      // Without shafts do not build at all: no source, same cost, no picture.
      if (this.schaechte.length === 0) return;
      const vls = new VolumetricLightScatteringPostProcess(
        'dungeon2Godrays',
        VERHAELTNIS,
        this.kamera,
        undefined,
        PROBEN,
        undefined,
        this.scene.getEngine(),
        false
      );
      vls.useCustomMeshPosition = true;
      vls.exposure = BELICHTUNG;
      vls.decay = ABFALL;
      vls.weight = GEWICHT;
      vls.density = DICHTE;
      this.strahlen = vls;
      this.gewaehlt = -1;
    } else if (!an && this.strahlen !== null) {
      this.raeumePassageAb(this.strahlen);
      this.strahlen = null;
      this.gewaehlt = -1;
    }
  }

  /**
   * Je Bild: den naechsten Schacht waehlen und die Quelle dorthin setzen.
   *
   * Rueckgabe ist der Index des bedienten Schachts (-1 = keiner) — nicht aus
   * Hoeflichkeit, sondern als Zeuge: Ohne ihn saehe ein Effekt, der nie einen
   * Schacht findet, genauso aus wie ein abgeschalteter.
   * Per frame: choose the nearest shaft and put the source there. The return
   * value is the witness — without it, an effect that never finds a shaft looks
   * exactly like a switched-off one.
   */
  aktualisiere(x: number, y: number, z: number): number {
    if (this.strahlen === null) return -1;
    let besterIndex = -1;
    let besteQuadrat = REICHWEITE_M * REICHWEITE_M;
    for (let i = 0; i < this.schaechte.length; i++) {
      const m = this.schaechte[i].mitte;
      const dx = m.x - x;
      const dy = m.y - y;
      const dz = m.z - z;
      const q = dx * dx + dy * dy + dz * dz;
      if (q < besteQuadrat) {
        besteQuadrat = q;
        besterIndex = i;
      }
    }
    // Hysterese: Der bisherige bleibt, solange der neue nicht deutlich naeher
    // ist UND der bisherige noch in Reichweite liegt.
    // Hysteresis: the incumbent stays unless the new one is clearly nearer.
    if (this.gewaehlt >= 0 && besterIndex !== this.gewaehlt) {
      const alt = this.schaechte[this.gewaehlt].mitte;
      const dx = alt.x - x;
      const dy = alt.y - y;
      const dz = alt.z - z;
      const altQ = dx * dx + dy * dy + dz * dz;
      const inReichweite = altQ <= REICHWEITE_M * REICHWEITE_M;
      if (inReichweite && besteQuadrat > altQ * (WECHSEL_SCHWELLE * WECHSEL_SCHWELLE)) {
        besterIndex = this.gewaehlt;
      }
    }
    this.gewaehlt = besterIndex;
    if (besterIndex < 0) {
      // Kein Schacht in Reichweite: Quelle weit hinter die Kamera UND die
      // Belichtung auf null.
      //
      // Die Belichtung ist der Punkt. Der erste Versuch verschob nur die
      // Quelle — und das Bild wurde trotzdem ueberall messbar anders (94,9 %
      // der Bildpunkte gegenueber demselben Bild ohne Godrays, mittlere
      // Abweichung 27,6). Der radiale Blur zieht seine Probe auch dann durchs
      // Bild, wenn die Quelle hinter der Kamera liegt; das Ergebnis ist ein
      // flaechiger Schleier, den man nicht als Godray erkennt, sondern als
      // „das Grab ist auf Hoch irgendwie flauer". Mit `exposure = 0` faellt
      // der Beitrag heraus, und der Effekt zeigt sich nur dort, wo es einen
      // Schacht gibt.
      // The exposure is the point: moving the source alone still changed 94.9 %
      // of the pixels — the radial blur samples across the image regardless,
      // and the result is a flat haze one does not read as godrays but as "the
      // barrow looks washed out on High".
      this.quelle.set(x, y - 1000, z);
      this.strahlen.exposure = 0;
    } else {
      const m = this.schaechte[besterIndex].mitte;
      this.quelle.set(m.x, m.y, m.z);
      this.strahlen.exposure = BELICHTUNG;
    }
    this.strahlen.customMeshPosition = this.quelle;
    return besterIndex;
  }

  /** Nur zum Messen. / For measuring only. */
  werte(): { an: boolean; schaechte: number; gewaehlt: number; passagen: number } {
    return {
      an: this.strahlen !== null,
      schaechte: this.schaechte.length,
      gewaehlt: this.gewaehlt,
      // Die Zahl der Verdeckungspassagen, die tatsaechlich an der Kamera
      // haengen. Sie ist der Leck-Zeuge: Nach zehn Stufenwechseln muss hier
      // 0 oder 1 stehen, nicht 10.
      // The number of occlusion passes actually hanging off the camera — the
      // leak witness: after ten tier switches this must read 0 or 1, not 10.
      passagen: this.kamera.customRenderTargets.length,
    };
  }

  dispose(): void {
    if (this.abgeraeumt) return;
    this.setzeAn(false);
    this.abgeraeumt = true;
  }

  // ── innen / internals ───────────────────────────────────────────────────

  private raeumePassageAb(vls: VolumetricLightScatteringPostProcess): void {
    // ZUERST aus der Kameraliste, DANN `dispose()`. Andersherum stuende in der
    // Liste eine abgeraeumte Zieltextur, und die naechste Bildschleife liefe
    // in eine tote Textur statt in eine fehlende.
    // FIRST out of the camera list, THEN dispose: the other way round the list
    // would hold a disposed render target.
    const rtt = vls.getPass();
    const i = this.kamera.customRenderTargets.indexOf(rtt);
    if (i !== -1) this.kamera.customRenderTargets.splice(i, 1);
    vls.dispose(this.kamera);
  }
}
