/**
 * Lebenspunkte je Prefab — die EINE Stelle, an der Server und Client sich
 * über den Maximalwert einig sind.
 *
 * ── Warum es diese Datei überhaupt braucht ───────────────────────────
 * Der Server führte Trefferpunkte bisher als ZDO-Member `health` mit dem
 * Literal 20 als Startwert, mitten in `handleAttack` — und er legte den
 * Member erst beim ERSTEN TREFFER an. Daraus lässt sich kein Balken
 * zeichnen, und zwar aus zwei unabhängigen Gründen:
 *
 *   * Ein unverletztes Reh hat gar keinen `health`-Member. „Nicht
 *     vorhanden" und „tot" sind im Datenmodell derselbe Zustand (0).
 *   * Selbst mit dem Wert fehlt der NENNER. 14 Trefferpunkte sind ohne
 *     Maximum keine Anzeige, sondern eine Zahl.
 *
 * Beides ist hier behoben: Der Maximalwert steht als Tabelle, und der
 * Server schreibt `health` schon beim Spawn (SpawnSystem, Layout-NPCs).
 *
 * ── Warum eine eigene Datei und nicht npc.ts oder spawnData.ts ───────
 * Weil die Menge quer zu beiden liegt. `npc.ts` kennt nur Figuren mit
 * Namen und Fraktion (Furlocs, Völva, Surtr), `spawnData.ts` nur die drei
 * wandernden Tiere aus der Spawntabelle — Lebenspunkte brauchen aber
 * beide, dazu der Boss, der in keiner von beiden steht. Die Alternative
 * wäre dieselbe Zahl an drei Stellen.
 *
 * ── Woher die Zahlen kommen ──────────────────────────────────────────
 * Nicht aus dem Bauch, sondern aus EINEM Maßstab: Wie viele Schläge mit
 * der Steinaxt (`WAFFEN_SCHADEN.AxeFlint` = 15) hält die Figur aus? Das
 * ist die stärkste Waffe, die es heute gibt, und damit die einzige
 * Kennzahl, die sich am Spiel überprüfen lässt.
 *
 *   1 Schlag   Kind (das Holzschwert macht es nicht zum Gegner)
 *   2 Schläge  Reh — der bisherige Vorgabewert 20, bewusst unverändert
 *   2–3        Fischer, Ältester, Schamane: Dorfvolk, wehrhaft, kein Wächter
 *   2          Graurzwerg (er kommt in Gruppen, seine Stärke ist die Zahl)
 *   2          Wildschwein
 *   5          Furloc-Krieger — der einzige Wächter der Reihe
 *   6          Häuptling
 *   3–4        Mensch (Völva, Dorfbewohner, Wikinger)
 *  20          Eikthyr — der Wert stand schon im Server-Code
 *  40          Surtr, neun Meter Feuerriese
 *
 * Der Vorgabewert für alles ohne Eintrag bleibt 20 — genau das Literal,
 * das vorher in `handleAttack` stand. Damit ändert diese Datei an keinem
 * bestehenden Kampf etwas, sie macht ihn nur nachlesbar.
 */

/** Für alles ohne eigenen Eintrag — der bisherige Startwert aus handleAttack. */
export const LEBEN_VORGABE = 20;

export const MAX_LEBEN: ReadonlyMap<string, number> = new Map<string, number>([
  // ── Wandernde Tiere (spawnData.ts) ─────────────────────────────────
  ['Deer', 20],
  ['Boar', 30],
  ['Greydwarf', 30],

  // ── Boss ───────────────────────────────────────────────────────────
  ['Eikthyr', 300],

  // ── Menschen (npc.ts) ──────────────────────────────────────────────
  ['Voelva', 50],
  ['NPC_1', 50],
  ['WikingerBasis', 60],

  // ── Furloc-Volk ────────────────────────────────────────────────────
  // Die Abstufung folgt der Rolle, nicht der Körpergröße: Der Krieger ist
  // das einzige `monster` der Reihe und hält deshalb am meisten aus, das
  // Kind am wenigsten. Der Häuptling steht darüber, weil er als
  // Questgeber nicht an einem verirrten Axtschlag sterben soll.
  ['FurlocFischer', 40],
  ['FurlocKrieger', 75],
  ['FurlocHaeuptling', 90],
  ['FurlocSchamane', 45],
  ['FurlocAeltester', 35],
  ['FurlocKind', 15],

  // ── Riese ──────────────────────────────────────────────────────────
  ['Surtr', 600],
]);

/** Maximale Trefferpunkte eines Prefabs; nie undefined, nie 0. */
export function maxLeben(prefab: string): number {
  return MAX_LEBEN.get(prefab) ?? LEBEN_VORGABE;
}

/**
 * Trefferpunkte → Balkenlänge in Prozent (0..100).
 *
 * `-1` heisst ausdrücklich UNBEKANNT und wird durchgereicht: Das
 * Namensschild blendet den Balken dann aus, statt einen leeren zu zeigen.
 * Ein Wesen, dessen ZDO noch keinen `health`-Member trägt (Save von vor
 * dieser Änderung), soll keinen Balken auf null haben — das sähe aus wie
 * „gleich tot".
 */
export function lebenAnteil(prefab: string, punkte: number | undefined): number {
  if (punkte === undefined || punkte < 0) return -1;
  return Math.max(0, Math.min(100, (punkte / maxLeben(prefab)) * 100));
}
