/**
 * Wächter für die Bauteiltabelle.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Am 20.08.2026 bekam die neue Holztruhe die Kosten „10× Wood, 2× Iron".
 * `Iron` gibt es im Spiel nicht — der Bestand kennt Wood, Stone, Flint,
 * Resin und Nahrung, sonst nichts. Die Folge war kein Fehler beim Start
 * und keine Warnung im Log, sondern ein Bauteil, das im Menü steht, sich
 * aber nicht setzen lässt: `handlePlacePiece` prüft die Kosten
 * serverseitig und antwortet „Material fehlt: 2× Iron".
 *
 * Gefunden hat es Mike, weil die KI-Kiefer (1× Wood) sich bauen liess
 * und die Truhe nicht. Ein Tippfehler im Itemnamen hätte genauso
 * ausgesehen — und wäre genauso schwer zu finden gewesen.
 *
 * Diese Prüfung macht daraus einen roten Test statt eines stummen
 * Rätsels. Sie ist billig: Sie liest nur zwei Tabellen gegeneinander.
 */
import {
  BAU_PREFABS,
  ITEM_DEFS,
  PIECES,
  PIECE_TABLES,
  PREFABS_BY_NAME,
  istEigenesModell,
} from '../src/index.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Bauteiltabelle');

const bekannteItems = new Set(ITEM_DEFS.map((i) => i.name));

// ── 1. Jede Materialkosten-Zeile nennt ein Item, das es gibt ─────────
{
  let geprueft = 0;
  for (const [name, teil] of Object.entries(PIECES)) {
    for (const r of teil.resources ?? []) {
      geprueft++;
      pruefe(
        bekannteItems.has(r.item),
        `Bauteil "${name}" verlangt "${r.item}" — kein solches Item in ITEM_DEFS. ` +
          `Das Teil erscheint im Menü und lässt sich nicht setzen.`
      );
      pruefe(r.amount > 0, `Bauteil "${name}": Menge für "${r.item}" ist ${r.amount}`);
    }
  }
  console.log(`  ${geprueft} Materialzeilen geprüft, ${bekannteItems.size} Items bekannt`);
}

// ── 2. Jedes Teil im Hammer-Menü ist auch serverseitig erlaubt ───────
// Sonst steht es im Menü und der Server weist es als "Kein baubares
// Teil" ab — dieselbe Klasse Rätsel, andere Ursache.
{
  for (const name of PIECE_TABLES.Hammer ?? []) {
    const prefab = PIECES[name]?.bauPrefab;
    pruefe(prefab !== undefined, `Hammer-Menü führt "${name}", das es in PIECES nicht gibt`);
    if (prefab === undefined) continue;
    pruefe(
      BAU_PREFABS.has(prefab),
      `"${name}" steht im Hammer-Menü, aber "${prefab}" fehlt in BAU_PREFABS (Server-Whitelist)`
    );
    pruefe(
      PREFABS_BY_NAME.has(prefab),
      `"${name}" verweist auf Prefab "${prefab}", das in der Registry fehlt`
    );
    pruefe(
      istEigenesModell(prefab),
      `"${name}" verweist auf "${prefab}", das nicht als eigenes Modell geführt wird — ` +
        `die Tabelle überspringt es dann stillschweigend`
    );
  }
  console.log(`  Hammer-Menü: ${(PIECE_TABLES.Hammer ?? []).join(', ')}`);
}

// ── 3. Die Truhe im Besonderen ──────────────────────────────────────
// Sie ist der Anlass dieser Datei und das erste eigene Hartflächen-
// Modell des Projekts; ein stiller Ausfall soll hier auffallen.
{
  const truhe = PREFABS_BY_NAME.get('HolzTruhe');
  pruefe(truhe !== undefined, 'Prefab "HolzTruhe" fehlt in der Registry');
  if (truhe) {
    pruefe(truhe.model === 'HolzTruhe', `HolzTruhe zeigt auf Modell "${truhe.model}"`);
    pruefe(
      (PIECE_TABLES.Hammer ?? []).includes('bau_truhe'),
      'bau_truhe steht nicht im Hammer-Menü'
    );
  }
}

console.log(fehler === 0 ? '\nOK — Bauteile, Kosten und Whitelist passen zusammen' : `\n${fehler} FEHLER`);
process.exit(fehler > 0 ? 1 : 0);
