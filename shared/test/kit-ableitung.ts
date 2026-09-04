/**
 * F4 (Fels-Relief 3b) — der Wächter über die ABLEITUNG `DG_RockVault`.
 *
 * ── Wogegen dieser Test steht ────────────────────────────────────────
 * Die Konzeptnotiz führt unter „Risiken" den Punkt „Doppelte Kit-Pflege
 * durch die Hintertür": `rockVariant()` muss *die einzige* Stelle
 * bleiben, an der das Fels-Kit entsteht. Ein von Hand nachgetragener
 * RoomDef ist dabei die gefährlichste Form des Fehlers, weil er nichts
 * bricht — er läuft, sieht richtig aus, und läuft ab dem Tag der
 * nächsten Nahtschluss-Änderung an einer Kante auseinander, die niemand
 * mehr vergleicht.
 *
 * Der Kern ist deshalb NICHT „stimmen die Felder ungefähr", sondern:
 * Was in `EIGENE_KITS` unter `DG_RockVault` steht, ist Feld für Feld
 * dasselbe wie das, was `rockVariant(DG_StoneVault)` GERADE JETZT
 * ausrechnet. Wer einen Raum von Hand einträgt, wer ein `size` anfasst,
 * wer eine Kantenerklärung nachzieht, ohne es am Stammkit zu tun — jeder
 * davon macht diesen Test rot, und die Meldung nennt den Pfad des
 * abweichenden Feldes.
 *
 * ── Warum trotzdem die Einzelprüfungen daneben stehen ────────────────
 * Der Vergleich gegen die frische Ableitung ist tautologisch grün, wenn
 * jemand `rockVariant()` selbst verbiegt. Die Prüfungen 2 bis 7 sagen
 * deshalb unabhängig davon, was die Ableitung LEISTEN muss: 12 Räume,
 * jeder Name auf `RockVault` umgestellt, `size`/`connections`/`gridEdges`
 * unverändert, Torbogen mit eigenem Hash, Fels-Albedo an der Wand, und
 * jeder neue Name in `EIGENE_MODELLE` (sonst ist er im Spawn-Editor
 * unauffindbar, `shared/src/prefabs.ts`).
 *
 * Aufruf: `npx tsx shared/test/kit-ableitung.ts`   (aus dem Repo-Wurzelverzeichnis)
 */
import { EIGENE_KITS, rockVariant, type EigenesKitJson } from '../src/eigeneDungeons.js';
import { DUNGEONS_BY_NAME, STEIN_TEXTUREN } from '../src/dungeons.js';
import { EIGENE_MODELLE_SET } from '../src/prefabs.js';
import { getStableHash } from '../src/hash.js';
import { generateGridLayout } from '../src/dungeonRasterGenerator.js';

const STAMM = 'DG_StoneVault';
const ABLEITUNG = 'DG_RockVault';
/** Namensstamm der Module — dieselbe Umstellung, die `make-stonevault.py --stil fels` in den Dateinamen macht. */
const PRAEFIX_STAMM = 'StoneVault';
const PRAEFIX_FELS = 'RockVault';
const FELS_ALBEDO = '/assets/models/stein_fels.png';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

/**
 * Tiefer Vergleich, der den PFAD der ersten Abweichung nennt.
 *
 * `JSON.stringify` täte es fast — aber nur fast: Es vergleicht auch die
 * SCHLÜSSELREIHENFOLGE mit, und ein Objekt, das über eine Streuung
 * (`{ ...raum, name }`) entsteht, hat sie zwangsläufig gleich. Der Test
 * wäre damit blind für genau den Fall, gegen den er steht — ein von Hand
 * getippter RoomDef mit denselben Werten in anderer Reihenfolge wäre
 * „ungleich", und einer mit einem falschen Wert an derselben Stelle
 * meldete nur „anders" statt zu sagen, wo.
 */
function abweichung(a: unknown, b: unknown, pfad = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${pfad}: ${typeof a} vs. ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') return `${pfad}: ${JSON.stringify(a)} vs. ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${pfad}: Array vs. Objekt`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${pfad}: Länge ${a.length} vs. ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const t = abweichung(a[i], b[i], `${pfad}[${i}]`);
      if (t) return t;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const schluessel = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const s of schluessel) {
    const t = abweichung(ao[s], bo[s], pfad ? `${pfad}.${s}` : s);
    if (t) return t;
  }
  return null;
}

function kit(name: string): EigenesKitJson | undefined {
  return EIGENE_KITS.find((k) => k.name === name);
}

console.log(`=== ${ABLEITUNG} ist eine Ableitung aus ${STAMM} ===\n`);

const stamm = kit(STAMM);
const fels = kit(ABLEITUNG);

check(`${STAMM} steht in EIGENE_KITS`, stamm !== undefined);
check(`${ABLEITUNG} steht in EIGENE_KITS`, fels !== undefined);
if (!stamm || !fels) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
}

// ── 1. Der Wächter: identisch zur FRISCHEN Ableitung ──────────────────
{
  const frisch = rockVariant(stamm);
  const t = abweichung(frisch, fels);
  check(
    `${ABLEITUNG} ist Feld für Feld die frische Ableitung (kein Handeintrag)`,
    t === null,
    t ?? ''
  );
}

// ── 2. Zwölf Module, alle umbenannt ───────────────────────────────────
check(`${ABLEITUNG} hat ${stamm.rooms.length} Räume wie ${STAMM}`, fels.rooms.length === stamm.rooms.length, `${fels.rooms.length}`);
check(`${ABLEITUNG} hat genau 12 Räume`, fels.rooms.length === 12, `${fels.rooms.length}`);
check(
  `kein Raumname trägt noch '${PRAEFIX_STAMM}'`,
  fels.rooms.every((r) => !r.name.includes(PRAEFIX_STAMM)),
  fels.rooms
    .filter((r) => r.name.includes(PRAEFIX_STAMM))
    .map((r) => r.name)
    .join(', ')
);
check(
  `jeder Raumname beginnt mit '${PRAEFIX_FELS}'`,
  fels.rooms.every((r) => r.name.startsWith(PRAEFIX_FELS)),
  fels.rooms
    .filter((r) => !r.name.startsWith(PRAEFIX_FELS))
    .map((r) => r.name)
    .join(', ')
);

// ── 3. Feld für Feld gegen den Stammraum ──────────────────────────────
{
  const felsNachName = new Map(fels.rooms.map((r) => [r.name, r]));
  for (const stammRaum of stamm.rooms) {
    const soll = PRAEFIX_FELS + stammRaum.name.slice(PRAEFIX_STAMM.length);
    const felsRaum = felsNachName.get(soll);
    if (!felsRaum) {
      check(`${stammRaum.name} → ${soll} vorhanden`, false);
      continue;
    }
    // Der Name ist die EINZIGE erlaubte Abweichung — deshalb wird er für
    // den Vergleich zurückgesetzt statt aus der Schlüsselmenge genommen:
    // Ein fehlendes Feld fiele sonst mit heraus.
    const t = abweichung({ ...felsRaum, name: stammRaum.name }, stammRaum);
    check(`${soll}: Feld für Feld wie ${stammRaum.name} (bis auf den Namen)`, t === null, t ?? '');
  }
}

// ── 4. Kit-Kopf: nur Name, Steinmaterial und Torbogen dürfen abweichen ─
{
  const OHNE = new Set(['name', 'steinKit', 'doorTypes', 'rooms']);
  const schluessel = new Set([...Object.keys(stamm), ...Object.keys(fels)]);
  const abweichend: string[] = [];
  for (const s of schluessel) {
    if (OHNE.has(s)) continue;
    const t = abweichung((fels as unknown as Record<string, unknown>)[s], (stamm as unknown as Record<string, unknown>)[s], s);
    if (t) abweichend.push(t);
  }
  check(`Kit-Kopf identisch (ausser ${[...OHNE].join('/')})`, abweichend.length === 0, abweichend.slice(0, 3).join('; '));
  check(`${ABLEITUNG} trägt den Rasterschalter gridGeneration`, fels.gridGeneration !== undefined, JSON.stringify(fels.gridGeneration ?? null));
}

// ── 5. Steinmaterial: Fels an der Wand, alles andere wie im Stamm ─────
{
  const s = stamm.steinKit;
  const f = fels.steinKit;
  check(`${ABLEITUNG} hat ein steinKit`, f !== undefined);
  if (s && f) {
    check(`Wandtextur ist ${FELS_ALBEDO}`, f.wandTextur === FELS_ALBEDO, String(f.wandTextur));
    check(`Wandtextur steht in STEIN_TEXTUREN`, STEIN_TEXTUREN.includes(f.wandTextur ?? ''), String(f.wandTextur));
    const t = abweichung({ ...f, wandTextur: s.wandTextur }, s);
    check(`steinKit sonst unverändert`, t === null, t ?? '');
  }
}

// ── 6. Torbogen: eigener Name, eigener Hash ───────────────────────────
{
  check(`gleiche Zahl Türtypen`, fels.doorTypes.length === stamm.doorTypes.length, `${fels.doorTypes.length}`);
  for (let i = 0; i < fels.doorTypes.length; i++) {
    const f = fels.doorTypes[i]!;
    const s = stamm.doorTypes[i]!;
    const soll = PRAEFIX_FELS + s.prefabName.slice(PRAEFIX_STAMM.length);
    check(`Türtyp ${i}: ${s.prefabName} → ${soll}`, f.prefabName === soll, f.prefabName);
    // Der Hash MUSS neu gerechnet sein: Er ist der Schlüssel, unter dem
    // der Client das Modell sucht. Ein übernommener Stammhash zöge im
    // Fels-Grab die Ziegel-GLB.
    check(`Türtyp ${i}: Hash gehört zum eigenen Namen`, f.prefabHash === getStableHash(f.prefabName), `${f.prefabHash}`);
    check(`Türtyp ${i}: Hash unterscheidet sich vom Stamm`, f.prefabHash !== s.prefabHash);
    const t = abweichung({ ...f, prefabName: s.prefabName, prefabHash: s.prefabHash }, s);
    check(`Türtyp ${i}: sonst unverändert`, t === null, t ?? '');
  }
}

// ── 7. Jeder neue Name ist im Spawn-Editor auffindbar ─────────────────
{
  const fehlend = [...fels.rooms.map((r) => r.name), ...fels.doorTypes.map((d) => d.prefabName)].filter(
    (n) => !EIGENE_MODELLE_SET.has(n)
  );
  check(`alle ${ABLEITUNG}-Namen stehen in EIGENE_MODELLE`, fehlend.length === 0, fehlend.join(', '));
}

// ── 8. Der Beweis, dass die Erklärung wirklich dieselbe ist ───────────
/*
  Gleiche `size`, `connections` und `gridEdges` heisst: Der Rastergenerator
  muss aus derselben Saat denselben Grundriss bauen — Zelle für Zelle,
  Drehung für Drehung, nur mit anderen Modulnamen. Diese Prüfung ist
  strenger als jeder Feldvergleich, weil sie auch das mitnimmt, was der
  Generator NICHT aus den verglichenen Feldern liest (Gewichte, Rollen,
  Reihenfolge). Ginge irgendetwas davon auseinander, wären es zwei Kits
  und nicht ein Kit in zwei Häuten.

  Verglichen wird das ganze Layout als Text, nach GENAU ZWEI Ersetzungen:
  dem Namensstamm der Module und dem Prefab-Hash des Torbogens. Beide
  MÜSSEN sich unterscheiden (die GLB ist eine andere Datei), alles andere
  darf es nicht — und weil die Ersetzungen benannt statt weggeblendet
  sind, fällt ein dritter Unterschied auf, statt in einer Toleranz zu
  verschwinden.
*/
{
  const stammDef = DUNGEONS_BY_NAME.get(STAMM);
  const felsDef = DUNGEONS_BY_NAME.get(ABLEITUNG);
  check(`${STAMM} steht in DUNGEONS_BY_NAME`, stammDef !== undefined);
  check(`${ABLEITUNG} steht in DUNGEONS_BY_NAME`, felsDef !== undefined);
  if (stammDef && felsDef) {
    const abweichende: number[] = [];
    let erstesBeispiel = '';
    for (const seed of [1, 7, 13, 23, 40]) {
      let a = JSON.stringify(generateGridLayout(stammDef, seed)).split(PRAEFIX_STAMM).join(PRAEFIX_FELS);
      for (let i = 0; i < stamm.doorTypes.length; i++) {
        a = a.split(`"prefabHash":${stamm.doorTypes[i]!.prefabHash}`).join(`"prefabHash":${fels.doorTypes[i]!.prefabHash}`);
      }
      const b = JSON.stringify(generateGridLayout(felsDef, seed));
      if (a !== b) {
        abweichende.push(seed);
        if (!erstesBeispiel) {
          const i = [...a].findIndex((z, k) => z !== b[k]);
          erstesBeispiel = ` — ab Zeichen ${i}: '${a.slice(i, i + 60)}' vs. '${b.slice(i, i + 60)}'`;
        }
      }
    }
    check(
      `gleicher Grundriss bei gleicher Saat (nur Modulnamen und Torbogen-Hash wechseln)`,
      abweichende.length === 0,
      abweichende.length > 0 ? `Saaten ${abweichende.join(', ')}${erstesBeispiel}` : ''
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) fehlgeschlagen.`);
  process.exit(1);
} else {
  console.log('\nAlle Prüfungen grün.');
}
