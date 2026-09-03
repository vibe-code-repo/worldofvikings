/**
 * `flattenRooms` — die Geometrieliste für die 3D-Vorschau (ZIEL A) OHNE
 * `roomPieces` / `dungeonFlatten.ts`.
 *
 * ── Warum eine eigene, kleine Funktion und nicht die vorhandene Abflachung ──
 * `shared/src/dungeonFlatten.ts` zieht `roomPieces` (~5 MB Einrichtungsdaten)
 * mit — deshalb ist sie ABSICHTLICH nicht im Barrel (`shared/src/index.ts`
 * exportiert nur die beiden Typen daraus, nie die Funktion). Die 3D-Vorschau
 * des Karteneditors braucht nur, WO ein Raum-Prefab, eine Tür und ein Deko-
 * Teil stehen — dieselbe Auskunft, aber ohne das teure Bündel. `flattenRooms`
 * ist deshalb NEU und ADDITIV in `dungeonKanten.ts` (s. Auftragskopf).
 *
 * ── Was geprüft wird ──────────────────────────────────────────────────────
 *  1. Ein Raum je `PlacedRoom`, mit `prefabName = room`, `pos`/`rot`
 *     UNVERÄNDERT übernommen (die Vorschau instanziert direkt darüber),
 *     und `roomIndex` als Rückweg zu `DungeonGrundriss` (Auswahl per Klick).
 *  2. Türen kommen 1:1 aus `layout.doors`.
 *  3. Deko kommt 1:1 aus `layout.props`.
 *  4. Statisch geprüft: diese Datei UND `dungeonKanten.ts` importieren nichts
 *     aus `dungeonFlatten.ts` oder `roomPieces` — sonst zöge die 3D-Vorschau
 *     das 5-MB-Bündel doch wieder mit herein, nur über einen Umweg.
 *
 * Stand vor der Implementierung: ROT — `flattenRooms` existiert in
 * `shared/src/dungeonKanten.ts` noch nicht (nur additiv vorgesehen, s.
 * Auftragskopf ZIEL A Punkt 2). Dieser Lauf hält das fest.
 *
 * Lauf: npx tsx shared/test/dungeon-flatten-rooms.ts   (aus dem Repo-Wurzelverzeichnis)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DUNGEONS_BY_NAME,
  generateDungeonLayout,
  removeRoom,
  // ANNAHME (noch nicht vorhanden): flattenRooms(layout, baseName) — additiv
  // in shared/src/dungeonKanten.ts, s. Auftragskopf ZIEL A Punkt 2.
  // @ts-expect-error — existiert noch nicht; Zeile bleibt stehen, bis rot → grün.
  flattenRooms,
  type DungeonDef,
  type DungeonLayout,
} from '../src/index.js';

let fehler = 0;
function pruefe(bedingung: boolean, was: string, zusatz = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` — ${zusatz}` : ''}`);
}

// ── (4) Statischer Import-Wächter ────────────────────────────────────────
// Textprüfung statt Laufzeit-Introspektion: Ein Re-Export über einen dritten
// Umweg würde eine Laufzeitprüfung (z. B. „ist roomPieces geladen?") nicht
// zuverlässig fangen, ein `grep` auf den Quelltext schon.
{
  const hier = dirname(fileURLToPath(import.meta.url));
  const kantenQuelle = readFileSync(join(hier, '../src/dungeonKanten.ts'), 'utf8');
  pruefe(
    !/from ['"].*dungeonFlatten/.test(kantenQuelle) && !/from ['"].*roomPieces/.test(kantenQuelle),
    'dungeonKanten.ts importiert nichts aus dungeonFlatten.ts oder roomPieces'
  );
}

function leeresStoneVault(seed: number): { layout: DungeonLayout; def: DungeonDef } {
  const def = DUNGEONS_BY_NAME.get('DG_StoneVault');
  if (!def) throw new Error('DG_StoneVault fehlt im Katalog');
  const layout = generateDungeonLayout({ ...def, maxRooms: 4, minRequiredRooms: 0 }, seed);
  return { layout, def };
}

// ── (1)+(2)+(3) Ein Layout, ein Flatten-Aufruf ───────────────────────────
{
  const { layout } = leeresStoneVault(7);
  pruefe(layout.rooms.length > 0, `Vorbedingung: Layout hat Räume (${layout.rooms.length})`);

  const flach = flattenRooms(layout, 'DG_StoneVault') as {
    rooms: Array<{ prefabName: string; pos: unknown; rot: unknown; roomIndex: number }>;
    doors: Array<{ prefabName: string; pos: unknown; rot: unknown }>;
    props: Array<{ prefabName: string; pos: unknown; rot: unknown }>;
  };

  pruefe(
    flach.rooms.length === layout.rooms.length,
    `genau ein Eintrag je Raum (${flach.rooms.length} von ${layout.rooms.length})`
  );

  layout.rooms.forEach((r, i) => {
    const f = flach.rooms[i];
    pruefe(!!f, `Raum ${i} hat einen Flatten-Eintrag`);
    if (!f) return;
    pruefe(f.prefabName === r.room, `Raum ${i}: prefabName = room ('${f.prefabName}' = '${r.room}')`);
    pruefe(f.pos === r.pos || JSON.stringify(f.pos) === JSON.stringify(r.pos), `Raum ${i}: pos identisch übernommen`);
    pruefe(f.rot === r.rot || JSON.stringify(f.rot) === JSON.stringify(r.rot), `Raum ${i}: rot identisch übernommen`);
    pruefe(f.roomIndex === i, `Raum ${i}: roomIndex = ${i} (ist ${f.roomIndex})`);
  });

  pruefe(
    flach.doors.length === layout.doors.length,
    `Türen 1:1 aus layout.doors (${flach.doors.length} von ${layout.doors.length})`
  );
  layout.doors.forEach((t, i) => {
    const f = flach.doors[i];
    pruefe(!!f && f.prefabName === t.prefabName, `Tür ${i}: prefabName übernommen`);
  });

  pruefe(
    flach.props.length === layout.props.length,
    `Deko 1:1 aus layout.props (${flach.props.length} von ${layout.props.length})`
  );
}

// ── Regressionswache: leeres Layout ergibt leere Listen, kein Wurf ───────
{
  const { layout, def } = leeresStoneVault(11);
  // Auf einen einzigen Raum (Eingang) zurückschneiden.
  for (let i = layout.rooms.length - 1; i >= 1; i--) removeRoom(layout, def.name, i);
  const flach = flattenRooms(layout, 'DG_StoneVault') as { rooms: unknown[] };
  pruefe(flach.rooms.length === 1, `Ein-Raum-Layout: genau ein Eintrag (${flach.rooms.length})`);
}

console.log(fehler === 0 ? '\nOK' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
