/**
 * Build mode: aiming, the ghost marker and triggering terrain operations.
 *
 * C# reference: Player.UpdatePlacement / UpdatePlacementGhost / PieceRayTest /
 * TryPlacePiece, plus Attack.SpawnOnHitTerrain for the pickaxe.
 *
 * Two input paths, exactly as in the original:
 *
 *   Hoe / Cultivator          m_buildPieces is set -> build mode
 *     RMB   toggles the mode menu
 *     LMB   applies the selected piece's terrain op (0.4 s cooldown)
 *     Shift target height falls back to the raycast hit (levelground only)
 *
 *   Pickaxe                   m_buildPieces is 0 -> plain attack
 *     LMB   applies m_spawnOnHitTerrain directly, no ghost, no menu
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import {
  PIECES,
  TERRAIN_HIT_OPS,
  opRadius,
  piecesFor,
  type PieceDef,
  type TerrainOpSettings,
} from '@wov/shared';
import type { InputManager } from '../engine/InputManager';
import type { TerrainManager } from '../engine/Terrain';
import type { GrassClutter } from '../engine/GrassClutter';
import type { ClientWorld } from '../world/World';
import type { PlayerController } from './PlayerController';
import type { Equipment } from './Equipment';

/** C# Player.m_maxPlaceDistance. */
const MAX_PLACE_DISTANCE = 5;
/**
 * Wheel-adjustable brush size — not in the original, where every piece has a
 * fixed radius. Multiplies all radii of the operation (level/raise/smooth and
 * the paint), capped so a single stroke cannot run away: the operation loops
 * over ±ceil(radius) vertices per zone, and the paint mask is re-uploaded for
 * every zone it touches.
 */
/**
 * Steps get finer towards the small end: below 1× the wheel moves in 0.1
 * instead of 0.25, so touching up a single spot stays controllable. The
 * smallest brush is 0.2× — with the hoe's 2 m level radius that is 0.4 m,
 * about one terrain vertex.
 */
const SCALE_MIN = 0.2;
const SCALE_MAX = 4;
const SCALE_STEP = 0.25;
const SCALE_STEP_FINE = 0.1;
/** Below this the fine step applies. */
const FINE_BELOW = 1;
/** Hard ceiling in metres, whatever the multiplier works out to. */
const RADIUS_CAP = 12;
/** C# Player.m_placeDelay. */
const PLACE_DELAY = 0.4;
/**
 * Ray length. C# PieceRayTest casts 50 m and only then checks the distance
 * against m_maxPlaceDistance — it must not stop at the reach, because the ray
 * starts at the CAMERA, which sits on a 4.5 m third-person boom behind the
 * player. A ray capped at the reach never even gets down to the ground.
 */
const RAY_MAX = 50;
/** Ray-march step; refined by bisection afterwards. */
const RAY_STEP = 0.25;
const RAY_REFINE = 8;

const VALID = new Color3(0.85, 0.95, 0.75);
const INVALID = new Color3(0.95, 0.25, 0.2);

/** Ride height of the ring above the target point, in metres. */
const MARKER_HOVER = 0.35;
/** Bob amplitude and speed — slow and calm, not a blink. */
const MARKER_BOB_AMP = 0.06;
const MARKER_BOB_SPEED = 2.2;
/** Radians per second the ring turns around its vertical. */
const MARKER_SPIN_SPEED = 0.6;

export interface PlacementHit {
  x: number;
  y: number;
  z: number;
}

export class PlacementController {
  /** Selected piece per tool — C# PieceTable.m_selectedPiece (per category). */
  private readonly selected = new Map<string, string>();
  /** Brush-size multiplier per piece, kept while the tool stays equipped. */
  private readonly radiusScale = new Map<string, number>();
  private marker: Mesh | null = null;
  private markerRadius = -1;
  private readonly markerMaterial: StandardMaterial;
  private lastUse = -Infinity;
  private lastHit: PlacementHit | null = null;
  private lastValid = false;
  /** Set by the piece-selection UI while it is open. */
  menuOpen = false;
  // ── Hammer-Bausystem ────────────────────────────────────────────
  /** Ghost-Vorschau des Bau-Prefabs (halbtransparente GLB-Instanz). */
  private bauGhost: import('@babylonjs/core/Meshes/transformNode').TransformNode | null = null;
  private bauGhostPrefab = '';
  /** Bau-Rotation in 45°-Schritten (Mausrad im Baumodus). */
  private bauYawGrad = 0;
  /** Online-Versand (main.ts) — Rueckgabe true = gesendet. */
  sendePiece: ((prefab: string, x: number, y: number, z: number, yawGrad: number) => boolean) | null = null;
  sendeAbriss: ((x: number, y: number, z: number) => boolean) | null = null;
  /** Materialpruefung/-abzug (Client-Inventar). */
  inventar: (() => import('@wov/shared').Inventory | null) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly scene: Scene,
    private readonly input: InputManager,
    private readonly world: ClientWorld,
    private readonly terrain: TerrainManager,
    private readonly grass: GrassClutter,
    private readonly player: PlayerController,
    private readonly equipment: Equipment
  ) {
    const mat = new StandardMaterial('placementMarker', scene);
    mat.disableLighting = true;
    mat.emissiveColor = VALID;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    this.markerMaterial = mat;

    // Switching tools resets the marker; the new tool has a different radius.
    this.equipment.onChanged(() => {
      this.menuOpen = false;
      this.emit();
    });
  }

  /** Current aim point, for probes and the HUD. Null when out of reach. */
  get lastHitDebug(): PlacementHit | null {
    return this.lastHit;
  }

  onChanged(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Modes of the equipped tool, empty when not in build mode. */
  get pieces(): PieceDef[] {
    const table = this.equipment.pieceTable;
    return table ? piecesFor(table) : [];
  }

  get selectedPiece(): PieceDef | null {
    const table = this.equipment.pieceTable;
    if (!table) return null;
    const list = piecesFor(table);
    if (list.length === 0) return null;
    const name = this.selected.get(table);
    return (name ? PIECES[name] : null) ?? list[0];
  }

  selectPiece(name: string): void {
    const table = this.equipment.pieceTable;
    if (!table) return;
    this.selected.set(table, name);
    this.emit();
  }

  /** Brush-size multiplier of the selected piece (1 = original radius). */
  get radiusFactor(): number {
    const piece = this.selectedPiece;
    return piece ? (this.radiusScale.get(piece.name) ?? 1) : 1;
  }

  /** Effective radius in metres, for the HUD and for clearing grass. */
  get effectiveRadius(): number {
    const piece = this.selectedPiece;
    return piece ? opRadius(this.scaledOp(piece.terrainOp)) : 0;
  }

  /** Wheel outside the menu — grow or shrink the brush. */
  scaleRadius(dir: number): void {
    const piece = this.selectedPiece;
    if (!piece) return;
    const now = this.radiusScale.get(piece.name) ?? 1;
    // Shrinking below 1× (or growing back out of it) uses the fine step.
    const fine = dir < 0 ? now <= FINE_BELOW : now < FINE_BELOW;
    const step = fine ? SCALE_STEP_FINE : SCALE_STEP;
    const raw = now + dir * step;
    // Rounded to the step, otherwise the two step sizes drift into values like
    // 0.9999 that never land back on a clean 1×.
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(raw / step) * step));
    if (Math.abs(next - now) < 1e-6) return;
    this.radiusScale.set(piece.name, next);
    this.emit();
  }

  /**
   * The piece's operation with every radius scaled by the wheel factor. The
   * flags stay untouched — a radius only counts when its operation is enabled
   * (see opRadius), so scaling the unused ones is harmless.
   */
  private scaledOp(settings: TerrainOpSettings): TerrainOpSettings {
    const piece = this.selectedPiece;
    const f = piece ? (this.radiusScale.get(piece.name) ?? 1) : 1;
    if (f === 1) return settings;
    const cap = (r: number): number => Math.min(RADIUS_CAP, r * f);
    return {
      ...settings,
      levelRadius: cap(settings.levelRadius),
      raiseRadius: cap(settings.raiseRadius),
      smoothRadius: cap(settings.smoothRadius),
      paintRadius: cap(settings.paintRadius),
    };
  }

  /**
   * Open or close the mode menu (Tab). Returns whether the game should hold the
   * pointer afterwards — while the menu is up the cursor has to be free, so the
   * tiles can simply be clicked.
   */
  toggleMenu(): boolean {
    if (this.pieces.length === 0) return true; // no tool with modes: nothing to show
    this.menuOpen = !this.menuOpen;
    this.emit();
    return !this.menuOpen;
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.emit();
  }

  /**
   * Step through the modes of the held tool — the wheel while the menu is open,
   * as an alternative to clicking a tile. Wraps around, and the pick stays
   * selected after the menu closes.
   */
  cyclePiece(dir: number): void {
    const list = this.pieces;
    if (list.length === 0) return;
    const current = this.selectedPiece;
    const at = current ? list.findIndex((p) => p.name === current.name) : 0;
    const next = (((at < 0 ? 0 : at) + dir) % list.length + list.length) % list.length;
    this.selectPiece(list[next].name);
  }

  update(dt: number): void {
    const now = performance.now() / 1000;
    const piece = this.selectedPiece;

    // Aim whenever a terrain tool is held. Only build mode draws a ghost —
    // the pickaxe swings without one, like in the original.
    const holdsTool = piece !== null || this.equipment.rightItem?.shared.spawnOnHitTerrain != null;
    this.lastHit = holdsTool ? this.rayTest() : null;
    if (piece?.bauPrefab) {
      this.hideMarker();
      this.updateBauGhost(piece);
    } else {
      this.zeigeBauGhost(null);
      if (piece) this.updateMarker(piece);
      else this.hideMarker();
    }

    // The menu is opened and closed with Tab (see main.ts), not with the right
    // mouse button as in the original: a right click is the browser's own
    // context-menu gesture, and making it reliable across browsers cost more
    // than the key does. While the menu is up the cursor is free, so picking a
    // mode is a plain left click on a tile — placement stays blocked meanwhile,
    // exactly as C# UpdatePlacement does on Hud.IsPieceSelectionVisible.
    if (this.menuOpen) {
      // Keys 1-8 pick a mode (main.ts); the wheel does the same without leaving
      // the current grip, and a left click just confirms and closes. The mouse
      // stays captured throughout — no cursor is needed in here.
      const wheel = this.input.consumeWheel();
      if (wheel !== 0) this.cyclePiece(wheel > 0 ? 1 : -1);
      if (this.input.wasMousePressed(0)) this.closeMenu();
      return;
    }
    // Menu closed: the wheel sizes the brush — im Baumodus dreht es das
    // Teil in 45°-Schritten. Always consumed.
    const wheel = this.input.consumeWheel();
    if (wheel !== 0 && piece) {
      if (piece.bauPrefab) this.bauYawGrad = (this.bauYawGrad + (wheel > 0 ? 45 : -45) + 360) % 360;
      else this.scaleRadius(wheel > 0 ? -1 : 1);
    }

    // Hammer, mittlere Maustaste: eigenes Bauteil abreissen.
    if (this.equipment.pieceTable === 'Hammer' && this.input.wasMousePressed(1) && this.lastHit) {
      this.sendeAbriss?.(this.lastHit.x, this.lastHit.y, this.lastHit.z);
    }

    if (!this.input.wasMousePressed(0)) return;
    if (now - this.lastUse < PLACE_DELAY) return;

    if (piece?.bauPrefab) {
      if (!this.lastHit) return;
      this.baue(piece);
      this.lastUse = now;
      return;
    }
    if (piece) {
      if (!this.lastValid || !this.lastHit) return;
      this.apply(this.targetSettings(piece), this.lastHit);
      this.lastUse = now;
      return;
    }

    // Pickaxe path: the hit point itself drives the operation.
    const opName = this.equipment.rightItem?.shared.spawnOnHitTerrain;
    if (!opName) return;
    const settings = TERRAIN_HIT_OPS[opName];
    if (!settings || !this.lastHit) return;
    this.apply(settings, this.lastHit);
    this.lastUse = now;
  }

  /** Height rule from C# UpdatePlacementGhost (the m_allowAltGroundPlacement branch). */
  private targetSettings(piece: PieceDef): TerrainOpSettings {
    return this.scaledOp(piece.terrainOp);
  }

  private targetPoint(piece: PieceDef, hit: PlacementHit): PlacementHit {
    if (piece.allowAltGroundPlacement && !this.input.isDown('ShiftLeft')) {
      // Level to the ground under the player's feet, not to what the cursor
      // points at — this is what makes "flatten to my height" work.
      const { x, z } = this.player.position;
      return { x: hit.x, y: this.world.getGroundHeight(x, z), z: hit.z };
    }
    return hit;
  }

  /**
   * Online: Op zum Server schicken statt lokal anzuwenden — der Server ist
   * fuer den Boden autoritativ (Bewegungs-Clamp, Persistenz, Mitspieler)
   * und broadcastet die Op an alle zurueck, auch an uns. Offline wie bisher.
   * Rueckgabe true = gesendet (Aufrufer wendet nichts an).
   */
  sendeOp: ((x: number, y: number, z: number, settingsJson: string) => boolean) | null = null;

  private apply(settings: TerrainOpSettings, hit: PlacementHit): void {
    const piece = this.selectedPiece;
    const p = piece ? this.targetPoint(piece, hit) : hit;
    if (this.sendeOp?.(p.x, p.y, p.z, JSON.stringify(settings))) return;
    const effect = this.world.heightmaps.applyTerrainOp(p.x, p.y, p.z, settings);

    // Heights and paint are reported separately — painting a path moves no
    // vertices, so it must not trigger a mesh refresh.
    if (effect.heights.length > 0) this.terrain.refreshZones(effect.heights);
    for (const [zx, zy] of effect.paint) this.terrain.refreshPaint(zx, zy);

    // Grass goes away wherever the ground was touched — moved OR painted, so
    // a path clears it just like digging does (the hoe "removes ground cover"
    // in the original, and only the cultivator brings it back).
    //
    // Scoped to the operation's own radius, NOT to the zones it reports: a
    // zone is 64 m, and clearing per zone made a 2 m stroke visibly wipe and
    // regrow grass across the whole neighbourhood.
    if (effect.heights.length > 0 || effect.paint.length > 0) {
      this.grass.clearArea(p.x, p.z, opRadius(settings));
    }
  }

  /**
   * C# PieceRayTest, adapted: terrain meshes are isPickable = false (picking
   * them would need an octree per chunk), so this marches the camera ray
   * against the heightmap analytically instead.
   *
   * getGroundHeightRaycast is Möller-Trumbore against exactly the triangles
   * buildGridGeometry emits, so the hit sits on the rendered surface.
   */
  private rayTest(): PlacementHit | null {
    const cam = this.player.camera;
    const eye = cam.position;
    const dir = cam.getForwardRay().direction;

    let prevT = 0;
    let prevAbove = true;
    for (let t = RAY_STEP; t <= RAY_MAX; t += RAY_STEP) {
      const px = eye.x + dir.x * t;
      const py = eye.y + dir.y * t;
      const pz = eye.z + dir.z * t;
      const ground = this.world.heightmaps.getGroundHeightRaycast(px, pz);
      const above = py > ground;
      if (prevAbove && !above) {
        // Bisect between the last point above and this one below.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < RAY_REFINE; i++) {
          const mid = (lo + hi) / 2;
          const my = eye.y + dir.y * mid;
          const mg = this.world.heightmaps.getGroundHeightRaycast(
            eye.x + dir.x * mid,
            eye.z + dir.z * mid
          );
          if (my > mg) lo = mid;
          else hi = mid;
        }
        const hx = eye.x + dir.x * hi;
        const hz = eye.z + dir.z * hi;
        // Range is measured from the player, not the camera — the camera sits
        // on a 4.5 m boom behind them and would otherwise halve the reach.
        const dx = hx - this.player.position.x;
        const dz = hz - this.player.position.z;
        if (dx * dx + dz * dz > MAX_PLACE_DISTANCE * MAX_PLACE_DISTANCE) return null;
        return { x: hx, y: this.world.heightmaps.getGroundHeightRaycast(hx, hz), z: hz };
      }
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  private updateMarker(piece: PieceDef): void {
    const hit = this.lastHit;
    if (!hit) {
      this.hideMarker();
      this.lastValid = false;
      return;
    }

    // Scaled radius — the ring has to show what the wheel actually set, down
    // to the smallest brush (the old 0.5 m floor hid exactly that end of it).
    const radius = Math.max(0.15, opRadius(this.scaledOp(piece.terrainOp)));
    if (!this.marker || this.markerRadius !== radius) {
      this.marker?.dispose();
      this.marker = MeshBuilder.CreateTorus(
        'placementMarker',
        // Thickness follows the radius at the small end, otherwise the tiniest
        // brush renders as a filled disc rather than a ring.
        { diameter: radius * 2, thickness: Math.min(0.08, radius * 0.25), tessellation: 32 },
        this.scene
      );
      this.marker.material = this.markerMaterial;
      this.marker.isPickable = false;
      this.marker.alwaysSelectAsActiveMesh = true;
      this.markerRadius = radius;
    }

    const target = this.targetPoint(piece, hit);
    // Floats well clear of the surface: at 6 cm the ring disappeared into tall
    // grass. It hovers at MARKER_HOVER and bobs gently, which also makes the
    // marker readable while standing still — the same slow, calm motion the
    // original uses for its build ghost rather than a hard blink.
    const t = performance.now() / 1000;
    const bob = Math.sin(t * MARKER_BOB_SPEED) * MARKER_BOB_AMP;
    this.marker.position.set(target.x, target.y + MARKER_HOVER + bob, target.z);
    // Slow spin around the vertical, so the ring reads as a marker and not as
    // geometry lying on the ground.
    this.marker.rotation.y = t * MARKER_SPIN_SPEED;
    // Brightness breathes with the bob — subtle enough not to flicker.
    const puls = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(t * MARKER_BOB_SPEED));
    this.marker.setEnabled(true);

    // Digging is capped at 8 m below the generated height; past that the tool
    // does nothing, so say so instead of silently no-oping.
    const maxed = this.world.heightmaps.atMaxLevelDepth(target.x, target.z);
    this.lastValid = !maxed;
    const farbe = this.lastValid ? VALID : INVALID;
    this.markerMaterial.emissiveColor.set(farbe.r * puls, farbe.g * puls, farbe.b * puls);
  }

  private hideMarker(): void {
    this.marker?.setEnabled(false);
  }

  /** Raster-Snap: 0,5 m horizontal, 0,25 m vertikal — Teile fluchten so. */
  private static snap(v: number, raster: number): number {
    return Math.round(v / raster) * raster;
  }

  private async updateBauGhost(piece: PieceDef): Promise<void> {
    const prefab = piece.bauPrefab!;
    if (this.bauGhostPrefab !== prefab) {
      this.bauGhost?.dispose(false, true);
      this.bauGhost = null;
      this.bauGhostPrefab = prefab;
    }
    if (!this.bauGhost && this.ladeGhost) {
      // Ladevorgang nur einmal anstossen (ladeGhost cached im AssetManager).
      const ghost = await this.ladeGhost(prefab);
      if (ghost && this.bauGhostPrefab === prefab && !this.bauGhost) {
        for (const m of ghost.getChildMeshes()) {
          m.visibility = 0.45;
          m.isPickable = false;
        }
        this.bauGhost = ghost;
      } else {
        ghost?.dispose(false, true);
      }
    }
    const hit = this.lastHit;
    if (!this.bauGhost) return;
    if (!hit) {
      this.bauGhost.setEnabled(false);
      return;
    }
    this.bauGhost.setEnabled(true);
    this.bauGhost.position.set(
      PlacementController.snap(hit.x, 0.5),
      PlacementController.snap(hit.y, 0.25),
      PlacementController.snap(hit.z, 0.5)
    );
    this.bauGhost.rotationQuaternion = null;
    this.bauGhost.rotation.set(0, (this.bauYawGrad * Math.PI) / 180, 0);
  }

  /** Ghost laden (von main.ts auf AssetManager.instantiate verdrahtet). */
  ladeGhost: ((prefab: string) => Promise<import('@babylonjs/core/Meshes/transformNode').TransformNode | null>) | null = null;

  private zeigeBauGhost(_an: null): void {
    if (this.bauGhost) {
      this.bauGhost.dispose(false, true);
      this.bauGhost = null;
      this.bauGhostPrefab = '';
    }
  }

  /** Bau-Klick: Material pruefen + abziehen, Piece zum Server. */
  private baue(piece: PieceDef): void {
    const hit = this.lastHit!;
    const inv = this.inventar?.();
    if (inv) {
      const fehlt = (piece.resources ?? []).find((r) => inv.countOf(r.item) < r.amount);
      if (fehlt) return; // HUD-Meldung macht main.ts nicht — Kosten stehen im Menue
      for (const r of piece.resources ?? []) inv.removeByName(r.item, r.amount);
    }
    this.sendePiece?.(
      piece.bauPrefab!,
      PlacementController.snap(hit.x, 0.5),
      PlacementController.snap(hit.y, 0.25),
      PlacementController.snap(hit.z, 0.5),
      this.bauYawGrad
    );
  }

  dispose(): void {
    this.zeigeBauGhost(null);
    this.marker?.dispose();
    this.markerMaterial.dispose();
  }
}
