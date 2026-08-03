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
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { EntityManager } from '../entities/EntityManager';

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

export class Anvisiert {
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
    const mgr = this.entities();
    if (!mgr) return null;
    const items = mgr.nearbyInstances(px, pz, REICHWEITE);
    if (!items.length) return null;

    const engine = this.scene.getEngine();
    const breite = engine.getRenderWidth();
    const hoehe = engine.getRenderHeight();
    const view = this.scene.getTransformMatrix();
    const vp = this.camera.viewport.toGlobal(breite, hoehe);
    const mx = breite / 2;
    const my = hoehe / 2;
    // Radius an die tatsächliche Auflösung anpassen, sonst zielt es in
    // einem kleinen Fenster viel grosszügiger als in einem grossen.
    const grenze = ZIEL_RADIUS * (hoehe / 1080);

    let bester: string | null = null;
    let bestesMass = grenze * grenze;
    const punkt = new Vector3();
    for (const it of items) {
      for (const dy of [0, ZIEL_HOEHE]) {
        punkt.set(it.x, it.y + dy, it.z);
        const p = Vector3.Project(punkt, Matrix.Identity(), view, vp);
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
    return bester;
  }
}
