/**
 * Die Kollisionsform im CLIENT — gemessen, nicht behauptet.
 *
 * Drei Fragen, und jede steht gegen einen Fehler, den man beim Spielen
 * erst merkt, wenn man dagegenläuft:
 *
 *  (a) DIE ABBILDUNG GLB → CLIENTRAUM. Babylons glTF-Import stellt jedem
 *      Modell einen `__root__` voran, der die Händigkeit umrechnet. Der
 *      Server liest dieselbe Datei ohne Babylon und muss diese Umrechnung
 *      von Hand machen (`shared/src/kollision/glb.ts`). Steht sie falsch
 *      herum, ist jedes unsymmetrische Hindernis auf dem Server
 *      gespiegelt — und das sieht man nirgends, denn beide Seiten liefern
 *      für sich plausible Zahlen. Gemessen wird deshalb die MATRIX und
 *      danach jede einzelne Vertexposition beider Wege gegeneinander.
 *
 *  (b) DIE FORMEN HABEN SICH NICHT VERSCHOBEN. Die Ableitung ist am
 *      10.09.2026 aus `client/src/engine/Physics.ts` nach `shared`
 *      gezogen worden, damit der Server dieselbe benutzt. Die Datei
 *      `shared/test/golden/kollision-formen.json` hält für acht Prefabs
 *      die Havok-Parameter von VORHER (`havokVorher`, aus origin/main)
 *      und die erwarteten von heute (`havok`). Sieben sind identisch;
 *      die achte ist die EINE bewusste Änderung und trägt ihre
 *      Begründung im Feld `geaendert`.
 *
 *  (d) DIE ÜBRIGEN `mesh`-PREFABS BEKOMMEN IHR NETZ. Vier Prefabs tragen
 *      im Katalog `art: 'mesh'` und sind weder Fels noch Gelände;
 *      beobachtet war bis zum 11.09.2026 nur eines davon (die Treppe,
 *      oben in (b)). Ein Unterstand, ein Steg und ein Torbogen, die
 *      still auf die Katalog-Kiste zurückfallen, sind drei massive
 *      Blöcke — durch deren Durchgang läuft niemand mehr, und man merkt
 *      es erst dort. Geprüft werden Formart, Dreieckszahl und Hüllbox;
 *      die Hüllbox ist der Zeuge dagegen, dass zwar ein Netz entsteht,
 *      aber aus dem SICHT-Netz statt aus dem `_collision`-Netz.
 *
 *  (c) DIE KAPSELRADIEN DER BÄUME BLEIBEN STÄMME. Die Stammband-Messung
 *      kann die Krone erwischen; dann steht eine Tonne von mehreren
 *      Metern um den Baum. Im Vorbild liegen die Stammkapseln bei 0,25 /
 *      0,40 / 0,61 m. Gemeldet wird jeder Ausreisser über 1,0 m — als
 *      HINWEIS, nicht als Fehlschlag: Speicher-Vegetation bekommt heute
 *      gar keinen Körper (`istFesterStoreKoerper`), der Wert wäre also
 *      erst dann eine Wand, wenn jemand das umstellt.
 *
 * Die GLBs liegen ausserhalb des Repos; ohne `assets/store` läuft der
 * Test nicht (Weiche im Sammellauf). Die BILDER werden vor dem Laden aus
 * der GLB entfernt — Babylon hat in Node kein XMLHttpRequest für die
 * externen Texturen, und für die Kollision zählt ohnehin nur Geometrie
 * und Materialname.
 *
 *   npx tsx client/test/kollision-formen.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { AssetContainer } from '@babylonjs/core/assetContainer';
// Seiteneffekt-Importe wie im Client.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/loaders/glTF/2.0';
import {
  kollisionsForm,
  kollisionsModellPfad,
  storeKollision,
  type KollisionsForm,
} from '@wov/shared';
import { leseGlb } from '@wov/shared/src/kollision/glb.js';
import { AssetManager } from '../src/engine/AssetManager';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const GOLDEN = join(WURZEL, 'shared/test/golden/kollision-formen.json');

let fehler = 0;
function pruefe(bedingung: boolean, was: string, detail = ''): void {
  if (bedingung) console.log(`  OK   ${was}`);
  else {
    fehler++;
    console.error(`  ROT  ${was}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Golden {
  toleranz: { kisteKapsel: number; netzHuelle: number };
  prefabs: {
    name: string;
    modell: string;
    havok: Record<string, unknown>;
    /**
     * Die Form aus origin/main — oder `null`, wenn es dort KEINE gab.
     * `null` steht nur zusammen mit `geaendert`: Ein Prefab, das erst
     * heute einen Körper bekommt, hat kein „vorher", das man vergleichen
     * könnte, und eine erfundene Zahl wäre schlimmer als keine.
     */
    havokVorher: Record<string, unknown> | null;
    geaendert?: string;
  }[];
  /**
   * Die `art: 'mesh'`-Prefabs, die weder Fels noch Gelände sind.
   *
   * Warum sie eine eigene Liste haben und nicht in `prefabs` stehen: Dort
   * lautet die Frage „hat sich gegenüber origin/main etwas verschoben",
   * und die braucht ein `havokVorher` aus dem alten Client. Hier ist die
   * Frage eine andere und eine einfachere — bekommt dieses Prefab
   * überhaupt sein NETZ, oder fällt es auf die Katalog-Kiste zurück?
   * Ein Unterstand, ein Steg und ein Torbogen als massiver Block sind
   * drei Durchgänge, durch die niemand mehr läuft; bis zum 11.09.2026
   * stand von den vier `mesh`-Prefabs nur die Treppe unter Beobachtung.
   */
  netzPrueflinge: {
    name: string;
    modell: string;
    /** Dreiecke der abgeleiteten Form — gemessen, nicht geschätzt. */
    dreiecke: number;
    /** Hüllbox der Form: [minX, minY, minZ, maxX, maxY, maxZ]. */
    huelle: number[];
  }[];
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;

/**
 * Die Bilder aus einer GLB entfernen, Materialnamen behalten.
 *
 * Die Speicher-GLBs führen ihre Texturen als relative URI daneben. In
 * Node scheitert Babylon daran mit „XMLHttpRequest is not defined", und
 * zwar beim LADEN — es käme gar keine Geometrie zustande. Die
 * Materialnamen müssen bleiben: `getMasters()` wirft `DefaultMaterial`
 * weg, und das entscheidet mit, welche Netze überhaupt gemessen werden.
 */
function ohneBilder(bytes: Uint8Array): Uint8Array {
  const b = Buffer.from(bytes);
  let off = 12;
  let js: Record<string, unknown> | null = null;
  let bin = Buffer.alloc(0);
  while (off + 8 <= b.length) {
    const laenge = b.readUInt32LE(off);
    const art = b.readUInt32LE(off + 4);
    off += 8;
    if (art === 0x4e4f534a) js = JSON.parse(b.subarray(off, off + laenge).toString('utf8')) as Record<string, unknown>;
    else if (art === 0x004e4942) bin = b.subarray(off, off + laenge);
    off += laenge;
  }
  if (js === null) throw new Error('GLB ohne JSON-Chunk');
  delete js.images;
  delete js.textures;
  delete js.samplers;
  delete js.extensionsUsed;
  delete js.extensionsRequired;
  for (const m of (js.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
    const p = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (p) {
      delete p.baseColorTexture;
      delete p.metallicRoughnessTexture;
    }
  }
  const json = Buffer.from(JSON.stringify(js), 'utf8');
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const gesamt = 12 + 8 + jsonChunk.length + (binChunk.length > 0 ? 8 + binChunk.length : 0);
  const aus = Buffer.alloc(gesamt);
  aus.write('glTF', 0, 'ascii');
  aus.writeUInt32LE(2, 4);
  aus.writeUInt32LE(gesamt, 8);
  aus.writeUInt32LE(jsonChunk.length, 12);
  aus.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(aus, 20);
  if (binChunk.length > 0) {
    const p = 20 + jsonChunk.length;
    aus.writeUInt32LE(binChunk.length, p);
    aus.writeUInt32LE(0x004e4942, p + 4);
    binChunk.copy(aus, p + 8);
  }
  return aus;
}

/** Havok-Parameter, wie `StaticColliderSet.buildShape()` sie setzt. */
function havok(f: KollisionsForm | null): Record<string, unknown> | null {
  if (f === null) return null;
  if (f.art === 'netz') {
    return {
      art: 'netz',
      dreiecke: f.indizes.length / 3,
      min: [f.min.x, f.min.y, f.min.z],
      max: [f.max.x, f.max.y, f.max.z],
    };
  }
  if (f.art === 'kapsel') {
    const h = f.yMax - f.yMin;
    return {
      art: 'kapsel',
      a: [f.x, f.yMin + Math.min(f.radius, h / 2), f.z],
      b: [f.x, f.yMin + Math.max(h - f.radius, f.radius), f.z],
      radius: f.radius,
    };
  }
  return {
    art: 'kiste',
    mitte: [(f.min.x + f.max.x) / 2, (f.min.y + f.max.y) / 2, (f.min.z + f.max.z) / 2],
    masse: [f.max.x - f.min.x, f.max.y - f.min.y, f.max.z - f.min.z],
  };
}

function gleich(a: Record<string, unknown> | null, b: Record<string, unknown> | null, tol: number): boolean {
  if (a === null || b === null) return a === b;
  if (a.art !== b.art) return false;
  for (const k of Object.keys(a)) {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number') {
      if (Math.abs(x - y) > tol) return false;
    } else if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (Math.abs((x[i] as number) - (y[i] as number)) > tol) return false;
      }
    } else if (x !== y) return false;
  }
  return true;
}

interface Netz {
  positionen: Float32Array;
  indizes: Uint32Array | null;
}

/** Ein Modell über den ECHTEN Client-Weg laden und zusammenlegen. */
async function clientNetze(
  modell: string,
  netzDatei: string | undefined
): Promise<{ sicht: Netz | null; kollision: Netz | null; wurzel: Matrix | null }> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const assets = new AssetManager(scene);
  let wurzel: Matrix | null = null;

  const bereitstellen = async (name: string): Promise<void> => {
    const bytes = ohneBilder(readFileSync(join(WURZEL, 'assets', `${name}.glb`)));
    const url = `data:base64,${Buffer.from(bytes).toString('base64')}`;
    const container = await SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
    const root = container.meshes.find((m) => m.name === '__root__');
    if (root && wurzel === null) {
      root.computeWorldMatrix(true);
      wurzel = root.getWorldMatrix().clone();
    }
    container.removeAllFromScene();
    (
      assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }
    ).containers.set(name, Promise.resolve(container));
  };

  await bereitstellen(modell);
  const master = [...(await assets.getMasters(modell))];
  if (netzDatei !== undefined) {
    const netzModell = kollisionsModellPfad(netzDatei);
    await bereitstellen(netzModell);
    master.push(...(await assets.getKollisionsMasters(netzModell)));
  }
  const zusammen = (nurKollision: boolean): Netz | null => {
    const teile: { pos: ArrayLike<number>; idx: ArrayLike<number> | null; e: Float32Array }[] = [];
    for (const m of master) {
      if ((m.nurKollision === true) !== nurKollision) continue;
      const pos = m.mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!pos) continue;
      const idx = m.mesh.getIndices();
      teile.push({ pos, idx: idx && idx.length > 0 ? idx : null, e: m.localMatrix.m as unknown as Float32Array });
    }
    let ecken = 0;
    let dreiecke = 0;
    for (const t of teile) {
      ecken += t.pos.length;
      dreiecke += t.idx ? t.idx.length : 0;
    }
    if (ecken === 0) return null;
    const positionen = new Float32Array(ecken);
    const indizes = dreiecke > 0 ? new Uint32Array(dreiecke) : null;
    let p = 0;
    let q = 0;
    for (const t of teile) {
      const basis = p / 3;
      const e = t.e;
      for (let v = 0; v < t.pos.length; v += 3) {
        const x = t.pos[v]!;
        const y = t.pos[v + 1]!;
        const z = t.pos[v + 2]!;
        positionen[p++] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
        positionen[p++] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
        positionen[p++] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      }
      if (indizes && t.idx) for (let k = 0; k < t.idx.length; k++) indizes[q++] = basis + t.idx[k]!;
    }
    return { positionen, indizes };
  };
  const ergebnis = { sicht: zusammen(false), kollision: zusammen(true), wurzel };
  scene.dispose();
  engine.dispose();
  return ergebnis;
}

async function main(): Promise<void> {
  if (!existsSync(join(WURZEL, 'assets/store'))) {
    console.error('assets/store fehlt — ohne den Speicher ist hier nichts zu messen.');
    process.exit(1);
  }
  const baumRadien: string[] = [];

  for (const p of golden.prefabs) {
    const katalog = storeKollision(p.name);
    const netzDatei = katalog?.netz;
    const { sicht, kollision, wurzel } = await clientNetze(p.modell, netzDatei);

    // ── (a) Abbildung ────────────────────────────────────────────────
    if (p.name === golden.prefabs[0]!.name) {
      const m = wurzel === null ? null : [...(wurzel as Matrix).m];
      const erwartet = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      pruefe(
        m !== null && m.every((v, i) => Math.abs(v - erwartet[i]!) < 1e-6),
        '(a) __root__ ist diag(−1, 1, 1, 1) — Clientraum = (−x, y, z) des Dateiraums',
        m === null ? 'kein __root__' : m.join(',')
      );
    }
    const roh = leseGlb(readFileSync(join(WURZEL, 'assets', `${p.modell}.glb`)));
    if (sicht !== null && roh.sicht !== null) {
      const l = sicht.positionen.length === roh.sicht.positionen.length;
      let punkte = l;
      if (l) {
        for (let i = 0; i < sicht.positionen.length; i++) {
          if (Math.abs(sicht.positionen[i]! - roh.sicht.positionen[i]!) > 1e-4) {
            punkte = false;
            break;
          }
        }
      }
      pruefe(
        punkte,
        `(a) ${p.name}: alle ${sicht.positionen.length / 3} Vertices deckungsgleich mit dem Node-Leser`,
        l ? 'Werte weichen ab' : `${sicht.positionen.length} gegen ${roh.sicht.positionen.length}`
      );
    }

    // ── (b) Form ─────────────────────────────────────────────────────
    const optionen = { stammartig: false, dungeonRaum: false };
    const form =
      (kollision
        ? kollisionsForm(kollision.positionen, kollision.indizes, p.name, katalog, {
            ...optionen,
            eigenesNetz: true,
          })
        : null) ??
      (sicht ? kollisionsForm(sicht.positionen, sicht.indizes, p.name, katalog, optionen) : null);
    const ist = havok(form);
    const tol = form?.art === 'netz' ? golden.toleranz.netzHuelle : golden.toleranz.kisteKapsel;
    pruefe(
      gleich(ist, p.havok, tol),
      `(b) ${p.name}: Havok-Parameter wie festgehalten (${String(ist?.art)})`,
      `ist ${JSON.stringify(ist)} / soll ${JSON.stringify(p.havok)}`
    );
    if (p.geaendert === undefined) {
      pruefe(
        gleich(ist, p.havokVorher, tol),
        `(b) ${p.name}: unverändert gegenüber origin/main`,
        `vorher ${JSON.stringify(p.havokVorher)}`
      );
    } else {
      console.log(`  NOTE ${p.name}: bewusst geändert — ${p.geaendert.split('.')[0]!}.`);
    }

    // ── (c) Baumradien ───────────────────────────────────────────────
    if (form?.art === 'kapsel' && form.radius > 1.0) {
      baumRadien.push(`${p.name}: r ${form.radius.toFixed(2)} m`);
    }
  }

  // ── (d) Die uebrigen `mesh`-Prefabs ────────────────────────────────
  /*
    Geprüft wird das, was hier schiefgehen KANN: dass die Form ein Netz
    ist und nicht die Katalog-Kiste, dass sie Dreiecke hat, und dass ihre
    Hüllbox dieselbe geblieben ist. Kein Vergleich mit origin/main — die
    drei sind erst am 11.09.2026 unter Beobachtung gekommen, ein
    „vorher" gäbe es nur erfunden.

    Die Hüllbox ist der Zeuge gegen die stille Variante des Fehlers: eine
    Form, die zwar `netz` heisst, aber das SICHT-Netz statt des
    `_collision`-Netzes gemessen hat. Die Dreieckszahl allein sähe das
    nicht.
  */
  for (const p of golden.netzPrueflinge) {
    const katalog = storeKollision(p.name);
    const { kollision, sicht } = await clientNetze(p.modell, katalog?.netz);
    const optionen = { stammartig: false, dungeonRaum: false };
    const form =
      (kollision
        ? kollisionsForm(kollision.positionen, kollision.indizes, p.name, katalog, {
            ...optionen,
            eigenesNetz: true,
          })
        : null) ??
      (sicht ? kollisionsForm(sicht.positionen, sicht.indizes, p.name, katalog, optionen) : null);
    pruefe(form?.art === 'netz', `(d) ${p.name}: bekommt ein Netz, keine Kiste`, `art ${String(form?.art)}`);
    if (form?.art !== 'netz') continue;
    const dreiecke = form.indizes.length / 3;
    pruefe(dreiecke === p.dreiecke, `(d) ${p.name}: ${dreiecke} Dreiecke wie festgehalten`,
      `soll ${p.dreiecke}`);
    const ist = [form.min.x, form.min.y, form.min.z, form.max.x, form.max.y, form.max.z];
    pruefe(
      ist.every((v, i) => Math.abs(v - p.huelle[i]!) < golden.toleranz.netzHuelle),
      `(d) ${p.name}: Hüllbox wie festgehalten`,
      `ist [${ist.map((v) => v.toFixed(4)).join(', ')}] / soll [${p.huelle.join(', ')}]`
    );
  }

  if (baumRadien.length > 0) {
    console.log(
      `\n  NOTE (c) ${baumRadien.length} Kapsel(n) mit Radius über 1,0 m — die Stammband-Messung\n` +
        '       hat dort die Krone erwischt. Im Vorbild liegen Stammkapseln bei 0,25/0,40/0,61 m.\n' +
        '       Kein Fehlschlag: Speicher-Vegetation bekommt heute keinen Körper.\n' +
        baumRadien.map((z) => `       ${z}`).join('\n')
    );
  }

  console.log(fehler === 0 ? '\nOK — Abbildung und Formen stehen' : `\n${fehler} FEHLER`);
  process.exit(fehler > 0 ? 1 : 0);
}

void main().catch((f: unknown) => {
  console.error(f);
  process.exit(1);
});
