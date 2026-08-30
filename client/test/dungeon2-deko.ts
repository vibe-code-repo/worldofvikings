/**
 * Prueft `DungeonDeko` (M1-Schritt 2) OHNE GPU, OHNE Netz.
 * Checks `DungeonDeko` (M1 step 2) WITHOUT a GPU, WITHOUT the network.
 *
 * `DungeonDeko.baue()` haengt an einer `DekoModellQuelle`
 * (`{ getMasters(name) }`) — genau die eine Methode, die `AssetManager`
 * ebenfalls traegt, aber strukturell, nicht durch Vererbung. Der Test setzt
 * deshalb eine ATTRAPPE ein: ein Wuerfel-Mesh statt eines geladenen GLB. Das
 * geht unter der `NullEngine` ohne jeden Dateizugriff und prueft trotzdem den
 * ECHTEN Weg — Gruppierung, Matrixbau, `thinInstanceSetBuffer`, Buchhaltung
 * —, nicht einen Nachbau davon.
 * `DungeonDeko.baue()` depends on a `DekoModellQuelle` — the one method
 * `AssetManager` also carries, structurally. The test substitutes a STUB (a
 * box mesh instead of a loaded GLB) — no file access under the NullEngine,
 * yet it exercises the REAL path: grouping, matrix construction,
 * `thinInstanceSetBuffer`, bookkeeping.
 *
 * Kriterium aus dem Arbeitsauftrag: „Ankerzahl == platzierte Instanzen (kein
 * stiller Schwund)". Gepruft als zwei Faelle:
 *  (a) jedes angeforderte Prefab hat ein Modell -> platziert == angefordert,
 *      und `thinInstanceCount` je Master traegt exakt die Ankerzahl der
 *      jeweiligen Gruppe (kein Schwund IN einem Master).
 *  (b) ein Prefab hat KEIN Modell -> `angefordert == platziert + ohneModell`
 *      (kein Anker verschwindet spurlos, er wird gezaehlt).
 * Criterion from the work order: "anchor count == placed instances (no
 * silent loss)". Checked as two cases: (a) every requested prefab has a
 * model; (b) one prefab has NO model — no anchor disappears without a trace,
 * it gets counted instead.
 */
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { dungeon2, type Hash } from '@wov/shared';
import {
  DungeonDeko,
  dekoWeltmatrix,
  gruppiereDekoNachPrefab,
  type DekoModellQuelle,
} from '../src/engine/DungeonDeko';
import type { PrefabMaster } from '../src/engine/AssetManager';

type BestuecktesTeil = dungeon2.BestuecktesTeil;

let rot = 0;
function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.error(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

async function pruefeAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    rot++;
    console.error(`  ROT  ${name}: ${(e as Error).message}`);
  }
}

const engine = new NullEngine();
const szene = new Scene(engine);

// ─────────────────────────────────────────────────────────────────────────────
// 0. Werkzeug — echte Anker aus dem echten Bestuecker, keine Handattrappe
//    Tooling — real anchors from the real furnisher, not a hand-rolled stub
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Die echten bestueckten Deko-Teile eines Steingrabs — derselbe Pfad, den
 * `DungeonBauer` im Konstruktor geht (`baueGeometrie` -> `dekoPlaetze` ->
 * `bestuecke`). Ein handgeschriebenes Array aus Fantasiepositionen wuerde nur
 * die eigene Vermutung ueber die Form eines `BestuecktesTeil` pruefen, nicht
 * die echte.
 * The real furnished decor pieces of a barrow — the same path the builder's
 * constructor takes. A hand-written array of invented positions would only
 * test one's own guess at the shape of a `BestuecktesTeil`, not the real one.
 */
function echteDekoTeile(seed: number): readonly BestuecktesTeil[] {
  const layout = dungeon2.erzeugeLayout(dungeon2.STEINGRAB, {
    architektur: seed,
    material: 4711,
    deko: 815,
  });
  const gitter = dungeon2.zellenAufbauen(layout);
  const ergebnis = dungeon2.baueGeometrie(layout, { gitter });
  const profil = dungeon2.themaFinden(layout.thema)!;
  return dungeon2.bestuecke(ergebnis.dekoPlaetze, profil);
}

/** Ein Wuerfel als Stellvertreter fuer ein geladenes GLB-Master-Mesh. */
/** A box standing in for a loaded GLB master mesh. */
function fauxMaster(name: string): PrefabMaster {
  const mesh: Mesh = MeshBuilder.CreateBox(name, { size: 0.3 }, szene);
  mesh.setEnabled(false);
  return { mesh, localMatrix: Matrix.Identity() };
}

/** Modellquelle, die fuer benannte Prefabs eine Attrappe liefert, sonst nichts. */
/** Model source that supplies a stub for named prefabs, nothing otherwise. */
function machQuelle(vorhanden: readonly string[]): DekoModellQuelle {
  const gecacht = new Map<string, PrefabMaster[]>();
  return {
    async getMasters(name: string): Promise<PrefabMaster[]> {
      if (!vorhanden.includes(name)) return [];
      let liste = gecacht.get(name);
      if (liste === undefined) {
        liste = [fauxMaster(`master_${name}`)];
        gecacht.set(name, liste);
      }
      return liste;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reine Bausteine / pure building blocks
// ─────────────────────────────────────────────────────────────────────────────

pruefe('gruppiereDekoNachPrefab verliert keinen Anker', () => {
  const teile = echteDekoTeile(1234);
  assert.ok(teile.length > 0, 'kein einziger Anker aufgeloest — Testgrundlage kaputt');
  const gruppen = gruppiereDekoNachPrefab(teile);
  let summe = 0;
  for (const gruppe of gruppen.values()) summe += gruppe.length;
  assert.equal(summe, teile.length);
});

pruefe('gruppiereDekoNachPrefab ist reihenfolgestabil (nach ankerId sortiert)', () => {
  const teile = echteDekoTeile(1234);
  const vorwaerts = gruppiereDekoNachPrefab(teile);
  const rueckwaerts = gruppiereDekoNachPrefab([...teile].reverse());
  for (const [prefab, gruppe] of vorwaerts) {
    const andere = rueckwaerts.get(prefab)!;
    assert.deepEqual(
      gruppe.map((t) => t.ankerId),
      andere.map((t) => t.ankerId),
      `Prefab ${prefab}: Gruppenreihenfolge haengt von der Aufrufreihenfolge ab`
    );
  }
});

pruefe('dekoWeltmatrix: Position kommt unveraendert durch, Drehung 0 ist die Identitaet in der Ebene', () => {
  const teil: BestuecktesTeil = {
    ankerId: 1,
    stempelId: 0,
    block: { bx: 0, bz: 0, ebene: 0 },
    rolle: 'fackel',
    prefab: 'CryptWallTorch',
    prefabHash: 0 as Hash,
    ort: 0 as dungeon2.AnkerOrt,
    position: { x: 3, y: 1.5, z: -7 },
    drehung: 0,
  };
  const m = dekoWeltmatrix(teil);
  const pos = new Vector3();
  m.getTranslationToRef(pos);
  assert.equal(pos.x, 3);
  assert.equal(pos.y, 1.5);
  assert.equal(pos.z, -7);
});

pruefe('dekoWeltmatrix: alle vier Vierteldrehungen liefern verschiedene, um 90 Grad versetzte Matrizen', () => {
  const basis: Omit<BestuecktesTeil, 'drehung'> = {
    ankerId: 1,
    stempelId: 0,
    block: { bx: 0, bz: 0, ebene: 0 },
    rolle: 'fackel',
    prefab: 'CryptWallTorch',
    prefabHash: 0 as Hash,
    ort: 0 as dungeon2.AnkerOrt,
    position: { x: 0, y: 0, z: 0 },
  };
  // Ein Referenzpunkt (1,0,0), durch jede der vier Matrizen geschickt — bei
  // einer reinen Y-Drehung in 90-Grad-Schritten muss er viermal an eine
  // ANDERE Stelle wandern und beim fuenften (=ersten) wieder ankommen.
  // A reference point run through each matrix — pure 90-degree Y turns must
  // land it on four DIFFERENT spots and back at the start on the fifth.
  const punkt = new Vector3(1, 0, 0);
  const ergebnisse: Vector3[] = [];
  for (const drehung of [0, 1, 2, 3] as const) {
    const m = dekoWeltmatrix({ ...basis, drehung });
    ergebnisse.push(Vector3.TransformCoordinates(punkt, m));
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      assert.ok(
        !ergebnisse[i]!.equalsWithEpsilon(ergebnisse[j]!, 1e-6),
        `Drehung ${i} und ${j} landen am selben Punkt`
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DungeonDeko.baue() — kein stiller Schwund
// ─────────────────────────────────────────────────────────────────────────────

await pruefeAsync(
  'jeder Fackelanker bekommt eine Instanz, wenn beide Fackel-Prefabs ein Modell haben',
  async () => {
    const teile = echteDekoTeile(1234).filter((t) => t.rolle === 'fackel');
    assert.ok(teile.length > 0);
    const prefabs = [...new Set(teile.map((t) => t.prefab))];
    const quelle = machQuelle(prefabs);
    const deko = new DungeonDeko(quelle);
    const statistik = await deko.baue(teile);

    assert.equal(statistik.angefordert, teile.length);
    assert.equal(statistik.platziert, teile.length);
    assert.equal(statistik.ohneModell, 0);
    assert.deepEqual(statistik.prefabsOhneModell, []);

    // Kein Schwund INNERHALB eines Masters: die Summe der thinInstanceCount
    // ueber alle benutzten Master muss die Ankerzahl treffen.
    // No loss WITHIN a master: the sum of thinInstanceCount across every
    // master used must match the anchor count.
    let instanzen = 0;
    for (const mesh of deko.master) instanzen += mesh.thinInstanceCount;
    assert.equal(instanzen, teile.length);
    deko.dispose();
  }
);

await pruefeAsync(
  'ein Prefab ohne Modell verschwindet nicht — es wird gezaehlt, nicht verschluckt',
  async () => {
    const teile = echteDekoTeile(1234).filter((t) => t.rolle === 'fackel');
    const prefabs = [...new Set(teile.map((t) => t.prefab))];
    assert.ok(prefabs.length >= 2, 'Testgrundlage braucht mindestens zwei Fackel-Prefabs');
    // Nur DAS ERSTE Prefab bekommt ein Modell — die Attrappe fuer das zweite
    // bleibt aus, wie ein 404 beim echten Laden.
    // Only the FIRST prefab gets a model — no stub for the second, like a
    // real 404.
    const quelle = machQuelle([prefabs[0]!]);
    const deko = new DungeonDeko(quelle);
    const statistik = await deko.baue(teile);

    assert.equal(statistik.angefordert, teile.length);
    assert.equal(
      statistik.platziert + statistik.ohneModell,
      statistik.angefordert,
      'ein Anker ist weder platziert noch als "ohne Modell" gezaehlt — stiller Schwund'
    );
    assert.ok(statistik.ohneModell > 0, 'Testgrundlage: das fehlende Prefab haette Anker treffen muessen');
    assert.deepEqual(statistik.prefabsOhneModell, [prefabs[1]!]);
    deko.dispose();
  }
);

await pruefeAsync('alle Rollen zusammen: Ankerzahl == platzierte + ohne Modell, ueber drei Seeds', async () => {
  for (const seed of [1234, 7, 99]) {
    const teile = echteDekoTeile(seed);
    const prefabs = [...new Set(teile.map((t) => t.prefab))];
    // Zufaellig genau die Haelfte der Prefabs "vorhanden" — die Buchhaltung
    // muss so oder so aufgehen, unabhaengig davon, welche Haelfte es ist.
    // Exactly half the prefabs "present", chosen at random — the bookkeeping
    // must balance either way.
    const vorhanden = prefabs.filter((_, i) => i % 2 === 0);
    const quelle = machQuelle(vorhanden);
    const deko = new DungeonDeko(quelle);
    const statistik = await deko.baue(teile);
    assert.equal(
      statistik.platziert + statistik.ohneModell,
      statistik.angefordert,
      `Seed ${seed}: ${statistik.angefordert} Anker, aber ${statistik.platziert} + ${statistik.ohneModell} gezaehlt`
    );
    deko.dispose();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sabotage-Probe — der Waechter muss den Fehler VOR dem Fix finden
//    Sabotage probe — the guard must catch the fault BEFORE the fix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Baut wie `DungeonDeko.baue()`, aber mit der urspruenglich erwogenen
 * (fehlerhaften) Fassung: `ohneModell` wird nie erhoeht — ein Prefab ohne
 * Modell verschwindet spurlos. Diese Funktion existiert NUR, um zu zeigen,
 * dass die Zusicherung oben den Fehler findet, bevor `DungeonDeko` ihn
 * behebt (Vault-Notiz „Angreifer-Review statt Pruef-Review": der Test soll
 * die Absicherung umgehen koennen, nicht sie bestaetigen).
 * Builds like `DungeonDeko.baue()`, but with the originally considered
 * (faulty) version: `ohneModell` is never incremented — a modelless prefab
 * vanishes without a trace. Exists ONLY to prove the assertion above catches
 * the fault before the fix.
 */
async function baueMitSchwund(
  quelle: DekoModellQuelle,
  teile: readonly BestuecktesTeil[]
): Promise<{ angefordert: number; platziert: number; ohneModell: number }> {
  const gruppen = gruppiereDekoNachPrefab(teile);
  let platziert = 0;
  for (const [prefab, gruppe] of gruppen) {
    const masters = await quelle.getMasters(prefab);
    if (masters.length === 0) continue; // BUG: der Anker wird nirgends gezaehlt
    platziert += gruppe.length;
  }
  return { angefordert: teile.length, platziert, ohneModell: 0 };
}

await pruefeAsync('Gegenprobe: die Schwund-Fassung faerbt dieselbe Zusicherung rot', async () => {
  const teile = echteDekoTeile(1234).filter((t) => t.rolle === 'fackel');
  const prefabs = [...new Set(teile.map((t) => t.prefab))];
  assert.ok(prefabs.length >= 2);
  const quelle = machQuelle([prefabs[0]!]);
  const schwund = await baueMitSchwund(quelle, teile);
  assert.throws(
    () =>
      assert.equal(
        schwund.platziert + schwund.ohneModell,
        schwund.angefordert,
        'sollte hier eigentlich fehlschlagen'
      ),
    /sollte hier eigentlich fehlschlagen/,
    'die Schwund-Fassung haette die Zusicherung ROT faerben muessen, tat es aber nicht'
  );
});

szene.dispose();
engine.dispose();

console.log(rot === 0 ? 'alles gruen' : `${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
