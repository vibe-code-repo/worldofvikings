/**
 * assetUrls.ts — WO die Bytes eines Assets liegen. Sonst nichts.
 *
 * Herausgezogen aus `AssetManager.ts` (E6). Der Grund ist kein
 * Ordnungssinn: Ab E6 holt AUCH DER KARTENEDITOR eine Datei aus
 * `assets/generiert/` (die Modulregistry), und `editorMain.ts` importiert
 * seine schweren Nachbarn ausdrücklich erst per `import()`, damit Babylon
 * nicht im Erststart liegt — gut zwei Megabyte für eine Ansicht, die man
 * vielleicht nie aufschlägt. Ein `import { GENERATED_BASE_URL } from
 * './AssetManager'` zöge genau das herein.
 *
 * Die Alternative wäre gewesen, `/assets/generiert/` ein zweites Mal
 * hinzuschreiben. Genau das ist der Fehler, den E7 vermieden hat: Der
 * Ordnername ist eine Zusage zwischen Server, Vite-Plugin und nginx, und
 * eine zweite Kopie davon läuft irgendwann auseinander, ohne dass ein
 * Test rot wird.
 *
 * Where an asset's bytes live — extracted from AssetManager so the map
 * editor can ask without pulling Babylon into its first load.
 */
export const MODEL_BASE_URL = '/assets/models/';

/**
 * Zweite Basis-URL: die zur Laufzeit gebauten Module (E7).
 *
 * ── Warum ein eigener Ordner und nicht `assets/models/` ──────────────
 * `assets/` steht in `.gitignore` — mit GENAU EINER Ausnahme:
 * `assets/manifest.json` ist getrackt, weil `tools/test/manifest-
 * vollstaendig.ts` sonst nichts hätte, wogegen es prüfen könnte. Und
 * dieser Test läuft rekursiv über ALLE `.glb` unter `assets/models/`,
 * auch in Unterordnern: jede Datei ohne Manifest-Eintrag ist ein
 * Fehlschlag. Ein Spielserver, der einen Saal nach `assets/models/`
 * schriebe, machte damit den Testlauf rot UND hinterliesse auf jeder
 * Maschine mit Modellen eine ungetrackte Änderung an einer getrackten
 * Datei — die `git pull` in `tools/wov-update.sh` beim nächsten Mal
 * blockiert. Ein Schwesterordner hält beide Werkzeuge unberührt und
 * sagt am Pfad, was die Datei ist: erzeugt, nicht gepflegt.
 *
 * Ausgeliefert wird er ohne eine einzige neue Zeile: Der Dev-Server
 * serviert den GANZEN `assets`-Ordner (`client/vite.config.ts`,
 * `assetHandler`), live tut nginx dasselbe (`deploy/nginx-live.conf`,
 * `alias /opt/worldofvikings/assets/`).
 */
export const GENERATED_BASE_URL = '/assets/generiert/';

/**
 * Namenspräfix der generierten Module. Es ist die EINZIGE Auskunft
 * darüber, in welchem Ordner die Datei liegt — deshalb ist der Name
 * eines gebauten Saals unveränderlich, und deshalb prüft der Server ihn
 * gegen eine Erlaubnisliste, BEVOR daraus ein Dateiname wird.
 */
export const GENERATED_PREFIX = 'Gen_';

/**
 * Wo die Bytes eines Modells liegen.
 *
 * Gefragt wird nach dem DATEINAMEN, nicht nach dem Prefabnamen — die
 * beiden fallen bei jedem Eintrag in `MODELL_ALIAS` auseinander, und die
 * Basis-URL ist eine Aussage über die Datei. Ein generiertes Prefab, das
 * sich die GLB eines Bestandsmoduls leiht, lädt damit aus `models/`; ein
 * Bestandsname, der auf eine generierte Datei zeigt, aus `generiert/`.
 * Andersherum suchte der Lader dort, wo nichts liegt.
 */
export function modelBaseUrl(datei: string): string {
  return datei.startsWith(GENERATED_PREFIX) ? GENERATED_BASE_URL : MODEL_BASE_URL;
}
