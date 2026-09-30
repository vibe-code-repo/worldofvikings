/**
 * Test-Haken (F8 N3): benannte Punkte im Speicher-/Schreibweg, an denen ein TESTPROZESS
 * sich selbst beenden oder einen Rueckruf ausfuehren kann. Damit sind Kill-Proben
 * deterministisch ("stirb in der Transaktion") statt Zufall ("stirb nach 150-650 ms").
 *
 * ── Warum das im Produktionsbetrieb nicht wirkt ─────────────────────
 * Ein Haken tut NUR etwas, wenn `NODE_ENV === 'test'`. Diese Variable setzt kein
 * Betriebsdienst und keine Unit-Datei (`/etc/wov.env`, systemd); sie wird nur von den Tests
 * fuer ihre Kindprozesse gesetzt. Selbst wenn jemand `WOV_KILL_PUNKT` in die Betriebsumgebung
 * schreibt, passiert ohne `NODE_ENV=test` nichts: die Funktion kehrt in der ersten Zeile zurueck.
 * Der Rueckruf-Weg (`hakenRegistrieren`) ist ebenso gesperrt. Das ist ein Schalter im Prozess
 * selbst (nicht in einer Konfigurationsdatei, die ein Admin oder der Editor schreiben kann).
 *
 * `WOV_KILL_PUNKT=<name>`: der Prozess bekommt an diesem Punkt SIGKILL (kein Aufraeumen,
 * kein Signalhandler, wie ein OOM-Kill).
 */
const rueckrufe = new Map<string, () => void>();

function testModus(): boolean {
  return process.env.NODE_ENV === 'test';
}

/** Punkt `name` erreicht. Ohne NODE_ENV=test: nichts. */
export function haken(name: string): void {
  if (!testModus()) return;
  if (process.env.WOV_KILL_PUNKT === name) {
    process.kill(process.pid, 'SIGKILL');
    for (;;) { /* SIGKILL wird gleich zugestellt; nichts mehr ausfuehren */ }
  }
  rueckrufe.get(name)?.();
}

/** Einen Rueckruf an einen Punkt haengen (nur Tests). */
export function hakenRegistrieren(name: string, fn: (() => void) | null): void {
  if (!testModus()) return;
  if (fn) rueckrufe.set(name, fn);
  else rueckrufe.delete(name);
}
