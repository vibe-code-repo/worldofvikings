/**
 * nginx (deploy/nginx/wov-lab.conf, wov-live.conf) liefert /assets/ ZUERST aus
 * wov-web/static/assets/ und faellt erst bei 404 auf die Spiel-Assets
 * (/opt/worldofvikings/assets/, hier assets/) zurueck. Der Kommentar dort
 * verlangt ausdruecklich: keine Datei in beiden Verzeichnissen. Eine Datei,
 * die trotzdem an derselben relativen Stelle unter beiden Baeumen liegt, wird
 * fuer den Browser unsichtbar durch die Webkopie ersetzt -- gleich ob die
 * beiden Fassungen (zufaellig) gleich sind oder nicht.
 *
 * Gefunden 29.09.2026 ("Wikingerin, Webkopien ueberdecken Spiel-Assets"): 74
 * stehengebliebene Export-Kopien unter wov-web/static/assets/models/wikingerin/
 * (Stand 12./13.09., 63 Gelenke) verdeckten den 71-Gelenke-Koerper, den PR #122
 * ins Spiel gebracht hatte -- jede Rundreise durch die Webseite bekam den
 * alten Koerper.
 *
 * assets/ selbst liegt bewusst ausserhalb des Repos (Mike sichert die Modelle
 * selbst) -- nur assets/manifest.json ist getrackt und beschreibt, was dort
 * stehen SOLL. Dieser Test braucht deshalb keine echten Assets und laeuft in
 * der CI: er vergleicht die getrackten Pfade unter wov-web/static/assets/
 * gegen die im Manifest genannten Pfade (modelle/toene/symbole).
 *
 * Erlaubte Ausnahmen stehen NUR in ERLAUBTE_DOPPLUNGEN, mit eigener
 * Begruendung je Eintrag -- kein Freibrief: fehlt die Dopplung inzwischen auf
 * einer der beiden Seiten, oder ist die erlaubte Kopie von der Manifest-Groesse
 * abgewichen, wird der Test genauso rot wie bei einer neuen, unerlaubten
 * Ueberdeckung.
 *
 * Lauf: npx tsx tools/test/webkopien-ueberdeckung.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_ORDNER = join(WURZEL, 'wov-web/static/assets');

/**
 * Bekannte, bewusst geduldete Dopplungen. Jeder Eintrag ist eine offene
 * Ausnahme mit eigener Folgekarte, kein Freibrief fuer neue Dopplungen.
 */
const ERLAUBTE_DOPPLUNGEN: Readonly<Record<string, string>> = {
  'models/wikinger/WikingerKoerper.glb':
    'maennlicher Koerper, Hash auf beiden Seiten gleich (gemessen 29.09.2026) -- ' +
    'Folgekarte: previewModel/femaleWebArmorFile sind seit demselben Tag ungenutzt ' +
    '(erstellen/+page.svelte laedt jetzt part.model), dann auch diese Kopie pruefen/entfernen.',
};

function alleDateien(ordner: string): string[] {
  const ergebnis: string[] = [];
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) ergebnis.push(...alleDateien(pfad));
    else if (eintrag.isFile()) ergebnis.push(pfad);
  }
  return ergebnis;
}

const webDateien = new Map(
  alleDateien(WEB_ORDNER).map((pfad) => [relative(WEB_ORDNER, pfad).split(sep).join('/'), pfad] as const)
);

interface ManifestEintrag {
  readonly datei: string;
  readonly bytes: number;
}
interface Manifest {
  readonly modelle: Record<string, ManifestEintrag>;
  readonly toene: Record<string, ManifestEintrag>;
  readonly symbole: Record<string, ManifestEintrag>;
}
const manifest: Manifest = JSON.parse(readFileSync(join(WURZEL, 'assets/manifest.json'), 'utf8'));

const spielDateien = new Map<string, ManifestEintrag>();
for (const [ordner, gruppe] of [
  ['models', manifest.modelle],
  ['toene', manifest.toene],
  ['symbole', manifest.symbole],
] as const) {
  for (const eintrag of Object.values(gruppe)) spielDateien.set(`${ordner}/${eintrag.datei}`, eintrag);
}

let rc = 0;

const unerlaubt = [...webDateien.keys()]
  .filter((pfad) => spielDateien.has(pfad) && !(pfad in ERLAUBTE_DOPPLUNGEN))
  .sort();
if (unerlaubt.length > 0) {
  console.error(
    `  ROT  ${unerlaubt.length} Pfad(e) unter wov-web/static/assets/ ueberdecken assets/ laut manifest.json ` +
      `(nginx liefert die Webkopie zuerst aus, s. deploy/nginx/*.conf):`
  );
  for (const pfad of unerlaubt) console.error(`       ${pfad}`);
  rc = 1;
}

for (const [pfad, begruendung] of Object.entries(ERLAUBTE_DOPPLUNGEN)) {
  const webPfad = webDateien.get(pfad);
  const spielEintrag = spielDateien.get(pfad);
  if (!webPfad || !spielEintrag) {
    console.error(
      `  ROT  ${pfad} steht auf der Ausnahmeliste, ist aber nicht mehr doppelt ` +
        `(Webkopie ${webPfad ? 'da' : 'fehlt'}, Manifest-Eintrag ${spielEintrag ? 'da' : 'fehlt'}) -- ` +
        'Eintrag aus ERLAUBTE_DOPPLUNGEN entfernen, sonst verrottet die Liste.'
    );
    rc = 1;
    continue;
  }
  const webBytes = statSync(webPfad).size;
  if (webBytes !== spielEintrag.bytes) {
    console.error(
      `  ROT  ${pfad}: erlaubte Dopplung ist auseinandergelaufen ` +
        `(Webkopie ${webBytes} B, Manifest ${spielEintrag.bytes} B) -- ${begruendung}`
    );
    rc = 1;
  } else {
    console.log(`  OK   ${pfad}: erlaubte Dopplung noch gleich (${webBytes} B) -- ${begruendung}`);
  }
}

if (rc === 0) {
  console.log(
    `webkopien-ueberdeckung: alles gruen (${webDateien.size} Web-Pfade gegen ${spielDateien.size} ` +
      `Spiel-Pfade aus manifest.json, ${Object.keys(ERLAUBTE_DOPPLUNGEN).length} erlaubte Dopplung(en))`
  );
}
process.exit(rc);
