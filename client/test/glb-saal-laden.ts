/**
 * E2, zweite Hälfte — der geschriebene Saal, durch den ECHTEN Lader.
 *
 * ── Warum der Schreiber-Test allein nicht genügt ─────────────────────
 * `server/test/glb-schreiber.ts` liest die Datei mit einem eigenen,
 * kleinen Parser. Der ist als Zeuge genau richtig (er glaubt dem
 * Schreiber nichts), aber er ist nachsichtig: Er prüft die Zahlen, die
 * er selbst braucht, und geht über alles hinweg, was ihn nicht
 * interessiert — falsche Bufferview-Ziele, eine unausgerichtete Länge,
 * ein fehlendes Pflichtfeld. Im Spiel liest die Datei nicht dieser
 * Parser, sondern Babylons glTF-Lader. Der ist streng, und er ist der
 * einzige, dessen Urteil zählt.
 *
 * Deshalb hier derselbe Weg wie im Client: `SceneLoader.
 * LoadAssetContainerAsync` mit `@babylonjs/loaders/glTF/2.0` über eine
 * `NullEngine` — ohne GPU, ohne Assets, ohne Netz. Was er beanstandet,
 * meldet Babylon über `Logger.Error`/`Logger.Warn`, NICHT als Ausnahme;
 * ein Test, der nur auf `throw` wartet, sähe eine kaputte Datei als
 * bestanden an. Der Lauschposten unten ist deshalb kein Beiwerk.
 *
 * ── Was der `__root__` hier zu suchen hat ────────────────────────────
 * Babylon hängt jedes glTF unter einen Knoten `__root__`, der glTFs
 * Rechtssystem auf Babylons Linkssystem dreht. Genau davor steht die
 * Vorspiegelung der Kit-Module: Sie ist die andere Hälfte dieser
 * Drehung.
 *
 * NACHGEMESSEN, NICHT ANGENOMMEN (04.09.2026): Der Knoten trägt NICHT
 * `scaling.x = -1`, wie man nach der Wirkung vermuten würde, sondern
 * `scaling = (1, 1, -1)` UND eine 180°-Drehung um y (Quaternion
 * 0/1/0/0). Erst beides zusammen ergibt die x-Negation. Ein Test, der
 * auf `scaling.x === -1` prüfte, wäre rot, obwohl alles stimmt — und
 * bei einem Babylon-Update, das dieselbe Wirkung anders zusammensetzt,
 * wieder. Deshalb misst der Test die WIRKUNG: wohin die drei
 * Einheitsachsen unter der Weltmatrix des `__root__` zeigen.
 *
 * Lauf:  npx tsx client/test/glb-saal-laden.ts
 *
 * The written hall through Babylon's real glTF loader on a NullEngine:
 * no loader error or warning, expected vertex/index counts, and a world
 * bounding box that survives the __root__ handedness flip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Logger } from '@babylonjs/core/Misc/logger';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
// Derselbe Seiteneffekt-Import wie in `AssetManager.ts` — ohne ihn kennt
// der SceneLoader die Endung `.glb` nicht.
import '@babylonjs/loaders/glTF/2.0';

import { buildHall } from '@wov/shared/src/hallenGeometrie.js';
import { encodeGlb } from '../../server/src/world/dungeon/GlbWriter.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}`);
  }
}

const TOL = 1e-3;
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Der Saal, den E1/E2 als Referenz führen: 3×3 Zellen, Raster 2, vier Pfeiler. */
const NAME = 'Gen_StoneVaultHall3x3';
const SAAL = buildHall(3, 3, { raster: 2 });

/**
 * Ein GLB in die Szene bringen, ohne Datei und ohne Server.
 *
 * Babylon nimmt `data:`-URLs als Dateinamen entgegen — der Weg, den auch
 * der Editor für Vorschauen nutzen kann. Im Node-Lauf ist er der
 * einzige: `Tools.LoadFile` ginge sonst über XMLHttpRequest, das es hier
 * nicht gibt.
 */
function alsDatenUrl(bytes: Uint8Array): string {
  return 'data:base64,' + Buffer.from(bytes).toString('base64');
}

interface Befund {
  readonly meldungen: string[];
  readonly namen: string[];
  readonly ecken: number;
  readonly indizes: number;
  readonly hatNormalen: boolean;
  /** Wohin die drei Einheitsachsen unter der Weltmatrix des `__root__` zeigen. */
  readonly rootAchsen: number[][];
  readonly min: number[];
  readonly max: number[];
}

async function laden(bytes: Uint8Array, meshName: string): Promise<Befund> {
  const engine = new NullEngine();
  const scene = new Scene(engine);

  /*
    Lauschposten. Babylon meldet einen ungültigen Accessor, einen
    fehlenden Pflichtwert oder eine unausgerichtete Länge über den
    Logger — die Ladezusage wird trotzdem erfüllt. Ohne diesen Mitschnitt
    wäre „lädt ohne Fehler" eine Behauptung über das Ausbleiben einer
    Ausnahme und nicht über die Datei.
  */
  const meldungen: string[] = [];
  const echterError = Logger.Error;
  const echterWarn = Logger.Warn;
  Logger.Error = (m: string | unknown[]) => {
    meldungen.push(`Error: ${String(m)}`);
  };
  Logger.Warn = (m: string | unknown[]) => {
    meldungen.push(`Warn: ${String(m)}`);
  };
  try {
    const container = await SceneLoader.LoadAssetContainerAsync(
      '',
      alsDatenUrl(bytes),
      scene,
      null,
      '.glb'
    );
    const mesh = container.meshes.find((m: AbstractMesh) => m.name === meshName);
    if (!mesh) throw new Error(`Mesh ${meshName} fehlt im Container`);
    const root = container.meshes.find((m: AbstractMesh) => m.name === '__root__');
    root?.computeWorldMatrix(true);
    const rootMatrix = root?.getWorldMatrix();

    // Welt-Hüllbox: erst nach dem `__root__` ist die Vorspiegelung zurückgedreht.
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo().boundingBox;
    return {
      meldungen,
      namen: container.meshes.map((m: AbstractMesh) => m.name),
      ecken: mesh.getTotalVertices(),
      indizes: mesh.getTotalIndices(),
      hatNormalen: mesh.isVerticesDataPresent(VertexBuffer.NormalKind),
      rootAchsen: rootMatrix
        ? [Vector3.Right(), Vector3.Up(), Vector3.Forward()].map((a) =>
            Vector3.TransformNormal(a, rootMatrix).asArray()
          )
        : [],
      min: [info.minimumWorld.x, info.minimumWorld.y, info.minimumWorld.z],
      max: [info.maximumWorld.x, info.maximumWorld.y, info.maximumWorld.z],
    };
  } finally {
    Logger.Error = echterError;
    Logger.Warn = echterWarn;
    scene.dispose();
    engine.dispose();
  }
}

const nahe = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;
const nahe3 = (a: readonly number[], b: readonly number[]): boolean =>
  a.every((v, i) => nahe(v, b[i]));

async function main(): Promise<void> {
  console.log('\nE2 — geschriebener Saal durch Babylons glTF-Lader\n');

  const b = await laden(encodeGlb(SAAL.boxes, { name: NAME }), NAME);
  console.log(
    `  ${NAME}: ${SAAL.boxes.length} Quader → ${b.ecken} Ecken, ${b.indizes / 3} Dreiecke, ` +
      `Knoten [${b.namen.join(', ')}]`
  );
  console.log(
    `  Welt-Hüllbox  ${b.min.map((v) => v.toFixed(3)).join(' / ')}  ..  ` +
      `${b.max.map((v) => v.toFixed(3)).join(' / ')}`
  );

  pruefe(
    b.meldungen.length === 0,
    `Lader meldet nichts${b.meldungen.length > 0 ? ` — aber: ${b.meldungen.join(' | ')}` : ''}`
  );
  pruefe(b.namen.length === 2 && b.namen.includes('__root__'), 'genau ein Mesh unter `__root__`');
  pruefe(b.ecken === 24 * SAAL.boxes.length, `${24 * SAAL.boxes.length} Ecken (24 je Quader)`);
  pruefe(b.indizes === 36 * SAAL.boxes.length, `${36 * SAAL.boxes.length} Indizes (36 je Quader)`);
  pruefe(b.hatNormalen, 'Normalen sind angekommen');
  console.log(
    `  __root__ dreht  x→${b.rootAchsen[0]?.map((v) => v.toFixed(0)).join('/')}  ` +
      `y→${b.rootAchsen[1]?.map((v) => v.toFixed(0)).join('/')}  ` +
      `z→${b.rootAchsen[2]?.map((v) => v.toFixed(0)).join('/')}`
  );
  pruefe(
    b.rootAchsen.length === 3 &&
      nahe3(b.rootAchsen[0], [-1, 0, 0]) &&
      nahe3(b.rootAchsen[1], [0, 1, 0]) &&
      nahe3(b.rootAchsen[2], [0, 0, 1]),
    '`__root__` negiert x und lässt y/z stehen — die Rückdrehung der Vorspiegelung'
  );
  /* 3×3 Zellen = 6 × 6 m; y von der Bodenunter- bis zur Deckenoberkante. */
  pruefe(
    nahe3(b.min, [-3, -0.25, -3]) && nahe3(b.max, [3, 3.75, 3]),
    'Welt-Hüllbox 6 × 6 m, y -0,25 … 3,75'
  );

  // ── Gegenprobe am Blender-Erzeugnis, wenn es da ist ──────────────────
  const referenzPfad = resolve(WURZEL, 'assets/models/StoneVaultHallLarge.glb');
  if (!existsSync(referenzPfad)) {
    console.log(
      '\n  ÜBERSPRUNGEN — assets/models/StoneVaultHallLarge.glb fehlt ' +
        '(assets/ liegt ausserhalb des Repos)'
    );
  } else {
    const r = await laden(readFileSync(referenzPfad), 'StoneVaultHallLarge');
    console.log(
      `\n  StoneVaultHallLarge (Blender): ${r.ecken} Ecken, ${r.indizes / 3} Dreiecke, ` +
        `Welt-Hüllbox ${r.min.map((v) => v.toFixed(3)).join(' / ')} .. ` +
        `${r.max.map((v) => v.toFixed(3)).join(' / ')}`
    );
    pruefe(r.ecken === b.ecken && r.indizes === b.indizes, 'gleiche Ecken- und Indexzahl');
    pruefe(nahe3(r.min, b.min) && nahe3(r.max, b.max), 'gleiche Welt-Hüllbox');
    pruefe(
      r.rootAchsen.every((a, i) => nahe3(a, b.rootAchsen[i])),
      'gleiche `__root__`-Drehung wie beim Blender-Erzeugnis'
    );
  }

  console.log(fehler === 0 ? '\nE2-Laden: alles grün.\n' : `\nE2-Laden: ${fehler} ROT.\n`);
  process.exit(fehler > 0 ? 1 : 0);
}

void main();
