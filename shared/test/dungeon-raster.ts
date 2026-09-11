/**
 * LEGACY — wird nach Erfolg von Dungeon Generator 2.0 geloescht / will be
 * deleted once Dungeon Generator 2.0 succeeds. Ersetzt durch
 * `dungeon2-determinismus.ts`, `-invarianten.ts`, `-builder.ts`,
 * `-paritaet.ts`, `-schichten.ts`. Bis dahin bleibt dieser Test gruen und
 * ungeaendert.
 * Replaced by `dungeon2-determinismus.ts`, `-invarianten.ts`,
 * `-builder.ts`, `-paritaet.ts`, `-schichten.ts`. Until then this test
 * stays green and unchanged.
 *
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
  innenmassAchsen,
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
import { STEIGUNGS_GRENZE_GRAD } from '../src/bewegung/masse.js';

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

// ── 5b. Innenmass bei eingebauten Wänden ─────────────────────────────
//
// Die zweite Ausnahme der Grundflächenregel, neben `verschlussAchse` —
// und wie diese eng gefasst. Ein Modul mit EINGEBAUTER Wand (StoneVault:
// Corridor, Corner, Junction) nennt als Hülle das Innenmass zwischen den
// Wänden: 1,4 = 2 − 2 × 0,3. Auf dem Raster steht es trotzdem, seine
// Connectors liegen auf der Rasterkante (± 1), nicht auf der Hülle.
//
// Geprüft wird hier vor allem, was NICHT durchkommt: ein Mass, das
// irgendwie kleiner ist, ein Raum mit Connector auf der Innenfläche
// (dann ist er wirklich so klein) und ein Abschluss.
{
  const korridor = gang({
    name: 'PruefKorridor',
    size: v(1.4, 3.5, 2),
    connections: [connector(v(0, 0, 1)), connector(v(0, 0, -1), VIERTEL)],
  });
  pruefe(innenmassAchsen(korridor, 2).join(',') === 'x', 'x wurde nicht als Innenmass erkannt');
  pruefe(
    pruefeRaumRaster(korridor, 2).every((x) => x.schwere !== 'fehler'),
    `1,4-Innenmass beanstandet: ${pruefeRaumRaster(korridor, 2).map((x) => x.regel).join(', ')}`
  );

  // Beide Achsen eingebaut (die Ecke) — und die Connectors auf ± 1 dürfen
  // dabei nicht als „ausserhalb der Hülle" gelten.
  const ecke = gang({
    name: 'PruefEcke',
    size: v(1.4, 3.5, 1.4),
    connections: [connector(v(0, 0, 1)), connector(v(1, 0, 0), VIERTEL)],
  });
  pruefe(
    pruefeRaumRaster(ecke, 2).every((x) => x.schwere !== 'fehler'),
    'Ecke mit Innenmass auf beiden Achsen beanstandet'
  );

  // 1,2 ist NICHT 2 − 2 × 0,3 — nur „irgendwie kleiner" reicht nicht.
  const krumm = gang({ ...korridor, size: v(1.2, 3.5, 2) });
  pruefe(
    pruefeRaumRaster(krumm, 2).some((x) => x.regel === 'grundflaeche-raster'),
    '1,2 m Grundfläche kam über die Innenmass-Ausnahme durch'
  );

  // Ein Connector auf der Innenfläche heisst: Der Raum ist wirklich
  // 1,4 m breit. Dann gilt die Ausnahme nicht.
  const echtSchmal = gang({
    ...korridor,
    connections: [connector(v(0.7, 0, 0), VIERTEL), connector(v(0, 0, 1))],
  });
  pruefe(
    innenmassAchsen(echtSchmal, 2).length === 0,
    'Connector auf der Innenfläche hob die Ausnahme nicht auf'
  );

  // Abschlüsse gehen weiter durch `verschlussAchse` und bekommen die
  // Ausnahme nicht — sonst wäre `endCap` ein zweiter Freibrief.
  const abschluss = gang({
    ...korridor,
    endCap: true,
    connections: [connector(v(0, 0, 1))],
  });
  pruefe(innenmassAchsen(abschluss, 2).length === 0, 'Abschluss bekam die Innenmass-Ausnahme');
  pruefe(
    pruefeRaumRaster(abschluss, 2).some((x) => x.regel === 'grundflaeche-raster'),
    'Abschluss mit 1,4 m quer zum Connector kam durch'
  );
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
//
// Geprüft wird je Kit gegen SEIN Rastermass (`DungeonDef.gridSize`) statt
// pauschal gegen 4 m. Der Grund steht im Kit: `DG_Steingrab` baut aus
// fertigen Räumen auf 4 m, `DG_StoneVault` aus Modulzellen auf 2 m
// (`/home/mike/wov-ai/elements/modulFormat.md`). Beide Masse sind gültig
// — `pruefeRaumRaster` nimmt das Raster nicht umsonst als Parameter, und
// 2 m ist eine VERFEINERUNG des 4-m-Rasters, keine Abweichung davon:
// Was auf 4 passt, passt auch auf 2.
//
// Was hier NICHT nachgelassen wird: Connector-Lage, Connector-Drehung,
// Mindesthöhe und die Verschluss-Ausnahme gelten unverändert für alle.
{
  const eigene = DUNGEONS.flatMap((d) => d.rooms).filter((r) => istEigenesModell(r.name));
  const befunde = DUNGEONS.flatMap((d) =>
    pruefeRaeumeRaster(
      d.rooms.filter((r) => istEigenesModell(r.name)),
      // Fremdkits deklarieren durchweg 4; ein Kit ohne brauchbares Mass
      // fiele sonst still auf 0 zurück und würde gar nicht mehr geprüft.
      d.gridSize > 0 ? d.gridSize : DUNGEON_RASTER_M
    )
  );
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

// ── 9. Treppen dürfen nicht steiler sein, als die Figur steigen kann ──
//
// Ein Bauteil mit zwei Connectors auf VERSCHIEDENEN Höhen ist eine Rampe
// oder eine Treppe: Der Höhenunterschied wird auf der Strecke zwischen
// den beiden Connectors überwunden. Wird sie zu steil, rutscht die Figur
// im Spiel wieder ab — der Raum sieht in jedem Rendering richtig aus, und
// der Fehler zeigt sich erst, wenn jemand die Treppe hochlaufen will.
//
// Genau das ist am 3.9.2026 mit `StoneVaultStairs` passiert: 3,5 m auf
// 4 m Lauf = 41,2°, und damit über der Grenze. Seither steigt sie über
// drei Zellen (6 m Lauf, 30,3°).
//
// GRENZE: `STEIGUNGS_GRENZE_GRAD` — seit dem 11.09.2026 IMPORTIERT statt
// abgeschrieben. Die Zahl wohnt jetzt in `shared/src/bewegung/masse.ts`,
// von wo sie Server UND Client beziehen (der Controller setzt daraus sein
// `maxSlopeCosine`). Vorher stand sie im Client, also ausserhalb dessen,
// was `shared` importieren darf, und musste hier als Kopie leben — mit
// dem üblichen Ergebnis, dass eine Kopie beim Ändern zurückbleibt.
//
// Der Wert ist seit dem 11.09.2026 der Originalwert 60° (vorher 40°). Für
// diesen Wächter heißt das: Er wird LOCKERER, nie strenger — kein Bauteil,
// das gestern durchkam, fällt heute durch.
{
  const eigene = DUNGEONS.flatMap((d) => d.rooms).filter((r) => istEigenesModell(r.name));
  let geprueft = 0;
  for (const raum of eigene) {
    // Das Paar mit dem grössten Höhenunterschied — mehr als zwei
    // Connectors mit y != 0 hat derzeit kein eigenes Bauteil, und der
    // steilste Übergang ist ohnehin der, der zuerst bricht.
    for (let i = 0; i < raum.connections.length; i++) {
      for (let j = i + 1; j < raum.connections.length; j++) {
        const a = raum.connections[i]!;
        const b = raum.connections[j]!;
        const dy = Math.abs(a.localPos.y - b.localPos.y);
        if (dy < 1e-6) continue;
        // Lauf = waagerechter Abstand der beiden Connectors. Bei den
        // Treppen dieses Bestands liegt er ganz auf z; die Diagonale ist
        // trotzdem richtig gerechnet, falls je eine Wendung dazukommt.
        const lauf = Math.hypot(a.localPos.x - b.localPos.x, a.localPos.z - b.localPos.z);
        const grad = (Math.atan2(dy, lauf) * 180) / Math.PI;
        geprueft++;
        console.log(
          `  ${raum.name}: ${dy} m auf ${lauf} m Lauf = ${grad.toFixed(1)}° ` +
            `(Grenze ${STEIGUNGS_GRENZE_GRAD}°)`
        );
        pruefe(
          grad < STEIGUNGS_GRENZE_GRAD,
          `${raum.name} steigt mit ${grad.toFixed(1)}° — die Figur rutscht ab ` +
            `(Grenze ${STEIGUNGS_GRENZE_GRAD}°, s. client/src/player/PlayerController.ts).`
        );
      }
    }
  }
  console.log(`  Steigungen geprüft: ${geprueft}`);
}

console.log(
  fehler === 0
    ? `\nOK — Raster ${DUNGEON_RASTER_M} m, alle Regeln greifen`
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
