/**
 * Minimap (Phase G) — runder HUD-Ausschnitt oben rechts im Valheim-Stil.
 *
 * Anders als die Weltkarte (M, 10 m je Texel aus dem Worker-Raster) tastet
 * die Minimap ihr Umfeld LIVE und deutlich feiner ab (~1,6 m je Sample),
 * direkt aus dem GeoManager. Bewusst `geo.getHeight` (pure Worldgen-
 * Funktion) statt `world.getGroundHeight` — Letzteres baut synchron
 * Zonen-Heightmaps auf und hat mit genau diesem Muster schon einmal den
 * Tab eingefroren (Kartenmarker, 2026-08-02).
 *
 * Drei Ebenen:
 *  1. Gelände: Doppelpuffer, zeilenweise mit Budget gerechnet. Der
 *     ABGETASTETE Bereich (BUILD_R) ist bewusst größer als der ANGEZEIGTE
 *     (RADIUS_M): während des Neuaufbaus wird das alte Bild um den
 *     Spielerversatz verschoben gezeichnet, und ohne Überstand liefe beim
 *     Rennen ein sichtbarer Nachlade-Rand vor dem Spieler her.
 *  2. Objekte: Bäume/Felsen/Bauwerke aus den ECHTEN Entity-Instanzen
 *     (EntityManager-Buckets), als Punkte in eine eigene, weltverankerte
 *     Offscreen-Ebene gezeichnet und ~1×/s aufgefrischt.
 *  3. Overlay je Frame: Spielerpfeil, Norden, Dungeon-Eingänge, Windzeiger.
 *
 * Koordinaten: Norden = +z (oben), Osten = +x (rechts) — dieselbe
 * Orientierung wie die Weltkarte.
 */
import { Biome, PrefabFlag, WATER_LEVEL, findPrefabByName } from '@wov/shared';
import type { ClientWorld } from '../world/World';
import { BIOME_COLOR, type RGB } from './worldmap/MapPalette';

/** Angezeigter Sichtradius in Metern. */
const RADIUS_M = 150;
/**
 * Abgetasteter Radius: Anzeige + Ankersprung + Laufstrecke während eines
 * Neuaufbaus (~0,7 s × 7,5 m/s) + Reserve. Der Überstand deckt den Rand,
 * bis das nächste Vollbild fertig ist.
 */
const BUILD_R = 210;
/** Samples je Achse — 256 auf 420 m sind ~1,6 m je Sample. */
const N = 256;
/** Anzeigegröße des runden Fensters in CSS-Pixeln. */
const SIZE_PX = 230;
/** Neuer Abtast-Anker, sobald der Spieler so weit vom alten weg ist (m). */
const ANKER_SPRUNG = 25;
/**
 * Zeilen je Frame — jede Zeile sind 256 × (Höhe+Biome+Wald)-Noise-Abfragen,
 * und der Neuaufbau läuft beim Laufen alle ~3 s mitten im Spiel-Frame.
 * 256/6 ≈ 43 Frames je Vollbild (~0,7 s).
 */
const ZEILEN_JE_FRAME = 6;
/** Objekt-Ebene: Pixelgröße und Auffrischintervall. */
const OBJ_N = 512;
const OBJ_INTERVALL_MS = 1200;

const SAND: RGB = [188, 176, 132];
const WASSER: RGB = [44, 84, 130];
/** Punktfarben der Objekt-Ebene. */
const FARBE_BAUM = 'rgb(22,44,20)';
const FARBE_FELS = 'rgb(126,126,122)';
const FARBE_BAUWERK = 'rgb(158,112,58)';

const FELS_NAME = /rock|stone|cliff|boulder/i;

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  /** Fertiges Geländebild (wird gezeichnet) + sein Weltanker. */
  private fertig: HTMLCanvasElement;
  private fertigAnker = { x: 0, z: 0 };
  /** Bild im Aufbau + sein Anker + nächste Zeile. */
  private bau: HTMLCanvasElement;
  private bauDaten: ImageData;
  private bauAnker = { x: 0, z: 0 };
  private bauZeile = Number.MAX_SAFE_INTEGER; // fertig
  private erstesBild = true;

  /** Objekt-Ebene (Bäume/Felsen/Bauwerke), weltverankert. */
  private objCanvas: HTMLCanvasElement;
  private objAnker = { x: 0, z: 0 };
  private objZeit = 0;
  private objQuelle:
    | ((x: number, z: number, radius: number) => Array<{ prefab: string; x: number; z: number }>)
    | null = null;
  /** Kategorie je Prefabname — die Flag-Abfrage ist zu teuer für jede Instanz. */
  private readonly kategorieCache = new Map<string, 0 | 1 | 2 | 3>();

  private eingaenge: Array<{ x: number; z: number }> = [];

  constructor(private readonly world: ClientWorld) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      `position:fixed;top:10px;right:10px;width:${SIZE_PX}px;height:${SIZE_PX}px;` +
      'pointer-events:none;z-index:4';
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE_PX * 2;
    this.canvas.height = SIZE_PX * 2;
    this.canvas.style.cssText = 'width:100%;height:100%';
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d')!;

    this.fertig = document.createElement('canvas');
    this.fertig.width = N;
    this.fertig.height = N;
    this.bau = document.createElement('canvas');
    this.bau.width = N;
    this.bau.height = N;
    this.bauDaten = this.bau.getContext('2d')!.createImageData(N, N);
    this.objCanvas = document.createElement('canvas');
    this.objCanvas.width = OBJ_N;
    this.objCanvas.height = OBJ_N;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  setDungeonEingaenge(list: Array<{ x: number; z: number }>): void {
    this.eingaenge = list;
  }

  /** Lieferant für die Objekt-Ebene (EntityManager.nearbyInstances). */
  setObjektQuelle(
    fn: (x: number, z: number, radius: number) => Array<{ prefab: string; x: number; z: number }>
  ): void {
    this.objQuelle = fn;
  }

  /** Jeden Frame aufrufen: rechnet mit Budget nach und zeichnet. */
  update(
    px: number,
    pz: number,
    yaw: number,
    wind: { dirX: number; dirZ: number; intensity: number }
  ): void {
    if (this.root.style.display === 'none') return;

    const bautNoch = this.bauZeile < N;
    const d = Math.hypot(px - this.fertigAnker.x, pz - this.fertigAnker.z);
    if (!bautNoch && (this.erstesBild || d > ANKER_SPRUNG)) {
      this.bauAnker = { x: px, z: pz };
      this.bauZeile = 0;
    }

    if (this.bauZeile < N) this.gelaendeZeilen();
    this.objekteAuffrischen(px, pz);
    this.zeichnen(px, pz, yaw, wind);
  }

  // ── Ebene 1: Gelände ───────────────────────────────────────────────

  private gelaendeZeilen(): void {
    const schritt = (BUILD_R * 2) / N;
    const geo = this.world.geo;
    const bis = Math.min(N, this.bauZeile + ZEILEN_JE_FRAME);
    const px8 = this.bauDaten.data;
    for (let j = this.bauZeile; j < bis; j++) {
      const z = this.bauAnker.z + BUILD_R - j * schritt; // Zeile 0 = Norden
      let hLinks = geo.getHeight(this.bauAnker.x - BUILD_R - schritt, z);
      for (let i = 0; i < N; i++) {
        const x = this.bauAnker.x - BUILD_R + i * schritt;
        const h = geo.getHeight(x, z);
        let r: number, g: number, b: number;
        if (h < WATER_LEVEL) {
          const f = 1 - Math.min((WATER_LEVEL - h) / 24, 0.55);
          r = WASSER[0] * f;
          g = WASSER[1] * f;
          b = WASSER[2] * f;
        } else {
          let biome = geo.getBiome(x, z);
          // None (Weltrand/Übergänge) würde als grelles Magenta erscheinen.
          if (biome === Biome.None) biome = Biome.Ocean;
          const base = BIOME_COLOR[biome] ?? BIOME_COLOR[Biome.Meadows];
          // Hangschattierung, WEICH: bei 1,6-m-Samples liefert eine Klippe
          // Höhensprünge von ±20 m — der alte Faktor 0.06 mit Klemme bis
          // 1.2 erzeugte daraus grelle Sprenkel ("helle Flecken").
          const licht = Math.min(1.06, Math.max(0.76, 0.9 + (h - hLinks) * 0.02));
          // Uferband nur, wo Sand plausibel ist — im Sumpf liegt fast
          // alles auf Wasserlinie, das Band überzog ihn flächig hell.
          const ufer =
            h - WATER_LEVEL < 0.4 &&
            biome !== Biome.Swamp &&
            biome !== Biome.Mountain &&
            biome !== Biome.DeepNorth;
          const wald =
            (biome === Biome.Meadows || biome === Biome.BlackForest || biome === Biome.Plains) &&
            geo.getForestFactor(x, z) < 1.15
              ? 0.85
              : 1;
          const src = ufer ? SAND : base;
          r = src[0] * licht * wald;
          g = src[1] * licht * wald;
          b = src[2] * licht * wald;
        }
        const o = (j * N + i) * 4;
        px8[o] = r;
        px8[o + 1] = g;
        px8[o + 2] = b;
        px8[o + 3] = 255;
        hLinks = h;
      }
    }
    this.bauZeile = bis;
    if (this.bauZeile >= N) {
      this.bau.getContext('2d')!.putImageData(this.bauDaten, 0, 0);
      const t = this.fertig;
      this.fertig = this.bau;
      this.bau = t;
      this.bauDaten = this.bau.getContext('2d')!.createImageData(N, N);
      this.fertigAnker = { ...this.bauAnker };
      this.erstesBild = false;
    }
  }

  // ── Ebene 2: Objekte (Bäume, Felsen, Bauwerke) ─────────────────────

  /** 0 = ignorieren, 1 = Baum, 2 = Fels, 3 = Bauwerk. */
  private kategorie(prefab: string): 0 | 1 | 2 | 3 {
    const cached = this.kategorieCache.get(prefab);
    if (cached !== undefined) return cached;
    const def = findPrefabByName(prefab);
    let k: 0 | 1 | 2 | 3 = 0;
    if (def) {
      if ((def.flags & PrefabFlag.TREE_BASE) !== 0n) k = 1;
      else if ((def.flags & PrefabFlag.MINE_ROCK_5) !== 0n || FELS_NAME.test(prefab)) k = 2;
      else if ((def.flags & PrefabFlag.PIECE) !== 0n) k = 3;
    }
    this.kategorieCache.set(prefab, k);
    return k;
  }

  private objekteAuffrischen(px: number, pz: number): void {
    if (!this.objQuelle) return;
    const jetzt = performance.now();
    if (jetzt - this.objZeit < OBJ_INTERVALL_MS) return;
    this.objZeit = jetzt;

    const ctx = this.objCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, OBJ_N, OBJ_N);
    this.objAnker = { x: px, z: pz };
    const scale = OBJ_N / (BUILD_R * 2); // px je Meter
    const mitte = OBJ_N / 2;

    for (const inst of this.objQuelle(px, pz, BUILD_R)) {
      const k = this.kategorie(inst.prefab);
      if (k === 0) continue;
      const ox = mitte + (inst.x - px) * scale;
      const oy = mitte - (inst.z - pz) * scale;
      if (k === 1) {
        ctx.fillStyle = FARBE_BAUM;
        ctx.fillRect(ox - 1.5, oy - 1.5, 3, 3);
      } else if (k === 2) {
        ctx.fillStyle = FARBE_FELS;
        ctx.fillRect(ox - 2, oy - 2, 4, 4);
      } else {
        ctx.fillStyle = FARBE_BAUWERK;
        ctx.fillRect(ox - 2.5, oy - 2.5, 5, 5);
      }
    }
  }

  // ── Ebene 3: Zusammensetzen + Overlay ──────────────────────────────

  private zeichnen(
    px: number,
    pz: number,
    yaw: number,
    wind: { dirX: number; dirZ: number; intensity: number }
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const cx = w / 2;
    const cy = w / 2;
    const rand = 10;
    const radiusPx = w / 2 - rand;
    const scale = (radiusPx * 2) / (RADIUS_M * 2); // px je Meter

    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = 'rgb(30,38,48)';
    ctx.fillRect(0, 0, w, w);

    // Gelände: ankerzentriert, um den Spielerversatz verschoben.
    if (!this.erstesBild) {
      const dx = (this.fertigAnker.x - px) * scale;
      const dz = (this.fertigAnker.z - pz) * scale;
      const bild = BUILD_R * 2 * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fertig, cx + dx - bild / 2, cy - dz - bild / 2, bild, bild);
    }

    // Objekte: gleiche Verschiebung mit eigenem Anker.
    {
      const dx = (this.objAnker.x - px) * scale;
      const dz = (this.objAnker.z - pz) * scale;
      const bild = BUILD_R * 2 * scale;
      ctx.drawImage(this.objCanvas, cx + dx - bild / 2, cy - dz - bild / 2, bild, bild);
    }

    // Dungeon-Eingänge (glutrote Rauten wie auf der Weltkarte).
    ctx.fillStyle = 'rgb(224,80,40)';
    for (const e of this.eingaenge) {
      const ex = (e.x - px) * scale;
      const ez = (e.z - pz) * scale;
      if (ex * ex + ez * ez > radiusPx * radiusPx) continue;
      ctx.save();
      ctx.translate(cx + ex, cy - ez);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }

    // Spielerpfeil (Blickrichtung: forward = (-sin, -cos) yaw).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw + Math.PI);
    ctx.fillStyle = 'rgb(242,200,106)';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // Kreis-Clip aufheben

    // Ring.
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgb(138,106,52)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx + 4, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.stroke();

    // Norden.
    ctx.fillStyle = 'rgb(242,200,106)';
    ctx.font = 'bold 22px Georgia,serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 4;
    ctx.strokeText('N', cx, rand + 14);
    ctx.fillText('N', cx, rand + 14);

    // Windzeiger: kleiner Kompass unten links am Ring.
    const wx = cx - radiusPx * 0.72;
    const wy = cy + radiusPx * 0.72;
    const wr = 26;
    ctx.beginPath();
    ctx.arc(wx, wy, wr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,16,22,.78)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgb(138,106,52)';
    ctx.stroke();

    const wlen = Math.hypot(wind.dirX, wind.dirZ) || 1;
    const nx = wind.dirX / wlen;
    const nz = wind.dirZ / wlen;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(Math.atan2(nx, nz));
    ctx.fillStyle = 'rgb(150,210,255)';
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -wr + 7);
    ctx.lineTo(6, wr - 12);
    ctx.lineTo(0, wr - 17);
    ctx.lineTo(-6, wr - 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.font = 'bold 15px Georgia,serif';
    ctx.fillStyle = 'rgb(150,210,255)';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 3;
    const prozent = `${Math.round(wind.intensity * 100)} %`;
    ctx.strokeText(prozent, wx, wy + wr + 12);
    ctx.fillText(prozent, wx, wy + wr + 12);
  }

  dispose(): void {
    this.root.remove();
  }
}
