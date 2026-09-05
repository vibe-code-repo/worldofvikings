/**
 * Prüft: die zwei Zuordnungen aus `tools/manifest-zuordnung.ts`, mit denen
 * `tools/asset-manifest.mjs --abgleich` von einer Prefab-Definition auf die
 * GLB kommt, die sie wirklich lädt.
 *
 * ── Wogegen dieser Test steht (F5) ───────────────────────────────────
 * Beide Zuordnungen scheitern LAUTLOS, und beide auf dieselbe Art: Sie
 * lassen etwas aus dem Bericht fallen, statt etwas Falsches
 * hineinzuschreiben.
 *
 *  • `MODELL_ALIAS` wird aus dem Client-Quelltext gelesen. Verschiebt
 *    jemand die Tabelle oder ändert ihre Schreibweise, liest der Leser
 *    nichts — und `GrabhuegelGras`, `SteingrabGangDurch`,
 *    `StoneVaultEntry` und `RockVaultEntry` verschwinden aus dem
 *    Abgleich. Vier Prefabs, deren `renderScale` danach niemand mehr
 *    misst, ohne dass irgendwo ein Fehler steht.
 *
 *  • Die Modul-Zuordnung Fels → Stamm entsteht aus der REIHENFOLGE der
 *    Räume, weil `rockVariant()` mit `map` abbildet. Verschiebt jemand
 *    einen Raum im Stammkit, zeigt danach jede Zeile auf das falsche
 *    Stammmodul — ein Bericht, der überzeugend aussieht und nicht stimmt.
 *
 * Der Test braucht KEINE Modelldateien: er misst nichts, er prüft die
 * Zuordnungen gegen die Prefab-Tabelle. Damit läuft er auch im
 * CI-Checkout, in dem `assets/` fehlt (s. `scripts/run-tests.mjs`).
 *
 *   npx tsx tools/test/manifest-zuordnung.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUNGEONS_BY_NAME, KIT_DERIVATIONS, PREFAB_DEFS } from '@wov/shared';
import { ALIAS_QUELLE, moduleStems, readModelAlias } from '../manifest-zuordnung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 1. Die Alias-Tabelle wird überhaupt gelesen ───────────────────────
const alias = readModelAlias(WURZEL);
check(`${ALIAS_QUELLE}: MODELL_ALIAS gelesen`, Object.keys(alias).length > 0, `${Object.keys(alias).length} Einträge`);

/*
  Gegenprobe zur Regex, die den Block aus dem Quelltext schneidet: Jeder
  Schlüssel und jedes Ziel muss der Modellname eines Prefabs sein. Ein zu
  früh gelesenes `}` liefert dann zwar weniger Einträge, aber keine
  falschen — deshalb prüft die Zeile danach zusätzlich, dass die Tabelle
  in BEIDE Richtungen aufgeht: ein Alias, den kein Prefab nennt, ist
  entweder ein Tippfehler oder eine Leiche.
*/
const modelle = new Set<string>();
for (const def of PREFAB_DEFS) if (def.model) modelle.add(def.model);

const unbekannteSchluessel = Object.keys(alias).filter((k) => !modelle.has(k));
check(
  'jeder Alias-Schlüssel ist der Modellname eines Prefabs',
  unbekannteSchluessel.length === 0,
  unbekannteSchluessel.join(', ')
);

/*
  Das Ziel eines Alias ist ein DATEISTAMM. Dass es zugleich der Modellname
  eines anderen Prefabs ist, ist kein Zufall, sondern der Zweck: Zwei
  Prefabs teilen sich eine GLB. Ein Ziel ohne Prefab wäre ein Dateiname,
  den sonst niemand kennt — ohne `assets/` nicht prüfbar, mit dieser Zeile
  aber sehr wohl.
*/
const unbekannteZiele = Object.values(alias).filter((v) => !modelle.has(v));
check('jedes Alias-Ziel ist der Modellname eines Prefabs', unbekannteZiele.length === 0, unbekannteZiele.join(', '));

const ringe = Object.entries(alias).filter(([k, v]) => k === v || alias[v] !== undefined);
check('kein Alias zeigt auf sich selbst oder auf einen weiteren Alias', ringe.length === 0, ringe.map(([k, v]) => `${k}→${v}`).join(', '));

// ── 2. Fels-Modul → Stammmodul ────────────────────────────────────────
const stems = moduleStems();
check('KIT_DERIVATIONS ist nicht leer', KIT_DERIVATIONS.length > 0, `${KIT_DERIVATIONS.length} Ableitung(en)`);

for (const { stem: stammKit, derived: kit } of KIT_DERIVATIONS) {
  const a = DUNGEONS_BY_NAME.get(stammKit);
  const b = DUNGEONS_BY_NAME.get(kit);
  /*
    Erwartet wird die Zahl der Module in der ABLEITUNG, nicht im Stamm:
    Seit dem 05.09.2026 hat `DG_RockVault` zwei Räume mehr als sein Stamm
    (die Wandvarianten `RockVaultWallB`/`...C`, s. `FELS_WAND_VARIANTEN`).
    Die Frage dieser Prüfung ist unverändert „hat JEDES Modul der Ableitung
    einen Stamm?" — und die beantwortet nur die Zahl der Ableitung.
  */
  const erwartet = (b?.rooms.length ?? 0) + (b?.doorTypes.length ?? 0);
  const gefunden = [...stems.values()].filter((s) => s.kit === kit).length;
  check(
    `${kit}: jedes Modul und jeder Türtyp hat ein Stammmodul in ${stammKit}`,
    a !== undefined && b !== undefined && gefunden === erwartet,
    `${gefunden} von ${erwartet}`
  );
}

const stammNamen = new Set<string>();
for (const d of DUNGEONS_BY_NAME.values()) {
  for (const r of d.rooms) stammNamen.add(r.name);
  for (const t of d.doorTypes) stammNamen.add(t.prefabName);
}
const verwaist = [...stems.values()].filter((s) => !stammNamen.has(s.stem) || s.stem === s.derived);
check(
  'jedes Stammmodul existiert und ist ein anderes Modul als die Ableitung',
  verwaist.length === 0,
  verwaist.map((s) => `${s.derived}→${s.stem}`).join(', ')
);

/*
  Der eigentliche Grund für die Zuordnung: `rockVariant()` übernimmt
  `size` unverändert, und `buildRegistry()` rechnet `renderScale` aus
  `size`. Also MUSS der Platzhalter der Ableitung derselbe sein wie der
  des Stamms. Ist er es nicht, hat jemand einen RoomDef von Hand
  angefasst — und der Abgleich dürfte die Fels-Zeile dann gerade NICHT
  mehr als Wiederholung des Stamms wegfalten.
*/
const nachName = new Map(PREFAB_DEFS.filter((d) => d.model).map((d) => [d.name, d]));
const auseinander: string[] = [];
for (const s of stems.values()) {
  const d = nachName.get(s.derived);
  const q = nachName.get(s.stem);
  if (!d || !q) {
    auseinander.push(`${s.derived}: kein Prefab`);
    continue;
  }
  if (d.renderScale.w !== q.renderScale.w || d.renderScale.h !== q.renderScale.h) {
    auseinander.push(`${s.derived} ${d.renderScale.w}×${d.renderScale.h} ≠ ${s.stem} ${q.renderScale.w}×${q.renderScale.h}`);
  } else if (d.localScale.x !== q.localScale.x || d.localScale.y !== q.localScale.y || d.localScale.z !== q.localScale.z) {
    auseinander.push(`${s.derived}: localScale weicht vom Stamm ab`);
  }
}
check('Ableitung und Stamm tragen dasselbe renderScale und localScale', auseinander.length === 0, auseinander.join('; '));

// ── 3. Die beiden Zuordnungen müssen zueinander passen ────────────────
/*
  Ein Alias am Stammmodul ohne Gegenstück an der Ableitung ist die Falle,
  die `RockVaultEntry` schon einmal gestellt hat: Das Fels-Kit erbt den
  Raum, der Client sucht `RockVaultEntry.glb`, findet sie nicht — und der
  STARTRAUM jedes Fels-Grabs bleibt unsichtbar, als einziger Raum und
  ohne Fehlermeldung ausser einer Ladewarnung.
*/
const stemVonDerived = new Map([...stems.values()].map((s) => [s.derived, s]));
const nachStamm = new Map([...stems.values()].map((s) => [`${s.kit} ${s.stem}`, s.derived]));
const luecken: string[] = [];
for (const s of stems.values()) {
  const stammAlias = alias[s.stem];
  const derivedAlias = alias[s.derived];
  if (stammAlias === undefined && derivedAlias === undefined) continue;
  if (stammAlias === undefined || derivedAlias === undefined) {
    luecken.push(`${s.derived}: Alias nur auf einer Seite (${s.stem}→${stammAlias ?? '—'}, ${s.derived}→${derivedAlias ?? '—'})`);
    continue;
  }
  const erwartet = nachStamm.get(`${s.kit} ${stammAlias}`);
  if (erwartet !== derivedAlias) {
    luecken.push(`${s.derived}→${derivedAlias}, erwartet ${erwartet ?? '(kein abgeleitetes Gegenstück zu ' + stammAlias + ')'}`);
  }
}
check('jeder Alias am Stammmodul hat sein Gegenstück an der Ableitung', luecken.length === 0, luecken.join('; '));

const aliasOhneStamm = Object.keys(alias).filter((k) => stemVonDerived.has(k) && alias[stemVonDerived.get(k)!.stem] === undefined);
check('kein Alias an einer Ableitung ohne Alias am Stamm', aliasOhneStamm.length === 0, aliasOhneStamm.join(', '));

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== MANIFEST-ZUORDNUNG: ALL PASSED ===');
process.exit(0);
