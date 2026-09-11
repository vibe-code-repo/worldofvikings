/**
 * Der Latch des Strahlentors (A1) — als eigene Datei, damit er pruefbar ist.
 * The sun-shaft gate latch, kept separate so it can be tested.
 *
 * ── Warum das hier steht und nicht in PostProcessing.ts ───────────────
 * Weil es sonst kein Test erreichte. `PostProcessing` zieht halb Babylon
 * mit sich (Pipelines, Kamera, Szene) und laeuft in keinem Node-Test an;
 * `shared/src/lookProfil.ts` wiederum gehoert dem Integrator und soll
 * REIN bleiben — `strahlenTor()` hat bewusst kein Gedaechtnis, damit ihr
 * Test ohne Vorgeschichte auskommt. Der Zustand muss also irgendwo
 * dazwischen wohnen. Hier.
 *
 * ── Was der Latch entscheidet ─────────────────────────────────────────
 * `strahlenTor()` liefert eine Rampe: 1 bei Blickwinkeln <= 50°, 0 ab
 * 55°, dazwischen linear. Diese Rampe wird auf die BELICHTUNG gelegt.
 * Der Latch entscheidet etwas anderes — ob der Pass ueberhaupt an der
 * Kamera HAENGT —, und dafuer taugt eine Rampe nicht: Ein Schwenk, der
 * auf der Schwelle stehen bleibt, haengte den Pass in jedem Bild an und
 * ab, und jedes Umhaengen ist eine Listenoperation plus `setzeMsaa()`.
 *
 * Deshalb die beiden ENDEN der Rampe als Schaltpunkte und das Band
 * dazwischen als Haltezone:
 *
 *   tor >= 1   (Blickwinkel <= 50°)  →  anhaengen
 *   tor <= 0   (Blickwinkel >  55°)  →  abhaengen
 *   dazwischen                        →  bleiben, was man ist
 *
 * Das Band ist damit genau die Hysterese: Wer bei 52° hin- und
 * herschwenkt, schaltet nie. Wer von 60° kommt, schaltet bei 50° ein;
 * wer von 45° kommt, schaltet erst bei 55° aus — und bis dahin hat die
 * Rampe die Belichtung schon auf 0 gefahren, das Abhaengen aendert also
 * nichts mehr am Bild.
 *
 * The latch switches on the two ENDS of the exposure ramp and holds
 * inside the band, so a pan that lingers on the threshold never toggles.
 */

/**
 * Soll der Strahlenpass nach diesem Bild haengen?
 *
 * @param tor              Rampenwert aus `strahlenTor()` (0…1).
 * @param warAngehaengt    Zustand aus dem letzten Bild.
 * @returns Zustand fuer dieses Bild. Gleich `warAngehaengt` = nichts tun.
 */
export function strahlenLatch(tor: number, warAngehaengt: boolean): boolean {
  // NaN faellt durch beide Vergleiche und laesst den Zustand stehen —
  // richtig so: „Effekt bleibt, wie er war" ist die harmlose Antwort auf
  // eine kaputte Zahl, „Effekt bleibt an" waere es nicht.
  if (tor >= 1) return true;
  if (tor <= 0) return false;
  return warAngehaengt;
}
