/**
 * Was steht gerade unter dem Fadenkreuz?
 *
 * Das Original färbt sein Fadenkreuz gelb, sobald das anvisierte Objekt
 * einen Namen hat (`Hud.UpdateCrosshair`: `m_crosshair.color =
 * m_hoverName.text.Length > 0 ? Color.yellow : s_whiteHalfAlpha`). Den
 * Namen liefert dort `Player.FindHoverObject` per Strahl aus der Kamera,
 * begrenzt auf `m_maxInteractDistance = 5` Meter.
 *
 * ── Warum kein Strahl ────────────────────────────────────────────────
 * `scene.pickWithRay` liefe hier ins Leere: Die gespawnten Objekte stehen
 * durchweg auf `isPickable = false` (AssetManager, EntityManager), weil
 * sie als Instanzen gezeichnet werden und die Auswahl bisher niemand
 * brauchte. Sie dafür pickbar zu machen hiesse, für Tausende Instanzen
 * Kollisionsabfragen zuzulassen — teuer für eine reine Einfärbung.
 *
 * Stattdessen wird gerechnet: Der EntityManager kennt Position und Prefab
 * jeder Instanz. Deren Weltposition wird wie bei den Namensschildern auf
 * den Bildschirm projiziert; wer dem Fadenkreuz am nächsten liegt und in
 * Reichweite steht, ist das anvisierte Objekt. Das beantwortet genau die
 * gestellte Frage — was liegt unter der Bildmitte — und kostet nur die
 * Projektion der wenigen Objekte im Umkreis.
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { EntityManager, StatischeInstanz } from '../entities/EntityManager';

/**
 * Reichweite in Metern, gemessen vom Spieler. Aus dem Original:
 * `Player.m_maxInteractDistance = 5`.
 */
const REICHWEITE = 5;
/**
 * Wie nah die Bildschirmlage eines Objekts am Fadenkreuz liegen muss (px,
 * bezogen auf 1080 Bildhöhe und mit der tatsächlichen Höhe skaliert).
 *
 * Grosszügig gewählt, weil hier Objekt-MITTELPUNKTE verglichen werden und
 * kein Umriss: Ein Baumstamm füllt aus zwei Metern das halbe Bild, sein
 * Ursprung liegt dabei weit vom Fadenkreuz entfernt.
 */
const ZIEL_RADIUS = 90;
/**
 * Zweiter Prüfpunkt über dem Objektursprung (m).
 *
 * Der Ursprung eines Prefabs sitzt auf seiner Standfläche (siehe
 * Physics.ts). Bei einem Baum zielt man aber auf den Stamm, nicht auf den
 * Wurzelpunkt. Geprüft werden deshalb beide Punkte, und es zählt der
 * nähere — so werden flache Objekte wie ein Pilz genauso erfasst wie hohe.
 */
const ZIEL_HOEHE = 1.2;

/**
 * Abstand zweier Abfragen in Millisekunden — 80 ms, also 12,5 Hz.
 *
 * ── Warum überhaupt drosseln ─────────────────────────────────────────
 * Der Prefabname unter dem Fadenkreuz ist eine ANZEIGE, kein Spielzustand:
 * Nichts hängt davon ab, ob er einen Frame früher oder später steht. Ihn
 * mit 60 Hz zu bestimmen heisst, sechzigmal pro Sekunde den Umkreis zu
 * holen und jede Instanz darin zweimal zu projizieren — für einen Text,
 * der sich meistens gar nicht ändert.
 *
 * ── Warum 80 ms und nicht mehr ───────────────────────────────────────
 * 80 ms liegt unterhalb der Schwelle, ab der eine Anzeige als „hängt
 * nach" auffällt (rund 100 ms), und deckt sich mit dem Sync-Takt der
 * Netzwerkschleife (50 ms), an dem sich die Welt ohnehin nur ruckweise
 * ändert. Beim Sprinten (RUN_SPEED 7,5 m/s) legt der Spieler in dieser
 * Zeit 0,6 m zurück — deutlich weniger als der Zielradius von 90 px, und
 * die Reichweite beträgt 5 m. Das Fadenkreuz kann also nicht „vorbei"
 * sein, bevor die nächste Abfrage läuft.
 *
 * Der teure Teil, die Umkreissuche, ist seit D3 indiziert; die Drosselung
 * spart trotzdem, weil sie auch die Projektionen und den Aufruf selbst
 * einspart — und weil beides zusammen billiger ist als eines allein.
 */
const ABFRAGE_INTERVALL_MS = 80;

/**
 * Wiederverwendete Rechenhilfen — `finde()` läuft im Frame-Takt, und
 * `Matrix.Identity()`, `Vector3.Project()` und `Viewport.toGlobal()` legen
 * jeweils ein frisches Objekt an. Die Weltmatrix ist hier immer die
 * Einheitsmatrix (die Positionen sind bereits Weltkoordinaten), also darf
 * sie eine einzige, nie beschriebene Konstante sein.
 */
const EINHEIT = Matrix.Identity();

export class Anvisiert {
  private readonly punkt = new Vector3();
  private readonly projiziert = new Vector3();
  private readonly viewport = new Viewport(0, 0, 0, 0);
  /** Ergebnis und Zeitpunkt der letzten Abfrage — s. ABFRAGE_INTERVALL_MS. */
  private letzteZeit = Number.NEGATIVE_INFINITY;
  private letztesErgebnis: string | null = null;
  /** Ergebnisliste der Umkreissuche, gehalten statt pro Abfrage neu. */
  private readonly umkreis: StatischeInstanz[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly entities: () => EntityManager | null
  ) {}

  /**
   * Prefabname des anvisierten Objekts, oder null.
   *
   * @param px,pz Spielerposition — Bezug für die Reichweite. Bewusst nicht
   *              die Kameraposition: Gemeint ist, was der SPIELER erreichen
   *              könnte, und die Kamera steht mehrere Meter hinter ihm.
   */
  finde(px: number, pz: number): string | null {
    const jetzt = performance.now();
    if (jetzt - this.letzteZeit < ABFRAGE_INTERVALL_MS) return this.letztesErgebnis;
    this.letzteZeit = jetzt;

    const mgr = this.entities();
    if (!mgr) return (this.letztesErgebnis = null);
    // In die gehaltene Liste schreiben lassen — sie enthält die internen
    // Indexeinträge des EntityManagers und wird hier nur gelesen.
    const items = mgr.nearbyInstances(px, pz, REICHWEITE, this.umkreis);
    if (!items.length) return (this.letztesErgebnis = null);

    const engine = this.scene.getEngine();
    const breite = engine.getRenderWidth();
    const hoehe = engine.getRenderHeight();
    const view = this.scene.getTransformMatrix();
    // ACHTUNG: toGlobalToRef liefert `this` zurück, nicht das Ziel — der
    // gerechnete Wert steht ausschliesslich in `this.viewport`.
    this.camera.viewport.toGlobalToRef(breite, hoehe, this.viewport);
    const vp = this.viewport;
    const mx = breite / 2;
    const my = hoehe / 2;
    // Radius an die tatsächliche Auflösung anpassen, sonst zielt es in
    // einem kleinen Fenster viel grosszügiger als in einem grossen.
    const grenze = ZIEL_RADIUS * (hoehe / 1080);

    let bester: string | null = null;
    let bestesMass = grenze * grenze;
    const punkt = this.punkt;
    const p = this.projiziert;
    for (const it of items) {
      // Beide Prüfpunkte ausgeschrieben statt `for (const dy of [0, …])`:
      // Das Array-Literal entstünde je Instanz neu.
      for (let k = 0; k < 2; k++) {
        punkt.set(it.x, it.y + (k === 0 ? 0 : ZIEL_HOEHE), it.z);
        Vector3.ProjectToRef(punkt, EINHEIT, view, vp, p);
        // z ausserhalb 0..1 heisst hinter der Kamera — sonst käme ein
        // Objekt im Rücken als Ziel heraus, weil die Projektion dort
        // gespiegelt in der Bildmitte landet.
        if (p.z < 0 || p.z > 1) continue;
        const d2 = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d2 < bestesMass) {
          bestesMass = d2;
          bester = it.prefab;
        }
      }
    }
    return (this.letztesErgebnis = bester);
  }
}
