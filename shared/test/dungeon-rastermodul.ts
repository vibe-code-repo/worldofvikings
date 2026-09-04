/**
 * G2 (Modul-Generierung 2.0) — Wächter über die Selbstbeschreibung der
 * StoneVault-Module.
 *
 * ── Warum dieser Test und nicht der Generator ────────────────────────
 * `rasterKanten` ist eine ERKLÄRUNG über das GLB, keine Messung an ihm
 * (Risikoabschnitt der Konzeptnotiz). Wer `make-stonevault.py` ändert und
 * `eigeneDungeons.ts` vergisst, bekommt ab da eine Kantentafel, die etwas
 * behauptet, was im Modell nicht steht — und der Fehler fällt erst im
 * fertigen Grab auf, als Wand vor einer Öffnung. Dagegen steht hier die
 * einzige Grösse, die BEIDE Seiten kennen: die Connectors. Sie stehen in
 * derselben Datei wie die Erklärung und werden aus dem Modell exportiert.
 *
 * Deshalb ist die Kernprüfung eine Äquivalenz in beide Richtungen:
 * Jeder Connector liegt auf einer als `offen` erklärten Aussenkante, und
 * jede als `offen` erklärte Aussenkante trägt genau einen Connector. Eine
 * vergessene Wandkante ist damit kein stiller Vorgabewert mehr, sondern
 * ein roter Test — `modulAusRoomDef` verlangt für jede waagerechte
 * Aussenkante eine Aussage.
 *
 * Der Generator wird hier NICHT angefasst; `tools/messe-stonevault-logik.ts`
 * bleibt gegen den heutigen Stand rot. G2 erklärt nur.
 */
import {
  DUNGEONS_BY_NAME,
  MODUL_EBENE_M,
  MODUL_ZELLE_M,
  RICHTUNGEN,
  istWaagerecht,
  modulAusRoomDef,
  type Kantenzustand,
  type Modul,
  type ModulZelle,
  type Quaternion,
  type Richtung,
  type RoomConnectionDef,
  type RoomDef,
  type Vector3,
} from '../src/index.js';
import { quatMulVec3 } from '../src/worldgen/Math3d.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Toleranz für Lagevergleiche. Grosszügiger als der Exportfehler, enger als ein Millimeter. */
const TOL = 1e-6;

const EINHEIT: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
/** Die vier Gierungen des Kits — mehr gibt es im Raster nicht. */
const GIERUNGEN: readonly Quaternion[] = [
  EINHEIT,
  { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
  { x: 0, y: 1, z: 0, w: 0 },
  { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
];

const kit = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!kit) {
  console.error('FEHLER: Kit DG_StoneVault nicht gefunden.');
  process.exit(1);
}

const raumNach = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));
function holeModul(name: string): Modul {
  const raum = raumNach.get(name);
  if (!raum) throw new Error(`Raum '${name}' fehlt im Kit`);
  return modulAusRoomDef(raum);
}

function zelle(m: Modul, a: number, b: number, e: number): ModulZelle {
  const z = m.zellen.find((c) => c.a === a && c.b === b && c.e === e);
  if (!z) throw new Error(`${m.name}: Zelle (${a},${b},${e}) fehlt`);
  return z;
}

function kante(m: Modul, a: number, b: number, e: number, r: Richtung): Kantenzustand {
  return zelle(m, a, b, e).kanten[r];
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n1) Fussabdruck, Ebenen, Anker');
// ─────────────────────────────────────────────────────────────────────
{
  const soll: Record<string, readonly [number, number, number]> = {
    // Innenmass 1,4 zählt wie das volle Rastermass 2 — die eingebaute
    // Wand liegt INNERHALB der Zelle, sie verkleinert den Fussabdruck nicht.
    StoneVaultEntry: [1, 1, 1],
    StoneVaultCell: [1, 1, 1],
    StoneVaultCorridor: [1, 1, 1],
    StoneVaultCorner: [1, 1, 1],
    StoneVaultJunction: [1, 1, 1],
    StoneVaultHall: [2, 2, 1],
    // Drei Zellen Lauf auf ZWEI Ebenen: die obere Ebene ist Luftraum,
    // gehört aber zum Modul (Konzept S3) — sonst wächst ein zweiter Ast
    // in die Treppenspitze hinein.
    StoneVaultStairs: [1, 3, 2],
  };
  for (const [name, [x, z, e]] of Object.entries(soll)) {
    const m = holeModul(name);
    pruefe(m.zellenX === x, `${name}: zellenX ${m.zellenX}, erwartet ${x}`);
    pruefe(m.zellenZ === z, `${name}: zellenZ ${m.zellenZ}, erwartet ${z}`);
    pruefe(m.ebenen === e, `${name}: ebenen ${m.ebenen}, erwartet ${e}`);
    pruefe(
      m.zellen.length === x * z * e,
      `${name}: ${m.zellen.length} Zellen, erwartet ${x * z * e}`
    );
    pruefe(!m.verschluss, `${name}: darf kein Verschlussmodul sein`);
  }
  console.log(`  ${Object.keys(soll).length} Zellmodule mit erwartetem Fussabdruck`);

  // Die Wand belegt KEINE Zelle: 0,3 m quer in der Kantenebene. Wer sie
  // als Zelle führte, hielte jede versiegelte Kante für belegt.
  const wand = holeModul('StoneVaultWall');
  pruefe(wand.verschluss, 'StoneVaultWall: muss Verschlussmodul sein');
  pruefe(wand.zellen.length === 0, `StoneVaultWall: ${wand.zellen.length} Zellen, erwartet 0`);
  pruefe(wand.ports.length === 0, `StoneVaultWall: ${wand.ports.length} Ports, erwartet 0`);
  pruefe(wand.anker === null, 'StoneVaultWall: kein Anker');

  // Der Anker ist der Eingangsconnector — an ihm hängt G3 den Grundriss
  // auf (Raum 0 landet auf pos (0,0,−1), Rotation 180°).
  const entry = holeModul('StoneVaultEntry');
  pruefe(entry.anker !== null, 'StoneVaultEntry: Anker fehlt');
  pruefe(entry.anker?.richtung === 's', `StoneVaultEntry: Anker zeigt nach ${entry.anker?.richtung}, erwartet s`);
  for (const name of ['StoneVaultCell', 'StoneVaultCorridor', 'StoneVaultHall', 'StoneVaultStairs']) {
    pruefe(holeModul(name).anker === null, `${name}: darf keinen Anker haben`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Connector ⇔ offene Aussenkante (beide Richtungen)');
// ─────────────────────────────────────────────────────────────────────
{
  let ports = 0;
  let offeneKanten = 0;
  for (const raum of kit.rooms) {
    const m = modulAusRoomDef(raum);
    if (m.verschluss) continue;

    // Hinrichtung: jeder Connector sitzt auf genau einer Zellkante, und
    // die ist als `offen` erklärt.
    pruefe(
      m.ports.length === raum.connections.length,
      `${m.name}: ${m.ports.length} Ports aus ${raum.connections.length} Connectors`
    );
    for (const p of m.ports) {
      ports++;
      const c = raum.connections[p.connector]!;
      const z = m.zellen[p.zelle]!;
      pruefe(
        z.kanten[p.richtung] === 'offen',
        `${m.name}: Connector ${p.connector} liegt auf Kante ${p.richtung} der Zelle ` +
          `(${z.a},${z.b},${z.e}), die als '${z.kanten[p.richtung]}' erklärt ist`
      );
      pruefe(
        !z.innen[p.richtung],
        `${m.name}: Connector ${p.connector} liegt auf einer INNENkante — dort kann nie ein Nachbar andocken`
      );
      // Der geometrische Zeuge: die zurückgerechnete Kantenmitte muss die
      // Connectorlage treffen. Sonst hat sich das Modell unter der
      // Erklärung wegbewegt.
      const d = Math.hypot(
        p.lokaleKantenmitte.x - c.localPos.x,
        p.lokaleKantenmitte.y - c.localPos.y,
        p.lokaleKantenmitte.z - c.localPos.z
      );
      pruefe(
        d < TOL,
        `${m.name}: Connector ${p.connector} liegt ${d.toExponential(2)} m neben der Kantenmitte`
      );
    }

    // Rückrichtung: keine offene Aussenkante ohne Connector. Genau das
    // wäre die „Öffnung ins Leere", die der Generator nie bemerkt.
    for (const z of m.zellen) {
      for (const r of RICHTUNGEN) {
        if (!istWaagerecht(r) || z.innen[r]) continue;
        if (z.kanten[r] !== 'offen') continue;
        offeneKanten++;
        const treffer = m.ports.filter((p) => m.zellen[p.zelle] === z && p.richtung === r);
        pruefe(
          treffer.length === 1,
          `${m.name}: Zelle (${z.a},${z.b},${z.e}) ist nach ${r} offen erklärt, ` +
            `trägt aber ${treffer.length} Connectors`
        );
      }
    }
  }
  pruefe(ports === offeneKanten, `${ports} Ports gegen ${offeneKanten} offene Aussenkanten`);
  console.log(`  ${ports} Connectors, ${offeneKanten} offene Aussenkanten — deckungsgleich`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Zellmitten auf (2i, 3,5e, 2j−1)');
// ─────────────────────────────────────────────────────────────────────
{
  // Der Eingang ist der Nullpunkt des Rasters: `placeStartRoom` setzt ihn
  // auf pos (0,0,−1) mit 180°, damit sein Eingangsconnector auf (0,0,0)
  // landet. Deshalb 2j−1 und nicht 2j — der Fehler aus Entwurf 2.
  const entry = holeModul('StoneVaultEntry');
  const mitte = entry.zellen[0]!.lokaleMitte;
  const welt = { x: 0 + mitte.x, y: 0 + mitte.y, z: -1 + mitte.z };
  pruefe(
    Math.abs(welt.x - 2 * 0) < TOL &&
      Math.abs(welt.y - MODUL_EBENE_M * 0) < TOL &&
      Math.abs(welt.z - (2 * 0 - 1)) < TOL,
    `Eingangszelle landet auf (${welt.x}, ${welt.y}, ${welt.z}), erwartet (0, 0, −1)`
  );

  // Und allgemein: hängt man ein Modul mit EINER Zelle ins Raster, müssen
  // ALLE seine Zellen im Raster liegen — für jede der vier Gierungen. Ein
  // Modul mit gerader Zellzahl (die Halle) sitzt dabei mit seinem Pivot
  // zwischen den Zellen; genau dort bricht eine naive Rundung.
  let geprueft = 0;
  for (const raum of kit.rooms) {
    const m = modulAusRoomDef(raum);
    if (m.verschluss) continue;
    for (const gierung of GIERUNGEN) {
      for (const [i, j, e] of [
        [0, 0, 0],
        [3, -2, 1],
        [-7, 11, 5],
      ] as const) {
        // Ankerzelle 0 soll auf (2i, 3,5e, 2j−1) liegen; daraus folgt pos.
        const a0 = m.zellen[0]!;
        const gedreht0 = quatMulVec3(gierung, a0.lokaleMitte);
        const pos = {
          x: 2 * i - gedreht0.x,
          y: MODUL_EBENE_M * e - gedreht0.y,
          z: 2 * j - 1 - gedreht0.z,
        };
        for (const z of m.zellen) {
          const g = quatMulVec3(gierung, z.lokaleMitte);
          const wx = pos.x + g.x;
          const wy = pos.y + g.y;
          const wz = pos.z + g.z;
          const di = Math.abs(wx - Math.round(wx / MODUL_ZELLE_M) * MODUL_ZELLE_M);
          const de = Math.abs(wy - Math.round(wy / MODUL_EBENE_M) * MODUL_EBENE_M);
          const dj = Math.abs(wz - (Math.round((wz + 1) / MODUL_ZELLE_M) * MODUL_ZELLE_M - 1));
          geprueft++;
          pruefe(
            di < 1e-4 && de < 1e-4 && dj < 1e-4,
            `${m.name}: Zelle (${z.a},${z.b},${z.e}) landet auf ` +
              `(${wx.toFixed(4)}, ${wy.toFixed(4)}, ${wz.toFixed(4)}) — Abweichung ` +
              `(${di.toExponential(1)}, ${de.toExponential(1)}, ${dj.toExponential(1)})`
          );
        }
      }
    }
  }
  console.log(`  ${geprueft} Zellmitten über 4 Gierungen und 3 Ankerzellen im Raster`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Eingebaute Wände: Korridor, Ecke, Abzweig');
// ─────────────────────────────────────────────────────────────────────
{
  // Diese drei tragen ihre Wände über die VOLLE Ebenenhöhe
  // (−0,25 … 3,75, make-stonevault.py:56-59). Genau darauf beruht Zeile 3
  // der Versiegelungstafel: gegen `wand` wird KEINE Platte gesetzt — die
  // 531 überflüssigen Platten des Befunds.
  const voll: Record<string, readonly Richtung[]> = {
    StoneVaultCorridor: ['o', 'w'],
    StoneVaultCorner: ['s', 'w'],
    StoneVaultJunction: ['w'],
  };
  for (const [name, wandkanten] of Object.entries(voll)) {
    const m = holeModul(name);
    for (const r of RICHTUNGEN) {
      if (!istWaagerecht(r)) continue;
      const soll: Kantenzustand = wandkanten.includes(r) ? 'wand' : 'offen';
      pruefe(
        kante(m, 0, 0, 0, r) === soll,
        `${name}: Kante ${r} ist '${kante(m, 0, 0, 0, r)}', erwartet '${soll}'`
      );
    }
  }
  console.log('  Korridor o/w, Ecke s/w, Abzweig w tragen volle Wände');

  // Die offenen Füller haben KEINE eingebaute Wand — vier freie Kanten.
  for (const name of ['StoneVaultEntry', 'StoneVaultCell']) {
    const m = holeModul(name);
    for (const r of RICHTUNGEN) {
      if (!istWaagerecht(r)) continue;
      pruefe(kante(m, 0, 0, 0, r) === 'offen', `${name}: Kante ${r} ist nicht offen`);
    }
  }
  // Die Halle ebenso, auf allen acht Aussenkanten.
  const halle = holeModul('StoneVaultHall');
  let hallenkanten = 0;
  for (const z of halle.zellen) {
    for (const r of RICHTUNGEN) {
      if (!istWaagerecht(r) || z.innen[r]) continue;
      hallenkanten++;
      pruefe(
        z.kanten[r] === 'offen',
        `StoneVaultHall: Aussenkante ${r} an (${z.a},${z.b}) ist '${z.kanten[r]}'`
      );
    }
  }
  pruefe(hallenkanten === 8, `StoneVaultHall: ${hallenkanten} Aussenkanten, erwartet 8`);
  console.log('  Zelle, Eingang und Halle ohne eingebaute Wand');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Die Treppe: zwei Ebenen, Keilflanken, senkrechte Kante');
// ─────────────────────────────────────────────────────────────────────
{
  const t = holeModul('StoneVaultStairs');
  pruefe(t.ebenen === 2 && t.zellen.length === 6, `Treppe: ${t.zellen.length} Zellen auf ${t.ebenen} Ebenen`);
  for (const e of [0, 1]) {
    const anzahl = t.zellen.filter((z) => z.e === e).length;
    pruefe(anzahl === 3, `Treppe: Ebene ${e} hat ${anzahl} Zellen, erwartet 3`);
  }

  // Die Flanken sind Keile, die mit dem Lauf steigen (:483-491) — sie
  // decken die Kante je Ebene nur zum Teil. Deshalb `wandTeilweise` und
  // nicht `wand`: Zeile 4 der Tafel setzt dort weiter eine Platte, und
  // genau das hält die 414 Platten gegen die Treppe in der Klasse „nötig".
  let flanken = 0;
  for (const z of t.zellen) {
    for (const r of ['o', 'w'] as const) {
      flanken++;
      pruefe(
        z.kanten[r] === 'wandTeilweise',
        `Treppe: Flanke ${r} an (${z.a},${z.b},${z.e}) ist '${z.kanten[r]}', erwartet wandTeilweise`
      );
    }
  }
  pruefe(flanken === 12, `Treppe: ${flanken} Flankenkanten, erwartet 12`);

  // Genau zwei Ports: unten Süd auf Ebene 0, oben Nord auf Ebene 1.
  pruefe(t.ports.length === 2, `Treppe: ${t.ports.length} Ports, erwartet 2`);
  const unten = t.ports.find((p) => p.richtung === 's');
  const oben = t.ports.find((p) => p.richtung === 'n');
  pruefe(unten !== undefined && t.zellen[unten.zelle]!.e === 0 && t.zellen[unten.zelle]!.b === 0,
    'Treppe: unterer Port sitzt nicht auf der Südzelle der Ebene 0');
  pruefe(oben !== undefined && t.zellen[oben.zelle]!.e === 1 && t.zellen[oben.zelle]!.b === 2,
    'Treppe: oberer Port sitzt nicht auf der Nordzelle der Ebene 1');

  // Die senkrechte Kante: genau EINE Oberkante und EINE Unterkante sind
  // offen, und beide sind zwei Seiten derselben Innenkante. Ohne sie
  // hinge die Treppenspitze im Graphen an nichts — der Fund, der laut
  // Konzept in keiner Zählung auffällt, sondern erst in der Sackgasse.
  const obenOffen = t.zellen.filter((z) => z.kanten.oben === 'offen');
  const untenOffen = t.zellen.filter((z) => z.kanten.unten === 'offen');
  pruefe(obenOffen.length === 1, `Treppe: ${obenOffen.length} offene Oberkanten, erwartet 1`);
  pruefe(untenOffen.length === 1, `Treppe: ${untenOffen.length} offene Unterkanten, erwartet 1`);
  if (obenOffen.length === 1 && untenOffen.length === 1) {
    const o = obenOffen[0]!;
    const u = untenOffen[0]!;
    pruefe(
      o.a === u.a && o.b === u.b && o.e + 1 === u.e,
      `Treppe: offene Ober-/Unterkante liegen nicht übereinander ` +
        `((${o.a},${o.b},${o.e}) / (${u.a},${u.b},${u.e}))`
    );
    pruefe(o.e === 0 && o.b === 2, `Treppe: der Ebenenwechsel sitzt auf (${o.a},${o.b},${o.e}), erwartet (0,2,0)`);
    pruefe(o.innen.oben && u.innen.unten, 'Treppe: der Ebenenwechsel ist keine Innenkante');
  }
  console.log('  Treppe: 6 Zellen, 12 Keilflanken, 2 Ports, 1 senkrechte Kante');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Boden und Decke sind Wand — ausser bei der Treppe');
// ─────────────────────────────────────────────────────────────────────
{
  // Vorgabe aus dem Konzept (S0). Sie ist der Grund, warum ein Grundriss
  // nicht durch den Boden wächst: Ein Ebenenwechsel muss ERKLÄRT werden.
  let senkrecht = 0;
  let offen = 0;
  for (const raum of kit.rooms) {
    const m = modulAusRoomDef(raum);
    for (const z of m.zellen) {
      for (const r of ['oben', 'unten'] as const) {
        senkrecht++;
        if (z.kanten[r] === 'offen') {
          offen++;
          pruefe(
            m.name === 'StoneVaultStairs',
            `${m.name}: Zelle (${z.a},${z.b},${z.e}) ist nach ${r} offen — nur die Treppe darf das`
          );
        } else {
          pruefe(
            z.kanten[r] === 'wand',
            `${m.name}: Zelle (${z.a},${z.b},${z.e}) hat ${r} = '${z.kanten[r]}', erwartet wand`
          );
        }
      }
    }
  }
  pruefe(offen === 2, `${offen} offene senkrechte Kanten im Kit, erwartet 2`);
  console.log(`  ${senkrecht} senkrechte Kanten, davon ${offen} offen (beide an der Treppe)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Vollständigkeit und Widerspruch schlagen fehl');
// ─────────────────────────────────────────────────────────────────────
{
  // Die Erklärung ist nur so viel wert, wie sie erzwungen wird. Diese
  // drei Fälle sind der Grund, warum `modulAusRoomDef` wirft statt still
  // ein `wand` einzusetzen: Ein vergessener Eintrag sähe sonst genauso
  // aus wie eine bewusste Wand.
  const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
  const conn = (localPos: Vector3, localRot: Quaternion): RoomConnectionDef => ({
    type: 'cellEdge',
    entrance: false,
    allowDoor: true,
    doorOnlyIfOtherAlsoAllowsDoor: false,
    localPos,
    localRot,
  });
  const grundriss = (
    connections: readonly RoomConnectionDef[],
    rasterKanten?: RoomDef['rasterKanten']
  ): RoomDef => ({
    name: 'TestModul',
    hash: 0,
    divider: false,
    endCap: false,
    endCapPrio: 0,
    entrance: false,
    faceCenter: false,
    minPlaceOrder: 0,
    perimeter: false,
    size: v(2, MODUL_EBENE_M, 2),
    theme: 1,
    weight: 1,
    pos: v(0, 0, 0),
    rot: EINHEIT,
    connections,
    ...(rasterKanten ? { rasterKanten } : {}),
  });
  const NORD = conn(v(0, 0, 1), EINHEIT);
  const wirft = (raum: RoomDef, was: string): void => {
    try {
      modulAusRoomDef(raum);
      pruefe(false, `${was}: hätte werfen müssen`);
    } catch {
      /* erwartet */
    }
  };

  // (a) Drei Aussenkanten ohne Connector und ohne Erklärung.
  wirft(grundriss([NORD]), 'unerklärte Aussenkante');

  // (b) Widerspruch: eine EINZELZEILE behauptet eine Wand genau dort, wo
  //     ein Connector sitzt.
  wirft(
    grundriss([NORD], [
      { zelle: { a: 0, b: 0, e: 0 }, kanten: ['n'], zustand: 'wand' },
      { kanten: ['o', 's', 'w'], zustand: 'wand' },
    ]),
    'Wand über einem Connector'
  );

  // (b2) Die Fläche darf denselben Namen tragen, ohne den Ausgang
  //      zuzumauern — sonst müsste die Treppe ihre zwölf Flanken einzeln
  //      aufzählen, nur weil zwei Kanten desselben Namens Ausgänge sind.
  try {
    const m = modulAusRoomDef(grundriss([NORD], [{ kanten: ['n', 'o', 's', 'w'], zustand: 'wand' }]));
    pruefe(m.zellen[0]!.kanten.n === 'offen', 'Aussenhaut-Regel mauert den Ausgang zu');
    pruefe(m.zellen[0]!.kanten.o === 'wand', 'Aussenhaut-Regel greift nicht');
  } catch (e) {
    pruefe(false, `Aussenhaut-Regel über einem Ausgang wirft: ${(e as Error).message}`);
  }

  // (c) Vollständig und widerspruchsfrei — muss durchgehen.
  const gut = grundriss([NORD], [{ kanten: ['o', 's', 'w'], zustand: 'wand' }]);
  try {
    const m = modulAusRoomDef(gut);
    pruefe(m.zellen[0]!.kanten.n === 'offen', 'Testmodul: Nordkante nicht offen');
    pruefe(m.zellen[0]!.kanten.s === 'wand', 'Testmodul: Südkante nicht wand');
  } catch (e) {
    pruefe(false, `vollständiges Testmodul wirft trotzdem: ${(e as Error).message}`);
  }

  // (d) Einseitige Innenkante: oben offen, die Gegenseite bleibt Wand.
  //     Ein solcher Ebenenwechsel wäre eine Einbahnstrasse durch Stein.
  const zweistoeckig: RoomDef = {
    ...grundriss([NORD, conn(v(0, MODUL_EBENE_M, 1), EINHEIT)], [
      { kanten: ['o', 's', 'w'], zustand: 'wand' },
      { zelle: { a: 0, b: 0, e: 0 }, kanten: ['oben'], zustand: 'offen' },
    ]),
    size: v(2, 2 * MODUL_EBENE_M, 2),
  };
  wirft(zweistoeckig, 'einseitige senkrechte Innenkante');
  console.log('  fünf Wächterfälle greifen');
}

console.log(fehler === 0 ? '\nOK — alle Module erklären sich vollständig' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
