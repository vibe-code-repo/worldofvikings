/**
 * Namensschilder über den gespawnten Objekten (Einstellung
 * "Objektnamen anzeigen").
 *
 * Diagnosewerkzeug, kein Spielelement: Steht irgendwo etwas Unerwartetes,
 * ist die einzige Frage, die weiterhilft, wie das Prefab heisst — damit
 * lässt es sich in prefabData.json und in der Vegetationsliste
 * nachschlagen.
 *
 * ── Warum DOM statt 3D-Text ──────────────────────────────────────────
 * Beschriftungen als Meshes bräuchten eine Schriftatlas-Textur und würden
 * mit der Vegetation zusammen sortiert werden müssen. Ein paar Dutzend
 * absolut positionierte <div>s sind billiger, immer lesbar (nie von einem
 * Baum verdeckt) und ohne Assets zu haben. Die Weltposition wird pro Frame
 * über die Kameramatrix auf den Bildschirm projiziert.
 *
 * Gezeigt wird nur, was NAH und VOR der Kamera ist, und höchstens
 * MAX_LABELS Stück — sonst überdeckt der Wald sich selbst.
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { EntityManager, StatischeInstanz } from '../entities/EntityManager';
import { UI } from './theme';

/** Umkreis um den Spieler, in dem Namen erscheinen. */
const RANGE = 40;
/** Mehr als das wird nie gleichzeitig gezeigt (Nächste zuerst). */
const MAX_LABELS = 60;
/** Sammelabstand: Instanzen desselben Prefabs dichter beieinander teilen
 *  sich ein Schild, sonst steht ein Grasbüschel-Feld als Buchstabenbrei da. */
const CLUSTER = 3.0;

/**
 * Weltmatrix der Projektion — hier immer die Einheitsmatrix, weil die
 * Positionen schon Weltkoordinaten sind. Eine Konstante statt
 * `Matrix.Identity()` je Schild: Die Fabrikmethode legt jedes Mal eine
 * neue Matrix an, und das lief hier pro Frame einmal je Sammelpunkt.
 */
const EINHEIT = Matrix.Identity();

interface Slot {
  el: HTMLDivElement;
  used: boolean;
}

export class ObjectLabels {
  private readonly root: HTMLDivElement;
  private readonly slots: Slot[] = [];
  private enabled = false;
  /** Gehaltene Rechenhilfen — update() läuft im Frame-Takt. */
  private readonly welt = new Vector3();
  private readonly projiziert = new Vector3();
  private readonly viewport = new Viewport(0, 0, 0, 0);
  private readonly umkreis: StatischeInstanz[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly entities: () => EntityManager | null
  ) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:100%', 'height:100%',
      'pointer-events:none', 'z-index:940', 'display:none',
      `font-family:${UI.font}`,
    ].join(';');
    document.body.appendChild(root);
    this.root = root;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.root.style.display = on ? 'block' : 'none';
    if (!on) for (const s of this.slots) s.el.style.display = 'none';
  }

  private slot(i: number): Slot {
    let s = this.slots[i];
    if (!s) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute', 'transform:translate(-50%,-100%)',
        'padding:1px 5px', 'border-radius:3px', 'white-space:nowrap',
        'background:rgba(20,16,12,.72)', 'border:1px solid rgba(190,160,110,.35)',
        `color:${UI.gold}`, 'font-size:11px', 'text-shadow:0 1px 2px #000',
      ].join(';');
      this.root.appendChild(el);
      s = { el, used: false };
      this.slots[i] = s;
    }
    return s;
  }

  /** Einmal pro Frame mit der Spielerposition aufrufen. */
  update(px: number, pz: number): void {
    if (!this.enabled) return;
    const mgr = this.entities();
    if (!mgr) return;

    const items = mgr.nearbyInstances(px, pz, RANGE, this.umkreis);

    // Nach Prefab und grobem Raster zusammenfassen: viele gleiche Objekte
    // dicht beieinander ergeben ein Schild statt fünfzig.
    const cluster = new Map<string, { prefab: string; x: number; y: number; z: number; n: number }>();
    for (const it of items) {
      const key = `${it.prefab}|${Math.round(it.x / CLUSTER)}|${Math.round(it.z / CLUSTER)}`;
      const c = cluster.get(key);
      if (c) c.n++;
      // Felder EINZELN übernehmen, nicht `{ ...it }`: `it` ist der interne
      // Indexeintrag des EntityManagers (s. StatischeInstanz) und trägt
      // dessen Verwaltungsfelder mit. Kopiert würden sie nutzlos mitgeführt,
      // und ein Objekt, das nach einem Indexeintrag aussieht, lädt dazu ein,
      // es später fälschlich zurückzuschreiben.
      else cluster.set(key, { prefab: it.prefab, x: it.x, y: it.y, z: it.z, n: 1 });
    }

    const view = this.scene.getTransformMatrix();
    // ACHTUNG: toGlobalToRef liefert `this` zurück, nicht das Ziel — der
    // gerechnete Wert steht ausschliesslich in `this.viewport`.
    this.camera.viewport.toGlobalToRef(
      this.scene.getEngine().getRenderWidth(),
      this.scene.getEngine().getRenderHeight(),
      this.viewport
    );
    const vp = this.viewport;

    const sichtbar: Array<{ text: string; sx: number; sy: number; d: number }> = [];
    const welt = this.welt;
    const p = this.projiziert;
    for (const c of cluster.values()) {
      // Schild etwas über den Ursprung setzen, damit es nicht im Boden klebt.
      welt.set(c.x, c.y + 1.2, c.z);
      Vector3.ProjectToRef(welt, EINHEIT, view, vp, p);
      // z ausserhalb 0..1 heisst hinter der Kamera oder jenseits der Far-Plane.
      if (p.z < 0 || p.z > 1) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      sichtbar.push({ text: c.n > 1 ? `${c.prefab} ×${c.n}` : c.prefab, sx: p.x, sy: p.y, d });
    }

    sichtbar.sort((a, b) => a.d - b.d);
    // Obergrenze beim Durchlaufen statt `slice(0, MAX_LABELS)` — das legte
    // pro Frame ein zweites Array an, nur um hinten etwas abzuschneiden.
    const anzahl = Math.min(sichtbar.length, MAX_LABELS);

    for (let i = 0; i < anzahl; i++) {
      const s = this.slot(i);
      const z = sichtbar[i]!;
      s.el.textContent = z.text;
      s.el.style.left = `${z.sx}px`;
      s.el.style.top = `${z.sy}px`;
      // Entferntes blasser, damit die Nahen lesbar bleiben.
      s.el.style.opacity = String(Math.max(0.35, 1 - z.d / RANGE));
      s.el.style.display = 'block';
    }
    for (let i = anzahl; i < this.slots.length; i++) {
      this.slots[i]!.el.style.display = 'none';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
