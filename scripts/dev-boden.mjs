/**
 * Der Bodenstapel beim Start von `npm run dev` (herausgeloest aus `scripts/dev.mjs`, damit ein Test es mit
 * erfundenem Dateisystem und erfundenen Kindprozessen fahren kann).
 *
 *  - Fehlen `assets/store-lab` oder `assets/generiert` (frischer Arbeitsbaum): `store:aufbereiten` und
 *    `store:boden`, nacheinander, jedes unter der Bau-Sperre.
 *  - Sind beide da, aber der Bodenstapel passt nicht zum Code (`stapelVeraltet` im Werkzeug): NUR `store:boden`,
 *    unter der Bau-Sperre. `store:aufbereiten` schreibt getrackte Dateien und laeuft dann nicht.
 *  - Sonst nichts.
 * Schlaegt ein Schritt fehl, steht eine Warnung da und das Spiel startet trotzdem.
 *
 * Ground stack start-up logic of `scripts/dev.mjs`, injectable for tests; every build step takes the build lock.
 */
export async function bodenVorbereiten({ wurzel, npm, existsSync, readFileSync, werkzeugLaden, spawnSync, resolve, log, warn }) {
  const store = resolve(wurzel, 'assets/store');
  const storeLab = resolve(wurzel, 'assets/store-lab');
  const generiert = resolve(wurzel, 'assets/generiert');
  if (!existsSync(store)) return 'kein-store';

  const sperre = resolve(wurzel, 'tools/sperre.sh');
  const bauen = (script) =>
    existsSync(sperre)
      ? spawnSync(sperre, ['build', '--', npm, 'run', script], { stdio: 'inherit', cwd: wurzel })
      : spawnSync(npm, ['run', script], { stdio: 'inherit', cwd: wurzel });

  if (!existsSync(storeLab) || !existsSync(generiert)) {
    log('[dev] assets/store-lab oder assets/generiert fehlt — bereite die Store-Vegetation auf …');
    for (const script of ['store:aufbereiten', 'store:boden']) {
      const ergebnis = bauen(script);
      if (ergebnis.status !== 0) {
        warn(`[dev] "npm run ${script}" ist fehlgeschlagen — Spiel startet trotzdem, siehe Meldung oben.`);
        return 'fehlgeschlagen';
      }
    }
    return 'aufbereitet';
  }

  let veraltet = true;
  try {
    const werkzeug = await werkzeugLaden();
    const datei = resolve(generiert, 'terrain/store-schichten.json');
    const tabelle = existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf-8')) : null;
    veraltet = werkzeug.stapelVeraltet(tabelle);
  } catch {
    veraltet = true;
  }
  if (!veraltet) return 'aktuell';
  log('[dev] Der Bodenstapel passt nicht zum Code (Zeilenzahl oder Layout-Version) — baue ihn neu (store:boden) …');
  const ergebnis = bauen('store:boden');
  if (ergebnis.status !== 0) {
    warn('[dev] "npm run store:boden" ist fehlgeschlagen — Spiel startet trotzdem, siehe Meldung oben.');
    return 'fehlgeschlagen';
  }
  return 'neu-gebaut';
}
