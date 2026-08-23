/**
 * Die Figurenvorschau in der Charaktererstellung — eine eigene kleine
 * Babylon-Szene neben dem Anmeldepanel.
 *
 * Sie lädt den Körper EINMAL, spielt seinen Ruhezyklus und tauscht
 * Frisur und Rüstung durch Nachladen einzelner Dateien.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum eine eigene Szene und nicht die Spielszene
 * ════════════════════════════════════════════════════════════════════
 * Weil es die Spielszene beim Anmelden noch nicht gibt: Welt, Terrain
 * und Netzwerk hängen an Angaben, die der Spieler in genau diesem
 * Bildschirm erst macht. Eine eigene Szene auf einem eigenen Canvas
 * lebt und stirbt mit dem Panel und lässt sich beim Betreten der Welt
 * vollständig freigeben.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum das Nachladen funktioniert: eine Gelenkliste für alle
 * ════════════════════════════════════════════════════════════════════
 * Ein nachgeladenes Haarteil bringt sein EIGENES Skelett mit. Benutzt
 * würde damit ein zweites, das niemand animiert — die Frisur bliebe in
 * der Bindepose stehen, während der Körper atmet.
 *
 * Deshalb wird jedem nachgeladenen Netz das Skelett des KÖRPERS
 * zugewiesen und sein eigenes verworfen. Das ist nur zulässig, wenn die
 * Knochenindizes in beiden Dateien dasselbe bedeuten — und genau das
 * stellt tools/asset-aufteilen.py sicher: Es exportiert alle Teile aus
 * derselben Armatur und prüft am Ende nach, dass jede Datei dieselbe
 * Gelenkliste trägt (51 Knochen, Index für Index). Weicht eine ab,
 * bricht das Werkzeug ab, statt eine Frisur auszuliefern, die im Spiel
 * am Fussgelenk hängt.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum Geladenes liegen bleibt
 * ════════════════════════════════════════════════════════════════════
 * Wer durch die Frisuren blättert, sieht jede mehrfach. Einmal Geladenes
 * wird deshalb nur ausgeblendet, nicht freigegeben — Zurückschalten ist
 * dann sofort, statt erneut 0,5 MB zu holen.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Color4 } from '@babylonjs/core/Maths/math';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/loaders/glTF';

import { AUSSEHEN_KOERPER, teilPfad } from '@wov/shared';

const WURZEL = '/assets/models/';

/** Ein nachgeladenes Teil mitsamt allem, was zu ihm gehört. */
interface Teil {
  netze: AbstractMesh[];
  /** Das eigene Skelett der Teildatei — wird nicht benutzt, nur verwahrt. */
  eigenes: Skeleton | null;
}

export class CharakterVorschau {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private skelett: Skeleton | null = null;
  private ruhe: AnimationGroup | null = null;
  /** Bereits geladene Teile, nach Dateiname. Siehe Kopfkommentar. */
  private readonly geladen = new Map<string, Teil>();
  private aktuell = new Map<string, string>();   // Slot → Dateiname
  private zerstoert = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.09, 0.10, 0.12, 1);

    // Blick auf Kopf und Oberkörper: Die Figur ist 1,0 hoch mit den
    // Füssen im Ursprung, der Kopf sitzt also bei rund 0,9.
    const kamera = new ArcRotateCamera(
      'vorschau', Math.PI / 2, Math.PI / 2.35, 1.35,
      new Vector3(0, 0.72, 0), this.scene);
    kamera.lowerRadiusLimit = 0.6;
    kamera.upperRadiusLimit = 3.0;
    kamera.lowerBetaLimit = 0.6;
    kamera.upperBetaLimit = Math.PI / 1.9;
    kamera.wheelDeltaPercentage = 0.02;
    kamera.attachControl(canvas, true);

    new HemisphericLight('himmel', new Vector3(0, 1, 0), this.scene).intensity = 0.75;
    const sonne = new DirectionalLight('sonne', new Vector3(-0.4, -0.8, 0.5), this.scene);
    sonne.intensity = 1.6;

    this.engine.runRenderLoop(() => {
      if (!this.zerstoert) this.scene.render();
    });

    // Pruefzugang, NUR im Entwicklungsmodus: Der Client bindet Babylon
    // als ES-Modul ein und legt nichts global ab — von aussen ist die
    // Szene sonst nicht zu befragen, und ein Fehler im Skelettabgleich
    // waere nur am Bild zu erkennen. Vite entfernt den Zweig im Build.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__vorschau = this;
    }
    window.addEventListener('resize', this.beiGroesse);
  }

  private beiGroesse = () => this.engine.resize();

  /** Körper laden und den Ruhezyklus starten. */
  async ladeKoerper(): Promise<void> {
    const res = await SceneLoader.ImportMeshAsync(
      '', WURZEL, teilPfad(AUSSEHEN_KOERPER), this.scene);
    this.skelett = res.skeletons[0] ?? null;

    // Ruhezyklus über denselben Namensabgleich wie AvatarRig — nicht
    // "der erste Clip", denn die Reihenfolge im glTF ist alphabetisch
    // und begänne bei "angriff".
    for (const g of res.animationGroups) g.stop();
    this.ruhe = res.animationGroups.find((g) => /idle|ruhe|stand/i.test(g.name))
      ?? res.animationGroups[0] ?? null;
    this.ruhe?.start(true);
  }

  /**
   * Ein Teil in einen Slot setzen. `null` räumt den Slot.
   * Mehrfaches Setzen desselben Teils ist ein Nichts-Tun.
   */
  async setze(slot: string, datei: string | null): Promise<void> {
    if (this.aktuell.get(slot) === (datei ?? '')) return;

    const vorher = this.aktuell.get(slot);
    if (vorher) this.zeige(vorher, false);
    this.aktuell.set(slot, datei ?? '');
    if (!datei) return;

    if (!this.geladen.has(datei)) {
      const res = await SceneLoader.ImportMeshAsync(
        '', WURZEL, teilPfad(datei), this.scene);
      const netze = res.meshes.filter((m) => m.getTotalVertices() > 0);
      for (const m of netze) {
        // Das Skelett des KÖRPERS aufziehen, nicht das mitgelieferte.
        if (this.skelett) m.skeleton = this.skelett;
      }
      // Das eigene Skelett bleibt ungenutzt liegen; freigeben würde die
      // Netze mitreissen, die noch auf seine Bindematrizen zeigen.
      this.geladen.set(datei, { netze, eigenes: res.skeletons[0] ?? null });
    }
    this.zeige(datei, true);
  }

  private zeige(datei: string, sichtbar: boolean): void {
    const teil = this.geladen.get(datei);
    if (!teil) return;
    for (const m of teil.netze) m.setEnabled(sichtbar);
  }

  /** Blickrichtung zurücksetzen — für den Knopf neben der Vorschau. */
  blickZurueck(): void {
    const k = this.scene.activeCamera as ArcRotateCamera | null;
    if (k) { k.alpha = Math.PI / 2; k.beta = Math.PI / 2.35; k.radius = 1.35; }
  }

  /** Nur fuer den Pruefzugang im Entwicklungsmodus. */
  bericht(): unknown {
    const netze = this.scene.meshes.filter((m) => m.getTotalVertices() > 0);
    return {
      skelette: this.scene.skeletons.length,
      knochen: this.skelett?.bones.length ?? null,
      ruheclip: this.ruhe ? { name: this.ruhe.name, laeuft: this.ruhe.isPlaying } : null,
      slots: Object.fromEntries(this.aktuell),
      geladen: [...this.geladen.keys()],
      netze: netze.map((m) => ({
        name: m.name,
        sichtbar: m.isEnabled(),
        verts: m.getTotalVertices(),
        koerperskelett: m.skeleton === this.skelett,
      })),
    };
  }

  dispose(): void {
    this.zerstoert = true;
    window.removeEventListener('resize', this.beiGroesse);
    this.scene.dispose();
    this.engine.dispose();
  }
}
