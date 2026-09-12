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
 * ── Der Leck-Fallstrick in Babylon: richtiggestellt (A1, 11.09.2026) ──
 * Hier stand, `dispose(camera)` raeume nur `scene.customRenderTargets` auf,
 * waehrend der Konstruktor mit Kamera in `camera.customRenderTargets`
 * schiebt — und jeder Stufenwechsel lasse deshalb eine vollstaendige
 * Szenenpassage in der Kamera liegen ("der Effekt ist weg, die Kosten
 * bleiben"). Die Beobachtung stimmt (`volumetricLightScatteringPostProcess.js`,
 * Zeile 260 gegen 291), die Schlussfolgerung nicht: `dispose` ruft in Zeile
 * 264 `this._volumetricLightScatteringRTT.dispose()`, und
 * `RenderTargetTexture.dispose()` raeumt sich in Babylon 8.56.2 SELBST aus
 * jeder Kamera (`renderTargetTexture.js:950` fuer die Szene, `:954-959` in der
 * Schleife ueber `scene.cameras`). Die Leckprobe „1 statt 11" waere auch ohne
 * die Handarbeit in `raeumePassageAb()` gruen gewesen.
 *
 * `raeumePassageAb()` bleibt trotzdem stehen — aber als das, was es wirklich
 * ist: Idempotenz und eine Absicherung gegen den naechsten Versionswechsel,
 * nicht die Behebung eines Lecks. Die Reihenfolge dort (erst aus der Liste,
 * dann `dispose`) ist aus demselben Grund weiter richtig.
 *
 * ── Der Anker: seit F3 unser eigener (12.09.2026) ────────────────────
 * Hier stand, das ECHTE Leck sei Babylons voreingestellter Anker —
 * `mesh = undefined` im Konstruktor heisst nicht „kein Mesh", sondern
 * `CreateDefaultMesh` (Zeile 479): eine 1-m-Plane mit
 * `emissiveColor = (1,1,1)` bei (0,0,0), die `PostProcess.dispose()` nirgends
 * abraeumt. Das stimmt, war aber die kleinere Haelfte. Die groessere: Dieser
 * Anker wird in der Verdeckungspassage ueber `material.bind(world, mesh)`
 * gebunden, und `Material.prototype.bind` ist in Babylon 8.56 ein LEERER
 * RUMPF (`material.js:859`) — `StandardMaterial` ueberschreibt nur
 * `bindForSubMesh`. Der Anker bekommt also nie eine Projektionsmatrix, der
 * Puffer bleibt schwarz, und der Effekt kostet eine volle Szenenpassage fuer
 * ein Bild, in dem sich nichts aendert. Draussen ist genau das GEMESSEN
 * worden (Rotkanal 0 ueber 400x225, Analyse „Licht und Farbe" C2); innen ist
 * die Bauart dieselbe.
 *
 * Das Mittel dagegen liegt fertig daneben: `StrahlenAnker` (dort steht die
 * ganze Begruendung) — eigenes Mesh, `ShaderMaterial` ueber
 * `setMaterialForRenderPass`, aus dem Farbbild heraus ueber `layerMask = 0`,
 * in die Verdeckung hinein ueber `getCustomRenderList`. Draussen ist es seit
 * F3 eingebaut und gemessen (Rotkanal 0 -> 255).
 *
 * ── Warum es hier TROTZDEM nicht eingebaut ist (F3, 12.09.2026) ───────
 * Es ist erprobt worden und hat funktioniert — und genau das war das
 * Ergebnis: Mit einem 3-m-Anker an der Muendung (etwas weniger als eine
 * Zelle) fuellte die weisse Quelle **17,8 %** des Verdeckungspuffers
 * (16.044 von 90.000 Bildpunkten, GEMESSEN in einem frisch erzeugten
 * 2.0-Steingrab), und der radiale Blur machte daraus eine ausgebrannte
 * weisse Flaeche ueber dem halben Bild. Draussen sind es 0,13 %.
 *
 * Der Grund ist nicht der Anker, sondern die Eichung: `BELICHTUNG`,
 * `GEWICHT` und `DICHTE` unten sind woertlich von der Sonne uebernommen
 * und danach nie an einem Bild geprueft worden — sie KONNTEN es nicht
 * sein, denn der Puffer war immer schwarz. Eine Quelle, die aus 3 m
 * Entfernung einen ganzen Zellendurchmesser einnimmt, braucht andere
 * Zahlen als eine, die 1400 m weit weg 4° misst. Die gehoeren in eine
 * Dungeon-Messung mit einem Zielband, nicht in eine Aussenmessung und
 * erst recht nicht ins Augenmass.
 *
 * Bis dahin bleibt es hier bei dem, was ohne Zielband belegbar ist: der
 * Komposit-Shader ohne den 10-%-Konstantterm (die Korrektur ist global und
 * greift auch fuer diesen Pass — ein angehaengter Dungeon-Godray hat das
 * Grab bisher um 10 % aufgehellt, ohne einen einzigen Strahl zu zeigen).
 * Der Effekt zeigt damit weiter nichts; er luegt aber auch nicht mehr.
 *
 * Correction (A1): `RenderTargetTexture.dispose()` removes itself from every
 * camera in 8.56.2, so the manual splice below is idempotence, not a leak fix.
 * The anchor fix from F3 is deliberately NOT wired up here: it works (measured),
 * but at 3 m the source covers 17.8 % of the occlusion buffer against 0.13 %
 * outdoors, and the exposure/weight/density below were copied from the sun and
 * never checked against a picture. That calibration needs its own barrow
 * measurement.
 */
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { korrigiereStrahlenKomposit } from './StrahlenAnker';
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
      // Vor der ersten Uebersetzung des Komposit-Shaders (s. Kopf): sonst
      // ist ein angehaengter Pass ein 10-%-Aufheller auf dem ganzen Bild.
      korrigiereStrahlenKomposit();
      const vls = new VolumetricLightScatteringPostProcess(
        'dungeon2Godrays',
        // WICHTIG: getrennte Verhaeltnisse. Eine EINZELNE Zahl setzt Babylon auf
        // BEIDE — auch den finalen Composite —, und weil dieser Effekt kein
        // Filter, sondern eine eigene Szenenpassage ist (Kopfkommentar), lief
        // damit das ganze Bild auf Stufe Hoch in Viertel-Aufloesung und wurde
        // hochskaliert (pixelig). `passRatio` haelt die billige Verdeckung klein,
        // `postProcessRatio: 1` haelt das sichtbare Bild scharf.
        // IMPORTANT: separate ratios. A SINGLE number sets BOTH — including the
        // final composite — and since this effect is a scene pass, not a filter,
        // that rendered the whole High-tier image at quarter resolution
        // (pixelated). passRatio keeps the cheap occlusion small; postProcessRatio
        // of 1 keeps the visible image sharp.
        { passRatio: VERHAELTNIS, postProcessRatio: 1 },
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
