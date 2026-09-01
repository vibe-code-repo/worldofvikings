/**
 * Dungeon-Minimap (M2) — quadratischer HUD-Ausschnitt oben rechts, sichtbar
 * NUR in einer 2.0-Instanz (die Oberwelt-Minimap ist dort aus, siehe
 * `main.ts` beim Teleport-Handler). Sie deckt sich beim Erkunden auf
 * (Fog-of-War) und zeigt die Ebene, auf der der Spieler gerade steht.
 *
 * Bewusst KEIN Editor-Import (`editor/CellCanvas.ts`, `editor/design.ts`):
 * das HUD bleibt vom Editor unabhängig. Gezeichnet wird allein aus dem schon
 * im Speicher liegenden `DungeonLayout2` → `zellenAufbauen()` (aus `@wov/shared`),
 * kein Havok-Raycast, keine Heightmap pro Bild — dieselbe Lehre wie bei der
 * Oberwelt-Minimap (synchrone Höhenabfrage fror den Tab ein, 2026-08-02).
 *
 * Koordinaten: Norden = +z (oben), Osten = +x (rechts) — Konvention der
 * HUD-Minimap, NICHT die des Editors (dort liegt Norden unten).
 *
 * Dungeon minimap (M2) — a square HUD panel top-right, visible ONLY inside a
 * 2.0 instance. It reveals by exploration (fog of war) and shows the storey the
 * player currently stands on. Drawn from the in-memory layout only — no Havok
 * ray, no heightmap per frame. North = +z (up), like the HUD minimap.
 */
import { dungeon2 } from '@wov/shared';

/** Anzeigegröße des Fensters in CSS-Pixeln. / Panel size in CSS pixels. */
const SIZE_PX = 220;
/** Angezeigter Sichtradius um den Spieler in Metern. / Shown radius (m). */
const SICHT_M = 44;
/** Aufdeck-Radius um die Spielerzelle in Zellen. / Reveal radius in cells. */
const AUFDECK_ZELLEN = 5;

/** Zellfarben je Art — lokal, damit das HUD editor-frei bleibt. */
/** Per-art cell colours — local, so the HUD stays editor-free. */
const FARBE_BODEN = '#5b5750';
const FARBE_TREPPE = '#8a7a55';
const FARBE_SCHACHT = '#c8853a';
const FARBE_WASSER = '#2c5482';
const FARBE_HINTERGRUND = 'rgba(16,20,26,.82)';
const FARBE_WAND = '#1a1712';
const FARBE_RAHMEN = '#8a6a34';
const FARBE_PFEIL = '#f2c86a';
const FARBE_EINGANG = '#7ad07a';

const ZELLE_M = dungeon2.ZELLE_M;
const EBENE_M = dungeon2.EBENE_M;
const ART = dungeon2.ZELLEN_ART;

/** Die vier Kardinalnachbarn einer Zelle. / The four cardinal neighbours. */
const NACHBARN: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // Nord (+z)
  [1, 0], // Ost (+x)
  [0, -1], // Süd (-z)
  [-1, 0], // West (-x)
];

export class DungeonMinimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private gitter: dungeon2.ZellenGitter | null = null;
  private eingang: { x: number; z: number; ebene: number } | null = null;
  /** Vorhandene Ebenen aufsteigend — für das Ebenen-Etikett. / Storeys present. */
  private ebenen: number[] = [];

  /** Aufgedeckte Zellen, Schlüssel `${ebene}|${x}|${z}`. / Revealed cells. */
  private readonly aufgedeckt = new Set<string>();
  /** Zuletzt aufgedeckte Spielerzelle — Aufdecken nur bei Zellwechsel. */
  private letzteZelle = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText =
      `position:fixed;top:10px;right:10px;width:${SIZE_PX}px;height:${SIZE_PX}px;` +
      'pointer-events:none;z-index:4;display:none;border-radius:6px;overflow:hidden';
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE_PX * 2;
    this.canvas.height = SIZE_PX * 2;
    this.canvas.style.cssText = 'width:100%;height:100%';
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  /**
   * Beim Betreten: Layout übernehmen, Fog-of-War zurücksetzen. Das Zellgitter
   * wird EINMAL hier ausgerollt (nicht pro Bild) — `zellenAufbauen` ist der
   * teure Schritt, und ein Grab wechselt selten.
   * On entry: take the layout, reset the fog. The grid is rolled out ONCE here.
   */
  setzeLayout(layout: dungeon2.DungeonLayout2): void {
    this.gitter = dungeon2.zellenAufbauen(layout);
    this.eingang = layout.eingang
      ? { x: layout.eingang.x, z: layout.eingang.z, ebene: layout.eingang.ebene }
      : null;
    const ebenen = new Set<number>();
    for (const zelle of this.gitter.zellen.values()) ebenen.add(zelle.ebene);
    this.ebenen = [...ebenen].sort((a, b) => a - b);
    this.aufgedeckt.clear();
    this.letzteZelle = '';
  }

  /** Beim Verlassen: Zustand verwerfen (kein Nachhall in die nächste Instanz). */
  /** On exit: drop all state — no bleed into the next instance. */
  leere(): void {
    this.gitter = null;
    this.eingang = null;
    this.ebenen = [];
    this.aufgedeckt.clear();
    this.letzteZelle = '';
    this.setVisible(false);
  }

  /**
   * Je Bild aufrufen. `py` bestimmt die Ebene, `px/pz` die Position, `yaw` die
   * Blickrichtung. Aufgedeckt wird nur bei Zellwechsel, gezeichnet immer (der
   * Pfeil dreht sich weich mit).
   * Call each frame. py picks the storey, px/pz the position, yaw the facing.
   */
  update(px: number, py: number, pz: number, yaw: number): void {
    if (this.gitter === null || this.root.style.display === 'none') return;

    const ebene = this.ebeneBei(py);
    const zx = Math.floor(px / ZELLE_M);
    const zz = Math.floor(pz / ZELLE_M);
    const zelleKey = `${ebene}|${zx}|${zz}`;
    if (zelleKey !== this.letzteZelle) {
      this.letzteZelle = zelleKey;
      this.deckeAuf(zx, zz, ebene);
    }
    this.zeichne(px, pz, ebene, yaw);
  }

  dispose(): void {
    this.root.remove();
  }

  // ── Intern ────────────────────────────────────────────────────────────

  /** Nächstgelegene vorhandene Ebene zur Spielerhöhe. / Nearest present storey. */
  private ebeneBei(py: number): number {
    const roh = Math.round(py / EBENE_M);
    if (this.ebenen.length === 0) return roh;
    let beste = this.ebenen[0];
    for (const e of this.ebenen) {
      if (Math.abs(e - roh) < Math.abs(beste - roh)) beste = e;
    }
    return beste;
  }

  /** Alle vorhandenen Zellen im Radius um die Spielerzelle aufdecken. */
  /** Reveal every present cell within the radius of the player cell. */
  private deckeAuf(zx: number, zz: number, ebene: number): void {
    if (this.gitter === null) return;
    const r = AUFDECK_ZELLEN;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const x = zx + dx;
        const z = zz + dz;
        if (dungeon2.zelleImGitter(this.gitter, x, z, ebene) !== undefined) {
          this.aufgedeckt.add(`${ebene}|${x}|${z}`);
        }
      }
    }
  }

  private static farbe(art: dungeon2.ZellenArt): string | null {
    switch (art) {
      case ART.Boden:
        return FARBE_BODEN;
      case ART.Treppe:
        return FARBE_TREPPE;
      case ART.Schacht:
        return FARBE_SCHACHT;
      case ART.Wasser:
        return FARBE_WASSER;
      default:
        return null; // Leer / unbekannt: nicht zeichnen
    }
  }

  private zeichne(px: number, pz: number, ebene: number, yaw: number): void {
    const ctx = this.ctx;
    const gitter = this.gitter!;
    const w = this.canvas.width;
    const mitte = w / 2;
    // Pixel je Meter, so dass SICHT_M vom Zentrum bis zum Rand reicht.
    const skala = mitte / SICHT_M;
    const zellPx = ZELLE_M * skala;

    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = FARBE_HINTERGRUND;
    ctx.fillRect(0, 0, w, w);

    // Welt→Bild: Norden (+z) oben. / World→screen, north up.
    const bildX = (wx: number): number => mitte + (wx - px) * skala;
    const bildY = (wz: number): number => mitte - (wz - pz) * skala;

    // Nur so viele Zellen ansehen, wie ins Fenster passen (+1 Rand).
    const spanne = Math.ceil(SICHT_M / ZELLE_M) + 1;
    const zx0 = Math.floor(px / ZELLE_M);
    const zz0 = Math.floor(pz / ZELLE_M);

    // 1. Aufgedeckte Zellflächen. / Revealed cell faces.
    for (let z = zz0 - spanne; z <= zz0 + spanne; z++) {
      for (let x = zx0 - spanne; x <= zx0 + spanne; x++) {
        if (!this.aufgedeckt.has(`${ebene}|${x}|${z}`)) continue;
        const zelle = dungeon2.zelleImGitter(gitter, x, z, ebene);
        if (zelle === undefined) continue;
        const farbe = DungeonMinimap.farbe(zelle.art);
        if (farbe === null) continue;
        const sx = bildX((x + 0.5) * ZELLE_M) - zellPx / 2;
        const sy = bildY((z + 0.5) * ZELLE_M) - zellPx / 2;
        ctx.fillStyle = farbe;
        // +1 gegen Fugenrisse zwischen benachbarten Kacheln. / avoid seams.
        ctx.fillRect(sx, sy, zellPx + 1, zellPx + 1);
      }
    }

    // 2. Wände als Striche an den Kanten aufgedeckter Zellen — dort, wo der
    //    Nachbar fehlt oder eine Wand dazwischen steht. / Walls at edges.
    ctx.strokeStyle = FARBE_WAND;
    ctx.lineWidth = Math.max(1.5, zellPx * 0.14);
    ctx.beginPath();
    for (let z = zz0 - spanne; z <= zz0 + spanne; z++) {
      for (let x = zx0 - spanne; x <= zx0 + spanne; x++) {
        if (!this.aufgedeckt.has(`${ebene}|${x}|${z}`)) continue;
        const zelle = dungeon2.zelleImGitter(gitter, x, z, ebene);
        if (zelle === undefined || DungeonMinimap.farbe(zelle.art) === null) continue;
        const links = bildX(x * ZELLE_M);
        const rechts = bildX((x + 1) * ZELLE_M);
        const oben = bildY((z + 1) * ZELLE_M); // Nord = +z = oben
        const unten = bildY(z * ZELLE_M);
        for (const [dx, dz] of NACHBARN) {
          const nachbar = dungeon2.zelleImGitter(gitter, x + dx, z + dz, ebene);
          const wand =
            nachbar === undefined ||
            DungeonMinimap.farbe(nachbar.art) === null ||
            dungeon2.wandZwischen(zelle, nachbar);
          if (!wand) continue;
          if (dz === 1) {
            ctx.moveTo(links, oben);
            ctx.lineTo(rechts, oben);
          } else if (dz === -1) {
            ctx.moveTo(links, unten);
            ctx.lineTo(rechts, unten);
          } else if (dx === 1) {
            ctx.moveTo(rechts, oben);
            ctx.lineTo(rechts, unten);
          } else {
            ctx.moveTo(links, oben);
            ctx.lineTo(links, unten);
          }
        }
      }
    }
    ctx.stroke();

    // 3. Eingang (nur wenn auf dieser Ebene und aufgedeckt). / Entrance marker.
    if (
      this.eingang !== null &&
      this.eingang.ebene === ebene &&
      this.aufgedeckt.has(`${ebene}|${this.eingang.x}|${this.eingang.z}`)
    ) {
      const ex = bildX((this.eingang.x + 0.5) * ZELLE_M);
      const ey = bildY((this.eingang.z + 0.5) * ZELLE_M);
      ctx.fillStyle = FARBE_EINGANG;
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(3, zellPx * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Spielerpfeil in der Mitte (Blickrichtung wie die Oberwelt-Minimap).
    //    Player arrow at centre, same forward convention as the world minimap.
    ctx.save();
    ctx.translate(mitte, mitte);
    ctx.rotate(yaw + Math.PI);
    ctx.fillStyle = FARBE_PFEIL;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(10, 13);
    ctx.lineTo(0, 6);
    ctx.lineTo(-10, 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 5. Rahmen + Ebenen-Etikett (nur bei mehrstöckigen Gräbern).
    ctx.strokeStyle = FARBE_RAHMEN;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, w - 6);
    if (this.ebenen.length > 1) {
      const text = `Ebene ${ebene + 1}/${this.ebenen.length}`;
      ctx.font = 'bold 22px Georgia,serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(8, 8, ctx.measureText(text).width + 16, 30);
      ctx.fillStyle = FARBE_PFEIL;
      ctx.fillText(text, 16, 12);
    }
  }
}
