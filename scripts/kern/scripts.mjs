/**
 * Testliste, Bereich `scripts`: die Einträge `[paket, datei, weiche?]` von KERN, deren Pfad mit `scripts/` beginnt.
 * Sortiert nach vollem Pfad (`paket/datei`, Bytevergleich): Ein neuer Test wird an SEINER alphabetischen Stelle
 * eingetragen, nicht ans Ende, damit zwei Pull Requests nicht an derselben Stelle einfügen und git sauber mergt.
 * Die Reihenfolge ist zugleich die Laufreihenfolge im Bereich. `scripts/pruefe-runner-liste.mjs` prüft die Sortierung.
 * Der Kommentar steht direkt über seinem Eintrag und wandert mit ihm.
 *
 * Test list, area `scripts`: the KERN entries whose path starts with `scripts/`, sorted by full path.
 */

export default [
  /*
    Guard: no test file names a fixed port. 25 test files bound fixed ports (2498-2610,
    27314); they were converted on 21.09.2026 (`port: 0` + `portVon(server)`, see
    scripts/testport.mjs and AGENTS.md 3.3); this keeps the next new test from
    writing `const PORT = 2604` again. Reads test files as text (same definition
    of a test file as the witness above), no bind, ~0.1 s, needs no assets/.
    Two lists carry the reasons for every allowed number (a known rest in
    g12-tick-aufteilung.ts, YAML fixture text, three slot-port tools outside the
    runner) and are checked both ways: an entry that matches nothing is a finding,
    and so is a tool under tools/ or scripts/ that starts a server on a slot port
    (247n/248n/529n) without being named.
    It proves itself on a throwaway tree first, in every direction.

    Guard: no test names a fixed port; every allowed number carries a reason.
  */
  ['scripts', 'pruefe-feste-ports.mjs'],
  /*
    Paket 0.10: der Zeuge gegen verwaiste Testdateien. Er liest diese Liste
    am Syntaxbaum und hält jede Testdatei im Baum dagegen (Ordner `test`,
    Dateien `pruefe-*`); was fehlt, muss mit Grund auf seiner Ausnahmeliste
    stehen. Vorher probt er sich selbst an einem Wegwerf-Baum in jede
    Richtung, damit er nicht „immer grün" sein kann. Liest nur Dateien,
    ~1 s, braucht kein assets/.

    Guards this list: every test file in the tree is registered here or
    carries a reason on the witness's exception list.
  */
  ['scripts', 'pruefe-runner-liste.mjs'],
  /*
    S3 (Elemente-Umzug): der Zeuge gegen die Weichen selbst. Er steht VOR
    dem einzigen Test, der eine Weiche wirklich braucht, weil er dessen
    Voraussetzung prüft: dass `brauchtBlender` nur dann überspringt, wenn
    hier tatsächlich kein Blender läuft. Dafür fragt er nicht dieselbe
    Quelle noch einmal, sondern STARTET Blender (`flatpak run … --version`)
    und hält das Ergebnis gegen die billige Auskunft der Weiche
    (`flatpak info`). Dazu die Verdrahtung im Quelltext dieser Datei.

    Ohne ihn ist „übersprungen" nicht von „kaputt" zu unterscheiden — und
    ein Sammellauf, der nichts mehr misst, meldet trotzdem grün.

    Läuft überall: ohne Blender prüft er, dass die Weiche NEIN sagt, mit
    Blender, dass sie JA sagt. ~1 s (plus Blender-Start, wo einer da ist).

    S3: the witness against the skip switches — they must never always skip.
  */
  ['scripts', 'pruefe-weichen.mjs'],
];
