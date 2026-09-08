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
 * Dritte Wurzel: der Asset-Speicher und Bauer Bs abgeleiteter Ordner.
 *
 * Beide liegen direkt unter `assets/`, und der ORDNER steckt bereits im
 * Modellnamen: `store/vegetation/tree-1e1` bzw.
 * `store-lab/vegetation/tree-1e1`. Eine eigene Wurzel je Ordner hiesse,
 * dieselbe Auskunft zweimal zu führen — einmal im Namen und einmal in
 * der Konstante —, und die zweite Kopie liefe beim ersten neuen Ordner
 * auseinander.
 */
export const STORE_BASE_URL = '/assets/';

/**
 * Die Präfixe, an denen ein Store-Modell zu erkennen ist. `store/` ist
 * der unveränderte Bestand, `store-lab/` die abgeleiteten Fassungen
 * (`tools/store-vegetation-aufbereiten.mjs`): `store/vegetation/pine-1b2`
 * und `store-lab/vegetation/pine-1b2` sind dasselbe Modell in zwei
 * Zuständen, roh und aufbereitet. Welchen davon ein Prefab nennt,
 * entscheidet `tools/store-prefabs.mjs` beim Erzeugen — und die Basis
 * folgt dem ORDNER, nicht einer Namensregel wie bei `Gen_`.
 *
 * Warum die Präfixe hier stehen und NICHT in `MODELL_ALIAS`: Die Dateien
 * liegen ausserhalb des Repos, ihre Namen erzeugt `tools/store-prefabs.mjs`
 * aus `assets/store/prefabs.json`. Eine Aliastabelle wäre eine zweite,
 * handgepflegte Wahrheit über 570 Prefabs.
 */
export const STORE_PREFIXE = ['store/', 'store-lab/'] as const;

/**
 * Die WURZEL eines Modellnamens — welcher der drei Bestände ist gemeint?
 *
 * Gefragt wird nach dem DATEINAMEN, nicht nach dem Prefabnamen — die
 * beiden fallen bei jedem Eintrag in `MODELL_ALIAS` auseinander, und die
 * Wurzel ist eine Aussage über die Datei. Ein generiertes Prefab, das
 * sich die GLB eines Bestandsmoduls leiht, lädt damit aus `models/`; ein
 * Bestandsname, der auf eine generierte Datei zeigt, aus `generiert/`.
 * Andersherum suchte der Lader dort, wo nichts liegt.
 */
function wurzelUrl(datei: string): string {
  if (STORE_PREFIXE.some((p) => datei.startsWith(p))) return STORE_BASE_URL;
  return datei.startsWith(GENERATED_PREFIX) ? GENERATED_BASE_URL : MODEL_BASE_URL;
}

/**
 * Wo die Bytes eines Modells liegen — der ORDNER, mit Schrägstrich am
 * Ende.
 *
 * ── Warum der Ordner und nicht die Wurzel ────────────────────────────
 * Das ist am Bild gelernt und nicht am Papier: Die GLBs des
 * Asset-Speichers tragen ihre Texturen NICHT eingebettet, sondern als
 * relative URI daneben (`textures/sm-env-rock-03-….png`). Babylons
 * glTF-Lader löst die gegen genau diese Basis auf. Gibt man ihm
 * `/assets/` und den ganzen Pfad als Dateinamen, lädt die GLB
 * anstandslos — und danach sucht er die Textur unter
 * `/assets/textures/…` statt unter `/assets/store/environment/textures/…`.
 *
 * Das Ergebnis war kein Fehler, sondern ein LEERES BILD mit einer
 * 404-Zeile in der Konsole: Der Lader wirft beim fehlenden Bild, und das
 * Modell kommt gar nicht erst zustande. Gemessen im Browser am
 * 08.09.2026 (`/home/mike/wov-lab-mess/bruecke-sichtnachweis.mjs`) —
 * kein Test hätte das gesehen, denn die URL der GLB war richtig.
 *
 * Der Schnitt gilt für ALLE Bestände, nicht nur für den Speicher: Auch
 * `wikingerin/H_01` bekommt so `/assets/models/wikingerin/` als Basis.
 * Zusammengesetzt ergibt das dieselbe URL wie vorher — nur die
 * relativen Nachbarn stimmen jetzt auch.
 */
export function modelBaseUrl(datei: string): string {
  const wurzel = wurzelUrl(datei);
  const schnitt = datei.lastIndexOf('/');
  return schnitt < 0 ? wurzel : `${wurzel}${datei.slice(0, schnitt + 1)}`;
}

/**
 * Der reine DATEINAME eines Modellnamens, ohne Ordner und ohne Endung.
 *
 * Gehört untrennbar zu {@link modelBaseUrl}: Was die eine abschneidet,
 * gibt die andere zurück. Zusammen ergeben sie die vollständige URL —
 * dafür gibt es {@link modelUrl}, damit niemand die Hälften von Hand
 * zusammensetzt und dabei eine davon vergisst.
 */
export function modelDateiName(datei: string): string {
  const schnitt = datei.lastIndexOf('/');
  return schnitt < 0 ? datei : datei.slice(schnitt + 1);
}

/**
 * Die vollständige URL der GLB — die EINE Art, sie zu bilden.
 *
 * Vorher stand an zwei Stellen `modelBaseUrl(d) + d + '.glb'`. Solange
 * die Basis eine Wurzel war, ging das auf; seit sie der Ordner ist,
 * stünde der Ordner zweimal darin. Eine Funktion statt einer
 * Zeichenketten-Regel: Die Regel kann man vergessen, die Funktion nicht.
 */
export function modelUrl(datei: string): string {
  return `${modelBaseUrl(datei)}${modelDateiName(datei)}.glb`;
}
