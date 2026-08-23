/**
 * Wächter für die Rasterprüfung eigener Dungeon-Bauteile.
 *
 * Zwei Blöcke, und der zweite ist der eigentliche Zweck:
 *
 *  1. Jede Regel einzeln, an handgebauten Bauteilen. Hier wird geprüft,
 *     ob die PRÜFUNG stimmt.
 *  2. Ein Durchlauf über alle Räume, die `istEigenesModell()` als eigene
 *     führt. Hier wird geprüft, ob die BAUTEILE stimmen. Solange es keine
 *     gibt, läuft dieser Block leer durch — genau so ist er gemeint: Der
 *     Wächter steht, bevor das erste Modell entsteht.
 *
 * ⚠ Die 374 geparsten Fremdräume werden ABSICHTLICH nicht geprüft.
 * Sie halten das 4-m-Raster nicht ein (2-m-Schritte, Connectors auf
 * verschiedenen Höhen) und sollen es nicht — sie sind Fremddaten ohne
 * Modelle. Ein Test, der sie einbezöge, wäre am ersten Tag rot und am
 * zweiten abgeschaltet.
 */
import {
  DUNGEONS,
  DUNGEON_RASTER_M,
  istAchsparallel,
  istEigenesModell,
  liegtAufHuellflaeche,
  pruefeRaeumeRaster,
  pruefeRaumRaster,
  type Quaternion,
  type RoomConnectionDef,
  type RoomDef,
  type Vector3,
} from '../src/index.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const EINHEIT: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
/** 90° um die Hochachse. */
const VIERTEL: Quaternion = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

function connector(localPos: Vector3, localRot: Quaternion = EINHEIT): RoomConnectionDef {
  return {
    type: '',
    entrance: false,
    allowDoor: true,
    doorOnlyIfOtherAlsoAllowsDoor: false,
    localPos,
    localRot,
  };
}

/** Ein sauberer 4×4-m-Gang mit zwei gegenüberliegenden Connectors. */
function gang(ueberschreibe: Partial<RoomDef> = {}): RoomDef {
  return {
    name: 'PruefGang',
    hash: 1,
    divider: false,
    endCap: false,
    endCapPrio: 0,
    entrance: false,
    faceCenter: false,
    minPlaceOrder: 0,
    perimeter: false,
    size: v(4, 4, 4),
    theme: 1,
    weight: 1,
    pos: v(0, 0, 0),
    rot: EINHEIT,
    connections: [connector(v(0, 0, 2)), connector(v(0, 0, -2), VIERTEL)],
    ...ueberschreibe,
  } as RoomDef;
}

console.log('Rasterprüfung für Dungeon-Bauteile');

// ── 1. Das saubere Bauteil kommt durch ───────────────────────────────
{
  const b = pruefeRaumRaster(gang());
  pruefe(b.length === 0, `sauberer 4×4-Gang beanstandet: ${b.map((x) => x.regel).join(', ')}`);
}

// ── 2. Connector-Höhe ────────────────────────────────────────────────
{
  const schief = gang({ connections: [connector(v(0, 0.5, 2))] });
  const b = pruefeRaumRaster(schief);
  pruefe(
    b.some((x) => x.regel === 'connector-hoehe' && x.schwere === 'fehler'),
    'Connector auf y = 0,5 wurde nicht beanstandet'
  );
  // Exportrauschen darf NICHT melden — sonst schaltet man die Prüfung ab.
  const rauschen = gang({ connections: [connector(v(0, 1e-7, 2))] });
  pruefe(
    pruefeRaumRaster(rauschen).length === 0,
    'Exportrauschen von 1e-7 m wurde fälschlich beanstandet'
  );
}

// ── 3. Drehung achsparallel ──────────────────────────────────────────
{
  pruefe(istAchsparallel(EINHEIT), '0° gilt nicht als achsparallel');
  pruefe(istAchsparallel(VIERTEL), '90° gilt nicht als achsparallel');
  pruefe(istAchsparallel({ x: 0, y: 1, z: 0, w: 0 }), '180° gilt nicht als achsparallel');
  pruefe(
    istAchsparallel({ x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }),
    '270° gilt nicht als achsparallel'
  );
  // q und −q sind dieselbe Drehung — darf nicht melden.
  pruefe(istAchsparallel({ x: 0, y: -0, z: 0, w: -1 }), 'negiertes Quaternion (0°) abgelehnt');
  // 45° ist nicht achsparallel.
  const halb = Math.sin(Math.PI / 8);
  pruefe(!istAchsparallel({ x: 0, y: halb, z: 0, w: Math.cos(Math.PI / 8) }), '45° durchgelassen');
  // Kippen um x ist nie erlaubt.
  pruefe(!istAchsparallel({ x: halb, y: 0, z: 0, w: Math.cos(Math.PI / 8) }), 'Kippen um x durchgelassen');

  const gekippt = gang({ connections: [connector(v(0, 0, 2), { x: halb, y: 0, z: 0, w: Math.cos(Math.PI / 8) })] });
  pruefe(
    pruefeRaumRaster(gekippt).some((x) => x.regel === 'connector-drehung'),
    'gekippter Connector wurde nicht beanstandet'
  );
}

// ── 4. Connector auf der Hüllfläche ──────────────────────────────────
{
  const size = v(4, 4, 4);
  pruefe(liegtAufHuellflaeche(v(0, 0, 2), size), 'Mitte der +z-Fläche abgelehnt');
  pruefe(liegtAufHuellflaeche(v(2, 0, 0), size), 'Mitte der +x-Fläche abgelehnt');
  pruefe(liegtAufHuellflaeche(v(-2, 0, 1), size), 'Punkt auf der −x-Fläche abgelehnt');
  pruefe(!liegtAufHuellflaeche(v(0, 0, 0), size), 'Mittelpunkt fälschlich als Hüllfläche');
  pruefe(!liegtAufHuellflaeche(v(0, 0, 3), size), 'Punkt ausserhalb der Hülle akzeptiert');

  const drinnen = gang({ connections: [connector(v(0, 0, 0))] });
  pruefe(
    pruefeRaumRaster(drinnen).some((x) => x.regel === 'connector-auf-huellflaeche'),
    'Connector im Rauminneren wurde nicht beanstandet'
  );
}

// ── 5. Grundfläche im Raster ─────────────────────────────────────────
{
  const schief = gang({ size: v(6, 4, 4), connections: [connector(v(0, 0, 2))] });
  const b = pruefeRaumRaster(schief);
  pruefe(
    b.some((x) => x.regel === 'grundflaeche-raster' && x.text.includes('x = 6')),
    '6 m Grundfläche bei 4-m-Raster wurde nicht beanstandet'
  );
  // Dasselbe Bauteil ist bei feinerem Raster in Ordnung — der Parameter
  // muss also wirken, sonst wäre ein zweites Kit später nicht möglich.
  pruefe(
    pruefeRaumRaster(schief, 2).every((x) => x.regel !== 'grundflaeche-raster'),
    '6 m Grundfläche bei 2-m-Raster fälschlich beanstandet'
  );
  // 16×16 ist ein Vielfaches und muss durchgehen.
  const gross = gang({ size: v(16, 8, 16), connections: [connector(v(0, 0, 8))] });
  pruefe(pruefeRaumRaster(gross).length === 0, '16×16-Kammer fälschlich beanstandet');
}

// ── 6. Lichte Höhe ist Hinweis, nicht Fehler ─────────────────────────
{
  const niedrig = gang({ size: v(4, 3, 4), connections: [connector(v(0, 0, 2))] });
  const b = pruefeRaumRaster(niedrig);
  const h = b.find((x) => x.regel === 'lichte-hoehe');
  pruefe(h !== undefined, '3 m lichte Höhe wurde nicht gemeldet');
  pruefe(h?.schwere === 'hinweis', 'lichte Höhe ist als Fehler statt als Hinweis eingestuft');
  pruefe(
    b.every((x) => x.regel === 'lichte-hoehe'),
    'niedriger Raum löste ausser der Höhe weitere Befunde aus'
  );
}

// ── 7. Mehrere Bauteile auf einmal ───────────────────────────────────
{
  const alle = pruefeRaeumeRaster([gang(), gang({ name: 'Krumm', size: v(6, 4, 4), connections: [] })]);
  pruefe(alle.length === 1, `erwartet 1 Befund über zwei Bauteile, bekam ${alle.length}`);
  pruefe(alle[0]?.raum === 'Krumm', 'Befund trägt den falschen Raumnamen');
}

// ── 8. Der echte Bestand — das eigentliche Ziel ──────────────────────
{
  const eigene = DUNGEONS.flatMap((d) => d.rooms).filter((r) => istEigenesModell(r.name));
  const befunde = pruefeRaeumeRaster(eigene);
  console.log(
    `  eigene Bauteile: ${eigene.length}` +
      (eigene.length === 0 ? ' (noch keine — der Wächter steht bereit)' : `, Befunde: ${befunde.length}`)
  );
  for (const b of befunde) console.error(`  ${b.schwere.toUpperCase()} ${b.raum}: ${b.text}`);
  pruefe(
    befunde.filter((b) => b.schwere === 'fehler').length === 0,
    'eigene Bauteile verletzen das Raster (siehe oben)'
  );
}

console.log(
  fehler === 0
    ? `\nOK — Raster ${DUNGEON_RASTER_M} m, alle Regeln greifen`
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
